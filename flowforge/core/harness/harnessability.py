"""Harnessability — score how well a harness is wired (roleagent.md Ch.7).

Layer 7 of the Harness seven-layer guardrail. A single 0..1 score summarizes
whether all six lower layers are present and tight. Weights sum to 1.0:

    durable_state  0.20
    tool_allowlist 0.20
    evidence       0.20
    governance     0.15
    magic_word     0.15
    entropy        0.10

``governance_rule_count`` is a raw integer count saturated at
``GOVERNANCE_FULL_RULE_COUNT`` (5 rules = full governance score).
"""

from __future__ import annotations

from dataclasses import dataclass

from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.harness.harnessability")

__all__ = ["HarnessabilityFactors", "HarnessabilityScorer"]

# Weights — sum to 1.0
WEIGHT_DURABLE_STATE = 0.20
WEIGHT_TOOL_ALLOWLIST = 0.20
WEIGHT_EVIDENCE = 0.20
WEIGHT_GOVERNANCE = 0.15
WEIGHT_MAGIC_WORD = 0.15
WEIGHT_ENTROPY = 0.10

# Saturation threshold: 5 governance rules == full governance score.
GOVERNANCE_FULL_RULE_COUNT = 5


@dataclass
class HarnessabilityFactors:
    """Inputs to the harnessability score.

    All float fields are expected in [0.0, 1.0]. ``governance_rule_count`` is
    a raw integer count (saturated at ``GOVERNANCE_FULL_RULE_COUNT``).
    """

    durable_state_coverage: float
    tool_allowlist_strictness: float
    evidence_completeness: float
    governance_rule_count: int
    magic_word_coverage: float
    entropy_cleanup_rate: float


class HarnessabilityScorer:
    """Weighted-average scorer + letter grader."""

    def score(self, factors: HarnessabilityFactors) -> float:
        gov_score = min(
            factors.governance_rule_count / GOVERNANCE_FULL_RULE_COUNT, 1.0
        )
        total = (
            factors.durable_state_coverage * WEIGHT_DURABLE_STATE
            + factors.tool_allowlist_strictness * WEIGHT_TOOL_ALLOWLIST
            + factors.evidence_completeness * WEIGHT_EVIDENCE
            + gov_score * WEIGHT_GOVERNANCE
            + factors.magic_word_coverage * WEIGHT_MAGIC_WORD
            + factors.entropy_cleanup_rate * WEIGHT_ENTROPY
        )
        # Clamp to [0.0, 1.0] to defend against out-of-range inputs.
        total = max(0.0, min(1.0, total))
        logger.info(f"harness: harnessability score={total:.4f}")
        return total

    def grade(self, score: float) -> str:
        """Map a 0..1 score to a letter grade (A/B/C/D/F)."""
        if score >= 0.9:
            return "A"
        if score >= 0.8:
            return "B"
        if score >= 0.6:
            return "C"
        if score >= 0.4:
            return "D"
        return "F"
