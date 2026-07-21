"""Upper Bound Calculator — best achievable net value across candidate paths.

Formula (task.md P1-7 / ADR-011):

    upper_bound = max(c.expected_value * c.probability - c.cost
                      for c in candidates)

The upper bound is the maximum *expected net value* achievable by committing
to the best single candidate path. It is an upper bound on what the
partnership can guarantee: reality can only be worse (we might pick a
suboptimal path, or the probability might not realize). With no candidates
the bound is 0.0 and best_path_id is None.

This module is LLM-free, deterministic, and depends only on
flowforge.core (errors, tracing).
"""

from __future__ import annotations

from dataclasses import dataclass

from flowforge.core.errors import PartnershipError
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.partnership.upper_bound")


@dataclass(frozen=True)
class CandidatePath:
    """One candidate path considered by the upper-bound formula.

    Attributes:
        path_id: stable identifier for the path.
        expected_value: gross expected value if the path succeeds (>= 0).
        probability: probability that the path succeeds (0.0..1.0).
        cost: cost paid regardless of success (>= 0).
    """

    path_id: str
    expected_value: float
    probability: float
    cost: float = 0.0

    def __post_init__(self) -> None:
        if not self.path_id:
            raise PartnershipError("CandidatePath.path_id must not be empty")
        if self.expected_value < 0.0:
            raise PartnershipError(
                f"expected_value must be >= 0.0, got {self.expected_value}"
            )
        if not 0.0 <= self.probability <= 1.0:
            raise PartnershipError(
                f"probability must be in [0.0, 1.0], got {self.probability}"
            )
        if self.cost < 0.0:
            raise PartnershipError(f"cost must be >= 0.0, got {self.cost}")

    def net_expected(self) -> float:
        """Net expected value: expected_value * probability - cost."""
        return self.expected_value * self.probability - self.cost


@dataclass(frozen=True)
class UpperBoundResult:
    """Output of UpperBoundCalculator.compute()."""

    upper_bound: float
    best_path_id: str | None
    expected_max: float
    explanation: str


class UpperBoundCalculator:
    """Compute the upper bound on partnership value across candidate paths.

    The upper bound is the maximum expected *net* value achievable by the
    best candidate path. With no candidates the bound is 0.0 and best_path_id
    is None.

    Selection: pick the candidate maximizing ``net_expected``. When two
    candidates tie on net expected value, prefer the lower-cost one (so the
    "same expected return, choose lower cost" rule holds); Python's ``max``
    then returns the first occurrence for full ties, which is deterministic.
    """

    def compute(self, candidates: list[CandidatePath]) -> UpperBoundResult:
        """Return the upper bound and the best candidate path."""
        if not candidates:
            logger.info("partnership: upper_bound=0.0000 path=None (no candidates)")
            return UpperBoundResult(
                upper_bound=0.0,
                best_path_id=None,
                expected_max=0.0,
                explanation="no candidate paths provided",
            )

        # Primary: net expected value (higher better).
        # Secondary: -cost (lower cost better on net ties).
        best = max(candidates, key=lambda c: (c.net_expected(), -c.cost))
        upper_bound = best.net_expected()
        expected_max = best.expected_value * best.probability

        explanation = (
            f"best path {best.path_id}: "
            f"expected_value={best.expected_value:.4f} "
            f"probability={best.probability:.4f} "
            f"cost={best.cost:.4f} "
            f"net={upper_bound:.4f}"
        )
        logger.info(
            f"partnership: upper_bound={upper_bound:.4f} path={best.path_id}"
        )
        return UpperBoundResult(
            upper_bound=upper_bound,
            best_path_id=best.path_id,
            expected_max=expected_max,
            explanation=explanation,
        )
