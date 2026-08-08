"""Plan API — Helm 模式计划管理端点：查询、生成、确认、编辑、拒绝。"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from flowforge.core.tracing import get_logger
from flowforge.memory.helm_db import HelmDatabase

logger = get_logger("flowforge.plans_api")

router = APIRouter(prefix="/api/v1/tasks", tags=["plans"])

# ── 模块级单例 ──

_helm_db: HelmDatabase | None = None


def get_helm_db() -> HelmDatabase:
    global _helm_db
    if _helm_db is None:
        _helm_db = HelmDatabase()
    return _helm_db


# ── 请求模型 ──


class GeneratePlanRequest(BaseModel):
    intent: str
    persona: Optional[str] = None
    mode: Optional[str] = None


class GeneratePlanLLMRequest(BaseModel):
    intent: str
    persona: Optional[str] = None
    mode: Optional[str] = None
    conversation_context: Optional[list[dict[str, str]]] = None


class UpdatePlanRequest(BaseModel):
    new_message: str
    conversation_context: Optional[list[dict[str, str]]] = None


class UpdateStepStatusRequest(BaseModel):
    status: str  # pending | running | completed | failed | skipped
    result_summary: Optional[str] = None


class ConfirmPlanRequest(BaseModel):
    plan_id: int
    edited_steps: Optional[list[dict[str, Any]]] = None


class UpdateStepRequest(BaseModel):
    name: Optional[str] = None
    task: Optional[str] = None
    agent: Optional[str] = None
    tool: Optional[str] = None
    mode: Optional[str] = None


# ── 响应辅助 ──


def _make_response(data: Any) -> dict[str, Any]:
    return {"success": True, "data": data}


def _make_error(code: str, message: str) -> dict[str, Any]:
    return {"success": False, "error": {"code": code, "message": message}}


# ── 端点 ──


@router.get("/{task_id}/plan")
async def get_plan(task_id: str):
    """获取指定任务的最新计划。"""
    db = get_helm_db()
    plan = db.get_plan_by_task(task_id)

    if plan is None:
        raise HTTPException(
            status_code=404,
            detail=_make_error("PLAN_NOT_FOUND", f"任务 {task_id} 暂无计划"),
        )

    return _make_response(plan)


@router.post("/{task_id}/plan")
async def generate_plan(task_id: str, body: GeneratePlanRequest):
    """为指定任务生成新计划（创建 pending 记录，LLM 生成异步执行）。"""
    db = get_helm_db()

    # 占位步骤：实际 LLM 生成由任务执行系统异步触发
    placeholder_steps: list[dict[str, Any]] = [
        {
            "name": "执行意图",
            "task": body.intent,
            "agent": "generic",
            "tool": None,
            "mode": body.mode or "pipeline",
        }
    ]

    plan_id = db.create_plan(
        task_id=task_id,
        title=body.intent,
        steps=placeholder_steps,
        description=f"基于意图「{body.intent}」生成的计划",
        persona=body.persona,
        mode=body.mode,
    )

    plan = db.get_plan(plan_id)
    logger.info("计划已创建: task_id=%s, plan_id=%s", task_id, plan_id)

    return _make_response(plan)


@router.post("/{task_id}/plan/confirm")
async def confirm_plan(task_id: str, body: ConfirmPlanRequest):
    """确认计划，将状态更新为 confirmed。"""
    db = get_helm_db()
    plan = db.get_plan(body.plan_id)

    if plan is None:
        raise HTTPException(
            status_code=404,
            detail=_make_error("PLAN_NOT_FOUND", f"计划 {body.plan_id} 不存在"),
        )

    if plan["task_id"] != task_id:
        raise HTTPException(
            status_code=400,
            detail=_make_error("PLAN_TASK_MISMATCH", "计划与任务不匹配"),
        )

    # 如果提供了编辑后的步骤，更新 steps_json
    if body.edited_steps is not None:
        db.update_plan_steps_json(body.plan_id, body.edited_steps, len(body.edited_steps))

    db.update_plan_status(body.plan_id, HelmDatabase.PLAN_CONFIRMED)

    plan = db.get_plan(body.plan_id)
    logger.info("计划已确认: plan_id=%s", body.plan_id)

    return _make_response(plan)


@router.patch("/{task_id}/plan/steps/{step_index}")
async def update_step(task_id: str, step_index: int, body: UpdateStepRequest):
    """更新计划中指定步骤的部分字段。"""
    db = get_helm_db()
    plan = db.get_plan_by_task(task_id)

    if plan is None:
        raise HTTPException(
            status_code=404,
            detail=_make_error("PLAN_NOT_FOUND", f"任务 {task_id} 暂无计划"),
        )

    steps: list[dict[str, Any]] = plan["steps_json"]

    if step_index < 0 or step_index >= len(steps):
        raise HTTPException(
            status_code=400,
            detail=_make_error("STEP_INDEX_OUT_OF_RANGE", f"步骤索引 {step_index} 超出范围（0-{len(steps) - 1}）"),
        )

    # 合并部分更新
    step = steps[step_index]
    update_fields = body.model_dump(exclude_none=True)
    step.update(update_fields)
    steps[step_index] = step

    # 更新 steps_json
    db.update_plan_steps_json_only(plan["id"], steps)

    # 将步骤名称加入 edited_steps
    edited_steps: list[str] = plan.get("edited_steps") or []
    step_name = step.get("name", f"step_{step_index}")
    if step_name not in edited_steps:
        edited_steps.append(step_name)

    db.update_plan_status(plan["id"], plan["status"], edited_steps=edited_steps)

    plan = db.get_plan(plan["id"])
    logger.info("步骤已更新: task_id=%s, step_index=%d", task_id, step_index)

    return _make_response(plan)


@router.post("/{task_id}/plan/reject")
async def reject_plan(task_id: str):
    """拒绝当前计划，将状态更新为 rejected。"""
    db = get_helm_db()
    plan = db.get_plan_by_task(task_id)

    if plan is None:
        raise HTTPException(
            status_code=404,
            detail=_make_error("PLAN_NOT_FOUND", f"任务 {task_id} 暂无计划"),
        )

    db.update_plan_status(plan["id"], HelmDatabase.PLAN_REJECTED)

    plan = db.get_plan(plan["id"])
    logger.info("计划已拒绝: task_id=%s, plan_id=%s", task_id, plan["id"])

    return _make_response(plan)


@router.post("/{task_id}/plan/generate")
async def generate_plan_llm(task_id: str, body: GeneratePlanLLMRequest):
    """Use LLM to generate a real plan (not placeholder)."""
    from flowforge.brain.plan_generator import PlanGenerator
    from flowforge.tools.llm_client import LLMClient

    llm = LLMClient()  # Uses default config
    generator = PlanGenerator(llm)

    steps = await generator.generate(
        intent=body.intent,
        persona=body.persona or "default",
        mode=body.mode or "pipeline",
        conversation_context=body.conversation_context,
    )

    db = get_helm_db()
    steps_dicts = [s.model_dump(exclude_none=True) for s in steps]

    plan_id = db.create_plan(
        task_id=task_id,
        title=body.intent,
        steps=steps_dicts,
        description=f"基于意图「{body.intent}」由 LLM 生成的计划",
        persona=body.persona,
        mode=body.mode,
    )

    # Initialize steps_status
    steps_status = {str(i): "pending" for i in range(len(steps))}
    db.update_plan_steps_status(plan_id, steps_status)

    plan = db.get_plan(plan_id)
    return _make_response(plan)


@router.post("/{task_id}/plan/update")
async def update_plan(task_id: str, body: UpdatePlanRequest):
    """Incrementally update plan based on new message."""
    from flowforge.brain.plan_generator import PlanGenerator
    from flowforge.tools.llm_client import LLMClient

    db = get_helm_db()
    plan = db.get_plan_by_task(task_id)
    if plan is None:
        raise HTTPException(status_code=404, detail=_make_error("PLAN_NOT_FOUND", "任务暂无计划"))

    # Get completed steps
    steps_status = json.loads(plan.get("steps_status") or "{}")
    completed = [int(k) for k, v in steps_status.items() if v == "completed"]

    # Get conversation context
    context = body.conversation_context or json.loads(plan.get("conversation_context") or "[]")

    llm = LLMClient()
    generator = PlanGenerator(llm)

    delta = await generator.update(
        existing_plan=plan["steps_json"],
        new_message=body.new_message,
        completed_steps=completed,
        conversation_context=context,
        persona=plan.get("persona", "default"),
    )

    # Apply delta with optimistic concurrency
    expected_version = plan.get("plan_version", 1)
    updated = db.update_plan_incremental(plan["id"], delta, expected_version)

    if updated is None:
        raise HTTPException(status_code=409, detail=_make_error("VERSION_CONFLICT", "计划版本冲突，请重试"))

    # Update conversation context
    if body.conversation_context:
        db.update_conversation_context(plan["id"], body.conversation_context)

    return _make_response(updated)


@router.patch("/{task_id}/plan/steps/{step_index}/status")
async def update_step_status(task_id: str, step_index: int, body: UpdateStepStatusRequest):
    """Update a step's execution status."""
    db = get_helm_db()
    plan = db.get_plan_by_task(task_id)
    if plan is None:
        raise HTTPException(status_code=404, detail=_make_error("PLAN_NOT_FOUND", "任务暂无计划"))

    if body.status not in ("pending", "running", "completed", "failed", "skipped"):
        raise HTTPException(status_code=400, detail=_make_error("INVALID_STATUS", f"无效状态: {body.status}"))

    ok = db.update_step_status(plan["id"], step_index, body.status, body.result_summary)
    if not ok:
        raise HTTPException(status_code=500, detail=_make_error("UPDATE_FAILED", "步骤状态更新失败"))

    return _make_response(db.get_plan(plan["id"]))
