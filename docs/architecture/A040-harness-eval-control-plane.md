# A040: Harness Eval 控制面架构设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.5]（FR-CORE-005 Eval 自代谢系统 / FR-CORE-030 Harness Eval 控制面）
> **对应 arch.md**: [doc:../arch.md#§3.5]
> **对应 design.md**: [doc:../design.md#§3.5]（待创建）
> **对应 Feature**: [doc:../features/F040-harness-eval-control-plane.md]（同号 Feature 级 SRS）
> **对应详细设计**: [doc:../design/D040-harness-eval-control-plane.md]（待创建，同号 Feature 级 SDD）
> **依赖 ADR**: [doc:../decisions/009-eval-self-metabolism.md]

---

## 1. 架构上下文

### 1.1 架构问题

本 Feature 在架构层解决以下问题：forgemind 应用层（Layer 2）需要一个 Harness Eval 控制面，作为 roleagent.md 第 5 章 Eval 终态——统一 Eval Hub（评估中枢），不是指标看板，而是 harness 生命周期的控制面：哪块机制正在增值 / 折旧 / 需要行动 / 成为瓶颈。该控制面统一调度 F018 Eval Contract / F019 三方信号 / F020 七类归因的信号采集、汇总、分析与行动派发，让 Eval 自代谢从"每个 eval 线各自维护定时任务"进化为"统一控制面编排"。

具体子问题：
- **控制面定位**：控制面是 forgemind 应用层模块还是独立项目? 与 F018/F019/F020 三个 eval 线的层级关系如何?
- **四态判定**：增值（appreciating）/ 折旧（depreciating）/ 需要行动（action_needed）/ 瓶颈（bottleneck）/ 稳定（stable）五态如何判定? 判定阈值如何外置?
- **每日汇总**：每日 02:00 汇总任务如何聚合 F018 契约 + F019 信号 + F020 归因三个数据源? 汇总产物如何更新每个组件的 lifecycle_state?
- **行动建议派发**：depreciating → F012 sunset review / action_needed → F020 修复路由 / bottleneck → 升级 CVO 重构，三种行动如何按状态派发到对应处理方?
- **趋势分析**：归因分布按时间窗口聚合如何识别"哪类根因最频繁"? 趋势数据如何持久化供审计?
- **operator 拉闸权**：bottleneck 状态升级 CVO 重构是否必须 operator 批准? 跨层迁移如何记录到 F038 谱系?

### 1.2 架构约束

- **单向依赖约束**：控制面模块属于 forgemind 应用层（Layer 2），单向依赖 FlowForge 核心框架层（Layer 1）的 F008 / F012 / F018 / F019 / F020，禁止反向依赖
- **DI 容器约束**：ControlPlaneAPI / DailySummarizer / ActionRecommender 必须通过 DI 容器注入，禁止绕过 DI 直接实例化（编程红线第 12 条）
- **Repository 层约束**：控制面状态必须通过 Repository 层持久化，禁止直接操作数据库（编程红线第 13 条）
- **配置驱动约束**：汇总 cron 表达式 / 四态阈值 / 行动路由规则必须外置 YAML 配置，禁止硬编码（编程红线第 11 条）
- **统一控制面约束**：全系统仅允许一个 ControlPlaneAPI 实例，禁止多控制面分裂导致状态不一致
- **状态机约束**：五态转换必须遵循明确规则，禁止跳跃（如 stable → bottleneck 必须经 action_needed 中转）
- **operator 拉闸权约束**：bottleneck → escalate_cvo_refactor 必须经过 operator 批准，禁止自动触发不可逆操作
- **只读视图约束**：dashboard_data_source 必须只读控制面状态，禁止 dashboard 直接修改 lifecycle_state

### 1.3 架构影响

- **对 forgemind 应用层（Layer 2）的影响**：新增 `flowforge/forgemind/eval_control/` 模块，承载 ControlPlaneAPI / DailySummarizer / ActionRecommender / ControlPlaneRepository
- **对 F012 Entropy Control 的影响**：控制面是 F012 sunset review 的折旧判定来源，depreciating 状态自动触发 F012 sunset review 流程
- **对 F018 Eval Contract 的影响**：控制面消费 F018 契约的 friction_metrics 作为摩擦分输入，contract_id 是组件状态的锚点
- **对 F019 三方信号交叉的影响**：控制面消费 F019 三方信号作为增值分输入，信号冲突时触发 action_needed 状态
- **对 F020 七类归因矩阵的影响**：控制面消费 F020 归因结果作为 attribution_distribution，归因频发触发 action_needed 状态
- **对 F039 蒸馏知识库可检索的影响**：控制面产出的"组件生命周期趋势"作为元知识可被蒸馏写入蒸馏知识库
- **对 F008 Durable State Surfaces 的影响**：控制面状态复用 F008 持久表面存储，与 F014 EchoStore存储隔离
- **对 CVO（Chief Vision Officer）的影响**：bottleneck 状态升级 CVO 重构，CVO 接收升级通知并决定是否启动重构
- **对 dashboard 的影响**：dashboard 必须只读控制面状态，禁止直接写入

---

## 2. 架构设计

### 2.1 组件架构图

```
┌──────────────────────────────────────────────────────────────────────┐
│ Eval 信号源（Layer 1 核心框架层，三个 eval 线 + 熵控）               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│  │ F018     │  │ F019     │  │ F020     │  │ F012     │            │
│  │ Eval     │  │ 三方信号 │  │ 七类归因 │  │ Entropy  │            │
│  │ Contract │  │ 交叉     │  │ 矩阵     │  │ Control  │            │
│  │ 五问契约 │  │ 增值分   │  │ 归因分布 │  │ 退役控   │            │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────▲─────┘            │
└───────┼─────────────┼─────────────┼─────────────┼──────────────────┘
        │ contract_id │ signals     │ attribution │ sunset review
        │ friction    │ appreciation│ distribution│ 触发
        ▼             ▼             ▼             │
┌──────────────────────────────────────────────────────────────────────┐
│ Layer 2: forgemind 应用层                                            │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ flowforge/forgemind/eval_control/                             │  │
│  │                                                                │  │
│  │  ┌──────────────────────────────────────────────────────────┐ │  │
│  │  │ ControlPlaneAPI（控制面 API，唯一实例）                  │ │  │
│  │  │  ├─ get_status        查询组件状态                     │ │  │
│  │  │  ├─ list_by_state     按状态列表                       │ │  │
│  │  │  └─ trigger_action    触发行动（operator 拉闸权校验）  │ │  │
│  │  └──────────────────────────────────────────────────────────┘ │  │
│  │                                                                │  │
│  │  ┌──────────────────────────────────────────────────────────┐ │  │
│  │  │ DailySummarizer（每日 02:00 汇总任务）                   │ │  │
│  │  │  ├─ 聚合 F018 契约 + F019 信号 + F020 归因              │ │  │
│  │  │  ├─ 计算 appreciation_score / friction_score            │ │  │
│  │  │  ├─ 更新每个组件的 lifecycle_state                       │ │  │
│  │  │  └─ 输出 DailySummary                                    │ │  │
│  │  └──────────────────────────────────────────────────────────┘ │  │
│  │                                                                │  │
│  │  ┌──────────────────────────────────────────────────────────┐ │  │
│  │  │ ActionRecommender（行动建议派发器）                      │ │  │
│  │  │  ├─ depreciating  → F012 sunset review                  │ │  │
│  │  │  ├─ action_needed → F020 修复路由                       │ │  │
│  │  │  ├─ bottleneck    → escalate CVO refactor（operator）   │ │  │
│  │  │  └─ stable        → 无行动                              │ │  │
│  │  └──────────────────────────────────────────────────────────┘ │  │
│  │                                                                │  │
│  │  ┌──────────────────────────────────────────────────────────┐ │  │
│  │  │ TrendAnalyzer（趋势分析器）                              │ │  │
│  │  │  ├─ 归因分布按时间窗口聚合                              │ │  │
│  │  │  ├─ 识别"哪类根因最频繁"                                │ │  │
│  │  │  └─ 输出 TrendReport（供审计 + F039 蒸馏）              │ │  │
│  │  └──────────────────────────────────────────────────────────┘ │  │
│  │                                                                │  │
│  │  ┌──────────────────────────────────────────────────────────┐ │  │
│  │  │ ControlPlaneRepository（持久层，复用 F008 持久表面）     │ │  │
│  │  │  ├─ save_component_status                             │ │  │
│  │  │  ├─ query_history                                     │ │  │
│  │  │  └─ distinguish_from_echo_store: true                   │ │  │
│  │  └──────────────────────────────────────────────────────────┘ │  │
│  └────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────┬─────────────────────────────────────┘
                                 │ 行动派发
                                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│ 行动处理方                                                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐   │
│  │ F012 Sunset  │  │ F020 修复    │  │ CVO 重构升级             │   │
│  │ Reviewer     │  │ Router       │  │ （operator 拉闸权）       │   │
│  │ 折旧退役审查 │  │ 归因派发修复 │  │ 架构重构决策             │   │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.2 关键架构决策

- **决策 1：控制面作为 forgemind 应用层模块（非独立项目）**
  - 理由：控制面是 forgemind 应用层的编排者，与Forgekin（Evolvable Agent，社区社交称"灵智体"）生命周期管理强耦合。独立成项目会导致 forgemind 与控制面跨项目调用，违反"上层可以依赖下层，下层绝对禁止导入上层模块"的单向依赖铁律
  - 替代方案：独立项目 `evalcontrol/` → 跨项目 RPC 调用，引入网络延迟与故障域分裂，且控制面需访问 F018/F019/F020 内部状态，跨项目访问破坏封装
- **决策 2：四态判定 + 稳定态（共五态）状态机**
  - 理由：roleagent.md 第 5 章明确"增值 / 折旧 / 需要行动 / 成为瓶颈"四态，加上"稳定"作为初始/恢复态，共五态。状态机驱动让组件生命周期可追溯，避免状态跳跃（如 stable → bottleneck 必须经 action_needed 中转）
  - 替代方案：自由状态转换 → 状态跳跃导致审计困难，无法回溯"组件如何从稳定变成瓶颈"
- **决策 3：每日 02:00 汇总任务（cron 调度）**
  - 理由：F019 三方信号 / F020 归因结果在一天内累积，每日 02:00 低峰期汇总可避免与生产负载争抢资源。汇总产物作为前一天的"生命周期快照"持久化
  - 替代方案：实时汇总 → 信号采集频率不稳定导致生命周期状态抖动，且实时计算成本高
- **决策 4：行动建议按状态派发到对应处理方**
  - 理由：depreciating 触发 F012 sunset review（折旧退役审查）、action_needed 触发 F020 修复路由（按归因类型派发修复）、bottleneck 升级 CVO 重构（架构层面决策）。三种行动对应不同严重级别与处理方，避免"一刀切"派发
  - 替代方案：统一派发给 operator → operator 负担过重，且 F012/F020 已有自动化处理流程，无需 operator 介入
- **决策 5：operator 拉闸权（bottleneck 升级 CVO 必须批准）**
  - 理由：bottleneck → escalate_cvo_refactor 是不可逆操作（架构重构），必须 operator 批准防止自动触发导致系统不稳定。这是"六层 Guardrails"中的 Action Confirmation 层
  - 替代方案：自动触发 CVO 重构 → 不可逆操作无人工确认，可能引发连锁故障
- **决策 6：趋势分析按时间窗口聚合归因分布**
  - 理由：F020 归因结果按时间窗口（如 7 天 / 30 天）聚合，可识别"哪类根因最频繁"，为架构师 Forgekin（猫头鹰·鲁班）提供重构优先级依据。趋势数据可被蒸馏写入 F039 蒸馏知识库作为元知识
  - 替代方案：仅看当前归因分布 → 无法识别长期趋势，可能错过"缓慢恶化的根因"
- **决策 7：复用 F008 持久表面（与 F014 EchoStore存储隔离）**
  - 理由：F008 Durable State Surfaces 已提供持久化能力，控制面状态复用 F008 避免重复造轮子。与 F014 EchoStore存储隔离，避免控制面状态与原始任务日志混淆
  - 替代方案：自建存储 → 违反"配置驱动 > 代码继承 > 独立实现"原则，且 F008 已提供持久表面抽象
- **决策 8：单一 ControlPlaneAPI 实例（禁止多控制面分裂）**
  - 理由：控制面是全系统唯一的 Eval 编排者，多实例会导致 lifecycle_state 不一致。DI 容器以 singleton scope 注册 ControlPlaneAPI
  - 替代方案：多控制面实例 → 状态分裂，dashboard 无法确定读哪个实例
- **决策 9：dashboard_data_source 只读控制面状态**
  - 理由：dashboard 必须只读控制面状态，禁止直接写入 lifecycle_state。写入路径必须经 ControlPlaneAPI.trigger_action 并通过 operator 拉闸权校验
  - 替代方案：dashboard 直接写入 → 绕过 Action Confirmation 层，可能误操作

### 2.3 架构不变量

- 控制面模块必须属于 forgemind 应用层（Layer 2），禁止独立成项目
- 全系统必须仅有一个 ControlPlaneAPI 实例（DI singleton scope）
- 每日汇总任务必须 02:00 cron 调度，聚合 F018 + F019 + F020 三个数据源
- 四态判定必须按阈值外置配置（appreciation_threshold / friction_threshold / bottleneck_consecutive_days）
- 行动建议必须按状态派发（depreciating→F012 / action_needed→F020 / bottleneck→CVO）
- bottleneck → escalate_cvo_refactor 必须 operator 批准（不可逆操作拉闸权）
- 五态转换必须遵循状态机规则，禁止跳跃（stable → bottleneck 必须经 action_needed 中转）
- 控制面状态必须复用 F008 持久表面，与 F014 EchoStore存储隔离
- dashboard_data_source 必须只读控制面状态，禁止直接写入 lifecycle_state
- 所有控制面规则必须外置 YAML 配置，禁止硬编码

---

## 3. 模块设计

### 3.1 模块边界

- **ControlPlaneAPI（`flowforge/forgemind/eval_control/api.py`）**：控制面 API，提供组件状态查询、按状态列表、行动触发（含 operator 拉闸权校验）
- **DailySummarizer（`flowforge/forgemind/eval_control/summarizer.py`）**：每日 02:00 汇总任务，聚合 F018/F019/F020 数据并更新 lifecycle_state
- **ActionRecommender（`flowforge/forgemind/eval_control/recommender.py`）**：行动建议派发器，按状态派发到 F012/F020/CVO
- **TrendAnalyzer（`flowforge/forgemind/eval_control/trend.py`）**：趋势分析器，按时间窗口聚合归因分布
- **LifecycleStateMachine（`flowforge/forgemind/eval_control/state_machine.py`）**：五态状态机，校验状态转换合法性
- **ControlPlaneRepository（`flowforge/forgemind/eval_control/repository.py`）**：持久层，复用 F008 持久表面，与 F014 EchoStore存储隔离
- **models（`flowforge/forgemind/eval_control/models.py`）**：数据模型（HarnessLifecycleState / HarnessComponentStatus / DailySummary / TrendReport / Action）

### 3.2 接口契约

```python
from abc import ABC, abstractmethod
from datetime import datetime
from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, Field


class HarnessLifecycleState(str, Enum):
    """harness 组件生命周期状态（五态状态机）"""
    STABLE = "stable"                        # 稳定（初始/恢复态）
    APPRECIATING = "appreciating"            # 增值（产出 > 摩擦）
    DEPRECIATING = "depreciating"            # 折旧（摩擦 > 产出）
    ACTION_NEEDED = "action_needed"          # 需要行动（信号冲突或归因频发）
    BOTTLENECK = "bottleneck"                # 成为瓶颈（持续折旧 + 阻塞其他）


class HarnessComponentStatus(BaseModel):
    """harness 组件状态"""
    component_id: str = Field(description="组件 ID")
    contract_id: str = Field(
        description="关联 F018 Eval Contract 契约 ID"
    )
    lifecycle_state: HarnessLifecycleState = Field(
        default=HarnessLifecycleState.STABLE,
        description="生命周期状态"
    )
    appreciation_score: float = Field(
        ge=0.0, le=1.0,
        description="增值分（来自 F019 三方信号）"
    )
    friction_score: float = Field(
        ge=0.0, le=1.0,
        description="摩擦分（来自 F018 契约 friction_metrics）"
    )
    attribution_distribution: dict[str, int] = Field(
        default_factory=dict,
        description="七类归因分布（来自 F020）"
    )
    consecutive_depreciating_days: int = Field(
        default=0,
        description="连续折旧天数（bottleneck 判定依据）"
    )
    last_action: Optional[str] = Field(
        default=None,
        description="最后触发的行动 ID"
    )
    updated_at: datetime = Field(
        default_factory=datetime.utcnow,
        description="最后更新时间"
    )


class DailySummary(BaseModel):
    """每日汇总产物"""
    summary_id: str
    summary_date: datetime
    component_statuses: list[HarnessComponentStatus]
    top_attribution_classes: list[str] = Field(
        description="当日最频繁的归因类型 Top 5"
    )
    actions_dispatched: list[str] = Field(
        default_factory=list,
        description="当日派发的行动 ID 列表"
    )


class TrendReport(BaseModel):
    """趋势报告"""
    report_id: str
    window_days: int = Field(description="时间窗口（天）")
    start_date: datetime
    end_date: datetime
    attribution_frequency: dict[str, int] = Field(
        description="归因类型 → 出现次数"
    )
    state_transitions: list[dict] = Field(
        description="状态转换历史"
    )
    bottleneck_candidates: list[str] = Field(
        description="瓶颈候选组件（持续折旧接近阈值）"
    )


class Action(BaseModel):
    """行动建议"""
    action_id: str
    component_id: str
    action_type: Literal[
        "F012_sunset_review",
        "F020_fix_router",
        "escalate_cvo_refactor",
        "no_action",
    ]
    trigger_state: HarnessLifecycleState
    requires_operator_approval: bool = Field(
        default=False,
        description="是否需要 operator 拉闸权批准"
    )
    dispatched_at: datetime
    payload: dict = Field(
        default_factory=dict,
        description="派发给处理方的上下文数据"
    )


class ControlPlaneAPI(ABC):
    """Harness Eval 控制面 API（DI singleton scope）"""

    @abstractmethod
    async def get_status(
        self, component_id: str
    ) -> HarnessComponentStatus:
        """查询组件状态

        前置条件:
        - component_id 必须在 F018 契约注册表中存在
        """
        ...

    @abstractmethod
    async def list_by_state(
        self, state: HarnessLifecycleState
    ) -> list[HarnessComponentStatus]:
        """按状态列表组件"""
        ...

    @abstractmethod
    async def trigger_action(
        self,
        component_id: str,
        action: str,
        operator_id: Optional[str] = None,
    ) -> Action:
        """触发行动

        拉闸权规则:
        - F012_sunset_review / F020_fix_router: 无需 operator 批准
        - escalate_cvo_refactor: 必须 operator_id 非空且经
          operator 拉闸权校验
        """
        ...

    @abstractmethod
    async def get_trend(
        self,
        window_days: int,
        component_id: Optional[str] = None,
    ) -> TrendReport:
        """查询趋势报告"""
        ...


class DailySummarizer(ABC):
    """每日汇总任务（02:00 cron 调度）"""

    @abstractmethod
    async def summarize(self) -> DailySummary:
        """汇总任务

        步骤:
        1. 从 F018 拉取所有契约的 friction_metrics
        2. 从 F019 拉取三方信号的 appreciation 分
        3. 从 F020 拉取当日归因分布
        4. 计算 appreciation_score / friction_score
        5. 按 LifecycleStateMachine 规则更新 lifecycle_state
        6. 持久化到 ControlPlaneRepository
        7. 触发 ActionRecommender 派发行动
        """
        ...


class ActionRecommender(ABC):
    """行动建议派发器"""

    @abstractmethod
    def recommend(
        self, status: HarnessComponentStatus
    ) -> list[Action]:
        """按状态派发行动

        派发规则:
        - STABLE: 无行动
        - APPRECIATING: 无行动（记录趋势）
        - DEPRECIATING: 派发 F012_sunset_review
        - ACTION_NEEDED: 派发 F020_fix_router
        - BOTTLENECK: 派发 escalate_cvo_refactor
          （requires_operator_approval=True）
        """
        ...


class TrendAnalyzer(ABC):
    """趋势分析器"""

    @abstractmethod
    async def analyze(
        self,
        window_days: int,
        component_id: Optional[str] = None,
    ) -> TrendReport:
        """按时间窗口聚合归因分布

        输出:
        - attribution_frequency: 归因类型 → 出现次数
        - state_transitions: 状态转换历史
        - bottleneck_candidates: 持续折旧接近阈值的组件
        """
        ...


class LifecycleStateMachine(ABC):
    """五态状态机"""

    @abstractmethod
    def can_transition(
        self,
        from_state: HarnessLifecycleState,
        to_state: HarnessLifecycleState,
    ) -> bool:
        """校验状态转换合法性

        合法转换:
        - STABLE ↔ APPRECIATING
        - STABLE ↔ DEPRECIATING
        - APPRECIATING → STABLE
        - DEPRECIATING → ACTION_NEEDED
        - ACTION_NEEDED → BOTTLENECK
        - ACTION_NEEDED → STABLE（修复后恢复）
        - BOTTLENECK → ACTION_NEEDED（CVO 重构后）
        - 禁止: STABLE → BOTTLENECK（必须经 ACTION_NEEDED 中转）
        """
        ...


class ControlPlaneRepository(ABC):
    """控制面持久层（抽象接口，复用 F008 持久表面）"""

    @abstractmethod
    async def save_component_status(
        self, status: HarnessComponentStatus
    ) -> None: ...

    @abstractmethod
    async def query_history(
        self,
        component_id: str,
        start_date: datetime,
        end_date: datetime,
    ) -> list[HarnessComponentStatus]: ...

    @abstractmethod
    async def save_daily_summary(
        self, summary: DailySummary
    ) -> None: ...
```

### 3.3 数据流

```
每日汇总流（02:00 cron 触发）:
  ┌────────────────┐
  │ Cron Scheduler │
  │ 02:00 触发     │
  └────────┬───────┘
           │ 1. summarize
           ▼
  ┌────────────────────────────────────────────┐
  │ DailySummarizer                            │
  │  ├─ 从 F018 拉取契约 friction_metrics     │
  │  ├─ 从 F019 拉取三方信号 appreciation     │
  │  ├─ 从 F020 拉取当日归因分布              │
  │  └─ 计算 appreciation_score / friction    │
  └────────┬───────────────────────────────────┘
           │ 2. 候选状态
           ▼
  ┌────────────────────────────────────────────┐
  │ LifecycleStateMachine                      │
  │  ├─ can_transition 校验转换合法性       │
  │  ├─ depreciating 连续 N 天 → bottleneck   │
  │  └─ 输出最终 lifecycle_state              │
  └────────┬───────────────────────────────────┘
           │ 3. 更新后的状态
           ▼
  ┌────────────────────────────────────────────┐
  │ ControlPlaneRepository                     │
  │  ├─ save_component_status               │
  │  ├─ save_daily_summary                  │
  │  └─ 复用 F008 持久表面                    │
  └────────┬───────────────────────────────────┘
           │ 4. 派发行动
           ▼
  ┌────────────────────────────────────────────┐
  │ ActionRecommender.recommend              │
  │  ├─ depreciating  → F012 sunset review   │
  │  ├─ action_needed → F020 fix router      │
  │  ├─ bottleneck    → escalate CVO         │
  │  │                   （operator 拉闸权）  │
  │  └─ stable/appreciating → 无行动          │
  └────────────────────────────────────────────┘

行动触发流（operator 或自动派发）:
  ┌────────────────┐
  │ 调用方         │
  │ （汇总任务 /   │
  │  operator）    │
  └────────┬───────┘
           │ 1. trigger_action(component_id, action)
           ▼
  ┌────────────────────────────────────────────┐
  │ ControlPlaneAPI.trigger_action           │
  │  ├─ 校验 component_id 存在                │
  │  ├─ 校验 action 与当前状态匹配           │
  │  └─ 拉闸权校验:                           │
  │     ├─ F012/F020: 无需 operator 批准     │
  │     └─ escalate_cvo_refactor:            │
  │        必须 operator_id 非空              │
  └────────┬───────────────────────────────────┘
           │ 2. 校验通过
           ▼
  ┌────────────────────────────────────────────┐
  │ 行动处理方派发                             │
  │  ├─ F012 SunsetReviewer.start_review    │
  │  ├─ F020 FixRouter.dispatch(attribution)  │
  │  └─ CVO 通知（升级重构决策）              │
  └────────┬───────────────────────────────────┘
           │ 3. 行动记录
           ▼
  ┌────────────────────────────────────────────┐
  │ ControlPlaneRepository                     │
  │  ├─ 更新 last_action                       │
  │  └─ 持久化行动记录供审计                  │
  └────────────────────────────────────────────┘

趋势分析流（按需查询）:
  ┌────────────────┐
  │ 架构师 Forgekin   │
  │ （猫头鹰·鲁班）│
  │  "查询 30 天   │
  │   趋势"        │
  └────────┬───────┘
           │ 1. get_trend(window_days=30)
           ▼
  ┌────────────────────────────────────────────┐
  │ TrendAnalyzer.analyze                    │
  │  ├─ 从 Repository 拉取历史状态             │
  │  ├─ 按 7/30 天窗口聚合归因分布            │
  │  ├─ 识别"哪类根因最频繁"                  │
  │  └─ 识别 bottleneck_candidates            │
  └────────┬───────────────────────────────────┘
           │ 2. TrendReport
           ▼
  ┌────────────────────────────────────────────┐
  │ 输出                                        │
  │  ├─ 架构师决策重构优先级                   │
  │  ├─ 蒸馏到 F039 蒸馏知识库作为元知识            │
  │  └─ dashboard 只读展示                     │
  └────────────────────────────────────────────┘
```

---

## 4. 跨模块协作

### 4.1 上游依赖

- **F008 Durable State Surfaces**：控制面状态持久化复用 F008 持久表面，与 F014 EchoStore存储隔离
- **F012 Entropy Control**：控制面是 F012 sunset review 的折旧判定来源，depreciating 状态触发 F012 流程
- **F018 Eval Contract**：控制面消费 F018 契约的 friction_metrics 作为摩擦分输入，contract_id 是组件状态锚点
- **F019 三方信号交叉**：控制面消费 F019 三方信号作为增值分输入，信号冲突触发 action_needed
- **F020 七类归因矩阵**：控制面消费 F020 归因结果作为 attribution_distribution，归因频发触发 action_needed
- **APScheduler**：每日 02:00 cron 调度 DailySummarizer
- **ADR 009 Eval 自代谢**：本 Feature 是 ADR 009 的终态控制面落地

### 4.2 下游影响

- **F039 蒸馏知识库可检索**：控制面产出的趋势报告作为元知识可被蒸馏写入蒸馏知识库，供Forgekin检索"哪类根因最频繁"
- **F038 进化谱系**：bottleneck 状态升级 CVO 重构如涉及Forgekin跨层迁移，需记录到 F038 谱系
- **CVO（Chief Vision Officer）**：bottleneck 状态升级 CVO 重构，CVO 接收通知并决定是否启动架构重构
- **dashboard**：dashboard 必须只读控制面状态，展示组件生命周期、趋势报告、行动记录
- **operator 控制台**：operator 通过控制台批准 bottleneck → escalate_cvo_refactor 行动（拉闸权）
- **架构师 Forgekin（猫头鹰·鲁班）**：消费趋势报告决定重构优先级

### 4.3 跨模块不变量

- 控制面状态必须与 F018 契约的 contract_id 一一对应（无契约组件不进入控制面）
- 摩擦分（friction_score）必须来自 F018 契约的 friction_metrics，禁止控制面自算
- 增值分（appreciation_score）必须来自 F019 三方信号，禁止控制面自算
- 归因分布（attribution_distribution）必须来自 F020 七类归因，禁止控制面自分类
- depreciating → F012 sunset review 派发必须自动触发（无需 operator 批准）
- escalate_cvo_refactor 必须 operator 批准（不可逆操作拉闸权）
- 控制面状态持久化必须复用 F008，禁止与 F014 EchoStore存储混用
- dashboard 必须只读控制面状态，禁止直接写入 lifecycle_state

---

## 5. 架构验收

### 5.1 架构契约验收

- [ ] AC-1: 单向依赖通过——eval_control 模块不 import 任何 *Forge 模块，且不被 F018/F019/F020 反向依赖
- [ ] AC-2: DI 容器注入通过——ControlPlaneAPI / DailySummarizer / ActionRecommender 通过 DI 容器注入且 ControlPlaneAPI 为 singleton scope
- [ ] AC-3: Repository 层通过——ControlPlaneRepository 抽象存在且复用 F008 持久表面，与 F014 EchoStore存储隔离
- [ ] AC-4: 配置驱动通过——summary_schedule / appreciation_threshold / friction_threshold / bottleneck_consecutive_days / action_routing 外置 YAML
- [ ] AC-5: 五态状态机通过——LifecycleStateMachine 校验转换合法性，禁止 STABLE → BOTTLENECK 跳跃
- [ ] AC-6: 每日汇总通过——DailySummarizer 聚合 F018 + F019 + F020 三个数据源并更新 lifecycle_state
- [ ] AC-7: 行动派发通过——ActionRecommender 按状态派发（depreciating→F012 / action_needed→F020 / bottleneck→CVO）
- [ ] AC-8: 趋势分析通过——TrendAnalyzer 按时间窗口聚合归因分布并识别 bottleneck_candidates

### 5.2 架构不变量验收

- [ ] AC-9: 全系统仅有一个 ControlPlaneAPI 实例（DI singleton scope 校验通过）
- [ ] AC-10: bottleneck → escalate_cvo_refactor 必须 operator 批准（拉闸权校验通过）
- [ ] AC-11: 控制面状态持久化复用 F008，与 F014 EchoStore存储物理隔离（distinguish_from_echo_store=true）
- [ ] AC-12: dashboard_data_source 只读控制面状态，无写入路径
- [ ] AC-13: friction_score 来自 F018 friction_metrics（非控制面自算）
- [ ] AC-14: appreciation_score 来自 F019 三方信号（非控制面自算）
- [ ] AC-15: attribution_distribution 来自 F020 七类归因（非控制面自分类）

---

## 6. 引用

- [doc:../spec.md#§3.5]（FR-CORE-005 Eval 自代谢系统三层 eval）
- [doc:../spec.md#§3.16]（FR-CORE-030 Harness Eval 控制面）
- [doc:../arch.md#§3.5]（Eval 自代谢系统架构）
- [doc:../features/F040-harness-eval-control-plane.md]（同号 Feature 级 SRS）
- [doc:../features/F008-durable-state-surfaces.md]（持久状态层，控制面存储后端）
- [doc:../features/F012-entropy-control.md]（Entropy Control，sunset review 处理方）
- [doc:../features/F018-eval-contract.md]（Eval Contract，friction_metrics 来源）
- [doc:../features/F019-three-signal-cross.md]（三方信号交叉，appreciation 来源）
- [doc:../features/F020-seven-attribution.md]（七类归因矩阵，attribution 来源）
- [doc:../features/F038-forgemind-lineage.md]（进化谱系，跨层迁移记录）
- [doc:../features/F039-mind-codex-searchable.md]（蒸馏知识库可检索，趋势元知识蒸馏）
- [doc:../architecture/A018-eval-contract.md]（Eval Contract 架构，同源 ADR 009）
- [doc:../architecture/A019-three-signal-cross.md]（三方信号架构，同源 ADR 009）
- [doc:../architecture/A020-seven-attribution.md]（七类归因架构，同源 ADR 009）
- [doc:../decisions/009-eval-self-metabolism.md]（Eval 自代谢 ADR）
- [doc:../../../hiclaw/rules.md#第二部分]（原则 2 数据检索通过 Repository 层抽象，支持可插拔数据源适配器）
- [doc:../../../hiclaw/rules.md#第七部分]（编程红线第 10/11/12/13 条）
- [doc:../../../hiclaw/rules.md#第十一部分]（软件工程文档分层规范）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（架构骨架） | 架构师 Forgekin（猫头鹰·鲁班） |
