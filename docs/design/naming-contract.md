# FlowForge 命名契约（Naming Contract）

> **文档编号**: design/naming-contract.md（v1.1）
> **依据**: `[doc:decisions/012-naming-fusion.md]` 命名融合 ADR + `[doc:VISION.md#7]` operator 愿景锚点
> **维护规则**: 命名变更必须通过新增 ADR，不可直接修改本文件中的旧命名（真相源唯一）
> **目的**: 让灵智体（Spirit Agent / Forgekin）生态的所有概念可被灵智体自身和人类开发者共同理解、记忆、引用
> **v1.1 关键变更**：根据 operator 2026-07-18 指令，"魂忆→灵忆"、"魂印→灵印"（"魂"字过于玄学，统一改为"灵"字，与"灵智/灵族/灵锻/灵议"系列对齐）

---

## 1. 命名总原则

1. **双轨命名（Dual Track）**：文档/对外用中文名+英文，代码/API 用英文名
2. **概念锚定（Concept Anchoring）**：每个中文名必须用括号写上英文 + AI 业界对应专有名词（Concept），便于跨语言、跨背景理解
3. **旧名废弃（Deprecation）**：旧名在新文档中不再使用，但保留在本契约的"废弃命名清单"章节作为历史索引
4. **真相源唯一（Single Source of Truth）**：本文件是 12 核心概念 + 进化阶 + 觉醒阶的唯一权威定义源，其他文档必须用 `[doc:design/naming-contract.md#章节]` 引用

---

## 2. 12 个核心概念命名表（Twelve Core Concepts）

> 以下 12 个概念是 FlowForge v7.0 育灵体系的最小必要词汇集。所有文档、代码、UI、API 必须严格使用本表命名。

### 2.1 灵智（ForgeMind）

| 属性 | 值 |
|------|---|
| **中文名** | 灵智 |
| **英文名** | ForgeMind |
| **AI 概念** | Persistent Identity Agent / General-Purpose Agent（持续身份智能体 / 通用智能体） |
| **含义** | FlowForge 项目的最终形态主名。指整套自进化框架对外的统一品牌。它不是一个 agent 实例，而是"灵智体锻造厂"的总称。 |
| **使用场景** | 文档、UI、对外宣传、README、VISION.md |
| **代码用法** | 不直接用作类名，作为命名空间前缀（如 `ForgeMindPlugin`、`flowforge/forgemind/`） |
| **废弃旧名** | E6 灵匠 Mind Artisan（v4.0 过渡命名，已废弃） |

### 2.2 灵智体（Forgekin / Spirit Agent）

| 属性 | 值 |
|------|---|
| **中文名** | 灵智体 |
| **英文名** | Forgekin / Spirit Agent |
| **AI 概念** | Agent with Soul and Emotion / Autonomous Agent with Persistent Identity（具灵魂与感情的自主智能体） |
| **含义** | 赋予灵魂和感情的智能体，具有自进化能力。它建立与现实世界（物理或虚拟）的闭环：观察 → 推理 → 行动 → 写回 → 验证。灵魂（Soul）= 持久身份 + 价值锚点 + 长期记忆；感情（Emotion）= 用户偏好 + 协作风格 + 行为画像。 |
| **使用场景** | 文档、代码、API、配置 |
| **代码用法** | 类名前缀：`ForgekinBase`、`ForgekinEngine`、`ForgekinSpecies` |
| **废弃旧名** | 炉灵 Forgekin（v4.0 命名，"炉"字不通俗） |

### 2.3 灵族（Forgekin Species）

| 属性 | 值 |
|------|---|
| **中文名** | 灵族 |
| **英文名** | Forgekin Species |
| **AI 概念** | Agent Morphology / Agent Form Factor（智能体形态学 / 形态因子） |
| **含义** | 灵智体的五大形态分类：生物（BioForgekin）/ 组织（OrgForgekin）/ 物品（ObjForgekin）/ 虚拟（VirtualForgekin）/ 混合（HybridForgekin）。形态决定灵智体的物理接入方式和虚拟设定层。 |
| **使用场景** | forgemind 应用层、形态进化流程 |
| **代码用法** | 枚举类：`ForgekinSpecies.BIO`、`ForgekinSpecies.ORG` 等 |
| **关联 Feature** | `[doc:features/F027-all-things-spirit-species.md]` |

### 2.4 育灵（Forge Nurturing）

