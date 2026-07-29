"""Forgekin Council Chat API endpoints — modular router port.

Migrated from the legacy single-file `create_app()` into the modular
`app/api/endpoints/` structure, keeping the T7/T9/push_back/external-agent
advantages while adopting the modular layout.

Endpoints (prefix="/api/v1/forgemind/council"):
- GET  /agents                       → list 5 forgekins (id/name/vendor/avatar/online)
- GET  /agents/{fk_id}               → single forgekin profile
- GET  /messages                     → message history (newest N)
- POST /messages/clear               → clear messages + re-seed greetings
- POST /chat                         → send user message → real LLM forgekin responses
- WS   /api/v1/forgemind/council/ws  → real-time message stream (absolute path)
- GET  /bridge                       → LLM bridge status (providers/chains/threshold)
- GET  /context                      → multi-turn context + push back state
- POST /push_back                    → trigger push back protocol (I11)
- POST /push_back/reset              → reset push back state
- GET  /settings/llm                 → LLM route config (masked secrets)
- PUT  /settings/llm                 → update LLM provider config + hot-reload bridge
- POST /settings/llm/test            → test LLM connection with minimal completion
- GET  /settings/runtime             → runtime-tunable parameters
- PUT  /settings/runtime             → update runtime parameters (in-memory)
- GET  /tasks                        → list tasks (optionally filtered by status)
- POST /tasks                        → create task → dispatch to forgekin via bridge
- GET  /tasks/{task_id}              → single task state + events
- POST /tasks/{task_id}/cancel       → mark task as cancelled (best-effort)
- GET  /dashboard                    → dashboard data (forgekins/tasks/metrics/bridge)
- GET  /workflows                    → list workflow configs from config/workflows/
- GET  /workflows/{workflow_name}    → single workflow config detail
- GET  /council-metrics              → Prometheus metrics (renamed from /metrics)

All LLM work is delegated to :class:`flowforge.llm.council_bridge.ForgekinLLMBridge`,
which loads prompts from ``config/web_chat_prompts.yaml`` (铁律 5) and providers
from ``config/llm_route.yaml``. No prompt body or LLM call lives inline.

T1 — real LLM calls only (no mock).
T7 — primary forgekin responses are audited by a second LLM (different vendor, I9).
I11 — push back protocol (max 3 rounds, then escalate to operator).
T6 — metrics collected for every chat message, LLM call, and T7 audit.
"""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import Response

from flowforge.core.errors import LLMError
from flowforge.core.tracing import generate_trace_id, get_logger, get_trace_id, set_trace_id
from flowforge.forgemind.external_agents import ExternalAgentError, ExternalAgentKind
from flowforge.llm.council_bridge import ForgekinLLMBridge, ForgekinReply, T7AuditResult
from flowforge.web_legacy_backup.metrics import get_collector as _get_metrics_collector

logger = get_logger("flowforge.app.api.endpoints.council")

# ── Path constants ───────────────────────────────────────────────────────────
# endpoints/ → api/ → app/ → flowforge/  (project root = flowforge package)
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
CONFIG_DIR = PROJECT_ROOT / "config"
FORGEKINS_DIR = CONFIG_DIR / "forgekins"
WORKFLOWS_DIR = CONFIG_DIR / "workflows"

# ── Helper functions ─────────────────────────────────────────────────────────

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def _bool_env(name: str, default: bool = False) -> bool:
    val = os.environ.get(name, str(default))
    return val.strip().lower() in {"1", "true", "yes", "on"}

def _upsert_env_var(env_path: Path, key: str, value: str) -> None:
    """Insert or update a KEY=value line in a .env file (铁律 5 — secrets in .env).

    If the file doesn't exist, it's created. If the key already exists, the
    value is updated in place. Otherwise the new key is appended.
    """
    lines: list[str] = []
    found = False
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith(f"{key}=") or line.strip() == key:
                lines.append(f'{key}="{value}"')
                found = True
            else:
                lines.append(line)
    if not found:
        lines.append(f'{key}="{value}"')
    env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

