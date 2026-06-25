"""FlowForge security evaluator agent.

Evaluates privacy compliance, data security, and attack surface.
"""
from __future__ import annotations

from typing import Any

from flowforge.evaluators.models import Score
from flowforge.evaluators.base import EvaluatorAgent


class SecurityEvaluatorAgent(EvaluatorAgent):
    name: str = "security_evaluator"
    description: str = "Evaluates privacy compliance, data security, and attack surface"
    default_mode: str | None = "react"

    async def evaluate_dimension(
        self, submission: dict[str, Any], dimension_config: dict[str, Any]
    ) -> Score:
        weights: dict[str, float] = dimension_config.get("weights", {
            "privacy_compliance": 0.3,
            "data_security": 0.3,
            "attack_surface": 0.2,
            "compliance_posture": 0.2,
        })

        privacy_score: float = self._assess_privacy_compliance(submission)
        data_score: float = self._assess_data_security(submission)
        attack_score: float = self._assess_attack_surface(submission)
        compliance_score: float = self._assess_compliance_posture(submission)

        sub_scores: dict[str, float] = {
            "privacy_compliance": privacy_score,
            "data_security": data_score,
            "attack_surface": attack_score,
            "compliance_posture": compliance_score,
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
            dimension="security",
            value=round(composite, 4),
            weight=dimension_config.get("weight", 1.0),
            rationale=rationale,
            suggestions=suggestions,
            confidence=confidence,
        )

    def _assess_privacy_compliance(self, submission: dict[str, Any]) -> float:
        score: float = 0.0
        privacy: dict[str, Any] = submission.get("privacy_analysis", {})

        if privacy.get("data_classification_done"):
            score += 0.2
        if privacy.get("pii_identified"):
            score += 0.15
        if privacy.get("consent_mechanism"):
            score += 0.2
        if privacy.get("data_retention_policy"):
            score += 0.15
        if privacy.get("privacy_impact_assessment"):
            score += 0.2
        if privacy.get("right_to_deletion"):
            score += 0.1

        return min(1.0, score)

    def _assess_data_security(self, submission: dict[str, Any]) -> float:
        score: float = 0.0
        data_sec: dict[str, Any] = submission.get("data_security_analysis", {})

        if data_sec.get("encryption_at_rest"):
            score += 0.2
        if data_sec.get("encryption_in_transit"):
            score += 0.2
        if data_sec.get("access_controls"):
            score += 0.2
        if data_sec.get("audit_logging"):
            score += 0.15
        if data_sec.get("key_management"):
            score += 0.15
        if data_sec.get("backup_strategy"):
            score += 0.1

        return min(1.0, score)

    def _assess_attack_surface(self, submission: dict[str, Any]) -> float:
        score: float = 0.0
        attack: dict[str, Any] = submission.get("attack_surface_analysis", {})

        if attack.get("threat_model_completed"):
            score += 0.25
        if attack.get("input_validation"):
            score += 0.2
        if attack.get("auth_mechanism"):
            score += 0.2
        if attack.get("rate_limiting"):
            score += 0.15

        exposed_endpoints: int = int(attack.get("exposed_endpoints", 0))
        if exposed_endpoints == 0:
            score += 0.1
        elif exposed_endpoints <= 5:
            score += 0.05

        if attack.get("penetration_test_passed"):
            score += 0.1

        return min(1.0, score)

    def _assess_compliance_posture(self, submission: dict[str, Any]) -> float:
        score: float = 0.0
        compliance: dict[str, Any] = submission.get("compliance_analysis", {})

        required_standards: list[Any] = compliance.get("required_standards", [])
        met_standards: list[Any] = compliance.get("met_standards", [])

        if required_standards:
            coverage: float = len(met_standards) / len(required_standards)
            score += min(0.4, coverage * 0.4)
        else:
            score += 0.2

        if compliance.get("security_review_completed"):
            score += 0.2
        if compliance.get("vulnerability_scan_passed"):
            score += 0.2
        if compliance.get("incident_response_plan"):
            score += 0.2

        return min(1.0, score)

    def _build_rationale(
        self, submission: dict[str, Any], sub_scores: dict[str, float]
    ) -> str:
        parts: list[str] = []
        for dim, val in sub_scores.items():
            level: str = "high" if val >= 0.7 else "medium" if val >= 0.4 else "low"
            parts.append(f"{dim}: {level} ({val:.2f})")
        return "Security assessment — " + "; ".join(parts)

    def _build_suggestions(
        self, submission: dict[str, Any], sub_scores: dict[str, float]
    ) -> list[str]:
        suggestions: list[str] = []
        if sub_scores.get("privacy_compliance", 0) < 0.5:
            suggestions.append("Complete privacy impact assessment and data classification")
        if sub_scores.get("data_security", 0) < 0.5:
            suggestions.append("Implement encryption at rest and in transit with proper key management")
        if sub_scores.get("attack_surface", 0) < 0.5:
            suggestions.append("Conduct threat modeling and ensure input validation on all endpoints")
        if sub_scores.get("compliance_posture", 0) < 0.5:
            suggestions.append("Map required compliance standards and close gaps in met standards")
        return suggestions

    def _compute_confidence(self, submission: dict[str, Any]) -> float:
        evidence_fields: list[str] = [
            "privacy_analysis", "data_security_analysis",
            "attack_surface_analysis", "compliance_analysis"
        ]
        filled: int = sum(1 for f in evidence_fields if submission.get(f))
        return filled / len(evidence_fields)
