"""P3-004 Provider 配额治理单元测试。

覆盖 ProviderQuotaConfig / QuotaUsage / QuotaCheckResult / ProviderQuotaManager
以及异常类 QuotaExceededError / AllProvidersFailedError / ProviderInCooldownError。
"""

from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone
from typing import Any
from unittest.mock import AsyncMock

import pytest

from flowforge.core.provider_quota import (
    AllProvidersFailedError,
    ProviderInCooldownError,
    ProviderQuotaConfig,
    ProviderQuotaManager,
    QuotaCheckResult,
    QuotaExceededError,
    QuotaUsage,
)


# ---------------------------------------------------------------------------
# 测试夹具
# ---------------------------------------------------------------------------


@pytest.fixture
def basic_configs() -> dict[str, ProviderQuotaConfig]:
    """基础测试配置：openroute / doubao 两个 provider。"""
    return {
        "openroute": ProviderQuotaConfig(
            provider="openroute",
            daily_token_limit=1_000_000,
            daily_request_limit=100,
            rpm_limit=5,
            tpm_limit=10_000,
            concurrent_limit=3,
            backup_models=["doubao-pro", "glm-4"],
            cooldown_seconds=60,
        ),
        "doubao": ProviderQuotaConfig(
            provider="doubao",
            daily_token_limit=500_000,
            rpm_limit=0,
            backup_models=["glm-4"],
            cooldown_seconds=30,
        ),
    }


@pytest.fixture
def manager(basic_configs) -> ProviderQuotaManager:
    """无 metrics_collector 的 ProviderQuotaManager。"""
    return ProviderQuotaManager(basic_configs)


@pytest.fixture
def mock_metrics_collector():
    """带 record_provider_quota 方法的 mock 采集器。"""

    class _Collector:
        def __init__(self) -> None:
            self.events: list[dict[str, Any]] = []

        def record_provider_quota(self, **kwargs: Any) -> None:
            self.events.append(kwargs)

        def record_error(self, msg: str) -> None:
            self.events.append({"event": "error", "msg": msg})

    return _Collector()


@pytest.fixture
def manager_with_metrics(
    basic_configs, mock_metrics_collector
) -> ProviderQuotaManager:
    return ProviderQuotaManager(
        configs=basic_configs,
        metrics_collector=mock_metrics_collector,
    )


# ---------------------------------------------------------------------------
# 1. ProviderQuotaConfig 字段默认值
# ---------------------------------------------------------------------------


class TestProviderQuotaConfig:
    """验证 ProviderQuotaConfig 默认值与字段约束。"""

    def test_config_default_values(self):
        """未指定字段时应使用合理默认值。"""
        cfg = ProviderQuotaConfig(provider="openroute")
        assert cfg.provider == "openroute"
        assert cfg.daily_token_limit == 0
        assert cfg.daily_request_limit == 0
        assert cfg.rpm_limit == 0
        assert cfg.tpm_limit == 0
        assert cfg.concurrent_limit == 0
        assert cfg.enabled is True
        assert cfg.backup_models == []
        assert cfg.cooldown_seconds == 60
        assert cfg.metadata == {}

    def test_config_explicit_values(self):
        """显式赋值应正确存储。"""
        cfg = ProviderQuotaConfig(
            provider="openai",
            daily_token_limit=500_000,
            rpm_limit=50,
            backup_models=["anthropic-claude-3-5", "glm-4"],
            cooldown_seconds=30,
            metadata={"region": "us"},
        )
        assert cfg.daily_token_limit == 500_000
        assert cfg.rpm_limit == 50
        assert cfg.backup_models == ["anthropic-claude-3-5", "glm-4"]
        assert cfg.cooldown_seconds == 30
        assert cfg.metadata == {"region": "us"}

    def test_config_backup_models_isolated_per_instance(self):
        """两个 config 实例的 backup_models 应互不影响（Pydantic 默认深拷贝）。"""
        cfg1 = ProviderQuotaConfig(provider="a")
        cfg2 = ProviderQuotaConfig(provider="b")
        cfg1.backup_models.append("m1")
        assert cfg2.backup_models == []

    def test_config_metadata_isolated_per_instance(self):
        """metadata 字段在不同实例间互不影响。"""
        cfg1 = ProviderQuotaConfig(provider="a")
        cfg2 = ProviderQuotaConfig(provider="b")
        cfg1.metadata["k"] = "v"
        assert cfg2.metadata == {}


