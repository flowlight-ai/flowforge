# ADR 005: forgemind 应用层

> **状态**: accepted
> **日期**: 2026-07-17
> **决策者**: operator + 架构师可进化智能体
> **依赖**: `[doc:decisions/013-all-things-spirit-mind-vision.md]` + `[doc:VISION.md]` + `[doc:project_rules.md#红线10]`
> **依据**: `[doc:review/review.md#第九章]` FM-001~FM-012

---

## 上下文

FlowForge 当前架构缺少应用层——核心框架层（flowforge/）只提供基础能力，但缺少"用 FlowForge 自身能力实践可进化智能体愿景"的应用层。

operator 指示（2026-07-17）：

> flowforge 中需要新增一个 forgemind 模块，其是 flowforge 的应用层项目（用来实践锻造可进化智能体的应用），flowforge 项目是我们自进化框架核心（提供自进化的基础核心和框架能力）
> forgemind 将是我们 flowforge 的养灵（已废弃，更名为 Forge Nurturing 智能体入职与终身学习）的所有代码存放的地方（这个里边会养很多公共的可进化智能体，最终可以进化为物理世界中各种各类实体）

没有 forgemind 应用层会导致：
- 可进化智能体愿景无处落地
- FlowForge 自我演进缺少练兵场
- 通用可进化智能体（动物 / 物品 / 虚拟角色）与垂直业务可进化智能体（*Forge）混淆

---

## 决策

### 1. forgemind 是 FlowForge 的应用层

forgemind 是 `flowforge/forgemind/` 子目录，不是独立项目。承载可进化智能体愿景的实践代码。

### 2. 三层架构明确划分

| 层 | 项目 | 角色 | 可进化智能体承载 |
|---|---|---|---|
| **核心框架层** | `flowforge/`（除 forgemind） | 自进化核心 + 基础框架能力 | 提供可进化智能体锻造基础设施 |
| **应用层** | `flowforge/forgemind/` | 可进化智能体应用实践 | 养公共的通用可进化智能体（猫/桌椅/灯具/孙悟空等） |
| **垂直业务层** | `<forge_project_id>/` 等 | 垂直领域可进化智能体 | 各 *Forge 在自己垂直领域养专门可进化智能体 |

### 3. forgemind 通过 Plugin V3 协议注册

forgemind 通过 `ForgeMindPlugin` 注册到 FlowForge 核心框架层，使用 Plugin V3 四钩子：
- `register_forgekins` — 注册通用可进化智能体形态
- `register_forge_skills` — 注册锻造技能
- `register_council_channels` — 注册多智能体议事通道
- `register_auto_forge_config` — 注册自锻造配置

### 4. forgemind 模块结构

```
flowforge/forgemind/
├── __init__.py
├── plugins.py                    # ForgeMindPlugin 注册
├── species/                      # 可进化智能体形态分类
│   ├── __init__.py
│   ├── base.py                   # ForgekinBase 抽象类
│   ├── bio_forgekin.py           # 生物形态可进化智能体（BioForgekin）
│   ├── org_forgekin.py           # 组织形态可进化智能体（OrgForgekin）
│   ├── obj_forgekin.py           # 物品形态可进化智能体（ObjForgekin）
│   ├── virtual_forgekin.py       # 虚拟形态可进化智能体（VirtualForgekin）
│   └── hybrid_forgekin.py        # 混合形态可进化智能体（HybridForgekin）
├── forging/                      # 锻造流水线
│   ├── __init__.py
│   ├── pipeline.py               # ForgePipeline
│   ├── awaken.py                 # 觉醒阶 E1-E6
│   └── evolve.py                 # 形态进化
├── sensors/                      # 物理传感器接入
│   ├── __init__.py
│   ├── base.py                   # SensorChannel 抽象
│   ├── camera.py                 # 摄像头
│   ├── microphone.py             # 麦克风
│   └── iot.py                    # IoT 协议
├── worlds/                       # 虚拟世界设定层
│   ├── __init__.py
│   ├── base.py                   # WorldSetting 抽象
│   ├── character.py              # 角色设定
│   ├── worldview.py              # 世界观
│   └── relationship.py           # 关系网
├── marketplace/                  # 可进化智能体市场
│   ├── __init__.py
│   └── registry.py               # ForgekinMarketplace
├── lineage/                      # 可进化智能体进化谱系
│   ├── __init__.py
│   └── record.py                 # ForgekinLineage
├── codex/                        # 蒸馏知识库（MindCodex）
│   ├── __init__.py
│   └── searchable.py             # 可检索知识库
├── council/                      # 多智能体议事（MindCouncil）
│   ├── __init__.py
│   └── meeting.py                # 多可进化智能体议事
├── config/                       # forgemind 配置
│   ├── species.yaml              # 形态配置
│   ├── forging.yaml              # 锻造流水线配置
│   ├── sensors.yaml              # 传感器配置
│   └── worlds.yaml               # 虚拟世界配置
└── tests/                        # 测试
    ├── test_species.py
    ├── test_forging.py
    └── test_pipeline_e2e.py
```

