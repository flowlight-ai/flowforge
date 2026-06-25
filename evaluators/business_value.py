"""FlowForge business value evaluator agent.

Evaluates market opportunity, user value, and strategic alignment.
"""
from __future__ import annotations

from typing import Any

from flowforge.evaluators.models import Score
from flowforge.evaluators.base import EvaluatorAgent


class BusinessValueEvaluatorAgent(EvaluatorAgent):
    name: str = "business_value_evaluator"
    description: str = "Evaluates market opportunity, user value, and strategic alignment"
    default_mode: str | None = "react"

    async def evaluate_dimension(
        self, submission: dict[str, Any], dimension_config: dict[str, Any]
    ) -> Score:
        weights: dict[str, float] = dimension_config.get("weights", {
            "market_opportunity": 0.3,
            "user_value": 0.3,
            "strategic_fit": 0.2,
            "roi_potential": 0.2,
        })

        market_score: float = self._assess_market_opportunity(submission)
        user_score: float = self._assess_user_value(submission)
        strategic_score: float = self._assess_strategic_fit(submission)
        roi_score: float = self._assess_roi_potential(submission)

        sub_scores: dict[str, float] = {
            "market_opportunity": market_score,
            "user_value": user_score,
            "strategic_fit": strategic_score,
            "roi_potential": roi_score,
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
            dimension="business_value",
            value=round(composite, 4),
            weight=dimension_config.get("weight", 1.0),
            rationale=rationale,
            suggestions=suggestions,
            confidence=confidence,
        )

    def _assess_market_opportunity(self, submission: dict[str, Any]) -> float:
        score: float = 0.0
        market_analysis: dict[str, Any] = submission.get("market_analysis", {})

        if market_analysis.get("tam"):
            score += 0.25
        if market_analysis.get("sam"):
            score += 0.25
        if market_analysis.get("som"):
            score += 0.25
        if market_analysis.get("growth_rate"):
            growth: float = float(market_analysis["growth_rate"])
            score += min(0.25, growth / 40.0 * 0.25)

        competitors: list[Any] = market_analysis.get("competitors", [])
        if len(competitors) <= 2:
            score += 0.15
        elif len(competitors) <= 5:
            score += 0.08

        return min(1.0, score)

    def _assess_user_value(self, submission: dict[str, Any]) -> float:
        score: float = 0.0
        user_research: dict[str, Any] = submission.get("user_research", {})

        if user_research.get("pain_points"):
            pain_count: int = len(user_research["pain_points"])
            score += min(0.3, pain_count * 0.1)
        if user_research.get("user_feedback"):
            feedback_score: float = float(user_research.get("user_feedback", 0))
            score += min(0.3, feedback_score / 5.0 * 0.3)
        if user_research.get("target_audience_defined"):
            score += 0.2
        if user_research.get("validation_evidence"):
            score += 0.2

        return min(1.0, score)

    def _assess_strategic_fit(self, submission: dict[str, Any]) -> float:
        score: float = 0.0
        strategy: dict[str, Any] = submission.get("strategic_alignment", {})

        if strategy.get("company_vision_match"):
            score += 0.3
        if strategy.get("roadmap_alignment"):
            score += 0.3
        if strategy.get("resource_synergy"):
            score += 0.2
        if strategy.get("brand_alignment"):
            score += 0.2

        return min(1.0, score)

    def _assess_roi_potential(self, submission: dict[str, Any]) -> float:
        score: float = 0.0
        roi: dict[str, Any] = submission.get("roi_analysis", {})

        if roi.get("estimated_revenue"):
            score += 0.3
        if roi.get("cost_estimate"):
            cost: float = float(roi["cost_estimate"])
            revenue: float = float(roi.get("estimated_revenue", 0))
            if revenue > 0 and cost > 0:
                ratio: float = revenue / cost
                score += min(0.3, ratio / 5.0 * 0.3)
        if roi.get("payback_period_months"):
            payback: float = float(roi["payback_period_months"])
            if payback <= 6:
                score += 0.25
            elif payback <= 12:
                score += 0.15
            elif payback <= 24:
                score += 0.08
        if roi.get("revenue_confidence"):
            score += float(roi["revenue_confidence"]) * 0.15

        return min(1.0, score)

    def _build_rationale(
        self, submission: dict[str, Any], sub_scores: dict[str, float]
    ) -> str:
        parts: list[str] = []
        for dim, val in sub_scores.items():
            level: str = "high" if val >= 0.7 else "medium" if val >= 0.4 else "low"
            parts.append(f"{dim}: {level} ({val:.2f})")
        return "Business value assessment — " + "; ".join(parts)

    def _build_suggestions(
        self, submission: dict[str, Any], sub_scores: dict[str, float]
    ) -> list[str]:
        suggestions: list[str] = []
        if sub_scores.get("market_opportunity", 0) < 0.5:
            suggestions.append("Conduct deeper market research to quantify TAM/SAM/SOM")
        if sub_scores.get("user_value", 0) < 0.5:
            suggestions.append("Gather more user feedback and validate pain points")
        if sub_scores.get("strategic_fit", 0) < 0.5:
            suggestions.append("Align feature scope with company roadmap and vision")
        if sub_scores.get("roi_potential", 0) < 0.5:
            suggestions.append("Refine cost-benefit analysis with realistic revenue projections")
        return suggestions

    def _compute_confidence(self, submission: dict[str, Any]) -> float:
        evidence_fields: list[str] = [
            "market_analysis", "user_research", "strategic_alignment", "roi_analysis"
        ]
        filled: int = sum(1 for f in evidence_fields if submission.get(f))
        return filled / len(evidence_fields)
