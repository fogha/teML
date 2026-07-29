"""Command serialization tests."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from teml_host import (
    AppendCommand,
    ExitEvent,
    FullFrame,
    KeyCommand,
    PROTOCOL_VERSION,
    RemoveCommand,
    ReplaceCommand,
    UpdateCommand,
    UnknownEvent,
    command_to_json,
    map_scroll,
    parse_event,
)
from teml_host.protocol import CAPABILITY_DOCS, ENGINE_CAPABILITIES


def test_update_command_serializes_props() -> None:
    payload = command_to_json(
        UpdateCommand(id="deploy", props={"value": "73", "max": "100"})
    )
    assert payload == {
        "type": "update",
        "id": "deploy",
        "props": {"value": "73", "max": "100"},
    }


def test_protocol_constants_match_engine() -> None:
    assert PROTOCOL_VERSION.major == 1
    assert PROTOCOL_VERSION.minor == 3
    assert "update" in ENGINE_CAPABILITIES
    assert "documentMutations" in ENGINE_CAPABILITIES
    assert "update" in CAPABILITY_DOCS
    assert "documentMutations" in CAPABILITY_DOCS


def test_document_mutation_commands_serialize_fragments_and_targets() -> None:
    assert command_to_json(
        ReplaceCommand(target="summary", markup="**Complete**", format="markdown")
    ) == {
        "type": "replace",
        "target": "summary",
        "markup": "**Complete**",
        "format": "markdown",
    }
    assert command_to_json(AppendCommand(target="logs", markup="Next")) == {
        "type": "append",
        "target": "logs",
        "markup": "Next",
    }
    assert command_to_json(RemoveCommand(target="completed")) == {
        "type": "remove",
        "target": "completed",
    }


def test_unsupported_command_raises() -> None:
    class Unknown:
        pass

    with pytest.raises(TypeError, match="unsupported command"):
        command_to_json(Unknown())  # type: ignore[arg-type]


def test_decodes_shared_v1_conformance_transcript() -> None:
    path = (
        Path(__file__).resolve().parents[3]
        / "tests"
        / "system"
        / "snapshots"
        / "interactive-v1.ndjson"
    )
    events = [parse_event(json.loads(line)) for line in path.read_text().splitlines()]
    assert isinstance(events[0], FullFrame)
    assert isinstance(events[-1], ExitEvent)
    assert map_scroll(-3, supports_scroll="scroll" in events[0].capabilities) == KeyCommand(
        key="pageUp"
    )


def test_frame_tolerates_optional_metadata_and_unknown_fields() -> None:
    event = parse_event(
        {
            "type": "frame",
            "seq": 1,
            "focusedId": None,
            "plain": "ok\n",
            "ansi": None,
            "protocol": {"major": 1, "minor": 3},
            "capabilities": ["scroll", "future"],
            "futureCapabilityFlag": True,
        }
    )

    assert isinstance(event, FullFrame)
    assert event.protocol == PROTOCOL_VERSION
    assert event.capabilities == ("scroll", "future")


def test_unknown_event_types_remain_forward_compatible() -> None:
    event = parse_event({"type": "futureEvent", "payload": True})
    assert event == UnknownEvent(event_type="futureEvent")
