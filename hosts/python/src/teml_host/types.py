"""Typed wire messages for the TeML interactive NDJSON protocol."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, TypeAlias, Union, cast

KeyName: TypeAlias = Literal[
    "tab",
    "shiftTab",
    "enter",
    "backspace",
    "escape",
    "left",
    "right",
    "up",
    "down",
    "home",
    "end",
    "delete",
    "pageUp",
    "pageDown",
    "f1",
    "f2",
    "f3",
    "f4",
    "f5",
    "f6",
    "f7",
    "f8",
    "f9",
    "f10",
    "f11",
    "f12",
]

DocFormat: TypeAlias = Literal["teml", "markdown", "html"]
FrameFormat: TypeAlias = Literal["ansi", "plain", "both"]
FrameMode: TypeAlias = Literal["full", "patches"]

KEY_NAMES: frozenset[str] = frozenset(
    {
        "tab",
        "shiftTab",
        "enter",
        "backspace",
        "escape",
        "left",
        "right",
        "up",
        "down",
        "home",
        "end",
        "delete",
        "pageUp",
        "pageDown",
        "f1",
        "f2",
        "f3",
        "f4",
        "f5",
        "f6",
        "f7",
        "f8",
        "f9",
        "f10",
        "f11",
        "f12",
    }
)


@dataclass(frozen=True, slots=True)
class KeyModifiers:
    ctrl: bool = False
    alt: bool = False
    shift: bool = False


@dataclass(frozen=True, slots=True)
class ConfigureCommand:
    frames: FrameFormat
    mode: FrameMode | None = None
    type: Literal["configure"] = "configure"


@dataclass(frozen=True, slots=True)
class KeyCommand:
    key: KeyName
    modifiers: KeyModifiers | None = None
    type: Literal["key"] = "key"


@dataclass(frozen=True, slots=True)
class CharCommand:
    char: str
    type: Literal["char"] = "char"


@dataclass(frozen=True, slots=True)
class PointerCommand:
    row: int
    col: int
    type: Literal["pointer"] = "pointer"


@dataclass(frozen=True, slots=True)
class ScrollCommand:
    rows: int
    type: Literal["scroll"] = "scroll"


@dataclass(frozen=True, slots=True)
class ResizeCommand:
    width: int
    height: int | None = None
    type: Literal["resize"] = "resize"


@dataclass(frozen=True, slots=True)
class RenderCommand:
    markup: str
    format: DocFormat | None = None
    type: Literal["render"] = "render"


@dataclass(frozen=True, slots=True)
class UpdateCommand:
    id: str
    props: dict[str, str]
    type: Literal["update"] = "update"


@dataclass(frozen=True, slots=True)
class ReplaceCommand:
    target: str
    markup: str
    format: DocFormat | None = None
    type: Literal["replace"] = "replace"


@dataclass(frozen=True, slots=True)
class AppendCommand:
    target: str
    markup: str
    format: DocFormat | None = None
    type: Literal["append"] = "append"


@dataclass(frozen=True, slots=True)
class RemoveCommand:
    target: str
    type: Literal["remove"] = "remove"


@dataclass(frozen=True, slots=True)
class ExitCommand:
    type: Literal["exit"] = "exit"


Command: TypeAlias = Union[
    ConfigureCommand,
    KeyCommand,
    CharCommand,
    PointerCommand,
    ScrollCommand,
    ResizeCommand,
    RenderCommand,
    UpdateCommand,
    ReplaceCommand,
    AppendCommand,
    RemoveCommand,
    ExitCommand,
]


@dataclass(frozen=True, slots=True)
class ProtocolVersion:
    major: int
    minor: int


@dataclass(frozen=True, slots=True)
class ViewportMeta:
    offset: int
    height: int
    total: int


@dataclass(frozen=True, slots=True)
class ScrollRegionMeta:
    id: str
    offset: int
    height: int
    total: int


@dataclass(frozen=True, slots=True)
class FramePatch:
    row: int
    plain: str | None
    ansi: str | None


@dataclass(frozen=True, slots=True)
class FullFrame:
    seq: int
    focused_id: str | None
    plain: str | None
    ansi: str | None
    viewport: ViewportMeta | None = None
    scroll_regions: tuple[ScrollRegionMeta, ...] = field(default_factory=tuple)
    protocol: ProtocolVersion | None = None
    capabilities: tuple[str, ...] = field(default_factory=tuple)
    type: Literal["frame"] = "frame"


@dataclass(frozen=True, slots=True)
class PatchFrame:
    seq: int
    focused_id: str | None
    rows: int
    patches: tuple[FramePatch, ...]
    viewport: ViewportMeta | None = None
    scroll_regions: tuple[ScrollRegionMeta, ...] = field(default_factory=tuple)
    type: Literal["frame"] = "frame"


FrameEvent: TypeAlias = Union[FullFrame, PatchFrame]


@dataclass(frozen=True, slots=True)
class ChangeEvent:
    id: str
    value: str
    type: Literal["change"] = "change"


@dataclass(frozen=True, slots=True)
class ToggleEvent:
    id: str
    checked: bool
    type: Literal["toggle"] = "toggle"


@dataclass(frozen=True, slots=True)
class ClickEvent:
    id: str
    values: dict[str, str]
    type: Literal["click"] = "click"


@dataclass(frozen=True, slots=True)
class ErrorEvent:
    message: str
    type: Literal["error"] = "error"


@dataclass(frozen=True, slots=True)
class ExitEvent:
    type: Literal["exit"] = "exit"


@dataclass(frozen=True, slots=True)
class UnknownEvent:
    event_type: str | None
    type: Literal["unknown"] = "unknown"


SessionEvent: TypeAlias = Union[
    FrameEvent,
    ChangeEvent,
    ToggleEvent,
    ClickEvent,
    ErrorEvent,
    ExitEvent,
    UnknownEvent,
]


def command_to_json(command: Command | dict[str, Any]) -> dict[str, Any]:
    if isinstance(command, dict):
        return command
    if isinstance(command, ConfigureCommand):
        payload: dict[str, Any] = {"type": "configure", "frames": command.frames}
        if command.mode is not None:
            payload["mode"] = command.mode
        return payload
    if isinstance(command, KeyCommand):
        payload = {"type": "key", "key": command.key}
        if command.modifiers is not None:
            modifiers = {
                name: True
                for name, enabled in (
                    ("ctrl", command.modifiers.ctrl),
                    ("alt", command.modifiers.alt),
                    ("shift", command.modifiers.shift),
                )
                if enabled
            }
            if modifiers:
                payload["modifiers"] = modifiers
        return payload
    if isinstance(command, CharCommand):
        return {"type": "char", "char": command.char}
    if isinstance(command, PointerCommand):
        return {"type": "pointer", "row": command.row, "col": command.col}
    if isinstance(command, ScrollCommand):
        return {"type": "scroll", "rows": command.rows}
    if isinstance(command, ResizeCommand):
        payload = {"type": "resize", "width": command.width}
        if command.height is not None:
            payload["height"] = command.height
        return payload
    if isinstance(command, RenderCommand):
        payload = {"type": "render", "markup": command.markup}
        if command.format is not None:
            payload["format"] = command.format
        return payload
    if isinstance(command, UpdateCommand):
        return {"type": "update", "id": command.id, "props": dict(command.props)}
    if isinstance(command, (ReplaceCommand, AppendCommand)):
        payload = {
            "type": command.type,
            "target": command.target,
            "markup": command.markup,
        }
        if command.format is not None:
            payload["format"] = command.format
        return payload
    if isinstance(command, RemoveCommand):
        return {"type": "remove", "target": command.target}
    if isinstance(command, ExitCommand):
        return {"type": "exit"}
    raise TypeError(f"unsupported command type: {type(command)!r}")


def resize_command(width: int, height: int) -> ResizeCommand:
    return ResizeCommand(width=max(width, 1), height=max(height, 1))


def _parse_modifiers(raw: Any) -> KeyModifiers | None:
    if raw is None:
        return None
    if not isinstance(raw, dict):
        return None
    return KeyModifiers(
        ctrl=bool(raw.get("ctrl")),
        alt=bool(raw.get("alt")),
        shift=bool(raw.get("shift")),
    )


def _parse_viewport(raw: Any) -> ViewportMeta | None:
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ValueError("viewport must be an object")
    offset = raw.get("offset")
    height = raw.get("height")
    total = raw.get("total")
    if not all(isinstance(value, int) for value in (offset, height, total)):
        raise ValueError("viewport fields must be integers")
    return ViewportMeta(offset=offset, height=height, total=total)


def _parse_scroll_regions(raw: Any) -> tuple[ScrollRegionMeta, ...]:
    if raw is None:
        return ()
    if not isinstance(raw, list):
        raise ValueError("scrollRegions must be an array")
    regions: list[ScrollRegionMeta] = []
    for entry in raw:
        if not isinstance(entry, dict):
            raise ValueError("scroll region must be an object")
        region_id = entry.get("id")
        offset = entry.get("offset")
        height = entry.get("height")
        total = entry.get("total")
        if not isinstance(region_id, str) or not region_id:
            raise ValueError("scroll region needs an id")
        if not all(isinstance(value, int) for value in (offset, height, total)):
            raise ValueError("scroll region fields must be integers")
        regions.append(
            ScrollRegionMeta(id=region_id, offset=offset, height=height, total=total)
        )
    return tuple(regions)


def _parse_protocol(raw: Any) -> ProtocolVersion | None:
    if raw is None:
        return None
    if not isinstance(raw, dict):
        return None
    major = raw.get("major")
    minor = raw.get("minor")
    if not isinstance(major, int) or not isinstance(minor, int):
        return None
    return ProtocolVersion(major=major, minor=minor)


def _parse_capabilities(raw: Any) -> tuple[str, ...]:
    if not isinstance(raw, list):
        return ()
    return tuple(item for item in raw if isinstance(item, str))


def _parse_frame(data: dict[str, Any]) -> FrameEvent:
    seq = data.get("seq")
    if not isinstance(seq, int) or seq < 1:
        raise ValueError("frame needs a positive integer seq")
    focused_raw = data.get("focusedId")
    focused_id = focused_raw if isinstance(focused_raw, str) else None
    viewport = _parse_viewport(data.get("viewport"))
    scroll_regions = _parse_scroll_regions(data.get("scrollRegions"))
    if "patches" in data:
        rows = data.get("rows")
        patches_raw = data.get("patches")
        if not isinstance(rows, int) or rows < 0:
            raise ValueError("patch frame needs a non-negative rows count")
        if not isinstance(patches_raw, list):
            raise ValueError("patch frame patches must be an array")
        patches: list[FramePatch] = []
        for patch in patches_raw:
            if not isinstance(patch, dict):
                raise ValueError("patch must be an object")
            row = patch.get("row")
            if not isinstance(row, int) or row < 0:
                raise ValueError("patch needs a non-negative row")
            plain = patch.get("plain")
            ansi = patch.get("ansi")
            patches.append(
                FramePatch(
                    row=row,
                    plain=plain if isinstance(plain, str) else None,
                    ansi=ansi if isinstance(ansi, str) else None,
                )
            )
        return PatchFrame(
            seq=seq,
            focused_id=focused_id,
            rows=rows,
            patches=tuple(patches),
            viewport=viewport,
            scroll_regions=scroll_regions,
        )
    plain = data.get("plain")
    ansi = data.get("ansi")
    protocol = _parse_protocol(data.get("protocol"))
    capabilities = _parse_capabilities(data.get("capabilities"))
    return FullFrame(
        seq=seq,
        focused_id=focused_id,
        plain=plain if isinstance(plain, str) else None,
        ansi=ansi if isinstance(ansi, str) else None,
        viewport=viewport,
        scroll_regions=scroll_regions,
        protocol=protocol,
        capabilities=capabilities,
    )


def parse_event(data: dict[str, Any]) -> SessionEvent:
    event_type = data.get("type")
    if event_type == "frame":
        return _parse_frame(data)
    if event_type == "change":
        event_id = data.get("id")
        value = data.get("value")
        if not isinstance(event_id, str) or not isinstance(value, str):
            raise ValueError("change event needs id and value strings")
        return ChangeEvent(id=event_id, value=value)
    if event_type == "toggle":
        event_id = data.get("id")
        checked = data.get("checked")
        if not isinstance(event_id, str) or not isinstance(checked, bool):
            raise ValueError("toggle event needs id and checked")
        return ToggleEvent(id=event_id, checked=checked)
    if event_type == "click":
        event_id = data.get("id")
        values = data.get("values")
        if not isinstance(event_id, str) or not isinstance(values, dict):
            raise ValueError("click event needs id and values")
        normalized = {str(key): str(value) for key, value in values.items()}
        return ClickEvent(id=event_id, values=normalized)
    if event_type == "error":
        message = data.get("message")
        if not isinstance(message, str):
            raise ValueError("error event needs a message string")
        return ErrorEvent(message=message)
    if event_type == "exit":
        return ExitEvent()
    return UnknownEvent(event_type=event_type if isinstance(event_type, str) else None)


def event_to_dict(event: SessionEvent) -> dict[str, Any]:
    if isinstance(event, FullFrame):
        payload: dict[str, Any] = {
            "type": "frame",
            "seq": event.seq,
            "focusedId": event.focused_id,
            "plain": event.plain,
            "ansi": event.ansi,
        }
        if event.viewport is not None:
            payload["viewport"] = {
                "offset": event.viewport.offset,
                "height": event.viewport.height,
                "total": event.viewport.total,
            }
        if event.scroll_regions:
            payload["scrollRegions"] = [
                {
                    "id": region.id,
                    "offset": region.offset,
                    "height": region.height,
                    "total": region.total,
                }
                for region in event.scroll_regions
            ]
        if event.protocol is not None:
            payload["protocol"] = {
                "major": event.protocol.major,
                "minor": event.protocol.minor,
            }
        if event.capabilities:
            payload["capabilities"] = list(event.capabilities)
        return payload
    if isinstance(event, PatchFrame):
        payload = {
            "type": "frame",
            "seq": event.seq,
            "focusedId": event.focused_id,
            "rows": event.rows,
            "patches": [
                {"row": patch.row, "plain": patch.plain, "ansi": patch.ansi}
                for patch in event.patches
            ],
        }
        if event.viewport is not None:
            payload["viewport"] = {
                "offset": event.viewport.offset,
                "height": event.viewport.height,
                "total": event.viewport.total,
            }
        if event.scroll_regions:
            payload["scrollRegions"] = [
                {
                    "id": region.id,
                    "offset": region.offset,
                    "height": region.height,
                    "total": region.total,
                }
                for region in event.scroll_regions
            ]
        return payload
    if isinstance(event, ChangeEvent):
        return {"type": "change", "id": event.id, "value": event.value}
    if isinstance(event, ToggleEvent):
        return {"type": "toggle", "id": event.id, "checked": event.checked}
    if isinstance(event, ClickEvent):
        return {"type": "click", "id": event.id, "values": event.values}
    if isinstance(event, ErrorEvent):
        return {"type": "error", "message": event.message}
    if isinstance(event, ExitEvent):
        return {"type": "exit"}
    if isinstance(event, UnknownEvent):
        return {"type": event.event_type}
    raise TypeError(f"unsupported event type: {type(event)!r}")


def frame_as_dict(frame: FrameEvent) -> dict[str, Any]:
    return cast(dict[str, Any], event_to_dict(frame))
