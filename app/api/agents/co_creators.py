"""Co-Creators API — 共创管理（Web Fusion Phase 8 stub）.

对应设计文档 §10.2：
    - ``GET  /api/v1/co-creators``  — 共创者列表
    - ``POST /api/v1/co-creators``  — 添加共创者
"""

from __future__ import annotations

from datetime import datetime, timezone
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
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


@router.get("")
async def list_co_creators() -> dict[str, Any]:
    """列出共创者（包含主人+灵智体绑定关系）.

    主人（co-creator）是拥有完全权限的操作者。
    参考 clowder-ai 的 CoCreatorConfig: name="ME", mentionPatterns=["@co-creator"]。
    与 CatConfig（可进化 AI / Forgekin）区分：CoCreatorConfig 是人类 operator。
    """
    return {
        "items": [
            {
                "id": "coc-master",
                "name": "ME",  # 主人名称
                "role": "master",  # 完全权限
                "forgekin_id": None,  # 主人不绑定具体灵智体
                "permissions": ["all"],  # 所有权限
                "status": "active",
                "avatar": "👤",
                "is_master": True,
                "created_at": _now(),
            }
        ],
        "total": 1,
    }


@router.post("")
async def add_co_creator(payload: CoCreatorCreate) -> dict[str, Any]:
    """添加共创者（stub 返回占位对象）。"""
    return {
        "id": f"coc_stub_{int(datetime.now(timezone.utc).timestamp())}",
        "name": payload.name,
        "role": payload.role,
        "forgekin_id": payload.forgekin_id,
        "permissions": payload.permissions,
        "status": "active",
        "created_at": _now(),
    }
