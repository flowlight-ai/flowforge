"""AgentProviderManifest — 三方 Agent Provider 声明式 Manifest 数据模型。

按 F241 (CL-014) 定义声明式 Manifest：每个三方 Agent 厂商提交一份 Manifest
声明自己的能力/协议/传输方式，host 维护 ProviderTransportRegistry 注册表，
Forgekin（Forgekin）通过查询注册表发现能力。

设计依据：
    - [doc:decisions/006-external-agent-integration.md] §3 ExternalAgentAdapter 抽象层
    - [doc:review/review.md#第九章§9.2] EX-001/EX-002/EX-008 能力扩展 + 能力画像 + 能力发现
    - [doc:review/review.md#13.3] F241 Agent Provider Plugin（CL-014）
    - [doc:design/naming-contract.md#2.2] Forgekin / [doc:design/naming-contract.md#2.12] 能力画像

铁律遵守：
    - 铁律 5：禁止硬编码密钥/路径/端口（required_env_vars 仅声明变量名，不存值）
    - 编程红线 9：使用组合（Pydantic 字段）表达 Manifest 维度
    - 编程红线 11：配置驱动（YAML Manifest），代码不写死厂商能力

License: MIT
"""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, field_validator


class AgentProtocol(str, Enum):
    """三方 Agent 协议类型。

    详见 [doc:review/review.md#第九章§9.2] EX-003：
        - claude code: CLI + MCP
        - codex: API + function calling
        - opencode: SDK + plugin
        - trae: IDE + command
    """

    CLI = "cli"
    API = "api"
    SDK = "sdk"
    IDE = "ide"
    MCP = "mcp"


class AgentTransport(str, Enum):
    """三方 Agent 传输方式。

    详见 [doc:review/review.md#13.3] F241 ACP transport：
        ACP 1.0 over stdio / SSE / WebSocket / HTTP
    """

    STDIO = "stdio"
    SSE = "sse"
    WEBSOCKET = "websocket"
    HTTP = "http"


class SafetyLevel(str, Enum):
    """三方 Agent 安全等级。

    详见 [doc:review/review.md#第九章§9.2] EX-005 安全沙箱：
        - readonly: 只读，不修改任何文件
        - normal: 可读写 worktree 内文件
        - dangerous: 可执行不可逆操作（需 operator 确认，EX-005 L5）
    """

    READONLY = "readonly"
    NORMAL = "normal"
    DANGEROUS = "dangerous"


class AgentProviderManifest(BaseModel):
    """Agent Provider 声明式 Manifest（F241 CL-014）。

    每个三方 Agent 厂商提交一份 Manifest 声明自己的能力/协议/传输方式。
    host 维护 ProviderTransportRegistry 注册表，Forgekin通过查询注册表发现能力。

    详见:
        - [doc:review/review.md#13.3] F241 Agent Provider Plugin
        - [doc:decisions/006-external-agent-integration.md] §4 首批接入

    Attributes:
        provider_name: Provider 唯一标识（如 "anthropic.claude_code"）。
        display_name: 展示名（如 "Claude Code"）。
        version: Manifest 版本号（语义化版本）。
        protocol: 通信协议（cli / api / sdk / ide / mcp）。
        transport: 传输方式（stdio / sse / websocket / http）。
        capabilities: 能力声明列表（如 code_generation / code_review）。
        blind_spots: 能力盲点列表（EX-002 必填，决定谁该 review 谁）。
        timeout_seconds: 单次调用超时时间。
        retry_policy: 重试策略（max_attempts / backoff_seconds）。
        cost_per_token: 按 token 计费单价（EX-006 成本治理）。
        cost_per_call: 按次计费单价（EX-006 成本治理）。
        safety_level: 安全等级（readonly / normal / dangerous）。
        required_env_vars: 所需环境变量名列表（不存值，仅声明依赖）。
        required_permissions: 所需权限列表（file_read / file_write / git_operations）。
    """

    provider_name: str = Field(..., description="Provider 唯一标识")
    display_name: str = Field(..., description="展示名")
    version: str = Field(default="1.0.0", description="Manifest 版本号")
    protocol: AgentProtocol = Field(..., description="通信协议")
    transport: AgentTransport = Field(..., description="传输方式")
    capabilities: list[str] = Field(
        default_factory=list, description="能力声明列表"
    )
    blind_spots: list[str] = Field(
        default_factory=list, description="能力盲点列表（EX-002）"
    )
    timeout_seconds: int = Field(default=300, gt=0, description="单次调用超时（秒）")
    retry_policy: dict[str, Any] = Field(
        default_factory=dict, description="重试策略"
    )
    cost_per_token: float = Field(default=0.0, ge=0.0, description="按 token 计费")
    cost_per_call: float = Field(default=0.0, ge=0.0, description="按次计费")
    safety_level: SafetyLevel = Field(
        default=SafetyLevel.NORMAL, description="安全等级"
    )
    required_env_vars: list[str] = Field(
        default_factory=list, description="所需环境变量名列表（仅声明，不存值）"
    )
    required_permissions: list[str] = Field(
        default_factory=list, description="所需权限列表"
    )

    @field_validator("provider_name")
    @classmethod
    def _validate_provider_name(cls, v: str) -> str:
        """provider_name 必须是 vendor.agent 形式（如 anthropic.claude_code）。"""
        if "." not in v:
            raise ValueError(
                f"provider_name 必须是 'vendor.agent' 形式， got: {v}"
            )
        return v

    model_config = {"use_enum_values": True}
