from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query

from flowforge.memory.manager import MemoryManager
from flowforge.core.tracing import get_trace_id, get_logger

logger = get_logger("memory_api")

router = APIRouter(prefix="/memory", tags=["memory"])

_memory_manager: MemoryManager | None = None


def init_memory_api(mm: MemoryManager):
    global _memory_manager
    _memory_manager = mm
    logger.info("Memory API initialized")


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
async def list_memories(
    task_id: str = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    if _memory_manager is None:
        raise HTTPException(status_code=503, detail=_make_error("SERVICE_UNAVAILABLE", "Memory manager not initialized"))
    result = await _memory_manager.list_memories(limit=limit, offset=offset, task_id=task_id)
    return _make_response(result)


@router.get("/by-task/{task_id}")
async def get_memories_by_task(task_id: str):
    if _memory_manager is None:
        raise HTTPException(status_code=503, detail=_make_error("SERVICE_UNAVAILABLE", "Memory manager not initialized"))
    records = await _memory_manager.get_by_task(task_id)
    return _make_response({"records": records, "total": len(records), "task_id": task_id})


@router.get("/{memory_id}")
async def get_memory(memory_id: int):
    if _memory_manager is None:
        raise HTTPException(status_code=503, detail=_make_error("SERVICE_UNAVAILABLE", "Memory manager not initialized"))
    record = await _memory_manager.get_memory(memory_id)
    if record is None:
        raise HTTPException(status_code=404, detail=_make_error("NOT_FOUND", f"Memory {memory_id} not found"))
    return _make_response(record)


@router.delete("/{memory_id}")
async def delete_memory(memory_id: int):
    if _memory_manager is None:
        raise HTTPException(status_code=503, detail=_make_error("SERVICE_UNAVAILABLE", "Memory manager not initialized"))
    deleted = await _memory_manager.delete_memory(memory_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=_make_error("NOT_FOUND", f"Memory {memory_id} not found"))
    logger.info(f"Memory {memory_id} deleted")
    return _make_response({"deleted": memory_id})
