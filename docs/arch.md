# FlowForge 开源 Agent 编排引擎 — 架构设计文档 v4.0 (最终版)

> **定位**：一个生产级、高可扩展的 Python Agent 编排框架。
> **哲学**：让架构成为配置，让扩展成为插件。
> **关系声明**：FlowForge 是独立开源项目（MIT），ContentForge 是其应用层参考实现。
> **版本说明**：本文档取代 v1.0 / v2.0 / v2.5 / v3.0，为唯一有效版本。历史版本已归档至 docs/archive/。

---

## 1. 项目概述与设计目标

FlowForge 是一个解耦了业务逻辑的通用 Agent 操作系统内核。它封装了业界主流的 9 种 Agent 架构模式，提供统一的工具注册、状态管理、可观测性接口，让开发者通过**声明式配置（YAML/JSON）**即可组合出复杂的智能体工作流，而无需硬编码 if-else。

### 1.1 为什么需要 FlowForge？

当前多数 Agent 项目的痛点：
- **“堆 Prompt”陷阱**：把大量规则塞进系统提示词，导致上下文膨胀、行为不稳定。
- **紧耦合**：Agent 逻辑、工具调用、流程控制互相穿插，牵一发而动全身。
- **不可复用**：为一个业务场景构建的 Agent 逻辑，无法直接用于另一项目。

FlowForge 通过**将控制流（Control Flow）与反馈机制（Feedback Loop）从业务逻辑中完全剥离**，解决了这些问题。

### 1.2 与 ContentForge 的关系

**FlowForge 是独立开源项目（MIT），ContentForge 是其应用层参考实现。** FlowForge 可以完全不依赖 ContentForge 运行，其他项目可以通过 `pip install flowforge` 独立使用。ContentForge 作为 FlowForge 的上层应用，通过注册 Agent/Tool/Workflow 来实现内容创作业务。

### 1.3 设计目标

| 维度         | 目标                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------- |
| **通用性**   | 核心不感知业务概念（专栏、文章、选题），只定义 `TaskContext` 和 `Agent/Tool` 接口。              |
| **完整性**   | 内置 9 种主流 Agent 模式（ReAct, Plan-Execute, Reflexion, Multi-Agent, Workflow, Graph of Thoughts, ReWOO, Self-Discover, Agent-as-Judge），支持混合编排。 |
| **可扩展性** | 任何新模式、新工具可通过注册机制热插拔；支持 MCP、OpenAPI、GraphQL 等主流协议接入。               |
| **生产就绪** | 内置追踪、指标、检查点、错误处理与级联修复、Persona 锁、Human-in-the-Loop、Solo 实时交互。      |
| **开源友好** | MIT 许可证，完善的文档和例子，支持通过 `pip install flowforge` 安装。                           |
| **高性能**   | 基于 asyncio 异步执行，支持并行步骤和流式输出。                                                  |

---

## 2. 架构总览

### 2.1 完整架构图

```
┌─────────────────────────────────────────────────────────────┐
│                    应用层 (app layer)                       │
│    (ContentForge / NovelForge 等具体业务)                   │
└───────────────────────────┬─────────────────────────────────┘
                            │  依赖注入 & 注册
┌───────────────────────────▼─────────────────────────────────┐
│              FlowForge (Agent OS)                            │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              HybridExecutor (混合执行器)              │    │
│  │  - 自动模式选择 (Self-Discover) / 显式指定           │    │
│  │  - 执行循环（状态、错误、事件）                       │    │
│  │  - Persona 锁、审核暂停/恢复                          │    │
│  └─────────────────────┬───────────────────────────────┘    │
│                        │ 调度                               │
│  ┌─────────────────────▼───────────────────────────────┐    │
│  │            ModeRegistry (模式注册中心)                 │    │
│  │  - react, plan_execute, reflexion, multi_agent       │    │
│  │  - workflow, graph_of_thoughts, rewoo, self_discover │    │
│  │  - agent_judge                                       │    │
│  └─────────────────────┬───────────────────────────────┘    │
│                        │ 使用工具/Agent                     │
│  ┌─────────────────────▼───────────────────────────────┐    │
│  │      ToolRegistry & AgentRegistry                    │    │
│  │  - 统一工具接口 (LLM, 搜索, 代码执行, 发布等)        │    │
│  │  - 统一 Agent 接口                                   │    │
│  │  - MCP / OpenAPI / GraphQL 协议接入                   │    │
│  │  - 30+ 通用 Agent、15+ 通用 Workflow                 │    │
│  └─────────────────────┬───────────────────────────────┘    │
│                        │ 状态与事件                         │
│  ┌─────────────────────▼───────────────────────────────┐    │
│  │     StateManager & EventBus (可观测性)               │    │
│  │  - 检查点 (SQLite/Redis)                             │    │
│  │  - 事件推送 (WebSocket / Console / Log)              │    │
│  │  - Solo 模式全事件映射 (16 种事件类型)                │    │
│  │  - 审计日志 & Prometheus 指标                         │    │
│  └─────────────────────┬───────────────────────────────┘    │
│                        │                                     │
│  ┌─────────────────────▼───────────────────────────────┐    │
│  │         MemoryManager (5 种记忆策略)                  │    │
│  │  - 工作记忆 / 短期记忆 / 长期记忆                     │    │
│  │  - 语义记忆 / 情景记忆                                │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

**依赖方向**：应用层 → FlowForge 引擎 → 基础设施（数据库、LLM 服务）。严禁反向依赖。

---

## 3. 核心定位与竞品深度分析

### 3.1 三维定位模型

```
                    Agent 思维复杂度
                         ▲
                         │
                    ┌────┴────┐
                    │FlowForge│  ← "高级 Agent 行为的生产流水线"
                    │ 9种内置 │
                    │ 思维模式 │
                    └─────────┘
                         │
         ┌───────────────┼───────────────┐
         │               │               │
    ┌────▼────┐    ┌─────▼─────┐    ┌───▼────┐
    │ CrewAI  │    │LangGraph  │    │ Dify   │
    │ 角色扮演 │    │ 底层引擎  │    │ 低代码  │
    └─────────┘    └───────────┘    └────────┘
    ───────────────────────────────────────────►
              业务完整性 / 易用性
