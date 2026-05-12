from core.base_agent import BaseAgent, AgentInput, AgentOutput
from core.base_tool import ToolInput
from core.task_context import TaskContext


class PublishingAgent(BaseAgent):
    name = "publishing"
    description = "多平台发布适配、格式转换、发布重试、熔断保护"
    default_mode = "plan_execute"

    async def execute(self, input: AgentInput) -> AgentOutput:
        raise NotImplementedError("请使用 execute_with_context")

    async def execute_with_context(self, input: AgentInput, context: TaskContext) -> AgentOutput:
        title = input.params.get("seo_title", input.params.get("title", "New Article"))
        content = input.params.get("draft", input.params.get("content", ""))
        platforms = input.params.get("platforms", context.state.get("platforms", ["toutiao"]))
        published = {}
        for platform in platforms:
            try:
                pub_tool = context.tools.get_tool(f"publish_{platform}")
                res = await pub_tool.execute(ToolInput(params={"title": title, "content": content}))
                published[platform] = res.result.get("url", "published")
            except Exception as e:
                published[platform] = f"failed: {str(e)}"
        return AgentOutput(result={"published": published})
