"""P3-004 Provider 配额治理 — 多维度配额检查与 backup 模型自动切换。

本模块提供 Provider 级别的配额治理能力，作为可注入依赖供 LLMClient /
LLMRouter 使用，**不修改**现有 LLMClient 代码。

支持维度：
    - daily_token_limit：每日 Token 限额
    - daily_request_limit：每日请求次数限额
    - rpm_limit：每分钟请求次数限额（滑动窗口）
    - tpm_limit：每分钟 Token 限额（滑动窗口）
    - concurrent_limit：并发请求限额
    - cooldown_seconds：触发限流后的冷却时间

检查顺序：cooldown → daily → rpm → tpm → concurrent

Usage:
    from flowforge.core.provider_quota import (
        ProviderQuotaConfig, ProviderQuotaManager,
    )

    configs = {
        "openroute": ProviderQuotaConfig(
            provider="openroute",
            daily_token_limit=1_000_000,
            rpm_limit=60,
            backup_models=["doubao-pro", "glm-4"],
        ),
    }
    manager = ProviderQuotaManager(configs)

    result = await manager.check_quota("openroute", estimated_tokens=500)
    if not result.allowed:
        backup = await manager.get_backup_model("openroute")
        ...

    # 主调用失败时自动尝试 backup
    result = await manager.try_with_backup(
        "openroute",
        primary_call=llm_client.complete,
        messages=[...],
    )
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("provider_quota")


# ---------------------------------------------------------------------------
# 异常定义
# ---------------------------------------------------------------------------


class QuotaExceededError(Exception):
    """Provider 配额超限异常。

    当请求超出 daily/rpm/tpm/concurrent 任一限额时抛出。
    """

    def __init__(
        self,
        provider: str,
        reason: str,
        retry_after_seconds: int = 0,
    ) -> None:
        self.provider = provider
        self.reason = reason
        self.retry_after_seconds = retry_after_seconds
        super().__init__(
            f"Provider '{provider}' quota exceeded: {reason}"
            + (f" (retry after {retry_after_seconds}s)" if retry_after_seconds else "")
        )


class AllProvidersFailedError(Exception):
    """所有 Provider（含 backup 模型）均失败异常。

    当 try_with_backup 中主调用与所有 backup 模型都失败时抛出。
    """

    def __init__(self, provider: str, errors: list[str]) -> None:
        self.provider = provider
        self.errors = errors
        super().__init__(
            f"All providers failed for '{provider}': "
            + "; ".join(errors)
        )


class ProviderInCooldownError(Exception):
    """Provider 处于冷却中异常。

    当 check_quota 检测到 provider 处于 cooldown 状态时由调用方抛出。
    """

    def __init__(self, provider: str, retry_after_seconds: int) -> None:
        self.provider = provider
        self.retry_after_seconds = retry_after_seconds
        super().__init__(
            f"Provider '{provider}' is in cooldown, "
            f"retry after {retry_after_seconds}s"
        )


# ---------------------------------------------------------------------------
# Pydantic 模型
# ---------------------------------------------------------------------------


class ProviderQuotaConfig(BaseModel):
    """Provider 配额配置（Pydantic 模型）。

    所有限额字段默认为 0，0 表示不限制。
    """

    provider: str = Field(description="Provider 名称（openroute/doubao/openai/anthropic 等）")
    daily_token_limit: int = Field(default=0, description="每日 Token 限额（0 表示无限）")
    daily_request_limit: int = Field(default=0, description="每日请求次数限额（0 表示无限）")
    rpm_limit: int = Field(default=0, description="每分钟请求限额（Requests Per Minute，0 表示无限）")
    tpm_limit: int = Field(default=0, description="每分钟 Token 限额（Tokens Per Minute，0 表示无限）")
    concurrent_limit: int = Field(default=0, description="并发请求限额（0 表示无限）")
    enabled: bool = Field(default=True, description="是否启用配额治理")
    backup_models: list[str] = Field(default_factory=list, description="备用模型列表（按优先级排序）")
    cooldown_seconds: int = Field(default=60, description="触发限流后的冷却时间（秒）")
    metadata: dict[str, Any] = Field(default_factory=dict, description="扩展元数据")


class QuotaCheckResult(BaseModel):
    """配额检查结果。"""

    allowed: bool = Field(description="是否允许通过")
    reason: str = Field(default="", description="不允许时的原因说明")
    retry_after_seconds: int = Field(default=0, description="建议重试等待秒数")
    quota_used_ratio: float = Field(default=0.0, description="配额使用比例（0.0~1.0）")


# ---------------------------------------------------------------------------
# 数据类
# ---------------------------------------------------------------------------


@dataclass
class QuotaUsage:
    """Provider 使用量统计（dataclass）。

    跟踪当前 provider 的实时使用情况，含滑动窗口计数。
    """

    provider: str
    date: str  # YYYY-MM-DD 格式
    tokens_used: int = 0
    requests_used: int = 0
    concurrent_current: int = 0
    last_request_ts: float = 0.0
    rpm_window: list[float] = field(default_factory=list)
    tpm_window: list[tuple[float, int]] = field(default_factory=list)
    cooldown_until: float = 0.0

    def _is_in_cooldown(self) -> bool:
        """检查当前是否处于冷却期。

        Returns:
            True 表示仍在冷却中；False 表示冷却已结束或未触发。
        """
        if self.cooldown_until <= 0.0:
            return False
        return time.time() < self.cooldown_until

    def _clean_sliding_window(self, now: float) -> None:
        """清理滑动窗口中超过 60 秒的过期记录。

        Args:
            now: 当前时间戳。
        """
        cutoff = now - 60.0
        # RPM 窗口：保留近 60 秒内的时间戳
        self.rpm_window = [ts for ts in self.rpm_window if ts > cutoff]
        # TPM 窗口：保留近 60 秒内的 (ts, tokens) 元组
        self.tpm_window = [(ts, tokens) for ts, tokens in self.tpm_window if ts > cutoff]

    def reset_daily(self) -> None:
        """重置每日计数（tokens_used / requests_used），同时清空滑动窗口。

        冷却状态保持不变（由 mark_cooldown 单独管理）。
        """
        self.tokens_used = 0
        self.requests_used = 0
        self.rpm_window.clear()
        self.tpm_window.clear()
        # 注意：concurrent_current 和 cooldown_until 不在每日重置范围内


# ---------------------------------------------------------------------------
# ProviderQuotaManager
# ---------------------------------------------------------------------------


class ProviderQuotaManager:
    """Provider 配额治理管理器。

    负责多维度配额检查、使用量记录、冷却管理以及 backup 模型自动切换。

    依赖通过构造函数注入（铁律 12：禁止绕过 DI 容器直接实例化）：
        - configs: dict[str, ProviderQuotaConfig]
        - metrics_collector: 可选，支持 record_provider_quota / record_error 方法
    """

    def __init__(
        self,
        configs: dict[str, ProviderQuotaConfig],
        metrics_collector: Optional[Any] = None,
    ) -> None:
        self._configs: dict[str, ProviderQuotaConfig] = dict(configs)
        self._metrics_collector = metrics_collector
        self._usage: dict[str, QuotaUsage] = {}
        self._lock = asyncio.Lock()
        for provider in self._configs:
            self._usage[provider] = self._init_usage(provider)

    # -- 私有辅助 ----------------------------------------------------------

    def _init_usage(self, provider: str) -> QuotaUsage:
        """初始化指定 provider 的使用量记录。"""
        return QuotaUsage(
            provider=provider,
            date=datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        )

    def _get_usage(self, provider: str) -> Optional[QuotaUsage]:
        """获取指定 provider 的使用量记录，不存在则返回 None。"""
        return self._usage.get(provider)

    def _get_config(self, provider: str) -> Optional[ProviderQuotaConfig]:
        """获取指定 provider 的配额配置，不存在则返回 None。"""
        return self._configs.get(provider)

    def _ensure_same_day(self, usage: QuotaUsage) -> None:
        """若跨天则重置每日计数。"""
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        if usage.date != today:
            usage.reset_daily()
            usage.date = today

    def _record_metric(
        self,
        provider: str,
        event: str,
        **fields: Any,
    ) -> None:
        """向 metrics_collector 上报配额事件（如存在 record_provider_quota 方法）。

        duck-typing：兼容 MetricsCollector 或自定义采集器。
        """
        if self._metrics_collector is None:
            return
        try:
            record_fn = getattr(self._metrics_collector, "record_provider_quota", None)
            if callable(record_fn):
                record_fn(provider=provider, event=event, **fields)
                return
            # 兼容旧版 MetricsCollector：使用 record_error 记录拒绝事件
            if event in ("quota_exceeded", "provider_in_cooldown", "all_providers_failed"):
                record_error = getattr(self._metrics_collector, "record_error", None)
                if callable(record_error):
                    record_error(f"provider_quota:{provider}:{event}:{fields}")
        except Exception as e:  # noqa: BLE001
            logger.warning(f"metrics_collector record failed: {e}")

    def _compute_quota_ratio(
        self,
        usage: QuotaUsage,
        config: ProviderQuotaConfig,
    ) -> float:
        """计算配额使用比例（取所有已配置维度的最大使用比例）。"""
        ratios: list[float] = []
        if config.daily_token_limit > 0:
            ratios.append(usage.tokens_used / config.daily_token_limit)
        if config.daily_request_limit > 0:
            ratios.append(usage.requests_used / config.daily_request_limit)
        if config.concurrent_limit > 0:
            ratios.append(usage.concurrent_current / config.concurrent_limit)
        now = time.time()
        if config.rpm_limit > 0:
            cutoff = now - 60.0
            current_rpm = sum(1 for ts in usage.rpm_window if ts > cutoff)
            ratios.append(current_rpm / config.rpm_limit)
        if config.tpm_limit > 0:
            cutoff = now - 60.0
            current_tpm = sum(
                tokens for ts, tokens in usage.tpm_window if ts > cutoff
            )
            ratios.append(current_tpm / config.tpm_limit)
        return max(ratios) if ratios else 0.0

    # -- 公开 API ----------------------------------------------------------

    async def check_quota(
        self,
        provider: str,
        estimated_tokens: int = 0,
    ) -> QuotaCheckResult:
        """检查指定 provider 当前是否允许发起请求。

        检查顺序：cooldown → daily_token → daily_request → rpm → tpm → concurrent。
        任一检查未通过则立即返回不允许。

        Args:
            provider: Provider 名称。
            estimated_tokens: 本次请求预估消耗的 Token 数。

        Returns:
            QuotaCheckResult 描述是否允许及其原因。
        """
        async with self._lock:
            config = self._get_config(provider)
            if config is None:
                # 未配置的 provider 默认放行
                return QuotaCheckResult(allowed=True, reason="provider not configured")
            if not config.enabled:
                return QuotaCheckResult(
                    allowed=False,
                    reason=f"provider '{provider}' is disabled",
                )

            usage = self._get_usage(provider)
            if usage is None:
                usage = self._init_usage(provider)
                self._usage[provider] = usage

            self._ensure_same_day(usage)
            now = time.time()
            usage._clean_sliding_window(now)

            quota_ratio = self._compute_quota_ratio(usage, config)

            # 1. cooldown 检查
            if usage._is_in_cooldown():
                retry_after = max(0, int(usage.cooldown_until - now))
                logger.info(
                    f"Provider '{provider}' in cooldown, retry_after={retry_after}s"
                )
                self._record_metric(
                    provider, "provider_in_cooldown",
                    reason="cooldown", retry_after=retry_after,
                )
                return QuotaCheckResult(
                    allowed=False,
                    reason="provider is in cooldown",
                    retry_after_seconds=retry_after,
                    quota_used_ratio=quota_ratio,
                )

            # 2. daily_token_limit
            if config.daily_token_limit > 0:
                if usage.tokens_used + estimated_tokens > config.daily_token_limit:
                    self._record_metric(
                        provider, "quota_exceeded",
                        limit_type="daily_token",
                        used=usage.tokens_used,
                        limit=config.daily_token_limit,
                    )
                    return QuotaCheckResult(
                        allowed=False,
                        reason="daily_token_limit exceeded",
                        retry_after_seconds=86400 - int(now % 86400),
                        quota_used_ratio=quota_ratio,
                    )

            # 3. daily_request_limit
            if config.daily_request_limit > 0:
                if usage.requests_used + 1 > config.daily_request_limit:
                    self._record_metric(
                        provider, "quota_exceeded",
                        limit_type="daily_request",
                        used=usage.requests_used,
                        limit=config.daily_request_limit,
                    )
                    return QuotaCheckResult(
                        allowed=False,
                        reason="daily_request_limit exceeded",
                        retry_after_seconds=86400 - int(now % 86400),
                        quota_used_ratio=quota_ratio,
                    )

            # 4. rpm_limit
            if config.rpm_limit > 0:
                current_rpm = len(usage.rpm_window)
                if current_rpm + 1 > config.rpm_limit:
                    self._record_metric(
                        provider, "quota_exceeded",
                        limit_type="rpm",
                        used=current_rpm,
                        limit=config.rpm_limit,
                    )
                    return QuotaCheckResult(
                        allowed=False,
                        reason="rpm_limit exceeded",
                        retry_after_seconds=60,
                        quota_used_ratio=quota_ratio,
                    )

            # 5. tpm_limit
            if config.tpm_limit > 0:
                current_tpm = sum(t for _, t in usage.tpm_window)
                if current_tpm + estimated_tokens > config.tpm_limit:
                    self._record_metric(
                        provider, "quota_exceeded",
                        limit_type="tpm",
                        used=current_tpm,
                        limit=config.tpm_limit,
                    )
                    return QuotaCheckResult(
                        allowed=False,
                        reason="tpm_limit exceeded",
                        retry_after_seconds=60,
                        quota_used_ratio=quota_ratio,
                    )

            # 6. concurrent_limit
            if config.concurrent_limit > 0:
                if usage.concurrent_current + 1 > config.concurrent_limit:
                    self._record_metric(
                        provider, "quota_exceeded",
                        limit_type="concurrent",
                        used=usage.concurrent_current,
                        limit=config.concurrent_limit,
                    )
                    return QuotaCheckResult(
                        allowed=False,
                        reason="concurrent_limit exceeded",
                        retry_after_seconds=1,
                        quota_used_ratio=quota_ratio,
                    )

            return QuotaCheckResult(allowed=True, quota_used_ratio=quota_ratio)

    async def record_usage(
        self,
        provider: str,
        tokens_used: int,
        success: bool,
    ) -> None:
        """记录一次实际请求的使用量。

        Args:
            provider: Provider 名称。
            tokens_used: 本次请求实际消耗的 Token 数。
            success: 本次请求是否成功（失败也记录请求数，但若失败可能触发 cooldown）。
        """
        async with self._lock:
            usage = self._get_usage(provider)
            if usage is None:
                usage = self._init_usage(provider)
                self._usage[provider] = usage
            self._ensure_same_day(usage)

            now = time.time()
            usage.tokens_used += tokens_used
            usage.requests_used += 1
            usage.last_request_ts = now
            usage.rpm_window.append(now)
            usage.tpm_window.append((now, tokens_used))
            # concurrent_current 由调用方在调用前后自行增减
            # 这里只更新计数与滑动窗口

            self._record_metric(
                provider, "usage_recorded",
                tokens_used=tokens_used,
                success=success,
                cumulative_tokens=usage.tokens_used,
                cumulative_requests=usage.requests_used,
            )
            logger.debug(
                f"Provider '{provider}' usage recorded: "
                f"tokens={tokens_used}, success={success}, "
                f"cumulative_tokens={usage.tokens_used}, "
                f"cumulative_requests={usage.requests_used}"
            )

    async def mark_cooldown(self, provider: str, reason: str) -> None:
        """标记指定 provider 进入冷却期。

        Args:
            provider: Provider 名称。
            reason: 触发冷却的原因（例如 rate_limited / model_not_found）。
        """
        async with self._lock:
            config = self._get_config(provider)
            cooldown_seconds = config.cooldown_seconds if config else 60
            usage = self._get_usage(provider)
            if usage is None:
                usage = self._init_usage(provider)
                self._usage[provider] = usage

            usage.cooldown_until = time.time() + cooldown_seconds
            self._record_metric(
                provider, "cooldown_marked",
                reason=reason,
                cooldown_seconds=cooldown_seconds,
                cooldown_until=usage.cooldown_until,
            )
            logger.warning(
                f"Provider '{provider}' marked cooldown for {cooldown_seconds}s: {reason}"
            )

    async def get_backup_model(self, provider: str) -> Optional[str]:
        """获取指定 provider 的首选备用模型。

        按配置中 backup_models 列表顺序返回第一个。
        若配置不存在或 backup_models 为空则返回 None。

        Args:
            provider: Provider 名称。

        Returns:
            备用模型名，或 None。
        """
        config = self._get_config(provider)
        if config is None or not config.backup_models:
            return None
        return config.backup_models[0]

    async def try_with_backup(
        self,
        provider: str,
        primary_call: Callable,
        *args: Any,
        **kwargs: Any,
    ) -> Any:
        """主调用失败时自动尝试 backup 模型。

        调用流程：
            1. 调用 primary_call(provider, *args, **kwargs)；
            2. 若失败，按 backup_models 顺序依次尝试 primary_call(model, *args, **kwargs)；
            3. 全部失败则抛出 AllProvidersFailedError。

        注意：primary_call 的第一个位置参数会依次传入 provider 名与各 backup 模型名。
        调用方需确保 primary_call 能识别并路由这些参数。

        Args:
            provider: 主 Provider 名称。
            primary_call: 异步调用函数，签名形如 `async def fn(target, *args, **kwargs)`。
            *args: 透传给 primary_call 的位置参数。
            **kwargs: 透传给 primary_call 的关键字参数。

        Returns:
            主调用或 backup 调用成功时的返回值。

        Raises:
            AllProvidersFailedError: 当主调用与所有 backup 都失败时。
        """
        config = self._get_config(provider)
        backup_models: list[str] = list(config.backup_models) if config else []

        # 候选调用目标列表：provider 自身 + backup_models
        candidates: list[str] = [provider] + backup_models
        errors: list[str] = []

        for idx, target in enumerate(candidates):
            try:
                result = await primary_call(target, *args, **kwargs)
                if idx > 0:
                    logger.info(
                        f"Backup model '{target}' succeeded for provider '{provider}' "
                        f"after primary failed"
                    )
                self._record_metric(
                    provider, "call_succeeded",
                    target=target, attempt_index=idx,
                )
                return result
            except Exception as e:  # noqa: BLE001
                errors.append(f"{target}: {type(e).__name__}: {e}")
                logger.warning(
                    f"try_with_backup candidate '{target}' failed "
                    f"(provider={provider}, attempt={idx + 1}/{len(candidates)}): {e}"
                )
                # 主 provider 失败 → 标记冷却
                if idx == 0:
                    await self.mark_cooldown(provider, reason=f"primary_call_failed: {e}")

        self._record_metric(
            provider, "all_providers_failed",
            candidates=candidates, errors=errors,
        )
        raise AllProvidersFailedError(provider, errors)

    def get_usage_status(self, provider: str) -> dict:
        """获取指定 provider 的当前使用状态。

        Args:
            provider: Provider 名称。

        Returns:
            包含使用量与配置摘要的字典。若 provider 未配置返回空字典。
        """
        config = self._get_config(provider)
        if config is None:
            return {}
        usage = self._get_usage(provider)
        if usage is None:
            usage = self._init_usage(provider)
            self._usage[provider] = usage

        self._ensure_same_day(usage)
        now = time.time()
        usage._clean_sliding_window(now)

        return {
            "provider": provider,
            "enabled": config.enabled,
            "date": usage.date,
            "tokens_used": usage.tokens_used,
            "requests_used": usage.requests_used,
            "concurrent_current": usage.concurrent_current,
            "last_request_ts": usage.last_request_ts,
            "rpm_current": len(usage.rpm_window),
            "tpm_current": sum(t for _, t in usage.tpm_window),
            "in_cooldown": usage._is_in_cooldown(),
            "cooldown_until": usage.cooldown_until,
            "cooldown_remaining_seconds": max(
                0, int(usage.cooldown_until - now)
            ) if usage._is_in_cooldown() else 0,
            "backup_models": list(config.backup_models),
            "limits": {
                "daily_token_limit": config.daily_token_limit,
                "daily_request_limit": config.daily_request_limit,
                "rpm_limit": config.rpm_limit,
                "tpm_limit": config.tpm_limit,
                "concurrent_limit": config.concurrent_limit,
                "cooldown_seconds": config.cooldown_seconds,
            },
            "quota_used_ratio": self._compute_quota_ratio(usage, config),
        }

    def get_all_status(self) -> dict[str, dict]:
        """获取所有已配置 provider 的状态。"""
        return {
            provider: self.get_usage_status(provider)
            for provider in self._configs
        }

    async def reset_daily_quota(self) -> None:
        """每日配额重置（供 APScheduler 调用）。

        重置所有 provider 的 tokens_used / requests_used 与滑动窗口。
        注意：并发计数与冷却状态不在每日重置范围内。
        """
        async with self._lock:
            today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            for provider, usage in self._usage.items():
                usage.reset_daily()
                usage.date = today
                self._record_metric(provider, "daily_quota_reset", date=today)
            logger.info(f"Daily quota reset for {len(self._usage)} providers")

    # -- 并发计数辅助（供调用方在调用前后手动维护） --------------------------

    async def acquire_concurrent(self, provider: str) -> None:
        """占用一个并发槽位。

        由调用方在发起实际请求前调用。若超限应通过 check_quota 提前拦截。
        """
        async with self._lock:
            usage = self._get_usage(provider)
            if usage is None:
                usage = self._init_usage(provider)
                self._usage[provider] = usage
            usage.concurrent_current += 1

    async def release_concurrent(self, provider: str) -> None:
        """释放一个并发槽位。

        由调用方在请求结束后（无论成功失败）调用。
        """
        async with self._lock:
            usage = self._get_usage(provider)
            if usage is None:
                return
            if usage.concurrent_current > 0:
                usage.concurrent_current -= 1
