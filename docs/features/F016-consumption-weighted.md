---
feature_ids: [F016]
related_features: [F014, F015, F017]
topics: [memory, ranking, consumption-weighted, recency, access-frequency, relevance]
doc_kind: spec
created: 2026-07-21
---

# F016: 消费加权评分（Consumption Weighted Scoring）

> **状态**: spec | **负责人**: 架构师灵智体 | **优先级**: P0
> **依赖 ADR**: [doc:decisions/008-memory-federation.md]
> **依据**: operator 7 条不可妥协原则 + roleagent.md 第4章 多域记忆联邦
> **关联 VISION**: [doc:VISION.md#3]（持续身份：灵忆 EchoStore 提供 access_count 根信号）

## 1. 上下文

### 1.1 问题陈述

`[doc:roleagent.md#第4章]` 核心创新：**用 agent 真实行为（revealed preference）判断知识价值，不用 LLM 自评打分**。LLM 自评集中在 0.6-0.85 成功区间，几乎没有负样本，根信号本身有毒；用 LLM 在线打分排序延迟高、成本高、不可审计。

FlowForge 需要一个**纯函数 ranker**，把 F015 三检索入口返回的候选集按消费加权公式排序，作为检索管线最后一环：`collection → retriever → ConsumptionWeightedRanker → agent context`。该 ranker 必须读取 F014 `MemoryEntry` 的 `access_count` / `created_at` / `importance` 字段，形成消费反馈闭环。

### 1.2 当前痛点

- **LLM 自评打分根信号有毒**：自评集中在 0.6-0.85 成功区间，无负样本，违反 roleagent.md 第4章原则
- **无消费反馈闭环**：知识被搜到后是否被用、被用多少次，系统完全不知道，无法据此调整排序
- **静态打分**：仅按 `importance` 排序，忽略 recency 与 access_frequency，老知识永远排在前面
- **不可审计**：LLM 在线打分是黑盒，无法解释为什么 A 排在 B 前面

### 1.3 不做的影响

- 违反 `[doc:roleagent.md#第4章]` "不用 LLM 自评打分"原则
- F015 检索结果无排序依据，agent context 被低价值条目污染
- F014 的 `access_count` / `last_accessed` 信号采集无消费方，闭环断裂
- 治理层（F017）的 `apply_retention` / `apply_decay` 失去排序依据，淘汰策略失准

## 2. 决策

### 2.1 核心设计

落地 `ConsumptionWeightedRanker` 纯函数 ranker，四维加权合 1.0：

```
score = importance * 0.4 + recency * 0.3 + access_frequency * 0.2 + relevance * 0.1
recency          = 1.0 - min(age_seconds / 86400, 1.0)   # 24 小时衰减窗口
access_frequency = min(access_count / 10, 1.0)            # 10 次访问饱和
relevance        = query_context.get("relevance", 0.5)
```

设计要点：

- **四维权重合 1.0**：`importance*0.4 + recency*0.3 + access_frequency*0.2 + relevance*0.1`，importance 占主导（权威等级简化形态），recency 次之（避免老知识垄断），access_frequency 反映真实消费（revealed preference），relevance 由调用方注入（默认 0.5）
- **纯函数**：`rank()` 不修改 collection，不修改 entry，仅返回排序后的列表
- **稳定排序**：Python `sort` 稳定，ties（罕见，因 timestamp 不同）保插入顺序
- **24 小时 recency 窗口**：`_RECENCY_WINDOW_SECONDS = 86400.0`，超过 1 天 recency 项为 0
- **10 次访问饱和**：`_FREQUENCY_NORMALIZER = 10.0`，`access_count >= 10` 后 frequency 项饱和为 1.0
- **relevance 默认 0.5**：调用方未注入时取 `_DEFAULT_RELEVANCE = 0.5`，避免 0 值拉低总分
- **检索管线最后一环**：`collection → retriever → ConsumptionWeightedRanker → agent context`，ranker 不主动检索，只对已检索出的候选集排序

### 2.2 关键接口

```python
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from flowforge.core.memory.collection import MemoryEntry


# 四维权重（合 1.0）
_WEIGHT_IMPORTANCE = 0.4
_WEIGHT_RECENCY = 0.3
_WEIGHT_FREQUENCY = 0.2
_WEIGHT_RELEVANCE = 0.1

# Recency 窗口：24 小时。超过一天 recency 项为 0。
_RECENCY_WINDOW_SECONDS = 86400.0
# Frequency 归一化：10 次访问使 frequency 项饱和。
_FREQUENCY_NORMALIZER = 10.0
# 调用方未注入 relevance 时的默认值。
_DEFAULT_RELEVANCE = 0.5


class ConsumptionWeightedRanker:
    """Rank memory entries by the consumption-weighted score."""

    def rank(
        self,
        entries: list[MemoryEntry],
        query_context: dict[str, Any],
    ) -> list[MemoryEntry]:
        """Return entries sorted by descending consumption-weighted score.

        Formula:
            score = importance * 0.4
                  + recency * 0.3
                  + access_frequency * 0.2
                  + relevance * 0.1

        Ties (rare, since timestamps differ) preserve insertion order via
        Python's stable sort. The ranker is a pure function — it does not
        touch the collection or mutate entries.
        """
        relevance = float(query_context.get("relevance", _DEFAULT_RELEVANCE))
        now = datetime.now(timezone.utc)
        scored: list[tuple[float, MemoryEntry]] = []
        for entry in entries:
            age_seconds = max(0.0, (now - entry.created_at).total_seconds())
            recency = 1.0 - min(age_seconds / _RECENCY_WINDOW_SECONDS, 1.0)
            access_frequency = min(
                entry.access_count / _FREQUENCY_NORMALIZER, 1.0
            )
            score = (
                entry.importance * _WEIGHT_IMPORTANCE
                + recency * _WEIGHT_RECENCY
                + access_frequency * _WEIGHT_FREQUENCY
                + relevance * _WEIGHT_RELEVANCE
            )
            scored.append((score, entry))
        scored.sort(key=lambda t: t[0], reverse=True)
        return [entry for _, entry in scored]
```

**消费反馈闭环**：F015 retriever 命中 → `entry.touch()` 更新 `access_count` / `last_accessed` → `ConsumptionWeightedRanker.rank()` 读取 `access_count` 计算 `access_frequency` 项 → 排序结果注入 agent context → agent 真实使用反馈到下次检索。这是 `[doc:roleagent.md#第4章]` "revealed preference"原则的工程落地。

## 3. 验收标准

### Phase A（ranker 实现）

- [ ] AC-A1: `ConsumptionWeightedRanker.rank()` 为纯函数，不修改 `entries` 列表、不修改 `MemoryEntry` 实例、不访问 collection
- [ ] AC-A2: 四维权重常量精确为 `_WEIGHT_IMPORTANCE=0.4` / `_WEIGHT_RECENCY=0.3` / `_WEIGHT_FREQUENCY=0.2` / `_WEIGHT_RELEVANCE=0.1`，合 1.0
- [ ] AC-A3: `recency` 计算公式为 `1.0 - min(age_seconds / 86400, 1.0)`，`age_seconds` 从 `entry.created_at` 计算（UTC now）
- [ ] AC-A4: `access_frequency` 计算公式为 `min(access_count / 10.0, 1.0)`，`access_count >= 10` 时饱和为 1.0
- [ ] AC-A5: `relevance` 从 `query_context.get("relevance", 0.5)` 读取，默认 0.5
- [ ] AC-A6: 排序按 score 降序，ties 保插入顺序（Python 稳定排序）
- [ ] AC-A7: 空 `entries` 列表返回空列表，不抛异常
- [ ] AC-A8: `age_seconds` 通过 `max(0.0, ...)` 钳制，防止时钟回拨导致负值
- [ ] AC-A9: 模块为纯 Python，无 LLM / 无外部 embedding 依赖；日志通过 `flowforge.core.tracing.get_logger` 注入 `trace_id`

### Phase B（管线集成 + E2E）

- [ ] AC-B1: 检索管线 `collection → retriever → ConsumptionWeightedRanker → agent context` 端到端跑通
- [ ] AC-B2: 高 `access_count` 条目在相同 `importance` 下排名高于低 `access_count` 条目（消费反馈生效）
- [ ] AC-B3: 新建条目（`age_seconds < 86400`）的 `recency` 项 > 0；超过 1 天的条目 `recency` 项 = 0
- [ ] AC-B4: `access_count >= 10` 的条目 `access_frequency` 项 = 1.0（饱和）
- [ ] AC-B5: `rank()` 在千级 `entries` 上延迟 < 20ms
- [ ] AC-B6: E2E 测试——灵智体协作过程中真实检索 → 排序 → 注入 context，排序结果与 `access_count` 信号正相关
- [ ] AC-B7: 遵守 T1-T8 测试铁律（真实 LLM 调用、真实场景数据、不跳过验证、不 Mock 工具、采集完整指标、LLM 生成内容经 LLM 审核、Web 功能操控浏览器验证 DOM）

## 4. 依赖

- **Evolved from**: 无
- **Blocked by**: F014（`MemoryEntry.importance` / `access_count` / `created_at` 字段）、F015（retriever 命中时 `touch()` 回写消费信号）
- **Related**: F017（治理层 `apply_decay` 衰减 `importance`，影响 ranker 排序；`apply_retention` 淘汰低分条目）

## 5. 风险

| 风险 | 缓解 |
|------|------|
| `access_count` 是 proxy 信号（部分文件读取未计入） | 诚实标注为趋势反馈阶段，`outputVerified` 强信号为后续演进项 |
| 四维权重为硬编码常量，无法按场景调整 | P1 阶段可接受，P2 演进为可配置权重（YAML 注入） |
| `relevance` 由调用方注入，可能被滥用为 LLM 自评通道 | 文档明确：`relevance` 应来自 retriever 的 score 或 agent 显式反馈，禁 LLM 自评 |
| `recency` 24 小时窗口对长周期项目过短 | P2 演进为可配置窗口（按域区分） |
| 稳定排序在 `created_at` 完全相同时可能产生不可预期顺序 | 罕见情况，P2 可引入 `entry_id` 字典序作为最终 tiebreaker |
| `importance` 单维度无法承载完整权威等级 | 当前为 P1 简化形态，P2 演进为 authority / activation / status 三维元数据 |

## 6. Open Questions

| # | 问题 | 状态 |
|---|------|------|
| OQ-1 | 四维权重是否应按 `MemoryDomain` 区分（如 EPISODIC 重 recency，PROCEDURAL 重 importance）？ | ⬜ 未定（P2 演进项） |
| OQ-2 | `relevance` 是否应由 retriever 自动注入（如 `SemanticRetriever` 的 cosine score）？ | 🟡 已定：当前由调用方注入，retriever 返回 `list[MemoryEntry]` 不携带 score |
| OQ-3 | 是否需要新增 `quality_signal` 维度（如 `outputVerified` 强信号）？ | ⬜ 未定（P2 演进项） |
| OQ-4 | `rank()` 是否应返回带 score 的 `RetrievalResult` 而非裸 `MemoryEntry`？ | ⬜ 未定（P2 API 演进项） |

## 7. Key Decisions

| # | 决策 | 理由 | 日期 |
|---|------|------|------|
| KD-1 | 四维权重 `0.4/0.3/0.2/0.1` 合 1.0 | importance 主导（权威等级），recency 次之（防老知识垄断），frequency 反映真实消费，relevance 调用方注入 | 2026-07-21 |
| KD-2 | 纯函数 ranker，不修改 collection / entry | 检索管线最后一环，副作用隔离，可审计 | 2026-07-21 |
| KD-3 | `recency` 24 小时衰减窗口（`_RECENCY_WINDOW_SECONDS=86400`） | 平衡"新鲜度"与"长周期项目记忆"，P2 可配置 | 2026-07-21 |
| KD-4 | `access_frequency` 10 次饱和（`_FREQUENCY_NORMALIZER=10.0`） | 防止高频条目垄断排序，P2 可配置 | 2026-07-21 |
| KD-5 | `relevance` 默认 0.5（`_DEFAULT_RELEVANCE`） | 避免 0 值拉低总分，调用方未注入时取中性值 | 2026-07-21 |
| KD-6 | 禁 LLM 自评打分 | `[doc:roleagent.md#第4章]` 明确否决——自评集中 0.6-0.85 成功区间，根信号有毒 | 2026-07-21 |
| KD-7 | 稳定排序保插入顺序 | ties 罕见，保插入顺序可审计，避免随机性 | 2026-07-21 |

## 8. Timeline

| 日期 | 事件 |
|------|------|
| 2026-07-21 | 立项，确立 F016 消费加权评分 Feature 规格，落地 `ConsumptionWeightedRanker` 纯函数 ranker，四维权重合 1.0 |

## 9. Review Gate

- Phase A: 单元测试通过，`ConsumptionWeightedRanker` 由架构师灵智体 review，验证四维权重合 1.0 与纯函数特性
- Phase B: E2E 测试由跨厂商 reviewer 灵智体 review，验证消费反馈闭环（`access_count` → `access_frequency` → 排序）生效

## 10. Links

| 类型 | 路径 | 说明 |
|------|------|------|
| **ADR** | `docs/decisions/008-memory-federation.md` | 多域记忆联邦决策（§2.6 消费加权排序） |
| **ADR** | `docs/decisions/012-naming-fusion.md` | 命名融合（灵忆 EchoStore 术语表） |
| **Feature** | `docs/features/F014-memory-collection.md` | 记忆收集与多域存储（提供 importance/access_count 字段） |
| **Feature** | `docs/features/F015-retrieval-entries.md` | 三检索入口（touch() 回写消费信号） |
| **Feature** | `docs/features/F017-memory-governance-mind-codex.md` | 治理与灵典（apply_decay 影响 importance） |
| **Code** | `flowforge/core/memory/consumption_weighted.py` | ConsumptionWeightedRanker 实现 |
| **VISION** | `docs/VISION.md#3` | 持续身份：灵忆 EchoStore 提供 access_count 根信号 |
| **roleagent** | `docs/roleagent.md#第4章` | revealed preference 原则（不用 LLM 自评打分） |
