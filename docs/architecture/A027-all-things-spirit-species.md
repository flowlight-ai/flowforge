# A027: 多形态智能体形态分类架构设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.8] + [doc:../spec.md#§2.6]（5 种形态分类）
> **对应 arch.md**: [doc:../arch.md#§3.8]
> **对应 design.md**: [doc:../design.md#§3.8]（待创建）
> **对应 Feature**: [doc:../features/F027-all-things-spirit-species.md]（同号 Feature 级 SRS）
> **对应详细设计**: [doc:../design/D027-all-things-spirit-species.md]（待创建，同号 Feature 级 SDD）
> **依赖 ADR**: [doc:../decisions/013-all-things-spirit-mind-vision.md]

---

## 1. 架构上下文

### 1.1 架构问题

forgemind 应用层需要承载多形态智能体（Multi-Form Agent）实践场，但 v7.0 的 MindProfile 中无 species 字段，Forgekin仅能用于内容/代码/小说/电商四个数字业务场景，无法扩展到物理世界与虚拟角色。本架构在 forgemind 内部建立形态分类层，解决以下架构层问题：

1. **形态分类无统一抽象**：BIO/ORG/OBJ/VIRTUAL/HYBRID 五种形态散落在不同模块，无 SpeciesRegistry 统一注册。
2. **形态决定接入层关系未编码**：BIO/OBJ/HYBRID 必须接入物理传感器（F029）；VIRTUAL/HYBRID 必须接入虚拟世界设定层（F030），但 v7.0 无此形态门控。
3. **形态可进化路径未约束**：BioForgekin -> HybridForgekin（加装传感器）、VirtualForgekin -> HybridForgekin（接入物理实体）等进化路径未编码，存在身份漂移风险。
4. **形态字段未贯穿SoulImprint**：形态属性未写入SoulImprint（SoulImprint）命名空间，无法作为身份锚点。

### 1.2 架构约束

- **单向依赖约束**：SpeciesRegistry 必须单向依赖 core/config 与 core/interfaces，禁止反向依赖 *Forge 业务模块。
- **配置驱动约束**：5 形态的 physical_coupling / virtual_world_required / sensor_channels / evolution_targets 必须 YAML 外置到 `forgemind/config/species.yaml`。
- **形态门控约束**：BIO/OBJ/HYBRID 形态的Forgekin必须绑定至少一个传感器通道（F029），VIRTUAL/HYBRID 形态的Forgekin必须绑定一个 world_setting_id（F030）。
- **形态进化审批约束**：形态进化（如 BIO -> HYBRID）必须经 operator 显式批准，禁止Forgekin擅自切换形态导致身份漂移。
- **SoulImprint不可变约束**：species 字段写入SoulImprint后，形态进化记录追加到 ForgekinLineage，原 species 字段不修改（保留血缘痕迹）。

### 1.3 架构影响

- **对 F028 锻造流水线的影响**：流水线第 ① 步"形态定义"必须从 SpeciesRegistry 加载形态属性，禁止 .py 硬编码形态枚举。
- **对 F029 物理 AI 传感器的影响**：SensorRegistry 在 bind 时必须调用 SpeciesRegistry.get(species) 验证形态门控，VIRTUAL 形态绑定被拒绝。
- **对 F030 虚拟世界设定层的影响**：WorldSetting 在加载时必须校验 forgekin.species 是否在 [VIRTUAL, HYBRID] 范围内。
- **对 F038 进化谱系的影响**：SpeciesEvolutionRecord 写入 ForgekinLineage，作为形态进化血缘证据。
- **对 F001 能力画像的影响**：CapabilityProfile 必须包含 species 字段，能力匹配时考虑形态约束（如 BIO 形态优先匹配物理交互能力）。

---

## 2. 架构设计

### 2.1 组件架构图

```
                    +-------------------------------------------------+
                    |             forgemind/species/                  |
                    |                                                 |
                    |  +-------------------+                          |
                    |  | ForgekinSpecies   |  5 形态枚举（BIO/ORG/OBJ  |
                    |  | (Enum)            |  /VIRTUAL/HYBRID）        |
                    |  +---------+---------+                          |
                    |            |                                    |
                    |            v                                    |
                    |  +-------------------+   +-------------------+ |
                    |  | SpeciesProfile    |<->| SpeciesRegistry   | |
                    |  | (形态属性)         |   | (YAML 配置驱动)   | |
                    |  +---------+---------+   +---------+---------+ |
                    |            |                       |           |
                    |            v                       v           |
                    |  +-------------------+   +-------------------+ |
                    |  | SpeciesEvolution  |   | SpeciesEvolution  | |
                    |  | Record            |-->| Guard             | |
                    |  | (形态进化记录)     |   | (operator 审批)   | |
                    |  +-------------------+   +-------------------+ |
                    +-------------------------------------------------+
                                          |
                +-------------------------+-------------------------+
                |                         |                         |
                v                         v                         v
    +-----------------------+   +-----------------------+   +-----------------------+
    | F029 SensorRegistry   |   | F030 WorldSetting     |   | F038 ForgekinLineage  |
    | (形态门控：仅          |   | (形态门控：仅          |   | (形态进化血缘         |
    |  BIO/OBJ/HYBRID)      |   |  VIRTUAL/HYBRID)      |   |  追踪)                |
    +-----------------------+   +-----------------------+   +-----------------------+
                |                         |
                v                         v
    +-----------------------+   +-----------------------+
    | BIO 形态Forgekin         |   | VIRTUAL 形态Forgekin    |
    | OBJ 形态Forgekin         |   | HYBRID 形态Forgekin     |
    | (Embodied AI 路径)    |   | (Character AI 路径)   |
    +-----------------------+   +-----------------------+
```

### 2.2 关键架构决策

- **决策 1：5 形态枚举固定不可扩展（BIO/ORG/OBJ/VIRTUAL/HYBRID）**
  5 形态覆盖 AI 业界 Embodied AI（BIO/OBJ）+ Character AI（VIRTUAL）+ 组织智能体（ORG）+ 混合实体（HYBRID）全部范式。固定枚举避免Forgekin形态无限扩展导致 ForgekinBase 三方法契约失效。新增形态必须经 ADR 决策，禁止运行时动态注册。

- **决策 2：形态属性 YAML 外置 + 形态注册表单例**
  SpeciesProfile 的 physical_coupling / virtual_world_required / sensor_channels / evolution_targets 必须 YAML 外置到 `forgemind/config/species.yaml`，由 SpeciesRegistry 在启动时加载为单例。这满足配置驱动约束（架构红线第 5 条），避免 .py 硬编码形态偏好。

- **决策 3：形态门控由 SpeciesRegistry 集中校验**
  SensorRegistry.bind 与 WorldSetting.load 必须调用 SpeciesRegistry.get(species) 校验形态合法性。这避免形态门控逻辑分散在 F029/F030 各自实现中，保证形态约束全局一致。

- **决策 4：形态进化由 SpeciesEvolutionGuard 强制 operator 审批**
  形态进化（如 BIO -> HYBRID）需 request -> approve -> apply 三步，approve 必须由 operator 显式确认。这防止Forgekin擅自切换形态导致身份漂移，与 F038 ForgekinLineage 联动保留血缘痕迹。

- **决策 5：形态字段写入SoulImprint作为身份锚点**
  species 字段在创建时写入 SoulImprint，进化后原 species 保留在 imprint，新 species 写入 ForgekinLineage。这保证SoulImprint作为不可变身份锚点（架构不变量），同时通过谱系记录形态演化历史。

### 2.3 架构不变量

- 5 形态枚举必须固定为 BIO/ORG/OBJ/VIRTUAL/HYBRID，禁止运行时动态新增形态。
- SpeciesProfile 必须 YAML 外置到 `forgemind/config/species.yaml`，禁止 .py 硬编码形态属性。
- BIO/OBJ/HYBRID 形态Forgekin必须绑定至少一个传感器通道，VIRTUAL 形态Forgekin禁止绑定物理传感器。
- VIRTUAL/HYBRID 形态Forgekin必须绑定 world_setting_id，BIO/ORG/OBJ 形态Forgekin禁止绑定虚拟世界设定。
- 形态进化必须经 SpeciesEvolutionGuard.request -> approve -> apply 三步，approve 必须由 operator 显式确认。
- ORG 形态Forgekin必须不可降级为 BIO/OBJ 形态（组织不能退化为生物/物品）。
- species 字段必须写入SoulImprint（SoulImprint）作为身份锚点，形态进化记录追加到 ForgekinLineage 而非修改SoulImprint。

---

## 3. 模块设计

### 3.1 模块边界

| 模块 | 路径 | 职责 |
|------|------|------|
| ForgekinSpecies | `forgemind/species.py` | 5 形态枚举（不可扩展） |
| SpeciesProfile | `forgemind/species.py` | 形态属性数据模型（physical_coupling / virtual_world_required / sensor_channels / evolution_targets） |
| SpeciesRegistry | `forgemind/species.py` | 形态注册表单例（YAML 配置驱动） |
| SpeciesEvolutionGuard | `forgemind/species.py` | 形态进化守卫（operator 审批门） |
| SpeciesEvolutionRecord | `forgemind/species.py` | 形态进化记录数据模型（写入 F038 ForgekinLineage） |
| SpeciesConfig | `forgemind/config/species.yaml` | 5 形态属性 YAML 配置（外置） |

### 3.2 接口契约

```python
from abc import ABC, abstractmethod
from typing import Optional
from pydantic import BaseModel, Field
from enum import Enum
from datetime import datetime


class ForgekinSpecies(str, Enum):
    """多形态智能体形态分类（5 种，对应 spec.md §2.6）"""
    BIO = "bio"               # BioForgekin 生物Forgekin（Embodied AI 路径）
    ORG = "org"               # OrgForgekin 组织Forgekin
    OBJ = "obj"               # ObjForgekin 物品Forgekin（Embodied AI 路径）
    VIRTUAL = "virtual"       # VirtualForgekin 虚拟Forgekin（Character AI 路径）
    HYBRID = "hybrid"         # HybridForgekin 混合Forgekin


class PhysicalCoupling(str, Enum):
    """物理耦合度（决定传感器接入方式）"""
    NONE = "none"                       # 无物理接入（VIRTUAL）
    SENSOR_ONLY = "sensor_only"         # 仅感知（BIO 部分场景）
    ACTUATOR = "actuator"               # 含执行器（OBJ 部分场景）
    FULL_EMBODIED = "full_embodied"     # 完整合身（HYBRID）


class SpeciesProfile(BaseModel):
    """形态属性（YAML 外置）"""
    species: ForgekinSpecies
    physical_coupling: PhysicalCoupling
    virtual_world_required: bool
    sensor_channels: list[str]              # 形态所需传感器（F029 落地）
    world_setting_ref: Optional[str]        # 虚拟世界设定 ID（F030 落地）
    evolution_targets: list[ForgekinSpecies]  # 可进化到的形态


class SpeciesEvolutionRecord(BaseModel):
    """形态进化记录（写入 F038 ForgekinLineage）"""
    record_id: str
    forgekin_id: str
    from_species: ForgekinSpecies
    to_species: ForgekinSpecies
    triggered_at: datetime
    operator_approved: bool
    capability_snapshot_before: dict
    capability_snapshot_after: dict
    rationale: str                          # 形态进化理由


class SpeciesRegistry(ABC):
    """形态注册表（声明式 YAML 配置驱动，单例）"""

    @abstractmethod
    async def register(self, profile: SpeciesProfile) -> str:
        """注册形态属性（仅启动时由 YAML 加载调用）"""
        ...

    @abstractmethod
    async def get(self, species: ForgekinSpecies) -> SpeciesProfile:
        """获取形态属性（F029/F030 形态门控调用）"""
        ...

    @abstractmethod
    async def list_evolution_paths(
        self, species: ForgekinSpecies
    ) -> list[ForgekinSpecies]:
        """列出形态可进化路径（SpeciesEvolutionGuard 调用）"""
        ...

    @abstractmethod
    async def assert_sensor_allowed(
        self, species: ForgekinSpecies, channel: str
    ) -> bool:
        """校验形态是否允许绑定该传感器通道（F029 形态门控）"""
        ...

    @abstractmethod
    async def assert_world_setting_allowed(
        self, species: ForgekinSpecies
    ) -> bool:
        """校验形态是否允许绑定虚拟世界设定（F030 形态门控）"""
        ...


class SpeciesEvolutionGuard(ABC):
    """形态进化守卫（不可绕过 operator 审批）"""

    @abstractmethod
    async def request_evolution(
        self, forgekin_id: str, target: ForgekinSpecies, rationale: str
    ) -> str:
        """发起形态进化请求（返回 request_id）"""
        ...

    @abstractmethod
    async def approve_evolution(
        self, request_id: str, operator_id: str
    ) -> None:
        """operator 审批形态进化请求"""
        ...

    @abstractmethod
    async def apply_evolution(
        self, request_id: str
    ) -> SpeciesEvolutionRecord:
        """应用形态进化（写入 ForgekinLineage，返回进化记录）"""
        ...

    @abstractmethod
    async def reject_evolution(
        self, request_id: str, reason: str
    ) -> None:
        """驳回形态进化请求"""
        ...
```

### 3.3 数据流

```
[启动阶段]
    forgemind/config/species.yaml
        |
        v
    SpeciesRegistry.register(profile)  <-- 5 形态注册（仅启动时）
        |
        v
    SpeciesRegistry 单例就绪

[锻造阶段（F028 调用）]
    ForgePipeline.① 形态定义
        |
        v
    SpeciesRegistry.get(species) --> SpeciesProfile
        |
        v
    ForgekinFormData(species, sensor_channels, world_setting_id)
        |
        v
    写入SoulImprint（species 字段不可变）

[传感器绑定阶段（F029 调用）]
    SensorRegistry.bind(forgekin_id, channel)
        |
        v
    SpeciesRegistry.assert_sensor_allowed(species, channel)
        |
        +--> VIRTUAL 形态: 拒绝
        `--> BIO/OBJ/HYBRID 形态: 允许

[虚拟世界加载阶段（F030 调用）]
    WorldSetting.load(forgekin_id, world_setting_id)
        |
        v
    SpeciesRegistry.assert_world_setting_allowed(species)
        |
        +--> BIO/ORG/OBJ 形态: 拒绝
        `--> VIRTUAL/HYBRID 形态: 允许

[形态进化阶段（F038 联动）]
    SpeciesEvolutionGuard.request_evolution(forgekin, target=HYBRID)
        |
        v
    operator 审批 approve_evolution(request_id, operator_id)
        |
        v
    SpeciesEvolutionGuard.apply_evolution(request_id)
        |
        v
    SpeciesEvolutionRecord --> 写入 ForgekinLineage（F038）
        |
        v
    forgekin.species 字段更新（SoulImprint species 保留原值作为血缘痕迹）
```

---

## 4. 跨模块协作

### 4.1 上游依赖

- **依赖 F026 forgemind 应用层**：forgemind 提供 SpeciesRegistry 容器与 SpeciesEvolutionGuard 守卫的宿主目录。
- **依赖 core/config**：YAML 配置加载机制。
- **依赖 core/interfaces**：Repository 抽象（写入 ForgekinLineage 时使用）。
- **依赖 F038 ForgekinLineage**：形态进化记录持久化目标。

### 4.2 下游影响

- **影响 F028 锻造流水线**：F028 第 ① 步"形态定义"必须从 SpeciesRegistry 加载 SpeciesProfile，禁止硬编码形态。
- **影响 F029 物理 AI 传感器**：F029 的 SensorRegistry.bind 必须调用 SpeciesRegistry.assert_sensor_allowed 校验形态门控。
- **影响 F030 虚拟世界设定层**：F030 的 WorldSetting.load 必须调用 SpeciesRegistry.assert_world_setting_allowed 校验形态门控。
- **影响 F038 进化谱系**：SpeciesEvolutionRecord 写入 ForgekinLineage 作为形态进化血缘证据。
- **影响 F001 能力画像**：CapabilityProfile 包含 species 字段，能力匹配时考虑形态约束。

### 4.3 跨模块不变量

- SpeciesRegistry 必须在 FlowForge 启动时由 `forgemind/config/species.yaml` 加载完成，未加载完成时 ForgePipeline 拒绝启动锻造流程。
- 形态门控校验必须由 SpeciesRegistry 集中执行，F029/F030 禁止在各自模块内重复实现形态判断逻辑。
- 形态进化记录必须写入 F038 ForgekinLineage，未写入时形态进化视为无效。
- SoulImprint species 字段必须保留原值（即使形态进化），新 species 写入 ForgekinLineage 作为进化后状态。
- VIRTUAL 形态Forgekin必须永不可绑定物理传感器，违反即形态门控失效。

---

## 5. 架构验收

### 5.1 架构契约验收

- [ ] AC-1: 单向依赖通过 —— SpeciesRegistry 仅依赖 core/config 与 core/interfaces，无 *Forge 反向 import。
- [ ] AC-2: DI 容器注入通过 —— SpeciesRegistry 单例通过 DI 容器注入到 ForgePipeline / SensorRegistry / WorldSetting。
- [ ] AC-3: Repository 层通过 —— SpeciesEvolutionRecord 通过 ForgekinLineageRepository 写入，无直接数据库操作。
- [ ] AC-4: 配置驱动通过 —— 5 形态属性均 YAML 外置到 `forgemind/config/species.yaml`，无 .py 硬编码。
- [ ] AC-5: 形态门控通过 —— SensorRegistry 与 WorldSetting 调用 SpeciesRegistry 校验形态合法性，无重复门控逻辑。

### 5.2 架构不变量验收

- [ ] AC-6: 5 形态枚举固定不变量通过 —— ForgekinSpecies 仅含 BIO/ORG/OBJ/VIRTUAL/HYBRID 五值，运行时无法新增。
- [ ] AC-7: 形态门控不变量通过 —— VIRTUAL 形态Forgekin绑定物理传感器被拒绝，BIO 形态Forgekin绑定虚拟世界设定被拒绝。
- [ ] AC-8: 形态进化审批不变量通过 —— 未经 operator 审批的形态进化请求被拒绝应用。
- [ ] AC-9: ORG 不可降级不变量通过 —— ORG -> BIO / ORG -> OBJ 进化路径被 SpeciesRegistry.list_evolution_paths 排除。
- [ ] AC-10: SoulImprint species 不可变不变量通过 —— 形态进化后SoulImprint species 字段保留原值，新 species 仅出现在 ForgekinLineage。
- [ ] AC-11: HYBRID 顶态不变量通过 —— HYBRID 形态 evolution_targets 为空列表，不可再进化。

---

## 6. 引用

- [doc:../spec.md#§3.8] + [doc:../spec.md#§2.6]（5 形态分类）
- [doc:../arch.md#§3.8]（forgemind 应用层 + 5 种形态分类）
- [doc:../features/F027-all-things-spirit-species.md]（同号 Feature 级 SRS）
- [doc:../features/F026-forgemind-app-layer.md]
- [doc:../features/F028-forging-pipeline.md]
- [doc:../features/F029-physical-ai-sensors.md]
- [doc:../features/F030-virtual-world-setting.md]
- [doc:../features/F038-forgemind-lineage.md]
- [doc:../decisions/013-all-things-spirit-mind-vision.md]
- [doc:../design/naming-contract.md]（Forgekin Species 智能体形态学 + SoulImprint）
- [doc:../../../hiclaw/rules.md#第十一部分]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（5 形态枚举 + 形态门控 + 形态进化守卫架构） | 架构师 Forgekin（猫头鹰·鲁班） |
