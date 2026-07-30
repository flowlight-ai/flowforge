import asyncio
import uuid
import os
from datetime import datetime, timezone
from pathlib import Path
from fastapi import APIRouter, HTTPException, Depends, Query
from flowforge.app.deps import get_executor
from flowforge.core.task_context import TaskContext
from flowforge.core.errors import ConflictError, ModeNotFoundError
from flowforge.core.tracing import get_trace_id, get_logger, set_trace_id, generate_trace_id

logger = get_logger("tasks_api")

router = APIRouter(prefix="/tasks", tags=["tasks"])

# 合法 workflow 名称缓存
_VALID_WORKFLOWS: set | None = None


def _get_valid_workflows() -> set:
    """获取所有合法的 workflow 名称（从 YAML 文件目录扫描）"""
    global _VALID_WORKFLOWS
    if _VALID_WORKFLOWS is not None:
        return _VALID_WORKFLOWS

    workflows = set()
    # 业务 workflow 目录
    biz_dir = Path(__file__).parent.parent.parent.parent / "workflows"
    if biz_dir.exists():
        for f in biz_dir.glob("*.yaml"):
            workflows.add(f.stem)
    # 通用 workflow 目录
    gen_dir = Path(__file__).parent.parent.parent.parent / "config" / "workflows"
    if gen_dir.exists():
        for f in gen_dir.glob("*.yaml"):
            workflows.add(f.stem)

    _VALID_WORKFLOWS = workflows
    logger.info(f"Loaded {len(workflows)} valid workflows: {workflows}")
    return workflows


