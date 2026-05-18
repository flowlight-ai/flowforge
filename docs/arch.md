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

---

# FlowForge 架构设计文档 v5.0 (防御与协作增强版)

> **定位**：在 v4.0 九大模式 + 通用 Agent/Workflow 库的基础上，新增三层防御、上下文压缩、安全工具、三种 Multi-Agent 策略、协作基础设施，解决"Agent 易犯错、会偷懒、会忘事"的生产级痛点。
> **关系声明**：v5.0 是 v4.0 的**增量扩展**，所有 v4.0 接口保持兼容，不破坏现有实现。
> **设计依据**：Claude Code 架构深度分析（1,906 个 TypeScript 源文件、51.2 万行代码），融合 TAOR 循环、Compressor、Fail-closed 工具、三层多 Agent 策略等关键设计思想。

---

## 1. v5.0 核心变更概述

v5.0 围绕**防御、记忆、安全、协作**四大维度进行增强，核心变更如下：

| 变更项 | 说明 | 影响模块 |
|--------|------|---------|
| **三层防御体系** | L1 超时 / L2 重复检测 / L3 自修正，分层实现而非全部塞进 HybridExecutor | `tools/registry.py`, `core/base_mode_executor.py`, `modes/workflow.py` |
| **上下文压缩器** | ContextCompressor 集成到 MemoryManager，tiktoken 真实 token 计数 + 滑动窗口摘要 | `memory/compressor.py`, `memory/manager.py` |
| **安全工具注册表** | SecureToolRegistry 继承 ToolRegistry，BaseTool 新增 `safety_level` / `is_concurrency_safe` | `tools/secure_registry.py`, `core/base_tool.py` |
| **三种 Multi-Agent 策略** | Subagents(隔离并行) / Agent Teams(共享任务板) / Swarms(去中心化集群) | `modes/multi_agent.py` |
| **共享任务板** | TaskBoard 原子化认领（SQLite WAL + RETURNING + 应用层锁兼容） | `memory/task_board.py` |
| **通信信箱** | Mailbox 四级优先级 + 主题过滤 + TTL 过期 | `memory/mailbox.py` |
| **CheckpointManager 增强** | 增量保存 + 版本号 + 恢复到执行上下文 + 旧版本清理 | `memory/checkpoint.py` |
| **SOP 模板 defense 配置** | WorkflowExecutor 读取 `ctx.metadata["defense"]`，步骤级可覆盖 | `modes/workflow.py` |

---

## 2. 三层防御架构

v5.0 的三层防御**分层实现**，每一层驻留在最合适的模块中，而非全部集中在 HybridExecutor：

### 2.1 防御分层设计

| 防御层 | 位置 | 机制 | 默认值 |
|--------|------|------|--------|
| **L1 超时** | `from flowforge.tools.registry import ToolRegistry` → `execute()` | 单次工具调用超时 | 120s |
| **L2 重复检测** | `from flowforge.core.base_mode_executor import BaseModeExecutor` → `_on_exit()` | hash-based 重复检测钩子 | threshold=3 |
| **L3 自修正** | `from flowforge.modes.workflow import WorkflowExecutor` → `_handle_step_error()` | `on_error: "reflexion_retry"` 策略 | retry_count=2 |

### 2.2 L1：单次工具调用超时

在 `ToolRegistry.execute()` 中增加超时控制，与全局 `TASK_TIMEOUT_SECONDS` 互补：

```python
from flowforge.tools.registry import ToolRegistry

class ToolRegistry:
    def __init__(self, config=None):
        self._tool_timeout = config.get("tool_timeout", 120) if config else 120

    async def execute(self, name: str, input: ToolInput,
                      context: TaskContext = None,
                      timeout: int = None) -> ToolOutput:
        tool = self.get_tool(name)
        actual_timeout = timeout or self._tool_timeout
        try:
            result = await asyncio.wait_for(
                tool.execute(input),
                timeout=actual_timeout
            )
            return result
        except asyncio.TimeoutError:
            return ToolOutput(result={}, error=f"Tool '{name}' timed out after {actual_timeout}s")
```

### 2.3 L2：重复检测钩子

