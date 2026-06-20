"""Provider quota manager — TPM/RPM/cost budget tracking per provider.

Loads quota configuration from models.yaml's ``provider_quotas`` section
and tracks usage with sliding-window counters for TPM/RPM and daily
cost budget enforcement.

License: MIT
"""

import asyncio
import time
from collections import deque
from datetime import date, datetime, timezone
from typing import Any, Dict, Optional

from pydantic import BaseModel

from flowforge.core.tracing import get_logger

logger = get_logger("provider_quota")


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class QuotaConfig(BaseModel):
    """Per-provider quota configuration (maps 1:1 to models.yaml entry)."""

    monthly_budget_usd: float = 0.0
    tpm_limit: int = 0  # 0 means unlimited
    rpm_limit: int = 0  # 0 means unlimited
    alert_threshold: float = 0.8  # alert when usage exceeds this fraction


class UsageRecord(BaseModel):
    """Snapshot of current usage for a single provider."""

    provider: str
    tpm_current: int = 0
    rpm_current: int = 0
    daily_cost_usd: float = 0.0
    monthly_cost_usd: float = 0.0
    daily_budget_date: str = ""  # ISO date string for the current daily bucket


# ---------------------------------------------------------------------------
# Sliding-window counter
# ---------------------------------------------------------------------------


class _SlidingWindowCounter:
    """Sliding-window counter using a deque of (timestamp, value) pairs.

    Evicts entries older than *window_seconds* on every query so that
    ``current()`` always returns the sum of values within the window.
    """

    def __init__(self, window_seconds: float = 60.0) -> None:
        self._window = window_seconds
        self._entries: deque[tuple[float, int]] = deque()

    def add(self, value: int, ts: Optional[float] = None) -> None:
        ts = ts or time.time()
        self._entries.append((ts, value))

    def current(self, ts: Optional[float] = None) -> int:
        ts = ts or time.time()
        cutoff = ts - self._window
        while self._entries and self._entries[0][0] < cutoff:
            self._entries.popleft()
        return sum(v for _, v in self._entries)


# ---------------------------------------------------------------------------
# ProviderQuotaManager
# ---------------------------------------------------------------------------


