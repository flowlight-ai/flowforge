"""TeamActState — 六步循环状态机 + TerminationReport 终止报告。

TeamAct 是 roleagent.md §2 定义的团队主循环，是 Shared State 协作模式的工程化闭环。
六步循环：State → Owner → Action → Evidence → Verdict → Route → State（下一轮）

五项终止条件（缺一不可，roleagent.md §2.2）：
    1. 验收标准全部达成（不能有 deferred）
    2. 证据已附（每条验收都有 commit / 测试 / trace）
    3. 跨 agent 交叉验证（不能自己 review 自己）
    4. 无悬空任务归属（所有 open question 已 resolved 或升级）
    5. 愿景收敛（CVO 确认不能被 proxy 替代）

设计依据：
    - features/F002-teamact-loop.md §2（核心设计）
    - roleagent.md §2.1-§2.2
    - ADR 002-collaboration-protocol.md

铁律遵守：
    - 铁律 3：不直接实例化外部服务，依赖通过构造函数注入
    - 铁律 5：无硬编码路径/密钥
    - 铁律 6：async I/O（持久化方法为 async，供后续 Repository 集成）
    - 编程红线 9：使用 Pydantic 字段组合而非继承

License: MIT
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from pydantic import BaseModel, Field

from flowforge.core.teamact.handoff import HandoffCapsule
from flowforge.core.teamact.types import BallStatus, TeamActStep, TerminationCondition
from flowforge.core.tracing import get_logger

logger = get_logger("teamact.state_machine")

# 首席愿景官标识（CVO = Chief Vision Officer）
CVO_AGENT_ID = "cvo"


class HistoryEntry(BaseModel):
    """TeamAct 历史记录条目。

    每次 advance() / pass_ball() / escalate() 都会在 history 中追加一条记录。

    Attributes:
        step: 记录时的 TeamAct 步骤。
        action: 执行的动作描述。
        evidence: 产出证据（commit / 测试 / trace ID）。
        timestamp: 记录时间。
        agent: 执行该动作的Forgekin标识（可选）。
        ball_status: 记录时的持球状态。
    """

    step: TeamActStep = Field(..., description="TeamAct 步骤")
    action: str = Field(default="", description="执行的动作")
    evidence: str = Field(default="", description="产出证据")
    timestamp: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="记录时间",
    )
    agent: Optional[str] = Field(default=None, description="执行Forgekin")
    ball_status: BallStatus = Field(
        default=BallStatus.HELD, description="持球状态"
    )


class TerminationReport(BaseModel):
    """五项终止条件报告（缺一不可）。

    对应 roleagent.md §2.2，TeamAct 团队任务终止必须同时满足五项条件。
    枚举值（TerminationCondition）与字段名一一对应，便于 mark() 动态赋值。

    Attributes:
        acceptance_done: 1. 验收标准全部达成（不能有 deferred）。
        evidence_attached: 2. 证据已附（每条验收都有 commit / 测试 / trace）。
        cross_validated: 3. 跨 agent 交叉验证（不能自己 review 自己）。
        no_dangling_ownership: 4. 无悬空任务归属（所有 open question 已 resolved 或升级）。
        vision_converged: 5. 愿景收敛（CVO 确认不能被 proxy 替代）。
    """

    acceptance_done: bool = Field(default=False, description="验收标准全部达成")
    evidence_attached: bool = Field(default=False, description="证据已附")
    cross_validated: bool = Field(default=False, description="跨 agent 交叉验证")
    no_dangling_ownership: bool = Field(
        default=False, description="无悬空任务归属"
    )
    vision_converged: bool = Field(default=False, description="愿景收敛")

    def is_terminated(self) -> bool:
        """检查五项终止条件是否全部满足（缺一不可）。"""
        return all(
            [
                self.acceptance_done,
                self.evidence_attached,
                self.cross_validated,
                self.no_dangling_ownership,
                self.vision_converged,
            ]
        )

    def met_conditions(self) -> list[TerminationCondition]:
        """返回已满足的终止条件列表。"""
        result: list[TerminationCondition] = []
        for cond in TerminationCondition.all():
            if self.is_met(cond):
                result.append(cond)
        return result

    def missing_conditions(self) -> list[TerminationCondition]:
        """返回未满足的终止条件列表（用于报告缺失项）。"""
        result: list[TerminationCondition] = []
        for cond in TerminationCondition.all():
            if not self.is_met(cond):
                result.append(cond)
        return result

    def is_met(self, condition: TerminationCondition) -> bool:
        """检查指定终止条件是否满足。

        Args:
            condition: 终止条件枚举值。

        Returns:
            True 表示该条件已满足。
        """
        return bool(getattr(self, condition.value, False))

    def mark(self, condition: TerminationCondition, met: bool = True) -> None:
        """标记指定终止条件的状态。

        Args:
            condition: 终止条件枚举值。
            met: True 表示已满足，False 表示未满足。
        """
        setattr(self, condition.value, met)
        logger.debug(
            f"Termination condition marked: {condition.value}={met}"
        )

    def to_summary(self) -> str:
        """生成终止报告摘要。"""
        missing = self.missing_conditions()
        status = "TERMINATED" if self.is_terminated() else "NOT_TERMINATED"
        missing_str = (
            ", ".join(c.value for c in missing) if missing else "(none)"
        )
        return (
            f"TerminationReport[{status}] "
            f"acceptance={self.acceptance_done} "
            f"evidence={self.evidence_attached} "
            f"cross_validated={self.cross_validated} "
            f"no_dangling={self.no_dangling_ownership} "
            f"vision={self.vision_converged} "
            f"missing=[{missing_str}]"
        )


class TeamActState(BaseModel):
    """TeamAct 六步循环状态机。

    对应 roleagent.md §2.1 团队主循环：
        State → Owner → Action → Evidence → Verdict → Route → State（下一轮）

    关键不变量（F002 §2.3）：
        1. TeamAct 状态必须持久化（Durable State Surfaces, F008）
        2. 交接胶囊是协议层硬要求（不是可选礼貌）
        3. 跨厂商 review 不能被 proxy 替代（"CI 通过"≠"愿景对齐"）
        4. 五项终止条件缺一不可

    Attributes:
        current_step: 当前 TeamAct 步骤（默认 STATE）。
        task_id: 当前任务标识。
        ball_holder: 当前持球Forgekin标识（None 表示无人持球）。
        history: 历史记录列表（每次 advance/pass_ball/escalate 追加一条）。
        capsules: 交接胶囊列表（协议层硬要求）。
        termination_status: 五项终止条件报告。
        ball_status: 当前持球状态。
        iteration: 当前循环轮数（每完成一个 ROUTE → STATE 周期 +1）。
    """

    current_step: TeamActStep = Field(
        default=TeamActStep.STATE, description="当前 TeamAct 步骤"
    )
    task_id: str = Field(..., description="当前任务标识")
    ball_holder: Optional[str] = Field(
        default=None, description="当前持球Forgekin"
    )
    history: list[HistoryEntry] = Field(
        default_factory=list, description="历史记录列表"
    )
    capsules: list[HandoffCapsule] = Field(
        default_factory=list, description="交接胶囊列表"
    )
    termination_status: TerminationReport = Field(
        default_factory=TerminationReport,
        description="五项终止条件报告",
    )
    ball_status: BallStatus = Field(
        default=BallStatus.HELD, description="当前持球状态"
    )
    iteration: int = Field(default=0, description="循环轮数")

    # ── 状态推进 ──────────────────────────────────────────────────

    def advance(self, action: str = "", evidence: str = "") -> TeamActStep:
        """推进到下一步。

        记录当前步骤的 action 和 evidence 到 history，然后将 current_step
        推进到六步循环的下一步（STATE → OWNER → ACTION → EVIDENCE →
        VERDICT → ROUTE → STATE）。

        当从 ROUTE 推进到 STATE 时，iteration +1（完成一轮循环）。

        Args:
            action: 当前步骤执行的动作描述。
            evidence: 产出证据（commit / 测试 / trace ID）。

        Returns:
            推进后的新步骤。
        """
        # 记录历史
        entry = HistoryEntry(
            step=self.current_step,
            action=action,
            evidence=evidence,
            agent=self.ball_holder,
            ball_status=self.ball_status,
        )
        self.history.append(entry)

        # 如果在 EVIDENCE 步骤产出了证据，标记 evidence_attached
        if self.current_step == TeamActStep.EVIDENCE and evidence:
            self.termination_status.evidence_attached = True

        # 推进到下一步
        prev_step = self.current_step
        self.current_step = self.current_step.next()

        # ROUTE → STATE 表示完成一轮循环
        if prev_step == TeamActStep.ROUTE:
            self.iteration += 1

        logger.debug(
            f"TeamAct advance: {prev_step.value} → {self.current_step.value} "
            f"(task={self.task_id} iter={self.iteration})"
        )
        return self.current_step

    # ── 终止检查 ──────────────────────────────────────────────────

    def check_termination(self) -> TerminationReport:
        """检查五项终止条件。

        重新评估可从状态自动推导的条件，并返回最新的 TerminationReport。
        可自动推导的条件：
            - evidence_attached: history 中存在非空 evidence
            - no_dangling_ownership: 所有胶囊的 open_questions 均为空
        需显式标记的条件：
            - acceptance_done: 由验证逻辑显式标记
            - cross_validated: 由跨 agent review 显式标记
            - vision_converged: 由 CVO 确认显式标记

        Returns:
            更新后的 TerminationReport（同时更新 self.termination_status）。
        """
        # 自动推导 evidence_attached
        has_evidence = any(entry.evidence for entry in self.history)
        if has_evidence:
            self.termination_status.evidence_attached = True

        # 自动推导 no_dangling_ownership
        # 所有胶囊的 open_questions 均为空，且至少有一个胶囊
        if self.capsules:
            all_resolved = all(
                len(cap.open_questions) == 0 for cap in self.capsules
            )
            if all_resolved:
                self.termination_status.no_dangling_ownership = True

        logger.debug(
            f"Termination check: {self.termination_status.to_summary()}"
        )
        return self.termination_status

    def is_terminated(self) -> bool:
        """快捷方法：检查是否已终止。"""
        return self.termination_status.is_terminated()

    def mark_termination(
        self, condition: TerminationCondition, met: bool = True
    ) -> None:
        """标记单个终止条件的状态。

        用于显式标记需人工/外部判断的条件（acceptance_done /
        cross_validated / vision_converged）。

        Args:
            condition: 终止条件枚举值。
            met: True 表示已满足。
        """
        self.termination_status.mark(condition, met)

    # ── 传球 ─────────────────────────────────────────────────────

    def pass_ball(
        self, to_agent: str, capsule: HandoffCapsule
    ) -> bool:
        """传球 — 将球权转交给下一个Forgekin。

        交接胶囊是协议层硬要求（roleagent.md §2.3），传球时必须附带胶囊。
        胶囊的 to_agent 必须与 to_agent 参数一致，且胶囊必须通过 is_valid() 校验。

        Args:
            to_agent: 接收球的Forgekin标识。
            capsule: 交接胶囊（协议层硬要求）。

        Returns:
            True 表示传球成功，False 表示胶囊无效（不匹配/不完整）。
        """
        # 校验胶囊
        if not capsule.is_valid():
            logger.warning(
                f"Pass ball rejected: invalid capsule {capsule.capsule_id}"
            )
            return False

        # 校验胶囊目标一致性
        if capsule.to_agent != to_agent:
            logger.warning(
                f"Pass ball rejected: capsule.to_agent={capsule.to_agent} "
                f"!= to_agent={to_agent}"
            )
            return False

        # 记录胶囊
        self.capsules.append(capsule)

        # 更新持球者
        prev_holder = self.ball_holder
        self.ball_holder = to_agent
        self.ball_status = BallStatus.PASSED

        # 记录历史
        self.history.append(
            HistoryEntry(
                step=self.current_step,
                action=f"pass_ball: {prev_holder} → {to_agent}",
                evidence=capsule.capsule_id,
                agent=prev_holder,
                ball_status=BallStatus.PASSED,
            )
        )

        logger.info(
            f"Ball passed: {prev_holder} → {to_agent} "
            f"(capsule={capsule.capsule_id})"
        )
        return True

    # ── 升级 ─────────────────────────────────────────────────────

    def escalate(self, to_cvo: bool = True) -> None:
        """升级给首席愿景官（CVO）。

        当Forgekin无法完成任务或愿景方向不明确时，升级给 CVO。
        CVO 的确认是五项终止条件之一（vision_converged），不能被 proxy 替代
        （roleagent.md §2.2 第 5 项）。

        Args:
            to_cvo: True 表示升级给 CVO，False 表示升级给 operator。
        """
        target = CVO_AGENT_ID if to_cvo else "operator"
        prev_holder = self.ball_holder
        self.ball_holder = target
        self.ball_status = BallStatus.ESCALATED

        # 记录历史
        self.history.append(
            HistoryEntry(
                step=self.current_step,
                action=f"escalate: {prev_holder} → {target}",
                evidence="",
                agent=prev_holder,
                ball_status=BallStatus.ESCALATED,
            )
        )

        logger.warning(
            f"Escalated: {prev_holder} → {target} (task={self.task_id})"
        )

    # ── 摘要 ─────────────────────────────────────────────────────

    def to_summary(self) -> str:
        """生成状态机摘要。"""
        return (
            f"TeamActState[task={self.task_id}] "
            f"step={self.current_step.value} "
            f"holder={self.ball_holder or '(none)'} "
            f"ball={self.ball_status.value} "
            f"iter={self.iteration} "
            f"capsules={len(self.capsules)} "
            f"history={len(self.history)} "
            f"terminated={self.is_terminated()}"
        )

    def get_open_questions(self) -> list[str]:
        """收集所有胶囊中的开放问题。

        用于检查 no_dangling_ownership 终止条件。
        """
        return [
            q for cap in self.capsules for q in cap.open_questions
        ]

    def has_evidence(self) -> bool:
        """检查历史中是否存在证据。"""
        return any(entry.evidence for entry in self.history)

    # ── 序列化辅助 ─────────────────────────────────────────────────

    def to_dict(self) -> dict[str, Any]:
        """转为普通字典（用于持久化 / API 响应）。"""
        return self.model_dump(mode="json")

    async def snapshot(self) -> dict[str, Any]:
        """生成异步快照（供持久化层调用）。

        铁律 6：async I/O。后续集成 Durable State Surfaces (F008) 时
        通过 Repository 层持久化此快照。

        Returns:
            可序列化的状态快照字典。
        """
        return self.model_dump(mode="json")
