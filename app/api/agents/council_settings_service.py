"""Forgekin Council — LLM/runtime settings and dashboard services.

Extracted from the original monolithic ``council_services.py`` so that
each service module stays under 500 lines. This module owns:

- LLM provider configuration (read/update ``llm_route.yaml`` + ``.env``)
  and bridge hot-reload.
- LLM connection test (minimal completion request).
- Runtime-tunable parameters (quality threshold, push back rounds, …).
- Dashboard data aggregation (forgekins/tasks/metrics/bridge).

Imports are one-way: this module imports from :mod:`council_state` and
:mod:`council_helpers`, neither of which imports back (no circular deps).
"""

from __future__ import annotations

import os

import yaml
from fastapi import HTTPException

from flowforge.core.tracing import get_logger
from flowforge.llm.council_bridge import ForgekinLLMBridge
from flowforge.web_legacy_backup.metrics import get_collector as _get_metrics_collector

from .council_helpers import (
    CONFIG_DIR,
    PROJECT_ROOT,
    _bool_env,
    _env,
    _get_bridge,
    _get_forgekins,
    _load_yaml,
    _upsert_env_var,
)
from .council_state import (
    bridge_holder,
    state,
    tasks_store,
)

logger = get_logger("flowforge.app.api.agents.council_settings_service")


# ── LLM settings (GET/PUT /settings/llm, POST /settings/llm/test) ────────────

async def _get_llm_settings() -> dict:
    """Return current LLM route config with masked secrets."""
    llm_route_path = CONFIG_DIR / "llm_route.yaml"
    cfg = _load_yaml(llm_route_path) if llm_route_path.exists() else {}
    providers_out = {}
    for name, pcfg in cfg.get("providers", {}).items():
        base_url = _env(
            f"FLOWFORGE_LLM_ROUTE_{name.upper()}_BASE_URL",
            pcfg.get("base_url", ""),
        )
        api_key = _env(
            f"FLOWFORGE_LLM_ROUTE_{name.upper()}_API_KEY",
            pcfg.get("api_key", ""),
        )
        masked = (
            api_key[:4] + "****" + api_key[-4:] if len(api_key) > 8
            else ("****" if api_key else "")
        )
        providers_out[name] = {
            "enabled": pcfg.get("enabled", False),
            "kind": pcfg.get("kind", ""),
            "base_url": base_url,
            "api_key_configured": bool(api_key),
            "api_key_masked": masked,
            "vendor": pcfg.get("vendor", ""),
        }
    return {
        "providers": providers_out,
        "fallback_chains": cfg.get("fallback_chains", {}),
        "prefer_api": cfg.get("prefer_api", True),
        "config_path": str(llm_route_path),
    }


async def _update_llm_settings(payload: dict) -> dict:
    """Update LLM provider config (base_url + api_key) and hot-reload bridge.

    The base_url is written to ``llm_route.yaml``; the api_key is written to
    the ``.env`` file next to the project root (铁律 5 — secrets never in YAML).
    After persisting, the bridge singleton is rebuilt so the new config takes
    effect immediately without a process restart.
    """
    provider_name = (payload.get("provider") or "").strip()
    base_url = (payload.get("base_url") or "").strip()
    api_key = (payload.get("api_key") or "").strip()
    if not provider_name:
        raise HTTPException(status_code=400, detail="provider is required")

    llm_route_path = CONFIG_DIR / "llm_route.yaml"
    cfg = _load_yaml(llm_route_path) if llm_route_path.exists() else {}
    providers = cfg.setdefault("providers", {})
    pcfg = providers.setdefault(provider_name, {})
    if base_url:
        pcfg["base_url"] = base_url
    pcfg.setdefault("kind", "openroute")
    pcfg.setdefault("enabled", True)

    # Persist YAML (base_url only — never the api_key)
    with llm_route_path.open("w", encoding="utf-8") as f:
        yaml.safe_dump(cfg, f, allow_unicode=True, sort_keys=False)

    # Persist api_key to .env (铁律 5)
    if api_key:
        env_path = PROJECT_ROOT / ".env"
        env_var = f"FLOWFORGE_LLM_ROUTE_{provider_name.upper()}_API_KEY"
        _upsert_env_var(env_path, env_var, api_key)
        # Also set in current process so the reload picks it up immediately
        os.environ[env_var] = api_key
    if base_url:
        env_var = f"FLOWFORGE_LLM_ROUTE_{provider_name.upper()}_BASE_URL"
        os.environ[env_var] = base_url

    # Hot-reload the bridge
    try:
        bridge_holder["bridge"] = ForgekinLLMBridge.from_config(CONFIG_DIR)
        logger.info(f"LLM bridge reloaded: provider={provider_name} base_url={base_url}")
    except Exception as exc:  # noqa: BLE001
        logger.error(f"Bridge reload failed: {exc!r}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Bridge reload failed: {exc!s}")

    return {
        "updated": True,
        "provider": provider_name,
        "base_url": base_url,
        "api_key_configured": bool(api_key),
    }


