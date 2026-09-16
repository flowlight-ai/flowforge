"""FlowForge LLM 路由与配额管理.

提供 LLM 路由、级联执行、配额管理和调用事件追踪。
包含 Trae LLM Provider（F045 桥接协议），让 FlowForge 可进化智能体能够
通过 Trae CN 桥接调用 LLM，实现自主开发能力。
"""

from flowforge.llm.router import LLMRouter, ModelHealth, ModelStatus
from flowforge.llm.cascade import LLMCascadeExecutor
from flowforge.llm.provider import LLMProvider, DoubaoProvider, QwenProvider, DeepSeekProvider
from flowforge.llm.route import LLMRoute, RouteResolver

# Trae 桥接协议（F045）— 导入 adapter 触发 register_provider("trae", ...)
from flowforge.llm.trae import (
    TraeLLMClient,
    TraeConfig,
    TraeBridgeConfig,
    TraeBridgeProtocol,
    TraeBridgeWatcher,
    TraeSession,
)
from flowforge.llm.trae.adapter import TraeModelCapabilityAdapter

__all__ = [
    "LLMRouter",
    "ModelHealth",
    "ModelStatus",
    "LLMCascadeExecutor",
    "LLMProvider",
    "DoubaoProvider",
    "QwenProvider",
    "DeepSeekProvider",
    "LLMRoute",
    "RouteResolver",
    # Trae 桥接（F045）
    "TraeLLMClient",
    "TraeConfig",
    "TraeBridgeConfig",
    "TraeBridgeProtocol",
    "TraeBridgeWatcher",
    "TraeModelCapabilityAdapter",
    "TraeSession",
]
