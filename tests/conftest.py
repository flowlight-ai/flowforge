"""Pytest fixtures shared across all flowforge tests."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

# Ensure the flowforge package is importable when tests run from repo root
# without installation (e.g. CI smoke runs).
# After flattening the directory structure, the project root IS the flowforge
# package itself (has __init__.py at root, matching old project convention).
# So we add the PARENT of the project root to sys.path, allowing
# `from flowforge.core import ...` to resolve correctly.
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_PACKAGE_PARENT = _PROJECT_ROOT.parent
if str(_PACKAGE_PARENT) not in sys.path:
    sys.path.insert(0, str(_PACKAGE_PARENT))

# Isolate log dir so tests don't pollute the repo's logs/
_LOG_DIR = _PROJECT_ROOT / "logs" / "tests"
_LOG_DIR.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("FLOWFORGE_LOG_DIR", str(_LOG_DIR))


@pytest.fixture(autouse=True)
def _reset_singletons():
    """Reset process-wide singletons between tests for isolation.

    Some tests (e.g. T7/T8 E2E) run against a live server and don't need
    DI reset. We gracefully skip if the DI module doesn't expose set_container.
    """
    from flowforge.forgemind import registry as reg_mod

    # DI reset is optional — the modular di.py may not expose set_container.
    try:
        from flowforge.core import di
        if hasattr(di, "set_container") and hasattr(di, "Container"):
            di.set_container(di.Container())
    except Exception:
        pass

    reg_mod.set_registry(reg_mod.ForgekinRegistry())
    yield

    try:
        from flowforge.core import di
        if hasattr(di, "set_container"):
            di.set_container(None)
    except Exception:
        pass
    reg_mod.set_registry(None)


@pytest.fixture
def project_root() -> Path:
    return _PROJECT_ROOT


@pytest.fixture
def config_dir(project_root: Path) -> Path:
    return project_root / "config"
