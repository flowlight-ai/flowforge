import uuid
from fastapi import APIRouter, HTTPException, Depends
from app.deps import get_executor
from core.task_context import TaskContext
from core.errors import ConflictError, ModeNotFoundError

router = APIRouter(prefix="/tasks", tags=["tasks"])

@router.post("", status_code=201)
async def create_task(payload: dict, executor = Depends(get_executor)):
    task_id = payload.get("task_id") or str(uuid.uuid4())
    persona = payload.get("persona", "default")
    input_data = payload.get("input_data", {})
    mode = payload.get("mode")
    interaction_mode = payload.get("interaction_mode", "standard")
    metadata = payload.get("metadata", {})

    context = TaskContext(
        task_id=task_id, persona=persona, input_data=input_data,
        metadata=metadata, mode=mode, interaction_mode=interaction_mode
    )
    try:
        result = await executor.run(context, mode_hint=mode)
    except ConflictError as e:
        raise HTTPException(status_code=409, detail=e.detail)
    except ModeNotFoundError as e:
        raise HTTPException(status_code=404, detail=e.detail)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {
        "status": "success",
        "data": {
            "task_id": task_id, "persona": persona,
            "mode": mode or executor.mode_registry.suggest_mode(input_data.get("task", "")),
            "interaction_mode": interaction_mode,
            "status": "completed", "result": result
        }
    }

@router.get("")
async def list_tasks():
    return {"status": "success", "data": {"items": [], "total": 0}}

@router.get("/{task_id}")
async def get_task(task_id: str):
    return {"status": "success", "data": {"task_id": task_id, "status": "unknown"}}

@router.post("/{task_id}/review")
async def submit_review(task_id: str, payload: dict, executor = Depends(get_executor)):
    verdict = payload.get("verdict")
    feedback = payload.get("feedback", "")
    edited_draft = payload.get("edited_content", "")
    await executor.submit_review(task_id, verdict, feedback, edited_draft)
    return {"status": "success", "data": {"task_id": task_id, "status": verdict}}

@router.post("/{task_id}/pause")
async def pause_task(task_id: str, executor = Depends(get_executor)):
    await executor.pause_task(task_id)
    return {"status": "success", "data": {"task_id": task_id, "status": "paused"}}

@router.post("/{task_id}/resume")
async def resume_task(task_id: str, executor = Depends(get_executor)):
    await executor.resume_task(task_id)
    return {"status": "success", "data": {"task_id": task_id, "status": "running"}}

@router.post("/{task_id}/cancel")
async def cancel_task(task_id: str):
    return {"status": "success", "data": {"task_id": task_id, "status": "cancelled"}}

@router.post("/{task_id}/skip")
async def skip_stage(task_id: str):
    return {"status": "success", "data": {"task_id": task_id, "skipped_stage": "current"}}
