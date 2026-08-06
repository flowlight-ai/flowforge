"""
HelmEventEmitter - Abstract interface for Helm mode real-time event emission.

Wire this into Orchestrator, LLMClient, and ToolRegistry.
The concrete implementation is HelmWSManager in app/api/helm_ws_manager.py.

Blocking issue fix #1: define this interface BEFORE wiring, per HELM.md review.
"""

import json
from abc import ABC, abstractmethod
from datetime import datetime
from typing import Any


class HelmEventEmitter(ABC):

    @abstractmethod
    async def emit_event(self, task_id: str, event_type: str, payload: dict):
        ...

    async def emit_stage_enter(self, task_id: str, node_name: str, label: str, order: int, total: int):
        await self.emit_event(task_id, "helm.stage.enter", {
            "stage": node_name,
            "label": label,
            "order": order,
            "total": total
        })

    async def emit_tool_start(self, task_id: str, tool_name: str, params: dict):
        await self.emit_event(task_id, "helm.tool.start", {
            "tool_name": tool_name,
            "params": params,
            "timestamp": datetime.utcnow().isoformat()
        })

    async def emit_tool_end(self, task_id: str, tool_name: str, result: Any, duration_ms: float, error: str | None = None):
        await self.emit_event(task_id, "helm.tool.end", {
            "tool_name": tool_name,
            "result": self._safe_serialize(result),
            "duration_ms": duration_ms,
            "error": error
        })

    async def emit_llm_start(self, task_id: str, agent_name: str, model: str, messages_preview: list | None = None):
        await self.emit_event(task_id, "helm.llm.start", {
            "agent_name": agent_name,
            "model": model,
            "messages_preview": self._safe_serialize(messages_preview)
        })

    async def emit_llm_reasoning(self, task_id: str, agent_name: str, delta_text: str):
        await self.emit_event(task_id, "helm.llm.reasoning", {
            "agent_name": agent_name,
            "delta_text": delta_text
        })

    async def emit_llm_stream(self, task_id: str, agent_name: str, delta_text: str):
        await self.emit_event(task_id, "helm.llm.stream", {
            "agent_name": agent_name,
            "delta_text": delta_text
        })

    async def emit_llm_end(self, task_id: str, agent_name: str, full_response: str, tokens: int, error: str | None = None):
        await self.emit_event(task_id, "helm.llm.end", {
            "agent_name": agent_name,
            "full_response": full_response,
            "tokens": tokens,
            "error": error
        })

    async def emit_draft_update(self, task_id: str, content: str, is_partial: bool = True):
        await self.emit_event(task_id, "helm.draft.update", {
            "content": content,
            "is_partial": is_partial
        })

    async def emit_step_intermediate(self, task_id: str, step_name: str, data: dict):
        await self.emit_event(task_id, "helm.step.intermediate", {
            "step_name": step_name,
            "data": self._safe_serialize(data)
        })

    async def emit_review_ready(self, task_id: str, draft_summary: str):
        await self.emit_event(task_id, "helm.review.ready", {
            "task_id": task_id,
            "draft_summary": draft_summary
        })

    async def emit_review_submitted(self, task_id: str, verdict: str, feedback: str):
        await self.emit_event(task_id, "helm.review.submitted", {
            "verdict": verdict,
            "feedback": feedback
        })

    async def emit_task_paused(self, task_id: str, reason: str = ""):
        await self.emit_event(task_id, "helm.task.paused", {"reason": reason})

    async def emit_task_resumed(self, task_id: str):
        await self.emit_event(task_id, "helm.task.resumed", {})

    async def emit_task_completed(self, task_id: str, published_urls: list | None = None):
        await self.emit_event(task_id, "helm.task.completed", {
            "published_urls": published_urls or []
        })

    async def emit_task_error(self, task_id: str, step_name: str, error_message: str):
        await self.emit_event(task_id, "helm.task.error", {
            "step_name": step_name,
            "error_message": error_message
        })

    async def emit_token_stats(self, task_id: str, total_tokens: int, estimated_cost: float):
        await self.emit_event(task_id, "helm.token.stats", {
            "total_tokens": total_tokens,
            "estimated_cost": estimated_cost
        })

    @staticmethod
    def _safe_serialize(obj: Any) -> Any:
        if obj is None:
            return None
        if isinstance(obj, (str, int, float, bool, list, dict)):
            return obj
        try:
            return json.loads(json.dumps(obj, default=str))
        except Exception:
            return str(obj)
