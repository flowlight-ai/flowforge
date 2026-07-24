"""FlowForge F100 Self-Evolution — 自我进化机制（v7.0 ForgeMindEngine）。

FlowForge 三模式自我进化机制：
- Mode A (Scope Guard): 防御 — 当讨论偏离当前 feat 愿景时温柔提醒
- Mode B (Process Evolution): 防御→改进 — 同类错误反复出现时提出流程改进
- Mode C (Knowledge Evolution): 进攻→成长 — 有价值的知识/方法论沉淀为可复用资产

三模式共享：五级知识成熟度阶梯、知识层级分工、元认知路由、知识对象契约。

统一入口：ForgeMindEngine（按 ADR-012 命名融合，原 SelfEvolutionEngine/M18 已废弃）
"""

from flowforge.evolution.engine import ForgeMindEngine
from flowforge.evolution.knowledge_evolution import KnowledgeEvolution
from flowforge.evolution.maturity import KnowledgeMaturityLadder
from flowforge.evolution.metacognition import MetacognitionRouter
from flowforge.evolution.models import (
    EpisodeCard,
    EvalLedger,
    KnowledgeMaturityLevel,
    KnowledgeObject,
    MethodCard,
    ScopeGuardLog,
    ScopeGuardSignal,
    EvolutionProposal,
)
from flowforge.evolution.process_evolution import ProcessEvolution
from flowforge.evolution.scope_guard import ScopeGuard
from flowforge.evolution.self_dev_base import (
    ApprovalRequiredError,
    AwakeningStageBlockedError,
    DevPlan,
    DevResult,
    DevTask,
    LLMReviewFailedError,
    LoopExecutionRecord,
    MAX_REFLECT_RETRIES,
    ReflectRetryExhaustedError,
    ScopeGuardBlockedError,
    SelfDevError,
    SelfDevLoopBase,
    VerifyResult,
)
from flowforge.evolution.self_dev_code import SelfDevCodeLoop
from flowforge.evolution.self_dev_doc import SelfDevDocLoop
from flowforge.evolution.self_dev_framework import SelfDevFrameworkLoop
from flowforge.evolution.self_dev_review import SelfDevReviewLoop
from flowforge.evolution.self_dev_test import SelfDevTestLoop

__all__ = [
    # Engine
    "ForgeMindEngine",
    # Mode A
    "ScopeGuard",
    "ScopeGuardSignal",
    "ScopeGuardLog",
    # Mode B
    "ProcessEvolution",
    "EvolutionProposal",
    # Mode C
    "KnowledgeEvolution",
    "EpisodeCard",
    "MethodCard",
    "EvalLedger",
    # Shared
    "KnowledgeMaturityLadder",
    "KnowledgeMaturityLevel",
    "KnowledgeObject",
    "MetacognitionRouter",
    # F046 SelfDev 五闭环执行层（v1.1 扩展：doc/code/framework/review/test）
    "SelfDevLoopBase",
    "SelfDevDocLoop",
    "SelfDevCodeLoop",
    "SelfDevFrameworkLoop",
    "SelfDevReviewLoop",
    "SelfDevTestLoop",
    "DevTask",
    "DevPlan",
    "DevResult",
    "VerifyResult",
    "LoopExecutionRecord",
    "SelfDevError",
    "AwakeningStageBlockedError",
    "ScopeGuardBlockedError",
    "ApprovalRequiredError",
    "LLMReviewFailedError",
    "ReflectRetryExhaustedError",
    "MAX_REFLECT_RETRIES",
]
