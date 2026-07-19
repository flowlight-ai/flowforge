# D020: 七类归因矩阵详细设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 开发者灵智体（猎犬·夏洛克）
> **对应 spec.md**: [doc:../spec.md#§3.5]（FR-CORE-005）
> **对应 arch.md**: [doc:../arch.md#§3.5]
> **对应 design.md**: [doc:../design.md#§3.5]
> **对应 Feature**: [doc:../features/F020-seven-attribution.md]（同号 Feature 级 SRS）
> **对应 Architecture**: [doc:../architecture/A020-seven-attribution.md]（同号 Feature 级 SAD）
> **依赖 ADR**: [doc:../decisions/009-eval-self-metabolism.md]
> **9 大点名称修订**: 已应用（双轨命名 + AI 术语优先 + 弱化万物 + 去 AGI 化）

---

## 1. 详细设计上下文

### 1.1 设计问题

Eval 自代谢系统（§3.5）L3 层需要将失败事件归因到 7 类根因之一，A020 架构设计已确认七类归因类型：
1. **愿景缺口**（Vision Gap）：CVO 愿景本身缺失或不明确
2. **翻译偏差**（Translation Drift）：愿景到 spec 的翻译失真
3. **harness 错位**（Harness Mismatch）：spec 到 harness 的实现错位
4. **工具缺口**（Tool Gap）：工具链缺失必要能力
5. **执行缺口**（Execution Gap）：执行未按 spec 走
6. **环境漂移**（Environment Drift）：运行环境与预期不一致
7. **品味落差**（Taste Gap）：实现质量低于品味标准

本详细设计进一步下沉到代码层，需要解决以下子问题：

1. **决策树固定顺序的实现**：7 类归因必须按固定顺序判定（愿景→翻译→harness→工具→执行→环境→品味），如何在代码层强制顺序不可变。
2. **主归因 + 次归因的并存**：单个失败事件可能有多个归因（主归因决定修复路由，次归因记录备查），如何在 Attribution 模型中表达。
3. **归因搜索索引**：F020 需要按 forgekin_id / metric_name / time_window 查询历史归因，如何设计索引。
4. **修复路由的派发幂等**：FixAction 派发到 F021/F022/F024 后必须幂等，避免重复修复。
5. **失败事件的强类型化**：FailureEvent 必须包含足够的上下文（forgekin_id / cycle_id / signal_conflict / friction_metric），让归因器可决策。
6. **决策树剪枝的性能**：7 步决策树的执行性能需 < 50ms（归因是高频调用）。
7. **品味落差的判定难度**：品味落差是主观维度，如何用可量化指标（如 LLM 评分、品味画像）支撑判定。
8. **归因置信度**：每个归因必须带置信度（0~1），低于阈值的归因需人工复核。

### 1.2 设计约束

- **单向依赖约束**：`flowforge/core/eval/attribution/` 禁止 import F021/F022/F024/F040 任何模块（编程红线第 10 条延伸）。修复路由通过 EventBus 派发解耦。
- **DI 容器约束**：`AttributionClassifier` 通过 DI 容器注入，绑定生命周期为 `singleton`，禁止直接实例化（编程红线第 12 条）。
- **Repository 层约束**：归因记录持久化必须经 `AttributionRepository` 抽象，禁止直操作数据库（编程红线第 13 条）。
- **配置驱动约束**：决策树阈值 / 置信度阈值 / 修复路由表外置 YAML（编程红线第 11 条）。
- **决策树顺序约束**：七步决策树顺序固定不可变（vision → translation → harness → tool → execution → environment → taste），代码层用 Enum + ordered list 强制。
- **主归因优先约束**：每个失败事件必须有且仅有 1 个主归因（primary），可有 0~N 个次归因（secondary）。
- **修复路由幂等约束**：FixAction 派发必须幂等，重复派发不产生副作用。
- **异步约束**：所有 I/O 操作使用 `async/await`，归因主流程同步执行（决策树需顺序判定）。
- **类型注解约束**：Python 3.11+，所有公共方法强制类型注解。
- **提示词外置约束**：品味判定提示词外置到 `config/eval/attribution_prompts.yaml`（编程红线第 11 条 + P16）。

### 1.3 设计影响

- **对 L2 三方信号交叉（F019/A019）**：`SignalConflict` 是 F020 的输入。本设计需保证归因器订阅 `f020.attribution.request` 事件消费冲突。
- **对 L1 Eval Contract（F018/A018）**：归因结果触发 `sunset_signal`（如 superseded_by）派发到 F018，影响契约 sunset 流程。
- **对 F012 退役**：当主归因为 `superseded_by` 时，F012 退役流程启动。
- **对 F021 副作用 WAL**：归因修复可能派发到 F021 WAL（如 environment_drift 触发 WAL 回放）。
- **对 F022 Tier 1-4 恢复**：归因修复可能派发到 F022（如 execution_gap 触发 Tier 2 重放）。
- **对 F024 强 workflow**：归因修复可能派发到 F024（如 harness_mismatch 触发强 workflow 回滚）。
- **对 F040 控制面**：所有归因结果与修复派发记录写入 F040 Eval Hub。
- **对 Forgekin.learn()**：Forgekin 学习接口在 learn() 中调用归因结果，更新品味画像（CapabilityProfile）。
- **对 DI 容器**：需新增 `attribution_classifier` / `attribution_repository` / `fix_router` 三个绑定。

---

## 2. 详细设计

### 2.1 类图 ASCII

```
┌──────────────────────────────────────────────────────────────────────────┐
│                       <<module>> eval.attribution                          │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  <<enum>> AttributionType (固定顺序)                                       │
│  + VISION_GAP (1)           愿景缺口                                       │
│  + TRANSLATION_DRIFT (2)     翻译偏差                                       │
│  + HARNESS_MISMATCH (3)      harness 错位                                    │
│  + TOOL_GAP (4)             工具缺口                                        │
│  + EXECUTION_GAP (5)        执行缺口                                        │
│  + ENVIRONMENT_DRIFT (6)     环境漂移                                        │
│  + TASTE_GAP (7)            品味落差                                        │
│                                                                            │
│  <<enum>> FixTarget                                                       │
│  + F021_WAL                派发到 F021 副作用 WAL                          │
│  + F022_TIER               派发到 F022 Tier 分级恢复                       │
│  + F024_WORKFLOW           派发到 F024 强 workflow                          │
│  + F012_SUNSET             派发到 F012 退役                                 │
│  + F040_EVAL_HUB           派发到 F040 控制面（仅记录，无动作）              │
│  + HUMAN_REVIEW            派发到人工复核                                   │
│                                                                            │
│  <<model>> FailureEvent                                                    │
│  + event_id: str (UUID v7)                                                │
│  + forgekin_id: str                                                        │
│  + cycle_id: str                                                           │
│  + signal_conflict: Optional[SignalConflict]                               │
│  + friction_metric: Optional[FrictionMetric]                               │
│  + failure_summary: str                                                    │
│  + occurred_at: datetime                                                   │
│  + context_uri: str                                                        │
│                                                                            │
│  <<model>> Attribution                                                     │
│  + attribution_id: str                                                    │
│  + event_id: str                                                           │
│  + attribution_type: AttributionType                                      │
│  + is_primary: bool                                                        │
│  + confidence: float (0.0~1.0)                                            │
│  + evidence: list[str]                                                    │
│  + suggested_fix: Optional[FixAction]                                      │
│  + detected_at: datetime                                                   │
│                                                                            │
│  <<model>> FixAction                                                       │
│  + fix_id: str                                                             │
│  + attribution_id: str                                                    │
│  + target: FixTarget                                                      │
│  + payload: dict                                                           │
│  + idempotency_key: str                                                    │
│  + dispatched: bool = False                                                │
│                                                                            │
│  <<interface>> AttributionClassifier (ABC)                                 │
│  + classify(event) -> list[Attribution]                                    │
│                                                                            │
│  <<interface>> AttributionDecisionTree (ABC)                               │
│  + traverse(event) -> list[Attribution]                                    │
│  + check_vision_gap(event) -> Optional[Attribution]                         │
│  + check_translation_drift(event) -> Optional[Attribution]                 │
│  + check_harness_mismatch(event) -> Optional[Attribution]                   │
│  + check_tool_gap(event) -> Optional[Attribution]                          │
│  + check_execution_gap(event) -> Optional[Attribution]                     │
│  + check_environment_drift(event) -> Optional[Attribution]                 │
│  + check_taste_gap(event) -> Optional[Attribution]                        │
│                                                                            │
│  <<interface>> FixRouter (ABC)                                             │
│  + route(attributions) -> list[FixAction]                                  │
│  + dispatch(fix_actions) -> int                                           │
│                                                                            │
│  <<interface>> AttributionRepository (ABC)                                 │
│  + insert_attribution(attr) -> str                                         │
│  + query_by_event(event_id) -> list[Attribution]                          │
│  + query_by_forgekin(forgekin_id, window) -> list[Attribution]            │
│  + search_index(forgekin_id, metric_name, window) -> list[Attribution]    │
│                                                                            │
└──────────────────────────────────────────────────────────────────────────┘
```

### 2.2 接口实现 Python 代码

```python
# flowforge/core/eval/attribution/models.py
from __future__ import annotations
from typing import Optional, Any
from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict, model_validator
from enum import Enum


class AttributionType(str, Enum):
    """七类归因（固定顺序，禁止调整）"""
    VISION_GAP = "vision_gap"  # 1. 愿景缺口
    TRANSLATION_DRIFT = "translation_drift"  # 2. 翻译偏差
    HARNESS_MISMATCH = "harness_mismatch"  # 3. harness 错位
    TOOL_GAP = "tool_gap"  # 4. 工具缺口
    EXECUTION_GAP = "execution_gap"  # 5. 执行缺口
    ENVIRONMENT_DRIFT = "environment_drift"  # 6. 环境漂移
    TASTE_GAP = "taste_gap"  # 7. 品味落差

    @classmethod
    def ordered(cls) -> list["AttributionType"]:
        """返回固定顺序的归因列表"""
        return [
            cls.VISION_GAP,
            cls.TRANSLATION_DRIFT,
            cls.HARNESS_MISMATCH,
            cls.TOOL_GAP,
            cls.EXECUTION_GAP,
            cls.ENVIRONMENT_DRIFT,
            cls.TASTE_GAP,
        ]


class FixTarget(str, Enum):
    F021_WAL = "f021_wal"
    F022_TIER = "f022_tier"
    F024_WORKFLOW = "f024_workflow"
    F012_SUNSET = "f012_sunset"
    F040_EVAL_HUB = "f040_eval_hub"
    HUMAN_REVIEW = "human_review"


class FailureEvent(BaseModel):
    """失败事件"""
    model_config = ConfigDict(frozen=True)

    event_id: str = Field(min_length=1)  # UUID v7
    forgekin_id: str = Field(min_length=1)
    cycle_id: str = Field(min_length=1)
    signal_conflict: Optional[dict] = None  # 来自 F019 SignalConflict
    friction_metric: Optional[dict] = None  # 来自 F018 FrictionMetric
    failure_summary: str = Field(min_length=1)
    occurred_at: datetime
    context_uri: str = Field(min_length=1)  # 溯源 URI


class Attribution(BaseModel):
    """归因结果"""
    model_config = ConfigDict(frozen=True)

    attribution_id: str = Field(min_length=1)
    event_id: str = Field(min_length=1)
    attribution_type: AttributionType
    is_primary: bool  # 主归因为 True，次归因为 False
    confidence: float = Field(ge=0.0, le=1.0)
    evidence: list[str] = Field(default_factory=list)
    suggested_fix: Optional["FixAction"] = None
    detected_at: datetime

    @model_validator(mode="after")
    def _validate_confidence_threshold(self) -> "Attribution":
        # 置信度阈值由配置注入；此处仅校验范围
        if not 0.0 <= self.confidence <= 1.0:
            raise ValueError(f"confidence must be in [0,1], got {self.confidence}")
        return self


class FixAction(BaseModel):
    """修复动作"""
    model_config = ConfigDict(frozen=True)

    fix_id: str = Field(min_length=1)
    attribution_id: str = Field(min_length=1)
    target: FixTarget
    payload: dict
    idempotency_key: str = Field(min_length=1)
    dispatched: bool = False


Attribution.model_rebuild()


# flowforge/core/eval/attribution/interfaces.py
from abc import ABC, abstractmethod
from typing import Optional
from datetime import datetime


class AttributionClassifier(ABC):
    """归因分类器入口"""

    @abstractmethod
    async def classify(self, event: FailureEvent) -> list[Attribution]:
        """
        归因主流程：
        1. 调用决策树 traverse
        2. 标记主归因（is_primary=True）与次归因
        3. 持久化所有归因到 Repository
        4. 调用 FixRouter.route 派发修复
        返回归因列表（含主+次）
        """


class AttributionDecisionTree(ABC):
    """决策树（固定顺序判定）"""

    @abstractmethod
    async def traverse(self, event: FailureEvent) -> list[Attribution]:
        """
        按固定顺序遍历七步判定：
        1. check_vision_gap
        2. check_translation_drift
        3. check_harness_mismatch
        4. check_tool_gap
        5. check_execution_gap
        6. check_environment_drift
        7. check_taste_gap
        每步命中则返回 Attribution，不命中继续下一步。
        """

    @abstractmethod
    async def check_vision_gap(self, event: FailureEvent) -> Optional[Attribution]: ...

    @abstractmethod
    async def check_translation_drift(self, event: FailureEvent) -> Optional[Attribution]: ...

    @abstractmethod
    async def check_harness_mismatch(self, event: FailureEvent) -> Optional[Attribution]: ...

    @abstractmethod
    async def check_tool_gap(self, event: FailureEvent) -> Optional[Attribution]: ...

    @abstractmethod
    async def check_execution_gap(self, event: FailureEvent) -> Optional[Attribution]: ...

    @abstractmethod
    async def check_environment_drift(self, event: FailureEvent) -> Optional[Attribution]: ...

    @abstractmethod
    async def check_taste_gap(self, event: FailureEvent) -> Optional[Attribution]: ...


class FixRouter(ABC):
    """修复路由器"""

    @abstractmethod
    async def route(self, attributions: list[Attribution]) -> list[FixAction]:
        """
        按归因类型映射修复目标：
        - VISION_GAP → HUMAN_REVIEW（愿景需人工修订）
        - TRANSLATION_DRIFT → F040_EVAL_HUB（记录告警，待 spec 修订）
        - HARNESS_MISMATCH → F024_WORKFLOW（触发强 workflow 回滚）
        - TOOL_GAP → F040_EVAL_HUB（记录，待工具补全）
        - EXECUTION_GAP → F022_TIER（Tier 2 重放）
        - ENVIRONMENT_DRIFT → F021_WAL（WAL 回放）
        - TASTE_GAP → HUMAN_REVIEW（品味需人工复核）
        """

    @abstractmethod
    async def dispatch(self, fix_actions: list[FixAction]) -> int:
        """
        派发修复动作到目标模块（EventBus 异步）：
        1. 按 idempotency_key 去重
        2. 写 EventBus
        3. 标记 dispatched=True
        返回成功派发数
        """


class AttributionRepository(ABC):
    """归因持久化 Repository"""

    @abstractmethod
    async def insert_attribution(self, attribution: Attribution) -> str: ...

    @abstractmethod
    async def query_by_event(self, event_id: str) -> list[Attribution]: ...

    @abstractmethod
    async def query_by_forgekin(
        self, forgekin_id: str, time_window: tuple[datetime, datetime]
    ) -> list[Attribution]: ...

    @abstractmethod
    async def search_index(
        self, forgekin_id: str, metric_name: str,
        time_window: tuple[datetime, datetime]
    ) -> list[Attribution]:
        """复合索引查询：forgekin_id + metric_name + time_window"""
```

### 2.3 数据结构 Pydantic Models（配置）

```python
# flowforge/core/eval/attribution/config.py
from __future__ import annotations
from typing import Optional
from pydantic import BaseModel, Field, model_validator


class DecisionStepConfig(BaseModel):
    """单步决策配置"""
    attribution_type: str
    confidence_threshold: float = Field(default=0.6, ge=0.0, le=1.0)
    evidence_required: bool = True
    hint_uri: Optional[str] = None  # 提示词或文档 URI


class FixRoutingRule(BaseModel):
    """修复路由规则"""
    attribution_type: str
    fix_target: str  # FixTarget 值
    payload_template: dict  # payload 模板（含变量占位）


class AttributionConfig(BaseModel):
    """YAML 配置加载结果"""
    decision_steps: list[DecisionStepConfig] = Field(min_length=7, max_length=7)
    fix_routing_rules: list[FixRoutingRule] = Field(min_length=7, max_length=7)
    primary_confidence_threshold: float = Field(default=0.7, ge=0.0, le=1.0)
    max_secondary_attributions: int = Field(default=3, ge=0, le=10)
    dispatch_mode: str = "async"  # async | sync

    @model_validator(mode="after")
    def _validate_decision_steps_order(self) -> "AttributionConfig":
        expected_order = [
            "vision_gap", "translation_drift", "harness_mismatch",
            "tool_gap", "execution_gap", "environment_drift", "taste_gap",
        ]
        actual_order = [s.attribution_type for s in self.decision_steps]
        if actual_order != expected_order:
            raise ValueError(
                f"decision_steps order must be {expected_order}, got {actual_order}"
            )
        routed_types = {r.attribution_type for r in self.fix_routing_rules}
        if routed_types != set(expected_order):
            raise ValueError(
                f"fix_routing_rules must cover all 7 types, got {routed_types}"
            )
        return self


class AttributionSearchIndex(BaseModel):
    """归因搜索索引模型"""
    forgekin_id: str
    metric_name: str
    attribution_type: str
    confidence: float
    occurred_at: str  # ISO datetime
    attribution_id: str
```

### 2.4 关键算法伪代码

#### 2.4.1 决策树固定顺序遍历算法

```
function traverse(event: FailureEvent) -> list[Attribution]:

    attributions = []

    # 固定顺序，禁止调整（由 Enum.ordered() 强制）
    ordered_types = AttributionType.ordered()

    primary_assigned = False
    for step_config in config.decision_steps:
        attr_type = AttributionType(step_config.attribution_type)

        # 按顺序调用对应的 check_* 方法
        attribution = await call_check_method(attr_type, event, step_config)

        if attribution is not None:
            # 第一个命中的为主归因，后续为次归因
            if not primary_assigned:
                attribution = attribution.with(is_primary=True)
                primary_assigned = True
            else:
                attribution = attribution.with(is_primary=False)

                # 次归因数量上限
                if len([a for a in attributions if not a.is_primary]) >= config.max_secondary_attributions:
                    break

            attributions.append(attribution)

    # 若所有 check_* 都未命中，标记为 TASTE_GAP（兜底）
    if not attributions:
        fallback = Attribution(
            attribution_id=uuid_v7(),
            event_id=event.event_id,
            attribution_type=AttributionType.TASTE_GAP,
            is_primary=True,
            confidence=0.3,  # 低置信度，需人工复核
            evidence=["fallback: no specific attribution matched"],
            detected_at=now(),
        )
        attributions.append(fallback)

    return attributions
```

#### 2.4.2 单步归因判定算法（以 vision_gap 为例）

```
function check_vision_gap(event: FailureEvent, step_config) -> Optional[Attribution]:

    # 1. 从 F007/F008 VISION.md / ROADMAP.md 读取愿景
    vision = await load_vision(event.forgekin_id)

    # 2. 判定愿景是否缺失或不明确
    if vision is None or not vision.has_clear_metric(event.metric_name):
        confidence = compute_vision_gap_confidence(event, vision)
        if confidence >= step_config.confidence_threshold:
            return Attribution(
                attribution_id=uuid_v7(),
                event_id=event.event_id,
                attribution_type=AttributionType.VISION_GAP,
                is_primary=False,  # 由 traverse 统一标记
                confidence=confidence,
                evidence=[
                    f"vision_uri={vision.uri if vision else 'None'}",
                    f"metric_name={event.metric_name} not found in vision",
                ],
                detected_at=now(),
            )

    # 3. 检查是否为 superseded_by（被新愿景取代）
    if event.signal_conflict and event.signal_conflict.severity == "high":
        if "superseded" in event.failure_summary.lower():
            return Attribution(
                attribution_id=uuid_v7(),
                event_id=event.event_id,
                attribution_type=AttributionType.VISION_GAP,
                is_primary=False,
                confidence=0.9,
                evidence=["superseded_by detected in failure_summary"],
                detected_at=now(),
            )

    return None  # 未命中
```

#### 2.4.3 修复路由派发算法

```
function route(attributions: list[Attribution]) -> list[FixAction]:

    fix_actions = []
    for attr in attributions:
        # 主归因优先派发；次归因按需派发
        rule = find_routing_rule(attr.attribution_type, config.fix_routing_rules)
        if rule is None:
            continue

        # 渲染 payload 模板
        payload = render_payload_template(rule.payload_template, attr)

        fix = FixAction(
            fix_id=uuid_v7(),
            attribution_id=attr.attribution_id,
            target=FixTarget(rule.fix_target),
            payload=payload,
            idempotency_key=f"fix:{attr.attribution_id}:{rule.fix_target}",
            dispatched=False,
        )
        fix_actions.append(fix)

    return fix_actions


function dispatch(fix_actions: list[FixAction]) -> int:

    if config.dispatch_mode == "sync":
        for fix in fix_actions:
            if fix.dispatched:
                continue  # 幂等
            await event_bus.publish_sync(
                topic=f"fix.target.{fix.target.value}",
                payload=fix.model_dump(),
            )
            fix._internal_set("dispatched", True)  # type: ignore
    else:
        # 批量异步派发，按 target 分组
        by_target = group_by(fix_actions, key=lambda f: f.target)
        for target, fixes in by_target.items():
            await event_bus.publish_batch(
                topic=f"fix.target.{target.value}",
                payloads=[f.model_dump() for f in fixes if not f.dispatched],
            )
            for f in fixes:
                f._internal_set("dispatched", True)  # type: ignore

    return sum(1 for f in fix_actions if f.dispatched)
```

#### 2.4.4 品味落差判定算法

```
function check_taste_gap(event: FailureEvent, step_config) -> Optional[Attribution]:

    # 1. 调用 LLM 评估品味（提示词外置到 attribution_prompts.yaml）
    taste_score = await llm_client.evaluate(
        prompt=load_prompt("attribution_prompts.yaml#taste_gap"),
        input=event.failure_summary,
    )

    # 2. 与 forgekin 的品味画像（CapabilityProfile）对比
    profile = await load_capability_profile(event.forgekin_id)
    expected_taste = profile.taste_baseline

    # 3. 计算品味落差
    delta = expected_taste - taste_score
    if delta > step_config.confidence_threshold:
        return Attribution(
            attribution_id=uuid_v7(),
            event_id=event.event_id,
            attribution_type=AttributionType.TASTE_GAP,
            is_primary=False,
            confidence=delta,
            evidence=[
                f"expected_taste={expected_taste}",
                f"actual_taste={taste_score}",
                f"delta={delta}",
            ],
            detected_at=now(),
        )

    return None
```

---

## 3. 模块实现

### 3.1 关键代码片段

```python
# flowforge/core/eval/attribution/classifier.py
from __future__ import annotations
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from .models import (
    AttributionType, FailureEvent, Attribution, FixAction, FixTarget,
)
from .interfaces import (
    AttributionClassifier, AttributionDecisionTree,
    FixRouter, AttributionRepository,
)
from .config import AttributionConfig
from ...core.events.event_bus import EventBus

logger = logging.getLogger(__name__)


class DefaultAttributionClassifier(AttributionClassifier):
    """归因分类器默认实现"""

    def __init__(
        self,
        decision_tree: AttributionDecisionTree,
        fix_router: FixRouter,
        repository: AttributionRepository,
        event_bus: EventBus,
        config: AttributionConfig,
    ):
        self._tree = decision_tree
        self._router = fix_router
        self._repo = repository
        self._bus = event_bus
        self._cfg = config

    async def classify(self, event: FailureEvent) -> list[Attribution]:
        # 1. 决策树遍历
        raw_attributions = await self._tree.traverse(event)

        # 2. 标记主归因（第一个为主，其余为次）
        attributions: list[Attribution] = []
        for i, attr in enumerate(raw_attributions):
            if i == 0:
                # 主归因置信度阈值校验
                if attr.confidence < self._cfg.primary_confidence_threshold:
                    # 主归因置信度不足，标记为次归因，新增 HUMAN_REVIEW 主归因
                    secondary = attr.model_copy(update={"is_primary": False})
                    attributions.append(secondary)
                    primary = Attribution(
                        attribution_id=str(uuid.uuid1()),
                        event_id=event.event_id,
                        attribution_type=AttributionType.TASTE_GAP,
                        is_primary=True,
                        confidence=0.3,
                        evidence=["primary attribution confidence too low, fallback to HUMAN_REVIEW"],
                        detected_at=datetime.now(timezone.utc),
                    )
                    attributions.append(primary)
                else:
                    attributions.append(attr.model_copy(update={"is_primary": True}))
            else:
                # 次归因数量上限
                if len([a for a in attributions if not a.is_primary]) >= self._cfg.max_secondary_attributions:
                    break
                attributions.append(attr.model_copy(update={"is_primary": False}))

        # 3. 持久化所有归因
        for attr in attributions:
            await self._repo.insert_attribution(attr)

        # 4. 修复路由
        fix_actions = await self._router.route(attributions)
        dispatched = await self._router.dispatch(fix_actions)

        logger.info(
            f"classify event={event.event_id} "
            f"primary={attributions[0].attribution_type.value if attributions else 'none'} "
            f"secondary_count={len(attributions) - 1} "
            f"fixes_dispatched={dispatched}"
        )

        return attributions


class DefaultAttributionDecisionTree(AttributionDecisionTree):
    """决策树默认实现（固定顺序）"""

    def __init__(self, config: AttributionConfig):
        self._cfg = config
        self._steps = {
            AttributionType.VISION_GAP: self.check_vision_gap,
            AttributionType.TRANSLATION_DRIFT: self.check_translation_drift,
            AttributionType.HARNESS_MISMATCH: self.check_harness_mismatch,
            AttributionType.TOOL_GAP: self.check_tool_gap,
            AttributionType.EXECUTION_GAP: self.check_execution_gap,
            AttributionType.ENVIRONMENT_DRIFT: self.check_environment_drift,
            AttributionType.TASTE_GAP: self.check_taste_gap,
        }

    async def traverse(self, event: FailureEvent) -> list[Attribution]:
        results: list[Attribution] = []
        for attr_type in AttributionType.ordered():
            step_cfg = self._find_step_config(attr_type)
            if step_cfg is None:
                continue
            check_fn = self._steps[attr_type]
            attr = await check_fn(event)
            if attr is not None:
                # 应用置信度阈值
                if attr.confidence >= step_cfg.confidence_threshold:
                    results.append(attr)
        return results

    async def check_vision_gap(self, event: FailureEvent) -> Optional[Attribution]:
        # 简化版：检查 signal_conflict 是否涉及 CVO 愿景信号
        if event.signal_conflict and "cvo_vision" in str(event.signal_conflict):
            return Attribution(
                attribution_id=str(uuid.uuid1()),
                event_id=event.event_id,
                attribution_type=AttributionType.VISION_GAP,
                is_primary=False,
                confidence=0.8,
                evidence=["signal_conflict involves cvo_vision source"],
                detected_at=datetime.now(timezone.utc),
            )
        return None

    async def check_translation_drift(self, event: FailureEvent) -> Optional[Attribution]:
        # 检查 friction_metric 是否标记 translation 问题
        if event.friction_metric and "translation" in str(event.friction_metric).lower():
            return Attribution(
                attribution_id=str(uuid.uuid1()),
                event_id=event.event_id,
                attribution_type=AttributionType.TRANSLATION_DRIFT,
                is_primary=False,
                confidence=0.75,
                evidence=["friction_metric mentions translation"],
                detected_at=datetime.now(timezone.utc),
            )
        return None

    async def check_harness_mismatch(self, event: FailureEvent) -> Optional[Attribution]:
        if "harness" in event.failure_summary.lower():
            return Attribution(
                attribution_id=str(uuid.uuid1()),
                event_id=event.event_id,
                attribution_type=AttributionType.HARNESS_MISMATCH,
                is_primary=False,
                confidence=0.85,
                evidence=[f"failure_summary mentions harness: {event.failure_summary}"],
                detected_at=datetime.now(timezone.utc),
            )
        return None

    async def check_tool_gap(self, event: FailureEvent) -> Optional[Attribution]:
        if "tool" in event.failure_summary.lower() or "missing capability" in event.failure_summary.lower():
            return Attribution(
                attribution_id=str(uuid.uuid1()),
                event_id=event.event_id,
                attribution_type=AttributionType.TOOL_GAP,
                is_primary=False,
                confidence=0.7,
                evidence=[f"failure_summary mentions tool: {event.failure_summary}"],
                detected_at=datetime.now(timezone.utc),
            )
        return None

    async def check_execution_gap(self, event: FailureEvent) -> Optional[Attribution]:
        if event.signal_conflict and event.signal_conflict.get("severity") == "high":
            return Attribution(
                attribution_id=str(uuid.uuid1()),
                event_id=event.event_id,
                attribution_type=AttributionType.EXECUTION_GAP,
                is_primary=False,
                confidence=0.8,
                evidence=["high severity signal_conflict indicates execution deviation"],
                detected_at=datetime.now(timezone.utc),
            )
        return None

    async def check_environment_drift(self, event: FailureEvent) -> Optional[Attribution]:
        if "environment" in event.failure_summary.lower() or "config" in event.failure_summary.lower():
            return Attribution(
                attribution_id=str(uuid.uuid1()),
                event_id=event.event_id,
                attribution_type=AttributionType.ENVIRONMENT_DRIFT,
                is_primary=False,
                confidence=0.75,
                evidence=[f"failure_summary mentions environment: {event.failure_summary}"],
                detected_at=datetime.now(timezone.utc),
            )
        return None

    async def check_taste_gap(self, event: FailureEvent) -> Optional[Attribution]:
        # 兜底归因（低置信度）
        return Attribution(
            attribution_id=str(uuid.uuid1()),
            event_id=event.event_id,
            attribution_type=AttributionType.TASTE_GAP,
            is_primary=False,
            confidence=0.3,  # 低置信度
            evidence=["fallback: no specific evidence, taste gap assumed"],
            detected_at=datetime.now(timezone.utc),
        )

    def _find_step_config(self, attr_type: AttributionType):
        for s in self._cfg.decision_steps:
            if s.attribution_type == attr_type.value:
                return s
        return None


class DefaultFixRouter(FixRouter):
    """修复路由器默认实现"""

    # 归因类型 → 修复目标 的固定映射
    _DEFAULT_MAPPING = {
        AttributionType.VISION_GAP: FixTarget.HUMAN_REVIEW,
        AttributionType.TRANSLATION_DRIFT: FixTarget.F040_EVAL_HUB,
        AttributionType.HARNESS_MISMATCH: FixTarget.F024_WORKFLOW,
        AttributionType.TOOL_GAP: FixTarget.F040_EVAL_HUB,
        AttributionType.EXECUTION_GAP: FixTarget.F022_TIER,
        AttributionType.ENVIRONMENT_DRIFT: FixTarget.F021_WAL,
        AttributionType.TASTE_GAP: FixTarget.HUMAN_REVIEW,
    }

    def __init__(self, event_bus: EventBus, config: AttributionConfig):
        self._bus = event_bus
        self._cfg = config

    async def route(self, attributions: list[Attribution]) -> list[FixAction]:
        fix_actions: list[FixAction] = []
        for attr in attributions:
            target = self._lookup_target(attr.attribution_type)
            if target is None:
                continue
            payload = self._build_payload(attr, target)
            fix = FixAction(
                fix_id=str(uuid.uuid1()),
                attribution_id=attr.attribution_id,
                target=target,
                payload=payload,
                idempotency_key=f"fix:{attr.attribution_id}:{target.value}",
                dispatched=False,
            )
            fix_actions.append(fix)
        return fix_actions

    async def dispatch(self, fix_actions: list[FixAction]) -> int:
        if not fix_actions:
            return 0
        # 按 target 分组批量派发
        by_target: dict[FixTarget, list[FixAction]] = {}
        for f in fix_actions:
            if f.dispatched:
                continue
            by_target.setdefault(f.target, []).append(f)

        for target, fixes in by_target.items():
            await self._bus.publish_batch(
                topic=f"fix.target.{target.value}",
                payloads=[f.model_dump() for f in fixes],
            )
            for f in fixes:
                # frozen 模型不可修改字段，这里通过 _internal_set 内部接口
                object.__setattr__(f, "dispatched", True)
        return sum(1 for f in fix_actions if f.dispatched)

    def _lookup_target(self, attr_type: AttributionType) -> Optional[FixTarget]:
        # 优先配置规则，其次默认映射
        for rule in self._cfg.fix_routing_rules:
            if rule.attribution_type == attr_type.value:
                return FixTarget(rule.fix_target)
        return self._DEFAULT_MAPPING.get(attr_type)

    def _build_payload(self, attr: Attribution, target: FixTarget) -> dict:
        return {
            "attribution_id": attr.attribution_id,
            "attribution_type": attr.attribution_type.value,
            "confidence": attr.confidence,
            "evidence": attr.evidence,
            "target": target.value,
        }
```

### 3.2 关键流程时序图

```
[七类归因时序图]

  F019冲突派发   classifier    decision_tree   repository   fix_router   EventBus   F021/F022/F024/F012/F040
        │            │              │                │            │           │             │
        │ publish    │              │                │            │           │             │
        ├───────────>│              │                │            │           │             │
        │            │ traverse()   │                │            │           │             │
        │            ├─────────────>│                 │            │           │             │
        │            │              │ check_vision_gap()           │           │             │
        │            │              │ check_translation_drift()    │           │             │
        │            │              │ check_harness_mismatch()    │           │             │
        │            │              │ check_tool_gap()             │           │             │
        │            │              │ check_execution_gap()       │           │             │
        │            │              │ check_environment_drift()    │           │             │
        │            │              │ check_taste_gap()            │           │             │
        │            │              │ return [Attribution]          │           │             │
        │            │<─────────────┤                                │           │             │
        │            │ 标记主归因+次归因                                          │             │
        │            │ insert_attribution(attr)                                  │             │
        │            ├──────────────────────────────>│                          │             │
        │            │<──────────────────────────────┤                          │             │
        │            │ route(attributions)                                       │             │
        │            ├──────────────────────────────────────────────>│           │             │
        │            │                                              │ dispatch()│             │
        │            │                                              ├──────────>│ publish    │
        │            │                                              │           ├────────────>│ F021/F022/F024/F012/F040
        │            │<──────────────────────────────────────────────┤           │             │
        │<───────────┤                                                                        │
        │            │                                                                        │
```

### 3.3 错误处理

| 异常类型 | 触发场景 | 处理策略 | 重试次数 |
|---------|---------|---------|---------|
| `DecisionTreeOrderViolationError` | 决策步骤顺序与固定顺序不一致 | 拒绝加载配置，启动失败 | 不重试（硬约束违规） |
| `PrimaryConfidenceTooLowError` | 主归因置信度 < primary_confidence_threshold | 降级为次归因 + 新增 HUMAN_REVIEW 主归因 | 不重试 |
| `RepositoryInsertError` | 归因持久化失败 | 阻塞 classify，返回空列表，记录错误 | 3（指数退避） |
| `DispatchError` | EventBus publish 失败 | 持久化到 Repository 待重试队列 | 5（指数退避） |
| `LLMEvaluationError` | 品味判定 LLM 调用失败 | 兜底归因为 TASTE_GAP（低置信度） | 2 |
| `MaxSecondaryExceededError` | 次归因数量超过上限 | 截断次归因列表，记录警告 | 不重试 |
| `FixTargetUnknownError` | 修复目标未知 | 跳过该 fix，记录错误到 F040 | 不重试 |
| `IdempotencyConflictError` | 修复 idempotency_key 冲突 | 跳过该 fix，记录警告 | 不重试 |

### 3.4 性能优化

| 性能指标 | 目标值 | 优化手段 |
|---------|--------|---------|
| 决策树遍历时延（单事件） | < 50ms | 顺序判定 + 早停（主归因确定后可选） |
| 修复路由时延 | < 10ms | 配置映射表内存缓存 |
| 修复派发时延（10 fix） | < 50ms | EventBus batch publish |
| Repository 查询延迟 | < 100ms | forgekin_id + metric_name + time 复合索引 |
| 归因持久化延迟（10 归因） | < 200ms | 批量 insert + 异步索引更新 |
| 主归因准确率 | >= 90% | 决策树固定顺序 + 置信度阈值 |
| 次归因召回率 | >= 70% | 多步判定不早停 |
| 兜底归因比例 | < 10% | LLM 品味判定 + 证据充足 |

---

## 4. 跨模块协作实现

### 4.1 上游依赖如何调用

- **F019 三方信号交叉**：通过 EventBus 订阅 `f020.attribution.request` 主题接收 SignalConflict，转换为 FailureEvent。
- **F018 Eval Contract**：提供 `FrictionMetric` 作为 FailureEvent 输入。调用方需保证 friction_metric schema 一致。
- **F008 Durable State Surfaces**：FailureEvent 持久化到 F008 durable_record，作为归因输入的状态快照。
- **F007/F008 VISION.md / ROADMAP.md**：vision_gap 判定从这两个文档派生。
- **Forgekin CapabilityProfile**：taste_gap 判定与品味画像对比。
- **DI 容器**：`attribution_classifier` 通过 `inject("attribution_classifier")` 获取。

### 4.2 下游影响如何被调用

- **F021 副作用 WAL**：`ENVIRONMENT_DRIFT` 归因触发 F021 WAL 回放（订阅 `fix.target.f021_wal`）。
- **F022 Tier 1-4 恢复**：`EXECUTION_GAP` 归因触发 F022 Tier 2 重放（订阅 `fix.target.f022_tier`）。
- **F024 强 workflow**：`HARNESS_MISMATCH` 归因触发 F024 强 workflow 回滚（订阅 `fix.target.f024_workflow`）。
- **F012 退役**：`VISION_GAP` 归因（含 superseded_by）触发 F012 退役（订阅 `fix.target.f012_sunset`）。
- **F040 控制面**：所有归因结果与修复派发记录写入 F040 Eval Hub（订阅 `eval.attribution.classified` 事件）。
- **Forgekin.learn()**：归因结果作为 Forgekin 学习输入，更新品味画像。
- **EAC v1 七契约**：本设计是 EAC v1 七契约中的"归因契约"物理承载。

### 4.3 集成测试点

| 测试点 ID | 测试场景 | 验证点 | 责任方 |
|----------|---------|--------|--------|
| IT-D020-001 | 决策树固定顺序遍历 | 7 步顺序与 AttributionType.ordered() 一致 | 测试员灵智体（蜜獾·平头哥） |
| IT-D020-002 | 主归因置信度阈值 | 主归因 confidence >= 0.7 | 测试员灵智体 |
| IT-D020-003 | 主归因置信度不足降级 | 主归因 confidence < 0.7 时降级为次归因 + HUMAN_REVIEW | 测试员灵智体 |
| IT-D020-004 | 次归因数量上限 | 次归因数量 <= max_secondary_attributions（默认 3） | 测试员灵智体 |
| IT-D020-005 | vision_gap 归因 | signal_conflict 涉及 cvo_vision 时归因为 VISION_GAP | 测试员灵智体 |
| IT-D020-006 | translation_drift 归因 | friction_metric 涉及 translation 时归因为 TRANSLATION_DRIFT | 测试员灵智体 |
| IT-D020-007 | harness_mismatch 归因 | failure_summary 包含 harness 时归因为 HARNESS_MISMATCH | 测试员灵智体 |
| IT-D020-008 | tool_gap 归因 | failure_summary 包含 tool 时归因为 TOOL_GAP | 测试员灵智体 |
| IT-D020-009 | execution_gap 归因 | signal_conflict severity=high 时归因为 EXECUTION_GAP | 测试员灵智体 |
| IT-D020-010 | environment_drift 归因 | failure_summary 包含 environment 时归因为 ENVIRONMENT_DRIFT | 测试员灵智体 |
| IT-D020-011 | taste_gap 兜底归因 | 所有 check_* 未命中时兜底为 TASTE_GAP（低置信度） | 测试员灵智体 |
| IT-D020-012 | 修复路由派发 F021 | ENVIRONMENT_DRIFT 触发 F021 WAL 回放事件 | 测试员灵智体 |
| IT-D020-013 | 修复路由派发 F022 | EXECUTION_GAP 触发 F022 Tier 2 重放事件 | 测试员灵智体 |
| IT-D020-014 | 修复路由派发 F024 | HARNESS_MISMATCH 触发 F024 workflow 回滚事件 | 测试员灵智体 |
| IT-D020-015 | 修复派发幂等 | 同一 idempotency_key 重复派发不产生副作用 | 测试员灵智体 |

---

## 5. 详细设计验收

### 5.1 功能验收 AC

- [ ] **AC-D020-001**: 决策树固定顺序遍历通过（IT-D020-001）
- [ ] **AC-D020-002**: 主归因置信度阈值生效（IT-D020-002）
- [ ] **AC-D020-003**: 主归因置信度不足降级生效（IT-D020-003）
- [ ] **AC-D020-004**: 次归因数量上限生效（IT-D020-004）
- [ ] **AC-D020-005**: vision_gap 归因正确（IT-D020-005）
- [ ] **AC-D020-006**: translation_drift 归因正确（IT-D020-006）
- [ ] **AC-D020-007**: harness_mismatch 归因正确（IT-D020-007）
- [ ] **AC-D020-008**: tool_gap 归因正确（IT-D020-008）
- [ ] **AC-D020-009**: execution_gap 归因正确（IT-D020-009）
- [ ] **AC-D020-010**: environment_drift 归因正确（IT-D020-010）

### 5.2 性能验收 AC

- [ ] **AC-D020-011**: 决策树遍历时延 < 50ms
- [ ] **AC-D020-012**: 修复路由时延 < 10ms
- [ ] **AC-D020-013**: 修复派发时延（10 fix）< 50ms
- [ ] **AC-D020-014**: Repository 查询延迟 < 100ms
- [ ] **AC-D020-015**: 归因持久化延迟（10 归因）< 200ms
- [ ] **AC-D020-016**: 主归因准确率 >= 90%
- [ ] **AC-D020-017**: 兜底归因比例 < 10%

### 5.3 安全验收 AC

- [ ] **AC-D020-018**: 决策树顺序固定不可变（Enum.ordered() 强制）
- [ ] **AC-D020-019**: 主归因有且仅有 1 个
- [ ] **AC-D020-020**: 修复派发幂等（idempotency_key 去重）
- [ ] **AC-D020-021**: 归因不可变（Pydantic frozen=True）
- [ ] **AC-D020-022**: Repository 层抽象，不直操作数据库
- [ ] **AC-D020-023**: 置信度阈值从配置加载，禁止硬编码
- [ ] **AC-D020-024**: 修复路由表外置 YAML，禁止硬编码

### 5.4 Eval 验收 AC

- [ ] **AC-D020-025**: 主归因准确率 >= 90%（人工标注对照）
- [ ] **AC-D020-026**: 次归因召回率 >= 70%
- [ ] **AC-D020-027**: 修复派发成功率 100%（EventBus 持久化保证）
- [ ] **AC-D020-028**: 兜底归因（taste_gap fallback）比例 < 10%
- [ ] **AC-D020-029**: 归因搜索索引覆盖 forgekin_id + metric_name + time_window

---

## 6. 引用

- [doc:../spec.md#§3.5]
- [doc:../arch.md#§3.5]
- [doc:../architecture/A020-seven-attribution.md]
- [doc:../features/F007-vision-roadmap.md]
- [doc:../features/F008-durable-state-surfaces.md]
- [doc:../features/F012-sunset.md]
- [doc:../features/F018-eval-contract.md]
- [doc:../features/F019-three-signal-cross.md]
- [doc:../features/F020-seven-attribution.md]
- [doc:../features/F021-side-effect-wal.md]
- [doc:../features/F022-tier-1-4-recovery.md]
- [doc:../features/F024-weak-state-vs-strong-workflow.md]
- [doc:../features/F040-harness-eval-control-plane.md]
- [doc:../decisions/009-eval-self-metabolism.md]
- [doc:../../../hiclaw/rules.md#第十一部分]
- [doc:../../../hiclaw/rules.md#编程红线]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（七类归因模型 + 固定顺序决策树 + 主归因+次归因 + 修复路由派发 + 15 集成测试点 + 4 类 AC） | 开发者灵智体（猎犬·夏洛克） |
