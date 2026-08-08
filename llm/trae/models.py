"""Trae 桥接协议数据模型 — F045 §2.2 + §2.3 不变量.

定义桥接协议所有数据结构：
- BridgeRequest:  Forgekin → Trae 的请求文件 (request_{uuid}.json)
- BridgeResponse: Trae → Forgekin 的响应文件 (response_{uuid}.json)
- BridgeCancel:   operator 取消请求 (cancel_{uuid}.json) — 不变量 8 逃生舱
- BridgeAck:      operator 确认收到请求 (ack_{uuid}.json)
- BridgeStatus:   桥接状态总览 (status.json)

对应 F045 §2.3 不变量：
- 不变量 1（文件命名唯一性）：request_id 使用 UUID4
- 不变量 2（请求-响应配对）：request_id 字段关联
- 不变量 7（operator 可见性）：forgekin_id + task_context 必填
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field


# ── 枚举 ────────────────────────────────────────────────────────────


class BridgeRequestStatus(str, Enum):
    """请求文件状态（Forgekin 写入后到收到响应前的状态机）."""

    PENDING = "pending"          # 刚写入，等待 operator 处理
    ACKED = "acked"              # operator 已确认收到（ack 文件存在）
    PROCESSING = "processing"    # operator 正在调用 LLM
    COMPLETED = "completed"      # 已收到响应（response 文件存在）
    TIMEOUT = "timeout"          # 超时未收到响应
    CANCELLED = "cancelled"      # operator 主动取消


class BridgeResponseStatus(str, Enum):
    """响应文件状态（operator 写入 response 文件时标记）."""

    COMPLETED = "completed"      # 正常完成
    ERROR = "error"              # LLM 调用失败
    PARTIAL = "partial"          # 流式响应的部分片段（预留）
    TIMEOUT = "timeout"          # LLM 调用超时


# ── 核心模型 ────────────────────────────────────────────────────────


class BridgeMessage(BaseModel):
    """OpenAI 兼容的消息结构.

    Attributes:
        role: system | user | assistant
        content: 消息内容
    """

    model_config = ConfigDict(extra="ignore")

    role: str = Field(pattern="^(system|user|assistant)$")
    content: str


class BridgeRequestContext(BaseModel):
    """请求上下文 — F045 §2.3 不变量 7（operator 可见性）.

    operator 在 Trae 内打开 request 文件时，通过此字段看清：
    - 是哪个 Forgekin 发起的（forgekin_id）
    - 是什么任务（task_type + task_summary）
    - 期望的模型与参数
    """

    model_config = ConfigDict(extra="allow")  # 允许扩展字段

    forgekin_id: str = Field(
        min_length=1,
        description="发起请求的可进化智能体 ID（如 forgemind:luban）",
    )
    task_type: str = Field(
        default="chat",
        description="任务类型：chat | complete_code | review_code | generate_tests | write_doc",
    )
    task_summary: str = Field(
        default="",
        description="任务摘要（一句话，operator 快速浏览用）",
    )
    model: str = Field(default="trae", description="期望模型名")
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    max_tokens: int = Field(default=4096, ge=1)
    tools: Optional[List[Dict[str, Any]]] = Field(
        default=None, description="可选工具定义（OpenAI function-calling 格式）"
    )


class BridgeRequest(BaseModel):
    """请求文件 request_{uuid}.json 的 Pydantic 模型.

    对应 F045 §2.1 协议流程步骤 2：TraeLLMClient 写入 request 文件。

    Attributes:
        request_id: UUID4 字符串，与文件名中的 {uuid} 一致（不变量 1）
        session_id: 会话 ID（可选，用于保持上下文）
        messages: 消息列表（OpenAI 兼容格式）
        context: 请求上下文（不变量 7 operator 可见性）
        timeout_seconds: 本次请求的超时秒数（不变量 3）
        created_at: 创建时间（ISO 8601）
        status: 请求状态
    """

    model_config = ConfigDict(extra="ignore")

    request_id: str = Field(min_length=1, description="UUID4 请求 ID")
    session_id: str = Field(default="", description="会话 ID（可选）")
    messages: List[BridgeMessage] = Field(min_length=1)
    context: BridgeRequestContext
    timeout_seconds: int = Field(default=300, ge=1, description="超时秒数")
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="创建时间（UTC）",
    )
    status: BridgeRequestStatus = Field(default=BridgeRequestStatus.PENDING)


class BridgeResponse(BaseModel):
    """响应文件 response_{uuid}.json 的 Pydantic 模型.

    对应 F045 §2.1 协议流程步骤 5：operator 在 Trae 内调用 LLM 后回写。

    Attributes:
        request_id: 关联的请求 ID（不变量 2 请求-响应配对）
        content: LLM 响应内容
        status: 响应状态
        model: 实际使用的模型名
        usage: token 用量等元信息
        tool_calls: 工具调用（可选）
        error: 错误信息（status=error 时必填）
        completed_at: 完成时间
    """

    model_config = ConfigDict(extra="allow")

    request_id: str = Field(min_length=1, description="关联的请求 ID")
    content: str = Field(default="", description="LLM 响应内容")
    status: BridgeResponseStatus = Field(default=BridgeResponseStatus.COMPLETED)
    model: str = Field(default="trae", description="实际使用的模型名")
    usage: Dict[str, Any] = Field(
        default_factory=dict, description="token 用量等元信息"
    )
    tool_calls: Optional[List[Dict[str, Any]]] = Field(
        default=None, description="工具调用列表"
    )
    error: str = Field(default="", description="错误信息（status=error 时必填）")
    completed_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="完成时间（UTC）",
    )


class BridgeCancel(BaseModel):
    """取消文件 cancel_{uuid}.json 的 Pydantic 模型.

    对应 F045 §2.3 不变量 8（逃生舱）：operator 可写入此文件取消任意进行中的请求。

    Attributes:
        request_id: 要取消的请求 ID
        reason: 取消原因
        cancelled_by: 取消者（默认 operator）
        cancelled_at: 取消时间
    """

    model_config = ConfigDict(extra="ignore")

    request_id: str = Field(min_length=1)
    reason: str = Field(default="", description="取消原因")
    cancelled_by: str = Field(default="operator")
    cancelled_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )


class BridgeAck(BaseModel):
    """确认文件 ack_{uuid}.json 的 Pydantic 模型.

    对应 F045 §2.1 协议流程：operator 确认收到 request 文件。
    可选实现，用于 Forgekin 检测 operator 是否在线。

    Attributes:
        request_id: 关联的请求 ID
        acked_by: 确认者（默认 operator）
        acked_at: 确认时间
    """

    model_config = ConfigDict(extra="ignore")

    request_id: str = Field(min_length=1)
    acked_by: str = Field(default="operator")
    acked_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )


class BridgeStatus(BaseModel):
    """桥接状态总览 status.json 的 Pydantic 模型.

    对应 F045 §2.1 共享目录中的 status.json。
    记录当前桥接的全局状态，operator 一眼可见。

    Attributes:
        pending_count: 等待处理的请求数
        processing_count: 处理中的请求数
        completed_total: 累计完成数
        timeout_total: 累计超时数
        cancelled_total: 累计取消数
        last_activity_at: 最后活动时间
    """

    model_config = ConfigDict(extra="ignore")

    pending_count: int = Field(default=0, ge=0)
    processing_count: int = Field(default=0, ge=0)
    completed_total: int = Field(default=0, ge=0)
    timeout_total: int = Field(default=0, ge=0)
    cancelled_total: int = Field(default=0, ge=0)
    last_activity_at: Optional[datetime] = Field(default=None)


__all__ = [
    "BridgeRequestStatus",
    "BridgeResponseStatus",
    "BridgeMessage",
    "BridgeRequestContext",
    "BridgeRequest",
    "BridgeResponse",
    "BridgeCancel",
    "BridgeAck",
    "BridgeStatus",
]
