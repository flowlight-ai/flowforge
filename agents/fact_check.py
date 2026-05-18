import json
import re
import httpx
from flowforge.core.base_agent import BaseAgent, AgentInput, AgentOutput
from flowforge.core.base_tool import ToolInput
from flowforge.core.prompt_manager import get_prompt
from flowforge.core.task_context import TaskContext


class FactCheckAgent(BaseAgent):
    name = "fact_check"
    description = "事实核查 Agent：链接可达性检查 + LLM 事实验证，使用 ReAct 模式"
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
        draft_val = input.params.get("draft", "")
        draft = draft_val if isinstance(draft_val, str) else (draft_val.get("draft", str(draft_val)) if isinstance(draft_val, dict) else str(draft_val))

        issues = []
        is_clean = True

        # Step 1: 提取URL并检查可达性
        context.event_bus.emit(context.task_id, "fact_check.url_check_start", {"draft_length": len(draft)})
        url_pattern = r'https?://[^\s\)\]\"\'\>]+'
        urls = re.findall(url_pattern, draft)

        url_results = {}
        for url in urls[:5]:
            try:
                async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
                    resp = await client.head(url)
                    url_results[url] = resp.status_code < 400
                    if resp.status_code >= 400:
                        issues.append(f"链接不可达: {url} (HTTP {resp.status_code})")
                        is_clean = False
            except Exception as e:
                url_results[url] = False
                issues.append(f"链接检查失败: {url} ({str(e)[:50]})")
                is_clean = False

        context.event_bus.emit(context.task_id, "fact_check.url_check_complete", {
            "urls_checked": len(url_results), "failed": sum(1 for v in url_results.values() if not v),
        })

        # Step 2: LLM事实核查
        context.event_bus.emit(context.task_id, "fact_check.fact_verify_start", {})
        llm = context.tools.get_tool("llm")
        verify_prompt = get_prompt("agent.fact_check", draft=draft[:3000])
        result = await llm.execute(ToolInput(params={
            "messages": [{"role": "user", "content": verify_prompt}],
            "stream": True, "task_id": context.task_id,
            "agent_name": self.name, "persona": context.persona or "default",
        }))
        content = result.result.get("content", "{}")
        fact_match = re.search(r'\{.*\}', content, re.DOTALL)
        if fact_match:
            try:
                fact_data = json.loads(fact_match.group())
                fact_issues = fact_data.get("issues", [])
                issues.extend(fact_issues)
                if not fact_data.get("is_clean", True):
                    is_clean = False
            except json.JSONDecodeError:
                pass

        context.event_bus.emit(context.task_id, "fact_check.fact_verify_complete", {
            "issues_count": len(issues), "is_clean": is_clean,
        })

        context.event_bus.emit(context.task_id, "fact_check.complete", {
            "issues_count": len(issues), "is_clean": is_clean,
        })
        return AgentOutput(result={"issues": issues, "is_clean": is_clean})
