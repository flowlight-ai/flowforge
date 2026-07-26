"""FlowForge External Agent Integration — 三方 Agent 集成层（v7.0 Forge Nurturing体系）。

Forgekin（Forgekin）通过本模块接入三方 Agent 作为能力扩展：
    - Claude Code（CLI + MCP）—— 复杂重构 / 代码生成
    - Codex（API + function calling）—— 推理 / 结构化输出
    - OpenCode（SDK + plugin）—— 开源协作 / 插件扩展
    - Trae（IDE + command）—— IDE 集成 / 实时编辑

核心机制（详见 [doc:decisions/006-external-agent-integration.md]）：
    - ExternalAgentAdapter: 三方 Agent 适配器抽象基类（EX-001/EX-003）
    - ExternalAgentBridge: Forgekin调用入口（EX-003/EX-004）
    - ExternalAgentSharedState: 跨三方 Agent 状态共享（EX-004）
    - ExternalAgentFallback: 失败回退链（EX-007）
    - ExternalAgentCapabilityFusion: 能力融合机制（EX-010）
    - ProviderTransportRegistry: Provider 传输注册表（F241 CL-014）
    - HostInjector: host-owned 安全注入器（F241 CL-015）
    - ACPTransport: ACP 统一传输层（F241 CL-016）
    - CLI NDJSON + stderr 解析器（CL-038）：NDJSONParser / StderrCollector /
      CLIResult / parse_cli_invocation / stream_cli_invocation

EAC v1 七契约（v7.1-§D6.2，详见 design.md）：
    1. Invocation        — ExternalAgentAdapter
    2. Stream            — ACPTransport.stream / ExternalAgentAdapter.stream
    3. Session           — SessionManager（会话隔离与共享）
    4. Capability        — CapabilityRegistry（能力声明与发现，与 ProviderTransportRegistry 互补）
    5. Collaboration     — CollaborationCoordinator（同步/异步/群体协作）
    6. Safety            — guardrails/ 6 个组件（input/system_prompt/tool_allowlist/output/action_confirm/cost_ceiling）
    7. Avatar Sync       — AvatarSyncAdapter（Forgekin形象同步到三方 Agent）
    8. Prompt Config Map — PromptConfigMap（Forgekin系统提示词映射到三方 Agent，提示词外置）

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
from flowforge.core.external_agent.avatar_sync import (
    AvatarSpec,
    AvatarSyncAdapter,
    SyncResult,
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
from flowforge.core.external_agent.capability_registry import (
    CapabilityEntry,
    CapabilityRegistry,
)
from flowforge.core.external_agent.cli_ndjson import (
    CLINDJSONParser,
    CLIResult,
    NDJSONParser,
    StderrCollector,
    parse_cli_invocation,
    stream_cli_invocation,
)
from flowforge.core.external_agent.collaboration_coordinator import (
    CollaborationCoordinator,
    CollaborationHandle,
    CollaborationMode,
    CollaborationResult,
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
from flowforge.core.external_agent.prompt_config_map import (
    PromptConfig,
    PromptConfigMap,
)
from flowforge.core.external_agent.reference_runtime import (
    ReferenceAgentAdapter,
    ReferenceRuntimeConfig,
    run_reference_demo,
)
from flowforge.core.external_agent.registry import ProviderTransportRegistry
from flowforge.core.external_agent.session_manager import (
    SessionInfo,
    SessionManager,
)
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
    # CLI NDJSON + stderr (CL-038)
    "CLINDJSONParser",
    "CLIResult",
    "NDJSONParser",
    "StderrCollector",
    "parse_cli_invocation",
    "stream_cli_invocation",
    # EAC v1 七契约补全（v7.1-§D6.2）
    # 契约 3 Session
    "SessionManager",
    "SessionInfo",
    # 契约 4 Capability
    "CapabilityRegistry",
    "CapabilityEntry",
    # 契约 5 Collaboration
    "CollaborationCoordinator",
    "CollaborationMode",
    "CollaborationResult",
    "CollaborationHandle",
    # 契约 7 Avatar Sync
    "AvatarSyncAdapter",
    "AvatarSpec",
    "SyncResult",
    # 契约 8 Prompt Config Map
    "PromptConfigMap",
    "PromptConfig",
]