```

### 3.2 竞品深度对比表

| 维度 | LangGraph | Dify | CrewAI | MetaGPT | AutoGen | Temporal | **FlowForge** |
|:---|:---|:---|:---|:---|:---|:---|:---|
| **核心定位** | 底层状态机“发动机” | 低代码“整车” | 角色扮演“剧组” | 软件公司模拟 | 多Agent对话框架 | 确定性工作流引擎 | **Agent 模式“制造工厂”** |
| **编排方式** | Python 硬编码 | UI 拖拽 Pipeline | 硬编码 Prompt 角色 | 硬编码 SOP | 硬编码对话流 | 声明式 Workflow (SDK) | **声明式 YAML + 9种思维模式混合编排** |
| **内置思维模式** | 0（需自行实现） | 0（仅顺序/条件） | 0（仅顺序对话） | 0（固定SOP） | 0（仅对话） | 0（纯工作流） | **9种可组合模式 (ReAct, Reflexion, GoT, Self-Discover 等)** |
| **通用Agent** | 无 | 无 | 无 | 少量角色模板 | 无 | 无 | **30+ 预置通用Agent** |
| **通用Workflow** | 无 | 无 | 无 | 无 | 无 | 无 | **15+ 预置通用Workflow** |
| **Solo交互** | 无 | 无 | 无 | 无 | 无 | 无 | **原生Solo模式 (16种实时事件)** |
| **协议支持** | LangChain生态 | 自有插件 | 无 | 无 | 无 | gRPC | **MCP / OpenAPI / GraphQL / A2A** |
| **Memory** | Checkpoint（单一） | 无独立模块 | 无 | 无 | 无 | 无 | **5种记忆策略 (工作/短期/长期/语义/情景)** |
| **可扩展性** | 自定义Node | 插件市场 | 自定义Agent | 自定义Role | 自定义Agent | 自定义Activity | **Mode/Agent/Tool三层插件 + 注册机制** |
| **目标用户** | 资深AI工程师 | 产品经理/非AI开发者 | 研究人员 | 研究人员 | 研究人员 | 后端工程师 | **AI工程团队 (快速构建高级思维Agent)** |

### 3.3 一句话定位

- **LangGraph** 给你零件，你得自己造引擎。
- **Dify** 给你整车，但只能跑标准路。
- **CrewAI** 给你剧组，但只能演固定剧本。
- **MetaGPT** 给你软件公司，但只能模拟标准流程。
- **Temporal** 给你工作流引擎，但不懂AI思维。
- **FlowForge** 给你一个**高级 Agent 工厂**：预置 9 种思维模式、30+ 通用 Agent、15+ 通用 Workflow，你只需配置参数，即可批量生产具有复杂思维能力的专家 Agent。

### 3.4 核心护城河

1. **9 种高级 Agent 模式的深刻工程化实现**：对每种模式的思考过程、反馈循环、终止条件、错误处理的深度编码。
2. **开箱即用的通用 Agent 和工作流**：将 ContentForge 中的业务经验提炼为可复用的基础 Agent，同时引入业界验证过的先进通用 Agent。
3. **Solo 交互模式**：提供极致透明度和控制力，任何其他框架目前不具备。

---

## 4. 核心接口设计 (v4.0 统一版本)

### 4.1 接口兼容性声明

FlowForge v4.0 的 `BaseAgent` 和 `BaseTool` 接口与 ContentForge 现有接口**完全兼容**，现有 7 个 Agent 实现**无需修改一行代码**即可迁移。v1.0/v2.5 中 `params: dict -> dict` 的旧接口定义已废弃。

### 4.2 TaskContext — 任务上下文

```python
class TaskContext:
    task_id: str
    persona: Optional[str] = None
    input_data: dict
    metadata: dict
    state: dict                     # 分层 TypedDict (BaseState → TopicState → ...)
    tools: ToolRegistry
    agents: AgentRegistry
    mode: Optional[str] = None          # 执行模式: react/reflexion/workflow/...
    interaction_mode: str = "standard"   # 交互模式: standard / solo  ← v4.0 新增
    checkpoint: CheckpointManager
    event_bus: EventBus
    memory: MemoryManager
    executor: Optional['HybridExecutor'] = None  # Workflow 嵌套调用
```

### 4.3 BaseAgent — Agent 抽象

```python
class BaseAgent(ABC):
    name: str
    description: str
    default_mode: Optional[str] = "react"

    @abstractmethod
    async def execute(self, input: AgentInput) -> AgentOutput:
        """核心执行方法 (与 ContentForge 签名完全一致)"""
        pass

    async def execute_with_context(self, input: AgentInput, context: TaskContext) -> AgentOutput:
        """带上下文的执行方法，默认调用 execute (可选覆写)"""
        return await self.execute(input)
