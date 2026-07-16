# FlowForge v7.0 自我进化与养灵体系设计文档审核意见

> **审核日期**: 2026-07-16  
> **审核范围**: flowforge/docs/spec.md, arch.md, design.md, face/ 下所有需求设计文档 + flowforge 核心代码  
> **审核基线**: hiclaw/rules.md v3.0, hiclaw/prompts.md  
> **审核角色**: AI智能体产品专家、AI高级架构师、AI智能体Agent开发工程师、高级软件全栈工程师  
> **审核对象**: FlowForge v7.0 自我进化能力与养灵体系设计

---

## 一、总体评价

### 1.1 设计亮点

✅ **v7.0 自我进化体系定位清晰**: 从"Agent 驾驭层"进化为"自进化 Agent 驾驭操作系统"，核心公式 `Agent = Model + Harness + Soul` 精准表达了版本跃迁

✅ **炉灵(Forgekin)体系概念完整**: 灵魂三件套(Soul Profile / Soul Echo / Soul Imprint) + 自锻引擎(Auto-Forge) + 锻典(Forge Codex) + 灵议(Forgekin Council)构成完整的自进化闭环

✅ **两类智能体单向依赖设计合理**: Forgekin 调用 Static Agent，Static Agent 不感知 Forgekin 存在，符合 rules.md §2.4 单向依赖原则

✅ **升华阶段 E1-E6 设计清晰**: 对标 clowder-ai 知识成熟度阶梯，五级晋升路径 + 降级/冻结机制完整

✅ **方法论来源扎实**: 深度借鉴 clowder-ai 养猫体系、MemGPT 三层记忆、Voyager 技能库、Self-Refine/Reflexion 闭环等前沿研究

✅ **工业级需求覆盖全面**: face/ 目录基于 10+ 大厂面试反馈，M1-M17 模块分解合理，9 大能力维度归纳方法科学

### 1.2 核心问题

❌ **版本声明严重不一致**: spec.md 头部声明 v2.1 但内含 v7.0 内容，arch.md 头部声明 v6.0 但内含 v7.0 内容，design.md 同样问题

❌ **代码与设计文档不同步**: PluginProtocol 缺少 `register_forgekin` 钩子（arch.md 已定义），WebSearchAgent 违反 P31 铁律

❌ **helixrag 残留范围远超预期**: 不仅 contentforge 配置文件，flowforge/web 前端、openclaw_pkg/workspace/life、flowforge/config/default.yaml 均存在大量残留

❌ **face/ 文档与主文档架构冲突**: face/arch_face.md 定义 v3.0 七层（第7层为"互联层"），而主文档 v7.0 七层（第7层为"自进化层"），概念混淆

❌ **养灵体系命名可优化**: "炉灵 Forgekin"对非技术用户不够直观，"魂忆/魂印/自锻/锻典"略显晦涩

---

## 二、v7.0 自我进化体系深度审核

### 2.1 核心公式审核

**文档声明** (spec.md L2906-2907):
```
v6.0: Agent = Model (Brain) + Harness (Body)
v7.0: Agent = Model + Harness + Soul (自我进化灵魂)
```

**审核意见**: ✅ **通过**

公式清晰表达了 v7.0 的核心进化——在 Brain + Body 基础上增加 Soul。但需注意，spec.md 第 1 章（L17-18）仍保留 v2.1 版本的公式 `Agent = Model (Brain) + Harness (Body)`，与 v7.0 公式冲突。**建议在文档头部增加版本演进说明**。

### 2.2 炉灵体系核心概念审核

**文档定义** (spec.md L2929-2942):

| 概念 | 中文名 | 英文名 | 对标 clowder-ai | 含义 |
|------|--------|--------|----------------|------|
| 个体 | 炉灵 | Forgekin | Cat | 具备独立身份、记忆、人格的自进化智能体 |
| 群体 | 灵族 | Kinship | Clowder | 一群协作的炉灵 |
| 养成 | 养灵 | Forge Nurturing | 养猫 | 炉灵从诞生到升华的全过程 |
| 入门训练 | 炉启 | Forge Initiation | Bootcamp | 新炉灵的入门训练 |
| 协作模式 | 共鸣 | Resonance | Swarm | 炉灵群体的协作模式 |
| 自主思考 | 自锻 | Auto-Forge | Auto-Dream | 无人驱动时的自主思考与进化 |
| 记忆 | 魂忆 | Soul Echo | Memory | 炉灵的累积记忆与经验 |
| 画像 | 魂印 | Soul Imprint | Profile | 炉灵对操作者/世界的认知画像 |
| 技能库 | 锻典 | Forge Codex | Skill Library | 可复用知识体系 |
| 知识阶梯 | 火种等级 | Ember Hierarchy | L0-L4 | 知识成熟度阶梯 |
| 成长阶段 | 升华阶 | Ascension Stages | 9 Lives | 炉灵成长的生命阶段 |
| IM 议事 | 灵议 | Forgekin Council | IM 团队协作 | 炉灵间的即时通讯与议事 |

**审核意见**: ⚠️ **需优化**

**问题1**: "炉灵 Forgekin"命名问题
- "炉灵"对非技术用户（业务专家、产品经理）不够直观，需要额外解释
- "Forgekin"是生造词（Forge + kin），不利于开源社区传播
- "灵族 Kinship"、"共鸣 Resonance"、"升华阶 Ascension Stages"等英文与中文对应关系不够直观
- **建议**: 保留"炉灵"作为内部技术术语，但增加通俗别名；详见第六章命名方案

**问题2**: "养猫"隐喻在企业级场景中的适配性
- 对标 clowder-ai 的"养猫"隐喻虽然生动，但在企业级文档中显得不够严肃
- spec.md L2919 描述"把 Agent 当作需要被约束和引导的'野兽'"——这个比喻与"养灵"的正面隐喻存在张力
- **建议**: 在正式文档中使用"自进化智能体养成"，在内部沟通中保留"养灵"比喻

**问题3**: 灵魂三件套中文命名可优化
- "魂忆"、"魂印"、"自锻"、"锻典"统一了"魂/锻"主题，但"魂忆"与"回忆"同音易混淆，"魂印"不够直观
- **建议**: 增加通俗别名：魂忆(跨会话记忆)、魂印(认知画像)、自锻(自主进化引擎)、锻典(技能知识库)

