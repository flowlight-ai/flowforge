# D023: liveness 规范读模型详细设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 开发者 Forgekin（猎犬·夏洛克）
> **对应 spec.md**: [doc:../spec.md#§3.6]（FR-CORE-006）
> **对应 arch.md**: [doc:../arch.md#§3.6]
> **对应 design.md**: [doc:../design.md#§3.6]
> **对应 Feature**: [doc:../features/F023-liveness-canonical-read.md]（同号 Feature 级 SRS）
> **对应 Architecture**: [doc:../architecture/A023-liveness-canonical-read.md]（同号 Feature 级 SAD）
> **依赖 ADR**: [doc:../decisions/010-distributed-reliability.md]

---

## 1. 详细设计上下文

### 1.1 设计问题

分布式可靠性（§3.6）的 liveness 子系统需要建立"单一真相源 + 四态 liveness + 宽限期"的规范读模型，A023 架构设计已确认核心机制：
1. **四态 liveness**：alive（健康） / degraded（降级） / zombie（僵尸） / grace_waiting（宽限等待）
2. **三类 CanonicalSource**：durable_record（持久化记录） / memory_cache（内存缓存） / external_probe（外部探测）
3. **durable_record 单一真相源**：所有 liveness 判定必须以 durable_record 为最终真相，缓存与探测仅作辅助
4. **宽限期机制**：探测失败后进入 grace_waiting 状态，宽限期内不立即标记 zombie，给系统恢复时间
5. **脑裂检测**：多源信号不一致时触发 SplitBrainAlert

本详细设计进一步下沉到代码层，需要解决以下子问题：

1. **durable_record 的物理承载**：durable_record 存储于 F008 Durable State Surfaces 还是独立表，如何保证单一真相。
2. **四态 liveness 的状态机**：alive ↔ degraded ↔ grace_waiting → zombie 的合法转换矩阵。
3. **宽限期的计算**：宽限期时长从配置加载，宽限期内如何容忍探测失败。
4. **三类 CanonicalSource 的优先级**：durable_record > external_probe > memory_cache，冲突时以 durable_record 为准。
5. **脑裂检测的触发条件**：多源信号在 state 或 last_heartbeat_at 维度不一致超过阈值。
6. **liveness 探测的并发安全**：多 worker 并发探测同一 forgekin 时如何加锁。
7. **canonical_read 性能**：高频读如何保持 < 10ms 响应。
8. **跨进程 liveness 共享**：F022/F024/F025 都需读 liveness，跨进程读一致性如何保证。

### 1.2 设计约束

- **单向依赖约束**：`flowforge/core/reliability/liveness/` 是 §3.6 的底座，禁止 import F022/F024/F025 任何模块（编程红线第 10 条延伸）。
- **DI 容器约束**：`CanonicalReadModel` 通过 DI 容器注入，绑定生命周期为 `singleton`，禁止直接实例化（编程红线第 12 条）。
- **Repository 层约束**：LivenessRecord 持久化必须经 `LivenessRepository` 抽象，禁止直操作数据库（编程红线第 13 条）。
- **配置驱动约束**：宽限期时长 / 探测间隔 / 脑裂阈值 / 四态转换矩阵外置 YAML（编程红线第 11 条）。
- **durable_record 单一真相源约束**：所有 liveness 判定最终以 durable_record 为准，禁止绕过。
- **canonical_read 强一致性约束**：canonical_read 必须返回最新 durable_record，禁止返回过期缓存。
- **宽限期硬约束**：宽限期内不立即标记 zombie，必须等待宽限期结束。
- **异步约束**：所有 I/O 操作使用 `async/await`，canonical_read 同步阻塞直到 durable_record 读取完成。
- **类型注解约束**：Python 3.11+，所有公共方法强制类型注解。
- **提示词外置约束**：本模块不涉及提示词，但错误信息模板外置到 `config/error_messages.yaml`。

### 1.3 设计影响

- **对 F022 Tier 1-4 恢复**：Tier 2 探测阶段调用 `CanonicalReadModel.canonical_read` 获取 liveness。本设计需暴露 `canonical_read` 接口。
- **对 F024 强 workflow**：强 workflow 每步前检查 liveness，zombie 状态拒绝执行。本设计需暴露 `check_liveness` 接口。
- **对 F025 跨 provider 宿主抽象**：provider liveness 是Forgekin liveness 的输入维度之一。本设计需暴露 `update_provider_liveness` 接口。
- **对 F020 七类归因**：environment_drift 归因使用 liveness 历史作为证据。本设计需派发 `liveness.changed` 事件。
- **对 F021 副作用 WAL**：WAL 状态变更时更新 liveness。本设计订阅 `wal.entry.*` 事件。
- **对 F040 控制面**：所有 liveness 变更写入 F040 Eval Hub。本设计派发 liveness 事件。
- **对 Forgekin.act**：Forgekin 执行前必须 `check_liveness`，zombie 状态拒绝执行。
- **对 DI 容器**：需新增 `canonical_read_model` / `liveness_probe` / `split_brain_detector` / `liveness_repository` 四个绑定。

---

## 2. 详细设计

### 2.1 类图 ASCII

```
┌──────────────────────────────────────────────────────────────────────────┐
│                     <<module>> reliability.liveness                         │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  <<enum>> LivenessState (四态)                                              │
│  + ALIVE                  健康                                              │
│  + DEGRADED               降级                                              │
│  + ZOMBIE                 僵尸（不可恢复）                                  │
│  + GRACE_WAITING          宽限等待                                          │
│                                                                            │
│  <<enum>> CanonicalSource (三类，按优先级)                                   │
│  + DURABLE_RECORD         持久化记录（最高优先级）                          │
│  + EXTERNAL_PROBE         外部探测                                          │
│  + MEMORY_CACHE           内存缓存（最低优先级）                            │
│                                                                            │
│  <<model>> LivenessRecord                                                  │
│  + record_id: str (UUID v7)                                               │
│  + forgekin_id: str                                                        │
│  + state: LivenessState                                                   │
│  + last_heartbeat_at: datetime                                            │
│  + last_probe_at: Optional[datetime]                                      │
│  + grace_until: Optional[datetime]                                       │
│  + source: CanonicalSource                                                │
│  + degraded_reason: Optional[str]                                         │
│  + zombie_reason: Optional[str]                                           │
│  + recorded_at: datetime                                                  │
│                                                                            │
│  <<model>> SplitBrainAlert                                                 │
│  + alert_id: str                                                           │
│  + forgekin_id: str                                                       │
│  + sources_disagree: list[CanonicalSource]                                │
│  + states: dict[CanonicalSource, LivenessState]                          │
│  + delta_seconds: float  # last_heartbeat_at 差异                          │
│  + detected_at: datetime                                                  │
│                                                                            │
│  <<interface>> CanonicalReadModel (ABC)                                    │
│  + canonical_read(forgekin_id) -> LivenessRecord                          │
│  + check_liveness(forgekin_id, required_state) -> bool                    │
│                                                                            │
│  <<interface>> LivenessProbe (ABC)                                         │
│  + probe(forgekin_id) -> LivenessRecord                                   │
│  + update_heartbeat(forgekin_id) -> None                                  │
│  + mark_degraded(forgekin_id, reason) -> None                             │
│  + mark_zombie(forgekin_id, reason) -> None                                │
│  + enter_grace(forgekin_id, duration) -> None                             │
│                                                                            │
│  <<interface>> SplitBrainDetector (ABC)                                    │
│  + detect(records) -> Optional[SplitBrainAlert]                           │
│  + alert(alert) -> None                                                    │
│                                                                            │
│  <<interface>> LivenessRepository (ABC)                                    │
│  + upsert(record) -> str                                                   │
│  + get_latest(forgekin_id) -> Optional[LivenessRecord]                    │
│  + query_history(forgekin_id, since_ts) -> list[LivenessRecord]           │
│  + query_by_state(state) -> list[LivenessRecord]                          │
│                                                                            │
└──────────────────────────────────────────────────────────────────────────┘
```

### 2.2 接口实现 Python 代码

```python
# flowforge/core/reliability/liveness/models.py
from __future__ import annotations
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict, model_validator
from enum import Enum


class LivenessState(str, Enum):
    ALIVE = "alive"
    DEGRADED = "degraded"
    ZOMBIE = "zombie"
    GRACE_WAITING = "grace_waiting"


class CanonicalSource(str, Enum):
    DURABLE_RECORD = "durable_record"  # 最高优先级
    EXTERNAL_PROBE = "external_probe"
    MEMORY_CACHE = "memory_cache"  # 最低优先级


# 优先级排序（数字小优先级高）
SOURCE_PRIORITY = {
    CanonicalSource.DURABLE_RECORD: 1,
    CanonicalSource.EXTERNAL_PROBE: 2,
    CanonicalSource.MEMORY_CACHE: 3,
}


# 合法的状态转换矩阵
ALLOWED_TRANSITIONS = {
    LivenessState.ALIVE: {LivenessState.DEGRADED, LivenessState.GRACE_WAITING, LivenessState.ZOMBIE},
    LivenessState.DEGRADED: {LivenessState.ALIVE, LivenessState.GRACE_WAITING, LivenessState.ZOMBIE},
    LivenessState.GRACE_WAITING: {LivenessState.ALIVE, LivenessState.DEGRADED, LivenessState.ZOMBIE},
    LivenessState.ZOMBIE: set,  # 终态，不可恢复
}


class LivenessRecord(BaseModel):
    """liveness 记录"""
    model_config = ConfigDict(frozen=True)  # 不可变

    record_id: str = Field(min_length=1)  # UUID v7
    forgekin_id: str = Field(min_length=1)
    state: LivenessState
    last_heartbeat_at: datetime
    last_probe_at: Optional[datetime] = None
    grace_until: Optional[datetime] = None  # 仅 GRACE_WAITING 时非空
    source: CanonicalSource
    degraded_reason: Optional[str] = None
    zombie_reason: Optional[str] = None
    recorded_at: datetime

    @model_validator(mode="after")
    def _validate_grace_consistency(self) -> "LivenessRecord":
        if self.state == LivenessState.GRACE_WAITING and self.grace_until is None:
            raise ValueError(
                "grace_until must be set when state=GRACE_WAITING"
            )
        if self.state != LivenessState.GRACE_WAITING and self.grace_until is not None:
            raise ValueError(
                f"grace_until must be None when state={self.state.value}"
            )
        if self.state == LivenessState.ZOMBIE and not self.zombie_reason:
            raise ValueError("zombie_reason must be set when state=ZOMBIE")
        if self.state == LivenessState.DEGRADED and not self.degraded_reason:
            raise ValueError("degraded_reason must be set when state=DEGRADED")
        return self


class SplitBrainAlert(BaseModel):
    """脑裂告警"""
    model_config = ConfigDict(frozen=True)

    alert_id: str = Field(min_length=1)
    forgekin_id: str = Field(min_length=1)
    sources_disagree: list[CanonicalSource] = Field(min_length=2)
    states: dict[str, str]  # source value → state value
    delta_seconds: float = Field(ge=0.0)  # last_heartbeat_at 差异
    detected_at: datetime


# flowforge/core/reliability/liveness/interfaces.py
from abc import ABC, abstractmethod
from typing import Optional
from datetime import datetime, timedelta


class CanonicalReadModel(ABC):
    """规范读模型（单一真相源）"""

    @abstractmethod
    async def canonical_read(self, forgekin_id: str) -> LivenessRecord:
        """
        规范读：
        1. 优先读 durable_record（最高优先级，单一真相源）
        2. 若 durable_record 不可用，回落 external_probe
        3. 若 external_probe 不可用，回落 memory_cache
        4. 多源不一致时触发 SplitBrainDetector
        5. 宽限期检查：GRACE_WAITING 且 grace_until < now → 转 ZOMBIE
        """

    @abstractmethod
    async def check_liveness(
        self, forgekin_id: str, required_state: LivenessState
    ) -> bool:
        """
        检查 liveness 是否满足 required_state：
        - required_state=ALIVE：当前必须 ALIVE
        - required_state=DEGRADED：当前必须 ALIVE 或 DEGRADED
        - required_state=GRACE_WAITING：当前必须 ALIVE 或 DEGRADED 或 GRACE_WAITING
        - required_state=ZOMBIE：拒绝执行（zombie 不可恢复）
        """


class LivenessProbe(ABC):
    """liveness 探测器"""

    @abstractmethod
    async def probe(self, forgekin_id: str) -> LivenessRecord:
        """执行一次探测；返回最新 LivenessRecord"""

    @abstractmethod
    async def update_heartbeat(self, forgekin_id: str) -> None:
        """更新心跳；将状态恢复为 ALIVE（如果之前是 GRACE_WAITING/DEGRADED）"""

    @abstractmethod
    async def mark_degraded(self, forgekin_id: str, reason: str) -> None:
        """标记为 DEGRADED；记录 degraded_reason"""

    @abstractmethod
    async def mark_zombie(self, forgekin_id: str, reason: str) -> None:
        """标记为 ZOMBIE；记录 zombie_reason；不可恢复"""

    @abstractmethod
    async def enter_grace(
        self, forgekin_id: str, duration: timedelta
    ) -> None:
        """进入宽限期；状态转为 GRACE_WAITING；记录 grace_until"""


class SplitBrainDetector(ABC):
    """脑裂检测器"""

    @abstractmethod
    async def detect(
        self, records: list[LivenessRecord]
    ) -> Optional[SplitBrainAlert]:
        """
        检测多源信号是否脑裂：
        1. 多个 source 的 state 不一致
        2. 多个 source 的 last_heartbeat_at 差异 > 阈值
        """

    @abstractmethod
    async def alert(self, alert: SplitBrainAlert) -> None:
        """派发脑裂告警到 F040"""


class LivenessRepository(ABC):
    """liveness 持久化 Repository"""

    @abstractmethod
    async def upsert(self, record: LivenessRecord) -> str: ...

    @abstractmethod
    async def get_latest(self, forgekin_id: str) -> Optional[LivenessRecord]: ...

    @abstractmethod
    async def query_history(
        self, forgekin_id: str, since_ts: datetime
    ) -> list[LivenessRecord]: ...

    @abstractmethod
    async def query_by_state(
        self, state: LivenessState
    ) -> list[LivenessRecord]: ...
```

### 2.3 数据结构 Pydantic Models（配置）

```python
# flowforge/core/reliability/liveness/config.py
from __future__ import annotations
from typing import Optional
from datetime import timedelta
from pydantic import BaseModel, Field, model_validator


class GracePeriodConfig(BaseModel):
    """宽限期配置"""
    default_duration_seconds: int = Field(default=60, ge=10, le=600)
    max_extension_count: int = Field(default=3, ge=1, le=10)
    extension_factor: float = Field(default=2.0, ge=1.5, le=3.0)


class ProbeConfig(BaseModel):
    """探测配置"""
    interval_seconds: int = Field(default=10, ge=5, le=60)
    timeout_seconds: int = Field(default=5, ge=1, le=30)
    retry_count: int = Field(default=3, ge=1, le=5)
    retry_backoff_seconds: int = Field(default=2, ge=1, le=10)


class SplitBrainConfig(BaseModel):
    """脑裂检测配置"""
    enabled: bool = True
    heartbeat_delta_threshold_seconds: int = Field(default=30, ge=5, le=300)
    state_disagreement_enabled: bool = True


class LivenessConfig(BaseModel):
    """YAML 配置加载结果"""
    grace_period: GracePeriodConfig
    probe: ProbeConfig
    split_brain: SplitBrainConfig
    cache_ttl_seconds: int = Field(default=5, ge=1, le=60)
    zombie_after_grace: bool = True  # 宽限期结束后转 ZOMBIE
    heartbeat_stale_seconds: int = Field(default=30, ge=10, le=300)

    @model_validator(mode="after")
    def _validate_consistency(self) -> "LivenessConfig":
        if self.zombie_after_grace is not True:
            raise ValueError(
                "zombie_after_grace must be True (hard constraint)"
            )
        if self.probe.timeout_seconds >= self.probe.interval_seconds:
            raise ValueError(
                f"probe.timeout_seconds ({self.probe.timeout_seconds}) "
                f"must be < probe.interval_seconds ({self.probe.interval_seconds})"
            )
        return self


class CanonicalReadResult(BaseModel):
    """规范读结果（含元数据）"""
    record: LivenessRecord
    sources_consulted: list[str]  # source values
    split_brain_detected: bool = False
    read_at: str  # ISO datetime
```

### 2.4 关键算法伪代码

#### 2.4.1 canonical_read 规范读算法

```
function canonical_read(forgekin_id: str) -> LivenessRecord:

    # 1. 优先读 durable_record（单一真相源）
    durable = await liveness_repository.get_latest(forgekin_id)
    if durable is None:
        # durable_record 不存在，尝试 external_probe
        probed = await liveness_probe.probe(forgekin_id)
        await liveness_repository.upsert(probed)
        return probed

    # 2. 检查宽限期是否过期
    if durable.state == GRACE_WAITING:
        if durable.grace_until is not None and now > durable.grace_until:
            # 宽限期结束，转 ZOMBIE
            new_record = LivenessRecord(
                record_id=uuid_v7,
                forgekin_id=forgekin_id,
                state=LivenessState.ZOMBIE,
                last_heartbeat_at=durable.last_heartbeat_at,
                last_probe_at=now,
                grace_until=None,
                source=CanonicalSource.DURABLE_RECORD,
                zombie_reason=f"grace period expired at {durable.grace_until}",
                recorded_at=now,
            )
            await liveness_repository.upsert(new_record)
            return new_record

    # 3. 检查心跳是否过期（heartbeat_stale_seconds）
    if now - durable.last_heartbeat_at > config.heartbeat_stale_seconds:
        # 心跳过期，进入宽限期
        await liveness_probe.enter_grace(
            forgekin_id, timedelta(seconds=config.grace_period.default_duration_seconds)
        )
        return await liveness_repository.get_latest(forgekin_id)

    # 4. 多源校验（可选，性能开销大时跳过）
    if config.split_brain.enabled:
        records = [durable]
        try:
            probed = await liveness_probe.probe(forgekin_id)
            records.append(probed)
        except Exception:
            pass  # 探测失败不阻塞 canonical_read

        alert = await split_brain_detector.detect(records)
        if alert is not None:
            await split_brain_detector.alert(alert)
            # 脑裂时仍以 durable_record 为准（单一真相源）

    return durable
```

#### 2.4.2 状态转换算法

```
function transition_state(
    current: LivenessState, target: LivenessState
) -> LivenessState:

    if target not in ALLOWED_TRANSITIONS.get(current, set):
        raise IllegalLivenessTransitionError(
            f"liveness state transition {current.value} -> {target.value} "
            f"not allowed"
        )
    return target


function update_heartbeat(forgekin_id: str) -> None:

    current = await liveness_repository.get_latest(forgekin_id)
    if current is None:
        # 不存在记录，创建 ALIVE 记录
        new_record = LivenessRecord(
            record_id=uuid_v7,
            forgekin_id=forgekin_id,
            state=LivenessState.ALIVE,
            last_heartbeat_at=now,
            source=CanonicalSource.DURABLE_RECORD,
            recorded_at=now,
        )
        await liveness_repository.upsert(new_record)
        return

    # 心跳更新：若状态非 ALIVE，则恢复 ALIVE
    if current.state == LivenessState.ZOMBIE:
        # ZOMBIE 不可恢复，告警
        logger.warning(
            f"forgekin {forgekin_id} is ZOMBIE, heartbeat rejected"
        )
        return

    new_state = LivenessState.ALIVE
    if current.state != LivenessState.ALIVE:
        transition_state(current.state, new_state)  # 校验合法性

    new_record = LivenessRecord(
        record_id=uuid_v7,
        forgekin_id=forgekin_id,
        state=new_state,
        last_heartbeat_at=now,
        last_probe_at=current.last_probe_at,
        grace_until=None,  # 心跳恢复时清除宽限期
        source=CanonicalSource.DURABLE_RECORD,
        recorded_at=now,
    )
    await liveness_repository.upsert(new_record)


function enter_grace(forgekin_id: str, duration: timedelta) -> None:

    current = await liveness_repository.get_latest(forgekin_id)
    if current is None:
        # 不存在记录，创建 GRACE_WAITING
        grace_until = now + duration
        new_record = LivenessRecord(
            record_id=uuid_v7,
            forgekin_id=forgekin_id,
            state=LivenessState.GRACE_WAITING,
            last_heartbeat_at=now,
            grace_until=grace_until,
            source=CanonicalSource.DURABLE_RECORD,
            recorded_at=now,
        )
        await liveness_repository.upsert(new_record)
        return

    # 状态转换校验
    transition_state(current.state, LivenessState.GRACE_WAITING)

    grace_until = now + duration
    new_record = LivenessRecord(
        record_id=uuid_v7,
        forgekin_id=forgekin_id,
        state=LivenessState.GRACE_WAITING,
        last_heartbeat_at=current.last_heartbeat_at,
        grace_until=grace_until,
        source=CanonicalSource.DURABLE_RECORD,
        recorded_at=now,
    )
    await liveness_repository.upsert(new_record)
```

#### 2.4.3 脑裂检测算法

```
function detect(records: list[LivenessRecord]) -> Optional[SplitBrainAlert]:

    if len(records) < 2:
        return None  # 至少 2 个源才能脑裂

    # 1. 检查 state 不一致
    states = set(r.state for r in records)
    if config.split_brain.state_disagreement_enabled and len(states) > 1:
        return SplitBrainAlert(
            alert_id=uuid_v7,
            forgekin_id=records[0].forgekin_id,
            sources_disagree=[r.source for r in records],
            states={r.source.value: r.state.value for r in records},
            delta_seconds=0.0,
            detected_at=now,
        )

    # 2. 检查 last_heartbeat_at 差异
    heartbeats = [r.last_heartbeat_at for r in records]
    delta = (max(heartbeats) - min(heartbeats)).total_seconds
    if delta > config.split_brain.heartbeat_delta_threshold_seconds:
        return SplitBrainAlert(
            alert_id=uuid_v7,
            forgekin_id=records[0].forgekin_id,
            sources_disagree=[r.source for r in records],
            states={r.source.value: r.state.value for r in records},
            delta_seconds=delta,
            detected_at=now,
        )

    return None
```

#### 2.4.4 liveness 探测算法

```
function probe(forgekin_id: str) -> LivenessRecord:

    # 1. 调用具体的探测 handler（如 ping / health check）
    try:
        is_alive = await asyncio.wait_for(
            probe_handler.ping(forgekin_id),
            timeout=config.probe.timeout_seconds,
        )
    except asyncio.TimeoutError:
        # 探测超时，进入宽限期
        await enter_grace(forgekin_id, timedelta(seconds=config.grace_period.default_duration_seconds))
        return await liveness_repository.get_latest(forgekin_id)

    # 2. 根据 handler 结果更新 liveness
    if is_alive:
        await update_heartbeat(forgekin_id)
    else:
        # 探测失败，进入宽限期
        await enter_grace(forgekin_id, timedelta(seconds=config.grace_period.default_duration_seconds))

    return await liveness_repository.get_latest(forgekin_id)
```

---

## 3. 模块实现

### 3.1 关键代码片段

```python
# flowforge/core/reliability/liveness/canonical_read.py
from __future__ import annotations
import logging
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

from .models import (
    LivenessState, CanonicalSource, LivenessRecord, SplitBrainAlert,
    SOURCE_PRIORITY, ALLOWED_TRANSITIONS,
)
from .interfaces import (
    CanonicalReadModel, LivenessProbe, SplitBrainDetector, LivenessRepository,
)
from .config import LivenessConfig
from ...core.events.event_bus import EventBus

logger = logging.getLogger(__name__)


class IllegalLivenessTransitionError(Exception):
    """liveness 状态非法转换"""
    pass


class DefaultCanonicalReadModel(CanonicalReadModel):
    """规范读模型默认实现"""

    def __init__(
        self,
        probe: LivenessProbe,
        repository: LivenessRepository,
        split_brain_detector: SplitBrainDetector,
        event_bus: EventBus,
        config: LivenessConfig,
    ):
        self._probe = probe
        self._repo = repository
        self._detector = split_brain_detector
        self._bus = event_bus
        self._cfg = config

    async def canonical_read(self, forgekin_id: str) -> LivenessRecord:
        # 1. 优先读 durable_record
        durable = await self._repo.get_latest(forgekin_id)
        if durable is None:
            # 不存在，触发探测
            try:
                probed = await self._probe.probe(forgekin_id)
                await self._repo.upsert(probed)
                return probed
            except Exception as e:
                logger.warning(
                    f"canonical_read: probe failed for {forgekin_id}: {e}"
                )
                # 探测失败，创建临时 ZOMBIE 记录
                now = datetime.now(timezone.utc)
                fallback = LivenessRecord(
                    record_id=str(uuid.uuid1),
                    forgekin_id=forgekin_id,
                    state=LivenessState.ZOMBIE,
                    last_heartbeat_at=now,
                    last_probe_at=now,
                    source=CanonicalSource.DURABLE_RECORD,
                    zombie_reason=f"probe failed: {e}",
                    recorded_at=now,
                )
                await self._repo.upsert(fallback)
                return fallback

        # 2. 检查宽限期是否过期
        if durable.state == LivenessState.GRACE_WAITING:
            if durable.grace_until is not None and datetime.now(timezone.utc) > durable.grace_until:
                # 宽限期结束，转 ZOMBIE
                now = datetime.now(timezone.utc)
                new_record = LivenessRecord(
                    record_id=str(uuid.uuid1),
                    forgekin_id=forgekin_id,
                    state=LivenessState.ZOMBIE,
                    last_heartbeat_at=durable.last_heartbeat_at,
                    last_probe_at=now,
                    grace_until=None,
                    source=CanonicalSource.DURABLE_RECORD,
                    zombie_reason=f"grace period expired at {durable.grace_until}",
                    recorded_at=now,
                )
                await self._repo.upsert(new_record)
                await self._bus.publish(
                    topic="liveness.changed",
                    payload=new_record.model_dump,
                )
                return new_record

        # 3. 检查心跳是否过期
        now = datetime.now(timezone.utc)
        if (now - durable.last_heartbeat_at).total_seconds > self._cfg.heartbeat_stale_seconds:
            # 心跳过期，进入宽限期
            try:
                await self._probe.enter_grace(
                    forgekin_id,
                    timedelta(seconds=self._cfg.grace_period.default_duration_seconds),
                )
                return await self._repo.get_latest(forgekin_id) or durable
            except Exception as e:
                logger.warning(f"enter_grace failed: {e}")
                return durable

        # 4. 多源校验（可选）
        if self._cfg.split_brain.enabled:
            records = [durable]
            try:
                probed = await self._probe.probe(forgekin_id)
                records.append(probed)
            except Exception as e:
                logger.debug(f"split_brain probe skipped: {e}")

            if len(records) >= 2:
                alert = await self._detector.detect(records)
                if alert is not None:
                    await self._detector.alert(alert)
                    # 脑裂时仍以 durable_record 为准

        return durable

    async def check_liveness(
        self, forgekin_id: str, required_state: LivenessState
    ) -> bool:
        record = await self.canonical_read(forgekin_id)

        # ZOMBIE 永远拒绝
        if record.state == LivenessState.ZOMBIE:
            return False

        # 按 required_state 分级检查
        if required_state == LivenessState.ALIVE:
            return record.state == LivenessState.ALIVE
        elif required_state == LivenessState.DEGRADED:
            return record.state in (LivenessState.ALIVE, LivenessState.DEGRADED)
        elif required_state == LivenessState.GRACE_WAITING:
            return record.state in (
                LivenessState.ALIVE, LivenessState.DEGRADED,
                LivenessState.GRACE_WAITING,
            )
        elif required_state == LivenessState.ZOMBIE:
            return False  # ZOMBIE 拒绝执行
        return False


class DefaultLivenessProbe(LivenessProbe):
    """liveness 探测器默认实现"""

    def __init__(
        self,
        repository: LivenessRepository,
        event_bus: EventBus,
        config: LivenessConfig,
        probe_handler: "ProbeHandler",
    ):
        self._repo = repository
        self._bus = event_bus
        self._cfg = config
        self._handler = probe_handler

    async def probe(self, forgekin_id: str) -> LivenessRecord:
        import asyncio
        try:
            is_alive = await asyncio.wait_for(
                self._handler.ping(forgekin_id),
                timeout=self._cfg.probe.timeout_seconds,
            )
        except asyncio.TimeoutError:
            await self.enter_grace(
                forgekin_id,
                timedelta(seconds=self._cfg.grace_period.default_duration_seconds),
            )
            return await self._repo.get_latest(forgekin_id)  # type: ignore

        if is_alive:
            await self.update_heartbeat(forgekin_id)
        else:
            await self.enter_grace(
                forgekin_id,
                timedelta(seconds=self._cfg.grace_period.default_duration_seconds),
            )
        return await self._repo.get_latest(forgekin_id)  # type: ignore

    async def update_heartbeat(self, forgekin_id: str) -> None:
        current = await self._repo.get_latest(forgekin_id)
        now = datetime.now(timezone.utc)
        if current is None:
            new_record = LivenessRecord(
                record_id=str(uuid.uuid1),
                forgekin_id=forgekin_id,
                state=LivenessState.ALIVE,
                last_heartbeat_at=now,
                source=CanonicalSource.DURABLE_RECORD,
                recorded_at=now,
            )
            await self._repo.upsert(new_record)
            return

        if current.state == LivenessState.ZOMBIE:
            logger.warning(
                f"forgekin {forgekin_id} is ZOMBIE, heartbeat rejected"
            )
            return

        # 合法转换校验
        if current.state != LivenessState.ALIVE:
            self._check_transition(current.state, LivenessState.ALIVE)

        new_record = LivenessRecord(
            record_id=str(uuid.uuid1),
            forgekin_id=forgekin_id,
            state=LivenessState.ALIVE,
            last_heartbeat_at=now,
            last_probe_at=current.last_probe_at,
            grace_until=None,
            source=CanonicalSource.DURABLE_RECORD,
            recorded_at=now,
        )
        await self._repo.upsert(new_record)
        await self._bus.publish(
            topic="liveness.changed",
            payload=new_record.model_dump,
        )

    async def mark_degraded(self, forgekin_id: str, reason: str) -> None:
        current = await self._repo.get_latest(forgekin_id)
        if current is None:
            logger.warning(f"mark_degraded: no record for {forgekin_id}")
            return

        if current.state != LivenessState.DEGRADED:
            self._check_transition(current.state, LivenessState.DEGRADED)

        now = datetime.now(timezone.utc)
        new_record = LivenessRecord(
            record_id=str(uuid.uuid1),
            forgekin_id=forgekin_id,
            state=LivenessState.DEGRADED,
            last_heartbeat_at=current.last_heartbeat_at,
            last_probe_at=now,
            grace_until=None,
            source=CanonicalSource.DURABLE_RECORD,
            degraded_reason=reason,
            recorded_at=now,
        )
        await self._repo.upsert(new_record)
        await self._bus.publish(
            topic="liveness.changed",
            payload=new_record.model_dump,
        )

    async def mark_zombie(self, forgekin_id: str, reason: str) -> None:
        current = await self._repo.get_latest(forgekin_id)
        now = datetime.now(timezone.utc)
        if current is not None:
            self._check_transition(current.state, LivenessState.ZOMBIE)

        new_record = LivenessRecord(
            record_id=str(uuid.uuid1),
            forgekin_id=forgekin_id,
            state=LivenessState.ZOMBIE,
            last_heartbeat_at=current.last_heartbeat_at if current else now,
            last_probe_at=now,
            grace_until=None,
            source=CanonicalSource.DURABLE_RECORD,
            zombie_reason=reason,
            recorded_at=now,
        )
        await self._repo.upsert(new_record)
        await self._bus.publish(
            topic="liveness.changed",
            payload=new_record.model_dump,
        )

    async def enter_grace(
        self, forgekin_id: str, duration: timedelta
    ) -> None:
        current = await self._repo.get_latest(forgekin_id)
        now = datetime.now(timezone.utc)
        grace_until = now + duration

        if current is not None:
            self._check_transition(current.state, LivenessState.GRACE_WAITING)

        new_record = LivenessRecord(
            record_id=str(uuid.uuid1),
            forgekin_id=forgekin_id,
            state=LivenessState.GRACE_WAITING,
            last_heartbeat_at=current.last_heartbeat_at if current else now,
            last_probe_at=now,
            grace_until=grace_until,
            source=CanonicalSource.DURABLE_RECORD,
            recorded_at=now,
        )
        await self._repo.upsert(new_record)
        await self._bus.publish(
            topic="liveness.changed",
            payload=new_record.model_dump,
        )

    def _check_transition(
        self, current: LivenessState, target: LivenessState
    ) -> None:
        allowed = ALLOWED_TRANSITIONS.get(current, set)
        if target not in allowed:
            raise IllegalLivenessTransitionError(
                f"liveness state transition {current.value} -> {target.value} "
                f"not allowed (allowed: {[s.value for s in allowed]})"
            )


class DefaultSplitBrainDetector(SplitBrainDetector):
    """脑裂检测器默认实现"""

    def __init__(self, config: LivenessConfig, event_bus: EventBus):
        self._cfg = config
        self._bus = event_bus

    async def detect(
        self, records: list[LivenessRecord]
    ) -> Optional[SplitBrainAlert]:
        if len(records) < 2:
            return None

        # 1. state 不一致
        states = {r.state for r in records}
        if self._cfg.split_brain.state_disagreement_enabled and len(states) > 1:
            return SplitBrainAlert(
                alert_id=str(uuid.uuid1),
                forgekin_id=records[0].forgekin_id,
                sources_disagree=[r.source for r in records],
                states={r.source.value: r.state.value for r in records},
                delta_seconds=0.0,
                detected_at=datetime.now(timezone.utc),
            )

        # 2. last_heartbeat_at 差异
        heartbeats = [r.last_heartbeat_at for r in records]
        delta = (max(heartbeats) - min(heartbeats)).total_seconds
        if delta > self._cfg.split_brain.heartbeat_delta_threshold_seconds:
            return SplitBrainAlert(
                alert_id=str(uuid.uuid1),
                forgekin_id=records[0].forgekin_id,
                sources_disagree=[r.source for r in records],
                states={r.source.value: r.state.value for r in records},
                delta_seconds=delta,
                detected_at=datetime.now(timezone.utc),
            )
        return None

    async def alert(self, alert: SplitBrainAlert) -> None:
        logger.warning(
            f"split brain detected for {alert.forgekin_id}: "
            f"states={alert.states} delta={alert.delta_seconds}s"
        )
        await self._bus.publish(
            topic="liveness.split_brain",
            payload=alert.model_dump,
        )
```

### 3.2 关键流程时序图

```
[canonical_read 时序图]

  Forgekin.act    canonical    repository   probe    detector   EventBus   F040
        │              │             │           │           │          │          │
        │ canonical_read(forgekin_id) │           │           │          │          │
        ├─────────────>│             │           │           │          │          │
        │              │ get_latest            │           │          │          │
        │              ├────────────>│           │           │          │          │
        │              │<────────────┤ durable   │           │          │          │
        │              │                                                          │          │
        │              │ (if state==GRACE_WAITING & grace_until < now)            │          │
        │              │   转 ZOMBIE + upsert + publish                          │          │
        │              │                                                          │          │
        │              │ (elif heartbeat stale)                                  │          │
        │              │ enter_grace                                           │          │
        │              ├──────────────────────────>│              │           │          │          │
        │              │<──────────────────────────┤ OK           │           │          │          │
        │              │                                                          │          │
        │              │ (elif split_brain.enabled)                                │          │
        │              │ probe                                                  │          │
        │              ├──────────────────────────>│              │           │          │          │
        │              │<──────────────────────────┤ record       │           │          │          │
        │              │ detect([durable, probed])                                │          │
        │              ├──────────────────────────────────────────>│           │          │          │
        │              │<──────────────────────────────────────────┤ alert?    │          │          │
        │              │ (if alert) alert                                                     │          │
        │              ├────────────────────────────────────────────────────────>│          │          │
        │              │                                                                       ├────────>│
        │              │                                                                       │          │
        │              │ return durable  # 单一真相源                                          │          │
        │<─────────────┤                                                                       │          │
```

### 3.3 错误处理

| 异常类型 | 触发场景 | 处理策略 | 重试次数 |
|---------|---------|---------|---------|
| `IllegalLivenessTransitionError` | 状态转换不合法（如 ZOMBIE → ALIVE） | 拒绝操作，记录错误 | 不重试（编程错误） |
| `ProbeTimeoutError` | 探测超时 | 进入宽限期，标记 GRACE_WAITING | 3（指数退避） |
| `RepositoryUnavailableError` | durable_record 不可用 | 回落 external_probe，记录告警 | 2 |
| `SplitBrainDetectedError` | 多源信号脑裂 | 以 durable_record 为准，派发告警 | 不重试 |
| `HeartbeatStaleError` | 心跳过期 | 进入宽限期 | 不重试 |
| `GracePeriodExpiredError` | 宽限期结束 | 转 ZOMBIE，不可恢复 | 不重试 |
| `ZombieStateError` | ZOMBIE 状态被操作 | 拒绝操作，记录告警 | 不重试 |

### 3.4 性能优化

| 性能指标 | 目标值 | 优化手段 |
|---------|--------|---------|
| canonical_read 延迟（无脑裂检测） | < 10ms | durable_record 索引 + 内存 LRU 缓存 |
| canonical_read 延迟（含脑裂检测） | < 100ms | 并发探测 + 超时硬切 |
| probe 延迟 | < 5s | asyncio.wait_for + 超时硬切 |
| Repository 查询延迟 | < 5ms | forgekin_id 唯一索引 + state 索引 |
| 状态转换延迟 | < 5ms | 内存决策表 + 单次 UPDATE |
| 多源校验开销 | < 50ms | 跳过策略（cache_ttl 内不重复探测） |
| 脑裂检测延迟 | < 10ms | 集合操作 + 阈值比较 |
| LivenessRecord 持久化延迟 | < 10ms | 异步 fsync + WAL 模式 |

---

## 4. 跨模块协作实现

### 4.1 上游依赖如何调用

- **Forgekin.act**：Forgekin 执行前调用 `CanonicalReadModel.check_liveness(required_state=ALIVE)`。
- **F022 Tier 1-4 恢复**：Tier 2 探测阶段调用 `canonical_read` 获取 liveness。
- **F024 强 workflow**：强 workflow 每步前调用 `check_liveness`，zombie 状态拒绝执行。
- **F025 跨 provider 宿主抽象**：provider liveness 通过 `mark_degraded/mark_zombie` 接口更新。
- **F021 副作用 WAL**：WAL 状态变更时订阅 `wal.entry.failed` 触发 mark_degraded。
- **DI 容器**：`canonical_read_model` 通过 `inject("canonical_read_model")` 获取。

### 4.2 下游影响如何被调用

- **F020 七类归因**：liveness 历史作为 environment_drift 归因证据。F020 订阅 `liveness.changed` 事件。
- **F040 控制面**：所有 liveness 变更写入 F040 Eval Hub。F040 订阅 `liveness.*` 主题。
- **Forgekin.learn**：liveness 历史作为 Forgekin 学习输入，更新能力画像。
- **archive_repository**：liveness 历史归档到 archive_repository（独立表）。

### 4.3 集成测试点

| 测试点 ID | 测试场景 | 验证点 | 责任方 |
|----------|---------|--------|--------|
| IT-D023-001 | canonical_read 优先 durable_record | durable_record 存在时不调用 probe | 测试员Forgekin（蜜獾·平头哥） |
| IT-D023-002 | canonical_read durable 不存在触发 probe | probe 被调用 + upsert | 测试员Forgekin |
| IT-D023-003 | 宽限期过期转 ZOMBIE | GRACE_WAITING + grace_until < now → ZOMBIE | 测试员Forgekin |
| IT-D023-004 | 心跳过期进入宽限期 | heartbeat_stale 后转 GRACE_WAITING | 测试员Forgekin |
| IT-D023-005 | 状态转换矩阵 ALIVE→DEGRADED | 合法转换通过 | 测试员Forgekin |
| IT-D023-006 | 状态转换矩阵 ZOMBIE→ALIVE | 非法转换被拒绝 | 测试员Forgekin |
| IT-D023-007 | update_heartbeat 恢复 ALIVE | GRACE_WAITING → ALIVE | 测试员Forgekin |
| IT-D023-008 | ZOMBIE 拒绝 heartbeat | ZOMBIE 状态心跳被拒 | 测试员Forgekin |
| IT-D023-009 | 脑裂检测 state 不一致 | 不同 source 的 state 不一致触发 alert | 测试员Forgekin |
| IT-D023-010 | 脑裂检测 heartbeat 差异 | heartbeat delta > 阈值触发 alert | 测试员Forgekin |
| IT-D023-011 | check_liveness ALIVE 要求 | ALIVE 状态通过，其他状态拒绝 | 测试员Forgekin |
| IT-D023-012 | check_liveness ZOMBIE 拒绝 | ZOMBIE 永远拒绝 | 测试员Forgekin |
| IT-D023-013 | probe 超时进入宽限期 | probe timeout → GRACE_WAITING | 测试员Forgekin |
| IT-D023-014 | probe_handler 失败回落 | probe 失败时创建临时 ZOMBIE | 测试员Forgekin |
| IT-D023-015 | 多源校验脑裂时仍以 durable 为准 | 脑裂时 canonical_read 返回 durable | 测试员Forgekin |

---

## 5. 详细设计验收

### 5.1 功能验收 AC

- [ ] **AC-D023-001**: canonical_read 优先 durable_record（IT-D023-001）
- [ ] **AC-D023-002**: durable 不存在触发 probe（IT-D023-002）
- [ ] **AC-D023-003**: 宽限期过期转 ZOMBIE（IT-D023-003）
- [ ] **AC-D023-004**: 心跳过期进入宽限期（IT-D023-004）
- [ ] **AC-D023-005**: 状态转换矩阵生效（IT-D023-005）
- [ ] **AC-D023-006**: 非法状态转换被拒绝（IT-D023-006）
- [ ] **AC-D023-007**: update_heartbeat 恢复 ALIVE（IT-D023-007）
- [ ] **AC-D023-008**: ZOMBIE 拒绝 heartbeat（IT-D023-008）
- [ ] **AC-D023-009**: 脑裂检测 state 不一致（IT-D023-009）
- [ ] **AC-D023-010**: 脑裂检测 heartbeat 差异（IT-D023-010）

### 5.2 性能验收 AC

- [ ] **AC-D023-011**: canonical_read 延迟（无脑裂检测）< 10ms
- [ ] **AC-D023-012**: canonical_read 延迟（含脑裂检测）< 100ms
- [ ] **AC-D023-013**: probe 延迟 < 5s
- [ ] **AC-D023-014**: Repository 查询延迟 < 5ms
- [ ] **AC-D023-015**: 状态转换延迟 < 5ms
- [ ] **AC-D023-016**: 多源校验开销 < 50ms
- [ ] **AC-D023-017**: 脑裂检测延迟 < 10ms

### 5.3 安全验收 AC

- [ ] **AC-D023-018**: durable_record 单一真相源（禁止绕过）
- [ ] **AC-D023-019**: 状态转换矩阵强制（不可绕过）
- [ ] **AC-D023-020**: ZOMBIE 不可恢复
- [ ] **AC-D023-021**: 宽限期硬约束（不立即标记 zombie）
- [ ] **AC-D023-022**: LivenessRecord 不可变（Pydantic frozen=True）
- [ ] **AC-D023-023**: Repository 层抽象，不直操作数据库
- [ ] **AC-D023-024**: 脑裂时仍以 durable_record 为准

### 5.4 Eval 验收 AC

- [ ] **AC-D023-025**: canonical_read 成功率 >= 99.9%
- [ ] **AC-D023-026**: liveness 判定准确率 >= 99%
- [ ] **AC-D023-027**: 脑裂检测召回率 >= 95%
- [ ] **AC-D023-028**: 宽限期机制减少误判 zombie 比例 >= 80%
- [ ] **AC-D023-029**: liveness 历史记录完整率 100%

---

## 6. 引用

- [doc:../spec.md#§3.6]
- [doc:../arch.md#§3.6]
- [doc:../architecture/A023-liveness-canonical-read.md]
- [doc:../features/F008-durable-state-surfaces.md]
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
| 2026-07-19 | v0.1 | 初始创建（四态 liveness + 三类 CanonicalSource + durable_record 单一真相源 + 宽限期机制 + 脑裂检测 + 状态转换矩阵 + 15 集成测试点 + 4 类 AC） | 开发者 Forgekin（猎犬·夏洛克） |
