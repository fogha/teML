"""Engine resolution diagnostics."""

from __future__ import annotations

import stat
from pathlib import Path

import pytest

from teml_host.engine import (
    EngineSource,
    engine_invocation,
    is_javascript_entry,
    resolve_engine,
)


def test_is_javascript_entry() -> None:
    assert is_javascript_entry("dist/cli/main.js")
    assert is_javascript_entry("entry.MJS")
    assert is_javascript_entry("bundle.cjs")
    assert not is_javascript_entry("/usr/local/bin/teml")
    assert not is_javascript_entry(".sea/teml.exe")


def test_engine_invocation_uses_node_for_js_entries() -> None:
    program, prefix = engine_invocation("/tmp/dist/cli/main.js")
    assert program == "node"
    assert prefix == (str(Path("/tmp/dist/cli/main.js").resolve()),)


def test_engine_invocation_executes_native_binaries_directly(tmp_path: Path) -> None:
    binary = tmp_path / "teml"
    binary.write_text("#!/bin/sh\n", encoding="utf-8")
    binary.chmod(binary.stat().st_mode | stat.S_IXUSR)
    program, prefix = engine_invocation(binary)
    assert program == str(binary.resolve())
    assert prefix == ()


def test_resolve_built_repo_engine(engine_path: str) -> None:
    info = resolve_engine(engine_path)
    assert info.source == EngineSource.EXPLICIT
    assert info.program == "node"
    assert Path(info.resolved_path).is_file()
    assert info.version is not None


def test_resolve_prefers_explicit_over_env(engine_path: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TEML_CLI", "/should/not/be/used.js")
    info = resolve_engine(engine_path)
    assert info.source == EngineSource.EXPLICIT
    assert info.resolved_path == str(Path(engine_path).resolve())


def test_resolve_teml_cli_native_binary(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    binary = tmp_path / "teml"
    binary.write_text("#!/bin/sh\n", encoding="utf-8")
    binary.chmod(binary.stat().st_mode | stat.S_IXUSR)
    monkeypatch.setenv("TEML_CLI", str(binary))
    info = resolve_engine()
    assert info.source == EngineSource.TEML_CLI
    assert info.program == str(binary.resolve())
    assert info.prefix_args == ()


def test_resolve_teml_cli_js_entry(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    script = tmp_path / "main.js"
    script.write_text("// teml cli\n", encoding="utf-8")
    monkeypatch.setenv("TEML_CLI", str(script))
    info = resolve_engine()
    assert info.source == EngineSource.TEML_CLI
    assert info.program == "node"
    assert info.prefix_args == (str(script.resolve()),)


