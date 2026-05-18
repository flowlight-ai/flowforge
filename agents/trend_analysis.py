import json
import re
from flowforge.core.base_agent import BaseAgent, AgentInput, AgentOutput
from flowforge.core.base_tool import ToolInput
from flowforge.core.prompt_manager import get_prompt
from flowforge.core.task_context import TaskContext


class TrendAnalysisAgent(BaseAgent):
    name = "trend_analysis"
    description = "实时热点趋势分析、热度预测"
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
        except Exception:
            ctx.event_bus = EventBus()
        return await self.execute_with_context(input, ctx)

    async def execute_with_context(self, input: AgentInput, context: TaskContext) -> AgentOutput:
        domain = input.params.get("domain", "综合")
        llm = context.tools.get_tool("llm")

        # Step 1: collect_data — 收集热点数据
        context.event_bus.emit(context.task_id, "trend_analysis.collect_data_start", {
            "domain": domain,
        })
        raw_items: list[dict] = []
        try:
            search = context.tools.get_tool("web_search")
            result = await search.execute(
                ToolInput(params={"query": f"{domain} 今日热点", "max_results": 10})
            )
            for r in result.result.get("results", []):
                raw_items.append({
                    "title": r.get("title", ""),
                    "url": r.get("url", ""),
                    "snippet": r.get("content", r.get("snippet", "")),
                    "score": r.get("score", 0),
                })
        except Exception:
            try:
                fallback_prompt = get_prompt("agent.trend_collect", domain=domain)
                llm_result = await llm.execute(ToolInput(params={
                    "messages": [{"role": "user", "content": fallback_prompt}],
                    "stream": True, "task_id": context.task_id,
                    "agent_name": self.name, "persona": context.persona or "default",
                }))
                content = llm_result.result.get("content", "{}")
                match = re.search(r'\{.*\}', content, re.DOTALL)
                if match:
                    data = json.loads(match.group())
                    for t in data.get("trends", []):
                        raw_items.append({
                            "title": t.get("title", ""),
                            "url": "",
                            "snippet": t.get("snippet", ""),
                            "score": 0,
                        })
            except Exception:
                pass
        context.event_bus.emit(context.task_id, "trend_analysis.collect_data_complete", {
            "items_collected": len(raw_items),
        })

        # Step 2: analyze_trends — LLM 分析趋势
        context.event_bus.emit(context.task_id, "trend_analysis.analyze_trends_start", {
            "items_count": len(raw_items),
        })
        analyzed_trends: list[dict] = []
        if raw_items:
            items_text = "\n".join(
                f"[{i+1}] {item['title']} | {item.get('snippet', '')[:100]}"
                for i, item in enumerate(raw_items[:10])
            )
            analyze_prompt = get_prompt("agent.trend_analyze", domain=domain, data=items_text)
            try:
                result = await llm.execute(ToolInput(params={
                    "messages": [{"role": "user", "content": analyze_prompt}],
                    "stream": True, "task_id": context.task_id,
                    "agent_name": self.name, "persona": context.persona or "default",
                }))
                content = result.result.get("content", "{}")
                match = re.search(r'\{.*\}', content, re.DOTALL)
                if match:
                    data = json.loads(match.group())
                    analyzed_trends = data.get("trends", [])
            except Exception:
                pass
        if not analyzed_trends:
            analyzed_trends = [
                {"title": item["title"], "heat": item.get("score", 0), "direction": "未知", "potential": "中", "analysis": ""}
                for item in raw_items[:5]
            ]
        context.event_bus.emit(context.task_id, "trend_analysis.analyze_trends_complete", {
            "trends_analyzed": len(analyzed_trends),
        })

        # Step 3: generate_report — 生成趋势报告
        context.event_bus.emit(context.task_id, "trend_analysis.generate_report_start", {
            "trends_count": len(analyzed_trends),
        })
        trends_text = "\n".join(
            f"- {t.get('title', '')}: 热度{t.get('heat', 0)}, 趋势{t.get('direction', '未知')}, 潜力{t.get('potential', '中')}"
            for t in analyzed_trends
        )
        report_prompt = (
            f"基于以下{domain}领域趋势分析数据，生成一份简要的趋势报告，包含：整体趋势判断、重点关注话题、建议行动。\n\n"
            f"趋势数据:\n{trends_text}"
        )
        try:
            result = await llm.execute(ToolInput(params={
                "messages": [{"role": "user", "content": report_prompt}],
                "stream": True, "task_id": context.task_id,
                "agent_name": self.name, "persona": context.persona or "default",
            }))
            report = result.result.get("content", "")
        except Exception:
            report = ""
        context.event_bus.emit(context.task_id, "trend_analysis.generate_report_complete", {
            "report_length": len(report),
        })

        # Step 4: complete
        context.event_bus.emit(context.task_id, "trend_analysis.complete", {
            "trends_count": len(analyzed_trends),
        })
        return AgentOutput(result={"trends": analyzed_trends})
