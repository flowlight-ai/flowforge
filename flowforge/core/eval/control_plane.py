"""Harness Eval control plane — coordinates contract / signals / attribution.

The control plane is the single entry point a harness component uses to
self-evaluate (F040 / task.md P1-5). It:

1. Builds an EvalContract from an EvalTarget and runs EvalContractRunner.
2. Collects EvalSignals from registered evaluators and aggregates them via
   ThreeSignalAggregator.
3. On contract failure, classifies the gap through AttributionMatrix.
4. Emits an EvalReport with overall_score + actionable recommendations.

Evaluators may be sync or async; both are supported. The control plane itself
does NOT call an LLM — it is a deterministic orchestrator.
"""

from __future__ import annotations

import inspect
from dataclasses import dataclass, field
from typing import Any, Callable

from flowforge.core.errors import EvalError
from flowforge.core.eval.attribution import (
    AttributionMatrix,
    AttributionType,
    FailureDescription,
)
from flowforge.core.eval.contract import (
    DEFAULT_QUALITY_BAR,
    EvalContract,
    EvalContractRunner,
    EvalVerdict,
)
from flowforge.core.eval.three_signals import (
    DEFAULT_SIGNAL_WEIGHTS,
    AggregatedScore,
    EvalSignal,
    SignalSource,
    ThreeSignalAggregator,
)
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.eval.control_plane")

# Context keys understood by _build_contract.
CTX_PROMISED = "promised"
CTX_EVIDENCE = "evidence"
CTX_QUALITY_BAR = "quality_bar"
CTX_ATTRIBUTION = "attribution"

# How much weight the contract score vs. the aggregated signals carry in the
# overall score when signals are available.
CONTRACT_WEIGHT = 0.5
SIGNAL_WEIGHT = 0.5


@dataclass(frozen=True)
class EvalTarget:
    """The artifact + context that the control plane evaluates."""

    target_id: str
    target_type: str
    artifact: str
    context: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class EvalReport:
    """The full evaluation result returned by EvalControlPlane.run_evaluations."""

    target_id: str
    contract_verdict: EvalVerdict
    signals: AggregatedScore
    attribution: AttributionType | None
    overall_score: float
    recommendations: list[str]


class EvalControlPlane:
    """Coordinates the contract / three-signal / attribution components.

    Usage:
        plane = EvalControlPlane()
        plane.register_evaluator("telemetry", telemetry_collector)
        report = await plane.run_evaluations(target)
    """

    def __init__(
        self,
        contract_runner: EvalContractRunner | None = None,
        attribution_matrix: AttributionMatrix | None = None,
        signal_weights: dict[SignalSource, float] | None = None,
        quality_bar: float = DEFAULT_QUALITY_BAR,
    ) -> None:
        self._contract_runner = contract_runner or EvalContractRunner()
        self._attribution_matrix = attribution_matrix or AttributionMatrix()
        self._signal_weights: dict[SignalSource, float] = (
            dict(signal_weights) if signal_weights else dict(DEFAULT_SIGNAL_WEIGHTS)
        )
        self._quality_bar = quality_bar
        self._evaluators: dict[str, Callable[[EvalTarget], Any]] = {}

    def register_evaluator(
        self, name: str, evaluator: Callable[[EvalTarget], Any]
    ) -> None:
        """Register a named evaluator callable.

        The evaluator receives an EvalTarget and returns an EvalSignal, a list
        of EvalSignal, or a coroutine resolving to either. Duplicate names or
        empty names raise EvalError.
        """
        if not name:
            raise EvalError("evaluator name must be non-empty")
        if name in self._evaluators:
            raise EvalError(f"evaluator {name!r} already registered")
        self._evaluators[name] = evaluator
        logger.info(f"evaluator registered: {name}")

    async def run_evaluations(self, target: EvalTarget) -> EvalReport:
        """Run contract + signals + attribution for one target."""
        contract = self._build_contract(target)
        verdict = self._contract_runner.evaluate(contract)

        signals = await self._collect_signals(target)
        aggregator = ThreeSignalAggregator(self._signal_weights)
        for sig in signals:
            aggregator.add_signal(sig)
        aggregated = aggregator.aggregate()

        attribution = self._classify_failure(contract, verdict)
        overall_score = self._compute_overall(verdict, aggregated)
        recommendations = self._build_recommendations(verdict, aggregated, attribution)

        logger.info(
            f"eval report: target={target.target_id} passed={verdict.passed} "
            f"overall={overall_score:.2f} signals={aggregated.signal_count}"
        )

        return EvalReport(
            target_id=target.target_id,
            contract_verdict=verdict,
            signals=aggregated,
            attribution=attribution,
            overall_score=overall_score,
            recommendations=recommendations,
        )

    async def _collect_signals(self, target: EvalTarget) -> list[EvalSignal]:
        signals: list[EvalSignal] = []
        for name, evaluator in self._evaluators.items():
            try:
                result = evaluator(target)
                if inspect.iscoroutine(result):
                    result = await result
                if isinstance(result, EvalSignal):
                    signals.append(result)
                elif isinstance(result, list):
                    for item in result:
                        if isinstance(item, EvalSignal):
                            signals.append(item)
            except Exception as exc:  # noqa: BLE001
                logger.warning(f"evaluator {name!r} raised: {exc!r}")
        return signals

    def _classify_failure(
        self, contract: EvalContract, verdict: EvalVerdict
    ) -> AttributionType | None:
        """Only attribute when the contract failed; None on pass."""
        if verdict.passed:
            return None
        failure = FailureDescription(
            what_failed=verdict.notes,
            expected=contract.what_was_promised,
            actual=contract.what_was_delivered,
            context=str(
                {
                    "missing_evidence": verdict.missing_evidence,
                    "attribution": verdict.attribution,
                }
            ),
            error_trace="",
        )
        return self._attribution_matrix.classify(failure)

    def _compute_overall(
        self, verdict: EvalVerdict, aggregated: AggregatedScore
    ) -> float:
        if aggregated.signal_count > 0:
            overall = CONTRACT_WEIGHT * verdict.score + SIGNAL_WEIGHT * aggregated.final_score
        else:
            overall = verdict.score
        return round(overall, 4)

    def _build_recommendations(
        self,
        verdict: EvalVerdict,
        signals: AggregatedScore,
        attribution: AttributionType | None,
    ) -> list[str]:
        recs: list[str] = []
        if verdict.missing_evidence:
            recs.append("collect additional evidence: " + "; ".join(verdict.missing_evidence))
        if signals.disagreement_score > 0.3:
            recs.append("signal disagreement high; reconcile observer vs telemetry")
        if attribution is not None and attribution != AttributionType.LUCK:
            recs.append(f"address {attribution.value}-layer root cause")
        if verdict.passed and signals.agreement_score >= 0.8:
            recs.append("no action needed; contract met and signals aligned")
        return recs

    def _build_contract(self, target: EvalTarget) -> EvalContract:
        ctx = target.context
        promised = str(ctx.get(CTX_PROMISED, target.artifact))
        evidence = list(ctx.get(CTX_EVIDENCE, []))
        quality_bar = float(ctx.get(CTX_QUALITY_BAR, self._quality_bar))
        attribution_str = str(ctx.get(CTX_ATTRIBUTION, ""))
        return EvalContract(
            what_was_promised=promised,
            what_was_delivered=target.artifact,
            what_evidence_exists=evidence,
            what_quality_bar=quality_bar,
            what_attribution=attribution_str,
        )
