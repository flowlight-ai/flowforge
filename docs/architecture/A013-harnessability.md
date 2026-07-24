# A013: Harnessability 评估架构设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.3]（FR-CORE-003，对应 FR-CORE-023）
> **对应 arch.md**: [doc:../arch.md#§3.3]
> **对应 design.md**: [doc:../design.md#§3.3]（待创建）
> **对应 Feature**: [doc:../features/F013-harnessability.md]（同号 Feature 级 SRS）
> **对应详细设计**: [doc:../design/D013-harnessability.md]（待创建，同号 Feature 级 SDD）
> **依赖 ADR**: [doc:../decisions/007-harness-engineering.md]

---

## 1. 架构上下文

### 1.1 架构问题

FlowForge 在架构层需要解决"接入低 harnessability 系统只能靠猜和点页面硬跑"的根本问题。当前 v7.0：

1. 未对外部系统做 Harnessability 评估，接入低分系统（如某些无 API 只有页面的发布平台）时Forgekin只能猜
2. 无六维评分（稳定 API / 事件流回调 / 持久状态 / 可验证输出 / 幂等可回滚 / 权限边界清楚）
3. 无接入策略四档判定（full_harness / partial_harness / human_in_loop / skip）
4. 低 Harnessability 系统的治理规则一视同仁注入所有Forgekin（违反 RA-023 低保真矩阵）

Harnessability 在架构层是 Harness 七层的适配层（L7），是外部系统接入前的工程判据。

### 1.2 架构约束

- **单向依赖约束**：`flowforge/core/harness/harnessability.py` 不可 import forgemind 或 *Forge 模块
- **DI 容器约束**：HarnessabilityAssessor 与 HarnessDecisionGate 通过构造函数注入
- **Repository 层约束**：HarnessabilityScore 必须通过 Repository 持久化到 Durable Surface（F008）
- **配置驱动约束**：dimensions / overall_thresholds 配置外置到 `flowforge/config/harness.yaml`
- **六维评分约束**：每维度 0.0-1.0，overall = 加权平均
- **低维标记约束**：低于 dimension_threshold（默认 0.6）的维度记入 low_dimensions
- **接入策略四档约束**：full_harness / partial_harness / human_in_loop / skip，无第五档

### 1.3 架构影响

- **对 TeamAct（A002）的影响**：低 harnessability 系统接入需 human_in_loop 约束 ACTION 步
- **对 Durable State（A008）的影响**：HarnessabilityScore 持久化到 thread_trace
- **对 CapabilityProfile（A001）的影响**：低 harnessability 系统影响 harness_fit_score 评估
- **对 Governance Boundary（A010）的影响**：低 Harnessability 系统的治理规则标记为"个体补偿"
- **对 F025 跨 provider 宿主抽象的影响**：提供"是否值得抽象"的判据
- **对 F032 三方 Agent 能力画像的影响**：缺少适配度维度
- **对 F029 物理 AI 传感器接入的影响**：判别传感器可 harness 程度
- **对 RA-023 低保真矩阵的影响**：依赖 Harnessability 评估做"个体补偿 vs 跨 agent 资产"判别

---

## 2. 架构设计

### 2.1 组件架构图

```
┌────────────────────────────────────────────────────────────────────┐
│              外部系统接入请求 (如发布平台 / 传感器 / API)           │
│   target_system: "wechat_publisher" / "iot_sensor_001" / ...      │
└────────────────────────────────┬───────────────────────────────────┘
                                 │ assess(target_system)
                                 ▼
┌────────────────────────────────────────────────────────────────────┐
│        flowforge/core/harness/harnessability.py (本 Feature)      │
│  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────────┐  │
│  │ HarnessabilityAs-│  │ HarnessDecision  │  │ LowFiMatrix     │  │
│  │ sessor (六维评分)│  │ Gate (四档判定)   │  │ (RA-023 低保真) │  │
│  └─────────┬────────┘  └─────────┬────────┘  └────────┬────────┘  │
│            │                     │                    │           │
│            ▼                     ▼                    ▼           │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │   六维评分 (HarnessabilityDimension)                          │  │
│  │   - stable_api          (稳定 API, 权重 0.2)                 │  │
│  │   - event_callback      (事件流回调, 权重 0.15)               │  │
│  │   - persistent_state    (持久状态, 权重 0.2)                 │  │
│  │   - verifiable_output   (可验证输出, 权重 0.2)               │  │
│  │   - idempotent_rollback (幂等可回滚, 权重 0.15)               │  │
│  │   - clear_permission    (权限边界清楚, 权重 0.1)             │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  约束:                                                              │
│  - overall = 加权平均 (权重可配置)                                  │
│  - dimension_threshold = 0.6 (低于此值标记 low_dimensions)          │
│  - 接入策略: full/partial/human_in_loop/skip (无第五档)             │
└────────────────────────────────┬───────────────────────────────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────────┐
│              HarnessDecisionGate 四档判定                           │
│   ┌────────────────────────────────────────────────────────────┐   │
│   │ overall >= 0.8 → full_harness (完整接入)                    │   │
│   │ 0.5 <= overall < 0.8 → partial_harness (部分接入, 加适配层) │   │
│   │ 0.3 <= overall < 0.5 → human_in_loop (人机协同)            │   │
│   │ overall < 0.3 → skip (不接入)                              │   │
│   └────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────────┐
│              LowFiMatrix 低保真矩阵 (RA-023)                       │
│   ┌────────────────────────────────────────────────────────────┐   │
│   │ 低 Harnessability 系统的治理规则标记为"个体补偿":            │   │
│   │ - 不强制注入所有Forgekin                                      │   │
│   │ - 仅注入实际接入该系统的Forgekin                              │   │
│   │ - 标记 Build to Delete (sunset 后该模型退役即移除)          │   │
│   ├────────────────────────────────────────────────────────────┤   │
│   │ 跨 agent 资产治理规则:                                       │   │
│   │ - 强制注入所有Forgekin                                        │   │
│   │ - 标记 Built to Persist                                     │   │
│   └────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────┘
```

### 2.2 关键架构决策

- **决策 1：六维评分体系**
  理由：roleagent.md 第 3 章提出"不是每个系统都同样适合交给 agent"。六维评分让接入前有量化判据，避免靠猜。

- **决策 2：overall = 加权平均（权重可配置）**
  理由：不同业务场景对维度权重不同（如金融场景 verifiable_output 权重更高），权重可配置外置到 YAML。

- **决策 3：四档接入策略判定**
  理由：full_harness / partial_harness / human_in_loop / skip 四档对应不同接入成本。低分系统接入必须先建适配层或人机协同。

- **决策 4：低维标记触发个体补偿治理规则（RA-023）**
  理由：低 Harnessability 系统的治理规则不应一视同仁注入所有Forgekin，仅注入实际接入的Forgekin，标记 Build to Delete。

- **决策 5：评分结果写入 F040 控制面供 sunset review 参考**
  理由：Harnessability 评分随系统演化可能变化（如发布平台新增 API），需周期 review。

- **决策 6：Harnessability 是 Build to Persist 基础设施**
  理由：编码"哪些系统值得 harness 投资"的工程判据，是复利型基础设施。

### 2.3 架构不变量

- 六维评分每维度 0.0-1.0
- overall = 加权平均（权重配置外置 YAML）
- dimension_threshold 默认 0.6（可配置）
- 低维必须记入 low_dimensions
- 接入策略仅四档（full_harness / partial_harness / human_in_loop / skip），无第五档
- 低 Harnessability 系统治理规则标记"个体补偿"，不强制注入所有Forgekin
- HarnessabilityScore 必须持久化到 Durable Surface（F008）
- 评分结果必须写入 F040 控制面

---

## 3. 模块设计

### 3.1 模块边界

- **harnessability.py::HarnessabilityDimension** — 六维枚举（STABLE_API / EVENT_CALLBACK / PERSISTENT_STATE / VERIFIABLE_OUTPUT / IDEMPOTENT_ROLLBACK / CLEAR_PERMISSION）。
- **harnessability.py::HarnessabilityScore** — 评分数据模型（target_system + scores + overall + low_dimensions + recommendation + assessed_at）。
- **harnessability.py::HarnessabilityAssessor (ABC)** — 评估器（assess target_system）。
- **harnessability.py::HarnessDecisionGate (ABC)** — 决策门（decide + require_human_in_loop）。
- **harnessability.py::LowFiMatrix** — 低保真矩阵（个体补偿 vs 跨 agent 资产判别）。
- **infra/repo/sqlite_harnessability_store.py** — SQLite 实现（评分持久化）。
- **tests/** — 单元 + 集成 + E2E（T1-T8 铁律）。

### 3.2 接口契约

```python
from abc import ABC, abstractmethod
from typing import Literal
from pydantic import BaseModel, Field, validator
from datetime import datetime
from enum import Enum


class HarnessabilityDimension(str, Enum):
    """六维评分维度"""
    STABLE_API = "stable_api"                  # 稳定 API
    EVENT_CALLBACK = "event_callback"          # 事件流回调
    PERSISTENT_STATE = "persistent_state"      # 持久状态
    VERIFIABLE_OUTPUT = "verifiable_output"    # 可验证输出
    IDEMPOTENT_ROLLBACK = "idempotent_rollback"  # 幂等可回滚
    CLEAR_PERMISSION = "clear_permission"      # 权限边界清楚


class HarnessabilityScore(BaseModel):
    """Harnessability 评分"""
    target_system: str
    scores: dict[HarnessabilityDimension, float]  # 0.0-1.0
    overall: float                              # 加权平均
    low_dimensions: list[HarnessabilityDimension]  # 低于阈值的维度
    recommendation: Literal[
        "full_harness", "partial_harness", "human_in_loop", "skip"
    ]                                           # 四档接入策略
    assessed_at: datetime = Field(default_factory=datetime.now)

    @validator("scores")
    def scores_must_be_in_range(cls, v: dict) -> dict:
        for dim, score in v.items:
            if not 0.0 <= score <= 1.0:
                raise ValueError(f"Dimension {dim} score 必须在 0.0-1.0 之间")
        return v

    @validator("overall")
    def overall_must_be_in_range(cls, v: float) -> float:
        if not 0.0 <= v <= 1.0:
            raise ValueError("overall 必须在 0.0-1.0 之间")
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
        - 持久化到 Durable Surface (F008)
        - 评分结果写入 F040 控制面
        """


class HarnessDecisionGate(ABC):
    """接入策略决策门"""

    @abstractmethod
    def decide(self, score: HarnessabilityScore) -> str:
        """根据评分决定接入策略

        架构契约:
        - overall >= 0.8 → full_harness
        - 0.5 <= overall < 0.8 → partial_harness
        - 0.3 <= overall < 0.5 → human_in_loop
        - overall < 0.3 → skip
        - 无第五档
        """

    @abstractmethod
    def require_human_in_loop(self, score: HarnessabilityScore) -> bool:
        """是否需要人机协同"""


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
    ) -> Literal["individual_compensation", "cross_agent_asset"]:
        """分类治理规则

        架构契约:
        - 低 Harnessability 系统的规则 → individual_compensation
          (仅注入实际接入的Forgekin, 标 Build to Delete)
        - 跨系统通用规则 → cross_agent_asset
          (强制注入所有Forgekin, 标 Built to Persist)
        """
```

### 3.3 数据流

```
外部系统接入请求 (target_system)
                  │
                  │ HarnessabilityAssessor.assess(target_system)
                  ▼
┌──────────────────────────────────────────────────────┐
│ 六维评分                                              │
│  - stable_api: 0.x                                   │
│  - event_callback: 0.x                               │
│  - persistent_state: 0.x                             │
│  - verifiable_output: 0.x                            │
│  - idempotent_rollback: 0.x                          │
│  - clear_permission: 0.x                             │
│  overall = 加权平均                                   │
│  low_dimensions = [低于 0.6 的维度]                   │
└────────────────────────┬─────────────────────────────┘
                         │
                         ▼
            HarnessabilityScore
                         │
                         │ HarnessDecisionGate.decide(score)
                         ▼
              ┌────────────┴────────────┐
              │  recommendation = ?     │
              └────────────┬────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
        ▼                  ▼                  ▼
   full_harness      partial_harness      human_in_loop
   (>= 0.8)          (0.5-0.8)           (0.3-0.5)
        │                  │                  │
        │ 完整接入         │ 部分接入          │ 人机协同
        │                  │ 加适配层          │
        │                  │                  │
        │                  ▼                  │
        │          LowFiMatrix.classify_rule  │
        │          个体补偿 vs 跨 agent 资产  │
        │                  │                  │
        ▼                  ▼                  ▼
            持久化到 Durable Surface (F008)
                  │
                  ▼
            写入 F040 控制面 (供 sunset review)
```

---

## 4. 跨模块协作

### 4.1 上游依赖

- **F008 Durable State Surfaces** — HarnessabilityScore 持久化到 thread_trace
- **F002 TeamAct Loop** — 低 harnessability 系统接入需 human_in_loop 约束 ACTION 步
- **F001 CapabilityProfile** — harness_fit_score 评估输入

### 4.2 下游影响

- **F025 跨 provider 宿主抽象** — 提供"是否值得抽象"的判据
- **F029 物理 AI 传感器接入** — 判别传感器可 harness 程度
- **F032 三方 Agent 能力画像** — 补充适配度维度
- **F010 Governance Boundary** — 低 Harnessability 系统治理规则标记"个体补偿"
- **F040 Harness Eval 控制面** — 评分结果写入供 sunset review
- **RA-023 低保真矩阵** — 个体补偿 vs 跨 agent 资产判别依据

### 4.3 跨模块不变量

- HarnessabilityScore 必须持久化到 Durable Surface（F008），不存进程内
- 接入策略仅四档（full_harness / partial_harness / human_in_loop / skip），无第五档
- 低 Harnessability 系统治理规则必须标记"个体补偿"，不强制注入所有Forgekin
- 评分结果必须写入 F040 控制面供 sunset review
- 评分维度仅六维，不可扩展（避免评分膨胀）
- dimension_threshold 默认 0.6，可配置但不可低于 0.5

---

## 5. 架构验收

### 5.1 架构契约验收

- [ ] AC-1: `flowforge/core/harness/harnessability.py` 不 import forgemind 或 *Forge 模块
- [ ] AC-2: HarnessabilityAssessor 与 HarnessDecisionGate 通过 DI 容器注入，无直接实例化
- [ ] AC-3: HarnessabilityScore 通过 Repository 持久化到 Durable Surface（无 cursor.execute）
- [ ] AC-4: dimensions / overall_thresholds / dimension_threshold 配置外置到 `flowforge/config/harness.yaml`
- [ ] AC-5: 评分结果写入 F040 控制面

### 5.2 架构不变量验收

- [ ] AC-6: 六维评分均可独立打分
- [ ] AC-7: overall 加权平均正确（权重配置外置）
- [ ] AC-8: 低维标记触发个体补偿治理规则（RA-023）
- [ ] AC-9: 接入策略四档判定正确（full/partial/human_in_loop/skip）
- [ ] AC-10: 评分维度仅六维，不可扩展
- [ ] AC-11: 低 Harnessability 系统治理规则不强制注入所有Forgekin
- [ ] AC-12: dimension_threshold 默认 0.6，可配置但不可低于 0.5

---

## 6. 引用

- [doc:../spec.md#§3.3]（FR-CORE-003，FR-CORE-023 Harnessability 评估）
- [doc:../arch.md#§3.3]（Harness 七层现实表面，L7 Harnessability）
- [doc:../features/F013-harnessability.md]（同号 Feature 级 SRS）
- [doc:../features/F001-capability-profile.md]（harness_fit_score 评估输入）
- [doc:../features/F008-durable-state-surfaces.md]（评分持久化目标）
- [doc:../features/F010-governance-boundary.md]（个体补偿治理规则）
- [doc:../features/F025-provider-host-abstraction.md]（是否值得抽象判据）
- [doc:../features/F029-physical-ai-sensors.md]（传感器可 harness 程度）
- [doc:../features/F032-external-agent-profile.md]（适配度维度补充）
- [doc:../features/F040-harness-eval-control-plane.md]（控制面 sunset review）
- [doc:../decisions/007-harness-engineering.md]（Harness 工程路径 ADR）
- [doc:../../CONTRIBUTING.md]（文档分层规范）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（架构骨架，对应 F013 Feature 级 SRS） | 架构师 Forgekin（猫头鹰·鲁班） |
