# OpenClaw 项目开发与 AI 助手行为规范

> **版本**: v3.0  
> **创建日期**: 2026-03-05  
> **最后更新**: 2026-06-28  
> **适用范围**: 9 大项目开发、代码修改、AI 助手行为

---

## 文档优先级声明

当不同文档内容冲突时，按以下优先级裁决：
1. **用户最新指令**（最高优先级，覆盖一切文档）
2. **hiclaw/prompts.md**（AI助手Prompt模板，包含最新铁律和规范）
3. **各项目docs/下的文档**（spec.md > arch.md > design.md > test.md > task.md）
4. **本文件 rules.md**（全局规范，但可能滞后于项目文档更新）
5. **archive/历史文档**（仅作参考，不代表当前架构）

---

## 第零部分：v7.0 增补规范（万物灵智体重构）

> **版本**: v7.0 增补章节
> **创建日期**: 2026-07-17
> **审核状态**: ✅ operator 已审核通过命名方案 + 体系设计
> **依据**: `flowforge/docs/review/review.md` 第六章/第八章/第九章 + ADR 005/006/012/013 + `flowforge/docs/roleagent.md`
> **不可变**: 命名变更需 operator 直接决策，不能由灵智体自我演进修改
> **设计态声明**: 本部分万物灵智体设计处于"设计态"（详见 §0.6），未实现部分必须标注"设计态"，禁止虚假承诺

---

### §0.1 v7.0 育灵体系命名规范

> 按 operator 指令：火种→进化、养灵→育灵、炉灵→灵智、去魂字去炉字。主名定为 **灵智 ForgeMind**，融入 Forgekin/SpiritForge/Evoling 三个名称到体系不同阶段。

#### §0.1.1 双轨命名策略

| 层级 | 使用场景 | 命名风格 | 示例 |
|------|---------|---------|------|
| **产品层** | 用户界面、营销材料、对外文档 | **灵智（ForgeMind）** | "创建一个新灵智"、"灵智 fk_writer_001 已晋升 E4" |
| **代码层** | 类名、变量名、配置项、API 路径 | **Forgekin** | `ForgekinEngine`、`forgekin_id`、`/api/v7/forgekins` |
| **文档层** | 设计文档、技术规范 | **灵智（ForgeMind）/ Forgekin** 双标注 | "灵智（Forgekin 实例）" |
| **社区层** | 开源宣传、技术博客 | **ForgeMind** | "FlowForge ForgeMind: Self-Evolving Agent" |

**双轨优势**：零代码迁移成本（Forgekin 类名保留）+ 产品品牌升级（对外用 ForgeMind）+ 双轨可平滑过渡。

#### §0.1.2 12 个核心概念命名表（终稿）

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

#### §0.1.3 进化阶（Evolution Hierarchy）E-L0~L4 命名表

> 衡量"知识成熟度"，与觉醒阶（衡量灵智整体成长）通过 L 前缀区分。进化阶 E-L4 对应觉醒阶 E4。

| 等级 | 原名 | 新名 | 含义 |
|------|------|------|------|
| E-L0 | Spark 火种 | **Seed 萌芽** | 初始知识，刚通过灵启训练 |
| E-L1 | Ember 余烬 | **Sprout 萌发** | 基础经验积累，开始自主思考 |
| E-L2 | Flame 火焰 | **Bloom 绽放** | 中级知识，可蒸馏技能 |
| E-L3 | Blaze 烈焰 | **Thrive 繁茂** | 高级知识，可指导其他灵智 |
| E-L4 | Forge Fire 锻火 | **Evolve 进化** | 顶级知识，可自主创新技能 |

#### §0.1.4 觉醒阶（Awakening Stages）E1-E6 命名表

> 衡量"灵智整体成长"。E3→E4 是关键转换点，灵智从"锻灵 Forgekin"形态进化为"进化体 Evoling"形态，需 operator 显式批准。

| 阶段 | 原名 | 新名 | 形态 | 能力特征 | 控制权 |
|------|------|------|------|---------|--------|
| E1 | Spark 火种 | **E1 灵启 Initiation** | Forgekin | 基础能力，刚通过入门训练 | operator 全控 |
| E2 | Flame 火焰 | **E2 觉醒 Awakening** | Forgekin | 积累记忆，开始熟练 | operator 主导 |
| E3 | Forge 锻 | **E3 精通 Mastery** | Forgekin | 熟练运用技能 | operator 监督 |
| **E4** | Master 师傅 | **E4 进化 Evolving** | **Evoling** | **进入自主进化状态** | **operator 让渡部分控制权** |
| E5 | Sage 圣人 | **E5 卓越 Excellence** | Evolving | 高度自主，参与灵议决策 | operator 仅设边界 |
| E6 | Forge Master 锻师 | **E6 灵智 ForgeMind（最终形态）** | Evoling | 完全自主，可创建新灵智；与产品层主名 ForgeMind 同名同体 | operator 信任 |

#### §0.1.5 术语全局替换映射表（旧 → 新，27 项）

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

#### §0.1.6 废弃命名清单

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

### §0.2 roleagent.md 七大工程路径引用

> **补审依据**: `flowforge/docs/roleagent.md` 全文 7 章 + `flowforge/docs/review/review.md` 第八章（47 项补审）
> **核心结论**: v7.0 必须吸收 roleagent.md 七大工程路径，否则 v7.0 只是"岗位 agent + 插件协议"，与 clowder-ai 存在工程路径代际差距。

#### §0.2.1 七大工程路径表

| 路径 # | 名称 | ADR / Feature | 代码位置 |
|:------:|------|---------------|---------|
| 1 | 能力画像 × Harness 契合度 | ADR 004 + F001 CapabilityProfile | `flowforge/core/capability/` |
| 2 | 从 ReAct 到 TeamAct（团队主循环） | F002 TeamAct Loop | `flowforge/loop/teamact/` |
| 3 | Harness 现实闭环运行时（七层表面） | ADR 006 + F031 ExternalAgentAdapter | `flowforge/core/external_agent/` |
| 4 | 多域记忆联邦（从 grep 到联邦） | F200 Memory Eval | `flowforge/core/memory/` |
| 5 | Eval 自代谢系统（三层 eval） | F153 观测底座 + F192 Harness A2A Eval | `flowforge/core/eval/` |
| 6 | 分布式可靠性（Tier 1-4 恢复） | RA-037~RA-042 | `flowforge/core/reliability/` |
| 7 | 伙伴系统数学（上限提高，下限托底） | RA-043~RA-047 | `flowforge/loop/partner_math/` |

#### §0.2.2 核心公式

```
Agent 质量 = 模型能力 × Harness 契合度（Environment Fit）
```

- 同一灵智体放进不同 harness，能发挥出的能力完全不同
- 能力画像只有进入具体运行环境后，才会从静态描述变成可验证能力
- harness 工程操作的是 Agent 状态三层的**第三层现实状态**（代码仓/git/文档/任务归属/记忆）——唯一跨会话、跨 agent、跨时间持续存在的状态层

#### §0.2.3 上限公式 + 下限公式

```
上限收益 ≈ max(不同 agent 提出的候选路径)        # 不是平均值，是候选路径的最大值
用户可见错误 ≈ author 犯错 × reviewer 没抓住 × 测试没暴露 × shared state 没证据 × eval 没归因 × CVO 没拉闸
```

- **上限**：max 成立的前提是路径足够不同（跨厂商、跨角色、跨工作习惯），需验证候选路径的盲点相关性
- **下限**：错误要连续穿过多层门才抵达用户，形式化为连乘概率模型，优先加固盲点相关性最高的门
- **波动吸收**：模型忘了→记忆联邦找回；agent 写偏了→review 退回；任务中断→可靠性控制面留恢复点；工具失效→eval 触发 sunset review；provider 不适合→调度换路径

