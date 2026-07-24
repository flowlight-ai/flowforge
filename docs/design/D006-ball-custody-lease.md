# D006: 持球注册 Lease（Ball Custody Lease）详细设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 开发者 Forgekin（猎犬·夏洛克）
> **对应 spec.md**: [doc:../spec.md#§3.2]（FR-CORE-002，FR-CORE-016）
> **对应 arch.md**: [doc:../arch.md#§3.2]
> **对应 design.md**: [doc:../design.md#§3.2]
> **对应 Feature**: [doc:../features/F006-ball-custody-lease.md]（同号 Feature 级 SRS）
> **对应 Architecture**: [doc:../architecture/A006-ball-custody-lease.md]（同号架构设计）
> **依赖 ADR**: [doc:../decisions/002-collaboration-protocol.md]

---

## 1. 详细设计上下文

### 1.1 详细设计问题

A006 架构设计已给出"持球注册 lease + 定时唤醒"的协议层硬要求与接口契约，但落地到代码层仍需解决以下问题：

1. **lease TTL 与 renewal 的并发安全**：同一Forgekin在 lease 即将过期时同时调用 `renew` 与 `release`，如何保证状态机一致性？需要明确 lease 状态转换的原子语义。
2. **WakeupScheduler 多源监听的去重**：CI 绿、CVO 确认、定时器、外部事件四种唤醒源可能同时触发同一 lease 的唤醒，如何保证只唤醒一次（at-most-once）？
3. **一Forgekin同时只能持有一个 lease 的强制校验**：acquire 时如何可靠地校验？需要并发安全的 `find_active_lease_by_forgekin` 查询。
4. **lease 过期扫描的周期与延迟**：TTL 到期未续约需要多快感知？扫描周期 1s 还是 10s？对 F004 PingPongCircuitBreaker 的空传计入有延迟影响。
5. **Magic Words "星星罐子" 强制撤销的优先级**：operator 触发 STAR_JAR 时如何中断正在进行的 lease 操作？是否需要 cancellation token？
6. **lease 状态走 WAL 的回放契约**：进程崩溃后 lease 仍在但 TTL 计时器丢失，如何恢复 TTL 剩余时间？是基于 `acquired_at + ttl_seconds - now` 重新计算还是直接 expired？
7. **lease 与 TeamActState.current_owner 的一致性**：lease 释放后必须同步置 `current_owner=None`，但若 TeamActRepo 更新失败如何回滚？

### 1.2 详细设计约束

- **C1 单向依赖**：`flowforge/core/teamact/lease.py` 不可 import forgemind 或 *Forge 模块；仅可依赖 `core/teamact/`、`core/plugin/di_container.py`、`core/tracing.py`、`core/events/`。
- **C2 DI 注入**：`BallCustodyRegistry` 必须通过 `core/plugin/di_container.py::inject` 注入 `LeaseStore`、`WakeupScheduler`、`TeamActStateRepository`、`EventBus`、`EvalSignalWriter`，禁直接实例化。
- **C3 Repository 抽象**：lease 状态必须通过 `LeaseStore (ABC)` 抽象持久化，禁 `cursor.execute`，禁 `sqlite3.connect` 直连。
- **C4 配置驱动**：`default_ttl_seconds`、`max_renewals`、`renewal_extension_seconds`、`expiry_scan_interval_seconds` 必须外置到 `flowforge/config/teamact.yaml`，禁硬编码。
- **C5 TTL 强制**：lease 必须有 TTL（默认 1800 秒），到期未续约自动释放；TTL 不可设为 0 或负数（禁永久持有）。
- **C6 续约上限**：续约次数超 `max_renewals`（默认 3）强制释放并升级 CVO；`max_renewals` 不可超过 10。
- **C7 一Forgekin一 lease**：`acquire` 时校验该 forgekin_id 是否已有 active lease，有则抛 `LeaseAlreadyHeld`。
- **C8 WAL 持久化**：`SqliteLeaseStore` 必须启用 `PRAGMA journal_mode=WAL` + `PRAGMA synchronous=NORMAL` + 定期 `PRAGMA wal_checkpoint(FULL)`。
- **C9 异步非阻塞**：所有 I/O 操作必须 `async/await`；TTL 扫描通过 `asyncio.create_task` 后台运行，禁阻塞主流程。
- **C10 类型注解强制**：Python 3.11+，所有公共方法返回类型与参数类型必须显式注解。
- **C11 Magic Words 不可绕过**：`force_revoke` 由 `MagicWordsExecutor` 调用，Forgekin不可直接调用；`force_revoke` 绕过 `max_renewals` 检查。
- **C12 lease 释放广播**：lease 释放后必须广播 `lease.released` 事件，TeamActState 可感知接管。

### 1.3 详细设计影响

- **I1 对 D002 TeamAct Loop 的影响**：`TeamActLoopExecutor` 在 Owner 步触发 `acquire`，STATE 步消费 lease 状态；lease 释放后球回 TeamActState 可被接管。
- **I2 对 D005 At-Mention Routing 的影响**：`take` 意图触发 `acquire_for`，`pass` 意图触发 `release_for`；条件路由挂起期间 lease 持续 held。
- **I3 对 D004 PingPong Circuit Breaker 的影响**：lease held 期间无工具调用 + 无产出计入空传；lease 释放后空传计数清零（球已转移）。
- **I4 对 D003 Handoff Capsule 的影响**：lease 的 `next_step` 字段是唤醒后执行的依据，写入 HandoffCapsule.next_step 同步。
- **I5 对 D011 Magic Words 的影响**："星星罐子"通过 `force_revoke` 强制撤销 lease，绕过 `max_renewals`。
- **I6 对 D018 Eval Contract 的影响**：lease 过期/续约/释放是 Eval 信号源，写入 `EvalSignalWriter`。
- **I7 对 D021 Side Effect WAL 的影响**：lease 状态走 WAL，进程崩溃后 lease 仍在，TTL 计时持续。
- **I8 对 D022 Tier 1-4 Recovery 的影响**：lease 走 Tier 2 恢复分级（业务状态恢复）。

---

## 2. 详细设计

### 2.1 组件类图

```
┌─────────────────────────────────────────────────────────────────────┐
│                  flowforge/core/teamact/lease.py                     │
│                                                                     │
│  ┌──────────────────────┐   ┌────────────────────────────────────┐  │
│  │ BallCustodyLease     │   │ WakeupEvent                        │  │
│  │ (Pydantic 数据模型)  │   │ (Pydantic 数据模型)                │  │
│  ├──────────────────────┤   ├────────────────────────────────────┤  │
│  │ lease_id: str        │   │ lease_id: str                      │  │
│  │ team_id: str         │   │ trigger: WakeupTrigger             │  │
│  │ forgekin_id: str     │   │ fired_at: datetime                 │  │
│  │ reason: str          │   │ payload: dict                      │  │
│  │ next_step: str       │   └────────────────────────────────────┘  │
│  │ expected_wake_at     │                                           │
│  │ acquired_at          │   ┌────────────────────────────────────┐  │
│  │ ttl_seconds: int     │   │ LeaseStatus (Enum)                 │  │
│  │ status: LeaseStatus  │   ├────────────────────────────────────┤  │
│  │ renewal_count: int   │   │ HELD / RENEWED / RELEASED /        │  │
│  │ max_renewals: int    │   │ EXPIRED / REVOKED                  │  │
│  │ fallback_owner       │   └────────────────────────────────────┘  │
│  │ decay_tag            │                                           │
│  └──────────────────────┘   ┌────────────────────────────────────┐  │
│                              │ WakeupTrigger (Enum)               │  │
│  ┌──────────────────────────┤────────────────────────────────────┤  │
│  │ BallCustodyRegistry(ABC) │ CI_GREEN / CVO_CONFIRM / TIMER /   │  │
│  ├──────────────────────────┤ EXTERNAL                           │  │
│  │ + acquire(lease) -> str  │ └────────────────────────────────────┘  │
│  │ + renew(lid, ext) -> None│                                       │
│  │ + release(lid) -> None   │  ┌──────────────────────────────────┐  │
│  │ + list_active(team) -> ..│  │ LeaseStore (ABC)                  │  │
│  │ + force_revoke(lid, rsn) │  ├──────────────────────────────────┤  │
│  └──────────────────────────┘  │ + save(lease) -> str              │  │
│              ▲                  │ + load(lease_id) -> Optional     │  │
│              │                  │ + find_active_by_forgekin(fk)    │  │
│  ┌───────────┴──────────────┐   │ + list_active_by_team(team)      │  │
│  │ DefaultBallCustodyReg.   │   │ + mark_status(lid, status)       │  │
│  ├──────────────────────────┤   │ + replay_from(lsn)               │  │
│  │ - _store: LeaseStore     │   └──────────────────────────────────┘  │
│  │ - _scheduler: WakeupSch. │                  ▲                       │
│  │ - _teamact_repo          │                  │                       │
│  │ - _event_bus             │   ┌──────────────┴───────────────────┐   │
│  │ - _eval_signal_writer    │   │ SqliteLeaseStore (WAL)           │   │
│  │ - _lock: asyncio.Lock    │   ├──────────────────────────────────┤   │
│  │ - _expiry_task: Task     │   │ - _db_path / _conn / _lock       │   │
│  └──────────────────────────┘   │ + _ensure_schema               │   │
│                                  │ + _checkpoint                  │   │
│  ┌──────────────────────────┐    └──────────────────────────────────┘   │
│  │ WakeupScheduler (ABC)    │                                           │
│  ├──────────────────────────┤    ┌──────────────────────────────────┐  │
│  │ + schedule(lease)        │    │ LeaseLifecycleManager (ABC)      │  │
│  │ + fire(event)            │    ├──────────────────────────────────┤  │
│  │ + cancel(lease_id)       │    │ + check_ttl_expiry -> [ids]    │  │
│  └──────────────────────────┘    │ + force_revoke(lid, reason)      │  │
│              ▲                    └──────────────────────────────────┘  │
│              │                              ▲                          │
│  ┌───────────┴──────────────┐                │                          │
│  │ DefaultWakeupScheduler   │     ┌──────────┴─────────────┐           │
│  │ - _event_listeners       │     │ DefaultLifecycleManager│           │
│  │ - _pending_wakeups       │     │ - _registry            │           │
│  └──────────────────────────┘     └────────────────────────┘           │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Pydantic 数据模型

```python
# flowforge/core/teamact/lease.py
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


class LeaseStatus(str, Enum):
    """lease 状态机（5 态，禁第六态）"""
    HELD = "held"               # 持有中
    RENEWED = "renewed"         # 已续约（仍是持有态的子状态）
    RELEASED = "released"       # 主动释放
    EXPIRED = "expired"         # TTL 过期未续约
    REVOKED = "revoked"         # 强制撤销（Magic Words）


class WakeupTrigger(str, Enum):
    """唤醒源（4 种，禁第五种）"""
    CI_GREEN = "ci_green"
    CVO_CONFIRM = "cvo_confirm"
    TIMER = "timer"
    EXTERNAL = "external"


class DecayTag(str, Enum):
    """半衰期标记"""
    BUILT_TO_PERSIST = "built_to_persist"
    BUILT_TO_DELETE = "built_to_delete"
    INDIVIDUAL_COMPENSATION = "individual_compensation"


class BallCustodyLease(BaseModel):
    """持球注册 lease — 分布式 lease + 定时唤醒"""
    lease_id: str = Field(..., min_length=1, description="lease 唯一 ID")
    team_id: str = Field(..., min_length=1, description="TeamAct team_id")
    forgekin_id: str = Field(..., min_length=1, description="持球Forgekin ID")
    reason: str = Field(..., min_length=1, description="等待原因（CI/CVO/timer/external）")
    next_step: str = Field(..., min_length=1, description="唤醒后执行的下一步")
    expected_wake_at: datetime = Field(..., description="预期唤醒时间")
    acquired_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="lease 获取时间（UTC）",
    )
    ttl_seconds: int = Field(default=1800, ge=60, le=86400, description="TTL 秒数（60-86400）")
    status: LeaseStatus = Field(default=LeaseStatus.HELD, description="lease 状态")
    renewal_count: int = Field(default=0, ge=0, description="已续约次数")
    max_renewals: int = Field(default=3, ge=0, le=10, description="最大续约次数")
    fallback_owner: Optional[str] = Field(
        default=None,
        description="lease 过期后的兜底 owner（如 cvo 或 team_lead）",
    )
    schema_version: str = Field(default="1.0", pattern=r"^\d+\.\d+$")
    decay_tag: DecayTag = Field(
        default=DecayTag.BUILT_TO_PERSIST,
        description="lease 协议是 Build to Persist 协作资产",
    )
    authority_level: int = Field(default=3, ge=1, le=5, description="写入 task_queue，权威 3")
    compression_immune: bool = Field(
        default=False,
        description="lease 状态本身非治理规则，无需压缩免疫",
    )
    wal_lsn: Optional[int] = Field(default=None, description="WAL 日志序列号")

    @field_validator("reason", "next_step")
    @classmethod
    def _non_empty_text(cls, v: str) -> str:
        if not v or not v.strip:
            raise ValueError("reason / next_step 不可为空")
        return v.strip

    @model_validator(mode="after")
    def _check_status_consistency(self) -> "BallCustodyLease":
        # 终态校验：released/expired/revoked 后不可再修改
        if self.status in (LeaseStatus.RELEASED, LeaseStatus.EXPIRED, LeaseStatus.REVOKED):
            if self.renewal_count > 0 and self.status == LeaseStatus.RELEASED:
                pass  # released 前可能续约过，合法
        # expected_wake_at 必须晚于 acquired_at
        if self.expected_wake_at <= self.acquired_at:
            raise ValueError("expected_wake_at 必须晚于 acquired_at")
        return self

    def is_active(self) -> bool:
        """lease 是否仍持有中（HELD 或 RENEWED）"""
        return self.status in (LeaseStatus.HELD, LeaseStatus.RENEWED)

    def is_expired_at(self, now: datetime) -> bool:
        """检查 TTL 是否过期"""
        if not self.is_active:
            return False
        elapsed = (now - self.acquired_at).total_seconds
        # renewed 状态按 expected_wake_at 判定
        if self.status == LeaseStatus.RENEWED:
            return now >= self.expected_wake_at
        return elapsed >= self.ttl_seconds

    def remaining_ttl(self, now: Optional[datetime] = None) -> int:
        """剩余 TTL 秒数"""
        if not self.is_active:
            return 0
        now = now or datetime.now(timezone.utc)
        if self.status == LeaseStatus.RENEWED:
            return max(0, int((self.expected_wake_at - now).total_seconds))
        elapsed = (now - self.acquired_at).total_seconds
        return max(0, int(self.ttl_seconds - elapsed))


class WakeupEvent(BaseModel):
    """唤醒事件"""
    event_id: str = Field(..., min_length=1)
    lease_id: str = Field(..., min_length=1)
    trigger: WakeupTrigger
    fired_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    payload: dict = Field(default_factory=dict)
    processed: bool = Field(default=False, description="是否已处理（at-most-once）")
    schema_version: str = Field(default="1.0", pattern=r"^\d+\.\d+$")
    decay_tag: DecayTag = Field(default=DecayTag.BUILT_TO_PERSIST)
```

### 2.3 异常定义

```python
# flowforge/core/teamact/lease.py（续）

class LeaseError(Exception):
    """lease 基础异常"""


class LeaseAlreadyHeld(LeaseError):
    """一Forgekin已持有 lease（禁多球）"""

    def __init__(self, forgekin_id: str, existing_lease_id: str) -> None:
        self.forgekin_id = forgekin_id
        self.existing_lease_id = existing_lease_id
        super.__init__(
            f"forgekin {forgekin_id} already holds lease {existing_lease_id}"
        )


class LeaseNotFound(LeaseError):
    """lease 不存在"""


class LeaseAlreadyTerminal(LeaseError):
    """lease 已是终态（released/expired/revoked），不可再操作"""

    def __init__(self, lease_id: str, status: LeaseStatus) -> None:
        self.lease_id = lease_id
        self.status = status
        super.__init__(f"lease {lease_id} already terminal: {status}")


class MaxRenewalsExceeded(LeaseError):
    """续约次数超限，需升级 CVO"""

    def __init__(self, lease_id: str, renewal_count: int, max_renewals: int) -> None:
        self.lease_id = lease_id
        self.renewal_count = renewal_count
        self.max_renewals = max_renewals
        super.__init__(
            f"lease {lease_id} renewals {renewal_count} > max {max_renewals}"
        )


class MagicWordsRevokeRequired(LeaseError):
    """必须由 Magic Words 触发的撤销"""
```

### 2.4 抽象接口契约

```python
# flowforge/core/teamact/lease.py（续）
from abc import ABC, abstractmethod


class LeaseStore(ABC):
    """lease Repository 抽象"""

    @abstractmethod
    async def save(self, lease: BallCustodyLease) -> str:
        """保存 lease（新建或更新），返回 lease_id"""

    @abstractmethod
    async def load(self, lease_id: str) -> Optional[BallCustodyLease]:
        """按 ID 加载 lease"""

    @abstractmethod
    async def find_active_by_forgekin(
        self,
        forgekin_id: str,
    ) -> Optional[BallCustodyLease]:
        """查找该Forgekin的活跃 lease（HELD/RENEWED）"""

    @abstractmethod
    async def list_active_by_team(
        self,
        team_id: str,
    ) -> list[BallCustodyLease]:
        """列出团队所有活跃 lease"""

    @abstractmethod
    async def list_expiring(
        self,
        before: datetime,
        limit: int = 100,
    ) -> list[BallCustodyLease]:
        """列出即将过期（expected_wake_at <= before）的活跃 lease"""

    @abstractmethod
    async def mark_status(
        self,
        lease_id: str,
        status: LeaseStatus,
    ) -> None:
        """标记 lease 状态变更"""

    @abstractmethod
    async def replay_from(self, checkpoint_lsn: int) -> list[BallCustodyLease]:
        """从 WAL checkpoint 重放 lease 状态"""


class WakeupScheduler(ABC):
    """定时唤醒调度器抽象"""

    @abstractmethod
    async def schedule(self, lease: BallCustodyLease) -> None:
        """调度 lease 的唤醒监听"""

    @abstractmethod
    async def fire(self, event: WakeupEvent) -> bool:
        """触发唤醒事件，返回是否首次触发（at-most-once）"""

    @abstractmethod
    async def cancel(self, lease_id: str) -> None:
        """取消 lease 的唤醒监听（lease 释放时调用）"""

    @abstractmethod
    async def list_pending(self, lease_id: str) -> list[WakeupEvent]:
        """列出 lease 的待处理唤醒事件"""


class BallCustodyRegistry(ABC):
    """持球注册中心 — 单一真相源"""

    @abstractmethod
    async def acquire(self, lease: BallCustodyLease) -> str:
        """注册 lease

        架构契约:
        - 一Forgekin同时只能持有一个 lease（禁多球）
        - 持久化到 Repository 层（WAL 可重放）
        - 启动 TTL 计时器
        - 注册 WakeupScheduler 监听
        """

    @abstractmethod
    async def acquire_for(
        self,
        forgekin_id: str,
        team_id: str,
        reason: str,
        next_step: str,
        ttl_seconds: Optional[int] = None,
    ) -> str:
        """便捷方法：构造并注册 lease"""

    @abstractmethod
    async def renew(
        self,
        lease_id: str,
        extension_seconds: int = 1800,
    ) -> None:
        """续约 lease

        架构契约:
        - renewal_count +1
        - 超过 max_renewals 强制释放 + 升级 CVO
        - 更新 expected_wake_at
        """

    @abstractmethod
    async def release(self, lease_id: str) -> None:
        """主动释放 lease

        架构契约:
        - 球回 TeamActState（current_owner=None）
        - 广播 lease.released 事件
        """

    @abstractmethod
    async def release_for(
        self,
        forgekin_id: str,
        team_id: str,
    ) -> None:
        """便捷方法：释放该Forgekin在该团队的活跃 lease"""

    @abstractmethod
    async def list_active(self, team_id: str) -> list[BallCustodyLease]:
        """列出团队所有活跃 lease"""

    @abstractmethod
    async def force_revoke(
        self,
        lease_id: str,
        reason: str,
    ) -> None:
        """强制撤销（仅 Magic Words 触发）

        架构契约:
        - 仅 operator 通过 Magic Words "星星罐子" 触发
        - 绕过 max_renewals 检查
        - Forgekin不可调用
        """


class LeaseLifecycleManager(ABC):
    """lease 生命周期管理器"""

    @abstractmethod
    async def check_ttl_expiry(self) -> list[str]:
        """检查 TTL 过期 lease

        架构契约:
        - TTL 到期未续约自动释放（status=expired）
        - 球回 TeamActState
        - 写 Eval 信号
        - 返回过期 lease_id 列表
        """

    @abstractmethod
    async def force_revoke(self, lease_id: str, reason: str) -> None:
        """强制撤销（Magic Words 触发）"""
```

### 2.5 默认实现

```python
# flowforge/core/teamact/lease.py（续）
import asyncio
import uuid
from core.plugin.di_container import inject


class DefaultBallCustodyRegistry(BallCustodyRegistry):
    """默认持球注册中心（DI 注入依赖）"""

    @inject
    def __init__(
        self,
        *,
        store: LeaseStore,
        scheduler: WakeupScheduler,
        teamact_repo: "TeamActStateRepository",
        event_bus: "EventBus",
        eval_signal_writer: "EvalSignalWriter",
        default_ttl_seconds: int = 1800,
        max_renewals: int = 3,
        renewal_extension_seconds: int = 1800,
        expiry_scan_interval_seconds: int = 5,
    ) -> None:
        self._store = store
        self._scheduler = scheduler
        self._teamact_repo = teamact_repo
        self._event_bus = event_bus
        self._eval_signal_writer = eval_signal_writer
        self._default_ttl_seconds = default_ttl_seconds
        self._max_renewals = max_renewals
        self._renewal_extension_seconds = renewal_extension_seconds
        self._expiry_scan_interval_seconds = expiry_scan_interval_seconds
        self._lock = asyncio.Lock
        self._expiry_task: Optional[asyncio.Task] = None
        from core.tracing import get_logger
        self._logger = get_logger("flowforge.lease.registry")

    async def start_expiry_scanner(self) -> None:
        """启动 TTL 过期后台扫描任务"""
        if self._expiry_task is None or self._expiry_task.done:
            self._expiry_task = asyncio.create_task(self._expiry_scan_loop)

    async def stop_expiry_scanner(self) -> None:
        if self._expiry_task and not self._expiry_task.done:
            self._expiry_task.cancel
            try:
                await self._expiry_task
            except asyncio.CancelledError:
                pass
            self._expiry_task = None

    async def acquire(self, lease: BallCustodyLease) -> str:
        async with self._lock:
            # 1. 校验一Forgekin一 lease
            existing = await self._store.find_active_by_forgekin(lease.forgekin_id)
            if existing:
                raise LeaseAlreadyHeld(lease.forgekin_id, existing.lease_id)
            # 2. 持久化
            lease_id = await self._store.save(lease)
            # 3. 注册唤醒调度
            await self._scheduler.schedule(lease)
            # 4. 同步 TeamActState.current_owner
            await self._teamact_repo.update_owner(
                team_id=lease.team_id,
                new_owner=lease.forgekin_id,
            )
            # 5. 广播事件 + 写 Eval
            await self._event_bus.publish_async(
                "lease.acquired",
                {
                    "lease_id": lease_id,
                    "forgekin_id": lease.forgekin_id,
                    "team_id": lease.team_id,
                    "reason": lease.reason,
                    "expected_wake_at": lease.expected_wake_at.isoformat,
                },
            )
            self._eval_signal_writer.write_trace(
                signal_type="lease_acquired",
                payload={
                    "lease_id": lease_id,
                    "forgekin_id": lease.forgekin_id,
                    "ttl_seconds": lease.ttl_seconds,
                },
            )
            self._logger.info(
                "lease acquired lease_id=%s forgekin=%s team=%s ttl=%s",
                lease_id, lease.forgekin_id, lease.team_id, lease.ttl_seconds,
            )
            return lease_id

    async def acquire_for(
        self,
        forgekin_id: str,
        team_id: str,
        reason: str,
        next_step: str,
        ttl_seconds: Optional[int] = None,
    ) -> str:
        now = datetime.now(timezone.utc)
        ttl = ttl_seconds or self._default_ttl_seconds
        lease = BallCustodyLease(
            lease_id=f"lease-{uuid.uuid4.hex[:16]}",
            team_id=team_id,
            forgekin_id=forgekin_id,
            reason=reason,
            next_step=next_step,
            expected_wake_at=now + timedelta(seconds=ttl),
            ttl_seconds=ttl,
            max_renewals=self._max_renewals,
        )
        return await self.acquire(lease)

    async def renew(
        self,
        lease_id: str,
        extension_seconds: int = 1800,
    ) -> None:
        async with self._lock:
            lease = await self._store.load(lease_id)
            if lease is None:
                raise LeaseNotFound(lease_id)
            if not lease.is_active:
                raise LeaseAlreadyTerminal(lease_id, lease.status)
            # 续约次数检查
            if lease.renewal_count >= self._max_renewals:
                # 强制释放 + 升级 CVO
                await self._mark_terminal(lease, LeaseStatus.RELEASED)
                await self._event_bus.publish_async(
                    "cvo.escalate.max_renewals_exceeded",
                    {
                        "lease_id": lease_id,
                        "renewal_count": lease.renewal_count,
                        "max_renewals": self._max_renewals,
                    },
                )
                raise MaxRenewalsExceeded(
                    lease_id, lease.renewal_count, self._max_renewals
                )
            # 续约
            lease.renewal_count += 1
            lease.status = LeaseStatus.RENEWED
            lease.expected_wake_at = datetime.now(timezone.utc) + timedelta(
                seconds=extension_seconds
            )
            await self._store.save(lease)
            await self._event_bus.publish_async(
                "lease.renewed",
                {
                    "lease_id": lease_id,
                    "renewal_count": lease.renewal_count,
                    "expected_wake_at": lease.expected_wake_at.isoformat,
                },
            )
            self._eval_signal_writer.write_trace(
                signal_type="lease_renewed",
                payload={
                    "lease_id": lease_id,
                    "renewal_count": lease.renewal_count,
                },
            )
            self._logger.info(
                "lease renewed lease_id=%s count=%s/%s",
                lease_id, lease.renewal_count, self._max_renewals,
            )

    async def release(self, lease_id: str) -> None:
        async with self._lock:
            lease = await self._store.load(lease_id)
            if lease is None:
                raise LeaseNotFound(lease_id)
            if not lease.is_active:
                # 幂等：已是终态，no-op
                self._logger.warning(
                    "lease %s already terminal: %s", lease_id, lease.status
                )
                return
            await self._mark_terminal(lease, LeaseStatus.RELEASED)

    async def release_for(
        self,
        forgekin_id: str,
        team_id: str,
    ) -> None:
        lease = await self._store.find_active_by_forgekin(forgekin_id)
        if lease is None or lease.team_id != team_id:
            return
        await self.release(lease.lease_id)

    async def list_active(self, team_id: str) -> list[BallCustodyLease]:
        return await self._store.list_active_by_team(team_id)

    async def force_revoke(
        self,
        lease_id: str,
        reason: str,
    ) -> None:
        async with self._lock:
            lease = await self._store.load(lease_id)
            if lease is None:
                raise LeaseNotFound(lease_id)
            if not lease.is_active:
                return  # 幂等
            # 绕过 max_renewals 检查，直接撤销
            await self._mark_terminal(lease, LeaseStatus.REVOKED)
            # 升级 CVO
            await self._event_bus.publish_async(
                "cvo.escalate.lease_revoked",
                {
                    "lease_id": lease_id,
                    "forgekin_id": lease.forgekin_id,
                    "reason": reason,
                },
            )
            self._logger.warning(
                "lease FORCE REVOKED lease_id=%s forgekin=%s reason=%s",
                lease_id, lease.forgekin_id, reason,
            )

    async def _mark_terminal(
        self,
        lease: BallCustodyLease,
        new_status: LeaseStatus,
    ) -> None:
        lease.status = new_status
        await self._store.save(lease)
        await self._scheduler.cancel(lease.lease_id)
        # 球回 TeamActState（current_owner=None 或 fallback_owner）
        new_owner = lease.fallback_owner  # 可能为 None
        await self._teamact_repo.update_owner(
            team_id=lease.team_id,
            new_owner=new_owner,  # None 表示球可被接管
        )
        await self._event_bus.publish_async(
            "lease.released",
            {
                "lease_id": lease.lease_id,
                "forgekin_id": lease.forgekin_id,
                "team_id": lease.team_id,
                "final_status": new_status.value,
                "new_owner": new_owner,
            },
        )
        self._eval_signal_writer.write_trace(
            signal_type="lease_released",
            payload={
                "lease_id": lease.lease_id,
                "final_status": new_status.value,
            },
        )

    async def _expiry_scan_loop(self) -> None:
        """TTL 过期后台扫描"""
        while True:
            try:
                await asyncio.sleep(self._expiry_scan_interval_seconds)
                now = datetime.now(timezone.utc)
                expiring = await self._store.list_expiring(before=now, limit=100)
                for lease in expiring:
                    try:
                        async with self._lock:
                            fresh = await self._store.load(lease.lease_id)
                            if fresh is None or not fresh.is_active:
                                continue
                            if not fresh.is_expired_at(now):
                                continue
                            await self._mark_terminal(fresh, LeaseStatus.EXPIRED)
                            self._logger.info(
                                "lease EXPIRED lease_id=%s forgekin=%s",
                                fresh.lease_id, fresh.forgekin_id,
                            )
                    except Exception as exc:
                        self._logger.exception(
                            "expiry scan failed for lease %s: %s",
                            lease.lease_id, exc,
                        )
            except asyncio.CancelledError:
                break
            except Exception as exc:
                self._logger.exception("expiry scan loop error: %s", exc)
                await asyncio.sleep(self._expiry_scan_interval_seconds)


class DefaultWakeupScheduler(WakeupScheduler):
    """默认唤醒调度器"""

    @inject
    def __init__(
        self,
        *,
        event_bus: "EventBus",
        ci_listener: "Optional[CIStatusListener]" = None,
        cvo_listener: "Optional[CVOConfirmListener]" = None,
    ) -> None:
        self._event_bus = event_bus
        self._ci_listener = ci_listener
        self._cvo_listener = cvo_listener
        self._pending: dict[str, list[WakeupEvent]] = {}
        self._processed_event_ids: set[str] = set
        self._lock = asyncio.Lock
        from core.tracing import get_logger
        self._logger = get_logger("flowforge.lease.scheduler")

    async def schedule(self, lease: BallCustodyLease) -> None:
        async with self._lock:
            self._pending[lease.lease_id] = []
        # 注册定时器唤醒（CI/CVO 由外部 listener 推送）
        timer_event = WakeupEvent(
            event_id=f"we-{uuid.uuid4.hex[:16]}",
            lease_id=lease.lease_id,
            trigger=WakeupTrigger.TIMER,
            fired_at=lease.expected_wake_at,
            payload={"expected_wake_at": lease.expected_wake_at.isoformat},
        )
        # 定时器延迟触发
        delay = (lease.expected_wake_at - datetime.now(timezone.utc)).total_seconds
        if delay > 0:
            asyncio.create_task(self._delayed_fire(timer_event, delay))

    async def _delayed_fire(self, event: WakeupEvent, delay: float) -> None:
        try:
            await asyncio.sleep(delay)
            await self.fire(event)
        except asyncio.CancelledError:
            pass

    async def fire(self, event: WakeupEvent) -> bool:
        async with self._lock:
            if event.event_id in self._processed_event_ids:
                self._logger.info(
                    "wakeup event %s already processed (at-most-once)",
                    event.event_id,
                )
                return False
            self._processed_event_ids.add(event.event_id)
            self._pending.setdefault(event.lease_id, []).append(event)
        # 广播唤醒事件，由 TeamActLoopExecutor 监听执行 lease.next_step
        await self._event_bus.publish_async(
            "lease.wakeup.fired",
            {
                "event_id": event.event_id,
                "lease_id": event.lease_id,
                "trigger": event.trigger.value,
                "payload": event.payload,
            },
        )
        self._logger.info(
            "wakeup fired lease_id=%s trigger=%s",
            event.lease_id, event.trigger.value,
        )
        return True

    async def cancel(self, lease_id: str) -> None:
        async with self._lock:
            self._pending.pop(lease_id, None)

    async def list_pending(self, lease_id: str) -> list[WakeupEvent]:
        async with self._lock:
            return list(self._pending.get(lease_id, []))


class DefaultLeaseLifecycleManager(LeaseLifecycleManager):
    """默认生命周期管理器"""

    @inject
    def __init__(
        self,
        *,
        registry: BallCustodyRegistry,
        store: LeaseStore,
    ) -> None:
        self._registry = registry
        self._store = store
        from core.tracing import get_logger
        self._logger = get_logger("flowforge.lease.lifecycle")

    async def check_ttl_expiry(self) -> list[str]:
        now = datetime.now(timezone.utc)
        expiring = await self._store.list_expiring(before=now, limit=100)
        expired_ids: list[str] = []
        for lease in expiring:
            try:
                if lease.is_expired_at(now) and lease.is_active:
                    # 调用 registry 的释放逻辑（不走 force_revoke）
                    await self._registry.release(lease.lease_id)
                    expired_ids.append(lease.lease_id)
            except Exception as exc:
                self._logger.exception(
                    "check_ttl_expiry failed for %s: %s", lease.lease_id, exc
                )
        return expired_ids

    async def force_revoke(self, lease_id: str, reason: str) -> None:
        await self._registry.force_revoke(lease_id, reason)
```

### 2.6 关键算法伪代码

**算法 1：acquire lease**

```
async function acquire(lease):
    async with lock:
        existing = await store.find_active_by_forgekin(lease.forgekin_id)
        if existing:
            raise LeaseAlreadyHeld
        lease_id = await store.save(lease)
        await scheduler.schedule(lease)
        await teamact_repo.update_owner(team_id, forgekin_id)
        await event_bus.publish("lease.acquired", ...)
        eval_signal_writer.write_trace("lease_acquired", ...)
        return lease_id
```

**算法 2：renew lease（含 max_renewals 检查）**

```
async function renew(lease_id, extension_seconds):
    async with lock:
        lease = await store.load(lease_id)
        if lease is None: raise LeaseNotFound
        if not lease.is_active: raise LeaseAlreadyTerminal
        if lease.renewal_count >= max_renewals:
            await mark_terminal(lease, RELEASED)
            await event_bus.publish("cvo.escalate.max_renewals_exceeded", ...)
            raise MaxRenewalsExceeded
        lease.renewal_count += 1
        lease.status = RENEWED
        lease.expected_wake_at = now + extension_seconds
        await store.save(lease)
        await event_bus.publish("lease.renewed", ...)
        eval_signal_writer.write_trace("lease_renewed", ...)
```

**算法 3：TTL 过期扫描（后台 loop）**

```
async function expiry_scan_loop:
    while True:
        await asyncio.sleep(expiry_scan_interval_seconds)
        now = now_utc
        expiring = await store.list_expiring(before=now, limit=100)
        for lease in expiring:
            async with lock:
                fresh = await store.load(lease.lease_id)
                if fresh is None or not fresh.is_active: continue
                if not fresh.is_expired_at(now): continue
                await mark_terminal(fresh, EXPIRED)
```

**算法 4：force_revoke（Magic Words 触发）**

```
async function force_revoke(lease_id, reason):
    async with lock:
        lease = await store.load(lease_id)
        if lease is None: raise LeaseNotFound
        if not lease.is_active: return  # 幂等
        # 绕过 max_renewals 检查
        await mark_terminal(lease, REVOKED)
        await event_bus.publish("cvo.escalate.lease_revoked", ...)
```

**算法 5：WAL 重放（进程崩溃恢复）**

```
async function replay_from_checkpoint(checkpoint_lsn):
    leases = await store.replay_from(checkpoint_lsn)
    now = now_utc
    for lease in leases:
        if not lease.is_active: continue  # 终态不恢复
        if lease.is_expired_at(now):
            # 进程崩溃期间 TTL 已过期，直接标记 EXPIRED
            await store.mark_status(lease.lease_id, EXPIRED)
            await teamact_repo.update_owner(lease.team_id, new_owner=None)
        else:
            # 重新注册唤醒调度（剩余 TTL）
            await scheduler.schedule(lease)
            # 球恢复给原 owner
            await teamact_repo.update_owner(lease.team_id, lease.forgekin_id)
```

---

## 3. 模块实现

### 3.1 SqliteLeaseStore 实现

```python
# flowforge/infra/repo/sqlite_lease_store.py
from __future__ import annotations

import asyncio
from datetime import datetime
from pathlib import Path
from typing import Optional

import aiosqlite

from core.teamact.lease import (
    BallCustodyLease,
    DecayTag,
    LeaseStatus,
    LeaseStore,
)


_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS ball_custody_lease (
    lease_id           TEXT PRIMARY KEY,
    team_id            TEXT NOT NULL,
    forgekin_id        TEXT NOT NULL,
    reason             TEXT NOT NULL,
    next_step          TEXT NOT NULL,
    expected_wake_at   TEXT NOT NULL,
    acquired_at        TEXT NOT NULL,
    ttl_seconds        INTEGER NOT NULL,
    status             TEXT NOT NULL,
    renewal_count      INTEGER NOT NULL DEFAULT 0,
    max_renewals       INTEGER NOT NULL DEFAULT 3,
    fallback_owner     TEXT,
    schema_version     TEXT NOT NULL DEFAULT '1.0',
    decay_tag          TEXT NOT NULL DEFAULT 'built_to_persist',
    wal_lsn            INTEGER
);
CREATE INDEX IF NOT EXISTS idx_lease_forgekin_active
    ON ball_custody_lease(forgekin_id, status);
CREATE INDEX IF NOT EXISTS idx_lease_team_active
    ON ball_custody_lease(team_id, status);
CREATE INDEX IF NOT EXISTS idx_lease_expiring
    ON ball_custody_lease(expected_wake_at, status);
CREATE INDEX IF NOT EXISTS idx_lease_wal_lsn
    ON ball_custody_lease(wal_lsn);
"""


class SqliteLeaseStore(LeaseStore):
    """lease SQLite WAL 持久化实现"""

    def __init__(self, db_path: Path) -> None:
        self._db_path = db_path
        self._conn: Optional[aiosqlite.Connection] = None
        self._lock = asyncio.Lock

    async def _ensure_conn(self) -> aiosqlite.Connection:
        if self._conn is None:
            self._db_path.parent.mkdir(parents=True, exist_ok=True)
            self._conn = await aiosqlite.connect(str(self._db_path))
            await self._conn.execute("PRAGMA journal_mode=WAL")
            await self._conn.execute("PRAGMA synchronous=NORMAL")
            await self._conn.execute("PRAGMA foreign_keys=ON")
            await self._conn.executescript(_SCHEMA_SQL)
            await self._conn.commit
        return self._conn

    async def save(self, lease: BallCustodyLease) -> str:
        conn = await self._ensure_conn
        async with self._lock:
            await conn.execute(
                """
                INSERT OR REPLACE INTO ball_custody_lease
                    (lease_id, team_id, forgekin_id, reason, next_step,
                     expected_wake_at, acquired_at, ttl_seconds, status,
                     renewal_count, max_renewals, fallback_owner,
                     schema_version, decay_tag, wal_lsn)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    lease.lease_id,
                    lease.team_id,
                    lease.forgekin_id,
                    lease.reason,
                    lease.next_step,
                    lease.expected_wake_at.isoformat,
                    lease.acquired_at.isoformat,
                    lease.ttl_seconds,
                    lease.status.value,
                    lease.renewal_count,
                    lease.max_renewals,
                    lease.fallback_owner,
                    lease.schema_version,
                    lease.decay_tag.value,
                    lease.wal_lsn,
                ),
            )
            await conn.commit
            # 回填 wal_lsn（使用 rowid）
            if lease.wal_lsn is None:
                cursor = await conn.execute(
                    "SELECT rowid FROM ball_custody_lease WHERE lease_id=?",
                    (lease.lease_id,),
                )
                row = await cursor.fetchone
                await cursor.close
                if row:
                    lease.wal_lsn = row[0]
                    await conn.execute(
                        "UPDATE ball_custody_lease SET wal_lsn=? WHERE lease_id=?",
                        (lease.wal_lsn, lease.lease_id),
                    )
                    await conn.commit
            await self._checkpoint_if_needed(conn)
        return lease.lease_id

    async def load(self, lease_id: str) -> Optional[BallCustodyLease]:
        conn = await self._ensure_conn
        cursor = await conn.execute(
            "SELECT * FROM ball_custody_lease WHERE lease_id=?",
            (lease_id,),
        )
        row = await cursor.fetchone
        await cursor.close
        return self._row_to_lease(row) if row else None

    async def find_active_by_forgekin(
        self,
        forgekin_id: str,
    ) -> Optional[BallCustodyLease]:
        conn = await self._ensure_conn
        cursor = await conn.execute(
            """
            SELECT * FROM ball_custody_lease
            WHERE forgekin_id=? AND status IN ('held', 'renewed')
            ORDER BY acquired_at DESC LIMIT 1
            """,
            (forgekin_id,),
        )
        row = await cursor.fetchone
        await cursor.close
        return self._row_to_lease(row) if row else None

    async def list_active_by_team(
        self,
        team_id: str,
    ) -> list[BallCustodyLease]:
        conn = await self._ensure_conn
        cursor = await conn.execute(
            """
            SELECT * FROM ball_custody_lease
            WHERE team_id=? AND status IN ('held', 'renewed')
            ORDER BY acquired_at DESC
            """,
            (team_id,),
        )
        rows = await cursor.fetchall
        await cursor.close
        return [self._row_to_lease(r) for r in rows]

    async def list_expiring(
        self,
        before: datetime,
        limit: int = 100,
    ) -> list[BallCustodyLease]:
        conn = await self._ensure_conn
        cursor = await conn.execute(
            """
            SELECT * FROM ball_custody_lease
            WHERE status IN ('held', 'renewed')
              AND expected_wake_at <= ?
            ORDER BY expected_wake_at ASC LIMIT ?
            """,
            (before.isoformat, limit),
        )
        rows = await cursor.fetchall
        await cursor.close
        return [self._row_to_lease(r) for r in rows]

    async def mark_status(
        self,
        lease_id: str,
        status: LeaseStatus,
    ) -> None:
        conn = await self._ensure_conn
        async with self._lock:
            await conn.execute(
                "UPDATE ball_custody_lease SET status=? WHERE lease_id=?",
                (status.value, lease_id),
            )
            await conn.commit

    async def replay_from(self, checkpoint_lsn: int) -> list[BallCustodyLease]:
        conn = await self._ensure_conn
        cursor = await conn.execute(
            """
            SELECT * FROM ball_custody_lease
            WHERE wal_lsn > ?
            ORDER BY wal_lsn ASC
            """,
            (checkpoint_lsn,),
        )
        rows = await cursor.fetchall
        await cursor.close
        return [self._row_to_lease(r) for r in rows]

    async def _checkpoint_if_needed(self, conn: aiosqlite.Connection) -> None:
        cursor = await conn.execute("SELECT COUNT(*) FROM ball_custody_lease")
        count = (await cursor.fetchone)[0]
        await cursor.close
        if count % 100 == 0:
            await conn.execute("PRAGMA wal_checkpoint(FULL)")

    def _row_to_lease(self, row) -> BallCustodyLease:
        return BallCustodyLease(
            lease_id=row[0],
            team_id=row[1],
            forgekin_id=row[2],
            reason=row[3],
            next_step=row[4],
            expected_wake_at=datetime.fromisoformat(row[5]),
            acquired_at=datetime.fromisoformat(row[6]),
            ttl_seconds=row[7],
            status=LeaseStatus(row[8]),
            renewal_count=row[9],
            max_renewals=row[10],
            fallback_owner=row[11],
            schema_version=row[12],
            decay_tag=DecayTag(row[13]),
            wal_lsn=row[14],
        )

    async def close(self) -> None:
        if self._conn is not None:
            await self._conn.close
            self._conn = None
