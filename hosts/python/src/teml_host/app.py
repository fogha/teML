"""Handler-driven application loop."""

from __future__ import annotations

import sys
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol, TypeAlias

from teml_host.paint import paint
from teml_host.screen import PreferredFrame, ScreenBuffer
from teml_host.session import Session, SessionError
from teml_host.terminal import (
    MouseGuard,
    TermGuard,
    TerminalError,
    TerminalEvents,
    TerminalInput,
    PosixStdinEvents,
    terminal_size,
)
from teml_host.types import (
    AppendCommand,
    ChangeEvent,
    ClickEvent,
    Command,
    DocFormat,
    ErrorEvent,
    ExitCommand,
    ExitEvent,
    FullFrame,
    PatchFrame,
    RemoveCommand,
    RenderCommand,
    ReplaceCommand,
    ToggleEvent,
)

Values: TypeAlias = dict[str, str]


class Context:
    """Lets a handler act on the running session without reaching into internals."""

    __slots__ = ("_values", "_queued", "_exit")

    def __init__(
        self,
        values: Values,
        queued: deque[Command],
        exit_flag: list[bool],
    ) -> None:
        self._values = values
        self._queued = queued
        self._exit = exit_flag

    def exit(self) -> None:
        self._exit[0] = True

    def render(self, markup: str, format: DocFormat | None = None) -> None:
        self._queued.append(RenderCommand(markup=markup, format=format))

    def replace(
        self,
        target: str,
        markup: str,
        format: DocFormat | None = None,
    ) -> None:
        self._queued.append(
            ReplaceCommand(target=target, markup=markup, format=format)
        )

    def append(
        self,
        target: str,
        markup: str,
        format: DocFormat | None = None,
    ) -> None:
        self._queued.append(
            AppendCommand(target=target, markup=markup, format=format)
        )

    def remove(self, target: str) -> None:
        self._queued.append(RemoveCommand(target=target))

    @property
    def values(self) -> Values:
        return self._values


OnChange = Callable[[str, str, Context], None]
OnToggle = Callable[[str, bool, Context], None]
OnClick = Callable[[str, Values, Context], None]
OnError = Callable[[str, Context], None]


@dataclass(frozen=True, slots=True)
class _Handlers:
    on_change: OnChange | None = None
    on_toggle: OnToggle | None = None
    on_click: OnClick | None = None
    on_error: OnError | None = None


class _CommandSource(Protocol):
    def next_command(self) -> Command | None: ...


def run(
    document: str,
    *,
    on_change: OnChange | None = None,
    on_toggle: OnToggle | None = None,
    on_click: OnClick | None = None,
    on_error: OnError | None = None,
    width: int | None = None,
    height: int | None = None,
    frames: str | None = "ansi",
    mode: str | None = "patches",
    no_color: bool = False,
    engine: str | None = None,
) -> Values:
    """Run handlers against this process's terminal."""
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        raise TerminalError(
            "teml_host.run needs a real terminal on stdin and stdout; "
            "use run_headless otherwise"
        )
    size = terminal_size()
    spawn_width = width if width is not None else size[0]
    spawn_height = height if height is not None else size[1]
    handlers = _Handlers(on_change, on_toggle, on_click, on_error)
    with Session.spawn(
        document,
        width=spawn_width,
        height=spawn_height,
        frames=frames,
        mode=mode,
        no_color=no_color,
        engine=engine,
    ) as session, TermGuard.enter(), MouseGuard.enter():
        screen, supports_scroll = _start(session)
        paint(screen)
        events = PosixStdinEvents()
        input_source = TerminalInput(events, size, supports_scroll)
        return _drive(session, screen, input_source, handlers, do_paint=True)


def run_headless(
    document: str,
    *,
    on_change: OnChange | None = None,
    on_toggle: OnToggle | None = None,
    on_click: OnClick | None = None,
    on_error: OnError | None = None,
    events: TerminalEvents,
    size: tuple[int, int],
    width: int | None = None,
    height: int | None = None,
    frames: str | None = "ansi",
    mode: str | None = "patches",
    no_color: bool = True,
    engine: str | None = None,
) -> Values:
    """The same loop without raw mode or painting, driven by an injected source."""
    spawn_width = width if width is not None else size[0]
    spawn_height = height if height is not None else size[1]
    handlers = _Handlers(on_change, on_toggle, on_click, on_error)
    with Session.spawn(
        document,
        width=spawn_width,
        height=spawn_height,
        frames=frames,
        mode=mode,
        no_color=no_color,
        engine=engine,
    ) as session:
        screen, supports_scroll = _start(session)
        input_source = TerminalInput(events, size, supports_scroll)
        return _drive(session, screen, input_source, handlers, do_paint=False)


def _start(session: Session) -> tuple[ScreenBuffer, bool]:
    first = session.next_event()
    if not isinstance(first, (FullFrame, PatchFrame)):
        raise SessionError("protocol violation: expected initial frame")
    supports_scroll = (
        isinstance(first, FullFrame) and "scroll" in first.capabilities
    )
    screen = ScreenBuffer(PreferredFrame.ANSI)
    screen.apply(first)
    return screen, supports_scroll


def _drive(
    session: Session,
    screen: ScreenBuffer,
    input_source: _CommandSource,
    handlers: _Handlers,
    *,
    do_paint: bool,
) -> Values:
    values: Values = {}
    queued: deque[Command] = deque()
    exit_flag = [False]

    while True:
        if queued:
            command = queued.popleft()
        elif exit_flag[0]:
            command = ExitCommand()
        else:
            command = input_source.next_command()
            if command is None:
                continue

        closing = isinstance(command, ExitCommand)
        session.send(command)
        if closing:
            _drain_after_exit(session)
            return values

        while True:
            # A transport failure mid-session is a real error, not an ordinary
            # end; only the post-exit drain tolerates a closed pipe.
            event = session.next_event()
            if isinstance(event, (FullFrame, PatchFrame)):
                screen.apply(event)
                if do_paint:
                    paint(screen)
                break
            if isinstance(event, ChangeEvent):
                values[event.id] = event.value
                ctx = Context(values, queued, exit_flag)
                if handlers.on_change is not None:
                    handlers.on_change(event.id, event.value, ctx)
            elif isinstance(event, ToggleEvent):
                values[event.id] = str(event.checked).lower()
                ctx = Context(values, queued, exit_flag)
                if handlers.on_toggle is not None:
                    handlers.on_toggle(event.id, event.checked, ctx)
            elif isinstance(event, ClickEvent):
                values = dict(event.values)
                ctx = Context(values, queued, exit_flag)
                if handlers.on_click is not None:
                    handlers.on_click(event.id, values, ctx)
            elif isinstance(event, ErrorEvent):
                ctx = Context(values, queued, exit_flag)
                if handlers.on_error is not None:
                    handlers.on_error(event.message, ctx)
            elif isinstance(event, ExitEvent):
                return values


def _drain_after_exit(session: Session) -> None:
    while True:
        try:
            event = session.next_event()
        except SessionError:
            return
        if isinstance(event, ExitEvent):
            return