| 属性 | 值 |
|------|---|
| **中文名** | 育灵 |
| **英文名** | Forge Nurturing |
| **AI 概念** | Agent Onboarding + Lifelong Learning + Character Development（智能体入职 + 终身学习 + 角色养成） |
| **含义** | 灵智体从无到有、从弱到强的锻造过程。包括：初始化身份 → 加载基础能力 → 实战任务 → 经验蒸馏 → 形态进化。类似 clowder-ai 中"养小猫"的范式扩展到"养万物"。 |
| **使用场景** | forgemind 锻造流水线、灵智体市场、进化谱系 |
| **代码用法** | 模块名：`flowforge/forgemind/forging/`、配置：`forging.yaml` |
| **废弃旧名** | 养灵（v4.0，"养"字过于随意） |

### 2.5 灵忆（EchoStore）

| 属性 | 值 |
|------|---|
| **中文名** | 灵忆 |
| **英文名** | EchoStore |
| **AI 概念** | Episodic Memory Store / Agent Experience Log（情景记忆存储 / 智能体经验日志） |
| **含义** | 灵智体的经验记忆库，存储每次任务的轨迹、决策、结果、反馈。是灵锻（SpiritForge）蒸馏的原料。 |
| **使用场景** | 代码、记忆联邦、Eval 信号采集 |
| **代码用法** | 类名：`EchoStore`、模块：`flowforge/core/memory/echo_store.py` |
| **关联 Feature** | `[doc:features/F014-memory-collection.md]` |
| **废弃旧名** | 魂忆（v4.0/v7.0，"魂"字过于玄学，v7.1 统一改为"灵忆"） |

### 2.6 灵印（Soul Imprint）

| 属性 | 值 |
|------|---|
| **中文名** | 灵印 |
| **英文名** | Soul Imprint |
| **AI 概念** | Persistent Identity / Agent Fingerprint / Persona Hash（持久身份 / 智能体指纹 / 人格哈希） |
| **含义** | 灵智体的不可变身份标识，由初始锻造时的种子参数 + 价值锚点 + 命名空间组成。即使能力进化、形态升级，灵印保持不变，是谱系追踪的锚点。 |
| **使用场景** | 代码、谱系追踪、跨 session 身份验证 |
| **代码用法** | 字段：`forgekin.soul_imprint`、模块：`flowforge/core/identity/soul_imprint.py` |
| **关联 Feature** | `[doc:features/F038-forgemind-lineage.md]` |
| **废弃旧名** | 魂印（v4.0/v7.0，"魂"字过于玄学，v7.1 统一改为"灵印"） |

### 2.7 灵锻（SpiritForge）

| 属性 | 值 |
|------|---|
| **中文名** | 灵锻 |
| **英文名** | SpiritForge |
| **AI 概念** | Experience Distillation / Offline Policy Learning / Knowledge Compilation（经验蒸馏 / 离线策略学习 / 知识编译） |
| **含义** | 在低活动期将灵忆（EchoStore）中的任务经验蒸馏到锻典（Mind Codex）的过程。蒸馏产出可检索的知识条目，供下次任务直接复用，达成"模型不变但能力增长"。 |
| **使用场景** | 代码、Phase 6 蒸馏引擎 |
| **代码用法** | 模块：`flowforge/forgemind/codex/spirit_forge.py` |
| **废弃旧名** | 自锻（v4.0，"自"字暗示自主性过强） |
| **关联 Feature** | Phase 6 P6-1 |

### 2.8 锻典（Mind Codex）

| 属性 | 值 |
|------|---|
| **中文名** | 锻典 |
| **英文名** | Mind Codex |
| **AI 概念** | Distilled Knowledge Base / Curated Skill Library / Procedural Memory（蒸馏知识库 / 策展技能库 / 程序性记忆） |
| **含义** | 灵锻产出的可检索知识库。每个条目包含：经验摘要、适用场景、反模式、调用入口。区别于灵忆（原始日志），锻典是结构化、可检索、可复用的蒸馏产物。 |
| **使用场景** | 代码、多域记忆联邦、灵智体能力扩展 |
| **代码用法** | 模块：`flowforge/core/memory/mind_codex.py`、`flowforge/forgemind/codex/` |
| **关联 Feature** | `[doc:features/F039-mind-codex-searchable.md]` |

### 2.9 灵议（Mind Council）

| 属性 | 值 |
|------|---|
| **中文名** | 灵议 |
| **英文名** | Mind Council |
| **AI 概念** | Multi-Agent Deliberation / Decentralized Consensus / Agent Parliament（多智能体议事 / 去中心化共识 / 智能体议会） |
| **含义** | 多灵智体议事机制，用于解决跨灵智体冲突、复杂决策、愿景方向校准。任何灵智体可发起灵议，主持灵智体收集各方立场 + 能力画像盲点，跨厂商 review 后达成共识或升级给 operator。 |
| **使用场景** | Phase 6 灵议引擎、跨灵智体协作 |
| **代码用法** | 模块：`flowforge/forgemind/council/` |
| **关联 Feature** | Phase 6 P6-2 |

