"""Forgekin Council Chat API endpoints — thin router layer.

This module contains **only** FastAPI route decorators and thin delegating
wrappers. All implementation code lives in seven sibling modules:

- :mod:`council_state` — dataclasses (``ChatMessage``/``Task``/…), module-level
  singletons (``state``/``tasks_store``/holders), and ``_broadcast``.
- :mod:`council_helpers` — path/env/YAML utilities, forgekin persona helpers,
  and lazy singleton accessors (``_get_forgekins``/``_get_bridge``).
- :mod:`council_chat_service` — chat message routing + LLM bridge calls
  (``_process_chat_message``, ``_clear_messages``).
- :mod:`council_task_service` — I11 push back protocol + task lifecycle
  (``_handle_push_back``, ``_create_council_task``).
- :mod:`council_settings_service` — LLM/runtime settings + dashboard
  (``_get_llm_settings``, ``_update_llm_settings``, ``_test_llm_connection``,
  ``_update_runtime_settings``, ``_get_dashboard_data``).
- :mod:`council_workflow_service` — workflows, Prometheus metrics, WebSocket
  (``_list_workflows``, ``_get_workflow``, ``_get_prometheus_metrics``,
  ``_handle_websocket``).

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

All LLM work is delegated to :class:`flowforge.llm.council_bridge.ForgekinLLMBridge`.
T1 — real LLM calls only (no mock). T7 — primary responses audited by a second
LLM. I11 — push back protocol (max 3 rounds, then escalate). T6 — metrics
collected for every chat message, LLM call, and T7 audit.
"""

from __future__ import annotations

import os
from dataclasses import asdict

from fastapi import APIRouter, HTTPException, WebSocket

# ── Re-export state for backward compatibility ───────────────────────────────
# verify.py does: `from flowforge.app.api.agents.council import state`
# main.py  does: `from ... import council; council.list_agents() / .send_message()`
# Both must keep working after the refactor.
from .council_state import state, tasks_store  # noqa: F401 — re-exported
from .council_helpers import (
    AVATARS,
    _bool_env,
    _find_forgekin_cfg,
    _forgekin_profile,
    _get_bridge,
    _get_forgekins,
)
from .council_chat_service import (
    _clear_messages,
    _process_chat_message,
)
from .council_task_service import (
    _create_council_task,
    _handle_push_back,
)
from .council_settings_service import (
    _get_dashboard_data,
    _get_llm_settings,
    _test_llm_connection,
    _update_llm_settings,
    _update_runtime_settings,
)
from .council_workflow_service import (
    _get_prometheus_metrics,
    _get_workflow,
    _handle_websocket,
    _list_workflows,
)

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
    return await _clear_messages()

# ── Endpoint: chat (real LLM responses) ──────────────────────────────────────

@router.post("/chat")
async def send_message(payload: dict) -> dict:
    """Accept a user message, route to forgekins, return real LLM responses.

    Request body: {"content": "...", "mentions": ["fk-wenxin"]}
    Response: {"user_message": {...}, "forgekin_responses": [...], "routing": [...]}
    """
    return await _process_chat_message(payload)

# ── Endpoint: bridge status ──────────────────────────────────────────────────

@router.get("/bridge")
async def bridge_status() -> dict:
    """Report the LLM bridge configuration for diagnostics."""
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
    return await _handle_push_back(payload)

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
    return await _get_llm_settings()

@router.put("/settings/llm")
async def update_llm_settings(payload: dict) -> dict:
    """Update LLM provider config (base_url + api_key) and hot-reload bridge."""
    return await _update_llm_settings(payload)

@router.post("/settings/llm/test")
async def test_llm_connection(payload: dict) -> dict:
    """Test the LLM connection by sending a minimal completion request."""
    return await _test_llm_connection(payload)

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
    return await _update_runtime_settings(payload)

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
    """Create a new task and dispatch it to the matching forgekin."""
    return await _create_council_task(payload)

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
# routes). The router is created with prefix="/api/v1/forgemind/council", so
# the decorator only needs "/ws" — the final registered path is
# /api/v1/forgemind/council/ws.
@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    await _handle_websocket(ws)

# ── Endpoints: dashboard, workflows, metrics ────────────────────────────────

@router.get("/dashboard")
async def dashboard() -> dict:
    """仪表盘数据 — JSON 格式，供前端看板渲染。"""
    return await _get_dashboard_data()

@router.get("/workflows")
async def list_workflows() -> dict:
    """列出所有 workflow 配置 — 扫描 config/workflows/*.yaml。"""
    return await _list_workflows()

@router.get("/workflows/{workflow_name}")
async def get_workflow(workflow_name: str) -> dict:
    """获取单个 workflow 配置详情。"""
    return await _get_workflow(workflow_name)

@router.get("/council-metrics")
async def prometheus_metrics():  # type: ignore[override] — return type is Response
    """Prometheus /council-metrics 端点 — 供 Prometheus 抓取。"""
    return await _get_prometheus_metrics()
