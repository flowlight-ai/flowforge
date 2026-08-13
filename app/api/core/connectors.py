"""Connectors API — 连接器管理（从 im_channels.yaml / a2a_channels.yaml 读取真实数据）.

对应前端 ImSection 组件契约：
    GET  /api/v1/connectors  — 连接器列表
    POST /api/v1/connectors  — 创建连接器
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

logger = get_logger("api.connectors")

router = APIRouter(prefix="/connectors", tags=["connectors"])

_lock = threading.Lock()


class ConnectorCreate(BaseModel):
    """连接器创建请求体。"""

    name: str = Field(..., min_length=1)
    type: str = Field(default="webhook", description="连接器类型")
    config: dict[str, Any] = Field(default_factory=dict)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _get_config_path() -> Path:
    """获取 config 目录路径（铁律 5 禁止硬编码路径）。"""
    return Path(__file__).resolve().parents[3] / "config"


def _custom_file() -> Path:
    """自定义连接器持久化文件。"""
    return Path(__file__).resolve().parents[3] / "data" / "settings" / "connectors_custom.json"


def _read_custom() -> list[dict[str, Any]]:
    try:
        data = json.loads(_custom_file().read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def _write_custom(connectors: list[dict[str, Any]]) -> None:
    path = _custom_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(connectors, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def _load_connectors() -> list[dict[str, Any]]:
    """从 im_channels.yaml 和 a2a_channels.yaml 加载连接器列表."""
    connectors: list[dict[str, Any]] = []
    config_dir = _get_config_path()

    # 从 im_channels.yaml 读取
    im_file = config_dir / "im_channels.yaml"
    if im_file.exists():
        try:
            with open(im_file, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
            for group_name, group in data.items():
                if isinstance(group, dict) and group.get("enabled"):
                    channels = group.get("channels", {})
                    for ch_name, ch in channels.items():
                        is_feishu = "feishu" in group_name
                        connectors.append({
                            "id": f"{group_name}:{ch_name}",
                            "name": ch.get("description", ch_name),
                            "platform": "feishu" if is_feishu else "web",
                            "configured": True,
                            "subscribers": ch.get("subscribers", []),
                            "message_format": ch.get("message_format", "text"),
                        })
        except Exception as e:
            logger.warning("Failed to load im_channels.yaml: %s", e)

    # 从 a2a_channels.yaml 读取
    a2a_file = config_dir / "a2a_channels.yaml"
    if a2a_file.exists():
        try:
            with open(a2a_file, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
            channels = data.get("channels", {})
            for name, ch in channels.items():
                if isinstance(ch, dict):
                    connectors.append({
                        "id": f"a2a:{name}",
                        "name": f"A2A {name}",
                        "platform": name,
                        "configured": ch.get("enabled", False),
                    })
        except Exception as e:
            logger.warning("Failed to load a2a_channels.yaml: %s", e)

    return connectors


@router.get("")
async def list_connectors() -> dict[str, Any]:
    """列出连接器（yaml 内置 + 自定义持久化条目）。"""
    connectors = _load_connectors()
    custom = _read_custom()
    return {"items": custom + connectors, "total": len(custom) + len(connectors)}


@router.post("")
async def create_connector(payload: ConnectorCreate) -> dict[str, Any]:
    """创建连接器（持久化到 data/settings/connectors_custom.json）。"""
    entry = {
        "id": f"conn_{int(datetime.now(timezone.utc).timestamp())}",
        "name": payload.name,
        "type": payload.type,
        "config": payload.config,
        "configured": True,
        "platform": payload.type,
        "status": "pending",
        "created_at": _now(),
    }
    with _lock:
        custom = _read_custom()
        custom.insert(0, entry)
        _write_custom(custom)
    logger.info(f"connectors: 已创建并持久化连接器 {payload.name}")
    return entry