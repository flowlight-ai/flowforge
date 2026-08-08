"""ACPTransport — Agent Communication Protocol 统一传输层（F241 CL-016）。

所有三方 Agent 通过统一协议通信（ACP 1.0 over stdio / SSE / WebSocket / HTTP）。
避免每接入一个新三方 Agent 都要写专门 bridge。

设计依据：
    - [doc:review/review.md#13.3] F241 Agent Provider Plugin（CL-016 ACP transport）
    - [doc:decisions/006-external-agent-integration.md] §3 ExternalAgentAdapter 抽象层
    - [doc:review/review.md#第九章§9.2] EX-009 调用语义不统一

铁律遵守：
    - 铁律 3：依赖通过构造函数注入（transport_backend 由 host 注入）
    - 编程红线 12：禁止绕过 DI 容器直接实例化
    - 所有 I/O 操作使用 async/await

License: MIT
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, AsyncIterator, Optional, Protocol

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("external_agent.acp_transport")


class ACPMessage(BaseModel):
    """ACP 1.0 消息封装。

    所有三方 Agent 调用统一封装为 ACPMessage，屏蔽底层协议差异：
        - stdio: 序列化为 JSON 行
        - SSE:  event-stream 帧
        - WebSocket: JSON 帧
        - HTTP:  POST body
    """

    message_id: str = Field(..., description="消息 ID（用于追踪）")
    provider: str = Field(..., description="目标 Provider 名称")
    method: str = Field(..., description="调用方法（如 invoke / stream / cancel）")
    params: dict[str, Any] = Field(default_factory=dict, description="调用参数")
    timestamp: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="消息时间戳",
    )


class ACPResponse(BaseModel):
    """ACP 1.0 响应封装。"""

    message_id: str = Field(..., description="对应请求的 message_id")
    provider: str = Field(..., description="来源 Provider")
    success: bool = Field(..., description="是否成功")
    result: Any = Field(default=None, description="调用结果")
    error: Optional[str] = Field(default=None, description="错误信息")
    cost: dict[str, Any] = Field(
        default_factory=dict, description="成本信息（token / call 数，EX-006）"
    )
    timestamp: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="响应时间戳",
    )


class TransportBackend(Protocol):
    """传输后端协议（DI 注入点）。

    实现方按 AgentTransport 枚举提供具体后端：
        - stdio: 子进程 stdin/stdout
        - sse: SSE event-stream
        - websocket: WebSocket 帧
        - http: HTTP POST
    """

    async def send_and_receive(
        self, provider: str, message: ACPMessage
    ) -> ACPResponse:
        """同步调用：发送消息并等待响应。"""
        ...

    async def stream(
        self, provider: str, message: ACPMessage
    ) -> AsyncIterator[str]:
        """流式调用：发送消息并迭代接收响应片段。"""
        ...


class ACPTransport:
    """Agent Communication Protocol 统一传输层（F241 CL-016）。

    所有三方 Agent 通过统一协议通信（ACP 1.0 over stdio / SSE / WebSocket / HTTP）。
    避免每接入一个新三方 Agent 都要写专门 bridge。

    详见 [doc:review/review.md#13.3] F241 Agent Provider Plugin

    调用语义统一（EX-009）：
        1. 同步调用：call() — 等待结果
        2. 流式调用：stream() — 边接收边处理
        3. 异步调用：通过 call() + 回调（host 实现）
        4. 委托调用：长任务通过 stream() 持续接收进度
    """

    def __init__(self, backend: TransportBackend) -> None:
        """注入传输后端。

        Args:
            backend: 传输后端实现（stdio / sse / websocket / http）。
                由 host 在 DI 容器中根据 Manifest.transport 选择并注入。
        """
        self._backend = backend

    async def call(
        self,
        provider: str,
        method: str,
        params: dict[str, Any],
    ) -> dict[str, Any]:
        """同步调用三方 Agent。

        Args:
            provider: 目标 Provider 名称（如 "anthropic.claude_code"）。
            method: 调用方法（如 "invoke" / "get_capability"）。
            params: 调用参数。

        Returns:
            响应结果字典（含 result / cost / error 等字段）。

        Raises:
            RuntimeError: 当三方 Agent 调用失败时。
        """
        message = ACPMessage(
            message_id=self._gen_message_id(provider, method),
            provider=provider,
            method=method,
            params=params,
        )
        logger.debug(
            "acp.call provider=%s method=%s msg_id=%s",
            provider,
            method,
            message.message_id,
        )
        response = await self._backend.send_and_receive(provider, message)
        if not response.success:
            raise RuntimeError(
                f"ACP call failed: provider={provider} method={method} "
                f"error={response.error}"
            )
        return {
            "result": response.result,
            "cost": response.cost,
            "message_id": response.message_id,
        }

    async def stream(
        self,
        provider: str,
        method: str,
        params: dict[str, Any],
    ) -> AsyncIterator[str]:
        """流式调用三方 Agent（EX-009 流式语义）。

        用于长任务场景（如 claude code 跑完整测试套件需 10 分钟），
        边接收边处理，避免阻塞。

        Args:
            provider: 目标 Provider 名称。
            method: 调用方法（如 "stream" / "long_task"）。
            params: 调用参数。

        Yields:
            响应片段字符串。
        """
        message = ACPMessage(
            message_id=self._gen_message_id(provider, method),
            provider=provider,
            method=method,
            params=params,
        )
        logger.debug(
            "acp.stream provider=%s method=%s msg_id=%s",
            provider,
            method,
            message.message_id,
        )
        async for chunk in self._backend.stream(provider, message):
            yield chunk

    @staticmethod
    def _gen_message_id(provider: str, method: str) -> str:
        """生成消息 ID（provider-method-timestamp，用于追踪）。"""
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        return f"{provider}-{method}-{ts}"
