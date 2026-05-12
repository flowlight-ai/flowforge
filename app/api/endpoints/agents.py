from fastapi import APIRouter, Depends
from app.deps import get_executor

router = APIRouter(prefix="/agents", tags=["agents"])

@router.get("")
async def list_agents(executor = Depends(get_executor)):
    agents = executor.agent_registry.resolve_all_agents() if executor and executor.agent_registry else {}
    return {"status": "success", "data": {"agents": list(agents.keys())}}
