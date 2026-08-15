"""LLM Provider 抽象层 — Protocol/Route/Provider 三层分离的 Provider 层.

每个 LLM 供应商实现 LLMProvider 接口，提供统一的 chat/stream/health_check 方法。
LLMRouter 通过 Provider 层与具体 LLM 服务解耦。
"""

import asyncio
import json
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Dict, List, Optional

import httpx

from flowforge.core.tracing import get_logger

logger = get_logger("llm.provider")


@dataclass
class LLMResponse:
    """LLM 调用统一响应."""

    content: str
    model: str
    provider: str
    input_tokens: int = 0
    output_tokens: int = 0
    latency_ms: float = 0.0
    cost: float = 0.0
    finish_reason: str = ""
    raw_response: Optional[Dict[str, Any]] = None


class LLMProvider(ABC):
    """LLM 供应商抽象基类.

    每个供应商（Doubao/Qwen/DeepSeek 等）实现此接口，
    提供 chat/stream/health_check 统一方法。
    """

    provider_name: str = ""

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self._config = config or {}
        self._healthy = True
        self._consecutive_errors = 0

    @abstractmethod
    async def chat(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        **kwargs,
    ) -> LLMResponse:
        """同步聊天调用."""

    @abstractmethod
    async def stream(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        **kwargs,
    ) -> AsyncIterator[str]:
        """流式聊天调用."""

    @abstractmethod
    async def health_check(self) -> bool:
        """检查供应商是否健康."""

    def get_provider_name(self) -> str:
        return self.provider_name

    def is_healthy(self) -> bool:
        return self._healthy

    def record_success(self):
        self._consecutive_errors = 0
        self._healthy = True

    def record_error(self):
        self._consecutive_errors += 1
        if self._consecutive_errors >= 3:
            self._healthy = False
            logger.warning(
                f"Provider {self.provider_name} 连续 {self._consecutive_errors} 次错误，标记为不健康"
            )


class DoubaoProvider(LLMProvider):
    """豆包（Doubao）供应商实现.

    通过 FlowForge LLMClient 调用豆包 API，
    支持 doubao-seed2、doubao-pro、doubao-lite 等模型。
    """

    provider_name = "doubao"

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        super().__init__(config)
        self._default_model = (config or {}).get("default_model", "doubao-seed2")

    async def chat(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        **kwargs,
    ) -> LLMResponse:
        """调用豆包聊天 API."""
        try:
            from flowforge.tools.llm_client import LLMClient

            client = LLMClient()
            result = await client.chat(
                messages=messages,
                model=model or self._default_model,
                temperature=temperature,
                max_tokens=max_tokens,
                **kwargs,
            )
            self.record_success()
            return LLMResponse(
                content=result.get("content", ""),
                model=model or self._default_model,
                provider=self.provider_name,
                input_tokens=result.get("input_tokens", 0),
                output_tokens=result.get("output_tokens", 0),
                latency_ms=result.get("latency_ms", 0.0),
                cost=result.get("cost", 0.0),
                finish_reason=result.get("finish_reason", ""),
                raw_response=result,
            )
        except Exception as e:
            self.record_error()
            logger.error(f"DoubaoProvider.chat 失败: {e}")
            raise

    async def stream(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        **kwargs,
    ) -> AsyncIterator[str]:
        """调用豆包流式 API."""
        try:
            from flowforge.tools.llm_client import LLMClient

            client = LLMClient()
            async for chunk in client.stream(
                messages=messages,
                model=model or self._default_model,
                temperature=temperature,
                max_tokens=max_tokens,
                **kwargs,
            ):
                yield chunk
            self.record_success()
        except Exception as e:
            self.record_error()
            logger.error(f"DoubaoProvider.stream 失败: {e}")
            raise

    async def health_check(self) -> bool:
        """检查豆包 API 是否可达."""
        try:
            from flowforge.tools.llm_client import LLMClient

            client = LLMClient()
            result = await client.chat(
                messages=[{"role": "user", "content": "ping"}],
                model=self._default_model,
                max_tokens=5,
            )
            self._healthy = bool(result)
            return self._healthy
        except Exception:
            self._healthy = False
            return False