#### §0.2.4 Build to Delete vs Built to Persist 判别器

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

### §0.3 forgemind 应用层规范

> **依据**: ADR 005 forgemind 应用层 + `flowforge/docs/review/review.md` 第九章 FM-001~FM-012
> **operator 指令**: "flowforge 中需要新增一个 forgemind 模块，其是 flowforge 的应用层项目（用来实践万物锻造灵智体的应用）"

#### §0.3.1 forgemind 模块定位

forgemind 是 `flowforge/forgemind/` 子目录（**不是独立项目**），是 FlowForge 的应用层，承载万物灵智体育灵代码。三层架构明确划分：

| 层 | 项目 | 角色 | 灵智体承载 |
|---|---|---|---|
| **核心框架层** | `flowforge/`（除 forgemind） | 自进化核心 + 基础框架能力 | 提供灵智体锻造基础设施 |
| **应用层** | `flowforge/forgemind/` | 万物灵智体应用实践 | 养公共的通用灵智体（猫/桌椅/灯具/孙悟空等） |
| **垂直业务层** | contentforge/ devforge/ 等 | 垂直领域灵智体 | 各 *Forge 在自己垂直领域养专门灵智体 |

#### §0.3.2 forgemind 目录结构

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

#### §0.3.3 ForgekinBase 三方法契约

所有万物灵智体必须继承 `ForgekinBase`，实现三方法契约（对应 Harness 现实闭环三步）：

| 方法 | 用途 | 对应 Harness 层 |
|------|------|----------------|
| `observe(env) -> Observation` | 感知环境（物理传感器/虚拟世界设定/数字任务状态） | Evidence & Sensors |
| `act(observation) -> Action` | 执行动作（工具调用/物理执行器/虚拟行为） | Tool Mediation |
| `verify(action, result) -> Verdict` | 验证结果（测试/lint/review/物理反馈） | Governance Boundary |

#### §0.3.4 ForgePipeline 6 步锻造流水线

| 步骤 | 名称 | 输入 | 输出 |
|:----:|------|------|------|
| 1 | 形态定义（What to forge） | species + 能力画像需求 | ForgekinSpec |
| 2 | 能力注入（Capability injection） | ForgekinSpec + 模型 + 工具集 | CapabilityProfile |
| 3 | 记忆初始化（Memory seeding） | 初始记忆 + 价值观设定 | MindEcho 初始条目 |
| 4 | 价值观对齐（Value alignment） | 价值观设定 + 红线清单 | ValueCharter |
| 5 | 能力验证（Capability verification） | 能力基线测试用例 | 能力基线测试报告 |
| 6 | 觉醒晋升（Awakening promotion） | 验证通过 + operator 批准 | E1 灵启 Initiation 状态 |

#### §0.3.5 万物灵智体 5 种形态分类

| 形态 | 类名 | 示例 | 感知/执行通道 |
|------|------|------|--------------|
| 生物形态 | BioForgekin | 猫/狗/植物灵智体 | 摄像头/麦克风/IoT 传感器 |
| 组织形态 | OrgForgekin | 公司/团队/社区灵智体 | 业务数据 API/协同工具 |
| 物品形态 | ObjForgekin | 桌椅/灯具/车辆灵智体 | 物联网传感器/执行器 |
| 虚拟形态 | VirtualForgekin | 童话/神话/历史/游戏角色灵智体 | 虚拟世界设定层 |
| 混合形态 | HybridForgekin | VR/AR 实体灵智体 | 物理+虚拟双通道 |

#### §0.3.6 通用 AGI 三条路径

| 路径 | 承载形态 | 复现目标 |
|------|---------|---------|
| 物理 AI | BioForgekin / ObjForgekin / HybridForgekin | 物理世界实体（动物/物品/混合实体）的真实复现 |
| 虚拟 AI | VirtualForgekin / OrgForgekin | 虚拟世界角色（童话/神话/历史/组织）的真实复现 |
| 混合 AI | HybridForgekin | 物理+虚拟融合实体（VR/AR）的真实复现 |

> ⛔ **关键不变量**: forgemind **单向依赖**核心框架层，禁止反向调用；forgemind **不含业务领域代码**（编程红线第 10 条）；forgemind 通过 Plugin V3 协议注册，**不直接实例化**核心模块（编程红线第 12 条）；forgemind 灵智体必须建立**现实闭环**。

---

### §0.4 三方 Agent 集成规范

> **依据**: ADR 006 三方 Agent 集成 + `flowforge/docs/review/review.md` 第九章 EX-001~EX-010
> **operator 指令**: "我们的灵智体除了可以调用 flowforge 核心框架的能力外，还可以接入和使用任何三方的 Agent"

#### §0.4.1 设计原则：能力扩展而非工具调用

三方 Agent 是灵智体的**能力延伸**，不是"调用一下拿结果"的工具：
- 灵智体可加载 claude code 的代码能力、codex 的推理能力、opencode 的开源生态能力、trae 的 IDE 能力
- 三方 Agent 的能力画像被纳入灵智体的能力画像融合（ExternalAgentCapabilityFusion）
- 三方 Agent 执行状态写入灵智体共享状态（ExternalAgentSharedState）
- 三方 Agent 失败有 fallback 链（ExternalAgentFallback）
- 三方 Agent 执行轨迹写入灵智体 Eval 信号

#### §0.4.2 ExternalAgentAdapter 抽象层目录结构

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

#### §0.4.3 4 大机制

| 机制 | 用途 | Feature |
|------|------|---------|
| ExternalAgentProfile | 三方 Agent 能力画像（含盲点） | F032 |
| ExternalAgentSharedState | 执行状态写入灵智体共享状态 | F033 |
| ExternalAgentFallback | 失败回退链（跨厂商 fallback） | F034 |
| ExternalAgentCapabilityFusion | 三方 Agent 能力画像融合到灵智体 | F035 |

#### §0.4.4 4 个首批 Adapter

| 三方 Agent | 厂商 | 接入方式 | fallback 优先级 |
|---|---|---|:---:|
| Claude Code | Anthropic | CLI / SDK | 1 |
| Codex | OpenAI | CLI / API | 2 |
| OpenCode | 开源 | CLI | 3 |
| Trae | ByteDance | IDE / API | 4 |

#### §0.4.5 六层 Guardrails

| 治理层 | 机制 |
|--------|------|
| L1 输入验证 | 三方 Agent 调用前必须通过 Schema 校验 |
| L2 系统提示约束 | 灵智体 system role 注入"禁止绕过审计" |
| L3 工具白名单 | 三方 Agent 只能调用 allow-list 内工具 |
| L4 输出验证 | 三方 Agent 输出必须通过 lint + 测试 |
| L5 操作确认 | 不可逆操作（merge/release）需 operator 确认 |
| L6 成本上限 | 每个灵智体有三方 Agent 调用配额 |

#### §0.4.6 worktree 隔离机制

每个三方 Agent 调用必须创建独立 worktree：
- **网络隔离**：受限网络访问（网络白名单，仅允许访问必要域名）
- **权限控制**：仅 read + write_code + run_tests
- **审计追踪**：全部记录到 `harness-feedback/external-agent-traces/`
- **操作回滚**：错误操作可恢复

---

### §0.5 Plugin V3 四钩子规范

> **依据**: ADR 012 命名融合 §6 + `flowforge/core/plugin_protocol.py`
> **关系**: V2 钩子（register_agents/register_tools/register_loops/register_gates）**保留**，V3 四钩子**新增**，二者并存。

#### §0.5.1 V3 四钩子定义

