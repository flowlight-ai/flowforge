"""Mode B: Process Evolution — 同类错误反复出现时提出流程改进。

触发条件（任一）：
1. Memory 中同类错误 ≥ 2 次
2. 用户纠正了可泛化为规则的行为
3. SOP 执行中发现没有指引
4. Review 指出系统性问题（非个案 bug）

提案流程：写提案(5槽) → 审批 → 落地闭环(accepted→关联 commit/PR) → 30 天验证

最小杠杆排序（从轻到重）：
复述scope → 改memory → 改单skill → 改SOP/shared-rules → 改SystemPromptBuilder → 改L0

硬护栏：
1. 证据 ≥2 源
2. 最小杠杆优先
3. 先修当前，再提改进
4. 提案要短（5 槽，不写长篇反思）
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta

from flowforge.core.tracing import get_logger
from flowforge.evolution.models import EvolutionProposal

logger = get_logger("flowforge.evolution.process_evolution")

# 最小杠杆排序：索引越小越优先（越轻）
_LEVERAGE_ORDER: list[str] = [
    "recite_scope",  # 复述scope
    "memory",  # 改memory
    "skill",  # 改单skill
    "sop",  # 改SOP/shared-rules
    "rule",  # 改rule（shared-rules）
    "system_prompt",  # 改SystemPromptBuilder
    "l0",  # 改L0（最重）
]

# trigger_type 合法集合
_VALID_TRIGGER_TYPES = {"repeated_error", "user_correction", "sop_gap", "review_systemic"}

# 最小证据源数量
MIN_EVIDENCE_SOURCES = 2


class ProcessEvolution:
    """Mode B: Process Evolution — 流程改进提案管理。

    提案生命周期：proposed → accepted (关联 commit) → 30天 replay check
    """

    def __init__(self) -> None:
        self._proposals: list[EvolutionProposal] = []

    def detect_trigger(
        self,
        error_history: list[dict],
        user_corrections: list[dict],
        sop_gaps: list[str],
        review_findings: list[dict],
    ) -> str | None:
        """检测触发条件，返回触发类型或 None。

        优先级：repeated_error > user_correction > sop_gap > review_systemic
        """
        # 1. Memory 中同类错误 ≥ 2 次
        if len(error_history) >= 2:
            logger.info(f"process_evolution trigger: repeated_error (count={len(error_history)})")
            return "repeated_error"

        # 2. 用户纠正了可泛化为规则的行为
        generalizable = [c for c in user_corrections if c.get("generalizable", False)]
        if generalizable:
            logger.info(f"process_evolution trigger: user_correction (count={len(generalizable)})")
            return "user_correction"

        # 3. SOP 执行中发现没有指引
        if sop_gaps:
            logger.info(f"process_evolution trigger: sop_gap (count={len(sop_gaps)})")
            return "sop_gap"

        # 4. Review 指出系统性问题（非个案 bug）
        systemic = [f for f in review_findings if f.get("systemic", False)]
        if systemic:
            logger.info(f"process_evolution trigger: review_systemic (count={len(systemic)})")
            return "review_systemic"

        return None

    def create_proposal(
        self,
        trigger_type: str,
        trigger: str,
        evidence: list[str],
        root_cause: str,
        lever: str,
        verify: str,
        target: str = "",
    ) -> EvolutionProposal:
        """创建提案（5 槽模板）。

        五槽：Trigger / Evidence / Root Cause / Lever / Verify
        """
        if trigger_type not in _VALID_TRIGGER_TYPES:
            raise ValueError(
                f"Invalid trigger_type {trigger_type!r}, must be one of {_VALID_TRIGGER_TYPES}"
            )

        proposal = EvolutionProposal(
            proposal_id=f"pe-{uuid.uuid4().hex[:12]}",
            trigger_type=trigger_type,
            target=target or lever,
            status="proposed",
            trigger=trigger,
            evidence=list(evidence),
            root_cause=root_cause,
            lever=lever,
            verify=verify,
        )
        self._proposals.append(proposal)
        logger.info(
            f"process_evolution proposal created: id={proposal.proposal_id}, "
            f"trigger_type={trigger_type}, lever={lever}, evidence_count={len(evidence)}"
        )
        return proposal

    def validate_proposal(self, proposal: EvolutionProposal) -> tuple[bool, list[str]]:
        """验证提案（硬护栏检查）。

        硬护栏：
        1. 证据 ≥2 源
        2. 五槽均非空
        3. trigger_type 合法
        4. lever 在最小杠杆排序中
        """
        errors: list[str] = []

        # 1. 证据 ≥2 源
        if len(proposal.evidence) < MIN_EVIDENCE_SOURCES:
            errors.append(
                f"evidence sources {len(proposal.evidence)} < minimum {MIN_EVIDENCE_SOURCES}"
            )

        # 2. 五槽均非空
        for slot_name, slot_val in [
            ("trigger", proposal.trigger),
            ("root_cause", proposal.root_cause),
            ("lever", proposal.lever),
            ("verify", proposal.verify),
        ]:
            if not slot_val or not slot_val.strip():
                errors.append(f"slot {slot_name!r} is empty")

        # 3. trigger_type 合法
        if proposal.trigger_type not in _VALID_TRIGGER_TYPES:
            errors.append(f"invalid trigger_type {proposal.trigger_type!r}")

        # 4. lever 在最小杠杆排序中
        if proposal.lever not in _LEVERAGE_ORDER:
            errors.append(
                f"lever {proposal.lever!r} not in leverage order {_LEVERAGE_ORDER}"
            )

        return (len(errors) == 0, errors)

    def get_minimal_leverage(self, target_options: list[str]) -> str:
        """最小杠杆排序 — 返回最轻（索引最小）的杠杆。

        若无匹配，返回最重的 "l0"。
        """
        if not target_options:
            return "l0"
        ranked = sorted(
            target_options,
            key=lambda t: _LEVERAGE_ORDER.index(t) if t in _LEVERAGE_ORDER else len(_LEVERAGE_ORDER),
        )
        return ranked[0]

    def accept_proposal(self, proposal_id: str, commit_ref: str) -> EvolutionProposal | None:
        """接受提案并关联 commit/PR。

        accepted → 必须关联 commit/PR（硬护栏：落地闭环）。
        """
        if not commit_ref or not commit_ref.strip():
            raise ValueError("commit_ref is required to accept a proposal (落地闭环硬护栏)")

        for proposal in self._proposals:
            if proposal.proposal_id == proposal_id:
                if proposal.status != "proposed":
                    logger.warning(
                        f"process_evolution accept: proposal {proposal_id} status={proposal.status} "
                        f"(expected 'proposed')"
                    )
                    return None
                proposal.status = "accepted"
                proposal.accepted_at = datetime.utcnow()
                proposal.commit_ref = commit_ref
                logger.info(
                    f"process_evolution proposal accepted: id={proposal_id}, commit={commit_ref}"
                )
                return proposal
        logger.warning(f"process_evolution accept: proposal {proposal_id} not found")
        return None

    def schedule_replay_check(self, proposal_id: str, days: int = 30) -> datetime | None:
        """安排 N 天后的 replay check（默认 30 天）。"""
        for proposal in self._proposals:
            if proposal.proposal_id == proposal_id:
                proposal.replay_check_due = datetime.utcnow() + timedelta(days=days)
                logger.info(
                    f"process_evolution replay check scheduled: id={proposal_id}, "
                    f"due={proposal.replay_check_due.isoformat()}"
                )
                return proposal.replay_check_due
        logger.warning(f"process_evolution schedule_replay: proposal {proposal_id} not found")
        return None

    def get_proposals(self, status: str | None = None) -> list[EvolutionProposal]:
        """获取提案列表，可按 status 过滤。"""
        if status is None:
            return list(self._proposals)
        return [p for p in self._proposals if p.status == status]

    def get_due_replay_checks(self) -> list[EvolutionProposal]:
        """获取已到期的 replay check 提案。"""
        now = datetime.utcnow()
        return [
            p
            for p in self._proposals
            if p.replay_check_due is not None and p.replay_check_due <= now and p.status == "accepted"
        ]
