"""Capability API — 能力画像（Web Fusion Phase 8 stub）.

对应设计文档 §10.2：
    - ``GET /api/v1/capability/profiles``  — 能力画像列表
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

router = APIRouter(prefix="/capability", tags=["capability"])


@router.get("/profiles")
async def list_capability_profiles(
    forgekin_id: str | None = Query(default=None, description="按Forgekin过滤"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    """列出能力画像（stub 返回空列表）。"""
    return {
        "items": [],
        "total": 0,
        "limit": limit,
        "offset": offset,
        "filter": {"forgekin_id": forgekin_id} if forgekin_id else None,
    }