| 钩子 | 用途 | 返回 |
|------|------|------|
| `register_forgekins` | 注册灵智体形态到 forgemind | `List[ForgekinSpec]` |
| `register_forge_skills` | 注册锻造技能 | `List[ForgeSkill]` |
| `register_council_channels` | 注册灵议通道 | `List[CouncilChannel]` |
| `register_auto_forge_config` | 注册灵锻（SpiritForge）配置 | `AutoForgeConfig` |

#### §0.5.2 与 V2 钩子的关系

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

### §0.6 v7.0 设计态声明

#### §0.6.1 设计态定位

v7.0 万物灵智体设计处于**"设计态"**：
- spec.md / arch.md / design.md 中 v7.0 章节为设计蓝图，**非已实现功能**
- 代码缺失严重度按"设计先行"标注，禁止虚假承诺
- 所有 v7.0 设计文档章节必须标注"设计态"或"已实现"

#### §0.6.2 可证伪性原则

- 避免使用"AGI"修饰词对外承诺（"通用 AGI"仅在内部愿景文档使用）
- 对外文档（README/营销材料）使用"自进化 Agent 框架"，不使用"AGI"
- 每个设计声明必须有可验证的完成标准（P37）

#### §0.6.3 已实现 vs 设计态清单

| 模块 | 状态 | 说明 |
|------|------|------|
| FlowForge 核心框架（LoopExecutor/ToolRegistry/EventBus） | ✅ 已实现 | v6.0 已落地 |
| Plugin V2 四钩子 | ✅ 已实现 | v6.0 已落地 |
| OpenSieve 聚合检索 | ✅ 已实现 | v6.0 已落地 |
| 育灵体系命名规范 | ✅ 已审核 | operator 已审核通过命名方案 |
| forgemind 应用层 | ⚠️ 设计态 | ADR 005 已 accepted，代码未实现 |
| ForgekinBase 三方法契约 | ⚠️ 设计态 | ADR 005 已定义，代码未实现 |
| 万物灵智体 5 种形态 | ⚠️ 设计态 | 设计完成，代码未实现 |
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

### §0.7 自我演进闭环规范

> **依据**: `flowforge/docs/review/review.md` §0.7 + ADR 013 万物灵智体愿景

#### §0.7.1 三层自我演进

| 层 | 演进对象 | 机制 | 治理 |
|----|---------|------|------|
| 文档层 | spec.md / arch.md / rules.md / prompts.md | 灵智体起草 + operator 审核 | operator 最终裁决 |
| 代码层 | flowforge/ / forgemind/ / *Forge | 灵智体实现 + 测试 + review | 不可逆操作需 operator 确认 |
| 框架层 | 育灵体系命名 / Plugin 协议 / 七大工程路径 | operator 直接决策 | 不可由灵智体自我演进修改 |

#### §0.7.2 "自己开发自己"11 步闭环

1. 架构师灵智体起草设计草案 → 2. operator 审核设计 → 3. 开发者灵智体实现代码 → 4. 测试员灵智体编写测试 → 5. Eval 员灵智体采集指标 → 6. 评审员灵智体 review → 7. 文档员灵智体更新文档 → 8. 灵锻员灵智体蒸馏经验到灵典 → 9. operator 验收 → 10. 灵议 Mind Council 议事 → 11. VISION.md 更新

#### §0.7.3 灵智体角色

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

### §0.8 质量分阈值统一

> **依据**: `flowforge/docs/review/review.md` §5.3 冲突点 3（operator 终稿决策：统一为 0.85）

| 配置项 | v6.0 现状 | v7.0 统一值 | 说明 |
|--------|----------|------------|------|
| 质量分阈值 | 部分 *Forge 使用 0.9 | **0.85** | 全部项目统一，可在 Loop 配置中覆盖 |
| Loop 超时 | 不一致 | **3 分钟** | Loop 流程在 3 分钟内完成 |
| LLM webchat 超时 | 不一致 | **30 秒** | WebChat 评委单次调用 |
| LLM API 超时 | 不一致 | **90 秒** | API 调用单次（长文章 2 分钟） |

> ⛔ **铁律**: 质量分阈值默认 0.85（编程红线第 2 条）。v6.0 部分 *Forge 使用 0.9 的配置必须在 v7.0 全部统一为 0.85。

---

### §0.9 v7.0 文档导航与依赖引用

#### §0.9.1 13 份依赖引用文档清单

| # | 文档 | 路径 | 用途 |
|---|------|------|------|
| 1 | 终稿审核 | `flowforge/docs/review/review.md` | 第六章命名融合/第八章 roleagent 补审/第九章 forgemind 补审 |
| 2 | spec.md v7.0 增补 | `flowforge/docs/spec.md` | v7.0 增补章节 |
| 3 | roleagent.md | `flowforge/docs/roleagent.md` | 七大工程路径镜像 |
| 4 | VISION.md | `flowforge/docs/VISION.md` | 万物灵智体愿景 |
| 5 | ADR 005 | `flowforge/docs/decisions/005-forgemind-application-layer.md` | forgemind 应用层 |
| 6 | ADR 006 | `flowforge/docs/decisions/006-external-agent-integration.md` | 三方 Agent 集成 |
| 7 | ADR 012 | `flowforge/docs/decisions/012-naming-fusion.md` | 命名融合 |
| 8 | ADR 013 | `flowforge/docs/decisions/013-all-things-spirit-mind-vision.md` | 万物灵智体愿景 |
| 9 | ADR 004 | `flowforge/docs/decisions/004-capability-profile-routing.md` | 能力画像路由 |
| 10 | F001 | `flowforge/docs/features/F001-capability-profile.md` | CapabilityProfile |
| 11 | F002 | `flowforge/docs/features/F002-teamact-loop.md` | TeamAct Loop |
| 12 | F026 | `flowforge/docs/features/F026-forgemind-app-layer.md` | forgemind 应用层 Feature |
| 13 | F031 | `flowforge/docs/features/F031-external-agent-adapter.md` | ExternalAgentAdapter Feature |

#### §0.9.2 16 份审核文件清单

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

### §0.10 clowder-ai 四机制引用（F100/F093/F241/ADR-021）

