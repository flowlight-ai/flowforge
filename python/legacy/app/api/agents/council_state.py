"""Forgekin Council — data models, in-memory state, and broadcast helper.

Extracted from the original monolithic ``council.py`` so that the router
file stays a thin endpoint layer (app should only contain endpoint
interface wrappers, not implementation code — see workspace rule
"app中只有端点接口封装，不应有实现代码").

This module is intentionally dependency-free w.r.t. sibling ``council_*``
modules to avoid circular imports: it only depends on the stdlib, FastAPI
(for ``WebSocket``), and ``flowforge.core.tracing`` / ``flowforge.llm``.

Public surface:
- :class:`LLMMeta`, :class:`T7Badge`, :class:`ChatMessage`, :class:`ChatState`,
  :class:`Task` — dataclasses used by the router and services.
- ``state`` — module-level :class:`ChatState` singleton.
- ``tasks_store`` — module-level task registry.
- ``forgekins_holder`` / ``bridge_holder`` — mutable singletons lazily
  populated by helpers (:func:`_get_forgekins` / :func:`_get_bridge`).
- :func:`_broadcast` — push a new message to all WebSocket subscribers.
- :func:`_now_iso` — ISO-8601 UTC timestamp (used by dataclass defaults).
"""

from __future__ import annotations

import json
import uuid
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from typing import Any

from fastapi import WebSocket

from flowforge.core.tracing import get_logger
from flowforge.llm.council_bridge import ForgekinLLMBridge

logger = get_logger("flowforge.app.api.agents.council_state")


# ── Time helper (defined here, not in council_helpers, because the
#    dataclass field defaults below evaluate it at class-definition time;
#    importing it from helpers would create a circular dependency since
#    helpers imports ``state``/``ChatMessage`` from this module). ────────

def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


# ── Data structures ──────────────────────────────────────────────────────────

@dataclass
class LLMMeta:
    """LLM call metadata attached to every forgekin message.

    Presence of this field on a forgekin message is the proof that the
    message came from a real LLM call (T1) and was audited (T7).
    """

    model: str
    provider: str
    latency_ms: float
    finish_reason: str
    chain: str  # fallback chain name, e.g. "content_create"


@dataclass
class T7Badge:
    """T7 audit result attached to primary forgekin messages."""

    score: float
    verdict: str  # "pass" | "fail"
    reasons: list[str]
    model: str
    provider: str
    latency_ms: float
    quality_threshold: float
    chain: str = "t7_audit"  # I9: audit chain differs from primary chain


@dataclass
class ChatMessage:
    """One chat message in the council channel.

    llm_meta is None for operator messages and forgekin greeting messages
    (greetings are static config strings, not LLM output). For every
    forgekin response generated via LLM, llm_meta is populated.
    t7_badge is None for non-primary forgekin messages and for primary
    messages whose T7 audit hasn't completed yet.
    """

    message_id: str
    author_id: str  # "operator" or forgekin_id
    author_name: str
    author_role: str  # "operator" | "forgekin"
    author_avatar: str
    content: str
    timestamp: str = field(default_factory=_now_iso)
    mentions: list[str] = field(default_factory=list)
    trace_id: str = field(default_factory=lambda: f"trace-{uuid.uuid4().hex[:8]}")
    role: str = ""  # council role for this turn: primary | reviewer | tester
    llm_meta: LLMMeta | None = None
    t7_badge: T7Badge | None = None


@dataclass
class ChatState:
    """In-memory chat state for the council channel.

    I11 不变量：push back 协议（最多 3 轮，3 轮后升级 operator）.
    多轮上下文保持：通过 messages 列表维护完整对话历史.
    """

    messages: list[ChatMessage] = field(default_factory=list)
    subscribers: set[WebSocket] = field(default_factory=set)
    push_back_rounds: int = 0
    push_back_max_rounds: int = 3  # I11 不变量
    push_back_topic: str = ""
    escalated_to_operator: bool = False

    def add(self, msg: ChatMessage) -> None:
        self.messages.append(msg)
        if len(self.messages) > 500:
            self.messages = self.messages[-500:]

    def reset_push_back(self) -> None:
        self.push_back_rounds = 0
        self.push_back_topic = ""
        self.escalated_to_operator = False

    def get_context(self, limit: int = 10) -> list[ChatMessage]:
        if limit <= 0:
            return list(self.messages)
        return list(self.messages[-limit:])


