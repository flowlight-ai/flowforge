import json
import re

from flowforge.core.base_mode_executor import BaseModeExecutor
from flowforge.core.base_tool import ToolInput
from flowforge.core.prompt_manager import get_prompt
from flowforge.core.task_context import TaskContext
from flowforge.core.tracing import get_logger

logger = get_logger("react_executor")


class ReActExecutor(BaseModeExecutor):
    mode_name = "react"
    capabilities = ["reasoning", "retrieval", "acting"]
    MAX_STEPS = 8
    LOOP_THRESHOLD = 2
    MAX_MESSAGE_CHARS = 1000

    async def _execute_core(self, ctx: TaskContext) -> dict:
        task = ctx.input_data.get("task", "")
        system_prompt = get_prompt("react.system", task=task[:2000])
        messages = [{"role": "system", "content": system_prompt}]
        if task:
            messages.append({"role": "user", "content": task})

        action_history = []
        last_thought = ""
        observation = ""
        action = None
        step = 0
        loop_detected = False
        for step in range(self.MAX_STEPS):
            if len(messages) > 10:
                messages = [messages[0]] + messages[-8:]

            thought, tool_calls = await self._generate_thought(ctx, messages)
            last_thought = thought

            # Handle function calling (preferred path)
            if tool_calls:
                for tc in tool_calls:
                    func = tc.get("function", {})
                    action = {
                        "tool": func.get("name", ""),
                        "params": json.loads(func.get("arguments", "{}")) if isinstance(func.get("arguments"), str) else func.get("arguments", {}),
                    }
                    if not action["tool"] or action["tool"] == "llm":
                        continue
                    action_history.append(action)
                    observation = await self._execute_action(ctx, action)
                    messages.append({"role": "assistant", "content": thought[:self.MAX_MESSAGE_CHARS] if thought else ""})
                    messages.append({"role": "user", "content": f"观察结果: {observation[:self.MAX_MESSAGE_CHARS]}"})
                continue

            # Fallback: text-based action parsing
            if not thought or len(thought.strip()) < 10:
                break

            action = await self._parse_action(thought)
            if action is None:
                ctx.event_bus.emit(ctx.task_id, "draft.update", {
                    "content": thought, "is_partial": False, "agent_name": "react",
                })
                break

            if self._is_loop(action_history, action):
                loop_detected = True
                ctx.event_bus.emit(ctx.task_id, "react.loop_detected", {
                    "step": step + 1,
                    "action": str(action)[:200],
                    "history_length": len(action_history),
                })
                logger.info(f"ReAct loop detected at step {step + 1}", task_id=ctx.task_id)
                break

            action_history.append(action)
            observation = await self._execute_action(ctx, action)

            messages.append({"role": "assistant", "content": thought[:self.MAX_MESSAGE_CHARS]})
            messages.append({"role": "user", "content": f"观察结果: {observation[:self.MAX_MESSAGE_CHARS]}"})

        final_answer = last_thought if last_thought else task

        ctx.event_bus.emit(ctx.task_id, "draft.update", {
            "content": final_answer, "is_partial": False, "agent_name": "react",
        })

        return {"final_answer": final_answer, "steps": step + 1, "action_history": action_history, "loop_detected": loop_detected}

    async def _generate_thought(self, ctx, messages):
        # Build tool schemas for function calling
        tool_schemas = self._build_tool_schemas(ctx)
        llm_params = {
            "messages": messages,
            "stream": False, "task_id": ctx.task_id, "agent_name": "react_thinker",
            "persona": ctx.persona or "default",
        }
        if tool_schemas:
            llm_params["tools"] = tool_schemas
        result = await ctx.tools.execute("llm", ToolInput(params=llm_params))
        return result.result.get("content", ""), result.result.get("tool_calls")

    def _build_tool_schemas(self, ctx):
        """Build OpenAI-compatible tool schemas from registered tools."""
        schemas = []
        if not ctx.tools:
            return schemas
        try:
            for name in ctx.tools.list_tools():
                if name in ("llm", "shell_command"):
                    continue
                try:
                    tool = ctx.tools.get_tool(name)
                    desc = getattr(tool, 'description', '') or name
                    params = getattr(tool, 'parameters_schema', None) or {
                        "type": "object",
                        "properties": {"query": {"type": "string", "description": "查询内容"}},
                    }
                    schemas.append({
                        "type": "function",
                        "function": {"name": name, "description": desc[:200], "parameters": params},
                    })
                except Exception as e:
                    logger.debug(f"ReAct schema build skip tool {name}: {e}")
                    continue
        except Exception as e:
            logger.warning(f"ReAct _build_tool_schemas failed: {e}")
        if len(schemas) > 8:
            schemas = schemas[:8]
        logger.info(f"[react] built {len(schemas)} tool schemas for function calling", task_id=ctx.task_id if ctx else None)
        return schemas

    async def _parse_action(self, thought):
        if not thought:
            return None
        if "最终回答" in thought or "最终答案" in thought or "final answer" in thought.lower():
            return None
        if re.search(r'最终回答[：:]', thought):
            return None
        if len(thought) > 100 and not re.search(r'"tool"', thought):
            return None
        match = re.search(r'```json\s*(\{.*?\})\s*```', thought, re.DOTALL)
        if match:
            try:
                action = json.loads(match.group(1))
                if isinstance(action, dict) and action.get("tool"):
                    return action
            except json.JSONDecodeError:
                pass
        # 尝试从文本中直接提取JSON动作
        match = re.search(r'\{\s*"tool"\s*:\s*"([^"]+)"', thought)
        if match:
            try:
                action_match = re.search(r'\{[^{}]*"tool"[^{}]*\}', thought)
                if action_match:
                    action = json.loads(action_match.group())
                    if isinstance(action, dict) and action.get("tool"):
                        return action
            except json.JSONDecodeError:
                pass
        return None

    def _is_loop(self, history, action):
        if len(history) < self.LOOP_THRESHOLD:
            return False
        recent = history[-self.LOOP_THRESHOLD:]
        same_tool = sum(1 for a in recent if a.get("tool") == action.get("tool")) >= self.LOOP_THRESHOLD
        if same_tool:
            return True
        return sum(1 for a in recent if a == action) >= self.LOOP_THRESHOLD

    async def _execute_action(self, ctx, action):
        tool_name = action.get("tool")
        if not tool_name or tool_name == "llm":
            return action.get("params", {}).get("query", action.get("params", {}).get("task", str(action)))
        params = action.get("params", {})
        try:
            result = await ctx.tools.execute(tool_name, ToolInput(params=params))
            return json.dumps(result.result, ensure_ascii=False)[:2000]
        except Exception as e:
            logger.warning(f"ReAct action failed for tool {tool_name}: {e}")
            return f"工具 {tool_name} 执行失败: {str(e)[:200]}"
