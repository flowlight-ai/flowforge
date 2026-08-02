from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from flowforge.app.deps import get_executor, get_llm_client
from flowforge.core.tracing import get_trace_id
from flowforge.core import metrics

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


def _make_response(data: dict) -> dict:
    return {
        "status": "success",
        "data": data,
        "meta": {"trace_id": get_trace_id(), "timestamp": datetime.now(timezone.utc).isoformat() + "Z"},
    }


@router.get("/actions")
async def get_pending_actions(executor=Depends(get_executor)):
    review_result = executor.state_manager.list_states_with_data(
        status="waiting_review", limit=1, offset=0,
    )
    review_count = review_result.get("total", 0)
    latest_review = review_result.get("items", [{}])[0] if review_result.get("items") else None
    return _make_response({
        "pending_review_count": review_count,
        "latest_review_task": latest_review,
    })


@router.get("/status")
async def get_system_status(executor=Depends(get_executor), llm_client=Depends(get_llm_client)):
    running_result = executor.state_manager.list_states_with_data(
        status="running", limit=50, offset=0,
    )
    error_result = executor.state_manager.list_states_with_data(
        status="failed", limit=50, offset=0,
    )
    model_health = {}
    if llm_client:
        report = llm_client.get_health_report()
        model_health = report.get("summary", {})
    return _make_response({
        "running_tasks": running_result.get("items", []),
        "running_count": running_result.get("total", 0),
        "error_tasks": error_result.get("items", []),
        "error_count": error_result.get("total", 0),
        "model_health": model_health,
    })


@router.get("/stats")
async def get_stats(executor=Depends(get_executor)):
    task_stats = metrics.get_task_stats()
    token_stats = metrics.get_llm_token_stats()

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    today_articles = 0
    month_articles = 0
    month_prefix = datetime.now(timezone.utc).strftime("%Y-%m")
    total_completed = 0
    total_failed = 0

    all_tasks = executor.state_manager.list_states_with_data(limit=10000, offset=0)
    for task in all_tasks.get("items", []):
        status = task.get("status", "")
        updated_at = task.get("updated_at", "")
        if status == "completed":
            total_completed += 1
            if updated_at.startswith(today):
                today_articles += 1
            if updated_at.startswith(month_prefix):
                month_articles += 1
        elif status == "failed":
            total_failed += 1

    success_rate = (total_completed / (total_completed + total_failed) * 100) if (total_completed + total_failed) > 0 else 0.0

    return _make_response({
        "today_articles": today_articles,
        "month_articles": month_articles,
        "total_completed": total_completed,
        "total_failed": total_failed,
        "success_rate": round(success_rate, 2),
        "model_cost": token_stats,
        "task_stats": task_stats,
    })
