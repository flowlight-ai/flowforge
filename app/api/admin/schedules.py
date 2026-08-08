import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends, Query
from flowforge.app.deps import get_scheduler
from flowforge.core.tracing import get_trace_id, get_logger

logger = get_logger("schedules_api")

router = APIRouter(prefix="/schedules", tags=["schedules"])


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


@router.get("")
async def list_schedules(scheduler=Depends(get_scheduler)):
    if scheduler is None:
        return _make_error("SERVICE_UNAVAILABLE", "Scheduler not initialized")
    jobs = scheduler.list_jobs()
    job_details = []
    for job in jobs:
        job_id = job.get("id", "")
        job_meta = scheduler._jobs.get(job_id, {})
        job_details.append({
            "id": job_id,
            "next_run": job.get("next_run", ""),
            "persona": job_meta.get("persona", ""),
            "cron": job_meta.get("cron", ""),
            "mode": job_meta.get("mode", ""),
            "input_data": job_meta.get("input_data", {}),
        })
    return _make_response({"items": job_details, "total": len(job_details)})


@router.post("", status_code=201)
async def create_schedule(payload: dict, scheduler=Depends(get_scheduler)):
    if scheduler is None:
        raise HTTPException(status_code=503, detail=_make_error(
            "SERVICE_UNAVAILABLE", "Scheduler not initialized"))
    schedule_id = payload.get("schedule_id") or f"schedule-{uuid.uuid4()}"
    persona = payload.get("persona", "default")
    cron_expr = payload.get("cron")
    input_data = payload.get("input_data", {})
    mode = payload.get("mode", "workflow")
    if not cron_expr:
        raise HTTPException(status_code=400, detail=_make_error(
            "VALIDATION_ERROR", "cron expression is required"))
    scheduler.add_cron_job(schedule_id, persona, cron_expr, input_data, mode)
    logger.info(f"schedule created: {schedule_id}")
    return _make_response({
        "schedule_id": schedule_id, "persona": persona,
        "cron": cron_expr, "mode": mode, "input_data": input_data,
    })


@router.delete("/{schedule_id}")
async def delete_schedule(schedule_id: str, scheduler=Depends(get_scheduler)):
    if scheduler is None:
        raise HTTPException(status_code=503, detail=_make_error(
            "SERVICE_UNAVAILABLE", "Scheduler not initialized"))
    if schedule_id not in scheduler._jobs:
        raise HTTPException(status_code=404, detail=_make_error(
            "NOT_FOUND", f"Schedule {schedule_id} not found"))
    scheduler.remove_job(schedule_id)
    logger.info(f"schedule removed: {schedule_id}")
    return _make_response({"schedule_id": schedule_id, "deleted": True})
