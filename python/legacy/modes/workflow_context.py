"""Workflow context management module.

Handles LLM calls, memory operations, tool descriptions, and template rendering.
Extracted from WorkflowExecutor to reduce God Object complexity.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

from flowforge.core.base_tool import ToolInput
from flowforge.core.tracing import get_logger

if TYPE_CHECKING:
    from flowforge.modes.workflow_executor import WorkflowExecutor

logger = get_logger("workflow_context")


class ContextHandler:
    """上下文管理处理器 - 负责LLM调用、记忆操作和上下文构建"""

    def __init__(self, executor: WorkflowExecutor) -> None:
        self._executor = executor

    async def call_llm(self, ctx, messages: list, model_hint: str,
                       agent_name: str = "helm_assistant", persona: str = "default") -> str:
        llm_params = {
            "messages": messages,
            "stream": False,
            "persona": persona,
            "agent_name": agent_name,
            "task_id": ctx.task_id,
        }
        if model_hint and model_hint != "auto":
            llm_params["model"] = model_hint

        if ctx.tools:
            tool_input = ToolInput(params=llm_params)
            tool_output = await ctx.tools.execute("llm", tool_input)
            content = tool_output.result.get("content", "") if tool_output.result else ""
            if tool_output.error and not content:
                logger.error(f"_call_llm LLM failed: {tool_output.error[:200]}", task_id=ctx.task_id)
                raise RuntimeError(f"LLM 调用失败: {tool_output.error[:200]}")
            return content
        else:
            from flowforge.tools.llm_client import LLMClient
            llm = LLMClient(event_bus=ctx.event_bus)
            tool_input = ToolInput(params=llm_params)
            tool_output = await llm.execute(tool_input)
            content = tool_output.result.get("content", "") if tool_output.result else ""
            if tool_output.error and not content:
                logger.error(f"_call_llm LLM failed (no ctx.tools): {tool_output.error[:200]}", task_id=ctx.task_id)
                raise RuntimeError(f"LLM 调用失败: {tool_output.error[:200]}")
            return content

    async def recall_memories(self, ctx, intent: str) -> list:
        if not ctx.memory:
            return []
        try:
            results = await ctx.memory.hybrid_search(intent, types=["episodic", "long_term"])
            if results:
                logger.info(f"Memory recall: found {len(results)} relevant memories for '{intent[:50]}'")
            return results
        except Exception as e:
            logger.warning(f"Memory recall failed: {e}")
            return []

    async def save_to_memory(self, ctx, intent: str, result: dict, plan: dict) -> None:
        if not ctx.memory:
            return
        try:
            trace = {
                "task_id": ctx.task_id,
                "intent": intent[:200],
                "mode": ctx.mode,
                "persona": ctx.persona,
                "intent_type": plan.get("intent_type", "chat"),
                "complexity": plan.get("complexity", "simple"),
                "step_count": len(plan.get("plan", [])),
                "response_length": len(str(result.get("response", ""))),
                "status": "completed",
            }
            await ctx.memory.save("episodic", ctx.task_id, trace)
            await ctx.memory.save("working", "last_task", trace)
            if plan.get("intent_type") != "chat":
                await ctx.memory.save("long_term", intent[:100], trace)
            logger.info(f"Memory saved: episodic+working for task {ctx.task_id}")
        except Exception as e:
            logger.warning(f"Memory save failed: {e}")

    def build_tool_descriptions_text(self, ctx) -> str:
        lines = []
        if ctx.agents:
            try:
                for name in ctx.agents.list_agents():
                    try:
                        agent = ctx.agents.get(name)
                        desc = getattr(agent, 'description', '') or ''
                        lines.append(f"- **{name}** (Agent): {desc}")
                    except Exception:
                        lines.append(f"- **{name}** (Agent)")
            except Exception:
                pass
        if ctx.tools:
            try:
                for name in ctx.tools.list_tools():
                    if name == "llm":
                        continue
                    try:
                        tool = ctx.tools.get_tool(name)
                        desc = getattr(tool, 'description', '') or ''
                        lines.append(f"- **{name}** (Tool): {desc}")
                    except Exception:
                        lines.append(f"- **{name}** (Tool)")
            except Exception:
                pass
        return "\n".join(lines) if lines else "无可用工具"

    def render_template(self, text: str, context_data: dict) -> str:
        def replace_var(match):
            key = match.group(1)
            return str(context_data.get(key, match.group(0)))
        return re.sub(r'\{\{(\w+)\}\}', replace_var, text)
