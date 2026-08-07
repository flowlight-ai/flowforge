"""OpenRoute LLM client adapter for ForgekinBase.

当 Trae CN 桥接不可用（如 Trae CN IDE 未运行、trae_bridge 目录无响应）时，
ForgekinBase.chat() 需要一个兼容的 LLM 客户端来保证群聊功能可用。

本适配器直接通过 httpx 调用 OpenRoute 网关的 ``/v1/chat/completions`` 端点
（默认 13001 端口），提供 ``chat()`` 方法返回字典格式
（与 TraeLLMClient.chat() 接口一致），让 ForgekinBase 能调用 LLM。

接口契约（与 ``forgemind/base.py`` 期望的 ``_llm_client.chat()`` 一致）：
    输入: messages: list[dict[str, str]], session_id: str | None, **kwargs
    输出: dict 含 content / model / usage / session_id / forgekin_id
"""

from __future__ import annotations

import os
import time
from typing import Any

import httpx

from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.forgemind.openroute_adapter")


class OpenRouteLLMClient:
    """OpenRoute LLM 客户端适配器 — 提供 TraeLLMClient 兼容的 chat() 接口.

    用于在 Trae CN 桥接不可用时，让 ForgekinBase 通过 OpenRoute 网关
    调用 LLM，保证群聊（council）功能可用。

    配置来源（按优先级）：
        1. 环境变量 ``FLOWFORGE_LLM_ROUTE_OPENROUTE_BASE_URL``
        2. 环境变量 ``OPENROUTE_BASE_URL``
        3. 默认 ``http://localhost:13001``
    """

    def __init__(self) -> None:
        self._base_url = (
            os.getenv("FLOWFORGE_LLM_ROUTE_OPENROUTE_BASE_URL")
            or os.getenv("OPENROUTE_BASE_URL")
            or "http://localhost:13001"
        ).rstrip("/")
        self._api_key = (
            os.getenv("FLOWFORGE_LLM_ROUTE_OPENROUTE_API_KEY")
            or os.getenv("OPENROUTE_API_KEY")
            or ""
        )
        self._default_model = os.getenv(
            "FLOWFORGE_FORGEMIND_OPENROUTE_MODEL",
            "openai/gpt-4o-mini",
        )
        logger.info(
            f"OpenRouteLLMClient 已初始化（base_url={self._base_url}, "
            f"model={self._default_model})"
        )

    async def chat(
        self,
        messages: list[dict[str, str]],
        *,
        session_id: str | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """调用 OpenRoute LLM，返回与 TraeLLMClient.chat() 兼容的字典.

        Args:
            messages: OpenAI 格式消息列表
                ``[{"role": "system"|"user"|"assistant", "content": str}]``。
            session_id: 会话 ID（仅记录，不用于 OpenRoute 调用）。
            **kwargs: 透传参数（temperature/max_tokens/model/timeout 等）。
        """
        model = kwargs.get("model", self._default_model)
        temperature = float(kwargs.get("temperature", 0.7))
        max_tokens = int(kwargs.get("max_tokens", 2000))
        timeout = float(kwargs.get("timeout", 90.0))

        payload = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"

        start = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.post(
                    f"{self._base_url}/v1/chat/completions",
                    json=payload,
                    headers=headers,
                )
            latency_ms = (time.perf_counter() - start) * 1000

            if resp.status_code != 200:
                err_text = resp.text[:300]
                logger.warning(
                    f"OpenRoute HTTP {resp.status_code}: latency={latency_ms:.0f}ms "
                    f"err={err_text}"
                )
                return {
                    "content": f"[OpenRoute HTTP {resp.status_code}] {err_text}",
                    "model": model,
                    "provider": "openroute",
                    "usage": {"latency_ms": latency_ms, "error": True},
                    "session_id": session_id or "",
                    "forgekin_id": "",
                    "error": f"HTTP {resp.status_code}: {err_text}",
                }

            data = resp.json()
            choices = data.get("choices") or []
            content = ""
            if choices:
                first = choices[0] if isinstance(choices, list) else {}
                msg = first.get("message", {}) if isinstance(first, dict) else {}
                content = msg.get("content", "") or ""
            usage = data.get("usage", {}) or {}

            logger.info(
                f"OpenRoute chat OK: model={model}, latency={latency_ms:.0f}ms, "
                f"len={len(content)}"
            )
            return {
                "content": content,
                "model": data.get("model", model),
                "provider": "openroute",
                "usage": {
                    "latency_ms": latency_ms,
                    "input_tokens": usage.get("prompt_tokens", 0),
                    "output_tokens": usage.get("completion_tokens", 0),
                },
                "session_id": session_id or "",
                "forgekin_id": "",
            }
        except httpx.TimeoutException as exc:
            latency_ms = (time.perf_counter() - start) * 1000
            logger.warning(f"OpenRoute timeout: latency={latency_ms:.0f}ms")
            return {
                "content": f"[OpenRoute 超时] {exc}",
                "model": model,
                "provider": "openroute",
                "usage": {"latency_ms": latency_ms, "error": True},
                "session_id": session_id or "",
                "forgekin_id": "",
                "error": f"timeout: {exc}",
            }
        except Exception as exc:  # noqa: BLE001
            latency_ms = (time.perf_counter() - start) * 1000
            logger.exception(f"OpenRoute chat 异常: latency={latency_ms:.0f}ms")
            return {
                "content": f"[OpenRoute 异常] {type(exc).__name__}: {exc}",
                "model": model,
                "provider": "openroute",
                "usage": {"latency_ms": latency_ms, "error": True},
                "session_id": session_id or "",
                "forgekin_id": "",
                "error": str(exc),
            }


__all__ = ["OpenRouteLLMClient"]
