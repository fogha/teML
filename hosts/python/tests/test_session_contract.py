"""Integration contract tests against a built TeML engine."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import pytest

from teml_host import (
    AppendCommand,
    CharCommand,
    ConfigureCommand,
    ExitCommand,
    KeyCommand,
    KeyModifiers,
    PointerCommand,
    PreferredFrame,
    PROTOCOL_VERSION,
    RemoveCommand,
    RenderCommand,
    ReplaceCommand,
    ScrollCommand,
    ScreenBuffer,
    Session,
    SessionError,
    UpdateCommand,
    command_to_json,
)
from teml_host.types import (
    ChangeEvent,
    ClickEvent,
    FullFrame,
    PatchFrame,
    ToggleEvent,
)


def spawn_session(engine_path: str, view_path: str) -> Session:
    return Session.spawn(
        view_path,
        width=60,
        no_color=True,
        engine=engine_path,
    )


def send_dict(session: Session, payload: dict[str, Any]) -> None:
    session.send(payload)


def test_html_incident_handoff_session_end_to_end(engine_path: str, view_path: str) -> None:
    with spawn_session(engine_path, view_path) as session:
        event = session.next_event()
        assert isinstance(event, FullFrame)
        assert event.focused_id == "service"
        assert event.plain is not None
        assert "Incident handoff" in event.plain

        session.send(CharCommand(char="payments"))
        change = session.next_event()
        assert isinstance(change, ChangeEvent)
        assert change.id == "service"
        assert change.value == "payments"
        assert isinstance(session.next_event(), (FullFrame, PatchFrame))

        session.send(KeyCommand(key="tab"))
        frame = session.next_event()
        assert isinstance(frame, (FullFrame, PatchFrame))
        assert frame.focused_id == "severity"

        session.send(KeyCommand(key="right"))
        assert isinstance(session.next_event(), (FullFrame, PatchFrame))
        session.send(KeyCommand(key="enter"))
        change = session.next_event()
        assert isinstance(change, ChangeEvent)
        assert change.id == "severity"
        assert change.value == "sev2"
        assert isinstance(session.next_event(), (FullFrame, PatchFrame))

        session.send(KeyCommand(key="tab"))
        frame = session.next_event()
        assert frame.focused_id == "summary"
        session.send(CharCommand(char="Elevated latency\nRollback started"))
        change = session.next_event()
        assert isinstance(change, ChangeEvent)
        assert change.id == "summary"
        assert isinstance(session.next_event(), (FullFrame, PatchFrame))
        session.send(KeyCommand(key="enter", modifiers=KeyModifiers(ctrl=True)))
        frame = session.next_event()
        assert frame.focused_id == "telemetry"

        session.send(ScrollCommand(rows=2))
        frame = session.next_event()
        assert isinstance(frame, (FullFrame, PatchFrame))
        assert frame.scroll_regions
        assert frame.scroll_regions[0].id == "telemetry"
        assert frame.scroll_regions[0].offset == 2

        session.send(KeyCommand(key="tab"))
        assert session.next_event().focused_id == "page"
        session.send(KeyCommand(key="enter"))
        toggle = session.next_event()
        assert isinstance(toggle, ToggleEvent)
        assert toggle.id == "page"
        assert toggle.checked is True
        assert isinstance(session.next_event(), (FullFrame, PatchFrame))

        session.send(KeyCommand(key="tab"))
        assert session.next_event().focused_id == "submit"
        session.send(KeyCommand(key="enter"))
        click = session.next_event()
        assert isinstance(click, ClickEvent)
        assert click.id == "submit"
        assert click.values["service"] == "payments"
        assert click.values["severity"] == "sev2"
        assert click.values["summary"] == "Elevated latency\nRollback started"
        assert click.values["page"] == "true"
        assert "telemetry" not in click.values
        assert isinstance(session.next_event(), (FullFrame, PatchFrame))

        session.send(
            RenderCommand(
                format="html",
                markup=(
                    "<h2>Incident handoff</h2>"
                    '<div class="alert alert-danger">Summary is required.</div>'
                    '<label for="service">Service</label><input id="service">'
                    '<label for="sev3">SEV-3</label>'
                    '<input id="sev3" type="radio" name="severity" value="sev3">'
                    '<label for="sev2">SEV-2</label>'
                    '<input id="sev2" type="radio" name="severity" value="sev2">'
                    '<label for="summary">Summary</label>'
                    '<textarea id="summary" rows="3"></textarea>'
                    '<button id="submit">Send</button>'
                ),
            )
        )
        frame = session.next_event()
        assert isinstance(frame, FullFrame)
        assert frame.plain is not None
        assert "Summary is required." in frame.plain
        assert "[payments]" in frame.plain
        assert "(*) SEV-2" in frame.plain

        session.send(ExitCommand())
        from teml_host.types import ExitEvent

        assert isinstance(session.next_event(), ExitEvent)
        assert session.wait(timeout=10) == 0


def test_html_incident_handoff_exit(engine_path: str, view_path: str) -> None:
    with spawn_session(engine_path, view_path) as session:
        session.next_event()
        session.send(ExitCommand())
        from teml_host.types import ExitEvent

        assert isinstance(session.next_event(), ExitEvent)
        assert session.wait(timeout=10) == 0


@dataclass
class ScriptResult:
    screens: list[str]
    saw_patch: bool


def run_scripted_session(
    engine_path: str,
    view_path: str,
    script: list[dict[str, Any]],
    *,
    patches: bool,
) -> ScriptResult:
    with spawn_session(engine_path, view_path) as session:
        screen = ScreenBuffer(PreferredFrame.PLAIN)
        first = session.next_event()
        assert isinstance(first, (FullFrame, PatchFrame))
        screen.apply(first)
        if patches:
            session.send(ConfigureCommand(frames="plain", mode="patches"))
            screen.apply(session.next_frame())
        screens = [screen.text()]
        saw_patch = False
        for command in script:
            send_dict(session, command)
            frame = session.next_frame()
            saw_patch = saw_patch or isinstance(frame, PatchFrame)
            screen.apply(frame)
            screens.append(screen.text())
        session.send(ExitCommand())
        from teml_host.types import ExitEvent

        assert isinstance(session.next_event(), ExitEvent)
        assert session.wait(timeout=10) == 0
        return ScriptResult(screens=screens, saw_patch=saw_patch)


def test_full_and_patch_modes_reconstruct_identical_screens(
    engine_path: str, view_path: str
) -> None:
    script = [
        command_to_json(CharCommand(char="payments")),
        command_to_json(KeyCommand(key="tab")),
        command_to_json(KeyCommand(key="right")),
        command_to_json(KeyCommand(key="enter")),
        command_to_json(KeyCommand(key="tab")),
        command_to_json(CharCommand(char="Rollback started")),
        command_to_json(KeyCommand(key="enter", modifiers=KeyModifiers(ctrl=True))),
        command_to_json(ScrollCommand(rows=2)),
        command_to_json(KeyCommand(key="tab")),
        command_to_json(KeyCommand(key="enter")),
        command_to_json(KeyCommand(key="tab")),
    ]
    full = run_scripted_session(engine_path, view_path, script, patches=False)
    patched = run_scripted_session(engine_path, view_path, script, patches=True)
    assert patched.screens == full.screens
    assert patched.saw_patch
    assert not full.saw_patch


def test_resize_preserves_state_and_resynchronizes_patch_mode(
    engine_path: str, view_path: str
) -> None:
    with spawn_session(engine_path, view_path) as session:
        screen = ScreenBuffer(PreferredFrame.PLAIN)
        first = session.next_event()
        assert isinstance(first, (FullFrame, PatchFrame))
        screen.apply(first)
        session.send(ConfigureCommand(frames="plain", mode="patches"))
        screen.apply(session.next_frame())
        session.send(CharCommand(char="payments"))
        typed = session.next_frame()
        assert isinstance(typed, PatchFrame)
        screen.apply(typed)
        session.send(KeyCommand(key="left"))
        screen.apply(session.next_frame())
        session.send({"type": "resize", "width": 20, "height": 10})
        resized = session.next_frame()
        assert isinstance(resized, FullFrame)
        assert resized.focused_id == "service"
        screen.apply(resized)
        assert "[payment▏s]" in screen.text()
        session.send(CharCommand(char="!"))
        after = session.next_frame()
        assert isinstance(after, PatchFrame)
        screen.apply(after)
        assert "[payment!▏s]" in screen.text()
        session.send(ExitCommand())
        from teml_host.types import ExitEvent

        assert isinstance(session.next_event(), ExitEvent)
        assert session.wait(timeout=10) == 0


def test_richer_keys_and_modifiers_round_trip(engine_path: str, view_path: str) -> None:
    with spawn_session(engine_path, view_path) as session:
        screen = ScreenBuffer(PreferredFrame.PLAIN)
        screen.apply(session.next_event())
        session.send(ConfigureCommand(frames="plain", mode="patches"))
        screen.apply(session.next_frame())
        session.send({"type": "resize", "width": 40, "height": 6})
        screen.apply(session.next_frame())
        session.send(CharCommand(char="api-gateway"))
        screen.apply(session.next_frame())
        session.send(KeyCommand(key="home"))
        screen.apply(session.next_frame())
        assert "[▏api-gateway]" in screen.text()
        session.send(KeyCommand(key="delete"))
        screen.apply(session.next_frame())
        assert "[▏pi-gateway]" in screen.text()
        session.send(KeyCommand(key="enter", modifiers=KeyModifiers(ctrl=True)))
        screen.apply(session.next_frame())
        assert "[▏pi-gateway]" in screen.text()
        session.send(KeyCommand(key="f12"))
        screen.apply(session.next_frame())
        session.send(KeyCommand(key="down"))
        focused = session.next_frame()
        assert focused.focused_id == "severity"
        screen.apply(focused)
        session.send(KeyCommand(key="pageDown"))
        screen.apply(session.next_frame())
        assert screen.viewport is not None
        session.send(KeyCommand(key="pageUp"))
        screen.apply(session.next_frame())
        session.send(ExitCommand())
        from teml_host.types import ExitEvent

        assert isinstance(session.next_event(), ExitEvent)
        assert session.wait(timeout=10) == 0


def test_pointer_columns_activate_intended_grid_button(engine_path: str, view_path: str) -> None:
    with spawn_session(engine_path, view_path) as session:
        session.next_event()
        session.send(
            RenderCommand(
                format="teml",
                markup=(
                    ':::grid{columns="2" gap="2"}\n'
                    '::button{id="left" label="Left"}\n'
                    '::button{id="right" label="Right"}\n'
                    ":::"
                ),
            )
        )
        rendered = session.next_frame()
        assert isinstance(rendered, FullFrame)
        assert rendered.plain is not None
        row = next(
            index
            for index, line in enumerate(rendered.plain.splitlines())
            if "[ Right ]" in line
        )
        col = rendered.plain.splitlines()[row].index("[ Right ]")
        session.send(PointerCommand(row=row, col=col))
        clicked = session.next_event()
        assert isinstance(clicked, ClickEvent)
        assert clicked.id == "right"
        assert session.next_event().focused_id == "right"
        session.send(ExitCommand())
        from teml_host.types import ExitEvent

        assert isinstance(session.next_event(), ExitEvent)
        assert session.wait(timeout=10) == 0


def test_update_command_mutates_progress_in_place(engine_path: str, view_path: str) -> None:
    with Session.spawn(view_path, width=48, no_color=True, engine=engine_path) as session:
        bootstrap = session.next_event()
        assert isinstance(bootstrap, FullFrame)
        session.send(ConfigureCommand(frames="plain", mode="patches"))
        session.next_frame()
        session.send(
            RenderCommand(
                format="teml",
                markup=(
                    '::progress{id="deploy" label="Deploy" value="0" max="100"}\n'
                    '::metric{id="cpu" label="CPU" value="10%"}'
                ),
            )
        )
        first = session.next_frame()
        assert isinstance(first, FullFrame)
        if first.protocol is not None:
            assert first.protocol.major == PROTOCOL_VERSION.major
            assert first.protocol.minor >= 2
        assert "update" in first.capabilities
        screen = ScreenBuffer(PreferredFrame.PLAIN)
        screen.apply(first)
        session.send(UpdateCommand(id="deploy", props={"value": "50"}))
        screen.apply(session.next_frame())
        assert "50" in screen.text()
        session.send(UpdateCommand(id="cpu", props={"value": "42%", "change": "+5%"}))
        screen.apply(session.next_frame())
        assert "42%" in screen.text()
        session.send(ExitCommand())
        from teml_host.types import ExitEvent

        assert isinstance(session.next_event(), ExitEvent)
        assert session.wait(timeout=10) == 0


def test_document_mutation_commands_reconstruct_frames(
    engine_path: str, view_path: str
) -> None:
    with Session.spawn(view_path, width=48, no_color=True, engine=engine_path) as session:
        session.next_event()
        session.send(ConfigureCommand(frames="plain", mode="patches"))
        session.next_frame()
        session.send(
            RenderCommand(
                format="teml",
                markup=(
                    ':::scroll{id="logs" rows="3"}\nFirst\n:::\n\n'
                    ':::card{id="summary" title="Summary"}\nPending\n:::'
                ),
            )
        )
        first = session.next_frame()
        assert isinstance(first, FullFrame)
        assert "documentMutations" in first.capabilities
        screen = ScreenBuffer(PreferredFrame.PLAIN)
        screen.apply(first)

        session.send(AppendCommand(target="logs", markup="Second"))
        appended = session.next_frame()
        assert isinstance(appended, PatchFrame)
        screen.apply(appended)
        assert "Second" in screen.text()

        session.send(
            ReplaceCommand(
                target="summary",
                markup=':::card{id="summary" title="Summary"}\nComplete\n:::',
            )
        )
        replaced = session.next_frame()
        assert isinstance(replaced, FullFrame)
        screen.apply(replaced)
        assert "Complete" in screen.text()

        session.send(RemoveCommand(target="summary"))
        removed = session.next_frame()
        assert isinstance(removed, FullFrame)
        screen.apply(removed)
        assert "Complete" not in screen.text()


def test_missing_engine_fails() -> None:
    with pytest.raises(FileNotFoundError):
        from teml_host.engine import resolve_engine

        resolve_engine("/nonexistent/teml-engine.js")


def test_ndjson_line_guard(engine_path: str, view_path: str) -> None:
    with Session.spawn(view_path, width=40, height=10, engine=engine_path) as session:
        session.next_event()
        oversized = "x" * (8 * 1024 * 1024 + 1)
        with pytest.raises(SessionError, match="exceeds the 8388608-byte"):
            session.send({"type": "char", "char": oversized})
