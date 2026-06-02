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


class WebSearchAgent(BaseAgent):
    name = "web_search_agent"
    description = "网络搜索 Agent：使用 web_search 工具检索互联网信息，返回结构化结果"
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

        # Step 2: execute_search — 执行搜索
        context.event_bus.emit(context.task_id, "web_search_agent.execute_search_start", {
            "queries_to_execute": optimized_queries,
        })
        all_results: list[dict] = []
        for q in optimized_queries:
            try:
                result = await asyncio.wait_for(
                    context.tools.execute("web_search",
                        ToolInput(params={"query": q, "max_results": max_results})
                    ),
                    timeout=_TOOL_TIMEOUT,
                )
                for item in result.result.get("results", []):
                    all_results.append({
                        "title": item.get("title", ""),
                        "url": item.get("url", ""),
                        "snippet": item.get("content", item.get("snippet", "")),
                        "query": q,
                    })
            except asyncio.TimeoutError:
                logger.warning(f"Web search for '{q}' timed out", task_id=context.task_id)
            except Exception as e:
                logger.warning(f"Web search for '{q}' failed: {e}", task_id=context.task_id)
                try:
                    fallback_prompt = (
                        f"关于「{q}」，请提供3条关键信息，包含标题和摘要。"
                        f"严格输出JSON: {{\"results\": [{{\"title\": \"...\", \"snippet\": \"...\"}}]}}"
                    )
                    llm_result = await asyncio.wait_for(
                        context.tools.execute("llm", ToolInput(params={
                            "messages": [{"role": "user", "content": fallback_prompt}],
                            "stream": False, "task_id": context.task_id,
                            "agent_name": self.name, "persona": context.persona or "default",
                        })),
                        timeout=_TOOL_TIMEOUT,
                    )
                    content = llm_result.result.get("content", "{}")
                    match = re.search(r'\{.*\}', content, re.DOTALL)
                    if match:
                        data = json.loads(match.group())
                        for r in data.get("results", []):
                            all_results.append({
                                "title": r.get("title", ""),
                                "url": "",
                                "snippet": r.get("snippet", ""),
                                "query": q,
                                "source_type": "llm_generated",
                                "disclaimer": "此内容由LLM生成，非真实搜索结果",
                            })
                except asyncio.TimeoutError:
                    logger.warning(f"LLM fallback for '{q}' timed out", task_id=context.task_id)
                except Exception as e:
                    logger.warning(f"LLM fallback for '{q}' failed: {e}", task_id=context.task_id)
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
