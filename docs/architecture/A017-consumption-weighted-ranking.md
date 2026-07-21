# A017: 消费加权排序架构设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.4]（FR-CORE-004）
> **对应 arch.md**: [doc:../arch.md#§3.4]
> **对应 design.md**: [doc:../design.md#§3.4]（待创建）
> **对应 Feature**: [doc:../features/F017-consumption-weighted-ranking.md]（同号 Feature 级 SRS）
> **对应详细设计**: [doc:../design/D017-consumption-weighted-ranking.md]（待创建，同号 Feature 级 SDD）
> **依赖 ADR**: [doc:../decisions/008-memory-federation.md]

---

## 1. 架构上下文

### 1.1 架构问题

记忆排序的核心问题是"如何判断知识价值"。v7.0 靠向量相似度 + 时间衰减，导致两类架构故障：

1. **冷启动偏热点**：新条目无消费数据，向量距离远导致永远排不到前面，"长期没被使用的知识"反而排在前面。
2. **LLM 自评失真**：若用 LLM 自评打分，会出现"模型说自己好"，与真实使用脱节。

roleagent.md 第 4 章核心创新：**用Forgekin真实行为（搜了/读了/用了）判断知识价值，不用 LLM 自评打分**。本架构解决的核心问题：**如何在 L4 消费排序层实现 14 行为指标汇聚 + 调整后得分公式 + 贝叶斯收缩 + 中心化偏移 + 分数时效衰减**，让冷启动条目不被埋底、长尾条目不归零、长期不用条目得负分。

### 1.2 架构约束

- **单向依赖约束**：消费排序层依赖 F014/F015/F016，禁止被它们反向依赖。
- **行为信号约束**：14 行为指标必须来自真实工具调用 / 真实读屏 / 真实任务结果，禁止 LLM 自评。
- **贝叶斯收缩约束**：新条目无消费数据时必须向同类平均收缩，禁止默认 0 分（防止被埋底）。
- **不归零约束**：时效衰减必须设 floor（默认 0.2），禁止旧条目归零（保留长尾）。
- **配置驱动约束**：14 信号权重、贝叶斯参数、时效半衰期外置 YAML。

### 1.3 架构影响

- **对 F014 Collection 层**：entry_id 是 14 行为信号的聚合主键，F014 必须保证 entry_id 全局唯一。
- **对 F015 三检索入口**：RRF 融合后的 score 是消费加权公式的"融合检索得分"项。
- **对 F016 治理层**：deprecated ×0.3 降权是消费加权公式中"过时惩罚"的输入。
- **对 F039 蒸馏知识库可检索**：消费加权让"哪些蒸馏知识库条目真正被复用"可识别，是 Build to Persist 的反馈闭环资产。
- **对 F040 控制面**：14 信号采集统计写入 F040 Eval Hub，作为"知识价值"摩擦指标。

---

## 2. 架构设计

### 2.1 组件架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│ 上层调用方                                                           │
│  Forgekin.chat  F039 CodexSearch  F040 EvalHub                   │
└──────────┬──────────────────────────────────────────────────────────┘
           │ ConsumptionWeightedRanker.rank(hits, context)
           ▼
┌─────────────────────────────────────────────────────────────────────┐
│ L4: ConsumptionWeightedRanker（消费加权重排器）                      │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ 公式:                                                       │  │
│  │ adjusted = retrieval_score                                  │  │
│  │          + authority_bonus         (从 F016 治理层)         │  │
│  │          + consumption_prior       (贝叶斯收缩后估计)       │  │
│  │          + recency_decay           (时效衰减，floor=0.2)    │  │
│  │          - staleness_penalty       (过时惩罚)               │  │
│  └─────────────────────────────────────────────────────────────┘  │
└───┬──────────────────┬──────────────────┬──────────────────────────┘
    │ stats             │ record           │ bayesian
    ▼                  ▼                  ▼
┌────────────┐  ┌────────────┐    ┌──────────────────┐
│Consumption │  │Consumption │    │ BayesianShrinker │
│Collector   │  │StatsCache  │    │ + CenteredOffset │
│（14 信号采集）│  │（统计缓存）│    │ + RecencyDecay   │
└─────┬──────┘  └─────┬──────┘    └────────┬─────────┘
      │ record         │                    │
      ▼                ▼                    ▼
┌─────────────────────────────────────────────────────┐
│ ConsumptionSignalRepository（禁直操作数据库）       │
│  consumption_signals 表 / consumption_stats 表     │
└─────────────────────────────────────────────────────┘
```

### 2.2 关键架构决策

- **决策 1：14 信号而非 LLM 自评**。14 行为指标（searched/read/used/cited/skipped/rejected/downvoted/task_succeeded_after/task_failed_after 等）来自真实工具调用与任务结果，禁止用 LLM 给条目打分。理由：roleagent.md 第 4 章核心创新，避免"模型说自己好"的自评失真。
- **决策 2：贝叶斯收缩防止冷启动埋底**。新条目无消费数据时，估计值向同类平均收缩（prior_strength=5），不默认 0 分。理由：新条目向量距离远，若再用 0 消费分会被双重惩罚。
- **决策 3：中心化偏移允许负信号**。减去同类知识平均消费率，让"长期不用"的条目得负分。理由：纯相对排序无法识别"该 Collection 整体都没人用"的情况，中心化偏移让绝对低消费条目下沉。
- **决策 4：时效衰减不归零**。半衰期 30 天 + floor=0.2，旧条目近期无消费则衰减但不归零。理由：长尾知识可能突然被需要（如 3 个月前的 ADR 突然相关），归零会让它永远排不上。
- **决策 5：公式五项全部参与**。`adjusted = retrieval + authority_bonus + consumption_prior + recency_decay - staleness_penalty`，五项缺一不可。理由：单维度排序都会偏（如只看消费会偏向热点，只看时效会偏向新条目）。
- **决策 6：消费统计缓存**。14 信号汇聚结果缓存到 `ConsumptionStatsCache`，每次重排不重算。理由：高频检索场景下重算 14 信号统计会拖慢到秒级。

### 2.3 架构不变量

- 14 行为信号必须来自真实工具调用与任务结果，必须禁止 LLM 自评打分。
- 新条目（无消费数据）的 bayesian_estimate 必须向同类平均收缩，必须不默认 0 分。
- recency_decay 必须 ≥ floor（默认 0.2），必须不归零。
- 调整后得分公式五项必须全部参与计算，缺一即拒绝。
- 14 信号权重必须从配置加载，禁止硬编码。
- ConsumptionStats 必须缓存，重排时不重算统计。

---

## 3. 模块设计

### 3.1 模块边界

| 模块 | 路径 | 职责 | 对外暴露 |
|------|------|------|---------|
| ConsumptionCollector | `flowforge/core/memory/ranking/collector.py` | 14 信号采集与持久化 | `record / stats` |
| ConsumptionWeightedRanker | `flowforge/core/memory/ranking/ranker.py` | 消费加权重排 | `rank` |
| BayesianShrinker | `flowforge/core/memory/ranking/bayesian.py` | 贝叶斯收缩 + 中心化偏移 | `shrink / center` |
| RecencyDecay | `flowforge/core/memory/ranking/recency.py` | 时效衰减（不归零） | `decay` |
| ConsumptionStatsCache | `flowforge/core/memory/ranking/cache.py` | 统计缓存 | `get / invalidate` |
| RankingConfigLoader | `flowforge/core/memory/ranking/config.py` | YAML 配置加载 | `load_ranking_config` |

### 3.2 接口契约

```python
from abc import ABC, abstractmethod
from typing import Literal
from datetime import datetime
from pydantic import BaseModel
from enum import Enum


class SignalType(str, Enum):
    SEARCHED = "searched"
    READ = "read"
    USED = "used"
    CITED = "cited"
    SKIPPED = "skipped"
    REJECTED = "rejected"
    DOWNVOTED = "downvoted"
    TASK_SUCCEEDED_AFTER = "task_succeeded_after"
    TASK_FAILED_AFTER = "task_failed_after"
    # 共 14 个，详见配置


class ConsumptionSignal(BaseModel):
    signal_id: str
    entry_id: str
    forgekin_id: str
    signal_type: SignalType
    weight: float
    occurred_at: datetime


class ConsumptionStats(BaseModel):
    entry_id: str
    total_signals: int
    positive_signals: int
    negative_signals: int
    bayesian_estimate: float       # 贝叶斯收缩后估计
    centered_offset: float         # 中心化偏移
    recency_score: float           # 时效衰减（≥ floor）
    staleness_penalty: float       # 过时惩罚


class RankContext(BaseModel):
    forgekin_id: str
    task_scope: str
    authority_bonus_map: dict      # entry_id → authority_bonus（来自 F016）


class ConsumptionCollector(ABC):
    @abstractmethod
    async def record(self, signal: ConsumptionSignal) -> None:
        """记录 14 信号之一；必须来自真实工具调用或任务结果"""

    @abstractmethod
    async def stats(self, entry_id: str) -> ConsumptionStats:
        """查询条目消费统计；走缓存"""


class ConsumptionWeightedRanker(ABC):
    @abstractmethod
    async def rank(
        self, hits: list, context: RankContext
    ) -> list:
        """
        调整后得分公式：
        adjusted = retrieval_score
                 + authority_bonus
                 + consumption_prior
                 + recency_decay
                 - staleness_penalty
        五项缺一即拒绝
        """


class BayesianShrinker(ABC):
    @abstractmethod
    def shrink(
        self, entry_stats: ConsumptionStats, class_average: float, prior_strength: int = 5
    ) -> float:
        """
        bayesian_estimate = (class_average * prior_strength + entry_sum)
                          / (prior_strength + entry_count)
        新条目 entry_count=0 时收缩到 class_average
        """

    @abstractmethod
    def center(self, entry_stats: ConsumptionStats, class_average: float) -> float:
        """centered_offset = entry_sum - class_average（允许负值）"""


class RecencyDecay(ABC):
    @abstractmethod
    def decay(
        self, last_consumed_at: datetime, now: datetime, half_life_days: int = 30, floor: float = 0.2
    ) -> float:
        """
        recency = max(floor, 0.5 ** ((now - last_consumed_at).days / half_life_days))
        必须不归零
        """
```

### 3.3 数据流

```
[信号采集路径]
  Forgekin.act / verify
        │
        ├─ 工具调用 → searched/read/used
        ├─ 任务结果 → task_succeeded_after / task_failed_after
        └─ Forgekin决策 → cited/skipped/rejected/downvoted
        │
        ▼
  ConsumptionCollector.record(ConsumptionSignal{entry_id, signal_type, weight})
        │
        ▼
  ConsumptionSignalRepository.insert
        │
        ▼
  ConsumptionStatsCache.invalidate(entry_id)  ← 失效缓存

[重排路径]
  F016 GovernanceFilter.filter → hits（含 authority 硬序分块）
        │
        ▼
  ConsumptionWeightedRanker.rank(hits, RankContext{authority_bonus_map})
        │
        ├─ 对每个 hit:
        │    ├─ retrieval_score         ← 来自 F015 RRF
        │    ├─ authority_bonus         ← 来自 RankContext
        │    ├─ consumption_prior       ← BayesianShrinker.shrink(stats, class_avg)
        │    ├─ recency_decay           ← RecencyDecay.decay(last, now, floor=0.2)
        │    └─ staleness_penalty       ← 来自 F016 deprecated ×0.3
        │
        ▼
  adjusted = retrieval + authority + prior + recency - staleness
        │
        ▼
  按 adjusted 降序排列（块内排序，块间由 F016 硬序保持）
        │
        ▼
  返回给Forgekin
```

---

## 4. 跨模块协作

### 4.1 上游依赖

- 依赖 **F014 Collection 层**：entry_id 必须存在于 CollectionRegistry。
- 依赖 **F015 三检索入口**：retrieval_score 来自 RRF 融合结果。
- 依赖 **F016 治理层**：authority_bonus 与 staleness_penalty 来自治理层。
- 依赖 **F009 Evidence & Sensors**：14 信号中 task_succeeded_after/task_failed_after 来自 F009 任务结果证据。

### 4.2 下游影响

- 影响 **F039 蒸馏知识库可检索**：消费加权让"哪些蒸馏知识库条目真正被复用"可识别，是 Build to Persist 的反馈闭环。
- 影响 **F018 Eval Contract**：14 信号统计可作为 Eval Contract 的"摩擦指标"（如 cited 频率低即摩擦）。
- 影响 **F020 归因矩阵**：长期不用的条目（centered_offset 为负）触发 F020"品味落差"或"翻译偏差"归因。
- 影响 **F040 控制面**：14 信号采集统计写入 F040 Eval Hub，作为"知识价值"摩擦指标。

### 4.3 跨模块不变量

- 14 信号必须来自真实工具调用或任务结果，必须禁止 LLM 自评。
- consumption_prior 必须经贝叶斯收缩，新条目必须不默认 0 分。
- recency_decay 必须 ≥ floor，必须不归零。
- 调整后得分公式五项必须全部参与，缺一即拒绝。
- ConsumptionStatsCache 失效必须在 record 之后立即执行（强一致）。
- authority 硬序必须不可被消费加权翻盘（块间硬序，块内消费加权）。

---

## 5. 架构验收

### 5.1 架构契约验收

- [ ] AC-1: 单向依赖通过——`flowforge/core/memory/ranking/` 不 import F015/F016/F018/F020/F039/F040 任何模块。
- [ ] AC-2: DI 容器注入通过——`ConsumptionWeightedRanker` 通过 `inject("consumption_ranker")` 获取。
- [ ] AC-3: Repository 层通过——14 信号持久化经 Repository，不直操作数据库。
- [ ] AC-4: 配置驱动通过——14 信号权重 / 贝叶斯参数 / 时效半衰期从 `config/consumption_weighted.yaml` 加载。
- [ ] AC-5: 统计缓存覆盖所有 entry_id，重排时不重算统计。

### 5.2 架构不变量验收

- [ ] AC-6: 14 信号源代码中无 LLM 自评调用（静态扫描确认）。
- [ ] AC-7: 新条目（无消费数据）的 bayesian_estimate 等于同类平均（不等于 0）。
- [ ] AC-8: recency_decay 在 last_consumed_at=365 天前时仍 ≥ 0.2（不归零）。
- [ ] AC-9: 调整后得分公式五项全部参与计算（断言遍历每个 hit）。
- [ ] AC-10: authority 硬序不被消费加权翻盘（hard_rule 块内最低分仍高于 verified_decision 块内最高分）。
- [ ] AC-11: 14 信号权重从配置加载，代码中无硬编码权重值。

---

## 6. 引用

- [doc:../spec.md#§3.4]
- [doc:../arch.md#§3.4]
- [doc:../features/F014-memory-collection.md]
- [doc:../features/F015-three-retrieval-entry.md]
- [doc:../features/F016-memory-governance.md]
- [doc:../features/F017-consumption-weighted-ranking.md]
- [doc:../features/F020-seven-attribution.md]
- [doc:../features/F039-mind-codex-searchable.md]
- [doc:../decisions/008-memory-federation.md]
- [doc:../../../hiclaw/rules.md#第十一部分]
- [doc:../../../hiclaw/rules.md#编程红线]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（架构骨架 + 14 信号 + 贝叶斯收缩 + 中心化偏移 + 不归零时效） | 架构师 Forgekin（猫头鹰·鲁班） |
