"""Loop Executor — 包装 HybridExecutor，添加规划-校验-复盘闭环。

LoopExecutor 是 Harness 驾驭层的子模块，每次迭代：
1. 触发 Harness pre_execute（注入上下文）
2. 调用 HybridExecutor 执行（复用现有引擎）
3. 触发 Harness post_execute（架构约束校验）
4. 执行 Loop Verifier（业务质量校验）
5. 仅在失败时触发 Loop Reflector（复盘+规则进化）
6. 保存检查点
7. 发出事件
8. 写入迭代记录（通过注入的回调，遵守铁律4）
"""

import asyncio
import json
import time
from datetime import datetime
from typing import Optional, Callable, Any

from flowforge.core.task_context import TaskContext
from flowforge.core.persona_lock import PersonaLock
from flowforge.executor.hybrid_executor import HybridExecutor
from flowforge.harness.orchestrator import HarnessOrchestrator
from flowforge.harness.entropy_manager import EntropyManager, DebtSeverity, RuleEvolution
from flowforge.core.checkpoint_manager import CheckpointManager
from flowforge.loop.state import LoopState, LoopResult, LoopPhase, LoopNestingError
from flowforge.loop.planner import LoopPlanner
from flowforge.loop.verifier import LoopVerifier
from flowforge.loop.reflector import LoopReflector
from flowforge.loop.registry import LoopRegistry
from flowforge.loop.turn_transition import TurnTransitionEngine, TurnState
from flowforge.core.tracing import get_logger

logger = get_logger("loop.executor")

# 迭代记录回调类型：接收 loop_id, attempt, 阶段数据，由 Repository 层实现
IterationCallback = Callable[..., Any]


