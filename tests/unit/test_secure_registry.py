import pytest
import asyncio
from flowforge.tools.secure_registry import SecureToolRegistry
from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.task_context import TaskContext
from flowforge.events.event_bus import EventBus


class ReadOnlyTool(BaseTool):
    name = "reader"
    description = "Read-only tool"
    safety_level = "readonly"

    async def execute(self, input):
        return ToolOutput(result={"data": "read"})


class NormalTool(BaseTool):
    name = "writer"
    description = "Normal tool"
    safety_level = "normal"

    async def execute(self, input):
        return ToolOutput(result={"written": True})


class DangerousTool(BaseTool):
    name = "deleter"
    description = "Dangerous tool"
    safety_level = "dangerous"

    async def execute(self, input):
        return ToolOutput(result={"deleted": True})


class NonConcurrentTool(BaseTool):
    name = "exclusive"
    description = "Non-concurrent tool"
    safety_level = "normal"
    is_concurrency_safe = False

    async def execute(self, input):
        await asyncio.sleep(0.1)
        return ToolOutput(result={"exclusive": True})


@pytest.mark.asyncio
async def test_readonly_tool_bypasses_checks():
    registry = SecureToolRegistry()
    registry.register(ReadOnlyTool())
    result = await registry.execute("reader", ToolInput(params={}))
    assert result.result["data"] == "read"


@pytest.mark.asyncio
async def test_normal_tool_executes_directly():
    registry = SecureToolRegistry()
    registry.register(NormalTool())
    result = await registry.execute("writer", ToolInput(params={}))
    assert result.result["written"] is True


@pytest.mark.asyncio
async def test_dangerous_tool_denied_without_approval():
    registry = SecureToolRegistry()
    registry.register(DangerousTool())
    ctx = TaskContext(task_id="t1", input_data={})
    result = await registry.execute("deleter", ToolInput(params={}), context=ctx)
    assert result.error is not None
    assert "denied" in result.error.lower()


@pytest.mark.asyncio
async def test_dangerous_tool_approved_with_require_approval_false():
    registry = SecureToolRegistry()
    registry.register(DangerousTool())
    result = await registry.execute("deleter", ToolInput(params={}), require_approval=False)
    assert result.result["deleted"] is True


@pytest.mark.asyncio
async def test_non_concurrent_tool_serialized():
    registry = SecureToolRegistry()
    registry.register(NonConcurrentTool())
    results = await asyncio.gather(
        registry.execute("exclusive", ToolInput(params={})),
        registry.execute("exclusive", ToolInput(params={})),
    )
    assert all(r.result["exclusive"] for r in results)


def test_set_tool_safety():
    registry = SecureToolRegistry()
    registry.register(NormalTool())
    registry.set_tool_safety("writer", "dangerous")
    tool = registry.get_tool("writer")
    assert tool.safety_level == "dangerous"


def test_auto_assign_safety_level():
    registry = SecureToolRegistry()

    class NoSafetyAttrTool(BaseTool):
        name = "bare"

        async def execute(self, input):
            return ToolOutput(result={})

    tool = NoSafetyAttrTool()
    registry.register(tool)
    assert tool.safety_level == "normal"
