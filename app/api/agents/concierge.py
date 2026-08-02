"""Concierge API — 管家配置（Web Fusion Phase 8 stub）.

对应设计文档 §10.2：
    - ``GET /api/v1/concierge/config``  — 管家配置
    - ``PUT /api/v1/concierge/config``  — 更新管家配置
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/concierge", tags=["concierge"])


class ConciergeConfigUpdate(BaseModel):
    """管家配置更新请求体。"""

    enabled: bool | None = Field(default=None)
    greeting: str | None = Field(default=None)
    default_forgekin: str | None = Field(default=None)
    preferences: dict[str, Any] | None = Field(default=None)


@router.get("/config")
async def get_concierge_config() -> dict[str, Any]:
    """获取管家配置（stub 返回默认配置）。"""
    return {
        "enabled": True,
        "greeting": "",
        "default_forgekin": None,
        "preferences": {},
        "status": "stub",
    }


@router.put("/config")
async def update_concierge_config(payload: ConciergeConfigUpdate) -> dict[str, Any]:
    """更新管家配置（stub 返回确认）。"""
    return {
        "updated": True,
        "fields": payload.model_dump(exclude_none=True),
        "status": "stub",
    }
