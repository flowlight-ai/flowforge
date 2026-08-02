"""Forgekin Council — workflow listing, Prometheus metrics, and WebSocket.

Extracted from the original monolithic ``council_services.py`` so that
each service module stays under 500 lines. This module owns:

- Workflow config listing/detail (scans ``config/workflows/*.yaml``).
- Prometheus-format metrics export (``/council-metrics``).
- WebSocket connection lifecycle (accept, history, ping/pong, cleanup).

Imports are one-way: this module imports from :mod:`council_state` and
:mod:`council_helpers`, neither of which imports back (no circular deps).
"""

from __future__ import annotations

import json
from dataclasses import asdict

from fastapi import HTTPException, Response, WebSocket, WebSocketDisconnect

from flowforge.core.tracing import get_logger
from flowforge.web_legacy_backup.metrics import get_collector as _get_metrics_collector

from .council_helpers import (
    WORKFLOWS_DIR,
    _get_forgekins,
    _load_yaml,
)
from .council_state import state

logger = get_logger("flowforge.app.api.agents.council_workflow_service")


# ── Workflows (GET /workflows, GET /workflows/{name}) ─────────────────────────

async def _list_workflows() -> dict:
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


async def _get_workflow(workflow_name: str) -> dict:
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


# ── Prometheus metrics (GET /council-metrics) ────────────────────────────────

async def _get_prometheus_metrics() -> Response:
    """Prometheus 文本格式指标，供 Prometheus 抓取。

    包含聊天消息计数、LLM 调用统计、T7 审核分数等。路径从 /metrics 改为
    /council-metrics 以避免与 app/main.py 中已有的 /metrics 端点冲突。
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


# ── WebSocket connection handling (WS /ws) ────────────────────────────────────

async def _handle_websocket(ws: WebSocket) -> None:
    """Handle a WebSocket connection to the council channel.

    On connect: ensures forgekin greetings are seeded, accepts the
    connection, registers it in ``state.subscribers``, and sends the last
    20 messages as history. Then loops on ``receive_text`` — ``ping``
    receives ``pong``; any other message is logged as unexpected
    (protocol drift diagnostic). Cleans up the subscriber set on exit.
    """
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
