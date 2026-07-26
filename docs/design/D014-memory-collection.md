# D014: 多域记忆 Collection 详细设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 开发者 Forgekin（猎犬·夏洛克）
> **对应 spec.md**: [doc:../spec.md#§3.4]（FR-CORE-004）
> **对应 arch.md**: [doc:../arch.md#§3.4]
> **对应 design.md**: [doc:../design.md#§3.4]
> **对应 Feature**: [doc:../features/F014-memory-collection.md]（同号 Feature 级 SRS）
> **对应 Architecture**: [doc:../architecture/A014-memory-collection.md]（同号 Feature 级 SAD）
> **依赖 ADR**: [doc:../decisions/008-memory-federation.md]

---

## 1. 详细设计上下文

### 1.1 设计问题

Forgekin（Evolvable Agent，社区社交称"可进化智能体"）在执行任务时需要从多个相互独立的"知识域"读取上下文：项目权威资料（spec/ADR/git）、个人偏好、外部知识库、虚拟世界设定、情景记忆（EchoStore）。A014 架构设计已确认 L1 真相源 Collection 层需要建立域隔离、权威继承、生命周期可治理、来源可溯源的统一容器模型。

本详细设计进一步下沉到代码层，需要解决以下子问题：

1. **物理隔离的实现细节**：5 种 CollectionType 在物理层分库/分表的具体实现路径（SQLAlchemy 多 schema 拆分 vs 多数据库拆分）。
2. **权威继承的注入时机**：`CollectionEntry` 读出时由 Repository 注入 `authority` 的具体钩子位置与注入失败回退策略。
3. **provenance 校验的强类型化**：`provenance` 字段如何从字符串升级为 `Provenance` Pydantic 模型（含 type + ref + captured_at），保留向后兼容。
4. **LifecycleEventBus 的事件幂等**：状态变更事件如何在多次触发时保证幂等，避免 F016/F017 收到重复信号。
5. **CollectionRegistry 单例的 DI 注入路径**：DI 容器中 `inject("collection_registry")` 的具体绑定规则与生命周期。
6. **跨域 join 仲裁的性能**：5×5 类型组合的仲裁如何在不引入缓存的前提下保持 < 5ms 响应。

### 1.2 设计约束

- **单向依赖约束**：`flowforge/core/memory/collection/` 是 L1 底座，禁止 import F015/F016/F017/F039 任何模块（编程红线第 10 条延伸）。
- **DI 容器约束**：`CollectionRegistry` 必须通过 DI 容器注入，绑定生命周期为 `singleton`，禁止 `CollectionRegistry` 直接实例化（编程红线第 12 条）。
- **Repository 层约束**：所有 Collection 元数据持久化必须经 `CollectionRepository` 抽象，禁止 `cursor.execute("INSERT INTO collections ...")` 直操作数据库（编程红线第 13 条）。
- **配置驱动约束**：Collection 类型、权威等级、域隔离策略、物理存储后端选择必须外置 YAML（编程红线第 11 条）。
- **可插拔数据源适配器约束**：Collection 条目的非结构化检索通过 Repository 层抽象调用可插拔数据源适配器，不另起向量库。
- **异步约束**：所有 I/O 操作使用 `async/await`，禁止同步阻塞调用。
- **类型注解约束**：Python 3.11+，所有公共方法强制类型注解。
- **提示词外置约束**：本模块不涉及提示词，但错误信息模板需外置到 `config/error_messages.yaml`。

### 1.3 设计影响

- **对 L2 治理层（F016/A016）**：`authority_level` 字段成为治理三要素 `Authority` 的物理承载，治理层不再独立维护权威数据。本设计需保证 `Collection.authority_level` 的不可变性（创建后不可修改）。
- **对 L3 检索层（F015/A015）**：三检索入口必须强制 `collections` 过滤参数，跨域 join 在引擎层硬拒。本设计需提供 `cross_domain_join_check` 的同步快速路径。
- **对 L4 消费排序（F017/A017）**：`entry_id` 成为消费信号的聚合粒度。本设计需保证 `entry_id` 全局唯一（UUID v7 时序排序）。
- **对 L6 蒸馏知识库（F039/A039）**：MindCodex 是 `external_knowledge` 类型 Collection 的特化，复用同一容器模型。本设计需暴露 `register` 供蒸馏知识库初始化调用。
- **对 F020 七类归因矩阵**：`provenance` 字段成为"翻译偏差 / 环境漂移"归因的溯源依据。本设计需保证 `provenance` 强类型可被归因器解析。
- **对 DI 容器**：需新增 `collection_registry` / `collection_repository` 两个绑定。
- **对数据库 schema**：需新增 `collections` / `collection_entries` / `collection_provenance` 三张表，按 CollectionType 物理分表。

---

## 2. 详细设计

### 2.1 类图 ASCII

```
┌──────────────────────────────────────────────────────────────────────┐
│                       <<module>> collection                          │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  <<enum>> CollectionType           <<enum>> CollectionLifecycle      │
│  + PROJECT_MEMORY                  + ACTIVE                          │
│  + PERSONAL_CONTEXT                + PENDING_REVIEW                  │
│  + EXTERNAL_KNOWLEDGE              + DEPRECATED                      │
│  + VIRTUAL_WORLD                  + ARCHIVED                         │
│  + EPISODIC_TRACE                                                    │
│                                                                      │
│  <<enum>> ProvenanceType                                            │
│  + EPISODE_ID                       <<model>> Provenance              │
│  + DOC_URI                         + type: ProvenanceType             │
│  + DECISION_ID                     + ref: str                         │
│  + GIT_COMMIT                      + captured_at: datetime            │
│                                    + raw_uri: str                     │
│                                                                      │
│  <<model>> Collection              <<model>> CollectionEntry          │
│  + collection_id: str              + entry_id: str                    │
│  + name: str                       + collection_id: str                │
│  + collection_type: CollectionType + payload: dict                   │
│  + authority_level: int [1..5]     + authority: int (inherited)      │
│  + owner_forgekin_id: str?         + provenance: Provenance           │
│  + source_uri: str                 + lifecycle_status                 │
│  + lifecycle_status               + created_at: datetime              │
│  + entry_count: int                                                  │
│  + created_at: datetime            <<model>> CollectionConfig         │
│  + schema_version: str             + cross_domain_join: "forbidden"   │
│                                    + require_provenance: bool         │
│  <<interface>> CollectionRegistry  + physical_isolation: bool         │
│  + register(collection): str       + storage_backend: "sqlite"|"pg"   │
│  + list_by_type(ctype): list                                         │
│  + archive(id): void               <<interface>> CollectionRepo      │
│  + append_entry(entry): str       + insert_collection(c)              │
│  + cross_domain_join_check(ids)    + query_by_type(t)                  │
│                                    + update_lifecycle(id, s)          │
│  <<interface>> LifecycleEventBus    + insert_entry(e)                  │
│  + emit(event_type, payload)       + query_entries(filter)            │
│  + subscribe(event_type, handler)                                     │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.2 接口实现 Python 代码

```python
# flowforge/core/memory/collection/registry.py
from __future__ import annotations
from abc import ABC, abstractmethod
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict
from enum import Enum


class CollectionType(str, Enum):
    PROJECT_MEMORY = "project_memory"
    PERSONAL_CONTEXT = "personal_context"
    EXTERNAL_KNOWLEDGE = "external_knowledge"
    VIRTUAL_WORLD = "virtual_world"
    EPISODIC_TRACE = "episodic_trace"


class CollectionLifecycle(str, Enum):
    ACTIVE = "active"
    PENDING_REVIEW = "pending_review"
    DEPRECATED = "deprecated"
    ARCHIVED = "archived"


class ProvenanceType(str, Enum):
    EPISODE_ID = "episode_id"
    DOC_URI = "doc_uri"
    DECISION_ID = "decision_id"
    GIT_COMMIT = "git_commit"


class Provenance(BaseModel):
    """条目溯源信息（强类型，替代 A014 中的纯字符串）"""
    model_config = ConfigDict(frozen=True)

    type: ProvenanceType
    ref: str = Field(min_length=1)
    captured_at: datetime
    raw_uri: str = Field(min_length=1)

    def to_flat(self) -> str:
        """扁平化为存储字符串，向后兼容 A014 provenance:str"""
        return f"{self.type.value}:{self.ref}@{self.captured_at.isoformat}"


class Collection(BaseModel):
    model_config = ConfigDict(frozen=True)  # 不可变，确保 authority_level 创建后不被覆盖

    collection_id: str = Field(min_length=1)
    name: str = Field(min_length=1, max_length=128)
    collection_type: CollectionType
    authority_level: int = Field(ge=1, le=5)
    owner_forgekin_id: Optional[str] = None  # personal_context 必填
    source_uri: str = Field(min_length=1)
    lifecycle_status: CollectionLifecycle = CollectionLifecycle.ACTIVE
    entry_count: int = Field(default=0, ge=0)
    created_at: datetime
    schema_version: str = "1.0"


class CollectionEntry(BaseModel):
    """条目模型；authority 字段在 Repository 注入时由 Collection.authority_level 继承"""
    model_config = ConfigDict

    entry_id: str = Field(min_length=1)
    collection_id: str = Field(min_length=1)
    payload: dict
    authority: int = Field(ge=1, le=5)  # 由 Repository 从 Collection 继承注入
    provenance: Provenance  # 强类型，替代 A014 中的 str
    lifecycle_status: CollectionLifecycle = CollectionLifecycle.ACTIVE
    created_at: datetime


class CrossDomainJoinForbidden(Exception):
    """跨域 join 被禁止时抛出"""
    def __init__(self, collection_ids: list[str]):
        self.collection_ids = collection_ids
        super.__init__(
            f"Cross-domain join forbidden for collections: {collection_ids}"
        )


class ProvenanceMissingError(ValueError):
    """provenance 校验失败时抛出"""
    pass


class OwnerMissingError(ValueError):
    """personal_context Collection 缺失 owner 时抛出"""
    pass


class CollectionRegistry(ABC):
    """Collection 注册中心（DI 单例）"""

    @abstractmethod
    async def register(self, collection: Collection) -> str:
        """
        注册新 Collection：
        1. personal_context 必须 owner_forgekin_id 非空（否则 OwnerMissingError）
        2. authority_level 1-5 范围校验（Pydantic 已保证）
        3. 持久化
        4. 发射 LifecycleEventBus.registered 事件
        返回 collection_id
        """

    @abstractmethod
    async def list_by_type(
        self, ctype: CollectionType, include_archived: bool = False
    ) -> list[Collection]:
        """按类型列举；archived 默认不返回"""

    @abstractmethod
    async def archive(self, collection_id: str) -> None:
        """归档 Collection；触发 LifecycleEventBus.on_archive"""

    @abstractmethod
    async def append_entry(self, entry: CollectionEntry) -> str:
        """
        追加条目：
        1. provenance 非空校验（Pydantic 强类型已保证，但额外校验 ref 非空）
        2. cross_domain_join_check（与父 Collection 类型比对）
        3. authority 由 Repository 从 Collection 继承注入
        4. 发射 LifecycleEventBus.entry_appended 事件
        返回 entry_id
        """

    @abstractmethod
    async def cross_domain_join_check(self, collection_ids: list[str]) -> None:
        """
        跨域 join 仲裁：从 Repository 读出每个 Collection 类型，
        全部相同则放行，任一不同则抛 CrossDomainJoinForbidden。
        性能要求：5 个 collection_ids 时 < 5ms。
        """


class CollectionRepository(ABC):
    """Repository 层抽象（禁直操作数据库）"""

    @abstractmethod
    async def insert_collection(self, collection: Collection) -> str: ...

    @abstractmethod
    async def query_by_type(
        self, ctype: CollectionType, include_archived: bool = False
    ) -> list[Collection]: ...

    @abstractmethod
    async def update_lifecycle(
        self, collection_id: str, status: CollectionLifecycle
    ) -> None: ...

    @abstractmethod
    async def insert_entry(self, entry: CollectionEntry) -> str: ...

    @abstractmethod
    async def query_entries(
        self,
        collection_id: str,
        authority_floor: int = 1,
        include_archived: bool = False,
        limit: int = 100,
    ) -> list[CollectionEntry]: ...

    @abstractmethod
    async def get_collection(self, collection_id: str) -> Optional[Collection]: ...

    @abstractmethod
    async def get_authority_level(self, collection_id: str) -> int:
        """读取 Collection.authority_level 供 entry 继承注入"""
```

### 2.3 数据结构 Pydantic Models

```python
# flowforge/core/memory/collection/models.py
from __future__ import annotations
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field, model_validator
from .registry import (
    Collection, CollectionEntry, CollectionType, CollectionLifecycle,
    Provenance, ProvenanceType,
)


class CollectionConfig(BaseModel):
    """YAML 配置加载结果"""
    cross_domain_join: str = "forbidden"  # 唯一允许值
    require_provenance: bool = True
    physical_isolation: bool = True
    storage_backend: str = "sqlite"  # sqlite | postgres
    max_entries_per_collection: int = Field(default=100_000, ge=1)
    archive_retention_days: int = Field(default=365, ge=1)
    schema_version: str = "1.0"


class CollectionRegistrationRequest(BaseModel):
    """对外暴露的注册请求（隐藏内部字段）"""
    name: str = Field(min_length=1, max_length=128)
    collection_type: CollectionType
    authority_level: int = Field(ge=1, le=5)
    owner_forgekin_id: Optional[str] = None
    source_uri: str = Field(min_length=1)

    @model_validator(mode="after")
    def _validate_personal_context_owner(self) -> "CollectionRegistrationRequest":
        if self.collection_type == CollectionType.PERSONAL_CONTEXT and not self.owner_forgekin_id:
            raise ValueError("personal_context Collection 必须带 owner_forgekin_id")
        return self


class CollectionEntryAppendRequest(BaseModel):
    """对外暴露的 entry 追加请求"""
    collection_id: str = Field(min_length=1)
    payload: dict
    provenance_type: ProvenanceType
    provenance_ref: str = Field(min_length=1)
    provenance_raw_uri: str = Field(min_length=1)


class LifecycleEvent(BaseModel):
    """生命周期事件（写入 LifecycleEventBus）"""
    event_id: str  # UUID v7，幂等键
    event_type: str  # registered / entry_appended / archived / deprecated
    collection_id: str
    entry_id: Optional[str] = None
    payload: dict
    emitted_at: datetime


class CollectionStats(BaseModel):
    """Collection 统计信息（供 F040 控制面消费）"""
    collection_id: str
    collection_type: CollectionType
    entry_count: int
    active_count: int
    deprecated_count: int
    archived_count: int
    last_entry_at: Optional[datetime] = None
```

### 2.4 关键算法伪代码

#### 2.4.1 跨域 join 仲裁算法（同步快速路径）

```
function cross_domain_join_check(collection_ids: list[str]) -> None:
    # 快速路径：单个 collection 永远放行
    if len(collection_ids) <= 1:
        return

    # 批量查询每个 collection 的 type
    types = []
    for id in collection_ids:
        collection = await repository.get_collection(id)
        if collection is None:
            raise CollectionNotFoundError(id)
        types.append(collection.collection_type)

    # 全部相同则放行
    first_type = types[0]
    for t in types[1:]:
        if t != first_type:
            raise CrossDomainJoinForbidden(collection_ids)

    # 通过
    return
```

**优化**：对 5 个 collection_ids 的批量查询使用 `asyncio.gather` 并行，预期 < 5ms（SQLite 单机）或 < 15ms（PostgreSQL 网络往返）。

#### 2.4.2 authority 继承注入算法

```
function append_entry(entry: CollectionEntry) -> str:
    # 1. 校验 provenance 强类型非空（Pydantic 已保证）
    if entry.provenance.ref is empty:
        raise ProvenanceMissingError

    # 2. 读取父 Collection 的 authority_level
    parent_authority = await repository.get_authority_level(entry.collection_id)

    # 3. 校验 entry.authority 必须等于父 Collection.authority_level
    #    （调用方传入的 authority 字段在 Repository 层被覆盖，确保不可单独覆盖）
    entry.authority = parent_authority  # 强制继承

    # 4. cross_domain_join_check 隐含在 register 阶段，append_entry 不再重复
    #    但需校验 collection_id 存在且非 archived
    parent = await repository.get_collection(entry.collection_id)
    if parent.lifecycle_status == ARCHIVED:
        raise ArchivedCollectionWriteError(entry.collection_id)

    # 5. 持久化（Repository 在 insert_entry 时按 collection_type 路由到对应物理表）
    entry_id = await repository.insert_entry(entry)

    # 6. 发射事件（幂等，event_id 作幂等键）
    event = LifecycleEvent(
        event_id=uuid_v7,
        event_type="entry_appended",
        collection_id=entry.collection_id,
        entry_id=entry_id,
        payload={"authority": entry.authority},
        emitted_at=now,
    )
    await event_bus.emit(event)

    return entry_id
```

#### 2.4.3 物理分表路由算法

```
function route_to_physical_table(collection_type: CollectionType) -> str:
    mapping = {
        PROJECT_MEMORY:     "collections_project_memory",
        PERSONAL_CONTEXT:   "collections_personal_context",
        EXTERNAL_KNOWLEDGE: "collections_external_knowledge",
        VIRTUAL_WORLD:      "collections_virtual_world",
        EPISODIC_TRACE:     "collections_episodic_trace",
    }
    return mapping[collection_type]
```

**约束**：SQLAlchemy ORM 的 `__tablename__` 在插入时根据 `collection_type` 动态选择，查询时通过 Repository 的 `query_by_type` 直接路由到对应表，避免跨表 join。

---

## 3. 模块实现

### 3.1 关键代码片段

#### 3.1.1 CollectionRegistry 具体实现

```python
# flowforge/core/memory/collection/registry_impl.py
from __future__ import annotations
from datetime import datetime, timezone
from uuid import uuid7
from .registry import (
    CollectionRegistry, CollectionRepository, Collection, CollectionEntry,
    CollectionType, CollectionLifecycle, CrossDomainJoinForbidden,
    ProvenanceMissingError, OwnerMissingError,
)
from .models import LifecycleEvent
from ..events import LifecycleEventBus
import asyncio


class SqlAlchemyCollectionRegistry(CollectionRegistry):
    """基于 SQLAlchemy 的 CollectionRegistry 实现（DI 单例）"""

    def __init__(
        self,
        repository: CollectionRepository,
        event_bus: LifecycleEventBus,
    ):
        self._repo = repository
        self._bus = event_bus
        # 缓存 collection_id → collection_type 的映射（用于快速 cross_domain_check）
        # 注意：缓存必须与 archive/register 同步失效，通过 event_bus 订阅失效
        self._type_cache: dict[str, CollectionType] = {}
        self._cache_lock = asyncio.Lock

    async def register(self, collection: Collection) -> str:
        # 校验 personal_context owner
        if (collection.collection_type == CollectionType.PERSONAL_CONTEXT
                and not collection.owner_forgekin_id):
            raise OwnerMissingError(
                "personal_context Collection 必须带 owner_forgekin_id"
            )

        # 持久化（Repository 按 collection_type 路由到对应物理表）
        collection_id = await self._repo.insert_collection(collection)

        # 更新类型缓存
        async with self._cache_lock:
            self._type_cache[collection_id] = collection.collection_type

        # 发射 registered 事件（幂等：event_id 唯一）
        event = LifecycleEvent(
            event_id=str(uuid7),
            event_type="registered",
            collection_id=collection_id,
            payload={"collection_type": collection.collection_type.value},
            emitted_at=datetime.now(timezone.utc),
        )
        await self._bus.emit(event)

        return collection_id

    async def list_by_type(
        self, ctype: CollectionType, include_archived: bool = False
    ) -> list[Collection]:
        return await self._repo.query_by_type(ctype, include_archived=include_archived)

    async def archive(self, collection_id: str) -> None:
        await self._repo.update_lifecycle(
            collection_id, CollectionLifecycle.ARCHIVED
        )
        # 缓存失效
        async with self._cache_lock:
            self._type_cache.pop(collection_id, None)
        # 发射 archived 事件
        event = LifecycleEvent(
            event_id=str(uuid7),
            event_type="archived",
            collection_id=collection_id,
            payload={},
            emitted_at=datetime.now(timezone.utc),
        )
        await self._bus.emit(event)

    async def append_entry(self, entry: CollectionEntry) -> str:
        # 1. provenance 强校验
        if not entry.provenance or not entry.provenance.ref:
            raise ProvenanceMissingError("provenance.ref must be non-empty")

        # 2. 读取父 Collection
        parent = await self._repo.get_collection(entry.collection_id)
        if parent is None:
            raise KeyError(f"Collection not found: {entry.collection_id}")
        if parent.lifecycle_status == CollectionLifecycle.ARCHIVED:
            raise ValueError(
                f"Cannot append to archived collection: {entry.collection_id}"
            )

        # 3. 强制 authority 继承（覆盖调用方传入值）
        entry.authority = parent.authority_level

        # 4. 持久化
        entry_id = await self._repo.insert_entry(entry)

        # 5. 发射 entry_appended 事件
        event = LifecycleEvent(
            event_id=str(uuid7),
            event_type="entry_appended",
            collection_id=entry.collection_id,
            entry_id=entry_id,
            payload={"authority": entry.authority},
            emitted_at=datetime.now(timezone.utc),
        )
        await self._bus.emit(event)

        return entry_id

    async def cross_domain_join_check(
        self, collection_ids: list[str]
    ) -> None:
        if len(collection_ids) <= 1:
            return

        # 批量查询类型（并行）
        async def _get_type(cid: str) -> CollectionType:
            async with self._cache_lock:
                if cid in self._type_cache:
                    return self._type_cache[cid]
            # 缓存未命中，查 Repository
            collection = await self._repo.get_collection(cid)
            if collection is None:
                raise KeyError(f"Collection not found: {cid}")
            async with self._cache_lock:
                self._type_cache[cid] = collection.collection_type
            return collection.collection_type

        types = await asyncio.gather(*[_get_type(c) for c in collection_ids])

        # 全部相同则放行
        first = types[0]
        for t in types[1:]:
            if t != first:
                raise CrossDomainJoinForbidden(collection_ids)
```

#### 3.1.2 Repository SQLAlchemy 实现

```python
# flowforge/core/memory/collection/repository_impl.py
from __future__ import annotations
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from .registry import (
    CollectionRepository, Collection, CollectionEntry,
    CollectionType, CollectionLifecycle,
)
from .schema import (
    CollectionProjectMemoryModel, CollectionPersonalContextModel,
    CollectionExternalKnowledgeModel, CollectionVirtualWorldModel,
    CollectionEpisodicTraceModel,
    CollectionEntryModel,
)


_TYPE_TO_TABLE = {
    CollectionType.PROJECT_MEMORY: CollectionProjectMemoryModel,
    CollectionType.PERSONAL_CONTEXT: CollectionPersonalContextModel,
    CollectionType.EXTERNAL_KNOWLEDGE: CollectionExternalKnowledgeModel,
    CollectionType.VIRTUAL_WORLD: CollectionVirtualWorldModel,
    CollectionType.EPISODIC_TRACE: CollectionEpisodicTraceModel,
}


class SqlAlchemyCollectionRepository(CollectionRepository):
    """SQLAlchemy 实现（禁直操作数据库，必须经 ORM）"""

    def __init__(self, session_factory):
        self._session_factory = session_factory  # async session factory

    async def insert_collection(self, collection: Collection) -> str:
        table = _TYPE_TO_TABLE[collection.collection_type]
        async with self._session_factory as session:  # type: AsyncSession
            row = table(**collection.model_dump)
            session.add(row)
            await session.commit
            return collection.collection_id

    async def query_by_type(
        self, ctype: CollectionType, include_archived: bool = False
    ) -> list[Collection]:
        table = _TYPE_TO_TABLE[ctype]
        async with self._session_factory as session:
            stmt = select(table).where(table.collection_type == ctype.value)
            if not include_archived:
                stmt = stmt.where(table.lifecycle_status != CollectionLifecycle.ARCHIVED.value)
            result = await session.execute(stmt)
            return [Collection.model_validate(row.__dict__) for row in result.scalars]

    async def update_lifecycle(
        self, collection_id: str, status: CollectionLifecycle
    ) -> None:
        # 需先查 collection_type 再路由到对应表
        async with self._session_factory as session:
            for ctype, table in _TYPE_TO_TABLE.items:
                stmt = (
                    update(table)
                    .where(table.collection_id == collection_id)
                    .values(lifecycle_status=status.value)
                )
                result = await session.execute(stmt)
                if result.rowcount > 0:
                    await session.commit
                    return
            raise KeyError(f"Collection not found: {collection_id}")

    async def insert_entry(self, entry: CollectionEntry) -> str:
        async with self._session_factory as session:
            row = CollectionEntryModel(**entry.model_dump)
            session.add(row)
            await session.commit
            return entry.entry_id

    async def query_entries(
        self,
        collection_id: str,
        authority_floor: int = 1,
        include_archived: bool = False,
        limit: int = 100,
    ) -> list[CollectionEntry]:
        async with self._session_factory as session:
            stmt = (
                select(CollectionEntryModel)
                .where(CollectionEntryModel.collection_id == collection_id)
                .where(CollectionEntryModel.authority >= authority_floor)
            )
            if not include_archived:
                stmt = stmt.where(
                    CollectionEntryModel.lifecycle_status != CollectionLifecycle.ARCHIVED.value
                )
            stmt = stmt.limit(limit)
            result = await session.execute(stmt)
            return [CollectionEntry.model_validate(row.__dict__) for row in result.scalars]

    async def get_collection(self, collection_id: str) -> Optional[Collection]:
        async with self._session_factory as session:
            for ctype, table in _TYPE_TO_TABLE.items:
                stmt = select(table).where(table.collection_id == collection_id)
                result = await session.execute(stmt)
                row = result.scalar_one_or_none
                if row is not None:
                    return Collection.model_validate(row.__dict__)
            return None

    async def get_authority_level(self, collection_id: str) -> int:
        collection = await self.get_collection(collection_id)
        if collection is None:
            raise KeyError(f"Collection not found: {collection_id}")
        return collection.authority_level
```

#### 3.1.3 配置加载器

```python
# flowforge/core/memory/collection/config.py
from __future__ import annotations
from pathlib import Path
import yaml
from .models import CollectionConfig


class CollectionConfigLoader:
    """YAML 配置加载器（外置配置驱动）"""

    def __init__(self, config_path: str | Path):
        self._path = Path(config_path)

    def load(self) -> CollectionConfig:
        with open(self._path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        return CollectionConfig(**data["memory_collections"])
```

#### 3.1.4 DI 容器绑定

```python
# flowforge/core/di.py（片段，新增 collection 相关绑定）
def _register_collection_bindings(container: DIContainer, config: CollectionConfig):
    """注册 Collection 相关 DI 绑定"""
    # Repository（不是单例，每次注入新建 session）
    container.register_factory(
        "collection_repository",
        lambda: SqlAlchemyCollectionRepository(get_async_session_factory),
    )
    # Event Bus（单例）
    container.register_singleton(
        "lifecycle_event_bus",
        lambda: InMemoryLifecycleEventBus,
    )
    # Registry（单例，禁止 CollectionRegistry 直接实例化）
    container.register_singleton(
        "collection_registry",
        lambda: SqlAlchemyCollectionRegistry(
            repository=container.resolve("collection_repository"),
            event_bus=container.resolve("lifecycle_event_bus"),
        ),
    )
```

### 3.2 关键流程时序图

#### 3.2.1 Forgekin写入记忆条目时序图

```
Forgekin.act      CollectionRegistry    CollectionRepository    LifecycleEventBus    F016/F017 订阅者
    │                      │                       │                     │                      │
    │ append_entry(entry)  │                       │                     │                      │
    ├─────────────────────▶│                       │                     │                      │
    │                      │                       │                     │                      │
    │                      │ provenance 强校验      │                     │                      │
    │                      │（ref 非空）            │                     │                      │
    │                      │                       │                     │                      │
    │                      │ get_collection(id)    │                     │                      │
    │                      ├──────────────────────▶│                     │                      │
    │                      │                       │                     │                      │
    │                      │◀─── Collection ───────┤                     │                      │
    │                      │                       │                     │                      │
    │                      │ 校验 lifecycle != ARCHIVED                  │                      │
    │                      │ 强制 entry.authority = parent.authority_level                    │
    │                      │                       │                     │                      │
    │                      │ insert_entry(entry)   │                     │                      │
    │                      ├──────────────────────▶│                     │                      │
    │                      │                       │ 按 collection_type  │                      │
    │                      │                       │ 路由到对应物理表     │                      │
    │                      │                       │                     │                      │
    │                      │◀─── entry_id ─────────┤                     │                      │
    │                      │                       │                     │                      │
    │                      │ emit(entry_appended)  │                     │                      │
    │                      ├─────────────────────────────────────────────▶                      │
    │                      │                       │                     │                      │
    │                      │                       │                     │ notify subscribers  │
    │                      │                       │                     ├─────────────────────▶
    │                      │                       │                     │                      │
    │                      │                       │                     │                      │ F017 失效缓存
    │                      │                       │                     │                      │ F016 更新治理标签
    │                      │                       │                     │                      │
    │◀── entry_id ─────────┤                       │                     │                      │
    │                      │                       │                     │                      │
```

#### 3.2.2 跨域 join 仲裁时序图

```
F015 RetrievalFusion    CollectionRegistry    Type Cache    CollectionRepository
    │                         │                    │                │
    │ cross_domain_join_check │                    │                │
    │  ([c1, c2, c3])         │                    │                │
    ├────────────────────────▶│                    │                │
    │                         │                    │                │
    │                         │ 检查 len > 1       │                │
    │                         │                    │                │
    │                         │ 并行 get_type(c1)   │                │
    │                         │ 并行 get_type(c2)   │                │
    │                         │ 并行 get_type(c3)   │                │
    │                         │                    │                │
    │                         ├─── cache hit? ─────▶│                │
    │                         │◀── type or miss ───┤                │
    │                         │                    │                │
    │                         │  if cache miss:    │                │
    │                         │  get_collection(cN) │                │
    │                         ├─────────────────────────────────────▶│
    │                         │◀─── Collection ──────────────────────┤
    │                         │                    │                │
    │                         │ 写回 cache          │                │
    │                         │                    │                │
    │                         │ 比较 types         │                │
    │                         │ if 不一致:          │                │
    │                         │   raise CrossDomainJoinForbidden     │
    │                         │ else:               │                │
    │                         │   return            │                │
    │◀── void / exception ─────┤                    │                │
```

### 3.3 错误处理

| 异常类型 | 触发场景 | 处理策略 | 调用方预期 |
|---------|---------|---------|-----------|
| `OwnerMissingError` | personal_context Collection 注册时 owner_forgekin_id 为空 | 拒绝注册，返回 400 | 调用方补全 owner 后重试 |
| `ProvenanceMissingError` | entry.provenance.ref 为空字符串 | 拒绝追加，返回 400 | 调用方补全 provenance 后重试 |
| `CrossDomainJoinForbidden` | 跨域 join 检测到不同 CollectionType | 拒绝查询，返回 403 | 调用方拆分为多次同域查询 |
| `ArchivedCollectionWriteError` | 向 archived Collection 追加 entry | 拒绝追加，返回 409 | 调用方解归档或使用其他 Collection |
| `CollectionNotFoundError` | collection_id 不存在 | 拒绝操作，返回 404 | 调用方校验 collection_id 后重试 |
| `IntegrityError`（SQLAlchemy） | 主键冲突 / 唯一约束冲突 | 回滚事务，返回 409 | 调用方检查 idempotency 后重试 |
| `OperationalError`（SQLAlchemy） | 数据库连接断开 | 重试 1 次，仍失败则返回 503 | 调用方降级到只读模式 |
| `ValidationError`（Pydantic） | 字段类型/范围不合法 | 拒绝注册，返回 422 | 调用方修正字段后重试 |

**幂等性策略**：

- `LifecycleEvent.event_id` 使用 UUID v7（时序排序 + 唯一），EventBus 订阅方通过 `event_id` 去重。
- `Collection.collection_id` 与 `CollectionEntry.entry_id` 由调用方传入，调用方应使用 UUID v7 保证全局唯一。Repository 在 `insert_collection` / `insert_entry` 时若遇到主键冲突，直接返回已存在的 ID（幂等）。
- `cross_domain_join_check` 是只读操作，天然幂等。

### 3.4 性能优化

| 性能指标 | 目标值 | 优化手段 |
|---------|:------:|---------|
| `register` 延迟 | < 20ms | 单条 INSERT，无关联查询；EventBus 异步发射 |
| `append_entry` 延迟 | < 15ms | 单条 INSERT + 1 次父 Collection 查询；事件异步 |
| `list_by_type` 延迟 | < 50ms（100 条） | 直接路由到对应物理表，无跨表 join；按 collection_type 索引 |
| `cross_domain_join_check` 延迟 | < 5ms（5 个 collection_ids） | 内存缓存 `collection_id → type`，并行查询；缓存命中率 > 95% 时延迟 < 1ms |
| `get_authority_level` 延迟 | < 5ms | 内存缓存（与 cross_domain_join_check 共享 cache） |
| 物理表单表容量 | < 100w 条 | `max_entries_per_collection=100_000` 限制单 Collection 条目数 |
| 并发写入 | 100 QPS | SQLAlchemy 异步 + 数据库连接池（max_size=20） |

**缓存策略**：

- 类型缓存 `collection_id → CollectionType`：进程内字典，TTL 无限，通过 `archive` 主动失效。
- 不缓存 CollectionEntry：entry 数量可能巨大，全量缓存内存压力过大；entry 查询走索引。
- 不缓存 list_by_type 结果：active Collection 数量有限（< 100），直接查表足够快。

**索引设计**：

- `collections_<type>` 表：主键 `collection_id`，索引 `(collection_type, lifecycle_status)`、`(owner_forgekin_id)`。
- `collection_entries` 表：主键 `entry_id`，索引 `(collection_id, authority, lifecycle_status)`、`(provenance_type, provenance_ref)`。

---

## 4. 跨模块协作实现

### 4.1 上游依赖如何调用本模块

#### 4.1.1 F008 Durable State Surfaces 调用

F008 把 Collection 元数据作为 6 类持久状态表面之一（memory federation）。F008 的 DurableStateWriter 在写入时调用：

```python
# F008 侧代码（不在本模块）
from flowforge.core.di import inject

class DurableStateWriter:
    def __init__(self):
        self._registry = inject("collection_registry")

    async def persist_memory_federation(self, entry: CollectionEntry):
        # F008 规范要求所有写入受 durable_state 表面约束
        await self._registry.append_entry(entry)
```

**集成测试点**：F008 写入后，本模块必须能从 Repository 读出，且 authority 继承正确。

#### 4.1.2 F001 CapabilityProfile 调用

F001 校验 `owner_forgekin_id` 时查询Forgekin存在性。本模块在 `register` 阶段调用 F001 提供的 `forgekin_exists` 接口：

```python
# 本模块在 register 中调用 F001（注意：F001 是上游，本模块可以依赖）
class SqlAlchemyCollectionRegistry(CollectionRegistry):
    def __init__(self, repository, event_bus, capability_profile_service):
        self._capability = capability_profile_service  # F001 注入

    async def register(self, collection: Collection) -> str:
        if collection.owner_forgekin_id:
            if not await self._capability.forgekin_exists(collection.owner_forgekin_id):
                raise OwnerMissingError(f"forgekin not found: {collection.owner_forgekin_id}")
        # ... 后续逻辑
```

**注意**：F001 CapabilityProfile 是 L4 模块，本模块依赖 F001 不违反单向依赖（F001 在 capability 路径中早于 memory 路径）。

### 4.2 下游影响如何被调用

#### 4.2.1 F015 三检索入口如何消费本模块

F015 RetrievalFusion 在执行检索前调用本模块的 `cross_domain_join_check` 与 `list_by_type`：

```python
# F015 侧代码（不在本模块）
class RetrievalFusionImpl:
    def __init__(self):
        self._collection_registry = inject("collection_registry")

    async def search(self, query: RetrievalQuery) -> list[RetrievalHit]:
        # 1. 校验 collections 参数（域隔离）
        if not query.collections:
            raise ValueError("collections must be non-empty")
        # 2. 跨域 join 仲裁（调用本模块）
        await self._collection_registry.cross_domain_join_check(query.collections)
        # 3. 三入口并行检索...
```

**集成测试点**：F015 传入跨域 collection_ids 时，本模块必须抛 `CrossDomainJoinForbidden`，F015 必须在引擎层捕获并返回 403。

#### 4.2.2 F016 记忆治理三要素如何消费本模块

F016 GovernanceFilter 读取本模块的 `authority_level` 字段作为权威硬序依据：

```python
# F016 侧代码（不在本模块）
class GovernanceFilterImpl:
    def __init__(self):
        self._collection_registry = inject("collection_registry")

    async def filter(self, hits, context):
        for hit in hits:
            collection = await self._collection_registry.get_collection(hit.collection_id)
            # 用 collection.authority_level 做权威硬序
            ...
```

F016 还订阅 `LifecycleEventBus` 的 `archived` / `deprecated` 事件，及时更新治理标签。

#### 4.2.3 F017 消费加权排序如何消费本模块

F017 ConsumptionWeightedRanker 使用 `entry_id` 作为消费信号的聚合主键。`entry_id` 由本模块在 `append_entry` 中返回，F017 将其作为 `ConsumptionSignal.entry_id` 写入。

**集成测试点**：F017 收到的 `entry_id` 必须能在本模块 Repository 中查到，禁止"幽灵 entry"。

#### 4.2.4 F039 蒸馏知识库可检索知识库如何消费本模块

F039 MindCodex 复用 `external_knowledge` CollectionType，在初始化时调用 `register` 注册一个特殊的 Codex Collection：

```python
# F039 侧代码（不在本模块）
class MindCodexInitializer:
    async def initialize(self):
        codex_collection = Collection(
            collection_id="mind_codex_default",
            name="MindCodex Default",
            collection_type=CollectionType.EXTERNAL_KNOWLEDGE,
            authority_level=3,  # verified_decision
            source_uri="flowforge://forgemind/codex",
            ...
        )
        await self._registry.register(codex_collection)
```

**集成测试点**：F039 写入的 codex_entry 必须能被 F015 三检索入口的 index 类型查询到。

### 4.3 集成测试点

| 测试编号 | 场景 | 验证点 |
|---------|------|-------|
| IT-D014-001 | 注册 5 种 CollectionType 各 1 个 | 物理隔离存储到 5 张不同表 |
| IT-D014-002 | personal_context 注册时 owner_forgekin_id 为空 | 抛 OwnerMissingError |
| IT-D014-003 | 追加 entry 时 provenance.ref 为空 | 抛 ProvenanceMissingError |
| IT-D014-004 | 追加 entry 时 authority 与父 Collection 不一致 | Repository 强制覆盖为父 authority |
| IT-D014-005 | 跨域 join 检测（5×5 类型组合） | 全部抛 CrossDomainJoinForbidden |
| IT-D014-006 | 同域 join 检测（5 种类型各内 1 次） | 全部放行 |
| IT-D014-007 | archived Collection 追加 entry | 抛 ArchivedCollectionWriteError |
| IT-D014-008 | archive 后 list_by_type 默认不返回 | archived 不在默认结果中 |
| IT-D014-009 | LifecycleEventBus 事件幂等 | 重复发射相同 event_id 不触发下游重复处理 |
| IT-D014-010 | CollectionRegistry 单例性 | 多次 inject 返回同一对象（id 相等） |
| IT-D014-011 | F015 调用 cross_domain_join_check | 跨域查询被拒绝 |
| IT-D014-012 | F016 订阅 archived 事件 | 收到事件后更新治理标签 |
| IT-D014-013 | F017 收到 entry_id 后能查到 | 无幽灵 entry |
| IT-D014-014 | F039 注册 external_knowledge Collection | 复用同一容器模型成功 |
| IT-D014-015 | 100 并发 append_entry | 无死锁、无数据丢失 |

---

## 5. 详细设计验收

### 5.1 功能验收 AC

- [ ] **AC-F-1**: 5 种 CollectionType（PROJECT_MEMORY / PERSONAL_CONTEXT / EXTERNAL_KNOWLEDGE / VIRTUAL_WORLD / EPISODIC_TRACE）可独立注册与检索（IT-D014-001）。
- [ ] **AC-F-2**: 不同 CollectionType 物理隔离存储，SQL 层无法 join（IT-D014-005）。
- [ ] **AC-F-3**: `CollectionEntry.authority` 在 Repository 注入时由 `Collection.authority_level` 继承，调用方传入的 authority 字段被覆盖（IT-D014-004）。
- [ ] **AC-F-4**: 每条 entry 必须带强类型 `provenance`，`ref` 为空时被拒绝（IT-D014-003）。
- [ ] **AC-F-5**: `archived` 状态 Collection 不参与 `list_by_type` 默认结果，但物理保留可查（IT-D014-007/008）。
- [ ] **AC-F-6**: `personal_context` Collection 在 `owner_forgekin_id` 为空时被拒绝注册（IT-D014-002）。
- [ ] **AC-F-7**: `cross_domain_join_check` 覆盖 5×5 类型组合，全部抛 `CrossDomainJoinForbidden`（IT-D014-005）。
- [ ] **AC-F-8**: `LifecycleEventBus` 事件幂等，重复 event_id 不触发下游重复处理（IT-D014-009）。
- [ ] **AC-F-9**: `CollectionRegistry` 是 DI 单例，多次 inject 返回同一对象（IT-D014-010）。
- [ ] **AC-F-10**: F039 蒸馏知识库可注册 `external_knowledge` Collection 并复用容器模型（IT-D014-014）。

### 5.2 性能验收

- [ ] **AC-P-1**: `register` 延迟 < 20ms（P95，单机 SQLite）。
- [ ] **AC-P-2**: `append_entry` 延迟 < 15ms（P95，单机 SQLite）。
- [ ] **AC-P-3**: `list_by_type` 延迟 < 50ms（P95，100 条结果）。
- [ ] **AC-P-4**: `cross_domain_join_check` 延迟 < 5ms（P95，5 个 collection_ids，缓存命中）。
- [ ] **AC-P-5**: `cross_domain_join_check` 延迟 < 15ms（P95，5 个 collection_ids，缓存未命中）。
- [ ] **AC-P-6**: 100 并发 `append_entry` 无死锁、无数据丢失（IT-D014-015）。
- [ ] **AC-P-7**: 类型缓存命中率 > 95%（长期运行后采样统计）。

### 5.3 安全验收

- [ ] **AC-S-1**: 所有数据库操作经 Repository 层，无 `cursor.execute` 直操作数据库代码（静态扫描确认）。
- [ ] **AC-S-2**: 所有依赖通过 DI 容器注入，无 `CollectionRegistry` 直接实例化代码（静态扫描确认）。
- [ ] **AC-S-3**: 所有提示词外置 YAML，本模块代码中无硬编码提示词（静态扫描确认）。
- [ ] **AC-S-4**: `owner_forgekin_id` 字段在 personal_context Collection 中强制非空，防止跨Forgekin上下文泄露（IT-D014-002）。
- [ ] **AC-S-5**: 跨域 join 在引擎层硬拒，防止跨域数据污染（IT-D014-005）。
- [ ] **AC-S-6**: `provenance` 字段强制非空，确保所有记忆可溯源（IT-D014-003）。
- [ ] **AC-S-7**: Repository 层使用参数化查询（SQLAlchemy ORM 自动参数化），无 SQL 注入风险。

### 5.4 Eval 验收

- [ ] **AC-E-1**: 本模块作为 harness 组件，必须附 EvalContract（F018 五问）。
- [ ] **AC-E-2**: friction_metrics 包含：`append_entry_latency_ms` / `cross_domain_check_latency_ms` / `cache_hit_rate`。
- [ ] **AC-E-3**: regression_cases 覆盖 IT-D014-001 ~ IT-D014-015。
- [ ] **AC-E-4**: sunset_signals：`unused_days=90` / `friction_above_threshold=append_latency > 100ms` / `superseded_by=F039 codex`。
- [ ] **AC-E-5**: 信号采集器在 F019 SignalCollector 中注册：`memory_collection_latency_probe`。

---

## 6. 引用

- [doc:../spec.md#§3.4]
- [doc:../arch.md#§3.4]
- [doc:../design.md#§3.4]
- [doc:../features/F014-memory-collection.md]
- [doc:../architecture/A014-memory-collection.md]
- [doc:../features/F015-three-retrieval-entry.md]
- [doc:../features/F016-memory-governance.md]
- [doc:../features/F017-consumption-weighted-ranking.md]
- [doc:../features/F039-mind-codex-searchable.md]
- [doc:../decisions/008-memory-federation.md]
- [doc:../design/naming-contract.md#2.5]（EchoStore）
- [doc:../design/naming-contract.md#2.8]（MindCodex 蒸馏知识库）
- [doc:../../CONTRIBUTING.md]
- [doc:../../CONTRIBUTING.md#31-15-条编程红线违反即拒绝合入]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（详细设计骨架 + 类图 + Pydantic Models + 实现 + 时序图 + 错误处理 + 性能优化 + 跨模块协作 + AC） | 开发者 Forgekin（猎犬·夏洛克） |
