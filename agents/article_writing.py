import json
import re
from flowforge.core.base_agent import BaseAgent, AgentInput, AgentOutput
from flowforge.core.base_tool import ToolInput
from flowforge.core.prompt_manager import get_prompt
from flowforge.core.task_context import TaskContext


class ArticleWritingAgent(BaseAgent):
    name = "article_writing"
    description = "文章写作 Agent：基于素材生成高级文章初稿"
    default_mode = "reflexion"

    async def execute(self, input: AgentInput) -> AgentOutput:
        from flowforge.events.event_bus import EventBus
        ctx = TaskContext(
            task_id=input.params.get("task_id", "standalone"),
            persona=input.params.get("persona", "default"),
            input_data=input.params,
        )
        try:
            from flowforge.app.deps import get_executor
            executor = get_executor()
            if executor:
                ctx.tools = executor.tool_registry
                ctx.agents = executor.agent_registry
                ctx.event_bus = executor.event_bus
                ctx.executor = executor
        except Exception:
            ctx.event_bus = EventBus()
        return await self.execute_with_context(input, ctx)

    async def execute_with_context(self, input: AgentInput, context: TaskContext) -> AgentOutput:
        topic = input.params.get("topic", "")
        if not topic:
            topics = input.params.get("topics", [])
            if topics and isinstance(topics, list) and len(topics) > 0:
                first = topics[0]
                topic = first.get("title", str(first)) if isinstance(first, dict) else str(first)
        if not topic:
            topic = input.params.get("task", "")
        materials = input.params.get("materials", [])
        material_text = "\n".join([m.get("content", str(m))[:500] for m in materials[:3]])

        memory = input.params.get("memory", [])
        memory_text = ""
        if memory:
            memory_text = "\n\n之前的反思和改进建议:\n" + "\n".join(str(m) for m in memory[-3:])

        llm = context.tools.get_tool("llm")

        context.event_bus.emit(context.task_id, "article_writing.generation_start", {
            "topic": topic[:100],
        })

        system_prompt = get_prompt("agent.article_writing", topic=topic, materials=material_text if material_text else '无特定素材，请根据主题自由创作')
        if memory_text:
            system_prompt += memory_text

        result = await llm.execute(ToolInput(params={
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": "请根据以上主题和素材创作文章，直接输出Markdown格式的文章内容"},
            ],
            "max_tokens": 2000,
            "stream": False,
            "task_id": context.task_id,
            "agent_name": self.name,
            "persona": context.persona or "default",
        }))
        draft = result.result.get("content", "")

        context.event_bus.emit(context.task_id, "article_writing.complete", {
            "draft_length": len(draft),
        })

        return AgentOutput(result={"output": draft, "draft": draft})
