# D026: forgemind 应用层详细设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 开发者 Forgekin（猎犬·夏洛克）
> **对应 spec.md**: [doc:../spec.md#§3.8]（FR-CORE-008）
> **对应 arch.md**: [doc:../arch.md#§3.8]
> **对应 design.md**: [doc:../design.md#§3.8]
> **对应 Feature**: [doc:../features/F026-forgemind-app-layer.md]（同号 Feature 级 SRS）
> **对应 Architecture**: [doc:../architecture/A026-forgemind-app-layer.md]（同号 Feature 级 SAD）
> **依赖 ADR**: [doc:../decisions/005-forgemind-application-layer.md] + [doc:../decisions/013-all-things-spirit-mind-vision.md]

---

## 1. 详细设计上下文

### 1.1 设计问题

A026 架构设计已确定 forgemind 作为 FlowForge Layer 2 应用层，承载多形态智能体（Multi-Form Agent）Forge Nurturing（Forge Nurturing）代码。本详细设计进一步下沉到代码层，需要解决以下子问题：

1. **ForgeMindPlugin 四钩子的具体注册路径**：`register_forgekins / register_forge_skills / register_council_channels / register_auto_forge_config` 四钩子如何挂接到 FlowForge Plugin Registry 的 `PluginV3` 协议，注册时机与失败回滚策略。
2. **ForgekinBase 三方法契约的执行模型**：`observe / act / verify` 三方法如何对应 Harness L3/L2/L4，方法签名、返回类型、异常传播路径与超时控制。
3. **SpeciesRegistry 单例的 DI 注入路径**：DI 容器中 `species_registry` 绑定规则、生命周期、与 ForgePipeline / SensorRegistry / WorldSetting 的注入关系。
4. **ForgekinEngine 与 HarnessOrchestrator 的对接协议**：ForgekinEngine 作为Forgekin执行引擎宿主，如何把 ForgekinBase 三方法转译为 Harness 七层调用。
5. **5 预置Forgekin YAML 加载与校验**：猫头鹰·鲁班 / 猎犬·夏洛克 / 孔雀·梵高 / 蜜獾·平头哥 / 钢笔·文心 5 个预置Forgekin的 YAML schema、加载顺序、必填字段校验。
6. **觉醒阶晋升的 Eval 信号回流路径**：E1 -> E2 / E2 -> E3 晋升触发条件、Eval Contract 五问的调用时机、质量分阈值 0.85 的硬门实现。
7. **forgemind 反向依赖零容忍的静态校验**：如何在 CI 中扫描 `flowforge/core/` 是否 import forgemind 模块。

### 1.2 设计约束

- **单向依赖约束**：`flowforge/forgemind/` 是 Layer 2 应用层，单向依赖 `flowforge/core/`（L1 底座）+ `flowforge/loop/` + `flowforge/modes/`，禁止 `flowforge/core/` 反向 `import flowforge.forgemind.*`（架构红线第 12 条 + 编程红线第 10 条）。
- **DI 容器约束**：ForgekinBase 实例必须通过 `ForgekinEngine.load_forgekin` 注入，ForgeMindPlugin / SpeciesRegistry / ForgePipeline 必须通过 DI 容器解析，禁止 `ForgekinBase` / `SpeciesRegistry` 直接实例化（编程红线第 12 条）。
- **Repository 层约束**：SoulImprint（SoulImprint）写入必须经 `SoulImprintRepository` 抽象，形态进化记录必须经 `ForgekinLineageRepository`，禁止 `cursor.execute` 直接操作数据库（架构红线第 4 条）。
- **配置驱动约束**：5 形态定义、6 步锻造清单、5 预置Forgekin描述必须 YAML 外置到 `forgemind/config/*.yaml`，禁止 .py 硬编码（架构红线第 5 条 + P16）。
- **业务领域代码零容忍**：forgemind 严禁包含内容创作 / 小说 / 电商 / 开发等垂直业务领域代码（编程红线第 10 条），垂直业务必须放到对应 *Forge 子项目。
- **Plugin V3 协议约束**：forgemind 通过 `ForgeMindPlugin` 实现四钩子注册到 FlowForge Plugin Registry，不直接调用 Plugin Registry 内部 API。
- **异步约束**：所有 I/O 操作使用 `async/await`，禁止同步阻塞调用。
- **类型注解约束**：Python 3.11+，所有公共方法强制类型注解，Pydantic 模型校验。
- **进化阶/觉醒阶三标注约束**：代码层使用 `EvolutionStage` 枚举（E1-E6），注释中必须含中文 / 英文 / AI 业界概念三标注。

### 1.3 设计影响

- **对核心框架层（L1）的影响**：要求 `core/plugin/` 暴露 Plugin V3 四钩子注册点 `register_forgekins / register_forge_skills / register_council_channels / register_auto_forge_config`；要求 `core/harness/` 暴露 HarnessOrchestrator 端口供 ForgekinEngine 对接。
- **对 *Forge 子项目的影响**：明确 *Forge 不再承载通用Forgekin代码，*Forge 只保留垂直业务 Plugin，复用 forgemind 提供的 ForgekinBase / ForgePipeline / SensorAdapter / WorldSetting 抽象。
- **对 F027 形态分类的影响**：forgemind 提供 SpeciesRegistry 容器与 `forgemind/species.py` 文件，F027 在此落地 5 形态枚举与形态门控逻辑。
- **对 F028 锻造流水线的影响**：forgemind 提供 ForgePipeline 编排框架与 `forgemind/forging/` 目录，F028 实现 6 步具体阶段处理器。
- **对 F029 物理 AI 传感器的影响**：forgemind 提供 SensorAdapter 抽象与 `forgemind/sensors/` 目录，F029 落地摄像头/麦克风/IoT 适配器。
- **对 F030 虚拟世界设定层的影响**：forgemind 提供 WorldSetting 抽象与 `forgemind/worlds/` 目录，F030 落地三层世界引擎。
- **对 F036 / F037 / F038 / F039 的影响**：forgemind 提供市场发布接口、谱系追踪接口、MindCodex承载目录，供 F036-F039 落地具体能力。
- **对 Eval 自代谢系统的影响**：forgemind 触发的觉醒阶晋升必须经 Eval Contract 五问（F018）评估通过，Eval 信号回流到 forgemind 形成自进化闭环。
- **对 DI 容器的影响**：需新增 `forgekin_engine / species_registry / forge_pipeline / mind_imprint_repo / forgekin_lineage_repo / mind_council` 等绑定。

---

## 2. 详细设计

### 2.1 类图 ASCII

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        <<module>> flowforge.forgemind                         │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  <<enum>> ForgekinSpecies           <<enum>> EvolutionStage                  │
│  + BIO                              + E1_DORMANT    (沉睡阶 / Cold Start)    │
│  + ORG                              + E2_AWAKEN     (觉醒阶 / Bootstrapped)  │
│  + OBJ                              + E3_SENSE      (感知阶 / L1 Reactive)  │
│  + VIRTUAL                          + E4_ACT        (行动阶 / L2 Tool-Using)│
│  + HYBRID                           + E5_EVOLVING   (进化阶 / L3 Self-Impr) │
│                                     + E6_FORGEMIND  (ForgeMind 阶 / L4 Self-Evolv) │
│  <<model>> SoulImprint                                                        │
│  + imprint_id: str                 <<model>> ForgekinFormData                │
│  + soul_imprint_hash: str          + species: ForgekinSpecies                │
│  + species: ForgekinSpecies        + physical_description: str               │
│  + created_at: datetime            + virtual_description: str                │
│                                    + sensor_channels: list[str]              │
│  <<abstract>> ForgekinBase         + world_setting_id: str?                  │
│  + forgekin_id: str                                                           │
│  + mind_imprint: SoulImprint       <<plugin>> ForgeMindPlugin                │
│  + form_data: ForgekinFormData     + register_forgekins -> list[dict]      │
│  + evolution_stage: EvolutionStage + register_forge_skills -> list[dict]   │
│  + lineage_id: str?                + register_council_channels -> list     │
│  # observe -> dict[str, Any]     + register_auto_forge_config -> dict    │
│  # act(action, params) -> dict                                               │
│  # verify(evidence) -> bool        <<port>> ForgekinEnginePort               │
│                                    + load_forgekin(id) -> ForgekinBase       │
│  <<interface>> SpeciesRegistry     + execute_observe_act_verify(...)         │
│  + register(profile) -> str                                                   │
│  + get(species) -> SpeciesProfile  <<interface>> SoulImprintRepository       │
│  + list_evolution_paths(species)   + insert(imprint) -> str                  │
│  + assert_sensor_allowed(...)      + get(imprint_id) -> SoulImprint?         │
│  + assert_world_setting_allowed  + hash_exists(hash) -> bool               │
│                                                                              │
│  <<interface>> ForgekinLineageRepo <<interface>> MindCouncil                 │
│  + append(record) -> str           + convene(topic, members) -> str          │
│  + get_lineage(forgekin_id)        + get_resolution(session_id) -> dict       │
│  + list_evolution_records(id)      + close_session(session_id) -> None       │
└──────────────────────────────────────────────────────────────────────────────┘
                    │
                    │ 单向依赖（DI 注入）
                    v
┌──────────────────────────────────────────────────────────────────────────────┐
│                   <<module>> flowforge.core (L1 底座)                         │
│  + core/plugin/PluginRegistry (Plugin V3 四钩子)                              │
│  + core/harness/HarnessOrchestrator (七层表面)                                │
│  + core/interfaces/Repository + DIContainer                                   │
│  + core/tracing/get_logger                                                    │
└──────────────────────────────────────────────────────────────────────────────┘
                    ^
                    │ 反向依赖零容忍（架构红线）
                    |
       禁止：core/ import forgemind/
```

### 2.2 接口实现 Python 代码

```python
# flowforge/forgemind/base.py
from __future__ import annotations
from abc import ABC, abstractmethod
from typing import Optional, Any
from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict
from enum import Enum


class ForgekinSpecies(str, Enum):
    """多形态智能体形态分类（5 种，对应 spec.md §2.6）

    三标注：中文 / 英文 / AI 业界路径
    """
    BIO = "bio"               # BioForgekin 生物Forgekin（Embodied AI 路径）
    ORG = "org"               # OrgForgekin 组织Forgekin
    OBJ = "obj"               # ObjForgekin 物品Forgekin（Embodied AI 路径）
    VIRTUAL = "virtual"       # VirtualForgekin 虚拟Forgekin（Character AI 路径）
    HYBRID = "hybrid"         # HybridForgekin 混合Forgekin


class EvolutionStage(str, Enum):
    """进化阶（Evolution Stage，能力成熟度 6 级，spec.md §2.5.1）

    三标注：中文 / 英文 / AI 业界概念
    禁止跳级：E1 -> E2 -> E3 -> E4 -> E5 -> E6 必须经 Eval 信号触发
    """
    E1_DORMANT = "E1_dormant"      # E1 沉睡阶（Dormant / Cold Start）
    E2_AWAKEN = "E2_awaken"        # E2 觉醒阶（Awaken / Bootstrapped）
    E3_SENSE = "E3_sense"          # E3 感知阶（Sense / L1 Reactive）
    E4_ACT = "E4_act"              # E4 行动阶（Act / L2 Tool-Using）
    E5_EVOLVING = "E5_evolving"    # E5 进化阶（Evolving / L3 Self-Improving）
    E6_FORGEMIND = "E6_forgemind"  # E6 ForgeMind 阶（ForgeMind / L4 Self-Evolving Agent）


class SoulImprint(BaseModel):
    """SoulImprint（SoulImprint）—— Forgekin不可变身份锚点

    架构契约：
    - soul_imprint_hash 全局唯一且不可变
    - species 写入后保留原值（即使形态进化，原 species 不修改）
    - 通过 SoulImprintRepository 持久化到 F008 Durable State Surfaces
    """
    model_config = ConfigDict(frozen=True)

    imprint_id: str = Field(min_length=1)
    soul_imprint_hash: str = Field(min_length=64, max_length=64)  # SHA-256 hex
    species: ForgekinSpecies
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ForgekinFormData(BaseModel):
    """Forgekin形态数据（描述物理/虚拟形态）"""
    species: ForgekinSpecies
    physical_description: str = Field(min_length=1, max_length=2048)
    virtual_description: str = Field(default="", max_length=2048)
    sensor_channels: list[str] = Field(default_factory=list)
    world_setting_id: Optional[str] = None


class ForgekinBase(ABC, BaseModel):
    """Forgekin抽象基类（三方法契约）

    架构契约：
    - observe -> Harness L3 Evidence & Sensors
    - act     -> Harness L2 Tool Mediation
    - verify  -> Harness L4 Governance Boundary
    - 三方法缺一即架构契约违反
    - 实例化必须通过 ForgekinEngine.load_forgekin，禁止直接 ForgekinBase
    """
    forgekin_id: str = Field(min_length=1)
    mind_imprint: SoulImprint
    form_data: ForgekinFormData
    evolution_stage: EvolutionStage = EvolutionStage.E1_DORMANT
    lineage_id: Optional[str] = None
    capability_profile_ref: Optional[str] = None

    @abstractmethod
    async def observe(self) -> dict[str, Any]:
        """观察现实（通过传感器 / 虚拟世界 / 数字任务状态）

        对应 Harness L3 Evidence & Sensors：
        - BIO/OBJ/HYBRID 形态：通过 SensorAdapter 读取物理世界
        - VIRTUAL/HYBRID 形态：通过 WorldSetting 读取虚拟世界状态
        - 任何形态：可读取 EchoStore 中的近期EchoStore条目
        返回 Observation dict（含 sensor_snapshot / world_state / recent_echoes）
        """
        ...

    @abstractmethod
    async def act(self, action: str, params: dict) -> dict:
        """改变现实（通过执行器 / 虚拟操作 / 工具调用）

        对应 Harness L2 Tool Mediation：
        - action 必须在 CapabilityProfile.allowed_actions 白名单内
        - 副作用操作（写文件 / 提交代码）必须经 operator 二次确认（Tier 0/1 保护）
        - 返回 ActionResult dict（含 success / output / side_effects / commit_ref）
        """
        ...

    @abstractmethod
    async def verify(self, evidence: dict) -> bool:
        """验证现实（通过 Evidence & Sensors 反馈）

        对应 Harness L4 Governance Boundary：
        - 校验 act 产出是否满足预期
        - 校验治理规则是否被违反（如 forbidden_actions 未触发）
        - 返回 bool（true=通过 / false=需回滚或告警）
        """
        ...
```

```python
# flowforge/forgemind/plugin.py
from __future__ import annotations
from typing import Any
from .base import ForgekinSpecies, EvolutionStage


class ForgeMindPlugin:
    """forgemind Plugin V3 四钩子注册（与 FlowForge Plugin Registry 对接）

    架构契约：
    - 不直接调用 Plugin Registry 内部 API
    - 四钩子在 FlowForge 启动时被 PluginRegistry.load 调用
    - 任一钩子失败则 forgemind 整体注册失败，ForgekinEngine 拒绝加载任何 Forgekin
    """

    plugin_name: str = "forgemind"
    plugin_version: str = "1.0.0"

    @staticmethod
    def register_forgekins -> list[dict[str, Any]]:
        """钩子 1：注册通用Forgekin形态（5 种）

        返回 5 形态枚举的描述信息，供 ForgekinEngine 在运行时按需加载
        """
        return [
            {
                "species": ForgekinSpecies.BIO.value,
                "name": "生物Forgekin",
                "ai_path": "Embodied AI",
                "require_sensor": True,
                "require_world_setting": False,
            },
            {
                "species": ForgekinSpecies.ORG.value,
                "name": "组织Forgekin",
                "ai_path": "Organizational Agent",
                "require_sensor": False,
                "require_world_setting": False,
            },
            {
                "species": ForgekinSpecies.OBJ.value,
                "name": "物品Forgekin",
                "ai_path": "Embodied AI",
                "require_sensor": True,
                "require_world_setting": False,
            },
            {
                "species": ForgekinSpecies.VIRTUAL.value,
                "name": "虚拟Forgekin",
                "ai_path": "Character AI",
                "require_sensor": False,
                "require_world_setting": True,
            },
            {
                "species": ForgekinSpecies.HYBRID.value,
                "name": "混合Forgekin",
                "ai_path": "Hybrid Embodied + Character",
                "require_sensor": True,
                "require_world_setting": True,
            },
        ]

    @staticmethod
    def register_forge_skills -> list[dict[str, Any]]:
        """钩子 2：注册锻造技能（与进化阶绑定）

        返回 skill -> stage 映射，供 ForgePipeline 在觉醒阶晋升时启用对应技能
        """
        return [
            {"skill": "observe", "min_stage": EvolutionStage.E3_SENSE.value},
            {"skill": "act", "min_stage": EvolutionStage.E4_ACT.value},
            {"skill": "verify", "min_stage": EvolutionStage.E4_ACT.value},
            {"skill": "evolve", "min_stage": EvolutionStage.E5_EVOLVING.value},
            {"skill": "self_forge", "min_stage": EvolutionStage.E6_FORGEMIND.value},
        ]

    @staticmethod
    def register_council_channels -> list[dict[str, Any]]:
        """钩子 3：注册MindCouncil通道（多 Forgekin 协作）

        返回 channel 配置，供 MindCouncil 在多 Forgekin议事时使用
        """
        return [
            {
                "channel": "forgemind_council",
                "type": "multi_forgekin",
                "protocol": "teamact_v1",  # 复用 F002 TeamAct
                "max_members": 7,
                "require_handoff_capsule": True,
            },
        ]

    @staticmethod
    def register_auto_forge_config -> dict[str, Any]:
        """钩子 4：注册自锻造配置（与 F035 能力融合联动）

        返回自锻造调度配置，供 ForgePipeline 在低活动时段触发自锻造
        """
        return {
            "schedule": "daily_low_activity",  # 每日低活动时段
            "cron": "0 3 * * *",  # UTC 03:00
            "eval_required": True,  # 必须经 Eval 信号触发
            "eval_threshold": 0.85,
            "operator_approval_for_merge": True,  # L4 Standard 需 operator 批准
            "max_auto_forge_per_day": 3,
        }
```

```python
# flowforge/forgemind/engine.py
from __future__ import annotations
from abc import ABC, abstractmethod
from typing import Any
from .base import ForgekinBase


class ForgekinEnginePort(ABC):
    """ForgekinEngine 端口（DI 注入抽象，避免 forgemind 反向依赖 core/harness）

    架构契约：
    - ForgekinEngine 由 core/harness 实现，forgemind 通过 DI 注入端口
    - 端口方法屏蔽 HarnessOrchestrator 内部细节
    - forgemind 不 import core.harness任何具体类
    """

    @abstractmethod
    async def load_forgekin(self, forgekin_id: str) -> ForgekinBase:
        """加载Forgekin实例（DI 注入依赖）

        - 从 SoulImprintRepository 读取SoulImprint
        - 从 ForgekinLineageRepository 读取最新进化记录
        - 注入 CapabilityProfile / EchoStore / SensorAdapter / WorldSetting
        - 返回 ForgekinBase 实例（具体子类由 species 决定）
        """
        ...

    @abstractmethod
    async def execute_observe_act_verify(
        self,
        forgekin_id: str,
        action: str,
        params: dict,
    ) -> dict[str, Any]:
        """执行 observe -> act -> verify 现实闭环

        - 一次调用完成三方法闭环
        - observe 失败：返回 {success: false, phase: "observe", error: ...}
        - act 失败：返回 {success: false, phase: "act", error: ...}
        - verify 失败：返回 {success: false, phase: "verify", need_rollback: true}
        - 全部成功：返回 {success: true, observation, action_result, verified: true}
        """
        ...

    @abstractmethod
    async def promote_evolution_stage(
        self,
        forgekin_id: str,
        target_stage: str,
        eval_signal: dict,
    ) -> None:
        """觉醒阶晋升（必须经 Eval 信号触发）

        - 校验 eval_signal.quality_score >= 0.85
        - 校验 target_stage 是当前 stage 的下一阶（禁止跳级）
        - 写入 ForgekinLineageRepository
        - 更新 forgekin.evolution_stage
        """
        ...
```

```python
# flowforge/forgemind/repositories.py
from __future__ import annotations
from abc import ABC, abstractmethod
from typing import Optional
from datetime import datetime
from .base import SoulImprint, ForgekinSpecies, EvolutionStage


class SoulImprintRepository(ABC):
    """SoulImprint Repository（禁直操作数据库，必须经 ORM）

    架构契约：
    - SoulImprint是 Forgekin 不可变身份锚点，写入后永不可修改
    - soul_imprint_hash 全局唯一，重复写入抛 IntegrityError
    - 持久化到 F008 Durable State Surfaces
    """

    @abstractmethod
    async def insert(self, imprint: SoulImprint) -> str:
        """插入SoulImprint（不可变，重复 hash 抛异常）"""
        ...

    @abstractmethod
    async def get(self, imprint_id: str) -> Optional[SoulImprint]:
        """按 ID 读取SoulImprint"""
        ...

    @abstractmethod
    async def get_by_forgekin_id(self, forgekin_id: str) -> Optional[SoulImprint]:
        """按 forgekin_id 读取SoulImprint"""
        ...

    @abstractmethod
    async def hash_exists(self, soul_imprint_hash: str) -> bool:
        """校验 hash 是否已存在（防止重复注册）"""
        ...


class SpeciesEvolutionRecord(BaseModel):
    """形态进化记录（写入 ForgekinLineageRepository）"""
    record_id: str
    forgekin_id: str
    from_species: ForgekinSpecies
    to_species: ForgekinSpecies
    from_stage: EvolutionStage
    to_stage: EvolutionStage
    triggered_at: datetime
    operator_approved: bool
    eval_quality_score: float
    rationale: str


class ForgekinLineageRepository(ABC):
    """进化谱系 Repository（禁直操作数据库）"""

    @abstractmethod
    async def append(self, record: SpeciesEvolutionRecord) -> str:
        """追加进化记录（增量 append，不覆盖历史）"""
        ...

    @abstractmethod
    async def get_lineage(self, forgekin_id: str) -> list[SpeciesEvolutionRecord]:
        """读取Forgekin的完整谱系（按时间排序）"""
        ...

    @abstractmethod
    async def get_latest_record(self, forgekin_id: str) -> Optional[SpeciesEvolutionRecord]:
        """读取最新一条进化记录"""
        ...


class MindCouncil(ABC):
    """MindCouncil（MindCouncil）—— 多 Forgekin 协作议事

    架构契约：
    - 复用 F002 TeamAct 六步循环 + Handoff Capsule
    - 议事结果必须经 Eval Contract 评估
    - 议事产出写入 F014 EchoStore
    """

    @abstractmethod
    async def convene(
        self,
        topic: str,
        members: list[str],  # forgekin_id 列表
        context: dict,
    ) -> str:
        """召集MindCouncil（返回 session_id）"""
        ...

    @abstractmethod
    async def get_resolution(self, session_id: str) -> dict:
        """获取议事决议（需等待议事完成）"""
        ...

    @abstractmethod
    async def close_session(self, session_id: str) -> None:
        """关闭议事会话"""
        ...
```

### 2.3 数据结构 Pydantic Models

```python
# flowforge/forgemind/models.py
from __future__ import annotations
from typing import Optional, Any
from datetime import datetime
from pydantic import BaseModel, Field, model_validator
from .base import ForgekinSpecies, EvolutionStage, SoulImprint, ForgekinFormData


class ForgekinConfig(BaseModel):
    """YAML 配置加载结果（forgemind/config/forgemind.yaml）"""
    enabled_species: list[ForgekinSpecies] = Field(default_factory=lambda: list(ForgekinSpecies))
    preset_forgekins_path: str = "forgemind/config/forgekins/"
    auto_forge_schedule: str = "daily_low_activity"
    eval_threshold: float = Field(default=0.85, ge=0.0, le=1.0)
    max_council_members: int = Field(default=7, ge=2, le=20)
    require_operator_approval_for_evolution: bool = True


class PresetForgekinSpec(BaseModel):
    """预置Forgekin YAML schema（5 个预置Forgekin）"""
    forgekin_id: str = Field(min_length=1)
    name: str = Field(min_length=1, max_length=64)
    species: ForgekinSpecies
    physical_description: str = Field(min_length=1, max_length=2048)
    virtual_description: str = Field(default="", max_length=2048)
    sensor_channels: list[str] = Field(default_factory=list)
    world_setting_id: Optional[str] = None
    seed_capabilities: list[str] = Field(default_factory=list)
    seed_memories: list[str] = Field(default_factory=list)
    value_anchors: list[str] = Field(default_factory=list)
    target_evolution_stage: EvolutionStage = EvolutionStage.E2_AWAKEN
    max_evolution_stage: EvolutionStage = EvolutionStage.E3_SENSE
    responsibility: str  # 责任方描述

    @model_validator(mode="after")
    def _validate_species_consistency(self) -> "PresetForgekinSpec":
        """校验形态与接入层一致性"""
        if self.species in (ForgekinSpecies.BIO, ForgekinSpecies.OBJ, ForgekinSpecies.HYBRID):
            if not self.sensor_channels:
                raise ValueError(
                    f"species={self.species.value} 必须绑定至少一个 sensor_channel"
                )
        if self.species in (ForgekinSpecies.VIRTUAL, ForgekinSpecies.HYBRID):
            if not self.world_setting_id:
                raise ValueError(
                    f"species={self.species.value} 必须绑定 world_setting_id"
                )
        if self.target_evolution_stage.value > self.max_evolution_stage.value:
            raise ValueError("target_evolution_stage 不可超过 max_evolution_stage")
        return self


class ForgekinRegistrationRequest(BaseModel):
    """对外暴露的Forgekin注册请求"""
    name: str = Field(min_length=1, max_length=64)
    species: ForgekinSpecies
    physical_description: str = Field(min_length=1, max_length=2048)
    virtual_description: str = Field(default="", max_length=2048)
    sensor_channels: list[str] = Field(default_factory=list)
    world_setting_id: Optional[str] = None
    seed_capabilities: list[str] = Field(default_factory=list)
    operator_id: str = Field(min_length=1)


class Observation(BaseModel):
    """observe 返回的观察结果"""
    forgekin_id: str
    timestamp: datetime
    sensor_snapshot: dict[str, Any] = Field(default_factory=dict)
    world_state: dict[str, Any] = Field(default_factory=dict)
    recent_echoes: list[dict] = Field(default_factory=list)
    health_status: str = "healthy"  # healthy / degraded / offline


class ActionResult(BaseModel):
    """act 返回的行动结果"""
    forgekin_id: str
    action: str
    success: bool
    output: Optional[dict] = None
    side_effects: list[dict] = Field(default_factory=list)
    commit_ref: Optional[str] = None
    duration_ms: int = 0
    error: Optional[str] = None


class VerifyResult(BaseModel):
    """verify 返回的验证结果"""
    forgekin_id: str
    passed: bool
    governance_violations: list[str] = Field(default_factory=list)
    quality_score: float = Field(ge=0.0, le=1.0)
    need_rollback: bool = False
    evidence: dict


class EvolutionPromotionRequest(BaseModel):
    """觉醒阶晋升请求"""
    forgekin_id: str
    target_stage: EvolutionStage
    eval_signal_id: str
    eval_quality_score: float = Field(ge=0.0, le=1.0)
    operator_id: str
    rationale: str = Field(min_length=1)


class CouncilConveneRequest(BaseModel):
    """MindCouncil召集请求"""
    topic: str = Field(min_length=1, max_length=256)
    members: list[str] = Field(min_length=2, max_length=20)
    context: dict
    require_eval: bool = True
```

### 2.4 关键算法伪代码

#### 2.4.1 ForgekinEngine 加载Forgekin算法

```
function load_forgekin(forgekin_id: str) -> ForgekinBase:
    # 1. 从 Repository 读取SoulImprint（不可变身份锚点）
    imprint = await mind_imprint_repo.get_by_forgekin_id(forgekin_id)
    if imprint is None:
        raise ForgekinNotFoundError(forgekin_id)

    # 2. 从 Repository 读取最新进化记录
    latest_record = await forgekin_lineage_repo.get_latest_record(forgekin_id)
    evolution_stage = latest_record.to_stage if latest_record else EvolutionStage.E1_DORMANT

    # 3. 根据 species 选择具体子类
    species = imprint.species
    forgekin_class = _SPECIES_TO_CLASS[species]  # BioForgekin / VirtualForgekin / ...

    # 4. DI 注入依赖（CapabilityProfile / EchoStore / SensorAdapter / WorldSetting）
    capability_profile = await capability_profile_repo.get(forgekin_id)
    sensor_adapter = await sensor_registry.list_bindings(forgekin_id) if species in [BIO, OBJ, HYBRID] else []
    world_setting = await world_setting_repo.get(forgekin_id) if species in [VIRTUAL, HYBRID] else None

    # 5. 构造 ForgekinBase 实例（禁止直接 ForgekinBase，必须用具体子类）
    forgekin = forgekin_class(
        forgekin_id=forgekin_id,
        mind_imprint=imprint,
        form_data=FormData(species=species, sensor_channels=[...], ...),
        evolution_stage=evolution_stage,
        lineage_id=latest_record.record_id if latest_record else None,
        capability_profile_ref=capability_profile.profile_id,
    )

    # 6. 返回（DI 注入完成）
    return forgekin
```

#### 2.4.2 observe -> act -> verify 现实闭环算法

```
function execute_observe_act_verify(forgekin_id, action, params) -> dict:
    # 阶段 1: observe（Harness L3 Evidence & Sensors）
    try:
        observation = await forgekin.observe
        if observation.health_status == "offline":
            return {success: false, phase: "observe", error: "forgekin_offline"}
    except SensorUnavailableError as e:
        # F023 liveness degraded，返回最近一次有效快照
        return {success: false, phase: "observe", error: str(e), degraded: true}

    # 阶段 2: act（Harness L2 Tool Mediation）
    # 校验 action 在 CapabilityProfile.allowed_actions 白名单内
    if action not in capability_profile.allowed_actions:
        return {success: false, phase: "act", error: "action_not_allowed"}

    # 副作用操作必须经 operator 二次确认（Tier 0/1 保护）
    if action in TIER0_ACTIONS and not params.get("operator_confirmed"):
        return {success: false, phase: "act", error: "tier0_confirmation_required"}

    try:
        action_result = await forgekin.act(action, params)
        if not action_result.success:
            return {success: false, phase: "act", error: action_result.error}
    except ToolExecutionError as e:
        return {success: false, phase: "act", error: str(e)}

    # 阶段 3: verify（Harness L4 Governance Boundary）
    evidence = {
        "observation": observation,
        "action_result": action_result,
        "governance_rules": governance_bundle.hard_rules,
    }
    try:
        verified = await forgekin.verify(evidence)
        if not verified:
            # 触发回滚
            await rollback_action(action_result)
            return {success: false, phase: "verify", need_rollback: true}
    except GovernanceViolationError as e:
        return {success: false, phase: "verify", error: str(e), need_rollback: true}

    # 全部成功
    return {
        success: true,
        observation: observation,
        action_result: action_result,
        verified: true,
    }
```

#### 2.4.3 觉醒阶晋升算法（Eval 信号触发）

```
function promote_evolution_stage(forgekin_id, target_stage, eval_signal) -> None:
    # 1. 校验 Eval 质量分 >= 0.85（硬门）
    if eval_signal.quality_score < 0.85:
        raise EvalThresholdNotMetError(
            f"quality_score={eval_signal.quality_score} < 0.85"
        )

    # 2. 读取当前进化阶
    current_record = await forgekin_lineage_repo.get_latest_record(forgekin_id)
    current_stage = current_record.to_stage if current_record else EvolutionStage.E1_DORMANT

    # 3. 校验 target_stage 是当前 stage 的下一阶（禁止跳级）
    expected_next = _NEXT_STAGE_MAP[current_stage]
    if target_stage != expected_next:
        raise StageJumpForbiddenError(
            f"current={current_stage.value}, target={target_stage.value}, "
            f"expected_next={expected_next.value}"
        )

    # 4. operator 审批（如果配置要求）
    if config.require_operator_approval_for_evolution:
        if not eval_signal.operator_approved:
            raise OperatorApprovalRequiredError(forgekin_id)

    # 5. 写入进化记录（增量 append，不覆盖历史）
    record = SpeciesEvolutionRecord(
        record_id=uuid_v7,
        forgekin_id=forgekin_id,
        from_species=current_record.to_species if current_record else imprint.species,
        to_species=current_record.to_species if current_record else imprint.species,  # 形态进化单独触发
        from_stage=current_stage,
        to_stage=target_stage,
        triggered_at=now,
        operator_approved=eval_signal.operator_approved,
        eval_quality_score=eval_signal.quality_score,
        rationale=eval_signal.rationale,
    )
    await forgekin_lineage_repo.append(record)

    # 6. 更新 forgekin.evolution_stage（在下一次 load_forgekin 时生效）
    # 注意：SoulImprint species 字段不修改（保留血缘痕迹）

    # 7. 发射事件
    await event_bus.emit(EvolutionPromotedEvent(
        forgekin_id=forgekin_id,
        from_stage=current_stage,
        to_stage=target_stage,
    ))
```

#### 2.4.4 Plugin V3 四钩子注册算法

```
function register_forge_mind_plugin(plugin_registry: PluginRegistry) -> None:
    # 1. 注册四钩子
    plugin = ForgeMindPlugin

    forgekins = plugin.register_forgekins          # 钩子 1
    forge_skills = plugin.register_forge_skills    # 钩子 2
    council_channels = plugin.register_council_channels  # 钩子 3
    auto_forge_config = plugin.register_auto_forge_config  # 钩子 4

    # 2. 校验四钩子返回值非空
    for name, value in [
        ("forgekins", forgekins),
        ("forge_skills", forge_skills),
        ("council_channels", council_channels),
        ("auto_forge_config", auto_forge_config),
    ]:
        if not value:
            raise PluginRegistrationError(f"hook {name} returned empty")

    # 3. 调用 PluginRegistry 注册（不直接操作内部 API）
    plugin_registry.register(
        plugin_name="forgemind",
        version="1.0.0",
        hooks={
            "forgekins": forgekins,
            "forge_skills": forge_skills,
            "council_channels": council_channels,
            "auto_forge_config": auto_forge_config,
        },
    )

    # 4. 加载 5 预置Forgekin YAML
    preset_path = Path("forgemind/config/forgekins/")
    for yaml_file in preset_path.glob("*.yaml"):
        spec = PresetForgekinSpec(**yaml.safe_load(yaml_file.read_text))
        await species_registry.register_preset_forgekin(spec)

    # 5. 注册成功后 ForgekinEngine 可加载Forgekin
    logger.info("ForgeMindPlugin registered successfully",
                extra={"forgekins_count": len(forgekins)})
```

---

## 3. 模块实现

### 3.1 关键代码片段

#### 3.1.1 ForgekinEngine 具体实现（core/harness 侧）

```python
# flowforge/core/harness/forgekin_engine_impl.py
from __future__ import annotations
from datetime import datetime, timezone
from uuid import uuid7
from flowforge.forgemind.base import ForgekinBase, EvolutionStage
from flowforge.forgemind.engine import ForgekinEnginePort
from flowforge.forgemind.repositories import (
    SoulImprintRepository, ForgekinLineageRepository, SpeciesEvolutionRecord,
)
from flowforge.forgemind.models import Observation, ActionResult, VerifyResult


class HarnessForgekinEngine(ForgekinEnginePort):
    """ForgekinEngine 具体实现（位于 core/harness，通过 DI 注入到 forgemind）

    架构契约：
    - 实现端在 core/harness，端口在 forgemind，避免反向依赖
    - 通过 DI 容器注入到 forgemind 的 ForgePipeline / MindCouncil
    """

    def __init__(
        self,
        mind_imprint_repo: SoulImprintRepository,
        forgekin_lineage_repo: ForgekinLineageRepository,
        capability_profile_repo,  # F001
        sensor_registry,          # F029
        world_setting_repo,       # F030
        event_bus,
        governance_bundle,
    ):
        self._imprint_repo = mind_imprint_repo
        self._lineage_repo = forgekin_lineage_repo
        self._capability_repo = capability_profile_repo
        self._sensor_registry = sensor_registry
        self._world_setting_repo = world_setting_repo
        self._event_bus = event_bus
        self._governance = governance_bundle

    async def load_forgekin(self, forgekin_id: str) -> ForgekinBase:
        imprint = await self._imprint_repo.get_by_forgekin_id(forgekin_id)
        if imprint is None:
            raise KeyError(f"Forgekin not found: {forgekin_id}")

        latest = await self._lineage_repo.get_latest_record(forgekin_id)
        evolution_stage = latest.to_stage if latest else EvolutionStage.E1_DORMANT

        # 根据 species 选择具体子类（由 forgemind 子模块注册）
        from flowforge.forgemind.species_factory import get_forgekin_class
        forgekin_class = get_forgekin_class(imprint.species)

        capability_profile = await self._capability_repo.get(forgekin_id)
        return forgekin_class(
            forgekin_id=forgekin_id,
            mind_imprint=imprint,
            form_data=...,  # 由 species 子类填充
            evolution_stage=evolution_stage,
            lineage_id=latest.record_id if latest else None,
            capability_profile_ref=capability_profile.profile_id if capability_profile else None,
        )

    async def execute_observe_act_verify(
        self, forgekin_id: str, action: str, params: dict
    ) -> dict:
        forgekin = await self.load_forgekin(forgekin_id)

        # 阶段 1: observe
        try:
            observation = await forgekin.observe
        except Exception as e:
            return {"success": False, "phase": "observe", "error": str(e)}

        # 阶段 2: act
        try:
            action_result = await forgekin.act(action, params)
            if not action_result.get("success", True):
                return {"success": False, "phase": "act", "error": action_result.get("error")}
        except Exception as e:
            return {"success": False, "phase": "act", "error": str(e)}

        # 阶段 3: verify
        evidence = {
            "observation": observation,
            "action_result": action_result,
            "governance_rules": self._governance.hard_rules,
        }
        try:
            verified = await forgekin.verify(evidence)
            if not verified:
                return {"success": False, "phase": "verify", "need_rollback": True}
        except Exception as e:
            return {"success": False, "phase": "verify", "error": str(e), "need_rollback": True}

        return {
            "success": True,
            "observation": observation,
            "action_result": action_result,
            "verified": True,
        }

    async def promote_evolution_stage(
        self, forgekin_id: str, target_stage: str, eval_signal: dict
    ) -> None:
        quality_score = eval_signal.get("quality_score", 0.0)
        if quality_score < 0.85:
            raise ValueError(f"quality_score={quality_score} < 0.85")

        target = EvolutionStage(target_stage)
        latest = await self._lineage_repo.get_latest_record(forgekin_id)
        current = latest.to_stage if latest else EvolutionStage.E1_DORMANT

        _NEXT = {
            EvolutionStage.E1_DORMANT: EvolutionStage.E2_AWAKEN,
            EvolutionStage.E2_AWAKEN: EvolutionStage.E3_SENSE,
            EvolutionStage.E3_SENSE: EvolutionStage.E4_ACT,
            EvolutionStage.E4_ACT: EvolutionStage.E5_EVOLVING,
            EvolutionStage.E5_EVOLVING: EvolutionStage.E6_FORGEMIND,
        }
        if current in _NEXT and target != _NEXT[current]:
            raise ValueError(
                f"stage jump forbidden: current={current.value} -> target={target.value}, "
                f"expected={_NEXT[current].value}"
            )

        record = SpeciesEvolutionRecord(
            record_id=str(uuid7),
            forgekin_id=forgekin_id,
            from_species=latest.to_species if latest else (await self._imprint_repo.get_by_forgekin_id(forgekin_id)).species,
            to_species=latest.to_species if latest else (await self._imprint_repo.get_by_forgekin_id(forgekin_id)).species,
            from_stage=current,
            to_stage=target,
            triggered_at=datetime.now(timezone.utc),
            operator_approved=eval_signal.get("operator_approved", False),
            eval_quality_score=quality_score,
            rationale=eval_signal.get("rationale", ""),
        )
        await self._lineage_repo.append(record)
```

#### 3.1.2 DI 容器绑定

```python
# flowforge/core/di.py（片段，新增 forgemind 相关绑定）
def _register_forgemind_bindings(container: DIContainer, config: "ForgekinConfig"):
    """注册 forgemind 相关 DI 绑定"""
    from flowforge.forgemind.plugin import ForgeMindPlugin
    from flowforge.forgemind.engine import ForgekinEnginePort
    from flowforge.core.harness.forgekin_engine_impl import HarnessForgekinEngine

    # Repository（每次注入新建 session）
    container.register_factory(
        "mind_imprint_repository",
        lambda: SqlAlchemySoulImprintRepository(get_async_session_factory),
    )
    container.register_factory(
        "forgekin_lineage_repository",
        lambda: SqlAlchemyForgekinLineageRepository(get_async_session_factory),
    )

    # ForgekinEngine（单例，端口注入）
    container.register_singleton(
        "forgekin_engine",
        lambda: HarnessForgekinEngine(
            mind_imprint_repo=container.resolve("mind_imprint_repository"),
            forgekin_lineage_repo=container.resolve("forgekin_lineage_repository"),
            capability_profile_repo=container.resolve("capability_profile_repository"),
            sensor_registry=container.resolve("sensor_registry"),
            world_setting_repo=container.resolve("world_setting_repository"),
            event_bus=container.resolve("event_bus"),
            governance_bundle=container.resolve("governance_bundle"),
        ),
    )

    # ForgeMindPlugin（单例）
    container.register_singleton("forge_mind_plugin", lambda: ForgeMindPlugin)

    # MindCouncil（单例，复用 F002 TeamAct）
    container.register_singleton(
        "mind_council",
        lambda: TeamActMindCouncil(
            teamact_executor=container.resolve("teamact_executor"),
            eval_contract=container.resolve("eval_contract"),
        ),
    )
```

#### 3.1.3 预置Forgekin YAML 加载器

```python
# flowforge/forgemind/config_loader.py
from __future__ import annotations
from pathlib import Path
import yaml
from .models import PresetForgekinSpec, ForgekinConfig


class PresetForgekinLoader:
    """5 预置Forgekin YAML 加载器"""

    PRESET_FILES = [
        "owl_luban.yaml",        # 猫头鹰·鲁班（架构师）
        "hound_sherlock.yaml",   # 猎犬·夏洛克（开发者）
        "peacock_vangogh.yaml",  # 孔雀·梵高（评审员）
        "honeybadger_pingtou.yaml",  # 蜜獾·平头哥（测试员）
        "pen_wenxin.yaml",       # 钢笔·文心（文档员）
    ]

    def __init__(self, config_dir: str | Path):
        self._dir = Path(config_dir)

    def load_all(self) -> list[PresetForgekinSpec]:
        specs: list[PresetForgekinSpec] = []
        for filename in self.PRESET_FILES:
            filepath = self._dir / filename
            if not filepath.exists:
                raise FileNotFoundError(f"preset forgekin YAML missing: {filepath}")
            with open(filepath, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)
            spec = PresetForgekinSpec(**data)
            specs.append(spec)
        return specs


class ForgekinConfigLoader:
    """forgemind 主配置加载器"""

    def __init__(self, config_path: str | Path):
        self._path = Path(config_path)

    def load(self) -> ForgekinConfig:
        with open(self._path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        return ForgekinConfig(**data["forgemind"])
```

#### 3.1.4 预置Forgekin YAML 配置示例

```yaml
# flowforge/forgemind/config/forgekins/owl_luban.yaml
forgekin_id: "preset_owl_luban"
name: "猫头鹰·鲁班"
species: "virtual"
physical_description: ""
virtual_description: "架构师 Forgekin，负责系统设计与架构决策"
sensor_channels: []
world_setting_id: "forgemind_workspace"
seed_capabilities:
  - "architecture_design"
  - "adr_drafting"
  - "dependency_analysis"
seed_memories:
  - "initial_arch_principles"
value_anchors:
  - "single_direction_dependency"
  - "config_driven_over_inheritance"
  - "composition_over_inheritance"
target_evolution_stage: "E3_sense"
max_evolution_stage: "E4_act"
responsibility: "架构师"
```

### 3.2 关键流程时序图

#### 3.2.1 ForgeMindPlugin 启动注册时序图

```
FlowForge启动     PluginRegistry     ForgeMindPlugin     SpeciesRegistry     ForgekinEngine
    │                   │                   │                   │                   │
    │ load_plugins    │                   │                   │                   │
    ├──────────────────▶│                   │                   │                   │
    │                   │                   │                   │                   │
    │                   │ discover ForgeMindPlugin              │                   │
    │                   ├──────────────────▶│                   │                   │
    │                   │                   │                   │                   │
    │                   │ register_forgekins (钩子1)          │                   │
    │                   ├──────────────────▶│                   │                   │
    │                   │◀── 5 形态枚举 ────┤                   │                   │
    │                   │                   │                   │                   │
    │                   │ register_forge_skills (钩子2)       │                   │
    │                   ├──────────────────▶│                   │                   │
    │                   │◀── skill->stage ─┤                   │                   │
    │                   │                   │                   │                   │
    │                   │ register_council_channels (钩子3)   │                   │
    │                   ├──────────────────▶│                   │                   │
    │                   │◀── council cfg ──┤                   │                   │
    │                   │                   │                   │                   │
    │                   │ register_auto_forge_config (钩子4)  │                   │
    │                   ├──────────────────▶│                   │                   │
    │                   │◀── auto_forge ───┤                   │                   │
    │                   │                   │                   │                   │
    │                   │ validate hooks non-empty              │                   │
    │                   │ (任一为空 -> 拒绝注册)                 │                   │
    │                   │                   │                   │                   │
    │                   │ register plugin in registry           │                   │
    │                   │ (调用 PluginRegistry.register)        │                   │
    │                   │                   │                   │                   │
    │                   │ load preset forgekins YAML            │                   │
    │                   ├──────────────────▶│                   │                   │
    │                   │                   │ load 5 YAML files │                   │
    │                   │                   ├──────────────────▶│                   │
    │                   │                   │                   │ register 5 specs  │
    │                   │                   │                   │                   │
    │                   │                   │                   │ mark engine ready │
    │                   │                   │                   ├──────────────────▶│
    │                   │                   │                   │                   │
    │◀── plugin loaded ─┤                   │                   │                   │
    │                   │                   │                   │                   │
```

#### 3.2.2 observe -> act -> verify 现实闭环时序图

```
operator          ForgekinEngine       ForgekinBase        Harness L3/L2/L4     F014 EchoStore
   │                    │                    │                    │                    │
   │ invoke(fk_id,      │                    │                    │                    │
   │   action, params)  │                    │                    │                    │
   ├───────────────────▶│                    │                    │                    │
   │                    │                    │                    │                    │
   │                    │ load_forgekin    │                    │                    │
   │                    │ (DI 注入依赖)       │                    │                    │
   │                    │                    │                    │                    │
   │                    │ observe          │                    │                    │
   │                    ├───────────────────▶│                    │                    │
   │                    │                    │ read sensors/world │                    │
   │                    │                    ├───────────────────▶│                    │
   │                    │                    │◀── snapshot ──────┤                    │
   │                    │                    │                    │                    │
   │                    │                    │ read recent echoes│                    │
   │                    │                    ├───────────────────────────────────────▶│
   │                    │                    │◀── echoes ────────────────────────────┤
   │                    │                    │                    │                    │
   │                    │◀── Observation ────┤                    │                    │
   │                    │                    │                    │                    │
   │                    │ 校验 action 白名单  │                    │                    │
   │                    │ (CapabilityProfile) │                    │                    │
   │                    │                    │                    │                    │
   │                    │ act(action, params)│                    │                    │
   │                    ├───────────────────▶│                    │                    │
   │                    │                    │ execute tool/action│                    │
   │                    │                    ├───────────────────▶│                    │
   │                    │                    │◀── result ────────┤                    │
   │                    │◀── ActionResult ───┤                    │                    │
   │                    │                    │                    │                    │
   │                    │ verify(evidence)   │                    │                    │
   │                    ├───────────────────▶│                    │                    │
   │                    │                    │ check governance  │                    │
   │                    │                    ├───────────────────▶│                    │
   │                    │                    │◀── violations ────┤                    │
   │                    │◀── bool ───────────┤                    │                    │
   │                    │                    │                    │                    │
   │                    │ if not verified:   │                    │                    │
   │                    │   rollback_action│                    │                    │
   │                    │                    │                    │                    │
   │◀── result ────────┤                    │                    │                    │
   │   {success: true,  │                    │                    │                    │
   │    observation,    │                    │                    │                    │
   │    action_result,  │                    │                    │                    │
   │    verified: true} │                    │                    │                    │
   │                    │                    │                    │                    │
```

### 3.3 错误处理

| 异常类型 | 触发场景 | 处理策略 | 调用方预期 |
|---------|---------|---------|-----------|
| `ForgekinNotFoundError` | forgekin_id 不存在或SoulImprint未注册 | 拒绝加载，返回 404 | 调用方校验 forgekin_id 后重试 |
| `PluginRegistrationError` | Plugin V3 四钩子返回空值或校验失败 | 拒绝整个 forgemind 注册，ForgekinEngine 拒绝加载 | operator 检查 YAML 配置后重启 |
| `SensorUnavailableError` | BIO/OBJ/HYBRID 形态Forgekin传感器离线 | 触发 F023 liveness degraded，observe 返回最近有效快照 | 调用方降级处理 |
| `ActionNotAllowedError` | action 不在 CapabilityProfile.allowed_actions 白名单 | 拒绝 act，返回 403 | 调用方修改 action 或升级能力画像 |
| `Tier0ConfirmationRequiredError` | 物理/不可逆操作未经 operator 二次确认 | 拒绝 act，返回 401 | 调用方获取 operator 确认后重试 |
| `GovernanceViolationError` | verify 检测到治理规则违反 | 触发回滚，返回 409 + need_rollback=true | 调用方回滚 + 告警 |
| `EvalThresholdNotMetError` | 觉醒阶晋升时 Eval 质量分 < 0.85 | 拒绝晋升，返回 403 | 调用方等待更高 Eval 信号 |
| `StageJumpForbiddenError` | 觉醒阶晋升跳级（如 E1 -> E3） | 拒绝晋升，返回 409 | 调用方按顺序逐级晋升 |
| `OperatorApprovalRequiredError` | 觉醒阶晋升未经 operator 审批 | 拒绝晋升，返回 401 | 调用方获取 operator 批准后重试 |
| `SoulImprintHashCollisionError` | SoulImprint hash 重复注册 | 拒绝注册，返回 409 | 调用方重新生成 hash |
| `ReverseDependencyError` | core/ import forgemind/ 被静态扫描发现 | CI 失败，拒绝合并 | 开发者重构依赖方向 |
| `ValidationError`（Pydantic） | 预置Forgekin YAML 字段缺失或类型错误 | 拒绝加载，启动失败 | operator 修正 YAML 后重启 |

**幂等性策略**：

- `SoulImprint.soul_imprint_hash` 全局唯一，重复注册抛 `IntegrityError`，调用方应重试。
- `ForgekinLineageRepository.append` 增量 append，record_id 使用 UUID v7，重复 append 由 Repository 层幂等处理。
- `execute_observe_act_verify` 非幂等（含副作用），调用方应使用 idempotency_key 包裹。
- `promote_evolution_stage` 幂等（同一 eval_signal 重复触发只生效一次，由 record_id 去重）。

### 3.4 性能优化

| 性能指标 | 目标值 | 优化手段 |
|---------|:------:|---------|
| `load_forgekin` 延迟 | < 50ms | SoulImprint + 进化记录 + 能力画像并行查询（asyncio.gather）；进程内 LRU 缓存（maxsize=256，TTL=300s） |
| `execute_observe_act_verify` 闭环延迟 | < 5s（含 LLM 调用） | observe/act/verify 串行（必须），但 act 内部工具调用并行；超时控制 30s |
| `register_forgekins` 启动延迟 | < 100ms | 5 形态枚举静态构造，无 I/O；YAML 加载并行 |
| 5 预置Forgekin加载延迟 | < 500ms | 5 个 YAML 文件并行加载 + Pydantic 校验 |
| `promote_evolution_stage` 延迟 | < 30ms | 单条 INSERT + 事件异步发射 |
| 并发 load_forgekin | 50 QPS | LRU 缓存命中率 > 90%；Repository 连接池 max_size=20 |
| DI 容器注入延迟 | < 1ms | 单例缓存，首次注入后直接返回 |

**缓存策略**：

- SoulImprint缓存：进程内 LRU（maxsize=256，TTL=300s），通过 `ForgekinLineageRepository.append` 事件主动失效。
- 能力画像缓存：复用 F001 CapabilityProfile 的缓存策略。
- 不缓存 ForgekinBase 实例：实例可能持有运行时状态（如 session_id），缓存导致状态污染。
- 预置Forgekin YAML 启动时一次性加载到内存，运行时直接读取。

**索引设计**：

- `mind_imprints` 表：主键 `imprint_id`，唯一索引 `soul_imprint_hash`，索引 `forgekin_id`。
- `forgekin_lineage` 表：主键 `record_id`，索引 `(forgekin_id, triggered_at)`。

---

## 4. 跨模块协作实现

### 4.1 上游依赖如何调用本模块

#### 4.1.1 FlowForge Plugin Registry 调用 ForgeMindPlugin

```python
# flowforge/core/plugin/registry.py（核心框架侧，不在本模块）
class PluginRegistry:
    async def load_plugins(self, container: DIContainer):
        # 扫描已注册插件，调用四钩子
        plugin = container.resolve("forge_mind_plugin")  # ForgeMindPlugin
        hooks = {
            "forgekins": plugin.register_forgekins,
            "forge_skills": plugin.register_forge_skills,
            "council_channels": plugin.register_council_channels,
            "auto_forge_config": plugin.register_auto_forge_config,
        }
        for name, value in hooks.items:
            if not value:
                raise PluginRegistrationError(f"hook {name} returned empty")
        self._registered["forgemind"] = hooks
```

**集成测试点**：FlowForge 启动后 Plugin Registry 中存在 forgemind 注册的 forgekins / forge_skills / council_channels / auto_forge_config 四类条目，且 5 形态枚举完整。

#### 4.1.2 ForgekinEngine 端口注入

forgemind 内部需要执行Forgekin时，通过 DI 注入 `ForgekinEnginePort`：

```python
# forgemind 内部代码（如 ForgePipeline）
class ForgePipelineImpl:
    def __init__(self, forgekin_engine: ForgekinEnginePort, ...):
        self._engine = forgekin_engine  # 端口注入，具体实现是 HarnessForgekinEngine

    async def verify_capability(self, forgekin_id: str, task: str) -> dict:
        return await self._engine.execute_observe_act_verify(
            forgekin_id=forgekin_id,
            action=task,
            params={},
        )
```

**集成测试点**：forgemind 不 import `core.harness.forgekin_engine_impl`，仅依赖 `ForgekinEnginePort` 抽象；DI 容器绑定 `ForgekinEnginePort -> HarnessForgekinEngine`。

#### 4.1.3 F001 CapabilityProfile 注入

```python
# forgemind 在锻造流水线第 ② 步注入能力画像
class CapabilityInjectHandler:
    def __init__(self, capability_profile_repo):  # F001 注入
        self._capability_repo = capability_profile_repo

    async def execute(self, state: ForgingPipelineState) -> str:
        profile = await self._capability_repo.inject(
            forgekin_id=state.forgekin_id,
            seed_capabilities=state.manifest.seed_capabilities,
        )
        state.capability_profile_ref = profile.profile_id
        return profile.profile_id  # artifact_id
```

### 4.2 下游影响如何被调用

#### 4.2.1 F027 形态分类如何消费本模块

F027 在 `forgemind/species.py` 落地 SpeciesRegistry，复用本模块的 `ForgekinSpecies` 枚举：

```python
# F027 侧代码（不在本模块，但在 forgemind 子目录）
from flowforge.forgemind.base import ForgekinSpecies  # 复用本模块枚举

class SpeciesRegistryImpl:
    async def assert_sensor_allowed(
        self, species: ForgekinSpecies, channel: str
    ) -> bool:
        if species == ForgekinSpecies.VIRTUAL:
            return False  # VIRTUAL 形态禁止物理传感器
        return True
```

**集成测试点**：F027 的 SpeciesRegistry 必须使用本模块定义的 `ForgekinSpecies` 枚举，不可重复定义。

#### 4.2.2 F028 锻造流水线如何消费本模块

F028 在 `forgemind/forging/pipeline.py` 落地 ForgePipeline，调用本模块的 `ForgekinEnginePort`：

```python
# F028 侧代码（不在本模块，但在 forgemind 子目录）
from flowforge.forgemind.engine import ForgekinEnginePort

class ForgingExecutorImpl:
    def __init__(self, forgekin_engine: ForgekinEnginePort, ...):
        self._engine = forgekin_engine

    async def verify_capability(self, forgekin_id: str) -> dict:
        # ⑤ 能力验证阶段调用 ForgekinEngine 执行闭环
        return await self._engine.execute_observe_act_verify(
            forgekin_id=forgekin_id,
            action="capability_verification",
            params={},
        )
```

#### 4.2.3 F029 / F030 如何消费本模块

F029 / F030 复用本模块的 `ForgekinBase` 抽象，通过 species 门控决定是否启用：

```python
# F029 侧代码（不在本模块）
class SensorRegistryImpl:
    async def bind(self, binding: SensorBinding) -> str:
        # 形态门控：VIRTUAL 形态禁止绑定物理传感器
        forgekin = await self._engine.load_forgekin(binding.forgekin_id)
        if forgekin.mind_imprint.species == ForgekinSpecies.VIRTUAL:
            raise SpeciesNotAllowedError("VIRTUAL species cannot bind physical sensor")
        # ... 绑定逻辑
```

#### 4.2.4 F036 / F037 / F038 / F039 如何消费本模块

- **F036 forgemind 与 *Forge 关系**：*Forge 通过 Plugin V3 复用本模块的 ForgekinBase / ForgePipeline 抽象，禁止 *Forge 重新定义通用Forgekin类。
- **F037 Forgekin市场**：本模块的 `ForgekinBase` 实例可通过 `ForgekinMarketplace.publish(forgekin)` 发布到市场。
- **F038 进化谱系**：本模块的 `ForgekinLineageRepository` 提供 `append / get_lineage / get_latest_record` 接口，F038 在此基础上落地谱系可视化。
- **F039 MindCodex**：本模块的 `forgemind/codex/` 目录承载MindCodex（MindCodex）知识库，F039 落地可检索索引。

### 4.3 集成测试点

| 测试编号 | 场景 | 验证点 |
|---------|------|-------|
| IT-D026-001 | FlowForge 启动后 Plugin Registry 中存在 forgemind 四钩子 | forgekins/forge_skills/council_channels/auto_forge_config 全部非空 |
| IT-D026-002 | 5 形态枚举完整注册 | BIO/ORG/OBJ/VIRTUAL/HYBRID 全部存在 |
| IT-D026-003 | 5 预置Forgekin YAML 加载 | 猫头鹰·鲁班 / 猎犬·夏洛克 / 孔雀·梵高 / 蜜獾·平头哥 / 钢笔·文心 全部加载成功 |
| IT-D026-004 | ForgekinEngine.load_forgekin DI 注入 | 返回的 ForgekinBase 实例依赖全部注入完成 |
| IT-D026-005 | observe -> act -> verify 闭环 | 三方法全部成功调用，返回 {success: true, verified: true} |
| IT-D026-006 | action 不在白名单 | 抛 ActionNotAllowedError |
| IT-D026-007 | Tier 0 操作未经确认 | 抛 Tier0ConfirmationRequiredError |
| IT-D026-008 | verify 失败触发回滚 | 返回 {need_rollback: true}，副作用回滚 |
| IT-D026-009 | 觉醒阶晋升 Eval 分数 < 0.85 | 抛 EvalThresholdNotMetError |
| IT-D026-010 | 觉醒阶晋升跳级（E1 -> E3） | 抛 StageJumpForbiddenError |
| IT-D026-011 | SoulImprint hash 重复注册 | 抛 SoulImprintHashCollisionError |
| IT-D026-012 | core/ import forgemind/ | CI 静态扫描失败 |
| IT-D026-013 | forgemind 包含 *Forge 业务代码 | CI 静态扫描失败（编程红线第 10 条） |
| IT-D026-014 | ForgekinBase 直接实例化 | CI 静态扫描失败（编程红线第 12 条） |
| IT-D026-015 | ForgeMindPlugin 四钩子任一返回空 | 抛 PluginRegistrationError |
| IT-D026-016 | 50 并发 load_forgekin | LRU 缓存命中，无死锁 |
| IT-D026-017 | MindCouncil 召集MindCouncil | 复用 F002 TeamAct，决议写入 F014 EchoStore |
| IT-D026-018 | VIRTUAL 形态绑定物理传感器 | F029 形态门控拒绝 |
| IT-D026-019 | BIO 形态绑定虚拟世界设定 | F030 形态门控拒绝 |
| IT-D026-020 | 进化阶晋升后SoulImprint species 不变 | SoulImprint species 字段保留原值，新 species 在 ForgekinLineage |

---

## 5. 详细设计验收

### 5.1 功能验收 AC

- [ ] **AC-F-1**: forgemind 通过 Plugin V3 四钩子注册到 FlowForge Plugin Registry，5 形态枚举完整（IT-D026-001/002）。
- [ ] **AC-F-2**: 5 预置Forgekin YAML 外置到 `forgemind/config/forgekins/*.yaml`，启动时加载成功（IT-D026-003）。
- [ ] **AC-F-3**: `ForgekinEngine.load_forgekin` 通过 DI 注入依赖，返回 ForgekinBase 实例（IT-D026-004）。
- [ ] **AC-F-4**: `observe -> act -> verify` 三方法契约可端到端调用，5 形态Forgekin均实现三方法（IT-D026-005）。
- [ ] **AC-F-5**: act 校验 action 白名单，非法 action 被拒绝（IT-D026-006）。
- [ ] **AC-F-6**: Tier 0 不可逆操作未经 operator 确认时被拒绝（IT-D026-007）。
- [ ] **AC-F-7**: verify 失败时触发回滚，返回 need_rollback=true（IT-D026-008）。
- [ ] **AC-F-8**: 觉醒阶晋升 Eval 分数 < 0.85 时被拒绝（IT-D026-009）。
- [ ] **AC-F-9**: 觉醒阶晋升禁止跳级，必须逐级晋升（IT-D026-010）。
- [ ] **AC-F-10**: SoulImprint hash 全局唯一，重复注册被拒绝（IT-D026-011）。
- [ ] **AC-F-11**: 觉醒阶晋升后SoulImprint species 字段保留原值，新 species 仅在 ForgekinLineage（IT-D026-020）。
- [ ] **AC-F-12**: MindCouncil 召集MindCouncil复用 F002 TeamAct，决议写入 F014 EchoStore（IT-D026-017）。

### 5.2 性能验收

- [ ] **AC-P-1**: `load_forgekin` 延迟 < 50ms（P95，缓存命中时 < 5ms）。
- [ ] **AC-P-2**: `execute_observe_act_verify` 闭环延迟 < 5s（P95，含 LLM 调用）。
- [ ] **AC-P-3**: `register_forgekins` 启动延迟 < 100ms。
- [ ] **AC-P-4**: 5 预置Forgekin加载延迟 < 500ms。
- [ ] **AC-P-5**: 50 并发 `load_forgekin` 无死锁、无数据丢失（IT-D026-016）。
- [ ] **AC-P-6**: LRU 缓存命中率 > 90%（长期运行后采样统计）。

### 5.3 安全验收

- [ ] **AC-S-1**: 单向依赖通过 —— `grep -r "from forgemind" flowforge/core/` 返回 0 结果（IT-D026-012）。
- [ ] **AC-S-2**: DI 容器注入通过 —— 无 `ForgekinBase` / `SpeciesRegistry` 直接实例化代码（IT-D026-014）。
- [ ] **AC-S-3**: Repository 层通过 —— SoulImprint/进化记录写入均通过 Repository 抽象，无 `cursor.execute` 调用。
- [ ] **AC-S-4**: 配置驱动通过 —— 5 形态定义、6 步锻造清单、5 预置Forgekin均 YAML 外置，无 .py 硬编码。
- [ ] **AC-S-5**: 业务领域代码零容忍 —— forgemind/ 目录无内容创作/小说/电商/开发等垂直业务代码（IT-D026-013）。
- [ ] **AC-S-6**: Tier 0 不可逆操作必须 operator 二次确认（IT-D026-007）。
- [ ] **AC-S-7**: SoulImprint hash 全局唯一，防止身份漂移（IT-D026-011）。
- [ ] **AC-S-8**: 觉醒阶晋升必须经 Eval 信号触发 + operator 审批，防止越权晋升（IT-D026-009/010）。

### 5.4 Eval 验收

- [ ] **AC-E-1**: 本模块作为 harness 组件，必须附 EvalContract（F018 五问）。
- [ ] **AC-E-2**: friction_metrics 包含：`load_forgekin_latency_ms` / `observe_act_verify_duration_ms` / `cache_hit_rate`。
- [ ] **AC-E-3**: regression_cases 覆盖 IT-D026-001 ~ IT-D026-020。
- [ ] **AC-E-4**: sunset_signals：`unused_days=90` / `friction_above_threshold=load_latency > 200ms` / `superseded_by=F036 forge_relationship`。
- [ ] **AC-E-5**: 信号采集器在 F019 SignalCollector 中注册：`forgemind_engine_latency_probe`。
- [ ] **AC-E-6**: 觉醒阶晋升的 Eval 信号必须包含 `quality_score >= 0.85` + `operator_approved` + `rationale` 三字段。

---

## 6. 引用

- [doc:../spec.md#§3.8]（FR-CORE-008）
- [doc:../spec.md#§2.6]（5 种形态分类）
- [doc:../spec.md#§2.5]（进化阶/觉醒阶三标注）
- [doc:../arch.md#§3.8]（forgemind 应用层 + 5 种形态分类）
- [doc:../arch.md#§2.5]（forgemind 应用层模块总览）
- [doc:../design.md#§3.8]
- [doc:../features/F026-forgemind-app-layer.md]（同号 Feature 级 SRS）
- [doc:../architecture/A026-forgemind-app-layer.md]（同号 Feature 级 SAD）
- [doc:../features/F027-all-things-spirit-species.md]
- [doc:../features/F028-forging-pipeline.md]
- [doc:../features/F029-physical-ai-sensors.md]
- [doc:../features/F030-virtual-world-setting.md]
- [doc:../features/F036-forgemind-forge-relationship.md]
- [doc:../features/F037-forgemind-marketplace.md]
- [doc:../features/F038-forgemind-lineage.md]
- [doc:../features/F039-mind-codex-searchable.md]
- [doc:../decisions/005-forgemind-application-layer.md]
- [doc:../decisions/013-all-things-spirit-mind-vision.md]
- [doc:../design/naming-contract.md]（双轨命名 + 三标注规范）
- [doc:../../CONTRIBUTING.md]
- [doc:../../CONTRIBUTING.md#31-15-条编程红线违反即拒绝合入]（第 10/12 条）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（详细设计骨架 + 类图 + Pydantic Models + 接口实现 + 时序图 + 错误处理 + 性能优化 + 跨模块协作 + AC） | 开发者 Forgekin（猎犬·夏洛克） |
