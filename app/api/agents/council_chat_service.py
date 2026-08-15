"""Forgekin Council — chat message processing services.

Extracted from the original monolithic ``council_services.py`` so that
each service module stays under 500 lines. This module owns the chat
business logic: routing a user message to forgekins and clearing the
in-memory message history.

Imports are one-way: this module imports from :mod:`council_state` and
:mod:`council_helpers`, neither of which imports back (no circular deps).
"""

from __future__ import annotations

import asyncio
import json
import uuid
from dataclasses import asdict
from types import SimpleNamespace

from fastapi import HTTPException, WebSocket

from flowforge.core.errors import LLMError
from flowforge.core.tracing import generate_trace_id, get_logger, set_trace_id
from flowforge.forgemind.external_agents import ExternalAgentError
from flowforge.llm.council_bridge import ForgekinReply, T7AuditResult
from flowforge.web_legacy_backup.metrics import get_collector as _get_metrics_collector

from .council_helpers import (
    AVATARS,
    _find_forgekin_cfg,
    _get_bridge,
    _get_forgekins,
    _route_message,
)
from .council_state import (
    ChatMessage,
    LLMMeta,
    T7Badge,
    _broadcast,
    state,
)

logger = get_logger("flowforge.app.api.agents.council_chat_service")


# ── Chat message processing (POST /chat) ─────────────────────────────────────

async def _broadcast_forgekin_error(
    fk_cfg: dict, fk_id: str, role: str, exc: Exception,
    bound_kind, chat_trace: str,
) -> ChatMessage:
    """灵智体调用失败时构建错误消息、广播并记录失败指标,返回错误 ChatMessage。"""
    logger.error(
        f"[trace_id={chat_trace}] call FAILED: fk={fk_id} role={role} "
        f"error={exc!r}", exc_info=True,
    )
    if isinstance(exc, ExternalAgentError):
        err_hint = (
            f"[{fk_cfg['name']}] ⚠️ 外部 Agent 调用失败（{bound_kind.value if bound_kind else 'unknown'}）。\n"
            f"错误：{exc!s}\n请检查该 CLI 是否已安装（PATH 或 %APPDATA%\\npm），"
            f"或访问 /admin/external-agents 配置 binary 路径。"
        )
    else:
        err_hint = (
            f"[{fk_cfg['name']}] ⚠️ LLM 调用失败，所有 fallback 均已耗尽。\n"
            f"错误：{exc!s}\n请检查 OpenRoute 服务 (端口 13001) 是否运行，"
            f"以及 config/llm_route.yaml 中的 fallback_chains 配置。"
        )
    error_msg = ChatMessage(
        message_id=f"msg-{uuid.uuid4().hex[:12]}",
        author_id=fk_id, author_name=fk_cfg["name"], author_role="forgekin",
        author_avatar=AVATARS.get(fk_id, "🤖"), content=err_hint,
        role=role, trace_id=chat_trace,
    )
    state.add(error_msg)
    await _broadcast(state, error_msg)
    _mc = _get_metrics_collector()
    _mc.inc_counter("flowforge_llm_calls_total", labels={
        "model": "unknown", "provider": "unknown",
        "role": role, "success": "false",
    })
    return error_msg


