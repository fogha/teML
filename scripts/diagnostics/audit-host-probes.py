"""Manual host probes for docs/maintenance.md. Run with PYTHONPATH=hosts/python/src.

Uses in-memory transports; does not spawn a process or change terminal modes.
These assert intended invariants and fail until the audited defects are fixed.
"""

import io
import json

from teml_host.session import Session, _NdjsonReader
from teml_host.protocol import MAX_NDJSON_LINE_BYTES
from teml_host.types import ExitCommand, parse_event
from teml_host.screen import ScreenBuffer


def line_limit_is_per_message():
    prefix, suffix = b'{"value":"', b'"}\n'
    first = prefix + b"x" * (MAX_NDJSON_LINE_BYTES - 16 - len(prefix) - len(suffix)) + suffix
    second = b'{"type":"future","value":"' + b"y" * 100 + b'"}\n'
    class FragmentedStream(io.BytesIO):
        first_read = True

        def read(self, count=-1):
            if self.first_read:
                self.first_read = False
                return super().read(1)
            return super().read(count)

    # Raw pipe reads may split anywhere, not just at multiples of 4096.
    reader = _NdjsonReader(FragmentedStream(first + second))
    assert "value" in reader.read_event()
    assert reader.read_event()["type"] == "future"


def short_writes_are_completed():
    class ShortWriter:
        def __init__(self):
            self.written = bytearray()

        def write(self, data):
            count = min(4, len(data))
            self.written.extend(data[:count])
            return count

        def flush(self):
            pass

    writer = ShortWriter()
    # Only send() is used; no child process or reader is needed for this probe.
    session = Session(None, writer, None, None)
    session.send(ExitCommand())
    assert bytes(writer.written) == b'{"type":"exit"}\n', repr(bytes(writer.written))


def rejected_patch_is_atomic():
    screen = ScreenBuffer()
    screen.apply(parse_event({"type": "frame", "seq": 1, "focusedId": None,
                              "plain": "old\n", "ansi": None}))
    before = screen.text()
    try:
        screen.apply(parse_event({"type": "frame", "seq": 2, "focusedId": None,
                                  "rows": 1, "patches": [
                                      {"row": 0, "plain": "changed", "ansi": None},
                                      {"row": 2, "plain": "invalid", "ansi": None}]}))
    except ValueError:
        pass
    else:
        raise AssertionError("invalid patch was accepted")
    assert screen.text() == before, screen.text()


failures = 0
for name, probe in [
    ("C11", line_limit_is_per_message),
    ("C12", short_writes_are_completed),
    ("A06", rejected_patch_is_atomic),
]:
    try:
        probe()
        print(json.dumps({"id": name, "status": "PASS"}))
    except Exception as error:
        failures += 1
        print(json.dumps({"id": name, "status": "FAIL", "detail": str(error)}))

raise SystemExit(1 if failures else 0)
