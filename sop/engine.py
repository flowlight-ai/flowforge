"""SOP 执行引擎 — 阶段门禁检查与流转控制。

SOPExecutor 是 FlowForge 与 LoopExecutor 之间的桥接层：
- SOPExecutor 管控阶段门禁（hard_rules / pitfalls）
- LoopExecutor / WorkflowExecutor 管控阶段内的实际任务执行

执行模型：
1. SOPExecutor 在每个阶段开始前检查所有 hard_rules
2. 若有 blocker 未通过则停止，等待修复后重试
3. 若所有 blocker 通过，则交由 LoopExecutor 执行阶段内任务
4. 阶段完成后记录结果，自动推进到下一阶段
5. 持续直到所有阶段完成或被 blocker 阻断

关键设计（遵守铁律）：
- 不直接执行任务，只做门禁检查和阶段推进（铁律3：组合优于继承）
- 不直接操作数据库（铁律4），状态由 CheckpointManager 持久化
- 不硬编码路径/密钥（铁律5），所有配置从 YAML 加载
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

import yaml

from flowforge.core.tracing import get_logger
from flowforge.sop.models import (
    HardRule,
    Pitfall,
    PredicateResult,
    Severity,
    SOPDefinition,
    SOPExecutionResult,
    SOPExecutionState,
    SOPStage,
    SOPStageResult,
)
from flowforge.sop.predicate import PredicateChecker

logger = get_logger("sop.engine")


class SOPExecutor:
    """SOP 执行器 — 阶段门禁检查与流转控制。

    SOPExecutor 不直接执行任务，只负责：
    1. 检查每个阶段的 hard_rules（blocker 未通过则阻断）
    2. 收集 pitfalls 警告
    3. 推进或回退阶段
    4. 记录执行结果

    实际任务执行由 LoopExecutor / WorkflowExecutor 完成，SOPExecutor
    通过 suggested_skill 字段提示应使用哪个 skill。

    Usage:
        checker = PredicateChecker()
        sop_def = load_sop_from_yaml("flowforge/config/sops/development.yaml")
        executor = SOPExecutor(sop_def, checker)
        result = await executor.execute_sop(feature_id="feat-001", context={...})
    """

    def __init__(
        self,
        sop_definition: SOPDefinition,
        predicate_checker: PredicateChecker,
    ) -> None:
        """初始化 SOP 执行器。

        Args:
            sop_definition: SOP 定义（包含所有阶段）
            predicate_checker: 谓词检查器实例
        """
        self._sop = sop_definition
        self._checker = predicate_checker
        self._state = SOPExecutionState(sop_id=sop_definition.id)
        logger.info(
            f"SOPExecutor: initialized with SOP '{sop_definition.id}' "
            f"({len(sop_definition.stages)} stages)"
        )

    @property
    def sop(self) -> SOPDefinition:
        """返回当前 SOP 定义。"""
        return self._sop

    @property
    def state(self) -> SOPExecutionState:
        """返回当前执行状态。"""
        return self._state

    def get_current_stage(self) -> SOPStage:
        """获取当前阶段。

        Returns:
            当前 SOPStage

        Raises:
            IndexError: 所有阶段已完成
        """
        if self._state.stage_index >= len(self._sop.stages):
            raise IndexError(
                f"stage_index {self._state.stage_index} out of range "
                f"(total {len(self._sop.stages)} stages)"
            )
        return self._sop.stages[self._state.stage_index]

    def get_stage(self, stage_id: str) -> SOPStage | None:
        """按 ID 查找阶段。"""
        for stage in self._sop.stages:
            if stage.id == stage_id:
                return stage
        return None

    def advance_stage(self) -> bool:
        """推进到下一阶段。

        Returns:
            True 表示成功推进，False 表示已到达最后一个阶段
        """
        if self._state.stage_index >= len(self._sop.stages) - 1:
            self._state.completed = True
            logger.info("SOPExecutor: reached final stage, SOP completed")
            return False
        self._state.stage_index += 1
        next_stage = self._sop.stages[self._state.stage_index]
        logger.info(
            f"SOPExecutor: advanced to stage {self._state.stage_index} "
            f"'{next_stage.id}' ({next_stage.label})"
        )
        return True

    def get_progress(self) -> dict[str, Any]:
        """获取执行进度。

        Returns:
            包含 current_stage_index / total_stages / completed_stages /
            remaining_stages / current_stage_id / is_completed 的字典
        """
        total = len(self._sop.stages)
        current = self._state.stage_index
        return {
            "sop_id": self._sop.id,
            "current_stage_index": current,
            "total_stages": total,
            "completed_stages": current,
            "remaining_stages": max(0, total - current),
            "current_stage_id": (
                self._sop.stages[current].id if current < total else ""
            ),
            "current_stage_label": (
                self._sop.stages[current].label if current < total else ""
            ),
            "is_completed": self._state.completed,
        }

    async def _check_rule(
        self,
        rule: HardRule | Pitfall,
        context: dict[str, Any],
    ) -> tuple[PredicateResult, dict[str, Any]]:
        """检查单条规则（hard_rule 或 pitfall）。

        Returns:
            (PredicateResult, 规则摘要 dict) 二元组
        """
        result = await self._checker.check(rule.predicate, context=context)
        summary = {
            "rule_id": rule.id,
            "text": rule.text,
            "severity": rule.severity.value,
            "passed": result.passed,
            "message": result.message,
            "evidence": result.evidence,
        }
        return result, summary

    async def execute_stage(
        self,
        stage_id: str,
        context: dict[str, Any] | None = None,
    ) -> SOPStageResult:
        """执行单个阶段的门禁检查。

        流程：
        1. 查找指定阶段
        2. 检查所有 hard_rules（blocker 未通过则阻断）
        3. 检查所有 pitfalls（收集警告）
        4. 返回阶段结果

        Args:
            stage_id: 阶段标识
            context: 运行时上下文（可包含 last_command / command_history /
                     author / reviewer / guardian / feature_doc 等）

        Returns:
            SOPStageResult 阶段执行结果
        """
        ctx = context or {}
        stage = self.get_stage(stage_id)
        if stage is None:
            return SOPStageResult(
                stage_id=stage_id,
                stage_label="",
                passed=False,
                blocker_messages=[f"stage '{stage_id}' not found in SOP '{self._sop.id}'"],
                executed_at=datetime.utcnow(),
            )

        logger.info(
            f"SOPExecutor: executing stage '{stage.id}' ({stage.label}) "
            f"with {len(stage.hard_rules)} hard_rules, {len(stage.pitfalls)} pitfalls"
        )

        hard_rule_results: list[dict[str, Any]] = []
        pitfall_results: list[dict[str, Any]] = []
        blocker_messages: list[str] = []
        warning_messages: list[str] = []

        # 检查 hard_rules
        for rule in stage.hard_rules:
            result, summary = await self._check_rule(rule, ctx)
            hard_rule_results.append(summary)
            if not result.passed:
                msg = f"[{rule.id}] {rule.text} — {result.message}"
                if rule.severity == Severity.BLOCKER:
                    blocker_messages.append(msg)
                    logger.warning(
                        f"SOPExecutor: stage '{stage.id}' hard_rule '{rule.id}' BLOCKED: {result.message}"
                    )
                else:
                    warning_messages.append(msg)
                    logger.info(
                        f"SOPExecutor: stage '{stage.id}' hard_rule '{rule.id}' warning: {result.message}"
                    )

        # 检查 pitfalls
        for pitfall in stage.pitfalls:
            result, summary = await self._check_rule(pitfall, ctx)
            pitfall_results.append(summary)
            if not result.passed:
                msg = f"[{pitfall.id}] {pitfall.text} — {result.message}"
                if pitfall.severity == Severity.BLOCKER:
                    # pitfall 的 blocker 仅在非可选阶段才阻断
                    if stage.optional:
                        warning_messages.append(
                            f"(optional stage) {msg}"
                        )
                    else:
                        blocker_messages.append(msg)
                        logger.warning(
                            f"SOPExecutor: stage '{stage.id}' pitfall '{pitfall.id}' BLOCKED: {result.message}"
                        )
                else:
                    warning_messages.append(msg)
                    logger.info(
                        f"SOPExecutor: stage '{stage.id}' pitfall '{pitfall.id}' warning: {result.message}"
                    )

        # 可选阶段失败不阻断主流程
        stage_passed = (
            len(blocker_messages) == 0 if not stage.optional else True
        )
        if stage.optional and blocker_messages:
            # 可选阶段的 blocker 降级为 warning
            warning_messages.extend(
                f"(optional, downgraded) {m}" for m in blocker_messages
            )
            blocker_messages.clear()
            stage_passed = True
            logger.info(
                f"SOPExecutor: optional stage '{stage.id}' blockers downgraded to warnings"
            )

        result = SOPStageResult(
            stage_id=stage.id,
            stage_label=stage.label,
            passed=stage_passed,
            hard_rule_results=hard_rule_results,
            pitfall_results=pitfall_results,
            blocker_messages=blocker_messages,
            warning_messages=warning_messages,
            executed_at=datetime.utcnow(),
        )

        # 记录到执行状态
        self._state.stage_results[stage.id] = result.model_dump()

        logger.info(
            f"SOPExecutor: stage '{stage.id}' result: "
            f"passed={stage_passed}, blockers={len(blocker_messages)}, warnings={len(warning_messages)}"
        )
        return result

    async def execute_sop(
        self,
        feature_id: str,
        context: dict[str, Any] | None = None,
    ) -> SOPExecutionResult:
        """执行完整 SOP — 按顺序执行所有阶段。

        流程：
        1. 初始化执行状态
        2. 按顺序执行每个阶段
        3. 阶段通过后自动推进到下一阶段
        4. 遇到 blocker 则停止并返回部分结果
        5. 所有阶段完成后标记 success=True

        Args:
            feature_id: feature 标识
            context: 运行时上下文

        Returns:
            SOPExecutionResult 完整执行结果
        """
        ctx = context or {}
        started_at = datetime.utcnow()
        self._state = SOPExecutionState(
            sop_id=self._sop.id,
            feature_id=feature_id,
            stage_index=0,
            started_at=started_at,
            completed=False,
        )

        logger.info(
            f"SOPExecutor: starting SOP '{self._sop.id}' for feature '{feature_id}' "
            f"with {len(self._sop.stages)} stages"
        )

        stage_results: list[SOPStageResult] = []
        all_blocker_messages: list[str] = []
        all_warning_messages: list[str] = []
        final_stage_id = ""
        success = False

        for index, stage in enumerate(self._sop.stages):
            self._state.stage_index = index
            final_stage_id = stage.id

            stage_result = await self.execute_stage(stage.id, ctx)
            stage_results.append(stage_result)
            all_blocker_messages.extend(stage_result.blocker_messages)
            all_warning_messages.extend(stage_result.warning_messages)

            if not stage_result.passed:
                logger.warning(
                    f"SOPExecutor: SOP halted at stage '{stage.id}' due to blockers"
                )
                break

            logger.info(
                f"SOPExecutor: stage '{stage.id}' passed, advancing"
            )
        else:
            # 所有阶段都通过（for-else：未 break）
            success = True
            self._state.completed = True
            logger.info(
                f"SOPExecutor: SOP '{self._sop.id}' completed successfully for feature '{feature_id}'"
            )

        completed_at = datetime.utcnow()
        return SOPExecutionResult(
            sop_id=self._sop.id,
            feature_id=feature_id,
            success=success,
            stage_results=stage_results,
            final_stage_id=final_stage_id,
            blocker_messages=all_blocker_messages,
            warning_messages=all_warning_messages,
            started_at=started_at,
            completed_at=completed_at,
        )

    def reset(self) -> None:
        """重置执行状态到初始值。

        用于重新执行 SOP 或在 blocker 修复后从头开始。
        """
        logger.info(f"SOPExecutor: resetting state for SOP '{self._sop.id}'")
        self._state = SOPExecutionState(sop_id=self._sop.id)

    def resume_from_current(self) -> None:
        """从当前阶段继续执行（不重置 stage_index）。

        用于在 blocker 修复后从断点处继续。
        """
        logger.info(
            f"SOPExecutor: resuming from stage_index={self._state.stage_index}"
        )
        self._state.completed = False


def load_sop_from_yaml(yaml_path: str | Path) -> SOPDefinition:
    """从 YAML 文件加载 SOP 定义。

    Args:
        yaml_path: YAML 文件路径

    Returns:
        SOPDefinition 实例
    """
    path = Path(yaml_path)
    logger.info(f"load_sop_from_yaml: loading SOP from {path}")
    with open(path, encoding="utf-8") as f:
        data = yaml.safe_load(f)
    return SOPDefinition.model_validate(data)


def load_sops_from_dir(sops_dir: str | Path) -> dict[str, SOPDefinition]:
    """从目录加载所有 SOP 定义。

    Args:
        sops_dir: 包含 SOP YAML 文件的目录

    Returns:
        {sop_id: SOPDefinition} 字典
    """
    dir_path = Path(sops_dir)
    sops: dict[str, SOPDefinition] = {}
    if not dir_path.exists():
        logger.warning(f"load_sops_from_dir: directory {dir_path} does not exist")
        return sops

    for yaml_file in dir_path.glob("*.yaml"):
        try:
            sop = load_sop_from_yaml(yaml_file)
            sops[sop.id] = sop
            logger.info(f"load_sops_from_dir: loaded SOP '{sop.id}' from {yaml_file.name}")
        except Exception as exc:
            logger.error(f"load_sops_from_dir: failed to load {yaml_file.name}: {exc}")
    return sops
