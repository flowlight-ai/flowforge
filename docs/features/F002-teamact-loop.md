---
feature_ids: [F002]
related_features: [F001, F003, F004, F005, F006, F007]
topics: [teamact, collaboration, state-machine, termination]
doc_kind: spec
created: 2026-07-17
---

# F002: TeamAct 六步循环

> **状态**: spec | **负责人**: 架构师灵智体 | **优先级**: P0
> **依赖 ADR**: [doc:decisions/002-collaboration-protocol.md]
> **依赖 Feature**: [doc:features/F001-capability-profile.md]
> **依据**: operator 7 条不可妥协原则 + roleagent.md 工程路径
> **关联 VISION**: [doc:VISION.md#4]（协作单位：动态能力画像路由）、[doc:VISION.md#6]（operator 原则第 6 条：支持自己开发自己）

## 1. 上下文

### 1.1 问题陈述

flowlight-ai/flowforge 新仓库当前协作基于固定角色 + EventBus + Handoff，没有团队级终止条件。这导致：

- 灵智体互相传球永远循环，没有"团队停下来"机制
- 单灵智体判断"做完了"经常是幻觉（被 RLHF 训练出收尾惯性）
- 没有交接胶囊（前一个灵智体不留摘要，后一个灵智体重读全部上下文）

需要实现 TeamAct 六步循环 + 五项终止条件，让灵智体协作有明确终止边界。这是 operator 原则第 6 条（支持自己开发自己）的协作基础——FlowForge 用 FlowForge 自身能力开发 FlowForge 需要 TeamAct 编排多灵智体协作。

### 1.2 当前痛点

- *Forge 项目违反 P31 铁律（Agent 直接执行，未通过 LoopExecutor / TeamAct）
- 协作没有跨厂商 review 结构性必需
- 乒乓球（ping-pong）传球无熔断机制
- 交接胶囊缺失，上下文每次从头加载

### 1.3 不做的影响

- 无法实现 `[doc:roleagent.md#第2章]` 团队主循环
- 灵智体协作陷入死循环
- 跨厂商 review 缺失导致同厂商盲点
- "自己开发自己"闭环无法达成

## 2. 决策

### 2.1 核心设计

TeamAct 六步循环 + 五项终止条件（来自 `[doc:roleagent.md#第2章]`）：

```
loop:
    State    → 读共享状态（仓库 / spec / 任务 / 灵忆 EchoStore / 交接胶囊）
    Owner    → 谁持球？（基于 F001 CapabilityProfile 路由 / 显式持有声明）
    Action   → 持球者执行（写代码 / review / 设计 / 调研）
    Evidence → 产出证据（commit / 测试 / trace / 截图）
    Verdict  → 验证（跨厂商 review / 自检 / operator 确认）
    Route    → 传球（路由给下一个灵智体 / 继续持有 / 升级给 operator）
```

五项终止条件缺一不可：验收标准达成 + 证据已附 + 跨 agent 交叉验证 + 无悬空任务归属 + 愿景收敛。

### 2.2 关键接口

```python
from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field
from datetime import datetime


class TeamActStep(str, Enum):
    """TeamAct 六步状态"""
    STATE = "state"
    OWNER = "owner"
    ACTION = "action"
    EVIDENCE = "evidence"
    VERDICT = "verdict"
    ROUTE = "route"


class TerminationCondition(BaseModel):
    """五项终止条件（缺一不可）"""
    acceptance_criteria_met: bool = False
    evidence_attached: bool = False
    cross_agent_verified: bool = False      # 跨厂商 review
    no_dangling_ownership: bool = False
    vision_converged: bool = False          # operator 愿景确认

    def all_met(self) -> bool:
        return all([
            self.acceptance_criteria_met,
            self.evidence_attached,
            self.cross_agent_verified,
            self.no_dangling_ownership,
            self.vision_converged,
        ])


class HandoffCapsule(BaseModel):
    """交接胶囊（协议层硬要求，不是可选礼貌）"""
    author_forgekin_id: str
    summary: str                    # 做了什么
    rationale: str                  # 为什么这样做
    tradeoffs: str                  # 权衡了什么
    open_questions: list[str]       # 留下什么开放问题
    next_step: str                  # 下一步该做什么
    created_at: datetime = Field(default_factory=datetime.now)


class TeamActState(BaseModel):
    """TeamAct 状态机"""
    team_id: str
    current_step: TeamActStep = TeamActStep.STATE
    current_owner: Optional[str] = None      # 持球 forgekin_id
    iteration: int = 0
    termination: TerminationCondition = Field(default_factory=TerminationCondition)
    handoff_capsules: list[HandoffCapsule] = Field(default_factory=list)
    evidence_refs: list[str] = Field(default_factory=list)

    def advance(self, capsule: Optional[HandoffCapsule] = None) -> "TeamActState":
        """推进到下一步"""
        ...

    def is_terminated(self) -> bool:
        """检查是否满足五项终止条件"""
        return self.termination.all_met()


class PingPongCircuitBreaker:
    """乒乓球熔断器（给数据不给结论）"""

    def __init__(self, max_iterations: int = 3):
        self.max_iterations = max_iterations
        self.iteration_counts: dict[str, int] = {}

    def should_break(self, team_id: str) -> bool:
        return self.iteration_counts.get(team_id, 0) >= self.max_iterations

    def record_iteration(self, team_id: str) -> None:
        self.iteration_counts[team_id] = self.iteration_counts.get(team_id, 0) + 1
```

## 3. 验收标准

### Phase A（状态机 + 协议）

- [ ] AC-A1: TeamActState 可推进六步循环（State → Owner → Action → Evidence → Verdict → Route）
- [ ] AC-A2: 五项终止条件全部检查（不能跳过任一项）
- [ ] AC-A3: HandoffCapsule 必须包含 5 字段（summary/rationale/tradeoffs/open_questions/next_step）
- [ ] AC-A4: PingPongCircuitBreaker 在 max_iterations 触发熔断
- [ ] AC-A5: TeamAct 状态通过 Repository 层持久化（Durable State Surfaces，禁直接操作数据库）
- [ ] AC-A6: 治理规则通过 system role 注入（禁 user message prepend）

### Phase B（跨厂商 review + E2E）

- [ ] AC-B1: 跨厂商 review 配对基于盲点不重叠（依赖 F001 CapabilityProfile）
- [ ] AC-B2: 状态推进延迟 < 50ms
- [ ] AC-B3: TeamAct 终止条件达成率 ≥ 90%
- [ ] AC-B4: 交接胶囊完整率 100%
- [ ] AC-B5: E2E 测试 — 3 个灵智体协作完成一个 Feature（如"创建猫灵智体"），交接胶囊正确传递，五项终止条件全部达成
- [ ] AC-B6: 遵守 T1-T8 测试铁律（真实 LLM 调用、真实场景数据、不跳过验证、不 Mock 工具、采集完整指标、LLM 生成内容经 LLM 审核、Web 功能操控浏览器验证 DOM）

## 4. 依赖

- **Evolved from**: 无
- **Blocked by**: F001（CapabilityProfile 用于 owner 选择）
- **Related**: F003（交接胶囊）、F004（乒乓球熔断器）、F005（行首 @ 路由）、F006（持球注册 lease）、F007（Generator Push Back）、F008（Durable State Surfaces 用于状态持久化）

## 5. 风险

| 风险 | 缓解 |
|------|------|
| 灵智体伪造终止条件 | 证据锚点 + 跨厂商 review + Eval 信号 |
| 五项终止条件拖慢迭代 | Phase A 先跑通基础循环，Phase B 补齐 Eval |
| 交接胶囊格式漂移 | Pydantic Schema 强校验 |
| 乒乓球熔断误判 | max_iterations 可配置（默认 3） |

## 6. Open Questions

| # | 问题 | 状态 |
|---|------|------|
| OQ-1 | TeamAct 状态是否需要支持回滚（Route → Action）？ | ⬜ 未定 |
| OQ-2 | 五项终止条件中"vision_converged"由 operator 还是灵议 MindCouncil 确认？ | ⬜ 未定 |
| OQ-3 | 跨厂商 review 是否需要至少 2 个不同厂商？ | ⬜ 未定 |

## 7. Key Decisions

| # | 决策 | 理由 | 日期 |
|---|------|------|------|
| KD-1 | TeamAct 六步循环 + 五项终止条件 | `[doc:roleagent.md#第2章]` 主张 | 2026-07-17 |
| KD-2 | 交接胶囊是协议层硬要求 | 避免后继灵智体重读全部上下文 | 2026-07-17 |
| KD-3 | 跨厂商 review 不能被 proxy 替代 | "CI 通过"≠"愿景对齐" | 2026-07-17 |
| KD-4 | 五项终止条件缺一不可 | 防止单灵智体收尾惯性幻觉 | 2026-07-17 |

## 8. Timeline

| 日期 | 事件 |
|------|------|
| 2026-07-17 | 立项，确立 TeamAct 六步循环 Feature 规格，术语对齐项目正式命名 |

## 9. Review Gate

- Phase A: 单元测试通过，TeamActState 状态机由架构师灵智体 review
- Phase B: E2E 测试由跨厂商 reviewer 灵智体 review，终止条件达成率与交接胶囊完整率达标

## 10. Links

| 类型 | 路径 | 说明 |
|------|------|------|
| **ADR** | `docs/decisions/002-collaboration-protocol.md` | 协作协议决策 |
| **Feature** | `docs/features/F001-capability-profile.md` | owner 选择依赖能力画像 |
| **Feature** | `docs/features/F003-handoff-capsule.md` | 交接胶囊 Feature |
| **Feature** | `docs/features/F004-pingpong-circuit-breaker.md` | 乒乓球熔断器 Feature |
| **VISION** | `docs/VISION.md#4` | 协作单位：动态能力画像路由 |
| **VISION** | `docs/VISION.md#6` | operator 原则第 6 条（支持自己开发自己） |
| **roleagent** | `docs/roleagent.md#第2章` | 团队主循环 |
