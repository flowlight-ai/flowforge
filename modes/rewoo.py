import asyncio
import json
import re
from flowforge.core.base_mode_executor import BaseModeExecutor
from flowforge.core.base_tool import ToolInput
from flowforge.core.task_context import TaskContext
from flowforge.core.tracing import get_logger

logger = get_logger("rewoo_executor")


class ReWOOExecutor(BaseModeExecutor):
    mode_name = "rewoo"
    capabilities = ["planning", "parallel_execution"]
    MAX_BLUEPRINT_STEPS = 5

    async def _execute_core(self, ctx: TaskContext) -> dict:
        task = ctx.input_data.get("task", "")
        blueprint = await self._generate_blueprint(ctx, task)
        ctx.event_bus.emit(ctx.task_id, "rewoo.blueprint", {
            "blueprint": blueprint, "steps": len(blueprint),
        })

        if not blueprint:
            ctx.event_bus.emit(ctx.task_id, "rewoo.empty_blueprint", {})
            return {"results": {}, "error": "无法生成执行蓝图"}

        if len(blueprint) > self.MAX_BLUEPRINT_STEPS:
            logger.warning(f"Blueprint has {len(blueprint)} steps, truncating to {self.MAX_BLUEPRINT_STEPS}")
            blueprint = blueprint[:self.MAX_BLUEPRINT_STEPS]

        async def execute_step(step):
            step_name = step.get("name", "step")
            tool_name = step.get("tool")
            if not tool_name or tool_name == "llm":
                return step_name, {"output": step.get("task", step.get("params", {}).get("query", ""))}
            params = step.get("params", {})
            ctx.event_bus.emit(ctx.task_id, "rewoo.step_start", {
                "step": step_name, "tool": tool_name,
            })
            try:
                tool = ctx.tools.get_tool(tool_name)
                result = await tool.execute(ToolInput(params=params))
                ctx.event_bus.emit(ctx.task_id, "rewoo.step_complete", {
                    "step": step_name, "success": True,
                    "result_preview": str(result.result)[:300],
                })
                return step_name, result.result
            except Exception as e:
                logger.warning(f"ReWOO step {step_name} failed: {e}")
                ctx.event_bus.emit(ctx.task_id, "rewoo.step_complete", {
                    "step": step_name, "success": False, "error": str(e)[:200],
                })
                return step_name, {"error": str(e)}

        tasks = [execute_step(s) for s in blueprint]
        completed = await asyncio.gather(*tasks)
        result_map = {name: val for name, val in completed}
        ctx.event_bus.emit(ctx.task_id, "rewoo.completed", {
            "results_keys": list(result_map.keys()),
        })

        ctx.event_bus.emit(ctx.task_id, "draft.update", {
            "content": str(result_map), "is_partial": False, "agent_name": "rewoo",
        })

        return {"results": result_map}

    async def _generate_blueprint(self, ctx, task):
        llm_tool = ctx.tools.get_tool("llm")
        available_tools = ctx.tools.list_tools() if ctx.tools else []
        tools_desc = ", ".join([t for t in available_tools if t != "llm"])
        prompt = (
            f"为以下任务生成工具调用蓝图，输出JSON数组。最多{self.MAX_BLUEPRINT_STEPS}步。\n"
            f"可用工具: llm, {tools_desc}\n"
            f"格式: [{{\"name\":\"step1\", \"tool\":\"工具名\", \"params\":{{\"query\":\"...\"}}}}]\n"
            f"任务: {task}"
        )
        result = await llm_tool.execute(ToolInput(params={
            "messages": [{"role": "user", "content": prompt}],
            "stream": False, "task_id": ctx.task_id,
            "agent_name": "rewoo_planner", "persona": ctx.persona or "default",
        }))
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
