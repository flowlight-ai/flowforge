"""Variance Absorber — internal cost volatility vs user collapse threshold.

The partnership absorbs a fraction of internal cost variance so the user only
sees the residual volatility. If the residual exceeds the user's collapse
threshold the user "collapses" (gives up / loses trust) and the absorber
recommends increasing the absorption ratio.

Formula (task.md P1-7 / ADR-011):

    internal_variance  = pvariance(prices)
    absorbed_variance  = absorption_ratio * internal_variance
    passed_to_user     = (1 - absorption_ratio) * internal_variance
    user_would_collapse = passed_to_user > user_collapse_threshold

This module is LLM-free, deterministic, and depends only on
flowforge.core (errors, tracing). Population variance is computed with the
standard library ``statistics`` module (no numpy / scipy).
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass

from flowforge.core.errors import PartnershipError
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.partnership.variance_absorption")

DEFAULT_ABSORPTION_RATIO = 0.7


@dataclass(frozen=True)
class AbsorptionResult:
    """Output of VarianceAbsorber.compute_absorption().

    Attributes:
        absorbed_variance: variance absorbed internally by the partnership.
        passed_to_user: residual variance passed on to the user.
        user_would_collapse: True if the residual exceeds the user's threshold.
        recommendation: human-readable action recommendation.
    """

    absorbed_variance: float
    passed_to_user: float
    user_would_collapse: bool
    recommendation: str


class VarianceAbsorber:
    """Absorb internal cost variance so the user sees a dampened signal.

    The absorber takes a list of observed prices (e.g. per-task token cost
    over a window), computes their population variance, keeps an
    ``absorption_ratio`` fraction internally, and passes the rest to the user.
    If the user-facing residual exceeds ``user_collapse_threshold`` the user
    is deemed to collapse and the absorber recommends raising the ratio.
    """

    def __init__(self, absorption_ratio: float = DEFAULT_ABSORPTION_RATIO) -> None:
        if not 0.0 <= absorption_ratio <= 1.0:
            raise PartnershipError(
                f"absorption_ratio must be in [0.0, 1.0], got {absorption_ratio}"
            )
        self._ratio = absorption_ratio

    @property
    def absorption_ratio(self) -> float:
        """Configured absorption ratio in [0.0, 1.0]."""
        return self._ratio

    def compute_absorption(
        self,
        prices: list[float],
        user_collapse_threshold: float,
    ) -> AbsorptionResult:
        """Compute how much variance is absorbed vs passed to the user."""
        if user_collapse_threshold < 0.0:
            raise PartnershipError(
                f"user_collapse_threshold must be >= 0.0, "
                f"got {user_collapse_threshold}"
            )

        # Population variance of 0 or 1 samples is 0 → nothing to absorb.
        internal_variance = (
            statistics.pvariance(prices) if len(prices) >= 2 else 0.0
        )

        absorbed = self._ratio * internal_variance
        passed = (1.0 - self._ratio) * internal_variance
        collapse = passed > user_collapse_threshold
        recommendation = "increase absorption ratio" if collapse else "stable"

        logger.info(
            f"partnership: absorbed={absorbed:.4f} "
            f"passed_to_user={passed:.4f} "
            f"threshold={user_collapse_threshold:.4f} "
            f"collapse={collapse} recommendation={recommendation}"
        )
        return AbsorptionResult(
            absorbed_variance=absorbed,
            passed_to_user=passed,
            user_would_collapse=collapse,
            recommendation=recommendation,
        )
