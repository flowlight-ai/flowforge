"""Lower Bound Calculator — multi-gate pass probability floor.

Formula (task.md P1-7 / ADR-011):

    lower_bound = product(g.pass_probability for g in gates)
                  * min(g.threshold for g in gates if g.pass_probability > 0)

The lower bound is the probability that *all* gates pass, scaled down by the
strictest surviving threshold. If any gate has ``pass_probability == 0`` the
whole chain collapses to 0.0 (one uncrossable gate zeroes the floor). With no
gates the floor is 0.0 (no quality floor has been established).

This module is LLM-free, deterministic, and depends only on
flowforge.core (errors, tracing).
"""

from __future__ import annotations

from dataclasses import dataclass

from flowforge.core.errors import PartnershipError
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.partnership.lower_bound")


@dataclass(frozen=True)
class QualityGate:
    """One quality gate in the lower-bound chain.

    Attributes:
        gate_id: stable identifier.
        threshold: minimum quality required to pass this gate (0.0..1.0).
        pass_probability: probability a candidate survives this gate (0.0..1.0).
    """

    gate_id: str
    threshold: float
    pass_probability: float

    def __post_init__(self) -> None:
        if not self.gate_id:
            raise PartnershipError("QualityGate.gate_id must not be empty")
        if not 0.0 <= self.threshold <= 1.0:
            raise PartnershipError(
                f"threshold must be in [0.0, 1.0], got {self.threshold}"
            )
        if not 0.0 <= self.pass_probability <= 1.0:
            raise PartnershipError(
                f"pass_probability must be in [0.0, 1.0], got {self.pass_probability}"
            )


@dataclass(frozen=True)
class LowerBoundResult:
    """Output of LowerBoundCalculator.compute()."""

    lower_bound: float
    passed_gates: list[str]
    failed_gates: list[str]
    explanation: str


class LowerBoundCalculator:
    """Compute the lower bound on partnership quality across multiple gates.

    A gate "passes" if its ``pass_probability > 0``. The lower bound is the
    product of all pass probabilities multiplied by the strictest surviving
    threshold. If any gate has ``pass_probability == 0`` the chain collapses
    to 0.0 and that gate is reported in ``failed_gates``.
    """

    def compute(self, gates: list[QualityGate]) -> LowerBoundResult:
        """Return the lower bound plus the passed / failed gate ids."""
        if not gates:
            logger.info("partnership: lower_bound=0.0000 (no gates)")
            return LowerBoundResult(
                lower_bound=0.0,
                passed_gates=[],
                failed_gates=[],
                explanation="no gates provided",
            )

        passed: list[str] = []
        failed: list[str] = []
        for g in gates:
            if g.pass_probability > 0.0:
                passed.append(g.gate_id)
            else:
                failed.append(g.gate_id)

        if failed:
            # Any zero-probability gate collapses the whole chain.
            logger.info(
                f"partnership: lower_bound=0.0000 failed_gates={failed}"
            )
            explanation = (
                f"chain collapsed: gates with zero pass_probability={failed}"
            )
            return LowerBoundResult(
                lower_bound=0.0,
                passed_gates=passed,
                failed_gates=failed,
                explanation=explanation,
            )

        # All gates survive → product of probabilities × strictest threshold.
        product = 1.0
        for g in gates:
            product *= g.pass_probability
        surviving_thresholds = [g.threshold for g in gates]
        strictest = min(surviving_thresholds)
        lower_bound = product * strictest

        explanation = (
            f"product of {len(gates)} pass_probabilities × "
            f"strictest threshold {strictest:.4f} = {lower_bound:.4f}"
        )
        logger.info(
            f"partnership: lower_bound={lower_bound:.4f} "
            f"gates={len(gates)} strictest_threshold={strictest:.4f}"
        )
        return LowerBoundResult(
            lower_bound=lower_bound,
            passed_gates=passed,
            failed_gates=failed,
            explanation=explanation,
        )
