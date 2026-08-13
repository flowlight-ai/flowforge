"""Permissions API — 权限管理（JSON 持久化，按连接器分键）.

对应设计文档 §10.2 + 前端契约（HubPermissionsTab）：
    - ``GET /api/v1/permissions/{connector_id}`` — 获取连接器权限配置
    - ``PUT /api/v1/permissions/{connector_id}`` — 更新连接器权限配置
    - ``GET /api/v1/permissions``                — 默认连接器配置（旧路径兼容）

前端配置模型（PermissionConfig）：
    {whitelistEnabled, commandAdminOnly, adminOpenIds: string[],
     allowedGroups: [{externalChatId, label?, addedAt}]}

存储：data/settings/permissions.json — {connectors: {connector_id: config}}
"""

from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("permissions_api")

router = APIRouter(prefix="/permissions", tags=["permissions"])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class PermissionsUpdate(BaseModel):
    """权限更新请求体（兼容旧 PUT /permissions）。"""

    role: str = Field(default="viewer", description="角色")
    grants: list[str] = Field(default_factory=list, description="授权列表")
    revocations: list[str] = Field(default_factory=list, description="撤销列表")


def _store_file() -> Path:
    return Path(__file__).resolve().parents[3] / "data" / "settings" / "permissions.json"


_lock = threading.Lock()

DEFAULT_CONFIG: dict[str, Any] = {
    "whitelist_enabled": False,
    "command_admin_only": False,
    "admin_open_ids": [],
    "allowed_groups": [],
}


def _read() -> dict[str, Any]:
    path = _store_file()
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"connectors": {}}


def _write(data: dict[str, Any]) -> None:
    path = _store_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def _get_config(connector_id: str) -> dict[str, Any]:
    with _lock:
        data = _read()
        cfg = data["connectors"].get(connector_id)
    if cfg is None:
        cfg = dict(DEFAULT_CONFIG)
        cfg["connector_id"] = connector_id
    return cfg


def _save_config(connector_id: str, cfg: dict[str, Any]) -> dict[str, Any]:
    with _lock:
        data = _read()
        data["connectors"][connector_id] = cfg
        _write(data)
    return cfg


def _to_camel(config: dict[str, Any]) -> dict[str, Any]:
    """存储 snake_case → 前端 camelCase（allowedGroups 为对象数组）。"""
    groups = []
    for g in config.get("allowed_groups", []) or []:
        if isinstance(g, dict):
            groups.append({
                "externalChatId": g.get("external_chat_id"),
                "label": g.get("label"),
                "addedAt": g.get("added_at"),
            })
    return {
        "whitelistEnabled": config.get("whitelist_enabled", False),
        "commandAdminOnly": config.get("command_admin_only", False),
        "adminOpenIds": config.get("admin_open_ids", []),
        "allowedGroups": groups,
    }


@router.get("")
async def get_permissions_default() -> dict[str, Any]:
    """获取默认连接器权限配置（旧路径兼容）。"""
    cfg = _get_config("default")
    return {**cfg, "role": "viewer", "grants": [], "revocations": []}


@router.put("")
async def update_permissions_default(payload: PermissionsUpdate) -> dict[str, Any]:
    """更新默认连接器权限（旧路径兼容，合并 grants/revocations）。"""
    cfg = _get_config("default")
    if payload.grants:
        cfg["admin_open_ids"] = sorted(set(cfg.get("admin_open_ids", [])) | set(payload.grants))
    if payload.revocations:
        cfg["admin_open_ids"] = [x for x in cfg.get("admin_open_ids", []) if x not in payload.revocations]
    cfg["role"] = payload.role
    return _save_config("default", cfg)


@router.get("/{connector_id}")
async def get_connector_permissions(connector_id: str) -> dict[str, Any]:
    """获取连接器权限配置（前端契约：camelCase 字段）。"""
    cfg = _get_config(connector_id)
    return _to_camel(cfg)


@router.put("/{connector_id}")
async def update_connector_permissions(connector_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    """更新连接器权限配置（PATCH 语义：只覆盖传入字段）。"""
    cfg = _get_config(connector_id)
    if "whitelistEnabled" in payload:
        cfg["whitelist_enabled"] = bool(payload["whitelistEnabled"])
    if "commandAdminOnly" in payload:
        cfg["command_admin_only"] = bool(payload["commandAdminOnly"])
    if "adminOpenIds" in payload:
        cfg["admin_open_ids"] = list(payload["adminOpenIds"])
    if "allowedGroups" in payload:
        groups = payload["allowedGroups"]
        if not isinstance(groups, list):
            raise HTTPException(status_code=400, detail="allowedGroups must be a list")
        cfg["allowed_groups"] = [
            {"external_chat_id": g.get("externalChatId"), "label": g.get("label"),
             "added_at": g.get("addedAt", int(datetime.now(timezone.utc).timestamp() * 1000))}
            for g in groups if isinstance(g, dict) and g.get("externalChatId")
        ]
    _save_config(connector_id, cfg)
    return _to_camel(cfg)