在 `BaseModeExecutor` 中增加 `_on_enter` / `_on_exit` 生命周期钩子，L2 重复检测在 `_on_exit` 中实现：

```python
from flowforge.core.base_mode_executor import BaseModeExecutor

class BaseModeExecutor:
    MAX_CONSECUTIVE_IDENTICAL = 3

    async def run(self, ctx: TaskContext) -> dict:
        ctx = await self._prepare(ctx)
        await self._on_enter(ctx)
        result = await self._execute_core(ctx)
        result = await self._on_exit(ctx, result)
        return await self._postprocess(ctx, result)

    async def _on_enter(self, ctx: TaskContext):
        pass

    async def _on_exit(self, ctx: TaskContext, result: dict) -> dict:
        return result
```

各模式执行器可覆写 `_on_exit` 实现特定的重复检测逻辑。`ReActExecutor` 已有 `_is_loop()` 检测，`WorkflowExecutor` 的 react loop 也有 3 次重复检测。

### 2.4 L3：自修正策略

在 `WorkflowExecutor` 中新增 `on_error: "reflexion_retry"` 策略，与现有的 `skip / retry / abort` 并列：

```python
from flowforge.modes.workflow import WorkflowExecutor

class WorkflowExecutor:
    async def _handle_step_error(self, ctx, step, error, sub_ctx, context_data):
        on_error = step.get("on_error", "abort")

        if on_error == "reflexion_retry":
            reflexion_ctx = TaskContext.from_parent(
                ctx,
                input_data={"task": f"分析步骤'{step['name']}'失败原因并修正: {str(error)}"},
                mode="reflexion"
            )
            reflexion_result = await ctx.executor.run(
                reflexion_ctx, mode_hint="reflexion", _is_substep=True
            )
            context_data["_reflexion_fix"] = reflexion_result.get("suggestion", "")

            retry_count = step.get("retry_count", 2)
            for i in range(retry_count):
                try:
                    sub_result = await ctx.executor.run(
                        sub_ctx, mode_hint=step.get("mode"), _is_substep=True
                    )
                    context_data[step.get("output", step["name"])] = sub_result
                    return
                except Exception:
                    if i == retry_count - 1:
                        raise
        elif on_error == "skip":
            return
        elif on_error == "retry":
            pass
        else:
            raise
```

### 2.5 防御配置传递

防御参数通过 `ctx.metadata["defense"]` 传递，SOP 模板可声明全局和步骤级配置：

```yaml
defense:
  max_tool_calls: 50
  tool_timeout: 120
  repetition_limit: 3
  reflexion_retries: 2
  checkpoint_enabled: true

steps:
  - name: "quality_check"
    mode: reflexion
    defense:
      tool_timeout: 180
      reflexion_retries: 3
```

`WorkflowExecutor._execute_core()` 读取并合并配置：

```python
defense_config = {**self.DEFAULT_DEFENSE, **ctx.metadata.get("defense", {})}
ctx.metadata["_defense"] = defense_config
step_defense = {**defense_config, **step.get("defense", {})}
```

---

## 3. 上下文压缩系统

### 3.1 设计目标

解决 Agent "会忘事"的问题——当上下文接近窗口限制时，自动压缩早期历史，保留关键决策和最近对话。

### 3.2 ContextCompressor

`ContextCompressor` 集成到 `MemoryManager` 中，不单独暴露：

```python
from flowforge.memory.compressor import ContextCompressor

class ContextCompressor:
    RECENT_ROUNDS = 3
    COMPRESSION_THRESHOLD = 0.85
    MAX_CONTEXT_TOKENS = 128000

    def __init__(self, llm_client):
        self.llm = llm_client

    async def compress_if_needed(self, messages: list, context: TaskContext) -> list:
        total_tokens = sum(count_tokens(str(m.get("content", ""))) for m in messages)
        utilization = total_tokens / self.MAX_CONTEXT_TOKENS

        if utilization < self.COMPRESSION_THRESHOLD:
            return messages

        recent, early = self._split_messages(messages)
        if not early:
            return messages

        summary = await self._compress_early_history(early, context)
        summary_msg = {"role": "system", "content": f"[对话历史摘要] {summary}"}
        await self._save_to_memory(context, summary, len(early))
        return [summary_msg] + recent
```

