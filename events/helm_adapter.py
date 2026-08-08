"""Adapter that bridges FlowForge EventBus events to the Helm interaction mode.

Translates internal FlowForge event types into the Helm protocol event names
expected by the HelmManager, enabling real-time streaming of task progress
to the Helm WebSocket frontend.

License: MIT
"""

from .event_bus import EventBus
from flowforge.core.workspace import get_workspace_manager
from flowforge.core.tracing import get_logger

logger = get_logger("helm_adapter")


_SAVE_EVENTS = {
    "helm.stage.enter",
    "helm.stage.exit",
    "helm.tool.start",
    "helm.tool.end",
    "helm.draft.update",
    "helm.draft.file",
    "helm.step.intermediate",
    "helm.review.ready",
    "helm.task.completed",
    "helm.task.error",
}


def _event_to_message(event_type: str, payload: dict) -> dict | None:
    if event_type == "helm.stage.enter":
        label = payload.get("label") or payload.get("stage") or payload.get("step") or ""
        return {"role": "stage", "content": label, "data": payload}
    if event_type == "helm.stage.exit":
        label = payload.get("label") or payload.get("stage") or payload.get("step") or ""
        return {"role": "stage", "content": label, "data": payload}
    if event_type == "helm.tool.start":
        return {"role": "tool", "content": payload.get("tool_name", "tool"), "data": payload}
    if event_type == "helm.tool.end":
        return {"role": "tool", "content": payload.get("tool_name", "tool"), "data": payload}
    # NOTE: llm.end is deliberately NOT saved — draft.update carries user-facing content.
    # Saving llm.end creates duplicate AI messages in workspace chat history.
    if event_type == "helm.draft.update":
        content = payload.get("content", "")
        agent_name = payload.get("agent_name", "FlowForge Agent")
        is_partial = payload.get("is_partial", True)
        if not is_partial and content:
            return {"role": "assistant", "content": content, "data": {**payload, "_agent_name": agent_name, "_draft": True}}
        return None
    if event_type == "helm.draft.file":
        return {"role": "assistant", "content": "", "data": {**payload, "_agent_name": "FlowForge", "_is_file": True}}
    if event_type == "helm.step.intermediate":
        return {"role": "system", "content": payload.get("step_name", "intermediate"), "data": payload}
    if event_type == "helm.review.ready":
        return {"role": "review", "content": payload.get("draft_summary", ""), "data": payload}
    if event_type == "helm.task.completed":
        result = payload.get("result") or payload.get("summary") or payload.get("content") or ""
        if result:
            return {"role": "assistant", "content": str(result), "data": {**payload, "result": str(result)}}
        return {"role": "system", "content": "✓ 任务完成", "data": payload}
    if event_type == "helm.task.error":
        error_msg = payload.get('error_message') or payload.get('error') or '任务出错'
        return {"role": "system", "content": f"✗ {error_msg}", "data": {**payload, "error_message": error_msg}}
    return None


class EventBusHelmAdapter:
    """Bridges FlowForge internal events to the Helm interaction protocol.

    The adapter subscribes to FlowForge EventBus events and re-emits them
    through the HelmManager using the translated event type names defined
    in ``EVENT_MAP``.  Bridging is idempotent — calling ``bridge()`` multiple
    times has no additional effect.

    Attributes:
        EVENT_MAP: Class-level mapping from FlowForge event types to Helm
            event types.
        event_bus: The FlowForge EventBus instance to subscribe to.
        helm_manager: The HelmManager instance used for re-emission.
        _bridged: Whether the bridge has already been established.
    """

    EVENT_MAP = {
        "workflow.step.start": "helm.stage.enter",
        "workflow.step.complete": "helm.stage.exit",
        "mode.enter": "helm.stage.enter",
        "mode.exit": "helm.stage.exit",
        "tool.start": "helm.tool.start",
        "tool.end": "helm.tool.end",
        "llm.start": "helm.llm.start",
        "llm.reasoning": "helm.llm.reasoning",
        "llm.stream": "helm.llm.stream",
        "llm.end": "helm.llm.end",
        "draft.update": "helm.draft.update",
        "draft.file": "helm.draft.file",
        "step.intermediate": "helm.step.intermediate",
        "review.ready": "helm.review.ready",
        "review.submitted": "helm.review.submitted",
        "task.paused": "helm.task.paused",
        "task.resumed": "helm.task.resumed",
        "task.completed": "helm.task.completed",
        "task.error": "helm.task.error",
        "token.stats": "helm.token.stats",
        "tool_chain.iteration": "helm.stage.enter",
        "tool_chain.tool_call": "helm.tool.start",
        "tool_chain.tool_result": "helm.tool.end",
        "tool_chain.complete": "helm.stage.exit",
        "react.iteration": "helm.stage.enter",
        "react.thought": "helm.llm.reasoning",
        "react.action": "helm.tool.start",
        "react.observation": "helm.tool.end",
        "react.final": "helm.stage.exit",
        "react.loop_detected": "helm.task.error",
        "agent.start": "helm.agent.start",
        "agent.end": "helm.agent.end",
    }

    def __init__(self, event_bus: EventBus, helm_manager):
        self.event_bus = event_bus
        self.helm_manager = helm_manager
        self._bridged = False

    def bridge(self):
        if self._bridged:
            return
        for flowforge_event, helm_event_type in self.EVENT_MAP.items():
            def make_callback(etype=helm_event_type):
                async def callback(event):
                    task_id = event.get("task_id", "")
                    payload = event.get("payload", {})
                    logger.info(f"[helm_adapter] Event received: flowforge='{flowforge_event}' → helm='{etype}', task_id={task_id}")
                    await self.helm_manager.emit_event(task_id, etype, payload)
                    if etype in _SAVE_EVENTS and task_id:
                        try:
                            msg = _event_to_message(etype, payload)
                            if msg:
                                ws = get_workspace_manager()
                                ws.save_message(task_id, msg)
                                logger.info(f"[helm_adapter] Message saved: task_id={task_id}, role={msg.get('role')}, event_type={etype}")
                            else:
                                logger.debug(f"[helm_adapter] Message skipped (None): task_id={task_id}, event_type={etype}")
                            if etype == "helm.task.completed":
                                ws = get_workspace_manager()
                                ws.update_task_status(task_id, "completed")
                                logger.info(f"[helm_adapter] Task status updated: task_id={task_id}, status=completed")
                            elif etype == "helm.task.error":
                                ws = get_workspace_manager()
                                ws.update_task_status(task_id, "error")
                                logger.info(f"[helm_adapter] Task status updated: task_id={task_id}, status=error")
                        except Exception as e:
                            logger.warning(f"[helm_adapter] Save/status update failed: task_id={task_id}, event_type={etype}, error={e}")
                return callback
            self.event_bus.subscribe(flowforge_event, make_callback())
        self._bridged = True