async def _audit_primary_t7(
    fk_cfg: dict, primary_output: str, chat_trace: str, bridge,
) -> T7Badge:
    """对 primary 灵智体产出执行 T7 审核(跨厂商独立审查),返回 T7Badge。"""
    primary_name = fk_cfg["name"]
    loop_type = fk_cfg.get("self_dev_loop", {}).get("loop_type", "")
    logger.info(f"[trace_id={chat_trace}] T7 audit start: primary={primary_name} loop={loop_type}")
    try:
        audit: T7AuditResult = await bridge.audit_t7(
            primary_name=primary_name,
            primary_output=primary_output,
            loop_type=loop_type,
        )
        logger.info(
            f"[trace_id={chat_trace}] T7 audit done: primary={primary_name} "
            f"score={audit.score:.2f} verdict={audit.verdict} "
            f"model={audit.model} latency={audit.latency_ms:.0f}ms"
        )
        return T7Badge(
            score=audit.score, verdict=audit.verdict, reasons=audit.reasons,
            model=audit.model, provider=audit.provider, latency_ms=audit.latency_ms,
            quality_threshold=audit.quality_threshold,
        )
    except LLMError as exc:
        logger.error(
            f"[trace_id={chat_trace}] T7 audit FAILED: primary={primary_name} error={exc!r}",
            exc_info=True,
        )
        return T7Badge(
            score=0.0, verdict="fail",
            reasons=[f"T7 audit LLM call failed: {exc!s}"],
            model="", provider="", latency_ms=0.0,
            quality_threshold=bridge._quality_threshold,
        )


async def _forgekin_turn(
    route: dict, content: str, chat_trace: str,
    fk_cfgs: dict[str, dict], bridge, use_external_agent: bool,
    recent_context: list | None = None,
    discussant_texts: list[str] | None = None,
) -> ChatMessage | None:
    """执行单个灵智体的完整回复回合。

    包含: 配置查找→上下文构建→LLM/外部Agent调用→错误处理→
    指标采集→T7审核(仅primary)→状态写入→WebSocket广播。
    返回 ChatMessage(成功/错误); 配置缺失返回 None。
    discussant_texts 用于 @all 模式下 primary 汇总讨论者回复。
    """
    fk_id = route["forgekin_id"]
    role = route["role"]
    fk_cfg = _find_forgekin_cfg(fk_cfgs, fk_id)
    if not fk_cfg:
        logger.warning(
            f"[trace_id={chat_trace}] routing referenced unknown "
            f"forgekin_id={fk_id}, skipping"
        )
        return None

    await asyncio.sleep(route.get("delay_ms", 0) / 1000.0)
    ctx = recent_context if recent_context is not None else state.get_context(limit=6)
    # @all 并行模式: primary 汇总时注入 discussant 回复作为额外上下文
    if discussant_texts:
        ctx = list(ctx) + [
            SimpleNamespace(author_name="讨论者", content=t) for t in discussant_texts
        ]

    # 外部 Agent 仅 primary 角色可用; discussant/reviewer 始终走 LLM 网关
    bound_kind = bridge.find_external_agent_for_forgekin(fk_cfg) if (use_external_agent and role == "primary") else None
    logger.info(
        f"[trace_id={chat_trace}] LLM call start: fk={fk_id} role={role} "
        f"context_msgs={len(ctx) if ctx else 0} "
        f"route={'external' if bound_kind else 'llm'}"
    )
    try:
        if bound_kind is not None:
            reply: ForgekinReply = await bridge.respond_via_external_agent(
                fk_cfg, role=role, user_content=content, recent_context=ctx,
            )
        else:
            reply: ForgekinReply = await bridge.respond(
                fk_cfg, role=role, user_content=content, recent_context=ctx,
                push_back_round=state.push_back_rounds,
            )
    except (LLMError, ExternalAgentError) as exc:
        return await _broadcast_forgekin_error(fk_cfg, fk_id, role, exc, bound_kind, chat_trace)

    llm_meta = LLMMeta(
        model=reply.model, provider=reply.provider, latency_ms=reply.latency_ms,
        finish_reason=reply.finish_reason, chain=bridge.DEFAULT_CHAIN,
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
        f"model={reply.model} latency={reply.latency_ms:.0f}ms len={len(reply.text)}"
    )

    # T7 审核: 仅 primary 产出需审核(T7 铁律)
    t7_badge: T7Badge | None = None
    if role == "primary":
        t7_badge = await _audit_primary_t7(fk_cfg, reply.text, chat_trace, bridge)
        _mc.inc_counter("flowforge_t7_audit_total", labels={"verdict": t7_badge.verdict})
        _mc.set_gauge("flowforge_t7_audit_score", t7_badge.score)

    response_msg = ChatMessage(
        message_id=f"msg-{uuid.uuid4().hex[:12]}",
        author_id=fk_id, author_name=fk_cfg["name"], author_role="forgekin",
        author_avatar=AVATARS.get(fk_id, "🤖"), content=reply.text, role=role,
        llm_meta=llm_meta, t7_badge=t7_badge, trace_id=chat_trace,
    )
    state.add(response_msg)
    await _broadcast(state, response_msg)
    return response_msg


