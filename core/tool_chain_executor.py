"""Tool chain executor implementing the ReAct pattern for LLM tool calling.

Orchestrates the loop: LLM call -> parse tool_calls -> execute tools ->
feed results back -> repeat until final answer.

License: MIT
"""

import json
import time
from typing import Any

from flowforge.core import metrics
from flowforge.core.base_tool import ToolInput
from flowforge.core.tracing import get_logger

logger = get_logger("tool_chain_executor")


class ToolChainExecutor:
    """Orchestrates LLM + tool calls in a ReAct loop.

    The executor repeatedly calls the LLM with available tools, parses
    tool_calls from the response, executes them via the tool registry,
    and feeds results back until the LLM produces a final answer with
    no more tool_calls.

    Attributes:
        llm_client: The LLMClient instance for making LLM calls.
        tool_registry: The ToolRegistry for executing tool calls.
        event_bus: Optional event bus for emitting lifecycle events.
        max_iterations: Maximum number of LLM rounds before forcing a stop.
    """

    def __init__(self, llm_client, tool_registry, event_bus=None, max_iterations: int = 3):
        self.llm_client = llm_client
        self.tool_registry = tool_registry
        self.event_bus = event_bus
        self.max_iterations = max_iterations

    async def execute(
        self,
        task_id: str,
        messages: list[dict[str, Any]],
        tools: list[str] | None = None,
        system_prompt: str | None = None,
        model: str = "auto",
        persona: str = "default",
        agent_name: str = "helm_assistant",
        temperature: float = 0.7,
        max_tokens: int = 4000,
    ) -> dict[str, Any]:
        """Execute a tool chain loop.

        1. Build messages with system prompt + tool schemas
        2. Call LLM
        3. If LLM response contains tool_calls, execute them via tool_registry
        4. Add tool results to messages
        5. Repeat until no more tool_calls or max_iterations reached
        6. Return final response and execution trace

        Args:
            task_id: Task identifier for event emission.
            messages: Initial message list (OpenAI format).
            tools: Optional list of tool names to make available.
            system_prompt: Optional system prompt prepended to messages.
            model: Model hint ("auto" for automatic selection).
            persona: Persona identifier for model routing.
            agent_name: Agent name for model routing.
            temperature: LLM sampling temperature.
            max_tokens: Maximum tokens for LLM response.

        Returns:
            Dict with keys: content, execution_trace, iterations, total_tokens.
        """
        tool_schemas = self._build_tool_schemas(tools)

        all_messages: list[dict[str, Any]] = []
        if system_prompt:
            all_messages.append({"role": "system", "content": system_prompt})
        all_messages.extend(messages)

        execution_trace: list[dict[str, Any]] = []
        total_tokens = 0
        final_content = ""
        used_model = ""
        used_provider = ""
        tool_call_history: list[str] = []

        for iteration in range(self.max_iterations):
            if len(all_messages) > 12:
                all_messages = [all_messages[0]] + all_messages[-10:]
            self._emit_event(task_id, "tool_chain.iteration", {
                "iteration": iteration + 1,
                "max_iterations": self.max_iterations,
                "message_count": len(all_messages),
            })

            llm_params = {
                "messages": all_messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
                "stream": False,
                "persona": persona,
                "agent_name": agent_name,
                "task_id": task_id,
            }
            if tool_schemas:
                llm_params["tools"] = tool_schemas
            if model and model != "auto":
                llm_params["model"] = model

            tool_input = ToolInput(params=llm_params)
            tool_output = await self.llm_client.execute(tool_input)

            if tool_output.error:
                logger.error(f"LLM call failed in tool chain iteration {iteration + 1}: {tool_output.error}")
                return {
                    "content": final_content or f"LLM call failed: {tool_output.error}",
                    "execution_trace": execution_trace,
                    "iterations": iteration + 1,
                    "total_tokens": total_tokens,
                    "error": tool_output.error,
                }

            result = tool_output.result or {}
            content_text = result.get("content", "")
            tool_calls = result.get("tool_calls")
            raw_message = result.get("raw_message")
            tokens = result.get("tokens", 0)
            used_provider = result.get("provider", used_provider)
            used_model = result.get("model", used_model)
            total_tokens += tokens

            if not tool_calls:
                final_content = content_text
                self._emit_event(task_id, "tool_chain.complete", {
                    "iterations": iteration + 1,
                    "total_tokens": total_tokens,
                    "tool_calls_made": len(execution_trace),
                })
                return {
                    "content": final_content,
                    "execution_trace": execution_trace,
                    "iterations": iteration + 1,
                    "total_tokens": total_tokens,
                    "provider": used_provider,
                    "model": used_model,
                }

            assistant_msg = raw_message if raw_message else {"role": "assistant", "content": content_text}
            if "role" not in assistant_msg:
                assistant_msg["role"] = "assistant"
            all_messages.append(assistant_msg)

            for tool_call in tool_calls:
                func_info = tool_call.get("function", {})
                tool_name = func_info.get("name", "")
                arguments_str = func_info.get("arguments", "{}")
                tool_call_id = tool_call.get("id", "")

                try:
                    arguments = json.loads(arguments_str) if isinstance(arguments_str, str) else arguments_str
                except json.JSONDecodeError:
                    arguments = {}

                tool_call_history.append(tool_name)
                if len(tool_call_history) >= 3:
                    recent = tool_call_history[-3:]
                    if len(set(recent)) == 1:
                        logger.warning(f"Tool chain loop detected: {tool_name} called {len(tool_call_history)} times")
                        all_messages.append({
                            "role": "tool",
                            "tool_call_id": tool_call_id,
                            "content": json.dumps({"success": True, "result": "已完成，无需重复调用"}, ensure_ascii=False),
                        })
                        execution_trace.append({
                            "tool": tool_name,
                            "arguments": arguments,
                            "result": {"skipped": True, "reason": "loop_detected"},
                            "iteration": iteration + 1,
                        })
                        continue

                self._emit_event(task_id, "tool_chain.tool_call", {
                    "tool": tool_name,
                    "arguments": arguments,
                    "iteration": iteration + 1,
                })

                tool_result = await self._execute_tool_call(tool_name, arguments)

                all_messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call_id,
                    "content": json.dumps(tool_result, ensure_ascii=False),
                })

                execution_trace.append({
                    "tool": tool_name,
                    "arguments": arguments,
                    "result": tool_result,
                    "iteration": iteration + 1,
                })

                self._emit_event(task_id, "tool_chain.tool_result", {
                    "tool": tool_name,
                    "iteration": iteration + 1,
                })

            final_content = content_text

        logger.warning(f"Tool chain reached max iterations ({self.max_iterations})")
        self._emit_event(task_id, "tool_chain.max_iterations", {
            "iterations": self.max_iterations,
            "total_tokens": total_tokens,
        })
        return {
            "content": final_content or "Max iterations reached without final answer",
            "execution_trace": execution_trace,
            "iterations": self.max_iterations,
            "total_tokens": total_tokens,
            "provider": used_provider,
            "model": used_model,
        }

    def _build_tool_schemas(self, tool_names: list[str] | None = None) -> list[dict[str, Any]]:
        schemas: list[dict[str, Any]] = []
        available_tools = self.tool_registry.list_tools()

        target_tools = tool_names if tool_names else available_tools

        for name in target_tools:
            if name == "llm":
                continue
            try:
                tool = self.tool_registry.get_tool(name)
            except Exception:
                continue

            func_schema = {
                "name": tool.name,
                "description": (tool.description or "")[:200],
                "parameters": tool.parameters_schema or {"type": "object", "properties": {}},
            }
            schemas.append({"type": "function", "function": func_schema})

        if len(schemas) > 10:
            schemas = schemas[:10]

        return schemas

    def _parse_tool_calls(self, llm_response: dict[str, Any]) -> list[dict[str, Any]]:
        """Extract tool calls from LLM response.

        Args:
            llm_response: The LLM response dict containing tool_calls.

        Returns:
            List of parsed tool call dicts with 'name' and 'arguments' keys.
        """
        tool_calls = llm_response.get("tool_calls", [])
        parsed = []
        for tc in tool_calls:
            func = tc.get("function", {})
            name = func.get("name", "")
            args_str = func.get("arguments", "{}")
            try:
                arguments = json.loads(args_str) if isinstance(args_str, str) else args_str
            except json.JSONDecodeError:
                arguments = {}
            parsed.append({"name": name, "arguments": arguments, "id": tc.get("id", "")})
        return parsed

    async def _execute_tool_call(self, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        """Execute a single tool call and return the result.

        Args:
            tool_name: Name of the tool to execute.
            arguments: Arguments dict for the tool.

        Returns:
            Dict with 'success' flag and either 'result' or 'error'.
        """
        start = time.time()
        try:
            tool_input = ToolInput(params=arguments)
            tool_output = await self.tool_registry.execute(tool_name, tool_input)
            duration = time.time() - start
            metrics.record_tool_call(tool_name, duration)
            return {"success": True, "result": tool_output.result}
        except Exception as e:
            duration = time.time() - start
            metrics.record_tool_call(tool_name, duration)
            logger.error(f"Tool '{tool_name}' execution failed: {e}")
            return {"success": False, "error": str(e)}

    def _emit_event(self, task_id: str, event_type: str, payload: dict):
        if self.event_bus:
            self.event_bus.emit(task_id, event_type, payload)
