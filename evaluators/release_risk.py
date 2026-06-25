"""FlowForge release risk evaluator agent.

Evaluates regression risk, dependency stability, performance impact, and operational risk.
"""
from __future__ import annotations

from typing import Any

from flowforge.evaluators.models import Score
from flowforge.evaluators.base import EvaluatorAgent


class ReleaseRiskEvaluatorAgent(EvaluatorAgent):
    name: str = "release_risk_evaluator"
    description: str = "Evaluates regression risk, dependency stability, performance impact, and operational risk"
    default_mode: str | None = "react"

    async def evaluate_dimension(
        self, submission: dict[str, Any], dimension_config: dict[str, Any]
    ) -> Score:
        weights: dict[str, float] = dimension_config.get("weights", {
            "regression_risk": 0.3,
            "dependency_stability": 0.25,
            "performance_impact": 0.25,
            "operational_risk": 0.2,
        })

        regression_score: float = self._assess_regression_risk(submission)
        dependency_score: float = self._assess_dependency_stability(submission)
        perf_score: float = self._assess_performance_impact(submission)
        ops_score: float = self._assess_operational_risk(submission)

        sub_scores: dict[str, float] = {
            "regression_risk": regression_score,
            "dependency_stability": dependency_score,
            "performance_impact": perf_score,
            "operational_risk": ops_score,
        }

        weighted_sum: float = sum(
            sub_scores[dim] * weights.get(dim, 0.25) for dim in sub_scores
        )
        total_weight: float = sum(weights.get(dim, 0.25) for dim in sub_scores)
        composite: float = weighted_sum / total_weight if total_weight > 0 else 0.0

        rationale: str = self._build_rationale(submission, sub_scores)
        suggestions: list[str] = self._build_suggestions(submission, sub_scores)
        confidence: float = self._compute_confidence(submission)

        return Score(
            dimension="release_risk",
            value=round(composite, 4),
            weight=dimension_config.get("weight", 1.0),
            rationale=rationale,
            suggestions=suggestions,
            confidence=confidence,
        )

    def _assess_regression_risk(self, submission: dict[str, Any]) -> float:
        score: float = 0.0
        risk: dict[str, Any] = submission.get("release_risk_analysis", {})

        if risk.get("regression_tests_passed"):
            score += 0.3
        if risk.get("code_change_scope"):
            scope: str = risk["code_change_scope"]
            scope_map: dict[str, float] = {"small": 0.3, "medium": 0.2, "large": 0.05}
            score += scope_map.get(scope, 0.0)
        if risk.get("backward_compatible"):
            score += 0.2
        if risk.get("smoke_tests_passed"):
            score += 0.2

        return min(1.0, score)

    def _assess_dependency_stability(self, submission: dict[str, Any]) -> float:
        score: float = 0.0
        risk: dict[str, Any] = submission.get("release_risk_analysis", {})

        if risk.get("no_new_critical_deps"):
            score += 0.25
        if risk.get("deps_pinned"):
            score += 0.25
        if risk.get("vulnerability_scan_clean"):
            score += 0.25
        if risk.get("deps_compatibility_verified"):
            score += 0.25

        return min(1.0, score)

    def _assess_performance_impact(self, submission: dict[str, Any]) -> float:
        score: float = 0.0
        risk: dict[str, Any] = submission.get("release_risk_analysis", {})

        if risk.get("performance_benchmarks_passed"):
            score += 0.3
        if risk.get("no_new_hot_paths"):
            score += 0.2
        if risk.get("load_test_results_acceptable"):
            score += 0.25
        if risk.get("memory_profile_stable"):
            score += 0.25

        return min(1.0, score)

    def _assess_operational_risk(self, submission: dict[str, Any]) -> float:
        score: float = 0.0
        risk: dict[str, Any] = submission.get("release_risk_analysis", {})

        if risk.get("deployment_automated"):
            score += 0.25
        if risk.get("runbook_updated"):
            score += 0.25
        if risk.get("oncall_notified"):
            score += 0.25
        if risk.get("maintenance_window_scheduled"):
            score += 0.25

        return min(1.0, score)

    def _build_rationale(
        self, submission: dict[str, Any], sub_scores: dict[str, float]
    ) -> str:
        parts: list[str] = []
        for dim, val in sub_scores.items():
            level: str = "high" if val >= 0.7 else "medium" if val >= 0.4 else "low"
            parts.append(f"{dim}: {level} ({val:.2f})")
        return "Release risk assessment — " + "; ".join(parts)

    def _build_suggestions(
        self, submission: dict[str, Any], sub_scores: dict[str, float]
    ) -> list[str]:
        suggestions: list[str] = []
        if sub_scores.get("regression_risk", 0) < 0.5:
            suggestions.append("Run full regression test suite and verify backward compatibility")
        if sub_scores.get("dependency_stability", 0) < 0.5:
            suggestions.append("Pin dependency versions and run vulnerability scans before release")
        if sub_scores.get("performance_impact", 0) < 0.5:
            suggestions.append("Conduct performance benchmarks and load tests to validate no degradation")
        if sub_scores.get("operational_risk", 0) < 0.5:
            suggestions.append("Automate deployment, update runbooks, and schedule a maintenance window")
        return suggestions

    def _compute_confidence(self, submission: dict[str, Any]) -> float:
        evidence_fields: list[str] = ["release_risk_analysis"]
        filled: int = sum(1 for f in evidence_fields if submission.get(f))
        return filled / len(evidence_fields)