```

### 3.2 关键流程时序图

**时序图 1：acquire lease（CI 等待场景）**

```
ForgekinA   BallCustodyRegistry   LeaseStore   WakeupScheduler   TeamActRepo   EventBus
  │             │                    │              │                │            │
  │ acquire_for(forgekin=A, team=T, reason="wait_ci", next_step="run_tests")     │
  ├────────────>│                    │              │                │            │
  │             │ find_active_by_forgekin(A)        │                │            │
  │             ├───────────────────>│              │                │            │
  │             │<───────────────────┤ None         │                │            │
  │             │                    │              │                │            │
  │             │ save(lease)        │              │                │            │
  │             ├───────────────────>│              │                │            │
  │             │<───────────────────┤ lease_id     │                │            │
  │             │                    │              │                │            │
  │             │ schedule(lease)                   │                │            │
  │             ├──────────────────────────────────>│                │            │
  │             │<──────────────────────────────────┤ ok             │            │
  │             │                    │              │                │            │
  │             │ update_owner(team=T, new_owner=A) │                │            │
  │             ├───────────────────────────────────────────────────>│            │
  │             │<───────────────────────────────────────────────────┤ ok         │
  │             │                    │              │                │            │
  │             │ publish("lease.acquired", ...)    │                │            │
  │             ├──────────────────────────────────────────────────────────────>│
  │             │                    │              │                │            │
  │ lease_id    │                    │              │                │            │
  │<────────────┤                    │              │                │            │
  │             │                    │              │                │            │
  │ (ForgekinA 退出会话，等待 CI 绿)   │              │                │            │
  │             │                    │              │                │            │
  │             │      (CI 绿后 WakeupScheduler.fire)                │            │
  │             │      publish("lease.wakeup.fired", ...)            │            │
  │             ├──────────────────────────────────────────────────────────────>│
  │             │                    │              │                │            │
  │ (TeamActLoopExecutor 监听 lease.wakeup.fired，唤醒ForgekinA执行 next_step)     │
