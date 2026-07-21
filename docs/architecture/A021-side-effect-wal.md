# A021: 副作用日志 WAL 架构设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.6]（FR-CORE-006）
> **对应 arch.md**: [doc:../arch.md#§3.6]
> **对应 design.md**: [doc:../design.md#§3.6]（待创建）
> **对应 Feature**: [doc:../features/F021-side-effect-wal.md]（同号 Feature 级 SRS）
> **对应详细设计**: [doc:../design/D021-side-effect-wal.md]（待创建，同号 Feature 级 SDD）
> **依赖 ADR**: [doc:../decisions/010-distributed-reliability.md]

---

## 1. 架构上下文

### 1.1 架构问题

分布式可靠性的底座问题是"副作用不可追踪不可回滚"。v7.0 有 trace 但无副作用 WAL，导致三类架构故障：

1. **重做风险**：执行中断后无法知道"哪些副作用已发生"，恢复时重做可能重复副作用（如重复转账）。
2. **放弃损失**：放弃恢复可能丢失已完成工作（如已完成 80% 的任务全废）。
3. **回滚盲点**：不可回滚操作（如发出去的 HTTP 请求）被尝试 rollback，造成数据不一致。

roleagent.md 第 6 章要求：**所有副作用操作必须先写 WAL 再执行，执行后写确认**。本架构解决的核心问题：**如何实现 WAL 的追加写入、回放恢复、幂等键防重、前置状态快照、与 F022 Tier 1-4 恢复分级联动**，让副作用可审计可回放可恢复。

### 1.2 架构约束

- **单向依赖约束**：WAL 是可靠性层底座，禁止被 F022/F023/F024 反向依赖。
- **先写后执行约束**：副作用执行前必须先 append WAL entry（status=pending），执行后 confirm，禁止"先执行后写日志"。
- **幂等键约束**：相同 idempotency_key 的 entry 不重复执行，防止恢复时重放导致重复副作用。
- **可回滚分类约束**：仅可回滚操作（file_write / db_write）记录 pre_state；不可回滚操作（http_request / external_api / physical_op）不记录 pre_state 但仍写 WAL。
- **配置驱动约束**：存储后端、幂等键策略、回滚支持类型外置 YAML。

### 1.3 架构影响

- **对 F022 Tier 1-4 恢复分级**：WAL pending entry 是 F022 分级恢复的输入，按 Tier 决定 replay/rollback。
- **对 F023 liveness 规范读模型**：WAL confirmed 状态是 liveness "副作用已确认"信号源。
- **对 F024 强 workflow**：强 workflow 每步写 WAL，是"可审计可回放可拒绝"的物理承载。
- **对 F025 跨 provider 宿主抽象**：provider failover 时 WAL 保证副作用不丢失。
- **对 F008 Durable State Surfaces**：WAL 是 6 类持久状态表面之一（thread session trace 的扩展）。

---

## 2. 架构设计

### 2.1 组件架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│ 上层调用方                                                           │
│  F022 RecoveryExecutor  F023 LivenessProbe  F024 StrongWorkflow    │
└──────────┬──────────────────┬──────────────────┬────────────────────┘
           │ list_pending     │ read_confirmed   │ append_per_step
           ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│ L1: WalCoordinator（WAL 协调器 - 先写后执行编排）                    │
│  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐  │
│  │ append_pending │ │ execute        │ │ confirm        │  │
│  │ idempotency_check│ │ pre_state_snapshot│ │ emit_confirmed   │  │
│  └──────────────────┘ └──────────────────┘ └──────────────────┘  │
└───┬──────────────────────────────────────────────┬─────────────────┘
    │ append / list / replay                       │ rollback
    ▼                                              ▼
┌────────────────────┐               ┌──────────────────────────┐
│WalRepository       │               │ WalReplayer              │
│（禁直操作数据库）   │               │ （回放 + 回滚）          │
└────────────────────┘               └──────────┬───────────────┘
                                                │
                                                ▼
                                    ┌──────────────────────────┐
                                    │ WalExecutor              │
                                    │  execute / confirm       │
                                    │  rollback (if supported) │
                                    └──────────────────────────┘
```

### 2.2 关键架构决策

- **决策 1：先写后执行硬约束**。所有副作用执行前必须先 append WAL entry（status=pending），执行后 confirm。理由：执行中断后可扫描 pending entry 决定 replay/rollback，是分布式可靠性的基础。
- **决策 2：幂等键防重**。相同 idempotency_key 的 entry 不重复执行，幂等键由 hash(target + payload) 生成。理由：恢复时重放可能让相同副作用执行两次（如重复转账），幂等键是结构性防护。
- **决策 3：前置状态快照仅可回滚操作**。file_write / db_write 记录 pre_state 用于 rollback；http_request / external_api / physical_op 不记录 pre_state（无法回滚）。理由：不可回滚操作的 pre_state 无意义，浪费存储且误导恢复逻辑。
- **决策 4：WAL 状态机五态**。`pending / executing / confirmed / failed / rolled_back`，每态有明确转换规则。理由：状态机让恢复逻辑可推断"该 entry 现在处于什么阶段"。
- **决策 5：WAL 持久化与业务隔离**。WAL 表与业务表物理隔离（不同 schema 或不同库），WAL 写入失败不导致业务回滚（业务直接拒绝执行）。理由：WAL 是基础设施，不应被业务故障拖垮。
- **决策 6：max_replay_batch 限制**。单次重启回放批量上限 50，防止大批量回放拖慢启动。理由：万级 pending entry 一次性回放会阻塞启动，分批让启动可观测可中断。

### 2.3 架构不变量

- 副作用执行前必须先 append WAL entry（status=pending），必须禁止"先执行后写日志"。
- 相同 idempotency_key 的 entry 必须不重复执行。
- 仅可回滚操作（file_write / db_write）必须记录 pre_state，不可回滚操作必须不记录。
- WAL 状态机必须为五态（pending / executing / confirmed / failed / rolled_back），转换必须遵循状态机规则。
- WAL 表必须与业务表物理隔离，WAL 写入失败必须导致业务拒绝执行。
- 进程重启后必须扫描 pending entry 交 F022 分级处理，必须不自动全部 replay。

---

## 3. 模块设计

### 3.1 模块边界

| 模块 | 路径 | 职责 | 对外暴露 |
|------|------|------|---------|
| WalCoordinator | `flowforge/core/reliability/wal/coordinator.py` | 先写后执行编排 | `append_pending / execute / confirm` |
| WalAppender | `flowforge/core/reliability/wal/appender.py` | WAL 追加写入 | `append` |
| WalExecutor | `flowforge/core/reliability/wal/executor.py` | 按 entry 执行副作用 | `execute / confirm` |
| WalReplayer | `flowforge/core/reliability/wal/replayer.py` | 回放恢复 + rollback | `list_pending / replay / rollback` |
| WalRepository | `flowforge/core/reliability/wal/repository.py` | 持久化读写 | 不对上层暴露 |
| WalConfigLoader | `flowforge/core/reliability/wal/config.py` | YAML 配置加载 | `load_wal_config` |

### 3.2 接口契约

```python
from abc import ABC, abstractmethod
from typing import Optional, Literal
from datetime import datetime
from pydantic import BaseModel, Field
from enum import Enum


class SideEffectType(str, Enum):
    FILE_WRITE = "file_write"
    HTTP_REQUEST = "http_request"
    DB_WRITE = "db_write"
    EXTERNAL_API = "external_api"
    GIT_OP = "git_op"
    PHYSICAL_OP = "physical_op"


class WalStatus(str, Enum):
    PENDING = "pending"
    EXECUTING = "executing"
    CONFIRMED = "confirmed"
    FAILED = "failed"
    ROLLED_BACK = "rolled_back"


class WalEntry(BaseModel):
    entry_id: str
    forgekin_id: str
    effect_type: SideEffectType
    target: str = Field(min_length=1)
    payload: dict
    pre_state: Optional[dict] = None  # 仅可回滚操作记录
    status: WalStatus = WalStatus.PENDING
    written_at: datetime
    confirmed_at: Optional[datetime] = None
    idempotency_key: str = Field(min_length=1)


class WalAppender(ABC):
    @abstractmethod
    async def append(self, entry: WalEntry) -> str:
        """
        1. 校验 idempotency_key 唯一性（重复则返回已有 entry_id）
        2. 仅可回滚操作记录 pre_state
        3. 持久化 status=pending
        4. 返回 entry_id
        """


class WalExecutor(ABC):
    @abstractmethod
    async def execute(self, entry_id: str) -> None:
        """按 entry 执行副作用；status 转 executing"""

    @abstractmethod
    async def confirm(self, entry_id: str) -> None:
        """执行后确认；status 转 confirmed；触发 emit_confirmed 事件"""


class WalReplayer(ABC):
    @abstractmethod
    async def list_pending(self, forgekin_id: str) -> list[WalEntry]:
        """扫描 pending entry；按 max_replay_batch 限制"""

    @abstractmethod
    async def replay(self, entry_id: str) -> None:
        """回放 entry；交 F022 分级决定"""

    @abstractmethod
    async def rollback(self, entry_id: str) -> None:
        """回滚 entry；仅可回滚操作；恢复 pre_state"""


class WalCoordinator(ABC):
    @abstractmethod
    async def append_pending(self, entry: WalEntry) -> str:
        """先写 WAL（status=pending）"""

    @abstractmethod
    async def execute_with_confirm(self, entry_id: str) -> None:
        """
        执行 + 确认：
        1. status: pending → executing
        2. 执行副作用
        3. status: executing → confirmed
        失败 → status: executing → failed
        """

    @abstractmethod
    async def idempotency_check(self, idempotency_key: str) -> Optional[str]:
        """幂等键检查；存在则返回已有 entry_id"""
```

### 3.3 数据流

```
[副作用执行路径 - 先写后执行]
  Forgekin.act 触发副作用（如 file_write）
        │
        ▼
  WalCoordinator.append_pending(WalEntry{
    effect_type=file_write, target="/path/file", payload={...},
    pre_state=<current file content>,
    idempotency_key=hash(target+payload)
  })
        │
        ├─ idempotency_check ── 已存在 ──▶ 返回已有 entry_id，跳过执行
        ├─ pre_state 记录（仅可回滚操作）
        │
        ▼
  WalRepository.insert(entry, status=pending)
        │
        ▼
  WalCoordinator.execute_with_confirm(entry_id)
        │
        ├─ status: pending → executing
        ├─ 执行副作用（写文件）
        ├─ 成功 → status: executing → confirmed, confirmed_at=now
        └─ 失败 → status: executing → failed
        │
        ▼
  emit_confirmed 事件（关联 F023 liveness）

[重启回放路径]
  进程重启
        │
        ▼
  WalReplayer.list_pending(forgekin_id)
        │  按 max_replay_batch=50 限制
        ▼
  返回 pending entry 列表
        │
        ▼
  交 F022 TierClassifier 分级
        │
        ├─ Tier 1（file_read/build/test）→ auto_replay
        ├─ Tier 2（worktree/sandbox）→ probe_then_replay
        ├─ Tier 3（shared_file/external_service）→ issue_recovery_card
        ├─ Tier 4（force_push/merge）→ hard_reject
        └─ Tier 0（physical_op）→ hard_reject + F011 星星罐子拦截
        │
        ▼
  按分级执行 replay / rollback / 派发恢复卡
```

---

## 4. 跨模块协作

### 4.1 上游依赖

- 依赖 **F008 Durable State Surfaces**：WAL 是 6 类持久状态表面之一（thread session trace 扩展）。
- 依赖 **F009 Evidence & Sensors**：WAL 状态变更事件作为 F009 证据之一。

### 4.2 下游影响

- 影响 **F022 Tier 1-4 恢复分级**：WAL pending entry 是 F022 分级恢复的输入。
- 影响 **F023 liveness 规范读模型**：WAL confirmed 状态是 liveness "副作用已确认"信号源。
- 影响 **F024 强 workflow**：强 workflow 每步写 WAL，是"可审计可回放可拒绝"的物理承载。
- 影响 **F025 跨 provider 宿主抽象**：provider failover 时 WAL 保证副作用不丢失。
- 影响 **F011 Magic Words**：Tier 0/4 操作可通过 F011 星星罐子拦截（在 dispatch 前）。

### 4.3 跨模块不变量

- WAL 必须先写后执行，必须禁止"先执行后写日志"。
- 幂等键必须唯一，重复 entry 必须返回已有 entry_id 而非新建。
- 仅可回滚操作必须记录 pre_state，不可回滚操作必须不记录。
- WAL 表必须与业务表物理隔离，WAL 写入失败必须导致业务拒绝执行。
- 进程重启后 pending entry 必须交 F022 分级处理，必须不自动全部 replay。
- max_replay_batch 必须从配置加载，必须禁止硬编码。

---

## 5. 架构验收

### 5.1 架构契约验收

- [ ] AC-1: 单向依赖通过——`flowforge/core/reliability/wal/` 不 import F022/F023/F024/F025/F011 任何模块。
- [ ] AC-2: DI 容器注入通过——`WalCoordinator` 通过 `inject("wal_coordinator")` 获取。
- [ ] AC-3: Repository 层通过——WAL 持久化经 Repository，不直操作数据库。
- [ ] AC-4: 配置驱动通过——存储后端 / 幂等键策略 / 回滚类型从 `config/side_effect_wal.yaml` 加载。
- [ ] AC-5: WAL 表与业务表物理隔离（不同 schema 或不同库）。

### 5.2 架构不变量验收

- [ ] AC-6: 副作用执行前必须先 append WAL（status=pending），代码中无"先执行后写日志"路径（静态扫描确认）。
- [ ] AC-7: 相同 idempotency_key 的 entry 不重复执行（单测覆盖）。
- [ ] AC-8: file_write/db_write 记录 pre_state，http_request/external_api/physical_op 不记录（单测覆盖）。
- [ ] AC-9: WAL 状态机五态转换遵循规则，无非法转换（单测覆盖）。
- [ ] AC-10: 进程重启后 pending entry 交 F022 分级处理，不自动全部 replay（集成测试覆盖）。
- [ ] AC-11: max_replay_batch 从配置加载，代码中无硬编码 50。

---

## 6. 引用

- [doc:../spec.md#§3.6]
- [doc:../arch.md#§3.6]
- [doc:../features/F008-durable-state-surfaces.md]
- [doc:../features/F009-evidence-sensors.md]
- [doc:../features/F011-magic-words.md]
- [doc:../features/F021-side-effect-wal.md]
- [doc:../features/F022-tier-1-4-recovery.md]
- [doc:../features/F023-liveness-canonical-read.md]
- [doc:../features/F024-weak-state-vs-strong-workflow.md]
- [doc:../features/F025-provider-host-abstraction.md]
- [doc:../decisions/010-distributed-reliability.md]
- [doc:../../../hiclaw/rules.md#第十一部分]
- [doc:../../../hiclaw/rules.md#编程红线]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（架构骨架 + 先写后执行 + 幂等键 + pre_state 分类 + 五态状态机） | 架构师 Forgekin（猫头鹰·鲁班） |
