# FlowForge v7.0 自我进化与养灵体系设计 — 多角色联合深度审核意见（Kimi 团队 第五轮）

> **审核日期**：2026-07-15
> **审核版本**：`flowforge/docs/spec.md` v2.1/v7.0 混合、`flowforge/docs/arch.md` v6.0/v7.0 混合、`flowforge/docs/design.md` v6.0/v7.0 混合、`flowforge/docs/face/*` v3.0-face
> **审核角色**：AI 智能体产品专家 / AI 高级架构师 / AI 智能体 Agent 开发工程师 / 高级软件全栈工程师 / 产品总监 / 技术 VP
> **审核范围**：
> - `flowforge/docs/spec.md`（第 3219 行起 v7.0 炉灵内容）
> - `flowforge/docs/arch.md`（第 5293 行起 v7.0 七层架构）
> - `flowforge/docs/design.md`（第 3260 行起第五部分 v7.0 详设）
> - `flowforge/docs/face/{spec_face.md, arch_face.md, task_face.md, face.md, ds.md}`
> - `hiclaw/rules.md`（15 条编程红线 + 9 条测试铁律 + 6 条架构铁律）
> - `hiclaw/prompts.md`（P1-P40 / P8A / P10 / P14A / P16 / P31-P35 / P37 / FF20-FF21）
> - 实际代码：`flowforge/evolution/`、`flowforge/agents/`、`flowforge/memory/`、`flowforge/llm/`、`flowforge/tools/llm_client.py`、`flowforge/tests/`、`contentforge/`、`devforge/`、`stockforge/`、`opensieve/`、`hiclaw/openroute/`
>
> **本轮特点**：
> 1. 在前四轮（doubao/minimax/glm/qianwen）审核基础上，重点验证**上一轮发现的问题是否已修复**。
> 2. 逐文档、逐章节、逐问题分析，不摘要后处理。
> 3. 深入检查 9 大项目当前代码与 `rules.md`/`prompts.md` 的实时一致性。
> 4. 独立输出一套养灵体系命名方案（见第七部分）。
> 5. **本轮关键更新**：经本轮实时代码核查，发现 `flowforge/agents/` 业务 Agent 已清理（仅剩 `generic/`），但 `devforge/plugins.py:470` 的 `register_evolution` 仍未删除、`flowforge/core/declarative_agent.py:750` 新增硬编码提示词、`flowforge/config/` 缺失 `evolution.yaml` 等 v7.0 配置、`flowforge/core/plugin_protocol.py` 未定义 PluginProtocol V3 的 `register_forgekins` 钩子。

---

## 目录

