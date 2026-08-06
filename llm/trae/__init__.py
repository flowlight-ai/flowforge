"""Trae LLM Provider — F045 Trae 桥接协议实现.

让 FlowForge 可进化智能体（Forgekin）能够通过 Trae CN 桥接调用 LLM，
实现"可进化智能体主导全部自主开发流程"的愿景（VISION §7）。

三层架构（F045 §2.2）：
1. TraeLLMClient（client.py）— LLM 客户端薄层，调用 protocol
2. TraeBridgeProtocol（protocol.py）— 文件协议层，负责所有文件 I/O
3. TraeBridgeConfig（config.py）— 桥接配置（对应 trae_bridge.yaml）

支持三种工作模式：
- bridge: 通过文件桥接（当前主模式，F045 完整实现）
- cli: 通过命令行调用 trae CLI（未来，trae CLI 可用时）
- api: 通过 HTTP API 调用（未来，trae API 可用时）

用法示例：
    from flowforge.llm.trae import TraeLLMClient, TraeBridgeConfig
    from flowforge.llm.trae.protocol import TraeBridgeProtocol
    from flowforge.llm.trae.models import BridgeRequestContext

    config = TraeBridgeConfig.load_from_yaml("config/trae_bridge.yaml")
    protocol = TraeBridgeProtocol(config)
    client = TraeLLMClient(protocol=protocol)

    context = BridgeRequestContext(
        forgekin_id="forgemind:luban",
        task_type="chat",
        task_summary="设计 F046 SelfDev 三闭环",
    )
    result = await client.chat(
        messages=[{"role": "user", "content": "请设计 SelfDev 三闭环"}],
        context=context,
    )
    print(result["content"])
"""

# adapter 必须在最后导入（依赖 provider 模块，导入时触发 register_provider）
from flowforge.llm.trae.adapter import TraeModelCapabilityAdapter, get_trae_adapter, reset_trae_adapter
from flowforge.llm.trae.client import (
    TraeLLMApiError,
    TraeLLMClient,
    TraeLLMCliError,
    TraeLLMError,
    TraeLLMTimeoutError,
)
from flowforge.llm.trae.config import TraeBridgeConfig, TraeConfig
from flowforge.llm.trae.exceptions import (
    TraeBridgeCancelledError,
    TraeBridgeConfigError,
    TraeBridgeError,
    TraeBridgeIOError,
    TraeBridgeProtocolError,
    TraeBridgeTimeoutError,
)
from flowforge.llm.trae.models import (
    BridgeAck,
    BridgeCancel,
    BridgeMessage,
    BridgeRequest,
    BridgeRequestContext,
    BridgeRequestStatus,
    BridgeResponse,
    BridgeResponseStatus,
    BridgeStatus,
)
from flowforge.llm.trae.protocol import TraeBridgeProtocol
from flowforge.llm.trae.session import TraeSession, TraeSessionManager
from flowforge.llm.trae.watcher import TraeBridgeWatcher

__all__ = [
    # 客户端
    "TraeLLMClient",
    # 配置
    "TraeConfig",
    "TraeBridgeConfig",
    # 协议层
    "TraeBridgeProtocol",
    # 文件监听器（Phase 3 事件驱动）
    "TraeBridgeWatcher",
    # 数据模型
    "BridgeMessage",
    "BridgeRequest",
    "BridgeRequestContext",
    "BridgeRequestStatus",
    "BridgeResponse",
    "BridgeResponseStatus",
    "BridgeCancel",
    "BridgeAck",
    "BridgeStatus",
    # 异常（新）
    "TraeBridgeError",
    "TraeBridgeTimeoutError",
    "TraeBridgeCancelledError",
    "TraeBridgeProtocolError",
    "TraeBridgeIOError",
    "TraeBridgeConfigError",
    # 异常（向后兼容别名）
    "TraeLLMError",
    "TraeLLMTimeoutError",
    "TraeLLMCliError",
    "TraeLLMApiError",
    # 会话管理
    "TraeSession",
    "TraeSessionManager",
    # 适配器（LLMProvider 实现）
    "TraeModelCapabilityAdapter",
    "get_trae_adapter",
    "reset_trae_adapter",
]
