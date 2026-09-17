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

CL-038 实现状态：
    本 Adapter 已实现真实 subprocess 调用：
        - invoke：spawn ``claude code`` CLI（stdio 传输），``communicate`` 后
          经 ``parse_cli_invocation`` 解析 NDJSON stdout + 收集 stderr。
        - stream：spawn CLI 后经 ``stream_cli_invocation`` 流式解析并逐帧 yield。
    超时由 ``manifest.timeout_seconds`` 控制（配置驱动，铁律 11）。

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

logger = get_logger("external_agent.adapter.claude_code")


class ClaudeCodeAdapter(ExternalAgentAdapter):
    """Claude Code Adapter（CLI + MCP 协议）。

    按 EX-001 升级为"能力扩展"思维：Forgekin可加载 claude code 的代码能力
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
        """调用 Claude Code 完成任务（CLI + MCP，CL-038 真实实现）。

        实现流程：
            1. 通过 self.prepare_credentials() 获取 ANTHROPIC_API_KEY（host-owned）
            2. 以 sandbox.cwd 为工作目录，spawn ``claude code`` CLI（stdio 传输）
            3. 调用超时由 manifest.timeout_seconds 控制（配置驱动）
            4. 用 parse_cli_invocation 解析 stdout（NDJSON）+ 收集 stderr
            5. 封装为 ExternalAgentResult（success 仅看 returncode==0，
               "stderr 也算活着"教训）

        设计依据：
            - [doc:review/review.md#14.4] CL-038 NDJSON + stderr 也算活着
            - [doc:decisions/006-external-agent-integration.md] §4 首批接入
            - [doc:design/naming-contract.md#2.2] Forgekin
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

        cmd = self._build_claude_command(task=task, sandbox=sandbox)
        env = self._build_claude_env(env_vars=env_vars, sandbox=sandbox)
        cwd = sandbox.cwd if sandbox is not None else None

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=cwd,
                env=env,
            )
        except (FileNotFoundError, OSError) as e:
            logger.error(
                "claude_code.invoke spawn_failed cmd=%s error=%s",
                cmd[0],
                e,
            )
            return ExternalAgentResult(
                provider_name=self.provider_name,
                success=False,
                error=f"无法启动 claude CLI（{cmd[0]}）：{e}",
            )

        try:
            stdout_bytes, stderr_bytes = await asyncio.wait_for(
                proc.communicate(),
                timeout=self.manifest.timeout_seconds,
            )
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            return ExternalAgentResult(
                provider_name=self.provider_name,
                success=False,
                error=(
                    f"claude CLI 调用超时（>{self.manifest.timeout_seconds}s）"
                ),
            )

        cli_result = parse_cli_invocation(
            stdout=stdout_bytes.decode("utf-8", errors="replace"),
            stderr=stderr_bytes.decode("utf-8", errors="replace"),
            returncode=proc.returncode,
        )

        logger.info(
            "claude_code.invoke provider=%s success=%s ndjson_count=%d "
            "stderr_total=%d",
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
            cost={
                "total_tokens": 0,
                "total_calls": 1,
                "total_cost": self.manifest.cost_per_call,
            },
            capability_contribution=self.get_capability_profile(),
            error=cli_result.error,
        )

    async def stream(
        self,
        task: str,
        context: dict[str, Any],
        sandbox: Optional[SandboxConfig] = None,
    ) -> AsyncIterator[str]:
        """流式调用 Claude Code（EX-009 流式语义，CLI + MCP 真实实现）。

        实现流程：
            1. 通过 self.prepare_credentials() 获取 ANTHROPIC_API_KEY（host-owned）
            2. 以 sandbox.cwd 为工作目录，spawn ``claude code`` CLI（stdio 传输）
            3. 用 stream_cli_invocation 流式解析 NDJSON，逐帧序列化 yield
            4. 流结束由 stream_cli_invocation 输出 _final 帧（含 stderr_summary /
               returncode / parsed_count / parse_failures）

        设计依据：
            - [doc:review/review.md#14.4] CL-038 NDJSON + stderr 也算活着
            - [doc:decisions/006-external-agent-integration.md] §4 首批接入
            - [doc:design/naming-contract.md#2.2] Forgekin
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

        cmd = self._build_claude_command(task=task, sandbox=sandbox)
        env = self._build_claude_env(env_vars=env_vars, sandbox=sandbox)
        cwd = sandbox.cwd if sandbox is not None else None

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=cwd,
                env=env,
            )
        except (FileNotFoundError, OSError) as e:
            logger.error(
                "claude_code.stream spawn_failed cmd=%s error=%s",
                cmd[0],
                e,
            )
            yield json.dumps(
                {
                    "_type": "_error",
                    "error": f"无法启动 claude CLI（{cmd[0]}）：{e}",
                },
                ensure_ascii=False,
            )
            return

        # 统计已解析的 NDJSON 对象数（不含 _final 标记帧）
        parsed_count = 0
        try:
            async for obj in stream_cli_invocation(proc):
                if obj.get("_type") != "_final":
                    parsed_count += 1
                yield json.dumps(obj, ensure_ascii=False) + "\n"
        finally:
            # 生成器提前退出时终止子进程，避免遗留僵尸进程
            if proc.returncode is None:
                proc.kill()
                await proc.wait()

        logger.info(
            "claude_code.stream provider=%s parsed_count=%d",
            self.provider_name,
            parsed_count,
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

    # ------------------------------------------------------------------
    # 私有工具：构造 CLI 命令 / 环境 / MCP 配置
    # ------------------------------------------------------------------

    def _build_claude_command(
        self,
        task: str,
        sandbox: Optional[SandboxConfig] = None,
    ) -> list[str]:
        """构造 ``claude code`` CLI 命令（协议：CLI + MCP，传输：stdio）。

        命令结构：
            claude code --output-format=ndjson [--mcp-config <json>] <task>

        - task 作为位置参数传入（claude code 将 prompt 作为最后参数）
        - sandbox.mcp_servers 非空时注入 --mcp-config（CLI + MCP 协议）
        """
        cmd = ["claude", "code", "--output-format=ndjson"]
        mcp_config = self._build_mcp_config(sandbox)
        if mcp_config:
            cmd.append("--mcp-config")
            cmd.append(json.dumps(mcp_config, ensure_ascii=False))
        cmd.append(task)
        return cmd

    def _build_mcp_config(
        self,
        sandbox: Optional[SandboxConfig] = None,
    ) -> Optional[dict[str, Any]]:
        """从 sandbox.mcp_servers 构造 ``--mcp-config`` JSON（无 MCP 返回 None）。

        MCP 服务器配置由 host 注入（CL-015 host-owned，
        HostInjector.inject_mcp_config），每项含 name / command / args / env。
        """
        if sandbox is None or not sandbox.mcp_servers:
            return None
        mcp_config: dict[str, Any] = {"mcpServers": {}}
        for server in sandbox.mcp_servers:
            name = server.get("name")
            if not name:
                continue
            entry: dict[str, Any] = {"command": server.get("command")}
            if server.get("args"):
                entry["args"] = server["args"]
            if server.get("env"):
                entry["env"] = server["env"]
            mcp_config["mcpServers"][name] = entry
        return mcp_config

    def _build_claude_env(
        self,
        env_vars: dict[str, str],
        sandbox: Optional[SandboxConfig] = None,
    ) -> dict[str, str]:
        """合并子进程环境变量（os.environ + sandbox.env_vars + 注入凭据）。

        铁律 5：凭据经 prepare_credentials() 注入，不在此硬编码。
        """
        env: dict[str, str] = dict(os.environ)
        if sandbox is not None:
            env.update(sandbox.env_vars)
        env.update(env_vars)
        return env