async def _run_parallel_discussion(
    routing: list[dict], content: str, chat_trace: str,
    fk_cfgs: dict[str, dict], bridge, use_external_agent: bool,
) -> list[dict]:
    """@all 并行讨论: discussant 先并行回复, primary 最后汇总。

    discussant 看到的是讨论前的基础上下文(彼此不可见);
    primary 看到基础上下文 + 全部 discussant 回复后进行汇总。
    """
    discussant_routes = [r for r in routing if r["role"] == "discussant"]
    primary_route = next((r for r in routing if r["role"] == "primary"), None)
    responses: list[dict] = []

    # 讨论前快照: 所有 discussant 共享同一基础上下文
    base_context = state.get_context(limit=6)

    # 1. discussant 并行回复
    tasks = [
        _forgekin_turn(r, content, chat_trace, fk_cfgs, bridge, use_external_agent, recent_context=base_context)
        for r in discussant_routes
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    discussant_texts: list[str] = []
    for r in results:
        if isinstance(r, ChatMessage):
            responses.append(asdict(r))
            discussant_texts.append(r.content)
        elif isinstance(r, Exception):
            logger.error(f"[trace_id={chat_trace}] discussant 异常: {r!r}")

    # 2. primary 汇总所有讨论
    if primary_route:
        primary_msg = await _forgekin_turn(
            primary_route, content, chat_trace, fk_cfgs, bridge, use_external_agent,
            recent_context=base_context, discussant_texts=discussant_texts,
        )
        if primary_msg:
            responses.append(asdict(primary_msg))

    return responses


async def _process_chat_message(payload: dict) -> dict:
    """Route a user message to forgekins and return real LLM responses.

    Implements the body of the ``POST /chat`` endpoint: generates a
    per-chat ``trace_id``, routes to forgekins via @mention rules
    (serial by default, parallel for @all), calls the LLM bridge (or
    external agent when requested), runs T7 audit on primary responses,
    collects metrics (T6), and broadcasts each forgekin reply over WebSocket.
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

    # @mention 路由: @all→并行讨论, @具体灵智体→单回复, 无@→最近回复灵智体
    routing = _route_message(content, fk_cfgs, mentions, state.messages)
    strategy = routing[0].get("strategy", "serial") if routing else "serial"
    logger.info(
        f"[trace_id={chat_trace}] routing: {len(routing)} forgekin(s) "
        f"strategy={strategy} fk_ids={[r['forgekin_id'] for r in routing]}"
    )

    if strategy == "parallel":
        responses = await _run_parallel_discussion(
            routing, content, chat_trace, fk_cfgs, bridge, use_external_agent,
        )
    else:
        responses: list[dict] = []
        for route in routing:
            msg = await _forgekin_turn(
                route, content, chat_trace, fk_cfgs, bridge, use_external_agent,
            )
            if msg:
                responses.append(asdict(msg))

    return {
        "user_message": asdict(user_msg),
        "forgekin_responses": responses,
        "routing": routing,
    }


# ── Message clearing (POST /messages/clear) ──────────────────────────────────

async def _clear_messages() -> dict:
    """Clear all in-memory messages, reset push back state, re-seed greetings.

    Broadcasts a ``messages_cleared`` event to all WebSocket subscribers so
    the UI can reset its view immediately.
    """
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
