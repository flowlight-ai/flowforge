import asyncio
import json
import re
from flowforge.core.base_agent import BaseAgent, AgentInput, AgentOutput
from flowforge.core.base_tool import ToolInput
from flowforge.core.prompt_manager import get_prompt
from flowforge.core.task_context import TaskContext
from flowforge.core.tracing import get_logger

logger = get_logger("article_reflect_agent")

_TOOL_TIMEOUT = 300


class ArticleReflectAgent(BaseAgent):
    name = "article_reflect"
    description = "文章反思 Agent：分析文章不足，给出改进建议"
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
        except Exception as e:
            logger.warning(f"Failed to get executor: {e}", task_id=ctx.task_id)
            ctx.event_bus = EventBus()
        return await self.execute_with_context(input, ctx)

    async def execute_with_context(self, input: AgentInput, context: TaskContext) -> AgentOutput:
        draft_val = input.params.get("draft", "")
        draft = draft_val if isinstance(draft_val, str) else (draft_val.get("draft", str(draft_val)) if isinstance(draft_val, dict) else str(draft_val))
        issues = input.params.get("issues", [])
        issues_text = "\n".join(issues) if isinstance(issues, list) else str(issues)

        context.event_bus.emit(context.task_id, "article_reflect.start", {"draft_length": len(draft)})

        reflect_prompt = get_prompt("agent.article_reflect", draft=draft[:3000], issues=issues_text)
        result = await asyncio.wait_for(
            context.tools.execute("llm", ToolInput(params={
                "messages": [{"role": "user", "content": reflect_prompt}],
                "stream": False,
                "task_id": context.task_id,
                "agent_name": self.name,
                "persona": context.persona or "default",
            })),
            timeout=_TOOL_TIMEOUT,
        )
        content = result.result.get("content", "{}")

        reflection = ""
        match = re.search(r'\{.*\}', content, re.DOTALL)
        if match:
            try:
                data = json.loads(match.group())
                reflection = data.get("reflection", content)
            except json.JSONDecodeError:
                reflection = content
        else:
            reflection = content

        context.event_bus.emit(context.task_id, "article_reflect.complete", {
            "reflection_length": len(reflection),
        })

        return AgentOutput(result={"reflection": reflection, "draft": draft, "issues": issues})
