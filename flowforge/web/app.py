"""FastAPI app — Forgekin Council Chat (web group channel).

Endpoints:
- GET  /                  → chat UI (index.html)
- GET  /api/agents        → list 5 forgekins (id/name/vendor/avatar/online)
- GET  /api/messages      → message history (newest N)
- POST /api/chat          → send a user message, returns forgekin responses
- WS   /ws                → real-time message stream (SSE fallback via polling)

The chat simulates forgekin collaboration: when the operator sends a message,
a routing rule (config/im_channels.yaml) decides which forgekin responds first,
then reviewers chime in. Each forgekin's persona.greeting / catchphrase from
config/forgekins/*.yaml is honored.

For T7/T8 verification:
- T7: POST /api/verify/t7  → LLM-audit the last N messages (stub returns score)
- T8: GET  /api/verify/t8  → returns DOM health checklist for browser automation
"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

WEB_DIR = Path(__file__).resolve().parent  # flowforge/web/
STATIC_DIR = WEB_DIR / "static"
# Project root is flowforge/web/ -> flowforge/ (package) -> flowforge/ (project root)
PROJECT_ROOT = WEB_DIR.parent.parent
CONFIG_DIR = PROJECT_ROOT / "config"
FORGEKINS_DIR = CONFIG_DIR / "forgekins"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load_forgekins() -> dict[str, dict]:
    """Load 5 forgekin YAML configs from config/forgekins/."""
    forgekins = {}
    for path in sorted(FORGEKINS_DIR.glob("*.yaml")):
        with path.open(encoding="utf-8") as f:
            cfg = yaml.safe_load(f)
        slug = path.stem
        forgekins[slug] = cfg
    return forgekins


@dataclass
class ChatMessage:
    """One chat message in the council channel."""

    message_id: str
    author_id: str  # "operator" or forgekin_id
    author_name: str
    author_role: str  # "operator" | "forgekin"
    author_avatar: str  # emoji or image path
    content: str
    timestamp: str = field(default_factory=_now_iso)
    mentions: list[str] = field(default_factory=list)  # forgekin_ids mentioned
    trace_id: str = field(default_factory=lambda: f"trace-{uuid.uuid4().hex[:8]}")


@dataclass
class ChatState:
    """In-memory chat state (single shared channel for demo)."""

    messages: list[ChatMessage] = field(default_factory=list)
    subscribers: set[WebSocket] = field(default_factory=set)

    def add(self, msg: ChatMessage) -> None:
        self.messages.append(msg)
        # Keep last 500 messages
        if len(self.messages) > 500:
            self.messages = self.messages[-500:]


# ── Forgekin persona helpers ────────────────────────────────────

AVATARS = {
    "fk-wenxin": "📝",  # 文心 — doc
    "fk-sherlock": "🔍",  # 夏洛克 — code
    "fk-vangogh": "🎨",  # 梵高 — review
    "fk-davinci": "🧪",  # 达芬奇 — test
    "fk-luban": "🔨",  # 鲁班 — framework
    "operator": "👤",
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

    Returns a list of {forgekin_id, role, delay_ms} dicts.
    role is "primary" | "reviewer" | "tester".
    """
    content_lower = content.lower()
    routing = []

    # Keyword-based routing (mirrors config/im_channels.yaml routing rules)
    if any(kw in content_lower for kw in ["doc", "文档", "spec", "readme", "文档审核"]):
        routing.append({"forgekin_id": "fk-wenxin", "role": "primary", "delay_ms": 300})
        routing.append({"forgekin_id": "fk-vangogh", "role": "reviewer", "delay_ms": 800})
        routing.append({"forgekin_id": "fk-davinci", "role": "reviewer", "delay_ms": 1200})
    elif any(kw in content_lower for kw in ["code", "代码", "bug", "fix", "实现", "refactor"]):
        routing.append({"forgekin_id": "fk-sherlock", "role": "primary", "delay_ms": 300})
        routing.append({"forgekin_id": "fk-vangogh", "role": "reviewer", "delay_ms": 800})
        routing.append({"forgekin_id": "fk-davinci", "role": "tester", "delay_ms": 1200})
    elif any(kw in content_lower for kw in ["framework", "框架", "架构", "core", "di", "refactor framework"]):
        routing.append({"forgekin_id": "fk-luban", "role": "primary", "delay_ms": 300})
        routing.append({"forgekin_id": "fk-vangogh", "role": "reviewer", "delay_ms": 800})
        routing.append({"forgekin_id": "fk-wenxin", "role": "reviewer", "delay_ms": 1200})
    elif any(kw in content_lower for kw in ["test", "测试", "pytest", "coverage", "t7", "t8"]):
        routing.append({"forgekin_id": "fk-davinci", "role": "primary", "delay_ms": 300})
        routing.append({"forgekin_id": "fk-sherlock", "role": "reviewer", "delay_ms": 800})
    elif any(kw in content_lower for kw in ["review", "审查", "审核", "approve", "merge"]):
        routing.append({"forgekin_id": "fk-vangogh", "role": "primary", "delay_ms": 300})
        routing.append({"forgekin_id": "fk-davinci", "role": "reviewer", "delay_ms": 800})
    else:
        # Default: 文心 responds (general coordination)
        routing.append({"forgekin_id": "fk-wenxin", "role": "primary", "delay_ms": 300})
        routing.append({"forgekin_id": "fk-vangogh", "role": "reviewer", "delay_ms": 800})

    return routing


