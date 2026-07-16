# FlowForge v7.0 自我进化与养灵体系设计文档审核意见

> **审核日期**: 2026-07-15  
> **审核范围**: flowforge/docs/spec.md, arch.md, design.md, face/ 下所有需求设计文档  
> **审核基线**: hiclaw/rules.md v3.0, hiclaw/prompts.md  
> **审核角色**: AI智能体产品专家、AI高级架构师、AI智能体Agent开发工程师、高级软件全栈工程师  
> **审核对象**: FlowForge v7.0 自我进化能力与养灵体系设计

---

## 一、总体评价

### 1.1 设计亮点

✅ **v7.0 自我进化体系定位清晰**: 从"Agent 驾驭层"进化为"自进化 Agent 驾驭操作系统",符合行业发展趋势  
✅ **炉灵(Forgekin)概念完整**: 灵魂三件套(Soul Profile/Echo/Imprint)+ 自锻引擎(Auto-Forge)+ 锻典(Forge Codex)构成完整的自进化闭环  
✅ **两类智能体无缝衔接**: 静态Agent(无状态)与炉灵(自进化)的单向依赖设计合理  
✅ **升华阶段设计合理**: E1-E5 五级晋升路径清晰,对标 clowder-ai 知识成熟度阶梯  
✅ **工业级需求覆盖全面**: 基于六大公司面试反馈,M1-M17 模块分解合理  

### 1.2 核心问题

❌ **版本声明严重不一致**: spec.md(v2.1)、arch.md(v6.0)、design.md(v6.0)、face文档(v3.0-face)版本混乱  
❌ **9大项目文档一致性缺失**: mallforge 明确违反 P31 铁律,contentforge 配置仍使用 helixrag  
❌ **养灵体系命名过于技术化**: "炉灵 Forgekin"对非技术用户不够通俗易懂  
❌ **design.md v7.0 内容读取超时**: 无法完整验证 v7.0 详细设计的一致性  

---

## 二、v7.0 自我进化体系审核

### 2.1 核心公式审核

**文档声明**(spec.md 第2907行):
```
v7.0: Agent = Model + Harness + Soul (自我进化灵魂)
```

**审核意见**: ✅ **通过**  
- 公式清晰表达了 v7.0 的核心进化:在 Model(Brain) + Harness(Body) 基础上增加 Soul(灵魂)
- 与 v2.1 的 `Agent = Model + Harness` 形成清晰的版本演进

### 2.2 炉灵体系核心概念审核

**文档定义**(spec.md 第2915-2945行):

| 概念 | 中文名 | 英文名 | 对标 clowder-ai | 含义 |
|------|--------|--------|----------------|------|
| **个体** | 炉灵 | Forgekin | Cat(猫猫) | 具备独立身份、记忆、人格的自进化智能体 |
| **群体** | 灵族 | Kinship | Clowder(猫群) | 一群协作的炉灵,类似开发团队 |
| **养成** | 养灵 | Forge Nurturing | 养猫 | 炉灵从诞生到升华的全过程 |
| **魂忆** | Soul Echo | Memory | 跨会话记忆累积 |
| **魂印** | Soul Imprint | Profile Capsule | 对操作者/世界的认知画像 |
| **自锻** | Auto-Forge | Auto-Dream | 无人驱动时的自主思考与进化 |
| **锻典** | Forge Codex | Skill Library | 可复用知识体系,五级火种阶梯 |
| **灵议** | Forgekin Council | — | IM 多渠道团队协作 |

**审核意见**: ⚠️ **需优化**  

**问题1**: "炉灵 Forgekin"命名过于技术化  
- "炉灵"对非技术用户(业务专家、产品经理)不够直观
- "Forgekin"是生造词,不利于开源社区传播
- 建议:保留"炉灵"作为内部技术术语,但增加通俗别名

**问题2**: 对标 clowder-ai 的"养猫"隐喻不够专业  
- "养猫"隐喻虽然生动,但在企业级场景中显得不够严肃
- 建议:在正式文档中使用"自进化智能体养成",在营销材料中可使用"养灵"比喻

