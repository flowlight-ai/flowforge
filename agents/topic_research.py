import json
import re
import asyncio
from flowforge.core.base_agent import BaseAgent, AgentInput, AgentOutput
from flowforge.core.base_tool import ToolInput
from flowforge.core.prompt_manager import get_prompt
from flowforge.core.task_context import TaskContext
from flowforge.core.tracing import get_logger

logger = get_logger("topic_research_agent")

# 单工具调用超时（秒），防止LLM/搜索调用无限阻塞
_TOOL_TIMEOUT = 300


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
            cached = await asyncio.wait_for(
                context.tools.execute("cache", ToolInput(params={"key": f"topic:{query}"})),
                timeout=_TOOL_TIMEOUT,
            )
            if cached.result.get("data"):
                context.event_bus.emit(context.task_id, "topic_research.cache_check_complete", {"found": True})
                return AgentOutput(result={"topics": cached.result["data"]})
        except asyncio.TimeoutError:
            logger.warning("Cache check timed out", task_id=context.task_id)
        except Exception as e:
            logger.warning(f"Cache check failed: {e}", task_id=context.task_id)
        context.event_bus.emit(context.task_id, "topic_research.cache_check_complete", {"found": False})

        # Step 2: OpenSieve搜索
        context.event_bus.emit(context.task_id, "topic_research.opensieve_search_start", {"query": query})
        try:
            result = await asyncio.wait_for(
                context.tools.execute("opensieve_search", ToolInput(params={"query": query, "max_results": 5})),
                timeout=_TOOL_TIMEOUT,
            )
            topics = [{"title": r.get("title", ""), "angle": r.get("angle", "综合"), "url": r.get("url", "")}
                       for r in result.result.get("results", [])][:5]
            if topics:
                context.event_bus.emit(context.task_id, "topic_research.opensieve_search_complete", {"count": len(topics)})
                context.event_bus.emit(context.task_id, "topic_research.complete", {"source": "opensieve", "count": len(topics)})
                return AgentOutput(result={"topics": topics})
            # 搜索返回空结果，尝试下一个搜索源
            logger.info("OpenSieve returned empty results, trying web_search", task_id=context.task_id)
        except asyncio.TimeoutError:
            logger.warning("OpenSieve search timed out", task_id=context.task_id)
        except Exception as e:
            logger.warning(f"OpenSieve search failed: {e}", task_id=context.task_id)
        context.event_bus.emit(context.task_id, "topic_research.opensieve_search_complete", {"count": 0})

        # Step 3: Web搜索
        context.event_bus.emit(context.task_id, "topic_research.web_search_start", {"query": query})
        try:
            result = await asyncio.wait_for(
                context.tools.execute("web_search", ToolInput(params={"query": query, "max_results": 5})),
                timeout=_TOOL_TIMEOUT,
            )
            topics = [{"title": r.get("title", ""), "angle": "综合", "url": r.get("url", "")}
                       for r in result.result.get("results", [])][:5]
            if topics:
                context.event_bus.emit(context.task_id, "topic_research.web_search_complete", {"count": len(topics)})
                context.event_bus.emit(context.task_id, "topic_research.complete", {"source": "web_search", "count": len(topics)})
                return AgentOutput(result={"topics": topics})
            # 搜索返回空结果，直接进入LLM fallback
            logger.info("Web search returned empty results, falling back to LLM", task_id=context.task_id)
        except asyncio.TimeoutError:
            logger.warning("Web search timed out", task_id=context.task_id)
        except Exception as e:
            logger.warning(f"Web search failed: {e}", task_id=context.task_id)
        context.event_bus.emit(context.task_id, "topic_research.web_search_complete", {"count": 0})

        # Step 4: LLM生成选题（不使用stream，Agent只需最终结果）
        context.event_bus.emit(context.task_id, "topic_research.llm_generate_start", {"query": query})
        try:
            prompt = get_prompt("agent.topic_research", query=query)
            result = await asyncio.wait_for(
                context.tools.execute("llm", ToolInput(params={
                    "messages": [{"role": "system", "content": prompt}, {"role": "user", "content": f"请为'{query}'生成选题"}],
                    "stream": False, "task_id": context.task_id,
                    "agent_name": self.name, "persona": context.persona or "default",
                })),
                timeout=_TOOL_TIMEOUT,
            )
            content = result.result.get("content", "[]")
            match = re.search(r'\[.*\]', content, re.DOTALL)
            if match:
                try:
                    topics = json.loads(match.group())
                except json.JSONDecodeError:
                    pass
        except asyncio.TimeoutError:
            logger.warning("LLM generate timed out", task_id=context.task_id)
        except Exception as e:
            logger.warning(f"LLM generate failed: {e}", task_id=context.task_id)
        context.event_bus.emit(context.task_id, "topic_research.llm_generate_complete", {"count": len(topics)})

        context.event_bus.emit(context.task_id, "topic_research.complete", {"source": "llm", "count": len(topics)})
        return AgentOutput(result={"topics": topics})