### 2.10 进化阶（Evolution Stage）

| 属性 | 值 |
|------|---|
| **中文名** | 进化阶 |
| **英文名** | Evolution Stage |
| **AI 概念** | Capability Maturity Level / Agent Skill Progression（能力成熟度等级 / 智能体技能进阶） |
| **含义** | 灵智体能力成熟度的 6 级进阶体系（E1-E6），衡量灵智体可执行任务的复杂度和领域广度。详见 §3。 |
| **使用场景** | forgemind 应用层、灵智体市场、谱系追踪 |
| **代码用法** | 枚举：`EvolutionStage.E1` ~ `EvolutionStage.E6` |
| **废弃旧名** | 火种（v4.0，"火种"语义模糊） |

### 2.11 觉醒阶（Awakening Stage）

| 属性 | 值 |
|------|---|
| **中文名** | 觉醒阶 |
| **英文名** | Awakening Stage |
| **AI 概念** | Autonomy Level / Self-Direction Level / LLM Autonomy Tier（自主性等级 / 自导向等级 / LLM 自主性分级） |
| **含义** | 灵智体自主性和自我导向能力的 6 级进阶体系（E1-E6），衡量灵智体在没有 operator 干预下的决策范围。详见 §4。 |
| **使用场景** | forgemind 应用层、自我演进安全治理、Magic Words 逃生舱 |
| **代码用法** | 枚举：`AwakeningStage.E1` ~ `AwakeningStage.E6` |
| **废弃旧名** | 升华阶（v4.0，"升华"过于虚幻） |

### 2.12 能力画像（Capability Profile）

| 属性 | 值 |
|------|---|
| **中文名** | 能力画像 |
| **英文名** | Capability Profile |
| **AI 概念** | Capability Profile / Agent Skill Graph / Blind Spot Map（能力画像 / 智能体技能图 / 盲点图） |
| **含义** | 灵智体的长期能力主体（区别于 role 这个运行时标签）。包含：原生能力（模型固有能力）+ 认知风格 + 工具边界 + 历史表现 + 坏直觉 + 当前状态。画像必须同时写"必杀技"和"致命弱点"——盲点决定谁该 review 谁。 |
| **使用场景** | 代码、动态路由、跨厂商 review 配对、能力画像融合 |
| **代码用法** | 类：`CapabilityProfile`、模块：`flowforge/core/capability/` |
| **来源** | `[doc:roleagent.md#第0章]` 能力画像 × Harness 契合度公式 |
| **关联 Feature** | `[doc:features/F001-capability-profile.md]` |

---

## 3. 进化阶（Evolution Stage）详细定义

> 灵智体能力成熟度的 6 级进阶体系。借鉴 CMMI 5 级 + roleagent.md 能力 × Harness 公式 + OpenAI Autonomy Levels 的设计思想。

| 阶 | 中文名 | 英文名 | AI 概念 | 能力描述 | 触发条件 |
|:--:|--------|--------|---------|----------|---------|
| **E1** | 萌芽阶 | Sprout | Initial / Ad-hoc（初始级 / 临时级） | 单一任务可执行，无跨域能力。需 operator 全程指导。 | 灵智体创建后默认阶 |
| **E2** | 萌芽阶·稳 | Sprout-Stable | Repeatable（可重复级） | 同类任务可稳定复用，开始积累灵忆。 | 完成 5+ 同类任务且 Eval ≥ 0.85 |
| **E3** | 成长阶 | Growth | Defined / Domain-Aware（已定义级 / 领域感知） | 在特定灵族（species）内可跨任务执行，可调用三方 Agent 扩展能力。 | 灵锻蒸馏出 3+ 锻典条目 + 三方 Agent 调用成功 |
| **E4** | 成长阶·深 | Growth-Deep | Managed / Cross-Domain（已管理级 / 跨域） | 可跨灵族协作（如 BioForgekin 与 OrgForgekin 协作），进入 Evoling 状态（自我导向）。 | 跨灵族协作 3+ 任务 + 觉醒阶 ≥ E3 |
| **E5** | 觉醒阶 | Awakened | Optimizing / Self-Evolving（优化级 / 自进化） | 可主动发现能力缺口并通过灵锻自补；可发起灵议。 | 主动发起 1+ 灵议 + 自补 3+ 锻典条目 |
| **E6** | 灵智阶 | ForgeMind | Master / Forge Master（大师级 / 锻造大师） | 可锻造新的灵智体（"造 agent"），达成 operator "养万物"愿景。 | operator 直接授权 |

