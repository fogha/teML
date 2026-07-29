"""POSIX terminal lifecycle helpers (stdlib-only)."""

from __future__ import annotations

import os
import sys
import termios
import tty
from dataclasses import dataclass
from typing import Final, TextIO

from .types import KeyCommand, PointerCommand, ScrollCommand

EXPERIMENTAL_WINDOWS: Final = sys.platform == "win32"
_ENABLE_MOUSE: Final = "\x1b[?1000h\x1b[?1006h"
_DISABLE_MOUSE: Final = "\x1b[?1006l\x1b[?1000l"


class TerminalError(RuntimeError):
    pass


def require_posix_tty() -> None:
    if EXPERIMENTAL_WINDOWS:
        raise TerminalError(
            "Windows console support is experimental; use WSL or a POSIX terminal"
        )
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        raise TerminalError(
            "teml_host needs a real terminal — run it directly, not piped"
        )


@dataclass(slots=True)
class TermGuard:
    """Enable cbreak/raw mode and restore terminal settings on exit."""

    _stdin_fd: int
    _original: list[termios._AttrReturn | None]

    @classmethod
    def enter(cls) -> TermGuard:
        require_posix_tty()
        fd = sys.stdin.fileno()
        original = termios.tcgetattr(fd)
        tty.setraw(fd)
        return cls(_stdin_fd=fd, _original=[original])

    def __enter__(self) -> TermGuard:
        return self

    def __exit__(self, *_exc: object) -> None:
        self.restore()

    def restore(self) -> None:
        original = self._original[0]
        if original is not None:
            termios.tcsetattr(self._stdin_fd, termios.TCSADRAIN, original)
            self._original[0] = None


@dataclass(slots=True)
class MouseGuard:
    """Enable SGR mouse reporting and reliably disable it on exit."""

    _output: TextIO
    _enabled: bool = True

    @classmethod
    def enter(cls, output: TextIO | None = None) -> MouseGuard:
        stream = output or sys.stdout
        stream.write(_ENABLE_MOUSE)
        stream.flush()
        return cls(stream)

    def __enter__(self) -> MouseGuard:
        return self

    def __exit__(self, *_exc: object) -> None:
        self.restore()

    def restore(self) -> None:
        if self._enabled:
            self._output.write(_DISABLE_MOUSE)
            self._output.flush()
            self._enabled = False


def terminal_size() -> tuple[int, int]:
    try:
        columns, rows = os.get_terminal_size()
    except OSError as exc:
        raise TerminalError(f"unable to read terminal size: {exc}") from exc
    return max(columns, 1), max(rows, 1)


def decode_sgr_mouse(data: bytes) -> PointerCommand | ScrollCommand | None:
    """Decode one complete SGR mouse press, converting cells to zero-based."""
    if not data.startswith(b"\x1b[<") or not data.endswith(b"M"):
        return None
    try:
        button, col, row = (int(part) for part in data[3:-1].split(b";"))
    except (TypeError, ValueError):
        return None
    if row < 1 or col < 1:
        return None
    if button & 64:
        if button & 3 <= 1:
            return ScrollCommand(rows=-3 if button & 1 == 0 else 3)
        return None
    return PointerCommand(row=row - 1, col=col - 1)


def map_scroll(rows: int, supports_scroll: bool) -> ScrollCommand | KeyCommand:
    """Gate scroll commands with the protocol's PageUp/PageDown fallback."""
    if supports_scroll:
        return ScrollCommand(rows=rows)
    return KeyCommand(key="pageUp" if rows < 0 else "pageDown")
