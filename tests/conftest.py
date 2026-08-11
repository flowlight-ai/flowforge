import os
import sys
import gc
import pytest
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT.parent))

DATA_DIR = PROJECT_ROOT / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

@pytest.fixture
def project_root() -> Path:
    """仓库根路径（即 flowforge 包本身所在目录）。"""
    return PROJECT_ROOT

@pytest.fixture(autouse=True)
def setup_test_env():
    # P-10: 用 setdefault 而非直接赋值，避免覆盖真实环境中的 API key。
    # 直接覆盖为 test-key 会使 T7Reviewer 解析到无效 key，导致依赖 T7
    # 审核的用例全部 401 假失败（本地 OpenRoute 网关实际可用）。
    os.environ.setdefault("FLOWFORGE_ENV", "test")
    os.environ.setdefault("OPENROUTER_API_KEY", "test-key")
    os.environ.setdefault("OPENROUTE_API_KEY", "test-key")
    yield
    gc.collect()

@pytest.fixture
def mock_llm_tool():
    if os.environ.get("FLOWFORGE_REAL_LLM") == "1":
        from flowforge.tools.llm_client import LLMClient
        return LLMClient()
    from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
    class MockLLM(BaseTool):
        name = "llm"
        description = "Mock LLM"
        parameters_schema = {}
        async def execute(self, input: ToolInput) -> ToolOutput:
            return ToolOutput(result={"content": '{"score": 0.9, "issues": []}'})
    return MockLLM()

@pytest.fixture
def event_bus():
    from flowforge.events.event_bus import EventBus
    return EventBus()

@pytest.fixture
def tool_registry(mock_llm_tool):
    from flowforge.tools.registry import ToolRegistry
    from flowforge.tools.cache import CacheTool
    registry = ToolRegistry()
    registry.register(mock_llm_tool)
    registry.register(CacheTool())
    return registry

@pytest.fixture
def mode_registry():
    from flowforge.modes.registry import ModeRegistry
    from flowforge.modes.workflow import WorkflowExecutor
    from flowforge.modes.reflexion import ReflexionExecutor
    from flowforge.modes.react import ReActExecutor
    registry = ModeRegistry()
    registry.register(WorkflowExecutor())
    registry.register(ReflexionExecutor())
    registry.register(ReActExecutor())
    return registry