**问题4**: 概念命名不一致
- spec.md L2935 使用"共鸣 Resonance"作为协作模式，但 arch.md 使用"灵议 Forgekin Council"作为 IM 协作
- "共鸣"与"灵议"之间的关系未明确说明
- **建议**: 明确区分"共鸣(多炉灵协作模式)"与"灵议(IM 渠道议事)"，在概念表中增加说明

### 2.3 升华阶段审核

**文档定义** (spec.md L3014-3021):

| 阶段 | 名称 | 对标 Ember | 核心特征 | 晋升条件 |
|------|------|-----------|---------|---------|
| E1 | Spark(火种) | L0 Episode | 刚诞生，仅有基础配置 | 完成 Forge Initiation |
| E2 | Ember(余烬) | L1 Pattern | 已积累 ≥2 个经验模式 | ≥2 个相似 Episode，5Q ≥ 7/10 |
| E3 | Flame(火焰) | L2 Draft | 能自主生成 Skill 草稿 | smoke gate ≥3 cases(≥2/3 通过) |
| E4 | Blaze(烈焰) | L3 Validated | Skill 经验证 | ≥6 uses，≥2 agents，≥80% 成功率 |
| E5 | Inferno(炽焰) | L4 Standard | 团队标准级 | ≥12 uses，最近10次 ≥90%，operator 批准 |
| E6 | Forge Master(锻师) | — | 可创建新炉灵 | operator 授权 + 创造 ≥1 个 E1 炉灵 |

**审核意见**: ⚠️ **需补充**

**问题1**: 术语定义不完整
- "5Q" (E2 晋升条件) 未在 spec.md 中定义——是指 5 个 Quality 维度？还是 clowder-ai 的 5Q 评估框架？
- "smoke gate" (E3 晋升条件) 未定义——是测试用例集？还是门禁检查？
- **建议**: 在 spec.md 第七章增加术语表，明确定义 5Q、smoke gate、Episode 等关键概念

**问题2**: E6 Forge Master 晋升条件过于模糊
- "operator 授权 + 创造 ≥1 个 E1 炉灵"——缺少量化指标
- 创造 E1 炉灵的质量如何评估？E1 炉灵需要达到什么标准才算"创造成功"？
- **建议**: 增加 "E5 阶段维持 ≥30 天 + 成功指导 ≥2 个 E2 炉灵 + 所创 E1 炉灵 30 天内无降级"

**问题3**: E1 命名不一致
- spec.md L3016 使用 "Spark(火种)"
- arch_face.md 可能使用 "Spark(火花)"（qianwen1.md 发现但在本次深度阅读中未定位到精确行号）
- **建议**: 统一为 "Spark(火种)"，在全文档中全局替换

**问题4**: 降级/冻结机制与晋升条件不对称
- spec.md L3023-3027 定义了降级条件（E3→E2: 最近3次成功率<50%），但未说明降级后的恢复机制
- E5 freeze 触发条件"1 次高风险越界"——"高风险越界"的定义是什么？谁来判定？
- **建议**: 补充恢复机制，明确"高风险越界"的判定标准（如：触碰安全红线列表中的任一项）

### 2.4 两类智能体衔接审核

**文档定义** (spec.md L2946-3008, arch.md L5416-5459):

**审核意见**: ✅ **通过，但需补充**

**亮点**:
- 单向依赖设计合理：Forgekin → Static Agent，符合 rules.md §2.4
- 衔接契约清晰：`delegate_to_static(agent_name, input)` → 结果回写 Soul Echo
- TaskRouter 路由逻辑合理（arch.md L5422-5427）

**问题1**: `delegate_to_static` 接口未在 PluginProtocol 中定义
- spec.md L3005 声明 "Forgekin 通过 `delegate_to_static(agent_name, input)` 调用静态智能体"
- 但在 `plugin_protocol.py` 中未定义此方法，也未在 arch.md 的 ForgekinEngine 伪代码中体现
- **建议**: 在 PluginProtocol 或 ForgekinEngine 中明确定义此接口

**问题2**: Forgekin 调用 Static Agent 是否经过 LoopExecutor？
- rules.md §2.3 P31 铁律要求"所有 Agent 通过 LoopExecutor 执行"
- 但 spec.md L3005 的 `delegate_to_static` 是否经过 LoopExecutor 未明确说明
- 如果 Forgekin 直接调用 Static Agent 绕过 LoopExecutor，则违反 P31 铁律
- **建议**: 明确声明 `delegate_to_static` 内部通过 LoopExecutor 执行

### 2.5 v7.0 核心能力清单审核

**文档定义** (spec.md L3031-3047):

**审核意见**: ⚠️ **需补充**

**问题1**: FR-EVO 编号已修正（qianwen1.md 指出的编号不连续问题已修复）
- 当前 FR-EVO-01 到 FR-EVO-15 连续完整 ✅

**问题2**: 缺少与 M1-M17 模块的映射关系
- task_face.md 声称 "M1-M17 任务已完美融入 v7.0 炉灵养成体系"
- 但 spec.md 中未明确说明 FR-EVO-01~15 与 M1-M17 的对应关系
- **建议**: 在 spec.md 第七章增加 "v7.0 需求与 M1-M17 模块映射表"

**问题3**: FR-EVO-07 "外部编码工具集成"与 FR-EVO-08 "Trae 监工 Bridge" 的边界模糊
- 两者都涉及外部工具调用，但一个通过 CLI Wrapper，一个通过 JSON 文件交换
- **建议**: 明确两者的适用场景：CLI Wrapper 用于有 CLI 的工具（Claude Code/Codex），Trae Bridge 用于无 CLI 的工具

---

## 三、face/ 需求设计文档审核

### 3.1 spec_face.md 审核

**版本声明**: v3.0 (face) | 日期: 2026-07-14

**定位**: 基于 FlowForge v2.1 + 多厂面试反馈 + 行业前沿痛点

**审核意见**: ⚠️ **需修正**

**问题1**: 版本声明与主文档冲突
- spec_face.md L7 声明"本文档与 flowforge/docs/spec.md v7.0（炉灵养成体系权威源）共同构成完整规格体系"
- 但 spec_face.md 自身版本为 v3.0-face，而引用的 spec.md 头部声明为 v2.1
- 读者无法判断 spec_face.md 的 v3.0 与 spec.md 的 v7.0 之间的版本关系
- **建议**: 在 spec_face.md 头部增加版本关系说明图：v2.1(六层) → v3.0-face(七层互联层) → v7.0(七层自进化层)

