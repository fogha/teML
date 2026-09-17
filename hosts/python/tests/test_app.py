"""Integration tests for the handler-driven application driver."""

from __future__ import annotations

from dataclasses import dataclass, field

from teml_host import Context, run_headless
from teml_host.app import _Handlers, _drive
from teml_host.screen import PreferredFrame, ScreenBuffer
from teml_host.terminal import ScriptedStdinEvents
from teml_host.types import ErrorEvent, ExitCommand, ExitEvent, RenderCommand


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


def test_an_engine_error_completes_the_command_instead_of_blocking() -> None:
    """A rejected command answers with `error` and no frame, so the driver must
    treat the error as that command's completion; waiting for a frame blocks."""

    class StubSource:
        def __init__(self) -> None:
            self._commands = [RenderCommand(markup="x")]

        def next_command(self) -> object:
            return self._commands.pop(0) if self._commands else None

    class StubSession:
        """Answers only in response to a command, like the real engine: a
        rejected command yields `error` and nothing else."""

        def __init__(self) -> None:
            self._pending: list[object] = []

        def send(self, command: object) -> None:
            if isinstance(command, ExitCommand):
                self._pending.append(ExitEvent())
            else:
                self._pending.append(ErrorEvent(message="render rejected"))

        def next_event(self) -> object:
            if not self._pending:
                raise AssertionError("driver blocked after an error instead of completing it")
            return self._pending.pop(0)

    errors: list[str] = []
    exits: list[bool] = []

    def on_error(message: str, ctx: Context) -> None:
        errors.append(message)
        ctx.exit()
        exits.append(True)

    values = _drive(
        StubSession(),  # type: ignore[arg-type]
        ScreenBuffer(PreferredFrame.ANSI),
        StubSource(),  # type: ignore[arg-type]
        _Handlers(on_error=on_error),
        do_paint=False,
    )

    assert errors == ["render rejected"]
    assert exits == [True]
    assert values == {}
