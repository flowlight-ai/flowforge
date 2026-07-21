# A035: 三方 Agent 能力融合架构设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.10]（FR-CORE-010）
> **对应 arch.md**: [doc:../arch.md#§3.10] + [doc:../arch.md#§3.14]（SpiritForge + MindCouncil）
> **对应 design.md**: [doc:../design.md#§3.10]（待创建）
> **对应 Feature**: [doc:../features/F035-external-agent-capability-fusion.md]（同号 Feature 级 SRS）
> **对应详细设计**: [doc:../design/D035-external-agent-capability-fusion.md]（待创建，同号 Feature 级 SDD）
> **依赖 ADR**: [doc:../decisions/006-external-agent-integration.md]

---

## 1. 架构上下文

### 1.1 架构问题

ExternalAgentAdapter 抽象层（A031）需要实现"用完即走 -> 用完即学"的能力增长机制，让Forgekin多次调用三方 Agent 后"学到"能力。但 v7.0 无三方 Agent 能力融合机制，与前期设计的主要差距是前期动物形态智能体会从调用工具中学习，v7.0 的 Forgekin 不会。本架构在 `core/external_agent/capability_fusion.py` 建立三方 Agent 能力融合层，解决以下架构层问题：

1. **FusionSource 采集缺失**：每次三方 Agent 调用后无统一的 FusionSource 采集机制，调用经验流失。
2. **相似调用聚类未编码**：CL-003 L0->L1 需 3+ 相似 Episode，但 v7.0 无聚类机制。
3. **五级成熟度阶梯未约束**：L0 Episode -> L1 Pattern -> L2 Draft -> L3 Validated -> L4 Standard 五级无严格阶梯，可跳级。
4. **Eval Ledger 净增益未硬门**：合入蒸馏知识库前无前后测对比净增益 > 0 硬门，低质量条目可入典。
5. **能力画像融合缺失**：成熟度 L3+ 蒸馏知识库条目未合入 F001 CapabilityProfile 作为 SkillPackage。
6. **蒸馏知识库（MindCodex）未对接**：F039 MindCodex可检索知识库无三方 Agent 调用经验条目来源。
7. **Knowledge Object Contract 字段未校验**：CL-005 Knowledge Object Contract 字段完整性未校验，蒸馏候选字段可能缺失。

### 1.2 架构约束

- **单向依赖约束**：CapabilityDistiller 必须单向依赖 F001 CapabilityProfile + F014 Memory Collection + F018 Eval Contract + F032 能力画像 + F033 共享状态 + F039 MindCodex，禁止反向依赖 *Forge。
- **DI 容器约束**：FusionSourceCollector / CapabilityDistiller / CapabilityFusionApplier 实例必须通过 DI 容器注入到 ExternalAgentBridge。
- **Repository 层约束**：FusionSource / CapabilityDistillationCandidate / 蒸馏知识库条目写入必须通过 Repository 层，禁止直接操作数据库。
- **配置驱动约束**：source_collector / distillation / codex_submission / profile_apply 配置必须 YAML 外置到 `config/external_agent.yaml`，禁止 .py 硬编码。
- **质量阈值约束**：FusionSource 采集的 min_quality_score 必须为 0.85（与项目规则一致）。
- **CL-003 五级阶梯约束**：L0 -> L1 -> L2 -> L3 -> L4 必须严格按级晋升，禁止跳级。
- **CL-004 Eval Ledger 约束**：合入蒸馏知识库前必须前后测对比，净增益 > 0 才允许合入。
- **CL-005 Knowledge Object Contract 约束**：蒸馏候选必须含 trigger_pattern / procedure / precondition / postcondition / anti_pattern / provenance 字段，缺一即校验失败。
- **operator 审批约束**：L4 Standard 阶段必须 operator 显式批准，禁止自动合入。

### 1.3 架构影响

- **对 F001 能力画像的影响**：成熟度 L3+ 蒸馏知识库条目作为 SkillPackage 合入 CapabilityProfile。
- **对 F014 多域记忆的影响**：FusionSource 与 FallbackExecutionRecord 共同写入EchoStore作为蒸馏原料。
- **对 F018 Eval Contract 的影响**：Eval Ledger 前后测对比用于净增益验证。
- **对 F032 能力画像的影响**：external_agent_profile_ref 字段引用 ExternalAgentCapabilityProfile。
- **对 F033 共享状态的影响**：call_artifacts 字段引用 ExternalAgentSharedState 产出物。
- **对 F039 MindCodex可检索知识库的影响**：蒸馏知识库条目作为 F039 MindCodex知识库条目来源。
- **对 A031 ExternalAgentBridge 的影响**：Bridge 在调用成功后调用 FusionSourceCollector.collect 采集融合来源。

---

## 2. 架构设计

### 2.1 组件架构图

```
                    +-------------------------------------------------+
                    |  core/external_agent/capability_fusion.py       |
                    |                                                 |
                    |  +-------------------+                          |
                    |  | FusionSource      |  一次三方 Agent 调用      |
                    |  | (调用经验)         |  (forgekin_id +          |
                    |  +---------+---------+  external_agent_id +     |
                    |            |           task_context +           |
                    |  +---------v---------+  call_artifacts +        |
                    |  | FusionSource      |  call_quality_score)    |
                    |  | Collector         |                          |
                    |  | (每次调用后采集)   |                          |
                    |  +---------+---------+                          |
                    |            |                                    |
                    |  +---------v---------+                          |
                    |  | 相似调用聚类       |  CL-003 L0->L1 需 3+     |
                    |  | (基于任务上下文 +  |  相似 Episode             |
                    |  |  能力域聚类)       |                          |
                    |  +---------+---------+                          |
                    |            |                                    |
                    |  +---------v---------+   +-------------------+ |
                    |  | CapabilityDistill-|   | 五级成熟度阶梯     | |
                    |  | ationCandidate    |<->| (CL-003)           | |
                    |  | (蒸馏候选)         |   | L0 Episode         | |
                    |  +---------+---------+   | L1 Pattern (3+)    | |
                    |            |             | L2 Draft           | |
                    |  +---------v---------+   | L3 Validated       | |
                    |  | CapabilityDistill-|   | L4 Standard (op)   | |
                    |  | er (与 SpiritForge 联动)    |   +-------------------+ |
                    |  +---------+---------+                         |
                    |            |                                   |
                    |  +---------v---------+                         |
                    |  | Eval Ledger       |  CL-004 净增益 > 0 硬门  |
                    |  | (前后测对比)       |                         |
                    |  +---------+---------+                         |
                    |            |                                   |
                    |  +---------v---------+   +-------------------+ |
                    |  | CapabilityFusion  |   | F039 MindCodex          | |
                    |  | Applier           |-->| (MindCodex)       | |
                    |  | (合入能力画像)     |   +-------------------+ |
                    |  +---------+---------+   +-------------------+ |
                    |            |             | F001 Capability    | |
                    |            `------------>| Profile           | |
                    |                          | (SkillPackage)     | |
                    |                          +-------------------+ |
                    +-------------------------------------------------+
```

### 2.2 关键架构决策

- **决策 1：FusionSource 每次调用自动采集**
  FusionSourceCollector.collect 在每次三方 Agent 调用成功后自动采集（auto_collect_on_call=true）。采集内容含 forgekin_id / external_agent_id / external_agent_profile_ref / task_context / call_artifacts / call_quality_score / call_timestamp。质量分 < 0.85 的调用不采集（min_quality_score=0.85）。

- **决策 2：相似调用聚类基于任务上下文 + 能力域**
  FusionSourceCollector.list_similar_sources 基于任务上下文 + 三方 Agent 能力域聚类相似 FusionSource。CL-003 L0->L1 需 3+ 相似 Episode 才能聚类为 Pattern。这避免单次调用直接蒸馏导致能力候选不稳定。

- **决策 3：CL-003 五级成熟度阶梯严格不可跳级**
  L0 Episode（单次调用） -> L1 Pattern（3+ 相似） -> L2 Draft（SpiritForge 主动抽象） -> L3 Validated（Eval A/B 验证） -> L4 Standard（operator 批准）。每级晋升必须满足前级条件，禁止跳级。L4 必须 operator 显式批准（require_operator_approval_for_L4=true）。

- **决策 4：CL-004 Eval Ledger 净增益硬门**
  合入蒸馏知识库前必须前后测对比：使用候选能力前后的任务完成质量分对比，净增益 > 0 才允许合入。这避免低质量能力条目污染蒸馏知识库。

- **决策 5：CL-005 Knowledge Object Contract 字段完整性校验**
  CapabilityDistillationCandidate 必须含 trigger_pattern（何时使用）/ procedure（怎么用）/ precondition（前置条件）/ postcondition（预期效果）/ anti_pattern（反模式）/ provenance（来源 Episode ID）六字段。缺一即校验失败，禁止提交到蒸馏知识库。

- **决策 6：L3+ 蒸馏知识库条目作为 SkillPackage 合入 F001 CapabilityProfile**
  成熟度 L3 Validated 及以上的蒸馏知识库条目作为 SkillPackage 合入 F001 CapabilityProfile。下次任务可路由到此Forgekin（无需调用三方 Agent）。这实现"用完即学"闭环。

- **决策 7：与 SpiritForge 联动蒸馏**
  CapabilityDistiller.distill 与 SpiritForge（F014 + arch.md §3.14）联动，由 SpiritForge 主动抽象出能力候选。SpiritForge 作为蒸馏引擎，能力融合层提供原料与目标画像。

### 2.3 架构不变量

- FusionSource 必须在每次三方 Agent 调用成功后自动采集，质量分 < 0.85 时不采集。
- 相似调用聚类必须满足 CL-003 L0->L1 需 3+ 相似 Episode，否则不晋升 Pattern。
- CL-003 五级成熟度阶梯必须严格按级晋升（L0->L1->L2->L3->L4），禁止跳级。
- L4 Standard 阶段必须 operator 显式批准，禁止自动合入。
- CL-004 Eval Ledger 净增益 > 0 才允许合入蒸馏知识库，净增益 <= 0 时合入被拒绝。
- CL-005 Knowledge Object Contract 六字段必须完整，缺一即校验失败。
- 成熟度 L3+ 蒸馏知识库条目必须作为 SkillPackage 合入 F001 CapabilityProfile。
- FusionSource / CapabilityDistillationCandidate / 蒸馏知识库条目写入必须通过 Repository 层。
- source_collector / distillation / codex_submission / profile_apply 配置必须 YAML 外置到 `config/external_agent.yaml`。

---

## 3. 模块设计

### 3.1 模块边界

| 模块 | 路径 | 职责 |
|------|------|------|
| FusionSource | `core/external_agent/capability_fusion.py` | 融合来源数据模型（一次调用） |
| FusionSourceCollector | `core/external_agent/capability_fusion.py` | 融合来源采集器（自动采集） |
| CapabilityDistillationCandidate | `core/external_agent/capability_fusion.py` | 能力蒸馏候选数据模型（含 CL-005 六字段） |
| CapabilityDistiller | `core/external_agent/capability_fusion.py` | 能力蒸馏器（与 SpiritForge 联动） |
| EvalLedger | `core/external_agent/capability_fusion.py` | Eval Ledger（前后测净增益验证） |
| CapabilityFusionApplier | `core/external_agent/capability_fusion.py` | 能力融合应用器（合入 CapabilityProfile） |
| MaturityLevel | `core/external_agent/capability_fusion.py` | 五级成熟度枚举（L0-L4） |
| ExternalAgentConfig | `config/external_agent.yaml` | source_collector / distillation / codex_submission / profile_apply YAML 配置（外置） |

### 3.2 接口契约

```python
from abc import ABC, abstractmethod
from typing import Optional
from pydantic import BaseModel, Field
from enum import Enum
from datetime import datetime


class MaturityLevel(str, Enum):
    """五级成熟度阶梯（CL-003）"""
    L0_EPISODE = "L0"      # L0 Episode（单次调用）
    L1_PATTERN = "L1"      # L1 Pattern（3+ 相似 Episode）
    L2_DRAFT = "L2"        # L2 Draft（SpiritForge 主动抽象）
    L3_VALIDATED = "L3"    # L3 Validated（Eval A/B 验证）
    L4_STANDARD = "L4"     # L4 Standard（operator 批准）


class FusionSource(BaseModel):
    """能力融合来源（一次三方 Agent 调用）"""
    source_id: str
    forgekin_id: str                           # 调用方Forgekin ID
    external_agent_id: str                     # 三方 Agent ID（来自 F032）
    external_agent_profile_ref: str            # F032 能力画像引用
    task_context: dict                         # 调用时任务上下文
    call_artifacts: list[str]                  # 调用产出物 ID（来自 F033 共享状态）
    call_quality_score: float = Field(ge=0.0, le=1.0)
    call_timestamp: datetime


class CapabilityDistillationCandidate(BaseModel):
    """能力蒸馏候选（待 SpiritForge 评估是否合入 MindCodex）
    CL-005 Knowledge Object Contract 六字段必须完整
    """
    candidate_id: str
    fusion_sources: list[FusionSource]         # 多次相似调用作为蒸馏原料
    distilled_capability: str                  # 蒸馏出的能力描述
    trigger_pattern: str                       # 何时使用（CL-005）
    procedure: str                             # 怎么用（CL-005）
    precondition: str                          # 前置条件（CL-005）
    postcondition: str                         # 预期效果（CL-005）
    anti_pattern: str                          # 反模式（CL-005）
    provenance: list[str]                      # 来源 Episode ID（CL-005）
    confidence: float = Field(ge=0.0, le=1.0)
    maturity_level: MaturityLevel = MaturityLevel.L0_EPISODE


class EvalLedgerRecord(BaseModel):
    """Eval Ledger 记录（CL-004 净增益验证）"""
    ledger_id: str
    candidate_id: str
    before_score: float = Field(ge=0.0, le=1.0)   # 使用候选能力前任务质量分
    after_score: float = Field(ge=0.0, le=1.0)    # 使用候选能力后任务质量分
    net_gain: float                              # 净增益 = after_score - before_score
    validated_at: datetime


class FusionSourceCollector(ABC):
    """融合来源采集器（每次三方 Agent 调用后采集）"""

    @abstractmethod
    async def collect(
        self, call_record: dict, quality_score: float
    ) -> Optional[FusionSource]:
        """
        采集 FusionSource：
        - 质量分 < 0.85 时不采集（min_quality_score=0.85）
        - 质量分 >= 0.85 时自动采集
        """
        ...

    @abstractmethod
    async def list_similar_sources(
        self,
        forgekin_id: str,
        capability_domain: str,
        min_count: int = 3,
    ) -> list[FusionSource]:
        """
        列出相似调用（CL-003 L0->L1 需 3+ 相似 Episode）
        基于任务上下文 + 三方 Agent 能力域聚类
        """
        ...


class CapabilityDistiller(ABC):
    """能力蒸馏器（与SpiritForge 联动）"""

    @abstractmethod
    async def distill(
        self, sources: list[FusionSource]
    ) -> CapabilityDistillationCandidate:
        """
        蒸馏能力候选：
        1. SpiritForge 主动抽象出 distilled_capability
        2. 填充 CL-005 六字段（trigger_pattern / procedure / precondition / postcondition / anti_pattern / provenance）
        3. 初始 maturity_level = L1_PATTERN（满足 3+ 相似）
        """
        ...

    @abstractmethod
    async def promote_maturity(
        self, candidate_id: str, target_level: MaturityLevel
    ) -> CapabilityDistillationCandidate:
        """
        晋升成熟度阶梯（L0->L1->L2->L3->L4，禁止跳级）：
        - L1->L2: SpiritForge 主动抽象
        - L2->L3: Eval A/B 验证通过
        - L3->L4: operator 显式批准
        """
        ...

    @abstractmethod
    async def submit_to_codex(
        self, candidate: CapabilityDistillationCandidate
    ) -> str:
        """
        提交到 F039 MindCodex（需 Eval Ledger 前后测验证，CL-004）
        - CL-005 六字段完整性校验
        - Eval Ledger 净增益 > 0
        - L3+ 才允许提交
        """
        ...


class CapabilityFusionApplier(ABC):
    """能力融合应用器（合入Forgekin能力画像）"""

    @abstractmethod
    async def apply_to_profile(
        self, forgekin_id: str, codex_entry_id: str
    ) -> None:
        """
        将蒸馏知识库条目作为 SkillPackage 合入 F001 CapabilityProfile：
        - 仅 L3+ 蒸馏知识库条目允许合入
        - 合入后下次任务可路由到此Forgekin（无需调用三方 Agent）
        """
        ...
```

### 3.3 数据流

```
[采集阶段（每次调用后）]
    ExternalAgentBridge.invoke 成功
        |
        v
    FusionSourceCollector.collect(call_record, quality_score)
        |
        +--> quality_score < 0.85: 不采集
        `--> quality_score >= 0.85: 采集 FusionSource
            |-- forgekin_id
            |-- external_agent_id
            |-- task_context
            |-- call_artifacts (来自 F033 共享状态)
            `-- call_quality_score
                |
                v
            持久化到 F014 EchoStore（作为蒸馏原料）

[聚类阶段（CL-003 L0->L1）]
    FusionSourceCollector.list_similar_sources(forgekin_id, capability_domain, min_count=3)
        |
        v
    基于任务上下文 + 三方 Agent 能力域聚类
        |
        +--> 相似数量 < 3: 保留 L0_EPISODE
        `--> 相似数量 >= 3: 晋升 L1_PATTERN

[蒸馏阶段（L1->L2，与 SpiritForge 联动）]
    CapabilityDistiller.distill(sources)
        |
        v
    SpiritForge主动抽象出能力候选
        |
        v
    填充 CL-005 六字段：
    |-- trigger_pattern: 何时使用
    |-- procedure: 怎么用
    |-- precondition: 前置条件
    |-- postcondition: 预期效果
    |-- anti_pattern: 反模式
    `-- provenance: 来源 Episode ID
        |
        v
    返回 CapabilityDistillationCandidate (maturity_level=L2_DRAFT)

[验证阶段（L2->L3，CL-004 Eval Ledger）]
    CapabilityDistiller.promote_maturity(candidate_id, target=L3_VALIDATED)
        |
        v
    Eval Ledger 前后测对比：
    |-- before_score: 使用候选能力前任务质量分
    |-- after_score: 使用候选能力后任务质量分
    `-- net_gain = after_score - before_score
        |
        +--> net_gain <= 0: 晋升被拒绝
        `--> net_gain > 0: 晋升 L3_VALIDATED

[合入蒸馏知识库阶段（L3+ 提交到 F039 MindCodex）]
    CapabilityDistiller.submit_to_codex(candidate)
        |
        v
    CL-005 六字段完整性校验
        |
        +--> 字段缺失: 校验失败
        `--> 字段完整: 写入 F039 MindCodex可检索知识库

[operator 批准阶段（L3->L4）]
    CapabilityDistiller.promote_maturity(candidate_id, target=L4_STANDARD)
        |
        v
    operator 显式批准
        |
        +--> 拒绝: 保留 L3
        `--> 批准: 晋升 L4_STANDARD

[合入能力画像阶段（F001 CapabilityProfile）]
    CapabilityFusionApplier.apply_to_profile(forgekin_id, codex_entry_id)
        |
        v
    将 L3+ 蒸馏知识库条目作为 SkillPackage 合入 CapabilityProfile
        |
        v
    下次任务可路由到此Forgekin（无需调用三方 Agent）
        `--> 实现"用完即学"闭环

[失败经验蒸馏阶段（与 F034 联动）]
    F034 FallbackExecutionRecord 写入 F014 EchoStore
        |
        v
    作为 FusionSource 的补充原料
        `--> SpiritForge 可蒸馏出"何时不应调用某厂商"的反模式知识
```

---

## 4. 跨模块协作

### 4.1 上游依赖

- **依赖 F001 CapabilityProfile**：成熟度 L3+ 蒸馏知识库条目合入目标画像。
- **依赖 F014 Memory Collection**：FusionSource + FallbackExecutionRecord 写入EchoStore作为蒸馏原料。
- **依赖 F018 Eval Contract**：Eval Ledger 前后测对比用于净增益验证。
- **依赖 F032 ExternalAgentProfile**：external_agent_profile_ref 字段引用。
- **依赖 F033 ExternalAgentSharedState**：call_artifacts 字段引用共享状态产出物。
- **依赖 F039 MindCodex（MindCodex 可检索知识库）**：蒸馏知识库条目提交目标。
- **依赖SpiritForge（arch.md §3.14）**：蒸馏引擎。
- **依赖 core/interfaces**：Repository / DI 容器抽象。

### 4.2 下游影响

- **影响 A031 ExternalAgentBridge**：Bridge 在调用成功后调用 FusionSourceCollector.collect 采集融合来源。
- **影响 F001 CapabilityProfile**：L3+ 蒸馏知识库条目作为 SkillPackage 合入，Forgekin能力画像动态增长。
- **影响 F039 MindCodex 可检索知识库**：MindCodex 条目作为 MindCodex 知识库条目来源。
- **影响 SpiritForge**：能力融合层提供蒸馏原料与目标画像。

### 4.3 跨模块不变量

- FusionSource 必须在每次三方 Agent 调用成功后自动采集，质量分 < 0.85 时不采集。
- 相似调用聚类必须满足 CL-003 L0->L1 需 3+ 相似 Episode。
- CL-003 五级成熟度阶梯必须严格按级晋升，禁止跳级。
- L4 Standard 阶段必须 operator 显式批准。
- CL-004 Eval Ledger 净增益 > 0 才允许合入蒸馏知识库。
- CL-005 Knowledge Object Contract 六字段必须完整，缺一即校验失败。
- 成熟度 L3+ 蒸馏知识库条目必须作为 SkillPackage 合入 F001 CapabilityProfile。
- FusionSource / CapabilityDistillationCandidate / 蒸馏知识库条目写入必须通过 Repository 层。

---

## 5. 架构验收

### 5.1 架构契约验收

- [ ] AC-1: 单向依赖通过 —— `core/external_agent/capability_fusion.py` 仅依赖 F001/F014/F018/F032/F033/F039，无 *Forge 反向 import。
- [ ] AC-2: DI 容器注入通过 —— FusionSourceCollector / CapabilityDistiller / CapabilityFusionApplier 通过 DI 容器注入到 ExternalAgentBridge。
- [ ] AC-3: Repository 层通过 —— FusionSource / CapabilityDistillationCandidate / 蒸馏知识库条目通过 Repository 写入，无直接数据库操作。
- [ ] AC-4: 配置驱动通过 —— source_collector / distillation / codex_submission / profile_apply 配置 YAML 外置到 `config/external_agent.yaml`。
- [ ] AC-5: 质量阈值通过 —— FusionSource 采集的 min_quality_score=0.85，与项目规则一致。

### 5.2 架构不变量验收

- [ ] AC-6: 自动采集不变量通过 —— 每次三方 Agent 调用成功后 FusionSourceCollector.collect 被调用，质量分 < 0.85 时不采集。
- [ ] AC-7: 相似聚类不变量通过 —— list_similar_sources 返回的相似数量 < 3 时不晋升 L1_PATTERN。
- [ ] AC-8: 五级阶梯不变量通过 —— L0->L4 晋升路径严格按级，跳级调用被拒绝。
- [ ] AC-9: operator 审批不变量通过 —— L3->L4 晋升未经 operator 批准时被拒绝。
- [ ] AC-10: Eval Ledger 净增益不变量通过 —— net_gain <= 0 时 L2->L3 晋升被拒绝。
- [ ] AC-11: CL-005 字段完整性不变量通过 —— 缺任一字段的 CapabilityDistillationCandidate 提交到蒸馏知识库被拒绝。
- [ ] AC-12: L3+ 合入不变量通过 —— 仅 L3_VALIDATED / L4_STANDARD 蒸馏知识库条目可合入 F001 CapabilityProfile。
- [ ] AC-13: 用完即学闭环不变量通过 —— L3+ 蒸馏知识库条目合入后，下次类似任务Forgekin可自主完成（不调三方 Agent）。

---

## 6. 引用

- [doc:../spec.md#§3.10]（FR-CORE-010）
- [doc:../arch.md#§3.10]（三方 Agent 集成）
- [doc:../arch.md#§3.14]（SpiritForge + MindCouncil）
- [doc:../features/F035-external-agent-capability-fusion.md]（同号 Feature 级 SRS）
- [doc:../features/F001-capability-profile.md]
- [doc:../features/F014-memory-collection.md]
- [doc:../features/F018-eval-contract.md]
- [doc:../features/F031-external-agent-adapter.md]
- [doc:../features/F032-external-agent-profile.md]
- [doc:../features/F033-external-agent-shared-state.md]
- [doc:../features/F034-external-agent-fallback.md]
- [doc:../features/F039-mind-codex-searchable.md]
- [doc:../decisions/006-external-agent-integration.md]
- [doc:../design/naming-contract.md]（SpiritForge + MindCodex 蒸馏知识库 + Capability Profile 能力画像）
- [doc:../../../hiclaw/rules.md#第十一部分]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（FusionSource 采集 + 相似聚类 + CL-003 五级阶梯 + CL-004 Eval Ledger + CL-005 Knowledge Object Contract + L3+ 合入 CapabilityProfile 架构） | 架构师 Forgekin（猫头鹰·鲁班） |