def _load_yaml(path: Path) -> dict[str, Any]:
    """Load a YAML file into a dict (returns {} for missing files)."""
    if not path.exists():
        return {}
    with path.open(encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    return data if isinstance(data, dict) else {}

def _env(name: str, default: str = "") -> str:
    """Read an environment variable, stripping surrounding whitespace."""
    val = os.environ.get(name, default)
    return val.strip() if isinstance(val, str) else default

def _load_forgekins() -> dict[str, dict]:
    """Load 5 forgekin YAML configs from config/forgekins/."""
    forgekins: dict[str, dict] = {}
    for path in sorted(FORGEKINS_DIR.glob("*.yaml")):
        with path.open(encoding="utf-8") as f:
            cfg = yaml.safe_load(f)
        if cfg and "forgekin_id" in cfg:
            forgekins[path.stem] = cfg
    return forgekins

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

# ── Forgekin persona helpers ─────────────────────────────────────────────────

AVATARS = {
    "fk-wenxin": "📝",  # 文心 — doc
    "fk-sherlock": "🔍",  # 夏洛克 — code
    "fk-vangogh": "🎨",  # 梵高 — review
    "fk-davinci": "🧪",  # 达芬奇 — test
    "fk-luban": "🔨",  # 鲁班 — framework
    "operator": "👤",
}

_PERSONA_TO_FORGEKIN = {
    "doc": "fk-wenxin",
    "code": "fk-sherlock",
    "framework": "fk-luban",
    "test": "fk-davinci",
    "review": "fk-vangogh",
}

def _forgekin_profile(fk_cfg: dict) -> dict:
    """Extract UI-relevant fields from a forgekin config."""
    fk_id = fk_cfg["forgekin_id"]
    return {
        "id": fk_id,
        "name": fk_cfg["name"],
        "alias": fk_cfg.get("alias", ""),
        "vendor": fk_cfg["vendor"],
        "forgekin_type": fk_cfg["forgekin_type"],
        "avatar": AVATARS.get(fk_id, "🤖"),
        "loop_type": fk_cfg["self_dev_loop"]["loop_type"],
        "awakening_stage": fk_cfg["self_dev_loop"]["awakening_stage"],
        "online": True,
        "energy": fk_cfg.get("energy", {}).get("initial", 1.0),
        "greeting": fk_cfg.get("persona", {}).get("greeting", ""),
        "catchphrase": fk_cfg.get("persona", {}).get("catchphrase", ""),
        "working_style": fk_cfg.get("persona", {}).get("working_style", ""),
        "can_review": fk_cfg.get("council_role", {}).get("can_review", False),
        "requires_approval": fk_cfg.get("self_dev_loop", {}).get("requires_manual_approval", False),
        "capabilities": [c["name"] for c in fk_cfg.get("capabilities", [])],
    }

def _route_message(content: str, forgekins: dict[str, dict]) -> list[dict]:
    """Decide which forgekins respond, in what order, based on routing rules.

    Mirrors config/im_channels.yaml keyword routing. Returns a list of
    {forgekin_id, role, delay_ms} dicts.
    """
    content_lower = content.lower()
    routing: list[dict] = []

    if any(kw in content_lower for kw in ["doc", "文档", "spec", "readme", "文档审核"]):
        routing.append({"forgekin_id": "fk-wenxin", "role": "primary", "delay_ms": 200})
        routing.append({"forgekin_id": "fk-vangogh", "role": "reviewer", "delay_ms": 500})
        routing.append({"forgekin_id": "fk-davinci", "role": "reviewer", "delay_ms": 800})
    elif any(kw in content_lower for kw in ["code", "代码", "bug", "fix", "实现", "refactor"]):
        routing.append({"forgekin_id": "fk-sherlock", "role": "primary", "delay_ms": 200})
        routing.append({"forgekin_id": "fk-vangogh", "role": "reviewer", "delay_ms": 500})
        routing.append({"forgekin_id": "fk-davinci", "role": "tester", "delay_ms": 800})
    elif any(kw in content_lower for kw in ["framework", "框架", "架构", "core", "di"]):
        routing.append({"forgekin_id": "fk-luban", "role": "primary", "delay_ms": 200})
        routing.append({"forgekin_id": "fk-vangogh", "role": "reviewer", "delay_ms": 500})
        routing.append({"forgekin_id": "fk-wenxin", "role": "reviewer", "delay_ms": 800})
    elif any(kw in content_lower for kw in ["test", "测试", "pytest", "coverage", "t7", "t8"]):
        routing.append({"forgekin_id": "fk-davinci", "role": "primary", "delay_ms": 200})
        routing.append({"forgekin_id": "fk-sherlock", "role": "reviewer", "delay_ms": 500})
    elif any(kw in content_lower for kw in ["review", "审查", "审核", "approve", "merge"]):
        routing.append({"forgekin_id": "fk-vangogh", "role": "primary", "delay_ms": 200})
        routing.append({"forgekin_id": "fk-davinci", "role": "reviewer", "delay_ms": 500})
    else:
        # Default: 文心 responds (general coordination)
        routing.append({"forgekin_id": "fk-wenxin", "role": "primary", "delay_ms": 200})
        routing.append({"forgekin_id": "fk-vangogh", "role": "reviewer", "delay_ms": 500})

    return routing

def _find_forgekin_cfg(forgekins: dict[str, dict], fk_id: str) -> dict | None:
    for cfg in forgekins.values():
        if cfg.get("forgekin_id") == fk_id:
            return cfg
    return None

async def _broadcast(state: ChatState, msg: ChatMessage) -> None:
    """Broadcast a new message to all WebSocket subscribers.

    Logs each subscriber's send outcome (success/failure) so connection
    or data sync issues can be diagnosed from the server log alone.
    """
    if not state.subscribers:
        logger.info(
            f"[ws] BROADCAST SKIP: msg_id={msg.message_id} author={msg.author_name} "
            f"reason=no_subscribers"
        )
        return
    payload = json.dumps({"type": "new_message", "message": asdict(msg)})
    payload_size = len(payload)
    subscriber_count = len(state.subscribers)
    logger.info(
        f"[ws] BROADCAST START: msg_id={msg.message_id} author={msg.author_name} "
        f"role={msg.role} subscribers={subscriber_count} payload_bytes={payload_size}"
    )
    dead: list[WebSocket] = []
    success_count = 0
    fail_count = 0
    for ws in state.subscribers:
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
        state.subscribers.discard(ws)
    logger.info(
        f"[ws] BROADCAST DONE: msg_id={msg.message_id} "
        f"success={success_count}/{subscriber_count} failed={fail_count} "
        f"remaining_subscribers={len(state.subscribers)}"
    )

# ── Module-level state (lazy-initialized on first request) ───────────────────
# These mirror the closure-captured state in create_app(). Lazy init avoids
# import-time failures when config/llm_route.yaml or forgekin YAMLs are missing.

state: ChatState = ChatState()
tasks_store: dict[str, Task] = {}

# forgekins_cfg is loaded once on first access; greetings are seeded at that time.
forgekins_cfg: dict[str, dict] | None = None

# Mutable container so the bridge can be hot-reloaded from the settings page
# without restarting the process. ``bridge_holder["bridge"]`` is the single
# source of truth — every endpoint reads through _get_bridge().
bridge_holder: dict[str, ForgekinLLMBridge] = {}

def _get_forgekins() -> dict[str, dict]:
    """Lazily load forgekin configs and seed greetings on first call.

    On first invocation this loads config/forgekins/*.yaml and posts each
    forgekin's configured greeting to the channel. Subsequent calls return
    the cached dict. Greetings are static config strings (persona.greeting)
    and therefore carry no llm_meta — they are NOT LLM output (T1) and not
    subject to T7.
    """
    global forgekins_cfg
    if forgekins_cfg is None:
        forgekins_cfg = _load_forgekins()
        for slug, cfg in forgekins_cfg.items():
            greeting = cfg.get("persona", {}).get("greeting", f"{cfg['name']} 在线。")
            state.add(ChatMessage(
                message_id=f"msg-{uuid.uuid4().hex[:12]}",
                author_id=cfg["forgekin_id"],
                author_name=cfg["name"],
                author_role="forgekin",
                author_avatar=AVATARS.get(cfg["forgekin_id"], "🤖"),
                content=greeting,
                role="greeting",
            ))
    return forgekins_cfg

def _get_bridge() -> ForgekinLLMBridge:
    """Lazily initialize the ForgekinLLMBridge on first request.

    Avoids import-time failures if config files (llm_route.yaml,
    web_chat_prompts.yaml, forgemind.yaml) are missing or malformed.
    """
    if "bridge" not in bridge_holder:
        bridge_holder["bridge"] = ForgekinLLMBridge.from_config(CONFIG_DIR)
    return bridge_holder["bridge"]

# ── Router ───────────────────────────────────────────────────────────────────

router = APIRouter(prefix="/api/v1/forgemind/council", tags=["forgekin-council"])

# ── Endpoints: agents ────────────────────────────────────────────────────────

@router.get("/agents")
async def list_agents() -> dict:
    fk_cfgs = _get_forgekins()
    return {
        "agents": [_forgekin_profile(cfg) for cfg in fk_cfgs.values()],
        "operator": {
            "id": "operator",
            "name": "Operator",
            "avatar": AVATARS["operator"],
            "role": "operator",
        },
    }

@router.get("/agents/{fk_id}")
async def get_agent_detail(fk_id: str) -> dict:
    """Return the full profile of a single forgekin from its YAML config."""
    fk_cfgs = _get_forgekins()
    fk_cfg = _find_forgekin_cfg(fk_cfgs, fk_id)
    if not fk_cfg:
        raise HTTPException(status_code=404, detail=f"forgekin '{fk_id}' not found")
    profile = _forgekin_profile(fk_cfg)
    # Enrich with capabilities detail, council role, and self-dev loop config
    caps = []
    for c in fk_cfg.get("capabilities", []):
        caps.append({
            "name": c.get("name", ""),
            "description": c.get("description", ""),
            "tools": c.get("tools", []),
        })
    profile["capabilities_detail"] = caps
    profile["council_role"] = fk_cfg.get("council_role", {})
    profile["self_dev_loop"] = fk_cfg.get("self_dev_loop", {})
    profile["energy"] = fk_cfg.get("energy", {})
    profile["persona"] = fk_cfg.get("persona", {})
    profile["model_preference"] = fk_cfg.get("model_preference", {})
    return {"agent": profile}

# ── Endpoints: messages ──────────────────────────────────────────────────────

@router.get("/messages")
async def get_messages(limit: int = 50) -> dict:
    recent = state.messages[-limit:] if limit > 0 else state.messages
    return {
        "messages": [asdict(m) for m in recent],
        "total": len(state.messages),
    }

@router.post("/messages/clear")
async def clear_messages() -> dict:
    """Clear all in-memory messages and reset push back state."""
    fk_cfgs = _get_forgekins()
    count = len(state.messages)
    state.messages.clear()
    state.reset_push_back()
    # Re-seed forgekin greetings so the channel isn't empty
    for slug, cfg in fk_cfgs.items():
        greeting = cfg.get("persona", {}).get("greeting", f"{cfg['name']} 在线。")
        state.add(ChatMessage(
            message_id=f"msg-{uuid.uuid4().hex[:12]}",
            author_id=cfg["forgekin_id"],
            author_name=cfg["name"],
            author_role="forgekin",
            author_avatar=AVATARS.get(cfg["forgekin_id"], "🤖"),
            content=greeting,
            role="greeting",
        ))
    # Broadcast clear event to all WebSocket subscribers
    subscriber_count = len(state.subscribers)
    logger.info(
        f"[ws] CLEAR BROADCAST START: cleared_count={count} "
        f"subscribers={subscriber_count} reseeded_greetings={len(fk_cfgs)}"
    )
    if state.subscribers:
        payload = json.dumps({"type": "messages_cleared", "cleared_count": count})
        dead: list[WebSocket] = []
        success_count = 0
        for ws in state.subscribers:
            ws_id = f"ws-{id(ws):x}"
            client_host = ws.client.host if ws.client else "unknown"
            try:
                await ws.send_text(payload)
                success_count += 1
                logger.info(
                    f"[ws] CLEAR BROADCAST OK: id={ws_id} client={client_host}"
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    f"[ws] CLEAR BROADCAST FAIL: id={ws_id} client={client_host} "
                    f"error={exc!r}"
                )
                dead.append(ws)
        for ws in dead:
            state.subscribers.discard(ws)
        logger.info(
            f"[ws] CLEAR BROADCAST DONE: success={success_count}/{subscriber_count} "
            f"remaining_subscribers={len(state.subscribers)}"
        )
    return {"cleared": True, "cleared_count": count}

# ── Endpoint: chat (real LLM responses) ──────────────────────────────────────

@router.post("/chat")
async def send_message(payload: dict) -> dict:
    """Accept a user message, route to forgekins, return real LLM responses.

    Request body: {"content": "...", "mentions": ["fk-wenxin"]}
    Response: {"user_message": {...}, "forgekin_responses": [...], "routing": [...]}
    """
    # 为每次聊天生成独立 trace_id，贯穿消息路由→LLM调用→T7审核全链路
    chat_trace = set_trace_id(generate_trace_id())
    bridge = _get_bridge()
    fk_cfgs = _get_forgekins()
    content = (payload.get("content") or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="content is required")
    mentions = payload.get("mentions", []) or []
    # When true, route primary forgekin responses through their bound
    # external agent (claude_code/codex/gemini/opencode) instead of the
    # LLM gateway. Reviewer/tester responses still use the LLM gateway
    # because external agents don't have a "review" role concept.
    use_external_agent = bool(payload.get("use_external_agent", False))

    logger.info(
        f"[trace_id={chat_trace}] send_message: content={content[:60]!r} "
        f"mentions={mentions} use_external_agent={use_external_agent}"
    )

    user_msg = ChatMessage(
        message_id=f"msg-{uuid.uuid4().hex[:12]}",
        author_id="operator",
        author_name="Operator",
        author_role="operator",
        author_avatar=AVATARS["operator"],
        content=content,
        mentions=mentions,
        trace_id=chat_trace,
    )
    state.add(user_msg)

    routing = _route_message(content, fk_cfgs)
    logger.info(
        f"[trace_id={chat_trace}] routing: {len(routing)} forgekin(s) "
        f"fk_ids={[r['forgekin_id'] for r in routing]}"
    )
    responses: list[dict] = []
    primary_output: str | None = None
    primary_name: str | None = None
    primary_loop_type: str | None = None

    for route in routing:
        fk_id = route["forgekin_id"]
        role = route["role"]
        delay_ms = route["delay_ms"]

        fk_cfg = _find_forgekin_cfg(fk_cfgs, fk_id)
        if not fk_cfg:
            logger.warning(
                f"[trace_id={chat_trace}] routing referenced unknown "
                f"forgekin_id={fk_id}, skipping"
            )
            continue

        # Stagger calls slightly so the UI animation feels natural; the
        # delay is small (200-800ms) and never blocks the LLM call itself.
        await asyncio.sleep(delay_ms / 1000.0)

        recent_context = state.get_context(limit=6)

        logger.info(
            f"[trace_id={chat_trace}] LLM call start: fk={fk_id} role={role} "
            f"context_msgs={len(recent_context) if recent_context else 0} "
            f"use_external_agent={use_external_agent}"
        )
        # External agent path: only for primary role, when user requests it,
        # and when the forgekin has a bound external agent. Reviewer/tester
        # roles always use the LLM gateway (external agents have no review concept).
        bound_kind = bridge.find_external_agent_for_forgekin(fk_cfg) if use_external_agent else None
        route_via_external = bound_kind is not None and role == "primary"
        try:
            if route_via_external:
                logger.info(
                    f"[trace_id={chat_trace}] external_agent call: fk={fk_id} "
                    f"kind={bound_kind.value}"
                )
                reply: ForgekinReply = await bridge.respond_via_external_agent(
                    fk_cfg,
                    role=role,
                    user_content=content,
                    recent_context=recent_context,
                )
            else:
                reply: ForgekinReply = await bridge.respond(
                    fk_cfg,
                    role=role,
                    user_content=content,
                    recent_context=recent_context,
                    push_back_round=state.push_back_rounds,
                )
        except (LLMError, ExternalAgentError) as exc:
            # Surface LLM/external-agent failure to the client without crashing.
            logger.error(
                f"[trace_id={chat_trace}] call FAILED: fk={fk_id} "
                f"role={role} route={'external' if route_via_external else 'llm'} "
                f"error={exc!r}",
                exc_info=True,
            )
            if isinstance(exc, ExternalAgentError):
                err_hint = (
                    f"[{fk_cfg['name']}] ⚠️ 外部 Agent 调用失败（{bound_kind.value if bound_kind else 'unknown'}）。\n"
                    f"错误：{exc!s}\n"
                    f"请检查该 CLI 是否已安装（PATH 或 %APPDATA%\\npm），"
                    f"或访问 /admin/external-agents 配置 binary 路径。"
                )
            else:
                err_hint = (
                    f"[{fk_cfg['name']}] ⚠️ LLM 调用失败，所有 fallback 均已耗尽。\n"
                    f"错误：{exc!s}\n"
                    f"请检查 OpenRoute 服务 (端口 13001) 是否运行，以及 "
                    f"config/llm_route.yaml 中的 fallback_chains 配置。"
                )
            error_msg = ChatMessage(
                message_id=f"msg-{uuid.uuid4().hex[:12]}",
                author_id=fk_id,
                author_name=fk_cfg["name"],
                author_role="forgekin",
                author_avatar=AVATARS.get(fk_id, "🤖"),
                content=err_hint,
                role=role,
                trace_id=chat_trace,
            )
            state.add(error_msg)
            await _broadcast(state, error_msg)
            responses.append(asdict(error_msg))
            # ── Metrics: LLM 失败计数（T6）──
            _mc = _get_metrics_collector()
            _mc.inc_counter("flowforge_llm_calls_total", labels={
                "model": "unknown", "provider": "unknown",
                "role": role, "success": "false",
            })
            continue

        llm_meta = LLMMeta(
            model=reply.model,
            provider=reply.provider,
            latency_ms=reply.latency_ms,
            finish_reason=reply.finish_reason,
            chain=bridge.DEFAULT_CHAIN,
        )
        # ── Metrics 收集（T6 必须采集指标）──
        _mc = _get_metrics_collector()
        _mc.inc_counter("flowforge_chat_messages_total")
        _mc.inc_counter("flowforge_llm_calls_total", labels={
            "model": reply.model, "provider": reply.provider,
            "role": role, "success": "true",
        })
        _mc.observe_histogram("flowforge_llm_duration_seconds", reply.latency_ms / 1000.0, labels={"model": reply.model})
        logger.info(
            f"[trace_id={chat_trace}] LLM call done: fk={fk_id} role={role} "
            f"model={reply.model} provider={reply.provider} "
            f"latency={reply.latency_ms:.0f}ms finish={reply.finish_reason} "
            f"len={len(reply.text)}"
        )

        # T7 audit: only primary responses are audited (per T7 spec —
        # "凡LLM生成的内容必须经LLM审核"; reviewer/tester outputs are
        # themselves part of the audit pipeline).
        t7_badge: T7Badge | None = None
        if role == "primary":
            primary_output = reply.text
            primary_name = fk_cfg["name"]
            primary_loop_type = fk_cfg.get("self_dev_loop", {}).get("loop_type", "")
            logger.info(
                f"[trace_id={chat_trace}] T7 audit start: primary={primary_name} "
                f"loop={primary_loop_type}"
            )
            try:
                audit: T7AuditResult = await bridge.audit_t7(
                    primary_name=primary_name,
                    primary_output=primary_output,
                    loop_type=primary_loop_type,
                )
                t7_badge = T7Badge(
                    score=audit.score,
                    verdict=audit.verdict,
                    reasons=audit.reasons,
                    model=audit.model,
                    provider=audit.provider,
                    latency_ms=audit.latency_ms,
                    quality_threshold=audit.quality_threshold,
                )
                logger.info(
                    f"[trace_id={chat_trace}] T7 audit done: primary={primary_name} "
                    f"score={audit.score:.2f} verdict={audit.verdict} "
                    f"model={audit.model} latency={audit.latency_ms:.0f}ms"
                )
            except LLMError as exc:
                logger.error(
                    f"[trace_id={chat_trace}] T7 audit FAILED: "
                    f"primary={primary_name} error={exc!r}",
                    exc_info=True,
                )
                t7_badge = T7Badge(
                    score=0.0,
                    verdict="fail",
                    reasons=[f"T7 audit LLM call failed: {exc!s}"],
                    model="",
                    provider="",
                    latency_ms=0.0,
                    quality_threshold=bridge._quality_threshold,
                )

        response_msg = ChatMessage(
            message_id=f"msg-{uuid.uuid4().hex[:12]}",
            author_id=fk_id,
            author_name=fk_cfg["name"],
            author_role="forgekin",
            author_avatar=AVATARS.get(fk_id, "🤖"),
            content=reply.text,
            role=role,
            llm_meta=llm_meta,
            t7_badge=t7_badge,
            trace_id=chat_trace,
        )
        # ── T7 Metrics（T6 必须采集指标）──
        if t7_badge is not None:
            _mc.inc_counter("flowforge_t7_audit_total", labels={"verdict": t7_badge.verdict})
            _mc.set_gauge("flowforge_t7_audit_score", t7_badge.score)
        state.add(response_msg)
        responses.append(asdict(response_msg))
        await _broadcast(state, response_msg)

    return {
        "user_message": asdict(user_msg),
        "forgekin_responses": responses,
        "routing": routing,
    }

# ── Endpoint: bridge status ──────────────────────────────────────────────────

@router.get("/bridge")
async def bridge_status() -> dict:
    """Report the LLM bridge configuration for diagnostics.

    Uses ``_get_bridge()`` (not a stale closure) so the status reflects
    the *current* bridge after a settings reload.
    """
    b = _get_bridge()
    return {
        "providers": list(b._providers.keys()),
        "chains_available": list(b._llm_route.get("fallback_chains", {}).keys()),
        "default_chain": b.DEFAULT_CHAIN,
        "t7_chain": b.T7_CHAIN,
        "quality_threshold": b._quality_threshold,
        "prompts_loaded": bool(b._prompts),
        "config_dir": str(b._config_dir),
    }

# ── Endpoints: I11 multi-turn context + push back protocol ──────────────────

@router.get("/context")
async def get_context(limit: int = 10) -> dict:
    recent = state.get_context(limit=limit)
    return {
        "messages": [asdict(m) for m in recent],
        "total_messages": len(state.messages),
        "push_back": {
            "current_round": state.push_back_rounds,
            "max_rounds": state.push_back_max_rounds,
            "topic": state.push_back_topic,
            "escalated_to_operator": state.escalated_to_operator,
        },
        "i11_invariant": {
            "name": "push_back_protocol",
            "description": "最多 3 轮 push back，3 轮后升级 operator",
            "max_rounds": state.push_back_max_rounds,
            "current_round": state.push_back_rounds,
            "escalated": state.escalated_to_operator,
        },
    }

@router.post("/push_back")
async def trigger_push_back(payload: dict) -> dict:
    fk_cfgs = _get_forgekins()
    topic = payload.get("topic", "未指定主题")
    forgekin_id = payload.get("forgekin_id", "fk-vangogh")
    issue = payload.get("issue", "产出质量不达标")

    fk_cfg = _find_forgekin_cfg(fk_cfgs, forgekin_id)
    if not fk_cfg:
        raise HTTPException(status_code=404, detail=f"forgekin {forgekin_id} not found")

    if state.push_back_topic != topic:
        state.reset_push_back()
        state.push_back_topic = topic

    state.push_back_rounds += 1
    escalated = state.push_back_rounds >= state.push_back_max_rounds
    if escalated:
        state.escalated_to_operator = True

    pb_content = (
        f"[{fk_cfg['name']}] 🔄 [I11 push back 第 {state.push_back_rounds}/"
        f"{state.push_back_max_rounds} 轮]\n"
        f"主题: {topic}\n"
        f"质疑: {issue}\n"
    )
    if escalated:
        pb_content += (
            f"⚠️ [I11 升级] 已达 push back 上限 ({state.push_back_max_rounds} 轮)，"
            f"升级 operator 处理。"
        )
    else:
        remaining = state.push_back_max_rounds - state.push_back_rounds
        pb_content += f"剩余 push back 轮次: {remaining}"

    pb_msg = ChatMessage(
        message_id=f"msg-{uuid.uuid4().hex[:12]}",
        author_id=forgekin_id,
        author_name=fk_cfg["name"],
        author_role="forgekin",
        author_avatar=AVATARS.get(forgekin_id, "🤖"),
        content=pb_content,
        role="push_back",
        mentions=["operator"] if escalated else [],
    )
    state.add(pb_msg)
    await _broadcast(state, pb_msg)

    return {
        "round": state.push_back_rounds,
        "max_rounds": state.push_back_max_rounds,
        "escalated_to_operator": escalated,
        "topic": topic,
        "message": pb_content,
    }

@router.post("/push_back/reset")
async def reset_push_back() -> dict:
    state.reset_push_back()
    return {
        "reset": True,
        "push_back": {
            "current_round": state.push_back_rounds,
            "max_rounds": state.push_back_max_rounds,
            "escalated_to_operator": state.escalated_to_operator,
        },
    }

# ── Endpoints: settings — LLM configuration ─────────────────────────────────

@router.get("/settings/llm")
async def get_llm_settings() -> dict:
    """Return current LLM route config with masked secrets."""
    llm_route_path = CONFIG_DIR / "llm_route.yaml"
    cfg = _load_yaml(llm_route_path) if llm_route_path.exists() else {}
    providers_out = {}
    for name, pcfg in cfg.get("providers", {}).items():
        base_url = _env(
            f"FLOWFORGE_LLM_ROUTE_{name.upper()}_BASE_URL",
            pcfg.get("base_url", ""),
        )
        api_key = _env(
            f"FLOWFORGE_LLM_ROUTE_{name.upper()}_API_KEY",
            pcfg.get("api_key", ""),
        )
        masked = (
            api_key[:4] + "****" + api_key[-4:] if len(api_key) > 8
            else ("****" if api_key else "")
        )
        providers_out[name] = {
            "enabled": pcfg.get("enabled", False),
            "kind": pcfg.get("kind", ""),
            "base_url": base_url,
            "api_key_configured": bool(api_key),
            "api_key_masked": masked,
            "vendor": pcfg.get("vendor", ""),
        }
    return {
        "providers": providers_out,
        "fallback_chains": cfg.get("fallback_chains", {}),
        "prefer_api": cfg.get("prefer_api", True),
        "config_path": str(llm_route_path),
    }

@router.put("/settings/llm")
async def update_llm_settings(payload: dict) -> dict:
    """Update LLM provider config (base_url + api_key) and hot-reload bridge.

    Request body:
        {"provider": "openroute", "base_url": "http://...", "api_key": "..."}
    The base_url is written to llm_route.yaml; the api_key is written to
    the .env file next to the project root (铁律 5 — secrets never in YAML).
    """
    provider_name = (payload.get("provider") or "").strip()
    base_url = (payload.get("base_url") or "").strip()
    api_key = (payload.get("api_key") or "").strip()
    if not provider_name:
        raise HTTPException(status_code=400, detail="provider is required")

    llm_route_path = CONFIG_DIR / "llm_route.yaml"
    cfg = _load_yaml(llm_route_path) if llm_route_path.exists() else {}
    providers = cfg.setdefault("providers", {})
    pcfg = providers.setdefault(provider_name, {})
    if base_url:
        pcfg["base_url"] = base_url
    pcfg.setdefault("kind", "openroute")
    pcfg.setdefault("enabled", True)

    # Persist YAML (base_url only — never the api_key)
    with llm_route_path.open("w", encoding="utf-8") as f:
        yaml.safe_dump(cfg, f, allow_unicode=True, sort_keys=False)

    # Persist api_key to .env (铁律 5)
    if api_key:
        env_path = PROJECT_ROOT / ".env"
        env_var = f"FLOWFORGE_LLM_ROUTE_{provider_name.upper()}_API_KEY"
        _upsert_env_var(env_path, env_var, api_key)
        # Also set in current process so the reload picks it up immediately
        os.environ[env_var] = api_key
    if base_url:
        env_var = f"FLOWFORGE_LLM_ROUTE_{provider_name.upper()}_BASE_URL"
        os.environ[env_var] = base_url

    # Hot-reload the bridge
    try:
        bridge_holder["bridge"] = ForgekinLLMBridge.from_config(CONFIG_DIR)
        logger.info(f"LLM bridge reloaded: provider={provider_name} base_url={base_url}")
    except Exception as exc:  # noqa: BLE001
        logger.error(f"Bridge reload failed: {exc!r}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Bridge reload failed: {exc!s}")

    return {
        "updated": True,
        "provider": provider_name,
        "base_url": base_url,
        "api_key_configured": bool(api_key),
    }

@router.post("/settings/llm/test")
async def test_llm_connection(payload: dict) -> dict:
    """Test the LLM connection by sending a minimal completion request.

    Uses the current bridge config (which may have been just-updated).
    """
    bridge = _get_bridge()
    prompt = (payload.get("prompt") or "请回复'连接成功'四个字。").strip()
    try:
        # Use the primary fallback chain for the test
        client = bridge._get_client(bridge.DEFAULT_CHAIN)
        resp = await client.complete(prompt=prompt, max_tokens=20)
        return {
            "success": True,
            "model": resp.model,
            "provider": resp.provider,
            "latency_ms": resp.latency_ms,
            "response_preview": (resp.text or "")[:120],
        }
    except Exception as exc:  # noqa: BLE001
        logger.error(f"LLM connection test failed: {exc!r}", exc_info=True)
        return {
            "success": False,
            "error": str(exc),
        }

# ── Endpoints: settings — runtime parameters ────────────────────────────────

@router.get("/settings/runtime")
async def get_runtime_settings() -> dict:
    """Return runtime-tunable parameters."""
    bridge = _get_bridge()
    return {
        "loop_timeout_seconds": int(os.environ.get("FLOWFORGE_EVOLUTION_LLM_TIMEOUT_SECONDS", "90")),
        "quality_threshold": bridge._quality_threshold,
        "push_back_max_rounds": state.push_back_max_rounds,
        "debug": _bool_env("FLOWFORGE_DEBUG", False),
    }

@router.put("/settings/runtime")
async def update_runtime_settings(payload: dict) -> dict:
    """Update runtime-tunable parameters (in-memory; not persisted)."""
    bridge = _get_bridge()
    changed = []
    if "quality_threshold" in payload:
        val = float(payload["quality_threshold"])
        bridge._quality_threshold = val
        changed.append(f"quality_threshold={val}")
    if "push_back_max_rounds" in payload:
        val = int(payload["push_back_max_rounds"])
        state.push_back_max_rounds = max(1, min(5, val))
        changed.append(f"push_back_max_rounds={state.push_back_max_rounds}")
    if "loop_timeout_seconds" in payload:
        val = int(payload["loop_timeout_seconds"])
        os.environ["FLOWFORGE_EVOLUTION_LLM_TIMEOUT_SECONDS"] = str(val)
        changed.append(f"loop_timeout_seconds={val}")
    if "debug" in payload:
        os.environ["FLOWFORGE_DEBUG"] = "1" if payload["debug"] else "0"
        changed.append(f"debug={payload['debug']}")
    logger.info(f"Runtime settings updated: {', '.join(changed) if changed else 'no changes'}")
    return {
        "updated": True,
        "changes": changed,
        "current": {
            "loop_timeout_seconds": int(os.environ.get("FLOWFORGE_EVOLUTION_LLM_TIMEOUT_SECONDS", "90")),
            "quality_threshold": bridge._quality_threshold,
            "push_back_max_rounds": state.push_back_max_rounds,
            "debug": _bool_env("FLOWFORGE_DEBUG", False),
        },
    }

# ── Endpoints: task management (in-memory MVP) ──────────────────────────────

@router.get("/tasks")
async def list_tasks(status: str | None = None) -> dict:
    """List all tasks, optionally filtered by status."""
    items = list(tasks_store.values())
    if status:
        items = [t for t in items if t.status == status]
    items.sort(key=lambda t: t.created_at, reverse=True)
    return {
        "tasks": [asdict(t) for t in items],
        "total": len(items),
    }

@router.post("/tasks")
async def create_task(payload: dict) -> dict:
    """Create a new task and dispatch it to the matching forgekin.

    Request body:
        {"intent": "...", "persona": "doc|code|framework|test|review",
         "input_data": {...}}
    The task is created in 'pending' state, then immediately dispatched
    to the forgekin via the LLM bridge. The response returns the task
    with status 'running' — the operator can poll /tasks/{id} for
    completion.
    """
    # 为每个任务生成独立 trace_id，贯穿任务调度→LLM调用→完成全链路
    trace_id = set_trace_id(generate_trace_id())
    fk_cfgs = _get_forgekins()
    intent = (payload.get("intent") or "").strip()
    persona = (payload.get("persona") or "doc").strip()
    if not intent:
        raise HTTPException(status_code=400, detail="intent is required")
    if persona not in _PERSONA_TO_FORGEKIN:
        raise HTTPException(
            status_code=400,
            detail=f"persona must be one of: {', '.join(_PERSONA_TO_FORGEKIN.keys())}",
        )

    task_id = f"task-{uuid.uuid4().hex[:12]}"
    fk_id = _PERSONA_TO_FORGEKIN[persona]
    fk_cfg = _find_forgekin_cfg(fk_cfgs, fk_id)
    if not fk_cfg:
        logger.error(f"[trace_id={trace_id}] create_task: forgekin {fk_id} not configured")
        raise HTTPException(status_code=500, detail=f"forgekin {fk_id} not configured")

    logger.info(
        f"[trace_id={trace_id}] create_task: task_id={task_id} persona={persona} "
        f"fk={fk_id} intent={intent[:60]!r}"
    )

    task = Task(
        task_id=task_id,
        intent=intent,
        persona=persona,
        input_data=payload.get("input_data", {}),
        assigned_forgekin=fk_id,
        status="running",
    )
    task.add_event("created", f"intent={intent!r} persona={persona}")
    tasks_store[task_id] = task

    # Dispatch in background — don't block the HTTP response
    async def _run_task() -> None:
        # 后台任务需重新设置 trace_id（ContextVar 在新 asyncio.Task 中不自动继承）
        task_trace = set_trace_id(trace_id)
        bridge = _get_bridge()
        logger.info(
            f"[trace_id={task_trace}] _run_task: dispatching to bridge "
            f"fk={fk_id} role=primary"
        )
        try:
            reply = await bridge.respond(
                fk_cfg,
                role="primary",
                user_content=intent,
                recent_context=state.get_context(limit=4),
                push_back_round=0,
            )
            task.result = {
                "output": reply.text,
                "model": reply.model,
                "provider": reply.provider,
                "latency_ms": reply.latency_ms,
            }
            task.status = "completed"
            task.add_event("completed", f"model={reply.model} latency={reply.latency_ms:.0f}ms")
            logger.info(
                f"[trace_id={task_trace}] _run_task: task_id={task_id} completed "
                f"model={reply.model} provider={reply.provider} "
                f"latency={reply.latency_ms:.0f}ms finish={reply.finish_reason} "
                f"output_len={len(reply.text)}"
            )
        except LLMError as exc:
            task.status = "failed"
            task.result = {"error": str(exc)}
            task.add_event("failed", str(exc))
            logger.error(
                f"[trace_id={task_trace}] _run_task: task_id={task_id} LLM_ERROR "
                f"fk={fk_id} error={exc!r}",
                exc_info=True,
            )
        except Exception as exc:  # noqa: BLE001
            task.status = "failed"
            task.result = {"error": str(exc)}
            task.add_event("failed", str(exc))
            logger.error(
                f"[trace_id={task_trace}] _run_task: task_id={task_id} UNEXPECTED "
                f"fk={fk_id} error={exc!r}",
                exc_info=True,
            )

    asyncio.create_task(_run_task())

    return {"task": asdict(task)}

@router.get("/tasks/{task_id}")
async def get_task(task_id: str) -> dict:
    """Return a single task's full state including events."""
    task = tasks_store.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail=f"task '{task_id}' not found")
    return {"task": asdict(task)}