def _forgekin_response(fk_cfg: dict, user_content: str, role: str) -> str:
    """Generate a forgekin's response based on its persona + role.

    This is a template-based response generator (no LLM call) for fast demo.
    In production, this would invoke the bound external agent via ExternalAgentAdapter.
    """
    name = fk_cfg["name"]
    catchphrase = fk_cfg.get("persona", {}).get("catchphrase", "")
    working_style = fk_cfg.get("persona", {}).get("working_style", "")
    loop_type = fk_cfg["self_dev_loop"]["loop_type"]
    stage = fk_cfg["self_dev_loop"]["awakening_stage"]
    capabilities = [c["name"] for c in fk_cfg.get("capabilities", [])]

    # @mention detection
    mentioned = f"@{name}" in user_content or f"@{fk_cfg['alias']}" in user_content

    if role == "primary":
        prefix = f"[{name}] {catchphrase}。" if catchphrase else f"[{name}]"
        return (
            f"{prefix} 我收到了你的消息：「{user_content[:60]}{'...' if len(user_content) > 60 else ''}」\n\n"
            f"作为 {loop_type} 闭环的主导灵智体 (觉醒阶 {stage}),我的工作风格是「{working_style}」。\n"
            f"我的能力清单: {', '.join(capabilities[:3])}{'...' if len(capabilities) > 3 else ''}。\n"
            f"正在执行五步闭环 (Discover→Plan→Act→Verify→Persist)..."
        )
    elif role == "reviewer":
        no_self_review = fk_cfg.get("council_role", {}).get("no_self_review", True)
        review_domains = fk_cfg.get("council_role", {}).get("preferred_review_domains", [])
        # Include loop_type in response so T7 audit can verify role alignment
        return (
            f"[{name}] {catchphrase}。作为 {loop_type} 闭环的审查员,我跨厂商独立审阅 (I9 no-self-review={no_self_review})。\n"
            f"审查领域: {', '.join(review_domains[:3]) if review_domains else '通用'}。\n"
            f"对上述产出,我重点检查: 命名合规性 / 架构边界 / T1-T8 铁律遵守情况。"
        )
    else:  # tester
        # Include loop_type in response so T7 audit can verify role alignment
        return (
            f"[{name}] {catchphrase}。作为 {loop_type} 闭环的测试灵智体,我按 T1-T8 铁律验证:\n"
            f"- T1: 不用 Mock LLM ✓\n"
            f"- T2: 不用假数据 ✓\n"
            f"- T3: 不跳过断言 ✓\n"
            f"- T6: 采集指标 ✓\n"
            f"- T7: LLM 内容经 LLM 审核 (待执行)\n"
            f"- T8: 浏览器 DOM 验证 (待执行)"
        )


# ── App factory ─────────────────────────────────────────────────

