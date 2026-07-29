#!/usr/bin/env python3
"""Incident handoff example — HTML view + Python controller + TeML runtime."""

from __future__ import annotations

import os
import select
import signal
import sys
from pathlib import Path
from typing import Any

from teml_host import (
    CharCommand,
    ClickEvent,
    ErrorEvent,
    ExitCommand,
    ExitEvent,
    KeyCommand,
    KeyModifiers,
    MouseGuard,
    PreferredFrame,
    RenderCommand,
    ScreenBuffer,
    Session,
    TermGuard,
    command_to_json,
    decode_sgr_mouse,
    map_scroll,
    paint,
    require_posix_tty,
    resize_command,
)
from teml_host.types import FullFrame, KeyName, PatchFrame

VIEW = Path(__file__).with_name("view.html")

CSI = "\x1b["


def validate(values: dict[str, str]) -> str | None:
    service = values.get("service", "").strip()
    summary = values.get("summary", "").strip()
    if not service:
        return "Affected service is required."
    if not summary:
        return "Operator summary is required."
    return None


def screen_html(error: str) -> str:
    base = VIEW.read_text(encoding="utf-8")
    return base.replace("</h2>", f'</h2>\n<div class="alert alert-danger">{error}</div>')


def key_command(
    key: KeyName,
    *,
    ctrl: bool = False,
    alt: bool = False,
    shift: bool = False,
) -> dict[str, Any]:
    modifiers = KeyModifiers(ctrl=ctrl, alt=alt, shift=shift)
    if ctrl or alt or shift:
        return command_to_json(KeyCommand(key=key, modifiers=modifiers))
    return command_to_json(KeyCommand(key=key))


def read_bytes(count: int = 1) -> bytes:
    data = os.read(sys.stdin.fileno(), count)
    if not data:
        raise EOFError("terminal closed")
    return data


def read_until_idle(first: bytes, idle_seconds: float = 0.02) -> bytes:
    sequence = first
    while True:
        ready, _, _ = select.select([sys.stdin], [], [], idle_seconds)
        if not ready:
            return sequence
        sequence += read_bytes()


def map_terminal_bytes(data: bytes) -> dict[str, Any] | None:
    if not data:
        return None
    mouse = decode_sgr_mouse(data)
    if mouse is not None:
        return command_to_json(mouse)
    if data[0] == 3:
        return command_to_json(ExitCommand())
    if data[0] == 9:
        return key_command("tab")
    if data == b"\x1b[Z":
        return key_command("shiftTab")
    if data[0] in (13, 10):
        return key_command("enter")
    if data[0] == 127:
        return key_command("backspace")
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
            return key_command(mapping[seq])
        if seq == f"{CSI}1;5H":
            return key_command("home", ctrl=True)
        return None
    if len(data) == 1 and data[0] < 32:
        letter = chr(data[0] + 96)
        if letter == "c":
            return command_to_json(ExitCommand())
        if letter == "m":
            return key_command("enter", ctrl=True)
        return key_command(letter, ctrl=True)  # type: ignore[arg-type]
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return None
    if not text or text == "\x03":
        return command_to_json(ExitCommand())
    return command_to_json(CharCommand(char=text))


def terminal_size() -> tuple[int, int]:
    size = os.get_terminal_size()
    return max(size.columns, 1), max(size.lines, 1)


def event_loop(session: Session, screen: ScreenBuffer, supports_scroll: bool) -> str | None:
    done: str | None = None
    pending_resize = False

    def on_winch(_signum: int, _frame: object) -> None:
        nonlocal pending_resize
        pending_resize = True

    signal.signal(signal.SIGWINCH, on_winch)

    while done is None:
        if pending_resize:
            pending_resize = False
            width, height = terminal_size()
            session.send(resize_command(width, height))
        ready, _, _ = select.select([sys.stdin], [], [], 0.05)
        if not ready:
            continue
        command = map_terminal_bytes(read_bytes())
        if command is None:
            continue
        if command.get("type") == "scroll" and not supports_scroll:
            rows = int(command.get("rows", 0))
            command = command_to_json(map_scroll(rows, supports_scroll=False))
        session.send(command)
        while True:
            event = session.next_event()
            if isinstance(event, (FullFrame, PatchFrame)):
                screen.apply(event)
                paint(screen)
                if done is None:
                    break
            elif isinstance(event, ClickEvent):
                if event.id == "cancel":
                    done = "Cancelled — no incident handoff sent."
                    session.send(ExitCommand())
                elif event.id == "submit":
                    error = validate(event.values)
                    if error is None:
                        values = event.values
                        done = (
                            "Incident handoff sent!\n"
                            f"  service:  {values.get('service', '')}\n"
                            f"  severity: {values.get('severity', '')}\n"
                            f"  summary:  {values.get('summary', '').replace(chr(10), ' / ')}\n"
                            f"  paged:    {'yes' if values.get('page') == 'true' else 'no'}"
                        )
                        session.send(ExitCommand())
                    else:
                        session.send(RenderCommand(markup=screen_html(error), format="html"))
            elif isinstance(event, ErrorEvent):
                sys.stderr.write(f"\r\n[teml] {event.message}\r\n")
            elif isinstance(event, ExitEvent):
                return done
    return done


def main() -> int:
    require_posix_tty()
    width, height = terminal_size()
    with Session.spawn(
        str(VIEW),
        width=width,
        height=height,
        frames="ansi",
        mode="patches",
    ) as session, TermGuard.enter(), MouseGuard.enter():
        first = session.next_event()
        if not isinstance(first, (FullFrame, PatchFrame)):
            raise RuntimeError("protocol violation: expected initial frame")
        supports_scroll = "scroll" in first.capabilities if isinstance(first, FullFrame) else False
        screen = ScreenBuffer(PreferredFrame.ANSI)
        screen.apply(first)
        paint(screen)
        outcome = event_loop(session, screen, supports_scroll)
    if outcome:
        print(outcome)
    else:
        print("Session ended without submission.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
