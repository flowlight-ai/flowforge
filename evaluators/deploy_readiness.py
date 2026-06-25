"""FlowForge deploy readiness evaluator agent.

Evaluates configuration readiness, environment readiness, rollback plan, and monitoring readiness.
"""
from __future__ import annotations

from typing import Any

from flowforge.evaluators.models import Score
from flowforge.evaluators.base import EvaluatorAgent


class DeployReadinessEvaluatorAgent(EvaluatorAgent):
    name: str = "deploy_readiness_evaluator"
    description: str = "Evaluates configuration readiness, environment readiness, rollback plan, and monitoring readiness"
    default_mode: str | None = "react"

    async def evaluate_dimension(
        self, submission: dict[str, Any], dimension_config: dict[str, Any]
    ) -> Score:
        weights: dict[str, float] = dimension_config.get("weights", {
            "configuration_readiness": 0.25,
            "environment_readiness": 0.25,
            "rollback_plan": 0.25,
            "monitoring_readiness": 0.25,
        })

        config_score: float = self._assess_configuration_readiness(submission)
        env_score: float = self._assess_environment_readiness(submission)
        rollback_score: float = self._assess_rollback_plan(submission)
        monitoring_score: float = self._assess_monitoring_readiness(submission)

        sub_scores: dict[str, float] = {
            "configuration_readiness": config_score,
            "environment_readiness": env_score,
            "rollback_plan": rollback_score,
            "monitoring_readiness": monitoring_score,
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
            dimension="deploy_readiness",
            value=round(composite, 4),
            weight=dimension_config.get("weight", 1.0),
            rationale=rationale,
            suggestions=suggestions,
            confidence=confidence,
        )

    def _assess_configuration_readiness(self, submission: dict[str, Any]) -> float:
        score: float = 0.0
        deploy: dict[str, Any] = submission.get("deploy_analysis", {})

        if deploy.get("config_managed"):
            score += 0.25
        if deploy.get("secrets_managed"):
            score += 0.25
        if deploy.get("env_specific_config"):
            score += 0.25
        if deploy.get("config_validated"):
            score += 0.25

        return min(1.0, score)

    def _assess_environment_readiness(self, submission: dict[str, Any]) -> float:
        score: float = 0.0
        deploy: dict[str, Any] = submission.get("deploy_analysis", {})

        if deploy.get("staging_tested"):
            score += 0.25
        if deploy.get("infrastructure_provisioned"):
            score += 0.25
        if deploy.get("database_migrations_ready"):
            score += 0.25
        if deploy.get("scaling_configured"):
            score += 0.25

        return min(1.0, score)

    def _assess_rollback_plan(self, submission: dict[str, Any]) -> float:
        score: float = 0.0
        deploy: dict[str, Any] = submission.get("deploy_analysis", {})

        if deploy.get("rollback_procedure_documented"):
            score += 0.25
        if deploy.get("rollback_tested"):
            score += 0.25
        if deploy.get("feature_flags_available"):
            score += 0.25
        if deploy.get("data_migration_reversible"):
            score += 0.25

        return min(1.0, score)

    def _assess_monitoring_readiness(self, submission: dict[str, Any]) -> float:
        score: float = 0.0
        deploy: dict[str, Any] = submission.get("deploy_analysis", {})

        if deploy.get("health_checks_configured"):
            score += 0.25
        if deploy.get("alerts_set_up"):
            score += 0.25
        if deploy.get("dashboards_ready"):
            score += 0.25
        if deploy.get("log_aggregation_configured"):
            score += 0.25

        return min(1.0, score)

    def _build_rationale(
        self, submission: dict[str, Any], sub_scores: dict[str, float]
    ) -> str:
        parts: list[str] = []
        for dim, val in sub_scores.items():
            level: str = "high" if val >= 0.7 else "medium" if val >= 0.4 else "low"
            parts.append(f"{dim}: {level} ({val:.2f})")
        return "Deploy readiness assessment — " + "; ".join(parts)

    def _build_suggestions(
        self, submission: dict[str, Any], sub_scores: dict[str, float]
    ) -> list[str]:
        suggestions: list[str] = []
        if sub_scores.get("configuration_readiness", 0) < 0.5:
            suggestions.append("Externalize all configuration and manage secrets securely")
        if sub_scores.get("environment_readiness", 0) < 0.5:
            suggestions.append("Validate staging environment and ensure infrastructure is provisioned")
        if sub_scores.get("rollback_plan", 0) < 0.5:
            suggestions.append("Document and test rollback procedures; consider feature flags for gradual rollout")
        if sub_scores.get("monitoring_readiness", 0) < 0.5:
            suggestions.append("Set up health checks, alerts, dashboards, and log aggregation before deployment")
        return suggestions

    def _compute_confidence(self, submission: dict[str, Any]) -> float:
        evidence_fields: list[str] = ["deploy_analysis"]
        filled: int = sum(1 for f in evidence_fields if submission.get(f))
        return filled / len(evidence_fields)
