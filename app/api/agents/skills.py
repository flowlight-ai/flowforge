"""Skills API — 能力管理（Web Fusion Phase 8 stub）.

对应设计文档 §10.2：
    - ``GET  /api/v1/skills``  — Skill 列表
    - ``POST /api/v1/skills``  — 创建/注册 Skill
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

router = APIRouter(prefix="/skills", tags=["skills"])


class SkillCreate(BaseModel):
    """Skill 创建请求体。"""

    name: str = Field(..., min_length=1)
    description: str | None = Field(default=None)
    version: str = Field(default="0.1.0")
    entry: str | None = Field(default=None, description="入口标识")
    config: dict[str, Any] = Field(default_factory=dict)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat() + "Z"


@router.get("")
async def list_skills(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    """列出 Skill（stub 返回空列表）。"""
    return {"items": [], "total": 0, "limit": limit, "offset": offset}


@router.post("")
async def create_skill(payload: SkillCreate) -> dict[str, Any]:
    """创建 Skill（stub 返回占位对象）。"""
    return {
        "id": f"skill_stub_{int(datetime.now(timezone.utc).timestamp())}",
        "name": payload.name,
        "description": payload.description,
        "version": payload.version,
        "entry": payload.entry,
        "config": payload.config,
        "status": "registered",
        "created_at": _now(),
    }
