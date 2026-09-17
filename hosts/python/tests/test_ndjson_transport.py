"""Transport-level tests for the NDJSON reader and writer (C11, C12)."""

from __future__ import annotations

import json

import pytest

from teml_host import session as session_module
from teml_host.session import SessionError, _NdjsonReader, _write_all


class _ChunkedStream:
    """Returns one queued chunk per read, so a test controls exactly where a
    line is split across reads."""

    def __init__(self, chunks: list[bytes]) -> None:
        self._chunks = list(chunks)

    def read(self, size: int) -> bytes:
        del size
        return self._chunks.pop(0) if self._chunks else b""


class _ShortWriter:
    """Accepts only ``limit`` bytes per call, like a raw fd short write."""

    def __init__(self, limit: int) -> None:
        self.limit = limit
        self.data = bytearray()

    def write(self, data: bytes) -> int:
        chunk = bytes(data[: self.limit])
        self.data += chunk
        return len(chunk)


class _StalledWriter:
    def write(self, data: bytes) -> int:
        del data
        return 0


def test_reader_budgets_each_line_not_the_combined_chunk(monkeypatch: pytest.MonkeyPatch) -> None:
    # A later chunk can carry the newline ending a near-limit line plus further
    # valid lines. Only each individual line is budgeted.
    monkeypatch.setattr(session_module, "MAX_NDJSON_LINE_BYTES", 40)
    first = json.dumps({"a": "x" * 26}).encode()
    second = json.dumps({"b": "y" * 13}).encode()
    assert len(first) <= 40
    assert len(second) <= 40

    reader = _NdjsonReader(_ChunkedStream([first, b"\n" + second + b"\n"]))
    assert reader.read_event() == {"a": "x" * 26}
    assert reader.read_event() == {"b": "y" * 13}


def test_reader_accepts_a_line_exactly_at_the_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(session_module, "MAX_NDJSON_LINE_BYTES", 40)
    line = json.dumps({"a": "x" * 31}).encode()
    assert len(line) == 40

    reader = _NdjsonReader(_ChunkedStream([line + b"\n"]))
    assert reader.read_event() == {"a": "x" * 31}


def test_reader_reports_an_oversized_line_and_keeps_the_session_usable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(session_module, "MAX_NDJSON_LINE_BYTES", 40)
    oversized = json.dumps({"a": "x" * 32}).encode()
    assert len(oversized) > 40

    reader = _NdjsonReader(
        _ChunkedStream([oversized + b"\n", json.dumps({"ok": 1}).encode() + b"\n"])
    )
    event = reader.read_event()
    assert event["type"] == "error"
    assert "exceeds" in event["message"]
    # The session stays usable: the next command's response still arrives.
    assert reader.read_event() == {"ok": 1}


def test_reader_recovers_when_an_oversized_line_arrives_without_a_newline(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(session_module, "MAX_NDJSON_LINE_BYTES", 40)
    head = b'{"a":"' + b"x" * 40  # 47 bytes, unterminated
    tail = b'xx"}\n' + json.dumps({"ok": 1}).encode() + b"\n"

    reader = _NdjsonReader(_ChunkedStream([head, tail]))
    event = reader.read_event()
    assert event["type"] == "error"
    assert reader.read_event() == {"ok": 1}


def test_write_all_completes_a_short_write() -> None:
    writer = _ShortWriter(limit=4)
    payload = b'{"type":"char","char":"hi"}\n'
    _write_all(writer, payload)
    assert bytes(writer.data) == payload


def test_write_all_fails_bounded_when_the_stream_makes_no_progress() -> None:
    with pytest.raises(SessionError, match="short write"):
        _write_all(_StalledWriter(), b"data")
