"""FlowForge self-evolution layer — three modes + maturity ladder + metacognition.

Public API:
    ForgeMindEngine — unified entry point with evaluate() + execute()
    ScopeGuard / ProcessEvolution / KnowledgeEvolution — three modes
    KnowledgeMaturityLadder — five-level promotion/demotion
    MetacognitionRouter — three-signal routing
"""

from __future__ import annotations

from flowforge.evolution.engine import ForgeMindEngine
from flowforge.evolution.knowledge_evolution import KnowledgeEvolution
from flowforge.evolution.maturity import KnowledgeMaturityLadder
from flowforge.evolution.metacognition import MetacognitionRouter
from flowforge.evolution.models import (
    EpisodeCard,
    EvalLedger,
    EvolutionProposal,
    KnowledgeMaturityLevel,
    KnowledgeObject,
    MethodCard,
    ScopeGuardLog,
    ScopeGuardSignal,
)
from flowforge.evolution.process_evolution import ProcessEvolution
from flowforge.evolution.scope_guard import ScopeGuard

__all__ = [
    "EpisodeCard",
    "EvalLedger",
    "EvolutionProposal",
    "KnowledgeEvolution",
    "KnowledgeMaturityLadder",
    "KnowledgeMaturityLevel",
    "KnowledgeObject",
    "MetacognitionRouter",
    "MethodCard",
    "ProcessEvolution",
    "ScopeGuard",
    "ScopeGuardLog",
    "ScopeGuardSignal",
    "ForgeMindEngine",
]
