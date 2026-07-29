"""POSIX terminal lifecycle helpers (stdlib-only)."""

from __future__ import annotations

import os
import select
import signal
import sys
import termios
import tty
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Final, Protocol, TextIO

from .types import (
    CharCommand,
    Command,
    ExitCommand,
    KeyCommand,
    KeyModifiers,
    KeyName,
    PointerCommand,
    ScrollCommand,
    resize_command,
)

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


CSI = "\x1b["
_RESIZE_DEBOUNCE = 0.05


class TerminalEvents(Protocol):
    def poll(self, timeout: float) -> bool: ...

    def read_bytes(self) -> bytes: ...

    def read_until_idle(self, first: bytes, idle_seconds: float = 0.02) -> bytes: ...

    def size(self) -> tuple[int, int]: ...

    def take_resize(self) -> bool: ...


@dataclass(slots=True)
class PosixStdinEvents:
    """Blocking stdin reader with SIGWINCH resize notifications."""

    _pending_resize: bool = field(default=False, init=False)

    def __post_init__(self) -> None:
        signal.signal(signal.SIGWINCH, self._on_winch)

    def _on_winch(self, _signum: int, _frame: object) -> None:
        self._pending_resize = True

    def poll(self, timeout: float) -> bool:
        if self._pending_resize:
            return True
        ready, _, _ = select.select([sys.stdin], [], [], timeout)
        return bool(ready)

    def read_bytes(self) -> bytes:
        data = os.read(sys.stdin.fileno(), 1)
        if not data:
            raise EOFError("terminal closed")
        return data

    def read_until_idle(self, first: bytes, idle_seconds: float = 0.02) -> bytes:
        sequence = first
        while True:
            ready, _, _ = select.select([sys.stdin], [], [], idle_seconds)
            if not ready:
                return sequence
            chunk = os.read(sys.stdin.fileno(), 4096)
            if not chunk:
                raise EOFError("terminal closed")
            sequence += chunk

    def size(self) -> tuple[int, int]:
        return terminal_size()

    def take_resize(self) -> bool:
        if self._pending_resize:
            self._pending_resize = False
            return True
        return False


@dataclass(slots=True)
class ScriptedStdinEvents:
    """Deterministic byte source for headless driver tests."""

    queued: deque[bytes]
    terminal_size: tuple[int, int] = (60, 20)

    @classmethod
    def typing(cls, text: str, *, size: tuple[int, int] = (60, 20)) -> ScriptedStdinEvents:
        return cls(queued=deque(char.encode("utf-8") for char in text), terminal_size=size)

    @classmethod
    def chunks(cls, chunks: list[bytes], *, size: tuple[int, int] = (60, 20)) -> ScriptedStdinEvents:
        return cls(queued=deque(chunks), terminal_size=size)

    def poll(self, timeout: float) -> bool:
        del timeout
        return bool(self.queued)

    def read_bytes(self) -> bytes:
        if not self.queued:
            raise EOFError("script exhausted")
        return self.queued.popleft()

    def read_until_idle(self, first: bytes, idle_seconds: float = 0.02) -> bytes:
        del idle_seconds
        sequence = first
        while self.queued:
            sequence += self.queued.popleft()
        return sequence

    def size(self) -> tuple[int, int]:
        return self.terminal_size

    def take_resize(self) -> bool:
        return False


def _key_command(
    key: KeyName,
    *,
    ctrl: bool = False,
    alt: bool = False,
    shift: bool = False,
) -> Command:
    modifiers = KeyModifiers(ctrl=ctrl, alt=alt, shift=shift)
    if ctrl or alt or shift:
        return KeyCommand(key=key, modifiers=modifiers)
    return KeyCommand(key=key)


def map_terminal_bytes(
    data: bytes,
    read_until_idle: Callable[[bytes], bytes],
) -> Command | None:
    if not data:
        return None
    mouse = decode_sgr_mouse(data)
    if mouse is not None:
        return mouse
    if data[0] == 3:
        return ExitCommand()
    if data[0] == 9:
        return _key_command("tab")
    if data == b"\x1b[Z":
        return _key_command("shiftTab")
    if data[0] in (13, 10):
        return _key_command("enter")
    if data[0] == 127:
        return _key_command("backspace")
    if data == b"\x1b":
        data = read_until_idle(data)
    if data.startswith(b"\x1b"):
        seq = data.decode("utf-8", errors="replace")
        mapping: dict[str, KeyName] = {
            f"{CSI}A": "up",
            f"{CSI}B": "down",
            f"{CSI}D": "left",
            f"{CSI}C": "right",
            f"{CSI}H": "home",
            f"{CSI}F": "end",
            f"{CSI}3~": "delete",
            f"{CSI}5~": "pageUp",
            f"{CSI}6~": "pageDown",
            f"\x1bOA": "up",
            f"\x1bOB": "down",
            f"\x1bOD": "left",
            f"\x1bOC": "right",
            f"\x1bOH": "home",
            f"\x1bOF": "end",
        }
        for index in range(1, 13):
            mapping[f"{CSI}{index}~"] = f"f{index}"  # type: ignore[assignment]
        if seq in mapping:
            return _key_command(mapping[seq])
        if seq == f"{CSI}1;5H":
            return _key_command("home", ctrl=True)
        return None
    if len(data) == 1 and data[0] < 32:
        letter = chr(data[0] + 96)
        if letter == "c":
            return ExitCommand()
        if letter == "m":
            return _key_command("enter", ctrl=True)
        return _key_command(letter, ctrl=True)  # type: ignore[arg-type]
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return None
    if not text or text == "\x03":
        return ExitCommand()
    return CharCommand(char=text)


@dataclass(slots=True)
class TerminalInput:
    """Coalesced resize translation from terminal bytes to protocol commands."""

    events: PosixStdinEvents | ScriptedStdinEvents
    last_size: tuple[int, int]
    supports_scroll: bool
    _pending: bytes | None = field(default=None, init=False)

    def next_command(self) -> Command | None:
        if self._pending is not None:
            data = self._pending
            self._pending = None
        else:
            if not self.events.poll(0.05):
                return None
            if self.events.take_resize():
                return self._coalesced_resize()
            data = self.events.read_bytes()

        command = map_terminal_bytes(data, self.events.read_until_idle)
        if command is None:
            return None
        if isinstance(command, ScrollCommand):
            if self.supports_scroll:
                return command
            return map_scroll(command.rows, supports_scroll=False)
        return command

    def _coalesced_resize(self) -> Command | None:
        deadline = _RESIZE_DEBOUNCE
        while self.events.poll(deadline):
            if self.events.take_resize():
                deadline = _RESIZE_DEBOUNCE
                continue
            self._pending = self.events.read_bytes()
            break
        size = self.events.size()
        if size == self.last_size:
            return None
        self.last_size = size
        return resize_command(size[0], size[1])
