# A014: 多域记忆 Collection 架构设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.4]（FR-CORE-004）
> **对应 arch.md**: [doc:../arch.md#§3.4]
> **对应 design.md**: [doc:../design.md#§3.4]（待创建）
> **对应 Feature**: [doc:../features/F014-memory-collection.md]（同号 Feature 级 SRS）
> **对应详细设计**: [doc:../design/D014-memory-collection.md]（待创建，同号 Feature 级 SDD）
> **依赖 ADR**: [doc:../decisions/008-memory-federation.md]

---

## 1. 架构上下文

### 1.1 架构问题

Forgekin（Evolvable Agent，社区社交称"灵智体"）在执行任务时需要从多个相互独立的"知识域"读取上下文：项目权威资料（spec/ADR/git）、个人偏好、外部知识库、虚拟世界设定、情景记忆。v7.0 把所有记忆混在一个 sqlite-vec store 里，导致三个架构层问题：

1. **跨域污染**：项目铁律与候选观察一视同仁排序，铁律可能被候选观察盖过。
2. **权限失配**：Forgekin A 的个人上下文可被Forgekin B 直接检索，无 owner 边界。
3. **溯源丢失**：条目无 provenance，F020 七类归因矩阵无法回溯"知识从哪里来"。

本架构解决的核心问题：**如何在记忆联邦的最底层（L1 真相源 Collection 层）建立域隔离、权威继承、生命周期可治理、来源可溯源的统一容器模型**，为 L2 治理层、L3 检索层、L6 蒸馏知识库（MindCodex）层提供唯一真相源。

### 1.2 架构约束

- **单向依赖约束**：Collection 层是 L1 底座，只能被上层（L2 治理 / L3 检索 / L6 蒸馏知识库）依赖，禁止反向 import。
- **DI 容器约束**：`CollectionRegistry` 必须通过 DI 容器注入，禁止 `CollectionRegistry` 直接实例化（编程红线第 12 条）。
- **Repository 层约束**：所有 Collection 元数据持久化必须经 Repository 层，禁止 `cursor.execute("INSERT INTO collections ...")` 直操作数据库（编程红线第 13 条）。
- **配置驱动约束**：Collection 类型、权威等级、域隔离策略必须外置 YAML（编程红线第 11 条）。
- **可插拔数据源适配器约束**：Collection 条目的非结构化检索通过 Repository 层抽象（支持可插拔数据源适配器，FR-CORE-004），不在核心框架层硬绑定具体检索引擎。

### 1.3 架构影响

- **对 L2 治理层（F016）**：`authority_level` 字段成为治理三要素 `Authority` 的物理承载，治理层不再独立维护权威数据。
- **对 L3 检索层（F015）**：三检索入口必须强制 `collections` 过滤参数，跨域 join 在引擎层硬拒。
- **对 L4 消费排序（F017）**：`entry_id` 成为消费信号的聚合粒度，14 行为指标按 entry 汇聚。
- **对 L6 蒸馏知识库（F039）**：MindCodex 是 `external_knowledge` 类型 Collection 的特化，复用同一容器模型。
- **对 F020 归因矩阵**：provenance 字段成为"翻译偏差 / 环境漂移"归因的溯源依据。

---

## 2. 架构设计

### 2.1 组件架构图

```
┌────────────────────────────────────────────────────────────────────┐
│ 上层消费方（L2-L6）                                                  │
│  F016 GovernanceFilter  F015 RetrievalFusion  F017 Ranker  F039   │
└──────────┬──────────────────┬──────────────────┬─────────────┬─────┘
           │ list_by_type     │ search           │ stats       │ codex
           ▼                  ▼                  ▼             ▼
┌────────────────────────────────────────────────────────────────────┐
│ L1: CollectionRegistry（域注册中心 + 域隔离仲裁器）                 │
│  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐  │
│  │ register       │ │ list_by_type   │ │ archive        │  │
│  │ enforce_isolate│ │ check_authority│ │ emit_lifecycle │  │
│  └──────────────────┘ └──────────────────┘ └──────────────────┘  │
└──────────┬─────────────────────────────────────────────────────────┘
           │ Repository 层
           ▼
┌────────────────────────────────────────────────────────────────────┐
│ CollectionRepository（SQLAlchemy + 禁直操作数据库）                │
│  collections 表 / collection_entries 表 / provenance 索引          │
└──────────┬─────────────────────────────────────────────────────────┘
           │ 物理隔离分库
           ▼
┌──────────────┬──────────────┬──────────────┬──────────────┬───────┐
│ project_mem  │ personal_ctx │ external_kb  │ virtual_world│ echo  │
│  (git://)    │  (owner-bound│  (可插拔数据  │  (YAML)      │ (JSONL│
│              │   namespace) │   源适配器)   │              │  )    │
└──────────────┴──────────────┴──────────────┴──────────────┴───────┘
```

### 2.2 关键架构决策

- **决策 1：物理隔离而非逻辑隔离**。五种 CollectionType 在物理层分库/分表存储，禁止 SQL 跨域 join。理由：逻辑隔离在性能压力下会被工程师以"临时优化"为名绕过，物理隔离是结构性约束（铁律 6 禁止盲目覆盖）。
- **决策 2：权威等级在 Collection 级声明，条目继承**。`authority_level` 是 Collection 属性而非 entry 属性，避免每条 entry 重复声明导致的不一致。继承关系在 `CollectionEntry` 读出时由 Repository 注入。
- **决策 3：provenance 字段必填**。每条 entry 必须携带来源（Episode ID / 文档 URI / 决策 ID），未携带 provenance 的 entry 在 `register` 阶段被拒绝。理由：F020 归因矩阵的"环境漂移"归因依赖此字段。
- **决策 4：CollectionRegistry 作为 DI 单例**。整个进程内只有一个 `CollectionRegistry` 实例，由 DI 容器注入到所有上层模块。理由：防止多实例导致域隔离策略不一致。
- **决策 5：lifecycle 状态机三态外加 archived**。`active / pending_review / deprecated / archived` 四态，archived 物理保留但不参与检索，是 Build to Persist 的体现（不删除可追溯）。

### 2.3 架构不变量

- 不同 CollectionType 必须物理隔离存储，禁止跨域 SQL join。
- 每条 CollectionEntry 必须携带非空 provenance 字段。
- CollectionRegistry 必须是 DI 容器管理的单例。
- 条目的 authority 必须等于其所属 Collection 的 authority_level，禁止单独覆盖。
- archived 状态的条目必须不参与检索但物理保留。
- owner_forgekin_id 为空的 personal_context Collection 必须在 register 阶段被拒绝。

---

## 3. 模块设计

### 3.1 模块边界

| 模块 | 路径 | 职责 | 对外暴露 |
|------|------|------|---------|
| CollectionRegistry | `flowforge/core/memory/collection/registry.py` | 域注册、域隔离仲裁、生命周期事件分发 | `register / list_by_type / archive` |
| CollectionRepository | `flowforge/core/memory/collection/repository.py` | 持久化读写，封装 SQLAlchemy | 不对上层暴露，仅 Registry 调用 |
| CollectionEntry | `flowforge/core/memory/collection/entry.py` | 条目基类，含 provenance 校验 | `validate_provenance` |
| LifecycleEventBus | `flowforge/core/memory/collection/events.py` | 状态变更事件，联动 F016 / F017 | `on_archive / on_deprecate` |
| CollectionConfigLoader | `flowforge/core/memory/collection/config.py` | YAML 配置加载 | `load_collections_from_yaml` |

### 3.2 接口契约

```python
from abc import ABC, abstractmethod
from typing import Optional, Literal
from datetime import datetime
from pydantic import BaseModel, Field
from enum import Enum


class CollectionType(str, Enum):
    PROJECT_MEMORY = "project_memory"
    PERSONAL_CONTEXT = "personal_context"
    EXTERNAL_KNOWLEDGE = "external_knowledge"
    VIRTUAL_WORLD = "virtual_world"
    EPISODIC_TRACE = "episodic_trace"


class Collection(BaseModel):
    collection_id: str
    name: str
    collection_type: CollectionType
    authority_level: int = Field(ge=1, le=5)
    owner_forgekin_id: Optional[str] = None
    source_uri: str
    lifecycle_status: Literal["active", "pending_review", "deprecated", "archived"]
    entry_count: int = 0


class CollectionEntry(BaseModel):
    entry_id: str
    collection_id: str
    payload: dict
    authority: int
    provenance: str = Field(min_length=1)  # 必须非空
    lifecycle_status: Literal["active", "pending_review", "deprecated", "archived"]


class CollectionRegistry(ABC):
    """Collection 注册中心（DI 单例）"""

    @abstractmethod
    async def register(self, collection: Collection) -> str:
        """注册新 Collection；personal_context 必须带 owner_forgekin_id"""

    @abstractmethod
    async def list_by_type(self, ctype: CollectionType) -> list[Collection]:
        """按类型列举；archived 默认不返回"""

    @abstractmethod
    async def archive(self, collection_id: str) -> None:
        """归档 Collection；触发 LifecycleEventBus.on_archive"""

    @abstractmethod
    async def append_entry(self, entry: CollectionEntry) -> str:
        """追加条目；provenance 空则抛 ValueError"""

    @abstractmethod
    async def cross_domain_join_check(self, collection_ids: list[str]) -> None:
        """跨域 join 仲裁；同类型放行，跨类型抛 CrossDomainJoinForbidden"""


class CollectionRepository(ABC):
    """Repository 层抽象（禁直操作数据库）"""

    @abstractmethod
    async def insert_collection(self, collection: Collection) -> str: ...

    @abstractmethod
    async def query_by_type(self, ctype: CollectionType) -> list[Collection]: ...

    @abstractmethod
    async def update_lifecycle(self, collection_id: str, status: str) -> None: ...

    @abstractmethod
    async def insert_entry(self, entry: CollectionEntry) -> str: ...
```

### 3.3 数据流

```
[Agent 写入路径]
  Forgekin.observe / act
        │
        ▼
  CollectionRegistry.append_entry(entry)
        │
        ├─ provenance 非空校验 ── 空 ──▶ 抛 ValueError，拒绝写入
        │
        ▼
  cross_domain_join_check ── 跨域 ──▶ 抛 CrossDomainJoinForbidden
        │
        ▼
  CollectionRepository.insert_entry
        │
        ├─ authority 从 Collection 继承（不读 entry 字段）
        │
        ▼
  LifecycleEventBus.emit("entry_appended")
        │
        ▼
  返回 entry_id（供 F017 消费信号聚合用）

[Agent 检索路径]
  Forgekin.chat(query)
        │
        ▼
  F015 RetrievalFusion.search(query, collections=[...])
        │
        ▼
  CollectionRegistry.list_by_type  返回 active + pending_review
        │  archived 被过滤掉
        ▼
  返回给 F016 GovernanceFilter 进一步过滤
```

---

## 4. 跨模块协作

### 4.1 上游依赖

- 依赖 **F008 Durable State Surfaces**：Collection 元数据作为 6 类持久状态表面之一（memory federation），写入受 F008 规范约束。
- 依赖 **F001 CapabilityProfile**：`owner_forgekin_id` 校验需查 CapabilityProfile 确认Forgekin存在。

### 4.2 下游影响

- 影响 **F015 三检索入口**：三入口必须强制 `collections` 参数，无此参数的查询在引擎层被拒绝。
- 影响 **F016 记忆治理三要素**：`authority_level` 字段被治理层 Authority 枚举引用，lifecycle_status 被治理层 LifecycleStatus 枚举引用。
- 影响 **F017 消费加权排序**：`entry_id` 是 14 行为指标的聚合主键。
- 影响 **F020 七类归因矩阵**：provenance 字段是"环境漂移 / 翻译偏差"归因的回溯依据。
- 影响 **F039 蒸馏知识库可检索知识库**：MindCodex 复用 `external_knowledge` CollectionType，共享同一容器模型。

### 4.3 跨模块不变量

- F015 RetrievalFusion 必须在调用前完成 collections 参数校验，禁止穿透到 CollectionRegistry 内部判跨域。
- F016 GovernanceFilter 的 authority 排序必须以 Collection.authority_level 为权威源，禁止独立维护权威副本。
- F017 ConsumptionCollector 的 entry_id 必须存在于 CollectionRegistry，禁止"幽灵 entry"。
- F039 MindCodex 的 codex_entry 必须能反向追溯到 CollectionEntry.entry_id。

---

## 5. 架构验收

### 5.1 架构契约验收

- [ ] AC-1: 单向依赖通过——`flowforge/core/memory/collection/` 不 import F015/F016/F017/F039 任何模块。
- [ ] AC-2: DI 容器注入通过——`CollectionRegistry` 通过 `inject("collection_registry")` 获取，无直接 `CollectionRegistry` 调用。
- [ ] AC-3: Repository 层通过——所有持久化操作经 `CollectionRepository`，无 `cursor.execute` 直操作数据库。
- [ ] AC-4: 配置驱动通过——5 种 CollectionType 与权威等级均从 `config/memory_collections.yaml` 加载。
- [ ] AC-5: 跨域 join 在引擎层硬拒，单测覆盖 5×5 跨类型组合。
- [ ] AC-6: provenance 空字符串 entry 在 register 阶段被拒绝（单测覆盖）。

### 5.2 架构不变量验收

- [ ] AC-7: 五种 CollectionType 物理隔离存储（不同表/不同库），SQL 层无法 join。
- [ ] AC-8: 每条 entry 的 authority 等于其 Collection.authority_level（断言遍历）。
- [ ] AC-9: archived 状态条目不出现在 list_by_type 默认结果中。
- [ ] AC-10: personal_context Collection 在 owner_forgekin_id 为空时被拒绝注册。
- [ ] AC-11: CollectionRegistry 单例性——多次 inject 返回同一对象（id 相等）。

---

## 6. 引用

- [doc:../spec.md#§3.4]
- [doc:../arch.md#§3.4]
- [doc:../features/F014-memory-collection.md]
- [doc:../features/F015-three-retrieval-entry.md]
- [doc:../features/F016-memory-governance.md]
- [doc:../features/F017-consumption-weighted-ranking.md]
- [doc:../features/F039-mind-codex-searchable.md]
- [doc:../decisions/008-memory-federation.md]
- [doc:../../../hiclaw/rules.md#第十一部分]
- [doc:../../../hiclaw/rules.md#编程红线]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（架构骨架 + 组件图 + 接口契约 + 跨模块不变量） | 架构师 Forgekin（猫头鹰·鲁班） |
