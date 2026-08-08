"""FlowForge base evaluator agent for dimension scoring.

All evaluator agents inherit from EvaluatorAgent and implement the
evaluate_dimension method to produce a Score for a specific dimension.
"""
from __future__ import annotations

from abc import abstractmethod
from typing import Any

from flowforge.core.base_agent import AgentInput, AgentOutput, BaseAgent
from flowforge.evaluators.models import Score


class EvaluatorAgent(BaseAgent):
    name: str = "evaluator"
    description: str = "Base evaluator agent for dimension scoring"
    default_mode: str | None = "react"

    @abstractmethod
    async def evaluate_dimension(
        self, submission: dict[str, Any], dimension_config: dict[str, Any]
    ) -> Score:
        ...

    async def execute(self, input: AgentInput) -> AgentOutput:
        submission: dict[str, Any] = input.params.get("submission", {})
        dimension_config: dict[str, Any] = input.params.get("dimension_config", {})

        score: Score = await self.evaluate_dimension(submission, dimension_config)

        return AgentOutput(
            result={
                "score": {
                    "value": score.value,
                    "rationale": score.rationale,
                    "suggestions": score.suggestions,
                    "confidence": score.confidence,
                }
            },
            metadata={
                "dimension": score.dimension,
                "weight": score.weight,
                "weighted_value": score.weighted_value,
            },
            state_updates=getattr(input, 'state', None) or {},
        )
