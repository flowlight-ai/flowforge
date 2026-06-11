# FlowForge v6.0 架构设计

> **定位**：从 Agent 编排框架进化为 **Agent 驾驭层 (Harness Layer)**——为 AI Agent 提供约束、反馈、上下文管理与熵控制的完整控制论系统。
> **哲学**：让架构成为配置，让扩展成为插件，让 Harness 负责约束、验证和进化。
> **关系声明**：FlowForge 是独立开源项目（MIT），ContentForge 是其应用层参考实现。
> **版本说明**：本文档合并 v4.0（九大模式 + 通用 Agent/Workflow 库）与 v5.0（三层防御 + 协作增强），新增 v6.0 Harness 驾驭层、Skill 系统、MCP 模块，并应用三轮评审的全部修复。历史版本已归档至 docs/archive/。

---

## 1. 项目概述与设计目标

FlowForge 是一个解耦了业务逻辑的通用 Agent 操作系统内核，封装了业界主流的 9 种 Agent 架构模式，提供统一的工具注册、状态管理、可观测性接口，并通过 **四根 Harness 护栏**（上下文工程、架构约束、反馈循环、熵管理）为 Agent 提供完整的控制回路，让开发者通过声明式配置（YAML/JSON）即可组合出可控、可观测、可进化的智能体工作流。

### 1.1 核心公式

```
Agent = Model (Brain) + Harness (Body)
FlowForge = Harness Layer = 前馈控制 + 反馈控制 + 熵管理 + 可观测性
```

### 1.2 为什么需要 FlowForge？

当前多数 Agent 项目的痛点：
- **"堆 Prompt"陷阱**：把大量规则塞进系统提示词，导致上下文膨胀、行为不稳定。
- **紧耦合**：Agent 逻辑、工具调用、流程控制互相穿插，牵一发而动全身。
- **不可复用**：为一个业务场景构建的 Agent 逻辑，无法直接用于另一项目。
- **Agent 易犯错**：自评准确率远高于互评，模型自我美化、虚报完成。
- **Agent 会偷懒**：跳过关键步骤、输出不完整、重复相同操作。
- **Agent 会忘事**：长任务中上下文溢出、重启后丢失历史。

FlowForge 通过**将控制流（Control Flow）与反馈机制（Feedback Loop）从业务逻辑中完全剥离**，并通过 Harness 驾驭层提供前馈+反馈的完整控制回路，解决了这些问题。

### 1.3 与 ContentForge 的关系

FlowForge 是独立开源项目（MIT），ContentForge 是其应用层参考实现。FlowForge 可以完全不依赖 ContentForge 运行，其他项目可以通过 `pip install flowforge` 独立使用。ContentForge 作为 FlowForge 的上层应用，通过注册 Agent/Tool/Workflow/Skill 来实现内容创作业务。

### 1.4 设计目标

| 维度 | 目标 |
|------|------|
| **通用性** | 核心不感知业务概念，只定义 TaskContext 和 Agent/Tool 接口 |
| **完整性** | 内置 9 种主流 Agent 模式，支持混合编排 |
| **可扩展性** | 任何新模式、新工具可通过注册机制热插拔；支持 MCP、OpenAPI、GraphQL、Skill 等协议接入 |
| **生产就绪** | 内置 Harness 四根护栏、三层防御、追踪、指标、检查点、Persona 锁、Human-in-the-Loop、Helm 实时交互 |
| **开源友好** | MIT 许可证，完善的文档和例子，支持通过 `pip install flowforge` 安装 |
| **高性能** | 基于 asyncio 异步执行，支持并行步骤和流式输出 |

---

## 2. 架构总览

### 2.1 六层架构模型

FlowForge v6.0 采用分层解耦的 Harness 架构，整体分为六层：

```
┌─────────────────────────────────────────────────────────────────────┐
│  6. 应用层 (Application Layer)                                      │
│     ContentForge / NovelForge / 其他业务系统                        │
├─────────────────────────────────────────────────────────────────────┤
│  5. 接入层 (Gateway Layer)                                          │
│     FastAPI REST API + WebSocket (Helm/Events) + Web UI + CLI       │
├─────────────────────────────────────────────────────────────────────┤
│  4. Harness 驾驭层 (Harness Layer) ★ v6.0 核心                      │
│     上下文工程 | 架构约束 | 反馈循环 | 熵管理 | 权限管线 | 会话管理  │
├─────────────────────────────────────────────────────────────────────┤
│  3. 执行引擎层 (Engine Layer)                                       │
│     HybridExecutor (TAOR循环) | ModeRegistry (9大模式) | Scheduler  │
├─────────────────────────────────────────────────────────────────────┤
│  2. 能力层 (Capability Layer)                                       │
│     Tool生态 (MCP/OpenAPI/GraphQL) | Skill系统 | Agent库 | Memory   │
├─────────────────────────────────────────────────────────────────────┤
│  1. 基础设施层 (Infrastructure Layer)                               │
│     SQLite/PostgreSQL | Redis | Qdrant/Milvus | LangGraph | LLM API │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 完整架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           应用层 (Application Layer)                         │
│               ContentForge / NovelForge / 其他业务系统                       │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │  依赖注入 & 注册
┌─────────────────────────────────▼───────────────────────────────────────────┐
│                      FlowForge v6.0 — Harness 驾驭层                         │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │               HarnessOrchestrator (统一入口)                          │   │
│  │  pre_execute(ctx): context.inject() + entropy.check()                │   │
│  │  post_execute(result, ctx): constraints.validate() + feedback.eval() │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                         四根护栏 (四大引擎)                            │   │
│  │                                                                       │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │   │
│  │  │ 上下文工程   │  │ 架构约束    │  │ 反馈循环    │  │ 熵管理      │  │   │
│  │  │ ContextEngine│  │ ArchCons-   │  │ FeedbackLoop│  │ EntropyMgr │  │   │
│  │  │             │  │ traintEngine│  │             │  │             │  │   │
│  │  │ · AGENTS.md │  │ · 分层依赖  │  │ · 独立评判  │  │ · 文档园丁  │  │   │
│  │  │ · 会话交接  │  │ · Linter   │  │ · 四维评分  │  │ · 技术债回收│  │   │
│  │  │ · 按需注入  │  │ · CI阻断   │  │ · 自修正    │  │ · 规则进化  │  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                   HybridExecutor (核心调度器)                         │   │
│  │  · 模式选择 (9 大模式)                                                │   │
│  │  · TAOR 循环 (Think-Act-Observe-Repeat)                              │   │
│  │  · Persona 锁 + 审核暂停/恢复                                        │   │
│  │  · Harness Hook: pre_execute / post_execute                          │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │          ModeRegistry (9大模式) + AgentRegistry + ToolRegistry       │   │
│  │  react | plan_execute | reflexion | multi_agent | workflow           │   │
│  │  rewoo | self_discover | agent_judge | graph_of_thoughts             │   │
│  │  SkillRegistry (4种格式适配) | MCP Broker (4层架构)                   │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │       MemoryManager (5种记忆) + EventBus (可观测性)                   │   │
│  │  工作记忆 | 短期记忆 | 长期记忆 | 语义记忆 | 情景记忆                 │   │
│  │  TaskBoard (原子认领) | Mailbox (四级优先级) | CheckpointManager      │   │
│  │  SessionManager (92%阈值压缩) | Helm 16种事件映射                     │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │       三层防御 (Defense in Depth)                                     │   │
│  │  L1: ToolRegistry.execute() 单次工具调用超时 (120s)                   │   │
│  │  L2: BaseModeExecutor._on_exit() 重复检测钩子 (threshold=3)          │   │
│  │  L3: WorkflowExecutor on_error="reflexion_retry" 自修正              │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │       PermissionPipeline (三层权限管线)                                │   │
│  │  deny → ask → allow (deny 永远胜出)                                  │   │
│  │  四级动作分级: Read / Suggest / Prepare / Execute                     │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

**依赖方向**：应用层 → 接入层 → Harness 层 → 执行引擎层 → 能力层 → 基础设施层。严禁反向依赖。

### 2.3 控制回路设计

```
                 ┌─────────────────┐
                 │  前馈控制        │
                 │  · AGENTS.md    │
                 │  · Skill 注入   │
                 │  · Linter 规则  │
                 │  · 权限管线     │
                 └────────┬────────┘
                          │
                          ▼
┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│  用户需求    │ → │ Agent 执行  │ → │   输出      │ → │  验证工具   │
│  自然语言    │   │ (9大模式)   │   │ (代码/文章) │   │ (测试/审查) │
└─────────────┘   └─────────────┘   └─────────────┘   └──────┬──────┘
                                                             │
                                                             │ 失败
                                                             ▼
                 ┌─────────────────┐   ┌─────────────────┐
                 │  反馈控制        │ ← │  熵管理         │
                 │  · 独立评判Agent│   │  · 文档园丁     │
                 │  · 四维评分     │   │  · 技术债回收   │
                 │  · 自修正循环   │   │  · 规则进化     │
                 └─────────────────┘   └─────────────────┘
```

---

## 3. 核心定位与竞品分析

### 3.1 三维定位模型

```
                    Agent 思维复杂度
                         ▲
                         │
                    ┌────┴────┐
                    │FlowForge│  ← "Agent 驾驭层 (Harness Layer)"
                    │ 9种内置 │
                    │ 思维模式 │
                    │+四根护栏 │
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
| **核心定位** | 底层状态机"发动机" | 低代码"整车" | 角色扮演"剧组" | 软件公司模拟 | 多Agent对话框架 | 确定性工作流引擎 | **Agent 驾驭层 (Harness)** |
| **编排方式** | Python 硬编码 | UI 拖拽 Pipeline | 硬编码 Prompt 角色 | 硬编码 SOP | 硬编码对话流 | 声明式 Workflow | **声明式 YAML + 9种思维模式 + Harness 护栏** |
| **内置思维模式** | 0 | 0 | 0 | 0 | 0 | 0 | **9种可组合模式** |
| **Harness 护栏** | 无 | 无 | 无 | 无 | 无 | 无 | **四根护栏 (上下文/约束/反馈/熵)** |
| **通用Agent** | 无 | 无 | 无 | 少量角色模板 | 无 | 无 | **30+ 预置通用Agent** |
| **Skill 系统** | 无 | 无 | 无 | 无 | 无 | 无 | **4种格式适配 + 组合技** |
| **MCP 支持** | 无 | 无 | 无 | 无 | 无 | 无 | **4层架构 (Client→Gateway→Broker→Adapter)** |
| **Helm交互** | 无 | 无 | 无 | 无 | 无 | 无 | **原生Helm模式 (16种实时事件)** |
| **Memory** | Checkpoint（单一） | 无独立模块 | 无 | 无 | 无 | 无 | **5种记忆策略 + SessionManager** |
| **可扩展性** | 自定义Node | 插件市场 | 自定义Agent | 自定义Role | 自定义Agent | 自定义Activity | **Mode/Agent/Tool/Skill 四层插件 + 注册机制** |
| **目标用户** | 资深AI工程师 | 产品经理/非AI开发者 | 研究人员 | 研究人员 | 研究人员 | 后端工程师 | **AI工程团队** |

### 3.3 一句话定位

- **LangGraph** 给你零件，你得自己造引擎。
- **Dify** 给你整车，但只能跑标准路。
- **CrewAI** 给你剧组，但只能演固定剧本。
- **FlowForge** 给你一个**Agent 驾驭层**：预置 9 种思维模式、四根 Harness 护栏、30+ 通用 Agent、Skill 系统、MCP 生态，你只需配置参数，即可批量生产可控、可观测、可进化的专家 Agent。

### 3.4 核心护城河