**问题2**: 基础版本声明错误
- spec_face.md L16 声明"基于 FlowForge v2.1 六层 Harness 架构"
- 但 spec_face.md 的七层架构第7层是"互联层"，与 v7.0 的七层第7层是"自进化层"不同
- 这导致读者困惑：v3.0 和 v7.0 的七层架构是什么关系？
- **建议**: 明确说明 v3.0-face 是 v7.0 的工程实现前置，v3.0 的七层(互联层)对应 v7.0 七层(自进化层)的第 1-6 层

**问题3**: 日期验证
- 文档日期为 "2026-07-14"，当前审核日期为 2026-07-16，日期合理 ✅

### 3.2 arch_face.md 审核

**版本声明**: v3.0-face | 日期: 2026-07-14

**审核意见**: ⚠️ **架构冲突**

**问题1**: 七层架构与主文档不一致（严重）
- arch_face.md L17-43 定义 v3.0 七层：第7层为**互联层(Interconnect Layer)**
- arch.md L5306-5329 定义 v7.0 七层：第7层为**自进化层(Evolution Layer)**
- 两个"七层架构"的第7层完全不同！这是严重的概念冲突
- **根本原因**: v3.0-face 的七层（互联层）是在 v2.1 六层基础上新增的，v7.0 的七层（自进化层）是在 v6.0 基础上新增的。但 face 文档使用了 v3.0 版本号，而主文档跳到了 v7.0
- **建议**:
  1. 在 arch_face.md 头部明确说明：v3.0-face 七层 = v2.1 六层 + 互联层，v7.0 七层 = v3.0-face 七层 + 自进化层（实际为八层？）
  2. 或者统一版本号：将 v3.0-face 重新编号为 v7.0 的一部分，互联层作为 v7.0 自进化层的工程支撑

**问题2**: 前置依赖声明错误
- arch_face.md L6 声明前置依赖为 "flowforge/docs/spec.md v2.1"
- 但 spec.md 实际包含 v7.0 内容
- **建议**: 修正为 "flowforge/docs/spec.md（v2.1 基础 + v7.0 自进化增量）"

**问题3**: 控制回路演进描述不完整
- arch_face.md L58-103 描述了 v2.1 → v3.0 的控制回路演进（新增 4 条回路）
- 但未说明这 4 条回路与 v7.0 自进化层的关系
- **建议**: 增加 "v3.0 控制回路对 v7.0 自进化层的支撑" 说明

### 3.3 task_face.md 审核

**版本声明**: v3.0-face | 日期: 2026-07-15

**审核意见**: ✅ **基本通过，需补充**

**亮点**:
- 12 项决策对比分析表完整，每项决策包含 3 个选项的对比分析
- M1-M17 模块分解合理，P0 共 53 个任务 86 人日
- 明确声明 "M1-M17 是 v7.0 七层架构第 1-6 层的工程实现"

**问题1**: 缺少 v7.0 FR-EVO 需求的任务拆解
- task_face.md L190-195 声称 "v7.0 的 FR-EVO-01~15 需求规格在 spec.md 第八章中独立定义，不在本任务清单中重复"
- 但这导致 FR-EVO 需求缺少任务拆解和工作量估算
- **建议**: 在 task_face.md 中增加 "v7.0 自进化能力任务拆解" 章节，或创建独立的 task_evo.md

**问题2**: 决策 5（多租户策略）推荐"延后 v3.1"，但 arch.md v7.0 中已包含多租户设计
- 如果 v7.0 自进化层需要多租户隔离（每个租户的炉灵数据隔离），则多租户不应延后
- **建议**: 重新评估多租户与 v7.0 自进化的依赖关系

---

## 四、flowforge 代码与设计文档一致性审核

### 4.1 PluginProtocol 缺少 register_forgekin 钩子

**设计文档要求** (arch.md L6170-6203):
```python
def register_forgekins(self, forgekin_registry) -> None:
    """注册炉灵角色配置"""
```

**代码现状** (`plugin_protocol.py`):
- 定义了 `register_agents`, `register_tools`, `register_loops`, `register_workflows` 等钩子
- **未定义 `register_forgekins`** 钩子 ❌

**审核意见**: ❌ **代码与设计文档不一致**

**影响**: 各 *Forge 项目无法通过 Plugin 协议注册炉灵角色，v7.0 自进化体系无法落地

**修复建议**:
1. 在 `plugin_protocol.py` 的 FlowForgePlugin 类中增加 `register_forgekins` 方法
2. 在 `PluginContext` 中增加 `forgekin_registry` 属性
3. 在插件加载流程中调用 `register_forgekins`

### 4.2 WebSearchAgent 违反 P31 铁律

**代码位置**: `flowforge/agents/generic/web_search_agent.py`

**违规内容**:
```python
# L15: 直接实现 execute_with_context，绕过 LoopExecutor
async def execute_with_context(self, input: AgentInput, context: Optional[TaskContext]) -> AgentOutput:
    # L47: 直接调用 _call_tool
    search_result = await self._call_tool(context, "opensieve_search", {...})
    # L61: 直接调用 _call_tool
    search_result = await self._call_tool(context, "web_search", {...})
```

**规则依据**: rules.md §2.3 P31 铁律——"LoopExecutor 是所有 Agent 的**唯一执行入口**"

**审核意见**: ❌ **严重违规**

**修复建议**:
1. WebSearchAgent 改为通过 LoopExecutor 执行，而非直接调用 `_call_tool`
2. 或者将 WebSearchAgent 从 FlowForge 核心移除，因为它是业务特定 Agent，不属于平台层

### 4.3 WebSearchTool 直接访问外部搜索引擎

**代码位置**: `flowforge/tools/web_search.py`

**违规内容**:
```python
# L17-21: 直接配置 DuckDuckGo 和 Tavily 搜索引擎
_ENGINE_MODULE_MAP: dict[str, tuple[str, str]] = {
    "opensieve_search": ("flowforge.tools.opensieve_client", "OpenSieveClient"),
    "duckduckgo_search": ("flowforge.tools.duckduckgo_search", "DuckDuckGoSearchTool"),
    "tavily_search": ("flowforge.tools.tavily_search", "TavilySearchTool"),
}
```

**规则依据**: 
- rules.md §2.2 原则1——"所有数据检索必须通过 OpenSieve"
- project_memory——"外部 API 访问（如 Tavily, DuckDuckGo）必须注册为 SearchSource 在 OpenSieve 内；项目模块禁止直接访问"

