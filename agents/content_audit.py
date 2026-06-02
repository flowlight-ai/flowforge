import asyncio
import json
import re
from flowforge.core.base_agent import BaseAgent, AgentInput, AgentOutput
from flowforge.core.base_tool import ToolInput
from flowforge.core.prompt_manager import get_prompt
from flowforge.core.task_context import TaskContext
from flowforge.core.tracing import get_logger

logger = get_logger("content_audit_agent")

_TOOL_TIMEOUT = 300


class ContentAuditAgent(BaseAgent):
    name = "content_audit"
    description = "内容审核 Agent：多维度质量评估，使用 Agent-Judge 模式"
    default_mode = "agent_judge"

    def __init__(self, judge_model: str | None = None):
        super().__init__()
        self.judge_model = judge_model

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

        # Step 1: 内容质量评估
        context.event_bus.emit(context.task_id, "content_audit.assess_start", {"draft_length": len(draft)})
        assess_prompt = get_prompt("agent.content_audit.assess", draft=draft[:3000])
        assess_params = {
            "messages": [{"role": "user", "content": assess_prompt}],
            "stream": False, "task_id": context.task_id,
            "agent_name": self.name, "persona": context.persona or "default",
        }
        if self.judge_model:
            assess_params["model"] = self.judge_model
        assess_result = await asyncio.wait_for(
            context.tools.execute("llm", ToolInput(params=assess_params)),
            timeout=_TOOL_TIMEOUT,
        )
        assess_content = assess_result.result.get("content", "{}")

        score = 0.5
        issues = []
        suggestions = []
        assess_match = re.search(r'\{.*\}', assess_content, re.DOTALL)
        if assess_match:
            try:
                assess_data = json.loads(assess_match.group())
                dims = ["accuracy", "coherence", "expression", "value", "readability"]
                dim_scores = [assess_data.get(d, 5) for d in dims]
                score = sum(dim_scores) / (len(dims) * 10)
                issues = assess_data.get("issues", [])
                suggestions = assess_data.get("suggestions", [])
            except json.JSONDecodeError:
                logger.warning("Content audit assess JSON parse failed", task_id=context.task_id)

        context.event_bus.emit(context.task_id, "content_audit.assess_complete", {
            "score": score, "issues_count": len(issues),
        })

        # Step 2: 合规性检查
        context.event_bus.emit(context.task_id, "content_audit.compliance_start", {})
        compliance_prompt = get_prompt("agent.content_audit.compliance", draft=draft[:2000])
        compliance_params = {
            "messages": [{"role": "user", "content": compliance_prompt}],
            "stream": False, "task_id": context.task_id,
            "agent_name": f"{self.name}_compliance", "persona": context.persona or "default",
        }
        if self.judge_model:
            compliance_params["model"] = self.judge_model
        compliance_result = await asyncio.wait_for(
            context.tools.execute("llm", ToolInput(params=compliance_params)),
            timeout=_TOOL_TIMEOUT,
        )
        compliance_content = compliance_result.result.get("content", "{}")
        is_clean = True
        violations = []
        comp_match = re.search(r'\{.*\}', compliance_content, re.DOTALL)
        if comp_match:
            try:
                comp_data = json.loads(comp_match.group())
                is_clean = comp_data.get("is_clean", True)
                violations = comp_data.get("violations", [])
            except json.JSONDecodeError:
                logger.warning("Content audit compliance JSON parse failed", task_id=context.task_id)

        context.event_bus.emit(context.task_id, "content_audit.compliance_complete", {
            "is_clean": is_clean, "violations_count": len(violations),
        })

        context.event_bus.emit(context.task_id, "content_audit.complete", {
            "score": score, "is_clean": is_clean,
        })
        return AgentOutput(result={
            "score": score,
            "issues": issues,
            "suggestions": suggestions,
            "is_clean": is_clean,
            "violations": violations,
        })
