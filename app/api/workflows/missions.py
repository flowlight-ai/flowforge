"""Missions API — 任务管理（Web Fusion Phase 8 stub）.

对应设计文档 §10.2：
    - ``GET  /api/v1/missions``       — 任务列表
    - ``POST /api/v1/missions``       — 创建任务
    - ``GET  /api/v1/missions/{id}``  — 任务详情
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

router = APIRouter(prefix="/missions", tags=["missions"])


class MissionCreate(BaseModel):
    """任务创建请求体。"""

    title: str = Field(..., min_length=1)
    description: str | None = Field(default=None)
    forgekin_id: str | None = Field(default=None, description="归属Forgekin")
    priority: str = Field(default="normal", description="优先级")
    metadata: dict[str, Any] = Field(default_factory=dict)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


@router.get("")
async def list_missions(
    status: str | None = Query(default=None, description="按状态过滤"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    """列出任务（stub 返回空列表）。"""
    return {
        "items": [],
        "total": 0,
        "limit": limit,
        "offset": offset,
        "filter": {"status": status} if status else None,
    }


@router.post("")
async def create_mission(payload: MissionCreate) -> dict[str, Any]:
    """创建任务（stub 返回占位对象）。"""
    return {
        "id": f"mission_stub_{int(datetime.now(timezone.utc).timestamp())}",
        "title": payload.title,
        "description": payload.description,
        "forgekin_id": payload.forgekin_id,
        "priority": payload.priority,
        "metadata": payload.metadata,
        "status": "pending",
        "created_at": _now(),
    }


@router.get("/{mission_id}")
async def get_mission(mission_id: str) -> dict[str, Any]:
    """获取任务详情（stub 返回占位对象）。"""
    return {
        "id": mission_id,
        "title": "",
        "description": "",
        "forgekin_id": None,
        "priority": "normal",
        "status": "unknown",
        "created_at": _now(),
    }
