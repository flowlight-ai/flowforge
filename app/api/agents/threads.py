"""Threads API — 线程管理（Web Fusion Phase 8 stub）.

对应设计文档 §10.2：
    - ``GET  /api/v1/threads``                    — 线程列表
    - ``POST /api/v1/threads``                    — 创建线程
    - ``GET  /api/v1/threads/{id}``               — 线程详情
    - ``DELETE /api/v1/threads/{id}``             — 删除线程
    - ``GET  /api/v1/threads/{id}/messages``      — 线程消息
    - ``GET  /api/v1/threads/{id}/forgekins``     — 线程Forgekin配置
    - ``PUT  /api/v1/threads/{id}/forgekins``     — 更新线程Forgekin配置
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

router = APIRouter(prefix="/threads", tags=["threads"])


class ThreadCreate(BaseModel):
    """线程创建请求体。"""

    title: str = Field(..., min_length=1, description="线程标题")
    forgekin_ids: list[str] = Field(default_factory=list, description="参与Forgekin列表")
    metadata: dict[str, Any] = Field(default_factory=dict, description="元数据")


class ThreadForgekinsUpdate(BaseModel):
    """线程Forgekin配置更新请求体。"""

    forgekin_ids: list[str] = Field(default_factory=list)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat() + "Z"


@router.get("")
async def list_threads(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    """列出所有线程（stub 返回空列表）。"""
    return {"items": [], "total": 0, "limit": limit, "offset": offset}


@router.post("")
async def create_thread(payload: ThreadCreate) -> dict[str, Any]:
    """创建线程（stub 返回占位对象）。"""
    return {
        "id": f"thread_stub_{int(datetime.now(timezone.utc).timestamp())}",
        "title": payload.title,
        "forgekin_ids": payload.forgekin_ids,
        "metadata": payload.metadata,
        "created_at": _now(),
        "status": "stub",
    }


@router.get("/{thread_id}")
async def get_thread(thread_id: str) -> dict[str, Any]:
    """获取线程详情（stub 返回占位对象）。"""
    return {
        "id": thread_id,
        "title": "",
        "forgekin_ids": [],
        "metadata": {},
        "created_at": _now(),
        "status": "stub",
    }


@router.delete("/{thread_id}")
async def delete_thread(thread_id: str) -> dict[str, Any]:
    """删除线程（stub 返回确认）。"""
    return {"id": thread_id, "deleted": True, "status": "stub"}


@router.get("/{thread_id}/messages")
async def list_thread_messages(
    thread_id: str,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    """获取线程消息（stub 返回空列表）。"""
    return {
        "thread_id": thread_id,
        "items": [],
        "total": 0,
        "limit": limit,
        "offset": offset,
    }


@router.get("/{thread_id}/forgekins")
async def get_thread_forgekins(thread_id: str) -> dict[str, Any]:
    """获取线程关联的Forgekin列表（stub 返回空列表）。"""
    return {"thread_id": thread_id, "forgekin_ids": [], "status": "stub"}


@router.put("/{thread_id}/forgekins")
async def update_thread_forgekins(
    thread_id: str, payload: ThreadForgekinsUpdate
) -> dict[str, Any]:
    """更新线程关联的Forgekin列表（stub 返回确认）。"""
    return {
        "thread_id": thread_id,
        "forgekin_ids": payload.forgekin_ids,
        "updated": True,
        "status": "stub",
    }