```

### 4.4 BaseTool — 工具抽象 (v4.0 统一签名)

```python
class BaseTool(ABC):
    name: str
    description: str
    parameters: dict   # JSON Schema

    @abstractmethod
    async def execute(self, input: ToolInput) -> ToolOutput:
        """核心执行方法 (与 ContentForge 签名完全一致)"""
        pass
```

### 4.5 BaseModeExecutor — 模式执行器抽象

```python
class BaseModeExecutor(ABC):
    mode_name: str
    capabilities: list[str]  # ["retrieval", "planning", "reasoning", "generation", "evaluation"]

    async def _prepare(self, ctx: TaskContext) -> TaskContext: ...
    @abstractmethod
    async def _execute_core(self, ctx: TaskContext) -> dict: ...
    async def _postprocess(self, ctx: TaskContext, result: dict) -> dict: ...

    async def run(self, ctx: TaskContext) -> dict:
        ctx = await self._prepare(ctx)
        result = await self._execute_core(ctx)
        return await self._postprocess(ctx, result)
```

### 4.6 ModeRegistry — 模式注册中心

```python
class ModeRegistry:
    def register(self, executor: BaseModeExecutor): ...
    def get(self, mode_name: str) -> BaseModeExecutor: ...
    def suggest_mode(self, task_description: str) -> str: ...
```

### 4.7 HybridExecutor — 混合调度入口

```python
class HybridExecutor:
    def __init__(self, mode_registry: ModeRegistry, agent_registry: AgentRegistry,
                 tool_registry: ToolRegistry, event_bus: EventBus,
                 task_repo=None, audit_repo=None): ...

    async def run(self, context: TaskContext, mode_hint: str = None) -> dict: ...
    async def submit_review(self, task_id: str, verdict: str, feedback: str = "", edited_draft: str = "") -> None: ...
    async def pause_task(self, task_id: str): ...
    async def resume_task(self, task_id: str): ...
    async def get_task_snapshot(self, task_id: str) -> dict: ...
```

---

## 5. 九大内置模式详解

| 模式名称 | 英文 | 核心机制 | 适用场景 |
|---------|------|---------|----------|
| `react` | ReAct | Thought → Action → Observation 循环（MAX_STEPS=8, 含循环检测） | 需要多步动态检索或工具调用 |
| `plan_execute` | Plan-and-Execute | Planner 生成步骤清单，Executor 依次执行 | 路径明确、步骤可预测的任务 |
| `reflexion` | Reflexion | Actor → Evaluator → Reflector → 记忆 (MAX_ITERATIONS=4, QUALITY_THRESHOLD=0.85) | 需要反复打磨才能达标的任务（代码、文档） |
| `multi_agent` | Multi-Agent | Orchestrator 分发任务给专业 Agent，并行/串行协作 | 需要多角色配合的复杂任务 |
| `workflow` | Workflow / Orchestration | 预定义的 DAG 流程，可混合其他模式（禁止嵌套Workflow，max_depth=3） | 长流程、端到端的业务流水线 |
| `graph_of_thoughts` | Graph of Thoughts | 图式推理，多思路聚合、交叉验证 | 复杂推理、数学证明、多源情报融合 |
| `rewoo` | ReWOO | 一次性规划所有工具调用，批量执行 | 确定性多 API 调用，需高吞吐 |
| `self_discover` | Self-Discover | 任务前自动发现最佳推理结构 | 不确定领域，先验知识未知的任务 |
| `agent_judge` | Agent-as-Judge | 用独立 Agent 作为评判者，提供定性反馈 | 无外部评分标准，依赖“审美”或“逻辑”评价 |

### 5.1 Reflexion 模式内部实现策略 (v4.0 明确)

Reflexion 模式采用**三个独立 Agent** 实现：

| 角色 | Agent 名称约定 | 默认实现 |
|------|--------------|---------|
| **Actor** | `reflexion_actor` 或 AgentRegistry 中配置的 actor | `LLMActor(BaseAgent)` — 使用 LLMTool 调用 LLM 生成输出 |
| **Evaluator** | `reflexion_evaluator` 或 AgentRegistry 中配置的 evaluator | `LLMEvaluator(BaseAgent)` — 使用 LLMTool 调用 LLM 进行量化评分 |
| **Reflector** | `reflexion_reflector` 或 AgentRegistry 中配置的 reflector | `LLMReflector(BaseAgent)` — 使用 LLMTool 调用 LLM 分析失败原因 |

如果 AgentRegistry 中没有注册对应的 Agent，则使用 DefaultLLMActor/Evaluator/Reflector，通过不同的 system_prompt 模板调用 LLM。

### 5.2 Workflow 模式安全机制 (v4.0 新增)

- **递归深度限制**：`max_workflow_depth = 3`，达到上限后抛出 `WorkflowRecursionError`
- **嵌套禁止**：Workflow 步骤不允许指定 `mode: workflow`
- **步骤级错误处理**：每个步骤支持 `on_error: skip / retry / abort` 配置
- **步骤级重试**：`retry_count` 和 `retry_delay` 参数

### 5.3 模式组合示例

```yaml
steps:
  - name: research
    agent: researcher
    mode: rewoo
  - name: draft
    agent: writer
    mode: reflexion
  - name: review
    human: true
  - name: publish
    agent: publisher
    mode: plan_execute