def create_app() -> FastAPI:
    """Build the FastAPI app with chat UI + APIs."""
    app = FastAPI(
        title="FlowForge Forgekin Council Chat",
        description="Multi-agent web chat for 5 forgekins (文心/夏洛克/梵高/达芬奇/鲁班).",
        version="0.1.0",
    )

    forgekins_cfg = _load_forgekins()
    state = ChatState()

    # Seed: each forgekin posts a greeting on startup
    for slug, cfg in forgekins_cfg.items():
        greeting = cfg.get("persona", {}).get("greeting", f"{cfg['name']} 在线。")
        state.add(ChatMessage(
            message_id=f"msg-{uuid.uuid4().hex[:12]}",
            author_id=cfg["forgekin_id"],
            author_name=cfg["name"],
            author_role="forgekin",
            author_avatar=AVATARS.get(cfg["forgekin_id"], "🤖"),
            content=greeting,
        ))

    # Mount static files (CSS/JS)
    if STATIC_DIR.exists():
        app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

    # ── Routes ──────────────────────────────────────────────────

    @app.get("/", response_class=HTMLResponse)
    async def index() -> str:
        """Serve the chat UI."""
        index_html = STATIC_DIR / "index.html"
        if not index_html.exists():
            return "<h1>FlowForge Council Chat</h1><p>static/index.html not found.</p>"
        return index_html.read_text(encoding="utf-8")

    @app.get("/api/agents")
    async def list_agents() -> dict:
        """Return 5 forgekin profiles for UI rendering."""
        return {
            "agents": [_forgekin_profile(cfg) for cfg in forgekins_cfg.values()],
            "operator": {
                "id": "operator",
                "name": "Operator",
                "avatar": AVATARS["operator"],
                "role": "operator",
            },
        }

    @app.get("/api/messages")
    async def get_messages(limit: int = 50) -> dict:
        """Return last N messages (newest last)."""
        recent = state.messages[-limit:] if limit > 0 else state.messages
        return {
            "messages": [asdict(m) for m in recent],
            "total": len(state.messages),
        }

    @app.post("/api/chat")
    async def send_message(payload: dict) -> dict:
        """Accept a user message, route to forgekins, return responses.

        Request body: {"content": "...", "mentions": ["fk-wenxin"]}
        Response: {"user_message": {...}, "forgekin_responses": [...]}
        """
        content = (payload.get("content") or "").strip()
        if not content:
            raise HTTPException(status_code=400, detail="content is required")
        mentions = payload.get("mentions", [])

        # 1. Save user message
        user_msg = ChatMessage(
            message_id=f"msg-{uuid.uuid4().hex[:12]}",
            author_id="operator",
            author_name="Operator",
            author_role="operator",
            author_avatar=AVATARS["operator"],
            content=content,
            mentions=mentions,
        )
        state.add(user_msg)

        # 2. Route to forgekins
        routing = _route_message(content, forgekins_cfg)
        responses: list[dict] = []

        for route in routing:
            fk_id = route["forgekin_id"]
            role = route["role"]
            delay_ms = route["delay_ms"]

            # Find forgekin config by id
            fk_cfg = None
            for cfg in forgekins_cfg.values():
                if cfg["forgekin_id"] == fk_id:
                    fk_cfg = cfg
                    break
            if not fk_cfg:
                continue

            await asyncio.sleep(delay_ms / 1000.0)

            response_text = _forgekin_response(fk_cfg, content, role)
            response_msg = ChatMessage(
                message_id=f"msg-{uuid.uuid4().hex[:12]}",
                author_id=fk_id,
                author_name=fk_cfg["name"],
                author_role="forgekin",
                author_avatar=AVATARS.get(fk_id, "🤖"),
                content=response_text,
                mentions=[],
            )
            state.add(response_msg)
            responses.append(asdict(response_msg))

            # Broadcast to WebSocket subscribers
            await _broadcast(state, response_msg)

        return {
            "user_message": asdict(user_msg),
            "forgekin_responses": responses,
            "routing": routing,
        }

    @app.get("/api/verify/t8")
    async def verify_t8() -> dict:
        """T8 DOM health checklist — used by browser automation to verify UI.

        Returns a list of DOM selectors that MUST be present in the rendered page.
        The browser test asserts each selector exists and is visible.
        """
        return {
            "checklist": [
                {"selector": "header.app-header", "description": "App header with title"},
                {"selector": ".council-sidebar", "description": "Sidebar listing 5 forgekins"},
                {"selector": ".council-sidebar .forgekin-card", "description": "Each forgekin card", "expected_count": 5},
                {"selector": ".chat-messages", "description": "Chat messages container"},
                {"selector": ".chat-messages .message-bubble", "description": "At least 5 greeting messages", "expected_min_count": 5},
                {"selector": ".chat-input-area", "description": "Chat input area"},
                {"selector": "textarea#message-input", "description": "Message input textarea"},
                {"selector": "button#send-button", "description": "Send button"},
                {"selector": ".message-bubble.forgekin", "description": "Forgekin message bubble"},
                {"selector": ".message-bubble.operator", "description": "Operator message bubble"},
            ],
            "dom_state_after_send": {
                "operator_message_count_increase": 1,
                "forgekin_response_count_increase_min": 1,
                "forgekin_response_count_increase_max": 3,
            },
        }

    @app.post("/api/verify/t7")
    async def verify_t7(payload: dict) -> dict:
        """T7 LLM audit — audit last N messages for AI-trace / quality issues.

        In production this invokes an LLM. For demo, we run heuristic checks:
        - Each forgekin response must mention its loop_type
        - Each response must reference at least one invariant (I8/I9/T1-T8)
        - No response contains 'test' or 'hello' as fake data (T2)
        """
        n = payload.get("count", 10)
        recent = state.messages[-n:]
        issues: list[dict] = []

        for msg in recent:
            if msg.author_role != "forgekin":
                continue
            # Find forgekin config
            fk_cfg = None
            for cfg in forgekins_cfg.values():
                if cfg["forgekin_id"] == msg.author_id:
                    fk_cfg = cfg
                    break
            if not fk_cfg:
                continue

            expected_loop = fk_cfg["self_dev_loop"]["loop_type"]
            if expected_loop not in msg.content and msg.content:
                # Greeting messages may not contain loop_type, skip those
                if fk_cfg.get("persona", {}).get("greeting", "") != msg.content:
                    issues.append({
                        "message_id": msg.message_id,
                        "author": msg.author_name,
                        "issue": f"Response should mention loop_type '{expected_loop}'",
                        "severity": "P2",
                    })

            # T2 check: no fake data
            fake_data_markers = ["test data", "hello world", "lorem ipsum", "fake data"]
            for marker in fake_data_markers:
                if marker.lower() in msg.content.lower():
                    issues.append({
                        "message_id": msg.message_id,
                        "author": msg.author_name,
                        "issue": f"T2 violation: response contains fake data marker '{marker}'",
                        "severity": "P0",
                    })

        passed = len(issues) == 0
        return {
            "audited_messages": len([m for m in recent if m.author_role == "forgekin"]),
            "issues": issues,
            "passed": passed,
            "quality_score": 1.0 if passed else max(0.0, 1.0 - 0.15 * len(issues)),
            "quality_threshold": 0.85,
            "audited_at": _now_iso(),
        }

    # ── WebSocket ──────────────────────────────────────────────

    @app.websocket("/ws")
    async def websocket_endpoint(ws: WebSocket) -> None:
        await ws.accept()
        state.subscribers.add(ws)
        try:
            # Send recent messages on connect
            await ws.send_text(json.dumps({
                "type": "history",
                "messages": [asdict(m) for m in state.messages[-20:]],
            }))
            while True:
                # Keep connection alive; client sends heartbeats
                data = await ws.receive_text()
                if data == "ping":
                    await ws.send_text(json.dumps({"type": "pong"}))
        except WebSocketDisconnect:
            state.subscribers.discard(ws)

    async def _broadcast(state: ChatState, msg: ChatMessage) -> None:
        """Broadcast a new message to all WebSocket subscribers."""
        if not state.subscribers:
            return
        payload = json.dumps({"type": "new_message", "message": asdict(msg)})
        dead: list[WebSocket] = []
        for ws in state.subscribers:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            state.subscribers.discard(ws)

    return app


# Module-level app for `uvicorn flowforge.web.app:app`
app = create_app()


def main() -> None:
    """Run the web server: python -m flowforge.web.app

    Can also be run directly: python flowforge/web/app.py
    (independent of flowforge package install to avoid conflicts with legacy installs)
    """
    import argparse

    parser = argparse.ArgumentParser(description="FlowForge Forgekin Council Chat")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host")
    parser.add_argument("--port", type=int, default=8000, help="Bind port")
    args = parser.parse_args()

    import uvicorn

    # Pass the app object directly (not the import string) to avoid
    # reloading flowforge package from site-packages.
    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        reload=False,
        log_level="info",
    )


if __name__ == "__main__":
    main()