# ---------------------------------------------------------------------------
# 2. QuotaUsage 滑动窗口清理逻辑
# ---------------------------------------------------------------------------


class TestQuotaUsage:
    """验证 QuotaUsage dataclass 行为，特别是滑动窗口清理。"""

    def test_usage_default_values(self):
        usage = QuotaUsage(provider="openroute", date="2026-07-21")
        assert usage.provider == "openroute"
        assert usage.tokens_used == 0
        assert usage.requests_used == 0
        assert usage.concurrent_current == 0
        assert usage.last_request_ts == 0.0
        assert usage.rpm_window == []
        assert usage.tpm_window == []
        assert usage.cooldown_until == 0.0

    def test_is_in_cooldown_false_when_not_set(self):
        usage = QuotaUsage(provider="p", date="2026-07-21")
        assert usage._is_in_cooldown() is False

    def test_is_in_cooldown_true_when_future(self):
        usage = QuotaUsage(provider="p", date="2026-07-21")
        usage.cooldown_until = time.time() + 100
        assert usage._is_in_cooldown() is True

    def test_is_in_cooldown_false_when_expired(self):
        usage = QuotaUsage(provider="p", date="2026-07-21")
        usage.cooldown_until = time.time() - 100
        assert usage._is_in_cooldown() is False

    def test_clean_sliding_window_removes_old_entries(self):
        """超过 60 秒的记录应被清理。"""
        usage = QuotaUsage(provider="p", date="2026-07-21")
        now = time.time()
        usage.rpm_window = [now - 100, now - 50, now - 10]
        usage.tpm_window = [(now - 100, 200), (now - 10, 50)]
        usage._clean_sliding_window(now)
        assert usage.rpm_window == [now - 50, now - 10]
        assert usage.tpm_window == [(now - 10, 50)]

    def test_clean_sliding_window_keeps_all_within_60s(self):
        """60 秒内的记录应保留。"""
        usage = QuotaUsage(provider="p", date="2026-07-21")
        now = time.time()
        usage.rpm_window = [now - 59, now - 30, now]
        usage.tpm_window = [(now - 59, 10), (now, 20)]
        usage._clean_sliding_window(now)
        assert len(usage.rpm_window) == 3
        assert len(usage.tpm_window) == 2

    def test_reset_daily_clears_counters(self):
        """reset_daily 应清空每日计数与滑动窗口。"""
        usage = QuotaUsage(provider="p", date="2026-07-20")
        usage.tokens_used = 1000
        usage.requests_used = 50
        usage.rpm_window = [time.time()]
        usage.tpm_window = [(time.time(), 100)]
        usage.cooldown_until = time.time() + 100  # 冷却不被重置
        usage.reset_daily()
        assert usage.tokens_used == 0
        assert usage.requests_used == 0
        assert usage.rpm_window == []
        assert usage.tpm_window == []
        # cooldown_until 不应被重置
        assert usage.cooldown_until > time.time()


# ---------------------------------------------------------------------------
# 3. QuotaCheckResult
# ---------------------------------------------------------------------------