```

---

## 6. 通用 Agent 库与 Workflow 库

### 6.1 设计原则 (Rule of Three)

通用 Agent 至少经过两个业务场景验证后才纳入通用库。每个 Agent 标注**验证状态**：✅ 已验证 / 🔄 设计中 / 📅 待验证。

### 6.2 内容创作类 Agent (✅ 已验证 — ContentForge 提炼)

| # | Agent 名称 | 来源 | 核心能力 | 默认模式 |
|---|-----------|------|---------|---------|
| 1 | **TopicResearchAgent** | ContentForge TopicAgent | 多级检索策略：缓存→HelixRAG→热榜→自定义 | `rewoo` |
| 2 | **MaterialCollectionAgent** | ContentForge ResearchAgent | 并行多源检索、素材清洗、关键事实提取 | `rewoo` |
| 3 | **ArticleWritingAgent** | ContentForge WriterAgent | 三层生成管道：大纲→初稿→润色，风格注入 | `reflexion` |
| 4 | **SEOOptimizationAgent** | ContentForge EditorAgent | 标题优化、关键词植入、段落结构优化 | `plan_execute` |
| 5 | **FactCheckAgent** | ContentForge FactCheckAgent | 链接有效性检查、数据交叉验证 | `react` |
| 6 | **ContentAuditAgent** | ContentForge AuditAgent | LLM 质量评分、问题检测与分类 | `agent_judge` |
| 7 | **HeadlineOptimizer** | 业界最佳实践 | A/B 测试式标题生成、点击率预估 | `reflexion` |
| 8 | **ContentRepurposer** | 业界最佳实践 | 长文→短文/视频脚本/社交媒体帖子的多格式转换 | `plan_execute` |
| 9 | **TrendAnalysisAgent** | Google Trends + Tavily | 实时热点趋势分析、热度预测 | `react` |
| 10 | **PublishingAgent** | ContentForge PublishAgent | 多平台发布适配、格式转换、熔断保护 | `plan_execute` |
| 11 | **ImageResearchAgent** | Pexels + Unsplash 封装 | 根据文章内容语义匹配版权图片 | `rewoo` |
| 12 | **MultilingualAgent** | DeepL/LLM 翻译 | 内容多语言翻译与本地化适配 | `plan_execute` |

### 6.3 小说创作类 Agent (📅 待验证 — NovelForge Phase 3)

| # | Agent 名称 | 来源 | 核心能力 | 默认模式 |
|---|-----------|------|---------|---------|
| 1 | **OutlinePlanningAgent** | 小说创作最佳实践 | 三幕/五幕结构生成、章节大纲规划 | `self_discover` |
| 2 | **CharacterDesignAgent** | 小说创作最佳实践 | 人物小传、性格弧线、关系网络设计 | `graph_of_thoughts` |
| 3 | **ChapterWritingAgent** | AdvancedWritingAgent 变体 | 按大纲写作单章，保持风格一致 | `reflexion` |
| 4 | **PlotIntegrationAgent** | 小说创作最佳实践 | 多线叙事整合、伏笔管理、时间线校验 | `graph_of_thoughts` |
| 5 | **StyleConsistencyAgent** | 小说创作最佳实践 | 跨章节风格一致性检查、语言风格适配 | `agent_judge` |
| 6 | **VolumeAggregatorAgent** | 小说创作最佳实践 | 多章节聚合、目录生成、格式统一 | `plan_execute` |
| 7 | **DialogueGenerationAgent** | 小说对话最佳实践 | 人物对话生成、语气差异化、口语化处理 | `reflexion` |
| 8 | **ConflictDevelopmentAgent** | 小说创作最佳实践 | 戏剧冲突设计、张力曲线评估、节奏控制 | `graph_of_thoughts` |
| 9 | **WorldBuildingAgent** | 小说设定最佳实践 | 世界观设定、规则体系、地图/势力设计 | `plan_execute` |
| 10 | **ReaderEngagementAgent** | 读者互动分析 | 评论情感分析、读者偏好追踪 | `reflexion` |
| 11 | **SerializationAgent** | 网文连载助手 | 断章钩子设计、留存率优化、更新节奏建议 | `reflexion` |
| 12 | **AdaptationAgent** | 跨媒介改编 | 小说→剧本/漫画脚本的格式转换 | `plan_execute` |

### 6.4 代码与工具类 Agent (🔄 设计中)

| # | Agent 名称 | 来源 | 核心能力 | 默认模式 |
|---|-----------|------|---------|---------|
| 1 | **CodeReviewAgent** | SWE-Agent 实践 | 代码变更分析、多维度审查 | `reflexion` |
| 2 | **TaskDecompositionAgent** | Plan-and-Execute 实践 | 复杂任务分解为分步计划 | `plan_execute` |
| 3 | **MetaPlannerAgent** | Self-Discover 实践 | 分析任务，输出最佳思维框架 | `self_discover` |
| 4 | **DebateAgent** | 辩论框架实践 | 多角色辩论，输出综合结论 | `multi_agent` |
| 5 | **DataAnalysisAgent** | 数据分析实践 | 数据清洗、统计摘要、可视化建议 | `rewoo` |
| 6 | **PromptOptimizerAgent** | Prompt Engineering | 自动分析 prompt 效果并迭代优化 | `reflexion` |
| 7 | **TestGenerationAgent** | 测试工程实践 | 根据代码自动生成测试 | `reflexion` |
| 8 | **DocumentationAgent** | 文档工程实践 | 代码→API文档/用户手册 | `plan_execute` |

### 6.5 通用 Workflow 库

| # | Workflow 名称 | 使用 Agent | 描述 | 状态 |
|---|--------------|-----------|------|------|
| 1 | **DeepArticleWorkflow** | TopicResearch → MaterialCollection → ArticleWriting → SEOOpt → FactCheck → ContentAudit → Publishing | 深度长文创作全流程 | ✅ 已验证 |
| 2 | **QuickPostWorkflow** | TopicResearch → ArticleWriting → Publishing | 快速帖子生成 | ✅ 已验证 |
| 3 | **TrendArticleWorkflow** | TrendAnalysis → TopicResearch → ArticleWriting → Publishing | 热点追踪创作 | ✅ 已验证 |
| 4 | **MultiPlatformWorkflow** | ArticleWriting → ContentRepurposer → Publishing(×N) | 多平台内容分发 | ✅ 已验证 |
| 5 | **SEOContentWorkflow** | TopicResearch → SEOOpt → ArticleWriting → FactCheck → Publishing | SEO优化内容 | ✅ 已验证 |
| 6 | **ImageArticleWorkflow** | ArticleWriting → ImageResearch → ContentAudit → Publishing | 配图文章创作 | ✅ 已验证 |
| 7 | **MultilingualWorkflow** | ArticleWriting → MultilingualAgent → Publishing(×N) | 多语言内容发布 | ✅ 已验证 |
| 8 | **ReportGenerationWorkflow** | TopicResearch(×3) → MaterialCollection(×3) → ArticleWriting → ContentAudit | 深度报告生成 | ✅ 已验证 |
| 9 | **NovelFullProcessWorkflow** | OutlinePlanning → CharacterDesign → ChapterWriting(×N) → StyleConsistency | 完整小说创作 | 📅 待验证 |
| 10 | **NovelChapterWorkflow** | ChapterWriting → PlotIntegration → StyleConsistency | 单章创作 | 📅 待验证 |
| 11 | **CodeReviewWorkflow** | CodeAnalysis → parallel(Security, Performance) → ReportAggregator | 代码审查 | 🔄 设计中 |
| 12 | **AIDebateWorkflow** | 3×DebateAgent + GraphReasonerAgent | AI辩论评审 | 🔄 设计中 |
| 13 | **FactCheckingWorkflow** | DeepResearch → SelfCritic → AdvancedWriting | 事实核查 | 🔄 设计中 |
| 14 | **ContentCalendarWorkflow** | MetaPlanner → DeepResearch → 并行 AdvancedWriting | 内容日历策划 | 🔄 设计中 |
| 15 | **LearningPathWorkflow** | MetaPlanner → TaskDecomposition → 并行多个 Agent | 个性化学习路径 | 🔄 设计中 |

---

## 7. 重量级模块详细设计

### 7.1 Agent 模式执行器详细设计

#### 7.1.1 ReAct 执行器

```python
class ReActExecutor(BaseModeExecutor):
    mode_name = "react"
    capabilities = ["reasoning", "retrieval", "acting"]
    
    MAX_STEPS = 8
    LOOP_THRESHOLD = 3  # 相似 Action 超过此值视为陷入循环
    
    async def _execute_core(self, ctx: TaskContext) -> dict:
        observation = ctx.input_data.get("task", "")
        action_history = []
        for step in range(self.MAX_STEPS):
            thought = await self._generate_thought(ctx, observation, action_history)
            ctx.event_bus.emit("react.thought", {"step": step, "thought": thought})
            
            action = await self._parse_action(ctx, thought)
            if action is None: break
            
            ctx.event_bus.emit("react.action", {"step": step, "action": action})
            if self._is_loop(action_history, action):
                ctx.event_bus.emit("react.loop_detected", {"step": step})
                break
            action_history.append(action)
            
            observation = await self._execute_action(ctx, action)
            ctx.event_bus.emit("react.observation", {"step": step, "result": observation[:200]})
        return {"final_answer": observation, "steps": step + 1}
