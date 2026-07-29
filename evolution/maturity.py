"""Five-level knowledge maturity ladder.

| Level | Form | Promotion | Demotion/Freeze |
|-------|------|-----------|-----------------|
| L0 Episode | raw record | template complete, separated transferable/non | n/a |
| L1 Pattern | draft | ≥2 similar episodes (180 days), 5Q ≥7/10 | one-off → rejected |
| L2 Draft | Method Card / Skill Draft | smoke 3 (≥2/3) + promotion 5 (≥3/5, 3 categories) | last 3 <50% → L1 |
| L3 Validated | formal method/skill | ≥6 uses, ≥2 agents, ≥80%, no critical breach | last 5 <60% → L2 |
| L4 Standard | team standard | ≥12 uses, last 10 ≥90%, user approved | 1 high-risk breach → freeze |

Long-tail lane: long_tail=True allows staying at L2/L3 (high-risk/low-frequency domains).
"""

from __future__ import annotations

from flowforge.core.tracing import get_logger
from flowforge.evolution.models import KnowledgeMaturityLevel

logger = get_logger("flowforge.evolution.maturity")

_L1_PROMOTION_MIN_EPISODES = 2
_L1_EPISODE_WINDOW_DAYS = 180
_L1_FIVE_Q_THRESHOLD = 7

_L2_SMOKE_CASES = 3
_L2_SMOKE_PASS_THRESHOLD = 2
_L2_PROMOTION_CASES = 5
_L2_PROMOTION_PASS_THRESHOLD = 3
_L2_PROMOTION_CATEGORY_COVERAGE = 3

_L3_MIN_USES = 6
_L3_MIN_AGENTS = 2
_L3_MIN_SUCCESS_RATE = 0.80

_L4_MIN_USES = 12
_L4_RECENT_WINDOW = 10
_L4_RECENT_SUCCESS_RATE = 0.90

_L2_DEMOTION_WINDOW = 3
_L2_DEMOTION_SUCCESS_RATE = 0.50
_L3_DEMOTION_WINDOW = 5
_L3_DEMOTION_SUCCESS_RATE = 0.60


