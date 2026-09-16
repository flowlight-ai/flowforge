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

import asyncio
import json
import os
from typing import Any, AsyncIterator, Optional

from flowforge.core.external_agent.adapter import (
    ExternalAgentAdapter,
    ExternalAgentResult,
)
from flowforge.core.external_agent.cli_ndjson import (
    parse_cli_invocation,
    stream_cli_invocation,
)
from flowforge.core.external_agent.host_injection import SandboxConfig
from flowforge.core.external_agent.manifest import AgentProviderManifest
from flowforge.core.tracing import get_logger

logger = get_logger("external_agent.adapter.opencode")


def _text_parts(ndjson_objects: list[dict[str, Any]]) -> str:
    """从 OpenCode ``--format json`` 事件流中提取 assistant 文本输出。

    OpenCode SDK 的事件流中，``type == "text"`` 且 ``part.type == "text"``
    的事件携带最终文本（``part.text``）。将多个文本片段按行合并，作为
    三方 Agent 的原始输出。

    Returns:
        合并后的文本字符串（无文本事件时返回空串）。
    """
    parts: list[str] = []
    for obj in ndjson_objects:
        if not isinstance(obj, dict):
            continue
        if obj.get("type") != "text":
            continue
        part = obj.get("part")
        if not isinstance(part, dict) or part.get("type") != "text":
            continue
        text = part.get("text")
        if isinstance(text, str) and text:
            parts.append(text)
    return "\n".join(parts)


