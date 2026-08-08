"""FlowForge v6.0 Harness Layer - Agent Control System.

Provides four guardrails for AI Agent control:
1. Context Engineering - Dynamic knowledge injection
2. Architecture Constraints - Dependency validation
3. Feedback Loop - Quality evaluation
4. Entropy Management - Technical debt and rule evolution

Plus infrastructure:
5. Permission Pipeline - deny→ask→allow
6. Session Manager - Context compression and handoff
"""

from flowforge.harness.context_engine import ContextEngine
from flowforge.harness.entropy_manager import (
    DebtItem,
    DebtSeverity,
    DebtStatus,
    DebtTracker,
    DocEntry,
    DocGardener,
    EntropyManager,
    EvolvingRule,
    GarbageCollection,
    GCSchedule,
    RuleEvolution,
    RuleLifecycle,
)
from flowforge.harness.feedback_loop import (
    EVAL_MODE_FULL,
    EVAL_MODE_LIGHTWEIGHT,
    EVAL_MODE_SKIP,
    GATE_CONDITIONAL,
    GATE_FAIL,
    GATE_PASS,
    ClassificationGate,
    EvaluationMode,
    FeedbackLoop,
    FeedbackResult,
)
from flowforge.harness.orchestrator import HarnessOrchestrator
from flowforge.harness.session_manager import SessionManager

__all__ = [
    "HarnessOrchestrator",
    "ContextEngine",
    "SessionManager",
    "FeedbackLoop", "FeedbackResult",
    "EvaluationMode", "ClassificationGate",
    "EVAL_MODE_FULL", "EVAL_MODE_LIGHTWEIGHT", "EVAL_MODE_SKIP",
    "GATE_PASS", "GATE_CONDITIONAL", "GATE_FAIL",
    "EntropyManager",
    "DocGardener", "DocEntry",
    "DebtTracker", "DebtItem", "DebtSeverity", "DebtStatus",
    "RuleEvolution", "EvolvingRule", "RuleLifecycle",
    "GarbageCollection", "GCSchedule",
]