@router.post("/tasks/{task_id}/cancel")
async def cancel_task(task_id: str) -> dict:
    """Mark a task as cancelled (best-effort; in-flight LLM calls continue)."""
    task = tasks_store.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail=f"task '{task_id}' not found")
    if task.status in ("completed", "failed", "cancelled"):
        return {"task": asdict(task), "already_terminal": True}
    task.status = "cancelled"
    task.add_event("cancelled", "operator requested cancellation")
    return {"task": asdict(task)}

# ── Endpoint: WebSocket (real-time message stream) ──────────────────────────
# NOTE: FastAPI WebSocket paths DO inherit the APIRouter prefix (same as HTTP
# routes). The router is created with prefix="/api/v1/forgemind/council" (see
# top of this file), so the decorator only needs the suffix "/ws" — the final
# registered path is /api/v1/forgemind/council/ws.
@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    # Ensure forgekin configs + greetings are loaded before accepting connections
    # so the first subscriber receives the seeded greeting history.
    _get_forgekins()
    # Log connection attempt with client info for troubleshooting (P32).
    client_host = ws.client.host if ws.client else "unknown"
    client_port = ws.client.port if ws.client else 0
    ws_id = f"ws-{id(ws):x}"
    logger.info(
        f"[ws] CONNECT ATTEMPT: id={ws_id} client={client_host}:{client_port} "
        f"path={ws.url.path if ws.url else '/api/v1/forgemind/council/ws'}"
    )
    await ws.accept()
    state.subscribers.add(ws)
    logger.info(
        f"[ws] ACCEPTED: id={ws_id} client={client_host}:{client_port} "
        f"total_subscribers={len(state.subscribers)}"
    )
    try:
        history_payload = {
            "type": "history",
            "messages": [asdict(m) for m in state.messages[-20:]],
        }
        await ws.send_text(json.dumps(history_payload))
        logger.info(
            f"[ws] HISTORY SENT: id={ws_id} msgs_sent={len(history_payload['messages'])} "
            f"total_in_state={len(state.messages)}"
        )
        while True:
            data = await ws.receive_text()
            if data == "ping":
                logger.debug(
                    f"[ws] PING received: id={ws_id} client={client_host}:{client_port}"
                )
                await ws.send_text(json.dumps({"type": "pong"}))
            else:
                # Non-ping messages are unexpected on /ws — log them so we
                # can diagnose protocol drift (e.g. client sending chat
                # messages via WS instead of POST /chat).
                preview = data[:120].replace("\n", " ")
                logger.warning(
                    f"[ws] UNEXPECTED MSG: id={ws_id} client={client_host}:{client_port} "
                    f"len={len(data)} preview={preview!r}"
                )
    except WebSocketDisconnect as exc:
        # Normal client disconnect — log code/reason if provided.
        logger.info(
            f"[ws] DISCONNECT: id={ws_id} client={client_host}:{client_port} "
            f"code={getattr(exc, 'code', 'N/A')} reason={getattr(exc, 'reason', '')!r}"
        )
        state.subscribers.discard(ws)
        logger.info(
            f"[ws] REMOVED: id={ws_id} remaining_subscribers={len(state.subscribers)}"
        )
    except Exception as exc:  # noqa: BLE001
        # Unexpected error — log with full detail for debugging.
        logger.error(
            f"[ws] ERROR: id={ws_id} client={client_host}:{client_port} "
            f"error={exc!r}",
            exc_info=True,
        )
        state.subscribers.discard(ws)
        logger.info(
            f"[ws] REMOVED (after error): id={ws_id} "
            f"remaining_subscribers={len(state.subscribers)}"
        )