```

#### 7.1.2 Reflexion 执行器

```python
class ReflexionExecutor(BaseModeExecutor):
    mode_name = "reflexion"
    capabilities = ["generation", "evaluation", "refinement"]
    
    MAX_ITERATIONS = 4
    QUALITY_THRESHOLD = 0.85
    
    async def _execute_core(self, ctx: TaskContext) -> dict:
        memory, best_result, best_score = [], None, 0.0
        for iteration in range(self.MAX_ITERATIONS):
            # Actor — 通过 AgentRegistry 获取 (默认 LLMActor)
            actor = ctx.agents.get("reflexion_actor") or DefaultLLMActor()
            output = await actor.execute(AgentInput(params={"task": ctx.input_data["task"], "memory": memory}))
            ctx.event_bus.emit("reflexion.actor", {"iteration": iteration, "output": output.result[:200]})
            
            # Evaluator — 通过 AgentRegistry 获取 (默认 LLMEvaluator)
            evaluator = ctx.agents.get("reflexion_evaluator") or DefaultLLMEvaluator()
            eval_result = await evaluator.execute(AgentInput(params={"output": output.result}))
            score, issues = eval_result.result["score"], eval_result.result["issues"]
            ctx.event_bus.emit("reflexion.evaluator", {"iteration": iteration, "score": score, "issues": issues})
            
            if score > best_score: best_result, best_score = output.result, score
            if score >= self.QUALITY_THRESHOLD: break
            
            # Reflector — 通过 AgentRegistry 获取 (默认 LLMReflector)
            reflector = ctx.agents.get("reflexion_reflector") or DefaultLLMReflector()
            reflection = await reflector.execute(AgentInput(params={"output": output.result, "issues": issues}))
            memory.append(reflection.result)
            ctx.event_bus.emit("reflexion.reflector", {"iteration": iteration, "reflection": reflection.result})
        return {"result": best_result, "score": best_score, "iterations": iteration + 1}
