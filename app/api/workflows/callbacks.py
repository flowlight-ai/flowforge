"""Callbacks API — 回调认证（Web Fusion Phase 8 stub）.

对应设计文档 §10.2：
    - ``GET /api/v1/callbacks/auth``  — 回调认证信息
    - ``PUT /api/v1/callbacks/auth``  — 更新回调认证
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/callbacks", tags=["callbacks"])


class CallbackAuthUpdate(BaseModel):
    """回调认证更新请求体。"""

    token: str | None = Field(default=None, description="认证 Token")
    secret: str | None = Field(default=None, description="签名密钥")
    allowed_origins: list[str] | None = Field(default=None, description="允许来源")


@router.get("/auth")
async def get_callback_auth() -> dict[str, Any]:
    """获取回调认证配置（stub 返回默认配置）。"""
    return {
        "configured": False,
        "allowed_origins": [],
        "status": "stub",
    }


@router.put("/auth")
async def update_callback_auth(payload: CallbackAuthUpdate) -> dict[str, Any]:
    """更新回调认证配置（stub 返回确认，不暴露密钥）。"""
    return {
        "updated": True,
        "configured": payload.token is not None or payload.secret is not None,
        "allowed_origins": payload.allowed_origins or [],
        "status": "stub",
    }
