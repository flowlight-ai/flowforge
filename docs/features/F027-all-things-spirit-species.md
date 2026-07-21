# Feature F027: 可进化智能体形态分类

> **状态**: draft
> **版本**: v0.1
> **依赖**: [doc:review/review.md#FM-003] + [doc:roleagent.md#第0章]
> **关联 ADR**: [doc:decisions/013-all-things-spirit-mind-vision.md]
> **类型**: forgemind
> **创建日期**: 2026-07-17
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.8]（FR-CORE-008，与本文档同号对应）
> **对应 arch.md**: [doc:../arch.md#§3.8]（待创建）
> **对应 design.md**: [doc:../design.md#§3.8]（待创建）

---

## 1. 概述（Overview）

可进化智能体形态分类（Forgekin Species）是 forgemind 应用层的基础：operator 愿景"锻造可进化智能体"要求Forgekin不限于数字业务场景，而要扩展到生物/组织/物品/虚拟/混合五大形态。本 Feature 定义五大形态的枚举、形态属性、形态可进化规则，作为 F028 锻造流水线、F029 物理传感器接入、F030 虚拟世界设定层的形态学锚点。

这是 Build to Persist 基础设施——编码"形态即接口"的工程规则，形态决定物理接入方式与虚拟设定层。

## 2. 动机（Motivation）

`[doc:review/review.md#FM-003]` 指出：v7.0 无形态分类设计，MindProfile 中无 species 字段，Forgekin只能用于内容/代码/小说/电商四个业务场景，无法扩展到物理世界各类实体。operator 愿景对标动物养育范式（前期验证），FlowForge 应锻造可进化智能体——动物/组织/物品/虚拟角色/混合实体。

不做这个 Feature，F028 锻造流水线不知道"要锻造什么形态"，F029 物理传感器接入层无形态对应，F030 虚拟世界设定层无 VirtualForgekin 承载对象。这是可进化智能体愿景的形态学底座。

## 3. 详细设计（Detailed Design）

### 3.1 数据模型

```python
class ForgekinSpecies(str, Enum):
    """ForgekinSpecies 五大形态（见 naming-contract.md §2.3）"""
    BIO = "bio"               # BioForgekin 生物形态（动物/植物）
    ORG = "org"               # OrgForgekin 组织形态（公司/团队/社区）
    OBJ = "obj"               # ObjForgekin 物品形态（桌椅/灯具/车辆）
    VIRTUAL = "virtual"       # VirtualForgekin 虚拟形态（童话/神话/历史/游戏角色）
    HYBRID = "hybrid"         # HybridForgekin 混合形态（VR/AR 实体）

class SpeciesProfile(BaseModel):
    """形态属性"""
    species: ForgekinSpecies
    physical_coupling: Literal["none", "sensor_only", "actuator", "full_embodied"]
    virtual_world_required: bool              # VirtualForgekin / HybridForgekin 为 True
    sensor_channels: list[str]                # 形态所需传感器（F029）
    world_setting_ref: Optional[str]          # 虚拟世界设定 ID（F030）
    evolution_targets: list[ForgekinSpecies]  # 可进化到的形态

class SpeciesEvolutionRecord(BaseModel):
    """形态进化记录（如 BioForgekin → HybridForgekin）"""
    from_species: ForgekinSpecies
    to_species: ForgekinSpecies
    triggered_at: datetime
    operator_approved: bool                   # 形态进化需 operator 批准
    capability_snapshot_before: dict
    capability_snapshot_after: dict
```

### 3.2 核心接口

```python
class SpeciesRegistry(ABC):
    """形态注册表（声明式 YAML 配置驱动）"""
    @abstractmethod
    async def register(self, profile: SpeciesProfile) -> str: ...
    @abstractmethod
    async def get(self, species: ForgekinSpecies) -> SpeciesProfile: ...
    @abstractmethod
    async def list_evolution_paths(self, species: ForgekinSpecies) -> list[ForgekinSpecies]: ...

class SpeciesEvolutionGuard:
    """形态进化守卫（不可绕过 operator 审批）"""
    async def request_evolution(self, forgekin_id: str, target: ForgekinSpecies) -> str: ...
    async def approve_evolution(self, request_id: str, operator_id: str) -> None: ...
    async def apply_evolution(self, request_id: str) -> SpeciesEvolutionRecord: ...
```

### 3.3 关键算法

- **形态可进化**：BioForgekin → HybridForgekin（加装传感器后）；VirtualForgekin → HybridForgekin（接入物理实体后）；OBJ → HYBRID（家具加 IoT 后）。ORG 形态不可降级为 BIO/OBJ。
- **形态决定接入层**：BIO/OBJ/HYBRID 必接 F029 物理传感器；VIRTUAL/HYBRID 必接 F030 虚拟世界设定层。
- **形态进化需 operator 批准**：防止Forgekin擅自切换形态导致身份漂移（与 F038 谱系追踪联动）。

### 3.4 配置外置（YAML 示例）

```yaml
forgekin_species:
  bio:
    physical_coupling: sensor_only
    sensor_channels: [camera, microphone, temperature, location]
    evolution_targets: [hybrid]
  virtual:
    physical_coupling: none
    virtual_world_required: true
    evolution_targets: [hybrid]
  hybrid:
    physical_coupling: full_embodied
    sensor_channels: [camera, microphone, imu, gps, depth]
    virtual_world_required: true
    evolution_targets: []  # 顶态，不再进化
```

## 4. 验收标准（Acceptance Criteria）

- [ ] AC-1: 五大形态枚举完整（BIO/ORG/OBJ/VIRTUAL/HYBRID）
- [ ] AC-2: SpeciesProfile 物理耦合度与虚拟世界需求字段完整
- [ ] AC-3: 形态进化路径可配置且需 operator 批准
- [ ] AC-4: 形态字段写入SoulImprint（Soul Imprint）的命名空间，作为身份锚点
- [ ] AC-5: 形态注册表通过 YAML 配置驱动（禁止硬编码形态）

## 5. 测试策略

### 5.1 单元测试

- 五大形态枚举完整性、形态属性校验、进化路径合法性。

### 5.2 集成测试

- 接入 F028 锻造流水线（形态定义步骤）、F029 传感器接入、F030 虚拟世界设定层。

### 5.3 E2E 测试（必须遵守 T1-T8 测试铁律）

- 真实 operator 锻造一个 BioForgekin（如家猫Forgekin），验证形态字段贯穿SoulImprint、能力画像、记忆联邦。再触发 BioForgekin → HybridForgekin 形态进化，验证 operator 审批流程。**遵守 T1-T8**：真实 LLM、真实数据、真实工具调用。

## 6. 引用

- [doc:roleagent.md#第0章]
- [doc:review/review.md#第九章/FM-003]
- [doc:decisions/013-all-things-spirit-mind-vision.md]
- [doc:design/naming-contract.md#2.3]（Forgekin Species 智能体形态学）
- [doc:features/F028-forging-pipeline.md]
- [doc:features/F029-physical-ai-sensors.md]
- [doc:features/F030-virtual-world-setting.md]
- [doc:features/F038-forgemind-lineage.md]
- [doc:project_rules.md#T1-T8]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
