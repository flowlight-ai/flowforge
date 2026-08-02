"""Forgekin Council API — 群聊消息与发送（Web Fusion Phase 8 stub）.

对应设计文档 §10.2：
    - ``POST /api/v1/forgekins/council/chat``       — 发送群聊消息
    - ``GET  /api/v1/forgekins/council/messages``   — 群聊消息历史

stub 实现：消息不持久化，返回空历史与确认回执。
真实实现将复用 forgemind MindCouncil 流程。
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

router = APIRouter(prefix="/forgekins/council", tags=["forgekins-council"])


class CouncilChatRequest(BaseModel):
    """群聊发送请求体。"""

    content: str = Field(..., min_length=1, description="消息内容")
    forgekin_id: str | None = Field(default=None, description="指定发言Forgekin")
    thread_id: str | None = Field(default=None, description="关联线程 ID")


@router.post("/chat")
async def send_council_chat(payload: CouncilChatRequest) -> dict[str, Any]:
    """发送群聊消息（stub 返回确认回执）。"""
    return {
        "id": f"msg_stub_{int(datetime.now(timezone.utc).timestamp())}",
        "content": payload.content,
        "forgekin_id": payload.forgekin_id,
        "thread_id": payload.thread_id,
        "created_at": datetime.now(timezone.utc).isoformat() + "Z",
        "status": "queued",
    }


@router.get("/messages")
async def list_council_messages(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    """获取群聊消息历史（stub 返回空列表）。"""
    return {
        "items": [],
        "total": 0,
        "limit": limit,
        "offset": offset,
    }
