from flowforge.agents.generic.base import GenericAgent, AgentInput, AgentOutput, TaskContext
from typing import Optional


class ProcessorAgent(GenericAgent):
    name = "processor"
    description = "通用处理：根据分析结果执行核心处理逻辑"
    default_mode = "react"

    async def execute_with_context(self, input: AgentInput, context: Optional[TaskContext]) -> AgentOutput:
        task = input.params.get("task", input.params.get("query", ""))
        analysis = input.params.get("analysis", {})
        method = input.params.get("method", "standard")

        prompt = self._get_prompt(
            "flowforge.agent.processor",
            "You are a processing agent. Execute the core processing based on the analysis.\n"
            "Task: {task}\n"
            "Analysis: {analysis}\n"
            "Method: {method}\n\n"
            "Produce the processed result as JSON:\n"
            '{{"result": "processed output", "method_used": "description of method", '
            '"intermediate_steps": ["step1"], "confidence": 0.0-1.0}}',
            task=task,
            analysis=analysis,
            method=method,
        )

        content = await self._call_llm(context, prompt)
        data = self._extract_json(content)
        if isinstance(data, str):
            data = {"result": data, "method_used": method, "intermediate_steps": [], "confidence": 0.5}

        return AgentOutput(
            result={"processed": data},
            state_updates={"processed_result": data.get("result", "")}
        )
