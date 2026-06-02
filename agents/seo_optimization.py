import asyncio
import json
import re
from flowforge.core.base_agent import BaseAgent, AgentInput, AgentOutput
from flowforge.core.base_tool import ToolInput
from flowforge.core.prompt_manager import get_prompt
from flowforge.core.task_context import TaskContext
from flowforge.core.tracing import get_logger

logger = get_logger("seo_optimization_agent")

_TOOL_TIMEOUT = 300


class SEOOptimizationAgent(BaseAgent):
    name = "seo_optimization"
    description = "标题优化、关键词植入、段落结构优化，使用 Plan-Execute 模式"
    default_mode = "plan_execute"

    async def execute(self, input: AgentInput) -> AgentOutput:
        from flowforge.core.task_context import TaskContext
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
        keywords = input.params.get("keywords", [])
        topic = input.params.get("topic", input.params.get("task", ""))

        # Step 1: 规划SEO策略
        context.event_bus.emit(context.task_id, "seo_optimization.planning_start", {"draft_length": len(draft)})
        plan_prompt = get_prompt("agent.seo_planning", topic=topic, keywords=', '.join(keywords) if keywords else '无', draft_preview=draft[:500])
        plan_result = await asyncio.wait_for(
            context.tools.execute("llm", ToolInput(params={
                "messages": [{"role": "user", "content": plan_prompt}],
                "stream": False, "task_id": context.task_id,
                "agent_name": self.name, "persona": context.persona or "default",
            })),
            timeout=_TOOL_TIMEOUT,
        )
        plan_content = plan_result.result.get("content", "{}")
        suggested_keywords = keywords
        plan_match = re.search(r'\{.*\}', plan_content, re.DOTALL)
        if plan_match:
            try:
                plan_data = json.loads(plan_match.group())
                suggested_keywords = plan_data.get("suggested_keywords", keywords)
            except json.JSONDecodeError:
                logger.warning("SEO plan JSON parse failed", task_id=context.task_id)

        context.event_bus.emit(context.task_id, "seo_optimization.planning_complete", {
            "suggested_keywords": suggested_keywords,
        })

        # Step 2: 执行优化
        context.event_bus.emit(context.task_id, "seo_optimization.optimize_start", {})
        optimize_prompt = get_prompt("agent.seo_optimize", keywords=', '.join(suggested_keywords), draft=draft)
        result = await asyncio.wait_for(
            context.tools.execute("llm", ToolInput(params={
                "messages": [
                    {"role": "system", "content": optimize_prompt},
                    {"role": "user", "content": "请优化文章"},
                ],
                "max_tokens": 3000,
                "stream": False,
                "task_id": context.task_id,
                "agent_name": self.name,
                "persona": context.persona or "default",
            })),
            timeout=_TOOL_TIMEOUT,
        )
        optimized = result.result.get("content", draft)

        # 提取SEO标题：第一行非空行
        lines = [l.strip() for l in optimized.split("\n") if l.strip()]
        seo_title = lines[0].replace("#", "").strip()[:60] if lines else topic[:60]

        context.event_bus.emit(context.task_id, "seo_optimization.optimize_complete", {
            "seo_title": seo_title, "optimized_length": len(optimized),
        })

        return AgentOutput(result={"optimized_draft": optimized, "seo_title": seo_title})
