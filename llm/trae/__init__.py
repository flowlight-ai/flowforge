"""Trae LLM Provider — 将 Trae AI 助手包装为编码 LLM.

让 devforge 能够使用 Trae（AI 编码助手）作为编码 LLM，
实现 "devforge 自己开发自己" 的能力。

三种工作模式：
- cli: 通过命令行调用 trae CLI（未来）
- bridge: 通过文件桥接，devforge 写任务，Trae AI 读取并写回响应（当前主模式）
- api: 通过 HTTP API 调用（未来）

用法示例：
    from flowforge.llm.trae import TraeLLMClient, TraeConfig

    client = TraeLLMClient()
    result = await client.chat(
        messages=[{"role": "user", "content": "写一个 Python 函数"}],
        session_id="devforge:coder:task123",
    )
    print(result["content"])

    # 或使用适配器（兼容 ModelCapability 接口）
    from flowforge.llm.trae.adapter import TraeModelCapabilityAdapter
    adapter = TraeModelCapabilityAdapter()
    result = await adapter.chat("写一个 Python 函数")
"""

from flowforge.llm.trae.client import (
    TraeLLMClient,
    TraeLLMApiError,
    TraeLLMCliError,
    TraeLLMError,
    TraeLLMTimeoutError,
)
from flowforge.llm.trae.config import TraeConfig
from flowforge.llm.trae.session import TraeSession, TraeSessionManager

__all__ = [
    "TraeLLMClient",
    "TraeConfig",
    "TraeSession",
    "TraeSessionManager",
    "TraeLLMError",
    "TraeLLMTimeoutError",
    "TraeLLMCliError",
    "TraeLLMApiError",
]
