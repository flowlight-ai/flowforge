"""门禁超时策略 — 支持三种超时计时起点。

gate_start: 计时器在门禁评估开始时启动
review_ready: 计时器在所有评估者提交评分后启动
first_evaluator_done: 计时器在第一个评估者完成时启动

超时后自动判定门禁失败，附带超时原因。
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Coroutine
from enum import Enum
from typing import Any

from flowforge.core.gate.models import GateStatus, GateVerdict, Score
from flowforge.core.tracing import get_logger

logger = get_logger("gate_timeout")

DEFAULT_TIMEOUT_SECONDS = 300  # 5 分钟


class TimeoutStrategy(str, Enum):
    """门禁超时计时策略。"""
    GATE_START = "gate_start"
    REVIEW_READY = "review_ready"
    FIRST_EVALUATOR_DONE = "first_evaluator_done"


class GateTimer:
    """门禁超时计时器。

    根据配置的策略决定何时启动计时器，超时后自动失败门禁。

    用法:
        timer = GateTimer(strategy=TimeoutStrategy.GATE_START, timeout_seconds=300)
        timer.start()
        # ... 执行评估 ...
        timer.on_review_ready()  # 仅 REVIEW_READY 策略需要
        timer.on_first_evaluator_done()  # 仅 FIRST_EVALUATOR_DONE 策略需要
        # 检查是否超时
        if timer.is_timed_out():
            return timer.timeout_verdict(gate_name, task_id)
    """

    def __init__(
        self,
        strategy: TimeoutStrategy = TimeoutStrategy.GATE_START,
        timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
    ) -> None:
        self._strategy = strategy
        self._timeout_seconds = timeout_seconds
        self._gate_start_time: float | None = None
        self._review_ready_time: float | None = None
        self._first_evaluator_done_time: float | None = None
        self._effective_start_time: float | None = None

    @property
    def strategy(self) -> TimeoutStrategy:
        return self._strategy

    @property
    def timeout_seconds(self) -> int:
        return self._timeout_seconds

    def start(self) -> None:
        """标记门禁评估开始。

        对于 GATE_START 策略，此时启动计时器。
        """
        self._gate_start_time = time.monotonic()
        if self._strategy == TimeoutStrategy.GATE_START:
            self._effective_start_time = self._gate_start_time
            logger.info(
                f"[gate_timer] timer started (strategy={self._strategy.value}, "
                f"timeout={self._timeout_seconds}s)"
            )

    def on_review_ready(self) -> None:
        """标记所有评估者已提交评分。

        对于 REVIEW_READY 策略，此时启动计时器。
        """
        self._review_ready_time = time.monotonic()
        if self._strategy == TimeoutStrategy.REVIEW_READY:
            self._effective_start_time = self._review_ready_time
            logger.info(
                f"[gate_timer] review_ready triggered, timer started "
                f"(strategy={self._strategy.value}, timeout={self._timeout_seconds}s)"
            )

    def on_first_evaluator_done(self) -> None:
        """标记第一个评估者完成。

        对于 FIRST_EVALUATOR_DONE 策略，此时启动计时器。
        """
        if self._first_evaluator_done_time is None:
            self._first_evaluator_done_time = time.monotonic()
            if self._strategy == TimeoutStrategy.FIRST_EVALUATOR_DONE:
                self._effective_start_time = self._first_evaluator_done_time
                logger.info(
                    f"[gate_timer] first_evaluator_done triggered, timer started "
                    f"(strategy={self._strategy.value}, timeout={self._timeout_seconds}s)"
                )

    def is_timed_out(self) -> bool:
        """检查是否已超时。

        如果计时器尚未启动（effective_start_time 为 None），
        则不会超时（等待计时起点到达）。
        """
        if self._effective_start_time is None:
            return False
        elapsed = time.monotonic() - self._effective_start_time
        return elapsed > self._timeout_seconds

    def elapsed_seconds(self) -> float:
        """返回从有效起点开始经过的秒数。"""
        if self._effective_start_time is None:
            return 0.0
        return time.monotonic() - self._effective_start_time

    def remaining_seconds(self) -> float:
        """返回剩余秒数。"""
        if self._effective_start_time is None:
            return float(self._timeout_seconds)
        return max(0.0, self._timeout_seconds - self.elapsed_seconds())

    def timeout_verdict(
        self,
        gate_name: str,
        task_id: str,
        scores: list[Score] | None = None,
    ) -> GateVerdict:
        """生成超时裁决。

        Args:
            gate_name: 门禁名称
            task_id: 任务 ID
            scores: 已收集的评分（可能不完整）

        Returns:
            GateVerdict 标记为 TIMEOUT 状态
        """
        from datetime import datetime

        logger.warning(
            f"[gate_timer] TIMEOUT: gate={gate_name}, task={task_id}, "
            f"strategy={self._strategy.value}, "
            f"elapsed={self.elapsed_seconds():.1f}s, "
            f"timeout={self._timeout_seconds}s"
        )

        return GateVerdict(
            gate_id=gate_name,
            gate_name=gate_name,
            task_id=task_id,
            status=GateStatus.TIMEOUT,
            scores=scores or [],
            overall_score=0.0,
            pass_threshold=0.0,
            decision="timeout",
            reviewer_feedback=(
                f"Gate timed out after {self._timeout_seconds}s "
                f"(strategy: {self._strategy.value})"
            ),
            decided_at=datetime.now(),
        )

    async def wrap_evaluation(
        self,
        coro: Coroutine[Any, Any, list[Score]],
        gate_name: str,
        task_id: str,
    ) -> list[Score] | GateVerdict:
        """包装评估协程，加入超时控制。

        如果评估在超时前完成，返回评分列表。
        如果超时，返回超时裁决 GateVerdict。

        Args:
            coro: 评估协程，返回 list[Score]
            gate_name: 门禁名称
            task_id: 任务 ID

        Returns:
            list[Score] 如果在超时前完成，或 GateVerdict 如果超时
        """
        try:
            # 使用 asyncio.wait_for 实现超时
            # 但只有当 effective_start_time 已设置时才应用超时
            if self._effective_start_time is not None:
                remaining = self.remaining_seconds()
                if remaining <= 0:
                    return self.timeout_verdict(gate_name, task_id)
                scores = await asyncio.wait_for(coro, timeout=remaining)
            else:
                scores = await coro

            return scores

        except TimeoutError:
            return self.timeout_verdict(gate_name, task_id)


def create_timer_from_config(gate_config: dict[str, Any]) -> GateTimer:
    """从门禁配置创建 GateTimer。

    配置格式:
        timeout_strategy: "gate_start" | "review_ready" | "first_evaluator_done"
        timeout_seconds: 300  (可选，默认 300)

    Args:
        gate_config: 门禁 YAML 配置

    Returns:
        GateTimer 实例
    """
    strategy_str = gate_config.get("timeout_strategy", "gate_start")
    try:
        strategy = TimeoutStrategy(strategy_str)
    except ValueError:
        logger.warning(
            f"[gate_timer] unknown timeout strategy '{strategy_str}', "
            f"falling back to gate_start"
        )
        strategy = TimeoutStrategy.GATE_START

    timeout_seconds = gate_config.get("timeout_seconds", DEFAULT_TIMEOUT_SECONDS)

    return GateTimer(strategy=strategy, timeout_seconds=timeout_seconds)
