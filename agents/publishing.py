import asyncio
from flowforge.core.base_agent import BaseAgent, AgentInput, AgentOutput
from flowforge.core.base_tool import ToolInput
from flowforge.core.task_context import TaskContext
from flowforge.core.tracing import get_logger

logger = get_logger("publishing_agent")

_TOOL_TIMEOUT = 300


class PublishingAgent(BaseAgent):
    name = "publishing"
    description = "多平台发布适配、格式转换、发布重试、熔断保护"
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
        title = input.params.get("seo_title", input.params.get("title", "New Article"))
        draft_val = input.params.get("draft", input.params.get("content", ""))
        content = draft_val if isinstance(draft_val, str) else str(draft_val)
        if not content and isinstance(draft_val, dict):
            content = draft_val.get("draft", draft_val.get("content", ""))
            content = content if isinstance(content, str) else str(content)
        platforms = input.params.get("platforms", context.state.get("platforms", ["local"]))

        published = {}
        for platform in platforms:
            tool_name = f"publish_{platform}"
            try:
                res = await asyncio.wait_for(
                    context.tools.execute(tool_name, ToolInput(params={"title": title, "content": content, "platform": platform})),
                    timeout=_TOOL_TIMEOUT,
                )
            except asyncio.TimeoutError:
                logger.warning(f"Publish to {platform} timed out", task_id=context.task_id)
                published[platform] = f"failed: timeout"
                continue
            except Exception:
                # Primary tool failed (not found or execution error), try fallback
                try:
                    res = await asyncio.wait_for(
                        context.tools.execute("publish_local", ToolInput(params={"title": title, "content": content, "platform": platform})),
                        timeout=_TOOL_TIMEOUT,
                    )
                except asyncio.TimeoutError:
                    logger.warning(f"Publish to {platform} timed out", task_id=context.task_id)
                    published[platform] = f"failed: timeout"
                    continue
                except Exception as e:
                    logger.warning(f"Publish to {platform} failed: {e}", task_id=context.task_id)
                    published[platform] = f"failed: {str(e)}"
                    continue

            published[platform] = res.result.get("url", "published")
            context.event_bus.emit(context.task_id, "publishing.platform_done", {
                "platform": platform, "url": res.result.get("url", ""),
            })

        context.event_bus.emit(context.task_id, "publishing.complete", {
            "platforms": list(published.keys()),
            "success_count": sum(1 for v in published.values() if not str(v).startswith("failed")),
        })
        return AgentOutput(result={"published": published})
