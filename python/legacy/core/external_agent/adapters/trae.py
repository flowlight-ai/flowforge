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
    - 铁律 5：禁止硬编码密钥/端点（TRAE_API_KEY 经 HostInjector 注入，
      WebSocket 端点经 TRAE_WS_URL 环境变量或 context["ws_endpoint"] 提供）
    - 所有 I/O 操作使用 async/await

实现状态（CL-038 同源治理）：
    本 Adapter 已实现真实 WebSocket 调用：
        - invoke：connect Trae IDE WebSocket，发送 JSON command，读取响应后
          经 JSON 解析封装为 ExternalAgentResult。
        - stream：connect 后逐帧读取 IDE 推送的文本片段，保持 EX-009 流式语义。
    - 超时由 manifest.timeout_seconds 控制（配置驱动，铁律 11）。
    - 连接/网络失败时降级为明确报错的 ExternalAgentResult（不 Mock）。

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
        """调用 Trae 完成任务（IDE + command 协议，WebSocket 传输）。

        实现流程：
            1. 经 self.prepare_credentials() 获取 TRAE_API_KEY（host-owned）
            2. 解析 WebSocket 端点（env TRAE_WS_URL 或 context["ws_endpoint"]）
            3. connect 握手（Authorization: Bearer <key>，超时由 manifest 控制）
            4. 发送 JSON command 并等待 IDE 响应
            5. 封装 ExternalAgentResult（cost / capability_contribution）

        设计依据：
            - [doc:decisions/006-external-agent-integration.md] §4 首批接入
            - [doc:review/review.md#14.4] CL-038 真实调用优先，禁止 Mock
        """
        logger.info(
            "trae.invoke task_len=%d sandbox=%s",
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

        token = env_vars.get("TRAE_API_KEY", "")
        try:
            endpoint = self._resolve_endpoint(context)
        except RuntimeError as e:
            logger.error("trae.invoke endpoint_error provider=%s error=%s",
                         self.provider_name, e)
            return self._error_result(str(e))

        ws = None
        try:
            ws = await self._open_ws(endpoint=endpoint, token=token)
            reply = await self._send_command(ws, task=task, sandbox=sandbox)
        except asyncio.TimeoutError:
            logger.error(
                "trae.invoke timeout provider=%s endpoint=%s timeout=%ds",
                self.provider_name,
                endpoint,
                self.manifest.timeout_seconds,
            )
            return self._error_result(
                f"TraeAdapter.invoke 调用超时（>{self.manifest.timeout_seconds}s）"
            )
        except (ConnectionError, OSError) as e:
            logger.error(
                "trae.invoke connect_failed provider=%s endpoint=%s error=%s",
                self.provider_name,
                endpoint,
                e,
            )
            return self._error_result(f"无法连接 Trae IDE（{endpoint}）：{e}")
        except RuntimeError as e:
            logger.error(
                "trae.invoke transport_error provider=%s endpoint=%s error=%s",
                self.provider_name,
                endpoint,
                e,
            )
            return self._error_result(str(e))
        finally:
            if ws is not None:
                await ws.close()

        output, success, error = self._parse_reply(reply)
        logger.info(
            "trae.invoke provider=%s success=%s output_len=%d",
            self.provider_name,
            success,
            len(output),
        )
        return ExternalAgentResult(
            provider_name=self.provider_name,
            success=success,
            output=output,
            artifacts=[],
            cost={
                "total_tokens": 0,
                "total_calls": 1,
                "total_cost": self.manifest.cost_per_call,
            },
            capability_contribution=self.get_capability_profile(),
            error=error,
        )

    async def stream(
        self,
        task: str,
        context: dict[str, Any],
        sandbox: Optional[SandboxConfig] = None,
    ) -> AsyncIterator[str]:
        """流式调用 Trae（EX-009 流式语义，WebSocket 逐帧读取）。

        实现流程：
            1. connect Trae IDE WebSocket（Authorization 注入 TRAE_API_KEY）
            2. 发送 JSON command，逐帧读取 IDE 推送的文本片段并 yield
            3. 收到 _final 标记或空帧时结束，透传汇总帧
        """
        logger.info(
            "trae.stream task_len=%d sandbox=%s",
            len(task),
            sandbox is not None,
        )
        try:
            env_vars = self.prepare_credentials()
        except ValueError as e:
            yield json.dumps(
                {"_type": "_error", "error": str(e)}, ensure_ascii=False
            )
            return

        token = env_vars.get("TRAE_API_KEY", "")
        try:
            endpoint = self._resolve_endpoint(context)
            ws = await self._open_ws(endpoint=endpoint, token=token)
        except (RuntimeError, ConnectionError, OSError) as e:
            yield json.dumps(
                {"_type": "_error", "error": str(e)}, ensure_ascii=False
            )
            return

        try:
            await ws.send(
                json.dumps(
                    self._build_command(task=task, sandbox=sandbox),
                    ensure_ascii=False,
                )
            )
            while True:
                raw = await asyncio.wait_for(
                    ws.recv(), timeout=self.manifest.timeout_seconds
                )
                if isinstance(raw, bytes):
                    raw = raw.decode("utf-8", errors="replace")
                if not raw:
                    break
                text, final = self._parse_frame(raw)
                if text:
                    yield text
                if final:
                    break
        except asyncio.TimeoutError:
            logger.error(
                "trae.stream timeout provider=%s endpoint=%s timeout=%ds",
                self.provider_name,
                endpoint,
                self.manifest.timeout_seconds,
            )
            yield json.dumps(
                {
                    "_type": "_error",
                    "error": f"TraeAdapter.stream 调用超时"
                    f"（>{self.manifest.timeout_seconds}s）",
                },
                ensure_ascii=False,
            )
        finally:
            await ws.close()

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

    # ------------------------------------------------------------------
    # 私有工具：WebSocket 传输 / 消息帧解析
    # ------------------------------------------------------------------

    @staticmethod
    def _resolve_endpoint(context: dict[str, Any]) -> str:
        """解析 Trae IDE WebSocket 端点（配置驱动，禁止硬编码 URL）。

        优先级：context["ws_endpoint"] > 环境变量 TRAE_WS_URL。
        端点属连接配置而非敏感凭据，不注入 credential store，但仍由 host 配置。
        """
        endpoint = (
            context.get("ws_endpoint")
            or os.environ.get("TRAE_WS_URL")
            or ""
        ).strip()
        if not endpoint:
            raise RuntimeError(
                "TraeAdapter：缺少 WebSocket 端点。请设置环境变量 "
                "TRAE_WS_URL 或在 context['ws_endpoint'] 提供 Trae IDE 端点。"
            )
        return endpoint

    async def _open_ws(self, endpoint: str, token: str) -> Any:
        """建立 Trae IDE WebSocket 连接（握手超时由 manifest 控制）。

        TRAE_API_KEY 经 Authorization 头注入（host-owned，不写入日志）。
        """
        try:
            import websockets
        except ImportError:
            raise RuntimeError(
                "TraeAdapter：需要 'websockets' 库才能通过 WebSocket "
                "调用 Trae IDE，请安装依赖（同 mcp/client.py 用法）。"
            )

        headers = {}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        logger.info(
            "trae._open_ws endpoint=%s timeout=%ds",
            endpoint,
            self.manifest.timeout_seconds,
        )
        ws = await asyncio.wait_for(
            websockets.connect(endpoint, additional_headers=headers),
            timeout=self.manifest.timeout_seconds,
        )
        return ws

    def _build_command(
        self,
        task: str,
        sandbox: Optional[SandboxConfig] = None,
    ) -> dict[str, Any]:
        """构造 Trae IDE command 消息（IDE + command 协议，JSON 帧）。"""
        return {
            "method": "trae.command",
            "params": {
                "task": task,
                "cwd": sandbox.cwd if sandbox is not None else None,
            },
        }

    async def _send_command(
        self,
        ws: Any,
        task: str,
        sandbox: Optional[SandboxConfig] = None,
    ) -> Any:
        """发送 command 并读取一条完整响应（超时由 manifest 控制）。"""
        await ws.send(
            json.dumps(self._build_command(task=task, sandbox=sandbox),
                       ensure_ascii=False)
        )
        raw = await asyncio.wait_for(
            ws.recv(), timeout=self.manifest.timeout_seconds
        )
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8", errors="replace")
        if not raw:
            raise RuntimeError("Trae IDE 返回空响应")
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {"_type": "text", "text": raw}

    @staticmethod
    def _parse_reply(reply: Any) -> tuple[Any, bool, Optional[str]]:
        """解析 IDE 响应为 (output, success, error)。

        - 结构化响应：优先取 params.output / result / output 字段
        - _type == "error" 或 success == False：视为失败
        - 原始文本响应：原样透传（IDE 可能返回非 JSON 文本）
        """
        if not isinstance(reply, dict):
            return (reply, True, None)
        if reply.get("_type") == "error" or reply.get("success") is False:
            error = (
                reply.get("error")
                or reply.get("message")
                or "Trae IDE 返回错误响应"
            )
            return (None, False, str(error))
        output = (
            reply.get("params", {}).get("output")
            if isinstance(reply.get("params"), dict)
            else None
        )
        if output is None:
            output = reply.get("result") or reply.get("output")
        return (output, True, None)

    @staticmethod
    def _parse_frame(raw: str) -> tuple[Optional[str], bool]:
        """解析流式帧为 (文本片段, 是否结束)。

        - _final / end 标记帧：返回 (None, True)
        - 结构化帧：优先取 params.text / text 字段
        - 非 JSON 文本：作为文本片段透传
        """
        try:
            obj = json.loads(raw)
        except json.JSONDecodeError:
            return (raw, False)
        if not isinstance(obj, dict):
            return (raw, False)
        if obj.get("_type") in ("_final", "end") or obj.get("end") is True:
            return (None, True)
        params = obj.get("params")
        if isinstance(params, dict):
            text = params.get("text") or params.get("output")
        else:
            text = obj.get("text")
        if isinstance(text, str) and text:
            return (text, False)
        return (None, False)

    def _error_result(self, error: str) -> ExternalAgentResult:
        """构造失败 ExternalAgentResult（cost 记为 0 调用）。"""
        return ExternalAgentResult(
            provider_name=self.provider_name,
            success=False,
            output=None,
            error=error,
            cost={"total_tokens": 0, "total_calls": 0, "total_cost": 0.0},
            capability_contribution=self.get_capability_profile(),
        )
