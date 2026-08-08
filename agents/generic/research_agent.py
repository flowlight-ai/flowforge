from flowforge.agents.generic.base import GenericAgent, AgentInput, AgentOutput
from flowforge.core.task_context import TaskContext
from typing import Optional


class ResearchAgent(GenericAgent):
    name = "research_agent"
    description = "深度研究：制定研究计划、搜索素材、综合撰写研究报告"
    default_mode = "react"

    async def execute_with_context(self, input: AgentInput, context: Optional[TaskContext]) -> AgentOutput:
        topic = input.params.get("topic", input.params.get("task", ""))
        depth = input.params.get("depth", "medium")
        mode = input.params.get("mode", "full")

        if mode == "plan":
            prompt = self._get_prompt(
                "agent.research_plan",
                topic=topic,
                depth=depth,
            )
            content = await self._call_llm(context, prompt) if prompt else ""
            data = self._extract_json(content) if content else {}
            if isinstance(data, str):
                data = {"sub_queries": [topic], "angles": ["全面分析"], "search_strategy": data}
            return AgentOutput(result={"research_plan": data}, state_updates={"research_plan": data})

        if mode == "synthesize":
            angles = input.params.get("angles", [])
            search_results = input.params.get("search_results", [])
            prompt = self._get_prompt(
                "agent.research_synthesize",
                angles=angles,
                search_results=search_results,
            )
            content = await self._call_llm(context, prompt) if prompt else ""
            return AgentOutput(
                result={"report": content},
                state_updates={"research_report": content},
            )

        prompt = self._get_prompt(
            "agent.research_full",
            topic=topic,
            depth=depth,
        )
        content = await self._call_llm(context, prompt) if prompt else ""

        return AgentOutput(
            result={"report": content, "topic": topic},
            state_updates={"research_report": content},
        )