### 3.3 Token 计数策略

优先使用 tiktoken 真实计数，不可用时回退到字符估算：

```python
try:
    import tiktoken
    _TOKENIZER = tiktoken.get_encoding("cl100k_base")
    def count_tokens(text: str) -> int:
        return len(_TOKENIZER.encode(text))
except ImportError:
    def count_tokens(text: str) -> int:
        return len(text)
```

### 3.4 滑动窗口 + 摘要策略

1. 以 `user` 消息为轮次边界，分离最近 N 轮（默认 3 轮）和早期历史
2. 早期历史通过 LLM 压缩为一条 system 摘要消息
3. 压缩后消息列表 = `[摘要消息] + 最近 N 轮`

```python
def _split_messages(self, messages: list) -> tuple:
    user_indices = [i for i, m in enumerate(messages) if m.get("role") == "user"]
    if len(user_indices) <= self.RECENT_ROUNDS:
        return messages, []
    cutoff = user_indices[-self.RECENT_ROUNDS]
    return messages[cutoff:], messages[:cutoff]
```

### 3.5 关键消息判断

`_is_decision()` 基于消息角色和结构判断，**不依赖关键词**：

```python
def _is_decision_or_tool_result(self, message: dict) -> bool:
    role = message.get("role", "")
    if role == "tool":
        return True
    if role == "assistant":
        content = str(message.get("content", ""))
        if "tool_calls" in content or "final answer" in content.lower():
            return True
    if role == "system":
        return True
    return False
```

### 3.6 MemoryManager 集成

```python
from flowforge.memory.manager import MemoryManager

class MemoryManager:
    def __init__(self, config: dict, llm_client=None):
        self.compressor = ContextCompressor(llm_client) if llm_client and config.get("compression_enabled", True) else None

    async def compress_messages(self, messages: list, context: TaskContext) -> list:
        if self.compressor:
            return await self.compressor.compress_if_needed(messages, context)
        return messages
```

压缩摘要自动存储到长期记忆，供未来检索使用。

---

## 4. 安全工具体系

### 4.1 BaseTool 安全标记

`BaseTool` 新增两个类属性，**不破坏现有接口**（有默认值）：

```python
from flowforge.core.base_tool import BaseTool

class BaseTool(ABC):
    name: str = "base"
    description: str = ""
    parameters_schema: dict = {}
    safety_level: str = "normal"          # readonly / normal / dangerous
    is_concurrency_safe: bool = True      # 是否并发安全
```

安全等级语义：

| safety_level | 含义 | 审批要求 |
|-------------|------|---------|
| `readonly` | 只读操作（搜索、检索） | 无需审批 |
| `normal` | 常规操作（LLM 调用、文件写入） | 仅并发时需注意 |
| `dangerous` | 危险操作（代码执行、删除、发布） | 需人工审批 |

### 4.2 SecureToolRegistry

`SecureToolRegistry` 继承 `ToolRegistry`，增加安全检查层：

```python
from flowforge.tools.secure_registry import SecureToolRegistry

class SecureToolRegistry(ToolRegistry):
    SAFETY_READONLY = "readonly"
    SAFETY_NORMAL = "normal"
    SAFETY_DANGEROUS = "dangerous"

    def __init__(self, event_bus=None):
        super().__init__()
        self._event_bus = event_bus
        self._running_tools: Dict[str, asyncio.Lock] = {}

    def register(self, tool: BaseTool):
        if not hasattr(tool, 'safety_level'):
            tool.safety_level = self.SAFETY_NORMAL
        super().register(tool)

    async def execute(self, name: str, input: ToolInput,
                      context: TaskContext = None,
                      require_approval: bool = True) -> ToolOutput:
        tool = self.get_tool(name)
        safety = getattr(tool, 'safety_level', self.SAFETY_NORMAL)

        if safety == self.SAFETY_READONLY:
            return await super().execute(name, input)

        if safety == self.SAFETY_DANGEROUS and require_approval and context:
            approved = await self._request_approval(context, name, input.params)
            if not approved:
                return ToolOutput(result={}, error=f"User denied permission for '{name}'")

        if not getattr(tool, 'is_concurrency_safe', True):
            if name not in self._running_tools:
                self._running_tools[name] = asyncio.Lock()
            async with self._running_tools[name]:
                return await super().execute(name, input)

        return await super().execute(name, input)
```