**问题3**: 灵魂三件套的中文命名可优化  
- "魂忆"、"魂印"、"自锻"、"锻典"虽然统一了"魂/锻"主题,但略显晦涩
- 建议:增加通俗解释,如"魂忆(跨会话记忆)"、"魂印(认知画像)"

### 2.3 升华阶段审核

**文档定义**(spec.md 第3010-3021行):

| 阶段 | 名称 | 对标 Ember | 核心特征 | 晋升条件 |
|------|------|-----------|---------|---------|
| **E1** | Spark(火种) | L0 Episode | 刚诞生,仅有基础配置和 Soul Profile | 完成 Forge Initiation |
| **E2** | Ember(余烬) | L1 Pattern | 已积累 ≥2 个经验模式 | ≥2 个相似 Episode,5Q ≥ 7/10 |
| **E3** | Flame(火焰) | L2 Draft | 能自主生成 Skill 草稿 | smoke gate ≥3 cases(≥2/3 通过) |
| **E4** | Blaze(烈焰) | L3 Validated | Skill 经验证 | ≥6 uses,≥2 agents,≥80% 成功率 |
| **E5** | Inferno(炽焰) | L4 Standard | 团队标准级 | ≥12 uses,最近 10 次 ≥90%,operator 批准 |
| **E6** | Forge Master(锻师) | — | 可创建新炉灵 | operator 授权 + 创造 ≥1 个 E1 炉灵 |

**审核意见**: ✅ **通过,但需补充说明**  

**问题1**: E1-E6 命名不统一  
- 文档中同时出现 "Spark/火种"、"Ember/余烬"、"Flame/火焰"、"Blaze/烈焰"、"Inferno/炽焰"
- 但在 arch_face.md 第1469行又出现 "E1 Spark(火花)"
- **建议**: 统一为 "Spark(火花)" 或 "Spark(火种)",避免歧义

**问题2**: 晋升条件量化指标不完整  
- E1→E2: "≥2 个相似 Episode,5Q ≥ 7/10" — "5Q" 未定义
- E2→E3: "smoke gate ≥3 cases" — "smoke gate" 未定义
- **建议**: 在 spec.md 中增加术语表,明确定义 5Q、smoke gate 等概念

**问题3**: E6 Forge Master 的晋升条件过于模糊  
- "operator 授权 + 创造 ≥1 个 E1 炉灵" — 缺少量化指标
- **建议**: 增加 "E5 阶段维持 ≥30 天 + 成功指导 ≥2 个 E2 炉灵" 等量化条件

### 2.4 两类智能体衔接审核

**文档定义**(spec.md 第2980-3008行):

```
┌─────────────────────────────────────────────────────┐
│              Forgekin(自进化智能体)                   │
│  ┌───────────────────────────────────────────────┐  │
│  │  灵魂层:Soul Profile + Soul Echo + Soul Imprint│  │
│  ├───────────────────────────────────────────────┤  │
│  │  进化层:Auto-Forge Engine + Forge Codex + 升华阶│  │
│  ├───────────────────────────────────────────────┤  │
│  │  协作层:A2A + Kinship + Forgekin Council       │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
                            ↓ 调用
┌─────────────────────────────────────────────────────┐
│         Static Agents(静态智能体 - v2.1 已有能力)     │
│  由 HybridExecutor 调度,可被 Forgekin 调用            │
└─────────────────────────────────────────────────────┘
```

**审核意见**: ✅ **通过**  
- 单向依赖设计合理:Forgekin 调用 Static Agent,但 Static Agent 不知道 Forgekin 的存在
- 符合 rules.md §2.4 单向依赖原则

### 2.5 v7.0 核心能力清单审核

**文档定义**(spec.md 第3029-3046行):