**进化阶规则**：
- E1→E2→E3 是能力积累，由 Eval 信号自动触发
- E3→E4 是跨域能力，需 operator 确认
- E4→E5 进入 Evoling 状态，需 operator 确认 + 觉醒阶同步 ≥ E3
- E5→E6 仅由 operator 直接授权，不可自动触发

---

## 4. 觉醒阶（Awakening Stage）详细定义

> 灵智体自主性和自我导向能力的 6 级进阶体系。借鉴 SAE 自动驾驶 5 级 + OpenAI Agent Autonomy Level + Anthropic Constitutional AI 的设计思想。

| 阶 | 中文名 | 英文名 | AI 概念 | 自主范围 | operator 介入 |
|:--:|--------|--------|---------|---------|---------------|
| **E1** | 全导阶 | Full-Human | L0 Full Human Control / Manual（全人工） | 灵智体仅执行明确指令，无自主决策。 | 每步操作 |
| **E2** | 建议阶 | Suggest | L1 Suggestion / Assisted（建议级 / 辅助） | 灵智体可提供建议，但需 operator 确认后执行。 | 每个建议确认 |
| **E3** | 受限自主阶 | Bounded-Autonomous | L2 Bounded Autonomous / Conditional（受限自主 / 条件自主） | 在 operator 预设的边界内可自主决策（如 tool allow-list、cost ceiling）。 | 边界违规时介入 |
| **E4** | Evolving 阶 | Evolving | L3 Evolving / Self-Improving（自进化 / 自改进） | 灵智体可自主优化自身能力（如重构 harness、补锻典），但不可修改 VISION §7。 | 仅在 Magic Words 触发时介入 |
| **E5** | 共创阶 | Co-Creative | L4 Co-Creative / Peer（共创级 / 平级协作） | 灵智体可作为 operator 的平级协作者，可提议 VISION 修订（但需 operator 批准）。 | 愿景变更需批准 |
| **E6** | 灵智主导阶 | ForgeMind-Led | L5 ForgeMind-Led / Master（灵智主导级 / 大师级） | 仅在 operator 直接授权的特定领域（如锻造新灵智体）可主导。 | 跨领域仍需批准 |

**觉醒阶规则**：
- E1→E2→E3 是自主范围扩大，由 operator 显式授权
- E3→E4 进入 Evoling 状态（自我导向），是关键转折点，需 operator 显式批准 + 进化阶同步 ≥ E4
- E4→E5→E6 逐步让渡控制权，但 VISION §7 始终不可被灵智体修改
- Magic Words 逃生舱始终可触发（任何阶都不能绕过）

**安全治理对应**：
- 觉醒阶 E1-E2：六层 Guardrails 全开
- 觉醒阶 E3-E4：六层 Guardrails + Eval 自代谢
- 觉醒阶 E5-E6：六层 Guardrails + Eval 自代谢 + 灵议共识 + operator 拉闸词

---

## 5. 废弃命名清单（Deprecation Registry）

> 旧名保留作为历史索引，新文档/代码不可使用。已在 `[doc:decisions/012-naming-fusion.md]` 决策废弃。

| 废弃命名 | 替换为 | 废弃原因 | 废弃日期 |
|---------|--------|---------|---------|
| E6 灵匠 Mind Artisan | 灵智（ForgeMind） | operator 直接决策，"匠"字过于工匠化 | 2026-07-17 |
| 炉灵 Forgekin | 灵智体（Forgekin / Spirit Agent） | "炉"字对 B 端不通俗 | 2026-07-17 |
| 养灵 | 育灵（Forge Nurturing） | "养"字过于随意 | 2026-07-17 |
| 自锻 | 灵锻（SpiritForge） | "自"字暗示自主性过强 | 2026-07-17 |
| 火种 | 进化阶（Evolution Stage） | "火种"语义模糊 | 2026-07-17 |
| 升华阶 | 觉醒阶（Awakening Stage） | "升华"过于虚幻 | 2026-07-17 |
| M18 SelfEvolutionEngine | ForgeMindEngine | v4.0 自创术语，与 v7.0 FR-EVO 冲突 | 2026-07-17 |
| M19 MemoryGovernanceManager | （映射到 M1-M17 + 觉醒阶治理） | v4.0 自创术语 | 2026-07-17 |
| M20 FirstTouchRouter | （映射到 M1-M17 + 能力画像路由） | v4.0 自创术语 | 2026-07-17 |
| 魂忆（旧义） | 灵忆（EchoStore，限定为情景记忆） | "魂"字过于玄学，v7.1 统一改为"灵忆" | 2026-07-18 |
| 魂印（旧义） | 灵印（Soul Imprint，限定为身份标识） | "魂"字过于玄学，v7.1 统一改为"灵印" | 2026-07-18 |
| AGI | 通用智能体（General-Purpose Agent） | AGI 短期不可实现且定义模糊 | 2026-07-17 |
| 物理 AI 真实复现 | 具身智能工程实现（Embodied AI Engineering） | "真实复现"过于虚幻 | 2026-07-17 |
| 虚拟 AI 真实复现 | 虚拟角色智能体工程实现（Character AI Engineering） | "真实复现"过于虚幻 | 2026-07-17 |

