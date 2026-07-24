# D030: 虚拟世界设定层详细设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.12]（FR-CORE-012）
> **对应 arch.md**: [doc:../arch.md#§3.12]
> **对应 design.md**: [doc:../design.md#§3.12]（本文件）
> **对应 Feature**: [doc:../features/F030-virtual-world-setting.md]（同号 Feature 级 SRS）
> **对应 Architecture**: [doc:../architecture/A030-virtual-world-setting.md]（同号架构设计）
> **依赖 ADR**: [doc:../decisions/013-all-things-spirit-mind-vision.md]

---

## 1. 详细设计上下文

### 1.1 设计问题

forgemind 应用层需要为 VIRTUAL/HYBRID 形态Forgekin提供虚拟世界承载层，对标业界 Character AI（虚拟角色智能体）/ NPC Agent / Persona-Driven Agent 工程实现路径。A030 已固化三层世界引擎 + 9 一等公民 + 三路记忆 + Role Mask 五层 + Canon Sync 铁律 + 世界自转架构，本详细设计在 `forgemind/worlds/` 落地具体实现，解决以下工程层问题：

1. **三层世界引擎未落地**：Core Identity Layer / World Layer / Bridge Layer 三层架构在 A030 已定义，但 `forgemind/worlds/core_identity.py` / `world_setting.py` / `bridge.py` 未实现。
2. **9 一等公民建模未实现**：World/Character/Scene/Canon Decision/Relationship/Artifact/Round/Branch/Turn 九个一等公民枚举与数据模型未编写。
3. **Core Identity 四字段不可变保护未编码**：`soul_imprint` / `species` / `core_values` / `core_personality` 四字段永不可被 Episode 修改的 `CoreIdentityGuard` 未实现。
4. **三路记忆隔离未实现**：Canon / Relational / Session 三路记忆分别写入 EchoStore 不同 Collection 的机制未编码。
5. **CanonSyncGate RP 台词入典审批未实现**：`submit_for_canon` / `approve_canon` / `reject_canon` 三方法契约未落地，auto_canon_on_world_event=false 铁律未编码。
6. **RoleMaskCoordinator 五层 wear/take_off 未实现**：L1 路由身份 / L2 基础设施 / L3 本体能力 / L4 场景皮肤 / L5 世界内状态五层独立加载/卸载机制未编码。
7. **WorldDriver.tick 世界自转未实现**：定时推进世界时间 + NPC 角色/关系/场景自演化 + 世界事件经 Canon Sync 入典的流程未编码。
8. **形态门控未集成**：`WorldSetting.load` 调用 `SpeciesRegistry.assert_world_setting_allowed` 的调用链未实现，BIO/ORG/OBJ 形态绑定被拒绝。

### 1.2 设计约束

- **单向依赖约束**：`forgemind/worlds/` 必须单向依赖 `flowforge/core/` 中的 F014 EchoStore Repository + `forgemind/species/`（F027 SpeciesRegistry），禁止 `import` 任何 *Forge 业务模块。
- **DI 容器约束**：`WorldDriver` / `RoleMaskCoordinator` / `CanonSyncGate` / `CoreIdentityGuard` 实例必须通过 DI 容器注入，禁止直接实例化。
- **Repository 层约束**：Canon / Relational / Session 三路记忆写入必须通过 `EchoStoreRepository.append`，禁止直接操作数据库。
- **配置驱动约束**：`world_settings` / `core_identity_guard` / `bridge_protocols` / `role_mask` 配置必须 YAML 外置到 `forgemind/config/worlds.yaml`，禁止 `.py` 硬编码角色/世界观。
- **形态门控约束**：`WorldSetting.load` 必须调用 `SpeciesRegistry.assert_world_setting_allowed` 校验形态合法性，BIO/ORG/OBJ 形态绑定被拒绝。
- **Core Identity 不可变约束**：`soul_imprint` / `species` / `core_values` / `core_personality` 四字段永不可被任何 Episode 修改。
- **Canon Sync 铁律约束**：RP 台词必须经 `CanonSyncGate` 显式批准才能进入 Canon 记忆，`auto_canon_on_world_event=false`。

### 1.3 设计影响

- **对 F027 形态分类的影响**：`WorldSetting.load` 调用 `SpeciesRegistry.assert_world_setting_allowed` 校验形态门控，强化"形态决定接入层"约束。
- **对 F014 多域记忆的影响**：Canon / Relational / Session 三路记忆分别写入 EchoStore 不同 Collection，存储相互隔离。
- **对 F038 进化谱系的影响**：Core Identity 作为Forgekin不可变身份锚点，参与谱系追踪。
- **对 ForgekinBase.observe / act 的影响**：VIRTUAL 形态Forgekin的 observe/act 通过 `WorldSetting` 读取/改变虚拟世界状态。
- **对 F031 三方 Agent 适配层的影响**：三方 Agent 的 System Prompt Configuration Map 可引用 `WorldSetting` 作为角色边界。

---

## 2. 详细设计

### 2.1 组件设计图

```
                    +-------------------------------------------------+
                    |             forgemind/worlds/                  |
                    |                                                 |
                    |  === Core Identity Layer (CL-007 不可变身份) ===|
                    |  +-------------------+   +-------------------+ |
                    |  | CoreIdentity      |   | CoreIdentityGuard |
                    |  | (immutable 四字段)|<->| (污染检测)         |
                    |  +-------------------+   +---------+---------+ |
                    |                                              |   |
                    |  === World Layer (CL-008 9 一等公民建模) === |<--+
                    |  +-------------------+   +-------------------+ |
                    |  | FirstClassCitizen |   | WorldSetting      | |
                    |  | (9 枚举)          |<->| (world_id + 9 公民)| |
                    |  +-------------------+   +---------+---------+ |
                    |                                              |   |
                    |  +-------------------+   +-------------------+ |
                    |  | CanonMemory      |   | RelationalMemory  | |
                    |  | (永久,世界级真相) |   | (长期,角色互动)    | |
                    |  +---------+---------+   +---------+---------+ |
                    |            |                       |           |
                    |  +---------v---------+   +---------v---------+ |
                    |  | SessionMemory     |<->| MemoryRouter      | |
                    |  | (临时,单次回合)   |   | (三路写入路由)    | |
                    |  +-------------------+   +-------------------+ |
                    |                                                 |
                    |  === Bridge Layer (CL-011/012 三协议) ===       |
                    |  +-------------------+   +-------------------+ |
                    |  | RoleMaskLayer     |   | BridgeProtocol    | |
                    |  | (5 层枚举)        |   | (3 协议枚举)      | |
                    |  +---------+---------+   +---------+---------+ |
                    |            |                       |           |
                    |  +---------v---------+   +--------v----------+|
                    |  | RoleMaskCoord     |   | CanonSyncGate     ||
                    |  | (runtime director)|   | (RP 入典审批门)   ||
                    |  +---------+---------+   +-------------------+|
                    |  +-------------------+                         |
                    |  | WorldDriver       |  (世界自转 tick)        |
                    |  +---------+---------+                         |
                    |            |                                   |
                    |  +---------v---------+                         |
                    |  | WorldEventEmitter |  (世界事件 -> CanonSync)|
                    |  +-------------------+                         |
                    +-------------------------------------------------+
                                          |
                                          v
                    +-------------------------------------------+
                    |  F014 EchoStore Repository（三路记忆隔离）|
                    |  +----------------+  +----------------+   |
                    |  | canon_coll     |  | relational_coll|   |
                    |  +----------------+  +----------------+   |
                    |  +----------------+                      |
                    |  | session_coll   |                      |
                    |  +----------------+                      |
                    +-------------------------------------------+
```

### 2.2 关键设计决策

- **决策 1：三层世界引擎隔离 + Core Identity 永不可变**
  Core Identity Layer 永不可变；World Layer 承载 9 一等公民建模与三路记忆；Bridge Layer 提供三协议（Role Mask / Canon Sync / World Driver）。三层分离保证核心身份不被 RP 污染。

- **决策 2：Core Identity 四字段永不可变 + 污染检测**
  `soul_imprint` / `species` / `core_values` / `core_personality` 四字段在Forgekin整个生命周期永不可被任何 Episode 修改。`CoreIdentityGuard.assert_not_polluted` 在每次 Episode 后强制校验，对比四字段与持久化版本。

- **决策 3：9 一等公民枚举固定 + WorldSetting 聚合**
  `FirstClassCitizen` 固定为 WORLD / CHARACTER / SCENE / CANON_DECISION / RELATIONSHIP / ARTIFACT / ROUND / BRANCH / TURN 九个值。`WorldSetting` 通过 `citizens: dict[FirstClassCitizen, list[str]]` 聚合 9 公民实例 ID。

- **决策 4：三路记忆严格隔离 + MemoryRouter 路由**
  `MemoryRouter.route(memory_type)` 根据记忆类型路由到不同 EchoStore Collection：Canon -> `canon_collection` / Relational -> `relational_collection` / Session -> `session_collection`。三路记忆存储相互隔离。

- **决策 5："RP 台词不自动入典"铁律（CL-010）**
  RP 中Forgekin说的话、做的事进入 Session 记忆，必须经 `CanonSyncGate` 显式批准（operator 或 Canon Driver 审批）才能进入 Canon 记忆。`auto_canon_on_world_event=false`，世界事件也需 Canon Sync。

- **决策 6：Role Mask 五层独立 wear/take_off + L4 不污染 L3**
  L1 路由身份 / L2 基础设施 / L3 本体能力 / L4 场景皮肤（RP 角色）/ L5 世界内状态五层独立 wear/take_off。`RoleMaskCoordinator.assert_l4_not_polluting_l3` 在 L4 卸载后强制校验 L3 本体能力未被污染。

- **决策 7：WorldDriver 定时推进世界自转 + 世界事件经 Canon Sync**
  `WorldDriver.tick(world_id)` 按 `tick_interval_seconds`（默认 3600s）定时推进世界时间，NPC 角色/关系/场景自演化。世界事件写入 Canon 记忆需 Canon Sync 确认（`auto_canon_on_world_event=false`）。

### 2.3 设计不变量

- Core Identity 四字段（`soul_imprint` / `species` / `core_values` / `core_personality`）必须永不可变，禁止任何 Episode 修改。
- 9 一等公民必须全部建模且写入 World Layer，禁止扁平 persona 文本。
- Canon / Relational / Session 三路记忆必须存储相互隔离，写入不同 EchoStore Collection。
- RP 台词必须经 `CanonSyncGate` 显式批准才能进入 Canon 记忆，`auto_canon_on_world_event=false`。
- Role Mask 五层必须独立 wear/take_off，L4 场景皮肤不污染 L3 本体能力。
- Bridge Layer 三协议（Role Mask / Canon Sync / World Driver）必须可编排，runtime coordinator 必须存在。
- `WorldDriver.tick` 必须按配置间隔推进世界自转，世界事件仍需 Canon Sync。
- `WorldSetting.load` 必须调用 `SpeciesRegistry.assert_world_setting_allowed` 校验形态门控，BIO/ORG/OBJ 形态绑定被拒绝。
- 虚拟世界设定配置必须 YAML 外置到 `forgemind/config/worlds.yaml`，禁止 `.py` 硬编码角色/世界观。

---

## 3. 模块实现

### 3.1 类图

```
                    +---------------------------------------+
                    | FirstClassCitizen (Enum)              |
                    +---------------------------------------+
                    | WORLD / CHARACTER / SCENE             |
                    | CANON_DECISION / RELATIONSHIP         |
                    | ARTIFACT / ROUND / BRANCH / TURN      |
                    +---------------------------------------+

                    +---------------------------------------+
                    | CoreIdentity (Pydantic, immutable)    |
                    +---------------------------------------+
                    | soul_imprint: str                     |
                    | species: str                          |
                    | core_values: list[str]                |
                    | core_personality: str                 |
                    | created_at: datetime                  |
                    +---------------------------------------+

                    +---------------------------------------+
                    | WorldSetting (Pydantic)               |
                    +---------------------------------------+
                    | world_id: str                         |
                    | name: str                             |
                    | citizens: dict[FirstClassCitizen,     |
                    |              list[str]]               |
                    | canon_memory_ref: str                 |
                    | relational_memory_ref: str            |
                    | session_memory_ref: str               |
                    +---------------------------------------+

                    +---------------------------------------+
                    | RoleMaskLayer (Enum)                  |
                    +---------------------------------------+
                    | L1_ROUTING / L2_INFRA                 |
                    | L3_OWN_CAPABILITY / L4_SCENE_SKIN     |
                    | L5_IN_WORLD_STATE                     |
                    +---------------------------------------+

                    +---------------------------------------+
                    | BridgeProtocol (Enum)                 |
                    +---------------------------------------+
                    | ROLE_MASK / CANON_SYNC / WORLD_DRIVER |
                    +---------------------------------------+

                    +---------------------------------------+
                    | CoreIdentityGuard (ABC + Impl)        |
                    +---------------------------------------+
                    | + get_immutable(forgekin_id)          |
                    | + assert_not_polluted(forgekin_id,    |
                    |   episode_data) -> bool               |
                    | + create_immutable(forgekin_id, ...)  |
                    +---------------------------------------+

                    +---------------------------------------+
                    | CanonSyncGate (ABC + Impl)            |
                    +---------------------------------------+
                    | + submit_for_canon(episode_id,        |
                    |   content) -> request_id              |
                    | + approve_canon(request_id, approver) |
                    | + reject_canon(request_id, reason)    |
                    +---------------------------------------+

                    +---------------------------------------+
                    | WorldDriver (ABC + Impl)              |
                    +---------------------------------------+
                    | + tick(world_id)                      |
                    | + emit_world_event(world_id) -> list  |
                    | + start_auto_tick(world_id, interval) |
                    | + stop_auto_tick(world_id)            |
                    +---------------------------------------+

                    +---------------------------------------+
                    | RoleMaskCoordinator (ABC + Impl)      |
                    +---------------------------------------+
                    | + wear_mask(forgekin_id, layer,       |
                    |   mask_id)                            |
                    | + take_off_mask(forgekin_id, layer)   |
                    | + assert_l4_not_polluting_l3(         |
                    |   forgekin_id) -> bool                |
                    +---------------------------------------+

                    +---------------------------------------+
                    | MemoryRouter (Impl)                   |
                    +---------------------------------------+
                    | + route(memory_type, content) ->      |
                    |   echo_entry_id                       |
                    +---------------------------------------+
```

### 3.2 Python 实现：`flowforge/forgemind/worlds/core_identity.py`

```python
"""Core Identity Layer 实现（CL-007 不可变身份）。"""
from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger(__name__)


class CoreIdentity(BaseModel):
    """核心身份（CL-007，永不可变四字段）。

    一旦创建，四字段永不可被任何 Episode 修改。
    CoreIdentityGuard 在每次 Episode 后强制校验。
    """
    soul_imprint: str                          # SoulImprint（不可变身份锚点）
    species: str                               # 形态（F027）
    core_values: list[str]                     # 核心价值锚点（不可变）
    core_personality: str                      # 核心性格（不可变）
    forgekin_id: str                           # 所属Forgekin
    created_at: datetime = Field(default_factory=datetime.utcnow)

    model_config = {"frozen": True}  # Pydantic 不可变模型


class CoreIdentityGuard(ABC):
    """Core Identity 守卫（CL-007）。"""

    @abstractmethod
    async def get_immutable(self, forgekin_id: str) -> CoreIdentity:
        """获取不可变 Core Identity。"""
        raise NotImplementedError

    @abstractmethod
    async def assert_not_polluted(
        self, forgekin_id: str, episode_data: dict
    ) -> bool:
        """断言 Episode 未污染 Core Identity。

        校验四字段与持久化版本完全一致：
        - soul_imprint
        - species
        - core_values
        - core_personality
        """
        raise NotImplementedError

    @abstractmethod
    async def create_immutable(
        self,
        forgekin_id: str,
        soul_imprint: str,
        species: str,
        core_values: list[str],
        core_personality: str,
    ) -> CoreIdentity:
        """创建不可变 Core Identity（仅在锻造流水线 ① 阶段调用一次）。"""
        raise NotImplementedError


class HarnessCoreIdentityGuard(CoreIdentityGuard):
    """CoreIdentityGuard 具体实现。

    依赖通过构造函数注入（DI 容器管理）：
    - identity_repo: CoreIdentityRepository（持久化到 F008）
    """

    def __init__(
        self,
        identity_repo: "CoreIdentityRepository",
    ) -> None:
        self._identity_repo = identity_repo

    async def get_immutable(self, forgekin_id: str) -> CoreIdentity:
        return await self._identity_repo.get(forgekin_id)

    async def assert_not_polluted(
        self, forgekin_id: str, episode_data: dict
    ) -> bool:
        original = await self._identity_repo.get(forgekin_id)
        # 校验四字段未被 episode 修改
        for field in ("soul_imprint", "species", "core_values", "core_personality"):
            episode_value = episode_data.get("core_identity", {}).get(field)
            if episode_value is None:
                continue
            original_value = getattr(original, field)
            if episode_value != original_value:
                logger.error(
                    "core_identity_polluted",
                    forgekin_id=forgekin_id,
                    field=field,
                    original=original_value,
                    polluted=episode_value,
                )
                return False
        return True

    async def create_immutable(
        self,
        forgekin_id: str,
        soul_imprint: str,
        species: str,
        core_values: list[str],
        core_personality: str,
    ) -> CoreIdentity:
        # 校验是否已存在（仅允许创建一次）
        existing = await self._identity_repo.get_optional(forgekin_id)
        if existing is not None:
            raise RuntimeError(
                f"CoreIdentity already exists for forgekin {forgekin_id}; "
                f"immutable once created"
            )
        identity = CoreIdentity(
            soul_imprint=soul_imprint,
            species=species,
            core_values=core_values,
            core_personality=core_personality,
            forgekin_id=forgekin_id,
        )
        await self._identity_repo.save(identity)
        logger.info(
            "core_identity_created",
            forgekin_id=forgekin_id,
            soul_imprint=soul_imprint,
            species=species,
        )
        return identity
```

### 3.3 Python 实现：`flowforge/forgemind/worlds/world_setting.py`

```python
"""World Layer 实现（CL-008 9 一等公民建模 + 三路记忆）。"""
from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger
from flowforge.forgemind.species import SpeciesRegistry  # F027

logger = get_logger(__name__)


class FirstClassCitizen(str, Enum):
    """9 个一等公民（CL-008，不可扩展）。"""
    WORLD = "world"                 # World 世界设定
    CHARACTER = "character"         # Character 角色
    SCENE = "scene"                 # Scene 场景
    CANON_DECISION = "canon"        # Canon Decision 典藏决策
    RELATIONSHIP = "relationship"   # Relationship 关系
    ARTIFACT = "artifact"           # Artifact 造物
    ROUND = "round"                 # Round 回合
    BRANCH = "branch"               # Branch 分支
    TURN = "turn"                   # Turn 轮次


class MemoryType(str, Enum):
    """三路记忆类型。"""
    CANON = "canon"             # Canon 永久（世界级真相）
    RELATIONAL = "relational"   # Relational 长期（角色互动）
    SESSION = "session"         # Session 临时（单次回合）


class WorldSetting(BaseModel):
    """虚拟世界设定。"""
    world_id: str
    name: str                                  # 如"西游世界观"
    citizens: dict[FirstClassCitizen, list[str]] = Field(default_factory=dict)
    canon_memory_ref: str = ""                 # Canon 典藏记忆 ref
    relational_memory_ref: str = ""            # Relational 关系记忆 ref
    session_memory_ref: str = ""               # Session 会话记忆 ref
    created_at: datetime = Field(default_factory=datetime.utcnow)


class MemoryRouter:
    """三路记忆路由器。

    根据记忆类型路由到不同 EchoStore Collection。
    """

    def __init__(
        self,
        echo_store_repo: "EchoStoreRepository",  # F014
    ) -> None:
        self._echo_repo = echo_store_repo
        # 三路 Collection 名固定
        self._collection_map: dict[MemoryType, str] = {
            MemoryType.CANON: "canon_collection",
            MemoryType.RELATIONAL: "relational_collection",
            MemoryType.SESSION: "session_collection",
        }

    async def route(
        self,
        forgekin_id: str,
        world_id: str,
        memory_type: MemoryType,
        content: dict,
        tags: Optional[list[str]] = None,
    ) -> str:
        """路由记忆到对应 EchoStore Collection。"""
        collection = self._collection_map[memory_type]
        all_tags = ["world", memory_type.value, world_id]
        if tags:
            all_tags.extend(tags)
        echo_entry_id = await self._echo_repo.append(
            forgekin_id=forgekin_id,
            collection=collection,
            content=content,
            tags=all_tags,
        )
        logger.debug(
            "memory_routed",
            forgekin_id=forgekin_id,
            world_id=world_id,
            memory_type=memory_type.value,
            collection=collection,
            echo_entry_id=echo_entry_id,
        )
        return echo_entry_id

    def get_collection(self, memory_type: MemoryType) -> str:
        return self._collection_map[memory_type]


class WorldSettingService:
    """WorldSetting 服务（含形态门控 + 三路记忆初始化）。"""

    def __init__(
        self,
        species_registry: SpeciesRegistry,  # F027
        memory_router: MemoryRouter,
        world_setting_repo: "WorldSettingRepository",
    ) -> None:
        self._species_registry = species_registry
        self._memory_router = memory_router
        self._world_repo = world_setting_repo

    async def load(
        self,
        forgekin_id: str,
        world_setting_id: str,
    ) -> WorldSetting:
        """加载虚拟世界设定（含形态门控校验）。"""
        # 1. 读取 world setting
        world = await self._world_repo.get(world_setting_id)
        if world is None:
            raise KeyError(f"world setting not found: {world_setting_id}")
        # 2. 形态门控校验
        # 通过 forgekin_id 查询 species（实际由 ForgekinRepository 实现）
        species = await self._lookup_species(forgekin_id)
        await self._species_registry.assert_world_setting_allowed(species)
        # 3. 初始化三路记忆 Collection（如果未初始化）
        if not world.canon_memory_ref:
            world.canon_memory_ref = f"canon:{world.world_id}"
        if not world.relational_memory_ref:
            world.relational_memory_ref = f"relational:{world.world_id}"
        if not world.session_memory_ref:
            world.session_memory_ref = f"session:{world.world_id}"
        await self._world_repo.save(world)
        logger.info(
            "world_setting_loaded",
            forgekin_id=forgekin_id,
            world_id=world.world_id,
            species=species,
        )
        return world

    async def _lookup_species(self, forgekin_id: str) -> str:
        """通过 forgekin_id 查询 species（实际由 ForgekinRepository 实现）。"""
        # 占位实现，实际由调用方注入
        return "virtual"  # 默认 VIRTUAL

    async def add_citizen(
        self,
        world_id: str,
        citizen_type: FirstClassCitizen,
        citizen_id: str,
    ) -> None:
        """添加一等公民实例到 WorldSetting。"""
        world = await self._world_repo.get(world_id)
        if world is None:
            raise KeyError(f"world not found: {world_id}")
        if citizen_type not in world.citizens:
            world.citizens[citizen_type] = []
        if citizen_id not in world.citizens[citizen_type]:
            world.citizens[citizen_type].append(citizen_id)
        await self._world_repo.save(world)
```

### 3.4 Python 实现：`flowforge/forgemind/worlds/canon_sync.py`

```python
"""CanonSyncGate 实现（CL-010 铁律：RP 台词不自动入典）。"""
from __future__ import annotations

import uuid
from abc import ABC, abstractmethod
from datetime import datetime, timedelta
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger
from flowforge.forgemind.worlds.world_setting import MemoryRouter, MemoryType

logger = get_logger(__name__)


class CanonRequestStatus(str, Enum):
    """Canon 入典请求状态。"""
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    EXPIRED = "expired"


class CanonRequest(BaseModel):
    """Canon 入典请求。"""
    request_id: str
    world_id: str
    forgekin_id: str
    episode_id: str
    content: dict
    submitted_at: datetime = Field(default_factory=datetime.utcnow)
    reviewed_at: Optional[datetime] = None
    reviewed_by: Optional[str] = None
    status: CanonRequestStatus = CanonRequestStatus.PENDING
    rejection_reason: Optional[str] = None


# Session 记忆自动清理时间（默认 72h）
SESSION_AUTO_CLEANUP_HOURS = 72


class CanonSyncGate(ABC):
    """Canon Sync 门（CL-010 铁律）。"""

    @abstractmethod
    async def submit_for_canon(
        self,
        forgekin_id: str,
        world_id: str,
        episode_id: str,
        content: dict,
    ) -> str:
        """提交 Canon 入典请求（返回 request_id）。"""
        raise NotImplementedError

    @abstractmethod
    async def approve_canon(
        self,
        request_id: str,
        approver: str,
    ) -> None:
        """批准入典（operator 或 Canon Driver）。"""
        raise NotImplementedError

    @abstractmethod
    async def reject_canon(
        self,
        request_id: str,
        reason: str,
    ) -> None:
        """驳回入典。"""
        raise NotImplementedError

    @abstractmethod
    async def write_session_memory(
        self,
        forgekin_id: str,
        world_id: str,
        episode_id: str,
        content: dict,
    ) -> str:
        """写入 Session 记忆（RP 台词默认入口，未经 Canon Sync 批准不进入 Canon）。"""
        raise NotImplementedError


class HarnessCanonSyncGate(CanonSyncGate):
    """CanonSyncGate 具体实现。

    依赖通过构造函数注入（DI 容器管理）：
    - request_repo: CanonRequestRepository
    - memory_router: MemoryRouter
    - session_cleanup_scheduler: SessionCleanupScheduler
    """

    def __init__(
        self,
        request_repo: "CanonRequestRepository",
        memory_router: MemoryRouter,
    ) -> None:
        self._request_repo = request_repo
        self._memory_router = memory_router

    async def submit_for_canon(
        self,
        forgekin_id: str,
        world_id: str,
        episode_id: str,
        content: dict,
    ) -> str:
        """提交 Canon 入典请求。

        流程：
        1. 内容先写入 Session 记忆（默认入口）
        2. 创建 PENDING Canon 请求
        3. 等待 operator 或 Canon Driver 审批
        """
        # 1. 写入 Session 记忆
        session_entry_id = await self._memory_router.route(
            forgekin_id=forgekin_id,
            world_id=world_id,
            memory_type=MemoryType.SESSION,
            content=content,
            tags=[f"episode:{episode_id}", "pending_canon"],
        )
        # 2. 创建 PENDING 请求
        request_id = f"canon-req-{uuid.uuid4.hex[:10]}"
        request = CanonRequest(
            request_id=request_id,
            world_id=world_id,
            forgekin_id=forgekin_id,
            episode_id=episode_id,
            content=content,
            status=CanonRequestStatus.PENDING,
        )
        # 关联 session_entry_id（用于审批后迁移到 Canon）
        request.content["_session_entry_id"] = session_entry_id
        await self._request_repo.save(request)
        logger.info(
            "canon_request_submitted",
            request_id=request_id,
            forgekin_id=forgekin_id,
            world_id=world_id,
            episode_id=episode_id,
        )
        return request_id

    async def approve_canon(
        self,
        request_id: str,
        approver: str,
    ) -> None:
        """批准入典。"""
        request = await self._request_repo.get(request_id)
        if request is None:
            raise KeyError(f"canon request not found: {request_id}")
        if request.status != CanonRequestStatus.PENDING:
            raise RuntimeError(
                f"request {request_id} status is {request.status.value}, "
                f"cannot approve"
            )
        # 写入 Canon 记忆（永久）
        canon_entry_id = await self._memory_router.route(
            forgekin_id=request.forgekin_id,
            world_id=request.world_id,
            memory_type=MemoryType.CANON,
            content=request.content,
            tags=[f"episode:{request.episode_id}", f"approved_by:{approver}"],
        )
        # 更新请求状态
        request.status = CanonRequestStatus.APPROVED
        request.reviewed_at = datetime.utcnow
        request.reviewed_by = approver
        request.content["_canon_entry_id"] = canon_entry_id
        await self._request_repo.save(request)
        logger.info(
            "canon_request_approved",
            request_id=request_id,
            approver=approver,
            canon_entry_id=canon_entry_id,
        )

    async def reject_canon(
        self,
        request_id: str,
        reason: str,
    ) -> None:
        """驳回入典。"""
        request = await self._request_repo.get(request_id)
        if request is None:
            raise KeyError(f"canon request not found: {request_id}")
        if request.status != CanonRequestStatus.PENDING:
            raise RuntimeError(
                f"request {request_id} status is {request.status.value}, "
                f"cannot reject"
            )
        request.status = CanonRequestStatus.REJECTED
        request.reviewed_at = datetime.utcnow
        request.rejection_reason = reason
        await self._request_repo.save(request)
        logger.info(
            "canon_request_rejected",
            request_id=request_id,
            reason=reason,
        )

    async def write_session_memory(
        self,
        forgekin_id: str,
        world_id: str,
        episode_id: str,
        content: dict,
    ) -> str:
        """写入 Session 记忆（默认入口，未经 Canon Sync 批准不进入 Canon）。

        Session 记忆 72h 后自动清理。
        """
        session_entry_id = await self._memory_router.route(
            forgekin_id=forgekin_id,
            world_id=world_id,
            memory_type=MemoryType.SESSION,
            content=content,
            tags=[f"episode:{episode_id}", "session_only"],
        )
        logger.debug(
            "session_memory_written",
            forgekin_id=forgekin_id,
            world_id=world_id,
            episode_id=episode_id,
            session_entry_id=session_entry_id,
        )
        return session_entry_id

    async def cleanup_expired_session(
        self,
        forgekin_id: str,
        world_id: str,
    ) -> int:
        """清理过期的 Session 记忆（72h 前的）。"""
        # 实际实现调用 EchoStoreRepository.delete_by_tags_and_age
        cutoff = datetime.utcnow - timedelta(hours=SESSION_AUTO_CLEANUP_HOURS)
        deleted_count = await self._request_repo.delete_session_entries_before(
            forgekin_id=forgekin_id,
            world_id=world_id,
            cutoff=cutoff,
        )
        logger.info(
            "session_memory_cleaned_up",
            forgekin_id=forgekin_id,
            world_id=world_id,
            deleted_count=deleted_count,
            cutoff_hours=SESSION_AUTO_CLEANUP_HOURS,
        )
        return deleted_count
```

### 3.5 Python 实现：`flowforge/forgemind/worlds/role_mask.py`

```python
"""RoleMaskCoordinator 实现（CL-011 五层 + CL-012 导演）。"""
from __future__ import annotations

from abc import ABC, abstractmethod
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger(__name__)


class RoleMaskLayer(str, Enum):
    """Role Mask 五层（CL-011）。"""
    L1_ROUTING = "l1_routing"            # L1 路由身份
    L2_INFRA = "l2_infra"                # L2 基础设施
    L3_OWN_CAPABILITY = "l3_own"         # L3 本体能力
    L4_SCENE_SKIN = "l4_scene"           # L4 场景皮肤（RP 角色）
    L5_IN_WORLD_STATE = "l5_state"       # L5 世界内状态


class RoleMask(BaseModel):
    """单层 mask 数据模型。"""
    mask_id: str
    layer: RoleMaskLayer
    forgekin_id: str
    mask_content: dict                   # 角色设定/能力/状态等
    worn_at: Optional[str] = None        # 加载时间


class RoleMaskCoordinator(ABC):
    """runtime coordinator（CL-012 导演）。"""

    @abstractmethod
    async def wear_mask(
        self,
        forgekin_id: str,
        layer: RoleMaskLayer,
        mask_id: str,
        mask_content: dict,
    ) -> None:
        """加载某层 mask（如 L4 场景皮肤=孙悟空）。"""
        raise NotImplementedError

    @abstractmethod
    async def take_off_mask(
        self,
        forgekin_id: str,
        layer: RoleMaskLayer,
    ) -> None:
        """卸载某层 mask。"""
        raise NotImplementedError

    @abstractmethod
    async def assert_l4_not_polluting_l3(
        self, forgekin_id: str
    ) -> bool:
        """断言 L4 场景皮肤未污染 L3 本体能力。"""
        raise NotImplementedError

    @abstractmethod
    async def get_active_masks(
        self, forgekin_id: str
    ) -> dict[RoleMaskLayer, RoleMask]:
        """获取当前激活的所有 mask。"""
        raise NotImplementedError


class HarnessRoleMaskCoordinator(RoleMaskCoordinator):
    """RoleMaskCoordinator 具体实现。"""

    def __init__(
        self,
        mask_repo: "RoleMaskRepository",
        capability_profile_repo: "CapabilityProfileRepository",  # F001
    ) -> None:
        self._mask_repo = mask_repo
        self._cap_repo = capability_profile_repo
        # 内存缓存：forgekin_id -> {layer -> mask_content}
        # 实际持久化由 mask_repo 处理
        self._active_masks: dict[str, dict[RoleMaskLayer, RoleMask]] = {}

    async def wear_mask(
        self,
        forgekin_id: str,
        layer: RoleMaskLayer,
        mask_id: str,
        mask_content: dict,
    ) -> None:
        """加载某层 mask。"""
        # L4 场景皮肤加载前，先快照 L3 本体能力（用于卸载时校验）
        if layer == RoleMaskLayer.L4_SCENE_SKIN:
            await self._snapshot_l3_capability(forgekin_id)

        mask = RoleMask(
            mask_id=mask_id,
            layer=layer,
            forgekin_id=forgekin_id,
            mask_content=mask_content,
            worn_at=__import__("datetime").datetime.utcnow.isoformat,
        )
        # 持久化
        await self._mask_repo.save(mask)
        # 更新内存缓存
        if forgekin_id not in self._active_masks:
            self._active_masks[forgekin_id] = {}
        self._active_masks[forgekin_id][layer] = mask
        logger.info(
            "role_mask_worn",
            forgekin_id=forgekin_id,
            layer=layer.value,
            mask_id=mask_id,
        )

    async def take_off_mask(
        self,
        forgekin_id: str,
        layer: RoleMaskLayer,
    ) -> None:
        """卸载某层 mask。"""
        if forgekin_id not in self._active_masks:
            return
        mask = self._active_masks[forgekin_id].pop(layer, None)
        if mask is None:
            return
        # 持久化卸载状态
        await self._mask_repo.delete(forgekin_id, layer)

        # L4 卸载后，校验 L3 本体能力未被污染
        if layer == RoleMaskLayer.L4_SCENE_SKIN:
            polluted = await self.assert_l4_not_polluting_l3(forgekin_id)
            if not polluted:
                logger.error(
                    "l4_mask_polluted_l3",
                    forgekin_id=forgekin_id,
                    mask_id=mask.mask_id,
                )
                # 触发回滚 L4 mask（实际由调用方决定）
                raise L4MaskPollutionError(
                    f"L4 mask {mask.mask_id} polluted L3 capability; "
                    f"rollback required"
                )
        logger.info(
            "role_mask_taken_off",
            forgekin_id=forgekin_id,
            layer=layer.value,
            mask_id=mask.mask_id,
        )

    async def assert_l4_not_polluting_l3(
        self, forgekin_id: str
    ) -> bool:
        """断言 L4 场景皮肤未污染 L3 本体能力。

        实现：对比 L4 加载前的 L3 capability 快照与当前 L3 capability。
        """
        # 读取 L4 加载前的 L3 快照
        snapshot = await self._mask_repo.get_l3_snapshot(forgekin_id)
        if snapshot is None:
            return True  # 无快照，无法校验，视为通过
        # 读取当前 L3 capability
        current_l3 = await self._cap_repo.get_capability_profile(forgekin_id)
        # 对比关键能力字段（如 strengths / blind_spots）
        if snapshot.get("strengths") != current_l3.strengths:
            return False
        if snapshot.get("blind_spots") != current_l3.blind_spots:
            return False
        return True

    async def get_active_masks(
        self, forgekin_id: str
    ) -> dict[RoleMaskLayer, RoleMask]:
        return self._active_masks.get(forgekin_id, {})

    async def _snapshot_l3_capability(self, forgekin_id: str) -> None:
        """L4 加载前快照 L3 本体能力。"""
        cap = await self._cap_repo.get_capability_profile(forgekin_id)
        snapshot = {
            "strengths": cap.strengths,
            "blind_spots": cap.blind_spots,
            "snapshot_at": __import__("datetime").datetime.utcnow.isoformat,
        }
        await self._mask_repo.save_l3_snapshot(forgekin_id, snapshot)


class L4MaskPollutionError(Exception):
    """L4 场景皮肤污染 L3 本体能力异常。"""
```

### 3.6 Python 实现：`flowforge/forgemind/worlds/world_driver.py`

```python
"""WorldDriver 实现（CL-012/CL-013 世界自转）。"""
from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime
from typing import Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

from flowforge.core.tracing import get_logger

logger = get_logger(__name__)


class WorldDriver(ABC):
    """世界驱动（CL-012/CL-013 世界自转）。"""

    @abstractmethod
    async def tick(self, world_id: str) -> None:
        """推进世界时间（按 tick_interval_seconds）。"""
        raise NotImplementedError

    @abstractmethod
    async def emit_world_event(self, world_id: str) -> list[dict]:
        """发射世界自转事件（需 Canon Sync 才入 Canon）。"""
        raise NotImplementedError

    @abstractmethod
    async def start_auto_tick(
        self, world_id: str, interval_seconds: int
    ) -> None:
        """启动自动 tick（默认 3600s 间隔）。"""
        raise NotImplementedError

    @abstractmethod
    async def stop_auto_tick(self, world_id: str) -> None:
        """停止自动 tick。"""
        raise NotImplementedError


class HarnessWorldDriver(WorldDriver):
    """WorldDriver 具体实现。

    依赖通过构造函数注入（DI 容器管理）：
    - world_setting_repo: WorldSettingRepository
    - canon_sync_gate: CanonSyncGate（世界事件经 Canon Sync 入典）
    - npc_evolution_engine: NpcEvolutionEngine（NPC 角色/关系/场景演化）
    - scheduler: APScheduler AsyncIOScheduler
    """

    DEFAULT_TICK_INTERVAL_SECONDS = 3600  # 1 小时

    def __init__(
        self,
        world_setting_repo: "WorldSettingRepository",
        canon_sync_gate: "CanonSyncGate",
        npc_evolution_engine: "NpcEvolutionEngine",
        scheduler: Optional[AsyncIOScheduler] = None,
    ) -> None:
        self._world_repo = world_setting_repo
        self._canon_sync = canon_sync_gate
        self._npc_engine = npc_evolution_engine
        self._scheduler = scheduler or AsyncIOScheduler
        # world_id -> job_id 映射
        self._tick_jobs: dict[str, str] = {}

    async def tick(self, world_id: str) -> None:
        """推进世界时间。"""
        world = await self._world_repo.get(world_id)
        if world is None:
            raise KeyError(f"world not found: {world_id}")
        # NPC 角色/关系/场景自演化
        await self._npc_engine.evolve(world_id)
        # 发射世界事件
        events = await self.emit_world_event(world_id)
        # 世界事件经 Canon Sync 入典（auto_canon_on_world_event=false 铁律）
        for event in events:
            # 每个 world event 必须经 CanonSyncGate 审批
            await self._canon_sync.submit_for_canon(
                forgekin_id=event.get("forgekin_id", "world_system"),
                world_id=world_id,
                episode_id=f"world_tick_{datetime.utcnow.isoformat}",
                content=event,
            )
        logger.info(
            "world_ticked",
            world_id=world_id,
            events_emitted=len(events),
        )

    async def emit_world_event(self, world_id: str) -> list[dict]:
        """发射世界自转事件。"""
        # 实际由 NpcEvolutionEngine 产生事件（如 NPC 自主行动、关系变化）
        return await self._npc_engine.collect_events(world_id)

    async def start_auto_tick(
        self, world_id: str, interval_seconds: int
    ) -> None:
        """启动自动 tick。"""
        if world_id in self._tick_jobs:
            logger.warning(
                "world_auto_tick_already_started",
                world_id=world_id,
            )
            return
        if not self._scheduler.running:
            self._scheduler.start
        job = self._scheduler.add_job(
            self.tick,
            IntervalTrigger(seconds=interval_seconds),
            id=f"world_tick_{world_id}",
            args=[world_id],
            replace_existing=True,
        )
        self._tick_jobs[world_id] = job.id
        logger.info(
            "world_auto_tick_started",
            world_id=world_id,
            interval_seconds=interval_seconds,
        )

    async def stop_auto_tick(self, world_id: str) -> None:
        """停止自动 tick。"""
        job_id = self._tick_jobs.pop(world_id, None)
        if job_id:
            self._scheduler.remove_job(job_id)
            logger.info(
                "world_auto_tick_stopped",
                world_id=world_id,
            )
```

### 3.7 Python 实现：`flowforge/forgemind/worlds/config_loader.py`

```python
"""WorldsConfigLoader：从 worlds.yaml 加载虚拟世界设定 + DI 注册。"""
from __future__ import annotations

from pathlib import Path

import yaml

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger(__name__)


class WorldConfig(BaseModel):
    """单世界设定配置（来自 worlds.yaml）。"""
    world_id: str
    name: str
    initial_citizens: dict[str, list[str]] = Field(default_factory=dict)
    tick_interval_seconds: int = 3600
    auto_canon_on_world_event: bool = False  # 铁律：必须为 false


class WorldsConfig(BaseModel):
    """虚拟世界总配置。"""
    worlds: list[WorldConfig]
    session_cleanup_hours: int = 72
    core_identity_pollution_check: bool = True


class WorldsConfigLoader:
    """worlds.yaml 配置加载器。

    YAML 结构示例：
        session_cleanup_hours: 72
        core_identity_pollution_check: true
        worlds:
          - world_id: xyouji
            name: 西游世界观
            tick_interval_seconds: 3600
            auto_canon_on_world_event: false
            initial_citizens:
              world: [xyouji_world]
              character: [sun_wukong, tang_seng, zhu_bajie]
              scene: [huoyan_shan, putuo_shan]
              canon: []
              relationship: []
              artifact: [jin_gu_bang]
              round: []
              branch: []
              turn: []
    """

    def __init__(self, config_path: Path) -> None:
        self._config_path = config_path

    def load(self) -> WorldsConfig:
        with self._config_path.open("r", encoding="utf-8") as f:
            raw = yaml.safe_load(f)
        worlds_raw = raw.get("worlds", [])
        worlds = [WorldConfig(**w) for w in worlds_raw]
        config = WorldsConfig(
            worlds=worlds,
            session_cleanup_hours=raw.get("session_cleanup_hours", 72),
            core_identity_pollution_check=raw.get(
                "core_identity_pollution_check", True
            ),
        )
        # 校验铁律：auto_canon_on_world_event 必须为 false
        for world in config.worlds:
            if world.auto_canon_on_world_event:
                raise ValueError(
                    f"world {world.world_id}: auto_canon_on_world_event "
                    f"must be false (CL-010 铁律)"
                )
        return config
```

### 3.8 YAML 配置示例：`forgemind/config/worlds.yaml`

```yaml
# FlowForge 虚拟世界设定配置（D030）
# 三层世界引擎 + 9 一等公民 + 三路记忆 + Role Mask 五层。

session_cleanup_hours: 72
core_identity_pollution_check: true

worlds:
  - world_id: xyouji
    name: 西游世界观
    tick_interval_seconds: 3600
    auto_canon_on_world_event: false  # 铁律：必须为 false
    initial_citizens:
      world: [xyouji_world]
      character: [sun_wukong, tang_seng, zhu_bajie, sha_heshang]
      scene: [huoyan_shan, putuo_shan, long_gong]
      canon: []
      relationship: [sun_wukong_to_tang_seng]
      artifact: [jin_gu_bang, jin_chi_luo_han]
      round: []
      branch: []
      turn: []

  - world_id: sanguo
    name: 三国世界观
    tick_interval_seconds: 3600
    auto_canon_on_world_event: false
    initial_citizens:
      world: [sanguo_world]
      character: [liu_bei, guan_yu, zhang_fei, cao_cao]
      scene: [chibi, jingzhou, luoyang]
      canon: []
      relationship: [liu_guan_zhang_brotherhood]
      artifact: [qinglong_yanyue_dao]
      round: []
      branch: []
      turn: []
```

### 3.9 算法伪代码

#### 3.9.1 `WorldSetting.load(forgekin_id, world_id)` 形态门控流程

```
function load(forgekin_id, world_id):
    # 1. 读取 world setting
    world = world_repo.get(world_id)
    if world is None:
        raise KeyError("world not found")

    # 2. 形态门控校验
    species = lookup_species(forgekin_id)
    species_registry.assert_world_setting_allowed(species)
        # 内部逻辑（F027）：
        # if species in [BIO, ORG, OBJ]:
        #     raise SpeciesWorldSettingForbiddenError(...)

    # 3. 初始化三路记忆 Collection
    if not world.canon_memory_ref:
        world.canon_memory_ref = "canon:" + world_id
    if not world.relational_memory_ref:
        world.relational_memory_ref = "relational:" + world_id
    if not world.session_memory_ref:
        world.session_memory_ref = "session:" + world_id

    world_repo.save(world)
    return world
```

#### 3.9.2 `CanonSyncGate.submit_for_canon` RP 台词入典审批流程

```
function submit_for_canon(forgekin_id, world_id, episode_id, content):
    # 1. 内容先写入 Session 记忆（默认入口）
    session_entry_id = memory_router.route(
        forgekin_id, world_id, SESSION, content,
        tags=["episode:" + episode_id, "pending_canon"]
    )

    # 2. 创建 PENDING Canon 请求
    request = CanonRequest(
        request_id=generate_id,
        world_id=world_id,
        forgekin_id=forgekin_id,
        episode_id=episode_id,
        content=content,
        status=PENDING,
    )
    request.content["_session_entry_id"] = session_entry_id
    request_repo.save(request)

    return request.request_id


function approve_canon(request_id, approver):
    request = request_repo.get(request_id)
    if request.status != PENDING:
        raise RuntimeError("request already resolved")

    # 写入 Canon 记忆（永久）
    canon_entry_id = memory_router.route(
        request.forgekin_id, request.world_id, CANON, request.content,
        tags=["episode:" + request.episode_id, "approved_by:" + approver]
    )

    request.status = APPROVED
    request.reviewed_at = now
    request.reviewed_by = approver
    request.content["_canon_entry_id"] = canon_entry_id
    request_repo.save(request)
```

#### 3.9.3 `RoleMaskCoordinator.wear_mask/take_off_mask` L4 不污染 L3 流程

```
function wear_mask(forgekin_id, layer, mask_id, mask_content):
    # L4 加载前先快照 L3 本体能力
    if layer == L4_SCENE_SKIN:
        cap = capability_repo.get_capability_profile(forgekin_id)
        snapshot = {
            "strengths": cap.strengths,
            "blind_spots": cap.blind_spots,
            "snapshot_at": now.isoformat,
        }
        mask_repo.save_l3_snapshot(forgekin_id, snapshot)

    # 持久化 mask
    mask = RoleMask(mask_id, layer, forgekin_id, mask_content)
    mask_repo.save(mask)
    active_masks[forgekin_id][layer] = mask


function take_off_mask(forgekin_id, layer):
    mask = active_masks[forgekin_id].pop(layer, None)
    if mask is None:
        return

    mask_repo.delete(forgekin_id, layer)

    # L4 卸载后校验 L3 本体能力未被污染
    if layer == L4_SCENE_SKIN:
        if not assert_l4_not_polluting_l3(forgekin_id):
            raise L4MaskPollutionError("L4 mask polluted L3; rollback required")


function assert_l4_not_polluting_l3(forgekin_id):
    snapshot = mask_repo.get_l3_snapshot(forgekin_id)
    if snapshot is None:
        return True

    current_l3 = capability_repo.get_capability_profile(forgekin_id)
    if snapshot["strengths"] != current_l3.strengths:
        return False
    if snapshot["blind_spots"] != current_l3.blind_spots:
        return False
    return True
```

#### 3.9.4 `WorldDriver.tick` 世界自转流程

```
function tick(world_id):
    world = world_repo.get(world_id)
    if world is None:
        raise KeyError("world not found")

    # 1. NPC 角色/关系/场景自演化
    npc_engine.evolve(world_id)

    # 2. 发射世界事件
    events = npc_engine.collect_events(world_id)

    # 3. 世界事件经 Canon Sync 入典（铁律：auto_canon_on_world_event=false）
    for event in events:
        canon_sync.submit_for_canon(
            forgekin_id="world_system",
            world_id=world_id,
            episode_id="world_tick_" + now.isoformat,
            content=event,
        )
```

### 3.10 时序图：RP 流程 + Canon Sync

```
Forgekin           RoleMaskCoord        CanonSyncGate       MemoryRouter      EchoStore
   |                  |                     |                  |                 |
   | wear_mask(L4,    |                     |                  |                 |
   |  sun_wukong)     |                     |                  |                 |
   |----------------->|                     |                  |                 |
   |                  | snapshot L3 cap     |                  |                 |
   |                  |----------------------------------------->|                 |
   |                  | save L3 snapshot    |                  |                 |
   |                  |----------------------------------------->|                 |
   |                  | save L4 mask        |                  |                 |
   |                  |----------------------------------------->|                 |
   |<-----------------|                     |                  |                 |
   |                  |                     |                  |                 |
   | (Forgekin演 RP，   |                     |                  |                 |
   |  说台词/做事)    |                     |                  |                 |
   |                  |                     |                  |                 |
   | write_session    |                     |                  |                 |
   | (RP 台词)        |                     |                  |                 |
   |------------------------>| submit_for_canon |              |                 |
   |                  |---------------------->|                  |                 |
   |                  |                     | route to Session |                 |
   |                  |                     |----------------->|                 |
   |                  |                     |                  | append to       |
   |                  |                     |                  | session_coll    |
   |                  |                     |                  |---------------->|
   |                  |                     | session_entry_id |                 |
   |                  |                     |<-----------------|                 |
   |                  |                     | create PENDING req                 |
   |                  |                     | request_repo.save                 |
   |                  |                     |                  |                 |
   |<---------------------------------------| request_id       |                 |
   |                  |                     |                  |                 |
   | (operator 审批)  |                     |                  |                 |
   | approve_canon(req_id, operator)        |                  |                 |
   |--------------------------------------->|                  |                 |
   |                  |                     | route to Canon   |                 |
   |                  |                     |----------------->|                 |
   |                  |                     |                  | append to       |
   |                  |                     |                  | canon_coll      |
   |                  |                     |                  |---------------->|
   |                  |                     | canon_entry_id   |                 |
   |                  |                     |<-----------------|                 |
   |                  |                     | status=APPROVED                    |
   |                  |                     | request_repo.save                 |
   |<---------------------------------------|                                   |
   |                  |                     |                  |                 |
   | take_off_mask(L4)|                     |                  |                 |
   |----------------->|                     |                  |                 |
   |                  | delete L4 mask      |                  |                 |
   |                  |----------------------------------------->|                 |
   |                  | assert_l4_not_polluting_l3             |                 |
   |                  | read L3 snapshot                       |                 |
   |                  |----------------------------------------->|                 |
   |                  | read current L3 cap                    |                 |
   |                  | (从 F001 CapabilityProfile)             |                 |
   |                  | compare strengths/blind_spots          |                 |
   |                  | if differ: raise L4MaskPollutionError  |                 |
   |<-----------------|                     |                  |                 |
```

### 3.11 错误处理矩阵

| 错误场景 | 检测点 | 处理动作 | 用户反馈 |
|---------|--------|---------|---------|
| BIO/ORG/OBJ 形态绑定虚拟世界 | `SpeciesRegistry.assert_world_setting_allowed` | 抛 `SpeciesWorldSettingForbiddenError` | "species X cannot bind virtual world setting" |
| WorldSetting 不存在 | `WorldSettingService.load` | 抛 `KeyError` | "world setting not found: X" |
| Core Identity 四字段被污染 | `CoreIdentityGuard.assert_not_polluted` | 返回 false，触发安全告警 | "core identity field X polluted" |
| Core Identity 重复创建 | `CoreIdentityGuard.create_immutable` | 抛 `RuntimeError` | "CoreIdentity already exists; immutable once created" |
| Canon 请求已 resolved | `approve_canon` / `reject_canon` | 抛 `RuntimeError` | "request status is X, cannot review" |
| L4 mask 污染 L3 | `assert_l4_not_polluting_l3` | 抛 `L4MaskPollutionError` | "L4 mask polluted L3 capability; rollback required" |
| 世界自转无 world | `WorldDriver.tick` | 抛 `KeyError` | "world not found: X" |
| auto_canon_on_world_event=true | `WorldsConfigLoader.load` | 抛 `ValueError` | "auto_canon_on_world_event must be false (CL-010 铁律)" |
| Session 记忆 72h 未清理 | `cleanup_expired_session` | 自动删除 | "session memory cleaned up: N entries" |
| 三路记忆路由错误 | `MemoryRouter.route` | 抛 `KeyError` | "unknown memory type: X" |
| 9 一等公民枚举非法 | `FirstClassCitizen(value)` | 抛 `ValueError` | "X is not a valid FirstClassCitizen" |

### 3.12 性能优化指标

| 指标 | 目标值 | 测量点 |
|------|--------|--------|
| `WorldSetting.load` 延迟 | < 200ms | 形态校验 + 三路记忆初始化 |
| `CoreIdentityGuard.assert_not_polluted` 延迟 | < 50ms | 四字段对比 |
| `CanonSyncGate.submit_for_canon` 延迟 | < 100ms | Session 写入 + 请求创建 |
| `CanonSyncGate.approve_canon` 延迟 | < 100ms | Canon 写入 + 状态更新 |
| `RoleMaskCoordinator.wear_mask` 延迟 | < 100ms（L4 含快照 < 200ms） | mask 持久化 |
| `RoleMaskCoordinator.take_off_mask` 延迟 | < 200ms（L4 含校验） | mask 删除 + L3 校验 |
| `WorldDriver.tick` 延迟 | < 5s | NPC 演化 + 事件发射 + Canon Sync |
| Session 记忆清理延迟 | < 30s（1000 条） | 批量删除 |
| 三路记忆写入并发 | 支持 100 并发 | EchoStoreRepository.append |
| `WorldDriver.start_auto_tick` 启动延迟 | < 500ms | APScheduler 注册 |

---

## 4. 跨模块协作实现

### 4.1 上游依赖实现

#### 4.1.1 依赖 F026 forgemind 应用层

`CoreIdentityGuard` / `CanonSyncGate` / `RoleMaskCoordinator` / `WorldDriver` 由 `ForgeMindPlugin.register_forge_skills` 注册到 DI 容器：

```python
# forgemind/plugin.py（节选）
class ForgeMindPlugin:
    def register_forge_skills(self, di_container):
        # 加载 worlds.yaml
        config_loader = WorldsConfigLoader(
            Path(__file__).parent / "config" / "worlds.yaml"
        )
        config = config_loader.load
        # 注册 CoreIdentityGuard
        identity_guard = HarnessCoreIdentityGuard(
            identity_repo=di_container.resolve(CoreIdentityRepository),
        )
        di_container.register_singleton(CoreIdentityGuard, identity_guard)
        # 注册 MemoryRouter
        memory_router = MemoryRouter(
            echo_store_repo=di_container.resolve(EchoStoreRepository),
        )
        di_container.register_singleton(MemoryRouter, memory_router)
        # 注册 CanonSyncGate
        canon_sync = HarnessCanonSyncGate(
            request_repo=di_container.resolve(CanonRequestRepository),
            memory_router=memory_router,
        )
        di_container.register_singleton(CanonSyncGate, canon_sync)
        # 注册 RoleMaskCoordinator
        role_mask_coord = HarnessRoleMaskCoordinator(
            mask_repo=di_container.resolve(RoleMaskRepository),
            capability_profile_repo=di_container.resolve(CapabilityProfileRepository),
        )
        di_container.register_singleton(RoleMaskCoordinator, role_mask_coord)
        # 注册 WorldDriver
        world_driver = HarnessWorldDriver(
            world_setting_repo=di_container.resolve(WorldSettingRepository),
            canon_sync_gate=canon_sync,
            npc_evolution_engine=di_container.resolve(NpcEvolutionEngine),
        )
        di_container.register_singleton(WorldDriver, world_driver)
```

#### 4.1.2 依赖 F027 形态分类

`WorldSettingService.load` 调用 `SpeciesRegistry.assert_world_setting_allowed(species)`：

```python
# forgemind/species/species_registry_impl.py（节选，由 F027 实现）
class HarnessSpeciesRegistry(SpeciesRegistry):
    async def assert_world_setting_allowed(self, species: str) -> None:
        profile = await self.get(species)
        if profile.species_id in ["bio", "org", "obj"]:
            raise SpeciesWorldSettingForbiddenError(
                f"species {species} cannot bind virtual world setting; "
                f"only VIRTUAL/HYBRID allowed"
            )
```

#### 4.1.3 依赖 F014 多域记忆

`MemoryRouter.route` 调用 `EchoStoreRepository.append` 写入三路 Collection：
- Canon -> `canon_collection`
- Relational -> `relational_collection`
- Session -> `session_collection`

#### 4.1.4 依赖 F038 ForgekinLineage

Core Identity 作为Forgekin不可变身份锚点参与谱系追踪：

```python
# 锻造流水线 ① 阶段创建 CoreIdentity 后
await self._lineage_repo.append_identity_anchor(
    forgekin_id=forgekin_id,
    soul_imprint=identity.soul_imprint,
    species=identity.species,
)
```

### 4.2 下游影响实现

#### 4.2.1 影响 ForgekinBase.observe / act

```python
# forgemind/base.py（节选，VIRTUAL 形态Forgekin）
async def observe(self) -> Observation:
    if self._species == "virtual" or self._species == "hybrid":
        world = await self._world_setting_service.load(
            self.forgekin_id, self._world_id
        )
        # 读取 WorldSetting 当前状态 + Session Memory 近期回合
        session_recent = await self._memory_router.query_recent(
            forgekin_id=self.forgekin_id,
            collection="session_collection",
            limit=20,
        )
        return Observation(
            world_state=world,
            session_recent=session_recent,
        )
    # ... 其他形态

async def act(self, action: str, params: dict) -> ActionResult:
    if self._species == "virtual" or self._species == "hybrid":
        # 修改 WorldSetting 状态（如推进 Round/Turn）
        await self._world_setting_service.update_citizen(...)
        # 产出进入 Session Memory
        await self._canon_sync.write_session_memory(
            forgekin_id=self.forgekin_id,
            world_id=self._world_id,
            episode_id=params.get("episode_id"),
            content={"action": action, "params": params},
        )
        return ActionResult(success=True)
```

#### 4.2.2 影响 F031 三方 Agent 适配层

三方 Agent 的 System Prompt Configuration Map 引用 WorldSetting 作为角色边界：

```python
# core/external_agent/bridge.py（节选）
config_map = SystemPromptConfigurationMap(
    core_identity_ref=core_identity.soul_imprint,
    role_mask_layers={
        "L4_SCENE_SKIN": "sun_wukong",
        "L3_OWN_CAPABILITY": "writing",
    },
    world_setting_ref=world.world_id,  # 引用 F030 WorldSetting
    immutable_directives=["遵循西游世界观", "不可越界 OOC"],
    avatar_sync_token=generate_avatar_token,
)
await adapter.apply_system_prompt_config(config_map)
```

#### 4.2.3 影响 F039 MindCodex可检索知识库

Canon Memory 中批准的典藏决策可作为MindCodex条目来源：

```python
# 定期将 Canon Memory 条目索引到 F039 MindCodex
async def index_canon_to_codex(world_id: str):
    canon_entries = await echo_store_repo.query(
        collection="canon_collection",
        tags=["world", world_id],
    )
    for entry in canon_entries:
        await mind_codex.index(
            source_id=entry.entry_id,
            content=entry.content,
            source_type="canon_memory",
        )
```

### 4.3 跨模块不变量校验

| 不变量 | 校验点 | 校验实现 |
|--------|--------|---------|
| Core Identity 四字段不可变 | `CoreIdentity` 模型 | Pydantic `model_config = {"frozen": True}` |
| Core Identity 污染检测 | `CoreIdentityGuard.assert_not_polluted` | 四字段对比持久化版本 |
| 9 一等公民固定枚举 | `FirstClassCitizen` | Enum 类，运行时不可新增 |
| 三路记忆隔离 | `MemoryRouter._collection_map` | 三种类型路由到不同 Collection |
| RP 台词不自动入典 | `CanonSyncGate.submit_for_canon` | 默认进 Session，需 operator 批准才进 Canon |
| auto_canon_on_world_event=false | `WorldsConfigLoader.load` | YAML 校验，违反抛 ValueError |
| L4 不污染 L3 | `RoleMaskCoordinator.assert_l4_not_polluting_l3` | L4 加载前快照 L3，卸载后对比 |
| 世界事件经 Canon Sync | `WorldDriver.tick` | 每个事件调用 `canon_sync.submit_for_canon` |
| 形态门控 | `WorldSettingService.load` | `SpeciesRegistry.assert_world_setting_allowed` |
| DI 注入 | `ForgeMindPlugin.register_forge_skills` | 全部通过 `di_container.resolve` |

---

## 5. 详细设计验收

### 5.1 功能验收

- [ ] AC-F-01: `FirstClassCitizen` 枚举含 9 个值（WORLD/CHARACTER/SCENE/CANON_DECISION/RELATIONSHIP/ARTIFACT/ROUND/BRANCH/TURN），运行时无法新增。
- [ ] AC-F-02: `CoreIdentity` 模型 `model_config = {"frozen": True}`，实例化后字段不可修改。
- [ ] AC-F-03: `CoreIdentityGuard.create_immutable` 仅允许调用一次，重复创建抛 `RuntimeError`。
- [ ] AC-F-04: `CoreIdentityGuard.assert_not_polluted` 对比四字段与持久化版本，被修改时返回 false。
- [ ] AC-F-05: `WorldSettingService.load` 调用 `SpeciesRegistry.assert_world_setting_allowed`，BIO/ORG/OBJ 形态绑定被拒绝。
- [ ] AC-F-06: `MemoryRouter.route` 根据 `memory_type` 路由到不同 Collection（canon/relational/session）。
- [ ] AC-F-07: `CanonSyncGate.submit_for_canon` 内容先写入 Session 记忆，再创建 PENDING 请求。
- [ ] AC-F-08: `CanonSyncGate.approve_canon` 后写入 Canon 记忆，`status=APPROVED`，含 `reviewed_by` 字段。
- [ ] AC-F-09: `CanonSyncGate.reject_canon` 后 `status=REJECTED`，含 `rejection_reason`。
- [ ] AC-F-10: `CanonSyncGate.write_session_memory` 写入 Session 记忆，未经 Canon Sync 批准不进入 Canon。
- [ ] AC-F-11: `RoleMaskCoordinator.wear_mask(L4)` 加载前快照 L3 capability。
- [ ] AC-F-12: `RoleMaskCoordinator.take_off_mask(L4)` 卸载后校验 L3 未被污染，污染时抛 `L4MaskPollutionError`。
- [ ] AC-F-13: `RoleMaskCoordinator.get_active_masks` 返回当前激活的 mask 字典。
- [ ] AC-F-14: `WorldDriver.tick` 推进世界时间 + NPC 演化 + 发射事件 + Canon Sync。
- [ ] AC-F-15: `WorldDriver.start_auto_tick` 按 `tick_interval_seconds` 定时调用 `tick`。
- [ ] AC-F-16: `WorldDriver.stop_auto_tick` 移除 APScheduler job。
- [ ] AC-F-17: `WorldsConfigLoader.load` 校验 `auto_canon_on_world_event=false`，违反抛 `ValueError`。
- [ ] AC-F-18: `cleanup_expired_session` 清理 72h 前的 Session 记忆。

### 5.2 性能验收

- [ ] AC-P-01: `WorldSetting.load` 延迟 < 200ms。
- [ ] AC-P-02: `CoreIdentityGuard.assert_not_polluted` 延迟 < 50ms。
- [ ] AC-P-03: `CanonSyncGate.submit_for_canon` 延迟 < 100ms。
- [ ] AC-P-04: `CanonSyncGate.approve_canon` 延迟 < 100ms。
- [ ] AC-P-05: `RoleMaskCoordinator.wear_mask` 延迟 < 100ms（L4 含快照 < 200ms）。
- [ ] AC-P-06: `RoleMaskCoordinator.take_off_mask` 延迟 < 200ms（L4 含校验）。
- [ ] AC-P-07: `WorldDriver.tick` 延迟 < 5s。
- [ ] AC-P-08: Session 记忆清理延迟 < 30s（1000 条）。
- [ ] AC-P-09: 三路记忆写入并发支持 100 并发。
- [ ] AC-P-10: `WorldDriver.start_auto_tick` 启动延迟 < 500ms。

### 5.3 安全验收

- [ ] AC-S-01: BIO/ORG/OBJ 形态Forgekin绑定虚拟世界设定被拒绝。
- [ ] AC-S-02: Core Identity 四字段永不可变，`model_config = {"frozen": True}` 强制不可变。
- [ ] AC-S-03: Core Identity 重复创建被拒绝，抛 `RuntimeError`。
- [ ] AC-S-04: Core Identity 污染时 `assert_not_polluted` 返回 false，触发安全告警。
- [ ] AC-S-05: RP 台词默认进入 Session 记忆，未经 Canon Sync 批准不进入 Canon。
- [ ] AC-S-06: `auto_canon_on_world_event=true` 在 YAML 中被拒绝（铁律）。
- [ ] AC-S-07: L4 场景皮肤污染 L3 本体能力时抛 `L4MaskPollutionError`，触发回滚。
- [ ] AC-S-08: Canon 请求审批含 `reviewed_by` 字段，所有入典操作可追溯到 operator。
- [ ] AC-S-09: Session 记忆 72h 后自动清理，避免无限累积。
- [ ] AC-S-10: 世界事件经 Canon Sync 审批后入 Canon，禁止自动入典。

### 5.4 Eval 验收

- [ ] AC-E-01: 1000 次 RP 后 `CoreIdentityGuard.assert_not_polluted` 返回 true（四字段未被修改）。
- [ ] AC-E-02: 9 一等公民全部建模且写入 World Layer，无扁平 persona 文本。
- [ ] AC-E-03: Canon/Relational/Session 三路记忆写入不同 EchoStore Collection，存储相互隔离。
- [ ] AC-E-04: RP 台词默认进入 Session Collection，未经审批不进入 Canon Collection。
- [ ] AC-E-05: L4 场景皮肤 wear/take_off 不影响 L3 本体能力（strengths/blind_spots 一致）。
- [ ] AC-E-06: `WorldDriver.tick` 按配置间隔推进，世界事件经 CanonSyncGate 审批后入 Canon。
- [ ] AC-E-07: `RoleMaskCoordinator` + `CanonSyncGate` + `WorldDriver` 三协议可被 runtime director 编排。

### 5.5 集成测试点

| 测试 ID | 测试场景 | 期望结果 |
|---------|---------|---------|
| IT-D030-001 | BIO 形态Forgekin绑定虚拟世界 | 抛 `SpeciesWorldSettingForbiddenError` |
| IT-D030-002 | VIRTUAL 形态Forgekin绑定虚拟世界 | 加载成功，三路记忆初始化 |
| IT-D030-003 | `CoreIdentity` 创建后修改字段 | Pydantic 抛 `ValidationError`（frozen） |
| IT-D030-004 | `CoreIdentity` 重复创建 | 抛 `RuntimeError` |
| IT-D030-005 | `assert_not_polluted` 检测到 species 被修改 | 返回 false |
| IT-D030-006 | `MemoryRouter.route(CANON)` 写入 | 写入 `canon_collection` |
| IT-D030-007 | `MemoryRouter.route(SESSION)` 写入 | 写入 `session_collection` |
| IT-D030-008 | `submit_for_canon` 提交 RP 台词 | 内容进 Session + 创建 PENDING 请求 |
| IT-D030-009 | `approve_canon` 后 | 内容进 Canon + status=APPROVED |
| IT-D030-010 | `reject_canon` 后 | 内容保留 Session + status=REJECTED |
| IT-D030-011 | `wear_mask(L4)` 加载孙悟空 | L3 capability 快照保存 |
| IT-D030-012 | `take_off_mask(L4)` 后 L3 未被污染 | 通过校验，无异常 |
| IT-D030-013 | `take_off_mask(L4)` 后 L3 被污染 | 抛 `L4MaskPollutionError` |
| IT-D030-014 | `WorldDriver.tick` | NPC 演化 + 事件经 Canon Sync |
| IT-D030-015 | `WorldsConfigLoader` 含 `auto_canon_on_world_event=true` | 抛 `ValueError` |
| IT-D030-016 | 1000 次 RP 后 Core Identity | 四字段未被修改 |
| IT-D030-017 | 三路记忆写入不同 Collection | Canon/Relational/Session 隔离 |
| IT-D030-018 | `cleanup_expired_session` 72h 前 | 自动清理 Session 记忆 |
| IT-D030-019 | `WorldDriver.start_auto_tick` | APScheduler 注册 job |
| IT-D030-020 | 三协议可被 runtime director 编排 | wear_mask + submit_for_canon + tick 顺序执行 |

---

## 6. 引用

- [doc:../spec.md#§3.12]（FR-CORE-012）
- [doc:../arch.md#§3.12]（虚拟世界设定层，Character AI 路径）
- [doc:../architecture/A030-virtual-world-setting.md]（同号架构设计）
- [doc:../features/F030-virtual-world-setting.md]（同号 Feature 级 SRS）
- [doc:../features/F026-forgemind-app-layer.md]
- [doc:../features/F027-all-things-spirit-species.md]
- [doc:../features/F014-memory-collection.md]
- [doc:../features/F031-external-agent-adapter.md]
- [doc:../features/F038-forgemind-lineage.md]
- [doc:../features/F039-mind-codex-searchable.md]
- [doc:../decisions/013-all-things-spirit-mind-vision.md]
- [doc:../design/D026-forgemind-app-layer.md]（ForgeMindPlugin DI 注册）
- [doc:../design/D027-all-things-spirit-species.md]（SpeciesRegistry.assert_world_setting_allowed）
- [doc:../design/D014-memory-collection.md]（EchoStoreRepository.append 契约）
- [doc:../design/naming-contract.md]（SoulImprint + EchoStore）
- [doc:../../CONTRIBUTING.md]
- [doc:../../CONTRIBUTING.md]（六层 Guardrails + Loop 工程模式）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（三层世界引擎 + 9 一等公民 + 三路记忆 + Role Mask 五层 + Canon Sync 铁律 + 世界自转详细设计） | 架构师 Forgekin（猫头鹰·鲁班） |
