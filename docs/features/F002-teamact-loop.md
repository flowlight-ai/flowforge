# F002: TeamAct 六步循环

> **状态**: ⏳ pending
> **类型**: collaboration
> **创建日期**: 2026-07-17
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **依赖 ADR**: [doc:decisions/002-collaboration-protocol.md]
> **依赖 Feature**: [doc:features/F001-capability-profile.md]
> **依据**: [doc:review/review.md#第八章] RA-009~RA-016
> **roleagent 章节**: [doc:roleagent.md#第2章]
> **关联 VISION**: [doc:VISION.md#4]（协作单位：动态能力画像路由）
> **对应 spec.md**: [doc:../spec.md#§3.2]（FR-CORE-002，与本文档同号对应）
> **对应 arch.md**: [doc:../arch.md#§3.2]（待创建）
> **对应 design.md**: [doc:../design.md#§3.2]（待创建）

---

## 1. 上下文

### 1.1 问题陈述

当前 FlowForge 协作基于固定角色 + EventBus + Handoff，没有团队级终止条件。这导致：
- agent 互相传球永远循环，没有"团队停下来"机制
- 单 agent 判断"做完了"经常是幻觉（被 RLHF 训练出收尾惯性）
- 没有交接胶囊（前一个 agent 不留摘要，后一个 agent 重读全部上下文）

### 1.2 当前痛点

- *Forge 业务项目违反 P31 铁律（Agent 直接执行，未通过 LoopExecutor）
- 协作没有跨厂商 review 结构性必需
- 乒乓球熔断（ping-pong）无机制

### 1.3 不做的影响

- 无法实现 roleagent.md 第 2 章团队主循环
- Forgekin协作会陷入死循环
- 跨厂商 review 缺失导致同厂商盲点

---

## 2. 决策

### 2.1 核心设计

TeamAct 六步循环 + 五项终止条件（来自 `[doc:roleagent.md#第2章]`）：

```
loop:
    State    → 读共享状态（仓库 / spec / 任务 / 记忆 / 交接胶囊）
    Owner    → 谁持球？（路由指令 / 显式持有声明）
    Action   → 持球者执行（写代码 / review / 设计 / 调研）
    Evidence → 产出证据（commit / 测试 / trace / 截图）
    Verdict  → 验证（跨 agent review / 自检 / CVO 确认）
    Route    → 传球（路由给下一个 agent / 继续持有 / 升级给 CVO）
```

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
    acceptance_criteria_met: bool = False      # 1. 验收标准全部达成
    evidence_attached: bool = False            # 2. 证据已附
    cross_agent_verified: bool = False         # 3. 跨 agent 交叉验证
    no_dangling_ownership: bool = False        # 4. 无悬空任务归属
    vision_converged: bool = False             # 5. 愿景收敛（CVO 确认）
    
    def all_met(self) -> bool:
        return all([
            self.acceptance_criteria_met,
            self.evidence_attached,
            self.cross_agent_verified,
            self.no_dangling_ownership,
            self.vision_converged,
        ])


class HandoffCapsule(BaseModel):
    """交接胶囊（协议层硬要求）"""
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
    evidence_refs: list[str] = Field(default_factory=list)  # commit / 测试 / trace ID
    
    def advance(self, capsule: Optional[HandoffCapsule] = None) -> "TeamActState":
        """推进到下一步"""
        ...
    
    def is_terminated(self) -> bool:
        """检查是否满足五项终止条件"""
        return self.termination.all_met


class PingPongCircuitBreaker:
    """乒乓球熔断器（给数据不给结论）"""
    
    def __init__(self, max_iterations: int = 3):
        self.max_iterations = max_iterations
        self.iteration_counts: dict[str, int] = {}
    
    def should_break(self, team_id: str) -> bool:
        """检查是否触发熔断"""
        return self.iteration_counts.get(team_id, 0) >= self.max_iterations
    
    def record_iteration(self, team_id: str) -> None:
        """记录一次迭代"""
        self.iteration_counts[team_id] = self.iteration_counts.get(team_id, 0) + 1
```

### 2.3 关键不变量

- TeamAct 状态必须持久化（Durable State Surfaces，F008）
- 交接胶囊是协议层硬要求（不是可选礼貌）
- 跨厂商 review 不能被 proxy 替代（"CI 通过"≠"愿景对齐"）
- 五项终止条件缺一不可

---

## 3. 实现路径

### 3.1 代码位置

- `flowforge/core/teamact/state_machine.py` — TeamActState 状态机
- `flowforge/core/teamact/handoff.py` — HandoffCapsule 交接胶囊
- `flowforge/core/teamact/circuit_breaker.py` — PingPongCircuitBreaker 熔断器
- `flowforge/core/teamact/termination.py` — TerminationCondition 五项终止
- `flowforge/core/teamact/tests/test_state_machine.py` — 单元测试

### 3.2 实现步骤

1. 定义 Pydantic 数据模型（state_machine.py）
2. 实现 TeamActState.advance 状态推进
3. 实现 HandoffCapsule 协议
4. 实现 PingPongCircuitBreaker 熔断
5. 集成到 ForgekinEngine（替换 EventBus + Handoff）
6. 集成跨厂商 review（基于 F001 CapabilityProfile 盲点配对）

### 3.3 依赖关系

- 依赖 F001 CapabilityProfile（用于 owner 选择）
- 依赖 F008 Durable State Surfaces（用于状态持久化）
- 被 F003-F007 依赖（交接胶囊、熔断器、@ 路由等）

---

## 4. 验收标准

### 4.1 功能验收

- [ ] AC-1: TeamActState 可推进六步循环
- [ ] AC-2: 五项终止条件全部检查（不能跳过任一项）
- [ ] AC-3: HandoffCapsule 必须包含 5 字段（summary/rationale/tradeoffs/open_questions/next_step）
- [ ] AC-4: PingPongCircuitBreaker 在 max_iterations 触发熔断
- [ ] AC-5: 跨厂商 review 配对基于盲点不重叠

### 4.2 性能验收

- [ ] AC-6: 状态推进延迟 < 50ms

### 4.3 安全验收

- [ ] AC-7: TeamAct 状态通过 Repository 层持久化
- [ ] AC-8: 治理规则通过 system role 注入（禁 user message prepend）

### 4.4 Eval 验收

- [ ] AC-9: TeamAct 终止条件达成率 ≥ 90%
- [ ] AC-10: 交接胶囊完整率 100%

---

## 5. 测试计划

### 5.1 单元测试

- 测试六步循环推进
- 测试五项终止条件
- 测试交接胶囊 Schema 校验
- 测试乒乓球熔断器

### 5.2 集成测试

- 测试 ForgekinEngine 集成 TeamAct
- 测试跨厂商 review 配对

### 5.3 E2E 测试

- 3 个Forgekin协作完成一个 Feature（如"创建猫Forgekin"）
- 验证交接胶囊在 3 个Forgekin间正确传递
- 验证五项终止条件全部达成
- **遵守 T1-T8 铁律**：真实 LLM、真实数据、真实工具调用

---

## 6. Eval Contract（五问）

### 6.1 谁评估

- 跨厂商 reviewer Forgekin
- 自动探针（终止条件达成率）

### 6.2 评估什么

- 终止条件达成率
- 交接胶囊完整率
- 乒乓球熔断触发频率

### 6.3 何时评估

- 每次团队任务完成后
- 每周汇总协作效率

### 6.4 评估信号

- trace 信号：TeamAct 状态推进日志
- 用户信号：任务结果反馈
- 探针信号：终止条件达成率基准

### 6.5 评估后做什么

- 通过 → 持续累积
- 失败 → 归因到七类矩阵（通常是协作失败或 harness 错位）

---

## 7. Build to Delete vs Built to Persist

### 7.1 半衰期标记

**Built to Persist（复利型基础设施）**

### 7.2 理由

TeamAct 是 roleagent.md 第 1 章明确列出的"agent 交接协议"——编码 agent 之间的协作规则，不会因为单个模型更聪明而消失。

---

## 8. 后果

### 8.1 正面后果

- 团队协作有明确终止条件
- 交接胶囊让 agent 接手不需重读全部上下文
- 跨厂商 review 结构性消除同厂商盲点

### 8.2 负面后果

- 实现复杂度增加
- 五项终止条件可能拖慢迭代

### 8.3 风险

- Forgekin可能伪造终止条件（缓解：证据锚点 + 跨厂商 review）

---

## 9. 替代方案

### 9.1 方案 A: 保持 EventBus + Handoff

- 优点：零工作量
- 缺点：无团队级终止条件
- 未选择原因：违反 roleagent.md 第 2 章

### 9.2 方案 B: 用 LLM 判断终止

- 优点：灵活
- 缺点：LLM 收尾惯性幻觉
- 未选择原因：roleagent.md 明确指出此问题

---

## 10. 引用

- [doc:roleagent.md#第2章]
- [doc:decisions/002-collaboration-protocol.md]
- [doc:features/F001-capability-profile.md]
- [doc:features/F003-handoff-capsule.md]
- [doc:features/F004-pingpong-circuit-breaker.md]
- [doc:SOP.md]
- [doc:project_rules.md#红线9]

---

## 11. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-17 | v0.1 | 初始创建 | 架构师 Forgekin |
