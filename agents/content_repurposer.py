from core.base_agent import BaseAgent, AgentInput, AgentOutput
from core.base_tool import ToolInput
from core.task_context import TaskContext


class ContentRepurposerAgent(BaseAgent):
    name = "content_repurposer"
    description = "内容多平台适配改写"
    default_mode = "plan_execute"

    async def execute(self, input: AgentInput) -> AgentOutput:
        raise NotImplementedError("请使用 execute_with_context")

    async def execute_with_context(self, input: AgentInput, context: TaskContext) -> AgentOutput:
        draft = input.params.get("draft", "")
        target_platforms = input.params.get("platforms", ["wechat", "toutiao", "xiaohongshu"])
        llm = context.tools.get_tool("llm")
        variants = {}
        for platform in target_platforms:
            prompt = (
                f"将以下文章改写为适合{platform}平台发布的版本，"
                f"保持核心信息不变，调整语气、长度和格式。\n原文: {draft[:1000]}"
            )
            try:
                result = await llm.execute(
                    ToolInput(params={"messages": [{"role": "user", "content": prompt}], "max_tokens": 1500})
                )
                variants[platform] = result.result.get("content", "")
            except Exception:
                variants[platform] = ""
        return AgentOutput(result={"variants": variants})