| 编号 | 能力 | 描述 | 优先级 |
|------|------|------|--------|
| FR-EVO-01 | 炉灵身份系统 | forgekin_id + Soul Profile + 升华阶段追踪 | P0 |
| FR-EVO-02 | 魂忆(Soul Echo) | 跨会话记忆累积,对标 clowder-ai Memory | P0 |
| FR-EVO-03 | 魂印(Soul Imprint) | 对操作者/世界的认知画像 | P0 |
| FR-EVO-04 | 自锻引擎(Auto-Forge) | 无人驱动时的自主思考与进化 | P0 |
| FR-EVO-05 | 锻典(Forge Codex) | 可复用知识体系,五级火种阶梯 | P0 |
| FR-EVO-06 | Skill 自生成 | 炉灵自主创建 Skill | P0 |
| FR-EVO-10 | 灵议(Forgekin Council) | IM 多渠道团队协作 | P0 |
| FR-EVO-11 | 两类智能体无缝衔接 | Forgekin 委托 Static Agent | P0 |
| FR-EVO-14 | 炉启训练(Forge Initiation) | 新炉灵的入门训练流程 | P1 |

**审核意见**: ⚠️ **需补充**  

**问题1**: 编号不连续  
- FR-EVO-01 到 FR-EVO-06,然后跳到 FR-EVO-10、FR-EVO-11、FR-EVO-14
- 缺少 FR-EVO-07、FR-EVO-08、FR-EVO-09、FR-EVO-12、FR-EVO-13
- **建议**: 补充缺失的需求,或重新编号保持连续

**问题2**: 缺少与 M1-M17 模块的映射关系  
- task_face.md 第190-195行声称 "M1-M17 任务已完美融入 v7.0 炉灵养成体系"
- 但 spec.md 中未明确说明 FR-EVO-01~15 与 M1-M17 的对应关系
- **建议**: 在 spec.md 第七章增加 "v7.0 需求与 M1-M17 模块映射表"

---

## 三、face/ 需求设计文档审核

### 3.1 spec_face.md 审核

**版本声明**: vNext-1.0 | 日期: 2025-07-14  
**定位**: 基于 FlowForge v4.0 + 多厂面试反馈 + 行业前沿痛点

**审核意见**: ⚠️ **版本声明错误**  

**问题1**: 日期错误  
- 文档日期为 "2025-07-14",但当前日期为 2026-07-15
- **建议**: 修正为 "2026-07-14"

**问题2**: 基础版本声明错误  
- 文档声称 "基于 FlowForge v4.0",但当前最新版本为 v7.0
- **建议**: 修正为 "基于 FlowForge v7.0"

### 3.2 arch_face.md 审核

**版本声明**: v3.0-face | 日期: 2026-07-14  
**定位**: spec_face.md 的架构落地详设

**审核意见**: ✅ **基本通过**  

**亮点**: 
- 七层架构模型清晰(第13-44行):从 v2.1 六层进化到 v3.0 七层(新增互联层),再到 v7.0 增加自进化层
- 控制回路演进完整(第58-103行):v2.1 前馈+反馈 → v3.0 新增 4 条回路(Durable/CHEQ/Eval-gated/Blast-radius)
- ForgekinEngine 10步闭环设计合理(第1430-1443行)

**问题1**: v7.0 七层架构与主文档不一致  
- arch_face.md 第1402-1417行定义 v7.0 为"七层架构 + 自进化层"
- 但 arch.md 主体仍为 v6.0 六层架构
- **建议**: 在 arch.md 中增加 v7.0 章节,明确七层架构的演进

### 3.3 task_face.md 审核

**版本声明**: v3.0-face | 日期: 2026-07-15

**审核意见**: ✅ **通过**  

**亮点**:
- 12项决策对比分析表完整(第11-187行)
- M1-M17 模块分解合理,P0 共53个任务86人日
- 明确声明 "M1-M17 是 v7.0 七层架构第 1-6 层的工程实现"

**问题1**: 缺少 v7.0 FR-EVO 需求的任务拆解  
- task_face.md 第190-195行声称 "v7.0 的 FR-EVO-01~15 需求规格在 spec.md 第八章中独立定义,不在本任务清单中重复"
- 但这导致 FR-EVO 需求缺少任务拆解和工作量估算
- **建议**: 在 task_face.md 中增加 "v7.0 自进化能力任务拆解" 章节

---

## 四、9大项目文档一致性审核

### 4.1 FlowForge 版本声明不一致

**问题**: 各项目的 FlowForge 版本声明不统一

