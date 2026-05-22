"""Hybrid executor that orchestrates task execution across multiple modes.

The HybridExecutor is the central runtime engine of FlowForge.  It selects
the appropriate execution mode, manages task lifecycle (start, pause, resume,
review), persists state and checkpoints, and bridges events to the Solo
interaction protocol when applicable.

v6.0: Integrates Harness Layer hooks (pre_execute / post_execute).

License: MIT
"""

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
from flowforge.core.tracing import get_logger

logger = get_logger("executor")

TASK_TIMEOUT_SECONDS = 120


class HybridExecutor:
    """Central task execution engine supporting multiple reasoning modes.

    HybridExecutor coordinates the full lifecycle of a task: mode selection,
    context hydration, execution delegation, state persistence, event
    emission, and review/pause/resume control.  It enforces persona-level
    concurrency limits (one running task per persona) and records metrics
    for observability.

    v6.0: Added optional ``harness`` parameter for Harness Layer integration.
    When harness is provided, ``pre_execute`` and ``post_execute`` hooks
    are called around mode execution.

    Attributes:
        mode_registry: Registry of available execution modes.
        agent_registry: Registry of available agents.
        tool_registry: Registry of available tools.
        event_bus: Event bus for task lifecycle events.
        task_repo: Optional repository for task persistence.
        audit_repo: Optional repository for audit logging.
        memory_manager: Optional memory manager for long-term recall.
        state_manager: Manager for task state persistence.
        checkpoint_manager: Manager for checkpoint persistence.
        harness: Optional HarnessOrchestrator for v6.0 Harness Layer.
    """

    def __init__(self, mode_registry: ModeRegistry, agent_registry: AgentRegistry,
                 tool_registry, event_bus: EventBus, task_repo=None, audit_repo=None,
                 memory_manager: MemoryManager = None,
                 checkpointer_path: str = "data/checkpoints.db",
                 state_db_path: str = "data/states.db",
                 harness=None):
        """Initialize the HybridExecutor.

        Args:
            mode_registry: Registry that maps mode names to executors.
            agent_registry: Registry of available agents.
            tool_registry: Registry of available tools.
            event_bus: Event bus for emitting lifecycle events.
            task_repo: Optional task repository for persistence.
            audit_repo: Optional audit repository for logging.
            memory_manager: Optional memory manager instance.
            checkpointer_path: File path for the checkpoint SQLite database.
            state_db_path: File path for the state SQLite database.
            harness: Optional HarnessOrchestrator for v6.0 Harness Layer.
        """
        self.mode_registry = mode_registry
        self.agent_registry = agent_registry
        self.tool_registry = tool_registry
        self.event_bus = event_bus
        self.task_repo = task_repo
        self.audit_repo = audit_repo
        self.memory_manager = memory_manager
        self.state_manager = StateManager(state_db_path)
        self.checkpoint_manager = CheckpointManager(checkpointer_path)
        self.harness = harness
        self._running_tasks: Dict[str, str] = {}
        self._solo_adapter: Optional[EventBusSoloAdapter] = None
        self._review_events: Dict[str, asyncio.Event] = {}
        self._pause_events: Dict[str, asyncio.Event] = {}
        self._task_contexts: Dict[str, TaskContext] = {}

    def set_solo_manager(self, solo_manager):
        """Attach a SoloManager and create the event bridge adapter.

        Args:
            solo_manager: The SoloManager instance to bridge events to.
        """
        self._solo_adapter = EventBusSoloAdapter(self.event_bus, solo_manager)

    async def run(self, context: TaskContext, mode_hint: str = None,
                  _is_substep: bool = False) -> dict:
        """Execute a task through the appropriate mode executor.

        Selects the execution mode (from ``mode_hint``, the context, or
        auto-suggestion), hydrates the context with registries and services,
        and delegates to the mode executor.  Enforces persona-level
        concurrency and records metrics on completion or failure.

        Args:
            context: The TaskContext carrying input data and configuration.
            mode_hint: Optional mode name override.  If ``None`` and the
                context has no mode, one is auto-suggested.
            _is_substep: If ``True``, skips concurrency checks and state
                persistence (used for nested sub-step execution).

        Returns:
            The result dictionary produced by the mode executor.

        Raises:
            ConflictError: If the persona already has a running task and
                ``_is_substep`` is ``False``.
        """
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
        context.event_bus = self.event_bus

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
            logger.info("Task started", task_id=context.task_id, mode=mode, persona=persona)

            # v6.0 Harness pre_execute hook
            if self.harness and context.harness_enabled:
                try:
                    await self.harness.pre_execute(context)
                except Exception as e:
                    logger.warning(f"Harness pre_execute failed: {e}", task_id=context.task_id)

            result = await asyncio.wait_for(
                executor.run(context),
                timeout=TASK_TIMEOUT_SECONDS,
            )

            # v6.0 Harness post_execute hook
            if self.harness and context.harness_enabled:
                try:
                    result = await self.harness.post_execute(result, context)
                except Exception as e:
                    logger.warning(f"Harness post_execute failed: {e}", task_id=context.task_id)

            duration = time.time() - start
            self.event_bus.emit(context.task_id, "task.completed", {"result": str(result)[:500]})
            logger.info("Task completed", task_id=context.task_id, mode=mode, persona=persona, duration=f"{duration:.2f}s")
            if not _is_substep:
                ff_metrics.record_task_completed(mode, persona, duration)
                self.state_manager.update_state(context.task_id, {"status": "completed", "result": str(result)[:500]})
            return result
        except asyncio.TimeoutError:
            logger.error("Task timed out", task_id=context.task_id, mode=mode, timeout=TASK_TIMEOUT_SECONDS)
            self.event_bus.emit(context.task_id, "task.error", {"error": f"Task timed out after {TASK_TIMEOUT_SECONDS}s"})
            if not _is_substep:
                ff_metrics.record_task_failed(mode_hint or "auto", persona)
                self.state_manager.update_state(context.task_id, {"status": "failed", "error": "Task timed out"})
            return {"error": f"Task timed out after {TASK_TIMEOUT_SECONDS}s", "response": "任务执行超时，请稍后重试"}
        except Exception as e:
            self.event_bus.emit(context.task_id, "task.error", {"error": str(e)})
            logger.error("Task failed", task_id=context.task_id, mode=mode, persona=persona, error=str(e))
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
        """Submit a human review verdict for a paused task.

        Emits a ``review.submitted`` event, persists the verdict, and
        signals the waiting review event so the task can resume.

        Args:
            task_id: The identifier of the task under review.
            verdict: The review decision (e.g. ``"pass"``, ``"reject"``).
            feedback: Optional textual feedback from the reviewer.
            edited_draft: Optional edited draft content from the reviewer.
        """
        self.event_bus.emit(task_id, "review.submitted", {"verdict": verdict, "feedback": feedback})
        self.state_manager.update_state(task_id, {"review_verdict": verdict, "review_feedback": feedback})
        review_event = self._review_events.get(task_id)
        if review_event:
            review_event.set()
            del self._review_events[task_id]

    async def pause_task(self, task_id: str):
        """Pause a running task.

        Emits a ``task.paused`` event, updates state, and creates a pause
        event that blocks the task until ``resume_task`` is called.

        Args:
            task_id: The identifier of the task to pause.
        """
        self.event_bus.emit(task_id, "task.paused", {"reason": "manual"})
        self.state_manager.update_state(task_id, {"status": "paused"})
        pause_event = asyncio.Event()
        self._pause_events[task_id] = pause_event

    async def resume_task(self, task_id: str):
        """Resume a previously paused task.

        Emits a ``task.resumed`` event, updates state, and signals the
        pause event so the task can continue execution.

        Args:
            task_id: The identifier of the task to resume.
        """
        self.event_bus.emit(task_id, "task.resumed", {})
        self.state_manager.update_state(task_id, {"status": "running"})
        pause_event = self._pause_events.get(task_id)
        if pause_event:
            pause_event.set()
            del self._pause_events[task_id]

    async def get_task_snapshot(self, task_id: str) -> dict:
        """Retrieve a snapshot of the current task state.

        Args:
            task_id: The identifier of the task to inspect.

        Returns:
            A dictionary containing the persisted task state, or a
            minimal dict with ``status`` set to ``"unknown"`` if no
            state is found.
        """
        state = self.state_manager.load_state(task_id)
        if state:
            return state
        return {"task_id": task_id, "status": "unknown"}

    def register_review_wait(self, task_id: str):
        """Register an asyncio Event that will be waited on for review.

        Creates and stores an ``asyncio.Event`` for the given task.  The
        event is signaled when ``submit_review`` is called, allowing the
        task to resume after a human review.

        Args:
            task_id: The identifier of the task awaiting review.

        Returns:
            The ``asyncio.Event`` instance that will be set on review
            submission.
        """
        review_event = asyncio.Event()
        self._review_events[task_id] = review_event
        return review_event

    def is_persona_running(self, persona: str) -> bool:
        """Check whether a persona currently has a running task.

        Args:
            persona: The persona identifier to check.

        Returns:
            ``True`` if the persona has an active task, ``False`` otherwise.
        """
        return persona in self._running_tasks