### 4.3 审批流程

审批流程复用 `HybridExecutor.register_review_wait()` + EventBus 机制，不破坏 TaskContext 封装：

```python
async def _request_approval(self, context: TaskContext, tool_name: str, params: dict) -> bool:
    if self._event_bus:
        self._event_bus.emit(context.task_id, "permission.requested", {
            "tool": tool_name,
            "params": params,
            "task_id": context.task_id
        })
        if hasattr(context, '_await_approval'):
            return await context._await_approval(tool_name, params)
    return False
```

### 4.4 并发安全

通过 `asyncio.Lock` 保护非并发安全工具，每个工具名对应一把锁：

```python
if not getattr(tool, 'is_concurrency_safe', True):
    if name not in self._running_tools:
        self._running_tools[name] = asyncio.Lock()
    async with self._running_tools[name]:
        return await super().execute(name, input)
```

---

## 5. Multi-Agent 三策略架构

三种策略统一在 `MultiAgentExecutor._execute_core()` 中分发，删除独立的 `SubAgentExecutor`：

```python
from flowforge.modes.multi_agent import MultiAgentExecutor

class MultiAgentExecutor(BaseModeExecutor):
    mode_name = "multi_agent"
    capabilities = ["collaboration"]

    async def _execute_core(self, ctx: TaskContext) -> dict:
        strategy = ctx.metadata.get("strategy", "agent_teams")

        if strategy == "subagents":
            return await self._run_subagents(ctx)
        elif strategy == "agent_teams":
            return await self._run_agent_teams(ctx)
        elif strategy == "swarms":
            return await self._run_swarms(ctx)
        else:
            raise ValueError(f"Unknown multi-agent strategy: {strategy}")
```

### 5.1 Subagents：无状态并行隔离

**核心设计**：每个子任务拥有完全独立的上下文窗口，无历史污染，执行后压缩摘要返回主上下文。

```python
async def _run_subagents(self, ctx: TaskContext) -> dict:
    tasks = ctx.metadata.get("sub_tasks", [])
    if not tasks:
        tasks = await self._decompose_task(ctx)

    async def execute_sub_task(task):
        sub_ctx = TaskContext.from_parent(
            ctx,
            input_data={"task": task.get("prompt", task.get("name"))},
            state={},
            metadata={"isolation": "full", "parent_task": ctx.task_id}
        )
        allowed_tools = task.get("tools", ["llm", "web_search"])
        sub_ctx.tools = self._filter_tools(ctx.tools, allowed_tools)

        agent = ctx.agents.get(task.get("agent_type", "default"))
        if agent is None:
            from flowforge.modes.default_llm_actors import DefaultLLMActor
            agent = DefaultLLMActor()

        agent_input = AgentInput(params={"task": task.get("prompt", task.get("name"))})
        output = await agent.execute_with_context(agent_input, sub_ctx)
        summary = await self._compress_result(sub_ctx, output.result)
        return task.get("id", task.get("name")), summary

    results = await asyncio.gather(*[execute_sub_task(t) for t in tasks])
    return {"results": dict(results)}
```

SOP 模板使用：

```yaml
steps:
  - name: "research_sources"
    mode: multi_agent
    strategy: subagents
    sub_tasks:
      - id: "search_1"
        prompt: "搜索关于{{topic}}的最新报道"
        tools: ["web_search"]
      - id: "search_2"
        prompt: "搜索关于{{topic}}的学术研究"
        tools: ["helixrag_search"]
```

### 5.2 Agent Teams：共享任务板 + 信箱通信

**核心设计**：Lead Agent 分解任务 → TaskBoard 发布 → 团队成员认领执行 → Mailbox 通信 → Lead 聚合结果。