class QwenProvider(LLMProvider):
    """通义千问（Qwen）供应商实现."""

    provider_name = "qwen"

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        super().__init__(config)
        self._default_model = (config or {}).get("default_model", "qwen3.6-plus")

    async def chat(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        **kwargs,
    ) -> LLMResponse:
        try:
            from flowforge.tools.llm_client import LLMClient

            client = LLMClient()
            result = await client.chat(
                messages=messages,
                model=model or self._default_model,
                temperature=temperature,
                max_tokens=max_tokens,
                **kwargs,
            )
            self.record_success()
            return LLMResponse(
                content=result.get("content", ""),
                model=model or self._default_model,
                provider=self.provider_name,
                input_tokens=result.get("input_tokens", 0),
                output_tokens=result.get("output_tokens", 0),
                latency_ms=result.get("latency_ms", 0.0),
                cost=result.get("cost", 0.0),
                finish_reason=result.get("finish_reason", ""),
                raw_response=result,
            )
        except Exception as e:
            self.record_error()
            logger.error(f"QwenProvider.chat 失败: {e}")
            raise

    async def stream(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        **kwargs,
    ) -> AsyncIterator[str]:
        try:
            from flowforge.tools.llm_client import LLMClient

            client = LLMClient()
            async for chunk in client.stream(
                messages=messages,
                model=model or self._default_model,
                temperature=temperature,
                max_tokens=max_tokens,
                **kwargs,
            ):
                yield chunk
            self.record_success()
        except Exception as e:
            self.record_error()
            logger.error(f"QwenProvider.stream 失败: {e}")
            raise

    async def health_check(self) -> bool:
        try:
            from flowforge.tools.llm_client import LLMClient

            client = LLMClient()
            result = await client.chat(
                messages=[{"role": "user", "content": "ping"}],
                model=self._default_model,
                max_tokens=5,
            )
            self._healthy = bool(result)
            return self._healthy
        except Exception:
            self._healthy = False
            return False


class DeepSeekProvider(LLMProvider):
    """DeepSeek 供应商实现."""

    provider_name = "deepseek"

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        super().__init__(config)
        self._default_model = (config or {}).get("default_model", "deepseek-chat")

    async def chat(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        **kwargs,
    ) -> LLMResponse:
        try:
            from flowforge.tools.llm_client import LLMClient

            client = LLMClient()
            result = await client.chat(
                messages=messages,
                model=model or self._default_model,
                temperature=temperature,
                max_tokens=max_tokens,
                **kwargs,
            )
            self.record_success()
            return LLMResponse(
                content=result.get("content", ""),
                model=model or self._default_model,
                provider=self.provider_name,
                input_tokens=result.get("input_tokens", 0),
                output_tokens=result.get("output_tokens", 0),
                latency_ms=result.get("latency_ms", 0.0),
                cost=result.get("cost", 0.0),
                finish_reason=result.get("finish_reason", ""),
                raw_response=result,
            )
        except Exception as e:
            self.record_error()
            logger.error(f"DeepSeekProvider.chat 失败: {e}")
            raise

    async def stream(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        **kwargs,
    ) -> AsyncIterator[str]:
        try:
            from flowforge.tools.llm_client import LLMClient

            client = LLMClient()
            async for chunk in client.stream(
                messages=messages,
                model=model or self._default_model,
                temperature=temperature,
                max_tokens=max_tokens,
                **kwargs,
            ):
                yield chunk
            self.record_success()
        except Exception as e:
            self.record_error()
            logger.error(f"DeepSeekProvider.stream 失败: {e}")
            raise

    async def health_check(self) -> bool:
        try:
            from flowforge.tools.llm_client import LLMClient

            client = LLMClient()
            result = await client.chat(
                messages=[{"role": "user", "content": "ping"}],
                model=self._default_model,
                max_tokens=5,
            )
            self._healthy = bool(result)
            return self._healthy
        except Exception:
            self._healthy = False
            return False