1. **四根 Harness 护栏**：上下文工程、架构约束、反馈循环、熵管理——为 Agent 提供完整控制回路，这是其他框架不具备的。
2. **9 种高级 Agent 模式的深刻工程化实现**：对每种模式的思考过程、反馈循环、终止条件、错误处理的深度编码。
3. **Skill 系统 + MCP 生态**：4 种 Skill 格式适配 + MCP 四层架构，实现跨平台能力复用。
4. **Helm 交互模式**：提供极致透明度和控制力，任何其他框架目前不具备。

---

## 4. 核心接口设计

### 4.1 接口兼容性声明

FlowForge v6.0 的 `BaseAgent` 和 `BaseTool` 接口与 v4.0/v5.0 **完全兼容**，现有 Agent 实现**无需修改一行代码**即可迁移。v6.0 新增 `harness_enabled` 标记和 `safety_level` 属性，均有默认值，不破坏现有代码。

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
    interaction_mode: str = "standard"   # 交互模式: standard / helm
    checkpoint: CheckpointManager
    event_bus: EventBus
    memory: MemoryManager
    executor: Optional['HybridExecutor'] = None  # Workflow 嵌套调用
    harness_enabled: bool = False        # ★ v6.0 新增：是否启用 Harness 层

    # ★ Plan 模式扩展字段
    plan_mode: bool = False               # 是否为 Plan 模式
    plan_active: bool = False             # Plan 是否已确认并正在执行
    plan_id: Optional[str] = None         # Plan 唯一标识
    is_plan_step: bool = False            # 当前是否在执行 Plan 的某个步骤
    plan_step_index: int = 0              # 当前步骤索引（从 0 开始）
    plan_total_steps: int = 0             # Plan 总步骤数
    plan_step_name: Optional[str] = None  # 当前步骤名称
```

### 4.2.1 Plan 模式 TaskContext 字段说明

| 字段 | 类型 | 说明 | 生命周期 |
|------|------|------|---------|
| `plan_mode` | `bool` | 标识当前任务是否使用 Plan 模式 | 任务创建时设置，全程不变 |
| `plan_active` | `bool` | Plan 是否已确认并正在执行 | 用户确认后置 True，Plan 完成后置 False |
| `plan_id` | `Optional[str]` | Plan 唯一标识，用于 HelmDatabase 查询 | Plan 生成时创建 |
| `is_plan_step` | `bool` | 当前执行上下文是否为 Plan 的某个步骤 | 步骤执行期间为 True |
| `plan_step_index` | `int` | 当前步骤在 Plan 中的索引 | 步骤执行期间有效 |
| `plan_total_steps` | `int` | Plan 的总步骤数 | Plan 确认时设置 |
| `plan_step_name` | `Optional[str]` | 当前步骤的名称 | 步骤执行期间有效 |

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

### 4.4 BaseTool — 工具抽象

```python
class BaseTool(ABC):
    name: str = "base"
    description: str = ""
    parameters_schema: dict = {}
    safety_level: str = "normal"          # readonly / normal / dangerous  ★ v5.0 新增
    is_concurrency_safe: bool = True      # 是否并发安全                  ★ v5.0 新增

    @abstractmethod
    async def execute(self, input: ToolInput) -> ToolOutput:
        """核心执行方法 (与 ContentForge 签名完全一致)"""
        pass
```

安全等级语义：

| safety_level | 含义 | 审批要求 |
|-------------|------|---------|
| `readonly` | 只读操作（搜索、检索） | 无需审批 |
| `normal` | 常规操作（LLM 调用、文件写入） | 仅并发时需注意 |
| `dangerous` | 危险操作（代码执行、删除、发布） | 需人工审批 |

### 4.5 BaseModeExecutor — 模式执行器抽象

```python
class BaseModeExecutor(ABC):
    mode_name: str
    capabilities: list[str]  # ["retrieval", "planning", "reasoning", "generation", "evaluation"]

    async def _prepare(self, ctx: TaskContext) -> TaskContext: ...
    @abstractmethod
    async def _execute_core(self, ctx: TaskContext) -> dict: ...
    async def _postprocess(self, ctx: TaskContext, result: dict) -> dict: ...

    # ★ v5.0 新增：生命周期钩子
    async def _on_enter(self, ctx: TaskContext): pass
    async def _on_exit(self, ctx: TaskContext, result: dict) -> dict: return result

    async def run(self, ctx: TaskContext) -> dict:
        ctx = await self._prepare(ctx)
        await self._on_enter(ctx)
        result = await self._execute_core(ctx)
        result = await self._on_exit(ctx, result)
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
    def __init__(self, mode_registry, agent_registry, tool_registry,
                 event_bus, harness=None, task_repo=None, audit_repo=None): ...

    async def run(self, context: TaskContext, mode_hint: str = None) -> dict:
        # ★ v6.0 Harness Hook
        if context.harness_enabled and self.harness:
            await self.harness.pre_execute(context)
        result = await self._execute_with_mode(context, mode_hint)
        if context.harness_enabled and self.harness:
            result = await self.harness.post_execute(result, context)
        return result

    async def submit_review(self, task_id, verdict, feedback="", edited_draft=""): ...
    async def pause_task(self, task_id): ...
    async def resume_task(self, task_id): ...
    async def get_task_snapshot(self, task_id) -> dict: ...

    # ★ Plan 模式入口
    async def run_plan(self, context: TaskContext) -> dict:
        """Plan 模式执行：确认后将 Plan 转换为临时 Workflow YAML，委托 WorkflowExecutor 执行

        执行流程：
        1. Plan 生成阶段：ContextEngine 注入上下文，LLM 生成 Plan 步骤
        2. Plan 确认阶段：PermissionPipeline prepare 级别审批
        3. 步骤执行阶段：每步 Harness 正常 + lightweight FeedbackLoop
        4. Plan 完成阶段：full FeedbackLoop 终审
        """
        # 1. 生成 Plan（ContextEngine 注入上下文）
        if context.harness_enabled and self.harness:
            await self.harness.context.inject_dynamic_context(
                context.input_data, context.persona or "default")

        plan = await self._generate_plan(context)
        context.plan_id = plan["plan_id"]
        context.plan_total_steps = len(plan["steps"])

        # 2. 确认阶段：PermissionPipeline prepare 级别
        if context.harness_enabled and self.harness:
            permission = await self.harness.permission.evaluate(
                "plan_confirm", plan, context)
            if permission == "deny":
                return {"status": "denied", "plan_id": plan["plan_id"]}

        # 3. 转换为临时 Workflow YAML 并委托 WorkflowExecutor 执行
        workflow_yaml = self._plan_to_workflow(plan)
        context.plan_active = True
        context.metadata["sop_steps"] = workflow_yaml["steps"]

        result = await self._execute_with_mode(context, "workflow")

        # 4. Plan 完成阶段：full FeedbackLoop
        if context.harness_enabled and self.harness:
            result = await self.harness.feedback.evaluate_agent_output(
                result, context, evaluation_mode="full")
        context.plan_active = False
        return result
```

---

## 5. 九大内置模式详解

| 模式名称 | 英文 | 核心机制 | 适用场景 |
|---------|------|---------|----------|
| `react` | ReAct | Thought → Action → Observation 循环（MAX_STEPS=8, 含循环检测） | 需要多步动态检索或工具调用 |
| `plan_execute` | Plan-and-Execute | Planner 生成步骤清单，Executor 依次执行 | 路径明确、步骤可预测的任务 |
| `reflexion` | Reflexion | Actor → Evaluator → Reflector → 记忆 (MAX_ITERATIONS=4, QUALITY_THRESHOLD=0.85) | 需要反复打磨才能达标的任务（代码、文档） |
| `multi_agent` | Multi-Agent | Subagents/Teams/Swarms 三策略，Orchestrator 分发 | 需要多角色配合的复杂任务 |
| `workflow` | Workflow / Orchestration | 预定义的 DAG 流程，可混合其他模式（禁止嵌套Workflow，max_depth=3） | 长流程、端到端的业务流水线 |
| `graph_of_thoughts` | Graph of Thoughts | 图式推理，多思路聚合、交叉验证 | 复杂推理、数学证明、多源情报融合 |
| `rewoo` | ReWOO | 一次性规划所有工具调用，批量执行 | 确定性多 API 调用，需高吞吐 |
| `self_discover` | Self-Discover | 任务前自动发现最佳推理结构 | 不确定领域，先验知识未知的任务 |
| `agent_judge` | Agent-as-Judge | 用独立 Agent 作为评判者，提供定性反馈 | 无外部评分标准，依赖"审美"或"逻辑"评价 |

### 5.1 Reflexion 模式内部实现策略

Reflexion 模式采用**三个独立 Agent** 实现：

| 角色 | Agent 名称约定 | 默认实现 |
|------|--------------|---------|
| **Actor** | `reflexion_actor` | `DefaultLLMActor` — 使用 LLMTool 调用 LLM 生成输出 |
| **Evaluator** | `reflexion_evaluator` | `DefaultLLMEvaluator` — 使用 LLMTool 调用 LLM 进行量化评分 |
| **Reflector** | `reflexion_reflector` | `DefaultLLMReflector` — 使用 LLMTool 调用 LLM 分析失败原因 |

### 5.2 Workflow 模式安全机制

- **递归深度限制**：`max_workflow_depth = 3`，达到上限后抛出 `WorkflowRecursionError`
- **嵌套禁止**：Workflow 步骤不允许指定 `mode: workflow`
- **步骤级错误处理**：每个步骤支持 `on_error: skip / retry / reflexion_retry / abort` 配置
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

| # | Agent 名称 | 核心能力 | 默认模式 |
|---|-----------|---------|---------|
| 1 | **TopicResearchAgent** | 多级检索策略：缓存→HelixRAG→热榜→自定义 | `rewoo` |
| 2 | **MaterialCollectionAgent** | 并行多源检索、素材清洗、关键事实提取 | `rewoo` |
| 3 | **ArticleWritingAgent** | 三层生成管道：大纲→初稿→润色，风格注入 | `reflexion` |
| 4 | **SEOOptimizationAgent** | 标题优化、关键词植入、段落结构优化 | `plan_execute` |
| 5 | **FactCheckAgent** | 链接有效性检查、数据交叉验证 | `react` |
| 6 | **ContentAuditAgent** | LLM 质量评分、问题检测与分类 | `agent_judge` |
| 7 | **HeadlineOptimizer** | A/B 测试式标题生成、点击率预估 | `reflexion` |
| 8 | **ContentRepurposer** | 长文→短文/视频脚本/社交媒体帖子的多格式转换 | `plan_execute` |
| 9 | **TrendAnalysisAgent** | 实时热点趋势分析、热度预测 | `react` |
| 10 | **PublishingAgent** | 多平台发布适配、格式转换、熔断保护 | `plan_execute` |
| 11 | **ImageResearchAgent** | 根据文章内容语义匹配版权图片 | `rewoo` |
| 12 | **MultilingualAgent** | 内容多语言翻译与本地化适配 | `plan_execute` |

### 6.3 小说创作类 Agent (📅 待验证 — NovelForge Phase 3)

| # | Agent 名称 | 核心能力 | 默认模式 |
|---|-----------|---------|---------|
| 1 | **OutlinePlanningAgent** | 三幕/五幕结构生成、章节大纲规划 | `self_discover` |
| 2 | **CharacterDesignAgent** | 人物小传、性格弧线、关系网络设计 | `graph_of_thoughts` |
| 3 | **ChapterWritingAgent** | 按大纲写作单章，保持风格一致 | `reflexion` |
| 4 | **PlotIntegrationAgent** | 多线叙事整合、伏笔管理、时间线校验 | `graph_of_thoughts` |
| 5 | **StyleConsistencyAgent** | 跨章节风格一致性检查、语言风格适配 | `agent_judge` |
| 6 | **VolumeAggregatorAgent** | 多章节聚合、目录生成、格式统一 | `plan_execute` |
| 7 | **DialogueGenerationAgent** | 人物对话生成、语气差异化、口语化处理 | `reflexion` |
| 8 | **ConflictDevelopmentAgent** | 戏剧冲突设计、张力曲线评估、节奏控制 | `graph_of_thoughts` |
| 9 | **WorldBuildingAgent** | 世界观设定、规则体系、地图/势力设计 | `plan_execute` |
| 10 | **ReaderEngagementAgent** | 评论情感分析、读者偏好追踪 | `reflexion` |
| 11 | **SerializationAgent** | 断章钩子设计、留存率优化、更新节奏建议 | `reflexion` |
| 12 | **AdaptationAgent** | 小说→剧本/漫画脚本的格式转换 | `plan_execute` |

### 6.4 代码与工具类 Agent (🔄 设计中)

| # | Agent 名称 | 核心能力 | 默认模式 |
|---|-----------|---------|---------|
| 1 | **CodeReviewAgent** | 代码变更分析、多维度审查 | `reflexion` |
| 2 | **TaskDecompositionAgent** | 复杂任务分解为分步计划 | `plan_execute` |
| 3 | **MetaPlannerAgent** | 分析任务，输出最佳思维框架 | `self_discover` |
| 4 | **DebateAgent** | 多角色辩论，输出综合结论 | `multi_agent` |
| 5 | **DataAnalysisAgent** | 数据清洗、统计摘要、可视化建议 | `rewoo` |
| 6 | **PromptOptimizerAgent** | 自动分析 prompt 效果并迭代优化 | `reflexion` |
| 7 | **TestGenerationAgent** | 根据代码自动生成测试 | `reflexion` |
| 8 | **DocumentationAgent** | 代码→API文档/用户手册 | `plan_execute` |

### 6.5 通用 Workflow 库

| # | Workflow 名称 | 使用 Agent | 描述 | 状态 |
|---|--------------|-----------|------|------|
| 1 | **DeepArticleWorkflow** | TopicResearch → MaterialCollection → ArticleWriting → SEOOpt → FactCheck → ContentAudit → Publishing | 深度长文创作全流程 | ✅ |
| 2 | **QuickPostWorkflow** | TopicResearch → ArticleWriting → Publishing | 快速帖子生成 | ✅ |
| 3 | **TrendArticleWorkflow** | TrendAnalysis → TopicResearch → ArticleWriting → Publishing | 热点追踪创作 | ✅ |
| 4 | **MultiPlatformWorkflow** | ArticleWriting → ContentRepurposer → Publishing(×N) | 多平台内容分发 | ✅ |
| 5 | **SEOContentWorkflow** | TopicResearch → SEOOpt → ArticleWriting → FactCheck → Publishing | SEO优化内容 | ✅ |
| 6 | **ImageArticleWorkflow** | ArticleWriting → ImageResearch → ContentAudit → Publishing | 配图文章创作 | ✅ |
| 7 | **MultilingualWorkflow** | ArticleWriting → MultilingualAgent → Publishing(×N) | 多语言内容发布 | ✅ |
| 8 | **ReportGenerationWorkflow** | TopicResearch(×3) → MaterialCollection(×3) → ArticleWriting → ContentAudit | 深度报告生成 | ✅ |
| 9 | **NovelFullProcessWorkflow** | OutlinePlanning → CharacterDesign → ChapterWriting(×N) → StyleConsistency | 完整小说创作 | 📅 |
| 10 | **NovelChapterWorkflow** | ChapterWriting → PlotIntegration → StyleConsistency | 单章创作 | 📅 |
| 11 | **CodeReviewWorkflow** | CodeAnalysis → parallel(Security, Performance) → ReportAggregator | 代码审查 | 🔄 |
| 12 | **AIDebateWorkflow** | 3×DebateAgent + GraphReasonerAgent | AI辩论评审 | 🔄 |
| 13 | **FactCheckingWorkflow** | DeepResearch → SelfCritic → AdvancedWriting | 事实核查 | 🔄 |
| 14 | **ContentCalendarWorkflow** | MetaPlanner → DeepResearch → 并行 AdvancedWriting | 内容日历策划 | 🔄 |
| 15 | **LearningPathWorkflow** | MetaPlanner → TaskDecomposition → 并行多个 Agent | 个性化学习路径 | 🔄 |

---

## 7. Harness 驾驭层设计

> ★ v6.0 核心新增——四根护栏 + 统一编排

### 7.1 上下文工程（Context Engineering）

**核心问题**：Agent 不知道看什么、找什么、怎么找。

**核心能力**：
- AGENTS.md 动态知识注入：按任务域（domain）检索相关规则
- 历史失败案例检索：从知识库中检索同类任务的历史教训
- 会话交接物构建：`init_script + progress_log + feature_checklist`
- 按需上下文注入：只在 Agent 需要时注入，不污染上下文窗口

```python
# flowforge/harness/context/context_engine.py

