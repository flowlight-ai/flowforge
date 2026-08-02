"""Permissions API — 权限管理（Web Fusion Phase 8 stub）.

对应设计文档 §10.2：
    - ``GET /api/v1/permissions``  — 权限列表
    - ``PUT /api/v1/permissions``  — 更新权限
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/permissions", tags=["permissions"])


class PermissionsUpdate(BaseModel):
    """权限更新请求体。"""

    role: str = Field(default="viewer", description="角色")
    grants: list[str] = Field(default_factory=list, description="授权列表")
    revocations: list[str] = Field(default_factory=list, description="撤销列表")


@router.get("")
async def get_permissions() -> dict[str, Any]:
    """获取权限配置（stub 返回默认配置）。"""
    return {
        "role": "viewer",
        "grants": [],
        "revocations": [],
        "status": "stub",
    }


@router.put("")
async def update_permissions(payload: PermissionsUpdate) -> dict[str, Any]:
    """更新权限配置（stub 返回确认）。"""
    return {
        "role": payload.role,
        "grants": payload.grants,
        "revocations": payload.revocations,
        "updated": True,
        "status": "stub",
    }