```python
async def _run_agent_teams(self, ctx: TaskContext) -> dict:
    lead_agent = ctx.agents.get("lead") or self._get_default_lead(ctx)
    task_list = await self._create_task_board(ctx, lead_agent)
    team_members = await self._spawn_team(ctx)

    idle_rounds = 0
    last_board_hash = None

    while not self._all_tasks_done() and idle_rounds < self.max_idle_rounds:
        progress_made = False
        for member in team_members:
            task = await self.task_board.claim_task(member.name)
            if task:
                try:
                    result = await self._execute_task(member, task, ctx)
                    await self.task_board.complete_task(task["id"], result)
                    progress_made = True
                    if result.get("important"):
                        self.mailbox.send(member.name, "lead",
                                        f"发现: {result['important']}",
                                        priority="high")
                except Exception as e:
                    await self.task_board.fail_task(task["id"], str(e))
                    self.mailbox.send(member.name, "lead",
                                    f"任务 {task['id']} 失败: {str(e)}",
                                    priority="critical")

        messages = self.mailbox.receive("lead", unread_only=True)
        for msg in messages:
            if self._needs_replanning(msg):
                await self._replan(lead_agent, task_list, ctx)

        self.task_board.reset_stuck_tasks(timeout_seconds=300)

        current_hash = self._hash_board()
        if current_hash == last_board_hash:
            idle_rounds += 1
        else:
            idle_rounds = 0
            last_board_hash = current_hash

    return await self._aggregate_results(lead_agent, task_list, ctx)
```

### 5.3 Swarms：去中心化集群

**核心设计**：SwarmWorker 持续认领任务 + 心跳监控 + SwarmCoordinator 检测失联节点 + 自动任务重发布。

```python
from flowforge.modes.multi_agent import SwarmWorker, SwarmCoordinator, SwarmConfig

class SwarmWorker:
    def __init__(self, agent, task_board: TaskBoard, mailbox: Mailbox, config: SwarmConfig):
        self.agent = agent
        self.task_board = task_board
        self.mailbox = mailbox
        self.config = config
        self.running = False

    async def run(self, ctx: TaskContext):
        self.running = True
        self._heartbeat_task = asyncio.create_task(self._heartbeat(ctx))

        while self.running:
            task = await self.task_board.claim_task(self.agent.name)
            if task is None:
                all_tasks = self.task_board.get_all_tasks()
                if all(t["status"] in ("done", "failed") for t in all_tasks):
                    break
                await asyncio.sleep(1)
                continue

            try:
                result = await self._execute_task(task, ctx)
                await self.task_board.complete_task(task["id"], result)
                self.mailbox.send(self.agent.name, "coordinator",
                                f"Task {task['id']} completed",
                                tags=["task_complete"])
            except Exception as e:
                retry_count = task.get("retry_count", 0) + 1
                if retry_count < self.config.max_retry_per_task:
                    task["retry_count"] = retry_count
                    self.task_board.add_task(task["id"], task)
                else:
                    await self.task_board.fail_task(task["id"], str(e))

class SwarmCoordinator:
    def __init__(self, task_board: TaskBoard, mailbox: Mailbox, config: SwarmConfig):
        self.task_board = task_board
        self.mailbox = mailbox
        self.config = config
        self._worker_heartbeats: Dict[str, float] = {}

    async def monitor(self, ctx: TaskContext):
        while True:
            messages = self.mailbox.receive("coordinator",
                                          subject_contains="heartbeat",
                                          unread_only=True, limit=100)
            for msg in messages:
                self._worker_heartbeats[msg["sender"]] = time.time()

            now = time.time()
            for worker_name, last_beat in list(self._worker_heartbeats.items()):
                if now - last_beat > self.config.heartbeat_interval * 3:
                    self.task_board.reset_stuck_tasks(self.config.task_claim_timeout)
                    del self._worker_heartbeats[worker_name]

            await asyncio.sleep(self.config.heartbeat_interval)
```

### 5.4 三策略对比

