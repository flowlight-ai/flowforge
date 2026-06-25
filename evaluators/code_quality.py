"""FlowForge code quality evaluator agent.

Evaluates readability, maintainability, complexity, duplication, and best practices.
"""
from __future__ import annotations

from typing import Any

from flowforge.evaluators.models import Score
from flowforge.evaluators.base import EvaluatorAgent


class CodeQualityEvaluatorAgent(EvaluatorAgent):
    name: str = "code_quality_evaluator"
    description: str = "Evaluates readability, maintainability, complexity, duplication, and best practices"
    default_mode: str | None = "react"

    async def evaluate_dimension(
        self, submission: dict[str, Any], dimension_config: dict[str, Any]
    ) -> Score:
        weights: dict[str, float] = dimension_config.get("weights", {
            "readability": 0.2,
            "maintainability": 0.2,
            "complexity": 0.2,
            "duplication": 0.2,
            "best_practices": 0.2,
        })

        readability_score: float = self._assess_readability(submission)
        maintainability_score: float = self._assess_maintainability(submission)
        complexity_score: float = self._assess_complexity(submission)
        duplication_score: float = self._assess_duplication(submission)
        practices_score: float = self._assess_best_practices(submission)

        sub_scores: dict[str, float] = {
            "readability": readability_score,
            "maintainability": maintainability_score,
            "complexity": complexity_score,
            "duplication": duplication_score,
            "best_practices": practices_score,
        }

        weighted_sum: float = sum(
            sub_scores[dim] * weights.get(dim, 0.2) for dim in sub_scores
        )
        total_weight: float = sum(weights.get(dim, 0.2) for dim in sub_scores)
        composite: float = weighted_sum / total_weight if total_weight > 0 else 0.0

        rationale: str = self._build_rationale(submission, sub_scores)
        suggestions: list[str] = self._build_suggestions(submission, sub_scores)
        confidence: float = self._compute_confidence(submission)

        return Score(
            dimension="code_quality",
            value=round(composite, 4),
            weight=dimension_config.get("weight", 1.0),
            rationale=rationale,
            suggestions=suggestions,
            confidence=confidence,
        )

    def _assess_readability(self, submission: dict[str, Any]) -> float:
        score: float = 0.0
        quality: dict[str, Any] = submission.get("code_quality_analysis", {})

        if quality.get("naming_conventions_followed"):
            score += 0.25
        if quality.get("documentation_coverage"):
            doc_cov: float = float(quality["documentation_coverage"])
            score += min(0.25, doc_cov / 100.0 * 0.25)
        if quality.get("consistent_formatting"):
            score += 0.25
        if quality.get("self_documenting_code"):
            score += 0.25

        return min(1.0, score)

    def _assess_maintainability(self, submission: dict[str, Any]) -> float:
        score: float = 0.0
        quality: dict[str, Any] = submission.get("code_quality_analysis", {})

        if quality.get("modularity_score"):
            score += min(0.25, float(quality["modularity_score"]) / 10.0 * 0.25)
        if quality.get("coupling_low"):
            score += 0.25
        if quality.get("cohesion_high"):
            score += 0.25
        if quality.get("dependency_management"):
            score += 0.25

        return min(1.0, score)

    def _assess_complexity(self, submission: dict[str, Any]) -> float:
        score: float = 0.0
        quality: dict[str, Any] = submission.get("code_quality_analysis", {})

        cyclomatic: float = float(quality.get("avg_cyclomatic_complexity", 20))
        if cyclomatic <= 5:
            score += 0.35
        elif cyclomatic <= 10:
            score += 0.25
        elif cyclomatic <= 20:
            score += 0.15

        if quality.get("no_god_classes"):
            score += 0.3
        if quality.get("function_length_acceptable"):
            score += 0.35

        return min(1.0, score)

    def _assess_duplication(self, submission: dict[str, Any]) -> float:
        score: float = 0.0
        quality: dict[str, Any] = submission.get("code_quality_analysis", {})

        dup_pct: float = float(quality.get("duplication_percentage", 100))
        if dup_pct <= 3:
            score += 0.4
        elif dup_pct <= 10:
            score += 0.3
        elif dup_pct <= 20:
            score += 0.15

        if quality.get("dry_principle_followed"):
            score += 0.3
        if quality.get("shared_utilities_extracted"):
            score += 0.3

        return min(1.0, score)

    def _assess_best_practices(self, submission: dict[str, Any]) -> float:
        score: float = 0.0
        quality: dict[str, Any] = submission.get("code_quality_analysis", {})

        if quality.get("linting_passed"):
            score += 0.2
        if quality.get("type_checking_passed"):
            score += 0.2
        if quality.get("error_handling_present"):
            score += 0.2
        if quality.get("logging_implemented"):
            score += 0.2
        if quality.get("security_guidelines_followed"):
            score += 0.2

        return min(1.0, score)

    def _build_rationale(
        self, submission: dict[str, Any], sub_scores: dict[str, float]
    ) -> str:
        parts: list[str] = []
        for dim, val in sub_scores.items():
            level: str = "high" if val >= 0.7 else "medium" if val >= 0.4 else "low"
            parts.append(f"{dim}: {level} ({val:.2f})")
        return "Code quality assessment — " + "; ".join(parts)

    def _build_suggestions(
        self, submission: dict[str, Any], sub_scores: dict[str, float]
    ) -> list[str]:
        suggestions: list[str] = []
        if sub_scores.get("readability", 0) < 0.5:
            suggestions.append("Improve naming conventions and increase documentation coverage")
        if sub_scores.get("maintainability", 0) < 0.5:
            suggestions.append("Reduce coupling and increase modularity through better separation of concerns")
        if sub_scores.get("complexity", 0) < 0.5:
            suggestions.append("Reduce cyclomatic complexity by breaking down large functions")
        if sub_scores.get("duplication", 0) < 0.5:
            suggestions.append("Extract shared utilities and follow DRY principle to reduce code duplication")
        if sub_scores.get("best_practices", 0) < 0.5:
            suggestions.append("Enable linting, type checking, and ensure proper error handling")
        return suggestions

    def _compute_confidence(self, submission: dict[str, Any]) -> float:
        evidence_fields: list[str] = ["code_quality_analysis"]
        filled: int = sum(1 for f in evidence_fields if submission.get(f))
        return filled / len(evidence_fields)
