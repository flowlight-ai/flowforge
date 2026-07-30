"""Quotas API — 配额池（Web Fusion Phase 8 stub）.

对应设计文档 §10.2：
    - ``GET /api/v1/quota/pools``  — 配额池列表
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

router = APIRouter(prefix="/quota", tags=["quotas"])


@router.get("/pools")
async def list_quota_pools() -> dict[str, Any]:
    """列出配额池（stub 返回空列表）。"""
    return {
        "items": [],
        "total": 0,
        "status": "stub",
    }
