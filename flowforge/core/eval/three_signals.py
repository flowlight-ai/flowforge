"""Three-signal cross-validation — trace + observer + telemetry.

Three signal sources (F019 / task.md P1-5):
- SELF_REPORT — the agent's own claim about how it did (lowest weight)
- OBSERVER   — a cross-agent / human reviewer
- TELEMETRY  — objective instrumentation (highest weight alongside observer)

Default weights: SELF_REPORT=0.2, OBSERVER=0.4, TELEMETRY=0.4. Self-report is
discounted because it is the most susceptible to optimistic bias.

Aggregation:
  final_score       = Σ(value * weight) / Σ(weight)
  agreement_score   = 1.0 - population_std(values)   (clamped to [0, 1])
  disagreement_score = 1.0 - agreement_score
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from enum import Enum

from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.eval.three_signals")

DEFAULT_SIGNAL_WEIGHTS: dict[SignalSource, float] = {
    # populated below after SignalSource is defined
}


class SignalSource(Enum):
    """Three independent signal sources for cross-validation."""

    SELF_REPORT = "self_report"
    OBSERVER = "observer"
    TELEMETRY = "telemetry"


# Default per-source weights — self-report is discounted.
DEFAULT_SIGNAL_WEIGHTS.update(
    {
        SignalSource.SELF_REPORT: 0.2,
        SignalSource.OBSERVER: 0.4,
        SignalSource.TELEMETRY: 0.4,
    }
)


@dataclass(frozen=True)
class EvalSignal:
    """A single observation from one of the three signal sources."""

    source: SignalSource
    value: float
    # None => resolve to the aggregator's default weight for this source.
    weight: float | None = None
    collected_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    notes: str = ""

    def __post_init__(self) -> None:
        if self.value < 0.0 or self.value > 1.0:
            raise ValueError(
                f"EvalSignal.value must be within [0.0, 1.0], got {self.value}"
            )


@dataclass(frozen=True)
class AggregatedScore:
    """Output of ThreeSignalAggregator.aggregate()."""

    final_score: float
    signal_count: int
    agreement_score: float
    disagreement_score: float


class ThreeSignalAggregator:
    """Collects signals from the three sources and cross-validates them.

    Usage:
        agg = ThreeSignalAggregator()
        agg.add_signal(EvalSignal(source=SignalSource.TELEMETRY, value=0.9))
        result = agg.aggregate()
    """

    def __init__(
        self, signal_weights: dict[SignalSource, float] | None = None
    ) -> None:
        self._weights: dict[SignalSource, float] = (
            dict(signal_weights) if signal_weights else dict(DEFAULT_SIGNAL_WEIGHTS)
        )
        self._signals: list[EvalSignal] = []

    def add_signal(self, signal: EvalSignal) -> None:
        """Append a signal, resolving a None weight to the source default."""
        weight = signal.weight
        if weight is None:
            weight = self._weights.get(signal.source, 0.0)
        resolved = replace(signal, weight=weight)
        self._signals.append(resolved)
        logger.debug(
            f"signal added: source={signal.source.value} "
            f"value={signal.value:.2f} weight={weight:.2f}"
        )

    def aggregate(self) -> AggregatedScore:
        """Compute the weighted final score plus agreement / disagreement."""
        if not self._signals:
            return AggregatedScore(
                final_score=0.0,
                signal_count=0,
                agreement_score=0.0,
                disagreement_score=1.0,
            )

        total_weight = sum(s.weight or 0.0 for s in self._signals)
        if total_weight <= 0:
            # All-zero weights fallback to equal weighting so aggregation still
            # produces a meaningful number.
            n = len(self._signals)
            final = sum(s.value for s in self._signals) / n
        else:
            final = sum(s.value * (s.weight or 0.0) for s in self._signals) / total_weight
        final = round(final, 4)

        values = [s.value for s in self._signals]
        std = statistics.pstdev(values)
        agreement = max(0.0, min(1.0, 1.0 - std))
        agreement = round(agreement, 4)
        disagreement = round(1.0 - agreement, 4)

        logger.info(
            f"signals aggregate: count={len(self._signals)} "
            f"final={final:.2f} agreement={agreement:.2f}"
        )
        return AggregatedScore(
            final_score=final,
            signal_count=len(self._signals),
            agreement_score=agreement,
            disagreement_score=disagreement,
        )
