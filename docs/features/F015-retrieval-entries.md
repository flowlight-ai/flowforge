---
feature_ids: [F015]
related_features: [F014, F016, F017]
topics: [memory, retrieval, grep, semantic, tf-idf, index, tags]
doc_kind: spec
created: 2026-07-21
---

# F015: 三检索入口（Three Retrieval Entries）

> **状态**: spec | **负责人**: 架构师灵智体 | **优先级**: P0
> **依赖 ADR**: [doc:decisions/008-memory-federation.md]
> **依据**: operator 7 条不可妥协原则 + roleagent.md 第4章 多域记忆联邦
> **关联 VISION**: [doc:VISION.md#3]（持续身份：灵忆 EchoStore 提供检索基底）

## 1. 上下文

### 1.1 问题陈述

`[doc:roleagent.md#第4章]` 指出：agent 在不同认知状态下需要走不同的检索路径——有上下文时走精确导航，失上下文时走零先验扫描，探索性时走语义搜索。单池向量 RAG 只提供一条语义召回路径，无法覆盖三种认知模式。

FlowForge 需要在 F014 的 `MemoryCollection` 基底上挂载三个**独立、async、互相不替代**的检索入口，让灵智体（Forgekin）根据当前认知状态选择路径，并在命中时回写消费信号（`touch()`）作为 F016 消费加权的根信号源。

### 1.2 当前痛点

- **检索入口单一**：只有语义检索，没有精确导航和零先验扫描
- **agent 共用一条路**：在不同认知状态下共用语义检索，导致"知道要找什么"也走语义召回（性能浪费+召回漂移）
- **无消费反馈回写**：知识被搜到后不更新 `access_count` / `last_accessed`，F016 消费加权无信号源
- **无来源溯源**：检索结果不携带"由哪个 retriever 命中"信息，无法做检索质量分析

### 1.3 不做的影响

- 违反 `[doc:roleagent.md#第4章]` "三种认知模式走不同路"主张
- F016 消费加权无 `access_count` 信号源，加权公式退化为静态打分
- 检索结果无 `matched_by` 溯源，无法度量各 retriever 命中率与质量
- 灵智体在"知道 feature 编号"场景下仍走 TF-IDF 召回，性能与精度双输

## 2. 决策

### 2.1 核心设计

落地三个独立 retriever，全部 async、全部在命中时调用 `MemoryEntry.touch()` 回写消费信号：

| 入口 | roleagent.md 名称 | 实现类 | 算法 | 适用场景 |
|------|-------------------|--------|------|----------|
| 精确导航 | graph_resolve | `GrepRetriever` | 子串匹配（case-insensitive） | 知道要找什么——feature 编号、决策锚点 |
| 语义搜索 | search_evidence | `SemanticRetriever` | TF-IDF 余弦相似度（smoothed IDF） | 知道方向但不知道确切锚点 |
| 零先验扫描 | list_recent | `IndexRetriever` | 标签索引 ANY 匹配 | 按标签展开上下文 |

设计要点：

- **三入口独立**：`GrepRetriever` / `SemanticRetriever` / `IndexRetriever` 互不依赖，可单独使用或组合使用
- **统一 async 形态**：三个 `search()` 方法都是 `async def`，即使计算本地化也保持 I/O 形态，避免在 async agent loop 中产生 surprise
- **统一 touch() 回写**：三个 retriever 命中时都调用 `entry.touch()`，保证消费信号无差别采集
- **RetrievalResult 溯源**：`RetrievalResult` 携带 `entry` / `score` / `matched_by` 三元组，提供检索来源溯源
- **smoothed IDF**：`log((1+n)/(1+df)) + 1`（sklearn 风格），确保高频词仍保留非零权重，避免退化查询返回空结果
- **纯 Python**：无外部 embedding 服务，TF-IDF 在千级 collection 上性能可接受

### 2.2 关键接口

```python
from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass
from typing import Literal

from flowforge.core.memory.collection import MemoryCollection, MemoryEntry


RetrievalMatchedBy = Literal["grep", "semantic", "index"]


@dataclass
class RetrievalResult:
    """One scored hit returned by a retriever.

    entry      — the matched MemoryEntry
    score      — retriever-specific score (0.0..1.0 for semantic; 1.0 for
                 grep hits; tag-overlap ratio for index)
    matched_by — which retriever produced this hit
    """

    entry: MemoryEntry
    score: float
    matched_by: RetrievalMatchedBy


def _tokenize(text: str) -> list[str]:
    """Lowercase + whitespace split. No stopword removal, no stemming."""
    return [t for t in text.lower().split() if t]


class GrepRetriever:
    """Substring match over entry.content (case-insensitive)."""

    async def search(
        self,
        query: str,
        collection: MemoryCollection,
    ) -> list[MemoryEntry]:
        """Return every entry whose content contains the query substring.

        Hits are touched (access_count / last_accessed bumped) so the
        consumption-weighted ranker downstream receives fresh signal.
        """
        if not query:
            return []
        needle = query.lower()
        hits = [e for e in collection.all() if needle in e.content.lower()]
        for hit in hits:
            hit.touch()
        return hits


class SemanticRetriever:
    """TF-IDF cosine similarity retriever (no external embedding).

    Builds the IDF table on the fly over the whole collection for each query.
    The smoothed IDF formula `log((1+n) / (1+df)) + 1` (sklearn-style) ensures
    that even query tokens appearing in every document retain a non-zero IDF.
    """

    async def search(
        self,
        query: str,
        collection: MemoryCollection,
        top_k: int = 5,
    ) -> list[MemoryEntry]:
        """Return the top_k entries ranked by TF-IDF cosine similarity."""
        # 1. Tokenize all docs + query
        # 2. Build smoothed IDF: idf[t] = log((1+n)/(1+df[t])) + 1
        # 3. Compute query TF-IDF vector + doc TF-IDF vectors
        # 4. Cosine similarity, keep > 0.0, sort desc, take top_k
        # 5. touch() each hit
        ...


class IndexRetriever:
    """Tag-index lookup — returns entries matching ANY of the given tags."""

    async def search(
        self,
        tags: list[str],
        collection: MemoryCollection,
    ) -> list[MemoryEntry]:
        """Return entries that carry at least one of the requested tags."""
        if not tags:
            return []
        hits = collection.list_by_tags(tags)
        for hit in hits:
            hit.touch()
        return hits
```

**消费反馈闭环**：三 retriever 命中时调用 `entry.touch()` → `access_count` / `last_accessed` 更新 → F016 `ConsumptionWeightedRanker` 读取 `access_count` 计算 `access_frequency` 项 → 排序结果反馈给 agent context。这是 `[doc:roleagent.md#第4章]` "用 agent 真实行为（revealed preference）判断知识价值"原则的根信号通路。

## 3. 验收标准

### Phase A（三入口实现）

- [ ] AC-A1: `GrepRetriever.search()` 为 `async def`，对 `query` 执行 case-insensitive 子串匹配，命中调用 `entry.touch()`
- [ ] AC-A2: 空 `query` 返回空列表，不抛异常
- [ ] AC-A3: `SemanticRetriever.search()` 为 `async def`，默认 `top_k=5`，使用 smoothed IDF 公式 `log((1+n)/(1+df)) + 1`
- [ ] AC-A4: `SemanticRetriever` 在 collection 为空或 `query.strip()` 为空时返回空列表
- [ ] AC-A5: `SemanticRetriever` 对 `cosine > 0.0` 的结果按 score 降序排序，取 `top_k` 条，每条调用 `entry.touch()`
- [ ] AC-A6: `IndexRetriever.search()` 为 `async def`，使用 `collection.list_by_tags(tags)` 执行 ANY 匹配，命中调用 `entry.touch()`
- [ ] AC-A7: 空 `tags` 列表返回空列表
- [ ] AC-A8: `RetrievalResult` 数据类三元组（entry / score / matched_by）字段齐全，`matched_by` 类型为 `Literal["grep", "semantic", "index"]`
- [ ] AC-A9: `_tokenize()` 执行小写+空白切分，无 stopword 移除、无 stemming
- [ ] AC-A10: 模块为纯 Python，无外部 embedding 依赖；日志通过 `flowforge.core.tracing.get_logger` 注入 `trace_id`

### Phase B（联邦集成 + E2E）

- [ ] AC-B1: 三 retriever 命中后 `entry.access_count` 与 `entry.last_accessed` 均被更新（F016 消费加权闭环根信号）
- [ ] AC-B2: `GrepRetriever` 在千级 collection 上延迟 < 50ms
- [ ] AC-B3: `SemanticRetriever` 在千级 collection 上延迟 < 200ms（in-memory TF-IDF）
- [ ] AC-B4: `IndexRetriever` 在千级 collection 上延迟 < 10ms（O(1) 索引查找）
- [ ] AC-B5: `SemanticRetriever` 对"高频词退化查询"（query token 出现在每篇文档）仍返回非空 ranked 结果（smoothed IDF 保护）
- [ ] AC-B6: E2E 测试——灵智体在三种认知状态下分别走对应检索路径，命中结果经 F016 排序后注入 agent context
- [ ] AC-B7: 遵守 T1-T8 测试铁律（真实 LLM 调用、真实场景数据、不跳过验证、不 Mock 工具、采集完整指标、LLM 生成内容经 LLM 审核、Web 功能操控浏览器验证 DOM）

## 4. 依赖

- **Evolved from**: 无
- **Blocked by**: F014（`MemoryCollection` / `MemoryEntry` 基底，`touch()` 消费反馈）
- **Related**: F016（消费加权排序，读取 `access_count` / `last_accessed` 信号）、F017（治理层，对 collection 内条目做 retention / decay / conflict，影响检索候选集）

## 5. 风险

| 风险 | 缓解 |
|------|------|
| TF-IDF 在千级以上 collection 性能下降 | 当前 in-memory 设计为 P1 起步，P2 可替换为向量索引，`SemanticRetriever` 接口不变 |
| `_tokenize` 无 stopword / stemming 导致召回噪声 | P1 阶段可接受，P2 演进为可插拔 tokenizer |
| `touch()` 在 `SemanticRetriever` 仅对 `top_k` 命中调用，未命中但 cosine>0 的条目无消费信号 | 设计取舍：仅 top_k 进入 agent context，未进入者不应被计为"消费" |
| 三入口组合使用时 `touch()` 重复调用导致 `access_count` 虚高 | 调用方负责去重，或 P2 引入"单次检索会话内 touch 去重"机制 |
| `GrepRetriever` 对超长 content 性能退化 | P1 阶段可接受，P2 演进为正则预编译或 FTS 索引 |

## 6. Open Questions

| # | 问题 | 状态 |
|---|------|------|
| OQ-1 | 是否需要新增第四个 retriever（如 `GraphRetriever` 做跨 entry 关系遍历）？ | ⬜ 未定（P2 演进项） |
| OQ-2 | `RetrievalResult` 是否应统一为三 retriever 的返回类型（当前仅 `SemanticRetriever` 内部使用）？ | 🟡 已定：当前返回 `list[MemoryEntry]`，`RetrievalResult` 为内部溯源数据类 |
| OQ-3 | `SemanticRetriever` 是否应缓存 IDF 表（跨 query 复用）？ | ⬜ 未定（P2 性能优化项） |

## 7. Key Decisions

| # | 决策 | 理由 | 日期 |
|---|------|------|------|
| KD-1 | 三 retriever 全部 async | I/O 形态统一，slot into async agent loop without surprise | 2026-07-21 |
| KD-2 | 命中时统一调用 `entry.touch()` | 形成 F016 消费加权闭环根信号 | 2026-07-21 |
| KD-3 | smoothed IDF 公式 `log((1+n)/(1+df)) + 1` | sklearn 风格，保证高频词非零权重，避免退化查询空结果 | 2026-07-21 |
| KD-4 | `IndexRetriever` 使用 ANY 匹配（非 ALL） | 零先验扫描场景需要"按标签展开上下文"，ANY 比 ALL 召回更宽 | 2026-07-21 |
| KD-5 | `GrepRetriever` 返回全部命中（无 top_k） | 精确导航场景需要确定性全量结果，不应截断 | 2026-07-21 |
| KD-6 | `RetrievalResult` 携带 `matched_by` 溯源 | 支持检索质量分析与多 retriever 组合溯源 | 2026-07-21 |
| KD-7 | 纯 Python + 无外部 embedding 依赖 | P0 阶段稳定运行，向量索引作为 P2 编译层可插拔替换 | 2026-07-21 |

## 8. Timeline

| 日期 | 事件 |
|------|------|
| 2026-07-21 | 立项，确立 F015 三检索入口 Feature 规格，落地 GrepRetriever / SemanticRetriever / IndexRetriever 三独立 async 入口 |

## 9. Review Gate

- Phase A: 单元测试通过，三 retriever 由架构师灵智体 review，验证 `touch()` 回写闭环与 smoothed IDF 公式
- Phase B: E2E 测试由跨厂商 reviewer 灵智体 review，验证三入口在三种认知状态下的命中率与延迟达标

## 10. Links

| 类型 | 路径 | 说明 |
|------|------|------|
| **ADR** | `docs/decisions/008-memory-federation.md` | 多域记忆联邦决策（§2.4 三检索入口） |
| **ADR** | `docs/decisions/012-naming-fusion.md` | 命名融合（灵忆 EchoStore 术语表） |
| **Feature** | `docs/features/F014-memory-collection.md` | 记忆收集与多域存储（基底） |
| **Feature** | `docs/features/F016-consumption-weighted.md` | 消费加权排序（读取 touch() 信号） |
| **Feature** | `docs/features/F017-memory-governance-mind-codex.md` | 治理与灵典（影响检索候选集） |
| **Code** | `flowforge/core/memory/retrieval_entries.py` | GrepRetriever / SemanticRetriever / IndexRetriever / RetrievalResult 实现 |
| **VISION** | `docs/VISION.md#3` | 持续身份：灵忆 EchoStore 提供检索基底 |
| **roleagent** | `docs/roleagent.md#第4章` | 三种认知模式走不同路 |
