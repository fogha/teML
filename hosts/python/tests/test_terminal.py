from __future__ import annotations

from io import StringIO

from teml_host import (
    KeyCommand,
    MouseGuard,
    PointerCommand,
    ScrollCommand,
    decode_sgr_mouse,
    map_scroll,
)


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
