import pytest
from flowforge.tools.registry import ToolRegistry
from flowforge.tools.cache import CacheTool
from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.errors import ToolNotFoundError

class EchoTool(BaseTool):
    name = "echo"
    async def execute(self, input: ToolInput) -> ToolOutput:
        return ToolOutput(result=input.params)

def test_tool_registry():
    registry = ToolRegistry()
    registry.register(EchoTool())
    tool = registry.get_tool("echo")
    assert tool.name == "echo"

def test_tool_registry_not_found():
    registry = ToolRegistry()
    with pytest.raises(ToolNotFoundError):
        registry.get_tool("nonexistent")

@pytest.mark.asyncio
async def test_cache_tool():
    cache = CacheTool()
    await cache.execute(ToolInput(params={"key": "test", "action": "set", "value": {"data": "hello"}}))
    result = await cache.execute(ToolInput(params={"key": "test", "action": "get"}))
    assert result.result["data"] == {"data": "hello"}
