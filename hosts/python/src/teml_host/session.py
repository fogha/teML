"""NDJSON session transport for `teml run`."""

from __future__ import annotations

import json
import os
import select
import subprocess
import time
from typing import Any, BinaryIO

from teml_host.engine import EngineInfo, resolve_engine
from teml_host.protocol import MAX_NDJSON_LINE_BYTES
from teml_host.types import (
    Command,
    ErrorEvent,
    ExitEvent,
    FrameEvent,
    FullFrame,
    PatchFrame,
    SessionEvent,
    command_to_json,
    parse_event,
)


class SessionError(RuntimeError):
    pass


class SessionTimeout(SessionError):
    pass


def _parse_line(line: bytes) -> dict[str, Any]:
    try:
        parsed = json.loads(line.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise SessionError(f"invalid event JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        raise SessionError("event JSON must be an object")
    return parsed


def _oversized_line_event() -> dict[str, Any]:
    """An oversized line is reported like any other protocol error so the
    application loop can complete the command and keep the session usable."""
    return {
        "type": "error",
        "message": f"NDJSON line exceeds the {MAX_NDJSON_LINE_BYTES}-byte limit",
    }


def _write_all(stream: BinaryIO, data: bytes) -> None:
    """Write every byte or fail: a partial write would desync the protocol."""
    view = memoryview(data)
    while view:
        try:
            written = stream.write(view)
        except BlockingIOError as exc:
            raise SessionError("engine stdin is not writable") from exc
        # `None` and `0` both mean no progress; stop rather than spin.
        if not written:
            raise SessionError("short write to the engine")
        view = view[written:]


class _NdjsonReader:
    __slots__ = ("_stream", "_buffer", "_skipping", "_read_timeout")

    def __init__(self, stream: BinaryIO, read_timeout: float | None = None) -> None:
        if read_timeout is not None and read_timeout <= 0:
            raise ValueError("read_timeout must be positive or None")
        self._stream = stream
        self._read_timeout = read_timeout
        self._buffer = b""
        # Set while dropping the tail of an oversized line. The line's
        # terminating newline ends the skip, so the session stays usable.
        self._skipping = False

    def _read_chunk(self, deadline: float | None) -> bytes:
        if self._read_timeout is None:
            return self._stream.read(4096)
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise SessionTimeout(
                f"timed out waiting for teml event after {self._read_timeout:g} seconds"
            )
        try:
            ready, _, _ = select.select([self._stream], [], [], remaining)
            if not ready:
                raise SessionTimeout(
                    f"timed out waiting for teml event after {self._read_timeout:g} seconds"
                )
            return os.read(self._stream.fileno(), 4096)
        except (OSError, ValueError) as exc:
            raise SessionError("cannot wait for engine stdout") from exc

    def read_event(self) -> dict[str, Any]:
        deadline = (
            None
            if self._read_timeout is None
            else time.monotonic() + self._read_timeout
        )
        while True:
            if self._skipping:
                # Drop the oversized line's tail without accumulating it.
                newline = self._buffer.find(b"\n")
                if newline == -1:
                    self._buffer = b""
                    chunk = self._read_chunk(deadline)
                    if chunk == b"":
                        raise SessionError("teml closed stdout")
                    self._buffer = chunk
                    continue
                self._buffer = self._buffer[newline + 1 :]
                self._skipping = False
                continue

            newline = self._buffer.find(b"\n")
            if newline != -1:
                line_bytes = self._buffer[:newline]
                self._buffer = self._buffer[newline + 1 :]
                line = line_bytes.strip()
                if not line:
                    continue
                if len(line) > MAX_NDJSON_LINE_BYTES:
                    return _oversized_line_event()
                return _parse_line(line)

            # No complete line yet. Only this unterminated remainder is budgeted:
            # measuring the whole buffer would reject a chunk that carries
            # several individually valid lines.
            if len(self._buffer) > MAX_NDJSON_LINE_BYTES:
                self._buffer = b""
                self._skipping = True
                return _oversized_line_event()

            chunk = self._read_chunk(deadline)
            if chunk == b"":
                line = self._buffer.strip()
                self._buffer = b""
                if not line:
                    raise SessionError("teml closed stdout")
                if len(line) > MAX_NDJSON_LINE_BYTES:
                    return _oversized_line_event()
                return _parse_line(line)
            self._buffer += chunk


class Session:
    __slots__ = (
        "_process",
        "_stdin",
        "_reader",
        "engine_info",
    )

    def __init__(
        self,
        process: subprocess.Popen[bytes],
        stdin: BinaryIO,
        reader: _NdjsonReader,
        engine_info: EngineInfo,
    ) -> None:
        self._process = process
        self._stdin = stdin
        self._reader = reader
        self.engine_info = engine_info

    @classmethod
    def spawn(
        cls,
        view: str,
        *,
        width: int = 80,
        height: int | None = None,
        frames: str | None = None,
        mode: str | None = None,
        no_color: bool = False,
        engine: str | None = None,
        read_timeout: float | None = 30.0,
    ) -> Session:
        engine_info = resolve_engine(engine)
        args = [
            *engine_info.prefix_args,
            "run",
            view,
            "--width",
            str(max(width, 1)),
        ]
        if height is not None:
            args.extend(["--height", str(max(height, 1))])
        if frames is not None:
            args.extend(["--frames", frames])
        if mode is not None:
            args.extend(["--mode", mode])
        if no_color:
            args.append("--no-color")
        try:
            process = subprocess.Popen(
                [engine_info.program, *args],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=None,
                bufsize=0,
            )
        except OSError as exc:
            raise SessionError(f"failed to spawn TeML engine: {exc}") from exc
        if process.stdin is None or process.stdout is None:
            process.kill()
            raise SessionError("teml stdin/stdout pipes were not created")
        return cls(
            process=process,
            stdin=process.stdin,
            reader=_NdjsonReader(process.stdout, read_timeout=read_timeout),
            engine_info=engine_info,
        )

    def __enter__(self) -> Session:
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    def send(self, command: Command | dict[str, Any]) -> None:
        payload = command_to_json(command)
        line = json.dumps(payload, separators=(",", ":"))
        encoded = line.encode("utf-8")
        if len(encoded) > MAX_NDJSON_LINE_BYTES:
            raise SessionError(
                f"command exceeds the {MAX_NDJSON_LINE_BYTES}-byte NDJSON limit"
            )
        _write_all(self._stdin, encoded + b"\n")
        self._stdin.flush()

    def next_event_raw(self) -> dict[str, Any]:
        try:
            return self._reader.read_event()
        except SessionTimeout:
            self.close()
            raise

    def next_event(self) -> SessionEvent:
        return parse_event(self.next_event_raw())

    def next_frame(self) -> FrameEvent:
        while True:
            event = self.next_event()
            if isinstance(event, (FullFrame, PatchFrame)):
                return event
            if isinstance(event, ErrorEvent):
                raise SessionError(f"protocol error: {event.message}")
            if isinstance(event, ExitEvent):
                raise SessionError("session exited before producing a frame")

    def close(self) -> None:
        if self._process.poll() is None:
            try:
                self._process.kill()
            except OSError:
                pass
            try:
                self._process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                pass

    @property
    def returncode(self) -> int | None:
        return self._process.poll()

    def wait(self, timeout: float | None = None) -> int:
        return self._process.wait(timeout=timeout)
