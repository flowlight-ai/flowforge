# 第零部分：v7.0 增补规范（可进化智能体体系重构）

> **版本**: v7.0 增补章节
> **创建日期**: 2026-07-17
> **审核状态**: ✅ operator 已审核通过命名方案 + 体系设计
> **依据**: `flowforge/docs/review/review.md` 第六章/第八章/第九章 + ADR 005/006/012/013 + `flowforge/docs/roleagent.md`
> **不可变**: 命名变更需 operator 直接决策，不能由灵智体自我演进修改
> **设计态声明**: 本部分可进化智能体设计处于"设计态"（详见 §0.6），未实现部分必须标注"设计态"，禁止虚假承诺
> **术语说明**: 依据 [doc:rules/11-doc-layering.md#11.5] 第 6 条，对外宣称用"可进化智能体（Evolvable Agent）"，内部体系保留"灵智体"作为社区别名

---

## §0.1 v7.0 育灵体系命名规范

> 按 operator 指令：火种→进化、养灵→育灵、炉灵→灵智、去魂字去炉字。主名定为 **灵智 ForgeMind**，融入 Forgekin/SpiritForge/Evoling 三个名称到体系不同阶段。

### §0.1.1 双轨命名策略

| 层级 | 使用场景 | 命名风格 | 示例 |
|------|---------|---------|------|
| **产品层** | 用户界面、营销材料、对外文档 | **灵智（ForgeMind）** | "创建一个新灵智"、"灵智 fk_writer_001 已晋升 E4" |
| **代码层** | 类名、变量名、配置项、API 路径 | **Forgekin** | `ForgekinEngine`、`forgekin_id`、`/api/v7/forgekins` |
| **文档层** | 设计文档、技术规范 | **灵智（ForgeMind）/ Forgekin** 双标注 | "灵智（Forgekin 实例）" |
| **社区层** | 开源宣传、技术博客 | **ForgeMind** | "FlowForge ForgeMind: Self-Evolving Agent" |

**双轨优势**：零代码迁移成本（Forgekin 类名保留）+ 产品品牌升级（对外用 ForgeMind）+ 双轨可平滑过渡。

### §0.1.2 12 个核心概念命名表（终稿）

| # | 概念 | 原中文 | 原英文 | **新中文** | **新英文** | 说明 |
|---|------|--------|--------|-----------|-----------|------|
| 1 | 个体 | 炉灵 | Forgekin | **灵智** | **ForgeMind**（产品）/ Forgekin（代码） | 产品层主名，去炉字 |
| 2 | 群体 | 灵族 | Kinship | **灵群** | **ForgeKinship** | 保留 Kinship 体现"同类" |
| 3 | 养成 | 养灵 | Forge Nurturing | **育灵** | **Forge Nurturing** | "育"替代"养"，更主动 |
| 4 | 入门训练 | 炉启 | Forge Initiation | **灵启** | **Mind Initiation** | 去炉字，借鉴"启智" |
| 5 | 协作模式 | 共鸣 | Resonance | **共鸣** | **Resonance** | 保留原术语 |
| 6 | 自主思考 | 自锻 | Auto-Forge | **灵锻** | **SpiritForge** | 融入 SpiritForge，替代 Auto-Forge |
| 7 | 记忆 | 魂忆 | Soul Echo | **灵忆** | **Mind Echo** | 去魂字，Mind 替代 Soul |
| 8 | 画像 | 魂印 | Soul Imprint | **灵印** | **Mind Imprint** | 去魂字，Soul→Mind |
| 9 | 技能库 | 锻典 | Forge Codex | **灵典** | **Mind Codex** | 去锻字，保留 Codex |
| 10 | 知识阶梯 | 火种等级 | Ember Hierarchy | **进化阶** | **Evolution Hierarchy** | 火种→进化 |
| 11 | 成长阶段 | 升华阶 | Ascension Stages | **觉醒阶** | **Awakening Stages** | 升华→觉醒，E4+ 进入 Evoling |
| 12 | IM 议事 | 灵议 | Forgekin Council | **灵议** | **Mind Council** | 保留中文，英文 Forgekin→Mind |

### §0.1.3 进化阶（Evolution Hierarchy）E-L0~L4 命名表

> 衡量"知识成熟度"，与觉醒阶（衡量灵智整体成长）通过 L 前缀区分。进化阶 E-L4 对应觉醒阶 E4。

| 等级 | 原名 | 新名 | 含义 |
|------|------|------|------|
| E-L0 | Spark 火种 | **Seed 萌芽** | 初始知识，刚通过灵启训练 |
| E-L1 | Ember 余烬 | **Sprout 萌发** | 基础经验积累，开始自主思考 |
| E-L2 | Flame 火焰 | **Bloom 绽放** | 中级知识，可蒸馏技能 |
| E-L3 | Blaze 烈焰 | **Thrive 繁茂** | 高级知识，可指导其他灵智 |
| E-L4 | Forge Fire 锻火 | **Evolve 进化** | 顶级知识，可自主创新技能 |

### §0.1.4 觉醒阶（Awakening Stages）E1-E6 命名表

> 衡量"灵智整体成长"。E3→E4 是关键转换点，灵智从"锻灵 Forgekin"形态进化为"进化体 Evoling"形态，需 operator 显式批准。

| 阶段 | 原名 | 新名 | 形态 | 能力特征 | 控制权 |
|------|------|------|------|---------|--------|
| E1 | Spark 火种 | **E1 灵启 Initiation** | Forgekin | 基础能力，刚通过入门训练 | operator 全控 |
| E2 | Flame 火焰 | **E2 觉醒 Awakening** | Forgekin | 积累记忆，开始熟练 | operator 主导 |
| E3 | Forge 锻 | **E3 精通 Mastery** | Forgekin | 熟练运用技能 | operator 监督 |
| **E4** | Master 师傅 | **E4 进化 Evolving** | **Evoling** | **进入自主进化状态** | **operator 让渡部分控制权** |
| E5 | Sage 圣人 | **E5 卓越 Excellence** | Evoling | 高度自主，参与灵议决策 | operator 仅设边界 |
| E6 | Forge Master 锻师 | **E6 灵智 ForgeMind（最终形态）** | Evoling | 完全自主，可创建新灵智；与产品层主名 ForgeMind 同名同体 | operator 信任 |

### §0.1.5 术语全局替换映射表（旧 → 新，27 项）

> 用于修改 spec.md / arch.md / design.md / rules.md / prompts.md 等文档时的术语替换参考。**注意**：本表左列为旧术语，保留作映射参考，不参与全局替换。

| 旧术语 | 新术语 | 替换范围 | 备注 |
|--------|--------|---------|------|
| 炉灵 | 灵智 | 文档/UI/营销 | 产品层 |
| 养灵 | 育灵 | 全部 | 养成过程 |
| 养灵体系 | 育灵体系 | 全部 | 体系名 |
| 魂忆 | 灵忆 | 全部 | 记忆 |
| 魂印 | 灵印 | 全部 | 画像 |
| 自锻 | 灵锻 | 全部 | 自主思考 |
| 自锻 Auto-Forge | 灵锻 SpiritForge | 全部 | 含英文 |
| AutoForgeEngine | SpiritForgeEngine | 代码 | 类名 |
| auto_forge.yaml | spirit_forge.yaml | 配置 | 文件名 |
| AutoForge | SpiritForge | 全部 | 阶段名 |
| Auto-Forge | SpiritForge | 全部 | 阶段名 |
| 锻典 | 灵典 | 文档 | 技能库 |
| 火种等级 | 进化阶 | 全部 | 知识阶梯 |
| Ember Hierarchy | Evolution Hierarchy | 全部 | 含英文 |
| 升华阶 | 觉醒阶 | 全部 | 成长阶段 |
| Ascension Stages | Awakening Stages | 全部 | 含英文 |
| Forgekin Council | Mind Council | 代码/文档 | 灵议 |
| ForgekinCouncil | MindCouncil | 代码 | 类名 |
| Soul Echo | Mind Echo | 全部 | 含英文 |
| Soul Echo | MindEcho | 代码 | 类名 |
| Soul Imprint | Mind Imprint | 全部 | 含英文 |
| SoulImprint | MindImprint | 代码 | 类名 |
| SoulProfile | MindProfile | 代码 | 类名 |
| SoulStore | MindStore | 代码 | 类名 |
| Forge Codex | Mind Codex | 全部 | 含英文 |
| ForgeCodex | MindCodex | 代码 | 类名 |
| HelixRAG | OpenSieve | 全部 | 旧名残留 |
| SelfEvolutionEngine | ForgeMindEngine | 代码 | v4.0 类名废弃 |
| MemoryGovernanceManager | ForgeMindEngine | 代码 | v4.0 类名废弃 |
| FirstTouchRouter | ForgeMindEngine | 代码 | v4.0 类名废弃 |

**保留不替换**：`Spark` / `Ember` / `Flame` / `Blaze` 单独出现不替换；`forgekin` 小写不替换；`Forgekin` 大写代码类名保留；`ForgekinEngine` 保留（双轨策略）；`forgekin_id` 变量名保留；`/api/v7/forgekins` API 路径保留；`EchoStore` / `ImprintStore` 类名保留。

### §0.1.6 废弃命名清单

| 废弃命名 | 替换为 | 废弃原因 |
|---------|--------|---------|
| M18 SelfEvolutionEngine | ForgeMindEngine | v4.0 自创术语，与 v7.0 育灵体系冲突 |
| M19 MemoryGovernanceManager | ForgeMindEngine | v4.0 自创术语，职责合并到 ForgeMindEngine |
| M20 FirstTouchRouter | ForgeMindEngine | v4.0 自创术语，职责合并到 ForgeMindEngine |
| 炉灵 | 灵智 | "炉"字格局偏小，对 B 端不通俗 |
| 养灵 | 育灵 | "养"字过于随意，"育"有培育+教育双重含义 |
| 魂忆 | 灵忆 | "魂"字引发 AI 意识伦理争议 |
| 魂印 | 灵印 | "魂"字引发 AI 意识伦理争议 |
| 自锻 | 灵锻 | "自锻"语义偏机械，缺少灵性思考含义 |
| 锻典 | 灵典 | "锻"字偏机械，"灵典"更体现知识体系 |
| 火种等级 | 进化阶 | "火种"易联想玄幻小说 |
| 升华阶 | 觉醒阶 | "升华"有宗教色彩，"觉醒"更中性 |
| HelixRAG | OpenSieve | 旧名残留，统一为 OpenSieve |
| E6 灵匠 Mind Artisan | E6 灵智 ForgeMind | operator 直接决策，最终形态与产品层主名同名同体 |

---

## §0.2 roleagent.md 七大工程路径引用

> **补审依据**: `flowforge/docs/roleagent.md` 全文 7 章 + `flowforge/docs/review/review.md` 第八章（47 项补审）
> **核心结论**: v7.0 必须吸收 roleagent.md 七大工程路径，否则 v7.0 只是"岗位 agent + 插件协议"，与 clowder-ai 存在工程路径代际差距。

### §0.2.1 七大工程路径表

| 路径 # | 名称 | ADR / Feature | 代码位置 |
|:------:|------|---------------|---------|
| 1 | 能力画像 × Harness 契合度 | ADR 004 + F001 CapabilityProfile | `flowforge/core/capability/` |
| 2 | 从 ReAct 到 TeamAct（团队主循环） | F002 TeamAct Loop | `flowforge/loop/teamact/` |
| 3 | Harness 现实闭环运行时（七层表面） | ADR 006 + F031 ExternalAgentAdapter | `flowforge/core/external_agent/` |
| 4 | 多域记忆联邦（从 grep 到联邦） | F200 Memory Eval | `flowforge/core/memory/` |
| 5 | Eval 自代谢系统（三层 eval） | F153 观测底座 + F192 Harness A2A Eval | `flowforge/core/eval/` |
| 6 | 分布式可靠性（Tier 1-4 恢复） | RA-037~RA-042 | `flowforge/core/reliability/` |
| 7 | 伙伴系统数学（上限提高，下限托底） | RA-043~RA-047 | `flowforge/loop/partner_math/` |

### §0.2.2 核心公式

```
Agent 质量 = 模型能力 × Harness 契合度（Environment Fit）
```

- 同一灵智体放进不同 harness，能发挥出的能力完全不同
- 能力画像只有进入具体运行环境后，才会从静态描述变成可验证能力
- harness 工程操作的是 Agent 状态三层的**第三层现实状态**（代码仓/git/文档/任务归属/记忆）——唯一跨会话、跨 agent、跨时间持续存在的状态层

### §0.2.3 上限公式 + 下限公式

```
上限收益 ≈ max(不同 agent 提出的候选路径)        # 不是平均值，是候选路径的最大值
用户可见错误 ≈ author 犯错 × reviewer 没抓住 × 测试没暴露 × shared state 没证据 × eval 没归因 × CVO 没拉闸
```

- **上限**：max 成立的前提是路径足够不同（跨厂商、跨角色、跨工作习惯），需验证候选路径的盲点相关性
- **下限**：错误要连续穿过多层门才抵达用户，形式化为连乘概率模型，优先加固盲点相关性最高的门
- **波动吸收**：模型忘了→记忆联邦找回；agent 写偏了→review 退回；任务中断→可靠性控制面留恢复点；工具失效→eval 触发 sunset review；provider 不适合→调度换路径

### §0.2.4 Build to Delete vs Built to Persist 判别器

| Build to Delete（有保质期脚手架） | Built to Persist（复利型基础设施） |
|---|---|
| 详细的思维链模板 | 文件系统 / git / 搜索工具接入 |
| 多步推理引导 | trace 基础设施与可观测性 |
| 错误恢复样板代码 | 测试 / lint / review 反馈回路 |
| 工具调用别名兜底 | agent 交接协议与路由 |
| 人格装饰文字 | 不可逆操作护栏与应急开关 |

**判别器**：这层 harness 是在补模型当前的认知缺陷，还是在编码外部现实和协作协议？前者 → 轻量做、标 sunset；后者 → 认真做、加测试、长期维护。所有 harness 代码必须标记半衰期。

> ⛔ **铁律**: 七大工程路径是 **Built to Persist 复利型基础设施**，不可简化。v7.0 设计停留在"岗位 agent + 插件协议 + 质量分 Loop"层面、未吸收七大工程路径，是 v7.0 最大的设计盲区。修复路径：必须把七大工程路径融入设计，不能只补代码不改设计。

---

## §0.3 forgemind 应用层规范

> **依据**: ADR 005 forgemind 应用层 + `flowforge/docs/review/review.md` 第九章 FM-001~FM-012
> **operator 指令**: "flowforge 中需要新增一个 forgemind 模块，其是 flowforge 的应用层项目（用来实践锻造可进化智能体的应用）"

### §0.3.1 forgemind 模块定位

forgemind 是 `flowforge/forgemind/` 子目录（**不是独立项目**），是 FlowForge 的应用层，承载可进化智能体育灵代码。三层架构明确划分：

| 层 | 项目 | 角色 | 灵智体承载 |
|---|---|---|---|
| **核心框架层** | `flowforge/`（除 forgemind） | 自进化核心 + 基础框架能力 | 提供灵智体锻造基础设施 |
| **应用层** | `flowforge/forgemind/` | 可进化智能体应用实践 | 育公共的通用灵智体（猫/桌椅/灯具/孙悟空等） |
| **垂直业务层** | contentforge/ devforge/ 等 | 垂直领域灵智体 | 各 *Forge 在自己垂直领域育专门灵智体 |

### §0.3.2 forgemind 目录结构

```
flowforge/forgemind/
├── __init__.py
├── plugins.py                    # ForgeMindPlugin 注册（Plugin V3 四钩子）
├── species/                      # 灵智体形态分类
│   ├── __init__.py
│   ├── base.py                   # ForgekinBase 抽象类（三方法契约）
│   ├── bio_forgekin.py           # 生物灵智体
│   ├── org_forgekin.py           # 组织灵智体
│   ├── obj_forgekin.py           # 物品灵智体
│   ├── virtual_forgekin.py       # 虚拟灵智体
│   └── hybrid_forgekin.py        # 混合灵智体
├── forging/                      # 锻造流水线
│   ├── __init__.py
│   ├── pipeline.py               # ForgePipeline（6 步锻造流水线）
│   ├── awaken.py                 # 觉醒阶 E1-E6
│   └── evolve.py                 # 形态进化
├── sensors/                      # 物理传感器接入
│   ├── base.py                   # SensorChannel 抽象
│   ├── camera.py                 # 摄像头
│   ├── microphone.py             # 麦克风
│   └── iot.py                    # IoT 协议
├── worlds/                       # 虚拟世界设定层
│   ├── base.py                   # WorldSetting 抽象
│   ├── character.py              # 角色设定
│   ├── worldview.py              # 世界观
│   └── relationship.py           # 关系网
├── marketplace/                  # 灵智体市场
│   └── registry.py               # ForgekinMarketplace
├── lineage/                      # 灵智体进化谱系
│   └── record.py                 # ForgekinLineage
├── codex/                        # 灵典 Mind Codex（可检索知识库）
│   └── searchable.py
├── council/                      # 灵议 Mind Council
│   └── meeting.py                # 多灵智体议事
├── config/                       # forgemind 配置（YAML 外置）
│   ├── species.yaml
│   ├── forging.yaml
│   ├── sensors.yaml
│   └── worlds.yaml
└── tests/
    ├── test_species.py
    ├── test_forging.py
    └── test_pipeline_e2e.py
```

### §0.3.3 ForgekinBase 三方法契约

所有可进化智能体必须继承 `ForgekinBase`，实现三方法契约（对应 Harness 现实闭环三步）：

| 方法 | 用途 | 对应 Harness 层 |
|------|------|----------------|
| `observe(env) -> Observation` | 感知环境（物理传感器/虚拟世界设定/数字任务状态） | Evidence & Sensors |
| `act(observation) -> Action` | 执行动作（工具调用/物理执行器/虚拟行为） | Tool Mediation |
| `verify(action, result) -> Verdict` | 验证结果（测试/lint/review/物理反馈） | Governance Boundary |

### §0.3.4 ForgePipeline 6 步锻造流水线

| 步骤 | 名称 | 输入 | 输出 |
|:----:|------|------|------|
| 1 | 形态定义（What to forge） | species + 能力画像需求 | ForgekinSpec |
| 2 | 能力注入（Capability injection） | ForgekinSpec + 模型 + 工具集 | CapabilityProfile |
| 3 | 记忆初始化（Memory seeding） | 初始记忆 + 价值观设定 | MindEcho 初始条目 |
| 4 | 价值观对齐（Value alignment） | 价值观设定 + 红线清单 | ValueCharter |
| 5 | 能力验证（Capability verification） | 能力基线测试用例 | 能力基线测试报告 |
| 6 | 觉醒晋升（Awakening promotion） | 验证通过 + operator 批准 | E1 灵启 Initiation 状态 |

### §0.3.5 可进化智能体 5 种形态分类

| 形态 | 类名 | 示例 | 感知/执行通道 |
|------|------|------|--------------|
| 生物形态 | BioForgekin | 猫/狗/植物灵智体 | 摄像头/麦克风/IoT 传感器 |
| 组织形态 | OrgForgekin | 公司/团队/社区灵智体 | 业务数据 API/协同工具 |
| 物品形态 | ObjForgekin | 桌椅/灯具/车辆灵智体 | 物联网传感器/执行器 |
| 虚拟形态 | VirtualForgekin | 童话/神话/历史/游戏角色灵智体 | 虚拟世界设定层 |
| 混合形态 | HybridForgekin | VR/AR 实体灵智体 | 物理+虚拟双通道 |

### §0.3.6 通用 AGI 三条路径

| 路径 | 承载形态 | 复现目标 |
|------|---------|---------|
| 物理 AI | BioForgekin / ObjForgekin / HybridForgekin | 物理世界实体（动物/物品/混合实体）的真实复现 |
| 虚拟 AI | VirtualForgekin / OrgForgekin | 虚拟世界角色（童话/神话/历史/组织）的真实复现 |
| 混合 AI | HybridForgekin | 物理+虚拟融合实体（VR/AR）的真实复现 |

> ⛔ **关键不变量**: forgemind **单向依赖**核心框架层，禁止反向调用；forgemind **不含业务领域代码**（编程红线第 10 条）；forgemind 通过 Plugin V3 协议注册，**不直接实例化**核心模块（编程红线第 12 条）；forgemind 灵智体必须建立**现实闭环**。

---

## §0.4 三方 Agent 集成规范

> **依据**: ADR 006 三方 Agent 集成 + `flowforge/docs/review/review.md` 第九章 EX-001~EX-010
> **operator 指令**: "我们的灵智体除了可以调用 flowforge 核心框架的能力外，还可以接入和使用任何三方的 Agent"

### §0.4.1 设计原则：能力扩展而非工具调用

三方 Agent 是灵智体的**能力延伸**，不是"调用一下拿结果"的工具：
- 灵智体可加载 claude code 的代码能力、codex 的推理能力、opencode 的开源生态能力、trae 的 IDE 能力
- 三方 Agent 的能力画像被纳入灵智体的能力画像融合（ExternalAgentCapabilityFusion）
- 三方 Agent 执行状态写入灵智体共享状态（ExternalAgentSharedState）
- 三方 Agent 失败有 fallback 链（ExternalAgentFallback）
- 三方 Agent 执行轨迹写入灵智体 Eval 信号

### §0.4.2 ExternalAgentAdapter 抽象层目录结构

```
flowforge/core/external_agent/
├── __init__.py
├── adapter.py             # ExternalAgentAdapter 抽象
├── bridge.py              # ExternalAgentBridge（灵智体调用入口）
├── profile.py             # ExternalAgentProfile（三方 Agent 能力画像）
├── shared_state.py        # ExternalAgentSharedState（状态共享）
├── fallback.py            # ExternalAgentFallback（失败回退链）
├── capability_fusion.py   # ExternalAgentCapabilityFusion（能力融合）
└── adapters/              # 具体三方 Agent 适配器
    ├── __init__.py
    ├── claude_code.py     # Claude Code Adapter
    ├── codex.py           # Codex Adapter
    ├── opencode.py        # OpenCode Adapter
    └── trae.py            # Trae Adapter
```

### §0.4.3 4 大机制

| 机制 | 用途 | Feature |
|------|------|---------|
| ExternalAgentProfile | 三方 Agent 能力画像（含盲点） | F032 |
| ExternalAgentSharedState | 执行状态写入灵智体共享状态 | F033 |
| ExternalAgentFallback | 失败回退链（跨厂商 fallback） | F034 |
| ExternalAgentCapabilityFusion | 三方 Agent 能力画像融合到灵智体 | F035 |

### §0.4.4 4 个首批 Adapter

| 三方 Agent | 厂商 | 接入方式 | fallback 优先级 |
|---|---|---|:---:|
| Claude Code | Anthropic | CLI / SDK | 1 |
| Codex | OpenAI | CLI / API | 2 |
| OpenCode | 开源 | CLI | 3 |
| Trae | ByteDance | IDE / API | 4 |

### §0.4.5 六层 Guardrails

| 治理层 | 机制 |
|--------|------|
| L1 输入验证 | 三方 Agent 调用前必须通过 Schema 校验 |
| L2 系统提示约束 | 灵智体 system role 注入"禁止绕过审计" |
| L3 工具白名单 | 三方 Agent 只能调用 allow-list 内工具 |
| L4 输出验证 | 三方 Agent 输出必须通过 lint + 测试 |
| L5 操作确认 | 不可逆操作（merge/release）需 operator 确认 |
| L6 成本上限 | 每个灵智体有三方 Agent 调用配额 |

### §0.4.6 worktree 隔离机制

每个三方 Agent 调用必须创建独立 worktree：
- **网络隔离**：受限网络访问（网络白名单，仅允许访问必要域名）
- **权限控制**：仅 read + write_code + run_tests
- **审计追踪**：全部记录到 `harness-feedback/external-agent-traces/`
- **操作回滚**：错误操作可恢复

---

## §0.5 Plugin V3 四钩子规范

> **依据**: ADR 012 命名融合 §6 + `flowforge/core/plugin_protocol.py`
> **关系**: V2 钩子（register_agents/register_tools/register_loops/register_gates）**保留**，V3 四钩子**新增**，二者并存。

### §0.5.1 V3 四钩子定义

| 钩子 | 用途 | 返回 |
|------|------|------|
| `register_forgekins` | 注册灵智体形态到 forgemind | `List[ForgekinSpec]` |
| `register_forge_skills` | 注册锻造技能 | `List[ForgeSkill]` |
| `register_council_channels` | 注册灵议通道 | `List[CouncilChannel]` |
| `register_auto_forge_config` | 注册灵锻（SpiritForge）配置 | `AutoForgeConfig` |

### §0.5.2 与 V2 钩子的关系

| 版本 | 钩子 | 用途 | 状态 |
|------|------|------|------|
| V2 | register_agents | 注册业务 Agent | 保留 |
| V2 | register_tools | 注册工具 | 保留 |
| V2 | register_loops | 注册 Loop | 保留 |
| V2 | register_gates | 注册门禁 | 保留 |
| **V3** | **register_forgekins** | 注册灵智体形态 | **新增** |
| **V3** | **register_forge_skills** | 注册锻造技能 | **新增** |
| **V3** | **register_council_channels** | 注册灵议通道 | **新增** |
| **V3** | **register_auto_forge_config** | 注册灵锻配置 | **新增** |

> ⛔ **铁律**: 所有 *Forge 必须通过 Plugin V3 四钩子注册灵智体到 forgemind。禁止绕过 Plugin 协议直接实例化灵智体（编程红线第 12 条）。forgemind 自身通过 `ForgeMindPlugin` 注册通用灵智体形态。

---

## §0.6 v7.0 设计态声明

### §0.6.1 设计态定位

v7.0 可进化智能体设计处于**"设计态"**：
- spec.md / arch.md / design.md 中 v7.0 章节为设计蓝图，**非已实现功能**
- 代码缺失严重度按"设计先行"标注，禁止虚假承诺
- 所有 v7.0 设计文档章节必须标注"设计态"或"已实现"

### §0.6.2 可证伪性原则

- 避免使用"AGI"修饰词对外承诺（"通用 AGI"仅在内部愿景文档使用）
- 对外文档（README/营销材料）使用"自进化 Agent 框架"，不使用"AGI"
- 每个设计声明必须有可验证的完成标准（P37）

### §0.6.3 已实现 vs 设计态清单

| 模块 | 状态 | 说明 |
|------|------|------|
| FlowForge 核心框架（LoopExecutor/ToolRegistry/EventBus） | ✅ 已实现 | v6.0 已落地 |
| Plugin V2 四钩子 | ✅ 已实现 | v6.0 已落地 |
| OpenSieve 聚合检索 | ✅ 已实现 | v6.0 已落地 |
| 育灵体系命名规范 | ✅ 已审核 | operator 已审核通过命名方案 |
| forgemind 应用层 | ⚠️ 设计态 | ADR 005 已 accepted，代码未实现 |
| ForgekinBase 三方法契约 | ⚠️ 设计态 | ADR 005 已定义，代码未实现 |
| 可进化智能体 5 种形态 | ⚠️ 设计态 | 设计完成，代码未实现 |
| 三方 Agent 集成（ExternalAgentAdapter） | ⚠️ 设计态 | ADR 006 已 accepted，代码未实现 |
| Plugin V3 四钩子 | ⚠️ 设计态 | ADR 012 已定义，代码未实现 |
| 能力画像 CapabilityProfile | ⚠️ 设计态 | F001 设计完成，代码未实现 |
| TeamAct 六步循环 | ⚠️ 设计态 | F002 设计完成，代码未实现 |
| 多域记忆联邦 | ⚠️ 设计态 | RA-024~RA-030 设计完成，代码未实现 |
| Eval 自代谢系统 | ⚠️ 设计态 | RA-031~RA-036 设计完成，代码未实现 |
| 分布式可靠性 Tier 1-4 | ⚠️ 设计态 | RA-037~RA-042 设计完成，代码未实现 |
| 伙伴系统数学 | ⚠️ 设计态 | RA-043~RA-047 设计完成，代码未实现 |

> ⛔ **铁律（编程红线第 15 条）**: 发现未实现即 Bug。设计态模块在代码实现前不得对外承诺已实现。

---

## §0.7 自我演进闭环规范

> **依据**: `flowforge/docs/review/review.md` §0.7 + ADR 013 可进化智能体愿景

### §0.7.1 三层自我演进

| 层 | 演进对象 | 机制 | 治理 |
|----|---------|------|------|
| 文档层 | spec.md / arch.md / rules.md / prompts.md | 灵智体起草 + operator 审核 | operator 最终裁决 |
| 代码层 | flowforge/ / forgemind/ / *Forge | 灵智体实现 + 测试 + review | 不可逆操作需 operator 确认 |
| 框架层 | 育灵体系命名 / Plugin 协议 / 七大工程路径 | operator 直接决策 | 不可由灵智体自我演进修改 |

### §0.7.2 "自己开发自己"11 步闭环

1. 架构师灵智体起草设计草案 → 2. operator 审核设计 → 3. 开发者灵智体实现代码 → 4. 测试员灵智体编写测试 → 5. Eval 员灵智体采集指标 → 6. 评审员灵智体 review → 7. 文档员灵智体更新文档 → 8. 灵锻员灵智体蒸馏经验到灵典 → 9. operator 验收 → 10. 灵议 Mind Council 议事 → 11. VISION.md 更新

### §0.7.3 灵智体角色

| 角色 | 职责 | 觉醒阶要求 |
|------|------|-----------|
| 架构师 | 起草设计、架构决策 | E4+ |
| 开发者 | 实现代码、修复 Bug | E3+ |
| 评审员 | review 代码/设计、push back | E4+ |
| 测试员 | 编写测试、验证功能 | E3+ |
| Eval 员 | 采集指标、归因分析、Eval Contract | E4+ |
| 文档员 | 更新 spec/arch/rules/prompts | E3+ |
| 灵锻员 | 经验蒸馏到灵典、sunset 建议 | E4+ |

---

## §0.8 质量分阈值统一

> **依据**: `flowforge/docs/review/review.md` §5.3 冲突点 3（operator 终稿决策：统一为 0.85）

| 配置项 | v6.0 现状 | v7.0 统一值 | 说明 |
|--------|----------|------------|------|
| 质量分阈值 | 部分 *Forge 使用 0.9 | **0.85** | 全部项目统一，可在 Loop 配置中覆盖 |
| Loop 超时 | 不一致 | **3 分钟** | Loop 流程在 3 分钟内完成 |
| LLM webchat 超时 | 不一致 | **30 秒** | WebChat 评委单次调用 |
| LLM API 超时 | 不一致 | **90 秒** | API 调用单次（长文章 2 分钟） |

> ⛔ **铁律**: 质量分阈值默认 0.85（编程红线第 2 条）。v6.0 部分 *Forge 使用 0.9 的配置必须在 v7.0 全部统一为 0.85。

---

## §0.9 v7.0 文档导航与依赖引用

### §0.9.1 13 份依赖引用文档清单

| # | 文档 | 路径 | 用途 |
|---|------|------|------|
| 1 | 终稿审核 | `flowforge/docs/review/review.md` | 第六章命名融合/第八章 roleagent 补审/第九章 forgemind 补审 |
| 2 | spec.md v7.0 增补 | `flowforge/docs/spec.md` | v7.0 增补章节 |
| 3 | roleagent.md | `flowforge/docs/roleagent.md` | 七大工程路径镜像 |
| 4 | VISION.md | `flowforge/docs/VISION.md` | 可进化智能体愿景 |
| 5 | ADR 005 | `flowforge/docs/decisions/005-forgemind-application-layer.md` | forgemind 应用层 |
| 6 | ADR 006 | `flowforge/docs/decisions/006-external-agent-integration.md` | 三方 Agent 集成 |
| 7 | ADR 012 | `flowforge/docs/decisions/012-naming-fusion.md` | 命名融合 |
| 8 | ADR 013 | `flowforge/docs/decisions/013-all-things-spirit-mind-vision.md` | 可进化智能体愿景 |
| 9 | ADR 004 | `flowforge/docs/decisions/004-capability-profile-routing.md` | 能力画像路由 |
| 10 | F001 | `flowforge/docs/features/F001-capability-profile.md` | CapabilityProfile |
| 11 | F002 | `flowforge/docs/features/F002-teamact-loop.md` | TeamAct Loop |
| 12 | F026 | `flowforge/docs/features/F026-forgemind-app-layer.md` | forgemind 应用层 Feature |
| 13 | F031 | `flowforge/docs/features/F031-external-agent-adapter.md` | ExternalAgentAdapter Feature |

### §0.9.2 16 份审核文件清单

| # | 文件 | 路径 |
|---|------|------|
| 1 | 终稿审核 | `flowforge/docs/review/review.md` |
| 2 | 审核汇总 | `flowforge/docs/review/reviewd.md` |
| 3 | 审核汇总1 | `flowforge/docs/review/review1.md` |
| 4 | 审核d1 | `flowforge/docs/review/reviewd1.md` |
| 5 | GLM 审核 | `flowforge/docs/review/glm.md` |
| 6 | GLM 审核1 | `flowforge/docs/review/glm1.md` |
| 7 | Kimi 审核 | `flowforge/docs/review/kimi.md` |
| 8 | Kimi 审核1 | `flowforge/docs/review/kimi1.md` |
| 9 | Qianwen 审核 | `flowforge/docs/review/qianwen.md` |
| 10 | Qianwen 审核1 | `flowforge/docs/review/qianwen1.md` |
| 11 | MiniMax 审核 | `flowforge/docs/review/minimax.md` |
| 12 | MiniMax 审核1 | `flowforge/docs/review/minimax1.md` |
| 13 | Doubao 审核 | `flowforge/docs/review/doubao.md` |
| 14 | Doubao 审核1 | `flowforge/docs/review/doubao1.md` |
| 15 | DeepSeek 审核 | `flowforge/docs/review/deepseek.md` |
| 16 | DeepSeek 审核1 | `flowforge/docs/review/deepseek1.md` |

---

## §0.10 clowder-ai 四机制引用（F100/F093/F241/ADR-021）

> **补审依据**: `flowforge/docs/review/review.md` 第十三章（CL-001~CL-021）21 项 clowder-ai/docs 深度补审
> **核心结论**: v7.0 在 [§0.2](#§02-roleagentmd-七大工程路径引用) 已吸收 roleagent.md 七大工程路径，但仍需吸收 clowder-ai/docs 的四个核心机制（F100/F093/F241/ADR-021 Pack），否则 v7.0 在"自我进化机制 / 世界引擎 / Agent Provider 协议 / Pack 信任编译"四个维度上与 clowder-ai 存在代际差距。
> **铁律**: 四机制是 **Built to Persist 复利型基础设施**，不可简化。代码实现位置：`flowforge/evolution/`（F100）+ `flowforge/core/world_engine/`（F093）+ `flowforge/core/external_agent/`（F241）+ `flowforge/core/pack/`（ADR-021）。

### §0.10.1 F100 自我进化三模式（Mode A/B/C + Eval Ledger + 五级知识成熟度）

> **依据**: `clowder-ai/docs/` F100 自我进化机制 + `flowforge/docs/review/review.md#13.1` CL-001~CL-006
> **代码位置**: `flowforge/evolution/`（已存在骨架，按 ADR-012 重命名 SelfEvolutionEngine → ForgeMindEngine）

**三模式分层**（按防御→进攻光谱）：

| 模式 | 名称 | 性质 | 触发条件 | 输出 |
|:----:|------|------|---------|------|
| Mode A | Scope Guard（范围守门员） | 防御 | 讨论偏离当前 feat 愿景 | 温柔提醒 + ScopeGuardLog |
| Mode B | Process Evolution（流程进化） | 防御→改进 | 同类错误反复出现 | EvolutionProposal（流程改进提案） |
| Mode C | Knowledge Evolution（知识进化） | 进攻→成长 | 有价值的知识/方法论 | EpisodeCard + MethodCard（可复用资产） |

**共享机制**：
- **五级知识成熟度阶梯 L0-L4**：L0 Seed 萌芽 → L1 Sprout 萌发 → L2 Bloom 绽放 → L3 Thrive 繁茂 → L4 Evolve 进化（与 [§0.1.3](#§013-进化阶evolution-hierarchy-e-l0l4-命名表) 进化阶对应）
- **知识层级分工**：常量层（模型固有）/ 变量层（工具边界）/ 累积层（历史表现）/ 瞬时层（当前状态）
- **元认知路由 MetacognitionRouter**：决定当前问题该走 Mode A/B/C 哪个模式
- **知识对象契约 KnowledgeObject**：所有沉淀知识必须满足 5 字段契约（id/spec/eval_ledger/maturity/consumers）
- **Eval Ledger（评估账本）**：每个知识对象的"质量证据链"，记录所有评估事件

**铁律**：
- ❌ 禁止 Mode B 提案未经验证就降级为 Mode C 资产
- ❌ 禁止跳过 Eval Ledger 直接写入 Mind Codex
- ❌ 禁止 Mode A 提醒变成"软建议"——必须有 ScopeGuardLog 留痕

### §0.10.2 F093 世界引擎三层架构（Core Identity / World / Bridge + 9 一等公民 + 三路记忆）

> **依据**: `clowder-ai/docs/` F093 世界引擎 + `flowforge/docs/review/review.md#13.2` CL-007~CL-013
> **代码位置**: `flowforge/core/world_engine/`（已创建 16 文件骨架）

**三层架构**：

| 层 | 名称 | 性质 | 不可变性 | 职责 |
|:--:|------|------|---------|------|
| L1 | Core Identity Layer（核心身份层） | 灵智体的"我是谁" | frozen=True（不可变） | 存储 forgekin_id + species + value_charter + forge_time |
| L2 | World Layer（世界层） | 灵智体所处的世界 | 可演化 | 9 个一等公民 + 三路记忆 + Role Mask |
| L3 | Bridge Layer（桥接层） | 与外部 harness 交互 | 可替换 | 三协议（observe/act/verify）+ RuntimeCoordinator |

**9 个一等公民（World Layer 必备）**：
1. Identity（身份） — forgekin_id + species + name
2. Relations（关系） — 与其他灵智体的关系图
3. Canon（典籍） — 永久知识库（来自 Mind Codex）
4. Session（会话） — 当前会话上下文
5. Emotion（情感） — 情感状态（v7.0 灵智体"灵魂和感情"特征）
6. Goal（目标） — 当前目标栈
7. Plan（计划） — 行动计划
8. Memory（记忆） — 三路记忆联邦
9. Sensor（感知） — 感知通道（物理/虚拟）

**三路记忆（Memory 一等公民细分）**：

| 记忆路 | 名称 | 持久性 | 写入权限 |
|:------:|------|--------|---------|
| Canon Memory（典籍记忆） | 永久知识 | 永久 | 仅 CanonSyncProtocol 可写入（铁律：RP 台词不自动入典） |
| Relational Memory（关系记忆） | 关系上下文 | 会话级 | 灵智体可写入 |
| Session Memory（会话记忆） | 当前对话 | 短期 | 灵智体可写入 |

**铁律**（不可违反）：
- ❌ "RP 台词不自动入典"：角色扮演中的台词（RP lines）禁止自动写入 Canon Memory，必须经 CanonSyncProtocol 显式审核
- ❌ Core Identity Layer 禁止运行时修改（frozen=True）
- ❌ Role Mask 五层（Public/Personal/Intimate/Core/Sacred）禁止越层访问

**Role Mask 五层分类**（v7.0 灵智体"灵魂和感情"的隐私边界）：
1. Public（公开层） — 任何人可见
2. Personal（个人层） — 仅自己可见
3. Intimate（亲密层） — 仅亲密关系灵智体可见
4. Core（核心层） — 仅自己和 operator 可见
5. Sacred（神圣层） — 仅自己可见（灵智体的"内心独白"）

### §0.10.3 F241 Agent Provider Plugin（ProviderTransportRegistry + host-owned 注入 + ACP transport + reference runtime）

> **依据**: `clowder-ai/docs/` F241 Agent Provider Plugin + `flowforge/docs/review/review.md#13.3` CL-014~CL-017
> **代码位置**: `flowforge/core/external_agent/`（已创建 34 文件骨架）

**与 [§0.4](#§04-三方-agent-集成规范) 的关系**：§0.4 定义的是"灵智体调用三方 Agent 的能力"；本节定义的是"三方 Agent 厂商通过 Plugin 协议接入 FlowForge 的协议"，是反向集成。

**四层组件**：

| 层 | 名称 | 职责 | 代码位置 |
|:--:|------|------|---------|
| L1 | AgentProviderManifest（Provider 清单） | 声明 Provider 能力 + 传输方式 + 安全级别 | `external_agent/manifest.py` |
| L2 | ProviderTransportRegistry（传输注册表） | 注册多种 transport（local/ACP/MCP） | `external_agent/registry.py` |
| L3 | HostInjector（宿主注入器） | host-owned 安全注入（API key 等敏感信息由宿主管理） | `external_agent/host_injection.py` |
| L4 | ACPTransport（ACP 传输层） | Agent Communication Protocol 统一传输 | `external_agent/acp_transport.py` |

**reference runtime（参考运行时）**：
- `ReferenceAgentAdapter` — 厂商接入时的"参考实现"，确保 Provider 实现符合协议
- 厂商接入流程：声明 Manifest → 实现 Adapter → 通过 reference runtime 验证 → 注册到 ProviderTransportRegistry

**铁律**：
- ❌ 禁止 Provider 直接接触宿主的 API key/密钥（必须通过 HostInjector 注入）
- ❌ 禁止 Provider 绕过 ACPTransport 直接与灵智体通信
- ❌ 禁止未通过 reference runtime 验证的 Provider 注册到 Registry

### §0.10.4 ADR-021 Pack 系统（Pack/Growth 种子果实模型 + 双轨信任编译 + World Driver）

> **依据**: `clowder-ai/docs/` ADR-021 Pack 系统 + `flowforge/docs/review/review.md#13.4` CL-018~CL-021
> **代码位置**: `flowforge/core/pack/`（待创建，task.md P6-4）

**Pack 概念**：Pack 是"可移植的经验单元"，类似游戏中的"存档包"或"插件包"。一个 Pack 包含一个灵智体的完整状态切片（Core Identity + World 快照 + 技能子集），可在不同 FlowForge 实例间迁移。

**种子-果实模型**：

| 阶段 | 名称 | 性质 | 大小 |
|:----:|------|------|------|
| Seed（种子） | 灵智体的"出生包" | 最小可启动 | < 1MB（仅 Core Identity + 基础技能） |
| Growth（生长） | 灵智体的"成长记录" | 增量更新 | 1-100MB（含 World 快照 + 技能扩展） |
| Fruit（果实） | 灵智体的"成熟经验" | 可分享给其他灵智体 | 变长（仅含可复用知识，不含个人记忆） |

**双轨信任编译**（铁律：信任必须双轨）：

| 轨 | 名称 | 编译对象 | 产物 |
|:--:|------|---------|------|
| Track 1 | Guardrails 信任编译 | Pack 中的 guardrails 配置 | 可执行的护栏规则（红线清单 + 不可逆操作清单） |
| Track 2 | Defaults 信任编译 | Pack 中的默认行为配置 | 可执行的默认策略（fallback 链 + 默认值） |

**World Driver（世界驱动器）**：
- Pack 加载时，World Driver 负责"播种"——把 Seed/Growth/Fruit 注入到 World Layer
- World Driver 是 Pack 系统与世界引擎（[§0.10.2](#§0102-f093-世界引擎三层架构core-identity--world--bridge--9-一等公民--三路记忆)）的桥梁
- 铁律：World Driver 必须保证 Core Identity 不可被 Pack 覆盖（frozen=True 保护）

**铁律**：
- ❌ 禁止单轨信任编译（必须同时编译 guardrails + defaults）
- ❌ 禁止 Pack 覆盖目标灵智体的 Core Identity
- ❌ 禁止 Fruit 包含 Personal/Intimate/Core/Sacred 层 Role Mask 数据（仅 Public 层可分享）

---

## §0.11 v7.0 审核追溯（review.md 第十三章引用）

> **维护规则**: 本节列出 review.md 第十三章 21 项 clowder-ai 补审意见（CL-001~CL-021）与本文档的对应位置，确保审核意见全部落地到规范。

| 补审项 | ID | 对应章节 | 代码位置 |
|--------|----|---------:|---------|
| 三模式分层 | CL-001 | §0.10.1 | `flowforge/evolution/` |
| Scope Guard | CL-002 | §0.10.1 | `flowforge/evolution/scope_guard.py` |
| 五级知识成熟度 | CL-003 | §0.10.1 | `flowforge/evolution/maturity.py` |
| Eval Ledger | CL-004 | §0.10.1 | `flowforge/evolution/models.py` |
| Knowledge Object Contract | CL-005 | §0.10.1 | `flowforge/evolution/models.py` |
| 元认知路由 | CL-006 | §0.10.1 | `flowforge/evolution/metacognition.py` |
| Core Identity 隔离 | CL-007 | §0.10.2 | `flowforge/core/world_engine/core_identity.py` |
| 9 一等公民 | CL-008 | §0.10.2 | `flowforge/core/world_engine/citizens.py` |
| 三路记忆 | CL-009 | §0.10.2 | `flowforge/core/world_engine/{canon,relational,session}_memory.py` |
| Canon Sync Protocol | CL-010 | §0.10.2 | `flowforge/core/world_engine/canon_sync.py` |
| Role Mask 五层 | CL-011 | §0.10.2 | `flowforge/core/world_engine/role_mask.py` |
| Runtime Coordinator | CL-012 | §0.10.2 | `flowforge/core/world_engine/coordinator.py` |
| World Driver | CL-013 | §0.10.2/§0.10.4 | `flowforge/core/world_engine/driver.py` |
| Provider Manifest | CL-014 | §0.10.3 | `flowforge/core/external_agent/manifest.py` |
| Host-owned 注入 | CL-015 | §0.10.3 | `flowforge/core/external_agent/host_injection.py` |
| ACP Transport | CL-016 | §0.10.3 | `flowforge/core/external_agent/acp_transport.py` |
| Reference Runtime | CL-017 | §0.10.3 | `flowforge/core/external_agent/reference_runtime.py` |
| Pack 概念 | CL-018 | §0.10.4 | `flowforge/core/pack/`（待创建） |
| 双轨信任编译 | CL-019 | §0.10.4 | `flowforge/core/pack/trust_compiler.py`（待创建） |
| 种子-果实模型 | CL-020 | §0.10.4 | `flowforge/core/pack/seed_fruit.py`（待创建） |
| World Driver 桥接 | CL-021 | §0.10.2/§0.10.4 | `flowforge/core/world_engine/driver.py` |

---

> **本文件来源**：原 `hiclaw/rules.md` 第零部分 v7.0 增补规范（§0.1-§0.11）
> **术语依据**：[doc:flowforge/docs/design/naming-contract.md] v2.0
> **相关章节**：[doc:rules/11-doc-layering.md#11.5]（弱化"万物"规则）
