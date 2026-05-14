from flowforge.core.base_agent import BaseAgent, AgentInput, AgentOutput
from flowforge.core.base_tool import ToolInput
from flowforge.core.task_context import TaskContext


class ArticleWritingAgent(BaseAgent):
    name = "article_writing"
    description = "文章写作 Agent：基于素材生成高级文章初稿"
    default_mode = "reflexion"

    async def execute(self, input: AgentInput) -> AgentOutput:
        raise NotImplementedError("请使用 execute_with_context")

    async def execute_with_context(self, input: AgentInput, context: TaskContext) -> AgentOutput:
        topic = input.params.get("topic", "")
        materials = input.params.get("materials", [])
        material_text = "\n".join([m.get("content", str(m))[:500] for m in materials[:3]])
        system_prompt = (
            f"你是一位专业作家。根据以下主题和素材创作一篇高质量文章。\n"
            f"主题: {topic}\n素材: {material_text}"
        )
        llm = context.tools.get_tool("llm")
        result = await llm.execute(
            ToolInput(params={"messages": [{"role": "user", "content": system_prompt}], "max_tokens": 2000})
        )
        return AgentOutput(result={"draft": result.result.get("content", "")})