class KnowledgeMaturityLadder:
    """Pure-functional promotion / demotion / freeze decisions.

    Methods return new level or None; they never mutate the knowledge object.
    """

    def check_promotion(
        self,
        knowledge_id: str,
        current_level: KnowledgeMaturityLevel,
        usage_data: dict,
    ) -> KnowledgeMaturityLevel | None:
        next_level = self._next_level(current_level)
        if next_level is None:
            logger.debug(f"maturity: {knowledge_id} at {current_level.value} (top), no promotion")
            return None
        promoted = self._check_promotion_rules(current_level, next_level, usage_data)
        if promoted:
            logger.info(
                f"maturity promotion: {knowledge_id} {current_level.value} -> {next_level.value}"
            )
            return next_level
        logger.debug(f"maturity: {knowledge_id} {current_level.value} -> {next_level.value} NOT met")
        return None

    def check_demotion(
        self,
        knowledge_id: str,
        current_level: KnowledgeMaturityLevel,
        recent_performance: list[bool],
    ) -> KnowledgeMaturityLevel | None:
        prev_level = self._prev_level(current_level)
        if prev_level is None:
            logger.debug(f"maturity: {knowledge_id} at {current_level.value} (bottom), no demotion")
            return None
        demoted = self._check_demotion_rules(current_level, recent_performance)
        if demoted:
            logger.info(
                f"maturity demotion: {knowledge_id} {current_level.value} -> {prev_level.value}"
            )
            return prev_level
        return None

    def check_freeze(
        self,
        knowledge_id: str,
        current_level: KnowledgeMaturityLevel,
        high_risk_breach: bool,
    ) -> bool:
        if current_level != KnowledgeMaturityLevel.L4_STANDARD:
            return False
        if high_risk_breach:
            logger.warning(f"maturity FREEZE: {knowledge_id} L4 high-risk breach -> freeze")
            return True
        return False

    # ---- promotion rules ----

    def _check_promotion_rules(
        self,
        current: KnowledgeMaturityLevel,
        target: KnowledgeMaturityLevel,
        data: dict,
    ) -> bool:
        if current == KnowledgeMaturityLevel.L0_EPISODE:
            return self._check_l0_to_l1(data)
        if current == KnowledgeMaturityLevel.L1_PATTERN:
            return self._check_l1_to_l2(data)
        if current == KnowledgeMaturityLevel.L2_DRAFT:
            return self._check_l2_to_l3(data)
        if current == KnowledgeMaturityLevel.L3_VALIDATED:
            return self._check_l3_to_l4(data)
        return False

    def _check_l0_to_l1(self, data: dict) -> bool:
        if data.get("is_one_off", False):
            return False
        if data.get("human_requested", False):
            return True
        return (
            data.get("episodes_count", 0) >= _L1_PROMOTION_MIN_EPISODES
            and data.get("episode_window_days", 0) <= _L1_EPISODE_WINDOW_DAYS
            and data.get("five_q_score", 0) >= _L1_FIVE_Q_THRESHOLD
        )

    def _check_l1_to_l2(self, data: dict) -> bool:
        return (
            data.get("smoke_cases", 0) >= _L2_SMOKE_CASES
            and data.get("smoke_passed", 0) >= _L2_SMOKE_PASS_THRESHOLD
            and data.get("promotion_cases", 0) >= _L2_PROMOTION_CASES
            and data.get("promotion_passed", 0) >= _L2_PROMOTION_PASS_THRESHOLD
            and data.get("promotion_categories", 0) >= _L2_PROMOTION_CATEGORY_COVERAGE
        )

    def _check_l2_to_l3(self, data: dict) -> bool:
        return (
            data.get("uses_count", 0) >= _L3_MIN_USES
            and data.get("agents_count", 0) >= _L3_MIN_AGENTS
            and data.get("success_rate", 0.0) >= _L3_MIN_SUCCESS_RATE
            and not data.get("has_critical_breach", False)
        )

    def _check_l3_to_l4(self, data: dict) -> bool:
        if data.get("long_tail", False):
            return False
        recent_total = data.get("recent_total", 0)
        recent_rate = (
            data.get("recent_success_count", 0) / recent_total if recent_total > 0 else 0.0
        )
        return (
            data.get("uses_count", 0) >= _L4_MIN_USES
            and recent_total >= _L4_RECENT_WINDOW
            and recent_rate >= _L4_RECENT_SUCCESS_RATE
            and data.get("user_approved", False)
        )

    # ---- demotion rules ----

    def _check_demotion_rules(
        self,
        current: KnowledgeMaturityLevel,
        recent_performance: list[bool],
    ) -> bool:
        if current == KnowledgeMaturityLevel.L2_DRAFT:
            return self._check_l2_demotion(recent_performance)
        if current == KnowledgeMaturityLevel.L3_VALIDATED:
            return self._check_l3_demotion(recent_performance)
        return False

    def _check_l2_demotion(self, recent: list[bool]) -> bool:
        window = recent[-_L2_DEMOTION_WINDOW:]
        if len(window) < _L2_DEMOTION_WINDOW:
            return False
        rate = sum(1 for x in window if x) / len(window)
        return rate < _L2_DEMOTION_SUCCESS_RATE

    def _check_l3_demotion(self, recent: list[bool]) -> bool:
        window = recent[-_L3_DEMOTION_WINDOW:]
        if len(window) < _L3_DEMOTION_WINDOW:
            return False
        rate = sum(1 for x in window if x) / len(window)
        return rate < _L3_DEMOTION_SUCCESS_RATE

    # ---- ladder navigation ----

    def _next_level(self, level: KnowledgeMaturityLevel) -> KnowledgeMaturityLevel | None:
        order = [
            KnowledgeMaturityLevel.L0_EPISODE,
            KnowledgeMaturityLevel.L1_PATTERN,
            KnowledgeMaturityLevel.L2_DRAFT,
            KnowledgeMaturityLevel.L3_VALIDATED,
            KnowledgeMaturityLevel.L4_STANDARD,
        ]
        try:
            idx = order.index(level)
        except ValueError:
            return None
        if idx + 1 >= len(order):
            return None
        return order[idx + 1]

    def _prev_level(self, level: KnowledgeMaturityLevel) -> KnowledgeMaturityLevel | None:
        order = [
            KnowledgeMaturityLevel.L0_EPISODE,
            KnowledgeMaturityLevel.L1_PATTERN,
            KnowledgeMaturityLevel.L2_DRAFT,
            KnowledgeMaturityLevel.L3_VALIDATED,
            KnowledgeMaturityLevel.L4_STANDARD,
        ]
        try:
            idx = order.index(level)
        except ValueError:
            return None
        if idx - 1 < 0:
            return None
        return order[idx - 1]
