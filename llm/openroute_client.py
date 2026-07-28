"""OpenRoute LLM Client — 通过 HTTP 调用 OpenRoute 网关的 LLM 客户端.

为 Forgekin 提供统一的 LLM 调用接口，兼容 TraeLLMClient 的 chat() 方法签名。
每个 Forgekin 可在 YAML 中配置不同的 model，实现"一灵智体一模型"的差异化。

配置示例（forgekin YAML）:
    llm:
      provider: openroute
      model: Claude-4.8-Sonnet
      temperature: 0.7
      max_tokens: 8192

设计原则:
    - 铁律 3：依赖通过构造函数注入
    - 铁律 5：不硬编码路径/密钥（从环境变量读取）
    - 红线 11：不硬编码密钥
    - 兼容 TraeLLMClient 接口：chat() 返回 dict（含 content/model/usage/session_id）
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from typing import Any

import httpx

from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.llm.openroute_client")

# ── 配置（从环境变量读取，不硬编码）──────────────────────────────
_OPENROUTE_BASE_URL = os.environ.get(
    "OPENROUTE_BASE_URL",
    "http://localhost:13001/v1",
).removesuffix("/v1")

_OPENROUTE_API_KEY = os.environ.get(
    "OPENROUTE_API_KEY",
    "or-6eb9e20d63d01d190b0e26d06c9f5acc4a0ea248a5dd62e7",
)


class OpenRouteLLMClient:
    """通过 HTTP 调用 OpenRoute 网关的 LLM 客户端.

    接口与 TraeLLMClient.chat() 兼容，可被 ForgekinBase 直接使用。
    每个 Forgekin 实例可指定不同的 model，实现差异化对话。
    """

    def __init__(
        self,
        model: str = "Doubao-Seed2.0",
        *,
        base_url: str | None = None,
        api_key: str | None = None,
        default_timeout: float = 90.0,
    ) -> None:
        self.model = model
        self._base_url = (base_url or _OPENROUTE_BASE_URL).removesuffix("/v1")
        self._api_key = api_key or _OPENROUTE_API_KEY
        self._default_timeout = default_timeout
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        """延迟初始化 httpx 客户端（复用连接池）。"""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self._base_url,
                timeout=httpx.Timeout(self._default_timeout, connect=10.0),
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Content-Type": "application/json",
                },
            )
        return self._client

    async def chat(
        self,
        messages: list[dict[str, str]],
        *,
        session_id: str = "",
        timeout: float | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """调用 OpenRoute /v1/chat/completions 端点.

        Args:
            messages: OpenAI 格式消息列表
                ``[{"role": "system"|"user"|"assistant", "content": str}]``
            session_id: 会话 ID（用于日志追踪）
            timeout: 超时秒数（覆盖默认值）
            **kwargs: 透传参数（temperature/max_tokens/model 等）

        Returns:
            与 TraeLLMClient 兼容的响应字典:
                - content: str — LLM 生成的文本
                - model: str — 实际使用的模型名
                - usage: dict — token 用量与延迟
                - session_id: str — 会话 ID
        """
        model = kwargs.pop("model", self.model)
        temperature = kwargs.pop("temperature", 0.7)
        max_tokens = kwargs.pop("max_tokens", 8192)
        timeout_s = timeout or self._default_timeout

        client = await self._get_client()
        start_ts = time.monotonic()

        logger.info(
            "openroute chat: model=%s session=%s msg_count=%d timeout=%ss",
            model, session_id, len(messages), timeout_s,
        )

        try:
            resp = await client.post(
                "/v1/chat/completions",
                json={
                    "model": model,
                    "messages": messages,
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                    "stream": False,
                },
                timeout=timeout_s,
            )
        except httpx.TimeoutException as exc:
            latency_ms = int((time.monotonic() - start_ts) * 1000)
            logger.warning("openroute timeout: model=%s latency=%dms", model, latency_ms)
            return {
                "content": f"[OpenRoute 超时] 模型 {model} 在 {timeout_s}s 后未响应: {exc}",
                "model": model,
                "usage": {"latency_ms": latency_ms, "error": "timeout"},
                "session_id": session_id,
            }
        except httpx.HTTPError as exc:
            latency_ms = int((time.monotonic() - start_ts) * 1000)
            logger.error("openroute http error: %s", exc)
            return {
                "content": f"[OpenRoute 网络错误] {type(exc).__name__}: {exc}",
                "model": model,
                "usage": {"latency_ms": latency_ms, "error": "http_error"},
                "session_id": session_id,
            }

        latency_ms = int((time.monotonic() - start_ts) * 1000)

        if resp.status_code != 200:
            error_text = resp.text[:500]
            logger.error(
                "openroute http %d: model=%s body=%s",
                resp.status_code, model, error_text,
            )
            return {
                "content": f"[OpenRoute HTTP {resp.status_code}] {error_text}",
                "model": model,
                "usage": {"latency_ms": latency_ms, "error": f"http_{resp.status_code}"},
                "session_id": session_id,
            }

        try:
            data = resp.json()
        except json.JSONDecodeError as exc:
            logger.error("openroute json decode error: %s", exc)
            return {
                "content": f"[OpenRoute 响应解析失败] {exc}",
                "model": model,
                "usage": {"latency_ms": latency_ms, "error": "json_decode"},
                "session_id": session_id,
            }

        # 解析 OpenAI 格式响应
        # 检查 error 字段（OpenRoute 可能返回 HTTP 200 + error body）
        if "error" in data:
            error_info = data["error"]
            error_msg = error_info.get("message", str(error_info)) if isinstance(error_info, dict) else str(error_info)
            logger.error("openroute error body: model=%s error=%s", model, error_msg[:200])
            return {
                "content": f"[OpenRoute 错误] {error_msg}",
                "model": model,
                "usage": {"latency_ms": latency_ms, "error": "api_error"},
                "session_id": session_id,
            }

        choices = data.get("choices", [])
        if not choices:
            logger.warning("openroute empty choices: model=%s", model)
            return {
                "content": f"[OpenRoute 空响应] 模型 {model} 未返回任何选项",
                "model": model,
                "usage": {"latency_ms": latency_ms, "error": "empty_choices"},
                "session_id": session_id,
            }

        choice = choices[0]
        message = choice.get("message", {})
        content = message.get("content", "")

        usage_info = data.get("usage", {})
        usage = {
            "latency_ms": latency_ms,
            "prompt_tokens": usage_info.get("prompt_tokens", 0),
            "completion_tokens": usage_info.get("completion_tokens", 0),
            "total_tokens": usage_info.get("total_tokens", 0),
        }

        logger.info(
            "openroute success: model=%s latency=%dms tokens=%d",
            model, latency_ms, usage.get("total_tokens", 0),
        )

        return {
            "content": content,
            "model": data.get("model", model),
            "usage": usage,
            "session_id": session_id,
        }

    async def close(self) -> None:
        """关闭 HTTP 客户端连接池。"""
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None


def build_openroute_client(model: str) -> OpenRouteLLMClient:
    """根据模型名构建 OpenRoute LLM 客户端.

    Args:
        model: OpenRoute 中的模型名（如 "Claude-4.8-Sonnet"）

    Returns:
        OpenRouteLLMClient 实例
    """
    return OpenRouteLLMClient(model=model)
