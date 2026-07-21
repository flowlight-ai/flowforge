# Feature F030: 虚拟世界设定层

> **状态**: draft
> **版本**: v0.1
> **依赖**: [doc:review/review.md#FM-010] + [doc:review/review.md#CL-007~CL-013] + [doc:roleagent.md#第0章]
> **关联 ADR**: [doc:decisions/013-all-things-spirit-mind-vision.md]
> **类型**: forgemind
> **创建日期**: 2026-07-17
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.12]（FR-CORE-012，与本文档同号对应）
> **对应 arch.md**: [doc:../arch.md#§3.12]（待创建）
> **对应 design.md**: [doc:../design.md#§3.12]（待创建）

---

## 1. 概述（Overview）

虚拟世界设定层是 forgemind 应用层对虚拟世界的承载：为 VirtualForgekin / HybridForgekin 形态Forgekin提供三层世界引擎（Core Identity Layer / World Layer / Bridge Layer）。本 Feature 实现虚拟世界设定、9 个一等公民建模、三路记忆区分、"RP 台词不自动入典"铁律、Role Mask 五层分类、世界自转机制，让"孙悟空Forgekin遵循西游世界观"可工程化落地。

这是 Build to Persist 基础设施——编码"虚拟角色智能体工程实现"的工程规则，对标前期世界引擎三层架构。

## 2. 动机（Motivation）

`[doc:review/review.md#FM-010]` 指出：v7.0 无虚拟世界设定层，Forgekin persona 是扁平文本，无法承载"孙悟空Forgekin应遵循西游世界观"这类设定。`[doc:review/review.md#CL-007~CL-013]` 进一步指出：v7.0 无 Core Identity 隔离层（CL-007）、无 9 一等公民建模（CL-008）、无三路记忆区分（CL-009）、无"RP 台词不自动入典"铁律（CL-010）、无 Role Mask 五层（CL-011）、无 Bridge Layer 三协议（CL-012）、无世界自转（CL-013）。

不做这个 Feature，VirtualForgekin 只是"带 persona 的 LLM"，Forgekin演 1000 次孙悟空后核心身份被污染，临时 RP 台词自动污染永久典藏。这是虚拟 AI 复现路径的世界观底座。

## 3. 详细设计（Detailed Design）

### 3.1 数据模型（三层世界引擎）

```python
# === Core Identity Layer（不可变身份层，CL-007）===
class CoreIdentity(BaseModel):
    """核心身份（不可被任何 Episode 污染）"""
    soul_imprint: str                          # SoulImprint（naming-contract.md §2.6）
    species: ForgekinSpecies                   # 形态（F027）
    core_values: list[str]                     # 核心价值锚点（不可变）
    core_personality: str                      # 核心性格（不可变）
    created_at: datetime

# === World Layer（世界层，CL-008）===
class FirstClassCitizen(str, Enum):
    """9 个一等公民"""
    WORLD = "world"                 # World 世界设定
    CHARACTER = "character"         # Character 角色
    SCENE = "scene"                 # Scene 场景
    CANON_DECISION = "canon"        # Canon Decision 典藏决策
    RELATIONSHIP = "relationship"   # Relationship 关系
    ARTIFACT = "artifact"           # Artifact 造物
    ROUND = "round"                 # Round 回合
    BRANCH = "branch"               # Branch 分支
    TURN = "turn"                   # Turn 轮次

class WorldSetting(BaseModel):
    """虚拟世界设定"""
    world_id: str
    name: str                                  # 如"西游世界观"
    citizens: dict[FirstClassCitizen, list[str]]  # 一等公民实例 ID
    canon_memory_ref: str                      # Canon 典藏记忆（永久）
    relational_memory_ref: str                 # Relational 关系记忆（长期）
    session_memory_ref: str                    # Session 会话记忆（临时）

# === Bridge Layer（桥接层，CL-011/CL-012）===
class RoleMaskLayer(str, Enum):
    """Role Mask 五层（CL-011）"""
    L1_ROUTING = "l1_routing"       # 路由身份
    L2_INFRA = "l2_infra"           # 基础设施
    L3_OWN_CAPABILITY = "l3_own"    # 本体能力
    L4_SCENE_SKIN = "l4_scene"      # 场景皮肤（RP 角色）
    L5_IN_WORLD_STATE = "l5_state"  # 世界内状态

class BridgeProtocol(str, Enum):
    """三协议（CL-012）"""
    ROLE_MASK = "role_mask"         # Role Mask Protocol
    CANON_SYNC = "canon_sync"       # Canon Sync Protocol
    WORLD_DRIVER = "world_driver"   # World Driver Protocol
```

### 3.2 核心接口

```python
class CoreIdentityGuard(ABC):
    """Core Identity 守卫（CL-007）"""
    @abstractmethod
    async def get_immutable(self, forgekin_id: str) -> CoreIdentity: ...
    @abstractmethod
    async def assert_not_polluted(self, forgekin_id: str, episode_data: dict) -> bool: ...

class CanonSyncGate(ABC):
    """Canon Sync 门（CL-010 铁律：RP 台词不自动入典）"""
    @abstractmethod
    async def submit_for_canon(self, episode_id: str, content: dict) -> str: ...
    @abstractmethod
    async def approve_canon(self, request_id: str, approver: str) -> None: ...  # operator/Canon Driver
    @abstractmethod
    async def reject_canon(self, request_id: str, reason: str) -> None: ...

class WorldDriver(ABC):
    """世界驱动（CL-012/CL-013 世界自转）"""
    @abstractmethod
    async def tick(self, world_id: str) -> None: ...  # 推进世界时间
    @abstractmethod
    async def emit_world_event(self, world_id: str) -> list[dict]: ...  # 世界自转事件

class RoleMaskCoordinator(ABC):
    """runtime coordinator（CL-012 导演）"""
    @abstractmethod
    async def wear_mask(self, forgekin_id: str, layer: RoleMaskLayer, mask_id: str) -> None: ...
    @abstractmethod
    async def take_off_mask(self, forgekin_id: str, layer: RoleMaskLayer) -> None: ...
```

### 3.3 关键算法

- **Core Identity 隔离**：核心身份字段（soul_imprint/species/core_values/core_personality）永不被 Episode 修改，即使演 1000 次孙悟空，核心身份仍是 Forgekin 自身。
- **三路记忆严格区分**：Canon（永久，世界级真相，需 Canon Sync 显式确认）/ Relational（长期，角色间互动）/ Session（临时，单次回合），存储相互隔离。
- **"RP 台词不自动入典"铁律**：Role Play 中Forgekin说的话、做的事进入 Session 记忆，必须经 CanonSyncGate 显式批准才能进入 Canon 记忆。
- **Role Mask 五层独立加载/卸载**：L4 场景皮肤（孙悟空）不污染 L3 本体能力（写作能力），mask 可独立 wear/take_off。
- **世界自转**：WorldDriver.tick 定时推进世界时间，NPC 角色/关系/场景自己演化，写入 Canon 记忆（需 Canon Sync 确认）。

### 3.4 配置外置（YAML 示例）

```yaml
virtual_world:
  core_identity_guard:
    immutable_fields: [soul_imprint, species, core_values, core_personality]
    pollution_check: strict
  world_settings:
    journey_to_west:
      citizens:
        world: [w_jtw_main]
        character: [c_sun_wukong, c_tangseng, c_zhubajie]
        relationship: [r_sun_tang_master]
      canon_memory: echo_canon_jtw
      relational_memory: echo_rel_jtw
      session_memory: echo_session_jtw
  bridge_protocols:
    canon_sync:
      approver: operator
      auto_reject_after_hours: 72
    world_driver:
      tick_interval_seconds: 3600
      auto_canon_on_world_event: false   # 世界事件也需 Canon Sync
  role_mask:
    layers_independent: true
```

## 4. 验收标准（Acceptance Criteria）

- [ ] AC-1: Core Identity 字段永不被 Episode 修改（CL-007）
- [ ] AC-2: 9 个一等公民可建模且写入 World Layer（CL-008）
- [ ] AC-3: 三路记忆（Canon/Relational/Session）存储相互隔离（CL-009）
- [ ] AC-4: RP 台词不自动入 Canon，必须 CanonSyncGate 显式批准（CL-010 铁律）
- [ ] AC-5: Role Mask 五层可独立 wear/take_off，L4 不污染 L3（CL-011）
- [ ] AC-6: Bridge Layer 三协议 + runtime coordinator 可编排（CL-012）
- [ ] AC-7: WorldDriver.tick 可推进世界自转，世界事件仍需 Canon Sync（CL-013）

## 5. 测试策略

### 5.1 单元测试

- Core Identity 污染检测、三路记忆隔离、Canon Sync 门、Role Mask 五层、世界自转 tick。

### 5.2 集成测试

- 接入 F027 形态分类（VirtualForgekin/HybridForgekin）、F014 EchoStore集合、F038 谱系追踪。

### 5.3 E2E 测试（必须遵守 T1-T8 测试铁律）

- 真实 operator 锻造孙悟空 VirtualForgekin（西游世界观），Forgekin通过真实 LLM 演 1000 次 RP，验证：①Core Identity 仍是 Forgekin 自身 ②RP 台词不自动入 Canon ③operator 显式批准的台词才入 Canon ④L4 场景皮肤不污染 L3 本体能力 ⑤WorldDriver 推进世界自转。**遵守 T1-T8**：真实 LLM、真实数据、真实工具调用。

## 6. 引用

- [doc:roleagent.md#第0章]
- [doc:review/review.md#第九章/FM-010]
- [doc:review/review.md#第十三章/CL-007]
- [doc:review/review.md#第十三章/CL-008]
- [doc:review/review.md#第十三章/CL-009]
- [doc:review/review.md#第十三章/CL-010]
- [doc:review/review.md#第十三章/CL-011]
- [doc:review/review.md#第十三章/CL-012]
- [doc:review/review.md#第十三章/CL-013]
- [doc:decisions/013-all-things-spirit-mind-vision.md]
- [doc:design/naming-contract.md#2.6]（SoulImprint）
- [doc:design/naming-contract.md#2.5]（EchoStore）
- [doc:features/F027-all-things-spirit-species.md]
- [doc:features/F014-memory-collection.md]
- [doc:features/F038-forgemind-lineage.md]
- [doc:project_rules.md#T1-T8]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
