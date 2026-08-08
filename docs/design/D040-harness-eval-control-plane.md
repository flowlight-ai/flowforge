# D040: Harness Eval 控制面详细设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 开发者 Forgekin（猎犬·夏洛克）
> **对应 spec.md**: [doc:../spec.md#§3.5]（FR-CORE-005 Eval 自代谢系统 / FR-CORE-030 Harness Eval 控制面）
> **对应 arch.md**: [doc:../arch.md#§3.5]（Eval 自代谢系统架构）
> **对应 design.md**: [doc:../design.md#§3.5]
> **对应 Feature**: [doc:../features/F040-harness-eval-control-plane.md]（同号 Feature 级 SRS）
> **对应 Architecture**: [doc:../architecture/A040-harness-eval-control-plane.md]（同号 Feature 级 SAD）
> **依赖 ADR**: [doc:../decisions/009-eval-self-metabolism.md]（Eval 自代谢 ADR）

---

## 1. 详细设计上下文

### 1.1 设计问题

本详细设计在 A040 架构设计基础上，深入到代码层落地 Harness Eval 控制面（Harness Eval Control Plane，社区社交称"harness 生命周期控制面"），需解决以下工程问题：

- **控制面 API 工程契约**：`ControlPlaneAPI` 提供 `get_status` / `list_by_state` / `trigger_action` / `get_trend` 四个抽象方法如何用 Python `abc.ABC` 落地? 单例（singleton scope）如何在 DI 容器中注册? 拉闸权校验如何嵌入 `trigger_action`?
- **DailySummarizer 多源聚合算法**：每日 02:00 cron 触发的 `summarize` 如何并行拉取 F018 契约 `friction_metrics` + F019 三方信号 `appreciation` + F020 七类归因分布? 三源数据如何按 `contract_id` 对齐合并?
- **五态状态机校验规则**：`LifecycleStateMachine.can_transition` 如何编码合法转换矩阵? `stable → bottleneck` 跳跃如何阻断? `consecutive_depreciating_days` 如何累加触发 `depreciating → bottleneck`?
- **ActionRecommender 派发策略**：`recommend` 如何按 `lifecycle_state` 派发对应行动? `escalate_cvo_refactor` 的 `requires_operator_approval=True` 如何传递到 `ControlPlaneAPI.trigger_action` 强制校验 `operator_id`?
- **TrendAnalyzer 时间窗口聚合**：`analyze(window_days)` 如何从 `ControlPlaneRepository.query_history` 拉取历史状态并按归因类型聚合频次? `bottleneck_candidates` 如何识别"持续折旧接近阈值"?
- **ControlPlaneRepository 复用 F008 持久表面**：如何通过 `DurableStateSurface` 抽象持久化 `HarnessComponentStatus`? 与 F014 EchoStore存储（EchoStore，情景记忆存储 / 智能体经验日志）如何物理隔离?
- **operator 拉闸权异步审批**：`escalate_cvo_refactor` 提交后如何挂起等待 operator 审批? 审批结果如何回写并触发 CVO 通知?

### 1.2 设计约束

- **单向依赖**：`flowforge/forgemind/eval_control/` 禁止 `import 任何 *Forge 业务模块`；仅可 `import flowforge/core/*` 与 `flowforge/forgemind/*`；禁止反向依赖（F018/F019/F020 不可 import 控制面模块）
- **DI 容器**：`ControlPlaneAPI` / `DailySummarizer` / `ActionRecommender` / `TrendAnalyzer` / `LifecycleStateMachine` / `ControlPlaneRepository` 必须由 DI 容器注入；`ControlPlaneAPI` 必须以 **singleton scope** 注册（全系统唯一实例）
- **Repository 层**：所有持久化必须经 `ControlPlaneRepository` 抽象，禁止 `cursor.execute` / `session.add` 直接调用（编程红线第 13 条）
- **配置驱动**：`summary_schedule` / `appreciation_threshold` / `friction_threshold` / `bottleneck_consecutive_days` / `action_routing` 必须来自 `flowforge/forgemind/config/harness_eval_control_plane.yaml`，禁止硬编码（编程红线第 11 条）
- **operator 拉闸权**：`escalate_cvo_refactor` 必须 `operator_id` 非空且经审批校验，禁止自动触发不可逆操作（六层 Guardrails 之 Action Confirmation 层）
- **只读视图**：dashboard 数据源必须只读控制面状态，写入路径仅 `ControlPlaneAPI.trigger_action`
- **状态机铁律**：五态转换必须遵循 `LifecycleStateMachine.can_transition` 矩阵，禁止 `stable → bottleneck` 跳跃（必须经 `action_needed` 中转）
- **数据来源不可越权**：`friction_score` 必须来自 F018；`appreciation_score` 必须来自 F019；`attribution_distribution` 必须来自 F020；控制面禁止自算或自分类

### 1.3 设计影响

- **新增模块**：`flowforge/forgemind/eval_control/` 下 7 个文件（`api.py` / `summarizer.py` / `recommender.py` / `trend.py` / `state_machine.py` / `repository.py` / `models.py`）
- **修改模块**：`flowforge/forgemind/plugins.py` 注册控制面到 DI 容器；`flowforge/forgemind/config/harness_eval_control_plane.yaml` 新增配置文件
- **影响 F012 Entropy Control**：`SunsetReviewer.start_review` 接收来自 `ActionRecommender` 的 `F012_sunset_review` 派发，`depreciating` 状态自动触发
- **影响 F018 Eval Contract**：契约表新增 `friction_metrics` 字段供控制面消费；`contract_id` 作为控制面组件状态锚点
- **影响 F019 三方信号交叉**：信号采集器新增导出接口供 `DailySummarizer` 拉取 `appreciation` 分；信号冲突标记触发 `action_needed`
- **影响 F020 七类归因矩阵**：归因结果导出接口供 `DailySummarizer` 拉取 `attribution_distribution`；归因频发（同一组件 24h 内 ≥ N 次）触发 `action_needed`
- **影响 F039 MindCodex 可检索知识库**：控制面产出的 `TrendReport` 作为元知识经 SpiritForge（经验蒸馏 / 离线策略学习 / 知识编译）蒸馏写入 MindCodex（蒸馏知识库 / 策展技能库 / 程序性记忆），供Forgekin（Evolvable Agent，社区社交称"可进化智能体"）检索"哪类根因最频繁"
- **影响 F038 进化谱系**：bottleneck 状态升级 CVO 重构如涉及Forgekin跨层迁移，需调用 `LineageStore.record_transition` 记录 `LAYER_TRANSITION` 边
- **影响 operator 控制台**：新增"控制面拉闸审批"页面，operator 通过该页面批准 `escalate_cvo_refactor`

---

## 2. 详细设计

### 2.1 类图 ASCII

```
                          ┌──────────────────────────────────────┐
                          │  <<abstract>>                        │
                          │  ControlPlaneAPI                     │
                          │  (forgemind/eval_control/api.py)     │
                          │  ──────────────────────────────────  │
                          │  + get_status(component_id)          │
                          │  + list_by_state(state)              │
                          │  + trigger_action(component_id,      │
                          │                    action,           │
                          │                    operator_id?)     │
                          │  + get_trend(window_days,            │
                          │               component_id?)         │
                          └──────────────────┬───────────────────┘
                                             │ implements
                                             ▼
                          ┌──────────────────────────────────────┐
                          │  ControlPlaneAPIImpl                 │
                          │  (singleton scope in DI)             │
                          │  ──────────────────────────────────  │
                          │  - repository: ControlPlaneRepository│
                          │  - state_machine: LifecycleStateMach.│
                          │  - recommender: ActionRecommender    │
                          │  - operator_approver: OperatorApprover│
                          │  + get_status(component_id)          │
                          │  + list_by_state(state)              │
                          │  + trigger_action(...)               │
                          │  + get_trend(window_days, ...)       │
                          └──────────────┬───────────────────────┘
                                         │ uses
                ┌────────────────────────┼─────────────────────────┐
                ▼                        ▼                         ▼
   ┌────────────────────────┐  ┌────────────────────────┐  ┌──────────────────────┐
   │ <<abstract>>           │  │ <<abstract>>           │  │ <<abstract>>         │
   │ DailySummarizer        │  │ ActionRecommender      │  │ LifecycleStateMachine│
   │ (summarizer.py)        │  │ (recommender.py)       │  │ (state_machine.py)   │
   │ ────────────────────   │  │ ────────────────────   │  │ ──────────────────   │
   │ + summarize          │  │ + recommend(status)    │  │ + can_transition     │
   │   -> DailySummary      │  │   -> list[Action]      │  │   (from, to) -> bool │
   └────────────────────────┘  └────────────────────────┘  └──────────────────────┘

                          ┌──────────────────────────────────────┐
                          │  <<abstract>>                        │
                          │  TrendAnalyzer                       │
                          │  (forgemind/eval_control/trend.py)   │
                          │  + analyze(window_days, comp_id?)    │
                          │    -> TrendReport                    │
                          └──────────────────────────────────────┘

                          ┌──────────────────────────────────────┐
                          │  <<abstract>>                        │
                          │  ControlPlaneRepository              │
                          │  (repository.py)                     │
                          │  + save_component_status(status)     │
                          │  + query_history(comp_id, start, end)│
                          │  + save_daily_summary(summary)       │
                          │  + save_transition_request(req)      │
                          └──────────────────────────────────────┘
```

### 2.2 Pydantic 数据模型

```python
# flowforge/forgemind/eval_control/models.py
from datetime import datetime
from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator


class HarnessLifecycleState(str, Enum):
    """harness 组件生命周期状态（五态状态机）

    AI 业界概念: Lifecycle State Machine / Component Health State
    （生命周期状态机 / 组件健康状态）
    """
    STABLE = "stable"                        # 稳定（初始/恢复态）
    APPRECIATING = "appreciating"            # 增值（产出 > 摩擦）
    DEPRECIATING = "depreciating"            # 折旧（摩擦 > 产出）
    ACTION_NEEDED = "action_needed"          # 需要行动（信号冲突或归因频发）
    BOTTLENECK = "bottleneck"                # 成为瓶颈（持续折旧 + 阻塞其他）


class HarnessComponentStatus(BaseModel):
    """harness 组件状态

    AI 业界概念: Component Health Snapshot / Service Level Indicator
    （组件健康快照 / 服务水平指标）
    """
    component_id: str = Field(description="组件 ID（与 F018 contract_id 一一对应）")
    contract_id: str = Field(
        description="关联 F018 Eval Contract 契约 ID"
    )
    lifecycle_state: HarnessLifecycleState = Field(
        default=HarnessLifecycleState.STABLE,
        description="生命周期状态"
    )
    appreciation_score: float = Field(
        ge=0.0, le=1.0,
        description="增值分（来自 F019 三方信号，0.0=无增值，1.0=完全增值）"
    )
    friction_score: float = Field(
        ge=0.0, le=1.0,
        description="摩擦分（来自 F018 契约 friction_metrics，0.0=无摩擦，1.0=完全摩擦）"
    )
    attribution_distribution: dict[str, int] = Field(
        default_factory=dict,
        description="七类归因分布（来自 F020，key=归因类型，value=出现次数）"
    )
    consecutive_depreciating_days: int = Field(
        default=0,
        ge=0,
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

    @field_validator("component_id", "contract_id")
    @classmethod
    def _non_empty(cls, v: str) -> str:
        if not v or not v.strip:
            raise ValueError("component_id / contract_id 不可为空")
        return v


class DailySummary(BaseModel):
    """每日汇总产物

    AI 业界概念: Daily Aggregation Report / Daily Rollup
    （每日聚合报告 / 每日汇总）
    """
    summary_id: str
    summary_date: datetime = Field(description="汇总日期（UTC 02:00 触发）")
    component_statuses: list[HarnessComponentStatus] = Field(
        description="当日所有组件状态快照"
    )
    top_attribution_classes: list[str] = Field(
        description="当日最频繁的归因类型 Top 5（来自 F020）"
    )
    actions_dispatched: list[str] = Field(
        default_factory=list,
        description="当日派发的行动 ID 列表"
    )


class TrendReport(BaseModel):
    """趋势报告

    AI 业界概念: Time-Window Aggregation / Trend Analysis
    （时间窗口聚合 / 趋势分析）
    """
    report_id: str
    window_days: int = Field(ge=1, le=365, description="时间窗口（天）")
    start_date: datetime
    end_date: datetime
    attribution_frequency: dict[str, int] = Field(
        description="归因类型 → 出现次数（窗口内累计）"
    )
    state_transitions: list[dict] = Field(
        description="状态转换历史（每条 {component_id, from, to, timestamp}）"
    )
    bottleneck_candidates: list[str] = Field(
        description="瓶颈候选组件（持续折旧接近阈值，未达 bottleneck）"
    )


class Action(BaseModel):
    """行动建议

    AI 业界概念: Remediation Action / Auto-Remediation Ticket
    （补救行动 / 自动补救工单）
    """
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
        description="是否需要 operator 拉闸权批准（仅 escalate_cvo_refactor=True）"
    )
    dispatched_at: datetime
    payload: dict = Field(
        default_factory=dict,
        description="派发给处理方的上下文数据"
    )


class TransitionRequest(BaseModel):
    """operator 拉闸权审批请求（仅 escalate_cvo_refactor 使用）"""
    request_id: str
    component_id: str
    action_type: Literal["escalate_cvo_refactor"]
    submitted_at: datetime
    submitted_by: str = Field(description="提交方（auto / operator_name）")
    status: Literal["pending", "approved", "rejected"] = "pending"
    operator_id: Optional[str] = None
    decided_at: Optional[datetime] = None
    decision_reason: Optional[str] = None
```

### 2.3 抽象接口

```python
# flowforge/forgemind/eval_control/api.py
from abc import ABC, abstractmethod
from datetime import datetime
from typing import Optional

from .models import (
    Action,
    DailySummary,
    HarnessComponentStatus,
    HarnessLifecycleState,
    TrendReport,
)


class ControlPlaneAPI(ABC):
    """Harness Eval 控制面 API（DI singleton scope，全系统唯一实例）

    AI 业界概念: Control Plane API / Lifecycle Management API
    （控制面 API / 生命周期管理 API）
    """

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
        """按状态列表组件（dashboard 只读调用）"""
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
          operator 拉闸权校验（六层 Guardrails 之 Action Confirmation）
        """
        ...

    @abstractmethod
    async def get_trend(
        self,
        window_days: int,
        component_id: Optional[str] = None,
    ) -> TrendReport:
        """查询趋势报告（架构师 Forgekin（猫头鹰·鲁班）调用）"""
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
        - APPRECIATING: 无行动（仅记录趋势）
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
        """按时间窗口聚合归因分布"""
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

        合法转换矩阵:
        - STABLE ↔ APPRECIATING
        - STABLE ↔ DEPRECIATING
        - APPRECIATING → STABLE
        - DEPRECIATING → ACTION_NEEDED
        - ACTION_NEEDED → BOTTLENECK
        - ACTION_NEEDED → STABLE（修复后恢复）
        - BOTTLENECK → ACTION_NEEDED（CVO 重构后）
        - 禁止: STABLE → BOTTLENECK（必须经 ACTION_NEEDED 中转）
        - 禁止: STABLE → ACTION_NEEDED（必须经 DEPRECIATING 中转）
        """
        ...


class ControlPlaneRepository(ABC):
    """控制面持久层（抽象接口，复用 F008 Durable State Surface）"""

    @abstractmethod
    async def save_component_status(
        self, status: HarnessComponentStatus
    ) -> None: ...

    @abstractmethod
    async def get_latest_status(
        self, component_id: str
    ) -> Optional[HarnessComponentStatus]: ...

    @abstractmethod
    async def list_all_latest(self) -> list[HarnessComponentStatus]: ...

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

    @abstractmethod
    async def query_summaries(
        self,
        start_date: datetime,
        end_date: datetime,
    ) -> list[DailySummary]: ...

    @abstractmethod
    async def save_transition_request(
        self, request: "TransitionRequest"
    ) -> None: ...

    @abstractmethod
    async def get_transition_request(
        self, request_id: str
    ) -> "TransitionRequest": ...
```

### 2.4 关键算法伪代码

#### 2.4.1 DailySummarizer.summarize 算法

```
function summarize -> DailySummary:
    # Step 1: 并行拉取三源数据
    f018_contracts = await f018_repo.list_all_contracts        # 所有契约
    f019_signals = await f019_repo.get_signals_window(24h)       # 24h 三方信号
    f020_attributions = await f020_repo.get_attributions_window(24h)

    # Step 2: 按 contract_id 对齐合并
    component_statuses = []
    for contract in f018_contracts:
        cid = contract.contract_id
        friction = contract.friction_metrics["total"]            # 来自 F018
        appreciation = f019_signals.get(cid, {}).get("score", 0.0)  # 来自 F019
        attribution_dist = count_by_class(
            [a for a in f020_attributions if a.component_id == cid]
        )                                                          # 来自 F020

        # Step 3: 计算 score
        prev_status = await repository.get_latest_status(cid)
        prev_state = prev_status.lifecycle_state if prev_status else STABLE
        consecutive_days = prev_status.consecutive_depreciating_days if prev_status else 0

        # Step 4: 候选状态判定
        if appreciation - friction > appreciation_threshold:
            candidate = APPRECIATING
            consecutive_days = 0
        elif friction - appreciation > friction_threshold:
            candidate = DEPRECIATING
            consecutive_days += 1
        elif attribution_conflict_count(attribution_dist) > 0:
            candidate = ACTION_NEEDED
        else:
            candidate = STABLE
            consecutive_days = 0

        # Step 5: bottleneck 升级判定
        if candidate == DEPRECIATING and consecutive_days >= bottleneck_consecutive_days:
            candidate = BOTTLENECK

        # Step 6: 状态机校验
        if not state_machine.can_transition(prev_state, candidate):
            log.warning(f"非法转换 {prev_state} -> {candidate}, 保持 {prev_state}")
            candidate = prev_state

        status = HarnessComponentStatus(
            component_id=cid,
            contract_id=cid,
            lifecycle_state=candidate,
            appreciation_score=appreciation,
            friction_score=friction,
            attribution_distribution=attribution_dist,
            consecutive_depreciating_days=consecutive_days,
        )
        component_statuses.append(status)
        await repository.save_component_status(status)

    # Step 7: Top 5 归因 + 派发行动
    top_attributions = top5_by_count(merge_all(attribution_dist))
    actions_dispatched = []
    for status in component_statuses:
        actions = recommender.recommend(status)
        for action in actions:
            if action.requires_operator_approval:
                # 提交拉闸权审批请求，挂起等待 operator
                req = TransitionRequest(...)
                await repository.save_transition_request(req)
                await event_bus.publish("operator.approval_required", req)
            else:
                await dispatch_to_handler(action)  # F012/F020 自动派发
            actions_dispatched.append(action.action_id)

    summary = DailySummary(
        summary_id=uuid4,
        summary_date=now_utc,
        component_statuses=component_statuses,
        top_attribution_classes=top_attributions,
        actions_dispatched=actions_dispatched,
    )
    await repository.save_daily_summary(summary)
    return summary
```

#### 2.4.2 ActionRecommender.recommend 算法

```
function recommend(status: HarnessComponentStatus) -> list[Action]:
    state = status.lifecycle_state
    actions = []
    timestamp = now_utc

    if state == STABLE or state == APPRECIATING:
        return [Action(
            action_id=uuid4,
            component_id=status.component_id,
            action_type="no_action",
            trigger_state=state,
            requires_operator_approval=False,
            dispatched_at=timestamp,
        )]

    if state == DEPRECIATING:
        actions.append(Action(
            action_id=uuid4,
            component_id=status.component_id,
            action_type="F012_sunset_review",
            trigger_state=state,
            requires_operator_approval=False,    # 自动派发
            dispatched_at=timestamp,
            payload={"friction_score": status.friction_score,
                     "consecutive_days": status.consecutive_depreciating_days},
        ))

    if state == ACTION_NEEDED:
        actions.append(Action(
            action_id=uuid4,
            component_id=status.component_id,
            action_type="F020_fix_router",
            trigger_state=state,
            requires_operator_approval=False,    # 自动派发
            dispatched_at=timestamp,
            payload={"attribution_distribution": status.attribution_distribution},
        ))

    if state == BOTTLENECK:
        actions.append(Action(
            action_id=uuid4,
            component_id=status.component_id,
            action_type="escalate_cvo_refactor",
            trigger_state=state,
            requires_operator_approval=True,     # 必须经 operator 拉闸权
            dispatched_at=timestamp,
            payload={"component_id": status.component_id,
                     "friction_score": status.friction_score,
                     "consecutive_days": status.consecutive_depreciating_days},
        ))

    return actions
```

#### 2.4.3 LifecycleStateMachine.can_transition 转换矩阵

```
TRANSITION_MATRIX = {
    # from_state: {allowed to_states}
    STABLE:          {APPRECIATING, DEPRECIATING, STABLE},
    APPRECIATING:    {STABLE, APPRECIATING, DEPRECIATING},
    DEPRECIATING:    {ACTION_NEEDED, STABLE, APPRECIATING, DEPRECIATING},
    ACTION_NEEDED:   {BOTTLENECK, STABLE, ACTION_NEEDED, DEPRECIATING},
    BOTTLENECK:      {ACTION_NEEDED, BOTTLENECK},    # CVO 重构后回 ACTION_NEEDED
}

function can_transition(from_state, to_state) -> bool:
    return to_state in TRANSITION_MATRIX.get(from_state, set)

# 关键禁止规则:
# - STABLE → BOTTLENECK: 必须经 DEPRECIATING → ACTION_NEEDED 中转
# - STABLE → ACTION_NEEDED: 必须经 DEPRECIATING 中转
# - APPRECIATING → BOTTLENECK: 必须经 DEPRECIATING → ACTION_NEEDED 中转
# - APPRECIATING → ACTION_NEEDED: 必须经 DEPRECIATING 中转
```

#### 2.4.4 TrendAnalyzer.analyze 算法

```
function analyze(window_days, component_id?) -> TrendReport:
    end_date = now_utc
    start_date = end_date - timedelta(days=window_days)

    if component_id:
        history = await repository.query_history(component_id, start_date, end_date)
    else:
        summaries = await repository.query_summaries(start_date, end_date)
        history = flatten([s.component_statuses for s in summaries])

    # 聚合归因频次
    attribution_frequency = {}
    state_transitions = []
    bottleneck_candidates = []
    prev_state_map = {}    # component_id -> prev_state

    for status in sorted(history, key=lambda s: s.updated_at):
        cid = status.component_id
        for attr_class, count in status.attribution_distribution.items:
            attribution_frequency[attr_class] = (
                attribution_frequency.get(attr_class, 0) + count
            )

        prev = prev_state_map.get(cid)
        if prev and prev != status.lifecycle_state:
            state_transitions.append({
                "component_id": cid,
                "from": prev,
                "to": status.lifecycle_state,
                "timestamp": status.updated_at,
            })
        prev_state_map[cid] = status.lifecycle_state

        # bottleneck 候选: consecutive_depreciating_days 接近阈值但未达 bottleneck
        if (status.lifecycle_state == DEPRECIATING
            and status.consecutive_depreciating_days >= bottleneck_consecutive_days - 2
            and status.consecutive_depreciating_days < bottleneck_consecutive_days):
            bottleneck_candidates.append(cid)

    return TrendReport(
        report_id=uuid4,
        window_days=window_days,
        start_date=start_date,
        end_date=end_date,
        attribution_frequency=attribution_frequency,
        state_transitions=state_transitions,
        bottleneck_candidates=bottleneck_candidates,
    )
```

---

## 3. 模块实现

### 3.1 ControlPlaneAPIImpl 实现

```python
# flowforge/forgemind/eval_control/api.py (Impl 部分)
import uuid
from datetime import datetime
from typing import Optional

from .models import (
    Action,
    DailySummary,
    HarnessComponentStatus,
    HarnessLifecycleState,
    TransitionRequest,
    TrendReport,
)


class ControlPlaneAPIImpl(ControlPlaneAPI):
    """控制面 API 实现（DI singleton scope）"""

    def __init__(
        self,
        repository,            # ControlPlaneRepository
        state_machine,         # LifecycleStateMachine
        recommender,           # ActionRecommender
        trend_analyzer,        # TrendAnalyzer
        operator_approver,     # OperatorApprover（拉闸权校验）
        event_bus,             # EventBus
        logger,                # get_logger("eval_control.api")
    ):
        self._repository = repository
        self._state_machine = state_machine
        self._recommender = recommender
        self._trend_analyzer = trend_analyzer
        self._operator_approver = operator_approver
        self._event_bus = event_bus
        self._logger = logger

    async def get_status(
        self, component_id: str
    ) -> HarnessComponentStatus:
        if not component_id or not component_id.strip:
            raise ValueError("component_id 不可为空")
        status = await self._repository.get_latest_status(component_id)
        if status is None:
            raise KeyError(f"组件 {component_id} 不存在或未注册到 F018 契约")
        self._logger.debug(
            "get_status",
            extra={"component_id": component_id, "state": status.lifecycle_state},
        )
        return status

    async def list_by_state(
        self, state: HarnessLifecycleState
    ) -> list[HarnessComponentStatus]:
        all_statuses = await self._repository.list_all_latest
        return [s for s in all_statuses if s.lifecycle_state == state]

    async def trigger_action(
        self,
        component_id: str,
        action: str,
        operator_id: Optional[str] = None,
    ) -> Action:
        # Step 1: 校验组件存在
        status = await self.get_status(component_id)

        # Step 2: 校验 action 类型与当前状态匹配
        valid_actions = self._recommender.valid_action_types_for(status.lifecycle_state)
        if action not in valid_actions:
            raise ValueError(
                f"action {action} 不匹配当前状态 {status.lifecycle_state}, "
                f"合法 action: {valid_actions}"
            )

        # Step 3: 拉闸权校验
        requires_approval = (action == "escalate_cvo_refactor")
        if requires_approval:
            if not operator_id:
                raise PermissionError(
                    "escalate_cvo_refactor 必须 operator_id 非空（拉闸权校验失败）"
                )
            approved = await self._operator_approver.verify(operator_id, action)
            if not approved:
                raise PermissionError(
                    f"operator {operator_id} 无权触发 {action}"
                )

        # Step 4: 构造 Action 对象
        action_obj = Action(
            action_id=str(uuid.uuid4),
            component_id=component_id,
            action_type=action,
            trigger_state=status.lifecycle_state,
            requires_operator_approval=requires_approval,
            dispatched_at=datetime.utcnow,
            payload={
                "friction_score": status.friction_score,
                "appreciation_score": status.appreciation_score,
                "attribution_distribution": status.attribution_distribution,
                "operator_id": operator_id,
            },
        )

        # Step 5: 派发到处理方
        if action == "F012_sunset_review":
            await self._event_bus.publish(
                "f012.sunset_review_requested",
                {"action_id": action_obj.action_id, "component_id": component_id},
            )
        elif action == "F020_fix_router":
            await self._event_bus.publish(
                "f020.fix_dispatched",
                {"action_id": action_obj.action_id,
                 "component_id": component_id,
                 "attribution_distribution": status.attribution_distribution},
            )
        elif action == "escalate_cvo_refactor":
            # 提交拉闸权审批请求，挂起等待 operator 批准
            req = TransitionRequest(
                request_id=str(uuid.uuid4),
                component_id=component_id,
                action_type="escalate_cvo_refactor",
                submitted_at=datetime.utcnow,
                submitted_by=operator_id,
                status="pending",
            )
            await self._repository.save_transition_request(req)
            await self._event_bus.publish(
                "operator.approval_required",
                {"request_id": req.request_id, "component_id": component_id},
            )

        # Step 6: 更新 last_action
        status.last_action = action_obj.action_id
        status.updated_at = datetime.utcnow
        await self._repository.save_component_status(status)

        self._logger.info(
            "trigger_action",
            extra={"action_id": action_obj.action_id,
                   "component_id": component_id,
                   "action_type": action,
                   "operator_id": operator_id},
        )
        return action_obj

    async def get_trend(
        self,
        window_days: int,
        component_id: Optional[str] = None,
    ) -> TrendReport:
        if window_days < 1 or window_days > 365:
            raise ValueError("window_days 必须在 [1, 365] 范围内")
        return await self._trend_analyzer.analyze(window_days, component_id)
```

### 3.2 DailySummarizerImpl 实现

```python
# flowforge/forgemind/eval_control/summarizer.py
import asyncio
import uuid
from datetime import datetime, timedelta


class DailySummarizerImpl(DailySummarizer):
    """每日 02:00 汇总任务实现"""

    def __init__(
        self,
        f018_repo,             # F018 Eval Contract Repository
        f019_repo,             # F019 三方信号 Repository
        f020_repo,             # F020 七类归因 Repository
        state_machine,         # LifecycleStateMachine
        repository,            # ControlPlaneRepository
        recommender,           # ActionRecommender
        event_bus,
        config,                # harness_eval_control_plane.yaml
        logger,
    ):
        self._f018 = f018_repo
        self._f019 = f019_repo
        self._f020 = f020_repo
        self._state_machine = state_machine
        self._repository = repository
        self._recommender = recommender
        self._event_bus = event_bus
        self._cfg = config
        self._logger = logger

    async def summarize(self) -> DailySummary:
        window_start = datetime.utcnow - timedelta(hours=24)

        # Step 1: 并行拉取三源数据
        contracts, signals, attributions = await asyncio.gather(
            self._f018.list_all_contracts,
            self._f019.get_signals_window(window_start),
            self._f020.get_attributions_window(window_start),
        )

        component_statuses = []
        actions_dispatched = []

        for contract in contracts:
            cid = contract.contract_id
            try:
                status = await self._process_component(
                    cid, contract, signals, attributions
                )
                component_statuses.append(status)
                await self._repository.save_component_status(status)

                # Step 7: 派发行动
                actions = self._recommender.recommend(status)
                for action in actions:
                    if action.action_type == "no_action":
                        continue
                    if action.requires_operator_approval:
                        req = TransitionRequest(
                            request_id=str(uuid.uuid4),
                            component_id=cid,
                            action_type="escalate_cvo_refactor",
                            submitted_at=datetime.utcnow,
                            submitted_by="auto",
                            status="pending",
                        )
                        await self._repository.save_transition_request(req)
                        await self._event_bus.publish(
                            "operator.approval_required",
                            {"request_id": req.request_id, "component_id": cid},
                        )
                    else:
                        await self._dispatch_auto_action(action)
                    actions_dispatched.append(action.action_id)
            except Exception as e:
                self._logger.error(
                    "summarize_component_failed",
                    extra={"component_id": cid, "error": str(e)},
                )

        top_attributions = self._top5_attributions(component_statuses)
        summary = DailySummary(
            summary_id=str(uuid.uuid4),
            summary_date=datetime.utcnow,
            component_statuses=component_statuses,
            top_attribution_classes=top_attributions,
            actions_dispatched=actions_dispatched,
        )
        await self._repository.save_daily_summary(summary)
        self._logger.info(
            "summarize_done",
            extra={"summary_id": summary.summary_id,
                   "component_count": len(component_statuses),
                   "actions_dispatched": len(actions_dispatched)},
        )
        return summary

    async def _process_component(
        self, cid, contract, signals, attributions
    ) -> HarnessComponentStatus:
        friction = float(contract.friction_metrics.get("total", 0.0))
        appreciation = float(signals.get(cid, {}).get("score", 0.0))
        attribution_dist = self._count_by_class(
            [a for a in attributions if a.component_id == cid]
        )

        prev_status = await self._repository.get_latest_status(cid)
        prev_state = prev_status.lifecycle_state if prev_status else HarnessLifecycleState.STABLE
        consecutive_days = prev_status.consecutive_depreciating_days if prev_status else 0

        # 候选状态判定
        if appreciation - friction > self._cfg["appreciation_threshold"]:
            candidate = HarnessLifecycleState.APPRECIATING
            consecutive_days = 0
        elif friction - appreciation > self._cfg["friction_threshold"]:
            candidate = HarnessLifecycleState.DEPRECIATING
            consecutive_days += 1
        elif self._attribution_conflict_count(attribution_dist) > 0:
            candidate = HarnessLifecycleState.ACTION_NEEDED
        else:
            candidate = HarnessLifecycleState.STABLE
            consecutive_days = 0

        # bottleneck 升级
        if (candidate == HarnessLifecycleState.DEPRECIATING
            and consecutive_days >= self._cfg["bottleneck_consecutive_days"]):
            candidate = HarnessLifecycleState.BOTTLENECK

        # 状态机校验
        if not self._state_machine.can_transition(prev_state, candidate):
            self._logger.warning(
                "illegal_transition_blocked",
                extra={"component_id": cid,
                       "from": prev_state, "to": candidate},
            )
            candidate = prev_state

        return HarnessComponentStatus(
            component_id=cid,
            contract_id=cid,
            lifecycle_state=candidate,
            appreciation_score=appreciation,
            friction_score=friction,
            attribution_distribution=attribution_dist,
            consecutive_depreciating_days=consecutive_days,
            updated_at=datetime.utcnow,
        )

    def _count_by_class(self, attributions) -> dict[str, int]:
        result = {}
        for a in attributions:
            cls = a.attribution_class
            result[cls] = result.get(cls, 0) + 1
        return result

    def _attribution_conflict_count(self, dist: dict[str, int]) -> int:
        # 归因冲突: 同一组件 24h 内同一归因类出现 >= max_allowed_per_class 次
        max_allowed = self._cfg.get("max_attributions_per_class_24h", 3)
        return sum(1 for count in dist.values if count >= max_allowed)

    def _top5_attributions(
        self, statuses: list[HarnessComponentStatus]
    ) -> list[str]:
        merged = {}
        for s in statuses:
            for cls, count in s.attribution_distribution.items:
                merged[cls] = merged.get(cls, 0) + count
        return sorted(merged, key=merged.get, reverse=True)[:5]

    async def _dispatch_auto_action(self, action: Action) -> None:
        if action.action_type == "F012_sunset_review":
            await self._event_bus.publish(
                "f012.sunset_review_requested",
                {"action_id": action.action_id,
                 "component_id": action.component_id},
            )
        elif action.action_type == "F020_fix_router":
            await self._event_bus.publish(
                "f020.fix_dispatched",
                {"action_id": action.action_id,
                 "component_id": action.component_id,
                 "attribution_distribution": action.payload.get(
                     "attribution_distribution", {}
                 )},
            )
```

### 3.3 LifecycleStateMachineImpl 实现

```python
# flowforge/forgemind/eval_control/state_machine.py
from .models import HarnessLifecycleState


class LifecycleStateMachineImpl(LifecycleStateMachine):
    """五态状态机实现（DI singleton scope）"""

    _MATRIX: dict[HarnessLifecycleState, set[HarnessLifecycleState]] = {
        HarnessLifecycleState.STABLE: {
            HarnessLifecycleState.APPRECIATING,
            HarnessLifecycleState.DEPRECIATING,
            HarnessLifecycleState.STABLE,
        },
        HarnessLifecycleState.APPRECIATING: {
            HarnessLifecycleState.STABLE,
            HarnessLifecycleState.APPRECIATING,
            HarnessLifecycleState.DEPRECIATING,
        },
        HarnessLifecycleState.DEPRECIATING: {
            HarnessLifecycleState.ACTION_NEEDED,
            HarnessLifecycleState.STABLE,
            HarnessLifecycleState.APPRECIATING,
            HarnessLifecycleState.DEPRECIATING,
        },
        HarnessLifecycleState.ACTION_NEEDED: {
            HarnessLifecycleState.BOTTLENECK,
            HarnessLifecycleState.STABLE,
            HarnessLifecycleState.ACTION_NEEDED,
            HarnessLifecycleState.DEPRECIATING,
        },
        HarnessLifecycleState.BOTTLENECK: {
            HarnessLifecycleState.ACTION_NEEDED,
            HarnessLifecycleState.BOTTLENECK,
        },
    }

    def can_transition(
        self,
        from_state: HarnessLifecycleState,
        to_state: HarnessLifecycleState,
    ) -> bool:
        allowed = self._MATRIX.get(from_state, set)
        return to_state in allowed
```

### 3.4 ControlPlaneRepositoryImpl 实现

```python
# flowforge/forgemind/eval_control/repository.py
from datetime import datetime
from typing import Optional


class ControlPlaneRepositoryImpl(ControlPlaneRepository):
    """控制面持久层实现（复用 F008 DurableStateSurface）

    与 F014 EchoStore存储（EchoStore，情景记忆存储 / 智能体经验日志）物理隔离:
    - 控制面状态存储在 durable_surface namespace="harness_eval_control"
    - EchoStore存储在 durable_surface namespace="echo_store"
    """

    NAMESPACE = "harness_eval_control"     # 与 echo_store 物理隔离

    def __init__(self, durable_surface, logger):
        self._surface = durable_surface    # F008 DurableStateSurface
        self._logger = logger

    async def save_component_status(
        self, status: HarnessComponentStatus
    ) -> None:
        key = f"component:{status.component_id}:latest"
        await self._surface.put(self.NAMESPACE, key, status.model_dump_json)
        # 同时写入历史时间序列（按日期索引）
        hist_key = (
            f"component:{status.component_id}:history:"
            f"{status.updated_at.isoformat}"
        )
        await self._surface.put(self.NAMESPACE, hist_key, status.model_dump_json)

    async def get_latest_status(
        self, component_id: str
    ) -> Optional[HarnessComponentStatus]:
        key = f"component:{component_id}:latest"
        raw = await self._surface.get(self.NAMESPACE, key)
        if raw is None:
            return None
        return HarnessComponentStatus.model_validate_json(raw)

    async def list_all_latest(self) -> list[HarnessComponentStatus]:
        keys = await self._surface.scan_keys(self.NAMESPACE, "component:*:latest")
        result = []
        for key in keys:
            raw = await self._surface.get(self.NAMESPACE, key)
            if raw:
                result.append(HarnessComponentStatus.model_validate_json(raw))
        return result

    async def query_history(
        self,
        component_id: str,
        start_date: datetime,
        end_date: datetime,
    ) -> list[HarnessComponentStatus]:
        pattern = f"component:{component_id}:history:*"
        keys = await self._surface.scan_keys(self.NAMESPACE, pattern)
        result = []
        for key in keys:
            raw = await self._surface.get(self.NAMESPACE, key)
            if not raw:
                continue
            status = HarnessComponentStatus.model_validate_json(raw)
            if start_date <= status.updated_at <= end_date:
                result.append(status)
        result.sort(key=lambda s: s.updated_at)
        return result

    async def save_daily_summary(self, summary: DailySummary) -> None:
        key = f"summary:{summary.summary_date.isoformat}"
        await self._surface.put(self.NAMESPACE, key, summary.model_dump_json)

    async def query_summaries(
        self, start_date: datetime, end_date: datetime
    ) -> list[DailySummary]:
        keys = await self._surface.scan_keys(self.NAMESPACE, "summary:*")
        result = []
        for key in keys:
            raw = await self._surface.get(self.NAMESPACE, key)
            if not raw:
                continue
            summary = DailySummary.model_validate_json(raw)
            if start_date <= summary.summary_date <= end_date:
                result.append(summary)
        result.sort(key=lambda s: s.summary_date)
        return result

    async def save_transition_request(
        self, request: TransitionRequest
    ) -> None:
        key = f"transition_request:{request.request_id}"
        await self._surface.put(self.NAMESPACE, key, request.model_dump_json)

    async def get_transition_request(
        self, request_id: str
    ) -> TransitionRequest:
        key = f"transition_request:{request_id}"
        raw = await self._surface.get(self.NAMESPACE, key)
        if raw is None:
            raise KeyError(f"transition_request {request_id} 不存在")
        return TransitionRequest.model_validate_json(raw)
```

### 3.5 时序图：每日汇总流

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ APScheduler  │    │ DailySumm.   │    │ F018 Repo    │    │ F019 Repo    │    │ F020 Repo    │
│ 02:00 cron   │    │ Impl         │    │              │    │              │    │              │
└──────┬───────┘    └──────┬───────┘    └──────┬───────┘    └──────┬───────┘    └──────┬───────┘
       │ 1. trigger        │                   │                   │                   │
       │──────────────────▶│                   │                   │                   │
       │                   │ 2. list_contracts │                   │                   │
       │                   │──────────────────▶│                   │                   │
       │                   │ 3. get_signals_window(24h)            │                   │
       │                   │───────────────────────────────────────▶│                   │
       │                   │ 4. get_attributions_window(24h)                          │
       │                   │───────────────────────────────────────────────────────────▶│
       │                   │ 5. 并行 await asyncio.gather(...)返回                       │
       │                   │◀───────────────────────────────────────────────────────────│
       │                   │ 6. for each contract:                                     │
       │                   │    - 计算 friction/appreciation/attribution_dist          │
       │                   │    - 状态机校验 can_transition                             │
       │                   │    - save_component_status                                │
       │                   │ 7. recommender.recommend(status)                          │
       │                   │ 8. for each Action:                                       │
       │                   │    - no_action: skip                                      │
       │                   │    - F012/F020: event_bus.publish(...)                    │
       │                   │    - escalate_cvo: save_transition_request + publish      │
       │                   │ 9. save_daily_summary                                     │
       │ 10. DailySummary  │                                                           │
       │◀──────────────────│                                                           │
```

### 3.6 时序图：operator 拉闸权审批流

```
┌─────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│DailySumm│  │ControlPlane  │  │ Repository   │  │  EventBus    │  │  operator    │
│         │  │ API Impl     │  │              │  │              │  │  控制台      │
└────┬────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
     │ 1. trigger_action(component_id, │                  │                  │
     │    "escalate_cvo_refactor")     │                  │                  │
     │─────────────▶│                  │                  │                  │
     │              │ 2. get_status    │                  │                  │
     │              │─────────────────▶│                  │                  │
     │              │ 3. 拉闸权校验: requires_approval=True                  │
     │              │    operator_id 为空 → raise PermissionError            │
     │              │ 4. operator_approver.verify(operator_id, action)       │
     │              │ 5. approved?                                          │
     │              │ 6. save_transition_request (status=pending)            │
     │              │─────────────────▶│                  │                  │
     │              │ 7. publish("operator.approval_required", req)         │
     │              │─────────────────────────────────────▶│                  │
     │              │                  │                  │ 8. operator 收到通知│
     │              │                  │                  │──────────────────▶│
     │              │                  │                  │ 9. operator 审批  │
     │              │                  │                  │   (approve/reject)│
     │              │                  │                  │◀──────────────────│
     │              │ 10. update transition_request.status │                  │
     │              │─────────────────▶│                  │                  │
     │              │ 11. if approved: publish("cvo.refactor_approved")      │
     │              │─────────────────────────────────────▶│                  │
     │              │ 12. Action 对象返回                                    │
     │◀─────────────│                  │                  │                  │
```

### 3.7 错误处理

| 错误场景 | 处理策略 | 异常类型 |
|---------|---------|---------|
| `component_id` 不存在 | 拒绝请求，返回 404 | `KeyError` |
| `component_id` 为空 | 拒绝请求，返回 400 | `ValueError` |
| F018 契约表拉取失败 | 重试 3 次后降级到上一次汇总快照 | `ServiceUnavailableError` |
| F019 信号拉取超时 | 跳过该组件本次汇总，记录警告 | `asyncio.TimeoutError` |
| F020 归因拉取失败 | 跳过 attribution_distribution，仅用 friction/appreciation 判定 | `ServiceUnavailableError` |
| 非法状态转换 | 阻断转换，保持原状态，记录警告 | `IllegalTransitionError`（仅日志，不抛） |
| `escalate_cvo_refactor` 无 operator_id | 拒绝触发，返回 403 | `PermissionError` |
| operator 审批超时（72h） | 自动 reject，组件状态保持 bottleneck | `ApprovalTimeoutError` |
| Repository 写入失败 | 回滚状态更新，记录错误，重试 3 次 | `RepositoryWriteError` |
| 每日汇总任务整体失败 | 记录错误，下次 cron 重新触发，不阻塞 dashboard 读 | `SummarizeFailedError` |

### 3.8 性能优化

| 优化点 | 策略 | 预期效果 |
|--------|------|---------|
| 三源并行拉取 | `asyncio.gather` 并行调用 F018/F019/F020 | 三源拉取耗时从串行 3s 降至并行 1s |
| 历史查询索引 | Repository 在 `component:{id}:history:{ts}` 上加时间索引 | `query_history` 从 O(n) 降至 O(log n) |
| 状态缓存 | `get_status` 加 in-memory LRU 缓存（TTL=60s） | dashboard 高频读从 50ms 降至 5ms |
| 批量写入 | `save_component_status` 在汇总任务内批量提交 | 100 组件写入从 10s 降至 1s |
| 趋势报告预计算 | `TrendAnalyzer.analyze(30)` 结果缓存 1h | 重复查询从 2s 降至 50ms |
| 归因分布增量更新 | F020 推送归因事件，控制面增量更新 attribution_distribution | 汇总任务无需重拉 24h 全量归因 |

### 3.9 配置示例

```yaml
# flowforge/forgemind/config/harness_eval_control_plane.yaml
harness_eval_control_plane:
  # 每日汇总任务调度
  summary_schedule: "0 2 * * *"                # 每日 02:00 UTC cron
  summary_timezone: "UTC"

  # 四态判定阈值
  appreciation_threshold: 0.6                   # appreciation - friction > 0.6 → APPRECIATING
  friction_threshold: 0.4                       # friction - appreciation > 0.4 → DEPRECIATING
  bottleneck_consecutive_days: 7                # 连续 7 天 DEPRECIATING → BOTTLENECK
  max_attributions_per_class_24h: 3             # 同类归因 24h ≥ 3 次 → ACTION_NEEDED

  # 行动路由
  action_routing:
    depreciating: F012_sunset_review            # 自动派发
    action_needed: F020_fix_router              # 自动派发
    bottleneck: escalate_cvo_refactor           # 必须 operator 拉闸权
    stable: no_action
    appreciating: no_action

  # operator 拉闸权配置
  operator_approval:
    timeout_hours: 72                           # 72h 未审批自动 reject
    auto_reject_on_timeout: true
    require_reason: true                        # operator 必须填写决策理由

  # 持久层配置（复用 F008 DurableStateSurface）
  repository:
    backend: durable_state_surfaces
    namespace: harness_eval_control             # 与 echo_store 物理隔离
    distinguish_from_echo_store: true
    history_retention_days: 365                 # 历史状态保留 365 天
    summary_retention_days: 90                  # 每日汇总保留 90 天

  # dashboard 只读数据源
  dashboard_data_source: control_plane_status
  dashboard_read_only: true                     # 禁止 dashboard 直接写入

  # 趋势分析
  trend_analysis:
    default_window_days: 30
    max_window_days: 365
    cache_ttl_seconds: 3600                     # 趋势报告缓存 1h

  # 性能优化
  performance:
    status_cache_ttl_seconds: 60                # get_status LRU 缓存 60s
    batch_write_enabled: true
    parallel_fetch: true                        # 三源并行拉取

  # 错误处理
  error_handling:
    f018_retry_count: 3
    f019_timeout_seconds: 30
    f020_timeout_seconds: 30
    degrade_to_last_summary_on_failure: true
```

---

## 4. 跨模块协作实现

### 4.1 上游依赖

| 上游模块 | 协作接口 | 协作内容 |
|---------|---------|---------|
| **F008 Durable State Surfaces** | `DurableStateSurface.put/get/scan_keys` | 控制面状态持久化复用 F008 持久表面，namespace=`harness_eval_control` 与 F014 EchoStore（namespace=`echo_store`）物理隔离 |
| **F012 Entropy Control** | `SunsetReviewer.start_review(component_id, friction_score)` | 控制面 `depreciating` 状态自动派发 F012 sunset review 流程 |
| **F018 Eval Contract** | `EvalContractRepository.list_all_contracts` + `contract.friction_metrics` | 控制面消费 F018 契约的 `friction_metrics["total"]` 作为 `friction_score` 输入；`contract_id` 作为组件状态锚点 |
| **F019 三方信号交叉** | `ThreeSignalRepository.get_signals_window(start)` | 控制面消费 F019 三方信号的 `appreciation` 分；信号冲突标记（同组件 24h 内三方信号不一致）触发 `action_needed` |
| **F020 七类归因矩阵** | `AttributionRepository.get_attributions_window(start)` | 控制面消费 F020 归因结果按 `attribution_class` 聚合为 `attribution_distribution`；归因频发触发 `action_needed` |
| **APScheduler** | `CronTrigger("0 2 * * *")` | 每日 02:00 UTC 触发 `DailySummarizer.summarize` |
| **EventBus** | `event_bus.publish(topic, payload)` | 控制面派发行动通过 EventBus 通知 F012/F020/CVO；同时发布 `operator.approval_required` 通知拉闸权审批 |
| **OperatorApprover** | `verify(operator_id, action) -> bool` | operator 拉闸权校验（仅 `escalate_cvo_refactor` 需要） |
| **ADR 009 Eval 自代谢** | — | 本 Feature 是 ADR 009 终态控制面落地 |

### 4.2 下游影响

| 下游模块 | 协作接口 | 协作内容 |
|---------|---------|---------|
| **F039 MindCodex 可检索知识库** | `MindCodexStore.add_entry(entry)` | 控制面产出的 `TrendReport` 作为元知识经 SpiritForge（经验蒸馏 / 离线策略学习 / 知识编译）蒸馏写入 MindCodex（蒸馏知识库 / 策展技能库 / 程序性记忆），供Forgekin（Evolvable Agent，社区社交称"可进化智能体"）检索"哪类根因最频繁" |
| **F038 进化谱系** | `LineageStore.record_transition(edge)` | bottleneck 状态升级 CVO 重构如涉及Forgekin跨层迁移，需调用 `record_transition` 写入 `LAYER_TRANSITION` 边 |
| **CVO（Chief Vision Officer，operator）** | `cvo_notifier.send_refactor_request(component_id, reason)` | bottleneck 状态升级 CVO 重构，CVO 接收通知并决定是否启动架构重构 |
| **dashboard** | `ControlPlaneAPI.list_by_state(state)` 只读 | dashboard 只读控制面状态，展示组件生命周期、趋势报告、行动记录；禁止直接写入 `lifecycle_state` |
| **operator 控制台** | `operator_console.list_pending_approvals` + `approve(request_id, reason)` | operator 通过控制台批准 `escalate_cvo_refactor` 行动（拉闸权） |
| **架构师 Forgekin（猫头鹰·鲁班）** | `ControlPlaneAPI.get_trend(window_days)` | 架构师消费趋势报告决定重构优先级 |
| **EventBus 订阅者** | `subscribe("f012.sunset_review_requested")` / `subscribe("f020.fix_dispatched")` / `subscribe("operator.approval_required")` / `subscribe("cvo.refactor_approved")` | F012/F020/operator 控制台订阅控制面事件，自动执行后续流程 |

### 4.3 集成测试点

| 测试点 | 验证内容 | 验证方法 |
|--------|---------|---------|
| **T1: 三源聚合正确性** | DailySummarizer 正确拉取 F018/F019/F020 数据并按 `contract_id` 对齐 | 构造 mock 三源数据，验证 `summarize` 输出的 `component_statuses` 中每个组件的 `friction_score` / `appreciation_score` / `attribution_distribution` 与源数据一致 |
| **T2: 状态机校验** | `LifecycleStateMachine.can_transition` 阻断非法转换 | 验证 `STABLE → BOTTLENECK` 返回 False，`STABLE → DEPRECIATING → ACTION_NEEDED → BOTTLENECK` 返回 True |
| **T3: operator 拉闸权** | `escalate_cvo_refactor` 无 `operator_id` 抛 `PermissionError` | 调用 `trigger_action(cid, "escalate_cvo_refactor")` 不传 `operator_id`，验证抛出 `PermissionError` |
| **T4: 持久层隔离** | 控制面 namespace 与 F014 EchoStore namespace 物理隔离 | 写入控制面状态后扫描 `echo_store` namespace，验证无控制面数据 |
| **T5: 行动派发路由** | `depreciating` → F012 / `action_needed` → F020 / `bottleneck` → CVO | 构造三种状态组件，调用 `recommend`，验证派发的 `action_type` 正确 |
| **T6: 趋势分析聚合** | `TrendAnalyzer.analyze(30)` 正确聚合 30 天归因频次 | 构造 30 天 mock 历史数据，验证 `attribution_frequency` 与手工统计一致 |

---

## 5. 详细设计验收

### 5.1 功能验收（22 个 AC）

- [ ] **AC-1**: `ControlPlaneAPI` 提供 `get_status` / `list_by_state` / `trigger_action` / `get_trend` 四个方法
- [ ] **AC-2**: `get_status(component_id)` 返回 `HarnessComponentStatus`，组件不存在抛 `KeyError`
- [ ] **AC-3**: `list_by_state(state)` 返回该状态所有组件列表（dashboard 只读调用）
- [ ] **AC-4**: `trigger_action(component_id, action, operator_id?)` 返回 `Action` 对象
- [ ] **AC-5**: `get_trend(window_days, component_id?)` 返回 `TrendReport`
- [ ] **AC-6**: `DailySummarizer.summarize` 并行拉取 F018/F019/F020 三源数据
- [ ] **AC-7**: `summarize` 按 `contract_id` 对齐合并三源数据
- [ ] **AC-8**: `summarize` 计算 `appreciation_score` / `friction_score` / `attribution_distribution`
- [ ] **AC-9**: `summarize` 按 `LifecycleStateMachine` 规则更新 `lifecycle_state`
- [ ] **AC-10**: `summarize` 持久化到 `ControlPlaneRepository`
- [ ] **AC-11**: `summarize` 触发 `ActionRecommender.recommend` 派发行动
- [ ] **AC-12**: `ActionRecommender.recommend(status)` 按状态派发对应行动类型
- [ ] **AC-13**: `STABLE` / `APPRECIATING` 状态派发 `no_action`
- [ ] **AC-14**: `DEPRECIATING` 状态派发 `F012_sunset_review`（`requires_operator_approval=False`）
- [ ] **AC-15**: `ACTION_NEEDED` 状态派发 `F020_fix_router`（`requires_operator_approval=False`）
- [ ] **AC-16**: `BOTTLENECK` 状态派发 `escalate_cvo_refactor`（`requires_operator_approval=True`）
- [ ] **AC-17**: `TrendAnalyzer.analyze(window_days)` 按时间窗口聚合归因分布
- [ ] **AC-18**: `TrendAnalyzer` 输出 `attribution_frequency` / `state_transitions` / `bottleneck_candidates`
- [ ] **AC-19**: `LifecycleStateMachine.can_transition` 校验转换合法性
- [ ] **AC-20**: `STABLE → BOTTLENECK` 跳跃被阻断（必须经 `DEPRECIATING → ACTION_NEEDED` 中转）
- [ ] **AC-21**: `consecutive_depreciating_days >= bottleneck_consecutive_days` 触发 `DEPRECIATING → BOTTLENECK`
- [ ] **AC-22**: `ControlPlaneRepository` 复用 F008 持久表面，namespace 与 F014 EchoStore物理隔离

### 5.2 性能验收（5 个 AC）

- [ ] **AC-23**: 三源并行拉取（`asyncio.gather`）耗时 ≤ 1s（100 组件规模）
- [ ] **AC-24**: `get_status` LRU 缓存命中率 ≥ 80%（dashboard 高频读场景）
- [ ] **AC-25**: 每日汇总任务 100 组件规模完成耗时 ≤ 10s
- [ ] **AC-26**: `TrendAnalyzer.analyze(30)` 100 组件规模耗时 ≤ 2s
- [ ] **AC-27**: Repository 批量写入较单条写入性能提升 ≥ 5x

### 5.3 安全验收（5 个 AC）

- [ ] **AC-28**: `escalate_cvo_refactor` 无 `operator_id` 抛 `PermissionError`
- [ ] **AC-29**: `OperatorApprover.verify(operator_id, action)` 校验 operator 权限
- [ ] **AC-30**: operator 审批超时 72h 自动 reject
- [ ] **AC-31**: dashboard 数据源只读，无 `lifecycle_state` 写入路径
- [ ] **AC-32**: 控制面 namespace 与 F014 EchoStore namespace 物理隔离（`distinguish_from_echo_store=true`）

### 5.4 Eval 验收（5 个 AC）

- [ ] **AC-33**: `friction_score` 来自 F018 契约 `friction_metrics`，非控制面自算
- [ ] **AC-34**: `appreciation_score` 来自 F019 三方信号，非控制面自算
- [ ] **AC-35**: `attribution_distribution` 来自 F020 七类归因，非控制面自分类
- [ ] **AC-36**: `DailySummary` 含 `top_attribution_classes` Top 5 归因类型
- [ ] **AC-37**: `TrendReport` 含 `bottleneck_candidates`（持续折旧接近阈值的组件）

### 5.5 架构契约验收（3 个 AC）

- [ ] **AC-38**: 单向依赖通过——`eval_control` 模块不 import 任何 *Forge 模块，且不被 F018/F019/F020 反向依赖
- [ ] **AC-39**: DI 容器注入通过——`ControlPlaneAPI` 等 6 个抽象通过 DI 容器注入，`ControlPlaneAPI` 为 singleton scope
- [ ] **AC-40**: 配置驱动通过——`summary_schedule` / `appreciation_threshold` / `friction_threshold` / `bottleneck_consecutive_days` / `action_routing` 外置 YAML

---

## 6. 引用

- [doc:../spec.md#§3.5]（FR-CORE-005 Eval 自代谢系统三层 eval）
- [doc:../spec.md#§3.16]（FR-CORE-030 Harness Eval 控制面）
- [doc:../arch.md#§3.5]（Eval 自代谢系统架构）
- [doc:../features/F040-harness-eval-control-plane.md]（同号 Feature 级 SRS）
- [doc:../architecture/A040-harness-eval-control-plane.md]（同号 Feature 级 SAD）
- [doc:../features/F008-durable-state-surfaces.md]（持久状态层，控制面存储后端）
- [doc:../features/F012-entropy-control.md]（Entropy Control，sunset review 处理方）
- [doc:../features/F014-memory-collection.md]（EchoStore存储，与控制面存储隔离）
- [doc:../features/F018-eval-contract.md]（Eval Contract，friction_metrics 来源）
- [doc:../features/F019-three-signal-cross.md]（三方信号交叉，appreciation 来源）
- [doc:../features/F020-seven-attribution.md]（七类归因矩阵，attribution 来源）
- [doc:../features/F038-forgemind-lineage.md]（进化谱系，跨层迁移记录）
- [doc:../features/F039-mind-codex-searchable.md]（蒸馏知识库可检索，趋势元知识蒸馏）
- [doc:../architecture/A018-eval-contract.md]（Eval Contract 架构，同源 ADR 009）
- [doc:../architecture/A019-three-signal-cross.md]（三方信号架构，同源 ADR 009）
- [doc:../architecture/A020-seven-attribution.md]（七类归因架构，同源 ADR 009）
- [doc:../decisions/009-eval-self-metabolism.md]（Eval 自代谢 ADR）
- [doc:../design/naming-contract.md#2.2]（Forgekin Forgekin）
- [doc:../design/naming-contract.md#2.5]（EchoStore）
- [doc:../design/naming-contract.md#2.7]（SpiritForge）
- [doc:../design/naming-contract.md#2.8]（MindCodex 蒸馏知识库）
- [doc:../../CONTRIBUTING.md#33-架构约束]（原则 2 数据检索通过 Repository 层抽象，支持可插拔数据源适配器）
- [doc:../../CONTRIBUTING.md#31-15-条编程红线违反即拒绝合入]（编程红线第 10/11/12/13 条）
- [doc:../../CONTRIBUTING.md]（软件工程文档分层规范）
- [doc:../../../CONTRIBUTING.md#第十二部分]（AI 编程优秀实践六层 Guardrails）
- [doc:../../roleagent.md#第5章]（Eval 自代谢七大工程路径）
- [doc:../../review/review.md#第八章/RA-036]（统一 Eval Hub 终态）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（详细设计骨架，） | 开发者 Forgekin（猎犬·夏洛克） |
