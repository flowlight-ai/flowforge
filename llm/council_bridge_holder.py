"""ForgekinLLMBridge singleton holder for the FastAPI app.

The bridge is constructed once on first access and reused across requests.
If the config files (llm_route.yaml / web_chat_prompts.yaml) are missing,
``get_bridge()`` returns ``None`` and endpoints degrade gracefully — they
report "bridge unavailable" instead of crashing.

This keeps the new project's T7/push_back/external-agent advantages available
to the old project's modular ``app/api/endpoints/`` structure, per
PORTING-SPEC.md §3.4.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from flowforge.core.tracing import get_logger
from flowforge.llm.council_bridge import ForgekinLLMBridge

logger = get_logger("flowforge.llm.council_bridge_holder")

_bridge: ForgekinLLMBridge | None = None
_bridge_init_failed: bool = False
_failure_reason: str = ""


def _config_dir() -> Path:
    """Return the flowforge config directory.

    After flattening, the package root is at ``flowforge/`` and config lives
    at ``flowforge/config/``. ``__file__`` is
    ``flowforge/llm/council_bridge_holder.py``, so ``parent.parent`` is
    ``flowforge/``.
    """
    return Path(__file__).resolve().parent.parent / "config"


def get_bridge() -> ForgekinLLMBridge | None:
    """Return the singleton bridge instance, or ``None`` if unavailable.

    On the first call this attempts to construct the bridge from
    ``config/llm_route.yaml`` + ``config/web_chat_prompts.yaml`` +
    ``config/forgemind.yaml``. If construction fails (missing files, no
    providers, etc.), subsequent calls return ``None`` without retrying —
    this avoids spamming the log on every request.
    """
    global _bridge, _bridge_init_failed, _failure_reason
    if _bridge is not None:
        return _bridge
    if _bridge_init_failed:
        return None
    try:
        cfg_dir = _config_dir()
        _bridge = ForgekinLLMBridge.from_config(cfg_dir)
        logger.info(
            f"ForgekinLLMBridge initialized from {cfg_dir} "
            f"(providers={list(_bridge._providers)})"
        )
        return _bridge
    except FileNotFoundError as exc:
        _failure_reason = f"config file missing: {exc}"
        _bridge_init_failed = True
        logger.warning(f"ForgekinLLMBridge unavailable — {_failure_reason}")
        return None
    except Exception as exc:  # noqa: BLE001
        _failure_reason = f"init failed: {exc!r}"
        _bridge_init_failed = True
        logger.warning(f"ForgekinLLMBridge unavailable — {_failure_reason}")
        return None


def reload_bridge() -> bool:
    """Force re-initialization of the bridge (used by settings reload).

    Returns ``True`` if the bridge was successfully reloaded.
    """
    global _bridge, _bridge_init_failed, _failure_reason
    _bridge = None
    _bridge_init_failed = False
    _failure_reason = ""
    return get_bridge() is not None


def get_bridge_status() -> dict[str, Any]:
    """Return a diagnostic dict for the ``/bridge/status`` endpoint."""
    if _bridge is not None:
        b = _bridge
        return {
            "available": True,
            "providers": list(b._providers.keys()),
            "chains_available": list(b._llm_route.get("fallback_chains", {}).keys()),
            "default_chain": b.DEFAULT_CHAIN,
            "t7_chain": b.T7_CHAIN,
            "quality_threshold": b._quality_threshold,
            "prompts_loaded": bool(b._prompts),
            "config_dir": str(b._config_dir),
        }
    return {
        "available": False,
        "reason": _failure_reason or "not initialized",
    }
