from fastapi import APIRouter

router = APIRouter(prefix="/plugins", tags=["plugins"])

@router.get("")
async def list_plugins():
    return {"status": "success", "data": {"plugins": []}}

@router.post("/install")
async def install_plugin(payload: dict):
    return {"status": "success", "data": {"installed": payload.get("name", "")}}

@router.delete("/{plugin_name}")
async def uninstall_plugin(plugin_name: str):
    return {"status": "success", "data": {"uninstalled": plugin_name}}

@router.post("/reload")
async def reload_plugins():
    return {"status": "success", "data": {"reloaded": True}}
