import json
import re
from flowforge.core.base_mode_executor import BaseModeExecutor
from flowforge.core.base_tool import ToolInput
from flowforge.core.task_context import TaskContext

class ReActExecutor(BaseModeExecutor):
    mode_name = "react"
    capabilities = ["reasoning", "retrieval", "acting"]
    MAX_STEPS = 8
    LOOP_THRESHOLD = 3

    async def _execute_core(self, ctx: TaskContext) -> dict:
        observation = ctx.input_data.get("task", "")
        action_history = []
        step = 0
        for step in range(self.MAX_STEPS):
            thought = await self._generate_thought(ctx, observation, action_history)
            ctx.event_bus.emit(ctx.task_id, "react.thought", {"step": step, "thought": thought})
            action = await self._parse_action(thought)
            if action is None:
                break
            ctx.event_bus.emit(ctx.task_id, "react.action", {"step": step, "action": action})
            if self._is_loop(action_history, action):
                ctx.event_bus.emit(ctx.task_id, "react.loop_detected", {"step": step})
                break
            action_history.append(action)
            observation = await self._execute_action(ctx, action)
            ctx.event_bus.emit(ctx.task_id, "react.observation", {"step": step, "result": observation[:200]})
        return {"final_answer": observation, "steps": step + 1}

    async def _generate_thought(self, ctx, obs, history):
        llm_tool = ctx.tools.get_tool("llm")
        prompt = f"当前观察: {obs}\n历史动作: {history}\n请思考下一步行动。"
        result = await llm_tool.execute(ToolInput(params={"messages": [{"role": "user", "content": prompt}]}))
        return result.result["content"]

    async def _parse_action(self, thought):
        if "最终回答" in thought or "final answer" in thought.lower():
            return None
        match = re.search(r'```json\s*(\{.*?\})\s*```', thought, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(1))
            except json.JSONDecodeError:
                pass
        return {"tool": "llm", "params": {"query": thought}}

    def _is_loop(self, history, action):
        if len(history) < self.LOOP_THRESHOLD:
            return False
        return sum(1 for a in history[-self.LOOP_THRESHOLD:] if a == action) >= self.LOOP_THRESHOLD

    async def _execute_action(self, ctx, action):
        tool_name = action.get("tool", "llm")
        params = action.get("params", {})
        tool = ctx.tools.get_tool(tool_name)
        result = await tool.execute(ToolInput(params=params))
        return json.dumps(result.result, ensure_ascii=False)