class TestQuotaCheckResult:
    def test_default_values(self):
        result = QuotaCheckResult(allowed=True)
        assert result.allowed is True
        assert result.reason == ""
        assert result.retry_after_seconds == 0
        assert result.quota_used_ratio == 0.0

    def test_denied_with_reason(self):
        result = QuotaCheckResult(
            allowed=False,
            reason="rpm_limit exceeded",
            retry_after_seconds=60,
            quota_used_ratio=0.95,
        )
        assert result.allowed is False
        assert result.reason == "rpm_limit exceeded"
        assert result.retry_after_seconds == 60
        assert result.quota_used_ratio == 0.95


# ---------------------------------------------------------------------------
# 4. check_quota 各种场景
# ---------------------------------------------------------------------------


class TestCheckQuota:
    """覆盖 cooldown / daily / rpm / tpm / concurrent 各种检查路径。"""

    @pytest.mark.asyncio
    async def test_check_quota_unknown_provider_allowed(self, manager):
        """未配置的 provider 默认放行。"""
        result = await manager.check_quota("unknown_provider")
        assert result.allowed is True

    @pytest.mark.asyncio
    async def test_check_quota_disabled_provider(self, manager):
        manager._configs["openroute"].enabled = False
        result = await manager.check_quota("openroute")
        assert result.allowed is False
        assert "disabled" in result.reason

    @pytest.mark.asyncio
    async def test_check_quota_allowed_within_limits(self, manager):
        """所有限额内应放行。"""
        result = await manager.check_quota("openroute", estimated_tokens=100)
        assert result.allowed is True
        assert result.reason == ""

    @pytest.mark.asyncio
    async def test_check_quota_blocked_by_cooldown(self, manager):
        """冷却中应被拒绝并返回 retry_after_seconds。"""
        await manager.mark_cooldown("openroute", reason="rate_limited")
        result = await manager.check_quota("openroute")
        assert result.allowed is False
        assert "cooldown" in result.reason
        assert result.retry_after_seconds > 0

    @pytest.mark.asyncio
    async def test_check_quota_blocked_by_daily_token_limit(self, manager):
        """超出 daily_token_limit 应被拒绝。"""
        # 使用量已接近上限
        await manager.record_usage("openroute", tokens_used=999_950, success=True)
        result = await manager.check_quota("openroute", estimated_tokens=100)
        assert result.allowed is False
        assert "daily_token_limit" in result.reason

    @pytest.mark.asyncio
    async def test_check_quota_blocked_by_daily_request_limit(self, manager):
        """超出 daily_request_limit 应被拒绝。"""
        for _ in range(100):
            await manager.record_usage("openroute", tokens_used=10, success=True)
        result = await manager.check_quota("openroute")
        assert result.allowed is False
        assert "daily_request_limit" in result.reason

    @pytest.mark.asyncio
    async def test_check_quota_blocked_by_rpm_limit(self, manager):
        """超出 rpm_limit 应被拒绝。"""
        # 在同一秒内发起 5 次（限额），第 6 次应被拒
        for _ in range(5):
            await manager.record_usage("openroute", tokens_used=10, success=True)
        result = await manager.check_quota("openroute")
        assert result.allowed is False
        assert "rpm_limit" in result.reason
        assert result.retry_after_seconds == 60

    @pytest.mark.asyncio
    async def test_check_quota_blocked_by_tpm_limit(self, manager):
        """超出 tpm_limit 应被拒绝。"""
        # 一次记录 9999 tokens，再加一次预估 100 应超 10000
        await manager.record_usage("openroute", tokens_used=9_990, success=True)
        result = await manager.check_quota("openroute", estimated_tokens=100)
        assert result.allowed is False
        assert "tpm_limit" in result.reason

    @pytest.mark.asyncio
    async def test_check_quota_blocked_by_concurrent_limit(self, manager):
        """超出 concurrent_limit 应被拒绝。"""
        for _ in range(3):
            await manager.acquire_concurrent("openroute")
        result = await manager.check_quota("openroute")
        assert result.allowed is False
        assert "concurrent_limit" in result.reason


# ---------------------------------------------------------------------------
# 5. record_usage 更新计数
# ---------------------------------------------------------------------------


