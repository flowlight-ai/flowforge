"""FlowForge test coverage evaluator agent.

Evaluates unit coverage, integration coverage, edge case coverage, and test quality.
"""
from __future__ import annotations

from typing import Any

from flowforge.evaluators.models import Score
from flowforge.evaluators.base import EvaluatorAgent


class TestCoverageEvaluatorAgent(EvaluatorAgent):
    name: str = "test_coverage_evaluator"
    description: str = "Evaluates unit coverage, integration coverage, edge case coverage, and test quality"
    default_mode: str | None = "react"

    async def evaluate_dimension(
        self, submission: dict[str, Any], dimension_config: dict[str, Any]
    ) -> Score:
        weights: dict[str, float] = dimension_config.get("weights", {
            "unit_coverage": 0.3,
            "integration_coverage": 0.3,
            "edge_case_coverage": 0.2,
            "test_quality": 0.2,
        })

        unit_score: float = self._assess_unit_coverage(submission)
        integration_score: float = self._assess_integration_coverage(submission)
        edge_case_score: float = self._assess_edge_case_coverage(submission)
        quality_score: float = self._assess_test_quality(submission)

        sub_scores: dict[str, float] = {
            "unit_coverage": unit_score,
            "integration_coverage": integration_score,
            "edge_case_coverage": edge_case_score,
            "test_quality": quality_score,
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
            dimension="test_coverage",
            value=round(composite, 4),
            weight=dimension_config.get("weight", 1.0),
            rationale=rationale,
            suggestions=suggestions,
            confidence=confidence,
        )

    def _assess_unit_coverage(self, submission: dict[str, Any]) -> float:
        score: float = 0.0
        test: dict[str, Any] = submission.get("test_analysis", {})

        line_cov: float = float(test.get("line_coverage_pct", 0))
        if line_cov >= 90:
            score += 0.4
        elif line_cov >= 80:
            score += 0.3
        elif line_cov >= 60:
            score += 0.2
        elif line_cov >= 40:
            score += 0.1

        branch_cov: float = float(test.get("branch_coverage_pct", 0))
        if branch_cov >= 80:
            score += 0.3
        elif branch_cov >= 60:
            score += 0.2
        elif branch_cov >= 40:
            score += 0.1

        if test.get("all_public_methods_tested"):
            score += 0.3

        return min(1.0, score)

    def _assess_integration_coverage(self, submission: dict[str, Any]) -> float:
        score: float = 0.0
        test: dict[str, Any] = submission.get("test_analysis", {})

        if test.get("integration_tests_present"):
            score += 0.25
        if test.get("api_endpoints_tested"):
            score += 0.25
        if test.get("database_interactions_tested"):
            score += 0.25
        if test.get("external_service_mocks"):
            score += 0.25

        return min(1.0, score)

    def _assess_edge_case_coverage(self, submission: dict[str, Any]) -> float:
        score: float = 0.0
        test: dict[str, Any] = submission.get("test_analysis", {})

        if test.get("boundary_values_tested"):
            score += 0.25
        if test.get("null_empty_inputs_tested"):
            score += 0.25
        if test.get("error_paths_tested"):
            score += 0.25
        if test.get("concurrency_tests"):
            score += 0.25

        return min(1.0, score)

    def _assess_test_quality(self, submission: dict[str, Any]) -> float:
        score: float = 0.0
        test: dict[str, Any] = submission.get("test_analysis", {})

        if test.get("assertions_meaningful"):
            score += 0.25
        if test.get("test_isolation"):
            score += 0.25
        if test.get("no_flaky_tests"):
            score += 0.25
        if test.get("test_naming_descriptive"):
            score += 0.25

        return min(1.0, score)

    def _build_rationale(
        self, submission: dict[str, Any], sub_scores: dict[str, float]
    ) -> str:
        parts: list[str] = []
        for dim, val in sub_scores.items():
            level: str = "high" if val >= 0.7 else "medium" if val >= 0.4 else "low"
            parts.append(f"{dim}: {level} ({val:.2f})")
        return "Test coverage assessment — " + "; ".join(parts)

    def _build_suggestions(
        self, submission: dict[str, Any], sub_scores: dict[str, float]
    ) -> list[str]:
        suggestions: list[str] = []
        if sub_scores.get("unit_coverage", 0) < 0.5:
            suggestions.append("Increase unit test coverage to at least 80% line and 60% branch coverage")
        if sub_scores.get("integration_coverage", 0) < 0.5:
            suggestions.append("Add integration tests for API endpoints and database interactions")
        if sub_scores.get("edge_case_coverage", 0) < 0.5:
            suggestions.append("Add tests for boundary values, null inputs, and error paths")
        if sub_scores.get("test_quality", 0) < 0.5:
            suggestions.append("Improve test isolation and ensure assertions are meaningful and descriptive")
        return suggestions

    def _compute_confidence(self, submission: dict[str, Any]) -> float:
        evidence_fields: list[str] = ["test_analysis"]
        filled: int = sum(1 for f in evidence_fields if submission.get(f))
        return filled / len(evidence_fields)
