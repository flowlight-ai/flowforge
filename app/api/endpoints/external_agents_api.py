"""External agents API — claude_code / codex / gemini / opencode / trae.

Migrated from `flowforge/web/app.py` into the modular
``app/api/endpoints/`` structure. Preserves the 5-CLI integration + protocol-conversion
advantage while adopting the router-based layout.

Endpoints (mounted under ``/api/v1`` by the v1 router):
    GET  /external-agents                  — list all adapters + availability
    GET  /external-agents/{kind}           — detail for one adapter
    PUT  /external-agents/{kind}           — update binary override / timeout
    POST /external-agents/{kind}/test      — test-invoke with a short prompt

The frontend ``ExternalAgentList.tsx`` expects ``GET /external-agents`` to
return ``{agents: [{id, status, reason}]}`` where status is "pass" | "skip"
| "fail". We translate the bridge's richer status dict into that shape.
"""

from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger
from flowforge.forgemind.external_agents import (
    ExternalAgentAdapter,
    ExternalAgentError,
    ExternalAgentKind,
)
from flowforge.llm.council_bridge_holder import get_bridge

logger = get_logger("flowforge.app.api.endpoints.external_agents_api")

router = APIRouter(prefix="/external-agents", tags=["external-agents"])

# ── Request / response models ────────────────────────────────────────────────

class ExternalAgentUpdate(BaseModel):
    """PUT /external-agents/{kind} request body."""

    binary_override: str | None = Field(
        default=None, description="Absolute path to the CLI binary"
    )
    default_timeout: float | None = Field(
        default=None, description="Default invoke timeout in seconds"
    )

class ExternalAgentTestRequest(BaseModel):
    """POST /external-agents/{kind}/test request body."""

    prompt: str = Field(
        default="Reply with the single word: OK",
        description="Short prompt to send to the CLI",
    )
    timeout: float = Field(default=60.0, description="Timeout in seconds")

# ── Helpers ──────────────────────────────────────────────────────────────────

def _adapter_to_ui_status(adapter_status: dict[str, Any]) -> dict[str, Any]:
    """Translate the bridge's adapter status dict into the UI shape.

    The frontend ExternalAgentList.tsx expects:
        {id, status: "pass"|"skip"|"fail", reason?}
    """
    kind = adapter_status.get("kind", "unknown")
    available = bool(adapter_status.get("available", False))
    supports_oneshot = bool(adapter_status.get("supports_oneshot", False))
    binary = adapter_status.get("binary_path", "")
    error = adapter_status.get("last_error", "")

    if available and supports_oneshot:
        status = "pass"
        reason = f"binary: {binary}" if binary else "available"
    elif available and not supports_oneshot:
        # trae is "available" (IDE installed) but doesn't support oneshot CLI
        status = "skip"
        reason = "IDE-only (no CLI oneshot) — launch Trae CN manually"
    else:
        status = "fail"
        reason = error or "binary not found in PATH"

    return {
        "id": kind,
        "name": adapter_status.get("kind", kind),
        "status": status,
        "reason": reason,
        "available": available,
        "supports_oneshot": supports_oneshot,
        "binary_path": binary,
    }

def _resolve_kind(kind: str) -> ExternalAgentKind:
    """Convert a string kind into ExternalAgentKind, raising 400 on unknown."""
    try:
        return ExternalAgentKind(kind)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=(
                f"unknown external agent kind: {kind!r} "
                f"(supported: {[k.value for k in ExternalAgentKind]})"
            ),
        ) from exc

# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("")
async def list_external_agents() -> dict[str, Any]:
    """List all configured external agents with availability + forgekin bindings.

    Returns the shape expected by ``ExternalAgentList.tsx``:
    ``{agents: [{id, status, reason}], bindings: [...], summary: {...}}``.
    """
    bridge = get_bridge()
    if bridge is None:
        # Bridge unavailable — report all 5 CLIs as "fail" with reason.
        all_kinds = [k.value for k in ExternalAgentKind]
        agents_ui = [
            {
                "id": k,
                "name": k,
                "status": "fail",
                "reason": "ForgekinLLMBridge unavailable (check config/llm_route.yaml)",
                "available": False,
                "supports_oneshot": False,
                "binary_path": "",
            }
            for k in all_kinds
        ]
        return {
            "agents": agents_ui,
            "bindings": [],
            "summary": {
                "total": len(all_kinds),
                "available": 0,
                "supports_oneshot": 0,
            },
            "bridge_available": False,
        }

    agents_status = bridge.get_external_agents_status()
    agents_ui = [_adapter_to_ui_status(a) for a in agents_status]

    # Build forgekin → external_agent binding map for the UI.
    bindings: list[dict] = []
    # Load forgekin configs to surface bindings (best-effort).
    # list_builtin_forgekins() returns list[dict] with {"id": "wenxin", ...};
    # extract the "id" field rather than treating each item as a slug string.
    try:
        from flowforge.forgemind.forgekins.roster import BUILTIN_FORGEKINS
        import yaml
        for slug in BUILTIN_FORGEKINS:
            cfg_path = (
                bridge._config_dir / "forgekins" / f"{slug}.yaml"
            )
            if not cfg_path.exists():
                continue
            with cfg_path.open(encoding="utf-8") as f:
                cfg = yaml.safe_load(f) or {}
            fk_id = cfg.get("forgekin_id", slug)
            fk_name = cfg.get("name", slug)
            for b in cfg.get("bound_external_agents", []) or []:
                bindings.append({
                    "forgekin_id": fk_id,
                    "forgekin_name": fk_name,
                    "kind": b.get("kind", ""),
                    "role": b.get("role", ""),
                    "invoke_mode": b.get("invoke_mode", ""),
                })
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"Could not load forgekin bindings: {exc}")

    return {
        "agents": agents_ui,
        "bindings": bindings,
        "summary": {
            "total": len(agents_ui),
            "available": sum(1 for a in agents_ui if a.get("available")),
            "supports_oneshot": sum(1 for a in agents_ui if a.get("supports_oneshot")),
        },
        "bridge_available": True,
    }

@router.get("/{kind}")
async def get_external_agent(kind: str) -> dict[str, Any]:
    """Return detailed status for one external agent."""
    bridge = get_bridge()
    ea_kind = _resolve_kind(kind)
    if bridge is None:
        raise HTTPException(
            status_code=503,
            detail="ForgekinLLMBridge unavailable — cannot query adapters",
        )
    adapter = bridge.get_external_adapter(ea_kind)
    if adapter is None:
        raise HTTPException(
            status_code=404,
            detail=f"external agent {kind} not configured in forgemind.yaml",
        )
    return {"agent": adapter.get_status()}

@router.put("/{kind}")
async def update_external_agent(
    kind: str, payload: ExternalAgentUpdate
) -> dict[str, Any]:
    """Update one external agent's runtime config (binary override / timeout)."""
    bridge = get_bridge()
    ea_kind = _resolve_kind(kind)
    if bridge is None:
        raise HTTPException(
            status_code=503,
            detail="ForgekinLLMBridge unavailable — cannot update adapters",
        )
    try:
        status = bridge.update_external_agent_config(
            ea_kind,
            binary_override=payload.binary_override,
            default_timeout=payload.default_timeout,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=400, detail=f"invalid payload: {exc}") from exc
    return {"updated": True, "agent": status}

@router.post("/{kind}/test")
async def test_external_agent(
    kind: str, payload: ExternalAgentTestRequest
) -> dict[str, Any]:
    """Test-invoke an external agent with a short prompt.

    Used by the /admin/external-agents "Test" button to verify the CLI is
    functional. Returns stdout preview, length, and latency.
    """
    bridge = get_bridge()
    ea_kind = _resolve_kind(kind)
    if bridge is None:
        raise HTTPException(
            status_code=503,
            detail="ForgekinLLMBridge unavailable — cannot test adapters",
        )
    adapter = bridge.get_external_adapter(ea_kind)
    if adapter is None:
        raise HTTPException(
            status_code=404,
            detail=f"external agent {kind} not configured",
        )

    t0 = time.perf_counter()
    try:
        stdout = await adapter.invoke(payload.prompt, timeout=payload.timeout)
        latency_ms = (time.perf_counter() - t0) * 1000
        logger.info(
            f"external_agent test OK: kind={ea_kind.value} "
            f"latency={latency_ms:.0f}ms len={len(stdout)}"
        )
        return {
            "success": True,
            "kind": ea_kind.value,
            "stdout_preview": stdout[:500],
            "stdout_len": len(stdout),
            "latency_ms": latency_ms,
        }
    except ExternalAgentError as exc:
        latency_ms = (time.perf_counter() - t0) * 1000
        logger.warning(
            f"external_agent test FAIL: kind={ea_kind.value} "
            f"latency={latency_ms:.0f}ms error={exc!r}"
        )
        return {
            "success": False,
            "kind": ea_kind.value,
            "error": str(exc),
            "latency_ms": latency_ms,
        }
