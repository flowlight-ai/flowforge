import os
import sys
import gc
import pytest
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

@pytest.fixture(autouse=True)
def setup_test_env():
    os.environ["FLOWFORGE_ENV"] = "test"
    os.environ["DB_URL"] = "sqlite:///data/test_flowforge.db"
    os.environ["OPENROUTER_API_KEY"] = "test-key"
    yield
    gc.collect()
    for path in ["data/test_flowforge.db", "data/test_checkpoints.db",
                 "data/short_term.db", "data/long_term.db", "data/episodic.db"]:
        full = os.path.join(PROJECT_ROOT, path)
        if os.path.exists(full):
            try:
                os.remove(full)
            except PermissionError:
                pass

@pytest.fixture
def mock_llm_tool():
    from core.base_tool import BaseTool, ToolInput, ToolOutput
    class MockLLM(BaseTool):
        name = "llm"
        description = "Mock LLM"
        parameters_schema = {}
        async def execute(self, input: ToolInput) -> ToolOutput:
            return ToolOutput(result={"content": '{"score": 0.9, "issues": []}'})
    return MockLLM()

@pytest.fixture
def event_bus():
    from events.event_bus import EventBus
    return EventBus()

@pytest.fixture
def tool_registry(mock_llm_tool):
    from tools.registry import ToolRegistry
    from tools.cache import CacheTool
    registry = ToolRegistry()
    registry.register(mock_llm_tool)
    registry.register(CacheTool())
    return registry

@pytest.fixture
def mode_registry():
    from modes.registry import ModeRegistry
    from modes.workflow import WorkflowExecutor
    from modes.reflexion import ReflexionExecutor
    from modes.react import ReActExecutor
    registry = ModeRegistry()
    registry.register(WorkflowExecutor())
    registry.register(ReflexionExecutor())
    registry.register(ReActExecutor())
    return registry
