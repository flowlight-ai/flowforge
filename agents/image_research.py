from core.base_agent import BaseAgent, AgentInput, AgentOutput
from core.base_tool import ToolInput
from core.task_context import TaskContext


class ImageResearchAgent(BaseAgent):
    name = "image_research"
    description = "配图搜索与推荐"
    default_mode = "rewoo"

    async def execute(self, input: AgentInput) -> AgentOutput:
        raise NotImplementedError("请使用 execute_with_context")

    async def execute_with_context(self, input: AgentInput, context: TaskContext) -> AgentOutput:
        topic = input.params.get("topic", "")
        try:
            pexels = context.tools.get_tool("pexels_image")
            result = await pexels.execute(ToolInput(params={"query": topic, "per_page": 5}))
            images = result.result.get("images", [])
            return AgentOutput(result={"images": images})
        except Exception:
            try:
                search = context.tools.get_tool("web_search")
                result = await search.execute(
                    ToolInput(params={"query": f"{topic} 配图", "max_results": 5})
                )
                images = [
                    {"url": r.get("url", ""), "title": r.get("title", "")}
                    for r in result.result.get("results", [])
                ]
                return AgentOutput(result={"images": images})
            except Exception:
                return AgentOutput(result={"images": []})
