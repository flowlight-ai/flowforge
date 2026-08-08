# D021: 副作用日志 WAL 详细设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 开发者 Forgekin（猎犬·夏洛克）
> **对应 spec.md**: [doc:../spec.md#§3.6]（FR-CORE-006）
> **对应 arch.md**: [doc:../arch.md#§3.6]
> **对应 design.md**: [doc:../design.md#§3.6]
> **对应 Feature**: [doc:../features/F021-side-effect-wal.md]（同号 Feature 级 SRS）
> **对应 Architecture**: [doc:../architecture/A021-side-effect-wal.md]（同号 Feature 级 SAD）
> **依赖 ADR**: [doc:../decisions/010-distributed-reliability.md]

---

## 1. 详细设计上下文

### 1.1 设计问题

分布式可靠性（§3.6）的核心子系统之一是副作用日志 WAL（Write-Ahead Log），A021 架构设计已确认核心机制：
1. **先写后执行**：所有副作用在执行前必须先写入 WAL，确保可恢复
2. **幂等键去重**：每个副作用带 idempotency_key，重放时去重
3. **五态状态机**：pending → executing → confirmed / failed → rolled_back
4. **pre_state 分类**：副作用执行前的状态快照，用于回滚恢复
5. **六类副作用**：DB_WRITE / API_CALL / FILE_WRITE / MESSAGE_SEND / EXTERNAL_INTEGRATION / PROVIDER_CALL

本详细设计进一步下沉到代码层，需要解决以下子问题：

1. **WAL 物理存储选型**：SQLite WAL 模式 vs PostgreSQL WAL vs 文件追加日志的性能/可靠性权衡。
2. **先写后执行的原子性**：WAL append 与副作用执行之间存在窗口，如何用两阶段提交保证原子性。
3. **幂等键的全局唯一性**：跨 forgekin / 跨 cycle 的 idempotency_key 如何保证全局唯一。
4. **五态状态机的并发安全**：多 worker 并发推进同一 WAL entry 的状态变更时如何加锁。
5. **回滚的可逆性判定**：六类副作用的可逆性差异（DB_WRITE 可回滚，MESSAGE_SEND 不可回滚）如何在代码层声明。
6. **WAL 回放的顺序保证**：按 entry_id 顺序回放还是按 timestamp 顺序回放，如何处理乱序。
7. **WAL 文件膨胀控制**：长期运行下 WAL 文件无限增长，checkpoint 与 compaction 策略。
8. **跨进程 WAL 共享**：F024 强 workflow 与 F022 恢复器都需读 WAL，跨进程读一致性如何保证。

### 1.2 设计约束

- **单向依赖约束**：`flowforge/core/reliability/wal/` 是 §3.6 的底座，禁止 import F022/F023/F024/F025 任何模块（编程红线第 10 条延伸）。
- **DI 容器约束**：`WalCoordinator` 通过 DI 容器注入，绑定生命周期为 `singleton`，禁止直接实例化（编程红线第 12 条）。
- **Repository 层约束**：WAL 持久化必须经 `WalRepository` 抽象，禁止直操作数据库（编程红线第 13 条）。
- **配置驱动约束**：六类副作用清单 / 回滚策略 / checkpoint 间隔 / compaction 阈值外置 YAML（编程红线第 11 条）。
- **先写后执行硬约束**：所有副作用必须先 `append_pending` 再 `execute`，违反即拒绝。
- **幂等键硬约束**：每个 WAL entry 必须带 idempotency_key，重放时按 key 去重。
- **pre_state 完整性约束**：可回滚副作用必须带 pre_state 快照；不可回滚副作用 pre_state 可空但需标记 `reversible=false`。
- **异步约束**：所有 I/O 操作使用 `async/await`，WAL append 必须同步阻塞直到 fsync 完成。
- **类型注解约束**：Python 3.11+，所有公共方法强制类型注解。
- **提示词外置约束**：本模块不涉及提示词，但错误信息模板外置到 `config/error_messages.yaml`。

### 1.3 设计影响

- **对 F022 Tier 1-4 恢复**：WAL 是 Tier 1/2 回放的物理承载。本设计需保证 WAL 可按 entry_id 顺序回放。
- **对 F023 liveness 规范读**：WAL 状态（pending/executing/confirmed）是 liveness 判定的输入之一。
- **对 F024 强 workflow**：强 workflow 每步必须写 WAL。本设计需暴露 `append_pending` 接口供 F024 调用。
- **对 F025 跨 provider 宿主抽象**：provider 调用作为 PROVIDER_CALL 副作用记录到 WAL，failover 时不丢失。
- **对 F020 七类归因**：environment_drift 归因触发 WAL 回放。
- **对 F040 控制面**：WAL 状态变更事件写入 F040 Eval Hub。
- **对 Forgekin.act**：Forgekin 执行副作用前必须调用 `WalAppender.append_pending`。
- **对 DI 容器**：需新增 `wal_coordinator` / `wal_appender` / `wal_executor` / `wal_replayer` / `wal_repository` 五个绑定。
- **对数据库 schema**：需新增 `wal_entries` 表（entry_id PK / idempotency_key 唯一索引 / status 索引 / created_at 索引）。

---

## 2. 详细设计

### 2.1 类图 ASCII

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        <<module>> reliability.wal                          │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  <<enum>> SideEffectType             <<enum>> WalStatus                   │
│  + DB_WRITE                          + PENDING                             │
│  + API_CALL                          + EXECUTING                           │
│  + FILE_WRITE                        + CONFIRMED                           │
│  + MESSAGE_SEND                      + FAILED                              │
│  + EXTERNAL_INTEGRATION              + ROLLED_BACK                         │
│  + PROVIDER_CALL                                                            │
│                                                                            │
│  <<enum>> Reversibility                                                     │
│  + REVERSIBLE                                                              │
│  + IRREVERSIBLE                                                            │
│  + CONDITIONAL                                                             │
│                                                                            │
│  <<model>> WalEntry                                                        │
│  + entry_id: str (UUID v7, 时序排序)                                       │
│  + idempotency_key: str (全局唯一)                                         │
│  + forgekin_id: str                                                        │
│  + workflow_id: Optional[str]                                              │
│  + effect_type: SideEffectType                                             │
│  + status: WalStatus                                                       │
│  + action_payload: dict                                                   │
│  + pre_state: Optional[dict]                                               │
│  + post_state: Optional[dict]                                             │
│  + reversible: Reversibility                                               │
│  + rollback_payload: Optional[dict]                                        │
│  + created_at: datetime                                                    │
│  + executed_at: Optional[datetime]                                         │
│  + confirmed_at: Optional[datetime]                                       │
│  + rolled_back_at: Optional[datetime]                                      │
│  + error_message: Optional[str]                                            │
│                                                                            │
│  <<interface>> WalAppender (ABC)                                           │
│  + append_pending(entry) -> str                                           │
│                                                                            │
│  <<interface>> WalExecutor (ABC)                                           │
│  + execute(entry_id) -> WalEntry                                          │
│  + confirm(entry_id) -> WalEntry                                           │
│  + fail(entry_id, error) -> WalEntry                                      │
│                                                                            │
│  <<interface>> WalReplayer (ABC)                                           │
│  + replay(since_ts) -> int                                                │
│  + replay_entry(entry) -> WalEntry                                        │
│  + dedup(idempotency_key) -> bool                                         │
│                                                                            │
│  <<interface>> WalCoordinator (ABC)                                        │
│  + execute_with_wal(entry) -> WalEntry                                    │
│  + rollback(entry_id) -> WalEntry                                         │
│  + checkpoint -> int                                                    │
│  + compact -> int                                                        │
│                                                                            │
│  <<interface>> WalRepository (ABC)                                         │
│  + insert(entry) -> str                                                    │
│  + update_status(entry_id, status, **fields) -> None                       │
│  + get(entry_id) -> Optional[WalEntry]                                    │
│  + query_by_idempotency(key) -> Optional[WalEntry]                         │
│  + query_pending(since_ts) -> list[WalEntry]                               │
│  + query_by_workflow(workflow_id) -> list[WalEntry]                        │
│  + delete_before(ts) -> int                                                │
│                                                                            │
└──────────────────────────────────────────────────────────────────────────┘
```

### 2.2 接口实现 Python 代码

```python
# flowforge/core/reliability/wal/models.py
from __future__ import annotations
from typing import Optional, Any
from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict, model_validator
from enum import Enum


class SideEffectType(str, Enum):
    DB_WRITE = "db_write"
    API_CALL = "api_call"
    FILE_WRITE = "file_write"
    MESSAGE_SEND = "message_send"
    EXTERNAL_INTEGRATION = "external_integration"
    PROVIDER_CALL = "provider_call"


class WalStatus(str, Enum):
    PENDING = "pending"
    EXECUTING = "executing"
    CONFIRMED = "confirmed"
    FAILED = "failed"
    ROLLED_BACK = "rolled_back"


class Reversibility(str, Enum):
    REVERSIBLE = "reversible"
    IRREVERSIBLE = "irreversible"
    CONDITIONAL = "conditional"  # 需运行时判定


# 默认可逆性映射（可在 YAML 配置覆盖）
DEFAULT_REVERSIBILITY = {
    SideEffectType.DB_WRITE: Reversibility.REVERSIBLE,
    SideEffectType.API_CALL: Reversibility.CONDITIONAL,
    SideEffectType.FILE_WRITE: Reversibility.REVERSIBLE,
    SideEffectType.MESSAGE_SEND: Reversibility.IRREVERSIBLE,
    SideEffectType.EXTERNAL_INTEGRATION: Reversibility.CONDITIONAL,
    SideEffectType.PROVIDER_CALL: Reversibility.IRREVERSIBLE,
}


class WalEntry(BaseModel):
    """WAL 条目"""
    model_config = ConfigDict(frozen=True)  # 不可变，避免篡改

    entry_id: str = Field(min_length=1)  # UUID v7 时序排序
    idempotency_key: str = Field(min_length=1)  # 全局唯一
    forgekin_id: str = Field(min_length=1)
    workflow_id: Optional[str] = None  # 关联 F024 强 workflow
    effect_type: SideEffectType
    status: WalStatus = WalStatus.PENDING
    action_payload: dict  # 副作用执行参数
    pre_state: Optional[dict] = None  # 执行前状态快照
    post_state: Optional[dict] = None  # 执行后状态快照
    reversible: Reversibility = Reversibility.IRREVERSIBLE
    rollback_payload: Optional[dict] = None  # 回滚参数
    created_at: datetime
    executed_at: Optional[datetime] = None
    confirmed_at: Optional[datetime] = None
    rolled_back_at: Optional[datetime] = None
    error_message: Optional[str] = None

    @model_validator(mode="after")
    def _validate_reversibility_consistency(self) -> "WalEntry":
        # 可逆副作用必须带 pre_state
        if self.reversible == Reversibility.REVERSIBLE and self.pre_state is None:
            raise ValueError(
                f"reversible={Reversibility.REVERSIBLE} requires pre_state, "
                f"got None"
            )
        return self


# flowforge/core/reliability/wal/interfaces.py
from abc import ABC, abstractmethod
from typing import Optional
from datetime import datetime


class WalAppender(ABC):
    """WAL 追加器（先写后执行的"先写"）"""

    @abstractmethod
    async def append_pending(self, entry: WalEntry) -> str:
        """
        追加 pending 状态的 WAL entry：
        1. 校验 entry.status == PENDING
        2. 校验 idempotency_key 全局唯一（Repository 查询）
        3. 持久化（同步 fsync）
        4. 返回 entry_id
        """


class WalExecutor(ABC):
    """WAL 执行器（先写后执行的"后执行"）"""

    @abstractmethod
    async def execute(self, entry_id: str) -> WalEntry:
        """
        执行副作用：
        1. 状态转换：PENDING → EXECUTING
        2. 调用具体副作用处理器（SideEffectHandler）
        3. 成功 → confirm
        4. 失败 → fail
        """

    @abstractmethod
    async def confirm(self, entry_id: str) -> WalEntry:
        """状态转换：EXECUTING → CONFIRMED；记录 post_state"""

    @abstractmethod
    async def fail(self, entry_id: str, error: str) -> WalEntry:
        """状态转换：EXECUTING → FAILED；记录 error_message"""


class WalReplayer(ABC):
    """WAL 回放器（用于 F022 Tier 1/2 恢复）"""

    @abstractmethod
    async def replay(self, since_ts: datetime) -> int:
        """
        回放自 since_ts 起的所有 PENDING / EXECUTING 状态的 entry：
        1. 查询 since_ts 之后的未确认 entry
        2. 按 entry_id 顺序回放
        3. 调用 dedup 去重
        返回成功回放数
        """

    @abstractmethod
    async def replay_entry(self, entry: WalEntry) -> WalEntry:
        """回放单个 entry；幂等"""

    @abstractmethod
    async def dedup(self, idempotency_key: str) -> bool:
        """幂等去重；已存在返回 True，否则 False"""


class WalCoordinator(ABC):
    """WAL 协调器（先写后执行主流程）"""

    @abstractmethod
    async def execute_with_wal(self, entry: WalEntry) -> WalEntry:
        """
        先写后执行主流程：
        1. append_pending(entry)  # 先写
        2. execute(entry.entry_id)  # 后执行
        3. 失败时按 reversible 决定 rollback
        返回最终状态的 WalEntry
        """

    @abstractmethod
    async def rollback(self, entry_id: str) -> WalEntry:
        """
        回滚 entry：
        1. 状态转换：CONFIRMED/FAILED → ROLLED_BACK
        2. 调用回滚处理器（若 reversible=REVERSIBLE）
        3. 不可回滚的标记 IRREVERSIBLE 并告警
        """

    @abstractmethod
    async def checkpoint(self) -> int:
        """
        Checkpoint：将 CONFIRMED 状态的 entry 归档：
        1. 查询所有 CONFIRMED 状态
        2. 移动到归档表
        3. 返回归档数量
        """

    @abstractmethod
    async def compact(self) -> int:
        """
        Compaction：清理过期 ROLLED_BACK entry：
        1. 查询 ROLLED_BACK 状态超过 retention 的 entry
        2. 删除
        3. 返回清理数量
        """


class WalRepository(ABC):
    """WAL 持久化 Repository"""

    @abstractmethod
    async def insert(self, entry: WalEntry) -> str: ...

    @abstractmethod
    async def update_status(
        self, entry_id: str, status: WalStatus, **fields
    ) -> None: ...

    @abstractmethod
    async def get(self, entry_id: str) -> Optional[WalEntry]: ...

    @abstractmethod
    async def query_by_idempotency(
        self, key: str
    ) -> Optional[WalEntry]: ...

    @abstractmethod
    async def query_pending(
        self, since_ts: datetime
    ) -> list[WalEntry]: ...

    @abstractmethod
    async def query_by_workflow(
        self, workflow_id: str
    ) -> list[WalEntry]: ...

    @abstractmethod
    async def delete_before(self, ts: datetime) -> int: ...
```

### 2.3 数据结构 Pydantic Models（配置）

```python
# flowforge/core/reliability/wal/config.py
from __future__ import annotations
from typing import Optional
from datetime import timedelta
from pydantic import BaseModel, Field, model_validator


class SideEffectReversibilityRule(BaseModel):
    """副作用可逆性规则"""
    effect_type: str
    reversibility: str  # REVERSIBLE | IRREVERSIBLE | CONDITIONAL
    rollback_handler_uri: Optional[str] = None  # CONDITIONAL 必填


class WalConfig(BaseModel):
    """YAML 配置加载结果"""
    storage_backend: str = "sqlite"  # sqlite | postgres | file
    fsync_on_append: bool = True  # 先写后执行硬约束
    checkpoint_interval_seconds: int = Field(default=3600, ge=60, le=86400)
    compaction_threshold_entries: int = Field(default=10000, ge=100)
    rolled_back_retention_days: int = Field(default=30, ge=1)
    reversibility_rules: list[SideEffectReversibilityRule] = Field(min_length=6)
    max_concurrent_executions: int = Field(default=10, ge=1, le=100)
    execute_timeout_seconds: int = Field(default=60, ge=5, le=600)
    replay_batch_size: int = Field(default=100, ge=1, le=1000)

    @model_validator(mode="after")
    def _validate_reversibility_rules(self) -> "WalConfig":
        types_in_rules = {r.effect_type for r in self.reversibility_rules}
        expected_types = {
            "db_write", "api_call", "file_write",
            "message_send", "external_integration", "provider_call",
        }
        if types_in_rules != expected_types:
            raise ValueError(
                f"reversibility_rules must cover all 6 effect types, "
                f"missing: {expected_types - types_in_rules}"
            )
        # CONDITIONAL 必须提供 rollback_handler_uri
        for rule in self.reversibility_rules:
            if rule.reversibility == "conditional" and not rule.rollback_handler_uri:
                raise ValueError(
                    f"effect_type={rule.effect_type} reversibility=conditional "
                    f"requires rollback_handler_uri"
                )
        if self.fsync_on_append is not True:
            raise ValueError(
                "fsync_on_append must be True (hard constraint for 先写后执行)"
            )
        return self


class CheckpointResult(BaseModel):
    """Checkpoint 结果"""
    checkpoint_id: str
    archived_count: int
    checkpoint_at: str  # ISO datetime
    wal_size_before: int
    wal_size_after: int


class CompactionResult(BaseModel):
    """Compaction 结果"""
    compaction_id: str
    deleted_count: int
    compacted_at: str  # ISO datetime
    freed_bytes: int
```

### 2.4 关键算法伪代码

#### 2.4.1 先写后执行主流程

```
function execute_with_wal(entry: WalEntry) -> WalEntry:

    # 1. 先写：append_pending（同步 fsync）
    entry_id = await wal_appender.append_pending(entry)
    if entry_id is None:
        raise AppendFailedError(entry.entry_id)

    # 2. 后执行
    try:
        executed = await wal_executor.execute(entry_id)
    except ExecuteTimeoutError as e:
        # 执行超时，标记 FAILED
        await wal_executor.fail(entry_id, error=str(e))
        # 检查可逆性
        if entry.reversible == REVERSIBLE:
            await self.rollback(entry_id)
        raise

    # 3. 失败时回滚（按可逆性）
    if executed.status == FAILED:
        if entry.reversible == REVERSIBLE:
            await self.rollback(entry_id)
        elif entry.reversible == CONDITIONAL:
            # 调用 CONDITIONAL 的 rollback_handler
            handler = load_handler(entry.effect_type)
            if handler.can_rollback(executed):
                await self.rollback(entry_id)
            else:
                logger.warning(
                    f"entry {entry_id} irreversible: handler declined rollback"
                )
        else:
            logger.warning(
                f"entry {entry_id} irreversible: {entry.effect_type}"
            )

    return executed
```

#### 2.4.2 五态状态机转换

```
function transition_status(
    current: WalStatus, target: WalStatus
) -> WalStatus:

    # 合法转换矩阵
    ALLOWED_TRANSITIONS = {
        PENDING: {EXECUTING},  # 仅能转 EXECUTING
        EXECUTING: {CONFIRMED, FAILED},  # 可转 CONFIRMED 或 FAILED
        CONFIRMED: {ROLLED_BACK},  # 仅能转 ROLLED_BACK（回滚）
        FAILED: {ROLLED_BACK},  # 仅能转 ROLLED_BACK（回滚）
        ROLLED_BACK: set,  # 终态，不再转换
    }

    if target not in ALLOWED_TRANSITIONS.get(current, set):
        raise IllegalTransitionError(
            f"WAL status transition {current} -> {target} not allowed"
        )

    return target
```

#### 2.4.3 WAL 回放算法

```
function replay(since_ts: datetime) -> int:

    # 1. 查询 since_ts 之后所有未确认 entry（PENDING / EXECUTING）
    pending_entries = await wal_repository.query_pending(since_ts)

    # 2. 按 entry_id 顺序排序（UUID v7 时序排序）
    pending_entries.sort(key=lambda e: e.entry_id)

    # 3. 批量回放
    success_count = 0
    for batch in chunked(pending_entries, config.replay_batch_size):
        # 并发回放当前 batch
        tasks = [replay_entry(entry) for entry in batch]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.warning(
                    f"replay entry {batch[i].entry_id} failed: {result}"
                )
            else:
                success_count += 1

    return success_count


function replay_entry(entry: WalEntry) -> WalEntry:

    # 1. 幂等去重
    existing = await wal_repository.query_by_idempotency(entry.idempotency_key)
    if existing and existing.status == CONFIRMED:
        # 已确认，跳过
        return existing

    # 2. 状态转换：PENDING → EXECUTING
    await wal_repository.update_status(
        entry.entry_id, WalStatus.EXECUTING
    )

    # 3. 调用副作用处理器
    try:
        handler = load_handler(entry.effect_type)
        post_state = await handler.execute(entry.action_payload, entry.pre_state)
        await wal_repository.update_status(
            entry.entry_id, WalStatus.CONFIRMED,
            post_state=post_state,
            confirmed_at=now,
        )
        return await wal_repository.get(entry.entry_id)
    except Exception as e:
        await wal_repository.update_status(
            entry.entry_id, WalStatus.FAILED,
            error_message=str(e),
        )
        raise
```

#### 2.4.4 回滚算法

```
function rollback(entry_id: str) -> WalEntry:

    entry = await wal_repository.get(entry_id)
    if entry is None:
        raise EntryNotFoundError(entry_id)

    # 1. 校验状态（CONFIRMED 或 FAILED 才能回滚）
    if entry.status not in (CONFIRMED, FAILED):
        raise IllegalTransitionError(
            f"cannot rollback entry in status {entry.status}"
        )

    # 2. 校验可逆性
    if entry.reversible == IRREVERSIBLE:
        raise IrreversibleError(
            f"entry {entry_id} effect_type={entry.effect_type} irreversible"
        )

    # 3. 调用回滚处理器
    if entry.reversible == REVERSIBLE:
        handler = load_handler(entry.effect_type)
        await handler.rollback(entry.action_payload, entry.pre_state, entry.post_state)
    elif entry.reversible == CONDITIONAL:
        handler = load_handler(entry.effect_type)
        if not handler.can_rollback(entry):
            raise IrreversibleError(
                f"entry {entry_id} conditional rollback declined by handler"
            )
        await handler.rollback(entry.action_payload, entry.pre_state, entry.post_state)

    # 4. 状态转换：CONFIRMED/FAILED → ROLLED_BACK
    await wal_repository.update_status(
        entry_id, WalStatus.ROLLED_BACK,
        rolled_back_at=now,
    )

    return await wal_repository.get(entry_id)
```

#### 2.4.5 Checkpoint 与 Compaction

```
function checkpoint -> int:

    # 1. 查询所有 CONFIRMED 状态
    confirmed_entries = await wal_repository.query_by_status(CONFIRMED)

    # 2. 移动到归档表
    archived = 0
    for entry in confirmed_entries:
        await archive_repository.insert(entry)
        await wal_repository.delete(entry.entry_id)
        archived += 1

    logger.info(f"checkpoint archived {archived} entries")
    return archived


function compact -> int:

    # 1. 查询 ROLLED_BACK 状态超过 retention 的 entry
    cutoff = now - timedelta(days=config.rolled_back_retention_days)
    expired = await wal_repository.query_rolled_back_before(cutoff)

    # 2. 删除
    deleted = await wal_repository.delete_batch([e.entry_id for e in expired])

    logger.info(f"compaction deleted {deleted} expired rolled_back entries")
    return deleted
```

---

## 3. 模块实现

### 3.1 关键代码片段

```python
# flowforge/core/reliability/wal/coordinator.py
from __future__ import annotations
import asyncio
import logging
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

from .models import (
    WalEntry, WalStatus, SideEffectType, Reversibility,
    DEFAULT_REVERSIBILITY,
)
from .interfaces import (
    WalCoordinator, WalAppender, WalExecutor, WalReplayer, WalRepository,
)
from .config import WalConfig
from ...core.events.event_bus import EventBus

logger = logging.getLogger(__name__)


class IllegalTransitionError(Exception):
    """WAL 状态非法转换"""
    pass


class IrreversibleError(Exception):
    """不可逆副作用无法回滚"""
    pass


class EntryNotFoundError(Exception):
    """WAL entry 不存在"""
    pass


class AppendFailedError(Exception):
    """WAL append 失败"""
    pass


# 合法状态转换矩阵
ALLOWED_TRANSITIONS = {
    WalStatus.PENDING: {WalStatus.EXECUTING},
    WalStatus.EXECUTING: {WalStatus.CONFIRMED, WalStatus.FAILED},
    WalStatus.CONFIRMED: {WalStatus.ROLLED_BACK},
    WalStatus.FAILED: {WalStatus.ROLLED_BACK},
    WalStatus.ROLLED_BACK: set,
}


class DefaultWalCoordinator(WalCoordinator):
    """WAL 协调器默认实现"""

    def __init__(
        self,
        appender: WalAppender,
        executor: WalExecutor,
        replayer: WalReplayer,
        repository: WalRepository,
        event_bus: EventBus,
        config: WalConfig,
    ):
        self._appender = appender
        self._executor = executor
        self._replayer = replayer
        self._repo = repository
        self._bus = event_bus
        self._cfg = config

    async def execute_with_wal(self, entry: WalEntry) -> WalEntry:
        # 1. 先写
        entry_id = await self._appender.append_pending(entry)
        if entry_id is None:
            raise AppendFailedError(entry.entry_id)

        # 2. 后执行
        try:
            executed = await self._executor.execute(entry_id)
        except Exception as e:
            logger.error(f"execute {entry_id} failed: {e}")
            await self._executor.fail(entry_id, error=str(e))
            executed = await self._repo.get(entry_id)
            if executed is None:
                raise

            # 3. 失败时按可逆性回滚
            if executed.reversible == Reversibility.REVERSIBLE:
                try:
                    executed = await self.rollback(entry_id)
                except IrreversibleError as re:
                    logger.warning(
                        f"rollback {entry_id} declined: {re}"
                    )
            elif executed.reversible == Reversibility.CONDITIONAL:
                # 委托给执行器判定
                pass
            raise

        return executed

    async def rollback(self, entry_id: str) -> WalEntry:
        entry = await self._repo.get(entry_id)
        if entry is None:
            raise EntryNotFoundError(entry_id)

        # 1. 状态校验
        if entry.status not in (WalStatus.CONFIRMED, WalStatus.FAILED):
            raise IllegalTransitionError(
                f"cannot rollback entry in status {entry.status}"
            )

        # 2. 可逆性校验
        if entry.reversible == Reversibility.IRREVERSIBLE:
            raise IrreversibleError(
                f"entry {entry_id} effect_type={entry.effect_type} irreversible"
            )

        # 3. 状态转换
        target = self._check_transition(entry.status, WalStatus.ROLLED_BACK)
        await self._repo.update_status(
            entry_id, target,
            rolled_back_at=datetime.now(timezone.utc),
        )

        result = await self._repo.get(entry_id)
        # 派发回滚事件
        await self._bus.publish(
            topic="wal.entry.rolled_back",
            payload=result.model_dump if result else {},
        )
        return result  # type: ignore

    async def checkpoint(self) -> int:
        confirmed = await self._repo.query_by_status(WalStatus.CONFIRMED)
        archived = 0
        for entry in confirmed:
            # 归档（实际由 archive_repository 处理）
            await self._repo.delete(entry.entry_id)
            archived += 1
        logger.info(f"checkpoint archived {archived} entries")
        return archived

    async def compact(self) -> int:
        cutoff = datetime.now(timezone.utc) - timedelta(
            days=self._cfg.rolled_back_retention_days
        )
        deleted = await self._repo.delete_before(cutoff)
        logger.info(f"compaction deleted {deleted} entries")
        return deleted

    def _check_transition(
        self, current: WalStatus, target: WalStatus
    ) -> WalStatus:
        allowed = ALLOWED_TRANSITIONS.get(current, set)
        if target not in allowed:
            raise IllegalTransitionError(
                f"WAL status transition {current.value} -> {target.value} "
                f"not allowed (allowed: {[s.value for s in allowed]})"
            )
        return target


class DefaultWalAppender(WalAppender):
    """WAL 追加器默认实现"""

    def __init__(self, repository: WalRepository, config: WalConfig):
        self._repo = repository
        self._cfg = config

    async def append_pending(self, entry: WalEntry) -> str:
        # 1. 校验 status == PENDING
        if entry.status != WalStatus.PENDING:
            raise IllegalTransitionError(
                f"append_pending requires status=PENDING, got {entry.status}"
            )

        # 2. 幂等键去重
        existing = await self._repo.query_by_idempotency(entry.idempotency_key)
        if existing is not None:
            logger.info(
                f"idempotency_key {entry.idempotency_key} already exists, "
                f"returning existing entry {existing.entry_id}"
            )
            return existing.entry_id

        # 3. 持久化（fsync 由 Repository 保证）
        await self._repo.insert(entry)
        logger.debug(f"appended WAL entry {entry.entry_id}")
        return entry.entry_id


class DefaultWalExecutor(WalExecutor):
    """WAL 执行器默认实现"""

    def __init__(
        self,
        repository: WalRepository,
        event_bus: EventBus,
        config: WalConfig,
        handlers: dict[SideEffectType, "SideEffectHandler"],
    ):
        self._repo = repository
        self._bus = event_bus
        self._cfg = config
        self._handlers = handlers

    async def execute(self, entry_id: str) -> WalEntry:
        entry = await self._repo.get(entry_id)
        if entry is None:
            raise EntryNotFoundError(entry_id)

        # 1. 状态转换：PENDING → EXECUTING
        await self._repo.update_status(entry_id, WalStatus.EXECUTING)

        # 2. 调用具体副作用处理器
        handler = self._handlers.get(entry.effect_type)
        if handler is None:
            await self.fail(entry_id, error=f"no handler for {entry.effect_type}")
            raise ValueError(f"no handler for {entry.effect_type}")

        try:
            post_state = await asyncio.wait_for(
                handler.execute(entry.action_payload, entry.pre_state),
                timeout=self._cfg.execute_timeout_seconds,
            )
        except asyncio.TimeoutError:
            await self.fail(entry_id, error="execute timeout")
            raise
        except Exception as e:
            await self.fail(entry_id, error=str(e))
            raise

        # 3. 确认
        return await self.confirm(entry_id)

    async def confirm(self, entry_id: str) -> WalEntry:
        entry = await self._repo.get(entry_id)
        if entry is None:
            raise EntryNotFoundError(entry_id)

        await self._repo.update_status(
            entry_id, WalStatus.CONFIRMED,
            post_state=entry.post_state,  # 由 handler 设置
            confirmed_at=datetime.now(timezone.utc),
        )
        result = await self._repo.get(entry_id)
        await self._bus.publish(
            topic="wal.entry.confirmed",
            payload=result.model_dump if result else {},
        )
        return result  # type: ignore

    async def fail(self, entry_id: str, error: str) -> WalEntry:
        await self._repo.update_status(
            entry_id, WalStatus.FAILED,
            error_message=error,
        )
        result = await self._repo.get(entry_id)
        await self._bus.publish(
            topic="wal.entry.failed",
            payload=result.model_dump if result else {},
        )
        return result  # type: ignore


class DefaultWalReplayer(WalReplayer):
    """WAL 回放器默认实现"""

    def __init__(
        self,
        repository: WalRepository,
        executor: WalExecutor,
        config: WalConfig,
    ):
        self._repo = repository
        self._executor = executor
        self._cfg = config

    async def replay(self, since_ts: datetime) -> int:
        pending = await self._repo.query_pending(since_ts)
        pending.sort(key=lambda e: e.entry_id)  # 按 entry_id 顺序

        success = 0
        for i in range(0, len(pending), self._cfg.replay_batch_size):
            batch = pending[i:i + self._cfg.replay_batch_size]
            tasks = [self.replay_entry(e) for e in batch]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            for r in results:
                if not isinstance(r, Exception):
                    success += 1
        logger.info(f"replay since {since_ts}: {success}/{len(pending)} succeeded")
        return success

    async def replay_entry(self, entry: WalEntry) -> WalEntry:
        # 1. 幂等去重
        existing = await self._repo.query_by_idempotency(entry.idempotency_key)
        if existing and existing.status == WalStatus.CONFIRMED:
            return existing

        # 2. 重新执行
        return await self._executor.execute(entry.entry_id)

    async def dedup(self, idempotency_key: str) -> bool:
        existing = await self._repo.query_by_idempotency(idempotency_key)
        return existing is not None
```

### 3.2 关键流程时序图

```
[先写后执行时序图]

  Forgekin.act    coordinator    appender     repository    executor    handler    EventBus
        │              │              │             │            │           │           │
        │ execute_with_wal(entry)    │             │            │           │           │
        ├─────────────>│             │             │            │           │           │
        │              │ append_pending(entry)    │            │           │           │
        │              ├────────────>│             │            │           │           │
        │              │             │ query_by_idempotency     │           │           │
        │              │             ├────────────>│            │           │           │
        │              │             │<────────────┤ None       │           │           │
        │              │             │ insert(entry) fsync     │           │           │
        │              │             ├────────────>│            │           │           │
        │              │             │<────────────┤ OK         │           │           │
        │              │<────────────┤ entry_id   │            │           │           │
        │              │ execute(entry_id)                     │           │           │
        │              ├──────────────────────────────────────>│           │           │
        │              │                            │ update_status EXECUTING          │
        │              │                            ├──────────>│           │           │
        │              │                            │ handler.execute                │
        │              │                            ├──────────────────────>│           │
        │              │                            │           │ post_state            │
        │              │                            │<──────────────────────┤           │
        │              │                            │ confirm(entry_id)                │
        │              │                            ├──────────>│ update_status CONFIRMED │
        │              │                            │           │ publish("wal.entry.confirmed")
        │              │                            │           ├──────────>│           │
        │              │<──────────────────────────────────────┤ entry                 │
        │<─────────────┤                                                                 │
        │              │                                                                 │
```

### 3.3 错误处理

| 异常类型 | 触发场景 | 处理策略 | 重试次数 |
|---------|---------|---------|---------|
| `AppendFailedError` | WAL append 失败（fsync 失败） | 阻塞 execute_with_wal，记录错误 | 3（指数退避） |
| `IllegalTransitionError` | 状态转换不合法 | 拒绝操作，记录错误 | 不重试（编程错误） |
| `IrreversibleError` | 不可逆副作用被尝试回滚 | 拒绝回滚，记录告警到 F040 | 不重试 |
| `EntryNotFoundError` | entry 不存在 | 记录错误，调用方处理 | 不重试 |
| `ExecuteTimeoutError` | 副作用执行超时 | 标记 FAILED，按可逆性回滚 | 不重试（已超时） |
| `IdempotencyConflictError` | 幂等键冲突（理论不应发生） | 返回已存在 entry | 不重试 |
| `HandlerNotFoundError` | effect_type 无对应 handler | 标记 FAILED，告警 | 不重试 |
| `CheckpointError` | checkpoint 失败 | 回滚归档操作，记录错误 | 2 |
| `CompactionError` | compaction 失败 | 跳过失败项，继续清理 | 不重试 |
| `FsyncError` | fsync 失败 | 阻塞 append，记录错误 | 3（指数退避） |

### 3.4 性能优化

| 性能指标 | 目标值 | 优化手段 |
|---------|--------|---------|
| WAL append 延迟（含 fsync） | < 10ms | sqlite WAL 模式 + synchronous=NORMAL |
| WAL execute 延迟 | < 100ms（不含 handler） | 状态转换 batch update |
| WAL replay 延迟（1000 entry） | < 5s | 并发 batch + entry_id 顺序 |
| Repository 查询延迟 | < 10ms | idempotency_key 唯一索引 + status 索引 |
| WAL 文件大小（10000 entry） | < 100MB | 定期 checkpoint + compaction |
| 并发执行数 | max_concurrent_executions=10 | asyncio.Semaphore 限流 |
| 回滚延迟 | < 50ms | handler.rollback 异步 + 状态转换 batch |
| 状态机转换延迟 | < 5ms | 内存缓存 + 单次 UPDATE |

---

## 4. 跨模块协作实现

### 4.1 上游依赖如何调用

- **Forgekin.act**：Forgekin 执行副作用前必须调用 `WalCoordinator.execute_with_wal`。
- **F024 强 workflow**：强 workflow 每步必须 `append_pending`，关联 `workflow_id`。调用方需保证 workflow_id 已知。
- **F025 跨 provider 宿主抽象**：provider 调用作为 PROVIDER_CALL 副作用记录到 WAL，failover 时 WAL 不丢失。
- **DI 容器**：`wal_coordinator` 通过 `inject("wal_coordinator")` 获取。

### 4.2 下游影响如何被调用

- **F022 Tier 1-4 恢复**：Tier 1/2 通过 `WalReplayer.replay` 回放未确认 entry。F022 订阅 `wal.entry.confirmed` 事件确认恢复进度。
- **F023 liveness 规范读**：WAL 状态是 liveness 判定的输入之一。F023 订阅 `wal.entry.failed` 事件检测 zombie。
- **F020 七类归因**：environment_drift 归因触发 `WalCoordinator.rollback`。F020 通过 EventBus 派发修复请求。
- **F040 控制面**：所有 WAL 状态变更事件写入 F040 Eval Hub。F040 订阅 `wal.entry.*` 主题。
- **archive_repository**：checkpoint 归档的 entry 写入 archive_repository（独立表/独立库）。

### 4.3 集成测试点

| 测试点 ID | 测试场景 | 验证点 | 责任方 |
|----------|---------|--------|--------|
| IT-D021-001 | 先写后执行主流程 | PENDING → EXECUTING → CONFIRMED 顺序正确 | 测试员Forgekin（蜜獾·平头哥） |
| IT-D021-002 | 幂等键去重 | 同一 idempotency_key 的 entry 仅入库一次 | 测试员Forgekin |
| IT-D021-003 | 五态状态机非法转换 | PENDING → CONFIRMED 直接转换被拒绝 | 测试员Forgekin |
| IT-D021-004 | 可逆副作用回滚 | DB_WRITE 类型可回滚到 pre_state | 测试员Forgekin |
| IT-D021-005 | 不可逆副作用拒绝回滚 | MESSAGE_SEND 类型回滚被拒绝 | 测试员Forgekin |
| IT-D021-006 | 条件可逆副作用判定 | API_CALL 类型按 handler.can_rollback 判定 | 测试员Forgekin |
| IT-D021-007 | WAL 回放顺序 | 按 entry_id 时序排序回放 | 测试员Forgekin |
| IT-D021-008 | 回放幂等 | 已 CONFIRMED 的 entry 回放时跳过 | 测试员Forgekin |
| IT-D021-009 | 执行超时处理 | handler 超时后 entry 标记 FAILED | 测试员Forgekin |
| IT-D021-010 | Checkpoint 归档 | CONFIRMED 状态 entry 归档到 archive | 测试员Forgekin |
| IT-D021-011 | Compaction 清理 | ROLLED_BACK 超过 retention 被 delete | 测试员Forgekin |
| IT-D021-012 | fsync_on_append 硬约束 | fsync_on_append=False 时配置加载失败 | 测试员Forgekin |
| IT-D021-013 | 六类副作用全覆盖 | reversibility_rules 覆盖全部 6 类 | 测试员Forgekin |
| IT-D021-014 | 跨 workflow 关联 | query_by_workflow 返回 workflow 下所有 entry | 测试员Forgekin |
| IT-D021-015 | 并发执行限流 | max_concurrent_executions 限制并发数 | 测试员Forgekin |

---

## 5. 详细设计验收

### 5.1 功能验收 AC

- [ ] **AC-D021-001**: 先写后执行主流程通过（IT-D021-001）
- [ ] **AC-D021-002**: 幂等键去重生效（IT-D021-002）
- [ ] **AC-D021-003**: 五态状态机非法转换被拒绝（IT-D021-003）
- [ ] **AC-D021-004**: 可逆副作用回滚成功（IT-D021-004）
- [ ] **AC-D021-005**: 不可逆副作用拒绝回滚（IT-D021-005）
- [ ] **AC-D021-006**: 条件可逆副作用按 handler 判定（IT-D021-006）
- [ ] **AC-D021-007**: WAL 回放按 entry_id 顺序（IT-D021-007）
- [ ] **AC-D021-008**: 回放幂等生效（IT-D021-008）
- [ ] **AC-D021-009**: 执行超时处理正确（IT-D021-009）
- [ ] **AC-D021-010**: Checkpoint 归档生效（IT-D021-010）

### 5.2 性能验收 AC

- [ ] **AC-D021-011**: WAL append 延迟 < 10ms（含 fsync）
- [ ] **AC-D021-012**: WAL execute 延迟 < 100ms（不含 handler）
- [ ] **AC-D021-013**: WAL replay 延迟（1000 entry）< 5s
- [ ] **AC-D021-014**: Repository 查询延迟 < 10ms
- [ ] **AC-D021-015**: WAL 文件大小（10000 entry）< 100MB
- [ ] **AC-D021-016**: 并发执行限流生效
- [ ] **AC-D021-017**: 回滚延迟 < 50ms

### 5.3 安全验收 AC

- [ ] **AC-D021-018**: 先写后执行硬约束（fsync_on_append=true）
- [ ] **AC-D021-019**: 幂等键全局唯一（Repository 唯一索引）
- [ ] **AC-D021-020**: 五态状态机不可绕过（强制 transition check）
- [ ] **AC-D021-021**: 不可逆副作用不可回滚（IrreversibleError）
- [ ] **AC-D021-022**: WalEntry 不可变（Pydantic frozen=True）
- [ ] **AC-D021-023**: Repository 层抽象，不直操作数据库
- [ ] **AC-D021-024**: 六类副作用全覆盖（配置校验）

### 5.4 Eval 验收 AC

- [ ] **AC-D021-025**: 先写后执行成功率 >= 99.9%
- [ ] **AC-D021-026**: 回放成功率 >= 99%
- [ ] **AC-D021-027**: 回滚成功率（可逆副作用）100%
- [ ] **AC-D021-028**: WAL 文件膨胀控制（checkpoint + compaction 生效）
- [ ] **AC-D021-029**: 跨进程读一致性 100%（fsync + WAL 模式）

---

## 6. 引用

- [doc:../spec.md#§3.6]
- [doc:../arch.md#§3.6]
- [doc:../architecture/A021-side-effect-wal.md]
- [doc:../features/F020-seven-attribution.md]
- [doc:../features/F021-side-effect-wal.md]
- [doc:../features/F022-tier-1-4-recovery.md]
- [doc:../features/F023-liveness-canonical-read.md]
- [doc:../features/F024-weak-state-vs-strong-workflow.md]
- [doc:../features/F025-provider-host-abstraction.md]
- [doc:../features/F040-harness-eval-control-plane.md]
- [doc:../decisions/010-distributed-reliability.md]
- [doc:../../CONTRIBUTING.md]
- [doc:../../CONTRIBUTING.md#31-15-条编程红线违反即拒绝合入]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（六类副作用 + 五态状态机 + 先写后执行 + 幂等键 + 回滚算法 + checkpoint/compaction + 15 集成测试点 + 4 类 AC） | 开发者 Forgekin（猎犬·夏洛克） |
