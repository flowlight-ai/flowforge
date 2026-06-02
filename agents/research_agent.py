import asyncio
import json
import re
from flowforge.core.base_agent import BaseAgent, AgentInput, AgentOutput
from flowforge.core.base_tool import ToolInput
from flowforge.core.prompt_manager import get_prompt
from flowforge.core.task_context import TaskContext
from flowforge.core.tracing import get_logger

logger = get_logger("research_agent")

_TOOL_TIMEOUT = 300


class ResearchAgent(BaseAgent):
    name = "research_agent"
    description = "深度研究 Agent：结合 web_search 检索与 LLM 综合，产出结构化研究报告"
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
        topic = input.params.get("topic", input.params.get("query", ""))
        depth = input.params.get("depth", "standard")
        max_results = input.params.get("max_results", 5)

        if not topic:
            return AgentOutput(result={"report": "", "sources": []})

        # Step 1: plan_research — 制定研究计划
        context.event_bus.emit(context.task_id, "research_agent.plan_research_start", {
            "topic": topic[:100], "depth": depth,
        })
        plan_prompt = get_prompt("agent.research_plan", topic=topic, depth=depth)
        research_plan = {}
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
                research_plan = json.loads(match.group())
        except asyncio.TimeoutError:
            logger.warning("Research plan timed out", task_id=context.task_id)
        except Exception as e:
            logger.warning(f"Research plan failed: {e}", task_id=context.task_id)
        context.event_bus.emit(context.task_id, "research_agent.plan_research_complete", {
            "sub_queries_count": len(research_plan.get("sub_queries", [])),
        })

        # Step 2: execute_search — 执行多角度检索
        context.event_bus.emit(context.task_id, "research_agent.execute_search_start", {
            "sub_queries": research_plan.get("sub_queries", [topic]),
        })
        search_queries = research_plan.get("sub_queries", [topic])[:3]
        if not search_queries:
            search_queries = [topic]
        all_search_results: list[dict] = []
        for q in search_queries:
            try:
                result = await asyncio.wait_for(
                    context.tools.execute("web_search",
                        ToolInput(params={"query": q, "max_results": max_results})
                    ),
                    timeout=_TOOL_TIMEOUT,
                )
                for r in result.result.get("results", []):
                    all_search_results.append({
                        "title": r.get("title", ""),
                        "url": r.get("url", ""),
                        "snippet": r.get("content", r.get("snippet", "")),
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
                            all_search_results.append({
                                "title": r.get("title", ""),
                                "url": "",
                                "snippet": r.get("snippet", ""),
                                "query": q,
                                "source_type": "llm_generated",
                                "disclaimer": "此内容由LLM生成，非真实搜索结果，可能包含不准确信息",
                            })
                except asyncio.TimeoutError:
                    logger.warning(f"LLM fallback for '{q}' timed out", task_id=context.task_id)
                except Exception as e:
                    logger.warning(f"LLM fallback for '{q}' failed: {e}", task_id=context.task_id)

        sources = [
            {"title": r["title"], "url": r["url"], "snippet": r["snippet"]}
            for r in all_search_results
        ]
        context.event_bus.emit(context.task_id, "research_agent.execute_search_complete", {
            "sources_count": len(sources),
        })

        # Step 3: synthesize_report — 综合分析撰写报告
        context.event_bus.emit(context.task_id, "research_agent.synthesize_report_start", {
            "sources_count": len(sources), "depth": depth,
        })
        source_text = "\n".join(
            f"[{i+1}] {s['title']}\n   {s['snippet']}\n   URL: {s['url']}"
            for i, s in enumerate(sources)
        )
        depth_instruction = {
            "brief": "请用200字以内简要概述核心发现。",
            "standard": "请撰写一份结构化的研究报告，包含：概述、关键发现、详细分析、结论。",
            "deep": "请撰写一份详尽的深度研究报告，包含：背景、研究方法、关键发现、多角度分析、潜在影响、局限性、结论与建议。",
        }.get(depth, "请撰写一份结构化的研究报告。")

        angles_text = "、".join(research_plan.get("angles", [])) if research_plan.get("angles") else "多角度综合分析"
        system_prompt = get_prompt("agent.research_synthesize", topic=topic, angles=angles_text, search_results=source_text, depth_instruction=depth_instruction)
        report = ""
        try:
            llm_result = await asyncio.wait_for(
                context.tools.execute("llm", ToolInput(params={
                    "messages": [{"role": "system", "content": system_prompt}, {"role": "user", "content": f"请对主题 {topic} 进行深度研究"}],
                    "max_tokens": 2000,
                    "stream": False, "task_id": context.task_id,
                    "agent_name": self.name, "persona": context.persona or "default",
                })),
                timeout=_TOOL_TIMEOUT,
            )
            report = llm_result.result.get("content", "")
        except asyncio.TimeoutError:
            logger.warning("Research synthesize timed out", task_id=context.task_id)
        except Exception as e:
            logger.warning(f"Research synthesize failed: {e}", task_id=context.task_id)
        context.event_bus.emit(context.task_id, "research_agent.synthesize_report_complete", {
            "report_length": len(report),
        })

        # Step 4: complete
        context.event_bus.emit(context.task_id, "research_agent.complete", {
            "report_length": len(report), "sources_count": len(sources),
        })
        return AgentOutput(result={"report": report, "sources": sources})
