import os
import json
import time
import asyncio
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any

import httpx

from flowforge.core.config import ConfigLoader
from flowforge.core.secret_store import get_secret_store
from flowforge.core.tracing import get_logger

logger = get_logger("model_service")


class ModelService:
    STATUS_AVAILABLE = "available"
    STATUS_DISABLED = "disabled"
    STATUS_SUSPENDED = "suspended"
    STATUS_UNKNOWN = "unknown"

    ERROR_TYPE_MAP = {
        "model_not_found": ["100019", "model not found", "does not exist"],
        "model_disabled": ["100020", "model disabled", "shutdown", "retiring"],
        "no_permission": ["100006", "100016", "unauthorized", "forbidden"],
        "rate_limit": ["100002", "rate limit", "too many requests", "throttling"],
        "no_quota": ["100011", "insufficient credits", "no quota", "balance too low"],
        "timeout": ["timeout", "timed out"],
        "server_error": ["5xx", "internal server error"],
    }

    def __init__(self, config_dir: Path = None, health_state_file: Path = None, plugin_registry: Any = None):
        self._config_loader = ConfigLoader(config_dir)
        self._plugin_registry = plugin_registry
        if health_state_file is None:
            data_dir = Path(__file__).parent.parent.parent / "data"
            data_dir.mkdir(parents=True, exist_ok=True)
            health_state_file = data_dir / "model_health_state.json"
        self._health_state_file = health_state_file
        self._lock = asyncio.Lock()
        self._load_config()
        self._load_health_state()

    def _load_config(self):
        cfg = self._config_loader.get_models_config()
        self.providers: Dict[str, dict] = cfg.get("providers", {})
        self.models: List[dict] = cfg.get("models", [])
        self.assignments: Dict[str, dict] = cfg.get("assignments", {})
        self.active_providers: List[str] = cfg.get("active_providers", list(self.providers.keys()))

    def _save_config(self):
        self._config_loader.save_yaml("models.yaml", {
            "active_providers": self.active_providers,
            "providers": self.providers,
            "models": self.models,
            "assignments": self.assignments,
        })

    def _load_health_state(self):
        if self._health_state_file.exists():
            try:
                with open(self._health_state_file, "r", encoding="utf-8") as f:
                    self._health_data: Dict[str, dict] = json.load(f)
            except Exception:
                self._health_data = {}
        else:
            self._health_data = {}

    def _save_health_state(self):
        self._health_state_file.parent.mkdir(parents=True, exist_ok=True)
        with open(self._health_state_file, "w", encoding="utf-8") as f:
            json.dump(self._health_data, f, indent=2, ensure_ascii=False)

    def reload_config(self):
        self._load_config()
        logger.info("Model config reloaded")

    def _get_api_key(self, provider: str) -> str:
        provider_config = self.providers.get(provider, {})
        api_key_env = provider_config.get("api_key_env")
        secret_store = get_secret_store()
        if api_key_env:
            key = secret_store.resolve(api_key_env)
            if key:
                return key
        key = secret_store.resolve(f"{provider.upper()}_API_KEY")
        if key:
            return key
        return provider_config.get("api_key_default", "")

    def _get_base_url(self, provider: str) -> str:
        provider_config = self.providers.get(provider, {})
        return provider_config.get("base_url", "")

    def _resolve_model(self, model_id: str) -> Optional[dict]:
        for m in self.models:
            if m.get("id") == model_id:
                return m
        return None

    def _get_model_key(self, model_id: str) -> Optional[str]:
        model = self._resolve_model(model_id)
        if model is None:
            return None
        return f"{model['provider']}/{model_id}"

    async def health_check_single(self, model_key: str, force: bool = False) -> dict:
        async with self._lock:
            return await self._check_with_cache(model_key, force)

    async def health_check_all(self, force: bool = False) -> List[dict]:
        async with self._lock:
            results = []
            seen: set = set()
            for model in self.models:
                if not model.get("enabled", True):
                    continue
                if model["provider"] not in self.active_providers:
                    continue
                model_key = f"{model['provider']}/{model['id']}"
                if model_key not in seen:
                    seen.add(model_key)
                    results.append(await self._check_with_cache(model_key, force))
            for key, assignment in self.assignments.items():
                primary = assignment.get("primary", "")
                if primary:
                    mk = self._get_model_key(primary) or primary
                    if mk not in seen:
                        provider = mk.split("/", 1)[0] if "/" in mk else ""
                        if provider in self.active_providers:
                            seen.add(mk)
                            results.append(await self._check_with_cache(mk, force))
                for fb in assignment.get("fallbacks", []):
                    mk = self._get_model_key(fb) or fb
                    if mk not in seen:
                        provider = mk.split("/", 1)[0] if "/" in mk else ""
                        if provider in self.active_providers:
                            seen.add(mk)
                            results.append(await self._check_with_cache(mk, force))
            return results

    async def _check_with_cache(self, model_key: str, force: bool) -> dict:
        state = self._health_data.get(model_key, {})
        now = time.time()

        if not force and state.get("status") == self.STATUS_AVAILABLE:
            last_check_ts = state.get("last_check_ts", 0)
            if now - last_check_ts < 86400:
                return {
                    "model_key": model_key,
                    "status": self.STATUS_AVAILABLE,
                    "last_check": state.get("last_check"),
                    "latency_ms": state.get("latency_ms", 0),
                    "cached": True,
                }

        if not force and state.get("status") == self.STATUS_DISABLED:
            return {
                "model_key": model_key,
                "status": self.STATUS_DISABLED,
                "last_check": state.get("last_check"),
                "reason": state.get("reason", ""),
                "cached": True,
            }

        if not force and state.get("status") == self.STATUS_SUSPENDED:
            suspended_until_ts = state.get("suspended_until_ts", 0)
            if now < suspended_until_ts:
                return {
                    "model_key": model_key,
                    "status": self.STATUS_SUSPENDED,
                    "last_check": state.get("last_check"),
                    "reason": state.get("reason", ""),
                    "suspended_until": state.get("suspended_until"),
                    "cached": True,
                }

        return await self._perform_health_check(model_key)

    async def _perform_health_check(self, model_key: str) -> dict:
        if "/" not in model_key:
            return {
                "model_key": model_key,
                "status": self.STATUS_UNKNOWN,
                "reason": "invalid model_key format",
                "cached": False,
            }

        provider, model_id = model_key.split("/", 1)

        if provider == "openroute":
            return await self._check_openroute_health(model_key, model_id)

        base_url = self._get_base_url(provider)
        api_key = self._get_api_key(provider)

        if not base_url:
            self._update_health_state(model_key, self.STATUS_DISABLED, reason="missing base_url")
            return {
                "model_key": model_key,
                "status": self.STATUS_DISABLED,
                "reason": "missing base_url",
                "cached": False,
            }

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": model_id,
            "messages": [{"role": "user", "content": "ping"}],
            "max_tokens": 1,
        }
        url = base_url.rstrip("/") + "/chat/completions"

        start = time.time()
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(url, json=payload, headers=headers)
                latency = (time.time() - start) * 1000
                status_code = resp.status_code

                if status_code == 200:
                    self._update_health_state(
                        model_key, self.STATUS_AVAILABLE,
                        latency_ms=round(latency, 1),
                    )
                    return {
                        "model_key": model_key,
                        "status": self.STATUS_AVAILABLE,
                        "latency_ms": round(latency, 1),
                        "cached": False,
                    }

                err_type, suspend_seconds = self._classify_error(None, resp)
                if suspend_seconds < 0:
                    reason = f"{err_type}: HTTP {status_code}"
                    self._update_health_state(model_key, self.STATUS_DISABLED, reason=reason)
                    return {
                        "model_key": model_key,
                        "status": self.STATUS_DISABLED,
                        "reason": reason,
                        "cached": False,
                    }
                else:
                    suspended_until = datetime.utcnow() + timedelta(seconds=suspend_seconds)
                    reason = f"{err_type}: HTTP {status_code}"
                    self._update_health_state(
                        model_key, self.STATUS_SUSPENDED,
                        suspended_until=suspended_until.isoformat(),
                        suspended_until_ts=suspended_until.timestamp(),
                        reason=reason,
                    )
                    return {
                        "model_key": model_key,
                        "status": self.STATUS_SUSPENDED,
                        "reason": reason,
                        "suspended_until": suspended_until.isoformat(),
                        "cached": False,
                    }
        except httpx.TimeoutException:
            error_count = self._health_data.get(model_key, {}).get("error_count", 0) + 1
            if error_count >= 5:
                self._update_health_state(
                    model_key, self.STATUS_DISABLED,
                    error_count=error_count,
                    reason=f"consecutive {error_count} timeouts",
                )
                return {
                    "model_key": model_key,
                    "status": self.STATUS_DISABLED,
                    "reason": "timeout",
                    "cached": False,
                }
            suspended_until = datetime.utcnow() + timedelta(seconds=300)
            self._update_health_state(
                model_key, self.STATUS_SUSPENDED,
                suspended_until=suspended_until.isoformat(),
                suspended_until_ts=suspended_until.timestamp(),
                error_count=error_count,
                reason="timeout",
            )
            return {
                "model_key": model_key,
                "status": self.STATUS_SUSPENDED,
                "reason": "timeout",
                "cached": False,
            }
        except Exception as e:
            err_type, suspend_seconds = self._classify_error(e)
            error_count = self._health_data.get(model_key, {}).get("error_count", 0) + 1
            if suspend_seconds < 0:
                self._update_health_state(
                    model_key, self.STATUS_DISABLED,
                    error_count=error_count,
                    reason=str(e)[:200],
                )
            else:
                suspended_until = datetime.utcnow() + timedelta(seconds=suspend_seconds)
                self._update_health_state(
                    model_key, self.STATUS_SUSPENDED,
                    suspended_until=suspended_until.isoformat(),
                    suspended_until_ts=suspended_until.timestamp(),
                    error_count=error_count,
                    reason=str(e)[:200],
                )
            return {
                "model_key": model_key,
                "status": self.STATUS_DISABLED if suspend_seconds < 0 else self.STATUS_SUSPENDED,
                "reason": str(e)[:200],
                "cached": False,
            }

    async def _check_openroute_health(self, model_key: str, model_id: str) -> dict:
        """Check health of an openroute model by verifying the openroute service is running.

        OpenRoute models require the hiclaw openroute service to be running.
        This method first checks if the openroute service is reachable, then attempts
        a lightweight ping to the specific model.
        """
        try:
            registry = self._plugin_registry
            if registry is None:
                raise ImportError("PluginRegistry not injected via constructor")
            svc = registry.get_plugin("openroute")
        except ImportError:
            self._update_health_state(model_key, self.STATUS_DISABLED, reason="openroute_service_unavailable")
            return {
                "model_key": model_key,
                "status": self.STATUS_DISABLED,
                "reason": "openroute_service_module_not_found",
                "cached": False,
            }

        proxy_healthy = await svc._health_check()
        if not proxy_healthy:
            self._update_health_state(model_key, self.STATUS_SUSPENDED, reason="proxy_service_not_running")
            return {
                "model_key": model_key,
                "status": self.STATUS_SUSPENDED,
                "reason": "proxy_service_not_running",
                "cached": False,
            }

        # Resolve openroute base_url and api_key from config
        openroute_cfg = self.providers.get("openroute", {})
        base_url = openroute_cfg.get("base_url", "http://127.0.0.1:13001/v1").rstrip("/")
        api_key = openroute_cfg.get("api_key_default", "")
        if not api_key:
            api_key_env = openroute_cfg.get("api_key_env", "OPENROUTE_API_KEY")
            api_key = os.getenv(api_key_env, "")

        start = time.time()
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                payload = {
                    "model": model_id,
                    "messages": [{"role": "user", "content": "ping"}],
                    "max_tokens": 1,
                }
                headers = {"Content-Type": "application/json"}
                if api_key:
                    headers["Authorization"] = f"Bearer {api_key}"
                resp = await client.post(
                    f"{base_url}/chat/completions",
                    json=payload,
                    headers=headers,
                )
                latency = (time.time() - start) * 1000
                if resp.status_code == 200:
                    self._update_health_state(
                        model_key, self.STATUS_AVAILABLE,
                        latency_ms=round(latency, 1),
                    )
                    return {
                        "model_key": model_key,
                        "status": self.STATUS_AVAILABLE,
                        "latency_ms": round(latency, 1),
                        "cached": False,
                    }
                else:
                    err_type, suspend_seconds = self._classify_error(None, resp)
                    if suspend_seconds < 0:
                        self._update_health_state(model_key, self.STATUS_DISABLED, reason=f"{err_type}: HTTP {resp.status_code}")
                        return {
                            "model_key": model_key,
                            "status": self.STATUS_DISABLED,
                            "reason": f"{err_type}: HTTP {resp.status_code}",
                            "cached": False,
                        }
                    suspended_until = datetime.utcnow() + timedelta(seconds=suspend_seconds)
                    self._update_health_state(
                        model_key, self.STATUS_SUSPENDED,
                        suspended_until=suspended_until.isoformat(),
                        suspended_until_ts=suspended_until.timestamp(),
                        reason=f"{err_type}: HTTP {resp.status_code}",
                    )
                    return {
                        "model_key": model_key,
                        "status": self.STATUS_SUSPENDED,
                        "reason": f"{err_type}: HTTP {resp.status_code}",
                        "suspended_until": suspended_until.isoformat(),
                        "cached": False,
                    }
        except httpx.TimeoutException:
            self._update_health_state(model_key, self.STATUS_SUSPENDED, reason="timeout")
            return {
                "model_key": model_key,
                "status": self.STATUS_SUSPENDED,
                "reason": "timeout",
                "cached": False,
            }
        except Exception as e:
            self._update_health_state(model_key, self.STATUS_SUSPENDED, reason=str(e)[:200])
            return {
                "model_key": model_key,
                "status": self.STATUS_SUSPENDED,
                "reason": str(e)[:200],
                "cached": False,
            }

    def _classify_error(
        self,
        error: Optional[Exception],
        response: Optional[httpx.Response] = None,
    ) -> Tuple[str, int]:
        if response is not None:
            status_code = response.status_code
            if status_code in (401, 403):
                return "no_permission", 3600
            if status_code == 404:
                return "model_not_found", -1
            if status_code == 429:
                return "rate_limit", 300
            if 500 <= status_code < 600:
                return "server_error", 60

            try:
                resp_data = response.json()
                error_code = str(resp_data.get("error", {}).get("code", ""))
                error_msg = str(resp_data.get("error", {}).get("message", "")).lower()
                for err_type, patterns in self.ERROR_TYPE_MAP.items():
                    for pattern in patterns:
                        if pattern in error_code or pattern in error_msg:
                            if err_type in ("model_not_found", "model_disabled", "no_permission"):
                                return err_type, -1
                            elif err_type == "no_quota":
                                return err_type, 18000
                            elif err_type == "rate_limit":
                                return err_type, 300
                            else:
                                return err_type, 60
            except Exception:
                pass

        if error is not None:
            error_msg = str(error).lower()
            if "timeout" in error_msg or "connection" in error_msg:
                return "timeout", 300
            for err_type, patterns in self.ERROR_TYPE_MAP.items():
                for pattern in patterns:
                    if pattern in error_msg:
                        if err_type in ("model_not_found", "model_disabled", "no_permission"):
                            return err_type, -1
                        elif err_type == "no_quota":
                            return err_type, 18000
                        elif err_type == "rate_limit":
                            return err_type, 300
                        else:
                            return err_type, 60

        return "unknown", 60

    def _update_health_state(self, model_key: str, status: str, **kwargs):
        if model_key not in self._health_data:
            self._health_data[model_key] = {}

        record = self._health_data[model_key]
        record["status"] = status
        record["last_check"] = datetime.utcnow().isoformat()
        record["last_check_ts"] = time.time()

        if status == self.STATUS_AVAILABLE:
            record.pop("suspended_until", None)
            record.pop("suspended_until_ts", None)
            record.pop("reason", None)
            record["error_count"] = 0
            if "latency_ms" in kwargs:
                record["latency_ms"] = kwargs["latency_ms"]
        else:
            for key in ("reason", "error_count", "latency_ms", "suspended_until", "suspended_until_ts"):
                if key in kwargs:
                    record[key] = kwargs[key]

        self._save_health_state()

    async def auto_fix(self, assignment_key: str = "default", cascade: bool = True) -> dict:
        report = {
            "assignment_key": assignment_key,
            "timestamp": datetime.utcnow().isoformat(),
            "fixes": [],
            "cascade_suggestions": [],
            "summary": "",
        }

        assignment = self.assignments.get(assignment_key, {})
        if not assignment:
            report["summary"] = f"Assignment '{assignment_key}' not found"
            return report

        primary = assignment.get("primary", "")
        if primary:
            primary_key = self._get_model_key(primary) or primary
            health = await self._check_with_cache(primary_key, force=True)
            if health["status"] != self.STATUS_AVAILABLE:
                replacement = None
                replacement_source = "global"
                for fb in assignment.get("fallbacks", []):
                    fb_key = self._get_model_key(fb) or fb
                    fb_health = await self._check_with_cache(fb_key, force=True)
                    if fb_health["status"] == self.STATUS_AVAILABLE:
                        replacement = fb
                        replacement_source = "fallback"
                        break

                if not replacement:
                    replacement = await self._find_healthy_model()

                if replacement:
                    report["fixes"].append({
                        "original_model": primary,
                        "original_status": health["status"],
                        "replacement_model": replacement,
                        "source": replacement_source if replacement in assignment.get("fallbacks", []) else "global",
                    })

        if cascade:
            affected_models = set()
            for fix in report["fixes"]:
                affected_models.add(fix["original_model"])

            for other_key, other_assignment in self.assignments.items():
                if other_key == assignment_key:
                    continue
                other_primary = other_assignment.get("primary", "")
                if other_primary in affected_models:
                    report["cascade_suggestions"].append({
                        "assignment_key": other_key,
                        "shared_model": other_primary,
                        "suggested_action": "review_and_update",
                    })
                for fb in other_assignment.get("fallbacks", []):
                    if fb in affected_models:
                        report["cascade_suggestions"].append({
                            "assignment_key": other_key,
                            "shared_model": fb,
                            "suggested_action": "review_and_update",
                        })

        fixed_count = len(report["fixes"])
        cascade_count = len(report["cascade_suggestions"])
        if fixed_count > 0:
            report["summary"] = f"Fixed {fixed_count} model assignment(s)"
            if cascade_count > 0:
                report["summary"] += f", {cascade_count} affected assignment(s) need review"
        else:
            report["summary"] = "All models healthy, no fixes needed"

        return report

    async def _find_healthy_model(self) -> Optional[str]:
        for model in self.models:
            if not model.get("enabled", True):
                continue
            model_key = f"{model['provider']}/{model['id']}"
            health = await self._check_with_cache(model_key, force=False)
            if health["status"] == self.STATUS_AVAILABLE:
                return model["id"]
        return None

    def get_models(self) -> List[dict]:
        result = []
        for m in self.models:
            if m["provider"] not in self.active_providers:
                continue
            entry = dict(m)
            model_key = f"{m['provider']}/{m['id']}"
            health = self._health_data.get(model_key, {})
            entry["health_status"] = health.get("status", self.STATUS_UNKNOWN)
            entry["last_check"] = health.get("last_check")
            entry["error_count"] = health.get("error_count", 0)
            entry["reason"] = health.get("reason", "")
            entry["latency_ms"] = health.get("latency_ms", 0)
            result.append(entry)
        return result

    def add_model(self, model_id: str, provider: str, enabled: bool = True, **kwargs) -> dict:
        existing = self._resolve_model(model_id)
        if existing:
            raise ValueError(f"Model '{model_id}' already exists")
        if provider not in self.providers:
            raise ValueError(f"Provider '{provider}' not found")

        model = {"id": model_id, "provider": provider, "enabled": enabled}
        model.update(kwargs)
        self.models.append(model)
        self._save_config()
        logger.info(f"Model added: {provider}/{model_id}")
        return model

    def remove_model(self, model_id: str) -> dict:
        for i, m in enumerate(self.models):
            if m.get("id") == model_id:
                removed = self.models.pop(i)
                model_key = f"{removed['provider']}/{removed['id']}"
                self._health_data.pop(model_key, None)
                self._save_health_state()
                self._save_config()
                logger.info(f"Model removed: {model_key}")
                return {"deleted": model_key}
        raise ValueError(f"Model '{model_id}' not found")

    def update_model(self, model_id: str, **kwargs) -> dict:
        model = self._resolve_model(model_id)
        if model is None:
            raise ValueError(f"Model '{model_id}' not found")

        old_provider = model.get("provider")
        for key, value in kwargs.items():
            model[key] = value

        new_provider = model.get("provider")
        if old_provider != new_provider:
            old_key = f"{old_provider}/{model_id}"
            new_key = f"{new_provider}/{model_id}"
            if old_key in self._health_data:
                self._health_data[new_key] = self._health_data.pop(old_key)
                self._save_health_state()

        self._save_config()
        logger.info(f"Model updated: {model_id}")
        return dict(model)

    def get_providers(self) -> List[dict]:
        return [{"name": name, **config} for name, config in self.providers.items()]

    def get_assignments(self) -> dict:
        return dict(self.assignments)

    def update_assignment(self, key: str, primary: str, fallbacks: List[str] = None):
        self.assignments[key] = {
            "primary": primary,
            "fallbacks": fallbacks or [],
        }
        self._save_config()
        logger.info(f"Assignment updated: {key} -> {primary}")

    def get_health_report(self) -> dict:
        models = []
        for model_key, state in self._health_data.items():
            models.append({
                "model_key": model_key,
                "status": state.get("status", self.STATUS_UNKNOWN),
                "last_check": state.get("last_check"),
                "error_count": state.get("error_count", 0),
                "reason": state.get("reason", ""),
                "latency_ms": state.get("latency_ms", 0),
            })
        return {
            "models": models,
            "summary": self.get_health_summary(),
        }

    def get_health_summary(self) -> dict:
        total = len(self._health_data)
        available = sum(1 for s in self._health_data.values() if s.get("status") == self.STATUS_AVAILABLE)
        disabled = sum(1 for s in self._health_data.values() if s.get("status") == self.STATUS_DISABLED)
        suspended = sum(1 for s in self._health_data.values() if s.get("status") == self.STATUS_SUSPENDED)
        unknown = total - available - disabled - suspended
        return {
            "total": total,
            "available": available,
            "disabled": disabled,
            "suspended": suspended,
            "unknown": unknown,
        }

    def cleanup_health_state(self, days: int = 30):
        now = time.time()
        to_remove = []
        for model_key, record in self._health_data.items():
            if record.get("status") == self.STATUS_AVAILABLE:
                last_check_ts = record.get("last_check_ts", 0)
                if now - last_check_ts > days * 86400:
                    to_remove.append(model_key)

        for key in to_remove:
            del self._health_data[key]

        if to_remove:
            self._save_health_state()
            logger.info(f"Cleaned up {len(to_remove)} old health records")

    def get_model_chain(self, assignment_key: str) -> List[str]:
        assignment = self.assignments.get(assignment_key, {})
        primary = assignment.get("primary", "")
        fallbacks = assignment.get("fallbacks", [])
        chain = []
        if primary:
            mk = self._get_model_key(primary)
            if mk:
                chain.append(mk)
        for fb in fallbacks:
            mk = self._get_model_key(fb)
            if mk:
                chain.append(mk)
        return chain

    def get_available_fallback_chain(self, assignment_key: str = "default") -> List[str]:
        """Get fallback chain containing only available models.

        Filters out disabled and suspended models from the fallback chain.
        Used by Helm chat model selection to only show working models.

        Args:
            assignment_key: The assignment key to get the chain for.

        Returns:
            List of model_key strings that are currently available.
        """
        chain = self.get_model_chain(assignment_key)
        available = []
        for model_key in chain:
            state = self._health_data.get(model_key, {})
            status = state.get("status", self.STATUS_UNKNOWN)
            if status == self.STATUS_AVAILABLE or status == self.STATUS_UNKNOWN:
                available.append(model_key)
        return available

    def record_call_failure(self, model_key: str, error: str = "") -> dict:
        """Record a model call failure and update failure counter.

        If a model fails 3 consecutive times, it is removed from all
        fallback lists. If all fallbacks are removed, triggers a force
        update of model health status.

        Args:
            model_key: The model that failed (e.g., 'openrouter/baidu/cobuddy:free').
            error: Error description.

        Returns:
            dict with keys: model_key, consecutive_failures, removed_from_fallback,
            fallback_now_empty, triggered_force_update.
        """
        if model_key not in self._health_data:
            self._health_data[model_key] = {}

        record = self._health_data[model_key]
        failures = record.get("consecutive_failures", 0) + 1
        record["consecutive_failures"] = failures
        record["last_failure"] = datetime.utcnow().isoformat()
        if error:
            record["last_failure_reason"] = error[:200]

        removed_from_fallback = False
        fallback_now_empty = False
        triggered_force_update = False

        if failures >= 3:
            removed_from_fallback = self._remove_from_fallbacks(model_key)
            record["status"] = self.STATUS_SUSPENDED
            record["reason"] = f"consecutive {failures} failures"

            for assignment_key, assignment in self.assignments.items():
                fallbacks = assignment.get("fallbacks", [])
                primary = assignment.get("primary", "")
                primary_key = self._get_model_key(primary) or primary
                available_fbs = [
                    fb for fb in fallbacks
                    if self._health_data.get(self._get_model_key(fb) or fb, {}).get("status") in
                       (self.STATUS_AVAILABLE, self.STATUS_UNKNOWN)
                ]
                if not available_fbs and (not primary or primary_key == model_key):
                    fallback_now_empty = True
                    triggered_force_update = True

        if triggered_force_update:
            asyncio.ensure_future(self.force_update_models())

        self._save_health_state()
        return {
            "model_key": model_key,
            "consecutive_failures": failures,
            "removed_from_fallback": removed_from_fallback,
            "fallback_now_empty": fallback_now_empty,
            "triggered_force_update": triggered_force_update,
        }

    def record_call_success(self, model_key: str) -> dict:
        """Record a successful model call, resetting the failure counter.

        Args:
            model_key: The model that succeeded.

        Returns:
            dict with keys: model_key, consecutive_failures_reset.
        """
        if model_key not in self._health_data:
            self._health_data[model_key] = {}

        record = self._health_data[model_key]
        record["consecutive_failures"] = 0
        record["last_success"] = datetime.utcnow().isoformat()
        if record.get("status") != self.STATUS_AVAILABLE:
            record["status"] = self.STATUS_AVAILABLE
            record.pop("reason", None)
            record.pop("suspended_until", None)
            record.pop("suspended_until_ts", None)

        self._save_health_state()
        return {"model_key": model_key, "consecutive_failures_reset": True}

    def _remove_from_fallbacks(self, model_key: str) -> bool:
        """Remove a model from all fallback lists in assignments.

        Args:
            model_key: The model key to remove (e.g., 'openrouter/baidu/cobuddy:free').

        Returns:
            True if the model was removed from any fallback list.
        """
        removed = False
        model_id = model_key.split("/", 1)[-1] if "/" in model_key else model_key

        for assignment_key, assignment in self.assignments.items():
            fallbacks = assignment.get("fallbacks", [])
            if model_id in fallbacks:
                assignment["fallbacks"] = [fb for fb in fallbacks if fb != model_id]
                removed = True
            if model_key in fallbacks:
                assignment["fallbacks"] = [fb for fb in fallbacks if fb != model_key]
                removed = True

        if removed:
            self._save_config()
            logger.info(f"Model {model_key} removed from fallback lists due to consecutive failures")

        return removed

    async def force_update_models(self) -> dict:
        """Force update health status of active provider models concurrently.

        Groups models by provider and checks each provider's models
        concurrently. Only checks models from active_providers.

        Returns:
            dict with keys: checked_models, available_count, disabled_count,
            suspended_count, fallback_chains_rebuilt.
        """
        logger.info(f"Force updating model health for active providers: {self.active_providers}")
        active_models = [m for m in self.models
                         if m.get("enabled", True) and m["provider"] in self.active_providers]
        provider_groups: Dict[str, List[str]] = {}
        for m in active_models:
            mk = f"{m['provider']}/{m['id']}"
            provider_groups.setdefault(m["provider"], []).append(mk)

        all_results = []
        async with self._lock:
            for provider, model_keys in provider_groups.items():
                tasks = [self._check_with_cache(mk, force=True) for mk in model_keys]
                provider_results = await asyncio.gather(*tasks, return_exceptions=True)
                for r in provider_results:
                    if isinstance(r, Exception):
                        all_results.append({"status": self.STATUS_SUSPENDED, "reason": str(r)[:200]})
                    else:
                        all_results.append(r)

        available_count = sum(1 for r in all_results if r.get("status") == self.STATUS_AVAILABLE)
        disabled_count = sum(1 for r in all_results if r.get("status") == self.STATUS_DISABLED)
        suspended_count = sum(1 for r in all_results if r.get("status") == self.STATUS_SUSPENDED)

        chains_rebuilt = 0
        for assignment_key, assignment in self.assignments.items():
            original_fallbacks = list(assignment.get("fallbacks", []))
            new_fallbacks = []
            for fb in original_fallbacks:
                fb_key = self._get_model_key(fb) or fb
                provider = fb_key.split("/", 1)[0] if "/" in fb_key else ""
                if provider not in self.active_providers:
                    new_fallbacks.append(fb)
                    continue
                state = self._health_data.get(fb_key, {})
                status = state.get("status", self.STATUS_UNKNOWN)
                if status in (self.STATUS_AVAILABLE, self.STATUS_UNKNOWN):
                    new_fallbacks.append(fb)

            if not new_fallbacks:
                for m in active_models:
                    mk = f"{m['provider']}/{m['id']}"
                    if mk in [self._get_model_key(fb) or fb for fb in original_fallbacks]:
                        continue
                    state = self._health_data.get(mk, {})
                    if state.get("status") in (self.STATUS_AVAILABLE, self.STATUS_UNKNOWN):
                        new_fallbacks.append(m["id"])

            if new_fallbacks != original_fallbacks:
                assignment["fallbacks"] = new_fallbacks
                chains_rebuilt += 1

        if chains_rebuilt > 0:
            self._save_config()

        logger.info(f"Force update complete: {available_count} available, {disabled_count} disabled, {suspended_count} suspended, {chains_rebuilt} chains rebuilt")
        return {
            "checked_models": len(all_results),
            "available_count": available_count,
            "disabled_count": disabled_count,
            "suspended_count": suspended_count,
            "fallback_chains_rebuilt": chains_rebuilt,
        }


_model_service: Optional["ModelService"] = None


def get_model_service(plugin_registry: Any = None) -> "ModelService":
    """Get or create the global ModelService singleton."""
    global _model_service
    if _model_service is None:
        _model_service = ModelService(plugin_registry=plugin_registry)
    return _model_service
