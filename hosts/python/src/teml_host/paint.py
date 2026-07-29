"""ONLCR-safe terminal painting."""

from __future__ import annotations

import sys
from typing import TextIO

from teml_host.screen import ScreenBuffer

_CLEAR_ALL = "\x1b[2J\x1b[H"


def paint(screen: ScreenBuffer, stream: TextIO | None = None) -> None:
    out = stream or sys.stdout
    out.write(_CLEAR_ALL)
    out.write(screen.text().replace("\n", "\r\n"))
    out.flush()
