from datetime import datetime, timezone
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from flowforge.app.deps import get_model_service
from flowforge.core.tracing import get_trace_id, get_logger
from flowforge.tools.llm.model_service import ModelService

logger = get_logger("admin_models_api")

router = APIRouter(prefix="/admin/models", tags=["model-governance"])


def _make_response(data: dict) -> dict:
    return {
        "status": "success",
        "data": data,
        "meta": {"trace_id": get_trace_id(), "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")},
    }


def _make_error(code: str, message: str, details: dict = None) -> dict:
    return {
        "status": "error",
        "error": {"code": code, "message": message, "details": details or {}},
        "meta": {"trace_id": get_trace_id(), "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")},
    }


class ModelInput(BaseModel):
    id: str
    provider: str
    enabled: bool = True


class ModelUpdate(BaseModel):
    provider: Optional[str] = None
    enabled: Optional[bool] = None


class AssignmentInput(BaseModel):
    key: str
    primary: str
    fallbacks: List[str] = []


class AutoFixInput(BaseModel):
    assignment_key: str = "default"
    cascade: bool = True


@router.get("")
async def list_models(svc: ModelService = Depends(get_model_service)):
    if svc is None:
        return _make_error("SERVICE_UNAVAILABLE", "Model service not initialized")
    models = svc.get_models()
    return _make_response({"models": models, "total": len(models)})


@router.post("")
async def add_model(body: ModelInput, svc: ModelService = Depends(get_model_service)):
    if svc is None:
        return _make_error("SERVICE_UNAVAILABLE", "Model service not initialized")
    try:
        model = svc.add_model(body.id, body.provider, body.enabled)
        return _make_response(model)
    except ValueError as e:
        raise HTTPException(409, str(e))


@router.put("/{model_id:path}")
async def update_model(model_id: str, body: ModelUpdate, svc: ModelService = Depends(get_model_service)):
    if svc is None:
        return _make_error("SERVICE_UNAVAILABLE", "Model service not initialized")
    try:
        updates = {k: v for k, v in body.model_dump().items() if v is not None}
        model = svc.update_model(model_id, **updates)
        return _make_response(model)
    except ValueError as e:
        raise HTTPException(404, str(e))


@router.delete("/{model_id:path}")
async def remove_model(model_id: str, svc: ModelService = Depends(get_model_service)):
    if svc is None:
        return _make_error("SERVICE_UNAVAILABLE", "Model service not initialized")
    try:
        result = svc.remove_model(model_id)
        return _make_response(result)
    except ValueError as e:
        raise HTTPException(404, str(e))


@router.post("/health-check-all")
async def health_check_all(force: bool = False, svc: ModelService = Depends(get_model_service)):
    if svc is None:
        return _make_error("SERVICE_UNAVAILABLE", "Model service not initialized")
    results = await svc.health_check_all(force=force)
    summary = svc.get_health_summary()
    return _make_response({"results": results, "summary": summary})


@router.post("/auto-fix")
async def auto_fix(body: AutoFixInput = None, svc: ModelService = Depends(get_model_service)):
    if svc is None:
        return _make_error("SERVICE_UNAVAILABLE", "Model service not initialized")
    if body is None:
        body = AutoFixInput()
    report = await svc.auto_fix(assignment_key=body.assignment_key, cascade=body.cascade)
    return _make_response(report)


@router.get("/assignments")
async def get_assignments(svc: ModelService = Depends(get_model_service)):
    if svc is None:
        return _make_error("SERVICE_UNAVAILABLE", "Model service not initialized")
    assignments = svc.get_assignments()
    return _make_response({"assignments": assignments})


@router.put("/assignments")
async def update_assignment(body: AssignmentInput, svc: ModelService = Depends(get_model_service)):
    if svc is None:
        return _make_error("SERVICE_UNAVAILABLE", "Model service not initialized")
    svc.update_assignment(body.key, body.primary, body.fallbacks)
    return _make_response({
        "key": body.key,
        "primary": body.primary,
        "fallbacks": body.fallbacks,
    })


@router.get("/providers")
async def get_providers(svc: ModelService = Depends(get_model_service)):
    if svc is None:
        return _make_error("SERVICE_UNAVAILABLE", "Model service not initialized")
    providers = svc.get_providers()
    return _make_response({"providers": providers})


@router.post("/{model_id:path}/health-check")
async def health_check_single(model_id: str, force: bool = True, svc: ModelService = Depends(get_model_service)):
    if svc is None:
        return _make_error("SERVICE_UNAVAILABLE", "Model service not initialized")
    model_key = svc._get_model_key(model_id)
    if model_key is None:
        if "/" in model_id:
            model_key = model_id
        else:
            raise HTTPException(404, f"Model '{model_id}' not found")
    result = await svc.health_check_single(model_key, force=force)
    return _make_response(result)
