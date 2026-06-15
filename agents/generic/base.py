import json
import re
import time
from abc import ABC
from typing import Any, Optional

from flowforge.core.base_agent import BaseAgent, AgentInput, AgentOutput
from flowforge.core.base_tool import ToolInput
from flowforge.core.task_context import TaskContext
from flowforge.core.tracing import get_logger

logger = get_logger("generic_agent")


class GenericAgent(BaseAgent, ABC):
    default_mode: Optional[str] = "react"

    def __init__(self, llm_client: Any = None, tool_registry: Any = None) -> None:
        self._llm_client = llm_client
        self._tool_registry = tool_registry

    async def execute(self, input: AgentInput) -> AgentOutput:
        return await self.execute_with_context(input, None)

    async def execute_with_context(self, input: AgentInput, context: Optional[TaskContext]) -> AgentOutput:
        agent_name = getattr(self, 'name', type(self).__name__)
        task_id = context.task_id if context else "no_context"
        logger.info(f"[generic_agent] execute_with_context entry: agent={agent_name}, task_id={task_id}")
        start_time = time.time()
        try:
            result = await self.execute(input)
            elapsed = time.time() - start_time
            logger.info(f"[generic_agent] execute_with_context exit: agent={agent_name}, task_id={task_id}, elapsed={elapsed:.2f}s")
            return result
        except Exception as e:
            elapsed = time.time() - start_time
            logger.error(f"[generic_agent] execute_with_context failed: agent={agent_name}, task_id={task_id}, elapsed={elapsed:.2f}s, error={e}")
            raise

    async def _call_llm(self, context: Optional[TaskContext], prompt: str) -> str:
        agent_name = getattr(self, 'name', type(self).__name__)
        task_id = context.task_id if context else "no_context"
        logger.info(f"[generic_agent] LLM call start: agent={agent_name}, task_id={task_id}, prompt_len={len(prompt)}")
        start_time = time.time()
        messages = [{"role": "user", "content": prompt}]
        tool_params: dict[str, Any] = {"messages": messages, "model": "default"}
        if context is not None and context.tools is not None:
            llm = context.tools.get_tool("llm")
            result = await llm.execute(ToolInput(params=tool_params))
            elapsed = time.time() - start_time
            content = result.result.get("content", "")
            logger.info(f"[generic_agent] LLM call end: agent={agent_name}, task_id={task_id}, elapsed={elapsed:.2f}s, response_len={len(content)}")
            return content
        if self._llm_client is not None:
            result = await self._llm_client.execute(ToolInput(params=tool_params))
            elapsed = time.time() - start_time
            content = result.result.get("content", "")
            logger.info(f"[generic_agent] LLM call end (llm_client): agent={agent_name}, task_id={task_id}, elapsed={elapsed:.2f}s, response_len={len(content)}")
            return content
        raise RuntimeError("No LLM client available: provide context or llm_client")

    async def _call_tool(self, context: Optional[TaskContext], tool_name: str, params: dict[str, Any]) -> dict[str, Any]:
        agent_name = getattr(self, 'name', type(self).__name__)
        task_id = context.task_id if context else "no_context"
        logger.info(f"[generic_agent] Tool call start: agent={agent_name}, task_id={task_id}, tool={tool_name}")
        start_time = time.time()
        if context is not None and context.tools is not None:
            tool = context.tools.get_tool(tool_name)
            result = await tool.execute(ToolInput(params=params))
            elapsed = time.time() - start_time
            logger.info(f"[generic_agent] Tool call end: agent={agent_name}, task_id={task_id}, tool={tool_name}, elapsed={elapsed:.2f}s")
            return result.result
        if self._tool_registry is not None:
            tool = self._tool_registry.get_tool(tool_name)
            result = await tool.execute(ToolInput(params=params))
            elapsed = time.time() - start_time
            logger.info(f"[generic_agent] Tool call end (tool_registry): agent={agent_name}, task_id={task_id}, tool={tool_name}, elapsed={elapsed:.2f}s")
            return result.result
        raise RuntimeError(f"Tool '{tool_name}' not available")

    def _get_prompt(self, key: str, fallback: str = "", **kwargs) -> str:
        """从 PromptManager 加载提示词，失败时使用 fallback。"""
        try:
            from flowforge.core.prompt_manager import get_prompt
            result = get_prompt(key, **kwargs)
            if result:
                return result
        except Exception:
            pass
        if fallback and kwargs:
            try:
                return fallback.format(**kwargs)
            except (KeyError, ValueError, IndexError):
                pass
        return fallback or ""

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
