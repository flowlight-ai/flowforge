"""MemoryGovernance — 记忆治理三要素。

实现 roleagent.md §4.4 记忆治理：
    1. 权威等级（Authority Level）：基于来源 + 验证状态
    2. 消费加权（Consumption Weighting）：基于消费信号（不是自评）
    3. 衰减策略（Decay Strategy）：基于时间的指数衰减

设计依据：
    - F016-memory-governance.md
    - roleagent.md §4.4 消费加权排序（用行为信号而非自评）

关键设计：
    - 用行为信号（consumption_count）而非自评
    - 衰减是幂等的（重复调用 apply_decay 不产生累积误差）
    - 治理参数全部从 GovernanceConfig 注入（铁律 5）

铁律遵守：
    - 铁律 3：通过构造函数注入 logger / config，不直接实例化外部服务
    - 铁律 5：所有可调参数从 config/memory_federation.yaml 注入
    - 编程红线 9：组合（GovernanceConfig + MemoryEntry）而非继承

License: MIT
"""

from __future__ import annotations

import math
from datetime import UTC, datetime

from pydantic import BaseModel, Field

from flowforge.core.memory_federation.collection import MemoryEntry
from flowforge.core.tracing import TraceLogger, get_logger

logger = get_logger("memory_federation.governance")


class GovernanceConfig(BaseModel):
    """治理配置（从 memory_federation.yaml 注入）。

    铁律 5：所有可调参数外置到 config/memory_federation.yaml，
    由调用方通过 SystemConfig 加载并注入到 GovernanceConfig。

    Attributes:
        authority_base: 基础权威分（0.0-1.0，未验证来源的起点）。
        authority_source_boost: 来源可信度加成（如 verified_source +0.2）。
        verified_sources: 可信来源列表（享受加成）。
            典型值：["claude-code-forgekin", "gpt5-researcher-forgekin",
                     "spiritforge", "operator"]。
        decay_half_life_days: 衰减半衰期（天）。
            30 天表示 30 天未访问则权威减半。
        decay_min_score: 衰减下限（0.0-1.0）。
            避免归零，保留可恢复性（被重新消费时 authority 可回升）。
    """

    authority_base: float = Field(
        default=0.5, ge=0.0, le=1.0, description="基础权威分"
    )
    authority_source_boost: float = Field(
        default=0.2, ge=0.0, le=1.0, description="可信来源加成"
    )
    verified_sources: list[str] = Field(
        default_factory=list, description="可信来源列表"
    )
    decay_half_life_days: float = Field(
        default=30.0, gt=0.0, description="衰减半衰期（天）"
    )
    decay_min_score: float = Field(
        default=0.1, ge=0.0, le=1.0, description="衰减下限"
    )


class MemoryGovernance:
    """记忆治理——三要素计算。

    roleagent.md §4.4：用行为信号（consumption_count）而非自评。
    所有方法纯函数式（基于 entry + config），无副作用。

    Args:
        config: GovernanceConfig 实例（可选，使用默认值）。
        logger: TraceLogger 实例。
    """

    def __init__(
        self,
        config: GovernanceConfig | None = None,
        logger: TraceLogger | None = None,
    ) -> None:
        self._config: GovernanceConfig = config or GovernanceConfig()
        self._logger: TraceLogger = logger or get_logger(
            "memory_federation.governance"
        )

    # ── 要素 1：权威等级 ────────────────────────────────────────────

    async def compute_authority(self, entry: MemoryEntry) -> float:
        """计算权威等级。

        权威 = 基础分 + 来源加成（如果来源在可信列表中）。

        设计意图：
            - 未验证来源：authority_base（0.5）
            - 可信来源：authority_base + authority_source_boost（0.7）
            - 上限 1.0

        Args:
            entry: 记忆条目。

        Returns:
            权威等级（0.0-1.0）。
        """
        authority = self._config.authority_base
        if entry.source in self._config.verified_sources:
            authority += self._config.authority_source_boost
        authority = min(1.0, authority)
        self._logger.debug(
            f"Authority for entry {entry.entry_id}: {authority:.3f} "
            f"(source={entry.source})"
        )
        return authority

    # ── 要素 2：消费加权 ────────────────────────────────────────────

    async def compute_weight(self, entry: MemoryEntry) -> float:
        """计算消费权重（归一化到 0.0-1.0）。

        权重 = log(1 + consumption_count) / log(1 + 100)
        roleagent.md §4.4：消费次数越高，权重越高。
        归一化基准 log(101) ≈ 4.6，对应 consumption_count=100 时权重=1.0。

        Args:
            entry: 记忆条目。

        Returns:
            消费权重（0.0-1.0）。
        """
        raw = math.log(1 + entry.consumption_count)
        # 归一化：consumption_count=100 时权重=1.0
        weight = min(1.0, raw / math.log(101))
        return weight

    # ── 要素 3：衰减策略 ────────────────────────────────────────────

    async def apply_decay(self, entry: MemoryEntry) -> MemoryEntry:
        """应用时间衰减策略。

        基于半衰期的指数衰减：
            decayed = max(decay_min_score, authority × 0.5 ^ (elapsed / half_life))

        幂等性：基于 last_accessed 计算，重复调用结果一致（不累积误差）。
        返回新的 MemoryEntry（不修改原对象），authority_level 已更新。

        Args:
            entry: 原始记忆条目。

        Returns:
            衰减后的新 MemoryEntry（authority_level 已衰减）。
        """
        last_accessed_dt = self._parse_iso(entry.last_accessed)
        now = datetime.now(UTC)
        elapsed_days = (now - last_accessed_dt).total_seconds() / 86400.0
        # 半衰期衰减
        decay_factor = 0.5 ** (
            elapsed_days / self._config.decay_half_life_days
        )
        decayed_authority = max(
            self._config.decay_min_score,
            entry.authority_level * decay_factor,
        )
        new_entry = entry.model_copy(
            update={"authority_level": decayed_authority}
        )
        self._logger.debug(
            f"Decay entry {entry.entry_id}: "
            f"elapsed={elapsed_days:.2f}d "
            f"factor={decay_factor:.3f} "
            f"authority {entry.authority_level:.3f} → {decayed_authority:.3f}"
        )
        return new_entry

    @staticmethod
    def _parse_iso(ts: str) -> datetime:
        """解析 ISO 8601 时间字符串，失败时返回当前时间。

        Args:
            ts: ISO 8601 时间字符串。

        Returns:
            timezone-aware datetime。
        """
        try:
            dt = datetime.fromisoformat(ts)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=UTC)
            return dt
        except ValueError:
            logger.warning(f"Invalid ISO timestamp: {ts}, using now")
            return datetime.now(UTC)