def _token_usage(ndjson_objects: list[dict[str, Any]]) -> tuple[int, float]:
    """从 ``step_finish`` 事件中累计 token 与成本（EX-006）。

    Returns:
        (total_tokens, total_cost) 元组。
    """
    total_tokens = 0
    total_cost = 0.0
    for obj in ndjson_objects:
        if not isinstance(obj, dict) or obj.get("type") != "step_finish":
            continue
        part = obj.get("part")
        if not isinstance(part, dict):
            continue
        tokens = part.get("tokens")
        if isinstance(tokens, dict):
            total_tokens += int(tokens.get("total") or 0)
        cost = part.get("cost")
        if isinstance(cost, (int, float)):
            total_cost += float(cost)
    return total_tokens, total_cost


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
        sandbox: Optional[SandboxConfig] = None,
    ) -> ExternalAgentResult:
        """调用 OpenCode 完成任务（SDK + plugin 协议，stdio 传输）。

        OpenCode 的 SDK 与 Claude Code 类似，通过 CLI 驱动：``opencode run``
        以非交互方式执行任务，``--format json`` 输出 NDJSON 事件流（stdio）。

        实现要点：
            1. OpenCode 为开源项目，Manifest 声明 ``required_env_vars=[]``，
               自身管理 provider 凭据，无需 host 注入 API key。
            2. 通过 ``asyncio.create_subprocess_exec`` 以 stdio 调用
               ``opencode run --format json``，cwd 锁定到 sandbox.cwd。
            3. 用 parse_cli_invocation 解析 NDJSON 事件流 + 收集 stderr。
            4. ``success`` 仅看 returncode==0（CL-038 "stderr 也算活着"）。
        """
        logger.info(
            "opencode.invoke task_len=%d sandbox=%s",
            len(task),
            sandbox is not None,
        )
        # OpenCode 是开源项目，凭据由 opencode 自身管理（Manifest 无必需 env）
        env_vars = self.prepare_credentials()
        for var, value in env_vars.items():
            os.environ.setdefault(var, value)

        command = [
            "opencode",
            "run",
            "--format",
            "json",
            "--title",
            f"flowforge:{self.provider_name}",
            task,
        ]
        logger.debug(
            "opencode.invoke exec=%s cwd=%s",
            " ".join(command),
            sandbox.cwd if sandbox else None,
        )

        try:
            process = await asyncio.create_subprocess_exec(
                *command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=sandbox.cwd if sandbox else None,
            )
            stdout_bytes, stderr_bytes = await asyncio.wait_for(
                process.communicate(),
                timeout=self.manifest.timeout_seconds,
            )
        except asyncio.TimeoutError:
            if process is not None:
                process.kill()
                await process.communicate()
            logger.error(
                "opencode.invoke timeout provider=%s",
                self.provider_name,
            )
            return ExternalAgentResult(
                provider_name=self.provider_name,
                success=False,
                error=(
                    f"OpenCodeAdapter.invoke timeout after "
                    f"{self.manifest.timeout_seconds}s"
                ),
                cost={"total_tokens": 0, "total_calls": 1, "total_cost": 0.0},
                capability_contribution=self.get_capability_profile(),
            )
        except OSError as e:
            logger.error(
                "opencode.invoke spawn_failed provider=%s error=%s",
                self.provider_name,
                e,
            )
            return ExternalAgentResult(
                provider_name=self.provider_name,
                success=False,
                error=f"OpenCode CLI 启动失败：{e}",
                cost={"total_tokens": 0, "total_calls": 0, "total_cost": 0.0},
                capability_contribution=self.get_capability_profile(),
            )

        stdout_text = stdout_bytes.decode("utf-8", errors="replace")
        stderr_text = stderr_bytes.decode("utf-8", errors="replace")
        cli_result = parse_cli_invocation(
            stdout=stdout_text,
            stderr=stderr_text,
            returncode=process.returncode if process.returncode is not None else 0,
        )

        output_text = _text_parts(cli_result.ndjson_objects)
        total_tokens, total_cost = _token_usage(cli_result.ndjson_objects)

        logger.info(
            "opencode.invoke provider=%s success=%s returncode=%s "
            "output_len=%d ndjson_count=%d tokens=%d",
            self.provider_name,
            cli_result.success,
            cli_result.returncode,
            len(output_text),
            len(cli_result.ndjson_objects),
            total_tokens,
        )

        if not cli_result.success:
            return ExternalAgentResult(
                provider_name=self.provider_name,
                success=False,
                output=output_text or None,
                error=(
                    f"OpenCode exit {cli_result.returncode}："
                    f"{cli_result.error or 'no error'} stderr_total="
                    f"{cli_result.stderr_summary.get('total', 0)}"
                ),
                cost={
                    "total_tokens": total_tokens,
                    "total_calls": 1,
                    "total_cost": total_cost,
                },
                capability_contribution=self.get_capability_profile(),
            )

        return ExternalAgentResult(
            provider_name=self.provider_name,
            success=True,
            output={
                "task": task,
                "output": output_text,
                "stderr_summary": cli_result.stderr_summary,
                "ndjson_count": len(cli_result.ndjson_objects),
            },
            artifacts=[],
            cost={
                "total_tokens": total_tokens,
                "total_calls": 1,
                "total_cost": total_cost,
            },
            capability_contribution=self.get_capability_profile(),
        )

    async def stream(
        self,
        task: str,
        context: dict[str, Any],
        sandbox: Optional[SandboxConfig] = None,
    ) -> AsyncIterator[str]:
        """流式调用 OpenCode（EX-009 流式语义）。

        通过 ``opencode run --format json`` 以 stdio 启动子进程，
        用 stream_cli_invocation 逐行解析 NDJSON 事件流；仅转发
        ``type == "text"`` 的文本片段保持流式语义，最后透传 ``_final`` 帧。
        """
        logger.info(
            "opencode.stream task_len=%d sandbox=%s",
            len(task),
            sandbox is not None,
        )
        env_vars = self.prepare_credentials()
        for var, value in env_vars.items():
            os.environ.setdefault(var, value)

        command = [
            "opencode",
            "run",
            "--format",
            "json",
            "--title",
            f"flowforge:{self.provider_name}",
            task,
        ]

        try:
            process = await asyncio.create_subprocess_exec(
                *command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=sandbox.cwd if sandbox else None,
            )
        except OSError as e:
            logger.error(
                "opencode.stream spawn_failed provider=%s error=%s",
                self.provider_name,
                e,
            )
            yield (
                '{"_type":"_error","error":' + json.dumps(str(e), ensure_ascii=False) + "}\n"
            )
            return

        async for obj in stream_cli_invocation(process):
            if obj.get("_type") == "_final":
                yield json.dumps(obj, ensure_ascii=False) + "\n"
                break
            if obj.get("type") == "text":
                part = obj.get("part")
                if isinstance(part, dict) and part.get("type") == "text":
                    text = part.get("text")
                    if isinstance(text, str) and text:
                        yield text

        logger.info(
            "opencode.stream provider=%s done",
            self.provider_name,
        )

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
