"""ConsumptionWeightedRanker — 消费加权排序。

实现 roleagent.md §4.4 消费加权排序公式：
    score = base_authority × log(1 + consumption_count) × recency_factor × relevance_score

设计依据：
    - F017-consumption-weighted-ranking.md
    - roleagent.md §4.4 用行为信号而非自评

核心原则（roleagent.md §4.4）：
    记忆重要性不靠自评，靠消费信号：
        - 被引用次数（consumption_count）
        - 被复用次数
        - 解决问题次数
        - 失败引用次数（负向信号，未来扩展）

铁律遵守：
    - 铁律 3：通过构造函数注入 logger / governance / recency
    - 编程红线 9：组合（RecencyFactor + MemoryGovernance）而非继承

License: MIT
"""

from __future__ import annotations

import math
from datetime import UTC, datetime

from pydantic import BaseModel, Field

from flowforge.core.memory_federation.collection import MemoryEntry
from flowforge.core.memory_federation.governance import MemoryGovernance
from flowforge.core.tracing import TraceLogger, get_logger

logger = get_logger("memory_federation.ranker")


class RecencyFactor(BaseModel):
    """最近性因子——基于 last_accessed 的时间衰减。

    roleagent.md §4.4：最近被访问的记忆应优先返回。
    采用半衰期模型：每经过 half_life_days 天，因子减半。

    Attributes:
        half_life_days: 半衰期（天）。默认 30 天。
        min_factor: 最小因子（0.0-1.0）。避免归零，保留可恢复性。
    """

    half_life_days: float = Field(
        default=30.0, gt=0.0, description="半衰期（天）"
    )
    min_factor: float = Field(
        default=0.1, ge=0.0, le=1.0, description="最小因子"
    )

    def compute(self, last_accessed: str) -> float:
        """计算最近性因子。

        Args:
            last_accessed: ISO 8601 时间字符串。

        Returns:
            最近性因子（min_factor-1.0）。
                - 刚访问：1.0
                - 经过 half_life_days 天：0.5
                - 经过 2 × half_life_days 天：0.25
                - 下限：min_factor
        """
        try:
            ts = datetime.fromisoformat(last_accessed)
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=UTC)
        except ValueError:
            logger.warning(
                f"Invalid last_accessed format: {last_accessed}, "
                f"returning min_factor"
            )
            return self.min_factor
        now = datetime.now(UTC)
        elapsed_days = (now - ts).total_seconds() / 86400.0
        factor = 0.5 ** (elapsed_days / self.half_life_days)
        return max(self.min_factor, factor)


class ConsumptionWeightedRanker:
    """消费加权排序器——按公式对记忆条目排序。

    公式（roleagent.md §4.4）：
        score = base_authority × log(1 + consumption_count) × recency_factor × relevance_score

    各因子来源：
        - base_authority: MemoryGovernance.compute_authority(entry)
        - log(1 + consumption_count): 直接从 entry.consumption_count 计算
        - recency_factor: RecencyFactor.compute(entry.last_accessed)
        - relevance_score: 由调用方通过 relevance_scores 注入（默认 1.0）

    设计意图：
        - 未被消费（consumption_count=0）的条目 score=0，自然沉底
        - 高权威 + 高消费 + 最近访问 + 高相关 = 优先返回
        - relevance_score 由检索入口计算后注入（grep/semantic/index 的 score）

    Args:
        governance: MemoryGovernance 实例（提供 authority 计算）。
        recency: RecencyFactor 实例。
        relevance_scores: 可选的 {entry_id: relevance_score} 映射。
            通常由 RetrievalResult.score 转换而来。
        logger: TraceLogger 实例。
    """

    def __init__(
        self,
        governance: MemoryGovernance | None = None,
        recency: RecencyFactor | None = None,
        relevance_scores: dict[str, float] | None = None,
        logger: TraceLogger | None = None,
    ) -> None:
        self._governance: MemoryGovernance = governance or MemoryGovernance()
        self._recency: RecencyFactor = recency or RecencyFactor()
        self._relevance_scores: dict[str, float] = relevance_scores or {}
        self._logger: TraceLogger = logger or get_logger(
            "memory_federation.ranker"
        )

    async def rank(
        self, entries: list[MemoryEntry]
    ) -> list[MemoryEntry]:
        """按消费加权公式排序。

        Args:
            entries: 待排序的记忆条目列表。

        Returns:
            按分数降序排列的列表（新列表，不修改输入）。
            未被消费（consumption_count=0）的条目排在末尾（score=0）。
        """
        scored: list[tuple[float, MemoryEntry]] = []
        for entry in entries:
            authority = await self._governance.compute_authority(entry)
            # 公式中的 log(1 + consumption_count) 项
            # consumption_count=0 → log(1)=0 → score=0（自然沉底）
            log_consumption = math.log(1 + entry.consumption_count)
            recency = self._recency.compute(entry.last_accessed)
            relevance = self._relevance_scores.get(entry.entry_id, 1.0)
            # 完整公式
            score = authority * log_consumption * recency * relevance
            scored.append((score, entry))
            self._logger.debug(
                f"Entry {entry.entry_id}: "
                f"authority={authority:.3f} "
                f"log_cons={log_consumption:.3f} "
                f"recency={recency:.3f} "
                f"relevance={relevance:.3f} "
                f"→ score={score:.3f}"
            )
        # 降序排列
        scored.sort(key=lambda x: x[0], reverse=True)
        return [entry for _, entry in scored]

    def set_relevance_scores(
        self, scores: dict[str, float]
    ) -> None:
        """更新相关性分数映射（由检索结果注入）。

        Args:
            scores: {entry_id: relevance_score} 映射。
        """
        self._relevance_scores = dict(scores)
