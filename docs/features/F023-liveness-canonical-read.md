# Feature F023: liveness 规范读模型

> **状态**: draft
> **版本**: v0.1
> **依赖**: [doc:review/review.md#RA-039] + [doc:roleagent.md#第6章]
> **关联 ADR**: [doc:decisions/010-distributed-reliability.md]
> **类型**: reliability
> **创建日期**: 2026-07-17
> **负责人**: 架构师灵智体

---

## 1. 概述（Overview）

liveness 规范读模型是 roleagent.md 第 6 章的分布式可靠性核心：解决 liveness split-brain 真实事故——两个后端读路径对同一 invocation 给出矛盾结果。解法是单一规范读模型：持久记录是生命周期真相源，草稿缓存是内容新鲜度信号，进程内 tracker 是控制面状态。

本 Feature 实现四态结构化 liveness（活着/退化/僵尸/等待宽限）、规范读路径、与 F008 Durable State Surfaces 联动。

## 2. 动机（Motivation）

`[doc:review/review.md#RA-039]` 指出：roleagent.md 第 6 章描述 liveness split-brain 真实事故——两个后端读路径对同一 invocation 给出矛盾结果。v7.0 无此规范读模型，Forgekin 存活判断靠心跳，无"活着/退化/僵尸/等待宽限"四态结构化结果。

不做这个 Feature，F008 Durable State Surfaces 的 canonical_read 无统一规范，F021 WAL 的 confirmed 状态无 liveness 信号支撑，F025 跨 provider 宿主抽象无法判断"provider 崩了 Forgekin 是否还活着"。这是 roleagent.md 第 6 章分布式可靠性的核心机制。

## 3. 详细设计（Detailed Design）

### 3.1 数据模型

```python
class LivenessState(str, Enum):
    ALIVE = "alive"                       # 活着（正常响应）
    DEGRADED = "degraded"                 # 退化（响应慢/部分失败）
    ZOMBIE = "zombie"                     # 僵尸（心跳在但不工作）
    GRACE_WAITING = "grace_waiting"       # 等待宽限（短暂失联，宽限期内）

class LivenessRecord(BaseModel):
    forgekin_id: str
    state: LivenessState
    last_heartbeat_at: datetime
    last_confirmed_side_effect_at: datetime  # 关联 F021 WAL
    grace_deadline: Optional[datetime]    # 宽限期截止
    canonical_source: Literal["durable_record", "draft_cache", "in_process_tracker"]
```

### 3.2 核心接口

```python
class LivenessProbe(ABC):
    """liveness 探测"""
    @abstractmethod
    async def probe(self, forgekin_id: str) -> LivenessRecord: ...

class CanonicalReadModel:
    """规范读模型——单一真相源"""
    async def read(self, forgekin_id: str) -> LivenessRecord: ...
    async def read_for_decision(self, forgekin_id: str) -> LivenessState: ...
```

### 3.3 关键算法

- **规范读源优先级**：durable_record（生命周期真相源）> in_process_tracker（控制面状态）> draft_cache（内容新鲜度信号）。
- **四态判定**：心跳正常 + 副作用正常 → alive；心跳正常 + 副作用延迟 → degraded；心跳在 + 副作用停滞 → zombie；心跳失联 + 宽限期内 → grace_waiting。
- **宽限期**：失联后进入 grace_waiting，宽限期内不转 zombie，宽限期满转 zombie。
- **split-brain 检测**：多读路径结果矛盾时，以 durable_record 为准并告警。

### 3.4 配置外置（YAML 示例）

```yaml
liveness:
  canonical_source_priority: [durable_record, in_process_tracker, draft_cache]
  heartbeat_interval_seconds: 30
  degraded_threshold_seconds: 60
  grace_period_seconds: 120
  zombie_check: {method: confirmed_side_effect_lag, threshold: 300}
  on_split_brain: [use_durable_record, alert_F040]
```

## 4. 验收标准（Acceptance Criteria）

- [ ] AC-1: 规范读模型以 durable_record 为单一真相源
- [ ] AC-2: 四态（alive/degraded/zombie/grace_waiting）可判定
- [ ] AC-3: 宽限期内不转 zombie
- [ ] AC-4: split-brain 时以 durable_record 为准并告警
- [ ] AC-5: liveness 信号关联 F021 WAL confirmed 状态

## 5. 测试策略

### 5.1 单元测试

- 规范读源优先级、四态判定、宽限期、split-brain 检测。

### 5.2 集成测试

- 接入 F008 Durable State Surfaces、F021 WAL、F025 跨 provider 宿主、F040 控制面。

### 5.3 E2E 测试（必须遵守 T1-T8 测试铁律）

- 真实厂商灵智体构造 split-brain 场景（如进程崩溃但心跳残留），验证规范读模型正确判定 zombie。**遵守 T1-T8**：真实 LLM、真实数据、真实工具调用。

## 6. 引用

- [doc:roleagent.md#第6章]
- [doc:review/review.md#第八章/RA-039]
- [doc:decisions/010-distributed-reliability.md]
- [doc:design/naming-contract.md#2.2]（灵智体 Forgekin）
- [doc:features/F008-durable-state-surfaces.md]
- [doc:features/F021-side-effect-wal.md]
- [doc:features/F025-provider-host-abstraction.md]
- [doc:features/F040-harness-eval-control-plane.md]
- [doc:project_rules.md#T1-T8]
