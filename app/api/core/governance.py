"""Governance API — 治理状态（Web Fusion Phase 8 stub）.

对应设计文档 §10.2：
    - ``GET /api/v1/governance/status``  — 治理状态
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter

router = APIRouter(prefix="/governance", tags=["governance"])


@router.get("/status")
async def governance_status() -> dict[str, Any]:
    """获取治理状态（stub 返回默认状态）。"""
    return {
        "status": "nominal",
        "active_policies": 0,
        "pending_approvals": 0,
        "violations_24h": 0,
        "checked_at": datetime.now(UTC).isoformat() + "Z",
    }
