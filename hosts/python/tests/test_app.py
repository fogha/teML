"""Integration tests for the handler-driven application driver."""

from __future__ import annotations

from dataclasses import dataclass, field

from teml_host import Context, run_headless
from teml_host.terminal import ScriptedStdinEvents


@dataclass
class Recorder:
    changes: list[tuple[str, str]] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


def test_dispatches_changes_delivers_queued_requests_and_exits_with_values(
    engine_path: str,
    view_path: str,
) -> None:
    recorder = Recorder()

    def on_change(id: str, value: str, ctx: Context) -> None:
        recorder.changes.append((id, value))
        if len(recorder.changes) == 1:
            ctx.render(
                '<h2>Second screen</h2>\n<label for="other">Other</label>\n<input id="other">',
                format="html",
            )
        else:
            ctx.exit()

    def on_error(message: str, ctx: Context) -> None:
        del ctx
        recorder.errors.append(message)

    values = run_headless(
        view_path,
        on_change=on_change,
        on_error=on_error,
        events=ScriptedStdinEvents.typing("XY"),
        size=(60, 20),
        engine=engine_path,
    )

    assert not recorder.errors, f"errors: {recorder.errors}"
    assert len(recorder.changes) == 2
    assert recorder.changes[0][0] == "service"
    assert recorder.changes[1] == ("other", "Y")
    assert values.get("other") == "Y"


def test_ctrl_c_ends_the_session_without_a_handler(
    engine_path: str,
    view_path: str,
) -> None:
    values = run_headless(
        view_path,
        events=ScriptedStdinEvents.chunks([b"\x03"]),
        size=(60, 20),
        engine=engine_path,
    )
    assert values == {}
