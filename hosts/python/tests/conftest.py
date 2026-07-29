"""Shared fixtures — missing engines fail rather than skip."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from teml_host.engine import resolve_engine


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _built_engine() -> Path:
    return _repo_root() / "dist" / "cli" / "main.js"


@pytest.fixture(scope="session")
def engine_path() -> str:
    explicit = os.environ.get("TEML_CLI")
    if explicit:
        path = Path(explicit).expanduser()
        if not path.is_file():
            pytest.fail(f"TEML_CLI does not point to a file: {explicit}")
        return str(path.resolve())

    built = _built_engine()
    if built.is_file():
        return str(built.resolve())

    try:
        info = resolve_engine()
    except FileNotFoundError as exc:
        pytest.fail(
            "TeML engine required: build dist/cli/main.js from the repo root "
            f"(pnpm run build) or set TEML_CLI. {exc}"
        )
    return info.resolved_path


@pytest.fixture(scope="session")
def view_path() -> str:
    path = Path(__file__).resolve().parents[1] / "examples" / "incident_handoff" / "view.html"
    if not path.is_file():
        pytest.fail(f"example view missing: {path}")
    return str(path)
