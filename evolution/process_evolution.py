"""Mode B: Process Evolution — propose process improvements when errors repeat.

Triggers (any):
1. Memory holds ≥2 same-kind errors
2. User corrects a generalizable behavior
3. SOP execution finds missing guidance
4. Review identifies systemic (non-case) issue

Proposal lifecycle: proposed → accepted (linked to commit) → 30-day replay check

Hard guardrails:
1. ≥2 evidence sources
2. Minimal-leverage priority
3. Fix current behavior before proposing improvement
4. Proposal is short (5-slot template, no long-form reflection)
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from flowforge.core.tracing import get_logger
from flowforge.evolution.models import EvolutionProposal

logger = get_logger("flowforge.evolution.process_evolution")

# Minimal-leverage order — smaller index = lighter touch
_LEVERAGE_ORDER: list[str] = [
    "recite_scope",  # 复述 scope
    "memory",  # 改 memory
    "skill",  # 改单 skill
    "sop",  # 改 SOP/shared-rules
    "rule",  # 改 rule (shared-rules)
    "system_prompt",  # 改 SystemPromptBuilder
    "l0",  # 改 L0（最重）
]

_VALID_TRIGGER_TYPES = {"repeated_error", "user_correction", "sop_gap", "review_systemic"}
MIN_EVIDENCE_SOURCES = 2


class ProcessEvolution:
    """Mode B — process improvement proposal manager."""

    def __init__(self) -> None:
        self._proposals: list[EvolutionProposal] = []

    def detect_trigger(
        self,
        error_history: list[dict],
        user_corrections: list[dict],
        sop_gaps: list[str],
        review_findings: list[dict],
    ) -> str | None:
        """Return trigger type or None. Priority: repeated_error > user_correction > sop_gap > review_systemic."""
        if len(error_history) >= 2:
            logger.info(f"process_evolution trigger: repeated_error (count={len(error_history)})")
            return "repeated_error"
        generalizable = [c for c in user_corrections if c.get("generalizable", False)]
        if generalizable:
            logger.info(f"process_evolution trigger: user_correction (count={len(generalizable)})")
            return "user_correction"
        if sop_gaps:
            logger.info(f"process_evolution trigger: sop_gap (count={len(sop_gaps)})")
            return "sop_gap"
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
        if trigger_type not in _VALID_TRIGGER_TYPES:
            raise ValueError(
                f"Invalid trigger_type {trigger_type!r}, must be one of {_VALID_TRIGGER_TYPES}"
            )
        proposal = EvolutionProposal(
            proposal_id=f"pe-{uuid.uuid4().hex[:12]}",
            trigger_type=trigger_type,  # type: ignore[arg-type]
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
        errors: list[str] = []
        if len(proposal.evidence) < MIN_EVIDENCE_SOURCES:
            errors.append(
                f"evidence sources {len(proposal.evidence)} < minimum {MIN_EVIDENCE_SOURCES}"
            )
        for slot_name, slot_val in [
            ("trigger", proposal.trigger),
            ("root_cause", proposal.root_cause),
            ("lever", proposal.lever),
            ("verify", proposal.verify),
        ]:
            if not slot_val or not slot_val.strip():
                errors.append(f"slot {slot_name!r} is empty")
        if proposal.trigger_type not in _VALID_TRIGGER_TYPES:
            errors.append(f"invalid trigger_type {proposal.trigger_type!r}")
        if proposal.lever not in _LEVERAGE_ORDER:
            errors.append(f"lever {proposal.lever!r} not in leverage order {_LEVERAGE_ORDER}")
        return (len(errors) == 0, errors)

    def get_minimal_leverage(self, target_options: list[str]) -> str:
        """Return the lightest (smallest index) lever; fallback to 'l0'."""
        if not target_options:
            return "l0"
        ranked = sorted(
            target_options,
            key=lambda t: _LEVERAGE_ORDER.index(t) if t in _LEVERAGE_ORDER else len(_LEVERAGE_ORDER),
        )
        return ranked[0]

    def accept_proposal(self, proposal_id: str, commit_ref: str) -> EvolutionProposal | None:
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
                proposal.accepted_at = datetime.now(timezone.utc)
                proposal.commit_ref = commit_ref
                logger.info(
                    f"process_evolution proposal accepted: id={proposal_id}, commit={commit_ref}"
                )
                return proposal
        logger.warning(f"process_evolution accept: proposal {proposal_id} not found")
        return None

    def schedule_replay_check(self, proposal_id: str, days: int = 30) -> datetime | None:
        for proposal in self._proposals:
            if proposal.proposal_id == proposal_id:
                proposal.replay_check_due = datetime.now(timezone.utc) + timedelta(days=days)
                logger.info(
                    f"process_evolution replay check scheduled: id={proposal_id}, "
                    f"due={proposal.replay_check_due.isoformat()}"
                )
                return proposal.replay_check_due
        logger.warning(f"process_evolution schedule_replay: proposal {proposal_id} not found")
        return None

    def get_proposals(self, status: str | None = None) -> list[EvolutionProposal]:
        if status is None:
            return list(self._proposals)
        return [p for p in self._proposals if p.status == status]

    def get_due_replay_checks(self) -> list[EvolutionProposal]:
        now = datetime.now(timezone.utc)
        return [
            p
            for p in self._proposals
            if p.replay_check_due is not None and p.replay_check_due <= now and p.status == "accepted"
        ]
