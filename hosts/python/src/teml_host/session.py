"""NDJSON session transport for `teml run`."""

from __future__ import annotations

import json
import subprocess
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


class _NdjsonReader:
    __slots__ = ("_stream", "_buffer")

    def __init__(self, stream: BinaryIO) -> None:
        self._stream = stream
        self._buffer = b""

    def read_event(self) -> dict[str, Any]:
        while True:
            while b"\n" in self._buffer:
                line_bytes, self._buffer = self._buffer.split(b"\n", 1)
                line = line_bytes.strip()
                if not line:
                    continue
                if len(line) > MAX_NDJSON_LINE_BYTES:
                    raise SessionError(
                        f"NDJSON line exceeds the {MAX_NDJSON_LINE_BYTES}-byte limit"
                    )
                try:
                    parsed = json.loads(line.decode("utf-8"))
                except json.JSONDecodeError as exc:
                    raise SessionError(f"invalid event JSON: {exc}") from exc
                if not isinstance(parsed, dict):
                    raise SessionError("event JSON must be an object")
                return parsed
            chunk = self._stream.read(4096)
            if chunk == b"":
                if self._buffer:
                    if len(self._buffer.strip()) > MAX_NDJSON_LINE_BYTES:
                        raise SessionError(
                            f"NDJSON line exceeds the {MAX_NDJSON_LINE_BYTES}-byte limit"
                        )
                    try:
                        parsed = json.loads(self._buffer.strip().decode("utf-8"))
                    except json.JSONDecodeError as exc:
                        raise SessionError(f"invalid event JSON: {exc}") from exc
                    if not isinstance(parsed, dict):
                        raise SessionError("event JSON must be an object")
                    self._buffer = b""
                    return parsed
                raise SessionError("teml closed stdout")
            if len(self._buffer) + len(chunk) > MAX_NDJSON_LINE_BYTES:
                raise SessionError(
                    f"NDJSON line exceeds the {MAX_NDJSON_LINE_BYTES}-byte limit"
                )
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
            reader=_NdjsonReader(process.stdout),
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
        self._stdin.write(encoded + b"\n")
        self._stdin.flush()

    def next_event_raw(self) -> dict[str, Any]:
        return self._reader.read_event()

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
