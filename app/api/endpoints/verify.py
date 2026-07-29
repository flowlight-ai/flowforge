"""T7 / T8 verification endpoints — LLM audit + DOM checklist.

Ported from the new project's ``web/app.py`` (web_legacy_backup) into the
old project's modular ``app/api/endpoints/`` structure per PORTING-SPEC.md
§3.4. Preserves the T7 (LLM-audits-LLM) and T8 (DOM verification) testing
铁律 while adopting the old project's router-based layout.

Endpoints (mounted under ``/api/v1`` by the v1 router):
    POST /verify/t7     — T7 audit: invoke a second LLM to audit primary output
    GET  /verify/t8     — T8 DOM health checklist for browser automation

T7 铁律: 凡LLM生成的内容必须经LLM审核通过才算验证通过.
T8 铁律: 凡涉及网页操作的功能必须操控浏览器查看DOM确认真实成功.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from flowforge.core.errors import LLMError
from flowforge.core.tracing import get_logger
from flowforge.llm.council_bridge_holder import get_bridge, get_bridge_status

logger = get_logger("flowforge.app.api.endpoints.verify")

router = APIRouter(prefix="/verify", tags=["verify"])


# ── T7 request / response models ────────────────────────────────────────────


class T7VerifyRequest(BaseModel):
    """T7 audit request body.

    Three modes (checked in order):
    1. ``content`` + optional ``forgekin_id``  — audit ad-hoc content
    2. ``message_id``                          — (unsupported in modular mode)
    3. ``count``                               — (unsupported in modular mode)

    The ad-hoc content mode is the most portable — it doesn't depend on
    in-memory chat state. The message_id / count modes require the legacy
    web app's ChatState which isn't available in the modular structure.
    """

    content: str | None = Field(
        default=None, description="Ad-hoc content to audit"
    )
    forgekin_id: str | None = Field(
        default=None, description="Forgekin ID for loop_type lookup"
    )
    message_id: str | None = Field(
        default=None, description="(legacy) message ID to audit"
    )
    count: int | None = Field(
        default=None, description="(legacy) audit last N primary messages"
    )


# ── Helpers ──────────────────────────────────────────────────────────────────


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _lookup_forgekin_loop_type(forgekin_id: str) -> str:
    """Best-effort lookup of a forgekin's loop_type from its YAML config."""
    try:
        from pathlib import Path
        from flowforge.llm.council_bridge_holder import _config_dir
        cfg_path = _config_dir() / "forgekins" / f"{forgekin_id}.yaml"
        if cfg_path.exists():
            import yaml
            with cfg_path.open(encoding="utf-8") as f:
                cfg = yaml.safe_load(f) or {}
            return cfg.get("self_dev_loop", {}).get("loop_type", "")
    except Exception as exc:  # noqa: BLE001
        logger.debug(f"Could not lookup loop_type for {forgekin_id}: {exc}")
    return ""


def _lookup_forgekin_name(forgekin_id: str) -> str:
    """Best-effort lookup of a forgekin's display name."""
    try:
        from pathlib import Path
        from flowforge.llm.council_bridge_holder import _config_dir
        cfg_path = _config_dir() / "forgekins" / f"{forgekin_id}.yaml"
        if cfg_path.exists():
            import yaml
            with cfg_path.open(encoding="utf-8") as f:
                cfg = yaml.safe_load(f) or {}
            return cfg.get("name", forgekin_id)
    except Exception as exc:  # noqa: BLE001
        logger.debug(f"Could not lookup name for {forgekin_id}: {exc}")
    return forgekin_id


# ── Endpoints ────────────────────────────────────────────────────────────────


