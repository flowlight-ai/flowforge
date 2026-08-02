"""ReferenceRuntime — 三方 Agent Provider 参考运行时（F241 CL-017）。

提供 reference runtime——一个参考实现，让三方 Agent 厂商可以参照实现自己的 plugin。
包含：
    - 文档化的 Manifest 规范（见 config/manifests/*.yaml）
    - 标准 Adapter 实现模板（ReferenceAgentAdapter）
    - 端到端调用示例（run_reference_demo）

设计依据：
    - [doc:review/review.md#13.3] F241 Agent Provider Plugin（CL-017 reference runtime）
    - [doc:decisions/006-external-agent-integration.md] §3 ExternalAgentAdapter 抽象层

铁律遵守：
    - 编程红线 7：使用 ABC + abstractmethod
    - 编程红线 9：使用组合而非继承
    - 所有 I/O 操作使用 async/await

License: MIT
"""

from __future__ import annotations

from typing import Any, AsyncIterator, Optional

from pydantic import BaseModel, Field

from flowforge.core.external_agent.adapter import (
    ExternalAgentAdapter,
    ExternalAgentResult,
)
from flowforge.core.external_agent.host_injection import HostInjector, SandboxConfig
from flowforge.core.external_agent.manifest import AgentProviderManifest
from flowforge.core.tracing import get_logger

logger = get_logger("external_agent.reference_runtime")


class ReferenceRuntimeConfig(BaseModel):
    """参考运行时配置（厂商可参照调整）。"""

    name: str = Field(default="reference_runtime", description="运行时名称")
    version: str = Field(default="1.0.0", description="运行时版本")
    description: str = Field(
        default="F241 CL-017 reference runtime — 厂商可参照实现自己的 plugin",
        description="运行时描述",
    )
    # 默认能力画像（厂商应覆盖）
    default_capabilities: list[str] = Field(
        default_factory=lambda: ["code_generation", "code_review"],
        description="默认能力声明",
    )
    default_blind_spots: list[str] = Field(
        default_factory=lambda: ["未声明盲点——厂商必须覆盖"],
        description="默认盲点声明（厂商必须覆盖）",
    )


class ReferenceAgentAdapter(ExternalAgentAdapter):
    """参考 Adapter 实现（F241 CL-017）。

    厂商可参照此实现自己的 Adapter：
        1. 继承 ExternalAgentAdapter
        2. 实现 invoke() / stream() / get_capability_profile()
        3. 通过 Manifest 驱动（YAML 配置）
        4. 通过 HostInjector 注入安全配置（host-owned）

    详见 [doc:review/review.md#13.3] F241 Agent Provider Plugin

    注意：本参考实现仅返回固定结构，**不调用真实三方 Agent**。
    厂商实现时必须替换为真实调用逻辑。
    """

    def __init__(
        self,
        manifest: AgentProviderManifest,
        host_injector: HostInjector,
        config: Optional[ReferenceRuntimeConfig] = None,
    ) -> None:
        super().__init__(manifest=manifest, host_injector=host_injector)
        self._config = config or ReferenceRuntimeConfig()

    async def invoke(
        self,
        task: str,
        context: dict[str, Any],
        sandbox: Optional[SandboxConfig] = None,
    ) -> ExternalAgentResult:
        """参考 invoke 实现。

        厂商实现要点：
            1. 从 self.prepare_credentials() 获取 token（host-owned）
            2. 使用 sandbox.cwd 作为工作目录
            3. 调用真实三方 Agent（如 subprocess / HTTP / SDK）
            4. 返回 ExternalAgentResult（含 cost / capability_contribution）
        """
        logger.info(
            "reference.invoke provider=%s task_len=%d sandbox=%s",
            self.provider_name,
            len(task),
            sandbox is not None,
        )
        # 参考实现：仅返回固定结构（厂商应替换为真实调用）
        return ExternalAgentResult(
            provider_name=self.provider_name,
            success=True,
            output={
                "task": task,
                "output": "[reference_runtime] 这是一个参考实现，"
                "厂商应替换为真实三方 Agent 调用。",
                "sandbox_cwd": sandbox.cwd if sandbox else None,
            },
            artifacts=[],
            cost={
                "total_tokens": 0,
                "total_calls": 1,
                "total_cost": 0.0,
            },
            capability_contribution=self.get_capability_profile(),
        )

    async def stream(
        self,
        task: str,
        context: dict[str, Any],
        sandbox: Optional[SandboxConfig] = None,
    ) -> AsyncIterator[str]:
        """参考 stream 实现（EX-009 流式语义）。"""
        logger.info(
            "reference.stream provider=%s task_len=%d",
            self.provider_name,
            len(task),
        )
        # 参考实现：分片输出（厂商应替换为真实流式调用）
        yield "[reference_runtime] 开始流式输出\n"
        yield f"task: {task}\n"
        yield "[reference_runtime] 流式输出结束\n"

    def get_capability_profile(self) -> dict[str, Any]:
        """参考能力画像实现（EX-002）。

        厂商实现要点：
            1. 必须包含 capabilities（来自 Manifest）
            2. 必须包含 blind_spots（来自 Manifest，EX-002 必填）
            3. 应包含 strengths（详细优势）
            4. 应包含 best_practices（最佳使用场景）
            5. 应包含 anti_patterns（反模式）
        """
        return {
            "provider_name": self.manifest.provider_name,
            "display_name": self.manifest.display_name,
            "capabilities": list(self.manifest.capabilities),
            "blind_spots": list(self.manifest.blind_spots),
            "strengths": [
                "参考实现——厂商应声明自己的优势",
            ],
            "best_practices": [
                "参考实现——厂商应声明最佳使用场景",
            ],
            "anti_patterns": [
                "参考实现——厂商应声明反模式（不该用此 Agent 的场景）",
            ],
        }


async def run_reference_demo(
    manifest: AgentProviderManifest,
    host_injector: HostInjector,
    task: str,
) -> dict[str, Any]:
    """端到端参考演示（厂商可参照测试自己的 Adapter）。

    Args:
        manifest: Provider Manifest。
        host_injector: host-owned 注入器。
        task: 演示任务。

    Returns:
        演示结果字典（含 invoke / stream / capability_profile 三部分）。
    """
    adapter = ReferenceAgentAdapter(
        manifest=manifest,
        host_injector=host_injector,
    )

    # 1. 同步调用
    invoke_result = await adapter.invoke(
        task=task, context={"demo": True}, sandbox=None
    )

    # 2. 流式调用
    stream_chunks: list[str] = []
    async for chunk in adapter.stream(task=task, context={"demo": True}):
        stream_chunks.append(chunk)

    # 3. 能力画像
    profile = adapter.get_capability_profile()

    return {
        "provider": manifest.provider_name,
        "invoke_result": invoke_result.model_dump(),
        "stream_chunks": stream_chunks,
        "capability_profile": profile,
    }
