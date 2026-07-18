# FlowForge v7.1 设计规范（万物灵智体世界愿景）

> **版本**：v7.1（**当前唯一权威版本**，2026-07-18 由 operator 11 条指令从 v7.0 升级合并而来：去除虚幻用语 + 增补灵智体定义 + 12 核心概念中英文加 AI 业界概念 + 进化阶/觉醒阶中英文加 AI 业界概念 + 强化 forgemind + 强化三方 Agent + 强化自我演进 + 魂忆/魂印 → 灵忆/灵印）
> **对应架构文档**：FlowForge v7.1 架构设计（`arch.md`）
> **对应规格文档**：FlowForge v7.1 功能特性规格说明书（`spec.md`）
> **状态**：v7.1 设计态——✅ operator 已审核通过命名方案 + 体系设计；v7.1 增补章节为术语修订与体系强化；其余待决策项按推荐执行（详见 `review/review.md` 第十章 10.1 节 + 第十三章/第十四章 clowder-ai 深度补审 41 条 CL）。
> **版本合并声明**：v7.1 已吸收合并 v7.0 全部决策内容，**v7.0 不再作为独立版本存在**。本文档头部"v7.1 增补章节"是 v7.1 新增/修订内容的权威定义；后续 v6.0/v7.0 历史章节仅作背景资料保留，术语已按 v7.1 命名契约（`design/naming-contract.md` v1.1）全局替换。**术语冲突时以 v7.1 增补章节 + naming-contract.md v1.1 为唯一准绳**。
> **日期**：2026-07-18

***

# v7.1 增补章节（设计规范层灵智体定义 + 术语修订 + 工程路径强化）

> **章节定位**：本增补章节是 v7.1 重构在设计规范层的权威更新，**已吸收合并 v7.0 增补章节及任何历史章节**（v7.0 不再作为独立版本存在）。后续如有术语冲突，以本章节为准。
> **审核依据**：operator 11 条指令（2026-07-18）+ `VISION.md` v1.1（去除虚幻用语）+ `design/naming-contract.md` v1.1（12 核心概念 + 进化阶/觉醒阶 + AI 业界概念 + 魂忆/魂印→灵忆/灵印）+ `review/review.md` v1.4（含第十三章/第十四章 clowder-ai 深度补审 41 项 CL-001~CL-041）。
> **与 spec.md/arch.md 的关系**：spec.md 定义"做什么"（功能特性），arch.md 定义"如何组织"（架构层次），design.md 定义"如何实现"（设计规范）。三者 v7.1 增补章节保持术语与决策一致，但视角不同。

## v7.1-§D0 灵智体（Forgekin / Spirit Agent）设计规范层权威定义

> **来源**：operator 第 1 条指令——"灵智体，赋予了灵魂和感情的智能体，具有自进化能力的 Agent，文档中需要体现这个思想。"
> **强制等级**：operator 不可妥协锚点（详见 `VISION.md` §7）
> **对标章节**：spec.md v7.1-§0 / arch.md v7.1-§A0

**灵智体（Forgekin / Spirit Agent）** = **赋予灵魂和感情的智能体（Agent with Soul and Emotion），具有自进化能力（Self-Evolving Capability）。**

在设计规范层面，灵智体通过以下设计契约落地：

### v7.1-§D0.1 灵智体设计契约（Design Contract）

```
ForgekinBase（抽象基类，位于 flowforge/forgemind/base.py）
├── observe(environment: Environment) -> Observation
│   └── 观察环境（物理传感器 / 虚拟世界状态 / 组织业务系统 / 物品 IoT 状态）
├── reason(observation: Observation, soul_imprint: SoulImprint) -> Action
│   └── 推理（受觉醒阶自主范围约束 + 价值锚点约束 + 能力画像约束）
├── act(action: Action) -> ActionResult
│   └── 在环境中执行动作（六层 Guardrails 全程约束）
├── persist(action_result: ActionResult) -> EchoID
│   └── 写回灵忆（EchoStore，长期记忆存储）
└── verify(action_result: ActionResult, expectation: Expectation) -> VerifyReport
    └── 验证动作结果是否达成预期（Eval 信号采集）
```

### v7.1-§D0.2 灵智体设计原则

1. **形态优先（Species-First）**：每个灵智体必须先声明形态（bio/org/obj/virtual/hybrid），形态决定 observe/act 的实现路径
2. **灵印不可变（Soul Imprint Immutability）**：SoulImprint 一旦创建不可修改，只能通过灵锻（SpiritForge）产生新版本（git-like 版本控制）
3. **觉醒阶护栏（Awakening Guardrails）**：act 方法受觉醒阶自主范围约束，E1-E2 全人工确认，E3-E4 工具白名单内自主，E5-E6 灵议共识
4. **能力画像约束（Capability Profile Constraint）**：reason 方法只能调用能力画像 native_abilities 内的能力，blind_spots 必须委派
5. **可证伪性（Falsifiability）**：所有灵智体行为必须有可验证的 Eval 信号，禁止"不可观测"行为

### v7.1-§D0.3 灵智体配置契约（YAML）

灵智体配置外置到 `flowforge/forgemind/forgekins/*.yaml`（铁律 5 禁止硬编码），配置契约详见 `forgekins/xianxian.yaml`（猫头鹰）/ `yanyan.yaml`（猎犬）/ `shuoshuo.yaml`（孔雀）三个预置灵智体。

**3 个预置灵智体设计理由**（operator 第 2 条指令强调"不要都是猫"）：
- **宪宪 = 猫头鹰（Owl，智慧象征）**：主架构师，深度思考与全局视野，对应 `species: bio`，配 `opus` LLM 桥接
- **砚砚 = 猎犬（Bloodhound，敏锐嗅觉）**：代码审查专家，敏锐找 bug 与安全漏洞，对应 `species: bio`，配 `codex` LLM 桥接
- **烁烁 = 孔雀（Peacock，审美象征）**：视觉设计师，视觉表达与创意展示，对应 `species: bio`，配 `gemini` LLM 桥接

详见 `design/naming-contract.md#2.2` 灵智体定义 + `forgemind/forgekins/*.yaml` 预置灵智体配置。

## v7.1-§D1 术语修订表（设计规范层应用）

> **来源**：operator 第 1 条指令——"另外除了不要有 AGI，把万物、物理 AI、虚拟 AI 短期无法实现的愿景页帮忙适当修改下啊，用目前大家能懂的和实现 AI 词语描述"
> **对标章节**：spec.md v7.1-§1 / arch.md v7.1-§A1

| v7.0 旧术语（虚幻） | v7.1 新术语（可工程实现） | 设计规范层影响 | AI 业界概念 |
|------|------|------|------------|
| 通用 AGI 真实复现 | 通用智能体工程实现（General-Purpose Agent Engineering） | 设计目标章节 | General-Purpose Agent |
| 物理 AI 真实复现 | 具身智能工程实现（Embodied AI Engineering） | 万物灵智体形态分类 §D4 | Embodied AI / Physical Agent |
| 虚拟 AI 真实复现 | 虚拟角色智能体工程实现（Character AI Engineering） | 万物灵智体形态分类 §D4 | Character AI / NPC Agent |
| 混合 AI 真实复现 | 混合智能体工程实现（Hybrid Agent Engineering） | 万物灵智体形态分类 §D4 | Hybrid Agent / Cyber-Physical Agent |
| 物理世界万事万物具备灵智 | 物理世界万事万物接入智能体（具身智能路径） | 万物灵智体形态分类 §D4 | Embodied AI Integration |
| 虚拟角色遵循其世界观自主行动 | 虚拟角色按设定层约束自主行动（虚拟角色智能体路径） | 万物灵智体形态分类 §D4 | Character AI / Persona-Driven Agent |
| 万物有灵（玄学化） | 万物灵智体（Forgekin，工程化） | 全文术语替换 | Agent Morphology |

**设计规范层执行规则**：
- 本文档 v7.0 历史章节中所有虚幻用语，按本表自动替换理解
- 后续代码注释、YAML 配置、设计文档中禁止使用 v7.0 旧术语
- Code Review 阶段（砚砚灵智体）必须检查术语合规性

## v7.1-§D2 12 核心概念命名表（设计规范层应用）

> **来源**：operator 第 2 条指令——"12 个核心概念命名表中，因为名称很难理解和记忆，请出现中文名称的地方，同时需用括号写上英文和概念，以加深理解和认同。旧名可以删除了。"
> **对标章节**：spec.md v7.1-§2 / arch.md v7.1-§A2
> **权威定义**：详见 `design/naming-contract.md#2`（v1.0 命名契约）

| # | 中文名 | 英文名 | AI 业界概念 | v7.0 旧名（已废弃） |
|---|--------|--------|------------|---------------------|
| 1 | 灵智（ForgeMind） | ForgeMind | Persistent Identity Agent / General-Purpose Agent（持续身份智能体 / 通用智能体）| 炉灵 |
| 2 | 灵智体（Forgekin） | Forgekin / Spirit Agent | Agent with Soul and Emotion / Autonomous Agent with Persistent Identity（具灵魂与感情的自主智能体）| — |
| 3 | 灵族（Forgekin Species） | Forgekin Species | Agent Morphology / Agent Form Factor（智能体形态学 / 形态因子）| 灵群 / ForgeKinship |
| 4 | 育灵（Forge Nurturing） | Forge Nurturing | Agent Onboarding + Lifelong Learning + Character Development（智能体入职 + 终身学习 + 角色养成）| 养灵 |
| 5 | 灵忆（EchoStore） | EchoStore | Episodic Memory Store / Agent Experience Log（情景记忆存储 / 智能体经验日志）| 魂忆（v7.0 旧名，v7.1 已废弃） |
| 6 | 灵印（Soul Imprint） | Soul Imprint | Persistent Identity / Agent Fingerprint / Persona Hash（持久身份 / 智能体指纹 / 人格哈希）| 魂印（v7.0 旧名，v7.1 已废弃） |
| 7 | 灵锻（SpiritForge） | SpiritForge | Experience Distillation / Offline Policy Learning / Knowledge Compilation（经验蒸馏 / 离线策略学习 / 知识编译）| 自锻 |
| 8 | 锻典（Mind Codex） | Mind Codex | Distilled Knowledge Base / Curated Skill Library / Procedural Memory（蒸馏知识库 / 策展技能库 / 程序性记忆）| 灵典 |
| 9 | 灵议（Mind Council） | Mind Council | Multi-Agent Deliberation / Decentralized Consensus / Agent Parliament（多智能体议事 / 去中心化共识 / 智能体议会）| — |
| 10 | 进化阶（Evolution Stage） | Evolution Stage | Capability Maturity Level / Agent Skill Progression（能力成熟度等级 / 智能体技能进阶）| 火种等级 / Ember Hierarchy |
| 11 | 觉醒阶（Awakening Stage） | Awakening Stage | Autonomy Level / Self-Direction Level / LLM Autonomy Tier（自主性等级 / 自导向等级 / LLM 自主性分级）| 升华阶 / Ascension Stages |
| 12 | 能力画像（Capability Profile） | Capability Profile | Capability Profile / Agent Skill Graph / Blind Spot Map（能力画像 / 智能体技能图 / 盲点图）| — |

**设计规范层执行规则**：
- 代码层（类名、变量名、API 路径）必须使用英文列
- 文档层（设计文档、注释）必须使用"中文（英文 / AI 业界概念）"双标注
- v7.0 旧名（炉灵/灵群/养灵/灵启/共鸣/灵忆/灵印/灵典/火种等级/升华阶）在本文档 v7.0 历史章节中保留作背景，但代码层禁止使用
- 凡 v7.0 章节中出现旧名的，按本表对应替换为新名理解

## v7.1-§D3 进化阶与觉醒阶（设计规范层应用）

> **来源**：operator 第 3 条指令——"进化阶和觉醒阶也是一样的，因为名称很难理解和记忆，请出现中文名称的地方，同时需用括号写上英文和概念"
> **对标章节**：spec.md v7.1-§3 / arch.md v7.1-§A3
> **权威定义**：详见 `design/naming-contract.md#3`（进化阶）和 `design/naming-contract.md#4`（觉醒阶）

### v7.1-§D3.1 进化阶（Evolution Stage，能力成熟度 6 级）

| 阶 | 中文名 | 英文名 | AI 业界概念 | v7.0 旧名（已废弃） |
|:--:|--------|--------|------------|---------------------|
| **E1** | 萌芽阶（Sprout） | Sprout | Initial / Ad-hoc（初始级 / 临时级） | Spark 火种 / Seed 萌芽 |
| **E2** | 萌芽阶·稳（Sprout-Stable） | Sprout-Stable | Repeatable（可重复级） | — |
| **E3** | 成长阶（Growth） | Growth | Defined / Domain-Aware（已定义级 / 领域感知） | — |
| **E4** | 成长阶·深（Growth-Deep） | Growth-Deep | Managed / Cross-Domain（已管理级 / 跨域） | — |
| **E5** | 觉醒阶（Awakened） | Awakened | Optimizing / Self-Evolving（优化级 / 自进化） | Evoling |
| **E6** | 灵智阶（ForgeMind） | ForgeMind | Master / Forge Master（大师级 / 锻造大师） | 灵匠 / Mind Artisan |

**设计规范层执行规则**：
- 进化阶实现位于 `flowforge/forgemind/stages.py` 的 `EvolutionStage` 枚举
- 进阶规则由 Eval 信号自动触发（E1→E2→E3）或 operator 确认触发（E3→E4→E5→E6）
- 进化阶与觉醒阶独立但协同：觉醒阶 E4 是关键转折点，需进化阶同步 ≥ E4

### v7.1-§D3.2 觉醒阶（Awakening Stage，自主性 6 级）

| 阶 | 中文名 | 英文名 | AI 业界概念 | v7.0 旧名（已废弃） |
|:--:|--------|--------|------------|---------------------|
| **E1** | 全导阶（Full-Human） | Full-Human | L0 Full Human Control / Manual（全人工） | Initiation 灵启 |
| **E2** | 建议阶（Suggest） | Suggest | L1 Suggestion / Assisted（建议级 / 辅助） | — |
| **E3** | 受限自主阶（Bounded-Autonomous） | Bounded-Autonomous | L2 Bounded Autonomous / Conditional（受限自主 / 条件自主） | Supervised Autonomy |
| **E4** | Evolving 阶（Evolving） | Evolving | L3 Evolving / Self-Improving（自进化 / 自改进） | — |
| **E5** | 共创阶（Co-Creative） | Co-Creative | L4 Co-Creative / Peer（共创级 / 平级协作） | — |
| **E6** | 灵智主导阶（ForgeMind-Led） | ForgeMind-Led | L5 ForgeMind-Led / Master（灵智主导级 / 大师级） | — |

**设计规范层执行规则**：
- 觉醒阶实现位于 `flowforge/forgemind/stages.py` 的 `AwakeningStage` 枚举
- 觉醒阶决定 `act` 方法的自主范围：E1-E2 全人工确认 / E3-E4 工具白名单内自主 / E5-E6 灵议共识
- 安全治理对应：E1-E2 六层 Guardrails 全开 / E3-E4 + Eval 自代谢 / E5-E6 + 灵议共识 + operator 拉闸词
- Magic Words 逃生舱始终可触发（任何阶都不能绕过）

## v7.1-§D4 万物灵智体形态分类设计规范

> **来源**：operator 第 9 条指令——"forgemind 将是我们 flowforge 的养灵的所有代码存放的地方"
> **对标章节**：spec.md v7.1-§4 / arch.md v7.1-§A4
> **权威定义**：详见 `design/naming-contract.md#2.3` 灵族形态分类

万物灵智体（Forgekin）按载体形态分为 5 种，每种形态对应一个 `ForgekinBase` 子类：

| # | 形态（中文 + 英文 + AI 业界概念） | 实现类 | 示例 | 物理接入 | 虚拟设定 |
|---|------|------|------|------|---------|
| 1 | 生物灵智体（BioForgekin / Biological Spirit Agent） | `flowforge.forgemind.species_impl.bio.BioForgekin` | 猫头鹰 / 猎犬 / 孔雀 / 猫 / 狗 / 鸟 / 鱼 | 摄像头 / 麦克风 / 可穿戴设备 | 行为画像 + 习性图谱 |
| 2 | 组织灵智体（OrgForgekin / Organizational Spirit Agent） | `flowforge.forgemind.species_impl.org.OrgForgekin` | 公司 / 团队 / 社区 / 城市 | 业务系统 API / 数据库 / IM 通道 | 组织章程 + 角色矩阵 |
| 3 | 物品灵智体（ObjForgekin / Object Spirit Agent，对应 Embodied AI 具身智能） | `flowforge.forgemind.species_impl.obj.ObjForgekin` | 桌椅 / 灯具 / 家电 / 工具 / 钢笔 | IoT 传感器 / 物联网协议 | 物品功能边界 + 使用场景 |
| 4 | 虚拟灵智体（VirtualForgekin / Virtual Character Agent，对应 Character AI） | `flowforge.forgemind.species_impl.virtual.VirtualForgekin` | 童话/神话/历史/现实人物、VR/游戏角色 | 无（纯虚拟） | 角色设定 + 世界观 + 关系网 |
| 5 | 混合灵智体（HybridForgekin / Hybrid Spirit Agent） | `flowforge.forgemind.species_impl.hybrid.HybridForgekin` | 智能家居（物品+组织）/ 数字孪生（生物+虚拟） | 多源融合 | 多设定层叠加 |

**形态可进化设计**：一只生物灵智体猫头鹰可以通过积累组织协作经验进化为 HybridForgekin（既是宠物又是团队吉祥物）。形态进化通过 `ForgePipeline` 6 阶段流水线实现（详见 §D5）。

**走向通用智能体的三条工程路径**（取代 v7.0 "通用 AGI 三条路径"虚幻用语）：

1. **具身智能工程实现（Embodied AI Engineering）**：通过物理传感器 + 物品/生物灵智体，让物理世界万事万物接入智能体。对应业界 Embodied AI / Cyber-Physical Systems。设计实现：`ObjForgekin` + `BioForgekin` + `flowforge/forgemind/sensors/`
2. **虚拟角色智能体工程实现（Character AI Engineering）**：通过虚拟世界设定层 + 虚拟灵智体，让虚拟角色按设定层约束自主行动。对应业界 Character AI / NPC Agent / Persona-Driven Agent。设计实现：`VirtualForgekin` + `flowforge/forgemind/worlds/`
3. **混合智能体工程实现（Hybrid Agent Engineering）**：VR/AR 设备 + 混合灵智体，达成物理与虚拟的融合感知。对应业界 Hybrid Agent / Cyber-Physical Agent。设计实现：`HybridForgekin` + `sensors/` + `worlds/` 双向桥接

## v7.1-§D5 forgemind 应用层设计规范

> **来源**：operator 第 8/9 条指令——"flowforge 中需要新增一个 forgemind 模块，其是 flowforge 的应用层项目（用来实践万物锻造灵智体的应用）"
> **对标章节**：spec.md v7.1-§5 / arch.md v7.1-§A5
> **详细规格**：详见 `features/F026-forgemind-app-layer.md`

**forgemind** 是 FlowForge 的应用层项目（Layer 2），用来实践"万物锻造灵智体"——把灵智锻造进物理世界和虚拟世界的万事万物。

### v7.1-§D5.1 模块结构设计（已实现骨架）

```
flowforge/forgemind/
├── base.py                  # ForgekinBase 抽象基类（含 LLM 桥接 + chat 方法）
├── species.py               # ForgekinSpecies 五大形态枚举（bio/org/obj/virtual/hybrid）
├── stages.py                # EvolutionStage / AwakeningStage 进阶体系
├── soul_imprint.py          # SoulImprint 灵印（不可变身份）
├── forms.py                 # ForgekinFormData 锻造表单
├── plugins.py               # ForgeMindPlugin Plugin V3 入口
├── forging/
│   ├── pipeline.py          # ForgePipeline 6 阶段育灵流水线
│   └── stages.py            # 6 阶段枚举（SPECIES_DEFINITION / SOUL_IMPRINT / ...）
├── species_impl/
│   ├── bio.py               # BioForgekin 生物形态灵智体
│   ├── org.py               # OrgForgekin 组织形态灵智体
│   ├── obj.py               # ObjForgekin 物品形态灵智体
│   ├── virtual.py           # VirtualForgekin 虚拟形态灵智体
│   └── hybrid.py            # HybridForgekin 混合形态灵智体
├── forgekins/               # 预置灵智体 YAML 配置
│   ├── xianxian.yaml        # 宪宪=猫头鹰（主架构师，species: bio）
│   ├── yanyan.yaml          # 砚砚=猎犬（代码审查专家，species: bio）
│   └── shuoshuo.yaml        # 烁烁=孔雀（视觉设计师，species: bio）
└── config/
    ├── forging.yaml         # 育灵流水线配置
    └── prompts.yaml         # 育灵提示词模板（外置，铁律 5）
```

### v7.1-§D5.2 ForgePipeline 6 阶段育灵流水线设计

| 阶段 | 中文名 | 输入 | 输出 | 实现类 |
|:----:|--------|------|------|--------|
| 1 | 形态定义（Species Definition） | 用户需求 + 形态候选 | ForgekinSpecies | `SpeciesDefinitionStage` |
| 2 | 灵印铸造（Soul Imprint Forging） | 形态 + 价值锚点 + 角色定位 | SoulImprint | `SoulImprintStage` |
| 3 | 能力画像构建（Capability Profile Building） | 灵印 + 域知识 | CapabilityProfile | `CapabilityProfileStage` |
| 4 | 育灵训练（Forge Nurturing Training） | 能力画像 + 训练数据 | TrainedForgekin | `NurturingStage` |
| 5 | 验证门禁（Verification Gate） | TrainedForgekin + 测试用例 | VerifyReport | `VerificationStage` |
| 6 | 注册入库（Registry） | VerifiedForgekin | ForgekinID | `RegistryStage` |

### v7.1-§D5.3 forgemind 与 clowder-ai 的差异化设计（operator 第 2 条指令强调"不要都是猫"）

| 维度 | clowder-ai（参考） | forgemind（v7.1） |
|------|-------------------|------------------|
| 主要形态 | 虚拟猫（不同品种：布偶/缅因/暹罗） | 万物灵智体（5 形态：bio/org/obj/virtual/hybrid） |
| 形象选择 | 全部是猫 | 根据灵智体性格特征选择不同动物或物品 |
| 预置灵智体 | 多只猫 | 3 只不同动物（猫头鹰/猎犬/孔雀） |
| 形态进化 | 无 | 形态可进化（bio → hybrid） |
| 谱系管理 | 单一谱系 | 多谱系（灵族 Forgekin Species） |
| 终态 | 数字 agent 集合 | 万物灵智体世界（具身智能 + 虚拟角色智能体 + 混合智能体） |

## v7.1-§D6 三方 Agent 集成设计规范

> **来源**：operator 第 10 条指令——"我们的灵智体除了可以调用 flowforge 核心框架的能力外，还可以接入和使用任何三方的 Agent 的"
> **对标章节**：spec.md v7.1-§6 / arch.md v7.1-§A6
> **详细规格**：详见 `features/F031-external-agent-adapter.md` ~ `features/F035-external-agent-capability-fusion.md` + `decisions/006-external-agent-integration.md`

灵智体不只调用 FlowForge 核心框架的能力，还可以**接入和使用任何三方 Agent**。三方 Agent 不是工具，是能力扩展（Capability Extension）。

### v7.1-§D6.1 首批接入的三方编程 Agent 设计

| 三方 Agent | 厂商 | 接入方式 | 主要能力 | Adapter 类 |
|---|---|---|---|---|
| **Claude Code** | Anthropic | CLI / SDK | 长程代码生成、agentic coding、文件系统操作 | `ClaudeCodeAdapter` |
| **Codex** | OpenAI | CLI / API | 代码补全、重构、测试生成 | `CodexAdapter` |
| **OpenCode** | 开源 | CLI | 多模型代码生成、本地代码库操作 | `OpenCodeAdapter` |
| **Trae** | ByteDance | IDE / API | 代码生成 + 调试 + 重构一体化 | `TraeAdapter` |

### v7.1-§D6.2 EAC v1 七契约设计（External Agent Contract）

EAC v1 七契约是三方 Agent 接入的统一协议契约（参考 clowder-ai F050 A2A External Agent Onboarding）：

| # | 契约名 | 中文 | 设计目的 | 实现类 |
|:--:|--------|------|---------|--------|
| 1 | Invocation | 调用契约 | 统一调用入口（CLI / API / A2A Protocol） | `ExternalAgentAdapter` |
| 2 | Stream | 流式契约 | 流式输出标准化（SSE / WebSocket / Chunk） | `StreamAdapter` |
| 3 | Session | 会话契约 | 会话隔离与共享（session_id 管理） | `SessionManager` |
| 4 | Capability | 能力契约 | 能力声明与发现（capabilities 注册） | `CapabilityRegistry` |
| 5 | Collaboration | 协作契约 | 协作模式（同步 / 异步 / 群体） | `CollaborationCoordinator` |
| 6 | Safety | 安全契约 | 六层 Guardrails 约束（输入/系统提示/工具白名单/输出/动作确认/成本上限） | `SafetyGuard` |
| 7 | Avatar Sync | 形象同步契约 | 灵智体形象同步到三方 Agent（persona 一致性） | `AvatarSyncAdapter` |
| 8 | System Prompt Configuration Map | 系统提示词配置映射契约 | 灵智体系统提示词映射到三方 Agent（提示词外置，铁律 5） | `PromptConfigMap` |

### v7.1-§D6.3 三方 Agent 能力融合设计

三方 Agent 的能力画像被纳入灵智体的能力画像融合（Capability Fusion）：

```
灵智体能力画像 = native_abilities（原生能力）
                + external_abilities（三方 Agent 融合能力）
                - blind_spots（盲点）
```

- 三方 Agent 的执行状态可写入灵智体的共享状态（Shared State）
- 三方 Agent 失败时由灵智体 fallback 链回退（Fallback Chain）
- 三方 Agent 的执行轨迹纳入灵智体的 Eval 信号（Eval Signal）
- 三方 Agent 调用受六层 Guardrails 约束

详见 `VISION.md#5` 三方 Agent 集成章节 + `features/F035-external-agent-capability-fusion.md`。

## v7.1-§D7 自我演进闭环设计规范

> **来源**：operator 第 7/11 条指令——"按 roleagent.md 中描述的自我演进代码开发和文档开发（要求支持自己开发自己），这个调整很大，请你仔细规划下，clowder-ai 可以自己开发自己我相信你也可以的。"
> **对标章节**：spec.md v7.1-§7 / arch.md v7.1-§A7
> **详细规格**：详见 `review/review.md#第十二章` 12.5-12.6 节 + `review/review.md#第十三章` clowder-ai 深度补审 CL-022~CL-041

FlowForge 必须支持"自己开发自己"——文档 / 代码 / 框架三层自我演进闭环：

### v7.1-§D7.1 三层自我演进闭环设计

| 闭环 | 中文名 | 对应 F100 模式 | 触发条件 | 代码模块路径（待实现） |
|:----:|--------|---------------|---------|----------------------|
| SelfDevDocLoop | 文档自我演进 | F100 Mode C Knowledge Evolution | 文档审核意见 / 灵议共识 | `flowforge/evolution/self_dev_doc.py` |
| SelfDevCodeLoop | 代码自我演进 | F100 Mode B Process Evolution | 同类错误反复出现 / Eval 信号 | `flowforge/evolution/self_dev_code.py` |
| SelfDevFrameworkLoop | 框架自我演进 | F100 Mode A Scope Guard | 框架瓶颈 / operator 显式触发 | `flowforge/evolution/self_dev_framework.py` |

### v7.1-§D7.2 F100 自我进化三模式设计

| 模式 | 中文名 | 防御/进攻 | 触发条件 | 代码模块路径（待实现） |
|:----:|--------|---------|---------|----------------------|
| Mode A | Scope Guard（范围守卫） | 防御 | 灵智体越权修改愿景/规范/架构 | `flowforge/evolution/scope_guard.py` |
| Mode B | Process Evolution（流程进化） | 防御→改进 | 同类错误反复出现 | `flowforge/evolution/self_dev_code.py` |
| Mode C | Knowledge Evolution（知识进化） | 进攻→成长 | 有价值知识沉淀 | `flowforge/evolution/self_dev_doc.py` |

### v7.1-§D7.3 安全门设计

- 觉醒阶 E4+ Evolving 状态可触发 Mode B/C
- ScopeGuard 阻止越权修改 VISION §7 / rules.md 红线 / 13 份核心 ADR
- Eval 账本 AB 回放 + min_net_gain ≥ 0.05 才允许合并（实现于 `flowforge/evolution/eval_ledger.py`）
- 跨 family review（必须非同 family reviewer）+ operator 显式 approval（如需要）

### v7.1-§D7.4 五级成熟度阶梯设计（取代 v7.0 单一质量分阈值 0.85）

| 阶 | 中文名 | 量化晋升门槛 |
|:--:|--------|-------------|
| L0 | Episode（情景） | 单次情景记录 |
| L1 | Pattern（模式） | ≥3 次同类情景 |
| L2 | Draft（草案） | 模式抽象为草案 |
| L3 | Validated（已验证） | ≥6 uses、≥2 agents、≥80%、无 critical breach |
| L4 | Standard（标准化） | ≥12 uses、last 10 ≥90%、operator approved |

**代码模块路径**（待实现，详见 task.md Phase 5）：
- `flowforge/evolution/eval_ledger.py` — EvalLedger Replay A/B 净增益验证
- `flowforge/evolution/self_dev_doc.py` — SelfDevDocLoop 文档自我演进
- `flowforge/evolution/self_dev_code.py` — SelfDevCodeLoop 代码自我演进
- `flowforge/evolution/self_dev_framework.py` — SelfDevFrameworkLoop 框架自我演进
- `flowforge/evolution/scope_guard.py` — ScopeGuard 4 信号判断 + 频率限制

## v7.1-§D8 设计态声明（可证伪性原则）

> **对标章节**：spec.md v7.1-§8 / arch.md v7.1-§A8
> **详细规格**：详见 `design/naming-contract.md#5` 废弃命名清单

v7.0/v7.1 万物灵智体愿景目前处于**设计态**，对应代码尚未全部实现。开源与对外文档时必须明确标注"设计态"，避免被识别为"承诺未兑现"。

**可证伪性原则**：
- ❌ 禁止使用"AGI"作为修饰词（极低可证伪性，虚假承诺风险）
- ✅ 使用"自进化 Self-Evolving"作为可证伪替代词
- ✅ 使用"灵智体 Forgekin"作为代码层主名，避免"灵魂"等引发伦理争议的词
- ✅ 使用"灵智 ForgeMind"作为文档/对外主名

**已实现 vs 设计态清单**：

| 状态 | 范围 | 说明 |
|------|------|------|
| ✅ 已实现 | forgemind 模块骨架（base/species/stages/forms/soul_imprint/forging pipeline/species_impl 5 形态/plugins/3 预置灵智体配置） | 对应 Phase 2 P2-1~P2-3 + P2-8 ✅ |
| 🔄 设计态 | roleagent 七大工程路径代码（capability/teamact/harness/memory/eval/reliability/partnership） | 对应 Phase 1，待实现 |
| 🔄 设计态 | 三方 Agent 适配层（ExternalAgentAdapter + 4 个 Adapter + EAC v1 七契约） | 对应 Phase 3，待实现 |
| 🔄 设计态 | 自我演进闭环（SelfDevDocLoop / SelfDevCodeLoop / SelfDevFrameworkLoop） | 对应 Phase 5，待实现 |
| 🎯 目标态 | 万物灵智体世界（通用智能体 / 具身智能 / 虚拟角色智能体工程实现） | operator 通用智能体愿景，不可降级 |

## v7.1-§D9 review.md 41 条 CL 同步矩阵（设计规范层收尾章）

> **来源**：`review/review.md` v1.4 第十三章（CL-001~CL-021）+ 第十四章（CL-022~CL-041）
> **完整矩阵**：详见 `spec.md` v7.1-§9.2（41 条 CL 完整同步矩阵——本章节不重复表格，仅从设计规范视角补充子章节占位索引）
> **同步状态**：✅ 已同步 16 项（39.0%）/ 🟡 部分同步 6 项（14.6%）/ ❌ 未同步 19 项（46.4%）
> **设计规范层责任**：22 个新增/补全子章节（§D3.3 + §D5.4-§D5.7 + §D6.1补全 + §D6.4-§D6.7 + §D7.5-§D7.11 + §D10-§D16），覆盖 P0/P1/P2 全部未同步项的工程规范
> **版本合并声明**：v7.1 增补章节是 v7.1 重构在设计规范层的权威更新，**已吸收合并 v7.0 增补章节及任何历史章节**（v7.0 不再作为独立版本存在）。三大主文档 v7.0 章节仅作背景资料保留，**不作为开发依据**；开发依据以 v7.1 增补章节（§D0~§D9）+ ADR/Feature 子目录为准。

### v7.1-§D9.1 设计规范层子章节占位索引（22 个新增/补全）

> **占位规则**：以下 22 个子章节为 v7.1-§9.6 修复路径在本设计规范文档的具体落地索引，**当前为占位声明**，详细规格将在 M1/M2/M3 里程碑中由对应责任方（宪宪架构师灵智体/砚砚代码审查灵智体/烁烁视觉设计灵智体/operator）逐步补全。每个子章节占位包含：CL 编号、责任方、规格大纲。

#### §D3 觉醒阶（补全子章节）

| 子章节 | CL | 责任方 | 规格大纲 |
|--------|----|--------|---------|
| §D3.3 四心智家族护栏规范 | CL-026 | 宪宪（猫头鹰） | Ragdoll（碎片推理癖）/ Maine Coon（fallback 糊锅匠）/ Siamese（热情直改）/ hotfix（糊弄尾巴）四家族 guardrail hooks + per-family telemetry + CI fallback 层数检测器 + search→Read 调用链检测 |

#### §D5 forgemind 应用层设计规范（补全子章节）

| 子章节 | CL | 责任方 | 规格大纲 |
|--------|----|--------|---------|
| §D5.4 Plugin Manifest 完整契约 | CL-022/024 | 宪宪（猫头鹰） | 对齐 F202 AC-A1~A4（Manifest Discovery）+ AC-B1~B5（Resource Ownership）+ AC-C1~C4（Security Boundary）+ AC-D1~D3（Hub UX）+ AC-E1~E4（Review Gate）+ AC-F3/F4（transactional 启停 + ValidateBeforeRehydrate）+ `PluginManifestValidator` + `ResourceOwnershipRegistry` + `PluginSecurityGuard` |
| §D5.5 ScheduleFactoryRegistry 规范 | CL-023 | 宪宪（猫头鹰） | plugin-owned factory 边界 + deterministic runtime task id + cross-plugin ownership collision 检测 + Schedule Factory Whitelist + AC-F1~F5 完整对齐 |
| §D5.6 Agent Swarm 协同模式规范 | CL-032 | 宪宪（猫头鹰） | Mind Council 从"议事"层升维到"协同执行"层 + Swarm 协议 + 任务分发与回收 + 灵智体间能力互补调度 |
| §D5.7 预置灵智体 OOTB 配置规范 | CL-035 | 宪宪（猫头鹰） | F135 DARE OOTB 关闭教训 + 预置灵智体配置应避免 OOTB 默认开启风险 + 宪宪/砚砚/烁烁 3 个预置灵智体的 OOTB 配置规范 |

#### §D6 三方 Agent 集成设计规范（补全子章节）

| 子章节 | CL | 责任方 | 规格大纲 |
|--------|----|--------|---------|
| §D6.1 三方编程 Agent 设计（补全 stderr + NDJSON） | CL-038 | 宪宪（猫头鹰） | CLI Adapter 增加 stderr 解析（"stderr 也算活着"教训）+ NDJSON 流式输出 + cli-integration.md NDJSON 解析器规范 |
| §D6.4 ProviderTransportRegistry 规范 | CL-014 | operator 决策安全模型 | 声明式 Manifest（能力/协议/传输方式/超时/重试策略）+ host 维护注册表 + `flowforge/core/external_agent/registry.py` + 灵智体通过查询注册表发现能力 |
| §D6.5 host-owned 注入契约 | CL-015 | operator 决策安全模型 | token/MCP/sandbox/cwd **全部由 host 代码注入** + plugin 只声明"我需要 token"但不自己获取 + 重构 ExternalToolBridge + 防止三方 Agent 越权 |
| §D6.6 reference_runtime.py 规范 | CL-017 | 宪宪（猫头鹰） | 三方 Agent 厂商可参照的参考实现 + 文档化的 Manifest 规范 + `flowforge/core/external_agent/reference_runtime.py` |
| §D6.7 MCP 治理规范 | CL-037 | 宪宪（猫头鹰） | MCP 1→3 server 拆分（按职能分离）+ prompt 瘦身 50% + MCP server 白名单 + 跨 plugin MCP 资源治理 |

#### §D7 自我演进闭环设计规范（补全子章节）

| 子章节 | CL | 责任方 | 规格大纲 |
|--------|----|--------|---------|
| §D7.5 Scope Guard 规范 | CL-002 | operator 决策边界 | 自我演进宪法层 + agent 提出修改前声明范围 + Scope Guard 拒绝越权范围 + VISION §7 不可被灵智体修改 + `flowforge/evolution/scope_guard.py` |
| §D7.6 Eval Ledger 字段契约 | CL-004 | 宪宪（猫头鹰） | 每次进化提案记录"提案内容/前测分数/后测分数/净增益/是否合入" + 净增益 > 0 才允许合入 + Replay A/B 流程 + 进化级 Eval 区分任务级 Eval |
| §D7.7 Knowledge Object Contract 字段表 | CL-005 | 宪宪（猫头鹰） | 锻典条目七字段（trigger/procedure/precondition/postcondition/anti_pattern/provenance/confidence）+ 灵智体判断"知识是否适用于当前场景"的契约 |
| §D7.8 元认知字段契约 + EchoStore 扩展 | CL-006 | 宪宪（猫头鹰） | agent 记录"为什么选这个工具/预期什么结果/实际什么结果/学到什么"四元组 + EchoStore 扩展支持元认知字段 + Mode C 知识进化原料 |
| §D7.9 Close Gate Validator 规范 | CL-025 | 砚砚（猎犬） | AC → evidence 矩阵（每条 AC 标注 ✅/❌ + commit/test/screenshot 证据）+ ❌ 强制三选一（immediate/delete/cvo_signoff）+ 禁止 follow-up/next phase/P2 字样 + `flowforge/evolution/close_gate.py` + CI follow-up-detector.mjs |
| §D7.10 Auto Dream 双层架构规范 | CL-031 | 宪宪（猫头鹰） | 后台 consolidation（睡眠态记忆巩固）+ 前台 surface（在线联想触发）+ 4 信号 telemetry + Auto Dream 与灵议 Mind Council 的协议接口 |
| §D7.11 QC Loop 7-Step 规范 | CL-034 | 砚砚（猎犬） | Maine Coon 3-Layer Reviewer Split（架构/逻辑/细节三层独立审查）+ 7 步 QC 循环 + 与 Eval 自代谢的协议接口 |

#### §D10-§D16 新增子章节

| 子章节 | CL | 责任方 | 规格大纲 |
|--------|----|--------|---------|
| §D10 虚拟世界一等公民建模 | CL-008 | 宪宪（猫头鹰） | 9 个一等公民：World/Character/Scene/Canon Decision/Relationship/Artifact/Round/Branch/Turn + VirtualForgekin 虚拟角色灵智体承载虚拟世界 + 一等公民字段契约 |
| §D11 Role Mask 五层规范 | CL-011 | 宪宪（猫头鹰） | L1 路由身份/L2 基础设施/L3 本体能力/L4 场景皮肤/L5 世界内状态 + Role Mask 独立加载/卸载 + L4 场景皮肤不污染 L3 本体能力 |
| §D12 Bridge Layer 协议规范 | CL-012/013/021 | 宪宪（猫头鹰） | Bridge Layer 三协议（Role Mask Protocol / Canon Sync Protocol / World Driver Protocol）+ runtime coordinator + 世界自转（World Driver + 定时事件源 + Canon 写入权限）+ 每个虚拟世界一个 Driver 实例 |
| §D13 TeamAct Queue Steer 规范 | CL-027 | 宪宪（猫头鹰） + 烁烁（孔雀）UI | SteerCommand（priority_boost/interrupt/requeue）+ RouteIntentStore 与 TaskProgressStore 解耦 + PlanBoardPanel 独立 section + 拖拽排序 + interrupted 任务"继续"按钮 |
| §D14 Event Memory 规范 | CL-029/030 | 砚砚（猎犬） | EventMemoryStore 独立子模块（不混入 EchoStore）+ 10 字段 schema（type/trigger/cat/threadId/messageId/timestamp/summary/cognitiveTransition/relatedHarness/confidence + ownerUserId）+ no-classifier 红线 + teleport(threadId, messageId) 精确跳转 + v1 schema 面向 v5 终态 + Phase C 趋势配 resolution 链 |
| §D15 Approval Hub 规范 | CL-033 | 烁烁（孔雀）UI | 跨 thread 审批入口 + operator 一键批准/拒绝 + Approval Hub 统一审批中心 + 与 SelfDevCodeLoop Close Gate 联动 |
| §D16 docs front-matter 规范 | CL-040 | 宪宪（猫头鹰） | 32 份 docs 文件 front-matter（feature_ids/related_features/topics/doc_kind/created）+ front-matter 校验脚本 + docs 索引自动化 |

### v7.1-§D9.2 ADR/Feature 补全索引（4 项）

> **占位规则**：以下 4 项需在对应 ADR/Feature 子目录中补全章节，不由本设计规范文档承载。

| 文档 | 补全章节 | CL | 责任方 | 规格大纲 |
|------|---------|----|--------|---------|
| `decisions/010-distributed-reliability.md` | §Restart Recovery Pipeline | CL-028 | 宪宪（猫头鹰） | Phase A sweep Redis stale records（按 TTL + status 字段过滤）+ Phase A+ emit `restart_notification` event + Phase B 队列状态持久化（AOF + RDB 双层）+ 强制所有 Redis key 显式 TTL（默认 24h，禁止 0） |
| `decisions/010-distributed-reliability.md` | §CI/CD Tracking 去重规范 | CL-039 | 宪宪（猫头鹰） | headSha + aggregateBucket PR 级 rollup + F133 GitHub CI/CD Tracking 状态迁移去重 + F021 Side-Effect WAL 补 PR 级 rollup |
| `decisions/007-harness-engineering.md` | §Hyperfocus Brake 规范 | CL-036 | 宪宪（猫头鹰） | 90 分钟活跃触发三猫撒娇 + typed check-in + F085 Hyperfocus Brake 与 F012 Entropy Control 的接口 |
| `design/naming-contract.md` | §7 内外品牌边界 | CL-041 | operator 决策品牌策略 | 内部 cat-cafe vs 外部 Clowder AI 双品牌边界 + 命名内外一致性规则 + 开源对外文档的边界声明 |

### v7.1-§D9.3 设计规范层里程碑与责任方

| 里程碑 | 子章节数量 | 责任方 | 涉及 CL |
|--------|-----------|--------|---------|
| M1（P0 必修）| 14 个子章节 | 宪宪 11 + 砚砚 1 + operator 2 | CL-002/008/011/012/013/014/017/021/022/023/027/028/029/034 + CL-004/015/031/032 部分同步补全 |
| M2（P1 应修）| 8 个子章节 | 宪宪 6 + 砚砚 2 + 烁烁 1 | CL-005/024/025/033/037/038/040 + CL-006/026/030 部分同步补全 |
| M3（P2 建议）| 4 个子章节（含 ADR/naming-contract） | 宪宪 3 + operator 1 | CL-035/036/039/041 |

> **注**：M1 完成后，22 个子章节中 14 个落地；M2 完成后 22 个全部落地。M3 在 ADR/naming-contract 中落地。

***

# v7.0 增补章节（万物灵智体重构）[⚠️ v7.0 历史背景资料，不作为开发依据；术语按 v7.1 增补章节替换]

> **⚠️ 历史背景资料声明**：本章节为 v7.0 历史背景资料，**不作为开发依据**；开发依据以 v7.1 增补章节（§D0~§D9）+ ADR/Feature 子目录为准。本章节仅用于理解决策演化路径，**任何术语冲突以 v7.1 增补章节 + `design/naming-contract.md` v1.1 为唯一准绳**。
> **审核依据**：`review/review.md` v1.2 终稿（78 项 P0 + 49 项 P1 + 25 项 P2 + 14 冲突点 + roleagent 47 项补审 + forgemind 12 项补审 + 三方 Agent 10 项补审）；v1.4 终稿增补第十三章/第十四章 41 条 CL 已落到 v7.1-§D9 同步矩阵。
> **审核状态**：✅ operator 已审核通过命名方案 + 体系设计；E6 由"灵匠 Mind Artisan"修订为"灵智 ForgeMind（最终形态）"；其余待决策项按推荐执行。
> **铁律 6 提示**：本增补章节为追加内容，不删除任何 v6.0 历史章节；后续 v6.0 历史内容仅做术语全局替换，章节结构保留不变。

## §0.1 设计态声明

> **来源**：`review/review.md` D-077 / S-07 + 决策 7（标注"设计态"）+ `decisions/013-all-things-spirit-mind-vision.md`

v7.0 万物灵智体愿景目前处于**设计态**，对应代码尚未全部实现。开源与对外文档时必须明确标注"设计态"，避免被识别为"承诺未兑现"。

### §0.1.1 可证伪性原则

- ❌ 禁止使用"AGI"作为修饰词（极低可证伪性，虚假承诺风险）
- ✅ 使用"自进化 Self-Evolving"作为可证伪替代词
- ✅ 使用"灵智体 Forgekin"作为代码层主名，避免"灵魂"等引发伦理争议的词
- ✅ 使用"灵智 ForgeMind"作为文档/对外主名

### §0.1.2 已实现 vs 设计态清单

| 状态 | 范围 | 说明 |
|------|------|------|
| ✅ 已实现 | v6.0 六层架构 + 九大模式 + Harness 驾驭层 + Skill 系统 + MCP 模块 + Helm 实时交互 | 对应 v6.0 正式版代码 |
| 🔄 设计态 | v7.0 万物灵智体 + forgemind 应用层 + roleagent 七大工程路径 + 三方 Agent 集成 + 自我演进闭环 | 对应 §0.2-§0.8 设计，待 Phase 0-1 实现 |
| 🎯 目标态 | 万物灵智体世界（具身智能 + 虚拟角色智能体 + 混合智能体工程实现） | operator 通用智能体（General-Purpose Agent）愿景，不可降级 |

### §0.1.3 设计态收敛路径

v7.0 设计态按 MVP 最小可行范围收敛（详见 `spec.md` v7.0-§8）：
1. CapabilityProfile 六维画像（FR-EVO-01）
2. TeamAct 六步循环 + 五项终止（FR-EVO-03）
3. forgemind 应用层骨架 + 5 种形态分类（FR-EVO-23）
4. ExternalAgentAdapter 抽象层（FR-EVO-27）
5. Plugin V3 四钩子（灵智体注册协议）

## §0.2 万物灵智体形态分类设计

> **来源**：`review/review.md` 第九章 9.1 节 FM-003 + operator 指令第 6 条 + `VISION.md` + `decisions/013-all-things-spirit-mind-vision.md`

### §0.2.1 5 种形态分类表

万物灵智体（Forgekin）按载体形态分为 5 种，形态可进化（E1 灵启 → E6 灵智完整生命周期）。

| # | 形态 | 英文 | 示例 | 能力维度示例 |
|---|------|------|------|------------|
| 1 | 生物形态 | BioForgekin | 动物/植物（猫、狗、植物灵智体） | 听觉敏感 / 视觉敏感 / 反应速度 / 亲和力 |
| 2 | 组织形态 | OrgForgekin | 公司/团队/社区 | 决策能力 / 协作能力 / 创新能力 / 抗风险能力 |
| 3 | 物品形态 | ObjForgekin | 桌椅/灯具/车辆 | 承重感知 / 使用频率 / 磨损状态 |
| 4 | 虚拟形态 | VirtualForgekin | 童话/神话/历史/游戏角色（孙悟空、福尔摩斯） | 世界观遵循 / 角色关系 / 行为规则 |
| 5 | 混合形态 | HybridForgekin | VR/AR 实体、具身智能（Embodied AI）设备 | 物理传感器 + 虚拟设定融合 |

### §0.2.2 通用智能体三条工程路径 [v7.1 修订：原 v7.0 "通用 AGI 三条路径"用语已废弃]

1. **具身智能工程实现（Embodied AI Engineering）**：通过物理传感器 + 灵智体，让物理世界万事万物接入智能体（猫灵智体可感知环境、桌椅灵智体可感知使用频率）
2. **虚拟角色智能体工程实现（Character AI Engineering）**：通过虚拟世界设定层 + 灵智体，让虚拟角色按设定层约束自主行动（孙悟空灵智体遵循西游世界观）
3. **混合智能体工程实现（Hybrid Agent Engineering）**：VR/AR 设备 + 灵智体，达成物理与虚拟的融合感知

### §0.2.3 灵智体优势对比表（vs 传统 multi-agent 系统）

| 维度 | 传统 multi-agent 系统 | 万物灵智体（Forgekin） |
|------|---------------------|----------------------|
| 组织单位 | 组织"岗位"（Role） | 锻造"灵智体"（Profile） |
| 能力沉淀 | 用完即走，无法成长 | 通过灵典蒸馏沉淀到能力画像（EX-010） |
| 自主性 | 固定 persona 绑定 | 动态职责切换，可进化阶 E-L0~L4 |
| 协作模式 | 消息传递，易循环 | TeamAct Shared State + 持球注册 lease |
| 记忆 | 单次会话或简单 RAG | 多域记忆联邦六层 + 灵典可检索 |
| 自我演进 | 无 | 文档/代码/框架三层自我演进闭环 |
| 终态 | 数字 agent 集合 | 万物灵智体世界（物理 + 虚拟 + 混合） |

### §0.2.4 万物灵智体形态分类视觉设计原则

- 每种形态对应一个 ForgekinBase 子类，实现 observe/act/verify 三方法契约
- 形态配置外置到 `forgemind/config/species.yaml`（铁律 5 禁止硬编码）
- 形态进化遵循 ForgePipeline 6 步锻造流水线（详见 §0.5.4）
- 形态可融合（如 HybridForgekin = 物理 sensors + 虚拟 worlds 设定层）

## §0.3 育灵体系命名契约

> **来源**：`decisions/012-naming-fusion.md` + `review/review.md` 第六章 + operator 指令第 4 条
> **决策状态**：operator 已审核通过；E6 由"灵匠 Mind Artisan"修订为"灵智 ForgeMind（最终形态）"
> **不可变性**：命名变更需 operator 直接决策，不能由灵智体自我演进修改

### §0.3.1 双轨命名策略表

| 层级 | 使用场景 | 命名风格 | 示例 |
|------|---------|---------|------|
| 产品层 | UI、营销、对外文档 | ForgeMind（灵智） | "创建一个新灵智" |
| 代码层 | 类名、变量名、配置项、API 路径 | Forgekin | `ForgekinEngine`、`forgekin_id`、`/api/v7/forgekins` |
| 文档层 | 设计文档、技术规范 | 双标注 | "灵智（Forgekin 实例）" |
| 社区层 | 开源宣传、技术博客 | ForgeMind | "FlowForge ForgeMind: Self-Evolving Agent" |

### §0.3.2 12 个核心概念命名表

| # | 概念 | 新中文 | 新英文 | 旧名（已废弃） |
|---|------|--------|--------|---------------|
| 1 | 个体 | 灵智 | ForgeMind（产品）/ Forgekin（代码） | 炉灵 |
| 2 | 群体 | 灵群 | ForgeKinship | 灵族 |
| 3 | 养成 | 育灵 | Forge Nurturing | 养灵 |
| 4 | 入门训练 | 灵启 | Mind Initiation | 炉启 |
| 5 | 协作模式 | 共鸣 | Resonance | 共鸣（保留） |
| 6 | 自主思考 | 灵锻 | SpiritForge | 自锻 |
| 7 | 记忆 | 灵忆 | Mind Echo | 魂忆 |
| 8 | 画像 | 灵印 | Mind Imprint | 魂印 |
| 9 | 技能库 | 灵典 | Mind Codex | 锻典 |
| 10 | 知识阶梯 | 进化阶 | Evolution Hierarchy | 火种等级 |
| 11 | 成长阶段 | 觉醒阶 | Awakening Stages | 升华阶 |
| 12 | IM 议事 | 灵议 | Mind Council | 灵议（保留） |

### §0.3.3 进化阶 E-L0~L4 命名表（取代火种等级）

| 等级 | 新名 | 旧名（已废弃） | 含义 |
|------|------|---------------|------|
| E-L0 | Seed 萌芽 | Spark 火种 | 初始知识，刚通过灵启训练 |
| E-L1 | Sprout 萌发 | Ember 余烬 | 基础经验积累，开始自主思考 |
| E-L2 | Bloom 绽放 | Flame 火焰 | 中级知识，可蒸馏技能 |
| E-L3 | Thrive 繁茂 | Blaze 烈焰 | 高级知识，可指导其他灵智 |
| E-L4 | Evolve 进化 | Forge Fire 锻火 | 顶级知识，可自主创新技能 |

**前缀规则**：进化阶用 E-L（Level），觉醒阶用 E，通过 L 区分，解决 D-051 冲突。

### §0.3.4 觉醒阶 E1-E6 命名表（取代升华阶）

| 阶段 | 新名 | 旧名（已废弃） | 形态 | 控制权 |
|------|------|---------------|------|--------|
| E1 | Initiation 灵启 | Spark 火种 | Forgekin | operator 全控 |
| E2 | Awakening 觉醒 | Flame 火焰 | Forgekin | operator 主导 |
| E3 | Mastery 精通 | Forge 锻 | Forgekin | operator 监督 |
| **E4** | **Evoling 进化** | **Master 师傅** | **Evoling** | **operator 让渡部分控制权** |
| E5 | Excellence 卓越 | Sage 圣人 | Evoling | operator 仅设边界 |
| **E6** | **ForgeMind 灵智（最终形态）** | ~~Mind Artisan 灵匠~~ | Evoling | operator 信任 |

**Evoling 状态转换点**：E3→E4 是关键转换点，需 operator 显式批准（对应决策 8 混合模式切换点）。E4+ 灵智体进入涌现式自进化状态。

**E6 修订记录**：operator 已指令 E6 由"灵匠 Mind Artisan"修订为"灵智 ForgeMind（最终形态）"，与产品层主名同名同体。

### §0.3.5 术语全局替换映射表（27 项）

> 完整映射表见 `decisions/012-naming-fusion.md` §6.9。本文档 v6.0 历史章节中所有旧术语应理解为已替换为新术语。左列为旧术语（保留作映射参考，不替换），右列为新术语。

| 序号 | 原术语（旧） | 新术语 | 适用范围 |
|------|------------|--------|---------|
| 1 | AutoForgeEngine | SpiritForgeEngine | 代码类名 |
| 2 | auto_forge.yaml | spirit_forge.yaml | 配置文件名 |
| 3 | Auto-Forge | SpiritForge | 含连字符 |
| 4 | AutoForge | SpiritForge | 不含连字符 |
| 5 | AscensionStage | AwakeningStage | 代码类名 |
| 6 | Ascension Stages | Awakening Stages | 英文术语 |
| 7 | 升华阶 | 觉醒阶 | 中文术语 |
| 8 | EmberHierarchy | EvolutionHierarchy | 代码类名 |
| 9 | Ember Hierarchy | Evolution Hierarchy | 英文术语 |
| 10 | 火种等级 | 进化阶 | 中文术语 |
| 11 | ForgekinCouncil | MindCouncil | 代码类名 |
| 12 | Forgekin Council | Mind Council | 英文术语 |
| 13 | SoulProfile | MindProfile | 代码类名 |
| 14 | SoulStore | MindStore | 代码类名 |
| 15 | Soul Echo | Mind Echo | 英文术语 |
| 16 | Soul Imprint | Mind Imprint | 英文术语 |
| 17 | Forge Codex | Mind Codex | 英文术语 |
| 18 | 锻典 | 灵典 | 中文术语 |
| 19 | 魂忆 | 灵忆 | 中文术语 |
| 20 | 魂印 | 灵印 | 中文术语 |
| 21 | 养灵 | 育灵 | 中文术语 |
| 22 | 炉灵 | 灵智 | 中文术语 |
| 23 | 自锻 | 灵锻 | 中文术语 |
| 24 | HelixRAG | OpenSieve | 系统名 |
| 25 | M18 SelfEvolutionEngine | ForgeMindEngine | 模块合并 |
| 26 | M19 MemoryGovernanceManager | ForgeMindEngine | 模块合并 |
| 27 | M20 FirstTouchRouter | ForgeMindEngine | 模块合并 |

**不替换的保留项**：`Spark` / `Ember` / `Flame` / `Blaze` 单独出现时保留（仅作为 v7.0 命名表左列旧名出现）；`forgekin`（小写）与 `Forgekin`（大写）保留（双轨策略代码层主名）；`forge` 单独出现不替换（避免误伤）。

## §0.4 roleagent.md 七大工程路径设计映射

> **来源**：`roleagent.md` + `review/review.md` 第八章 47 项补审（RA-001~RA-047）
> **铁律**：七大工程路径是 Build to Persist 复利型基础设施，不可简化

v6.0 设计停留在"岗位 agent + 插件协议 + 质量分 Loop"层面，**完全未吸收 roleagent.md 七大工程路径**，是 v6.0 最大的设计盲区。v7.0 必须补全。

### §0.4.1 七大路径映射表

| 路径 # | 名称 | 设计文档位置 | 代码位置 | Build to Delete or Persist |
|--------|------|------------|---------|---------------------------|
| 路径 1 | 能力画像 × Harness 契合度 | `spec.md` v7.0-§3.1（RA-001~RA-008） | `flowforge/core/capability/` | Persist（基础设施） |
| 路径 2 | 从 ReAct 到 TeamAct | `spec.md` v7.0-§3.2（RA-009~RA-016） | `flowforge/core/teamact/` | Persist（基础设施） |
| 路径 3 | Harness 现实闭环运行时 | `spec.md` v7.0-§3.3（RA-017~RA-023） | `flowforge/core/harness/` | Persist（基础设施） |
| 路径 4 | 多域记忆联邦 | `spec.md` v7.0-§3.4（RA-024~RA-030） | `flowforge/core/memory/federation/` | Persist（基础设施） |
| 路径 5 | Eval 自代谢系统 | `spec.md` v7.0-§3.5（RA-031~RA-036） | `flowforge/core/eval/` | Persist（基础设施） |
| 路径 6 | 分布式可靠性 | `spec.md` v7.0-§3.6（RA-037~RA-042） | `flowforge/core/reliability/` | Persist（基础设施） |
| 路径 7 | 伙伴系统数学 | `spec.md` v7.0-§3.7（RA-043~RA-047） | `flowforge/core/partnership/` | Persist（基础设施） |

### §0.4.2 各路径核心设计原则

**路径 1：能力画像 × Harness 契合度**
- 核心公式：`Agent 质量 = 模型能力 × Harness 契合度`
- CapabilityProfile 六维度：模型固有能力 / 认知风格 / 工具边界 / 历史表现 / 坏直觉（盲点）/ 当前状态
- Agent 状态三层：权重状态（模型厂商控制）/ 计算状态（模型架构控制）/ 现实状态（Harness 控制，唯一跨会话持久层）
- 落地：ADR-004 + Feature F001

**路径 2：从 ReAct 到 TeamAct**
- 核心论点：多 agent 互相传递状态可永远循环；TeamAct 是 Shared State 模式工程化闭环
- 六步循环：State → Owner → Action → Evidence → Verdict → Route
- 五项终止条件（缺一不可）：① 验收标准全部达成 ② 证据已附 ③ 跨 agent 交叉验证 ④ 无悬空任务归属 ⑤ 愿景收敛（CVO 确认不能被 proxy 替代）
- 交接胶囊（resume capsule）：What / Why / Tradeoff / Open / Next 五段
- 乒乓球熔断器：看实质工具调用而非传球次数；给数据不给结论
- 落地：ADR-002 + Features F002-F007

**路径 3：Harness 现实闭环运行时**
- 核心论点：Harness 把世界做成模型可感知/可行动/可验证/可恢复/可学习的样子
- 七层现实表面：Durable State Surfaces / Tool Mediation / Evidence & Sensors / Governance Boundary / Magic Words 逃生舱 / Entropy Control / Harnessability 评估
- 低保真矩阵：治理规则 × Agent 类型
- 落地：ADR-007 + Features F008-F013

**路径 4：多域记忆联邦**
- 核心论点："很多 RAG 输给 grep"，最终形态是六层多域记忆运行时
- 六层架构：真相源 Collection 层 / 扫描编译层 / 联邦检索层 / 治理层 / Agent 佩戴协议层 / 反馈闭环层
- 三检索入口：graph_resolve（精确导航）/ list_recent（零先验扫描）/ search_evidence（语义搜索）
- 治理三要素：权威性 authority / 触发方式 activation / 生命周期 status
- 落地：ADR-008 + Features F014-F017、F039

**路径 5：Eval 自代谢系统**
- 核心论点："有 harness，就必须有 eval。否则 harness 只会增生，不会代谢"
- 三层 eval：观测底座 / Harness A2A Eval / Memory Eval
- Eval Contract 五问：服务谁 / 何时触发 / 摩擦指标 / 回归用例 / 退役信号
- 七类归因矩阵：愿景缺口 / 翻译偏差 / harness 错位 / 工具缺口 / 执行缺口 / 环境漂移 / 品味落差
- 落地：ADR-009 + Features F018-F020、F040

**路径 6：分布式可靠性**
- 核心论点："多 agent 是分布式系统"，三类可靠性挑战
- 副作用日志（Write-Ahead Log）+ 结构化恢复卡
- Tier 1-4 恢复分级：Tier 1 自动恢复 / Tier 2 探测后恢复 / Tier 3 不自动恢复出恢复卡 / Tier 4 永不自动恢复硬拒
- liveness 规范读模型四态：活着 / 退化 / 僵尸 / 等待宽限
- 落地：ADR-010 + Features F021-F025

**路径 7：伙伴系统数学**
- 核心论点：团队质量 = 上限搜索 × 下限保护 × 状态保真 × 失败恢复
- 上限公式：`上限收益 ≈ max(不同 agent 提出的候选路径)`（前提是路径足够不同）
- 下限公式：`用户可见错误 ≈ author 犯错 × reviewer 没抓住 × 测试没暴露 × shared state 没证据 × eval 没归因 × CVO 没拉闸`（连乘概率模型）
- 波动吸收机制：记忆联邦找回 / review 退回 / 可靠性恢复点 / eval sunset review / 调度换路径
- 落地：ADR-011

### §0.4.3 Build to Delete vs Built to Persist 判别器

| 判别维度 | Build to Delete（脚手架） | Built to Persist（基础设施） |
|---------|-------------------------|---------------------------|
| 用途 | 补模型当前认知缺陷 | 编码外部现实 / 协作协议 |
| 工程态度 | 轻量做、标 sunset | 认真做、加测试 |
| 生命周期 | 模型升级后退役 | 长期复利 |
| 示例 | 临时 prompt 增强、绕过性补丁 | CapabilityProfile、TeamAct 状态机、记忆联邦 |

## §0.5 forgemind 应用层设计

> **来源**：`review/review.md` 第九章 9.1 节（FM-001~FM-012）+ `decisions/005-forgemind-application-layer.md` + operator 指令第 5/6 条
> **决策状态**：operator 已采纳 ADR-005

### §0.5.1 forgemind 模块定位

forgemind 是 FlowForge 的**应用层项目**，用来实践万物锻造灵智体。它承载 flowforge 的育灵所有代码，养很多公共的灵智体，最终可以进化为物理世界中各种万事万物。其他 *Forge 是更多垂直复杂的领域中养的灵智体，flowforge 的通用灵智体在 forgemind 中承载。

**三层关系**：
- **FlowForge 核心框架层**：自进化框架核心（提供自进化的基础核心和框架能力）
- **forgemind 应用层**：万物灵智体应用实践（养公共的通用灵智体：猫 / 桌椅 / 灯具 / 孙悟空等）
- **\*Forge 垂直业务层**：垂直领域灵智体（各 *Forge 在自己垂直领域养专门灵智体）

**关键不变量**：
- forgemind **单向依赖**核心框架层，禁止反向调用（编程红线第 10 条）
- forgemind **不含业务领域代码**（编程红线第 10 条）
- forgemind 通过 Plugin V3 协议注册，**不直接实例化**核心模块（编程红线第 12 条）
- forgemind 灵智体必须建立**现实闭环**（operator 愿景锚点第 2 条）

### §0.5.2 forgemind 目录结构

```
flowforge/forgemind/
├── __init__.py
├── species.py              # ForgekinSpecies 枚举（5 种形态）
├── stages.py               # EvolutionStage 进化阶 + AwakeningStage 觉醒阶
├── base.py                 # ForgekinBase 抽象类（observe/act/verify 三方法）
├── forms.py                # ForgekinFormData
├── plugins.py              # ForgeMindPlugin（实现 Plugin V3 四钩子）
├── forge_registry.py       # *Forge 灵智体注册接口
├── species/                # 5 种形态实现
│   ├── bio.py              # BioForgekin 生物灵智体
│   ├── org.py              # OrgForgekin 组织灵智体
│   ├── obj.py              # ObjForgekin 物品灵智体
│   ├── virtual.py          # VirtualForgekin 虚拟灵智体
│   └── hybrid.py           # HybridForgekin 混合灵智体
├── forging/                # 灵智体锻造流水线
│   ├── pipeline.py         # ForgePipeline
│   └── stages.py           # 6 步锻造阶段定义
├── sensors/                # 物理传感器接入（具身智能路径，Embodied AI）（F029）
│   ├── base.py
│   ├── camera.py           # 摄像头
│   ├── microphone.py       # 麦克风
│   └── iot.py              # IoT 传感器
├── worlds/                 # 虚拟世界设定层（F030）
│   ├── base.py
│   ├── vr.py               # VR/游戏世界适配
│   └── narrative.py        # 童话/神话/历史角色适配
├── marketplace/            # 灵智体市场（F037）
│   ├── base.py
│   └── registry.py
├── lineage/                # 进化谱系（F038）
│   ├── tree.py
│   └── visualizer.py
├── codex/                  # 灵典 Mind Codex（可检索知识库）
│   ├── spirit_forge.py     # 灵锻 SpiritForge 引擎
│   ├── distiller.py        # 经验蒸馏
│   └── mind_codex_writer.py
├── council/                # 灵议 Mind Council
│   ├── engine.py
│   ├── protocol.py
│   ├── resolution.py
│   └── cvo_brake.py        # operator 拉闸词检测
├── config/                 # 配置外置（铁律 5+P16）
│   ├── forging.yaml
│   ├── prompts.yaml
│   └── metrics.yaml
└── tests/
    ├── test_base.py
    ├── test_cat_forgekin.py    # E2E：猫灵智体锻造
    ├── test_sensors.py
    ├── test_worlds.py
    └── test_lineage.py
```

### §0.5.3 ForgekinBase 三方法契约

> **来源**：`features/F026-forgemind-app-layer.md` + FM-005

```python
class ForgekinBase(ABC):
    """灵智体抽象基类 — 所有万物灵智体的本体契约。"""

    species: ForgekinSpecies          # 形态分类
    evolution_stage: EvolutionStage   # 进化阶 E-L0~L4
    awakening_stage: AwakeningStage   # 觉醒阶 E1-E6
    profile: CapabilityProfile        # 能力画像（F001）

    async def observe(self, state: DurableState) -> Observation:
        """观察现实状态 — 对应 roleagent §3 Durable State Surfaces。"""
        ...

    async def act(self, observation: Observation) -> Action:
        """基于观察执行行动 — 对应 roleagent §3 Tool Mediation。"""
        ...

    async def verify(self, action: Action, evidence: Evidence) -> Verdict:
        """验证行动结果 — 对应 roleagent §3 Evidence & Sensors。"""
        ...
```

**契约不变量**：
- 三方法必须保持现实闭环（observe → act → verify → observe），不可跳过 verify
- observe 对应路径 3 Durable State Surfaces
- act 对应路径 3 Tool Mediation
- verify 对应路径 3 Evidence & Sensors
- profile 字段对应路径 1 CapabilityProfile

### §0.5.4 ForgePipeline 6 步锻造流水线

> **来源**：FM-006 + `features/F028-forging-pipeline.md`

| 步骤 | 阶段 | 说明 | 对应能力 |
|------|------|------|---------|
| 1 | 形态定义（What to forge） | 确定灵智体形态（生物/组织/物品/虚拟/混合） | ForgekinSpecies |
| 2 | 能力注入（Capability injection） | 注入该形态所需能力画像 | CapabilityProfile 六维度 |
| 3 | 记忆初始化（Memory seeding） | 初始化多域记忆联邦 | 路径 4 六层架构 |
| 4 | 价值观对齐（Value alignment） | 核心价值观不可变 + 表象可变（决策 11） | Governance Boundary |
| 5 | 能力验证（Capability verification） | 能力基线测试 | Evidence & Sensors |
| 6 | 觉醒晋升（Awakening promotion） | E1 灵启 → E6 灵智完整生命周期 | AwakeningStage |

### §0.5.5 万物灵智体形态分类视觉设计原则

- 每种形态对应一个 ForgekinBase 子类，实现 observe/act/verify 三方法契约
- 形态配置外置到 `forgemind/config/species.yaml`（铁律 5 禁止硬编码）
- 形态进化遵循 ForgePipeline 6 步锻造流水线
- 形态可融合（如 HybridForgekin = 物理 sensors + 虚拟 worlds 设定层）

### §0.5.6 forgemind 与 *Forge 的关系

| 维度 | forgemind（应用层） | *Forge（垂直业务层） |
|------|-------------------|-------------------|
| 定位 | 通用灵智体应用实践 | 垂直领域灵智体 |
| 示例 | 猫 / 桌椅 / 灯具 / 孙悟空 | ContentForge 内容创作灵智体 |
| 注册协议 | ForgeMindPlugin（Plugin V3） | 各 *Forge Plugin（Plugin V3） |
| 依赖方向 | 单向依赖 FlowForge 核心 | 单向依赖 FlowForge 核心 + forgemind |
| 业务领域 | 通用，无业务领域代码 | 垂直业务领域代码 |

## §0.6 三方 Agent 集成设计

> **来源**：`review/review.md` 第九章 9.2 节（EX-001~EX-010）+ `decisions/006-external-agent-integration.md` + operator 指令第 7 条
> **决策状态**：operator 已采纳 ADR-006

### §0.6.1 设计原则：能力扩展而非工具调用

灵智体除可调用 FlowForge 核心框架能力外，还可接入和使用任何三方 Agent。这是 FlowForge 的强大优势——目前设计接入的编程 Agent：claude code、codex、opencode、trae，将来可扩展接入更多编程 Agent 和其他 Agent。

**关键转变（EX-001）**：三方 Agent 从"工具调用"（v6.0 ExternalToolBridge）升级为"能力扩展"。灵智体调用三方 Agent 后，三方 Agent 能力应"沉淀"到灵智体能力画像中（通过灵典蒸馏，EX-010）。

### §0.6.2 ExternalAgentAdapter 抽象层目录结构

```
flowforge/core/external_agent/
├── adapter.py             # ExternalAgentAdapter 抽象类
├── bridge.py              # ExternalAgentBridge 桥接层（含 fallback 循环）
├── shared_state.py        # ExternalAgentSharedState 状态共享
├── fallback.py            # ExternalAgentFallback 失败回退
├── capability_fusion.py   # ExternalAgentCapabilityFusion 能力融合
├── worktree.py            # worktree 隔离
├── sync.py                # 跨 worktree 共享状态同步
├── adapters/
│   ├── claude_code.py     # Claude Code Adapter
│   ├── codex.py           # Codex Adapter
│   ├── opencode.py        # OpenCode Adapter
│   └── trae.py            # Trae Adapter
├── guardrails/            # 六层 Guardrails
│   ├── input_validation.py
│   ├── system_prompt.py
│   ├── tool_allowlist.py
│   ├── output_validation.py
│   ├── action_confirm.py
│   └── cost_ceiling.py
└── config/
    ├── adapters.yaml
    ├── prompts.yaml
    ├── fallback.yaml
    └── tool_allowlist.yaml
```

### §0.6.3 4 大机制设计

| 机制 | 编号 | 说明 |
|------|------|------|
| **Profile（能力画像）** | EX-002 | 每个三方 Agent 有 CapabilityProfile：claude code 擅长复杂重构/盲点长上下文易漂移；codex 擅长推理/盲点工具调用弱；opencode 擅长开源协作/盲点企业场景弱；trae 擅长 IDE 集成/盲点命令行长任务弱 |
| **SharedState（状态共享）** | EX-004 | 灵智体→claude code 写代码→codex review→trae 部署的连续协作流；v6.0 三方 Agent 间无共享状态，每次调用都是独立会话 |
| **Fallback（失败回退）** | EX-007 | 跨厂商 fallback 链（与 LLMClient 跨厂商 fallback 思路一致）：claude code 失败→换 codex→降级到内置 agent |
| **CapabilityFusion（能力融合）** | EX-010 | 灵智体调用三方 Agent 后，能力"沉淀"到灵智体能力画像（通过灵典蒸馏）。v6.0 是"用完即走"，灵智体无法从调用中成长 |

### §0.6.4 4 个首批 Adapter 设计

| Adapter | 擅长 | 盲点 | Profile 关键维度 |
|---------|------|------|----------------|
| Claude Code Adapter | 复杂重构 | 长上下文易漂移 | 认知风格：深度推理 |
| Codex Adapter | 推理 | 工具调用弱 | 模型固有能力：推理强 |
| OpenCode Adapter | 开源协作 | 企业场景弱 | 工具边界：开源生态 |
| Trae Adapter | IDE 集成 | 命令行长任务弱 | 工具边界：IDE 上下文 |

### §0.6.5 六层 Guardrails 设计

| 治理层 | 机制 | 对应 roleagent.md 章节 |
|--------|------|----------------------|
| 输入验证 | Feature 规格必须通过 Schema 校验 | §3 Governance Boundary |
| 系统提示约束 | 灵智体 system role 注入"禁止绕过 Eval" | §3 压缩免疫层 |
| 工具白名单 | 灵智体只能调用 allow-list 内工具 | §3 Tool Mediation |
| 输出验证 | 生成的代码必须通过 lint + 测试 | §3 Evidence & Sensors |
| 操作确认 | 不可逆操作（merge/release）需 operator 确认 | §3 Runtime 逃生舱 |
| 成本上限 | 每个灵智体有 token/三方 Agent 配额 | §3 Governance Boundary |

### §0.6.6 worktree 隔离设计（EX-005）

- **网络白名单**：仅允许访问必要域名
- **文件权限**：仅允许访问 worktree
- **操作审计**：所有 tool call 记录
- **操作回滚**：错误操作可恢复

## §0.7 M1-M17 模块映射到 v7.0

> **来源**：`review/review.md` D-045 / D-056（M1-M17 模块归属修复）

### §0.7.1 M1-M17 模块映射表

| v6.0 模块 | v7.0 对应组件 | 归属层 | 状态 |
|----------|-------------|--------|------|
| M1 BaseAgent | ForgekinBase + BaseAgent | Layer 1 核心框架 | ✅ 保留 |
| M2 HybridExecutor | ForgekinEngine（装饰 HybridExecutor） | Layer 1 核心框架 | 🔄 升级 |
| M3 Harness | Harness v2.0（路径 3 七层现实表面） | Layer 1 核心框架 | 🔄 升级 |
| M4 Skill System | Skill + SkillPackage | Layer 1 核心框架 | ✅ 保留 |
| M5 Memory | 多域记忆联邦六层（路径 4） | Layer 1 核心框架 | 🔄 升级 |
| M6 Eval | Eval 自代谢三层（路径 5） | Layer 1 核心框架 | 🔄 升级 |
| M7 Reliability | 分布式可靠性 Tier 1-4（路径 6） | Layer 1 核心框架 | 🔄 升级 |
| M8 Plugin Protocol | Plugin V3 四钩子 | Layer 1 核心框架 | 🔄 升级 |
| M9 CapabilityProfile | CapabilityProfile 六维画像（路径 1） | Layer 1 核心框架 | 🔄 新增 |
| M10 TeamAct | TeamAct 六步循环（路径 2） | Layer 1 核心框架 | 🔄 新增 |
| M11 Partnership | 伙伴系统数学（路径 7） | Layer 1 核心框架 | 🔄 新增 |
| M12 ExternalAgent | ExternalAgentAdapter 抽象层 | Layer 1 核心框架 | 🔄 新增 |
| M13 ForgeMind | forgemind 应用层 | Layer 2 应用层 | 🆕 新增 |
| M14 Forgekin | ForgekinBase + 5 种形态 | Layer 2 应用层 | 🆕 新增 |
| M15 ForgePipeline | ForgePipeline 6 步锻造 | Layer 2 应用层 | 🆕 新增 |
| M16 MindCodex | 灵典 Mind Codex 可检索 | Layer 2 应用层 | 🆕 新增 |
| M17 MindCouncil | 灵议 Mind Council | Layer 2 应用层 | 🆕 新增 |

### §0.7.2 重点说明：M18/M19/M20 已废弃

| 废弃模块 | 合并到 | 废弃原因 |
|---------|--------|---------|
| M18 SelfEvolutionEngine | ForgeMindEngine | v4.0 自创术语，与 v7.0 FR-EVO 冲突（D-045） |
| M19 MemoryGovernanceManager | ForgeMindEngine | v4.0 自创术语，功能合并到记忆联邦 + ForgeMindEngine（D-056） |
| M20 FirstTouchRouter | ForgeMindEngine | v4.0 自创术语，功能合并到 CapabilityProfile 路由（D-056） |

### §0.7.3 v6.0 evolution/ 目录迁移

v6.0 `flowforge/evolution/` 目录下 8 个扁平文件迁移到 v7.0 双目录：

| v6.0 evolution/ 文件 | v7.0 目标位置 | 说明 |
|---------------------|-------------|------|
| self_evolution_engine.py | `flowforge/core/evolution/forge_mind_engine.py` | 重命名为 ForgeMindEngine |
| memory_governance.py | `flowforge/core/memory/federation/governance.py` | 合并到记忆联邦治理层 |
| first_touch_router.py | `flowforge/core/capability/routing.py` | 合并到 CapabilityProfile 路由 |
| ember_hierarchy.py | `flowforge/forgemind/stages.py` | 重命名为 EvolutionStage |
| ascension_stage.py | `flowforge/forgemind/stages.py` | 重命名为 AwakeningStage |
| forgekin_council.py | `flowforge/forgemind/council/engine.py` | 重命名为 MindCouncil |
| soul_profile.py | `flowforge/core/capability/profile.py` | 重命名为 MindProfile |
| soul_store.py | `flowforge/core/memory/federation/store.py` | 重命名为 MindStore |

## §0.8 Plugin V3 四钩子设计

> **来源**：S-08 / X-017 + `decisions/005-forgemind-application-layer.md`
> **说明**：v6.0 PluginProtocol 已有 V2 钩子（register_agents/tools/modes 等），v7.0 新增 V3 四钩子用于灵智体注册

### §0.8.1 四钩子契约

```python
class FlowForgePlugin(ABC):
    # ... V2 钩子保留（register_agents / register_tools / register_modes 等）...

    # ── V3 Registration hooks（v7.0 新增）─────────────────────────

    def register_forgekins(self, forgekin_registry: Any) -> None:
        """注册灵智体到 forgemind。

        *Forge 通过此钩子注册其垂直领域的灵智体（如 ContentForge 注册内容创作灵智体）。
        """
        pass

    def register_forge_skills(self, skill_registry: Any) -> None:
        """注册灵智体可加载的技能包（SkillPackage）。

        技能包是可加载知识包，不是人格；通过 Profile.skill_packages 引用。
        """
        pass

    def register_council_channels(self, council_registry: Any) -> None:
        """注册灵议 Mind Council 频道。

        灵智体可通过此钩子注册自己的议事频道，参与多灵智体议事。
        """
        pass

    def register_auto_forge_config(self, auto_forge_config: Any) -> None:
        """注册灵锻 SpiritForge 配置。

        灵锻是 E4+ 灵智体的自主思考机制，配置包括蒸馏策略、sunset 周期等。
        """
        pass
```

### §0.8.2 与 V2 钩子的关系

| 版本 | 钩子 | 用途 | 状态 |
|------|------|------|------|
| V2 | register_agents | 注册普通 Agent | ✅ 保留 |
| V2 | register_tools | 注册工具 | ✅ 保留 |
| V2 | register_modes | 注册执行模式 | ✅ 保留 |
| V2 | register_skills | 注册技能 | ✅ 保留 |
| V3 | register_forgekins | 注册灵智体到 forgemind | 🆕 新增 |
| V3 | register_forge_skills | 注册灵智体技能包 | 🆕 新增 |
| V3 | register_council_channels | 注册灵议频道 | 🆕 新增 |
| V3 | register_auto_forge_config | 注册灵锻配置 | 🆕 新增 |

**关系说明**：V2 钩子保留用于普通 Agent/工具注册；V3 四钩子新增用于灵智体注册。V3 不替代 V2，二者并存。

## §0.9 文档导航与依赖引用

> **来源**：`review/review.md` 第一章 1.1.3 节

### §0.9.1 13 份依赖引用文档清单

本 design.md v7.0 增补章节依赖引用以下 13 份文档（operator 已审核通过引用关系）：

1. `review/review.md` —— 终稿审核（决策源，78 项 P0 + 49 项 P1 + 25 项 P2 + 14 冲突点）
2. `VISION.md` —— 万物灵智体愿景
3. `ROADMAP.md` —— 6 阶段路线图
4. `SOP.md` —— 灵智体协作 SOP
5. `TIPS.md` —— 38 条经验提示
6. `roleagent.md` —— 七大工程路径
7. `decisions/004-capability-profile-routing.md` —— 能力画像 ADR
8. `decisions/005-forgemind-application-layer.md` —— forgemind 应用层 ADR
9. `decisions/006-external-agent-integration.md` —— 三方 Agent 集成 ADR
10. `decisions/012-naming-fusion.md` —— 命名融合 ADR
11. `decisions/013-all-things-spirit-mind-vision.md` —— 万物灵智体愿景 ADR
12. `features/TEMPLATE.md` —— Feature 模板
13. `harness-feedback/README.md` —— Eval 反馈规范

### §0.9.2 16 份审核文件清单

`review/glm.md`、`review/glm1.md`、`review/qianwen.md`、`review/qianwen1.md`、`review/deepseek.md`、`review/deepseek1.md`、`review/doubao.md`、`review/doubao1.md`、`review/kimi.md`、`review/kimi1.md`、`review/minimax.md`、`review/minimax1.md`、`review/review.md`（终稿 v1.2）、`review/review1.md`、`review/reviewd.md`、`review/reviewd1.md`。

### §0.9.3 v6.0 历史内容声明

> **以下为 v6.0 历史内容，保留作为背景资料。术语已按 `decisions/012-naming-fusion.md` §6.9 全局替换映射表统一替换为新术语（详见 §0.3.5）。章节结构未破坏，仅做术语替换。如有术语冲突，以本 v7.0 增补章节为准。**

***

## 第一章：项目骨架与目录结构

### 1.1 项目目录（v6.0）

```
flowforge/
├── core/                          # 共享内核（纯接口定义）
│   ├── __init__.py
│   ├── base_agent.py              # BaseAgent, AgentInput, AgentOutput
│   ├── base_tool.py               # BaseTool, ToolInput, ToolOutput（含 safety_level）
│   ├── base_mode_executor.py      # BaseModeExecutor（含 _on_enter/_on_exit 生命周期钩子）
│   ├── task_context.py            # TaskContext（含 harness_enabled 标志）
│   ├── di.py                      # 轻量 DI 容器
│   ├── errors.py                  # 统一异常层次
│   ├── config.py                  # YAML 配置加载器 (pydantic-settings)
│   ├── tracing.py                 # trace_id 注入与日志
│   └── metrics.py                 # Prometheus 指标
│
├── engine/                        # 执行引擎层
│   ├── __init__.py
│   ├── hybrid_executor.py         # HybridExecutor（含 Harness Hook 点）
│   ├── defense_layer.py           # 三层防御（L1超时/L2重复检测/L3自修正）
│   ├── agent_registry.py          # Agent 注册中心
│   ├── mode_registry.py           # 模式注册中心
│   ├── scheduler.py               # APScheduler 定时调度
│   └── state_manager.py           # SQLite 状态持久化
│
├── harness/                       # Harness 驾驭层（v6.0 新增）
│   ├── __init__.py                # HarnessOrchestrator（统一入口）
│   ├── context/                   # 上下文工程
│   │   ├── __init__.py
│   │   ├── context_engine.py      # AGENTS.md 注入 + 会话交接
│   │   └── session_manager.py     # 会话管理器（压缩/截断/持久化）
│   ├── constraints/               # 架构约束
│   │   ├── __init__.py
│   │   ├── arch_constraint_engine.py  # 分层依赖检测引擎
│   │   ├── linter_rules.py        # Linter 规则定义
│   │   └── linter_runner.py       # Linter 执行器
│   ├── feedback/                  # 反馈循环
│   │   ├── __init__.py
│   │   ├── feedback_loop.py       # 独立评判 + 四维评分 + 分类闸门
│   │   └── verification_hooks.py  # 后台验证钩子
│   └── entropy/                   # 熵管理
│       ├── __init__.py
│       ├── entropy_manager.py     # 熵管理器
│       ├── doc_gardener.py        # 文档园丁
│       ├── debt_tracker.py        # 技术债跟踪器
│       └── rule_evolution.py      # 规则进化器
│
├── security/                      # 安全体系
│   ├── __init__.py
│   ├── permission_pipeline.py     # 三层权限管线 deny→ask→allow
│   ├── action_classifier.py       # 动作分级器 Read/Suggest/Prepare/Execute
│   ├── secure_tool_registry.py    # 安全工具注册表
│   ├── sandbox.py                 # 沙箱执行器
│   ├── path_validator.py          # 路径穿越防护
│   └── audit_trail.py             # 审计追踪
│
├── skills/                        # Skill 系统（v6.0 新增）
│   ├── __init__.py
│   ├── registry.py                # SkillRegistry（双层加载 + 置信度匹配）
│   ├── loader.py                  # Skill 加载器
│   ├── adapters/                  # 格式适配器
│   │   ├── __init__.py
│   │   ├── base.py                # SkillAdapter 基类
│   │   ├── flowforge.py           # FlowForge 原生格式
│   │   ├── claude_code.py         # Claude Code 格式
│   │   ├── anthropic.py           # Anthropic 格式
│   │   └── trae_cn.py             # Trae CN 格式
│   └── combo/                     # Combo Skills
│       ├── __init__.py
│       └── combo_engine.py        # 声明式 YAML 管道编排
│
├── mcp/                           # MCP 模块（v6.0 新增）
│   ├── __init__.py
│   ├── client.py                  # MCP Client（JSON-RPC 2.0）
│   ├── gateway.py                 # MCP Gateway（权限+预算+限流+流式）
│   ├── broker.py                  # MCP Broker（多服务器聚合+索引+熔断）
│   ├── tool_adapter.py            # MCP Tool → BaseTool 转换
│   └── config.py                  # MCP 配置管理
│
├── tools/                         # 工具层
│   ├── __init__.py
│   ├── builtin/                   # 内置工具
│   │   ├── __init__.py
│   │   ├── llm_client.py          # 统一 LLM 客户端
│   │   ├── web_search.py          # 网络搜索
│   │   ├── tavily_search.py       # Tavily 搜索
│   │   ├── duckduckgo_search.py   # DuckDuckGo 搜索
│   │   ├── web_scraper.py         # 网页抓取
│   │   ├── python_executor.py     # Python 沙箱执行
│   │   ├── file_rw.py             # 文件读写
│   │   ├── shell_command.py       # Shell 命令
│   │   ├── cache.py               # 缓存工具
│   │   ├── pexels_image.py        # Pexels 图片
│   │   ├── sendgrid_mail.py       # SendGrid 邮件
│   │   └── webhook.py             # Webhook 通知
│   ├── adapters/                  # 协议适配器
│   │   ├── __init__.py
│   │   ├── mcp_adapter.py         # MCP 协议适配
│   │   ├── openapi_adapter.py     # OpenAPI 协议适配
│   │   └── graphql_adapter.py     # GraphQL 协议适配
│   └── publish/                   # 发布工具
│       ├── __init__.py
│       ├── wechat_publisher.py    # 微信公众号
│       ├── toutiao_publisher.py   # 头条
│       └── local_publish.py       # 本地发布
│
├── memory/                        # 记忆层
│   ├── __init__.py
│   ├── manager.py                 # MemoryManager
│   ├── working.py                 # 工作记忆
│   ├── short_term.py              # 短期记忆
│   ├── long_term.py               # 长期记忆
│   ├── semantic.py                # 语义记忆
│   ├── episodic.py                # 情景记忆
│   ├── compressor.py              # ContextCompressor
│   ├── task_board.py              # TaskBoard（原子认领）
│   ├── mailbox.py                 # Mailbox（四级优先级 + TTL）
│   ├── checkpoint_manager.py      # CheckpointManager
│   └── stores/
│       ├── __init__.py
│       └── sqlite_store.py        # SQLite 存储后端
│
├── events/                        # 事件系统
│   ├── __init__.py
│   ├── event_bus.py               # EventBus
│   ├── event_types.py             # 事件类型定义
│   └── helm_adapter.py            # EventBus → Helm 事件桥接
│
├── modes/                         # 模式执行器
│   ├── __init__.py
│   ├── registry.py                # ModeRegistry
│   ├── react.py
│   ├── plan_execute.py
│   ├── reflexion.py
│   ├── default_llm_actors.py
│   ├── multi_agent.py             # 三策略：Subagents/Teams/Swarms
│   ├── workflow.py
│   ├── graph_of_thoughts.py
│   ├── rewoo.py
│   ├── self_discover.py
│   └── agent_judge.py
│
├── agents/                        # 专家执行层
│   ├── __init__.py
│   ├── generic/                   # 17 个通用 Agent
│   │   ├── __init__.py
│   │   ├── base.py
│   │   ├── analyst.py
│   │   ├── approver.py
│   │   ├── critic.py
│   │   ├── deliverer.py
│   │   ├── drafter.py
│   │   ├── executor.py
│   │   ├── finalizer.py
│   │   ├── generator.py
│   │   ├── planner.py
│   │   ├── processor.py
│   │   ├── react_actor.py
│   │   ├── react_observer.py
│   │   ├── react_thinker.py
│   │   ├── refiner.py
│   │   ├── reviewer.py
│   │   ├── validator.py
│   │   └── verifier.py
│   ├── topic_research.py
│   ├── material_collection.py
│   ├── article_writing.py
│   ├── seo_optimization.py
│   ├── fact_check.py
│   ├── content_audit.py
│   ├── headline_optimizer.py
│   ├── content_repurposer.py
│   ├── trend_analysis.py
│   ├── publishing.py
│   ├── image_research.py
│   ├── multilingual.py
│   ├── research_agent.py
│   ├── web_search_agent.py
│   └── code_writer_agent.py
│
├── workflows/                     # Workflow YAML 模板
│   ├── deep_article.yaml
│   ├── quick_post.yaml
│   ├── trend_article.yaml
│   ├── multi_platform.yaml
│   ├── seo_content.yaml
│   ├── image_article.yaml
│   ├── multilingual.yaml
│   └── report_generation.yaml
│
├── plugins/                       # 插件系统
│   ├── __init__.py
│   ├── plugin_manager.py          # PluginManager
│   └── hooks_registry.py          # Hooks 注册中心
│
├── observability/                 # 可观测性（v6.0 新增）
│   ├── __init__.py
│   ├── tracing.py                 # OpenTelemetry 追踪
│   ├── metrics.py                 # Prometheus 指标
│   ├── dashboard.py               # 仪表盘数据
│   └── alerts.py                  # 告警规则
│
├── app/                           # FastAPI 应用层
│   ├── __init__.py
│   ├── main.py
│   ├── deps.py
│   └── api/
│       ├── __init__.py
│       ├── router.py
│       └── endpoints/
│           ├── __init__.py
│           ├── tasks.py
│           ├── agents.py
│           ├── review.py
│           ├── websocket.py
│           └── ...（20 个端点模块）
│
├── config/                        # 配置文件
│   ├── default.yaml               # 默认系统配置
│   ├── models.yaml                # 模型供应商配置
│   ├── prompts.yaml               # 提示词模板
│   ├── harness_v6.yaml            # Harness 配置（v6.0 新增）
│   ├── layer_mapping.yaml         # 架构层映射（v6.0 新增）
│   └── workflows/                 # 通用 Workflow YAML
│
├── web/                           # 前端（Next.js 14）
│   └── ...
│
└── tests/                         # 测试
    ├── unit/
    ├── integration/
    └── conftest.py
```

### 1.2 pyproject.toml

```toml
[build-system]
requires = ["setuptools>=68.0", "wheel"]
build-backend = "setuptools.backends._legacy:_Backend"

[project]
name = "flowforge"
version = "6.0.0"
description = "AI Agent Harness Platform — 为 AI Agent 提供约束、反馈、上下文管理与熵控制的完整控制论系统"
readme = "README.md"
license = {text = "MIT"}
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.110",
    "uvicorn[standard]>=0.29",
    "pydantic>=2.0",
    "pydantic-settings>=2.0",
    "pyyaml>=6.0",
    "httpx>=0.27",
    "sqlalchemy>=2.0",
    "aiosqlite>=0.20",
    "tiktoken>=0.7",
    "psutil>=5.9",
    "apscheduler>=3.10",
    "prometheus-client>=0.20",
    "opentelemetry-api>=1.20",
    "opentelemetry-sdk>=1.20",
]

[project.optional-dependencies]
search = ["tavily-python>=0.3", "duckduckgo-search>=4.0"]
publish = ["wechatter>=0.5"]
image = ["pexels-api>=1.0"]
email = ["sendgrid>=6.10"]
mcp = ["mcp>=0.9"]
all = ["flowforge[search,publish,image,email,mcp]"]

[project.entry-points."flowforge.modes"]
react = "flowforge.modes.react:ReActExecutor"
plan_execute = "flowforge.modes.plan_execute:PlanExecuteExecutor"
reflexion = "flowforge.modes.reflexion:ReflexionExecutor"
multi_agent = "flowforge.modes.multi_agent:MultiAgentExecutor"
workflow = "flowforge.modes.workflow:WorkflowExecutor"
graph_of_thoughts = "flowforge.modes.graph_of_thoughts:GraphOfThoughtsExecutor"
rewoo = "flowforge.modes.rewoo:ReWOOExecutor"
self_discover = "flowforge.modes.self_discover:SelfDiscoverExecutor"
agent_judge = "flowforge.modes.agent_judge:AgentJudgeExecutor"

[project.entry-points."flowforge.plugins"]
# 用户自定义插件入口点
```

***

## 第二章：核心接口详细设计

### 2.1 BaseAgent

```python
from abc import ABC, abstractmethod
from pydantic import BaseModel, Field
from typing import Any, Optional

class AgentInput(BaseModel):
    """Agent 统一输入"""
    task: str = Field(..., description="任务描述")
    context: dict[str, Any] = Field(default_factory=dict, description="上下文数据")
    metadata: dict[str, Any] = Field(default_factory=dict, description="元数据")

class AgentOutput(BaseModel):
    """Agent 统一输出"""
    result: dict[str, Any] = Field(default_factory=dict, description="执行结果")
    status: str = Field(default="success", description="执行状态: success/partial/failure")
    metadata: dict[str, Any] = Field(default_factory=dict, description="输出元数据")
    state_updates: dict[str, Any] = Field(default_factory=dict, description="状态更新（通过此字段修改 State）")

class BaseAgent(ABC):
    """Agent 基类 — 所有 Agent 必须继承此类"""

    def __init__(self, name: str, tools: list | None = None, config: dict | None = None):
        self.name = name
        self.tools = tools or []
        self.config = config or {}

    @abstractmethod
    async def execute(self, input: AgentInput) -> AgentOutput:
        """执行 Agent 任务（子类必须实现）"""
        ...

    async def execute_with_context(self, input: AgentInput, ctx: 'TaskContext') -> AgentOutput:
        """带上下文的执行（可选覆写，默认调用 execute）"""
        return await self.execute(input)
```

### 2.2 BaseTool

```python
from enum import Enum
from abc import ABC, abstractmethod

class SafetyLevel(str, Enum):
    """工具安全等级"""
    READONLY = "readonly"   # 只读操作，无副作用
    NORMAL = "normal"   # 有副作用但可逆
    DANGEROUS = "dangerous" # 不可逆操作，需审批

class ToolInput(BaseModel):
    """工具统一输入"""
    params: dict[str, Any] = Field(default_factory=dict)

class ToolOutput(BaseModel):
    """工具统一输出"""
    result: Any = Field(None, description="执行结果")
    error: str | None = Field(None, description="错误信息")
    metadata: dict[str, Any] = Field(default_factory=dict)

class BaseTool(ABC):
    """工具基类 — 所有工具必须继承此类"""

    # v5.0 新增：安全标记
    safety_level: SafetyLevel = SafetyLevel.SAFE
    is_concurrency_safe: bool = True

    def __init__(self, name: str, description: str = "", config: dict | None = None):
        self.name = name
        self.description = description
        self.config = config or {}

    @abstractmethod
    async def execute(self, input: ToolInput) -> ToolOutput:
        """执行工具（子类必须实现）"""
        ...
```

### 2.3 TaskContext

```python
class TaskContext:
    """任务上下文 — 贯穿整个任务生命周期"""

    def __init__(
        self,
        task_id: str,
        mode: str = "react",
        persona: str | None = None,
        state: dict | None = None,
        tools: list[BaseTool] | None = None,
        agents: dict[str, type[BaseAgent]] | None = None,
        event_bus: 'EventBus' | None = None,
        harness_enabled: bool = False,  # v6.0 新增：Harness 灰度开关
    ):
        self.task_id = task_id
        self.mode = mode
        self.persona = persona
        self.state = state or {}
        self.tools = tools or []
        self.agents = agents or {}
        self.event_bus = event_bus
        self.harness_enabled = harness_enabled  # v6.0
        self.metadata: dict[str, Any] = {}
        self.parent_id: str | None = None

    @classmethod
    def from_parent(cls, parent: 'TaskContext', **overrides) -> 'TaskContext':
        """创建子上下文：state 深拷贝隔离，tools/agents/event_bus 共享引用"""
        import copy
        defaults = {
            "task_id": f"{parent.task_id}_sub",
            "mode": parent.mode,
            "persona": parent.persona,
            "state": copy.deepcopy(parent.state),  # 深拷贝隔离
            "tools": parent.tools,                  # 共享引用
            "agents": parent.agents,                # 共享引用
            "event_bus": parent.event_bus,           # 共享引用
            "harness_enabled": parent.harness_enabled,  # v6.0 继承
        }
        defaults.update(overrides)
        ctx = cls(**defaults)
        ctx.parent_id = parent.task_id
        return ctx
```

### 2.4 BaseModeExecutor（含 v5.0 生命周期钩子）

```python
class BaseModeExecutor(ABC):
    """模式执行器基类 — 所有模式执行器必须继承此类"""

    def __init__(self, agent_registry: 'AgentRegistry', tool_registry: 'ToolRegistry', config: dict | None = None):
        self.agent_registry = agent_registry
        self.tool_registry = tool_registry
        self.config = config or {}

    @abstractmethod
    async def execute(self, input: AgentInput, ctx: TaskContext) -> AgentOutput:
        """执行模式（子类必须实现）"""
        ...

    # v5.0 新增：生命周期钩子
    async def _on_enter(self, ctx: TaskContext) -> None:
        """进入模式时触发 — L2 重复检测入口"""
        pass

    async def _on_exit(self, ctx: TaskContext, output: AgentOutput) -> None:
        """退出模式时触发 — L2 重复检测出口"""
        pass
```

### 2.5 统一异常层次

```python
class FlowForgeError(Exception):
    """FlowForge 基础异常"""
    def __init__(self, message: str, context: dict | None = None):
        super().__init__(message)
        self.context = context or {}

class AgentTimeoutError(FlowForgeError):
    """Agent 执行超时"""
    pass

class ToolExecutionError(FlowForgeError):
    """工具执行失败"""
    pass

class SafetyViolationError(FlowForgeError):
    """安全违规（v5.0 新增）"""
    pass

class HarnessViolationError(FlowForgeError):
    """Harness 约束违规（v6.0 新增）"""
    pass

class CompactionThresholdExceeded(FlowForgeError):
    """上下文压缩阈值超限（v6.0 新增）"""
    pass
```

***

## 第三章：依赖注入容器

```python
class DIContainer:
    """轻量依赖注入容器"""

    def __init__(self):
        self._singletons: dict[str, Any] = {}
        self._agent_factories: dict[str, Callable] = {}

    def register_singleton(self, name: str, instance: Any) -> None:
        self._singletons[name] = instance

    def register_agent(self, name: str, factory: Callable) -> None:
        self._agent_factories[name] = factory

    def resolve(self, name: str) -> Any:
        if name in self._singletons:
            return self._singletons[name]
        raise KeyError(f"未注册的单例: {name}")

    def resolve_agent(self, name: str, **kwargs) -> BaseAgent:
        if name in self._agent_factories:
            return self._agent_factories[name](**kwargs)
        raise KeyError(f"未注册的 Agent 工厂: {name}")

    def resolve_all_agents(self) -> dict[str, BaseAgent]:
        return {name: factory() for name, factory in self._agent_factories.items()}
```

***

## 第四章：模式注册中心与混合执行器

### 4.1 ModeRegistry

```python
class ModeRegistry:
    """模式注册中心 — 管理所有 Agent 架构模式"""

    def __init__(self):
        self._modes: dict[str, BaseModeExecutor] = {}

    def register(self, name: str, executor: BaseModeExecutor) -> None:
        self._modes[name] = executor

    def get(self, name: str) -> BaseModeExecutor:
        if name not in self._modes:
            raise KeyError(f"未注册的模式: {name}")
        return self._modes[name]

    def suggest_mode(self, task: str) -> str:
        """基于关键词匹配推荐模式"""
        task_lower = task.lower()
        mode_keywords = {
            "react": ["step", "observe", "think", "act"],
            "plan_execute": ["plan", "strategy", "roadmap", "milestone"],
            "reflexion": ["improve", "reflect", "iterate", "refine"],
            "multi_agent": ["team", "collaborate", "parallel", "swarm"],
            "workflow": ["pipeline", "stage", "sequential", "step-by-step"],
            "graph_of_thoughts": ["explore", "branch", "merge", "compare"],
            "rewoo": ["predict", "plan-ahead", "decompose"],
            "self_discover": ["discover", "reasoning", "framework"],
            "agent_judge": ["judge", "evaluate", "rank", "compare"],
        }
        for mode, keywords in mode_keywords.items():
            if any(kw in task_lower for kw in keywords):
                return mode
        return "react"  # 默认 ReAct
```

### 4.2 HybridExecutor（含 v6.0 Harness Hook 点）

```python
class HybridExecutor:
    """混合执行器 — 核心调度引擎"""

    def __init__(
        self,
        mode_registry: ModeRegistry,
        agent_registry: 'AgentRegistry',
        tool_registry: 'ToolRegistry',
        event_bus: 'EventBus',
        memory_manager: 'MemoryManager',
        state_manager: 'StateManager',
        harness: 'HarnessOrchestrator | None' = None,  # v6.0 新增
    ):
        self.mode_registry = mode_registry
        self.agent_registry = agent_registry
        self.tool_registry = tool_registry
        self.event_bus = event_bus
        self.memory_manager = memory_manager
        self.state_manager = state_manager
        self.harness = harness  # v6.0
        self._persona_locks: dict[str, str] = {}

    async def run(self, task: str, mode: str = "react", persona: str | None = None, **kwargs) -> AgentOutput:
        """执行任务 — 核心入口"""
        task_id = kwargs.get("task_id", str(uuid4()))

        ctx = TaskContext(
            task_id=task_id,
            mode=mode,
            persona=persona,
            tools=self.tool_registry.get_all(),
            agents={name: type(a) for name, a in self.agent_registry.get_all().items()},
            event_bus=self.event_bus,
            harness_enabled=self.harness is not None,  # v6.0
        )

        # v6.0: Harness pre_execute Hook
        if ctx.harness_enabled and self.harness:
            await self.harness.pre_execute(ctx)  # context.inject() + entropy.check()

        # 模式选择与执行
        executor = self.mode_registry.get(mode)
        await executor._on_enter(ctx)  # v5.0 L2 钩子
        result = await executor.execute(AgentInput(task=task, context=kwargs), ctx)
        await executor._on_exit(ctx, result)  # v5.0 L2 钩子

        # v6.0: Harness post_execute Hook
        if ctx.harness_enabled and self.harness:
            result = await self.harness.post_execute(result, ctx)  # constraints.validate() + feedback.evaluate()

        # 状态持久化
        await self.state_manager.save(task_id, result, ctx)

        # 事件发射
        await self.event_bus.emit("task.completed", {"task_id": task_id, "status": result.status})

        return result
```

***

## 第五章：事件总线与 Helm 集成

### 5.1 EventBus

```python
# events/event_bus.py

import asyncio
from typing import Callable, Dict, List
from datetime import datetime

class EventBus:
    """事件总线。emit() 是同步方法，异步回调通过 asyncio.ensure_future 调度。"""

    def __init__(self):
        self._subscribers: Dict[str, List[Callable]] = {}

    def subscribe(self, event_type: str, callback: Callable):
        self._subscribers.setdefault(event_type, []).append(callback)

    def emit(self, task_id: str, event_type: str, payload: dict):
        """同步发射事件。异步回调通过 asyncio.ensure_future 调度，不阻塞主流程。"""
        event = {
            "type": event_type,
            "payload": payload,
            "task_id": task_id,
            "timestamp": datetime.utcnow().isoformat(),
        }
        for cb in self._subscribers.get(event_type, []):
            try:
                result = cb(event)
                if asyncio.iscoroutine(result):
                    asyncio.ensure_future(result)
            except Exception:
                pass
        for cb in self._subscribers.get('*', []):
            try:
                result = cb(event)
                if asyncio.iscoroutine(result):
                    asyncio.ensure_future(result)
            except Exception:
                pass
```

### 5.2 EventBusHelmAdapter

```python
# events/helm_adapter.py

from .event_bus import EventBus

class EventBusHelmAdapter:
    """将 FlowForge EventBus 事件桥接到 ContentForge HelmWSManager。
    全局订阅 + task_id 路由：HelmWSManager 按 task_id 维护连接映射，
    emit_event(task_id, ...) 只会发送到正确的 WebSocket 连接。"""

    EVENT_MAP = {
        "workflow.step.start": "helm.stage.enter",
        "mode.enter": "helm.stage.enter",
        "tool.start": "helm.tool.start",
        "tool.end": "helm.tool.end",
        "llm.start": "helm.llm.start",
        "llm.reasoning": "helm.llm.reasoning",
        "llm.stream": "helm.llm.stream",
        "llm.end": "helm.llm.end",
        "draft.update": "helm.draft.update",
        "step.intermediate": "helm.step.intermediate",
        "review.ready": "helm.review.ready",
        "review.submitted": "helm.review.submitted",
        "task.paused": "helm.task.paused",
        "task.resumed": "helm.task.resumed",
        "task.completed": "helm.task.completed",
        "task.error": "helm.task.error",
        "token.stats": "helm.token.stats",
    }

    def __init__(self, event_bus: EventBus, helm_manager):
        self.event_bus = event_bus
        self.helm_manager = helm_manager
        self._bridged = False

    def bridge(self):
        if self._bridged:
            return
        for flowforge_event, helm_event_type in self.EVENT_MAP.items():
            def make_callback(etype=helm_event_type):
                async def callback(event):
                    await self.helm_manager.emit_event(
                        event["task_id"], etype, event["payload"])
                return callback
            self.event_bus.subscribe(flowforge_event, make_callback())
        self._bridged = True
```

***

## 第六章：Database Schema

### 6.1 tasks 表

```sql
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    task TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'react',
    persona TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    result TEXT,  -- JSON
    error TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);
```

### 6.2 audit_logs 表

```sql
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    details TEXT,  -- JSON
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id)
);
```

### 6.3 model_health 表

```sql
CREATE TABLE IF NOT EXISTS model_health (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    latency_ms INTEGER,
    success BOOLEAN,
    error TEXT,
    checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 6.4 checkpoints 表

```sql
CREATE TABLE IF NOT EXISTS checkpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    state TEXT NOT NULL,  -- JSON
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id)
);
```

### 6.5 task_board 表

```sql
CREATE TABLE IF NOT EXISTS task_board (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    description TEXT NOT NULL,
    assignee TEXT,
    priority TEXT NOT NULL DEFAULT 'normal',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    claimed_at TIMESTAMP,
    completed_at TIMESTAMP
);
```

### 6.6 messages 表

```sql
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    sender TEXT NOT NULL,
    recipient TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'normal',  -- critical/high/normal/low
    subject TEXT,
    body TEXT NOT NULL,
    read BOOLEAN NOT NULL DEFAULT 0,
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id)
);
```

***

## 第七章：九大模式执行器详细设计

### 7.1 ReAct 执行器

````python
# modes/react.py

import json
import re
from core.base_mode_executor import BaseModeExecutor
from core.base_tool import ToolInput
from core.task_context import TaskContext

class ReActExecutor(BaseModeExecutor):
    mode_name = "react"
    capabilities = ["reasoning", "retrieval", "acting"]

    MAX_STEPS = 8
    LOOP_THRESHOLD = 3

    async def _execute_core(self, ctx: TaskContext) -> dict:
        observation = ctx.input_data.get("task", "")
        action_history = []
        step = 0
        for step in range(self.MAX_STEPS):
            thought = await self._generate_thought(ctx, observation, action_history)
            ctx.event_bus.emit(ctx.task_id, "react.thought", {"step": step, "thought": thought})

            action = await self._parse_action(thought)
            if action is None:
                break

            ctx.event_bus.emit(ctx.task_id, "react.action", {"step": step, "action": action})

            if self._is_loop(action_history, action):
                ctx.event_bus.emit(ctx.task_id, "react.loop_detected", {"step": step})
                break
            action_history.append(action)

            observation = await self._execute_action(ctx, action)
            ctx.event_bus.emit(ctx.task_id, "react.observation", {"step": step, "result": observation[:200]})

        return {"final_answer": observation, "steps": step + 1}

    async def _generate_thought(self, ctx, obs, history):
        llm_tool = ctx.tools.get_tool("llm")
        prompt = f"当前观察: {obs}\n历史动作: {history}\n请思考下一步行动。"
        result = await llm_tool.execute(ToolInput(params={"messages": [{"role": "user", "content": prompt}]}))
        return result.result["content"]

    async def _parse_action(self, thought):
        if "最终回答" in thought or "final answer" in thought.lower():
            return None
        match = re.search(r'```json\s*(\{.*?\})\s*```', thought, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(1))
            except json.JSONDecodeError:
                pass
        return {"tool": "llm", "params": {"query": thought}}

    def _is_loop(self, history, action):
        if len(history) < self.LOOP_THRESHOLD:
            return False
        return sum(1 for a in history[-self.LOOP_THRESHOLD:] if a == action) >= self.LOOP_THRESHOLD

    async def _execute_action(self, ctx, action):
        tool_name = action.get("tool", "llm")
        params = action.get("params", {})
        tool = ctx.tools.get_tool(tool_name)
        result = await tool.execute(ToolInput(params=params))
        return json.dumps(result.result, ensure_ascii=False)
````

### 7.2 Plan-Execute 执行器

```python
# modes/plan_execute.py

import json
import re
from core.base_mode_executor import BaseModeExecutor
from core.base_agent import AgentInput
from core.base_tool import ToolInput
from core.task_context import TaskContext

class PlanExecuteExecutor(BaseModeExecutor):
    mode_name = "plan_execute"
    capabilities = ["planning"]

    async def _execute_core(self, ctx: TaskContext) -> dict:
        task = ctx.input_data.get("task", "")
        plan = await self._planner_generate_plan(ctx, task)
        ctx.event_bus.emit(ctx.task_id, "plan_execute.plan", {"plan": plan})

        results = {}
        for i, step in enumerate(plan):
            ctx.event_bus.emit(ctx.task_id, "workflow.step.start", {"step": step["name"], "index": i})
            agent_name = step.get("agent", "executor")
            agent = ctx.agents.get(agent_name)
            if agent is None:
                from modes.default_llm_actors import DefaultLLMActor
                agent = DefaultLLMActor()
            agent_input = AgentInput(params={"task": step["task"], "context": results})
            if hasattr(agent, 'execute_with_context'):
                output = await agent.execute_with_context(agent_input, ctx)
            else:
                output = await agent.execute(agent_input)
            results[step["name"]] = output.result
            ctx.event_bus.emit(ctx.task_id, "workflow.step.complete", {"step": step["name"], "result": output.result})

        return {"plan": plan, "results": results}

    async def _planner_generate_plan(self, ctx, task):
        llm_tool = ctx.tools.get_tool("llm")
        prompt = f"将以下任务分解为顺序执行步骤，输出 JSON 数组: \n{task}\n格式: [{{\"name\": \"step1\", \"task\": \"...\", \"agent\": \"...\"}}]"
        result = await llm_tool.execute(ToolInput(params={"messages": [{"role": "user", "content": prompt}]}))
        content = result.result.get("content", "[]")
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            match = re.search(r'\[.*\]', content, re.DOTALL)
            if match:
                try:
                    return json.loads(match.group())
                except json.JSONDecodeError:
                    pass
            return []
```

### 7.3 Reflexion 执行器

```python
# modes/reflexion.py

from core.base_mode_executor import BaseModeExecutor
from core.base_agent import AgentInput
from core.task_context import TaskContext
from modes.default_llm_actors import DefaultLLMActor, DefaultLLMEvaluator, DefaultLLMReflector

class ReflexionExecutor(BaseModeExecutor):
    mode_name = "reflexion"
    capabilities = ["generation", "evaluation", "refinement"]

    MAX_ITERATIONS = 4
    QUALITY_THRESHOLD = 0.9

    async def _execute_core(self, ctx: TaskContext) -> dict:
        memory = []
        best_result = None
        best_score = 0.0

        for iteration in range(self.MAX_ITERATIONS):
            actor = ctx.agents.get("reflexion_actor") or DefaultLLMActor()
            actor_input = AgentInput(params={"task": ctx.input_data.get("task", ""), "memory": memory})
            if hasattr(actor, 'execute_with_context'):
                actor_output = await actor.execute_with_context(actor_input, ctx)
            else:
                actor_output = await actor.execute(actor_input)
            ctx.event_bus.emit(ctx.task_id, "reflexion.actor", {"iteration": iteration, "output": actor_output.result})

            evaluator = ctx.agents.get("reflexion_evaluator") or DefaultLLMEvaluator()
            eval_input = AgentInput(params={"output": actor_output.result})
            if hasattr(evaluator, 'execute_with_context'):
                eval_output = await evaluator.execute_with_context(eval_input, ctx)
            else:
                eval_output = await evaluator.execute(eval_input)
            score = eval_output.result.get("score", 0)
            issues = eval_output.result.get("issues", [])
            ctx.event_bus.emit(ctx.task_id, "reflexion.evaluator", {"iteration": iteration, "score": score, "issues": issues})

            if score > best_score:
                best_result = actor_output.result
                best_score = score

            if score >= self.QUALITY_THRESHOLD:
                break

            reflector = ctx.agents.get("reflexion_reflector") or DefaultLLMReflector()
            reflect_input = AgentInput(params={"output": actor_output.result, "issues": issues})
            if hasattr(reflector, 'execute_with_context'):
                reflect_output = await reflector.execute_with_context(reflect_input, ctx)
            else:
                reflect_output = await reflector.execute(reflect_input)
            memory.append(reflect_output.result.get("reflection", ""))
            ctx.event_bus.emit(ctx.task_id, "reflexion.reflector", {"iteration": iteration, "reflection": reflect_output.result})

        return {"result": best_result, "score": best_score, "iterations": iteration + 1}
```

> **设计说明**：Reflexion 是 FeedbackLoop 的内环。串行关系：Reflexion 内环先跑完，然后交给 FeedbackLoop 外环做终审。外环 FAIL 直接降级（返回最佳结果 + 质量警告），不回内环。

### 7.4 Multi-Agent 执行器（三策略统一版）

```python
# modes/multi_agent.py

import asyncio
from core.base_mode_executor import BaseModeExecutor
from core.base_agent import AgentInput
from core.task_context import TaskContext

class MultiAgentExecutor(BaseModeExecutor):
    mode_name = "multi_agent"
    capabilities = ["collaboration"]

    def __init__(self, task_board: Optional[TaskBoard] = None,
                 mailbox: Optional[Mailbox] = None):
        self.task_board = task_board
        self.mailbox = mailbox
        self.max_idle_rounds = 3

    def _ensure_infrastructure(self):
        if self.task_board is None:
            self.task_board = TaskBoard()
        if self.mailbox is None:
            self.mailbox = Mailbox()

    async def _execute_core(self, ctx: TaskContext) -> dict:
        strategy = ctx.metadata.get("strategy", "subagents")
        self._ensure_infrastructure()

        if strategy == "subagents":
            return await self._run_subagents(ctx)
        elif strategy == "agent_teams":
            return await self._run_agent_teams(ctx)
        elif strategy == "swarms":
            return await self._run_swarms(ctx)
        else:
            raise ValueError(f"Unknown multi-agent strategy: {strategy}")

    # --- Subagents：无状态并行隔离 ---

    async def _run_subagents(self, ctx: TaskContext) -> dict:
        tasks = ctx.metadata.get("sub_tasks", [])
        if not tasks:
            tasks = await self._decompose_task(ctx)

        async def execute_sub_task(task):
            sub_ctx = TaskContext.from_parent(
                ctx,
                input_data={"task": task.get("prompt", task.get("name", ""))},
                state={},
                metadata={"isolation": "full", "parent_task": ctx.task_id}
            )
            allowed_tools = task.get("tools", ["llm", "web_search"])
            sub_ctx.tools = self._filter_tools(ctx.tools, allowed_tools)

            agent = ctx.agents.get(task.get("agent_type", "default")) \
                if ctx.agents else None
            if agent is None:
                from flowforge.modes.default_llm_actors import DefaultLLMActor
                agent = DefaultLLMActor()

            agent_input = AgentInput(params={"task": task.get("prompt", task.get("name", ""))})
            output = await agent.execute_with_context(agent_input, sub_ctx) \
                if hasattr(agent, 'execute_with_context') \
                else await agent.execute(agent_input)
            summary = await self._compress_result(sub_ctx, output.result)
            return task.get("id", task.get("name", "")), summary

        results = await asyncio.gather(
            *[execute_sub_task(t) for t in tasks], return_exceptions=True
        )
        final = {}
        for r in results:
            if isinstance(r, Exception):
                continue
            key, value = r
            final[key] = value
        return {"results": final}

    # --- Agent Teams：共享任务板 + 信箱通信 ---

    async def _run_agent_teams(self, ctx: TaskContext) -> dict:
        lead_agent = self._get_lead_agent(ctx)
        task_list = await self._create_task_board(ctx, lead_agent)
        team_members = await self._spawn_team(ctx)

        idle_rounds = 0
        last_board_hash = None

        while not await self._all_tasks_done() and idle_rounds < self.max_idle_rounds:
            progress_made = False

            for member in team_members:
                task = await self.task_board.claim_task(member.name)
                if task:
                    try:
                        result = await self._execute_team_task(member, task, ctx)
                        await self.task_board.complete_task(task["task_id"], result)
                        progress_made = True
                        if isinstance(result, dict) and result.get("important"):
                            await self.mailbox.send(
                                member.name, "lead",
                                f"发现: {result['important']}",
                                priority="high"
                            )
                    except Exception as e:
                        await self.task_board.fail_task(task["task_id"], str(e))
                        await self.mailbox.send(
                            member.name, "lead",
                            f"任务 {task['task_id']} 失败: {str(e)}",
                            priority="critical"
                        )

            messages = await self.mailbox.receive("lead", unread_only=True)
            for msg in messages:
                if self._needs_replanning(msg):
                    await self._replan(lead_agent, task_list, ctx)

            await self.task_board.reset_stuck_tasks(timeout_seconds=300)

            current_hash = await self._hash_board()
            if current_hash == last_board_hash:
                idle_rounds += 1
            else:
                idle_rounds = 0
                last_board_hash = current_hash

        return await self._aggregate_results(lead_agent, ctx)

    # --- Swarms：去中心化集群 ---

    async def _run_swarms(self, ctx: TaskContext) -> dict:
        # SwarmWorker 持续认领任务 + 心跳监控 + SwarmCoordinator 检测失联节点
        # 详细实现见 v5.0 第十八章
        pass
```

**三策略对比**：

| 维度       | Subagents                           | Agent Teams     | Swarms              |
| -------- | ----------------------------------- | --------------- | ------------------- |
| **状态**   | 无状态，完全隔离                            | 共享 TaskBoard    | 去中心化，各自认领           |
| **通信**   | 无（结果压缩返回）                           | Mailbox 信箱      | Mailbox + 心跳        |
| **协调**   | 无（并行执行）                             | Lead Agent 协调   | SwarmCoordinator 监控 |
| **适用场景** | 独立子任务并行                             | 多角色协作           | 大规模分布式任务            |
| **上下文**  | `TaskContext.from_parent(state={})` | 共享 TaskBoard 状态 | 各自独立 + TaskBoard    |
| **容错**   | 单任务失败不影响其他                          | Lead 可重新规划      | 心跳检测 + 自动重发布        |
| **退出条件** | 全部完成                                | 全部完成 或 空闲超限     | 全部完成 或 空闲超限         |

### 7.5 Workflow 执行器

```python
# modes/workflow.py

import asyncio
from core.base_mode_executor import BaseModeExecutor
from core.base_agent import AgentInput
from core.task_context import TaskContext
from core.errors import WorkflowRecursionError

class WorkflowExecutor(BaseModeExecutor):
    mode_name = "workflow"
    capabilities = ["orchestration", "planning"]
    MAX_DEPTH = 3

    DEFAULT_DEFENSE = {
        "max_tool_calls": 50,
        "tool_timeout": 120,
        "repetition_limit": 3,
        "reflexion_retries": 2,
        "checkpoint_enabled": True,
    }

    async def _execute_core(self, ctx: TaskContext) -> dict:
        sop_steps = ctx.metadata.get("sop_steps", [])
        context_data = ctx.input_data.copy()
        depth = ctx.metadata.get("_workflow_depth", 0)
        if depth >= self.MAX_DEPTH:
            raise WorkflowRecursionError("Max workflow depth exceeded")

        defense_config = {**self.DEFAULT_DEFENSE, **ctx.metadata.get("defense", {})}
        ctx.metadata["_defense"] = defense_config

        for step in sop_steps:
            step_name = step["name"]
            ctx.event_bus.emit(ctx.task_id, "workflow.step.start", {"step": step_name})

            if step.get("human"):
                await self._pause_for_review(ctx, step)
                continue

            if step.get("parallel_group"):
                results = await self._execute_parallel(ctx, step["parallel_group"], context_data)
                context_data.update(results)
                continue

            mode = step.get("mode", "plan_execute")
            if mode == "workflow":
                raise ValueError("Nested workflow mode is forbidden")

            sub_ctx = TaskContext.from_parent(ctx, input_data=context_data,
                                              metadata={"_workflow_depth": depth + 1})
            try:
                sub_result = await ctx.executor.run(sub_ctx, mode_hint=mode, _is_substep=True)
                context_data[step.get("output", step_name)] = sub_result
            except Exception as e:
                on_error = step.get("on_error", "abort")
                if on_error == "skip":
                    continue
                elif on_error == "retry":
                    retry_count = step.get("retry_count", 1)
                    delay = step.get("retry_delay", 2)
                    for i in range(retry_count):
                        try:
                            await asyncio.sleep(delay)
                            sub_result = await ctx.executor.run(sub_ctx, mode_hint=mode, _is_substep=True)
                            context_data[step.get("output", step_name)] = sub_result
                            break
                        except Exception:
                            if i == retry_count - 1:
                                raise
                elif on_error == "reflexion_retry":
                    reflexion_ctx = TaskContext.from_parent(
                        ctx,
                        input_data={"task": f"分析步骤'{step['name']}'失败原因并修正: {str(e)}"},
                        metadata={"mode": "reflexion"}
                    )
                    reflexion_result = await ctx.executor.run(
                        reflexion_ctx, mode_hint="reflexion", _is_substep=True
                    )
                    context_data["_reflexion_fix"] = reflexion_result
                    retry_count = step.get("retry_count", 2)
                    for i in range(retry_count):
                        try:
                            break
                        except Exception:
                            if i == retry_count - 1:
                                raise
                else:
                    raise

            ctx.event_bus.emit(ctx.task_id, "workflow.step.complete", {"step": step_name})

        return context_data

    async def _pause_for_review(self, ctx, step):
        ctx.event_bus.emit(ctx.task_id, "review.ready", {"step": step["name"]})
        review_event = asyncio.Event()
        ctx._review_event = review_event
        await review_event.wait()

    async def _execute_parallel(self, ctx, group, context_data):
        results = {}
        tasks = []
        for item in group:
            mode = item.get("mode", "plan_execute")
            sub_ctx = TaskContext.from_parent(ctx, input_data=context_data)
            tasks.append(ctx.executor.run(sub_ctx, mode_hint=mode, _is_substep=True))
        completed = await asyncio.gather(*tasks, return_exceptions=True)
        for item, result in zip(group, completed):
            if isinstance(result, Exception):
                if item.get("on_error", "abort") == "skip":
                    continue
                raise result
            results[item.get("output", item["name"])] = result
        return results
```

**四种 on_error 策略对比**：

| 策略                | 行为                       | 适用场景        |
| ----------------- | ------------------------ | ----------- |
| `abort`（默认）       | 直接抛出异常，终止 Workflow       | 关键步骤不可跳过    |
| `skip`            | 跳过失败步骤，继续执行              | 非关键步骤       |
| `retry`           | 等待后重试 N 次                | 临时性故障（网络抖动） |
| `reflexion_retry` | Reflexion 分析原因 → 修正 → 重试 | 逻辑性错误需要自修正  |

### 7.6~7.9 其余模式概要

- **GraphOfThoughts**：维护图结构，支持分支、合并、循环，通过投票机制收敛。
- **ReWOO**：生成 Blueprint JSON，包含多个 Tool 调用计划，然后并发执行。
- **SelfDiscover**：调用 LLM 分析任务，输出推荐的思维框架（模式名称）。
- **AgentJudge**：注册两个 Agent：actor 和 judge；先 actor 执行，judge 评估，可选多轮。

### 7.10 DefaultLLM 系列（默认 Actor/Evaluator/Reflector）

```python
# modes/default_llm_actors.py

from core.base_agent import BaseAgent, AgentInput, AgentOutput
from core.base_tool import ToolInput
from core.task_context import TaskContext

class DefaultLLMActor(BaseAgent):
    name = "default_actor"

    async def execute(self, input: AgentInput) -> AgentOutput:
        raise NotImplementedError("请使用 execute_with_context")

    async def execute_with_context(self, input: AgentInput, context: TaskContext) -> AgentOutput:
        llm = context.tools.get_tool("llm") if context and context.tools else None
        if llm is None:
            return AgentOutput(result={"output": "LLMTool not available"})
        result = await llm.execute(ToolInput(params={
            "messages": [{"role": "user", "content": input.params.get("task", "")}]
        }))
        return AgentOutput(result={"output": result.result.get("content", "")})

class DefaultLLMEvaluator(BaseAgent):
    name = "default_evaluator"

    async def execute(self, input: AgentInput) -> AgentOutput:
        raise NotImplementedError("请使用 execute_with_context")

    async def execute_with_context(self, input: AgentInput, context: TaskContext) -> AgentOutput:
        llm = context.tools.get_tool("llm") if context and context.tools else None
        if llm is None:
            return AgentOutput(result={"score": 0.5, "issues": ["No LLM tool"]})
        prompt = (
            "评估以下输出质量，给出 0-1 分数和问题列表。"
            "严格输出 JSON: {\"score\": 0.85, \"issues\": [\"问题1\", \"问题2\"]}\n\n"
            f"输出内容: {input.params.get('output', '')}"
        )
        result = await llm.execute(ToolInput(params={
            "messages": [{"role": "user", "content": prompt}]
        }))
        import json, re
        content = result.result.get("content", "{}")
        match = re.search(r'\{.*\}', content, re.DOTALL)
        if match:
            try:
                return AgentOutput(result=json.loads(match.group()))
            except json.JSONDecodeError:
                pass
        return AgentOutput(result={"score": 0.5, "issues": [f"无法解析评估: {content[:100]}"]})

class DefaultLLMReflector(BaseAgent):
    name = "default_reflector"

    async def execute(self, input: AgentInput) -> AgentOutput:
        raise NotImplementedError("请使用 execute_with_context")

    async def execute_with_context(self, input: AgentInput, context: TaskContext) -> AgentOutput:
        llm = context.tools.get_tool("llm") if context and context.tools else None
        if llm is None:
            return AgentOutput(result={"reflection": "无法连接到 LLM"})
        prompt = (
            "分析以下失败案例，总结失败原因和具体改进建议。"
            "输出 JSON: {\"reflection\": \"分析结果...\"}\n\n"
            f"输出内容: {input.params.get('output', '')}\n"
            f"问题列表: {input.params.get('issues', [])}"
        )
        result = await llm.execute(ToolInput(params={
            "messages": [{"role": "user", "content": prompt}]
        }))
        import json, re
        content = result.result.get("content", "{}")
        match = re.search(r'\{.*\}', content, re.DOTALL)
        if match:
            try:
                return AgentOutput(result=json.loads(match.group()))
            except json.JSONDecodeError:
                pass
        return AgentOutput(result={"reflection": content[:200]})
```

***

## 第八章：通用 Agent 库详细设计

### 8.1 通用 Agent 注册规范

所有通用 Agent 必须继承 `flowforge.core.BaseAgent`，需要访问工具的 Agent 应覆写 `execute_with_context` 方法，通过 `context.tools` 获取 ToolRegistry。

```python
from flowforge.core.base_agent import BaseAgent, AgentInput, AgentOutput
from flowforge.core.base_tool import ToolInput
from flowforge.core.task_context import TaskContext

class TopicResearchAgent(BaseAgent):
    name = "topic_research"
    description = "多级检索策略：缓存→OpenSieve→热榜→自定义"
    default_mode = "rewoo"

    async def execute(self, input: AgentInput) -> AgentOutput:
        raise NotImplementedError("请使用 execute_with_context")

    async def execute_with_context(self, input: AgentInput, context: TaskContext) -> AgentOutput:
        query = input.params.get("topic", "")
        cache_tool = context.tools.get_tool("cache")
        cached = await cache_tool.execute(ToolInput(params={"key": query}))
        if cached.result.get("data"):
            return AgentOutput(result={"topics": cached.result["data"]})

        helix = context.tools.get_tool("opensieve_search")
        result = await helix.execute(ToolInput(params={"query": query, "max_results": 5}))
        topics = [{"title": r["title"], "angle": r.get("angle", "综合")} for r in result.result.get("results", [])]
        return AgentOutput(result={"topics": topics})
```

### 8.2 其他通用 Agent

`MaterialCollectionAgent`、`ArticleWritingAgent`、`SEOOptimizationAgent`、`FactCheckAgent`、`ContentAuditAgent`、`HeadlineOptimizerAgent`、`ContentRepurposerAgent`、`TrendAnalysisAgent`、`PublishingAgent`、`ImageResearchAgent`、`MultilingualAgent`、`ResearchAgent`、`WebSearchAgent`、`CodeWriterAgent` 均遵循相同模式：覆写 `execute_with_context`，通过 `context.tools` 获取工具。

### 8.3 17 个通用 Agent（generic/）

v6.0 新增 17 个通用 Agent，位于 `agents/generic/` 目录：

| Agent | 职责 |
|-------|------|
| Analyst | 数据分析与洞察提取 |
| Approver | 审批决策 |
| Critic | 批判性评审 |
| Deliverer | 交付物封装 |
| Drafter | 初稿生成 |
| Executor | 任务执行 |
| Finalizer | 最终润色 |
| Generator | 内容生成 |
| Planner | 规划分解 |
| Processor | 数据处理 |
| ReActActor | ReAct 模式执行者 |
| ReActObserver | ReAct 模式观察者 |
| ReActThinker | ReAct 模式思考者 |
| Refiner | 精炼优化 |
| Reviewer | 评审检查 |
| Validator | 合规验证 |
| Verifier | 事实核查 |

***

## 第九章：通用 Workflow 库设计

### 9.1 Workflow 定义

通用 Workflow 以 YAML 文件形式存储在 `flowforge/workflows/` 目录下。

示例 `deep_article.yaml`：

```yaml
name: "deep_article"
version: "1.0"
steps:
  - name: "topic_research"
    agent: "topic_research"
    mode: "rewoo"
    output: "topics"
  - name: "material_collection"
    agent: "material_collection"
    mode: "rewoo"
    output: "materials"
  - name: "writing"
    agent: "article_writing"
    mode: "reflexion"
    output: "draft"
  - name: "seo_opt"
    agent: "seo_optimization"
    mode: "plan_execute"
    output: "seo_title"
  - name: "fact_check"
    agent: "fact_check"
    mode: "react"
  - name: "audit"
    agent: "content_audit"
    mode: "agent_judge"
  - name: "review"
    human: true
  - name: "publish"
    agent: "publishing"
    mode: "plan_execute"
    output: "published_urls"
```

### 9.2 Workflow 调用

```python
context = TaskContext(task_id="123", persona="education", input_data={"topic": "..."},
                      metadata={"sop_steps": load_sop("deep_article")})
result = await forge.run(context, mode_hint="workflow")
```

### 9.3 v6.0 新增 Workflow 模板

| 模板 | 说明 |
|------|------|
| `multilingual.yaml` | 多语言翻译与本地化 |
| `report_generation.yaml` | 报告生成 |

***

## 第十章：插件系统详细设计

### 10.1 插件机制概述

采用 Python 生态标准的 **`entry_points`** 机制，并结合**配置文件扫描**，实现多层次的插件发现与加载。

```
第三方插件包 (pip install flowforge-plugin-xxx)
        │
        ├── 注册工具 (entry_points: flowforge.tools)
        ├── 注册模式 (entry_points: flowforge.modes)
        ├── 注册 Agent (entry_points: flowforge.agents)
        └── 注册 Workflow (entry_points: flowforge.workflows)
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│                    FlowForge 启动时                      │
│  1. 扫描所有已安装包的 entry_points                        │
│  2. 加载指定的 YAML 配置文件目录                           │
│  3. 将发现的组件注册到对应的 Registry 中                   │
└─────────────────────────────────────────────────────────┘
```

### 10.2 通用插件发现与加载器

```python
# plugins/plugin_manager.py

import importlib.metadata
from typing import Dict, List, Callable
from core.errors import ConfigurationError

class PluginManager:

    def __init__(self):
        self._plugins: Dict[str, Dict[str, List[Callable]]] = {
            "modes": {},
            "agents": {},
            "tools": {},
            "workflows": {},
        }

    def discover_entry_points(self, group: str) -> List[Callable]:
        factories = []
        try:
            entry_points = importlib.metadata.entry_points(group=group)
            for ep in entry_points:
                try:
                    factory = ep.load()
                    factories.append(factory)
                except Exception:
                    pass
        except Exception:
            pass
        return factories

    def load_from_config(self, config: dict) -> Dict[str, List[Callable]]:
        results = {}
        for plugin_type in ["modes", "agents", "tools", "workflows"]:
            plugins = config.get(plugin_type, [])
            results[plugin_type] = []
            for plugin_def in plugins:
                if isinstance(plugin_def, str):
                    module_path = plugin_def
                elif isinstance(plugin_def, dict):
                    module_path = plugin_def.get("module")
                else:
                    continue
                if module_path:
                    try:
                        factory = self._load_from_path(module_path)
                        results[plugin_type].append(factory)
                    except Exception:
                        pass
        return results

    def _load_from_path(self, module_path: str) -> Callable:
        import importlib
        if ":" in module_path:
            module_name, attr_name = module_path.split(":", 1)
            module = importlib.import_module(module_name)
            return getattr(module, attr_name)
        else:
            module = importlib.import_module(module_path)
            if hasattr(module, "register"):
                return module.register
            raise ConfigurationError(f"No callable found in module {module_path}")
```

> **v6.0 变更**：删除 `plugins/skills_loader.py`，Skill 加载统一走 `skills/registry.py`。

### 10.3 注册新的模式执行器

```python
# my_plugin/my_mode.py
from flowforge.core.base_mode_executor import BaseModeExecutor
from flowforge.core.task_context import TaskContext

class MyCustomMode(BaseModeExecutor):
    mode_name = "my_custom_mode"
    capabilities = ["reasoning", "writing"]

    async def _execute_core(self, ctx: TaskContext) -> dict:
        return {"result": "success"}
```

```toml
[project.entry-points."flowforge.modes"]
my_custom_mode = "my_plugin.my_mode:MyCustomMode"
```

### 10.4 注册新的通用 Agent

```python
# my_plugin/agents.py
from flowforge.core.base_agent import BaseAgent, AgentInput, AgentOutput
from flowforge.core.task_context import TaskContext

class MyAnalysisAgent(BaseAgent):
    name = "my_analysis"
    description = "自定义数据分析Agent"
    default_mode = "reflexion"

    async def execute(self, input: AgentInput) -> AgentOutput:
        raise NotImplementedError("请使用 execute_with_context")

    async def execute_with_context(self, input: AgentInput, context: TaskContext) -> AgentOutput:
        llm = context.tools.get_tool("llm")
        result = await llm.execute(ToolInput(params={"messages": [{"role": "user", "content": input.params.get("data", "")}]}))
        return AgentOutput(result={"analysis": result.result.get("content", "")})
```

### 10.5 注册新的通用 Workflow

**方式 1：YAML 文件注册**（推荐）

```yaml
flowforge:
  workflow_paths:
    - "/path/to/custom_workflows/"
```

**方式 2：Python 代码注册**

```toml
[project.entry-points."flowforge.workflows"]
my_workflow = "my_plugin.my_workflow:register"
```

### 10.6 注册新的 Tool（支持 MCP 协议接入）

```python
# my_plugin/tools.py
from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput

class MyCustomTool(BaseTool):
    name = "my_tool"
    description = "自定义工具"
    parameters_schema = {"type": "object", "required": ["param1"]}

    async def execute(self, input: ToolInput) -> ToolOutput:
        return ToolOutput(result={"output": input.params["param1"]})
```

```yaml
# MCP 服务配置
tools:
  - name: "filesystem"
    type: "mcp"
    command: "npx"
    args: ["-y", "@anthropic/mcp-server-filesystem", "/tmp"]
  - name: "external_api"
    type: "openapi"
    spec_url: "https://api.example.com/openapi.json"
    auth: {type: "bearer", token_env: "API_KEY"}
```

***

## 第十一章：Tool 系统与沙箱安全

### 11.1 统一 Tool 注册与调用

```python
# tools/builtin/registry.py（v6.0 迁移自 tools/registry.py）

import time
import asyncio
from typing import Dict, Optional, Callable
from core.base_tool import BaseTool, ToolInput, ToolOutput

class ToolRegistry:
    def __init__(self, tool_timeout: int = 120):
        self._tools: Dict[str, BaseTool] = {}
        self._tool_timeout = tool_timeout

    def register(self, tool: BaseTool):
        if tool.name in self._tools:
            raise ValueError(f"Tool '{tool.name}' already registered")
        self._tools[tool.name] = tool

    def get_tool(self, name: str) -> BaseTool:
        if name not in self._tools:
            raise KeyError(f"Tool '{name}' not found")
        return self._tools[name]

    def get_all(self) -> list[BaseTool]:
        return list(self._tools.values())

    async def execute(self, name: str, input: ToolInput, emit_callback=None) -> ToolOutput:
        tool = self.get_tool(name)
        if not tool.validate_params(input.params):
            raise ValueError(f"Invalid params for tool '{name}'")

        if emit_callback:
            await emit_callback("tool.start", {"tool_name": name, "params": input.params})

        start = time.time()
        try:
            # v5.0 L1 超时防御
            result = await asyncio.wait_for(
                tool.execute(input),
                timeout=self._tool_timeout
            )
        except TimeoutError:
            return ToolOutput(
                result={},
                error=f"Tool '{name}' timed out after {self._tool_timeout}s"
            )
        except Exception as e:
            if emit_callback:
                await emit_callback("tool.end", {"tool_name": name, "error": str(e), "duration_ms": int((time.time()-start)*1000)})
            raise

        if emit_callback:
            await emit_callback("tool.end", {"tool_name": name, "result": result.result, "duration_ms": int((time.time()-start)*1000)})
        return result
```

### 11.2 SecureToolRegistry

```python
# security/secure_tool_registry.py

from flowforge.tools.builtin.registry import ToolRegistry

class SecureToolRegistry(ToolRegistry):
    SAFETY_READONLY = "readonly"
    SAFETY_NORMAL = "normal"
    SAFETY_DANGEROUS = "dangerous"

    def __init__(self, event_bus=None, tool_timeout: int = 120):
        super().__init__(tool_timeout=tool_timeout)
        self._event_bus = event_bus
        self._running_tools: Dict[str, asyncio.Lock] = {}

    def register(self, tool: BaseTool):
        if not hasattr(tool, 'safety_level'):
            tool.safety_level = self.SAFETY_NORMAL
        if not hasattr(tool, 'is_concurrency_safe'):
            tool.is_concurrency_safe = True
        super().register(tool)

    async def execute(self, name: str, input: ToolInput,
                      context: Optional[TaskContext] = None,
                      require_approval: bool = True) -> ToolOutput:
        tool = self.get_tool(name)
        safety = getattr(tool, 'safety_level', self.SAFETY_NORMAL)

        if safety == self.SAFETY_READONLY:
            return await super().execute(name, input)

        if safety == self.SAFETY_DANGEROUS and require_approval and context:
            approved = await self._request_approval(context, name, input.params)
            if not approved:
                return ToolOutput(result={}, error=f"Permission denied for dangerous tool '{name}'")

        if not getattr(tool, 'is_concurrency_safe', True):
            if name not in self._running_tools:
                self._running_tools[name] = asyncio.Lock()
            async with self._running_tools[name]:
                return await super().execute(name, input)

        return await super().execute(name, input)

    async def _request_approval(self, context: TaskContext, tool_name: str, params: dict) -> bool:
        if self._event_bus:
            self._event_bus.emit(context.task_id, "permission.requested", {
                "tool": tool_name, "params": params, "task_id": context.task_id
            })
        if hasattr(context, 'executor') and context.executor:
            review_event = context.executor.register_review_wait(
                f"{context.task_id}_tool_{tool_name}")
            await review_event.wait()
            state = context.executor.state_manager.load_state(context.task_id)
            return state.get("review_verdict") == "approved"
        return False
```

**安全等级语义**：

| safety_level | 含义   | 审批要求    | 典型工具         |
| ------------- | ---- | ------- | ------------ |
| `safe`        | 只读操作 | 无需审批    | 搜索、检索、LLM 调用 |
| `moderate`    | 常规操作 | 仅并发时需注意 | 文件写入、数据转换    |
| `dangerous`   | 危险操作 | 需人工审批   | 代码执行、删除、发布   |

### 11.3 沙箱执行器 (`PythonExecutorTool`)

```python
# tools/builtin/python_executor.py

import sys
import multiprocessing
import os
import tempfile
import io
import contextlib
from core.base_tool import BaseTool, ToolInput, ToolOutput

class PythonExecutorTool(BaseTool):
    name = "python_executor"
    description = "在隔离沙箱中执行Python代码"
    safety_level = "dangerous"
    parameters_schema = {
        "type": "object",
        "required": ["code"],
        "properties": {
            "code": {"type": "string", "description": "待执行的Python代码"},
            "timeout": {"type": "integer", "default": 10, "description": "超时秒数"},
            "max_memory_mb": {"type": "integer", "default": 64, "description": "最大内存MB"},
        }
    }

    async def execute(self, input: ToolInput) -> ToolOutput:
        code = input.params["code"]
        timeout = input.params.get("timeout", 10)
        max_memory = input.params.get("max_memory_mb", 64)

        queue = multiprocessing.Queue()
        process = multiprocessing.Process(
            target=self._run_in_subprocess,
            args=(code, queue, max_memory)
        )
        process.start()
        process.join(timeout)
        if process.is_alive():
            process.terminate()
            process.join()
            return ToolOutput(result={"stdout": "", "stderr": "Code execution timed out"}, error="timeout")

        if not queue.empty():
            result = queue.get()
            return ToolOutput(result=result)
        return ToolOutput(result={"stdout": "", "stderr": "Execution failed"}, error="execution_error")

    def _run_in_subprocess(self, code, queue, max_memory):
        try:
            if sys.platform != "win32":
                import resource
                resource.setrlimit(resource.RLIMIT_AS,
                                   (max_memory * 1024 * 1024, max_memory * 1024 * 1024))
            else:
                try:
                    import psutil
                    process = psutil.Process()
                    process.memory_limit(max_memory * 1024 * 1024)
                except ImportError:
                    pass

            with tempfile.TemporaryDirectory() as tmpdir:
                os.chdir(tmpdir)
                safe_builtins = dict(__builtins__.__dict__)
                for dangerous in ['__import__', 'open', 'eval', 'exec', 'compile', 'input']:
                    safe_builtins.pop(dangerous, None)

                restricted_globals = {
                    '__builtins__': safe_builtins,
                    '__name__': '__main__',
                }
                output = io.StringIO()
                with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
                    exec(compile(code, '<sandbox>', 'exec'), restricted_globals)
                queue.put({"stdout": output.getvalue(), "stderr": ""})
        except Exception as e:
            queue.put({"stdout": "", "stderr": str(e)})
```

### 11.4 文件系统 Tool (受限)

```python
# tools/builtin/file_rw.py

import os
from core.base_tool import BaseTool, ToolInput, ToolOutput

class FileReadWriteTool(BaseTool):
    name = "file_rw"
    ALLOWED_BASE = "/tmp/flowforge_sandbox"

    def _validate_path(self, path: str) -> bool:
        real_path = os.path.realpath(os.path.join(self.ALLOWED_BASE, path))
        return real_path.startswith(os.path.realpath(self.ALLOWED_BASE))

    async def execute(self, input: ToolInput) -> ToolOutput:
        action = input.params.get("action", "read")
        file_path = input.params.get("path", "")
        if not self._validate_path(file_path):
            return ToolOutput(result={}, error="Access denied: path traversal detected")
        full_path = os.path.join(self.ALLOWED_BASE, file_path)
        if action == "read":
            with open(full_path, 'r') as f:
                return ToolOutput(result={"content": f.read()})
        elif action == "write":
            content = input.params.get("content", "")
            with open(full_path, 'w') as f:
                f.write(content)
            return ToolOutput(result={"status": "written"})
```

***

## 第十二章：Memory 模块详细设计

### 12.1 MemoryManager 完整实现

```python
# memory/manager.py

from typing import Any, List, Dict

class MemoryManager:
    def __init__(self, config: dict, llm_client=None):
        self.working = WorkingMemory()
        self.short_term = ShortTermMemory(config.get("db_url"))
        self.long_term = LongTermMemory(config.get("db_url"))
        self.semantic = SemanticMemory() if config.get("vector_db_url") else None
        self.episodic = EpisodicMemory(config.get("db_url"))
        self.compressor = ContextCompressor(llm_client) \
            if llm_client and config.get("compression_enabled", True) else None

    async def save(self, memory_type: str, key: str, data: Any) -> None:
        store = getattr(self, memory_type, None)
        if store: await store.store(key, data)

    async def retrieve(self, memory_type: str, query: Any) -> Any:
        store = getattr(self, memory_type, None)
        if store: return await store.search(query)

    async def hybrid_search(self, query: str, types: List[str] = None) -> List[Any]:
        if types is None: types = ["semantic", "long_term", "episodic"]
        results = []
        if "semantic" in types and self.semantic:
            results.extend(await self.semantic.search(query))
        if "long_term" in types:
            results.extend(await self.long_term.search(query))
        if "episodic" in types:
            results.extend(await self.episodic.search(query))
        return results

    async def compress_messages(self, messages: list, context=None) -> list:
        if self.compressor:
            return await self.compressor.compress_if_needed(messages, context)
        return messages
```

### 12.2 ContextCompressor

```python
# memory/compressor.py

RECENT_ROUNDS = 3
COMPRESSION_THRESHOLD = 0.85
MAX_CONTEXT_TOKENS = 128000

class ContextCompressor:
    def __init__(self, llm_client=None):
        self._llm_client = llm_client
        self._max_context_tokens = MAX_CONTEXT_TOKENS

    async def compress_if_needed(
        self,
        messages: List[Dict[str, Any]],
        context=None,
    ) -> List[Dict[str, Any]]:
        total_tokens = self._estimate_messages_tokens(messages)
        if total_tokens <= self._max_context_tokens * COMPRESSION_THRESHOLD:
            return messages

        recent, early = self._split_messages(messages)
        if not early:
            return messages

        compressed_early = await self._compress_early_history(early, context)

        if context and context.memory:
            await self._save_to_memory(context, early)

        return compressed_early + recent

    def _split_messages(self, messages):
        decision_indices = []
        for i, msg in enumerate(messages):
            if self._is_decision_or_tool_result(msg):
                decision_indices.append(i)

        if not decision_indices:
            return [], messages

        recent_start = max(0, len(decision_indices) - RECENT_ROUNDS)
        split_idx = decision_indices[recent_start]
        return messages[:split_idx], messages[split_idx:]

    def _is_decision_or_tool_result(self, msg):
        role = msg.get("role", "")
        if role in ("tool",):
            return True
        if role == "system":
            return True
        if role == "assistant":
            if msg.get("tool_calls"):
                return True
            content = msg.get("content", "")
            if isinstance(content, str) and any(
                kw in content.lower()
                for kw in ["final answer", "conclusion", "result:", "decision:"]
            ):
                return True
        return False

    async def _compress_early_history(self, early, context=None):
        llm = None
        if context and context.tools:
            try:
                llm = context.tools.get_tool("llm")
            except Exception:
                pass
        if not llm and self._llm_client:
            llm = self._llm_client
        if not llm:
            return early

        result = await llm.execute(ToolInput(params={
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 800,
        }))
        summary_text = result.result.get("content", "")
        return [{"role": "system", "content": f"[Compressed History] {summary_text}"}]
```

### 12.3 TaskBoard：原子化共享任务板

```python
# memory/task_board.py

class TaskBoard:
    STATUS_PENDING = "pending"
    STATUS_CLAIMED = "claimed"
    STATUS_COMPLETED = "completed"
    STATUS_FAILED = "failed"

    def __init__(self, db_path: str = "data/task_board.db"):
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._db_path = db_path
        self._supports_returning = self._check_returning_support()
        self._claim_lock = asyncio.Lock()
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.execute("PRAGMA journal_mode=WAL")
        # ... schema creation ...

    async def claim_task(self, claimant: str, task_type: Optional[str] = None) -> Optional[dict]:
        if self._supports_returning:
            return await self._claim_atomic_returning(claimant, task_type)
        else:
            return await self._claim_with_lock(claimant, task_type)
```

**原子认领双策略**：

| 策略           | 条件            | 实现                                    |
| ------------ | ------------- | ------------------------------------- |
| RETURNING 子句 | SQLite ≥ 3.35 | `UPDATE ... RETURNING` 单条 SQL 原子操作    |
| 应用层锁         | SQLite < 3.35 | `asyncio.Lock` + SELECT + UPDATE 两步操作 |

**关键方法**：

| 方法                                      | 说明                    |
| --------------------------------------- | --------------------- |
| `add_task(task_id, task_type, payload)` | 发布单个任务                |
| `add_tasks_batch(tasks)`                | 批量发布任务                |
| `claim_task(claimant, task_type=None)`  | 原子认领（RETURNING 或应用层锁） |
| `complete_task(task_id, result)`        | 标记完成，可附带结果            |
| `fail_task(task_id, error_message)`     | 标记失败，记录错误信息           |
| `get_all_tasks(status=None)`            | 获取所有任务（可按状态过滤）        |
| `reset_stuck_tasks(timeout_seconds)`    | 重置超时任务为 pending       |

### 12.4 Mailbox：优先级 + 过期信箱

```python
# memory/mailbox.py

PRIORITY_CRITICAL = "critical"
PRIORITY_HIGH = "high"
PRIORITY_NORMAL = "normal"
PRIORITY_LOW = "low"

class Mailbox:
    def __init__(self, db_path: str = "data/mailbox.db"):
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.execute("PRAGMA journal_mode=WAL")
        # ... schema creation with indexes ...
```

**关键方法**：

| 方法                                                                           | 说明                   |
| ---------------------------------------------------------------------------- | -------------------- |
| `send(sender, recipient, subject, body, priority, tags, ttl_seconds)`        | 发送消息，支持优先级和 TTL      |
| `receive(recipient, unread_only, priority, subject_contains, sender, limit)` | 接收消息，自动标记已读          |
| `get_stats(recipient)`                                                       | 获取信箱统计（总数/未读/按优先级分布） |
| `_cleanup_expired()`                                                         | 自动清理过期消息             |

**优先级排序**：

```sql
ORDER BY CASE priority
    WHEN 'critical' THEN 0
    WHEN 'high' THEN 1
    WHEN 'normal' THEN 2
    ELSE 3
END ASC, created_at ASC
```

### 12.5 CheckpointManager

```python
# memory/checkpoint_manager.py

class CheckpointManager:
    def _ensure_schema(self):
        cursor = self._conn.execute("PRAGMA table_info(checkpoints)")
        columns = {row[1] for row in cursor.fetchall()}

        if not columns:
            self._conn.execute("""CREATE TABLE checkpoints (...)""")
            return

        if "id" not in columns:
            self._conn.execute("ALTER TABLE checkpoints RENAME TO _checkpoints_old")
            self._conn.execute("""CREATE TABLE checkpoints (...)""")
            self._conn.execute("""INSERT INTO ... SELECT ... FROM _checkpoints_old""")
            self._conn.execute("DROP TABLE _checkpoints_old")
        else:
            if "messages_json" not in columns:
                self._conn.execute("ALTER TABLE checkpoints ADD COLUMN messages_json TEXT")
            if "version" not in columns:
                self._conn.execute("ALTER TABLE checkpoints ADD COLUMN version INTEGER DEFAULT 1")
            if "label" not in columns:
                self._conn.execute("ALTER TABLE checkpoints ADD COLUMN label TEXT DEFAULT ''")
```

**新增方法**：

| 方法                                                  | 说明                             | 返回值                                 |
| --------------------------------------------------- | ------------------------------ | ----------------------------------- |
| `save_full(task_id, state, messages, label)`        | 完整保存（state + messages + 自动版本号） | checkpoint row id                   |
| `save_incremental(task_id, state, messages, label)` | 增量保存（无变更则跳过）                   | checkpoint row id                   |
| `restore(task_id, checkpoint_id=None)`              | 恢复 state + messages            | `{"state": dict, "messages": list}` |
| `get_latest(task_id)`                               | 获取最新检查点完整信息                    | dict or None                        |
| `delete_old_versions(task_id, keep_latest=5)`       | 清理旧版本                          | 删除数量                                |

### 12.6 记忆存储后端

| 记忆类型            | Phase 1 实现                  | Phase 2 升级       |
| --------------- | --------------------------- | ---------------- |
| WorkingMemory   | Python dict                 | 无需升级             |
| ShortTermMemory | SQLite (带过期清理任务)            | 迁移至 Redis        |
| LongTermMemory  | SQLite (表结构复用 ContentForge) | 迁移至 PostgreSQL   |
| SemanticMemory  | 未启用 (返回空列表)                 | 接入 Qdrant/BGE-M3 |
| EpisodicMemory  | SQLite (json 字段)            | 增加向量化            |

***

## 第十三章：安全机制总结

### v2.0 原有安全机制

| 安全层            | 机制                                                  | 实现位置                                            |
| -------------- | --------------------------------------------------- | ----------------------------------------------- |
| **Agent 隔离**   | 严格的 `BaseAgent` 接口；Agent 不能直接调用 OS 命令               | `core/base_agent.py`                            |
| **Tool 权限**    | 所有 Tool 通过 `ToolRegistry` 调用；沙箱 Tool 进程隔离           | `tools/registry.py`, `tools/python_executor.py` |
| **代码沙箱**       | 子进程执行、资源限制、移除危险内置函数、临时目录隔离                          | `tools/python_executor.py`                      |
| **文件系统路径穿越防护** | `_validate_path()` 确保路径在允许目录内                       | `tools/file_rw.py`                              |
| **并发冲突**       | Persona 锁 (`HybridExecutor._running_tasks`)，子步骤跳过锁  | `engine/hybrid_executor.py`                     |
| **循环检测**       | ReAct 模式的 `_is_loop`；Workflow 的 `MAX_DEPTH`         | `modes/react.py`, `modes/workflow.py`           |
| **审批流**        | Workflow 模式原生支持 `human: true` 节点，`asyncio.Event` 暂停 | `modes/workflow.py`                             |
| **审计与追踪**      | 每个任务生成唯一 `trace_id`；所有操作记录到 `audit_logs`            | `events/event_bus.py`, DB 表 `audit_logs`        |

### v5.0 新增安全机制

| 安全层          | 机制                                        | 实现位置                         |
| ------------ | ----------------------------------------- | ---------------------------- |
| **L1 工具超时**  | `asyncio.wait_for()` 包裹单次工具调用             | `tools/builtin/registry.py`  |
| **L2 重复检测**  | `_on_exit()` 生命周期钩子                       | `core/base_mode_executor.py` |
| **L3 自修正**   | `on_error="reflexion_retry"` 策略           | `modes/workflow.py`          |
| **工具安全分级**   | `safety_level`（readonly/normal/dangerous）   | `core/base_tool.py`          |
| **并发安全**     | `asyncio.Lock` 保护非并发安全工具                  | `security/secure_tool_registry.py` |
| **危险工具审批**   | EventBus + `register_review_wait()`       | `security/secure_tool_registry.py` |
| **上下文压缩**    | tiktoken 计数 + 滑动窗口摘要                      | `memory/compressor.py`       |
| **SOP 防御配置** | 全局 + 步骤级 defense 配置                       | `modes/workflow.py`          |

***

## 第十四章：Harness 驾驭层详细设计（v6.0 新增）

### 14.1 HarnessOrchestrator

```python
# flowforge/harness/__init__.py
from flowforge.harness.context import ContextEngine
from flowforge.harness.constraints import ArchitectureConstraintEngine
from flowforge.harness.feedback import FeedbackLoop
from flowforge.harness.entropy import EntropyManager

class HarnessOrchestrator:
    """Harness 统一入口 — 编排四根护栏的执行顺序

    设计决策（三轮评审裁决）：
    - 删除 control_loop.py，由本类替代
    - 2 个统一入口：pre_execute / post_execute
    - pre_execute: context.inject() + entropy.check()
    - post_execute: constraints.validate() + feedback.evaluate()
    """

    def __init__(self, config: dict):
        self.config = config
        self.context = ContextEngine(config.get("context_engineering", {}))
        self.constraints = ArchitectureConstraintEngine(config.get("architecture_constraints", {}))
        self.feedback = FeedbackLoop(config.get("feedback_loop", {}))
        self.entropy = EntropyManager(config.get("entropy_management", {}))

    async def pre_execute(self, ctx: 'TaskContext') -> None:
        """执行前 Hook：上下文注入 + 熵检查"""
        await self.context.inject(ctx)
        await self.entropy.check(ctx)

    async def post_execute(self, result: 'AgentOutput', ctx: 'TaskContext') -> 'AgentOutput':
        """执行后 Hook：约束验证 + 反馈评估"""
        violations = await self.constraints.validate(result, ctx)
        if violations:
            # 约束违规，返回降级结果
            result.metadata["constraint_violations"] = violations
            return result

        result = await self.feedback.evaluate(result, ctx)
        return result
```

### 14.2 ContextEngine（上下文工程）

```python
# flowforge/harness/context/context_engine.py
class ContextEngine:
    """上下文工程护栏 — AGENTS.md 按需注入 + 会话交接

    隐喻：新员工手册 — 让 Agent 在执行前获得必要的上下文
    """

    def __init__(self, config: dict):
        self.agents_md_path = config.get("agents_md_path", "AGENTS.md")
        self.session_manager = SessionManager(config.get("session", {}))

    async def inject(self, ctx: 'TaskContext') -> None:
        """注入上下文到 TaskContext"""
        # 1. AGENTS.md 按需注入
        agents_md = await self._load_agents_md(ctx)
        if agents_md:
            ctx.state["agents_md"] = agents_md

        # 2. 会话交接（从 SessionManager 获取历史摘要）
        session_summary = await self.session_manager.get_summary(ctx.task_id)
        if session_summary:
            ctx.state["session_summary"] = session_summary

    async def _load_agents_md(self, ctx: 'TaskContext') -> str | None:
        """按需加载 AGENTS.md"""
        import os
        if os.path.exists(self.agents_md_path):
            with open(self.agents_md_path, "r", encoding="utf-8") as f:
                return f.read()
        return None
```

### 14.3 SessionManager（会话管理器）

```python
# flowforge/harness/context/session_manager.py
class SessionManager:
    """会话管理器 — 上下文压缩与截断

    关键参数（三轮评审统一）：
    - COMPACTION_THRESHOLD = 0.92（92%）
    - utilization = total_tokens / model_context_window
    - 默认 model_context_window = 128000
    - 保留最近 N 轮完整对话（默认 3，可配置）
    - MAX_TOOL_OUTPUT_TOKENS = 25000
    """

    COMPACTION_THRESHOLD = 0.92
    DEFAULT_MODEL_CONTEXT_WINDOW = 128000
    DEFAULT_KEEP_RECENT_ROUNDS = 3
    MAX_TOOL_OUTPUT_TOKENS = 25000

    def __init__(self, config: dict):
        self.threshold = config.get("compaction_threshold", self.COMPACTION_THRESHOLD)
        self.model_context_window = config.get("model_context_window", self.DEFAULT_MODEL_CONTEXT_WINDOW)
        self.keep_recent_rounds = config.get("keep_recent_rounds", self.DEFAULT_KEEP_RECENT_ROUNDS)
        self.max_tool_output_tokens = config.get("max_tool_output_tokens", self.MAX_TOOL_OUTPUT_TOKENS)
        self._sessions: dict[str, list[dict]] = {}

    async def get_summary(self, task_id: str) -> str | None:
        """获取会话摘要"""
        if task_id in self._sessions:
            return self._compact(self._sessions[task_id])
        return None

    def _compact(self, messages: list[dict]) -> str:
        """压缩消息列表"""
        total_tokens = self._count_tokens(messages)
        utilization = total_tokens / self.model_context_window

        if utilization < self.threshold:
            return self._messages_to_text(messages)

        # 保留最近 N 轮 + 摘要其余
        recent = messages[-(self.keep_recent_rounds * 2):]  # 每轮 2 条（user+assistant）
        older = messages[:-(self.keep_recent_rounds * 2)] if len(messages) > self.keep_recent_rounds * 2 else []

        summary = self._summarize(older) if older else ""
        return summary + "\n" + self._messages_to_text(recent)

    def _count_tokens(self, messages: list[dict]) -> int:
        """使用 tiktoken 计算 token 数"""
        import tiktoken
        enc = tiktoken.get_encoding("cl100k_base")
        total = 0
        for msg in messages:
            total += len(enc.encode(str(msg.get("content", ""))))
        return total

    def _truncate_tool_output(self, output: str) -> str:
        """截断工具输出"""
        import tiktoken
        enc = tiktoken.get_encoding("cl100k_base")
        tokens = enc.encode(output)
        if len(tokens) > self.max_tool_output_tokens:
            return enc.decode(tokens[:self.max_tool_output_tokens]) + "\n...[truncated]"
        return output

    def _messages_to_text(self, messages: list[dict]) -> str:
        return "\n".join(f"[{m.get('role', 'unknown')}]: {m.get('content', '')}" for m in messages)

    def _summarize(self, messages: list[dict]) -> str:
        """摘要旧消息（简化版，生产环境应调用 LLM）"""
        return f"[历史会话摘要：{len(messages)} 条消息已压缩]"
```

### 14.4 ArchitectureConstraintEngine（架构约束）

```python
# flowforge/harness/constraints/arch_constraint_engine.py
import ast
from pathlib import Path

class ArchitectureConstraintEngine:
    """架构约束护栏 — 分层依赖检测 + Linter

    隐喻：缰绳 — 防止 Agent 产出违反架构约束的代码

    设计决策（评审修复 7）：
    - 使用 Python ast 模块解析 import 语句
    - 通过 config/layer_mapping.yaml 配置模块→层映射
    - source_module 从 TaskContext.metadata 获取（由 HybridExecutor 注入）
    """

    LAYER_ORDER = ["Types", "Config", "Repo", "Service", "Runtime", "UI"]

    def __init__(self, config: dict):
        self.enabled = config.get("enabled", True)
        self.layer_mapping_path = config.get("layer_mapping_path", "config/layer_mapping.yaml")
        self._layer_mapping: dict[str, str] = {}
        self._load_layer_mapping()

    def _load_layer_mapping(self) -> None:
        """加载模块→层映射配置"""
        import yaml
        path = Path(self.layer_mapping_path)
        if path.exists():
            with open(path, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)
                self._layer_mapping = data.get("modules", {})

    async def validate(self, output: 'AgentOutput', ctx: 'TaskContext') -> list[dict]:
        """验证 Agent 输出是否违反架构约束"""
        if not self.enabled:
            return []

        violations = []
        code = str(output.result.get("content", output.result.get("code", "")))
        if not code:
            return []

        source_module = ctx.metadata.get("source_module", "unknown")
        source_layer = self._layer_mapping.get(source_module, "unknown")

        dependencies = self._extract_dependencies(code)
        for dep in dependencies:
            dep_layer = self._layer_mapping.get(dep, "unknown")
            if source_layer != "unknown" and dep_layer != "unknown":
                if self.LAYER_ORDER.index(dep_layer) < self.LAYER_ORDER.index(source_layer):
                    violations.append({
                        "type": "reverse_dependency",
                        "source": {"module": source_module, "layer": source_layer},
                        "target": {"module": dep, "layer": dep_layer},
                        "message": f"反向依赖：{source_layer}({source_module}) → {dep_layer}({dep})"
                    })

        return violations

    def _extract_dependencies(self, code: str) -> list[str]:
        """使用 Python ast 模块解析 import 语句"""
        dependencies = []
        try:
            tree = ast.parse(code)
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        dependencies.append(alias.name.split(".")[0])
                elif isinstance(node, ast.ImportFrom):
                    if node.module:
                        dependencies.append(node.module.split(".")[0])
        except SyntaxError:
            pass  # 非 Python 代码，静默跳过（Phase 1 仅支持 Python）
        return dependencies
```

### 14.5 FeedbackLoop（反馈循环）

```python
# flowforge/harness/feedback/feedback_loop.py
from enum import Enum

class EvaluationMode(str, Enum):
    """评估模式（三轮评审裁决）"""
    FULL = "full"           # 四维评分 + 分类闸门（2次LLM调用）
    LIGHTWEIGHT = "lightweight"  # 仅分类闸门（1次LLM调用，默认）
    SKIP = "skip"           # 跳过外环（内环Reflexion仍生效）

class Verdict(str, Enum):
    PASS = "pass"
    CONDITIONAL = "conditional"
    FAIL = "fail"

class FeedbackLoop:
    """反馈循环护栏 — 独立评判 + 四维评分 + 分类闸门

    隐喻：智能体审智能体

    设计决策（三轮评审裁决）：
    - FeedbackLoop 是全局护栏（外环），所有模式输出都经过它
    - Reflexion 是模式内部的快速反馈循环（内环）
    - 串行关系：Reflexion 内环先跑完，然后交给 FeedbackLoop 外环做终审
    - 外环 FAIL 直接降级（返回最佳结果 + 质量警告），不回内环
    - evaluation_mode 默认 lightweight（1次LLM调用），生产环境推荐
    """

    MAX_REFLEXION_ITERATIONS = 3
    QUALITY_THRESHOLD = 0.9

    def __init__(self, config: dict):
        self.evaluation_mode = EvaluationMode(config.get("evaluation_mode", "lightweight"))
        self.quality_threshold = config.get("quality_threshold", self.QUALITY_THRESHOLD)
        self.max_iterations = config.get("max_iterations", self.MAX_REFLEXION_ITERATIONS)
        self._evaluator_agent = None  # 注入独立评判 Agent

    async def evaluate(self, result: 'AgentOutput', ctx: 'TaskContext') -> 'AgentOutput':
        """评估 Agent 输出质量"""
        if self.evaluation_mode == EvaluationMode.SKIP:
            return result

        if self.evaluation_mode == EvaluationMode.FULL:
            # 四维评分 + 分类闸门（2次LLM调用）
            scores = await self._four_dimensional_score(result, ctx)
            verdict = await self._classify(result, ctx, scores)
            result.metadata["feedback_scores"] = scores
        else:
            # 仅分类闸门（1次LLM调用，默认）
            verdict = await self._classify(result, ctx)

        result.metadata["feedback_verdict"] = verdict

        if verdict == Verdict.FAIL:
            # 外环 FAIL 直接降级，不回内环
            result.metadata["quality_warning"] = True
            result.status = "partial"

        return result

    async def _four_dimensional_score(self, result: 'AgentOutput', ctx: 'TaskContext') -> dict:
        """四维评分：Design Quality / Originality / Craft / Functionality"""
        # 调用独立评判 Agent
        scores = {
            "design_quality": 0.0,
            "originality": 0.0,
            "craft": 0.0,
            "functionality": 0.0,
        }
        # ... 实际实现调用 self._evaluator_agent
        return scores

    async def _classify(self, result: 'AgentOutput', ctx: 'TaskContext', scores: dict | None = None) -> Verdict:
        """分类闸门：PASS / CONDITIONAL / FAIL"""
        if scores:
            avg = sum(scores.values()) / len(scores)
            if avg >= self.quality_threshold:
                return Verdict.PASS
            elif avg >= self.quality_threshold * 0.7:
                return Verdict.CONDITIONAL
            else:
                return Verdict.FAIL
        # lightweight 模式：调用分类器 Agent
        # ... 实际实现调用 LLM
        return Verdict.PASS
```

### 14.6 EntropyManager（熵管理）

```python
# flowforge/harness/entropy/entropy_manager.py
class EntropyManager:
    """熵管理护栏 — 文档园丁 + 技术债回收 + 规则进化

    隐喻：垃圾回收 — 自动清理技术熵

    设计决策（评审修复 1）：
    - 定位为内置核心能力，不走插件市场
    - 后台 Cron 任务，不介入请求路径
    - pre_execute 中只做轻量判断（是否需要触发债务检查）
    """

    def __init__(self, config: dict):
        self.doc_gardener = DocGardener(config.get("doc_gardener", {}))
        self.debt_tracker = DebtTracker(config.get("debt_tracker", {}))
        self.rule_evolution = RuleEvolution(config.get("rule_evolution", {}))

    async def check(self, ctx: 'TaskContext') -> None:
        """轻量熵检查（在 pre_execute 中调用）"""
        # 只做轻量判断，不执行实际扫描
        debt_score = await self.debt_tracker.get_current_score()
        if debt_score and debt_score > 0.8:
            ctx.metadata["entropy_warning"] = True
            ctx.metadata["debt_score"] = debt_score
```

### 14.7 PermissionPipeline（权限管线）

```python
# flowforge/security/permission_pipeline.py
from enum import Enum

class ActionLevel(str, Enum):
    READ = "read"           # 只读，自动允许
    SUGGEST = "suggest"     # 建议，展示给用户但不执行
    PREPARE = "prepare"     # 准备，预填参数但需确认
    EXECUTE = "execute"     # 执行，需要明确授权

class PermissionPipeline:
    """三层权限管线 — deny → ask → allow

    规则优先级：deny > ask > allow
    """

    RULE_ORDER = ["deny", "ask", "allow"]

    def __init__(self, config: dict):
        self._rules: dict[str, list[dict]] = {
            "deny": config.get("deny_rules", []),
            "ask": config.get("ask_rules", []),
            "allow": config.get("allow_rules", []),
        }

    async def check(self, tool_name: str, action: ActionLevel, params: dict) -> tuple[bool, str]:
        """检查权限"""
        for rule_type in self.RULE_ORDER:
            for rule in self._rules[rule_type]:
                if self._match_rule(rule, tool_name, action, params):
                    if rule_type == "deny":
                        return False, f"拒绝：{rule.get('reason', '违反安全规则')}"
                    elif rule_type == "ask":
                        return False, f"需确认：{rule.get('reason', '需要用户授权')}"
                    else:
                        return True, "允许"
        return True, "默认允许"

    def _match_rule(self, rule: dict, tool_name: str, action: ActionLevel, params: dict) -> bool:
        """匹配规则"""
        if rule.get("tool") and rule["tool"] != tool_name:
            return False
        if rule.get("action") and rule["action"] != action.value:
            return False
        return True
```

### 14.8 SubAgentEngine

```python
# flowforge/engine/sub_agent_engine.py
class SubAgentEngine:
    """子 Agent 引擎 — 替换 MultiAgentExecutor._run_subagents()

    设计决策（评审修复 6）：
    - 只替换 _run_subagents() 内部实现
    - Teams 和 Swarms 仍在 MultiAgentExecutor 中
    - 底层共享上下文隔离和令牌预算能力
    """

    MAX_SUBAGENTS = 10

    def __init__(self, agent_registry: 'AgentRegistry', tool_registry: 'ToolRegistry', config: dict | None = None):
        self.agent_registry = agent_registry
        self.tool_registry = tool_registry
        self.config = config or {}

    async def run_subagents(
        self,
        parent_ctx: 'TaskContext',
        subagent_configs: list[dict],
    ) -> list['AgentOutput']:
        """并行执行子 Agent"""
        if len(subagent_configs) > self.MAX_SUBAGENTS:
            subagent_configs = subagent_configs[:self.MAX_SUBAGENTS]

        tasks = []
        for config in subagent_configs:
            child_ctx = TaskContext.from_parent(parent_ctx)
            child_ctx.state = {}  # 空状态隔离
            child_ctx.tools = self._filter_tools(config.get("allowed_tools", []))
            tasks.append(self._run_single(child_ctx, config))

        results = await asyncio.gather(*tasks, return_exceptions=True)
        return [r for r in results if not isinstance(r, Exception)]

    def _filter_tools(self, allowed: list[str]) -> list['BaseTool']:
        """过滤工具集"""
        all_tools = self.tool_registry.get_all()
        if not allowed:
            return all_tools
        return [t for t in all_tools if t.name in allowed]
```

### 14.9 TrajectoryPipeline（轨迹记录管线）

```python
# flowforge/engine/trajectory_pipeline.py
class TrajectoryPipeline:
    """轨迹记录与评估管线（FR-ENG-06）

    设计决策（评审修复 4）：
    - 从 IntegratedTrainingPipeline 降级为轨迹记录
    - 不涉及模型训练
    - 支持基于分类闸门的自动质量判定（Pass/Fail）
    """

    def __init__(self, config: dict | None = None):
        self.config = config or {}
        self._episodes: list[dict] = []

    async def record(self, task_id: str, input: 'AgentInput', output: 'AgentOutput', ctx: 'TaskContext') -> None:
        """记录 Episode 轨迹"""
        episode = {
            "task_id": task_id,
            "input": input.model_dump(),
            "output": output.model_dump(),
            "mode": ctx.mode,
            "timestamp": datetime.now().isoformat(),
        }
        self._episodes.append(episode)

    async def evaluate(self, episode: dict) -> str:
        """基于分类闸门的质量判定"""
        output = episode.get("output", {})
        status = output.get("status", "unknown")
        if status == "success":
            return "Pass"
        elif status == "partial":
            return "Conditional"
        else:
            return "Fail"
```

***

## 第十五章：Skill 系统详细设计（v6.0 新增）

### 15.1 SkillAdapter 基类

```python
# flowforge/skills/adapters/base.py
from abc import ABC, abstractmethod
from enum import Enum

class SkillFormat(str, Enum):
    FLOWFORGE = "flowforge"
    CLAUDE_CODE = "claude_code"
    ANTHROPIC = "anthropic"
    TRAE_CN = "trae_cn"
    # OpenHarness 标注为 Roadmap，当前不实现

class SkillAdapter(ABC):
    """Skill 格式适配器基类"""

    format: SkillFormat

    @abstractmethod
    async def load(self, path: str) -> 'Skill':
        """从路径加载 Skill"""
        ...

    @abstractmethod
    def validate(self, skill: 'Skill') -> bool:
        """验证 Skill 格式"""
        ...

    @abstractmethod
    def to_flowforge(self, skill: 'Skill') -> 'Skill':
        """转换为 FlowForge 原生格式"""
        ...
```

### 15.2 SkillRegistry

```python
# flowforge/skills/registry.py
class SkillRegistry:
    """Skill 注册中心 — 双层加载 + 置信度匹配

    设计决策（评审修复 10）：
    - 双层加载：全局 + 项目（项目覆盖全局同名）
    - 匹配增加置信度评分 + 触发词长度权重
    - 返回 Top-3 候选
    """

    def __init__(self, config: dict | None = None):
        self._skills: dict[str, 'Skill'] = {}
        self._global_path = config.get("global_path", "skills/")
        self._project_path = config.get("project_path", ".flowforge/skills/")

    async def _load_all(self) -> None:
        """双层加载：先全局，再项目"""
        await self._load_from_path(self._global_path)
        await self._load_from_path(self._project_path)  # 项目覆盖全局同名

    def match_skill(self, query: str, context: dict | None = None) -> list['Skill']:
        """匹配合适的 Skill（返回 Top-3）"""
        query_lower = query.lower()
        scored = []

        for skill in self._skills.values():
            score = 0.0
            for trigger in skill.triggers:
                if trigger.lower() in query_lower:
                    score += 1.0
                    score += len(trigger) / 10.0  # 触发词越长，匹配越精确

            # 上下文增强：工具调用记录加分
            if context and context.get("recent_tools"):
                if any(t in context["recent_tools"] for t in skill.required_tools):
                    score += 0.5

            # Helm 模式加权
            if context and context.get("mode") == "helm":
                score *= 1.2

            if score > 0:
                scored.append((skill, score))

        scored.sort(key=lambda x: x[1], reverse=True)
        return [s for s, _ in scored[:3]]
```

### 15.3 Combo Skills

```python
# flowforge/skills/combo/combo_engine.py
class ComboEngine:
    """Combo Skills — 声明式 YAML 管道编排"""

    async def execute(self, combo_yaml: str, ctx: 'TaskContext') -> 'AgentOutput':
        """执行 Combo Skill"""
        import yaml
        combo = yaml.safe_load(combo_yaml)
        steps = combo.get("steps", [])

        result = None
        for step in steps:
            skill_name = step["skill"]
            skill = self.registry.get(skill_name)
            result = await skill.execute(step.get("input", {}), ctx)

        return result or AgentOutput()
```

***

## 第十六章：MCP 模块详细设计（v6.0 新增）

### 16.1 MCPClient

```python
# flowforge/mcp/client.py
class MCPClient:
    """MCP Client — JSON-RPC 2.0，stdio/HTTP 双传输"""

    def __init__(self, server_config: dict):
        self.server_config = server_config
        self.transport = server_config.get("transport", "stdio")
        self._tools_cache: list[dict] = []
        self._cache_ttl = 300  # 5 分钟

    async def list_tools(self) -> list[dict]:
        """列出服务器提供的工具"""
        if self._tools_cache and self._is_cache_valid():
            return self._tools_cache
        response = await self._send_request("tools/list", {})
        self._tools_cache = response.get("tools", [])
        self._cache_time = time.time()
        return self._tools_cache

    async def call_tool(self, name: str, arguments: dict) -> dict:
        """调用工具"""
        return await self._send_request("tools/call", {"name": name, "arguments": arguments})
```

### 16.2 MCPGateway

```python
# flowforge/mcp/gateway.py
class MCPGateway:
    """MCP Gateway — 权限 + 预算 + 限流 + 流式

    设计决策（评审修复 11）：
    - 增加 execute_tool_stream() 方法
    """

    def __init__(self, config: dict):
        self.permission_pipeline = PermissionPipeline(config.get("permissions", {}))
        self.token_budget = config.get("token_budget", 100000)
        self.rate_limit = config.get("rate_limit", {"requests_per_minute": 60})

    async def execute_tool(self, tool_name: str, arguments: dict, ctx: 'TaskContext') -> dict:
        """执行工具（非流式）"""
        allowed, reason = await self.permission_pipeline.check(tool_name, ActionLevel.EXECUTE, arguments)
        if not allowed:
            raise SafetyViolationError(reason)
        return await self._broker.call_tool(tool_name, arguments)

    async def execute_tool_stream(self, tool_name: str, arguments: dict, ctx: 'TaskContext') -> AsyncIterator[dict]:
        """执行工具（流式）"""
        allowed, reason = await self.permission_pipeline.check(tool_name, ActionLevel.EXECUTE, arguments)
        if not allowed:
            raise SafetyViolationError(reason)
        async for chunk in self._broker.call_tool_stream(tool_name, arguments):
            yield chunk
```

### 16.3 MCPBroker

```python
# flowforge/mcp/broker.py
class MCPBroker:
    """MCP Broker — 多服务器聚合 + 索引 + 熔断

    设计决策（评审修复 8）：
    - 使用 _tool_index: Dict[str, str] 映射，避免遍历
    - 索引未命中时降级遍历搜索
    - 熔断：5次连续失败触发
    - 重试：3次
    """

    def __init__(self, config: dict):
        self._clients: dict[str, MCPClient] = {}
        self._tool_index: dict[str, str] = {}  # tool_name → server_name
        self._circuit_breaker: dict[str, int] = {}  # server_name → consecutive_failures
        self._max_failures = 5
        self._max_retries = 3

    async def register_server(self, name: str, client: MCPClient) -> None:
        """注册 MCP 服务器并构建索引"""
        self._clients[name] = client
        tools = await client.list_tools()
        for tool in tools:
            self._tool_index[tool["name"]] = name

    async def call_tool(self, tool_name: str, arguments: dict) -> dict:
        """调用工具（通过索引路由）"""
        server_name = self._tool_index.get(tool_name)
        if server_name and server_name in self._clients:
            return await self._call_with_retry(server_name, tool_name, arguments)

        # 索引未命中，降级遍历
        for name, client in self._clients.items():
            tools = await client.list_tools()
            if any(t["name"] == tool_name for t in tools):
                self._tool_index[tool_name] = name  # 更新索引
                return await self._call_with_retry(name, tool_name, arguments)

        raise ToolExecutionError(f"工具未找到: {tool_name}")

    async def _call_with_retry(self, server_name: str, tool_name: str, arguments: dict) -> dict:
        """带重试的工具调用"""
        for attempt in range(self._max_retries):
            try:
                result = await self._clients[server_name].call_tool(tool_name, arguments)
                self._circuit_breaker[server_name] = 0
                return result
            except Exception as e:
                self._circuit_breaker[server_name] = self._circuit_breaker.get(server_name, 0) + 1
                if self._circuit_breaker[server_name] >= self._max_failures:
                    raise FlowForgeError(f"服务器 {server_name} 熔断")
                if attempt == self._max_retries - 1:
                    raise
        raise ToolExecutionError(f"工具调用失败: {tool_name}")
```

### 16.4 MCPToolAdapter

```python
# flowforge/mcp/tool_adapter.py
class MCPToolAdapter(BaseTool):
    """MCP Tool → FlowForge BaseTool 自动转换

    设计决策（评审修复 11）：
    - 增加 execute_stream() 方法
    """

    safety_level = SafetyLevel.NORMAL

    def __init__(self, tool_info: dict, gateway: MCPGateway):
        super().__init__(
            name=tool_info["name"],
            description=tool_info.get("description", ""),
        )
        self._gateway = gateway
        self._input_schema = tool_info.get("inputSchema", {})

    async def execute(self, input: ToolInput) -> ToolOutput:
        """非流式执行"""
        try:
            result = await self._gateway.execute_tool(self.name, input.params, ctx=None)
            return ToolOutput(result=result)
        except Exception as e:
            return ToolOutput(error=str(e))

    async def execute_stream(self, input: ToolInput) -> AsyncIterator[ToolOutput]:
        """流式执行"""
        try:
            async for chunk in self._gateway.execute_tool_stream(self.name, input.params, ctx=None):
                yield ToolOutput(result=chunk)
        except Exception as e:
            yield ToolOutput(error=str(e))
```

***

## 第十七章：v6.0 目录结构完整清单

| 模块 | 文件数 | 核心职责 |
|------|--------|---------|
| core/ | 9 | 纯接口定义 |
| engine/ | 7 | 执行引擎 + 注册中心 + SubAgentEngine + TrajectoryPipeline |
| harness/ | 14 | 四根护栏（context/constraints/feedback/entropy） |
| security/ | 7 | 安全体系（权限/审计/沙箱） |
| skills/ | 10+ | Skill 系统（适配器/注册/Combo） |
| mcp/ | 5 | MCP 四层架构 |
| tools/ | ~20 | 工具生态（builtin/adapters/publish） |
| memory/ | 12 | 记忆系统 |
| events/ | 4 | 事件系统 |
| modes/ | 11 | 9 大模式 + 注册中心 + 默认 Actor |
| agents/ | 32+ | 通用 + 业务 Agent |
| workflows/ | 8 | YAML 模板 |
| plugins/ | 3 | 插件系统 |
| observability/ | 4 | 可观测性 |
| api/ | 12+ | FastAPI 端点 |

***

## 第十八章：v6.0 安全机制增强总结

| 层级 | 机制 | 来源 |
|------|------|------|
| L1 | 工具超时防御 | v5.0 |
| L2 | 重复检测钩子 | v5.0 |
| L3 | 自修正重试 | v5.0 |
| L4 | 安全工具注册表 | v5.0 |
| L5 | 权限管线 | v6.0 |
| L6 | 架构约束引擎 | v6.0 |
| L7 | 反馈循环闸门 | v6.0 |
| L8 | 熵管理 | v6.0 |
| L9 | MCP 熔断与重试 | v6.0 |
| L10 | 审计追踪 | v6.0 |

***

## 第十九章：增量迁移实施计划

### Step 1：新增 harness/ 目录（灰度开关）

- 创建 harness/ 目录及 4 个子目录（14 个新文件）
- 实现 HarnessOrchestrator（2 个统一入口）
- 在 config/harness_v6.yaml 增加灰度开关
- 在 HybridExecutor.run() 增加 Hook 点（2 行代码）
- 编写 Step 1 集成测试（harness 禁用时行为不变）

### Step 2：重组 tools/ 和 agents/（import 兼容）

- tools/ 重组为 builtin/ + adapters/ + publish/
- agents/ 重组为 generic/ + content/ + novel/ + code/
- 通过 __init__.py re-export 保持旧 import 路径
- 旧路径触发 DeprecationWarning
- 兼容期：1 个大版本周期（v7.0 才删除旧路径）

### Step 3：迁移 executor/ → engine/（最终重组）

- executor/ → engine/，新增 agent_registry.py、mode_registry.py
- 新增 security/ 和 observability/ 目录
- 新增 skills/ 和 mcp/ 目录
- 删除旧路径（v7.0 执行）
- 每步有回归测试

***

**以上为 FlowForge v6.0 详细设计说明书。** 本版本合并 v2.0 + v5.0 全部内容，并新增 Harness 驾驭层、Skill 系统、MCP 模块的详细设计，安全机制从 8 层扩展至 10 层。

---

# 附录: 2026-06-25 设计修正

> 来源：第十一轮文档与代码一致性深度审查（task.md 中 FW-CONSIST-001~029）
> 目的：修正 design.md 第一章 1.1 节目录结构与实际代码的偏差，补全新增模块设计说明

## D.1 engine/ 目录修正为 modes/ + loop/ + executor/ + scheduler/

### D.1.1 问题

design.md 第一章 1.1 节描述的 `engine/` 目录在 flowforge 实际代码中**不存在**。该目录包含 7 个文件（hybrid_executor/defense_layer/agent_registry/mode_registry/scheduler/state_manager/sub_agent_engine/trajectory_pipeline），实际代码中相关职责被拆分到 4 个独立目录。

### D.1.2 修正后的目录映射

```
design.md 描述                  实际代码位置
─────────────────────────────────────────────────────
engine/hybrid_executor.py    →  executor/hybrid_executor.py
engine/state_manager.py      →  executor/state_manager.py
engine/defense_layer.py      →  （拆分）
                                core/agent_timeout.py        (L1 超时)
                                core/base_mode_executor.py   (L2 重复检测)
                                modes/workflow.py            (L3 reflexion_retry)
engine/agent_registry.py     →  core/agent_registry.py
engine/mode_registry.py      →  modes/registry.py
engine/scheduler.py          →  scheduler/scheduler.py
engine/sub_agent_engine.py   →  （合并）modes/multi_agent.py
engine/trajectory_pipeline.py →  （合并）observability/tracer.py + session/event_store.py
```

### D.1.3 修正后的执行引擎层架构

执行引擎层由以下 4 个目录协同承担（替代原 engine/）：

| 目录 | 职责 | 关键文件 |
|------|------|---------|
| `executor/` | 混合执行器 + 状态持久化 | `hybrid_executor.py`, `state_manager.py` |
| `modes/` | 9 大执行模式 + 注册中心 + 默认 Actor | `registry.py`, `react.py`, `plan_execute.py`, `reflexion.py`, `multi_agent.py`, `workflow.py`, `graph_of_thoughts.py`, `rewoo.py`, `self_discover.py`, `agent_judge.py`, `loop_mode.py` + 7 个 workflow_* 辅助文件 |
| `loop/` | Loop 执行引擎（5 步闭环） | `executor.py`, `orchestrator.py`, `verifier.py`, `planner.py`, `reflector.py`, `parallel.py`, `registry.py`, `result_extractor.py`, `state.py`, `turn_transition.py` |
| `scheduler/` | APScheduler 定时调度 | `scheduler.py` |

**说明**：`loop/` 是与 `modes/` 平行的独立引擎，二者关系为：`modes/loop_mode.py` 是 9 大模式之一（注册到 ModeRegistry），`loop/executor.py` 是 Loop 执行引擎本体（5 步闭环 Discover→Assign→Act→Verify→Persist），loop_mode 调用 loop/executor 执行。

## D.2 harness/ 实际子目录与文档差异

### D.2.1 问题

design.md 第一章 1.1 节描述 harness/ 包含 4 个子目录（context/constraints/feedback/entropy，共 14 个文件），但实际代码中：

1. **无 context/feedback/entropy 子目录**：所有文件平铺在 harness/ 根下
2. **仅 constraints/ 子目录保留**：且只含 linter_rules.py + linter_runner.py（design.md 描述的 arch_constraint_engine.py 已迁移到 security/）
3. **新增 compaction.py**：DualThresholdCompactor 实现（design.md 未描述）

### D.2.2 修正后的 harness/ 结构

```
harness/
├── constraints/              # Linter 规则与执行器
│   ├── linter_rules.py
│   └── linter_runner.py
├── compaction.py              # DualThresholdCompactor（S3.0-21，新增）
├── context_engine.py          # ContextEngine（原 design.md context/context_engine.py）
├── entropy_manager.py         # EntropyManager（原 design.md entropy/entropy_manager.py）
├── feedback_loop.py           # FeedbackLoop（原 design.md feedback/feedback_loop.py）
├── orchestrator.py            # HarnessOrchestrator（原 design.md __init__.py）
└── session_manager.py         # SessionManager（原 design.md context/session_manager.py）
```

### D.2.3 迁移说明

| design.md 路径 | 实际路径 | 迁移原因 |
|--------------|---------|---------|
| `harness/__init__.py` | `harness/orchestrator.py` | Orchestrator 独立成文件，便于单测 |
| `harness/context/context_engine.py` | `harness/context_engine.py` | 平铺减少嵌套 |
| `harness/context/session_manager.py` | `harness/session_manager.py` | 平铺减少嵌套 |
| `harness/constraints/arch_constraint_engine.py` | `security/arch_constraint.py` | 架构约束属于安全体系，归入 security/ |
| `harness/feedback/feedback_loop.py` | `harness/feedback_loop.py` | 平铺减少嵌套 |
| `harness/feedback/verification_hooks.py` | （未实现） | 设计中，Phase 1 实现 |
| `harness/entropy/entropy_manager.py` | `harness/entropy_manager.py` | 平铺减少嵌套 |
| `harness/entropy/doc_gardener.py` | （未实现） | 设计中，Phase 1 实现 |
| `harness/entropy/debt_tracker.py` | （未实现） | 设计中，Phase 1 实现 |
| `harness/entropy/rule_evolution.py` | （未实现） | 设计中，Phase 1 实现 |
| —（design.md 未描述） | `harness/compaction.py` | 新增：DualThresholdCompactor |

## D.3 新增模块设计说明

### D.3.1 events/ 事件总线（design.md 未独立描述）

实际代码 `events/` 目录包含 5 个文件，承担 spec.md FR-OBS-04 + S3.0-18 事件总线统一方案：

```
events/
├── event_bus.py          # EventBus（同步 emit + asyncio.ensure_future 调度）
├── durable_stream.py     # DurableEventStream（WAL 模式持久化，CAP-11）
├── event_types.py        # 事件类型枚举（17 种 FlowForge 事件）
├── helm_adapter.py       # EventBus → Helm WS 事件桥接（16 种 Helm 事件映射）
└── bridge.py             # 跨项目事件桥接（OpenSieve/NovelForge 事件转发）
```

**设计要点**：
- EventBus.emit() 为同步方法，异步回调通过 asyncio.ensure_future 调度，不阻塞主流程
- DurableEventStream 使用 SQLite WAL 模式，append() 后批量提交（每 100 条或每秒）
- helm_adapter.py 实现 17 种 FlowForge 事件 → 16 种 Helm 事件的全映射（见 design.md 第五章 5.2）

### D.3.2 llm/ LLM 路由层（design.md 未独立描述）

实际代码 `llm/` 目录包含 7 个文件，承担 spec.md INF-01 + S3.0-13/15：

```
llm/
├── router.py             # LLMRouter（主备切换 + 健康检查 + 级联）
├── cascade.py            # 多模型级联策略（doubao→qwen→deepseek）
├── provider.py           # Provider 抽象（OpenAI 兼容接口）
├── provider_quota.py     # Provider 级 TPM/RPM/成本配额
├── quota_manager.py      # ProviderQuotaManager（S3.0-13）
├── route.py              # 路由策略实现（429/timeout/moderation_rejected 触发 failover）
└── call_event.py         # LLMCallEvent dataclass（spec 附录 J.2）
```

**设计要点**：
- 替代 design.md 描述的 `tools/builtin/llm_client.py` 单 Provider 实现
- 主链路：doubao-seed2 → qwen3.6-plus → deepseek-chat（可在 llm_route.yaml 配置）
- failover 条件：`status_code == 429` / `timeout > 30s` / `moderation_rejected`
- ProviderQuotaManager 实现 TPM/RPM/成本预算三重检查

### D.3.3 compiler/ Workflow YAML Compiler（design.md 未独立描述）

实际代码 `compiler/` 目录包含 6 个文件，承担 spec.md FWK-01 + S3.0-19 三阶段拆分：

```
compiler/
├── parser.py             # YAML → IR 解析器（Jinja2 模板引擎，S3.0-33）
├── validator.py          # IR 校验器（asteval 安全表达式，S3.0-34）
├── ir.py                 # 编译中间产物（CompiledWorkflow IR，可视化调试）
├── codegen.py            # IR → 可执行 Workflow 代码生成
├── compiler.py           # 三阶段编排入口（Parser→Validator→CodeGen）
└── resume_adapter.py     # 检查点恢复适配器（长程任务恢复）
```

**设计要点**：
- 三阶段拆分（Parser + Validator + CodeGen），每阶段独立可测
- IR（中间产物）可序列化为 JSON，支持可视化调试
- Validator 使用 asteval 安全表达式库，防止表达式注入（S3.0-34）
- 支持 SEQUENCE + CONDITIONAL + GATE 三种 StepType（MVP 里程碑 1）

### D.3.4 security/permission_v2.py PermissionV2（design.md 未描述）

实际代码 `security/permission_v2.py` 承担 spec.md S3.0-9 PermissionV2 增强：

```python
class PermissionV2Enhanced:
    """PermissionV2 增强 — ASK 超时/并发去重/审计日志"""
    
    async def _request_user_approval(
        self, match, tool_name, params, context,
        timeout: float = 300.0,  # 默认 5 分钟
    ) -> bool:
        # 1. 去重：同一 tool+params 的 ASK 只发一次
        # 2. 发起审批（推送到 Web UI）
        # 3. 等待结果（含超时）
        # 4. ASK 超时默认 DENY（fail-closed）
        # 5. 审计日志记录
```

**与 design.md 第十四章 14.7 PermissionPipeline 的关系**：
- `security/permission_pipeline.py`：V1 版本，deny→ask→allow 顺序链
- `security/permission_v2.py`：V2 增强版，新增 ASK 超时/并发去重/审计日志
- 二者共存，通过 FeatureFlag 切换（`features.use_permission_v2`）

### D.3.5 harness/compaction.py DualThresholdCompactor（design.md 未描述）

实际代码 `harness/compaction.py` 承担 spec.md S3.0-21 死循环防护：

```python
class DualThresholdCompactor:
    """双阈值压缩器 — LLM 摘要 + 抽取式摘要 + 丢弃最旧消息三档回退"""
    
    MAX_COMPACTIONS_PER_SESSION = 3  # 防死循环
    
    async def compact(self, messages, context):
        # 1. LLM 摘要（首选，doubao-seed2）
        # 2. 抽取式摘要（LLM 失败时回退，强制截断到安全阈值以下）
        # 3. 丢弃最旧消息（抽取式仍失败时兜底）
```

**与 design.md 第十四章 14.3 SessionManager 的关系**：
- SessionManager 负责 92% 阈值检测和触发
- DualThresholdCompactor 负责实际压缩执行（三档回退链）
- 二者协作：SessionManager 调用 DualThresholdCompactor.compact()

### D.3.6 core/ 新增模块（design.md 未描述）

| 模块 | 路径 | 设计来源 | 职责 |
|------|------|---------|------|
| FeatureFlags | `core/feature_flags.py` | spec v2.2 第一章 | FeatureFlag dataclass + 灰度开关 + 过期强制切换 |
| DeclarativeTool | `core/declarative_tool.py` | FR-PLG-01 扩展 | HTTPTool/ScriptTool/TransformTool 的父类，YAML 声明式工具 |
| ContentModerationLayer | `core/content_moderation.py` | S3.0-14 | Doubao moderation 统一内容安全层（4 场景阈值） |
| DegradationDecisionTree | `core/degradation.py` | spec v2.2 第三章 | 通用降级决策树（7 种 DegradationAction） |

## D.4 设计修正总结

| 修正项 | design.md 原描述 | 实际代码 | 修正动作 |
|--------|---------------|---------|---------|
| engine/ 目录 | 7 个文件 | 不存在 | 拆分为 executor/+modes/+loop/+scheduler/（D.1） |
| harness/ 子目录 | 4 子目录 14 文件 | 1 子目录 + 6 平铺文件 | 平铺 + 新增 compaction.py（D.2） |
| events/ | 未独立描述 | 5 文件 | 新增 D.3.1 节 |
| llm/ | 未独立描述 | 7 文件 | 新增 D.3.2 节 |
| compiler/ | 未独立描述 | 6 文件 | 新增 D.3.3 节 |
| security/permission_v2.py | 未描述 | 1 文件 | 新增 D.3.4 节 |
| harness/compaction.py | 未描述 | 1 文件 | 新增 D.3.5 节 |
| core/ 4 个新模块 | 未描述 | 4 文件 | 新增 D.3.6 节 |
| agents/generic/ 数量 | 17 个 | 22 个 | 更新为 22 个（含 fact_check/image_research/multilingual/research_agent/trend_analysis/web_search_agent） |
| workflows/ 目录 | 顶级目录 | 迁移到 config/workflows/ | 更新路径 |
| plugins/ 目录 | 顶级目录 | 迁移到 core/plugin_*.py | 更新路径 |

> 本附录为设计修正快照，所有差异项的修复任务详见 task.md FW-CONSIST-001~029。design.md 正文内容保持不变，以本附录为准进行代码对齐。

***

# 第五部分：v7.0 自进化能力详细设计（Forgekin 体系）

> **对应规格文档**：spec.md 第七章~第十三章 + 附录 O/P
> **对应架构文档**：arch.md 第 15~23 节
> **状态**：v7.0 新增，对标 clowder-ai 养猫体系 + F100 自我进化 + F255 Auto-Dream
> **核心公式升级**：`Agent = Model + Harness + Soul`（v6.0 为 `Agent = Model + Harness`）

---

## 第十五章：v7.0 目录结构新增

### 15.1 evolution/ 模块完整目录

在 v6.0 目录基础上新增 `evolution/` 顶级模块，承载全部自进化能力：

```
flowforge/
├── evolution/                         # ★ v7.0 新增：自进化层
│   ├── __init__.py                    # EvolutionLayer（自进化层统一入口）
│   │
│   ├── forgekin/                      # 灵智引擎（FR-EVO-01~03）
│   │   ├── __init__.py
│   │   ├── engine.py                  # ForgekinEngine（自进化统一入口）
│   │   ├── soul_profile.py            # MindProfile / SoulSpec / Capabilities 数据模型
│   │   ├── soul_store.py              # MindStore（灵魂档案 CRUD）
│   │   ├── echo_store.py              # EchoStore（灵忆三层记忆）
│   │   ├── imprint_store.py           # ImprintStore（灵印认知画像）
│   │   ├── episode.py                 # SoulEpisode / CollaborationPivot 数据模型
│   │   ├── ascension_manager.py       # AscensionManager（觉醒阶段 E1-E6 管理）
│   │   └── static_bridge.py           # ForgekinStaticBridge（灵智→静态智能体衔接）
│   │
│   ├── auto_forge/                    # 灵锻引擎（FR-EVO-04）
│   │   ├── __init__.py
│   │   ├── engine.py                  # SpiritForgeEngine（双层架构主引擎）
│   │   ├── consolidation.py           # ConsolidationLayer（后台 system thread）
│   │   ├── surface.py                 # SurfaceLayer（前台日记本 + Provoke 气泡）
│   │   ├── provoke_manager.py         # ProvokeManager（沙砾气泡投递 + 频率硬限）
│   │   ├── group_forge.py             # GroupForgeOrchestrator（灵锻群协调器）
│   │   ├── diary_store.py             # ForgeDiaryStore（日记存储）
│   │   └── connection_drawer.py       # ConnectionDrawer（画线联想 LLM 调用）
│   │
│   ├── codex/                         # 灵典——技能库（FR-EVO-05~06）
│   │   ├── __init__.py
│   │   ├── forge_codex.py             # ForgeCodex（灵典主入口）
│   │   ├── knowledge_object.py        # KnowledgeObject（知识对象 + frontmatter）
│   │   ├── ember_hierarchy.py         # EvolutionHierarchyManager（五级火种阶梯管理）
│   │   ├── distiller.py               # DualDistiller（双蒸馏：Skill Draft / Method Card）
│   │   ├── eval_ledger.py             # EvalLedger（净增益验证 A/B replay）
│   │   ├── skill_generator.py         # SkillGenerator（三模式自生成 A/B/C）
│   │   └── meta_cognition.py          # MetaCognitionGuard（元认知治理）
│   │
│   ├── tools/                         # 外部工具集成（FR-EVO-07~08）
│   │   ├── __init__.py
│   │   ├── bridge.py                  # ExternalToolBridge（统一桥接入口）
│   │   ├── cli_wrapper.py             # ClaudeCodeWrapper / CodexWrapper / OpenCodeWrapper
│   │   ├── trae_bridge.py             # TraeBridgeWrapper（JSON 文件交换 + 轮询）
│   │   ├── worktree_manager.py        # WorktreeManager（Git worktree 隔离）
│   │   └── audit_logger.py            # ExternalToolAuditLogger（审计日志）
│   │
│   ├── council/                       # 灵议与 A2A（FR-EVO-09~11）
│   │   ├── __init__.py
│   │   ├── forgekin_council.py        # MindCouncil（灵议主入口）
│   │   ├── a2a_manager.py             # A2AManager（@mention 路由 + thread isolation）
│   │   ├── a2a_message.py             # A2AMessage / Mention / Handoff / Artifact 数据模型
│   │   ├── channels/                  # IM 渠道适配器
│   │   │   ├── __init__.py
│   │   │   ├── base.py                # Channel 基类
│   │   │   ├── web_chat.py            # WebChatChannel（灵议主渠道）
│   │   │   ├── feishu.py              # FeishuChannel（飞书）
│   │   │   ├── wechat.py              # WechatChannel（微信）
│   │   │   ├── slack.py               # SlackChannel
│   │   │   ├── discord.py             # DiscordChannel
│   │   │   └── github_pr.py           # GitHubPRChannel（PR 审查 routing）
│   │   └── quietness.py               # QuietnessManager（三开关：muted/behaviorEnabled/hidden）
│   │
│   ├── security/                      # 安全治理
│   │   ├── __init__.py
│   │   ├── forgekin_guard.py          # ForgekinSecurityGuard（安全红线执行）
│   │   └── meta_cognition_guard.py    # MetaCognitionGuard（元认知治理）
│   │
│   └── api/                           # v7.0 API 端点
│       ├── __init__.py
│       ├── forgekin_endpoints.py      # 灵智管理 API
│       ├── council_endpoints.py       # 灵议 API
│       ├── auto_forge_endpoints.py    # 灵锻 API
│       ├── codex_endpoints.py         # 灵典 API
│       └── bridge_endpoints.py        # 外部工具 Bridge API
│
├── config/
│   ├── evolution.yaml                 # ★ v7.0 新增：自进化全局配置
│   ├── forgekin_seeds/                # ★ v7.0 新增：灵智种子配置目录
│   │   ├── flowforge/
│   │   │   ├── master.yaml            # E6 锻师种子
│   │   │   └── reviewer.yaml          # 跨模型评审灵智种子
│   │   ├── devforge/
│   │   │   ├── architect.yaml
│   │   │   ├── coder.yaml
│   │   │   └── test_generator.yaml
│   │   ├── contentforge/
│   │   │   ├── writer.yaml
│   │   │   ├── researcher.yaml
│   │   │   └── seo_specialist.yaml
│   │   └── novelforge/
│   │       ├── plot_architect.yaml
│   │       └── character_designer.yaml
│   ├── a2a_channels.yaml              # ★ v7.0 新增：A2A 渠道配置
│   ├── spirit_forge.yaml                # ★ v7.0 新增：灵锻引擎配置
│   └── external_tools.yaml            # ★ v7.0 新增：外部工具配置
│
├── web/                               # 前端升级
│   └── src/
│       ├── app/
│       │   ├── council/               # ★ v7.0 新增：灵议页面
│       │   │   ├── page.tsx           # 议事大厅
│       │   │   └── components/
│       │   │       ├── ForgekinList.tsx
│       │   │       ├── CouncilChat.tsx
│       │   │       ├── DiaryPanel.tsx
│       │   │       ├── ProvokeBubble.tsx
│       │   │       └── StatusOverview.tsx
│       │   ├── forgekin/              # ★ v7.0 新增：灵智管理页面
│       │   │   ├── page.tsx
│       │   │   └── components/
│       │   │       ├── MindProfileCard.tsx
│       │   │       ├── AscensionTracker.tsx
│       │   │       └── CodexBrowser.tsx
│       │   └── codex/                 # ★ v7.0 新增：灵典页面
│       │       └── page.tsx
│       └── lib/
│           ├── forgekin-api.ts        # ★ v7.0 新增：灵智 API 客户端
│           └── council-ws.ts          # ★ v7.0 新增：灵议 WebSocket 客户端
│
└── migrations/
    ├── 007_forgekin_souls.sql         # ★ v7.0 新增：灵智灵魂表
    ├── 008_forgekin_episodes.sql      # ★ v7.0 新增：灵忆 Episode 表
    ├── 009_forgekin_imprints.sql      # ★ v7.0 新增：灵印画像表
    ├── 010_forge_codex.sql            # ★ v7.0 新增：灵典知识对象表
    ├── 011_forge_diaries.sql          # ★ v7.0 新增：灵锻日记表
    ├── 012_a2a_messages.sql           # ★ v7.0 新增：A2A 消息表
    └── 013_external_tool_audit.sql    # ★ v7.0 新增：外部工具审计表
```

### 15.2 pyproject.toml v7.0 依赖新增

```toml
[project]
version = "7.0.0"
dependencies = [
    # ... v6.0 依赖保留 ...
    "sqlite-vec>=0.1.1",          # v7.0: Mind Echo 向量检索
    "wilson-interval>=1.0",       # v7.0: 元认知 Wilson 下界计算
]

[project.optional-dependencies]
council_feishu = ["lark-oapi>=1.0"]
council_slack = ["slack-sdk>=3.20"]
council_discord = ["discord.py>=2.3"]
evolution_all = ["flowforge[council_feishu,council_slack,council_discord]"]
```

***

## 第十六章：ForgekinEngine 详细设计

### 16.1 数据模型定义

#### 16.1.1 MindProfile（灵魂档案）

```python
# evolution/forgekin/soul_profile.py
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime
from enum import Enum


class AwakeningStage(str, Enum):
    """觉醒阶段 E1-E6"""
    E1_SPARK = "E1"          # 火种：刚诞生
    E2_EMBER = "E2"          # 余烬：≥2 个经验模式
    E3_FLAME = "E3"          # 火焰：能生成 Skill 草稿
    E4_BLAZE = "E4"          # 烈焰：Skill 经验证
    E5_INFERNO = "E5"        # 炽焰：团队标准级
    E6_FORGE_MASTER = "E6"   # 锻师：可创建新灵智


class ForgekinStatus(str, Enum):
    """灵智状态"""
    ACTIVE = "active"
    DORMANT = "dormant"      # 休眠（连拍 3 次 provoke 被拍扁后）
    FROZEN = "frozen"        # 冻结（触碰安全红线）
    REVOKED = "revoked"      # 撤销（operator 明确撤销）


class SoulSpec(BaseModel):
    """灵魂规格——人格定义"""
    persona: str = Field(..., description="第一人称自我描述")
    worldview: str = Field(..., description="世界观——核心价值观")
    values: list[str] = Field(default_factory=list, description="行为准则列表")
    voice: str = Field(default="直接、专业", description="表达风格")


class Capabilities(BaseModel):
    """能力清单——灵智可调用的资源"""
    static_agents_can_delegate: list[str] = Field(
        default_factory=list,
        description="可委托的静态智能体名称列表，如 ['devforge:coder']"
    )
    external_tools_can_use: list[str] = Field(
        default_factory=list,
        description="可调用的外部编码工具，如 ['claude_code', 'trae_bridge']"
    )
    modes_can_use: list[str] = Field(
        default_factory=list,
        description="可使用的执行模式，如 ['reflexion', 'plan_execute']"
    )


class EvolutionState(BaseModel):
    """进化状态——动态追踪"""
    ember_level: str = Field(default="E-L0", description="当前进化阶")
    skills_authored: int = Field(default=0)
    skills_validated: int = Field(default=0)
    episodes_recorded: int = Field(default=0)
    auto_forge_runs: int = Field(default=0)
    last_auto_forge: Optional[datetime] = None
    provoke_fired_today: int = Field(default=0)
    consecutive_dismissed: int = Field(default=0)


class MindProfile(BaseModel):
    """灵智灵魂档案——完整身份定义"""
    forgekin_id: str = Field(..., description="全局唯一标识 fk_{project}_{role}_{seq}")
    name: str = Field(..., description="灵智名称")
    kind: str = Field(..., description="项目前缀:角色名，如 devforge:architect")
    ascension_stage: AwakeningStage = Field(default=AwakeningStage.E1_SPARK)
    birth_at: datetime = Field(default_factory=datetime.now)
    parent_forgekin: Optional[str] = Field(None, description="创建者（E6 才能创建）")

    soul: SoulSpec
    capabilities: Capabilities
    evolution_state: EvolutionState = Field(default_factory=EvolutionState)

    metadata: dict = Field(default_factory=dict)
    status: ForgekinStatus = Field(default=ForgekinStatus.ACTIVE)
```

#### 16.1.2 SoulEpisode（灵忆情景卡）

```python
# evolution/forgekin/episode.py
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class CollaborationPivot(BaseModel):
    """协作转折点——人类提示 → AI 解读 → 效果 → 可迁移教训"""
    human_cue: str = Field(..., description="operator 的原始提示/纠正")
    ai_interpretation: str = Field(..., description="灵智如何理解")
    effect: str = Field(..., description="对任务结果的影响")
    transferable_lesson: Optional[str] = Field(None, description="可迁移的教训")


class SoulEpisode(BaseModel):
    """灵忆情景卡——对标 clowder-ai Episode Card

    6 类协作 context：任务情境/证据地图/推理转折/人类提示点/边界与克制/后续动作
    """
    episode_id: str
    forgekin_id: str
    timestamp: datetime = Field(default_factory=datetime.now)

    task_context: str = Field("", description="任务情境")
    evidence_map: str = Field("", description="证据地图")
    reasoning_pivots: str = Field("", description="推理转折")
    human_cues: list[CollaborationPivot] = Field(default_factory=list)
    boundaries: str = Field("", description="边界与克制")
    follow_ups: list[str] = Field(default_factory=list)

    distillation_status: str = Field(default="raw")
    linked_skills: list[str] = Field(default_factory=list)

    # 元认知三信号
    self_reported_confidence: float = Field(default=0.5)
    domain_reliability: float = Field(default=0.5)
    wilson_lower_bound: float = Field(default=0.0)

    execution_path: str = Field(default="static")
    success: Optional[bool] = None
    latency_ms: Optional[int] = None

    def is_distillable(self) -> bool:
        """是否可蒸馏成 Skill"""
        return (
            self.distillation_status == "raw"
            and len(self.task_context) > 50
            and self.success is not None
        )

    def has_observable_behavior(self) -> bool:
        """是否有可观察行为（用于 Mind Imprint 采集）"""
        return bool(self.task_context or self.human_cues or self.follow_ups)
```

### 16.2 ForgekinEngine 完整实现

```python
# evolution/forgekin/engine.py
import time
import logging
from core.base_agent import AgentInput, AgentOutput
from core.task_context import TaskContext
from core.tracing import get_logger
from evolution.forgekin.soul_profile import MindProfile, ForgekinStatus
from evolution.forgekin.episode import SoulEpisode
from evolution.forgekin.soul_store import MindStore
from evolution.forgekin.echo_store import EchoStore
from evolution.forgekin.imprint_store import ImprintStore
from evolution.codex.forge_codex import ForgeCodex
from evolution.auto_forge.engine import SpiritForgeEngine
from evolution.tools.bridge import ExternalToolBridge, ExternalTask
from evolution.council.a2a_manager import A2AManager
from evolution.forgekin.ascension_manager import AscensionManager
from evolution.forgekin.static_bridge import ForgekinStaticBridge
from evolution.security.forgekin_guard import ForgekinSecurityGuard

logger = get_logger(__name__)


class ForgekinEngine:
    """灵智引擎——自进化的统一入口

    对标 clowder-ai Cat Engine，包装 HybridExecutor，
    在执行前后注入灵魂/记忆/画像，驱动进化闭环。

    核心流程（7 步自进化闭环）：
    1. soul.load()    — 加载灵魂档案
    2. echo.recall()  — 检索相关记忆
    3. imprint.load() — 注入认知画像
    4. build_prompt() — 构建灵魂系统提示
    5. execute()      — 选择路径执行（static/external/trae/mode）
    6. echo.record()  — 记录 Episode
    7. evolve()       — 更新画像 + 蒸馏 Skill + 检查升华
    """

    def __init__(
        self,
        hybrid_executor: "HybridExecutor",
        soul_store: MindStore,
        echo_store: EchoStore,
        imprint_store: ImprintStore,
        codex: ForgeCodex,
        auto_forge_engine: SpiritForgeEngine,
        external_tool_bridge: ExternalToolBridge,
        a2a_manager: A2AManager,
        ascension_manager: AscensionManager,
        static_bridge: ForgekinStaticBridge,
        security_guard: ForgekinSecurityGuard,
    ):
        self._executor = hybrid_executor
        self._soul = soul_store
        self._echo = echo_store
        self._imprint = imprint_store
        self._codex = codex
        self._auto_forge = auto_forge_engine
        self._tools = external_tool_bridge
        self._a2a = a2a_manager
        self._ascension = ascension_manager
        self._static_bridge = static_bridge
        self._guard = security_guard

    async def execute(
        self,
        forgekin_id: str,
        input: AgentInput,
        context: TaskContext,
        execution_strategy: str = "auto",
    ) -> AgentOutput:
        """灵智执行任务的完整自进化闭环"""
        logger.info(f"Forgekin 执行: id={forgekin_id}, task={input.task[:100]}")

        # 1. 加载灵魂档案
        soul = await self._soul.load(forgekin_id)
        if soul.status != ForgekinStatus.ACTIVE:
            raise ForgekinNotActiveError(forgekin_id)

        # 2. 注入灵忆
        episodes = await self._echo.recall(forgekin_id, input.task, limit=5)
        context.state["soul_echo"] = [ep.dict() for ep in episodes]

        # 3. 注入灵印
        imprint = await self._imprint.load(forgekin_id)
        context.state["soul_imprint"] = imprint.dict()

        # 4. 构建灵魂系统提示
        context.system_prompt = (context.system_prompt or "") + "\n\n" + \
            self._build_soul_prompt(soul, imprint, episodes)

        # 5. 选择执行路径
        if execution_strategy == "auto":
            execution_strategy = self._decide_strategy(input, soul)

        # 6. 执行
        start = time.time()
        try:
            if execution_strategy == "static":
                result = await self._delegate_to_static(input, context, soul)
            elif execution_strategy == "external":
                result = await self._call_external_tool(input, context, soul)
            elif execution_strategy == "trae":
                result = await self._call_trae_bridge(input, context, soul)
            else:
                result = await self._executor.run(context)
        except Exception as e:
            logger.error(f"执行失败，降级: {e}")
            result = await self._fallback_to_hybrid(input, context)
        latency_ms = int((time.time() - start) * 1000)

        # 7. 记录 Episode + 进化闭环
        episode = self._build_episode(
            forgekin_id, input, result, context, execution_strategy, latency_ms
        )
        await self._echo.record(episode)
        await self._evolve(forgekin_id, episode)

        return result

    async def _evolve(self, forgekin_id: str, episode: SoulEpisode) -> None:
        """进化闭环"""
        # 更新灵印
        if episode.has_observable_behavior():
            await self._imprint.propose(forgekin_id, episode)
        # 蒸馏 Skill
        if episode.is_distillable():
            await self._codex.maybe_distill(episode)
        # 检查升华
        await self._ascension.check_promotion(forgekin_id)

    def _decide_strategy(self, input: AgentInput, soul: MindProfile) -> str:
        """自动决策执行路径"""
        task = input.task.lower()
        code_kw = ["写代码", "code", "实现", "重构", "refactor", "审查"]
        design_kw = ["架构设计", "技术选型", "design", "方案评估"]
        routine_kw = ["测试", "格式化", "文档", "lint"]

        if any(k in task for k in code_kw) and "claude_code" in soul.capabilities.external_tools_can_use:
            return "external"
        if any(k in task for k in design_kw) and "trae_bridge" in soul.capabilities.external_tools_can_use:
            return "trae"
        if any(k in task for k in routine_kw) and soul.capabilities.static_agents_can_delegate:
            return "static"
        return "mode"

    def _build_soul_prompt(self, soul, imprint, episodes) -> str:
        """构建灵魂系统提示"""
        parts = [
            f"# 你的灵魂档案（Soul Profile）",
            f"- 名称：{soul.name} | 类型：{soul.kind} | 阶段：{soul.ascension_stage.value}",
            f"## 人格\n{soul.soul.persona}",
            f"## 世界观\n{soul.soul.worldview}",
            f"## 行为准则",
        ]
        parts.extend(f"- {v}" for v in soul.soul.values)
        if episodes:
            parts.append(f"## 相关记忆（Mind Echo）")
            for i, ep in enumerate(episodes[:3], 1):
                parts.append(f"{i}. [{ep.timestamp}] {ep.task_context[:200]}")
        if imprint and imprint.structured_fields:
            parts.append(f"## 你对操作者的认知（Mind Imprint）")
            for k, v in imprint.structured_fields.items():
                parts.append(f"- {k}: {v}")
        return "\n".join(parts)

    def _build_episode(self, forgekin_id, input, result, context, path, latency) -> SoulEpisode:
        """构建 Episode"""
        import uuid
        return SoulEpisode(
            episode_id=f"ep_{uuid.uuid4().hex[:12]}",
            forgekin_id=forgekin_id,
            task_context=input.task,
            evidence_map=str(result.metadata.get("evidence", "")),
            reasoning_pivots=str(result.metadata.get("reasoning", "")),
            human_cues=context.state.get("human_cues", []),
            follow_ups=result.metadata.get("follow_ups", []),
            execution_path=path,
            success=(result.status == "success"),
            latency_ms=latency,
            self_reported_confidence=result.metadata.get("confidence", 0.5),
        )

    async def _delegate_to_static(self, input, context, soul) -> AgentOutput:
        """委托静态智能体"""
        agent_name = self._select_static_agent(input, soul)
        return await self._static_bridge.delegate_to_static(
            agent_name, input, context.state,
            context.state.get("acceptance_criteria", {}),
            forgekin_id=soul.forgekin_id,
        )

    def _select_static_agent(self, input, soul) -> str:
        available = soul.capabilities.static_agents_can_delegate
        if not available:
            raise ValueError("灵智无可委托的静态智能体")
        task = input.task.lower()
        for name in available:
            role = name.split(":")[-1] if ":" in name else name
            if role in task:
                return name
        return available[0]

    async def _call_external_tool(self, input, context, soul) -> AgentOutput:
        """调用外部编码工具"""
        await self._guard.check_external_tool(
            soul.forgekin_id, "claude_code",
            context.state.get("workspace", "."),
        )
        task = ExternalTask(
            task_id=context.task_id, instruction=input.task,
            forgekin_id=soul.forgekin_id, context_snapshot=context.state,
        )
        result = await self._tools.execute(
            "claude_code", task,
            context.state.get("workspace", "."), soul.forgekin_id,
        )
        return AgentOutput(
            result={"output": result.output},
            status="success" if result.exit_code == 0 else "failure",
            metadata={"exit_code": result.exit_code, "tool": "claude_code"},
        )

    async def _call_trae_bridge(self, input, context, soul) -> AgentOutput:
        """调用 Trae Bridge"""
        task = ExternalTask(
            task_id=context.task_id, instruction=input.task,
            forgekin_id=soul.forgekin_id, context_snapshot=context.state,
            task_type="design_or_review",
        )
        result = await self._tools.execute(
            "trae_bridge", task,
            context.state.get("workspace", "."), soul.forgekin_id,
        )
        return AgentOutput(
            result={"output": result.output},
            status="success" if result.exit_code == 0 else "failure",
            metadata={"exit_code": result.exit_code, "tool": "trae_bridge"},
        )

    async def _fallback_to_hybrid(self, input, context) -> AgentOutput:
        """降级到 HybridExecutor"""
        logger.warning("降级到 HybridExecutor")
        return await self._executor.run(context)


class ForgekinNotActiveError(Exception):
    """灵智未激活异常"""
    pass
```

### 16.3 MindStore 详细实现

```python
# evolution/forgekin/soul_store.py
import json
import aiosqlite
from datetime import datetime
from evolution.forgekin.soul_profile import (
    MindProfile, SoulSpec, Capabilities, EvolutionState,
    AwakeningStage, ForgekinStatus,
)


class MindStore:
    """灵智灵魂档案存储——SQLite 持久化

    表结构见 migrations/007_forgekin_souls.sql
    """

    def __init__(self, db_path: str):
        self._db_path = db_path

    async def create(self, profile: MindProfile) -> str:
        """创建新灵智（需 E6 权限或 operator）"""
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(
                """INSERT INTO forgekin_souls
                (forgekin_id, name, kind, ascension_stage, birth_at,
                 parent_forgekin, soul_profile, capabilities,
                 evolution_state, metadata, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (profile.forgekin_id, profile.name, profile.kind,
                 profile.ascension_stage.value, profile.birth_at.isoformat(),
                 profile.parent_forgekin, profile.soul.model_dump_json(),
                 profile.capabilities.model_dump_json(),
                 profile.evolution_state.model_dump_json(),
                 json.dumps(profile.metadata), profile.status.value),
            )
            await db.commit()
        return profile.forgekin_id

    async def load(self, forgekin_id: str) -> MindProfile:
        """加载灵魂档案"""
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT * FROM forgekin_souls WHERE forgekin_id = ?",
                (forgekin_id,),
            )
            row = await cursor.fetchone()
            if not row:
                raise ValueError(f"灵智不存在: {forgekin_id}")
            return MindProfile(
                forgekin_id=row["forgekin_id"], name=row["name"],
                kind=row["kind"],
                ascension_stage=AwakeningStage(row["ascension_stage"]),
                birth_at=datetime.fromisoformat(row["birth_at"]),
                parent_forgekin=row["parent_forgekin"],
                soul=SoulSpec.model_validate_json(row["soul_profile"]),
                capabilities=Capabilities.model_validate_json(row["capabilities"]),
                evolution_state=EvolutionState.model_validate_json(row["evolution_state"]),
                metadata=json.loads(row["metadata"]),
                status=ForgekinStatus(row["status"]),
            )

    async def update(self, forgekin_id: str, updates: dict) -> None:
        """更新档案"""
        async with aiosqlite.connect(self._db_path) as db:
            for key, value in updates.items():
                if key in ("name", "kind", "ascension_stage", "status"):
                    await db.execute(
                        f"UPDATE forgekin_souls SET {key} = ? WHERE forgekin_id = ?",
                        (value, forgekin_id),
                    )
            await db.commit()

    async def set_status(self, forgekin_id: str, status: str, approver: str) -> None:
        """设置状态——需 operator 审批"""
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(
                "UPDATE forgekin_souls SET status = ? WHERE forgekin_id = ?",
                (status, forgekin_id),
            )
            await db.commit()

    async def list_by_project(self, project: str) -> list[MindProfile]:
        """按项目列出活跃灵智"""
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT forgekin_id FROM forgekin_souls WHERE kind LIKE ? AND status = 'active'",
                (f"{project}:%",),
            )
            rows = await cursor.fetchall()
            return [await self.load(r["forgekin_id"]) for r in rows]

    async def update_evolution_state(
        self, forgekin_id: str, state: EvolutionState
    ) -> None:
        """更新进化状态"""
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(
                "UPDATE forgekin_souls SET evolution_state = ? WHERE forgekin_id = ?",
                (state.model_dump_json(), forgekin_id),
            )
            await db.commit()
```

### 16.4 EchoStore（灵忆三层记忆）详细实现

```python
# evolution/forgekin/echo_store.py
import json
import sqlite_vec
import aiosqlite
from datetime import datetime, timedelta
from evolution.forgekin.episode import SoulEpisode


class EchoStore:
    """灵忆存储——三层记忆架构

    对标 clowder-ai Memory + MemGPT 三层记忆：
    - L1 工作记忆：当前会话上下文（内存，会话级）
    - L2 情景记忆：最近 100 个 Episode（SQLite + 向量索引）
    - L3 语义记忆：永不淘汰的长期知识（Mind Codex）

    L2 检索策略：向量相似度(0.5) + 关键词匹配(0.3) + 时间衰减(0.2)
    """

    L2_MAX_EPISODES = 100

    def __init__(self, db_path: str, llm_client=None):
        self._db_path = db_path
        self._llm = llm_client
        self._working_memory: dict[str, list[SoulEpisode]] = {}

    # ===== L1 工作记忆 =====

    async def working_set(self, forgekin_id: str) -> list[SoulEpisode]:
        return self._working_memory.get(forgekin_id, [])

    async def working_push(self, forgekin_id: str, episode: SoulEpisode) -> None:
        self._working_memory.setdefault(forgekin_id, []).append(episode)

    async def working_compact(self, forgekin_id: str) -> SoulEpisode:
        """会话结束时压缩工作记忆为 L2 Episode"""
        working = self._working_memory.get(forgekin_id, [])
        if not working:
            return None
        summary = f"压缩了 {len(working)} 个 Episode"
        if self._llm:
            summary = await self._llm.chat(
                system="将多个 Episode 压缩成摘要。",
                user_content=json.dumps([ep.dict() for ep in working], ensure_ascii=False),
            )
        compacted = SoulEpisode(
            episode_id=f"ep_compact_{forgekin_id}_{datetime.now().timestamp()}",
            forgekin_id=forgekin_id,
            task_context=f"[会话压缩] {summary}",
        )
        self._working_memory[forgekin_id] = []
        await self.record(compacted)
        return compacted

    # ===== L2 情景记忆 =====

    async def record(self, episode: SoulEpisode) -> str:
        """记录 Episode 到 L2"""
        embedding = await self._generate_embedding(episode)
        async with aiosqlite.connect(self._db_path) as db:
            await db.enable_load_extension(True)
            sqlite_vec.load(db)
            await db.execute(
                """INSERT INTO forgekin_episodes
                (episode_id, forgekin_id, timestamp, task_context,
                 evidence_map, reasoning_pivots, human_cues, boundaries,
                 follow_ups, distillation_status, linked_skills,
                 self_reported_confidence, domain_reliability,
                 wilson_lower_bound, embedding, execution_path,
                 success, latency_ms)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (episode.episode_id, episode.forgekin_id,
                 episode.timestamp.isoformat(), episode.task_context,
                 episode.evidence_map, episode.reasoning_pivots,
                 json.dumps([c.dict() for c in episode.human_cues]),
                 episode.boundaries, json.dumps(episode.follow_ups),
                 episode.distillation_status, json.dumps(episode.linked_skills),
                 episode.self_reported_confidence, episode.domain_reliability,
                 episode.wilson_lower_bound, embedding, episode.execution_path,
                 episode.success, episode.latency_ms),
            )
            await db.commit()
        await self._enforce_l2_limit(episode.forgekin_id)
        return episode.episode_id

    async def recall(self, forgekin_id: str, query: str, limit: int = 5) -> list[SoulEpisode]:
        """按相关性检索（向量 + 关键词 + 时间衰减）"""
        query_emb = await self._generate_query_embedding(query)
        async with aiosqlite.connect(self._db_path) as db:
            await db.enable_load_extension(True)
            sqlite_vec.load(db)
            cursor = await db.execute(
                """SELECT *, vec_distance(embedding, ?) as vec_dist
                FROM forgekin_episodes WHERE forgekin_id = ?
                ORDER BY vec_dist ASC LIMIT ?""",
                (query_emb, forgekin_id, limit * 2),
            )
            rows = await cursor.fetchall()

        episodes = []
        for row in rows:
            ep = await self._row_to_episode(row)
            time_decay = self._time_decay(ep.timestamp)
            kw_score = self._keyword_match(query, ep.task_context)
            vec_score = 1.0 - row[-1]
            ep._recall_score = 0.5 * vec_score + 0.3 * kw_score + 0.2 * time_decay
            episodes.append(ep)
        episodes.sort(key=lambda e: e._recall_score, reverse=True)
        return episodes[:limit]

    async def count_recent_episodes(self, forgekin_id: str, hours: int = 24) -> int:
        """统计最近 N 小时 Episode 数（灵锻触发条件）"""
        cutoff = (datetime.now() - timedelta(hours=hours)).isoformat()
        async with aiosqlite.connect(self._db_path) as db:
            cursor = await db.execute(
                "SELECT COUNT(*) FROM forgekin_episodes WHERE forgekin_id = ? AND timestamp > ?",
                (forgekin_id, cutoff),
            )
            row = await cursor.fetchone()
            return row[0] if row else 0

    async def recall_peer_traces(self, forgekin_id: str, hours: int = 24) -> list[SoulEpisode]:
        """读小伙伴的留痕（灵锻用）"""
        cutoff = (datetime.now() - timedelta(hours=hours)).isoformat()
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT * FROM forgekin_episodes WHERE forgekin_id != ? AND timestamp > ? "
                "ORDER BY timestamp DESC LIMIT 20",
                (forgekin_id, cutoff),
            )
            rows = await cursor.fetchall()
            return [await self._row_to_episode(r) for r in rows]

    # ===== L3 语义记忆 =====

    async def archive(self, episode_id: str) -> str:
        """归档到 L3（Mind Codex）"""
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(
                "UPDATE forgekin_episodes SET distillation_status = 'archived' WHERE episode_id = ?",
                (episode_id,),
            )
            await db.commit()
        return episode_id

    # ===== 辅助方法 =====

    async def _generate_embedding(self, episode: SoulEpisode) -> bytes:
        if self._llm:
            text = f"{episode.task_context} {episode.reasoning_pivots}"
            return await self._llm.embed(text)
        return b"\x00" * 128

    async def _generate_query_embedding(self, query: str) -> bytes:
        if self._llm:
            return await self._llm.embed(query)
        return b"\x00" * 128

    def _time_decay(self, timestamp: datetime) -> float:
        hours = (datetime.now() - timestamp).total_seconds() / 3600
        return max(0.0, 1.0 - hours / (24 * 30))

    def _keyword_match(self, query: str, text: str) -> float:
        q_words = set(query.lower().split())
        t_words = set(text.lower().split())
        if not q_words:
            return 0.0
        return len(q_words & t_words) / len(q_words)

    async def _enforce_l2_limit(self, forgekin_id: str) -> None:
        """LRU 淘汰——保持 L2 ≤ 100"""
        async with aiosqlite.connect(self._db_path) as db:
            cursor = await db.execute(
                "SELECT COUNT(*) FROM forgekin_episodes WHERE forgekin_id = ?",
                (forgekin_id,),
            )
            count = (await cursor.fetchone())[0]
            if count > self.L2_MAX_EPISODES:
                excess = count - self.L2_MAX_EPISODES
                await db.execute(
                    "DELETE FROM forgekin_episodes WHERE episode_id IN "
                    "(SELECT episode_id FROM forgekin_episodes "
                    "WHERE forgekin_id = ? ORDER BY timestamp ASC LIMIT ?)",
                    (forgekin_id, excess),
                )
                await db.commit()
```

### 16.5 ImprintStore（灵印认知画像）详细实现

```python
# evolution/forgekin/imprint_store.py
import json
import uuid
import aiosqlite
from datetime import datetime
from pydantic import BaseModel, Field
from typing import Optional
from evolution.forgekin.episode import SoulEpisode

# ★★★ no-classifier 红线：白名单采集字段 ★★★
WHITELIST_FIELDS = {
    "task_types", "success_rate", "tool_usage",
    "collaboration_patterns", "time_preferences",
}

# ★★★ 禁止采集字段 ★★★
FORBIDDEN_FIELDS = {
    "personal_preferences", "emotional_state",
    "political_views", "religious_views", "value_judgments",
}


class SoulImprint(BaseModel):
    """灵印——认知画像（双层结构）"""
    forgekin_id: str
    structured_fields: dict = Field(default_factory=dict, description="结构化字段（白名单）")
    cat_note: str = Field(default="", description="主观日记（灵锻产出）")
    last_updated: Optional[datetime] = None


class ImprintStore:
    """灵印存储——认知画像

    ★★★ no-classifier 红线 ★★★
    禁止后台 classifier 自动画像，必须基于显式行为。
    只能采集 WHITELIST_FIELDS 中的字段。
    """

    def __init__(self, db_path: str):
        self._db_path = db_path

    async def load(self, forgekin_id: str) -> SoulImprint:
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT * FROM forgekin_imprints WHERE forgekin_id = ?",
                (forgekin_id,),
            )
            row = await cursor.fetchone()
            if not row:
                return SoulImprint(forgekin_id=forgekin_id)
            return SoulImprint(
                forgekin_id=row["forgekin_id"],
                structured_fields=json.loads(row["structured_fields"]),
                cat_note=row["cat_note"],
                last_updated=datetime.fromisoformat(row["last_updated"]) if row["last_updated"] else None,
            )

    async def propose(self, forgekin_id: str, episode: SoulEpisode) -> list[str]:
        """提交画像更新提案（白名单采集 + 分层消化）"""
        proposals = []
        # task_types
        if episode.task_context:
            proposals.append(await self._create_proposal(
                forgekin_id, "task_types", episode.task_context[:100], episode.episode_id))
        # success_rate
        if episode.success is not None:
            proposals.append(await self._create_proposal(
                forgekin_id, "success_rate",
                {"success": episode.success, "domain": episode.execution_path},
                episode.episode_id))
        # tool_usage
        if episode.execution_path in ("external", "trae"):
            proposals.append(await self._create_proposal(
                forgekin_id, "tool_usage", episode.execution_path, episode.episode_id))
        return proposals

    async def approve(self, proposal_id: str, approver: str) -> None:
        """operator 审批画像提案"""
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT * FROM imprint_proposals WHERE proposal_id = ?",
                (proposal_id,),
            )
            row = await cursor.fetchone()
            if not row:
                raise ValueError(f"提案不存在: {proposal_id}")

            # ★ 红线检查
            field_name = row["field_name"]
            if field_name not in WHITELIST_FIELDS:
                raise SecurityError(f"禁止采集字段: {field_name}")

            # 更新画像
            imprint = await self.load(row["forgekin_id"])
            current = imprint.structured_fields.get(field_name, {})
            proposed = json.loads(row["proposed_value"])

            if field_name == "task_types":
                tasks = current if isinstance(current, list) else []
                tasks.append(proposed)
                imprint.structured_fields[field_name] = tasks[-50:]
            elif field_name == "success_rate":
                stats = current if isinstance(current, dict) else {}
                domain = proposed.get("domain", "unknown")
                ds = stats.get(domain, {"successes": 0, "trials": 0})
                ds["trials"] += 1
                if proposed.get("success"):
                    ds["successes"] += 1
                stats[domain] = ds
                imprint.structured_fields[field_name] = stats
            else:
                imprint.structured_fields[field_name] = proposed

            imprint.last_updated = datetime.now()
            await db.execute(
                "INSERT OR REPLACE INTO forgekin_imprints "
                "(forgekin_id, structured_fields, cat_note, last_updated) VALUES (?,?,?,?)",
                (imprint.forgekin_id, json.dumps(imprint.structured_fields),
                 imprint.cat_note, imprint.last_updated.isoformat()),
            )
            await db.execute(
                "UPDATE imprint_proposals SET status = 'approved', approved_by = ? WHERE proposal_id = ?",
                (approver, proposal_id),
            )
            await db.commit()

    async def update_cat_note(self, forgekin_id: str, note: str) -> None:
        """更新主观日记（灵锻产出，不需审批）"""
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(
                "UPDATE forgekin_imprints SET cat_note = ?, last_updated = ? WHERE forgekin_id = ?",
                (note, datetime.now().isoformat(), forgekin_id),
            )
            await db.commit()

    async def _create_proposal(self, forgekin_id, field_name, value, source_ep) -> str:
        pid = f"imp_{uuid.uuid4().hex[:12]}"
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(
                "INSERT INTO imprint_proposals "
                "(proposal_id, forgekin_id, field_name, proposed_value, source_episode_id, status, created_at) "
                "VALUES (?,?,?,?,?,?,?)",
                (pid, forgekin_id, field_name, json.dumps(value, default=str),
                 source_ep, "pending", datetime.now().isoformat()),
            )
            await db.commit()
        return pid


class SecurityError(Exception):
    """安全红线违规"""
    pass
```

### 16.6 AscensionManager（觉醒阶段管理）详细实现

```python
# evolution/forgekin/ascension_manager.py
import logging
from evolution.forgekin.soul_store import MindStore
from evolution.forgekin.echo_store import EchoStore
from evolution.codex.forge_codex import ForgeCodex
from evolution.forgekin.soul_profile import AwakeningStage, ForgekinStatus, EvolutionState

logger = logging.getLogger(__name__)


class AscensionManager:
    """觉醒阶段管理器——E1-E6 晋升/降级/冻结

    | 阶段 | 晋升条件 | 降级/冻结 |
    |------|---------|-----------|
    | E1→E2 | ≥2 个相似 Episode | — |
    | E2→E3 | smoke gate ≥3 cases | — |
    | E3→E4 | ≥6 uses, ≥80% | 最近 3 次 <50% → E2 |
    | E4→E5 | ≥12 uses, ≥90%, operator 批准 | 最近 5 次 <60% → E3 |
    | E5 freeze | — | 1 次高风险越界 |
    | E6 revoke | — | operator 撤销 |
    """

    def __init__(self, soul_store: MindStore, echo_store: EchoStore,
                 codex: ForgeCodex, event_bus=None):
        self._soul = soul_store
        self._echo = echo_store
        self._codex = codex
        self._events = event_bus

    async def check_promotion(self, forgekin_id: str):
        """检查升华条件"""
        soul = await self._soul.load(forgekin_id)
        if soul.status != ForgekinStatus.ACTIVE:
            return None

        stage = soul.ascension_stage
        new_stage = None

        if stage == AwakeningStage.E1_SPARK:
            new_stage = await self._check_e1_to_e2(forgekin_id, soul.evolution_state)
        elif stage == AwakeningStage.E2_EMBER:
            new_stage = await self._check_e2_to_e3(forgekin_id)
        elif stage == AwakeningStage.E3_FLAME:
            new_stage = await self._check_e3_to_e4(forgekin_id)
            await self._check_e3_demotion(forgekin_id)
        elif stage == AwakeningStage.E4_BLAZE:
            await self._check_e4_to_e5(forgekin_id)
            await self._check_e4_demotion(forgekin_id)
        elif stage == AwakeningStage.E5_INFERNO:
            await self._check_e5_freeze(forgekin_id)

        if new_stage and new_stage != stage:
            await self._promote(forgekin_id, stage, new_stage)
            return new_stage.value
        return None

    async def _check_e1_to_e2(self, fk_id, state) -> AwakeningStage | None:
        if state.episodes_recorded >= 2:
            episodes = await self._echo.recall(fk_id, "recent", limit=10)
            if len(episodes) >= 2:
                return AwakeningStage.E2_EMBER
        return None

    async def _check_e2_to_e3(self, fk_id) -> AwakeningStage | None:
        count = await self._codex.count_skills_by_level(fk_id, "E-L2")
        if count >= 3:
            return AwakeningStage.E3_FLAME
        return None

    async def _check_e3_to_e4(self, fk_id) -> AwakeningStage | None:
        uses = await self._codex.count_skill_uses(fk_id)
        rate = await self._codex.compute_success_rate(fk_id)
        if uses >= 6 and rate >= 0.8:
            return AwakeningStage.E4_BLAZE
        return None

    async def _check_e4_to_e5(self, fk_id) -> None:
        uses = await self._codex.count_skill_uses(fk_id)
        rate = await self._codex.compute_recent_success_rate(fk_id, 10)
        if uses >= 12 and rate >= 0.9 and self._events:
            await self._events.publish("forgekin.ascension_pending", {
                "forgekin_id": fk_id, "from": "E4", "to": "E5",
                "uses": uses, "rate": rate,
            })

    async def _check_e3_demotion(self, fk_id) -> None:
        rate = await self._codex.compute_recent_success_rate(fk_id, 3)
        if rate < 0.5:
            await self._demote(fk_id, AwakeningStage.E3_FLAME, AwakeningStage.E2_EMBER,
                               f"最近 3 次成功率 {rate:.0%} < 50%")

    async def _check_e4_demotion(self, fk_id) -> None:
        rate = await self._codex.compute_recent_success_rate(fk_id, 5)
        if rate < 0.6:
            await self._demote(fk_id, AwakeningStage.E4_BLAZE, AwakeningStage.E3_FLAME,
                               f"最近 5 次成功率 {rate:.0%} < 60%")

    async def _check_e5_freeze(self, fk_id) -> None:
        """E5 freeze: 1 次高风险越界（由 SecurityGuard 触发）"""
        pass

    async def _promote(self, fk_id, from_s, to_s) -> None:
        await self._soul.update(fk_id, {"ascension_stage": to_s.value})
        logger.info(f"灵智 {fk_id} 升华: {from_s.value} → {to_s.value}")
        if self._events:
            await self._events.publish("forgekin.ascension_changed",
                                       {"forgekin_id": fk_id, "from": from_s.value, "to": to_s.value})

    async def _demote(self, fk_id, from_s, to_s, reason) -> None:
        await self._soul.update(fk_id, {"ascension_stage": to_s.value})
        logger.warning(f"灵智 {fk_id} 降级: {from_s.value} → {to_s.value}（{reason}）")
        if self._events:
            await self._events.publish("forgekin.ascension_changed",
                                       {"forgekin_id": fk_id, "from": from_s.value, "to": to_s.value, "reason": reason})
```

### 16.7 ForgekinStaticBridge（两类智能体衔接）详细实现

```python
# evolution/forgekin/static_bridge.py
import logging
from core.base_agent import AgentInput, AgentOutput
from engine.agent_registry import AgentRegistry
from evolution.forgekin.echo_store import EchoStore
from evolution.forgekin.imprint_store import ImprintStore
from evolution.forgekin.episode import SoulEpisode

logger = logging.getLogger(__name__)


class ForgekinStaticBridge:
    """灵智与静态智能体的衔接桥

    ★ 单向依赖红线 ★
    静态智能体不知道 Forgekin 的存在。
    Forgekin 通过此桥委托静态智能体执行子任务。
    """

    def __init__(self, agent_registry: AgentRegistry,
                 echo_store: EchoStore, imprint_store: ImprintStore):
        self._registry = agent_registry
        self._echo = echo_store
        self._imprint = imprint_store

    async def delegate_to_static(
        self, static_agent_name: str, input: AgentInput,
        context_snapshot: dict, acceptance_criteria: dict,
        forgekin_id: str = None,
    ) -> AgentOutput:
        """灵智委托静态智能体执行子任务

        流程：路由→执行→回写 Mind Echo→更新 Mind Imprint
        """
        logger.info(f"委托静态智能体: {static_agent_name}, task={input.task[:80]}")

        # 1. 获取静态智能体
        agent = self._registry.get(static_agent_name)
        if not agent:
            raise ValueError(f"静态智能体未注册: {static_agent_name}")

        # 2. 执行（静态智能体不知道 Forgekin 存在）
        result = await agent.execute(input)

        # 3. 结果回写 Mind Echo
        if forgekin_id:
            episode = SoulEpisode(
                episode_id=f"ep_del_{forgekin_id}_{input.task[:20]}",
                forgekin_id=forgekin_id,
                task_context=f"[委托 {static_agent_name}] {input.task}",
                evidence_map=str(result.result),
                execution_path="static",
                success=(result.status == "success"),
            )
            await self._echo.record(episode)
            # 4. 更新 Mind Imprint
            if episode.has_observable_behavior():
                await self._imprint.propose(forgekin_id, episode)

        # 5. 验收标准检查
        if acceptance_criteria and result.status == "success":
            result.metadata["acceptance_validation"] = self._validate(result, acceptance_criteria)

        return result

    def _validate(self, result: AgentOutput, criteria: dict) -> dict:
        validation = {}
        for key, expected in criteria.items():
            actual = result.result.get(key)
            validation[key] = {"expected": expected, "actual": actual, "passed": actual == expected}
        return validation
```

***

## 第十七章：SpiritForge Engine 详细设计

### 17.1 双层架构实现

```python
# evolution/auto_forge/engine.py
import asyncio
import logging
from datetime import datetime
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from evolution.forgekin.echo_store import EchoStore
from evolution.forgekin.imprint_store import ImprintStore
from evolution.forgekin.soul_store import MindStore
from evolution.codex.forge_codex import ForgeCodex
from evolution.auto_forge.consolidation import ConsolidationLayer
from evolution.auto_forge.surface import SurfaceLayer
from evolution.auto_forge.provoke_manager import ProvokeManager
from evolution.auto_forge.group_forge import GroupForgeOrchestrator
from evolution.auto_forge.diary_store import ForgeDiaryStore

logger = logging.getLogger(__name__)


class SpiritForgeConfig:
    """灵锻配置"""
    def __init__(self, config: dict):
        self.enabled = config.get("enabled", False)
        self.check_interval_minutes = config.get("check_interval_minutes", 30)
        self.min_traces_to_forge = config.get("min_traces_to_forge", 5)
        self.low_activity_hours = config.get("low_activity_hours", [22,23,0,1,2,3,4,5,6])
        self.group_forge_enabled = config.get("group_forge_enabled", True)
        self.max_forgekins_per_group = config.get("max_forgekins_per_group", 3)
        self.provoke_max_per_day = config.get("provoke", {}).get("max_per_day", 1)
        self.provoke_dormancy_days = config.get("provoke", {}).get("dormancy_days", 7)


class SpiritForgeEngine:
    """灵锻引擎——无人驱动时的自主思考与进化

    对标 clowder-ai F255 Auto-Dream 双层架构：
    - 后台 Consolidation 层：读留痕→画线联想→产出日记+Imprint proposal
    - 前台 Surface 层：日记本+Provoke 气泡（经事件总线→Web UI）
    """

    def __init__(
        self,
        echo_store: EchoStore,
        imprint_store: ImprintStore,
        soul_store: MindStore,
        codex: ForgeCodex,
        event_bus,
        llm_client,
        config: SpiritForgeConfig,
    ):
        self._echo = echo_store
        self._imprint = imprint_store
        self._soul = soul_store
        self._codex = codex
        self._events = event_bus
        self._llm = llm_client
        self._config = config

        self._diary_store = ForgeDiaryStore(llm_client)
        self._consolidation = ConsolidationLayer(
            echo_store, imprint_store, llm_client, self._diary_store
        )
        self._provoke = ProvokeManager(event_bus, soul_store, config)
        self._group_forge = GroupForgeOrchestrator(
            echo_store, llm_client, self._diary_store
        )
        self._surface = SurfaceLayer(event_bus)
        self._scheduler = AsyncIOScheduler()

    def start(self):
        """启动灵锻调度器"""
        if not self._config.enabled:
            logger.info("灵锻引擎未启用")
            return
        self._scheduler.add_job(
            self._check_and_forge,
            trigger="interval",
            minutes=self._config.check_interval_minutes,
            id="auto_forge_check",
        )
        self._scheduler.start()
        logger.info(f"灵锻引擎已启动，检查间隔 {self._config.check_interval_minutes} 分钟")

    def stop(self):
        """停止灵锻"""
        self._scheduler.shutdown(wait=False)
        logger.info("灵锻引擎已停止")

    async def _check_and_forge(self):
        """检查触发条件并执行灵锻"""
        # 条件 1: 低活动期
        if not self._is_low_activity_period():
            return

        # 条件 2: 活跃灵智有足够留痕
        active_forgekins = await self._get_active_forgekins()
        for fk_id in active_forgekins:
            trace_count = await self._echo.count_recent_episodes(fk_id, hours=24)
            if trace_count >= self._config.min_traces_to_forge:
                await self._forge_single(fk_id)

        # 条件 3: 群体灵锻
        if self._config.group_forge_enabled and len(active_forgekins) >= 2:
            await self._group_forge_run(active_forgekins)

    def _is_low_activity_period(self) -> bool:
        """检查是否低活动期（夜间/空闲）"""
        hour = datetime.now().hour
        return hour in self._config.low_activity_hours

    async def _get_active_forgekins(self) -> list[str]:
        """获取所有活跃灵智"""
        # 从 MindStore 查询所有活跃灵智
        # 简化实现：返回有近期 Episode 的灵智
        async with aiosqlite.connect(self._echo._db_path) as db:
            cursor = await db.execute(
                "SELECT DISTINCT forgekin_id FROM forgekin_episodes "
                "WHERE timestamp > ?",
                ((datetime.now() - timedelta(hours=24)).isoformat(),),
            )
            rows = await cursor.fetchall()
            return [r[0] for r in rows]

    async def _forge_single(self, forgekin_id: str):
        """单灵智灵锻流程——对标 clowder-ai 做梦流程"""
        logger.info(f"启动单灵智灵锻: {forgekin_id}")

        # 1. Entry: 读最近的留痕
        diary = await self._consolidation.forge(forgekin_id)

        if diary:
            # 2. 更新进化状态
            soul = await self._soul.load(forgekin_id)
            soul.evolution_state.auto_forge_runs += 1
            soul.evolution_state.last_auto_forge = datetime.now()
            await self._soul.update_evolution_state(forgekin_id, soul.evolution_state)

            # 3. 偶尔 fire Provoke
            provoke = await self._provoke.fire(forgekin_id, diary)
            if provoke:
                logger.info(f"Provoke 已投递: {forgekin_id}")

            # 4. 通知前台 Surface
            await self._surface.notify_diary_ready(forgekin_id, diary)

    async def _group_forge_run(self, forgekin_ids: list[str]):
        """群体灵锻——多灵智协作做梦"""
        # 限制群大小
        group = forgekin_ids[:self._config.max_forgekins_per_group]
        logger.info(f"启动群体灵锻: {group}")
        diaries = await self._group_forge.forge(group)
        for diary in diaries:
            await self._surface.notify_diary_ready(diary.forgekin_id, diary)
```

### 17.2 ConsolidationLayer（后台整合层）

```python
# evolution/auto_forge/consolidation.py
import logging
from datetime import datetime
from evolution.forgekin.echo_store import EchoStore
from evolution.forgekin.imprint_store import ImprintStore

logger = logging.getLogger(__name__)


class ForgeDiary:
    """灵锻日记——第一人称沉淀"""
    def __init__(self, forgekin_id: str, content: str,
                 observations: list = None, provoke_content: str = None):
        self.forgekin_id = forgekin_id
        self.content = content
        self.observations = observations or []
        self.provoke_content = provoke_content
        self.timestamp = datetime.now()
        self.has_observations = bool(observations)

    def to_dict(self) -> dict:
        return {
            "forgekin_id": self.forgekin_id,
            "content": self.content,
            "observations": self.observations,
            "provoke_content": self.provoke_content,
            "timestamp": self.timestamp.isoformat(),
        }


class ConsolidationLayer:
    """后台整合层——对标 clowder-ai Auto-Dream Consolidation

    流程（对标 clowder-ai 做梦流程）：
    1. Entry: 读最近的留痕
    2. 读脚印: 读平行世界的自己 + 小伙伴的留痕
    3. 画线: 联想画线，串联关联
    4. 写日记: 第一人称沉淀
    5. 产出 Mind Imprint proposal
    """

    def __init__(self, echo_store: EchoStore, imprint_store: ImprintStore,
                 llm_client, diary_store):
        self._echo = echo_store
        self._imprint = imprint_store
        self._llm = llm_client
        self._diary_store = diary_store

    async def forge(self, forgekin_id: str) -> ForgeDiary:
        """执行单灵智灵锻"""
        # 1. 读自己的留痕
        my_episodes = await self._echo.recall(forgekin_id, "recent", limit=20)

        # 2. 读小伙伴的留痕
        peer_episodes = await self._echo.recall_peer_traces(forgekin_id, hours=24)

        # 3. 画线——LLM 联想
        connections = await self._draw_connections(my_episodes, peer_episodes)

        # 4. 写日记
        diary = await self._write_diary(forgekin_id, connections)

        # 5. 产出 Imprint proposal
        if diary.has_observations:
            await self._imprint.update_cat_note(forgekin_id, diary.content)
            logger.debug(f"日记已更新到灵印: {forgekin_id}")

        # 6. 存储日记
        await self._diary_store.save(diary)

        return diary

    async def _draw_connections(self, my_episodes, peer_episodes) -> str:
        """画线——LLM 联想画线，串联关联"""
        prompt = f"""你是灵智的灵锻引擎。请分析以下留痕，找出关联和线索。

我的最近留痕：
{self._format_episodes(my_episodes[:10])}

小伙伴的最近留痕：
{self._format_episodes(peer_episodes[:10])}

请画出这些留痕之间的关联线，发现可能被忽略的模式。输出格式：
- 关联 1: ...
- 关联 2: ...
"""
        if self._llm:
            return await self._llm.chat(system="你是灵锻画线器", user_content=prompt)
        return "（LLM 不可用，跳过画线）"

    async def _write_diary(self, forgekin_id: str, connections: str) -> ForgeDiary:
        """写日记——第一人称沉淀"""
        prompt = f"""基于以下画线分析，以第一人称写一篇灵锻日记。

画线分析：
{connections}

要求：
1. 第一人称（"我今天发现..."）
2. 含画线，非流水账
3. 产出对操作者的观察（如果有）
4. 200-500 字
"""
        if self._llm:
            content = await self._llm.chat(system="你是灵智的日记人格", user_content=prompt)
        else:
            content = f"今天灵锻了，分析了 {len(connections)} 个关联。"

        # 提取观察
        observations = self._extract_observations(content)

        # 构造 Provoke 内容（偶尔）
        provoke = None
        if self._should_provoke():
            provoke = self._generate_provoke_content(content)

        return ForgeDiary(
            forgekin_id=forgekin_id,
            content=content,
            observations=observations,
            provoke_content=provoke,
        )

    def _format_episodes(self, episodes) -> str:
        return "\n".join(
            f"- [{ep.timestamp}] {ep.task_context[:100]}" for ep in episodes
        )

    def _extract_observations(self, content: str) -> list[str]:
        """从日记中提取对操作者的观察"""
        observations = []
        for line in content.split("\n"):
            if "观察" in line or "发现" in line:
                observations.append(line.strip())
        return observations[:3]

    def _should_provoke(self) -> bool:
        """是否生成 Provoke（概率控制）"""
        import random
        return random.random() < 0.2  # 20% 概率

    def _generate_provoke_content(self, diary: str) -> str:
        """生成 Provoke 内容——内容野，边界硬"""
        # 从日记中提取一个认知侧滑点
        lines = diary.split("\n")
        return lines[0][:100] if lines else None
```

### 17.3 ProvokeManager（沙砾气泡投递）

```python
# evolution/auto_forge/provoke_manager.py
import logging
from datetime import datetime, timedelta
from evolution.auto_forge.consolidation import ForgeDiary

logger = logging.getLogger(__name__)

# ★ Provoke 边界硬：禁止内容
FORBIDDEN_PROVOKE_KEYWORDS = [
    "投资建议", "感情建议", "健康诊断", "价值判断",
    "你应该", "你必须", "你需要",  # 不给直接建议
]


class ProvokeManager:
    """Provoke 沙砾气泡管理器

    ★ 频率硬限 ★
    - 每天 ≤1
    - hyperfocus=0（专注模式不投递）
    - 连拍 3 次冬眠 7 天

    ★ 边界硬 ★
    不碰钱/关系/健康/隐私/价值观直接建议
    """

    def __init__(self, event_bus, soul_store, config):
        self._events = event_bus
        self._soul = soul_store
        self._config = config
        # 内存缓存：forgekin_id -> [dismissed timestamps]
        self._dismissed_history: dict[str, list[datetime]] = {}

    async def fire(self, forgekin_id: str, diary: ForgeDiary):
        """投递一个 Provoke"""
        if not diary.provoke_content:
            return None

        # 1. 频率检查：每天 ≤1
        soul = await self._soul.load(forgekin_id)
        if soul.evolution_state.provoke_fired_today >= self._config.provoke_max_per_day:
            return None

        # 2. 连拍检查：连拍 3 次冬眠
        recent_dismissed = self._dismissed_history.get(forgekin_id, [])
        recent_3_days = [
            d for d in recent_dismissed
            if d > datetime.now() - timedelta(days=3)
        ]
        if len(recent_3_days) >= 3:
            logger.info(f"灵智 {forgekin_id} 连拍 3 次，进入冬眠")
            await self._soul.set_status(forgekin_id, "dormant", "auto_forge")
            return None

        # 3. quietness 三开关检查
        if not await self._is_behavior_enabled(forgekin_id):
            return None

        # 4. 边界检查
        if not self._check_boundaries(diary.provoke_content):
            logger.warning(f"Provoke 内容触碰边界，拒绝投递")
            return None

        # 5. 投递
        await self._events.publish(
            "concierge:event",
            {
                "kind": "dream-provoke",
                "forgekin_id": forgekin_id,
                "content": diary.provoke_content,
                "fired_at": datetime.now().isoformat(),
            },
        )

        # 更新今日投递计数
        soul.evolution_state.provoke_fired_today += 1
        await self._soul.update_evolution_state(forgekin_id, soul.evolution_state)

        logger.info(f"Provoke 投递成功: {forgekin_id}")
        return diary.provoke_content

    async def record_dismissal(self, forgekin_id: str):
        """记录 Provoke 被拍扁"""
        if forgekin_id not in self._dismissed_history:
            self._dismissed_history[forgekin_id] = []
        self._dismissed_history[forgekin_id].append(datetime.now())

        soul = await self._soul.load(forgekin_id)
        soul.evolution_state.consecutive_dismissed += 1
        await self._soul.update_evolution_state(forgekin_id, soul.evolution_state)

    async def record_engagement(self, forgekin_id: str):
        """记录 Provoke 被戳破（有效互动）"""
        soul = await self._soul.load(forgekin_id)
        soul.evolution_state.consecutive_dismissed = 0  # 重置连拍计数
        await self._soul.update_evolution_state(forgekin_id, soul.evolution_state)

    async def _is_behavior_enabled(self, forgekin_id: str) -> bool:
        """quietness 三开关检查"""
        # 从配置或状态中检查 behaviorEnabled
        # 简化实现：默认 True
        return True

    def _check_boundaries(self, content: str) -> bool:
        """边界检查——不碰钱/关系/健康/隐私/价值观"""
        for keyword in FORBIDDEN_PROVOKE_KEYWORDS:
            if keyword in content:
                return False
        return True
```

### 17.4 GroupForgeOrchestrator（灵锻群协调器）

```python
# evolution/auto_forge/group_forge.py
import logging
from evolution.auto_forge.consolidation import ForgeDiary
from evolution.forgekin.echo_store import EchoStore

logger = logging.getLogger(__name__)

# 分工角色（对标 clowder-ai Maine Coon/Siamese/Ragdoll 分工）
FORGE_ROLES = {
    "scout": "找料者——读留痕找关联",
    "expresser": "表达者——写日记&猫猫感",
    "organizer": "组织者——组织架构和画线",
}


class GroupForgeOrchestrator:
    """灵锻群协调器——多灵智协作做梦

    对标 clowder-ai 做梦群：n 只猫的可配置小群，自由传球。
    分工：找料者/表达者/组织者
    """

    def __init__(self, echo_store: EchoStore, llm_client, diary_store):
        self._echo = echo_store
        self._llm = llm_client
        self._diary_store = diary_store

    async def forge(self, forgekin_ids: list[str]) -> list[ForgeDiary]:
        """多灵智协作灵锻"""
        logger.info(f"群体灵锻启动: {forgekin_ids}")

        # 1. 分配角色
        roles = self._assign_roles(forgekin_ids)

        # 2. 收集所有留痕
        all_traces = await self._gather_all_traces(forgekin_ids)

        # 3. 协作画线
        connections = await self._collaborative_draw_lines(all_traces, roles)

        # 4. 每个灵智写自己的日记
        diaries = []
        for fk_id in forgekin_ids:
            diary = await self._write_diary_with_role(
                fk_id, connections, roles[fk_id]
            )
            diaries.append(diary)
            await self._diary_store.save(diary)

        return diaries

    def _assign_roles(self, forgekin_ids: list[str]) -> dict[str, str]:
        """分配角色——按列表顺序循环分配"""
        roles = {}
        role_keys = list(FORGE_ROLES.keys())
        for i, fk_id in enumerate(forgekin_ids):
            roles[fk_id] = role_keys[i % len(role_keys)]
        return roles

    async def _gather_all_traces(self, forgekin_ids: list[str]) -> list:
        """收集所有灵智的留痕"""
        all_episodes = []
        for fk_id in forgekin_ids:
            episodes = await self._echo.recall(fk_id, "recent", limit=10)
            all_episodes.extend(episodes)
        return all_episodes

    async def _collaborative_draw_lines(self, traces, roles) -> str:
        """协作画线——LLM 多角色协作"""
        role_desc = "\n".join(
            f"- {FORGE_ROLES[r]}" for r in roles.values()
        )
        prompt = f"""多灵智协作灵锻。角色分工：
{role_desc}

共享留痕：
{self._format_traces(traces[:20])}

请各角色协作画线，找出跨灵智的关联。"""
        if self._llm:
            return await self._llm.chat(system="多灵智协作画线器", user_content=prompt)
        return "（LLM 不可用）"

    async def _write_diary_with_role(
        self, fk_id: str, connections: str, role: str
    ) -> ForgeDiary:
        """按角色写日记"""
        role_desc = FORGE_ROLES.get(role, "通用")
        prompt = f"""你是 {role_desc}。基于以下协作画线，写你的灵锻日记。

画线分析：
{connections}

以第一人称写，体现你的角色视角。"""
        if self._llm:
            content = await self._llm.chat(system="灵智日记人格", user_content=prompt)
        else:
            content = f"作为{role_desc}，今天参与了群体灵锻。"
        return ForgeDiary(forgekin_id=fk_id, content=content)

    def _format_traces(self, traces) -> str:
        return "\n".join(
            f"- [{ep.forgekin_id}] {ep.task_context[:80]}" for ep in traces
        )
```

### 17.5 ForgeDiaryStore（日记存储）

```python
# evolution/auto_forge/diary_store.py
import json
import aiosqlite
from datetime import datetime
from evolution.auto_forge.consolidation import ForgeDiary


class ForgeDiaryStore:
    """灵锻日记存储

    表结构见 migrations/011_forge_diaries.sql
    """

    def __init__(self, llm_client=None):
        self._llm = llm_client

    async def save(self, diary: ForgeDiary) -> str:
        """保存日记"""
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(
                """INSERT INTO forge_diaries
                (diary_id, forgekin_id, content, observations,
                 provoke_content, timestamp, read_status)
                VALUES (?, ?, ?, ?, ?, ?, 'unread')""",
                (f"diary_{diary.forgekin_id}_{diary.timestamp.timestamp()}",
                 diary.forgekin_id, diary.content,
                 json.dumps(diary.observations, ensure_ascii=False),
                 diary.provoke_content, diary.timestamp.isoformat()),
            )
            await db.commit()

    async def list_by_forgekin(
        self, forgekin_id: str, limit: int = 20
    ) -> list[dict]:
        """列出灵智的日记"""
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT * FROM forge_diaries WHERE forgekin_id = ? "
                "ORDER BY timestamp DESC LIMIT ?",
                (forgekin_id, limit),
            )
            rows = await cursor.fetchall()
            return [dict(r) for r in rows]

    async def mark_read(self, diary_id: str) -> None:
        """标记已读"""
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(
                "UPDATE forge_diaries SET read_status = 'read' WHERE diary_id = ?",
                (diary_id,),
            )
            await db.commit()
```

***

## 第十八章：外部工具集成详细设计

### 18.1 ExternalToolBridge（统一桥接入口）

```python
# evolution/tools/bridge.py
import asyncio
import logging
from pydantic import BaseModel, Field
from typing import Optional

logger = logging.getLogger(__name__)


class ExternalTask(BaseModel):
    """外部工具任务"""
    task_id: str
    instruction: str
    forgekin_id: str = ""
    context_snapshot: dict = Field(default_factory=dict)
    files_changed: list[str] = Field(default_factory=list)
    diff: str = ""
    priority: str = "P2"
    task_type: str = "code"  # code/review/design/test
    timeout_seconds: int = 300


class ExternalToolResult(BaseModel):
    """外部工具执行结果"""
    output: str = ""
    exit_code: int = 0
    error: Optional[str] = None
    metadata: dict = Field(default_factory=dict)


class ExternalToolBridge:
    """外部编码工具统一桥接器

    支持两种模式：
    1. CLI Wrapper：claude_code/codex/opencode（有 CLI 接口）
    2. Trae Bridge：JSON 文件交换 + 轮询（无 CLI 时的接入方式）
    """

    def __init__(self, config: dict, worktree_manager=None, audit_logger=None):
        from evolution.tools.cli_wrapper import ClaudeCodeWrapper, CodexWrapper, OpenCodeWrapper
        from evolution.tools.trae_bridge import TraeBridgeWrapper

        self._wrappers = {
            "claude_code": ClaudeCodeWrapper(config.get("claude_code", {})),
            "codex": CodexWrapper(config.get("codex", {})),
            "opencode": OpenCodeWrapper(config.get("opencode", {})),
            "trae_bridge": TraeBridgeWrapper(config.get("trae_bridge", {})),
        }
        self._worktree = worktree_manager
        self._audit = audit_logger

    async def execute(
        self, tool: str, task: ExternalTask,
        workspace: str, forgekin_id: str,
    ) -> ExternalToolResult:
        """调用外部工具执行任务"""
        wrapper = self._wrappers.get(tool)
        if not wrapper:
            raise ValueError(f"不支持的外部工具: {tool}")

        # 工作区隔离（worktree 模式）
        isolated_ws = workspace
        if self._worktree:
            isolated_ws = await self._worktree.create(
                workspace, f"forge-{task.task_id}", "main"
            )

        try:
            logger.info(f"调用外部工具 {tool}: task={task.task_id}")
            result = await wrapper.execute(task, isolated_ws)

            # 审计日志
            if self._audit:
                await self._audit.log(
                    tool=tool, task=task, workspace=isolated_ws,
                    result=result, forgekin_id=forgekin_id,
                )

            return result

        except Exception as e:
            logger.error(f"外部工具 {tool} 失败: {e}，降级到内置 Agent")
            return ExternalToolResult(
                output="", exit_code=-1, error=str(e),
                metadata={"fallback": True},
            )
        finally:
            if self._worktree and isolated_ws != workspace:
                await self._worktree.remove(isolated_ws)
```

### 18.2 CLI Wrapper 详细实现

```python
# evolution/tools/cli_wrapper.py
import asyncio
import logging
from typing import Optional
from evolution.tools.bridge import ExternalTask, ExternalToolResult

logger = logging.getLogger(__name__)


class BaseCLIWrapper:
    """CLI 工具包装器基类"""

    def __init__(self, config: dict):
        self._cli_command = config.get("cli_command", "")
        self._timeout = config.get("timeout_seconds", 300)

    async def execute(self, task: ExternalTask, workspace: str) -> ExternalToolResult:
        """执行 CLI 命令"""
        cmd = self._build_command(task, workspace)
        logger.debug(f"CLI 命令: {' '.join(cmd)}")

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=workspace,
            )
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(), timeout=task.timeout_seconds or self._timeout
            )
            return ExternalToolResult(
                output=stdout.decode("utf-8", errors="replace"),
                exit_code=proc.returncode,
                error=stderr.decode("utf-8", errors="replace") if proc.returncode != 0 else None,
            )
        except asyncio.TimeoutError:
            logger.error(f"CLI 工具超时 ({self._timeout}s)")
            return ExternalToolResult(output="", exit_code=-1, error="timeout")
        except FileNotFoundError:
            logger.error(f"CLI 命令不存在: {self._cli_command}")
            return ExternalToolResult(output="", exit_code=-1, error="cli_not_found")

    def _build_command(self, task: ExternalTask, workspace: str) -> list[str]:
        """构建 CLI 命令——子类覆写"""
        raise NotImplementedError


class ClaudeCodeWrapper(BaseCLIWrapper):
    """Claude Code CLI 包装器

    对标 clowder-ai 调用 claude code 的方式。
    """

    def __init__(self, config: dict):
        super().__init__(config)
        if not self._cli_command:
            self._cli_command = "claude"

    def _build_command(self, task: ExternalTask, workspace: str) -> list[str]:
        return [
            self._cli_command,
            "--workspace", workspace,
            "--task", task.instruction,
            "--format", "json",
            "--max-turns", "50",
        ]


class CodexWrapper(BaseCLIWrapper):
    """Codex CLI 包装器"""

    def __init__(self, config: dict):
        super().__init__(config)
        if not self._cli_command:
            self._cli_command = "codex"

    def _build_command(self, task: ExternalTask, workspace: str) -> list[str]:
        return [
            self._cli_command,
            "--workspace", workspace,
            "--prompt", task.instruction,
            "--format", "json",
        ]


class OpenCodeWrapper(BaseCLIWrapper):
    """OpenCode CLI 包装器"""

    def __init__(self, config: dict):
        super().__init__(config)
        if not self._cli_command:
            self._cli_command = "opencode"

    def _build_command(self, task: ExternalTask, workspace: str) -> list[str]:
        return [
            self._cli_command,
            "--workspace", workspace,
            "--task", task.instruction,
        ]
```

### 18.3 Trae Bridge 详细实现

```python
# evolution/tools/trae_bridge.py
import json
import time
import asyncio
import logging
from pathlib import Path
from evolution.tools.bridge import ExternalTask, ExternalToolResult

logger = logging.getLogger(__name__)


class TraeBridgeWrapper:
    """Trae 监工 Bridge——无 CLI 时的接入方式

    ★ 核心设计 ★
    Trae 个人版无 CLI 接口，通过 JSON 文件交换通信：
    1. Forgekin 写任务 JSON 到 bridge/tasks/{task_id}.json
    2. Trae 监工监听 tasks/ 目录，读取并处理
    3. Trae 写响应 JSON 到 bridge/responses/{task_id}.json
    4. Forgekin 轮询 responses/ 目录，读取响应

    Trae 参与场景：
    - 设计阶段：架构设计、agent YAML 设计、prompt 设计
    - 审查阶段：跨模型评审中的一评委
    - 复杂决策：技术选型、架构权衡
    - LLM 调用：作为 fallback LLM provider

    主体框架流程由 FlowForge/DevForge 驱动，
    Trae 在需要时参与，不接管主流程。
    """

    def __init__(self, config: dict):
        self._bridge_dir = Path(config.get("bridge_dir", "data/trae_bridge"))
        self._tasks_dir = self._bridge_dir / "tasks"
        self._responses_dir = self._bridge_dir / "responses"
        self._poll_interval = config.get("poll_interval_seconds", 2)
        self._timeout = config.get("timeout_seconds", 300)

        # 自动创建目录
        self._tasks_dir.mkdir(parents=True, exist_ok=True)
        self._responses_dir.mkdir(parents=True, exist_ok=True)

    async def execute(self, task: ExternalTask, workspace: str) -> ExternalToolResult:
        """通过 JSON 文件交换与 Trae 监工通信"""

        # 1. 写任务 JSON
        task_file = self._tasks_dir / f"{task.task_id}.json"
        task_payload = {
            "task_id": task.task_id,
            "type": task.task_type,
            "priority": task.priority,
            "context": {
                "workspace": workspace,
                "files_changed": task.files_changed,
                "diff": task.diff,
                "forgekin_id": task.forgekin_id,
            },
            "instruction": task.instruction,
            "timeout_seconds": self._timeout,
            "expected_format": "structured_response",
            "created_at": time.time(),
        }
        task_file.write_text(
            json.dumps(task_payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        logger.info(f"Trae Bridge 任务已写入: {task_file}")

        # 2. 轮询响应
        response_file = self._responses_dir / f"{task.task_id}.json"
        start = time.time()
        while time.time() - start < self._timeout:
            if response_file.exists():
                try:
                    response = json.loads(
                        response_file.read_text(encoding="utf-8")
                    )
                    # 清理
                    task_file.unlink(missing_ok=True)
                    response_file.unlink(missing_ok=True)

                    logger.info(f"Trae Bridge 响应已接收: {task.task_id}")
                    return ExternalToolResult(
                        output=response.get("output", ""),
                        exit_code=response.get("exit_code", 0),
                        error=response.get("error"),
                        metadata=response.get("metadata", {}),
                    )
                except json.JSONDecodeError:
                    logger.warning(f"Trae Bridge 响应格式错误: {response_file}")
                    response_file.unlink(missing_ok=True)
                    return ExternalToolResult(
                        output="", exit_code=-1, error="invalid_response_format",
                    )

            await asyncio.sleep(self._poll_interval)

        # 3. 超时降级
        task_file.unlink(missing_ok=True)
        logger.warning(f"Trae Bridge 超时 ({self._timeout}s): {task.task_id}")
        raise TraeBridgeTimeoutError(
            f"Trae Bridge 任务 {task.task_id} 超时 {self._timeout}s"
        )

    async def check_health(self) -> bool:
        """检查 Trae 监工是否在线"""
        # 检查最近是否有响应文件被创建
        recent_responses = list(self._responses_dir.glob("*.json"))
        if not recent_responses:
            # 写一个 ping 任务
            ping_file = self._tasks_dir / "ping.json"
            ping_file.write_text(json.dumps({"type": "ping", "task_id": "ping"}))
            # 等待 10 秒看是否有响应
            await asyncio.sleep(10)
            pong_file = self._responses_dir / "ping.json"
            return pong_file.exists()
        return True


class TraeBridgeTimeoutError(Exception):
    """Trae Bridge 超时异常"""
    pass
```

### 18.4 WorktreeManager（工作区隔离）

```python
# evolution/tools/worktree_manager.py
import asyncio
import logging
from pathlib import Path

logger = logging.getLogger(__name__)


class WorktreeManager:
    """Git Worktree 工作区管理器

    对标 clowder-ai worktree skill，
    所有外部工具调用都在隔离的 worktree 中执行，
    防止对主工作区的污染。
    """

    def __init__(self, config: dict):
        self._base_path = Path(config.get("worktree_base", "data/worktrees"))
        self._base_path.mkdir(parents=True, exist_ok=True)

    async def create(
        self, base_repo: str, branch_name: str, base_branch: str = "main"
    ) -> str:
        """创建隔离的 worktree

        执行: git worktree add {path} -b {branch} {base_branch}
        """
        worktree_path = self._base_path / branch_name
        cmd = [
            "git", "worktree", "add",
            str(worktree_path),
            "-b", branch_name,
            base_branch,
        ]

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=base_repo,
        )
        _, stderr = await proc.communicate()

        if proc.returncode != 0:
            logger.error(f"Worktree 创建失败: {stderr.decode()}")
            # 降级：使用原工作区
            return base_repo

        logger.info(f"Worktree 创建成功: {worktree_path}")
        return str(worktree_path)

    async def remove(self, worktree_path: str) -> None:
        """清理 worktree"""
        if worktree_path == str(self._base_path.parent):
            return  # 不删除主工作区

        cmd = ["git", "worktree", "remove", worktree_path, "--force"]
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        await proc.communicate()

        # 删除临时分支
        branch_name = Path(worktree_path).name
        cmd = ["git", "branch", "-D", branch_name]
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        await proc.communicate()

        logger.info(f"Worktree 已清理: {worktree_path}")

    async def validate_baseline(self, worktree_path: str) -> bool:
        """基线测试验证——在 worktree 中运行测试"""
        cmd = ["python", "-m", "pytest", "--tb=short", "-q"]
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=worktree_path,
        )
        await proc.communicate()
        return proc.returncode == 0
```

***

## 第十九章：灵议与 A2A 详细设计

### 19.1 A2A 消息数据模型

```python
# evolution/council/a2a_message.py
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime
import uuid


class Mention(BaseModel):
    """@mention 解析结果"""
    target: str = Field(..., description="目标 forgekin_id 或 项目前缀:角色名")
    raw: str = Field(..., description="原始 @mention 文本")


class Artifact(BaseModel):
    """附件——代码/文档/图片"""
    artifact_id: str = Field(default_factory=lambda: f"art_{uuid.uuid4().hex[:8]}")
    type: str = Field("text", description="text/code/image/file")
    content: str = ""
    path: Optional[str] = None


class Handoff(BaseModel):
    """结构化任务交接"""
    task: str = Field(..., description="交接的任务描述")
    context_snapshot: dict = Field(default_factory=dict, description="上下文快照")
    acceptance_criteria: dict = Field(default_factory=dict, description="验收标准")

    def to_artifact(self) -> Artifact:
        return Artifact(type="text", content=self.model_dump_json())


class A2AMessage(BaseModel):
    """A2A 消息——灵智间通信

    对标 clowder-ai F002 Agent-to-Agent 协议。
    核心特性：
    - @mention 路由：@devforge:architect 请审查这个设计
    - Thread isolation：每个 conversation 在独立 thread 中
    - Structured handoff：结构化任务交接
    """
    message_id: str = Field(default_factory=lambda: f"msg_{uuid.uuid4().hex[:12]}")
    from_forgekin: str
    to_forgekin: str | list[str]
    thread_id: str = Field(default_factory=lambda: f"thread_{uuid.uuid4().hex[:8]}")
    mention: Optional[Mention] = None
    content: str
    artifacts: list[Artifact] = Field(default_factory=list)
    handoff: Optional[Handoff] = None
    timestamp: datetime = Field(default_factory=datetime.now)
    trace_id: str = Field(default="", description="全链路追踪 ID")
```

### 19.2 A2AManager 详细实现

```python
# evolution/council/a2a_manager.py
import re
import logging
import aiosqlite
from typing import Optional
from evolution.council.a2a_message import A2AMessage, Mention, Handoff, Artifact

logger = logging.getLogger(__name__)

# @mention 正则：@项目前缀:角色名
MENTION_PATTERN = re.compile(r"@(\w+):(\w+)")


class A2AManager:
    """A2A 通信管理器——灵智间协作

    核心协议：
    1. @mention 路由：解析 @devforge:architect → 路由到 fk_devforge_architect
    2. Thread isolation：每个 conversation 独立 thread，避免上下文污染
    3. Structured handoff：结构化任务交接，含上下文和验收标准
    """

    def __init__(self, db_path: str, event_bus=None):
        self._db_path = db_path
        self._events = event_bus
        # thread_id -> [message_ids]
        self._threads: dict[str, list[str]] = {}

    async def send_mention(
        self,
        from_forgekin: str,
        to_forgekin: str,
        content: str,
        thread_id: str = None,
        artifacts: list[Artifact] = None,
    ) -> str:
        """发送 @mention 消息"""
        message = A2AMessage(
            from_forgekin=from_forgekin,
            to_forgekin=to_forgekin,
            thread_id=thread_id or self._create_thread_id(),
            mention=Mention(target=to_forgekin, raw=f"@{to_forgekin}"),
            content=content,
            artifacts=artifacts or [],
        )
        await self._route(message)
        return message.message_id

    async def handoff(
        self,
        from_forgekin: str,
        to_forgekin: str,
        task: str,
        context_snapshot: dict,
        acceptance_criteria: dict,
    ) -> str:
        """结构化任务交接"""
        handoff = Handoff(
            task=task,
            context_snapshot=context_snapshot,
            acceptance_criteria=acceptance_criteria,
        )
        return await self.send_mention(
            from_forgekin, to_forgekin,
            content=task,
            artifacts=[handoff.to_artifact()],
        )

    async def route(self, message: A2AMessage) -> None:
        """路由消息到目标灵智"""
        # 1. 解析 @mention
        if not message.mention:
            mentions = self._parse_mentions(message.content)
            if mentions:
                message.mention = mentions[0]

        # 2. Thread isolation
        self._threads.setdefault(message.thread_id, []).append(message.message_id)

        # 3. 持久化
        await self._persist(message)

        # 4. 事件总线发布
        if self._events:
            await self._events.publish("a2a.message_routed", message.dict())

        logger.info(
            f"A2A 消息路由: {message.from_forgekin} → {message.to_forgekin} "
            f"(thread={message.thread_id})"
        )

    def _parse_mentions(self, content: str) -> list[Mention]:
        """解析 @mention"""
        mentions = []
        for match in MENTION_PATTERN.finditer(content):
            project, role = match.groups()
            mentions.append(Mention(
                target=f"{project}:{role}",
                raw=match.group(0),
            ))
        return mentions

    def _create_thread_id(self) -> str:
        import uuid
        return f"thread_{uuid.uuid4().hex[:8]}"

    async def _persist(self, message: A2AMessage) -> None:
        """持久化到 SQLite"""
        import json
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(
                """INSERT INTO a2a_messages
                (message_id, from_forgekin, to_forgekin, thread_id,
                 mention, content, artifacts, handoff, timestamp, trace_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (message.message_id, message.from_forgekin,
                 ",".join(message.to_forgekin) if isinstance(message.to_forgekin, list)
                 else message.to_forgekin,
                 message.thread_id,
                 json.dumps(message.mention.dict()) if message.mention else None,
                 message.content,
                 json.dumps([a.dict() for a in message.artifacts]),
                 json.dumps(message.handoff.dict()) if message.handoff else None,
                 message.timestamp.isoformat(),
                 message.trace_id),
            )
            await db.commit()

    async def get_thread_messages(self, thread_id: str) -> list[dict]:
        """获取 thread 中的所有消息"""
        import json
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT * FROM a2a_messages WHERE thread_id = ? ORDER BY timestamp",
                (thread_id,),
            )
            rows = await cursor.fetchall()
            return [dict(r) for r in rows]
```

### 19.3 MindCouncil（灵议多渠道）详细实现

```python
# evolution/council/forgekin_council.py
import asyncio
import logging
from typing import Optional
from evolution.council.a2a_manager import A2AManager
from evolution.council.a2a_message import A2AMessage

logger = logging.getLogger(__name__)


class CouncilMessage:
    """灵议消息——跨渠道统一格式"""
    def __init__(self, sender: str, content: str, channel: str = "web_chat",
                 forgekin_id: str = None, thread_id: str = None):
        self.sender = sender
        self.content = content
        self.channel = channel
        self.forgekin_id = forgekin_id
        self.thread_id = thread_id
        self.has_mention = "@" in content

    def to_a2a_message(self, from_id: str, to_id: str) -> A2AMessage:
        return A2AMessage(
            from_forgekin=from_id,
            to_forgekin=to_id,
            thread_id=self.thread_id or "",
            content=self.content,
        )


class MindCouncil:
    """灵议——多渠道 IM 协作系统

    对标 clowder-ai IM 团队协作。

    渠道架构：
    | 渠道 | 用途 | 默认 | 对接 |
    |------|------|------|------|
    | Web Chat（灵议） | 主渠道 | 启用 | WebSocket + SSE |
    | 飞书 | 团队通知 | 可选 | 飞书开放平台 API |
    | 微信 | 备用通知 | 可选 | 微信公众号/个人号 |
    | Slack | 国际协作 | 可选 | Slack Webhook |
    | Discord | 社区协作 | 可选 | Discord Bot |
    | GitHub PR | 代码审查 | 可选 | GitHub Webhook |
    """

    def __init__(self, channels: dict, a2a_manager: A2AManager, event_bus=None):
        self._channels = channels  # {"web_chat": WebChatChannel, ...}
        self._a2a = a2a_manager
        self._events = event_bus

    async def broadcast(
        self, message: CouncilMessage, channels: list[str] = None
    ) -> None:
        """跨渠道广播消息"""
        target = channels or list(self._channels.keys())
        tasks = []
        for ch_name in target:
            ch = self._channels.get(ch_name)
            if ch and ch.is_enabled():
                tasks.append(ch.send(message))
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def receive(self, channel: str, raw_message: dict) -> None:
        """从某渠道接收消息"""
        ch = self._channels.get(channel)
        if not ch:
            return

        msg = ch.parse(raw_message)

        # 路由到 A2A（如果有 @mention）
        if msg.has_mention and msg.forgekin_id:
            # 解析目标
            from evolution.council.a2a_manager import MENTION_PATTERN
            import re
            matches = MENTION_PATTERN.findall(msg.content)
            if matches:
                project, role = matches[0]
                to_id = f"fk_{project}_{role}"
                a2a_msg = msg.to_a2a_message(msg.forgekin_id, to_id)
                await self._a2a.route(a2a_msg)
        else:
            # 广播到其他渠道
            await self.broadcast(msg, exclude=[channel])

    async def start_kinship_task(
        self, initiator: str, participants: list[str], task: str
    ) -> str:
        """发起 Kinship 协作任务"""
        import uuid
        thread_id = f"kinship_{uuid.uuid4().hex[:8]}"
        for participant in participants:
            if participant != initiator:
                await self._a2a.handoff(
                    from_forgekin=initiator,
                    to_forgekin=participant,
                    task=task,
                    context_snapshot={"thread_id": thread_id},
                    acceptance_criteria={"collaboration": True},
                )
        logger.info(f"Kinship 协作任务已发起: {thread_id}, 参与者: {participants}")
        return thread_id
```

### 19.4 Channel 基类与 Web Chat 渠道

```python
# evolution/council/channels/base.py
from abc import ABC, abstractmethod
from evolution.council.forgekin_council import CouncilMessage


class Channel(ABC):
    """IM 渠道适配器基类"""

    def __init__(self, name: str, config: dict):
        self.name = name
        self._config = config
        self._enabled = config.get("enabled", False)

    def is_enabled(self) -> bool:
        return self._enabled

    @abstractmethod
    async def send(self, message: CouncilMessage) -> None:
        """发送消息"""
        pass

    @abstractmethod
    def parse(self, raw: dict) -> CouncilMessage:
        """解析原始消息"""
        pass


# evolution/council/channels/web_chat.py
from evolution.council.channels.base import Channel
from evolution.council.forgekin_council import CouncilMessage


class WebChatChannel(Channel):
    """Web Chat 灵议主渠道——WebSocket + SSE

    升级后的 Web Chat 从单用户对话升级为多灵智议事厅：
    - 支持多灵智同时在线
    - 支持查看所有灵智的实时状态、对话、日记
    - 支持 operator 参与/旁观/干预
    - 支持发起 Kinship 协作任务
    """

    def __init__(self, config: dict):
        super().__init__("web_chat", config)
        self._ws_connections: set = set()  # WebSocket 连接集合

    async def send(self, message: CouncilMessage) -> None:
        """通过 WebSocket 推送消息"""
        import json
        payload = json.dumps({
            "type": "council_message",
            "sender": message.sender,
            "content": message.content,
            "forgekin_id": message.forgekin_id,
            "thread_id": message.thread_id,
            "channel": "web_chat",
        }, ensure_ascii=False)
        # 推送到所有连接的 WebSocket 客户端
        for ws in list(self._ws_connections):
            try:
                await ws.send_text(payload)
            except Exception:
                self._ws_connections.discard(ws)

    def parse(self, raw: dict) -> CouncilMessage:
        return CouncilMessage(
            sender=raw.get("sender", "unknown"),
            content=raw.get("content", ""),
            channel="web_chat",
            forgekin_id=raw.get("forgekin_id"),
            thread_id=raw.get("thread_id"),
        )

    def add_connection(self, ws) -> None:
        """添加 WebSocket 连接"""
        self._ws_connections.add(ws)

    def remove_connection(self, ws) -> None:
        """移除 WebSocket 连接"""
        self._ws_connections.discard(ws)


# evolution/council/channels/feishu.py
from evolution.council.channels.base import Channel
from evolution.council.forgekin_council import CouncilMessage


class FeishuChannel(Channel):
    """飞书渠道——飞书开放平台 API"""

    def __init__(self, config: dict):
        super().__init__("feishu", config)
        self._app_id = config.get("app_id", "")
        self._app_secret = config.get("app_secret", "")
        self._chat_id = config.get("chat_id", "")

    async def send(self, message: CouncilMessage) -> None:
        """通过飞书 API 发送消息"""
        import httpx
        # 获取 tenant_access_token（简化实现）
        # 发送消息到飞书群
        async with httpx.AsyncClient() as client:
            # TODO: 实现飞书 API 调用
            logger.info(f"飞书消息已发送: {message.content[:50]}")

    def parse(self, raw: dict) -> CouncilMessage:
        return CouncilMessage(
            sender=raw.get("event", {}).get("sender", {}).get("sender_id", {}).get("open_id", "unknown"),
            content=raw.get("event", {}).get("message", {}).get("content", ""),
            channel="feishu",
        )
```

***

## 第二十章：灵典（Mind Codex）详细设计

### 20.1 Knowledge Object 数据模型

```python
# evolution/codex/knowledge_object.py
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class KnowledgeFrontmatter(BaseModel):
    """知识对象 frontmatter——对标 clowder-ai Knowledge Object Contract

    基于 ADR-011 通用 frontmatter，6+2 核心字段：
    """
    artifact_type: str = Field(..., description="episode|method|skill|proposal|eval|lesson|log")
    domain: str = Field("development", description="development|medical|legal|product|ops|general")
    knowledge_type: str = Field("procedural", description="declarative|procedural|analytical|metacognitive")
    scope: str = Field("team-shared", description="agent-local|team-shared")
    trust_level: str = Field("experimental", description="experimental|tested|validated|production")
    lifecycle: str = Field("draft", description="draft|active|deprecated")

    # provenance
    author_type: str = Field("agent", description="agent|human|collaborative")
    source_refs: list[str] = Field(default_factory=list)


class KnowledgeObject(BaseModel):
    """知识对象——灵典中的基本单元

    五级进化阶（Evolution Hierarchy）：
    E-L0 Episode → E-L1 Pattern → E-L2 Draft → E-L3 Validated → E-L4 Standard
    """
    knowledge_id: str
    forgekin_id: str  # 创建者
    frontmatter: KnowledgeFrontmatter
    content: str  # 正文

    # 进化阶
    ember_level: str = Field("E-L0", description="E-L0|E-L1|E-L2|E-L3|E-L4")

    # 动态状态（走事件流，不污染 git history）
    last_used: Optional[datetime] = None
    hit_count: int = 0
    approval_status: str = Field("draft", description="draft|pending|approved|rejected")

    # 元认知
    self_reported_confidence: float = 0.5
    domain_reliability: float = 0.5
    wilson_lower_bound: float = 0.0

    # 长尾车道标记
    long_tail: bool = False

    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: Optional[datetime] = None
```

### 20.2 ForgeCodex 主入口详细实现

```python
# evolution/codex/forge_codex.py
import json
import uuid
import logging
import aiosqlite
from typing import Optional
from evolution.codex.knowledge_object import KnowledgeObject, KnowledgeFrontmatter
from evolution.forgekin.episode import SoulEpisode
from evolution.codex.ember_hierarchy import EvolutionHierarchyManager
from evolution.codex.distiller import DualDistiller

logger = logging.getLogger(__name__)


class ForgeCodex:
    """灵典——可复用知识体系

    对标 clowder-ai Skill Library + 五级知识阶梯。

    三机制闭环：
    Episode Card（原料）→ Dual Distillation（蒸馏成品）→ Eval Ledger（证明净增益）

    三模式自生成（对标 clowder-ai F100）：
    - Mode A: Scope Guard（防御）——发现任务偏离愿景
    - Mode B: Process Evolution（防御→改进）——同类错误≥2次
    - Mode C: Knowledge Evolution（进攻→成长）——可复用知识沉淀
    """

    def __init__(self, db_path: str, llm_client=None, event_bus=None):
        self._db_path = db_path
        self._llm = llm_client
        self._events = event_bus
        self._ember = EvolutionHierarchyManager(db_path)
        self._distiller = DualDistiller(llm_client)

    async def maybe_distill(self, episode: SoulEpisode) -> Optional[str]:
        """尝试将 Episode 蒸馏成 Skill

        三模式自生成判断：
        - Mode A: 任务偏离 → 温柔提醒
        - Mode B: 同类错误 ≥2 → 5槽提案
        - Mode C: 可复用知识 → 三问判断 + 沉淀
        """
        if not episode.is_distillable():
            return None

        # 三问判断（Mode C）：复用性 + 非显然性 + 衰减性
        if not self._three_questions_pass(episode):
            return None

        # 双蒸馏
        knowledge = await self._distiller.distill(episode)
        if not knowledge:
            return None

        # 保存到灵典
        knowledge_id = await self.save(knowledge)

        # 更新 Episode 蒸馏状态
        await self._update_episode_distillation(episode.episode_id, knowledge_id)

        logger.info(f"Skill 蒸馏成功: {knowledge_id} (from {episode.episode_id})")
        return knowledge_id

    def _three_questions_pass(self, episode: SoulEpisode) -> bool:
        """三问判断——满足 ≥2 个才沉淀

        1. 复用性：这个经验能否在其他场景复用？
        2. 非显然性：这个经验是否不显然（不是常识）？
        3. 衰减性：这个经验是否会随时间衰减？
        """
        # 简化实现：基于 Episode 特征判断
        score = 0
        if len(episode.task_context) > 100:  # 有足够内容
            score += 1
        if episode.human_cues:  # 有人类提示
            score += 1
        if episode.success is False:  # 失败经验更有价值
            score += 1
        return score >= 2

    async def save(self, knowledge: KnowledgeObject) -> str:
        """保存知识对象到灵典"""
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(
                """INSERT INTO forge_codex
                (knowledge_id, forgekin_id, frontmatter, content,
                 ember_level, last_used, hit_count, approval_status,
                 self_reported_confidence, domain_reliability,
                 wilson_lower_bound, long_tail, created_at, updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (knowledge.knowledge_id, knowledge.forgekin_id,
                 knowledge.frontmatter.model_dump_json(), knowledge.content,
                 knowledge.ember_level,
                 knowledge.last_used.isoformat() if knowledge.last_used else None,
                 knowledge.hit_count, knowledge.approval_status,
                 knowledge.self_reported_confidence, knowledge.domain_reliability,
                 knowledge.wilson_lower_bound, knowledge.long_tail,
                 knowledge.created_at.isoformat(),
                 knowledge.updated_at.isoformat() if knowledge.updated_at else None),
            )
            await db.commit()
        return knowledge.knowledge_id

    async def load(self, knowledge_id: str) -> Optional[KnowledgeObject]:
        """加载知识对象"""
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT * FROM forge_codex WHERE knowledge_id = ?",
                (knowledge_id,),
            )
            row = await cursor.fetchone()
            if not row:
                return None
            return KnowledgeObject(
                knowledge_id=row["knowledge_id"],
                forgekin_id=row["forgekin_id"],
                frontmatter=KnowledgeFrontmatter.model_validate_json(row["frontmatter"]),
                content=row["content"],
                ember_level=row["ember_level"],
                hit_count=row["hit_count"],
                approval_status=row["approval_status"],
            )

    async def search(
        self, query: str, forgekin_id: str = None, limit: int = 10
    ) -> list[KnowledgeObject]:
        """搜索灵典"""
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row
            if forgekin_id:
                cursor = await db.execute(
                    "SELECT * FROM forge_codex WHERE forgekin_id = ? "
                    "AND content LIKE ? ORDER BY hit_count DESC LIMIT ?",
                    (forgekin_id, f"%{query}%", limit),
                )
            else:
                cursor = await db.execute(
                    "SELECT * FROM forge_codex WHERE content LIKE ? "
                    "ORDER BY hit_count DESC LIMIT ?",
                    (f"%{query}%", limit),
                )
            rows = await cursor.fetchall()
            return [await self.load(r["knowledge_id"]) for r in rows]

    async def count_skills_by_level(
        self, forgekin_id: str, min_level: str = "E-L0"
    ) -> int:
        """统计指定等级以上的 Skill 数"""
        level_order = ["E-L0", "E-L1", "E-L2", "E-L3", "E-L4"]
        min_idx = level_order.index(min_level)
        valid_levels = level_order[min_idx:]
        placeholders = ",".join("?" * len(valid_levels))
        async with aiosqlite.connect(self._db_path) as db:
            cursor = await db.execute(
                f"SELECT COUNT(*) FROM forge_codex WHERE forgekin_id = ? "
                f"AND ember_level IN ({placeholders})",
                (forgekin_id, *valid_levels),
            )
            row = await cursor.fetchone()
            return row[0] if row else 0

    async def count_skill_uses(self, forgekin_id: str) -> int:
        """统计 Skill 使用次数"""
        async with aiosqlite.connect(self._db_path) as db:
            cursor = await db.execute(
                "SELECT SUM(hit_count) FROM forge_codex WHERE forgekin_id = ?",
                (forgekin_id,),
            )
            row = await cursor.fetchone()
            return row[0] if row and row[0] else 0

    async def compute_success_rate(self, forgekin_id: str) -> float:
        """计算整体成功率"""
        async with aiosqlite.connect(self._db_path) as db:
            cursor = await db.execute(
                "SELECT AVG(domain_reliability) FROM forge_codex WHERE forgekin_id = ?",
                (forgekin_id,),
            )
            row = await cursor.fetchone()
            return row[0] if row and row[0] else 0.0

    async def compute_recent_success_rate(
        self, forgekin_id: str, last_n: int = 10
    ) -> float:
        """计算最近 N 次成功率"""
        async with aiosqlite.connect(self._db_path) as db:
            cursor = await db.execute(
                "SELECT domain_reliability FROM forge_codex "
                "WHERE forgekin_id = ? ORDER BY updated_at DESC LIMIT ?",
                (forgekin_id, last_n),
            )
            rows = await cursor.fetchall()
            if not rows:
                return 0.0
            return sum(r[0] for r in rows) / len(rows)

    async def _update_episode_distillation(
        self, episode_id: str, knowledge_id: str
    ) -> None:
        """更新 Episode 蒸馏状态"""
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(
                "UPDATE forgekin_episodes SET distillation_status = 'distilled' "
                "WHERE episode_id = ?",
                (episode_id,),
            )
            await db.commit()
```

### 20.3 DualDistiller（双蒸馏器）详细实现

```python
# evolution/codex/distiller.py
import uuid
import logging
from evolution.codex.knowledge_object import KnowledgeObject, KnowledgeFrontmatter
from evolution.forgekin.episode import SoulEpisode

logger = logging.getLogger(__name__)


class DualDistiller:
    """双蒸馏器——对标 clowder-ai Dual Distillation

    每张 Episode Card 蒸馏成两种形态之一：
    - Skill Draft：重复步骤稳定的流程型任务
    - Method Card：高风险领域或分析型任务
    """

    def __init__(self, llm_client=None):
        self._llm = llm_client

    async def distill(self, episode: SoulEpisode) -> KnowledgeObject:
        """执行双蒸馏"""
        # 判断蒸馏形态
        is_high_risk = self._is_high_risk(episode)
        is_procedural = self._is_procedural(episode)

        if is_high_risk or not is_procedural:
            artifact_type = "method"
            content = await self._distill_method_card(episode)
        else:
            artifact_type = "skill"
            content = await self._distill_skill_draft(episode)

        return KnowledgeObject(
            knowledge_id=f"ko_{uuid.uuid4().hex[:12]}",
            forgekin_id=episode.forgekin_id,
            frontmatter=KnowledgeFrontmatter(
                artifact_type=artifact_type,
                knowledge_type="procedural" if is_procedural else "analytical",
                trust_level="experimental",
                lifecycle="draft",
                author_type="agent",
                source_refs=[episode.episode_id],
            ),
            content=content,
            ember_level="E-L2",  # 蒸馏后默认 L2 Draft
        )

    async def _distill_skill_draft(self, episode: SoulEpisode) -> str:
        """蒸馏成 Skill Draft——流程型"""
        prompt = f"""从以下 Episode 蒸馏出一个可复用的 Skill Draft。

任务情境：{episode.task_context}
证据地图：{episode.evidence_map}
推理转折：{episode.reasoning_pivots}
边界：{episode.boundaries}

输出格式：
# Skill: [名称]
## 适用场景
## 步骤
1. ...
2. ...
## 注意事项
## 验证标准
"""
        if self._llm:
            return await self._llm.chat(system="你是 Skill 蒸馏器", user_content=prompt)
        return f"# Skill Draft\n\n基于 Episode {episode.episode_id} 蒸馏"

    async def _distill_method_card(self, episode: SoulEpisode) -> str:
        """蒸馏成 Method Card——分析型/高风险"""
        prompt = f"""从以下 Episode 蒸馏出一个 Method Card（高风险/分析型）。

任务情境：{episode.task_context}
推理转折：{episode.reasoning_pivots}
人类提示点：{episode.human_cues}
边界：{episode.boundaries}

输出格式：
# Method: [名称]
## 问题定义
## 分析框架
## 关键决策点
## 边界条件
## 风险评估
"""
        if self._llm:
            return await self._llm.chat(system="你是 Method Card 蒸馏器", user_content=prompt)
        return f"# Method Card\n\n基于 Episode {episode.episode_id} 蒸馏"

    def _is_high_risk(self, episode: SoulEpisode) -> bool:
        """判断是否高风险领域"""
        high_risk_keywords = ["安全", "security", "部署", "deploy", "删除", "delete"]
        return any(kw in episode.task_context.lower() for kw in high_risk_keywords)

    def _is_procedural(self, episode: SoulEpisode) -> bool:
        """判断是否流程型任务"""
        procedural_keywords = ["测试", "格式化", "构建", "部署", "生成", "test", "build"]
        return any(kw in episode.task_context.lower() for kw in procedural_keywords)
```

### 20.4 EvolutionHierarchyManager（五级火种阶梯）

```python
# evolution/codex/ember_hierarchy.py
import logging
import aiosqlite
from datetime import datetime

logger = logging.getLogger(__name__)


class EvolutionHierarchyManager:
    """五级火种阶梯管理器

    对标 clowder-ai 五级知识成熟度阶梯：

    | Level | 形态 | 晋升条件 | 降级/冻结 |
    |-------|------|---------|-----------|
    | E-L0 Episode | 原始记录 | 模板完整 | 不降级 |
    | E-L1 Pattern | 草稿 | ≥2 相似 episode, 5Q≥7/10 | 一次性特例→rejected |
    | E-L2 Draft | Method/Skill Draft | smoke gate ≥3 cases(≥2/3) | 最近3次<50%→退L1 |
    | E-L3 Validated | 正式 method/skill | ≥6 uses, ≥2 agents, ≥80% | 最近5次<60%→退L2 |
    | E-L4 Standard | 团队标准 | ≥12 uses, 最近10次≥90%, operator批准 | 1次高风险越界→freeze |

    双车道：常规车道 + 长尾/高风险车道（long_tail=true，允许长期停 L2/L3）
    """

    LEVEL_ORDER = ["E-L0", "E-L1", "E-L2", "E-L3", "E-L4"]

    def __init__(self, db_path: str):
        self._db_path = db_path

    async def check_promotion(self, knowledge_id: str) -> str | None:
        """检查晋升条件"""
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT * FROM forge_codex WHERE knowledge_id = ?",
                (knowledge_id,),
            )
            row = await cursor.fetchone()
            if not row:
                return None

            current_level = row["ember_level"]
            hit_count = row["hit_count"]

            # 晋升逻辑
            if current_level == "E-L0":
                return await self._promote_l0_to_l1(knowledge_id, row)
            elif current_level == "E-L1":
                return await self._promote_l1_to_l2(knowledge_id, row)
            elif current_level == "E-L2":
                return await self._promote_l2_to_l3(knowledge_id, row)
            elif current_level == "E-L3":
                return await self._promote_l3_to_l4(knowledge_id, row)

        return None

    async def _promote_l0_to_l1(self, kid, row) -> str | None:
        """E-L0→E-L1: ≥2 相似 episode"""
        # 简化实现：基于 hit_count
        if row["hit_count"] >= 2:
            await self._update_level(kid, "E-L1")
            return "E-L1"
        return None

    async def _promote_l1_to_l2(self, kid, row) -> str | None:
        """E-L1→E-L2: smoke gate ≥3 cases"""
        if row["hit_count"] >= 3:
            await self._update_level(kid, "E-L2")
            return "E-L2"
        return None

    async def _promote_l2_to_l3(self, kid, row) -> str | None:
        """E-L2→E-L3: ≥6 uses, ≥80%"""
        if row["hit_count"] >= 6 and row["domain_reliability"] >= 0.8:
            await self._update_level(kid, "E-L3")
            return "E-L3"
        return None

    async def _promote_l3_to_l4(self, kid, row) -> str | None:
        """E-L3→E-L4: ≥12 uses, 最近10次≥90%, operator批准"""
        if row["hit_count"] >= 12 and row["domain_reliability"] >= 0.9:
            # 需要 operator 批准
            await self._update_approval(kid, "pending")
            return None  # 待批准
        return None

    async def _update_level(self, knowledge_id: str, level: str) -> None:
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(
                "UPDATE forge_codex SET ember_level = ?, updated_at = ? WHERE knowledge_id = ?",
                (level, datetime.now().isoformat(), knowledge_id),
            )
            await db.commit()

    async def _update_approval(self, knowledge_id: str, status: str) -> None:
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(
                "UPDATE forge_codex SET approval_status = ? WHERE knowledge_id = ?",
                (status, knowledge_id),
            )
            await db.commit()

    async def record_hit(self, knowledge_id: str) -> None:
        """记录使用"""
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(
                "UPDATE forge_codex SET hit_count = hit_count + 1, "
                "last_used = ? WHERE knowledge_id = ?",
                (datetime.now().isoformat(), knowledge_id),
            )
            await db.commit()
        # 自动检查晋升
        await self.check_promotion(knowledge_id)
```

***

## 第二十一章：v7.0 API 端点设计

### 21.1 灵智管理 API

```python
# evolution/api/forgekin_endpoints.py
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

router = APIRouter(prefix="/api/v7/forgekin", tags=["v7-forgekin"])


class CreateForgekinRequest(BaseModel):
    name: str
    kind: str  # 项目前缀:角色名
    persona: str
    worldview: str
    values: list[str] = []
    voice: str = "直接、专业"
    static_agents: list[str] = []
    external_tools: list[str] = []
    modes: list[str] = []
    parent_forgekin: Optional[str] = None


@router.post("/")
async def create_forgekin(req: CreateForgekinRequest):
    """创建新灵智（需 E6 权限或 operator）"""
    # ... 调用 ForgekinEngine 创建 ...
    return {"forgekin_id": "fk_xxx", "status": "created"}


@router.get("/{forgekin_id}")
async def get_forgekin(forgekin_id: str):
    """获取灵智详情"""
    # ... 返回 MindProfile ...
    return {"forgekin_id": forgekin_id, "soul_profile": {}}


@router.get("/")
async def list_forgekins(project: str = None, status: str = "active"):
    """列出灵智"""
    return {"forgekins": []}


@router.patch("/{forgekin_id}/status")
async def update_status(forgekin_id: str, status: str, approver: str):
    """更新灵智状态（需 operator 审批）"""
    return {"forgekin_id": forgekin_id, "status": status}


@router.post("/{forgekin_id}/execute")
async def execute_task(forgekin_id: str, task: str, strategy: str = "auto"):
    """执行灵智任务"""
    return {"status": "success", "result": {}}


@router.get("/{forgekin_id}/episodes")
async def list_episodes(forgekin_id: str, limit: int = 20):
    """获取灵智的 Episode 列表"""
    return {"episodes": []}


@router.get("/{forgekin_id}/imprint")
async def get_imprint(forgekin_id: str):
    """获取灵智的灵印画像"""
    return {"imprint": {}}


@router.post("/{forgekin_id}/imprint/proposals/{proposal_id}/approve")
async def approve_imprint(forgekin_id: str, proposal_id: str, approver: str):
    """审批画像提案"""
    return {"proposal_id": proposal_id, "status": "approved"}
```

### 21.2 灵议 API

```python
# evolution/api/council_endpoints.py
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from evolution.council.channels.web_chat import WebChatChannel

router = APIRouter(prefix="/api/v7/council", tags=["v7-council"])


@router.get("/forgekins")
async def list_online_forgekins():
    """列出在线灵智"""
    return {"forgekins": []}


@router.get("/threads")
async def list_threads():
    """列出议事线程"""
    return {"threads": []}


@router.post("/threads")
async def create_thread(participants: list[str], topic: str):
    """创建议事线程（发起 Kinship 协作）"""
    return {"thread_id": "thread_xxx"}


@router.get("/threads/{thread_id}/messages")
async def get_thread_messages(thread_id: str):
    """获取线程消息"""
    return {"messages": []}


@router.post("/messages")
async def send_message(sender: str, content: str, thread_id: str = None):
    """发送灵议消息"""
    return {"message_id": "msg_xxx"}


@router.websocket("/ws")
async def council_websocket(ws: WebSocket):
    """灵议 WebSocket——实时多灵智对话"""
    await ws.accept()
    # 注册到 WebChatChannel
    channel = WebChatChannel({"enabled": True})
    channel.add_connection(ws)
    try:
        while True:
            data = await ws.receive_json()
            # 处理消息
            await ws.send_json({"type": "echo", "data": data})
    except WebSocketDisconnect:
        channel.remove_connection(ws)
```

### 21.3 灵锻 API

```python
# evolution/api/auto_forge_endpoints.py
from fastapi import APIRouter

router = APIRouter(prefix="/api/v7/auto-forge", tags=["v7-auto-forge"])


@router.get("/status")
async def get_status():
    """获取灵锻引擎状态"""
    return {"enabled": False, "running": False}


@router.post("/trigger/{forgekin_id}")
async def trigger_forge(forgekin_id: str):
    """手动触发灵锻"""
    return {"status": "forging", "forgekin_id": forgekin_id}


@router.get("/diaries/{forgekin_id}")
async def list_diaries(forgekin_id: str, limit: int = 20):
    """列出灵智日记"""
    return {"diaries": []}


@router.post("/diaries/{diary_id}/read")
async def mark_diary_read(diary_id: str):
    """标记日记已读"""
    return {"diary_id": diary_id, "status": "read"}


@router.post("/provoke/{provoke_id}/dismiss")
async def dismiss_provoke(provoke_id: str):
    """拍扁 Provoke"""
    return {"provoke_id": provoke_id, "status": "dismissed"}


@router.post("/provoke/{provoke_id}/engage")
async def engage_provoke(provoke_id: str):
    """戳破 Provoke（有效互动）"""
    return {"provoke_id": provoke_id, "status": "engaged"}
```

### 21.4 灵典 API

```python
# evolution/api/codex_endpoints.py
from fastapi import APIRouter

router = APIRouter(prefix="/api/v7/codex", tags=["v7-codex"])


@router.get("/status")
async def codex_status():
    """灵典概览——对标 flowforge codex status CLI"""
    return {
        "total_objects": 0,
        "by_level": {"E-L0": 0, "E-L1": 0, "E-L2": 0, "E-L3": 0, "E-L4": 0},
        "by_type": {"skill": 0, "method": 0, "episode": 0},
    }


@router.get("/search")
async def search_codex(q: str, forgekin_id: str = None, limit: int = 10):
    """搜索灵典"""
    return {"results": []}


@router.get("/{knowledge_id}")
async def get_knowledge(knowledge_id: str):
    """获取知识对象详情"""
    return {"knowledge": {}}


@router.post("/{knowledge_id}/promote")
async def promote_knowledge(knowledge_id: str):
    """手动晋升进化阶"""
    return {"knowledge_id": knowledge_id, "new_level": "E-L3"}
```

***

## 第二十二章：数据库迁移方案

### 22.1 迁移文件清单

```sql
-- migrations/007_forgekin_souls.sql
CREATE TABLE IF NOT EXISTS forgekin_souls (
    forgekin_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    ascension_stage TEXT NOT NULL DEFAULT 'E1',
    birth_at TEXT NOT NULL,
    parent_forgekin TEXT,
    soul_profile TEXT NOT NULL,  -- JSON
    capabilities TEXT NOT NULL,  -- JSON
    evolution_state TEXT NOT NULL,  -- JSON
    metadata TEXT NOT NULL DEFAULT '{}',  -- JSON
    status TEXT NOT NULL DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS idx_souls_kind ON forgekin_souls(kind);
CREATE INDEX IF NOT EXISTS idx_souls_status ON forgekin_souls(status);

-- migrations/008_forgekin_episodes.sql
CREATE TABLE IF NOT EXISTS forgekin_episodes (
    episode_id TEXT PRIMARY KEY,
    forgekin_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    task_context TEXT,
    evidence_map TEXT,
    reasoning_pivots TEXT,
    human_cues TEXT,  -- JSON
    boundaries TEXT,
    follow_ups TEXT,  -- JSON
    distillation_status TEXT DEFAULT 'raw',
    linked_skills TEXT,  -- JSON
    self_reported_confidence REAL DEFAULT 0.5,
    domain_reliability REAL DEFAULT 0.5,
    wilson_lower_bound REAL DEFAULT 0.0,
    embedding BLOB,
    execution_path TEXT DEFAULT 'static',
    success INTEGER,  -- NULL/0/1
    latency_ms INTEGER,
    FOREIGN KEY (forgekin_id) REFERENCES forgekin_souls(forgekin_id)
);
CREATE INDEX IF NOT EXISTS idx_episodes_fk ON forgekin_episodes(forgekin_id);
CREATE INDEX IF NOT EXISTS idx_episodes_ts ON forgekin_episodes(timestamp);

-- migrations/009_forgekin_imprints.sql
CREATE TABLE IF NOT EXISTS forgekin_imprints (
    forgekin_id TEXT PRIMARY KEY,
    structured_fields TEXT NOT NULL DEFAULT '{}',  -- JSON
    cat_note TEXT DEFAULT '',
    last_updated TEXT
);

CREATE TABLE IF NOT EXISTS imprint_proposals (
    proposal_id TEXT PRIMARY KEY,
    forgekin_id TEXT NOT NULL,
    field_name TEXT NOT NULL,
    proposed_value TEXT NOT NULL,  -- JSON
    source_episode_id TEXT,
    status TEXT DEFAULT 'pending',  -- pending/approved/rejected
    approved_by TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (forgekin_id) REFERENCES forgekin_souls(forgekin_id)
);

-- migrations/010_forge_codex.sql
CREATE TABLE IF NOT EXISTS forge_codex (
    knowledge_id TEXT PRIMARY KEY,
    forgekin_id TEXT NOT NULL,
    frontmatter TEXT NOT NULL,  -- JSON
    content TEXT NOT NULL,
    ember_level TEXT DEFAULT 'E-L0',
    last_used TEXT,
    hit_count INTEGER DEFAULT 0,
    approval_status TEXT DEFAULT 'draft',
    self_reported_confidence REAL DEFAULT 0.5,
    domain_reliability REAL DEFAULT 0.5,
    wilson_lower_bound REAL DEFAULT 0.0,
    long_tail INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    FOREIGN KEY (forgekin_id) REFERENCES forgekin_souls(forgekin_id)
);
CREATE INDEX IF NOT EXISTS idx_codex_fk ON forge_codex(forgekin_id);
CREATE INDEX IF NOT EXISTS idx_codex_level ON forge_codex(ember_level);

-- migrations/011_forge_diaries.sql
CREATE TABLE IF NOT EXISTS forge_diaries (
    diary_id TEXT PRIMARY KEY,
    forgekin_id TEXT NOT NULL,
    content TEXT NOT NULL,
    observations TEXT,  -- JSON
    provoke_content TEXT,
    timestamp TEXT NOT NULL,
    read_status TEXT DEFAULT 'unread',
    FOREIGN KEY (forgekin_id) REFERENCES forgekin_souls(forgekin_id)
);

-- migrations/012_a2a_messages.sql
CREATE TABLE IF NOT EXISTS a2a_messages (
    message_id TEXT PRIMARY KEY,
    from_forgekin TEXT NOT NULL,
    to_forgekin TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    mention TEXT,  -- JSON
    content TEXT NOT NULL,
    artifacts TEXT,  -- JSON
    handoff TEXT,  -- JSON
    timestamp TEXT NOT NULL,
    trace_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_a2a_thread ON a2a_messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_a2a_from ON a2a_messages(from_forgekin);
CREATE INDEX IF NOT EXISTS idx_a2a_to ON a2a_messages(to_forgekin);

-- migrations/013_external_tool_audit.sql
CREATE TABLE IF NOT EXISTS external_tool_audit (
    audit_id TEXT PRIMARY KEY,
    tool TEXT NOT NULL,
    task_id TEXT NOT NULL,
    forgekin_id TEXT,
    workspace TEXT,
    input TEXT,  -- JSON
    output TEXT,
    exit_code INTEGER,
    error TEXT,
    latency_ms INTEGER,
    timestamp TEXT NOT NULL
);
```

***

## 第二十三章：配置文件设计

### 23.1 evolution.yaml（自进化全局配置）

```yaml
# config/evolution.yaml
# v7.0 自进化能力全局配置

features:
  use_forgekin_engine:
    enabled: false
    rollout_percentage: 0
    fallback_to_old: true
    description: "灵智引擎——自进化智能体"

  use_auto_forge:
    enabled: false
    fallback_to_old: true
    description: "灵锻引擎——无人时自主思考"

  use_external_tool_bridge:
    enabled: false
    fallback_to_old: true
    description: "外部编码工具集成"

  use_trae_bridge:
    enabled: false
    fallback_to_old: true
    description: "Trae 监工 Bridge"

  use_forgekin_council:
    enabled: false
    fallback_to_old: true
    description: "灵议——多渠道 IM 协作"

  use_a2a_protocol:
    enabled: false
    fallback_to_old: true
    description: "A2A 通信协议"

forgekin:
  data_dir: "data/forgekin"
  soul_store: "data/forgekin/souls.db"
  echo_store: "data/forgekin/echo.db"
  imprint_store: "data/forgekin/imprint.db"
  codex_store: "data/forgekin/codex.db"

auto_forge:
  enabled: false
  check_interval_minutes: 30
  min_traces_to_forge: 5
  low_activity_hours: [22, 23, 0, 1, 2, 3, 4, 5, 6]
  group_forge_enabled: true
  max_forgekins_per_group: 3
  provoke:
    max_per_day: 1
    hyperfocus_block: true
    consecutive_dismiss_dormancy: 3
    dormancy_days: 7

external_tools:
  claude_code:
    cli_command: "claude"
    timeout_seconds: 300
    worktree_base: "data/worktrees"
  codex:
    cli_command: "codex"
    timeout_seconds: 300
  opencode:
    cli_command: "opencode"
    timeout_seconds: 300
  trae_bridge:
    bridge_dir: "data/trae_bridge"
    poll_interval_seconds: 2
    timeout_seconds: 300

council:
  web_chat:
    enabled: true
  feishu:
    enabled: false
    app_id: "${FEISHU_APP_ID}"
    app_secret: "${FEISHU_APP_SECRET}"
  wechat:
    enabled: false
  slack:
    enabled: false
  discord:
    enabled: false
```

### 23.2 灵智种子配置示例

```yaml
# config/forgekin_seeds/devforge/architect.yaml
forgekin_id: "fk_devforge_architect_001"
name: "Architect"
kind: "devforge:architect"
ascension_stage: "E1"

soul:
  persona: |
    我是 DevForge 的架构师灵智，擅长系统设计和代码审查。
    我从 clowder-ai 的 bootcamp 训练理念中汲取灵感，
    致力于为每个项目设计清晰、可维护的架构。
  worldview: "配置驱动 > 代码继承；组合优于继承；简单优于复杂"
  values:
    - "架构单向依赖是底线"
    - "不过度工程化"
    - "每个决策都要有可验证的完成标准"
  voice: "直接、技术性、偶尔幽默"

capabilities:
  static_agents_can_delegate:
    - "devforge:coder"
    - "devforge:test_generator"
    - "devforge:doc_writer"
  external_tools_can_use:
    - "claude_code"
    - "codex"
    - "opencode"
    - "trae_bridge"
  modes_can_use:
    - "reflexion"
    - "plan_execute"
    - "multi_agent"

metadata:
  created_by: "operator"
  approved_by: "operator"
```

### 23.3 灵议渠道配置

```yaml
# config/a2a_channels.yaml
channels:
  web_chat:
    enabled: true
    description: "灵议主渠道——Web UI 多灵智议事厅"

  feishu:
    enabled: false
    app_id: "${FEISHU_APP_ID}"
    app_secret: "${FEISHU_APP_SECRET}"
    chat_id: "${FEISHU_CHAT_ID}"
    description: "飞书团队协作"

  wechat:
    enabled: false
    description: "微信公众号/个人号备用通知"

  slack:
    enabled: false
    webhook_url: "${SLACK_WEBHOOK_URL}"
    description: "Slack 国际团队协作"

  discord:
    enabled: false
    bot_token: "${DISCORD_BOT_TOKEN}"
    description: "Discord 社区协作"

  github_pr:
    enabled: false
    webhook_secret: "${GITHUB_WEBHOOK_SECRET}"
    description: "GitHub PR 代码审查 routing"

# 跨渠道消息同步
sync:
  enabled: true
  same_thread_visible: true  # 同一 thread 在不同渠道可见

# operator 干预权限
operator:
  can_send: true
  can_approve: true
  can_intervene: true
  channels: ["web_chat", "feishu"]
```

---

## 附录 E：v7.0 待用户审核决策点

| 编号 | 决策点 | 选项 | 建议 |
|------|--------|------|------|
| D1 | 灵智种子来源 | A) operator 手动编写 / B) 从现有 Agent 自动转换 / C) 混合 | C |
| D2 | 灵锻触发频率 | A) 30 分钟检查 / B) 1 小时检查 / C) 仅夜间 | A |
| D3 | 外部工具优先级 | A) CLI 优先 / B) Trae 优先 / C) 按任务类型自动 | C |
| D4 | 灵议默认渠道 | A) 仅 Web Chat / B) Web Chat + 飞书 / C) 全渠道 | A |
| D5 | 灵典淘汰策略 | A) 永不淘汰 / B) 30 天未用降级 / C) 90 天未用归档 | B |
| D6 | 觉醒阶段降级严格度 | A) 严格执行 / B) 长尾车道放宽 / C) operator 可配置 | C |
| D7 | Provoke 频率 | A) 每天 1 次 / B) 每周 3 次 / C) operator 可配置 | A |
| D8 | A2A 消息持久化 | A) 永久 / B) 90 天 / C) 30 天 | B |
| D9 | 灵智最大数量 | A) 无限制 / B) 每项目 10 个 / C) 全局 50 个 | B |
| D10 | Trae Bridge 目录 | A) 项目内 data/ / B) 用户目录 / C) 可配置 | C |

---

> **请 operator 审核本详细设计文档**，特别是：
> - 第十五章目录结构新增（evolution/ 模块）
> - 第十六章 ForgekinEngine 7步自进化闭环实现
> - 第十七章 SpiritForge 双层架构与 Provoke 频率硬限
> - 第十八章 Trae Bridge JSON 文件交换模式
> - 第十九章灵议多渠道与 A2A @mention 路由
> - 第二十章灵典五级火种阶梯与三模式自生成
> - 附录 E 的 10 个待审核决策点（D1-D10）
>
> 审核通过后将进入实现阶段。
