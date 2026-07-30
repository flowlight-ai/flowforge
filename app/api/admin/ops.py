"""Ops API — 运维服务（Web Fusion Phase 8 stub）.

对应设计文档 §10.2：
    - ``GET /api/v1/ops/services``  — 运维服务列表
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

router = APIRouter(prefix="/ops", tags=["ops"])


@router.get("/services")
async def list_ops_services() -> dict[str, Any]:
    """列出运维服务（stub 返回空列表）。"""
    return {
        "items": [],
        "total": 0,
        "status": "stub",
    }