**审核意见**: ❌ **严重违规**

**影响**: DuckDuckGo 和 Tavily 作为外部搜索 API，应该通过 OpenSieve 的 SearchSource 协议注册和调用，而非在 FlowForge 核心代码中直接 import

**修复建议**:
1. 将 DuckDuckGo 和 Tavily 注册为 OpenSieve 的 SearchSource
2. WebSearchTool 的 fallback_chain 中只保留 `opensieve_search`
3. 如果 OpenSieve 不可用，降级到 LLM WebChat 搜索（当前已实现）

### 4.4 WebSearchAgent 是业务特定 Agent，违反平台纯度原则

**代码位置**: `flowforge/agents/generic/web_search_agent.py`

**问题**: WebSearchAgent 是一个业务特定的搜索 Agent，它包含多级回退逻辑（OpenSieve → Web Search → LLM WebChat → 纯 LLM），这是业务逻辑，不应放在 FlowForge 平台层

**规则依据**: rules.md 架构原则——FlowForge 是平台层，不应包含业务特定 Agent

**审核意见**: ⚠️ **需迁移**

**修复建议**:
1. 将 WebSearchAgent 迁移到 OpenSieve 项目（作为 Native Agent）
2. 或者迁移到各 *Forge 项目的 `config/agents/` 目录
3. FlowForge 核心只保留 Agent 基类和注册机制

### 4.5 flowforge/config/default.yaml 中 helixrag 残留

**代码位置**: `flowforge/config/default.yaml:129`

```yaml
helixrag:
  # ... 配置项
```

**审核意见**: ❌ **需修复**

### 4.6 flowforge/web 前端 helixrag 残留

**代码位置**:
- `flowforge/web/src/components/helm/ArtifactPanel.tsx:63-64, 78-79` — 使用 `helixrag` 和 `helixrag_search` 图标
- `flowforge/web/src/components/helm/helm-utils.ts:159, 171` — 包含 `helixrag` 字符串匹配
- `flowforge/web/src/components/helm/ToolCallCard.tsx:12-13` — 使用 `helixrag` 图标映射
- `flowforge/web/src/components/helm/ChatStream.tsx:126` — 包含 `helixrag` 字符串匹配

**审核意见**: ❌ **需修复**

虽然前端代码中同时保留了 `helixrag` 和 `opensieve` 的兼容映射（如 `helm-utils.ts:159` 中 `opensieve: "🔍", opensieve_search: "🔍", helixrag: "🔍", helixrag_search: "🔍"`），但按照 project_memory 要求"helixrag 已更名为 opensieve，所有引用必须使用新名称"，应移除 helixrag 兼容映射。

**修复建议**:
1. 移除所有前端代码中的 `helixrag` 图标/字符串映射
2. 仅保留 `opensieve` 和 `opensieve_search` 映射

---

## 五、9大项目文档一致性审核

### 5.1 FlowForge 版本声明不一致

**问题**: 各项目的 FlowForge 版本声明不统一

| 项目 | 文档 | 版本声明 | 问题 |
|------|------|---------|------|
| flowforge | spec.md:1 | "v2.1" | ❌ 严重错误：头部 v2.1，但 L2900 起为 v7.0 内容 |
| flowforge | arch.md:1 | "v6.0" | ❌ 严重错误：头部 v6.0，但 L5293 起为 v7.0 内容 |
| flowforge | design.md | "v6.0" | ❌ 同上 |
| flowforge/face | spec_face.md | "v3.0 (face)" | ⚠️ 与 v7.0 主文档版本关系不明 |
| flowforge/face | arch_face.md | "v3.0-face" | ⚠️ 同上 |
| contentforge | arch.md | 未明确声明 FlowForge 版本 | ⚠️ 缺失 |
| devforge | arch.md | "FlowForge Agent 操作系统 v4.0" | ❌ 过时 |
| novelforge | arch.md | "FlowForge 架构设计文档 v4.0" | ❌ 过时 |
| mallforge | arch.md | "FlowForge v6.0" | ⚠️ 滞后 |
| stockforge | arch.md | "FlowForge v6.0" | ⚠️ 滞后 |

**审核意见**: ❌ **严重问题——版本体系混乱是当前最大风险**

**根本原因**:
1. spec.md 头部 v2.1 未更新，但在文档末尾追加了 v7.0 内容——这是"追加式写作"的典型问题
2. arch.md/design.md 同样头部声明旧版本，末尾追加新版本
3. face/ 文档使用独立的 v3.0-face 版本号，与主文档 v7.0 的关系不清晰
4. 各 *Forge 项目文档更新不同步

**修复建议**:
1. **立即修复**: spec.md 头部版本声明修正为 v7.0，增加版本演进说明
2. **立即修复**: arch.md 头部版本声明修正为 v7.0
3. **立即修复**: design.md 头部版本声明修正为 v7.0
4. **尽快修复**: 统一所有 *Forge 项目的 FlowForge 版本声明为 v7.0
5. **建议**: 在 face/ 文档头部增加版本关系图：v2.1(六层) → v3.0-face(七层互联) → v7.0(七层自进化)

### 5.2 OpenSieve vs helixrag 命名问题

**审核范围**: 全项目 `grep -r "helixrag"` 扫描

**残留清单**:

| 位置 | 文件 | 严重性 |
|------|------|--------|
| contentforge 配置 | `config/system.yaml` | ❌ P0 |
| contentforge 配置 | `config/agents/research_agent.yaml` | ❌ P0 |
| contentforge 代码 | `tools/research_engine.py` | ❌ P0 |
| flowforge 配置 | `config/default.yaml:129` | ❌ P0 |
| flowforge 前端 | `web/src/components/helm/ArtifactPanel.tsx` | ⚠️ P1 |
| flowforge 前端 | `web/src/components/helm/helm-utils.ts` | ⚠️ P1 |
| flowforge 前端 | `web/src/components/helm/ToolCallCard.tsx` | ⚠️ P1 |
| flowforge 前端 | `web/src/components/helm/ChatStream.tsx` | ⚠️ P1 |
| openclaw_pkg | `workspace/life/.../helixrag_client.py` | ⚠️ P1 |
| openclaw_pkg | `workspace/life/.../config/default.yaml` | ⚠️ P1 |
| openclaw_pkg | `workspace/life/.../topic_selector.py` | ⚠️ P1 |
| novelforge | `docs/task.md` (仅修复记录) | ✅ 已记录 |