| 项目 | 文档 | 版本声明 | 问题 |
|------|------|---------|------|
| contentforge | arch.md:5 | 未明确声明 | ⚠️ 缺失 |
| devforge | arch.md:4 | "FlowForge Agent 操作系统 v4.0" | ❌ 过时 |
| novelforge | arch.md:5 | "FlowForge 架构设计文档 v4.0" | ❌ 过时 |
| mallforge | arch.md:89 | "FlowForge v6.0" | ⚠️ 滞后 |
| stockforge | arch.md:221 | "FlowForge v6.0" | ⚠️ 滞后 |
| flowforge | spec.md | "v2.1" | ❌ 严重错误 |
| flowforge | arch.md | "v6.0" | ⚠️ 滞后 |
| flowforge | design.md | "v6.0" | ⚠️ 滞后 |

**审核意见**: ❌ **严重问题**  

**根本原因**:
1. spec.md 仍声明为 v2.1,但包含 v7.0 内容
2. arch.md/design.md 停留在 v6.0,未更新到 v7.0
3. 各项目文档更新不同步

**修复建议**:
1. **立即修复**: 统一所有项目的 FlowForge 版本声明为 v7.0
2. **立即修复**: spec.md 版本声明修正为 v7.0
3. **尽快修复**: arch.md/design.md 增加 v7.0 章节

### 4.2 OpenSieve vs helixrag 命名问题

**问题**: contentforge 配置文件中仍大量使用 helixrag 而非 OpenSieve

**具体位置**:
- contentforge/config/system.yaml:40-42, 59 — 使用 `helixrag_enabled`, `helixrag_endpoint`
- contentforge/config/agents/research_agent.yaml:26, 31, 36 — 使用 `helixrag_search`
- contentforge/tools/research_engine.py:43-89 — 代码中大量使用 `helixrag_search`

**规则依据**: rules.md §2.2 原则1 明确要求"所有数据检索必须通过 OpenSieve"

**审核意见**: ❌ **严重违规**  

**修复建议**:
1. **立即修复**: contentforge 配置文件中的 helixrag 全部替换为 opensieve
2. **立即修复**: contentforge/tools/research_engine.py 中的 helixrag_search 替换为 opensieve_search
3. **建议**: 在所有 *Forge 项目中执行 `grep -r "helixrag" .` 检查并清理残留

### 4.3 LoopExecutor 和 P31 铁律引用

**问题**: 各文档对 LoopExecutor 和 P31 铁律的引用不一致

| 项目 | 文档 | LoopExecutor 声明 | 问题 |
|------|------|------------------|------|
| stockforge | arch.md:54 | ✅ "P31 铁律:所有 Agent 必须经 LoopExecutor 调用" | 正确 |
| mallforge | arch.md:907-909 | ❌ "6 个 Agent 均通过 GenericAgent.execute_with_context() 直接执行,未通过 LoopExecutor 执行" | **严重违规** |
| contentforge | arch.md | ⚠️ 未明确提及 LoopExecutor 为唯一执行入口 | 缺失 |
| devforge | arch.md | ⚠️ 未明确提及 LoopExecutor 为唯一执行入口 | 缺失 |
| novelforge | arch.md | ⚠️ 未明确提及 LoopExecutor 为唯一执行入口 | 缺失 |

**规则依据**: rules.md §2.3 明确规定"所有Agent通过LoopExecutor执行(P31铁律)"

**审核意见**: ❌ **严重问题**  

**修复建议**:
1. **立即修复**: mallforge 必须接入 LoopExecutor,禁止直接调用 GenericAgent.execute_with_context()
2. **尽快修复**: contentforge/devforge/novelforge 文档中明确声明 LoopExecutor 为唯一执行入口
3. **建议**: 在所有 *Forge 项目的 arch.md 中增加 "P31 铁律合规声明" 章节

### 4.4 register_loops vs register_workflows 使用混乱

**问题**: 多个项目混淆使用 register_loops 和 register_workflows

