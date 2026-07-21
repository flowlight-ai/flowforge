# A002: TeamAct 六步循环架构设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.2]（FR-CORE-002）
> **对应 arch.md**: [doc:../arch.md#§3.2]
> **对应 design.md**: [doc:../design.md#§3.2]（待创建）
> **对应 Feature**: [doc:../features/F002-teamact-loop.md]（同号 Feature 级 SRS）
> **对应详细设计**: [doc:../design/D002-teamact-loop.md]（待创建，同号 Feature 级 SDD）
> **依赖 ADR**: [doc:../decisions/002-collaboration-protocol.md]

---

## 1. 架构上下文

### 1.1 架构问题

FlowForge 在架构层需要解决"多 Forgekin（Evolvable Agent，社区社交称'灵智体'）协作如何形式化终止"的根本问题。当前协作基于 EventBus + Handoff，存在三大架构缺陷：

1. **无团队级终止条件** — Forgekin互相传球可以永远循环，没有"团队停下来"机制；单Forgekin判断"做完了"经常是 RLHF 训练出的收尾惯性幻觉
2. **交接信息缺失** — 前一个Forgekin只传任务 ID 与状态枚举，接手Forgekin必须重读全部上下文，token 成本爆炸
3. **协作失败模式无防护** — 乒乓球互传、球掉地、reviewer 错判等失败模式无协议层防护

TeamAct 六步循环 + 五项终止条件 + 交接胶囊 + 乒乓球熔断器 + 行首 @ 路由 + 持球注册 lease + Generator Push Back 是 roleagent.md 第 2 章提出的工程化闭环，是 FlowForge 与普通 multi-agent 框架的根本差异。

### 1.2 架构约束

- **单向依赖约束**：`flowforge/core/teamact/` 不可 import forgemind 或 *Forge 模块
- **DI 容器约束**：TeamActState 必须通过 SharedStateLedger 注入，禁直接实例化
- **Repository 层约束**：TeamAct 状态必须通过 Repository 持久化到 Durable State Surfaces（F008）
- **配置驱动约束**：max_iterations / termination 阈值 / debate 轮次上限外置到 `flowforge/config/teamact.yaml`
- **LoopExecutor 约束**：所有 TeamAct 执行必须通过 LoopExecutor（P31 铁律），质量分阈值 0.85
- **治理注入约束**：TeamAct 治理规则必须沉到 native system role（F010 压缩免疫），禁 user message prepend
- **Magic Words 约束**：TeamAct 不可绕过 Magic Words 逃生舱（F011），任何阶都可被 operator 打断

### 1.3 架构影响

- **对 CapabilityProfile（A001）的影响**：Owner 步依赖 CapabilityRouter 选定持球者，跨厂商 review 配对依赖盲点不重叠
- **对 Harness（A008-A013）的影响**：TeamAct 状态必须持久化到 6 类 Durable Surface，治理规则沉到压缩免疫层
- **对分布式可靠性（A021-A025）的影响**：SharedStateLedger 走 Tier 2 恢复分级，进程崩溃可检查点恢复
- **对 Eval 自代谢（A018-A020）的影响**：TeamAct 状态推进日志是 trace 信号主要来源，归因矩阵消费 TeamAct 失败模式
- **对 forgemind（A026）的影响**：ForgekinEngine 是 HarnessOrchestrator 的装饰器，TeamAct 是 ForgekinEngine 的核心协议

---

## 2. 架构设计

### 2.1 组件架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       forgemind 应用层 (Layer 2)                        │
│   ForgekinEngine (装饰 HybridExecutor + HarnessOrchestrator)            │
│                  ↓ 调用 TeamAct 协议                                    │
└─────────────────────────────┬───────────────────────────────────────────┘
                              │ DI 注入
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                   FlowForge 核心框架层 (Layer 1)                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │              core/teamact/ (本 Feature 模块)                      │  │
│  │                                                                   │  │
│  │   ┌────────────────┐    ┌────────────────┐    ┌──────────────┐    │  │
│  │   │ state_machine  │───►│  handoff.py    │    │ termination │    │  │
│  │   │ .py            │    │ HandoffCapsule │    │ .py         │    │  │
│  │   │ TeamActState   │    │ (五段协议)     │    │ 五项终止     │    │  │
│  │   └────────┬───────┘    └────────┬───────┘    └──────┬───────┘    │  │
│  │            │                     │                   │            │  │
│  │            ▼                     ▼                   ▼            │  │
│  │   ┌──────────────────────────────────────────────────────────┐    │  │
│  │   │           SharedStateLedger (单一真相源)                  │    │  │
│  │   │  - 当前 step / owner / iteration / termination            │    │  │
│  │   │  - handoff_capsules 链                                    │    │  │
│  │   │  - evidence_refs                                          │    │  │
│  │   └────────────────────────┬─────────────────────────────────┘    │  │
│  └───────────────────────────┼───────────────────────────────────────┘  │
│                              ▼                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │   loop/teamact/ (TeamAct 执行引擎，依赖 LoopExecutor)            │   │
│  │   - TeamActLoopExecutor (装饰 LoopExecutor)                     │   │
│  │   - 与 F004 circuit_breaker / F006 lease 联动                   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                              ▲
                              │ 依赖
                              │
       ┌──────────────────────┼─────────────────────┐
       │                      │                     │
  ┌────┴──────┐         ┌─────┴─────┐         ┌────┴──────┐
  │ F001      │         │ F008      │         │ F009      │
  │ Capability│         │ Durable   │         │ Evidence  │
  │ Profile   │         │ State     │         │ & Sensors │
  │ (路由)    │         │ (持久化)  │         │ (证据)    │
  └───────────┘         └───────────┘         └───────────┘
```

### 2.2 关键架构决策

- **决策 1：TeamAct 不是 Anthropic 第六种协作模式，是 Shared State 模式的工程化闭环**
  理由：roleagent.md 第 2 章明确主张。Shared State 模式要求显式状态机 + 五项终止 + 交接胶囊，不是"Forgekin自由协作 + Eval 事后归因"。

- **决策 2：六步循环必须分形嵌套（系统层 / 团队层 / 个体层）**
  理由：Feature 生命周期（系统层）→ Forgekin间交接（团队层）→ 单Forgekin工具调用（个体层）每层都跑同一六步循环，避免协议断层。

- **决策 3：五项终止条件缺一不可（不允许任一项缺失）**
  理由：roleagent.md 明确"CI 通过了 ≠ 愿景方向对了"。验收标准全部达成 + 证据已附 + 跨 agent 交叉验证 + 无悬空任务归属 + 愿景收敛，五项都必须显式判定。

- **决策 4：交接胶囊是协议层硬要求，不是可选礼貌**
  理由：前一个Forgekin传球时若不留下 What/Why/Tradeoff/Open/Next 五段结构化摘要，接手Forgekin必须重读完整上下文，token 成本不可接受。

- **决策 5：SharedStateLedger 是单一真相源（Single Source of Truth）**
  理由：TeamAct 状态分散在多处会导致一致性灾难。所有 step / owner / iteration / termination 必须由 SharedStateLedger 统一持有，走 Tier 2 恢复分级。

- **决策 6：TeamAct 治理规则必须沉到 native system role（压缩免疫）**
  理由：若用 user message prepend 注入治理规则，上下文压缩后规则消失，Forgekin后半段突然违规（F010 RA-019 P0 问题）。

### 2.3 架构不变量

- TeamAct 状态必须持久化到 Durable State Surfaces（禁进程内变量持有真相）
- 五项终止条件任一未满足都必须判定为"未终止"，禁止跳过
- 交接胶囊五段字段任一为空即抛 SchemaError
- 跨 agent 交叉验证必须验证 reviewer ≠ author（禁自己 review 自己）
- TeamAct 治理规则必须注入 native system role，禁 user message prepend
- SharedStateLedger 必须走 Tier 2 恢复分级（WAL 可重放）
- TeamAct 执行必须通过 LoopExecutor，质量分阈值 0.85（嵌套深度 ≤ 3）
- Magic Words 逃生舱在 TeamAct 任何 step 都可触发，不可绕过

---

## 3. 模块设计

### 3.1 模块边界

- **core/teamact/state_machine.py** — TeamActState 状态机（六步循环推进 + 终止判定）。仅持有协议状态，不持有业务数据。
- **core/teamact/handoff.py** — HandoffCapsule 五段协议（Schema 校验 + 链上回放）。详见 A003。
- **core/teamact/termination.py** — TerminationCondition 五项终止条件（缺一不可判定）。
- **core/teamact/shared_state.py** — SharedStateLedger 单一真相源（Repository 层抽象 + 实现）。
- **loop/teamact/executor.py** — TeamActLoopExecutor（装饰 LoopExecutor，集成 F004 熔断器 + F006 lease）。
- **core/teamact/tests/** — 单元 + 集成 + E2E（T1-T8 铁律，真实 LLM + 真实数据 + 真实工具调用）。

### 3.2 接口契约

```python
from abc import ABC, abstractmethod
from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field
from datetime import datetime


class TeamActStep(str, Enum):
    """TeamAct 六步状态（分形嵌套：系统层 / 团队层 / 个体层）"""
    STATE = "state"        # 读共享状态
    OWNER = "owner"        # 谁持球（路由指令 / 显式持有声明）
    ACTION = "action"      # 持球者执行
    EVIDENCE = "evidence"  # 产出证据
    VERDICT = "verdict"    # 验证（跨 agent review）
    ROUTE = "route"        # 传球（路由给下一个 / 继续 / 升级 CVO）


class TerminationCondition(BaseModel):
    """五项终止条件（缺一不可）"""
    acceptance_criteria_met: bool = False      # 1. 验收标准全部达成（无 deferred）
    evidence_attached: bool = False            # 2. 证据已附
    cross_agent_verified: bool = False         # 3. 跨 agent 交叉验证（reviewer != author）
    no_dangling_ownership: bool = False        # 4. 无悬空任务归属
    vision_converged: bool = False             # 5. 愿景收敛（CVO 确认，不可被 proxy 替代）

    def all_met(self) -> bool:
        """任一项 False 即未终止"""
        return all([
            self.acceptance_criteria_met,
            self.evidence_attached,
            self.cross_agent_verified,
            self.no_dangling_ownership,
            self.vision_converged,
        ])


class TeamActState(BaseModel):
    """TeamAct 状态机 — 协议层硬要求"""
    team_id: str
    current_step: TeamActStep = TeamActStep.STATE
    current_owner: Optional[str] = None      # 持球 forgekin_id
    iteration: int = 0
    termination: TerminationCondition = Field(default_factory=TerminationCondition)
    handoff_capsules: list["HandoffCapsule"] = Field(default_factory=list)
    evidence_refs: list[str] = Field(default_factory=list)
    schema_version: str = "1.0"


class SharedStateLedger(ABC):
    """TeamAct 单一真相源 — 走 Tier 2 恢复分级（WAL 可重放）"""

    @abstractmethod
    async def load(self, team_id: str) -> Optional[TeamActState]:
        """加载团队状态"""

    @abstractmethod
    async def persist(self, state: TeamActState) -> None:
        """持久化状态（必须通过 Repository 层）"""

    @abstractmethod
    async def advance(
        self,
        team_id: str,
        capsule: Optional["HandoffCapsule"] = None,
    ) -> TeamActState:
        """推进到下一步（六步循环）"""

    @abstractmethod
    async def check_termination(self, team_id: str) -> bool:
        """检查是否满足五项终止条件"""


class TeamActLoopExecutor(ABC):
    """装饰 LoopExecutor，注入 TeamAct 协议"""

    @abstractmethod
    async def run_step(
        self,
        team_id: str,
        step: TeamActStep,
        context: dict,
    ) -> "StepResult":
        """执行单步（必须通过 LoopExecutor，质量分阈值 0.85）"""
```

### 3.3 数据流

```
任务进入 (TaskContext + 候选 forgekin_id 列表)
                  │
                  ▼
┌──────────────────────────────────────────────────────────────┐
│ STATE 步: SharedStateLedger.load(team_id)                    │
│   - 读 feature spec / git / task queue / thread trace        │
│   - 读 memory federation / 上一 handoff_capsule              │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│ OWNER 步: CapabilityRouter.route(task, candidates) (F001)    │
│   - 写入 TeamActState.current_owner                          │
│   - 触发 F006 BallCustodyLease.acquire                     │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│ ACTION 步: 持球Forgekin执行（通过 LoopExecutor）               │
│   - 写代码 / review / 设计 / 调研                            │
│   - F004 PingPongCircuitBreaker 监控实质产出                 │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│ EVIDENCE 步: EvidenceCollector.collect (F009)              │
│   - commit / 测试 / trace / screenshot / DOM diff            │
│   - 写入 TeamActState.evidence_refs                          │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│ VERDICT 步: 跨 agent review (reviewer != author)             │
│   - 跨厂商 review 配对 (基于盲点不重叠, F001)                │
│   - F007 Push Back 协议双向辩论                              │
│   - approve / blocking 二态判定 (禁 "approve 但后续再说")    │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│ ROUTE 步: 球给下一个 / 继续持有 / 升级 CVO                   │
│   - 写入 HandoffCapsule 五段 (What/Why/Tradeoff/Open/Next)   │
│   - F005 行首 @ 路由指令解析                                │
│   - 检查 TerminationCondition.all_met                      │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
              ┌────────────┴────────────┐
              │                         │
       终止条件未满足           终止条件全部满足
              │                         │
              ▼                         ▼
       回到 STATE 步            团队任务完成
       (iteration+1)           (写入 Eval 信号)
```

---

## 4. 跨模块协作

### 4.1 上游依赖

- **F001 CapabilityProfile** — Owner 步调用 `CapabilityRouter.route` 选定持球者
- **F008 Durable State Surfaces** — TeamAct 状态必须持久化到 6 类 Durable Surface
- **F009 Evidence & Sensors** — EVIDENCE 步采集证据，VERDICT 步验证证据
- **F018-F020 Eval 自代谢** — TeamAct 失败模式是七类归因矩阵的主要输入

### 4.2 下游影响

- **F003 Handoff Capsule** — ROUTE 步强制写入交接胶囊五段
- **F004 PingPong Circuit Breaker** — ACTION 步触发熔断器监控（实质产出判定）
- **F005 At-Mention Routing** — ROUTE 步行首 @ 解析路由指令
- **F006 Ball Custody Lease** — OWNER 步注册 lease，lease 过期触发球释放
- **F007 Push Back Protocol** — VERDICT 步触发双向辩论协议
- **F010 Governance Boundary** — TeamAct 治理规则沉到 native system role（压缩免疫）
- **F022 Tier 1-4 Recovery** — SharedStateLedger 走 Tier 2 恢复分级

### 4.3 跨模块不变量

- TeamActState.current_owner 必须与 CapabilityRouter 选定的 forgekin_id 一致
- TeamActState.evidence_refs 必须与 F009 Evidence Store 中的记录一致
- HandoffCapsule.author_forgekin_id 必须与上一任 TeamActState.current_owner 一致
- VERDICT 步的 reviewer 必须满足 BlindSpotOverlapReport.overlap_score < 0.3
- TeamAct 任何 step 都可被 Magic Words 打断，打断后状态必须持久化（不可丢）

---

## 5. 架构验收

### 5.1 架构契约验收

- [ ] AC-1: `flowforge/core/teamact/` 不 import forgemind 或 *Forge 模块（单向依赖通过）
- [ ] AC-2: TeamActState 通过 SharedStateLedger 注入，无直接实例化
- [ ] AC-3: TeamAct 状态通过 Repository 层持久化到 Durable State Surfaces（无 cursor.execute）
- [ ] AC-4: max_iterations / termination 阈值外置到 `flowforge/config/teamact.yaml`
- [ ] AC-5: TeamAct 通过 LoopExecutor 执行，质量分阈值 0.85，嵌套深度 ≤ 3
- [ ] AC-6: TeamAct 治理规则注入 native system role（无 user message prepend）

### 5.2 架构不变量验收

- [ ] AC-7: 五项终止条件任一未满足时 `TerminationCondition.all_met == False`
- [ ] AC-8: 交接胶囊五段字段任一为空时抛 SchemaError
- [ ] AC-9: 跨 agent 交叉验证 reviewer == author 时拒绝写入 verdict
- [ ] AC-10: SharedStateLedger 走 Tier 2 恢复（WAL 可重放，进程崩溃状态可恢复）
- [ ] AC-11: Magic Words 逃生舱在 TeamAct 任何 step 触发后状态持久化（F011 联动）
- [ ] AC-12: TeamAct 终止条件达成率 ≥ 90%（基于 Eval 信号）
- [ ] AC-13: 交接胶囊完整率 100%（五段字段全非空）
- [ ] AC-14: 状态推进延迟 < 50ms（P99）

---

## 6. 引用

- [doc:../spec.md#§3.2]（FR-CORE-002 TeamAct 六步循环）
- [doc:../arch.md#§3.2]（TeamAct 六步循环 + 五项终止条件）
- [doc:../features/F002-teamact-loop.md]（同号 Feature 级 SRS）
- [doc:../features/F003-handoff-capsule.md]（交接胶囊 Feature）
- [doc:../features/F004-pingpong-circuit-breaker.md]（乒乓球熔断器 Feature）
- [doc:../features/F005-at-mention-routing.md]（行首 @ 路由 Feature）
- [doc:../features/F006-ball-custody-lease.md]（持球注册 lease Feature）
- [doc:../features/F007-push-back-protocol.md]（Push Back 协议 Feature）
- [doc:../decisions/002-collaboration-protocol.md]（TeamAct 协作协议 ADR）
- [doc:../decisions/004-capability-profile-routing.md]（跨厂商 review 配对依据）
- [doc:../decisions/010-distributed-reliability.md]（SharedStateLedger Tier 2 恢复）
- [doc:../../../hiclaw/rules.md#第十一部分]（文档分层规范）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（架构骨架，对应 F002 Feature 级 SRS） | 架构师 Forgekin（猫头鹰·鲁班） |
