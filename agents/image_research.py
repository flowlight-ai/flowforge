import asyncio
import json
import re
from flowforge.core.base_agent import BaseAgent, AgentInput, AgentOutput
from flowforge.core.base_tool import ToolInput
from flowforge.core.prompt_manager import get_prompt
from flowforge.core.task_context import TaskContext
from flowforge.core.tracing import get_logger

logger = get_logger("image_research_agent")

_TOOL_TIMEOUT = 300


class ImageResearchAgent(BaseAgent):
    name = "image_research"
    description = "配图搜索与推荐"
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
        except Exception as e:
            logger.warning(f"Failed to get executor: {e}", task_id=ctx.task_id)
            ctx.event_bus = EventBus()
        return await self.execute_with_context(input, ctx)

    async def execute_with_context(self, input: AgentInput, context: TaskContext) -> AgentOutput:
        topic = input.params.get("topic", "")
        count = input.params.get("count", 5)

        # Step 1: search_images — 搜索配图
        context.event_bus.emit(context.task_id, "image_research.search_images_start", {
            "topic": topic[:100], "count": count,
        })
        raw_images: list[dict] = []
        try:
            result = await asyncio.wait_for(
                context.tools.execute("pexels_image", ToolInput(params={"query": topic, "per_page": count})),
                timeout=_TOOL_TIMEOUT,
            )
            raw_images = result.result.get("images", [])
        except asyncio.TimeoutError:
            logger.warning("Pexels image search timed out", task_id=context.task_id)
        except Exception as e:
            logger.warning(f"Pexels image search failed: {e}", task_id=context.task_id)
            try:
                result = await asyncio.wait_for(
                    context.tools.execute("web_search",
                        ToolInput(params={"query": f"{topic} 配图 图片", "max_results": count})
                    ),
                    timeout=_TOOL_TIMEOUT,
                )
                for r in result.result.get("results", []):
                    raw_images.append({
                        "url": r.get("url", ""),
                        "title": r.get("title", ""),
                        "snippet": r.get("content", r.get("snippet", "")),
                    })
            except asyncio.TimeoutError:
                logger.warning("Web search for images timed out", task_id=context.task_id)
            except Exception as e:
                logger.warning(f"Web search for images failed: {e}", task_id=context.task_id)
                try:
                    fallback_prompt = (
                        f"为「{topic}」推荐{count}个配图搜索关键词和描述，"
                        f"用于后续在图库中检索。"
                        f"严格输出JSON: {{\"suggestions\": [{{\"keyword\": \"搜索词\", \"description\": \"画面描述\"}}]}}"
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
                        for s in data.get("suggestions", []):
                            raw_images.append({
                                "url": "",
                                "title": s.get("keyword", ""),
                                "snippet": s.get("description", ""),
                            })
                except asyncio.TimeoutError:
                    logger.warning("LLM image fallback timed out", task_id=context.task_id)
                except Exception as e:
                    logger.warning(f"LLM image fallback failed: {e}", task_id=context.task_id)
        context.event_bus.emit(context.task_id, "image_research.search_images_complete", {
            "images_found": len(raw_images),
        })

        # Step 2: filter_results — LLM 筛选和评估
        context.event_bus.emit(context.task_id, "image_research.filter_results_start", {
            "images_to_filter": len(raw_images),
        })
        filtered_images: list[dict] = raw_images
        if raw_images:
            images_text = "\n".join(
                f"[{i+1}] {img.get('title', '')} | {img.get('snippet', '')[:80]} | URL: {img.get('url', '无')}"
                for i, img in enumerate(raw_images)
            )
            filter_prompt = get_prompt("agent.image_filter", topic=topic, images=images_text)
            try:
                result = await asyncio.wait_for(
                    context.tools.execute("llm", ToolInput(params={
                        "messages": [{"role": "user", "content": filter_prompt}],
                        "stream": False, "task_id": context.task_id,
                        "agent_name": self.name, "persona": context.persona or "default",
                    })),
                    timeout=_TOOL_TIMEOUT,
                )
                content = result.result.get("content", "{}")
                match = re.search(r'\{.*\}', content, re.DOTALL)
                if match:
                    data = json.loads(match.group())
                    selected = data.get("selected", [])
                    if selected:
                        filtered_images = [
                            {"url": s.get("url", ""), "title": s.get("title", ""), "relevance": s.get("relevance", 0), "reason": s.get("reason", "")}
                            for s in selected
                        ]
            except asyncio.TimeoutError:
                logger.warning("Image filter timed out", task_id=context.task_id)
            except Exception as e:
                logger.warning(f"Image filter failed: {e}", task_id=context.task_id)
        context.event_bus.emit(context.task_id, "image_research.filter_results_complete", {
            "images_selected": len(filtered_images),
        })

        # Step 3: complete
        context.event_bus.emit(context.task_id, "image_research.complete", {
            "images_count": len(filtered_images),
        })
        return AgentOutput(result={"images": filtered_images})
