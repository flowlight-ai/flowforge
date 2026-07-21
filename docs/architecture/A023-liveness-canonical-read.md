# A023: liveness 规范读模型架构设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.6]（FR-CORE-006）
> **对应 arch.md**: [doc:../arch.md#§3.6]
> **对应 design.md**: [doc:../design.md#§3.6]（待创建）
> **对应 Feature**: [doc:../features/F023-liveness-canonical-read.md]（同号 Feature 级 SRS）
> **对应详细设计**: [doc:../design/D023-liveness-canonical-read.md]（待创建，同号 Feature 级 SDD）
> **依赖 ADR**: [doc:../decisions/010-distributed-reliability.md]

---

## 1. 架构上下文

### 1.1 架构问题

分布式可靠性的核心问题是"liveness split-brain"。roleagent.md 第 6 章描述真实事故：两个后端读路径对同一 invocation 给出矛盾结果（一个说"活着"一个说"死了"）。v7.0 无规范读模型，导致三类架构故障：

1. **心跳假活**：Forgekin进程崩溃但心跳残留，上层判断为"活着"继续派活。
2. **僵尸进程**：心跳在但副作用停滞，Forgekin实际上"僵尸"，仍被分配任务。
3. **多源矛盾**：durable_record / draft_cache / in_process_tracker 三源结果不一致时无仲裁规则。

roleagent.md 第 6 章要求**单一规范读模型**：持久记录是生命周期真相源，草稿缓存是内容新鲜度信号，进程内 tracker 是控制面状态。本架构解决的核心问题：**如何实现四态结构化 liveness（活着/退化/僵尸/等待宽限）、规范读路径、split-brain 检测、与 F008 Durable State Surfaces 联动**。

### 1.2 架构约束

- **单向依赖约束**：liveness 读模型层依赖 F021 WAL 与 F008 Durable State Surfaces，禁止被它们反向依赖。
- **真相源唯一约束**：durable_record 是生命周期真相源，draft_cache 与 in_process_tracker 仅作辅助信号，矛盾时以 durable_record 为准。
- **四态结构化约束**：liveness 必须是 alive / degraded / zombie / grace_waiting 四态之一，禁止"alive 但有点慢"等模糊状态。
- **宽限期约束**：失联后进入 grace_waiting，宽限期内不转 zombie，宽限期满转 zombie。
- **配置驱动约束**：心跳间隔、退化阈值、宽限期、zombie 检测规则外置 YAML。

### 1.3 架构影响

- **对 F021 副作用 WAL**：WAL confirmed 状态是 liveness "副作用已确认"信号源。
- **对 F008 Durable State Surfaces**：canonical_read 走 F008 durable_record 表面，是 6 类持久状态表面之一。
- **对 F022 Tier 1-4 恢复分级**：liveness zombie 触发 F022 恢复流程。
- **对 F024 强 workflow**：强 workflow 的步骤推进需要 liveness alive 状态支撑。
- **对 F025 跨 provider 宿主抽象**：provider liveness 是 failover 决策依据。
- **对 F040 控制面**：split-brain 告警写入 F040 Eval Hub。

---

## 2. 架构设计

### 2.1 组件架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│ 上层调用方                                                           │
│  F022 RecoveryExecutor  F024 StrongWorkflow  F025 HostAbstraction  │
└──────────┬──────────────────────────────────────────────────────────┘
           │ read_for_decision(forgekin_id)
           ▼
┌─────────────────────────────────────────────────────────────────────┐
│ L3: CanonicalReadModel（规范读模型 - 单一真相源）                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ 读源优先级：                                                 │  │
│  │   1. durable_record（生命周期真相源）                        │  │
│  │   2. in_process_tracker（控制面状态）                        │  │
│  │   3. draft_cache（内容新鲜度信号）                           │  │
│  │                                                              │  │
│  │ 矛盾仲裁：以 durable_record 为准，告警 F040                  │  │
│  └─────────────────────────────────────────────────────────────┘  │
└───┬─────────────────────────────────────────────────────────────────┘
    │ probe               │ detect_split_brain
    ▼                     ▼
┌────────────┐    ┌──────────────────┐
│LivenessProbe│    │SplitBrainDetector│
│（四态判定） │    │（多源矛盾检测）  │
└─────┬──────┘    └────────┬─────────┘
      │                    │
      ▼                    ▼
┌─────────────────────────────────────────────────────┐
│ LivenessProbe 数据源                                 │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐│
│  │durable_record│ │in_process    │ │draft_cache   ││
│  │（F008 表面） │ │tracker       │ │（新鲜度信号）││
│  │              │ │（控制面状态）│ │              ││
│  └──────────────┘ └──────────────┘ └──────────────┘│
│  + F021 WAL confirmed_at（副作用信号）              │
└─────────────────────────────────────────────────────┘
```

### 2.2 关键架构决策

- **决策 1：durable_record 是单一真相源**。三源矛盾时以 durable_record 为准并告警 F040，draft_cache 与 in_process_tracker 仅作辅助信号。理由：durable_record 持久化、可审计、不受进程崩溃影响，是唯一可信源。
- **决策 2：四态而非二态**。alive（正常）/ degraded（响应慢）/ zombie（心跳在但不工作）/ grace_waiting（失联宽限期内）。理由：二态（alive/dead）无法表达"心跳在但僵尸"与"刚失联可能恢复"，四态让恢复策略可分。
- **决策 3：宽限期机制**。失联后进入 grace_waiting，宽限期（默认 120s）内不转 zombie，宽限期满转 zombie。理由：网络抖动不应立即判 zombie，宽限期是合理容忍。
- **决策 4：zombie 检测靠副作用滞后**。心跳正常但 confirmed_side_effect_lag > 阈值（默认 300s）判 zombie。理由：心跳可被进程残留发送，副作用停滞是更可靠的"真活着"信号。
- **决策 5：split-brain 检测与告警**。多读路径结果矛盾时以 durable_record 为准并写 F040 告警。理由：split-brain 是分布式真实事故，必须可检测可告警。
- **决策 6：规范读路径不写状态**。`CanonicalReadModel.read` 是纯读操作，不修改 liveness 状态。状态变更由 `LivenessProbe.probe` 异步执行。理由：读操作不应有副作用，避免读触发写导致循环。

### 2.3 架构不变量

- durable_record 必须是 liveness 单一真相源，矛盾时必须以 durable_record 为准。
- liveness 必须是 alive / degraded / zombie / grace_waiting 四态之一，必须禁止模糊状态。
- 失联后必须进入 grace_waiting，宽限期内必须不转 zombie。
- 心跳正常但 confirmed_side_effect_lag > 阈值必须判 zombie。
- split-brain 检测必须以 durable_record 为准并告警 F040。
- 规范读路径必须不写状态，必须只读。

---

## 3. 模块设计

### 3.1 模块边界

| 模块 | 路径 | 职责 | 对外暴露 |
|------|------|------|---------|
| CanonicalReadModel | `flowforge/core/reliability/liveness/canonical.py` | 规范读模型，单一真相源 | `read / read_for_decision` |
| LivenessProbe | `flowforge/core/reliability/liveness/probe.py` | 四态判定探测 | `probe` |
| SplitBrainDetector | `flowforge/core/reliability/liveness/split_brain.py` | 多源矛盾检测 | `detect / arbitrate` |
| LivenessRepository | `flowforge/core/reliability/liveness/repository.py` | 持久化 liveness 记录 | 不对上层暴露 |
| HeartbeatMonitor | `flowforge/core/reliability/liveness/heartbeat.py` | 心跳监控 | `track_heartbeat` |
| LivenessConfigLoader | `flowforge/core/reliability/liveness/config.py` | YAML 配置加载 | `load_liveness_config` |

### 3.2 接口契约

```python
from abc import ABC, abstractmethod
from typing import Optional, Literal
from datetime import datetime
from pydantic import BaseModel
from enum import Enum


class LivenessState(str, Enum):
    ALIVE = "alive"
    DEGRADED = "degraded"
    ZOMBIE = "zombie"
    GRACE_WAITING = "grace_waiting"


class CanonicalSource(str, Enum):
    DURABLE_RECORD = "durable_record"
    IN_PROCESS_TRACKER = "in_process_tracker"
    DRAFT_CACHE = "draft_cache"


class LivenessRecord(BaseModel):
    forgekin_id: str
    state: LivenessState
    last_heartbeat_at: datetime
    last_confirmed_side_effect_at: datetime  # 关联 F021 WAL
    grace_deadline: Optional[datetime] = None
    canonical_source: CanonicalSource


class SplitBrainAlert(BaseModel):
    alert_id: str
    forgekin_id: str
    conflicting_sources: list[CanonicalSource]
    conflicting_states: list[LivenessState]
    arbitrated_state: LivenessState
    detected_at: datetime


class LivenessProbe(ABC):
    @abstractmethod
    async def probe(self, forgekin_id: str) -> LivenessRecord:
        """
        四态判定：
        - 心跳正常 + 副作用正常 → ALIVE
        - 心跳正常 + 副作用延迟 → DEGRADED
        - 心跳在 + 副作用停滞 → ZOMBIE
        - 心跳失联 + 宽限期内 → GRACE_WAITING
        """


class CanonicalReadModel(ABC):
    @abstractmethod
    async def read(self, forgekin_id: str) -> LivenessRecord:
        """规范读模型；以 durable_record 为准；不写状态"""

    @abstractmethod
    async def read_for_decision(self, forgekin_id: str) -> LivenessState:
        """返回决策用 liveness 状态"""


class SplitBrainDetector(ABC):
    @abstractmethod
    async def detect(self, forgekin_id: str) -> Optional[SplitBrainAlert]:
        """多源矛盾检测"""

    @abstractmethod
    async def arbitrate(self, alert: SplitBrainAlert) -> LivenessState:
        """以 durable_record 为准仲裁；写 F040 告警"""
```

### 3.3 数据流

```
[规范读路径]
  F022 RecoveryExecutor / F024 StrongWorkflowEngine / F025 HostAbstraction
        │
        ▼
  CanonicalReadModel.read_for_decision(forgekin_id)
        │
        ├─ 读 durable_record（F008 持久表面）
        │
        ▼
  返回 LivenessState（决策用）

[liveness 探测路径]
  周期触发（heartbeat_interval=30s）
        │
        ▼
  LivenessProbe.probe(forgekin_id)
        │
        ├─ 读 last_heartbeat_at（HeartbeatMonitor）
        ├─ 读 last_confirmed_side_effect_at（F021 WAL confirmed）
        │
        ▼
  四态判定：
   ├─ now - heartbeat ≤ 30s AND now - side_effect ≤ 60s → ALIVE
   ├─ now - heartbeat ≤ 30s AND 60s < now - side_effect ≤ 300s → DEGRADED
   ├─ now - heartbeat ≤ 30s AND now - side_effect > 300s → ZOMBIE
   └─ now - heartbeat > 30s AND grace_deadline > now → GRACE_WAITING
        │
        ├─ grace_waiting 满宽限期 → 转 ZOMBIE
        │
        ▼
  LivenessRepository.update(record)
        │
        ▼
  写入 durable_record（F008 持久表面）

[split-brain 检测路径]
  多读路径结果矛盾
        │
        ▼
  SplitBrainDetector.detect(forgekin_id)
        │
        ├─ 读三源（durable_record / in_process_tracker / draft_cache）
        ├─ 状态不一致 → 创建 SplitBrainAlert
        │
        ▼
  SplitBrainDetector.arbitrate(alert)
        │
        ├─ 以 durable_record 为准
        ├─ 告警 F040 EvalHub
        │
        ▼
  返回仲裁后 LivenessState

[恢复联动路径]
  liveness = ZOMBIE
        │
        ▼
  触发 F022 TierClassifier 分级
        │
        ├─ 扫描 F021 WAL pending entry
        │
        ▼
  按 Tier 执行恢复
```

---

## 4. 跨模块协作

### 4.1 上游依赖

- 依赖 **F008 Durable State Surfaces**：durable_record 是 liveness 真相源，走 F008 持久表面。
- 依赖 **F021 副作用 WAL**：WAL confirmed_at 是 liveness "副作用已确认"信号源。

### 4.2 下游影响

- 影响 **F022 Tier 1-4 恢复分级**：liveness zombie 触发 F022 恢复流程。
- 影响 **F024 强 workflow**：强 workflow 步骤推进需 liveness alive 状态支撑。
- 影响 **F025 跨 provider 宿主抽象**：provider liveness 是 failover 决策依据。
- 影响 **F040 控制面**：split-brain 告警 + 四态变更写入 F040 Eval Hub。

### 4.3 跨模块不变量

- durable_record 必须是 liveness 单一真相源，矛盾时必须以 durable_record 为准。
- liveness 必须是四态之一，必须禁止模糊状态。
- 心跳正常但副作用滞后必须判 degraded / zombie，必须不只看心跳。
- 规范读路径必须不写状态，必须只读。
- split-brain 检测必须以 durable_record 仲裁并告警 F040。
- 宽限期参数必须从配置加载，必须禁止硬编码。

---

## 5. 架构验收

### 5.1 架构契约验收

- [ ] AC-1: 单向依赖通过——`flowforge/core/reliability/liveness/` 不 import F008/F021/F022/F024/F025/F040 任何模块。
- [ ] AC-2: DI 容器注入通过——`CanonicalReadModel` 通过 `inject("canonical_read_model")` 获取。
- [ ] AC-3: Repository 层通过——liveness 记录持久化经 Repository，不直操作数据库。
- [ ] AC-4: 配置驱动通过——心跳间隔 / 退化阈值 / 宽限期 / zombie 阈值从 `config/liveness.yaml` 加载。
- [ ] AC-5: durable_record 读路径走 F008 持久表面，无独立存储（集成测试覆盖）。

### 5.2 架构不变量验收

- [ ] AC-6: durable_record 是真相源，矛盾时以 durable_record 为准（单测覆盖）。
- [ ] AC-7: liveness 是四态之一，无第五态（单测覆盖 4 种判定）。
- [ ] AC-8: 心跳正常 + 副作用滞后 > 300s 判 zombie（单测覆盖）。
- [ ] AC-9: 失联后进入 grace_waiting，宽限期满转 zombie（单测覆盖）。
- [ ] AC-10: 规范读路径不写状态，只读（静态扫描确认）。
- [ ] AC-11: split-brain 检测以 durable_record 仲裁并告警 F040（集成测试覆盖）。

---

## 6. 引用

- [doc:../spec.md#§3.6]
- [doc:../arch.md#§3.6]
- [doc:../features/F008-durable-state-surfaces.md]
- [doc:../features/F021-side-effect-wal.md]
- [doc:../features/F022-tier-1-4-recovery.md]
- [doc:../features/F023-liveness-canonical-read.md]
- [doc:../features/F024-weak-state-vs-strong-workflow.md]
- [doc:../features/F025-provider-host-abstraction.md]
- [doc:../features/F040-harness-eval-control-plane.md]
- [doc:../decisions/010-distributed-reliability.md]
- [doc:../../../hiclaw/rules.md#第十一部分]
- [doc:../../../hiclaw/rules.md#编程红线]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（架构骨架 + 四态结构化 + 单一真相源 + split-brain 检测 + 宽限期机制） | 架构师 Forgekin（猫头鹰·鲁班） |