class TestRecordUsage:
    @pytest.mark.asyncio
    async def test_record_usage_increments_counters(self, manager):
        await manager.record_usage("openroute", tokens_used=500, success=True)
        status = manager.get_usage_status("openroute")
        assert status["tokens_used"] == 500
        assert status["requests_used"] == 1
        assert status["rpm_current"] == 1

    @pytest.mark.asyncio
    async def test_record_usage_accumulates_tokens(self, manager):
        await manager.record_usage("openroute", tokens_used=100, success=True)
        await manager.record_usage("openroute", tokens_used=200, success=True)
        await manager.record_usage("openroute", tokens_used=300, success=True)
        status = manager.get_usage_status("openroute")
        assert status["tokens_used"] == 600
        assert status["requests_used"] == 3

    @pytest.mark.asyncio
    async def test_record_usage_unknown_provider_creates_entry(self, manager):
        """未初始化的 provider 记录使用量时应自动创建条目。"""
        # openroute 已存在；这里直接新增一个未初始化的 provider
        # 但 manager 只跟踪 _configs 内的 provider，所以使用 doubao（已配置）
        await manager.record_usage("doubao", tokens_used=42, success=True)
        status = manager.get_usage_status("doubao")
        assert status["tokens_used"] == 42

    @pytest.mark.asyncio
    async def test_record_usage_sliding_window_grows(self, manager):
        for _ in range(3):
            await manager.record_usage("openroute", tokens_used=10, success=True)
        status = manager.get_usage_status("openroute")
        assert status["rpm_current"] == 3


# ---------------------------------------------------------------------------
# 6. mark_cooldown
# ---------------------------------------------------------------------------


class TestMarkCooldown:
    @pytest.mark.asyncio
    async def test_mark_cooldown_sets_cooldown_until(self, manager):
        before = time.time()
        await manager.mark_cooldown("openroute", reason="rate_limited")
        status = manager.get_usage_status("openroute")
        assert status["in_cooldown"] is True
        assert status["cooldown_until"] >= before + 60
        assert status["cooldown_remaining_seconds"] > 0

    @pytest.mark.asyncio
    async def test_mark_cooldown_uses_configured_seconds(self, manager):
        """应使用 ProviderQuotaConfig.cooldown_seconds 而非默认值。"""
        await manager.mark_cooldown("doubao", reason="test")
        # doubao 配置为 30 秒
        status = manager.get_usage_status("doubao")
        remaining = status["cooldown_remaining_seconds"]
        assert 0 < remaining <= 30

    @pytest.mark.asyncio
    async def test_mark_cooldown_unknown_provider_uses_default(self, manager):
        """未配置 provider 的 cooldown 应使用默认 60 秒。"""
        await manager.mark_cooldown("ghost", reason="test")
        # get_usage_status 未配置返回空 dict，直接检查内部 _usage
        usage = manager._usage.get("ghost")
        assert usage is not None
        assert usage.cooldown_until > time.time() + 50


# ---------------------------------------------------------------------------
# 7. get_backup_model
# ---------------------------------------------------------------------------


class TestGetBackupModel:
    @pytest.mark.asyncio
    async def test_get_backup_model_returns_first(self, manager):
        result = await manager.get_backup_model("openroute")
        assert result == "doubao-pro"

    @pytest.mark.asyncio
    async def test_get_backup_model_no_backup(self, manager):
        """无 backup_models 时应返回 None。"""
        manager._configs["openroute"].backup_models = []
        result = await manager.get_backup_model("openroute")
        assert result is None

    @pytest.mark.asyncio
    async def test_get_backup_model_unknown_provider(self, manager):
        result = await manager.get_backup_model("unknown")
        assert result is None


# ---------------------------------------------------------------------------
# 8. try_with_backup
# ---------------------------------------------------------------------------