class OpenRouteProvider(LLMProvider):
    """OpenRoute 网关供应商实现.

    通过 OpenRoute API 网关调用 LLM，遵循 OpenAI Chat Completions API 标准。
    每次调用创建独立的 httpx.AsyncClient，保证并发安全（与 LLMClient 模式一致）。
    """

    provider_name = "openroute"

    def __init__(self, base_url: str, api_key: str):
        super().__init__(None)
        # 规范化 base_url：去除尾部斜杠与 /v1 后缀，统一在方法中拼接端点
        self._base_url = base_url.rstrip("/").removesuffix("/v1")
        self._api_key = api_key
        self._default_model = "Doubao-Seed2.0"
        self._timeout = 90.0

    async def chat(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        **kwargs,
    ) -> LLMResponse:
        """调用 OpenRoute /v1/chat/completions 端点（非流式）."""
        used_model = model or self._default_model
        payload = {
            "model": used_model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
        }
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        start_ts = time.monotonic()
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(self._timeout, connect=10.0)
            ) as client:
                resp = await client.post(
                    f"{self._base_url}/v1/chat/completions",
                    json=payload,
                    headers=headers,
                )
        except httpx.TimeoutException as exc:
            self.record_error()
            logger.error(f"OpenRouteProvider.chat 超时: {exc}")
            raise
        except httpx.HTTPError as exc:
            self.record_error()
            logger.error(f"OpenRouteProvider.chat 网络错误: {exc}")
            raise

        latency_ms = (time.monotonic() - start_ts) * 1000

        if resp.status_code != 200:
            self.record_error()
            logger.error(
                f"OpenRouteProvider.chat HTTP {resp.status_code}: {resp.text[:500]}"
            )
            raise RuntimeError(
                f"OpenRoute HTTP {resp.status_code}: {resp.text[:200]}"
            )

        try:
            data = resp.json()
        except Exception as exc:
            self.record_error()
            logger.error(f"OpenRouteProvider.chat 响应解析失败: {exc}")
            raise

        choices = data.get("choices", []) or []
        if not choices:
            self.record_error()
            logger.error(f"OpenRouteProvider.chat 空响应: model={used_model}")
            raise RuntimeError("OpenRoute 返回空 choices")

        choice = choices[0]
        message = choice.get("message", {}) or {}
        content = message.get("content", "")
        finish_reason = choice.get("finish_reason", "")

        usage_info = data.get("usage", {}) or {}
        input_tokens = int(usage_info.get("prompt_tokens", 0))
        output_tokens = int(usage_info.get("completion_tokens", 0))

        self.record_success()
        return LLMResponse(
            content=content,
            model=data.get("model", used_model),
            provider=self.provider_name,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            latency_ms=latency_ms,
            finish_reason=finish_reason,
            raw_response=data,
        )

    async def stream(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        **kwargs,
    ) -> AsyncIterator[str]:
        """调用 OpenRoute /v1/chat/completions 端点（SSE 流式）."""
        used_model = model or self._default_model
        payload = {
            "model": used_model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
        }
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        }
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(self._timeout, connect=10.0)
            ) as client:
                async with client.stream(
                    "POST",
                    f"{self._base_url}/v1/chat/completions",
                    json=payload,
                    headers=headers,
                ) as resp:
                    if resp.status_code != 200:
                        self.record_error()
                        body = await resp.aread()
                        logger.error(
                            f"OpenRouteProvider.stream HTTP {resp.status_code}: "
                            f"{body.decode(errors='replace')[:500]}"
                        )
                        raise RuntimeError(
                            f"OpenRoute stream HTTP {resp.status_code}"
                        )
                    async for line in resp.aiter_lines():
                        if not line or not line.startswith("data: "):
                            continue
                        chunk = line[len("data: "):]
                        if chunk == "[DONE]":
                            break
                        try:
                            obj = json.loads(chunk)
                        except Exception:
                            continue
                        choices = obj.get("choices", []) or []
                        if not choices:
                            continue
                        delta = choices[0].get("delta", {}) or {}
                        piece = delta.get("content", "")
                        if piece:
                            yield piece
            self.record_success()
        except httpx.HTTPError as exc:
            self.record_error()
            logger.error(f"OpenRouteProvider.stream 网络错误: {exc}")
            raise
        except RuntimeError:
            raise
        except Exception as exc:
            self.record_error()
            logger.error(f"OpenRouteProvider.stream 失败: {exc}")
            raise

    async def health_check(self) -> bool:
        """检查 OpenRoute 网关是否健康 — GET {base_url}/health."""
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(5.0, connect=3.0)
            ) as client:
                resp = await client.get(f"{self._base_url}/health")
            self._healthy = resp.status_code == 200
            return self._healthy
        except Exception:
            self._healthy = False
            return False


