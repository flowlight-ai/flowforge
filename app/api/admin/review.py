from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from flowforge.app.deps import get_executor
from flowforge.core.tracing import get_trace_id

router = APIRouter(prefix="/review", tags=["review"])


class ReviewDecision(BaseModel):
    """Review decision submitted by a human reviewer."""
    verdict: str = Field(..., description="Review verdict: pass, reject, or revise")
    feedback: str = Field(default="", description="Reviewer feedback comments")
    edited_draft: str = Field(default="", description="Edited draft content from reviewer")


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


@router.post("/{task_id}/review")
async def submit_review(task_id: str, decision: ReviewDecision, executor=Depends(get_executor)):
    """Submit a review decision for a task.

    Accepts a human reviewer's verdict (pass/reject/revise) and optional
    feedback or edited draft.  Resumes the LangGraph workflow by signaling
    the review event so the paused task can continue execution.
    """
    state = executor.state_manager.load_state(task_id)
    if state is None:
        raise HTTPException(status_code=404, detail=_make_error("NOT_FOUND", f"Task {task_id} not found"))

    current_status = state.get("status")
    if current_status not in ("waiting_review", "paused"):
        raise HTTPException(
            status_code=409,
            detail=_make_error(
                "INVALID_STATE",
                f"Task {task_id} is in '{current_status}' state, not awaiting review",
            ),
        )

    valid_verdicts = ("pass", "reject", "revise")
    if decision.verdict not in valid_verdicts:
        raise HTTPException(
            status_code=422,
            detail=_make_error(
                "INVALID_VERDICT",
                f"Verdict must be one of {valid_verdicts}, got '{decision.verdict}'",
            ),
        )

    await executor.submit_review(
        task_id=task_id,
        verdict=decision.verdict,
        feedback=decision.feedback,
        edited_draft=decision.edited_draft,
    )

    return _make_response({
        "task_id": task_id,
        "verdict": decision.verdict,
        "feedback": decision.feedback,
        "status": "review_submitted",
    })
