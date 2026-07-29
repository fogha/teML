"""Host-side full/patch frame reconstruction."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any

from teml_host.types import (
    FrameEvent,
    FullFrame,
    PatchFrame,
    ProtocolVersion,
    ScrollRegionMeta,
    ViewportMeta,
    frame_as_dict,
)


class PreferredFrame(str, Enum):
    ANSI = "ansi"
    PLAIN = "plain"


@dataclass(slots=True)
class Viewport:
    offset: int
    height: int
    total: int


@dataclass(slots=True)
class ScrollRegion:
    id: str
    offset: int
    height: int
    total: int


class ScreenBuffer:
    __slots__ = (
        "preferred",
        "rows",
        "last_seq",
        "focused_id",
        "viewport",
        "scroll_regions",
        "protocol",
        "capabilities",
    )

    def __init__(self, preferred: PreferredFrame = PreferredFrame.ANSI) -> None:
        self.preferred = preferred
        self.rows: list[str] = []
        self.last_seq = 0
        self.focused_id: str | None = None
        self.viewport: Viewport | None = None
        self.scroll_regions: list[ScrollRegion] = []
        self.protocol: ProtocolVersion | None = None
        self.capabilities: list[str] = []

    def apply(self, frame: FrameEvent | dict[str, Any]) -> None:
        if isinstance(frame, dict):
            from teml_host.types import parse_event

            parsed = parse_event(frame)
            if not isinstance(parsed, (FullFrame, PatchFrame)):
                raise ValueError("expected a frame event")
            self._apply_frame(parsed)
            return
        self._apply_frame(frame)

    def _apply_frame(self, frame: FrameEvent) -> None:
        if frame.seq <= self.last_seq:
            raise ValueError(
                f"non-monotonic frame sequence: {frame.seq} after {self.last_seq}"
            )

        if isinstance(frame, PatchFrame):
            if self.last_seq == 0:
                raise ValueError("patch frame arrived before a full frame")
            if frame.seq != self.last_seq + 1:
                raise ValueError(
                    f"patch frame sequence gap: expected {self.last_seq + 1}, got {frame.seq}"
                )
            for patch in frame.patches:
                if patch.row < 0 or patch.row >= frame.rows:
                    raise ValueError(
                        f"patch row {patch.row} is outside the {frame.rows}-row frame"
                    )
                text = _payload(patch, self.preferred)
                if text is None:
                    raise ValueError(f"patch row {patch.row} has no usable payload")
                if len(self.rows) <= patch.row:
                    self.rows.extend([""] * (patch.row + 1 - len(self.rows)))
                self.rows[patch.row] = text
            if len(self.rows) > frame.rows:
                del self.rows[frame.rows :]
            elif len(self.rows) < frame.rows:
                self.rows.extend([""] * (frame.rows - len(self.rows)))
        else:
            rendered = _payload(frame, self.preferred)
            if rendered is None:
                raise ValueError("full frame has no usable payload")
            self.rows = _split_rows(rendered)

        self.viewport = _parse_viewport(frame.viewport, len(self.rows))
        self.scroll_regions = _parse_scroll_regions(frame.scroll_regions)
        self.focused_id = frame.focused_id
        if isinstance(frame, FullFrame):
            self.protocol = frame.protocol
            self.capabilities = list(frame.capabilities)
        self.last_seq = frame.seq

    def text(self) -> str:
        return "\n".join(self.rows)

    def has_capability(self, capability: str) -> bool:
        return capability in self.capabilities


def _payload(record: Any, preferred: PreferredFrame) -> str | None:
    first = preferred.value
    plain = getattr(record, "plain", None)
    ansi = getattr(record, "ansi", None)
    if first == PreferredFrame.ANSI.value:
        if isinstance(ansi, str):
            return ansi
        if isinstance(plain, str):
            return plain
        return None
    if isinstance(plain, str):
        return plain
    if isinstance(ansi, str):
        return ansi
    return None


def _split_rows(rendered: str) -> list[str]:
    if rendered == "":
        return []
    trimmed = rendered[:-1] if rendered.endswith("\n") else rendered
    return trimmed.split("\n")


def _parse_viewport(meta: ViewportMeta | None, row_count: int) -> Viewport | None:
    if meta is None:
        return None
    if (
        meta.offset < 0
        or meta.height < 1
        or meta.total < meta.height
        or meta.offset + meta.height > meta.total
        or meta.height != row_count
    ):
        raise ValueError("invalid frame viewport bounds")
    return Viewport(offset=meta.offset, height=meta.height, total=meta.total)


def _parse_scroll_regions(
    regions: tuple[ScrollRegionMeta, ...],
) -> list[ScrollRegion]:
    parsed: list[ScrollRegion] = []
    for region in regions:
        if region.height == 0 or region.offset > max(0, region.total - region.height):
            raise ValueError("invalid scroll region bounds")
        parsed.append(
            ScrollRegion(
                id=region.id,
                offset=region.offset,
                height=region.height,
                total=region.total,
            )
        )
    return parsed


def frame_dict_for_apply(frame: FrameEvent) -> dict[str, Any]:
    return frame_as_dict(frame)
