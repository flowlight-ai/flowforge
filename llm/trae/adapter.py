"""Trae LLM Provider 适配器 — F045 §3.2 Phase 2 LLMClient 接入.

TraeModelCapabilityAdapter 将 TraeLLMClient 适配为 LLMProvider 兼容接口，
让 FlowForge 上层（ModelCapability → LLMClient → Provider）能通过 provider="trae"
路由到 Trae 桥接。

遵守铁律：
- 红线 12：通过 _PROVIDER_REGISTRY 注册到 Provider 注册表
- 铁律 3：依赖通过构造函数注入（TraeLLMClient）
- 红线 9：组合优于继承（TraeLLMClient 是组合对象，LLMProvider 是接口契约）

模块加载时自动注册到 _PROVIDER_REGISTRY，无需手动调用 register_provider。
配置 trae_bridge.yaml 后，models.yaml 中可使用 provider: trae 路由。

用法示例：
    # 方式 1：通过 LLMProvider 注册表（推荐，符合 DI 原则）
    from flowforge.llm.provider import get_provider
    provider = get_provider("trae", config={...})
    response = await provider.chat(messages=[...])

    # 方式 2：直接实例化（用于测试）
    from flowforge.llm.trae.adapter import TraeModelCapabilityAdapter
    adapter = TraeModelCapabilityAdapter()
    response = await adapter.chat(messages=[...])

    # 方式 3：在 models.yaml 中配置 provider: trae
    # FlowForge 会自动通过 _PROVIDER_REGISTRY 路由到 TraeModelCapabilityAdapter
"""

from __future__ import annotations

import time
from typing import Any, AsyncIterator, Dict, List, Optional

from flowforge.core.tracing import get_logger
from flowforge.llm.provider import LLMProvider, LLMResponse, register_provider

from flowforge.llm.trae.client import TraeLLMClient
from flowforge.llm.trae.config import TraeBridgeConfig, TraeConfig
from flowforge.llm.trae.exceptions import TraeBridgeError
from flowforge.llm.trae.models import BridgeRequestContext
from flowforge.llm.trae.protocol import TraeBridgeProtocol

logger = get_logger("trae_llm.adapter")