```

**时序图 2：TTL 过期自动释放**

```
ExpiryScanner   LeaseStore   BallCustodyRegistry   TeamActRepo   EventBus
  │                 │               │                  │            │
  │ sleep(5s)       │               │                  │            │
  │ list_expiring(now)              │                  │            │
  ├────────────────>│               │                  │            │
  │<────────────────┤ [lease1, ...] │                  │            │
  │                 │               │                  │            │
  │ for lease in expiring:          │                  │            │
  │   async with lock:              │                  │            │
  │     load(lease.lease_id)        │                  │            │
  ├────────────────>│               │                  │            │
  │<────────────────┤ fresh lease   │                  │            │
  │     is_expired_at(now)? yes     │                  │            │
  │     mark_terminal(lease, EXPIRED)│                 │            │
  ├────────────────────────────────>│                  │            │
  │                                 │ save(lease, EXPIRED)          │
  │                                 ├────────────────>│            │
  │                                 │ scheduler.cancel(lease_id)    │
  │                                 │ update_owner(team, None)      │
  │                                 ├────────────────>│            │
  │                                 │ publish("lease.released", ... │
  │                                 ├──────────────────────────────>│
  │                                 │                  │            │
  │ 球回 TeamActState，可被其他Forgekin接管                              │
```

### 3.3 错误处理策略

| # | 异常场景 | 触发条件 | 处理策略 | 重试 | 用户感知 |
|---|---------|---------|---------|:----:|---------|
| EH-1 | 一Forgekin已持 lease | `find_active_by_forgekin` 返回非 None | 抛 `LeaseAlreadyHeld`，trace 记录 | 否 | 调用方捕获后决定 release 旧 lease 或拒绝 acquire |
| EH-2 | lease 不存在 | `load(lease_id)` 返回 None | 抛 `LeaseNotFound` | 否 | 调用方感知 |
| EH-3 | lease 已是终态 | `lease.is_active` 返回 False | 幂等 no-op（release/force_revoke）或抛 `LeaseAlreadyTerminal`（renew） | 否 | trace 记录 |
| EH-4 | 续约超限 | `renewal_count >= max_renewals` | 强制释放 + 升级 CVO + 抛 `MaxRenewalsExceeded` | 否 | CVO 收到事件介入仲裁 |
| EH-5 | TTL 过期扫描失败 | `list_expiring` 或 `mark_terminal` 异常 | 单 lease 异常不影响其他 lease；下次扫描重试 | 是（下次扫描） | trace 标记 |
| EH-6 | TeamActState 更新失败 | `update_owner` 异常 | lease 状态已保存为终态，但 owner 未更新；广播 `lease.owner_update_failed` 事件告警 CVO | 否 | CVO 介入手动 sync |
| EH-7 | WakeupScheduler 取消失败 | `scheduler.cancel` 异常 | 仅 log warning，不影响 lease 释放主流程 | 否 | 唤醒事件可能误触发，但 at-most-once 保证只处理一次 |
| EH-8 | EventBus 广播失败 | `event_bus.publish_async` 超时/异常 | 仅 log warning，不影响 lease 状态变更 | 否 | trace 标记 "event_bus_failed" |
| EH-9 | WAL 写入失败 | `store.save` 异常（磁盘满） | 重试 3 次（指数退避 100ms/200ms/400ms）；仍失败则 lease 状态不持久化，下次扫描重新检测 | 是（3次） | 调用方收到异常 |
| EH-10 | Magic Words 撤销但 lease 已释放 | `force_revoke` 时 lease.is_active=False | 幂等 no-op | 否 | trace 记录 "revoke_no_op" |
| EH-11 | 重复唤醒事件 | `WakeupScheduler.fire` 收到已处理 event_id | at-most-once：返回 False，不重复广播 | 否 | trace 记录 "duplicate_wakeup_ignored" |
| EH-12 | 进程崩溃后 TTL 已过期 | WAL 重放发现 `is_expired_at(now)=True` | 直接标记 EXPIRED，不重新 schedule | 否 | 球回 TeamActState |

### 3.4 性能优化

| # | 指标 | 目标 | 优化手段 |
|---|------|------|---------|
| P-1 | `acquire` 端到端延迟 | < 50ms | `find_active_by_forgekin` 走索引；`save` 用 WAL `synchronous=NORMAL` |
| P-2 | `renew` 延迟 | < 30ms | 单条 UPDATE；不重新 schedule（仅更新 expected_wake_at） |
| P-3 | `release` 延迟 | < 50ms | `mark_terminal` 单次 UPDATE + 广播事件异步 |
| P-4 | TTL 过期扫描延迟（100 条 expiring） | < 200ms | `list_expiring` 走 `(expected_wake_at, status)` 复合索引；limit 100 批处理 |
| P-5 | `find_active_by_forgekin` 延迟 | < 5ms | `(forgekin_id, status)` 复合索引 |
| P-6 | `replay_from` 1000 条 lease 吞吐 | < 500ms | 按 `wal_lsn` 索引扫描 |
| P-7 | 并发 acquire 吞吐（10 团队） | > 30 ops/s | `asyncio.Lock` 仅保护单 registry 实例；多 registry 实例可水平扩展 |
| P-8 | 后台扫描 CPU 占用 | < 1% | 5s 间隔 + 100 条批量；空转时仅一次 SELECT |
| P-9 | 内存占用（1 万活跃 lease） | < 20MB | 不在内存缓存 lease；按需查询 DB |

### 3.5 YAML 配置示例

```yaml
# flowforge/config/teamact.yaml
ball_custody_lease:
  # 默认 TTL（秒）：30 分钟
  default_ttl_seconds: 1800
  # 续约时长扩展（秒）
  renewal_extension_seconds: 1800
  # 最大续约次数（超过强制释放 + 升级 CVO）
  max_renewals: 3
  # TTL 过期扫描间隔（秒）
  expiry_scan_interval_seconds: 5
  # 单次扫描批量大小
  expiry_scan_batch_size: 100
  # lease store 配置
  lease_store:
    backend: sqlite
    db_path: data/teamact/lease.db
    checkpoint_every_n_writes: 100
  # 唤醒调度器配置
  wakeup_scheduler:
    type: default
    # CI 状态监听器
    ci_listener:
      type: webhook
      endpoint: http://localhost:8000/api/v1/ci/status
      poll_interval_seconds: 30
    # CVO 确认监听器
    cvo_listener:
      type: event_bus
      topic: cvo.confirm.received
  # Magic Words 强制撤销配置（仅 operator 可触发）
  magic_words_revoke:
    enabled: true  # 不可设为 false（架构不变量）
    word: "星星罐子"
    audit_log: data/audit/magic_words_revoke.log
```

---

## 4. 跨模块协作实现

### 4.1 上游依赖调用

#### 4.1.1 D005 At-Mention Routing 在 take/pass 意图触发 lease

```python
# flowforge/core/teamact/at_mention.py（节选）
from core.teamact.lease import BallCustodyRegistry


class DefaultRoutingDispatcher:
    @inject
    def __init__(
        self,
        *,
        lease_registry: BallCustodyRegistry,
        ...
    ) -> None:
        self._lease_registry = lease_registry

    async def _dispatch_take(self, directive: RoutingDirective) -> DispatchResult:
        # 先释放原 lease（如有）
        current_state = await self._teamact_repo.load(directive.team_id)
        if current_state and current_state.current_owner:
            await self._lease_registry.release_for(
                forgekin_id=current_state.current_owner,
                team_id=directive.team_id,
            )
        # acquire 新 lease
        lease_id = await self._lease_registry.acquire_for(
            forgekin_id=directive.target,
            team_id=directive.team_id,
            reason="at_mention_take",
            next_step="resumed_by_at_mention",
        )
        await self._teamact_repo.update_owner(
            team_id=directive.team_id,
            new_owner=directive.target,
        )
        return DispatchResult(
            success=True,
            directive_id=directive.directive_id,
            new_owner=directive.target,
            lease_id=lease_id,
        )
```

#### 4.1.2 D002 TeamAct Loop 在 Owner 步触发 acquire

```python
# flowforge/loop/executor.py（节选）
from core.teamact.lease import BallCustodyRegistry


class TeamActLoopExecutor:
    async def _execute_owner_step_with_lease(
        self,
        team_id: str,
        forgekin_id: str,
        wait_reason: str,
        next_step: str,
    ) -> str:
        # Forgekin需要退出会话等待外部条件
        lease_id = await self._lease_registry.acquire_for(
            forgekin_id=forgekin_id,
            team_id=team_id,
            reason=wait_reason,
            next_step=next_step,
        )
        return lease_id
```

### 4.2 下游影响实现

#### 4.2.1 D004 PingPong Circuit Breaker 监控 lease held 期间空传

```python
# flowforge/core/teamact/pingpong_breaker.py（节选）
from core.teamact.lease import BallCustodyRegistry, LeaseStatus


class PingPongCircuitBreaker:
    async def evaluate_pass(self, record: PassRecord) -> BreakerVerdict:
        # 检查持球Forgekin是否处于 lease held 状态
        active_lease = await self._lease_registry._store.find_active_by_forgekin(
            record.forgekin_id
        )
        if active_lease and active_lease.is_active:
            # lease held 期间：是否计入空传取决于是否有实质产出
            # 若无工具调用 + 无产出 → 计入空传（防僵尸持球）
            if not record.has_substantive_output:
                state = await self._store.load(record.team_id)
                if state:
                    state.consecutive_empty_passes += 1
                    await self._store.save(state)
        return await self._finalize_verdict(record)
```

#### 4.2.2 D003 Handoff Capsule 同步 next_step

```python
# flowforge/core/teamact/handoff.py（节选）
class HandoffCapsuleStore:
    async def sync_with_lease(self, lease: BallCustodyLease) -> None:
        """lease acquire/renew 时同步 next_step 到胶囊"""
        latest = await self.read_latest(lease.team_id)
        if latest is None:
            return
        latest.next_step = (
            f"[lease:{lease.lease_id}] reason={lease.reason}"
            f" next_step={lease.next_step}"
            f" expected_wake_at={lease.expected_wake_at.isoformat}"
        )
        await self.write(latest)
```

#### 4.2.3 D011 Magic Words 触发 force_revoke

```python
# flowforge/core/harness/magic_words.py（节选）
from core.teamact.lease import BallCustodyRegistry


class MagicWordsExecutor:
    @inject
    def __init__(
        self,
        *,
        lease_registry: BallCustodyRegistry,
        ...
    ) -> None:
        self._lease_registry = lease_registry

    async def execute(
        self,
        word: MagicWord,
        context: dict,
        operator_id: str,
    ) -> ActionResult:
        if word == MagicWord.STAR_JAR:
            # 强制撤销所有活跃 lease
            team_id = context.get("team_id")
            if team_id:
                active_leases = await self._lease_registry.list_active(team_id)
                for lease in active_leases:
                    await self._lease_registry.force_revoke(
                        lease.lease_id,
                        reason=f"magic_words_star_jar by {operator_id}",
                    )
            await self.emergency_stop(reason="star_jar_triggered")
```

#### 4.2.4 D018 Eval Contract 写 lease 信号

```python
# flowforge/core/harness/eval_signal.py（节选）
class EvalSignalWriter:
    def write_lease_signal(
        self,
        signal_type: str,  # lease_acquired / lease_renewed / lease_released / lease_expired / lease_revoked
        lease: BallCustodyLease,
    ) -> None:
        self.write_trace(
            signal_type=signal_type,
            payload={
                "lease_id": lease.lease_id,
                "forgekin_id": lease.forgekin_id,
                "team_id": lease.team_id,
                "renewal_count": lease.renewal_count,
                "ttl_seconds": lease.ttl_seconds,
                "status": lease.status.value,
            },
        )
```

#### 4.2.5 D021 Side Effect WAL 重放 lease 状态

```python
# flowforge/infra/repo/side_effect_wal.py（节选）
class SideEffectWalReplayer:
    async def replay_leases(
        self,
        registry: BallCustodyRegistry,
        store: LeaseStore,
        checkpoint_lsn: int,
    ) -> None:
        from datetime import datetime, timezone
        leases = await store.replay_from(checkpoint_lsn)
        now = datetime.now(timezone.utc)
        for lease in leases:
            if not lease.is_active:
                continue
            if lease.is_expired_at(now):
                # 崩溃期间 TTL 已过期
                await store.mark_status(lease.lease_id, LeaseStatus.EXPIRED)
                await registry._teamact_repo.update_owner(
                    team_id=lease.team_id,
                    new_owner=None,
                )
            else:
                # 重新注册唤醒（剩余 TTL）
                await registry._scheduler.schedule(lease)
                await registry._teamact_repo.update_owner(
                    team_id=lease.team_id,
                    new_owner=lease.forgekin_id,
                )
```

### 4.3 集成测试点

| # | 测试点 | 验证内容 | 铁律关联 |
|---|-------|---------|---------|
| IT-1 | acquire 完整链路 | acquire_for → store.save → scheduler.schedule → teamact_repo.update_owner → event_bus.publish | T4 真实 lease 注册 |
| IT-2 | 一Forgekin一 lease 强制校验 | 同一 forgekin_id 第二次 acquire → 抛 LeaseAlreadyHeld | T3 断言异常类型 |
| IT-3 | TTL 过期自动释放 | acquire ttl=60s → sleep 65s → expiry_scan 检测 → status=EXPIRED → owner=None | T6 MetricsCollector 采集延迟 |
| IT-4 | 续约 max_renewals 检查 | acquire → renew 4 次（max=3）→ 第 4 次抛 MaxRenewalsExceeded + CVO 升级 | T3 断言异常 + 事件 |
| IT-5 | Magic Words force_revoke | operator 触发 "星星罐子" → force_revoke → status=REVOKED → CVO 升级 | T1 真实 operator 输入 |
| IT-6 | WakeupScheduler at-most-once | 同一 event_id fire 两次 → 第二次返回 False，不重复广播 | T3 断言返回值 |
| IT-7 | CI 绿唤醒触发 | acquire reason=wait_ci → CI 状态变绿 → fire(WakeupEvent(trigger=CI_GREEN)) → lease.next_step 被执行 | T4 真实 CI 状态监听 |
| IT-8 | WAL 重放一致性 | 写入 100 条 lease → 进程崩溃 → replay_from(0) → 活跃 lease 状态恢复，过期 lease 标记 EXPIRED | T6 采集重放延迟 |
| IT-9 | lease release 后 TeamActState 可被接管 | release → current_owner=None → 其他Forgekin可通过 take 接管 | T3 断言 owner 切换 |
| IT-10 | lease held 期间空传计入 F004 | acquire → 无工具调用 + 无产出的 PassRecord → F004 consecutive_empty_passes +1 | T3 断言空传计数 |
| IT-11 | fallback_owner 生效 | lease 配置 fallback_owner="cvo" → 过期后 current_owner=cvo 而非 None | T3 断言 owner 值 |
| IT-12 | 续约后 expected_wake_at 更新 | renew(extension=3600) → expected_wake_at = now + 3600s | T3 断言时间 |
| IT-13 | 多源唤醒去重 | CI_GREEN + TIMER + EXTERNAL 同时触发同一 lease → 仅首次 fire 返回 True | T3 断言 at-most-once |

---

## 5. 详细设计验收

### 5.1 功能验收（AC）

| AC # | 验收点 | 验证方法 |
|------|-------|---------|
| AC-F-1 | `flowforge/core/teamact/lease.py` 不 import forgemind 或 *Forge 模块 | 静态扫描 import 语句 |
| AC-F-2 | `BallCustodyRegistry` 通过 DI 容器 `inject` 注入，无直接实例化 | 代码审查 + DI 容器单测 |
| AC-F-3 | lease 状态通过 `LeaseStore (ABC)` 持久化，无 `cursor.execute` | grep `cursor.execute` 在 lease 模块返回空 |
| AC-F-4 | `default_ttl_seconds` / `max_renewals` / `renewal_extension_seconds` / `expiry_scan_interval_seconds` 外置到 `flowforge/config/teamact.yaml` | YAML 加载测试 |
| AC-F-5 | lease 状态走 WAL（`PRAGMA journal_mode=WAL`） | DB pragma 查询 |
| AC-F-6 | 持球Forgekin可注册 lease 并声明等待原因与唤醒时间 | 集成测试 IT-1 |
| AC-F-7 | TTL 到期未续约自动释放，球回 TeamActState（current_owner=None 或 fallback_owner） | 集成测试 IT-3 |
| AC-F-8 | 续约次数超 `max_renewals` 强制释放并升级 CVO | 集成测试 IT-4 |
| AC-F-9 | `WakeupEvent` 触发时正确唤醒持球Forgekin执行 next_step | 集成测试 IT-7 |
| AC-F-10 | lease held 期间空传计入 F004 PingPongCircuitBreaker | 集成测试 IT-10 |
| AC-F-11 | Magic Words "星星罐子"可强制撤销 lease（绕过 max_renewals） | 集成测试 IT-5 |
| AC-F-12 | 一Forgekin同时只能持有一个 lease | 集成测试 IT-2 |
| AC-F-13 | WakeupScheduler at-most-once 保证（重复事件不重复处理） | 集成测试 IT-6 |
| AC-F-14 | lease 释放后广播 `lease.released` 事件，TeamActState 可感知接管 | 集成测试 IT-9 |
| AC-F-15 | lease 状态可回放（`replay_from`）恢复 TeamActState.current_owner | 集成测试 IT-8 |
| AC-F-16 | fallback_owner 生效（lease 过期后 owner 切换到 fallback） | 集成测试 IT-11 |
| AC-F-17 | 续约后 expected_wake_at 更新 | 集成测试 IT-12 |
| AC-F-18 | 多源唤醒去重（CI/TIMER/EXTERNAL 同时触发只处理一次） | 集成测试 IT-13 |

### 5.2 性能验收

| AC # | 验收点 | 指标 |
|------|-------|------|
| AC-P-1 | `acquire` 端到端延迟 | < 50ms（P99） |
| AC-P-2 | `renew` 延迟 | < 30ms（P99） |
| AC-P-3 | `release` 延迟 | < 50ms（P99） |
| AC-P-4 | TTL 过期扫描延迟（100 条） | < 200ms |
| AC-P-5 | `find_active_by_forgekin` 延迟 | < 5ms（P99） |
| AC-P-6 | `replay_from` 1000 条 lease 吞吐 | < 500ms |
| AC-P-7 | 10 团队并发 acquire 吞吐 | > 30 ops/s |
| AC-P-8 | 后台扫描 CPU 占用 | < 1% |

### 5.3 安全验收

| AC # | 验收点 |
|------|-------|
| AC-S-1 | lease 状态通过 Repository 抽象，无 `cursor.execute` / `sqlite3.connect` 直连 |
| AC-S-2 | 一Forgekin一 lease 强制校验（禁多球） |
| AC-S-3 | `force_revoke` 仅 Magic Words 触发，Forgekin不可直接调用 |
| AC-S-4 | lease 释放后 TeamActState.current_owner 同步置空（或 fallback_owner） |
| AC-S-5 | WAL 文件权限 0600 |
| AC-S-6 | 所有 lease 操作写 audit + Eval trace，禁删除 |

### 5.4 Eval 验收

| AC # | 验收点 |
|------|-------|
| AC-E-1 | lease acquire/renew/release/expire/revoke 全部写 Eval trace |
| AC-E-2 | TTL 过期频次作为 Eval 信号（高频说明任务规模超预期） |
| AC-E-3 | 续约次数分布作为 Eval 信号（持续续约说明任务规划不合理） |
| AC-E-4 | Magic Words force_revoke 频次作为 Eval 信号（高频说明 operator 介入过多） |
| AC-E-5 | lease 持有时长分布作为 Eval 信号（用于任务规模评估） |

---

## 6. 引用

- [doc:../spec.md#§3.2]（FR-CORE-002，FR-CORE-016 交接胶囊 + 持球注册 lease）
- [doc:../arch.md#§3.2]（TeamAct 六步循环，持球注册 lease）
- [doc:../architecture/A006-ball-custody-lease.md]（同号架构设计，权威源）
- [doc:../features/F006-ball-custody-lease.md]（同号 Feature 级 SRS）
- [doc:D002-teamact-loop.md]（TeamAct Owner 步触发 lease 注册）
- [doc:D003-handoff-capsule.md]（lease next_step 同步到胶囊）
- [doc:D004-pingpong-circuit-breaker.md]（lease held 期间空传联动）
- [doc:D005-at-mention-routing.md]（take/pass 意图触发 lease 操作）
- [doc:D011-magic-words.md]（星星罐子强制撤销 lease）
- [doc:D018-eval-contract.md]（lease 信号源）
- [doc:D021-side-effect-wal.md]（WAL 重放契约）
- [doc:D022-tier-1-4-recovery.md]（Tier 2 恢复分级）
- [doc:../decisions/002-collaboration-protocol.md]（TeamAct 协作协议 ADR）
- [doc:../../CONTRIBUTING.md]（文档分层规范）
- [doc:../../CONTRIBUTING.md#31-15-条编程红线违反即拒绝合入]（禁止硬编码提示词）
- [doc:../../../CONTRIBUTING.md#红线12]（禁止绕过 DI 容器）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（详细设计骨架，对应 A006 架构与 F006 Feature SRS） | 开发者 Forgekin（猎犬·夏洛克） |
