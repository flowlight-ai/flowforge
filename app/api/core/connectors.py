"""Connectors API — 连接器管理（Web Fusion Phase 8 stub）.

对应设计文档 §10.2：
    - ``GET  /api/v1/connectors``  — 连接器列表
    - ``POST /api/v1/connectors``  — 创建连接器
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/connectors", tags=["connectors"])


class ConnectorCreate(BaseModel):
    """连接器创建请求体。"""

    name: str = Field(..., min_length=1)
    type: str = Field(default="webhook", description="连接器类型")
    config: dict[str, Any] = Field(default_factory=dict)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat() + "Z"


@router.get("")
async def list_connectors() -> dict[str, Any]:
    """列出连接器（stub 返回空列表）。"""
    return {"items": [], "total": 0}


@router.post("")
async def create_connector(payload: ConnectorCreate) -> dict[str, Any]:
    """创建连接器（stub 返回占位对象）。"""
    return {
        "id": f"conn_stub_{int(datetime.now(timezone.utc).timestamp())}",
        "name": payload.name,
        "type": payload.type,
        "config": payload.config,
        "status": "pending",
        "created_at": _now(),
    }
