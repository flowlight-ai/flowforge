"""Notify API — 通知订阅（Web Fusion Phase 8 stub）.

对应设计文档 §10.2：
    - ``GET  /api/v1/notify/subscriptions``  — 订阅列表
    - ``POST /api/v1/notify/subscriptions``  — 创建订阅
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/notify", tags=["notify"])


class NotifySubscriptionCreate(BaseModel):
    """通知订阅创建请求体。"""

    channel: str = Field(..., description="通知渠道（如 email/webhook/feishu）")
    target: str = Field(..., description="订阅目标地址")
    events: list[str] = Field(default_factory=list, description="订阅事件列表")
    config: dict[str, Any] = Field(default_factory=dict)


def _now() -> str:
    return datetime.now(UTC).isoformat() + "Z"


@router.get("/subscriptions")
async def list_subscriptions() -> dict[str, Any]:
    """列出通知订阅（stub 返回空列表）。"""
    return {"items": [], "total": 0}


@router.post("/subscriptions")
async def create_subscription(payload: NotifySubscriptionCreate) -> dict[str, Any]:
    """创建通知订阅（stub 返回占位对象）。"""
    return {
        "id": f"sub_stub_{int(datetime.now(UTC).timestamp())}",
        "channel": payload.channel,
        "target": payload.target,
        "events": payload.events,
        "config": payload.config,
        "status": "active",
        "created_at": _now(),
    }
