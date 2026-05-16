import json
import re
from abc import ABC
from typing import Any, Optional

from flowforge.core.base_agent import BaseAgent, AgentInput, AgentOutput
from flowforge.core.base_tool import ToolInput
from flowforge.core.task_context import TaskContext


class GenericAgent(BaseAgent, ABC):
    default_mode: Optional[str] = "react"

    def __init__(self, llm_client: Any = None, tool_registry: Any = None) -> None:
        self._llm_client = llm_client
        self._tool_registry = tool_registry

    async def execute(self, input: AgentInput) -> AgentOutput:
        return await self.execute_with_context(input, None)

    async def _call_llm(self, context: Optional[TaskContext], prompt: str) -> str:
        messages = [{"role": "user", "content": prompt}]
        tool_params: dict[str, Any] = {"messages": messages, "model": "default"}
        if context is not None and context.tools is not None:
            llm = context.tools.get_tool("llm")
            result = await llm.execute(ToolInput(params=tool_params))
            return result.result.get("content", "")
        if self._llm_client is not None:
            result = await self._llm_client.execute(ToolInput(params=tool_params))
            return result.result.get("content", "")
        raise RuntimeError("No LLM client available: provide context or llm_client")

    async def _call_tool(self, context: Optional[TaskContext], tool_name: str, params: dict[str, Any]) -> dict[str, Any]:
        if context is not None and context.tools is not None:
            tool = context.tools.get_tool(tool_name)
            result = await tool.execute(ToolInput(params=params))
            return result.result
        if self._tool_registry is not None:
            tool = self._tool_registry.get_tool(tool_name)
            result = await tool.execute(ToolInput(params=params))
            return result.result
        raise RuntimeError(f"Tool '{tool_name}' not available")

    @staticmethod
    def _extract_json(text: str) -> Any:
        match = re.search(r'```(?:json)?\s*([\s\S]*?)```', text)
        if match:
            text = match.group(1)
        text = text.strip()
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            start = text.find('{')
            if start == -1:
                start = text.find('[')
            if start != -1:
                try:
                    return json.loads(text[start:])
                except json.JSONDecodeError:
                    pass
        return text
