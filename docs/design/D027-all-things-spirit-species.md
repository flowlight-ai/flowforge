# D027: 多形态智能体形态分类详细设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 开发者灵智体（猎犬·夏洛克）
> **对应 spec.md**: [doc:../spec.md#§3.8] + [doc:../spec.md#§2.6]（5 种形态分类）
> **对应 arch.md**: [doc:../arch.md#§3.8]
> **对应 design.md**: [doc:../design.md#§3.8]
> **对应 Feature**: [doc:../features/F027-all-things-spirit-species.md]（同号 Feature 级 SRS）
> **对应 Architecture**: [doc:../architecture/A027-all-things-spirit-species.md]（同号 Feature 级 SAD）
> **依赖 ADR**: [doc:../decisions/013-all-things-spirit-mind-vision.md]
> **9 大点名称修订**: 已应用（双轨命名 + AI 术语优先 + 弱化万物 + 去 AGI 化）

---

## 1. 详细设计上下文

### 1.1 设计问题

A027 架构设计已确定在 forgemind 内部建立形态分类层，承载多形态智能体（Multi-Form Agent）的 5 形态枚举（BIO/ORG/OBJ/VIRTUAL/HYBRID）与形态门控逻辑。本详细设计进一步下沉到代码层，需要解决以下子问题：

1. **SpeciesProfile 物理字段的精确定义**：physical_coupling / virtual_world_required / sensor_channels / evolution_targets 四字段的取值范围、必填规则、跨字段一致性校验。
2. **形态门控的快速路径实现**：`assert_sensor_allowed` / `assert_world_setting_allowed` 两个高频调用如何在 < 1ms 内完成（避免每次传感器绑定都查 YAML）。
3. **形态进化路径表的存储与查询**：5×5 形态进化矩阵如何用静态字典表达 + 运行时不可变性保证 + HYBRID 顶态约束。
4. **SpeciesEvolutionGuard 三步审批的状态机**：request -> approve -> apply 三步状态转换、超时回收、operator 审批令牌机制。
5. **形态进化与灵印的协同**：灵印 species 字段不可变，形态进化后新 species 如何写入 ForgekinLineage 而不修改灵印。
6. **ORG 不可降级约束的实现**：ORG -> BIO / ORG -> OBJ 进化路径如何在 SpeciesRegistry.list_evolution_paths() 中排除。
7. **SpeciesRegistry 单例的启动加载顺序**：YAML 加载必须在 ForgePipeline 启动前完成，未加载完成时如何阻塞锻造流程。

### 1.2 设计约束

- **单向依赖约束**：`forgemind/species.py` 必须单向依赖 `core/config` 与 `core/interfaces`，禁止反向依赖 *Forge 业务模块（架构红线第 12 条）。
- **DI 容器约束**：`SpeciesRegistry` 单例必须通过 DI 容器注入到 ForgePipeline / SensorRegistry / WorldSetting，禁止 `SpeciesRegistry()` 直接实例化（编程红线第 12 条）。
- **Repository 层约束**：`SpeciesEvolutionRecord` 写入必须经 `ForgekinLineageRepository`，禁止直接操作数据库（架构红线第 4 条）。
- **配置驱动约束**：5 形态的 `physical_coupling / virtual_world_required / sensor_channels / evolution_targets` 必须 YAML 外置到 `forgemind/config/species.yaml`，禁止 .py 硬编码形态属性（架构红线第 5 条）。
- **形态门控约束**：BIO/OBJ/HYBRID 形态的灵智体必须绑定至少一个传感器通道（F029）；VIRTUAL/HYBRID 形态的灵智体必须绑定一个 `world_setting_id`（F030）；VIRTUAL 形态灵智体禁止绑定物理传感器。
- **形态进化审批约束**：形态进化必须经 `SpeciesEvolutionGuard.request -> approve -> apply` 三步，approve 必须由 operator 显式确认，禁止灵智体擅自切换形态导致身份漂移。
- **灵印不可变约束**：species 字段写入灵印后保留原值，形态进化记录追加到 ForgekinLineage，原 species 字段不修改（保留血缘痕迹）。
- **ORG 不可降级约束**：ORG 形态灵智体不可降级为 BIO/OBJ 形态（组织不能退化为生物/物品）。
- **HYBRID 顶态约束**：HYBRID 形态 evolution_targets 为空列表，不可再进化。
- **5 形态枚举固定约束**：ForgekinSpecies 仅含 BIO/ORG/OBJ/VIRTUAL/HYBRID 五值，运行时无法新增，新增必须经 ADR 决策。

### 1.3 设计影响

- **对 F026 forgemind 应用层的影响**：本模块在 forgemind 目录下落地，复用 ForgekinBase / MindImprint 抽象，形态字段写入灵印作为身份锚点。
- **对 F028 锻造流水线的影响**：流水线第 ① 步"形态定义"必须从 SpeciesRegistry 加载 SpeciesProfile，禁止 .py 硬编码形态枚举。
- **对 F029 物理 AI 传感器的影响**：SensorRegistry.bind() 必须调用 SpeciesRegistry.assert_sensor_allowed() 校验形态门控，VIRTUAL 形态绑定被拒绝。
- **对 F030 虚拟世界设定层的影响**：WorldSetting.load() 必须调用 SpeciesRegistry.assert_world_setting_allowed() 校验形态门控，BIO/ORG/OBJ 形态绑定被拒绝。
- **对 F038 进化谱系的影响**：SpeciesEvolutionRecord 写入 ForgekinLineage，作为形态进化血缘证据，参与谱系追踪。
- **对 F001 能力画像的影响**：CapabilityProfile 必须包含 species 字段，能力匹配时考虑形态约束（如 BIO 形态优先匹配物理交互能力）。
- **对 DI 容器的影响**：需新增 `species_registry` / `species_evolution_guard` 两个绑定。

---

## 2. 详细设计

### 2.1 类图 ASCII

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                       <<module>> flowforge.forgemind.species                  │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  <<enum>> ForgekinSpecies          <<enum>> PhysicalCoupling                 │
│  + BIO  (生物灵智体)               + NONE           (无物理接入)             │
│  + ORG  (组织灵智体)               + SENSOR_ONLY    (仅感知)                 │
│  + OBJ  (物品灵智体)               + ACTUATOR       (含执行器)               │
│  + VIRTUAL (虚拟灵智体)            + FULL_EMBODIED  (完全合身)               │
│  + HYBRID (混合灵智体)                                                       │
│                                                                              │
│  <<model>> SpeciesProfile          <<model>> SpeciesEvolutionRecord          │
│  + species: ForgekinSpecies        + record_id: str                          │
│  + physical_coupling: PhysCoupling + forgekin_id: str                        │
│  + virtual_world_required: bool    + from_species: ForgekinSpecies           │
│  + sensor_channels: list[str]      + to_species: ForgekinSpecies             │
│  + world_setting_ref: str?         + triggered_at: datetime                  │
│  + evolution_targets: list[Spec]   + operator_approved: bool                 │
│                                    + capability_snapshot_before: dict        │
│  <<interface>> SpeciesRegistry     + capability_snapshot_after: dict         │
│  + register(profile) -> str        + rationale: str                          │
│  + get(species) -> SpeciesProfile                                            │
│  + list_evolution_paths(species)   <<interface>> SpeciesEvolutionGuard       │
│  + assert_sensor_allowed(...)      + request_evolution(...) -> request_id    │
│  + assert_world_setting_allowed()  + approve_evolution(req, operator)        │
│  + is_loaded() -> bool             + apply_evolution(req) -> record          │
│                                    + reject_evolution(req, reason)           │
│  <<model>> EvolutionRequest                                                  │
│  + request_id: str                 <<enum>> EvolutionRequestState            │
│  + forgekin_id: str                + PENDING                                 │
│  + from_species: ForgekinSpecies   + APPROVED                                │
│  + to_species: ForgekinSpecies     + REJECTED                                │
│  + state: EvolutionRequestState    + APPLIED                                 │
│  + operator_id: str?               + EXPIRED                                 │
│  + rationale: str                                                            │
│  + created_at: datetime                                                      │
│  + expires_at: datetime                                                      │
└──────────────────────────────────────────────────────────────────────────────┘
                    │
                    │ 单向依赖（DI 注入）
                    v
┌──────────────────────────────────────────────────────────────────────────────┐
│  + core/config/YamlConfigLoader（YAML 配置加载）                              │
│  + core/interfaces/Repository（ForgekinLineageRepository 抽象）               │
│  + core/tracing/get_logger                                                   │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 接口实现 Python 代码

```python
# flowforge/forgemind/species.py
from __future__ import annotations
from abc import ABC, abstractmethod
from typing import Optional
from datetime import datetime, timedelta, timezone
from pydantic import BaseModel, Field, ConfigDict, model_validator
from enum import Enum
from uuid import uuid7


class ForgekinSpecies(str, Enum):
    """多形态智能体形态分类（5 种，对应 spec.md §2.6）

    架构契约：
    - 5 形态枚举固定不可扩展，新增必须经 ADR 决策
    - 三标注：中文 / 英文 / AI 业界路径
    """
    BIO = "bio"               # BioForgekin 生物灵智体（Embodied AI 路径）
    ORG = "org"               # OrgForgekin 组织灵智体
    OBJ = "obj"               # ObjForgekin 物品灵智体（Embodied AI 路径）
    VIRTUAL = "virtual"       # VirtualForgekin 虚拟灵智体（Character AI 路径）
    HYBRID = "hybrid"         # HybridForgekin 混合灵智体


class PhysicalCoupling(str, Enum):
    """物理耦合度（决定传感器接入方式）"""
    NONE = "none"                       # 无物理接入（VIRTUAL）
    SENSOR_ONLY = "sensor_only"         # 仅感知（BIO 部分场景）
    ACTUATOR = "actuator"               # 含执行器（OBJ 部分场景）
    FULL_EMBODIED = "full_embodied"     # 完整合身（HYBRID）


# 5×5 形态进化矩阵（静态不可变，编译期确定）
# key: from_species, value: list of to_species（可进化到的形态）
_SPECIES_EVOLUTION_MATRIX: dict[ForgekinSpecies, list[ForgekinSpecies]] = {
    ForgekinSpecies.BIO: [ForgekinSpecies.HYBRID],
    ForgekinSpecies.ORG: [],  # ORG 不可降级，也不可升级（顶态之一）
    ForgekinSpecies.OBJ: [ForgekinSpecies.HYBRID],
    ForgekinSpecies.VIRTUAL: [ForgekinSpecies.HYBRID],
    ForgekinSpecies.HYBRID: [],  # HYBRID 顶态，不可再进化
}


class SpeciesProfile(BaseModel):
    """形态属性（YAML 外置，启动时加载）

    架构契约：
    - physical_coupling 决定 F029 传感器接入方式
    - virtual_world_required 决定 F030 虚拟世界设定是否必须
    - sensor_channels 列出形态所需传感器（F029 落地）
    - evolution_targets 来自静态矩阵，禁止 YAML 覆盖
    """
    model_config = ConfigDict(frozen=True)

    species: ForgekinSpecies
    physical_coupling: PhysicalCoupling
    virtual_world_required: bool
    sensor_channels: list[str] = Field(default_factory=list)
    world_setting_ref: Optional[str] = None
    evolution_targets: list[ForgekinSpecies] = Field(default_factory=list)

    @model_validator(mode="after")
    def _validate_consistency(self) -> "SpeciesProfile":
        # VIRTUAL 形态：physical_coupling 必须 NONE，sensor_channels 必须空
        if self.species == ForgekinSpecies.VIRTUAL:
            if self.physical_coupling != PhysicalCoupling.NONE:
                raise ValueError("VIRTUAL species must have physical_coupling=NONE")
            if self.sensor_channels:
                raise ValueError("VIRTUAL species must have empty sensor_channels")
        # BIO/OBJ/HYBRID 形态：必须绑定至少一个 sensor_channel
        if self.species in (ForgekinSpecies.BIO, ForgekinSpecies.OBJ, ForgekinSpecies.HYBRID):
            if not self.sensor_channels:
                raise ValueError(
                    f"{self.species.value} species must bind at least one sensor_channel"
                )
        # VIRTUAL/HYBRID 形态：必须绑定 world_setting_ref
        if self.species in (ForgekinSpecies.VIRTUAL, ForgekinSpecies.HYBRID):
            if not self.world_setting_ref:
                raise ValueError(
                    f"{self.species.value} species must bind world_setting_ref"
                )
        # BIO/ORG/OBJ 形态：禁止绑定 world_setting_ref
        if self.species in (ForgekinSpecies.BIO, ForgekinSpecies.ORG, ForgekinSpecies.OBJ):
            if self.world_setting_ref:
                raise ValueError(
                    f"{self.species.value} species must not bind world_setting_ref"
                )
        # evolution_targets 必须来自静态矩阵（YAML 不可覆盖）
        expected_targets = _SPECIES_EVOLUTION_MATRIX.get(self.species, [])
        if self.evolution_targets != expected_targets:
            raise ValueError(
                f"evolution_targets must be {[s.value for s in expected_targets]} "
                f"for species={self.species.value}, YAML override forbidden"
            )
        return self


class SpeciesEvolutionRecord(BaseModel):
    """形态进化记录（写入 F038 ForgekinLineage）

    架构契约：
    - 灵印 species 字段不修改，新 species 写入此记录
    - record_id 全局唯一（UUID v7）
    - operator_approved 必须为 true（除非测试模式）
    """
    record_id: str = Field(min_length=1)
    forgekin_id: str = Field(min_length=1)
    from_species: ForgekinSpecies
    to_species: ForgekinSpecies
    triggered_at: datetime
    operator_approved: bool
    capability_snapshot_before: dict
    capability_snapshot_after: dict
    rationale: str = Field(min_length=1, max_length=2048)


class EvolutionRequestState(str, Enum):
    """形态进化请求状态机"""
    PENDING = "pending"       # 已发起，等待 operator 审批
    APPROVED = "approved"     # operator 已批准，待应用
    REJECTED = "rejected"     # operator 已驳回
    APPLIED = "applied"       # 已应用（写入 ForgekinLineage）
    EXPIRED = "expired"       # 超时未审批，自动失效


class EvolutionRequest(BaseModel):
    """形态进化请求"""
    request_id: str = Field(min_length=1)
    forgekin_id: str = Field(min_length=1)
    from_species: ForgekinSpecies
    to_species: ForgekinSpecies
    state: EvolutionRequestState = EvolutionRequestState.PENDING
    operator_id: Optional[str] = None
    rationale: str = Field(min_length=1, max_length=2048)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    expires_at: datetime = Field(default_factory=lambda: datetime.utcnow() + timedelta(hours=24))

    @model_validator(mode="after")
    def _validate_evolution_path(self) -> "EvolutionRequest":
        allowed = _SPECIES_EVOLUTION_MATRIX.get(self.from_species, [])
        if self.to_species not in allowed:
            raise ValueError(
                f"evolution path {self.from_species.value} -> {self.to_species.value} "
                f"not allowed, valid targets: {[s.value for s in allowed]}"
            )
        return self


class SpeciesRegistry(ABC):
    """形态注册表（声明式 YAML 配置驱动，单例）

    架构契约：
    - 启动时由 `forgemind/config/species.yaml` 加载完成
    - 未加载完成时 ForgePipeline 拒绝启动锻造流程
    - 形态门控校验集中在此，F029/F030 禁止重复实现
    """

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
        """校验形态是否允许绑定该传感器通道（F029 形态门控）

        - VIRTUAL 形态：永远返回 false
        - BIO/OBJ/HYBRID 形态：channel 必须在 species.sensor_channels 内
        """
        ...

    @abstractmethod
    async def assert_world_setting_allowed(
        self, species: ForgekinSpecies
    ) -> bool:
        """校验形态是否允许绑定虚拟世界设定（F030 形态门控）

        - BIO/ORG/OBJ 形态：永远返回 false
        - VIRTUAL/HYBRID 形态：返回 true
        """
        ...

    @abstractmethod
    async def is_loaded(self) -> bool:
        """校验 5 形态是否全部加载完成"""
        ...


class SpeciesEvolutionGuard(ABC):
    """形态进化守卫（不可绕过 operator 审批）

    架构契约：
    - request -> approve -> apply 三步严格顺序
    - approve 必须 operator 显式确认
    - 超时（默认 24h）未审批自动 expire
    - apply 时写入 ForgekinLineage，灵印 species 不修改
    """

    @abstractmethod
    async def request_evolution(
        self, forgekin_id: str, target: ForgekinSpecies, rationale: str
    ) -> str:
        """发起形态进化请求（返回 request_id）

        - 校验 target 在当前 species 的 evolution_targets 内
        - 创建 EvolutionRequest（state=PENDING）
        - 持久化到 Repository
        """
        ...

    @abstractmethod
    async def approve_evolution(
        self, request_id: str, operator_id: str
    ) -> None:
        """operator 审批形态进化请求

        - 校验 request.state == PENDING
        - 校验 operator_id 有效
        - 更新 state = APPROVED
        """
        ...

    @abstractmethod
    async def apply_evolution(
        self, request_id: str
    ) -> SpeciesEvolutionRecord:
        """应用形态进化（写入 ForgekinLineage，返回进化记录）

        - 校验 request.state == APPROVED
        - 校验未超时（expires_at > now）
        - 读取能力画像快照（before / after）
        - 写入 SpeciesEvolutionRecord 到 ForgekinLineageRepository
        - 更新 request.state = APPLIED
        - 注意：灵印 species 字段不修改
        """
        ...

    @abstractmethod
    async def reject_evolution(
        self, request_id: str, reason: str
    ) -> None:
        """驳回形态进化请求"""
        ...

    @abstractmethod
    async def expire_stale_requests(self) -> int:
        """清理超时请求（定时任务调用）"""
        ...
```

### 2.3 数据结构 Pydantic Models

```python
# flowforge/forgemind/species_models.py
from __future__ import annotations
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field, model_validator
from .species import (
    ForgekinSpecies, PhysicalCoupling, SpeciesProfile,
    SpeciesEvolutionRecord, EvolutionRequest, EvolutionRequestState,
)


class SpeciesConfig(BaseModel):
    """YAML 配置加载结果（forgemind/config/species.yaml）"""
    species_profiles: list[SpeciesProfile] = Field(min_length=5, max_length=5)
    evolution_request_ttl_hours: int = Field(default=24, ge=1, le=168)
    require_operator_approval: bool = True

    @model_validator(mode="after")
    def _validate_all_5_species_present(self) -> "SpeciesConfig":
        present = {p.species for p in self.species_profiles}
        required = set(ForgekinSpecies)
        missing = required - present
        extra = present - required
        if missing:
            raise ValueError(f"missing species profiles: {[s.value for s in missing]}")
        if extra:
            raise ValueError(f"unknown species: {[s.value for s in extra]}")
        return self


class SensorBindingRequest(BaseModel):
    """传感器绑定请求（F029 调用本模块校验）"""
    forgekin_id: str = Field(min_length=1)
    species: ForgekinSpecies
    channel: str = Field(min_length=1)
    device_id: str = Field(min_length=1)


class WorldSettingBindingRequest(BaseModel):
    """虚拟世界设定绑定请求（F030 调用本模块校验）"""
    forgekin_id: str = Field(min_length=1)
    species: ForgekinSpecies
    world_setting_id: str = Field(min_length=1)


class EvolutionRequestCreate(BaseModel):
    """形态进化请求创建（对外暴露）"""
    forgekin_id: str = Field(min_length=1)
    target_species: ForgekinSpecies
    rationale: str = Field(min_length=1, max_length=2048)
    requested_by: str = Field(min_length=1)


class EvolutionApproval(BaseModel):
    """形态进化审批（operator 提交）"""
    request_id: str = Field(min_length=1)
    operator_id: str = Field(min_length=1)
    decision: str  # "approve" | "reject"
    reason: Optional[str] = None
```

### 2.4 关键算法伪代码

#### 2.4.1 形态门控快速路径算法

```
function assert_sensor_allowed(species: ForgekinSpecies, channel: str) -> bool:
    # 快速路径：VIRTUAL 形态永远拒绝（O(1) 字典查）
    if species == ForgekinSpecies.VIRTUAL:
        return False

    # 读取 SpeciesProfile（已加载到内存，O(1)）
    profile = self._profiles_cache.get(species)
    if profile is None:
        raise SpeciesNotLoadedError(species)

    # 校验 channel 在 profile.sensor_channels 内
    return channel in profile.sensor_channels


function assert_world_setting_allowed(species: ForgekinSpecies) -> bool:
    # 快速路径：BIO/ORG/OBJ 形态永远拒绝
    if species in (BIO, ORG, OBJ):
        return False
    # VIRTUAL/HYBRID 形态允许
    if species in (VIRTUAL, HYBRID):
        return True
    return False
```

**优化**：两个 assert 函数均为 O(1) 内存查表，预期延迟 < 0.1ms。

#### 2.4.2 形态进化三步审批算法

```
function request_evolution(forgekin_id, target, rationale) -> str:
    # 1. 读取当前 species（从灵印）
    imprint = await mind_imprint_repo.get_by_forgekin_id(forgekin_id)
    if imprint is None:
        raise ForgekinNotFoundError(forgekin_id)
    current_species = imprint.species

    # 2. 校验 target 在 evolution_targets 内（静态矩阵查）
    allowed = _SPECIES_EVOLUTION_MATRIX[current_species]
    if target not in allowed:
        raise EvolutionPathForbiddenError(current_species, target)

    # 3. 创建请求（state=PENDING，expires_at=now+24h）
    request = EvolutionRequest(
        request_id=uuid_v7(),
        forgekin_id=forgekin_id,
        from_species=current_species,
        to_species=target,
        rationale=rationale,
        expires_at=now() + timedelta(hours=config.evolution_request_ttl_hours),
    )

    # 4. 持久化
    await evolution_request_repo.insert(request)

    # 5. 发射事件（通知 operator）
    await event_bus.emit(EvolutionRequestedEvent(request_id=request.request_id))

    return request.request_id


function approve_evolution(request_id, operator_id) -> None:
    request = await evolution_request_repo.get(request_id)
    if request is None:
        raise RequestNotFoundError(request_id)
    if request.state != PENDING:
        raise InvalidStateError(f"state={request.state.value}, expected=PENDING")
    if now() > request.expires_at:
        request.state = EXPIRED
        await evolution_request_repo.update(request)
        raise RequestExpiredError(request_id)

    request.state = APPROVED
    request.operator_id = operator_id
    await evolution_request_repo.update(request)


function apply_evolution(request_id) -> SpeciesEvolutionRecord:
    request = await evolution_request_repo.get(request_id)
    if request is None:
        raise RequestNotFoundError(request_id)
    if request.state != APPROVED:
        raise InvalidStateError(f"state={request.state.value}, expected=APPROVED")

    # 读取能力画像快照（before）
    capability_before = await capability_profile_repo.get_snapshot(request.forgekin_id)

    # 写入 SpeciesEvolutionRecord（灵印 species 不修改！）
    record = SpeciesEvolutionRecord(
        record_id=uuid_v7(),
        forgekin_id=request.forgekin_id,
        from_species=request.from_species,
        to_species=request.to_species,
        triggered_at=now(),
        operator_approved=True,
        capability_snapshot_before=capability_before,
        capability_snapshot_after={},  # 应用后由 F035 能力融合填充
        rationale=request.rationale,
    )
    await forgekin_lineage_repo.append(record)

    # 更新请求状态
    request.state = APPLIED
    await evolution_request_repo.update(request)

    # 发射事件
    await event_bus.emit(EvolutionAppliedEvent(record_id=record.record_id))

    return record
```

#### 2.4.3 SpeciesRegistry 启动加载算法

```
function load_from_yaml(config_path: str) -> None:
    # 1. 加载 YAML
    with open(config_path) as f:
        data = yaml.safe_load(f)
    config = SpeciesConfig(**data["species"])

    # 2. 校验 5 形态完整
    if len(config.species_profiles) != 5:
        raise SpeciesIncompleteError(f"expected 5 profiles, got {len(config.species_profiles)}")

    # 3. 加载到内存缓存
    for profile in config.species_profiles:
        self._profiles_cache[profile.species] = profile

    # 4. 标记加载完成
    self._loaded = True
    logger.info("SpeciesRegistry loaded", extra={"count": 5})
```

---

## 3. 模块实现

### 3.1 关键代码片段

#### 3.1.1 SpeciesRegistry 具体实现

```python
# flowforge/forgemind/species_impl.py
from __future__ import annotations
from typing import Optional
from .species import (
    SpeciesRegistry, SpeciesProfile, ForgekinSpecies,
    _SPECIES_EVOLUTION_MATRIX,
)
from .species_models import SpeciesConfig


class InMemorySpeciesRegistry(SpeciesRegistry):
    """基于内存的 SpeciesRegistry 实现（DI 单例）

    架构契约：
    - 启动时由 YAML 加载完成，运行时只读
    - 形态门控 O(1) 内存查表
    - 未加载完成时 is_loaded() 返回 false，ForgePipeline 拒绝启动
    """

    def __init__(self):
        self._profiles_cache: dict[ForgekinSpecies, SpeciesProfile] = {}
        self._loaded: bool = False

    async def register(self, profile: SpeciesProfile) -> str:
        if profile.species in self._profiles_cache:
            raise ValueError(f"species {profile.species.value} already registered")
        self._profiles_cache[profile.species] = profile
        return profile.species.value

    async def get(self, species: ForgekinSpecies) -> SpeciesProfile:
        if not self._loaded:
            raise RuntimeError("SpeciesRegistry not loaded, ForgePipeline cannot start")
        profile = self._profiles_cache.get(species)
        if profile is None:
            raise KeyError(f"species {species.value} not registered")
        return profile

    async def list_evolution_paths(
        self, species: ForgekinSpecies
    ) -> list[ForgekinSpecies]:
        # 直接返回静态矩阵（YAML 不可覆盖）
        return list(_SPECIES_EVOLUTION_MATRIX.get(species, []))

    async def assert_sensor_allowed(
        self, species: ForgekinSpecies, channel: str
    ) -> bool:
        # VIRTUAL 形态永远拒绝
        if species == ForgekinSpecies.VIRTUAL:
            return False
        profile = await self.get(species)
        return channel in profile.sensor_channels

    async def assert_world_setting_allowed(
        self, species: ForgekinSpecies
    ) -> bool:
        # BIO/ORG/OBJ 形态永远拒绝
        if species in (ForgekinSpecies.BIO, ForgekinSpecies.ORG, ForgekinSpecies.OBJ):
            return False
        # VIRTUAL/HYBRID 形态允许
        if species in (ForgekinSpecies.VIRTUAL, ForgekinSpecies.HYBRID):
            return True
        return False

    async def is_loaded(self) -> bool:
        if not self._loaded:
            return False
        return len(self._profiles_cache) == 5

    def load_from_config(self, config: SpeciesConfig) -> None:
        """启动时加载（同步，仅调用一次）"""
        for profile in config.species_profiles:
            self._profiles_cache[profile.species] = profile
        if len(self._profiles_cache) != 5:
            raise ValueError(
                f"expected 5 species profiles, got {len(self._profiles_cache)}"
            )
        self._loaded = True
```

#### 3.1.2 SpeciesEvolutionGuard 具体实现

```python
# flowforge/forgemind/species_evolution_guard_impl.py
from __future__ import annotations
from datetime import datetime, timedelta, timezone
from uuid import uuid7
from .species import (
    SpeciesEvolutionGuard, SpeciesEvolutionRecord, EvolutionRequest,
    EvolutionRequestState, ForgekinSpecies, _SPECIES_EVOLUTION_MATRIX,
)
from .species_models import SpeciesConfig


class SqlAlchemySpeciesEvolutionGuard(SpeciesEvolutionGuard):
    """形态进化守卫实现（DI 注入）"""

    def __init__(
        self,
        evolution_request_repo,  # EvolutionRequestRepository
        forgekin_lineage_repo,   # ForgekinLineageRepository
        mind_imprint_repo,       # MindImprintRepository
        capability_profile_repo, # F001
        event_bus,
        config: SpeciesConfig,
    ):
        self._request_repo = evolution_request_repo
        self._lineage_repo = forgekin_lineage_repo
        self._imprint_repo = mind_imprint_repo
        self._capability_repo = capability_profile_repo
        self._event_bus = event_bus
        self._config = config

    async def request_evolution(
        self, forgekin_id: str, target: ForgekinSpecies, rationale: str
    ) -> str:
        imprint = await self._imprint_repo.get_by_forgekin_id(forgekin_id)
        if imprint is None:
            raise KeyError(f"forgekin not found: {forgekin_id}")
        current = imprint.species

        allowed = _SPECIES_EVOLUTION_MATRIX.get(current, [])
        if target not in allowed:
            raise ValueError(
                f"evolution path {current.value} -> {target.value} not allowed"
            )

        request = EvolutionRequest(
            request_id=str(uuid7()),
            forgekin_id=forgekin_id,
            from_species=current,
            to_species=target,
            rationale=rationale,
            expires_at=datetime.now(timezone.utc) + timedelta(hours=self._config.evolution_request_ttl_hours),
        )
        await self._request_repo.insert(request)
        await self._event_bus.emit({
            "event_type": "evolution_requested",
            "request_id": request.request_id,
            "forgekin_id": forgekin_id,
            "from": current.value,
            "to": target.value,
        })
        return request.request_id

    async def approve_evolution(self, request_id: str, operator_id: str) -> None:
        request = await self._request_repo.get(request_id)
        if request is None:
            raise KeyError(f"request not found: {request_id}")
        if request.state != EvolutionRequestState.PENDING:
            raise ValueError(f"state={request.state.value}, expected=PENDING")
        if datetime.now(timezone.utc) > request.expires_at:
            request.state = EvolutionRequestState.EXPIRED
            await self._request_repo.update(request)
            raise ValueError(f"request expired: {request_id}")

        request.state = EvolutionRequestState.APPROVED
        request.operator_id = operator_id
        await self._request_repo.update(request)

    async def apply_evolution(self, request_id: str) -> SpeciesEvolutionRecord:
        request = await self._request_repo.get(request_id)
        if request is None:
            raise KeyError(f"request not found: {request_id}")
        if request.state != EvolutionRequestState.APPROVED:
            raise ValueError(f"state={request.state.value}, expected=APPROVED")

        capability_before = {}
        if self._capability_repo:
            profile = await self._capability_repo.get(request.forgekin_id)
            if profile:
                capability_before = profile.model_dump()

        record = SpeciesEvolutionRecord(
            record_id=str(uuid7()),
            forgekin_id=request.forgekin_id,
            from_species=request.from_species,
            to_species=request.to_species,
            triggered_at=datetime.now(timezone.utc),
            operator_approved=True,
            capability_snapshot_before=capability_before,
            capability_snapshot_after={},  # 由 F035 能力融合填充
            rationale=request.rationale,
        )
        await self._lineage_repo.append(record)

        request.state = EvolutionRequestState.APPLIED
        await self._request_repo.update(request)

        await self._event_bus.emit({
            "event_type": "evolution_applied",
            "record_id": record.record_id,
            "forgekin_id": request.forgekin_id,
            "from": request.from_species.value,
            "to": request.to_species.value,
        })
        return record

    async def reject_evolution(self, request_id: str, reason: str) -> None:
        request = await self._request_repo.get(request_id)
        if request is None:
            raise KeyError(f"request not found: {request_id}")
        if request.state != EvolutionRequestState.PENDING:
            raise ValueError(f"state={request.state.value}, expected=PENDING")
        request.state = EvolutionRequestState.REJECTED
        await self._request_repo.update(request)

    async def expire_stale_requests(self) -> int:
        """定时清理超时请求（每小时调用一次）"""
        stale = await self._request_repo.list_pending_before(
            datetime.now(timezone.utc)
        )
        count = 0
        for request in stale:
            request.state = EvolutionRequestState.EXPIRED
            await self._request_repo.update(request)
            count += 1
        return count
```

#### 3.1.3 YAML 配置示例

```yaml
# flowforge/forgemind/config/species.yaml
species:
  evolution_request_ttl_hours: 24
  require_operator_approval: true
  species_profiles:
    - species: bio
      physical_coupling: sensor_only
      virtual_world_required: false
      sensor_channels: [camera, microphone, temperature]
      world_setting_ref: null
      evolution_targets: [hybrid]
    - species: org
      physical_coupling: none
      virtual_world_required: false
      sensor_channels: []
      world_setting_ref: null
      evolution_targets: []  # ORG 顶态，不可降级
    - species: obj
      physical_coupling: actuator
      virtual_world_required: false
      sensor_channels: [pressure, light, depth]
      world_setting_ref: null
      evolution_targets: [hybrid]
    - species: virtual
      physical_coupling: none
      virtual_world_required: true
      sensor_channels: []  # VIRTUAL 禁止物理传感器
      world_setting_ref: "forgemind_default_world"
      evolution_targets: [hybrid]
    - species: hybrid
      physical_coupling: full_embodied
      virtual_world_required: true
      sensor_channels: [camera, microphone, imu, depth]
      world_setting_ref: "forgemind_default_world"
      evolution_targets: []  # HYBRID 顶态
```

### 3.2 关键流程时序图

#### 3.2.1 形态进化三步审批时序图

```
operator       SpeciesEvolutionGuard     MindImprintRepo     ForgekinLineageRepo     EventBus
   │                    │                      │                     │                    │
   │ request_evolution  │                      │                     │                    │
   │  (fk_id, HYBRID,   │                      │                     │                    │
   │   rationale)       │                      │                     │                    │
   ├───────────────────▶│                      │                     │                    │
   │                    │ get_by_forgekin_id() │                     │                    │
   │                    ├─────────────────────▶│                     │                    │
   │                    │◀── imprint ─────────┤                     │                    │
   │                    │                      │                     │                    │
   │                    │ 校验 evolution path  │                     │                    │
   │                    │ (BIO -> HYBRID ok)   │                     │                    │
   │                    │                      │                     │                    │
   │                    │ 创建 EvolutionRequest (state=PENDING)      │                    │
   │                    │ (expires_at = now+24h)                     │                    │
   │                    │                      │                     │                    │
   │                    │ persist request      │                     │                    │
   │                    ├───────────────────────────────────────────▶│                    │
   │                    │                      │                     │                    │
   │                    │ emit EvolutionRequestedEvent               │                    │
   │                    ├──────────────────────────────────────────────────────────────────▶│
   │                    │                      │                     │                    │
   │◀── request_id ─────┤                      │                     │                    │
   │                    │                      │                     │                    │
   │ [operator 审批]    │                      │                     │                    │
   │ approve_evolution  │                      │                     │                    │
   │  (req_id, op_id)   │                      │                     │                    │
   ├───────────────────▶│                      │                     │                    │
   │                    │ 校验 state == PENDING                     │                    │
   │                    │ 校验未超时           │                     │                    │
   │                    │ 更新 state = APPROVED                     │                    │
   │                    │ operator_id = op_id  │                     │                    │
   │                    ├───────────────────────────────────────────▶│                    │
   │                    │                      │                     │                    │
   │ [apply 阶段]       │                      │                     │                    │
   │ apply_evolution    │                      │                     │                    │
   │  (req_id)          │                      │                     │                    │
   ├───────────────────▶│                      │                     │                    │
   │                    │ 校验 state == APPROVED                    │                    │
   │                    │ 读取 capability snapshot (before)          │                    │
   │                    │                      │                     │                    │
   │                    │ 创建 SpeciesEvolutionRecord               │                    │
   │                    │ append to lineage    │                     │                    │
   │                    ├───────────────────────────────────────────▶│                    │
   │                    │                      │                     │                    │
   │                    │ 更新 request.state = APPLIED              │                    │
   │                    │                      │                     │                    │
   │                    │ emit EvolutionAppliedEvent                │                     │
   │                    ├──────────────────────────────────────────────────────────────────▶│
   │                    │                      │                     │                    │
   │◀── record ─────────┤                      │                     │                    │
   │  (灵印 species 保留原值，新 species 在 lineage)                │                    │
   │                    │                      │                     │                    │
```

### 3.3 错误处理

| 异常类型 | 触发场景 | 处理策略 | 调用方预期 |
|---------|---------|---------|-----------|
| `SpeciesNotLoadedError` | SpeciesRegistry 未加载完成时调用 get() | 拒绝调用，返回 503 | ForgePipeline 等待加载完成后重试 |
| `SpeciesAlreadyRegisteredError` | 重复注册同一形态 | 拒绝注册，返回 409 | operator 检查 YAML 配置 |
| `EvolutionPathForbiddenError` | 形态进化路径不允许（如 ORG -> BIO） | 拒绝请求，返回 403 | 调用方校验 evolution_targets 后重试 |
| `InvalidStateError` | 形态进化请求状态机非法转换 | 拒绝操作，返回 409 | 调用方按正确顺序调用 |
| `RequestExpiredError` | 形态进化请求超时未审批 | 自动标记 EXPIRED，返回 410 | 调用方重新发起请求 |
| `OperatorApprovalRequiredError` | apply_evolution 时 operator 未批准 | 拒绝应用，返回 401 | 调用方先 approve_evolution |
| `SpeciesValidationError` | YAML 配置违反跨字段一致性 | 启动失败，返回 422 | operator 修正 YAML 后重启 |
| `SensorNotAllowedError` | VIRTUAL 形态绑定物理传感器 | 拒绝绑定，返回 403 | 调用方改用 HYBRID 形态 |
| `WorldSettingNotAllowedError` | BIO/ORG/OBJ 形态绑定虚拟世界设定 | 拒绝绑定，返回 403 | 调用方改用 VIRTUAL/HYBRID 形态 |

**幂等性策略**：

- `request_evolution` 非幂等（重复调用创建多个请求），调用方应使用 idempotency_key。
- `approve_evolution` 幂等（同一 operator 重复审批同一请求只生效一次）。
- `apply_evolution` 幂等（state=APPLIED 后重复调用返回已存在的 record）。

### 3.4 性能优化

| 性能指标 | 目标值 | 优化手段 |
|---------|:------:|---------|
| `get(species)` 延迟 | < 0.1ms | 内存字典查表，O(1) |
| `assert_sensor_allowed` 延迟 | < 0.1ms | VIRTUAL 快速拒绝 + 内存查表 |
| `assert_world_setting_allowed` 延迟 | < 0.1ms | 集合查表，O(1) |
| `list_evolution_paths` 延迟 | < 0.05ms | 静态矩阵查表 |
| `request_evolution` 延迟 | < 30ms | 1 次灵印查询 + 1 次 INSERT + 事件异步 |
| `apply_evolution` 延迟 | < 50ms | 1 次能力快照 + 1 次 INSERT + 事件异步 |
| SpeciesRegistry 启动加载 | < 100ms | 5 形态 YAML 静态加载 |
| 并发 assert_sensor_allowed | 1000 QPS | 内存只读，无锁 |

**缓存策略**：

- SpeciesProfile 进程内常驻（启动加载，运行时只读）。
- EvolutionRequest 短期缓存（TTL=60s），通过 state 变更事件主动失效。
- 不缓存 SpeciesEvolutionRecord（写多读少）。

---

## 4. 跨模块协作实现

### 4.1 上游依赖如何调用本模块

#### 4.1.1 F028 锻造流水线调用 SpeciesRegistry

F028 第 ① 步"形态定义"必须从 SpeciesRegistry 加载 SpeciesProfile：

```python
# F028 侧代码（不在本模块）
class SpeciesDefineHandler:
    def __init__(self, species_registry: SpeciesRegistry):
        self._registry = species_registry  # DI 注入

    async def execute(self, state: ForgingPipelineState) -> str:
        if not await self._registry.is_loaded():
            raise RuntimeError("SpeciesRegistry not loaded, ForgePipeline cannot start")
        profile = await self._registry.get(ForgekinSpecies(state.species))
        state.species_profile = profile
        return f"species_spec_{state.forgekin_id}"
```

**集成测试点**：F028 启动时校验 `is_loaded()` 返回 true，否则拒绝启动锻造流程。

#### 4.1.2 F029 传感器注册表调用形态门控

```python
# F029 侧代码
class SensorRegistryImpl:
    def __init__(self, species_registry: SpeciesRegistry):
        self._species_registry = species_registry

    async def bind(self, binding: SensorBinding) -> str:
        allowed = await self._species_registry.assert_sensor_allowed(
            binding.species, binding.channel
        )
        if not allowed:
            raise SensorNotAllowedError(
                f"species={binding.species.value} cannot bind channel={binding.channel}"
            )
        # ... 绑定逻辑
```

### 4.2 下游影响如何被调用

#### 4.2.1 F030 虚拟世界设定层调用形态门控

```python
# F030 侧代码
class WorldSettingImpl:
    async def load(self, forgekin_id: str, world_setting_id: str) -> "WorldSetting":
        forgekin = await self._engine.load_forgekin(forgekin_id)
        allowed = await self._species_registry.assert_world_setting_allowed(
            forgekin.mind_imprint.species
        )
        if not allowed:
            raise WorldSettingNotAllowedError(
                f"species={forgekin.mind_imprint.species.value} cannot bind world_setting"
            )
        # ... 加载世界设定
```

#### 4.2.2 F038 进化谱系消费形态进化记录

```python
# F038 侧代码
class ForgekinLineageImpl:
    async def get_lineage(self, forgekin_id: str) -> list[SpeciesEvolutionRecord]:
        # 直接调用 ForgekinLineageRepository.get_lineage()
        return await self._lineage_repo.get_lineage(forgekin_id)
```

#### 4.2.3 F001 能力画像包含 species 字段

```python
# F001 侧代码
class CapabilityProfile(BaseModel):
    profile_id: str
    forgekin_id: str
    species: ForgekinSpecies  # 引用本模块枚举
    # ...
```

### 4.3 集成测试点

| 测试编号 | 场景 | 验证点 |
|---------|------|-------|
| IT-D027-001 | 加载 5 形态 YAML | SpeciesRegistry.is_loaded() 返回 true |
| IT-D027-002 | YAML 缺少 1 形态 | 抛 SpeciesValidationError |
| IT-D027-003 | VIRTUAL 形态 sensor_channels 非空 | YAML 校验失败 |
| IT-D027-004 | BIO 形态 sensor_channels 为空 | YAML 校验失败 |
| IT-D027-005 | BIO 形态绑定 world_setting_ref | YAML 校验失败 |
| IT-D027-006 | VIRTUAL 形态绑定物理传感器 | assert_sensor_allowed 返回 false |
| IT-D027-007 | BIO 形态绑定虚拟世界设定 | assert_world_setting_allowed 返回 false |
| IT-D027-008 | ORG -> BIO 形态进化 | 抛 EvolutionPathForbiddenError |
| IT-D027-009 | HYBRID 形态 evolution_targets | 返回空列表（顶态） |
| IT-D027-010 | 形态进化三步审批完整流程 | request -> approve -> apply 全部成功 |
| IT-D027-011 | 未经 approve 直接 apply | 抛 InvalidStateError |
| IT-D027-012 | 形态进化请求超时 | expire_stale_requests 标记 EXPIRED |
| IT-D027-013 | 形态进化后灵印 species 不变 | 灵印 species 保留原值，新 species 在 ForgekinLineage |
| IT-D027-014 | SpeciesRegistry 未加载时 ForgePipeline 启动 | 抛 RuntimeError |
| IT-D027-015 | 5 形态枚举完整 | BIO/ORG/OBJ/VIRTUAL/HYBRID 全部存在 |
| IT-D027-016 | F029 调用 assert_sensor_allowed | VIRTUAL 形态绑定被拒绝 |
| IT-D027-017 | F030 调用 assert_world_setting_allowed | BIO 形态绑定被拒绝 |
| IT-D027-018 | F028 调用 SpeciesRegistry.get | 返回 SpeciesProfile |
| IT-D027-019 | 1000 并发 assert_sensor_allowed | 无锁，全部 < 0.1ms |
| IT-D027-020 | F001 CapabilityProfile 包含 species 字段 | 引用 ForgekinSpecies 枚举 |

---

## 5. 详细设计验收

### 5.1 功能验收 AC

- [ ] **AC-F-1**: 5 形态枚举（BIO/ORG/OBJ/VIRTUAL/HYBRID）固定不可扩展（IT-D027-015）。
- [ ] **AC-F-2**: SpeciesProfile YAML 外置到 `forgemind/config/species.yaml`，启动时加载完成（IT-D027-001）。
- [ ] **AC-F-3**: 跨字段一致性校验（VIRTUAL 无 sensor / BIO 必有 sensor / VIRTUAL 必有 world_setting）（IT-D027-003/004/005）。
- [ ] **AC-F-4**: 形态门控集中校验，VIRTUAL 形态绑定物理传感器被拒绝（IT-D027-006）。
- [ ] **AC-F-5**: BIO/ORG/OBJ 形态绑定虚拟世界设定被拒绝（IT-D027-007）。
- [ ] **AC-F-6**: ORG 不可降级，ORG -> BIO/OBJ 进化路径被排除（IT-D027-008）。
- [ ] **AC-F-7**: HYBRID 顶态，evolution_targets 为空（IT-D027-009）。
- [ ] **AC-F-8**: 形态进化三步审批完整流程可执行（IT-D027-010）。
- [ ] **AC-F-9**: 未经 approve 直接 apply 被拒绝（IT-D027-011）。
- [ ] **AC-F-10**: 形态进化请求超时自动 expire（IT-D027-012）。
- [ ] **AC-F-11**: 形态进化后灵印 species 字段保留原值，新 species 在 ForgekinLineage（IT-D027-013）。
- [ ] **AC-F-12**: SpeciesRegistry 未加载时 ForgePipeline 拒绝启动（IT-D027-014）。

### 5.2 性能验收

- [ ] **AC-P-1**: `get(species)` 延迟 < 0.1ms（P95）。
- [ ] **AC-P-2**: `assert_sensor_allowed` 延迟 < 0.1ms（P95）。
- [ ] **AC-P-3**: `assert_world_setting_allowed` 延迟 < 0.1ms（P95）。
- [ ] **AC-P-4**: `request_evolution` 延迟 < 30ms（P95）。
- [ ] **AC-P-5**: `apply_evolution` 延迟 < 50ms（P95）。
- [ ] **AC-P-6**: SpeciesRegistry 启动加载 < 100ms。
- [ ] **AC-P-7**: 1000 并发 `assert_sensor_allowed` 无锁，全部 < 0.1ms（IT-D027-019）。

### 5.3 安全验收

- [ ] **AC-S-1**: 单向依赖通过 —— `forgemind/species.py` 不 import *Forge 任何模块。
- [ ] **AC-S-2**: DI 容器注入通过 —— SpeciesRegistry 单例通过 DI 注入，无 `SpeciesRegistry()` 直接实例化。
- [ ] **AC-S-3**: Repository 层通过 —— SpeciesEvolutionRecord 通过 ForgekinLineageRepository 写入，无 `cursor.execute()`。
- [ ] **AC-S-4**: 配置驱动通过 —— 5 形态属性 YAML 外置，无 .py 硬编码。
- [ ] **AC-S-5**: 形态门控集中校验，F029/F030 禁止重复实现形态判断逻辑。
- [ ] **AC-S-6**: 形态进化必须 operator 显式审批，防止身份漂移（IT-D027-011）。
- [ ] **AC-S-7**: 灵印 species 不可变，形态进化记录追加到 ForgekinLineage（IT-D027-013）。
- [ ] **AC-S-8**: evolution_targets 来自静态矩阵，YAML 覆盖被拒绝。

### 5.4 Eval 验收

- [ ] **AC-E-1**: 本模块作为 harness 组件，必须附 EvalContract（F018 五问）。
- [ ] **AC-E-2**: friction_metrics 包含：`species_assert_latency_ms` / `evolution_apply_latency_ms` / `yaml_load_duration_ms`。
- [ ] **AC-E-3**: regression_cases 覆盖 IT-D027-001 ~ IT-D027-020。
- [ ] **AC-E-4**: sunset_signals：`unused_days=180` / `friction_above_threshold=assert_latency > 1ms`。
- [ ] **AC-E-5**: 信号采集器在 F019 SignalCollector 中注册：`species_gate_probe`。

---

## 6. 引用

- [doc:../spec.md#§3.8] + [doc:../spec.md#§2.6]（5 种形态分类）
- [doc:../arch.md#§3.8]（forgemind 应用层 + 5 种形态分类）
- [doc:../design.md#§3.8]
- [doc:../features/F027-all-things-spirit-species.md]（同号 Feature 级 SRS）
- [doc:../architecture/A027-all-things-spirit-species.md]（同号 Feature 级 SAD）
- [doc:../features/F026-forgemind-app-layer.md]
- [doc:../features/F028-forging-pipeline.md]
- [doc:../features/F029-physical-ai-sensors.md]
- [doc:../features/F030-virtual-world-setting.md]
- [doc:../features/F038-forgemind-lineage.md]
- [doc:../features/F001-capability-profile.md]
- [doc:../decisions/013-all-things-spirit-mind-vision.md]
- [doc:../design/naming-contract.md]（灵族 Forgekin Species + 灵印 MindImprint）
- [doc:../../../hiclaw/rules.md#第十一部分]
- [doc:../../../hiclaw/rules.md#编程红线]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（5 形态枚举 + 形态门控 + 形态进化守卫 + 灵印协同 + YAML 配置驱动详细设计） | 开发者灵智体（猎犬·夏洛克） |
