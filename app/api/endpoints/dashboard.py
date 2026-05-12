from fastapi import APIRouter

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

@router.get("/stats")
async def get_stats():
    return {"status": "success", "data": {"today": 0, "month": 0, "active": 0}}