class TraeModelCapabilityAdapter(LLMProvider):
    """将 TraeLLMClient 适配为 LLMProvider 兼容的 Provider.

    实现 LLMProvider 抽象基类的 chat/stream/health_check 方法，
    将 TraeLLMClient 的字典响应适配为 LLMResponse 对象。

    通过 _PROVIDER_REGISTRY 注册后，FlowForge 上层可通过：
    - models.yaml 配置 provider: trae
    - LLMRouter 自动路由到本适配器
    - ModelCapability.chat() → LLMClient → TraeModelCapabilityAdapter.chat()
    """

    provider_name = "trae"

    def __init__(
        self,
        config: Optional[Dict[str, Any]] = None,
        *,
        trae_config: Optional[TraeConfig] = None,
        bridge_config: Optional[TraeBridgeConfig] = None,
        protocol: Optional[TraeBridgeProtocol] = None,
        client: Optional[TraeLLMClient] = None,
    ) -> None:
        """初始化 TraeModelCapabilityAdapter.

        Args:
            config: LLMProvider 标准配置字典（兼容 get_provider 调用）
            trae_config: TraeConfig（可选，覆盖 config 中的 trae 字段）
            bridge_config: TraeBridgeConfig（可选，桥接配置）
            protocol: TraeBridgeProtocol（可选，文件协议层）
            client: TraeLLMClient（可选，已构造的客户端实例）

        优先级：client > protocol > bridge_config > config
        """
        super().__init__(config)
        cfg = config or {}

        # 解析配置（兼容 models.yaml 的 provider config 结构）
        self._trae_config = trae_config or TraeConfig(
            mode=cfg.get("mode", "bridge"),
            default_model=cfg.get("default_model", "trae"),
        )

        # 加载桥接配置（优先用显式传入，否则从 trae_bridge.yaml 加载）
        if bridge_config is not None:
            self._bridge_config = bridge_config
        else:
            yaml_path = cfg.get(
                "bridge_yaml",
                "d:/software/openclaw/flowforge/config/trae_bridge.yaml",
            )
            try:
                self._bridge_config = TraeBridgeConfig.load_from_yaml(yaml_path)
            except Exception as e:
                logger.warning(f"加载 trae_bridge.yaml 失败，使用默认配置: {e}")
                self._bridge_config = TraeBridgeConfig()

        # 构造客户端（优先用传入的 client，否则用 protocol/bridge_config 构造）
        if client is not None:
            self._client = client
        else:
            self._client = TraeLLMClient(
                config=self._trae_config,
                bridge_config=self._bridge_config,
                protocol=protocol,
            )

        self._default_model = cfg.get("default_model", self._trae_config.default_model)
        self._logger = get_logger("trae_llm.adapter")

    # ── 依赖注入 ────────────────────────────────────────────────────

    @property
    def client(self) -> TraeLLMClient:
        """获取底层 TraeLLMClient 实例."""
        return self._client

    @property
    def bridge_config(self) -> TraeBridgeConfig:
        """获取桥接配置."""
        return self._bridge_config

    def set_memory_manager(self, memory_manager: Any) -> None:
        """注入 MemoryManager（依赖注入，铁律 3）."""
        self._client.set_memory_manager(memory_manager)

    # ── LLMProvider 抽象方法实现 ────────────────────────────────────

    async def chat(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        **kwargs,
    ) -> LLMResponse:
        """LLMProvider.chat 实现 — 同步聊天调用.

        将 TraeLLMClient 的字典响应适配为 LLMResponse 对象。
        """
        # 构造请求上下文（F045 §2.3 不变量 7 operator 可见性）
        context: Optional[BridgeRequestContext] = kwargs.pop("context", None)
        if context is None:
            context = BridgeRequestContext(
                forgekin_id=kwargs.pop("forgekin_id", "unknown"),
                task_type=kwargs.pop("task_type", "chat"),
                task_summary=kwargs.pop("task_summary", ""),
                model=model or self._default_model,
                temperature=temperature,
                max_tokens=max_tokens,
                tools=kwargs.pop("tools", None),
            )
        else:
            # 显式传入 context 时，覆盖 model/temperature/max_tokens
            if model is not None:
                context.model = model
            context.temperature = temperature
            context.max_tokens = max_tokens

        start_time = time.monotonic()
        try:
            result = await self._client.chat(
                messages=messages,
                context=context,
                session_id=kwargs.pop("session_id", ""),
                task_id=kwargs.pop("task_id", ""),
                timeout=kwargs.pop("timeout", None),
                **kwargs,
            )

            latency_ms = (time.monotonic() - start_time) * 1000
            usage = result.get("usage", {}) or {}

            self.record_success()
            return LLMResponse(
                content=result.get("content", ""),
                model=result.get("model", model or self._default_model),
                provider=self.provider_name,
                input_tokens=usage.get("input_tokens", 0),
                output_tokens=usage.get("output_tokens", 0),
                latency_ms=latency_ms,
                cost=usage.get("cost", 0.0),
                finish_reason=usage.get("finish_reason", ""),
                raw_response=result,
            )
        except TraeBridgeError as e:
            self.record_error()
            self._logger.error(f"TraeModelCapabilityAdapter.chat 失败: {e}")
            raise
        except Exception as e:
            self.record_error()
            self._logger.error(f"TraeModelCapabilityAdapter.chat 异常: {e}")
            raise

    async def stream(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        **kwargs,
    ) -> AsyncIterator[str]:
        """LLMProvider.stream 实现 — 流式聊天调用.

        注意：Bridge 模式下，先完整获取响应再分段 yield（模拟流式）。
        """
        context: Optional[BridgeRequestContext] = kwargs.pop("context", None)
        if context is None:
            context = BridgeRequestContext(
                forgekin_id=kwargs.pop("forgekin_id", "unknown"),
                task_type="chat_stream",
                model=model or self._default_model,
                temperature=temperature,
                max_tokens=max_tokens,
            )

        try:
            async for chunk in self._client.stream_chat(
                messages=messages,
                context=context,
                session_id=kwargs.pop("session_id", ""),
                task_id=kwargs.pop("task_id", ""),
                **kwargs,
            ):
                yield chunk
            self.record_success()
        except TraeBridgeError as e:
            self.record_error()
            self._logger.error(f"TraeModelCapabilityAdapter.stream 失败: {e}")
            raise
        except Exception as e:
            self.record_error()
            self._logger.error(f"TraeModelCapabilityAdapter.stream 异常: {e}")
            raise

    async def health_check(self) -> bool:
        """LLMProvider.health_check 实现 — 检查桥接可用性."""
        try:
            healthy = await self._client.health_check()
            self._healthy = healthy
            return healthy
        except Exception as e:
            self._logger.warning(f"TraeModelCapabilityAdapter.health_check 失败: {e}")
            self._healthy = False
            return False

    # ── ModelCapability 兼容接口（向后兼容）─────────────────────────

    async def chat_with_messages(
        self,
        messages: List[Dict[str, str]],
        *,
        model: str = "",
        temperature: float = 0.7,
        max_tokens: int = 4000,
        session_id: str = "",
        task_id: str = "trae",
        **kwargs,
    ) -> Dict[str, Any]:
        """基于消息的聊天接口，兼容旧 LLMClient.chat() 签名.

        返回字典格式（非 LLMResponse 对象），向后兼容。
        """
        response = await self.chat(
            messages=messages,
            model=model or None,
            temperature=temperature,
            max_tokens=max_tokens,
            session_id=session_id,
            task_id=task_id,
            **kwargs,
        )
        return {
            "content": response.content,
            "provider": response.provider,
            "model": response.model,
            "usage": {
                "input_tokens": response.input_tokens,
                "output_tokens": response.output_tokens,
                "latency_ms": response.latency_ms,
            },
            "tool_calls": (response.raw_response or {}).get("tool_calls", []),
        }

    async def chat_stream(
        self,
        prompt: str,
        *,
        system: str = "",
        session_id: str = "",
        task_id: str = "trae",
        **kwargs,
    ) -> AsyncIterator[str]:
        """流式聊天，兼容 ModelCapability.chat_stream().

        Args:
            prompt: 用户消息内容
            system: 可选系统提示词
            session_id: 会话 ID
            task_id: 任务 ID
        """
        messages: List[Dict[str, str]] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        async for chunk in self.stream(
            messages=messages,
            session_id=session_id,
            task_id=task_id,
            **kwargs,
        ):
            yield chunk


