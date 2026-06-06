import json
import re
import asyncio
from flowforge.core.base_agent import BaseAgent, AgentInput, AgentOutput
from flowforge.core.base_tool import ToolInput
from flowforge.core.prompt_manager import get_prompt
from flowforge.core.task_context import TaskContext
from flowforge.core.tracing import get_logger

logger = get_logger("topic_research_agent")

_TOOL_TIMEOUT = 300

_LLM_WEB_SEARCH_PROMPT = (
    "你是一个专业的内容研究助手，具备联网搜索能力。请针对以下主题进行深度研究和素材搜集。\n\n"
    "主题：{topic}\n\n"
    "要求：\n"
    "1. 从多个角度搜索该主题的最新信息、数据、观点\n"
    "2. 搜集可用于文章创作的素材：关键数据、权威观点、典型案例、最新动态\n"
    "3. 每个信息点包含：标题、切入角度、信息来源\n"
    "4. 优先提供近期（最近3个月）的信息\n"
    "5. 如果无法获取实时信息，请基于你的知识提供最相关的信息并明确标注\n"
    "6. 严格输出JSON格式: {{\"results\": [{{\"title\": \"选题标题\", \"angle\": \"切入角度\", "
    "\"url\": \"来源URL（如有）\", \"source_type\": \"llm_web_search\"}}]}}"
)

_LLM_WEB_SEARCH_SYSTEM = (
    "你具备联网搜索能力，请务必利用联网功能搜索真实、最新的信息，不要编造内容。"
    "直接输出JSON，不要添加markdown代码块标记。"
)


class TopicResearchAgent(BaseAgent):
    name = "topic_research"
    description = "多级检索策略：缓存→web_search(HelixRAG→爬虫→LLM联网)→LLM联网→LLM生成"
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

        # Step 2: web_search 工具（含完整3级回退链：HelixRAG→DuckDuckGo/Tavily→LLM WebChat）
        context.event_bus.emit(context.task_id, "topic_research.search_start", {"query": query})
        try:
            result = await asyncio.wait_for(
                context.tools.execute("web_search", ToolInput(params={"query": query, "max_results": 5})),
                timeout=_TOOL_TIMEOUT,
            )
            raw_results = result.result.get("results", [])
            topics = [{"title": r.get("title", ""), "angle": r.get("angle", "综合"), "url": r.get("url", "")}
                       for r in raw_results][:5]
            if topics:
                source = result.result.get("source", "web_search")
                context.event_bus.emit(context.task_id, "topic_research.search_complete", {"count": len(topics), "source": source})
                context.event_bus.emit(context.task_id, "topic_research.complete", {"source": source, "count": len(topics)})
                return AgentOutput(result={"topics": topics})
            logger.info("web_search tool returned empty results, trying LLM WebChat fallback", task_id=context.task_id)
        except asyncio.TimeoutError:
            logger.warning("web_search tool timed out", task_id=context.task_id)
        except Exception as e:
            logger.warning(f"web_search tool failed: {e}", task_id=context.task_id)
        context.event_bus.emit(context.task_id, "topic_research.search_complete", {"count": 0})

        # Step 3: LLM WebChat 联网搜索（安全网回退）
        context.event_bus.emit(context.task_id, "topic_research.llm_web_search_start", {"query": query})
        try:
            search_prompt = _LLM_WEB_SEARCH_PROMPT.format(topic=query)
            result = await asyncio.wait_for(
                context.tools.execute("llm", ToolInput(params={
                    "messages": [
                        {"role": "system", "content": _LLM_WEB_SEARCH_SYSTEM},
                        {"role": "user", "content": search_prompt},
                    ],
                    "stream": False, "task_id": context.task_id,
                    "agent_name": self.name, "persona": context.persona or "default",
                    "model": "web/chat",
                })),
                timeout=_TOOL_TIMEOUT,
            )
            content = result.result.get("content", "")
            topics = self._parse_llm_topic_results(content)
        except asyncio.TimeoutError:
            logger.warning("LLM WebChat search timed out", task_id=context.task_id)
        except Exception as e:
            logger.warning(f"LLM WebChat search failed: {e}", task_id=context.task_id)
        context.event_bus.emit(context.task_id, "topic_research.llm_web_search_complete", {"count": len(topics)})

        # Step 4: LLM 生成选题（纯知识，无联网）
        if not topics:
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
                topics = self._parse_llm_topic_results(content)
            except asyncio.TimeoutError:
                logger.warning("LLM generate timed out", task_id=context.task_id)
            except Exception as e:
                logger.warning(f"LLM generate failed: {e}", task_id=context.task_id)
            context.event_bus.emit(context.task_id, "topic_research.llm_generate_complete", {"count": len(topics)})

        context.event_bus.emit(context.task_id, "topic_research.complete", {"source": "llm", "count": len(topics)})
        return AgentOutput(result={"topics": topics})

    def _parse_llm_topic_results(self, content: str) -> list:
        if not content:
            return []
        match = re.search(r'\{[\s\S]*\}', content)
        if match:
            try:
                data = json.loads(match.group())
                if isinstance(data, dict) and data.get("results"):
                    return [{"title": r.get("title", ""), "angle": r.get("angle", "综合"), "url": r.get("url", "")}
                            for r in data["results"] if isinstance(r, dict)][:5]
            except json.JSONDecodeError:
                pass
        match = re.search(r'\[[\s\S]*\]', content)
        if match:
            try:
                items = json.loads(match.group())
                if isinstance(items, list):
                    return [{"title": r.get("title", "") if isinstance(r, dict) else str(r),
                             "angle": r.get("angle", "综合") if isinstance(r, dict) else "综合",
                             "url": r.get("url", "") if isinstance(r, dict) else ""}
                            for r in items][:5]
            except json.JSONDecodeError:
                pass
        return []
