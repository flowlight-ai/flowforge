from core.base_agent import BaseAgent, AgentInput, AgentOutput
from core.base_tool import ToolInput
from core.task_context import TaskContext


class SEOOptimizationAgent(BaseAgent):
    name = "seo_optimization"
    description = "标题优化、关键词植入、段落结构优化"
    default_mode = "plan_execute"

    async def execute(self, input: AgentInput) -> AgentOutput:
        raise NotImplementedError("请使用 execute_with_context")

    async def execute_with_context(self, input: AgentInput, context: TaskContext) -> AgentOutput:
        draft = input.params.get("draft", "")
        keywords = input.params.get("keywords", [])
        llm = context.tools.get_tool("llm")
        prompt = (
            f"优化以下文章标题和内容结构，使其更符合 SEO 要求。\n"
            f"目标关键词: {', '.join(keywords)}\n"
            f"文章内容: {draft}\n"
            f"输出优化后的完整文章，直接输出 Markdown 格式。"
        )
        result = await llm.execute(
            ToolInput(params={"messages": [{"role": "user", "content": prompt}], "max_tokens": 2000})
        )
        optimized = result.result.get("content", draft)
        seo_title = optimized.split("\n")[0].replace("# ", "").strip()[:60]
        return AgentOutput(result={"optimized_draft": optimized, "seo_title": seo_title})
