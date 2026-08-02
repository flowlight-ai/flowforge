"""LLMClient Helm Adapter — Bridges HelmEventEmitter events to LLMClient lifecycle.

Provides:
- LLMClientHelmAdapter: Wraps calls to emit helm.*.llm.* events via HelmEventEmitter
- Global emitter get/set functions for task-scoped adapter management
"""
from typing import Any

from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.helm_adapter")


class LLMClientHelmAdapter:
    """Helm mode adapter — wraps calls to emit helm.*.llm.* events via HelmEventEmitter."""

    def __init__(self, emitter: Any, task_id: str):
        self.emitter = emitter
        self.task_id = task_id

    async def on_start(self, agent_name: str, model: str, messages):
        await self.emitter.emit_llm_start(self.task_id, agent_name, model, messages[:3] if messages else None)

    async def on_reasoning(self, agent_name: str, delta: str):
        await self.emitter.emit_llm_reasoning(self.task_id, agent_name, delta)

    async def on_stream(self, agent_name: str, delta: str):
        await self.emitter.emit_llm_stream(self.task_id, agent_name, delta)

    async def on_end(self, agent_name: str, full_response: str, tokens: int, error: str = None):
        await self.emitter.emit_llm_end(self.task_id, agent_name, full_response[:2000], tokens, error)


_helm_emitter: LLMClientHelmAdapter = None


def g_llm_client_set_helm_emitter(adapter):
    global _helm_emitter
    _helm_emitter = adapter


def g_llm_client_get_helm_emitter():
    return _helm_emitter
