"""Provider quota manager — TPM/RPM/cost budget tracking per provider and per model.

Loads quota configuration from models.yaml's ``provider_quotas`` section
and tracks usage with sliding-window counters for TPM/RPM and daily
cost budget enforcement.

Also supports per-model quota management with over-limit action strategies,
merged from DevForge's quota module.

License: MIT
"""

import asyncio
import time
from collections import deque
from dataclasses import dataclass
from datetime import UTC, date, datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel

from flowforge.core.tracing import get_logger

logger = get_logger("provider_quota")


# ---------------------------------------------------------------------------
# Over-limit action (from DevForge quota)
# ---------------------------------------------------------------------------


class OverLimitAction(Enum):
    """超限行为策略。"""
    QUEUE = "queue"          # 排队等待
    CASCADE = "cascade"      # 级联到备选模型
    REJECT = "reject"        # 直接拒绝
    WARN = "warn"            # 警告但继续


# ---------------------------------------------------------------------------
# Per-model quota (from DevForge quota)
# ---------------------------------------------------------------------------


@dataclass
class ModelQuota:
    """单个模型的配额配置。

    与 QuotaConfig（按provider维度）互补，提供按模型维度的配额管理。
    """
    model: str
    provider: str
    tpm: int = 0             # tokens per minute, 0=无限制
    rpm: int = 0             # requests per minute, 0=无限制
    cost_per_1k_input: float = 0.0
    cost_per_1k_output: float = 0.0
    monthly_budget: float = 0.0  # 月度预算, 0=无限制
    over_limit_action: OverLimitAction = OverLimitAction.CASCADE
    alert_threshold: float = 0.8  # 预算使用率告警阈值


@dataclass
class ModelUsageRecord:
    """按模型维度的使用记录。"""
    model: str
    timestamp: float
    input_tokens: int = 0
    output_tokens: int = 0
    cost: float = 0.0


# ---------------------------------------------------------------------------
# Pydantic models (per-provider)
# ---------------------------------------------------------------------------


class QuotaConfig(BaseModel):
    """Per-provider quota configuration (maps 1:1 to models.yaml entry)."""

    monthly_budget_usd: float = 0.0
    tpm_limit: int = 0  # 0 means unlimited
    rpm_limit: int = 0  # 0 means unlimited
    alert_threshold: float = 0.8  # alert when usage exceeds this fraction
    cost_per_1k_input: float = 0.0
    cost_per_1k_output: float = 0.0


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

    def add(self, value: int, ts: float | None = None) -> None:
        ts = ts or time.time()
        self._entries.append((ts, value))

    def current(self, ts: float | None = None) -> int:
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

    def __init__(self, quotas_config: dict[str, Any] | None = None) -> None:
        self._quotas: dict[str, QuotaConfig] = {}
        self._tpm_counters: dict[str, _SlidingWindowCounter] = {}
        self._rpm_counters: dict[str, _SlidingWindowCounter] = {}
        self._daily_costs: dict[str, float] = {}
        self._daily_dates: dict[str, str] = {}
        self._monthly_costs: dict[str, float] = {}
        self._lock = asyncio.Lock()

        if quotas_config:
            self._load_config(quotas_config)

    def _load_config(self, config: dict[str, Any]) -> None:
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

    def load_from_config(self, quotas_config: dict[str, Any]) -> None:
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

    async def get_usage_report(self) -> dict[str, Any]:
        """Return a usage report for all tracked providers."""
        async with self._lock:
            providers: dict[str, Any] = {}
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
                "generated_at": datetime.now(UTC).isoformat(),
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
# Model-level Quota Manager (from DevForge quota)
# ---------------------------------------------------------------------------


