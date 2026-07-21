# A006: 持球注册 Lease（Ball Custody Lease）架构设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.2]（FR-CORE-002，对应 FR-CORE-016）
> **对应 arch.md**: [doc:../arch.md#§3.2]
> **对应 design.md**: [doc:../design.md#§3.2]（待创建）
> **对应 Feature**: [doc:../features/F006-ball-custody-lease.md]（同号 Feature 级 SRS）
> **对应详细设计**: [doc:../design/D006-ball-custody-lease.md]（待创建，同号 Feature 级 SDD）
> **依赖 ADR**: [doc:../decisions/002-collaboration-protocol.md]

---

## 1. 架构上下文

### 1.1 架构问题

FlowForge 在架构层需要解决"Forgekin（Evolvable Agent，社区社交称'灵智体'）退出会话等待外部条件时如何保持球不落地"的根本问题。当前 v7.0 无持球注册机制，导致：

1. Forgekin退出会话后球就掉地上，其他Forgekin不知道任务还在不在有人管
2. CI 等待期间任务处于"薛定谔状态"，无人知道是否还有 owner
3. 长时间任务（如 claude code 跑完整测试套件 10 分钟）无法被协作流正确承载
4. TeamAct "无悬空任务归属"终止条件无法验证（不知道球在哪）

持球注册 lease 在架构层是 TeamAct 协作协议的分布式 lease + 定时唤醒机制，是 Build to Persist 的协作协议资产。

### 1.2 架构约束

- **单向依赖约束**：`flowforge/core/teamact/lease.py` 不可 import forgemind 或 *Forge 模块
- **DI 容器约束**：BallCustodyRegistry 通过构造函数注入 WakeupScheduler
- **Repository 层约束**：lease 状态必须通过 Repository 持久化（进程崩溃可恢复）
- **配置驱动约束**：default_ttl_seconds / max_renewals / renewal_extension_seconds 外置到 `flowforge/config/teamact.yaml`
- **TTL 约束**：lease 必须有 TTL，到期未续约自动释放（禁永久持有）
- **续约上限约束**：续约次数超 max_renewals 强制释放并升级 CVO（防僵尸持球）
- **Magic Words 约束**：lease 不可绕过 Magic Words 逃生舱（F011），operator "星星罐子"可强制释放

### 1.3 架构影响

- **对 TeamAct（A002）的影响**：lease 释放后球回 TeamActState 可被接管，是"无悬空任务归属"判定依据
- **对 At-Mention Routing（A005）的影响**：take 意图触发 lease 注册，pass 意图触发 lease 释放
- **对 PingPong Circuit Breaker（A004）的影响**：lease held 期间无实质产出计入空传
- **对 Handoff Capsule（A003）的影响**：lease 的 next_step 字段是唤醒后执行的依据
- **对分布式可靠性（A021-A025）的影响**：lease 状态走 WAL，进程崩溃后 lease 仍存在
- **对 Eval 自代谢（A018-A020）的影响**：lease 过期/续约/释放是 Eval 信号之一

---

## 2. 架构设计

### 2.1 组件架构图

```
┌────────────────────────────────────────────────────────────────────┐
│              TeamAct Owner 步 (A002) — take 意图                  │
│              Forgekin需要退出会话等待外部条件                        │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ BallCustodyLease
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│           flowforge/core/teamact/lease.py (本 Feature)             │
│  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────────┐  │
│  │ BallCustodyLease│  │ BallCustodyRegist│  │ WakeupScheduler │  │
│  │ (lease 数据模型) │  │ ry (ABC, 注册中心)│  │ (定时唤醒回调)  │  │
│  └─────────┬────────┘  └─────────┬────────┘  └────────┬────────┘  │
│            │                     │                    │           │
│            ▼                     ▼                    ▼           │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │   LeaseLifecycleManager (生命周期: held→renewed→released)    │  │
│  │   - TTL 续约                                                 │  │
│  │   - 超时释放 (expired)                                       │  │
│  │   - 强制撤销 (revoked, Magic Words 触发)                     │  │
│  └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────────┬───────────────────────────────────┘
                                 │ WakeupEvent
                                 ▼
              ┌──────────────────┬──────────────────┐
              │                 │                  │
       ci_green          cvo_confirm             timer
              │                 │                  │
              ▼                 ▼                  ▼
       唤醒持球Forgekin执行 lease.next_step
              │
              ▼
       继续持球 OR 释放球 (释放后 TeamActState 可被接管)
```

### 2.2 关键架构决策

- **决策 1：lease 必须有 TTL（默认 30 分钟）**
  理由：roleagent.md 第 2 章明确"相当于分布式系统里的 lease + 定时唤醒"。无 TTL 则Forgekin可永久持球，僵尸持球无法被回收。

- **决策 2：续约次数上限（max_renewals=3）**
  理由：续约次数过多说明任务规模超出预期，应升级 CVO 重新规划，而非无限续约。

- **决策 3：TTL 到期未续约自动释放（球回 TeamAct）**
  理由：Forgekin崩溃或忘记续约时，球必须自动回到 TeamActState 可被其他Forgekin接管，避免悬空。

- **决策 4：WakeupScheduler 监听多种唤醒源（CI/CVO/timer/external）**
  理由：等待条件多样，CI 绿、CVO 确认、定时器、外部事件都应能唤醒持球Forgekin。

- **决策 5：lease held 期间空传计入 F004 熔断器**
  理由：lease 是声明等待，不是"无限期不干活"。lease held 期间若无工具调用 + 无产出，仍可能是僵尸持球，需 F004 监控。

- **决策 6：lease 走 WAL，进程崩溃后状态可恢复**
  理由：lease 是 TeamAct 状态的一部分，必须走 Tier 2 恢复分级。进程崩溃后 lease 仍在，TTL 计时持续，避免重复注册。

### 2.3 架构不变量

- lease 必须有 TTL（默认 1800 秒），到期未续约自动释放
- 续约次数超 max_renewals（默认 3）强制释放并升级 CVO
- lease 必须通过 Repository 持久化，走 WAL 可重放
- 一Forgekin同时只能持有一个 lease（禁多球同时持）
- WakeupEvent 触发时必须唤醒对应持球Forgekin执行 next_step
- lease held 期间空传计入 F004 PingPongCircuitBreaker
- Magic Words "星星罐子"可强制撤销 lease（operator 拉闸权）
- lease 释放后必须广播事件到 EventBus，TeamActState 可感知接管

---

## 3. 模块设计

### 3.1 模块边界

- **lease.py::BallCustodyLease** — lease 数据模型（forgekin_id + reason + next_step + expected_wake_at + ttl + status）。
- **lease.py::WakeupEvent** — 唤醒事件数据模型（trigger + fired_at + payload）。
- **lease.py::BallCustodyRegistry (ABC)** — lease 注册中心抽象（acquire / renew / release / list_active）。
- **lease.py::WakeupScheduler** — 定时唤醒调度器（监听 CI/CVO/timer/external）。
- **lease.py::LeaseLifecycleManager** — 生命周期管理器（TTL 续约 + 超时释放 + 强制撤销）。
- **infra/repo/sqlite_lease_store.py** — SQLite 实现（WAL 可重放）。
- **tests/** — 单元 + 集成 + E2E（T1-T8 铁律）。

### 3.2 接口契约

```python
from abc import ABC, abstractmethod
from typing import Literal, Optional
from pydantic import BaseModel, Field
from datetime import datetime


class BallCustodyLease(BaseModel):
    """持球注册 lease — 分布式 lease + 定时唤醒"""
    lease_id: str
    team_id: str
    forgekin_id: str                # 持球Forgekin
    reason: str                     # 等待原因 (CI/CVO/timer/external)
    next_step: str                  # 唤醒后下一步
    expected_wake_at: datetime      # 预期唤醒时间
    acquired_at: datetime = Field(default_factory=datetime.now)
    ttl_seconds: int = 1800         # lease TTL
    status: Literal["held", "renewed", "released", "expired", "revoked"] = "held"
    renewal_count: int = 0
    max_renewals: int = 3
    fallback_owner: Optional[str] = None  # lease 过期后的兜底 owner


class WakeupEvent(BaseModel):
    """唤醒事件"""
    lease_id: str
    trigger: Literal["ci_green", "cvo_confirm", "timer", "external"]
    fired_at: datetime = Field(default_factory=datetime.now)
    payload: dict = Field(default_factory=dict)


class BallCustodyRegistry(ABC):
    """持球注册中心 — 单一真相源"""

    @abstractmethod
    async def acquire(self, lease: BallCustodyLease) -> str:
        """注册 lease

        架构契约:
        - 一Forgekin同时只能持有一个 lease (禁多球)
        - 持久化到 Repository 层 (WAL 可重放)
        - 启动 TTL 计时器
        - 注册 WakeupScheduler 监听
        """

    @abstractmethod
    async def renew(self, lease_id: str, extension_seconds: int) -> None:
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
        - 球回 TeamActState (可被其他Forgekin接管)
        - 广播事件到 EventBus
        """

    @abstractmethod
    async def list_active(self, team_id: str) -> list[BallCustodyLease]:
        """列出团队所有活跃 lease"""


class WakeupScheduler(ABC):
    """定时唤醒调度器"""

    @abstractmethod
    def schedule(self, lease: BallCustodyLease) -> None:
        """调度唤醒

        架构契约:
        - 监听 ci_green / cvo_confirm / timer / external 四种源
        - 触发时唤醒持球Forgekin执行 lease.next_step
        """

    @abstractmethod
    async def fire(self, event: WakeupEvent) -> None:
        """触发唤醒事件"""


class LeaseLifecycleManager(ABC):
    """lease 生命周期管理器"""

    @abstractmethod
    async def check_ttl_expiry(self) -> list[str]:
        """检查 TTL 过期 lease

        架构契约:
        - TTL 到期未续约自动释放 (status=expired)
        - 球回 TeamActState
        - 写 Eval 信号
        """

    @abstractmethod
    async def force_revoke(self, lease_id: str, reason: str) -> None:
        """强制撤销 (Magic Words 触发)

        架构契约:
        - 仅 operator 可触发 (Magic Words "星星罐子")
        - Forgekin不可自撤销
        """
```

### 3.3 数据流

```
TeamAct Owner 步: Forgekin需要退出会话等待外部条件
                  │
                  │ BallCustodyLease (forgekin_id + reason + next_step)
                  ▼
┌──────────────────────────────────────────────────────────────┐
│ 1. BallCustodyRegistry.acquire(lease)                       │
│    - 校验一Forgekin同时只能持有一个 lease                    │
│    - 持久化到 SQLite (WAL 可重放, F021 联动)                │
│    - 启动 TTL 计时器 (默认 30 分钟)                          │
│    - 注册 WakeupScheduler 监听                               │
└──────────────────────────┬───────────────────────────────────┘
                           │ lease_id
                           ▼
              ┌────────────┴────────────┐
              │  持球Forgekin退出会话     │
              │  等待外部条件满足       │
              └────────────┬────────────┘
                           │
              ┌────────────┴────────────┐
              │  三种可能场景            │
              └────────────┬────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
   外部条件满足        TTL 到期未续约      续约次数超限
   (ci_green/         (default 30min)    (max_renewals=3)
   cvo_confirm/
   timer)
        │                  │                  │
        ▼                  ▼                  ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│ WakeupEvent   │  │ 自动释放       │  │ 强制释放      │
│ 触发唤醒      │  │ status=expired│  │ + 升级 CVO    │
│ 执行          │  │ 球回 TeamAct  │  │ 写 Eval 信号  │
│ next_step     │  └───────────────┘  └───────────────┘
└───────┬───────┘
        │
        ▼
┌──────────────────────────────────────────────────────────────┐
│ 2. 持球Forgekin执行 lease.next_step                            │
│    - 继续 TeamAct 循环                                       │
│    - OR 释放球 (release) 让其他Forgekin接管                    │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
              ┌──────────────────────────────┐
              │ 3. 持球期间 F004 监控         │
              │    - lease held 期间无工具调用 │
              │    - + 无产出 → 计入空传      │
              └──────────────────────────────┘
```

---

## 4. 跨模块协作

### 4.1 上游依赖

- **F002 TeamAct Loop** — Owner 步触发 lease 注册，STATE 步消费 lease 状态
- **F005 At-Mention Routing** — take 意图触发 lease 注册，pass 意图触发 lease 释放
- **F003 Handoff Capsule** — lease 的 next_step 字段是唤醒后执行依据

### 4.2 下游影响

- **F002 TeamAct Loop** — lease 释放后球回 TeamActState 可被接管
- **F004 PingPong Circuit Breaker** — lease held 期间空传计入熔断
- **F011 Magic Words** — "星星罐子"可强制撤销 lease（operator 拉闸权）
- **F018 Eval Contract** — lease 过期/续约/释放是 Eval 信号
- **F021 Side Effect WAL** — lease 状态走 WAL 可重放

### 4.3 跨模块不变量

- lease.forgekin_id 必须与 TeamActState.current_owner 一致（持球期间）
- lease 释放后必须广播事件，TeamActState.current_owner 必须置为 null（可被接管）
- 一Forgekin同时只能持有一个 lease（acquire 时校验已有 lease）
- lease status=expired 时必须释放球，禁继续持有
- Magic Words "星星罐子"可绕过 max_renewals 直接撤销

---

## 5. 架构验收

### 5.1 架构契约验收

- [ ] AC-1: `flowforge/core/teamact/lease.py` 不 import forgemind 或 *Forge 模块
- [ ] AC-2: BallCustodyRegistry 通过 DI 容器注入，无直接实例化
- [ ] AC-3: lease 状态通过 Repository 持久化（无 cursor.execute）
- [ ] AC-4: default_ttl_seconds / max_renewals 外置到 `flowforge/config/teamact.yaml`
- [ ] AC-5: lease 状态走 WAL（F021 联动）

### 5.2 架构不变量验收

- [ ] AC-6: 持球Forgekin可注册 lease 并声明等待原因与唤醒时间
- [ ] AC-7: TTL 到期未续约自动释放，球回 TeamActState
- [ ] AC-8: 续约次数超 max_renewals 强制释放并升级 CVO
- [ ] AC-9: WakeupEvent 触发时正确唤醒持球Forgekin
- [ ] AC-10: lease held 期间空传计入 F004 PingPongCircuitBreaker
- [ ] AC-11: Magic Words "星星罐子"可强制撤销 lease（operator 拉闸权）
- [ ] AC-12: 一Forgekin同时只能持有一个 lease

---

## 6. 引用

- [doc:../spec.md#§3.2]（FR-CORE-002，FR-CORE-016 交接胶囊 + 持球注册 lease）
- [doc:../arch.md#§3.2]（TeamAct 六步循环，持球注册 lease）
- [doc:../features/F006-ball-custody-lease.md]（同号 Feature 级 SRS）
- [doc:../features/F002-teamact-loop.md]（TeamAct Owner 步触发 lease 注册）
- [doc:../features/F004-pingpong-circuit-breaker.md]（lease held 期间空传联动）
- [doc:../features/F005-at-mention-routing.md]（take 意图触发 lease 注册）
- [doc:../features/F011-magic-words.md]（星星罐子强制撤销 lease）
- [doc:../decisions/002-collaboration-protocol.md]（TeamAct 协作协议 ADR）
- [doc:../../../hiclaw/rules.md#第十一部分]（文档分层规范）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（架构骨架，对应 F006 Feature 级 SRS） | 架构师 Forgekin（猫头鹰·鲁班） |
