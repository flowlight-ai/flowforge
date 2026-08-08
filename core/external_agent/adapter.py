"""ExternalAgentAdapter — 三方 Agent 适配器抽象基类。

按 EX-001 升级为"能力扩展"思维，不是"工具调用"思维。
Forgekin可加载 claude code 的代码能力、codex 的推理能力、
opencode 的开源生态能力、trae 的 IDE 能力。

设计依据：
    - [doc:review/review.md#第九章§9.2] EX-001/EX-002/EX-003 能力扩展 + 能力画像 + 协议适配层
    - [doc:decisions/006-external-agent-integration.md] §3 ExternalAgentAdapter 抽象层
    - [doc:design/naming-contract.md#2.12] 能力画像

铁律遵守：
    - 铁律 3：依赖通过构造函数注入（manifest / host_injector）
    - 编程红线 9：使用组合（manifest + host_injector）而非继承表达适配能力
    - 编程红线 7：使用 ABC + abstractmethod 定义抽象基类
    - 所有 I/O 操作使用 async/await

License: MIT
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, Field

from flowforge.core.external_agent.host_injection import HostInjector, SandboxConfig
from flowforge.core.external_agent.manifest import AgentProviderManifest
from flowforge.core.tracing import get_logger

logger = get_logger("external_agent.adapter")


class ExternalAgentResult(BaseModel):
    """三方 Agent 调用结果。

    封装三方 Agent 的输出、成本、能力画像贡献等信息，
    供 ExternalAgentBridge 进一步处理（融合到Forgekin主画像）。

    Attributes:
        provider_name: 调用的三方 Agent Provider 名称。
        success: 是否调用成功。
        output: 三方 Agent 的原始输出（文本 / 代码 / 结构化数据）。
        artifacts: 产出物列表（如修改的文件路径、生成的代码片段）。
        cost: 成本信息（token 数 / 调用次数 / 货币成本，EX-006）。
        capability_contribution: 能力画像贡献（EX-010 能力融合输入）。
        error: 失败时的错误信息。
        timestamp: 调用完成时间戳。
    """

    provider_name: str = Field(..., description="Provider 名称")
    success: bool = Field(..., description="是否成功")
    output: Any = Field(default=None, description="三方 Agent 原始输出")
    artifacts: list[dict[str, Any]] = Field(
        default_factory=list, description="产出物列表"
    )
    cost: dict[str, Any] = Field(
        default_factory=dict, description="成本信息（EX-006）"
    )
    capability_contribution: dict[str, Any] = Field(
        default_factory=dict, description="能力画像贡献（EX-010）"
    )
    error: str | None = Field(default=None, description="错误信息")
    timestamp: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        description="调用完成时间戳",
    )


class ExternalAgentAdapter(ABC):
    """三方 Agent 适配器抽象基类。

    按 EX-001 升级为"能力扩展"思维，不是"工具调用"思维。
    Forgekin可加载 claude code 的代码能力、codex 的推理能力、
    opencode 的开源生态能力、trae 的 IDE 能力。

    详见 [doc:review/review.md#第九章§9.2] EX-001~EX-010

    子类职责：
        1. 实现 invoke() — 同步调用三方 Agent
        2. 实现 stream() — 流式调用三方 Agent（EX-009）
        3. 实现 get_capability_profile() — 返回能力画像（EX-002）

    设计要点：
        - Manifest 驱动：所有元数据来自 AgentProviderManifest（YAML 配置）
        - host-owned：sandbox / credentials 由 HostInjector 注入（CL-015）
        - 能力画像必填：blind_spots 决定谁该 review 谁（EX-002）
    """

    def __init__(
        self,
        manifest: AgentProviderManifest,
        host_injector: HostInjector,
    ) -> None:
        """注入 Manifest 和 HostInjector。

        Args:
            manifest: Provider 声明式 Manifest（YAML 配置驱动）。
            host_injector: host-owned 安全注入器（CL-015）。
        """
        self.manifest = manifest
        self.host_injector = host_injector

    @property
    def provider_name(self) -> str:
        """Provider 名称快捷访问。"""
        return self.manifest.provider_name

    @abstractmethod
    async def invoke(
        self,
        task: str,
        context: dict[str, Any],
        sandbox: SandboxConfig | None = None,
    ) -> ExternalAgentResult:
        """同步调用三方 Agent 完成任务。

        Args:
            task: 任务描述（自然语言）。
            context: 调用上下文（含 forgekin_id / shared_state / history）。
            sandbox: sandbox 配置（由 HostInjector 注入，EX-005）。

        Returns:
            ExternalAgentResult 调用结果。
        """
        raise NotImplementedError

    @abstractmethod
    async def stream(
        self,
        task: str,
        context: dict[str, Any],
        sandbox: SandboxConfig | None = None,
    ) -> AsyncIterator[str]:
        """流式调用三方 Agent（EX-009 流式语义）。

        用于长任务场景（如 claude code 跑完整测试套件需 10 分钟），
        边接收边处理，避免阻塞。

        Args:
            task: 任务描述。
            context: 调用上下文。
            sandbox: sandbox 配置。

        Yields:
            响应片段字符串。
        """
        raise NotImplementedError
        # 下面这行是为了让 mypy 知道这是 async iterator（不会执行）
        yield ""  # pragma: no cover

    @abstractmethod
    def get_capability_profile(self) -> dict[str, Any]:
        """返回三方 Agent 的能力画像（EX-002）。

        能力画像必须同时写"必杀技"和"致命弱点"——盲点决定谁该 review 谁。

        Returns:
            能力画像字典，至少包含：
                - capabilities: 能力列表（来自 Manifest）
                - blind_spots: 盲点列表（来自 Manifest）
                - strengths: 详细优势描述
                - best_practices: 最佳使用场景
                - anti_patterns: 反模式（不该用此 Agent 的场景）
        """
        raise NotImplementedError

    def prepare_sandbox(
        self,
        worktree_path: str,
        network_allowlist: list[str] | None = None,
    ) -> SandboxConfig:
        """准备 sandbox 配置（host-owned，CL-015）。

        子类可调用此方法获取 sandbox 配置，无需自己拼装。
        """
        return self.host_injector.inject_sandbox(
            provider_name=self.provider_name,
            worktree_path=worktree_path,
            network_allowlist=network_allowlist,
        )

    def prepare_credentials(self) -> dict[str, str]:
        """准备凭据环境变量（host-owned，CL-015）。

        子类可调用此方法获取已脱敏的环境变量字典。
        """
        return self.host_injector.inject_credentials(
            provider_name=self.provider_name,
            required_env_vars=self.manifest.required_env_vars,
        )