**规则依据**: rules.md §2.2 原则1——"所有数据检索必须通过 OpenSieve"；project_memory——"helixrag 已更名为 opensieve"

**审核意见**: ❌ **严重问题——残留范围远超预期**

**修复建议**:
1. **立即修复**: contentforge 配置/代码中的 helixrag → opensieve
2. **立即修复**: flowforge/config/default.yaml 中的 helixrag → opensieve
3. **尽快修复**: flowforge/web 前端移除 helixrag 兼容映射
4. **尽快修复**: openclaw_pkg/workspace/life 中的 helixrag_client.py 重命名为 opensieve_client.py
5. **建议**: 在 CI/CD 中增加 `grep -r "helixrag"` 检查，阻止新代码引入 helixrag 引用

### 5.3 LoopExecutor 和 P31 铁律引用

**问题**: 各文档对 LoopExecutor 和 P31 铁律的引用不一致

| 项目 | 文档 | LoopExecutor 声明 | 问题 |
|------|------|------------------|------|
| stockforge | arch.md | ✅ "P31 铁律：所有 Agent 必须经 LoopExecutor 调用" | 正确 |
| mallforge | arch.md:155 | ❌ `execute_with_context(input, None)` 直接调用 | **严重违规** |
| mallforge | design.md | ✅ 已明确声明 P31 铁律 | design.md 已修复但 arch.md 未同步 |
| contentforge | arch.md | ⚠️ 未明确提及 LoopExecutor 为唯一执行入口 | 缺失 |
| devforge | arch.md | ⚠️ 未明确提及 LoopExecutor 为唯一执行入口 | 缺失 |
| novelforge | arch.md | ⚠️ 未明确提及 LoopExecutor 为唯一执行入口 | 缺失 |
| flowforge | web_search_agent.py | ❌ 直接调用 `_call_tool`，绕过 LoopExecutor | **严重违规** |

**规则依据**: rules.md §2.3 P31 铁律

**审核意见**: ❌ **严重问题——mallforge 和 flowforge 核心代码均存在违规**

**修复建议**:
1. **立即修复**: mallforge arch.md 更新为 LoopExecutor 调用方式
2. **立即修复**: flowforge WebSearchAgent 改为通过 LoopExecutor 执行
3. **尽快修复**: contentforge/devforge/novelforge 文档中明确声明 LoopExecutor 为唯一执行入口
4. **建议**: 在所有 *Forge 项目的 arch.md 中增加 "P31 铁律合规声明" 章节

### 5.4 register_loops vs register_workflows 使用混乱

**问题**: 多个项目混淆使用 register_loops 和 register_workflows

| 项目 | plugins.py | 使用钩子 | 问题 |
|------|-----------|---------|------|
| stockforge | plugins.py:701 | `register_loops` | ✅ 正确 |
| contentforge | plugins.py:105 | `register_workflows` | ⚠️ 需确认：配置的是 Loop 还是 Workflow？ |
| devforge | plugins.py:222 | `register_workflows` | ⚠️ 需确认：配置的是 Loop 还是 Workflow？ |
| novelforge | plugins.py | 未找到 | ⚠️ 缺失 |
| mallforge | plugins.py | 未找到 | ⚠️ 缺失 |

**规则依据**:
- rules.md §3.1——"register_loops() — 注册 Loop 配置（注意：不是 register_workflows）"
- prompts.md SF5 第7条——"Plugin 钩子是否正确：Loop 配置通过 register_loops 注册，Workflow 配置通过 register_workflows 注册"

**审核意见**: ⚠️ **需澄清**

contentforge 和 devforge 使用 `register_workflows` 而非 `register_loops`。需要确认：
- 如果它们注册的是 Loop 配置（有 Planner/Worker/Verifier/Reflector/Memory），则应使用 `register_loops`
- 如果它们注册的是 Workflow 配置（DAG 步骤流），则使用 `register_workflows` 正确

**修复建议**:
1. **立即确认**: contentforge/devforge 注册的是 Loop 还是 Workflow
2. 如果是 Loop，改为 `register_loops`
3. 在各项目 arch.md 中增加 "Plugin 协议合规声明"

### 5.5 Plugin 协议死代码引用

**审核结果**: ✅ **已合规**

在审查的代码和文档中，未发现直接引用 `register_helm_handlers` 和 `register_permission_policy` 死代码方法。flowforge/docs/task.md 已记录 FW-CONSIST-001/002 修复方案。

### 5.6 Agent/Tool/Loop 命名空间的一致性

**问题**: 命名空间声明不统一

| 项目 | 命名空间声明 | 问题 |
|------|------------|------|
| stockforge | ✅ "命名空间为 stockforge:xxx" | 正确 |
| devforge | ⚠️ 未明确声明命名空间格式 | 缺失 |
| contentforge | ⚠️ 未明确声明命名空间格式 | 缺失 |
| novelforge | ⚠️ 未明确声明命名空间格式 | 缺失 |
| mallforge | ⚠️ 未明确声明命名空间格式 | 缺失 |

**审核意见**: ⚠️ **需补充**

**修复建议**:
1. 在所有 *Forge 项目的 arch.md 中明确声明命名空间格式
2. 统一为 `{project}:{agent_name}`、`{project}:{tool_name}`、`{project}:{loop_name}`

### 5.7 face/ 文档与主文档的架构冲突

**问题**: face/ 文档的七层架构与主文档的七层架构概念不同

| 文档 | 七层架构第7层 | 含义 |
|------|-------------|------|
| arch_face.md (v3.0-face) | 互联层 (Interconnect Layer) | A2A Server/Client + Agent Directory |
| arch.md (v7.0) | 自进化层 (Evolution Layer) | Forgekin Engine + Auto-Forge + Soul Echo |

**审核意见**: ❌ **严重概念冲突**

**分析**:
- arch_face.md 的七层架构是在 v2.1 六层基础上新增"互联层"
- arch.md 的七层架构是在 v6.0 基础上新增"自进化层"
- 两个"七层"的第7层完全不同，但都声称是"七层架构"
- 如果 v7.0 同时包含互联层和自进化层，那应该是**八层架构**，而非七层

