import time
from typing import Dict, Optional
from core.task_context import TaskContext
from core.errors import ConflictError
from modes.registry import ModeRegistry
from events.event_bus import EventBus
from events.solo_adapter import EventBusSoloAdapter
from core import metrics

class HybridExecutor:
    def __init__(self, mode_registry: ModeRegistry, agent_registry, tool_registry,
                 event_bus: EventBus, task_repo=None, audit_repo=None,
                 memory_manager=None, checkpointer_path="data/checkpoints.db"):
        self.mode_registry = mode_registry
        self.agent_registry = agent_registry
        self.tool_registry = tool_registry
        self.event_bus = event_bus
        self.task_repo = task_repo
        self.audit_repo = audit_repo
        self.memory_manager = memory_manager
        self.checkpointer_path = checkpointer_path
        self._running_tasks: Dict[str, str] = {}
        self._solo_adapter: Optional[EventBusSoloAdapter] = None
        self._review_events: Dict[str, any] = {}

    def set_solo_manager(self, solo_manager):
        self._solo_adapter = EventBusSoloAdapter(self.event_bus, solo_manager)

    async def run(self, context: TaskContext, mode_hint: str = None,
                  _is_substep: bool = False) -> dict:
        persona = context.persona or "default"

        if not _is_substep:
            if persona in self._running_tasks:
                raise ConflictError(
                    f"Persona '{persona}' already running task {self._running_tasks[persona]}")
            self._running_tasks[persona] = context.task_id
            metrics.record_task_created(mode_hint or "auto", persona)

        if mode_hint is None and context.mode is None:
            mode = self.mode_registry.suggest_mode(context.input_data.get("task", ""))
        else:
            mode = mode_hint or context.mode

        if context.interaction_mode == "solo" and self._solo_adapter:
            self._solo_adapter.bridge()

        executor = self.mode_registry.get(mode)
        context.tools = self.tool_registry
        context.agents = self.agent_registry
        context.executor = self
        context.mode = mode

        start = time.time()
        try:
            self.event_bus.emit(context.task_id, "task.start", {"mode": mode})
            self.event_bus.emit(context.task_id, "mode.enter", {"mode": mode})
            result = await executor.run(context)
            duration = time.time() - start
            self.event_bus.emit(context.task_id, "task.completed", {"result": result})
            if not _is_substep:
                metrics.record_task_completed(mode, persona, duration)
            return result
        except Exception as e:
            self.event_bus.emit(context.task_id, "task.error", {"error": str(e)})
            if not _is_substep:
                metrics.record_task_failed(mode_hint or "auto", persona)
            raise
        finally:
            if not _is_substep and persona in self._running_tasks:
                del self._running_tasks[persona]

    async def submit_review(self, task_id: str, verdict: str, feedback: str = "", edited_draft: str = ""):
        self.event_bus.emit(task_id, "review.submitted", {"verdict": verdict, "feedback": feedback})
        review_event = self._review_events.get(task_id)
        if review_event:
            review_event.set()
            del self._review_events[task_id]

    async def pause_task(self, task_id: str):
        self.event_bus.emit(task_id, "task.paused", {"reason": "manual"})

    async def resume_task(self, task_id: str):
        self.event_bus.emit(task_id, "task.resumed", {})

    async def get_task_snapshot(self, task_id: str) -> dict:
        return {"task_id": task_id, "status": "unknown"}
