"""Callbacks API — 回调认证（JSON 持久化，密钥脱敏）.

对应设计文档 §10.2：
    - ``GET /api/v1/callbacks/auth``  — 回调认证信息（token/secret 脱敏）
    - ``PUT /api/v1/callbacks/auth``  — 更新回调认证

存储：data/settings/callbacks_auth.json。
安全：GET 永不返回明文 token/secret，仅返回 configured 布尔；
PUT 传入空字符串表示清除对应密钥。
"""

from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("callbacks_api")

router = APIRouter(prefix="/callbacks", tags=["callbacks"])


class CallbackAuthUpdate(BaseModel):
    """回调认证更新请求体。"""

    token: str | None = Field(default=None, description="认证 Token")
    secret: str | None = Field(default=None, description="签名密钥")
    allowed_origins: list[str] | None = Field(default=None, description="允许来源")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _store_file() -> Path:
    return Path(__file__).resolve().parents[3] / "data" / "settings" / "callbacks_auth.json"


_lock = threading.Lock()


def _read() -> dict[str, Any]:
    path = _store_file()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return data
    except (OSError, ValueError):
        pass
    return {}


def _write(data: dict[str, Any]) -> None:
    path = _store_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def _masked(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}****{value[-4:]}"


@router.get("/auth")
async def get_callback_auth() -> dict[str, Any]:
    """获取回调认证配置（密钥脱敏）。"""
    with _lock:
        cfg = _read()
    has_token = bool(cfg.get("token"))
    has_secret = bool(cfg.get("secret"))
    return {
        "configured": has_token or has_secret,
        "token_masked": _masked(cfg.get("token")) if has_token else None,
        "secret_masked": _masked(cfg.get("secret")) if has_secret else None,
        "allowed_origins": cfg.get("allowed_origins", []),
    }


@router.put("/auth")
async def update_callback_auth(payload: CallbackAuthUpdate) -> dict[str, Any]:
    """更新回调认证配置（空字符串清除密钥；未传字段保持不变）。"""
    with _lock:
        cfg = _read()
        if payload.token is not None:
            if payload.token == "":
                cfg.pop("token", None)
            else:
                cfg["token"] = payload.token
        if payload.secret is not None:
            if payload.secret == "":
                cfg.pop("secret", None)
            else:
                cfg["secret"] = payload.secret
        if payload.allowed_origins is not None:
            cfg["allowed_origins"] = payload.allowed_origins
        cfg["updated_at"] = _now()
        _write(cfg)
    return {
        "updated": True,
        "configured": bool(cfg.get("token")) or bool(cfg.get("secret")),
        "token_masked": _masked(cfg.get("token")),
        "secret_masked": _masked(cfg.get("secret")),
        "allowed_origins": cfg.get("allowed_origins", []),
    }


def get_callback_token() -> str | None:
    """读取明文 token（供回调端点校验使用）。"""
    with _lock:
        return _read().get("token")