# ── Endpoints: dashboard, workflows, metrics ────────────────────────────────

@router.get("/dashboard")
async def dashboard() -> dict:
    """仪表盘数据 — JSON 格式，供前端看板渲染。

    返回消息统计、LLM 调用统计、T7 审核统计、任务统计、Forgekin状态。
    """
    fk_cfgs = _get_forgekins()
    bridge = _get_bridge()
    collector = _get_metrics_collector()
    metrics_json = collector.get_json_metrics()

    # Forgekin状态
    forgekins_status = []
    for slug, cfg in fk_cfgs.items():
        forgekins_status.append({
            "id": cfg.get("forgekin_id", slug),
            "name": cfg.get("name", slug),
            "vendor": cfg.get("vendor", ""),
            "loop_type": cfg.get("self_dev_loop", {}).get("loop_type", ""),
            "awakening_stage": cfg.get("self_dev_loop", {}).get("awakening_stage", ""),
            "energy": cfg.get("energy", {}).get("initial", 1.0),
            "online": True,
        })

    # 任务统计
    task_stats = {"total": len(tasks_store), "running": 0, "completed": 0, "failed": 0, "pending": 0}
    for t in tasks_store.values():
        if t.status in task_stats:
            task_stats[t.status] += 1

    return {
        "status": "success",
        "data": {
            "forgekins": forgekins_status,
            "task_stats": task_stats,
            "message_count": len(state.messages),
            "ws_connections": len(state.subscribers),
            "metrics": metrics_json,
            "bridge": {
                "providers": list(bridge._providers.keys()),
                "chains": list(bridge._llm_route.get("fallback_chains", {}).keys()),
                "quality_threshold": bridge._quality_threshold,
            },
        },
    }

