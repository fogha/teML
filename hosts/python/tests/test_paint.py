"""Paint helper tests."""

from __future__ import annotations

import io

from teml_host import FullFrame, PreferredFrame, ScreenBuffer, paint


def test_paint_expands_newlines_for_onlcr() -> None:
    screen = ScreenBuffer(PreferredFrame.PLAIN)
    screen.apply(FullFrame(seq=1, focused_id=None, plain="one\ntwo\n", ansi=None))
    buffer = io.StringIO()
    paint(screen, buffer)
    assert buffer.getvalue().endswith("one\r\ntwo")
