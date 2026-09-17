from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from flowforge.app.deps import get_executor
from flowforge.core.tracing import get_trace_id

router = APIRouter(prefix="/modes", tags=["modes"])


def _make_response(data: dict) -> dict:
    return {
        "status": "success",
        "data": data,
        "meta": {"trace_id": get_trace_id(), "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")},
    }


@router.get("")
async def list_modes(executor=Depends(get_executor)):
    modes_list = []
    for mode_name in executor.mode_registry.list_modes():
        mode_executor = executor.mode_registry._modes.get(mode_name)
        modes_list.append({
            "name": mode_name,
            "capabilities": list(mode_executor.capabilities) if mode_executor and hasattr(mode_executor, "capabilities") else [],
            "status": "available",
        })
    return _make_response({"modes": modes_list, "total": len(modes_list)})
