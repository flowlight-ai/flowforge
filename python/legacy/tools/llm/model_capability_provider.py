"""ModelCapabilityProvider — zero-config model access with smart routing and degradation.

Provides:
- Zero-config: auto-discover available models from config
- Smart routing: route requests to best available model based on capability
- Degradation: fallback to alternative models on failure
- Health tracking: track model availability and latency
"""
import time
from typing import Optional
from dataclasses import dataclass, field
from enum import Enum

from flowforge.core.tracing import get_logger

logger = get_logger(__name__)


class ModelHealth(str, Enum):
    HEALTHY = "healthy"
    DEGRADED = "degraded"
    UNAVAILABLE = "unavailable"


@dataclass
class ModelInfo:
    name: str
    provider: str
    capabilities: list[str] = field(default_factory=list)
    health: ModelHealth = ModelHealth.HEALTHY
    latency_ms: float = 0.0
    failure_count: int = 0
    last_check: float = 0.0


class ModelCapabilityProvider:
    """Zero-config model access with smart routing and degradation fallback."""

    def __init__(self, config: Optional[dict] = None):
        self._models: dict[str, ModelInfo] = {}
        self._capability_map: dict[str, list[str]] = {}  # capability -> [model_names]
        self._config = config or {}
        self._load_models_from_config()

    def _load_models_from_config(self) -> None:
        """Auto-discover models from config.

        Supports two config formats:
        1. List format: models is a list of dicts with 'id', 'provider', etc.
        2. Dict format: models is a dict mapping model_name -> model_conf.
        """
        models_config = self._config.get("models", {})
        if isinstance(models_config, list):
            # List format: [{"id": "auto", "provider": "openroute", ...}, ...]
            for item in models_config:
                if isinstance(item, dict):
                    model_id = item.get("id", "")
                    provider = item.get("provider", "unknown")
                    capabilities = item.get("capabilities", [])
                    enabled = item.get("enabled", True)
                    if model_id and enabled:
                        self.register_model(model_id, provider, capabilities)
        elif isinstance(models_config, dict):
            # Dict format: {"model_name": {"provider": "...", ...}, ...}
            for model_name, model_conf in models_config.items():
                if isinstance(model_conf, dict):
                    provider = model_conf.get("provider", "unknown")
                    capabilities = model_conf.get("capabilities", [])
                    self.register_model(model_name, provider, capabilities)

    def register_model(self, name: str, provider: str, capabilities: list[str] = None) -> None:
        """Register a model with its capabilities."""
        info = ModelInfo(name=name, provider=provider, capabilities=capabilities or [])
        self._models[name] = info
        for cap in (capabilities or []):
            if cap not in self._capability_map:
                self._capability_map[cap] = []
            self._capability_map[cap].append(name)
        logger.info(f"Registered model: {name} (provider={provider}, caps={capabilities})")

    def get_model(self, capability: Optional[str] = None, preferred: Optional[str] = None) -> Optional[str]:
        """Get best available model for a capability.

        Strategy:
        1. If preferred model is healthy, use it
        2. Find models with the required capability
        3. Sort by health (healthy > degraded > unavailable) then latency
        4. Return best available
        """
        # Try preferred model first
        if preferred and preferred in self._models:
            if self._models[preferred].health != ModelHealth.UNAVAILABLE:
                return preferred

        # Find by capability
        if capability and capability in self._capability_map:
            candidates = self._capability_map[capability]
            healthy = [m for m in candidates if self._models[m].health == ModelHealth.HEALTHY]
            if healthy:
                return min(healthy, key=lambda m: self._models[m].latency_ms)
            degraded = [m for m in candidates if self._models[m].health == ModelHealth.DEGRADED]
            if degraded:
                return min(degraded, key=lambda m: self._models[m].latency_ms)

        # Fallback: any healthy model
        healthy_models = [m for m, info in self._models.items() if info.health == ModelHealth.HEALTHY]
        if healthy_models:
            return min(healthy_models, key=lambda m: self._models[m].latency_ms)

        # Last resort: any non-unavailable model
        available = [m for m, info in self._models.items() if info.health != ModelHealth.UNAVAILABLE]
        return available[0] if available else None

    def report_success(self, model_name: str, latency_ms: float) -> None:
        """Report successful model call."""
        if model_name in self._models:
            info = self._models[model_name]
            info.latency_ms = latency_ms
            info.failure_count = max(0, info.failure_count - 1)
            if info.health == ModelHealth.DEGRADED and info.failure_count == 0:
                info.health = ModelHealth.HEALTHY
                logger.info(f"Model {model_name} recovered to HEALTHY")

    def report_failure(self, model_name: str, error: str = "") -> None:
        """Report model call failure."""
        if model_name in self._models:
            info = self._models[model_name]
            info.failure_count += 1
            if info.failure_count >= 3:
                info.health = ModelHealth.UNAVAILABLE
                logger.warning(f"Model {model_name} marked UNAVAILABLE after {info.failure_count} failures")
            elif info.failure_count >= 1:
                info.health = ModelHealth.DEGRADED
                logger.info(f"Model {model_name} marked DEGRADED after {info.failure_count} failures")

    def get_health_status(self) -> dict:
        """Get health status of all models."""
        return {name: {"health": info.health.value, "latency_ms": info.latency_ms, "failures": info.failure_count}
                for name, info in self._models.items()}
