import pytest
from modes.registry import ModeRegistry
from modes.workflow import WorkflowExecutor
from modes.reflexion import ReflexionExecutor
from modes.react import ReActExecutor
from core.errors import ModeNotFoundError

def test_mode_registry():
    registry = ModeRegistry()
    registry.register(WorkflowExecutor())
    registry.register(ReflexionExecutor())
    assert "workflow" in registry.list_modes()
    assert "reflexion" in registry.list_modes()

def test_mode_registry_not_found():
    registry = ModeRegistry()
    with pytest.raises(ModeNotFoundError):
        registry.get("nonexistent")

def test_mode_registry_suggest():
    registry = ModeRegistry()
    assert registry.suggest_mode("复杂数学证明") == "graph_of_thoughts"
    assert registry.suggest_mode("多步搜索查询") == "react"
    assert registry.suggest_mode("生成写作") == "reflexion"
    assert registry.suggest_mode("其他任务") == "workflow"

@pytest.mark.asyncio
async def test_workflow_recursion_limit():
    executor = WorkflowExecutor()
    from core.task_context import TaskContext
    from core.errors import WorkflowRecursionError
    ctx = TaskContext(task_id="t1", input_data={}, metadata={"_workflow_depth": 3})
    with pytest.raises(WorkflowRecursionError):
        await executor._execute_core(ctx)