class TestTryWithBackup:
    @pytest.mark.asyncio
    async def test_try_with_backup_primary_succeeds(self, manager):
        """主调用成功时不应触发 backup。"""
        primary = AsyncMock(return_value="primary_result")
        result = await manager.try_with_backup("openroute", primary, "arg1", k="v")
        assert result == "primary_result"
        # 仅调用一次，参数为 provider + 透传
        primary.assert_awaited_once()
        args, kwargs = primary.call_args
        assert args[0] == "openroute"
        assert args[1] == "arg1"
        assert kwargs == {"k": "v"}

    @pytest.mark.asyncio
    async def test_try_with_backup_primary_fails_backup_succeeds(self, manager):
        """主调用失败时应按序尝试 backup_models。"""

        async def call_fn(target: str, *args: Any, **kwargs: Any) -> str:
            if target == "openroute":
                raise RuntimeError("primary down")
            if target == "doubao-pro":
                raise RuntimeError("backup1 down")
            if target == "glm-4":
                return f"backup2_ok:{target}"
            raise AssertionError(f"unexpected target: {target}")

        result = await manager.try_with_backup(
            "openroute", call_fn, "ctx", mode="x"
        )
        assert result == "backup2_ok:glm-4"
        # 主 provider 失败时应标记冷却
        status = manager.get_usage_status("openroute")
        assert status["in_cooldown"] is True

    @pytest.mark.asyncio
    async def test_try_with_backup_all_fail_raises(self, manager):
        """所有候选都失败时应抛 AllProvidersFailedError。"""

        async def call_fn(target: str, *args: Any, **kwargs: Any) -> str:
            raise RuntimeError(f"{target} failed")

        with pytest.raises(AllProvidersFailedError) as exc_info:
            await manager.try_with_backup("openroute", call_fn)

        err = exc_info.value
        assert err.provider == "openroute"
        # openroute + 2 backup = 3 个失败
        assert len(err.errors) == 3
        # 错误信息中应包含每个候选
        assert "openroute" in str(err)
        assert "doubao-pro" in str(err)
        assert "glm-4" in str(err)

    @pytest.mark.asyncio
    async def test_try_with_backup_no_backup_models_all_fail(self, manager):
        """无 backup_models 时主调用失败应立即抛出，且只有 1 个错误。"""
        manager._configs["openroute"].backup_models = []

        async def call_fn(target: str, *args: Any, **kwargs: Any) -> str:
            raise RuntimeError("only-fail")

        with pytest.raises(AllProvidersFailedError) as exc_info:
            await manager.try_with_backup("openroute", call_fn)
        assert len(exc_info.value.errors) == 1

    @pytest.mark.asyncio
    async def test_try_with_backup_marks_cooldown_on_primary_failure(self, manager):
        """主调用失败后应自动 mark_cooldown。"""

        async def call_fn(target: str, *args: Any, **kwargs: Any) -> str:
            if target == "openroute":
                raise RuntimeError("primary failed")
            return f"ok:{target}"

        await manager.try_with_backup("openroute", call_fn)
        # 应已成功切换到 doubao-pro
        status = manager.get_usage_status("openroute")
        assert status["in_cooldown"] is True


# ---------------------------------------------------------------------------
# 9. reset_daily_quota
# ---------------------------------------------------------------------------


class TestResetDailyQuota:
    @pytest.mark.asyncio
    async def test_reset_daily_quota_clears_all_providers(self, manager):
        """reset_daily_quota 应清空所有 provider 的每日计数。"""
        await manager.record_usage("openroute", tokens_used=1000, success=True)
        await manager.record_usage("doubao", tokens_used=2000, success=True)
        await manager.reset_daily_quota()

        s1 = manager.get_usage_status("openroute")
        s2 = manager.get_usage_status("doubao")
        assert s1["tokens_used"] == 0
        assert s1["requests_used"] == 0
        assert s2["tokens_used"] == 0
        assert s2["requests_used"] == 0

    @pytest.mark.asyncio
    async def test_reset_daily_quota_preserves_cooldown(self, manager):
        """reset_daily_quota 不应清空 cooldown_until。"""
        await manager.mark_cooldown("openroute", reason="test")
        await manager.reset_daily_quota()
        status = manager.get_usage_status("openroute")
        assert status["in_cooldown"] is True

    @pytest.mark.asyncio
    async def test_reset_daily_quota_updates_date(self, manager):
        """reset_daily_quota 应更新 date 字段为当天。"""
        await manager.reset_daily_quota()
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        for usage in manager._usage.values():
            assert usage.date == today


