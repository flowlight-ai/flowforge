# Feature F036: forgemind 与 *Forge 关系

> **状态**: draft
> **版本**: v0.1
> **依赖**: [doc:review/review.md#FM-005] + [doc:roleagent.md#第0章]
> **关联 ADR**: [doc:decisions/005-forgemind-application-layer.md]
> **类型**: forgemind
> **创建日期**: 2026-07-17
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.8]（FR-CORE-008，与本文档同号对应）
> **对应 arch.md**: [doc:../arch.md#§3.8]（待创建）
> **对应 design.md**: [doc:../design.md#§3.8]（待创建）

---

## 1. 概述（Overview）

forgemind 与 *Forge 关系是 forgemind 应用层的架构定位：operator 指出"flowforge 是自进化框架核心，forgemind 是 flowforge 的应用层项目，其他 *Forge 是垂直复杂领域中养的Forgekin"。本 Feature 定义 forgemind（通用Forgekin承载）与 *Forge（垂直Forgekin承载）的关系——通用Forgekin可"进化"为垂直Forgekin，垂直Forgekin可"回炉"成为通用Forgekin的能力沉淀。实现关系模型、进化/回炉协议、与 F028 锻造流水线联动。

这是 Build to Persist 基础设施——编码"通用 ↔ 垂直"双向流通的工程规则。

## 2. 动机（Motivation）

`[doc:review/review.md#FM-005]` 指出：v7.0 未定义 forgemind（通用Forgekin）与 *Forge（垂直Forgekin）的关系——是父子继承？还是平级协作？通用Forgekin如何"进化"为垂直Forgekin？垂直Forgekin如何"回炉"成为通用Forgekin的能力沉淀？operator 明确："其他的 *Forge 是我们更多垂直复杂的领域中养的Forgekin，flowforge 的通用的Forgekin就是在 forgemind 中承载"。

不做这个 Feature，F028 锻造流水线无"通用→垂直"分支，F037 Forgekin市场无"通用 vs 垂直"分类，F038 进化谱系无跨层级血缘。这是 forgemind 应用层与 *Forge 协作的架构底座。

## 3. 详细设计（Detailed Design）

### 3.1 数据模型

```python
class ForgeLayer(BaseModel):
    """Forgekin承载层（动态注册，不硬编码具体 *Forge 项目名）"""
    layer_id: str                              # 如 "forgemind" 或由 Plugin V3 注册的 *Forge 项目名
    role: Literal["general", "vertical"]       # 通用承载层 / 垂直承载层
    vertical_skills: list[str] = []            # 垂直领域技能包（仅 vertical 层有）
    can_evolve_to: list[str] = []              # 可进化到的目标层 ID 列表
    can_reclaim_to: str | None = None          # 可回炉到的目标层 ID

class ForgeRelationship(BaseModel):
    """forgemind 与 *Forge 关系"""
    forgekin_id: str
    current_layer_id: str                       # 当前承载层 ID
    origin_layer_id: str                        # 原始承载层 ID
    evolution_history: list[LayerTransition]    # 跨层迁移历史
    capability_snapshot_per_layer: dict[str, str]  # 每层能力画像快照（key 为 layer_id）

class LayerTransition(BaseModel):
    """跨层迁移记录（进化 or 回炉）"""
    transition_id: str
    forgekin_id: str
    from_layer_id: str
    to_layer_id: str
    transition_type: Literal["evolve", "reclaim"]  # 进化 / 回炉
    trigger_reason: str
    operator_approved: bool
    timestamp: datetime
    capability_delta: dict                        # 能力差异
```

> **设计原则**：FlowForge 核心层不硬编码具体 *Forge 项目名。所有垂直承载层通过 Plugin V3 协议动态注册（详见 ADR 005 + F026）。`ForgeLayer` 改为数据模型（非枚举），`layer_id` 由 *Forge 业务项目在 Plugin 注册时声明。

### 3.2 核心接口

```python
class ForgeRelationshipManager(ABC):
    """forgemind 与 *Forge 关系管理器"""
    @abstractmethod
    async def get_relationship(self, forgekin_id: str) -> ForgeRelationship: ...

    @abstractmethod
    async def request_evolve_to_vertical(
        self, forgekin_id: str, target: ForgeLayer, reason: str
    ) -> str:
        """通用Forgekin进化为垂直Forgekin（需 operator 批准）"""
        ...

    @abstractmethod
    async def request_reclaim_to_forgemind(
        self, forgekin_id: str, reason: str
    ) -> str:
        """垂直Forgekin回炉为通用Forgekin（能力沉淀到通用层）"""
        ...

    @abstractmethod
    async def execute_transition(self, transition_id: str) -> LayerTransition: ...
```

### 3.3 关键算法

- **通用 → 垂直（进化）**：forgemind 通用Forgekin在垂直领域积累足够经验（Eval ≥ 0.85 + 5+ 任务）后，可进化为对应 *Forge 垂直Forgekin。能力画像从通用层复制到垂直层，新增垂直领域 SkillPackage。
- **垂直 → 通用（回炉）**：垂直 Forgekin 的通用能力（非垂直特定）通过 SpiritForge 蒸馏回 forgemind 通用层，作为通用 SkillPackage 供其他 Forgekin 复用。垂直特定能力保留在垂直层。
- **跨层血缘追踪**：所有 LayerTransition 写入 F038 进化谱系，保持血缘可追溯。
- **operator 关键审批**：跨层迁移必须 operator 批准，防止Forgekin擅自迁移导致能力丢失。

### 3.4 配置外置（YAML 示例）

```yaml
forge_relationship:
  # 通用承载层（forgemind 自身，固定存在）
  layers:
    forgemind:
      role: general                       # 通用承载层
      can_evolve_to: []                   # 由 Plugin V3 注册时动态填充（注册的 *Forge 项目 ID 列表）
  # 垂直承载层由 *Forge 业务项目通过 Plugin V3 协议动态注册，配置示例：
  # <forge_project_id>:
  #   role: vertical
  #   can_reclaim_to: forgemind
  #   vertical_skills: [<domain-specific-skills>]
  transition_rules:
    evolve:
      min_eval_score: 0.85
      min_task_count: 5
      require_operator_approval: true
    reclaim:
      distill_general_only: true          # 仅蒸馏通用能力
      preserve_vertical_in_original: true # 垂直能力保留原层
      require_operator_approval: true
```

## 4. 验收标准（Acceptance Criteria）

- [ ] AC-1: ForgeLayer 数据模型完整（forgemind 通用层 + 动态注册的垂直层）
- [ ] AC-2: 通用 → 垂直进化需 Eval ≥ 0.85 + 5+ 任务
- [ ] AC-3: 垂直 → 通用回炉仅蒸馏通用能力，保留垂直能力
- [ ] AC-4: 跨层迁移必须 operator 批准
- [ ] AC-5: 所有 LayerTransition 写入 F038 进化谱系

## 5. 测试策略

### 5.1 单元测试

- 关系模型校验、进化/回炉触发条件、能力差异计算、血缘追踪。

### 5.2 集成测试

- 接入 F028 锻造流水线、F001 能力画像、F038 进化谱系、F018 Eval Contract。

### 5.3 E2E 测试（必须遵守 T1-T8 测试铁律）

- 真实 operator 在 forgemind 锻造通用写作Forgekin，完成 5+ 内容创作任务（Eval ≥ 0.85）后申请进化到某个已注册的 *Forge 垂直承载层，验证能力画像迁移、血缘记录。再触发回炉到 forgemind，验证通用能力沉淀、垂直能力保留。**遵守 T1-T8**：真实 LLM、真实数据、真实工具调用。

## 6. 引用

- [doc:roleagent.md#第0章]
- [doc:review/review.md#第九章/FM-005]
- [doc:decisions/005-forgemind-application-layer.md]
- [doc:design/naming-contract.md#2.1]（ForgeMind）
- [doc:design/naming-contract.md#2.2]（Forgekin Forgekin）
- [doc:features/F001-capability-profile.md]
- [doc:features/F028-forging-pipeline.md]
- [doc:features/F037-forgemind-marketplace.md]
- [doc:features/F038-forgemind-lineage.md]
- [doc:project_rules.md#T1-T8]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
