import time
from typing import Dict, Optional, Callable
from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.errors import ToolNotFoundError


class ToolRegistry:
    def __init__(self):
        self._tools: Dict[str, BaseTool] = {}
        self._emit_callback: Optional[Callable] = None

    def set_emit_callback(self, callback: Callable):
        self._emit_callback = callback

    def register(self, tool: BaseTool):
        if tool.name in self._tools:
            raise ValueError(f"Tool '{tool.name}' already registered")
        self._tools[tool.name] = tool

    def get_tool(self, name: str) -> BaseTool:
        if name not in self._tools:
            raise ToolNotFoundError(f"Tool '{name}' not found")
        return self._tools[name]

    async def execute(self, name: str, input: ToolInput) -> ToolOutput:
        tool = self.get_tool(name)
        if not tool.validate_params(input.params):
            raise ValueError(f"Invalid params for tool '{name}'")

        if self._emit_callback:
            await self._emit_callback("tool.start", {"tool_name": name, "params": input.params})

        start = time.time()
        try:
            result = await tool.execute(input)
        except Exception as e:
            if self._emit_callback:
                await self._emit_callback("tool.end", {"tool_name": name, "error": str(e), "duration_ms": int((time.time()-start)*1000)})
            raise

        if self._emit_callback:
            await self._emit_callback("tool.end", {"tool_name": name, "result": result.result, "duration_ms": int((time.time()-start)*1000)})
        return result

    def list_tools(self) -> list:
        return list(self._tools.keys())
