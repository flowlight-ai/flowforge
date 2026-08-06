"""OpenCodeAdapter — OpenCode 适配器实现。

按 EX-001/EX-002 实现 OpenCode 三方 Agent 适配器：
    - 协议：SDK + plugin
    - 传输：stdio
    - 擅长：开源协作、社区生态、插件扩展
    - 盲点：企业场景弱、SLA 无保障

设计依据：
    - [doc:review/review.md#第九章§9.2] EX-001/EX-002/EX-003
    - [doc:decisions/006-external-agent-integration.md] §4 首批接入

铁律遵守：
    - 铁律 5：禁止硬编码密钥（OPCODE_API_KEY 通过 HostInjector 注入）
    - 所有 I/O 操作使用 async/await

License: MIT
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

from flowforge.core.external_agent.adapter import (
    ExternalAgentAdapter,
    ExternalAgentResult,
)
from flowforge.core.external_agent.host_injection import SandboxConfig
from flowforge.core.tracing import get_logger

logger = get_logger("external_agent.adapter.opencode")


class OpenCodeAdapter(ExternalAgentAdapter):
    """OpenCode Adapter（SDK + plugin 协议）。

    能力画像（EX-002）：
        - 擅长：开源协作、社区生态、插件扩展
        - 盲点：企业场景弱、SLA 无保障、合规性不足

    详见 [doc:review/review.md#第九章§9.2] EX-001~EX-010
    """

    CAPABILITY_PROFILE: dict[str, Any] = {
        "provider_name": "opencode.opencode",
        "display_name": "OpenCode",
        "capabilities": [
            "open_source_collaboration",
            "plugin_extension",
            "code_generation",
            "community_ecosystem",
        ],
        "blind_spots": [
            "企业场景弱",
            "SLA 无保障",
            "合规性不足",
        ],
        "strengths": [
            "开源生态丰富，社区插件多",
            "可扩展性强（plugin 架构）",
            "透明可审计（开源代码）",
        ],
        "best_practices": [
            "开源项目协作：作为社区贡献的桥梁",
            "插件扩展：定制化场景通过 plugin 实现",
        ],
        "anti_patterns": [
            "企业核心场景（SLA / 合规要求高）",
            "敏感数据处理（开源组件审计成本高）",
        ],
    }

    async def invoke(
        self,
        task: str,
        context: dict[str, Any],
        sandbox: SandboxConfig | None = None,
    ) -> ExternalAgentResult:
        """调用 OpenCode 完成任务。

        实现要点（厂商参考）：
            1. 通过 self.prepare_credentials() 获取 OPCODE_API_KEY（如需）
            2. 通过 SDK 加载 plugin 配置
            3. 调用 OpenCode SDK 完成任务
        """
        logger.info(
            "opencode.invoke task_len=%d sandbox=%s",
            len(task),
            sandbox is not None,
        )
        # OpenCode 是开源项目，可能不需要 API key
        try:
            env_vars = self.prepare_credentials()
        except ValueError as e:
            # OpenCode 凭据可选（开源场景可能无需 token）
            logger.info(
                "opencode.invoke credentials_optional skipped: %s", e
            )
            env_vars = {}

        # TODO: 厂商实现 —— 调用真实 OpenCode SDK
        logger.warning(
            "opencode.invoke NOT_IMPLEMENTED provider=%s 厂商需替换为真实 SDK 调用",
            self.provider_name,
        )
        return ExternalAgentResult(
            provider_name=self.provider_name,
            success=False,
            output=None,
            error=(
                "OpenCodeAdapter.invoke 尚未实现真实 SDK 调用——"
                "厂商应参照 reference_runtime.py 实现"
            ),
            cost={"total_tokens": 0, "total_calls": 0, "total_cost": 0.0},
            capability_contribution=self.get_capability_profile(),
        )

    async def stream(
        self,
        task: str,
        context: dict[str, Any],
        sandbox: SandboxConfig | None = None,
    ) -> AsyncIterator[str]:
        """流式调用 OpenCode（EX-009 流式语义）。"""
        logger.info(
            "opencode.stream task_len=%d sandbox=%s",
            len(task),
            sandbox is not None,
        )
        # TODO: 厂商实现 —— 通过 SDK 流式读取
        logger.warning(
            "opencode.stream NOT_IMPLEMENTED provider=%s", self.provider_name
        )
        yield "[opencode] stream 尚未实现——厂商应替换为真实 SDK 流式调用\n"

    def get_capability_profile(self) -> dict[str, Any]:
        """返回 OpenCode 能力画像（EX-002）。"""
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