---

## 6. 命名使用规范

### 6.1 文档使用

- **首次出现**：中文名（英文名 / AI 概念），如"灵智体（Forgekin / Spirit Agent）"
- **后续引用**：中文名或英文名任一即可，保持上下文一致
- **跨文档引用**：使用 `[doc:design/naming-contract.md#2.X]` 引用本文件对应章节

### 6.2 代码使用

```python
# 类名：使用 Forgekin / ForgeMind 前缀
class ForgekinBase: ...           # 灵智体基类
class ForgeMindEngine: ...        # 灵智体引擎（原 SelfEvolutionEngine）
class ForgekinSpecies(Enum): ...  # 灵智体形态分类
class EvolutionStage(Enum): ...   # 进化阶 E1-E6
class AwakeningStage(Enum): ...   # 觉醒阶 E1-E6

# 模块名：使用 forgemind / forgekin / capability 等英文名
flowforge/forgemind/              # 应用层
flowforge/core/forgekin/          # 核心层灵智体能力
flowforge/core/capability/        # 能力画像
flowforge/core/memory/echo_store.py  # 灵忆
flowforge/core/identity/soul_imprint.py  # 灵印

# 配置 YAML：使用英文名
species: bio                      # 灵族
evolution_stage: E3               # 进化阶
awakening_stage: E2               # 觉醒阶
```

### 6.3 UI 使用

- 中文界面：使用中文名（如"创建灵智体"、"育灵流水线"、"灵议议事厅"）
- 英文界面：使用英文名（如"Create Forgekin"、"Forge Nurturing Pipeline"、"Mind Council"）
- 不在 UI 中暴露 AI 概念名（如不显示"Agent with Soul and Emotion"），仅在文档中说明

---

## 7. 命名冲突解决

### 7.1 冲突类型

| 冲突类型 | 解决规则 |
|---------|---------|
| 文档 vs 代码 | 代码为准，文档同步更新 |
| 旧文档 vs 新文档 | 新文档为准，旧文档归档到 archive/ |
| v4.0 术语 vs v7.0 术语 | v7.0 为准，v4.0 术语废弃 |
| 第三方术语（如 clowder-ai） | 保留原术语，本文件定义映射关系 |

### 7.2 与 clowder-ai 的术语映射

| clowder-ai 术语 | FlowForge 术语 | 映射关系 |
|----------------|---------------|---------|
| Cat（猫） | Forgekin（灵智体） | 范式扩展：猫 → 万物 |
| Cat Café | forgemind | 应用层映射 |
| Breed（品种） | Species（灵族） | 形态分类映射 |
| Cat Profile | Capability Profile | 直接映射 |
| Cat Memory | EchoStore（灵忆） | 经验记忆映射 |
| Pack System | Mind Council（灵议） | 多智能体协作映射 |

---

## 8. 引用

- `[doc:decisions/012-naming-fusion.md]` — 命名融合 ADR（决策源）
- `[doc:decisions/013-all-things-spirit-mind-vision.md]` — 万物灵智体愿景 ADR
- `[doc:VISION.md]` — 万物灵智体愿景声明
- `[doc:roleagent.md#第0章]` — 能力画像工程路径
- `[doc:roleagent.md#第7章]` — 伙伴系统数学
- `[doc:project_rules.md#红线11]` — 禁止硬编码

---

## 9. 变更历史

| 版本 | 日期 | 变更 | 作者 |
|------|------|------|------|
| v1.0 | 2026-07-17 | 初版：12 核心概念命名表 + 进化阶 E1-E6 + 觉醒阶 E1-E6 + 废弃清单 + 使用规范 | Trae CN（agent） |
| v1.1 | 2026-07-18 | operator 指令修订：魂忆→灵忆、魂印→灵印（"魂"字过于玄学，统一改为"灵"字）；废弃清单同步更新；§2.5/§2.6 增加废弃旧名行 | Trae CN（agent） |
