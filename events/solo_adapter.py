"""Adapter that bridges FlowForge EventBus events to the Solo interaction mode.

Translates internal FlowForge event types into the Solo protocol event names
expected by the SoloManager, enabling real-time streaming of task progress
to the Solo WebSocket frontend.

License: MIT
"""

from .event_bus import EventBus

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
        "mode.enter": "solo.stage.enter",
        "tool.start": "solo.tool.start",
        "tool.end": "solo.tool.end",
        "llm.start": "solo.llm.start",
        "llm.reasoning": "solo.llm.reasoning",
        "llm.stream": "solo.llm.stream",
        "llm.end": "solo.llm.end",
        "draft.update": "solo.draft.update",
        "step.intermediate": "solo.step.intermediate",
        "review.ready": "solo.review.ready",
        "review.submitted": "solo.review.submitted",
        "task.paused": "solo.task.paused",
        "task.resumed": "solo.task.resumed",
        "task.completed": "solo.task.completed",
        "task.error": "solo.task.error",
        "token.stats": "solo.token.stats",
    }

    def __init__(self, event_bus: EventBus, solo_manager):
        """Initialize the adapter.

        Args:
            event_bus: The FlowForge EventBus to subscribe to.
            solo_manager: The SoloManager instance used to emit translated
                events.
        """
        self.event_bus = event_bus
        self.solo_manager = solo_manager
        self._bridged = False

    def bridge(self):
        """Establish the event bridge between EventBus and SoloManager.

        Subscribes a callback for each entry in ``EVENT_MAP`` that
        translates the FlowForge event type and re-emits it through the
        SoloManager.  This method is idempotent; subsequent calls after
        the first are no-ops.
        """
        if self._bridged:
            return
        for flowforge_event, solo_event_type in self.EVENT_MAP.items():
            def make_callback(etype=solo_event_type):
                async def callback(event):
                    await self.solo_manager.emit_event(
                        event["task_id"], etype, event["payload"])
                return callback
            self.event_bus.subscribe(flowforge_event, make_callback())
        self._bridged = True
