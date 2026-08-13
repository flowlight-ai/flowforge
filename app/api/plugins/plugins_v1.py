"""Plugins API — 插件管理（Web Fusion Phase 8 stub）.

对应设计文档 §10.2：
    - ``GET  /api/v1/plugins``  — 插件列表（由现有 endpoints/plugins.py 提供）
    - ``POST /api/v1/plugins``  — 注册插件（本 stub 提供）

注意：现有 flowforge/app/api/endpoints/plugins.py 已实现 GET /plugins
（返回 PluginManager + PluginRegistry 聚合数据），以及 install/reload/
execute/health/frontend 等子路径。本 stub **不**重复定义 GET /plugins，
仅提供 POST /plugins 用于注册新插件，避免覆盖现有实现。
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/plugins", tags=["plugins-v1"])


class PluginCreate(BaseModel):
    """插件注册请求体。"""

    name: str = Field(..., min_length=1)
    version: str = Field(default="0.1.0")
    description: str | None = Field(default=None)
    entry: str | None = Field(default=None, description="插件入口模块")
    config: dict[str, Any] = Field(default_factory=dict)


@router.post("")
async def register_plugin(payload: PluginCreate) -> dict[str, Any]:
    """注册插件（stub 返回占位对象）。

    现有 endpoints/plugins.py 提供 POST /plugins/install 用于安装，
    本端点提供更通用的 POST /plugins 用于注册（stub 实现）。
    """
    return {
        "id": f"plugin_stub_{int(datetime.now(timezone.utc).timestamp())}",
        "name": payload.name,
        "version": payload.version,
        "description": payload.description,
        "entry": payload.entry,
        "config": payload.config,
        "status": "registered",
        "created_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
