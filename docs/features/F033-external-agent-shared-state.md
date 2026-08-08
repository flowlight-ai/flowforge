# Feature F033: 三方 Agent 状态共享

> **状态**: draft
> **版本**: v0.1
> **依赖**: [doc:review/review.md#EX-004] + [doc:roleagent.md#第2章]
> **关联 ADR**: [doc:decisions/006-external-agent-integration.md]
> **类型**: external-agent
> **创建日期**: 2026-07-17
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.10]（FR-CORE-010，与本文档同号对应）
> **对应 arch.md**: [doc:../arch.md#§3.10]（待创建）
> **对应 design.md**: [doc:../design.md#§3.10]（待创建）

---

## 1. 概述（Overview）

三方 Agent 状态共享（External Agent Shared State）是 forgemind 应用层实现"Forgekin → claude code 写代码 → codex review → trae 部署"连续协作流的基础：Forgekin调用三方 Agent 后，修改历史与决策上下文写入共享状态，下一个三方 Agent 接手时可读取。本 Feature 实现三方 Agent 间共享状态、与 F002 TeamAct State 联动、与 F008 持久状态层联动。

这是 Build to Persist 基础设施——编码"三方 Agent 间有共享上下文"的工程规则，对标 roleagent.md 第 2 章 Shared State 主张。

## 2. 动机（Motivation）

`[doc:review/review.md#EX-004]` 指出：roleagent.md 第 2 章强调 Shared State 是多 agent 协作基础，但 v7.0 三方 Agent 间无共享状态，每次调用都是独立会话，无法实现连续协作流。Forgekin调用 claude code 修改代码后，codex 接手 review 时看不到 claude code 的修改历史和决策上下文，只能重读全部代码。

不做这个 Feature，F032 能力画像无协作上下文载体，F035 能力融合无调用历史可蒸馏，三方 Agent 协作流退化为"用完即走"模式。这是三方 Agent 集成层的协作底座。

## 3. 详细设计（Detailed Design）

### 3.1 数据模型

```python
class ExternalAgentSharedState(BaseModel):
    """三方 Agent 共享状态（写入 F008 持久状态层）"""
    state_id: str
    team_act_state_ref: str                    # 关联 F002 TeamActState ID
    forgekin_id: str                           # 主持Forgekin ID
    session_context: dict                      # 会话级共享上下文
    modification_log: list[ModificationRecord] # 修改历史
    decision_context: list[DecisionRecord]     # 决策上下文
    artifact_refs: list[str]                   # 产出物引用（commit / 文件 / 测试 ID）
    last_updated_by: str                       # 最后更新的三方 Agent ID

class ModificationRecord(BaseModel):
    """修改记录"""
    agent_id: str                              # 三方 Agent ID（来自 F032）
    timestamp: datetime
    target: str                                # 修改目标（文件路径 / 函数名）
    diff_summary: str                          # 修改摘要
    rationale: str                             # 修改理由
    commit_ref: Optional[str]                  # git commit ref

class DecisionRecord(BaseModel):
    """决策记录（用于下一个 Agent 接手时理解上下文）"""
    agent_id: str
    timestamp: datetime
    decision: str
    alternatives_considered: list[str]
    tradeoffs: str
    open_questions: list[str]                  # 与 F003 HandoffCapsule 一致
```

### 3.2 核心接口

```python
class SharedStateStore(ABC):
    """共享状态存储（基于 F008 持久状态层）"""
    @abstractmethod
    async def create(self, team_act_state_ref: str, forgekin_id: str) -> str: ...
    @abstractmethod
    async def get(self, state_id: str) -> ExternalAgentSharedState: ...
    @abstractmethod
    async def append_modification(self, state_id: str, record: ModificationRecord) -> None: ...
    @abstractmethod
    async def append_decision(self, state_id: str, record: DecisionRecord) -> None: ...

class SharedStateHandoff(ABC):
    """共享状态交接（与 F003 HandoffCapsule 联动）"""
    @abstractmethod
    async def handoff_to_next_agent(
        self, state_id: str, next_agent_id: str, capsule: HandoffCapsule
    ) -> None: ...

    @abstractmethod
    async def read_onboarding(self, agent_id: str, state_id: str) -> OnboardingSummary:
        """新 Agent 接手时读取 onboarding 摘要（避免重读全部上下文）"""
        ...
```

### 3.3 关键算法

- **共享状态生命周期 = TeamAct 生命周期**：与 F002 TeamActState 一一关联，TeamAct 终止时共享状态归档到EchoStore（F014）。
- **修改历史增量写入**：每次三方 Agent 修改产出物时 append ModificationRecord，不覆盖历史。
- **Onboarding 摘要**：新 Agent 接手时读取最近 N 条 ModificationRecord + DecisionRecord 的摘要，而非全部历史。
- **决策上下文必须保留**：DecisionRecord 的 open_questions 必须传递给下一个 Agent（与 F003 交接胶囊一致）。

### 3.4 配置外置（YAML 示例）

```yaml
external_agent_shared_state:
  storage_backend: durable_state_surfaces      # 复用 F008
  onboarding_summary:
    max_recent_modifications: 20
    max_recent_decisions: 10
    include_open_questions: true
  lifecycle:
    bind_to_team_act: true
    archive_to_echo_store_on_terminate: true   # 归档到 F014 EchoStore
  handoff:
    require_handoff_capsule: true              # 与 F003 一致
    skip_full_context_reload: true
```

## 4. 验收标准（Acceptance Criteria）

- [ ] AC-1: 共享状态与 F002 TeamActState 一一关联
- [ ] AC-2: 修改历史增量写入，不覆盖
- [ ] AC-3: 新 Agent 接手时读取 Onboarding 摘要而非全部历史
- [ ] AC-4: DecisionRecord 的 open_questions 必须传递（与 F003 一致）
- [ ] AC-5: TeamAct 终止时共享状态归档到 F014 EchoStore

## 5. 测试策略

### 5.1 单元测试

- 共享状态创建、增量写入、Onboarding 摘要生成、归档逻辑。

### 5.2 集成测试

- 接入 F002 TeamActState、F003 HandoffCapsule、F008 持久状态层、F014 EchoStore集合。

### 5.3 E2E 测试（必须遵守 T1-T8 测试铁律）

- 真实Forgekin → claude code 写代码（写入 ModificationRecord）→ codex review（读 Onboarding 摘要后基于决策上下文 review）→ trae 部署。验证三方 Agent 间共享状态正确传递、codex 不需重读全部代码。**遵守 T1-T8**：真实 LLM、真实数据、真实工具调用（含真实三方 Agent）。

## 6. 引用

- [doc:roleagent.md#第2章]
- [doc:review/review.md#第九章/EX-004]
- [doc:decisions/006-external-agent-integration.md]
- [doc:features/F002-teamact-loop.md]
- [doc:features/F003-handoff-capsule.md]
- [doc:features/F008-durable-state-surfaces.md]
- [doc:features/F014-memory-collection.md]
- [doc:features/F032-external-agent-profile.md]
- [doc:features/F035-external-agent-capability-fusion.md]
- [doc:project_rules.md#T1-T8]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
