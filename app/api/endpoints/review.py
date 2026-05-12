from fastapi import APIRouter

router = APIRouter(prefix="/review", tags=["review"])

@router.get("/queue")
async def get_review_queue():
    return {"status": "success", "data": {"items": [], "total": 0}}
