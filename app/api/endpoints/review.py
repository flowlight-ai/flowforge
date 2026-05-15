from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends
from flowforge.app.deps import get_executor
from flowforge.core.tracing import get_trace_id

router = APIRouter(prefix="/review", tags=["review"])


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


@router.get("/queue")
async def get_review_queue(executor=Depends(get_executor)):
    result = executor.state_manager.list_states_with_data(
        status="waiting_review", limit=100, offset=0,
    )
    return _make_response(result)


@router.get("/{task_id}")
async def get_review_detail(task_id: str, executor=Depends(get_executor)):
    state = executor.state_manager.load_state(task_id)
    if state is None:
        raise HTTPException(status_code=404, detail=_make_error("NOT_FOUND", f"Task {task_id} not found"))
    review_data = {
        "task_id": task_id,
        "status": state.get("status"),
        "persona": state.get("persona"),
        "mode": state.get("mode"),
        "input_data": state.get("input_data"),
        "result": state.get("result"),
        "review_verdict": state.get("review_verdict"),
        "review_feedback": state.get("review_feedback"),
        "updated_at": state.get("updated_at"),
    }
    return _make_response(review_data)
