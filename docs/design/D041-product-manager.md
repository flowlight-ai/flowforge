# D041: 产品经理可进化智能体（鹰·凯恩）详细设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 开发者 Forgekin（猎犬·夏洛克）
> **对应 spec.md**: [doc:../spec.md#§2.3.2]（可进化智能体定义）
> **对应 arch.md**: [doc:../arch.md#§2.7.2]（可进化智能体架构）
> **对应 design.md**: [doc:../design.md#§2.7.1]
> **对应 Feature**: [doc:../features/F041-product-manager.md]（同号 Feature 级 SRS）
> **对应 Architecture**: [doc:../architecture/A041-product-manager.md]（同号 Feature 级 SAD）
> **依赖 ADR**: [doc:../decisions/013-all-things-spirit-mind-vision.md]

---

## 1. 详细设计上下文

### 1.1 设计问题

A041 已给出产品经理Forgekin的架构契约（5 种 action.type / 觉醒阶 E3 上限 / 能力画像盲点），但未落到代码层。本详细设计在代码层解决以下问题：

1. **5 种 action.type 路由如何在代码层实现而不混乱**：单方法 `act` 承担 5 种动作，缺乏路由表会导致 if-else 链过长
2. **用户故事模板如何在 Schema 层校验**：As-a / I-want / So-that 三段式必须在数据模型层校验，避免 LLM 输出不合规
3. **优先级排序（MoSCoW / RICE）的算法如何实现**：两种模型并存，需根据配置切换
4. **觉醒阶 E3 上限如何在代码层强制**：愿景变更操作必须 operator 批准，需在 `act` 入口拦截
5. **能力画像盲点如何与跨厂商 review 配对联动**：产品经理盲点应与架构师盲点不重叠
6. **Build to Delete vs Built to Persist 半衰期如何在配置层标记**

### 1.2 设计约束

- **Python 3.11+ 强制类型注解**：所有 public 接口必须带类型注解
- **Pydantic v2 BaseModel**：所有数据结构基于 Pydantic v2
- **async/await 强制**：所有 I/O 操作必须 async
- **DI 容器注入**：ProductManagerForgekin 通过 ForgePipeline 注入，禁直接实例化
- **Repository 层抽象**：所有数据读写通过 Repository 层
- **配置外置**：进化阶 / 觉醒阶 / 盲点 / 工具集 / 提示词外置到 YAML
- **日志注入 trace_id**：所有日志通过 `core/tracing.py` 的 `get_logger`
- **单向依赖**：`species_impl/org/product_manager.py` 只能 import `core/` 与 `forgemind/` 内部模块

### 1.3 设计影响

- **对 A002 TeamAct Loop**：产品经理可作为 TeamAct Owner 候选（承担需求分析类任务）
- **对 A028 ForgePipeline**：6 步锻造流水线第 2 步"能力注入"需支持产品经理种子配置
- **对 A039 MindCodex**：需求模式库 / 用户故事模板作为 MindCodex 产出
- **对 A044 交付经理**：交付经理跟踪产品经理的需求决策进度

---

## 2. 详细设计

### 2.1 类图

```
┌─────────────────────────────────────────────────────────────────────────┐
│              flowforge/forgemind/species_impl/org/                       │
│                                                                         │
│   ┌──────────────────────────────────────────────────────────────────┐  │
│   │                  ProductManagerForgekin                         │  │
│   │  (继承 ForgekinBase)                                             │  │
│   │  ─────────────────────────────────────────────────────────────  │  │
│   │  + soul_imprint: SoulImprint                                    │  │
│   │  + echo_store: EchoStore                                        │  │
│   │  + capability_profile: CapabilityProfile                        │  │
│   │  + evolution_stage: EvolutionStage (E1→E5)                      │  │
│   │  + awakening_stage: AwakeningStage (E1→E3 上限)                 │  │
│   │  ─────────────────────────────────────────────────────────────  │  │
│   │  + observe(env: ProductEnvironment) -> Observation              │  │
│   │  + act(action: ProductAction) -> ActionResult                   │  │
│   │  + verify(result: ActionResult) -> Verdict                      │  │
│   │  + evolve() -> None                                             │  │
│   │  ─────────────────────────────────────────────────────────────  │  │
│   │  - _action_routes: dict[ProductActionType, Callable]            │  │
│   │  - _check_awakening_boundary(action) -> None                    │  │
│   │  - _analyze_requirements(input) -> ActionResult                 │  │
│   │  - _update_roadmap(input) -> ActionResult                       │  │
│   │  - _write_user_story(input) -> ActionResult                     │  │
│   │  - _prioritize_backlog(input) -> ActionResult                   │  │
│   │  - _sync_stakeholders(input) -> ActionResult                    │  │
│   └──────────────┬───────────────────────────────────────────────────┘  │
│                  │                                                      │
│                  ▼                                                      │
│   ┌──────────────────────────────────────────────────────────────────┐  │
│   │                  4 个工具（DI 注入）                             │  │
│   │  ─────────────────────────────────────────────────────────────  │  │
│   │  + RequirementsTraceabilityMatrix: 需求追溯矩阵                 │  │
│   │  + UserStoryMapper: 用户故事映射器                              │  │
│   │  + RoadmapPlanner: 路线图规划器                                 │  │
│   │  + StakeholderCommunicator: 利益相关者沟通器                    │  │
│   └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 接口实现

```python
# flowforge/forgemind/species_impl/org/product_manager.py
"""产品经理可进化智能体（鹰·凯恩）— 5 种 action.type 路由"""
from __future__ import annotations

from abc import abstractmethod
from enum import Enum
from typing import Any, Callable, Awaitable

from pydantic import BaseModel, Field, field_validator

from flowforge.forgemind.species_impl.org_forgekin import ForgekinBase
from flowforge.forgemind.species_impl.types import (
    SoulImprint, EchoStore, CapabilityProfile,
    EvolutionStage, AwakeningStage,
    Observation, ActionResult, Verdict,
)
from flowforge.core.tracing import get_logger

logger = get_logger(__name__)


class ProductActionType(str, Enum):
    """产品经理 5 种动作类型"""
    REQUIREMENTS_ANALYSIS = "requirements_analysis"
    ROADMAP_UPDATE = "roadmap_update"
    USER_STORY = "user_story"
    PRIORITIZE = "prioritize"
    STAKEHOLDER_SYNC = "stakeholder_sync"


class ProductEnvironment(BaseModel):
    """产品环境输入"""
    user_feedback: list[str] = Field(default_factory=list)
    market_signals: list[str] = Field(default_factory=list)
    competitor_analysis: list[str] = Field(default_factory=list)
    internal_metrics: dict[str, float] = Field(default_factory=dict)


class ProductAction(BaseModel):
    """产品动作输入"""
    type: ProductActionType
    input: dict[str, Any]


class UserStory(BaseModel):
    """用户故事（As-a / I-want / So-that 三段式）"""
    story_id: str
    as_a: str = Field(min_length=1)            # 作为 <角色>
    i_want: str = Field(min_length=1)          # 我想要 <功能>
    so_that: str = Field(min_length=1)         # 以便 <价值>
    acceptance_criteria: list[str] = Field(min_length=1)
    priority: str  # MoSCoW: must / should / could / wont

    @field_validator("priority")
    @classmethod
    def validate_moscow(cls, v: str) -> str:
        allowed = {"must", "should", "could", "wont"}
        if v.lower not in allowed:
            raise ValueError(f"priority 必须是 MoSCoW 之一: {allowed}")
        return v.lower


class PrioritizationModel(str, Enum):
    """优先级排序模型"""
    MOSCOW = "moscow"   # Must / Should / Could / Wont
    RICE = "rice"       # Reach × Impact × Confidence / Effort


class ProductManagerForgekin(ForgekinBase):
    """产品经理可进化智能体（鹰·凯恩）"""

    AWAKENING_STAGE_CAP = AwakeningStage.E3  # 觉醒阶上限
    EVOLUTION_STAGE_CAP = EvolutionStage.E5  # 进化阶上限

    def __init__(
        self,
        soul_imprint: SoulImprint,
        echo_store: EchoStore,
        capability_profile: CapabilityProfile,
        evolution_stage: EvolutionStage = EvolutionStage.E1,
        awakening_stage: AwakeningStage = AwakeningStage.E1,
        prioritization_model: PrioritizationModel = PrioritizationModel.MOSCOW,
    ) -> None:
        self._soul_imprint = soul_imprint
        self._echo_store = echo_store
        self._capability_profile = capability_profile
        self._evolution_stage = evolution_stage
        self._awakening_stage = awakening_stage
        self._prioritization_model = prioritization_model
        # 5 种 action.type 路由表
        self._action_routes: dict[
            ProductActionType,
            Callable[[dict[str, Any]], Awaitable[ActionResult]],
        ] = {
            ProductActionType.REQUIREMENTS_ANALYSIS: self._analyze_requirements,
            ProductActionType.ROADMAP_UPDATE: self._update_roadmap,
            ProductActionType.USER_STORY: self._write_user_story,
            ProductActionType.PRIORITIZE: self._prioritize_backlog,
            ProductActionType.STAKEHOLDER_SYNC: self._sync_stakeholders,
        }

    async def observe(self, env: ProductEnvironment) -> Observation:
        """观察产品环境: 用户反馈 / 市场动态 / 竞品分析 / 内部指标"""
        logger.info(
            "product_manager.observe.start",
            feedback_count=len(env.user_feedback),
            market_signal_count=len(env.market_signals),
        )
        signals = await self._gather_product_signals(env)
        return Observation(
            forgekin_id=self._soul_imprint.forgekin_id,
            signals=signals,
            timestamp=__import__("datetime").datetime.now,
        )

    async def act(self, action: ProductAction) -> ActionResult:
        """5 种 action.type 路由"""
        # 觉醒阶边界检查
        self._check_awakening_boundary(action)
        route = self._action_routes.get(action.type)
        if route is None:
            raise ValueError(f"未知 action.type={action.type}")
        logger.info(
            "product_manager.act.start",
            action_type=action.type.value,
            awakening_stage=self._awakening_stage.value,
        )
        result = await route(action.input)
        # 写入 EchoStore（跨会话累积）
        await self._echo_store.record(
            task_id=action.input.get("task_id", "unknown"),
            result=result,
            source="product_manager",
        )
        return result

    async def verify(self, result: ActionResult) -> Verdict:
        """验证产品决策: 需求完整性 / 可行性 / 优先级合理性"""
        return await self._verify_product_decision(result)

    async def evolve(self) -> None:
        """自进化入口（由 ForgekinEngine 装饰器调用）"""
        # 1. 经验蒸馏: EchoStore → MindCodex
        # 2. 能力画像更新
        # 3. 进化阶评估
        # 4. 觉醒阶检查
        ...

    # ── 觉醒阶边界检查 ──────────────────────────────────────────────

    def _check_awakening_boundary(self, action: ProductAction) -> None:
        """觉醒阶 E3 上限: 愿景变更必须 operator 批准"""
        if action.type == ProductActionType.ROADMAP_UPDATE:
            if action.input.get("vision_level_change"):
                if self._awakening_stage.value < "E5":
                    raise PermissionError(
                        "愿景变更必须 operator 批准（觉醒阶 E3 上限）"
                    )

    # ── 5 种 action 实现（私有方法） ────────────────────────────────

    async def _analyze_requirements(self, input: dict[str, Any]) -> ActionResult:
        """需求挖掘: 用户访谈摘要 → 结构化需求"""
        # 调用 RequirementsTraceabilityMatrix + LLMClient
        ...

    async def _update_roadmap(self, input: dict[str, Any]) -> ActionResult:
        """路线图更新: 季度 / 月度规划"""
        # 调用 RoadmapPlanner
        ...

    async def _write_user_story(self, input: dict[str, Any]) -> ActionResult:
        """用户故事编写: As-a / I-want / So-that 三段式"""
        story = UserStory(
            story_id=input["story_id"],
            as_a=input["as_a"],
            i_want=input["i_want"],
            so_that=input["so_that"],
            acceptance_criteria=input["acceptance_criteria"],
            priority=input["priority"],
        )
        # 校验已在 UserStory Schema 层完成
        return ActionResult(output=story.model_dump, status="success")

    async def _prioritize_backlog(self, input: dict[str, Any]) -> ActionResult:
        """优先级排序: MoSCoW / RICE"""
        if self._prioritization_model == PrioritizationModel.MOSCOW:
            return await self._prioritize_moscow(input)
        return await self._prioritize_rice(input)

    async def _prioritize_moscow(self, input: dict[str, Any]) -> ActionResult:
        """MoSCoW: Must / Should / Could / Wont"""
        ...

    async def _prioritize_rice(self, input: dict[str, Any]) -> ActionResult:
        """RICE: (Reach × Impact × Confidence) / Effort"""
        items = input["items"]
        scored = []
        for item in items:
            reach = item["reach"]
            impact = item["impact"]
            confidence = item["confidence"]
            effort = item["effort"]
            rice_score = (reach * impact * confidence) / max(1, effort)
            scored.append({**item, "rice_score": rice_score})
        scored.sort(key=lambda x: x["rice_score"], reverse=True)
        return ActionResult(output={"ranked": scored}, status="success")

    async def _sync_stakeholders(self, input: dict[str, Any]) -> ActionResult:
        """利益相关者沟通: 跨智能体协调"""
        # 调用 StakeholderCommunicator + MindCouncil
        ...

    async def _verify_product_decision(self, result: ActionResult) -> Verdict:
        """验证产品决策: 需求完整性 / 可行性 / 优先级合理性"""
        ...

    async def _gather_product_signals(self, env: ProductEnvironment) -> dict[str, Any]:
        """采集产品信号"""
        return {
            "user_feedback": env.user_feedback,
            "market_signals": env.market_signals,
            "competitor_analysis": env.competitor_analysis,
            "internal_metrics": env.internal_metrics,
        }
```

### 2.3 数据结构

```python
# flowforge/forgemind/species_impl/types.py（节选）
from datetime import datetime
from enum import Enum
from pydantic import BaseModel, Field


class EvolutionStage(str, Enum):
    E1_SPROUT = "E1"
    E2_SPROUT_STABLE = "E2"
    E3_GROWTH = "E3"
    E4_GROWTH_DEEP = "E4"
    E5_AWAKENED = "E5"
    E6_FORGEMIND = "E6"


class AwakeningStage(str, Enum):
    E1_FULL_HUMAN = "E1"
    E2_SUGGEST = "E2"
    E3_BOUNDED_AUTONOMOUS = "E3"
    E4_EVOLVING = "E4"
    E5_CO_CREATIVE = "E5"
    E6_FORGEMIND_LED = "E6"


class SoulImprint(BaseModel):
    """SoulImprint（持久身份）"""
    forgekin_id: str
    imprint_id: str
    seed_params: dict
    value_anchors: list[str]
    namespace: str
    created_at: datetime


class Observation(BaseModel):
    forgekin_id: str
    signals: dict
    timestamp: datetime


class ActionResult(BaseModel):
    output: dict
    status: str  # success / failure / partial
    error: str | None = None


class Verdict(BaseModel):
    valid: bool
    score: float = Field(ge=0.0, le=1.0)
    reason: str | None = None
```

### 2.4 关键算法

```
算法: ProductManagerForgekin.act(action)
输入: ProductAction (type + input)
输出: ActionResult

1. _check_awakening_boundary(action)
   1.1 IF action.type == ROADMAP_UPDATE AND input.vision_level_change:
       1.1.1 IF awakening_stage < E5:
             RAISE PermissionError("愿景变更必须 operator 批准")

2. route = _action_routes.get(action.type)
3. IF route is None: RAISE ValueError
4. result = await route(action.input)
5. await echo_store.record(task_id, result, source="product_manager")
6. RETURN result


算法: _prioritize_rice(items)
输入: list[dict] (每项含 reach / impact / confidence / effort)
输出: list[dict] (按 rice_score 降序)

1. FOR EACH item IN items:
   1.1 rice_score = (reach × impact × confidence) / max(1, effort)
   1.2 item["rice_score"] = rice_score
2. 按 rice_score 降序排序
3. RETURN sorted_items
```

---

## 3. 模块实现

### 3.1 关键代码片段

```python
# flowforge/forgemind/forging/pipeline.py（节选，第 2 步"能力注入"）
class ForgePipeline:
    async def inject_capability_pm(
        self, forgekin_id: str, seed
    ) -> "ProductManagerForgekin":
        """锻造流水线第 2 步: 能力注入（产品经理）"""
        from flowforge.forgemind.species_impl.org.product_manager import (
            ProductManagerForgekin, PrioritizationModel,
        )
        from flowforge.forgemind.species_impl.types import (
            SoulImprint, EvolutionStage, AwakeningStage,
        )

        soul_imprint = SoulImprint(
            forgekin_id=forgekin_id,
            imprint_id=f"imprint_{forgekin_id}",
            seed_params=seed.dict,
            value_anchors=seed.value_anchors,
            namespace="product_manager",
            created_at=datetime.now,
        )
        capability_profile = await self._capability_repo.load(forgekin_id)
        return ProductManagerForgekin(
            soul_imprint=soul_imprint,
            echo_store=self._echo_store_factory(forgekin_id),
            capability_profile=capability_profile,
            evolution_stage=EvolutionStage.E1,
            awakening_stage=AwakeningStage.E1,
            prioritization_model=PrioritizationModel.MOSCOW,
        )
```

### 3.2 关键流程时序图

```
operator 输入用户反馈
       │
       ▼
┌────────────────────────────────────────────────────────────────┐
│ 1. ProductManagerForgekin.observe(env)                         │
│    - 采集 user_feedback / market_signals / ...                 │
└────────────────────────┬───────────────────────────────────────┘
                         │ Observation
                         ▼
┌────────────────────────────────────────────────────────────────┐
│ 2. ProductManagerForgekin.act(action)                          │
│    - _check_awakening_boundary (愿景变更拦截)                  │
│    - route = _action_routes[action.type]                       │
│    - result = await route(input)                               │
│    - echo_store.record                                         │
└────────────────────────┬───────────────────────────────────────┘
                         │ ActionResult
                         ▼
┌────────────────────────────────────────────────────────────────┐
│ 3. ProductManagerForgekin.verify(result)                       │
│    - 需求完整性 / 可行性 / 优先级合理性                        │
└────────────────────────┬───────────────────────────────────────┘
                         │ Verdict
                         ▼
┌────────────────────────────────────────────────────────────────┐
│ 4. MindCouncil.notify (协调架构师与开发者)                     │
│    + CapabilityProfile.refresh (Eval 信号)                     │
│    + F044 交付经理.报告 (进度同步)                              │
└────────────────────────────────────────────────────────────────┘
```

### 3.3 错误处理

| 异常 | 触发场景 | 处理策略 |
|------|---------|---------|
| `PermissionError("愿景变更必须 operator 批准")` | 觉醒阶 < E5 时试图修改愿景 | 拒绝执行，提示 operator 介入 |
| `ValueError("priority 必须是 MoSCoW 之一")` | UserStory priority 字段非法 | Schema 层拒绝构造 |
| `ValueError("未知 action.type")` | 路由表未覆盖的 action.type | 拒绝执行，提示支持的动作类型 |
| `ValidationError("as_a / i_want / so_that 不可为空")` | UserStory 三段式缺失 | Schema 层拒绝构造 |

### 3.4 性能优化

| 指标 | 目标 | 优化手段 |
|------|:----:|---------|
| 单次需求分析延迟 | < 3 分钟 | Loop 执行超时控制 + 5 评委并行评审 |
| 路线图更新延迟 | < 30 秒 | 本地缓存 + 增量更新 |
| 优先级排序延迟 | < 5 秒 | RICE 公式本地计算，无 LLM 调用 |
| 用户故事生成延迟 | < 60 秒 | 单次 LLM 调用 + 模板校验 |

---

## 4. 跨模块协作实现

### 4.1 上游依赖如何调用

**ForgePipeline 调用 ProductManagerForgekin 构造器**（第 2 步"能力注入"）：

```python
# 详见 3.1 关键代码片段
forgekin = await pipeline.inject_capability_pm(forgekin_id, seed)
```

**MindCouncil 调用 ProductManagerForgekin 发起产品方向讨论**：

```python
class MindCouncil:
    async def initiate_product_discussion(
        self, pm_forgekin: ProductManagerForgekin, topic: str
    ) -> None:
        await pm_forgekin.act(ProductAction(
            type=ProductActionType.STAKEHOLDER_SYNC,
            input={"topic": topic, "channel": "product_direction"},
        ))
```

### 4.2 下游影响如何被调用

**F044 交付经理读取产品经理决策进度**（通过 EchoStore）：

```python
class DeliveryManagerForgekin:
    async def track_pm_progress(self, pm_forgekin_id: str) -> "ProgressReport":
        decisions = await self._echo_store.list(
            forgekin_id=pm_forgekin_id, source="product_manager"
        )
        return ProgressReport(
            total_decisions=len(decisions),
            pending=sum(1 for d in decisions if d.status == "pending"),
        )
```

### 4.3 集成测试点

```python
# flowforge/forgemind/forging/tests/test_product_manager.py
import pytest
from flowforge.forgemind.species_impl.org.product_manager import (
    ProductManagerForgekin, ProductAction, ProductActionType,
    ProductEnvironment, UserStory,
)
from flowforge.forgemind.species_impl.types import (
    SoulImprint, EvolutionStage, AwakeningStage,
)


@pytest.mark.asyncio
async def test_vision_change_requires_operator_approval(real_llm_client):
    """T1 真实 LLM + T3 具体断言: 觉醒阶 E3 上限验证"""
    pm = ProductManagerForgekin(
        soul_imprint=..., echo_store=..., capability_profile=...,
        awakening_stage=AwakeningStage.E3,
    )
    action = ProductAction(
        type=ProductActionType.ROADMAP_UPDATE,
        input={"vision_level_change": True},
    )
    with pytest.raises(PermissionError, match="愿景变更必须 operator 批准"):
        await pm.act(action)


@pytest.mark.asyncio
async def test_user_story_moscow_validation():
    """T3 具体断言: MoSCoW 模板校验"""
    with pytest.raises(ValueError, match="priority 必须是 MoSCoW 之一"):
        UserStory(
            story_id="us_001",
            as_a="开发者", i_want="自动部署", so_that="减少手动操作",
            acceptance_criteria=["部署 < 5 分钟"],
            priority="high",  # 非法
        )


@pytest.mark.asyncio
async def test_rice_prioritization():
    """T3 具体断言: RICE 排序"""
    pm = ProductManagerForgekin(
        soul_imprint=..., echo_store=..., capability_profile=...,
        prioritization_model=PrioritizationModel.RICE,
    )
    action = ProductAction(
        type=ProductActionType.PRIORITIZE,
        input={"items": [
            {"id": "A", "reach": 100, "impact": 3, "confidence": 0.8, "effort": 5},
            {"id": "B", "reach": 50, "impact": 5, "confidence": 0.9, "effort": 2},
        ]},
    )
    result = await pm.act(action)
    assert result.output["ranked"][0]["id"] == "B"  # RICE 112.5 > 48
```

---

## 5. 详细设计验收

### 5.1 功能验收 AC

- [ ] AC-1: ProductManagerForgekin 可通过 ForgePipeline 6 步锻造构造
- [ ] AC-2: 5 种 action.type 路由表覆盖全部动作
- [ ] AC-3: 觉醒阶 E3 上限校验（愿景变更抛 PermissionError）
- [ ] AC-4: UserStory Schema 层校验 As-a / I-want / So-that + MoSCoW
- [ ] AC-5: 优先级排序支持 MoSCoW 和 RICE 两种模型
- [ ] AC-6: 所有决策写入 EchoStore（跨会话累积）

### 5.2 性能验收

- [ ] AC-7: 单次需求分析 < 3 分钟
- [ ] AC-8: 路线图更新 < 30 秒
- [ ] AC-9: RICE 排序 < 5 秒

### 5.3 安全验收

- [ ] AC-10: 觉醒阶边界检查在 `act` 入口拦截
- [ ] AC-11: 产品经理不可直接修改架构师产物（通过 MindCouncil 协调）

### 5.4 Eval 验收

- [ ] AC-12: 需求完整性 ≥ 85%
- [ ] AC-13: 优先级合理性 ≥ 80%

---

## 6. 引用

- [doc:../spec.md#§2.3.2]（可进化智能体定义）
- [doc:../arch.md#§2.7.2]（可进化智能体架构）
- [doc:../design.md#§2.7.1]（产品经理Forgekin详细设计）
- [doc:../features/F041-product-manager.md]（同号 Feature 级 SRS）
- [doc:../architecture/A041-product-manager.md]（同号 Feature 级 SAD）
- [doc:../decisions/013-all-things-spirit-mind-vision.md]（万物ForgeMind心智愿景 ADR）
- [doc:../../CONTRIBUTING.md#31-15-条编程红线违反即拒绝合入]（第 9 / 11 / 12 条）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（详细设计骨架，对应 F041 / A041） | 开发者 Forgekin（猎犬·夏洛克） |