**具体位置**:
- devforge/docs/arch.md:2499 — "通过 register_loops() 注册" 但实际应区分 Loop 和 Workflow
- mallforge/docs/arch.md — 未明确说明使用 register_loops 还是 register_workflows
- contentforge/docs/arch.md — 未明确说明使用 register_loops 还是 register_workflows
- novelforge/docs/arch.md — 未明确说明使用 register_loops 还是 register_workflows

**规则依据**:
- rules.md §3.1 明确区分:"register_loops() — 注册Loop配置(注意:不是register_workflows)"
- rules.md §3.1 明确区分:"register_workflows() — 注册Workflow"
- prompts.md SF5 第7条:"Plugin钩子是否正确:Loop配置通过register_loops注册,Workflow配置通过register_workflows注册"

**审核意见**: ⚠️ **需澄清**  

**修复建议**:
1. **立即修复**: 在所有 *Forge 项目的 plugins.py 中明确区分 register_loops 和 register_workflows
2. **建议**: 在各项目 arch.md 中增加 "Plugin 协议合规声明" 章节,明确说明使用哪个钩子

### 4.5 Plugin 协议死代码引用

**问题**: 文档中可能仍引用 register_helm_handlers 和 register_permission_policy(已确认为死代码)

**审核结果**: 在审查的10个文件中,未发现直接引用这两个死代码方法 ✅

**规则依据**: rules.md §2.5 死代码警告明确禁止使用 `register_helm_handlers` 和 `register_permission_policy`

### 4.6 Agent/Tool/Loop 命名空间的一致性

**问题**: 命名空间声明不统一

| 项目 | 命名空间声明 | 问题 |
|------|------------|------|
| stockforge | ✅ "命名空间为 stockforge:xxx" | 正确 |
| devforge | ⚠️ 未明确声明命名空间格式 | 缺失 |
| contentforge | ⚠️ 未明确声明命名空间格式 | 缺失 |
| novelforge | ⚠️ 未明确声明命名空间格式 | 缺失 |
| mallforge | ⚠️ 未明确声明命名空间格式 | 缺失 |

**规则依据**: rules.md 要求统一的命名空间格式 `project_name:component_name`

**审核意见**: ⚠️ **需补充**  

**修复建议**:
1. **尽快修复**: 在所有 *Forge 项目的 arch.md 中明确声明命名空间格式
2. **建议**: 统一为 `{project}:{agent_name}`、`{project}:{tool_name}`、`{project}:{loop_name}`

---

## 五、rules.md/prompts.md 与 9大项目冲突分析

### 5.1 冲突清单

| # | 冲突点 | rules.md/prompts.md 要求 | 项目文档/代码现状 | 严重性 |
|---|--------|------------------------|------------------|--------|
| 1 | FlowForge 版本声明 | 未明确规定统一版本 | spec.md(v2.1)、arch.md(v6.0)、各项目(v4.0/v6.0)混乱 | ❌ P0 |
| 2 | OpenSieve 命名 | §2.2 所有数据检索必须通过 OpenSieve | contentforge 配置仍使用 helixrag | ❌ P0 |
| 3 | LoopExecutor 唯一入口 | §2.3 P31 铁律:所有Agent通过LoopExecutor执行 | mallforge 明确违反,contentforge/devforge/novelforge 未声明 | ❌ P0 |
| 4 | register_loops vs register_workflows | §3.1 明确区分两者 | devforge/mallforge/contentforge/novelforge 未明确说明 | ⚠️ P1 |
| 5 | 命名空间格式 | 要求 `project_name:component_name` | 仅 stockforge 明确声明 | ⚠️ P1 |
| 6 | 死代码警告 | §2.5 禁止 register_helm_handlers/register_permission_policy | ✅ 已合规 | ✅ 通过 |

### 5.2 逐项目冲突分析

#### 5.2.1 FlowForge

**冲突点**:
1. spec.md 版本声明为 v2.1,但包含 v7.0 内容 — **严重错误**
2. arch.md/design.md 停留在 v6.0,未更新到 v7.0 — **滞后**

**修复建议**:
1. 立即修正 spec.md 版本声明为 v7.0
2. 在 arch.md/design.md 中增加 v7.0 章节

