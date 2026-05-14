import asyncio
import json
import re
from flowforge.core.base_mode_executor import BaseModeExecutor
from flowforge.core.base_tool import ToolInput
from flowforge.core.task_context import TaskContext

class ReWOOExecutor(BaseModeExecutor):
    mode_name = "rewoo"
    capabilities = ["planning", "parallel_execution"]

    async def _execute_core(self, ctx: TaskContext) -> dict:
        task = ctx.input_data.get("task", "")
        blueprint = await self._generate_blueprint(ctx, task)
        ctx.event_bus.emit(ctx.task_id, "rewoo.blueprint", {"blueprint": blueprint})

        async def execute_step(step):
            tool_name = step.get("tool", "llm")
            tool = ctx.tools.get_tool(tool_name)
            result = await tool.execute(ToolInput(params=step.get("params", {})))
            return step.get("name", "step"), result.result

        tasks = [execute_step(s) for s in blueprint]
        completed = await asyncio.gather(*tasks)
        result_map = {name: val for name, val in completed}
        ctx.event_bus.emit(ctx.task_id, "rewoo.completed", {"results": result_map})
        return {"results": result_map}

    async def _generate_blueprint(self, ctx, task):
        llm_tool = ctx.tools.get_tool("llm")
        prompt = f"为以下任务生成工具调用蓝图（JSON数组）: \n{task}\n格式: [{{\"name\":\"step1\", \"tool\":\"search\", \"params\":{{\"query\":\"...\"}}}}]"
        result = await llm_tool.execute(ToolInput(params={"messages": [{"role": "user", "content": prompt}]}))
        content = result.result.get("content", "[]")
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            match = re.search(r'\[.*\]', content, re.DOTALL)
            if match:
                try:
                    return json.loads(match.group())
                except json.JSONDecodeError:
                    pass
            return []
