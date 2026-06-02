import asyncio
import json
import re
from flowforge.core.base_agent import BaseAgent, AgentInput, AgentOutput
from flowforge.core.base_tool import ToolInput
from flowforge.core.prompt_manager import get_prompt
from flowforge.core.task_context import TaskContext
from flowforge.core.tracing import get_logger

logger = get_logger("headline_optimizer_agent")

_TOOL_TIMEOUT = 300


class HeadlineOptimizerAgent(BaseAgent):
    name = "headline_optimizer"
    description = "标题 A/B 测试、点击率优化"
    default_mode = "reflexion"

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
        topic = input.params.get("topic", "")
        draft_title = input.params.get("title", "")
        headlines: list[str] = [draft_title] if draft_title else []

        # Step 1: analyze_topic — 分析主题特征和受众
        context.event_bus.emit(context.task_id, "headline_optimizer.analyze_topic_start", {
            "topic": topic[:100], "has_draft_title": bool(draft_title),
        })
        analyze_prompt = get_prompt("agent.headline_analyze", topic=topic, title=draft_title)
        analysis = {}
        try:
            result = await asyncio.wait_for(
                context.tools.execute("llm", ToolInput(params={
                    "messages": [{"role": "user", "content": analyze_prompt}],
                    "stream": False, "task_id": context.task_id,
                    "agent_name": self.name, "persona": context.persona or "default",
                })),
                timeout=_TOOL_TIMEOUT,
            )
            content = result.result.get("content", "{}")
            match = re.search(r'\{.*\}', content, re.DOTALL)
            if match:
                analysis = json.loads(match.group())
        except asyncio.TimeoutError:
            logger.warning("Headline analyze timed out", task_id=context.task_id)
        except Exception as e:
            logger.warning(f"Headline analyze failed: {e}", task_id=context.task_id)
        context.event_bus.emit(context.task_id, "headline_optimizer.analyze_topic_complete", {
            "audience": analysis.get("audience", ""),
            "hooks_count": len(analysis.get("hooks", [])),
        })

        # Step 2: generate_headlines — 基于分析生成候选标题
        context.event_bus.emit(context.task_id, "headline_optimizer.generate_headlines_start", {
            "analysis_available": bool(analysis),
        })
        hooks_text = "、".join(analysis.get("hooks", [])) if analysis.get("hooks") else "吸引力、好奇心、紧迫感"
        generate_prompt = get_prompt("agent.headline_generate", topic=topic, original_title=draft_title, audience=analysis.get('audience', '泛受众'), hooks=hooks_text)
        try:
            result = await asyncio.wait_for(
                context.tools.execute("llm", ToolInput(params={
                    "messages": [{"role": "user", "content": generate_prompt}],
                    "stream": False, "task_id": context.task_id,
                    "agent_name": self.name, "persona": context.persona or "default",
                })),
                timeout=_TOOL_TIMEOUT,
            )
            content = result.result.get("content", "{}")
            match = re.search(r'\{.*\}', content, re.DOTALL)
            if match:
                data = json.loads(match.group())
                headlines = data.get("headlines", headlines)
        except asyncio.TimeoutError:
            logger.warning("Headline generate timed out", task_id=context.task_id)
        except Exception as e:
            logger.warning(f"Headline generate failed: {e}", task_id=context.task_id)
        context.event_bus.emit(context.task_id, "headline_optimizer.generate_headlines_complete", {
            "headlines_count": len(headlines),
        })

        # Step 3: evaluate_headlines — 评估标题质量并排序
        context.event_bus.emit(context.task_id, "headline_optimizer.evaluate_headlines_start", {
            "headlines_count": len(headlines),
        })
        if len(headlines) > 1:
            headlines_text = "\n".join(f"{i+1}. {h}" for i, h in enumerate(headlines))
            evaluate_prompt = get_prompt("agent.headline_evaluate", headlines=headlines_text)
            try:
                result = await asyncio.wait_for(
                    context.tools.execute("llm", ToolInput(params={
                        "messages": [{"role": "user", "content": evaluate_prompt}],
                        "stream": False, "task_id": context.task_id,
                        "agent_name": self.name, "persona": context.persona or "default",
                    })),
                    timeout=_TOOL_TIMEOUT,
                )
                content = result.result.get("content", "{}")
                match = re.search(r'\{.*\}', content, re.DOTALL)
                if match:
                    data = json.loads(match.group())
                    ranked = data.get("ranked", [])
                    if ranked:
                        headlines = [r.get("headline", "") for r in ranked if r.get("headline")]
            except asyncio.TimeoutError:
                logger.warning("Headline evaluate timed out", task_id=context.task_id)
            except Exception as e:
                logger.warning(f"Headline evaluate failed: {e}", task_id=context.task_id)
        context.event_bus.emit(context.task_id, "headline_optimizer.evaluate_headlines_complete", {
            "final_headlines_count": len(headlines),
        })

        # Step 4: complete
        context.event_bus.emit(context.task_id, "headline_optimizer.complete", {
            "headlines_count": len(headlines),
        })
        return AgentOutput(result={"headlines": headlines})
