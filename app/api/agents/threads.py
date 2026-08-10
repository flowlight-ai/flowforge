"""Threads API — 会话管理（群聊会话 CRUD + 消息持久化）.

参考 clowder-ai ThreadStore/MessageStore 设计，使用 JSON 文件持久化。

端点：
    - ``GET    /api/v1/threads``                    — 会话列表
    - ``POST   /api/v1/threads``                    — 新建会话
    - ``GET    /api/v1/threads/{id}``               — 会话详情
    - ``PATCH  /api/v1/threads/{id}``               — 更新会话（标题/置顶）
    - ``DELETE /api/v1/threads/{id}``               — 软删除会话
    - ``GET    /api/v1/threads/{id}/messages``      — 会话消息历史
    - ``POST   /api/v1/threads/{id}/messages``      — 追加消息
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from flowforge.app.api.agents.thread_store import get_thread_store

router = APIRouter(prefix="/threads", tags=["threads"])


# ── 请求模型 ────────────────────────────────────────────────────


class ThreadCreate(BaseModel):
    """会话创建请求体。"""

    title: str | None = Field(default=None, description="会话标题（可选，默认'未命名讨论'）")


class ThreadUpdate(BaseModel):
    """会话更新请求体。"""

    title: str | None = Field(default=None, description="新标题")
    pinned: bool | None = Field(default=None, description="置顶状态")


class MessageCreate(BaseModel):
    """消息追加请求体。"""

    source: str = Field(default="user", description="消息来源：user/forgekin/system")
    content: str = Field(..., description="消息内容")
    timestamp: int | None = Field(default=None, description="毫秒时间戳")
    forgekin_id: str | None = Field(default=None, description="灵智体ID")
    forgekin_name: str | None = Field(default=None, description="灵智体名称")
    forgekin_role: str | None = Field(default=None, description="灵智体角色")
    meta: dict[str, Any] = Field(default_factory=dict, description="元数据")


class MessageBatchCreate(BaseModel):
    """批量消息追加请求体。"""

    messages: list[MessageCreate] = Field(..., description="消息列表")


# ── 会话端点 ────────────────────────────────────────────────────


@router.get("")
async def list_threads(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    """列出所有会话（排除已删除，置顶优先，按更新时间降序）。"""
    store = get_thread_store()
    threads = store.list_threads(include_deleted=False)
    total = len(threads)
    items = threads[offset : offset + limit]
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.post("")
async def create_thread(payload: ThreadCreate) -> dict[str, Any]:
    """新建会话。"""
    store = get_thread_store()
    thread = store.create_thread(title=payload.title)
    return thread


@router.get("/{thread_id}")
async def get_thread(thread_id: str) -> dict[str, Any]:
    """获取会话详情。"""
    store = get_thread_store()
    thread = store.get_thread(thread_id)
    if thread is None:
        raise HTTPException(status_code=404, detail=f"会话 {thread_id} 不存在")
    if thread.get("deleted_at"):
        raise HTTPException(status_code=404, detail=f"会话 {thread_id} 已删除")
    return thread


@router.patch("/{thread_id}")
async def update_thread(thread_id: str, payload: ThreadUpdate) -> dict[str, Any]:
    """更新会话（标题/置顶）。"""
    store = get_thread_store()
    thread = store.update_thread(
        thread_id, title=payload.title, pinned=payload.pinned
    )
    if thread is None:
        raise HTTPException(status_code=404, detail=f"会话 {thread_id} 不存在")
    return thread


@router.delete("/{thread_id}")
async def delete_thread(thread_id: str) -> dict[str, Any]:
    """软删除会话。"""
    store = get_thread_store()
    ok = store.delete_thread(thread_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"会话 {thread_id} 不存在")
    return {"id": thread_id, "deleted": True}


# ── 消息端点 ────────────────────────────────────────────────────


@router.get("/{thread_id}/messages")
async def list_thread_messages(
    thread_id: str,
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    """获取会话消息历史。"""
    store = get_thread_store()
    thread = store.get_thread(thread_id)
    if thread is None:
        raise HTTPException(status_code=404, detail=f"会话 {thread_id} 不存在")
    msgs = store.list_messages(thread_id, limit=limit, offset=offset)
    total = store.count_messages(thread_id)
    return {"thread_id": thread_id, "items": msgs, "total": total, "limit": limit, "offset": offset}


@router.post("/{thread_id}/messages")
async def append_message(thread_id: str, payload: MessageCreate) -> dict[str, Any]:
    """追加单条消息到会话。"""
    store = get_thread_store()
    thread = store.get_thread(thread_id)
    if thread is None:
        raise HTTPException(status_code=404, detail=f"会话 {thread_id} 不存在")
    msg = store.append_message(thread_id, payload.model_dump())
    return msg


@router.post("/{thread_id}/messages/batch")
async def append_messages(thread_id: str, payload: MessageBatchCreate) -> dict[str, Any]:
    """批量追加消息到会话（灵议响应后持久化用）。"""
    store = get_thread_store()
    thread = store.get_thread(thread_id)
    if thread is None:
        raise HTTPException(status_code=404, detail=f"会话 {thread_id} 不存在")
    msgs = store.append_messages(
        thread_id, [m.model_dump() for m in payload.messages]
    )
    return {"thread_id": thread_id, "appended": len(msgs), "items": msgs}


@router.delete("/{thread_id}/messages")
async def clear_thread_messages(thread_id: str) -> dict[str, Any]:
    """清空会话所有消息（保留会话本身）。"""
    store = get_thread_store()
    thread = store.get_thread(thread_id)
    if thread is None:
        raise HTTPException(status_code=404, detail=f"会话 {thread_id} 不存在")
    cleared = store.clear_messages(thread_id)
    return {"thread_id": thread_id, "cleared": cleared}
