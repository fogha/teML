"""Protocol version and capability constants matching src/interactive/protocol.ts."""

from __future__ import annotations

from typing import Final, Literal, TypeAlias

from teml_host.types import ProtocolVersion

PROTOCOL_MAJOR: Final = 1
PROTOCOL_MINOR: Final = 3
PROTOCOL_VERSION: Final = ProtocolVersion(major=PROTOCOL_MAJOR, minor=PROTOCOL_MINOR)

ProtocolCapability: TypeAlias = Literal[
    "frameFormats",
    "patches",
    "resize",
    "viewport",
    "pointerColumns",
    "keyModifiers",
    "scroll",
    "contextualInput",
    "radio",
    "textarea",
    "scrollRegions",
    "update",
    "documentMutations",
]

ENGINE_CAPABILITIES: Final[tuple[ProtocolCapability, ...]] = (
    "frameFormats",
    "patches",
    "resize",
    "viewport",
    "pointerColumns",
    "keyModifiers",
    "scroll",
    "contextualInput",
    "radio",
    "textarea",
    "scrollRegions",
    "update",
    "documentMutations",
)

CAPABILITY_DOCS: Final[dict[str, str]] = {
    "frameFormats": "Negotiate ansi, plain, or both frame payloads via configure.",
    "patches": "Row-level patch frames instead of full re-renders.",
    "resize": "Terminal resize commands relayout the document.",
    "viewport": "Frames may carry viewport metadata for bounded windows.",
    "pointerColumns": "Pointer commands resolve to column-accurate hit targets.",
    "keyModifiers": "Key commands accept ctrl/alt/shift modifiers.",
    "scroll": "Scroll commands and nested scroll region metadata.",
    "contextualInput": "Engine routes input based on focused widget context.",
    "radio": "Native radio groups with arrow-key preview and enter commit.",
    "textarea": "Multiline text areas with newline editing semantics.",
    "scrollRegions": "Fixed-height nested scroll containers expose offset/total.",
    "update": "Live widget mutation via update commands without re-parsing markup (protocol 1.2).",
    "documentMutations": (
        "Targeted replace, append, and remove commands over normalized document fragments "
        "(protocol 1.3)."
    ),
}

MAX_CHAR_BYTES: Final = 64 * 1024
MAX_RENDER_MARKUP_BYTES: Final = 4 * 1024 * 1024
MAX_NDJSON_LINE_BYTES: Final = 8 * 1024 * 1024
MAX_SCROLL_ROWS: Final = 10_000
MAX_DOCUMENT_BLOCKS: Final = 10_000
MAX_MUTATION_TARGET_CHILDREN: Final = 2_000
