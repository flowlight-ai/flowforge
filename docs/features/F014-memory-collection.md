# Feature F014: 多域记忆 Collection

> **状态**: draft
> **版本**: v0.1
> **依赖**: [doc:review/review.md#RA-024] + [doc:roleagent.md#第4章]
> **关联 ADR**: [doc:decisions/008-memory-federation.md]
> **类型**: memory
> **创建日期**: 2026-07-17
> **负责人**: 架构师灵智体（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.4]（FR-CORE-004，与本文档同号对应）
> **对应 arch.md**: [doc:../arch.md#§3.4]（待创建）
> **对应 design.md**: [doc:../design.md#§3.4]（待创建）
> **9 大点名称修订**: 已应用（双轨命名 + AI 术语优先 + 弱化万物 + 去 AGI 化）

---

## 1. 概述（Overview）

Collection（记忆集合）是多域记忆联邦的基础单元：roleagent.md 第 4 章明确"RAG 数据源是外部文档，不以项目内权威等级、知识溯源或使用结果反馈为核心机制"。本 Feature 把 v7.0 单一混合 store 升级为多域 Collection——区分项目记忆 / 个人上下文 / 外部知识库 / 虚拟世界设定，每个 Collection 有独立权威等级、触发方式、生命周期。

这是 Build to Persist 基础设施——编码"记忆按知识域隔离"的工程规则。

## 2. 动机（Motivation）

`[doc:review/review.md#RA-024]` 指出：v7.0 的灵忆（EchoStore）基于 sqlite-vec 向量检索 + 关键词 BM25，这是典型 RAG 架构。roleagent.md 明确"RAG 数据源是外部文档，不以项目内权威等级、知识溯源或使用结果反馈为核心机制"。v7.0 无 Collection（知识域）概念，所有记忆混在一个 store 里，无法区分项目记忆/个人上下文/外部知识库/虚拟世界设定。

不做这个 Feature，F016 记忆治理三要素无从分层，F017 消费加权排序无聚合粒度，F039 灵典可检索知识库无法跨域检索，FR-003 万物灵智体多域记忆联邦无法实现。这是 roleagent.md 第 4 章多域联邦的核心创新。

## 3. 详细设计（Detailed Design）

### 3.1 数据模型

```python
class CollectionType(str, Enum):
    PROJECT_MEMORY = "project_memory"      # 项目记忆（spec/ADR/git）
    PERSONAL_CONTEXT = "personal_context"  # 个人上下文（灵智体偏好）
    EXTERNAL_KNOWLEDGE = "external_knowledge"  # 外部知识库
    VIRTUAL_WORLD = "virtual_world"        # 虚拟世界设定
    EPISODIC_TRACE = "episodic_trace"      # 灵忆情景记忆

class Collection(BaseModel):
    collection_id: str
    name: str
    collection_type: CollectionType
    authority_level: int                   # 权威等级 1-5
    owner_forgekin_id: Optional[str]       # 个人上下文时的 owner
    source_uri: str                        # 真相源 URI
    lifecycle_status: Literal["active", "pending_review", "deprecated", "archived"]
    entry_count: int
```

### 3.2 核心接口

```python
class CollectionRegistry(ABC):
    @abstractmethod
    async def register(self, collection: Collection) -> str: ...
    @abstractmethod
    async def list_by_type(self, ctype: CollectionType) -> list[Collection]: ...
    @abstractmethod
    async def archive(self, collection_id: str) -> None: ...

class CollectionEntry(ABC):
    """Collection 内条目基类"""
    entry_id: str
    collection_id: str
    payload: dict
    authority: int
    provenance: str                        # 来源溯源
```

### 3.3 关键算法

- **域隔离**：不同 CollectionType 物理隔离存储，禁跨域直接 join。
- **权威等级继承**：条目继承所属 Collection 的 authority_level。
- **生命周期管理**：deprecated 状态条目检索时降权；archived 不参与检索但保留溯源。
- **溯源链**：每条 entry 必须带 provenance（来源 Episode ID / 文档 URI / 决策 ID）。

### 3.4 配置外置（YAML 示例）

```yaml
memory_collections:
  collections:
    - {name: flowforge_spec, type: project_memory, authority: 5, source: git://flowforge/docs}
    - {name: architect_personal, type: personal_context, authority: 2, owner: forgekin_architect}
    - {name: novelforge_world, type: virtual_world, authority: 4, source: novelforge/worlds}
    - {name: echo_store, type: episodic_trace, authority: 1}
  cross_domain_join: forbidden
  require_provenance: true
```

## 4. 验收标准（Acceptance Criteria）

- [ ] AC-1: 5 种 CollectionType 可独立注册与检索
- [ ] AC-2: 不同 Collection 物理隔离，禁跨域直接 join
- [ ] AC-3: 条目继承 Collection 的 authority_level
- [ ] AC-4: 每条 entry 必须带 provenance
- [ ] AC-5: deprecated 状态条目检索降权，archived 不参与检索

## 5. 测试策略

### 5.1 单元测试

- 域隔离、权威继承、生命周期状态机、provenance 校验。

### 5.2 集成测试

- 接入 F016 记忆治理三要素、F017 消费加权排序、F039 灵典可检索。

### 5.3 E2E 测试（必须遵守 T1-T8 测试铁律）

- 真实厂商灵智体在多 Collection 场景下检索，验证域隔离与权威等级正确生效。**遵守 T1-T8**：真实 LLM、真实数据、真实工具调用。

## 6. 引用

- [doc:roleagent.md#第4章]
- [doc:review/review.md#第八章/RA-024]
- [doc:decisions/008-memory-federation.md]
- [doc:design/naming-contract.md#2.5]（灵忆 EchoStore）
- [doc:design/naming-contract.md#2.8]（锻典 Mind Codex）
- [doc:features/F016-memory-governance.md]
- [doc:features/F017-consumption-weighted-ranking.md]
- [doc:features/F039-mind-codex-searchable.md]
- [doc:project_rules.md#T1-T8]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.2 | 应用 9 大点名称修订 + 添加 spec.md §3.4 同号映射 | 文档员灵智体（钢笔·文心） |