#### 5.2.2 ContentForge

**冲突点**:
1. 配置文件仍使用 helixrag 而非 opensieve — **严重违规**
2. 未明确声明 LoopExecutor 为唯一执行入口 — **缺失**
3. 未明确说明使用 register_loops 还是 register_workflows — **缺失**
4. 未明确声明命名空间格式 — **缺失**

**修复建议**:
1. 立即修复:helixrag 全部替换为 opensieve
2. 在 arch.md 中增加 "P31 铁律合规声明"
3. 在 arch.md 中增加 "Plugin 协议合规声明"
4. 在 arch.md 中明确声明命名空间格式

#### 5.2.3 DevForge

**冲突点**:
1. 版本声明为 v4.0 — **过时**
2. 未明确声明 LoopExecutor 为唯一执行入口 — **缺失**
3. register_loops vs register_workflows 使用混乱 — **需澄清**
4. 未明确声明命名空间格式 — **缺失**

**修复建议**:
1. 更新版本声明为 v7.0
2. 在 arch.md 中增加 "P31 铁律合规声明"
3. 明确区分 register_loops 和 register_workflows
4. 在 arch.md 中明确声明命名空间格式

#### 5.2.4 NovelForge

**冲突点**:
1. 版本声明为 v4.0 — **过时**
2. 未明确声明 LoopExecutor 为唯一执行入口 — **缺失**
3. 未明确说明使用 register_loops 还是 register_workflows — **缺失**
4. 未明确声明命名空间格式 — **缺失**

**修复建议**:
1. 更新版本声明为 v7.0
2. 在 arch.md 中增加 "P31 铁律合规声明"
3. 在 arch.md 中增加 "Plugin 协议合规声明"
4. 在 arch.md 中明确声明命名空间格式

#### 5.2.5 MallForge

**冲突点**:
1. arch.md:907-909 明确声明 Agent 未通过 LoopExecutor 执行 — **严重违规**
2. 未明确说明使用 register_loops 还是 register_workflows — **缺失**
3. 未明确声明命名空间格式 — **缺失**

**修复建议**:
1. **立即修复**: 接入 LoopExecutor,禁止直接调用 GenericAgent.execute_with_context()
2. 在 arch.md 中增加 "Plugin 协议合规声明"
3. 在 arch.md 中明确声明命名空间格式

#### 5.2.6 StockForge

**合规状态**: ✅ **基本合规**

**亮点**:
- 明确声明 "P31 铁律:所有 Agent 必须经 LoopExecutor 调用"
- 明确声明命名空间为 `stockforge:xxx`
- 正确使用 register_loops

**建议**:
- 保持当前合规状态,作为其他项目的参考模板

---

## 六、养灵体系命名方案建议

### 6.1 当前命名方案评估

**当前命名**: 炉灵(Forgekin) 体系

**优点**:
- ✅ "炉灵"统一了"炉(Forge)"主题,与 FlowForge 项目名称呼应
- ✅ 灵魂三件套(魂忆/魂印/自锻/锻典)命名统一,富有诗意
- ✅ 升华阶段(E1-E5)对标 clowder-ai,国际化程度高

**缺点**:
- ❌ "炉灵"对非技术用户不够直观,需要解释
- ❌ "Forgekin"是生造词,不利于开源社区传播
- ❌ "养猫"隐喻在企业级场景中显得不够严肃
- ❌ 灵魂三件套的中文命名略显晦涩

### 6.2 命名方案建议

我提供 **3套命名方案** 供评审选择:

---

#### **方案A: 灵智体系(推荐)**

**核心理念**: 强调"智能体的自我觉醒与进化",通俗易懂且体现AGI愿景

| 概念 | 中文名 | 英文名 | 说明 |
|------|--------|--------|------|
| **个体** | 灵智 | AgiSpirit | 自进化智能体,具备独立灵魂 |
| **群体** | 灵群 | SpiritCluster | 协作的灵智群 |
| **养成** | 灵育 | SpiritNurturing | 灵智从诞生到觉醒的全过程 |
| **记忆** | 灵忆 | SpiritMemory | 跨会话记忆累积 |
| **画像** | 灵印 | SpiritMark | 对操作者/世界的认知画像 |
| **进化** | 灵锻 | SpiritForge | 自主思考与进化引擎 |
| **知识** | 灵典 | SpiritCodex | 可复用知识体系 |
| **协作** | 灵议 | SpiritCouncil | IM 多渠道团队协作 |