class ContextEngine:
    """上下文工程引擎：按需知识注入 + 交接机制"""

    def __init__(self, knowledge_base, llm_client, memory_manager):
        self.kb = knowledge_base
        self.llm = llm_client
        self.memory = memory_manager

    async def build_handoff_artifacts(self, ctx: 'TaskContext') -> dict:
        """构建会话交接物（类比 Anthropic 的 init.sh + progress.txt）"""
        artifacts = {
            "init_script": await self._generate_init_script(ctx),
            "progress_log": await self._build_progress_log(ctx),
            "feature_checklist": await self._build_feature_checklist(ctx),
        }
        await self.memory.save("project", f"handoff_{ctx.task_id}", artifacts)
        return artifacts

    async def inject_dynamic_context(self, task: dict, persona: str) -> str:
        """按需注入上下文：规则 + 历史教训 + 交接物"""
        context_parts = []
        rules = await self.kb.retrieve(f"rules:{persona}", top_k=5)
        if rules:
            context_parts.append(f"【项目规则】\n{rules}")
        mistakes = await self.kb.retrieve(f"mistakes:{task.get('domain', '')}", top_k=3)
        if mistakes:
            context_parts.append(f"【同类任务历史教训】\n{mistakes}")
        handoff = await self.memory.retrieve("project", f"handoff_{task.get('parent_task_id')}")
        if handoff:
            context_parts.append(f"【上次会话交接】\n{handoff}")
        return "\n\n".join(context_parts)
```

### 7.2 会话管理（SessionManager）

**核心能力**：
- 92% 阈值触发上下文压缩（`COMPACTION_THRESHOLD = 0.92`）
- 计算方式：`utilization = total_tokens / model_context_window`（默认 128K）
- 保留最近 N 轮完整对话（默认 3，可配置）
- 工具输出 Token 截断（默认 25000 tokens）
- 会话交接：检查点保存 + 交接物传递

```python
# flowforge/harness/context/session_manager.py

class SessionManager:
    """会话管理引擎：交接物 + 压缩 + 检查点"""

    COMPACTION_THRESHOLD = 0.92  # 92% 阈值触发（与 Claude Code 实测对齐）
    MAX_TOOL_OUTPUT_TOKENS = 25000
    TOOL_OUTPUT_WARNING_TOKENS = 10000

    def __init__(self, checkpoint_mgr, memory_manager, llm_client):
        self.checkpoint = checkpoint_mgr
        self.memory = memory_manager
        self.llm = llm_client

    async def handle_tool_output(self, tool_name: str, result: dict, ctx: 'TaskContext') -> dict:
        """处理超大工具输出：截断 + 磁盘持久化"""
        result_json = json.dumps(result, ensure_ascii=False)
        tokens = count_tokens(result_json)
        if tokens > self.MAX_TOOL_OUTPUT_TOKENS:
            persist_path = f"data/tool_outputs/{ctx.task_id}/{tool_name}_{int(time.time())}.json"
            os.makedirs(os.path.dirname(persist_path), exist_ok=True)
            with open(persist_path, 'w') as f:
                f.write(result_json)
            truncated = self._truncate_to_tokens(result, self.MAX_TOOL_OUTPUT_TOKENS)
            truncated["_persisted_full_result"] = persist_path
            return truncated
        elif tokens > self.TOOL_OUTPUT_WARNING_TOKENS:
            ctx.event_bus.emit(ctx.task_id, "context.warning",
                {"tool": tool_name, "tokens": tokens})
        return result

    async def compact_if_needed(self, messages: list, ctx: 'TaskContext') -> list:
        """92% 阈值触发自动压缩"""
        total_tokens = sum(count_tokens(str(m)) for m in messages)
        utilization = total_tokens / self.max_context_tokens
        if utilization >= self.COMPACTION_THRESHOLD:
            critical = self._extract_critical(messages)
            summary = await self._summarize(messages[:-20], ctx)
            await self.checkpoint.save(ctx.task_id, ctx.state, messages, "auto_compact")
            return [{"role": "system", "content": f"[会话摘要] {summary}"}] + critical
        return messages
```

### 7.3 架构约束（Architecture Constraints）

**核心问题**：Agent 复制并放大坏模式；不知道什么是"好的代码结构"。

**核心能力**：
- 分层依赖模型：Types → Config → Repo → Service → Runtime → UI
- 基于 `ast` 模块的依赖提取（Python 优先，其他语言计划支持）
- 自定义 Linter 规则库（可扩展）
- CI 门禁：违反约束则阻断
- 违规信息自动注入 Agent 上下文（让 Agent 自我修复）

```python
# flowforge/harness/constraints/arch_constraint_engine.py

import ast
import yaml

class ArchitectureConstraintEngine:
    """架构约束引擎：分层依赖 + Linter 规则 + CI 门禁"""

    LAYER_ORDER = ["Types", "Config", "Repo", "Service", "Runtime", "UI"]

    def __init__(self, layer_config_path: str = "config/layer_mapping.yaml"):
        self.layer_mapping = self._load_layer_mapping(layer_config_path)

    def _load_layer_mapping(self, path: str) -> dict:
        with open(path) as f:
            return yaml.safe_load(f)["layers"]

    def _extract_dependencies(self, output: 'AgentOutput') -> list:
        """使用 Python ast 模块解析 import 语句，提取依赖关系"""
        code = str(output.result.get("content", output.result.get("code", "")))
        deps = []
        try:
            tree = ast.parse(code)
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        deps.append({"from": output.result.get("source_module", "unknown"),
                                     "to": alias.name, "type": "import"})
                elif isinstance(node, ast.ImportFrom):
                    if node.module:
                        deps.append({"from": output.result.get("source_module", "unknown"),
                                     "to": node.module, "type": "from_import"})
        except SyntaxError:
            pass
        return deps

    def _resolve_layer(self, module_name: str) -> str:
        """将模块名解析为架构层"""
        for layer, patterns in self.layer_mapping.items():
            for pattern in patterns:
                if pattern in module_name:
                    return layer
        return "unknown"

    def check_dependency_direction(self, from_module: str, to_module: str) -> bool:
        from_layer = self._resolve_layer(from_module)
        to_layer = self._resolve_layer(to_module)
        if from_layer == "unknown" or to_layer == "unknown":
            return True
        try:
            return self.LAYER_ORDER.index(from_layer) < self.LAYER_ORDER.index(to_layer)
        except ValueError:
            return True

    async def validate_agent_output(self, output: 'AgentOutput', ctx: 'TaskContext') -> list:
        """验证 Agent 输出是否符合架构约束"""
        violations = []
        for dep in self._extract_dependencies(output):
            if not self.check_dependency_direction(dep["from"], dep["to"]):
                violations.append({
                    "rule": "layer_dependency",
                    "violation": f"反向依赖: {dep['from']} → {dep['to']}",
                    "fix": f"遵循分层依赖: {' → '.join(self.LAYER_ORDER)}",
                })
        if violations:
            ctx.event_bus.emit(ctx.task_id, "constraint.violation", {"violations": violations})
        return violations