@router.get("/workflows")
async def list_workflows() -> dict:
    """列出所有 workflow 配置 — 扫描 config/workflows/*.yaml。

    返回 workflow 列表（含步骤详情）。
    """
    workflows: list[dict] = []
    if not WORKFLOWS_DIR.exists():
        return {"status": "success", "data": {"workflows": []}}

    for f in sorted(WORKFLOWS_DIR.glob("*.yaml")):
        try:
            cfg = _load_yaml(f)
            workflows.append({
                "name": cfg.get("name", f.stem),
                "display_name": cfg.get("display_name", cfg.get("name", f.stem)),
                "description": cfg.get("description", ""),
                "icon": cfg.get("icon", ""),
                "category": cfg.get("category", "general"),
                "version": cfg.get("version", "1.0"),
                "file": f.name,
                "steps": len(cfg.get("steps", [])),
                "step_details": [
                    {
                        "id": s.get("id", s.get("name", "")),
                        "display_name": s.get("display_name", s.get("name", "")),
                        "agent": s.get("agent", ""),
                        "human_review": s.get("human_review", False),
                    }
                    for s in cfg.get("steps", [])
                ],
            })
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"Failed to load workflow {f}: {exc}")
    return {"status": "success", "data": {"workflows": workflows}}

@router.get("/workflows/{workflow_name}")
async def get_workflow(workflow_name: str) -> dict:
    """获取单个 workflow 配置详情。"""
    wf_path = WORKFLOWS_DIR / f"{workflow_name}.yaml"
    if not wf_path.exists():
        raise HTTPException(status_code=404, detail=f"workflow '{workflow_name}' not found")
    cfg = _load_yaml(wf_path)
    return {
        "status": "success",
        "data": {
            "name": cfg.get("name", workflow_name),
            "display_name": cfg.get("display_name", cfg.get("name", workflow_name)),
            "description": cfg.get("description", ""),
            "icon": cfg.get("icon", ""),
            "category": cfg.get("category", "general"),
            "version": cfg.get("version", "1.0"),
            "file": wf_path.name,
            "steps": cfg.get("steps", []),
        },
    }

@router.get("/council-metrics")
async def prometheus_metrics() -> Response:
    """Prometheus /council-metrics 端点 — 供 Prometheus 抓取。

    返回 Prometheus 文本格式指标，包含聊天消息计数、LLM 调用统计、
    T7 审核分数等。路径从 /metrics 改为 /council-metrics 以避免与
    app/main.py 中已有的 /metrics 端点冲突。
    """
    fk_cfgs = _get_forgekins()
    collector = _get_metrics_collector()
    # 更新实时 gauge
    collector.set_gauge("flowforge_ws_connections", len(state.subscribers))
    collector.set_gauge("flowforge_messages_in_memory", len(state.messages))
    for slug, cfg in fk_cfgs.items():
        fk_id = cfg.get("forgekin_id", slug)
        energy = cfg.get("energy", {}).get("initial", 1.0)
        collector.set_gauge("flowforge_forgekin_energy", energy, {"forgekin_id": fk_id})
    prom_text = collector.get_prometheus_format()
    return Response(content=prom_text, media_type="text/plain; version=0.0.4; charset=utf-8")
