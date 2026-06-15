from flowforge.agents.generic.base import GenericAgent, AgentInput, AgentOutput, TaskContext
from typing import Optional


class ReactThinkerAgent(GenericAgent):
    name = "react_thinker"
    description = "ReAct 思考步骤：分析当前状态，推理下一步行动"
    default_mode = "react"

    async def execute_with_context(self, input: AgentInput, context: Optional[TaskContext]) -> AgentOutput:
        query = input.params.get("query", input.params.get("task", ""))
        observation = input.params.get("observation", "")
        iteration = input.params.get("iteration", 0)

        prompt = self._get_prompt(
            "flowforge.agent.react_thinker",
            "You are a reasoning agent in a ReAct loop. Analyze the current situation and decide the next action.\n"
            "Task: {query}\n"
            "{observation_section}"
            "{iteration_section}"
            "Output your reasoning as JSON:\n"
            '{{"thought": "your analysis", "next_action": "action_name", '
            '"action_input": {{"key": "value"}}, "is_complete": false}}\n'
            "Set is_complete to true if the task is fully resolved.",
            query=query,
            observation_section=f"Latest observation: {observation}\n" if observation else "",
            iteration_section=f"Iteration: {iteration}\n" if iteration > 0 else "",
        )

        content = await self._call_llm(context, prompt)
        data = self._extract_json(content)
        if isinstance(data, str):
            data = {"thought": data, "next_action": "unknown", "action_input": {}, "is_complete": False}

        return AgentOutput(
            result={"thought": data.get("thought", ""), "next_action": data.get("next_action", ""),
                    "action_input": data.get("action_input", {}), "is_complete": data.get("is_complete", False)},
            state_updates={"react_thought": data.get("thought", ""), "react_iteration": iteration + 1}
        )
