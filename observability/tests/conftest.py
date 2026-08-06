"""Observability tests configuration.

确保 ``flowforge`` 包可被导入，并设置测试环境变量。
"""
import gc
import os
import sys
from pathlib import Path

import pytest

# flowforge/observability/tests/conftest.py -> d:\software\openclaw
_WORKSPACE_ROOT = Path(__file__).resolve().parent.parent.parent.parent
if str(_WORKSPACE_ROOT) not in sys.path:
    sys.path.insert(0, str(_WORKSPACE_ROOT))


@pytest.fixture(autouse=True)
def _setup_observability_test_env():
    """每个测试用例前后清理环境。"""
    os.environ["FLOWFORGE_ENV"] = "test"
    yield
    gc.collect()