class DirectProvider(LLMProvider):
    """直连厂商 API 供应商实现.

    直接调用厂商原生 OpenAI 兼容端点（如 Doubao/Qwen/DeepSeek），
    绕过 OpenRoute 网关以降低延迟。provider_name 即 vendor 名。
    """

    # 各厂商默认模型映射
    _VENDOR_DEFAULT_MODELS: Dict[str, str] = {
        "doubao": "doubao-seed2",
        "qwen": "qwen3.6-plus",
        "deepseek": "deepseek-chat",
    }

    def __init__(self, vendor: str, base_url: str, api_key: str):
        super().__init__(None)
        self.provider_name = vendor
        self._vendor = vendor
        self._base_url = base_url.rstrip("/").removesuffix("/v1")
        self._api_key = api_key
        self._default_model = self._VENDOR_DEFAULT_MODELS.get(
            vendor.lower(), "gpt-4o-mini"
        )
        self._timeout = 90.0

    async def chat(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        **kwargs,
    ) -> LLMResponse:
        """调用厂商 /v1/chat/completions 端点（OpenAI 兼容格式，非流式）."""
        used_model = model or self._default_model
        payload = {
            "model": used_model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
        }
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        start_ts = time.monotonic()
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(self._timeout, connect=10.0)
            ) as client:
                resp = await client.post(
                    f"{self._base_url}/v1/chat/completions",
                    json=payload,
                    headers=headers,
                )
        except httpx.TimeoutException as exc:
            self.record_error()
            logger.error(f"DirectProvider[{self._vendor}].chat 超时: {exc}")
            raise
        except httpx.HTTPError as exc:
            self.record_error()
            logger.error(f"DirectProvider[{self._vendor}].chat 网络错误: {exc}")
            raise

        latency_ms = (time.monotonic() - start_ts) * 1000

        if resp.status_code != 200:
            self.record_error()
            logger.error(
                f"DirectProvider[{self._vendor}].chat HTTP {resp.status_code}: "
                f"{resp.text[:500]}"
            )
            raise RuntimeError(
                f"DirectProvider {self._vendor} HTTP {resp.status_code}: "
                f"{resp.text[:200]}"
            )

        try:
            data = resp.json()
        except Exception as exc:
            self.record_error()
            logger.error(f"DirectProvider[{self._vendor}].chat 响应解析失败: {exc}")
            raise

        choices = data.get("choices", []) or []
        if not choices:
            self.record_error()
            logger.error(
                f"DirectProvider[{self._vendor}].chat 空响应: model={used_model}"
            )
            raise RuntimeError(f"DirectProvider {self._vendor} 返回空 choices")

        choice = choices[0]
        message = choice.get("message", {}) or {}
        content = message.get("content", "")
        finish_reason = choice.get("finish_reason", "")

        usage_info = data.get("usage", {}) or {}
        input_tokens = int(usage_info.get("prompt_tokens", 0))
        output_tokens = int(usage_info.get("completion_tokens", 0))

        self.record_success()
        return LLMResponse(
            content=content,
            model=data.get("model", used_model),
            provider=self.provider_name,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            latency_ms=latency_ms,
            finish_reason=finish_reason,
            raw_response=data,
        )

    async def stream(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        **kwargs,
    ) -> AsyncIterator[str]:
        """调用厂商 /v1/chat/completions 端点（SSE 流式）."""
        used_model = model or self._default_model
        payload = {
            "model": used_model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
        }
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        }
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(self._timeout, connect=10.0)
            ) as client:
                async with client.stream(
                    "POST",
                    f"{self._base_url}/v1/chat/completions",
                    json=payload,
                    headers=headers,
                ) as resp:
                    if resp.status_code != 200:
                        self.record_error()
                        body = await resp.aread()
                        logger.error(
                            f"DirectProvider[{self._vendor}].stream "
                            f"HTTP {resp.status_code}: "
                            f"{body.decode(errors='replace')[:500]}"
                        )
                        raise RuntimeError(
                            f"DirectProvider {self._vendor} stream "
                            f"HTTP {resp.status_code}"
                        )
                    async for line in resp.aiter_lines():
                        if not line or not line.startswith("data: "):
                            continue
                        chunk = line[len("data: "):]
                        if chunk == "[DONE]":
                            break
                        try:
                            obj = json.loads(chunk)
                        except Exception:
                            continue
                        choices = obj.get("choices", []) or []
                        if not choices:
                            continue
                        delta = choices[0].get("delta", {}) or {}
                        piece = delta.get("content", "")
                        if piece:
                            yield piece
            self.record_success()
        except httpx.HTTPError as exc:
            self.record_error()
            logger.error(f"DirectProvider[{self._vendor}].stream 网络错误: {exc}")
            raise
        except RuntimeError:
            raise
        except Exception as exc:
            self.record_error()
            logger.error(f"DirectProvider[{self._vendor}].stream 失败: {exc}")
            raise

    async def health_check(self) -> bool:
        """直连供应商健康检查 — 简单返回 True（由调用方通过 chat 调用间接验证）."""
        self._healthy = True
        return True


# Provider 注册表
_PROVIDER_REGISTRY: Dict[str, type] = {
    "doubao": DoubaoProvider,
    "qwen": QwenProvider,
    "deepseek": DeepSeekProvider,
}


def register_provider(name: str, provider_cls: type):
    """注册自定义 Provider."""
    _PROVIDER_REGISTRY[name] = provider_cls


def get_provider(name: str, config: Optional[Dict[str, Any]] = None) -> LLMProvider:
    """获取 Provider 实例."""
    cls = _PROVIDER_REGISTRY.get(name)
    if not cls:
        raise ValueError(f"未知 Provider: {name}，可用: {list(_PROVIDER_REGISTRY.keys())}")
    return cls(config=config)