```

#### 7.1.3 Workflow 执行器 (含安全机制)

```python
class WorkflowExecutor(BaseModeExecutor):
    mode_name = "workflow"
    capabilities = ["orchestration", "planning"]
    MAX_DEPTH = 3  # 递归深度限制

    async def _execute_core(self, ctx: TaskContext) -> dict:
        sop_steps = ctx.metadata.get("sop_steps", [])
        context_data = ctx.input_data
        depth = ctx.metadata.get("_workflow_depth", 0)
        if depth >= self.MAX_DEPTH: raise WorkflowRecursionError("Max workflow depth exceeded")

        for step in sop_steps:
            ctx.event_bus.emit("workflow.step.start", {"step": step["name"]})
            if step.get("human"):
                await self._pause_for_review(ctx, step)
                continue
            if step.get("parallel_group"):
                results = await self._execute_parallel(ctx, step["parallel_group"], context_data)
                context_data.update(results)
                continue

            mode = step.get("mode", "plan_execute")
            if mode == "workflow": raise ValueError("Nested workflow is forbidden")

            sub_ctx = TaskContext.from_parent(ctx, input_data=context_data,
                                              metadata={"_workflow_depth": depth + 1})
            sub_result = await ctx.executor.run(sub_ctx, mode=mode)
            context_data[step["output"]] = sub_result
            ctx.event_bus.emit("workflow.step.complete", {"step": step["name"], "output": sub_result[:200]})
        return context_data
```

---

### 7.2 Tool 注册与协议支持

#### 7.2.1 Tool 注册方式

| 方式 | 适用场景 | 示例 |
|------|---------|------|
| **代码注册** | 自定义 Tool | `forge.register_tool(MyCustomTool())` |
| **YAML 配置** | 内置 Tool | YAML 中声明 `tools: [{name: "openai", provider: "openrouter"}]` |
| **MCP 协议** | 外部 Tool 服务 | 通过 MCP 协议发现并注册远程 Tool |
| **OpenAPI 规范** | REST API 自动转换 | `tools: [{type: openapi, spec_url: "..."}]` |
| **GraphQL** | GraphQL API 自动转换 | `tools: [{type: graphql, endpoint: "..."}]` |
| **Python 入口点** | 第三方插件 | `flowforge.tools` entry_points |

#### 7.2.2 内置 Tool 清单

| 类别 | Tool 名称 | 说明 | 协议 |
|------|----------|------|------|
| **LLM** | `LLMClient` | 统一多供应商 LLM 调用 | OpenAI API |
| **检索** | `HelixRAGTool` | 混合检索 | 内部 API |
| **搜索** | `TavilySearchTool` | 实时网络搜索 | REST API |
| **搜索** | `DuckDuckGoTool` | 免费网络搜索 | REST API |
| **抓取** | `WebScraperTool` | 网页全文抓取 | HTTP |
| **发布** | `ToutiaoPublisherTool` | 头条发布 | Playwright 自动化 |
| **发布** | `WeChatPublisherTool` | 微信公众号发布 | 微信 API |
| **图像** | `PexelsImageTool` | 版权图片搜索下载 | REST API |
| **邮件** | `SendGridTool` | 邮件发送 | REST API |
| **通知** | `WebhookTool` | 通用 Webhook 通知 | HTTP POST |
| **代码** | `PythonExecutorTool` | 沙箱 Python 执行 | 本地沙箱 |
| **文件** | `FileReadWriteTool` | 文件读写 | 本地文件系统 |

#### 7.2.3 MCP 协议支持

```python
class MCPToolAdapter(BaseTool):
    def __init__(self, mcp_tool: MCPTool):
        self.name = mcp_tool.name
        self.description = mcp_tool.description
        self.parameters = mcp_tool.input_schema
        self._mcp_tool = mcp_tool

    async def execute(self, input: ToolInput) -> ToolOutput:
        result = await self._mcp_tool.call(input.params)
        return ToolOutput(result=result)
```

```yaml
flowforge:
  mcp_servers:
    - command: "python"
      args: ["-m", "mcp_server_filesystem", "/tmp"]
    - command: "npx"
      args: ["-y", "@anthropic/mcp-server-puppeteer"]
