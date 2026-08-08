# D008: Durable State Surfaces 详细设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 开发者 Forgekin（猎犬·夏洛克）
> **对应 spec.md**: [doc:../spec.md#§3.3]
> **对应 arch.md**: [doc:../arch.md#§3.3]
> **对应 design.md**: [doc:../design.md#§3.3]
> **对应 Feature**: [doc:../features/F008-durable-state-surfaces.md]
> **对应 Architecture**: [doc:../architecture/A008-durable-state-surfaces.md]
> **依赖 ADR**: [doc:../decisions/007-harness-engineering.md]

---

## 1. 详细设计上下文

### 1.1 设计问题

A008 架构层定义了"6 类持久状态表面 + 权威等级 + 压缩免疫注入"的骨架，本详细设计需要回答下列"如何落地"问题：

1. **D-Q1**：6 类 Durable Surface（`feature_spec` / `git` / `task_queue` / `thread_trace` / `memory_federation` / `handoff_capsule`）如何在 Pydantic 模型层统一抽象，又能保留每类特异字段？
2. **D-Q2**：权威等级 1-5 如何在 SQLite + WAL 中以索引形式存储，使 `canonical_read` 能在 1ms 内返回最高权威表面？
3. **D-Q3**：`CompressionImmuneInjector` 如何把治理规则文本与 Magic Words 拉闸词注入到 `native_system_role`，同时禁止 `user_message_prepend` 注入？
4. **D-Q4**：`ConflictResolver` 如何处理同 surface_type 不同来源的两条记录冲突（如 feature_spec vs thread_trace 对同一断言不一致）？
5. **D-Q5**：`DurableStateRegistry` 如何对Forgekin提供 `canonical_read(key)` 接口，自动返回最高权威 + 最新版本的记录？
6. **D-Q6**：上下文压缩发生时，`compression_immune=true` 的记录如何保证仍注入到新上下文，而 `compression_immune=false` 的记录允许被裁剪？
7. **D-Q7**：6 类表面的 `decay_tag` 默认值如何确定（如 `thread_trace=BUILT_TO_DELETE`，`feature_spec=BUILT_TO_PERSIST`）？

### 1.2 设计约束

| 编号 | 约束 | 来源 |
|------|------|------|
| C1 | `flowforge/core/harness/durable_state.py` 不可 import forgemind 或 *Forge 模块 | 单向依赖 |
| C2 | DurableStateRegistry / CompressionImmuneInjector / ConflictResolver 通过 `@inject` 注入 | DI 容器 |
| C3 | 所有 Surface 通过 Repository 持久化，禁 `cursor.execute` | Repository 层 |
| C4 | 6 类表面类型枚举外置到 `flowforge/config/harness.yaml`，不可扩展第七类 | A008 决策 1 |
| C5 | 权威等级 `authority_level` ∈ [1, 5]，5 最权威 1 最脆 | A008 决策 2 |
| C6 | `thread_trace` 默认 `authority_level=1`，是"最脆"表面 | A008 决策 2 |
| C7 | `feature_spec` 默认 `authority_level=5`，是"最权威"表面 | A008 决策 2 |
| C8 | 治理规则与 Magic Words 必须注入 `native_system_role`，禁 `user_message_prepend` | A008 决策 3 |
| C9 | `canonical_read(key)` 返回同 key 中 `authority_level` 最高 + `version` 最大的记录 | A008 决策 6 |
| C10 | 所有 Surface 写入走 WAL，进程崩溃可重放 | F021 联动 |
| C12 | 觉醒阶标注：E1-E3 进化阶Forgekin可读全部 6 类；E4+ 觉醒阶Forgekin写 `feature_spec` 需 MindCouncil 二次确认 | naming-contract.md §4 |

### 1.3 设计影响

| 编号 | 影响 | 关联模块 |
|------|------|---------|
| I1 | D002 TeamAct 各步读写 `task_queue` + `thread_trace` 表面 | D002 / A002 |
| I2 | D003 HandoffCapsule 持久化到 `handoff_capsule` 表面 | D003 / A003 |
| I3 | D007 Push Back 事件写入 `thread_trace`（authority_level=2） | D007 / A007 |
| I4 | D009 Evidence 写入 `task_queue` 或 `thread_trace` | D009 / A009 |
| I5 | D010 GovernanceBundle 持久化到 `task_queue` + `thread_trace`，`compression_immune` 字段来源 | D010 / A010 |
| I6 | D011 Magic Words 触发时上下文快照写入 `thread_trace` | D011 / A011 |
| I7 | D012 HotfixTag 持久化到 `git` + `thread_trace` | D012 / A012 |

---

## 2. 详细设计

### 2.1 类图

```
┌──────────────────────────────────────────────────────────────────────┐
│                    flowforge/core/harness/durable_state.py           │
├──────────────────────────────────────────────────────────────────────┤
│  «enum» StateSurfaceType                                             │
│    + FEATURE_SPEC      (authority=5, BUILT_TO_PERSIST)               │
│    + GIT               (authority=4, BUILT_TO_PERSIST)               │
│    + TASK_QUEUE        (authority=3, BUILT_TO_PERSIST)               │
│    + THREAD_TRACE      (authority=1, BUILT_TO_DELETE)                │
│    + MEMORY_FEDERATION (authority=2, INDIVIDUAL_COMPENSATION)        │
│    + HANDOFF_CAPSULE   (authority=3, BUILT_TO_PERSIST)               │
│                                                                      │
│  «enum» InjectionLayer                                               │
│    + NATIVE_SYSTEM_ROLE    (压缩免疫)                                │
│    + DEVELOPER_ROLE        (developer 注入)                          │
│    + USER_MESSAGE_PREPEND  (禁用, 仅 audit 告警)                     │
│                                                                      │
│  «Pydantic» DurableSurface                                           │
│    + surface_id: str                                                 │
│    + surface_type: StateSurfaceType                                  │
│    + key: str                  (逻辑键, 如 "task:123:state")         │
│    + payload: dict             (实际内容)                            │
│    + authority_level: int      (1-5, 由 surface_type 默认, 可覆盖)   │
│    + compression_immune: bool  (是否压缩免疫)                        │
│    + decay_tag: DecayTag                                              │
│    + version: int              (单调递增)                            │
│    + schema_version: str = "v1"                                      │
│    + wal_lsn: int = 0                                                │
│    + created_at: datetime                                            │
│    + authored_by: str          (forgekin_id 或 "operator")           │
│                                                                      │
│  «ABC» DurableStateRegistry                                          │
│    + write(surface) -> str                                           │
│    + canonical_read(key) -> Optional[DurableSurface]                 │
│    + list_by_type(surface_type) -> list[DurableSurface]              │
│    + list_compression_immune -> list[DurableSurface]               │
│                                                                      │
│  «ABC» CompressionImmuneInjector                                     │
│    + inject_native_system_role(text) -> None                         │
│    + audit_user_message(session_ctx) -> AuditResult                  │
│                                                                      │
│  «ABC» ConflictResolver                                              │
│    + resolve(a, b) -> DurableSurface                                 │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│            infra/repo/sqlite_durable_state_store.py                  │
│  «implements DurableStateRegistry» SqliteDurableStateStore           │
│    - _conn: aiosqlite.Connection                                     │
│    + async write(surface) -> str                                     │
│    + async canonical_read(key) -> Optional[DurableSurface]           │
│    + async list_by_type(surface_type) -> list[DurableSurface]        │
│    + async list_compression_immune -> list[DurableSurface]         │
│    + async checkpoint -> None                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.2 接口与 Pydantic 模型

```python
# flowforge/core/harness/durable_state.py
from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from flowforge.core.plugin.di_container import inject
from flowforge.core.harness.decay_tag import DecayTag


# ───────────────────────────── 枚举 ─────────────────────────────

class StateSurfaceType(str, Enum):
    """6 类持久状态表面（不可扩展第七类, A008 决策 1）

    每类表面带默认 authority_level 与 decay_tag, 在 Pydantic 模型层强制:
    - FEATURE_SPEC: authority=5, BUILT_TO_PERSIST (最权威)
    - GIT: authority=4, BUILT_TO_PERSIST
    - TASK_QUEUE: authority=3, BUILT_TO_PERSIST
    - HANDOFF_CAPSULE: authority=3, BUILT_TO_PERSIST
    - MEMORY_FEDERATION: authority=2, INDIVIDUAL_COMPENSATION
    - THREAD_TRACE: authority=1, BUILT_TO_DELETE (最脆)
    """
    FEATURE_SPEC = "feature_spec"
    GIT = "git"
    TASK_QUEUE = "task_queue"
    HANDOFF_CAPSULE = "handoff_capsule"
    MEMORY_FEDERATION = "memory_federation"
    THREAD_TRACE = "thread_trace"

    @property
    def default_authority(self) -> int:
        return {
            StateSurfaceType.FEATURE_SPEC: 5,
            StateSurfaceType.GIT: 4,
            StateSurfaceType.TASK_QUEUE: 3,
            StateSurfaceType.HANDOFF_CAPSULE: 3,
            StateSurfaceType.MEMORY_FEDERATION: 2,
            StateSurfaceType.THREAD_TRACE: 1,
        }[self]

    @property
    def default_decay_tag(self) -> DecayTag:
        return {
            StateSurfaceType.FEATURE_SPEC: DecayTag.BUILT_TO_PERSIST,
            StateSurfaceType.GIT: DecayTag.BUILT_TO_PERSIST,
            StateSurfaceType.TASK_QUEUE: DecayTag.BUILT_TO_PERSIST,
            StateSurfaceType.HANDOFF_CAPSULE: DecayTag.BUILT_TO_PERSIST,
            StateSurfaceType.MEMORY_FEDERATION: DecayTag.INDIVIDUAL_COMPENSATION,
            StateSurfaceType.THREAD_TRACE: DecayTag.BUILT_TO_DELETE,
        }[self]


class InjectionLayer(str, Enum):
    """注入层（A008 决策 3: 治理规则只能 native_system_role）"""
    NATIVE_SYSTEM_ROLE = "native_system_role"
    DEVELOPER_ROLE = "developer_role"
    USER_MESSAGE_PREPEND = "user_message_prepend"  # 禁用, 仅 audit 告警


# ───────────────────────────── 异常 ─────────────────────────────

class DurableStateError(Exception):
    """Durable State 基础异常"""


class InvalidSurfaceError(DurableStateError):
    """表面类型/字段非法"""


class ForbiddenInjectionLayerError(DurableStateError):
    """尝试用 user_message_prepend 注入治理规则"""


class ConflictUnresolvableError(DurableStateError):
    """两条同 key 不同权威表面冲突且无法仲裁"""


class MindCouncilRequiredError(DurableStateError):
    """E4+ 觉醒阶写 feature_spec 需 MindCouncil 二次确认"""


# ───────────────────────────── Pydantic 模型 ─────────────────────────────

class DurableSurface(BaseModel):
    """单条持久状态表面"""

    surface_id: str = Field(..., min_length=1)
    surface_type: StateSurfaceType
    key: str = Field(..., min_length=1)
    payload: dict[str, Any]
    authority_level: int = Field(..., ge=1, le=5)
    compression_immune: bool = False
    decay_tag: DecayTag
    version: int = Field(default=1, ge=1)
    schema_version: str = Field(default="v1")
    wal_lsn: int = Field(default=0, ge=0)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    authored_by: str = Field(..., min_length=1)

    @model_validator(mode="after")
    def _defaults_from_surface_type(self) -> "DurableSurface":
        """surface_type 提供默认 authority_level / decay_tag"""
        if self.authority_level > self.surface_type.default_authority:
            raise InvalidSurfaceError(
                f"surface_type={self.surface_type.value} authority_level 不可超过 "
                f"{self.surface_type.default_authority}（默认值）"
            )
        return self

    @field_validator("key")
    @classmethod
    def _key_format(cls, v: str) -> str:
        if ":" not in v:
            raise InvalidSurfaceError(
                "key 必须含 ':' 分隔符, 如 'task:123:state'"
            )
        return v


class AuditResult(BaseModel):
    """audit 结果（检测 user_message_prepend 注入）"""
    ok: bool
    violations: list[str] = Field(default_factory=list)
    session_id: Optional[str] = None


# ───────────────────────────── 抽象基类 ─────────────────────────────

class DurableStateRegistry(ABC):
    """持久状态注册表"""

    @abstractmethod
    async def write(self, surface: DurableSurface) -> str:
        """写入一条 Surface, 返回 surface_id（WAL 写入）

        架构契约:
        - 同 key 写入触发 version+1
        - authority_level 超过 surface_type.default_authority 时拒绝
        - E4+ 觉醒阶写 FEATURE_SPEC 需 MindCouncil token
        - 持久化到 Durable Surface 自身（即 SQLite + WAL）
        """

    @abstractmethod
    async def canonical_read(self, key: str) -> Optional[DurableSurface]:
        """按 key 返回权威最高 + 版本最新的 Surface

        架构契约 (A008 决策 6):
        - 同 key 多条记录按 authority_level DESC, version DESC 排序
        - 返回首条（最高权威 + 最新版本）
        - 无记录返回 None
        """

    @abstractmethod
    async def list_by_type(
        self, surface_type: StateSurfaceType
    ) -> list[DurableSurface]:
        """按 surface_type 列出全部记录"""

    @abstractmethod
    async def list_compression_immune(self) -> list[DurableSurface]:
        """列出所有 compression_immune=true 的 Surface

        架构契约:
        - 上下文压缩时这些记录必须保留
        - 供 CompressionImmuneInjector 重新注入到新上下文
        """


class CompressionImmuneInjector(ABC):
    """压缩免疫注入器（A008 决策 3）"""

    @abstractmethod
    async def inject_native_system_role(self, text: str) -> None:
        """注入治理规则/Magic Words 到 native_system_role

        架构契约:
        - 注入位置: native_system_role (压缩免疫)
        - 禁用 user_message_prepend
        - 由 ForgekinHost 在Forgekin构造时调用
        - 上下文压缩后规则仍生效
        """

    @abstractmethod
    async def audit_user_message(
        self, session_ctx: dict
    ) -> AuditResult:
        """audit session 上下文, 检测 user_message 是否含治理规则

        架构契约:
        - 治理规则出现在 user_message → 告警
        - 定期 audit 防止 v4.0 残留代码绕过新架构
        - 返回 AuditResult 包含 violations 列表
        """


class ConflictResolver(ABC):
    """冲突仲裁器"""

    @abstractmethod
    async def resolve(
        self, a: DurableSurface, b: DurableSurface
    ) -> DurableSurface:
        """仲裁两条同 key 不同来源的 Surface

        架构契约:
        - authority_level 不同 → 返回较高权威
        - authority_level 相同 → 比较 version, 返回较新
        - 都相同 → 抛 ConflictUnresolvableError
        """
```

### 2.3 默认实现

```python
# flowforge/core/harness/durable_state.py（续）

class DefaultDurableStateRegistry(DurableStateRegistry):
    """SQLite + WAL 持久化注册表"""

    @inject
    def __init__(
        self, *,
        db_path: str,
        event_bus,
        eval_signal_writer,
    ) -> None:
        self._db_path = db_path
        self._event_bus = event_bus
        self._eval_signal_writer = eval_signal_writer
        self._conn: Any = None  # aiosqlite.Connection, 延迟初始化

    async def write(self, surface: DurableSurface) -> str:
        # E4+ 觉醒阶写 FEATURE_SPEC 需 MindCouncil token
        if surface.surface_type == StateSurfaceType.FEATURE_SPEC:
            if not getattr(surface, "_mind_council_token", None):
                # 由 caller 在 payload 中带 "mind_council_token" 字段
                token = surface.payload.get("mind_council_token")
                if not token:
                    raise MindCouncilRequiredError(
                        "E4+ 觉醒阶写 FEATURE_SPEC 需 MindCouncil 二次确认 token "
                        "(放在 payload.mind_council_token)"
                    )

        # 查询同 key 当前最大 version
        current = await self.canonical_read(surface.key)
        if current is not None:
            surface.version = current.version + 1

        # WAL 写入
        await self._store.save(surface)
        await self._event_bus.publish_async(
            "durable_state.written",
            {
                "surface_id": surface.surface_id,
                "surface_type": surface.surface_type.value,
                "key": surface.key,
                "authority_level": surface.authority_level,
                "version": surface.version,
            },
        )
        self._eval_signal_writer.write_trace(
            signal_type="durable_state_written",
            payload={"key": surface.key, "type": surface.surface_type.value},
        )
        return surface.surface_id

    async def canonical_read(self, key: str) -> Optional[DurableSurface]:
        """按 key 返回权威最高 + 版本最新的 Surface"""
        return await self._store.canonical_read(key)

    async def list_by_type(
        self, surface_type: StateSurfaceType
    ) -> list[DurableSurface]:
        return await self._store.list_by_type(surface_type)

    async def list_compression_immune(self) -> list[DurableSurface]:
        return await self._store.list_compression_immune


class DefaultCompressionImmuneInjector(CompressionImmuneInjector):
    """治理规则与 Magic Words 注入器"""

    # 治理规则关键词, 用于检测 user_message_prepend 注入
    GOVERNANCE_KEYWORDS = (
        "禁止", "必须", "不可", "应当", "guardrail", "禁止绕过",
    )

    @inject
    def __init__(
        self, *,
        registry: DurableStateRegistry,
        forgekin_host,            # ForgekinHost (ADR 001)
        audit_logger,
    ) -> None:
        self._registry = registry
        self._forgekin_host = forgekin_host
        self._audit_logger = audit_logger

    async def inject_native_system_role(self, text: str) -> None:
        """注入到 native_system_role（压缩免疫层）"""
        if not text or not text.strip:
            raise InvalidSurfaceError("native_system_role 注入文本不可为空")

        # 通过 ForgekinHost 注入（不在 user_message）
        await self._forgekin_host.append_native_system_role(text)

        # 写一条 SURFACE 记录, 标记 compression_immune=true
        surface = DurableSurface(
            surface_id=f"sys-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S%f')}",
            surface_type=StateSurfaceType.TASK_QUEUE,
            key=f"native_system_role:{text[:32]}",
            payload={"text": text, "injection_layer": "native_system_role"},
            authority_level=3,
            compression_immune=True,
            decay_tag=DecayTag.BUILT_TO_PERSIST,
            authored_by="compression_immune_injector",
        )
        await self._registry.write(surface)

    async def audit_user_message(self, session_ctx: dict) -> AuditResult:
        """检测 user_message 是否含治理规则（违规）"""
        violations: list[str] = []
        user_messages = session_ctx.get("user_messages", [])
        for i, msg in enumerate(user_messages):
            for kw in self.GOVERNANCE_KEYWORDS:
                if kw in msg:
                    violations.append(
                        f"user_message[{i}] 含治理关键词 '{kw}', 应注入 native_system_role"
                    )
        result = AuditResult(
            ok=(not violations),
            violations=violations,
            session_id=session_ctx.get("session_id"),
        )
        if violations:
            await self._audit_logger.log(
                event="forbidden_injection_layer_detected",
                payload=result.model_dump,
            )
        return result


class DefaultConflictResolver(ConflictResolver):
    """权威 + 版本仲裁器"""

    async def resolve(
        self, a: DurableSurface, b: DurableSurface
    ) -> DurableSurface:
        if a.key != b.key:
            raise ConflictUnresolvableError(
                f"key 不同不可仲裁: {a.key} vs {b.key}"
            )
        # 1. authority_level 不同 → 高权威胜
        if a.authority_level > b.authority_level:
            return a
        if b.authority_level > a.authority_level:
            return b
        # 2. version 不同 → 较新胜
        if a.version > b.version:
            return a
        if b.version > a.version:
            return b
        # 3. 都相同 → 无法仲裁
        raise ConflictUnresolvableError(
            f"key={a.key} authority_level 与 version 均相同, 无法仲裁"
        )
```

### 2.4 关键算法伪代码

**算法 1：canonical_read 返回权威最高 + 版本最新**

```
function canonical_read(key: str) -> Optional[DurableSurface]:
    rows = db.execute(
        "SELECT * FROM durable_surfaces WHERE key = ? "
        "ORDER BY authority_level DESC, version DESC LIMIT 1",
        (key,)
    )
    if rows is empty: return None
    return deserialize(rows[0])
```

**算法 2：write 同 key 自动 version+1**

```
function write(surface: DurableSurface) -> str:
    if surface.surface_type == FEATURE_SPEC:
        if not surface.payload.get("mind_council_token"):
            raise MindCouncilRequiredError

    current = canonical_read(surface.key)
    if current is not None:
        surface.version = current.version + 1

    if surface.authority_level > surface.surface_type.default_authority:
        raise InvalidSurfaceError("authority 超过 surface_type 默认上限")

    store.save(surface)
    event_bus.publish("durable_state.written", {...})
    eval_signal_writer.write_trace(...)
    return surface.surface_id
```

**算法 3：audit_user_message 检测违规注入**

```
function audit_user_message(session_ctx) -> AuditResult:
    violations = []
    for i, msg in enumerate(session_ctx.user_messages):
        for kw in GOVERNANCE_KEYWORDS:
            if kw in msg:
                violations.append(
                    f"user_message[{i}] 含治理关键词 '{kw}'"
                )
    if violations:
        audit_logger.log("forbidden_injection_layer_detected", violations)
    return AuditResult(ok=not violations, violations=violations)
```

**算法 4：上下文压缩时 compression_immune 注入**

```
async function on_context_compressed(session_ctx):
    # 列出所有 compression_immune=true 的 Surface
    immune_surfaces = registry.list_compression_immune
    # 重新注入到新上下文的 native_system_role
    for surface in immune_surfaces:
        text = surface.payload.get("text")
        if text:
            await forgekin_host.append_native_system_role(text)
    # audit 确认无治理规则在 user_message
    audit_result = injector.audit_user_message(session_ctx)
    if not audit_result.ok:
        alert_operators(audit_result.violations)
```

---

## 3. 模块实现

### 3.1 SQLite WAL 持久化实现

```python
# flowforge/infra/repo/sqlite_durable_state_store.py
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

import aiosqlite

from flowforge.core.harness.durable_state import (
    DurableStateRegistry, DurableSurface, StateSurfaceType,
)
from flowforge.core.harness.decay_tag import DecayTag


class SqliteDurableStateStore(DurableStateRegistry):
    """SQLite + WAL 实现 Durable State 持久化"""

    DDL = """
    CREATE TABLE IF NOT EXISTS durable_surfaces (
        surface_id TEXT PRIMARY KEY,
        surface_type TEXT NOT NULL,
        key TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        authority_level INTEGER NOT NULL,
        compression_immune INTEGER NOT NULL,
        decay_tag TEXT NOT NULL,
        version INTEGER NOT NULL,
        schema_version TEXT NOT NULL DEFAULT 'v1',
        wal_lsn INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        authored_by TEXT NOT NULL
    );

    -- canonical_read: 按 key 查最高权威 + 最新版本
    CREATE INDEX IF NOT EXISTS idx_ds_key_auth_ver
        ON durable_surfaces(key, authority_level DESC, version DESC);

    -- list_by_type: 按 surface_type 列出
    CREATE INDEX IF NOT EXISTS idx_ds_type
        ON durable_surfaces(surface_type);

    -- list_compression_immune: 列出压缩免疫记录
    CREATE INDEX IF NOT EXISTS idx_ds_immune
        ON durable_surfaces(compression_immune) WHERE compression_immune = 1;
    """

    def __init__(self, db_path: str) -> None:
        self._db_path = db_path
        self._conn: Optional[aiosqlite.Connection] = None

    async def _ensure_conn(self) -> aiosqlite.Connection:
        if self._conn is None:
            self._conn = await aiosqlite.connect(self._db_path)
            await self._conn.execute("PRAGMA journal_mode=WAL")
            await self._conn.execute("PRAGMA synchronous=NORMAL")
            await self._conn.execute("PRAGMA foreign_keys=ON")
            await self._conn.executescript(self.DDL)
            await self._conn.commit
        return self._conn

    async def write(self, surface: DurableSurface) -> str:
        conn = await self._ensure_conn
        if not surface.surface_id:
            surface.surface_id = f"ds-{uuid.uuid4.hex[:12]}"
        await conn.execute(
            """
            INSERT INTO durable_surfaces
                (surface_id, surface_type, key, payload_json,
                 authority_level, compression_immune, decay_tag,
                 version, schema_version, wal_lsn, created_at, authored_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                surface.surface_id, surface.surface_type.value,
                surface.key, json.dumps(surface.payload, ensure_ascii=False),
                surface.authority_level, int(surface.compression_immune),
                surface.decay_tag.value, surface.version,
                surface.schema_version, surface.wal_lsn,
                surface.created_at.isoformat,
                surface.authored_by,
            ),
        )
        await conn.commit
        await self._checkpoint_if_needed
        return surface.surface_id

    async def canonical_read(self, key: str) -> Optional[DurableSurface]:
        conn = await self._ensure_conn
        async with conn.execute(
            """
            SELECT surface_id, surface_type, key, payload_json,
                   authority_level, compression_immune, decay_tag,
                   version, schema_version, wal_lsn, created_at, authored_by
            FROM durable_surfaces
            WHERE key = ?
            ORDER BY authority_level DESC, version DESC
            LIMIT 1
            """,
            (key,),
        ) as cur:
            row = await cur.fetchone
        if row is None:
            return None
        return self._deserialize(row)

    async def list_by_type(
        self, surface_type: StateSurfaceType
    ) -> list[DurableSurface]:
        conn = await self._ensure_conn
        async with conn.execute(
            "SELECT * FROM durable_surfaces WHERE surface_type = ? "
            "ORDER BY created_at DESC",
            (surface_type.value,),
        ) as cur:
            rows = await cur.fetchall
        return [self._deserialize(r) for r in rows]

    async def list_compression_immune(self) -> list[DurableSurface]:
        conn = await self._ensure_conn
        async with conn.execute(
            "SELECT * FROM durable_surfaces WHERE compression_immune = 1 "
            "ORDER BY authority_level DESC"
        ) as cur:
            rows = await cur.fetchall
        return [self._deserialize(r) for r in rows]

    @staticmethod
    def _deserialize(row: tuple) -> DurableSurface:
        (
            surface_id, surface_type, key, payload_json,
            authority_level, compression_immune, decay_tag,
            version, schema_version, wal_lsn, created_at, authored_by,
        ) = row
        return DurableSurface(
            surface_id=surface_id,
            surface_type=StateSurfaceType(surface_type),
            key=key,
            payload=json.loads(payload_json),
            authority_level=authority_level,
            compression_immune=bool(compression_immune),
            decay_tag=DecayTag(decay_tag),
            version=version,
            schema_version=schema_version,
            wal_lsn=wal_lsn,
            created_at=datetime.fromisoformat(created_at),
            authored_by=authored_by,
        )

    async def _checkpoint_if_needed(self) -> None:
        conn = await self._ensure_conn
        await conn.execute("PRAGMA wal_checkpoint(FULL)")
```

### 3.2 关键时序图

**时序图 1：canonical_read 跨 surface_type 仲裁**

```
caller            Registry         Store           SQLite
  │                  │                │                │
  │ canonical_read   │                │                │
  │ ("task:123")     │                │                │
  ├─────────────────>│                │                │
  │                  │ SELECT ... WHERE key=?          │
  │                  │  ORDER BY authority DESC, ver DESC│
  │                  ├───────────────>│                │
  │                  │                ├───────────────>│
  │                  │                │ <──────────────│ row
  │                  │ <──────────────┤                │
  │                  │ deserialize    │                │
  │ <────────────────┤ DurableSurface (最高权威 + 最新版本)
  │                  │                │                │
  │                  │                │                │
  │ e.g. thread_trace(authority=1, ver=5) 与                          │
  │      feature_spec(authority=5, ver=2) 同 key="task:123:state"     │
  │      → 返回 feature_spec (authority=5 胜出)                       │
```

**时序图 2：上下文压缩触发 compression_immune 重注入**

```
ContextEngine       Injector          Registry         ForgekinHost
  │                    │                  │                  │
  │ on_context_        │                  │                  │
  │ compressed(ctx)    │                  │                  │
  ├───────────────────>│                  │                  │
  │                    │ list_compression_immune           │
  │                    ├─────────────────>│                  │
  │                    │ <────────────────┤ [s1, s2, s3...]  │
  │                    │                  │                  │
  │                    │ for surface in immune_surfaces:    │
  │                    │   text = surface.payload["text"]   │
  │                    │   append_native_system_role(text)  │
  │                    ├──────────────────────────────────────>│
  │                    │ <─────────────────────────────────────┤
  │                    │                  │                  │
  │                    │ audit_user_message(ctx)              │
  │                    │ (检测 user_message 是否含治理规则)   │
  │                    │ if violations: alert_operators    │
  │ <──────────────────┤ done             │                  │
```

### 3.3 错误处理策略

| # | 异常 / 场景 | 处理策略 | 用户可见行为 |
|---|------------|---------|-------------|
| E1 | `InvalidSurfaceError` authority 超过 surface_type 默认上限 | 拒绝写入, 返回 422 | caller 看到"authority_level 超过 surface_type 默认上限" |
| E2 | `ForbiddenInjectionLayerError` user_message_prepend 注入 | 拒绝写入 + audit 告警 | caller 看到"禁用 user_message_prepend 注入治理规则" |
| E3 | `ConflictUnresolvableError` 同 key authority + version 相同 | 抛出, 不写入 | caller 看到"无法仲裁冲突, 需人工介入" |
| E4 | `MindCouncilRequiredError` E4+ 写 FEATURE_SPEC 缺 token | 拒绝写入 | caller 看到"E4+ 觉醒阶写 FEATURE_SPEC 需 MindCouncil 二次确认" |
| E5 | `aiosqlite.OperationalError` DB 锁 | 指数退避重试 3 次 | 服务返回 503 |
| E6 | `aiosqlite.IntegrityError` 主键冲突 | 不重试, 抛出 | 服务返回 500 |
| E7 | `audit_user_message` 发现违规 | 不阻塞主流程, 仅 audit log + 告警 | 监控告警 |
| E8 | `event_bus.publish_async` 失败 | 不阻塞主流程, 仅 warning | 用户无感知 |
| E9 | `eval_signal_writer.write_trace` 失败 | 不阻塞主流程, 仅 warning | Eval 数据可能缺失 |
| E10 | `forgekin_host.append_native_system_role` 失败 | 重试 3 次, 仍失败抛出 | 服务返回 500 |
| E11 | `payload` JSON 序列化失败 | 抛出 InvalidSurfaceError | 服务返回 422 |

### 3.4 性能指标与优化

| # | 指标 | 目标 | 优化手段 |
|---|------|------|---------|
| P1 | `write` 延迟 | P99 < 50ms | WAL + NORMAL 同步 |
| P2 | `canonical_read` 延迟 | P99 < 5ms | 复合索引 `(key, authority DESC, version DESC)` |
| P3 | `list_by_type` 延迟（1000 条） | P99 < 30ms | `idx_ds_type` 索引 |
| P4 | `list_compression_immune` 延迟 | P99 < 20ms | 部分索引 `WHERE compression_immune = 1` |
| P5 | WAL checkpoint 频率 | 每 100 次写入或 5 分钟 | `_checkpoint_if_needed` 节流 |
| P6 | 上下文压缩重注入延迟（100 条 immune） | < 200ms | 批量查询 + 批量 append |
| P7 | 单条 DurableSurface 内存占用 | < 5KB | payload JSON 限制 4KB |
| P8 | 并发 write 吞吐 | > 200 QPS | aiosqlite 连接池 + WAL 并发读 |

### 3.5 YAML 配置示例

```yaml
# flowforge/config/harness.yaml
durable_state:
  # 6 类表面类型（不可扩展第七类）
  surface_types:
    - feature_spec
    - git
    - task_queue
    - handoff_capsule
    - memory_federation
    - thread_trace

  # 各类默认 authority_level 与 decay_tag
  surface_defaults:
    feature_spec:
      authority_level: 5
      decay_tag: BUILT_TO_PERSIST
      compression_immune: true       # feature_spec 默认压缩免疫
    git:
      authority_level: 4
      decay_tag: BUILT_TO_PERSIST
      compression_immune: true
    task_queue:
      authority_level: 3
      decay_tag: BUILT_TO_PERSIST
      compression_immune: true
    handoff_capsule:
      authority_level: 3
      decay_tag: BUILT_TO_PERSIST
      compression_immune: true
    memory_federation:
      authority_level: 2
      decay_tag: INDIVIDUAL_COMPENSATION
      compression_immune: false
    thread_trace:
      authority_level: 1
      decay_tag: BUILT_TO_DELETE
      compression_immune: false

  # 注入层约束
  injection_layer:
    allowed:
      - native_system_role
      - developer_role
    forbidden:
      - user_message_prepend        # 禁用, 仅 audit 告警

  # audit 关键词（用于检测 user_message 含治理规则）
  audit_governance_keywords:
    - 禁止
    - 必须
    - 不可
    - 应当
    - guardrail
    - 禁止绕过

  # 觉醒阶约束（E4+ 写 FEATURE_SPEC 需 MindCouncil token）
  awakening_stage_constraints:
    E1: allow_write_all
    E2: allow_write_all
    E3: allow_write_all
    E4: require_mind_council_for_feature_spec
    E5: require_mind_council_for_feature_spec
    E6: require_mind_council_for_feature_spec

  # WAL 配置
  wal:
    journal_mode: WAL
    synchronous: NORMAL
    checkpoint_interval_writes: 100
    checkpoint_interval_seconds: 300
```

---

## 4. 跨模块协作实现

### 4.1 上游调用：D002 TeamAct 读写 task_queue + thread_trace

```python
# flowforge/loop/executor.py（片段）
class TeamActLoopExecutor:
    @inject
    def __init__(self, *, durable_state_registry, ...) -> None:
        self._durable_state_registry = durable_state_registry
        ...

    async def _execute_action_step(self, state: TeamActState) -> TeamActState:
        # 写入 task_queue 表面
        surface = DurableSurface(
            surface_id=f"tq-{state.team_id}-{state.step_id}",
            surface_type=StateSurfaceType.TASK_QUEUE,
            key=f"task:{state.team_id}:state",
            payload=state.model_dump,
            authority_level=3,
            compression_immune=True,
            decay_tag=DecayTag.BUILT_TO_PERSIST,
            authored_by=state.owner,
        )
        await self._durable_state_registry.write(surface)
        return state

    async def _execute_route_step(self, state: TeamActState) -> TeamActState:
        # 写入 thread_trace 表面 (最脆, authority=1)
        trace_surface = DurableSurface(
            surface_id=f"tt-{state.team_id}-{state.step_id}",
            surface_type=StateSurfaceType.THREAD_TRACE,
            key=f"thread:{state.team_id}:trace",
            payload={"step": state.step.value, "owner": state.owner},
            authority_level=1,
            compression_immune=False,
            decay_tag=DecayTag.BUILT_TO_DELETE,
            authored_by=state.owner,
        )
        await self._durable_state_registry.write(trace_surface)
        return state
```

### 4.2 上游调用：D003 HandoffCapsule 写 handoff_capsule 表面

```python
# flowforge/core/harness/handoff_capsule.py（片段, D003）
class HandoffCapsuleStore:
    async def save(self, capsule: HandoffCapsule) -> str:
        surface = DurableSurface(
            surface_id=f"hc-{capsule.capsule_id}",
            surface_type=StateSurfaceType.HANDOFF_CAPSULE,
            key=f"handoff:{capsule.team_id}:{capsule.capsule_id}",
            payload=capsule.model_dump,
            authority_level=3,
            compression_immune=True,
            decay_tag=DecayTag.BUILT_TO_PERSIST,
            authored_by=capsule.author_forgekin_id,
        )
        return await self._registry.write(surface)
```

### 4.3 上游调用：D007 Push Back 事件写 thread_trace

```python
# flowforge/core/harness/push_back.py（片段, D007）
class DefaultBadIntuitionSink:
    async def record_bad_intuition(self, forgekin_id, push_back_id, reason):
        surface = DurableSurface(
            surface_id=f"tt-bi-{push_back_id}",
            surface_type=StateSurfaceType.THREAD_TRACE,
            key=f"thread:{forgekin_id}:bad_intuition",
            payload={"push_back_id": push_back_id, "reason": reason},
            authority_level=2,
            compression_immune=False,
            decay_tag=DecayTag.BUILT_TO_DELETE,
            authored_by=forgekin_id,
        )
        await self._registry.write(surface)
```

### 4.4 下游影响：D010 GovernanceBundle 持久化到 task_queue

```python
# flowforge/core/harness/governance.py（片段, D010）
class GovernanceLoader:
    async def load(self, config_path: str) -> GovernanceBundle:
        bundle = self._parse_yaml(config_path)
        surface = DurableSurface(
            surface_id=f"gb-{bundle.bundle_id}",
            surface_type=StateSurfaceType.TASK_QUEUE,
            key=f"governance:{bundle.bundle_id}",
            payload=bundle.model_dump,
            authority_level=4,
            compression_immune=True,         # 治理规则压缩免疫
            decay_tag=DecayTag.BUILT_TO_PERSIST,
            authored_by="operator",
        )
        await self._registry.write(surface)
        return bundle
```

### 4.5 下游影响：D011 Magic Words 触发时写 thread_trace

```python
# flowforge/core/harness/magic_words.py（片段, D011）
class MagicWordsExecutor:
    async def execute(self, word, context, operator_id):
        # 写入触发时上下文快照到 thread_trace
        surface = DurableSurface(
            surface_id=f"tt-mw-{word.value}-{datetime.now.strftime('%Y%m%d%H%M%S')}",
            surface_type=StateSurfaceType.THREAD_TRACE,
            key=f"thread:magic_word:{word.value}",
            payload={"word": word.value, "context": context, "operator_id": operator_id},
            authority_level=2,
            compression_immune=False,
            decay_tag=DecayTag.BUILT_TO_DELETE,
            authored_by=operator_id,
        )
        await self._registry.write(surface)
```

### 4.6 下游影响：D012 HotfixTag 持久化到 git + thread_trace

```python
# flowforge/core/harness/entropy.py（片段, D012）
class HotfixTagger:
    async def tag(self, commit_sha, forgekin_id, commit_message):
        # 1. 写 git 表面
        git_surface = DurableSurface(
            surface_id=f"git-{commit_sha}",
            surface_type=StateSurfaceType.GIT,
            key=f"git:commit:{commit_sha}",
            payload={"commit_sha": commit_sha, "message": commit_message},
            authority_level=4,
            compression_immune=True,
            decay_tag=DecayTag.BUILT_TO_PERSIST,
            authored_by=forgekin_id,
        )
        await self._registry.write(git_surface)

        # 2. 写 thread_trace 表面（最脆）
        tt_surface = DurableSurface(
            surface_id=f"tt-hotfix-{commit_sha}",
            surface_type=StateSurfaceType.THREAD_TRACE,
            key=f"thread:hotfix:{commit_sha}",
            payload={"commit_sha": commit_sha, "forgekin_id": forgekin_id},
            authority_level=1,
            compression_immune=False,
            decay_tag=DecayTag.BUILT_TO_DELETE,
            authored_by=forgekin_id,
        )
        await self._registry.write(tt_surface)
```

### 4.7 集成测试点

| # | 测试点 | 验证内容 | 关联 AC |
|---|--------|---------|---------|
| T1 | 写 FEATURE_SPEC（authority=5）成功 | surface 持久化 | AC-F1 |
| T2 | 写 THREAD_TRACE（authority=1）成功 | surface 持久化 | AC-F2 |
| T3 | authority 超过 surface_type 默认上限 → 拒绝 | InvalidSurfaceError | AC-F3 |
| T4 | canonical_read 返回最高权威 + 最新版本 | 跨 surface_type 仲裁 | AC-F5 |
| T5 | 同 key 多次写入 → version 单调递增 | version=1, 2, 3... | AC-F6 |
| T6 | list_by_type 按类型过滤 | 返回正确列表 | AC-F7 |
| T7 | list_compression_immune 只返回 compression_immune=true | 过滤正确 | AC-F8 |
| T8 | inject_native_system_role 写入 native_system_role | 不在 user_message | AC-F9 |
| T9 | audit_user_message 检测到治理关键词 → 告警 | violations 非空 | AC-F11 |
| T10 | ConflictResolver 高权威胜 | authority=5 胜 authority=1 | AC-F12 |
| T11 | ConflictResolver version 较新胜 | ver=3 胜 ver=2 | AC-F13 |
| T12 | ConflictResolver authority + version 相同 → 抛 ConflictUnresolvableError | 异常抛出 | AC-F14 |
| T13 | E4+ 觉醒阶写 FEATURE_SPEC 缺 token → 拒绝 | MindCouncilRequiredError | AC-F15 |
| T14 | WAL 写入后进程崩溃 → 重启可恢复 | canonical_read 返回完整数据 | AC-P3 |
| T15 | 上下文压缩触发 compression_immune 重注入 | forgekin_host.append_native_system_role 调用 | AC-F10 |

---

## 5. 详细设计验收

### 5.1 功能验收（Functional AC）

| AC | 描述 |
|----|------|
| AC-F1 | 写 FEATURE_SPEC（authority=5）成功持久化 |
| AC-F2 | 写 THREAD_TRACE（authority=1）成功持久化 |
| AC-F3 | authority_level 超过 surface_type.default_authority → InvalidSurfaceError |
| AC-F4 | `key` 不含 ":" 分隔符 → InvalidSurfaceError |
| AC-F5 | `canonical_read(key)` 返回最高权威 + 最新版本 |
| AC-F6 | 同 key 多次写入 → version 单调递增 |
| AC-F7 | `list_by_type` 按类型过滤正确 |
| AC-F8 | `list_compression_immune` 只返回 compression_immune=true |
| AC-F9 | `inject_native_system_role` 写入 native_system_role，不在 user_message |
| AC-F10 | 上下文压缩时 compression_immune=true 的 Surface 重注入到新上下文 |
| AC-F11 | `audit_user_message` 检测到治理关键词 → audit log + 告警 |
| AC-F12 | `ConflictResolver` authority_level 不同 → 高权威胜 |
| AC-F13 | `ConflictResolver` version 不同 → 较新胜 |
| AC-F14 | `ConflictResolver` authority + version 相同 → ConflictUnresolvableError |
| AC-F15 | E4+ 觉醒阶写 FEATURE_SPEC 缺 MindCouncil token → MindCouncilRequiredError |
| AC-F16 | 6 类 surface_type 不可扩展第七类 |
| AC-F17 | `forbidden_layers` 必须包含 user_message_prepend |
| AC-F18 | DecayTag 默认值与 surface_type 对应关系正确 |

### 5.2 性能验收（Performance AC）

| AC | 描述 |
|----|------|
| AC-P1 | `write` P99 延迟 < 50ms |
| AC-P2 | `canonical_read` P99 延迟 < 5ms |
| AC-P3 | WAL 写入后进程崩溃, 重启后 `canonical_read` 可恢复完整数据 |
| AC-P4 | `list_by_type` 1000 条 P99 < 30ms |
| AC-P5 | `list_compression_immune` P99 < 20ms |
| AC-P6 | 上下文压缩重注入 100 条 immune < 200ms |
| AC-P7 | 并发 write 吞吐 > 200 QPS |

### 5.3 安全验收（Security AC）

| AC | 描述 |
|----|------|
| AC-S1 | `flowforge/core/harness/durable_state.py` 不 import forgemind 或 *Forge 模块 |
| AC-S2 | Registry / Injector / Resolver 通过 `@inject` 注入, 无直接实例化 |
| AC-S3 | 所有 DB 操作通过 Repository, 无 `cursor.execute` |
| AC-S4 | `user_message_prepend` 注入治理规则被拒绝 + audit 告警 |
| AC-S5 | E4+ 觉醒阶写 FEATURE_SPEC 强制 MindCouncil 二次确认 |
| AC-S6 | audit 日志禁删除, 所有违规注入可追溯 |

### 5.4 Eval 验收（Eval AC）

| AC | 描述 |
|----|------|
| AC-E1 | 每次 write 写 eval_signal "durable_state_written" |
| AC-E2 | 每次 canonical_read 写 eval_signal "durable_state_read" |
| AC-E3 | audit 发现违规写 eval_signal "forbidden_injection_detected" |
| AC-E4 | 上下文压缩重注入次数作为 F040 控制面指标 |
| AC-E5 | 各 surface_type 写入分布作为 F040 控制面指标 |

---

## 6. 引用

- [doc:../spec.md#§3.3]（FR-CORE-003, FR-CORE-008 Durable State Surfaces）
- [doc:../arch.md#§3.3]（Harness 七层现实表面, L1 Durable State）
- [doc:../features/F008-durable-state-surfaces.md]（同号 Feature 级 SRS）
- [doc:../architecture/A008-durable-state-surfaces.md]（架构权威源）
- [doc:../architecture/A002-teamact-loop.md]（task_queue + thread_trace 读写）
- [doc:../architecture/A003-handoff-capsule.md]（handoff_capsule 表面）
- [doc:../architecture/A007-push-back-protocol.md]（thread_trace 写入）
- [doc:../architecture/A009-evidence-sensors.md]（task_queue + thread_trace 证据）
- [doc:../architecture/A010-governance-boundary.md]（GovernanceBundle 持久化）
- [doc:../architecture/A011-magic-words.md]（触发时上下文快照写入 thread_trace）
- [doc:../architecture/A012-entropy-control.md]（HotfixTag 写 git + thread_trace）
- [doc:../architecture/A021-side-effect-wal.md]（WAL 可重放）
- [doc:../decisions/007-harness-engineering.md]（Harness 工程路径 ADR）
- [doc:../../CONTRIBUTING.md]（文档分层规范）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（详细设计骨架, 对应 F008 / A008） | 开发者 Forgekin（猎犬·夏洛克） |