**修复建议**:
1. **方案A（推荐）**: 统一为八层架构——v2.1 六层 + 互联层(v3.0) + 自进化层(v7.0)
2. **方案B**: 将互联层合并到接入层/能力层，v7.0 七层 = v6.0 六层 + 自进化层
3. 无论选择哪个方案，必须在 arch_face.md 和 arch.md 中明确说明版本演进关系

---

## 六、rules.md/prompts.md 与 9大项目冲突分析

### 6.1 冲突清单

| # | 冲突点 | rules.md/prompts.md 要求 | 项目文档/代码现状 | 严重性 |
|---|--------|------------------------|------------------|--------|
| 1 | FlowForge 版本声明 | 未明确规定统一版本 | spec.md(v2.1)、arch.md(v6.0)、各项目(v4.0/v6.0)混乱 | ❌ P0 |
| 2 | OpenSieve 命名 | §2.2 所有数据检索必须通过 OpenSieve | contentforge/flowforge/openclaw_pkg 共 11+ 处 helixrag 残留 | ❌ P0 |
| 3 | LoopExecutor 唯一入口 | §2.3 P31 铁律 | mallforge arch.md 明确违反，flowforge WebSearchAgent 违反 | ❌ P0 |
| 4 | 外部 API 访问 | project_memory 禁止直接访问外部 API | WebSearchTool 直接 import DuckDuckGo/Tavily | ❌ P0 |
| 5 | 平台层纯度 | 平台层不含业务特定 Agent | WebSearchAgent 在 flowforge 核心中 | ⚠️ P1 |
| 6 | register_loops vs register_workflows | §3.1 明确区分两者 | contentforge/devforge 使用 register_workflows，需确认 | ⚠️ P1 |
| 7 | 命名空间格式 | 要求 `project_name:component_name` | 仅 stockforge 明确声明 | ⚠️ P1 |
| 8 | 死代码警告 | §2.5 禁止 register_helm_handlers/register_permission_policy | ✅ 已合规 | ✅ 通过 |
| 9 | 架构层次冲突 | face/ 七层(互联层) vs 主文档七层(自进化层) | 两个"七层"概念不同 | ❌ P0 |
| 10 | PluginProtocol 缺少 register_forgekin | arch.md 已定义但代码未实现 | plugin_protocol.py 无此方法 | ❌ P0 |

### 6.2 逐项目冲突分析

#### 6.2.1 FlowForge

**冲突点**:
1. spec.md 头部 v2.1 但内含 v7.0 内容 — **严重错误**
2. arch.md 头部 v6.0 但内含 v7.0 内容 — **严重错误**
3. design.md 同上的版本声明问题 — **严重错误**
4. config/default.yaml 中 helixrag 残留 — **严重违规**
5. web 前端 helixrag 残留 — **需修复**
6. WebSearchAgent 违反 P31 铁律 — **严重违规**
7. WebSearchTool 直接访问外部搜索引擎 — **严重违规**
8. PluginProtocol 缺少 register_forgekin 钩子 — **代码与设计不一致**

**修复建议**:
1. 立即修正所有文档头部版本声明为 v7.0
2. 清理所有 helixrag 残留
3. WebSearchAgent 迁移到 OpenSieve 或 *Forge 项目
4. WebSearchTool 移除 DuckDuckGo/Tavily 直接调用
5. 在 PluginProtocol 中增加 register_forgekins 方法

#### 6.2.2 ContentForge

**冲突点**:
1. 配置文件仍使用 helixrag — **严重违规**
2. 未明确声明 LoopExecutor 为唯一执行入口 — **缺失**
3. 使用 register_workflows 而非 register_loops — **需确认**
4. 未明确声明命名空间格式 — **缺失**

**修复建议**:
1. 立即修复：helixrag → opensieve
2. 在 arch.md 中增加 "P31 铁律合规声明"
3. 确认注册的是 Loop 还是 Workflow，使用正确的钩子
4. 在 arch.md 中明确声明命名空间格式

#### 6.2.3 DevForge

**冲突点**:
1. 版本声明为 v4.0 — **过时**
2. 未明确声明 LoopExecutor 为唯一执行入口 — **缺失**
3. 使用 register_workflows 而非 register_loops — **需确认**
4. 未明确声明命名空间格式 — **缺失**

**修复建议**:
1. 更新版本声明为 v7.0
2. 在 arch.md 中增加 "P31 铁律合规声明"
3. 确认并使用正确的注册钩子
4. 在 arch.md 中明确声明命名空间格式

#### 6.2.4 NovelForge

**冲突点**:
1. 版本声明为 v4.0 — **过时**
2. 未明确声明 LoopExecutor 为唯一执行入口 — **缺失**
3. 未找到 plugins.py — **缺失**
4. 未明确声明命名空间格式 — **缺失**

**修复建议**:
1. 更新版本声明为 v7.0
2. 在 arch.md 中增加 "P31 铁律合规声明"
3. 创建 plugins.py 并明确注册钩子
4. 在 arch.md 中明确声明命名空间格式

#### 6.2.5 MallForge

**冲突点**:
1. arch.md:155 明确声明 Agent 通过 `execute_with_context(input, None)` 直接执行 — **严重违规**
2. design.md 已修复但 arch.md 未同步 — **文档不一致**
3. 未找到 plugins.py — **缺失**
4. 未明确声明命名空间格式 — **缺失**

**修复建议**:
1. **立即修复**: arch.md 更新为 LoopExecutor 调用方式
2. 创建 plugins.py 并明确注册钩子
3. 在 arch.md 中明确声明命名空间格式

#### 6.2.6 StockForge

**合规状态**: ✅ **基本合规——作为参考模板**

**亮点**:
- 明确声明 "P31 铁律：所有 Agent 必须经 LoopExecutor 调用"
- 明确声明命名空间为 `stockforge:xxx`
- 正确使用 `register_loops`
- 所有数据走 OpenSieve

**建议**:
- 更新 FlowForge 版本声明为 v7.0
- 保持当前合规状态，作为其他项目的参考模板

---

## 七、养灵体系命名方案建议

### 7.1 当前命名方案评估

**当前命名**: 炉灵(Forgekin) 体系

**优点**:
- ✅ "炉灵"统一了"炉(Forge)"主题，与 FlowForge 项目名称呼应
- ✅ 灵魂三件套(魂忆/魂印/自锻/锻典)命名统一，富有诗意
- ✅ 升华阶段(E1-E5)对标 clowder-ai，国际化程度高

