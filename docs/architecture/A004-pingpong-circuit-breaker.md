# A004: 乒乓球熔断器（PingPong Circuit Breaker）架构设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.2]（FR-CORE-002，对应 FR-CORE-018）
> **对应 arch.md**: [doc:../arch.md#§3.2]
> **对应 design.md**: [doc:../design.md#§3.2]（待创建）
> **对应 Feature**: [doc:../features/F004-pingpong-circuit-breaker.md]（同号 Feature 级 SRS）
> **对应详细设计**: [doc:../design/D004-pingpong-circuit-breaker.md]（待创建，同号 Feature 级 SDD）
> **依赖 ADR**: [doc:../decisions/002-collaboration-protocol.md]

---

## 1. 架构上下文

### 1.1 架构问题

FlowForge 在架构层需要解决"多 Forgekin（Evolvable Agent，社区社交称'灵智体'）协作中最隐蔽的失败模式：两个Forgekin互相传但都不干活"的检测问题。当前 v7.0 无"乒乓球熔断器"，导致：

1. 两个Forgekin可能无限互传"你看一下""我看看"，消耗 token 无产出
2. F002 骨架仅用 `max_iterations` 次数判定，会误杀合理的多轮 review 辩论
3. 熔断触发后无升级 CVO 机制，团队陷入死循环无人介入
4. 缺少"实质产出"判定标准，无法区分"密集协作"与"空传"

乒乓球熔断器在架构层是 TeamAct ACTION/ROUTE 步的运行时守护，是 Build to Persist 的协作协议资产。

### 1.2 架构约束

- **单向依赖约束**：`flowforge/core/teamact/circuit_breaker.py` 不可 import forgemind 或 *Forge 模块
- **DI 容器约束**：PingPongCircuitBreaker 通过构造函数注入 TeamActState 监听器
- **Repository 层约束**：熔断状态必须通过 Repository 持久化（进程崩溃后状态可恢复）
- **配置驱动约束**：max_empty_passes / min_output_chars / min_tool_calls 外置到 `flowforge/config/teamact.yaml`
- **Debate 豁免约束**：debate_mode 豁免必须显式声明，不可静默启用
- **Magic Words 约束**：熔断状态不可绕过 Magic Words 逃生舱（F011），operator 可随时拉闸

### 1.3 架构影响

- **对 TeamAct（A002）的影响**：熔断触发时冻结 TeamActState，禁继续推进
- **对 Handoff Capsule（A003）的影响**：胶囊的 has_substantive_output 判定依赖 evidence_refs 与产出字符数
- **对 Evidence & Sensors（A009）的影响**：熔断触发写 Eval 信号，归因矩阵消费
- **对 Ball Custody Lease（A006）的影响**：lease held 期间无工具调用 + 无产出计入空传
- **对 Eval 自代谢（A018-A020）的影响**：熔断触发频率是协作效率的核心信号
- **对分布式可靠性（A021-A025）的影响**：熔断状态走 WAL，进程崩溃可恢复

---

## 2. 架构设计

### 2.1 组件架构图

```
┌────────────────────────────────────────────────────────────────────┐
│                TeamAct ACTION/ROUTE 步 (A002)                     │
│   持球Forgekin执行动作 → 传球 (Route)                                │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ PassRecord
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│          flowforge/core/teamact/circuit_breaker.py (本 Feature)   │
│  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────────┐  │
│  │ PassRecord       │  │ PingPongState    │  │ PingPongCircuit │  │
│  │ (持球期产出记录) │  │ (空传计数+状态) │  │ Breaker         │  │
│  └─────────┬────────┘  └─────────┬────────┘  └────────┬────────┘  │
│            │                     │                    │           │
│            ▼                     ▼                    ▼           │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │   SubstantiveOutputDetector (实质产出判定)                  │  │
│  │   - tool_calls > 0  OR  output_chars >= min_output_chars   │  │
│  └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────────┬───────────────────────────────────┘
                                 │ BreakerVerdict
                                 ▼
              ┌──────────────────┴──────────────────┐
              │                                     │
       verdict=PASS                          verdict=TRIPPED
              │                                     │
              ▼                                     ▼
   计数归零, 继续 TeamAct          冻结 TeamActState + 写 Eval 信号
                                  + 升级 CVO 仲裁 + 通知 reviewer
```

### 2.2 关键架构决策

- **决策 1：看实质工具调用而非传球次数**
  理由：roleagent.md 第 2 章明确"看每次传球是否伴随实质工具调用和有内容输出"。次数判定会误杀合理的多轮 review 辩论（review 辩论可能 5 轮才收敛）。

- **决策 2：连续空传 ≥ 3 次触发熔断（max_empty_passes=3）**
  理由：单次空传可能是Forgekin在思考，2 次可能是协作节奏未建立，3 次连续空传基本可判定为"互传无产出"模式。阈值可配置。

- **决策 3：debate_mode 显式豁免（仍记录 trace）**
  理由：review 辩论场景允许密集传球，但必须显式声明 debate_mode=true。豁免判定但仍记录 trace，避免豁免被滥用。

- **决策 4：熔断触发强制升级 CVO（不可静默恢复）**
  理由：熔断是协作失败信号，必须由 CVO 决定 push back（要求原 owner 重做）或换 owner。reset 必须由 CVO 确认，禁Forgekin自恢复。

- **决策 5：熔断状态走 WAL（进程崩溃可恢复）**
  理由：熔断状态若进程内持有，进程崩溃后状态丢失，团队可能重复触发熔断。必须持久化到 Durable Surface，走 Tier 2 恢复分级。

- **决策 6：每次有实质产出则空传计数归零（非递减）**
  理由：连续空传是关键信号。中间有一次实质产出，说明协作仍在推进，计数应归零而非递减。

### 2.3 架构不变量

- 实质产出判定必须基于 `tool_calls > 0 OR output_chars >= min_output_chars`，禁Forgekin自评
- 连续空传计数达到 max_empty_passes（默认 3）必须触发熔断，禁配置关闭
- 熔断触发后 TeamActState 必须冻结，禁继续推进
- 熔断状态必须通过 Repository 持久化，走 WAL 可重放
- debate_mode 豁免必须显式声明，仍记录 trace
- 熔断恢复（reset）必须由 CVO 确认，禁Forgekin自恢复
- 熔断触发必须写 Eval 信号 + 升级 CVO + 通知 reviewer

---

## 3. 模块设计

### 3.1 模块边界

- **circuit_breaker.py::PassRecord** — 持球期产出记录数据模型（工具调用 + 产出字符 + 证据引用）。
- **circuit_breaker.py::PingPongState** — 熔断状态机（open / warning / tripped）+ 空传计数。
- **circuit_breaker.py::PingPongCircuitBreaker** — 熔断器主类（evaluate_pass / should_trip / trip / reset）。
- **circuit_breaker.py::SubstantiveOutputDetector** — 实质产出判定器（tool_calls + output_chars）。
- **infra/repo/sqlite_pingpong_store.py** — SQLite 实现（WAL 可重放）。
- **tests/** — 单元 + 集成 + E2E（T1-T8 铁律）。

### 3.2 接口契约

```python
from abc import ABC, abstractmethod
from typing import Literal, Optional
from pydantic import BaseModel, Field
from datetime import datetime


class PassRecord(BaseModel):
    """持球期产出记录（一次 Route 步对应一条）"""
    from_forgekin_id: str
    to_forgekin_id: str
    iteration: int
    tool_calls: list[str] = Field(default_factory=list)  # 本次持球期间工具调用 ID
    output_chars: int = 0                                # 本次持球期间产出字符数
    evidence_refs: list[str] = Field(default_factory=list)  # 关联 F009 证据 ID
    has_substantive_output: bool = False                 # 由 SubstantiveOutputDetector 判定
    debate_mode: bool = False                            # 显式声明辩论豁免


class PingPongState(BaseModel):
    """熔断状态机"""
    team_id: str
    consecutive_empty_passes: int = 0
    max_empty_passes: int = 3
    history: list[PassRecord] = Field(default_factory=list)
    status: Literal["open", "warning", "tripped"] = "open"
    tripped_at: Optional[datetime] = None
    tripped_reason: Optional[str] = None


class PingPongCircuitBreaker(ABC):
    """乒乓球熔断器 — 实质产出判定 + 空传计数 + 熔断升级"""

    @abstractmethod
    async def evaluate_pass(self, record: PassRecord) -> "BreakerVerdict":
        """评估本次传球是否计入空传

        架构契约:
        - 实质产出判定: tool_calls > 0 OR output_chars >= min_output_chars
        - 有实质产出则计数归零
        - 无实质产出则计数 +1
        - 达到 max_empty_passes 触发熔断
        """

    @abstractmethod
    async def should_trip(self, team_id: str) -> bool:
        """检查是否应触发熔断"""

    @abstractmethod
    async def trip(self, team_id: str, reason: str) -> None:
        """触发熔断

        架构契约:
        - 冻结 TeamActState
        - 写 Eval 信号
        - 升级 CVO 仲裁
        - 通知 reviewer
        - 持久化状态 (WAL)
        """

    @abstractmethod
    async def reset(self, team_id: str, cvo_confirmed: bool = False) -> None:
        """恢复熔断状态

        架构契约:
        - 必须由 CVO 确认 (cvo_confirmed=true)
        - Forgekin不可自恢复
        """


class SubstantiveOutputDetector(ABC):
    """实质产出判定器"""

    @abstractmethod
    async def detect(self, record: PassRecord) -> bool:
        """判定本次传球是否有实质产出

        判定标准:
        - tool_calls > 0 (有工具调用)
        - OR output_chars >= min_output_chars (有足够产出)
        """


class BreakerVerdict(BaseModel):
    """熔断判定输出"""
    action: Literal["pass", "warning", "trip"]
    consecutive_empty_passes: int
    reason: Optional[str] = None
    escalate_to_cvo: bool = False
```

### 3.3 数据流

```
TeamAct ACTION 步: 持球Forgekin执行动作
                  │
                  │ 持球期间产出: tool_calls + output_chars
                  ▼
TeamAct ROUTE 步: 持球Forgekin传球
                  │
                  │ PassRecord
                  ▼
┌──────────────────────────────────────────────────────────────┐
│ 1. SubstantiveOutputDetector.detect(record)                 │
│    - tool_calls > 0?                                         │
│    - OR output_chars >= min_output_chars?                   │
│    - debate_mode=true? (豁免)                                │
└──────────────────────────┬───────────────────────────────────┘
                           │ has_substantive_output
                           ▼
┌──────────────────────────────────────────────────────────────┐
│ 2. PingPongCircuitBreaker.evaluate_pass(record)             │
│    - 有实质产出 → 计数归零, status=open                      │
│    - 无实质产出 → 计数 +1, status=warning (count >= 2)       │
│    - 计数 >= max_empty_passes → 触发熔断, status=tripped     │
└──────────────────────────┬───────────────────────────────────┘
                           │ BreakerVerdict
                           ▼
              ┌────────────┴────────────┐
              │                         │
        verdict=PASS/WARNING     verdict=TRIP
              │                         │
              ▼                         ▼
       继续 TeamAct 循环       ┌──────────────────────────────┐
                                │ 3. PingPongCircuitBreaker.trip │
                                │    - 冻结 TeamActState         │
                                │    - 写 Eval 信号 (F018)       │
                                │    - 升级 CVO 仲裁              │
                                │    - 通知 reviewer             │
                                │    - 持久化 WAL (F021)         │
                                └──────────────────────────────┘
                                          │
                                          ▼
                                ┌──────────────────────────────┐
                                │ 4. CVO 决策                   │
                                │    - push back 原 owner 重做  │
                                │    - 或换 owner               │
                                │    - 或 reset (cvo_confirmed) │
                                └──────────────────────────────┘
```

---

## 4. 跨模块协作

### 4.1 上游依赖

- **F002 TeamAct Loop** — 监听 ACTION/ROUTE 步的 PassRecord
- **F003 Handoff Capsule** — 胶囊的 has_substantive_output 判定依赖 evidence_refs 与产出字符数
- **F009 Evidence & Sensors** — 工具调用与产出字符的证据来源

### 4.2 下游影响

- **F002 TeamAct Loop** — 熔断触发时冻结 TeamActState
- **F006 Ball Custody Lease** — lease held 期间无实质产出计入空传
- **F018 Eval Contract** — 熔断触发频率是协作效率信号
- **F021 Side Effect WAL** — 熔断状态走 WAL 可重放

### 4.3 跨模块不变量

- 熔断状态必须与 TeamActState.status 一致（tripped 时 TeamActState 冻结）
- 熔断触发必须广播事件到 EventBus，Eval 控制面可感知
- debate_mode 豁免必须由Forgekin显式声明，trace 仍记录
- 熔断恢复必须由 CVO 确认，禁Forgekin自恢复
- 熔断状态走 WAL，进程崩溃后状态可恢复

---

## 5. 架构验收

### 5.1 架构契约验收

- [ ] AC-1: `flowforge/core/teamact/circuit_breaker.py` 不 import forgemind 或 *Forge 模块
- [ ] AC-2: PingPongCircuitBreaker 通过 DI 容器注入，无直接实例化
- [ ] AC-3: 熔断状态通过 Repository 持久化（无 cursor.execute）
- [ ] AC-4: max_empty_passes / min_output_chars / min_tool_calls 外置到 `flowforge/config/teamact.yaml`
- [ ] AC-5: 熔断状态走 WAL（F021 联动）

### 5.2 架构不变量验收

- [ ] AC-6: 实质产出判定基于 `tool_calls > 0 OR output_chars >= min_output_chars`，禁Forgekin自评
- [ ] AC-7: 连续空传达 max_empty_passes 触发熔断，禁配置关闭
- [ ] AC-8: 熔断触发后 TeamActState 冻结，禁继续推进
- [ ] AC-9: debate_mode 豁免必须显式声明，trace 仍记录
- [ ] AC-10: reset 必须由 CVO 确认（cvo_confirmed=true），禁Forgekin自恢复
- [ ] AC-11: 熔断触发写 Eval 信号 + 升级 CVO + 通知 reviewer

---

## 6. 引用

- [doc:../spec.md#§3.2]（FR-CORE-002，FR-CORE-018 乒乓球熔断器）
- [doc:../arch.md#§3.2]（TeamAct 六步循环，乒乓球熔断器）
- [doc:../features/F004-pingpong-circuit-breaker.md]（同号 Feature 级 SRS）
- [doc:../features/F002-teamact-loop.md]（TeamAct ACTION/ROUTE 步触发判定）
- [doc:../features/F003-handoff-capsule.md]（has_substantive_output 判定依据）
- [doc:../features/F009-evidence-sensors.md]（工具调用与产出字符证据源）
- [doc:../features/F006-ball-custody-lease.md]（lease 期间空传联动）
- [doc:../decisions/002-collaboration-protocol.md]（TeamAct 协作协议 ADR）
- [doc:../../CONTRIBUTING.md]（文档分层规范）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（架构骨架，对应 F004 Feature 级 SRS） | 架构师 Forgekin（猫头鹰·鲁班） |
