"""Tests for the CLI entry point."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

from flowforge import __version__
from flowforge.cli.__main__ import main


def test_version_flag(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exc_info:
        main(["--version"])
    assert exc_info.value.code == 0
    out = capsys.readouterr().out
    assert __version__ in out


def test_no_args_prints_help(capsys: pytest.CaptureFixture[str]) -> None:
    rc = main([])
    assert rc == 0
    out = capsys.readouterr().out
    assert "flowforge" in out.lower()


def test_forgekin_list_registers_examples(capsys: pytest.CaptureFixture[str]) -> None:
    rc = main(["forgekin", "list"])
    assert rc == 0
    out = capsys.readouterr().out
    assert "小煤球" in out or "cat" in out.lower()
    assert "Sherlock" in out
    assert "老灯" in out


def test_evolve_dry_run(capsys: pytest.CaptureFixture[str]) -> None:
    rc = main(["evolve", "--dry-run", "--instruction", "proceed normally"])
    assert rc == 0
    out = capsys.readouterr().out
    assert "Decision:" in out
    assert "dry-run" in out


def test_evolve_with_magic_word(capsys: pytest.CaptureFixture[str]) -> None:
    rc = main(["evolve", "--dry-run", "--instruction", "用第一性原理重新考虑"])
    assert rc == 0
    out = capsys.readouterr().out
    assert "A_scope_guard" in out


def test_loop_run_returns_zero(capsys: pytest.CaptureFixture[str]) -> None:
    rc = main(["loop", "run"])
    assert rc == 0
    out = capsys.readouterr().out
    assert "Loop result:" in out


def test_python_m_flowforge_version_works(project_root: Path) -> None:
    """Smoke test: ensure `python -m flowforge --version` works from CLI."""
    result = subprocess.run(
        [sys.executable, "-m", "flowforge", "--version"],
        capture_output=True,
        text=True,
        cwd=str(project_root),
        timeout=30,
    )
    assert result.returncode == 0, f"stderr: {result.stderr}"
    assert __version__ in result.stdout
