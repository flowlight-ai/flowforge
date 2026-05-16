import sys
import platform
from datetime import datetime, timezone
from fastapi import APIRouter
from flowforge.core.tracing import get_trace_id

router = APIRouter(prefix="/system", tags=["system"])

_psutil_available = False
try:
    import psutil
    _psutil_available = True
except ImportError:
    pass


def _make_response(data: dict) -> dict:
    return {
        "status": "success",
        "data": data,
        "meta": {"trace_id": get_trace_id(), "timestamp": datetime.now(timezone.utc).isoformat() + "Z"},
    }


@router.get("/platform")
async def get_platform():
    platform_info = {
        "os": sys.platform,
        "os_name": platform.system(),
        "os_version": platform.version(),
        "os_release": platform.release(),
        "python_version": platform.python_version(),
        "python_implementation": platform.python_implementation(),
        "architecture": platform.machine(),
        "processor": platform.processor(),
        "hostname": platform.node(),
        "sandbox_available": sys.platform != "win32",
        "sandbox_type": "subprocess",
        "memory_limit_supported": sys.platform != "win32",
        "psutil_available": _psutil_available,
    }
    if _psutil_available:
        platform_info.update({
            "cpu_count": psutil.cpu_count(),
            "cpu_percent": psutil.cpu_percent(interval=0.1),
            "memory_total_gb": round(psutil.virtual_memory().total / (1024 ** 3), 2),
            "memory_available_gb": round(psutil.virtual_memory().available / (1024 ** 3), 2),
            "memory_percent": psutil.virtual_memory().percent,
            "disk_total_gb": round(psutil.disk_usage("/").total / (1024 ** 3), 2) if sys.platform != "win32" else round(psutil.disk_usage("C:\\").total / (1024 ** 3), 2),
            "disk_percent": psutil.disk_usage("/").percent if sys.platform != "win32" else psutil.disk_usage("C:\\").percent,
        })
    return _make_response(platform_info)


@router.get("/agents")
async def list_agents():
    try:
        from flowforge.app.deps import get_executor
        executor = await get_executor()
        agents = executor.agent_registry.list_agents()
        result = []
        for name in agents:
            agent = executor.agent_registry.get(name)
            result.append({
                "name": name,
                "description": getattr(agent, "description", "") or "",
                "enabled": True,
                "mode": getattr(agent, "default_mode", None),
            })
        return {"agents": result}
    except Exception:
        return {"agents": []}


@router.get("/modes")
async def list_modes():
    try:
        from flowforge.app.deps import get_executor
        executor = await get_executor()
        modes = executor.mode_registry.list_modes()
        result = []
        for name in modes:
            mode = executor.mode_registry.get(name)
            result.append({
                "name": name,
                "description": getattr(mode, "description", "") or "",
                "enabled": True,
            })
        return {"modes": result}
    except Exception:
        return {"modes": []}


@router.get("/tools")
async def list_tools():
    try:
        from flowforge.app.deps import get_executor
        executor = await get_executor()
        tools = executor.tool_registry.list_tools()
        result = []
        for name in tools:
            tool = executor.tool_registry.get(name)
            result.append({
                "name": name,
                "description": getattr(tool, "description", "") or "",
                "enabled": True,
                "category": getattr(tool, "category", None),
            })
        return {"tools": result}
    except Exception:
        return {"tools": []}


@router.get("/memory")
async def list_memory():
    try:
        from flowforge.app.deps import get_executor
        executor = await get_executor()
        stores = []
        if hasattr(executor, "memory_manager"):
            for name in getattr(executor.memory_manager, "list_stores", lambda: [])():
                stores.append({"name": name, "description": "Memory store", "enabled": True, "type": "sqlite"})
        return {"memory": stores}
    except Exception:
        return {"memory": []}
