"""ForgeMind 请求/响应模型 — 从 forgemind.py 提取的 Pydantic 模型.

本模块包含 ForgeMind API 的所有请求/响应体定义。
从 flowforge/app/api/agents/forgemind.py 提取，保持逻辑不变。

详见:
    - forgemind.py — ForgeMind API endpoints
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class WebChatRequest(BaseModel):
    """webchat 请求体。"""
    message: str = Field(
        ...,
        min_length=1,
        description="用户消息内容",
    )
    session_id: str | None = Field(
        default=None,
        description="会话 ID（用于上下文保持，默认使用 forgekin_id）",
    )
    temperature: float | None = Field(
        default=None,
        description="采样温度（覆盖 YAML 配置）",
    )
    max_tokens: int | None = Field(
        default=None,
        description="最大生成 token 数（覆盖 YAML 配置）",
    )


class WebChatResponse(BaseModel):
    """webchat 响应体。"""
    forgekin_id: str
    name: str
    content: str
    model: str = "trae"
    session_id: str
    usage: dict[str, Any] = Field(default_factory=dict)


class CouncilRequest(BaseModel):
    """IM MindCouncil请求体。"""
    topic: str = Field(
        ...,
        min_length=1,
        description="MindCouncil主题（如 '是否采用 ADR-014 提议的 Plugin V4 协议'）",
    )
    forgekin_ids: list[str] = Field(
        default_factory=list,
        description="参与MindCouncil的Forgekin ID 列表（默认 3 只预置Forgekin全部参与）",
    )
    max_rounds: int = Field(
        default=1,
        ge=1,
        le=3,
        description="MindCouncil最大轮数（每轮所有Forgekin各发言一次）",
    )


class CouncilResponse(BaseModel):
    """IM MindCouncil响应体。"""
    topic: str
    rounds: list[dict[str, Any]]
    summary: str
    participant_count: int


class ForgeResponse(BaseModel):
    """锻造响应体。"""
    forgekin_id: str
    name: str
    species: str
    evolution_stage: str
    awakening_stage: str
    imprint_hash: str
    status: str = "forged"


class EvolveRequest(BaseModel):
    """自进化触发请求体。"""
    mode: str = Field(
        default="auto",
        description="进化模式：auto/scope_guard/process_evolution/knowledge_evolution",
    )
    context: dict[str, Any] = Field(
        default_factory=dict,
        description="进化上下文（如最近任务结果、错误日志等）",
    )


class EvolveResponse(BaseModel):
    """自进化响应体。"""
    forgekin_id: str
    mode: str
    triggered: bool
    result: dict[str, Any]