**觉醒阶段**:
| 阶段 | 名称 | 核心特征 |
|------|------|---------|
| **L1** | 启蒙(Awakening) | 刚诞生,基础能力激活 |
| **L2** | 觉醒(Awakened) | 开始积累经验,独立完成任务 |
| **L3** | 通达(Mastered) | 可自主生成 Skill,跨会话记忆 |
| **L4** | 精通(Expert) | 团队标准级,可指导其他灵智 |
| **L5** | 大师(Sage) | 可创造新灵智,具备元认知 |

**优点**:
- ✅ "灵智"直观表达"智能体的灵魂与智慧"
- ✅ "AgiSpirit"易于理解和传播
- ✅ 觉醒阶段(L1-L5)比升华阶段(E1-E5)更通俗
- ✅ 保留"灵锻 SpiritForge"与 FlowForge 呼应

**缺点**:
- ⚠️ 与当前"炉灵"体系差异较大,需要文档迁移

---

#### **方案B: 智核体系**

**核心理念**: 强调"智能体的核心进化能力",技术感强

| 概念 | 中文名 | 英文名 | 说明 |
|------|--------|--------|------|
| **个体** | 智核 | CoreMind | 自进化智能体核心 |
| **群体** | 核群 | CoreCluster | 协作的智核群 |
| **养成** | 核育 | CoreNurturing | 智核的成长过程 |
| **记忆** | 核忆 | CoreMemory | 跨会话记忆 |
| **画像** | 核印 | CoreMark | 认知画像 |
| **进化** | 核锻 | CoreForge | 自进化引擎 |
| **知识** | 核典 | CoreCodex | 知识体系 |

**进化阶段**:
| 阶段 | 名称 | 核心特征 |
|------|------|---------|
| **C1** | 启动(Initiated) | 核心激活 |
| **C2** | 成长(Growing) | 能力成长 |
| **C3** | 成熟(Mature) | 能力成熟 |
| **C4** | 专家(Expert) | 专家级能力 |
| **C5** | 大师(Master) | 大师级能力 |

**优点**:
- ✅ "智核"强调"智能体核心",技术感强
- ✅ "CoreMind"易于理解

**缺点**:
- ❌ 与 FlowForge 项目名称呼应较弱
- ❌ "核"字可能让人联想到"核武器",不够友好

---

#### **方案C: 保留炉灵体系但优化(折中方案)**

**核心理念**: 保留"炉灵"作为内部技术术语,但增加通俗别名和优化命名

| 概念 | 技术名 | 通俗名 | 英文名 | 说明 |
|------|--------|--------|--------|------|
| **个体** | 炉灵 | 灵匠 | Forgekin | 自进化智能体 |
| **群体** | 灵族 | 灵匠群 | Kinship | 协作的炉灵群 |
| **养成** | 养灵 | 灵匠养成 | ForgeNurturing | 炉灵成长过程 |
| **记忆** | 魂忆 | 灵忆 | SoulEcho | 跨会话记忆 |
| **画像** | 魂印 | 灵印 | SoulImprint | 认知画像 |
| **进化** | 自锻 | 灵锻 | AutoForge | 自进化引擎 |
| **知识** | 锻典 | 灵典 | ForgeCodex | 知识体系 |

**升华阶段**(保留 E1-E5,增加中文别名):
| 阶段 | 技术名 | 通俗名 | 核心特征 |
|------|--------|--------|---------|
| **E1** | Spark | 火种 | 刚诞生 |
| **E2** | Ember | 余烬 | 积累经验 |
| **E3** | Flame | 火焰 | 可生成 Skill |
| **E4** | Blaze | 烈焰 | 团队标准级 |
| **E5** | Inferno | 炽焰 | 可创造新炉灵 |