```

---

### 7.3 Solo 模式与 EventBus

#### 7.3.1 Solo 事件完整映射表 (v4.0 补全)

| FlowForge EventBus 事件 | Solo 事件类型 | 说明 |
|------------------------|-------------|------|
| `workflow.step.start` / `mode.enter` | `solo.stage.enter` | SOP 阶段进入 |
| `tool.start` | `solo.tool.start` | 工具调用开始 |
| `tool.end` | `solo.tool.end` | 工具调用完成 |
| `llm.start` | `solo.llm.start` | LLM 调用开始 |
| `llm.reasoning` | `solo.llm.reasoning` | LLM 推理内容 (流式) |
| `llm.stream` | `solo.llm.stream` | LLM 输出文本 (流式) |
| `llm.end` | `solo.llm.end` | LLM 调用完成 |
| `draft.update` | `solo.draft.update` | 草稿内容更新 |
| `step.intermediate` | `solo.step.intermediate` | 中间产出展示 |
| `review.ready` | `solo.review.ready` | 审核节点就绪 |
| `review.submitted` | `solo.review.submitted` | 审核已提交 |
| `task.paused` | `solo.task.paused` | 任务暂停 |
| `task.resumed` | `solo.task.resumed` | 任务恢复 |
| `task.completed` | `solo.task.completed` | 任务完成 |
| `task.error` | `solo.task.error` | 任务出错 |
| `token.stats` | `solo.token.stats` | Token 统计更新 |

#### 7.3.2 EventBusSoloAdapter

```python
class EventBusSoloAdapter:
    EVENT_MAP = {
        "workflow.step.start": "solo.stage.enter", "mode.enter": "solo.stage.enter",
        "tool.start": "solo.tool.start", "tool.end": "solo.tool.end",
        "llm.start": "solo.llm.start", "llm.reasoning": "solo.llm.reasoning",
        "llm.stream": "solo.llm.stream", "llm.end": "solo.llm.end",
        "draft.update": "solo.draft.update", "step.intermediate": "solo.step.intermediate",
        "review.ready": "solo.review.ready", "review.submitted": "solo.review.submitted",
        "task.paused": "solo.task.paused", "task.resumed": "solo.task.resumed",
        "task.completed": "solo.task.completed", "task.error": "solo.task.error",
        "token.stats": "solo.token.stats",
    }
    # ... bridge 方法
```

### 7.4 Memory 模块详细设计

#### 7.4.1 五种记忆策略

| 记忆类型 | 存储后端 | Phase 1 支持 | Phase 2+ 扩展 |
|---------|---------|-------------|--------------|
| **工作记忆 (Working)** | Python dict / TaskContext.state | ✅ 直接支持 | - |
| **短期记忆 (Short-term)** | Redis | ⚠️ SQLite 替代 (Phase 1) | 迁移至 Redis |
| **长期记忆 (Long-term)** | SQLite/PostgreSQL | ✅ 直接支持 | 迁移至 PostgreSQL |
| **语义记忆 (Semantic)** | Qdrant/Milvus | ❌ 暂不引入 (Phase 3+) | 启用向量检索 |
| **情景记忆 (Episodic)** | SQLite + 向量库 | ⚠️ 仅 SQLite (Phase 1) | 增加向量索引 |

#### 7.4.2 MemoryManager 接口

```python
class MemoryManager:
    def __init__(self, config: MemoryConfig): ...
    async def save(self, memory_type: str, key: str, data: Any): ...
    async def retrieve(self, memory_type: str, query: Any) -> Any: ...
    async def hybrid_search(self, query: str, types: list[str] = None) -> list[Any]: ...
```

---

## 8. 事件系统与可观测性

### 8.1 EventBus 事件类型 (完整版)

- `task.start`, `task.complete`, `task.error`, `task.paused`, `task.resumed`
- `mode.enter`, `mode.exit`
- `agent.start`, `agent.end`
- `tool.start`, `tool.end`
- `llm.start`, `llm.reasoning`, `llm.stream`, `llm.end`
- `draft.update`, `step.intermediate`
- `review.ready`, `review.submitted`
- `token.stats`

### 8.2 追踪与指标

- **分布式追踪**：基于 OpenTelemetry，每个任务生成唯一 `trace_id`
- **Prometheus 指标**：
  - `flowforge_tasks_total{mode, status}`
  - `flowforge_execution_duration_seconds`
  - `flowforge_token_usage_total{model, provider}`
  - `flowforge_tool_calls_total{tool_name, status}`
- **审计日志**：所有 Agent、Tool 调用均记录在 `audit_logs` 表中

### 8.3 检查点与恢复

`StateManager` 提供 `save_checkpoint(task_id, state)` 和 `load_checkpoint(task_id)` 接口。默认使用 SQLite 存储，可替换为 Redis。LangGraph 深度集成时，直接复用其 Checkpointer。

---

## 9. 安全机制

### 9.1 Persona 锁

同一 persona 同一时间只允许一个任务运行，通过 `HybridExecutor._running_tasks` 管理，`ConflictError` (HTTP 409) 处理冲突。

### 9.2 Human-in-the-Loop

Workflow 模式原生支持 `human: true` 节点，通过 LangGraph `interrupt_before` 实现暂停，通过 `HybridExecutor.submit_review()` 恢复执行。

### 9.3 沙箱执行

对代码执行类 Tool 实施权限控制和超时限制。

---

## 10. 配置化与启动

### 10.1 配置文件示例

```yaml
modes:
  - name: reflexion; enabled: true
  - name: rewoo; enabled: true

agents:
  - name: writer; module: my_agents.writer; default_mode: reflexion

tools:
  - name: openai; provider: openrouter; api_key: "${OPENROUTER_API_KEY}"
  - name: search; provider: tavily; api_key: "${TAVILY_API_KEY}"

mcp_servers:
  - command: "python"; args: ["-m", "mcp_server_filesystem", "/tmp"]
```

### 10.2 编程式启动

```python
from flowforge import FlowForge

