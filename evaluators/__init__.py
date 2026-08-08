"""FlowForge evaluator framework — base classes and registry only.

FlowForge only retains the abstract base class (EvaluatorAgent), Score model, and
EvaluatorRegistry/EvaluatorConfig/ScoringRule which are generic platform capabilities.
Business-specific evaluator agents are registered by *Forge plugins via Plugin V3
protocol to maintain P8A architecture boundary (no *Forge code in FlowForge core).
"""
from flowforge.evaluators.base import EvaluatorAgent
from flowforge.evaluators.models import Score
from flowforge.evaluators.registry import EvaluatorConfig, EvaluatorRegistry, ScoringRule

__all__ = [
    "Score",
    "EvaluatorAgent",
    "EvaluatorConfig",
    "EvaluatorRegistry",
    "ScoringRule",
]
