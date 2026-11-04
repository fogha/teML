from __future__ import annotations

from io import StringIO

import pytest

from teml_host import (
    CharCommand,
    ExitCommand,
    KeyCommand,
    MouseGuard,
    PointerCommand,
    ScrollCommand,
    decode_sgr_mouse,
    map_scroll,
)
from teml_host.terminal import ScriptedStdinEvents, TerminalInput


def test_sgr_pointer_coordinates_are_zero_based() -> None:
    assert decode_sgr_mouse(b"\x1b[<0;9;4M") == PointerCommand(row=3, col=8)


def test_vertical_sgr_wheel_maps_to_signed_scroll_rows() -> None:
    assert decode_sgr_mouse(b"\x1b[<64;9;4M") == ScrollCommand(rows=-3)
    assert decode_sgr_mouse(b"\x1b[<65;9;4M") == ScrollCommand(rows=3)


def test_invalid_or_horizontal_sgr_mouse_is_not_a_vertical_scroll() -> None:
    assert decode_sgr_mouse(b"not mouse") is None
    assert decode_sgr_mouse(b"\x1b[<66;9;4M") is None


def test_mouse_guard_disables_capture_once() -> None:
    output = StringIO()
    guard = MouseGuard.enter(output)
    guard.restore()
    guard.restore()
    assert output.getvalue() == "\x1b[?1000h\x1b[?1006h\x1b[?1006l\x1b[?1000l"


def test_scroll_falls_back_when_capability_is_missing() -> None:
    assert map_scroll(-3, supports_scroll=True) == ScrollCommand(rows=-3)
    assert map_scroll(-3, supports_scroll=False) == KeyCommand(key="pageUp")
    assert map_scroll(3, supports_scroll=False) == KeyCommand(key="pageDown")


def read_all(events: ScriptedStdinEvents) -> list[object]:
    source = TerminalInput(events, (60, 20), True)
    commands: list[object] = []
    while events.queued:
        command = source.next_command()
        if command is not None:
            commands.append(command)
    while True:
        command = source.next_command()
        if command is None:
            return commands
        commands.append(command)


def test_split_utf8_bytes_preserve_unicode_and_following_exit() -> None:
    events = ScriptedStdinEvents.chunks(
        [bytes([byte]) for byte in "Aé😀\x03".encode("utf-8")]
    )
    assert read_all(events) == [
        CharCommand(char="A"),
        CharCommand(char="é"),
        CharCommand(char="😀"),
        ExitCommand(),
    ]


def test_fragmented_and_consecutive_escape_sequences_keep_all_commands() -> None:
    wire = b"\x1b[<0;9;4M\x1b[Z\x1b[<64;9;4M\x1b[A\x1b"
    events = ScriptedStdinEvents.chunks([bytes([byte]) for byte in wire])
    assert read_all(events) == [
        PointerCommand(row=3, col=8),
        KeyCommand(key="shiftTab"),
        ScrollCommand(rows=-3),
        KeyCommand(key="up"),
        KeyCommand(key="escape"),
    ]


@pytest.mark.parametrize(
    ("sequence", "key"),
    [(b"\x1b[3~", "delete"), (b"\x1b[5~", "pageUp"), (b"\x1b[6~", "pageDown")],
)
def test_editing_and_page_keys_are_not_overwritten_by_function_keys(
    sequence: bytes, key: str
) -> None:
    events = ScriptedStdinEvents.chunks([sequence[:1], sequence[1:]])
    assert read_all(events) == [KeyCommand(key=key)]