# ── 注册到 Provider 注册表（F045 §3.2 Phase 2）─────────────────────
# 模块加载时自动注册，让 LLMRouter 通过 provider="trae" 路由
register_provider("trae", TraeModelCapabilityAdapter)


# ── 模块级单例（向后兼容）─────────────────────────────────────────

_adapter_instance: Optional[TraeModelCapabilityAdapter] = None


def get_trae_adapter(
    config: Optional[Dict[str, Any]] = None,
    *,
    bridge_config: Optional[TraeBridgeConfig] = None,
    protocol: Optional[TraeBridgeProtocol] = None,
) -> TraeModelCapabilityAdapter:
    """获取 TraeModelCapabilityAdapter 单例.

    Args:
        config: LLMProvider 标准配置字典
        bridge_config: TraeBridgeConfig（可选）
        protocol: TraeBridgeProtocol（可选）

    Returns:
        TraeModelCapabilityAdapter 单例实例
    """
    global _adapter_instance
    if _adapter_instance is None:
        _adapter_instance = TraeModelCapabilityAdapter(
            config=config,
            bridge_config=bridge_config,
            protocol=protocol,
        )
    return _adapter_instance


def reset_trae_adapter() -> None:
    """重置单例（用于测试）."""
    global _adapter_instance
    _adapter_instance = None


__all__ = [
    "TraeModelCapabilityAdapter",
    "get_trae_adapter",
    "reset_trae_adapter",
]
