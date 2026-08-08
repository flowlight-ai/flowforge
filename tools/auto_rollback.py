"""自动回滚管理器 — 基于指标阈值自动触发回滚。

监控错误率、P99延迟等指标，超过阈值时自动回滚到稳定版本。
支持多种回滚触发条件和可配置的观测窗口。
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("auto_rollback")


class RollbackTrigger(str, Enum):
    """回滚触发原因。"""
    ERROR_RATE = "error_rate"
    LATENCY = "latency"
    MANUAL = "manual"
    HEALTH_CHECK = "health_check"
    CIRCUIT_BREAKER = "circuit_breaker"


class RollbackPolicy(BaseModel):
    """回滚策略配置。"""
    max_error_rate: float = Field(default=0.01, description="最大允许错误率")
    max_latency_multiplier: float = Field(default=2.0, description="最大延迟倍率")
    observation_window_seconds: int = Field(default=300, description="观测窗口（秒）")
    auto_rollback_enabled: bool = Field(default=True, description="是否启用自动回滚")
    min_samples: int = Field(default=100, description="最小样本数，低于此数不触发回滚")


class RollbackRecord(BaseModel):
    """回滚记录。"""
    task_id: str
    trigger: RollbackTrigger
    reason: str
    metrics_snapshot: dict = Field(default_factory=dict)
    rollback_version: str = ""
    rolled_back_at: str | None = None


class AutoRollbackManager:
    """自动回滚管理。

    根据实时指标判断是否需要回滚，支持多种触发条件。
    """

    def __init__(self, policy: RollbackPolicy | None = None) -> None:
        self.policy = policy or RollbackPolicy()
        self._history: list[RollbackRecord] = []

    def should_rollback(self, metrics: dict) -> tuple[bool, str, RollbackTrigger | None]:
        """判断是否需要回滚。

        Args:
            metrics: 包含 error_rate, p99_latency, baseline_p99, sample_count 等字段

        Returns:
            (should_rollback, reason, trigger)
        """
        if not self.policy.auto_rollback_enabled:
            return False, "", None

        # 样本数不足时不触发
        sample_count = metrics.get("sample_count", 0)
        if sample_count < self.policy.min_samples:
            return False, "", None

        # 错误率检查
        error_rate = metrics.get("error_rate", 0)
        if error_rate > self.policy.max_error_rate:
            reason = (
                f"Error rate {error_rate:.4f} exceeds threshold "
                f"{self.policy.max_error_rate}"
            )
            logger.warning(f"[rollback] {reason}")
            return True, reason, RollbackTrigger.ERROR_RATE

        # P99延迟检查
        p99_latency = metrics.get("p99_latency", 0)
        baseline_p99 = metrics.get("baseline_p99", 1)
        if baseline_p99 > 0 and p99_latency > baseline_p99 * self.policy.max_latency_multiplier:
            reason = (
                f"P99 latency {p99_latency:.1f}ms exceeds "
                f"{self.policy.max_latency_multiplier}x baseline ({baseline_p99:.1f}ms)"
            )
            logger.warning(f"[rollback] {reason}")
            return True, reason, RollbackTrigger.LATENCY

        return False, "", None

    def record_rollback(
        self,
        task_id: str,
        trigger: RollbackTrigger,
        reason: str,
        metrics_snapshot: dict | None = None,
        rollback_version: str = "",
    ) -> RollbackRecord:
        """记录回滚事件。"""
        record = RollbackRecord(
            task_id=task_id,
            trigger=trigger,
            reason=reason,
            metrics_snapshot=metrics_snapshot or {},
            rollback_version=rollback_version,
        )
        self._history.append(record)
        logger.info(
            f"[rollback] recorded: task={task_id}, trigger={trigger.value}, "
            f"reason={reason}"
        )
        return record

    def get_history(self, task_id: str | None = None) -> list[RollbackRecord]:
        """获取回滚历史。"""
        if task_id:
            return [r for r in self._history if r.task_id == task_id]
        return list(self._history)

    def check_and_rollback(
        self,
        task_id: str,
        metrics: dict,
        rollback_version: str = "",
    ) -> RollbackRecord | None:
        """检查指标并在需要时执行回滚。

        Returns:
            如果触发了回滚，返回 RollbackRecord；否则返回 None。
        """
        should, reason, trigger = self.should_rollback(metrics)
        if should and trigger:
            return self.record_rollback(
                task_id=task_id,
                trigger=trigger,
                reason=reason,
                metrics_snapshot=metrics,
                rollback_version=rollback_version,
            )
        return None
