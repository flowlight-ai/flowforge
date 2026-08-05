
from flowforge.agents.generic.base import AgentInput, AgentOutput, GenericAgent
from flowforge.core.task_context import TaskContext


class ImageResearchAgent(GenericAgent):
    name = "image_research"
    description = "配图研究：为文章搜索和筛选合适的配图"
    default_mode = "react"

    async def execute_with_context(self, input: AgentInput, context: TaskContext | None) -> AgentOutput:
        topic = input.params.get("topic", "")
        images = input.params.get("images", [])
        mode = input.params.get("mode", "filter")

        if mode == "filter" and images:
            prompt = self._get_prompt(
                "agent.image_filter",
                topic=topic,
                images=images,
            )
            content = await self._call_llm(context, prompt) if prompt else ""
            data = self._extract_json(content) if content else []
            if isinstance(data, str):
                data = []
            if isinstance(data, dict):
                data = [data]
            return AgentOutput(
                result={"filtered_images": data},
                state_updates={"filtered_images": data},
            )

        prompt = self._get_prompt("agent.image_recommend", topic=topic)
        content = await self._call_llm(context, prompt) if prompt else ""
        data = self._extract_json(content) if content else {}
        if isinstance(data, str):
            data = {"image_suggestions": [{"type": "插图", "style": "简约", "search_keywords": [topic], "placement": "正文"}]}

        return AgentOutput(
            result={"image_plan": data},
            state_updates={"image_plan": data},
        )
