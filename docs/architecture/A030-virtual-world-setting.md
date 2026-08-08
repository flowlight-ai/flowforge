# A030: 虚拟世界设定层架构设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.12]（FR-CORE-012）
> **对应 arch.md**: [doc:../arch.md#§3.12]
> **对应 design.md**: [doc:../design.md#§3.12]（待创建）
> **对应 Feature**: [doc:../features/F030-virtual-world-setting.md]（同号 Feature 级 SRS）
> **对应详细设计**: [doc:../design/D030-virtual-world-setting.md]（待创建，同号 Feature 级 SDD）
> **依赖 ADR**: [doc:../decisions/013-all-things-spirit-mind-vision.md]

---

## 1. 架构上下文

### 1.1 架构问题

forgemind 应用层需要为 VIRTUAL/HYBRID 形态Forgekin提供虚拟世界承载层，对标业界 Character AI（虚拟角色智能体）/ NPC Agent / Persona-Driven Agent 工程实现路径。但 v7.0 Forgekin persona 是扁平文本，无三层世界引擎、无 Core Identity 隔离、无三路记忆区分、无 Role Mask 五层、无世界自转机制。本架构在 forgemind 内部建立虚拟世界设定层，解决以下架构层问题：

1. **Core Identity 易被污染**：Forgekin演 1000 次 RP 后核心身份被临时台词污染，无隔离层。
2. **9 一等公民未建模**：World/Character/Scene/Canon Decision/Relationship/Artifact/Round/Branch/Turn 九个一等公民无统一建模。
3. **三路记忆未区分**：Canon（永久）/ Relational（长期）/ Session（临时）三路记忆混存，临时 RP 台词自动污染永久典藏。
4. **Role Mask 无层次**：路由身份/基础设施/本体能力/场景皮肤/世界内状态五层无独立加载/卸载机制。
5. **Bridge Layer 三协议缺失**：Role Mask Protocol / Canon Sync Protocol / World Driver Protocol 三协议无定义。
6. **世界自转缺失**：WorldDriver.tick 无定时推进，NPC 角色/关系/场景无法自演化。
7. **形态门控未编码**：仅 VIRTUAL/HYBRID 形态可绑定虚拟世界设定，BIO/ORG/OBJ 形态应被拒绝。

### 1.2 架构约束

- **单向依赖约束**：WorldSetting 必须单向依赖 F014 EchoStore Repository + F027 SpeciesRegistry，禁止反向依赖 *Forge。
- **DI 容器约束**：WorldDriver / RoleMaskCoordinator / CanonSyncGate 实例必须通过 DI 容器注入。
- **Repository 层约束**：Canon/Relational/Session 三路记忆写入必须通过 Repository 层，禁止直接操作数据库。
- **配置驱动约束**：world_settings / core_identity_guard / bridge_protocols / role_mask 必须 YAML 外置到 `forgemind/config/worlds.yaml`。
- **形态门控约束**：WorldSetting.load 必须调用 SpeciesRegistry.assert_world_setting_allowed 校验形态合法性，BIO/ORG/OBJ 形态绑定被拒绝。
- **Core Identity 不可变约束**：soul_imprint / species / core_values / core_personality 四字段永不可被 Episode 修改。
- **Canon Sync 铁律约束**：RP 台词必须经 CanonSyncGate 显式批准才能进入 Canon 记忆，禁止自动入典。

### 1.3 架构影响

- **对 F027 形态分类的影响**：WorldSetting 调用 SpeciesRegistry 校验形态门控，强化"形态决定接入层"约束。
- **对 F014 多域记忆的影响**：Canon/Relational/Session 三路记忆分别写入 EchoStore 不同 Collection，存储相互隔离。
- **对 F038 进化谱系的影响**：Core Identity 作为Forgekin不可变身份锚点，参与谱系追踪。
- **对 ForgekinBase.observe / act 的影响**：VIRTUAL 形态Forgekin的 observe/act 通过 WorldSetting 读取/改变虚拟世界状态。
- **对 F031 三方 Agent 适配层的影响**：三方 Agent 的 System Prompt Configuration Map 可引用 WorldSetting 作为角色边界。

---

## 2. 架构设计

### 2.1 组件架构图

```
                    +-------------------------------------------------+
                    |             forgemind/worlds/                   |
                    |                                                 |
                    |  === Core Identity Layer（CL-007 不可变身份）===|
                    |  +-------------------+                          |
                    |  | CoreIdentity      |  soul_imprint / species  |
                    |  | (immutable)       |  / core_values /         |
                    |  +---------+---------+  core_personality        |
                    |            |                                    |
                    |  +---------v---------+                          |
                    |  | CoreIdentityGuard |  污染检测 + 不可变保护    |
                    |  +-------------------+                          |
                    |                                                 |
                    |  === World Layer（CL-008 9 一等公民建模）===    |
                    |  +-------------------+   +-------------------+ |
                    |  | FirstClassCitizen |   | WorldSetting      | |
                    |  | (9 枚举)          |<->| (world_id + 9 公民)|
                    |  +-------------------+   +---------+---------+ |
                    |            |                      |           |
                    |  +---------v---------+   +--------v----------+|
                    |  | Canon Memory      |   | Relational Memory ||
                    |  | (永久,世界级真相)  |   | (长期,角色互动)    ||
                    |  +-------------------+   +-------------------+|
                    |  +-------------------+                          |
                    |  | Session Memory    |  (临时,单次回合)         |
                    |  +-------------------+                          |
                    |                                                 |
                    |  === Bridge Layer（CL-011/012 三协议）===       |
                    |  +-------------------+   +-------------------+ |
                    |  | RoleMaskLayer     |   | BridgeProtocol    | |
                    |  | (5 层)            |   | (3 协议)           | |
                    |  +---------+---------+   +---------+---------+ |
                    |            |                       |           |
                    |  +---------v---------+   +--------v----------+|
                    |  | RoleMaskCoord     |   | CanonSyncGate     ||
                    |  | (runtime director)|   | (RP 台词入典门)    ||
                    |  +-------------------+   +-------------------+|
                    |  +-------------------+                          |
                    |  | WorldDriver       |  (世界自转 tick)         |
                    |  +-------------------+                          |
                    +-------------------------------------------------+
                                          |
                                          v
                    +-------------------------------------------+
                    |  F014 EchoStore Repository（三路记忆隔离）|
                    |  +----------------+  +----------------+   |
                    |  | Canon Collection| | Relational Coll|   |
                    |  +----------------+  +----------------+   |
                    |  +----------------+                      |
                    |  | Session Coll   |                      |
                    |  +----------------+                      |
                    +-------------------------------------------+
```

### 2.2 关键架构决策

- **决策 1：三层世界引擎（Core Identity / World / Bridge）**
  对标前期世界引擎三层架构。Core Identity Layer 永不可变；World Layer 承载 9 一等公民建模与三路记忆；Bridge Layer 提供三协议（Role Mask / Canon Sync / World Driver）。三层分离保证核心身份不被 RP 污染。

- **决策 2：Core Identity 四字段永不可变**
  soul_imprint / species / core_values / core_personality 四字段在Forgekin整个生命周期永不可被任何 Episode 修改。即使演 1000 次孙悟空，Core Identity 仍是 Forgekin 自身。CoreIdentityGuard.assert_not_polluted 在每次 Episode 后强制校验。

- **决策 3：9 一等公民建模（World/Character/Scene/Canon Decision/Relationship/Artifact/Round/Branch/Turn）**
  9 一等公民覆盖虚拟世界建模完整维度。World 是世界设定（如西游世界观）；Character 是角色（孙悟空）；Scene 是场景；Canon Decision 是典藏决策（永久真相）；Relationship 是关系；Artifact 是造物；Round/Branch/Turn 是叙事回合/分支/轮次。9 公民均写入 World Layer，禁止扁平 persona 文本。

- **决策 4：三路记忆严格隔离（Canon / Relational / Session）**
  Canon 记忆永久存储世界级真相（如"孙悟空是唐僧大徒弟"），需 CanonSyncGate 显式批准；Relational 记忆长期存储角色间互动；Session 记忆临时存储单次回合（如本次 RP 台词）。三路记忆分别写入 EchoStore 不同 Collection，存储相互隔离。

- **决策 5："RP 台词不自动入典"铁律（CL-010）**
  Role Play 中Forgekin说的话、做的事进入 Session 记忆，必须经 CanonSyncGate 显式批准（operator 或 Canon Driver 审批）才能进入 Canon 记忆。auto_canon_on_world_event=false，世界事件也需 Canon Sync。

- **决策 6：Role Mask 五层独立加载/卸载**
  L1 路由身份 / L2 基础设施 / L3 本体能力 / L4 场景皮肤（RP 角色）/ L5 世界内状态五层独立 wear/take_off。L4 场景皮肤（孙悟空）不污染 L3 本体能力（写作能力）。RoleMaskCoordinator 作为 runtime coordinator（导演）编排五层。

- **决策 7：WorldDriver 定时推进世界自转**
  WorldDriver.tick(world_id) 按 tick_interval_seconds（默认 3600s）定时推进世界时间，NPC 角色/关系/场景自己演化。世界事件写入 Canon 记忆需 Canon Sync 确认（auto_canon_on_world_event=false）。

### 2.3 架构不变量

- Core Identity 四字段（soul_imprint / species / core_values / core_personality）必须永不可变，禁止任何 Episode 修改。
- 9 一等公民必须全部建模且写入 World Layer，禁止扁平 persona 文本。
- Canon / Relational / Session 三路记忆必须存储相互隔离，写入不同 EchoStore Collection。
- RP 台词必须经 CanonSyncGate 显式批准才能进入 Canon 记忆，禁止自动入典。
- Role Mask 五层必须独立 wear/take_off，L4 场景皮肤不污染 L3 本体能力。
- Bridge Layer 三协议（Role Mask / Canon Sync / World Driver）必须可编排，runtime coordinator 必须存在。
- WorldDriver.tick 必须按配置间隔推进世界自转，世界事件仍需 Canon Sync。
- WorldSetting.load 必须调用 SpeciesRegistry.assert_world_setting_allowed 校验形态门控，BIO/ORG/OBJ 形态绑定被拒绝。
- 虚拟世界设定配置必须 YAML 外置到 `forgemind/config/worlds.yaml`，禁止 .py 硬编码角色/世界观。

---

## 3. 模块设计

### 3.1 模块边界

| 模块 | 路径 | 职责 |
|------|------|------|
| CoreIdentity | `forgemind/worlds/core_identity.py` | 核心身份（不可变四字段） |
| CoreIdentityGuard | `forgemind/worlds/core_identity.py` | Core Identity 守卫（污染检测） |
| FirstClassCitizen | `forgemind/worlds/citizens.py` | 9 一等公民枚举（不可扩展） |
| WorldSetting | `forgemind/worlds/world_setting.py` | 虚拟世界设定（world_id + 9 公民实例） |
| RoleMaskLayer | `forgemind/worlds/role_mask.py` | Role Mask 五层枚举（L1-L5） |
| RoleMaskCoordinator | `forgemind/worlds/role_mask.py` | runtime coordinator（导演，编排五层 wear/take_off） |
| BridgeProtocol | `forgemind/worlds/bridge.py` | 三协议枚举（Role Mask / Canon Sync / World Driver） |
| CanonSyncGate | `forgemind/worlds/canon_sync.py` | Canon Sync 门（RP 台词入典审批） |
| WorldDriver | `forgemind/worlds/world_driver.py` | 世界驱动（tick 推进世界自转） |
| WorldsConfig | `forgemind/config/worlds.yaml` | 虚拟世界设定 YAML 配置（外置） |

### 3.2 接口契约

```python
from abc import ABC, abstractmethod
from typing import Optional
from pydantic import BaseModel, Field
from enum import Enum
from datetime import datetime


class FirstClassCitizen(str, Enum):
    """9 个一等公民（CL-008）"""
    WORLD = "world"                 # World 世界设定
    CHARACTER = "character"         # Character 角色
    SCENE = "scene"                 # Scene 场景
    CANON_DECISION = "canon"        # Canon Decision 典藏决策
    RELATIONSHIP = "relationship"   # Relationship 关系
    ARTIFACT = "artifact"           # Artifact 造物
    ROUND = "round"                 # Round 回合
    BRANCH = "branch"               # Branch 分支
    TURN = "turn"                   # Turn 轮次


class CoreIdentity(BaseModel):
    """核心身份（CL-007，永不可变）"""
    soul_imprint: str                          # SoulImprint（不可变）
    species: str                               # 形态（F027）
    core_values: list[str]                     # 核心价值锚点（不可变）
    core_personality: str                      # 核心性格（不可变）
    created_at: datetime = Field(default_factory=datetime.now)


class WorldSetting(BaseModel):
    """虚拟世界设定"""
    world_id: str
    name: str                                  # 如"西游世界观"
    citizens: dict[FirstClassCitizen, list[str]]  # 一等公民实例 ID
    canon_memory_ref: str                      # Canon 典藏记忆（永久）
    relational_memory_ref: str                 # Relational 关系记忆（长期）
    session_memory_ref: str                    # Session 会话记忆（临时）


class RoleMaskLayer(str, Enum):
    """Role Mask 五层（CL-011）"""
    L1_ROUTING = "l1_routing"        # L1 路由身份
    L2_INFRA = "l2_infra"            # L2 基础设施
    L3_OWN_CAPABILITY = "l3_own"     # L3 本体能力
    L4_SCENE_SKIN = "l4_scene"       # L4 场景皮肤（RP 角色）
    L5_IN_WORLD_STATE = "l5_state"   # L5 世界内状态


class BridgeProtocol(str, Enum):
    """Bridge Layer 三协议（CL-012）"""
    ROLE_MASK = "role_mask"          # Role Mask Protocol
    CANON_SYNC = "canon_sync"        # Canon Sync Protocol
    WORLD_DRIVER = "world_driver"    # World Driver Protocol


class CoreIdentityGuard(ABC):
    """Core Identity 守卫（CL-007）"""

    @abstractmethod
    async def get_immutable(self, forgekin_id: str) -> CoreIdentity:
        """获取不可变 Core Identity"""
        ...

    @abstractmethod
    async def assert_not_polluted(
        self, forgekin_id: str, episode_data: dict
    ) -> bool:
        """断言 Episode 未污染 Core Identity"""
        ...


class CanonSyncGate(ABC):
    """Canon Sync 门（CL-010 铁律：RP 台词不自动入典）"""

    @abstractmethod
    async def submit_for_canon(
        self, episode_id: str, content: dict
    ) -> str:
        """提交 Canon 入典请求（返回 request_id）"""
        ...

    @abstractmethod
    async def approve_canon(
        self, request_id: str, approver: str
    ) -> None:
        """批准入典（operator 或 Canon Driver）"""
        ...

    @abstractmethod
    async def reject_canon(
        self, request_id: str, reason: str
    ) -> None:
        """驳回入典"""
        ...


class WorldDriver(ABC):
    """世界驱动（CL-012/CL-013 世界自转）"""

    @abstractmethod
    async def tick(self, world_id: str) -> None:
        """推进世界时间（按 tick_interval_seconds）"""
        ...

    @abstractmethod
    async def emit_world_event(self, world_id: str) -> list[dict]:
        """发射世界自转事件（需 Canon Sync 才入 Canon）"""
        ...


class RoleMaskCoordinator(ABC):
    """runtime coordinator（CL-012 导演）"""

    @abstractmethod
    async def wear_mask(
        self, forgekin_id: str, layer: RoleMaskLayer, mask_id: str
    ) -> None:
        """加载某层 mask（如 L4 场景皮肤=孙悟空）"""
        ...

    @abstractmethod
    async def take_off_mask(
        self, forgekin_id: str, layer: RoleMaskLayer
    ) -> None:
        """卸载某层 mask"""
        ...

    @abstractmethod
    async def assert_l4_not_polluting_l3(
        self, forgekin_id: str
    ) -> bool:
        """断言 L4 场景皮肤未污染 L3 本体能力"""
        ...
```

### 3.3 数据流

```
[加载阶段]
    operator 提交 WorldSetting（YAML）
        |
        v
    WorldSetting.load(forgekin_id, world_setting_id)
        |
        v
    SpeciesRegistry.assert_world_setting_allowed(species)
        |
        +--> BIO/ORG/OBJ 形态: 拒绝
        `--> VIRTUAL/HYBRID 形态: 允许
        |
        v
    WorldSetting 实例化（9 一等公民 + 三路记忆 ref）

[RP 阶段（Forgekin扮演角色）]
    RoleMaskCoordinator.wear_mask(forgekin, L4_SCENE_SKIN, mask=sun_wukong)
        |
        v
    Forgekin通过真实 LLM 演 RP（说台词/做事）
        |
        v
    RP 产出 -> Session Memory（临时）
        |
        v
    CanonSyncGate.submit_for_canon(episode_id, content)
        |
        v
    operator / Canon Driver 审批
        |
        +--> approve_canon: 写入 Canon Memory（永久）
        `--> reject_canon:  保留在 Session Memory，72h 后自动清理

[Core Identity 保护阶段]
    每次 Episode 结束后
        |
        v
    CoreIdentityGuard.assert_not_polluted(forgekin_id, episode_data)
        |
        +--> 通过: Core Identity 四字段未被修改
        `--> 失败: 拒绝 Episode 写入，触发安全告警

[世界自转阶段]
    WorldDriver.tick(world_id) 按 3600s 推进
        |
        v
    NPC 角色 / 关系 / 场景自演化
        |
        v
    WorldDriver.emit_world_event(world_id) -> list[event]
        |
        v
    每个世界事件经 CanonSyncGate 审批后入 Canon Memory
        `--> auto_canon_on_world_event=false（铁律）

[Role Mask 卸载阶段]
    RoleMaskCoordinator.take_off_mask(forgekin, L4_SCENE_SKIN)
        |
        v
    RoleMaskCoordinator.assert_l4_not_polluting_l3(forgekin)
        |
        +--> 通过: L3 本体能力未受 L4 影响
        `--> 失败: 触发污染告警，回滚 L4 mask

[observe/act 阶段（ForgekinBase 调用）]
    ForgekinBase.observe
        `--> 读取 WorldSetting 当前状态 + Session Memory 近期回合
    ForgekinBase.act(action, params)
        `--> 修改 WorldSetting 状态（如推进 Round/Turn）
        `--> 产出进入 Session Memory
```

---

## 4. 跨模块协作

### 4.1 上游依赖

- **依赖 F026 forgemind 应用层**：worlds/ 目录宿主由 forgemind 提供。
- **依赖 F027 形态分类**：WorldSetting.load 调用 SpeciesRegistry.assert_world_setting_allowed 校验形态门控。
- **依赖 F014 Memory Collection**：Canon/Relational/Session 三路记忆写入 EchoStore 不同 Collection。
- **依赖 F038 ForgekinLineage**：Core Identity 作为Forgekin不可变身份锚点参与谱系追踪。
- **依赖 core/interfaces**：Repository / DI 容器抽象。

### 4.2 下游影响

- **影响 ForgekinBase.observe / act**：VIRTUAL 形态Forgekin通过 WorldSetting 读取/改变虚拟世界状态。
- **影响 F031 三方 Agent 适配层**：三方 Agent 的 System Prompt Configuration Map 可引用 WorldSetting 作为角色边界（如"扮演孙悟空时遵循西游世界观"）。
- **影响 F039 MindCodex可检索知识库**：Canon Memory 中批准的典藏决策可作为MindCodex条目来源。

### 4.3 跨模块不变量

- Core Identity 四字段必须永不可变，CoreIdentityGuard.assert_not_polluted 在每次 Episode 后强制校验。
- 9 一等公民必须全部建模且写入 World Layer，禁止扁平 persona 文本。
- Canon/Relational/Session 三路记忆必须写入不同 EchoStore Collection，存储相互隔离。
- RP 台词必须经 CanonSyncGate 显式批准才能进入 Canon Memory，auto_canon_on_world_event=false。
- Role Mask 五层必须独立 wear/take_off，L4 场景皮肤污染 L3 本体能力时必须回滚。
- WorldDriver.tick 必须按配置间隔推进世界自转，世界事件仍需 Canon Sync。
- WorldSetting.load 必须校验形态门控，BIO/ORG/OBJ 形态绑定被拒绝。

---

## 5. 架构验收

### 5.1 架构契约验收

- [ ] AC-1: 单向依赖通过 —— WorldSetting 仅依赖 F014/F027/F038，无 *Forge 反向 import。
- [ ] AC-2: DI 容器注入通过 —— WorldDriver / RoleMaskCoordinator / CanonSyncGate 通过 DI 容器注入。
- [ ] AC-3: Repository 层通过 —— Canon/Relational/Session 三路记忆通过 Repository 写入不同 EchoStore Collection。
- [ ] AC-4: 配置驱动通过 —— world_settings / core_identity_guard / bridge_protocols / role_mask YAML 外置到 `forgemind/config/worlds.yaml`。
- [ ] AC-5: 形态门控通过 —— BIO/ORG/OBJ 形态Forgekin绑定虚拟世界设定被拒绝。

### 5.2 架构不变量验收

- [ ] AC-6: Core Identity 不可变不变量通过 —— 1000 次 RP 后 Core Identity 四字段未被修改。
- [ ] AC-7: 9 一等公民建模不变量通过 —— WorldSetting 包含全部 9 一等公民枚举的实例 ID。
- [ ] AC-8: 三路记忆隔离不变量通过 —— Canon/Relational/Session 三路记忆写入不同 EchoStore Collection。
- [ ] AC-9: RP 台词不自动入典不变量通过 —— RP 产出默认进入 Session Memory，未经 CanonSyncGate 批准不进入 Canon Memory。
- [ ] AC-10: Role Mask 五层独立不变量通过 —— L4 场景皮肤 wear/take_off 不影响 L3 本体能力。
- [ ] AC-11: 世界自转不变量通过 —— WorldDriver.tick 按配置间隔推进，世界事件经 CanonSyncGate 审批后入 Canon。
- [ ] AC-12: 三协议可编排不变量通过 —— RoleMaskCoordinator + CanonSyncGate + WorldDriver 三协议可被 runtime director 编排。

---

## 6. 引用

- [doc:../spec.md#§3.12]（FR-CORE-012）
- [doc:../arch.md#§3.12]（虚拟世界设定层，Character AI 路径）
- [doc:../features/F030-virtual-world-setting.md]（同号 Feature 级 SRS）
- [doc:../features/F026-forgemind-app-layer.md]
- [doc:../features/F027-all-things-spirit-species.md]
- [doc:../features/F014-memory-collection.md]
- [doc:../features/F038-forgemind-lineage.md]
- [doc:../decisions/013-all-things-spirit-mind-vision.md]
- [doc:../design/naming-contract.md]（SoulImprint + EchoStore）
- [doc:../../CONTRIBUTING.md]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（三层世界引擎 + 9 一等公民 + 三路记忆 + Role Mask 五层 + Canon Sync 铁律 + 世界自转架构） | 架构师 Forgekin（猫头鹰·鲁班） |