1. [总体评价与核心结论](#1-总体评价与核心结论)
2. [第一部分：spec.md 炉灵体系逐章审核](#2-第一部分specmd-炉灵体系逐章审核)
3. [第二部分：arch.md 七层架构逐章审核](#3-第二部分archmd-七层架构逐章审核)
4. [第三部分：design.md 详细设计逐章审核](#4-第三部分designmd-详细设计逐章审核)
5. [第四部分：face 目录 v3.0 需求逐章审核](#5-第四部分face-目录-v30-需求逐章审核)
6. [第五部分：代码实现与设计文档差异实测](#6-第五部分代码实现与设计文档差异实测)
7. [第六部分：9 大项目与 rules.md/prompts.md 一致性冲突逐项分析](#7-第六部分9-大项目与-rulesmdprompts-md-一致性冲突逐项分析)
8. [第七部分：养灵体系命名方案建议](#8-第七部分养灵体系命名方案建议)

---

## 1. 总体评价与核心结论

### 1.1 总体评分

| 维度 | 评分（10 分制） | 评价 |
|------|:---------------:|------|
| **产品愿景与 AGI 定位** | 9.0 | 「从驾驭到养成」的范式跃迁清晰，对标 clowder-ai 且有 FlowForge 自身「炉/锻造」特色，符合 AGI 从工具到伙伴的演进。 |
| **架构设计合理性** | 6.5 | 七层架构概念清晰，但与 v3.0-face「互联层」在第 7 层定义上直接冲突；自进化层与 Harness 层边界仍有重叠。 |
| **技术可行性** | 5.5 | 设计宏大，但代码实现严重滞后：design.md 描述 30+ 文件，实际 evolution/ 仅 8 个旧版文件，且术语未对齐 v7.0。 |
| **文档完整性与一致性** | 5.0 | 版本号混乱（spec v2.1、arch/design v6.0、内容 v7.0），face 文档与主文档多处术语/层数冲突，M18-M20 删除不彻底。 |
| **代码实现一致性** | 4.0 | evolution/ 仍使用 v4.0 `SelfEvolutionEngine` 术语，与 v7.0 `ForgekinEngine` 严重冲突；大量设计模块 0 实现。 |
| **9 大项目规范一致性** | 4.5 | 多处违反 rules.md/prompts.md：硬编码提示词、直接 SQL、MockLLM、独立 LLMClient 与 ModelCapability 并存；`flowforge/agents/` 业务 Agent 已清理是积极信号，但 `declarative_agent.py` 仍残留领域提示词。 |
| **配置驱动合规性** | 6.0 | v7.0 设计了完整 YAML 配置（evolution.yaml/forgekin_seeds/a2a_channels.yaml），但现有 core 代码仍有硬编码残留。 |
| **测试可验证性** | 5.0 | spec.md 定义 AC-01~AC-47，但缺少「自我进化有效性」的客观测试策略；测试代码中仍有 MockLLM。 |
| **养灵体系命名成熟度** | 7.0 | 炉灵/魂忆/魂印/锻典/灵议/自锻/升华阶体系完整，但 ToB 接受度、与 clowder-ai 解耦、英文国际化仍需打磨。 |

### 1.2 核心发现：Top 20 严重问题（按优先级排序）

| # | 等级 | 问题描述 | 涉及文档/代码 | 优先级 |
|---|:----:|----------|---------------|:------:|
| 1 | 🔴 致命 | **版本号严重混乱**：`spec.md` 标题写 v2.1、`arch.md`/`design.md` 标题写 v6.0，但正文第 7 章起全是 v7.0 炉灵内容；`spec_face.md` 声称引用 `spec.md` v7.0 权威源，但该标题并不存在。 | `spec.md:1` / `arch.md:1` / `design.md:1` / `spec_face.md:7` | P0 |
| 2 | 🔴 致命 | **evolution/ 代码术语未同步 v7.0**：`flowforge/evolution/__init__.py` 导出 `SelfEvolutionEngine`，`engine.py` 实现 `SelfEvolutionEngine`（v4.0 旧名），与设计文档 `ForgekinEngine` 严重冲突。`devforge/plugins.py:473` 仍加载 `SelfEvolutionEngine`。 | `flowforge/evolution/` / `devforge/plugins.py:473` | P0 |
| 3 | 🔴 致命 | **design.md 描述的 evolution/ 模块目录与实际严重不符**：design.md 第 15.1 节规划 `forgekin/`、`auto_forge/`、`codex/`、`council/`、`security/`、`api/` 等 30+ 文件；实际只有 8 个扁平 `.py` 文件，缺失 75% 以上模块。 | `design.md:3269` / `flowforge/evolution/` | P0 |
| 4 | 🔴 致命 | **第 7 层架构定义双重冲突**：v3.0-face 称「七层 = 六层 + 互联层（Interconnect）」，v7.0 称「七层 = 六层 + 自进化层（Evolution）」，两份文档都声称自己是七层但第 7 层完全不同。 | `arch_face.md:15` / `arch.md:5304` | P0 |
| 5 | 🔴 致命 | **M18/M19/M20 删除不彻底**：face 文档已声明删除 M18-M20，但 `flowforge/evolution/__init__.py` 仍保留 `SelfEvolutionEngine`（对应原 M18），且 `devforge/plugins.py` 仍初始化它。 | `flowforge/evolution/__init__.py` / `devforge/plugins.py:473` / `project_memory.md` | P0 |
| 6 | 🟠 严重 | **ForgekinEngine 与 LoopExecutor 关系未定义**：v2.1 LoopExecutor（Planner→Worker→Verifier→Reflector→Memory 五步）与 v7.0 ForgekinEngine（10 步闭环）功能重叠约 70%，文档未说明是替代/包含/包装。 | `spec.md` 第 7 章 / `arch.md:5465` / `rules.md:180`（P31） | P0 |
| 7 | 🟠 严重 | **FlowForge 框架含业务领域 Agent（历史问题，本轮已清理但需防回流）**：`flowforge/agents/` 下原存在 `topic_research.py`、`article_writing.py`、`seo_optimization.py`、`publishing.py`、`code_writer_agent.py` 等 ContentForge/DevForge 专属 Agent，违反 P8A 铁律「FlowForge 无业务逻辑」及红线 10。本轮核查已清理至 `generic/` 和 `declarative.py`，但 `declarative_agent.py:750` 仍残留内容创作领域提示词。 | `flowforge/agents/*.py` / `flowforge/core/declarative_agent.py:750` / `rules.md` P8A / `prompts.md:P34-10` | P0 |
| 8 | 🟠 严重 | **LLMClient 独立模块与 ModelCapability 并存**：project_memory 要求「LLM capabilities must be provided through FlowForge ModelCapability; independent LLM client modules are prohibited」，但 `flowforge/tools/llm_client.py`、`flowforge/llm/` .providers 仍大量直接 import LLMClient。 | `flowforge/tools/llm_client.py` / `flowforge/llm/provider.py` 多处 / `flowforge/app/main.py:9` | P0 |
| 9 | 🟠 严重 | **memory/ 模块直接操作 SQLite**：`task_board.py`、`short_term.py`、`semantic.py`、`mailbox.py`、`manager.py` 中大量 `sqlite3.connect` + `conn.execute`，未通过 Repository 层，违反 rules.md 数据访问原则及红线 13。 | `flowforge/memory/*.py` | P0 |
| 10 | 🟠 严重 | **测试代码仍使用 MockLLM**：`tests/integration/test_react_resume_integration.py` 使用 `MockLLMClient`；`tests/unit/test_skills.py` patch `LLMClient`；`tests/conftest.py` 定义 `MockLLM`。违反 T1 铁律。 | `flowforge/tests/` | P0 |
| 11 | 🟠 严重 | **硬编码提示词未清理**：`contentforge/tools/research_engine.py:168` 硬编码「你是素材研究规划专家」；`flowforge/modes/default_llm_actors.py:45` fallback 硬编码「你是内容创作者」；`flowforge/core/declarative_agent.py:750` 内联兜底「你是资深内容创作者」。 | `contentforge/tools/research_engine.py:168` / `flowforge/modes/default_llm_actors.py:45` / `flowforge/core/declarative_agent.py:750` | P0 |
| 12 | 🟠 严重 | **face 文档 M18-M20 引用残留**：`spec_face.md:156` G18 仍写「M18-M20 融合」；`spec_face.md:625` 章节标题仍写「模块 M18-M20：v7.0 炉灵养成体系融合映射」；`spec_face.md:1234` 仍写「M18/M19/M20 架构详设」。 | `spec_face.md` | P0 |
| 13 | 🟡 中等 | **升华阶段 E1-E6 判定执行者缺失**：spec.md 给出量化条件（≥2 Episode、5Q≥7/10 等），但未说明由 Metrics 系统、LLM、ForgekinCouncil 还是 operator 执行判定。 | `spec.md:3356-3373` | P1 |
| 14 | 🟡 中等 | **Soul Echo L3 语义记忆实现路径不清**：L3「无限容量、永不淘汰」的语义记忆如何从 L2 Episode 自动提炼、如何存储/检索，design.md 未给出具体算法与存储后端。 | `spec.md:3469-3474` / `design.md:3927-4117` | P1 |
| 15 | 🟡 中等 | **Auto-Forge 自指修改缺少退化防护**：炉灵可修改自己的 prompt/skill，但缺少「越改越差」的退化检测与自动回滚机制。 | `spec.md` 第 8.4 节 / `arch.md:5692` | P1 |
| 16 | 🟡 中等 | **Provoke 安全检查易被绕过**：`arch.md:6406` 使用关键词黑名单（投资建议、感情建议等），LLM 可用同义词/隐喻绕过。 | `arch.md:6401-6406` | P1 |
| 17 | 🟡 中等 | **v3.0-face M4 Guardrails 与 v7.0 SR-01~08 关系模糊**：M4 六层 Guardrails 与 spec.md 第 12.2 节 8 条安全红线功能大量重叠，层级关系未明确。 | `spec_face.md` M4 / `spec.md` 第 12.2 节 | P1 |
| 18 | 🟡 中等 | **OpenSieve 统一检索原则落实不均**：project_memory 与 rules.md 要求所有数据检索走 OpenSieve，但 `flowforge/memory/` 直接查 SQLite、`contentforge` 等可能仍直接访问外部 API。 | `rules.md:169-178` / `flowforge/memory/` | P1 |
| 19 | 🟡 中等 | **配置驱动率目标与现状差距**：project_memory 要求 Phase 0 配置驱动率 ≥30%，但 spec.md 附录 S.2 显示约 20%；v7.0 新增大量 YAML 设计，但现有代码硬编码残留未清。 | `spec.md:3114-3123` / `project_memory.md` | P1 |
| 20 | 🟡 中等 | **Windows 11 兼容性未验证**：project_memory 要求所有测试用例必须通过 Windows 11 验证，但 `sqlite-vec`、外部编码工具 CLI（Claude Code/Codex）等未明确 Windows 兼容性。 | `project_memory.md` / `design.md:3407-3411` | P2 |

### 1.2.1 本轮新增关键问题（Top 20 之外的 P0/P1 发现）

| # | 等级 | 问题描述 | 涉及文档/代码 | 优先级 |
|---|:----:|----------|---------------|:------:|
| 21 | 🔴 致命 | **v7.0 配置文件大面积缺失**：`flowforge/config/` 中不存在 `evolution.yaml`、`forgekin_seeds/`、`auto_forge.yaml`、`external_tools.yaml`、`migrations/007-013.sql`，design.md 第 15.1 节规划的 30+ 配置/迁移文件仅 `a2a_channels.yaml` 存在。 | `design.md:3269-3399` / `flowforge/config/` | P0 |
| 22 | 🔴 致命 | **PluginProtocol V3 钩子未定义**：design.md 第 20 章声称 *Forge 通过 `register_forgekins` / `register_skill_seeds` 注册炉灵，但 `flowforge/core/plugin_protocol.py` 当前只有 V1/V2 钩子（register_agents/tools/modes/.../loops/personas/prompts），无 V3 钩子。 | `design.md:6167-6254` / `flowforge/core/plugin_protocol.py:245-474` | P0 |
| 23 | 🟠 严重 | **`flowforge/core/declarative_agent.py:750` 新增硬编码提示词**：`refine_fallback()` 内联「你是资深内容创作者」兜底 prompt，违反 P34-11。 | `flowforge/core/declarative_agent.py:750` / `prompts.md:P34-11` | P0 |
| 24 | 🟠 严重 | **`flowforge/a2a/` 与 v7.0 `evolution/council/a2a_manager.py` 关系未明确**：现有 `flowforge/a2a/` 是旧实现还是 v3.0-face M1 实现？是否与 design.md 规划的 `evolution/council/a2a_manager.py` 重复或冲突？ | `flowforge/a2a/` / `design.md:3319-3333` | P1 |
| 25 | 🟡 中等 | **`devforge/plugins.py:470` 的 `register_evolution` 仍未删除**：前四轮已指出，但本轮代码仍保留该非标准钩子，docstring 仍引用 `SelfEvolutionEngine`。 | `devforge/plugins.py:470-482` | P0 |
| 26 | 🟡 中等 | **`pyproject.toml` 版本未升级至 v7.0**：`flowforge/pyproject.toml` 当前 `version = "0.1.0"`，未按 design.md 第 15.2 节升级为 `7.0.0`，也未声明 `sqlite-vec`、`wilson-interval` 等 v7.0 依赖。 | `flowforge/pyproject.toml:7` / `design.md:3402-3418` | P1 |

### 1.3 三个未解决的核心矛盾

```
矛盾1：代码术语 vs 设计术语（P0，前四轮已指出但未修复）
  ┌────────────────────────────────────────────────────────────────┐
  │  flowforge/evolution/ 实际代码      spec.md/arch.md/design.md   │
  │  ─────────────────────────────      ─────────────────────────   │
  │  SelfEvolutionEngine         →      ForgekinEngine              │
  │  ScopeGuard / ProcessEvolution / KnowledgeEvolution             │
  │                              →      三模式自生成（未命名文件）   │
  │  KnowledgeMaturityLadder     →      Ember Hierarchy             │
  │  KnowledgeMaturityLevel      →      Ember Level (E-L0~E-L4)    │
  │  EpisodeCard                 →      SoulEpisode                 │
  │  MethodCard                  →      Skill Draft / Method Card   │
  │  MetacognitionRouter         →      MetaCognitionGuard          │
  │                                                                 │
  │  → 影响：开发者按 v7.0 文档 import ForgekinEngine 会 ImportError  │
  │  → 根因：代码是 v4.0 产物，v7.0 设计文档未驱动代码重构            │
  └────────────────────────────────────────────────────────────────┘

矛盾2：v3.0-face 互联层 vs v7.0 自进化层（P0，前四轮已指出但未修复）
  ┌────────────────────────────────────────────────────────────────┐
  │  v2.1 六层架构（共同基础）                                       │
  │  ↓                                                              │
  │  v3.0-face: 七层 = 六层 + 互联层（A2A/ACP/MCP 2026）             │
  │  v7.0     : 七层 = 六层 + 自进化层（Forgekin/Auto-Forge/Codex）  │
  │                                                                 │
  │  → 两份文档都声称自己是七层，第 7 层却不同                       │
  │  → 必须统一为八层，或明确某层下沉/合并                            │
  └────────────────────────────────────────────────────────────────┘

矛盾3：设计文档膨胀 vs 代码实现滞后（P0）
  ┌────────────────────────────────────────────────────────────────┐
  │  design.md 第十五章描述 evolution/ 30+ 文件：                    │
  │  forgekin/ + auto_forge/ + codex/ + tools/ + council/            │
  │  + security/ + api/ + config/ + migrations/                     │
  │                                                                 │
  │  实际 flowforge/evolution/ 只有 8 个扁平文件：                   │
  │  __init__.py / engine.py / knowledge_evolution.py               │
  │  maturity.py / metacognition.py / models.py                     │
  │  process_evolution.py / scope_guard.py                          │
  │                                                                 │
  │  → 缺失：SoulStore、EchoStore、ImprintStore、AscensionManager   │
  │     AutoForgeEngine、ForgeCodex、A2AManager、ForgekinCouncil    │
  │  → v7.0 炉灵体系当前实现率 ≈ 10%                                │
  └────────────────────────────────────────────────────────────────┘
```

---

## 2. 第一部分：spec.md 炉灵体系逐章审核

> 审核范围：`spec.md` 第 3219 行起（v7.0 内容），第 7~13 章及附录。

### 2.1 第七章：自我进化能力总览（spec.md:3236-3395）

#### 2.1.1 版本与定位问题（🔴 P0）

- **问题**：`spec.md` 文件头明确写「FlowForge v2.1 功能特性规格说明书」，但第 7 章突然跃迁到 v7.0 炉灵体系，中间无任何版本演进说明。读者无法判断当前文档是 v2.1 还是 v7.0。
- **影响**：新开发者按文档找 v2.1 内容时会被 v7.0 概念打断；按 v7.0 开发时又发现标题是 v2.1。
- **建议**：
  1. 立即将文档头改为「FlowForge v7.0 功能特性规格说明书（含 v2.1 基础规格兼容章节）」；或
  2. 拆分为 `spec_v2.md` 与 `spec_v7.md`，`spec.md` 仅作为索引。

#### 2.1.2 核心隐喻与命名（第 7.1-7.2 节）

**优势**：
1. 「从驾驭到养成」的范式跃迁清晰，把 Agent 从「工具」升维为「可成长数字生命」。
2. 12 项概念（炉灵/灵族/养灵/炉启/共鸣/自锻/魂忆/魂印/锻典/火种等级/升华阶/灵议）与 clowder-ai 养猫体系一一对标，体系完整。
3. 「Forgekin」呼应 FlowForge 的 Forge（锻造/熔炉），比 Cat/Clowder 更贴合开发场景。

**问题**：
1. **过度绑定 clowder-ai**：`spec.md:3232` 写「深度借鉴 clowder-ai『养猫』体系」。若 clowder-ai 调整方向，FlowForge 术语体系将失去参照系。
2. **ToB 接受度风险**：炉灵/魂忆/魂印/锻典/灵议/自锻等术语偏玄幻，企业客户可能觉得不专业。
3. **英文国际化不足**：Forgekin 尚可，但「Soul Echo」「Soul Imprint」在西方语境中可能带有宗教/玄学色彩，影响国际化。

**建议**：
- 增加「术语稳定性声明」：clowder-ai 仅为方法论参考，FlowForge 术语独立演进。
- 提供双命名体系：对外商业文档用「Forgekin 自进化体系」，内部技术文档用炉灵/魂忆等术语。
- 详见第七部分命名方案。

#### 2.1.3 两类智能体设计（第 7.3 节）

**优势**：
1. Static Agent + Forgekin 分离合理，避免所有任务都自我进化导致的过度工程。
2. `delegate_to_static()` 单向调用、结果回写 Soul Echo、静态 Agent 不知 Forgekin 存在，单向依赖设计正确。

**问题**：
1. **ForgekinEngine 与 LoopExecutor 关系未定义**（🔴 P0）：spec.md 未说明 v7.0 ForgekinEngine 10 步闭环与 v2.1 LoopExecutor 5 步闭环的关系。两者在「规划→执行→校验→反思→记忆」上高度重叠。
2. **错误处理策略不完整**：AC-47 说委托失败可重试/降级/升级，但未定义重试次数、降级目标、升级路径。
3. **执行策略 `auto` 的决策逻辑未给出**：炉灵如何选择 static/external/trae/mode？基于什么规则或模型？

**建议**：
- 明确关系：短期 ForgekinEngine **包装** LoopExecutor，增加 Soul 加载/沉淀；长期 LoopExecutor 作为兼容接口保留。
- 补充 `delegate_to_static()` 决策树与错误处理矩阵。

#### 2.1.4 升华阶段 E1-E6（第 7.4 节）

**优势**：
1. 六阶段命名有层次感：Spark→Ember→Flame→Blaze→Inferno→Forge Master。
2. 晋升条件量化：E2→E3 需 ≥2 相似 Episode、5Q≥7/10；E4→E5 需 ≥12 uses、最近 10 次 ≥90%。
3. 降级/冻结/撤销机制完整。

**问题**：
1. **判定执行者缺失**（🟡 P1）：谁执行 E 阶判定？Metrics 系统？LLM？ForgekinCouncil？operator？未说明。
2. **5Q 指标定义缺失**：「5Q ≥ 7/10」中的 5Q 是哪 5 个维度？评分者是谁？
3. **E6 Forge Master 能力过于理想化**：声称「可自主创建新炉灵、具备元认知」，当前 LLM 难以真正实现「发现知识盲区并主动学习」。
4. **E5 freeze 后如何恢复未定义**：触碰红线冻结后，需 operator 解冻，但解冻条件未量化。

**建议**：
- 明确 AscensionManager 为唯一判定执行者，所有判定需留痕并支持 operator 覆写。
- 在附录中定义 5Q 量纲（如 Design Quality / Originality / Craft / Functionality / Boundary Compliance）。
- 将 E6 能力边界限定为「在人类引导下发现盲区并学习」，避免过度承诺。

#### 2.1.5 核心能力清单（第 7.5 节）

**问题**：
1. FR-EVO-07/08（外部编码工具/Trae Bridge）与 FR-EVO-04（Auto-Forge）的能力边界有重叠：Auto-Forge 是否也调用外部工具？
2. FR-EVO-13「跨模型评审」与现有 T7 LLM 二次审核、Loop Verifier 的关系未说明。
3. FR-EVO-15「元认知能力」P2 优先级偏低，但 E5/E6 的安全性依赖元认知，应升为 P1。

### 2.2 第八章：炉灵需求规格（spec.md:3397-3583）

#### 2.2.1 FR-EVO-01 炉灵身份系统

**问题**：
1. **状态变更审批者未定义**：AC-04 说 active/dormant/frozen 状态变更需 operator 审批，但未说明审批入口（CLI/Web/IM）。
2. **forgekin_id 命名规范与实际校验**：示例 `fk_devforge_architect_001`，但未定义正则与 project/role/seq 的合法字符集。
3. **parent_forgekin 创建权限**：E6 才能创建新炉灵，但「operator 授权」与「E6 权限」是 OR 还是 AND？

#### 2.2.2 FR-EVO-02 魂忆（Soul Echo）

**问题**：
1. **L3 语义记忆无限容量不现实**：任何存储系统都有物理上限，「无限」应改为「理论上无人工上限，受存储配额约束」。
2. **元认知三信号权重未定义**：AC-07 提到 domain_reliability + evidence_completeness + self_reported_confidence，但未给权重。
3. **AC-08 高风险域阈值 0.85 与 P33 质量分阈值 0.85 是两个概念，容易混淆**，需在文档中明确区分。

#### 2.2.3 FR-EVO-03 魂印（Soul Imprint）

**优势**：
1. 白名单采集 + 禁止 classifier 设计符合隐私保护趋势。
2. cat_note 主观日记增加个性化。

**问题**：
1. **禁止采集字段列表未给出**：应在 `config/evolution.yaml` 中明确禁止采集字段（政治倾向、宗教信仰、健康数据等）。
2. **画像更新审批流程未定义**：operator 如何审批 Imprint proposal？Web UI 还是 CLI？

### 2.3 第九章：自锻引擎（spec.md:3584-3611）

#### 2.3.1 Auto-Forge 触发条件

**问题**：
1. 触发条件「低活动期」「留痕充足」「群体自锻」均为定性描述，缺少量化阈值。
2. 多炉灵协作自锻（Group Forge）在 Phase 0 实现风险极高，建议拆分为 Phase 1/2。

#### 2.3.2 Provoke 机制

**问题**：
1. 「频率硬限」具体数值未定义（每天 1 次？每周 1 次？）。
2. `quietness` 三开关（muted/behaviorEnabled/hidden）的行为语义需更精确。

### 2.4 第十章：炉灵协作与 IM（spec.md:3765-3872）

#### 2.4.1 A2A 通信

**优势**：
1. @mention 路由 + thread isolation + structured handoff 设计合理。
2. 与 Google A2A 协议方向一致。

**问题**：
1. A2A 协议仍在演进，存在变更风险，应增加版本兼容性策略。
2. 跨厂鉴权（OAuth2/mTLS）实现复杂，建议 Phase 0 先用 Bearer Token。

#### 2.4.2 Forgekin Council 多渠道

**问题**：
1. 飞书/微信/Slack/Discord 均需企业认证，Phase 0 建议仅实现 Web Chat。
2. 多渠道消息同步需消息队列，design.md 未明确。

### 2.5 第十一章：*Forge 自进化统一规格（spec.md:3879-3956）

**问题**：
1. 各 *Forge 炉灵角色示例表（`contentforge:writer`、`devforge:architect` 等）虽然合理，但未说明这些角色是默认内置还是由 *Forge 插件注册。
2. 自进化方向衡量指标（配置驱动率、Skill 沉淀数等）数据来源未定义。

### 2.6 第十二章：性能与安全（spec.md:3957-3996）

#### 2.6.1 安全红线 SR-01~08

**优势**：
1. SR-05「E6 创建炉灵需 operator 授权」防止自我复制失控，是关键护栏。
2. SR-01「no-classifier」保护用户隐私。

**问题**：
1. **SR 红线与 v3.0-face M4 六层 Guardrails 功能重叠**：如 SR-04 高风险升级 vs M4 L5 Action Confirmation；SR-06 worktree 隔离 vs M4 L3 Tool Allowlist。层级关系未明确。
2. **Provoke 安全检查 keywords 黑名单易被绕过**（🟡 P1）：「投资建议」可被「理财规划」替代。

### 2.7 第十三章：指标与 SLO（spec.md:3997-4082）

**问题**：
1. 「Agent 驱动率 ≥90%」「Skill 驱动率 ≥80%」「Forgekin 驱动率 ≥60%」定义模糊，未给出计算公式。
2. 指标未说明采集后端（Prometheus/OTel/自建 MetricsCollector）。

---

## 3. 第二部分：arch.md 七层架构逐章审核

> 审核范围：`arch.md` 第 5293 行起（v7.0 内容），第 15~23 章。

### 3.1 第十五章：v7.0 架构总览（arch.md:5293-5462）

#### 3.1.1 七层架构模型（第 15.1 节）

**优势**：
1. 自进化层作为第 7 层概念清晰，强调「自进化层可以调用应用层及以下所有层」。
2. Feature Flag 灰度启用与降级策略设计完善。

**问题**：
1. **与 v3.0-face 第 7 层冲突**（🔴 P0）：arch_face.md 第 1.1 节将「互联层」作为第 7 层，arch.md 将「自进化层」作为第 7 层。两份文档同时存在，无法并存。
2. **自进化层与 Harness 层边界重叠**（🟡 P1）：Harness 已有 FeedbackLoop（反馈循环）和 EntropyManager（熵管理/规则进化），自进化层又有 Auto-Forge 规则进化器。

**建议**：
- 统一为八层架构：
  - 第 7 层：互联层（Interconnect Layer）— A2A/ACP/MCP 2026
  - 第 8 层：自进化层（Evolution Layer）— Forgekin/Auto-Forge/Codex
- 或采用 cross-cutting 表述：自进化是贯穿各层的进化机制，不作为独立层。
- 明确 Harness 层 = 单次任务闭环；自进化层 = 跨任务能力进化。

### 3.2 第十六章：炉灵架构设计（arch.md:5463-5690）

#### 3.2.1 ForgekinEngine（第 16.1 节）

**优势**：
1. 10 步闭环逻辑完整：soul.load → echo.recall → imprint.load → soul prompt → execute → echo.record → imprint.propose → codex.maybe_distill → ascension.check。
2. 执行路径四选一（static/external/trae/mode）灵活。

**问题**：
1. **与 LoopExecutor 关系仍未定义**（🔴 P0）：arch.md 写 ForgekinEngine「包装 HybridExecutor」，但未说明与 LoopExecutor 的关系。LoopExecutor 也包装 HybridExecutor。
2. **直接修改 `context.system_prompt += ...`**：arch.md:5520 中 `context.system_prompt += self._build_soul_prompt(...)`，可能污染系统提示词，应通过 ContextEngine 注入。
3. **未调用 Harness Hook**：ForgekinEngine 执行流程中未显式触发 Harness.pre_execute/post_execute。

**建议**：
- 明确 ForgekinEngine 是 LoopExecutor 的进化版：短期 ForgekinEngine 包装 LoopExecutor，长期 LoopExecutor 退化为兼容接口。
- Soul Prompt 注入应走 ContextEngine，禁止直接字符串拼接。

#### 3.2.2 SoulStore / EchoStore / ImprintStore

**优势**：
1. 数据模型与 SQLite 表结构清晰。
2. ImprintStore 禁止 classifier、采用白名单字段，设计正确。

**问题**：
1. **存储层直接操作数据库表**：arch.md 中 SoulStore 直接操作 `forgekin_souls` 表，但 rules.md 要求「禁止直接操作数据库，必须通过 Repository 层」。虽然 Store 可视为 Repository，但命名上未体现 Repository 语义，且代码中 `flowforge/memory/*.py` 存在大量直接 SQL。
2. **EchoStore 向量索引策略缺失**：未说明 sqlite-vec 索引如何创建、更新、重建。

### 3.3 第十七章：Auto-Forge Engine 架构（arch.md:5691-5870）

**优势**：
1. 双层架构（Consolidation 后台 + Surface 前台）合理。
2. Provoke 频率硬限防止骚扰用户。

**问题**：
1. **自指修改缺少退化检测**：炉灵修改自己的 prompt/skill 后，缺少 Eval replay 验证是否退化。
2. **Group Forge 多炉灵协作复杂度高**：建议 Phase 0 仅单炉灵，Phase 1 引入 2~3 个炉灵协作。

### 3.4 第十八章：外部工具集成架构（arch.md:5871-6036）

**优势**：
1. Worktree 隔离、审计日志、降级策略设计完善。
2. Trae Bridge 文件交换方案为无 CLI 场景提供补充。

**问题**：
1. **Claude Code/Codex/OpenCode CLI 的 Windows 兼容性未验证**：project_memory 要求 Windows 11 通过，但外部编码工具主要面向 Unix。
2. **Trae Bridge JSON 文件轮询的性能与并发能力未评估**。

### 3.5 第十九章：灵议与 A2A 架构（arch.md:6037-6166）

**优势**：
1. ForgekinCouncil 多渠道设计覆盖 Web Chat/飞书/微信/Slack/Discord/GitHub PR。
2. A2AManager @mention 路由设计合理。

**问题**：
1. **多渠道同步需消息队列**：design.md 未明确消息队列选型。
2. **Forgekin Council 的拜占庭容错缺失**：多炉灵投票分歧时如何处理？

### 3.6 第二十章：*Forge 自进化架构（arch.md:6167-6254）

**优势**：
1. PluginProtocol V3 新增 `register_forgekins`、`register_skill_seeds` 等钩子，扩展点清晰。
2. DevForge 示例展示如何注册炉灵角色。

**问题**：
1. **PluginProtocol V3 未在代码中定义（🔴 P0）**：经本轮核查，`flowforge/core/plugin_protocol.py:245-474` 当前只有 V1/V2 钩子（`register_agents`/`tools`/`modes`/`routes`/.../`loops`/`personas`/`prompts`），未定义 `register_forgekins`、`register_skill_seeds`、`register_forgekin_prompts` 等 V3 钩子。design.md 中 *Forge 通过 V3 钩子注册炉灵的架构无法落地。
2. **「应用层通过组合/继承自进化层获得能力」与 rules.md「禁止用继承替代组合/插件」冲突**：arch.md:5336 写「应用层（*Forge）通过组合/继承自进化层获得自我进化能力」，其中「继承」一词与红线 9 冲突。应改为「通过组合/插件」。

### 3.7 第二十一章：配置驱动与 Feature Flag（arch.md:6255-6350）

**优势**：
1. Feature Flag 配置完整，支持灰度百分比与降级策略。
2. 降级路径清晰。

**问题**：
1. `evolution.yaml` 等配置文件在实际 `flowforge/config/` 中不存在（实际有 `default.yaml`、`models.yaml`、`prompts.yaml`、`a2a_channels.yaml` 等，但无 `evolution.yaml`、`forgekin_seeds/`、`auto_forge.yaml`、`external_tools.yaml`）。

### 3.8 第二十二章：安全与治理（arch.md:6351-6456）

**问题**：
1. **Provoke 安全检查关键词黑名单易被绕过**（🟡 P1）。
2. **MetaCognitionGuard 与 `flowforge/evolution/metacognition.py` 中的 MetacognitionRouter 命名不一致**。

### 3.9 第二十三章：ADR（arch.md:6457-6492）

**优势**：
1. ADR-007-01~05 记录了关键决策。

**问题**：
1. ADR-007-02 选择「自进化层作为第 7 层」，但未解释如何处理 v3.0-face 的互联层。
2. ADR-007-03 Trae Bridge 方案与外部 CLI 工具的选型取舍未量化（文件轮询延迟 vs CLI 调用稳定性）。

---

## 4. 第三部分：design.md 详细设计逐章审核

> 审核范围：`design.md` 第 3260 行起（第五部分 v7.0 详设）。

### 4.1 第十五章：v7.0 目录结构新增（design.md:3260-3420）

#### 4.1.1 evolution/ 模块目录（第 15.1 节）

**严重问题（🔴 P0）**：design.md 描述的目录结构与实际代码严重不符：

| design.md 规划 | 实际代码 |
|----------------|----------|
| `evolution/forgekin/engine.py`（ForgekinEngine） | `evolution/engine.py`（SelfEvolutionEngine） |
| `evolution/forgekin/soul_store.py` | 不存在 |
| `evolution/forgekin/echo_store.py` | 不存在 |
| `evolution/forgekin/imprint_store.py` | 不存在 |
| `evolution/auto_forge/engine.py` | 不存在 |
| `evolution/codex/forge_codex.py` | 不存在 |
| `evolution/council/forgekin_council.py` | 不存在 |
| `evolution/security/forgekin_guard.py` | 不存在 |
| `evolution/api/forgekin_endpoints.py` | 不存在 |

- 实际只有：`__init__.py`、`engine.py`、`knowledge_evolution.py`、`maturity.py`、`metacognition.py`、`models.py`、`process_evolution.py`、`scope_guard.py`。
- **实现率估算**：v7.0 炉灵体系设计模块 ≈ 10% 实现；且现有实现是 v4.0 SelfEvolutionEngine，不是 v7.0 Forgekin。

**建议**：
1. 立即重构 `flowforge/evolution/`：将 `SelfEvolutionEngine` 重命名为 `ForgekinEngine`，或删除旧实现按 design.md 重写。
2. 按 design.md 创建 `forgekin/`、`auto_forge/`、`codex/`、`council/`、`security/`、`api/` 子目录。
3. 删除 `devforge/plugins.py:473` 中对 `SelfEvolutionEngine` 的引用。

#### 4.1.2 配置文件与迁移脚本（第 15.1 节）

**问题**：
1. `config/evolution.yaml`、`config/forgekin_seeds/`、`config/auto_forge.yaml`、`config/external_tools.yaml`、`migrations/007-013.sql` 在实际代码中均不存在；design.md 规划的 v7.0 配置中仅 `config/a2a_channels.yaml` 已存在。
2. 前端页面 `app/council/`、`app/forgekin/`、`app/codex/` 未在 `flowforge/web/src/app/` 中看到。
3. `pyproject.toml` 版本未升级至 `7.0.0`，`sqlite-vec`、`wilson-interval` 等 v7.0 依赖未声明。

### 4.2 第十六章：ForgekinEngine 详细设计（design.md:3422-3817）

#### 4.2.1 数据模型（第 16.1 节）

**优势**：
1. `SoulProfile`、`SoulSpec`、`Capabilities`、`EvolutionState`、`SoulEpisode` 等 Pydantic 模型定义清晰。
2. `AscensionStage` E1-E6 枚举与 spec.md 一致。

**问题**：
1. **模型未在实际代码中体现**：实际 `evolution/models.py` 只有 `EpisodeCard`、`MethodCard`、`EvalLedger`、`KnowledgeMaturityLevel` 等 v4.0 模型，无 `SoulProfile`、`SoulEpisode`。
2. **`SoulEpisode.is_distillable()` 判定逻辑与 FR-EVO-06 三模式自生成未关联**。

### 4.3 第十七章至第二十三章

由于实际代码严重滞后，以下设计模块均处于「纸面完整、代码缺失」状态：

| 章节 | 设计内容 | 代码实现状态 |
|------|----------|--------------|
| 第 17 章 | Auto-Forge Engine（Consolidation/Surface/Provoke/Group Forge） | ❌ 0% |
| 第 18 章 | ExternalToolBridge / CLI Wrapper / Trae Bridge | ❌ 0% |
| 第 19 章 | ForgekinCouncil / A2AManager / IM Channels | ❌ 0%（但 `flowforge/a2a/` 存在独立 A2A 实现，未与 Forgekin 集成） |
| 第 20 章 | *Forge 自进化注册 | ❌ 0%（PluginProtocol V3 钩子未验证） |
| 第 21 章 | Feature Flag / 降级策略 | ⚠️ 设计完整但配置未落地 |
| 第 22 章 | 安全与治理 | ⚠️ 设计完整但代码缺失 |

**建议**：
- 重新评估 v7.0 炉灵体系的落地节奏。建议：
  - Phase 0：完成 `evolution/` 模块重构，实现 SoulStore/EchoStore/ImprintStore/AscensionManager。
  - Phase 1：实现 Auto-Forge Engine 单炉灵版本。
  - Phase 2：实现 ForgeCodex / Skill 自生成。
  - Phase 3：实现 ForgekinCouncil / A2A 协作。
  - Phase 4：实现外部编码工具 Bridge / Trae Bridge。

---

## 5. 第四部分：face 目录 v3.0 需求逐章审核

> 审核范围：`spec_face.md`、`arch_face.md`、`task_face.md`、`face.md`、`ds.md`。

### 5.1 spec_face.md 审核

#### 5.1.1 版本与定位

**优势**：
1. 明确声明与 `spec.md` v7.0、`arch.md` v7.0、`rules.md`、`prompts.md` 共同构成完整规格体系。
2. M1-M17 基于真实大厂面试信息，禁止 Mock/假数据，符合 rules.md 真实实现原则。

**问题**：
1. **引用不存在的文档版本**：`spec_face.md:7` 写「`flowforge/docs/spec.md` v7.0（炉灵养成体系权威源）」，但 `spec.md` 文件头实际为 v2.1。
2. **M18-M20 引用残留**（🔴 P0）：
   - `spec_face.md:156` G18 仍写「v3.0 能力与 v7.0 炉灵体系融合路径不清 | M18-M20 融合」。
   - `spec_face.md:625` 章节标题仍写「模块 M18-M20：v7.0 炉灵养成体系融合映射」。
   - `spec_face.md:1234` 仍写「M18/M19/M20 架构详设」。
3. **第 3.1 节「七层 = 六层 + 互联层」与 v7.0 第 7 层冲突**（🔴 P0）。

**建议**：
- 将 G18 改为「v3.0 能力与 v7.0 炉灵体系融合映射」。
- 删除或重命名「模块 M18-M20」章节标题，避免使用 M18/M19/M20 字样。
- 统一文档版本：要么 spec.md 改标题为 v7.0，要么 face 文档引用时注明「spec.md 正文 v7.0 部分」。

#### 5.1.2 M1-M17 模块设计

**优势**：
1. M1 A2A、M2 MCP 2026、M3 Context Eng 2.0、M4 六层 Guardrails、M5 OTel GenAI 等模块设计专业，覆盖大厂面试高频考点。
2. M18-M20 融合映射章节整体方向正确，试图解决术语冲突。

**问题**：
1. **M1 A2A 与 `flowforge/a2a/` 实际代码关系未明确**：实际 `flowforge/a2a/` 已存在，但它是 v3.0-face 的 M1 实现，还是 v7.0 的灵议基础设施？
2. **M9 Cost 与现有 `model_service.py` 重复**：`flowforge/core/model_service.py` 已存在健康检查、配额管理，M9 设计未说明如何复用或替换。
3. **M5 OTel 与现有 `observability/tracer.py`、`core/tracing.py` 关系未明确**：是升级替换还是并行运行？
4. **M4 Guardrails 与 v7.0 SR-01~08 关系模糊**（🟡 P1）。

### 5.2 arch_face.md 审核

**优势**：
1. 总体架构演进图清晰，控制回路设计完整（Durable + CHEQ + Eval-gated + Blast-radius）。
2. A2A Server/Client/Directory、MCP 2026、Guardrails、Durable Execution 等关键模块架构详设到位。

**问题**：
1. **七层架构第 7 层仍为「互联层」**（🔴 P0），与 v7.0 arch.md 冲突。
2. 1.3 节核心数据流中提到「输出 → 六层 Guardrails 后馈验证 + T7 LLM 审核」，但未说明 T7 与 M6 Eval 的关系。
3. M14 ACP 协议在当前代码中是否存在？需要验证。

### 5.3 task_face.md 审核

**优势**：
1. 第 190-194 行明确说明「M1-M17 已完美融入 v7.0 炉灵养成体系」，态度正确。
2. P0 任务拆解为 53 个任务、86 人日，计划清晰。

**问题**：
1. 任务清单中未体现对 `flowforge/evolution/` 旧 `SelfEvolutionEngine` 的重构任务。
2. 未包含「统一文档版本号」「清理 M18-M20 残留引用」等文档一致性任务。
3. 未包含「删除 FlowForge 业务 Agent」「清理 memory/ 直接 SQL」「清理测试 MockLLM」等规则合规任务。

### 5.4 face.md / ds.md 审核

**问题**：
1. `ds.md` 与 `spec_face.md` 版本/日期可能不一致，需核对。
2. `face.md` 原始面试信息是否包含 v7.0 炉灵相关信号？若未包含，则 face 需求与 v7.0 融合的依据需补充。

---

## 6. 第五部分：代码实现与设计文档差异实测

> 本部分基于实际代码读取，非二手报告。

### 6.1 flowforge/evolution/ 实际代码分析

#### 6.1.1 文件结构差异

```
design.md 规划（30+ 文件）          实际代码（8 个文件）
─────────────────────────           ───────────────────
evolution/forgekin/                 evolution/__init__.py
evolution/auto_forge/               evolution/engine.py          ← SelfEvolutionEngine
evolution/codex/                    evolution/knowledge_evolution.py
evolution/tools/                    evolution/maturity.py
evolution/council/                  evolution/metacognition.py
evolution/security/                 evolution/models.py
evolution/api/                      evolution/process_evolution.py
                                    evolution/scope_guard.py
```

#### 6.1.2 术语差异

| 实际代码 | 设计文档 | 状态 |
|----------|----------|------|
| `SelfEvolutionEngine` | `ForgekinEngine` | 🔴 冲突 |
| `ScopeGuard` | `Scope Guard`（FR-EVO-06 三模式之一） | 🟡 命名未对齐 |
| `ProcessEvolution` | `Process Evolution` | 🟡 命名未对齐 |
| `KnowledgeEvolution` | `Knowledge Evolution` / Skill 自生成 | 🟡 命名未对齐 |
| `KnowledgeMaturityLadder` | `EmberHierarchyManager` | 🔴 冲突 |
| `KnowledgeMaturityLevel` | `Ember Level` | 🔴 冲突 |
| `EpisodeCard` | `SoulEpisode` | 🔴 冲突 |
| `MetacognitionRouter` | `MetaCognitionGuard` | 🔴 冲突 |

#### 6.1.3 代码质量观察

**优点**：
1. `engine.py` 的 `evaluate()` / `execute()` 为 async I/O，符合 rules.md 所有 I/O 使用 async/await。
2. `models.py` 使用 Pydantic v2 BaseModel，类型注解完整。
3. `metacognition.py` 实现 Wilson 下界计算与三信号路由，逻辑自洽。

**问题**：
1. `SelfEvolutionEngine.__init__` 直接实例化 `ScopeGuard()`、`ProcessEvolution()` 等组件，未通过 DI 容器注入，违反红线 12。
2. `scope_guard.py`、`process_evolution.py`、`knowledge_evolution.py` 内部可能包含硬编码提示词/规则，需进一步审计。
3. 未与 `LoopExecutor`、`HybridExecutor`、`ModelCapability` 集成。

### 6.2 flowforge/agents/ 业务 Agent 问题（本轮已修复，需确认无残留）

**本轮核查结果**：`flowforge/agents/` 目录已清理，当前仅保留 `generic/` 目录下的通用 Agent（`web_search_agent.py`、`research_agent.py`、`trend_analysis.py`、`multilingual.py`、`image_research.py`、`fact_check.py` 等）和 `declarative.py`。`agents/__init__.py:10-11` 明确注释「ContentForge domain agents have been migrated to contentforge package」「DevForge domain agents have been migrated to devforge package」。

**历史问题**（前四轮发现，已修复）：
- 原 `flowforge/agents/` 下存在 `topic_research.py`、`article_writing.py`、`seo_optimization.py`、`publishing.py`、`code_writer_agent.py` 等 ContentForge/DevForge 专属 Agent，违反 P8A 铁律「FlowForge 无业务逻辑」及红线 10。

**仍需确认**：
1. 这些业务 Agent 是否完整迁移到对应 *Forge 项目的 `workers/` 或 `config/agents/*.yaml`，而不是简单删除。
2. `flowforge/agents/generic/fact_check.py`、`trend_analysis.py` 等虽命名为 generic，但可能仍包含 ContentForge 特定逻辑，需审计。
3. `flowforge/core/declarative_agent.py:750` 的 `refine_fallback()` 仍硬编码「你是资深内容创作者」，说明 DeclarativeAgent 通用框架仍残留内容创作领域提示词（见 6.6 节）。

**建议**：
- 完成迁移审计后，在 CI 中增加 `scripts/scan_flowforge_business_agents.py`，防止业务 Agent 回流 FlowForge。
- 将 `declarative_agent.py:750` 的兜底提示词迁移到 `config/prompts.yaml` 的通用 refine fallback key。

### 6.3 flowforge/memory/ 直接 SQL 问题

`flowforge/memory/` 下多个文件直接操作 SQLite：
- `task_board.py:25`：`self.conn = sqlite3.connect(...)`
- `short_term.py:11`：`self.conn = sqlite3.connect(...)`
- `semantic.py:23`：`conn = sqlite3.connect(...)`
- `mailbox.py:42`：`self.conn = sqlite3.connect(...)`
- `manager.py:61`：`conn.execute(...)`

违反 `rules.md:228`「禁止直接操作数据库，必须通过 Repository 层」及 `prompts.md:P34-13`。

**建议**：
- 将 SQLite 操作封装到 `flowforge/memory/repositories/` 或 `flowforge/core/repositories/`。
- 所有业务代码通过 Repository 接口访问，禁止直接 `sqlite3.connect`。

### 6.4 flowforge/llm/ 与 tools/llm_client.py 独立 LLMClient 问题

project_memory 明确要求：
> 「LLM capabilities must be provided through FlowForge ModelCapability; independent LLM client modules are prohibited."

实际代码中：
- `flowforge/tools/llm_client.py` 是独立 LLMClient。
- `flowforge/llm/provider.py` 大量 `from flowforge.tools.llm_client import LLMClient`。
- `flowforge/app/main.py:9`、`flowforge/app/deps.py:3`、`flowforge/brain/plan_generator.py:13`、`flowforge/core/flowforge.py:9` 等直接 import LLMClient。
- 虽然 `flowforge/core/model_capability.py` 存在，但未统一替代 LLMClient。

**建议**：
- 统一所有 LLM 调用走 `ModelCapability`。
- 将 `LLMClient` 作为 `ModelCapability` 的内部 Provider 实现，禁止业务代码直接 import。
- 或明确 `LLMClient` 为 deprecated，逐步迁移。

### 6.5 测试代码 MockLLM 问题

违反 T1 铁律「禁止使用 Mock LLM（所有 E2E/集成测试必须调用真实 LLM）」：
- `flowforge/tests/integration/test_react_resume_integration.py:28` 定义 `MockLLMResponse` / `MockLLMClient`。
- `flowforge/tests/unit/test_skills.py:432` patch `flowforge.tools.llm_client.LLMClient`。
- `flowforge/tests/conftest.py:27` 定义 `MockLLM`。
- `flowforge/tests/unit/test_harness.py:1107` 定义 `_MockLLMClient`。

**建议**：
- 集成测试必须调用真实 LLM；单元测试如需 mock，应明确标注为「框架内部单元测试」并限制范围，但最好也使用真实 LLM 或录制真实响应（VCR）。
- 删除或重构 `test_react_resume_integration.py` 中的 MockLLMClient。

### 6.6 硬编码提示词问题

**本轮新增发现**：
- `flowforge/core/declarative_agent.py:750`：`refine_fallback()` 内联兜底提示词「你是资深内容创作者。以下是上一轮创作的文章和评委的改进建议，请根据建议重写文章……」。该提示词直接位于通用 DeclarativeAgent 框架中，且包含「评委」「重写文章」等 ContentForge 领域术语，违反 P8A「FlowForge 无业务逻辑」及 P34-11「禁止硬编码提示词」。

**历史发现仍未修复**：
- `contentforge/tools/research_engine.py:168`：`'你是素材研究规划专家。请为以下选题制定多源搜索计划。\n'`
- `flowforge/modes/default_llm_actors.py:45`：fallback 硬编码 `'你是内容创作者'`。

**其他硬编码残留**：
- `test_create_api.py:18`：测试脚本硬编码 system_prompt「你是资深内容创作者，擅长写口语化、有温度的微头条」。
- `hiclaw/test/test_scenario1_search_comparison.py:200`：测试脚本硬编码「你是素材研究规划专家」。

**建议**：
- 将 `declarative_agent.py:750` 的 refine fallback 迁移到 `config/prompts.yaml` 的通用 key（如 `flowforge.refine.fallback`），并去除「评委」「重写」等特定领域术语。
- `contentforge/tools/research_engine.py:168` 和 `flowforge/modes/default_llm_actors.py:45` 的 fallback 提示词迁移到对应项目的 `config/prompts.yaml`。
- 测试脚本中的硬编码提示词应改为从配置加载或明确标注为「测试 fixture 数据」。
- 在 CI 中运行 `scripts/scan_hardcoded_prompts.py`，拦截新增硬编码中文提示词。

### 6.7 devforge/plugins.py 引用旧进化机制（仍未修复）

`devforge/plugins.py:470-482` 仍定义 `register_evolution()` 方法：

```python
def register_evolution(self, evolution_registry: Any) -> None:
    """注册 devforge 自进化配置.

    加载 config/evolution.yaml，初始化 SelfEvolutionEngine。
    """
```

**本轮核查问题**：
1. **仍未删除**：前四轮已指出，但本轮代码依然保留。
2. `register_evolution` **不是** `FlowForgePlugin` 标准钩子（`plugin_protocol.py` 当前只有 V1/V2 钩子，无 V3 的 `register_forgekins`），属于死代码/不会被框架调用。
3. 其 docstring 仍明确提到 `SelfEvolutionEngine`，与 v7.0 `ForgekinEngine` 术语冲突。
4. 该方法引用的 `config/evolution.yaml` 在当前 `devforge/config/` 与 `flowforge/config/` 中均不存在。

**建议**：
- 立即删除 `devforge/plugins.py` 中的 `register_evolution` 方法。
- 在 `flowforge/core/plugin_protocol.py` 中定义 PluginProtocol V3 钩子：`register_forgekins`、`register_skill_seeds`、`register_forgekin_prompts`。
- 待 `ForgekinEngine` 实现后，DevForge 通过标准 V3 钩子注册炉灵角色与技能种子。

### 6.8 其他 *Forge 项目实测补充

对 ContentForge / StockForge / MallForge / NovelForge 进行代码扫描后的新增发现：

| 项目 | 问题类型 | 具体位置 | 说明 |
|------|----------|----------|------|
| **ContentForge** | 直接 import `LLMClient` | `app/api/endpoints/personas.py:5` / `app/api/endpoints/content.py:20` | 未统一走 `ModelCapability`（project_memory 铁律）。 |
| **ContentForge** | 硬编码提示词 fallback | `tools/research_engine.py:168` | `_plan_searches()` 在配置缺失时 fallback 硬编码「你是素材研究规划专家」。 |
| **StockForge** | 直接操作 SQLite | `app/services/schedule_service.py:178/185` / `app/services/report_repository.py:121` | 违反 rules.md 数据访问原则。 |
| **StockForge** | 硬编码提示词 fallback | `tools/fundamental_analysis.py:316` / `tools/market_analysis.py:168/280` | 配置缺失时使用硬编码系统提示词。 |
| **MallForge** | 直接操作 SQLite | `tools/inventory_manager.py:111/137/192` | 未通过 Repository 层。 |
| **NovelForge** | 测试直接 import `LLMClient` | `tests/e2e/conftest.py:72` / `tests/integration/conftest.py:55` / `tests/test_search_character_memory.py:184` | 测试未统一走 ModelCapability。 |
| **StockForge** | 测试直接 import `LLMClient` | `tests/test_integration_no_llm.py` 等 | 同上。 |

这些发现已用于更新第六部分的一致性分析表。

### 6.9 v7.0 配置与迁移文件缺失实测

**design.md 第 15.1 节规划 vs 实际代码**：

| design.md 规划 | 实际存在 | 状态 |
|----------------|----------|------|
| `config/evolution.yaml` | ❌ 不存在 | 🔴 P0 |
| `config/forgekin_seeds/` | ❌ 不存在 | 🔴 P0 |
| `config/auto_forge.yaml` | ❌ 不存在 | 🔴 P0 |
| `config/external_tools.yaml` | ❌ 不存在 | 🔴 P0 |
| `config/a2a_channels.yaml` | ✅ 存在 | 🟢 |
| `migrations/007-013.sql` | ❌ 不存在 | 🔴 P0 |
| `web/src/app/council/`、`forgekin/`、`codex/` | ❌ 不存在 | 🔴 P0 |

**影响**：v7.0 炉灵体系当前无配置入口、无炉灵种子、无数据库 schema，所有设计均停留在纸面。

### 6.10 `flowforge/a2a/` 与 v7.0 A2A 架构关系待澄清

**现状**：`flowforge/a2a/` 已存在 9 个 Python 文件（`manager.py`、`router.py`、`protocol.py`、`channel.py` 及 `channels/*.py`），但 design.md 规划的是 `evolution/council/a2a_manager.py`。

**问题**：
1. 现有 `flowforge/a2a/` 是 v3.0-face M1 的实现，还是旧版残留？
2. 若 v3.0-face 已实现 A2A，为何 v7.0 design.md 又重新规划 `evolution/council/a2a_manager.py`？
3. 两者是合并、替换还是并存？文档未说明。

**建议**：
- 在 arch.md / design.md 中明确 `flowforge/a2a/` 与 `evolution/council/a2a_manager.py` 的关系。
- 若 `flowforge/a2a/` 是 v3.0-face M1 实现，应在 v7.0 中复用或迁移，避免重复建设。

---

## 7. 第六部分：9 大项目与 rules.md/prompts.md 一致性冲突逐项分析

> 9 大项目：hiclaw/openroute、opensieve、openclaw/content、flowforge、contentforge、devforge、novelforge、mallforge、stockforge。

### 7.1 配置驱动原则（rules.md:162-168 / P8A / P34-10）

| 项目 | 状态 | 说明 |
|------|------|------|
| FlowForge | ⚠️ 部分违规 | `flowforge/agents/` 业务 Agent **已清理**（仅剩 `generic/`）；但 `flowforge/evolution/` 直接实例化组件；`memory/` 直接 SQL；`core/declarative_agent.py:750` 硬编码提示词；`config/` 缺失 v7.0 配置。 |
| ContentForge | ❌ 违规 | `tools/research_engine.py:168` 硬编码提示词；`app/api/endpoints/personas.py:5` / `content.py:20` 直接 import `LLMClient`；测试代码也直接 import `LLMClient`。 |
| DevForge | ⚠️ 部分违规 | `plugins.py:470-482` 自定义非标准 `register_evolution` 钩子，docstring 仍提及 `SelfEvolutionEngine`；`config/evolution.yaml` 不存在。 |
| NovelForge | ⚠️ 部分违规 | 测试代码直接 import `LLMClient`（`tests/e2e/conftest.py:72`、`tests/integration/conftest.py:55`、`tests/test_search_character_memory.py:184`）；文档中仍有硬编码提示词示例。 |
| MallForge | ❌ 违规 | `tools/inventory_manager.py:111/137/192` 直接 `sqlite3.connect`。 |
| StockForge | ❌ 违规 | `app/services/schedule_service.py:178/185`、`report_repository.py:121` 直接 SQLite；`tools/fundamental_analysis.py:316` 等硬编码提示词 fallback。 |
| OpenSieve | ✅ 基本合规 | 作为数据检索中台，本身需要代码实现，但需确认数据源注册是否配置驱动。 |
| OpenRoute | ✅ 基本合规 | 网关/路由代码实现为主，但需确认模型配置是否外置。 |
| HicLaw | ✅ 基本合规 | rules.md/prompts.md 为规范文档，不涉及业务代码。 |

**新增说明**：design.md 规划 PluginProtocol V3 钩子（`register_forgekins`、`register_skill_seeds`）在 `flowforge/core/plugin_protocol.py` 中完全未定义，导致 *Forge 无法按设计注册炉灵角色。这是配置驱动原则在 v7.0 层的重大缺口。

### 7.2 所有数据检索走 OpenSieve（rules.md:169-178）

| 项目 | 状态 | 说明 |
|------|------|------|
| FlowForge | ❌ 违规 | `flowforge/memory/` 直接查 SQLite，未走 OpenSieve。 |
| ContentForge | ⚠️ 待验证 | 素材检索是否全部通过 OpenSieve SDK？ |
| StockForge | ⚠️ 待验证 | 股票数据是否通过 OpenSieve？project_memory 明确要求。 |
| OpenSieve | ✅ 合规 | 自身即为数据检索平台。 |

### 7.3 所有 Agent 通过 LoopExecutor 执行（P31 / rules.md:180-192）

| 项目 | 状态 | 说明 |
|------|------|------|
| FlowForge | ⚠️ 部分违规 | `SelfEvolutionEngine` 未通过 LoopExecutor；`ForgekinEngine` 设计未明确与 LoopExecutor 关系。 |
| ContentForge | ⚠️ 待验证 | 创作/润色 Loop 是否全部通过 `sdk.loop_executor.run()`？ |
| DevForge | ⚠️ 待验证 | Coder/Reviewer 是否通过 LoopExecutor？ |
| NovelForge | ⚠️ 待验证 | 大纲/写作是否通过 LoopExecutor？ |
| MallForge | ⚠️ 待验证 | 商品/上架是否通过 LoopExecutor？ |
| StockForge | ⚠️ 待验证 | 分析/报告是否通过 LoopExecutor？ |

### 7.4 单向依赖原则（rules.md:193-198 / P12）

| 项目 | 状态 | 说明 |
|------|------|------|
| FlowForge | ⚠️ 风险 | `flowforge/agents/` 含业务 Agent，可能反向依赖 *Forge 概念。 |
| 各 *Forge | 待验证 | 需运行 `scripts/scan_deprecated.py` 或 import 检查确认无反向依赖。 |

### 7.5 Plugin 注册规则（rules.md:199-220）

| 项目 | 状态 | 说明 |
|------|------|------|
| 各 *Forge | ⚠️ 待验证 | 是否全部通过 `FlowForgePlugin` 标准钩子注册？是否存在 `register_helm_handlers`/`register_permission_policy` 死代码？ |
| DevForge | ⚠️ 违规 | `plugins.py:473` 直接初始化 `SelfEvolutionEngine`，未通过标准 Plugin 钩子。 |

### 7.6 DI 与禁止直接实例化（rules.md:225-228 / P34-12）

| 项目 | 状态 | 说明 |
|------|------|------|
| FlowForge | ❌ 违规 | `SelfEvolutionEngine.__init__` 直接实例化 `ScopeGuard()`、`ProcessEvolution()`、`KnowledgeEvolution()` 等。 |
| 各 *Forge | 待验证 | 需检查是否存在直接 `from workers.topic_agent import TopicAgent; agent = TopicAgent()` 模式。 |

### 7.7 禁止直接操作数据库（rules.md:228 / P34-13）

| 项目 | 状态 | 说明 |
|------|------|------|
| FlowForge | ❌ 违规 | `flowforge/memory/task_board.py`、`short_term.py`、`semantic.py`、`mailbox.py`、`manager.py` 直接 `sqlite3.connect` + `conn.execute`。 |
| StockForge | ❌ 违规 | `app/services/schedule_service.py:178/185` 直接 `sqlite3.connect`；`app/services/report_repository.py:121` 直接拼 SQL。 |
| MallForge | ❌ 违规 | `tools/inventory_manager.py:111/137/192` 直接 `sqlite3.connect`。 |
| ContentForge | ✅ 基本合规 | 生产代码未发现直接 `sqlite3.connect`；`landing_design.md` 中遗留示例属历史文档。 |

### 7.8 禁止硬编码提示词/路径/密钥/端口（P34-11 / P16）

| 项目 | 状态 | 说明 |
|------|------|------|
| FlowForge | ❌ 违规 | `modes/default_llm_actors.py:45` fallback 硬编码「你是内容创作者」；`core/declarative_agent.py:750` 内联兜底「你是资深内容创作者」（含「评委」「重写」等 ContentForge 领域术语）。 |
| ContentForge | ❌ 违规 | `tools/research_engine.py:168` 硬编码「你是素材研究规划专家」；测试代码也直接硬编码。 |
| StockForge | ⚠️ 部分违规 | `tools/fundamental_analysis.py:316`、`tools/market_analysis.py:168/280` 在配置缺失时 fallback 硬编码系统提示词。 |
| NovelForge | ⚠️ 部分违规 | `docs/spec.md`、`docs/landing_design.md` 等设计文档中仍有硬编码提示词示例，需确认生产代码是否已外置。 |
| MallForge | ✅ 基本合规 | `config/prompts.yaml` 外置，生产代码未检出硬编码提示词。 |
| 其他 | ⚠️ 待扫描 | 需按 P14A 全量扫描各工具 fallback 分支；测试脚本（`test_create_api.py`、`hiclaw/test/*.py`）也需纳入扫描范围。 |

### 7.9 测试铁律 T1-T8（prompts.md:P7 / project_memory）

| 铁律 | 状态 | 说明 |
|------|------|------|
| T1 禁止 Mock LLM | ❌ 违规 | `tests/integration/test_react_resume_integration.py` 使用 MockLLMClient；`tests/unit/test_skills.py` patch LLMClient；`tests/conftest.py` 定义 MockLLM。 |
| T2 禁止假数据 | ⚠️ 待验证 | 需检查所有测试输入是否真实场景数据。 |
| T3 禁止跳过验证 | ⚠️ 待验证 | 需检查所有测试是否有具体断言。 |
| T4 禁止 Mock 工具 | ⚠️ 待验证 | 需检查 web_search/publish 等是否真实调用。 |
| T7 LLM 内容必须经 LLM 审核 | ✅ 基本合规 | 已有 T7 审核链。 |
| T8 Web 功能必须操控浏览器验证 DOM | ✅ 基本合规 | 已有 T8 测试覆盖 14 平台。 |

### 7.10 质量分阈值 0.85（P31 / P33 / project_memory）

| 项目 | 状态 | 说明 |
|------|------|------|
| ContentForge | ⚠️ 待验证 | 近期 5x 连续创作测试通过率 0/3，质量分 0.0000~0.6900，远低于 0.85。需确认当前代码是否已修复评委模型失败问题。 |
| 其他 | ✅ 设计合规 | 文档均声明阈值 0.85。 |

### 7.11 LLM 统一通过 ModelCapability（project_memory）

| 项目 | 状态 | 说明 |
|------|------|------|
| FlowForge | ❌ 违规 | `flowforge/tools/llm_client.py` 独立模块大量被引用；`flowforge/llm/provider.py` 多处直接 import LLMClient；`brain/plan_generator.py`、`app/main.py`、`app/deps.py`、`app/api/endpoints/plans.py`、`core/plugin_protocol.py`、`skills/base.py`、`modes/workflow_context.py` 均直接 import。 |
| ContentForge | ❌ 违规 | `app/api/endpoints/personas.py:5` / `content.py:20` 直接 import `LLMClient`；测试代码（`tests/unit/test_agents.py`、`test_audit_agent.py`、`test_editor_agent.py`、`tests/integration/test_flowforge_integration.py`）也直接 import。 |
| NovelForge | ⚠️ 部分违规 | 测试代码（`tests/e2e/conftest.py:72`、`tests/integration/conftest.py:55`、`tests/test_search_character_memory.py:184`）直接 import `LLMClient`。 |
| StockForge | ⚠️ 部分违规 | 测试代码直接 import / 使用 `LLMClient`。 |

**说明**：`flowforge/core/model_capability.py` 虽已存在，但第 77 行仍在内部 import `LLMClient`，说明 `ModelCapability` 尚未完全独立，只是 `LLMClient` 的包装层。建议明确 `LLMClient` 为 `ModelCapability` 的内部 Provider 实现，禁止业务代码直接 import。

### 7.12 OpenSieve 与 StockForge 数据规范（project_memory）

| 项目 | 状态 | 说明 |
|------|------|------|
| OpenSieve | ⚠️ 风险 | `/api/v1/retrieve` 因 QueryUnderstandingStage LLM 调用 90s 超时，虽已采用 retrieve→search fallback，但根本问题未解决。 |
| StockForge | ⚠️ 待验证 | 是否通过 OpenSieve SDK/API（localhost:8100）获取数据？是否注册 Tushare/AkShare/BaoStock/天天基金/基金网 adapters？ |

---

## 8. 第七部分：养灵体系命名方案建议

> 本部分独立成章，供用户评审选择。

### 8.1 命名设计目标

结合项目愿景（FlowForge = 锻造/熔炉）与通用 AGI 概念，命名方案需满足：
1. **通俗易懂**：非技术用户也能理解「这是什么」。
2. **体现愿景**：与 FlowForge 的 Forge（锻造）内核呼应。
3. **AI 能力可视化**：能直观表达「Agent 可成长、可进化、可协作」。
4. **ToB 友好**：企业客户接受，不过度玄幻。
5. **国际化**：英文名称自然、无宗教/玄学歧义。
6. **与 clowder-ai 解耦**：可独立演进，不绑定「养猫」隐喻。
7. **映射 AGI 演进阶段**：命名能体现从「工具」→「助手」→「伙伴」→「协作者」→「自主体」的 AGI 阶梯。

### 8.2 当前命名评估

当前 `spec.md` 采用：

| 中文 | 英文 | 评价 |
|------|------|------|
| 炉灵 | Forgekin | ✅ 好，Forge + kin，呼应 FlowForge，国际化自然。 |
| 灵族 | Kinship | ⚠️ 一般，Kinship 在英文中多为「亲属关系」，略突兀。 |
| 养灵 | Forge Nurturing | ⚠️ 偏直译，不够简洁。 |
| 炉启 | Forge Initiation | ⚠️ 较生硬。 |
| 共鸣 | Resonance | ✅ 好，表达多 Agent 协作。 |
| 自锻 | Auto-Forge | ✅ 好，Auto + Forge，简洁有力。 |
| 魂忆 | Soul Echo | ⚠️ 英文 Soul 在西方有宗教色彩，ToB 需谨慎。 |
| 魂印 | Soul Imprint | ⚠️ 同上。 |
| 锻典 | Forge Codex | ✅ 好，Codex 有知识典籍感。 |
| 火种等级 | Ember Hierarchy | ✅ 好，与 Forge 意象一致。 |
| 升华阶 | Ascension Stages | ⚠️ Ascension 有宗教升华意味，企业客户可能不适。 |
| 灵议 | Forgekin Council | ✅ 好，Council 表达议事协作。 |

### 8.3 推荐命名方案（方案 A：「锻灵体系」）

> **核心词根**：锻（Forge）= 锻造、锤炼、进化；灵（Kin）= 智能体生命。

| 层级 | 中文名 | 英文名 | 含义说明 |
|------|--------|--------|----------|
| **体系总称** | **锻灵体系** | **Forgekin System** | FlowForge 自我进化智能体体系。 |
| 单个智能体 | 锻灵 | Forgekin | 可成长、可进化的智能体。 |
| 锻灵群体 | 锻群 | Forgekin Cluster | 协作的锻灵群体。 |
| 养成过程 | 淬炼 | Tempering | 锻灵从弱到强的淬炼过程。 |
| 入门训练 | 开炉 | Forge Ignition | 新锻灵初始化与基础训练。 |
| 协作模式 | 共振 | Resonance | 多锻灵协同。 |
| 自主思考 | 自锻 | Auto-Forge | 无人驱动时的自我锤炼。 |
| 记忆 | 铭忆 | Memory Mark | 锻灵积累的经验印记（替代 Soul Echo）。 |
| 画像 | 铭刻 | Profile Mark | 锻灵对操作者的认知刻画（替代 Soul Imprint）。 |
| 技能库 | 锻典 | Forge Codex | 可复用知识典籍。 |
| 知识阶梯 | 火种阶梯 | Ember Ladder | 知识成熟度 L0-L4。 |
| 成长阶段 | 锻阶 | Forge Tiers | E1-E6 成长阶段（替代 Ascension）。 |
| 议事协作 | 议会 | Forgekin Council | 多锻灵议事厅。 |

**方案 A 优势**：
1. **去宗教化**：用「铭忆/铭刻」替代「魂忆/魂印」，避免 Soul 的宗教色彩。
2. **强化 Forge 意象**：「开炉/淬炼/锻阶」均与锻造、锤炼相关，契合 FlowForge 品牌。
3. **ToB 友好**：「锻灵」比「炉灵」少一分玄幻，多一分工业感。
4. **英文自然**：Forgekin / Forge Codex / Forge Tiers 国际化无障碍。
5. **与 clowder-ai 解耦**：不再依赖「养猫」隐喻，独立成体系。

### 8.4 备选命名方案（方案 B：「智锻体」）

> **定位**：更偏企业级、工业化的命名。

| 中文 | 英文 | 说明 |
|------|------|------|
| 体系总称 | 智锻体 | Intelligent Forge System | 智能锻造体。 |
| 单个智能体 | 锻子 | Forgelet | Forge + let（小实体）。 |
| 记忆 | 经验模 | Experience Matrix | 经验矩阵。 |
| 画像 | 认知模 | Cognition Matrix | 认知矩阵。 |
| 成长阶段 | 锻级 | Forge Level | F1-F6。 |

**适用场景**：面向大型企业客户、政府/金融等保守行业。

### 8.5 备选命名方案（方案 C：保留「炉灵」但优化英文）

> 若用户偏好现有「炉灵」中文，建议仅优化英文与国际接受度。

| 中文（保留） | 英文（优化） | 优化原因 |
|--------------|--------------|----------|
| 炉灵 | Forgekin | ✅ 已很好，保留。 |
| 魂忆 | Echo Archive | 去 Soul，强调回声/记忆存档。 |
| 魂印 | Imprint Profile | 去 Soul，强调刻画画像。 |
| 升华阶 | Evolution Tiers | 去 Ascension 宗教色彩。 |
| 灵族 | Kin Assembly | Assembly 比 Kinship 更自然。 |

### 8.6 命名方案选择建议

| 场景 | 推荐方案 |
|------|----------|
| 对外品牌宣传、产品官网 | **方案 A「锻灵体系 / Forgekin System」** |
| 技术文档、开发者 API | **方案 A + 方案 C 英文优化** |
| 大型企业/政府/金融行业 | **方案 B「智锻体」** |
| 内部研发代号 | 可保留「炉灵」作为内部昵称 |

### 8.7 命名与 AGI 演进路径映射（方案 A 视角）

为体现「从工具到自主体」的 AGI 愿景，建议将命名与能力演进阶段绑定：

| AGI 阶段 | 用户感知 | 对应术语（方案 A） | 能力标志 |
|----------|----------|-------------------|----------|
| **L1 工具** | 按指令执行 | 锻灵 / Forgekin | 完成单次任务 |
| **L2 助手** | 理解上下文、主动提醒 | 铭忆 / Memory Mark | 跨任务记忆 |
| **L3 伙伴** | 理解用户偏好、持续学习 | 铭刻 / Profile Mark | 认知画像 |
| **L4 协作者** | 多智能体协作、技能复用 | 共振 / Resonance + 锻典 / Forge Codex | 多 Agent + Skill 市场 |
| **L5 自主体** | 无人驱动时自我进化 | 自锻 / Auto-Forge | 自主思考与改进 |
| **L6 创造者** | 创造新智能体 | 开炉 / Forge Ignition | E6 锻师创建新锻灵 |

**对外 Slogan 建议**：
- **中文**：「锻灵体系——让 AI 像钢铁一样，在锻造中进化。」
- **英文**：「Forgekin System — AI that evolves through forging.」

### 8.8 命名统一行动项

1. 选定总称后，更新 `spec.md` / `arch.md` / `design.md` / `face/*` 全部术语。
2. 在 `config/evolution.yaml` 中增加 `terminology` 配置节，支持未来改名而不改代码。
3. 废弃 `SelfEvolutionEngine` 等 v4.0 术语，统一使用新命名。
4. 文档中增加「术语演进声明」，说明与 clowder-ai 的关系仅为方法论参考。
5. 若选方案 A，建议将「炉灵」作为内部研发代号保留，对外统一使用「锻灵体系 / Forgekin System」。

---

## 附录：关键问题修复优先级清单

### P0（立即修复）

1. 统一 `spec.md`/`arch.md`/`design.md` 文档版本号（改为 v7.0 或拆分文档）。
2. 重构 `flowforge/evolution/`：删除/重命名 `SelfEvolutionEngine`，按 design.md 实现 `ForgekinEngine` 及子模块。
3. 删除 `devforge/plugins.py` 中非标准 `register_evolution` 钩子（其 docstring 仍引用 `SelfEvolutionEngine`）。
4. 解决 v3.0-face「互联层」与 v7.0「自进化层」的第 7 层冲突（建议八层架构）。
5. 清理 `spec_face.md` 中 M18-M20 残留引用。
6. 明确 `ForgekinEngine` 与 `LoopExecutor` 的关系。
7. 迁移 `flowforge/agents/` 中的业务 Agent 到对应 *Forge 项目。
8. 统一 LLM 调用走 `ModelCapability`，禁止业务代码直接 import `LLMClient`。
9. 将 `flowforge/memory/` 直接 SQL 封装到 Repository 层。
10. 删除/重构测试中的 MockLLM（至少集成测试必须真实 LLM）。
11. 修复 StockForge（`schedule_service.py:178/185`、`report_repository.py:121`）和 MallForge（`inventory_manager.py:111/137/192`）的直接 SQLite 访问，统一走 Repository 层。
12. 创建 `flowforge/config/evolution.yaml`、`forgekin_seeds/`、`auto_forge.yaml`、`external_tools.yaml` 及 `migrations/007-013.sql`，补齐 v7.0 配置与数据库 schema。
13. 在 `flowforge/core/plugin_protocol.py` 中定义 PluginProtocol V3 钩子：`register_forgekins`、`register_skill_seeds`、`register_forgekin_prompts`。
14. 删除 `flowforge/core/declarative_agent.py:750` 的硬编码 refine fallback 提示词，迁移到 `config/prompts.yaml` 并去除领域术语。
15. 删除 `devforge/plugins.py:470-482` 的非标准 `register_evolution` 方法。

### P1（本迭代内修复）

16. 清理硬编码提示词（`contentforge/tools/research_engine.py`、`flowforge/modes/default_llm_actors.py`、`flowforge/core/declarative_agent.py:750`、`stockforge/tools/fundamental_analysis.py`、`stockforge/tools/market_analysis.py`、`test_create_api.py`、`hiclaw/test/*.py` 等）。
17. 定义 E1-E6 升华判定执行者与 5Q 量纲。
18. 明确 Soul Echo L3 语义记忆的实现算法与存储后端。
19. 为 Auto-Forge 增加退化检测与自动回滚机制。
20. 明确 v3.0-face M4 Guardrails 与 v7.0 SR-01~08 的层级关系。
21. 验证 StockForge 通过 OpenSieve 获取数据、注册 adapters。
22. 明确 `flowforge/a2a/` 与 v7.0 `evolution/council/a2a_manager.py` 的关系，避免重复建设。
23. 升级 `flowforge/pyproject.toml` 至 `version = "7.0.0"`，并添加 `sqlite-vec`、`wilson-interval` 等 v7.0 依赖。

### P2（下迭代规划）

24. 优化 Provoke 安全检查（从关键词黑名单升级为语义分类器）。
25. 验证 Windows 11 兼容性（sqlite-vec、外部编码工具 CLI）。
26. 制定养灵体系测试策略（如何客观验证「进化」而非随机变化）。
27. 完善 ForgekinCouncil 多渠道实现，Phase 0 先聚焦 Web Chat。

---

*审核报告完。*
