"""Integration test configuration — preserves real API keys for integration tests.

The parent conftest.py sets OPENROUTER_API_KEY="test-key" via an autouse
fixture named ``setup_test_env``, which breaks integration tests that need
real API keys.  This conftest overrides that fixture by defining a fixture
with the **same name** so pytest uses this one instead.
"""

import os
import gc
import pytest


# Save real API keys at import time (before parent conftest.py overwrites them)
_REAL_KEYS = {}
for _key in ("OPENROUTER_API_KEY", "OPENROUTE_API_KEY"):
    _val = os.environ.get(_key, "")
    if _val and _val not in ("test-key", "fake", "mock", "placeholder", "none"):
        _REAL_KEYS[_key] = _val


@pytest.fixture(autouse=True)
def setup_test_env():
    """Override parent conftest's setup_test_env to preserve real API keys.

    By using the same fixture name, pytest will use this fixture instead
    of the parent's, preventing the OPENROUTER_API_KEY from being
    overwritten with "test-key".
    """
    os.environ["FLOWFORGE_ENV"] = "test"
    # Restore real API keys (in case parent conftest already ran)
    for key, value in _REAL_KEYS.items():
        os.environ[key] = value
    yield
    # Restore real keys after test
    for key, value in _REAL_KEYS.items():
        os.environ[key] = value
    gc.collect()
