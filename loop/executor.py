"""Loop Executor — 包装 HybridExecutor，添加规划-校验-复盘闭环。

LoopExecutor 是 Harness 驾驭层的子模块，每次迭代：
1. 触发 Harness pre_execute（注入上下文）
2. 调用 HybridExecutor 执行（复用现有引擎）
3. 触发 Harness post_execute（架构约束校验）
4. 执行 Loop Verifier（业务质量校验）
5. 仅在失败时触发 Loop Reflector（复盘+规则进化）
6. 保存检查点
7. 发出事件
"""

import asyncio
from datetime import datetime

from flowforge.core.task_context import TaskContext
from flowforge.executor.hybrid_executor import HybridExecutor
from flowforge.harness.orchestrator import HarnessOrchestrator
from flowforge.harness.entropy_manager import EntropyManager, DebtSeverity, RuleEvolution
from flowforge.core.checkpoint_manager import CheckpointManager
from flowforge.loop.state import LoopState, LoopResult, LoopPhase, LoopNestingError
from flowforge.loop.planner import LoopPlanner
from flowforge.loop.verifier import LoopVerifier
from flowforge.loop.reflector import LoopReflector
from flowforge.loop.registry import LoopRegistry
from flowforge.core.tracing import get_logger

logger = get_logger("loop.executor")


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

    MAX_NESTING_DEPTH: int = 3
    _current_nesting_depth: int = 0

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
    ):
        self.hybrid_executor = hybrid_executor
        self.harness = harness
        self.planner = planner
        self.verifier = verifier
        self.reflector = reflector
        self.checkpoint_mgr = checkpoint_mgr
        self.entropy_mgr = entropy_mgr
        self.rule_evolution = rule_evolution

    async def run(self, task: TaskContext, loop_config: dict) -> LoopResult:
        """执行 Loop：规划→执行→校验→复盘→重试。"""
        # 嵌套深度检查
        if LoopExecutor._current_nesting_depth >= LoopExecutor.MAX_NESTING_DEPTH:
            raise LoopNestingError(
                depth=LoopExecutor._current_nesting_depth,
                max_depth=LoopExecutor.MAX_NESTING_DEPTH,
            )

        LoopExecutor._current_nesting_depth += 1
        try:
            return await self._run_loop(task, loop_config)
        finally:
            LoopExecutor._current_nesting_depth -= 1

    async def _run_loop(self, task: TaskContext, loop_config: dict) -> LoopResult:
        """内部 Loop 执行逻辑。"""
        max_retries = loop_config.get("max_retries", 3)
        worker_config = loop_config.get("worker", {})
        worker_mode = worker_config.get("mode", "workflow")
        backoff_strategy = loop_config.get("backoff_strategy", "exponential")
        backoff_base = loop_config.get("backoff_base", 2)

        state = LoopState(
            loop_id=loop_config["name"],
            task_id=task.task_id,
            template_name=loop_config["name"],
            max_retries=max_retries,
        )

        # 1. 规划
        state.phase = LoopPhase.PLANNING
        plan = await self.planner.plan(task, loop_config.get("planner", {}))
        state.current_plan = plan

        # Loop 启动事件
        if task.event_bus:
            task.event_bus.emit(task.task_id, "loop.started", {
                "loop_id": state.loop_id,
                "task_id": state.task_id,
                "template_name": state.template_name,
                "max_retries": max_retries,
            })

        for attempt in range(max_retries):
            state.attempt = attempt + 1
            state.updated_at = datetime.utcnow()

            # 迭代开始事件
            if task.event_bus:
                task.event_bus.emit(task.task_id, "loop.iteration.start", {
                    "loop_id": state.loop_id,
                    "attempt": state.attempt,
                    "phase": "executing",
                })

            # 2. Harness pre_execute（注入上下文 + 权限检查）
            #    首次迭代：完整上下文注入；后续迭代：仅注入 delta（Reflector 的反思结果）
            if attempt > 0 and state.reflection_history:
                task.metadata["loop_reflections"] = state.reflection_history[-1].get("suggestions", [])
            await self.harness.pre_execute(task)

            # 3. 执行（委托给 HybridExecutor / 嵌套 Loop / 并行 Worker）
            state.phase = LoopPhase.EXECUTING
            if worker_mode == "loop":
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
                    )
                    result = await nested_executor.run(task, nested_config_dict)
                    if not result.success:
                        # Nested loop failed, trigger reflector in outer loop
                        pass  # The outer loop's verifier will catch the failure
                else:
                    result = {"error": f"Nested loop template '{nested_template}' not found"}
            elif worker_mode == "parallel":
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
            else:
                result = await self.hybrid_executor.run(task, mode_hint=worker_mode)

            # 4. Harness post_execute（架构约束校验 + FeedbackLoop 评分）
            result = await self.harness.post_execute(result, task)

            # 5. Loop Verifier（业务级质量校验）
            state.phase = LoopPhase.VERIFYING
            verdict = await self.verifier.verify(result, task, loop_config.get("verifier", {}))
            state.verification_history.append(verdict.model_dump())

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
                self.checkpoint_mgr.save(
                    task_id=state.task_id,
                    step_name=f"loop:{state.loop_id}:attempt_{state.attempt}",
                    state=state.model_dump(),
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
            reflection = await self.reflector.reflect(verdict.errors, task, state)
            state.reflection_history.append(reflection.model_dump())
            state.past_errors.extend(verdict.errors)

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

        # 耗尽重试次数
        state.phase = LoopPhase.FAILED
        self.checkpoint_mgr.save(
            task_id=state.task_id,
            step_name=f"loop:{state.loop_id}:attempt_{state.attempt}",
            state=state.model_dump(),
        )
        if task.event_bus:
            task.event_bus.emit(task.task_id, "loop.failed", {
                "loop_id": state.loop_id,
                "total_attempts": max_retries,
                "last_errors": state.past_errors[-3:] if state.past_errors else [],
            })
        return LoopResult(
            success=False,
            error=f"Max retries ({max_retries}) exceeded",
            total_attempts=max_retries,
            state=state,
        )

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