```

配套配置文件 `config/layer_mapping.yaml`：

```yaml
layers:
  Types: ["models", "schemas", "types", "interfaces"]
  Config: ["config", "settings", "env"]
  Repo: ["repository", "database", "db"]
  Service: ["service", "usecase", "domain"]
  Runtime: ["runner", "executor", "engine"]
  UI: ["ui", "components", "pages"]
```

### 7.4 反馈循环（Feedback Loop）

**核心问题**：Agent 不知道自己做错了；自评总是偏高。

**定位**：FeedbackLoop 是**全局护栏**（外环），与 Reflexion 模式（内环）形成**串行关系**——Reflexion 内环先跑完，然后交给 FeedbackLoop 外环做终审。如果外环 FAIL，不再回到内环，而是直接降级（返回最佳结果 + 质量警告）。

```
┌─────────────────────────────────────────────┐
│            外环：FeedbackLoop（全局护栏）     │
│   所有模式输出都经过四维评分 + 分类闸门      │
│   ┌─────────────────────────────────────┐   │
│   │  内环：Reflexion 模式               │   │
│   │  Actor → Evaluator → Reflector      │   │
│   │  （快速循环，模式内部使用）          │   │
│   └─────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

**evaluation_mode 三档配置**：

| 模式 | LLM 调用次数 | 适用场景 |
|------|-------------|---------|
| `full` | 2 次（四维评分 + 分类闸门） | 需要深度质量评估 |
| `lightweight`（默认） | 1 次（仅分类闸门） | 日常运行 |
| `skip` | 0 次 | 跳过外环（内环 Reflexion 仍生效） |

```python
# flowforge/harness/feedback/feedback_loop.py

class FeedbackLoop:
    """反馈循环引擎：生成与评判分离 + 四维评分 + 分类闸门"""

    MAX_REFLEXION_ITERATIONS = 3
    QUALITY_THRESHOLD = 0.8

    def __init__(self, evaluator_agent, classifier_model, verification_hooks):
        self.evaluator = evaluator_agent
        self.classifier = classifier_model
        self.hooks = verification_hooks

    async def evaluate_agent_output(self, output: dict, ctx: 'TaskContext',
                                     evaluation_mode: str = "lightweight") -> dict:
        """四维评分体系 + 独立评判 Agent"""
        # 1. 后台分类器：只看工具执行结果，忽略模型生成文本
        artifacts = self._extract_execution_artifacts(ctx)
        classifier_verdict = await self.classifier.evaluate(artifacts)

        evaluation = {}
        scores = {}
        overall = 0.0

        # 2. 独立评判 Agent（full 模式）
        if evaluation_mode == "full":
            evaluation = await self.evaluator.evaluate(output, ctx)
            scores = {
                "design_quality": evaluation.get("design_score", 0),
                "originality": evaluation.get("originality_score", 0),
                "craft": evaluation.get("craft_score", 0),
                "functionality": evaluation.get("functionality_score", 0),
            }
            overall = sum(scores.values()) / 4

        # 3. 分类闸门判定
        verdict = "PASS"
        if evaluation_mode == "full":
            verdict = "PASS" if overall >= self.QUALITY_THRESHOLD else "FAIL"
        elif evaluation_mode == "lightweight":
            verdict = "PASS" if classifier_verdict == "complete" else "FAIL"

        return {
            "scores": scores,
            "overall": overall,
            "verdict": verdict,
            "classifier_verdict": classifier_verdict,
            "issues": evaluation.get("issues", []),
        }
```

### 7.5 熵管理（Entropy Management）

**核心问题**：技术债务越积越多；文档与代码不一致。

**定位**：内置核心能力，NOT 插件。文档园丁、技术债跟踪器、规则进化器直接在 `harness/entropy/` 中实现。

**核心能力**：
- **文档园丁 (DocGardener)**：后台每天凌晨扫描文档-代码不一致，自动提交修复 PR
- **技术债跟踪器 (DebtTracker)**：优先级排序 + 持续小额偿还（每周扫描）
- **规则进化器 (RuleEvolution)**：每次 Agent 失败转化为一条工程规则

```python
# flowforge/harness/entropy/entropy_manager.py

class EntropyManager:
    """熵管理引擎：技术债回收 + 文档园丁 + 持续小额偿还"""

    def __init__(self, knowledge_base, llm_client, scheduler):
        self.kb = knowledge_base
        self.llm = llm_client
        self.scheduler = scheduler
        self.debt_tracker = DebtTracker()

    async def start_garden_agents(self):
        """启动后台园丁 Agent"""
        self.scheduler.add_job(self._doc_gardener_scan, trigger="cron", hour=2, id="doc_gardener")
        self.scheduler.add_job(self._debt_collection, trigger="cron", day_of_week="mon", hour=3, id="debt_collector")

    async def capture_failure_to_rule(self, failure: dict, ctx: 'TaskContext') -> str:
        """将失败转化为规则（Hashimoto 核心方法论）"""
        rule = await self.llm.chat([{
            "role": "user",
            "content": f"将以下 Agent 失败案例转化为一条简洁的工程规则:\n{failure}"
        }])
        rule_text = rule.get("content", "")
        await self.kb.store("rules", f"auto_rule_{int(time.time())}", rule_text)
        self.debt_tracker.add_item({"description": rule_text, "source": "agent_failure", "priority": "high"})
        return rule_text
```

### 7.6 权限管线（Permission Pipeline）

**核心问题**：Agent 可能执行危险操作；Prompt 不是安全边界。

**三层管线**：deny → ask → allow（deny 永远胜出）

**四级动作分级**：

| 动作级别 | 含义 | 默认处理 |
|---------|------|---------|
| `read` | 只读操作 | auto_approved |
| `suggest` | 生成建议 | prompt_user |
| `prepare` | 生成 PR/变更计划 | prompt_user |
| `execute` | 执行部署/改配置/删除 | require_approval |

```python
# flowforge/security/permission_pipeline.py

class PermissionPipeline:
    """三层权限管线：deny → ask → allow"""

    RULE_ORDER = ["deny", "ask", "allow"]  # deny 永远胜出

    def __init__(self, rules_registry: dict, classifier=None, event_bus=None):
        self.rules = rules_registry
        self.classifier = classifier
        self.event_bus = event_bus

    async def evaluate(self, tool_name: str, params: dict, context: 'TaskContext') -> str:
        """评估工具调用权限：deny > ask > allow"""
        action_level = self._classify_action(tool_name, params)
        for tier in self.RULE_ORDER:
            rules = self.rules.get(tool_name, {}).get(tier, [])
            for rule in rules:
                if rule.matches(tool_name, params, context):
                    if tier == "deny":
                        return "deny"
                    elif tier == "ask":
                        if action_level in ("read", "suggest") and self.classifier:
                            decision = await self.classifier.evaluate(context, tool_name, params)
                            if decision == "approved":
                                continue
                        approved = await context.request_user_approval(tool_name, params)
                        if not approved:
                            return "deny"
                    elif tier == "allow":
                        return "allow"
        return "allow"
```

### 7.7 HarnessOrchestrator — 统一入口

Harness 层的入口为 `harness/__init__.py`（非 `control_loop.py`，后者已删除），暴露 `HarnessOrchestrator` 类，封装四根护栏的初始化和 Hook 调用：

```python
# flowforge/harness/__init__.py

class HarnessOrchestrator:
    """Harness 驾驭层统一入口"""

    def __init__(self, config):
        self.context = ContextEngine(...)
        self.constraints = ArchitectureConstraintEngine(...)
        self.feedback = FeedbackLoop(...)
        self.entropy = EntropyManager(...)

    async def pre_execute(self, ctx: 'TaskContext'):
        """执行前：上下文注入 + 熵管理轻量检查"""
        await self.context.inject_dynamic_context(ctx.input_data, ctx.persona or "default")
        await self.entropy.check_debt(ctx)

    async def post_execute(self, result: dict, ctx: 'TaskContext') -> dict:
        """执行后：架构约束验证 + 反馈评估"""
        violations = await self.constraints.validate_agent_output(result, ctx)
        if not violations:
            evaluation = await self.feedback.evaluate_agent_output(
                result, ctx, evaluation_mode=ctx.metadata.get("evaluation_mode", "lightweight"))
            if evaluation["verdict"] == "FAIL":
                result["_quality_warning"] = evaluation
        return result
```

`HybridExecutor` 中调用 2 个统一入口：

```python
# HybridExecutor.run()
if ctx.harness_enabled and self.harness:
    await self.harness.pre_execute(ctx)

result = await agent.execute_with_context(input, ctx)

if ctx.harness_enabled and self.harness:
    result = await self.harness.post_execute(result, ctx)
```

---

## 8. Skill 系统架构

> ★ v6.0 新增——跨格式兼容 + 双层加载 + 组合技

### 8.1 SkillAdapter 模式

通过适配器模式实现 4 种主流 Skill 格式的统一接入：

| 格式 | 适配器 | 特性支持 |
|------|--------|---------|
| **FlowForge** | `FlowForgeAdapter` | 完整 YAML + Markdown，含 triggers/input_schema/output_schema/constraints |
| **Claude Code** | `ClaudeCodeAdapter` | YAML frontmatter（name/description）+ Markdown body |
| **Anthropic** | `AnthropicAdapter` | YAML frontmatter + Markdown body |
| **Trae CN** | `TraeCNAdapter` | YAML frontmatter + triggers（中文触发词）+ Markdown body |

```python
# flowforge/skills/adapters/base.py

class SkillAdapter(ABC):
    """Skill 格式适配器基类"""
    format: SkillFormat

    @abstractmethod
    def can_parse(self, raw_content: str) -> bool: ...

    @abstractmethod
    def parse(self, raw_content: str) -> Skill: ...

    @abstractmethod
    def serialize(self, skill: Skill) -> str: ...
```

### 8.2 SkillRegistry — 双层加载

```python
# flowforge/skills/registry.py

class SkillRegistry:
    """Skill 注册中心：双层加载 + 格式自动检测 + 置信度评分"""

    def __init__(self, global_dir: str = "~/.flowforge/skills",
                 project_dir: str = "./.flowforge/skills"):
        self.global_dir = Path(global_dir).expanduser()
        self.project_dir = Path(project_dir)
        self._skills: Dict[str, Skill] = {}
        self._usage_stats: Dict[str, dict] = {}
        self._load_all()

    def _load_all(self):
        """加载全部 Skill：全局 + 项目（项目覆盖全局同名 Skill）"""
        if self.global_dir.exists():
            for skill_dir in self.global_dir.iterdir():
                if skill_dir.is_dir():
                    skill = self._load_skill_from_dir(skill_dir)
                    if skill:
                        self._skills[skill.name] = skill
        if self.project_dir.exists():
            for skill_dir in self.project_dir.iterdir():
                if skill_dir.is_dir() or skill_dir.is_symlink():
                    skill = self._load_skill_from_dir(skill_dir)
                    if skill:
                        self._skills[skill.name] = skill

    def match_skill(self, query: str, context: 'TaskContext' = None) -> List[tuple]:
        """匹配 Skill，返回 (Skill, confidence) 列表，按置信度降序"""
        scored = []
        query_lower = query.lower()
        for skill in self._skills.values():
            score = 0
            for trigger in skill.triggers:
                if trigger.lower() in query_lower:
                    score += len(trigger) / 10  # 触发词越长，匹配越精确
            if context:
                for tool_name in skill.required_tools:
                    if tool_name in context.state.get("recent_tool_calls", []):
                        score += 0.5
                if context.interaction_mode == "helm":
                    score *= 1.2
            if score > 0:
                scored.append((skill, score))
        scored.sort(key=lambda x: x[1], reverse=True)
        return scored
```

### 8.3 Combo Skills — 组合技

