"""Threads API — 会话管理（群聊会话 CRUD + 消息持久化）.

参考 clowder-ai ThreadStore/MessageStore 设计，使用 JSON 文件持久化。

端点：
    - ``GET    /api/v1/threads``                       — 会话列表
    - ``POST   /api/v1/threads``                       — 新建会话
    - ``GET    /api/v1/threads/trash``                 — 回收站（已删除会话）
    - ``GET    /api/v1/threads/{id}``                  — 会话详情
    - ``PATCH  /api/v1/threads/{id}``                  — 更新会话（标题/置顶）
    - ``DELETE /api/v1/threads/{id}``                  — 软删除会话
    - ``POST   /api/v1/threads/{id}/restore``          — 恢复软删除会话
    - ``GET    /api/v1/threads/{id}/messages``         — 会话消息历史（分页）
    - ``POST   /api/v1/threads/{id}/messages``         — 追加消息
    - ``POST   /api/v1/threads/{id}/messages/batch``   — 批量追加消息
    - ``DELETE /api/v1/threads/{id}/messages``         — 清空所有消息
    - ``PATCH  /api/v1/threads/{id}/messages/{msg_id}``— 编辑消息
    - ``DELETE /api/v1/threads/{id}/messages/{msg_id}``— 软删除单条消息
    - ``POST   /api/v1/threads/{id}/messages/{msg_id}/restore`` — 恢复消息
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from flowforge.app.api.agents.thread_store import get_thread_store
from flowforge.app.api.core.logs import get_audit_logger
from flowforge.app.api.agents.signals import ingest_signal
from flowforge.core.tracing import get_logger

router = APIRouter(prefix="/threads", tags=["threads"])


def _audit_message(thread_id: str, msg: dict[str, Any]) -> None:
    """群聊消息审计：写入 audit_logs + 注入信号（供 signals/能力画像消费）。"""
    source = msg.get("source") or "user"
    content = msg.get("content") or ""
    try:
        get_audit_logger().log(
            "info",
            "council.message_sent",
            task_id=thread_id,
            mode="council",
            details={
                "source": source,
                "content_len": len(content),
                "forgekin": msg.get("forgekin_name"),
                "thread_id": thread_id,
            },
        )
    except Exception as e:  # noqa: BLE001 — 审计失败不影响消息写入
        logger = get_logger("threads_audit")
        logger.warning(f"audit log failed: {e}")
    try:
        ingest_signal(
            source_id="council",
            source_name="群聊会话",
            title=f"群聊消息 · {msg.get('forgekin_name') or source}",
            summary=(content[:120] + ("…" if len(content) > 120 else "")),
            severity="info",
            strength=0.5,
            anchor=f"thread:{thread_id}",
            tags=["council", source],
        )
    except Exception as e:  # noqa: BLE001 — 信号注入失败不影响消息写入
        logger = get_logger("threads_signal")
        logger.warning(f"signal ingest failed: {e}")


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


class MessageEdit(BaseModel):
    """消息编辑请求体。"""

    content: str = Field(..., description="新内容")


# ── 会话端点 ────────────────────────────────────────────────────


@router.get("")
async def list_threads(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    q: str | None = Query(None, description="标题搜索关键字（子串匹配，大小写不敏感）"),
    date_from: str | None = Query(None, description="更新时间起（ISO 格式，含）"),
    date_to: str | None = Query(None, description="更新时间止（ISO 格式，含）"),
) -> dict[str, Any]:
    """列出所有会话（排除已删除，置顶优先，按更新时间降序）。

    支持分页（limit/offset）、标题搜索（q）与更新时间范围过滤
    （date_from/date_to）— P-106。
    """
    store = get_thread_store()
    threads = store.list_threads(include_deleted=False)
    if q:
        ql = q.lower()
        threads = [t for t in threads if ql in (t.get("title") or "").lower()]
    if date_from:
        threads = [t for t in threads if (t.get("updated_at") or "") >= date_from]
    if date_to:
        threads = [t for t in threads if (t.get("updated_at") or "") <= date_to]
    total = len(threads)
    items = threads[offset : offset + limit]
    return {"items": items, "total": total, "limit": limit, "offset": offset, "q": q}


@router.post("")
async def create_thread(payload: ThreadCreate) -> dict[str, Any]:
    """新建会话。"""
    store = get_thread_store()
    thread = store.create_thread(title=payload.title)
    return thread


@router.get("/trash")
async def list_trash_threads() -> dict[str, Any]:
    """列出回收站中的已删除会话。"""
    store = get_thread_store()
    deleted = store.list_deleted_threads()
    return {"items": deleted, "total": len(deleted)}


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
    """软删除会话（移入回收站，可恢复）。"""
    store = get_thread_store()
    ok = store.delete_thread(thread_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"会话 {thread_id} 不存在")
    return {"id": thread_id, "deleted": True}


@router.post("/{thread_id}/restore")
async def restore_thread(thread_id: str) -> dict[str, Any]:
    """从回收站恢复会话。"""
    store = get_thread_store()
    thread = store.restore_thread(thread_id)
    if thread is None:
        raise HTTPException(status_code=404, detail=f"会话 {thread_id} 不存在或未删除")
    return thread


# ── 消息端点 ────────────────────────────────────────────────────


@router.get("/{thread_id}/messages")
async def list_thread_messages(
    thread_id: str,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    """获取会话消息历史（分页，默认排除软删除消息）。"""
    store = get_thread_store()
    thread = store.get_thread(thread_id)
    if thread is None:
        raise HTTPException(status_code=404, detail=f"会话 {thread_id} 不存在")
    msgs = store.list_messages(thread_id, limit=limit, offset=offset, include_deleted=False)
    total = store.count_messages(thread_id, include_deleted=False)
    return {"thread_id": thread_id, "items": msgs, "total": total, "limit": limit, "offset": offset}


@router.post("/{thread_id}/messages")
async def append_message(thread_id: str, payload: MessageCreate) -> dict[str, Any]:
    """追加单条消息到会话（写审计日志 + 注入信号）。"""
    store = get_thread_store()
    thread = store.get_thread(thread_id)
    if thread is None:
        raise HTTPException(status_code=404, detail=f"会话 {thread_id} 不存在")
    msg = store.append_message(thread_id, payload.model_dump())
    _audit_message(thread_id, msg)
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
    for m in msgs:
        _audit_message(thread_id, m)
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


@router.patch("/{thread_id}/messages/{msg_id}")
async def edit_message(thread_id: str, msg_id: str, payload: MessageEdit) -> dict[str, Any]:
    """编辑单条消息内容。"""
    store = get_thread_store()
    thread = store.get_thread(thread_id)
    if thread is None:
        raise HTTPException(status_code=404, detail=f"会话 {thread_id} 不存在")
    msg = store.update_message(thread_id, msg_id, payload.content)
    if msg is None:
        raise HTTPException(status_code=404, detail=f"消息 {msg_id} 不存在")
    return msg


@router.delete("/{thread_id}/messages/{msg_id}")
async def delete_message(thread_id: str, msg_id: str) -> dict[str, Any]:
    """软删除单条消息（可恢复）。"""
    store = get_thread_store()
    thread = store.get_thread(thread_id)
    if thread is None:
        raise HTTPException(status_code=404, detail=f"会话 {thread_id} 不存在")
    ok = store.delete_message(thread_id, msg_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"消息 {msg_id} 不存在")
    return {"id": msg_id, "thread_id": thread_id, "deleted": True}


@router.post("/{thread_id}/messages/{msg_id}/restore")
async def restore_message(thread_id: str, msg_id: str) -> dict[str, Any]:
    """恢复软删除的单条消息。"""
    store = get_thread_store()
    thread = store.get_thread(thread_id)
    if thread is None:
        raise HTTPException(status_code=404, detail=f"会话 {thread_id} 不存在")
    msg = store.restore_message(thread_id, msg_id)
    if msg is None:
        raise HTTPException(status_code=404, detail=f"消息 {msg_id} 不存在或未删除")
    return msg
