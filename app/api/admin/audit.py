"""Audit API — 审计事件（Web Fusion Phase 8 stub）.

对应设计文档 §10.2：
    - ``GET /api/v1/audit/events``  — 审计事件列表
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("/events")
async def list_audit_events(
    actor: str | None = Query(default=None, description="按操作者过滤"),
    event_type: str | None = Query(default=None, description="按事件类型过滤"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    """列出审计事件（stub 返回空列表）。"""
    return {
        "items": [],
        "total": 0,
        "limit": limit,
        "offset": offset,
        "filter": {
            k: v for k, v in {"actor": actor, "event_type": event_type}.items() if v
        },
    }
