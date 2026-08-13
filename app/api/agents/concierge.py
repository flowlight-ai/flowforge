"""Concierge API — 管家配置（JSON 持久化）.

对应设计文档 §10.2：
    - ``GET /api/v1/concierge/config``  — 管家配置
    - ``PUT /api/v1/concierge/config``  — 更新管家配置

存储：data/settings/concierge_config.json。
更新支持字段级合并；greeting/preferences 为空字符串/空 dict 时
返回 None/{}（前端可显示占位而非假数据）。
"""

from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("concierge_api")

router = APIRouter(prefix="/concierge", tags=["concierge"])


class ConciergeConfigUpdate(BaseModel):
    """管家配置更新请求体。"""

    enabled: bool | None = Field(default=None)
    greeting: str | None = Field(default=None)
    default_forgekin: str | None = Field(default=None)
    preferences: dict[str, Any] | None = Field(default=None)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _store_file() -> Path:
    return Path(__file__).resolve().parents[3] / "data" / "settings" / "concierge_config.json"


_lock = threading.Lock()

DEFAULT_CONFIG: dict[str, Any] = {
    "enabled": False,
    "greeting": "",
    "default_forgekin": None,
    "preferences": {},
}


def _read() -> dict[str, Any]:
    path = _store_file()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return data
    except (OSError, ValueError):
        pass
    return dict(DEFAULT_CONFIG)


def _write(data: dict[str, Any]) -> None:
    path = _store_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


@router.get("/config")
async def get_concierge_config() -> dict[str, Any]:
    """获取管家配置（持久化值；首次返回默认配置）。"""
    with _lock:
        cfg = _read()
    return {**DEFAULT_CONFIG, **cfg}


@router.put("/config")
async def update_concierge_config(payload: ConciergeConfigUpdate) -> dict[str, Any]:
    """更新管家配置（字段级合并，持久化到 JSON）。"""
    updates = payload.model_dump(exclude_none=True)
    with _lock:
        cfg = {**DEFAULT_CONFIG, **_read(), **updates}
        _write(cfg)
    cfg["updated_at"] = _now()
    return cfg
