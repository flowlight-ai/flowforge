from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends
from flowforge.app.deps import get_executor, get_llm_client
from flowforge.core.tracing import get_trace_id, get_logger
from flowforge.core.config import system_config, ConfigLoader

logger = get_logger("admin_api")

router = APIRouter(prefix="/admin", tags=["admin"])


def _make_response(data: dict) -> dict:
    return {
        "status": "success",
        "data": data,
        "meta": {"trace_id": get_trace_id(), "timestamp": datetime.now(timezone.utc).isoformat() + "Z"},
    }


def _make_error(code: str, message: str, details: dict = None) -> dict:
    return {
        "status": "error",
        "error": {"code": code, "message": message, "details": details or {}},
        "meta": {"trace_id": get_trace_id(), "timestamp": datetime.now(timezone.utc).isoformat() + "Z"},
    }


@router.get("/models/health")
async def get_models_health(llm_client=Depends(get_llm_client)):
    if llm_client is None:
        return _make_error("SERVICE_UNAVAILABLE", "LLM client not initialized")
    report = llm_client.get_health_report()
    return _make_response(report)


@router.put("/models/assign")
async def update_model_assignment(payload: dict, llm_client=Depends(get_llm_client)):
    if llm_client is None:
        return _make_error("SERVICE_UNAVAILABLE", "LLM client not initialized")
    persona = payload.get("persona")
    agent_name = payload.get("agent_name")
    primary_model = payload.get("primary_model")
    fallback_models = payload.get("fallback_models", [])
    if not persona or not agent_name or not primary_model:
        return _make_error("VALIDATION_ERROR", "persona, agent_name, and primary_model are required")
    llm_client.update_assignment(persona, agent_name, primary_model, fallback_models)
    return _make_response({
        "persona": persona, "agent_name": agent_name,
        "primary_model": primary_model, "fallback_models": fallback_models,
    })


@router.post("/models/autofix")
async def trigger_autofix(llm_client=Depends(get_llm_client)):
    if llm_client is None:
        return _make_error("SERVICE_UNAVAILABLE", "LLM client not initialized")
    report = llm_client.get_health_report()
    fixed = []
    for model_entry in report.get("models", []):
        if model_entry.get("status") == "unhealthy":
            provider = model_entry.get("provider", "")
            model_id = model_entry.get("model_id", "")
            key = f"{provider}/{model_id}"
            llm_client._health_status[key] = {
                "success_count": 0, "error_count": 0,
                "last_error": "", "last_check": datetime.now(timezone.utc).isoformat() + "Z",
            }
            fixed.append(key)
            logger.info(f"autofix: reset health for {key}")
    return _make_response({"fixed_models": fixed, "total_unhealthy": len(fixed)})


@router.get("/models/assignments")
async def get_model_assignments(llm_client=Depends(get_llm_client)):
    if llm_client is None:
        return _make_error("SERVICE_UNAVAILABLE", "LLM client not initialized")
    assignments = llm_client.get_assignments()
    return _make_response({"assignments": assignments})


@router.post("/models/health/force")
async def force_refresh_health(llm_client=Depends(get_llm_client)):
    if llm_client is None:
        return _make_error("SERVICE_UNAVAILABLE", "LLM client not initialized")
    for key in list(llm_client._health_status.keys()):
        llm_client._health_status[key]["last_check"] = datetime.now(timezone.utc).isoformat() + "Z"
    report = llm_client.get_health_report()
    return _make_response(report)


@router.post("/models/health/check")
async def check_specific_model(payload: dict, llm_client=Depends(get_llm_client)):
    if llm_client is None:
        return _make_error("SERVICE_UNAVAILABLE", "LLM client not initialized")
    model_key = payload.get("model_key")
    if not model_key:
        return _make_error("VALIDATION_ERROR", "model_key is required")
    health_info = llm_client._health_status.get(model_key, {
        "success_count": 0, "error_count": 0, "last_error": "", "last_check": "",
    })
    return _make_response({"model_key": model_key, "health": health_info})


@router.get("/config")
async def get_config():
    config_loader = ConfigLoader()
    system_cfg = {
        "db_url": system_config.db_url,
        "log_level": system_config.log_level,
        "server_host": system_config.server_host,
        "server_port": system_config.server_port,
        "workers": system_config.workers,
        "helixrag_enabled": system_config.helixrag_enabled,
        "helixrag_endpoint": system_config.helixrag_endpoint,
        "scheduler_enabled": system_config.scheduler_enabled,
        "scheduler_timezone": system_config.scheduler_timezone,
        "metrics_enabled": system_config.metrics_enabled,
    }
    models_cfg = config_loader.get_models_config()
    return _make_response({"system": system_cfg, "models": models_cfg})


@router.post("/config/reload")
async def reload_config():
    from flowforge.core.config import SystemConfig
    global system_config
    new_config = SystemConfig()
    for field_name in new_config.model_fields:
        setattr(system_config, field_name, getattr(new_config, field_name))
    logger.info("config reloaded")
    return _make_response({"message": "Configuration reloaded successfully"})
