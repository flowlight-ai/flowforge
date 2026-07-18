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
    - [doc:review/review.md#14.4] CL-038 NDJSON + stderr 也算活着

铁律遵守：
    - 铁律 5：禁止硬编码密钥（ANTHROPIC_API_KEY 通过 HostInjector 注入）
    - 铁律 3：依赖通过构造函数注入
    - 所有 I/O 操作使用 async/await

CL-038 半实现状态：
    本 Adapter 当前为"半实现"状态——不实际调用 subprocess，但调用
    ``parse_cli_invocation`` / ``NDJSONParser`` 演示 NDJSON + stderr 解析能力。
    厂商参考实现时替换 ``# TODO: 厂商实现`` 标记的 subprocess 调用部分即可。

License: MIT
"""

from __future__ import annotations

import json
from typing import Any, AsyncIterator, Optional

from flowforge.core.external_agent.adapter import (
    ExternalAgentAdapter,
    ExternalAgentResult,
)
from flowforge.core.external_agent.cli_ndjson import (
    NDJSONParser,
    StderrCollector,
    parse_cli_invocation,
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
        """调用 Claude Code 完成任务（CL-038 半实现状态）。

        半实现状态：演示 NDJSON + stderr 解析能力，厂商参考实现替换
        ``# TODO: 厂商实现`` 标记的 subprocess 调用部分即可。

        实现要点（厂商参考）：
            1. 通过 self.prepare_credentials() 获取 ANTHROPIC_API_KEY
            2. 使用 sandbox.cwd 作为工作目录
            3. 通过 subprocess 调用 claude CLI（stdio 传输）
            4. 用 parse_cli_invocation 解析 stdout（NDJSON）+ stderr
            5. 封装为 ExternalAgentResult（success 仅看 returncode==0，
               "stderr 也算活着"教训）

        设计依据：
            - [doc:review/review.md#14.4] CL-038 NDJSON + stderr 也算活着
            - [doc:decisions/006-external-agent-integration.md] §4 首批接入
            - [doc:design/naming-contract.md#2.2] 灵智体
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
        #   proc = await asyncio.create_subprocess_exec(
        #       "claude", "code", "--output-format=ndjson", ...
        #       stdout=asyncio.subprocess.PIPE,
        #       stderr=asyncio.subprocess.PIPE,
        #       cwd=sandbox.cwd if sandbox else None,
        #       env={**os.environ, **env_vars},
        #   )
        #   stdout_bytes, stderr_bytes = await proc.communicate()
        #   cli_result = parse_cli_invocation(
        #       stdout=stdout_bytes.decode(),
        #       stderr=stderr_bytes.decode(),
        #       returncode=proc.returncode,
        #   )

        # 半实现演示：构造 mock NDJSON stdout（3 行）+ mock stderr（WARNING + INFO）
        mock_stdout = (
            '{"event":"start","task":' + json.dumps(task) + '}\n'
            '{"event":"progress","step":1,"message":"analyzing"}\n'
            '{"event":"done","output":"[mock] claude code result"}\n'
        )
        mock_stderr = (
            "WARNING: context length 80k tokens, may drift\n"
            "INFO: using mcp tool: filesystem.read\n"
        )
        mock_returncode = 0

        cli_result = parse_cli_invocation(
            stdout=mock_stdout,
            stderr=mock_stderr,
            returncode=mock_returncode,
        )

        logger.info(
            "claude_code.invoke half_implemented provider=%s "
            "success=%s ndjson_count=%d stderr_total=%d",
            self.provider_name,
            cli_result.success,
            len(cli_result.ndjson_objects),
            cli_result.stderr_summary.get("total", 0),
        )

        return ExternalAgentResult(
            provider_name=self.provider_name,
            success=cli_result.success,
            output=cli_result.model_dump(),
            artifacts=[],
            cost={"total_tokens": 0, "total_calls": 1, "total_cost": 0.0},
            capability_contribution=self.get_capability_profile(),
            error=cli_result.error,
        )

    async def stream(
        self,
        task: str,
        context: dict[str, Any],
        sandbox: Optional[SandboxConfig] = None,
    ) -> AsyncIterator[str]:
        """流式调用 Claude Code（EX-009 流式语义，CL-038 半实现状态）。

        半实现状态：演示 NDJSON 流式解析能力，厂商参考实现替换
        ``# TODO: 厂商实现`` 标记的 subprocess 调用部分即可。

        实现要点（厂商参考）：
            1. 通过 self.prepare_credentials() 获取 ANTHROPIC_API_KEY
            2. 启动 subprocess，stdout 设为 PIPE
            3. 用 stream_cli_invocation 异步生成器流式解析 NDJSON
            4. 每个 dict 序列化为 JSON 字符串后 yield（保持流式语义）

        设计依据：
            - [doc:review/review.md#14.4] CL-038 NDJSON + stderr 也算活着
            - [doc:decisions/006-external-agent-integration.md] §4 首批接入
            - [doc:design/naming-contract.md#2.2] 灵智体
        """
        logger.info(
            "claude_code.stream task_len=%d sandbox=%s",
            len(task),
            sandbox is not None,
        )
        # 注入凭据（host-owned，CL-015）
        try:
            env_vars = self.prepare_credentials()
        except ValueError as e:
            yield json.dumps(
                {"_type": "_error", "error": str(e)},
                ensure_ascii=False,
            )
            return

        # TODO: 厂商实现 —— 通过 subprocess stdout 流式读取
        #   proc = await asyncio.create_subprocess_exec(
        #       "claude", "code", "--output-format=ndjson", "--stream", ...
        #       stdout=asyncio.subprocess.PIPE,
        #       stderr=asyncio.subprocess.PIPE,
        #       cwd=sandbox.cwd if sandbox else None,
        #       env={**os.environ, **env_vars},
        #   )
        #   async for obj in stream_cli_invocation(proc):
        #       yield json.dumps(obj, ensure_ascii=False) + "\n"

        # 半实现演示：构造 mock chunk 列表（每行一个 NDJSON 对象），
        # 用 NDJSONParser 演示流式解析，每个解析出的 dict 序列化为 JSON 字符串 yield
        mock_chunks = [
            '{"event":"stream_start","task":' + json.dumps(task) + '}\n',
            '{"event":"delta","step":1,"content":"analyzing"}\n',
            '{"event":"delta","step":2,"content":"generating"}\n',
            '{"event":"stream_end","output":"[mock] stream done"}\n',
        ]

        parser = NDJSONParser()
        for chunk in mock_chunks:
            for obj in parser.feed_chunk(chunk):
                yield json.dumps(obj, ensure_ascii=False) + "\n"

        # 刷新 buffer 中可能残留的最后一行
        for obj in parser.flush_buffer():
            yield json.dumps(obj, ensure_ascii=False) + "\n"

        # 流结束——yield _final 帧（与 stream_cli_invocation 协议一致）
        final_frame = {
            "_type": "_final",
            "stderr_summary": StderrCollector().summary(),  # 半实现无 stderr
            "returncode": 0,
            "parsed_count": parser.get_parsed_count(),
            "parse_failures": parser.get_parse_failures(),
        }
        yield json.dumps(final_frame, ensure_ascii=False) + "\n"

        logger.info(
            "claude_code.stream half_implemented provider=%s parsed_count=%d",
            self.provider_name,
            parser.get_parsed_count(),
        )

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
