# A003: 交接胶囊（Handoff Capsule）架构设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.2]（FR-CORE-002，对应 FR-CORE-016）
> **对应 arch.md**: [doc:../arch.md#§3.2]
> **对应 design.md**: [doc:../design.md#§3.2]（待创建）
> **对应 Feature**: [doc:../features/F003-handoff-capsule.md]（同号 Feature 级 SRS）
> **对应详细设计**: [doc:../design/D003-handoff-capsule.md]（待创建，同号 Feature 级 SDD）
> **依赖 ADR**: [doc:../decisions/002-collaboration-protocol.md]

---

## 1. 架构上下文

### 1.1 架构问题

FlowForge 在架构层需要解决"Forgekin（Evolvable Agent，社区社交称'灵智体'）交接时如何让接手者快速 bootstrap"的根本问题。当前 v7.0 `handoff.py` 只传递任务 ID 和状态枚举，未实现交接胶囊的结构化内容，导致：

1. 接手Forgekin必须重读完整上下文，token 成本爆炸（长任务可达数万 token）
2. 接手Forgekin无法区分"作者已决"与"作者未决"的开放问题，反复重做已决策的权衡
3. 跨厂商 review 缺少 rationale，reviewer 误判 author 设计意图
4. TeamAct "无悬空任务归属"终止条件无法验证（开放问题状态不可追溯）

交接胶囊在架构层是 TeamAct ROUTE 步的协议层硬要求，是把"前一个Forgekin的心智状态"外部化到 Durable Surface 的工程实现。

### 1.2 架构约束

- **单向依赖约束**：`flowforge/core/teamact/handoff.py` 不可 import forgemind 或 *Forge 模块
- **DI 容器约束**：HandoffCapsuleStore 通过构造函数注入，禁直接实例化
- **Repository 层约束**：胶囊持久化必须通过 Repository 抽象，禁直操作数据库
- **配置驱动约束**：max_open_questions / retention_days / enforce_blind_spot_hints 外置到 `flowforge/config/teamact.yaml`
- **Schema 校验约束**：五段字段任一为空必须抛 SchemaError，禁宽松写入
- **Durable Surface 约束**：胶囊是 6 类 Durable Surface 之一（authority_level=2，compression_immune=true），不可降级为进程内缓存
- **盲点注入约束**：blind_spot_hints 必须从 F001 CapabilityProfile 自动注入，禁 author 手工填写

### 1.3 架构影响

- **对 TeamAct（A002）的影响**：ROUTE 步强制写入胶囊，是"无悬空任务归属"终止条件的判定依据
- **对 CapabilityProfile（A001）的影响**：胶囊的 blind_spot_hints 自动从 author CapabilityProfile 读取，反向也是盲点检测的输入
- **对 Durable State Surfaces（A008）的影响**：胶囊作为 6 类 Durable Surface 之一，承载跨 session 状态外部化
- **对 Evidence & Sensors（A009）的影响**：evidence_refs 字段锚定到 F009 Evidence Store
- **对 Push Back（A007）的影响**：胶囊的 tradeoffs 字段是 Push Back 论证的依据之一
- **对分布式可靠性（A021-A025）的影响**：胶囊 WAL 可重放，进程崩溃后接手Forgekin可读最新胶囊恢复

---

## 2. 架构设计

### 2.1 组件架构图

```
┌────────────────────────────────────────────────────────────────────┐
│                   TeamAct ROUTE 步 (A002)                          │
│   持球Forgekin传球时强制写入 HandoffCapsule                          │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ DI 注入
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│              flowforge/core/teamact/handoff.py (本 Feature)       │
│  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────────┐  │
│  │ HandoffCapsule   │  │ HandoffCapsule   │  │ HandoffCapsule  │  │
│  │   Schema         │  │   Validator      │  │   Store (ABC)   │  │
│  │ (五段+盲点+证据) │  │ (非空+去重+版本) │  │ (Repository 层) │  │
│  └─────────┬────────┘  └─────────┬────────┘  └────────┬────────┘  │
│            │                     │                    │           │
│            ▼                     ▼                    ▼           │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │   BlindSpotHintInjector (从 F001 CapabilityProfile 注入)    │  │
│  └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────────┬───────────────────────────────────┘
                                 ▼
┌────────────────────────────────────────────────────────────────────┐
│          flowforge/infra/repo/ (Repository 实现)                  │
│   SqliteHandoffCapsuleStore ────► SQLite (Durable Surface)        │
│   - write / read_latest / list_chain                              │
│   - WAL 可重放 (F021 联动)                                        │
└────────────────────────────────────────────────────────────────────┘
                                 ▲
                                 │ 读取
                                 │
                  ┌──────────────┴───────────────┐
                  │  接手Forgekin (TeamAct STATE 步) │
                  │  跨厂商 reviewer (盲点提示)    │
                  └──────────────────────────────┘
```

### 2.2 关键架构决策

- **决策 1：交接胶囊是协议层硬要求，不是可选礼貌**
  理由：roleagent.md 第 2 章明确要求。不强制写入则接手Forgekin必须重读完整上下文，token 成本与延迟不可接受。

- **决策 2：五段 Schema（What/Why/Tradeoff/Open/Next）任一非空**
  理由：五段对应不同心智维度。What 是事实陈述，Why 是设计意图，Tradeoff 是放弃的选项，Open 是开放问题，Next 是下一步建议。缺失任一段都会让接手者心智断层。

- **决策 3：盲点提示自动从 CapabilityProfile 注入（不由 author 手工填写）**
  理由：author 倾向于不暴露自己的盲点（自我保护倾向）。盲点必须由系统从 F001 CapabilityProfile 自动读取注入，保证客观性。

- **决策 4：开放问题状态可追溯（已解决 / 仍开放 / 新增）**
  理由：TeamAct "无悬空任务归属"终止条件要求所有 open question 都已 resolved 或已升级。状态不可追溯则终止条件无法判定。

- **决策 5：胶囊是 Durable Surface（authority_level=2，compression_immune=true）**
  理由：胶囊必须跨 session 跨 agent 持续存在。若塞在对话历史里，上下文压缩后胶囊消失，接手Forgekin无法恢复心智状态。

- **决策 6：胶囊版本化（schema_version），版本变更走 ADR 流程**
  理由：胶囊 Schema 是协议层契约，Forgekin不可私自修改。版本变更必须通过 ADR 评审，保留不可变历史。

### 2.3 架构不变量

- HandoffCapsule 五段字段（what/why/tradeoffs/open_questions/next_step）任一为空必须抛 SchemaError
- blind_spot_hints 必须由系统从 F001 CapabilityProfile 自动注入，author 不可手工填写
- 胶囊必须通过 Repository 层持久化，禁直操作数据库
- 胶囊是 Durable Surface，compression_immune=true，禁塞入对话历史
- evidence_refs 必须指向 F009 Evidence Store 中已存在的证据 ID
- 胶囊链必须可回放（list_chain 按 iteration 排序）
- HandoffCapsuleStore 通过 DI 容器注入，禁直接实例化

---

## 3. 模块设计

### 3.1 模块边界

- **handoff.py::HandoffCapsule** — Pydantic Schema（五段 + 盲点 + 证据 + 版本）。仅数据结构定义与字段级校验。
- **handoff.py::HandoffCapsuleValidator** — 校验器（五段非空 + 开放问题去重 + 证据锚定 + 版本兼容）。
- **handoff.py::HandoffCapsuleStore (ABC)** — Repository 抽象（write / read_latest / list_chain）。
- **handoff.py::BlindSpotHintInjector** — 盲点注入器（从 F001 CapabilityProfile 读取并附加）。
- **infra/repo/sqlite_handoff_store.py** — SQLite 实现（WAL 可重放，与 F021 联动）。
- **tests/** — 单元 + 集成 + E2E（T1-T8 铁律）。

### 3.2 接口契约

```python
from abc import ABC, abstractmethod
from typing import Optional
from pydantic import BaseModel, Field, validator
from datetime import datetime


class HandoffCapsule(BaseModel):
    """交接胶囊 — TeamAct ROUTE 步协议层硬要求"""
    capsule_id: str
    author_forgekin_id: str           # 作者Forgekin ID
    team_id: str                       # TeamAct team_id
    iteration: int                    # 第几轮迭代
    what: str                          # 做了什么（事实陈述，非空）
    why: str                           # 为什么这样做（设计意图，非空）
    tradeoffs: str                     # 权衡了什么（放弃的选项，非空）
    open_questions: list[str]          # 留下什么开放问题（可空列表，但字段非空）
    next_step: str                     # 下一步该做什么（非空）
    evidence_refs: list[str] = Field(default_factory=list)  # 关联 F009 Evidence ID
    blind_spot_hints: list[str] = Field(default_factory=list)  # 系统自动注入
    created_at: datetime = Field(default_factory=datetime.now)
    schema_version: str = "1.0"

    @validator("what", "why", "tradeoffs", "next_step")
    def must_be_non_empty(cls, v: str) -> str:
        """五段字段任一为空抛 SchemaError"""
        if not v or not v.strip:
            raise ValueError("HandoffCapsule 五段字段不可为空")
        return v


class HandoffCapsuleStore(ABC):
    """交接胶囊 Repository — 唯一持久化入口"""

    @abstractmethod
    async def write(self, capsule: HandoffCapsule) -> str:
        """写入胶囊，返回 capsule_id

        架构契约:
        - 必须通过 Schema 校验 (五段非空)
        - blind_spot_hints 自动注入 (author 不可手工填写)
        - 持久化到 Durable Surface (compression_immune=true)
        - WAL 可重放 (F021 联动)
        """

    @abstractmethod
    async def read_latest(self, team_id: str) -> Optional[HandoffCapsule]:
        """读取团队最新胶囊（接手Forgekin bootstrap 入口）"""

    @abstractmethod
    async def list_chain(self, team_id: str) -> list[HandoffCapsule]:
        """读取团队完整胶囊链（按 iteration 排序，可回放）"""


class BlindSpotHintInjector(ABC):
    """盲点提示自动注入器"""

    @abstractmethod
    async def inject(
        self,
        capsule: HandoffCapsule,
        author_profile: "CapabilityProfile",
    ) -> HandoffCapsule:
        """从 author CapabilityProfile.blind_spots 自动注入

        架构契约:
        - author 不可手工填写 blind_spot_hints
        - 必须从 F001 CapabilityProfile 读取
        - 注入后写审计日志
        """


class HandoffCapsuleValidator:
    """交接胶囊校验器"""

    def validate(self, capsule: HandoffCapsule) -> "ValidationResult":
        """校验五段非空 + 开放问题去重 + 证据锚定"""


class OpenQuestionStatus(BaseModel):
    """开放问题状态（可追溯）"""
    question: str
    status: str = "open"  # open / resolved / escalated / new
    resolved_by: Optional[str] = None
    resolved_at: Optional[datetime] = None
```

### 3.3 数据流

```
TeamAct ROUTE 步触发 (持球Forgekin传球)
                  │
                  ▼
┌──────────────────────────────────────────────────────────────┐
│ 1. 持球Forgekin填写 HandoffCapsule 五段                         │
│    (what / why / tradeoffs / open_questions / next_step)     │
│    evidence_refs 锚定到 F009 Evidence Store                  │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│ 2. BlindSpotHintInjector.inject(capsule, author_profile)     │
│    - 从 F001 CapabilityProfile.blind_spots 自动读取          │
│    - 附加到 capsule.blind_spot_hints                         │
│    - 写审计日志 (author 不可手工填写)                        │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│ 3. HandoffCapsuleValidator.validate(capsule)                 │
│    - 五段非空校验                                            │
│    - 开放问题去重 (与链上前一胶囊比对)                       │
│    - 证据锚定校验 (evidence_refs 必须在 F009 已存在)          │
└──────────────────────────┬───────────────────────────────────┘
                           │ 校验通过
                           ▼
┌──────────────────────────────────────────────────────────────┐
│ 4. HandoffCapsuleStore.write(capsule)                       │
│    - 持久化到 SQLite (Durable Surface, authority_level=2)    │
│    - WAL 写入 (F021 联动, 可重放)                           │
│    - 广播事件到 EventBus (接手Forgekin可感知)                  │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│ 5. 接手Forgekin在 TeamAct STATE 步读取最新胶囊                 │
│    HandoffCapsuleStore.read_latest(team_id)                 │
│    - 快速 bootstrap (无需重读完整上下文)                     │
│    - 看到盲点提示 (避免重蹈 author 覆辙)                     │
└──────────────────────────────────────────────────────────────┘
```

---

## 4. 跨模块协作

### 4.1 上游依赖

- **F001 CapabilityProfile** — blind_spot_hints 自动注入的数据源
- **F002 TeamAct Loop** — ROUTE 步触发胶囊写入，STATE 步触发胶囊读取
- **F009 Evidence & Sensors** — evidence_refs 锚定的目标

### 4.2 下游影响

- **F004 PingPong Circuit Breaker** — 胶囊的 has_substantive_output 判定依赖 evidence_refs 与产出字符数
- **F006 Ball Custody Lease** — 胶囊 next_step 字段是 lease 唤醒后执行的依据
- **F007 Push Back Protocol** — 胶囊的 tradeoffs 字段是 Push Back 论证依据
- **F008 Durable State Surfaces** — 胶囊作为 6 类 Durable Surface 之一（authority_level=2）
- **F018 Eval Contract** — 胶囊完整率是 Eval 信号之一
- **F021 Side Effect WAL** — 胶囊写入走 WAL，进程崩溃可恢复

### 4.3 跨模块不变量

- 胶囊 author_forgekin_id 必须与上一任 TeamActState.current_owner 一致
- 胶囊 evidence_refs 必须在 F009 Evidence Store 中存在
- 胶囊 blind_spot_hints 必须与 author CapabilityProfile.blind_spots 一致（不可手工篡改）
- 胶囊链 iteration 必须单调递增，不可回退
- 胶囊 schema_version 变更必须走 ADR 流程

---

## 5. 架构验收

### 5.1 架构契约验收

- [ ] AC-1: `flowforge/core/teamact/handoff.py` 不 import forgemind 或 *Forge 模块
- [ ] AC-2: HandoffCapsuleStore 通过 DI 容器注入，无直接实例化
- [ ] AC-3: 胶囊持久化通过 Repository 层（无 cursor.execute）
- [ ] AC-4: max_open_questions / retention_days 外置到 `flowforge/config/teamact.yaml`
- [ ] AC-5: 胶囊作为 Durable Surface，compression_immune=true

### 5.2 架构不变量验收

- [ ] AC-6: 五段字段任一为空时 `HandoffCapsule` 构造抛 SchemaError
- [ ] AC-7: blind_spot_hints 由系统注入，author 手工填写被拒绝
- [ ] AC-8: evidence_refs 指向不存在的 Evidence ID 时校验失败
- [ ] AC-9: 胶囊链 iteration 单调递增
- [ ] AC-10: 胶囊 schema_version 变更走 ADR 流程
- [ ] AC-11: WAL 可重放，进程崩溃后胶囊状态可恢复
- [ ] AC-12: 开放问题状态可追溯（已解决 / 仍开放 / 新增）

---

## 6. 引用

- [doc:../spec.md#§3.2]（FR-CORE-002，FR-CORE-016 交接胶囊 + 持球注册 lease）
- [doc:../arch.md#§3.2]（TeamAct 六步循环，交接胶囊协议层硬要求）
- [doc:../features/F003-handoff-capsule.md]（同号 Feature 级 SRS）
- [doc:../features/F001-capability-profile.md]（blind_spot_hints 注入源）
- [doc:../features/F002-teamact-loop.md]（TeamAct ROUTE 步触发写入）
- [doc:../features/F009-evidence-sensors.md]（evidence_refs 锚定目标）
- [doc:../decisions/002-collaboration-protocol.md]（TeamAct 协作协议 ADR）
- [doc:../../CONTRIBUTING.md]（文档分层规范）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（架构骨架，对应 F003 Feature 级 SRS） | 架构师 Forgekin（猫头鹰·鲁班） |
