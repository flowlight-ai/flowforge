"""CodexAdapter — Codex 适配器实现。

按 EX-001/EX-002 实现 Codex 三方 Agent 适配器：
    - 协议：API + function calling
    - 传输：http
    - 擅长：推理、数学、逻辑分析
    - 盲点：工具调用弱、长上下文处理一般

设计依据：
    - [doc:review/review.md#第九章§9.2] EX-001/EX-002/EX-003
    - [doc:decisions/006-external-agent-integration.md] §4 首批接入

铁律遵守：
    - 铁律 5：禁止硬编码密钥（OPENAI_API_KEY 通过 HostInjector 注入）
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

logger = get_logger("external_agent.adapter.codex")


class CodexAdapter(ExternalAgentAdapter):
    """Codex Adapter（API + function calling 协议）。

    能力画像（EX-002）：
        - 擅长：推理、数学、逻辑分析、结构化输出
        - 盲点：工具调用弱、长上下文处理一般

    详见 [doc:review/review.md#第九章§9.2] EX-001~EX-010
    """

    CAPABILITY_PROFILE: dict[str, Any] = {
        "provider_name": "openai.codex",
        "display_name": "Codex",
        "capabilities": [
            "reasoning",
            "math_computation",
            "logic_analysis",
            "structured_output",
            "code_generation",
        ],
        "blind_spots": [
            "工具调用弱",
            "长上下文处理一般",
            "对中文场景适配较弱",
        ],
        "strengths": [
            "数学推理和形式化证明",
            "结构化输出（JSON / 表格）",
            "逻辑分析与决策树构建",
        ],
        "best_practices": [
            "推理任务：作为 claude code 的跨厂商 reviewer",
            "结构化输出：用于生成 schema 严格的数据",
        ],
        "anti_patterns": [
            "依赖工具调用的复杂任务（应优先用 claude code）",
            "超长上下文场景（易丢失关键信息）",
        ],
    }

    async def invoke(
        self,
        task: str,
        context: dict[str, Any],
        sandbox: SandboxConfig | None = None,
    ) -> ExternalAgentResult:
        """调用 Codex 完成任务。

        实现要点（厂商参考）：
            1. 通过 self.prepare_credentials() 获取 OPENAI_API_KEY
            2. 通过 HTTP POST 调用 OpenAI API
            3. 使用 function calling 增强工具调用能力
        """
        logger.info(
            "codex.invoke task_len=%d sandbox=%s",
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

        # TODO: 厂商实现 —— 调用真实 OpenAI API
        logger.warning(
            "codex.invoke NOT_IMPLEMENTED provider=%s 厂商需替换为真实 API 调用",
            self.provider_name,
        )
        return ExternalAgentResult(
            provider_name=self.provider_name,
            success=False,
            output=None,
            error=(
                "CodexAdapter.invoke 尚未实现真实 API 调用——"
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
        """流式调用 Codex（EX-009 流式语义）。"""
        logger.info(
            "codex.stream task_len=%d sandbox=%s",
            len(task),
            sandbox is not None,
        )
        # TODO: 厂商实现 —— 通过 SSE 流式读取 OpenAI API 响应
        logger.warning(
            "codex.stream NOT_IMPLEMENTED provider=%s", self.provider_name
        )
        yield "[codex] stream 尚未实现——厂商应替换为真实 API 流式调用\n"

    def get_capability_profile(self) -> dict[str, Any]:
        """返回 Codex 能力画像（EX-002）。"""
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
