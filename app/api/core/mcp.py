"""MCP API — MCP 服务管理（从 plugins.yaml 读取真实数据）.

对应前端 McpSection 组件契约：
    GET  /api/v1/mcp/servers  — MCP 服务列表
    POST /api/v1/mcp/servers  — 注册 MCP 服务
"""

from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml
from fastapi import APIRouter
from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("api.mcp")

router = APIRouter(prefix="/mcp", tags=["mcp"])

_lock = threading.Lock()


class McpServerCreate(BaseModel):
    """MCP 服务注册请求体。"""

    name: str = Field(..., min_length=1)
    transport: str = Field(default="stdio", description="传输方式")
    command: str | None = Field(default=None)
    args: list[str] = Field(default_factory=list)
    url: str | None = Field(default=None, description="HTTP 流式传输 URL")
    enabled: bool = Field(default=True)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _get_config_path() -> Path:
    """获取 config 目录路径（铁律 5 禁止硬编码路径）。"""
    return Path(__file__).resolve().parents[3] / "config"


def _custom_file() -> Path:
    """自定义 MCP 服务持久化文件。"""
    return Path(__file__).resolve().parents[3] / "data" / "settings" / "mcp_servers.json"


def _read_custom() -> list[dict[str, Any]]:
    try:
        data = json.loads(_custom_file().read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def _write_custom(servers: list[dict[str, Any]]) -> None:
    path = _custom_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(servers, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def _load_mcp_servers() -> list[dict[str, Any]]:
    """从 plugins.yaml 加载 MCP 服务和插件列表."""
    servers: list[dict[str, Any]] = []
    config_dir = _get_config_path()

    # 从 plugins.yaml 读取工具列表作为 MCP 服务
    plugins_file = config_dir / "plugins.yaml"
    if plugins_file.exists():
        try:
            with open(plugins_file, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
            plugins = data.get("plugins", [])
            for p in plugins:
                if isinstance(p, dict):
                    name = p.get("name", "")
                    tags = p.get("tags", [])
                    servers.append({
                        "id": f"plugin:{name}",
                        "name": name,
                        "description": p.get("description", ""),
                        "transport": p.get("transport", "local"),
                        "tools": 1,
                        "enabled": True,
                        "tags": tags,
                        "entry_point": p.get("entry_point", ""),
                    })

            # 从 plugins.yaml 读取 MCP 服务器配置
            mcp_servers = data.get("mcp_servers", [])
            if isinstance(mcp_servers, list):
                for ms in mcp_servers:
                    if isinstance(ms, dict):
                        name = ms.get("name", "")
                        servers.append({
                            "id": f"mcp:{name}",
                            "name": f"MCP {name}",
                            "description": ms.get("description", f"MCP 服务: {name}"),
                            "transport": ms.get("transport", "stdio"),
                            "command": ms.get("command", ""),
                            "args": ms.get("args", []),
                            "tools": 0,
                            "enabled": ms.get("enabled", False),
                            "tags": ["mcp"],
                        })
        except Exception as e:
            logger.warning("Failed to load plugins.yaml: %s", e)

    return servers


@router.get("/servers")
async def list_mcp_servers() -> dict[str, Any]:
    """列出 MCP 服务（plugins.yaml 内置 + 自定义持久化条目）。"""
    servers = _load_mcp_servers()
    custom = _read_custom()
    return {"items": custom + servers, "total": len(custom) + len(servers)}


@router.post("/servers")
async def register_mcp_server(payload: McpServerCreate) -> dict[str, Any]:
    """注册 MCP 服务（持久化到 data/settings/mcp_servers.json）。"""
    entry = {
        "id": f"mcp_{int(datetime.now(timezone.utc).timestamp())}",
        "name": payload.name,
        "transport": payload.transport,
        "command": payload.command,
        "args": payload.args,
        "url": payload.url,
        "enabled": payload.enabled,
        "tags": ["custom"],
        "tools": 0,
        "status": "registered",
        "created_at": _now(),
    }
    with _lock:
        custom = _read_custom()
        custom.insert(0, entry)
        _write_custom(custom)
    logger.info(f"mcp: 已注册并持久化 MCP 服务 {payload.name}")
    return entry