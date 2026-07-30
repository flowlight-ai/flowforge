"""Forgekin Council API — 群聊消息与灵智体协作.

对应设计文档 §10.2：
    - ``POST /api/v1/forgekins/council/chat``       — 发送群聊消息（触发灵智体响应）
    - ``GET  /api/v1/forgekins/council/messages``   — 群聊消息历史
    - ``GET  /api/v1/forgekins/council/participants`` — 群聊参与者列表

群聊机制：
    1. 用户发送消息到群聊
    2. 如果消息中 @mention 了某个灵智体（如 @鲁班），触发该灵智体响应
    3. 如果未指定灵智体，消息仅存储（用户发言）
    4. 灵智体响应异步执行，响应也存储到消息历史
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger
from flowforge.forgemind.forgekins import BUILTIN_FORGEKINS, list_builtin_forgekins

logger = get_logger("api.v1.forgekins_council")

router = APIRouter(prefix="/forgekins/council", tags=["forgekins-council"])


# ── 内存消息存储（进程内单例）──────────────────────────────────

class _CouncilMessageStore:
    """群聊消息内存存储（进程内单例）."""

    def __init__(self) -> None:
        self._messages: list[dict[str, Any]] = []

    def add(self, msg: dict[str, Any]) -> dict[str, Any]:
        """添加消息并返回."""
        self._messages.append(msg)
        # 保留最近 500 条
        if len(self._messages) > 500:
            self._messages = self._messages[-500:]
        return msg

    def list(self, limit: int = 50, offset: int = 0) -> list[dict[str, Any]]:
        """分页获取消息."""
        return self._messages[offset : offset + limit]

    @property
    def total(self) -> int:
        return len(self._messages)


_store = _CouncilMessageStore()


# ── 请求/响应模型 ──────────────────────────────────────────────

class CouncilChatRequest(BaseModel):
    """群聊发送请求体。"""
    content: str = Field(..., min_length=1, description="消息内容")
    forgekin_id: str | None = Field(default=None, description="指定发言灵智体（None=用户发言）")
    thread_id: str | None = Field(default=None, description="关联线程 ID")
    trigger_response: bool = Field(default=True, description="是否触发 @mention 灵智体响应")


class CouncilMessage(BaseModel):
    """群聊消息模型。"""
    id: str
    content: str
    sender: str = "user"  # user | forgekin_id
    sender_name: str = "User"
    sender_type: str = "user"  # user | forgekin
    thread_id: str | None = None
    created_at: str
    model: str | None = None
    usage: dict[str, Any] | None = None


# ── @mention 解析 ──────────────────────────────────────────────

def _parse_mentions(content: str) -> list[str]:
    """从消息内容中解析 @mention 的灵智体 ID.

    支持中文 @名 和英文 @id 两种格式。
    """
    mentioned: list[str] = []
    # 获取所有灵智体的 mention_patterns
    for fk_info in list_builtin_forgekins():
        fk_id = fk_info.get("id", "")
        patterns = fk_info.get("mention_patterns", [])
        for pattern in patterns:
            # pattern 格式如 "@鲁班" 或 "@luban"
            if pattern.lower() in content.lower():
                if fk_id not in mentioned:
                    mentioned.append(fk_id)
                break
    return mentioned


# ── Endpoints ──────────────────────────────────────────────────

@router.post("/chat")
async def send_council_chat(payload: CouncilChatRequest) -> dict[str, Any]:
    """发送群聊消息，如果 @mention 了灵智体则触发响应。"""
    now = datetime.now(timezone.utc).isoformat() + "Z"

    # 存储用户消息
    user_msg = {
        "id": f"msg_{uuid.uuid4().hex[:12]}",
        "content": payload.content,
        "sender": "user",
        "sender_name": "User",
        "sender_type": "user",
        "thread_id": payload.thread_id,
        "created_at": now,
    }
    _store.add(user_msg)

    # 如果是灵智体发言（forgekin_id 指定），直接存储
    if payload.forgekin_id and payload.forgekin_id != "user":
        if payload.forgekin_id not in BUILTIN_FORGEKINS:
            raise HTTPException(
                status_code=404,
                detail=f"未知灵智体 ID: {payload.forgekin_id}. 可用: {BUILTIN_FORGEKINS}",
            )
        forgekin_msg = {
            "id": f"msg_{uuid.uuid4().hex[:12]}",
            "content": payload.content,
            "sender": payload.forgekin_id,
            "sender_name": payload.forgekin_id,
            "sender_type": "forgekin",
            "thread_id": payload.thread_id,
            "created_at": now,
        }
        _store.add(forgekin_msg)
        return {"messages": [user_msg, forgekin_msg], "triggered": False}

    # 如果 trigger_response=True，解析 @mention 并触发灵智体响应
    responses: list[dict[str, Any]] = []
    if payload.trigger_response:
        mentioned_ids = _parse_mentions(payload.content)
        for fk_id in mentioned_ids:
            try:
                resp = await _trigger_forgekin_response(fk_id, payload.content)
                if resp:
                    _store.add(resp)
                    responses.append(resp)
            except Exception as exc:
                logger.warning(f"灵智体 {fk_id} 响应失败: {exc}")
                error_msg = {
                    "id": f"msg_{uuid.uuid4().hex[:12]}",
                    "content": f"[响应失败] {exc}",
                    "sender": fk_id,
                    "sender_name": fk_id,
                    "sender_type": "forgekin",
                    "thread_id": payload.thread_id,
                    "created_at": datetime.now(timezone.utc).isoformat() + "Z",
                    "error": True,
                }
                _store.add(error_msg)
                responses.append(error_msg)

    return {
        "messages": [user_msg] + responses,
        "triggered": len(responses) > 0,
        "triggered_forgekins": [r.get("sender") for r in responses],
    }


async def _trigger_forgekin_response(forgekin_id: str, user_message: str) -> dict[str, Any] | None:
    """触发灵智体响应群聊消息."""
    from flowforge.app.api.agents.forgemind import _registry

    forgekin = _registry.get(forgekin_id)
    if forgekin is None:
        # 自动锻造
        from flowforge.forgemind.forgekins.roster import ROSTER_FILES
        pipeline = await _registry.get_pipeline()
        trae_client = await _registry.get_trae_client()
        yaml_path = ROSTER_FILES[forgekin_id]
        try:
            forgekin = await pipeline.forge_from_yaml(yaml_path, llm_client=trae_client)
            _registry.register(forgekin)
        except Exception as exc:
            logger.error(f"自动锻造灵智体 {forgekin_id} 失败: {exc}")
            return None

    # 调用灵智体 chat
    messages = [{"role": "user", "content": user_message}]
    result = await forgekin.chat(messages, session_id=f"council_{forgekin_id}")

    return {
        "id": f"msg_{uuid.uuid4().hex[:12]}",
        "content": result.get("content", ""),
        "sender": forgekin_id,
        "sender_name": forgekin.name,
        "sender_type": "forgekin",
        "created_at": datetime.now(timezone.utc).isoformat() + "Z",
        "model": result.get("model", "unknown"),
        "usage": result.get("usage", {}),
    }


@router.get("/messages")
async def list_council_messages(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    """获取群聊消息历史。"""
    items = _store.list(limit=limit, offset=offset)
    return {
        "items": items,
        "total": _store.total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/participants")
async def list_participants() -> dict[str, Any]:
    """列出群聊可参与的灵智体列表。"""
    return {
        "participants": list_builtin_forgekins(),
        "total": len(BUILTIN_FORGEKINS),
    }
