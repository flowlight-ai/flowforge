"""Memory API — 记忆集合与检索（真实实现）。

对应设计文档 §10.2：
    - ``GET  /api/v1/memory/collections``  — 记忆集合列表
    - ``POST /api/v1/memory/collections``  — 创建记忆集合
    - ``POST /api/v1/memory/recall``       — 记忆检索
    - ``GET  /api/v1/memory/health``       — 记忆健康检查

数据源（真实）：
    - ``data/flowforge.db``          — 短期/长期/情景记忆（MemoryManager）
    - ``data/flowforge_semantic.db`` — 语义记忆（FTS5）

注意：与现有 flowforge/app/api/endpoints/memory.py 共享 /memory 前缀，
但本文件仅定义 /collections /recall /health 子路径，不与
现有 /memory/{memory_id} 路由冲突。注册时需在现有 router 之前注册
以确保静态路径优先匹配。
"""

from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

router = APIRouter(prefix="/memory", tags=["memory-v1"])

_ROOT = Path(__file__).resolve().parents[3]
_LOCK = threading.Lock()

# 内置集合定义（与记忆存储一一对应）
_BUILTIN_COLLECTIONS = [
    {
        "id": "semantic",
        "displayName": "语义记忆",
        "kind": "semantic",
        "sensitivity": "internal",
        "db": "data/flowforge_semantic.db",
        "table": "semantic_entries",
        "count_sql": "SELECT COUNT(*) FROM semantic_entries",
        "updated_sql": "SELECT MAX(created_at) FROM semantic_entries",
    },
    {
        "id": "short_term",
        "displayName": "短期记忆",
        "kind": "kv",
        "sensitivity": "internal",
        "db": "data/flowforge.db",
        "table": "short_mem",
        "count_sql": "SELECT COUNT(*) FROM short_mem",
        "updated_sql": None,
    },
    {
        "id": "long_term",
        "displayName": "长期记忆",
        "kind": "kv",
        "sensitivity": "internal",
        "db": "data/flowforge.db",
        "table": "long_mem",
        "count_sql": "SELECT COUNT(*) FROM long_mem",
        "updated_sql": None,
    },
    {
        "id": "episodic",
        "displayName": "情景记忆",
        "kind": "episodic",
        "sensitivity": "private",
        "db": "data/flowforge.db",
        "table": "episodes",
        "count_sql": "SELECT COUNT(*) FROM episodes",
        "updated_sql": "SELECT MAX(created_at) FROM episodes",
    },
]


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
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _extra_collections_path() -> Path:
    return _ROOT / "data" / "settings" / "memory_collections.json"


def _load_extra_collections() -> list[dict[str, Any]]:
    path = _extra_collections_path()
    if not path.exists():
        return []
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []


def _save_extra_collections(items: list[dict[str, Any]]) -> None:
    path = _extra_collections_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def _query_int(db: str, sql: str) -> int:
    path = _ROOT / db
    if not path.exists():
        return 0
    try:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        try:
            row = conn.execute(sql).fetchone()
            return int(row[0] or 0) if row else 0
        finally:
            conn.close()
    except sqlite3.Error:
        return 0


def _query_value(db: str, sql: str) -> str | None:
    path = _ROOT / db
    if not path.exists():
        return None
    try:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        try:
            row = conn.execute(sql).fetchone()
            return str(row[0]) if row and row[0] else None
        finally:
            conn.close()
    except sqlite3.Error:
        return None


def _builtin_collection_items() -> list[dict[str, Any]]:
    items = []
    for col in _BUILTIN_COLLECTIONS:
        doc_count = _query_int(col["db"], col["count_sql"])
        updated_at = None
        if col.get("updated_sql"):
            updated_at = _query_value(col["db"], col["updated_sql"])
        items.append({
            "id": col["id"],
            "displayName": col["displayName"],
            "kind": col["kind"],
            "sensitivity": col["sensitivity"],
            "status": "active" if doc_count > 0 else "registered",
            "docCount": doc_count,
            "pendingReviewCount": 0,
            "updatedAt": updated_at or None,
        })
    return items


