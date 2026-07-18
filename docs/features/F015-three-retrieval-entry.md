# Feature F015: 三检索入口

> **状态**: draft
> **版本**: v0.1
> **依赖**: [doc:review/review.md#RA-024] + [doc:roleagent.md#第4章]
> **关联 ADR**: [doc:decisions/008-memory-federation.md]
> **类型**: memory
> **创建日期**: 2026-07-17
> **负责人**: 架构师灵智体

---

## 1. 概述（Overview）

三检索入口是多域记忆联邦的检索协议：roleagent.md 第 4 章提出 grep / 语义 / 索引三种互补检索入口，分别覆盖精确文本、语义相似、结构化索引。本 Feature 实现三入口统一调度、结果融合、与 F014 Collection 域隔离联动、与 F017 消费加权排序对接。

这是 Build to Persist 基础设施——编码"不同检索场景用不同入口"的工程规则。

## 2. 动机（Motivation）

`[doc:review/review.md#RA-024]` 指出：v7.0 的灵忆（EchoStore）基于 sqlite-vec 向量检索 + 关键词 BM25，是典型 RAG 架构。roleagent.md 第 4 章提出三检索入口（grep/语义/索引）互补——grep 精确文本（如函数名）、语义相似（如"如何处理失败"）、结构化索引（如按 Collection + authority 查询）。v7.0 只用向量 + BM25，无法覆盖"我要找 `def handoff_capsule` 这个精确符号"这类场景。

不做这个 Feature，F017 消费加权排序缺少多源融合入口，F039 灵典可检索知识库无法实现"按 trigger 字段精确查询"，F020 七类归因矩阵缺少"轨迹检索"工具支撑。这是 roleagent.md 第 4 章检索驱动的适配循环基础。

## 3. 详细设计（Detailed Design）

### 3.1 数据模型

```python
class RetrievalEntryType(str, Enum):
    GREP = "grep"            # 精确文本（ripgrep）
    SEMANTIC = "semantic"    # 语义相似（向量检索）
    INDEX = "index"          # 结构化索引（Collection + authority + lifecycle）

class RetrievalQuery(BaseModel):
    query_id: str
    entry_type: RetrievalEntryType
    pattern: str                          # grep pattern / 语义 query / index filter
    collections: list[str]                # 限定 Collection（域隔离）
    authority_floor: int = 1              # 权威等级下限
    include_deprecated: bool = False
    max_results: int = 20

class RetrievalResult(BaseModel):
    query_id: str
    entry_type: RetrievalEntryType
    hits: list[RetrievalHit]
    elapsed_ms: int
```

### 3.2 核心接口

```python
class GrepEntry:
    """精确文本检索入口（基于 ripgrep）"""
    async def search(self, query: RetrievalQuery) -> RetrievalResult: ...

class SemanticEntry:
    """语义检索入口（基于向量）"""
    async def search(self, query: RetrievalQuery) -> RetrievalResult: ...

class IndexEntry:
    """结构化索引入口（基于 Collection 元数据）"""
    async def search(self, query: RetrievalQuery) -> RetrievalResult: ...

class RetrievalFusion:
    """三入口结果融合"""
    async def fuse(self, results: list[RetrievalResult]) -> list[RetrievalHit]: ...
```

### 3.3 关键算法

- **入口选择**：精确符号/路径走 grep；自然语言走 semantic；按权威/生命周期过滤走 index。
- **域隔离**：三入口都强制 collections 过滤，禁跨域检索。
- **结果融合**：RRF（Reciprocal Rank Fusion）融合三入口结果，再交 F017 消费加权重排。
- **权威过滤**：authority_floor 以下的结果丢弃。

### 3.4 配置外置（YAML 示例）

```yaml
retrieval_entries:
  grep:
    engine: ripgrep
    max_pattern_length: 200
  semantic:
    engine: sqlite-vec
    embedding_model: bge-large-zh
    top_k: 20
  index:
    engine: sqlite_fts
    filter_fields: [collection_id, authority, lifecycle_status]
  fusion:
    algorithm: rrf
    k: 60
    handoff_to: F017_consumption_weighted_ranking
```

## 4. 验收标准（Acceptance Criteria）

- [ ] AC-1: 三入口均可独立调用并返回结果
- [ ] AC-2: 三入口均强制 collections 过滤（域隔离）
- [ ] AC-3: authority_floor 以下结果被丢弃
- [ ] AC-4: RRF 融合结果交 F017 重排
- [ ] AC-5: grep 入口可查精确符号（如 `def handoff_capsule`）

## 5. 测试策略

### 5.1 单元测试

- 三入口检索、域隔离、权威过滤、RRF 融合。

### 5.2 集成测试

- 接入 F014 Collection、F017 消费加权排序、F039 灵典可检索。

### 5.3 E2E 测试（必须遵守 T1-T8 测试铁律）

- 真实厂商灵智体在多 Collection 场景下用三种入口检索，验证融合结果正确。**遵守 T1-T8**：真实 LLM、真实数据、真实工具调用。

## 6. 引用

- [doc:roleagent.md#第4章]
- [doc:review/review.md#第八章/RA-024]
- [doc:decisions/008-memory-federation.md]
- [doc:design/naming-contract.md#2.5]（灵忆 EchoStore）
- [doc:features/F014-memory-collection.md]
- [doc:features/F017-consumption-weighted-ranking.md]
- [doc:features/F039-mind-codex-searchable.md]
- [doc:project_rules.md#T1-T8]
