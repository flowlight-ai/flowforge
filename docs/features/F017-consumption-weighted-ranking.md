# Feature F017: 消费加权排序

> **状态**: draft
> **版本**: v0.1
> **依赖**: [doc:review/review.md#RA-027] + [doc:roleagent.md#第4章]
> **关联 ADR**: [doc:decisions/008-memory-federation.md]
> **类型**: memory
> **创建日期**: 2026-07-17
> **负责人**: 架构师灵智体

---

## 1. 概述（Overview）

消费加权排序是 roleagent.md 第 4 章的核心创新：用灵智体（Forgekin）真实行为（搜了/读了/用了）判断知识价值，不用 LLM 自评打分。本 Feature 实现 14 个行为指标汇聚、调整后得分公式、贝叶斯收缩、中心化偏移、分数时效衰减——防止冷启动偏热点和长尾保护。

公式：`调整后得分 = 融合检索得分 + 权威加成 + 消费先验 + 时效衰减 - 过时惩罚`

## 2. 动机（Motivation）

`[doc:review/review.md#RA-027]` 指出：roleagent.md 第 4 章核心创新——用 agent 真实行为判断知识价值，不用 LLM 自评打分。14 个行为指标汇聚成消费加权排序。v7.0 完全无此反馈闭环，记忆排序靠向量相似度 + 时间衰减，无法识别"长期没被使用的知识应降权"。

`[doc:review/review.md#RA-028]` 进一步指出：贝叶斯收缩 + 中心化偏移 + 分数时效衰减缺失，导致新技能/新教训可能因向量距离远而永远排不到前面。不做这个 Feature，F016 治理三要素的权威加成无消费反馈，F039 灵典可检索知识库无法识别"哪些锻典条目真正被复用"。这是 Build to Persist 的反馈闭环资产。

## 3. 详细设计（Detailed Design）

### 3.1 数据模型

```python
class ConsumptionSignal(BaseModel):
    entry_id: str
    forgekin_id: str
    signal_type: Literal[
        "searched", "read", "used", "cited",       # 正信号
        "skipped", "rejected", "downvoted",         # 负信号
        "task_succeeded_after", "task_failed_after"  # 结果信号
    ]
    weight: float                         # 信号权重
    occurred_at: datetime

class ConsumptionStats(BaseModel):
    entry_id: str
    total_signals: int
    positive_signals: int
    negative_signals: int
    bayesian_estimate: float              # 贝叶斯收缩后的估计
    centered_offset: float                # 中心化偏移
    recency_score: float                  # 时效衰减
```

### 3.2 核心接口

```python
class ConsumptionCollector:
    async def record(self, signal: ConsumptionSignal) -> None: ...
    async def stats(self, entry_id: str) -> ConsumptionStats: ...

class ConsumptionWeightedRanker:
    """消费加权排序"""
    def rank(self, hits: list[RetrievalHit], context: RankContext) -> list[RetrievalHit]: ...
```

### 3.3 关键算法

- **14 行为指标**：searched/read/used/cited/skipped/rejected/downvoted/task_succeeded_after 等，权重外置。
- **贝叶斯收缩**：新条目无消费数据时，估计值向同类平均收缩，避免被埋底。
- **中心化偏移**：减去同类知识平均消费率，允许负信号（长期不用的条目得负分）。
- **分数时效衰减**：旧条目近期无消费则衰减，但不归零（保留长尾）。
- **最终公式**：`adjusted = retrieval_score + authority_bonus + consumption_prior + recency_decay - staleness_penalty`。

### 3.4 配置外置（YAML 示例）

```yaml
consumption_weighted:
  signal_weights:
    searched: 0.1
    read: 0.2
    used: 0.4
    cited: 0.5
    skipped: -0.1
    rejected: -0.3
    downvoted: -0.5
    task_succeeded_after: 0.6
    task_failed_after: -0.4
  bayesian:
    prior_strength: 5                    # 收缩强度
    same_class_average_window: 30        # 同类平均窗口
  recency:
    half_life_days: 30
    floor: 0.2                           # 不归零
  staleness_penalty_days: 90
```

## 4. 验收标准（Acceptance Criteria）

- [ ] AC-1: 14 行为指标均可采集与加权
- [ ] AC-2: 贝叶斯收缩让新条目不被埋底
- [ ] AC-3: 中心化偏移允许负信号（长期不用得负分）
- [ ] AC-4: 时效衰减不归零（保留长尾）
- [ ] AC-5: 最终公式五项全部参与计算

## 5. 测试策略

### 5.1 单元测试

- 14 信号采集、贝叶斯收缩、中心化偏移、时效衰减、最终公式。

### 5.2 集成测试

- 接入 F015 三检索入口、F016 治理三要素、F039 灵典可检索。

### 5.3 E2E 测试（必须遵守 T1-T8 测试铁律）

- 真实厂商灵智体在多任务中产生消费信号，验证排序按消费加权正确变化。**遵守 T1-T8**：真实 LLM、真实数据、真实工具调用。

## 6. 引用

- [doc:roleagent.md#第4章]
- [doc:review/review.md#第八章/RA-027]
- [doc:review/review.md#第八章/RA-028]
- [doc:decisions/008-memory-federation.md]
- [doc:design/naming-contract.md#2.5]（灵忆 EchoStore）
- [doc:features/F014-memory-collection.md]
- [doc:features/F015-three-retrieval-entry.md]
- [doc:features/F016-memory-governance.md]
- [doc:features/F039-mind-codex-searchable.md]
- [doc:project_rules.md#T1-T8]
