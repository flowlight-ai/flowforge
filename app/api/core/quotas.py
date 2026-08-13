"""Quotas API — 配额池（JSON 持久化 + providers 派生默认池）.

对应设计文档 §10.2 + 前端契约（HubQuotaBoardTab）：
    - ``GET /api/v1/quotas``        — 配额池列表 {pools: [{id, provider, model, limit, used, unit}]}
    - ``GET /api/v1/quotas/usage``  — 按 Forgekin 用量 {items: [{forgekin_id, forgekin_name, tokens_in, tokens_out, calls}]}
    - ``GET /api/v1/quota/pools``   — 旧路径兼容

首次启动（存储为空）时从 config/llm_route.yaml 的 providers/routes 派生
默认配额池（真实模型列表），limit=0 表示不限额。
"""

from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Query

from flowforge.core.tracing import get_logger

logger = get_logger("quotas_api")

router = APIRouter(prefix="/quotas", tags=["quotas"])

# 旧路径 /quota/pools 兼容（前端已迁移到 /quotas）
legacy_router = APIRouter(prefix="/quota", tags=["quotas-legacy"])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _settings_file() -> Path:
    return Path(__file__).resolve().parents[3] / "data" / "settings" / "quota_pools.json"


def _usage_file() -> Path:
    return Path(__file__).resolve().parents[3] / "data" / "settings" / "quota_usage.json"


_lock = threading.Lock()


def _read(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _write(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def _seed_pools() -> None:
    """存储为空时从 llm_route.yaml 的 routes 派生默认配额池。"""
    with _lock:
        path = _settings_file()
        if _read(path).get("pools"):
            return
        models: list[str] = []
        config_dir = Path(__file__).resolve().parents[3] / "config"
        route_file = config_dir / "llm_route.yaml"
        try:
            import yaml
            cfg = yaml.safe_load(route_file.read_text(encoding="utf-8")) if route_file.exists() else {}
        except Exception as e:  # noqa: BLE001
            logger.warning(f"quotas seed: llm_route.yaml parse failed: {e}")
            cfg = {}
        for route in (cfg.get("routes") or {}).values():
            if not isinstance(route, dict):
                continue
            if route.get("primary_model"):
                models.append(route["primary_model"])
            models.extend(route.get("fallback_models") or [])
        seen: set[str] = set()
        pools = []
        for m in models:
            if m in seen:
                continue
            seen.add(m)
            pools.append({
                "id": f"pool_{m.lower().replace('-', '_').replace('.', '_')}",
                "provider": "openroute",
                "model": m,
                "limit": 0,      # 0 = 不限额
                "used": 0,
                "unit": "tokens",
            })
        _write(path, {"pools": pools, "updated_at": _now()})
        logger.info(f"quotas seed: 派生 {len(pools)} 个默认配额池")


def _seed_usage() -> dict[str, Any]:
    """用量存储初始化（空表结构）。"""
    with _lock:
        path = _usage_file()
        data = _read(path)
        if "items" not in data:
            data = {"items": [], "updated_at": _now()}
            _write(path, data)
        return data


@legacy_router.get("/pools")
async def list_quota_pools_legacy() -> dict[str, Any]:
    """列出配额池（旧路径 /quota/pools 兼容）。"""
    return await list_quota_pools()


@router.get("/pools")
async def list_quota_pools() -> dict[str, Any]:
    """列出配额池（/quotas/pools 别名）。"""
    _seed_pools()
    with _lock:
        pools = _read(_settings_file()).get("pools", [])
    return {"items": pools, "total": len(pools)}


@router.get("")
async def get_quotas() -> dict[str, Any]:
    """获取配额池（前端 /api/v1/quotas 契约）。"""
    _seed_pools()
    with _lock:
        pools = _read(_settings_file()).get("pools", [])
    return {"pools": pools, "total": len(pools)}


@router.get("/usage")
async def get_quota_usage() -> dict[str, Any]:
    """按 Forgekin 的用量统计（前端 /api/v1/quotas/usage 契约）。"""
    _seed_usage()
    with _lock:
        items = _read(_usage_file()).get("items", [])
    return {"items": items, "total": len(items)}


def record_usage(forgekin_id: str, forgekin_name: str, tokens_in: int = 0,
                 tokens_out: int = 0, calls: int = 1) -> None:
    """记录一次 LLM 用量（供群聊/任务模块调用）。"""
    _seed_usage()
    with _lock:
        path = _usage_file()
        data = _read(path)
        items = data.setdefault("items", [])
        entry = next((i for i in items if i.get("forgekin_id") == forgekin_id), None)
        if entry is None:
            entry = {"forgekin_id": forgekin_id, "forgekin_name": forgekin_name,
                     "tokens_in": 0, "tokens_out": 0, "calls": 0, "updated_at": _now()}
            items.append(entry)
        entry["tokens_in"] += tokens_in
        entry["tokens_out"] += tokens_out
        entry["calls"] += calls
        entry["updated_at"] = _now()
        _write(path, data)
