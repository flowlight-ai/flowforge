
from flowforge.agents.generic.base import AgentInput, AgentOutput, GenericAgent, TaskContext


class ReactObserverAgent(GenericAgent):
    name = "react_observer"
    description = "ReAct 观察步骤：分析执行结果，提取关键信息"
    default_mode = "react"

    async def execute_with_context(self, input: AgentInput, context: TaskContext | None) -> AgentOutput:
        action_output = input.params.get("action_output", "")
        thought = input.params.get("thought", "")
        query = input.params.get("query", input.params.get("task", ""))

        prompt = self._get_prompt(
            "flowforge.agent.react_observer",
            query=query,
            thought=thought,
            action_output=action_output,
        )

        content = await self._call_llm(context, prompt)
        data = self._extract_json(content)
        if isinstance(data, str):
            data = {"observation": data, "progress": "unknown", "remaining": "unknown"}

        return AgentOutput(
            result={"observation": data.get("observation", ""), "progress": data.get("progress", ""),
                    "remaining": data.get("remaining", "")},
            state_updates={"react_observation": data.get("observation", "")}
        )