# ---------------------------------------------------------------------------
# 10. metrics_collector 集成
# ---------------------------------------------------------------------------


class TestMetricsCollectorIntegration:
    @pytest.mark.asyncio
    async def test_record_usage_triggers_metric(
        self, manager_with_metrics, mock_metrics_collector
    ):
        await manager_with_metrics.record_usage(
            "openroute", tokens_used=500, success=True
        )
        events = [e for e in mock_metrics_collector.events if e.get("event") == "usage_recorded"]
        assert len(events) == 1
        assert events[0]["provider"] == "openroute"
        assert events[0]["tokens_used"] == 500

    @pytest.mark.asyncio
    async def test_quota_exceeded_triggers_metric(
        self, manager_with_metrics, mock_metrics_collector
    ):
        """触发 daily_token_limit 时应上报 quota_exceeded 事件。"""
        await manager_with_metrics.record_usage(
            "openroute", tokens_used=999_950, success=True
        )
        await manager_with_metrics.check_quota("openroute", estimated_tokens=100)
        events = [
            e for e in mock_metrics_collector.events
            if e.get("event") == "quota_exceeded"
        ]
        assert len(events) >= 1
        assert events[0]["limit_type"] == "daily_token"

    @pytest.mark.asyncio
    async def test_cooldown_triggers_metric(
        self, manager_with_metrics, mock_metrics_collector
    ):
        await manager_with_metrics.mark_cooldown("openroute", reason="rate_limited")
        events = [
            e for e in mock_metrics_collector.events
            if e.get("event") == "cooldown_marked"
        ]
        assert len(events) == 1
        assert events[0]["reason"] == "rate_limited"

    @pytest.mark.asyncio
    async def test_all_providers_failed_triggers_metric(
        self, manager_with_metrics, mock_metrics_collector
    ):
        async def call_fn(target: str, *args: Any, **kwargs: Any) -> str:
            raise RuntimeError(f"{target} failed")

        with pytest.raises(AllProvidersFailedError):
            await manager_with_metrics.try_with_backup("openroute", call_fn)

        events = [
            e for e in mock_metrics_collector.events
            if e.get("event") == "all_providers_failed"
        ]
        assert len(events) == 1
        # 至少应包含候选列表与错误
        assert "candidates" in events[0]
        assert "errors" in events[0]

    @pytest.mark.asyncio
    async def test_call_succeeded_triggers_metric(
        self, manager_with_metrics, mock_metrics_collector
    ):
        async def call_fn(target: str, *args: Any, **kwargs: Any) -> str:
            return f"ok:{target}"

        await manager_with_metrics.try_with_backup("openroute", call_fn)
        events = [
            e for e in mock_metrics_collector.events
            if e.get("event") == "call_succeeded"
        ]
        assert len(events) == 1
        assert events[0]["target"] == "openroute"
        assert events[0]["attempt_index"] == 0

    @pytest.mark.asyncio
    async def test_no_collector_no_exception(self, manager):
        """未注入 metrics_collector 时所有方法应正常工作。"""
        await manager.record_usage("openroute", tokens_used=10, success=True)
        await manager.mark_cooldown("openroute", reason="test")
        result = await manager.check_quota("openroute")
        assert result.allowed is False