@router.post("/t7")
async def verify_t7(payload: T7VerifyRequest) -> dict[str, Any]:
    """T7 audit endpoint — invokes a *real* LLM to audit a primary response.

    Per T7 铁律: 凡LLM生成的内容（代码/文章/评论/文案/小说等），必须再调用
    LLM审核通过后才算验证通过.

    The audit uses a *different* vendor than the primary response (I9
    no-self-review invariant), selected via the ``t7_audit`` fallback chain
    in ``config/llm_route.yaml``.
    """
    bridge = get_bridge()
    if bridge is None:
        raise HTTPException(
            status_code=503,
            detail="ForgekinLLMBridge unavailable — cannot perform T7 audit",
        )

    # Resolve target content + forgekin metadata.
    target_content: str = ""
    target_name: str = "unknown"
    target_loop: str = ""

    if payload.content:
        target_content = payload.content
        if payload.forgekin_id:
            target_name = _lookup_forgekin_name(payload.forgekin_id)
            target_loop = _lookup_forgekin_loop_type(payload.forgekin_id)
    elif payload.message_id:
        # Look up the message from the council chat state.
        # This supports the T7 E2E test (test_t7_t8_e2e.py::test_explicit_t7_endpoint)
        # which audits a primary response by message_id after /api/chat returns.
        try:
            from flowforge.app.api.endpoints.council import state as _council_state
        except ImportError as _exc:
            raise HTTPException(
                status_code=503,
                detail=f"Council state unavailable for message_id lookup: {_exc}",
            ) from _exc
        found = None
        for msg in _council_state.messages:
            if getattr(msg, "message_id", None) == payload.message_id:
                found = msg
                break
        if found is None:
            raise HTTPException(
                status_code=404,
                detail=f"message_id {payload.message_id!r} not found in council state",
            )
        target_content = getattr(found, "content", "") or ""
        if not target_content:
            raise HTTPException(
                status_code=400,
                detail=f"message_id {payload.message_id!r} has empty content",
            )
        # Resolve forgekin metadata from the message's author_id if available.
        author_id = getattr(found, "author_id", "") or ""
        if author_id.startswith("fk-"):
            target_name = _lookup_forgekin_name(author_id)
            target_loop = _lookup_forgekin_loop_type(author_id)
    elif payload.count is not None:
        raise HTTPException(
            status_code=400,
            detail=(
                "count mode is not supported in the modular endpoint. "
                "Pass the message content directly via 'content' field."
            ),
        )
    else:
        raise HTTPException(
            status_code=400,
            detail="Either 'content' or 'message_id' must be provided",
        )

    try:
        result = await bridge.audit_t7(
            primary_name=target_name,
            primary_output=target_content,
            loop_type=target_loop,
        )
    except LLMError as exc:
        logger.error(f"T7 audit endpoint failed: {exc!r}", exc_info=True)
        raise HTTPException(
            status_code=503,
            detail=f"T7 audit LLM call failed: {exc!s}",
        ) from exc

    logger.info(
        f"T7 audit OK: primary={target_name} score={result.score:.2f} "
        f"verdict={result.verdict} model={result.model} "
        f"latency={result.latency_ms:.0f}ms"
    )

    return {
        "audited_message_id": None,
        "primary_name": target_name,
        "loop_type": target_loop,
        "score": result.score,
        "verdict": result.verdict,
        "reasons": result.reasons,
        "quality_threshold": result.quality_threshold,
        "audit_llm": {
            "model": result.model,
            "provider": result.provider,
            "latency_ms": result.latency_ms,
        },
        "audited_at": _now_iso(),
    }


@router.get("/t8")
async def verify_t8() -> dict[str, Any]:
    """T8 DOM health checklist — drives browser automation verification.

    Per T8 铁律: 凡涉及网页操作的功能（发布/上架/部署等），必须操控浏览器
    查看DOM确认真实成功，且对DOM内容调用LLM审核质量.

    The checklist comes from ``config/web_chat_prompts.yaml`` so the same
    source of truth is shared between the server and the test harness.
    """
    bridge = get_bridge()
    if bridge is None:
        # Return a minimal checklist even when bridge is unavailable,
        # so the test harness can still run structural checks.
        return {
            "checklist": [],
            "dom_state_after_send": {
                "operator_message_count_increase": 1,
                "forgekin_response_count_increase_min": 1,
                "forgekin_response_count_increase_max": 3,
                "forgekin_with_llm_meta_min": 1,
                "forgekin_with_t7_badge_min": 1,
            },
            "notes": [
                "ForgekinLLMBridge unavailable — using default checklist.",
                "Every forgekin response (except greeting) MUST have llm_meta populated (T1 proof).",
                "Every primary forgekin response MUST have a t7_badge populated (T7 proof).",
                "Use wait_until='domcontentloaded' to avoid Next.js HMR timeout (T8 lesson).",
            ],
            "bridge_status": get_bridge_status(),
        }

    return {
        "checklist": bridge.get_dom_checklist(),
        "dom_state_after_send": {
            "operator_message_count_increase": 1,
            "forgekin_response_count_increase_min": 1,
            "forgekin_response_count_increase_max": 3,
            "forgekin_with_llm_meta_min": 1,  # at least 1 message must carry llm_meta
            "forgekin_with_t7_badge_min": 1,  # at least 1 primary must carry a t7_badge
        },
        "notes": [
            "Every forgekin response (except greeting) MUST have llm_meta populated (T1 proof).",
            "Every primary forgekin response MUST have a t7_badge populated (T7 proof).",
            "Use wait_until='domcontentloaded' to avoid Next.js HMR timeout (T8 lesson).",
        ],
        "bridge_status": get_bridge_status(),
    }


@router.get("/bridge")
async def bridge_status() -> dict[str, Any]:
    """Report the LLM bridge configuration for diagnostics.

    Used by the /admin/external-agents page and the council chat diagnostics.
    """
    return get_bridge_status()
