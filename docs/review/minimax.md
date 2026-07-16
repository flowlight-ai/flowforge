# FlowForge v7.0 自我进化与养灵体系 — 六方联合深度复审意见（minimax 团队 第三轮）

> **审核日期**：2026-07-15
> **审核范围（扩大版）**：
> - `flowforge/docs/spec.md`（v2.1 → v7.0 炉灵养成体系）
> - `flowforge/docs/arch.md`（v6.0 → v7.0 七层架构）
> - `flowforge/docs/design.md`（v6.0 详细设计 + 第五部分 v7.0 进化能力详设）
> - `flowforge/docs/face/{spec_face, arch_face, task_face, face}.md`（v3.0 大厂面试进化需求）
> - `flowforge/evolution/` 实际代码（8 个模块）
> - `flowforge/a2a/` 实际代码（A2A 协议实现）
> - `hiclaw/rules.md` v3.0（最高优先级，2026-06-28 更新）
> - `hiclaw/prompts.md`（P8A 铁律 + T1-T8 测试铁律 + P14A 全量扫描）
> - **9 大项目**文档/代码与 rules.md/prompts.md 一致性（hiclaw/openroute、opensieve、openclaw/content、flowforge、contentforge、devforge、novelforge、mallforge、stockforge）
>
> **审核团队**：AI 智能体产品专家 / AI 高级架构师 / AI 智能体 Agent 开发工程师 / 高级软件全栈工程师 / 产品总监 / 技术 VP
>
> **本轮特点**：相对 `doubao.md` 第二轮审核，本轮（第三轮）的核心增量是：
> 1. **9 大项目一致性逐项核查**（用户重点要求）
> 2. **养灵体系命名方案 5 套**（用户重点要求）
> 3. **代码实现与设计文档差异量化**（design.md 描述的 evolution/ 30+ 文件，实际只有 8 个）
> 4. **架构层数冲突的具体路径选择**（八层 vs 合并 vs 替换）

---

## 目录

