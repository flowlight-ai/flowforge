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
    - 编程红线 11：禁止硬编码端点 / 模型 / 工具（经 env + context 配置驱动）
    - 所有 I/O 操作使用 async/await

实现状态：
    本 Adapter 已实现真实 HTTP 调用（协议：API + function calling，传输：http）：
        - invoke：经 ``httpx.AsyncClient`` POST ``/chat/completions``，支持
          配置驱动的 function calling 与结构化输出，失败按 retry_policy 重试，
          成本按 usage.total_tokens × cost_per_token + cost_per_call 统计（EX-006）。
        - stream：``stream=true`` 走 SSE，逐 ``data:`` 帧解析 ``delta.content`` 流式 yield。
    超时由 ``manifest.timeout_seconds`` 控制（配置驱动，铁律 11）。

License: MIT
"""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any, AsyncIterator, Optional

import httpx

from flowforge.core.external_agent.adapter import (
    ExternalAgentAdapter,
    ExternalAgentResult,
)
from flowforge.core.external_agent.host_injection import SandboxConfig
from flowforge.core.external_agent.manifest import AgentProviderManifest
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

    DEFAULT_BASE_URL = "https://api.openai.com/v1"

    async def invoke(
        self,
        task: str,
        context: dict[str, Any],
        sandbox: Optional[SandboxConfig] = None,
    ) -> ExternalAgentResult:
        """调用 Codex 完成任务（OpenAI Chat Completions API，传输：http）。

        实现流程：
            1. 通过 self.prepare_credentials() 获取 OPENAI_API_KEY（host-owned，CL-015）
            2. 端点 / 模型经 env 配置（OPENAI_BASE_URL / OPENAI_MODEL，铁律 11）
            3. 经 httpx.AsyncClient POST /chat/completions（async/await）
            4. function calling 由调用方经 context["openai_tools"] 配置驱动；
               context["structured_response"] 时请求 JSON 结构化输出
            5. 失败按 manifest.retry_policy 重试；成本按 usage 计算（EX-006）

        设计依据：
            - [doc:review/review.md#第九章§9.2] EX-001/EX-002/EX-003
            - [doc:decisions/006-external-agent-integration.md] §4 首批接入
            - [doc:design/naming-contract.md#2.12] 能力画像
            - [doc:naming/naming-contract.md#2.2] Forgekin
        """
        logger.info(
            "codex.invoke task_len=%d sandbox=%s",
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

        api_key = env_vars.get("OPENAI_API_KEY")
        if not api_key:
            return ExternalAgentResult(
                provider_name=self.provider_name,
                success=False,
                error="CodexAdapter: OPENAI_API_KEY 注入为空，请检查 CredentialStore 配置。",
            )

        url = self._resolve_chat_url()
        headers = {
            "Authorization": "Bearer " + api_key,
            "Content-Type": "application/json",
        }
        payload = self._build_payload(
            task=task,
            context=context,
            model=self._resolve_model(),
            stream=False,
        )

        try:
            data, retries = await self._post_chat_completions(
                url=url,
                headers=headers,
                payload=payload,
            )
        except httpx.TimeoutException as exc:
            logger.error("codex.invoke timeout provider=%s url=%s", self.provider_name, url)
            return ExternalAgentResult(
                provider_name=self.provider_name,
                success=False,
                error=f"CodexAdapter.invoke 超时（>{self.manifest.timeout_seconds}s）：{exc}",
                cost={"total_tokens": 0, "total_calls": 0, "total_cost": 0.0},
                capability_contribution=self.get_capability_profile(),
            )
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            logger.error("codex.invoke http_error provider=%s status=%d", self.provider_name, status)
            return ExternalAgentResult(
                provider_name=self.provider_name,
                success=False,
                error=f"CodexAdapter.invoke HTTP {status}：{exc}",
                cost={"total_tokens": 0, "total_calls": 0, "total_cost": 0.0},
                capability_contribution=self.get_capability_profile(),
            )
        except httpx.RequestError as exc:
            logger.error("codex.invoke request_error provider=%s error=%s", self.provider_name, exc)
            return ExternalAgentResult(
                provider_name=self.provider_name,
                success=False,
                error=f"CodexAdapter.invoke 网络错误：{exc}",
                cost={"total_tokens": 0, "total_calls": 0, "total_cost": 0.0},
                capability_contribution=self.get_capability_profile(),
            )

        message = self._extract_message(data)
        content = message.get("content")
        tool_calls = message.get("tool_calls")
        usage = data.get("usage", {}) if isinstance(data, dict) else {}
        total_tokens = int(usage.get("total_tokens") or 0)
        total_cost = (
            total_tokens * self.manifest.cost_per_token
            + self.manifest.cost_per_call
        )

        logger.info(
            "codex.invoke provider=%s success=True tokens=%d retries=%d",
            self.provider_name,
            total_tokens,
            retries,
        )

        return ExternalAgentResult(
            provider_name=self.provider_name,
            success=True,
            output={
                "content": content,
                "tool_calls": tool_calls,
                "model": data.get("model") if isinstance(data, dict) else None,
                "finish_reason": (
                    (data.get("choices") or [{}])[0].get("finish_reason", None)
                    if isinstance(data, dict)
                    else None
                ),
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
        """流式调用 Codex（EX-009 流式语义，OpenAI SSE 增量解析）。

        实现流程：
            1. 通过 self.prepare_credentials() 获取 OPENAI_API_KEY（host-owned）
            2. POST /chat/completions 且 stream=True，经 httpx.AsyncClient 流式传输
            3. 逐行解析 ``data: {...}`` SSE 负载，透传 ``choices[0].delta.content``
            4. 遇 ``data: [DONE]`` 结束；错误以 ``{"_type":"_error",...}`` 帧输出
        """
        logger.info(
            "codex.stream task_len=%d sandbox=%s",
            len(task),
            sandbox is not None,
        )
        # 注入凭据（host-owned，CL-015）
        try:
            env_vars = self.prepare_credentials()
        except ValueError as exc:
            yield json.dumps({"_type": "_error", "error": str(exc)}, ensure_ascii=False)
            return

        api_key = env_vars.get("OPENAI_API_KEY")
        if not api_key:
            yield json.dumps(
                {
                    "_type": "_error",
                    "error": "CodexAdapter: OPENAI_API_KEY 注入为空，请检查 CredentialStore 配置。",
                },
                ensure_ascii=False,
            )
            return

        url = self._resolve_chat_url()
        headers = {
            "Authorization": "Bearer " + api_key,
            "Content-Type": "application/json",
        }
        payload = self._build_payload(
            task=task,
            context=context,
            model=self._resolve_model(),
            stream=True,
        )

        try:
            timeout = httpx.Timeout(self.manifest.timeout_seconds, connect=30.0)
            async with httpx.AsyncClient(timeout=timeout) as client:
                async with client.stream(
                    "POST", url, headers=headers, json=payload
                ) as response:
                    response.raise_for_status()
                    async for line in response.aiter_lines():
                        if not line or not line.startswith("data:"):
                            continue
                        data_payload = line[len("data:"):].strip()
                        if data_payload == "[DONE]":
                            return
                        try:
                            chunk = json.loads(data_payload)
                        except json.JSONDecodeError:
                            logger.debug(
                                "codex.stream skip_non_json line_len=%d",
                                len(data_payload),
                            )
                            continue
                        if not isinstance(chunk, dict):
                            continue
                        choices = chunk.get("choices")
                        if not isinstance(choices, list) or not choices:
                            continue
                        delta = choices[0].get("delta", {})
                        if not isinstance(delta, dict):
                            continue
                        text = delta.get("content")
                        if isinstance(text, str) and text:
                            yield text
        except (httpx.TimeoutException, httpx.HTTPStatusError, httpx.RequestError) as exc:
            logger.error("codex.stream error provider=%s error=%s", self.provider_name, exc)
            yield json.dumps({"_type": "_error", "error": str(exc)}, ensure_ascii=False)
            return

        logger.info("codex.stream provider=%s done", self.provider_name)

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

    # ------------------------------------------------------------------
    # 私有工具：端点 / 模型 / 请求体 / 响应解析
    # ------------------------------------------------------------------

    def _resolve_chat_url(self) -> str:
        """解析 Chat Completions 端点（配置驱动，铁律 11）。

        端点经 ``OPENAI_BASE_URL`` env 注入，缺省用官方稳定端点。
        """
        base_url = os.environ.get(
            "OPENAI_BASE_URL", self.DEFAULT_BASE_URL
        ).rstrip("/")
        return f"{base_url}/chat/completions"

    def _resolve_model(self) -> str:
        """解析 Codex 使用的模型名（配置驱动，铁律 11）。

        ``OPENAI_MODEL`` env 注入模型名；未配置时回退到 Manifest 中声明的
        默认模型（若 codex.yaml 配置了）或 ``gpt-4o`` 标准模型。
        """
        model = os.environ.get("OPENAI_MODEL")
        if model:
            return model
        declared = getattr(self.manifest, "model", None)
        return declared or "gpt-4o"

    def _build_payload(
        self,
        task: str,
        context: dict[str, Any],
        model: str,
        stream: bool,
    ) -> dict[str, Any]:
        """构造 /chat/completions 请求体（配置驱动）。

        支持（均为调用方经 context 注入，避免 hardcode）：
            - context["system_prompt"]：系统提示词
            - context["history"]：多轮对话历史（role/content 列表）
            - context["openai_tools"]：function calling 工具（协议：API + function calling）
            - context["structured_response"]：请求 ``response_format`` JSON 输出

        Args:
            task: 用户任务。
            context: 调用上下文（forgekin_id / shared_state / system_prompt / history / tools）。
            model: 模型名。
            stream: 是否流式。

        Returns:
            请求体字典。
        """
        messages: list[dict[str, Any]] = []
        system_prompt = (context or {}).get("system_prompt")
        if isinstance(system_prompt, str) and system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        history = (context or {}).get("history")
        if isinstance(history, list):
            # 仅透传 role/content 表单（出站不带代码，避免污染）
            for turn in history:
                if not isinstance(turn, dict):
                    continue
                role = turn.get("role")
                content = turn.get("content")
                if role in ("system", "user", "assistant") and isinstance(content, str):
                    messages.append({"role": role, "content": content})
        messages.append({"role": "user", "content": task})

        payload: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "stream": stream,
        }
        tools = (context or {}).get("openai_tools")
        if isinstance(tools, list) and tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"
        if (context or {}).get("structured_response") is True:
            payload["response_format"] = {"type": "json_object"}
        return payload

    async def _call_chat_completions(
        self,
        url: str,
        headers: dict[str, str],
        payload: dict[str, Any],
    ) -> tuple[dict[str, Any], int]:
        """POST /chat/completions（含重试），返回 (响应 JSON, 实际重试次数)。

        重试策略来自 ``manifest.retry_policy``（max_attempts / backoff_seconds），
        配置驱动（铁律 11）。仅对传输错误与 5xx 重试；4xx 为调用方错误，不重试。
        """
        max_attempts = int(self.manifest.retry_policy.get("max_attempts", 1) or 1)
        backoff = float(self.manifest.retry_policy.get("backoff_seconds", 1) or 1)

        timeout = httpx.Timeout(self.manifest.timeout_seconds, connect=30.0)
        attempts = 0
        while True:
            attempts += 1
            try:
                async with httpx.AsyncClient(timeout=timeout) as client:
                    response = await client.post(url, headers=headers, json=payload)
                    response.raise_for_status()
                    body = response.json()
            except (httpx.TimeoutException, httpx.RequestError) as exc:
                if attempts < max_attempts:
                    logger.warning(
                        "codex.invoke retry attempt=%d/%d error=%s",
                        attempts,
                        max_attempts,
                        exc,
                    )
                    await asyncio.sleep(backoff * attempts)
                    continue
                raise
            except httpx.HTTPStatusError as exc:
                if (
                    exc.response.status_code >= 500
                    and attempts < max_attempts
                ):
                    logger.warning(
                        "codex.invoke retry attempt=%d/%d status=%d",
                        attempts,
                        max_attempts,
                        exc.response.status_code,
                    )
                    await asyncio.sleep(backoff * attempts)
                    continue
                raise
            if not isinstance(body, dict):
                raise httpx.HTTPStatusError(
                    message="CodexAdapter: Chat Completions 响应非 JSON 对象",
                    request=response.request,
                    response=response,
                )
            return body, attempts - 1

    def _extract_message(self, data: dict[str, Any]) -> dict[str, Any]:
        """从响应中提取首个 choice 的 message（content / tool_calls）。"""
        choices = data.get("choices") if isinstance(data, dict) else None
        if not isinstance(choices, list) or not choices:
            return {"content": None, "tool_calls": None}
        first = choices[0]
        message = first.get("message") if isinstance(first, dict) else None
        if not isinstance(message, dict):
            return {"content": None, "tool_calls": None}
        return {
            "content": message.get("content"),
            "tool_calls": message.get("tool_calls"),
        }