**缺点**:
- ❌ "炉灵"对非技术用户不够直观，需要解释"炉"是什么
- ❌ "Forgekin"是生造词(Forge + kin)，不利于开源社区传播
- ❌ "养猫"隐喻在企业级场景中显得不够严肃
- ❌ "魂忆"与"回忆"同音易混淆，"魂印"不够直观
- ❌ "共鸣 Resonance"与"灵议 Forgekin Council"概念边界模糊

### 7.2 三套命名方案

---

#### 方案A：灵智体系（推荐）

**核心理念**: 强调"智能体的自我觉醒与进化"，通俗易懂且体现 AGI 愿景

| 概念 | 中文名 | 英文名 | 说明 |
|------|--------|--------|------|
| 个体 | 灵智 | AgiSpirit | 自进化智能体，具备独立灵魂 |
| 群体 | 灵群 | SpiritCluster | 协作的灵智群 |
| 养成 | 灵育 | SpiritNurturing | 灵智从诞生到觉醒的全过程 |
| 入门训练 | 启蒙 | Initiation | 新灵智的入门训练 |
| 协作模式 | 灵协 | SpiritSync | 灵智群体协作模式 |
| 自主进化 | 灵锻 | SpiritForge | 自主思考与进化引擎 |
| 记忆 | 灵忆 | SpiritMemory | 跨会话记忆累积 |
| 画像 | 灵印 | SpiritMark | 对操作者/世界的认知画像 |
| 技能库 | 灵典 | SpiritCodex | 可复用知识体系 |
| 知识阶梯 | 灵阶 | WisdomLadder | 知识成熟度阶梯 |
| 成长阶段 | 觉醒阶 | AwakeningStages | 灵智成长的生命阶段 |
| IM 议事 | 灵议 | SpiritCouncil | IM 多渠道团队协作 |

**觉醒阶段**:
| 阶段 | 技术名 | 通俗名 | 核心特征 |
|------|--------|--------|---------|
| L1 | Spark | 启蒙 | 刚诞生，基础能力激活 |
| L2 | Ember | 觉醒 | 开始积累经验，独立完成任务 |
| L3 | Flame | 通达 | 可自主生成 Skill，跨会话记忆 |
| L4 | Blaze | 精通 | 团队标准级，可指导其他灵智 |
| L5 | Inferno | 大师 | 可创造新灵智，具备元认知 |

**优点**:
- ✅ "灵智"直观表达"智能体的灵魂与智慧"
- ✅ "AgiSpirit"易于理解和传播，与 AGI 愿景呼应
- ✅ 觉醒阶段(L1-L5)比升华阶段(E1-E5)更通俗
- ✅ 保留"灵锻 SpiritForge"与 FlowForge 呼应
- ✅ "灵忆/灵印/灵典/灵议"统一"灵"主题，比"魂忆/魂印/锻典"更易懂

**缺点**:
- ⚠️ 与当前"炉灵"体系差异较大，需要文档迁移
- ⚠️ AgiSpirit 作为英文名可能过于抽象

---

#### 方案B：智核体系

**核心理念**: 强调"智能体的核心进化能力"，技术感强，适合开发者社区

| 概念 | 中文名 | 英文名 | 说明 |
|------|--------|--------|------|
| 个体 | 智核 | CoreMind | 自进化智能体核心 |
| 群体 | 核群 | CoreCluster | 协作的智核群 |
| 养成 | 核育 | CoreNurturing | 智核的成长过程 |
| 记忆 | 核忆 | CoreMemory | 跨会话记忆 |
| 画像 | 核印 | CoreMark | 认知画像 |
| 进化 | 核锻 | CoreForge | 自进化引擎 |
| 技能库 | 核典 | CoreCodex | 知识体系 |
| 协作 | 核议 | CoreCouncil | IM 团队协作 |

**进化阶段**:
| 阶段 | 名称 | 核心特征 |
|------|------|---------|
| C1 | 启动(Initiated) | 核心激活 |
| C2 | 成长(Growing) | 能力成长 |
| C3 | 成熟(Mature) | 能力成熟 |
| C4 | 专家(Expert) | 专家级能力 |
| C5 | 大师(Master) | 大师级能力 |

**优点**:
- ✅ "智核"强调"智能体核心"，技术感强
- ✅ "CoreMind"易于理解
- ✅ 进化阶段命名简洁直观

**缺点**:
- ❌ 与 FlowForge 项目名称呼应较弱
- ❌ "核"字可能让人联想到"核武器"，不够友好
- ❌ 缺乏"养灵"体系的文化深度

---

#### 方案C：保留炉灵体系但优化（折中方案）

**核心理念**: 保留"炉灵"作为内部技术术语，但增加通俗别名和优化命名

| 概念 | 技术名 | 通俗名 | 英文名 | 说明 |
|------|--------|--------|--------|------|
| 个体 | 炉灵 | 灵匠 | Forgekin | 自进化智能体 |
| 群体 | 灵族 | 灵匠群 | Kinship | 协作的炉灵群 |
| 养成 | 养灵 | 灵匠养成 | ForgeNurturing | 炉灵成长过程 |
| 记忆 | 魂忆 | 灵忆 | SoulEcho | 跨会话记忆 |
| 画像 | 魂印 | 灵印 | SoulImprint | 认知画像 |
| 进化 | 自锻 | 灵锻 | AutoForge | 自进化引擎 |
| 技能库 | 锻典 | 灵典 | ForgeCodex | 知识体系 |
| 协作 | 灵议 | 灵匠议事 | ForgekinCouncil | IM 团队协作 |

**升华阶段**(保留 E1-E5，增加中文别名):
| 阶段 | 技术名 | 通俗名 | 核心特征 |
|------|--------|--------|---------|
| E1 | Spark | 火种 | 刚诞生 |
| E2 | Ember | 余烬 | 积累经验 |
| E3 | Flame | 火焰 | 可生成 Skill |
| E4 | Blaze | 烈焰 | 团队标准级 |
| E5 | Inferno | 炽焰 | 可创造新炉灵 |

**优点**:
- ✅ 保留"炉灵"技术术语，文档迁移成本低
- ✅ 增加"灵匠"通俗名，易于非技术用户理解
- ✅ "灵忆/灵印/灵锻/灵典"比"魂忆/魂印/自锻/锻典"更通俗
- ✅ 与 FlowForge 品牌呼应最强

**缺点**:
- ⚠️ 双命名系统可能增加文档复杂度
- ⚠️ "Forgekin"作为生造词的问题未解决

