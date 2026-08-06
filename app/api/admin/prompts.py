import urllib.parse
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from flowforge.core.prompt_manager import PromptManager
from flowforge.core.tracing import get_logger, get_trace_id

logger = get_logger("prompts_api")

router = APIRouter(prefix="/prompts", tags=["prompts"])

_prompts_dir: str = None


def init_prompts_api(prompts_dir: str):
    global _prompts_dir
    _prompts_dir = prompts_dir
    PromptManager(prompts_dir)
    logger.info(f"Prompts API initialized with dir: {prompts_dir}")


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


class PromptUpdateBody(BaseModel):
    template: str


@router.get("")
async def list_prompts():
    pm = PromptManager()
    keys = pm.list_keys()
    return _make_response({"keys": keys, "total": len(keys)})


@router.get("/{key:path}")
async def get_prompt(key: str):
    decoded_key = urllib.parse.unquote(key)
    pm = PromptManager()
    template = pm.get(decoded_key)
    if not template:
        raise HTTPException(status_code=404, detail=_make_error("NOT_FOUND", f"Prompt '{decoded_key}' not found"))
    return _make_response({"key": decoded_key, "template": template})


@router.put("/{key:path}")
async def update_prompt(key: str, body: PromptUpdateBody):
    decoded_key = urllib.parse.unquote(key)
    pm = PromptManager()
    pm.set(decoded_key, body.template)
    logger.info(f"Prompt '{decoded_key}' updated")
    return _make_response({"key": decoded_key, "template": body.template})


@router.post("/reload")
async def reload_prompts():
    pm = PromptManager()
    pm.reload(prompts_dir=_prompts_dir)
    keys = pm.list_keys()
    logger.info(f"Prompts reloaded, {len(keys)} keys available")
    return _make_response({"reloaded": True, "total_keys": len(keys)})
