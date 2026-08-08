"""Metacognition Router — three-signal action routing.

Three signals:
1. domain_reliability: rolling domain reliability (successes+1)/(trials+2) + Wilson lower bound
2. evidence_completeness: evidence coverage estimate
3. self_reported_confidence: model self-report (reference only, not relied upon)

High-risk domain action_confidence < 0.85 → structured analysis only + explicit escalation.
"""

from __future__ import annotations

import math

from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.evolution.metacognition")

HIGH_RISK_ACTION_CONFIDENCE_THRESHOLD = 0.85

WEIGHT_DOMAIN_RELIABILITY = 0.5
WEIGHT_EVIDENCE_COMPLETENESS = 0.35
WEIGHT_SELF_REPORTED = 0.15


class MetacognitionRouter:
    """Three-signal router — Wilson lower bound for high-risk, Laplace smoothing for general."""

    def compute_domain_reliability(self, successes: int, trials: int) -> float:
        """Laplace-smoothed (successes+1)/(trials+2)."""
        if trials < 0:
            raise ValueError(f"trials must be >= 0, got {trials}")
        if successes < 0 or successes > trials:
            raise ValueError(f"successes {successes} out of range [0, {trials}]")
        return (successes + 1) / (trials + 2)

    def compute_wilson_lower_bound(
        self,
        successes: int,
        trials: int,
        z: float = 1.96,
    ) -> float:
        """Wilson score interval lower bound (95% CI when z=1.96)."""
        if trials <= 0:
            return 0.0
        if successes < 0 or successes > trials:
            raise ValueError(f"successes {successes} out of range [0, {trials}]")
        if z <= 0:
            raise ValueError(f"z must be > 0, got {z}")
        n = trials
        p_hat = successes / n
        z2 = z * z
        denominator = 1 + z2 / n
        center = (p_hat + z2 / (2 * n)) / denominator
        margin = (z / denominator) * math.sqrt(p_hat * (1 - p_hat) / n + z2 / (4 * n * n))
        lower = center - margin
        return max(0.0, min(1.0, lower))

    def route_confidence(
        self,
        domain_reliability: float,
        evidence_completeness: float,
        self_reported: float,
        is_high_risk: bool = False,
    ) -> dict:
        """Route decision. Returns dict with action_confidence, route, reason, signals."""
        dr = max(0.0, min(1.0, float(domain_reliability)))
        ec = max(0.0, min(1.0, float(evidence_completeness)))
        sr = max(0.0, min(1.0, float(self_reported)))

        if is_high_risk:
            # In high-risk mode, drop self-reported weight to 0 and split it across the other two
            weight_dr = WEIGHT_DOMAIN_RELIABILITY + WEIGHT_SELF_REPORTED / 2
            weight_ec = WEIGHT_EVIDENCE_COMPLETENESS + WEIGHT_SELF_REPORTED / 2
            weight_sr = 0.0
        else:
            weight_dr = WEIGHT_DOMAIN_RELIABILITY
            weight_ec = WEIGHT_EVIDENCE_COMPLETENESS
            weight_sr = WEIGHT_SELF_REPORTED

        action_confidence = dr * weight_dr + ec * weight_ec + sr * weight_sr

        if is_high_risk and action_confidence < HIGH_RISK_ACTION_CONFIDENCE_THRESHOLD:
            route = "escalate"
            reason = (
                f"high-risk domain action_confidence={action_confidence:.4f} "
                f"< threshold {HIGH_RISK_ACTION_CONFIDENCE_THRESHOLD} → structured analysis + escalation"
            )
        elif action_confidence < HIGH_RISK_ACTION_CONFIDENCE_THRESHOLD:
            route = "structured_analysis_only"
            reason = (
                f"action_confidence={action_confidence:.4f} "
                f"< threshold {HIGH_RISK_ACTION_CONFIDENCE_THRESHOLD} → structured analysis only"
            )
        else:
            route = "proceed"
            reason = f"action_confidence={action_confidence:.4f} >= threshold → proceed"

        result = {
            "action_confidence": round(action_confidence, 4),
            "route": route,
            "reason": reason,
            "signals": {
                "domain_reliability": round(dr, 4),
                "evidence_completeness": round(ec, 4),
                "self_reported_confidence": round(sr, 4),
                "is_high_risk": is_high_risk,
            },
        }
        logger.debug(
            f"metacognition route: dr={dr:.3f} ec={ec:.3f} sr={sr:.3f} "
            f"high_risk={is_high_risk} -> confidence={action_confidence:.4f} route={route}"
        )
        return result
