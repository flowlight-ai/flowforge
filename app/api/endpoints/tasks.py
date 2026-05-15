import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends, Query
from flowforge.app.deps import get_executor
from flowforge.core.task_context import TaskContext
from flowforge.core.errors import ConflictError, ModeNotFoundError
from flowforge.core.tracing import get_trace_id

router = APIRouter(prefix="/tasks", tags=["tasks"])


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
    task_id = payload.get("task_id") or str(uuid.uuid4())
    persona = payload.get("persona", "default")
    input_data = payload.get("input_data", {})
    mode = payload.get("mode")
    interaction_mode = payload.get("interaction_mode", "standard")
    metadata = payload.get("metadata", {})

    context = TaskContext(
        task_id=task_id, persona=persona, input_data=input_data,
        metadata=metadata, mode=mode, interaction_mode=interaction_mode,
    )
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
    feedback = payload.get("feedback", "")
    edited_draft = payload.get("edited_content", "")
    await executor.submit_review(task_id, verdict, feedback, edited_draft)
    updated = executor.state_manager.load_state(task_id) or {}
    return _make_response({"task_id": task_id, "status": updated.get("status", verdict), "verdict": verdict})


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
    executor.state_manager.update_state(task_id, {"status": "cancelled"})
    executor.event_bus.emit(task_id, "task.cancelled", {"reason": "manual"})
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
