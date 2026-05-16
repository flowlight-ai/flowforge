from flowforge.agents.generic.base import GenericAgent, AgentInput, AgentOutput, TaskContext
from typing import Optional


class ReactObserverAgent(GenericAgent):
    name = "react_observer"
    description = "ReAct 观察步骤：分析执行结果，提取关键信息"
    default_mode = "react"

    async def execute_with_context(self, input: AgentInput, context: Optional[TaskContext]) -> AgentOutput:
        action_output = input.params.get("action_output", "")
        thought = input.params.get("thought", "")
        query = input.params.get("query", input.params.get("task", ""))

        prompt = (
            "You are an observer in a ReAct loop. Analyze the action result and extract key observations.\n"
            f"Original task: {query}\n"
            f"Previous thought: {thought}\n"
            f"Action result: {action_output}\n\n"
            "Provide a concise observation as JSON:\n"
            '{"observation": "what you observed", "progress": "description of progress", '
            '"remaining": "what still needs to be done"}'
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
