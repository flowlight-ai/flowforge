from fastapi import APIRouter, Depends
from app.deps import get_executor

router = APIRouter(prefix="/modes", tags=["modes"])

@router.get("")
async def list_modes(executor = Depends(get_executor)):
    modes = executor.mode_registry.list_modes()
    return {"status": "success", "data": {"modes": modes}}
