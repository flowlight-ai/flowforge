"""FlowForge External Agent Integration — 三方 Agent 集成层（v7.0 育灵体系）。

灵智体（Forgekin）通过本模块接入三方 Agent 作为能力扩展：
    - Claude Code（CLI + MCP）—— 复杂重构 / 代码生成
    - Codex（API + function calling）—— 推理 / 结构化输出
    - OpenCode（SDK + plugin）—— 开源协作 / 插件扩展
    - Trae（IDE + command）—— IDE 集成 / 实时编辑

核心机制（详见 [doc:decisions/006-external-agent-integration.md]）：
    - ExternalAgentAdapter: 三方 Agent 适配器抽象基类（EX-001/EX-003）
    - ExternalAgentBridge: 灵智体调用入口（EX-003/EX-004）
    - ExternalAgentSharedState: 跨三方 Agent 状态共享（EX-004）
    - ExternalAgentFallback: 失败回退链（EX-007）
    - ExternalAgentCapabilityFusion: 能力融合机制（EX-010）
    - ProviderTransportRegistry: Provider 传输注册表（F241 CL-014）
    - HostInjector: host-owned 安全注入器（F241 CL-015）
    - ACPTransport: ACP 统一传输层（F241 CL-016）

六层 Guardrails（EX-005）：
    L1 InputValidation / L2 SystemPrompt / L3 ToolAllowlist
    L4 OutputValidation / L5 ActionConfirm / L6 CostCeiling（EX-006）

License: MIT
"""

from __future__ import annotations

from flowforge.core.external_agent.acp_transport import (
    ACPMessage,
    ACPResponse,
    ACPTransport,
    TransportBackend,
)
from flowforge.core.external_agent.adapter import (
    ExternalAgentAdapter,
    ExternalAgentResult,
)
from flowforge.core.external_agent.bridge import (
    BridgeInvokeRequest,
    BridgeInvokeResponse,
    ExternalAgentBridge,
)
from flowforge.core.external_agent.capability_fusion import (
    ExternalAgentCapabilityFusion,
    FusionConfig,
    FusionResult,
)
from flowforge.core.external_agent.fallback import (
    ExternalAgentFallback,
    FallbackAttempt,
    FallbackResult,
)
from flowforge.core.external_agent.host_injection import (
    CredentialStore,
    HostInjector,
    SandboxConfig,
)
from flowforge.core.external_agent.manifest import (
    AgentProtocol,
    AgentProviderManifest,
    AgentTransport,
    SafetyLevel,
)
from flowforge.core.external_agent.reference_runtime import (
    ReferenceAgentAdapter,
    ReferenceRuntimeConfig,
    run_reference_demo,
)
from flowforge.core.external_agent.registry import ProviderTransportRegistry
from flowforge.core.external_agent.shared_state import (
    ExternalAgentSharedState,
    SharedStateEntry,
    SharedStateStore,
)
from flowforge.core.external_agent.worktree import (
    AuditEntry,
    ExternalAgentWorktree,
    WorktreeConfig,
)

__all__ = [
    # Manifest
    "AgentProviderManifest",
    "AgentProtocol",
    "AgentTransport",
    "SafetyLevel",
    # Adapter
    "ExternalAgentAdapter",
    "ExternalAgentResult",
    # Bridge
    "ExternalAgentBridge",
    "BridgeInvokeRequest",
    "BridgeInvokeResponse",
    # Registry
    "ProviderTransportRegistry",
    # Host injection
    "HostInjector",
    "CredentialStore",
    "SandboxConfig",
    # ACP transport
    "ACPTransport",
    "ACPMessage",
    "ACPResponse",
    "TransportBackend",
    # Shared state
    "ExternalAgentSharedState",
    "SharedStateStore",
    "SharedStateEntry",
    # Fallback
    "ExternalAgentFallback",
    "FallbackAttempt",
    "FallbackResult",
    # Capability fusion
    "ExternalAgentCapabilityFusion",
    "FusionConfig",
    "FusionResult",
    # Worktree
    "ExternalAgentWorktree",
    "WorktreeConfig",
    "AuditEntry",
    # Reference runtime
    "ReferenceAgentAdapter",
    "ReferenceRuntimeConfig",
    "run_reference_demo",
]