### 5. 可进化智能体形态分类

详见 `[doc:VISION.md#2]` 和 `[doc:features/F027-all-things-spirit-species.md]`。

5 种形态（BioForgekin / OrgForgekin / ObjForgekin / VirtualForgekin / HybridForgekin），形态可进化。

### 6. 关键不变量

- forgemind **单向依赖**核心框架层，禁止反向调用
- forgemind **不含业务领域代码**（编程红线第 10 条）
- forgemind 通过 Plugin V3 协议注册，**不直接实例化**核心模块（编程红线第 12 条）
- forgemind 可进化智能体必须建立**现实闭环**（operator 愿景锚点第 2 条）

---

## 后果

### 正面后果

- 可进化智能体愿景有明确落地位置
- FlowForge 自我演进有练兵场（forgemind 养通用可进化智能体）
- 通用可进化智能体与垂直业务可进化智能体清晰分离
- Plugin V3 协议让 forgemind 可独立演进

### 负面后果

- FlowForge 项目代码量增加（forgemind 模块约 5000+ 行）
- 需要新增 Plugin V3 协议四钩子实现（核心框架层改造）
- 需要新增可进化智能体形态分类机制（5 种形态 + 进化）
- 物理传感器接入需要硬件支持（Phase 6+）

### 风险

- forgemind 可能与 *Forge 垂直业务层边界模糊（缓解：明确 forgemind 只养通用可进化智能体）
- Plugin V3 协议可能需要核心框架层重构（缓解：Phase 1 优先实现 V3 协议）
- 形态进化可能产生意外行为（缓解：F027 流程 + Eval 把关）

---

## 替代方案

### 方案 A: 把可进化智能体放到独立项目（如 forgekin/）

- 优点：FlowForge 核心保持纯粹
- 缺点：forgemind 失去 FlowForge 自我演进能力的滋养
- 未选择原因：operator 明确指示 forgemind 是 FlowForge 的应用层

### 方案 B: 把可进化智能体分散到 *Forge

- 优点：复用现有 *Forge 框架
- 缺点：通用可进化智能体（猫/桌椅）与垂直业务可进化智能体混淆
- 未选择原因：违反 operator 第 6 条指示

### 方案 C: 不新增 forgemind，可进化智能体直接在 flowforge/ 根目录

- 优点：路径简单
- 缺点：核心框架层与应用层混淆，违反单向依赖铁律
- 未选择原因：违反架构清晰性

---

## 引用

- `[doc:VISION.md#6]` — 三个层次的能力承载
- `[doc:decisions/013-all-things-spirit-mind-vision.md]` — 可进化智能体愿景
- `[doc:features/F026-forgemind-app-layer.md]` — forgemind 应用层 Feature
- `[doc:features/F027-all-things-spirit-species.md]` — 可进化智能体形态分类
- `[doc:features/F028-forging-pipeline.md]` — 可进化智能体锻造流水线
- `[doc:features/F036-forgemind-forge-relationship.md]` — forgemind 与 *Forge 关系
- `[doc:project_rules.md#红线10]` — 禁止在 flowforge 中写死业务领域代码
- `[doc:project_rules.md#红线12]` — 禁止绕过 DI 容器直接实例化