| 维度 | Subagents | Agent Teams | Swarms |
|------|-----------|-------------|--------|
| **状态** | 无状态，完全隔离 | 共享 TaskBoard | 去中心化，各自认领 |
| **通信** | 无（结果压缩返回） | Mailbox 信箱 | Mailbox + 心跳 |
| **协调** | 无（并行执行） | Lead Agent 协调 | SwarmCoordinator 监控 |
| **适用场景** | 独立子任务并行 | 多角色协作 | 大规模分布式任务 |
| **上下文** | `TaskContext.from_parent(state={})` | 共享 TaskBoard 状态 | 各自独立 + TaskBoard |
| **容错** | 单任务失败不影响其他 | Lead 可重新规划 | 心跳检测 + 自动重发布 |

---

## 6. 协作基础设施

### 6.1 TaskBoard：原子化共享任务板

TaskBoard 使用 SQLite WAL 模式 + `RETURNING` 子句实现真正的原子认领，不支持 `RETURNING` 时回退到应用层锁：

```python
from flowforge.memory.task_board import TaskBoard

class TaskBoard:
    def __init__(self, db_path: str = "data/task_board.db"):
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.execute("PRAGMA journal_mode=WAL")
        self._lock = asyncio.Lock()
        self._supports_returning = sqlite3.sqlite_version_info >= (3, 35, 0)

    async def claim_task(self, agent_id: str) -> Optional[dict]:
        if self._supports_returning:
            return await self._claim_atomic_returning(agent_id)
        else:
            return await self._claim_with_lock(agent_id)

    async def _claim_atomic_returning(self, agent_id: str) -> Optional[dict]:
        cursor = self.conn.execute("""
            UPDATE board SET status='running', assigned_to=?, updated_at=?
            WHERE id = (
                SELECT id FROM board WHERE status='pending' ORDER BY created_at LIMIT 1
            )
            RETURNING id, task
        """, (agent_id, time.time()))
        row = cursor.fetchone()
        if row:
            self.conn.commit()
            return {"id": row[0], "task": json.loads(row[1])}
        return None

    async def _claim_with_lock(self, agent_id: str) -> Optional[dict]:
        async with self._lock:
            cursor = self.conn.execute(
                "SELECT id, task FROM board WHERE status='pending' ORDER BY created_at LIMIT 1"
            )
            row = cursor.fetchone()
            if not row:
                return None
            self.conn.execute(
                "UPDATE board SET status='running', assigned_to=?, updated_at=? WHERE id=? AND status='pending'",
                (agent_id, time.time(), row[0])
            )
            if self.conn.total_changes == 0:
                return None
            self.conn.commit()
            return {"id": row[0], "task": json.loads(row[1])}
```

关键方法：

| 方法 | 说明 |
|------|------|
| `add_task(task_id, task_data)` | 发布任务 |
| `add_tasks_batch(tasks)` | 批量发布 |
| `claim_task(agent_id)` | 原子认领（RETURNING 或应用层锁） |
| `complete_task(task_id, result)` | 标记完成 |
| `fail_task(task_id, error)` | 标记失败 |
| `reset_stuck_tasks(timeout_seconds)` | 重置超时任务为 pending |

### 6.2 Mailbox：优先级 + 过期信箱

Mailbox 支持四级优先级、主题过滤、发送者过滤和 TTL 过期：

```python
from flowforge.memory.mailbox import Mailbox

class Mailbox:
    PRIORITY_CRITICAL = "critical"
    PRIORITY_HIGH = "high"
    PRIORITY_NORMAL = "normal"
    PRIORITY_LOW = "low"

    def send(self, sender: str, recipient: str, subject: str, body: str,
             priority: str = "normal", tags: list = None, ttl_seconds: int = 3600):
        expires = time.time() + ttl_seconds if ttl_seconds > 0 else None
        self.conn.execute(
            "INSERT INTO messages (sender, recipient, subject, body, priority, tags, expires_at, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (sender, recipient, subject, body, priority,
             json.dumps(tags or []), expires, datetime.utcnow().isoformat())
        )
        self.conn.commit()

    def receive(self, recipient: str, unread_only: bool = True,
                priority: str = None, subject_contains: str = None,
                sender: str = None, limit: int = 20) -> list:
        self._cleanup_expired()
        conditions = ["recipient = ?"]
        params = [recipient]
        if unread_only:
            conditions.append("read = 0")
        if priority:
            conditions.append("priority = ?")
            params.append(priority)
        if subject_contains:
            conditions.append("subject LIKE ?")
            params.append(f"%{subject_contains}%")
        if sender:
            conditions.append("sender = ?")
            params.append(sender)
        where = " AND ".join(conditions)
        order = "ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, created_at ASC"
        rows = self.conn.execute(
            f"SELECT id, sender, subject, body, priority, tags, created_at FROM messages WHERE {where} {order} LIMIT ?",
            params + [limit]
        ).fetchall()
        return [self._row_to_dict(r) for r in rows]

    def _cleanup_expired(self):
        self.conn.execute("DELETE FROM messages WHERE expires_at IS NOT NULL AND expires_at < ?", (time.time(),))
        self.conn.commit()
```

