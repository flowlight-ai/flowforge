import asyncio
import json
import re
from flowforge.core.base_agent import BaseAgent, AgentInput, AgentOutput
from flowforge.core.base_tool import ToolInput
from flowforge.core.prompt_manager import get_prompt
from flowforge.core.task_context import TaskContext
from flowforge.core.tracing import get_logger

logger = get_logger("trend_analysis_agent")

_TOOL_TIMEOUT = 300


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
        except Exception as e:
            logger.warning(f"Failed to get executor: {e}", task_id=ctx.task_id)
            ctx.event_bus = EventBus()
        return await self.execute_with_context(input, ctx)

    async def execute_with_context(self, input: AgentInput, context: TaskContext) -> AgentOutput:
        domain = input.params.get("domain", "综合")
        # 如果没有domain，尝试从topic推断
        if domain == "综合":
            topic = input.params.get("topic", input.params.get("query", input.params.get("task", "")))
            if topic:
                domain = topic

        # Step 1: 尝试通过搜索收集热点数据
        context.event_bus.emit(context.task_id, "trend_analysis.collect_data_start", {
            "domain": domain,
        })
        raw_items: list[dict] = []
        search_available = True
        try:
            result = await asyncio.wait_for(
                context.tools.execute("web_search",
                    ToolInput(params={"query": f"{domain} 今日热点", "max_results": 10})
                ),
                timeout=_TOOL_TIMEOUT,
            )
            for r in result.result.get("results", []):
                raw_items.append({
                    "title": r.get("title", ""),
                    "url": r.get("url", ""),
                    "snippet": r.get("content", r.get("snippet", "")),
                    "score": r.get("score", 0),
                })
            if result.result.get("search_available") is False:
                search_available = False
        except asyncio.TimeoutError:
            logger.warning("Web search for trends timed out", task_id=context.task_id)
            search_available = False
        except Exception as e:
            logger.warning(f"Web search for trends failed: {e}", task_id=context.task_id)
            search_available = False
        context.event_bus.emit(context.task_id, "trend_analysis.collect_data_complete", {
            "items_collected": len(raw_items),
        })

        # Step 2: 分析趋势（有搜索数据时用LLM分析，无搜索数据时直接LLM生成）
        analyzed_trends: list[dict] = []
        if raw_items:
            # 有搜索数据：用LLM分析
            items_text = "\n".join(
                f"[{i+1}] {item['title']} | {item.get('snippet', '')[:100]}"
                for i, item in enumerate(raw_items[:10])
            )
            analyze_prompt = get_prompt("agent.trend_analyze", domain=domain, data=items_text)
            try:
                result = await asyncio.wait_for(
                    context.tools.execute("llm", ToolInput(params={
                        "messages": [{"role": "user", "content": analyze_prompt}],
                        "stream": False, "task_id": context.task_id,
                        "agent_name": self.name, "persona": context.persona or "default",
                    })),
                    timeout=_TOOL_TIMEOUT,
                )
                content = result.result.get("content", "")
                analyzed_trends = self._parse_trends_json(content)
            except asyncio.TimeoutError:
                logger.warning("LLM trend analyze timed out", task_id=context.task_id)
            except Exception as e:
                logger.warning(f"LLM trend analyze failed: {e}", task_id=context.task_id)

            if not analyzed_trends:
                analyzed_trends = [
                    {"title": item["title"], "heat": item.get("score", 0), "direction": "未知", "potential": "中", "analysis": ""}
                    for item in raw_items[:5]
                ]

        # 无搜索数据或分析失败：用LLM直接生成趋势
        if not analyzed_trends:
            logger.info("No trends from search, using LLM to generate trends directly", task_id=context.task_id)
            context.event_bus.emit(context.task_id, "trend_analysis.llm_generate_start", {})
            try:
                direct_prompt = (
                    f"请分析{domain}领域的最新趋势，生成3-5个热点趋势。"
                    f"以JSON格式输出：{{\"trends\": [{{\"title\": \"趋势标题\", \"heat\": 热度1-10, "
                    f"\"direction\": \"上升/下降/平稳\", \"potential\": \"高/中/低\", "
                    f"\"analysis\": \"简要分析\"}}]}}"
                )
                result = await asyncio.wait_for(
                    context.tools.execute("llm", ToolInput(params={
                        "messages": [{"role": "user", "content": direct_prompt}],
                        "stream": False, "task_id": context.task_id,
                        "agent_name": self.name, "persona": context.persona or "default",
                    })),
                    timeout=_TOOL_TIMEOUT,
                )
                content = result.result.get("content", "")
                analyzed_trends = self._parse_trends_json(content)
            except asyncio.TimeoutError:
                logger.warning("LLM direct trend generation timed out", task_id=context.task_id)
            except Exception as e:
                logger.warning(f"LLM direct trend generation failed: {e}", task_id=context.task_id)
            context.event_bus.emit(context.task_id, "trend_analysis.llm_generate_complete", {
                "trends_count": len(analyzed_trends),
            })

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
            result = await asyncio.wait_for(
                context.tools.execute("llm", ToolInput(params={
                    "messages": [{"role": "user", "content": report_prompt}],
                    "stream": False, "task_id": context.task_id,
                    "agent_name": self.name, "persona": context.persona or "default",
                })),
                timeout=_TOOL_TIMEOUT,
            )
            report = result.result.get("content", "")
        except asyncio.TimeoutError:
            logger.warning("LLM trend report timed out", task_id=context.task_id)
            report = ""
        except Exception as e:
            logger.warning(f"LLM trend report failed: {e}", task_id=context.task_id)
            report = ""
        context.event_bus.emit(context.task_id, "trend_analysis.generate_report_complete", {
            "report_length": len(report),
        })

        # Step 4: complete
        context.event_bus.emit(context.task_id, "trend_analysis.complete", {
            "trends_count": len(analyzed_trends),
        })
        return AgentOutput(result={"trends": analyzed_trends, "report": report})

    @staticmethod
    def _parse_trends_json(content: str) -> list[dict]:
        """从LLM输出中解析趋势JSON，支持多种格式。"""
        if not content or not content.strip():
            return []
        # 尝试从markdown代码块中提取
        for marker in ["```json", "```JSON", "```"]:
            if marker in content:
                start = content.find(marker) + len(marker)
                end = content.rfind("```")
                if end > start:
                    content = content[start:end].strip()
                break
        # 尝试直接JSON解析
        try:
            match = re.search(r'\{[\s\S]*\}', content)
            if match:
                data = json.loads(match.group())
                return data.get("trends", [])
        except (json.JSONDecodeError, ValueError):
            pass
        # 尝试解析为数组
        try:
            match = re.search(r'\[[\s\S]*\]', content)
            if match:
                trends = json.loads(match.group())
                if isinstance(trends, list):
                    return trends
        except (json.JSONDecodeError, ValueError):
            pass
        return []
