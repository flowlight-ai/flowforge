"""Hybrid executor that orchestrates task execution across multiple modes.

The HybridExecutor is the central runtime engine of FlowForge.  It selects
the appropriate execution mode, manages task lifecycle (start, pause, resume,
review), persists state and checkpoints, and bridges events to the Helm
interaction protocol when applicable.

v6.0: Integrates Harness Layer hooks (pre_execute / post_execute).

License: MIT
"""

import time
import asyncio
from typing import Dict, Optional
from flowforge.core.task_context import TaskContext
from flowforge.core.errors import ConflictError, StepTimeoutError
from flowforge.core.agent_registry import AgentRegistry
from flowforge.core.checkpoint_manager import CheckpointManager
from flowforge.core.workspace import get_workspace_manager
from flowforge.modes.registry import ModeRegistry
from flowforge.events.event_bus import EventBus
from flowforge.events.helm_adapter import EventBusHelmAdapter
from flowforge.executor.state_manager import StateManager
from flowforge.memory.manager import MemoryManager
from flowforge.core import metrics as ff_metrics
from flowforge.core.tracing import get_logger

logger = get_logger("executor")

TASK_TIMEOUT_SECONDS = 1200


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
        loop_executor: Optional LoopExecutor for loop orchestration (upper-level manager of modes).
    """

    def __init__(self, mode_registry: ModeRegistry, agent_registry: AgentRegistry,
                 tool_registry, event_bus: EventBus, task_repo=None, audit_repo=None,
                 memory_manager: MemoryManager = None,
                 checkpointer_path: str = "data/checkpoints.db",
                 state_db_path: str = "data/states.db",
                 harness=None, loop_executor=None):
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
            loop_executor: Optional LoopExecutor for loop orchestration (upper-level manager of modes).
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
        self._loop_executor = loop_executor
        self._running_tasks: Dict[str, str] = {}
        self._helm_adapter: Optional[EventBusHelmAdapter] = None
        self._review_events: Dict[str, asyncio.Event] = {}
        self._pause_events: Dict[str, asyncio.Event] = {}
        self._task_contexts: Dict[str, TaskContext] = {}
        self._task_futures: Dict[str, asyncio.Task] = {}

    def set_helm_manager(self, helm_manager):
        """Attach a HelmManager and create the event bridge adapter.

        Args:
            helm_manager: The HelmManager instance to bridge events to.
        """
        self._helm_adapter = EventBusHelmAdapter(self.event_bus, helm_manager)

    def set_loop_executor(self, loop_executor) -> None:
        """Inject a LoopExecutor for loop orchestration support.

        Loop is NOT a mode — it is the "upper-level manager" of modes
        (design doc loop.md §5.3). When a LoopExecutor is set and
        loop_config is present in the task metadata, HybridExecutor
        delegates to LoopExecutor.run() directly, which in turn calls
        back into HybridExecutor for each iteration's worker execution.

        Args:
            loop_executor: The LoopExecutor instance to use for loop orchestration.
        """
        self._loop_executor = loop_executor
        logger.info("LoopExecutor injected into HybridExecutor")

    @property
    def loop_executor(self):
        """Return the configured LoopExecutor, or None if not set."""
        return self._loop_executor

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
            # Save task state immediately so GET /tasks/{id} doesn't return 404
            self._task_contexts[context.task_id] = context
            self.state_manager.save_state(context.task_id, {
                "task_id": context.task_id, "persona": persona,
                "mode": mode_hint or context.mode or "auto", "status": "pending",
                "input_data": context.input_data,
                "interaction_mode": context.interaction_mode,
            })

            if persona in self._running_tasks:
                # Update state to reflect the conflict
                self.state_manager.update_state(context.task_id, {"status": "failed", "error": f"Persona '{persona}' already running task {self._running_tasks[persona]}"})
                raise ConflictError(
                    f"Persona '{persona}' already running task {self._running_tasks[persona]}")
            self._running_tasks[persona] = context.task_id
            ff_metrics.record_task_created(mode_hint or "auto", persona)

            ws = get_workspace_manager()
            if not ws.get_workspace_path(context.task_id):
                workspace_dir = context.input_data.get("workspace_dir")
                ws.create_workspace(
                    context.task_id,
                    metadata={"persona": persona, "intent": context.input_data.get("task", context.input_data.get("intent", ""))},
                    workspace_dir=workspace_dir,
                )

        if mode_hint is None and context.mode is None:
            mode = self.mode_registry.suggest_mode(context.input_data.get("task", ""))
            logger.info(f"[hybrid_executor] Mode auto-suggested: mode={mode}, task_id={context.task_id}")
        else:
            mode = mode_hint or context.mode
            logger.info(f"[hybrid_executor] Mode selected: mode={mode} (hint={mode_hint}, ctx_mode={context.mode}), task_id={context.task_id}")

        # Loop orchestration: Loop is the "upper-level manager" of modes,
        # not a mode itself (design doc loop.md §5.3).
        # When loop_config is present, delegate directly to LoopExecutor,
        # which will call back into HybridExecutor for each iteration.
        if self._loop_executor is not None and context.metadata.get("loop_config"):
            loop_config = context.metadata["loop_config"]
            logger.info(
                f"[hybrid_executor] Loop orchestration activated: "
                f"loop_name={loop_config.get('name')}, "
                f"task_id={context.task_id}, delegating to LoopExecutor"
            )

            # Hydrate context with registries and services for LoopExecutor
            context.tools = self.tool_registry
            context.agents = self.agent_registry
            context.executor = self
            context.mode = "loop"
            context.checkpoint = self.checkpoint_manager
            context.event_bus = self.event_bus
            if self.memory_manager and not context.memory:
                context.memory = self.memory_manager

            if not _is_substep:
                # Update state from pending to running (state was already saved above)
                self.state_manager.update_state(context.task_id, {
                    "mode": "loop", "status": "running",
                })

            start = time.time()
            try:
                self.event_bus.emit(context.task_id, "task.start", {"mode": "loop"})
                logger.info(f"[hybrid_executor] Loop execution started: task_id={context.task_id}, persona={persona}")

                loop_result = await asyncio.wait_for(
                    self._loop_executor.run(context, loop_config),
                    timeout=TASK_TIMEOUT_SECONDS,
                )

                # Convert LoopResult to dict
                result = {
                    "success": loop_result.success,
                    "total_attempts": loop_result.total_attempts,
                }
                if loop_result.output is not None:
                    result["output"] = loop_result.output
                    if isinstance(loop_result.output, dict):
                        for key in ("response", "final_answer", "content"):
                            if key in loop_result.output and key not in result:
                                result[key] = loop_result.output[key]
                if loop_result.error is not None:
                    result["error"] = loop_result.error
                if loop_result.state is not None:
                    result["loop_state"] = loop_result.state.model_dump()
                    # 传递 Loop 评审信息（质量分和迭代次数）
                    result["loop_attempts"] = loop_result.total_attempts
                    result["loop_failed"] = not loop_result.success
                    # 从 verification_history 中提取最后一轮的质量分
                    vh = loop_result.state.verification_history
                    if vh:
                        last_verdict = vh[-1]
                        if isinstance(last_verdict, dict):
                            result["loop_last_score"] = last_verdict.get("score", 0.0)

                # P1-3: Loop 失败时退化为单次 HybridExecutor 执行
                # 设计文档 loop.md §865: "Loop 失败时退化为单次 HybridExecutor 执行"
                if not loop_result.success:
                    logger.warning(
                        f"[hybrid_executor] Loop failed, degrading to single mode execution: "
                        f"task_id={context.task_id}, loop_error={loop_result.error}, "
                        f"attempts={loop_result.total_attempts}"
                    )
                    self.event_bus.emit(context.task_id, "loop.degraded", {
                        "loop_id": loop_result.state.loop_id if loop_result.state else "unknown",
                        "reason": loop_result.error,
                        "attempts": loop_result.total_attempts,
                    })
                    try:
                        # 退化执行：清除 loop_config 避免再次进入 Loop 分支
                        # 使用 loop_config 中 worker.mode 作为退化执行的 mode_hint
                        fallback_mode = loop_config.get("worker", {}).get("mode", "workflow")
                        degraded_context = context
                        degraded_context.metadata = {k: v for k, v in context.metadata.items() if k != "loop_config"}
                        degraded_result = await self.run(degraded_context, mode_hint=fallback_mode, _is_substep=True)
                        # 合并退化执行结果与 Loop 失败信息
                        if isinstance(degraded_result, dict):
                            degraded_result["loop_degraded"] = True
                            degraded_result["loop_error"] = loop_result.error
                            degraded_result["loop_attempts"] = loop_result.total_attempts
                        result = degraded_result
                    except Exception as fallback_err:
                        logger.error(
                            f"[hybrid_executor] Degraded execution also failed: "
                            f"task_id={context.task_id}, error={fallback_err}"
                        )
                        result["loop_degraded"] = True
                        result["degraded_error"] = str(fallback_err)

                duration = time.time() - start
                if isinstance(result, dict):
                    summary_text = result.get("response") or result.get("final_answer") or result.get("content") or ""
                    summary = str(summary_text)[:500]
                else:
                    summary = str(result)[:200]
                self.event_bus.emit(context.task_id, "task.completed", {"status": "completed", "summary": summary})
                logger.info(f"[hybrid_executor] Loop execution completed: task_id={context.task_id}, persona={persona}, duration={duration:.2f}s")
                if not _is_substep:
                    ff_metrics.record_task_completed("loop", persona, duration)
                    ws = get_workspace_manager()
                    ws.update_task_status(context.task_id, "completed", duration=duration)
                    state_update = {"status": "completed", "summary": summary}
                    if isinstance(result, dict):
                        state_update["output_data"] = result
                    else:
                        state_update["output_data"] = {"response": str(result)}
                    self.state_manager.update_state(context.task_id, state_update)
                return result
            except asyncio.TimeoutError:
                logger.error(f"[hybrid_executor] Loop task timed out: task_id={context.task_id}, timeout={TASK_TIMEOUT_SECONDS}s")
                self.event_bus.emit(context.task_id, "task.error", {"error": f"Task timed out after {TASK_TIMEOUT_SECONDS}s"})
                if not _is_substep:
                    ff_metrics.record_task_failed("loop", persona)
                    self.state_manager.update_state(context.task_id, {"status": "failed", "error": f"Task timed out after {TASK_TIMEOUT_SECONDS}s"})
                return {"error": f"Task timed out after {TASK_TIMEOUT_SECONDS}s", "response": "任务执行超时，请稍后重试"}
            except Exception as e:
                self.event_bus.emit(context.task_id, "task.error", {"error": str(e)})
                logger.error(f"[hybrid_executor] Loop task failed: task_id={context.task_id}, persona={persona}, error={e}")
                if not _is_substep:
                    ff_metrics.record_task_failed("loop", persona)
                    self.state_manager.update_state(context.task_id, {"status": "failed", "error": str(e)})
                raise
            finally:
                if not _is_substep and persona in self._running_tasks:
                    del self._running_tasks[persona]
                if not _is_substep and context.task_id in self._task_contexts:
                    del self._task_contexts[context.task_id]

        # Backward compatibility: mode_hint="loop" without loop_config
        # falls through to LoopModeExecutor as a convenience adapter
        if mode == "loop" and self._loop_executor is not None:
            context.metadata["loop_executor"] = self._loop_executor

        if context.interaction_mode == "helm" and self._helm_adapter:
            self._helm_adapter.bridge()

        executor = self.mode_registry.get(mode)
        logger.info(f"[hybrid_executor] Mode executor resolved: mode={mode}, executor={type(executor).__name__}, task_id={context.task_id}")
        context.tools = self.tool_registry
        context.agents = self.agent_registry
        context.executor = self
        context.mode = mode
        context.checkpoint = self.checkpoint_manager
        context.event_bus = self.event_bus
        if self.memory_manager and not context.memory:
            context.memory = self.memory_manager

        if not _is_substep:
            # Update state from pending to running
            self.state_manager.update_state(context.task_id, {
                "mode": mode, "status": "running",
            })

        start = time.time()
        try:
            self.event_bus.emit(context.task_id, "task.start", {"mode": mode})
            self.event_bus.emit(context.task_id, "mode.enter", {"mode": mode})
            logger.info(f"[hybrid_executor] Mode execution started: mode={mode}, task_id={context.task_id}, persona={persona}")

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
            if isinstance(result, dict):
                summary_text = result.get("response") or result.get("final_answer") or result.get("content") or ""
                summary = str(summary_text)[:500]
            else:
                summary = str(result)[:200]
            self.event_bus.emit(context.task_id, "mode.exit", {"mode": mode})
            self.event_bus.emit(context.task_id, "task.completed", {"status": "completed", "summary": summary})
            logger.info(f"[hybrid_executor] Mode execution completed: mode={mode}, task_id={context.task_id}, persona={persona}, duration={duration:.2f}s")
            if not _is_substep:
                ff_metrics.record_task_completed(mode, persona, duration)
                ws = get_workspace_manager()
                ws.update_task_status(context.task_id, "completed", duration=duration)
                state_update = {"status": "completed", "summary": summary}
                if isinstance(result, dict):
                    state_update["output_data"] = result
                else:
                    state_update["output_data"] = {"response": str(result)}
                self.state_manager.update_state(context.task_id, state_update)
            return result
        except asyncio.TimeoutError:
            logger.error(f"[hybrid_executor] Task timed out: mode={mode}, task_id={context.task_id}, timeout={TASK_TIMEOUT_SECONDS}s")
            self.event_bus.emit(context.task_id, "mode.exit", {"mode": mode})
            self.event_bus.emit(context.task_id, "task.error", {"error": f"Task timed out after {TASK_TIMEOUT_SECONDS}s"})
            if not _is_substep:
                ff_metrics.record_task_failed(mode_hint or "auto", persona)
                self.state_manager.update_state(context.task_id, {"status": "failed", "error": f"Task timed out after {TASK_TIMEOUT_SECONDS}s"})
            return {"error": f"Task timed out after {TASK_TIMEOUT_SECONDS}s", "response": "任务执行超时，请稍后重试"}
        except StepTimeoutError as e:
            logger.error(f"[hybrid_executor] Step timed out: mode={mode}, task_id={context.task_id}, error={e}")
            self.event_bus.emit(context.task_id, "mode.exit", {"mode": mode})
            self.event_bus.emit(context.task_id, "task.error", {"error": str(e)})
            if not _is_substep:
                ff_metrics.record_task_failed(mode_hint or "auto", persona)
                self.state_manager.update_state(context.task_id, {"status": "failed", "error": str(e)})
            return {"error": str(e), "response": f"步骤执行超时: {e}"}
        except Exception as e:
            self.event_bus.emit(context.task_id, "mode.exit", {"mode": mode})
            self.event_bus.emit(context.task_id, "task.error", {"error": str(e)})
            logger.error(f"[hybrid_executor] Task failed: mode={mode}, task_id={context.task_id}, persona={persona}, error={e}")
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
        self.event_bus.emit(task_id, "review.submitted", {"verdict": verdict, "feedback": feedback, "edited_draft": edited_draft})
        self.state_manager.update_state(task_id, {
            "review_verdict": verdict,
            "review_feedback": feedback,
            "edited_draft": edited_draft,
        })
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

    async def cancel_task(self, task_id: str):
        """Cancel a running task by terminating its asyncio Task.

        Updates state, emits event, and cancels the running asyncio.Task
        if one exists for this task_id. Also releases the persona lock
        if the cancelled task holds one.

        Args:
            task_id: The identifier of the task to cancel.
        """
        self.event_bus.emit(task_id, "task.cancelled", {"reason": "manual"})
        self.state_manager.update_state(task_id, {"status": "cancelled"})

        # Release persona lock if this task holds one
        for persona, running_task_id in list(self._running_tasks.items()):
            if running_task_id == task_id:
                del self._running_tasks[persona]
                logger.info(f"Released persona lock for '{persona}' (cancelled task {task_id})")
                break

        # Cancel the running asyncio.Task if it exists
        future = self._task_futures.get(task_id)
        if future and not future.done():
            future.cancel()
            logger.info(f"Cancelled running asyncio.Task for task {task_id}")
            del self._task_futures[task_id]

    def register_task_future(self, task_id: str, future: asyncio.Task):
        """Register an asyncio.Task for a running task so it can be cancelled."""
        self._task_futures[task_id] = future

    def is_persona_running(self, persona: str) -> bool:
        """Check whether a persona currently has a running task.

        Args:
            persona: The persona identifier to check.

        Returns:
            ``True`` if the persona has an active task, ``False`` otherwise.
        """
        return persona in self._running_tasks
