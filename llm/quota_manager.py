"""ProviderQuotaManager — Provider级成本/配额管理

设计文档参考：S3.0-13, spec.md H.2, LP3.0-24
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from pydantic import BaseModel

logger = logging.getLogger(__name__)


class QuotaResult(BaseModel):
    allowed: bool = True
    reason: str = ""
    action: str = "proceed"
    current_usage: Dict[str, Any] = {}


@dataclass
class QuotaState:
    tpm_used: int = 0
    rpm_used: int = 0
    budget_used: float = 0.0
    tpm_window_start: float = 0.0
    rpm_window_start: float = 0.0
    total_requests: int = 0
    total_tokens: int = 0
    total_cost: float = 0.0


@dataclass
class QuotaConfig:
    tpm_limit: int = 100000
    rpm_limit: int = 1000
    monthly_budget_usd: float = 100.0
    alert_threshold: float = 0.8
    cost_per_1k_input: float = 0.002
    cost_per_1k_output: float = 0.006


class ProviderQuotaManager:
    """Provider级成本/配额管理"""

    def __init__(self, configs: Optional[Dict[str, QuotaConfig]] = None):
        self._configs: Dict[str, QuotaConfig] = configs or {}
        self._states: Dict[str, QuotaState] = {}
        self._alert_callbacks: List[Any] = []

    def register_provider(self, provider: str, config: QuotaConfig) -> None:
        self._configs[provider] = config
        self._states[provider] = QuotaState()

    def add_alert_callback(self, callback: Any) -> None:
        self._alert_callbacks.append(callback)

    async def check_quota(self, provider: str, model: str = "", estimated_tokens: int = 0) -> QuotaResult:
        config = self._configs.get(provider)
        if not config:
            return QuotaResult(allowed=True, action="proceed")
        state = self._get_state(provider)
        self._reset_windows_if_needed(state)
        current_usage = {"tpm_used": state.tpm_used, "tpm_limit": config.tpm_limit, "rpm_used": state.rpm_used, "rpm_limit": config.rpm_limit, "budget_used": round(state.budget_used, 4), "budget_limit": config.monthly_budget_usd}

        if state.tpm_used + estimated_tokens > config.tpm_limit:
            return QuotaResult(allowed=False, reason=f"TPM exceeded: {state.tpm_used + estimated_tokens}/{config.tpm_limit}", action="queue_or_fallback", current_usage=current_usage)
        if state.rpm_used >= config.rpm_limit:
            return QuotaResult(allowed=False, reason=f"RPM exceeded: {state.rpm_used}/{config.rpm_limit}", action="queue_or_fallback", current_usage=current_usage)
        if state.budget_used >= config.monthly_budget_usd:
            return QuotaResult(allowed=False, reason=f"Budget exceeded: ${state.budget_used:.2f}/${config.monthly_budget_usd:.2f}", action="alert_and_fallback", current_usage=current_usage)

        budget_ratio = state.budget_used / config.monthly_budget_usd if config.monthly_budget_usd > 0 else 0
        if budget_ratio >= config.alert_threshold:
            await self._emit_alert(provider, "budget", budget_ratio, current_usage)
        return QuotaResult(allowed=True, action="proceed", current_usage=current_usage)

    async def record_usage(self, provider: str, model: str = "", prompt_tokens: int = 0, completion_tokens: int = 0) -> None:
        config = self._configs.get(provider)
        if not config:
            return
        state = self._get_state(provider)
        self._reset_windows_if_needed(state)
        total_tokens = prompt_tokens + completion_tokens
        state.tpm_used += total_tokens
        state.rpm_used += 1
        cost = (prompt_tokens / 1000 * config.cost_per_1k_input + completion_tokens / 1000 * config.cost_per_1k_output)
        state.budget_used += cost
        state.total_requests += 1
        state.total_tokens += total_tokens
        state.total_cost += cost

    def get_budget_status(self, provider: str) -> Dict[str, Any]:
        config = self._configs.get(provider)
        state = self._states.get(provider)
        if not config or not state:
            return {"provider": provider, "status": "unknown"}
        return {"provider": provider, "budget_used": round(state.budget_used, 4), "budget_limit": config.monthly_budget_usd, "budget_ratio": round(state.budget_used / config.monthly_budget_usd, 4) if config.monthly_budget_usd > 0 else 0, "tpm_used": state.tpm_used, "tpm_limit": config.tpm_limit, "rpm_used": state.rpm_used, "rpm_limit": config.rpm_limit, "total_requests": state.total_requests, "total_tokens": state.total_tokens, "total_cost": round(state.total_cost, 4)}

    def get_all_status(self) -> Dict[str, Dict[str, Any]]:
        return {provider: self.get_budget_status(provider) for provider in self._configs}

    def _get_state(self, provider: str) -> QuotaState:
        if provider not in self._states:
            self._states[provider] = QuotaState()
        return self._states[provider]

    def _reset_windows_if_needed(self, state: QuotaState) -> None:
        now = time.time()
        if now - state.tpm_window_start >= 60:
            state.tpm_used = 0
            state.tpm_window_start = now
        if now - state.rpm_window_start >= 60:
            state.rpm_used = 0
            state.rpm_window_start = now

    async def _emit_alert(self, provider: str, metric: str, ratio: float, current_usage: Dict[str, Any]) -> None:
        alert_data = {"provider": provider, "metric": metric, "ratio": round(ratio, 4), "threshold": self._configs[provider].alert_threshold, "current_usage": current_usage}
        logger.warning(f"Quota alert: {provider} {metric} at {ratio:.1%}")
        for callback in self._alert_callbacks:
            try:
                if asyncio.iscoroutinefunction(callback):
                    await callback(alert_data)
                else:
                    callback(alert_data)
            except Exception as e:
                logger.error(f"Alert callback error: {e}")

    def load_from_config(self, config_data: Dict[str, Any]) -> None:
        for provider, quota_config in config_data.items():
            if isinstance(quota_config, dict):
                self.register_provider(provider, QuotaConfig(
                    tpm_limit=quota_config.get("tpm_limit", 100000),
                    rpm_limit=quota_config.get("rpm_limit", 1000),
                    monthly_budget_usd=quota_config.get("monthly_budget_usd", 100.0),
                    alert_threshold=quota_config.get("alert_threshold", 0.8),
                    cost_per_1k_input=quota_config.get("cost_per_1k_input", 0.002),
                    cost_per_1k_output=quota_config.get("cost_per_1k_output", 0.006),
                ))
