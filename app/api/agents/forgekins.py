"""Forgekin API — 可进化智能体列表与详情.

对应设计文档 §10.2：
    - ``GET  /api/v1/forgekins``        — Forgekin 列表（转发到 forgemind/roster）
    - ``GET  /api/v1/forgekins/{id}``   — Forgekin 详情（加载 YAML 配置）
    - ``PUT  /api/v1/forgekins/{id}``   — 更新 Forgekin（暂不支持）
    - ``POST /api/v1/forgekins/{id}/forge`` — 锻造 Forgekin
    - ``POST /api/v1/forgekins/{id}/chat``  — 与 Forgekin 对话
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger
from flowforge.forgemind.forgekins import (
    BUILTIN_FORGEKINS,
    load_forgekin_config,
    list_builtin_forgekins,
)

logger = get_logger("api.v1.forgekins")

router = APIRouter(prefix="/forgekins", tags=["forgekins"])


class ForgekinUpdate(BaseModel):
    """Forgekin 更新请求体。"""
    name: str | None = Field(default=None, description="显示名称")
    description: str | None = Field(default=None, description="描述")
    config: dict[str, Any] | None = Field(default=None, description="配置覆写")


class ChatRequest(BaseModel):
    """与 Forgekin 对话的请求体。"""
    message: str = Field(..., min_length=1, description="消息内容")
    session_id: str | None = Field(default=None, description="会话 ID")


@router.get("")
async def list_forgekins(
    limit: int = Query(50, ge=1, le=200, description="返回条数上限"),
    offset: int = Query(0, ge=0, description="分页偏移"),
) -> dict[str, Any]:
    """列出所有预置 Forgekin（从 roster 加载真实数据）。"""
    items = list_builtin_forgekins()
    total = len(items)
    # 分页
    paged = items[offset : offset + limit]
    return {
        "items": paged,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/{forgekin_id}")
async def get_forgekin(forgekin_id: str) -> dict[str, Any]:
    """获取单个 Forgekin 详情（加载 YAML 配置）。"""
    if forgekin_id not in BUILTIN_FORGEKINS:
        raise HTTPException(
            status_code=404,
            detail=f"未知 Forgekin ID: {forgekin_id}. 可用: {BUILTIN_FORGEKINS}",
        )
    try:
        cfg = load_forgekin_config(forgekin_id)
    except (KeyError, FileNotFoundError) as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return {
        "id": forgekin_id,
        "name": cfg.get("name", forgekin_id),
        "nickname": cfg.get("nickname", ""),
        "species": cfg.get("species", "unknown"),
        "breed": cfg.get("breed", ""),
        "breed_en": cfg.get("breed_en", ""),
        "avatar": cfg.get("avatar", ""),
        "color": cfg.get("color", {}),
        "role": cfg.get("role", {}),
        "personality": cfg.get("personality", {}),
        "evolution_stage": cfg.get("evolution_stage", "E1"),
        "awakening_stage": cfg.get("awakening_stage", "E1"),
        "llm_provider": cfg.get("llm", {}).get("provider", "trae"),
        "available": cfg.get("available", True),
        "mention_patterns": cfg.get("mention_patterns", []),
        "status": "configured",
    }


@router.put("/{forgekin_id}")
async def update_forgekin(
    forgekin_id: str, payload: ForgekinUpdate
) -> dict[str, Any]:
    """更新 Forgekin 配置（暂不支持持久化）。"""
    return {
        "id": forgekin_id,
        "updated": True,
        "fields": payload.model_dump(exclude_none=True),
        "status": "not_persisted",
    }


@router.post("/{forgekin_id}/forge")
async def forge_forgekin(forgekin_id: str) -> dict[str, Any]:
    """锻造 Forgekin 实例（转发到 forgemind endpoint）。"""
    if forgekin_id not in BUILTIN_FORGEKINS:
        raise HTTPException(
            status_code=404,
            detail=f"未知 Forgekin ID: {forgekin_id}. 可用: {BUILTIN_FORGEKINS}",
        )
    # 复用 forgemind endpoint 的全局注册表
    from flowforge.app.api.agents.forgemind import _registry
    from flowforge.forgemind.forgekins.roster import ROSTER_FILES

    existing = _registry.get(forgekin_id)
    if existing is not None:
        return {"id": forgekin_id, "status": "already_forged", **existing.describe()}

    pipeline = await _registry.get_pipeline()
    trae_client = await _registry.get_trae_client()
    yaml_path = ROSTER_FILES[forgekin_id]

    try:
        forgekin = await pipeline.forge_from_yaml(yaml_path, llm_client=trae_client)
    except Exception as exc:
        logger.exception(f"锻造 Forgekin 失败: {forgekin_id}")
        raise HTTPException(status_code=500, detail=f"锻造失败: {exc}")

    _registry.register(forgekin)
    return {"id": forgekin_id, "status": "forged", **forgekin.describe()}


@router.post("/{forgekin_id}/chat")
async def chat_with_forgekin(
    forgekin_id: str, payload: ChatRequest
) -> dict[str, Any]:
    """与 Forgekin 对话。"""
    from flowforge.app.api.agents.forgemind import _registry

    forgekin = _registry.get(forgekin_id)
    if forgekin is None:
        # 自动锻造
        await forge_forgekin(forgekin_id)
        forgekin = _registry.get(forgekin_id)
        if forgekin is None:
            raise HTTPException(status_code=500, detail=f"Forgekin {forgekin_id} 锻造失败")

    messages = [{"role": "user", "content": payload.message}]
    result = await forgekin.chat(messages, session_id=payload.session_id)
    return {
        "forgekin_id": forgekin_id,
        "name": forgekin.name,
        "content": result.get("content", ""),
        "model": result.get("model", "unknown"),
        "session_id": result.get("session_id", ""),
        "usage": result.get("usage", {}),
    }
