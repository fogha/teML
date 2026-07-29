"""TeML engine discovery and version diagnostics."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from enum import Enum
from pathlib import Path

JS_ENGINE_SUFFIXES: frozenset[str] = frozenset({".js", ".mjs", ".cjs"})


class EngineSource(str, Enum):
    EXPLICIT = "explicit"
    TEML_CLI = "TEML_CLI"
    PACKAGE = "package"
    PATH = "PATH"


@dataclass(frozen=True, slots=True)
class EngineInfo:
    program: str
    prefix_args: tuple[str, ...]
    source: EngineSource
    resolved_path: str
    version: str | None
    runtime_version: str | None


def is_javascript_entry(path: str | Path) -> bool:
    return Path(path).suffix.lower() in JS_ENGINE_SUFFIXES


def engine_invocation(resolved_path: str | Path) -> tuple[str, tuple[str, ...]]:
    """Return (program, prefix_args) for a resolved engine path."""
    path = Path(resolved_path)
    if is_javascript_entry(path):
        return "node", (str(path.resolve()),)
    return str(path.resolve()), ()


def _repo_root() -> Path:
    here = Path(__file__).resolve()
    return here.parents[4]


def _repo_engine_path() -> Path | None:
    candidate = _repo_root() / "dist" / "cli" / "main.js"
    if candidate.is_file():
        return candidate
    return None


def _read_version(program: str, prefix_args: tuple[str, ...]) -> tuple[str | None, str | None]:
    runtime_version: str | None = None
    if program == "node":
        try:
            runtime = subprocess.run(
                ["node", "--version"],
                check=True,
                capture_output=True,
                text=True,
                timeout=5,
            )
            runtime_version = runtime.stdout.strip() or None
        except (OSError, subprocess.SubprocessError):
            runtime_version = None
    try:
        completed = subprocess.run(
            [program, *prefix_args, "--version"],
            check=True,
            capture_output=True,
            text=True,
            timeout=5,
        )
        version = completed.stdout.strip() or completed.stderr.strip() or None
    except (OSError, subprocess.SubprocessError):
        version = None
    return version, runtime_version


def _engine_from_path(path: Path, source: EngineSource) -> EngineInfo:
    program, prefix_args = engine_invocation(path)
    version, runtime_version = _read_version(program, prefix_args)
    return EngineInfo(
        program=program,
        prefix_args=prefix_args,
        source=source,
        resolved_path=str(path.resolve()),
        version=version,
        runtime_version=runtime_version,
    )


def resolve_engine(explicit: str | None = None) -> EngineInfo:
    if explicit:
        path = Path(explicit).expanduser()
        if not path.is_file():
            raise FileNotFoundError(f"explicit TeML engine not found: {explicit}")
        return _engine_from_path(path, EngineSource.EXPLICIT)

    env_cli = os.environ.get("TEML_CLI")
    if env_cli:
        path = Path(env_cli).expanduser()
        if not path.is_file():
            raise FileNotFoundError(f"TEML_CLI does not point to a file: {env_cli}")
        return _engine_from_path(path, EngineSource.TEML_CLI)

    package_path = _repo_engine_path()
    if package_path is not None:
        return _engine_from_path(package_path, EngineSource.PACKAGE)

    teml = shutil.which("teml")
    if teml is None:
        raise FileNotFoundError(
            "TeML engine not found: set TEML_CLI, build dist/cli/main.js, "
            "or install teml on PATH"
        )
    path = Path(teml)
    return _engine_from_path(path, EngineSource.PATH)
