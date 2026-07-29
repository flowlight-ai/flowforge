"""TraeAdapter — Trae 适配器实现。

按 EX-001/EX-002 实现 Trae 三方 Agent 适配器：
    - 协议：IDE + command
    - 传输：websocket
    - 擅长：IDE 集成、实时编辑、可视化调试
    - 盲点：命令行长任务弱、无头环境支持差

设计依据：
    - [doc:review/review.md#第九章§9.2] EX-001/EX-002/EX-003
    - [doc:decisions/006-external-agent-integration.md] §4 首批接入

铁律遵守：
    - 铁律 5：禁止硬编码密钥（TRAE_API_KEY 通过 HostInjector 注入）
    - 所有 I/O 操作使用 async/await

License: MIT
"""

from __future__ import annotations

from typing import Any, AsyncIterator, Optional

from flowforge.core.external_agent.adapter import (
    ExternalAgentAdapter,
    ExternalAgentResult,
)
from flowforge.core.external_agent.host_injection import SandboxConfig
from flowforge.core.external_agent.manifest import AgentProviderManifest
from flowforge.core.tracing import get_logger

logger = get_logger("external_agent.adapter.trae")


class TraeAdapter(ExternalAgentAdapter):
    """Trae Adapter（IDE + command 协议）。

    能力画像（EX-002）：
        - 擅长：IDE 集成、实时编辑、可视化调试、上下文感知
        - 盲点：命令行长任务弱、无头环境支持差、CI/CD 集成弱

    详见 [doc:review/review.md#第九章§9.2] EX-001~EX-010
    """

    CAPABILITY_PROFILE: dict[str, Any] = {
        "provider_name": "bytedance.trae",
        "display_name": "Trae",
        "capabilities": [
            "ide_integration",
            "realtime_editing",
            "visual_debugging",
            "context_aware",
            "code_generation",
        ],
        "blind_spots": [
            "命令行长任务弱",
            "无头环境支持差",
            "CI/CD 集成弱",
        ],
        "strengths": [
            "IDE 内实时编辑与可视化反馈",
            "上下文感知强（理解项目结构）",
            "调试场景下的可视化能力强",
        ],
        "best_practices": [
            "IDE 内开发：作为开发者的实时助手",
            "调试场景：利用可视化能力定位问题",
        ],
        "anti_patterns": [
            "命令行长任务（应优先用 claude code）",
            "无头 CI/CD 环境（无 IDE 上下文，能力受限）",
        ],
    }

    async def invoke(
        self,
        task: str,
        context: dict[str, Any],
        sandbox: Optional[SandboxConfig] = None,
    ) -> ExternalAgentResult:
        """调用 Trae 完成任务。

        实现要点（厂商参考）：
            1. 通过 self.prepare_credentials() 获取 TRAE_API_KEY
            2. 通过 WebSocket 连接 Trae IDE
            3. 发送 command 并接收 IDE 响应
        """
        logger.info(
            "trae.invoke task_len=%d sandbox=%s",
            len(task),
            sandbox is not None,
        )
        try:
            env_vars = self.prepare_credentials()
        except ValueError as e:
            return ExternalAgentResult(
                provider_name=self.provider_name,
                success=False,
                error=str(e),
            )

        # TODO: 厂商实现 —— 调用真实 Trae IDE（WebSocket）
        logger.warning(
            "trae.invoke NOT_IMPLEMENTED provider=%s 厂商需替换为真实 IDE 调用",
            self.provider_name,
        )
        return ExternalAgentResult(
            provider_name=self.provider_name,
            success=False,
            output=None,
            error=(
                "TraeAdapter.invoke 尚未实现真实 IDE 调用——"
                "厂商应参照 reference_runtime.py 实现"
            ),
            cost={"total_tokens": 0, "total_calls": 0, "total_cost": 0.0},
            capability_contribution=self.get_capability_profile(),
        )

    async def stream(
        self,
        task: str,
        context: dict[str, Any],
        sandbox: Optional[SandboxConfig] = None,
    ) -> AsyncIterator[str]:
        """流式调用 Trae（EX-009 流式语义）。"""
        logger.info(
            "trae.stream task_len=%d sandbox=%s",
            len(task),
            sandbox is not None,
        )
        # TODO: 厂商实现 —— 通过 WebSocket 流式读取 IDE 响应
        logger.warning(
            "trae.stream NOT_IMPLEMENTED provider=%s", self.provider_name
        )
        yield "[trae] stream 尚未实现——厂商应替换为真实 IDE 流式调用\n"

    def get_capability_profile(self) -> dict[str, Any]:
        """返回 Trae 能力画像（EX-002）。"""
        return {
            "provider_name": self.manifest.provider_name,
            "display_name": self.manifest.display_name,
            "capabilities": list(self.manifest.capabilities)
            or list(self.CAPABILITY_PROFILE["capabilities"]),
            "blind_spots": list(self.manifest.blind_spots)
            or list(self.CAPABILITY_PROFILE["blind_spots"]),
            "strengths": list(self.CAPABILITY_PROFILE["strengths"]),
            "best_practices": list(self.CAPABILITY_PROFILE["best_practices"]),
            "anti_patterns": list(self.CAPABILITY_PROFILE["anti_patterns"]),
        }
