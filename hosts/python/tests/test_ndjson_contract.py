"""Shared NDJSON adversarial contract, also run by TS, Go, and Rust."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from teml_host.session import SessionError, _NdjsonReader


class _ChunkedStream:
    def __init__(self, chunks: list[bytes]) -> None:
        self._chunks = list(chunks)

    def read(self, size: int) -> bytes:
        del size
        return self._chunks.pop(0) if self._chunks else b""


def _fixture() -> list[dict]:
    path = Path(__file__).resolve().parents[3] / "fixtures" / "protocol" / "ndjson-cases.json"
    assert path.is_file(), f"shared contract missing: {path}"
    return json.loads(path.read_text(encoding="utf-8"))["cases"]


def _input_bytes(parts: list[dict]) -> bytes:
    return b"".join(part["text"].encode() * part["repeat"] for part in parts)


def _chunks(data: bytes, schedule: list[int]) -> list[bytes]:
    chunks = []
    offset = 0
    index = 0
    while offset < len(data):
        size = schedule[index % len(schedule)]
        chunks.append(data[offset : offset + size])
        offset += size
        index += 1
    return chunks


@pytest.mark.parametrize("case", _fixture(), ids=lambda case: case["name"])
def test_shared_ndjson_contract(case: dict) -> None:
    reader = _NdjsonReader(_ChunkedStream(_chunks(_input_bytes(case["parts"]), case["chunks"])))
    events = []
    while True:
        try:
            events.append(reader.read_event())
        except SessionError as error:
            assert str(error) == "teml closed stdout"
            break
    assert events == case["events"]
