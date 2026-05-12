from fastapi import APIRouter

router = APIRouter(prefix="/schedules", tags=["schedules"])

@router.get("")
async def list_schedules():
    return {"status": "success", "data": {"items": [], "total": 0}}

@router.post("")
async def create_schedule(payload: dict):
    return {"status": "success", "data": {"schedule_id": "new", "config": payload}}
