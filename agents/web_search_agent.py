import asyncio
import json
import re
from flowforge.core.base_agent import BaseAgent, AgentInput, AgentOutput
from flowforge.core.base_tool import ToolInput
from flowforge.core.prompt_manager import get_prompt
from flowforge.core.task_context import TaskContext
from flowforge.core.tracing import get_logger

logger = get_logger("web_search_agent")

_TOOL_TIMEOUT = 300

_LLM_WEB_SEARCH_PROMPT = (
    "你是一个专业的内容研究助手，具备联网搜索能力。请针对以下主题进行深度研究和素材搜集。\n\n"
    "主题：{topic}\n\n"
    "要求：\n"
    "1. 从多个角度搜索该主题的最新信息、数据、观点\n"
    "2. 搜集可用于文章创作的素材：关键数据、权威观点、典型案例、最新动态\n"
    "3. 每个信息点包含：标题、详细摘要、信息来源\n"
    "4. 优先提供近期（最近3个月）的信息\n"
    "5. 如果无法获取实时信息，请基于你的知识提供最相关的信息并明确标注\n"
    "6. 严格输出JSON格式: {{\"results\": [{{\"title\": \"信息标题\", \"url\": \"来源URL（如有）\", "
    "\"snippet\": \"详细摘要内容\", \"source_type\": \"llm_web_search\"}}]}}"
)

_LLM_WEB_SEARCH_SYSTEM = (
    "你具备联网搜索能力，请务必利用联网功能搜索真实、最新的信息，不要编造内容。"
    "直接输出JSON，不要添加markdown代码块标记。"
)


class WebSearchAgent(BaseAgent):
    name = "web_search_agent"
    description = "网络搜索 Agent：web_search(HelixRAG→爬虫→LLM联网)→LLM联网回退链"
    default_mode = "react"

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
        queries = input.params.get("queries", [])
        query = input.params.get("query", "")
        max_results = input.params.get("max_results", 5)

        if query and not queries:
            queries = [query]
        if not queries:
            return AgentOutput(result={"results": []})

        # Step 1: plan_search — 规划搜索策略
        context.event_bus.emit(context.task_id, "web_search_agent.plan_search_start", {
            "queries": queries,
        })
        plan_prompt = get_prompt("agent.web_search_plan", query=queries)
        optimized_queries = list(queries)
        try:
            result = await asyncio.wait_for(
                context.tools.execute("llm", ToolInput(params={
                    "messages": [{"role": "user", "content": plan_prompt}],
                    "stream": False, "task_id": context.task_id,
                    "agent_name": self.name, "persona": context.persona or "default",
                })),
                timeout=_TOOL_TIMEOUT,
            )
            content = result.result.get("content", "{}")
            match = re.search(r'\{.*\}', content, re.DOTALL)
            if match:
                data = json.loads(match.group())
                if data.get("optimized_queries"):
                    optimized_queries = data["optimized_queries"]
        except asyncio.TimeoutError:
            logger.warning("Search plan timed out", task_id=context.task_id)
        except Exception as e:
            logger.warning(f"Search plan failed: {e}", task_id=context.task_id)
        context.event_bus.emit(context.task_id, "web_search_agent.plan_search_complete", {
            "optimized_queries_count": len(optimized_queries),
        })

        # Step 2: execute_search — 按回退链执行搜索
        context.event_bus.emit(context.task_id, "web_search_agent.execute_search_start", {
            "queries_to_execute": optimized_queries,
        })
        all_results: list[dict] = []
        for q in optimized_queries:
            search_result = await self._search_with_fallback(context, q, max_results)
            all_results.extend(search_result)
        context.event_bus.emit(context.task_id, "web_search_agent.execute_search_complete", {
            "results_count": len(all_results),
        })

        # Step 3: summarize — LLM 摘要去重
        context.event_bus.emit(context.task_id, "web_search_agent.summarize_start", {
            "results_to_summarize": len(all_results),
        })
        if all_results:
            results_text = "\n".join(
                f"[{i+1}] {r['title']}\n   {r['snippet'][:150]}\n   URL: {r['url']}"
                for i, r in enumerate(all_results)
            )
            summarize_prompt = get_prompt("agent.web_search_summarize", results=results_text[:4000])
            try:
                result = await asyncio.wait_for(
                    context.tools.execute("llm", ToolInput(params={
                        "messages": [{"role": "user", "content": summarize_prompt}],
                        "stream": False, "task_id": context.task_id,
                        "agent_name": self.name, "persona": context.persona or "default",
                    })),
                    timeout=_TOOL_TIMEOUT,
                )
                content = result.result.get("content", "{}")
                match = re.search(r'\{.*\}', content, re.DOTALL)
                if match:
                    data = json.loads(match.group())
                    if data.get("results"):
                        all_results = data["results"]
            except asyncio.TimeoutError:
                logger.warning("Search summarize timed out", task_id=context.task_id)
            except Exception as e:
                logger.warning(f"Search summarize failed: {e}", task_id=context.task_id)
        context.event_bus.emit(context.task_id, "web_search_agent.summarize_complete", {
            "final_results_count": len(all_results),
        })

        # Step 4: complete
        context.event_bus.emit(context.task_id, "web_search_agent.complete", {
            "results_count": len(all_results),
        })
        return AgentOutput(result={"results": all_results})

    async def _search_with_fallback(self, context: TaskContext, query: str, max_results: int) -> list[dict]:
        # Primary: web_search tool (含完整3级回退链：HelixRAG→DuckDuckGo/Tavily→LLM WebChat)
        try:
            result = await asyncio.wait_for(
                context.tools.execute("web_search", ToolInput(params={"query": query, "max_results": max_results})),
                timeout=_TOOL_TIMEOUT,
            )
            items = result.result.get("results", [])
            if items:
                source = result.result.get("source", "web_search")
                logger.info(f"web_search tool succeeded for '{query[:30]}' (source={source})", task_id=context.task_id)
                return [{
                    "title": item.get("title", ""),
                    "url": item.get("url", ""),
                    "snippet": item.get("content", item.get("snippet", "")),
                    "query": query,
                    "source": source,
                } for item in items]
        except asyncio.TimeoutError:
            logger.warning(f"web_search tool timed out for '{query[:30]}'", task_id=context.task_id)
        except Exception as e:
            logger.warning(f"web_search tool failed for '{query[:30]}': {e}", task_id=context.task_id)

        # Safety net: LLM WebChat 联网搜索（直接调用，绕过web_search工具）
        logger.info(f"Falling back to direct LLM WebChat search for '{query[:30]}'", task_id=context.task_id)
        try:
            search_prompt = _LLM_WEB_SEARCH_PROMPT.format(topic=query)
            llm_result = await asyncio.wait_for(
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
            content = llm_result.result.get("content", "{}")
            match = re.search(r'\{.*\}', content, re.DOTALL)
            if match:
                data = json.loads(match.group())
                results = []
                for r in data.get("results", []):
                    results.append({
                        "title": r.get("title", ""),
                        "url": r.get("url", ""),
                        "snippet": r.get("snippet", r.get("content", "")),
                        "query": query,
                        "source_type": "llm_web_search",
                    })
                if results:
                    return results
        except asyncio.TimeoutError:
            logger.warning(f"LLM WebChat search timed out for '{query[:30]}'", task_id=context.task_id)
        except Exception as e:
            logger.warning(f"LLM WebChat search failed for '{query[:30]}': {e}", task_id=context.task_id)

        return []
