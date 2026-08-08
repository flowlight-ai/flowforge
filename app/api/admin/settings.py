from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from flowforge.core.config import ConfigLoader
from flowforge.core.secret_store import get_secret_store
from flowforge.core.tracing import get_logger, get_trace_id

logger = get_logger("settings_api")

router = APIRouter(prefix="/settings", tags=["settings"])


def _make_response(data: dict) -> dict:
    return {
        "status": "success",
        "data": data,
        "meta": {"trace_id": get_trace_id(), "timestamp": datetime.now(UTC).isoformat() + "Z"},
    }


def _make_error(code: str, message: str, details: dict = None) -> dict:
    return {
        "status": "error",
        "error": {"code": code, "message": message, "details": details or {}},
        "meta": {"trace_id": get_trace_id(), "timestamp": datetime.now(UTC).isoformat() + "Z"},
    }


class SecretInput(BaseModel):
    key: str
    value: str
    category: str = "api_key"
    description: str = ""


class ConfigUpdateInput(BaseModel):
    key: str
    value: str


@router.get("/secrets")
async def list_secrets(category: str | None = None):
    store = get_secret_store()
    secrets = store.list_keys(category=category)
    for s in secrets:
        s["configured"] = bool(store.resolve(s["key"]))
    return _make_response({"secrets": secrets, "total": len(secrets)})


@router.get("/secrets/{key:path}")
async def get_secret(key: str):
    store = get_secret_store()
    if not store.has(key):
        raise HTTPException(404, f"Secret '{key}' not found")
    secrets = store.list_keys()
    for s in secrets:
        if s["key"] == key:
            s["configured"] = bool(store.resolve(key))
            return _make_response(s)
    raise HTTPException(404, f"Secret '{key}' not found")


@router.post("/secrets")
async def create_or_update_secret(body: SecretInput):
    store = get_secret_store()
    if not body.value and store.has(body.key):
        return _make_response({
            "key": body.key,
            "category": body.category,
            "description": body.description,
            "configured": bool(store.resolve(body.key)),
            "skipped": True,
        })
    store.set(body.key, body.value, body.category, body.description)
    return _make_response({
        "key": body.key,
        "category": body.category,
        "description": body.description,
        "configured": True,
    })


@router.delete("/secrets/{key:path}")
async def delete_secret(key: str):
    store = get_secret_store()
    if not store.has(key):
        raise HTTPException(404, f"Secret '{key}' not found")
    store.delete(key)
    return _make_response({"deleted": key})


@router.get("/config")
async def get_config():
    loader = ConfigLoader()
    models_cfg = loader.get_models_config()
    safe_cfg = {}
    for key, value in models_cfg.items():
        if key == "providers":
            safe_providers = {}
            for name, pcfg in value.items():
                safe_p = {k: v for k, v in pcfg.items() if k != "api_key_default"}
                safe_p["api_key_env"] = pcfg.get("api_key_env", "")
                safe_providers[name] = safe_p
            safe_cfg[key] = safe_providers
        else:
            safe_cfg[key] = value
    return _make_response({"config": safe_cfg})


@router.put("/config")
async def update_config(body: ConfigUpdateInput):
    loader = ConfigLoader()
    cfg = loader.get_models_config()
    keys = body.key.split(".")
    target = cfg
    for k in keys[:-1]:
        if k not in target:
            target[k] = {}
        target = target[k]
    target[keys[-1]] = body.value
    loader.save_yaml("models.yaml", cfg)
    return _make_response({"key": body.key, "value": body.value})


@router.get("/providers")
async def get_providers_with_key_status():
    loader = ConfigLoader()
    store = get_secret_store()
    models_cfg = loader.get_models_config()
    providers = models_cfg.get("providers", {})
    result = []
    for name, pcfg in providers.items():
        api_key_env = pcfg.get("api_key_env", "")
        resolved = store.resolve(api_key_env) if api_key_env else ""
        api_key_default = pcfg.get("api_key_default", "")
        key_configured = bool(resolved) or bool(api_key_default)
        result.append({
            "name": name,
            "base_url": pcfg.get("base_url", ""),
            "api_key_env": api_key_env,
            "key_configured": key_configured,
            "key_masked": resolved[:3] + "****" + resolved[-4:] if resolved and len(resolved) > 8 else ("****" if resolved else ""),
        })
    return _make_response({"providers": result, "total": len(result)})