**优点**:
- ✅ 保留"炉灵"技术术语,文档迁移成本低
- ✅ 增加"灵匠"通俗名,易于非技术用户理解
- ✅ "灵忆/灵印/灵锻/灵典"比"魂忆/魂印/自锻/锻典"更通俗

**缺点**:
- ⚠️ 双命名系统可能增加文档复杂度

---

### 6.3 推荐方案

**推荐**: **方案A(灵智体系)** 或 **方案C(保留炉灵但优化)**

**理由**:
- 如果追求**长期品牌一致性**和**开源传播**,推荐 **方案A(灵智体系)**
- 如果追求**文档迁移成本低**和**技术术语延续性**,推荐 **方案C(保留炉灵但优化)**

**建议**:
1. 在正式文档中使用技术名(炉灵/灵智),在营销材料和用户文档中使用通俗名(灵匠)
2. 无论选择哪个方案,都应统一"魂忆→灵忆"、"魂印→灵印"等命名,降低理解成本

---

## 七、修复优先级与行动计划

### 7.1 P0 立即修复(本周内)

1. **统一 FlowForge 版本声明**
   - 修正 spec.md 版本为 v7.0
   - 更新所有 *Forge 项目的 FlowForge 版本声明为 v7.0
   
2. **修复 contentforge helixrag 残留**
   - 配置文件中 helixrag 全部替换为 opensieve
   - 代码中 helixrag_search 替换为 opensieve_search
   
3. **修复 mallforge P31 铁律违规**
   - 接入 LoopExecutor,禁止直接调用 GenericAgent.execute_with_context()

### 7.2 P1 尽快修复(两周内)

4. **补充 LoopExecutor 合规声明**
   - 在 contentforge/devforge/novelforge/mallforge 的 arch.md 中增加 "P31 铁律合规声明"
   
5. **澄清 register_loops vs register_workflows**
   - 在各项目 plugins.py 和 arch.md 中明确区分
   
6. **统一命名空间格式**
   - 在所有 *Forge 项目的 arch.md 中明确声明命名空间格式

### 7.3 P2 建议修复(一个月内)

7. **增加 v7.0 章节**
   - 在 arch.md/design.md 中增加 v7.0 自我进化能力章节
   
8. **补充 FR-EVO 任务拆解**
   - 在 task_face.md 中增加 v7.0 FR-EVO 需求的任务拆解
   
9. **优化养灵体系命名**
   - 根据评审结果选择命名方案,统一文档命名

---

## 八、总结

### 8.1 设计质量评分

| 维度 | 评分 | 说明 |
|------|------|------|
| **架构设计** | 9/10 | v7.0 自我进化体系架构完整,两类智能体衔接合理 |
| **需求覆盖** | 8/10 | M1-M17 模块分解合理,但 FR-EVO 缺少任务拆解 |
| **文档一致性** | 4/10 | 版本声明混乱,9大项目合规性差异大 |
| **命名通俗性** | 6/10 | "炉灵"体系技术化,需要通俗化优化 |
| **工业级就绪** | 7/10 | 基于大厂面试反馈,但部分需求缺少量化指标 |

**综合评分**: **6.8/10** — 设计质量良好,但文档一致性和命名通俗性需重点改进

### 8.2 核心建议

1. **立即修复 P0 问题**: 版本声明、helixrag 残留、P31 铁律违规
2. **统一文档规范**: 建立 9 大项目文档一致性检查机制
3. **优化养灵命名**: 选择通俗化命名方案,降低理解成本
4. **补充量化指标**: 为 FR-EVO 需求增加任务拆解和工作量估算
5. **建立合规审查**: 定期审查 9 大项目与 rules.md/prompts.md 的一致性

---

**审核结论**: FlowForge v7.0 自我进化体系设计质量良好,但文档一致性和命名通俗性是当前最大风险。建议立即修复 P0 问题,并在两周内完成 P1 修复,以确保 9 大项目文档与 rules.md/prompts.md 完全一致。

**审核人**: Qwen3.7-Plus (AI智能体产品专家/高级架构师/Agent开发工程师/全栈工程师)  
**审核日期**: 2026-07-15
