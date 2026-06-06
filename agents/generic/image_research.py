from flowforge.agents.generic.base import GenericAgent, AgentInput, AgentOutput
from flowforge.core.task_context import TaskContext
from typing import Optional


class ImageResearchAgent(GenericAgent):
    name = "image_research"
    description = "配图研究：为文章搜索和筛选合适的配图"
    default_mode = "react"

    async def execute_with_context(self, input: AgentInput, context: Optional[TaskContext]) -> AgentOutput:
        topic = input.params.get("topic", "")
        images = input.params.get("images", [])
        mode = input.params.get("mode", "filter")

        if mode == "filter" and images:
            prompt = (
                f"评估以下为「{topic}」搜索到的配图候选，筛选出与主题最相关、质量最高的图片。\n"
                '输出JSON数组: [{"url": "图片URL", "relevance": 0.9, "quality": "高", "reason": "选择理由"}]\n\n'
                f"候选图片: {images}"
            )
            content = await self._call_llm(context, prompt)
            data = self._extract_json(content)
            if isinstance(data, str):
                data = []
            if isinstance(data, dict):
                data = [data]
            return AgentOutput(
                result={"filtered_images": data},
                state_updates={"filtered_images": data},
            )

        prompt = (
            f"为文章「{topic}」推荐配图方案。请描述适合的图片类型、风格和搜索关键词。\n"
            '输出JSON: {"image_suggestions": [{"type": "图片类型", "style": "风格", '
            '"search_keywords": ["关键词1"], "placement": "放置位置"}]}'
        )

        content = await self._call_llm(context, prompt)
        data = self._extract_json(content)
        if isinstance(data, str):
            data = {"image_suggestions": [{"type": "插图", "style": "简约", "search_keywords": [topic], "placement": "正文"}]}

        return AgentOutput(
            result={"image_plan": data},
            state_updates={"image_plan": data},
        )