参考 Trae CN 的 Skill 组合实践，支持声明式定义多 Skill 串联管道：

```yaml
# skills/combos/book-to-article.yaml
name: book-to-article
description: 读书写作一条龙：提取精华→下载封面→生成书评
version: 1.0.0
combo:
  pipeline:
    - skill: book-essence-extractor
      output_key: essence
    - skill: image-downloader
      output_key: cover_image
      depends_on: [essence]
    - skill: article-outline
      input:
        topic: "{{essence.title}}"
        image: "{{cover_image.url}}"
      output_key: article
```

### 8.4 Skill 目录结构

```
skills/
├── weekly-report/
│   ├── SKILL.md              # 核心定义（必需）
│   ├── skill.yaml             # 运行时配置（可选）
│   ├── references/            # 参考文档（按需加载）
│   ├── scripts/               # 辅助脚本
│   └── examples/              # 示例输入输出
├── book-essence-extractor/
│   └── SKILL.md
└── combos/
    └── book-to-article.yaml
```

---

## 9. MCP 模块架构

> ★ v6.0 新增——四层架构 + 熔断重试 + 流式支持

### 9.1 四层架构

```
┌─────────────────────────────────────────────────────────────┐
│  L1: MCP Client（协议层）                                     │
│  · JSON-RPC 2.0 客户端                                       │
│  · tools/list / tools/call / resources/read                   │
│  · 动态工具发现 + 延迟加载（5分钟 TTL 缓存）                   │
├─────────────────────────────────────────────────────────────┤
│  L2: MCP Gateway（治理层）                                    │
│  · 工具白名单 (Allow-List)                                    │
│  · Token 预算管理（25K 默认上限）                              │
│  · 速率限制（60次/分钟默认）                                   │
│  · 权限管线集成                                               │
├─────────────────────────────────────────────────────────────┤
│  L3: MCP Broker（代理层）                                     │
│  · 多服务器聚合 (Server Aggregation)                          │
│  · tool_name → server_name 索引（非遍历）                     │
│  · 熔断（5次连续失败触发）+ 重试（3次，指数退避）              │
├─────────────────────────────────────────────────────────────┤
│  L4: MCP Tool Adapter（适配层）                               │
│  · MCP Tool → FlowForge BaseTool 转换                        │
│  · 自动 Schema 生成                                          │
│  · 流式支持 (execute_stream)                                  │
└─────────────────────────────────────────────────────────────┘
```

### 9.2 MCPBroker — 索引优化

```python
# flowforge/mcp/broker.py

class MCPBroker:
    """MCP 代理：多服务器聚合 + 索引路由 + 熔断/重试"""

    MAX_RETRIES = 3
    CIRCUIT_BREAKER_THRESHOLD = 5

    def __init__(self):
        self._clients: Dict[str, MCPClient] = {}
        self._tool_index: Dict[str, str] = {}  # tool_name → server_name
        self._failure_counts: Dict[str, int] = {}
        self._circuit_open: Dict[str, bool] = {}

    async def register_server(self, name: str, client: MCPClient):
        self._clients[name] = client
        self._failure_counts[name] = 0
        self._circuit_open[name] = False
        # 后台异步构建索引，不阻塞初始化
        asyncio.create_task(self._rebuild_index_for_server(name, client))

    async def call_tool(self, tool_name: str, arguments: dict,
                        server: str = None) -> Dict:
        if server:
            return await self._call_with_retry(server, tool_name, arguments)
        # 直接查索引，无需遍历所有服务器
        server_name = self._tool_index.get(tool_name)
        if server_name:
            return await self._call_with_retry(server_name, tool_name, arguments)
        # 索引未命中时，降级到遍历搜索（并更新索引）
        for name, client in self._clients.items():
            tools = await client.list_tools()
            for tool in tools:
                self._tool_index[tool["name"]] = name
                if tool["name"] == tool_name:
                    return await self._call_with_retry(name, tool_name, arguments)
        return {"error": f"Tool '{tool_name}' not found in any MCP server"}
```

### 9.3 MCPGateway — 流式支持

```python
# flowforge/mcp/gateway.py

class MCPGateway:
    """MCP 网关：权限 + Token 预算 + 速率限制 + 流式支持"""

    async def execute_tool(self, mcp_client, tool_name, arguments, context) -> Dict:
        """非流式执行"""
        permission = await self.permission.evaluate(f"mcp:{tool_name}", arguments, context)
        if permission == "deny":
            return {"error": f"MCP tool '{tool_name}' blocked"}
        if not self._check_rate_limit(tool_name):
            return {"error": f"Rate limit exceeded for '{tool_name}'"}
        result = await mcp_client.call_tool(tool_name, arguments)
        # 输出 Token 截断
        output_text = json.dumps(result, ensure_ascii=False)
        if count_tokens(output_text) > self.MAX_TOOL_OUTPUT_TOKENS:
            result = self._truncate_output(result, self.MAX_TOOL_OUTPUT_TOKENS)
            result["_truncated"] = True
        return result

    async def execute_tool_stream(self, mcp_client, tool_name, arguments, context):
        """流式执行"""
        permission = await self.permission.evaluate(f"mcp:{tool_name}", arguments, context)
        if permission == "deny":
            yield {"error": f"MCP tool '{tool_name}' blocked"}
            return
        async for chunk in mcp_client.call_tool_stream(tool_name, arguments):
            yield chunk
```

### 9.4 MCPToolAdapter — BaseTool 适配

```python
# flowforge/mcp/tool_adapter.py

class MCPToolAdapter(BaseTool):
    """将 MCP 工具适配为 FlowForge BaseTool"""

    def __init__(self, mcp_client: MCPClient, tool_schema: dict, gateway=None):
        self.name = f"mcp_{tool_schema['name']}"
        self.description = tool_schema.get("description", "")
        self.parameters_schema = tool_schema.get("inputSchema", {})
        self._client = mcp_client
        self._gateway = gateway
        self._tool_name = tool_schema["name"]

    async def execute(self, input: ToolInput) -> ToolOutput:
        if self._gateway:
            result = await self._gateway.execute_tool(
                self._client, self._tool_name, input.params, None)
        else:
            result = await self._client.call_tool(self._tool_name, input.params)
        return ToolOutput(result=result)

    async def execute_stream(self, input: ToolInput):
        """流式执行 MCP 工具"""
        if self._gateway:
            async for chunk in self._gateway.execute_tool_stream(
                self._client, self._tool_name, input.params, None):
                yield chunk
        else:
            async for chunk in self._client.call_tool_stream(self._tool_name, input.params):
                yield chunk
```

---

## 10. 重量级模块详细设计

### 10.1 Agent 模式执行器

#### 10.1.1 ReAct 执行器

```python
class ReActExecutor(BaseModeExecutor):
    mode_name = "react"
    MAX_STEPS = 8
    LOOP_THRESHOLD = 3

    async def _execute_core(self, ctx: TaskContext) -> dict:
        observation = ctx.input_data.get("task", "")
        action_history = []
        for step in range(self.MAX_STEPS):
            thought = await self._generate_thought(ctx, observation, action_history)
            ctx.event_bus.emit("react.thought", {"step": step, "thought": thought})
            action = await self._parse_action(ctx, thought)
            if action is None: break
            if self._is_loop(action_history, action):
                ctx.event_bus.emit("react.loop_detected", {"step": step})
                break
            action_history.append(action)
            observation = await self._execute_action(ctx, action)
        return {"final_answer": observation, "steps": step + 1}
```

#### 10.1.2 Reflexion 执行器

```python
class ReflexionExecutor(BaseModeExecutor):
    mode_name = "reflexion"
    MAX_ITERATIONS = 4
    QUALITY_THRESHOLD = 0.85

    async def _execute_core(self, ctx: TaskContext) -> dict:
        memory, best_result, best_score = [], None, 0.0
        for iteration in range(self.MAX_ITERATIONS):
            actor = ctx.agents.get("reflexion_actor") or DefaultLLMActor()
            output = await actor.execute(AgentInput(params={"task": ctx.input_data["task"], "memory": memory}))
            evaluator = ctx.agents.get("reflexion_evaluator") or DefaultLLMEvaluator()
            eval_result = await evaluator.execute(AgentInput(params={"output": output.result}))
            score = eval_result.result["score"]
            if score > best_score: best_result, best_score = output.result, score
            if score >= self.QUALITY_THRESHOLD: break
            reflector = ctx.agents.get("reflexion_reflector") or DefaultLLMReflector()
            reflection = await reflector.execute(AgentInput(params={"output": output.result, "issues": eval_result.result["issues"]}))
            memory.append(reflection.result)
        return {"result": best_result, "score": best_score, "iterations": iteration + 1}
```

#### 10.1.3 Workflow 执行器 (含安全机制)

```python
class WorkflowExecutor(BaseModeExecutor):
    mode_name = "workflow"
    MAX_DEPTH = 3

    async def _execute_core(self, ctx: TaskContext) -> dict:
        sop_steps = ctx.metadata.get("sop_steps", [])
        depth = ctx.metadata.get("_workflow_depth", 0)
        if depth >= self.MAX_DEPTH: raise WorkflowRecursionError()
        for step in sop_steps:
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
        return context_data
```

### 10.2 三层防御架构

| 防御层 | 位置 | 机制 | 默认值 |
|--------|------|------|--------|
| **L1 超时** | `ToolRegistry.execute()` | 单次工具调用超时 | 120s |
| **L2 重复检测** | `BaseModeExecutor._on_exit()` | hash-based 重复检测钩子 | threshold=3 |
| **L3 自修正** | `WorkflowExecutor._handle_step_error()` | `on_error: "reflexion_retry"` 策略 | retry_count=2 |

### 10.3 Multi-Agent 三策略架构

| 维度 | Subagents | Agent Teams | Swarms |
|------|-----------|-------------|--------|
| **状态** | 无状态，完全隔离 | 共享 TaskBoard | 去中心化，各自认领 |
| **通信** | 无（结果压缩返回） | Mailbox 信箱 | Mailbox + 心跳 |
| **协调** | 无（并行执行） | Lead Agent 协调 | SwarmCoordinator 监控 |
| **适用场景** | 独立子任务并行 | 多角色协作 | 大规模分布式任务 |
| **容错** | 单任务失败不影响其他 | Lead 可重新规划 | 心跳检测 + 自动重发布 |

### 10.4 Tool 注册与协议支持

| 方式 | 适用场景 |
|------|---------|
| **代码注册** | 自定义 Tool |
| **YAML 配置** | 内置 Tool |
| **MCP 协议** | 外部 Tool 服务（四层架构） |
| **OpenAPI 规范** | REST API 自动转换 |
| **GraphQL** | GraphQL API 自动转换 |
| **Python 入口点** | 第三方插件 |

### 10.5 Memory 模块

| 记忆类型 | 存储后端 | Phase 1 支持 |
|---------|---------|-------------|
| **工作记忆** | Python dict / TaskContext.state | ✅ |
| **短期记忆** | SQLite + TTL | ✅ |
| **长期记忆** | SQLite/PostgreSQL | ✅ |
| **语义记忆** | Qdrant/Milvus | ❌ Phase 3+ |
| **情景记忆** | SQLite | ✅ |

### 10.6 Helm 模式与 EventBus

17 种 FlowForge 事件 → 16 种 Helm 事件类型全映射，WebSocket 专用通道 `/ws/helm/{task_id}`，支持断线重连和事件回放。

#### 10.6.1 Plan 模式架构

Plan 模式是 Helm 交互的核心增强，允许用户在执行前审查并确认 Agent 的执行计划。

**核心流程**：Plan 确认后内部转换为临时 Workflow YAML，委托 WorkflowExecutor 执行。

```
用户输入 → LLM 生成 Plan → 用户确认 → 转换为临时 Workflow YAML → WorkflowExecutor 执行 → 结果
              ↑                                    ↓
         ContextEngine 注入              PermissionPipeline prepare 级别
```

