import time
import asyncio
from typing import Dict, Optional
from flowforge.core.task_context import TaskContext
from flowforge.core.errors import ConflictError
from flowforge.core.agent_registry import AgentRegistry
from flowforge.core.checkpoint_manager import CheckpointManager
from flowforge.modes.registry import ModeRegistry
from flowforge.events.event_bus import EventBus
from flowforge.events.solo_adapter import EventBusSoloAdapter
from flowforge.executor.state_manager import StateManager
from flowforge.memory.manager import MemoryManager
from flowforge.core import metrics as ff_metrics


class HybridExecutor:
    def __init__(self, mode_registry: ModeRegistry, agent_registry: AgentRegistry,
                 tool_registry, event_bus: EventBus, task_repo=None, audit_repo=None,
                 memory_manager: MemoryManager = None,
                 checkpointer_path: str = "data/checkpoints.db",
                 state_db_path: str = "data/states.db"):
        self.mode_registry = mode_registry
        self.agent_registry = agent_registry
        self.tool_registry = tool_registry
        self.event_bus = event_bus
        self.task_repo = task_repo
        self.audit_repo = audit_repo
        self.memory_manager = memory_manager
        self.state_manager = StateManager(state_db_path)
        self.checkpoint_manager = CheckpointManager(checkpointer_path)
        self._running_tasks: Dict[str, str] = {}
        self._solo_adapter: Optional[EventBusSoloAdapter] = None
        self._review_events: Dict[str, asyncio.Event] = {}
        self._pause_events: Dict[str, asyncio.Event] = {}
        self._task_contexts: Dict[str, TaskContext] = {}

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
            ff_metrics.record_task_created(mode_hint or "auto", persona)

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
        context.checkpoint = self.checkpoint_manager

        if not _is_substep:
            self._task_contexts[context.task_id] = context
            self.state_manager.save_state(context.task_id, {
                "task_id": context.task_id, "persona": persona,
                "mode": mode, "status": "running", "input_data": context.input_data,
            })

        start = time.time()
        try:
            self.event_bus.emit(context.task_id, "task.start", {"mode": mode})
            self.event_bus.emit(context.task_id, "mode.enter", {"mode": mode})
            result = await executor.run(context)
            duration = time.time() - start
            self.event_bus.emit(context.task_id, "task.completed", {"result": str(result)[:500]})
            if not _is_substep:
                ff_metrics.record_task_completed(mode, persona, duration)
                self.state_manager.update_state(context.task_id, {"status": "completed", "result": str(result)[:500]})
            return result
        except Exception as e:
            self.event_bus.emit(context.task_id, "task.error", {"error": str(e)})
            if not _is_substep:
                ff_metrics.record_task_failed(mode_hint or "auto", persona)
                self.state_manager.update_state(context.task_id, {"status": "failed", "error": str(e)})
            raise
        finally:
            if not _is_substep and persona in self._running_tasks:
                del self._running_tasks[persona]
            if not _is_substep and context.task_id in self._task_contexts:
                del self._task_contexts[context.task_id]

    async def submit_review(self, task_id: str, verdict: str, feedback: str = "", edited_draft: str = ""):
        self.event_bus.emit(task_id, "review.submitted", {"verdict": verdict, "feedback": feedback})
        self.state_manager.update_state(task_id, {"review_verdict": verdict, "review_feedback": feedback})
        review_event = self._review_events.get(task_id)
        if review_event:
            review_event.set()
            del self._review_events[task_id]

    async def pause_task(self, task_id: str):
        self.event_bus.emit(task_id, "task.paused", {"reason": "manual"})
        self.state_manager.update_state(task_id, {"status": "paused"})
        pause_event = asyncio.Event()
        self._pause_events[task_id] = pause_event

    async def resume_task(self, task_id: str):
        self.event_bus.emit(task_id, "task.resumed", {})
        self.state_manager.update_state(task_id, {"status": "running"})
        pause_event = self._pause_events.get(task_id)
        if pause_event:
            pause_event.set()
            del self._pause_events[task_id]

    async def get_task_snapshot(self, task_id: str) -> dict:
        state = self.state_manager.load_state(task_id)
        if state:
            return state
        return {"task_id": task_id, "status": "unknown"}

    def register_review_wait(self, task_id: str):
        review_event = asyncio.Event()
        self._review_events[task_id] = review_event
        return review_event

    def is_persona_running(self, persona: str) -> bool:
        return persona in self._running_tasks
