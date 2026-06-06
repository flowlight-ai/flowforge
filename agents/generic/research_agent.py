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
            prompt = (
                "为以下研究主题制定研究计划。\n"
                '输出JSON: {"sub_queries": ["子查询1"], "angles": ["研究角度1"], "search_strategy": "搜索策略"}\n\n'
                f"主题: {topic}\n"
                f"深度: {depth}"
            )
            content = await self._call_llm(context, prompt)
            data = self._extract_json(content)
            if isinstance(data, str):
                data = {"sub_queries": [topic], "angles": ["全面分析"], "search_strategy": data}
            return AgentOutput(result={"research_plan": data}, state_updates={"research_plan": data})

        if mode == "synthesize":
            angles = input.params.get("angles", [])
            search_results = input.params.get("search_results", [])
            prompt = (
                "根据以下搜索结果，综合撰写研究报告。\n"
                f"研究角度: {angles}\n"
                f"搜索结果: {search_results}\n\n"
                "输出结构化的研究报告，包含引言、主要发现、分析和结论。"
            )
            content = await self._call_llm(context, prompt)
            return AgentOutput(
                result={"report": content},
                state_updates={"research_report": content},
            )

        prompt = (
            f"为以下主题进行深度研究，制定研究计划并综合分析。\n"
            f"主题: {topic}\n"
            f"深度: {depth}\n\n"
            "请输出完整的研究报告，包含：\n"
            "1. 研究背景和问题\n"
            "2. 关键发现\n"
            "3. 深度分析\n"
            "4. 结论和建议"
        )

        content = await self._call_llm(context, prompt)

        return AgentOutput(
            result={"report": content, "topic": topic},
            state_updates={"research_report": content},
        )
