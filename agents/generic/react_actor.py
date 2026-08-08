from flowforge.agents.generic.base import GenericAgent, AgentInput, AgentOutput, TaskContext
from typing import Optional


class ReactActorAgent(GenericAgent):
    name = "react_actor"
    description = "ReAct 执行步骤：根据思考结果调用工具或执行操作"
    default_mode = "react"

    async def execute_with_context(self, input: AgentInput, context: Optional[TaskContext]) -> AgentOutput:
        next_action = input.params.get("next_action", "")
        action_input = input.params.get("action_input", {})

        if not next_action:
            return AgentOutput(result={"action_taken": "none", "action_output": "No action specified"})

        try:
            tool_result = await self._call_tool(context, next_action, action_input)
            return AgentOutput(
                result={"action_taken": next_action, "action_output": tool_result},
                state_updates={"last_action": next_action}
            )
        except Exception as e:
            prompt = self._get_prompt(
                "flowforge.agent.react_actor.fallback",
                next_action=next_action,
                action_input=action_input,
            )
            content = await self._call_llm(context, prompt) if prompt else ""
            return AgentOutput(
                result={"action_taken": next_action, "action_output": content, "simulated": True},
                state_updates={"last_action": next_action}
            )
