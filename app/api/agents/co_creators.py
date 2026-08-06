"""Co-Creators API — 共创管理（Web Fusion Phase 8 stub）.

对应设计文档 §10.2：
    - ``GET  /api/v1/co-creators``  — 共创者列表
    - ``POST /api/v1/co-creators``  — 添加共创者
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/co-creators", tags=["co-creators"])


class CoCreatorCreate(BaseModel):
    """共创者添加请求体。"""

    name: str = Field(..., min_length=1)
    role: str = Field(default="collaborator", description="角色")
    forgekin_id: str | None = Field(default=None, description="绑定Forgekin")
    permissions: list[str] = Field(default_factory=list)


def _now() -> str:
    return datetime.now(UTC).isoformat() + "Z"


@router.get("")
async def list_co_creators() -> dict[str, Any]:
    """列出共创者（stub 返回空列表）。"""
    return {"items": [], "total": 0}


@router.post("")
async def add_co_creator(payload: CoCreatorCreate) -> dict[str, Any]:
    """添加共创者（stub 返回占位对象）。"""
    return {
        "id": f"coc_stub_{int(datetime.now(UTC).timestamp())}",
        "name": payload.name,
        "role": payload.role,
        "forgekin_id": payload.forgekin_id,
        "permissions": payload.permissions,
        "status": "active",
        "created_at": _now(),
    }
