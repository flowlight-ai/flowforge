"""章节写入 Saga — 多步骤原子性写入与补偿.

提供长文本生成场景下的多步骤原子写入：
- 5 步 Saga：write_draft → consistency_check → style_alignment → quality_gate → finalize
- 每步有补偿动作，失败时回滚
- Saga 状态机跟踪
"""

import asyncio
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional

from flowforge.core.tracing import get_logger

logger = get_logger("tools.chapter_write_saga")


class SagaState(str, Enum):
    """Saga 状态."""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    COMPENSATING = "compensating"
    FAILED = "failed"


@dataclass
class SagaStep:
    """Saga 步骤定义."""

    name: str
    action: Callable  # 正向操作
    compensate: Callable  # 补偿操作
    description: str = ""


@dataclass
class SagaStepResult:
    """Saga 步骤执行结果."""

    step_name: str
    success: bool
    result: Any = None
    error: str = ""


@dataclass
class SagaContext:
    """Saga 执行上下文 — 在步骤间传递数据."""

    chapter_id: str
    novel_id: str = ""
    state: Dict[str, Any] = field(default_factory=dict)
    step_results: List[SagaStepResult] = field(default_factory=list)
    pre_saga_snapshot: Dict[str, Any] = field(default_factory=dict)


class ChapterWriteSaga:
    """章节写入 Saga — 5 步原子写入与补偿.

    步骤：
    1. write_draft: 生成章节草稿
    2. consistency_check: 一致性检查
    3. style_alignment: 风格对齐
    4. quality_gate: 质量门检查
    5. finalize: 最终化（写入存储）

    每步失败时执行补偿：
    1. write_draft 失败 → 标记 draft_failed
    2. consistency_check 失败 → 标记不一致，继续
    3. style_alignment 失败 → 使用原始草稿
    4. quality_gate 失败 → 标记 needs_revision
    5. finalize 失败 → 回滚到 pre-saga 状态
    """

    def __init__(self):
        self._steps: List[SagaStep] = self._build_default_steps()
        self._state: SagaState = SagaState.PENDING

    def _build_default_steps(self) -> List[SagaStep]:
        """构建默认 5 步 Saga."""
        return [
            SagaStep(
                name="write_draft",
                action=self._step_write_draft,
                compensate=self._compensate_write_draft,
                description="生成章节草稿",
            ),
            SagaStep(
                name="consistency_check",
                action=self._step_consistency_check,
                compensate=self._compensate_consistency_check,
                description="一致性检查",
            ),
            SagaStep(
                name="style_alignment",
                action=self._step_style_alignment,
                compensate=self._compensate_style_alignment,
                description="风格对齐",
            ),
            SagaStep(
                name="quality_gate",
                action=self._step_quality_gate,
                compensate=self._compensate_quality_gate,
                description="质量门检查",
            ),
            SagaStep(
                name="finalize",
                action=self._step_finalize,
                compensate=self._compensate_finalize,
                description="最终化写入",
            ),
        ]

    async def execute(self, context: SagaContext) -> SagaContext:
        """执行 Saga.

        按顺序执行每一步，失败时执行补偿并回滚。
        """
        self._state = SagaState.RUNNING
        logger.info(
            f"ChapterWriteSaga: 开始执行 chapter_id={context.chapter_id}, "
            f"steps={[s.name for s in self._steps]}"
        )
        logger.debug(
            f"execute: saga_start chapter_id={context.chapter_id} "
            f"step_count={len(self._steps)} initial_state_keys={list(context.state.keys())}"
        )

        # 保存 pre-saga 快照
        context.pre_saga_snapshot = dict(context.state)
        logger.debug(
            f"execute: snapshot_saved chapter_id={context.chapter_id} "
            f"snapshot_keys={list(context.pre_saga_snapshot.keys())}"
        )

        completed_steps: List[SagaStep] = []

        for step in self._steps:
            try:
                logger.info(f"ChapterWriteSaga: 执行步骤 {step.name}")
                logger.debug(
                    f"execute: step_start step={step.name} "
                    f"description={step.description!r}"
                )
                result = await step.action(context)
                context.step_results.append(
                    SagaStepResult(
                        step_name=step.name, success=True, result=result
                    )
                )
                completed_steps.append(step)
                logger.debug(
                    f"execute: step_end step={step.name} success=True "
                    f"result={result!r}"
                )

            except Exception as e:
                logger.error(
                    f"ChapterWriteSaga: 步骤 {step.name} 失败: {e}"
                )
                logger.debug(
                    f"execute: step_end step={step.name} success=False "
                    f"error={e!r}"
                )
                context.step_results.append(
                    SagaStepResult(
                        step_name=step.name, success=False, error=str(e)
                    )
                )

                # 执行补偿
                self._state = SagaState.COMPENSATING
                await self._compensate(completed_steps, context)

                # 检查是否可以继续（某些步骤失败可以继续）
                if step.name == "consistency_check":
                    logger.info("ChapterWriteSaga: 一致性检查失败，标记后继续")
                    logger.debug(
                        f"execute: continue_after_failure step={step.name} "
                        f"reason=consistency_check_tolerated"
                    )
                    context.state["has_inconsistencies"] = True
                    self._state = SagaState.RUNNING
                    completed_steps.append(step)
                    continue
                elif step.name == "style_alignment":
                    logger.info("ChapterWriteSaga: 风格对齐失败，使用原始草稿")
                    logger.debug(
                        f"execute: continue_after_failure step={step.name} "
                        f"reason=style_alignment_tolerated"
                    )
                    context.state["style_aligned"] = False
                    self._state = SagaState.RUNNING
                    completed_steps.append(step)
                    continue
                else:
                    self._state = SagaState.FAILED
                    logger.error(f"ChapterWriteSaga: Saga 失败于步骤 {step.name}")
                    logger.debug(
                        f"execute: saga_failed chapter_id={context.chapter_id} "
                        f"failed_step={step.name} completed_steps="
                        f"{[s.name for s in completed_steps]}"
                    )
                    return context

        self._state = SagaState.COMPLETED
        logger.info(f"ChapterWriteSaga: 成功完成 chapter_id={context.chapter_id}")
        logger.debug(
            f"execute: saga_completed chapter_id={context.chapter_id} "
            f"completed_steps={[s.name for s in completed_steps]} "
            f"final_state_keys={list(context.state.keys())}"
        )
        return context

    async def _compensate(
        self, completed_steps: List[SagaStep], context: SagaContext
    ) -> None:
        """执行已完成步骤的补偿（逆序）."""
        logger.debug(
            f"_compensate: enter completed_steps_count={len(completed_steps)} "
            f"steps={[s.name for s in completed_steps]} "
            f"chapter_id={context.chapter_id}"
        )
        for step in reversed(completed_steps):
            try:
                logger.info(f"ChapterWriteSaga: 补偿步骤 {step.name}")
                logger.debug(
                    f"_compensate: step_start step={step.name} "
                    f"action=compensate"
                )
                await step.compensate(context)
                logger.debug(
                    f"_compensate: step_end step={step.name} success=True"
                )
            except Exception as e:
                logger.error(
                    f"ChapterWriteSaga: 补偿步骤 {step.name} 失败: {e}"
                )
                logger.debug(
                    f"_compensate: step_end step={step.name} success=False "
                    f"error={e!r}"
                )
        logger.debug(
            f"_compensate: done compensated_steps={len(completed_steps)}"
        )

    def get_state(self) -> SagaState:
        """获取当前 Saga 状态."""
        return self._state

    # ==================== 默认步骤实现 ====================
    # 这些是占位实现，实际使用时通过 register_step 覆盖

    async def _step_write_draft(self, context: SagaContext) -> Any:
        """步骤 1: 生成草稿."""
        logger.debug(
            f"_step_write_draft: enter chapter_id={context.chapter_id}"
        )
        context.state["draft"] = ""
        result = {"draft_generated": True}
        logger.debug(
            f"_step_write_draft: result {result} draft_len=0"
        )
        return result

    async def _step_consistency_check(self, context: SagaContext) -> Any:
        """步骤 2: 一致性检查."""
        logger.debug(
            f"_step_consistency_check: enter chapter_id={context.chapter_id}"
        )
        result = {"consistent": True}
        logger.debug(f"_step_consistency_check: result {result}")
        return result

    async def _step_style_alignment(self, context: SagaContext) -> Any:
        """步骤 3: 风格对齐."""
        logger.debug(
            f"_step_style_alignment: enter chapter_id={context.chapter_id}"
        )
        context.state["style_aligned"] = True
        result = {"aligned": True}
        logger.debug(f"_step_style_alignment: result {result}")
        return result

    async def _step_quality_gate(self, context: SagaContext) -> Any:
        """步骤 4: 质量门检查."""
        logger.debug(
            f"_step_quality_gate: enter chapter_id={context.chapter_id}"
        )
        result = {"passed": True}
        logger.debug(f"_step_quality_gate: result {result}")
        return result

    async def _step_finalize(self, context: SagaContext) -> Any:
        """步骤 5: 最终化."""
        logger.debug(
            f"_step_finalize: enter chapter_id={context.chapter_id} "
            f"state_keys={list(context.state.keys())}"
        )
        result = {"finalized": True}
        logger.debug(f"_step_finalize: result {result}")
        return result

    # ==================== 补偿操作 ====================

    async def _compensate_write_draft(self, context: SagaContext) -> None:
        logger.debug(
            f"_compensate_write_draft: action mark draft_failed "
            f"chapter_id={context.chapter_id}"
        )
        context.state["draft_status"] = "draft_failed"

    async def _compensate_consistency_check(self, context: SagaContext) -> None:
        logger.debug(
            f"_compensate_consistency_check: action mark has_inconsistencies "
            f"chapter_id={context.chapter_id}"
        )
        context.state["has_inconsistencies"] = True

    async def _compensate_style_alignment(self, context: SagaContext) -> None:
        logger.debug(
            f"_compensate_style_alignment: action mark style_aligned=False "
            f"chapter_id={context.chapter_id}"
        )
        context.state["style_aligned"] = False

    async def _compensate_quality_gate(self, context: SagaContext) -> None:
        logger.debug(
            f"_compensate_quality_gate: action mark needs_revision "
            f"chapter_id={context.chapter_id}"
        )
        context.state["needs_revision"] = True

    async def _compensate_finalize(self, context: SagaContext) -> None:
        """回滚到 pre-saga 状态."""
        logger.debug(
            f"_compensate_finalize: action rollback_to_snapshot "
            f"chapter_id={context.chapter_id} "
            f"current_keys={list(context.state.keys())} "
            f"snapshot_keys={list(context.pre_saga_snapshot.keys())}"
        )
        context.state.clear()
        context.state.update(context.pre_saga_snapshot)
        logger.debug(
            f"_compensate_finalize: done restored_keys={list(context.state.keys())}"
        )

    # ==================== 自定义步骤注册 ====================

    def register_step(
        self,
        name: str,
        action: Callable,
        compensate: Callable,
        description: str = "",
    ) -> None:
        """注册或替换 Saga 步骤.

        允许上层项目通过配置注入自定义步骤实现。
        """
        logger.debug(
            f"register_step: enter name={name!r} description={description!r} "
            f"action={getattr(action, '__name__', repr(action))} "
            f"compensate={getattr(compensate, '__name__', repr(compensate))}"
        )
        for i, step in enumerate(self._steps):
            if step.name == name:
                self._steps[i] = SagaStep(
                    name=name,
                    action=action,
                    compensate=compensate,
                    description=description or step.description,
                )
                logger.info(f"ChapterWriteSaga: 替换步骤 {name}")
                logger.debug(
                    f"register_step: replaced name={name!r} index={i} "
                    f"total_steps={len(self._steps)}"
                )
                return

        # 新步骤追加到末尾
        self._steps.append(
            SagaStep(
                name=name,
                action=action,
                compensate=compensate,
                description=description,
            )
        )
        logger.info(f"ChapterWriteSaga: 新增步骤 {name}")
        logger.debug(
            f"register_step: appended name={name!r} "
            f"new_total_steps={len(self._steps)}"
        )