> **补审依据**: `flowforge/docs/review/review.md` 第十三章（CL-001~CL-021）21 项 clowder-ai/docs 深度补审
> **核心结论**: v7.0 在 [§0.2](#§02-roleagentmd-七大工程路径引用) 已吸收 roleagent.md 七大工程路径，但仍需吸收 clowder-ai/docs 的四个核心机制（F100/F093/F241/ADR-021 Pack），否则 v7.0 在"自我进化机制 / 世界引擎 / Agent Provider 协议 / Pack 信任编译"四个维度上与 clowder-ai 存在代际差距。
> **铁律**: 四机制是 **Built to Persist 复利型基础设施**，不可简化。代码实现位置：`flowforge/evolution/`（F100）+ `flowforge/core/world_engine/`（F093）+ `flowforge/core/external_agent/`（F241）+ `flowforge/core/pack/`（ADR-021）。

#### §0.10.1 F100 自我进化三模式（Mode A/B/C + Eval Ledger + 五级知识成熟度）

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

#### §0.10.2 F093 世界引擎三层架构（Core Identity / World / Bridge + 9 一等公民 + 三路记忆）

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

#### §0.10.3 F241 Agent Provider Plugin（ProviderTransportRegistry + host-owned 注入 + ACP transport + reference runtime）

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

#### §0.10.4 ADR-021 Pack 系统（Pack/Growth 种子果实模型 + 双轨信任编译 + World Driver）

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

### §0.11 v7.0 审核追溯（review.md 第十三章引用）

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

## 第一部分：9大项目架构总览

### 1.1 项目生态架构

OpenClaw 生态采用**分层解耦架构**，分为三层：基础设施层、平台层、应用层。

```
┌─────────────────────────────────────────────────────────────────┐
│                    应用层 (Application Layer)                    │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │ ContentForge│  │  NovelForge  │  │  DevForge    │           │
│  │ (内容创作)   │  │  (小说创作)  │  │  (软件开发)   │           │
│  │ :8001/5175  │  │  :8003/5177  │  │  :8002/5176  │           │
│  └─────────────┘  └──────────────┘  └──────────────┘           │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │  MallForge  │  │ StockForge   │  │   OpenClaw   │           │
│  │ (电商运营)   │  │ (股票分析)   │  │ (内容实例)   │           │
│  │ :8004/5178  │  │ :8005/5179   │  │  :800        │           │
│  └─────────────┘  └──────────────┘  └──────────────┘           │
└──────────────────────────┬──────────────────────────────────────┘
                           │ 注册 Agent/Tool/Loop
┌──────────────────────────▼──────────────────────────────────────┐
│                    平台层 (Platform Layer)                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  FlowForge (Agent 驾驭层 Harness Layer)                  │   │
│  │  • 9大执行模式 • Harness四根护栏 • Loop Engine           │   │
│  │  • ToolRegistry • AgentRegistry • MemoryManager         │   │
│  │  • EventBus • Helm交互 • Skill系统 • MCP集成            │   │
│  │  端口: 8000(后端) / 5174(前端)                           │   │
│  └─────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  OpenSieve (超级RAG智能体平台)                           │   │
│  │  • 所有数据检索统一入口(结构化+非结构化)                  │   │
│  │  • DataSource协议(结构化) • SearchSource协议(非结构化)    │   │
│  │  • 爬虫框架 • 多源融合(RRF) • Native Agent              │   │
│  │  端口: 8100                                              │   │
│  └─────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  OpenRoute (多模型LLM代理服务)                           │   │
│  │  • OpenAI API兼容 • 工具调用修正 • 上下文管理            │   │
│  │  • 7平台WebChat • 流式响应 • 模型路由                    │   │
│  │  端口: 13001                                             │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│                    基础设施层 (Infrastructure)                    │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │   HiClaw    │  │  数据库集群   │  │  向量数据库   │           │
│  │ (主控框架)   │  │ (PostgreSQL) │  │ (Milvus等)   │           │
│  └─────────────┘  └──────────────┘  └──────────────┘           │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 9大项目职责与端口

| # | 项目 | 层级 | 职责 | 后端端口 | 前端端口 |
|---|------|------|------|:--------:|:--------:|
| 1 | **FlowForge** | 平台层 | Agent驾驭层平台，提供9大执行模式、Harness四根护栏、Loop引擎(Planner/Worker/Verifier/Reflector/Memory)、Plugin V2协议、SDK、DI容器、EventBus、Memory(5层)、Helm交互 | 8000 | 5174 |
| 2 | **OpenSieve** | 平台层 | 超级RAG智能体平台，**所有数据检索(结构化+非结构化)的统一入口**，DataSource协议管理结构化数据源，SearchSource协议处理非结构化检索，爬虫框架(Playwright反检测)，多源融合(RRF排序)，Native Agent | 8100 | - |
| 3 | **OpenRoute** | 平台层 | 多模型LLM代理服务，OpenAI API兼容接口，7平台WebChat浏览器自动化(豆包/Kimi/DeepSeek/通义/元宝/GLM/MiniMax)，工具调用修正(ToolParser)，上下文管理(向量库+去重)，流式响应 | 13001 | - |
| 4 | **ContentForge** | 应用层 | AI内容创作工厂，基于FlowForge，11个专家Agent，支持4平台发布(头条/公众号/百家号/知乎)，通过persona配置支持多种创作风格 | 8001 | 5175 |
| 5 | **DevForge** | 应用层 | AI软件开发工厂，基于FlowForge，14个业务Agent，IPD门禁系统，GoT架构设计，Multi-Agent辩论代码审查，金丝雀发布 | 8002 | 5176 |
| 6 | **NovelForge** | 应用层 | AI小说创作工厂，基于FlowForge，8大创作阶段，5层上下文管理(解决100万字超窗口)，SOUL风格参数，7道质量门，盲评+仲裁 | 8003 | 5177 |
| 7 | **MallForge** | 应用层 | AI电商运营工厂，基于FlowForge，6大核心Agent，多平台(TikTok/Amazon/Shopee)，纯YAML配置驱动，10个MCP Server规划 | 8004 | 5178 |
| 8 | **StockForge** | 应用层 | AI股票分析工厂，基于FlowForge，6大Agent(技术指标/预测/选股/多空辩论/风控/报告)，所有数据走OpenSieve，三源容错(Tushare/AkShare/BaoStock)，质量分阈值0.85 | 8005 | 5179 |
| 9 | **HiClaw** | 基础设施 | 主控框架，任务调度、测试脚本、实例安装模板、OpenRoute集成 | - | - |

### 1.3 openclaw_pkg 当前状态

> **重要变更 (2026-06-28)**：openclaw_pkg 中 education/life/student/novel/dev 实例已合并到 content 实例，**content 为唯一活跃的内容创作实例**。openclaw_pkg 定位为 OpenClaw 内容创作 AI 工具的工作空间，端口 800。

```
openclaw_pkg/
└── workspace/
    └── content/     # 综合内容创作（唯一活跃实例）
        ├── agents/main/
        │   ├── SOUL.md / MEMORY.md
        │   └── skills/article-orchestrator/
        │       ├── scripts/ (generation/workflow/platforms/prompts)
        │       └── data/    # 运行时数据（铁律T9）
        └── tmp/
```

### 1.4 目录结构约定

#### *Forge 项目标准目录（P8A铁律）

所有 *Forge 项目（ContentForge/DevForge/NovelForge/MallForge/StockForge）**只允许**以下6类目录：

```
*forge/
├── config/          # persona配置、loop模板、workflow YAML、prompts.yaml、agents.yaml、tools.yaml、plugins.yaml
├── web/             # 自定义业务UI（Next.js）
├── app/             # 适配Web的API端点（FastAPI）
├── plugins.py       # 插件注册入口（继承FlowForgePlugin）
├── docs/            # 文档（spec.md/arch.md/design.md/test.md/task.md）
└── tests/           # 测试代码（单元测试/集成测试/E2E测试）
```

**禁止出现**：
- ❌ 独立 Orchestrator 编排逻辑
- ❌ 独立 DI 容器组装
- ❌ 独立 Memory/Repository 层
- ❌ 独立 LLM 服务
- ❌ 独立数据库层
- ❌ 独立事件系统
- ❌ 独立状态管理
- ❌ 独立配置系统
- ❌ Agent 基类封装（如 ContentForgeAgent/BaseNovelAgent）
- ❌ 独立 SDK 封装（如 ContentForgeSDK）

> **tools/ 目录说明**：当前各 *Forge 项目仍保留 tools/ 目录（Python 工具实现），标注为"待迁移到 FlowForge 工具库"。后续迭代中应将 tools/ 内实现迁移到 config/tools/*.yaml 声明式配置，由 FlowForge 工具库统一提供能力。
>
> **mcp_server/ 目录说明**：NovelForge 的 mcp_server/ 是项目特有功能，保留。
>
> **agents/ 目录说明**：Agent 应通过 config/agents/*.yaml 声明，不允许保留 Python Agent 类实现目录。当前 MallForge 仍保留 agents/（Python 类继承 GenericAgent），因 config/agents/ 尚未建立 YAML 声明，暂标注为"待迁移"，后续迭代中应删除 agents/ 并改由 config/agents/*.yaml 声明。

#### HiClaw 目录

```
hiclaw/
├── tool/openroute/          # OpenRoute LLM代理服务
│   ├── app.py               # FastAPI主应用
│   ├── tool_parser.py       # 工具调用解析与修正
│   ├── context_manager.py   # 上下文管理
│   ├── command_handler.py   # 内置命令处理器
│   ├── web/                 # Next.js前端
│   └── docs/                # API_SPEC.md / task.md
├── tool/model_manager/      # 模型管理器
├── test/                    # 全流程测试脚本
├── install/agents_defaults/ # 新实例默认SOUL/MEMORY
├── rules.md                 # 本文档
├── prompts.md               # AI助手Prompt模板（最高优先级）
└── README.md
```

---

## 第二部分：核心架构原则

### 2.1 核心铁律：配置驱动 > 代码继承 > 独立实现

**优先级**（递减）：
1. **配置驱动**（最佳）：通过YAML/JSON配置声明Agent/Tool/Workflow/Skill/MCP，零Python代码
2. **代码继承**（次之）：继承FlowForge基类重写方法 — 说明FlowForge配置能力不足，需改进框架
3. **独立实现**（禁止）：自己从零实现编排/存储/LLM调用等 — 严重违反架构原则

### 2.2 原则1：所有数据检索走OpenSieve

1. **所有数据检索必须通过OpenSieve**，包括结构化数据和非结构化数据
2. OpenSieve提供统一的数据检索接口：
   - **结构化数据源**（通过DataSource协议注册）：如A股行情、基金净值、电商商品数据
   - **非结构化检索**（通过SearchSource协议）：如公告/研报/新闻/知识库
   - **爬虫框架**（Playwright反检测）
   - **多源融合**（RRF排序）
3. **禁止绕过OpenSieve直接访问数据库或外部API**
4. StockForge的股票数据、ContentForge的素材检索、NovelForge的知识库、MallForge的商品数据等都必须通过OpenSieve

### 2.3 原则2：所有Agent通过LoopExecutor执行（P31铁律）

1. LoopExecutor是所有Agent的**唯一执行入口**
2. 调用方式：`sdk.loop_executor.run(loop_name=..., task_context=...)`
3. LoopExecutor包装HybridExecutor，每次迭代通过HybridExecutor执行
4. Harness Hook每次迭代触发（pre_execute注入上下文，post_execute架构约束校验）
5. 质量分阈值**0.85**（v4.0: 由0.9调整为0.85，平衡质量与可用性）
6. Loop超时分档铁律：
   - **快速 Loop**（screening/news_summary/快速分析）：**180秒**
   - **内容 Loop**（deep_article/content_polish/fact_check/publish/code_review）：**720秒**
   - **长文 Loop**（series_article）：**7200秒**
7. 嵌套Loop最大深度**3**

### 2.4 原则3：单向依赖

- 上层可依赖下层，**下层绝对禁止导入上层模块**
- FlowForge完全独立，对上层集成方无依赖无感知
- *Forge通过Plugin协议注册到FlowForge，不修改FlowForge核心代码

### 2.5 原则4：Plugin注册规则

所有 *Forge 项目通过继承 **FlowForgePlugin** 实现注册：

**标准钩子**（PluginProtocol已定义）：
- `register_agents()` — 注册所有Agent
- `register_tools()` — 注册所有Tool
- `register_loops()` — 注册Loop配置（**注意：不是register_workflows**）
- `register_workflows()` — 注册Workflow
- `register_routes()` — 注册API路由
- `register_schedules()` — 注册定时任务
- `register_event_handlers()` — 注册事件处理器
- `register_gates()` — 注册质量门禁
- `register_evaluators()` — 注册评估器
- `on_startup()` / `on_shutdown()` — 生命周期

**死代码警告**：
- ❌ `register_helm_handlers` — FlowForge PluginProtocol **未定义**此钩子（FW-CONSIST-001），实现了也不会被调用
- ❌ `register_permission_policy` — FlowForge PluginProtocol **未定义**此钩子（FW-CONSIST-002），实现了也不会被调用
- 如需事件订阅，使用 `register_event_handlers` 替代 `register_helm_handlers`
- 如需权限策略，使用 `register_gates` 替代 `register_permission_policy`

### 2.6 原则5：十大架构原则（FF17）

1. **底座能力原则**：至少2个上层应用需要的能力才可下层到FlowForge
2. **单向依赖原则**：上层可依赖下层，下层禁止导入上层
3. **配置外置原则**：所有密钥/路径/环境相关配置通过配置系统注入
4. **真实实现原则**：禁止假数据、假逻辑、模拟返回
5. **依赖注入原则**：禁止绕过DI容器直接实例化
6. **数据访问原则**：禁止直接操作数据库，必须通过Repository层
7. **接口隔离原则**：所有抽象基类在 `core/interfaces/` 中定义
8. **可观测性原则**：日志自动注入trace_id，所有I/O使用async/await
9. **开箱即用原则**：预制Workflow/Agent/Model配置
10. **循环依赖零容忍原则**

### 2.7 FlowForge 核心能力概览

#### 9大执行模式
1. **react** — Thought→Action→Observation循环（MAX_STEPS=8）
2. **plan_execute** — Planner生成步骤清单，Executor依次执行
3. **reflexion** — Actor→Evaluator→Reflector三Agent迭代（MAX_ITERATIONS=4）
4. **multi_agent** — Subagents/Teams/Swarms三种子策略
5. **workflow** — 预定义DAG流程（混合模式，max_depth=3）
6. **rewoo** — 一次性规划所有工具调用，批量执行
7. **self_discover** — 任务前自动发现最佳推理结构
8. **agent_judge** — 独立Agent作为评判者
9. **graph_of_thoughts** — 图式推理，多思路聚合交叉验证

#### Harness四根护栏
1. **上下文工程**（ContextEngine）— AGENTS.md动态知识注入
2. **架构约束**（ArchitectureConstraintEngine）— 分层依赖检查
3. **反馈循环**（FeedbackLoop）— 四维评分 + 分类闸门 + 三种评估模式
4. **熵管理**（EntropyManager）— 文档园丁Agent + 技术债跟踪 + 规则进化

#### Loop Engine五层模块
1. **Planner**（3种模式：plan_execute/self_discover/llm_direct）
2. **Worker**（复用HybridExecutor，mode=workflow/agent/loop嵌套，最大深度3）
3. **Verifier**（4种模式：agent_judge/rule_based/schema/test_suite）
4. **Reflector**（2种模式：reflexion/trace_analysis）
5. **Memory**（5种映射：working/short_term/long_term/semantic/episodic）

#### Memory系统5种记忆策略
Working / Short-term / Long-term / Semantic / Episodic + TaskBoard + Mailbox + CheckpointManager + ContextCompressor

---

## 第三部分：OpenSieve 详解

### 3.1 定位

OpenSieve 是**超级RAG智能体平台**，是所有数据检索的**统一入口**。

### 3.2 核心能力

| 能力 | 说明 |
|------|------|
| **DataSource协议** | 结构化数据源管理（如Tushare/AkShare/BaoStock股票数据适配器），由SourceLifecycleManager统一管理三源容错 |
| **SearchSource协议** | 非结构化检索（SearXNG/Tavily/DuckDuckGo等20+搜索源） |
| **检索Pipeline** | 10步流程：CacheCheck→QueryUnderstanding→MultiSourceSearch→Deduplication→Ranking→Reranker→CRAGReflection→MMRDiversify→ImageDownload→CacheUpdate |
| **Native Agent** | 5大Agent：SearchAgent/ResearchAgent/MaterialAgent/CrawlAgent/GraphAgent |
| **知识库引擎** | 五种入库 + 三级去重 + 六种召回算法 |
| **四级语义缓存** | L1 Redis Sorted Set → L2 Redis → L3 内存LRU → L4 ES |
| **爬虫框架** | Playwright + 反检测 + 领域爬虫 |
| **多租户架构** | 租户识别、数据隔离、资源配额、配置层级、API Key轮转 |

### 3.3 数据库

Milvus（向量）、Elasticsearch（BM25全文）、Neo4j（知识图谱）、Redis（缓存）、PostgreSQL（关系型）

### 3.4 部署规范

必须使用 `quickstart.sh` 一键启动脚本管理生命周期：

```bash
cd /home/hyg/ai/openclaw/opensieve
./quickstart.sh start      # 首次启动
./quickstart.sh restart    # 重启
./quickstart.sh stop       # 停止
./quickstart.sh status     # 状态
./quickstart.sh build      # 重新构建镜像（仅在代码变更时）
```

**严禁**：
- ❌ 直接使用docker命令启停容器
- ❌ 反复重新构建镜像（除非代码变更）
- ❌ 在容器内手动安装依赖

---

## 第四部分：代码风格规范

### 4.1 Python 代码规范

1. **字符串与正则**：包含 `\` 的正则表达式**必须使用 raw string** `r"..."`
2. **导入顺序**：标准库 → 第三方库 → 本地模块
3. **函数命名**：snake_case，前缀 `_` 表示私有方法
4. **异常处理**：必须明确返回状态
5. **asyncio**：使用 `get_running_loop()` 而非已废弃的 `get_event_loop()`；sync代码用 `ThreadPoolExecutor`

### 4.2 模板文件规范（.j2）

1. **Jinja2 语法**：变量 `{{ var }}`，条件 `{% if %}`
2. **中文内容**：使用中文引号 `""` 或 `''`
3. **prompt 结构**：角色定义 → 分层规则 → `★★★` 最高优先级 → `❌` 禁止事项

### 4.3 配置文件规范

1. **YAML**：缩进 2 空格，不用 tab
2. **JSON**：合法 JSON
3. **环境变量**：`.env` 文件，绝不提交密钥到 git

### 4.4 Web 前端多语言（i18n）规范

**框架**：`react-i18next` + `i18next`

**支持语言**：中文（zh）、英文（en）

**铁律**：
1. ❌ 禁止在组件中硬编码用户可见文本
2. ❌ 禁止只更新一种语言的翻译文件
3. ❌ 禁止在翻译键中使用拼接
4. ✅ 新增页面/组件时，必须同时添加翻译键到 en.json 和 zh.json

### 4.5 变量引用规范（跨项目统一）

- `${{state.xxx}}` / `${{params.xxx}}` / `${{result.xxx}}` / `${{outputs.xxx.yyy}}`
- Agent命名空间：`项目名:agent名`（如 `stockforge:technical_indicator`）
- 状态输出：`state_updates: {key: expression}`

---

## 第五部分：开发规范与最佳实践

### 5.1 铁律：禁止盲目覆盖

```
🚫 绝对禁止：cp content/file.py content/backup/file.py（跨目录盲目覆盖）
🚫 绝对禁止：shutil.copy(src, dst) 跨实例覆盖
🚫 绝对禁止：批量复制模板文件
```

### 5.2 铁律：禁止造假

```
🚫 禁止使用模拟数据(fake data)假装功能已实现
🚫 禁止写死分数、写死结果、写死状态
🚫 禁止使用"模拟向量搜索"等假逻辑
🚫 禁止返回硬编码的{"status": "ok"}
🚫 禁止用hash生成假数据
```

**真实实现标准**：向量检索必须用真实模型+真实数据库；BM25必须用真实分词；重排序必须用真实Cross-Encoder；知识图谱要么真实构建要么彻底移除。

### 5.3 运行时数据文件存放规范（铁律T9）

所有运行时生成的数据文件必须存放在 `agents/main/data/` 目录下。**严禁**在代码目录中创建运行时数据文件。

### 5.4 Git 操作规范

1. 恢复文件：优先使用 `git checkout HEAD -- path/to/file`
2. 非git管理文件：手动备份后再修改
3. 修改前：先 `git diff` 了解当前状态

### 5.5 测试铁律（T1-T9）

| 编号 | 铁律 | 说明 |
|------|------|------|
| T1 | 禁止使用Mock LLM | 所有E2E/集成测试必须调用真实LLM |
| T2 | 禁止使用假数据 | 测试输入必须是真实场景数据 |
| T3 | 禁止跳过验证 | 必须有具体断言，不能只看退出码 |
| T4 | 禁止Mock工具 | web_search/publish/fact_check等必须真实调用 |
| T5 | 未实现即Bug | 发现代码未实现必须记录为Bug并修复 |
| T6 | 必须采集指标 | E2E测试必须用MetricsCollector采集完整指标 |
| T7 | LLM内容必须经LLM审核 | 凡LLM生成的内容，必须再调用LLM审核通过才算验证通过（生成与审核使用不同模型） |
| T8 | Web功能必须操控浏览器验证DOM | 凡涉及网页操作的功能，必须操控浏览器查看DOM确认真实成功 |
| T9 | 运行时数据文件必须存放data目录 | 禁止污染代码目录 |

### 5.6 质量评审配置规则（P33）

- 质量分阈值默认 **0.85**（v4.0: 由0.9调整为0.85，平衡质量与可用性）
- 禁止修改提示词引导评委给高分
- 5个WebChat评委必须使用**不同模型**
- 1个写作Agent必须与评委使用**不同模型**
- 评委必须**并行评审**
- 不达标必须优化提示词和质量，不能降低阈值

---

## 第六部分：AI 助手行为准则

### 6.1 核心原则

1. **理解上下文再行动**
2. **尊重差异化**：不同项目/实例有不同定位
3. **谨慎操作**：涉及文件修改先说明影响范围
4. **及时反馈**

### 6.2 操作流程

```
收到任务 → 理解需求 → 检查状态 → 评估影响 → 制定方案 → 执行修改 → 验证结果 → 汇报
```

### 6.3 禁止行为

| 行为 | 原因 |
|------|------|
| shutil.copy() 跨实例覆盖 | 破坏差异化内容 |
| 不检查直接执行 git checkout | 可能恢复不需要的内容 |
| 假设文件相同 | 可能已分化 |
| 不告知用户就修改多个文件 | 用户无法控制风险 |
| **使用假数据、假逻辑、模拟代码** | **欺骗用户，系统无法真实运行** |

---

## 第七部分：Trae CN编程红线（违反即作废）

> 来源：prompts.md P34 + 10.7节，共15条

1. 禁止添加CoT检测/中文比例检测
2. 质量分阈值默认0.85（v4.0调整，可在Loop配置中覆盖）
3. 禁止使用Mock LLM（测试铁律T1）
4. 禁止使用假数据（测试铁律T2）
5. 禁止跳过验证（测试铁律T3）
6. 禁止只看退出码不检查输出质量
7. 禁止在修复问题时修改不相关代码
8. 禁止删除已有测试用例
9. 禁止用继承替代组合/插件
10. 禁止在flowforge中写死业务领域代码
11. 禁止硬编码提示词/路径/密钥/端口
12. 禁止绕过DI容器直接实例化
13. 禁止直接操作数据库
14. 禁止不按prompts.md和rules.md执行
15. 禁止偷工减料（发现未实现即Bug）

---

## 第八部分：FlowForge 与 *Forge 架构边界验证（P8A核心铁律）

### 8.1 验证要点

```
请严格验证 FlowForge 与各 *Forge 项目之间的架构边界，这是整个生态的根基铁律。

## 核心铁律：配置驱动 > 代码继承 > 独立实现

1. FlowForge 是纯通用框架，不包含任何业务逻辑
2. *Forge 只允许 config/web/app/plugins.py/docs/tests 六类文件
3. 所有 Agent/Tool/Loop/Workflow 通过 Plugin 协议注册
4. 禁止 *Forge 独立实现 Orchestrator/Memory/Repository/DI/Scheduler/Database
5. 禁止 *Forge 中创建 Agent 基类（如 BaseXxxAgent）
6. 禁止 *Forge 中创建独立 SDK 封装
```

### 8.2 代码全量扫描8大类（P14A）

1. 硬编码与配置外置（铁律5）
2. 空实现与占位代码（铁律2+5）
3. 绕过框架（铁律3+4+6）
4. 代码规范
5. 重复代码
6. 测试覆盖
7. API与路由
8. 数据库与模型

---

## 第九部分：AI编程优秀实践与踩坑总结（阶段1+选题迁移经验）

> 本部分总结 ContentForge 阶段1（创作+润色接口替换）和阶段2（选题接口迁移+URL向量化）中遇到的关键坑和经验，防止后续新功能重复踩坑。

### 9.1 ContentForge 阶段1：创作+润色接口替换的18个坑

阶段1替换工作历时近一个月、数百次迭代，主要坑集中在5类：

#### 9.1.1 JSON 包装泄漏（最严重的格式问题）

**现象**：发布到头条的文章内容包含 `{"draft": "..."}` JSON 包装，丢失 markdown 格式。

**根因**：Loop 结果提取器（result_extractor）未剥离 ToolOutput result dict 序列化后的 JSON 包装，导致评委和发布工具收到 JSON 字符串而非纯 markdown。

**修复**：在3处添加 `_strip_json_wrapper()` 逻辑：
- `flowforge/loop/result_extractor.py`
- `contentforge/app/api/endpoints/content.py`（`_strip_json_wrapper_content` + `_deep_extract_content_fallback`）
- `flowforge/loop/executor.py`

**经验**：凡是从 Loop 结果提取内容的代码路径，必须在最终输出前检查 `content.strip().startswith("{")` 并剥离 JSON 包装。

#### 9.1.2 LLM 静默失败（最隐蔽的稳定性问题）

**现象**：OpenRoute 返回 HTTP 200 + 伪装的 `chat.completion`，但内容是 `"模型 X 当前不可用，请稍后重试"`，导致 LLMClient 误判为成功，不触发模型回退。

**根因**：`classify_error` 只检查 HTTP 状态码和显式 error 字段，未检查响应内容中的伪装失败文案。

**修复**：
- `INVALID_RESPONSE_PATTERNS` 加入 `"当前不可用，请稍后重试"` 和 `"当前不可用,请稍后重试"`
- `_normal_call` 和 `_stream_call` 显式检查静默失败内容，抛出 `RuntimeError("model disabled")` 触发回退
- `classify_error` 识别 `"model disabled"`、`"all_backends_failed"`、`"无权访问"` 为永久错误（model_not_found），立即切换而非重试

**经验**：LLM 网关可能返回 HTTP 200 + 伪装失败体，必须检查响应内容模式，不能只看状态码。

#### 9.1.3 URL 路径处理陷阱

**现象**：OpenRoute 健康检查探测 URL 错误地变成 `http://localhost:1300/v1`（端口从 13001 变成 1300）。

**根因**：使用 `.rstrip("/v1")` 处理 URL 后缀，但 `rstrip` 是字符集删除而非字符串删除，把端口号 `13001` 末尾的 `1` 也剥掉了。

**修复**：改用 `.removesuffix("/v1")`（Python 3.9+），只删除完整后缀。

**经验**：永远不要用 `rstrip` 删除字符串后缀，必须用 `removesuffix` 或正则。

#### 9.1.4 条件路由正则陷阱

**现象**：`publish_agent` 错误调用，因为 Workflow YAML 中的 `${{state.xxx}}` 双花括号变量无法解析。

**根因**：`workflow_executor.py` 的 `_evaluate_condition` 正则 `^\$\{(\w+)(?::([^}]*))?\}$` 只匹配单花括号 `${...}`，不匹配双花括号 `${{...}}`。

**修复**：改为 `^\$\{{1,2}(\w+)(?::([^}]*))?\}{1,2}$`，支持单/双花括号。

**经验**：变量引用语法必须统一（`${{state.xxx}}` 双花括号），正则必须覆盖所有合法语法。

#### 9.1.5 模型分配并发瓶颈

**现象**：StockForge 所有 assignments 的 primary 都是 proxy，与 ContentForge 共用同一平台造成同平台内部串行等待。

**修复**：改为不同平台（data_analysis/prediction/risk_assessment/report_generation/bull_bear_debate 分别对应 Kimi-K2.6/Qwen3.6-Plus/Kimi-K2.6/Kimi-K2.6/Qwen3.6-Plus）。

**经验**：模型分配的 primary 必须跨厂商分布，避免单一平台并发瓶颈。评委候选链排序时，评委指定模型排在首位。

#### 9.1.6 SSE 流式进度推送

**现象**：SSE 客户端收不到 Loop 执行进度事件。

**根因**：`TaskContext` 未显式注入 `event_bus`，导致 `task.event_bus` 为 None，Loop 发射的事件无法被 `_subscribe_loop_progress` 订阅。

**修复**：构造 TaskContext 时显式注入 `event_bus=getattr(_sdk, '_event_bus', None) or getattr(_sdk, 'events', None)`。

**经验**：LoopExecutor 发射的进度事件依赖 TaskContext.event_bus，必须显式注入。

#### 9.1.7 浏览器自动化陷阱（T8测试）

**现象**：T8 测试频繁超时，浏览器实例失效后 `is_connected()` 误报 True。

**根因**：
1. Next.js 开发服务器的 HMR/websocket 网络活动导致 `networkidle` 等待条件永远无法满足
2. 浏览器实例失效后 `is_connected()` 可能误报 True

**修复**：
- 浏览器等待条件用 `wait_until="domcontentloaded"` 而非 `networkidle`
- 浏览器实例失效后必须重建，包括 `is_connected()` 检测和 `new_page()` 失败重试逻辑
- 默认超时从 30s 提升到 60s
- Windows 下 openroute browser 必须用 `headless=False`（可见模式）

**经验**：SPA 站点（Next.js 等）的浏览器自动化不要用 `networkidle`，用 `domcontentloaded`。

#### 9.1.8 其他坑汇总

| 坑 | 修复 |
|----|------|
| `_normal_call` 访问 `data["choices"]` 抛 KeyError | 先检查 `"error" key |
| `reflector.reflect` 缺少执行时间日志 | 添加 `execution_time` 日志 |
| `editor_engine` 报 "Invalid params" | polish 任务必须传递 `draft` 字段 |
| ReflexionExecutor 走 DefaultLLMActor fallback | task 只有 57 字符，LLM 收到无意义提示超时 |
| 头条发布内容有 markdown 符号 | 发布前 `_strip_markdown_for_publish` 剥离 `**` `##` 等 |
| 评委全从路由 primary 开始造成并发瓶颈 | 评委指定模型排在候选链首位 |
| 4/5评委超时（Kimi/Qwen/HunYuan/MiniMax >180s） | `judge_timeout` 提升到 300s |
| 候选链缺少 Qwen3.6-Plus 和 HunYuan3 | judge 路由 fallback 补全 |
| Toutiao publisher 与 interactor 在 Windows 下不共用 user_data_dir | 直接用，不加 `_N` 后缀 |

### 9.2 ContentForge 阶段2：选题接口迁移+URL向量化

#### 9.2.1 设计原则

1. **配置驱动**：选题 Loop 通过 `topic_loop.yaml` 配置，3评委+6维度+阈值0.80
2. **双模式支持**：默认提示词选题（intent 驱动）+ URL 选题模式（source_url 驱动）
3. **URL 向量化**：爬取URL下所有文章 → 15维度评估 → 写入 OpenSieve 向量库
4. **Loop 复用**：选题接口复用 FlowForge LoopExecutor，3评委并行评审

#### 9.2.2 选题 Loop 配置要点

```yaml
# topic_loop.yaml 关键配置
verifier:
  mode: multi_judge
  judges:  # 3评委跨厂商，全部 prefer_api=true 避免 webchat 截断
    - model: openroute/Doubao-Seed2.0  # 字节 - 最稳定
    - model: openroute/GLM-5.1         # 智谱 - 成功率高
    - model: openroute/Kimi-K2.6       # 月之暗面 - 质量高
  exclude_creator: true  # 排除创作模型，避免自评偏差
  pass_threshold: 0.80   # 选题阈值低于文章创作(0.85)，允许更大探索空间
  judge_timeout: 60      # API backend 响应快(5-30s)，3评委并行<30s
```

#### 9.2.3 URL 向量化15维度评估

URL 向量化工具 (`url_ingestor.py`) 实现：
1. 识别URL类型（单篇文章/用户主页/话题页/RSS）
2. 并行爬取文章（限制并发3，避免反爬）
3. LLM 评估15维度（title_attractiveness/opening_hook/content_depth/...）
4. 写入 OpenSieve 向量库（含15维度分数）

**关键设计**（v2.1 修正）：
- 15维度与 `deep_article_loop.yaml` 一致，确保选题和创作评估标准统一
- 提示词外置到 `opensieve/config/prompts.yaml`（`preselect.evaluate_15_dims` key），**禁止跨层依赖 contentforge 配置**
- OpenSieve 端点从环境变量注入（`OPENSIEVE_ENDPOINT`），禁止硬编码
- ContentForge 的 `url_ingestor.py` 是薄包装，仅调用 OpenSieve API，不自己爬取/向量化

#### 9.2.4 选题接口的 T6+T7 验证

T6 指标采集：
- quality_score / iterations / strategy / topics_count
- 任务耗时 / 评委数量 / 阈值
- 每个选题的 title/angle/domain/trend_reason

T7 LLM 审核：
- 对每个选题（title + angle + trend_reason）调用 LLMReviewer 审核
- 审核维度：自然度(无AI痕迹)、相关性、格式、内容、连贯性
- 全部通过才算 PASS

**验证结果**（2026-07-08）：
- T6 PASS: quality=0.845, topics=3, iterations=1, strategy=hot_trend
- T7 PASS: 3/3 选题通过 LLM 审核

#### 9.2.5 v2.1 架构修复经验（2026-07-09）

**发现的6个问题及修复**：

1. **source_filter 链路断裂（最严重）**：
   - 问题：设计文档说 retrieve.py 支持 source_filter，但 RetrieveQuery 模型无该字段（`extra="ignore"` 直接丢弃），OpenSieveClient._do_search payload 不含 source_filter
   - 修复：RetrieveQuery 增加 source_filter 字段，retrieve.py 路由层分流（preselect/web/local→PreselectService，all→原有Pipeline），OpenSieveClient._do_search 传递 source_filter
   - **教训**：设计文档与代码实现必须一致，每次修改后必须验证链路完整性

2. **定时预抓取未真正实现**：
   - 问题：preselect_service.schedule 只存内存 dict，未注册到调度器
   - 修复：用 APScheduler AsyncIOScheduler+CronTrigger 注册 cron 任务，持久化调度记录
   - **教训**：调度功能必须注册到真正的调度引擎，不能只存内存

3. **Milvus 向量未隔离**：
   - 问题：preselect_service 覆盖了 `_es_index` 但未覆盖 Milvus collection，预选题向量混入普通文档向量
   - 修复：IngestionPipeline._generate_vector 优先使用 `_milvus_collection` 属性
   - **教训**：数据隔离必须同时覆盖所有存储后端（ES+Milvus），不能只隔离一个

4. **15维度提示词跨层依赖**：
   - 问题：OpenSieve（下层）从 contentforge/config/prompts.yaml（上层）加载提示词，违反分层原则
   - 修复：提示词迁移到 opensieve/config/prompts.yaml 的 preselect.evaluate_15_dims key
   - **教训**：下层服务不能依赖上层配置文件，必须自包含

5. **路径计算错误**：
   - 问题：`_project_root = Path(__file__).resolve().parent.parent.parent.parent` 多算一层
   - 修复：改为 `parent.parent.parent`（opensieve/core/services/ → opensieve/）
   - **教训**：路径计算必须验证，用 print/os.path.exists 确认

6. **Docker bind mount 验证**：
   - 经验：OpenSieve 运行在 Docker 中，通过 bind mount 挂载宿主机代码目录（config/core/server/），修改代码后只需 `docker restart` 即可加载新代码，无需重建镜像

### 9.3 通用经验总结

#### 9.3.1 LLM 调用稳定性

1. **必须实现候选链回退**：单一模型不可靠，必须配置跨厂商候选链
2. **必须识别静默失败**：HTTP 200 + 伪装内容是常见模式
3. **永久错误立即切换**：model_not_found/no_permission/无权访问 不重试，立即切换
4. **临时错误指数退避**：timeout/rate_limit 用 `backoff = retry_delay × 2^attempt`
5. **free 模型不可用于关键任务**：free 模型经常返回空内容或"无法回答"，创作/润色/评委必须用 webchat 模型

#### 9.3.2 Loop 工程模式

1. **Discover→Assign→Act→Verify→Persist 五步闭环**
2. **长程任务用进度文件模式+检查点驱动**
3. **六层 Guardrails**：Input validation + System prompt constraints + Tool allow-lists + Output validation + Action confirmation + Cost ceilings
4. **自我纠错**：Error-driven Reflection + 迭代上限3-5次
5. **增量规划**：先规划前3-5步→执行→观察→再规划

#### 9.3.3 新功能开发流程（防止阶段1重蹈覆辙）

1. **先读后写**：修改前完整理解当前实现
2. **确定影响范围**：涉及多模块修改时列出影响清单
3. **逐个处理**：跨模块修改逐个处理，不可批量复制
4. **可验证目标**：每个任务必须有可验证的完成标准
5. **T6+T7 同步验证**：开发完成后立即跑 T6（指标采集）+T7（LLM审核）
6. **记录坑和经验**：每个新功能完成后，把坑更新到本部分

---

## 第十部分：修改记录

| 日期 | 版本 | 修改内容 |
|------|------|---------|
| 2026-03-05 | v1.0 | 初始版本 |
| 2026-05-13 | v1.2 | 更新测试规范、OpenSieve部署规范 |
| 2026-06-28 | v1.3 | 更新9大项目架构、OpenSieve定位修正 |
| 2026-06-28 | v3.0 | **完全重写**：9大项目架构总览、核心架构原则、OpenSieve详解、Plugin注册规则、死代码警告、端口号修正、删除重复章节、删除过时openclaw_pkg 6实例描述、添加P8A边界验证、添加编程红线15条 |
| 2026-07-08 | v3.1 | 添加第九部分：AI编程优秀实践与踩坑总结（ContentForge阶段1的18个坑+阶段2选题接口迁移+URL向量化经验） |

---

> **此文档放在 hiclaw 目录下，Trae CN 启动时自动读取。**
> **每次修改前，AI 助手必须回顾本文档，特别是第一部分（9大项目架构）和第二部分（核心架构原则）。**
> **如发现本文件与prompts.md或项目docs冲突，以prompts.md和项目docs为准，并请更新本文件。**
