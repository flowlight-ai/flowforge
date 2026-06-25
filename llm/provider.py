"""LLM Provider 抽象层 — Protocol/Route/Provider 三层分离的 Provider 层.

每个 LLM 供应商实现 LLMProvider 接口，提供统一的 chat/stream/health_check 方法。
LLMRouter 通过 Provider 层与具体 LLM 服务解耦。
"""

import asyncio
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Dict, List, Optional

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