class ProviderQuotaManager:
    """Manages TPM/RPM/cost budgets per provider.

    Thread-safe via ``asyncio.Lock``.  Quota configuration is loaded from
    the ``provider_quotas`` section of models.yaml; if a provider has no
    entry there, its quotas default to unlimited (limit == 0).
    """

    def __init__(self, quotas_config: Optional[Dict[str, Any]] = None) -> None:
        self._quotas: Dict[str, QuotaConfig] = {}
        self._tpm_counters: Dict[str, _SlidingWindowCounter] = {}
        self._rpm_counters: Dict[str, _SlidingWindowCounter] = {}
        self._daily_costs: Dict[str, float] = {}
        self._daily_dates: Dict[str, str] = {}
        self._monthly_costs: Dict[str, float] = {}
        self._lock = asyncio.Lock()

        if quotas_config:
            self._load_config(quotas_config)

    def _load_config(self, config: Dict[str, Any]) -> None:
        for provider, quota_dict in config.items():
            self._quotas[provider] = QuotaConfig(**quota_dict)
            self._tpm_counters[provider] = _SlidingWindowCounter(window_seconds=60.0)
            self._rpm_counters[provider] = _SlidingWindowCounter(window_seconds=60.0)
            self._daily_costs.setdefault(provider, 0.0)
            self._monthly_costs.setdefault(provider, 0.0)
            self._daily_dates.setdefault(provider, "")
        logger.info(
            f"ProviderQuotaManager loaded {len(self._quotas)} provider quotas"
        )

    def load_from_config(self, quotas_config: Dict[str, Any]) -> None:
        """Public entry point for (re)loading quota configuration."""
        self._load_config(quotas_config)

    async def record_usage(
        self, provider: str, tokens: int = 0, cost: float = 0.0
    ) -> None:
        """Record usage for a provider."""
        async with self._lock:
            self._ensure_provider(provider)

            if tokens > 0:
                self._tpm_counters[provider].add(tokens)
            self._rpm_counters[provider].add(1)

            today = date.today().isoformat()
            if self._daily_dates[provider] != today:
                self._daily_dates[provider] = today
                self._daily_costs[provider] = 0.0
            self._daily_costs[provider] += cost

            month_key = today[:7]
            if month_key not in self._monthly_costs:
                self._monthly_costs[month_key] = 0.0
            self._monthly_costs[month_key] += cost

    async def check_quota(self, provider: str) -> bool:
        """Check whether *provider* is still within its quota limits.

        Returns True if under all limits (or no limits configured).
        """
        async with self._lock:
            self._ensure_provider(provider)

            quota = self._quotas.get(provider)
            if quota is None:
                return True

            if quota.tpm_limit > 0:
                tpm = self._tpm_counters[provider].current()
                if tpm >= quota.tpm_limit:
                    logger.warning(
                        f"Provider {provider} TPM quota exceeded: "
                        f"{tpm}/{quota.tpm_limit}"
                    )
                    return False

            if quota.rpm_limit > 0:
                rpm = self._rpm_counters[provider].current()
                if rpm >= quota.rpm_limit:
                    logger.warning(
                        f"Provider {provider} RPM quota exceeded: "
                        f"{rpm}/{quota.rpm_limit}"
                    )
                    return False

            if quota.monthly_budget_usd > 0:
                today = date.today().isoformat()
                month_key = today[:7]
                monthly_cost = self._monthly_costs.get(month_key, 0.0)
                if monthly_cost >= quota.monthly_budget_usd:
                    logger.warning(
                        f"Provider {provider} monthly budget exceeded: "
                        f"${monthly_cost:.2f}/${quota.monthly_budget_usd:.2f}"
                    )
                    return False

            if quota.monthly_budget_usd > 0 and quota.alert_threshold > 0:
                today = date.today().isoformat()
                month_key = today[:7]
                monthly_cost = self._monthly_costs.get(month_key, 0.0)
                ratio = monthly_cost / quota.monthly_budget_usd
                if ratio >= quota.alert_threshold:
                    logger.warning(
                        f"Provider {provider} approaching budget limit: "
                        f"${monthly_cost:.2f}/${quota.monthly_budget_usd:.2f} "
                        f"({ratio:.0%})"
                    )

            return True

    async def get_usage_report(self) -> Dict[str, Any]:
        """Return a usage report for all tracked providers."""
        async with self._lock:
            providers: Dict[str, Any] = {}
            for provider in self._quotas:
                self._ensure_provider(provider)
                quota = self._quotas[provider]
                tpm = self._tpm_counters[provider].current()
                rpm = self._rpm_counters[provider].current()
                daily_cost = self._daily_costs.get(provider, 0.0)
                today = date.today().isoformat()
                month_key = today[:7]
                monthly_cost = self._monthly_costs.get(month_key, 0.0)

                providers[provider] = UsageRecord(
                    provider=provider,
                    tpm_current=tpm,
                    rpm_current=rpm,
                    daily_cost_usd=round(daily_cost, 6),
                    monthly_cost_usd=round(monthly_cost, 6),
                    daily_budget_date=self._daily_dates.get(provider, ""),
                ).model_dump()

                providers[provider]["quota"] = quota.model_dump()

            return {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "providers": providers,
            }

    def _ensure_provider(self, provider: str) -> None:
        """Lazily initialise tracking structures for a new provider."""
        if provider not in self._tpm_counters:
            self._tpm_counters[provider] = _SlidingWindowCounter(window_seconds=60.0)
        if provider not in self._rpm_counters:
            self._rpm_counters[provider] = _SlidingWindowCounter(window_seconds=60.0)
        self._daily_costs.setdefault(provider, 0.0)
        self._daily_dates.setdefault(provider, "")


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

_quota_manager_instance: Optional[ProviderQuotaManager] = None


def get_provider_quota_manager(
    quotas_config: Optional[Dict[str, Any]] = None,
) -> ProviderQuotaManager:
    """Return the singleton ProviderQuotaManager instance."""
    global _quota_manager_instance
    if _quota_manager_instance is None:
        _quota_manager_instance = ProviderQuotaManager(quotas_config)
    return _quota_manager_instance
