import json
import re
from flowforge.core.base_agent import BaseAgent, AgentInput, AgentOutput
from flowforge.core.base_tool import ToolInput
from flowforge.core.prompt_manager import get_prompt
from flowforge.core.task_context import TaskContext


class TopicResearchAgent(BaseAgent):
    name = "topic_research"
    description = "多级检索策略：缓存→HelixRAG→热榜→自定义"
    default_mode = "rewoo"

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
        except Exception:
            ctx.event_bus = EventBus()
        return await self.execute_with_context(input, ctx)

    async def execute_with_context(self, input: AgentInput, context: TaskContext) -> AgentOutput:
        query = input.params.get("topic", input.params.get("query", input.params.get("task", "")))
        if not query:
            return AgentOutput(result={"topics": []})

        topics = []

        # Step 1: 缓存检查
        context.event_bus.emit(context.task_id, "topic_research.cache_check_start", {"query": query})
        try:
            cache = context.tools.get_tool("cache")
            cached = await cache.execute(ToolInput(params={"key": f"topic:{query}"}))
            if cached.result.get("data"):
                context.event_bus.emit(context.task_id, "topic_research.cache_check_complete", {"found": True})
                return AgentOutput(result={"topics": cached.result["data"]})
        except Exception:
            pass
        context.event_bus.emit(context.task_id, "topic_research.cache_check_complete", {"found": False})

        # Step 2: HelixRAG搜索
        context.event_bus.emit(context.task_id, "topic_research.helixrag_search_start", {"query": query})
        try:
            helix = context.tools.get_tool("helixrag_search")
            result = await helix.execute(ToolInput(params={"query": query, "max_results": 5}))
            topics = [{"title": r.get("title", ""), "angle": r.get("angle", "综合"), "url": r.get("url", "")}
                       for r in result.result.get("results", [])][:5]
            if topics:
                context.event_bus.emit(context.task_id, "topic_research.helixrag_search_complete", {"count": len(topics)})
                context.event_bus.emit(context.task_id, "topic_research.complete", {"source": "helixrag", "count": len(topics)})
                return AgentOutput(result={"topics": topics})
        except Exception:
            pass
        context.event_bus.emit(context.task_id, "topic_research.helixrag_search_complete", {"count": 0})

        # Step 3: Web搜索
        context.event_bus.emit(context.task_id, "topic_research.web_search_start", {"query": query})
        try:
            search = context.tools.get_tool("web_search")
            result = await search.execute(ToolInput(params={"query": query, "max_results": 5}))
            topics = [{"title": r.get("title", ""), "angle": "综合", "url": r.get("url", "")}
                       for r in result.result.get("results", [])][:5]
            if topics:
                context.event_bus.emit(context.task_id, "topic_research.web_search_complete", {"count": len(topics)})
                context.event_bus.emit(context.task_id, "topic_research.complete", {"source": "web_search", "count": len(topics)})
                return AgentOutput(result={"topics": topics})
        except Exception:
            pass
        context.event_bus.emit(context.task_id, "topic_research.web_search_complete", {"count": 0})

        # Step 4: LLM生成选题
        context.event_bus.emit(context.task_id, "topic_research.llm_generate_start", {"query": query})
        llm = context.tools.get_tool("llm")
        prompt = get_prompt("agent.topic_research", query=query)
        result = await llm.execute(ToolInput(params={
            "messages": [{"role": "system", "content": prompt}, {"role": "user", "content": f"请为'{query}'生成选题"}],
            "stream": True, "task_id": context.task_id,
            "agent_name": self.name, "persona": context.persona or "default",
        }))
        content = result.result.get("content", "[]")
        match = re.search(r'\[.*\]', content, re.DOTALL)
        if match:
            try:
                topics = json.loads(match.group())
            except json.JSONDecodeError:
                pass
        context.event_bus.emit(context.task_id, "topic_research.llm_generate_complete", {"count": len(topics)})

        context.event_bus.emit(context.task_id, "topic_research.complete", {"source": "llm", "count": len(topics)})
        return AgentOutput(result={"topics": topics})
