"""Unit tests for host-side frame reconstruction."""

from __future__ import annotations

import pytest

from teml_host import (
    FullFrame,
    FramePatch,
    PatchFrame,
    PreferredFrame,
    ProtocolVersion,
    ScreenBuffer,
    ScrollRegionMeta,
    ViewportMeta,
)


def test_reconstructs_growth_change_and_truncation() -> None:
    screen = ScreenBuffer(PreferredFrame.PLAIN)
    screen.apply(
        FullFrame(
            seq=1,
            focused_id="name",
            plain="one\ntwo\n",
            ansi=None,
        )
    )
    screen.apply(
        PatchFrame(
            seq=2,
            focused_id="name",
            rows=3,
            patches=(
                FramePatch(row=1, plain="TWO", ansi=None),
                FramePatch(row=2, plain="three", ansi=None),
            ),
        )
    )
    assert screen.text() == "one\nTWO\nthree"

    screen.apply(PatchFrame(seq=3, focused_id="name", rows=1, patches=()))
    assert screen.text() == "one"


def test_rejects_patch_sequence_gaps() -> None:
    screen = ScreenBuffer(PreferredFrame.ANSI)
    screen.apply(
        FullFrame(seq=1, focused_id=None, plain="plain\n", ansi="ansi\n")
    )
    with pytest.raises(ValueError, match="sequence gap"):
        screen.apply(PatchFrame(seq=3, focused_id=None, rows=1, patches=()))


def test_preserves_validated_viewport_metadata() -> None:
    screen = ScreenBuffer(PreferredFrame.PLAIN)
    screen.apply(
        FullFrame(
            seq=1,
            focused_id=None,
            plain="row 8\nrow 9\n",
            ansi=None,
            viewport=ViewportMeta(offset=8, height=2, total=10),
        )
    )
    assert screen.viewport is not None
    assert screen.viewport.offset == 8
    assert screen.viewport.height == 2
    assert screen.viewport.total == 10


def test_preserves_protocol_capabilities_focus_and_scroll_regions() -> None:
    screen = ScreenBuffer(PreferredFrame.PLAIN)
    screen.apply(
        FullFrame(
            seq=1,
            focused_id="logs",
            plain="one\ntwo\n",
            ansi=None,
            protocol=ProtocolVersion(major=1, minor=1),
            capabilities=("scroll", "future"),
            scroll_regions=(
                ScrollRegionMeta(id="logs", offset=2, height=2, total=8),
            ),
        )
    )
    assert screen.protocol == ProtocolVersion(major=1, minor=1)
    assert screen.capabilities == ["scroll", "future"]
    assert screen.focused_id == "logs"
    assert len(screen.scroll_regions) == 1
    assert screen.scroll_regions[0].id == "logs"

    with pytest.raises(ValueError, match="scroll region"):
        screen.apply(
            PatchFrame(
                seq=2,
                focused_id="logs",
                rows=2,
                patches=(),
                scroll_regions=(
                    ScrollRegionMeta(id="logs", offset=7, height=2, total=8),
                ),
            )
        )


def test_accepts_full_resync_after_gap() -> None:
    screen = ScreenBuffer(PreferredFrame.ANSI)
    screen.apply(
        FullFrame(seq=1, focused_id=None, plain="plain\n", ansi="ansi\n")
    )
    with pytest.raises(ValueError, match="sequence gap"):
        screen.apply(PatchFrame(seq=3, focused_id=None, rows=1, patches=()))
    screen.apply(
        FullFrame(seq=3, focused_id=None, plain=None, ansi="resynced\n")
    )
    assert screen.text() == "resynced"
