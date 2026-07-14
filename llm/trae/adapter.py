"""Trae LLM 适配器 — 将 TraeLLMClient 适配为 flowforge 兼容接口.

将 TraeLLMClient 适配为 flowforge ModelCapability 兼容的接口，
使 devforge agents 能够通过配置 model="trae" 使用 Trae 作为编码 LLM。

用法示例：
    from flowforge.llm.trae.adapter import TraeModelCapabilityAdapter

    adapter = TraeModelCapabilityAdapter()
    result = await adapter.chat("写一个 Python 函数")
    print(result)

    # 在 devforge agent YAML 配置中：
    # model: trae
    # agent 会自动使用 TraeModelCapabilityAdapter
"""

from __future__ import annotations

from typing import Any, AsyncIterator, Dict, List, Optional

from flowforge.core.tracing import get_logger

from flowforge.llm.trae.client import TraeLLMClient
from flowforge.llm.trae.config import TraeConfig

logger = get_logger("trae_llm.adapter")


class TraeModelCapabilityAdapter:
    """将 TraeLLMClient 适配为 ModelCapability 兼容的 Provider.

    允许 devforge agents 通过在 YAML 配置中设置 model="trae"
    来使用 Trae 作为其 LLM。

    实现了与 flowforge.core.model_capability.ModelCapability.chat()
    兼容的简单接口，以及与 LLMClient 兼容的消息接口。
    """

    def __init__(self, config: Optional[TraeConfig] = None):
        self._config = config or TraeConfig()
        self._client = TraeLLMClient(self._config)
        self._logger = get_logger("trae_llm.adapter")

    @property
    def client(self) -> TraeLLMClient:
        """获取底层 TraeLLMClient 实例."""
        return self._client

    @property
    def config(self) -> TraeConfig:
        """获取配置."""
        return self._config

    def set_memory_manager(self, memory_manager: Any) -> None:
        """注入 MemoryManager（依赖注入，铁律3）."""
        self._client.set_memory_manager(memory_manager)

    # ── ModelCapability 兼容接口 ────────────────────────────────────

    async def chat(
        self,
        prompt: str,
        *,
        system: str = "",
        persona: str = "",
        agent_name: str = "",
        model: str = "",
        temperature: float = 0.7,
        max_tokens: int = 4000,
        task_id: str = "trae",
        tools: Optional[list] = None,
        **kwargs,
    ) -> Dict[str, Any]:
        """简单聊天接口，兼容 ModelCapability.chat().

        Args:
            prompt: 用户消息内容
            system: 可选系统提示词
            persona: Persona 标识（用于构建 session_id）
            agent_name: Agent 名（用于构建 session_id）
            model: 模型名（忽略，始终使用 trae）
            temperature: 采样温度
            max_tokens: 最大生成 token 数
            task_id: 任务 ID
            tools: 可选工具定义

        Returns:
            与 ModelCapability.chat() 兼容的响应字典
        """
        messages: List[Dict[str, str]] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        # 构建 session_id 以保持会话上下文
        session_id = ""
        if agent_name or persona:
            parts = [p for p in (agent_name, persona, task_id) if p]
            session_id = ":".join(parts)

        result = await self._client.chat(
            messages,
            model=model or self._config.default_model,
            temperature=temperature,
            max_tokens=max_tokens,
            session_id=session_id,
            task_id=task_id,
            tools=tools,
            **kwargs,
        )

        # 确保返回格式与 ModelCapability.chat() 一致
        return {
            "content": result.get("content", ""),
            "provider": "trae",
            "model": result.get("model", self._config.default_model),
            "tokens": result.get("usage", {}).get("total_tokens", 0),
            "usage": result.get("usage", {}),
            "tool_calls": result.get("tool_calls", []),
        }

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
        """基于消息的聊天接口，兼容 LLMClient.

        Args:
            messages: 消息列表
            model: 模型名（忽略，始终使用 trae）
            temperature: 采样温度
            max_tokens: 最大生成 token 数
            session_id: 会话 ID
            task_id: 任务 ID

        Returns:
            与 LLMClient.chat() 兼容的响应字典
        """
        result = await self._client.chat(
            messages,
            model=model or self._config.default_model,
            temperature=temperature,
            max_tokens=max_tokens,
            session_id=session_id,
            task_id=task_id,
            **kwargs,
        )
        return {
            "content": result.get("content", ""),
            "provider": "trae",
            "model": result.get("model", self._config.default_model),
            "usage": result.get("usage", {}),
            "tool_calls": result.get("tool_calls", []),
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

        Yields:
            文本块
        """
        messages: List[Dict[str, str]] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        async for chunk in self._client.stream_chat(
            messages, session_id=session_id, task_id=task_id, **kwargs
        ):
            yield chunk

    # ── LLMProvider 兼容接口 ───────────────────────────────────────

    async def stream(
        self,
        messages: List[Dict[str, str]],
        *,
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        **kwargs,
    ) -> AsyncIterator[str]:
        """流式接口，兼容 LLMProvider.stream().

        Args:
            messages: 消息列表
            model: 模型名
            temperature: 采样温度
            max_tokens: 最大生成 token 数

        Yields:
            文本块
        """
        async for chunk in self._client.stream_chat(
            messages,
            model=model or self._config.default_model,
            temperature=temperature,
            max_tokens=max_tokens,
            **kwargs,
        ):
            yield chunk

    async def health_check(self) -> bool:
        """健康检查，兼容 LLMProvider.health_check()."""
        return await self._client.health_check()


# ── 模块级单例 ──────────────────────────────────────────────────────

_adapter_instance: Optional[TraeModelCapabilityAdapter] = None


def get_trae_adapter(config: Optional[TraeConfig] = None) -> TraeModelCapabilityAdapter:
    """获取 TraeModelCapabilityAdapter 单例.

    Args:
        config: 可选配置（仅在首次调用时生效）

    Returns:
        TraeModelCapabilityAdapter 单例实例
    """
    global _adapter_instance
    if _adapter_instance is None:
        _adapter_instance = TraeModelCapabilityAdapter(config)
    return _adapter_instance


def reset_trae_adapter() -> None:
    """重置单例（用于测试）."""
    global _adapter_instance
    _adapter_instance = None
