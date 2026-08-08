"""Workflow ReAct loop module.

Handles the ReAct (Reason-Act) loop execution pattern.
Extracted from WorkflowExecutor to reduce God Object complexity.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

from flowforge.core.base_tool import ToolInput
from flowforge.core.tracing import get_logger
from flowforge.core.prompt_manager import get_prompt

if TYPE_CHECKING:
    from flowforge.modes.workflow_executor import WorkflowExecutor

logger = get_logger("workflow_react")


class ReactHandler:
    """ReAct循环处理器 - 负责ReAct推理-行动循环"""

    def __init__(self, executor: WorkflowExecutor) -> None:
        self._executor = executor

    async def run_react_loop(self, ctx, intent: str,
                              tool_schemas: list, model_hint: str, persona: str) -> dict:
        defense_config = ctx.metadata.get("_defense", self._executor.DEFAULT_DEFENSE)
        max_tool_calls = defense_config.get("max_tool_calls", 50)
        tool_timeout = defense_config.get("tool_timeout", 120)
        repetition_limit = defense_config.get("repetition_limit", 3)

        tool_desc_text = self._executor._build_tool_descriptions_text(ctx)
        system_prompt = get_prompt("react.orchestrator", tool_descriptions=tool_desc_text)

        all_messages = [{"role": "system", "content": system_prompt}, {"role": "user", "content": intent}]

        execution_trace = []
        collected_context = ""
        tool_calls_made = 0
        tool_call_history = []
        max_iterations = 3
        iteration = -1

        for iteration in range(max_iterations):
            if tool_calls_made >= max_tool_calls:
                logger.warning(f"Tool call limit reached: {tool_calls_made}/{max_tool_calls}")
                break

            if len(all_messages) > 10:
                all_messages = [all_messages[0]] + all_messages[-8:]

            llm_params = {
                "messages": all_messages,
                "stream": False,
                "persona": persona,
                "agent_name": "react_orchestrator",
                "task_id": ctx.task_id,
            }
            if tool_schemas:
                llm_params["tools"] = tool_schemas
            if model_hint and model_hint != "auto":
                llm_params["model"] = model_hint

            tool_input = ToolInput(params=llm_params)
            try:
                tool_output = await ctx.tools.execute("llm", tool_input)
            except Exception as e:
                logger.error(f"ReAct LLM call failed: {e}")
                break

            if not tool_output or not tool_output.result:
                break

            result = tool_output.result
            content_text = result.get("content", "")
            tool_calls = result.get("tool_calls")
            raw_message = result.get("raw_message")

            if not tool_calls:
                if content_text:
                    collected_context += f"\n\n{content_text[:2000]}"
                break

            assistant_msg = raw_message if raw_message else {"role": "assistant", "content": content_text}
            if "role" not in assistant_msg:
                assistant_msg["role"] = "assistant"
            all_messages.append(assistant_msg)

            if content_text:
                collected_context += f"\n\n## 思考\n{content_text[:500]}"

            for tool_call in tool_calls:
                if tool_calls_made >= max_tool_calls:
                    logger.warning(f"Tool call limit reached during tool_calls processing")
                    break

                func_info = tool_call.get("function", {})
                call_name = func_info.get("name", "")
                arguments_str = func_info.get("arguments", "{}")
                tool_call_id = tool_call.get("id", "")

                try:
                    arguments = json.loads(arguments_str) if isinstance(arguments_str, str) else arguments_str
                except json.JSONDecodeError:
                    arguments = {}

                ctx.event_bus.emit(ctx.task_id, "workflow.step.start", {
                    "step": call_name, "label": f"调用 {call_name}",
                    "stage": call_name, "iteration": iteration + 1,
                })

                tool_result = await self._executor._execute_tool_or_agent(ctx, call_name, arguments)

                if isinstance(tool_result, dict) and tool_result.get("success") is False:
                    err_msg = tool_result.get("error", "")
                    if "Unknown tool/agent" in err_msg:
                        logger.error(f"Critical failure in ReAct loop: {err_msg}, aborting task", task_id=ctx.task_id)
                        raise RuntimeError(f"工具/Agent调用失败: {err_msg}")

                tool_call_history.append(call_name)
                if len(tool_call_history) >= repetition_limit:
                    recent = tool_call_history[-repetition_limit:]
                    if len(set(recent)) == 1:
                        logger.warning(f"ReAct loop detected: {call_name} called {repetition_limit} times in a row, forcing stop")
                        collected_context += f"\n\n## {call_name} 已完成（检测到重复调用，自动终止）"
                        break

                tool_result_content = json.dumps(tool_result, ensure_ascii=False)[:1500]
                all_messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call_id,
                    "content": tool_result_content,
                })

                tool_calls_made += 1

                if tool_result.get("success"):
                    result_data = tool_result.get("result", {})
                    result_summary = json.dumps(result_data, ensure_ascii=False)[:1000]
                    collected_context += f"\n\n## {call_name} 结果\n{result_summary}"
                else:
                    collected_context += f"\n\n## {call_name} 失败\n{tool_result.get('error', '未知错误')}"

                execution_trace.append({
                    "iteration": iteration + 1,
                    "name": call_name,
                    "success": tool_result.get("success", False),
                })

                ctx.event_bus.emit(ctx.task_id, "workflow.step.complete", {
                    "step": call_name,
                    "success": tool_result.get("success", False),
                })

        return {
            "iterations": iteration + 1,
            "tool_calls_made": tool_calls_made,
            "collected_context": collected_context,
            "execution_trace": execution_trace,
        }
