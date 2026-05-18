import json
import re
from flowforge.core.base_agent import BaseAgent, AgentInput, AgentOutput
from flowforge.core.base_tool import ToolInput
from flowforge.core.task_context import TaskContext


class MaterialCollectionAgent(BaseAgent):
    name = "material_collection"
    description = "并行多源检索、素材清洗、关键事实提取"
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
        topics = input.params.get("topics", [])
        llm = context.tools.get_tool("llm")
        materials: list[dict] = []

        # Step 1: cache_check — 检查本地知识库缓存
        context.event_bus.emit(context.task_id, "material_collection.cache_check_start", {
            "topics_count": len(topics),
        })
        cached_materials: list[dict] = []
        for topic in topics[:2]:
            query = topic.get("title", "") if isinstance(topic, dict) else str(topic)
            try:
                helix = context.tools.get_tool("helixrag_search")
                result = await helix.execute(
                    ToolInput(params={"query": query, "max_results": 3, "min_score": 0.3})
                )
                for r in result.result.get("results", []):
                    cached_materials.append({
                        "title": r.get("title", ""),
                        "content": r.get("content", ""),
                        "url": r.get("url", ""),
                        "source_type": r.get("source_type", "cache"),
                    })
            except Exception:
                pass
        materials.extend(cached_materials)
        context.event_bus.emit(context.task_id, "material_collection.cache_check_complete", {
            "cached_count": len(cached_materials),
        })

        # Step 2: web_search — 对缓存不足的 topic 补充网络搜索
        context.event_bus.emit(context.task_id, "material_collection.web_search_start", {
            "topics_needing_search": len(topics),
        })
        web_materials: list[dict] = []
        for topic in topics[:3]:
            query = topic.get("title", "") if isinstance(topic, dict) else str(topic)
            try:
                search = context.tools.get_tool("web_search")
                result = await search.execute(ToolInput(params={"query": query, "max_results": 5}))
                for r in result.result.get("results", []):
                    web_materials.append({
                        "title": r.get("title", ""),
                        "content": r.get("content", r.get("snippet", "")),
                        "url": r.get("url", ""),
                        "source_type": "web",
                    })
            except Exception:
                try:
                    fallback_prompt = (
                        f"用户需要关于「{query}」的素材资料。请提供3条关键事实或数据点，"
                        f"每条包含标题和内容。严格输出JSON: {{\"facts\": [{{\"title\": \"...\", \"content\": \"...\"}}]}}"
                    )
                    llm_result = await llm.execute(ToolInput(params={
                        "messages": [{"role": "user", "content": fallback_prompt}],
                        "stream": True, "task_id": context.task_id,
                        "agent_name": self.name, "persona": context.persona or "default",
                    }))
                    content = llm_result.result.get("content", "{}")
                    match = re.search(r'\{.*\}', content, re.DOTALL)
                    if match:
                        data = json.loads(match.group())
                        for f in data.get("facts", []):
                            web_materials.append({
                                "title": f.get("title", ""),
                                "content": f.get("content", ""),
                                "url": "",
                                "source_type": "llm_fallback",
                            })
                except Exception:
                    pass
        materials.extend(web_materials)
        context.event_bus.emit(context.task_id, "material_collection.web_search_complete", {
            "web_count": len(web_materials),
        })

        # Step 3: llm_summarize — LLM 摘要清洗去重
        context.event_bus.emit(context.task_id, "material_collection.llm_summarize_start", {
            "total_materials": len(materials),
        })
        if materials:
            raw_text = "\n".join(
                f"[{i}] {m['title']}\n{m['content'][:300]}"
                for i, m in enumerate(materials) if m.get("content")
            )
            summarize_prompt = (
                f"以下是从多个来源收集的素材，请去重、提取关键事实，输出清洗后的素材列表。\n"
                f"严格输出JSON: {{\"materials\": [{{\"title\": \"...\", \"content\": \"...\", \"url\": \"...\", \"source_type\": \"...\"}}]}}\n\n"
                f"原始素材:\n{raw_text[:4000]}"
            )
            try:
                llm_result = await llm.execute(ToolInput(params={
                    "messages": [{"role": "user", "content": summarize_prompt}],
                    "stream": True, "task_id": context.task_id,
                    "agent_name": self.name, "persona": context.persona or "default",
                }))
                content = llm_result.result.get("content", "{}")
                match = re.search(r'\{.*\}', content, re.DOTALL)
                if match:
                    data = json.loads(match.group())
                    if data.get("materials"):
                        materials = data["materials"]
            except Exception:
                pass
        context.event_bus.emit(context.task_id, "material_collection.llm_summarize_complete", {
            "final_count": len(materials),
        })

        # Step 4: complete
        context.event_bus.emit(context.task_id, "material_collection.complete", {
            "materials_count": len(materials),
        })
        return AgentOutput(result={"materials": materials})
