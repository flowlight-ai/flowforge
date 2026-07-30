"""Signals API — 信号系统（Web Fusion Phase 8 stub）.

对应设计文档 §10.2：
    - ``GET  /api/v1/signals``          — 信号列表
    - ``GET  /api/v1/signals/sources``  — 信号源列表
    - ``POST /api/v1/signals/sources``  — 创建信号源
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

router = APIRouter(prefix="/signals", tags=["signals"])


class SignalSourceCreate(BaseModel):
    """信号源创建请求体。"""

    name: str = Field(..., min_length=1)
    type: str = Field(default="rss", description="信号源类型")
    url: str | None = Field(default=None)
    config: dict[str, Any] = Field(default_factory=dict)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat() + "Z"


@router.get("")
async def list_signals(
    source: str | None = Query(default=None, description="按信号源过滤"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    """列出信号（stub 返回空列表）。"""
    return {
        "items": [],
        "total": 0,
        "limit": limit,
        "offset": offset,
        "filter": {"source": source} if source else None,
    }


@router.get("/sources")
async def list_signal_sources() -> dict[str, Any]:
    """列出信号源（stub 返回空列表）。"""
    return {"items": [], "total": 0}


@router.post("/sources")
async def create_signal_source(payload: SignalSourceCreate) -> dict[str, Any]:
    """创建信号源（stub 返回占位对象）。"""
    return {
        "id": f"src_stub_{int(datetime.now(timezone.utc).timestamp())}",
        "name": payload.name,
        "type": payload.type,
        "url": payload.url,
        "config": payload.config,
        "created_at": _now(),
        "status": "stub",
    }
