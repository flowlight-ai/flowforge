from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from flowforge.app.deps import get_executor
from flowforge.core.tracing import get_trace_id

router = APIRouter(prefix="/agents", tags=["agents"])


def _make_response(data: dict) -> dict:
    return {
        "status": "success",
        "data": data,
        "meta": {"trace_id": get_trace_id(), "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")},
    }


@router.get("")
async def list_agents(executor=Depends(get_executor)):
    agents_list = []
    all_agents = executor.agent_registry.get_all()
    for name, agent in all_agents.items():
        agents_list.append({
            "name": agent.name,
            "description": agent.description,
            "default_mode": agent.default_mode,
            "status": "available",
        })
    return _make_response({"agents": agents_list, "total": len(agents_list)})
