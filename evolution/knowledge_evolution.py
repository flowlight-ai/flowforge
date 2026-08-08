"""Mode C: Knowledge Evolution — distill valuable knowledge into reusable methods.

Three mechanisms:
1. Episode Card — structured snapshot of high-value collaboration (L0)
2. Dual Distillation — Episode → Method Card or Skill Draft (L1→L2)
3. Eval Ledger — Replay A/B to validate net gain (gates promotion)

Trigger (any):
- Deep research produced cross-scenario reusable knowledge
- Domain discussion formed transferable analysis methodology
- Cross-domain collaboration revealed reusable collaboration pattern
- User said "this is worth remembering"

Three-question filter (≥2 of 3 to distill):
- Reusability — will it recur in similar future scenarios?
- Non-obviousness — hard to derive from scratch?
- Decay risk — without writing it down, will we forget?
"""

from __future__ import annotations

import uuid

from flowforge.core.tracing import get_logger
from flowforge.evolution.models import EpisodeCard, EvalLedger, MethodCard

logger = get_logger("flowforge.evolution.knowledge_evolution")

SMOKE_GATE_CASES = 3
SMOKE_GATE_PASS_THRESHOLD = 2
PROMOTION_GATE_CASES = 5
PROMOTION_GATE_PASS_THRESHOLD = 3
PROMOTION_GATE_CATEGORY_COVERAGE = 3  # 标准成功 / 边界应升级 / 冲突反例

DISTILL_MIN_CRITERIA = 2
_CASE_REQUIRED_FIELDS = {"case_id", "category", "passed"}