forge = FlowForge.from_config("config.yaml")
result = await forge.run(task_id="task-001", input_data={"topic": "AI Agent 发展趋势"}, mode="reflexion")
```

---

## 11. 扩展与插件

- **注册自定义模式**：`registry.register(MyCustomMode())`
- **注册通用 Agent**：`forge.register_agent("my_agent", MyAgent())`
- **第三方插件**：Python 标准入口点 `flowforge.tools`、`flowforge.modes`、`flowforge.agents`

```toml
[project.entry-points."flowforge.modes"]
my_mode = "my_package:MyCustomMode"
```

---

## 12. 分阶段实施计划

| 阶段 | 时间 | 核心任务 | 模式 | Agent 库 | 试点业务 | Memory |
|------|------|---------|------|---------|---------|--------|
| **Phase 1** | 第1-3周 | FlowForge 核心库 + ContentForge 7个Agent迁移 | Workflow + Reflexion | 内容创作12个 (✅) | ContentForge | 工作记忆 + 长期记忆 (SQLite) |
| **Phase 2** | 第4-6周 | 扩展模式 + 通用Agent库 | + ReAct + Plan-Execute + Multi-Agent | + 代码/工具类 (🔄) | ContentForge + NovelForge | + 短期记忆 (SQLite替代) |
| **Phase 3** | 第7-8周 | 高级模式 + NovelForge启用 | + ReWOO + Agent-as-Judge | + 小说创作12个 (📅) | NovelForge | + 语义记忆 (Qdrant) |
| **Phase 4** | 第9-10周 | 实验模式 + 开源 | + GoT + Self-Discover | 30+ 全部 | 跨业务试点 | + 情景记忆 (向量增强) |

---

## 13. 迁移映射表 (ContentForge → FlowForge)

| ContentForge 现有模块 | FlowForge 对应组件 | 迁移策略 |
|-----------------------|-------------------|---------|
| `brain/orchestrator.py` | `HybridExecutor` | **包装**：保留 Persona 锁、Solo 回调，核心执行委托 |
| `core/interfaces/agent.py` → `BaseAgent` | `flowforge.core.BaseAgent` | **继承**：签名完全兼容 |
| `core/interfaces/tool.py` → `BaseTool` | `flowforge.core.BaseTool` | **继承**：签名完全兼容 |
| `tools/registry.py` → `ToolRegistry` | `flowforge.tools.ToolRegistry` | **委托**：包装 FlowForge ToolRegistry |
| `core/schemas/state.py` → 分层 State | `TaskContext.state` | **扩展**：State 继承链不变 |
| `brain/sop/compiler.py` → `SOPCompiler` | `WorkflowExecutor` / `WorkflowCompiler` | **替换**：使用 FlowForge Workflow 引擎 |
| `core/interfaces/solo_emitter.py` | `EventBus` + `EventBusSoloAdapter` | **桥接**：16种事件全映射 |
| `brain/scheduler.py` → `TaskScheduler` | `flowforge.scheduler.Scheduler` | **替换**：APScheduler 增强 |
| `tools/llm/client.py` → `LLMClient` | `flowforge.tools.llm.LLMClient` | **替换**：多供应商 + 自动故障转移 |
| `memory/repositories/` | `flowforge.memory.MemoryManager` | **迁移**：内容迁移至通用 Repository |
| `workers/` → 业务 Agent | `contentforge/agents/` | **保留**：作为业务 Agent，可继承通用 Agent |
| `app/api/solo_ws_manager.py` | `SoloWSManager` (ContentForge) + `EventBusSoloAdapter` | **保留**：SoloWSManager 不变，增加桥接层 |

---

## 14. Orchestrator 能力覆盖清单

| ContentForge Orchestrator 能力 | FlowForge 对应实现 | 覆盖状态 |
|-------------------------------|-------------------|---------|
| Persona 锁 (`_running_tasks`) | `HybridExecutor._running_tasks` | ✅ 完全覆盖 |
| LangGraph 图构建 (`build_graph`) | `WorkflowExecutor._execute_core` | ✅ 完全覆盖 |
| Solo 回调注入 (`_setup_solo_callbacks`) | `EventBusSoloAdapter.bridge()` | ✅ 完全覆盖 (16种事件全映射) |
| 审核暂停/恢复 (`submit_review`) | `HybridExecutor.submit_review()` | ✅ 完全覆盖 |
| 审计日志 (`audit_repo.log`) | `EventBus` + `AuditLogModel` | ✅ 完全覆盖 |
| Prometheus 指标 | `core/metrics.py` (flowforge 内置) | ✅ 完全覆盖 |
| 任务状态管理 (`task_repo`) | `TaskContext.checkpoint` + `StateManager` | ✅ 完全覆盖 |
| 并发任务限制 | `HybridExecutor._task_limits` | ✅ 完全覆盖 (可配置) |

---

## 15. 开源与社区

- **许可证**：MIT
- **文档**：MkDocs + Material 主题
- **示例仓库**：`flowforge-examples`
- **插件机制**：Python 标准入口点 (`flowforge.tools`, `flowforge.modes`, `flowforge.agents`)
- **版本管理**：v1.0/v2.0/v2.5/v3.0 已归档至 `docs/archive/`

---

**以上为 FlowForge 架构设计文档 v4.0 (最终版)。** 本文档融合了 v1.0 的核心接口设计、v2.0 的竞品分析与定位、v2.5 的丰富 Agent/Workflow 库及 MCP 支持、v3.0 的重构方案与接口兼容性设计，并修复了第二轮审核的全部 5 个阻塞问题，为唯一有效版本。