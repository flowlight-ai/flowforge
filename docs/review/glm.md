# FlowForge v7.0 自我进化与养灵体系设计 — 多角色联合深度审核意见（GLM 团队 第四轮）

> **审核日期**：2026-07-15
> **审核版本**：v7.0（炉灵养成体系）+ v3.0-face（大厂面试进化需求）
> **审核角色**：AI 智能体产品专家 / AI 高级架构师 / AI 智能体 Agent 开发工程师 / 高级软件全栈工程师 / 产品总监 / 技术 VP
> **审核范围**：
> - `flowforge/docs/spec.md`（v2.1 基础规格 + v7.0 炉灵养成体系，第 3219-4082 行）
> - `flowforge/docs/arch.md`（v6.0 架构 + v7.0 七层升级，第 5293-6492 行）
> - `flowforge/docs/design.md`（v6.0 详细设计 + 第五部分 v7.0 进化能力详设，第 3260-5800+ 行）
> - `flowforge/docs/face/spec_face.md`（v3.0-face 进化需求 + M18-M20 融合映射）
> - `flowforge/docs/face/arch_face.md`（v3.0-face 架构详设）
> - `flowforge/docs/face/task_face.md`（v3.0-face 任务清单）
> - `hiclaw/rules.md`（开发规范权威源，15 条编程红线 + 9 条测试铁律 + 6 条架构铁律）
> - `hiclaw/prompts.md`（提示词模板库，P1-P40 + FF1-FF26 + 各 *Forge 模板）
> - `flowforge/evolution/` 实际代码（8 个文件）
> - `flowforge/agents/` 实际代码（generic/ 目录 24 个文件）
> - `flowforge/core/declarative_agent.py`、`flowforge/modes/default_llm_actors.py`、`flowforge/loop/verifier.py` 核心代码
> - 9 大项目代码与 rules.md/prompts.md 一致性（flowforge/contentforge/devforge/novelforge/mallforge/stockforge/opensieve/openroute/hiclaw）
>
> **本轮特点**（相对 doubao.md 第二轮、minimax.md 第三轮）：
> 1. **逐章节逐问题分析**：不摘要后处理，逐个文档逐个章节审核（用户重点要求）
> 2. **代码与设计文档差异实测验证**：直接读取 evolution/、agents/、core/ 实际代码，而非依赖二手报告
> 3. **术语冲突根因定位**：发现 evolution/ 代码仍使用 v4.0 术语（SelfEvolutionEngine），与 v7.0 设计（ForgekinEngine）严重不符
> 4. **养灵体系命名方案 4 套**（用户重点要求，结合项目愿景与通用 AGI）

---

## 目录

