"""ClaudeCodeAdapter — Claude Code 适配器实现。

按 EX-001/EX-002 实现 Claude Code 三方 Agent 适配器：
    - 协议：CLI + MCP
    - 传输：stdio
    - 擅长：复杂重构、代码生成、代码审查
    - 盲点：长上下文易漂移、工具调用偶尔失败

设计依据：
    - [doc:review/review.md#第九章§9.2] EX-001/EX-002/EX-003
    - [doc:decisions/006-external-agent-integration.md] §4 首批接入
    - [doc:design/naming-contract.md#2.12] 能力画像

铁律遵守：
    - 铁律 5：禁止硬编码密钥（ANTHROPIC_API_KEY 通过 HostInjector 注入）
    - 铁律 3：依赖通过构造函数注入
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

logger = get_logger("external_agent.adapter.claude_code")


class ClaudeCodeAdapter(ExternalAgentAdapter):
    """Claude Code Adapter（CLI + MCP 协议）。

    按 EX-001 升级为"能力扩展"思维：灵智体可加载 claude code 的代码能力
    作为自己的能力延伸，而非简单的"调用一下拿结果"。

    能力画像（EX-002）：
        - 擅长：复杂重构、代码生成、代码审查、长链推理
        - 盲点：长上下文易漂移、工具调用偶尔失败

    详见 [doc:review/review.md#第九章§9.2] EX-001~EX-010
    """

    # Claude Code 专属能力画像（与 Manifest YAML 同步）
    CAPABILITY_PROFILE: dict[str, Any] = {
        "provider_name": "anthropic.claude_code",
        "display_name": "Claude Code",
        "capabilities": [
            "code_generation",
            "code_review",
            "complex_refactor",
            "long_chain_reasoning",
            "mcp_tool_use",
        ],
        "blind_spots": [
            "长上下文易漂移",
            "工具调用偶尔失败",
            "对中文注释理解偶有偏差",
        ],
        "strengths": [
            "复杂重构场景下的多文件协同修改",
            "长链推理任务（如架构设计、依赖分析）",
            "MCP 工具调用生态丰富",
        ],
        "best_practices": [
            "复杂重构：将上下文拆分为多个小步骤，避免长上下文漂移",
            "代码审查：配合 codex 跨厂商 review，互补盲点",
        ],
        "anti_patterns": [
            "超长上下文（>100k token）一次性提交，易漂移",
            "对工具调用结果不做校验，可能误用失败结果",
        ],
    }

    async def invoke(
        self,
        task: str,
        context: dict[str, Any],
        sandbox: Optional[SandboxConfig] = None,
    ) -> ExternalAgentResult:
        """调用 Claude Code 完成任务。

        实现要点（厂商参考）：
            1. 通过 self.prepare_credentials() 获取 ANTHROPIC_API_KEY
            2. 使用 sandbox.cwd 作为工作目录
            3. 通过 subprocess 调用 claude CLI（stdio 传输）
            4. 解析 MCP 响应，封装为 ExternalAgentResult
        """
        logger.info(
            "claude_code.invoke task_len=%d sandbox=%s",
            len(task),
            sandbox is not None,
        )
        # 注入凭据（host-owned，CL-015）
        try:
            env_vars = self.prepare_credentials()
        except ValueError as e:
            return ExternalAgentResult(
                provider_name=self.provider_name,
                success=False,
                error=str(e),
            )

        # TODO: 厂商实现 —— 调用真实 claude CLI（stdio + MCP）
        # 当前为骨架占位，返回未实现状态
        logger.warning(
            "claude_code.invoke NOT_IMPLEMENTED provider=%s "
            "厂商需替换为真实 CLI 调用",
            self.provider_name,
        )
        return ExternalAgentResult(
            provider_name=self.provider_name,
            success=False,
            output=None,
            error=(
                "ClaudeCodeAdapter.invoke 尚未实现真实 CLI 调用——"
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
        """流式调用 Claude Code（EX-009 流式语义）。"""
        logger.info(
            "claude_code.stream task_len=%d sandbox=%s",
            len(task),
            sandbox is not None,
        )
        # TODO: 厂商实现 —— 通过 subprocess stdout 流式读取
        logger.warning(
            "claude_code.stream NOT_IMPLEMENTED provider=%s",
            self.provider_name,
        )
        yield "[claude_code] stream 尚未实现——厂商应替换为真实 CLI 流式调用\n"

    def get_capability_profile(self) -> dict[str, Any]:
        """返回 Claude Code 能力画像（EX-002）。

        能力画像必须同时写"必杀技"和"致命弱点"——盲点决定谁该 review 谁。
        """
        # 优先使用 Manifest 中的声明（YAML 配置驱动），fallback 到类常量
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
