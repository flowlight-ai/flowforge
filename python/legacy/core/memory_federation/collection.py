"""MemoryCollection — 多域记忆 Collection 模块。

实现 roleagent.md §4.3 L4 Collection 层：
    - MemoryCollection: 记忆集合（一个领域一个集合，跨项目持续）
    - MemoryEntry: 记忆条目（带消费计数和最末访问时间——治理信号源）
    - CollectionManager: 集合管理器（CRUD + 内存索引）

设计依据：
    - F014-memory-collection.md
    - roleagent.md §4.3 多域记忆联邦六层架构
    - roleagent.md §4.4 消费加权排序（consumption_count 是核心行为信号）

铁律遵守：
    - 铁律 3：通过构造函数注入 logger / backend，不直接实例化外部服务
    - 铁律 4：禁止直接操作数据库，所有持久化通过 backend 抽象层（注入）
    - 铁律 5：无硬编码路径/密钥
    - 编程红线 9：使用组合（Pydantic 字段 + backend 注入）而非继承

License: MIT
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional, Protocol, runtime_checkable

from pydantic import BaseModel, Field

from flowforge.core.tracing import TraceLogger, get_logger

logger = get_logger("memory_federation.collection")


# ──────────────────────────────────────────────────────────────────────────────
# 持久化后端抽象（铁律 4：禁止直接操作数据库）
# ──────────────────────────────────────────────────────────────────────────────


@runtime_checkable
class CollectionBackend(Protocol):
    """集合持久化后端协议——所有持久化通过此抽象层。

    铁律 4：禁止直接操作数据库。具体实现可以是：
        - InMemoryCollectionBackend（默认，单 session 用）
        - SqliteCollectionBackend（跨 session 用，调用方注入）
        - PostgresCollectionBackend（生产用，调用方注入）

    协议方法签名与 CollectionManager 的持久化操作一一对应。
    """

    async def save_collection(self, collection: "MemoryCollection") -> None:
        """保存或更新集合。"""
        ...

    async def load_collection(
        self, collection_id: str
    ) -> Optional["MemoryCollection"]:
        """加载集合（不存在返回 None）。"""
        ...

    async def list_collections(self) -> list["MemoryCollection"]:
        """列出所有集合。"""
        ...


# ──────────────────────────────────────────────────────────────────────────────
# 数据模型
# ──────────────────────────────────────────────────────────────────────────────


class MemoryEntry(BaseModel):
    """记忆条目——单个原子记忆单元。

    roleagent.md §4.4：记忆重要性不靠自评，靠消费信号。
    consumption_count + last_accessed 是消费加权排序的核心输入。

    Attributes:
        entry_id: 条目唯一标识（自动生成 UUID）。
        content: 记忆内容文本。
        source: 来源标识（如 agent_id / tool / file_path）。
        tags: 标签列表（用于 Index 入口过滤）。
        consumption_count: 消费次数（被引用 / 被复用次数）。
            每次检索命中并返回给 agent 时由调用方自增。
        last_accessed: 最后访问时间 ISO 8601。
        created_at: 创建时间 ISO 8601。
        authority_level: 权威等级（0.0-1.0，由治理层计算后注入）。
    """

    entry_id: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        description="条目唯一标识",
    )
    content: str = Field(..., description="记忆内容文本")
    source: str = Field(default="", description="来源标识")
    tags: list[str] = Field(default_factory=list, description="标签列表")
    consumption_count: int = Field(
        default=0, ge=0, description="消费次数（行为信号）"
    )
    last_accessed: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(),
        description="最后访问时间 ISO 8601",
    )
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(),
        description="创建时间 ISO 8601",
    )
    authority_level: float = Field(
        default=0.5,
        ge=0.0,
        le=1.0,
        description="权威等级（由治理层计算后注入）",
    )

    def mark_consumed(self) -> "MemoryEntry":
        """标记为已消费——返回新的 MemoryEntry（不修改原对象）。

        consumption_count += 1，last_accessed 更新为当前时间。
        返回新对象以保持不可变语义（便于 trace / 回滚）。
        """
        return self.model_copy(
            update={
                "consumption_count": self.consumption_count + 1,
                "last_accessed": datetime.now(timezone.utc).isoformat(),
            }
        )


class MemoryCollection(BaseModel):
    """记忆集合——一个领域一个 Collection。

    roleagent.md §4.3 L4：Collection 是沉淀领域知识的容器，跨项目持续。
    每个集合对应一个领域（如 programming / finance / medicine），
    集合内的条目共享 domain 和 authority_level。

    Attributes:
        collection_id: 集合唯一标识（自动生成 UUID）。
        name: 集合名称（如 "python_async_patterns"）。
        domain: 所属领域（如 programming / finance / medicine）。
        entries: 记忆条目列表。
        authority_level: 集合级权威等级（默认 0.5，可被治理层覆盖）。
        created_at: 创建时间 ISO 8601。
    """

    collection_id: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        description="集合唯一标识",
    )
    name: str = Field(..., description="集合名称")
    domain: str = Field(..., description="所属领域")
    entries: list[MemoryEntry] = Field(
        default_factory=list, description="记忆条目列表"
    )
    authority_level: float = Field(
        default=0.5, ge=0.0, le=1.0, description="集合级权威等级"
    )
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(),
        description="创建时间 ISO 8601",
    )


# ──────────────────────────────────────────────────────────────────────────────
# CollectionManager
# ──────────────────────────────────────────────────────────────────────────────


class CollectionManager:
    """集合管理器——CRUD + 内存索引 + 可选持久化。

    铁律 3：通过构造函数注入 logger / backend，不直接实例化外部服务。
    铁律 4：所有持久化通过 backend 抽象层（Protocol），不直接操作数据库。

    Args:
        logger: TraceLogger 实例。若未注入，使用默认 logger。
        backend: 可选的持久化后端（实现 CollectionBackend 协议）。
            None 表示纯内存模式（测试 / 单 session 用）。
            生产环境由 DI 容器注入 SqliteCollectionBackend 等。
    """

    def __init__(
        self,
        logger: Optional[TraceLogger] = None,
        backend: Optional[Any] = None,
    ) -> None:
        self._logger: TraceLogger = logger or get_logger(
            "memory_federation.collection_manager"
        )
        self._backend = backend
        self._collections: dict[str, MemoryCollection] = {}

    async def create(self, name: str, domain: str) -> MemoryCollection:
        """创建新集合并返回。

        Args:
            name: 集合名称（如 "python_async_patterns"）。
            domain: 所属领域（如 "programming"）。

        Returns:
            新创建的 MemoryCollection。
        """
        collection = MemoryCollection(name=name, domain=domain)
        self._collections[collection.collection_id] = collection
        if self._backend is not None:
            await self._backend.save_collection(collection)
        self._logger.info(
            f"Created collection '{name}' (domain={domain}, "
            f"id={collection.collection_id})"
        )
        return collection

    async def add_entry(
        self, collection_id: str, entry: MemoryEntry
    ) -> None:
        """向集合添加记忆条目。

        Args:
            collection_id: 目标集合 ID。
            entry: 要添加的记忆条目。

        Raises:
            KeyError: 集合不存在。
        """
        collection = self._collections.get(collection_id)
        if collection is None:
            raise KeyError(f"Collection not found: {collection_id}")
        collection.entries.append(entry)
        if self._backend is not None:
            await self._backend.save_collection(collection)
        self._logger.debug(
            f"Added entry {entry.entry_id} to collection {collection_id}"
        )

    async def get(
        self, collection_id: str
    ) -> Optional[MemoryCollection]:
        """获取集合（不存在返回 None）。"""
        collection = self._collections.get(collection_id)
        if collection is None and self._backend is not None:
            # 尝试从后端加载
            collection = await self._backend.load_collection(collection_id)
            if collection is not None:
                self._collections[collection_id] = collection
        return collection

    async def list_collections(self) -> list[MemoryCollection]:
        """列出所有集合。"""
        if self._backend is not None:
            backend_collections = await self._backend.list_collections()
            for c in backend_collections:
                if c.collection_id not in self._collections:
                    self._collections[c.collection_id] = c
        return list(self._collections.values())

    async def find_by_domain(self, domain: str) -> list[MemoryCollection]:
        """按领域过滤集合。

        Args:
            domain: 领域标识。

        Returns:
            匹配领域的集合列表。
        """
        all_collections = await self.list_collections()
        return [c for c in all_collections if c.domain == domain]
