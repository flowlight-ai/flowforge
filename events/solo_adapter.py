"""Adapter that bridges FlowForge EventBus events to the Solo interaction mode.

Translates internal FlowForge event types into the Solo protocol event names
expected by the SoloManager, enabling real-time streaming of task progress
to the Solo WebSocket frontend.

License: MIT
"""

from .event_bus import EventBus
from flowforge.core.workspace import get_workspace_manager
from flowforge.core.tracing import get_logger

logger = get_logger("solo_adapter")


_SAVE_EVENTS = {
    "solo.stage.enter",
    "solo.stage.exit",
    "solo.tool.start",
    "solo.tool.end",
    "solo.draft.update",
    "solo.draft.file",
    "solo.step.intermediate",
    "solo.review.ready",
    "solo.task.completed",
    "solo.task.error",
}


def _event_to_message(event_type: str, payload: dict) -> dict | None:
    if event_type == "solo.stage.enter":
        label = payload.get("label") or payload.get("stage") or payload.get("step") or ""
        return {"role": "stage", "content": label, "data": payload}
    if event_type == "solo.stage.exit":
        label = payload.get("label") or payload.get("stage") or payload.get("step") or ""
        return {"role": "stage", "content": label, "data": payload}
    if event_type == "solo.tool.start":
        return {"role": "tool", "content": payload.get("tool_name", "tool"), "data": payload}
    if event_type == "solo.tool.end":
        return {"role": "tool", "content": payload.get("tool_name", "tool"), "data": payload}
    # NOTE: llm.end is deliberately NOT saved — draft.update carries user-facing content.
    # Saving llm.end creates duplicate AI messages in workspace chat history.
    if event_type == "solo.draft.update":
        content = payload.get("content", "")
        agent_name = payload.get("agent_name", "FlowForge Agent")
        is_partial = payload.get("is_partial", True)
        if not is_partial and content:
            return {"role": "assistant", "content": content, "data": {**payload, "_agent_name": agent_name, "_draft": True}}
        return None
    if event_type == "solo.draft.file":
        return {"role": "assistant", "content": "", "data": {**payload, "_agent_name": "FlowForge", "_is_file": True}}
    if event_type == "solo.step.intermediate":
        return {"role": "system", "content": payload.get("step_name", "intermediate"), "data": payload}
    if event_type == "solo.review.ready":
        return {"role": "review", "content": payload.get("draft_summary", ""), "data": payload}
    if event_type == "solo.task.completed":
        result = payload.get("result") or payload.get("summary") or payload.get("content") or ""
        if result:
            return {"role": "assistant", "content": str(result), "data": {**payload, "result": str(result)}}
        return {"role": "system", "content": "✓ 任务完成", "data": payload}
    if event_type == "solo.task.error":
        error_msg = payload.get('error_message') or payload.get('error') or '任务出错'
        return {"role": "system", "content": f"✗ {error_msg}", "data": {**payload, "error_message": error_msg}}
    return None


class EventBusSoloAdapter:
    """Bridges FlowForge internal events to the Solo interaction protocol.

    The adapter subscribes to FlowForge EventBus events and re-emits them
    through the SoloManager using the translated event type names defined
    in ``EVENT_MAP``.  Bridging is idempotent — calling ``bridge()`` multiple
    times has no additional effect.

    Attributes:
        EVENT_MAP: Class-level mapping from FlowForge event types to Solo
            event types.
        event_bus: The FlowForge EventBus instance to subscribe to.
        solo_manager: The SoloManager instance used for re-emission.
        _bridged: Whether the bridge has already been established.
    """

    EVENT_MAP = {
        "workflow.step.start": "solo.stage.enter",
        "workflow.step.complete": "solo.stage.exit",
        "mode.enter": "solo.stage.enter",
        "mode.exit": "solo.stage.exit",
        "tool.start": "solo.tool.start",
        "tool.end": "solo.tool.end",
        "llm.start": "solo.llm.start",
        "llm.reasoning": "solo.llm.reasoning",
        "llm.stream": "solo.llm.stream",
        "llm.end": "solo.llm.end",
        "draft.update": "solo.draft.update",
        "draft.file": "solo.draft.file",
        "step.intermediate": "solo.step.intermediate",
        "review.ready": "solo.review.ready",
        "review.submitted": "solo.review.submitted",
        "task.paused": "solo.task.paused",
        "task.resumed": "solo.task.resumed",
        "task.completed": "solo.task.completed",
        "task.error": "solo.task.error",
        "token.stats": "solo.token.stats",
        "tool_chain.iteration": "solo.stage.enter",
        "tool_chain.tool_call": "solo.tool.start",
        "tool_chain.tool_result": "solo.tool.end",
        "tool_chain.complete": "solo.stage.exit",
        "react.iteration": "solo.stage.enter",
        "react.thought": "solo.llm.reasoning",
        "react.action": "solo.tool.start",
        "react.observation": "solo.tool.end",
        "react.final": "solo.stage.exit",
        "react.loop_detected": "solo.task.error",
        "agent.start": "solo.agent.start",
        "agent.end": "solo.agent.end",
    }

    def __init__(self, event_bus: EventBus, solo_manager):
        self.event_bus = event_bus
        self.solo_manager = solo_manager
        self._bridged = False

    def bridge(self):
        if self._bridged:
            return
        for flowforge_event, solo_event_type in self.EVENT_MAP.items():
            def make_callback(etype=solo_event_type):
                async def callback(event):
                    task_id = event.get("task_id", "")
                    payload = event.get("payload", {})
                    logger.info(f"[solo_adapter] Event received: flowforge='{flowforge_event}' → solo='{etype}', task_id={task_id}")
                    await self.solo_manager.emit_event(task_id, etype, payload)
                    if etype in _SAVE_EVENTS and task_id:
                        try:
                            msg = _event_to_message(etype, payload)
                            if msg:
                                ws = get_workspace_manager()
                                ws.save_message(task_id, msg)
                                logger.info(f"[solo_adapter] Message saved: task_id={task_id}, role={msg.get('role')}, event_type={etype}")
                            else:
                                logger.debug(f"[solo_adapter] Message skipped (None): task_id={task_id}, event_type={etype}")
                            if etype == "solo.task.completed":
                                ws = get_workspace_manager()
                                ws.update_task_status(task_id, "completed")
                                logger.info(f"[solo_adapter] Task status updated: task_id={task_id}, status=completed")
                            elif etype == "solo.task.error":
                                ws = get_workspace_manager()
                                ws.update_task_status(task_id, "error")
                                logger.info(f"[solo_adapter] Task status updated: task_id={task_id}, status=error")
                        except Exception as e:
                            logger.warning(f"[solo_adapter] Save/status update failed: task_id={task_id}, event_type={etype}, error={e}")
                return callback
            self.event_bus.subscribe(flowforge_event, make_callback())
        self._bridged = True