### 6.3 DI 注入与生命周期

TaskBoard 和 Mailbox 通过 DI 注入到 `MultiAgentExecutor`，由 `HybridExecutor` 统一管理生命周期：

```python
class MultiAgentExecutor(BaseModeExecutor):
    def __init__(self, task_board: TaskBoard = None, mailbox: Mailbox = None):
        self.task_board = task_board or TaskBoard()
        self.mailbox = mailbox or Mailbox()
```

---

## 7. CheckpointManager 增强

在现有 `CheckpointManager` 上**增量增强**，不重写：

| 增强项 | 说明 |
|--------|------|
| `messages_json` 字段 | 存储完整对话历史 |
| `version` 字段 | 自动递增版本号 |
| `save_incremental()` | 增量保存（无变更则跳过） |
| `restore()` | 恢复 state + messages 到执行上下文 |
| `get_latest()` | 获取最新检查点 |
| `delete_old_versions()` | 清理旧版本（保留最近 N 个） |

```python
from flowforge.memory.checkpoint import CheckpointManager

class CheckpointManager:
    def save(self, task_id: str, state: dict, messages: list, label: str = "") -> str:
        row = self.conn.execute(
            "SELECT MAX(version) FROM checkpoints WHERE task_id=?", (task_id,)
        ).fetchone()
        next_version = (row[0] or 0) + 1
        checkpoint_id = f"{task_id}_v{next_version}"
        self.conn.execute(
            "INSERT INTO checkpoints (id, task_id, state_json, messages_json, created_at, label, version) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (checkpoint_id, task_id, json.dumps(state), json.dumps(messages),
             time.time(), label, next_version)
        )
        self.conn.commit()
        return checkpoint_id

    def save_incremental(self, task_id: str, state: dict, messages: list, label: str = "") -> str:
        latest = self.get_latest(task_id)
        if latest:
            if (json.dumps(state) == latest.get("state_json") and
                json.dumps(messages) == latest.get("messages_json")):
                return latest["id"]
        return self.save(task_id, state, messages, label)

    def restore(self, task_id: str, checkpoint_id: str = None) -> dict:
        if checkpoint_id:
            row = self.conn.execute(
                "SELECT state_json, messages_json FROM checkpoints WHERE id=?",
                (checkpoint_id,)
            ).fetchone()
        else:
            row = self.conn.execute(
                "SELECT state_json, messages_json FROM checkpoints WHERE task_id=? "
                "ORDER BY created_at DESC LIMIT 1",
                (task_id,)
            ).fetchone()
        if row:
            return {"state": json.loads(row[0]), "messages": json.loads(row[1])}
        return {}

    def delete_old_versions(self, task_id: str, keep_latest: int = 5):
        self.conn.execute(
            "DELETE FROM checkpoints WHERE task_id=? AND id NOT IN "
            "(SELECT id FROM checkpoints WHERE task_id=? ORDER BY created_at DESC LIMIT ?)",
            (task_id, task_id, keep_latest)
        )
        self.conn.commit()
```

---

## 8. v5.0 能力矩阵