async def _test_llm_connection(payload: dict) -> dict:
    """Test the LLM connection by sending a minimal completion request.

    Uses the current bridge config (which may have been just-updated).
    """
    bridge = _get_bridge()
    prompt = (payload.get("prompt") or "请回复'连接成功'四个字。").strip()
    try:
        # Use the primary fallback chain for the test
        client = bridge._get_client(bridge.DEFAULT_CHAIN)
        resp = await client.complete(prompt=prompt, max_tokens=20)
        return {
            "success": True,
            "model": resp.model,
            "provider": resp.provider,
            "latency_ms": resp.latency_ms,
            "response_preview": (resp.content or "")[:120],
        }
    except Exception as exc:  # noqa: BLE001
        logger.error(f"LLM connection test failed: {exc!r}", exc_info=True)
        return {
            "success": False,
            "error": str(exc),
        }


# ── Runtime settings (PUT /settings/runtime) ────────────────────────────────

async def _update_runtime_settings(payload: dict) -> dict:
    """Update runtime-tunable parameters (in-memory; not persisted)."""
    bridge = _get_bridge()
    changed = []
    if "quality_threshold" in payload:
        val = float(payload["quality_threshold"])
        bridge._quality_threshold = val
        changed.append(f"quality_threshold={val}")
    if "push_back_max_rounds" in payload:
        val = int(payload["push_back_max_rounds"])
        state.push_back_max_rounds = max(1, min(5, val))
        changed.append(f"push_back_max_rounds={state.push_back_max_rounds}")
    if "loop_timeout_seconds" in payload:
        val = int(payload["loop_timeout_seconds"])
        os.environ["FLOWFORGE_EVOLUTION_LLM_TIMEOUT_SECONDS"] = str(val)
        changed.append(f"loop_timeout_seconds={val}")
    if "debug" in payload:
        os.environ["FLOWFORGE_DEBUG"] = "1" if payload["debug"] else "0"
        changed.append(f"debug={payload['debug']}")
    logger.info(f"Runtime settings updated: {', '.join(changed) if changed else 'no changes'}")
    return {
        "updated": True,
        "changes": changed,
        "current": {
            "loop_timeout_seconds": int(os.environ.get("FLOWFORGE_EVOLUTION_LLM_TIMEOUT_SECONDS", "90")),
            "quality_threshold": bridge._quality_threshold,
            "push_back_max_rounds": state.push_back_max_rounds,
            "debug": _bool_env("FLOWFORGE_DEBUG", False),
        },
    }


# ── Dashboard (GET /dashboard) ───────────────────────────────────────────────

async def _get_dashboard_data() -> dict:
    """仪表盘数据 — JSON 格式，供前端看板渲染。

    返回消息统计、LLM 调用统计、T7 审核统计、任务统计、Forgekin状态。
    """
    fk_cfgs = _get_forgekins()
    bridge = _get_bridge()
    collector = _get_metrics_collector()
    metrics_json = collector.get_json_metrics()

    # Forgekin状态
    forgekins_status = []
    for slug, cfg in fk_cfgs.items():
        forgekins_status.append({
            "id": cfg.get("forgekin_id", slug),
            "name": cfg.get("name", slug),
            "vendor": cfg.get("vendor", ""),
            "loop_type": cfg.get("self_dev_loop", {}).get("loop_type", ""),
            "awakening_stage": cfg.get("self_dev_loop", {}).get("awakening_stage", ""),
            "energy": cfg.get("energy", {}).get("initial", 1.0),
            "online": True,
        })

    # 任务统计
    task_stats = {"total": len(tasks_store), "running": 0, "completed": 0, "failed": 0, "pending": 0}
    for t in tasks_store.values():
        if t.status in task_stats:
            task_stats[t.status] += 1

    return {
        "status": "success",
        "data": {
            "forgekins": forgekins_status,
            "task_stats": task_stats,
            "message_count": len(state.messages),
            "ws_connections": len(state.subscribers),
            "metrics": metrics_json,
            "bridge": {
                "providers": list(bridge._providers.keys()),
                "chains": list(bridge._llm_route.get("fallback_chains", {}).keys()),
                "quality_threshold": bridge._quality_threshold,
            },
        },
    }
