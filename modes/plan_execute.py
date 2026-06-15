import json
import re
from flowforge.core.base_mode_executor import BaseModeExecutor
from flowforge.core.base_agent import AgentInput
from flowforge.core.base_tool import ToolInput
from flowforge.core.task_context import TaskContext
from flowforge.core.tracing import get_logger
from flowforge.core.prompt_manager import get_prompt

logger = get_logger("plan_execute_executor")


class PlanExecuteExecutor(BaseModeExecutor):
    mode_name = "plan_execute"
    capabilities = ["planning"]
    MAX_PLAN_STEPS = 5

    async def _execute_core(self, ctx: TaskContext) -> dict:
        task = ctx.input_data.get("task", "")
        plan = await self._planner_generate_plan(ctx, task)
        ctx.event_bus.emit(ctx.task_id, "plan_execute.plan", {"plan": plan, "steps": len(plan)})

        if len(plan) > self.MAX_PLAN_STEPS:
            logger.warning(f"Plan has {len(plan)} steps, truncating to {self.MAX_PLAN_STEPS}")
            plan = plan[:self.MAX_PLAN_STEPS]

        results = {}
        for i, step in enumerate(plan):
            step_name = step.get("name", f"step_{i}")
            step_task = step.get("task", "")
            ctx.event_bus.emit(ctx.task_id, "plan_execute.step_start", {
                "step": step_name, "index": i + 1, "total": len(plan),
            })

            agent_name = step.get("agent", "executor")
            agent = ctx.agents.get(agent_name) if ctx.agents else None
            if agent is None:
                from flowforge.modes.default_llm_actors import DefaultLLMActor
                agent = DefaultLLMActor()
            agent_input = AgentInput(params={"task": step_task, "context": results})
            if hasattr(agent, 'execute_with_context'):
                output = await agent.execute_with_context(agent_input, ctx)
            else:
                output = await agent.execute(agent_input)
            results[step_name] = output.result
            ctx.event_bus.emit(ctx.task_id, "plan_execute.step_complete", {
                "step": step_name, "index": i + 1, "total": len(plan),
                "result_preview": str(output.result)[:300],
            })

        ctx.event_bus.emit(ctx.task_id, "plan_execute.complete", {
            "total_steps": len(plan), "results_keys": list(results.keys()),
        })

        ctx.event_bus.emit(ctx.task_id, "draft.update", {
            "content": str(results), "is_partial": False, "agent_name": "plan_execute",
        })

        return {"plan": plan, "results": results}

    async def _planner_generate_plan(self, ctx, task):
        llm_tool = ctx.tools.get_tool("llm")
        prompt = get_prompt(
            "flowforge.mode.plan_execute.generate_plan",
            "将以下任务分解为顺序执行步骤，输出 JSON 数组。最多{max_steps}步。\n"
            '格式: [{{"name": "step1", "task": "具体任务描述", "agent": "agent名或executor"}}]\n'
            "任务: {task}",
            max_steps=self.MAX_PLAN_STEPS,
            task=task,
        )
        result = await llm_tool.execute(ToolInput(params={
            "messages": [{"role": "user", "content": prompt}],
            "stream": False, "task_id": ctx.task_id,
            "agent_name": "plan_execute_planner", "persona": ctx.persona or "default",
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
            return [{"name": "execute", "task": task, "agent": "executor"}]