class ModelQuotaManager:
    """按模型维度的配额管理器。

    与 ProviderQuotaManager（按provider维度）互补，
    提供更细粒度的按模型TPM/RPM和月度预算管理。
    """

    def __init__(self, quotas: list[ModelQuota] | None = None):
        self._quotas: dict[str, ModelQuota] = {}
        self._usage: dict[str, list[ModelUsageRecord]] = {}
        self._monthly_cost: dict[str, float] = {}

        if quotas:
            for q in quotas:
                self._quotas[q.model] = q
                self._usage[q.model] = []
                self._monthly_cost[q.model] = 0.0

    def register_quota(self, quota: ModelQuota) -> None:
        """注册模型配额。"""
        self._quotas[quota.model] = quota
        if quota.model not in self._usage:
            self._usage[quota.model] = []
        if quota.model not in self._monthly_cost:
            self._monthly_cost[quota.model] = 0.0

    def check_quota(self, model: str, estimated_tokens: int = 0) -> tuple[bool, str]:
        """检查是否还有配额。

        Returns:
            (allowed, reason) - 是否允许，以及拒绝原因
        """
        quota = self._quotas.get(model)
        if not quota:
            return True, ""

        # 检查月度预算
        if quota.monthly_budget > 0:
            current_cost = self._monthly_cost.get(model, 0.0)
            if current_cost >= quota.monthly_budget:
                return False, f"月度预算已用完: {current_cost:.2f}/{quota.monthly_budget:.2f}"
            if current_cost / quota.monthly_budget >= quota.alert_threshold:
                logger.warning(
                    f"模型 {model} 月度预算使用率 {current_cost/quota.monthly_budget:.1%}"
                )

        # 检查RPM
        if quota.rpm > 0:
            now = time.time()
            recent = [r for r in self._usage.get(model, []) if now - r.timestamp < 60]
            if len(recent) >= quota.rpm:
                return False, f"RPM已达上限: {len(recent)}/{quota.rpm}"

        # 检查TPM
        if quota.tpm > 0 and estimated_tokens > 0:
            now = time.time()
            recent = [r for r in self._usage.get(model, []) if now - r.timestamp < 60]
            recent_tokens = sum(r.input_tokens + r.output_tokens for r in recent)
            if recent_tokens + estimated_tokens > quota.tpm:
                return False, f"TPM即将达上限: {recent_tokens}/{quota.tpm}"

        return True, ""

    def record_usage(self, model: str, input_tokens: int, output_tokens: int) -> float:
        """记录使用量并返回费用。"""
        quota = self._quotas.get(model)
        cost = 0.0
        if quota:
            cost = (input_tokens / 1000 * quota.cost_per_1k_input +
                    output_tokens / 1000 * quota.cost_per_1k_output)
            self._monthly_cost[model] = self._monthly_cost.get(model, 0.0) + cost

        self._usage.setdefault(model, []).append(ModelUsageRecord(
            model=model, timestamp=time.time(),
            input_tokens=input_tokens, output_tokens=output_tokens,
            cost=cost,
        ))
        return cost

    def get_usage_summary(self) -> dict[str, dict[str, Any]]:
        """获取使用量摘要。"""
        summary = {}
        for model, quota in self._quotas.items():
            current_cost = self._monthly_cost.get(model, 0.0)
            summary[model] = {
                "provider": quota.provider,
                "monthly_cost": current_cost,
                "monthly_budget": quota.monthly_budget,
                "budget_usage_rate": (current_cost / quota.monthly_budget
                                      if quota.monthly_budget > 0 else 0.0),
                "rpm_limit": quota.rpm,
                "tpm_limit": quota.tpm,
            }
        return summary

    def get_over_limit_action(self, model: str) -> OverLimitAction:
        """获取超限行为。"""
        quota = self._quotas.get(model)
        return quota.over_limit_action if quota else OverLimitAction.CASCADE


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

_quota_manager_instance: ProviderQuotaManager | None = None


def get_provider_quota_manager(
    quotas_config: dict[str, Any] | None = None,
) -> ProviderQuotaManager:
    """Return the singleton ProviderQuotaManager instance."""
    global _quota_manager_instance
    if _quota_manager_instance is None:
        _quota_manager_instance = ProviderQuotaManager(quotas_config)
    return _quota_manager_instance
