"""FlowForge UX evaluator agent.

Evaluates usability, accessibility, consistency, and user feedback.
"""
from __future__ import annotations

from typing import Any

from flowforge.evaluators.models import Score
from flowforge.evaluators.base import EvaluatorAgent


class UXEvaluatorAgent(EvaluatorAgent):
    name: str = "ux_evaluator"
    description: str = "Evaluates usability, accessibility, consistency, and user feedback"
    default_mode: str | None = "react"

    async def evaluate_dimension(
        self, submission: dict[str, Any], dimension_config: dict[str, Any]
    ) -> Score:
        weights: dict[str, float] = dimension_config.get("weights", {
            "usability": 0.3,
            "accessibility": 0.25,
            "consistency": 0.25,
            "user_feedback": 0.2,
        })

        usability_score: float = self._assess_usability(submission)
        accessibility_score: float = self._assess_accessibility(submission)
        consistency_score: float = self._assess_consistency(submission)
        feedback_score: float = self._assess_user_feedback(submission)

        sub_scores: dict[str, float] = {
            "usability": usability_score,
            "accessibility": accessibility_score,
            "consistency": consistency_score,
            "user_feedback": feedback_score,
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
            dimension="ux",
            value=round(composite, 4),
            weight=dimension_config.get("weight", 1.0),
            rationale=rationale,
            suggestions=suggestions,
            confidence=confidence,
        )

    def _assess_usability(self, submission: dict[str, Any]) -> float:
        score: float = 0.0
        ux: dict[str, Any] = submission.get("ux_analysis", {})

        if ux.get("task_completion_rate"):
            rate: float = float(ux["task_completion_rate"])
            score += min(0.25, rate / 100.0 * 0.25)
        if ux.get("error_rate"):
            err: float = float(ux["error_rate"])
            score += max(0.0, 0.25 - err / 50.0 * 0.25)
        if ux.get("learnability_score"):
            score += min(0.25, float(ux["learnability_score"]) / 5.0 * 0.25)
        if ux.get("user_satisfaction_score"):
            score += min(0.25, float(ux["user_satisfaction_score"]) / 5.0 * 0.25)

        return min(1.0, score)

    def _assess_accessibility(self, submission: dict[str, Any]) -> float:
        score: float = 0.0
        a11y: dict[str, Any] = submission.get("accessibility_analysis", {})

        if a11y.get("wcag_compliance_level"):
            level: str = a11y["wcag_compliance_level"]
            level_map: dict[str, float] = {"aaa": 0.3, "aa": 0.25, "a": 0.15}
            score += level_map.get(level, 0.0)
        if a11y.get("screen_reader_compatible"):
            score += 0.2
        if a11y.get("keyboard_navigation"):
            score += 0.2
        if a11y.get("color_contrast_ratio_met"):
            score += 0.15
        if a11y.get("aria_labels_present"):
            score += 0.15

        return min(1.0, score)

    def _assess_consistency(self, submission: dict[str, Any]) -> float:
        score: float = 0.0
        consistency: dict[str, Any] = submission.get("consistency_analysis", {})

        if consistency.get("design_system_used"):
            score += 0.25
        if consistency.get("component_library"):
            score += 0.25
        if consistency.get("style_guide_followed"):
            score += 0.25
        if consistency.get("interaction_patterns_consistent"):
            score += 0.25

        return min(1.0, score)

    def _assess_user_feedback(self, submission: dict[str, Any]) -> float:
        score: float = 0.0
        feedback: dict[str, Any] = submission.get("user_feedback_analysis", {})

        if feedback.get("nps_score"):
            nps: float = float(feedback["nps_score"])
            score += min(0.25, max(0.0, nps / 100.0 * 0.25))
        if feedback.get("usability_test_results"):
            score += 0.25
        if feedback.get("user_interviews_conducted"):
            score += 0.25
        if feedback.get("feedback_integrated"):
            score += 0.25

        return min(1.0, score)

    def _build_rationale(
        self, submission: dict[str, Any], sub_scores: dict[str, float]
    ) -> str:
        parts: list[str] = []
        for dim, val in sub_scores.items():
            level: str = "high" if val >= 0.7 else "medium" if val >= 0.4 else "low"
            parts.append(f"{dim}: {level} ({val:.2f})")
        return "UX assessment — " + "; ".join(parts)

    def _build_suggestions(
        self, submission: dict[str, Any], sub_scores: dict[str, float]
    ) -> list[str]:
        suggestions: list[str] = []
        if sub_scores.get("usability", 0) < 0.5:
            suggestions.append("Improve task completion rates and reduce user error rates")
        if sub_scores.get("accessibility", 0) < 0.5:
            suggestions.append("Achieve WCAG AA compliance and ensure screen reader compatibility")
        if sub_scores.get("consistency", 0) < 0.5:
            suggestions.append("Adopt a design system and enforce consistent interaction patterns")
        if sub_scores.get("user_feedback", 0) < 0.5:
            suggestions.append("Conduct usability testing and integrate user feedback into design iterations")
        return suggestions

    def _compute_confidence(self, submission: dict[str, Any]) -> float:
        evidence_fields: list[str] = [
            "ux_analysis", "accessibility_analysis",
            "consistency_analysis", "user_feedback_analysis"
        ]
        filled: int = sum(1 for f in evidence_fields if submission.get(f))
        return filled / len(evidence_fields)
