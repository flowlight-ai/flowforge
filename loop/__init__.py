"""FlowForge Loop Engine — Harness sub-module for autonomous iterative execution.

Loop Engine is the 5th component of the Harness layer, providing:
- Planner: Decompose tasks into executable steps
- Worker: Execute via HybridExecutor (reuse existing engine)
- Verifier: Business-level quality verification
- Reflector: Analyze failures and generate improvements
- Memory: Map to existing 5 memory types

Key principle: LoopExecutor wraps HybridExecutor, not replaces it.
"""

from flowforge.loop.state import LoopState, LoopResult, LoopPhase, Verdict, Reflection, LoopNestingError
from flowforge.loop.executor import LoopExecutor
from flowforge.loop.planner import LoopPlanner, LLMPlanner
from flowforge.loop.verifier import LoopVerifier, AgentJudgeVerifier, RuleBasedVerifier, SchemaVerifier, TestSuiteVerifier, MultiJudgeVerifier, create_verifier
from flowforge.loop.reflector import LoopReflector, ReflexionReflector
from flowforge.loop.registry import LoopRegistry, LoopTemplateConfig
from flowforge.loop.parallel import ParallelWorkerResult, execute_parallel_workers

__all__ = [
    "LoopState", "LoopResult", "LoopPhase", "Verdict", "Reflection", "LoopNestingError",
    "LoopExecutor",
    "LoopPlanner", "LLMPlanner",
    "LoopVerifier", "AgentJudgeVerifier", "RuleBasedVerifier", "SchemaVerifier", "TestSuiteVerifier", "MultiJudgeVerifier", "create_verifier",
    "LoopReflector", "ReflexionReflector",
    "LoopRegistry", "LoopTemplateConfig",
    "ParallelWorkerResult", "execute_parallel_workers",
]
