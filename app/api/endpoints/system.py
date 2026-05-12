import sys
from fastapi import APIRouter

router = APIRouter(prefix="/system", tags=["system"])

@router.get("/platform")
async def get_platform():
    return {
        "status": "success",
        "data": {
            "os": sys.platform,
            "sandbox_type": "subprocess",
            "memory_limit_supported": sys.platform != "win32",
            "psutil_available": False,
        }
    }
