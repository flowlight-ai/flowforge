"""Routing API — 路由策略（JSON 持久化 + llm_route.yaml 派生默认策略）.

对应设计文档 §10.2：
    - ``GET   /api/v1/routing/policies``       — 路由策略列表
    - ``POST  /api/v1/routing/policies``       — 新建路由策略
    - ``PUT   /api/v1/routing/policies``       — 更新路由策略（按 name）
    - ``PATCH /api/v1/routing/policies/{id}``  — 切换策略启用状态

前端契约（HubRoutingPolicyTab）：
    GET → {policies: [{id, name, enabled, priority, conditions, targets,
                       description?, createdAt?, updatedAt?}], total}
    载荷 → {name, enabled, priority, conditions, targets, description?}

首次启动（存储为空）时从 config/llm_route.yaml 的 routes 派生默认策略，
保证页面展示的是真实路由配置而非占位数据。
"""

from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("routing_api")

router = APIRouter(prefix="/routing", tags=["routing"])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class RoutingPoliciesUpdate(BaseModel):
    """路由策略创建/更新请求体（对齐前端 RoutingPolicyPayload）。"""

    name: str = Field(..., min_length=1)
    enabled: bool = Field(default=True)
    priority: int = Field(default=50, ge=0, le=100)
    conditions: list[dict[str, Any]] = Field(default_factory=list)
    targets: list[dict[str, Any]] = Field(default_factory=list)
    description: str | None = Field(default=None)


def _store_file() -> Path:
    return Path(__file__).resolve().parents[3] / "data" / "settings" / "routing_policies.json"


_lock = threading.Lock()


def _read() -> dict[str, Any]:
    path = _store_file()
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"policies": []}


def _write(data: dict[str, Any]) -> None:
    path = _store_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def _seed_from_llm_route() -> None:
    """存储为空时从 llm_route.yaml 的 routes 派生默认策略（真实配置）。"""
    with _lock:
        data = _read()
        if data["policies"]:
            return
        config_dir = Path(__file__).resolve().parents[3] / "config"
        route_file = config_dir / "llm_route.yaml"
        if not route_file.exists():
            _write(data)
            return
        try:
            import yaml
            cfg = yaml.safe_load(route_file.read_text(encoding="utf-8")) or {}
        except Exception as e:  # noqa: BLE001
            logger.warning(f"routing seed: llm_route.yaml parse failed: {e}")
            _write(data)
            return
        routes = cfg.get("routes") or {}
        now = _now()
        for name, route in routes.items():
            if not isinstance(route, dict):
                continue
            targets: list[dict[str, Any]] = []
            primary_model = route.get("primary_model")
            primary_provider = route.get("primary_provider") or "openroute"
            if primary_model:
                targets.append({"provider": primary_provider, "model": primary_model, "weight": 100})
            for i, m in enumerate(route.get("fallback_models") or []):
                targets.append({"provider": (route.get("fallback_providers") or [primary_provider])[min(i, len(route.get("fallback_providers") or [primary_provider]) - 1)],
                                "model": m, "weight": max(10, 50 - i * 15), "fallback": True})
            conditions: list[dict[str, Any]] = []
            if route.get("failover_policy"):
                conditions.append({"dimension": "tag", "operator": "eq", "value": name})
            data["policies"].append({
                "id": f"policy_{uuid.uuid4().hex[:10]}",
                "name": name,
                "enabled": True,
                "priority": 50,
                "conditions": conditions,
                "targets": targets,
                "description": f"来自 llm_route.yaml routes.{name}（主模型 {primary_model}）",
                "created_at": now,
                "updated_at": now,
            })
        _write(data)
        logger.info(f"routing seed: 从 llm_route.yaml 派生 {len(routes)} 条默认策略")


@router.get("/policies")
async def get_routing_policies() -> dict[str, Any]:
    """获取路由策略列表（首次自动从 llm_route.yaml 派生）。"""
    _seed_from_llm_route()
    with _lock:
        data = _read()
    policies = sorted(data["policies"], key=lambda p: (p.get("enabled") is not True, p.get("priority", 50)))
    return {"policies": policies, "total": len(policies)}


@router.post("/policies")
async def create_routing_policy(payload: RoutingPoliciesUpdate) -> dict[str, Any]:
    """新建路由策略。"""
    _seed_from_llm_route()
    now = _now()
    policy = {
        "id": f"policy_{uuid.uuid4().hex[:10]}",
        "name": payload.name,
        "enabled": payload.enabled,
        "priority": payload.priority,
        "conditions": payload.conditions,
        "targets": payload.targets,
        "description": payload.description,
        "created_at": now,
        "updated_at": now,
    }
    with _lock:
        data = _read()
        if any(p.get("name") == payload.name for p in data["policies"]):
            raise HTTPException(status_code=409, detail=f"Policy already exists: {payload.name}")
        data["policies"].append(policy)
        _write(data)
    return policy


@router.put("/policies")
async def update_routing_policy(payload: RoutingPoliciesUpdate) -> dict[str, Any]:
    """更新路由策略（按 name 定位，前端以 name 区分新建/编辑）。"""
    with _lock:
        data = _read()
        for p in data["policies"]:
            if p.get("name") == payload.name:
                p.update({
                    "enabled": payload.enabled,
                    "priority": payload.priority,
                    "conditions": payload.conditions,
                    "targets": payload.targets,
                    "description": payload.description,
                    "updated_at": _now(),
                })
                _write(data)
                return p
        # 不存在则新建（幂等语义）
        now = _now()
        policy = {
            "id": f"policy_{uuid.uuid4().hex[:10]}",
            "name": payload.name,
            "enabled": payload.enabled,
            "priority": payload.priority,
            "conditions": payload.conditions,
            "targets": payload.targets,
            "description": payload.description,
            "created_at": now,
            "updated_at": now,
        }
        data["policies"].append(policy)
        _write(data)
        return policy


@router.patch("/policies/{policy_id}")
async def patch_routing_policy(policy_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    """切换策略启用状态（PATCH {enabled}）。"""
    with _lock:
        data = _read()
        for p in data["policies"]:
            if p.get("id") == policy_id:
                if "enabled" in payload:
                    p["enabled"] = bool(payload["enabled"])
                for key in ("priority", "description"):
                    if key in payload:
                        p[key] = payload[key]
                p["updated_at"] = _now()
                _write(data)
                return p
    raise HTTPException(status_code=404, detail=f"Policy not found: {policy_id}")
