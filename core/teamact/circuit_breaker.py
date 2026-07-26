"""PingPongCircuitBreaker — 乒乓球熔断器（给数据不给结论）。

乒乓球熔断器检测Forgekin间的"乒乓球"模式：两个Forgekin互相传球却没有实质进展。
当 N > threshold（默认 3）时触发熔断，建议"该换路了"（不是"再来一个就好了"）。

对应 roleagent.md §2.4 + F004-pingpong-circuit-breaker.md：
    "乒乓球熔断器（ping-pong circuit breaker）检测来回传球但无进展的模式。
     N>3 时'该换路了'，给数据不给结论。"

设计依据：
    - features/F002-teamact-loop.md §2.2
    - features/F004-pingpong-circuit-breaker.md
    - roleagent.md §2.4

铁律遵守：
    - 铁律 3：通过构造函数注入配置，不直接实例化外部服务
    - 铁律 5：阈值/冷却时间通过 config 注入，不硬编码
    - 编程红线 9：使用组合而非继承

License: MIT
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from flowforge.core.tracing import get_logger

logger = get_logger("teamact.circuit_breaker")


class PingPongCircuitBreaker:
    """乒乓球熔断器 — 检测Forgekin间无进展的来回传球模式。

    核心行为（roleagent.md §2.4）：
        - 当某Forgekin连续失败/来回传球次数 N > threshold（默认 3）时触发熔断
        - 触发时"该换路了"（不是"再来一个就好了"）
        - 给数据不给结论：返回失败次数和原因，不直接决策下一步

    依赖注入（铁律 3）：
        - threshold / cooldown / max_rounds 通过构造函数注入
        - 默认值仅用于无配置场景，生产环境应通过 config/teamact.yaml 注入

    Args:
        max_rounds: 绝对上限轮数（硬熔断，超过则强制中断）。
        threshold: 软阈值（N > threshold 时建议换路，默认 3）。
        cooldown: 冷却时间（秒），熔断后需等待冷却才能重置。
        logger: 可选的 TraceLogger 实例（来自 flowforge.core.tracing.get_logger）。
    """

    def __init__(
        self,
        max_rounds: int = 5,
        threshold: int = 3,
        cooldown: int = 60,
        logger: Optional[object] = None,
    ) -> None:
        self.max_rounds: int = max_rounds
        self.threshold: int = threshold
        self.cooldown: int = cooldown
        self.rounds_count: dict[str, int] = {}
        self.last_failure: dict[str, tuple[datetime, str]] = {}
        self._logger = logger or get_logger("teamact.circuit_breaker")

    def record_failure(self, agent_id: str, reason: str) -> None:
        """记录一次失败（乒乓球来回）。

        每次Forgekin在 TeamAct 循环中无进展地传球/失败时调用。
        increments rounds_count[agent_id] 并记录最近一次失败原因。

        Args:
            agent_id: Forgekin（Forgekin）标识。
            reason: 失败原因（用于 trace 诊断）。
        """
        self.rounds_count[agent_id] = self.rounds_count.get(agent_id, 0) + 1
        self.last_failure[agent_id] = (
            datetime.now(timezone.utc),
            reason,
        )
        count = self.rounds_count[agent_id]
        self._logger.debug(  # type: ignore[union-attr]
            f"PingPong failure recorded: agent={agent_id} count={count} reason={reason}"
        )

    def should_break(self, agent_id: str) -> bool:
        """检查是否应触发熔断。

        核心逻辑（roleagent.md §2.4）：
            - N > threshold（默认 3）时返回 True → "该换路了"
            - N <= threshold 时返回 False → 继续尝试
            - N > max_rounds 时也返回 True（硬上限）

        Args:
            agent_id: Forgekin标识。

        Returns:
            True 表示应触发熔断（换路），False 表示继续。
        """
        count = self.rounds_count.get(agent_id, 0)
        if count > self.max_rounds:
            return True
        # N > threshold → 该换路了
        return count > self.threshold

    def reset(self, agent_id: str) -> None:
        """重置Forgekin的失败计数。

        当Forgekin取得实质进展（产出证据 / 通过 review）时调用。

        Args:
            agent_id: Forgekin标识。
        """
        self.rounds_count.pop(agent_id, None)
        self.last_failure.pop(agent_id, None)
        self._logger.debug(  # type: ignore[union-attr]
            f"PingPong counter reset: agent={agent_id}"
        )

    def get_failure_data(self, agent_id: str) -> dict[str, object]:
        """获取失败数据（给数据不给结论，roleagent.md §2.4）。

        返回原始数据，由调用方（CVO / operator）决定下一步，
        熔断器本身不决策。

        Args:
            agent_id: Forgekin标识。

        Returns:
            包含 rounds_count / last_failure / threshold / should_break 的数据字典。
        """
        count = self.rounds_count.get(agent_id, 0)
        last = self.last_failure.get(agent_id)
        return {
            "agent_id": agent_id,
            "rounds_count": count,
            "threshold": self.threshold,
            "max_rounds": self.max_rounds,
            "should_break": self.should_break(agent_id),
            "last_failure_time": last[0].isoformat() if last else None,
            "last_failure_reason": last[1] if last else None,
        }