def _load_workflow_steps(workflow_name: str) -> list:
    """根据 workflow 名称加载 YAML 步骤定义"""
    import yaml

    # 业务 workflow 优先
    biz_path = Path(__file__).parent.parent.parent.parent / "workflows" / f"{workflow_name}.yaml"
    if biz_path.exists():
        with open(biz_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        return data.get("steps", [])

    # 通用 workflow
    gen_path = Path(__file__).parent.parent.parent.parent / "config" / "workflows" / f"{workflow_name}.yaml"
    if gen_path.exists():
        with open(gen_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        return data.get("steps", [])

    return []


def _make_response(data: dict) -> dict:
    return {
        "status": "success",
        "data": data,
        "meta": {"trace_id": get_trace_id(), "timestamp": datetime.now(timezone.utc).isoformat() + "Z"},
    }


def _make_error(code: str, message: str, details: dict = None) -> dict:
    return {
        "status": "error",
        "error": {"code": code, "message": message, "details": details or {}},
        "meta": {"trace_id": get_trace_id(), "timestamp": datetime.now(timezone.utc).isoformat() + "Z"},
    }


@router.post("", status_code=201)
async def create_task(payload: dict, executor=Depends(get_executor)):
    # 为每个任务生成独立 trace_id，贯穿任务调度→LLM调用→完成全链路
    # 中间件可能已设置 trace_id，此处确保存在并显式用于日志关联
    trace_id = set_trace_id(generate_trace_id())
    # ── Input validation ──
    intent = payload.get("intent", "")
    # Support 'task' field as alias for 'intent'
    if not intent and payload.get("task"):
        intent = payload["task"]
    input_data = payload.get("input_data", {})
    logger.info(
        f"[trace_id={trace_id}] create_task: intent={intent!r}, "
        f"input_data_keys={list(input_data.keys()) if input_data else 'empty'}"
    )
    if not intent and not input_data:
        logger.warning(f"Input validation failed: empty intent and input_data")
        raise HTTPException(
            status_code=422,
            detail=_make_error("MISSING_INPUT", "Either 'intent' or 'input_data' must be provided")
        )
    if intent and not isinstance(intent, str):
        raise HTTPException(
            status_code=422,
            detail=_make_error("INVALID_INPUT", "'intent' must be a string")
        )
    if intent and len(intent.strip()) == 0 and not input_data:
        raise HTTPException(
            status_code=422,
            detail=_make_error("EMPTY_INPUT", "'intent' cannot be empty or whitespace-only")
        )

    task_id = payload.get("task_id") or str(uuid.uuid4())
    persona = payload.get("persona", "default")
    logger.info(
        f"[trace_id={trace_id}] create_task: task_id={task_id} persona={persona} "
        f"intent={intent[:60]!r}"
    )
    if intent and not input_data:
        input_data = {"task": intent}
    mode = payload.get("mode")
    interaction_mode = payload.get("interaction_mode", "helm")
    valid_modes = {"normal", "helm", "auto"}
    if interaction_mode not in valid_modes:
        interaction_mode = "helm"
    if mode == "helm":
        mode = "workflow"

    # Mode validation
    valid_exec_modes = {"workflow", "react", "plan_execute", "reflexion", "multi_agent",
                        "rewoo", "self_discover", "agent_judge", "graph_of_thoughts"}
    if mode and mode not in valid_exec_modes:
        raise HTTPException(
            status_code=422,
            detail=_make_error("INVALID_MODE", f"Mode '{mode}' is not valid. Valid modes: {sorted(valid_exec_modes)}")
        )

    # Workflow 参数验证和步骤加载
    workflow = payload.get("workflow")
    if workflow:
        valid_workflows = _get_valid_workflows()
        if workflow not in valid_workflows:
            raise HTTPException(
                status_code=400,
                detail=_make_error("INVALID_WORKFLOW", f"Workflow '{workflow}' does not exist. Valid: {sorted(valid_workflows)}")
            )
        # 加载 workflow 步骤到 metadata
        steps = _load_workflow_steps(workflow)
        if not steps:
            raise HTTPException(
                status_code=400,
                detail=_make_error("EMPTY_WORKFLOW", f"Workflow '{workflow}' has no steps defined")
            )
        metadata = payload.get("metadata", {})
        metadata["sop_steps"] = steps
        metadata["workflow_name"] = workflow
        payload["metadata"] = metadata

    metadata = payload.get("metadata", {})
    # Forward top-level model param into metadata so workflow executor can use it
    model_param = payload.get("model")
    if model_param and "model" not in metadata:
        metadata["model"] = model_param

    context = TaskContext(
        task_id=task_id, persona=persona, input_data=input_data,
        metadata=metadata, mode=mode, interaction_mode=interaction_mode,
    )

    if interaction_mode in ("helm", "auto", "normal"):
        try:
            from flowforge.core.workspace import get_workspace_manager
            ws = get_workspace_manager()
            workspace_name = payload.get("workspace", "default")
            ws.add_task_to_workspace(workspace_name, task_id, metadata={
                "persona": persona, "mode": mode or "workflow",
                "interaction_mode": interaction_mode,
                "intent": intent[:200] if intent else "",
            })
            if intent:
                ws.save_message(task_id, {
                    "role": "user", "content": intent,
                    "model": payload.get("model", "auto"),
                })
        except Exception as e:
            logger.warning(f"Failed to create workspace for task {task_id}: {e}")

        asyncio.ensure_future(_run_task_background(executor, context, mode or "workflow", trace_id))
        return _make_response({
            "task_id": task_id, "persona": persona,
            "mode": mode or "workflow",
            "interaction_mode": interaction_mode,
            "status": "running",
        })

    try:
        result = await executor.run(context, mode_hint=mode)
    except ConflictError as e:
        raise HTTPException(status_code=409, detail=_make_error("CONFLICT", e.detail))
    except ModeNotFoundError as e:
        raise HTTPException(status_code=404, detail=_make_error("MODE_NOT_FOUND", e.detail))
    except Exception as e:
        raise HTTPException(status_code=500, detail=_make_error("INTERNAL_ERROR", str(e)))

    return _make_response({
        "task_id": task_id, "persona": persona,
        "mode": mode or executor.mode_registry.suggest_mode(input_data.get("task", "")),
        "interaction_mode": interaction_mode,
        "status": "completed", "result": result,
    })


async def _run_task_background(executor, context: TaskContext, mode_hint: str, trace_id: str = ""):
    # 后台任务需重新设置 trace_id（ContextVar 在新 asyncio.Task 中不自动继承）
    if trace_id:
        set_trace_id(trace_id)
    logger.info(
        f"[trace_id={trace_id or get_trace_id()}] _run_task_background: dispatching "
        f"task_id={context.task_id} mode={mode_hint}"
    )
    try:
        await executor.run(context, mode_hint=mode_hint)
        logger.info(
            f"[trace_id={trace_id or get_trace_id()}] _run_task_background: task_id={context.task_id} completed"
        )
    except Exception as e:
        logger.error(
            f"[trace_id={trace_id or get_trace_id()}] _run_task_background: "
            f"task_id={context.task_id} failed: {e}",
            exc_info=True,
        )


@router.get("")
async def list_tasks(
    persona: str = Query(None),
    status: str = Query(None),
    mode: str = Query(None),
    interaction_mode: str = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    executor=Depends(get_executor),
):
    result = executor.state_manager.list_states_with_data(
        persona=persona, status=status, mode=mode,
        interaction_mode=interaction_mode, limit=limit, offset=offset,
    )
    return _make_response(result)


@router.get("/{task_id}")
async def get_task(task_id: str, executor=Depends(get_executor)):
    state = executor.state_manager.load_state(task_id)
    if state is None:
        raise HTTPException(status_code=404, detail=_make_error("NOT_FOUND", f"Task {task_id} not found"))
    return _make_response(state)


@router.post("/{task_id}/review")
async def submit_review(task_id: str, payload: dict, executor=Depends(get_executor)):
    state = executor.state_manager.load_state(task_id)
    if state is None:
        raise HTTPException(status_code=404, detail=_make_error("NOT_FOUND", f"Task {task_id} not found"))
    verdict = payload.get("verdict")
    valid_verdicts = {"pass", "reject", "revise", "approve", "deny"}
    if not verdict or verdict not in valid_verdicts:
        raise HTTPException(
            status_code=422,
            detail=_make_error("INVALID_VERDICT", f"'verdict' must be one of {sorted(valid_verdicts)}, got: {verdict!r}")
        )
    feedback = payload.get("feedback", "")
    edited_draft = payload.get("edited_content", "")
    await executor.submit_review(task_id, verdict, feedback, edited_draft)
    updated = executor.state_manager.load_state(task_id) or {}
    return _make_response({"task_id": task_id, "status": updated.get("status", verdict), "verdict": verdict})


@router.post("/{task_id}/feedback")
async def submit_feedback(task_id: str, payload: dict, executor=Depends(get_executor)):
    """Submit user feedback (like/dislike) for a specific message in a task."""
    state = executor.state_manager.load_state(task_id)
    if state is None:
        raise HTTPException(status_code=404, detail=_make_error("NOT_FOUND", f"Task {task_id} not found"))
    message_id = payload.get("message_id", "")
    feedback_type = payload.get("feedback")  # "like" or "dislike"
    if feedback_type not in ("like", "dislike"):
        raise HTTPException(status_code=422, detail=_make_error("INVALID_FEEDBACK", "'feedback' must be 'like' or 'dislike'"))
    # Store feedback in task metadata
    feedbacks = state.get("feedbacks", {}) if isinstance(state, dict) else {}
    feedbacks[message_id] = feedback_type
    executor.state_manager.update_state(task_id, {"feedbacks": feedbacks})
    return _make_response({"task_id": task_id, "message_id": message_id, "feedback": feedback_type})


@router.post("/{task_id}/pause")
async def pause_task(task_id: str, executor=Depends(get_executor)):
    state = executor.state_manager.load_state(task_id)
    if state is None:
        raise HTTPException(status_code=404, detail=_make_error("NOT_FOUND", f"Task {task_id} not found"))
    await executor.pause_task(task_id)
    return _make_response({"task_id": task_id, "status": "paused"})


@router.post("/{task_id}/resume")
async def resume_task(task_id: str, executor=Depends(get_executor)):
    state = executor.state_manager.load_state(task_id)
    if state is None:
        raise HTTPException(status_code=404, detail=_make_error("NOT_FOUND", f"Task {task_id} not found"))
    await executor.resume_task(task_id)
    return _make_response({"task_id": task_id, "status": "running"})


@router.post("/{task_id}/cancel")
async def cancel_task(task_id: str, executor=Depends(get_executor)):
    state = executor.state_manager.load_state(task_id)
    if state is None:
        raise HTTPException(status_code=404, detail=_make_error("NOT_FOUND", f"Task {task_id} not found"))
    await executor.cancel_task(task_id)
    return _make_response({"task_id": task_id, "status": "cancelled"})


@router.post("/{task_id}/skip")
async def skip_stage(task_id: str, payload: dict = None, executor=Depends(get_executor)):
    state = executor.state_manager.load_state(task_id)
    if state is None:
        raise HTTPException(status_code=404, detail=_make_error("NOT_FOUND", f"Task {task_id} not found"))
    current_stage = state.get("current_stage", "unknown")
    payload = payload or {}
    skip_to = payload.get("skip_to")
    updates = {"status": "running", "skipped_stage": current_stage}
    if skip_to:
        updates["current_stage"] = skip_to
    executor.state_manager.update_state(task_id, updates)
    executor.event_bus.emit(task_id, "task.stage_skipped", {"skipped": current_stage, "skip_to": skip_to})
    return _make_response({"task_id": task_id, "skipped_stage": current_stage, "skip_to": skip_to})


@router.get("/{task_id}/events")
async def get_task_events(task_id: str, executor=Depends(get_executor)):
    """获取任务的所有事件：workspace 消息 + 审计日志"""
    state = executor.state_manager.load_state(task_id)
    if state is None:
        raise HTTPException(status_code=404, detail=_make_error("NOT_FOUND", f"Task {task_id} not found"))

    events = []

    # 1. 从 workspace 加载聊天消息
    try:
        from flowforge.core.workspace import get_workspace_manager
        ws = get_workspace_manager()
        messages = ws.load_messages(task_id)
        for msg in messages:
            events.append({
                "type": "message",
                "timestamp": msg.get("timestamp", ""),
                "data": {
                    "role": msg.get("role", ""),
                    "content": msg.get("content", ""),
                    "model": msg.get("model"),
                },
            })
    except Exception as e:
        logger.warning(f"Failed to load workspace messages for task {task_id}: {e}")

    # 2. 从审计日志数据库加载事件
    try:
        from flowforge.app.api.core.logs import get_audit_logger
        audit = get_audit_logger()
        result = audit.query(task_id=task_id, limit=200)
        for item in result.get("items", []):
            events.append({
                "type": "audit",
                "timestamp": item.get("timestamp", ""),
                "data": {
                    "level": item.get("level", ""),
                    "action": item.get("action", ""),
                    "mode": item.get("mode", ""),
                    "details": item.get("details", {}),
                    "trace_id": item.get("trace_id", ""),
                },
            })
    except Exception as e:
        logger.warning(f"Failed to load audit logs for task {task_id}: {e}")

    # 按时间戳排序
    events.sort(key=lambda e: e.get("timestamp", ""))

    return _make_response({"events": events, "count": len(events)})
