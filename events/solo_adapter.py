from .event_bus import EventBus

class EventBusSoloAdapter:
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
        self.event_bus = event_bus
        self.solo_manager = solo_manager
        self._bridged = False

    def bridge(self):
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
