"""ForgeMindEngine — unified entry for the three evolution modes.

Three modes (see arch.md §5):
- Mode A (ScopeGuard): defensive — prevents scope drift / magic-word halt
- Mode B (ProcessEvolution): improvement — proposes process changes on repeated errors
- Mode C (KnowledgeEvolution): growth — distills knowledge into reusable methods

Engine lifecycle:
1. evaluate(context) → returns EvolutionDecision describing what to do
2. execute(decision) → carries out the action, persists side-effects

The engine is the only place that touches all three modes; callers should
never invoke the mode classes directly (boundary铁律).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Literal

from flowforge.core.tracing import get_logger
from flowforge.evolution.knowledge_evolution import KnowledgeEvolution
from flowforge.evolution.maturity import KnowledgeMaturityLadder
from flowforge.evolution.metacognition import MetacognitionRouter
from flowforge.evolution.models import (
    EvolutionProposal,
    KnowledgeMaturityLevel,
    KnowledgeObject,
    ScopeGuardLog,
    ScopeGuardSignal,
)
from flowforge.evolution.process_evolution import ProcessEvolution
from flowforge.evolution.scope_guard import ScopeGuard

logger = get_logger("flowforge.evolution.engine")


@dataclass(frozen=True)
class EvolutionContext:
    """Inputs handed to evaluate()."""

    instruction: str
    action_description: str
    scope_baseline: str
    is_high_risk: bool = False
    authorized: bool = True
    error_history: list[dict] = field(default_factory=list)
    user_corrections: list[dict] = field(default_factory=list)
    sop_gaps: list[str] = field(default_factory=list)
    review_findings: list[dict] = field(default_factory=list)
    knowledge_signal: dict[str, Any] | None = None
    domain_stats: dict[str, int] = field(default_factory=dict)  # {successes, trials}
    evidence_completeness: float = 0.0
    self_reported_confidence: float = 0.0


@dataclass(frozen=True)
class EvolutionDecision:
    """Output of evaluate(). Carries the routing verdict + structured actions."""

    decision_id: str
    mode: Literal["A_scope_guard", "B_process_evolution", "C_knowledge_evolution", "none"]
    metacognition_route: Literal["proceed", "structured_analysis_only", "escalate"]
    action_confidence: float
    scope_signal: ScopeGuardSignal | None = None
    proposal: EvolutionProposal | None = None
    distill_decision: bool = False
    reason: str = ""
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))


class ForgeMindEngine:
    """Unified self-evolution engine — coordinates all three modes.

    Usage:
        engine = ForgeMindEngine(scope_baseline="...")
        decision = await engine.evaluate(ctx)
        if decision.mode != "none":
            await engine.execute(decision)
    """

    def __init__(
        self,
        scope_baseline: str,
        scope_guard: ScopeGuard | None = None,
        process_evolution: ProcessEvolution | None = None,
        knowledge_evolution: KnowledgeEvolution | None = None,
        maturity_ladder: KnowledgeMaturityLadder | None = None,
        metacognition: MetacognitionRouter | None = None,
    ) -> None:
        self.scope_guard = scope_guard or ScopeGuard(scope_baseline=scope_baseline)
        self.process_evolution = process_evolution or ProcessEvolution()
        self.knowledge_evolution = knowledge_evolution or KnowledgeEvolution()
        self.maturity_ladder = maturity_ladder or KnowledgeMaturityLadder()
        self.metacognition = metacognition or MetacognitionRouter()
        self._executions: list[dict] = []

    async def evaluate(self, ctx: EvolutionContext) -> EvolutionDecision:
        """Decide what (if anything) to do. Pure: no side effects."""
        # --- Mode A: scope guard (always evaluated first) ---
        scope_signal = self.scope_guard.detect(
            instruction=ctx.instruction,
            action_description=ctx.action_description,
            is_high_risk=ctx.is_high_risk,
            authorized=ctx.authorized,
        )

        # --- Metacognition routing ---
        successes = ctx.domain_stats.get("successes", 0)
        trials = ctx.domain_stats.get("trials", 0)
        if ctx.is_high_risk and trials > 0:
            domain_reliability = self.metacognition.compute_wilson_lower_bound(successes, trials)
        else:
            domain_reliability = self.metacognition.compute_domain_reliability(successes, trials)
        meta = self.metacognition.route_confidence(
            domain_reliability=domain_reliability,
            evidence_completeness=ctx.evidence_completeness,
            self_reported=ctx.self_reported_confidence,
            is_high_risk=ctx.is_high_risk,
        )

        # --- Mode B: process evolution ---
        trigger_type = self.process_evolution.detect_trigger(
            error_history=ctx.error_history,
            user_corrections=ctx.user_corrections,
            sop_gaps=ctx.sop_gaps,
            review_findings=ctx.review_findings,
        )

        # --- Mode C: knowledge evolution ---
        distill = False
        if ctx.knowledge_signal:
            distill = self.knowledge_evolution.should_distill(
                reusability=ctx.knowledge_signal.get("reusability", False),
                non_obviousness=ctx.knowledge_signal.get("non_obviousness", False),
                decay_risk=ctx.knowledge_signal.get("decay_risk", False),
            )

        # --- Decide mode + build decision ---
        if scope_signal and scope_signal.severity == "block":
            mode: Literal["A_scope_guard", "B_process_evolution", "C_knowledge_evolution", "none"] = (
                "A_scope_guard"
            )
            reason = f"scope_guard blocked: {scope_signal.signal_type}"
        elif trigger_type is not None:
            mode = "B_process_evolution"
            reason = f"process_evolution trigger: {trigger_type}"
        elif distill:
            mode = "C_knowledge_evolution"
            reason = "knowledge_evolution: distillation criteria met"
        else:
            mode = "none"
            reason = "no trigger"

        decision = EvolutionDecision(
            decision_id=f"ed-{uuid.uuid4().hex[:12]}",
            mode=mode,
            metacognition_route=meta["route"],  # type: ignore[arg-type]
            action_confidence=meta["action_confidence"],
            scope_signal=scope_signal,
            distill_decision=distill,
            reason=reason,
        )
        logger.info(
            f"engine evaluate: id={decision.decision_id} mode={decision.mode} "
            f"route={decision.metacognition_route} confidence={decision.action_confidence:.4f}"
        )
        return decision

    async def execute(self, decision: EvolutionDecision) -> dict:
        """Carry out the decision. Returns a structured execution record."""
        record: dict[str, Any] = {
            "decision_id": decision.decision_id,
            "mode": decision.mode,
            "executed_at": datetime.now(UTC).isoformat(),
            "actions": [],
        }

        if decision.mode == "A_scope_guard":
            # Mode A: scope signal already logged by detect(); here we just confirm.
            record["actions"].append({"type": "scope_guard_log", "severity": "block"})

        elif decision.mode == "B_process_evolution":
            # Mode B: convert trigger into a skeleton proposal (caller fills evidence/root_cause).
            # The engine itself does not fabricate evidence — that would violate the
            # "evidence ≥2 sources" hard guardrail.
            record["actions"].append(
                {
                    "type": "process_proposal_skeleton",
                    "note": "caller must supply evidence/root_cause/lever/verify to create_proposal()",
                }
            )

        elif decision.mode == "C_knowledge_evolution":
            record["actions"].append(
                {"type": "knowledge_distill", "distill_decision": decision.distill_decision}
            )

        else:
            record["actions"].append({"type": "noop"})

        self._executions.append(record)
        logger.info(f"engine execute: id={decision.decision_id} actions={len(record['actions'])}")
        return record

    def promote_knowledge(
        self,
        knowledge: KnowledgeObject,
        usage_data: dict,
    ) -> KnowledgeMaturityLevel | None:
        """Apply maturity ladder promotion to a knowledge object."""
        new_level = self.maturity_ladder.check_promotion(
            knowledge_id=knowledge.knowledge_id,
            current_level=knowledge.maturity_level,
            usage_data=usage_data,
        )
        if new_level is not None:
            knowledge.maturity_level = new_level
            logger.info(
                f"engine promote_knowledge: {knowledge.knowledge_id} -> {new_level.value}"
            )
        return new_level

    def demote_knowledge(
        self,
        knowledge: KnowledgeObject,
        recent_performance: list[bool],
    ) -> KnowledgeMaturityLevel | None:
        new_level = self.maturity_ladder.check_demotion(
            knowledge_id=knowledge.knowledge_id,
            current_level=knowledge.maturity_level,
            recent_performance=recent_performance,
        )
        if new_level is not None:
            knowledge.maturity_level = new_level
            logger.info(
                f"engine demote_knowledge: {knowledge.knowledge_id} -> {new_level.value}"
            )
        return new_level

    def get_execution_history(self) -> list[dict]:
        return list(self._executions)

    def get_scope_logs(self) -> list[ScopeGuardLog]:
        return self.scope_guard.get_logs()
