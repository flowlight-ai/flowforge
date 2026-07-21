# A033: 三方 Agent 状态共享架构设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.10]（FR-CORE-010）
> **对应 arch.md**: [doc:../arch.md#§3.10]
> **对应 design.md**: [doc:../design.md#§3.10]（待创建）
> **对应 Feature**: [doc:../features/F033-external-agent-shared-state.md]（同号 Feature 级 SRS）
> **对应详细设计**: [doc:../design/D033-external-agent-shared-state.md]（待创建，同号 Feature 级 SDD）
> **依赖 ADR**: [doc:../decisions/006-external-agent-integration.md]

---

## 1. 架构上下文

### 1.1 架构问题

ExternalAgentAdapter 抽象层（A031）需要实现"Forgekin -> claude code 写代码 -> codex review -> trae 部署"连续协作流，但 v7.0 三方 Agent 间无共享状态，每次调用都是独立会话，无法实现连续协作。本架构在 `core/external_agent/shared_state.py` 建立三方 Agent 状态共享层，解决以下架构层问题：

1. **共享状态数据模型缺失**：三方 Agent 间无 session_context / modification_log / decision_context / artifact_refs 统一数据模型。
2. **TeamAct 生命周期未绑定**：共享状态与 F002 TeamActState 无关联，TeamAct 终止时共享状态无归档机制。
3. **修改历史覆盖式更新**：v7.0 三方 Agent 修改产出物时覆盖历史，无增量写入机制，导致上下文丢失。
4. **Onboarding 摘要缺失**：新 Agent 接手时需重读全部上下文，无摘要机制导致 token 浪费。
5. **决策上下文 open_questions 丢失**：DecisionRecord 的 open_questions 未传递给下一个 Agent，与 F003 HandoffCapsule 不一致。
6. **Handoff Capsule 未对接**：三方 Agent 交接未对接 F003 HandoffCapsule，交接信息不完整。

### 1.2 架构约束

- **单向依赖约束**：SharedStateStore 必须单向依赖 F002 TeamActState + F003 HandoffCapsule + F008 Durable State Surfaces + F014 Memory Collection，禁止反向依赖 *Forge。
- **DI 容器约束**：SharedStateStore / SharedStateHandoff 实例必须通过 DI 容器注入到 ExternalAgentBridge。
- **Repository 层约束**：ExternalAgentSharedState 写入必须通过 Repository 层（基于 F008 持久状态层），禁止直接操作数据库。
- **配置驱动约束**：onboarding_summary / lifecycle / handoff 配置必须 YAML 外置到 `config/external_agent.yaml`，禁止 .py 硬编码。
- **生命周期绑定约束**：共享状态必须与 F002 TeamActState 一一关联，TeamAct 终止时必须归档到 F014 EchoStore。
- **增量写入约束**：ModificationRecord 必须增量 append，禁止覆盖历史记录。
- **Handoff Capsule 一致性约束**：SharedStateHandoff 必须对接 F003 HandoffCapsule，open_questions 必须传递。

### 1.3 架构影响

- **对 F002 TeamAct 的影响**：ExternalAgentSharedState 与 TeamActState 一一关联，TeamAct 终止时归档。
- **对 F003 HandoffCapsule 的影响**：SharedStateHandoff 对接 HandoffCapsule，交接信息一致。
- **对 F008 持久状态层的影响**：ExternalAgentSharedState 持久化到 F008 Durable State Surfaces。
- **对 F014 多域记忆的影响**：TeamAct 终止时共享状态归档到EchoStore，成为Forgekin经验记忆。
- **对 F032 能力画像的影响**：modification_log 中 agent_id 引用 ExternalAgentCapabilityProfile.agent_id。
- **对 F035 能力融合的影响**：共享状态中的 call_artifacts 作为能力融合来源。
- **对 A031 ExternalAgentBridge 的影响**：Bridge 在调用三方 Agent 后通过 SharedStateStore.write 写入共享状态。

---

## 2. 架构设计

### 2.1 组件架构图

```
                    +-------------------------------------------------+
                    |     core/external_agent/shared_state.py         |
                    |                                                 |
                    |  +-------------------+                          |
                    |  | ExternalAgent     |  共享状态数据模型         |
                    |  | SharedState       |  (session_context +      |
                    |  +---------+---------+  modification_log +      |
                    |            |           decision_context +       |
                    |  +---------v---------+ artifact_refs)           |
                    |  | ModificationRecord|                          |
                    |  | (增量 append)     |                          |
                    |  +-------------------+                          |
                    |  +-------------------+                          |
                    |  | DecisionRecord    |  (含 open_questions)     |
                    |  +-------------------+                          |
                    |                                                 |
                    |  +-------------------+   +-------------------+ |
                    |  | SharedStateStore  |<->| SharedStateHandoff| |
                    |  | (CRUD + 增量写入)  |   | (对接 F003)       | |
                    |  +---------+---------+   +---------+---------+ |
                    |            |                       |           |
                    |            v                       v           |
                    |  +-------------------+   +-------------------+ |
                    |  | OnboardingSummary |   | HandoffCapsule    | |
                    |  | Generator         |   | (F003 引用)       | |
                    |  | (摘要生成)         |   +-------------------+ |
                    |  +-------------------+                         |
                    +-------------------------------------------------+
                                          |
                                          v
                    +-------------------------------------------+
                    |  持久化层（Repository 抽象）              |
                    |  F008 DurableStateSurfaces (运行时存储)   |
                    |  F014 EchoStore (TeamAct 终止时归档)      |
                    +-------------------------------------------+
                                          ^
                                          | 生命周期绑定
                                          |
                    +-------------------------------------------+
                    |  F002 TeamActState (一一关联)             |
                    +-------------------------------------------+
```

### 2.2 关键架构决策

- **决策 1：共享状态生命周期 = TeamAct 生命周期**
  ExternalAgentSharedState 与 F002 TeamActState 一一关联（team_act_state_ref 字段）。TeamAct 终止时共享状态归档到 F014 EchoStore集合，成为Forgekin经验记忆。这避免共享状态无限累积导致存储爆炸。

- **决策 2：修改历史增量 append 而非覆盖**
  ModificationRecord 通过 SharedStateStore.append_modification 增量写入，不覆盖历史。每个三方 Agent 修改产出物时 append 一条记录（含 agent_id / timestamp / target / diff_summary / rationale / commit_ref）。这保留完整修改历史供后续 Agent 理解上下文。

- **决策 3：Onboarding 摘要避免重读全部上下文**
  SharedStateHandoff.read_onboarding 返回最近 N 条 ModificationRecord + DecisionRecord 的摘要（默认 max_recent_modifications=20, max_recent_decisions=10），而非全部历史。新 Agent 接手时只需读摘要，避免 token 浪费。

- **决策 4：DecisionRecord.open_questions 必须传递（与 F003 一致）**
  DecisionRecord 的 open_questions 字段必须传递给下一个 Agent，与 F003 HandoffCapsule 一致。这保证未解决问题不因 Agent 切换而丢失。

- **决策 5：SharedStateHandoff 对接 F003 HandoffCapsule**
  SharedStateHandoff.handoff_to_next_agent 接收 HandoffCapsule 参数，与 F003 交接胶囊协议一致。交接时 capsule 中的 open_questions / known_issues / next_action_hint 必须写入共享状态。

- **决策 6：TeamAct 终止时归档到 F014 EchoStore**
  TeamAct 终止时（如任务完成 / 取消 / 失败）ExternalAgentSharedState 整体归档到 F014 EchoStore EchoStore集合，作为Forgekin经验记忆一部分，供 F035 能力融合蒸馏。

### 2.3 架构不变量

- ExternalAgentSharedState 必须与 F002 TeamActState 一一关联（team_act_state_ref 字段非空）。
- ModificationRecord 必须增量 append，禁止覆盖历史记录。
- DecisionRecord.open_questions 必须传递给下一个 Agent，禁止丢失。
- SharedStateHandoff 必须对接 F003 HandoffCapsule，交接信息完整。
- 新 Agent 接手时必须读取 Onboarding 摘要而非全部历史。
- TeamAct 终止时共享状态必须归档到 F014 EchoStore集合。
- ExternalAgentSharedState 持久化必须通过 Repository 层（基于 F008），禁止直接操作数据库。
- onboarding_summary / lifecycle / handoff 配置必须 YAML 外置到 `config/external_agent.yaml`。

---

## 3. 模块设计

### 3.1 模块边界

| 模块 | 路径 | 职责 |
|------|------|------|
| ExternalAgentSharedState | `core/external_agent/shared_state.py` | 共享状态数据模型 |
| ModificationRecord | `core/external_agent/shared_state.py` | 修改记录（增量 append） |
| DecisionRecord | `core/external_agent/shared_state.py` | 决策记录（含 open_questions） |
| SharedStateStore | `core/external_agent/shared_state.py` | 共享状态存储（CRUD + 增量写入） |
| SharedStateHandoff | `core/external_agent/shared_state.py` | 共享状态交接（对接 F003） |
| OnboardingSummary | `core/external_agent/shared_state.py` | Onboarding 摘要生成器 |
| ExternalAgentConfig | `config/external_agent.yaml` | onboarding/lifecycle/handoff YAML 配置（外置） |

### 3.2 接口契约

```python
from abc import ABC, abstractmethod
from typing import Optional
from pydantic import BaseModel, Field
from datetime import datetime


class ModificationRecord(BaseModel):
    """修改记录（增量 append）"""
    record_id: str
    agent_id: str                              # 三方 Agent ID（来自 F032）
    timestamp: datetime
    target: str                                # 修改目标（文件路径 / 函数名）
    diff_summary: str                          # 修改摘要
    rationale: str                             # 修改理由
    commit_ref: Optional[str]                  # git commit ref


class DecisionRecord(BaseModel):
    """决策记录（用于下一个 Agent 接手时理解上下文）"""
    record_id: str
    agent_id: str
    timestamp: datetime
    decision: str
    alternatives_considered: list[str]
    tradeoffs: str
    open_questions: list[str]                  # 与 F003 HandoffCapsule 一致


class ExternalAgentSharedState(BaseModel):
    """三方 Agent 共享状态（写入 F008 持久状态层）"""
    state_id: str
    team_act_state_ref: str                    # 关联 F002 TeamActState ID
    forgekin_id: str                           # 主持Forgekin ID
    session_context: dict                      # 会话级共享上下文
    modification_log: list[ModificationRecord] = Field(default_factory=list)
    decision_context: list[DecisionRecord] = Field(default_factory=list)
    artifact_refs: list[str]                   # 产出物引用（commit / 文件 / 测试 ID）
    last_updated_by: str                       # 最后更新的三方 Agent ID
    created_at: datetime = Field(default_factory=datetime.now)


class OnboardingSummary(BaseModel):
    """Onboarding 摘要（新 Agent 接手时读取）"""
    state_id: str
    recent_modifications: list[ModificationRecord]   # 最近 N 条
    recent_decisions: list[DecisionRecord]           # 最近 N 条
    open_questions: list[str]                        # 累积未解决问题
    artifact_refs: list[str]                         # 产出物引用
    last_updated_by: str


class SharedStateStore(ABC):
    """共享状态存储（基于 F008 持久状态层）"""

    @abstractmethod
    async def create(
        self, team_act_state_ref: str, forgekin_id: str
    ) -> str:
        """创建共享状态（与 TeamActState 一一关联）"""
        ...

    @abstractmethod
    async def get(self, state_id: str) -> ExternalAgentSharedState:
        """读取共享状态"""
        ...

    @abstractmethod
    async def append_modification(
        self, state_id: str, record: ModificationRecord
    ) -> None:
        """增量 append 修改记录（不覆盖历史）"""
        ...

    @abstractmethod
    async def append_decision(
        self, state_id: str, record: DecisionRecord
    ) -> None:
        """增量 append 决策记录"""
        ...

    @abstractmethod
    async def archive_to_echo_store(self, state_id: str) -> str:
        """TeamAct 终止时归档到 F014 EchoStore集合"""
        ...


class SharedStateHandoff(ABC):
    """共享状态交接（与 F003 HandoffCapsule 联动）"""

    @abstractmethod
    async def handoff_to_next_agent(
        self,
        state_id: str,
        next_agent_id: str,
        capsule: dict,                          # F003 HandoffCapsule
    ) -> None:
        """交接给下一个三方 Agent（capsule 含 open_questions / known_issues / next_action_hint）"""
        ...

    @abstractmethod
    async def read_onboarding(
        self, agent_id: str, state_id: str
    ) -> OnboardingSummary:
        """新 Agent 接手时读取 onboarding 摘要（避免重读全部上下文）"""
        ...
```

### 3.3 数据流

```
[创建阶段]
    TeamAct 启动 (F002)
        |
        v
    SharedStateStore.create(team_act_state_ref, forgekin_id)
        |
        v
    ExternalAgentSharedState 实例化（state_id + team_act_state_ref 绑定）
        |
        v
    持久化到 F008 Durable State Surfaces

[协作阶段（Forgekin -> claude code -> codex -> trae）]
    [1] Forgekin调用 claude code 写代码
        `--> ExternalAgentBridge.invoke [A031]
            `--> claude code 修改文件 + 提交 commit
                `--> SharedStateStore.append_modification(state_id, record)
                    |-- record.agent_id = "claude_code_main"
                    |-- record.target = "src/auth.py"
                    |-- record.diff_summary = "添加 OAuth2 流程"
                    `-- record.commit_ref = "abc123"
                `--> SharedStateStore.append_decision(state_id, record)
                    |-- record.decision = "使用 OAuth2 而非 JWT"
                    `-- record.open_questions = ["是否需要刷新令牌?"]

    [2] Forgekin调用 codex review
        `--> SharedStateHandoff.read_onboarding(agent_id="codex_main", state_id)
            `--> 返回 OnboardingSummary
                |-- recent_modifications: [最近 20 条]
                |-- recent_decisions: [最近 10 条]
                `-- open_questions: ["是否需要刷新令牌?"]
        `--> codex 基于摘要 review（无需重读全部代码）
        `--> codex 提交 review 意见
            `--> SharedStateStore.append_modification(state_id, record)
                `-- record.target = "review comments"

    [3] Forgekin调用 trae 部署
        `--> SharedStateHandoff.read_onboarding(agent_id="trae_main", state_id)
            `--> 返回 OnboardingSummary（含 codex 的 review 意见）
        `--> trae 部署
            `--> SharedStateStore.append_modification(state_id, record)
                `-- record.target = "deployment"

[归档阶段（TeamAct 终止）]
    TeamAct 终止（任务完成 / 取消 / 失败）
        |
        v
    SharedStateStore.archive_to_echo_store(state_id)
        |
        v
    ExternalAgentSharedState 整体归档到 F014 EchoStore EchoStore集合
        `--> 作为Forgekin经验记忆（供 F035 能力融合蒸馏）

[交接阶段（Agent 切换）]
    Forgekin决定从 claude code 切换到 codex
        |
        v
    SharedStateHandoff.handoff_to_next_agent(state_id, next_agent_id="codex_main", capsule)
        |-- capsule 来自 F003 HandoffCapsule
        |-- capsule.open_questions 写入共享状态
        `-- capsule.known_issues 写入共享状态
        |
        v
    codex 接手时 read_onboarding 获取完整上下文
```

---

## 4. 跨模块协作

### 4.1 上游依赖

- **依赖 F002 TeamAct**：共享状态与 TeamActState 一一关联。
- **依赖 F003 HandoffCapsule**：SharedStateHandoff 对接 HandoffCapsule。
- **依赖 F008 Durable State Surfaces**：共享状态持久化目标。
- **依赖 F014 Memory Collection**：TeamAct 终止时归档目标。
- **依赖 F032 ExternalAgentProfile**：modification_log 中 agent_id 引用 ExternalAgentCapabilityProfile.agent_id。
- **依赖 core/interfaces**：Repository / DI 容器抽象。

### 4.2 下游影响

- **影响 A031 ExternalAgentBridge**：Bridge 在调用三方 Agent 后通过 SharedStateStore.write 写入共享状态。
- **影响 F035 能力融合**：共享状态中的 call_artifacts 作为能力融合来源。
- **影响 F034 失败回退**：fallback 时下一个 Agent 通过 read_onboarding 获取上下文。

### 4.3 跨模块不变量

- ExternalAgentSharedState 必须与 F002 TeamActState 一一关联，未关联时创建被拒绝。
- ModificationRecord 必须增量 append，禁止覆盖历史记录。
- DecisionRecord.open_questions 必须传递给下一个 Agent，禁止丢失。
- SharedStateHandoff 必须对接 F003 HandoffCapsule，capsule 字段完整写入共享状态。
- 新 Agent 接手时必须读取 Onboarding 摘要而非全部历史。
- TeamAct 终止时共享状态必须归档到 F014 EchoStore集合，未归档时 TeamAct 视为未完成。

---

## 5. 架构验收

### 5.1 架构契约验收

- [ ] AC-1: 单向依赖通过 —— `core/external_agent/shared_state.py` 仅依赖 F002/F003/F008/F014/F032，无 *Forge 反向 import。
- [ ] AC-2: DI 容器注入通过 —— SharedStateStore / SharedStateHandoff 通过 DI 容器注入到 ExternalAgentBridge。
- [ ] AC-3: Repository 层通过 —— ExternalAgentSharedState 通过 Repository 写入 F008，无直接数据库操作。
- [ ] AC-4: 配置驱动通过 —— onboarding_summary / lifecycle / handoff 配置 YAML 外置到 `config/external_agent.yaml`。
- [ ] AC-5: 生命周期绑定通过 —— ExternalAgentSharedState.team_act_state_ref 非空且引用有效 TeamActState。

### 5.2 架构不变量验收

- [ ] AC-6: 增量 append 不变量通过 —— ModificationRecord 历史记录不被覆盖，append 后总量单调递增。
- [ ] AC-7: open_questions 传递不变量通过 —— DecisionRecord.open_questions 在 Agent 切换后仍可在 OnboardingSummary 中查到。
- [ ] AC-8: Handoff Capsule 对接不变量通过 —— SharedStateHandoff.handoff_to_next_agent 接收 F003 HandoffCapsule 且字段完整写入。
- [ ] AC-9: Onboarding 摘要不变量通过 —— read_onboarding 返回的 recent_modifications 数量不超过 max_recent_modifications 配置。
- [ ] AC-10: 归档不变量通过 —— TeamAct 终止后 ExternalAgentSharedState 在 F014 EchoStore 中可查询。

---

## 6. 引用

- [doc:../spec.md#§3.10]（FR-CORE-010）
- [doc:../arch.md#§3.10]（三方 Agent 集成）
- [doc:../features/F033-external-agent-shared-state.md]（同号 Feature 级 SRS）
- [doc:../features/F002-teamact-loop.md]
- [doc:../features/F003-handoff-capsule.md]
- [doc:../features/F008-durable-state-surfaces.md]
- [doc:../features/F014-memory-collection.md]
- [doc:../features/F031-external-agent-adapter.md]
- [doc:../features/F032-external-agent-profile.md]
- [doc:../features/F034-external-agent-fallback.md]
- [doc:../features/F035-external-agent-capability-fusion.md]
- [doc:../decisions/006-external-agent-integration.md]
- [doc:../design/naming-contract.md]（EchoStore）
- [doc:../../../hiclaw/rules.md#第十一部分]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（共享状态 + 增量 append + Onboarding 摘要 + Handoff Capsule 对接 + 归档架构） | 架构师 Forgekin（猫头鹰·鲁班） |