**Harness 集成策略**：

| 阶段 | Harness 组件 | 行为 |
|------|-------------|------|
| Plan 生成 | ContextEngine | 注入上下文（规则 + 历史教训 + 交接物） |
| Plan 确认 | PermissionPipeline | prepare 级别审批（生成变更计划，需用户确认） |
| 步骤执行 | Harness 正常 + FeedbackLoop | 每步 lightweight FeedbackLoop |
| Plan 完成 | FeedbackLoop | full FeedbackLoop 终审 |

**Plan → Workflow YAML 转换规则**：

```yaml
# Plan 输出示例
plan_id: "plan-abc123"
steps:
  - name: "搜索相关资料"
    agent: "researcher"
    mode: "rewoo"
  - name: "撰写初稿"
    agent: "writer"
    mode: "reflexion"
  - name: "审核发布"
    agent: "publisher"
    mode: "plan_execute"

# 自动转换为临时 Workflow YAML
steps:
  - name: "搜索相关资料"
    agent: "researcher"
    mode: "rewoo"
    output: "step_0_result"
  - name: "撰写初稿"
    agent: "writer"
    mode: "reflexion"
    output: "step_1_result"
  - name: "审核发布"
    agent: "publisher"
    mode: "plan_execute"
    output: "step_2_result"
```

#### 10.6.2 FileChangeTracker 架构

FileChangeTracker 是 Helm 模式下的文件变更追踪组件，为前端 DiffViewer 提供实时变更数据。

**组件位置**：`tools/file_change_tracker.py`

**核心机制**：拦截 `file_rw` 和 `workspace_file` 工具的 write 操作，在写入前后捕获文件快照，通过 EventBus 发射变更事件。

```
Agent 调用 file_rw.write(path, content)
    ↓
FileChangeTracker.capture_before(path)  →  记录原始内容 + hash
    ↓
file_rw.write(path, content)  →  实际写入
    ↓
FileChangeTracker.capture_after(path)   →  记录新内容 + hash
    ↓
EventBus.emit("file.changed", {path, before_hash, after_hash, diff})
    ↓
HelmAdapter 桥接 → 前端 DiffViewer
```

**关键设计**：

| 参数 | 值 | 说明 |
|------|---|------|
| `MAX_FILE_SIZE` | 500KB | 超过此阈值的文件跳过追踪，避免内存溢出 |
| 拦截范围 | `file_rw`, `workspace_file` | 仅拦截文件写入类工具 |
| 事件类型 | `file.changed` | 映射为 Helm 事件 `helm.file.changed` |
| Diff 格式 | unified diff | 标准化 diff 输出，前端可直接渲染 |

```python
# flowforge/tools/file_change_tracker.py

class FileChangeTracker:
    """文件变更追踪器：拦截写入操作，捕获前后快照，发射变更事件"""

    MAX_FILE_SIZE = 500 * 1024  # 500KB

    def __init__(self, event_bus: EventBus):
        self.event_bus = event_bus
        self._snapshots: Dict[str, dict] = {}  # path → {content, hash}

    async def capture_before(self, path: str) -> Optional[str]:
        """写入前捕获：记录原始内容和 hash"""
        if not os.path.exists(path):
            self._snapshots[path] = {"content": None, "hash": None}
            return None
        if os.path.getsize(path) > self.MAX_FILE_SIZE:
            return None  # 超大文件跳过追踪
        content = open(path, "r", encoding="utf-8").read()
        self._snapshots[path] = {
            "content": content,
            "hash": hashlib.sha256(content.encode()).hexdigest()[:16],
        }
        return content

    async def capture_after(self, path: str, task_id: str) -> Optional[dict]:
        """写入后捕获：对比差异，发射事件"""
        before = self._snapshots.pop(path, {"content": None, "hash": None})
        if os.path.getsize(path) > self.MAX_FILE_SIZE:
            return None
        after_content = open(path, "r", encoding="utf-8").read()
        after_hash = hashlib.sha256(after_content.encode()).hexdigest()[:16]
        if before["hash"] == after_hash:
            return None  # 无实际变更
        diff = unified_diff(
            (before["content"] or "").splitlines(),
            after_content.splitlines(),
            lineterm=[""],
        )
        change_event = {
            "path": path,
            "before_hash": before["hash"],
            "after_hash": after_hash,
            "diff": "\n".join(diff),
        }
        self.event_bus.emit(task_id, "file.changed", change_event)
        return change_event
```

**HelmAdapter 桥接**：HelmAdapter 监听 `file.changed` 事件，转换为前端 DiffViewer 可消费的 WebSocket 消息格式，包含语法高亮元信息。

#### 10.6.3 HelmDatabase 架构

Helm 模式使用独立的 SQLite 数据库 `data/helm.db`，与 `task_board.db` 完全隔离。

**设计原则**：独立存储、自动迁移、轻量 CRUD。

**数据库表结构**：

```sql
-- plans 表：存储 Plan 模式的执行计划
CREATE TABLE IF NOT EXISTS plans (
    plan_id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    steps TEXT NOT NULL,           -- JSON: [{name, agent, mode, output}]
    status TEXT DEFAULT 'pending', -- pending / confirmed / executing / completed / failed
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    confirmed_at TIMESTAMP,
    completed_at TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(task_id)
);

-- attachments 表：存储用户上传的附件元信息
CREATE TABLE IF NOT EXISTS attachments (
    attachment_id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    original_name TEXT NOT NULL,
    stored_path TEXT NOT NULL,     -- UUID 重命名后的存储路径
    mime_type TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(task_id)
);
```

**HelmDatabase 类**：

```python
# flowforge/helm/database.py

class HelmDatabase:
    """Helm 模式独立数据库：自动迁移 + CRUD"""

    def __init__(self, db_path: str = "data/helm.db"):
        self.db_path = db_path
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        self._conn: Optional[aiosqlite.Connection] = None

    async def initialize(self):
        """自动迁移：检查并创建表结构"""
        self._conn = await aiosqlite.connect(self.db_path)
        await self._conn.executescript(SCHEMA_SQL)
        await self._conn.commit()

    # Plans CRUD
    async def create_plan(self, plan_id: str, task_id: str, steps: list) -> dict: ...
    async def get_plan(self, plan_id: str) -> Optional[dict]: ...
    async def confirm_plan(self, plan_id: str) -> dict: ...
    async def update_plan_status(self, plan_id: str, status: str) -> dict: ...
    async def list_plans_by_task(self, task_id: str) -> list: ...

    # Attachments CRUD
    async def create_attachment(self, task_id: str, original_name: str,
                                 stored_path: str, mime_type: str,
                                 file_size: int) -> dict: ...
    async def get_attachment(self, attachment_id: str) -> Optional[dict]: ...
    async def list_attachments_by_task(self, task_id: str) -> list: ...
    async def delete_attachment(self, attachment_id: str) -> bool: ...
```

**FastAPI lifespan 初始化**：

```python
# 在 FastAPI 应用 lifespan 中初始化 HelmDatabase
@asynccontextmanager
async def lifespan(app: FastAPI):
    helm_db = HelmDatabase("data/helm.db")
    await helm_db.initialize()
    app.state.helm_db = helm_db
    yield
    await helm_db.close()
```

#### 10.6.4 UploadValidator 架构

UploadValidator 是 Helm 模式下用户文件上传的安全校验组件。

**组件位置**：`tools/upload_validator.py`

**核心能力**：

