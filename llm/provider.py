"""LLM provider abstraction.

Three provider kinds (configurable via llm_route.yaml):
- DirectProvider  — calls vendor API directly (Anthropic, OpenAI, Zhipu, etc.)
- OpenRouteProvider — calls OpenRoute /v1/chat/completions gateway
- WebchatProvider — drives a browser session for webchat-only models

All providers implement the same async interface so the client can fall back
across vendors seamlessly.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.llm.provider")


@dataclass
class ProviderResponse:
    """Normalized response from any provider."""

    text: str
    model: str
    provider: str
    raw: dict[str, Any] | None = field(default=None)
    latency_ms: float = 0.0
    finish_reason: str = "stop"


@dataclass
class LLMResponse:
    """LLM 调用统一响应（与老项目 flowforge/llm/provider.py 一致）.

    保留此类以确保 ``llm/trae/adapter.py``、``llm/route.py``、
    ``forgemind`` 模块等使用 ``LLMResponse`` 命名的代码正常工作。
    字段集合为 ``ProviderResponse`` 的超集（含 token 计数 / 成本 / 原始响应）。
    """

    content: str
    model: str
    provider: str
    input_tokens: int = 0
    output_tokens: int = 0
    latency_ms: float = 0.0
    cost: float = 0.0
    finish_reason: str = ""
    raw_response: dict[str, Any] | None = field(default=None)


class LLMProvider(ABC):
    """Async LLM provider protocol."""

    provider_kind: str = "abstract"
    vendor: str = "unknown"

    @abstractmethod
    async def complete(
        self,
        prompt: str,
        *,
        model: str,
        system_prompt: str | None = None,
        temperature: float = 0.7,
        max_tokens: int = 2000,
        timeout: float = 90.0,
        **kwargs: Any,
    ) -> ProviderResponse:
        """Produce a completion. Raises on transport error; caller classifies."""


class DirectProvider(LLMProvider):
    """Calls vendor API directly via httpx.

    A DirectProvider is constructed with a base_url + api_key + a request
    formatter. Production code wires this up from llm_route.yaml.
    """

    provider_kind = "direct"

    def __init__(
        self,
        vendor: str,
        base_url: str,
        api_key: str,
        request_formatter: Any | None = None,
    ) -> None:
        self.vendor = vendor
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        # request_formatter: (prompt, system_prompt, model, **kwargs) -> dict body
        self.request_formatter = request_formatter or self._default_formatter

    async def complete(
        self,
        prompt: str,
        *,
        model: str,
        system_prompt: str | None = None,
        temperature: float = 0.7,
        max_tokens: int = 2000,
        timeout: float = 90.0,
        **kwargs: Any,
    ) -> ProviderResponse:
        import time

        import httpx

        body = self.request_formatter(prompt, system_prompt, model, temperature, max_tokens, **kwargs)
        url = f"{self.base_url}/v1/chat/completions"
        headers: dict[str, str] = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        start = time.perf_counter()
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(url, json=body, headers=headers)
            latency_ms = (time.perf_counter() - start) * 1000
            resp.raise_for_status()
            data = resp.json()
        text = _extract_text(data)
        return ProviderResponse(
            text=text,
            model=data.get("model", model),
            provider=self.vendor,
            raw=data,
            latency_ms=latency_ms,
            finish_reason=_extract_finish_reason(data),
        )

    @staticmethod
    def _default_formatter(
        prompt: str,
        system_prompt: str | None,
        model: str,
        temperature: float,
        max_tokens: int,
        **_: Any,
    ) -> dict[str, Any]:
        messages: list[dict[str, str]] = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})
        return {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }


class OpenRouteProvider(LLMProvider):
    """Calls OpenRoute /v1/chat/completions gateway (multi-model aggregator)."""

    provider_kind = "openroute"
    vendor = "openroute"

    def __init__(self, base_url: str, api_key: str) -> None:
        # Use .removesuffix("/v1") to avoid stripping trailing '1' from port numbers
        self.base_url = base_url.removesuffix("/v1").rstrip("/")
        self.api_key = api_key

    async def complete(
        self,
        prompt: str,
        *,
        model: str,
        system_prompt: str | None = None,
        temperature: float = 0.7,
        max_tokens: int = 2000,
        timeout: float = 90.0,
        **kwargs: Any,
    ) -> ProviderResponse:
        import time

        import httpx

        messages: list[dict[str, str]] = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})
        body = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            **kwargs,
        }
        headers: dict[str, str] = {"Content-Type": "application/json"}
        # Only add Authorization when api_key is non-empty — local OpenRoute
        # (port 13001) doesn't require auth, and an empty Bearer header
        # causes httpx.LocalProtocolError("Illegal header value b'Bearer '").
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        url = f"{self.base_url}/v1/chat/completions"
        start = time.perf_counter()
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(url, json=body, headers=headers)
            latency_ms = (time.perf_counter() - start) * 1000
            resp.raise_for_status()
            data = resp.json()
        # OpenRoute silent failure: HTTP 200 with error body
        if isinstance(data, dict) and "error" in data:
            err = data["error"]
            err_msg = err.get("message", str(err)) if isinstance(err, dict) else str(err)
            logger.warning(f"openroute silent failure: {err_msg}")
            # Return the error text so the client can classify it
            return ProviderResponse(
                text=err_msg,
                model=model,
                provider="openroute",
                raw=data,
                latency_ms=latency_ms,
                finish_reason="error",
            )
        text = _extract_text(data)
        return ProviderResponse(
            text=text,
            model=data.get("model", model),
            provider="openroute",
            raw=data,
            latency_ms=latency_ms,
            finish_reason=_extract_finish_reason(data),
        )


class WebchatProvider(LLMProvider):
    """Drives a browser session for webchat-only models (Doubao/Kimi/etc).

    v0.1 stub: returns NotImplemented to indicate the caller should skip this
    provider in unit tests. Production code injects a real browser manager.
    """

    provider_kind = "webchat"
    vendor = "webchat"

    def __init__(self, browser_manager: Any | None = None) -> None:
        self.browser_manager = browser_manager

    async def complete(
        self,
        prompt: str,
        *,
        model: str,
        system_prompt: str | None = None,
        temperature: float = 0.7,
        max_tokens: int = 2000,
        timeout: float = 90.0,
        **kwargs: Any,
    ) -> ProviderResponse:
        if self.browser_manager is None:
            raise NotImplementedError("WebchatProvider requires a browser_manager")
        # Production: drive browser, scrape reply, return ProviderResponse
        raise NotImplementedError("WebchatProvider.complete not implemented in v0.1")


def _extract_text(data: dict[str, Any]) -> str:
    """Extract text from a chat.completion response, tolerating shape variants."""
    if not isinstance(data, dict):
        return ""
    if "error" in data:
        return ""
    choices = data.get("choices") or []
    if not choices:
        return ""
    first = choices[0] if isinstance(choices, list) else {}
    msg = first.get("message", {}) if isinstance(first, dict) else {}
    return msg.get("content", "") or ""


def _extract_finish_reason(data: dict[str, Any]) -> str:
    choices = data.get("choices") or []
    if not choices:
        return "stop"
    first = choices[0] if isinstance(choices, list) else {}
    return first.get("finish_reason", "stop") if isinstance(first, dict) else "stop"


# Provider 注册表（与老项目 flowforge/llm/provider.py 一致，
# 确保 ``llm/trae/adapter.py``、``llm/route.py`` 等使用
# ``register_provider`` / ``get_provider`` 的代码正常工作）
_PROVIDER_REGISTRY: dict[str, type] = {
    "direct": DirectProvider,
    "openroute": OpenRouteProvider,
    "webchat": WebchatProvider,
}


def register_provider(name: str, provider_cls: type) -> None:
    """注册自定义 Provider."""
    _PROVIDER_REGISTRY[name] = provider_cls


def get_provider(name: str, config: dict[str, Any] | None = None) -> LLMProvider:
    """获取 Provider 实例."""
    cls = _PROVIDER_REGISTRY.get(name)
    if not cls:
        raise ValueError(
            f"未知 Provider: {name}，可用: {list(_PROVIDER_REGISTRY.keys())}"
        )
    return cls(config=config)
