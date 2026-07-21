"""Pytest fixtures shared across all flowforge tests."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

# Ensure the flowforge package is importable when tests run from repo root
# without installation (e.g. CI smoke runs).
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

# Isolate log dir so tests don't pollute the repo's logs/
_LOG_DIR = _PROJECT_ROOT / "logs" / "tests"
_LOG_DIR.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("FLOWFORGE_LOG_DIR", str(_LOG_DIR))


@pytest.fixture(autouse=True)
def _reset_singletons():
    """Reset process-wide singletons between tests for isolation."""
    from flowforge.core import di
    from flowforge.forgemind import registry as reg_mod

    di.set_container(di.Container())
    reg_mod.set_registry(reg_mod.ForgekinRegistry())
    yield
    di.set_container(None)
    reg_mod.set_registry(None)


@pytest.fixture
def project_root() -> Path:
    return _PROJECT_ROOT


@pytest.fixture
def config_dir(project_root: Path) -> Path:
    return project_root / "config"
