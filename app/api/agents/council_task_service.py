"""Forgekin Council — task and push back protocol services.

Extracted from the original monolithic ``council_services.py`` so that
each service module stays under 500 lines. This module owns the I11
push back protocol (max 3 rounds before operator escalation) and the
in-memory task lifecycle (create → dispatch → completed/failed).

Imports are one-way: this module imports from :mod:`council_state` and
:mod:`council_helpers`, neither of which imports back (no circular deps).
"""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import asdict

from fastapi import HTTPException

from flowforge.core.errors import LLMError
from flowforge.core.tracing import generate_trace_id, get_logger, set_trace_id

from .council_helpers import (
    AVATARS,
    _PERSONA_TO_FORGEKIN,
    _find_forgekin_cfg,
    _get_bridge,
    _get_forgekins,
)
from .council_state import (
    ChatMessage,
    Task,
    _broadcast,
    state,
    tasks_store,
)

logger = get_logger("flowforge.app.api.agents.council_task_service")


# ── Push back protocol (POST /push_back) ──────────────────────────────────────

async def _handle_push_back(payload: dict) -> dict:
    """Trigger an I11 push-back round against a forgekin.

    Enforces the invariant: at most ``push_back_max_rounds`` (default 3)
    rounds per topic; after that, escalate to the operator. Each round is
    broadcast as a ``push_back``-role chat message.
    """
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


# ── Task creation (POST /tasks) ───────────────────────────────────────────────

async def _create_council_task(payload: dict) -> dict:
    """Create a task and dispatch it to the matching forgekin in the background.

    Generates a per-task ``trace_id`` (preserved into the background
    asyncio.Task via ``set_trace_id``), validates the persona mapping,
    creates an in-memory :class:`Task`, and fires off ``_run_task`` which
    calls ``bridge.respond``. The HTTP response returns immediately with
    status ``running``; the operator polls ``GET /tasks/{id}`` for
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
