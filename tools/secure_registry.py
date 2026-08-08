import asyncio
from typing import Dict, Optional
from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.task_context import TaskContext
from flowforge.tools.registry import ToolRegistry


class SecureToolRegistry(ToolRegistry):
    SAFETY_READONLY = "readonly"
    SAFETY_NORMAL = "normal"
    SAFETY_DANGEROUS = "dangerous"

    def __init__(self, event_bus=None, tool_timeout: int = 120):
        super().__init__(tool_timeout=tool_timeout)
        self._event_bus = event_bus
        self._running_tools: Dict[str, asyncio.Lock] = {}

    def register(self, tool: BaseTool):
        if not hasattr(tool, 'safety_level'):
            tool.safety_level = self.SAFETY_NORMAL
        if not hasattr(tool, 'is_concurrency_safe'):
            tool.is_concurrency_safe = True
        super().register(tool)

    async def execute(self, name: str, input: ToolInput,
                      context: Optional[TaskContext] = None,
                      require_approval: bool = True) -> ToolOutput:
        tool = self.get_tool(name)
        safety = getattr(tool, 'safety_level', self.SAFETY_NORMAL)

        if safety == self.SAFETY_READONLY:
            return await super().execute(name, input)

        if safety == self.SAFETY_DANGEROUS and require_approval and context:
            approved = await self._request_approval(context, name, input.params)
            if not approved:
                return ToolOutput(result={}, error=f"Permission denied for dangerous tool '{name}'")

        if not getattr(tool, 'is_concurrency_safe', True):
            if name not in self._running_tools:
                self._running_tools[name] = asyncio.Lock()
            async with self._running_tools[name]:
                return await super().execute(name, input)

        return await super().execute(name, input)

    async def _request_approval(self, context: TaskContext, tool_name: str, params: dict) -> bool:
        if self._event_bus:
            self._event_bus.emit(context.task_id, "permission.requested", {
                "tool": tool_name, "params": params, "task_id": context.task_id
            })
        if hasattr(context, 'executor') and context.executor:
            review_event = context.executor.register_review_wait(
                f"{context.task_id}_tool_{tool_name}")
            await review_event.wait()
            state = context.executor.state_manager.load_state(context.task_id)
            return state.get("review_verdict") == "approved"
        return False

    def set_tool_safety(self, name: str, level: str):
        tool = self.get_tool(name)
        tool.safety_level = level
