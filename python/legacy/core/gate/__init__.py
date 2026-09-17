"""FlowForge Gate 门控框架 — 通用的质量门禁系统。

提供门控模型、投票策略、超时策略、人工审批和编排器，
供所有 *Forge 项目共享使用。
"""

from flowforge.core.gate.models import (
    GateRecord,
    GateStatus,
    GateVerdict,
    Score,
    TaskStatus,
    WorkflowStep,
    WorkflowType,
)
from flowforge.core.gate.voting import (
    VotingStrategy,
    resolve_gate,
    vote_consensus,
    vote_majority,
    vote_weighted,
)
from flowforge.core.gate.timeout import (
    DEFAULT_TIMEOUT_SECONDS,
    GateTimer,
    TimeoutStrategy,
    create_timer_from_config,
)
from flowforge.core.gate.approval import (
    ApprovalRequest,
    ApprovalResponse,
    EscalationChain,
    EscalationLevel,
    HumanApprovalProvider,
    WebSocketApprovalProvider,
    create_approval_provider_from_config,
)
from flowforge.core.gate.registry import (
    GateConfig,
    GateDimensionConfig,
    GateOnRejectConfig,
    GateRegistry,
)
from flowforge.core.gate.orchestrator import GateOrchestrator

__all__ = [
    # models
    "GateRecord",
    "GateStatus",
    "GateVerdict",
    "Score",
    "TaskStatus",
    "WorkflowStep",
    "WorkflowType",
    # voting
    "VotingStrategy",
    "resolve_gate",
    "vote_consensus",
    "vote_majority",
    "vote_weighted",
    # timeout
    "DEFAULT_TIMEOUT_SECONDS",
    "GateTimer",
    "TimeoutStrategy",
    "create_timer_from_config",
    # approval
    "ApprovalRequest",
    "ApprovalResponse",
    "EscalationChain",
    "EscalationLevel",
    "HumanApprovalProvider",
    "WebSocketApprovalProvider",
    "create_approval_provider_from_config",
    # orchestrator
    "GateOrchestrator",
    # registry
    "GateConfig",
    "GateDimensionConfig",
    "GateOnRejectConfig",
    "GateRegistry",
]
