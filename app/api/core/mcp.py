"""MCP API — MCP 服务管理（Web Fusion Phase 8 stub）.

对应设计文档 §10.2：
    - ``GET  /api/v1/mcp/servers``  — MCP 服务列表
    - ``POST /api/v1/mcp/servers``  — 注册 MCP 服务
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/mcp", tags=["mcp"])


class McpServerCreate(BaseModel):
    """MCP 服务注册请求体。"""

    name: str = Field(..., min_length=1)
    transport: str = Field(default="stdio", description="传输方式")
    command: str | None = Field(default=None)
    args: list[str] = Field(default_factory=list)
    url: str | None = Field(default=None, description="HTTP 流式传输 URL")
    enabled: bool = Field(default=True)


def _now() -> str:
    return datetime.now(UTC).isoformat() + "Z"


@router.get("/servers")
async def list_mcp_servers() -> dict[str, Any]:
    """列出 MCP 服务（stub 返回空列表）。"""
    return {"items": [], "total": 0}


@router.post("/servers")
async def register_mcp_server(payload: McpServerCreate) -> dict[str, Any]:
    """注册 MCP 服务（stub 返回占位对象）。"""
    return {
        "id": f"mcp_stub_{int(datetime.now(UTC).timestamp())}",
        "name": payload.name,
        "transport": payload.transport,
        "command": payload.command,
        "args": payload.args,
        "url": payload.url,
        "enabled": payload.enabled,
        "status": "registered",
        "created_at": _now(),
    }
