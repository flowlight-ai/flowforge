"""Notify API — 通知订阅（从 default.yaml / system.yaml 读取配置）.

对应前端 NotifySection 组件契约：
    GET  /api/v1/notify/subscriptions  — 订阅列表
    POST /api/v1/notify/subscriptions  — 创建订阅
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

logger = get_logger("api.notify")

router = APIRouter(prefix="/notify", tags=["notify"])

_lock = threading.Lock()


class NotifySubscriptionCreate(BaseModel):
    """通知订阅创建请求体。"""

    channel: str = Field(..., description="通知渠道（如 email/webhook/feishu）")
    target: str = Field(..., description="订阅目标地址")
    events: list[str] = Field(default_factory=list, description="订阅事件列表")
    config: dict[str, Any] = Field(default_factory=dict)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _get_config_path() -> Path:
    """获取 config 目录路径（铁律 5 禁止硬编码路径）。"""
    return Path(__file__).resolve().parents[3] / "config"


def _custom_file() -> Path:
    """自定义订阅持久化文件。"""
    return Path(__file__).resolve().parents[3] / "data" / "settings" / "notify_subscriptions.json"


def _read_custom() -> list[dict[str, Any]]:
    try:
        data = json.loads(_custom_file().read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def _write_custom(subscriptions: list[dict[str, Any]]) -> None:
    path = _custom_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(subscriptions, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def _load_subscriptions() -> list[dict[str, Any]]:
    """从 default.yaml 和 system.yaml 加载通知配置。"""
    subscriptions: list[dict[str, Any]] = []
    config_dir = _get_config_path()

    # 从 default.yaml 读取系统配置中的通知相关数据
    default_file = config_dir / "default.yaml"
    if default_file.exists():
        try:
            with open(default_file, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
            log_config = data.get("logging", {})
            if log_config:
                log_file = log_config.get("log_file", "logs/flowforge.log")
                subscriptions.append({
                    "id": "sub:log",
                    "channel": "file",
                    "target": log_file,
                    "events": ["system.*"],
                    "status": "active",
                    "config": {"level": log_config.get("level", "INFO")},
                    "created_at": _now(),
                })
        except Exception as e:
            logger.warning("Failed to load default.yaml: %s", e)

    # 从 system.yaml 读取
    system_file = config_dir / "system.yaml"
    if system_file.exists():
        try:
            with open(system_file, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
            # 检查是否有通知配置
            notify_cfg = data.get("notifications", {})
            if isinstance(notify_cfg, dict):
                for name, cfg in notify_cfg.items():
                    if isinstance(cfg, dict):
                        subscriptions.append({
                            "id": f"sub:system:{name}",
                            "channel": cfg.get("channel", "unknown"),
                            "target": cfg.get("target", ""),
                            "events": cfg.get("events", [f"system.{name}"]),
                            "status": "active" if cfg.get("enabled", True) else "inactive",
                            "config": cfg,
                            "created_at": _now(),
                        })
        except Exception as e:
            logger.warning("Failed to load system.yaml: %s", e)

    # 如果没有任何配置，添加默认的 IM 通知渠道
    if not subscriptions:
        subscriptions.append({
            "id": "sub:im:web",
            "channel": "web",
            "target": "web_group:forgekin_council",
            "events": ["council.*", "review.*"],
            "status": "active",
            "config": {},
            "created_at": _now(),
        })

    return subscriptions


@router.get("/subscriptions")
async def list_subscriptions() -> dict[str, Any]:
    """列出通知订阅（yaml 内置 + 自定义持久化条目）。"""
    subscriptions = _load_subscriptions()
    custom = _read_custom()
    return {"items": custom + subscriptions, "total": len(custom) + len(subscriptions)}


@router.post("/subscriptions")
async def create_subscription(payload: NotifySubscriptionCreate) -> dict[str, Any]:
    """创建通知订阅（持久化到 data/settings/notify_subscriptions.json）。"""
    entry = {
        "id": f"sub_{int(datetime.now(timezone.utc).timestamp())}",
        "channel": payload.channel,
        "target": payload.target,
        "events": payload.events,
        "config": payload.config,
        "status": "active",
        "created_at": _now(),
    }
    with _lock:
        custom = _read_custom()
        custom.insert(0, entry)
        _write_custom(custom)
    logger.info(f"notify: 已创建并持久化订阅 {payload.channel} -> {payload.target}")
    return entry