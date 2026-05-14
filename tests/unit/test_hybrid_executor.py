import pytest
import asyncio
from flowforge.executor.hybrid_executor import HybridExecutor
from flowforge.modes.registry import ModeRegistry
from flowforge.modes.react import ReActExecutor
from flowforge.events.event_bus import EventBus
from flowforge.tools.registry import ToolRegistry
from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.task_context import TaskContext
from flowforge.core.errors import ConflictError
import tempfile
import os

class SlowMockLLM(BaseTool):
    name = "llm"
    description = "Slow Mock LLM"
    parameters_schema = {}
    async def execute(self, input: ToolInput) -> ToolOutput:
        await asyncio.sleep(2)
        return ToolOutput(result={"content": "slow response"})

def _make_temp_db():
    return tempfile.mktemp(suffix=".db")

@pytest.mark.asyncio
async def test_hybrid_executor_persona_lock():
    mode_registry = ModeRegistry()
    mode_registry.register(ReActExecutor())
    tool_registry = ToolRegistry()
    tool_registry.register(SlowMockLLM())
    event_bus = EventBus()
    executor = HybridExecutor(
        mode_registry, None, tool_registry, event_bus,
        checkpointer_path=_make_temp_db(), state_db_path=_make_temp_db()
    )
    ctx1 = TaskContext(task_id="t1", persona="education", input_data={"task": "test"}, event_bus=event_bus)
    ctx2 = TaskContext(task_id="t2", persona="education", input_data={"task": "test"}, event_bus=event_bus)
    task1 = asyncio.create_task(executor.run(ctx1, mode_hint="react"))
    await asyncio.sleep(0.1)
    with pytest.raises(ConflictError):
        await executor.run(ctx2, mode_hint="react")
    task1.cancel()
    try:
        await task1
    except (asyncio.CancelledError, Exception):
        pass

@pytest.mark.asyncio
async def test_hybrid_executor_substep_skips_lock():
    mode_registry = ModeRegistry()
    mode_registry.register(ReActExecutor())
    tool_registry = ToolRegistry()
    tool_registry.register(SlowMockLLM())
    event_bus = EventBus()
    executor = HybridExecutor(
        mode_registry, None, tool_registry, event_bus,
        checkpointer_path=_make_temp_db(), state_db_path=_make_temp_db()
    )
    executor._running_tasks["education"] = "t1"
    ctx = TaskContext(task_id="t1-sub", persona="education", input_data={"task": "test"}, event_bus=event_bus)
    result = await executor.run(ctx, mode_hint="react", _is_substep=True)
    assert result is not None
