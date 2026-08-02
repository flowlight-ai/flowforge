"""Routing API — 路由策略（Web Fusion Phase 8 stub）.

对应设计文档 §10.2：
    - ``GET /api/v1/routing/policies``  — 路由策略列表
    - ``PUT /api/v1/routing/policies``  — 更新路由策略
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/routing", tags=["routing"])


class RoutingPoliciesUpdate(BaseModel):
    """路由策略更新请求体。"""

    policies: list[dict[str, Any]] = Field(default_factory=list)


@router.get("/policies")
async def get_routing_policies() -> dict[str, Any]:
    """获取路由策略（stub 返回默认策略）。"""
    return {
        "policies": [],
        "default_provider": None,
        "status": "stub",
    }


@router.put("/policies")
async def update_routing_policies(payload: RoutingPoliciesUpdate) -> dict[str, Any]:
    """更新路由策略（stub 返回确认）。"""
    return {
        "policies": payload.policies,
        "updated": True,
        "status": "stub",
    }