| 校验维度 | 机制 | 说明 |
|---------|------|------|
| MIME 类型 | 白名单校验 | 仅允许安全类型（image/*, text/*, application/pdf 等） |
| 扩展名 | 白名单校验 | 与 MIME 类型双重验证，防止伪装 |
| 文件名 | UUID 重命名 | 消除路径穿越风险，原始名存数据库 |
| 路径穿越 | 防护检查 | `os.path.realpath()` 验证最终路径在允许目录内 |
| 速率限制 | 10 文件/分钟/任务 | 防止滥用上传 |

```python
# flowforge/tools/upload_validator.py

class UploadValidator:
    """上传校验器：MIME + 扩展名双重白名单 + UUID 重命名 + 速率限制"""

    ALLOWED_MIME_TYPES = {
        "image/jpeg", "image/png", "image/gif", "image/webp",
        "text/plain", "text/markdown", "text/csv",
        "application/pdf", "application/json",
    }
    ALLOWED_EXTENSIONS = {
        ".jpg", ".jpeg", ".png", ".gif", ".webp",
        ".txt", ".md", ".csv",
        ".pdf", ".json",
    }
    MAX_UPLOAD_RATE = 10  # 10 文件/分钟/任务

    def __init__(self, upload_dir: str = "data/uploads"):
        self.upload_dir = os.path.realpath(upload_dir)
        os.makedirs(self.upload_dir, exist_ok=True)
        self._rate_tracker: Dict[str, list] = {}  # task_id → [timestamps]

    async def validate_and_store(self, task_id: str, filename: str,
                                  content: bytes, mime_type: str) -> dict:
        """校验 + 存储：返回 {attachment_id, stored_path, original_name}"""
        # 1. 速率限制检查
        if not self._check_rate_limit(task_id):
            raise ValueError(f"上传速率超限：每任务每分钟最多 {self.MAX_UPLOAD_RATE} 个文件")

        # 2. MIME + 扩展名双重白名单
        ext = os.path.splitext(filename)[1].lower()
        if mime_type not in self.ALLOWED_MIME_TYPES:
            raise ValueError(f"不允许的 MIME 类型: {mime_type}")
        if ext not in self.ALLOWED_EXTENSIONS:
            raise ValueError(f"不允许的文件扩展名: {ext}")

        # 3. UUID 重命名存储
        attachment_id = str(uuid.uuid4())
        stored_name = f"{attachment_id}{ext}"
        stored_path = os.path.join(self.upload_dir, stored_name)

        # 4. 路径穿越防护
        real_path = os.path.realpath(stored_path)
        if not real_path.startswith(self.upload_dir):
            raise ValueError("检测到路径穿越攻击")

        with open(real_path, "wb") as f:
            f.write(content)

        return {
            "attachment_id": attachment_id,
            "stored_path": real_path,
            "original_name": filename,
            "mime_type": mime_type,
            "file_size": len(content),
        }

    def _check_rate_limit(self, task_id: str) -> bool:
        """速率限制：10 文件/分钟/任务"""
        now = time.time()
        timestamps = self._rate_tracker.get(task_id, [])
        # 清理 60 秒前的记录
        timestamps = [t for t in timestamps if now - t < 60]
        if len(timestamps) >= self.MAX_UPLOAD_RATE:
            return False
        timestamps.append(now)
        self._rate_tracker[task_id] = timestamps
        return True
```

#### 10.6.5 EventBus 事件映射（新增）

在原有 17 种 FlowForge 事件 → 16 种 Helm 事件映射基础上，新增以下映射：

| FlowForge 内部事件 | Helm WebSocket 事件 | 说明 |
|-------------------|---------------------|------|
| `plan.step.start` | `helm.plan.step.start` | Plan 步骤开始执行 |
| `plan.step.complete` | `helm.plan.step.complete` | Plan 步骤执行完成 |
| `plan.step.error` | `helm.plan.step.error` | Plan 步骤执行出错 |
| `file.changed` | `helm.file.changed` | 文件内容变更（FileChangeTracker 触发） |

**完整 Helm 事件映射表（含新增）**：

```
FlowForge 内部事件          →  Helm WebSocket 事件
─────────────────────────────────────────────────
task.start                  →  helm.task.start
task.complete               →  helm.task.complete
task.error                  →  helm.task.error
task.paused                 →  helm.task.paused
task.resumed                →  helm.task.resumed
mode.enter                  →  helm.mode.enter
mode.exit                   →  helm.mode.exit
agent.start                 →  helm.agent.start
agent.end                   →  helm.agent.end
tool.start                  →  helm.tool.start
tool.end                    →  helm.tool.end
llm.start                   →  helm.llm.start
llm.reasoning               →  helm.llm.reasoning
llm.stream                  →  helm.llm.stream
llm.end                     →  helm.llm.end
draft.update                →  helm.draft.update
step.intermediate           →  helm.step.intermediate
review.ready                →  helm.review.ready
review.submitted            →  helm.review.submitted
token.stats                 →  helm.token.stats
plan.step.start    ★ 新增   →  helm.plan.step.start
plan.step.complete ★ 新增   →  helm.plan.step.complete
plan.step.error    ★ 新增   →  helm.plan.step.error
file.changed       ★ 新增   →  helm.file.changed
```

#### 10.6.6 前端状态管理架构

Helm 模式前端采用 React Context + useReducer 实现状态管理，零外部依赖，轻量高效。

**设计原则**：零依赖（不引入 Redux / Zustand 等第三方状态库），使用 React 原生 Context + useReducer 模式。

**三大 Context**：

| Context | 职责 | 核心状态 |
|---------|------|---------|
| `PlanContext` | Plan 模式状态管理 | plan_id / steps / current_step / status / is_plan_step |
| `AttachmentContext` | 附件上传状态管理 | attachments / upload_status / error |
| `DiffContext` | 文件变更 Diff 视图状态 | changes / selected_file / diff_content / loading |

**HelmContextProvider 组合 Provider**：

```tsx
// web/src/contexts/HelmContextProvider.tsx

function HelmContextProvider({ children }: { children: React.ReactNode }) {
  return (
    <PlanContext.Provider value={planReducer}>
      <AttachmentContext.Provider value={attachmentReducer}>
        <DiffContext.Provider value={diffReducer}>
          {children}
        </DiffContext.Provider>
      </AttachmentContext.Provider>
    </PlanContext.Provider>
  );
}
```

**PlanContext 状态模型**：

```typescript
// web/src/contexts/PlanContext.tsx

interface PlanState {
  planId: string | null;
  steps: PlanStep[];
  currentStepIndex: number;
  status: 'idle' | 'generating' | 'pending' | 'confirmed' | 'executing' | 'completed' | 'failed';
  isPlanStep: boolean;
}

interface PlanStep {
  name: string;
  agent: string;
  mode: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  result?: any;
}

type PlanAction =
  | { type: 'PLAN_GENERATED'; payload: { planId: string; steps: PlanStep[] } }
  | { type: 'PLAN_CONFIRMED' }
  | { type: 'STEP_START'; payload: { stepIndex: number } }
  | { type: 'STEP_COMPLETE'; payload: { stepIndex: number; result: any } }
  | { type: 'STEP_ERROR'; payload: { stepIndex: number; error: string } }
  | { type: 'PLAN_COMPLETED' }
  | { type: 'RESET' };
```

**AttachmentContext 状态模型**：

```typescript
// web/src/contexts/AttachmentContext.tsx

interface AttachmentState {
  attachments: Attachment[];
  uploadStatus: 'idle' | 'uploading' | 'success' | 'error';
  error: string | null;
}

interface Attachment {
  attachmentId: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  uploadedAt: string;
}
```

**DiffContext 状态模型**：

```typescript
// web/src/contexts/DiffContext.tsx

interface DiffState {
  changes: FileChange[];
  selectedFile: string | null;
  diffContent: string | null;
  loading: boolean;
}

interface FileChange {
  path: string;
  beforeHash: string | null;
  afterHash: string;
  timestamp: string;
}
```

**WebSocket 事件 → Context Action 映射**：

| WebSocket 事件 | Context | Action |
|---------------|---------|--------|
| `helm.plan.step.start` | PlanContext | `STEP_START` |
| `helm.plan.step.complete` | PlanContext | `STEP_COMPLETE` |
| `helm.plan.step.error` | PlanContext | `STEP_ERROR` |
| `helm.file.changed` | DiffContext | `ADD_CHANGE` |

---

## 11. 事件系统与可观测性

### 11.1 EventBus 事件类型

- `task.start`, `task.complete`, `task.error`, `task.paused`, `task.resumed`
- `mode.enter`, `mode.exit`
- `agent.start`, `agent.end`
- `tool.start`, `tool.end`
- `llm.start`, `llm.reasoning`, `llm.stream`, `llm.end`
- `draft.update`, `step.intermediate`
- `review.ready`, `review.submitted`
- `token.stats`

### 11.2 可观测性模块

- **分布式追踪**：基于 OpenTelemetry，每个任务生成唯一 `trace_id`
- **Prometheus 指标**：
  - `flowforge_tasks_total{mode, status}`
  - `flowforge_execution_duration_seconds`
  - `flowforge_token_usage_total{model, provider}`
  - `flowforge_tool_calls_total{tool_name, status}`
  - `flowforge_persona_running{persona}`
- **审计日志**：所有 Agent、Tool 调用均记录在 audit_logs 表中，含 trace_id、耗时、敏感信息脱敏
- **WebSocket 实时推送**：通用事件通道 `/ws/events`，Helm 专用通道 `/ws/helm/{task_id}`

### 11.3 检查点与恢复

`CheckpointManager` 提供增量保存 + 版本号 + 恢复到执行上下文 + 旧版本清理。默认使用 SQLite 存储，可替换为 Redis。

---

## 12. 安全机制

### 12.1 三层权限管线

deny → ask → allow 三层管线（deny 永远胜出），四级动作分级（Read / Suggest / Prepare / Execute）。

### 12.2 Persona 锁

同一 persona 同一时间只允许一个任务运行，通过 `HybridExecutor._running_tasks` 管理，`ConflictError` (HTTP 409) 处理冲突。

### 12.3 Human-in-the-Loop

Workflow 模式原生支持 `human: true` 节点，通过 LangGraph `interrupt_before` 实现暂停，通过 `HybridExecutor.submit_review()` 恢复执行。

### 12.4 沙箱执行

对代码执行类 Tool 实施进程级隔离 + 资源限制 + 跨平台兼容（Linux/Windows）+ 文件系统路径穿越防护。

### 12.5 并发安全

TaskBoard 原子认领（RETURNING 子句 + 应用层锁），非并发安全工具自动加锁（asyncio.Lock）。

---

## 13. 配置化与启动

### 13.1 harness_v6.yaml 配置示例

```yaml
flowforge:
  version: "6.0"
  mode: "harness"  # harness | framework

harness:
  enabled: true  # ★ 灰度开关

  context_engineering:
    enabled: true
    agents_md_path: "config/AGENTS.md"
    dynamic_injection: true
    handoff_enabled: true

  architecture_constraints:
    enabled: true
    layer_model: ["Types", "Config", "Repo", "Service", "Runtime", "UI"]
    linter_rules_path: "config/linter_rules.yaml"
    layer_mapping_path: "config/layer_mapping.yaml"
    ci_gate: "fail_on_violation"

  feedback_loop:
    enabled: true
    evaluation_mode: "lightweight"  # full | lightweight | skip
    evaluator_model: "sonnet-4.6"
    scoring_dimensions: [design_quality, originality, craft, functionality]
    pass_threshold: 0.8
    max_reflexion_iterations: 3

  permission_pipeline:
    enabled: true
    tiers: [deny, ask, allow]
    action_levels:
      read: auto_approved
      suggest: prompt_user
      prepare: prompt_user
      execute: require_approval

  session_management:
    compaction_threshold: 0.92
    max_tool_output_tokens: 25000
    handoff_enabled: true
    checkpoint_interval: 300

  entropy_management:
    enabled: true
    doc_gardener_schedule: "0 2 * * *"
    debt_collection_schedule: "weekly"
    capture_failures_to_rules: true

modes:
  - name: reflexion; enabled: true
  - name: rewoo; enabled: true

agents:
  - name: writer; module: my_agents.writer; default_mode: reflexion

tools:
  - name: openai; provider: openrouter; api_key: "${OPENROUTER_API_KEY}"
  - name: search; provider: tavily; api_key: "${TAVILY_API_KEY}"

skills:
  enabled: true
  global_dir: "~/.flowforge/skills"
  project_dir: "./.flowforge/skills"
  auto_discover: true
  allow_external_formats: [claude_code, anthropic, trae_cn]
  combo_enabled: true

mcp:
  enabled: true
  servers:
    - name: "filesystem"
      transport: "stdio"
      command: "npx"
      args: ["-y", "@anthropic/mcp-server-filesystem", "/tmp"]
  gateway:
    max_tool_output_tokens: 25000
    default_rate_limit: 60
  broker:
    max_retries: 3
    circuit_breaker_threshold: 5

# ★ Helm 模式配置
helm:
  enabled: true
  database_path: "data/helm.db"
  upload_dir: "data/uploads"
  upload_validator:
    max_file_size: 10485760  # 10MB
    max_upload_rate: 10      # 10 文件/分钟/任务
  file_change_tracker:
    max_file_size: 512000    # 500KB
    tracked_tools: ["file_rw", "workspace_file"]

# ★ Plan 模式配置
plan:
  enabled: true
  prompt_template: "config/prompts.yaml"  # Plan 生成 Prompt 模板路径
  auto_confirm: false                     # 是否自动确认（生产环境必须为 false）
  max_steps: 10                           # Plan 最大步骤数
```

### 13.1.1 Plan 生成 Prompt 外置

Plan 生成使用的 Prompt 模板外置于 `config/prompts.yaml`，支持热更新和版本管理。

**设计原则**：Prompt 与代码分离，修改 Prompt 无需重新部署。

**模板结构**：

```yaml
# config/prompts.yaml

prompts:
  plan_generation:
    description: "Plan 模式的执行计划生成 Prompt"
    template: |
      你是一个任务规划专家。请根据用户需求，生成一个分步执行计划。

      ## 可用 Agent
      {{available_agents}}

      ## 可用工具
      {{available_tools}}

      ## 上下文信息
      {{context}}

      ## 用户需求
      {{task}}

      ## 输出要求
      请以 YAML 格式输出执行计划，包含以下字段：
      - plan_id: 唯一标识
      - steps: 步骤列表，每个步骤包含 name/agent/mode 字段

      示例格式：
      ```yaml
      plan_id: "plan-xxx"
      steps:
        - name: "步骤名称"
          agent: "agent名称"
          mode: "执行模式"
      ```
    variables:
      - name: available_agents
        description: "当前注册的所有 Agent 列表及其能力描述"
        required: true
      - name: available_tools
        description: "当前注册的所有工具列表及其功能描述"
        required: true
      - name: context
        description: "ContextEngine 注入的上下文信息（规则、历史教训、交接物）"
        required: false
      - name: task
        description: "用户的原始任务描述"
        required: true
```

**变量注入机制**：

| 变量 | 来源 | 注入时机 |
|------|------|---------|
| `available_agents` | AgentRegistry | Plan 生成前自动填充 |
| `available_tools` | ToolRegistry | Plan 生成前自动填充 |
| `context` | ContextEngine | Plan 生成时注入（规则 + 历史教训 + 交接物） |
| `task` | 用户输入 | Plan 生成时传入 |

### 13.2 编程式启动

```python
from flowforge.v6 import FlowForgeV6

forge = FlowForgeV6.from_config("config/harness_v6.yaml")

# Harness 组件自动初始化
forge.harness.context_engine      # ContextEngine
forge.harness.constraints         # ArchitectureConstraintEngine
forge.harness.feedback            # FeedbackLoop
forge.harness.entropy             # EntropyManager

# 启动后台园丁 Agent
forge.harness.entropy.start_garden_agents()

# 执行任务（Harness 层自动介入）
result = await forge.run(
    task_id="task-001",
    persona="education",
    input_data={"topic": "武汉中考政策分析"},
    mode="workflow",
    interaction_mode="standard",
)
```

---

## 14. 增量迁移策略

### Step 1：新增 harness/ 目录，灰度开关控制（风险最低）

| 操作 | 说明 |
|------|------|
| 新增 `harness/` 目录及 4 个子目录（context/ constraints/ feedback/ entropy/） | 14 个全新文件，不修改任何现有代码 |
| 在 `config/harness_v6.yaml` 中增加 `enabled: true/false` 开关 | 支持灰度启用 Harness 层 |
| 在 `HybridExecutor.run()` 中增加 2 个 Hook 点 | `pre_execute` / `post_execute` |
| 编写集成测试 | 验证 Harness 禁用时系统行为与 v5.0 完全一致 |

### Step 2：重组 tools/agents，保持 import 兼容（风险中等）

| 操作 | 说明 |
|------|------|
| `tools/` 内部拆分为 `builtin/` / `adapters/` / `publish/` | 在原目录内创建子目录 |
| `agents/` 内部拆分为 `content/` / `novel/` / `code/` | 同上 |
| 通过 `__init__.py` re-export 保持旧 import 路径 | 兼容期 = 1 个大版本周期（v7.0 才删除旧路径） |
| 旧 import 路径触发时输出 `DeprecationWarning` | 而非静默 re-export |

### Step 3：迁移 executor/ → engine/，引入 security/ 和 observability/（风险最高）

| 操作 | 说明 |
|------|------|
| `executor/` → `engine/`，同时引入 `defense_layer.py` | 完全替换 |
| `core/agent_registry.py` → `engine/agent_registry.py` | core/ 只保留纯接口 |
| 新增 `security/` 和 `observability/` | 全新目录 |
| 删除旧路径 | 全量回归测试 |

---

## 15. v5.0 → v6.0 迁移映射表

| v5.0 模块 | v6.0 模块 | 迁移策略 |
|-----------|----------|---------|
| `SecureToolRegistry` | `PermissionPipeline` | **增强**：增加 deny/ask/allow 三层管线 + 动作分级 |
| `ContextCompressor` | `SessionManager` | **替换**：增加 92% 阈值触发 + 会话交接 + 检查点 |
| `AuditAgent` | `FeedbackLoop` | **替换**：独立评判 Agent + 四维评分 + 分类闸门（全局护栏） |
| `MultiAgentExecutor._run_subagents()` | `SubAgentEngine` | **增强**：独立上下文窗口 + 令牌预算 + 交接物（仅替换 _run_subagents 内部实现） |
| `WorkflowExecutor` | `ArchitectureConstraintEngine` | **新增**：Linter 规则 + 分层依赖检查 |
| (新增) | `EntropyManager` | **新增**：文档园丁 + 技术债回收 + 规则进化（内置核心能力） |
| (新增) | `ContextEngine` | **新增**：AGENTS.md 按需注入 + 失败转规则 |
| (新增) | `SkillRegistry` | **新增**：4 种格式适配 + 双层加载 + 组合技 |
| (新增) | `MCPBroker` | **新增**：4 层架构 + 索引路由 + 熔断重试 |
| `core/agent_registry.py` | `engine/agent_registry.py` | **移动**：core/ 只保留纯接口 |
| `plugins/skills_loader.py` | (删除) | **删除**：Skill 加载统一走 `skills/registry.py` |
| `harness/control_loop.py` | (删除) | **删除**：由 `harness/__init__.py` 的 `HarnessOrchestrator` 替代 |

---

## 16. 开源与社区

- **许可证**：MIT
- **文档**：MkDocs + Material 主题
- **示例仓库**：`flowforge-examples`
- **插件机制**：Python 标准入口点 (`flowforge.tools`, `flowforge.modes`, `flowforge.agents`)
- **版本管理**：v1.0~v3.0 已归档至 `docs/archive/`，v4.0~v5.0 已合并入 v6.0

---

## 17. v7.0 新增核心模块

> ★ v7.0 新增——SDK 统一入口 + 零配置模型访问 + 安全护栏 + Agent 委托 + 声明式 Agent + 插件市场

### 17.1 新增模块总览

| 模块 | 位置 | 职责 |
|------|------|------|
| **ModelCapabilityProvider** | `core/model_capability.py` | 零配置模型访问单例，上层项目无需关心 provider/model 配置即可调用 LLM |
| **@tool 装饰器** | `core/tool_decorator.py` | 简化工具注册，5 行代码创建工具并自动生成 Schema |
| **FlowForgeSDK** | `sdk.py` | 统一入口，上层项目只需 `from flowforge.sdk import FlowForgeSDK` 即可获得全部能力 |
| **Guardrails** | `core/guardrails.py` | 并行安全检查，支持 InputGuardrail/OutputGuardrail，结果为 PASS/WARN/BLOCK/MODIFY |
| **Agent Handoff** | `core/handoff.py` | LLM 驱动的 Agent 间任务委托，HandoffManager 管理委托路由与上下文传递 |
| **MCP Integration** | `core/mcp_integration.py` | Model Context Protocol 服务器集成，一键连接 MCP 服务器并自动注册工具 |
| **Declarative Agent** | `core/declarative_agent.py` | 无继承、纯配置的 Agent 定义，支持 model/tools/instructions/handoffs/guardrails 声明 |
| **Marketplace** | `core/marketplace.py` | 插件市场，支持一键安装/卸载/搜索插件 |

### 17.2 更新后的扩展性架构

```
┌─────────────────────────────────────────────┐
│           应用层（Gateway / API）              │
│  REST API + WebSocket + Marketplace API       │
├─────────────────────────────────────────────┤
│           编排层（Brain / SOP）                │
│  Guardrails(并行) + Handoff(委托) + SOP       │
├─────────────────────────────────────────────┤
│           Agent 层（Workers）                  │
│  Declarative Agent + BaseAgent + Handoff      │
├─────────────────────────────────────────────┤
│           工具层（Tools）                      │
│  @tool装饰器 + MCP Server + BaseTool          │
├─────────────────────────────────────────────┤
│           共享内核（Core）                      │
│  SDK / ModelCapability / Guardrails /         │
│  Handoff / Marketplace / Config / Tracing     │
└─────────────────────────────────────────────┘
```

### 17.3 FlowForgeSDK 统一入口

FlowForgeSDK 是上层项目与 FlowForge 交互的**唯一入口**，提供懒初始化的属性访问和装饰器注册：

```python
from flowforge.sdk import FlowForgeSDK

sdk = FlowForgeSDK()

# 零配置模型访问
result = await sdk.llm.chat("Write something")

# @tool 装饰器注册工具
@sdk.tool(name="my_tool", description="My custom tool")
async def my_tool(query: str) -> dict:
    return {"result": query}

# @agent 装饰器注册 Agent
@sdk.agent(name="my_agent", description="My custom agent")
async def my_agent(task: str) -> dict:
    return {"output": task}

# 声明式 Agent（无继承、纯配置）
@sdk.declarative_agent(
    name="writer",
    description="Content writer",
    model="DeepSeek-V4-Pro",
    tools=["web_search"],
    instructions="You are a professional writer.",
    handoffs=["reviewer"],
)
async def write(task: str, style: str = "professional") -> str:
    ...

# 安全护栏
@sdk.input_guardrail(name="content_safety")
class ContentSafetyGuardrail(InputGuardrail):
    async def check(self, input_text: str, context: dict) -> GuardrailResult:
        ...

# MCP 服务器连接
await sdk.mcp.connect_server(
    name="filesystem",
    command="npx",
    args=["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
)

# 事件订阅
@sdk.on_event("task.completed")
async def on_task_completed(event):
    print(f"Task completed: {event}")
```

### 17.4 ModelCapabilityProvider — 零配置模型访问

`ModelCapability` 是一个单例，上层项目无需配置 provider/model 即可直接调用 LLM：

```python
from flowforge.sdk import FlowForgeSDK

sdk = FlowForgeSDK()
result = await sdk.llm.chat("你好")  # 自动路由到可用模型
```

核心特性：
- **零配置**：自动读取 `models.yaml` 中的 provider 和 model 配置
- **智能路由**：根据健康检查结果自动选择可用模型
- **降级容错**：主模型不可用时自动切换到 fallback 模型
- **上层项目无需关心**：ContentForge/DevForge/NovelForge/MallForge 直接通过 `sdk.llm` 访问

### 17.5 Guardrails — 并行安全检查

Guardrails 在 Agent 执行前后并行运行安全检查，支持四种结果：

| 结果 | 行为 |
|------|------|
| `passed` | 允许继续执行 |
| `warned` | 记录警告但允许继续 |
| `blocked` | 立即停止执行 |
| `modified` | 转换输入/输出后继续 |

```python
# InputGuardrail — 执行前检查
class ContentSafetyGuardrail(InputGuardrail):
    name = "content_safety"
    async def check(self, input_text: str, context: dict) -> GuardrailResult:
        if any(word in input_text for word in BANNED_WORDS):
            return GuardrailResult(status="blocked", message="Contains banned content")
        return GuardrailResult(status="passed")

# OutputGuardrail — 执行后检查
class QualityGuardrail(OutputGuardrail):
    name = "quality_check"
    async def check(self, output_text: str, context: dict) -> GuardrailResult:
        if len(output_text) < 100:
            return GuardrailResult(status="warned", message="Output too short")
        return GuardrailResult(status="passed")
```

### 17.6 Agent Handoff — LLM 驱动的任务委托

Agent Handoff 允许 Agent 将任务委托给其他专业 Agent，由 LLM 决定何时委托：

```python
from flowforge.core.handoff import Handoff, HandoffManager

handoffs = [
    Handoff(target="topic_agent", condition="research and topic selection"),
    Handoff(target="writing_agent", condition="article writing and editing"),
]

hm = HandoffManager(agent_registry=agent_registry)
hm.register_handoffs("coordinator_agent", handoffs)

# 执行委托
result = await hm.execute_handoff(
    source_agent="coordinator_agent",
    target_agent="topic_agent",
    task="Research trending AI topics",
    context={"persona": "tech"}
)
```

### 17.7 MCP Integration — 一键连接 MCP 服务器

MCPIntegration 简化了 MCP 服务器的连接流程，自动将 MCP 工具注册为 FlowForge BaseTool：

```python
sdk = FlowForgeSDK()
await sdk.mcp.connect_server(
    name="filesystem",
    command="npx",
    args=["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
)
# MCP 工具自动注册到 sdk.tools
```

### 17.8 Declarative Agent — 纯配置 Agent 定义

Declarative Agent 无需继承 BaseAgent，通过装饰器声明 model/tools/instructions/handoffs/guardrails 即可创建：

```python
@sdk.declarative_agent(
    name="writer",
    description="Content writer",
    model="DeepSeek-V4-Pro",
    tools=["web_search"],
    instructions="You are a professional writer.",
    handoffs=["reviewer"],
    guardrails=["content_safety"],
)
async def write(task: str, style: str = "professional") -> str:
    ...  # 留空则使用默认 LLM 执行
```

### 17.9 Marketplace — 插件市场

Marketplace 提供插件的发现、安装、卸载能力：

- **搜索**：按关键词/标签搜索可用插件
- **安装**：一键安装插件到项目
- **卸载**：一键移除已安装插件
- **版本管理**：支持插件版本检查和更新

---

**以上为 FlowForge 架构设计文档 v6.0 + v7.0 增量。** v7.0 在 v6.0 基础上新增了 FlowForgeSDK 统一入口、ModelCapabilityProvider 零配置模型访问、@tool 装饰器、Guardrails 并行安全检查、Agent Handoff 任务委托、MCP Integration 一键连接、Declarative Agent 纯配置定义、Marketplace 插件市场等 8 个核心模块，为上层项目提供更简洁、更安全的集成体验。
