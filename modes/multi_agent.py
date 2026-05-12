import asyncio
from core.base_mode_executor import BaseModeExecutor
from core.base_agent import AgentInput
from core.task_context import TaskContext

class MultiAgentExecutor(BaseModeExecutor):
    mode_name = "multi_agent"
    capabilities = ["collaboration"]

    async def _execute_core(self, ctx: TaskContext) -> dict:
        task = ctx.input_data.get("task", "")
        participants = ctx.metadata.get("participants", ["researcher", "writer", "reviewer"])
        results = {}

        async def run_agent(name):
            agent = ctx.agents.get(name) if ctx.agents else None
            if agent:
                agent_input = AgentInput(params={"task": task})
                if hasattr(agent, 'execute_with_context'):
                    output = await agent.execute_with_context(agent_input, ctx)
                else:
                    output = await agent.execute(agent_input)
                return name, output.result
            return name, None

        tasks = [run_agent(name) for name in participants]
        for coro in asyncio.as_completed(tasks):
            name, result = await coro
            if result:
                results[name] = result
        return {"results": results}
