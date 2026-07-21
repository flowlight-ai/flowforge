# D013: Harnessability 评估详细设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 开发者 Forgekin（猎犬·夏洛克）
> **对应 spec.md**: [doc:../spec.md#§3.3]
> **对应 arch.md**: [doc:../arch.md#§3.3]
> **对应 design.md**: [doc:../design.md#§3.3]
> **对应 Feature**: [doc:../features/F013-harnessability.md]
> **对应 Architecture**: [doc:../architecture/A013-harnessability.md]
> **依赖 ADR**: [doc:../decisions/007-harness-engineering.md]

---

## 1. 详细设计上下文

### 1.1 设计问题

A013 架构层定义了"六维评分 + 加权平均 + 四档接入策略 + 低维标记个体补偿 + RA-023 低保真矩阵"骨架，本详细设计需要回答下列"如何落地"问题：

1. **D-Q1**：六维评分（stable_api / event_callback / persistent_state / verifiable_output / idempotent_rollback / clear_permission）如何在 Pydantic 模型层强制 0.0-1.0 范围 + 类型为 `dict[HarnessabilityDimension, float]`？
2. **D-Q2**：`HarnessabilityAssessor.assess` 如何对接入目标系统进行六维打分（每维度独立），并把权重外置到 YAML 配置？
3. **D-Q3**：`overall = 加权平均` 如何在 Pydantic model_validator 层校验与配置 weight 一致？
4. **D-Q4**：`HarnessDecisionGate.decide` 如何按四档阈值（full >= 0.8 / partial 0.5-0.8 / human_in_loop 0.3-0.5 / skip < 0.3）判定 recommendation，并禁第五档？
5. **D-Q5**：低于 `dimension_threshold`（默认 0.6）的维度如何记入 `low_dimensions`，触发个体补偿治理规则？
6. **D-Q6**：`LowFiMatrix.classify_rule` 如何对治理规则分类（个体补偿 vs 跨 agent 资产），保证低 Harnessability 系统规则不强制注入所有Forgekin？
7. **D-Q7**：评分结果如何持久化到 D008 thread_trace + 写入 D040 控制面供 sunset review 参考？

### 1.2 设计约束

| 编号 | 约束 | 来源 |
|------|------|------|
| C1 | `flowforge/core/harness/harnessability.py` 不可 import forgemind 或 *Forge 模块 | 单向依赖 |
| C2 | HarnessabilityAssessor / HarnessDecisionGate / LowFiMatrix 通过 `@inject` 注入 | DI 容器 |
| C3 | HarnessabilityScore 通过 Repository 持久化到 D008 Durable Surface（无 `cursor.execute`） | Repository 层 |
| C4 | dimensions / overall_thresholds / dimension_threshold 配置外置到 `flowforge/config/harness.yaml` | 配置驱动 |
| C5 | 六维评分每维度 0.0-1.0，overall = 加权平均 | A013 决策 1+2 |
| C6 | 低维标记（低于 dimension_threshold 默认 0.6）记入 low_dimensions | A013 决策 4 |
| C7 | 接入策略四档（full_harness / partial_harness / human_in_loop / skip），禁第五档 | A013 决策 3 |
| C8 | 低 Harnessability 系统治理规则标记"个体补偿"，不强制注入所有Forgekin | A013 决策 4 + RA-023 |
| C9 | 评分结果写入 D040 控制面供 sunset review | A013 决策 5 |
| C10 | HarnessabilityScore 持久化到 D008 thread_trace surface | A013 不变量 |
| C11 | 评分维度仅六维，不可扩展（避免评分膨胀） | A013 不变量 |
| C12 | dimension_threshold 默认 0.6，可配置但不可低于 0.5 | A013 不变量 |
| C14 | 觉醒阶标注：E1-E3 进化阶接入低 Harnessability 系统需 human_in_loop 强制；E4-E6 觉醒阶接入需 MindCouncil 评估 | naming-contract.md §4 |
| C15 | 跨模块联动：D001 CapabilityProfile.harness_fit_score / D010 Governance Boundary / D025 跨 provider 宿主抽象 / D029 物理 AI 传感器 / D032 三方 Agent 能力画像 / D040 控制面 | A013 跨模块影响 |

### 1.3 设计影响

| 编号 | 影响对象 | 影响描述 |
|------|---------|---------|
| I1 | D001 CapabilityProfile | harness_fit_score 评估输入（低 harnessability 系统拉低 profile） |
| I2 | D002 TeamAct Loop | 低 harnessability 系统接入需 human_in_loop 约束 ACTION 步 |
| I3 | D008 Durable State Surfaces | HarnessabilityScore 持久化到 thread_trace surface（权威等级 1） |
| I4 | D010 Governance Boundary | 低 Harnessability 系统治理规则标记"个体补偿"（DecayTag.BUILT_TO_DELETE） |
| I5 | D025 跨 provider 宿主抽象 | 提供"是否值得抽象"判据（overall < 0.5 不抽象） |
| I6 | D029 物理 AI 传感器接入 | 判别传感器可 harness 程度（低分传感器需适配层） |
| I7 | D032 三方 Agent 能力画像 | 补充适配度维度（harnessability_score 字段） |
| I8 | D040 Harness Eval 控制面 | 评分结果写入供 sunset review（识别"哪块机制正在折旧"） |
| I9 | RA-023 低保真矩阵 | 个体补偿 vs 跨 agent 资产判别依据（LowFiMatrix.classify_rule） |

---

## 2. 详细设计

### 2.1 类图

```
┌─────────────────────────────────────────────────────────────────────┐
│               flowforge/core/harness/harnessability.py              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ <<enumeration>> HarnessabilityDimension                      │   │
│  +--------------------------------------------------------------+   │
│  │ STABLE_API          (稳定 API, 权重 0.2)                     │   │
│  │ EVENT_CALLBACK      (事件流回调, 权重 0.15)                  │   │
│  │ PERSISTENT_STATE    (持久状态, 权重 0.2)                     │   │
│  │ VERIFIABLE_OUTPUT   (可验证输出, 权重 0.2)                   │   │
│  │ IDEMPOTENT_ROLLBACK (幂等可回滚, 权重 0.15)                  │   │
│  │ CLEAR_PERMISSION    (权限边界清楚, 权重 0.1)                 │   │
│  +--------------------------------------------------------------+   │
│  │ +default_weight -> float                                     │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ <<enumeration>> HarnessRecommendation                       │   │
│  +--------------------------------------------------------------+   │
│  │ FULL_HARNESS     (overall >= 0.8, 完整接入)                  │   │
│  │ PARTIAL_HARNESS  (0.5 <= overall < 0.8, 部分接入+适配层)     │   │
│  │ HUMAN_IN_LOOP    (0.3 <= overall < 0.5, 人机协同)            │   │
│  │ SKIP             (overall < 0.3, 不接入)                     │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ <<enumeration>> RuleFiType (RA-023)                          │   │
│  +--------------------------------------------------------------+   │
│  │ INDIVIDUAL_COMPENSATION  (个体补偿, Build to Delete)         │   │
│  │ CROSS_AGENT_ASSET        (跨 agent 资产, Built to Persist)   │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ <<Pydantic>> HarnessabilityScore                             │   │
│  +--------------------------------------------------------------+   │
│  │ target_system: str                                           │   │
│  │ scores: dict[HarnessabilityDimension, float]  (0.0-1.0)      │   │
│  │ overall: float  (加权平均, 0.0-1.0)                          │   │
│  │ low_dimensions: list[HarnessabilityDimension]                │   │
│  │ recommendation: HarnessRecommendation                        │   │
│  │ assessed_at: datetime                                        │   │
│  │ schema_version: str = "v1"                                   │   │
│  │ wal_lsn: int = 0                                             │   │
│  └──────────────────────────────────────────────────────────────┘   │
│  │ +field_validator: scores_must_be_in_range                    │   │
│  │ +field_validator: overall_must_be_in_range                   │   │
│  │ +model_validator: scores_must_cover_all_six_dimensions       │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────────────────────────┐  ┌────────────────────────────┐  │
│  │ <<ABC>> HarnessabilityAssessor│  │ <<ABC>> HarnessDecisionGate│  │
│  +------------------------------+  +----------------------------+  │
│  │ +assess(target_system)       │  │ +decide(score)             │  │
│  │   -> HarnessabilityScore     │  │   -> HarnessRecommendation │  │
│  │ +list_assessed -> list[Sco │  │ +require_human_in_loop(sco)│  │
│  │ +get_score(target) -> Score  │  │   -> bool                  │  │
│  └──────────────────────────────┘  └────────────────────────────┘  │
│             △                                  △                    │
│             │ implements                       │ implements         │
│             ▼                                  ▼                    │
│  ┌──────────────────────────────┐  ┌────────────────────────────┐  │
│  │ DefaultHarnessabilityAssessor│  │ DefaultHarnessDecisionGate │  │
│  +------------------------------+  +----------------------------+  │
│  │ -_dimension_probes: dict     │  │ -_thresholds: dict         │  │
│  │ -_weights: dict              │  │   {full,partial,human,skip}│  │
│  │ -_dimension_threshold: float │  │ -_dimension_threshold      │  │
│  │ -_store: HarnessabilityStore │  └────────────────────────────┘  │
│  │ -_event_bus                  │                                  │
│  └──────────────────────────────┘                                  │
│                                                                     │
│  ┌──────────────────────────────┐  ┌────────────────────────────┐  │
│  │ <<ABC>> LowFiMatrix          │  │ <<ABC>> HarnessabilityStore│  │
│  +------------------------------+  +----------------------------+  │
│  │ +classify_rule(rule_id,      │  │ +save_score(score)         │  │
│  │   target_score) -> RuleFiType│  │ +load_score(target)        │  │
│  │ +list_individual_compensations│  │ +list_all                │  │
│  │   -> list[str]               │  │ +checkpoint              │  │
│  └──────────────────────────────┘  └────────────────────────────┘  │
│             △                                  △                    │
│             │ implements                       │ implements         │
│             ▼                                  ▼                    │
│  ┌──────────────────────────────┐  ┌────────────────────────────┐  │
│  │ DefaultLowFiMatrix           │  │ SqliteHarnessabilityStore  │  │
│  +------------------------------+  │ (WAL, D008 thread_trace)    │  │
│  │ -_cross_agent_rules: set     │  └────────────────────────────┘  │
│  │ -_governance_store           │                                  │
│  └──────────────────────────────┘                                  │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 接口契约

```python
# flowforge/core/harness/harnessability.py
from __future__ import annotations
from abc import ABC, abstractmethod
from datetime import datetime
from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


class HarnessabilityDimension(str, Enum):
    """六维评分维度 (不可扩展第七维, 避免评分膨胀)"""

    STABLE_API = "stable_api"                  # 稳定 API
    EVENT_CALLBACK = "event_callback"          # 事件流回调
    PERSISTENT_STATE = "persistent_state"      # 持久状态
    VERIFIABLE_OUTPUT = "verifiable_output"    # 可验证输出
    IDEMPOTENT_ROLLBACK = "idempotent_rollback"  # 幂等可回滚
    CLEAR_PERMISSION = "clear_permission"      # 权限边界清楚

    @property
    def default_weight(self) -> float:
        return {
            HarnessabilityDimension.STABLE_API: 0.2,
            HarnessabilityDimension.EVENT_CALLBACK: 0.15,
            HarnessabilityDimension.PERSISTENT_STATE: 0.2,
            HarnessabilityDimension.VERIFIABLE_OUTPUT: 0.2,
            HarnessabilityDimension.IDEMPOTENT_ROLLBACK: 0.15,
            HarnessabilityDimension.CLEAR_PERMISSION: 0.1,
        }[self]


class HarnessRecommendation(str, Enum):
    """四档接入策略 (禁第五档)"""
    FULL_HARNESS = "full_harness"          # overall >= 0.8, 完整接入
    PARTIAL_HARNESS = "partial_harness"    # 0.5 <= overall < 0.8, 部分接入+适配层
    HUMAN_IN_LOOP = "human_in_loop"        # 0.3 <= overall < 0.5, 人机协同
    SKIP = "skip"                          # overall < 0.3, 不接入


class RuleFiType(str, Enum):
    """RA-023 低保真矩阵规则分类"""
    INDIVIDUAL_COMPENSATION = "individual_compensation"  # 个体补偿 (Build to Delete)
    CROSS_AGENT_ASSET = "cross_agent_asset"              # 跨 agent 资产 (Built to Persist)


class HarnessabilityScore(BaseModel):
    """Harnessability 评分

    不变量:
        - scores 必须覆盖六维 (不可缺维)
        - 每维度 0.0-1.0
        - overall = 加权平均 (0.0-1.0)
        - low_dimensions = scores 中 < dimension_threshold 的维度集合
        - recommendation 仅四档 (无第五档)
    """
    target_system: str = Field(..., min_length=1)
    scores: dict[HarnessabilityDimension, float]
    overall: float = Field(..., ge=0.0, le=1.0)
    low_dimensions: list[HarnessabilityDimension] = Field(default_factory=list)
    recommendation: HarnessRecommendation
    assessed_at: datetime = Field(default_factory=datetime.utcnow)
    schema_version: str = Field(default="v1")
    wal_lsn: int = Field(default=0, ge=0)

    model_config = {"extra": "forbid"}

    @field_validator("scores")
    @classmethod
    def _scores_must_be_in_range(
        cls, v: dict[HarnessabilityDimension, float]
    ) -> dict[HarnessabilityDimension, float]:
        if len(v) != len(HarnessabilityDimension):
            raise ValueError(
                f"scores 必须覆盖全部六维, 实际 {len(v)} 维 "
                f"(禁缺维, 禁扩展第七维)"
            )
        for dim, score in v.items:
            if not 0.0 <= score <= 1.0:
                raise ValueError(
                    f"Dimension {dim.value} score={score} 必须在 0.0-1.0 之间"
                )
        return v

    @field_validator("overall")
    @classmethod
    def _overall_must_be_in_range(cls, v: float) -> float:
        if not 0.0 <= v <= 1.0:
            raise ValueError(f"overall={v} 必须在 0.0-1.0 之间")
        return v


class HarnessabilityAssessor(ABC):
    """Harnessability 评估器"""

    @abstractmethod
    async def assess(self, target_system: str) -> HarnessabilityScore:
        """评估目标系统的 Harnessability

        架构契约:
            - 六维评分 0.0-1.0
            - overall = 加权平均 (权重配置外置)
            - 低维 (低于 dimension_threshold) 记入 low_dimensions
            - 接入策略四档判定 (无第五档)
            - 持久化到 D008 Durable Surface (thread_trace)
            - 评分结果写入 D040 控制面
        """

    @abstractmethod
    async def list_assessed(self) -> list[HarnessabilityScore]:
        """列出所有已评估的系统"""

    @abstractmethod
    async def get_score(self, target_system: str) -> Optional[HarnessabilityScore]:
        """获取指定系统的评分"""


class HarnessDecisionGate(ABC):
    """接入策略决策门"""

    @abstractmethod
    def decide(self, score: HarnessabilityScore) -> HarnessRecommendation:
        """根据评分决定接入策略

        架构契约:
            - overall >= 0.8 → FULL_HARNESS
            - 0.5 <= overall < 0.8 → PARTIAL_HARNESS
            - 0.3 <= overall < 0.5 → HUMAN_IN_LOOP
            - overall < 0.3 → SKIP
            - 无第五档
        """

    @abstractmethod
    def require_human_in_loop(self, score: HarnessabilityScore) -> bool:
        """是否需要人机协同 (overall < 0.5)"""


class LowFiMatrix(ABC):
    """低保真矩阵 (RA-023)

    维护"治理规则 × Forgekin类型"低保真矩阵,
    识别"某规则只是补偿某模型坏习惯" (→ Build to Delete)
    vs "跨Forgekin资产" (→ Built to Persist)
    """

    @abstractmethod
    def classify_rule(
        self,
        rule_id: str,
        target_system_score: HarnessabilityScore,
    ) -> RuleFiType:
        """分类治理规则

        架构契约:
            - 低 Harnessability 系统的规则 → INDIVIDUAL_COMPENSATION
              (仅注入实际接入的Forgekin, 标 Build to Delete)
            - 跨系统通用规则 → CROSS_AGENT_ASSET
              (强制注入所有Forgekin, 标 Built to Persist)
        """

    @abstractmethod
    def list_individual_compensations(self) -> list[str]:
        """列出所有标记为 individual_compensation 的规则 ID"""


class HarnessabilityStore(ABC):
    """Harnessability 持久化仓储 (Repository 层)"""

    @abstractmethod
    async def save_score(self, score: HarnessabilityScore) -> None:
        """保存评分 (含 WAL LSN)"""

    @abstractmethod
    async def load_score(self, target_system: str) -> Optional[HarnessabilityScore]:
        """加载评分"""

    @abstractmethod
    async def list_all(self) -> list[HarnessabilityScore]:
        """列出所有评分记录"""

    @abstractmethod
    async def checkpoint(self) -> None:
        """WAL checkpoint (PRAGMA wal_checkpoint(FULL))"""
```

### 2.3 Pydantic 异常类

```python
# flowforge/core/harness/harnessability_errors.py
class HarnessabilityError(Exception):
    """Harnessability 评估基础异常"""


class ScoreOutOfRangeError(HarnessabilityError):
    """评分不在 0.0-1.0 之间"""


class MissingDimensionError(HarnessabilityError):
    """scores 未覆盖六维 (缺维)"""


class TooManyDimensionsError(HarnessabilityError):
    """scores 维度超过六维 (评分膨胀)"""


class DimensionThresholdTooLowError(HarnessabilityError):
    """dimension_threshold 配置低于 0.5 硬下限"""


class InvalidRecommendationError(HarnessabilityError):
    """recommendation 非四档之一 (第五档)"""


class DuplicateAssessmentError(HarnessabilityError):
    """target_system 已存在评分 (需走 sunset review 流程覆盖)"""


class HarnessabilityStoreUnavailableError(HarnessabilityError):
    """HarnessabilityStore DB 不可用"""


class LowFiClassificationError(HarnessabilityError):
    """低保真矩阵分类失败 (rule_id 不存在或 score 缺失)"""
```

### 2.4 默认实现

```python
# flowforge/core/harness/harnessability_impl.py
from __future__ import annotations
from datetime import datetime
from typing import Optional

from ..plugin.di_container import inject
from ..tracing import get_logger
from .harnessability import (
    HarnessabilityAssessor, HarnessabilityScore, HarnessabilityStore,
    HarnessDecisionGate, HarnessRecommendation, HarnessabilityDimension,
    LowFiMatrix, RuleFiType,
)
from .harnessability_errors import (
    DimensionThresholdTooLowError, HarnessabilityStoreUnavailableError,
    InvalidRecommendationError, LowFiClassificationError, MissingDimensionError,
    ScoreOutOfRangeError, TooManyDimensionsError,
)

_logger = get_logger(__name__)


class DefaultHarnessabilityAssessor(HarnessabilityAssessor):
    """默认 Harnessability 评估器"""

    @inject
    def __init__(
        self,
        store: HarnessabilityStore,
        weights: Optional[dict[HarnessabilityDimension, float]] = None,
        dimension_threshold: float = 0.6,
        dimension_probes: Optional[dict[HarnessabilityDimension, callable]] = None,
        decision_gate: Optional[HarnessDecisionGate] = None,
        event_bus=None,
        eval_signal_writer=None,
    ) -> None:
        if dimension_threshold < 0.5:
            raise DimensionThresholdTooLowError(
                f"dimension_threshold={dimension_threshold} 不可低于 0.5"
            )
        self._store = store
        self._weights = weights or {d: d.default_weight for d in HarnessabilityDimension}
        # 权重归一化校验
        total_weight = sum(self._weights.values)
        if abs(total_weight - 1.0) > 0.001:
            # 自动归一化
            self._weights = {d: w / total_weight for d, w in self._weights.items}
        self._dimension_threshold = dimension_threshold
        self._dimension_probes = dimension_probes or {}
        self._decision_gate = decision_gate or DefaultHarnessDecisionGate
        self._event_bus = event_bus
        self._eval_signal_writer = eval_signal_writer

    async def assess(self, target_system: str) -> HarnessabilityScore:
        # 1. 六维独立打分 (每维度调用 probe)
        scores: dict[HarnessabilityDimension, float] = {}
        for dim in HarnessabilityDimension:
            probe = self._dimension_probes.get(dim)
            if probe is None:
                # 默认 probe: 中性 0.5 (避免阻塞接入流程)
                _logger.warning(
                    "dimension_probe 未注入 dim=%s, 使用默认 0.5",
                    dim.value,
                )
                scores[dim] = 0.5
            else:
                score = await probe(target_system) if _is_async(probe) else probe(target_system)
                if not 0.0 <= score <= 1.0:
                    raise ScoreOutOfRangeError(
                        f"dim={dim.value} score={score} 不在 0.0-1.0"
                    )
                scores[dim] = score

        # 2. overall = 加权平均
        overall = sum(scores[dim] * self._weights[dim] for dim in HarnessabilityDimension)
        overall = round(overall, 4)

        # 3. 低维标记
        low_dimensions = [
            dim for dim, score in scores.items
            if score < self._dimension_threshold
        ]

        # 4. 四档接入策略
        recommendation = self._decision_gate.decide(
            HarnessabilityScore(
                target_system=target_system,
                scores=scores,
                overall=overall,
                low_dimensions=low_dimensions,
                recommendation=HarnessRecommendation.FULL_HARNESS,  # 占位, decide 重写
            )
        )

        score_obj = HarnessabilityScore(
            target_system=target_system,
            scores=scores,
            overall=overall,
            low_dimensions=low_dimensions,
            recommendation=recommendation,
        )

        # 5. 持久化到 D008 Durable Surface
        await self._store.save_score(score_obj)

        # 6. 写入 D040 控制面 (异步)
        if self._eval_signal_writer is not None:
            await self._eval_signal_writer.write_harnessability_signal({
                "target_system": target_system,
                "overall": overall,
                "recommendation": recommendation.value,
                "low_dimensions": [d.value for d in low_dimensions],
                "assessed_at": score_obj.assessed_at.isoformat,
            })

        if self._event_bus is not None:
            await self._event_bus.publish_async(
                "harnessability.assessed",
                {
                    "target_system": target_system,
                    "overall": overall,
                    "recommendation": recommendation.value,
                },
            )

        _logger.info(
            "harnessability_assessed target=%s overall=%.4f recommendation=%s low_dims=%d",
            target_system, overall, recommendation.value, len(low_dimensions),
        )
        return score_obj

    async def list_assessed(self) -> list[HarnessabilityScore]:
        return await self._store.list_all

    async def get_score(self, target_system: str) -> Optional[HarnessabilityScore]:
        return await self._store.load_score(target_system)


class DefaultHarnessDecisionGate(HarnessDecisionGate):
    """默认接入策略决策门 (四档, 禁第五档)"""

    DEFAULT_THRESHOLDS = {
        "full": 0.8,
        "partial": 0.5,
        "human_in_loop": 0.3,
    }

    @inject
    def __init__(
        self,
        thresholds: Optional[dict[str, float]] = None,
        dimension_threshold: float = 0.6,
    ) -> None:
        if dimension_threshold < 0.5:
            raise DimensionThresholdTooLowError(
                f"dimension_threshold={dimension_threshold} 不可低于 0.5"
            )
        self._thresholds = thresholds or self.DEFAULT_THRESHOLDS
        self._dimension_threshold = dimension_threshold

    def decide(self, score: HarnessabilityScore) -> HarnessRecommendation:
        overall = score.overall
        if overall >= self._thresholds["full"]:
            return HarnessRecommendation.FULL_HARNESS
        elif overall >= self._thresholds["partial"]:
            return HarnessRecommendation.PARTIAL_HARNESS
        elif overall >= self._thresholds["human_in_loop"]:
            return HarnessRecommendation.HUMAN_IN_LOOP
        else:
            return HarnessRecommendation.SKIP

    def require_human_in_loop(self, score: HarnessabilityScore) -> bool:
        return score.overall < self._thresholds["partial"]


class DefaultLowFiMatrix(LowFiMatrix):
    """默认低保真矩阵 (RA-023)"""

    # 跨 agent 资产规则白名单 (强制注入所有Forgekin)
    DEFAULT_CROSS_AGENT_RULES = frozenset({
        "rule.no_force_push_to_main",
        "rule.no_delete_main_branch",
        "rule.require_test_red_green",
        "rule.reviewer_must_not_be_author",
        "rule.evidence_required_for_verdict",
        "rule.magic_words_operator_only",
        "rule.three_choice_entropy_review",
    })

    @inject
    def __init__(
        self,
        cross_agent_rules: Optional[set[str]] = None,
        governance_store=None,
    ) -> None:
        self._cross_agent_rules = cross_agent_rules or set(self.DEFAULT_CROSS_AGENT_RULES)
        self._governance_store = governance_store

    def classify_rule(
        self,
        rule_id: str,
        target_system_score: HarnessabilityScore,
    ) -> RuleFiType:
        if not rule_id or not rule_id.strip:
            raise LowFiClassificationError("rule_id 不可为空")

        # 1. 白名单规则 → 跨 agent 资产
        if rule_id in self._cross_agent_rules:
            return RuleFiType.CROSS_AGENT_ASSET

        # 2. 低 Harnessability 系统 (overall < 0.8) 的规则 → 个体补偿
        if target_system_score.overall < 0.8:
            _logger.info(
                "rule_classified rule_id=%s target=%s overall=%.4f → individual_compensation",
                rule_id, target_system_score.target_system,
                target_system_score.overall,
            )
            return RuleFiType.INDIVIDUAL_COMPENSATION

        # 3. 高 Harnessability 系统 (overall >= 0.8) 的规则默认为跨 agent 资产
        return RuleFiType.CROSS_AGENT_ASSET

    def list_individual_compensations(self) -> list[str]:
        """从治理存储列出所有标记 individual_compensation 的规则"""
        if self._governance_store is None:
            return []
        return self._governance_store.list_rules_by_fi_type(
            RuleFiType.INDIVIDUAL_COMPENSATION
        )


def _is_async(func) -> bool:
    import inspect
    return inspect.iscoroutinefunction(func)
```

### 2.5 关键算法伪代码

**算法 1：DefaultHarnessabilityAssessor.assess 六维评分**

```
INPUT: target_system
OUTPUT: HarnessabilityScore

1. scores = {}  # dict[HarnessabilityDimension, float]
2. FOR dim IN HarnessabilityDimension (六维):
2.1    probe = dimension_probes.get(dim)
2.2    IF probe IS None:
2.2.1      score = 0.5  # 默认中性, WARNING
2.3    ELSE:
2.3.1      score = await probe(target_system) IF is_async(probe) ELSE probe(target_system)
2.3.2      IF NOT 0.0 <= score <= 1.0: RAISE ScoreOutOfRangeError
2.4    scores[dim] = score

3. overall = SUM(scores[dim] * weights[dim] FOR dim IN dimensions)
4. overall = round(overall, 4)

5. low_dimensions = [dim FOR dim, score IN scores IF score < dimension_threshold]

6. recommendation = decision_gate.decide(临时 Score(overall))
   - overall >= 0.8 → FULL_HARNESS
   - 0.5 <= overall < 0.8 → PARTIAL_HARNESS
   - 0.3 <= overall < 0.5 → HUMAN_IN_LOOP
   - overall < 0.3 → SKIP

7. score_obj = HarnessabilityScore(target_system, scores, overall,
                                    low_dimensions, recommendation)
8. store.save_score(score_obj)  # 持久化到 D008
9. eval_signal_writer.write_harnessability_signal({...})  # D040 控制面
10. event_bus.publish_async("harnessability.assessed", {...})
11. RETURN score_obj
```

**算法 2：DefaultHarnessDecisionGate.decide 四档判定**

```
INPUT: score (HarnessabilityScore)
OUTPUT: HarnessRecommendation

1. overall = score.overall
2. IF overall >= thresholds["full"] (0.8): RETURN FULL_HARNESS
3. ELIF overall >= thresholds["partial"] (0.5): RETURN PARTIAL_HARNESS
4. ELIF overall >= thresholds["human_in_loop"] (0.3): RETURN HUMAN_IN_LOOP
5. ELSE: RETURN SKIP
6. # 禁第五档 (Pydantic enum 已硬约束)
```

**算法 3：DefaultLowFiMatrix.classify_rule RA-023 分类**

```
INPUT: rule_id, target_system_score
OUTPUT: RuleFiType

1. IF NOT rule_id.strip: RAISE LowFiClassificationError
2. IF rule_id IN cross_agent_rules 白名单: RETURN CROSS_AGENT_ASSET
3. IF target_system_score.overall < 0.8: RETURN INDIVIDUAL_COMPENSATION
4. RETURN CROSS_AGENT_ASSET  # 默认高 Harnessability 系统的规则为跨 agent 资产
```

**算法 4：六维评分校验（Pydantic model_validator）**

```
INPUT: scores (dict[HarnessabilityDimension, float])
OUTPUT: scores (校验通过)

1. IF len(scores) != 6:  # 六维
1.1    IF len(scores) < 6: RAISE MissingDimensionError
1.2    ELSE: RAISE TooManyDimensionsError
2. FOR dim, score IN scores:
2.1    IF NOT 0.0 <= score <= 1.0: RAISE ScoreOutOfRangeError
3. RETURN scores
```

---

## 3. 模块实现

### 3.1 SQLite WAL 仓储实现

```python
# flowforge/infra/repo/sqlite_harnessability_store.py
from __future__ import annotations
import json
import aiosqlite
from datetime import datetime
from typing import Optional

from flowforge.core.harness.harnessability import (
    HarnessabilityDimension, HarnessabilityScore, HarnessabilityStore,
    HarnessRecommendation,
)
from flowforge.core.harness.harnessability_errors import (
    HarnessabilityStoreUnavailableError,
)


class SqliteHarnessabilityStore(HarnessabilityStore):
    """SQLite WAL 实现 (D008 thread_trace surface + D021 Side Effect WAL 联动)

    表结构:
        - harnessability_scores: 评分主表 (含 wal_lsn)
        - harnessability_events: 事件流 (assess / sunset_review)
    """

    SCHEMA_SQL = """
    CREATE TABLE IF NOT EXISTS harnessability_scores (
        target_system    TEXT PRIMARY KEY,
        scores           TEXT NOT NULL,
        overall          REAL NOT NULL,
        low_dimensions   TEXT NOT NULL DEFAULT '[]',
        recommendation   TEXT NOT NULL,
        assessed_at      TEXT NOT NULL,
        schema_version   TEXT NOT NULL DEFAULT 'v1',
        wal_lsn          INTEGER NOT NULL DEFAULT 0,
        created_at       TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS harnessability_events (
        event_id    INTEGER PRIMARY KEY AUTOINCREMENT,
        target_system TEXT,
        event_type  TEXT NOT NULL,
        payload     TEXT NOT NULL,
        occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_scores_overall ON harnessability_scores(overall);
    CREATE INDEX IF NOT EXISTS idx_scores_recommendation ON harnessability_scores(recommendation);
    CREATE INDEX IF NOT EXISTS idx_events_target ON harnessability_events(target_system);
    """

    def __init__(self, db_path: str) -> None:
        self._db_path = db_path
        self._wal_lsn_counter = 0

    async def _connect(self) -> aiosqlite.Connection:
        conn = await aiosqlite.connect(self._db_path)
        await conn.execute("PRAGMA journal_mode=WAL")
        await conn.execute("PRAGMA synchronous=NORMAL")
        await conn.execute("PRAGMA foreign_keys=ON")
        await conn.executescript(self.SCHEMA_SQL)
        await conn.commit
        return conn

    async def save_score(self, score: HarnessabilityScore) -> None:
        self._wal_lsn_counter += 1
        wal_lsn = self._wal_lsn_counter
        try:
            async with await self._connect as conn:
                await conn.execute(
                    """
                    INSERT OR REPLACE INTO harnessability_scores
                        (target_system, scores, overall, low_dimensions,
                         recommendation, assessed_at, schema_version, wal_lsn)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        score.target_system,
                        json.dumps({d.value: s for d, s in score.scores.items}),
                        score.overall,
                        json.dumps([d.value for d in score.low_dimensions]),
                        score.recommendation.value,
                        score.assessed_at.isoformat,
                        score.schema_version,
                        wal_lsn,
                    ),
                )
                await conn.execute(
                    """
                    INSERT INTO harnessability_events (target_system, event_type, payload)
                    VALUES (?, 'score_saved', ?)
                    """,
                    (score.target_system, json.dumps({"wal_lsn": wal_lsn, "overall": score.overall})),
                )
                await conn.commit
            score.wal_lsn = wal_lsn
        except Exception as e:
            raise HarnessabilityStoreUnavailableError(f"save_score 失败: {e}") from e

    async def load_score(self, target_system: str) -> Optional[HarnessabilityScore]:
        try:
            async with await self._connect as conn:
                async with conn.execute(
                    "SELECT * FROM harnessability_scores WHERE target_system = ?",
                    (target_system,),
                ) as cur:
                    row = await cur.fetchone
                    if row is None:
                        return None
                    return self._row_to_score(row)
        except Exception as e:
            raise HarnessabilityStoreUnavailableError(f"load_score 失败: {e}") from e

    async def list_all(self) -> list[HarnessabilityScore]:
        try:
            async with await self._connect as conn:
                async with conn.execute(
                    "SELECT * FROM harnessability_scores ORDER BY assessed_at DESC"
                ) as cur:
                    rows = await cur.fetchall
                    return [self._row_to_score(r) for r in rows]
        except Exception as e:
            raise HarnessabilityStoreUnavailableError(f"list_all 失败: {e}") from e

    async def checkpoint(self) -> None:
        try:
            async with await self._connect as conn:
                await conn.execute("PRAGMA wal_checkpoint(FULL)")
                await conn.commit
        except Exception as e:
            raise HarnessabilityStoreUnavailableError(f"checkpoint 失败: {e}") from e

    def _row_to_score(self, row) -> HarnessabilityScore:
        scores_dict = json.loads(row[1])
        scores = {HarnessabilityDimension(k): float(v) for k, v in scores_dict.items}
        low_dims = [HarnessabilityDimension(d) for d in json.loads(row[3])]
        return HarnessabilityScore(
            target_system=row[0],
            scores=scores,
            overall=float(row[2]),
            low_dimensions=low_dims,
            recommendation=HarnessRecommendation(row[4]),
            assessed_at=datetime.fromisoformat(row[5]),
            schema_version=row[6],
            wal_lsn=row[7],
        )
```

### 3.2 时序图

**时序图 1：六维评分 + 四档判定 + 持久化**

```
Caller            Assessor          DecisionGate       Store(WAL)       EvalSignalWriter
  │                  │                  │                 │                 │
  │ assess(target)   │                  │                 │                 │
  ├─────────────────>│ FOR dim IN 六维 │                 │                 │
  │                  │   probe(target)  │                 │                 │
  │                  │   scores[dim] = 0.x                │                 │
  │                  │ overall = 加权平均                 │                 │
  │                  │ low_dims = [score < 0.6]           │                 │
  │                  │ decide(score)    │                 │                 │
  │                  ├─────────────────>│ 四档判定         │                 │
  │                  │ <────────────────┤ FULL_HARNESS    │                 │
  │                  │ save_score(score)│                 │                 │
  │                  ├───────────────────────────────────>│ INSERT + WAL LSN│
  │                  │ <──────────────────────────────────┤ wal_lsn         │
  │                  │ write_harnessability_signal(...)   │                 │
  │                  ├──────────────────────────────────────────────────────>│ D040
  │                  │ <────────────────────────────────────────────────────┤ ok
  │ <────────────────┤ HarnessabilityScore                │                 │
  │                  │                  │                 │                 │
  │  → 评分持久化到 D008 thread_trace, 控制面 sunset review 可查询             │
```

**时序图 2：LowFiMatrix RA-023 分类**

```
GovernanceInjector    LowFiMatrix        GovernanceStore
  │                      │                    │
  │ classify_rule(rule_id, target_score)      │
  ├─────────────────────>│                    │
  │                      │ IF rule_id IN cross_agent_rules:
  │                      │   RETURN CROSS_AGENT_ASSET
  │                      │ IF target_score.overall < 0.8:
  │                      │   RETURN INDIVIDUAL_COMPENSATION
  │                      │ RETURN CROSS_AGENT_ASSET
  │ <────────────────────┤ RuleFiType
  │                      │                    │
  │  IF INDIVIDUAL_COMPENSATION:              │
  │    governance_store.mark_individual_compensation(rule_id)
  │ ├─────────────────────────────────────────────────────────>│
  │ <─────────────────────────────────────────────────────────┤ ok
  │                      │                    │
  │  → 仅注入实际接入该系统的Forgekin, 标 Build to Delete                    │
```

### 3.3 错误处理策略

| # | 异常 / 场景 | 处理策略 | 用户可见行为 |
|---|------------|---------|-------------|
| E1 | `ScoreOutOfRangeError` 评分 < 0 或 > 1 | Pydantic validator 拒绝, 抛出 | assessor 调用方收到错误 |
| E2 | `MissingDimensionError` scores 缺维 | Pydantic validator 拒绝, 抛出 | assessor 调用方收到错误 |
| E3 | `TooManyDimensionsError` scores 多于六维 | Pydantic validator 拒绝, 抛出 | assessor 调用方收到错误 |
| E4 | `DimensionThresholdTooShortError` threshold < 0.5 | Tagger 构造函数抛出 | 服务启动失败 |
| E5 | `InvalidRecommendationError` recommendation 非四档 | Pydantic enum 拒绝 | assessor 调用方收到错误 |
| E6 | `DuplicateAssessmentError` target_system 已存在 | 不抛出, INSERT OR REPLACE 覆盖 + 写 audit event | 旧评分被覆盖, 控制面标记"重新评估" |
| E7 | `HarnessabilityStoreUnavailableError` DB 锁/不可用 | 指数退避重试 3 次, 仍失败抛出 | 服务返回 503 |
| E8 | `LowFiClassificationError` rule_id 为空 | classify_rule 抛出 | governance_injector 调用方收到错误 |
| E9 | `dimension_probes` 未注入某维度 | 默认 0.5 中性 + WARNING | 评分偏中性, 监控告警 |
| E10 | `event_bus.publish_async` 失败 | 不阻塞主流程, 仅 WARNING | 用户无感知 |
| E11 | `eval_signal_writer` 失败 | 不阻塞 save_score, 仅 WARNING | D040 控制面信号缺失, 监控告警 |
| E12 | 权重配置不归一化 (sum != 1.0) | 自动归一化 + WARNING | 评分仍正确, 配置告警 |

### 3.4 性能指标与优化

| 指标 | 目标值 | 测量方式 | 优化手段 |
|------|:------:|---------|---------|
| assess 延迟 | < 200ms (P95, 单 probe < 30ms) | 方法级 timing | 六维 probe 并行 `asyncio.gather` |
| decide 延迟 | < 1ms (P95) | 方法级 timing | 纯计算, 无 I/O |
| classify_rule 延迟 | < 2ms (P95) | 方法级 timing | frozenset O(1) 查找 |
| save_score 延迟 | < 50ms (P95) | DB timing | WAL 异步刷盘 |
| load_score 延迟 | < 20ms (P95) | DB timing | PRIMARY KEY 索引 |
| list_all 延迟 | < 50ms (P95, 1000 系统) | DB timing | recommendation 索引 |
| DB 文件大小 | < 5MB / 1000 系统 | 文件系统 | 90 天后归档 + VACUUM |
| WAL checkpoint 频率 | 每 100 次评估一次 | wal_lsn % 100 == 0 | PRAGMA wal_checkpoint(FULL) |

### 3.5 配置外置（YAML 示例）

```yaml
# flowforge/config/harness.yaml
harnessability:
  # 六维权重 (sum 必须 = 1.0, 否则自动归一化)
  dimensions:
    stable_api:
      weight: 0.2
      threshold: 0.6        # 低于此值记入 low_dimensions
    event_callback:
      weight: 0.15
      threshold: 0.6
    persistent_state:
      weight: 0.2
      threshold: 0.6
    verifiable_output:
      weight: 0.2
      threshold: 0.6
    idempotent_rollback:
      weight: 0.15
      threshold: 0.6
    clear_permission:
      weight: 0.1
      threshold: 0.6

  # overall 四档阈值 (硬约束: full > partial > human_in_loop > 0)
  overall_thresholds:
    full: 0.8           # overall >= 0.8 → FULL_HARNESS
    partial: 0.5        # 0.5 <= overall < 0.8 → PARTIAL_HARNESS
    human_in_loop: 0.3  # 0.3 <= overall < 0.5 → HUMAN_IN_LOOP
    # overall < 0.3 → SKIP

  # dimension_threshold 硬下限 0.5 (低于此值抛 DimensionThresholdTooLowError)
  dimension_threshold_min: 0.5

  # 跨 agent 资产规则白名单 (强制注入所有Forgekin, Built to Persist)
  cross_agent_rules:
    - rule.no_force_push_to_main
    - rule.no_delete_main_branch
    - rule.require_test_red_green
    - rule.reviewer_must_not_be_author
    - rule.evidence_required_for_verdict
    - rule.magic_words_operator_only
    - rule.three_choice_entropy_review

  # 觉醒阶接入策略
  awakening_stage_policy:
    E1_E3: allow_with_human_in_loop_if_low  # 进化阶: 低分系统需 human_in_loop
    E4_E6: require_mind_council_review       # 觉醒阶: 接入需 MindCouncil 评估

  # WAL checkpoint 频率 (每 N 次评估一次)
  wal_checkpoint_every_n_assessments: 100

  # DB 路径
  db_path: "data/harnessability.sqlite"

  # 评分归档天数 (90 天后归档)
  archive_after_days: 90
```

---

## 4. 跨模块协作实现

### 4.1 上游依赖调用

**D001 CapabilityProfile（harness_fit_score 输入）**

```python
# flowforge/core/harness/capability_profile_impl.py (节选)
class DefaultCapabilityProfileBuilder:
    @inject
    def __init__(self, harnessability_assessor: HarnessabilityAssessor, ...):
        self._harness_assessor = harnessability_assessor

    async def build_profile(self, forgekin_id: str, target_systems: list[str]) -> CapabilityProfile:
        # 评估每个目标系统的 harnessability
        system_scores = {}
        for target in target_systems:
            score = await self._harness_assessor.assess(target)
            system_scores[target] = score

        # 计算 harness_fit_score (低 harnessability 系统拉低 profile)
        avg_overall = sum(s.overall for s in system_scores.values) / len(system_scores)
        harness_fit_score = round(avg_overall, 4)

        return CapabilityProfile(
            forgekin_id=forgekin_id,
            harness_fit_score=harness_fit_score,
            target_system_scores=system_scores,
        )
```

**D002 TeamAct Loop（低 harnessability 系统接入需 human_in_loop 约束 ACTION 步）**

```python
# flowforge/loop/executor.py (节选)
class LoopExecutor:
    @inject
    def __init__(self, harnessability_assessor: HarnessabilityAssessor, decision_gate: HarnessDecisionGate, ...):
        self._harness_assessor = harnessability_assessor
        self._decision_gate = decision_gate

    async def _execute_action_step(self, state):
        # 接入外部系统前评估 harnessability
        if state.action_target_external:
            score = await self._harness_assessor.assess(state.action_target)
            if self._decision_gate.require_human_in_loop(score):
                # 强制 human_in_loop, ACTION 步等待 operator 确认
                state.require_operator_confirmation = True
                state.harness_recommendation = score.recommendation
        # ... 继续 ACTION 步
```

**D008 Durable State Surfaces（thread_trace 持久化）**

```python
# flowforge/core/harness/durable_state_impl.py (节选)
class DefaultDurableStateRegistry:
    async def write_harnessability_score_surface(self, score: HarnessabilityScore) -> None:
        # thread_trace surface (权威等级 1, 临时上下文)
        await self.write_surface(
            surface_type=StateSurfaceType.THREAD_TRACE,
            key=f"harnessability/{score.target_system}",
            payload=score.model_dump,
            authority_level=1,
            decay_tag=DecayTag.BUILT_TO_PERSIST,  # 评分是 Build to Persist 基础设施
        )
```

### 4.2 下游影响

**D010 Governance Boundary（个体补偿治理规则）**

```python
# flowforge/core/harness/governance_impl.py (节选)
class DefaultGovernanceInjector:
    @inject
    def __init__(self, low_fi_matrix: LowFiMatrix, harnessability_assessor: HarnessabilityAssessor, ...):
        self._low_fi_matrix = low_fi_matrix
        self._harness_assessor = harnessability_assessor

    async def inject_rule_for_target(self, rule: GovernanceRule, target_system: str) -> None:
        score = await self._harness_assessor.get_score(target_system)
        if score is None:
            score = await self._harness_assessor.assess(target_system)

        fi_type = self._low_fi_matrix.classify_rule(rule.rule_id, score)
        if fi_type == RuleFiType.INDIVIDUAL_COMPENSATION:
            # 个体补偿: 仅注入实际接入该系统的Forgekin, 标 Build to Delete
            rule.decay_tag = DecayTag.BUILT_TO_DELETE
            rule.injection_scope = f"target:{target_system}"
        else:
            # 跨 agent 资产: 强制注入所有Forgekin, 标 Built to Persist
            rule.decay_tag = DecayTag.BUILT_TO_PERSIST
            rule.injection_scope = "all"
        await self._store.save_rule(rule)
```

**D025 跨 provider 宿主抽象（是否值得抽象判据）**

```python
# flowforge/core/harness/provider_host_abstraction.py (节选)
class ProviderHostAbstraction:
    @inject
    def __init__(self, harnessability_assessor: HarnessabilityAssessor, ...):
        self._harness_assessor = harnessability_assessor

    async def should_abstract(self, provider: str) -> bool:
        score = await self._harness_assessor.get_score(provider)
        if score is None:
            return False  # 未评估, 默认不抽象
        # overall < 0.5 不抽象 (低 harnessability 系统不值得抽象)
        return score.overall >= 0.5
```

**D029 物理 AI 传感器接入（判别传感器可 harness 程度）**

```python
# flowforge/core/harness/physical_sensor_adapter.py (节选)
class PhysicalSensorAdapter:
    @inject
    def __init__(self, harnessability_assessor: HarnessabilityAssessor, ...):
        self._harness_assessor = harnessability_assessor

    async def integrate_sensor(self, sensor_id: str) -> IntegrationResult:
        score = await self._harness_assessor.assess(sensor_id)
        if score.recommendation == HarnessRecommendation.SKIP:
            return IntegrationResult(success=False, reason="harnessability too low, skip")
        elif score.recommendation == HarnessRecommendation.HUMAN_IN_LOOP:
            return IntegrationResult(success=True, requires_human=True, ...)
        # FULL_HARNESS / PARTIAL_HARNESS 正常接入
        return IntegrationResult(success=True, requires_human=False, ...)
```

**D032 三方 Agent 能力画像（适配度维度）**

```python
# flowforge/core/harness/external_agent_profile.py (节选)
class ExternalAgentProfileBuilder:
    @inject
    def __init__(self, harnessability_assessor: HarnessabilityAssessor, ...):
        self._harness_assessor = harnessability_assessor

    async def build_profile(self, agent_id: str, target_systems: list[str]) -> ExternalAgentProfile:
        # 评估每个目标系统的 harnessability, 补充适配度维度
        scores = {}
        for target in target_systems:
            scores[target] = await self._harness_assessor.assess(target)
        avg_harness = sum(s.overall for s in scores.values) / len(scores) if scores else 0.0
        return ExternalAgentProfile(
            agent_id=agent_id,
            harnessability_score=avg_harness,
            target_system_scores=scores,
        )
```

**D040 Harness Eval 控制面（sunset review 参考）**

```python
# flowforge/core/harness/harness_eval_impl.py (节选)
class HarnessEvalControlPlane:
    async def on_harnessability_assessed(self, event):
        """监听 harnessability.assessed, 更新控制面"""
        target = event["target_system"]
        overall = event["overall"]
        recommendation = event["recommendation"]
        # 更新"系统适配度" 列表, 供 sunset review 参考
        await self._update_system_fitness(target, overall, recommendation)
        # 识别"折旧中"机制 (低分系统对应的治理规则)
        if recommendation in ("human_in_loop", "skip"):
            await self._mark_decaying_mechanism(target)
```

### 4.3 跨模块集成测试点

| # | 测试场景 | 上游/下游 | 验证点 |
|---|---------|----------|--------|
| T1 | D001 CapabilityProfileBuilder → D013 assess → harness_fit_score 计算 | D001→D013 | harness_fit_score = avg(overall) |
| T2 | D002 TeamAct ACTION 步 → D013 assess → 低分系统强制 human_in_loop | D002→D013 | require_operator_confirmation=True |
| T3 | D013 assess → D008 thread_trace 持久化 | D013→D008 | thread_trace authority=1, decay_tag=BUILT_TO_PERSIST |
| T4 | D010 GovernanceInjector → D013 LowFiMatrix.classify_rule | D010↔D013 | 低分系统规则标 INDIVIDUAL_COMPENSATION |
| T5 | D013 INDIVIDUAL_COMPENSATION → D010 仅注入实际接入Forgekin | D013→D010 | injection_scope="target:xxx", decay_tag=BUILT_TO_DELETE |
| T6 | D013 CROSS_AGENT_ASSET → D010 强制注入所有Forgekin | D013→D010 | injection_scope="all", decay_tag=BUILT_TO_PERSIST |
| T7 | D025 ProviderHostAbstraction → D013 assess → overall < 0.5 不抽象 | D025↔D013 | should_abstract=False |
| T8 | D029 PhysicalSensorAdapter → D013 assess → SKIP 不接入 | D029↔D013 | IntegrationResult(success=False) |
| T9 | D032 ExternalAgentProfile → D013 assess → 适配度维度补充 | D032↔D013 | harnessability_score 字段非空 |
| T10 | D013 assess → D040 控制面 sunset review 信号 | D013→D040 | 控制面"系统适配度"列表更新 |
| T11 | D013 六维评分缺维 → MissingDimensionError | D013 内部 | Pydantic validator 拒绝 |
| T12 | D013 维度评分 > 1.0 → ScoreOutOfRangeError | D013 内部 | Pydantic validator 拒绝 |
| T13 | D013 dimension_threshold < 0.5 → DimensionThresholdTooLowError | D013 内部 | 构造函数抛出 |
| T14 | D013 weights sum != 1.0 → 自动归一化 + WARNING | D013 内部 | 评分仍正确 |
| T15 | D013 觉醒阶 E4-E6 接入低分系统 → MindCouncil 二次确认 | D013↔MindCouncil | 二次确认未通过则不接入 |

---

## 5. 详细设计验收

### 5.1 功能验收（Functional AC）

- [ ] AC-F1: `flowforge/core/harness/harnessability.py` 不 import forgemind 或 *Forge 模块（单向依赖）
- [ ] AC-F2: HarnessabilityAssessor / HarnessDecisionGate / LowFiMatrix 通过 `@inject` 注入，无直接实例化
- [ ] AC-F3: HarnessabilityScore 通过 Repository 持久化到 D008 Durable Surface（无 `cursor.execute`）
- [ ] AC-F4: 六维评分每维度独立打分（probe 可独立调用）
- [ ] AC-F5: scores 必须覆盖六维（Pydantic `_scores_must_be_in_range` 校验）
- [ ] AC-F6: 每维度评分 0.0-1.0（Pydantic field_validator 校验）
- [ ] AC-F7: overall = 加权平均（权重配置外置，自动归一化）
- [ ] AC-F8: low_dimensions 记入低于 dimension_threshold 的维度
- [ ] AC-F9: 接入策略四档判定正确（FULL/PARTIAL/HUMAN_IN_LOOP/SKIP）
- [ ] AC-F10: recommendation 仅四档（HarnessRecommendation enum 硬约束，禁第五档）
- [ ] AC-F11: LowFiMatrix.classify_rule 对低分系统规则标 INDIVIDUAL_COMPENSATION
- [ ] AC-F12: LowFiMatrix.classify_rule 对白名单规则标 CROSS_AGENT_ASSET
- [ ] AC-F13: 评分结果写入 D040 控制面（eval_signal_writer 调用）
- [ ] AC-F14: 评分维度仅六维，不可扩展（TooManyDimensionsError）
- [ ] AC-F15: dimension_threshold 默认 0.6，可配置但不可低于 0.5
- [ ] AC-F16: 跨 agent 资产规则强制注入所有Forgekin（标 Built to Persist）
- [ ] AC-F17: 个体补偿规则仅注入实际接入Forgekin（标 Build to Delete）
- [ ] AC-F18: 觉醒阶 E4-E6 接入低分系统需 MindCouncil 二次确认

### 5.2 性能验收（Performance AC）

- [ ] AC-P1: assess P95 延迟 < 200ms（六维 probe 并行）
- [ ] AC-P2: decide P95 延迟 < 1ms
- [ ] AC-P3: classify_rule P95 延迟 < 2ms
- [ ] AC-P4: save_score P95 延迟 < 50ms
- [ ] AC-P5: load_score P95 延迟 < 20ms
- [ ] AC-P6: list_all P95 延迟 < 50ms（1000 系统）
- [ ] AC-P7: 1000 系统 DB 文件 < 5MB

### 5.3 安全验收（Security AC）

- [ ] AC-S1: 评分维度仅六维（防评分膨胀，TooManyDimensionsError）
- [ ] AC-S2: 每维度评分 0.0-1.0 硬约束（ScoreOutOfRangeError）
- [ ] AC-S3: overall 0.0-1.0 硬约束（Pydantic validator）
- [ ] AC-S4: dimension_threshold 硬下限 0.5（防配置绕过）
- [ ] AC-S5: 个体补偿规则不强制注入所有Forgekin（RA-023 不变量）
- [ ] AC-S6: 跨 agent 资产规则白名单不可被低分系统覆盖（白名单优先级最高）
- [ ] AC-S7: 觉醒阶 E4-E6 接入低分系统需 MindCouncil 二次确认（防Forgekin自降级）
- [ ] AC-S8: audit log（harnessability_events 表）禁删除，仅 INSERT + SELECT

### 5.4 Eval 验收（Eval AC）

- [ ] AC-E1: 评分结果 100% 写入 D040 控制面（T10 集成测试）
- [ ] AC-E2: D040 控制面"系统适配度"列表实时反映最新评分
- [ ] AC-E3: 低分系统（overall < 0.5）触发 D040 控制面标记"折旧中"
- [ ] AC-E4: 个体补偿规则随 sunset review 退役（与 D012 EntropyControl 联动）
- [ ] AC-E5: 评分归档 90 天后，D040 控制面可查询历史评分记录

---

## 6. 引用

- [doc:../spec.md#§3.3]（FR-CORE-003，FR-CORE-023 Harnessability）
- [doc:../arch.md#§3.3]（Harness 七层现实表面，L7 Harnessability）
- [doc:../features/F013-harnessability.md]（同号 Feature 级 SRS）
- [doc:../architecture/A013-harnessability.md]（同号 Architecture 架构权威源）
- [doc:../architecture/A001-capability-profile.md]（harness_fit_score 输入）
- [doc:../architecture/A002-teamact-loop.md]（ACTION 步 human_in_loop 约束）
- [doc:../architecture/A008-durable-state-surfaces.md]（HarnessabilityScore 持久化目标）
- [doc:../architecture/A010-governance-boundary.md]（个体补偿治理规则）
- [doc:../features/F025-provider-host-abstraction.md]（是否值得抽象判据）
- [doc:../features/F029-physical-ai-sensors.md]（传感器可 harness 程度判别）
- [doc:../features/F032-external-agent-profile.md]（适配度维度补充）
- [doc:../features/F040-harness-eval-control-plane.md]（控制面 sunset review 参考）
- [doc:review/review.md#RA-022]（Harnessability 评估来源）
- [doc:review/review.md#RA-023]（低保真矩阵：个体补偿 vs 跨 agent 资产）
- [doc:roleagent.md#第3章]（"不是每个系统都同样适合交给 agent"）
- [doc:D001-capability-profile.md]（harness_fit_score）
- [doc:D002-teamact-loop.md]（ACTION 步 human_in_loop）
- [doc:D008-durable-state-surfaces.md]（thread_trace 持久化）
- [doc:D010-governance-boundary.md]（个体补偿治理规则）
- [doc:D025-provider-host-abstraction.md]（跨 provider 宿主抽象）
- [doc:D029-physical-ai-sensors.md]（物理 AI 传感器接入）
- [doc:D032-external-agent-profile.md]（三方 Agent 能力画像）
- [doc:D040-harness-eval-control-plane.md]（控制面）
- [doc:../decisions/007-harness-engineering.md]（Harness 工程路径 ADR）
- [doc:../../../hiclaw/rules.md#第十一部分]（文档分层规范）
- [doc:../../../hiclaw/rules.md#T1-T8]（测试铁律）
- [doc:naming-contract.md#§4]（觉醒阶 E1-E6 标注）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（详细设计骨架，对应 F013/A013） | 开发者 Forgekin（猎犬·夏洛克） |