| 能力 | v4.0 | v5.0 |
|------|------|------|
| **防御机制** | 无 | 三层防御（L1 超时 / L2 重复检测 / L3 自修正） |
| **上下文管理** | 基础 Memory（5 种策略） | 压缩 + 滑动窗口 + tiktoken 计数 + MemoryManager 集成 |
| **工具安全** | 无标记 | `safety_level`（readonly/normal/dangerous）+ 并发锁 + 审批 |
| **Multi-Agent** | 简单并行 | 三策略（Subagents / Teams / Swarms） |
| **协作通信** | 无 | TaskBoard（原子认领）+ Mailbox（四级优先级 + TTL） |
| **检查点** | 基础 save/load | 增量保存 + 版本号 + 恢复 + 旧版本清理 |
| **SOP 配置** | 步骤级 on_error | 全局 + 步骤级 defense 配置 + `reflexion_retry` 策略 |

---

## 9. v5.0 架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                      应用层 (app layer)                         │
│      (ContentForge / NovelForge 等具体业务)                     │
└────────────────────────────┬────────────────────────────────────┘
                             │  依赖注入 & 注册
┌────────────────────────────▼────────────────────────────────────┐
│                FlowForge v5.0 (Agent OS)                        │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │            HybridExecutor (混合执行器)                     │   │
│  │  - 自动模式选择 / 显式指定                                  │   │
│  │  - Persona 锁、审核暂停/恢复                                │   │
│  │  - TaskBoard / Mailbox 生命周期管理                         │   │
│  └──────────────────────┬───────────────────────────────────┘   │
│                         │ 调度                                   │
│  ┌──────────────────────▼───────────────────────────────────┐   │
│  │          ModeRegistry (模式注册中心)                        │   │
│  │  - react, plan_execute, reflexion, multi_agent            │   │
│  │  - workflow, graph_of_thoughts, rewoo, self_discover      │   │
│  │  - agent_judge                                            │   │
│  └──────────────────────┬───────────────────────────────────┘   │
│                         │ 使用工具/Agent                         │
│  ┌──────────────────────▼───────────────────────────────────┐   │
│  │    SecureToolRegistry & AgentRegistry                     │   │
│  │  - safety_level (readonly/normal/dangerous)               │   │
│  │  - 并发锁 (asyncio.Lock)                                   │   │
│  │  - 审批流程 (EventBus + register_review_wait)              │   │
│  │  - L1 超时防御 (单次工具调用 120s)                          │   │
│  └──────────────────────┬───────────────────────────────────┘   │
│                         │ 状态与事件                             │
│  ┌──────────────────────▼───────────────────────────────────┐   │
│  │     StateManager & EventBus (可观测性)                     │   │
│  │  - CheckpointManager (增量保存 + 版本号 + 恢复)             │   │
│  │  - 事件推送 (WebSocket / Console / Log)                    │   │
│  │  - Solo 模式全事件映射 (16 种事件类型)                       │   │
│  └──────────────────────┬───────────────────────────────────┘   │
│                         │                                       │
│  ┌──────────────────────▼───────────────────────────────────┐   │
│  │       MemoryManager v5.0 (记忆 + 压缩)                    │   │
│  │  - 5 种记忆策略 (工作/短期/长期/语义/情景)                   │   │
│  │  - ContextCompressor (tiktoken + 滑动窗口 + 摘要)          │   │
│  │  - TaskBoard (原子认领 + WAL + RETURNING)                  │   │
│  │  - Mailbox (四级优先级 + 主题过滤 + TTL 过期)               │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │       三层防御 (Defense in Depth)                          │   │
│  │  L1: ToolRegistry.execute() 单次工具调用超时               │   │
│  │  L2: BaseModeExecutor._on_exit() 重复检测钩子              │   │
│  │  L3: WorkflowExecutor on_error="reflexion_retry" 自修正    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │       Multi-Agent 三策略 (MultiAgentExecutor)              │   │
│  │  Subagents: 无状态并行隔离 (TaskContext.from_parent)        │   │
│  │  Teams:     共享 TaskBoard + Mailbox + Lead Agent          │   │
│  │  Swarms:    SwarmWorker + SwarmCoordinator + 心跳监控      │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

---

**以上为 FlowForge 架构设计文档 v5.0 (防御与协作增强版)。** 本版本在 v4.0 基础上新增三层防御、上下文压缩、安全工具、三种 Multi-Agent 策略、协作基础设施，解决了"Agent 易犯错、会偷懒、会忘事"的生产级痛点。所有 v4.0 接口保持兼容。