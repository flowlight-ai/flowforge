"""FlowForge feasibility evaluator agent.

Evaluates technical feasibility, resource availability, and timeline constraints.
"""
from __future__ import annotations

from typing import Any

from flowforge.evaluators.models import Score
from flowforge.evaluators.base import EvaluatorAgent


class FeasibilityEvaluatorAgent(EvaluatorAgent):
    name: str = "feasibility_evaluator"
    description: str = "Evaluates technical feasibility, resource availability, and timeline constraints"
    default_mode: str | None = "react"

    async def evaluate_dimension(
        self, submission: dict[str, Any], dimension_config: dict[str, Any]
    ) -> Score:
        weights: dict[str, float] = dimension_config.get("weights", {
            "technical_feasibility": 0.3,
            "resource_availability": 0.25,
            "timeline_realism": 0.25,
            "dependency_risk": 0.2,
        })

        tech_score: float = self._assess_technical_feasibility(submission)
        resource_score: float = self._assess_resource_availability(submission)
        timeline_score: float = self._assess_timeline_realism(submission)
        dependency_score: float = self._assess_dependency_risk(submission)

        sub_scores: dict[str, float] = {
            "technical_feasibility": tech_score,
            "resource_availability": resource_score,
            "timeline_realism": timeline_score,
            "dependency_risk": dependency_score,
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
            dimension="feasibility",
            value=round(composite, 4),
            weight=dimension_config.get("weight", 1.0),
            rationale=rationale,
            suggestions=suggestions,
            confidence=confidence,
        )

    def _assess_technical_feasibility(self, submission: dict[str, Any]) -> float:
        score: float = 0.0
        tech: dict[str, Any] = submission.get("technical_analysis", {})

        if tech.get("architecture_defined"):
            score += 0.2
        if tech.get("tech_stack_proven"):
            score += 0.2
        if tech.get("poc_completed"):
            score += 0.25
        elif tech.get("poc_planned"):
            score += 0.1

        complexity: str = tech.get("complexity_level", "unknown")
        complexity_map: dict[str, float] = {
            "low": 0.25, "medium": 0.15, "high": 0.05, "unknown": 0.0
        }
        score += complexity_map.get(complexity, 0.0)

        if tech.get("team_expertise_match"):
            score += 0.15

        return min(1.0, score)

    def _assess_resource_availability(self, submission: dict[str, Any]) -> float:
        score: float = 0.0
        resources: dict[str, Any] = submission.get("resource_analysis", {})

        if resources.get("team_available"):
            score += 0.2
        if resources.get("budget_allocated"):
            score += 0.2
        if resources.get("infrastructure_ready"):
            score += 0.2
        if resources.get("skills_match"):
            match_pct: float = float(resources.get("skills_match_pct", 0))
            score += min(0.2, match_pct / 100.0 * 0.2)
        if resources.get("external_dependencies_resolved"):
            score += 0.2

        return min(1.0, score)

    def _assess_timeline_realism(self, submission: dict[str, Any]) -> float:
        score: float = 0.0
        timeline: dict[str, Any] = submission.get("timeline_analysis", {})

        if timeline.get("milestones_defined"):
            score += 0.2
        if timeline.get("buffer_included"):
            score += 0.2
        if timeline.get("historical_velocity"):
            score += 0.2

        estimated_weeks: float = float(timeline.get("estimated_weeks", 0))
        deadline_weeks: float = float(timeline.get("deadline_weeks", 0))
        if deadline_weeks > 0 and estimated_weeks > 0:
            ratio: float = deadline_weeks / estimated_weeks
            if ratio >= 1.5:
                score += 0.25
            elif ratio >= 1.2:
                score += 0.15
            elif ratio >= 1.0:
                score += 0.08

        if timeline.get("parallel_workstreams"):
            score += 0.15

        return min(1.0, score)

    def _assess_dependency_risk(self, submission: dict[str, Any]) -> float:
        score: float = 0.0
        deps: dict[str, Any] = submission.get("dependency_analysis", {})

        external_deps: int = int(deps.get("external_count", 0))
        if external_deps == 0:
            score += 0.3
        elif external_deps <= 2:
            score += 0.2
        elif external_deps <= 5:
            score += 0.1

        if deps.get("third_party_stable"):
            score += 0.25
        if deps.get("fallback_plans"):
            score += 0.25
        if deps.get("api_contracts_defined"):
            score += 0.2

        return min(1.0, score)

    def _build_rationale(
        self, submission: dict[str, Any], sub_scores: dict[str, float]
    ) -> str:
        parts: list[str] = []
        for dim, val in sub_scores.items():
            level: str = "high" if val >= 0.7 else "medium" if val >= 0.4 else "low"
            parts.append(f"{dim}: {level} ({val:.2f})")
        return "Feasibility assessment — " + "; ".join(parts)

    def _build_suggestions(
        self, submission: dict[str, Any], sub_scores: dict[str, float]
    ) -> list[str]:
        suggestions: list[str] = []
        if sub_scores.get("technical_feasibility", 0) < 0.5:
            suggestions.append("Complete a proof-of-concept to validate technical approach")
        if sub_scores.get("resource_availability", 0) < 0.5:
            suggestions.append("Secure team allocation and budget before proceeding")
        if sub_scores.get("timeline_realism", 0) < 0.5:
            suggestions.append("Add buffer time and validate estimates against historical velocity")
        if sub_scores.get("dependency_risk", 0) < 0.5:
            suggestions.append("Identify fallback plans for critical external dependencies")
        return suggestions

    def _compute_confidence(self, submission: dict[str, Any]) -> float:
        evidence_fields: list[str] = [
            "technical_analysis", "resource_analysis",
            "timeline_analysis", "dependency_analysis"
        ]
        filled: int = sum(1 for f in evidence_fields if submission.get(f))
        return filled / len(evidence_fields)
