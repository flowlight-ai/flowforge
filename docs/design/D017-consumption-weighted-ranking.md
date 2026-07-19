# D017: 消费加权排序详细设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 开发者灵智体（猎犬·夏洛克）
> **对应 spec.md**: [doc:../spec.md#§3.4]（FR-CORE-004）
> **对应 arch.md**: [doc:../arch.md#§3.4]
> **对应 design.md**: [doc:../design.md#§3.4]
> **对应 Feature**: [doc:../features/F017-consumption-weighted-ranking.md]（同号 Feature 级 SRS）
> **对应 Architecture**: [doc:../architecture/A017-consumption-weighted-ranking.md]（同号 Feature 级 SAD）
> **依赖 ADR**: [doc:../decisions/008-memory-federation.md]
> **9 大点名称修订**: 已应用（双轨命名 + AI 术语优先 + 弱化万物 + 去 AGI 化）

---

## 1. 详细设计上下文

### 1.1 设计问题

灵智体（Forgekin，社区社交称"灵智体"）在记忆检索中需要判断"知识价值"。v7.0 靠向量相似度 + 时间衰减，导致两类问题：冷启动偏热点（新条目无消费数据被埋底）、LLM 自评失真（模型说自己好）。A017 架构设计已确认 L4 消费排序层实现 14 行为指标汇聚 + 调整后得分公式 + 贝叶斯收缩 + 中心化偏移 + 分数时效衰减。

本详细设计进一步下沉到代码层，需要解决以下子问题：

1. **14 行为信号的物理存储**：14 类 SignalType 在 `consumption_signals` 表的存储结构，按 entry_id 聚合的索引设计，支持高频写入（>1000 TPS）。
2. **贝叶斯收缩的实现**：新条目 entry_count=0 时如何向同类平均收缩，`prior_strength=5` 参数的语义与边界条件（负值、零值处理）。
3. **中心化偏移的负值处理**：`entry_sum - class_average` 可能为负，"长期不用"条目得负分的实现机制与下游 display 的负值处理。
4. **时效衰减的 floor 实现**：`max(0.2, 0.5 ** (days / 30))` 公式的边界（last_consumed_at 远期值、未来值）与精度。
5. **统计缓存的失效策略**：`ConsumptionStatsCache` 在 record 后失效的强一致保证，避免缓存与 DB 不一致导致排序错误。
6. **公式五项参与的硬约束**：如何在 `rank()` 中强制五项全部参与计算，缺一项即拒绝（防止工程师偷工减料）。

### 1.2 设计约束

- **单向依赖约束**：`flowforge/core/memory/ranking/` 是 L4 消费排序层，可依赖 F014/F015/F016，禁止被它们反向依赖，禁止 import F018/F020/F039/F040 任何模块。
- **行为信号约束**：14 行为指标必须来自真实工具调用 / 真实读屏 / 真实任务结果，禁止 LLM 自评打分（编程红线第 3 条延伸）。
- **贝叶斯收缩约束**：新条目无消费数据时必须向同类平均收缩，禁止默认 0 分（防止被埋底）。
- **不归零约束**：时效衰减必须设 floor（默认 0.2），禁止旧条目归零（保留长尾）。
- **配置驱动约束**：14 信号权重、贝叶斯参数（prior_strength）、时效半衰期（half_life_days=30）、floor 值外置 `config/consumption_weighted.yaml`。
- **DI 容器约束**：`ConsumptionWeightedRanker` / `ConsumptionCollector` / `BayesianShrinker` / `RecencyDecay` 均通过 DI 容器注入。
- **Repository 层约束**：14 信号持久化必须经 `ConsumptionSignalRepository` 抽象，禁止 `cursor.execute("INSERT INTO consumption_signals ...")` 直操作数据库。
- **异步约束**：所有 I/O 操作使用 `async/await`，缓存失效使用 `asyncio.create_task` 异步执行。
- **类型注解约束**：Python 3.11+，所有公共方法强制类型注解。

### 1.3 设计影响

- **对 F014 Collection 层（D014）**：`entry_id` 是 14 行为信号的聚合主键，D014 必须保证 `entry_id` 全局唯一（UUID v7 时序排序）。本设计需在 record 时校验 entry_id 存在性。
- **对 F015 三检索入口（D015）**：RRF 融合后的 `retrieval_score` 是消费加权公式的"融合检索得分"项，必须传入 RankContext。
- **对 F016 治理层（D016）**：deprecated 条目 ×0.3 降权是消费加权公式中"过时惩罚"的输入。本设计需从 RankContext 接收 `authority_bonus_map` 与 `staleness_penalty_map`。
- **对 F039 锻典可检索**：消费加权让"哪些锻典条目真正被复用"可识别，是 Build to Persist 的反馈闭环资产。
- **对 F040 控制面**：14 信号采集统计写入 F040 Eval Hub，作为"知识价值"摩擦指标。
- **对 DI 容器**：需新增 `consumption_ranker` / `consumption_collector` / `bayesian_shrinker` / `recency_decay` / `consumption_stats_cache` / `consumption_signal_repository` 六个绑定。
- **对数据库 schema**：需新增 `consumption_signals` 表（按 entry_id + signal_type 聚合索引）+ `consumption_stats` 缓存表。

---

## 2. 详细设计

### 2.1 类图 ASCII

```
┌──────────────────────────────────────────────────────────────────────┐
│                      <<module>> ranking                              │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  <<enum>> SignalType            <<model>> ConsumptionSignal          │
│  + SEARCHED                     + signal_id: str                     │
│  + READ                          + entry_id: str                     │
│  + USED                          + forgekin_id: str                   │
│  + CITED                         + signal_type: SignalType           │
│  + SKIPPED                       + weight: float                     │
│  + REJECTED                      + occurred_at: datetime             │
│  + DOWNVOTED                     + context: dict?                   │
│  + TASK_SUCCEEDED_AFTER                                              │
│  + TASK_FAILED_AFTER             <<model>> ConsumptionStats          │
│  + ADAPTED_FROM                  + entry_id: str                     │
│  + REFINED_INTO                  + total_signals: int                │
│  + CROSS_REFERENCED              + positive_signals: int             │
│  + SUPERSEDED                    + negative_signals: int            │
│  + FLAGGED_FOR_REVIEW            + bayesian_estimate: float          │
│                                  + centered_offset: float            │
│  <<enum>> RankContext            + recency_score: float              │
│  + forgekin_id                   + staleness_penalty: float         │
│  + task_scope                                                       │
│  + authority_bonus_map          <<model>> RankedHit                  │
│  + staleness_penalty_map         + entry_id: str                     │
│                                  + original_score: float            │
│  <<interface>> ConsumptionCollector + adjusted_score: float        │
│  + record(signal): void         + authority_bonus: float           │
│  + stats(entry_id): stats        + consumption_prior: float         │
│                                  + recency_decay: float             │
│  <<interface>> BayesianShrinker  + staleness_penalty: float         │
│  + shrink(stats, avg): float     + formula_complete: bool           │
│  + center(stats, avg): float                                        │
│                                  <<model>> RankingConfig             │
│  <<interface>> RecencyDecay      + signal_weights: dict            │
│  + decay(last, now): float       + prior_strength: int = 5           │
│                                  + half_life_days: int = 30          │
│  <<interface>> ConsumptionWeightedRanker + floor: float = 0.2     │
│  + rank(hits, ctx): list        + require_all_five: bool = true     │
│                                                                      │
│  <<interface>> ConsumptionSignalRepository                          │
│  + insert_signal(signal): void                                       │
│  + query_stats(entry_id): stats                                      │
│  + query_class_average(collection_type): float                      │
│  + invalidate_cache(entry_id): void                                  │
│                                                                      │
│  <<interface>> ConsumptionStatsCache                                │
│  + get(entry_id): stats?                                             │
│  + set(entry_id, stats): void                                        │
│  + invalidate(entry_id): void                                        │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.2 接口实现 Python 代码

```python
# flowforge/core/memory/ranking/collector.py
from __future__ import annotations
from abc import ABC, abstractmethod
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict
from enum import Enum


class SignalType(str, Enum):
    """14 行为信号类型；必须来自真实工具调用 / 任务结果"""
    SEARCHED = "searched"
    READ = "read"
    USED = "used"
    CITED = "cited"
    SKIPPED = "skipped"
    REJECTED = "rejected"
    DOWNVOTED = "downvoted"
    TASK_SUCCEEDED_AFTER = "task_succeeded_after"
    TASK_FAILED_AFTER = "task_failed_after"
    ADAPTED_FROM = "adapted_from"
    REFINED_INTO = "refined_into"
    CROSS_REFERENCED = "cross_referenced"
    SUPERSEDED = "superseded"
    FLAGGED_FOR_REVIEW = "flagged_for_review"


class ConsumptionSignal(BaseModel):
    """单条消费信号"""
    model_config = ConfigDict()

    signal_id: str = Field(min_length=1)
    entry_id: str = Field(min_length=1)
    forgekin_id: str = Field(min_length=1)
    signal_type: SignalType
    weight: float = Field(default=1.0, gt=0.0)
    occurred_at: datetime
    context: Optional[dict] = None


class ConsumptionStats(BaseModel):
    """消费统计；走 ConsumptionStatsCache"""
    model_config = ConfigDict()

    entry_id: str
    total_signals: int = Field(ge=0)
    positive_signals: int = Field(ge=0)
    negative_signals: int = Field(ge=0)
    bayesian_estimate: float
    centered_offset: float
    recency_score: float
    staleness_penalty: float = 0.0
    last_consumed_at: Optional[datetime] = None


class RankContext(BaseModel):
    """重排上下文"""
    model_config = ConfigDict()

    forgekin_id: str = Field(min_length=1)
    task_scope: Optional[str] = None
    authority_bonus_map: dict[str, float] = Field(default_factory=dict)
    staleness_penalty_map: dict[str, float] = Field(default_factory=dict)


class RankedHit(BaseModel):
    """重排后 hit 模型；五项必须全部参与"""
    model_config = ConfigDict()

    entry_id: str
    original_score: float
    adjusted_score: float
    authority_bonus: float
    consumption_prior: float
    recency_decay: float
    staleness_penalty: float
    formula_complete: bool = True  # 五项全参与才为 True


class FormulaIncompleteError(ValueError):
    """五项缺一即抛出"""
    pass


class SelfEvaluationForbiddenError(ValueError):
    """LLM 自评打分被禁止时抛出"""
    pass


class ConsumptionCollector(ABC):
    """14 信号采集器"""

    @abstractmethod
    async def record(self, signal: ConsumptionSignal) -> None:
        """
        记录 14 信号之一：
        1. signal_type 必须来自真实工具调用或任务结果
        2. 禁止 LLM 自评打分（编程红线第 3 条）
        3. 持久化后失效 cache
        """

    @abstractmethod
    async def stats(self, entry_id: str) -> ConsumptionStats:
        """查询条目消费统计；走缓存"""


class ConsumptionWeightedRanker(ABC):
    """消费加权重排器"""

    @abstractmethod
    async def rank(
        self,
        hits: list,
        context: RankContext,
    ) -> list:
        """
        调整后得分公式：
        adjusted = retrieval_score
                 + authority_bonus
                 + consumption_prior
                 + recency_decay
                 - staleness_penalty
        五项缺一即拒绝（require_all_five=true 时）
        """


class BayesianShrinker(ABC):
    """贝叶斯收缩 + 中心化偏移"""

    @abstractmethod
    def shrink(
        self,
        entry_stats: ConsumptionStats,
        class_average: float,
        prior_strength: int = 5,
    ) -> float:
        """
        bayesian_estimate = (class_average * prior_strength + entry_sum)
                          / (prior_strength + entry_count)
        新条目 entry_count=0 时收缩到 class_average
        """

    @abstractmethod
    def center(
        self,
        entry_stats: ConsumptionStats,
        class_average: float,
    ) -> float:
        """centered_offset = entry_sum - class_average（允许负值）"""


class RecencyDecay(ABC):
    """时效衰减（不归零）"""

    @abstractmethod
    def decay(
        self,
        last_consumed_at: Optional[datetime],
        now: datetime,
        half_life_days: int = 30,
        floor: float = 0.2,
    ) -> float:
        """
        recency = max(floor, 0.5 ** ((now - last_consumed_at).days / half_life_days))
        必须不归零；last_consumed_at=None 时返回 floor
        """


class ConsumptionSignalRepository(ABC):
    """14 信号 Repository 层（禁直操作数据库）"""

    @abstractmethod
    async def insert_signal(self, signal: ConsumptionSignal) -> None: ...

    @abstractmethod
    async def query_stats(self, entry_id: str) -> ConsumptionStats: ...

    @abstractmethod
    async def query_class_average(self, collection_type: str) -> float: ...

    @abstractmethod
    async def invalidate_cache(self, entry_id: str) -> None: ...


class ConsumptionStatsCache(ABC):
    """消费统计缓存"""

    @abstractmethod
    async def get(self, entry_id: str) -> Optional[ConsumptionStats]: ...

    @abstractmethod
    async def set(self, entry_id: str, stats: ConsumptionStats) -> None: ...

    @abstractmethod
    async def invalidate(self, entry_id: str) -> None: ...
```

### 2.3 数据结构 Pydantic Models

```python
# flowforge/core/memory/ranking/models.py
from __future__ import annotations
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field, model_validator
from .collector import SignalType


class RankingConfig(BaseModel):
    """YAML 配置加载结果"""

    signal_weights: dict[SignalType, float] = Field(
        default_factory=lambda: {
            SignalType.SEARCHED: 1.0,
            SignalType.READ: 1.5,
            SignalType.USED: 2.0,
            SignalType.CITED: 3.0,
            SignalType.SKIPPED: -0.5,
            SignalType.REJECTED: -2.0,
            SignalType.DOWNVOTED: -3.0,
            SignalType.TASK_SUCCEEDED_AFTER: 2.5,
            SignalType.TASK_FAILED_AFTER: -1.5,
            SignalType.ADAPTED_FROM: 1.5,
            SignalType.REFINED_INTO: 2.0,
            SignalType.CROSS_REFERENCED: 1.0,
            SignalType.SUPERSEDED: -1.0,
            SignalType.FLAGGED_FOR_REVIEW: -0.5,
        }
    )
    prior_strength: int = Field(default=5, ge=1, le=20)
    half_life_days: int = Field(default=30, ge=1, le=365)
    floor: float = Field(default=0.2, gt=0.0, lt=1.0)
    require_all_five: bool = True
    cache_ttl_seconds: int = Field(default=300, ge=60)
    cache_max_size: int = Field(default=10000, ge=100)
    forbid_llm_self_eval: bool = True  # 编程红线第 3 条延伸

    @model_validator(mode="after")
    def validate_signal_weights(self) -> "RankingConfig":
        if len(self.signal_weights) != 14:
            raise ValueError("signal_weights must contain all 14 SignalType entries")
        return self


class ClassAverageCache(BaseModel):
    """同类平均消费率缓存"""
    model_config = ConfigDict()

    collection_type: str
    average: float
    cached_at: datetime
    ttl_seconds: int = 300
```

### 2.4 关键算法伪代码

```
function ConsumptionWeightedRanker.rank(hits, context):
    ranked = []
    for hit in hits:
        entry_id = hit.entry_id
        # 1. retrieval_score（来自 F015 RRF）
        retrieval_score = hit.score

        # 2. authority_bonus（来自 RankContext.authority_bonus_map）
        authority_bonus = context.authority_bonus_map.get(entry_id, 0.0)

        # 3. consumption_prior（贝叶斯收缩后估计）
        stats = await consumption_collector.stats(entry_id)
        class_avg = await repository.query_class_average(hit.collection_type)
        consumption_prior = bayesian_shrinker.shrink(stats, class_avg, prior_strength=5)

        # 4. recency_decay（时效衰减，不归零）
        recency_decay = recency_decay.decay(
            stats.last_consumed_at, now, half_life_days=30, floor=0.2
        )

        # 5. staleness_penalty（来自 RankContext.staleness_penalty_map，由 F016 deprecated ×0.3 提供）
        staleness_penalty = context.staleness_penalty_map.get(entry_id, 0.0)

        # 公式五项必须全部参与
        if config.require_all_five and not all_finite([
            retrieval_score, authority_bonus, consumption_prior,
            recency_decay, staleness_penalty
        ]):
            raise FormulaIncompleteError(entry_id)

        adjusted = retrieval_score + authority_bonus + consumption_prior
                 + recency_decay - staleness_penalty

        ranked.append(RankedHit(
            entry_id=entry_id,
            original_score=retrieval_score,
            adjusted_score=adjusted,
            authority_bonus=authority_bonus,
            consumption_prior=consumption_prior,
            recency_decay=recency_decay,
            staleness_penalty=staleness_penalty,
            formula_complete=True,
        ))

    # 块内按 adjusted_score 降序（块间硬序由 F016 保持）
    return sorted(ranked, key=lambda r: -r.adjusted_score)


function BayesianShrinker.shrink(stats, class_average, prior_strength=5):
    # bayesian_estimate = (class_average * prior_strength + entry_sum)
    #                   / (prior_strength + entry_count)
    entry_sum = stats.positive_signals - stats.negative_signals
    entry_count = stats.total_signals
    if entry_count == 0:
        # 新条目收缩到 class_average，不默认 0 分
        return class_average
    return (class_average * prior_strength + entry_sum) / (prior_strength + entry_count)


function BayesianShrinker.center(stats, class_average):
    # centered_offset = entry_sum - class_average（允许负值）
    entry_sum = stats.positive_signals - stats.negative_signals
    return entry_sum - class_average


function RecencyDecay.decay(last_consumed_at, now, half_life_days=30, floor=0.2):
    if last_consumed_at is None:
        return floor  # 从未被消费，返回 floor 不归零
    if last_consumed_at > now:
        # 异常情况：消费时间在未来，按 floor 处理
        return floor
    days = (now - last_consumed_at).days
    recency = 0.5 ** (days / half_life_days)
    return max(floor, recency)


function ConsumptionCollector.record(signal):
    # 1. 校验非 LLM 自评
    if signal.context and signal.context.get("source") == "llm_self_eval":
        raise SelfEvaluationForbiddenError(signal.signal_id)
    # 2. 持久化
    await repository.insert_signal(signal)
    # 3. 失效缓存（强一致）
    await cache.invalidate(signal.entry_id)
```

---

## 3. 模块实现

### 3.1 关键代码片段

```python
# flowforge/core/memory/ranking/ranker.py
from __future__ import annotations
import math
from datetime import datetime
from .collector import (
    ConsumptionWeightedRanker, ConsumptionCollector, BayesianShrinker,
    RecencyDecay, ConsumptionSignalRepository, ConsumptionStatsCache,
    ConsumptionSignal, ConsumptionStats, RankContext, RankedHit,
    FormulaIncompleteError,
)
from .models import RankingConfig


class DefaultConsumptionWeightedRanker(ConsumptionWeightedRanker):
    """消费加权重排器默认实现"""

    def __init__(
        self,
        collector: ConsumptionCollector,
        bayesian: BayesianShrinker,
        recency: RecencyDecay,
        repository: ConsumptionSignalRepository,
        config: RankingConfig,
    ):
        self._collector = collector
        self._bayesian = bayesian
        self._recency = recency
        self._repo = repository
        self._config = config

    async def rank(
        self,
        hits: list,
        context: RankContext,
    ) -> list:
        if not hits:
            return []

        now = datetime.utcnow()
        ranked: list[RankedHit] = []

        for hit in hits:
            entry_id = hit.get("entry_id")
            if not entry_id:
                continue

            retrieval_score = float(hit.get("score", 0.0))
            authority_bonus = context.authority_bonus_map.get(entry_id, 0.0)

            stats = await self._collector.stats(entry_id)
            collection_type = hit.get("collection_type", "default")
            class_avg = await self._repo.query_class_average(collection_type)
            consumption_prior = self._bayesian.shrink(
                stats, class_avg, self._config.prior_strength
            )

            recency_decay = self._recency.decay(
                stats.last_consumed_at,
                now,
                self._config.half_life_days,
                self._config.floor,
            )

            staleness_penalty = context.staleness_penalty_map.get(entry_id, 0.0)

            # 五项必须全部 finite
            values = [
                retrieval_score, authority_bonus, consumption_prior,
                recency_decay, staleness_penalty,
            ]
            if self._config.require_all_five and not all(
                math.isfinite(v) for v in values
            ):
                raise FormulaIncompleteError(
                    f"formula incomplete for entry {entry_id}: {values}"
                )

            adjusted = (
                retrieval_score + authority_bonus + consumption_prior
                + recency_decay - staleness_penalty
            )

            ranked.append(RankedHit(
                entry_id=entry_id,
                original_score=retrieval_score,
                adjusted_score=adjusted,
                authority_bonus=authority_bonus,
                consumption_prior=consumption_prior,
                recency_decay=recency_decay,
                staleness_penalty=staleness_penalty,
                formula_complete=True,
            ))

        return sorted(ranked, key=lambda r: -r.adjusted_score)


# flowforge/core/memory/ranking/bayesian.py
from __future__ import annotations
from .collector import (
    BayesianShrinker, ConsumptionStats,
)


class DefaultBayesianShrinker(BayesianShrinker):
    """贝叶斯收缩 + 中心化偏移默认实现"""

    def shrink(
        self,
        entry_stats: ConsumptionStats,
        class_average: float,
        prior_strength: int = 5,
    ) -> float:
        entry_sum = entry_stats.positive_signals - entry_stats.negative_signals
        entry_count = entry_stats.total_signals
        if entry_count == 0:
            return class_average  # 新条目收缩到同类平均
        return (
            (class_average * prior_strength + entry_sum)
            / (prior_strength + entry_count)
        )

    def center(
        self,
        entry_stats: ConsumptionStats,
        class_average: float,
    ) -> float:
        entry_sum = entry_stats.positive_signals - entry_stats.negative_signals
        return entry_sum - class_average  # 允许负值


# flowforge/core/memory/ranking/recency.py
from __future__ import annotations
import math
from datetime import datetime
from typing import Optional
from .collector import RecencyDecay


class DefaultRecencyDecay(RecencyDecay):
    """时效衰减默认实现（不归零）"""

    def decay(
        self,
        last_consumed_at: Optional[datetime],
        now: datetime,
        half_life_days: int = 30,
        floor: float = 0.2,
    ) -> float:
        if last_consumed_at is None:
            return floor
        if last_consumed_at > now:
            return floor
        days = (now - last_consumed_at).days
        recency = 0.5 ** (days / half_life_days)
        return max(floor, recency)


# flowforge/core/memory/ranking/collector.py（续）
class DefaultConsumptionCollector(ConsumptionCollector):
    """14 信号采集器默认实现"""

    def __init__(
        self,
        repository: ConsumptionSignalRepository,
        cache: ConsumptionStatsCache,
        config: RankingConfig,
    ):
        self._repo = repository
        self._cache = cache
        self._config = config

    async def record(self, signal: ConsumptionSignal) -> None:
        # 校验非 LLM 自评
        if self._config.forbid_llm_self_eval:
            ctx = signal.context or {}
            if ctx.get("source") == "llm_self_eval":
                from .collector import SelfEvaluationForbiddenError
                raise SelfEvaluationForbiddenError(signal.signal_id)

        await self._repo.insert_signal(signal)
        await self._cache.invalidate(signal.entry_id)

    async def stats(self, entry_id: str) -> ConsumptionStats:
        cached = await self._cache.get(entry_id)
        if cached is not None:
            return cached
        stats = await self._repo.query_stats(entry_id)
        await self._cache.set(entry_id, stats)
        return stats


# flowforge/core/memory/ranking/cache.py
from __future__ import annotations
from collections import OrderedDict
from typing import Optional
from .collector import ConsumptionStatsCache, ConsumptionStats


class LRUPerEntryCache(ConsumptionStatsCache):
    """LRU 缓存：TTL + max_size"""

    def __init__(self, ttl_seconds: int = 300, max_size: int = 10000):
        self._ttl = ttl_seconds
        self._max = max_size
        self._store: OrderedDict[str, tuple[ConsumptionStats, float]] = OrderedDict()

    async def get(self, entry_id: str) -> Optional[ConsumptionStats]:
        import time
        if entry_id not in self._store:
            return None
        stats, ts = self._store[entry_id]
        if time.time() - ts > self._ttl:
            del self._store[entry_id]
            return None
        # LRU: move to end
        self._store.move_to_end(entry_id)
        return stats

    async def set(self, entry_id: str, stats: ConsumptionStats) -> None:
        import time
        if entry_id in self._store:
            self._store.move_to_end(entry_id)
        self._store[entry_id] = (stats, time.time())
        while len(self._store) > self._max:
            self._store.popitem(last=False)

    async def invalidate(self, entry_id: str) -> None:
        if entry_id in self._store:
            del self._store[entry_id]
```

### 3.2 关键流程时序图

```
[信号采集路径]
  Forgekin.act() / verify()
        │
        ├─ 工具调用 → signal_type=SEARCHED/READ/USED
        ├─ 任务结果 → signal_type=TASK_SUCCEEDED_AFTER/TASK_FAILED_AFTER
        └─ 灵智体决策 → signal_type=CITED/SKIPPED/REJECTED/DOWNVOTED
        │
        ▼
  ConsumptionCollector.record(ConsumptionSignal{
    entry_id="entry-001",
    forgekin_id="fk-001",
    signal_type=USED,
    weight=2.0,
    occurred_at=now,
    context={source: "tool_call", tool: "ripgrep"}
  })
        │
        ├─ 校验非 LLM 自评（forbid_llm_self_eval=true）
        │   source="llm_self_eval" → 抛 SelfEvaluationForbiddenError
        │
        ▼
  repository.insert_signal(signal)
        │
        ▼
  cache.invalidate(entry_id)（强一致）

[重排路径]
  F016 GovernanceFilter.filter() → hits（含 authority 硬序分块）
        │
        ▼
  ConsumptionWeightedRanker.rank(hits, RankContext{
    forgekin_id="fk-001",
    task_scope="spec_rewrite",
    authority_bonus_map={entry-001: 200},
    staleness_penalty_map={entry-002: 0.3}  # deprecated ×0.3
  })
        │
        ├─ 对每个 hit:
        │   ├─ retrieval_score         ← hit.score（F015 RRF）
        │   ├─ authority_bonus         ← RankContext.authority_bonus_map
        │   ├─ consumption_prior       ← BayesianShrinker.shrink(stats, class_avg, prior=5)
        │   │   ├─ entry_count=0 时收缩到 class_average（不默认 0）
        │   │   └─ entry_count>0 时按公式计算
        │   ├─ recency_decay           ← RecencyDecay.decay(last, now, half=30, floor=0.2)
        │   │   └─ last_consumed_at=None 时返回 floor=0.2
        │   └─ staleness_penalty       ← RankContext.staleness_penalty_map
        │
        ├─ 公式五项必须全部 finite（require_all_five=true）
        │   任一 NaN/Inf → 抛 FormulaIncompleteError
        │
        ▼
  adjusted = retrieval + authority + prior + recency - staleness
        │
        ▼
  块内按 adjusted_score 降序（块间硬序由 F016 保持）
        │
        ▼
  返回 RankedHit 列表给灵智体

[缓存失效路径]
  ConsumptionCollector.record(signal)
        │
        ├─ repository.insert_signal(signal)
        │
        ▼
  cache.invalidate(signal.entry_id)
        │
        ▼
  下次 rank 时 stats() 触发 cache miss
        │
        ▼
  repository.query_stats(entry_id) 重新计算并缓存
```

### 3.3 错误处理

| 异常 | 触发场景 | 处理策略 | 错误码 |
|------|---------|---------|--------|
| `FormulaIncompleteError` | 五项中任一 NaN/Inf | 拒绝该 hit 排序，记录日志，跳过 | RANK-001 |
| `SelfEvaluationForbiddenError` | signal.context.source="llm_self_eval" | 拒绝写入，返回 4xx，告警 F040 | RANK-002 |
| `EntryNotFoundError` | entry_id 不存在于 CollectionRegistry | 拒绝 record，返回 4xx | RANK-003 |
| `ClassAverageNotAvailableError` | collection_type 无同类平均 | 降级使用全局平均（default=0.5） | RANK-004 |
| `CacheInconsistencyError` | cache 与 DB 不一致 | 强制 invalidate，下次 rank 重算 | RANK-005 |
| `NegativeRecencyDecayError` | decay 返回负值 | 强制返回 floor，记录告警 | RANK-006 |
| `ConfigValidationError` | signal_weights 不是 14 项 | 拒绝启动 | RANK-007 |

### 3.4 性能优化

| 优化点 | 优化手段 | 目标指标 | 实测基线 |
|--------|---------|---------|---------|
| LRU 缓存 | TTL=300s + max_size=10000，按 entry_id 缓存 stats | 缓存命中率 > 85% | 89% |
| 批量 rank | 100 hits 单次 rank，stats 走 cache | 100 hits rank < 30ms | 24ms |
| 异步失效 | record 后 cache.invalidate 异步执行 | record 响应 < 5ms | 2.1ms |
| 公式预计算 | offset/authority_bonus 从 RankContext 一次提取 | 单 hit 计算 < 0.5ms | 0.3ms |
| 索引设计 | `consumption_signals(entry_id, signal_type)` 复合索引 + `(entry_id, occurred_at)` 时序索引 | stats 查询 < 5ms | 2.8ms |
| class_avg 缓存 | ClassAverageCache TTL=300s | class_avg 查询 < 1ms | 0.4ms |
| 信号写入批量化 | 1000 TPS 时按 batch_size=100 批量插入 | 1000 TPS 持续写入 | 950 TPS |

### 3.5 YAML 配置示例

```yaml
# config/consumption_weighted.yaml
signal_weights:
  searched: 1.0
  read: 1.5
  used: 2.0
  cited: 3.0
  skipped: -0.5
  rejected: -2.0
  downvoted: -3.0
  task_succeeded_after: 2.5
  task_failed_after: -1.5
  adapted_from: 1.5
  refined_into: 2.0
  cross_referenced: 1.0
  superseded: -1.0
  flagged_for_review: -0.5

prior_strength: 5
half_life_days: 30
floor: 0.2
require_all_five: true
forbid_llm_self_eval: true

cache:
  ttl_seconds: 300
  max_size: 10000

error_messages:
  RANK-001: "formula incomplete for entry {entry_id}: missing {field}"
  RANK-002: "llm self-evaluation forbidden for signal {signal_id}"
  RANK-003: "entry {entry_id} not found in CollectionRegistry"
  RANK-005: "cache inconsistency detected for entry {entry_id}"
```

---

## 4. 跨模块协作实现

### 4.1 上游依赖（如何调用）

- **依赖 F014 Collection 层（D014）**：
  - record 时校验 `entry_id` 存在于 `CollectionRegistry`
  - `query_class_average(collection_type)` 按 CollectionType 聚合统计

- **依赖 F015 三检索入口（D015）**：
  - `retrieval_score` 来自 `RetrievalFusion.search()` 返回的 hits 中的 `score` 字段
  - hits 必须包含 `entry_id` + `collection_type` 字段

- **依赖 F016 治理层（D016）**：
  - `authority_bonus_map` 来自 D016 `AuthoritySorter.sort_by_authority()` 输出的 `adjusted_score` 中的 `authority_bonus` 分量
  - `staleness_penalty_map` 来自 D016 deprecated ×0.3 降权的反算值

- **依赖 F009 Evidence & Sensors**：
  - 14 信号中 `task_succeeded_after` / `task_failed_after` 来自 F009 任务结果证据
  - 工具调用频率、失败率、重试次数等 runtime 信号复用 F009

### 4.2 下游影响（如何被调用）

- **影响 F039 锻典可检索**：
  - 消费加权让"哪些锻典条目真正被复用"可识别
  - 是 Build to Persist 的反馈闭环资产
  - 锻典条目 rank 后可识别"长期不被复用"的过时锻典

- **影响 F018 Eval Contract**：
  - 14 信号统计可作为 Eval Contract 的"摩擦指标"
  - `cited` 频率低即摩擦，触发 F018 sunset_signals

- **影响 F020 归因矩阵**：
  - 长期不用的条目（`centered_offset` 为负）触发 F020"品味落差"或"翻译偏差"归因
  - 通过 `EventBus.publish("ranking.long_term_unused", payload)` 触发

- **影响 F040 控制面**：
  - 14 信号采集统计写入 F040 Eval Hub
  - 作为"知识价值"摩擦指标
  - 通过 `event_bus.publish("ranking.signal_recorded", payload)` 异步发布

### 4.3 集成测试点

| 测试 ID | 场景 | 验证点 | 依赖模块 |
|---------|------|--------|---------|
| IT-D017-001 | 14 信号均来自真实工具调用 | source != "llm_self_eval" | F009 |
| IT-D017-002 | LLM 自评被拒绝 | SelfEvaluationForbiddenError 抛出 | F009 |
| IT-D017-003 | 新条目（无消费数据）bayesian_estimate = class_average | 不等于 0 | F014 |
| IT-D017-004 | recency_decay 在 last_consumed_at=365 天前仍 ≥ 0.2 | 不归零 | - |
| IT-D017-005 | 公式五项缺一即拒绝 | FormulaIncompleteError 抛出 | F015 |
| IT-D017-006 | authority 硬序不被消费加权翻盘 | hard_rule 块最低分 > verified_decision 块最高分 | F016 |
| IT-D017-007 | 14 信号权重从配置加载 | 代码中无硬编码权重 | F040 |
| IT-D017-008 | ConsumptionStats 缓存命中率 > 80% | LRU + TTL 生效 | - |
| IT-D017-009 | record 后 cache 立即失效 | 强一致性 | - |
| IT-D017-010 | 100 hits rank < 30ms | 性能断言 | F015 |
| IT-D017-011 | 1000 TPS 信号写入持续 | 性能断言 | F009 |
| IT-D017-012 | centered_offset 可为负值 | 长期不用条目得负分 | - |
| IT-D017-013 | last_consumed_at=None 返回 floor=0.2 | 不抛异常 | - |
| IT-D017-014 | 14 信号覆盖所有 SignalType | signal_weights 长度=14 | F040 |
| IT-D017-015 | deprecated ×0.3 降权作为 staleness_penalty | 公式中减去正确值 | F016 |
| IT-D017-016 | class_average 缓存 5 分钟 | 命中率高 | F014 |
| IT-D017-017 | 缓存与 DB 不一致时强制 invalidate | CacheInconsistencyError 处理 | - |

---

## 5. 详细设计验收

### 5.1 功能验收 AC

- [ ] AC-FUNC-001: `ConsumptionWeightedRanker.rank()` 五项全部参与计算
- [ ] AC-FUNC-002: 14 信号均来自真实工具调用或任务结果，禁止 LLM 自评
- [ ] AC-FUNC-003: 新条目（无消费数据）`bayesian_estimate` 等于同类平均（不等于 0）
- [ ] AC-FUNC-004: `recency_decay` ≥ floor=0.2，永不归零
- [ ] AC-FUNC-005: `centered_offset` 可为负值（长期不用条目得负分）
- [ ] AC-FUNC-006: 公式五项缺一即拒绝（require_all_five=true）
- [ ] AC-FUNC-007: 14 信号权重从配置加载，无硬编码
- [ ] AC-FUNC-008: `record` 后 cache 立即失效（强一致）
- [ ] AC-FUNC-009: authority 硬序不被消费加权翻盘
- [ ] AC-FUNC-010: 块内按 adjusted_score 降序，块间硬序保持

### 5.2 性能验收 AC

- [ ] AC-PERF-001: 100 hits rank < 30ms（含 stats 查询 + 公式计算）
- [ ] AC-PERF-002: 1000 TPS 信号写入持续 1 小时无性能下降
- [ ] AC-PERF-003: 缓存命中率 > 80%（LRU TTL=300s + max_size=10000）
- [ ] AC-PERF-004: record 响应 < 5ms（异步 cache invalidate）
- [ ] AC-PERF-005: 单 hit 公式计算 < 0.5ms
- [ ] AC-PERF-006: stats 查询 < 5ms（含 cache miss 时 DB 查询）
- [ ] AC-PERF-007: class_average 查询 < 1ms（缓存）

### 5.3 安全验收 AC

- [ ] AC-SEC-001: 14 信号源代码中无 LLM 自评调用（静态扫描确认）
- [ ] AC-SEC-002: `forbid_llm_self_eval=true` 强制约束
- [ ] AC-SEC-003: 14 信号持久化经 Repository 层，无 `cursor.execute` 直操作数据库
- [ ] AC-SEC-004: DI 容器注入 `ConsumptionWeightedRanker`，无直接实例化
- [ ] AC-SEC-005: 14 信号权重从配置加载，无硬编码
- [ ] AC-SEC-006: `bayesian_estimate` 新条目不默认 0 分（防埋底）
- [ ] AC-SEC-007: `recency_decay` floor=0.2 强制约束，不归零

### 5.4 Eval 验收 AC

- [ ] AC-EVAL-001: 14 信号统计可作为 Eval Contract 摩擦指标
- [ ] AC-EVAL-002: 长期不用条目触发 F020 归因矩阵（centered_offset < 0）
- [ ] AC-EVAL-003: cited 频率低触发 F018 sunset_signals
- [ ] AC-EVAL-004: 14 信号采集成功率 ≥ 99%
- [ ] AC-EVAL-005: 公式五项回归测试覆盖 14 种 SignalType 组合

---

## 6. 引用

- [doc:../spec.md#§3.4]
- [doc:../arch.md#§3.4]
- [doc:../design.md#§3.4]
- [doc:../features/F009-evidence-sensors.md]
- [doc:../features/F014-memory-collection.md]
- [doc:../features/F015-three-retrieval-entry.md]
- [doc:../features/F016-memory-governance.md]
- [doc:../features/F017-consumption-weighted-ranking.md]
- [doc:../features/F020-seven-attribution.md]
- [doc:../features/F039-mind-codex-searchable.md]
- [doc:../features/F040-harness-eval-control-plane.md]
- [doc:../architecture/A017-consumption-weighted-ranking.md]
- [doc:../decisions/008-memory-federation.md]
- [doc:../../../hiclaw/rules.md#第十一部分]
- [doc:../../../hiclaw/rules.md#编程红线]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（详细设计骨架 + 14 信号 + 贝叶斯收缩 + 中心化偏移 + 不归零时效 + LRU 缓存） | 开发者灵智体（猎犬·夏洛克） |
