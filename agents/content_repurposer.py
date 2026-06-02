import asyncio
import json
import re
from flowforge.core.base_agent import BaseAgent, AgentInput, AgentOutput
from flowforge.core.base_tool import ToolInput
from flowforge.core.prompt_manager import get_prompt
from flowforge.core.task_context import TaskContext
from flowforge.core.tracing import get_logger

logger = get_logger("content_repurposer_agent")

_TOOL_TIMEOUT = 300


class ContentRepurposerAgent(BaseAgent):
    name = "content_repurposer"
    description = "内容多平台适配改写"
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
        target_platforms = input.params.get("platforms", ["wechat", "toutiao", "xiaohongshu"])
        variants: dict = {}

        # Step 1: analyze_content — 分析原文特征
        context.event_bus.emit(context.task_id, "content_repurposer.analyze_content_start", {
            "draft_length": len(draft), "platforms": target_platforms,
        })
        analyze_prompt = get_prompt("agent.repurposer_analyze", draft=draft[:2000])
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
            logger.warning("Content analyze timed out", task_id=context.task_id)
        except Exception as e:
            logger.warning(f"Content analyze failed: {e}", task_id=context.task_id)
        context.event_bus.emit(context.task_id, "content_repurposer.analyze_content_complete", {
            "core_message": analysis.get("core_message", "")[:100],
            "key_points_count": len(analysis.get("key_points", [])),
        })

        # Step 2: generate_variants — 为每个平台生成改写版本
        context.event_bus.emit(context.task_id, "content_repurposer.generate_variants_start", {
            "platforms": target_platforms,
        })
        platform_specs = {
            "wechat": "微信公众号：正式专业、段落清晰、可适当加粗重点、800-1500字",
            "toutiao": "今日头条：标题党风格、短段落、信息密度高、500-800字",
            "xiaohongshu": "小红书：轻松活泼、emoji点缀、要点式排版、300-600字",
            "zhihu": "知乎：深度分析、逻辑严密、引用数据、1000-2000字",
            "weibo": "微博：精简有力、话题标签、140字以内",
        }
        for platform in target_platforms:
            spec = platform_specs.get(platform, f"{platform}平台：保持核心信息，适配平台风格")
            key_points_text = "、".join(analysis.get("key_points", [])) if analysis.get("key_points") else "原文核心信息"
            prompt = get_prompt("agent.repurposer_rewrite", spec=spec, core_message=analysis.get('core_message', ''), key_points=key_points_text, tone=analysis.get('tone', '中性'), draft=draft[:1500])
            try:
                result = await asyncio.wait_for(
                    context.tools.execute("llm", ToolInput(params={
                        "messages": [{"role": "system", "content": prompt}, {"role": "user", "content": f"请改写为{platform}版本"}],
                        "max_tokens": 1500,
                        "stream": False, "task_id": context.task_id,
                        "agent_name": self.name, "persona": context.persona or "default",
                    })),
                    timeout=_TOOL_TIMEOUT,
                )
                variants[platform] = result.result.get("content", "")
            except asyncio.TimeoutError:
                logger.warning(f"Repurpose for {platform} timed out", task_id=context.task_id)
                variants[platform] = ""
            except Exception as e:
                logger.warning(f"Repurpose for {platform} failed: {e}", task_id=context.task_id)
                variants[platform] = ""
        context.event_bus.emit(context.task_id, "content_repurposer.generate_variants_complete", {
            "platforms_completed": [p for p in target_platforms if variants.get(p)],
        })

        # Step 3: complete
        context.event_bus.emit(context.task_id, "content_repurposer.complete", {
            "variants_count": len(variants),
        })
        return AgentOutput(result={"variants": variants})
