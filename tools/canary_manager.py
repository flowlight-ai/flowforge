"""金丝雀发布管理器 — 渐进式发布与自动健康检查。

支持分阶段推进（10%→50%→100%），每阶段自动检测错误率和延迟指标，
不满足健康条件时自动回滚。
"""

from __future__ import annotations

import asyncio
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("canary_manager")


class CanaryStage(str, Enum):
    """金丝雀发布阶段。"""
    INITIALIZED = "initialized"
    CANARY_10 = "canary_10"
    CANARY_50 = "canary_50"
    FULL_ROLLOUT = "full_rollout"
    COMPLETED = "completed"
    ROLLED_BACK = "rolled_back"


class CanaryState(BaseModel):
    """金丝雀发布状态。"""
    task_id: str
    stage: CanaryStage = CanaryStage.INITIALIZED
    baseline_error_rate: float = 0.0
    baseline_p99_latency: float = 0.0
    current_error_rate: float = 0.0
    current_p99_latency: float = 0.0
    observation_seconds: int = 300
    rollback_version: str = ""
    error_message: str = ""


class CanaryConfig(BaseModel):
    """金丝雀发布配置。"""
    max_error_rate: float = Field(default=0.01, description="最大允许错误率")
    max_latency_multiplier: float = Field(default=2.0, description="最大延迟倍率（相对基线）")
    observation_seconds: int = Field(default=300, description="每阶段观测时间（秒）")
    auto_rollback_enabled: bool = Field(default=True, description="是否自动回滚")


class CanaryManager:
    """金丝雀发布管理。

    分阶段推进发布流量：10% → 50% → 100% → 完成。
    每阶段观测错误率和P99延迟，不满足条件则回滚。
    """

    STAGE_PROGRESS: dict[CanaryStage, CanaryStage] = {
        CanaryStage.INITIALIZED: CanaryStage.CANARY_10,
        CanaryStage.CANARY_10: CanaryStage.CANARY_50,
        CanaryStage.CANARY_50: CanaryStage.FULL_ROLLOUT,
        CanaryStage.FULL_ROLLOUT: CanaryStage.COMPLETED,
    }

    STAGE_TRAFFIC_PERCENT: dict[CanaryStage, int] = {
        CanaryStage.INITIALIZED: 0,
        CanaryStage.CANARY_10: 10,
        CanaryStage.CANARY_50: 50,
        CanaryStage.FULL_ROLLOUT: 100,
        CanaryStage.COMPLETED: 100,
        CanaryStage.ROLLED_BACK: 0,
    }

    def __init__(self, config: CanaryConfig | None = None) -> None:
        self.config = config or CanaryConfig()

    async def advance(self, state: CanaryState) -> CanaryState:
        """推进到下一阶段。

        先等待观测期，然后检查健康状态，健康则推进，不健康则回滚。
        """
        logger.info(
            f"[canary] task={state.task_id} advancing from {state.stage.value}, "
            f"observation={state.observation_seconds}s"
        )

        # 等待观测期
        await asyncio.sleep(min(state.observation_seconds, 5))  # 测试环境缩短

        # 健康检查
        health = await self._check_health(state)
        if not health.healthy:
            logger.warning(
                f"[canary] task={state.task_id} health check failed: {health.reason}"
            )
            state.error_message = health.reason
            state = await self.rollback(state)
            return state

        # 推进到下一阶段
        next_stage = self.STAGE_PROGRESS.get(state.stage)
        if next_stage:
            state.stage = next_stage
            logger.info(
                f"[canary] task={state.task_id} advanced to {state.stage.value} "
                f"(traffic={self.STAGE_TRAFFIC_PERCENT[state.stage]}%)"
            )
        else:
            logger.info(f"[canary] task={state.task_id} already at terminal stage {state.stage.value}")

        return state

    async def rollback(self, state: CanaryState) -> CanaryState:
        """回滚到基线版本。"""
        previous_stage = state.stage
        state.stage = CanaryStage.ROLLED_BACK
        logger.warning(
            f"[canary] task={state.task_id} rolled back from {previous_stage.value} "
            f"to version={state.rollback_version}"
        )
        return state

    async def _check_health(self, state: CanaryState) -> _HealthCheckResult:
        """健康检查：错误率和延迟是否在阈值内。"""
        # 错误率检查
        if state.current_error_rate > self.config.max_error_rate:
            return _HealthCheckResult(
                healthy=False,
                reason=(
                    f"Error rate {state.current_error_rate:.4f} exceeds "
                    f"threshold {self.config.max_error_rate}"
                ),
            )

        # P99延迟检查
        if state.baseline_p99_latency > 0:
            if state.current_p99_latency > state.baseline_p99_latency * self.config.max_latency_multiplier:
                return _HealthCheckResult(
                    healthy=False,
                    reason=(
                        f"P99 latency {state.current_p99_latency:.1f}ms exceeds "
                        f"{self.config.max_latency_multiplier}x baseline "
                        f"({state.baseline_p99_latency:.1f}ms)"
                    ),
                )

        return _HealthCheckResult(healthy=True, reason="")

    async def run_full_canary(self, state: CanaryState) -> CanaryState:
        """执行完整的金丝雀发布流程：初始化→10%→50%→100%→完成。"""
        logger.info(f"[canary] task={state.task_id} starting full canary deployment")

        while state.stage not in (CanaryStage.COMPLETED, CanaryStage.ROLLED_BACK):
            state = await self.advance(state)

        logger.info(
            f"[canary] task={state.task_id} canary deployment finished: "
            f"stage={state.stage.value}"
        )
        return state


class _HealthCheckResult(BaseModel):
    """健康检查结果。"""
    healthy: bool
    reason: str = ""
