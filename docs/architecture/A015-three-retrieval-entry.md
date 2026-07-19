# A015: 三检索入口架构设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师灵智体（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.4]（FR-CORE-004）
> **对应 arch.md**: [doc:../arch.md#§3.4]
> **对应 design.md**: [doc:../design.md#§3.4]（待创建）
> **对应 Feature**: [doc:../features/F015-three-retrieval-entry.md]（同号 Feature 级 SRS）
> **对应详细设计**: [doc:../design/D015-three-retrieval-entry.md]（待创建，同号 Feature 级 SDD）
> **依赖 ADR**: [doc:../decisions/008-memory-federation.md]
> **9 大点名称修订**: 已应用（双轨命名 + AI 术语优先 + 弱化万物 + 去 AGI 化）

---

## 1. 架构上下文

### 1.1 架构问题

灵智体（Forgekin）检索知识时存在三种本质不同的检索场景：精确符号（"找 `def handoff_capsule`"）、语义相似（"如何处理失败"）、结构化过滤（"按 authority≥4 查询"）。v7.0 只用 sqlite-vec 向量检索 + BM25 关键词检索，是典型 RAG 架构，无法覆盖三种场景的差异化诉求，导致：

1. **符号检索失效**：函数名/路径/标识符无法精确匹配，向量检索把"handoff_capsule"语义近邻排到精确匹配之前。
2. **过滤能力薄弱**：无法按 Collection + authority + lifecycle 联合过滤，全靠向量 top-k 后再过滤，丢失有效结果。
3. **多源融合无规则**：三入口结果融合靠人工排序，无 RRF 等可证明的融合算法。

本架构解决的核心问题：**如何在 L3 检索层为灵智体提供三入口统一调度 + 域隔离强制 + RRF 融合 + 权威过滤的检索协议**，使上层（F017 排序、F039 锻典）拿到"已隔离已过滤已融合"的统一结果集。

### 1.2 架构约束

- **单向依赖约束**：检索层依赖 F014 Collection 层与 OpenSieve，禁止被 F014 反向依赖。
- **域隔离约束**：三入口均必须强制 `collections` 参数，无此参数的查询在入口处拒绝（不传到引擎内部）。
- **配置驱动约束**：grep/semantic/index 三引擎的具体实现（ripgrep/sqlite-vec/sqlite_fts）外置 YAML，禁止在代码中硬编码引擎选择。
- **OpenSieve 约束**：semantic 入口的非结构化检索走 OpenSieve 聚合检索中台，不另起向量服务。
- **简单系统约束**：roleagent.md 第 4 章要求"查询扩展由 agent 做，不在引擎里加 regex/小模型"——本架构禁止在检索引擎内做任何 LLM 调用或 regex 扩展。

### 1.3 架构影响

- **对 F014 Collection 层**：三入口在调用前必须向 CollectionRegistry 校验 collection_ids 是否跨域，跨域抛 CrossDomainJoinForbidden。
- **对 F016 治理层**：authority_floor 过滤先于 RRF 融合，过滤后的结果交 F016 治理层做权威排序。
- **对 F017 消费排序**：RRF 融合后的 RetrievalHit 列表交 F017 ConsumptionWeightedRanker 重排，不直接返回给灵智体。
- **对 F020 归因矩阵**：grep 入口为"轨迹检索"提供工具支撑，归因矩阵可通过 grep 检索历史失败轨迹。
- **对 F039 锻典**：Mind Codex 通过 index 入口按 trigger 字段精确查询锻典条目。

---

## 2. 架构设计

### 2.1 组件架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│ 上层调用方                                                           │
│  F017 Ranker  F039 CodexSearch  F020 AttributionTrace  Forgekin    │
└──────────┬──────────────────────────────────────────────────────────┘
           │ RetrievalFusion.search(RetrievalQuery)
           ▼
┌─────────────────────────────────────────────────────────────────────┐
│ L3: RetrievalFusion（三入口调度器 + RRF 融合器）                     │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ 1. 校验 collections 参数（域隔离）                          │  │
│  │ 2. 校验 authority_floor（1-5）                              │  │
│  │ 3. 并行调度三入口                                           │  │
│  │ 4. RRF 融合 → RetrievalHit 列表                             │  │
│  └─────────────────────────────────────────────────────────────┘  │
└───┬──────────────────┬──────────────────┬──────────────────────────┘
    │ grep             │ semantic         │ index
    ▼                  ▼                  ▼
┌────────────┐  ┌────────────┐    ┌────────────┐
│ GrepEntry  │  │SemanticEntry│   │ IndexEntry │
│ (ripgrep)  │  │ (OpenSieve)│    │(sqlite_fts)│
│ 精确符号    │  │ 语义相似    │    │ 结构过滤    │
└─────┬──────┘  └─────┬──────┘    └─────┬──────┘
      │               │                 │
      ▼               ▼                 ▼
┌─────────────────────────────────────────────────────┐
│ F014 CollectionRegistry（域隔离仲裁 + 物理存储）    │
└─────────────────────────────────────────────────────┘
```

### 2.2 关键架构决策

- **决策 1：三入口并行而非串行**。三入口无数据依赖，并行调度后由 RetrievalFusion 统一融合。理由：grep < 50ms / semantic 200-500ms / index < 100ms，串行会导致总延迟被 semantic 拖到 500ms+。
- **决策 2：RRF 融合而非加权求和**。三入口分数尺度不同（grep 是命中布尔 / semantic 是 cosine / index 是 BM25），直接加权不可比。RRF (Reciprocal Rank Fusion) 用排名倒数融合，尺度无关。`k=60` 是 RRF 经验值，平衡 head/tail。
- **决策 3：authority_floor 在入口前置过滤**。在 RRF 融合之前先按 authority_floor 丢弃低权威结果，避免低权威结果通过 RRF 排名靠前。理由：F016 治理层要求"hard_rule > verified_decision > candidate_observation"硬序，不能让候选观察通过 RRF 翻盘。
- **决策 4：grep 用 ripgrep 而非 Python re**。ripgrep 是 Rust 实现的多线程 grep，对大代码库（10w+ 文件）的精确符号查询延迟 < 50ms，Python re 不具备此性能。
- **决策 5：查询扩展禁在引擎内做**。roleagent.md 第 4 章"简单系统 + 聪明 agent"原则——查询扩展（如同义词扩展、子查询分解）由灵智体在调用前完成，引擎只接收最终 query。理由：在引擎内加 regex/小模型会引入隐式复杂度，破坏 Build to Delete 半衰期标记。

### 2.3 架构不变量

- 三入口必须强制 collections 参数，无此参数的查询必须在入口处拒绝。
- 跨域查询必须在 RetrievalFusion 入口层被拒绝，禁止穿透到具体 entry。
- authority_floor 以下的命中必须在 RRF 融合之前被丢弃。
- RRF 融合的 k 值必须从配置加载，禁止硬编码。
- semantic 入口必须走 OpenSieve，禁止另起向量服务。
- 检索引擎内必须不调用任何 LLM，禁止 regex 查询扩展。

---

## 3. 模块设计

### 3.1 模块边界

| 模块 | 路径 | 职责 | 对外暴露 |
|------|------|------|---------|
| RetrievalFusion | `flowforge/core/memory/retrieval/fusion.py` | 三入口调度、域校验、RRF 融合 | `search` |
| GrepEntry | `flowforge/core/memory/retrieval/grep.py` | ripgrep 调用、精确符号检索 | `search` |
| SemanticEntry | `flowforge/core/memory/retrieval/semantic.py` | OpenSieve 调用、语义检索 | `search` |
| IndexEntry | `flowforge/core/memory/retrieval/index.py` | sqlite_fts 调用、结构化过滤 | `search` |
| RRFCombiner | `flowforge/core/memory/retrieval/rrf.py` | RRF 算法实现 | `fuse` |
| RetrievalConfigLoader | `flowforge/core/memory/retrieval/config.py` | YAML 配置加载 | `load_retrieval_config` |

### 3.2 接口契约

```python
from abc import ABC, abstractmethod
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field
from enum import Enum


class RetrievalEntryType(str, Enum):
    GREP = "grep"
    SEMANTIC = "semantic"
    INDEX = "index"


class RetrievalQuery(BaseModel):
    query_id: str
    entry_type: RetrievalEntryType
    pattern: str = Field(min_length=1)
    collections: list[str] = Field(min_length=1)  # 必须非空
    authority_floor: int = Field(default=1, ge=1, le=5)
    include_deprecated: bool = False
    max_results: int = Field(default=20, ge=1, le=200)


class RetrievalHit(BaseModel):
    entry_id: str
    collection_id: str
    score: float
    rank: int
    matched_by: RetrievalEntryType
    payload_excerpt: str


class RetrievalResult(BaseModel):
    query_id: str
    entry_type: RetrievalEntryType
    hits: list[RetrievalHit]
    elapsed_ms: int


class RetrievalEntry(ABC):
    """三入口统一抽象"""

    @abstractmethod
    async def search(self, query: RetrievalQuery) -> RetrievalResult:
        """单入口检索；必须先校验 collections 非空与 authority_floor 范围"""


class GrepEntry(RetrievalEntry):
    """精确文本检索（基于 ripgrep）"""


class SemanticEntry(RetrievalEntry):
    """语义检索（基于 OpenSieve）"""


class IndexEntry(RetrievalEntry):
    """结构化索引入口（基于 sqlite_fts）"""


class RetrievalFusion(ABC):
    """三入口调度器 + RRF 融合器"""

    @abstractmethod
    async def search(self, query: RetrievalQuery) -> list[RetrievalHit]:
        """
        1. 校验 collections 参数（域隔离）
        2. 并行调度三入口
        3. authority_floor 过滤
        4. RRF 融合
        5. 返回 RetrievalHit 列表（交 F017 重排）
        """

    @abstractmethod
    async def cross_domain_check(self, collection_ids: list[str]) -> None:
        """跨域校验；调用 F014 CollectionRegistry"""


class RRFCombiner(ABC):
    """RRF 融合算法"""

    @abstractmethod
    def fuse(
        self, results: list[RetrievalResult], k: int = 60
    ) -> list[RetrievalHit]:
        """
        score = sum(1 / (k + rank_i))  for each result list i
        k 默认 60，从配置加载
        """
```

### 3.3 数据流

```
[灵智体检索路径]
  Forgekin.chat(query)  ← 查询扩展由灵智体完成
        │
        ▼
  RetrievalFusion.search(RetrievalQuery{
    pattern, collections=[c1, c2], authority_floor=3
  })
        │
        ├─ collections 空校验 ── 空 ──▶ 抛 ValueError
        ├─ cross_domain_check() ── 跨域 ──▶ 抛 CrossDomainJoinForbidden
        │
        ▼
  并行调度（asyncio.gather）
   ├─ GrepEntry.search()       →  RetrievalResult(grep, hits_g)
   ├─ SemanticEntry.search()   →  RetrievalResult(semantic, hits_s)
   └─ IndexEntry.search()      →  RetrievalResult(index, hits_i)
        │
        ▼
  authority_floor 过滤（丢弃 authority < floor 的 hit）
        │
        ▼
  RRFCombiner.fuse([g, s, i], k=60)
        │  score = 1/(60+rank_g) + 1/(60+rank_s) + 1/(60+rank_i)
        ▼
  返回 RetrievalHit 列表
        │
        ▼
  F017 ConsumptionWeightedRanker.rank(hits)  ← 消费加权重排
        │
        ▼
  返回给灵智体
```

---

## 4. 跨模块协作

### 4.1 上游依赖

- 依赖 **F014 Collection 层**：三入口均调用 `CollectionRegistry.cross_domain_join_check()` 做域校验，调用 `CollectionRepository.query_entries()` 读条目。
- 依赖 **OpenSieve 聚合检索中台**（localhost:8100）：semantic 入口的非结构化检索经 OpenSieve SDK 调用，不另起向量服务。
- 依赖 **ripgrep 二进制**：grep 入口通过 subprocess 调用 ripgrep，需在 `config/system.yaml` 中声明路径。

### 4.2 下游影响

- 影响 **F016 治理层**：authority_floor 过滤后的结果交 F016 GovernanceFilter 做权威排序（hard_rule > verified_decision > candidate_observation）。
- 影响 **F017 消费排序**：RRF 融合后的 RetrievalHit 列表是 F017 的输入，F017 在此基础上叠加消费加权。
- 影响 **F020 归因矩阵**：grep 入口为"轨迹检索"提供工具支撑，归因器可通过 grep 检索历史失败 Episode。
- 影响 **F039 锻典可检索**：Mind Codex 通过 index 入口按 trigger 字段精确查询锻典条目，trigger 是结构化字段。
- 影响 **F040 控制面**：每次检索的 elapsed_ms 与 hit_count 信号写入 F040 Eval Hub，作为"检索质量"摩擦指标。

### 4.3 跨模块不变量

- RetrievalFusion 必须在调用三入口前完成 collections 校验，禁止穿透。
- 三入口返回的 RetrievalHit 必须携带 entry_id（与 F014 / F017 对齐）。
- RRF 融合后的 hit.score 必须非负（k≥1 保证）。
- semantic 入口必须不直操作向量库，必须经 OpenSieve。
- 三入口必须不调用任何 LLM，查询扩展必须在调用前完成。

---

## 5. 架构验收

### 5.1 架构契约验收

- [ ] AC-1: 单向依赖通过——`flowforge/core/memory/retrieval/` 不 import F016/F017/F020/F039/F040 任何模块。
- [ ] AC-2: DI 容器注入通过——`RetrievalFusion` 通过 `inject("retrieval_fusion")` 获取。
- [ ] AC-3: Repository 层通过——三入口均经 F014 CollectionRepository 读条目，不直操作数据库。
- [ ] AC-4: 配置驱动通过——grep/semantic/index 引擎选择与 RRF k 值从 `config/retrieval_entries.yaml` 加载。
- [ ] AC-5: 三入口并行调度，总延迟 ≤ max(三入口延迟) + RRF 融合延迟。
- [ ] AC-6: OpenSieve 调用走 SDK，无直连向量库代码。

### 5.2 架构不变量验收

- [ ] AC-7: collections 空列表查询在入口处被拒绝（单测覆盖）。
- [ ] AC-8: 跨域查询在 RetrievalFusion 层被拒绝（单测覆盖 5×5 类型组合）。
- [ ] AC-9: authority_floor 以下的命中在 RRF 融合前被丢弃。
- [ ] AC-10: RRF k 值从配置加载，代码中无硬编码 60。
- [ ] AC-11: grep 入口可查精确符号（如 `def handoff_capsule`），延迟 < 50ms（10w 文件库）。
- [ ] AC-12: 引擎内无 LLM 调用、无 regex 查询扩展代码（静态扫描确认）。

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
| 2026-07-19 | v0.1 | 初始创建（架构骨架 + 三入口并行 + RRF 融合 + 域隔离前置） | 架构师灵智体（猫头鹰·鲁班） |