---

### 7.3 推荐方案

**推荐**: **方案A（灵智体系）** 作为长期方向，**方案C（优化炉灵）** 作为短期过渡

**理由**:
- **方案A（灵智体系）** 在品牌一致性、通俗性和 AGI 愿景表达方面最优，适合作为长期品牌名称
- **方案C（优化炉灵）** 迁移成本最低，适合在 v7.0 发布前快速落地

**建议实施路径**:
1. **v7.0**: 采用方案C——将"魂忆→灵忆"、"魂印→灵印"、"自锻→灵锻"、"锻典→灵典"的命名优化落地
2. **v7.1+**: 逐步引入方案A的"灵智"概念，作为对外品牌名称
3. **代码层面**: 保持 `Forgekin` 作为类名/变量名不变，文档中使用通俗名

---

## 八、修复优先级与行动计划

### 8.1 P0 立即修复（本周内）

1. **统一 FlowForge 版本声明**
   - 修正 spec.md 头部版本为 v7.0，增加版本演进说明
   - 修正 arch.md 头部版本为 v7.0
   - 修正 design.md 头部版本为 v7.0
   - 更新所有 *Forge 项目文档的 FlowForge 版本声明为 v7.0

2. **修复架构层次冲突**
   - 统一 face/arch_face.md 与 arch.md 的七层架构定义
   - 明确 v3.0-face 互联层与 v7.0 自进化层的关系

3. **清理 helixrag 残留**
   - contentforge 配置/代码中 helixrag → opensieve
   - flowforge/config/default.yaml 中 helixrag → opensieve
   - flowforge/web 前端移除 helixrag 兼容映射

4. **修复 P31 铁律违规**
   - mallforge arch.md 更新为 LoopExecutor 调用方式
   - flowforge WebSearchAgent 改为通过 LoopExecutor 执行或迁移

5. **修复外部 API 直接访问**
   - WebSearchTool 移除 DuckDuckGo/Tavily 直接调用，改为通过 OpenSieve

6. **PluginProtocol 增加 register_forgekin**
   - 在 plugin_protocol.py 中增加 `register_forgekins` 方法

### 8.2 P1 尽快修复（两周内）

7. **补充 LoopExecutor 合规声明**
   - 在 contentforge/devforge/novelforge 的 arch.md 中增加 "P31 铁律合规声明"

8. **澄清 register_loops vs register_workflows**
   - 确认 contentforge/devforge 注册的是 Loop 还是 Workflow
   - 在各项目 plugins.py 和 arch.md 中明确区分

9. **统一命名空间格式**
   - 在所有 *Forge 项目的 arch.md 中明确声明命名空间格式

10. **迁移 WebSearchAgent**
    - 从 FlowForge 核心迁移到 OpenSieve 或对应 *Forge 项目

11. **优化养灵体系命名**
    - 将"魂忆→灵忆"、"魂印→灵印"、"自锻→灵锻"、"锻典→灵典"落地

### 8.3 P2 建议修复（一个月内）

12. **增加 v7.0 FR-EVO 任务拆解**
    - 在 task_face.md 中增加 v7.0 FR-EVO 需求的任务拆解，或创建 task_evo.md

13. **补充术语表**
    - 在 spec.md 中增加 5Q、smoke gate、Episode 等关键术语定义

14. **建立文档一致性 CI 检查**
    - 自动检查 9 大项目文档中的版本声明一致性
    - 自动检查 helixrag 残留
    - 自动检查 P31 铁律合规声明

---

## 九、总结

### 9.1 设计质量评分

| 维度 | 评分 | 说明 |
|------|------|------|
| **架构设计** | 9/10 | v7.0 自我进化体系架构完整，两类智能体衔接合理，ForgekinEngine 10步闭环设计优秀 |
| **需求覆盖** | 8/10 | M1-M17 模块分解合理，FR-EVO-01~15 覆盖全面，但缺少任务拆解 |
| **文档一致性** | 3/10 | **版本声明混乱是最大风险**，face/ 与主文档架构冲突，代码与设计文档不同步 |
| **代码合规性** | 5/10 | PluginProtocol 缺少 register_forgekin，WebSearchAgent 违反 P31 铁律，WebSearchTool 违反 OpenSieve 唯一入口原则 |
| **命名通俗性** | 6/10 | "炉灵"体系技术化，需要通俗化优化 |
| **工业级就绪** | 7/10 | 基于大厂面试反馈，但部分需求缺少量化指标 |

**综合评分**: **6.3/10** — 设计质量良好，但文档一致性和代码合规性是当前最大风险

### 9.2 核心建议

1. **立即修复 P0 问题**（6项）：版本声明、架构冲突、helixrag 残留、P31 铁律违规、外部 API 直接访问、register_forgekin 缺失
2. **统一文档版本体系**: 建立从 v2.1 → v3.0-face → v7.0 的清晰版本演进路径
3. **优化养灵命名**: 短期采用方案C（优化炉灵），长期采用方案A（灵智体系）
4. **补充量化指标**: 为 FR-EVO 需求增加任务拆解和工作量估算
5. **建立 CI 合规检查**: 自动化检查 9 大项目与 rules.md/prompts.md 的一致性

### 9.3 关键风险

| 风险 | 影响 | 概率 |
|------|------|------|
| 版本混乱导致新成员理解错误 | 高 | 已发生 |
| face/ 与主文档架构冲突导致实现方向错误 | 高 | 中 |
| helixrag 残留导致数据检索路径错误 | 中 | 已发生 |
| P31 铁律违规导致 Agent 不可观测/不可控 | 高 | 已发生 |
| register_forgekin 缺失导致 v7.0 无法落地 | 高 | 已发生 |

---

**审核结论**: FlowForge v7.0 自我进化体系设计质量优秀，炉灵养成体系概念完整，工业级需求覆盖全面。但文档一致性和代码合规性是当前最大风险——版本声明混乱、face/ 与主文档架构冲突、代码中存在多处违反 rules.md 核心约束的情况。建议立即修复 P0 问题（6项），两周内完成 P1 修复（5项），一个月内完成 P2 优化（3项），确保 9 大项目文档与代码、rules.md、prompts.md 完全一致。

**审核人**: DeepSeek-V4-Pro (AI智能体产品专家/高级架构师/Agent开发工程师/全栈工程师)  
**审核日期**: 2026-07-16