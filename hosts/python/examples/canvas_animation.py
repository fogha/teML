#!/usr/bin/env python3
"""PROTOTYPE: Python-driven animation through the shared canvas protocol."""

from __future__ import annotations

import time
from pathlib import Path

from teml_host.app import _start
from teml_host.paint import paint
from teml_host.session import Session
from teml_host.types import (
    CanvasCommand,
    CanvasOperation,
    ClearOperation,
    FillRectOperation,
    FillStyleOperation,
)


class Canvas:
    def __init__(self, canvas_id: str) -> None:
        self.id = canvas_id
        self.ops: list[CanvasOperation] = []

    def clear(self) -> None:
        self.ops.append(ClearOperation())

    def fill_style(self, color: str) -> None:
        self.ops.append(FillStyleOperation(color=color))

    def fill_rect(self, x: int, y: int, width: int, height: int) -> None:
        self.ops.append(FillRectOperation(x=x, y=y, width=width, height=height))

    def present(self) -> CanvasCommand:
        command = CanvasCommand(id=self.id, ops=tuple(self.ops))
        self.ops.clear()
        return command


def main() -> None:
    view = Path(__file__).resolve().parents[3] / "examples" / "apps" / "canvas" / "animation.html"
    particles = [
        {"x": 2, "y": 2, "dx": 1, "dy": 1, "color": "#50fa7b"},
        {"x": 36, "y": 10, "dx": -1, "dy": -1, "color": "#ff5555"},
        {"x": 20, "y": 4, "dx": 1, "dy": -1, "color": "#8be9fd"},
    ]
    canvas = Canvas("game")
    with Session.spawn(str(view), width=80, height=24, frames="ansi", mode="patches") as session:
        screen, _ = _start(session)
        paint(screen)
        try:
            while True:
                canvas.clear()
                for particle in particles:
                    if particle["x"] <= 0 or particle["x"] >= 46:
                        particle["dx"] *= -1
                    if particle["y"] <= 0 or particle["y"] >= 14:
                        particle["dy"] *= -1
                    particle["x"] += particle["dx"]
                    particle["y"] += particle["dy"]
                    canvas.fill_style(str(particle["color"]))
                    canvas.fill_rect(
                        int(particle["x"]), int(particle["y"]), 2, 2
                    )
                session.send(canvas.present())
                screen.apply(session.next_frame())
                paint(screen)
                time.sleep(0.066)
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
