"""Forgekin API — 可进化智能体列表与详情（Web Fusion Phase 8 stub）.

对应设计文档 §10.2：
    - ``GET  /api/v1/forgekins``        — Forgekin 列表
    - ``GET  /api/v1/forgekins/{id}``   — Forgekin 详情
    - ``PUT  /api/v1/forgekins/{id}``   — 更新 Forgekin

stub 实现：返回空列表/默认对象，确保前端不出现 404。
真实数据将通过 forgemind 应用层（/api/v1/forgemind/roster）填充。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

router = APIRouter(prefix="/forgekins", tags=["forgekins"])


class ForgekinUpdate(BaseModel):
    """Forgekin 更新请求体（stub）。"""

    name: str | None = Field(default=None, description="显示名称")
    description: str | None = Field(default=None, description="描述")
    config: dict[str, Any] | None = Field(default=None, description="配置覆写")


@router.get("")
async def list_forgekins(
    limit: int = Query(50, ge=1, le=200, description="返回条数上限"),
    offset: int = Query(0, ge=0, description="分页偏移"),
) -> dict[str, Any]:
    """列出所有 Forgekin（stub 返回空列表）。"""
    return {
        "items": [],
        "total": 0,
        "limit": limit,
        "offset": offset,
    }


@router.get("/{forgekin_id}")
async def get_forgekin(forgekin_id: str) -> dict[str, Any]:
    """获取单个 Forgekin 详情（stub 返回占位对象）。"""
    return {
        "id": forgekin_id,
        "name": forgekin_id,
        "species": "unknown",
        "evolution_stage": "E1",
        "awakening_stage": "E1",
        "description": "",
        "config": {},
        "status": "stub",
    }


@router.put("/{forgekin_id}")
async def update_forgekin(
    forgekin_id: str, payload: ForgekinUpdate
) -> dict[str, Any]:
    """更新 Forgekin 配置（stub 接受请求但不持久化）。"""
    return {
        "id": forgekin_id,
        "updated": True,
        "fields": payload.model_dump(exclude_none=True),
        "status": "stub",
    }
