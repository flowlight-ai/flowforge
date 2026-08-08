import pytest
import asyncio
from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.base_mode_executor import BaseModeExecutor
from flowforge.core.task_context import TaskContext
from flowforge.tools.registry import ToolRegistry
from flowforge.events.event_bus import EventBus


class SlowTool(BaseTool):
    name = "slow_tool"
    description = "Slow tool"
    parameters_schema = {}

    async def execute(self, input: ToolInput) -> ToolOutput:
        await asyncio.sleep(10)
        return ToolOutput(result={"done": True})


@pytest.mark.asyncio
async def test_tool_timeout_l1_defense():
    registry = ToolRegistry(tool_timeout=1)
    registry.register(SlowTool())
    result = await registry.execute("slow_tool", ToolInput(params={}))
    assert result.error is not None
    assert "timed out" in result.error.lower()


@pytest.mark.asyncio
async def test_tool_timeout_default():
    registry = ToolRegistry()
    registry.register(SlowTool())
    assert registry._tool_timeout == 120


@pytest.mark.asyncio
async def test_base_mode_executor_on_enter_exit_hooks():
    call_log = []

    class TestExecutor(BaseModeExecutor):
        mode_name = "test"

        async def _on_enter(self, ctx):
            call_log.append("enter")

        async def _execute_core(self, ctx):
            call_log.append("execute")
            return {"result": "ok"}

        async def _on_exit(self, ctx, result):
            call_log.append("exit")
            result["modified"] = True
            return result

    executor = TestExecutor()
    ctx = TaskContext(task_id="t1", input_data={})
    result = await executor.run(ctx)
    assert call_log == ["enter", "execute", "exit"]
    assert result["modified"] is True


@pytest.mark.asyncio
async def test_safety_level_on_base_tool():
    class ReadOnlyTool(BaseTool):
        name = "reader"
        safety_level = "readonly"

        async def execute(self, input):
            return ToolOutput(result={"data": "read"})

    tool = ReadOnlyTool()
    assert tool.safety_level == "readonly"
    assert tool.is_concurrency_safe is True


@pytest.mark.asyncio
async def test_dangerous_tool_safety_level():
    class DangerousTool(BaseTool):
        name = "rm_rf"
        safety_level = "dangerous"
        is_concurrency_safe = False

        async def execute(self, input):
            return ToolOutput(result={"deleted": True})

    tool = DangerousTool()
    assert tool.safety_level == "dangerous"
    assert tool.is_concurrency_safe is False
