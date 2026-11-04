"""Integration tests for the handler-driven application driver."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from teml_host import Context, run_headless
from teml_host.app import _Handlers, _drive
from teml_host.screen import PreferredFrame, ScreenBuffer
from teml_host.terminal import ScriptedStdinEvents
from teml_host.types import ErrorEvent, ExitCommand, ExitEvent, RenderCommand


def _fake_engine() -> str:
    path = Path(__file__).resolve().parents[3] / "fixtures" / "engine" / "fake-engine.mjs"
    if not path.is_file():
        raise FileNotFoundError(f"fake engine missing: {path}")
    return str(path)


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


def test_rejected_mutation_preserves_subsequent_callbacks_and_values(
    engine_path: str,
    view_path: str,
) -> None:
    for mode in ("full", "patches"):
        recorder = Recorder()

        def on_change(id: str, value: str, ctx: Context) -> None:
            recorder.changes.append((id, value))
            if len(recorder.changes) == 1:
                ctx.remove("missing")
            else:
                ctx.exit()

        values = run_headless(
            view_path,
            on_change=on_change,
            on_error=lambda message, ctx: recorder.errors.append(message),
            events=ScriptedStdinEvents.typing("AB"),
            size=(60, 20),
            mode=mode,
            engine=engine_path,
        )

        assert recorder.changes == [("service", "A"), ("service", "AB")], mode
        assert recorder.errors == ["unknown mutation target 'missing'"], mode
        assert values.get("service") == "AB", mode


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


def test_an_unknown_event_completes_the_command_and_surfaces() -> None:
    """An engine newer than this host may answer a command with an event type
    the host does not know and no frame. The loop must surface the event and
    complete the command; waiting for a frame would hang forever. The document
    name selects the fake engine's scenario."""
    errors: list[str] = []

    def on_error(message: str, ctx: Context) -> None:
        errors.append(message)
        ctx.exit()

    values = run_headless(
        "unknown-event",
        on_error=on_error,
        events=ScriptedStdinEvents.typing("x"),
        size=(60, 20),
        engine=_fake_engine(),
    )

    assert errors == ["unrecognized session event 'future-thing'"]
    assert values == {}


def test_a_submit_event_dispatches_on_submit_with_form_and_values() -> None:
    submits: list[tuple[str, Values]] = []

    def on_submit(form: str, values: Values, ctx: Context) -> None:
        submits.append((form, dict(values)))
        ctx.exit()

    values = run_headless(
        "submit",
        on_submit=on_submit,
        events=ScriptedStdinEvents.typing("x"),
        size=(60, 20),
        engine=_fake_engine(),
    )

    assert len(submits) == 1, "on_submit must fire exactly once"
    form, submitted = submits[0]
    assert form == "deploy"
    assert submitted.get("env") == "prod"
    # The final values are the submit snapshot.
    assert values.get("env") == "prod"