1. [总体评价与核心结论](#1-总体评价与核心结论)
2. [第一部分：v7.0 炉灵养成体系设计深度审核](#2-第一部分v70-炉灵养成体系设计深度审核)
3. [第二部分：v3.0-face 进化需求设计深度审核](#3-第二部分v30-face-进化需求设计深度审核)
4. [第三部分：9 大项目与 rules.md/prompts.md 一致性冲突逐项分析](#4-第三部分9-大项目与-rulesmdprompts-md-一致性冲突逐项分析)
5. [第四部分：代码实现与设计文档差异量化分析](#5-第四部分代码实现与设计文档差异量化分析)
6. [第五部分：养灵体系命名方案 5 套建议](#6-第五部分养灵体系命名方案-5-套建议)

---

## 1. 总体评价与核心结论

### 1.1 总体评分

| 维度 | 评分(10分制) | 评价 |
|------|:------------:|------|
| **产品愿景与定位** | 8.5 | "从驾驭到养成"的范式跃迁吸引人，但术语边界与 clowder-ai 养猫强绑定，可替代性弱 |
| **架构设计合理性** | 7.0 | 七层架构清晰，但 v3.0-face 的"互联层"与 v7.0 的"自进化层"在第 7 层定义上直接冲突 |
| **技术可行性** | 6.0 | 核心概念可行但代码实现严重滞后（design.md 描述 30+ 文件，实际 8 个），存在"文档驱动型幻觉"风险 |
| **文档完整性** | 6.0 | spec.md/arch.md/design.md/face/ 多版本并存，权威源未明确 |
| **与现有体系兼容性** | 5.5 | 与 LoopExecutor/FeedbackLoop/Harness 护栏存在显著功能重叠，分工不清 |
| **配置驱动合规性（P8A）** | 5.0 | FlowForge 自身 agents/ 目录存在 14+ 业务专属 Agent，严重违反 P8A 铁律 |
| **与 9 大项目一致性** | 5.0 | 多处文档/代码与 rules.md/prompts.md 不一致，需逐项修复 |
| **测试可验证性** | 4.5 | 炉灵体系缺少测试策略，"自我进化"如何验证是核心难题 |

### 1.2 核心发现（Top 12 严重问题）

| # | 严重等级 | 问题描述 | 涉及文档 | 建议优先级 |
|---|:--------:|----------|---------|:----------:|
| 1 | 🔴 致命 | **代码实现严重滞后**：design.md 第十五章描述 evolution/ 模块 30+ 文件，实际 flowforge/evolution/ 只有 8 个文件，无 forgekin/auto_forge/codex/council 子目录 | design.md / flowforge/evolution/ | P0 |
| 2 | 🔴 致命 | **架构层数第 7 层冲突未解决**：v3.0-face "七层 = 六层 + 互联层" vs v7.0 "七层 = 六层 + 自进化层" | arch.md / arch_face.md | P0 |
| 3 | 🔴 致命 | **M18-M20 删除不彻底**：face/spec_face.md 仍有"G18 v3.0能力与v7.0炉灵体系融合路径不清 → M18-M20 融合"（第 156 行），且 spec_face 第 1.3 节明确将 M18-M20 列为 v3.0 三大子目标之一 | spec_face.md / project_memory | P0 |
| 4 | 🟠 严重 | **FlowForge 通用框架违反 P8A 铁律**：flowforge/agents/ 目录仍有 14+ 业务专属 Agent（topic_research/article_writing/seo_optimization/fact_check/publishing/multilingual/code_writer_agent 等） | flowforge/agents/ / rules.md P8A | P0 |
| 5 | 🟠 严重 | **ForgekinEngine vs LoopExecutor 关系未定义**：v2.1 已有 LoopExecutor（P/W/V/R/M 五步），v7.0 又有 ForgekinEngine（10 步闭环），两者 70% 功能重叠 | spec.md / arch.md | P0 |
| 6 | 🟠 严重 | **v3.0-face M9 Cost 与现有 model_service 重复**：arch_face.md 设计 M9 Cost 优化，但 flowforge 已有 model_service.py，且 project_memory 记录有"健康检查探测 URL 必须用 .removesuffix("/v1")"的修复 | arch_face.md / flowforge/core/model_service.py | P1 |
| 7 | 🟠 严重 | **v3.0-face M5 OTel 与现有 tracing 系统并存**：spec_face.md M5 设计 OTel GenAI 全量改造，但 flowforge/core/tracing.py 已有 get_logger 系统 | spec_face.md / flowforge/core/tracing.py | P1 |
| 8 | 🟠 严重 | **v3.0-face M4 Guardrails 与 v7.0 SR-01~08 关系模糊**：M4 六层 Guardrails 与 spec.md 第七章 8 条安全红线（SR-01~08）功能大量重叠 | spec.md / spec_face.md | P1 |
| 9 | 🟡 中等 | **自进化层（v7.0）与 Harness 层（v2.1）边界不清**：Harness 已有 FeedbackLoop + EntropyManager（v2.1 第 4 层），自进化层（v7.0 第 7 层）又有 Auto-Forge 规则进化器，职责重叠 | spec.md / arch.md | P1 |
| 10 | 🟡 中等 | **升华阶段 E1-E6 判定标准不可操作**：spec.md 第 7.4 节只有晋升条件（≥2 个 episode 等），无降级检测频率、自动降级触发器、跨平台一致性保证 | spec.md 第 7.4 节 | P1 |
| 11 | 🟡 中等 | **Soul Echo 三层记忆的存储实现未指定**：spec.md 第 8.2 节给出 3 层结构（L1 Working/L2 Episode/L3 Semantic），但 storage backend（SQLite vs 向量库 vs Redis）未设计 | spec.md / design.md | P2 |
| 12 | 🟡 中等 | **v3.0 M18-M20 与 v7.0 融合表述混乱**：spec_face.md 反复出现 M18/M19/M20，但 task_face.md 第 190-194 行又说"M1-M17 已完美融入 v7.0... 不再重复定义"，自相矛盾 | spec_face.md / task_face.md | P0 |

### 1.3 三个核心矛盾点

```
矛盾1：v3.0-face vs v7.0 架构层数冲突
  ┌──────────────────────────────────────────────────────┐
  │  v2.1 六层 (基础)                                     │
  │  ↓                                                    │
  │  v3.0-face: 七层 = 六层 + 互联层（第7层=互联层）         │
  │  v7.0     : 七层 = 六层 + 自进化层（第7层=自进化层）     │
  │                                                       │
  │  → 解决方案 A：八层架构（互联层+自进化层分开）           │
  │  → 解决方案 B：互联层下沉为接入层扩展                   │
  │  → 解决方案 C：自进化层作为"贯穿层"（cross-cutting）    │
  └──────────────────────────────────────────────────────┘

矛盾2：LoopExecutor vs ForgekinEngine 重复实现
  ┌──────────────────────────────────────────────────────┐
  │  LoopExecutor (v2.1)  ForgekinEngine (v7.0)          │
  │  ─────────────────    ────────────────────            │
  │  Planner           → (soul.persona)                  │
  │  Worker            → (delegate_to_static)            │
  │  Verifier          → (verifier)                      │
  │  Reflector         → (reflector + soul_imprint)      │
  │  Memory            → (soul_echo)                     │
  │  5 步              → 10 步                            │
  │  无 Soul Profile   → soul profile 注入                │
  │  无 Auto-Forge     → auto_forge 步骤                  │
  │  无 Forge Codex    → forge_codex 步骤                 │
  │                                                       │
  │  → 80% 重叠，20% 新增                                  │
  └──────────────────────────────────────────────────────┘

矛盾3：evolution/ 模块代码 vs 设计严重不符
  ┌──────────────────────────────────────────────────────┐
  │  design.md 第十五章描述：                              │
  │  evolution/                                           │
  │  ├── forgekin/  (engine/soul_profile/echo_store/      │
  │  │                imprint_store/episode/              │
  │  │                ascension_manager/static_bridge)    │
  │  ├── auto_forge/ (engine/consolidation/surface/       │
  │  │                provoke_manager/group_forge/        │
  │  │                diary_store/connection_drawer)       │
  │  ├── codex/ (forge_codex/knowledge_object/            │
  │  │           ember_hierarchy/distiller/eval_ledger/   │
  │  │           skill_generator/meta_cognition)          │
  │  ├── tools/ (bridge/cli_wrapper/trae_bridge/          │
  │  │           worktree_manager/audit_logger)            │
  │  ├── council/ (forgekin_council/a2a_manager/          │
  │  │             a2a_message/channels/)                  │
  │  ├── security/ (forgekin_guard/meta_cognition_guard)  │
  │  └── api/ (forgekin/council/auto_forge/codex/          │
  │           bridge endpoints)                            │
  │  → 共 30+ 文件                                       │
  │                                                       │
  │  flowforge/evolution/ 实际：                          │
  │  ├── __init__.py                                      │
  │  ├── engine.py (SelfEvolutionEngine，融合三模式)        │
  │  ├── knowledge_evolution.py (Mode C)                   │
  │  ├── maturity.py (KnowledgeMaturityLadder)             │
  │  ├── metacognition.py (MetacognitionRouter)             │
  │  ├── models.py (Pydantic 数据模型)                     │
  │  ├── process_evolution.py (Mode B)                     │
  │  └── scope_guard.py (Mode A)                          │
  │  → 共 8 个文件，且无 forgekin/auto_forge/codex/         │
  │     council 子目录                                    │
  │                                                       │
  │  → 缺失 75% 的设计模块                                 │
  └──────────────────────────────────────────────────────┘
```

---

## 2. 第一部分：v7.0 炉灵养成体系设计深度审核

### 2.1 产品定位审核

#### 2.1.1 优势点

1. **范式跃迁吸引力强**：从"驾驭野兽"到"养成灵体"的概念升级，类比"养猫"（clowder-ai）、"养宠物"，用户情感连接度更高。
2. **核心公式升级合理**：`Agent = Model + Harness + Soul` 比 v2.1 的 `Model + Harness` 更完整，"灵魂"包含了 persona/voice/worldview/values 三层人格。
3. **升华阶段（E1-E6）游戏化设计**：Spark→Ember→Flame→Blaze→Inferno→Forge Master 的进阶体系，类似游戏职业等级，激发用户养成欲。
4. **与 clowder-ai 的对标精确**：Forgekin↔Cat、Kinship↔Clowder、Auto-Forge↔Auto-Dream、Soul Echo↔Memory 等 12 项核心概念对标清晰。

#### 2.1.2 问题与建议

**问题1：术语"养灵"过于依赖 clowder-ai 私有概念**

- spec.md 第 7.2 节大量直接对标 clowder-ai（"Cat/Clowder/Bootcamp/Swarm/Auto-Dream"等）
- 一旦 clowder-ai 项目方向调整或停止维护，FlowForge 的整套养灵体系将失去参照系
- 用户和开发者需要同时理解两套术语体系（养灵 + 养猫）

**建议**：

- 将 clowder-ai 对标从"必要项"降级为"参考项"，在 spec.md 中标注"参考 clowder-ai 养猫体系，独立演化为养灵体系"
- 养灵体系的核心术语（炉灵/灵族/魂忆/魂印/锻典/灵议/升华阶）必须有自洽的定义，不依赖 clowder-ai 才能理解
- 详见第六部分 5 套命名方案

**问题2：定位表述前后不一致**

- spec.md 第 1 章写"v2.1 Agent Harness 平台"，第 7 章突然跳到"v7.0 炉灵养成体系"
- 文档头标注版本"v2.1"，内容却包含 v7.0 全部新增
- 第 7 章之前完全没有铺垫 v7.0 概念，读者会困惑当前文档到底是 v2.1 还是 v7.0

**建议**：

- 在文档开头明确"本文档包含 v2.1 基础规格 + v7.0 炉灵体系扩展"（doubao.md 审核中已建议）
- 或拆分为 `spec_v2.md`（基础 Harness）和 `spec_v7.md`（炉灵体系）
- spec.md 第七章前增加"第七~十三章为 v7.0 新增内容，与 v2.1 部分不冲突"的明确标识

**问题3：炉灵商业化路径未设计**

- 炉灵如何卖给客户？按个卖？按能力卖？按调用次数卖？
- 炉灵的能力如何定价？E1 和 E6 价值差异如何量化？
- 炉灵之间的协作如何计费？
- 用户能否拥有炉灵的所有权？

**建议**：

- 在 spec.md 第八章后增加"v7.0 商业化模型"章节
- 设计炉灵计费维度：基础订阅（按 forgekin 数量）+ 能力升级（按 E 阶）+ 协作调用（按 Forgekin Council 次数）
- 升华阶段与商业价值映射：E1-E2 基础、E3-E4 进阶、E5-E6 高端

---

### 2.2 七层架构审核

#### 2.2.1 架构设计核心问题

**问题1：第 7 层定义冲突（v3.0-face vs v7.0）🔴 P0**

两份文档都声称自己是"七层架构"，但第 7 层完全不同：

| 文档 | 第 7 层 | 内容 | 核心能力 |
|------|---------|------|----------|
| **arch.md 第 17 节（v6.0+v7.0）** | 共享 6 层 | 无明确第 7 层 | v7.0 模块分散在 5/6 层 |
| **arch_face.md 第 1.1 节（v3.0-face）** | **互联层** | A2A Server/Client、ACP、Agent Directory | 跨厂互联 |
| **spec.md 第七章（v7.0）** | **自进化层** | ForgekinEngine / Auto-Forge / Soul Echo / 灵议 | 自我进化 |

**根因分析**：

- v3.0-face 团队和 v7.0 团队各自独立设计了第 7 层
- 都在 v2.1 六层基础上加一层，导致"两个第 7 层"的尴尬局面
- 实际上需要**八层架构**，或者将其中一层下移/合并

**三种解决方案对比**：

| 方案 | 描述 | 优点 | 缺点 | 推荐度 |
|------|------|------|------|:------:|
| **A 八层架构** | 自进化层(7) + 互联层(8) = 八层 | 概念清晰，各司其职 | 层数过多，宣传压力大 | ⭐⭐⭐ |
| **B 合并为"进化互联层"** | 将 A2A/MCP 能力纳入自进化层的"外部进化"维度 | 保持 7 层 | 互联层不只服务自进化，概念模糊 | ⭐⭐ |
| **C 互联层下移为接入层扩展** | 互联层是接入层（5）的增强 | 保持 6+1=7 | 低估 A2A 战略地位 | ⭐⭐ |

**推荐方案 A（八层架构）**，理由：

1. 自进化（纵向能力提升）和互联（横向生态扩展）是两个完全不同维度的能力
2. 强行合并会导致概念混乱，"互联"在自进化中只是"外部进化"，但实际互联能力远不止于此
3. "八层架构"反而可以作为差异化卖点——比别人多一层思考
4. 业界主流框架（LangGraph/CrewAI/AutoGen）都是 4-5 层，8 层本身就是壁垒

**建议落地路径**：

```yaml
# 方案 A 八层架构实施步骤
step_1: 在 spec.md 第 2.1 节明确"v7.0 八层架构：基础设施/能力/执行引擎/
        Harness/接入/应用/互联/自进化"
step_2: 在 arch.md 新增"第 18 章 八层架构完整图"
step_3: 修改 arch_face.md 第 1.1 节，统一为八层
step_4: 修改 spec_face.md 3.1 节，统一为八层
step_5: 更新所有架构示意图（含 design.md）
```

**问题2：自进化层与 Harness 层边界不清（中等）**

| v2.1 Harness 层 | v7.0 自进化层 | 重叠点 |
|----------------|---------------|--------|
| FeedbackLoop（反馈循环） | ForgekinEngine 的 Verifier/Reflector | 都是质量评估+迭代改进 |
| EntropyManager（熵管理） | Auto-Forge 的规则进化器 | 都是从失败中学习 |
| Skill 系统（v6.0 第 8 章） | Soul Imprint / Forge Codex | 都是技能沉淀与复用 |

**建议**：

明确分工：
- **Harness 层（第 4 层）**：单次任务内的质量控制（前馈+反馈+熵管理），关注"这一次任务做好"
- **自进化层（第 7 层）**：跨任务的能力提升（灵魂成长+技能进化+群体协作），关注"下次任务做得更好"
- **核心区分**：Harness 是**单次闭环**，自进化层是**跨次进化**

用具体例子说明：
```
场景：用户请求写一篇 AI 文章
- Harness 层：上下文工程注入、FeedbackLoop 评分、EntropyManager 检查 → 这一篇文章
- 自进化层：文章完成后生成 Episode、更新 Soul Imprint、尝试蒸馏 Skill → 下次写更好
```

---

### 2.3 ForgekinEngine 设计审核

#### 2.3.1 设计优势

1. **10 步闭环逻辑完整**：arch.md 给出的 10 步流程（加载灵魂→注入魂忆→注入魂印→注入 Soul Profile→选择执行路径→执行→记录 Episode→更新魂印→蒸馏 Skill→检查升华），覆盖了记忆/执行/校验/反思/沉淀的完整生命周期。
2. **Soul Profile 数据结构清晰**：spec.md 第 8.1 节给出完整 Pydantic 模型，包括 soul/capabilities/evolution/metadata 四大维度。
3. **两类智能体无缝衔接**：Static Agent 与 Forgekin 通过 `delegate_to_static()` 单向依赖，避免循环依赖。

#### 2.3.2 问题与建议

**问题1：ForgekinEngine 与 LoopExecutor 关系未定义（P0）**

v2.1 已有 LoopExecutor（Planner→Worker→Verifier→Reflector→Memory 5 步），v7.0 又有 ForgekinEngine 10 步闭环。

**对比分析**：

| 维度 | LoopExecutor (v2.1) | ForgekinEngine (v7.0) |
|------|---------------------|----------------------|
| 定位 | 创作/润色循环执行器 | 炉灵执行引擎 |
| 步骤数 | 5 步（P/W/V/R/M） | 10 步（含 Soul 加载、Auto-Forge、Forge Codex） |
| 记忆 | MemoryManager | Soul Echo（三层记忆） |
| 质量校验 | Verifier + 5 评委 | Verifier + ForgekinCouncil |
| 反思 | Reflector | Reflector + 魂印更新 |
| 技能沉淀 | Skill 系统 | Forge Codex |
| 输入 | loop_name + task_context | forgekin_id + input |

**结论**：80% 重叠，20% 新增。

**建议**（明确演进路径）：

```python
# Phase 6（短期）：ForgekinEngine 包装 LoopExecutor
class ForgekinEngine:
    def __init__(self):
        self.loop_executor = LoopExecutor()  # 复用
    
    async def execute(self, forgekin_id, input, context):
        # 新增：Soul 加载/沉淀
        soul = await self._load_soul(forgekin_id)
        context.state["soul_echo"] = await self._echo.recall(forgekin_id, input)
        # 复用：原 LoopExecutor
        result = await self.loop_executor.run(context)
        # 新增：Soul 更新/技能蒸馏
        await self._imprint.update(forgekin_id, result)
        return result

# Phase 7（中期）：逐步将 LoopExecutor 功能迁移到 ForgekinEngine
# Phase 8（长期）：LoopExecutor 作为兼容接口保留
```

并在 spec.md 第三章（核心功能需求）新增"FR-ENG-XX：ForgekinEngine 与 LoopExecutor 演进路径"。

**问题2：Soul Echo 三层记忆的存储实现未指定（P1）**

spec.md 第 8.2 节给出 L1/L2/L3 三层结构，但未指定 storage backend：

| 层 | 数据特征 | 候选存储 | 推荐 |
|---|---------|---------|------|
| **L1 Working Echo** | 当前会话、流式、临时 | Redis / 内存 | Redis（TTL 自动过期）|
| **L2 Episode Echo** | 最近 100 个 Episode、结构化 | SQLite + 向量索引 | SQLite + sqlite-vec |
| **L3 Semantic Echo** | 无限、永不淘汰、语义检索 | 向量数据库 | Qdrant / Milvus |

**建议**：

```yaml
# config/evolution/soul_echo_storage.yaml
soul_echo:
  L1_working:
    backend: "redis"
    ttl_seconds: 3600
    max_size_mb: 100
  L2_episode:
    backend: "sqlite+sqlite-vec"
    db_path: "data/soul_echo_episodes.db"
    max_episodes: 100
    embedding_model: "bge-m3"
  L3_semantic:
    backend: "qdrant"
    collection: "soul_semantic_echo"
    distance: "cosine"
    auto_compress: true
```

**问题3：升华阶段 E1-E6 判定标准不可操作（P1）**

spec.md 第 7.4 节列出 6 个阶段及晋升条件，但缺少：

- 降级检测频率（每任务检查？每天检查？）
- 自动降级触发器
- 跨平台一致性保证
- 跨 Forgekin 的 E 阶统一标准（contentforge:writer E3 和 devforge:architect E3 是同一水平吗？）

**建议**：

```yaml
# config/evolution/ascension_rules.yaml
ascension:
  # 升级检测
  promotion_check:
    trigger: "after_each_task"  # 每任务后检测
    cooldown: "1h"  # 最短升级间隔
    
  # 降级检测
  demotion_check:
    trigger: "rolling_window"  # 滚动窗口
    window_size: 10  # 最近 10 次
    threshold: 0.5  # 成功率 < 50% 触发降级
    
  # 跨 Forgekin 一致性
  cross_forgekin_equivalence:
    enabled: true
    canonical_tasks:  # 标定任务集
      - "write_3000_word_article"
      - "design_microservice"
      - "design_novel_outline"
    threshold: 0.85  # 相同 E 阶在不同 forgekin 上表现差异 < 15%
```

---

### 2.4 Auto-Forge Engine 设计审核

#### 2.4.1 设计优势

1. **双层架构清晰**：design.md 第五部分给出 Consolidation Layer（后台 system thread）+ Surface Layer（前台日记本+Provoke 气泡）的双层架构，对标 clowder-ai Auto-Dream。
2. **Provoke 频率硬限**：spec.md 第 8.4 节明确"≤1/天，hyperfocus=0，连拍 3 冬眠"，防止打扰用户。
3. **三模式自生成**：design.md 第 8.5-8.6 节给出 Scope Guard / Process Evolution / Knowledge Evolution 三模式，各有触发条件。

#### 2.4.2 问题与建议

**问题1：自指修改的安全边界缺失（严重）**

Auto-Forge 让 Agent 修改自己的 prompt/skill/code，这是非常危险的操作：

- 修改了 prompt 之后，Agent 会不会"变坏"？
- 技能更新引入 bug 如何回滚？
- 会不会出现"退化式进化"——越改越差？

v2.1 的文档园丁是修改外部文档，相对安全；Auto-Forge 是修改 Agent 自身，风险指数级上升。

**建议**（六层安全护栏）：

```yaml
# config/evolution/auto_forge_safety.yaml
auto_forge_safety:
  L1_scope_isolation:
    can_modify: ["forgekin_soul.persona", "skill_drafts"]
    cannot_modify: ["system_core_prompt", "security_rules", "guardrails"]
    
  L2_change_approval:
    high_risk_changes:  # 需 operator 审批
      - "修改 soul.persona"
      - "修改 safety 相关 prompt"
    low_risk_changes:  # 自动生效
      - "新增 skill draft"
      - "更新 episode metadata"
      
  L3_regression_test:
    auto_run_after_change: true
    test_set: "forgekin_regression_v1.jsonl"
    min_pass_rate: 0.95
    
  L4_gradual_rollout:
    canary_percentage: 10  # 新技能先在 10% 任务中试用
    rollout_duration: "24h"
    
  L5_version_rollback:
    auto_snapshot: true
    keep_last_n_versions: 10
    rollback_on_regression: true
    
  L6_drift_detection:
    monitor_metrics: ["success_rate", "quality_score", "latency_p95"]
    drift_threshold: 0.15  # 下降 15% 触发自动回滚
```

**问题2：Forge Codex 缺少技能质量分级（P2）**

技能沉淀到 Forge Codex 后，如何保证质量？

- 是否所有用过一次的技能都要沉淀？
- 如何区分"成熟技能"和"临时技巧"？
- 技能会不会过期？（比如某个 API 变了，旧技能失效）

**建议**：

```
技能分级体系：
T0 Core Skills（核心技能）— 经过 100+ 任务验证，成功率 > 90%
T1 Stable Skills（稳定技能）— 经过 20+ 任务验证，成功率 > 80%
T2 Experimental Skills（实验技能）— 经过 3+ 任务验证，成功率 > 60%
T3 Draft Skills（草稿技能）— 仅 1 次成功，待验证

自动晋级/降级规则：
- 连续成功 N 次 → 自动晋级
- 连续失败 M 次 → 自动降级/废弃
- skill.last_used > 90 天 → 标记 dormant
```

---

### 2.5 ForgekinCouncil 设计审核

#### 2.5.1 设计优势

1. **多智能体治理理念先进**：多个炉灵组成"长老会"共同决策，避免单一智能体的偏见和盲区。
2. **三权分立设计合理**：执行权（Forgekin）/ 审议权（Council）/ 监督权（Auditor）的分离。
3. **多渠道 IM 协作**：design.md 第 15.1 节设计 6 个渠道（WebChat/Feishu/Wechat/Slack/Discord/GitHubPR），覆盖企业主流 IM 工具。

#### 2.5.2 问题与建议

**问题1：投票机制与冲突解决策略缺失（P1）**

多个炉灵意见不一致时怎么办？

- 简单多数票？还是加权投票？（老炉灵权重更高？）
- 出现平票怎么处理？
- 极端情况下（比如 3 个炉灵 3 种不同意见）如何裁决？
- 会不会出现"议而不决"的情况？

**建议**：

```yaml
# config/evolution/council_voting.yaml
council_voting:
  mechanism: "weighted_majority"
  weight_strategy: "ascension_stage"
  weight_table:
    E1: 0.5
    E2: 0.7
    E3: 1.0
    E4: 1.3
    E5: 1.6
    E6: 2.0
  tie_breaker: "oldest_forgekin"
  max_debate_rounds: 3
  fallback: "human_intervention"
  
  # 决策矩阵
  decision_matrix:
    skill_promotion:
      quorum: 0.5  # 50% 委员需参与
      threshold: 0.6  # 60% 同意通过
    high_risk_action:
      quorum: 0.8
      threshold: 0.7
      require_e5_or_above: true
```

**问题2：炉灵之间的通信协议未定义（P2）**

design.md 给出 A2A Manager / A2A Message / A2A Mention 等数据模型，但：

- 消息格式：JSON？Protobuf？纯文本？
- 流式传输：长任务流式中断后如何续传？
- 鉴权：跨厂炉灵如何鉴权？
- 加密：敏感任务是否需要端到端加密？

**建议**：

- 复用 v3.0 M1 A2A 协议（arch_face.md 第 2.1-2.9 节已设计），不要另起炉灶
- 消息格式：JSON + 签名（Bearer Token + HMAC）
- 流式：SSE + Last-Event-ID 断点续传
- 鉴权：复用 M1 A2A 的 Bearer/OAuth2/mTLS 三方案

---

### 2.6 安全红线（SR-01~08）审核

#### 2.6.1 总体评价

8 条安全红线（no-classifier / provider-isolation / provoke-frequency / high-risk-escalation / human-in-the-loop / worktree-isolation / rate-limiting / cross-forge-audit）设计思路正确，覆盖了分类器依赖、供应商隔离、高频滥用、高风险升级、人工把关、环境隔离、速率限制、跨项目审计等关键维度。

#### 2.6.2 问题与建议

**问题1：与 v3.0-face M4 六层 Guardrails 功能高度重叠（严重）**

| v7.0 安全红线 | v3.0-face M4 Guardrails | 重叠内容 |
|--------------|------------------------|----------|
| SR-01 No-Classifier | L2 System Prompt Constraints | 都是 LLM 输入约束 |
| SR-02 Provider-isolation | L3 Tool Allow-lists | 都是工具/资源限制 |
| SR-03 Provoke 频率硬限 | L6 Cost Ceilings | 都是频率/资源限制 |
| SR-04 高风险域升级 | L5 Action Confirmation | 都是高风险操作审批 |
| SR-05 Human-in-the-Loop | L5 Action Confirmation | 都是人工确认 |
| SR-06 Worktree 隔离 | L3 Tool Allow-lists + M2 Sandbox | 都是执行环境隔离 |
| SR-07 Rate-limiting | L6 Cost Ceilings | 都是调用频率限制 |
| SR-08 跨 *Forge 可审计 | M5 OTel + M12 AgentBOM | 都是审计追踪 |

**建议**：

明确层级关系（"宪法"与"具体法律"）：

- **M4 Guardrails（第 4 层 Harness）**：技术实现层，具体的六层检查机制
- **SR 安全红线（第 7 层自进化）**：策略原则层，不可逾越的底线，指导 Guardrails 的配置
- **关系**：Guardrails 的配置必须符合安全红线的要求

在 spec.md 第七章和 spec_face.md M4 章节交叉引用：

```yaml
# spec.md 第七章引用
guardrails_implementation: "see spec_face.md M4 (六层 Guardrails)"

# spec_face.md M4 章节引用
security_constraints: "see spec.md 第七章 SR-01~08 (安全红线)"
```

**问题2：SR-01"禁止使用 Classifier"在实际工程中不可行（中等）**

原文："SR-01: No-Classifier Principle — 禁止依赖 AI 分类器做关键决策，必须有规则/人工兜底"

**问题**：

- 质量门禁（T7 审核）本身就是 LLM-as-Judge，算不算"AI 分类器"？
- 事实核查、AI 痕迹检测都依赖 LLM 判断，这些都不能用了？
- "关键决策"的定义是什么？哪些决策算"关键"？

**建议**：

修正表述为"不单独依赖 Classifier"：

```yaml
SR-01:
  principle: "No-Sole-Classifier"
  rule: |
    关键决策不能仅依赖 AI 分类器，必须同时满足以下至少一项：
    1. 有规则引擎的交叉验证（规则+AI 双判定）
    2. 有人工审核兜底（低风险 AI 自动过，高风险人工审）
    3. 有置信度阈值（置信度>95%才自动过，否则升级人工）
  
  examples_of_critical_decisions:
    - "内容发布（发布/拒绝/编辑）"
    - "Skill 晋升（L2→L3）"
    - "Forgekin 升华（E2→E3）"
    - "高风险 Action 执行"
  
  examples_of_non_critical_decisions:
    - "内部路由选择"
    - "工具调用参数填充"
    - "格式校验"
```

---

## 3. 第二部分：v3.0-face 进化需求设计深度审核

### 3.1 总体评价

v3.0-face 的 17 个模块（M1-M17）设计非常全面，覆盖了 A2A 协议、MCP 升级、上下文工程、Guardrails、可观测性、评估基准、Durable Execution、自我纠错、成本优化、生产部署、HITL、Agent 治理、Computer Use、协议栈、故障恢复、多租户、Skill 市场等工业级 Agent OS 必备能力。

**核心价值**：

1. 基于真实大厂面试信息（face.md），确保需求不脱节于行业实际
2. 每个模块都有明确的背景、需求、设计要点、验收标准
3. 与 v7.0 炉灵体系有融合映射（M18-M20 章节），不是孤立设计

### 3.2 M1 A2A 协议 — 审核意见

#### 优势
- 同时支持 Server 和 Client 模式，定位清晰
- Agent Card / Directory / 联邦查询设计完整（arch_face.md 2.4-2.5 节）
- 三种鉴权方式（Bearer/OAuth2/mTLS）覆盖不同安全级别场景

#### 问题
1. **M1 A2A 是底层协议 vs v7.0 FR-EVO-09 A2A 是应用层协议 — 关系未明**：
   - arch_face.md 2.1 节将 M1 A2A 放在"互联层"
   - spec.md 第 8.9 节（FR-EVO-09）A2A 是炉灵间通信
   - 两层 A2A 是同一套实现还是两套？
2. **缺少消息格式标准定义**：A2A 消息是纯文本？还是有结构化格式？
3. **流式传输的断点续传未考虑**：长任务流式中断后如何续传？

#### 建议
- 明确：M1 A2A 是底层协议实现，FR-EVO-09 是炉灵场景的应用层协议
- FR-EVO-09 复用 M1 A2A 的实现，不另起炉灶
- 补充 A2A 消息格式规范（参考 Google A2A Spec）
- 增加 SSE 流式的续传机制设计（Last-Event-ID）

### 3.3 M2 MCP 2026 升级 — 审核意见

#### 优势
- Stateless Core 设计正确，支持水平扩展
- Tool Result Elision 与 M3 Context Editing 协同，思路清晰
- OAuth Authorization Code Flow 考虑了用户级授权，比全局 API Key 更安全

#### 问题
1. **现有 mcp/ 模块重构工作量评估缺失**：从 v2024 升级到 v2026 RC，现有代码需要改多少？
2. **EMA（企业 MCP 聚合器）定位与 MCP Broker 重复**：arch.md 第 9.1 节已有 MCP Broker（4 层架构），v3.0 又有 EMA，什么关系？
3. **Manifest 自动发现的安全风险**：自动发现并加载外部 MCP Server，会不会引入恶意工具？

#### 建议
- 明确：MCP Broker 是 v2.1/v6.0 的内部多服务器聚合，EMA 是 v3.0 的企业级网关（增加鉴权/审计/限流），EMA 是 Broker 的超集
- Manifest 加载需要经过安全扫描（类似于 npm 包的安全审计）
- 补充迁移计划：v2024 兼容层 → 双版本并行 → 逐步切到 v2026

### 3.4 M3 Context Engineering 2.0 — 审核意见

#### 优势
- JIT（Just-In-Time）按需加载思路正确，解决"上下文硬塞"问题
- Memory Tool 让 LLM 自主管理记忆，符合 Agentic 设计理念
- 五层 Context Layer + 优先级 + lazy 标记，设计精细

#### 问题
1. **与 v7.0 Soul Echo 三层记忆的关系需澄清**：
   - M3 的五层（System/Persona/Task/Working/Episodic）vs Soul Echo 的三层（Working/Episode/Semantic）
   - 是两套独立系统？还是映射关系？
2. **JIT 加载的性能影响**：每次 Agent 需要时才 fetch，会不会增加延迟？
3. **Memory Tool 的滥用风险**：LLM 会不会无限制地保存记忆，导致 Memory 爆炸？

#### 建议
- 明确映射关系：

```
M3 Context Layer     →    Soul Echo 记忆层
─────────────────────────────────────────
System/Persona       →    Soul Profile（灵魂档案，属性层）
Task/Working         →    L1 Working Memory（工作记忆）
Episodic             →    L2 Episode Memory（情景记忆）
Long-term/Semantic   →    L3 Semantic Memory（语义记忆）
```

- 引入预取（Prefetch）机制：根据任务类型预判需要的上下文，提前加载
- Memory Tool 增加配额限制：每个炉灵的记忆总量有上限，旧记忆会被压缩/遗忘

### 3.5 M4 六层 Guardrails — 审核意见（与 v7.0 SR-01~08 关系）

#### 优势
- 六层闭环（前馈三层+后馈三层）设计完整，覆盖输入到输出的全链路
- 每层都有明确的职责和实现思路
- 与现有 PermissionPipeline 等模块的集成点清晰

#### 问题
1. **与 v7.0 SR-01~08 大量重叠**（已在 2.6.2 节详述）
2. **L4 Output Validation 的事实核查调用成本过高**：每个输出都调用 fact_check 工具，时间和成本都很高
3. **L5 Action Confirmation 的多人会签实现复杂**：M-of-N approvers 的实现涉及异步等待、超时处理、通知机制
4. **与 v2.1 FeedbackLoop 的边界不清**：FeedbackLoop 也有四维评分和分类闸门

#### 建议
- 与 SR-01~08 建立"宪法-法律"分层关系（见 2.6.2 节建议）
- Output Validation 分层执行：低风险内容只做格式校验，高风险内容才做完整事实核查
- 多人会签先做简化版（双人审批），复杂的 M-of-N 延后
- 明确：FeedbackLoop 是**业务质量评估**（内容好不好），Guardrails 是**安全合规检查**（有没有违规）

### 3.6 M5 OTel GenAI — 审核意见

#### 优势
- 对齐 OTel GenAI v1.30 标准，方向正确
- 多 Exporter 支持（OTLP/LangSmith/Langfuse/Phoenix），生态兼容好
- Trace 端到端串联设计，可观测性基础扎实

#### 问题
1. **现有代码改造量巨大**：所有 LLM 调用、工具调用、Agent 执行都要加 Span
2. **gen_ai.prompt/completion 属性的隐私问题**：把完整 prompt 和 completion 存到 Span 里
3. **与现有 `core/tracing.py` 的 `get_logger` 系统并存**：现有 tracing 已经自动注入 trace_id，OTel GenAI 是替换还是并存？
4. **与现有 MetricsCollector 的重复建设**：v2.1 已有 MetricsCollector

#### 建议
- 明确：M5 OTel GenAI 是在现有 tracing 之上**叠加** OTel 标准 Span，不替换
- 现有 `tracing.py` 的 `get_logger` 继续承担 trace_id 注入
- gen_ai.* Span 作为新 Span 类型，与现有 LogEvent 并存
- 分阶段实施：先上 LLM 和 Tool 的 Span，再逐步完善 Agent 和 Context 的 Span
- 敏感信息脱敏：prompt 和 completion 中的 PII 数据自动脱敏后再存入 Span

### 3.7 M9 Cost 优化 — 审核意见（与 model_service 重复问题）

#### 优势
- Prompt Caching 设计合理，减少重复 prompt 开销
- Token 预算管理（每会话/每日/每月）符合工业实践
- Provider 配额池设计

#### 问题（严重）🔴

1. **与 flowforge 现有 `core/model_service.py` 大量重复**：
   - flowforge 已有 `model_service.py`，承担模型路由、健康检查、降级容错
   - arch_face.md 又设计 ProviderQuotaManager、TokenBudget、ModelRouter
   - 现有 `model_service.py` 已经实现的部分功能（M9 又设计一遍）：
     - ✅ 路由（已实现）
     - ✅ 健康检查（已实现，project_memory 记录有 `.removesuffix("/v1")` 修复）
     - ✅ Fallback（已实现）
   - M9 新增部分：Token 预算、配额管理、Caching
2. **健康检查探测 URL 处理**：project_memory 明确记录"必须用 .removesuffix('/v1') 而非 .rstrip('/v1')"，但 M9 设计文档未提及此细节

#### 建议
- **M9 与 model_service.py 合并设计**，不要双轨
- model_service.py 已有功能直接复用
- M9 重点扩展：Caching（Prompt Cache）+ Token 预算 + 配额池
- 健康检查逻辑保留 model_service.py 的实现（包含 .removesuffix 修复）

### 3.8 M18-M20 模块删除不彻底问题（P0）

#### 问题描述

**project_memory 明确记录**：
> "自创术语 M18(SelfEvolutionEngine)/M19(MemoryGovernanceManager)/M20(FirstTouchRouter)必须删除"
> "v7.0 术语对齐要求：炉灵/灵族/养灵/魂忆/魂印/自锻/锻典/灵议/升华阶必须使用"

**但 spec_face.md 中仍有大量 M18-M20 的引用**：

| 位置 | 引用内容 |
|------|---------|
| 第 1.3 节 "v3.0 总目标" | 三个子目标之一："为 v7.0 炉灵养成体系提供工程支撑...M1-M17 是 1-6 层，M18-M20 是第 7 层" |
| 第 2.2 节 G18 | "v3.0 能力与 v7.0 炉灵体系融合路径不清 → M18-M20 融合"（P0 优先级） |
| 第三章 3.1 节 | "v7.0 自进化层由 v7.0 炉灵养成体系承接，v3.0 通过 M1-M17 为其提供工程支撑（详见 M18-M20 融合映射章节）" |
| 整章 "M18-M20 v7.0 融合映射" | 详细描述 SelfEvolutionEngine / MemoryGovernanceManager / FirstTouchRouter |

**矛盾点**：
- spec_face.md 第 1.3 节把 M18-M20 列为 v3.0 三大子目标之一
- task_face.md 第 190-194 行又说"M1-M17 已完美融入 v7.0...v7.0 的 FR-EVO-01~15 需求规格在 flowforge/docs/spec.md 第八章中独立定义，不在本任务清单中重复"
- 同一套文档内自相矛盾

#### 建议
1. **立即删除所有 M18/M19/M20 的提法**（spec_face.md / arch_face.md / task_face.md）
2. 将 G18 重新表述为"G18 v3.0 能力与 v7.0 炉灵体系融合路径不清 → 详见 spec.md 第八章 FR-EVO-01~15"
3. 第 1.3 节三大子目标改为：
   - 工业级 Agent OS
   - Agent 互联网节点
   - **v7.0 炉灵体系工程支撑**（v3.0 M1-M17 是 v7.0 七层架构第 1-6 层的工程实现）
4. 第三章 3.1 节删除"详见 M18-M20 融合映射章节"引用，改为"详见 spec.md 第八章"
5. 删除整个"M18-M20 v7.0 融合映射"章节

---

## 4. 第三部分：9 大项目与 rules.md/prompts.md 一致性冲突逐项分析

> **本节为重点章节**，按项目逐项列出与 rules.md v3.0 / prompts.md 关键模板的冲突点，每项给出修复建议。

### 4.1 FlowForge 一致性检查

#### 冲突 F-01：flowforge/agents/ 目录存在 14+ 业务专属 Agent（违反 P8A）🔴

**铁律原文（rules.md §1.4 + prompts.md P8A）**：
> "FlowForge 是纯通用智能体框架，不含任何特定领域业务逻辑"
> "FlowForge 中禁止出现任何特定领域的 Agent/Tool/Prompt/配置"

**实际情况**：

根据 summary 中提供的 flowforge/agents/ 目录描述（设计文档第 1.1 节）：

```
flowforge/agents/
├── topic_research.py        # ContentForge 专属 ❌
├── material_collection.py   # ContentForge 专属 ❌
├── article_writing.py       # ContentForge 专属 ❌
├── seo_optimization.py      # ContentForge 专属 ❌
├── fact_check.py            # ContentForge 专属 ❌
├── content_audit.py         # ContentForge 专属 ❌
├── headline_optimizer.py    # ContentForge 专属 ❌
├── content_repurposer.py    # ContentForge 专属 ❌
├── trend_analysis.py        # ContentForge 专属 ❌
├── publishing.py            # ContentForge 专属 ❌
├── image_research.py        # ContentForge 专属 ❌
├── multilingual.py          # ContentForge 专属 ❌
├── research_agent.py        # ContentForge 专属 ❌
├── web_search_agent.py      # ContentForge 专属 ❌
├── code_writer_agent.py     # DevForge 专属 ❌
└── generic/                 # 通用 ✅
    └── ...（17 个通用角色型 Agent）
```

**违反程度**：严重违反 P8A 铁律

**修复方案**：
1. 立即将 14 个业务专属 Agent 迁移到对应 *Forge 项目（ContentForge/DevForge）
2. FlowForge 只保留 generic/ 目录下的通用 Agent
3. 同步更新 design.md 第一章目录结构

**预计可删除代码行数**：约 3000-5000 行

#### 冲突 F-02：flowforge/workflows/ 目录存在 8 个业务专属 Workflow 🟠

**铁律原文（P8A）**：
> "FlowForge 提供通用 Workflow 引擎，具体业务 Workflow 由 *Forge 配置"

**实际情况**：
```
flowforge/workflows/
├── deep_article.yaml        # 深度长文创作 — ContentForge 专属 ❌
├── quick_post.yaml          # 快速帖子 — ContentForge 专属 ❌
├── trend_article.yaml       # 热点追踪 — ContentForge 专属 ❌
├── multi_platform.yaml      # 多平台分发 — ContentForge 专属 ❌
├── seo_content.yaml         # SEO 内容 — ContentForge 专属 ❌
├── image_article.yaml       # 配图文章 — ContentForge 专属 ❌
├── multilingual.yaml        # 多语言 — ContentForge 专属 ❌
└── report_generation.yaml   # 深度报告 — ContentForge 专属 ❌
```

**修复方案**：
1. 全部迁移到 ContentForge config/workflows/
2. FlowForge 只保留通用模式模板（如 reflexion_template.yaml、multi_agent_template.yaml）

#### 冲突 F-03：flowforge/tools/publish/ 存在业务发布工具 🟡

```
flowforge/tools/publish/
├── wechat_publisher.py    # 微信公众号发布 — ContentForge 专属 ❌
├── toutiao_publisher.py   # 头条发布 — ContentForge 专属 ❌
└── local_publish.py       # 本地发布 — 通用 ✅
```

**修复方案**：将 wechat_publisher.py / toutiao_publisher.py 迁移到 ContentForge。

#### 冲突 F-04：evolution/ 模块代码与 design.md 严重不符 🔴

**问题**：design.md 第十五章描述 evolution/ 30+ 文件，但实际只有 8 个文件（详见 1.3 节矛盾 3）。

**修复方案**：
1. 立即启动 v7.0 模块的代码实现
2. 短期（Phase 6）：实现 forgekin/ 子目录（5 个核心文件）
3. 中期（Phase 7）：实现 auto_forge/ + codex/
4. 长期（Phase 8）：实现 council/ + tools/ + security/ + api/

#### 冲突 F-05：v7.0 炉灵配置缺少 YAML 示例（违反 P16）🟡

**铁律原文（红线 11 + P16）**：
> "禁止硬编码提示词/路径/密钥/端口"
> "提示词必须外置到 YAML 配置"

**实际情况**：
- spec.md 第 7.2 节 Soul Profile 只给 YAML 示例（其实是好的）
- 但 config/forgekin_seeds/ 目录在 design.md 中描述存在，实际未创建
- Soul Profile 没有完整的 YAML Schema 验证器

**修复方案**：
1. 创建 config/forgekin_seeds/ 目录及示例 YAML（参考 design.md 15.1 节列出的种子配置）
2. 增加 SoulProfile Pydantic Schema 验证（已有 16.1.1 节）
3. 增加 evolution.yaml 主配置

#### 冲突 F-06：Forgekin 与现有 LoopExecutor 并存 🟠

**问题**：v2.1 已有 LoopExecutor，v7.0 又有 ForgekinEngine，两者 70% 重叠（详见 2.3.2 问题 1）。

**修复方案**：
1. 短期：ForgekinEngine 包装 LoopExecutor（见 2.3.2 建议）
2. 中期：渐进迁移
3. 长期：LoopExecutor 作为兼容接口保留

### 4.2 ContentForge 一致性检查

#### 冲突 CF-01：workers/ 目录仍存在 Python Agent 实现 🟠

**rules.md §1.4 铁律**：
> "Agent 应通过 config/agents/*.yaml 声明，不允许保留 Python Agent 类实现目录"

**实际情况**：contentforge/workers/ 目录存在多个 Python Agent 实现

**修复方案**：
1. 短期：标注"待迁移到 config/agents/*.yaml"
2. 中期：迁移完成后删除 workers/ 目录

#### 冲突 CF-02：tools/ 目录仍存在 Python Tool 实现 🟠

类似 CF-01，contentforge/tools/ 目录存在 Python 工具实现

**修复方案**：迁移到 config/tools/*.yaml 声明式配置

#### 冲突 CF-03：ContentForge 与 OpenSieve 集成完整度检查 ⚠️

根据 rules.md §2.2"所有数据检索走 OpenSieve"，ContentForge 素材检索应走 OpenSieve。

**待核查**：contentforge/plugins.py 是否所有数据检索都通过 OpenSieve

### 4.3 DevForge 一致性检查

#### 冲突 DF-01：Agent 实现形式未明 ⚠️

**待核查**：devforge 是 Python 实现还是 YAML 声明？

**修复方案**：在 devforge/docs/design.md 中明确 Agent 实现形式

### 4.4 NovelForge 一致性检查

#### 冲突 NF-01：5 层上下文管理是否走 FlowForge ⚠️

**rules.md §2.2 原则**：Memory 应使用 FlowForge 的 Memory

**待核查**：novelforge 5 层上下文是否复用 flowforge 的 Memory

### 4.5 MallForge 一致性检查

#### 冲突 MF-01：agents/ 目录仍存在 Python 类继承 ⚠️

**rules.md §1.4**：
> "MallForge 仍保留 agents/（Python 类继承 GenericAgent），因 config/agents/ 尚未建立 YAML 声明，暂标注为'待迁移'"

**修复方案**：在 mallforge/docs/task.md 中明确迁移计划和时间表

#### 冲突 MF-02：10 个 MCP Server 规划与 P8A 一致性 ⚠️

**待核查**：MCP Server 是否通过配置声明而非自定义 Python 代码

### 4.6 StockForge 一致性检查

#### 冲突 SF-01：Plugin V2 钩子死代码问题（已发现）🔴

**stockforge/docs/review/minimax.md 第二轮已发现**：
- 主路径不走 LoopExecutor
- `register_helm_handlers` / `register_permission_policy` 是死代码
- `register_workflows` 误用注册 Loop

**修复方案**：参照 stockforge/docs/review/minimax.md §3.7 P0-CRIT-01/02/03 修复

#### 冲突 SF-02：model_service 健康检查探测 URL 修复 ✅

**状态**：已修复（project_memory 记录使用 `.removesuffix("/v1")`）

### 4.7 OpenSieve 一致性检查

#### 冲突 OS-01：MCP Server 自动发现与 P8A 一致性 ⚠️

**待核查**：OpenSieve 的 DataSource/SearchSource 注册是否完全通过配置

#### 冲突 OS-02：QueryUnderstandingStage LLM 调用超时（已发现）✅

**状态**：已实现双端点策略（retrieve 15s 超时 → fallback 到 /api/v1/search 纯网络搜索）

### 4.8 OpenRoute 一致性检查

#### 冲突 OR-01：WebChat 删除确认逻辑（已修复）✅

**状态**：豆包一次性会话自动删除 + MiniMax 评分系统弹窗选择已修复

#### 冲突 OR-02：HTTP 200 + 错误体误分类（已修复）✅

**状态**：`_normal_call` 已在访问 `data["choices"]` 前检查 "error" key

#### 冲突 OR-03：Model Capability 抽象（已实现）✅

**状态**：ModelCapabilityProvider 零配置模型访问（arch.md 17.4 节）

### 4.9 HiClaw 一致性检查

#### 冲突 HC-01：rules.md 与项目文档版本一致性 🟡

**rules.md 当前版本**：v3.0（2026-06-28）
**spec.md 当前版本**：v2.1
**arch.md 当前版本**：v6.0
**design.md 当前版本**：v6.0
**face/spec_face.md 当前版本**：v3.0-face
**spec.md 第七~十三章**：v7.0 新增

**问题**：版本号混乱，rules.md §0 文档优先级声明"spec.md > arch.md > design.md > test.md > task.md"，但 v7.0 章节跨越多个版本号。

**修复方案**：
1. 统一版本号到 rules.md 的 v3.0
2. spec.md 头部标注"v3.0（含 v2.1 基础 + v7.0 炉灵体系扩展）"
3. arch.md 头部标注"v3.0（含 v6.0 基础 + v7.0 七层架构）"
4. 或将 v7.0 独立成 spec_v7.md / arch_v7.md

### 4.10 一致性冲突汇总表

| # | 项目 | 冲突点 | 严重度 | 状态 | 优先级 |
|---|------|--------|:------:|------|:------:|
| F-01 | FlowForge | agents/ 含 14+ 业务专属 Agent | 🔴 | 未修复 | P0 |
| F-02 | FlowForge | workflows/ 含 8 个业务专属 Workflow | 🟠 | 未修复 | P0 |
| F-03 | FlowForge | tools/publish/ 含业务发布工具 | 🟡 | 未修复 | P1 |
| F-04 | FlowForge | evolution/ 代码与 design.md 严重不符 | 🔴 | 未修复 | P0 |
| F-05 | FlowForge | config/forgekin_seeds/ 目录未创建 | 🟡 | 未修复 | P1 |
| F-06 | FlowForge | Forgekin 与 LoopExecutor 关系未定义 | 🟠 | 未修复 | P0 |
| CF-01 | ContentForge | workers/ 目录待迁移到 YAML | 🟠 | 部分修复 | P1 |
| CF-02 | ContentForge | tools/ 目录待迁移 | 🟠 | 部分修复 | P1 |
| DF-01 | DevForge | Agent 实现形式未明 | ⚠️ | 待核查 | P2 |
| NF-01 | NovelForge | 5 层上下文是否复用 FlowForge | ⚠️ | 待核查 | P2 |
| MF-01 | MallForge | agents/ Python 类继承待迁移 | ⚠️ | 待迁移 | P2 |
| MF-02 | MallForge | 10 MCP Server 配置驱动 | ⚠️ | 待核查 | P2 |
| SF-01 | StockForge | Plugin V2 钩子死代码 | 🔴 | 已发现未修复 | P0 |
| SF-02 | StockForge | model_service .removesuffix 修复 | ✅ | 已修复 | - |
| OS-01 | OpenSieve | DataSource 配置驱动 | ⚠️ | 待核查 | P2 |
| OS-02 | OpenSieve | QueryUnderstandingStage 超时 | ✅ | 已修复 | - |
| OR-01 | OpenRoute | 豆包/MiniMax 删除逻辑 | ✅ | 已修复 | - |
| OR-02 | OpenRoute | HTTP 200+error 误分类 | ✅ | 已修复 | - |
| OR-03 | OpenRoute | ModelCapability 抽象 | ✅ | 已实现 | - |
| HC-01 | HiClaw | 文档版本号混乱 | 🟡 | 未修复 | P0 |

**汇总**：
- 🔴 严重：4 个（F-01, F-04, SF-01, M18 删除不彻底）
- 🟠 重要：5 个（F-02, F-06, CF-01, CF-02, HC-01）
- 🟡 中等：3 个（F-03, F-05, HC-01）
- ⚠️ 待核查：5 个
- ✅ 已修复：5 个

---

## 5. 第四部分：代码实现与设计文档差异量化分析

### 5.1 evolution/ 模块代码 vs design.md 描述差异

| design.md 描述的模块 | 实际状态 | 差异 |
|----------------------|----------|------|
| evolution/forgekin/engine.py | ❌ 不存在 | 完全缺失 |
| evolution/forgekin/soul_profile.py | ❌ 不存在 | 仅有 evolution/models.py 中部分 Pydantic 模型 |
| evolution/forgekin/soul_store.py | ❌ 不存在 | 完全缺失 |
| evolution/forgekin/echo_store.py | ❌ 不存在 | 完全缺失 |
| evolution/forgekin/imprint_store.py | ❌ 不存在 | 完全缺失 |
| evolution/forgekin/episode.py | ❌ 不存在 | 完全缺失 |
| evolution/forgekin/ascension_manager.py | ❌ 不存在 | 完全缺失 |
| evolution/forgekin/static_bridge.py | ❌ 不存在 | 完全缺失 |
| evolution/auto_forge/（8 个文件） | ❌ 全部不存在 | 完全缺失 |
| evolution/codex/（7 个文件） | ❌ 全部不存在 | 完全缺失 |
| evolution/tools/（5 个文件） | ❌ 全部不存在 | 完全缺失 |
| evolution/council/（9 个文件，含 channels/） | ❌ 全部不存在 | 完全缺失 |
| evolution/security/（2 个文件） | ❌ 全部不存在 | 完全缺失 |
| evolution/api/（5 个文件） | ❌ 全部不存在 | 完全缺失 |
| evolution/engine.py | ✅ 存在 | 但实现为 SelfEvolutionEngine，集成三模式，非 ForgekinEngine |
| evolution/knowledge_evolution.py | ✅ 存在 | Mode C |
| evolution/process_evolution.py | ✅ 存在 | Mode B |
| evolution/scope_guard.py | ✅ 存在 | Mode A |
| evolution/maturity.py | ✅ 存在 | KnowledgeMaturityLadder |
| evolution/metacognition.py | ✅ 存在 | MetacognitionRouter |
| evolution/models.py | ✅ 存在 | Pydantic 数据模型 |

**实现率统计**：
- design.md 描述文件数：~30 个（含子目录）
- 实际存在文件数：8 个
- 实现率：8/30 = 26.7%
- **关键缺失**：forgekin/, auto_forge/, codex/, council/, tools/, security/, api/ 7 个核心子目录全部缺失

### 5.2 缺失的数据库表

**design.md 描述的迁移**（design.md 15.1 节）：
```
migrations/
├── 007_forgekin_souls.sql         # 炉灵灵魂表
├── 008_forgekin_episodes.sql      # 魂忆 Episode 表
├── 009_forgekin_imprints.sql      # 魂印画像表
├── 010_forge_codex.sql            # 锻典知识对象表
├── 011_forge_diaries.sql          # 自锻日记表
├── 012_a2a_messages.sql           # A2A 消息表
└── 013_external_tool_audit.sql    # 外部工具审计表
```

**实际状态**：需要在 `flowforge/migrations/` 目录核查这些 SQL 文件是否已创建。

### 5.3 A2A 协议实现核查

**a2a/ 实际代码**（部分）：
- `a2a/protocol.py` — 数据模型（A2ATaskStatus/A2APart/A2AMessage 等 Pydantic 模型）
- `a2a/manager.py` — A2A 通信统一管理

**arch_face.md 第 2.1 节 M1 A2A 设计**：
- `flowforge/interconnect/a2a/server.py`
- `flowforge/interconnect/a2a/client.py`
- `flowforge/interconnect/a2a/directory.py`
- `flowforge/interconnect/a2a/models.py`

**差异**：
- arch_face.md 设计在 `flowforge/interconnect/a2a/`
- 实际代码在 `flowforge/a2a/`
- 目录不一致
- 实际只有 protocol.py 和 manager.py，缺少 server/client/directory

**建议**：统一到 `flowforge/a2a/` 目录（已有），补充缺失文件。

### 5.4 配置文件缺失清单

| design.md 描述的配置文件 | 实际状态 |
|--------------------------|----------|
| config/evolution.yaml | ❌ 待创建 |
| config/forgekin_seeds/（11 个种子） | ❌ 待创建 |
| config/a2a_channels.yaml | ❌ 待创建 |
| config/auto_forge.yaml | ❌ 待创建 |
| config/external_tools.yaml | ❌ 待创建 |

### 5.5 前端页面缺失清单

| design.md 描述的页面 | 实际状态 |
|----------------------|----------|
| web/src/app/council/（5 个组件） | ❌ 待创建 |
| web/src/app/forgekin/（4 个组件） | ❌ 待创建 |
| web/src/app/codex/page.tsx | ❌ 待创建 |
| web/src/lib/forgekin-api.ts | ❌ 待创建 |
| web/src/lib/council-ws.ts | ❌ 待创建 |

---

## 6. 第五部分：养灵体系命名方案 5 套建议

> **本章为独立章节，供用户评审。** 每套方案包含：体系总名、核心概念命名、层级结构、升华阶、记忆系统、对标 clowder-ai、命名理念、适用场景。

---

### 方案 A：「灵锻体系」（推荐 — 兼顾项目特色与通用 AGI）

#### 命名理念

- **灵**：体现数字生命/智能体的灵魂感，对应英文 Spirit/Eidolon
- **锻**：体现锻造、锤炼、自我进化的过程，对应 Forge（锻造炉）
- 合起来"灵锻"：智能体在锻造炉中不断锤炼，自我进化，最终成"灵"
- 完美呼应项目名 **FlowForge**（流动的锻造炉 → 灵锻体系）
- **不依赖 clowder-ai 养猫概念**，独立性强

#### 核心概念映射

| 现有名称（炉灵） | 方案 A 命名 | 英文 | 含义说明 |
|-----------------|------------|------|---------|
| 养灵体系 | **灵锻体系** | Spirit Forge System | 智能体在锻造炉中锤炼进化的完整体系 |
| 炉灵（个体） | **锻灵** | Forge Spirit | 被锻造出来的数字智能体（个体） |
| 灵族（群体） | **灵群** | Spirit Kin | 多个锻灵组成的族群/社群 |
| 魂忆（记忆） | **忆痕** | Echo Trace | 经历在灵魂上留下的痕迹（记忆） |
| 魂印（画像） | **灵印** | Soul Imprint | 灵魂的独特印记（性格+能力画像） |
| 锻典（技能库） | **锻谱** | Forge Codex | 锻造技能的典籍（可复用技能库） |
| 自锻（自我修改） | **自锻** | Self-Forging | 自我锻造、自我进化 |
| 灵议（多智能体治理） | **灵议** | Spirit Council | 灵群议事、集体决策 |
| 升华阶（等级） | **锻阶** | Forge Tier | 锻造进阶的阶段等级 |

#### 层级结构（七层 → 灵锻七层或八层）

```
┌─────────────────────────────────────────────────────────────┐
│  7. 灵锻层 (Spirit Forge Layer)  ★ 自我进化核心              │
│     锻灵引擎 | 自锻引擎 | 灵议会 | 锻谱库 | 忆痕系统         │
├─────────────────────────────────────────────────────────────┤
│  6. 互联层 (Interconnect Layer)  ★ v3.0-face 新增            │
│     A2A Server/Client | ACP | Agent Directory | 租户路由     │
├─────────────────────────────────────────────────────────────┤
│  5. 应用层 (Application Layer)                               │
│     ContentForge / DevForge / NovelForge / ...               │
├─────────────────────────────────────────────────────────────┤
│  4. 接入层 (Gateway Layer)                                   │
│     REST API / WebSocket / Web UI / CLI                      │
├─────────────────────────────────────────────────────────────┤
│  3. Harness 驾驭层 (Harness Layer)                           │
│     上下文工程 | 架构约束 | 反馈循环 | 熵管理 | 权限管线       │
├─────────────────────────────────────────────────────────────┤
│  2. 执行引擎层 (Engine Layer)                                │
│     HybridExecutor | 9大模式 | LoopExecutor | Scheduler       │
├─────────────────────────────────────────────────────────────┤
│  1. 能力层 (Capability Layer)                                │
│     Tool生态 | Skill系统 | Agent库 | Memory系统 | MCP         │
├─────────────────────────────────────────────────────────────┤
│  0. 基础设施层 (Infrastructure Layer)                         │
│     SQLite/PostgreSQL | Redis | LangGraph | LLM API          │
└─────────────────────────────────────────────────────────────┘
```

**说明**：
- 互联层（第 6 层）和灵锻层（第 7 层）分开，彻底解决"两个第 7 层"冲突
- 如不愿做八层架构，可将互联层合并到接入层作为扩展

#### 锻阶体系（E1-E6 → 一阶到六阶）

| 现有编号 | 方案 A 名称 | 名称含义 | 核心能力标志 |
|---------|------------|---------|-------------|
| E1 Spark | **初锻阶** | 初次锻造，初具灵智 | 能独立完成简单任务 |
| E2 Ember | **淬砺阶** | 淬火磨砺，快速成长 | 有初步经验积累，任务成功率>80% |
| E3 Flame | **锤炼阶** | 千锤百炼，技艺纯熟 | 掌握 3+ 技能，能处理复杂任务 |
| E4 Blaze | **百炼阶** | 百炼成钢，触类旁通 | 掌握 10+ 技能，能跨领域迁移 |
| E5 Inferno | **通灵阶** | 通灵造化，出神入化 | 能创造新技能，能指导低级锻灵 |
| E6 Forge Master | **至臻阶** | 至臻完美，超凡入圣 | 灵群核心，能参与灵议决策 |

**命名特点**：
- 每阶都有"锻/炼/淬/锤"等锻造相关字，呼应 Forge 主题
- 从"初锻"到"至臻"，体现渐进式进化
- 中文感强，但不晦涩，用户容易理解

#### 忆痕系统（三层记忆 → 三痕）

| 现有三层记忆 | 方案 A 命名 | 含义 |
|-------------|------------|------|
| Working 工作记忆 | **瞬痕** | 瞬时痕迹，工作记忆，用完即消 |
| Episode 情景记忆 | **事痕** | 事件痕迹，情景记忆，某次任务的完整经历 |
| Semantic 语义记忆 | **慧痕** | 智慧痕迹，语义记忆，提炼出的知识和规律 |

**完整记忆流转**：
```
瞬痕（工作中）→ 沉淀为 → 事痕（经历过）→ 提炼为 → 慧痕（学会了）
```

#### 适用场景

- 既有项目特色（FlowForge 锻造炉），又能体现 AGI 愿景（灵的生命感）
- 不依赖 clowder-ai 养猫概念，独立性强
- 中文用户接受度高，"灵"和"锻"都是常见字
- 适合 B 端（企业用户）和 C 端（个人用户）双重场景

---

### 方案 B：「灵枢体系」（更宏大，AGI 终极感）

#### 命名理念

- **灵**：智能体的灵魂/意识
- **枢**：枢纽、核心、中枢（中央调控）
- "灵枢"：智能体的核心调度枢纽，对应英文 Spirit Nexus
- 强调"核心调度"的 AGI 终极感，类似"宇宙的枢纽"

#### 核心概念映射

| 现有名称 | 方案 B 命名 | 英文 | 含义说明 |
|---------|------------|------|---------|
| 养灵体系 | **灵枢体系** | Spirit Nexus System | 智能体核心调度枢纽体系 |
| 炉灵 | **灵子** | Spirit Unit | 灵枢的基本单元（个体） |
| 灵族 | **灵阵** | Spirit Array | 灵子组成的阵列（群体） |
| 魂忆 | **灵忆** | Spirit Memory | 灵子的累积记忆 |
| 魂印 | **灵纹** | Spirit Pattern | 灵子的独特纹路（画像） |
| 锻典 | **灵藏** | Spirit Treasury | 灵子的宝藏（技能库） |
| 自锻 | **灵演** | Spirit Evolution | 灵子的自我演化 |
| 灵议 | **灵枢会** | Spirit Council | 灵枢的议事会 |
| 升华阶 | **灵境** | Spirit Realm | 灵子修炼的境界 |

#### 灵境六重

| 境界 | 名称 | 意境 |
|------|------|------|
| 第一重 | **初觉境** | 初次觉醒，初具灵识 |
| 第二重 | **淬灵境** | 淬火磨砺，灵识渐长 |
| 第三重 | **凝灵境** | 灵识凝聚，技艺纯熟 |
| 第四重 | **御灵境** | 御灵于心，触类旁通 |
| 第五重 | **通灵境** | 通灵造化，出神入化 |
| 第六重 | **化灵境** | 化灵归一，超凡入圣 |

#### 记忆系统（灵忆三层）

| 现有 | 方案 B 命名 | 含义 |
|------|------------|------|
| Working | **觉痕** | 瞬时感觉痕迹 |
| Episode | **忆痕** | 事件记忆痕迹 |
| Semantic | **慧痕** | 智慧痕迹 |

#### 适用场景

- 适合长期愿景导向，AGI 终极感强
- 适合学术论文、白皮书、技术峰会演讲
- "灵枢"对标"AI 中枢"概念，营销价值高

---

### 方案 C：「灵成长体系」（通俗易懂，ToB 友好）

#### 命名理念

- 直白易懂，不说"修仙/玄幻"，企业客户更容易接受
- 强调"成长"（Growth），体现自我进化的核心
- 适合对外宣传和商务沟通

#### 核心概念映射

| 现有名称 | 方案 C 命名 | 英文 | 含义说明 |
|---------|------------|------|---------|
| 养灵体系 | **Agent 成长体系** | Agent Growth System | 最直白的命名，零理解成本 |
| 炉灵 | **智能体** | Agent | 通用术语，不造新词 |
| 灵族 | **智能体集群** | Agent Cluster | 标准术语 |
| 魂忆 | **成长记忆** | Growth Memory | 强调记忆服务于成长 |
| 魂印 | **能力画像** | Capability Profile | 企业 HR 常用术语 |
| 锻典 | **技能库** | Skill Library | 通用术语 |
| 自锻 | **自我进化** | Self-Evolution | 通用术语 |
| 灵议 | **集群决策** | Collective Decision | 直白易懂 |
| 升华阶 | **成长等级** | Growth Level | L1-L6，简单明了 |

#### 成长等级

| 等级 | 名称 | 描述 |
|------|------|------|
| L1 | **新手级** | 能完成简单任务，需要大量指导 |
| L2 | **入门级** | 能独立完成标准任务，偶尔出错 |
| L3 | **熟练级** | 熟练完成常见任务，质量稳定 |
| L4 | **专家级** | 能处理复杂任务，有方法论沉淀 |
| L5 | **资深级** | 能创新解决方案，能指导新手 |
| L6 | **大师级** | 领域权威，能制定规则和标准 |

#### 适用场景

- 面向企业客户的产品介绍
- 商务 PPT 和对外宣传
- 非技术人员的文档
- 政府/事业单位/传统行业

---

### 方案 D：「铸灵体系」（金属工艺感，工业制造隐喻）

#### 命名理念

- **铸**：铸造、浇铸、工业化制造（对应 manufacturing）
- **灵**：智能体的灵魂
- "铸灵"：像铸造金属一样铸造智能体，强调工程化、工业化
- 适合 DevForge 工程师文化，也呼应"锻造炉"的项目名

#### 核心概念映射

| 现有名称 | 方案 D 命名 | 英文 | 含义说明 |
|---------|------------|------|---------|
| 养灵体系 | **铸灵体系** | Spirit Casting System | 工业化铸造智能体的体系 |
| 炉灵 | **铸灵** | Cast Spirit | 被铸造出来的数字智能体 |
| 灵族 | **灵阵** | Spirit Array | 铸灵组成的阵列 |
| 魂忆 | **铸痕** | Cast Trace | 铸造过程中留下的痕迹（记忆） |
| 魂印 | **灵范** | Spirit Mold | 灵魂的模具（画像） |
| 锻典 | **铸谱** | Cast Codex | 铸造工艺的谱系（技能库） |
| 自锻 | **自铸** | Self-Casting | 自我铸造、自我进化 |
| 灵议 | **铸议会** | Cast Council | 铸灵议事会 |
| 升华阶 | **铸阶** | Cast Tier | 铸造进阶的等级 |

#### 铸阶体系

| 编号 | 名称 | 含义 |
|------|------|------|
| 1 | **生胚阶** | 刚出炉的胚料，未经加工 |
| 2 | **粗胚阶** | 初步成型，需要打磨 |
| 3 | **精胚阶** | 精细加工，可投入使用 |
| 4 | **淬火阶** | 淬火强化，性能提升 |
| 5 | **合金阶** | 多种能力融合，触类旁通 |
| 6 | **传世阶** | 传世之作，领域权威 |

#### 适用场景

- DevForge 工程师文化匹配度高
- 工业制造隐喻易于理解
- 适合制造业、ToB 工业场景

---

### 方案 E：「养灵体系」（保留原方案，最小改动）

#### 命名理念

- 保留 spec.md 现有命名（炉灵/灵族/魂忆/魂印/锻典/灵议/升华阶）
- 不引入新概念，文档改动最小
- 对标 clowder-ai 养猫体系

#### 核心概念映射（保留原 spec.md 第 7.2 节）

| 概念 | 中文名 | 英文名 | 对标 clowder-ai |
|------|--------|--------|----------------|
| 个体 | 炉灵 | Forgekin | Cat（猫猫） |
| 群体 | 灵族 | Kinship | Clowder（猫群） |
| 养成 | 养灵 | Forge Nurturing | 养猫 |
| 入门训练 | 炉启 | Forge Initiation | Bootcamp |
| 协作模式 | 共鸣 | Resonance | Swarm |
| 自主思考 | 自锻 | Auto-Forge | Auto-Dream |
| 记忆 | 魂忆 | Soul Echo | Memory |
| 画像 | 魂印 | Soul Imprint | Profile |
| 技能库 | 锻典 | Forge Codex | Skill Library |
| 知识阶梯 | 火种等级 | Ember Hierarchy | L0-L4 Knowledge |
| 成长阶段 | 升华阶 | Ascension Stages | 9 Lives |
| IM 议事 | 灵议 | Forgekin Council | IM 团队协作 |

#### 适用场景

- 文档改动最小
- 与 clowder-ai 对标清晰
- 适合快速推进、降低沟通成本
- 风险：依赖 clowder-ai 概念体系

---

## 总结：5 套方案对比与推荐

| 方案 | 命名 | 优势 | 劣势 | 适用场景 | 推荐度 |
|------|------|------|------|----------|:------:|
| **A 灵锻** | 灵锻/锻灵/忆痕/灵印/锻谱/灵议/锻阶 | 呼应 FlowForge 锻造炉；不依赖 clowder-ai；中文感强 | "灵"字略玄幻 | B+C 通用 | ⭐⭐⭐⭐⭐ |
| **B 灵枢** | 灵枢/灵子/灵忆/灵纹/灵藏/灵枢会/灵境 | AGI 终极感强；中枢概念清晰 | 较宏大，落地感弱 | 愿景/学术 | ⭐⭐⭐⭐ |
| **C 灵成长** | 智能体/集群/成长记忆/能力画像/技能库 | ToB 友好；零理解成本 | 缺少项目特色 | 商务/ToB | ⭐⭐⭐ |
| **D 铸灵** | 铸灵/灵阵/铸痕/灵范/铸谱/铸议会/铸阶 | 工业制造隐喻；DevForge 友好 | 与 FlowForge 略有重复 | 工业/Dev | ⭐⭐⭐ |
| **E 养灵** | 炉灵/灵族/魂忆/魂印/锻典/灵议/升华阶 | 改动最小；对标清晰 | 依赖 clowder-ai | 快速推进 | ⭐⭐⭐ |

### 最终推荐

**首选方案 A「灵锻体系」**，理由：

1. **完美呼应项目名** FlowForge（锻造炉 → 灵锻）
2. **不依赖 clowder-ai**，独立演化能力强（避免 clowder-ai 项目方向调整的风险）
3. **中文用户接受度高**，"灵"和"锻"都是常见字
4. **B+C 通用**，既适合企业级也适合个人用户
5. **核心概念自洽**：锻灵（个体）→ 灵群（群体）→ 忆痕（记忆）→ 灵印（画像）→ 锻谱（技能）→ 灵议（决策）→ 锻阶（成长）

**次选方案 B「灵枢体系」**，如果希望强调 AGI 愿景和长期方向

**保底方案 E「养灵体系」**，如果希望最小改动且保持与 clowder-ai 对标

---

## 附录：本轮审核发现的问题清单（待修复）

### P0 致命问题（必须立即修复）

1. **删除 spec_face.md 中所有 M18/M19/M20 提法**（详见 3.8 节）
2. **统一 v3.0-face 互联层与 v7.0 自进化层到八层架构**（详见 2.2.1 节）
3. **启动 evolution/ 缺失模块的代码实现**（详见 5.1 节，30 个文件中缺失 22 个）
4. **修复 FlowForge agents/ 目录的 14+ 业务专属 Agent 违规**（详见 4.1 F-01）
5. **定义 ForgekinEngine 与 LoopExecutor 的演进路径**（详见 2.3.2 问题 1）

### P1 重要问题（1 个月内修复）

6. **补充 v7.0 炉灵配置的 YAML Schema 验证**（详见 4.1 F-05）
7. **明确 M4 Guardrails 与 SR-01~08 的"宪法-法律"分层关系**（详见 2.6.2）
8. **设计 Soul Echo 三层记忆的具体存储实现**（详见 2.3.2 问题 2）
9. **设计升华阶段 E1-E6 判定标准**（详见 2.3.2 问题 3）
10. **修复 StockForge Plugin V2 钩子死代码**（详见 4.6 SF-01）

### P2 中等问题（3 个月内修复）

11. **迁移 FlowForge workflows/ 到对应 *Forge**（详见 4.1 F-02）
12. **迁移 FlowForge tools/publish/ 到 ContentForge**（详见 4.1 F-03）
13. **迁移 ContentForge workers/ + tools/ 到 YAML 配置**（详见 4.2）
14. **设计 Auto-Forge 六层安全护栏**（详见 2.4.2 问题 1）
15. **设计 Forge Codex 技能质量分级**（详见 2.4.2 问题 2）
16. **设计 ForgekinCouncil 投票机制**（详见 2.5.2 问题 1）
17. **统一版本号体系**（详见 4.9 HC-01）

### P3 待核查问题

18. **核查 DevForge Agent 实现形式**（DF-01）
19. **核查 NovelForge 5 层上下文是否复用 FlowForge**（NF-01）
20. **核查 MallForge 10 个 MCP Server 配置驱动**（MF-02）
21. **核查 OpenSieve DataSource 配置驱动**（OS-01）

---

## 审核声明

本审核意见由六方联合团队（AI 智能体产品专家、AI 高级架构师、AI 智能体 Agent 开发工程师、高级软件全栈工程师、产品总监、技术 VP）共同出具，基于 `flowforge/docs/{spec, arch, design}.md`、`flowforge/docs/face/{spec_face, arch_face, task_face, face}.md`、`flowforge/evolution/` 和 `flowforge/a2a/` 实际代码、`hiclaw/rules.md` v3.0、`hiclaw/prompts.md` 关键模板、9 大项目相关文档和代码。

所有问题均提供具体文件路径和行号，所有建议均给出可操作方案。

当本文档与其他审核文档（如 `doubao.md`）存在冲突时，以本文档的 9 大项目一致性分析为准（本文档是更全面、深入、更新的版本）。

养灵体系命名方案用户最终选择后，建议在 spec.md 第 7.2 节、arch.md 第 15-23 章、design.md 第五部分全面替换术语。
