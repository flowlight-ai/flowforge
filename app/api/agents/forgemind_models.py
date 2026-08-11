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
    """IM MindCouncil请求体.

    路由策略（参考 clowder-ai AgentRouter）：
        - 默认单智能体回答（fallback 链：上次回复者 > preferred > 默认）
        - @all / @全体 / @所有人 → 全部 Forgekin 并行回答
        - @特定智能体 → 仅指定智能体回答
        - 显式传 forgekin_ids 且非空 → 使用指定的 ID 列表
    """
    topic: str = Field(
        ...,
        min_length=1,
        description="用户原始消息（含可能的 @mention，如 '@all 大家怎么看'）",
    )
    forgekin_ids: list[str] = Field(
        default_factory=list,
        description=(
            "参与MindCouncil的Forgekin ID 列表。"
            "为空时走 fallback 链：@all → 全部；@特定 → 指定；"
            "无 @ → 上次回复者 > preferred > 默认（luban）"
        ),
    )
    max_rounds: int = Field(
        default=1,
        ge=1,
        le=3,
        description="MindCouncil最大轮数（每轮所有Forgekin各发言一次）",
    )
    thread_id: str | None = Field(
        default=None,
        description="会话 ID（用于查询上次回复者，实现 fallback 链）",
    )
    mode: str = Field(
        default="auto",
        description=(
            "路由模式：auto=自动判断（默认）；"
            "single=强制单智能体；parallel=强制全部并行"
        ),
    )


class CouncilResponse(BaseModel):
    """IM MindCouncil响应体。"""
    topic: str
    rounds: list[dict[str, Any]]
    summary: str
    participant_count: int
    routing_mode: str = Field(
        default="single",
        description="实际使用的路由模式：single/parallel（便于前端展示状态）",
    )
    selected_forgekin_ids: list[str] = Field(
        default_factory=list,
        description="实际参与回答的 Forgekin ID 列表（便于前端展示）",
    )


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