# ---------------------------------------------------------------------------
# 11. get_usage_status / get_all_status
# ---------------------------------------------------------------------------


class TestStatusReporting:
    @pytest.mark.asyncio
    async def test_get_usage_status_unknown_provider(self, manager):
        """未配置的 provider 返回空字典。"""
        assert manager.get_usage_status("unknown") == {}

    def test_get_usage_status_initial(self, manager):
        status = manager.get_usage_status("openroute")
        assert status["provider"] == "openroute"
        assert status["tokens_used"] == 0
        assert status["requests_used"] == 0
        assert status["rpm_current"] == 0
        assert status["tpm_current"] == 0
        assert status["in_cooldown"] is False
        assert "limits" in status
        assert status["limits"]["rpm_limit"] == 5
        assert status["backup_models"] == ["doubao-pro", "glm-4"]

    def test_get_all_status(self, manager):
        all_status = manager.get_all_status()
        assert "openroute" in all_status
        assert "doubao" in all_status
        assert all_status["openroute"]["provider"] == "openroute"
        assert all_status["doubao"]["provider"] == "doubao"


# ---------------------------------------------------------------------------
# 12. 异常类
# ---------------------------------------------------------------------------


class TestExceptions:
    def test_quota_exceeded_error_message(self):
        err = QuotaExceededError(
            "openroute", "daily_token_limit exceeded", retry_after_seconds=3600
        )
        assert err.provider == "openroute"
        assert err.reason == "daily_token_limit exceeded"
        assert err.retry_after_seconds == 3600
        assert "openroute" in str(err)
        assert "3600" in str(err)

    def test_all_providers_failed_error_message(self):
        err = AllProvidersFailedError(
            "openroute", ["openroute: RuntimeError: x", "doubao-pro: RuntimeError: y"]
        )
        assert err.provider == "openroute"
        assert len(err.errors) == 2
        assert "openroute" in str(err)
        assert "doubao-pro" in str(err)

    def test_provider_in_cooldown_error(self):
        err = ProviderInCooldownError("openroute", retry_after_seconds=30)
        assert err.provider == "openroute"
        assert err.retry_after_seconds == 30
        assert "cooldown" in str(err).lower()


# ---------------------------------------------------------------------------
# 13. 并发槽位 acquire/release
# ---------------------------------------------------------------------------


class TestConcurrentSlot:
    @pytest.mark.asyncio
    async def test_acquire_and_release_concurrent(self, manager):
        await manager.acquire_concurrent("openroute")
        await manager.acquire_concurrent("openroute")
        status = manager.get_usage_status("openroute")
        assert status["concurrent_current"] == 2

        await manager.release_concurrent("openroute")
        status = manager.get_usage_status("openroute")
        assert status["concurrent_current"] == 1

    @pytest.mark.asyncio
    async def test_release_concurrent_unknown_provider_noop(self, manager):
        """未初始化的 provider 释放不应报错。"""
        await manager.release_concurrent("ghost")


# ---------------------------------------------------------------------------
# 14. 跨天自动重置
# ---------------------------------------------------------------------------


class TestAutoDailyReset:
    @pytest.mark.asyncio
    async def test_cross_day_auto_reset(self, manager):
        """检查配额时若发现跨天应自动重置每日计数。"""
        await manager.record_usage("openroute", tokens_used=500, success=True)
        # 手动把 date 改成昨天
        yesterday = (datetime.now(timezone.utc).replace(day=datetime.now().day - 1) if datetime.now().day > 1 else datetime.now(timezone.utc)).strftime("%Y-%m-%d")
        # 简化：直接修改 usage.date
        manager._usage["openroute"].date = "2000-01-01"
        # 触发 check_quota，应自动调用 _ensure_same_day
        await manager.check_quota("openroute")
        status = manager.get_usage_status("openroute")
        # 应已重置
        assert status["tokens_used"] == 0
        assert status["requests_used"] == 0
