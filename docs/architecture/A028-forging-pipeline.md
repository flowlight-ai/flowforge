# A028: Forgekin 锻造流水线架构设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.9]（FR-CORE-009）
> **对应 arch.md**: [doc:../arch.md#§3.9]
> **对应 design.md**: [doc:../design.md#§3.9]（待创建）
> **对应 Feature**: [doc:../features/F028-forging-pipeline.md]（同号 Feature 级 SRS）
> **对应详细设计**: [doc:../design/D028-forging-pipeline.md]（待创建，同号 Feature 级 SDD）
> **依赖 ADR**: [doc:../decisions/013-all-things-spirit-mind-vision.md]

---

## 1. 架构上下文

### 1.1 架构问题

forgemind 应用层需要将 Forge Nurturing 过程从"配置 persona"升级为系统化 Forge Nurturing 流水线，但 v7.0 仅有"灵启训练"一个步骤，未设计完整锻造流水线。本架构在 forgemind 内部建立 6 步锻造流水线编排框架，解决以下架构层问题：

1. **Forge Nurturing过程无标准化流程**：从形态定义到觉醒晋升的 6 步无统一编排器，散落在不同模块。
2. **阶段间硬耦合**：形态定义、能力注入、记忆初始化、价值观对齐、能力验证、觉醒晋升彼此直接调用，无阶段隔离。
3. **operator 关键审批点缺失**：①形态定义 / ④价值观对齐 / ⑥觉醒晋升三处必须 operator 批准，但 v7.0 无审批门机制。
4. **能力验证无硬门**：⑤能力验证阶段未对接 F018 Eval Contract 五问，质量分 < 0.85 仍可晋升。
5. **觉醒阶上限未约束**：⑥觉醒晋升可超过 operator 授权范围，存在越权风险。
6. **回滚机制缺失**：⑤能力验证失败后无回滚到 ②能力注入的机制。

### 1.2 架构约束

- **单向依赖约束**：ForgePipeline 必须单向依赖 F001/F008/F014/F018/F027，禁止反向依赖 *Forge。
- **DI 容器约束**：StageHandler 必须通过 DI 容器注入，禁止 ForgePipeline 直接 `SpeciesDefineHandler` 实例化。
- **配置驱动约束**：6 阶段 handler 类名 / require_operator_approval / eval_threshold / on_fail / max_awakening_stage 必须 YAML 外置到 `forgemind/config/forging.yaml`。
- **operator 审批约束**：①④⑥阶段必须 operator 显式批准，禁止自动跳过审批门。
- **Eval 硬门约束**：⑤能力验证阶段必须通过 F018 Eval Contract 五问 + 质量分阈值 0.85，失败必须回滚到 ②能力注入。
- **觉醒阶上限约束**：⑥目标觉醒阶不可超过 operator 在 ForgingManifest 中授权的 max_awakening_stage。

### 1.3 架构影响

- **对 F027 形态分类的影响**：流水线第 ① 步调用 SpeciesRegistry.get(species) 加载形态属性。
- **对 F001 能力画像的影响**：流水线第 ② 步注入 CapabilityProfile，作为 Forgekin 能力锚点。
- **对 F014 多域记忆的影响**：流水线第 ③ 步初始化多域记忆联邦，写入初始EchoStore条目。
- **对 F008 持久状态层的影响**：流水线产出（SoulImprint + 能力画像 + 初始EchoStore + 锻造清单）必须写入持久状态层。
- **对 F018 Eval Contract 的影响**：流水线第 ⑤ 步必须通过 Eval 五问评估，Eval 信号回流触发后续晋升。
- **对 F037 Forgekin 市场的影响**：流水线第 ⑥ 步觉醒晋升后Forgekin可发布到市场。
- **对 F038 进化谱系的影响**：流水线产出的 Forgekin 作为谱系起点，后续形态进化/能力增长追加到谱系。

---

## 2. 架构设计

### 2.1 组件架构图

```
                    +-------------------------------------------------+
                    |             forgemind/forging/                  |
                    |                                                 |
                    |  +-------------------+                          |
                    |  | ForgingExecutor   |  6 步流水线编排器         |
                    |  | (start/advance/   |                          |
                    |  |  get_state)       |                          |
                    |  +---------+---------+                          |
                    |            |                                    |
                    |            v                                    |
                    |  +------------------------------------------+  |
                    |  |       6 阶段处理器（插件化）              |  |
                    |  |                                          |  |
                    |  | ① SpeciesDefineHandler                   |  |
                    |  |    `--> operator approval                |  |
                    |  |    `--> F027 SpeciesRegistry             |  |
                    |  |                                          |  |
                    |  | ② CapabilityInjectHandler                |  |
                    |  |    `--> F001 CapabilityProfile Repo       |  |
                    |  |    <-- on_fail 回滚点                    |  |
                    |  |                                          |  |
                    |  | ③ MemorySeedHandler                      |  |
                    |  |    `--> F014 EchoStore Repository         |  |
                    |  |                                          |  |
                    |  | ④ ValueAlignHandler                      |  |
                    |  |    `--> operator approval                |  |
                    |  |    `--> ValueCharter (不可变红线)         |  |
                    |  |                                          |  |
                    |  | ⑤ CapabilityVerifyHandler                |  |
                    |  |    `--> F018 Eval Contract (阈值 0.85)    |  |
                    |  |    `--> on_fail: rollback to ②           |  |
                    |  |                                          |  |
                    |  | ⑥ AwakeningPromoteHandler                |  |
                    |  |    `--> operator approval                |  |
                    |  |    `--> E1 -> E2/E3 (受 max 限制)        |  |
                    |  +------------------------------------------+  |
                    +-------------------------------------------------+
                                          |
                                          v
                    +-------------------------------------------------+
                    |  +-------------------+  +-------------------+ |
                    |  | ForgingManifest   |  | ForgingPipeline   | |
                    |  | (YAML 锻造清单)    |->| State (状态机)    | |
                    |  +-------------------+  +-------------------+ |
                    |  +-------------------+  +-------------------+ |
                    |  | ForgingStage Enum |  | StageTransition   | |
                    |  | (6 阶段枚举)       |  | Log               | |
                    |  +-------------------+  +-------------------+ |
                    +-------------------------------------------------+
```

### 2.2 关键架构决策

- **决策 1：6 阶段严格顺序执行 + 阶段间通过 artifact 解耦**
  阶段顺序为 ①形态定义 -> ②能力注入 -> ③记忆初始化 -> ④价值观对齐 -> ⑤能力验证 -> ⑥觉醒晋升，每阶段产出 artifact_id 后才能进入下一阶段。这避免阶段间直接调用造成的硬耦合，artifact 作为阶段间契约。

- **决策 2：operator 关键审批点设在 ①④⑥阶段**
  ①形态定义（确认 species）+ ④价值观对齐（确认 value_anchors）+ ⑥觉醒晋升（确认目标觉醒阶）必须 operator 批准。其他阶段可自动执行。这平衡自动化与人为控制，避免Forgekin擅自切换形态或越权晋升。

- **决策 3：⑤能力验证硬门对接 F018 Eval Contract**
  ⑤阶段必须通过 Eval Contract 五问（谁评估/评估什么/何时评估/评估信号/评估后做什么）+ 质量分阈值 0.85（v4.0 调整后默认值）。失败则回滚到 ②能力注入重新注入能力。这保证觉醒Forgekin具备基线能力。

- **决策 4：StageHandler 插件化 + YAML 配置驱动**
  每阶段一个 StageHandler 类，handler 类名 + require_operator_approval + eval_threshold + on_fail + max_awakening_stage 全部 YAML 外置。这满足配置驱动约束（架构红线第 5 条），允许通过修改 YAML 调整流程而无需改代码。

- **决策 5：觉醒阶上限由 ForgingManifest 授权**
  ⑥阶段目标觉醒阶不可超过 operator 在 ForgingManifest.max_awakening_stage 中授权的范围。默认 max=E3，更高觉醒阶需 operator 单独授权。这防止Forgekin越权晋升到 E5 进化阶（Evolving / L3 Self-Improving）或 E6 ForgeMind 阶（ForgeMind / L4 Self-Evolving Agent）。

### 2.3 架构不变量

- 6 阶段必须严格顺序执行（①->②->③->④->⑤->⑥），禁止跳过任何阶段。
- ①④⑥阶段必须 operator 显式批准，禁止自动跳过审批门。
- ⑤能力验证阶段必须通过 F018 Eval Contract 评估 + 质量分 >= 0.85，失败必须回滚到 ②能力注入。
- ⑥目标觉醒阶必须不超过 ForgingManifest.max_awakening_stage 授权范围。
- 阶段间必须通过 artifact_id 解耦，禁止 StageHandler 直接调用下一阶段。
- StageHandler 必须通过 DI 容器注入，ForgePipeline 禁止直接实例化 handler。
- 6 阶段配置必须 YAML 外置到 `forgemind/config/forging.yaml`，禁止 .py 硬编码 handler 类名。

---

## 3. 模块设计

### 3.1 模块边界

| 模块 | 路径 | 职责 |
|------|------|------|
| ForgingExecutor | `forgemind/forging/pipeline.py` | 6 步流水线编排器（start/advance/get_state） |
| ForgingStage | `forgemind/forging/pipeline.py` | 6 阶段枚举（不可扩展） |
| ForgingPipelineState | `forgemind/forging/pipeline.py` | 流水线状态（current_stage/stage_artifacts/stage_history） |
| ForgingManifest | `forgemind/forging/pipeline.py` | 锻造清单（YAML 配置驱动） |
| StageHandler | `forgemind/forging/handlers/` | 阶段处理器抽象（每阶段一个 handler） |
| SpeciesDefineHandler | `forgemind/forging/handlers/species_define.py` | ①形态定义（operator 审批 + SpeciesRegistry） |
| CapabilityInjectHandler | `forgemind/forging/handlers/capability_inject.py` | ②能力注入（F001 CapabilityProfile） |
| MemorySeedHandler | `forgemind/forging/handlers/memory_seed.py` | ③记忆初始化（F014 EchoStore） |
| ValueAlignHandler | `forgemind/forging/handlers/value_align.py` | ④价值观对齐（operator 审批 + ValueCharter） |
| CapabilityVerifyHandler | `forgemind/forging/handlers/capability_verify.py` | ⑤能力验证（F018 Eval Contract） |
| AwakeningPromoteHandler | `forgemind/forging/handlers/awakening_promote.py` | ⑥觉醒晋升（operator 审批 + 觉醒阶上限） |
| ForgingConfig | `forgemind/config/forging.yaml` | 6 阶段 YAML 配置（外置） |

### 3.2 接口契约

```python
from abc import ABC, abstractmethod
from typing import Optional
from pydantic import BaseModel, Field
from enum import Enum
from datetime import datetime


class ForgingStage(str, Enum):
    """锻造 6 步（FM-006）"""
    SPECIES_DEFINE = "species_define"          # ①形态定义
    CAPABILITY_INJECT = "capability_inject"    # ②能力注入
    MEMORY_SEED = "memory_seed"                # ③记忆初始化
    VALUE_ALIGN = "value_align"                # ④价值观对齐
    CAPABILITY_VERIFY = "capability_verify"    # ⑤能力验证
    AWAKENING_PROMOTE = "awakening_promote"    # ⑥觉醒晋升


class AwakeningStage(str, Enum):
    """觉醒阶（Awakening Stage，自主性 6 级，spec.md §2.5.2）
    三标注：中文 / 英文 / AI 业界概念
    """
    A1_INITIATION = "A1_initiation"        # A1 灵启阶（Initiation / Bootstrapped）
    A2_DAILY_USE = "A2_daily_use"          # A2 日常阶（Daily Use / L1 Reactive）
    A3_AUTONOMOUS = "A3_autonomous"        # A3 自主阶（Autonomous / L2 Tool-Using）
    A4_PROACTIVE = "A4_proactive"          # A4 主动阶（Proactive / L3 Self-Improving）
    A5_SUPER_EVOLVING = "A5_super_evolving"  # A5 超进化阶（Super Evolving / L4 Self-Evolving）
    A6_FORGEMIND = "A6_forgemind"          # A6 ForgeMind 阶（ForgeMind / L5 General-Purpose Agent）


class StageTransition(BaseModel):
    """阶段转换日志"""
    from_stage: ForgingStage
    to_stage: ForgingStage
    transition_at: datetime
    artifact_id: str
    operator_approved: bool = False


class ForgingPipelineState(BaseModel):
    """锻造流水线状态"""
    pipeline_id: str
    forgekin_id: str
    operator_id: str
    current_stage: ForgingStage
    species: str                              # 来自 F027
    capability_profile_ref: str               # 来自 F001
    soul_imprint_ref: str                     # SoulImprint（身份锚点）
    stage_artifacts: dict[ForgingStage, str]  # 每阶段产出物 ID
    started_at: datetime
    stage_history: list[StageTransition] = Field(default_factory=list)


class ForgingManifest(BaseModel):
    """锻造清单（YAML 配置驱动）"""
    species: str                              # ForgekinSpecies
    seed_capabilities: list[str]              # 能力包 ID
    seed_memories: list[str]                  # 初始EchoStore ID
    value_anchors: list[str]                  # 价值锚点（不可被 Eval 修改）
    verification_tasks: list[str]             # 能力验证任务
    target_awakening_stage: AwakeningStage
    max_awakening_stage: AwakeningStage = AwakeningStage.A2_DAILY_USE  # operator 授权上限


class StageHandler(ABC):
    """阶段处理器抽象（每阶段一个 handler，DI 注入）"""

    @abstractmethod
    async def execute(self, state: ForgingPipelineState) -> str:
        """执行阶段处理，返回 artifact_id"""
        ...

    @abstractmethod
    async def requires_operator_approval(self) -> bool:
        """是否需要 operator 审批"""
        ...


class ForgingExecutor(ABC):
    """锻造流水线执行器"""

    @abstractmethod
    async def start(
        self, manifest: ForgingManifest, operator_id: str
    ) -> str:
        """启动流水线，返回 pipeline_id"""
        ...

    @abstractmethod
    async def advance(self, pipeline_id: str) -> ForgingStage:
        """推进到下一阶段（含审批门 + Eval 硬门 + 回滚）"""
        ...

    @abstractmethod
    async def get_state(
        self, pipeline_id: str
    ) -> ForgingPipelineState:
        """获取流水线当前状态"""
        ...

    @abstractmethod
    async def rollback_to(
        self, pipeline_id: str, target_stage: ForgingStage
    ) -> None:
        """回滚到指定阶段（如 ⑤ 失败回滚到 ②）"""
        ...
```

### 3.3 数据流

```
[1] operator 提交 ForgingManifest（YAML）
    |-- species: virtual
    |-- seed_capabilities: [writing, reasoning]
    |-- seed_memories: [initial_echo_001]
    |-- value_anchors: [honesty, no_harm]
    |-- verification_tasks: [write_500_words, reason_puzzle]
    `-- target_awakening_stage: A3_AUTONOMOUS
    `-- max_awakening_stage: A3_AUTONOMOUS
            |
            v
[2] ForgingExecutor.start(manifest, operator_id)
    `--> 创建 ForgingPipelineState (current_stage=①)
            |
            v
[3] ① SpeciesDefineHandler.execute(state)
    |-- SpeciesRegistry.get(species=virtual) -> SpeciesProfile
    |-- operator approval (require_operator_approval=true)
    `--> artifact_id=species_spec_001
            |
            v
[4] ② CapabilityInjectHandler.execute(state)
    |-- CapabilityProfileRepository.inject(seed_capabilities)
    `--> artifact_id=capability_profile_001
            |
            v
[5] ③ MemorySeedHandler.execute(state)
    |-- EchoStoreRepository.seed_initial_memories(seed_memories)
    `--> artifact_id=initial_echo_set_001
            |
            v
[6] ④ ValueAlignHandler.execute(state)
    |-- ValueCharter.create(value_anchors)
    |-- operator approval (require_operator_approval=true)
    `--> artifact_id=value_charter_001
            |
            v
[7] ⑤ CapabilityVerifyHandler.execute(state)
    |-- EvalContract.run(verification_tasks)
    |-- if eval_score >= 0.85: artifact_id=verify_report_001
    `-- else: rollback_to(② CAPABILITY_INJECT)
            |
            v
[8] ⑥ AwakeningPromoteHandler.execute(state)
    |-- assert target_awakening_stage <= max_awakening_stage
    |-- operator approval (require_operator_approval=true)
    `--> artifact_id=awakening_certificate_001
    `--> forgekin.evolution_stage = E2_AWAKEN
    `--> forgekin.awakening_stage = A3_AUTONOMOUS
            |
            v
[9] 持久化到 F008 Durable State Surfaces
    `--> forgekin + mind_imprint + capability_profile + value_charter
            |
            v
[10] ForgekinMarketplace.publish(forgekin) [可选, F037]
     `--> ForgekinLineage.append(forgekin_id, parent=null) [F038]
```

---

## 4. 跨模块协作

### 4.1 上游依赖

- **依赖 F026 forgemind 应用层**：流水线宿主目录由 forgemind 提供。
- **依赖 F027 形态分类**：第 ① 步调用 SpeciesRegistry.get(species) 加载形态属性。
- **依赖 F001 CapabilityProfile**：第 ② 步注入能力画像。
- **依赖 F014 Memory Collection**：第 ③ 步初始化多域记忆联邦。
- **依赖 F018 Eval Contract**：第 ⑤ 步能力验证硬门。
- **依赖 F008 Durable State Surfaces**：所有 artifact 持久化目标。

### 4.2 下游影响

- **影响 F037 Forgekin 市场**：流水线第 ⑥ 步觉醒晋升后Forgekin可发布到市场。
- **影响 F038 进化谱系**：流水线产出的 Forgekin 作为谱系起点。
- **影响 F035 能力融合**：流水线产出的 CapabilityProfile 是 F035 能力融合的目标画像。
- **影响 F039 MindCodex可检索知识库**：流水线第 ③ 步初始EchoStore可作为MindCodex种子条目。

### 4.3 跨模块不变量

- ForgingStage 枚举必须固定 6 阶段，禁止运行时新增阶段。
- StageHandler 必须通过 DI 容器注入，ForgePipeline 禁止直接实例化 handler。
- ①④⑥阶段审批门必须 operator 显式批准，禁止自动跳过。
- ⑤能力验证必须通过 F018 Eval Contract 评估，质量分 < 0.85 时必须回滚到 ②。
- 觉醒阶晋升必须不超过 ForgingManifest.max_awakening_stage 授权范围。
- 阶段 artifact 必须写入 F008 持久状态层，未写入时阶段视为未完成。

---

## 5. 架构验收

### 5.1 架构契约验收

- [ ] AC-1: 单向依赖通过 —— ForgingExecutor 仅依赖 F001/F008/F014/F018/F027，无 *Forge 反向 import。
- [ ] AC-2: DI 容器注入通过 —— StageHandler 通过 DI 容器注入到 ForgingExecutor。
- [ ] AC-3: Repository 层通过 —— artifact 通过 Repository 写入 F008，无直接数据库操作。
- [ ] AC-4: 配置驱动通过 —— 6 阶段配置 YAML 外置到 `forgemind/config/forging.yaml`。
- [ ] AC-5: 审批门通过 —— ①④⑥阶段 require_operator_approval=true 时必须等待 operator 批准。

### 5.2 架构不变量验收

- [ ] AC-6: 6 阶段严格顺序不变量通过 —— 跳过任何阶段的 advance 调用被拒绝。
- [ ] AC-7: Eval 硬门不变量通过 —— ⑤阶段 Eval 分数 < 0.85 时禁止进入 ⑥，必须回滚到 ②。
- [ ] AC-8: 觉醒阶上限不变量通过 —— ⑥目标觉醒阶超过 max_awakening_stage 时被拒绝。
- [ ] AC-9: 阶段 artifact 解耦不变量通过 —— StageHandler 无法直接调用下一阶段，必须通过 ForgingExecutor.advance。
- [ ] AC-10: 回滚机制不变量通过 —— rollback_to(②) 调用后流水线状态 current_stage 回到 ②，③④⑤artifact 失效。
- [ ] AC-11: 持久化不变量通过 —— 流水线完成后所有 artifact 在 F008 中可查询。

---

## 6. 引用

- [doc:../spec.md#§3.9]（FR-CORE-009）
- [doc:../spec.md#§2.5]（进化阶/觉醒阶三标注）
- [doc:../arch.md#§3.9]（ForgePipeline 锻造流水线 6 步）
- [doc:../features/F028-forging-pipeline.md]（同号 Feature 级 SRS）
- [doc:../features/F026-forgemind-app-layer.md]
- [doc:../features/F027-all-things-spirit-species.md]
- [doc:../features/F001-capability-profile.md]
- [doc:../features/F008-durable-state-surfaces.md]
- [doc:../features/F014-memory-collection.md]
- [doc:../features/F018-eval-contract.md]
- [doc:../features/F037-forgemind-marketplace.md]
- [doc:../features/F038-forgemind-lineage.md]
- [doc:../decisions/013-all-things-spirit-mind-vision.md]
- [doc:../design/naming-contract.md]（Forge Nurturing + SoulImprint + 觉醒阶）
- [doc:../../../hiclaw/rules.md#第十一部分]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（6 阶段流水线 + 审批门 + Eval 硬门 + 回滚机制架构） | 架构师 Forgekin（猫头鹰·鲁班） |