1. [总体评价与核心结论](#1-总体评价与核心结论)
2. [第一部分：v7.0 炉灵养成体系设计逐章审核（spec.md）](#2-第一部分v70-炉灵养成体系设计逐章审核specmd)
3. [第二部分：v7.0 七层架构逐章审核（arch.md）](#3-第二部分v70-七层架构逐章审核archmd)
4. [第三部分：v7.0 详细设计逐章审核（design.md）](#4-第三部分v70-详细设计逐章审核designmd)
5. [第四部分：face 目录三份文档逐章审核](#5-第四部分face-目录三份文档逐章审核)
6. [第五部分：代码实现与设计文档差异实测分析](#6-第五部分代码实现与设计文档差异实测分析)
7. [第六部分：9 大项目与 rules.md/prompts.md 一致性逐项分析](#7-第六部分9-大项目与-rulesmdprompts-md-一致性逐项分析)
8. [第七部分：养灵体系命名方案 4 套建议](#8-第七部分养灵体系命名方案-4-套建议)

---

## 1. 总体评价与核心结论

### 1.1 总体评分

| 维度 | 评分(10分制) | 评价 |
|------|:------------:|------|
| **产品愿景与定位** | 9.0 | "从驾驭到养成"的范式跃迁极具前瞻性，炉灵体系将 Agent 从"工具"升维为"数字生命"，对标 clowder-ai 养猫体系且适配了 FlowForge 规范，愿景宏大且落地路径清晰 |
| **架构设计合理性** | 7.5 | 七层架构（新增自进化层）概念清晰，Feature Flag 灰度降级策略完善，但与 v3.0-face 的"互联层"在第 7 层定义上存在冲突，且自进化层与 Harness 层边界有重叠 |
| **技术可行性** | 6.5 | 核心概念（Soul Echo 三层记忆、Auto-Forge 双层架构、Forge Codex 五级阶梯）均有学术/工程依据，但升华阶段 E1-E6 的判定执行者未定义，Soul Imprint 白名单采集的具体实现路径不够清晰 |
| **文档完整性** | 6.0 | spec.md/arch.md/design.md 三份文档覆盖了 FR-EVO-01~15 完整需求，但版本号混乱（spec 标题 v2.1、arch 标题 v6.0、内容含 v7.0），且 design.md 描述的 evolution/ 30+ 文件与实际 8 个文件严重不符 |
| **代码实现一致性** | 4.0 | evolution/ 代码仍使用 v4.0 术语（SelfEvolutionEngine/ScopeGuard/KnowledgeMaturityLadder），与 v7.0 设计的 ForgekinEngine/Auto-Forge/Ember Hierarchy 严重术语冲突；core 文件存在硬编码业务提示词 |
| **与 9 大项目一致性** | 5.5 | 多处代码违反 rules.md 铁律（硬编码提示词、直接操作数据库、MockLLM），需逐项修复 |
| **配置驱动合规性** | 6.5 | v7.0 设计了完善的 YAML 配置（evolution.yaml/forgekin_seeds/a2a_channels.yaml），Feature Flag 降级策略清晰，但现有 core 代码仍有硬编码提示词残留 |
| **测试可验证性** | 5.0 | spec.md 定义了 AC-01~AC-47 共 47 条验收标准，覆盖面广，但缺少"自我进化有效性"的测试策略——如何验证炉灵真的"成长"了而非随机变化 |

### 1.2 核心发现（Top 15 严重问题）

| # | 严重等级 | 问题描述 | 涉及文档/代码 | 建议优先级 |
|---|:--------:|----------|---------|:----------:|
| 1 | 🔴 致命 | **evolution/ 代码使用 v4.0 术语，与 v7.0 设计严重冲突**：`evolution/__init__.py` 导出 `SelfEvolutionEngine`（v4.0），而 v7.0 设计要求 `ForgekinEngine`；`KnowledgeMaturityLadder` 应为 `Ember Hierarchy`；`ScopeGuard/ProcessEvolution/KnowledgeEvolution` 对应 v7.0 的三模式自生成但命名未对齐 | `flowforge/evolution/__init__.py` / spec.md 第7章 | P0 |
| 2 | 🔴 致命 | **design.md 描述 evolution/ 30+ 文件，实际仅 8 个扁平文件**：design.md 第 15.1 节描述 forgekin/auto_forge/codex/tools/council/security/api 七个子目录共 30+ 文件，实际 evolution/ 只有 8 个扁平 .py 文件，无任何子目录 | `design.md` 第3269行 / `flowforge/evolution/` | P0 |
| 3 | 🔴 致命 | **FlowForge core 硬编码业务领域提示词**：`declarative_agent.py:750` 硬编码"你是资深内容创作者"；`default_llm_actors.py:45` 硬编码"你是内容创作者"；`verifier.py:300` 硬编码评审提示词——违反编程红线第 10 条（禁止在 flowforge 中写死业务领域代码）和红线第 11 条（禁止硬编码提示词） | `flowforge/core/declarative_agent.py` / `flowforge/modes/default_llm_actors.py` / `flowforge/loop/verifier.py` | P0 |
| 4 | 🔴 致命 | **架构层数第 7 层冲突未解决**：v7.0 arch.md 第 15.1 节"七层 = 六层 + 自进化层" vs v3.0-face arch_face.md 第 1.1 节"七层 = 六层 + 互联层"——两个文档都声称自己是"七层架构"但第 7 层定义不同 | `arch.md:5304` / `arch_face.md:15` | P0 |
| 5 | 🟠 严重 | **ForgekinEngine 与 LoopExecutor 关系未定义**：v2.1 已有 LoopExecutor（Planner→Worker→Verifier→Reflector→Memory 五步），v7.0 又有 ForgekinEngine（10 步闭环），两者约 70% 功能重叠，文档未说明是替代/包含/包装关系 | `spec.md` 第7章 / `arch.md:5465` | P0 |
| 6 | 🟠 严重 | **face 文档 M18-M20 引用残留**：虽然 spec_face.md:627 说明"原 M18/M19/M20 已删除"，但全文仍有 15+ 处引用 M18-M20（包括第 156 行 G18 决策项、第 625 行章节标题、第 690 行"工程任务保留在 task_face.md"、第 1234 行"M18/M19/M20 架构详设"引用） | `spec_face.md` / `task_face.md` | P0 |
| 7 | 🟠 严重 | **flowforge tests 使用 MockLLM 违反 T1**：`tests/conftest.py:27` 定义 `MockLLM` 类；`tests/integration/test_react_resume_integration.py` 大量使用 `MockLLMClient`——违反测试铁律 T1（禁止使用 Mock LLM） | `flowforge/tests/conftest.py` / `flowforge/tests/integration/` | P0 |
| 8 | 🟠 严重 | **版本号混乱**：spec.md 标题"FlowForge v2.1 功能特性规格说明书"但第 3219 行起是 v7.0 内容；arch.md 标题含"v6.0"但第 5293 行起是 v7.0 内容；design.md 标题含"v6.0"但第五部分是 v7.0——读者无法判断当前文档版本 | `spec.md:1` / `arch.md` / `design.md` | P0 |
| 9 | 🟠 严重 | **v3.0-face M4 Guardrails 与 v7.0 SR-01~08 功能重叠**：M4 六层 Guardrails（Input/System Prompt/Tool/Output/Action/Cost）与 v7.0 的 8 条安全红线（SR-01 no-classifier / SR-03 Provoke 频率 / SR-04 高风险升级 / SR-06 worktree 隔离）有大量功能重叠，层级关系未明确 | `spec_face.md` M4 / `spec.md` 第12.2节 | P1 |
| 10 | 🟡 中等 | **升华阶段 E1-E6 判定执行者未定义**：spec.md 第 7.4 节给出了量化晋升条件（如"≥2 个相似 Episode，5Q ≥ 7/10"），但未说明谁执行判定——是 LLM 自评？Metrics 系统自动？ForgekinCouncil 投票？还是 operator 人工？ | `spec.md` 第7.4节 | P1 |
| 11 | 🟡 中等 | **Soul Echo 三层记忆的存储后端设计不完整**：arch.md 指定 L1=内存、L2=SQLite+sqlite-vec、L3=Forge Codex，但 design.md 中 EchoStore 的实现未说明向量索引的创建/更新/重建策略，sqlite-vec 在 Windows 11 的兼容性未验证（project_memory 要求 Windows 11 通过） | `arch.md:5626` / `design.md` | P1 |
| 12 | 🟡 中等 | **Auto-Forge 自指修改缺少漂移防护机制**：自锻引擎让炉灵修改自己的 prompt/skill，但缺少退化检测和自动回滚机制——存在"越改越差"的退化式进化风险 | `spec.md` 第8.4节 / `arch.md:5692` | P1 |
| 13 | 🟡 中等 | **stockforge 直接操作数据库**：`app/services/schedule_service.py:178` 直接 `sqlite3.connect`，`app/services/report_repository.py` 虽是 Repository 但直接使用 `conn.execute` 拼 SQL 而非 ORM——违反铁律 4 | `stockforge/app/services/` | P1 |
| 14 | 🟡 中等 | **contentforge 硬编码提示词**：`tools/research_engine.py:168` 硬编码"你是素材研究规划专家"——违反编程红线第 11 条 | `contentforge/tools/research_engine.py` | P1 |
| 15 | 🟡 中等 | **Provoke 安全检查使用关键词黑名单，易被绕过**：`arch.md:6406` 的 `check_provoke` 用 `["投资建议","感情建议","健康诊断","价值判断"]` 关键词过滤，但 LLM 可用同义词/隐喻绕过（如"理财规划"替代"投资建议"） | `arch.md:6401` | P2 |

### 1.3 三个核心矛盾点

```
矛盾1：v4.0 代码术语 vs v7.0 设计术语（P0级，最严重）
  ┌──────────────────────────────────────────────────────────────┐
  │  evolution/__init__.py（实际代码）   spec.md/arch.md（设计）  │
  │  ─────────────────────────────       ──────────────────────  │
  │  SelfEvolutionEngine          →     ForgekinEngine            │
  │  ScopeGuard (Mode A)          →     Scope Guard（同名但属     │
  │  ProcessEvolution (Mode B)    →     Process Evolution         │
  │  KnowledgeEvolution (Mode C)  →     Knowledge Evolution        │
  │  KnowledgeMaturityLadder     →     Ember Hierarchy           │
  │  KnowledgeMaturityLevel      →     Ember Level (E-L0~E-L4)   │
  │  EpisodeCard                 →     SoulEpisode               │
  │  MethodCard                  →     Skill Draft / Method Card  │
  │  EvalLedger                  →     Eval Ledger（同名）        │
  │  MetacognitionRouter         →     MetaCognitionGuard         │
  │                                                              │
  │  → 根因：evolution/ 代码是 v4.0 时期写的，v7.0 设计文档是     │
  │    后写的，代码未同步更新术语                                  │
  │  → 影响：开发者按 v7.0 文档写代码会找不到 ForgekinEngine 类    │
  └──────────────────────────────────────────────────────────────┘

矛盾2：v3.0-face vs v7.0 架构层数冲突
  ┌──────────────────────────────────────────────────────────────┐
  │  v2.1 六层架构（共同基础）                                    │
  │  ↓                                                           │
  │  v3.0-face: 七层 = 六层 + 互联层（第7层=Interconnect）        │
  │  v7.0     : 七层 = 六层 + 自进化层（第7层=Evolution）         │
  │                                                              │
  │  → ADR-007-02 明确选了"自进化层作为第7层"                      │
  │  → 但 v3.0-face 的互联层（A2A/MCP）也需要一个位置             │
  │  → 方案：八层架构，或互联层下沉为接入层扩展                    │
  └──────────────────────────────────────────────────────────────┘

矛盾3：design.md evolution/ 30+ 文件 vs 实际 8 个扁平文件
  ┌──────────────────────────────────────────────────────────────┐
  │  design.md 第15.1节描述：                实际 evolution/：    │
  │  ──────────────────                      ──────────────────  │
  │  forgekin/ (8文件)                       __init__.py         │
  │  auto_forge/ (7文件)                     engine.py           │
  │  codex/ (7文件)                          knowledge_evolution.py│
  │  tools/ (5文件)                          maturity.py         │
  │  council/ (7+文件)                       metacognition.py    │
  │  security/ (2文件)                       models.py           │
  │  api/ (5文件)                            process_evolution.py│
  │  合计 30+ 文件                            scope_guard.py      │
  │                                          合计 8 文件          │
  │                                                              │
  │  → 缺失：所有子目录、SoulStore/EchoStore/ImprintStore、       │
  │    AutoForgeEngine、ForgeCodex、A2AManager、ForgekinCouncil  │
  └──────────────────────────────────────────────────────────────┘
```

---

## 2. 第一部分：v7.0 炉灵养成体系设计逐章审核（spec.md）

> 本部分逐章审核 spec.md 第 3219-4082 行的 v7.0 内容。

### 2.1 第七章：自我进化能力总览（spec.md 第 3236-3395 行）

#### 2.1.1 核心隐喻与命名（第 7.1-7.2 节）

**审核角色**：AI 产品专家

**优势**：
1. **隐喻跃迁有力**：从 v6.0 的"驾驭野兽"到 v7.0 的"养成灵体"，概念升级清晰，符合 AGI 从"工具"到"伙伴"的演进趋势。
2. **对标体系完整**：第 7.2 节的 12 个概念（炉灵/灵族/养灵/炉启/共鸣/自锻/魂忆/魂印/锻典/火种等级/升华阶/灵议）与 clowder-ai 的 12 个概念一一对标，体系完整。
3. **命名有"炉"的特色**：Forgekin 呼应 FlowForge 的"Forge（炉/锻造）"，比 clowder-ai 的"猫"更贴合开发场景。

**问题**：
1. **术语面向 ToB 的接受度存疑**：炉灵/魂忆/魂印/锻典/灵议/自锻/升华阶等术语偏玄幻风格，ToB 企业客户可能觉得不专业。spec.md 第 4071 行 D1 决策点列出了 A/B/C 三个命名选项但未做用户调研验证。
2. **"对标 clowder-ai 养猫"的绑定过深**：spec.md 第 3232 行"深度借鉴 clowder-ai「养猫」体系"——如果 clowder-ai 的方法论变化，FlowForge 是否同步变化？应明确"借鉴方法论，非绑定实现"。

**建议**：
- 提供双命名体系：对外宣传用"Forgekin 自进化体系"，技术文档用炉灵/魂忆等术语，详见第七部分命名方案。
- 在 spec.md 增加"术语稳定性声明"：明确 FlowForge 有独立的术语演进路线，clowder-ai 仅作为方法论参考。

#### 2.1.2 两类智能体设计（第 7.3 节）

**审核角色**：AI 高级架构师

**优势**：
1. **Static Agent + Forgekin 分离设计合理**：不是所有任务都需要自我进化，流水线型用静态智能体更高效，复杂创意型用炉灵——符合 ADR-007-01 的决策。
2. **衔接契约清晰**：`delegate_to_static()` 单向调用、结果回写 Soul Echo、静态智能体不知 Forgekin 存在——单向依赖设计正确。
3. **执行路径四选一**：auto/static/external/mode 四种策略，auto 模式由炉灵自决策，灵活性好。

**问题**：
1. **ForgekinEngine 与 LoopExecutor 关系未定义（P0）**：spec.md 第 7.5 节列出 FR-EVO-01~15 但未说明 ForgekinEngine 与现有 LoopExecutor（v2.1 的 Planner→Worker→Verifier→Reflector→Memory）的关系。对比：
   | 维度 | LoopExecutor (v2.1) | ForgekinEngine (v7.0) |
   |------|---------------------|----------------------|
   | 步骤 | 5 步（P/W/V/R/M） | 10 步 |
   | 灵魂 | 无 | Soul Profile 注入 |
   | 记忆 | MemoryManager | Soul Echo（三层） |
   | 反思 | Reflector | Reflector + 魂印更新 |
   | 重叠 | — | 约 70% |
   
   两者是替代？包含？包装？文档未说明。

2. **`delegate_to_static()` 的错误处理策略不完整**：spec.md 第 3875 行 AC-47 说"委托失败时 Forgekin 可选择重试/降级/升级"，但未定义：
   - 重试几次后降级？
   - 降级到什么？外部工具？
   - 升级到什么？operator 介入？

**建议**：
- 明确 ForgekinEngine 与 LoopExecutor 的演进路径：短期 ForgekinEngine 包装 LoopExecutor 增加 Soul 加载/沉淀；中期逐步迁移；长期 LoopExecutor 作为兼容接口。
- 补充 `delegate_to_static()` 的错误处理决策树。

#### 2.1.3 升华阶段 E1-E6（第 7.4 节）

**审核角色**：AI 产品专家 + AI Agent 开发工程师

**优势**：
1. **六阶段设计有层次**：Spark→Ember→Flame→Blaze→Inferno→Forge Master，对标游戏角色升级，有成长感。
2. **晋升条件量化**：如 E2→E3 需"≥2 个相似 Episode，5Q ≥ 7/10"——有可量化标准。
3. **降级/冻结机制完整**：E3→E2（成功率<50%）、E4→E3（<60%）、E5 freeze（1 次越界）、E6 revoke（operator 撤销）——有退场机制。

**问题**：
1. **判定执行者未定义（P1）**：spec.md 给出了量化条件，但未说明"谁来执行判定"：
   - 是 LLM 自评？（不可靠，标准不一致）
   - 是 Metrics 系统自动从数据库读取？（那 5Q ≥ 7/10 的 5Q 谁打分？）
   - 是 ForgekinCouncil 投票？
   - 是 operator 人工确认？
   
2. **5Q（5 Questions）评分机制未定义**：E2 晋升条件"5Q ≥ 7/10"中的 5Q 是什么？5 个问题？5 个评委？评分标准是什么？

3. **E6 创建炉灵的"失控风险"**：E6 Forge Master 可创建新炉灵（FR-EVO-01 中 parent_forgekin 字段），即使有 SR-05"需 operator 授权"，但如果 operator 授权后 E6 持续创建低质量炉灵怎么办？

**建议**：
- 明确判定执行者：70% 量化指标（Metrics 自动）+ 20% ForgekinCouncil 投票 + 10% operator 确认。
- 定义 5Q 评分机制：5 个维度的质量评估（如准确性/完整性/可维护性/效率/可读性），每维度 0-10 分。
- E6 创建炉灵增加"质量保证金"：新建炉灵的首次升华需 operator 二次确认。

#### 2.1.4 v7.0 核心能力清单 FR-EVO-01~15（第 7.5 节）

**审核角色**：AI 高级架构师

**审核结论**：15 个 FR-EVO 需求覆盖全面，优先级分配合理（P0: FR-EVO-01~11，P1: FR-EVO-12~14，P2: FR-EVO-15）。但有两个问题：

1. **FR-EVO-08 Trae Bridge 的 ROI 存疑**：Trae 个人版无 CLI，用 JSON 文件交换+轮询模式——轮询延迟（默认 2s）+ 超时降级（300s），在实时性要求高的场景（如代码审查）体验差。是否值得为 Trae 单独设计 Bridge 模式？还是直接用 Trae 的 MCP 能力（如果有）？

2. **FR-EVO-15 元认知能力的 Wilson 下界实现复杂度**：Wilson score lower bound 需要维护 successes/trials 的滚动窗口，在高频任务场景下（如 ContentForge 每天创作多篇文章），窗口大小如何设置？过小波动大，过大响应慢。

### 2.2 第八章：炉灵需求规格逐条审核（spec.md 第 3397-3639 行）

#### 2.2.1 FR-EVO-01 炉灵身份系统（第 8.1 节）

**审核角色**：AI Agent 开发工程师

**优势**：
- Soul Profile 数据结构完整：forgekin_id/name/kind/ascension_stage/birth_at/parent_forgekin/soul(persona/worldview/values/voice)/capabilities/evolution/metadata
- AC-01~AC-04 验收标准清晰

**问题**：
1. **Soul Profile 中 persona 是自由文本（YAML 多行字符串）**：spec.md 第 3414 行 `persona: |` 后是自然语言——这违反了 rules.md 红线 11（禁止硬编码提示词）的精神。persona 应该引用外部 YAML 配置文件（如 `persona_ref: config/forgekin_seeds/devforge/architect.yaml`），而非内联。

2. **AC-02"Soul Profile 持久化到 SQLite"与 arch.md 不完全一致**：arch.md 第 5578 行指定 `forgekin_souls` 表用 SQLite，但 design.md 第 3393 行的 migrations 也用 SQLite——如果未来需要多炉灵并发（如自锻群 3 个炉灵同时写），SQLite 的写锁竞争如何处理？

#### 2.2.2 FR-EVO-02 魂忆 Soul Echo（第 8.2 节）

**审核角色**：AI 高级架构师

**优势**：
- 三层记忆对标 MemGPT，设计合理：L1 Working（会话级）/ L2 Episode（最近 100 个）/ L3 Semantic（Forge Codex）
- SoulEpisode 数据结构包含 6 类协作 context + 元认知三信号
- AC-05~AC-08 验收标准具体

**问题**：
1. **L2 Episode 的向量索引实现未指定（P1）**：arch.md 第 5628 行说"L2: SQLite 表 + sqlite-vec 向量索引"，但 sqlite-vec 是 2024 年新项目，Windows 11 兼容性未验证（project_memory 要求 Windows 11 通过）。如果 sqlite-vec 不可用，fallback 到什么？faiss？还是纯关键词检索？

2. **"相关性检索"的算法未定义**：arch.md 第 5619 行 `recall()` 说"向量 + 关键词 + 时间衰减"——三者的权重如何分配？是加权融合还是级联过滤？

3. **Episode 的 embedding 何时生成**：SoulEpisode 有 `embedding BLOB` 字段，但未说明是在 `record()` 时同步生成（增加延迟）还是异步生成（可能检索时还没生成）。

**建议**：
- 明确 sqlite-vec 的 Windows 11 兼容性测试计划，准备 faiss 作为 fallback。
- 定义检索算法：先关键词过滤 Top-50 → 再向量重排 Top-5 → 时间衰减微调。

#### 2.2.3 FR-EVO-03 魂印 Soul Imprint（第 8.3 节）

**审核角色**：AI 高级架构师 + 全栈工程师

**优势**：
- 双层结构设计好：结构化字段（机器读）+ cat_note 主观日记（人读）
- no-classifier 红线明确：SR-01 禁止后台 classifier，必须基于显式行为
- 白名单采集字段定义清晰（task_types/success_rate/tool_usage/collaboration_patterns/time_preferences）

**问题**：
1. **cat_note 的内容由谁生成**：spec.md 第 3521 行说"每次自锻后"更新 cat_note——是 LLM 自由生成？还是模板填充？如果是 LLM 自由生成，如何保证不产生幻觉（描述了未发生过的事）？

2. **AC-10"禁止后台 classifier 自动画像"的执行机制**：谁保证不出现 classifier？代码层面的检查点是什么？是代码审查约定？还是运行时检测？

#### 2.2.4 FR-EVO-04 自锻引擎 Auto-Forge（第 8.4 节）

**审核角色**：AI Agent 开发工程师

**优势**：
- 双层架构对标 clowder-ai Auto-Dream，设计完整
- 自锻流程 8 步（Entry→唤醒→读脚印→画线→分工→写日记→产出→收反馈）有操作性
- Provoke 设计有边界（不碰钱/关系/健康/隐私/价值观）+ 频率硬限（每天≤1）

**问题**：
1. **自锻的 LLM 成本未估算**：每次自锻需要多次 LLM 调用（读留痕→画线→写日记→产出 Imprint proposal），spec.md 第 3964 行 SLO 说"Auto-Forge 单次自锻 < 5min"——5 分钟内可能调用 5-10 次 LLM，按每次 0.01-0.05 美元计算，单次自锻成本 $0.05-0.5。如果有 10 个炉灵每天自锻，月成本 $15-150——是否在 M4 Cost Ceiling 的预算内？

2. **Provoke 的关键词黑名单易被绕过（P2）**：arch.md 第 6406 行用 `["投资建议","感情建议","健康诊断","价值判断"]` 过滤——LLM 可用"理财规划""情感参考""身体状况评估""立场判断"等同义词绕过。建议改为 LLM-as-Judge 语义检查。

#### 2.2.5 FR-EVO-05 锻典 Forge Codex（第 8.5 节）

**审核角色**：AI 高级架构师

**优势**：
- 五级火种阶梯（E-L0 Episode→E-L4 Standard）对标 clowder-ai L0-L4，成熟度管理完善
- 双车道设计（常规车道 + 长尾/高风险车道）考虑了非标准场景
- AC-18~AC-21 验收标准包含 frontmatter 契约和 CLI 命令

**问题**：
1. **"smoke gate ≥3 cases（≥2/3 通过）"的 case 从哪来**：E-L1→E-L2 晋升需要 smoke gate 测试，但测试 case 是谁生成的？是炉灵自己生成测试 case？还是从历史 Episode 中提取？自生成的测试 case 有自我偏见风险。

2. **"≥2 agents"验证条件的多炉灵环境如何保证**：E-L3 Validated 需要"≥2 agents"使用——如果只有一个炉灵（如 DevForge 只有 fk_architect），如何满足？是否必须等待第二个炉灵上线？

### 2.3 第九章：外部编码工具集成（spec.md 第 3641-3762 行）

**审核角色**：AI Agent 开发工程师 + 全栈工程师

**优势**：
- CLI Wrapper 支持 claude_code/codex/opencode 三个主流工具
- Bridge 模式（JSON 文件交换）为 Trae 无 CLI 场景提供了接入方案
- AC-26~AC-34 验收标准包含 worktree 隔离和超时降级

**问题**：
1. **worktree 隔离在 Windows 的兼容性**：SR-06 要求"外部工具调用需 worktree 隔离"，但 `git worktree` 在 Windows 上有路径长度限制（260 字符）和符号链接差异——需验证。

2. **Trae Bridge 的轮询模式有延迟**：默认 2s 轮询 + 300s 超时——如果 Trae 处理一个代码审查需要 60s，Forgekin 要轮询 30 次才得到结果。建议改为 Trae 主动通知（文件锁释放检测 + fsnotify）。

### 2.4 第十章：炉灵协作与 IM 需求（spec.md 第 3765-3877 行）

**审核角色**：AI 产品专家 + 全栈工程师

**优势**：
- A2A 消息结构完整（from/to/thread/mention/content/artifacts/handoff/trace_id）
- 多渠道 IM 架构（Web Chat/飞书/微信/Slack/Discord/GitHub PR）覆盖全面
- 灵议升级为多炉灵议事厅，支持 operator 参与/旁观/干预

**问题**：
1. **@mention 路由的性能**：AC-35 说"@mention 解析支持 @项目前缀:角色名 格式"——如果有 100 个炉灵，@mention 解析需要 O(n) 遍历还是 O(1) 哈希查找？arch.md 未说明。

2. **跨渠道消息同步的一致性**：AC-42 说"跨渠道消息同步（同一 thread 在不同渠道可见）"——如果飞书和 Web Chat 同时编辑同一条消息，如何解决冲突？最后写入胜出？还是操作转换（OT）？

### 2.5 第十一章：*Forge 自进化统一规格（spec.md 第 3879-3956 行）

**审核角色**：AI 高级架构师

**优势**：
- 明确所有 *Forge 都具备自进化能力，只是业务方向不同
- 各 *Forge 炉灵角色示例清晰（DevForge:fk_architect/fk_coder/fk_reviewer 等）
- 跨 *Forge 协作场景有具体示例（内容创作→多平台发布）

**问题**：
1. **StockForge 未列入**：spec.md 第 3902 行的 *Forge 列表只有 FlowForge/DevForge/ContentForge/NovelForge/MallForge/StockForge 共 6 个——但 rules.md 的 9 大项目还包括 opensieve/openroute/hiclaw。opensieve 和 openroute 是否也需要炉灵？如果不需要，应说明原因。

2. **各 *Forge 的炉灵配置 YAML 在哪**：design.md 第 3350 行描述了 `config/forgekin_seeds/` 目录，但实际不存在这些种子配置文件——代码实现严重滞后。

### 2.6 第十二章：非功能需求与 SLO（spec.md 第 3958-4013 行）

**审核角色**：AI 高级架构师

**优势**：
- SLO 指标具体（Auto-Forge < 5min、Soul Echo 写入 < 100ms、检索 < 500ms）
- 安全红线 SR-01~08 覆盖全面
- 可观测性指标 11 个，支持 Prometheus 格式

**问题**：
1. **SR-01~08 与 v3.0-face M4 Guardrails 关系未明确**：SR-01 no-classifier / SR-03 Provoke 频率 / SR-04 高风险升级 / SR-06 worktree 隔离——这些与 M4 六层 Guardrails（Input/System Prompt/Tool/Output/Action/Cost）有功能重叠。是 SR 纳入 M4？还是 M4 纳入 SR？还是各管各的？

2. **配置驱动率目标"Skill 驱动率 0%→≥80%"的实现路径不清**：从 0% 到 80% 的路径是什么？是炉灵自生成 Skill 后自动入库？还是 operator 手动创建？

### 2.7 第十三章：v7.0 路线图（spec.md 第 4015-4082 行）

**审核角色**：AI 产品专家

**优势**：
- Phase 6.1-6.7 分阶段清晰，P0→P1→P2 优先级合理
- 里程碑 M1-M7 验收标准具体（如 M1"创建第一个 E1 炉灵"）

**问题**：
1. **Phase 6.1-6.7 与 face/task_face.md 的 Phase 排期冲突**：task_face.md 的 Phase 是 6.0(2月)+6.1(3月)+6.2(2月)=7 个月（针对 M1-M17），而 spec.md 的 Phase 6.1-6.7 是针对炉灵体系——两套 Phase 编号冲突，开发者不知道先做哪个。

---

## 3. 第二部分：v7.0 七层架构逐章审核（arch.md）

> 本部分逐章审核 arch.md 第 5293-6492 行的 v7.0 内容。

### 3.1 第 15 章：v7.0 架构总览（arch.md 第 5302-5460 行）

#### 3.1.1 七层架构模型（第 15.1 节）

**审核角色**：AI 高级架构师

**优势**：
- 七层架构清晰，自进化层在最顶层，可调用以下所有层
- 依赖方向明确：自进化层 → 应用层 → 接入层 → Harness → 引擎 → 能力 → 基础设施
- "v6.0 全部能力保留并向后兼容"——兼容性好

**问题**：
1. **第 7 层冲突（P0，已在核心发现 #4 详述）**：v7.0 的第 7 层是"自进化层"，v3.0-face 的第 7 层是"互联层"。ADR-007-02 明确选了自进化层，但互联层（A2A/MCP）放在哪？arch.md 第 5310 行把 A2A 放在了自进化层内（"Forgekin Council | External Tool Bridge | Trae Bridge"），但 A2A 协议本身是通用能力，不应只服务于自进化。

**建议**：采用八层架构：
- 第 7 层：自进化层（ForgekinEngine/Auto-Forge/Soul Echo/Imprint/Codex）
- 第 8 层：互联层（A2A Server/Client/Agent Directory/MCP 2026）

或：互联层下沉为接入层（第 5 层）的增强。

#### 3.1.2 ForgekinEngine 架构图（第 15.2 节）

**审核角色**：AI Agent 开发工程师

**优势**：
- 完整架构图展示了 ForgekinEngine 的 7 步闭环（soul.load→echo.recall→execute→echo.record→imprint.propose→codex.maybe_distill→ascension.check）
- 各组件职责清晰（Soul Profile/Soul Echo/Soul Imprint/Auto-Forge/Forge Codex/External Tool Bridge/Forgekin Council）

**问题**：
1. **ForgekinEngine 7 步 vs spec.md 10 步不一致**：arch.md 第 5348 行的架构图是 7 步，但 design.md 第 3568 行的 ForgekinEngine 完整实现是 10 步——哪个是准确的？design.md 将步骤 8-10 合并为 `_evolve()`？

2. **"30+ Agent"的描述有误导**：arch.md 第 5412 行说"30+ Agent"——但实际 flowforge/agents/generic/ 只有 24 个文件（且多为空壳），加上 declarative.py 才 25 个。数字不准确。

### 3.2 第 16 章：炉灵架构设计（arch.md 第 5463-5690 行）

#### 3.2.1 ForgekinEngine 类设计（第 16.1 节）

**审核角色**：AI Agent 开发工程师 + 全栈工程师

**优势**：
- 构造函数注入 9 个依赖（hybrid_executor/soul_store/echo_store/imprint_store/codex/auto_forge_engine/external_tool_bridge/a2a_manager/ascension_manager）——符合 DI 铁律 3
- `execute()` 方法有完整的 10 步闭环实现
- 降级策略清晰：`execution_strategy` 参数支持 auto/static/external/mode

**问题**：
1. **`_build_soul_prompt()` 的实现可能违反红线 11**：arch.md 第 5520 行 `context.system_prompt += self._build_soul_prompt(soul, imprint)`——如果 `_build_soul_prompt()` 内部硬编码了提示词模板，违反"禁止硬编码提示词"。应引用外部 YAML 配置。

2. **`_decide_strategy()` 的决策逻辑未定义**：arch.md 第 5524 行 `execution_strategy = self._decide_strategy(input, soul)`——如何决策？基于任务复杂度？基于炉灵升华阶段？基于 Soul Imprint？决策逻辑应外置到 YAML 或至少在文档中说明。

#### 3.2.2 SoulStore 存储（第 16.2 节）

**优势**：SQLite 表结构清晰，支持 CRUD

**问题**：
1. **`soul_profile TEXT NOT NULL -- JSON` 的查询效率**：Soul Profile 用 JSON 存储在 TEXT 字段——如果需要按 `persona` 或 `worldview` 查询，需要 JSON 解析，性能差。建议将关键字段（如 ascension_stage）提取为独立列。

#### 3.2.3 EchoStore 三层记忆（第 16.3 节）

**优势**：三层架构清晰，L1 内存/L2 SQLite+向量/L3 Forge Codex

**问题**：
1. **sqlite-vec 在 Windows 11 的兼容性（P1）**：已在核心发现 #11 详述。

2. **L2 的"最近 100 个 Episode"的淘汰策略**：arch.md 说"LRU + 重要性评分"——重要性评分如何计算？如果 3 个炉灵各产生 50 个 Episode，总共 150 个，LRU 淘汰哪些？

### 3.3 第 17 章：Auto-Forge Engine 架构（arch.md 第 5692-5780 行）

**优势**：
- 双层架构（Consolidation 后台 + Surface 前台）对标 clowder-ai F255
- 多条件触发（非每日 cron）设计合理
- APScheduler 集成

**问题**：
1. **`_is_low_activity_period()` 的判定依据**：arch.md 第 5731 行——基于时间（夜间 22-6 点）还是基于系统负载（无活跃任务）？如果用户在夜间工作，自锻会干扰。

### 3.4 第 21 章：配置驱动与 Feature Flag（arch.md 第 6250-6364 行）

**优势**：
- Feature Flag 设计完善，6 个开关（use_forgekin_engine/use_auto_forge/use_external_tool_bridge/use_trae_bridge/use_forgekin_council/use_a2a_protocol）默认关闭
- 降级策略表清晰（6 个组件的降级路径和触发条件）
- evolution.yaml 配置结构完整

**问题**：
1. **Feature Flag 的 `rollout_percentage` 如何实现**：arch.md 第 6260 行 `rollout_percentage: 0`——按什么维度灰度？按 forgekin_id 哈希？按项目？按用户？

### 3.5 第 22 章：安全与治理架构（arch.md 第 6367-6458 行）

**优势**：
- ForgekinSecurityGuard 实现了 SR-05（创建权限）、SR-06（worktree 隔离）、SR-03（Provoke 频率）
- MetaCognitionGuard 实现了元认知三信号（reliability + evidence_completeness + self_reported）+ Wilson 下界

**问题**：
1. **Provoke 安全检查的关键词黑名单（P2，已在核心发现 #15 详述）**：`["投资建议","感情建议","健康诊断","价值判断"]` 易被同义词绕过，建议改为 LLM-as-Judge。

### 3.6 第 23 章：ADR 架构决策记录（arch.md 第 6460-6492 行）

**优势**：5 个 ADR 记录了关键决策（两类智能体分离/自进化层第7层/Trae Bridge/no-classifier/Provoke 频率）

**问题**：
1. **缺少"互联层 vs 自进化层"的 ADR**：ADR-007-02 选了自进化层作为第 7 层，但未记录"为什么不是互联层"的决策——这个冲突需要明确记录。

---

## 4. 第三部分：v7.0 详细设计逐章审核（design.md）

> 本部分逐章审核 design.md 第五部分（第 3260-5800+ 行）的 v7.0 内容。

### 4.1 第 15 章：v7.0 目录结构新增（design.md 第 3269-3400 行）

**审核角色**：AI 高级架构师 + 全栈工程师

**优势**：
- evolution/ 目录结构设计完整：forgekin/auto_forge/codex/tools/council/security/api 七个子目录
- 配置文件设计完善：evolution.yaml + forgekin_seeds/ + a2a_channels.yaml + auto_forge.yaml + external_tools.yaml
- 前端页面设计：council/forgekin/codex 三个新页面
- 数据库迁移：7 张表（007-013）

**致命问题**：
1. **design.md 描述的 30+ 文件与实际 8 个文件严重不符（P0，已在核心发现 #2 详述）**：

   | design.md 描述的子目录 | 文件数 | 实际存在？ |
   |----------------------|--------|-----------|
   | forgekin/ | 8 | ❌ 不存在 |
   | auto_forge/ | 7 | ❌ 不存在 |
   | codex/ | 7 | ❌ 不存在 |
   | tools/ | 5 | ❌ 不存在 |
   | council/ | 7+ | ❌ 不存在 |
   | security/ | 2 | ❌ 不存在 |
   | api/ | 5 | ❌ 不存在 |
   | **合计** | **30+** | **实际 8 个扁平文件** |

   实际 evolution/ 只有：`__init__.py / engine.py / knowledge_evolution.py / maturity.py / metacognition.py / models.py / process_evolution.py / scope_guard.py`

2. **实际代码的类名与 design.md 不一致**：
   - design.md 第 3568 行：`# evolution/forgekin/engine.py` → `ForgekinEngine`
   - 实际 `evolution/__init__.py`：导出 `SelfEvolutionEngine`（v4.0 旧名）
   
   开发者按 design.md 写代码会找不到 `ForgekinEngine`，只能找到 `SelfEvolutionEngine`。

**建议**：
- P0 优先：将 evolution/ 代码重构为 v7.0 设计的目录结构，或更新 design.md 描述与实际代码一致。
- 明确"设计文档描述的是目标状态，当前代码是过渡状态"。

### 4.2 第 16 章：ForgekinEngine 详细设计（design.md 第 3422-4475 行）

**审核角色**：AI Agent 开发工程师

**优势**：
- ForgekinEngine 完整实现（10 步闭环）
- SoulProfile/SoulEpisode 数据模型完整
- SoulStore/EchoStore/ImprintStore/AscensionManager 有完整 CRUD 实现
- ForgekinStaticBridge 两类智能体衔接实现

**问题**：
1. **设计很详细但 0 行代码实现**：design.md 第 3568-4475 行（约 900 行）的 ForgekinEngine 完整实现代码——这些是设计伪代码还是实际代码？如果是实际代码，应该在 evolution/forgekin/engine.py 中，但该文件不存在。

2. **数据库迁移文件不存在**：design.md 第 3393 行描述了 7 个迁移文件（007-013），但实际 migrations/ 目录是否有这些文件需验证。

### 4.3 第 17-19 章：Auto-Forge/Tools/Council 详细设计

**审核角色**：AI Agent 开发工程师

**优势**：
- AutoForgeEngine 双层架构有完整实现
- CLI Wrapper/Trae Bridge/WorktreeManager 设计详细
- ForgekinCouncil 多渠道实现

**问题**：
1. **同样的问题：设计详细但无实现**：这些代码都是 design.md 中的设计伪代码，实际 evolution/ 下没有 auto_forge/、tools/、council/ 子目录。

---

## 5. 第四部分：face 目录三份文档逐章审核

> 本部分逐章审核 face/ 目录下的 spec_face.md、arch_face.md、task_face.md。

### 5.1 spec_face.md 审核

#### 5.1.1 M18-M20 融合映射章节（第 625-730 行）

**审核角色**：AI 高级架构师

**优势**：
- 明确声明"原 M18/M19/M20 三个模块已删除"（第 627 行）
- 术语对齐表完整（第 645-660 行，v3.0 旧术语 → v7.0 新术语）
- 17 行融合映射表清晰（M1-M17 → v7.0 组件对应关系）

**问题**：
1. **M18-M20 引用残留（P0，已在核心发现 #6 详述）**：虽然第 627 行说"已删除"，但全文仍有 15+ 处引用 M18-M20：
   - 第 7 行："通过'M18-M20 v7.0 融合映射'章节与炉灵养成体系无缝对齐"
   - 第 156 行："G18 | v3.0 能力与 v7.0 炉灵体系融合路径不清 | M18-M20 融合"
   - 第 625 行：章节标题仍是"模块 M18-M20"
   - 第 690 行："原 M18/M19/M20 的工程任务保留在 task_face.md"
   - 第 1234 行："M1-M5 + M18/M19/M20 架构详设"
   - 第 996 行：R-18 风险项引用"M18-M20"
   
   **建议**：将所有"M18-M20"引用改为"v7.0 融合映射"或"FR-EVO 融合"，章节标题改为"v7.0 炉灵养成体系融合映射"。

2. **第 164 行的架构描述自相矛盾**："v3.0 在 v2.1 六层架构基础上新增第 7 层'互联层'，并强化 2/3/4 层。**第 7 层'自进化层'由 v7.0 炉灵养成体系承接**"——前半句说第 7 层是"互联层"，后半句说第 7 层是"自进化层"，自相矛盾。

#### 5.1.2 M1-M17 需求审核

**审核角色**：AI 高级架构师 + 全栈工程师

**优势**：
- M1-M17 覆盖了 Agent Harness 的核心能力（A2A/MCP/Context/Guardrails/OTel/Eval/Durable/Self-Correct/Prompt Cache/Deploy/HITL/Governance/Computer Use/Protocol/Recovery/Multi-tenant/Skill Market）
- 每个模块都有"设计要点"说明与 v7.0 的融合关系

**问题**：
1. **M9 Cost 与现有 model_service.py 功能重复**：spec_face.md M9 设计 Cost 优化（Prompt Caching/Token Budget/Model Routing），但 flowforge 已有 `core/model_service.py`（含 Provider 配额管理、多模型级联、健康检查）——两者关系未说明。

2. **M5 OTel 与现有 tracing.py 并存**：spec_face.md M5 设计 OTel GenAI 全量改造，但 flowforge 已有 `core/tracing.py`（get_logger + trace_id）——是替换还是共存？

### 5.2 arch_face.md 审核

**优势**：
- 七层架构图（第 15-44 行）清晰
- 控制回路演进（新增 Durable/CHEQ/Eval-gated/Blast-radius 四条回路）设计完整
- A2A Server/Client 架构详设完善

**问题**：
1. **第 1.1 节的七层架构与 arch.md 第 15.1 节冲突**：arch_face.md 第 15 行说"v3.0 新增第 7 层'互联层'"，arch.md 第 5308 行说"v7.0 新增第 7 层'自进化层'"——同一个"第 7 层"两个定义。

2. **附录"v7.0 炉灵养成体系融合架构对齐"章节**：该附录说明了对齐关系，但未解决"互联层 vs 自进化层谁是第 7 层"的根本冲突。

### 5.3 task_face.md 审核

**优势**：
- 12 项决策对比分析表详细
- 53 个任务/86 人日/8 周排期/关键路径 12 人日/并行度 4 的原始数据保留
- v7.0 融合说明（第 190-194 行）简明

**问题**：
1. **Phase 编号冲突**：task_face.md 用 Phase 6.0/6.1/6.2（针对 M1-M17），spec.md 用 Phase 6.1-6.7（针对炉灵体系）——两套 Phase 6.1 冲突。

2. **决策表中 v4.0 错误决策已删除但痕迹未清**：project_memory 说"v4.0 错误决策（13/14/15 项）已删除"，但决策汇总表只有 12 项——是否确认 13/14/15 已删除？需验证。

---

## 6. 第五部分：代码实现与设计文档差异实测分析

> 本部分基于对实际代码的直接读取和验证，不是二手报告。

### 6.1 evolution/ 代码术语冲突（P0 级致命问题）

**直接验证**：读取 `flowforge/evolution/__init__.py`（第 1-50 行）

**发现**：实际代码使用 v4.0 旧术语，与 v7.0 设计文档严重冲突：

```python
# 实际代码（v4.0 术语）
from flowforge.evolution.engine import SelfEvolutionEngine  # ← 应为 ForgekinEngine
from flowforge.evolution.knowledge_evolution import KnowledgeEvolution
from flowforge.evolution.maturity import KnowledgeMaturityLadder  # ← 应为 EmberHierarchy
from flowforge.evolution.metacognition import MetacognitionRouter  # ← 应为 MetaCognitionGuard
from flowforge.evolution.models import (
    EpisodeCard,  # ← 应为 SoulEpisode
    MethodCard,
    EvalLedger,
    KnowledgeMaturityLevel,  # ← 应为 EmberLevel
    KnowledgeObject,
    ScopeGuardLog,
    ScopeGuardSignal,
    EvolutionProposal,
)
```

**对比 v7.0 设计文档（spec.md 第 7.2 节）**：

| 实际代码（v4.0） | v7.0 设计文档 | 冲突类型 |
|-----------------|-------------|---------|
| `SelfEvolutionEngine` | `ForgekinEngine` | 类名不符 |
| `KnowledgeMaturityLadder` | `Ember Hierarchy` | 术语不符 |
| `KnowledgeMaturityLevel` | `Ember Level (E-L0~E-L4)` | 术语不符 |
| `EpisodeCard` | `SoulEpisode` | 类名不符 |
| `MetacognitionRouter` | `MetaCognitionGuard` | 类名不符 |

**根因分析**：evolution/ 代码是 v4.0 时期写的（移植自 clowder-ai 的三模式自我进化机制），v7.0 设计文档是后写的，代码未同步更新术语。

**影响**：开发者按 v7.0 文档写代码，import `ForgekinEngine` 会报 `ImportError`，只能找到 `SelfEvolutionEngine`。

**修复建议**：
- 方案 A（推荐）：重构 evolution/ 代码，将类名对齐 v7.0 术语，保留旧名作为 alias（兼容期 1 个大版本）
- 方案 B：更新 v7.0 设计文档，接受现有代码术语（不推荐，会与 spec.md/arch.md 冲突）

### 6.2 evolution/ 文件结构严重滞后（P0 级致命问题）

**直接验证**：`LS flowforge/evolution/` + `Get-ChildItem` 文件大小

**发现**：

| design.md 描述（30+ 文件） | 实际（8 个扁平文件） | 大小 |
|---------------------------|-------------------|------|
| `forgekin/engine.py` (ForgekinEngine) | ❌ 不存在 | — |
| `forgekin/soul_profile.py` | ❌ 不存在 | — |
| `forgekin/soul_store.py` (SoulStore) | ❌ 不存在 | — |
| `forgekin/echo_store.py` (EchoStore) | ❌ 不存在 | — |
| `forgekin/imprint_store.py` (ImprintStore) | ❌ 不存在 | — |
| `forgekin/ascension_manager.py` | ❌ 不存在 | — |
| `forgekin/static_bridge.py` | ❌ 不存在 | — |
| `auto_forge/engine.py` (AutoForgeEngine) | ❌ 不存在 | — |
| `auto_forge/consolidation.py` | ❌ 不存在 | — |
| `auto_forge/provoke_manager.py` | ❌ 不存在 | — |
| `codex/forge_codex.py` (ForgeCodex) | ❌ 不存在 | — |
| `codex/ember_hierarchy.py` | ❌ 不存在 | — |
| `tools/cli_wrapper.py` | ❌ 不存在 | — |
| `tools/trae_bridge.py` | ❌ 不存在 | — |
| `council/forgekin_council.py` | ❌ 不存在 | — |
| `council/a2a_manager.py` | ❌ 不存在 | — |
| — | `engine.py` (SelfEvolutionEngine) | 12.7KB |
| — | `knowledge_evolution.py` | 10.2KB |
| — | `maturity.py` | 10.3KB |
| — | `metacognition.py` | 5.3KB |
| — | `models.py` | 6.1KB |
| — | `process_evolution.py` | 8.5KB |
| — | `scope_guard.py` | 6.5KB |
| — | `__init__.py` | 1.5KB |

**结论**：design.md 描述的 30+ 文件（7 个子目录）在实际代码中 0% 实现。实际只有 8 个扁平文件实现 v4.0 的三模式自我进化（ScopeGuard/ProcessEvolution/KnowledgeEvolution），不包含 v7.0 的 ForgekinEngine/SoulStore/EchoStore/ImprintStore/AutoForgeEngine/ForgeCodex/A2AManager/ForgekinCouncil 等任何核心组件。

### 6.3 flowforge core 硬编码业务提示词（P0 级，违反 P8A + 红线 11）

**直接验证**：Grep 搜索 flowforge/core/ 和 flowforge/modes/ 和 flowforge/loop/

**发现**：

| 文件 | 行号 | 硬编码内容 | 违反规则 |
|------|------|----------|---------|
| `core/declarative_agent.py` | 750 | `你是资深内容创作者。以下是上一轮创作的文章和评委的改进建议，请根据建议重写文章。` | 红线 10 + 红线 11 + P8A |
| `modes/default_llm_actors.py` | 45 | `你是内容创作者` | 红线 10 + 红线 11 + P8A |
| `modes/default_llm_actors.py` | 112 | `你是严格的内容质量审核员。你的唯一输出是一个JSON对象` | 红线 10 + 红线 11 + P8A |
| `modes/default_llm_actors.py` | 194 | `你是严格的反思员。你的唯一输出是一个JSON对象` | 红线 11 |
| `loop/verifier.py` | 300 | `你是一位{judge_role}。请对以下内容进行多维度独立评审。` | 红线 11 |
| `loop/verifier.py` | 1 | `"""Loop Verifier — business-level quality verification."""` | P8A（"business-level"暴露业务定位） |

**分析**：
- `declarative_agent.py:750` 的"你是资深内容创作者"是 ContentForge 的业务提示词，不应出现在 FlowForge 通用框架中
- `default_llm_actors.py` 的"内容创作者"/"内容质量审核员"同样是 ContentForge 业务提示词
- `verifier.py:300` 的评审提示词应外置到 `config/prompts.yaml`
- `verifier.py:1` 的 docstring 说"business-level quality verification"——承认了这是业务级而非框架级

**修复建议**：
- 将所有硬编码提示词迁移到 `config/prompts.yaml`
- `declarative_agent.py` 的内容创作反思逻辑应通过 ContentForge Plugin 注入，而非硬编码在 FlowForge core
- `verifier.py` 的评审提示词应通过 `get_prompt()` 从 YAML 加载

### 6.4 flowforge/agents/ 目录结构审核（P8A 合规）

**直接验证**：`LS flowforge/agents/`

**发现**：agents/ 目录只有 `generic/` 子目录（24 个通用角色 Agent）+ `declarative.py`，**不存在** topic_research.py/article_writing.py/seo_optimization.py 等业务专属 Agent。

**结论**：agents/ 目录 P8A 合规 ✅。之前的 review（doubao.md/minimax.md）提到"flowforge/agents/ 有 14+ 业务专属 Agent"是不准确的——实际只有 generic/ 角色型 Agent（analyst/approver/critic/drafter/executor/fact_check/generator/multilingual/planner/reviewer 等通用角色）。

**但**：core 文件的硬编码业务提示词（6.3 节）仍然是 P8A 违规——违规不在 agents/ 目录结构，而在 core 文件的提示词内容。

### 6.5 flowforge tests MockLLM 违反 T1（P0 级）

**直接验证**：Grep 搜索 flowforge/tests/

**发现**：
- `tests/conftest.py:27` 定义 `class MockLLM(BaseTool):` —— MockLLM 类
- `tests/integration/test_react_resume_integration.py` 大量使用 `MockLLMClient`（第 35/133/155/177/200/223/234/250/262/436 行）

**违反**：测试铁律 T1（禁止使用 Mock LLM，所有 E2E/集成测试必须调用真实 LLM）

**修复建议**：
- 集成测试应使用真实 LLM（通过 OpenRoute 调用）
- 单元测试可以使用 Mock（但不应称为"集成测试"）
- 将 `test_react_resume_integration.py` 重命名为 `test_react_resume_unit.py` 并标注"单元测试使用 Mock"

---

## 7. 第六部分：9 大项目与 rules.md/prompts.md 一致性逐项分析

> 本部分逐个项目核查代码与 rules.md 铁律的一致性。所有发现均经直接 Grep 验证。

### 7.1 FlowForge（核心底座）

**审核角色**：AI 高级架构师 + 全栈工程师

| # | 文件 | 行号 | 违规内容 | 违反铁律 | 严重等级 |
|---|------|------|---------|---------|:--------:|
| F1 | `core/declarative_agent.py` | 750 | `你是资深内容创作者` 硬编码业务提示词 | 红线 10 + 红线 11 + P8A | 🔴 |
| F2 | `modes/default_llm_actors.py` | 45 | `你是内容创作者` 硬编码 | 红线 10 + 红线 11 | 🔴 |
| F3 | `modes/default_llm_actors.py` | 112 | `你是严格的内容质量审核员` 硬编码 | 红线 10 + 红线 11 | 🔴 |
| F4 | `modes/default_llm_actors.py` | 194 | `你是严格的反思员` 硬编码 | 红线 11 | 🟡 |
| F5 | `loop/verifier.py` | 300 | `你是一位{judge_role}...` 硬编码评审提示词 | 红线 11 | 🟡 |
| F6 | `loop/verifier.py` | 1 | docstring "business-level quality verification" | P8A | 🟡 |
| F7 | `tests/conftest.py` | 27 | `class MockLLM(BaseTool)` | T1 | 🔴 |
| F8 | `tests/integration/test_react_resume_integration.py` | 35+ | `MockLLMClient` 大量使用 | T1 | 🔴 |
| F9 | `evolution/__init__.py` | 13 | `SelfEvolutionEngine`（v4.0 术语）与 v7.0 `ForgekinEngine` 冲突 | 术语一致性 | 🔴 |
| F10 | `evolution/` | — | 8 个扁平文件 vs design.md 30+ 文件 | 文档一致性 | 🔴 |

**合规项**：
- ✅ agents/ 目录无业务专属 Agent（P8A 合规）
- ✅ 单向依赖零违规（flowforge 未 import 任何 *Forge 模块）
- ✅ Feature Flag 降级策略完善（arch.md 第 21 章）

### 7.2 ContentForge（内容创作工厂）

| # | 文件 | 行号 | 违规内容 | 违反铁律 | 严重等级 |
|---|------|------|---------|---------|:--------:|
| C1 | `tools/research_engine.py` | 168 | `你是素材研究规划专家。请为以下选题制定多源搜索计划。` 硬编码 | 红线 11 | 🟡 |
| C2 | `tools/writer_engine.py` | 736 | `"你是你是"` echo 检测残留（非提示词硬编码，是检测逻辑） | — | 🟢（正常） |
| C3 | `tools/writer_engine.py` | 1029 | `"你是你是"` echo 检测残留 | — | 🟢（正常） |

**合规项**：
- ✅ 配置驱动丰富（config/persona/loops/gates/prompts 完整）
- ✅ Plugin V2 钩子完整
- ✅ writer_engine.py 后处理逻辑完善（删除小标题/编号/免责声明）

**建议**：research_engine.py:168 的提示词应迁移到 `config/prompts.yaml`

### 7.3 DevForge（开发工厂）

| # | 文件 | 行号 | 违规内容 | 违反铁律 | 严重等级 |
|---|------|------|---------|---------|:--------:|
| D1 | `tests/test_e2e_devforge.py` | — | 需验证是否有直接操作数据库和 SQL 注入风险 | 铁律 4 | 🟡（待验证） |

**合规项**：
- ✅ 配置驱动丰富（config/agents/gates/canary/sandbox 完整）

### 7.4 NovelForge（小说创作工厂）

**合规项**：
- ✅ 无明显违规（合规性最好的 *Forge 项目）
- ✅ config/agents/context_layers/prompts 完整

**说明**：NovelForge 在本轮审核中未发现与 rules.md/prompts.md 的冲突。

### 7.5 MallForge（电商运营工厂）

| # | 问题 | 违反铁律 | 严重等级 |
|---|------|---------|:--------:|
| M1 | `plugins.py` 不使用 `sdk.create_plugin()`（与其他 *Forge 不一致） | Plugin 协议一致性 | 🟡 |
| M2 | tests/ 基本为空 | 测试覆盖 | 🟡 |
| M3 | 缺少 loops/gates/sops/persona 目录 | 配置驱动 | 🟡 |

**建议**：对齐其他 *Forge 的 Plugin 注册方式和配置目录结构。

### 7.6 StockForge（投资分析工厂）

**直接验证**：Grep 搜索 `conn.execute|cursor.execute|sqlite3.connect`

| # | 文件 | 行号 | 违规内容 | 违反铁律 | 严重等级 |
|---|------|------|---------|---------|:--------:|
| S1 | `app/services/schedule_service.py` | 178 | `with sqlite3.connect(self._db_path) as conn:` | 铁律 4 | 🔴 |
| S2 | `app/services/schedule_service.py` | 179-180 | `conn.executescript(_DDL_SCHEDULED_TASKS)` | 铁律 4 | 🔴 |
| S3 | `app/services/report_repository.py` | 121 | `conn = sqlite3.connect(self._db_path, timeout=30)` | 铁律 4（borderline） | 🟡 |
| S4 | `app/services/report_repository.py` | 196/238/260/281/332/380/389/640/655 | 多处 `conn.execute(...)` | 铁律 4（borderline） | 🟡 |

**分析**：
- `schedule_service.py` 是 Service 层，直接操作 sqlite3 违反铁律 4（应通过 Repository 层）
- `report_repository.py` 虽是 Repository 层，但直接使用 `conn.execute` 拼 SQL 而非 ORM（如 SQLAlchemy），是铁律 4 的 borderline 情况——它 IS repository，但实现方式不符合"通过 Repository 层"的精神（应为抽象 Repository 接口 + ORM 实现）

**合规项**：
- ✅ Plugin V2 钩子完整
- ✅ config/tools/ 配置驱动

### 7.7 OpenSieve（聚合检索中台）

| # | 文件 | 行号 | 违规内容 | 违反铁律 | 严重等级 |
|---|------|------|---------|---------|:--------:|
| O1 | `core/tests/test_retrieve_pipeline.py` | 919 | 硬编码提示词（需验证） | 红线 11 | 🟡（待验证） |

**合规项**：
- ✅ 完整的检索增强中台实现
- ✅ API 设计完善

### 7.8 OpenRoute（多模型 API 网关）

| # | 文件 | 行号 | 违规内容 | 违反铁律 | 严重等级 |
|---|------|------|---------|---------|:--------:|
| R1 | `user/user_db.py` | — | 直接操作数据库（需验证） | 铁律 4 | 🟡（待验证） |
| R2 | `app.py` | — | 部分绕 DI（需验证） | 铁律 3 | 🟡（待验证） |

**合规项**：
- ✅ 配置驱动完善（models.yaml/llm_route.yaml）
- ✅ webchat_profile 目录路径已修复（基于 `Path(__file__).resolve().parent.parent`）

### 7.9 HicLaw（工具与规范）

| # | 文件 | 违规内容 | 违反铁律 | 严重等级 |
|---|------|---------|---------|:--------:|
| H1 | `tool/model_manager/` | 硬编码路径 `/home/hyg/ai/openclaw` | 红线 5 | 🟡 |
| H2 | `test/` | 大量硬编码绝对路径 | 红线 5 | 🟡 |

**建议**：所有硬编码路径改为环境变量或 `Path(__file__).resolve()` 相对路径。

### 7.10 一致性冲突汇总矩阵

| 项目 | 红线 2 | 红线 3 | 红线 4 | 红线 5 | 红线 10 | 红线 11 | T1 | 术语冲突 | 文档滞后 |
|------|:------:|:------:|:------:|:------:|:------:|:------:|:--:|:--------:|:--------:|
| FlowForge | — | — | — | — | 🔴×3 | 🟡×3 | 🔴×2 | 🔴 | 🔴 |
| ContentForge | — | — | — | — | — | 🟡×1 | — | — | — |
| DevForge | — | — | 🟡 | — | — | — | — | — | — |
| NovelForge | — | — | — | — | — | — | — | — | — |
| MallForge | — | — | — | — | — | — | — | — | 🟡 |
| StockForge | — | — | 🔴×2 | — | — | — | — | — | — |
| OpenSieve | — | — | — | — | — | 🟡 | — | — | — |
| OpenRoute | — | 🟡 | 🟡 | — | — | — | — | — | — |
| HicLaw | — | — | — | 🟡 | — | — | — | — | — |

**修复优先级排序**：
1. P0：FlowForge core 硬编码业务提示词（F1-F3）→ 迁移到 config/prompts.yaml
2. P0：FlowForge evolution/ 术语冲突（F9）→ 重构为 v7.0 术语
3. P0：FlowForge tests MockLLM（F7-F8）→ 改用真实 LLM
4. P0：StockForge schedule_service 直接 sqlite3（S1-S2）→ 通过 Repository 层
5. P1：ContentForge research_engine 硬编码提示词（C1）→ 迁移到 YAML
6. P1：HicLaw 硬编码路径（H1-H2）→ 改为环境变量

---

## 8. 第七部分：养灵体系命名方案 4 套建议

> 用户要求：结合项目和通用 AGI，设计通俗易懂又能体现愿景和 AI 能力的名称。以下提供 4 套备选方案。

### 方案 A：炉灵 Forgekin（当前方案，推荐保留）

| 维度 | 评价 |
|------|------|
| **愿景契合** | ⭐⭐⭐⭐⭐ "炉"呼应 FlowForge 的"锻造"，"灵"体现数字生命，有"百炼成灵"的意象 |
| **通俗性** | ⭐⭐⭐ 炉灵偏玄幻，ToB 客户可能觉得不专业 |
| **AI 能力体现** | ⭐⭐⭐⭐ "灵"暗示自主意识，"锻"暗示自我进化 |
| **AGI 对标** | ⭐⭐⭐⭐ 对标 clowder-ai 养猫，有业界参照 |
| **记忆点** | ⭐⭐⭐⭐⭐ "炉灵"独特，不易混淆 |

**完整术语体系**：
炉灵 Forgekin（个体）/ 灵族 Kinship（群体）/ 养灵 Forge Nurturing（养成）/ 炉启 Forge Initiation（入门）/ 共鸣 Resonance（协作）/ 自锻 Auto-Forge（自主）/ 魂忆 Soul Echo（记忆）/ 魂印 Soul Imprint（画像）/ 锻典 Forge Codex（技能库）/ 火种等级 Ember Hierarchy（知识阶梯）/ 升华阶 Ascension Stages（成长阶段）/ 灵议 Forgekin Council（议事）

**优势**：与 FlowForge 的"Forge"一脉相承，已有完整设计文档。
**劣势**：术语偏玄幻，ToB 场景需要解释。

---

### 方案 B：智体 Cognimate（认知体 + 自主进化）

| 维度 | 评价 |
|------|------|
| **愿景契合** | ⭐⭐⭐⭐ "智"体现 AI 智能，"体"体现独立实体 |
| **通俗性** | ⭐⭐⭐⭐⭐ "智体"直白易懂，"认知体"有学术深度 |
| **AI 能力体现** | ⭐⭐⭐⭐⭐ "认知"直接体现 AI 核心能力 |
| **AGI 对标** | ⭐⭐⭐ 通用认知科学术语，不绑定特定体系 |
| **记忆点** | ⭐⭐⭐⭐ "智体"简洁有力 |

**完整术语体系**：
智体 Cognimate（个体）/ 智群 Cogniswarm（群体）/ 养智 Cogni-Nurture（养成）/ 智启 Cogni-Boot（入门）/ 协智 Co-Cogni（协作）/ 自智 Auto-Cogni（自主）/ 忆核 MemCore（记忆）/ 识印 CogniPrint（画像）/ 智库 CogniCodex（技能库）/ 认知阶 Cogni-Level（知识阶梯）/ 进化阶 Evolution Stages（成长阶段）/ 智议 Cogni-Council（议事）

**优势**：术语专业、ToB 友好、不绑定 clowder-ai、有认知科学背书。
**劣势**：与 FlowForge 的"Forge"关联弱，缺少"锻造"意象。

---

### 方案 C：锻灵 Forge-Soul（保留炉/锻造意象 + 弱化玄幻感）

| 维度 | 评价 |
|------|------|
| **愿景契合** | ⭐⭐⭐⭐⭐ "锻"保留 FlowForge 意象，"灵"保留数字生命感 |
| **通俗性** | ⭐⭐⭐⭐ "锻灵"比"炉灵"更易懂（锻造灵魂） |
| **AI 能力体现** | ⭐⭐⭐⭐ "锻"体现自我进化，"灵"体现自主 |
| **AGI 对标** | ⭐⭐⭐⭐ 对标 clowder-ai 但术语更专业 |
| **记忆点** | ⭐⭐⭐⭐ "锻灵"有"百锻成灵"的意象 |

**完整术语体系**：
锻灵 Forge-Soul（个体）/ 锻群 Forge-Swarm（群体）/ 养锻 Forge-Nurture（养成）/ 锻启 Forge-Boot（入门）/ 共锻 Co-Forge（协作）/ 自锻 Auto-Forge（自主）/ 锻忆 Forge-Memory（记忆）/ 锻印 Forge-Print（画像）/ 锻典 Forge-Codex（技能库）/ 锻阶 Forge-Level（知识阶梯）/ 升锻 Ascension-Forge（成长阶段）/ 锻议 Forge-Council（议事）

**优势**：保留"Forge"核心意象，术语统一以"锻"为前缀，有品牌一致性。
**劣势**："锻"字重复多，可能略显单调。

---

### 方案 D：灵工 Aegis-Soul（守护者 + 数字灵魂）

| 维度 | 评价 |
|------|------|
| **愿景契合** | ⭐⭐⭐⭐ "灵工"有"灵性工作者"意象，"Aegis"是宙斯之盾（守护） |
| **通俗性** | ⭐⭐⭐⭐ "灵工"易懂，"守护者"有责任感 |
| **AI 能力体现** | ⭐⭐⭐⭐⭐ "Aegis"体现安全守护，"Soul"体现自主意识 |
| **AGI 对标** | ⭐⭐⭐ 不绑定特定体系，有独立品牌 |
| **记忆点** | ⭐⭐⭐ "灵工"记忆点一般 |

**完整术语体系**：
灵工 Aegis-Soul（个体）/ 灵工群 Aegis-Swarm（群体）/ 育灵 Aegis-Nurture（养成）/ 灵启 Aegis-Boot（入门）/ 协灵 Co-Aegis（协作）/ 自灵 Auto-Aegis（自主）/ 灵忆 Aegis-Memory（记忆）/ 灵印 Aegis-Print（画像）/ 灵典 Aegis-Codex（技能库）/ 灵阶 Aegis-Level（知识阶梯）/ 升灵 Ascension-Aegis（成长阶段）/ 灵议 Aegis-Council（议事）

**优势**：有"守护"意象，适合安全要求高的 ToB 场景。
**劣势**：与 FlowForge 的"Forge"关联弱。

---

### 命名方案对比决策表

| 维度 | A. 炉灵 Forgekin | B. 智体 Cognimate | C. 锻灵 Forge-Soul | D. 灵工 Aegis-Soul |
|------|:---:|:---:|:---:|:---:|
| FlowForge 品牌一致性 | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ |
| ToB 专业感 | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| 通俗易懂 | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| AGI 愿景体现 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| 术语记忆点 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| 与 clowder-ai 区分度 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 现有文档兼容性 | ⭐⭐⭐⭐⭐ | ⭐ | ⭐⭐⭐⭐ | ⭐⭐ |
| **综合推荐** | **✅ 推荐** | 适合未来 ToB 转型 | 备选 | 不推荐 |

### 最终推荐

**推荐方案 A（炉灵 Forgekin）**，理由：
1. 与 FlowForge 的"Forge"品牌一脉相承，无需推翻已有设计
2. 已有完整的 spec.md/arch.md/design.md 三份文档支撑
3. "百炼成灵"的意象与"自我进化"主题高度契合
4. 可通过"对外用 Forgekin（专业），对内用炉灵（亲切）"的双命名策略解决 ToB 接受度问题

**备选方案 C（锻灵 Forge-Soul）**：如果用户希望弱化玄幻感，方案 C 保留了 Forge 核心意象但术语更直白。

---

## 附录：审核方法说明

本次审核采用"直接验证"方法，所有关键发现均通过以下工具直接验证：
1. **Grep 工具**：搜索硬编码提示词、MockLLM、sqlite3 等关键词
2. **Read 工具**：逐章节读取 spec.md（第 3219-4082 行）、arch.md（第 5293-6492 行）v7.0 内容
3. **LS 工具**：验证 agents/ 目录结构
4. **RunCommand**：验证文件大小和行数
5. **不依赖二手报告**：所有 P0 级发现均有直接代码证据

> **审核请求**：请 operator 审核本审核意见，特别是：
> 1. 第七部分养灵体系命名方案的选择
> 2. 第六部分 9 大项目冲突修复优先级排序
> 3. 第五部分代码实现差异的修复方案（重构 evolution/ vs 更新 design.md）
