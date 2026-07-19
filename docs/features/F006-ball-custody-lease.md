# Feature F006: 持球注册 Lease（Ball Custody Lease）

> **状态**: draft
> **版本**: v0.1
> **依赖**: [doc:review/review.md#RA-014] + [doc:roleagent.md#第2章]
> **关联 ADR**: [doc:decisions/002-collaboration-protocol.md]
> **类型**: collaboration
> **创建日期**: 2026-07-17
> **负责人**: 架构师灵智体（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.2]（FR-CORE-002，与本文档同号对应）
> **对应 arch.md**: [doc:../arch.md#§3.2]（待创建）
> **对应 design.md**: [doc:../design.md#§3.2]（待创建）
> **9 大点名称修订**: 已应用（双轨命名 + AI 术语优先 + 弱化万物 + 去 AGI 化）

---

## 1. 概述（Overview）

持球注册 Lease 是 TeamAct 协作协议的"分布式 lease + 定时唤醒"机制：当灵智体（Forgekin）需要退出当前会话等待外部条件（CI 完成、CVO 确认、定时唤醒）时，用结构化的持球注册工具声明等待原因、下一步计划和预期唤醒时间。这相当于分布式系统里的 lease + 定时唤醒。

本 Feature 实现 lease 的注册、续约、超时释放、唤醒回调，并与 F004 乒乓球熔断器联动避免"持球但不动"。

## 2. 动机（Motivation）

`[doc:review/review.md#RA-014]` 指出：roleagent.md 第 2 章描述"agent 需要退出当前会话等待外部条件，这时用结构化的持球注册工具声明等待原因、下一步计划和预期唤醒时间——相当于分布式系统里的 lease + 定时唤醒"。v7.0 无持球注册机制，Forgekin 退出会话后球就掉地上，其他 Forgekin 不知道任务还在不在有人管。

不做这个 Feature，TeamAct 的"无悬空任务归属"终止条件无法验证，CI 等待期间任务处于"薛定谔状态"，长时间任务（如 claude code 跑完整测试套件 10 分钟）无法被协作流正确承载。这是 Build to Persist 的协作协议资产。

## 3. 详细设计（Detailed Design）

### 3.1 数据模型

```python
class BallCustodyLease(BaseModel):
    lease_id: str
    team_id: str
    forgekin_id: str                # 持球灵智体
    reason: str                     # 等待原因（CI/CVO/定时唤醒）
    next_step: str                  # 唤醒后下一步
    expected_wake_at: datetime      # 预期唤醒时间
    acquired_at: datetime
    ttl_seconds: int                # lease TTL
    status: Literal["held", "renewed", "released", "expired", "revoked"]
    renewal_count: int = 0
    max_renewals: int = 3

class WakeupEvent(BaseModel):
    lease_id: str
    trigger: Literal["ci_green", "cvo_confirm", "timer", "external"]
    fired_at: datetime
    payload: dict
```

### 3.2 核心接口

```python
class BallCustodyRegistry(ABC):
    @abstractmethod
    async def acquire(self, lease: BallCustodyLease) -> str: ...
    @abstractmethod
    async def renew(self, lease_id: str, extension_seconds: int) -> None: ...
    @abstractmethod
    async def release(self, lease_id: str) -> None: ...
    @abstractmethod
    async def list_active(self, team_id: str) -> list[BallCustodyLease]: ...

class WakeupScheduler:
    def schedule(self, lease: BallCustodyLease) -> None: ...
    def fire(self, event: WakeupEvent) -> None: ...
```

### 3.3 关键算法

- **TTL 续约**：持球灵智体在 TTL 到期前可续约，续约次数超 `max_renewals` 强制释放并升级 CVO。
- **超时释放**：TTL 到期未续约，lease 转 expired，球回 TeamAct 状态机可被其他灵智体接管。
- **唤醒回调**：WakeupScheduler 监听 CI/CVO/定时器事件，触发时唤醒对应持球灵智体。
- **与熔断器联动**：lease held 期间无工具调用 + 无产出，F004 乒乓球熔断器计入空传。

### 3.4 配置外置（YAML 示例）

```yaml
ball_custody:
  default_ttl_seconds: 1800
  max_renewals: 3
  renewal_extension_seconds: 900
  on_expire: [release_ball, notify_team, write_eval_signal]
  wakeup_sources: [ci_green, cvo_confirm, timer, external]
```

## 4. 验收标准（Acceptance Criteria）

- [ ] AC-1: 持球灵智体可注册 lease 并声明等待原因与唤醒时间
- [ ] AC-2: TTL 到期未续约自动释放，球回 TeamAct 状态机
- [ ] AC-3: 续约次数超限强制释放并升级 CVO
- [ ] AC-4: WakeupEvent 触发时正确唤醒持球灵智体
- [ ] AC-5: lease held 期间空传计入 F004 熔断器

## 5. 测试策略

### 5.1 单元测试

- lease 注册/续约/释放/过期状态机、TTL 计算、唤醒调度。

### 5.2 集成测试

- 接入 F002 TeamActState，验证 lease 释放后球可被接管。
- 接入 F004 PingPongCircuitBreaker，验证空传联动。

### 5.3 E2E 测试（必须遵守 T1-T8 测试铁律）

- 真实厂商灵智体持球等待 CI（真实运行测试套件），验证 CI 绿后唤醒回调正确触发。**遵守 T1-T8**：真实 LLM、真实数据、真实工具调用。

## 6. 引用

- [doc:roleagent.md#第2章]
- [doc:review/review.md#第八章/RA-014]
- [doc:decisions/002-collaboration-protocol.md]
- [doc:design/naming-contract.md#2.2]（灵智体 Forgekin）
- [doc:features/F002-teamact-loop.md]
- [doc:features/F004-pingpong-circuit-breaker.md]
- [doc:project_rules.md#T1-T8]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.2 | 应用 9 大点名称修订 + 添加 spec.md §3.2 同号映射 | 文档员灵智体（钢笔·文心） |