class LoopExecutor:
    """Loop 执行器 — 包装 HybridExecutor，添加规划-校验-复盘闭环。

    LoopExecutor 是 Harness 驾驭层的子模块，每次迭代：
    1. 触发 Harness pre_execute（注入上下文）
    2. 调用 HybridExecutor 执行（复用现有引擎）
    3. 触发 Harness post_execute（架构约束校验）
    4. 执行 Loop Verifier（业务质量校验）
    5. 仅在失败时触发 Loop Reflector（复盘+规则进化）
    6. 保存检查点
    """

    def __init__(
        self,
        hybrid_executor: HybridExecutor,
        harness: HarnessOrchestrator,
        planner: LoopPlanner,
        verifier: LoopVerifier,
        reflector: LoopReflector,
        checkpoint_mgr: CheckpointManager,
        entropy_mgr: EntropyManager,
        rule_evolution: RuleEvolution,
        persona_lock: Optional[PersonaLock] = None,
        memory_manager: Optional[Any] = None,
        on_iteration_create: Optional[IterationCallback] = None,
        on_iteration_update: Optional[IterationCallback] = None,
        on_iteration_complete: Optional[IterationCallback] = None,
        on_loop_state_update: Optional[IterationCallback] = None,
    ):
        self.hybrid_executor = hybrid_executor
        self.harness = harness
        self.planner = planner
        self.verifier = verifier
        self.reflector = reflector
        self.checkpoint_mgr = checkpoint_mgr
        self.entropy_mgr = entropy_mgr
        self.rule_evolution = rule_evolution
        self.persona_lock = persona_lock
        self.memory_manager = memory_manager
        # 迭代记录回调 — 由 API 层注入 Repository 实现，遵守铁律4
        self.on_iteration_create = on_iteration_create
        self.on_iteration_update = on_iteration_update
        self.on_iteration_complete = on_iteration_complete
        self.on_loop_state_update = on_loop_state_update
        # FWK-06: 统一状态机
        self.turn_engine = TurnTransitionEngine()

    async def run(self, task: TaskContext, loop_config: dict) -> LoopResult:
        """执行 Loop：规划→执行→校验→复盘→重试。"""
        # 嵌套深度检查 — 通过 task.metadata 传递，避免类变量竞争
        current_depth = task.metadata.get("loop_nesting_depth", 0)
        max_depth = loop_config.get("max_nesting_depth", 3)
        if current_depth >= max_depth:
            return LoopResult(
                success=False,
                error=f"Loop nesting depth ({current_depth}) exceeds max_nesting_depth ({max_depth})",
                total_attempts=0,
                state=None,
            )

        task.metadata["loop_nesting_depth"] = current_depth + 1
        try:
            return await self._run_loop(task, loop_config)
        finally:
            task.metadata["loop_nesting_depth"] = current_depth

    async def _run_loop(self, task: TaskContext, loop_config: dict) -> LoopResult:
        """内部 Loop 执行逻辑。"""
        max_retries = loop_config.get("max_retries", 3)
        worker_config = loop_config.get("worker", {})
        worker_mode = worker_config.get("mode", "workflow")
        backoff_strategy = loop_config.get("backoff_strategy", "exponential")
        backoff_base = loop_config.get("backoff_base", 2)
        total_timeout = loop_config.get("total_timeout", 1800)

        state = LoopState(
            loop_id=loop_config["name"],
            task_id=task.task_id,
            template_name=loop_config["name"],
            max_retries=max_retries,
        )

        # 确定 Persona Lock 是否需要持有
        persona_id = getattr(task, 'persona', None)
        need_lock = self.persona_lock is not None and persona_id is not None

        async def _do_execute() -> LoopResult:
            if need_lock:
                # 整个 Loop 期间持有 Persona 锁，不在迭代之间释放
                async with self.persona_lock.acquire(persona_id, holder=state.loop_id):
                    return await self._execute_iterations(
                        task, loop_config, state, max_retries,
                        worker_config, worker_mode, backoff_strategy, backoff_base,
                    )
            else:
                # 无 PersonaLock 或无 persona_id，跳过锁逻辑（向后兼容）
                return await self._execute_iterations(
                    task, loop_config, state, max_retries,
                    worker_config, worker_mode, backoff_strategy, backoff_base,
                )

        # 使用 asyncio.wait_for 包裹整个 Loop，实现总超时控制
        try:
            return await asyncio.wait_for(_do_execute(), timeout=total_timeout)
        except asyncio.TimeoutError:
            state.phase = LoopPhase.FAILED
            self.turn_engine.try_transition(TurnState.FAILED, reason="total timeout exceeded")
            state.past_errors.append(
                f"Loop total timeout ({total_timeout}s) exceeded"
            )
            logger.warning(
                f"[loop] Total timeout exceeded: loop_id={state.loop_id}, "
                f"total_timeout={total_timeout}s"
            )
            self.checkpoint_mgr.save(
                task_id=state.task_id,
                step_name=f"loop:{state.loop_id}:total_timeout",
                state=state.model_dump(),
            )
            if task.event_bus:
                task.event_bus.emit(task.task_id, "loop.failed", {
                    "loop_id": state.loop_id,
                    "total_attempts": state.attempt,
                    "last_errors": state.past_errors[-3:] if state.past_errors else [],
                    "reason": "total_timeout",
                })
            return LoopResult(
                success=False,
                error=f"Loop total timeout ({total_timeout}s) exceeded",
                total_attempts=state.attempt,
                state=state,
            )

    async def _execute_iterations(
        self,
        task: TaskContext,
        loop_config: dict,
        state: LoopState,
        max_retries: int,
        worker_config: dict,
        worker_mode: str,
        backoff_strategy: str,
        backoff_base: int,
    ) -> LoopResult:
        """执行 Loop 迭代逻辑（从 _run_loop 中提取，支持 PersonaLock 包裹）。"""

        # 读取超时配置
        total_timeout = loop_config.get("total_timeout", 1800)
        timeout_per_iteration = loop_config.get("timeout_per_iteration", 300)

        # 读取 Memory 映射配置
        memory_config = loop_config.get("memory", {})
        store_failures = memory_config.get("store_failures", False)

        # 将 worker_config 中的 steps 注入到 task.metadata，使 WorkflowExecutor 能获取 SOP 步骤
        worker_steps = worker_config.get("steps", [])
        if worker_steps and worker_mode == "workflow":
            task.metadata["sop_steps"] = worker_steps
            # 同时注入 workflow 名称，供 WorkflowExecutor 识别
            task.metadata["workflow_name"] = worker_config.get("workflow", "")
            logger.info(f"[loop] Injected worker steps into task.metadata: {len(worker_steps)} steps, "
                        f"workflow={worker_config.get('workflow', '')}")
        failure_key = memory_config.get("failure_key", "loop-failures")
        # memory_mapping 使用设计文档中的英文键名：
        #   context → WorkingMemory, session → ShortTermMemory,
        #   failures → LongTermMemory, rules → SemanticMemory,
        #   trajectory → EpisodicMemory
        memory_mapping = memory_config.get("memory_mapping", {})

        # 1. 规划
        state.phase = LoopPhase.PLANNING
        self.turn_engine.try_transition(TurnState.EXECUTING, reason="loop planning started")
        plan = await self.planner.plan(task, loop_config.get("planner", {}))
        state.current_plan = plan

        # Memory 映射：Loop 启动时从 LongTermMemory 读取历史失败教训，注入规划上下文
        if self.memory_manager is not None:
            past_failures = await self._read_memory(
                memory_mapping.get("failures", "long_term"),
                failure_key,
            )
            if past_failures:
                task.metadata["loop_past_failures"] = past_failures

        # Loop 启动事件
        if task.event_bus:
            task.event_bus.emit(task.task_id, "loop.started", {
                "loop_id": state.loop_id,
                "task_id": state.task_id,
                "template_name": state.template_name,
                "max_retries": max_retries,
            })

        total_start = time.monotonic()
        last_good_result: dict | None = None  # 保存最后一次成功的执行结果

        for attempt in range(max_retries):
            # 检查总超时
            elapsed = time.monotonic() - total_start
            remaining = total_timeout - elapsed
            if remaining <= 0:
                logger.warning(
                    f"[loop] Total timeout exceeded: loop_id={state.loop_id}, "
                    f"elapsed={elapsed:.1f}s, total_timeout={total_timeout}s"
                )
                state.past_errors.append(
                    f"Total timeout exceeded after {elapsed:.1f}s (limit: {total_timeout}s)"
                )
                break

            state.attempt = attempt + 1
            state.updated_at = datetime.utcnow()

            # 写入迭代记录（开始）— 通过回调遵守铁律4
            iter_id: str | None = None
            if self.on_iteration_create:
                try:
                    iter_id = self.on_iteration_create(
                        loop_id=state.loop_id,
                        attempt=state.attempt,
                        plan_json=json.dumps(state.current_plan, ensure_ascii=False) if state.current_plan else None,
                    )
                except Exception as e:
                    logger.warning(f"[loop] Failed to create iteration record: {e}")

            # 更新 Loop 数据库状态为 executing
            if self.on_loop_state_update:
                try:
                    self.on_loop_state_update(
                        loop_id=state.loop_id,
                        state_json=json.dumps(state.model_dump(), ensure_ascii=False),
                        phase="executing",
                        attempt=state.attempt,
                    )
                except Exception as e:
                    logger.warning(f"[loop] Failed to update loop state: {e}")

            # 迭代开始事件
            if task.event_bus:
                task.event_bus.emit(task.task_id, "loop.iteration.start", {
                    "loop_id": state.loop_id,
                    "attempt": state.attempt,
                    "phase": "executing",
                })

            # Memory 映射：每次迭代将当前上下文写入 WorkingMemory
            await self._write_memory(
                memory_mapping.get("context", "working"),
                f"loop:{state.loop_id}:attempt:{state.attempt}",
                {
                    "loop_id": state.loop_id,
                    "attempt": state.attempt,
                    "task_id": state.task_id,
                    "plan": state.current_plan,
                },
            )

            # Memory 映射：每次迭代将对话历史写入 ShortTermMemory
            await self._write_memory(
                memory_mapping.get("session", "short_term"),
                f"loop:{state.loop_id}:session",
                {
                    "loop_id": state.loop_id,
                    "task_id": state.task_id,
                    "attempt": state.attempt,
                    "reflections": state.reflection_history[-1] if state.reflection_history else None,
                    "past_errors_count": len(state.past_errors),
                },
            )

            # 2. Harness pre_execute（注入上下文 + 权限检查）
            #    首次迭代：完整上下文注入；后续迭代：仅注入 delta（Reflector 的反思结果）
            if attempt > 0 and state.reflection_history:
                last_reflection = state.reflection_history[-1]
                task.metadata["loop_reflections"] = last_reflection.get("suggestions", [])
                # 同时传递上一轮 Verifier 的详细评审信息（低分维度、加权贡献分析等）
                # 从 verification_history 中获取上一轮的 verdict
                if state.verification_history:
                    last_verdict = state.verification_history[-1]
                    task.metadata["loop_verifier_errors"] = last_verdict.get("errors", [])
                    logger.info(f"[loop] 迭代{attempt + 1}: 注入loop_verifier_errors={len(last_verdict.get('errors', []))}条, "
                                 f"loop_reflections={len(last_reflection.get('suggestions', []))}条")
            await self.harness.pre_execute(task)

            # 3. 执行（委托给 HybridExecutor / 嵌套 Loop / 并行 Worker）
            #    使用 asyncio.wait_for 包裹，实现单次迭代超时控制
            state.phase = LoopPhase.EXECUTING
            self.turn_engine.try_transition(TurnState.EXECUTING, reason=f"iteration {attempt + 1} executing")
            iter_timeout = min(timeout_per_iteration, remaining)

            try:
                if worker_mode == "loop":
                    result = await asyncio.wait_for(
                        self._execute_nested_loop(task, worker_config, state),
                        timeout=iter_timeout,
                    )
                elif worker_mode == "parallel":
                    result = await asyncio.wait_for(
                        self._execute_parallel_workers(task, worker_config, state),
                        timeout=iter_timeout,
                    )
                else:
                    result = await asyncio.wait_for(
                        self.hybrid_executor.run(task, mode_hint=worker_mode),
                        timeout=iter_timeout,
                    )
            except asyncio.TimeoutError:
                iter_error = (
                    f"Iteration {attempt + 1} timed out after {iter_timeout:.1f}s "
                    f"(per_iteration={timeout_per_iteration}s, remaining={remaining:.1f}s)"
                )
                logger.warning(f"[loop] {iter_error}: loop_id={state.loop_id}")
                state.past_errors.append(iter_error)
                result = {"error": iter_error}

            # 4. Harness post_execute（架构约束校验 + FeedbackLoop 评分）
            result = await self.harness.post_execute(result, task)

            # 注入 _model 字段（用于 exclude_creator 功能）
            # 从 task.metadata 中获取执行过程中使用的模型
            if isinstance(result, dict) and "_model" not in result:
                used_model = task.metadata.get("last_used_model", "")
                if used_model:
                    result["_model"] = used_model

            # 保存最后一次成功的执行结果（超时/失败时仍可返回内容）
            if isinstance(result, dict) and not result.get("error"):
                last_good_result = result

            # === 详细日志：定位执行结果内容 ===
            logger.info(f"[loop][DEBUG] 迭代{attempt + 1}执行结果: type={type(result).__name__}")
            if isinstance(result, dict):
                logger.info(f"[loop][DEBUG]   result keys={list(result.keys())}")
                for k in ['draft', 'edited_draft', 'content', 'result', 'output', 'seo_title']:
                    if k in result:
                        v = result[k]
                        v_preview = str(v)[:200] if v else "None"
                        logger.info(f"[loop][DEBUG]   result[{k}] type={type(v).__name__}, len={len(str(v)) if v else 0}, preview={v_preview}")
            elif hasattr(result, '__dict__'):
                logger.info(f"[loop][DEBUG]   result attrs={list(vars(result).keys())}")
            # === 详细日志结束 ===

            # 5. Loop Verifier（业务级质量校验）
            # 根据 loop_config.verifier.mode 动态选择 verifier
            verifier_config = loop_config.get("verifier", {})
            verifier_mode = verifier_config.get("mode", "")
            active_verifier = self.verifier
            if verifier_mode:
                from flowforge.loop.verifier import create_verifier
                try:
                    active_verifier = create_verifier(verifier_mode)
                    logger.info(f"[loop] Using verifier mode: {verifier_mode} ({type(active_verifier).__name__})")
                except Exception as e:
                    logger.warning(f"[loop] Failed to create verifier mode '{verifier_mode}': {e}, using default")
            state.phase = LoopPhase.VERIFYING
            self.turn_engine.try_transition(TurnState.EVALUATING, reason=f"iteration {attempt + 1} verifying")
            verdict = await active_verifier.verify(result, task, verifier_config)
            state.verification_history.append(verdict.model_dump())

            # 详细日志：评审结果
            logger.info(f"[loop] 迭代{attempt + 1}评审结果: passed={verdict.passed}, "
                         f"score={verdict.score:.3f}, threshold={verifier_config.get('pass_threshold', 0.9)}, "
                         f"errors_count={len(verdict.errors)}, "
                         f"errors_top3={verdict.errors[:3] if verdict.errors else '[]'}")

            # 更新迭代记录（result + verdict）
            if iter_id and self.on_iteration_update:
                try:
                    self.on_iteration_update(
                        iteration_id=iter_id,
                        result_json=json.dumps(result, ensure_ascii=False, default=str) if result else None,
                        verdict_json=json.dumps(verdict.model_dump(), ensure_ascii=False),
                    )
                except Exception as e:
                    logger.warning(f"[loop] Failed to update iteration record with verdict: {e}")

            # 校验结果事件
            if task.event_bus:
                event_type = "loop.verify.passed" if verdict.passed else "loop.verify.failed"
                payload = {
                    "loop_id": state.loop_id,
                    "attempt": state.attempt,
                    "score": verdict.score,
                }
                if not verdict.passed:
                    payload["errors"] = verdict.errors
                task.event_bus.emit(task.task_id, event_type, payload)

            if verdict.passed:
                # 成功：存储经验 + 返回
                state.phase = LoopPhase.COMPLETED
                self.turn_engine.try_transition(TurnState.COMPLETED, reason=f"iteration {attempt + 1} passed")
                self.checkpoint_mgr.save(
                    task_id=state.task_id,
                    step_name=f"loop:{state.loop_id}:attempt_{state.attempt}",
                    state=state.model_dump(),
                )

                # 完成迭代记录
                if iter_id and self.on_iteration_complete:
                    try:
                        self.on_iteration_complete(iteration_id=iter_id)
                    except Exception as e:
                        logger.warning(f"[loop] Failed to complete iteration record: {e}")

                # 更新 Loop 数据库状态为 completed
                if self.on_loop_state_update:
                    try:
                        self.on_loop_state_update(
                            loop_id=state.loop_id,
                            state_json=json.dumps(state.model_dump(), ensure_ascii=False),
                            phase="completed",
                            attempt=state.attempt,
                        )
                    except Exception as e:
                        logger.warning(f"[loop] Failed to update loop state to completed: {e}")

                # Memory 映射：成功时将执行轨迹写入 EpisodicMemory
                await self._write_memory(
                    memory_mapping.get("trajectory", "episodic"),
                    f"loop:{state.loop_id}:trajectory",
                    {
                        "loop_id": state.loop_id,
                        "task_id": state.task_id,
                        "total_attempts": attempt + 1,
                        "final_score": verdict.score,
                        "trace": state.verification_history,
                    },
                )

                if task.event_bus:
                    task.event_bus.emit(task.task_id, "loop.completed", {
                        "loop_id": state.loop_id,
                        "total_attempts": attempt + 1,
                        "final_score": verdict.score,
                    })
                return LoopResult(success=True, output=result, total_attempts=attempt + 1, state=state)

            # 6. 失败：复盘
            state.phase = LoopPhase.REFLECTING
            self.turn_engine.try_transition(TurnState.REFLECTING, reason=f"iteration {attempt + 1} failed, reflecting")
            reflection = await self.reflector.reflect(verdict.errors, task, state)
            state.reflection_history.append(reflection.model_dump())
            state.past_errors.extend(verdict.errors)

            # 更新迭代记录（reflection）
            if iter_id and self.on_iteration_update:
                try:
                    self.on_iteration_update(
                        iteration_id=iter_id,
                        reflection_json=json.dumps(reflection.model_dump(), ensure_ascii=False),
                    )
                except Exception as e:
                    logger.warning(f"[loop] Failed to update iteration record with reflection: {e}")

            # 完成迭代记录（失败迭代也标记完成）
            if iter_id and self.on_iteration_complete:
                try:
                    self.on_iteration_complete(iteration_id=iter_id)
                except Exception as e:
                    logger.warning(f"[loop] Failed to complete iteration record: {e}")

            # 更新 Loop 数据库状态为 reflecting
            if self.on_loop_state_update:
                try:
                    self.on_loop_state_update(
                        loop_id=state.loop_id,
                        state_json=json.dumps(state.model_dump(), ensure_ascii=False),
                        phase="reflecting",
                        attempt=state.attempt,
                    )
                except Exception as e:
                    logger.warning(f"[loop] Failed to update loop state to reflecting: {e}")

            # Memory 映射：失败时将失败教训写入 LongTermMemory（受 store_failures 控制）
            if store_failures:
                await self._write_memory(
                    memory_mapping.get("failures", "long_term"),
                    failure_key,
                    {
                        "loop_id": state.loop_id,
                        "task_id": state.task_id,
                        "attempt": state.attempt,
                        "errors": verdict.errors,
                        "root_cause": reflection.root_cause,
                        "suggestions": reflection.suggestions,
                    },
                )

            # 复盘完成事件
            if task.event_bus:
                task.event_bus.emit(task.task_id, "loop.reflect.complete", {
                    "loop_id": state.loop_id,
                    "attempt": state.attempt,
                    "suggestions": reflection.suggestions,
                })

            # 7. Harness 将失败转化为规则
            if self.entropy_mgr.debt_tracker:
                self.entropy_mgr.debt_tracker.record(
                    description=f"Loop attempt {attempt + 1} failed: {verdict.errors}",
                    severity=DebtSeverity.MEDIUM,
                    source=f"loop:{state.loop_id}",
                    metadata={"task_id": task.task_id, "attempt": attempt + 1, "errors": verdict.errors},
                )
            self.rule_evolution.propose(
                name=f"Loop failure: {state.loop_id} attempt {attempt + 1}",
                description=f"Loop iteration failed with errors: {verdict.errors}. Reflection: {reflection}",
                metadata={"loop_id": state.loop_id, "attempt": attempt + 1, "errors": verdict.errors},
            )

            # Memory 映射：规则进化时将进化规则写入 SemanticMemory
            await self._write_memory(
                memory_mapping.get("rules", "semantic"),
                f"loop:{state.loop_id}:rule:attempt:{attempt + 1}",
                {
                    "loop_id": state.loop_id,
                    "task_id": state.task_id,
                    "attempt": state.attempt,
                    "rule_name": f"Loop failure: {state.loop_id} attempt {attempt + 1}",
                    "rule_description": f"Loop iteration failed with errors: {verdict.errors}. Reflection: {reflection}",
                },
            )

            # 8. 保存检查点
            self.checkpoint_mgr.save(
                task_id=state.task_id,
                step_name=f"loop:{state.loop_id}:attempt_{state.attempt}",
                state=state.model_dump(),
            )

            # 9. 更新计划（注入教训）
            plan = await self.planner.replan(plan, reflection, state.past_errors)
            state.current_plan = plan

            # 10. 退避等待（失败迭代后）
            if attempt < max_retries - 1:
                wait_secs = self._calc_backoff(backoff_strategy, backoff_base, attempt)
                await asyncio.sleep(wait_secs)

        # 耗尽重试次数或总超时
        state.phase = LoopPhase.FAILED
        self.turn_engine.try_transition(TurnState.FAILED, reason="max retries exceeded or total timeout")
        self.checkpoint_mgr.save(
            task_id=state.task_id,
            step_name=f"loop:{state.loop_id}:attempt_{state.attempt}",
            state=state.model_dump(),
        )

        # 更新 Loop 数据库状态为 failed
        if self.on_loop_state_update:
            try:
                self.on_loop_state_update(
                    loop_id=state.loop_id,
                    state_json=json.dumps(state.model_dump(), ensure_ascii=False),
                    phase="failed",
                    attempt=state.attempt,
                )
            except Exception as e:
                logger.warning(f"[loop] Failed to update loop state to failed: {e}")

        # Memory 映射：最终失败时将执行轨迹写入 EpisodicMemory
        await self._write_memory(
            memory_mapping.get("trajectory", "episodic"),
            f"loop:{state.loop_id}:trajectory",
            {
                "loop_id": state.loop_id,
                "task_id": state.task_id,
                "total_attempts": state.attempt,
                "outcome": "failed",
                "errors": state.past_errors[-5:] if state.past_errors else [],
                "trace": state.verification_history,
            },
        )

        if task.event_bus:
            task.event_bus.emit(task.task_id, "loop.failed", {
                "loop_id": state.loop_id,
                "total_attempts": state.attempt,
                "last_errors": state.past_errors[-3:] if state.past_errors else [],
            })
        # 失败时仍返回最后一次成功的执行结果，确保调用方可以获取内容
        fallback_output = last_good_result if last_good_result else (result if isinstance(result, dict) else None)
        return LoopResult(
            success=False,
            output=fallback_output,
            error=f"Max retries ({max_retries}) exceeded",
            total_attempts=state.attempt,
            state=state,
        )

    async def _execute_nested_loop(self, task: TaskContext, worker_config: dict, state: LoopState):
        """执行嵌套 Loop Worker。"""
        nested_template = worker_config.get("template", "")
        nested_registry = LoopRegistry()
        nested_config = nested_registry.get(nested_template)
        if nested_config:
            nested_config_dict = nested_config.model_dump()
            nested_config_dict["name"] = f"{state.loop_id}:nested:{nested_template}"
            nested_executor = LoopExecutor(
                hybrid_executor=self.hybrid_executor,
                harness=self.harness,
                planner=self.planner,
                verifier=self.verifier,
                reflector=self.reflector,
                checkpoint_mgr=self.checkpoint_mgr,
                entropy_mgr=self.entropy_mgr,
                rule_evolution=self.rule_evolution,
                persona_lock=self.persona_lock,
                memory_manager=self.memory_manager,
                on_iteration_create=self.on_iteration_create,
                on_iteration_update=self.on_iteration_update,
                on_iteration_complete=self.on_iteration_complete,
                on_loop_state_update=self.on_loop_state_update,
            )
            result = await nested_executor.run(task, nested_config_dict)
            if not result.success:
                pass  # The outer loop's verifier will catch the failure
            return result
        else:
            return {"error": f"Nested loop template '{nested_template}' not found"}

    async def _execute_parallel_workers(self, task: TaskContext, worker_config: dict, state: LoopState):
        """执行并行 Worker。"""
        from flowforge.loop.parallel import execute_parallel_workers
        workers = worker_config.get("workers", [])
        merge_strategy = worker_config.get("merge_strategy", "concat")
        parallel_result = await execute_parallel_workers(
            workers, task, self.hybrid_executor, merge_strategy
        )
        result = parallel_result.merge_results(merge_strategy)
        if not parallel_result.all_succeeded:
            for name, error in parallel_result.errors.items():
                state.past_errors.append(f"Worker '{name}' failed: {error}")
        return result

    async def _write_memory(self, memory_type: str, key: str, data: dict) -> None:
        """按 Memory 映射关系写入 MemoryManager。

        Args:
            memory_type: MemoryManager 中的 store 名称（working/short_term/long_term/semantic/episodic）
            key: 存储键名
            data: 要写入的数据

        如果 memory_manager 不可用则静默跳过（向后兼容）。
        """
        if self.memory_manager is None:
            return
        try:
            await self.memory_manager.save(memory_type, key, data)
        except Exception as e:
            logger.warning(
                f"[loop] Failed to write {memory_type} memory: {e}, "
                f"loop_id={data.get('loop_id', 'unknown')}"
            )

    async def _read_memory(self, memory_type: str, key: str) -> Any:
        """从 MemoryManager 读取记忆数据。

        Args:
            memory_type: MemoryManager 中的 store 名称
            key: 查询键名

        如果 memory_manager 不可用或读取失败则返回 None。
        """
        if self.memory_manager is None:
            return None
        try:
            results = await self.memory_manager.retrieve(memory_type, key)
            return results
        except Exception as e:
            logger.warning(f"[loop] Failed to read {memory_type} memory: {e}")
            return None

    @staticmethod
    def _calc_backoff(strategy: str, base: int, attempt: int) -> float:
        """根据退避策略计算等待秒数。"""
        if strategy == "fixed":
            return float(base)
        elif strategy == "linear":
            return float(base * (attempt + 1))
        elif strategy == "exponential":
            return float(base * (2 ** attempt))
        return float(base)
