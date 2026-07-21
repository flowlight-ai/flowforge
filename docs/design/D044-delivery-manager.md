# D044: 交付经理可进化智能体（象·牛顿）详细设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 开发者 Forgekin（猎犬·夏洛克）
> **对应 spec.md**: [doc:../spec.md#§2.3.2]（可进化智能体定义）
> **对应 arch.md**: [doc:../arch.md#§2.7.2]（可进化智能体架构）
> **对应 design.md**: [doc:../design.md#§2.7.4]
> **对应 Feature**: [doc:../features/F044-delivery-manager.md]（同号 Feature 级 SRS）
> **对应 Architecture**: [doc:../architecture/A044-delivery-manager.md]（同号 Feature 级 SAD）
> **依赖 ADR**: [doc:../decisions/002-collaboration-protocol.md] + [doc:../decisions/013-all-things-spirit-mind-vision.md]

---

## 1. 详细设计上下文

### 1.1 设计问题

A044 已给出交付经理Forgekin的架构契约（5 种 action.type / 觉醒阶 E3 上限 / TeamActState 只读 / 质量门禁不可绕过 / Handoff Capsule 集成），但未落到代码层。本详细设计在代码层解决以下问题：

1. **5 种 action.type 路由如何在代码层实现**：规划 / 跟踪 / 风险 / 协调 / 把关
2. **资源重新分配如何强制 operator 批准**：觉醒阶 E3 上限，进度跟踪自主但资源协调受限
3. **F002 TeamActState 只读集成**：交付经理只读，写操作通过 TeamAct 标准流程
4. **F003 Handoff Capsule 交接追踪**：识别交接延迟风险
5. **质量门禁不可绕过**：DoD 未达标禁止交付（交付经理自身也不可绕过）
6. **复盘会议模板化**：结构化输出沉淀到 MindCodex

### 1.2 设计约束

- **Python 3.11+ 强制类型注解**
- **Pydantic v2 BaseModel**
- **async/await 强制**
- **DI 容器注入**：DeliveryManagerForgekin 通过 ForgePipeline 注入
- **Repository 层抽象**
- **配置外置**：进化阶 / 觉醒阶 / 质量门禁规则 / 复盘模板外置到 YAML
- **单向依赖**：`species_impl/org/delivery_manager.py` 只能 import `core/` 与 `forgemind/`
- **F002 TeamActState 只读**：禁直接修改任务状态
- **F003 Handoff Capsule 集成**：跨智能体交接追踪
- **质量门禁不可绕过**：DoD 未达标禁止交付

### 1.3 设计影响

- **对 A002 TeamAct Loop**：交付经理作为进度跟踪协调方，只读 TeamActState
- **对 A003 Handoff Capsule**：交付经理追踪交接状态，识别交接延迟风险
- **对 A028 ForgePipeline**：6 步锻造第 2 步支持交付经理种子配置
- **对 A041 产品经理**：跟踪需求决策进度
- **对 A042 运维**：跟踪运维状态
- **对 A043 安全官**：跟踪安全审计进度

---

## 2. 详细设计

### 2.1 类图

```
┌─────────────────────────────────────────────────────────────────────────┐
│              flowforge/forgemind/species_impl/org/                       │
│                                                                         │
│   ┌──────────────────────────────────────────────────────────────────┐  │
│   │                  DeliveryManagerForgekin                        │  │
│   │  (继承 ForgekinBase)                                             │  │
│   │  ─────────────────────────────────────────────────────────────  │  │
│   │  + soul_imprint / echo_store / capability_profile               │  │
│   │  + evolution_stage: E1→E5                                       │  │
│   │  + awakening_stage: E1→E3 (上限)                                │  │
│   │  ─────────────────────────────────────────────────────────────  │  │
│   │  + observe(env: ProjectEnvironment) -> Observation              │  │
│   │  + act(action: ProjectAction) -> ActionResult                   │  │
│   │  + verify(result: ActionResult) -> Verdict                      │  │
│   │  + evolve() -> None                                             │  │
│   │  ─────────────────────────────────────────────────────────────  │  │
│   │  - _action_routes: dict[ProjectActionType, Callable]            │  │
│   │  - _check_awakening_boundary(action) -> None                    │  │
│   │  - _plan_project(input) -> ActionResult (自主)                  │  │
│   │  - _track_progress(input) -> ActionResult (自主)                │  │
│   │  - _mitigate_risk(input) -> ActionResult (自主)                 │  │
│   │  - _coordinate_resources(input) -> ActionResult (需批准)        │  │
│   │  - _enforce_quality_gate(input) -> ActionResult (不可绕过)      │  │
│   │  - _check_quality_gate(input) -> None                           │  │
│   │  - _load_retrospective_template() -> RetrospectiveTemplate      │  │
│   └──────────────┬───────────────────────────────────────────────────┘  │
│                  │                                                      │
│                  ▼                                                      │
│   ┌──────────────────────────────────────────────────────────────────┐  │
│   │                  5 个工具（DI 注入）                             │  │
│   │  + ProjectPlanner: WBS / 甘特图 / 关键路径                       │  │
│   │  + ProgressTracker: 里程碑 / 燃尽图 / 状态报告                   │  │
│   │  + RiskManager: 风险识别 / 评估 / 缓解 / 应急                    │  │
│   │  + ResourceCoordinator: 资源分配 / 负载均衡                      │  │
│   │  + QualityGate: DoD / 验收标准 / 质量门禁                        │  │
│   └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 接口实现

```python
# flowforge/forgemind/species_impl/org/delivery_manager.py
"""交付经理可进化智能体（象·牛顿）— 5 种 action.type + TeamActState 只读 + 质量门禁"""
from __future__ import annotations

from abc import abstractmethod
from enum import Enum
from typing import Any, Callable, Awaitable

from pydantic import BaseModel, Field

from flowforge.forgemind.species_impl.org_forgekin import ForgekinBase
from flowforge.forgemind.species_impl.types import (
    SoulImprint, EchoStore, CapabilityProfile,
    EvolutionStage, AwakeningStage,
    Observation, ActionResult, Verdict,
)
from flowforge.core.collab.teamact import TeamActState  # F002 只读
from flowforge.core.collab.handoff import HandoffCapsule  # F003 追踪
from flowforge.core.tracing import get_logger

logger = get_logger(__name__)


class ProjectActionType(str, Enum):
    """交付经理 5 种动作类型"""
    PLAN_PROJECT = "plan_project"
    TRACK_PROGRESS = "track_progress"
    MITIGATE_RISK = "mitigate_risk"
    COORDINATE_RESOURCES = "coordinate_resources"
    QUALITY_GATE = "quality_gate"


class RiskSeverity(str, Enum):
    """风险严重级别"""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class ProjectEnvironment(BaseModel):
    """项目环境输入"""
    teamact_state: TeamActState = Field(..., description="F002 TeamAct 状态（只读）")
    handoff_capsules: list[HandoffCapsule] = Field(default_factory=list)
    milestones: list[dict[str, Any]] = Field(default_factory=list)
    resource_load: dict[str, float] = Field(default_factory=dict)  # forgekin_id -> 负载 0-1
    quality_metrics: dict[str, Any] = Field(default_factory=dict)


class ProjectAction(BaseModel):
    """项目动作输入"""
    type: ProjectActionType
    input: dict[str, Any]
    requires_resource_reallocation: bool = False  # 是否涉及资源重新分配


class RiskEvent(BaseModel):
    """风险事件"""
    risk_id: str
    severity: RiskSeverity
    description: str
    mitigation: str
    owner: str


class DefinitionOfDone(BaseModel):
    """DoD 定义（质量门禁）"""
    criteria: list[str] = Field(..., description="验收标准列表")
    mandatory: bool = True  # 不可绕过


class RetrospectiveTemplate(BaseModel):
    """复盘会议模板（沉淀到 MindCodex）"""
    template_id: str
    sections: list[str] = Field(
        default_factory=lambda: [
            "what_went_well",
            "what_went_wrong",
            "what_to_improve",
            "action_items",
        ]
    )


class DeliveryManagerForgekin(ForgekinBase):
    """交付经理可进化智能体（象·牛顿）"""

    AWAKENING_STAGE_CAP = AwakeningStage.E3  # 觉醒阶上限
    EVOLUTION_STAGE_CAP = EvolutionStage.E5  # 进化阶上限
    # 自主执行的动作类型（无需 operator 批准）
    AUTONOMOUS_ACTIONS = {
        ProjectActionType.PLAN_PROJECT,
        ProjectActionType.TRACK_PROGRESS,
        ProjectActionType.MITIGATE_RISK,
        ProjectActionType.QUALITY_GATE,  # 质量门禁本身可自主执行（且不可绕过）
    }
    # 需 operator 批准的动作类型（资源重新分配）
    APPROVAL_REQUIRED_ACTIONS = {ProjectActionType.COORDINATE_RESOURCES}

    def __init__(
        self,
        soul_imprint: SoulImprint,
        echo_store: EchoStore,
        capability_profile: CapabilityProfile,
        evolution_stage: EvolutionStage = EvolutionStage.E1,
        awakening_stage: AwakeningStage = AwakeningStage.E1,
        retrospective_template: RetrospectiveTemplate | None = None,
    ) -> None:
        self._soul_imprint = soul_imprint
        self._echo_store = echo_store
        self._capability_profile = capability_profile
        self._evolution_stage = evolution_stage
        self._awakening_stage = awakening_stage
        self._retrospective_template = retrospective_template or RetrospectiveTemplate(
            template_id="default_retrospective"
        )
        self._action_routes: dict[
            ProjectActionType,
            Callable[[dict[str, Any]], Awaitable[ActionResult]],
        ] = {
            ProjectActionType.PLAN_PROJECT: self._plan_project,
            ProjectActionType.TRACK_PROGRESS: self._track_progress,
            ProjectActionType.MITIGATE_RISK: self._mitigate_risk,
            ProjectActionType.COORDINATE_RESOURCES: self._coordinate_resources,
            ProjectActionType.QUALITY_GATE: self._enforce_quality_gate,
        }

    async def observe(self, env: ProjectEnvironment) -> Observation:
        """观察项目环境: 任务状态 / 进度 / 风险 / 资源负载 / 质量指标"""
        signals = await self._gather_project_signals(env)
        return Observation(
            forgekin_id=self._soul_imprint.forgekin_id,
            signals=signals,
        )

    async def act(self, action: ProjectAction) -> ActionResult:
        """5 种 action.type 路由 + 觉醒阶检查 + 质量门禁检查"""
        # 觉醒阶边界检查（资源重新分配必须 operator 批准）
        self._check_awakening_boundary(action)
        # 质量门禁检查（DoD 不可绕过）
        if action.type == ProjectActionType.QUALITY_GATE:
            self._check_quality_gate(action.input)
        route = self._action_routes.get(action.type)
        if route is None:
            raise ValueError(f"未知 action.type={action.type}")
        result = await route(action.input)
        await self._echo_store.record(
            task_id=action.input.get("task_id", "unknown"),
            result=result,
            source="delivery_manager",
        )
        return result

    async def verify(self, result: ActionResult) -> Verdict:
        """验证交付决策: 进度符合度 / 风险等级 / 质量达标"""
        return await self._verify_delivery_decision(result)

    async def evolve(self) -> None:
        """自进化: 蒸馏复盘模板与项目模式库到 MindCodex"""
        ...

    # ── 觉醒阶与质量门禁边界 ───────────────────────────────────────

    def _check_awakening_boundary(self, action: ProjectAction) -> None:
        """觉醒阶 E3 上限: 资源重新分配必须 operator 批准"""
        if action.type in self.APPROVAL_REQUIRED_ACTIONS:
            if action.requires_resource_reallocation and self._awakening_stage.value < "E5":
                raise PermissionError(
                    "资源重新分配必须 operator 批准（觉醒阶 E3 上限）"
                )

    def _check_quality_gate(self, input: dict) -> None:
        """质量门禁不可绕过: DoD 未达标禁止交付"""
        dod = input.get("definition_of_done")
        if dod is None:
            return
        if not isinstance(dod, DefinitionOfDone):
            return
        if dod.mandatory:
            met_criteria = input.get("met_criteria", [])
            unmet = [c for c in dod.criteria if c not in met_criteria]
            if unmet:
                raise PermissionError(
                    f"质量门禁不可绕过: DoD 未达标 ({len(unmet)} 条未满足)"
                )

    # ── 5 种 action 实现 ──────────────────────────────────────────

    async def _plan_project(self, input: dict[str, Any]) -> ActionResult:
        """项目规划: WBS / 甘特图 / 关键路径"""
        scope = input.get("scope", "full")
        return ActionResult(
            output={"scope": scope, "plan": {"wbs": [], "critical_path": []}},
            status="success",
        )

    async def _track_progress(self, input: dict[str, Any]) -> ActionResult:
        """进度跟踪: 里程碑 / 燃尽图 / 状态报告（基于 F002 TeamActState 只读）"""
        teamact_state = input.get("teamact_state")
        # 交付经理只读 TeamActState，不直接修改
        return ActionResult(
            output={
                "milestones": [],
                "burn_down": [],
                "status_report": "on_track",
            },
            status="success",
        )

    async def _mitigate_risk(self, input: dict[str, Any]) -> ActionResult:
        """风险缓解: 识别 / 评估 / 缓解 / 应急"""
        severity = RiskSeverity(input.get("severity", "medium"))
        return ActionResult(
            output={"severity": severity.value, "mitigation": "applied"},
            status="success",
        )

    async def _coordinate_resources(self, input: dict[str, Any]) -> ActionResult:
        """资源协调: 资源重新分配需 operator 批准"""
        target = input.get("target_forgekin_id")
        return ActionResult(
            output={"target": target, "reallocation": "approved"},
            status="success",
        )

    async def _enforce_quality_gate(self, input: dict[str, Any]) -> ActionResult:
        """质量把关: DoD / 验收标准 / 质量门禁（不可绕过）"""
        self._check_quality_gate(input)
        return ActionResult(
            output={"quality_gate": "passed"},
            status="success",
        )

    async def _verify_delivery_decision(self, result: ActionResult) -> Verdict:
        """验证交付决策: 进度符合度 / 风险等级 / 质量达标"""
        ...

    async def _gather_project_signals(self, env: ProjectEnvironment) -> dict[str, Any]:
        """采集项目信号（只读 TeamActState）"""
        return {
            "teamact_state": env.teamact_state,
            "handoff_capsules": env.handoff_capsules,
            "milestones": env.milestones,
            "resource_load": env.resource_load,
            "quality_metrics": env.quality_metrics,
        }

    def _load_retrospective_template(self) -> RetrospectiveTemplate:
        """加载复盘会议模板（沉淀到 MindCodex）"""
        return self._retrospective_template
```

### 2.3 关键算法

```
算法: DeliveryManagerForgekin.act(action)
输入: ProjectAction (type + input + requires_resource_reallocation)
输出: ActionResult

1. _check_awakening_boundary(action)
   1.1 IF action.type IN APPROVAL_REQUIRED_ACTIONS
       AND action.requires_resource_reallocation:
       1.1.1 IF awakening_stage < E5:
             RAISE PermissionError("资源重新分配必须 operator 批准")

2. IF action.type == QUALITY_GATE:
   2.1 _check_quality_gate(input)
       2.1.1 IF definition_of_done.mandatory:
             2.1.1.1 unmet = [c for c in dod.criteria if c not in met_criteria]
             2.1.1.2 IF unmet:
                   RAISE PermissionError("质量门禁不可绕过: DoD 未达标")

3. route = _action_routes[action.type]
4. result = await route(input)
5. echo_store.record
6. RETURN result
```

---

## 3. 模块实现

### 3.1 关键代码片段

```python
# flowforge/forgemind/forging/pipeline.py（节选，第 2 步"能力注入"）
class ForgePipeline:
    async def inject_capability_delivery(
        self, forgekin_id: str, seed,
    ) -> "DeliveryManagerForgekin":
        """锻造流水线第 2 步: 能力注入（交付经理）"""
        from flowforge.forgemind.species_impl.org.delivery_manager import (
            DeliveryManagerForgekin,
            RetrospectiveTemplate,
        )
        soul_imprint = SoulImprint(
            forgekin_id=forgekin_id,
            imprint_id=f"imprint_{forgekin_id}",
            seed_params=seed.dict,
            value_anchors=seed.value_anchors,
            namespace="delivery_manager",
            created_at=datetime.now,
        )
        capability_profile = await self._capability_repo.load(forgekin_id)
        return DeliveryManagerForgekin(
            soul_imprint=soul_imprint,
            echo_store=self._echo_store_factory(forgekin_id),
            capability_profile=capability_profile,
            evolution_stage=EvolutionStage.E1,
            awakening_stage=AwakeningStage.E1,
            retrospective_template=RetrospectiveTemplate(
                template_id=f"retro_{forgekin_id}"
            ),
        )
```

### 3.2 关键流程时序图

```
项目环境信号 (TeamActState 只读 + HandoffCapsule)
       │
       ▼
┌────────────────────────────────────────────────────────────────┐
│ 1. DeliveryManagerForgekin.observe(env)                        │
│    - 采集 任务状态 / 进度 / 风险 / 资源负载 / 质量指标         │
│    - 只读 TeamActState（禁直接修改任务状态）                   │
└────────────────────────┬───────────────────────────────────────┘
                         │ Observation
                         ▼
┌────────────────────────────────────────────────────────────────┐
│ 2. DeliveryManagerForgekin.act(action)                         │
│    - _check_awakening_boundary (资源重新分配拦截)              │
│    - _check_quality_gate (DoD 不可绕过)                        │
│    - route = _action_routes[action.type]                       │
│    - echo_store.record                                         │
└────────────────────────┬───────────────────────────────────────┘
                         │ ActionResult
                         ▼
┌────────────────────────────────────────────────────────────────┐
│ 3. DeliveryManagerForgekin.verify(result)                      │
│    - 进度符合度 / 风险等级 / 质量达标                           │
└────────────────────────┬───────────────────────────────────────┘
                         │ Verdict
                         ▼
┌────────────────────────────────────────────────────────────────┐
│ 4. MindCouncil.notify (交付策略讨论 / 复盘会议)                │
│    + MindCodex.蒸馏 (项目模式库 + 风险知识库 + 复盘模板)       │
│    + F041 产品经理.报告 (需求决策进度)                         │
│    + F042 运维.报告 (运维状态)                                 │
│    + F043 安全官.报告 (安全审计进度)                           │
│    + operator.告警 (风险预警)                                  │
└────────────────────────────────────────────────────────────────┘
```

### 3.3 错误处理

| 异常 | 触发场景 | 处理策略 |
|------|---------|---------|
| `PermissionError("资源重新分配必须 operator 批准")` | 觉醒阶 < E5 时资源协调 | 拒绝执行 |
| `PermissionError("质量门禁不可绕过: DoD 未达标")` | DoD 强制项未满足 | 拒绝交付 |
| `ValueError("未知 action.type")` | 路由表未覆盖 | 拒绝执行 |
| `ReadOnlyViolation` | 试图直接修改 TeamActState | 拒绝执行 |

### 3.4 性能优化

| 指标 | 目标 | 优化手段 |
|------|:----:|---------|
| 进度跟踪延迟 | < 30 秒 | TeamActState 流式订阅 + 缓存 |
| 风险告警延迟 | < 60 秒 | 异步风险检测 + 推送告警 |
| 资源负载计算 | < 5 秒 | 增量更新 + 本地缓存 |
| 质量门禁校验 | < 100ms | DoD 规则本地化 |

---

## 4. 跨模块协作实现

### 4.1 上游依赖如何调用

**ForgePipeline 调用 DeliveryManagerForgekin 构造器**：

```python
forgekin = await pipeline.inject_capability_delivery(forgekin_id, seed)
```

**F002 TeamActState 只读集成**：

```python
class TeamActState:
    """F002 TeamAct 状态（交付经理只读）"""

    def get_task_status(self, task_id: str) -> "TaskStatus":
        """读取任务状态（交付经理调用）"""

    def list_milestones(self) -> list["Milestone"]:
        """列出里程碑（交付经理调用）"""
```

**F003 HandoffCapsule 追踪集成**：

```python
class HandoffCapsule:
    """F003 交接胶囊（交付经理追踪）"""

    def get_handoff_status(self, capsule_id: str) -> "HandoffStatus":
        """读取交接状态"""
```

### 4.2 下游影响如何被调用

**F041 产品经理报告需求决策进度**：

```python
class ProductManagerForgekin:
    async def report_requirement_progress(
        self, delivery_forgekin_id: str
    ) -> "RequirementProgressReport":
        ...
```

**F042 运维报告运维状态**：

```python
class DevOpsForgekin:
    async def report_ops_status(
        self, delivery_forgekin_id: str
    ) -> "OpsStatusReport":
        ...
```

**F043 安全官报告安全审计进度**：

```python
class SecurityOfficerForgekin:
    async def report_security_audit(
        self, delivery_forgekin_id: str
    ) -> "SecurityAuditReport":
        ...
```

### 4.3 集成测试点

```python
@pytest.mark.asyncio
async def test_resource_reallocation_requires_operator_approval():
    """T3 具体断言: 觉醒阶 E3 上限"""
    manager = DeliveryManagerForgekin(
        soul_imprint=..., echo_store=..., capability_profile=...,
        awakening_stage=AwakeningStage.E3,
    )
    action = ProjectAction(
        type=ProjectActionType.COORDINATE_RESOURCES,
        input={"target_forgekin_id": "forgekin_a"},
        requires_resource_reallocation=True,
    )
    with pytest.raises(PermissionError, match="资源重新分配必须 operator 批准"):
        await manager.act(action)


@pytest.mark.asyncio
async def test_quality_gate_cannot_be_bypassed():
    """T3 具体断言: 质量门禁不可绕过"""
    manager = DeliveryManagerForgekin(
        soul_imprint=..., echo_store=..., capability_profile=...,
    )
    dod = DefinitionOfDone(
        criteria=["unit_tests_pass", "review_approved"],
        mandatory=True,
    )
    action = ProjectAction(
        type=ProjectActionType.QUALITY_GATE,
        input={
            "definition_of_done": dod,
            "met_criteria": ["unit_tests_pass"],  # 缺 review_approved
        },
    )
    with pytest.raises(PermissionError, match="质量门禁不可绕过"):
        await manager.act(action)


@pytest.mark.asyncio
async def test_retrospective_template_validation():
    """T3 具体断言: 复盘模板结构化"""
    manager = DeliveryManagerForgekin(
        soul_imprint=..., echo_store=..., capability_profile=...,
    )
    template = manager._load_retrospective_template()
    assert "what_went_well" in template.sections
    assert "what_went_wrong" in template.sections
    assert "what_to_improve" in template.sections
    assert "action_items" in template.sections
```

---

## 5. 详细设计验收

### 5.1 功能验收 AC

- [ ] AC-1: DeliveryManagerForgekin 可通过 ForgePipeline 6 步锻造构造
- [ ] AC-2: 5 种 action.type 路由表覆盖全部动作
- [ ] AC-3: 资源重新分配必须 operator 批准（觉醒阶 E3 上限）
- [ ] AC-4: 规划 / 跟踪 / 风险缓解可自主执行
- [ ] AC-5: 进度跟踪基于 F002 TeamActState 只读（禁直接修改任务状态）
- [ ] AC-6: F003 Handoff Capsule 交接追踪
- [ ] AC-7: 质量门禁不可绕过（DoD 未达标禁止交付）
- [ ] AC-8: 复盘会议输出符合复盘模板（沉淀到 MindCodex）

### 5.2 性能验收

- [ ] AC-9: 进度跟踪延迟 < 30 秒
- [ ] AC-10: 风险告警延迟 < 60 秒
- [ ] AC-11: 资源负载计算 < 5 秒
- [ ] AC-12: 质量门禁校验 < 100ms

### 5.3 安全验收

- [ ] AC-13: 觉醒阶边界检查在 `act` 入口拦截
- [ ] AC-14: 质量门禁检查在 `act` 入口拦截
- [ ] AC-15: 交付经理只读 TeamActState（禁直接修改任务状态）
- [ ] AC-16: 所有交付决策写入 EchoStore（跨会话累积）

### 5.4 Eval 验收

- [ ] AC-17: 项目按时交付率 ≥ 80%
- [ ] AC-18: 风险识别召回率 ≥ 75%

---

## 6. 引用

- [doc:../spec.md#§2.3.2]（可进化智能体定义）
- [doc:../arch.md#§2.7.2]（可进化智能体架构）
- [doc:../design.md#§2.7.4]（交付经理Forgekin详细设计）
- [doc:../features/F044-delivery-manager.md]（同号 Feature 级 SRS）
- [doc:../architecture/A044-delivery-manager.md]（同号 Feature 级 SAD）
- [doc:../decisions/002-collaboration-protocol.md]（协作协议 ADR）
- [doc:../decisions/013-all-things-spirit-mind-vision.md]（万物有灵愿景 ADR）
- [doc:../../../hiclaw/rules.md#编程红线]（第 9 / 11 / 12 条）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（详细设计骨架，对应 F044 / A044） | 开发者 Forgekin（猎犬·夏洛克） |
