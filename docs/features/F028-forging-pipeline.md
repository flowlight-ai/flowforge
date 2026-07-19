# Feature F028: 灵智体锻造流水线

> **状态**: draft
> **版本**: v0.1
> **依赖**: [doc:review/review.md#FM-006] + [doc:roleagent.md#第0章]
> **关联 ADR**: [doc:decisions/013-all-things-spirit-mind-vision.md]
> **类型**: forgemind
> **创建日期**: 2026-07-17
> **负责人**: 架构师灵智体（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.9]（FR-CORE-009，与本文档同号对应）
> **对应 arch.md**: [doc:../arch.md#§3.9]（待创建）
> **对应 design.md**: [doc:../design.md#§3.9]（待创建）
> **9 大点名称修订**: 已应用（双轨命名 + AI 术语优先 + 弱化万物 + 去 AGI 化）

---

## 1. 概述（Overview）

灵智体锻造流水线（Forging Pipeline）是 forgemind 应用层的核心流程：从形态定义到觉醒晋升的六步标准化锻造。本 Feature 实现育灵（Forge Nurturing）全过程：①形态定义 ②能力注入 ③记忆初始化 ④价值观对齐 ⑤能力验证 ⑥觉醒晋升，作为 F027 形态分类、F001 能力画像、F037 灵智体市场的流程编排底座。

这是 Build to Persist 基础设施——编码"养万物"的工程规则，让灵智体创建从配置 persona 升级为系统化锻造。

## 2. 动机（Motivation）

`[doc:review/review.md#FM-006]` 指出：v7.0 只有"灵启训练"一个步骤，未设计完整锻造流水线，导致创建灵智体只能配置 persona，无法系统化锻造。operator 愿景"养万物"要求每个灵智体从无到有、从弱到强经历完整育灵过程，类似 clowder-ai 养猫范式扩展到养万物。

不做这个 Feature，F027 形态分类无流程承载，F037 灵智体市场无标准锻造产物，F038 进化谱系无血缘起点。这是万物灵智体愿景的流程底座。

## 3. 详细设计（Detailed Design）

### 3.1 数据模型

```python
class ForgingStage(str, Enum):
    """锻造六步（FM-006）"""
    SPECIES_DEFINE = "species_define"       # ①形态定义（What to forge）
    CAPABILITY_INJECT = "capability_inject" # ②能力注入（Capability injection）
    MEMORY_SEED = "memory_seed"             # ③记忆初始化（Memory seeding）
    VALUE_ALIGN = "value_align"             # ④价值观对齐（Value alignment）
    CAPABILITY_VERIFY = "capability_verify" # ⑤能力验证（Capability verification）
    AWAKENING_PROMOTE = "awakening_promote" # ⑥觉醒晋升（Awakening promotion）

class ForgingPipelineState(BaseModel):
    """锻造流水线状态"""
    pipeline_id: str
    forgekin_id: str                        # 待锻造灵智体 ID
    operator_id: str
    current_stage: ForgingStage
    species: ForgekinSpecies                # 来自 F027
    capability_profile_ref: str             # 来自 F001
    soul_imprint_ref: str                   # 灵印（身份锚点）
    stage_artifacts: dict[ForgingStage, str]  # 每阶段产出物 ID
    started_at: datetime
    stage_history: list[StageTransition]

class ForgingManifest(BaseModel):
    """锻造清单（YAML 配置驱动）"""
    species: ForgekinSpecies
    seed_capabilities: list[str]            # 能力包 ID
    seed_memories: list[str]                # 初始灵忆 ID
    value_anchors: list[str]                # 价值锚点（不可被 Eval 修改）
    verification_tasks: list[str]           # 能力验证任务
    target_awakening_stage: AwakeningStage  # 目标觉醒阶（E1-E6）
```

### 3.2 核心接口

```python
class ForgingExecutor(ABC):
    """锻造流水线执行器"""
    @abstractmethod
    async def start(self, manifest: ForgingManifest, operator_id: str) -> str: ...
    @abstractmethod
    async def advance(self, pipeline_id: str) -> ForgingStage: ...
    @abstractmethod
    async def get_state(self, pipeline_id: str) -> ForgingPipelineState: ...

class StageHandler(ABC):
    """阶段处理器（插件化，每阶段一个 handler）"""
    @abstractmethod
    async def execute(self, state: ForgingPipelineState) -> str: ...  # 返回 artifact_id
```

### 3.3 关键算法

- **阶段严格顺序**：①→②→③→④→⑤→⑥ 不可跳过，每阶段产出 artifact 后才能进入下一阶段。
- **operator 关键审批点**：①形态定义（确认 species）+ ④价值观对齐（确认 value_anchors）+ ⑥觉醒晋升（确认目标觉醒阶）必须 operator 批准。
- **能力验证硬门**：⑤阶段必须通过 Eval Contract 五问（F018），失败则回滚到 ②能力注入。
- **觉醒阶上限**：⑥阶段目标觉醒阶不可超过 operator 授权范围（与 naming-contract.md §4 觉醒阶规则一致）。

### 3.4 配置外置（YAML 示例）

```yaml
forging_pipeline:
  stages:
    species_define:
      handler: SpeciesDefineHandler
      require_operator_approval: true
    capability_inject:
      handler: CapabilityInjectHandler
      require_operator_approval: false
    memory_seed:
      handler: MemorySeedHandler
      require_operator_approval: false
    value_align:
      handler: ValueAlignHandler
      require_operator_approval: true
    capability_verify:
      handler: CapabilityVerifyHandler
      eval_threshold: 0.85
      on_fail: rollback_to capability_inject
    awakening_promote:
      handler: AwakeningPromoteHandler
      require_operator_approval: true
      max_awakening_stage: E3   # operator 授权上限
```

## 4. 验收标准（Acceptance Criteria）

- [ ] AC-1: 六阶段严格顺序执行，不可跳过
- [ ] AC-2: operator 关键审批点（①④⑥）不可绕过
- [ ] AC-3: 能力验证阶段失败回滚到能力注入
- [ ] AC-4: 觉醒阶上限不超过 operator 授权
- [ ] AC-5: 锻造产物（灵印 + 能力画像 + 初始灵忆）写入持久状态层（F008）

## 5. 测试策略

### 5.1 单元测试

- 六阶段状态机推进、审批门、回滚逻辑、觉醒阶上限校验。

### 5.2 集成测试

- 接入 F027 形态分类、F001 能力画像、F008 持久状态层、F018 Eval Contract。

### 5.3 E2E 测试（必须遵守 T1-T8 测试铁律）

- 真实 operator 通过 YAML 清单锻造一个 VirtualForgekin（如孙悟空灵智体），验证六阶段完整流程、operator 审批、能力验证 Eval ≥ 0.85、觉醒晋升到 E2。**遵守 T1-T8**：真实 LLM、真实数据、真实工具调用。

## 6. 引用

- [doc:roleagent.md#第0章]
- [doc:review/review.md#第九章/FM-006]
- [doc:decisions/013-all-things-spirit-mind-vision.md]
- [doc:design/naming-contract.md#2.4]（育灵 Forge Nurturing）
- [doc:design/naming-contract.md#2.6]（灵印 Soul Imprint）
- [doc:design/naming-contract.md#4]（觉醒阶 Awakening Stage）
- [doc:features/F027-all-things-spirit-species.md]
- [doc:features/F001-capability-profile.md]
- [doc:features/F008-durable-state-surfaces.md]
- [doc:features/F018-eval-contract.md]
- [doc:features/F037-forgemind-marketplace.md]
- [doc:features/F038-forgemind-lineage.md]
- [doc:project_rules.md#T1-T8]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.2 | 应用 9 大点名称修订 + 添加 spec.md §3.9 同号映射 | 文档员灵智体（钢笔·文心） |