@router.get("/collections")
async def list_collections(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    """列出记忆集合（真实统计文档数）。"""
    items = _builtin_collection_items()
    items.extend(_load_extra_collections())
    total = len(items)
    items = items[offset:offset + limit]
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.post("/collections")
async def create_collection(payload: CollectionCreate) -> dict[str, Any]:
    """创建记忆集合（持久化到附加集合存储）。"""
    with _LOCK:
        extra = _load_extra_collections()
        if any(c["name"] == payload.name for c in extra):
            raise HTTPException(status_code=409, detail=f"Collection '{payload.name}' already exists")
        created = {
            "id": f"col_{uuid.uuid4().hex[:12]}",
            "name": payload.name,
            "displayName": payload.name,
            "description": payload.description,
            "kind": "custom",
            "embed_model": payload.embed_model or "default",
            "sensitivity": "internal",
            "status": "registered",
            "docCount": 0,
            "pendingReviewCount": 0,
            "created_at": _now(),
        }
        extra.append(created)
        _save_extra_collections(extra)
    return created


@router.post("/recall")
async def recall(payload: RecallRequest) -> dict[str, Any]:
    """记忆检索（语义 FTS + 短/长期记忆 LIKE 匹配，真实数据）。"""
    query = payload.query.strip()
    if not query:
        return {"query": payload.query, "collection": payload.collection, "items": [], "total": 0, "top_k": payload.top_k}

    items: list[dict[str, Any]] = []
    collections = [payload.collection] if payload.collection else [c["id"] for c in _BUILTIN_COLLECTIONS]

    # 语义记忆：FTS5 全文检索
    if "semantic" in collections:
        sem_path = _ROOT / "data" / "flowforge_semantic.db"
        if sem_path.exists():
            try:
                conn = sqlite3.connect(f"file:{sem_path}?mode=ro", uri=True)
                try:
                    fts_query = " ".join(f'"{w}"' for w in query.split()[:6])
                    rows = conn.execute(
                        "SELECT id, key, value, metadata, created_at FROM semantic_entries "
                        "WHERE id IN (SELECT rowid FROM semantic_fts WHERE semantic_fts MATCH ?) "
                        "ORDER BY rank LIMIT ?",
                        (fts_query, payload.top_k),
                    ).fetchall()
                    for row in rows:
                        items.append({
                            "id": row[0],
                            "collection": "semantic",
                            "key": row[1],
                            "value": row[2],
                            "metadata": json.loads(row[3]) if row[3] else {},
                            "score": 0.9,
                            "createdAt": row[4],
                        })
                finally:
                    conn.close()
            except sqlite3.Error:
                pass

    # 短/长期记忆：LIKE 模糊匹配
    if len(items) < payload.top_k:
        for col_id in ("short_term", "long_term"):
            if col_id not in collections:
                continue
            db_path = _ROOT / "data" / "flowforge.db"
            if not db_path.exists():
                continue
            table = "short_mem" if col_id == "short_term" else "long_mem"
            try:
                conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
                try:
                    like = f"%{query}%"
                    rows = conn.execute(
                        f"SELECT key, value FROM {table} WHERE value LIKE ? OR key LIKE ? LIMIT ?",
                        (like, like, payload.top_k - len(items)),
                    ).fetchall()
                    for row in rows:
                        items.append({
                            "id": f"{col_id}:{row[0]}",
                            "collection": col_id,
                            "key": row[0],
                            "value": row[1],
                            "metadata": {},
                            "score": 0.7,
                            "createdAt": None,
                        })
                finally:
                    conn.close()
            except sqlite3.Error:
                pass

    return {
        "query": payload.query,
        "collection": payload.collection,
        "items": items[: payload.top_k],
        "total": len(items),
        "top_k": payload.top_k,
    }


@router.get("/health")
async def memory_health() -> dict[str, Any]:
    """记忆系统健康检查（真实统计）。"""
    semantic_count = _query_int("data/flowforge_semantic.db", "SELECT COUNT(*) FROM semantic_entries")
    short_count = _query_int("data/flowforge.db", "SELECT COUNT(*) FROM short_mem")
    long_count = _query_int("data/flowforge.db", "SELECT COUNT(*) FROM long_mem")
    episode_count = _query_int("data/flowforge.db", "SELECT COUNT(*) FROM episodes")
    total = semantic_count + short_count + long_count + episode_count
    return {
        "status": "healthy",
        "collections": len(_BUILTIN_COLLECTIONS) + len(_load_extra_collections()),
        "vectors": semantic_count,
        "entries": total,
        "breakdown": {
            "semantic": semantic_count,
            "short_term": short_count,
            "long_term": long_count,
            "episodic": episode_count,
        },
        "checked_at": _now(),
    }