class KnowledgeEvolution:
    """Mode C — knowledge distillation + validation."""

    def __init__(self) -> None:
        self._episodes: list[EpisodeCard] = []
        self._methods: list[MethodCard] = []
        self._evals: list[EvalLedger] = []

    def should_distill(
        self,
        reusability: bool,
        non_obviousness: bool,
        decay_risk: bool,
    ) -> bool:
        score = sum([bool(reusability), bool(non_obviousness), bool(decay_risk)])
        decision = score >= DISTILL_MIN_CRITERIA
        logger.debug(
            f"knowledge_evolution should_distill: score={score}/3 distill={decision}"
        )
        return decision

    def create_episode_card(
        self,
        task_snapshot: str,
        evidence_map: dict,
        decision_timeline: list[dict],
        collaboration_pivots: list[dict],
        transferable_method: str,
        non_transferable_facts: str,
        safety_boundary: str,
        distillation_direction: str = "method_card",
    ) -> EpisodeCard:
        if distillation_direction not in {"method_card", "skill_draft", "memory"}:
            raise ValueError(
                f"Invalid distillation_direction {distillation_direction!r}, "
                f"must be one of: method_card | skill_draft | memory"
            )
        episode = EpisodeCard(
            episode_id=f"ep-{uuid.uuid4().hex[:12]}",
            task_snapshot=task_snapshot,
            evidence_map=dict(evidence_map),
            decision_timeline=list(decision_timeline),
            collaboration_pivots=list(collaboration_pivots),
            transferable_method=transferable_method,
            non_transferable_facts=non_transferable_facts,
            safety_boundary=safety_boundary,
            distillation_direction=distillation_direction,  # type: ignore[arg-type]
        )
        self._episodes.append(episode)
        logger.info(
            f"knowledge_evolution episode created: id={episode.episode_id}, "
            f"direction={distillation_direction}, snapshot_len={len(task_snapshot)}"
        )
        return episode

    def distill_episode(self, episode_id: str) -> MethodCard | str:
        """Distill an Episode into a MethodCard or return direction string for non-method paths."""
        episode = self._find_episode(episode_id)
        if episode is None:
            raise ValueError(f"Episode {episode_id!r} not found")

        if episode.distillation_direction == "method_card":
            method = MethodCard(
                method_id=f"mc-{uuid.uuid4().hex[:12]}",
                title=episode.transferable_method[:80],
                domain="general",
                knowledge_type="procedural",
                scope="agent_local",
                trust_level="experimental",
                lifecycle="draft",
                content=episode.transferable_method,
                source_refs=[episode.episode_id],
                maturity_level="L2",
            )
            self._methods.append(method)
            logger.info(
                f"knowledge_evolution distilled: episode={episode_id} -> method={method.method_id}"
            )
            return method

        logger.info(
            f"knowledge_evolution distill direction: episode={episode_id} -> "
            f"{episode.distillation_direction}"
        )
        return episode.distillation_direction

    def create_eval_ledger(self, method_id: str, cases: list[dict]) -> EvalLedger:
        self._validate_cases(cases)
        ledger = EvalLedger(
            eval_id=f"ev-{uuid.uuid4().hex[:12]}",
            method_id=method_id,
            cases=list(cases),
        )
        self._evals.append(ledger)
        logger.info(
            f"knowledge_evolution eval ledger created: id={ledger.eval_id}, "
            f"method={method_id}, cases={len(cases)}"
        )
        return ledger

    def check_smoke_gate(self, eval_id: str) -> bool:
        ledger = self._find_eval(eval_id)
        if ledger is None:
            raise ValueError(f"Eval {eval_id!r} not found")
        cases = ledger.cases
        if len(cases) < SMOKE_GATE_CASES:
            logger.warning(
                f"knowledge_evolution smoke gate: eval={eval_id} cases={len(cases)} "
                f"< required {SMOKE_GATE_CASES}"
            )
            return False
        passed = sum(1 for c in cases if c.get("passed", False))
        result = passed >= SMOKE_GATE_PASS_THRESHOLD
        ledger.smoke_gate_passed = result
        logger.info(
            f"knowledge_evolution smoke gate: eval={eval_id}, passed={passed}/{len(cases)}, "
            f"threshold={SMOKE_GATE_PASS_THRESHOLD}, result={result}"
        )
        return result

    def check_promotion_gate(self, eval_id: str) -> bool:
        ledger = self._find_eval(eval_id)
        if ledger is None:
            raise ValueError(f"Eval {eval_id!r} not found")
        cases = ledger.cases
        if len(cases) < PROMOTION_GATE_CASES:
            logger.warning(
                f"knowledge_evolution promotion gate: eval={eval_id} cases={len(cases)} "
                f"< required {PROMOTION_GATE_CASES}"
            )
            return False
        passed = sum(1 for c in cases if c.get("passed", False))
        if passed < PROMOTION_GATE_PASS_THRESHOLD:
            logger.info(
                f"knowledge_evolution promotion gate: eval={eval_id} passed={passed} "
                f"< threshold {PROMOTION_GATE_PASS_THRESHOLD}"
            )
            ledger.promotion_gate_passed = False
            return False
        categories = {c.get("category") for c in cases if c.get("category")}
        if len(categories) < PROMOTION_GATE_CATEGORY_COVERAGE:
            logger.info(
                f"knowledge_evolution promotion gate: eval={eval_id} categories={categories} "
                f"< required coverage {PROMOTION_GATE_CATEGORY_COVERAGE}"
            )
            ledger.promotion_gate_passed = False
            return False
        ledger.promotion_gate_passed = True
        logger.info(
            f"knowledge_evolution promotion gate PASSED: eval={eval_id}, "
            f"passed={passed}/{len(cases)}, categories={categories}"
        )
        return True

    def get_episodes(self) -> list[EpisodeCard]:
        return list(self._episodes)

    def get_methods(self) -> list[MethodCard]:
        return list(self._methods)

    def get_evals(self) -> list[EvalLedger]:
        return list(self._evals)

    # ---- internals ----

    def _find_episode(self, episode_id: str) -> EpisodeCard | None:
        for ep in self._episodes:
            if ep.episode_id == episode_id:
                return ep
        return None

    def _find_eval(self, eval_id: str) -> EvalLedger | None:
        for ev in self._evals:
            if ev.eval_id == eval_id:
                return ev
        return None

    def _validate_cases(self, cases: list[dict]) -> None:
        if not cases:
            raise ValueError("cases must not be empty")
        for idx, c in enumerate(cases):
            missing = _CASE_REQUIRED_FIELDS - set(c.keys())
            if missing:
                raise ValueError(
                    f"case[{idx}] missing required fields: {missing} "
                    f"(required: {_CASE_REQUIRED_FIELDS})"
                )
