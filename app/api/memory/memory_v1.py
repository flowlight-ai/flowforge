"""Memory API — 记忆集合与检索（Web Fusion Phase 8 stub）.

对应设计文档 §10.2：
    - ``GET  /api/v1/memory/collections``  — 记忆集合列表
    - ``POST /api/v1/memory/collections``  — 创建记忆集合
    - ``POST /api/v1/memory/recall``       — 记忆检索
    - ``GET  /api/v1/memory/health``       — 记忆健康检查

注意：与现有 flowforge/app/api/endpoints/memory.py 共享 /memory 前缀，
但本文件仅定义 /collections /recall /health 子路径，不与
现有 /memory/{memory_id} 路由冲突。注册时需在现有 router 之前注册
以确保静态路径优先匹配。
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

router = APIRouter(prefix="/memory", tags=["memory-v1"])


class CollectionCreate(BaseModel):
    """记忆集合创建请求体。"""

    name: str = Field(..., min_length=1, description="集合名称")
    description: str | None = Field(default=None)
    embed_model: str | None = Field(default=None, description="向量模型")


class RecallRequest(BaseModel):
    """记忆检索请求体。"""

    query: str = Field(..., min_length=1, description="检索查询")
    collection: str | None = Field(default=None, description="指定集合")
    top_k: int = Field(default=5, ge=1, le=50, description="返回条数")
    min_score: float = Field(default=0.0, ge=0.0, le=1.0, description="最低相似度")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat() + "Z"


@router.get("/collections")
async def list_collections(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    """列出记忆集合（stub 返回空列表）。"""
    return {"items": [], "total": 0, "limit": limit, "offset": offset}


@router.post("/collections")
async def create_collection(payload: CollectionCreate) -> dict[str, Any]:
    """创建记忆集合（stub 返回占位对象）。"""
    return {
        "id": f"col_stub_{int(datetime.now(timezone.utc).timestamp())}",
        "name": payload.name,
        "description": payload.description,
        "embed_model": payload.embed_model,
        "created_at": _now(),
        "status": "stub",
    }


@router.post("/recall")
async def recall(payload: RecallRequest) -> dict[str, Any]:
    """记忆检索（stub 返回空结果）。"""
    return {
        "query": payload.query,
        "collection": payload.collection,
        "items": [],
        "total": 0,
        "top_k": payload.top_k,
    }


@router.get("/health")
async def memory_health() -> dict[str, Any]:
    """记忆系统健康检查（stub 返回 healthy）。"""
    return {
        "status": "healthy",
        "collections": 0,
        "vectors": 0,
        "checked_at": _now(),
    }