# ── Task management (in-memory, MVP) ─────────────────────────────────────────

@dataclass
class Task:
    """A unit of work tracked by the operator.

    Stored in-memory for the MVP. A real deployment would persist this via
    a Repository (铁律 4), but the web chat layer is intentionally stateless
    beyond the process lifetime.
    """

    task_id: str
    intent: str
    persona: str  # doc | code | framework | test | review
    status: str = "pending"  # pending | running | completed | failed | cancelled
    input_data: dict = field(default_factory=dict)
    result: dict = field(default_factory=dict)
    created_at: str = field(default_factory=_now_iso)
    updated_at: str = field(default_factory=_now_iso)
    assigned_forgekin: str = ""
    events: list[dict] = field(default_factory=list)

    def touch(self) -> None:
        self.updated_at = _now_iso()

    def add_event(self, event_type: str, detail: str = "") -> None:
        self.events.append({
            "type": event_type,
            "detail": detail,
            "timestamp": _now_iso(),
        })
        self.touch()


# ── Module-level state (lazy-initialized on first request) ───────────────────
# These mirror the closure-captured state in create_app(). Lazy init avoids
# import-time failures when config/llm_route.yaml or forgekin YAMLs are missing.

state: ChatState = ChatState()
tasks_store: dict[str, Task] = {}

# Holders are mutable containers so cross-module mutation works without the
# ``global`` keyword (which is module-scoped and cannot rebind a name in
# another module). ``_get_forgekins`` / ``_get_bridge`` in council_helpers
# populate these on first call.
forgekins_holder: dict[str, Any] = {"cfg": None}
bridge_holder: dict[str, ForgekinLLMBridge] = {}


# ── Broadcast helper ────────────────────────────────────────────────────────

async def _broadcast(chat_state: ChatState, msg: ChatMessage) -> None:
    """Broadcast a new message to all WebSocket subscribers.

    Logs each subscriber's send outcome (success/failure) so connection
    or data sync issues can be diagnosed from the server log alone.
    """
    if not chat_state.subscribers:
        logger.info(
            f"[ws] BROADCAST SKIP: msg_id={msg.message_id} author={msg.author_name} "
            f"reason=no_subscribers"
        )
        return
    payload = json.dumps({"type": "new_message", "message": asdict(msg)})
    payload_size = len(payload)
    subscriber_count = len(chat_state.subscribers)
    logger.info(
        f"[ws] BROADCAST START: msg_id={msg.message_id} author={msg.author_name} "
        f"role={msg.role} subscribers={subscriber_count} payload_bytes={payload_size}"
    )
    dead: list[WebSocket] = []
    success_count = 0
    fail_count = 0
    for ws in chat_state.subscribers:
        ws_id = f"ws-{id(ws):x}"
        client_host = ws.client.host if ws.client else "unknown"
        try:
            await ws.send_text(payload)
            success_count += 1
            logger.info(
                f"[ws] BROADCAST OK: id={ws_id} client={client_host} "
                f"msg_id={msg.message_id}"
            )
        except Exception as exc:  # noqa: BLE001
            fail_count += 1
            logger.warning(
                f"[ws] BROADCAST FAIL: id={ws_id} client={client_host} "
                f"msg_id={msg.message_id} error={exc!r}"
            )
            dead.append(ws)
    for ws in dead:
        chat_state.subscribers.discard(ws)
    logger.info(
        f"[ws] BROADCAST DONE: msg_id={msg.message_id} "
        f"success={success_count}/{subscriber_count} failed={fail_count} "
        f"remaining_subscribers={len(chat_state.subscribers)}"
    )
