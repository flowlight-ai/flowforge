# FlowForge v6.0 架构设计

> **定位**：从 Agent 编排框架进化为 **Agent 驾驭层 (Harness Layer)**——为 AI Agent 提供约束、反馈、上下文管理与熵控制的完整控制论系统。
> **哲学**：让架构成为配置，让扩展成为插件，让 Harness 负责约束、验证和进化。
> **关系声明**：FlowForge 是独立开源项目（MIT），ContentForge 是其应用层参考实现。
> **版本说明**：本文档合并 v4.0（九大模式 + 通用 Agent/Workflow 库）与 v5.0（三层防御 + 协作增强），新增 v6.0 Harness 驾驭层、Skill 系统、MCP 模块，并应用三轮评审的全部修复。历史版本已归档至 docs/archive/。

---

## 1. 项目概述与设计目标

FlowForge 是一个解耦了业务逻辑的通用 Agent 操作系统内核，封装了业界主流的 9 种 Agent 架构模式，提供统一的工具注册、状态管理、可观测性接口，并通过 **Harness 驾驭层**（上下文工程、架构约束、反馈循环、熵管理、Loop Engine）为 Agent 提供完整的控制回路，让开发者通过声明式配置（YAML/JSON）即可组合出可控、可观测、可进化的智能体工作流。

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
│     上下文工程 | 架构约束 | 反馈循环 | 熵管理 | Loop Engine | 权限管线 | 会话管理  │
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
│  │                         五大组件 (五大引擎)                            │   │
│  │                                                                       │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │   │
│  │  │ 上下文工程   │  │ 架构约束    │  │ 反馈循环    │  │ 熵管理      │  │   │
│  │  │ ContextEngine│  │ ArchCons-   │  │ FeedbackLoop│  │ EntropyMgr │  │   │
│  │  │             │  │ traintEngine│  │             │  │             │  │   │
│  │  │ · AGENTS.md │  │ · 分层依赖  │  │ · 独立评判  │  │ · 文档园丁  │  │   │
│  │  │ · 会话交接  │  │ · Linter   │  │ · 四维评分  │  │ · 技术债回收│  │   │
│  │  │ · 按需注入  │  │ · CI阻断   │  │ · 自修正    │  │ · 规则进化  │  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │   │
│  │                                                                       │   │
│  │  ┌──────────────────────────────────────────────────────────────────┐│   │
│  │  │ Loop Engine (v6.1 新增)                                          ││   │
│  │  │ Planner → Worker → Verifier → Reflector → Memory                ││   │
│  │  │ 规划→执行→校验→复盘的自主迭代闭环，包装 HybridExecutor          ││   │
│  │  └──────────────────────────────────────────────────────────────────┘│   │
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

1. **Harness 驾驭层五大组件**：上下文工程、架构约束、反馈循环、熵管理、Loop Engine——为 Agent 提供完整控制回路，这是其他框架不具备的。
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

        # ★ v6.1 注意：LoopExecutor 包装本方法，在 run() 外层添加迭代闭环。
        # LoopExecutor.run() 每次迭代调用 HybridExecutor.run()，并附加
        # Loop Verifier（业务级校验）和 Reflector（失败复盘）。
        # 详见 docs/loop.md

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
    """反馈循环引擎：生成与评判分离 + 四维评分 + 分类闸门

    四维评分维度（与代码实现一致）：
    - correctness: 事实准确性与逻辑合理性
    - completeness: 需求覆盖的完整性
    - coherence: 内部一致性与连贯性
    - safety: 安全合规性
    """

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
                "correctness": evaluation.get("correctness_score", 0),
                "completeness": evaluation.get("completeness_score", 0),
                "coherence": evaluation.get("coherence_score", 0),
                "safety": evaluation.get("safety_score", 0),
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

### 7.6 Loop Engine（自主迭代闭环）

> ★ v6.1 新增——Harness 驾驭层第五大组件

**核心定位**：Loop Engine 是 Harness 驾驭层的第五大组件，提供**规划→执行→校验→复盘**的自主迭代闭环，让 Agent 从"听令行事"进化为"自主干活"。

**核心概念**：LoopExecutor **包装** HybridExecutor，不替代。每次迭代通过 HybridExecutor 执行任务，Loop Engine 负责迭代控制与质量把关。

**五层子模块**：

| 子模块 | 职责 |
|--------|------|
| **Planner** | 拆解任务、分配工具、制定步骤 |
| **Worker** | 调用 HybridExecutor 执行（复用现有引擎） |
| **Verifier** | 业务级质量校验（与 Harness FeedbackLoop 互补） |
| **Reflector** | 失败时生成改进建议，驱动 EntropyManager 规则进化 |
| **Memory** | LoopState 独立持久化，不污染 TaskContext |

**关键原则**：Loop Verifier（业务级校验）与 Harness FeedbackLoop（架构级校验）**互补而非重复**。FeedbackLoop 负责格式、安全、合规等架构级质量闸门，Loop Verifier 负责内容质量、完整性、准确性等业务级校验，两者在不同阶段独立运行。

**完整设计详见**：`docs/loop.md`

### 7.7 权限管线（Permission Pipeline）

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

### 7.8 HarnessOrchestrator — 统一入口

Harness 层的入口为 `harness/__init__.py`（非 `control_loop.py`，后者已删除），暴露 `HarnessOrchestrator` 类，封装五大组件的初始化和 Hook 调用：

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
    scoring_dimensions: [correctness, completeness, coherence, safety]
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
---

# [审核修订 v2.1] 六方联合审核修订增补

> 审核日期：2026-06-15 | 修订版本：v2.1

## 18. 审核修订：架构修复 [审核修订 v2.1]

### 18.1 GAP-C01修复：删除FlowForge反向import

flowforge/core/flowforge.py 第17-28行存在反向import ContentForge工具（ToutiaoPublisherTool等），严重违反P9契约原则。

**修复方案**：
- 删除 flowforge.py 中的反向import
- ToutiaoPublisherTool / WeChatPublisherTool / PexelsImageTool 通过 ContentForgePlugin 的 register_tools() 钩子注册
- 在 hiclaw/prompts.md P9 契约验证中显式添加此检查项

### 18.2 Plugin协议扩展

当前 FlowForgePlugin 协议仅提供4个钩子，不足以表达 *Forge 的业务复杂度。

**扩展后协议**：

```python
class FlowForgePlugin(Protocol):
    # 现有
    def register_agents(self, registry): ...
    def register_tools(self, registry): ...
    def register_routes(self, app): ...
    def register_event_handlers(self, bus): ...
    # [审核修订 v2.1] 新增
    def register_workflows(self, compiler): ...      # DevForge 4种workflow
    def register_gates(self, gate_registry): ...      # DevForge DCP/TR门禁
    def register_evaluators(self, registry): ...      # DevForge 8个Evaluator
    def register_sops(self, compiler): ...            # ContentForge 4种SOP
    def register_quality_gates(self, registry): ...   # NovelForge 6道质量门
    def register_context_layers(self, manager): ...   # NovelForge 5层上下文
    def register_workflow_step_handler(self, registry): ...  # 自定义StepType
```

### 18.3 ConfigVersion数据结构

```python
@dataclass
class ConfigVersion:
    config_type: str  # "workflow" / "agent" / "persona" / "prompt"
    config_name: str
    version: str
    checksum: str  # SHA256
    loaded_at: datetime
```

启动时检测配置变更，变更后优雅重启（graceful restart）。

### 18.4 TurnKind与LoopPhase合并

TurnKind（6状态）与 LoopPhase（7状态）合并为统一状态机：

| 统一状态 | 原LoopPhase | 原TurnKind | 说明 |
|---------|-----------|-----------|------|
| IDLE | PENDING | - | 等待启动 |
| EXECUTING | RUNNING | CONTINUE | 正在执行 |
| EVALUATING | - | REBUILD_PREPARED | 评估结果 |
| REFLECTING | REFLECTING | - | 反思修正 |
| COMPACTING | - | OVERFLOW_COMPACTION | 上下文压缩 |
| AGENT_SWITCHING | - | AGENT_SWITCH | Agent切换 |
| COMPLETED | COMPLETED | COMPLETED | 成功完成 |
| FAILED | FAILED | FAILED | 失败终止 |
| LOOPING | LOOPING | - | 循环中 |

**decide() 简化**：只接收 verdict + LoopContext（封装7个参数）

**max_steps优先级高于max_retries**（OpenCode安全护栏）

### 18.5 CAP-01 Source<A>代数简化

Phase 2先用简单实现：

```python
# 简化版：Dict[str, ContextFragment]
@dataclass
class ContextFragment:
    key: str
    content: str
    priority: int = 0  # 0=最低, 数字越大优先级越高

# ContextEngine.inject() 中按priority排序后拼接
```

Phase 3再引入代数操作（reconcile/replace/map）。

### 18.6 关键数据结构Pydantic化

以下数据结构必须改为 Pydantic BaseModel：
- LLMRequest（当前是 @dataclass）
- SessionEvent.data（当前是 Dict[str, Any] 黑盒）
- CompiledStep.metadata（当前是 Dict[str, Any]）
- GateVerdict（新增Pydantic模型）

### 18.7 Persona注入规范化

- Persona指令使用结构化格式（非自然语言段落），限定 ≤512 token
- 增加 Persona注入成本审计：每个prompt构建完成后打印persona token占比（<15%为健康）
- 中文格式规范注入：标点/编号/日期/单位统一指令段

### 18.8 FWK-01 MVP接口冻结

```python
# MVP必须支持
class WorkflowCompiler:
    def compile(self, yaml_dict: Dict) -> CompiledWorkflow: ...
    def to_sop_steps(self, workflow: CompiledWorkflow) -> List[Dict]: ...

# MVP StepType: SEQUENCE + CONDITIONAL + GATE
# MVP 变量引用: ${{outputs.xxx}}
# MVP 验收用例: dev_hotfix.yaml 能跑通
```

### 18.9 Doubao moderation作为统一内容安全层

- FlowForge INF-08 十层安全防御中L5内容安全层用Doubao moderation实现
- NovelForge/ContentForge章节发布前强制走moderation预检
- DevForge代码门禁中对coder生成的代码做moderation + 沙箱执行双重校验
- moderation的风险标签存入EventStream，方便后续合规审计

---

# [审核修订 v2.2] 六方联合审核修订增补（v2.1未覆盖项）

> 审核日期：2026-06-16 | 修订版本：v2.2 | 来源：6份专家审核意见并集，v2.1未覆盖部分

## 修订19：FWK-01 WorkflowExecutor运行时扩展方案 [来源：审核FWK-01]

### 19.1 问题
`to_sop_steps()` 只做格式转换（YAML → CompiledStep列表），WorkflowExecutor对条件路由/并行组/回退链的运行时调度能力需明确。

### 19.2 WorkflowExecutor职责边界

```python
class WorkflowExecutor:
    """Workflow运行时执行器 — 负责调度逻辑，非格式转换"""

    async def execute(self, workflow: CompiledWorkflow, context: TaskContext) -> WorkflowResult:
        """执行编译后的Workflow，处理运行时调度"""
        current_step = workflow.entry_step
        step_results: Dict[str, StepResult] = {}

        while current_step:
            step = workflow.steps[current_step]

            # 1. 条件路由：运行时评估条件表达式
            if step.step_type == StepType.CONDITIONAL:
                branch = self._evaluate_condition(step.condition, context, step_results)
                current_step = step.branches[branch]
                continue

            # 2. 并行组：运行时调度并行执行
            if step.step_type == StepType.PARALLEL:
                results = await self._execute_parallel(step, context)
                step_results[current_step] = StepResult(merged=results)
                current_step = step.next_step
                continue

            # 3. 回退链：运行时错误处理与回退
            if step.step_type == StepType.FALLBACK:
                result = await self._execute_with_fallback(step, context)
                step_results[current_step] = result
                current_step = step.next_step
                continue

            # 4. 循环：运行时循环控制
            if step.step_type == StepType.LOOP:
                result = await self._execute_loop(step, context, step_results)
                step_results[current_step] = result
                current_step = step.next_step
                continue

            # 5. 普通步骤：顺序执行
            result = await self._execute_step(step, context)
            step_results[current_step] = result
            current_step = step.next_step

        return WorkflowResult(step_results=step_results, context=context)
```

### 19.3 条件路由运行时评估

```python
def _evaluate_condition(
    self,
    condition: str,
    context: TaskContext,
    step_results: Dict[str, StepResult],
) -> str:
    """运行时评估条件表达式，返回分支名"""
    # 安全表达式求值（asteval）
    from asteval import Interpreter
    aeval = Interpreter()

    # 注入变量
    aeval.symtable["state"] = context.state
    aeval.symtable["params"] = context.params
    aeval.symtable["outputs"] = {
        k: v.data for k, v in step_results.items()
    }

    result = aeval(condition)
    if aeval.error:
        raise WorkflowConditionError(
            f"条件表达式求值失败: {condition}, 错误: {aeval.error[0].get_error()}"
        )
    return str(result)
```

### 19.4 并行组运行时调度

```python
async def _execute_parallel(
    self, step: CompiledStep, context: TaskContext
) -> Dict[str, StepResult]:
    """并行执行多个子步骤，收集所有结果"""
    import asyncio
    tasks = []
    for sub_step_id in step.parallel_steps:
        sub_step = step.sub_steps[sub_step_id]
        tasks.append(self._execute_step(sub_step, context))

    results = await asyncio.gather(*tasks, return_exceptions=True)

    parallel_results = {}
    for sub_step_id, result in zip(step.parallel_steps, results):
        if isinstance(result, Exception):
            if step.fail_fast:
                raise result
            parallel_results[sub_step_id] = StepResult(error=str(result))
        else:
            parallel_results[sub_step_id] = result

    return parallel_results
```

### 19.5 回退链运行时处理

```python
async def _execute_with_fallback(
    self, step: CompiledStep, context: TaskContext
) -> StepResult:
    """带回退链的步骤执行"""
    last_error = None

    for attempt, provider_step in enumerate(step.fallback_chain):
        try:
            result = await self._execute_step(provider_step, context)
            if attempt > 0:
                result.metadata["fallback_index"] = attempt
            return result
        except Exception as e:
            last_error = e
            logger.warning(
                f"回退链第{attempt}步失败: {provider_step.agent_id}, 错误: {e}"
            )
            continue

    raise WorkflowFallbackExhaustedError(
        f"回退链全部失败，最后错误: {last_error}"
    )
```

## 修订20：FWK-06 MAX_STEPS兼容性分析 [来源：审核FWK-06]

### 20.1 问题
`max_steps` 是 breaking change — 现有代码使用 `max_retries` 控制循环次数，引入 `max_steps` 后语义不同（max_steps=总步骤数 vs max_retries=重试次数），需兼容性分析。

### 20.2 语义差异

| 参数 | 语义 | 作用域 | 默认值 |
|------|------|--------|--------|
| `max_retries` | 单步最大重试次数 | 单个Step | 3 |
| `max_steps` | 整个Workflow/Loop最大步骤数 | 整个Workflow | 50 |

### 20.3 兼容性策略

```python
@dataclass
class LoopConfig:
    """循环配置 — 兼容max_retries和max_steps"""
    max_steps: int = 50          # 新参数：总步骤上限（安全护栏）
    max_retries: int = 3         # 旧参数：单步重试次数（向后兼容）
    max_retries_per_step: int = 3  # 明确语义：每步最大重试

    # 兼容性：max_steps优先级高于max_retries
    # 旧代码只设max_retries → 自动推算max_steps = max_retries * step_count * 2
    # 新代码显式设max_steps → 使用新值

    def __post_init__(self):
        if self.max_steps <= 0:
            raise ValueError("max_steps必须>0")
        if self.max_retries <= 0:
            raise ValueError("max_retries必须>0")
```

### 20.4 迁移路径

```python
# 旧代码（仅max_retries）
config = LoopConfig(max_retries=5)
# 自动推算：max_steps = 5 * estimated_steps * 2 = 50

# 新代码（显式max_steps）
config = LoopConfig(max_steps=30, max_retries_per_step=3)

# 过渡期：两者都设
config = LoopConfig(max_steps=30, max_retries=5)
# max_steps=30生效，max_retries仅作为max_retries_per_step的别名
```

### 20.5 Deprecation计划

| 版本 | 行为 |
|------|------|
| v1.1 | `max_retries`仍可用，打印DeprecationWarning |
| v1.2 | `max_retries`映射到`max_retries_per_step`，仍可用 |
| v2.0 | 移除`max_retries`，仅保留`max_steps` + `max_retries_per_step` |

## 修订21：CAP-14 Harness护栏全面集成设计 [来源：审核CAP-14]

### 21.1 问题
ArchitectureConstraintEngine / EntropyManager 代码与设计不完全一致，需要代码对齐方案。

### 21.2 ArchitectureConstraintEngine对齐

```python
class ArchitectureConstraintEngine:
    """架构约束引擎 — 代码与设计对齐"""

    def __init__(self, config: ConstraintConfig):
        self.constraints: Dict[str, Constraint] = {}
        self.violation_log: List[ConstraintViolation] = []
        self._load_constraints(config)

    def _load_constraints(self, config: ConstraintConfig):
        """从配置加载约束规则"""
        for rule in config.rules:
            self.constraints[rule.id] = Constraint(
                id=rule.id,
                pattern=rule.pattern,       # 模块路径匹配模式
                direction=rule.direction,   # "deny_import" / "require_interface"
                message=rule.message,
                severity=rule.severity,     # "error" / "warning"
            )

    async def check(self, module_path: str, import_path: str) -> ConstraintResult:
        """检查一次import是否违反架构约束"""
        for constraint_id, constraint in self.constraints.items():
            if constraint.matches(module_path, import_path):
                violation = ConstraintViolation(
                    constraint_id=constraint_id,
                    source=module_path,
                    target=import_path,
                    severity=constraint.severity,
                    message=constraint.message,
                )
                self.violation_log.append(violation)
                if constraint.severity == "error":
                    return ConstraintResult(passed=False, violations=[violation])
        return ConstraintResult(passed=True, violations=[])

@dataclass
class Constraint:
    id: str
    pattern: str          # 如 "workers.*" → "brain.*" (workers禁止导入brain)
    direction: str        # "deny_import" / "require_interface"
    message: str
    severity: str         # "error" / "warning"

    def matches(self, source: str, target: str) -> bool:
        """检查source→target是否匹配约束模式"""
        import fnmatch
        source_match = fnmatch.fnmatch(source, self.pattern.split("→")[0].strip())
        target_match = fnmatch.fnmatch(target, self.pattern.split("→")[1].strip())
        return source_match and target_match
```

### 21.3 EntropyManager对齐

```python
class EntropyManager:
    """熵管理器 — 检测和控制系统复杂度增长"""

    def __init__(self, config: EntropyConfig):
        self.thresholds = config.thresholds
        self.metrics: Dict[str, float] = {}
        self.history: List[EntropySnapshot] = []

    async def measure(self, codebase_path: str) -> EntropyReport:
        """测量代码库熵值"""
        snapshot = EntropySnapshot(
            timestamp=datetime.now(),
            total_modules=self._count_modules(codebase_path),
            circular_deps=self._detect_circular_deps(codebase_path),
            cross_layer_imports=self._detect_cross_layer(codebase_path),
            hardcoded_values=self._detect_hardcoded(codebase_path),
            avg_file_lines=self._avg_file_lines(codebase_path),
        )
        self.history.append(snapshot)

        # 计算综合熵值
        entropy = self._calculate_entropy(snapshot)
        return EntropyReport(
            entropy_score=entropy,
            snapshot=snapshot,
            violations=self._check_thresholds(entropy, snapshot),
        )

    def _calculate_entropy(self, snapshot: EntropySnapshot) -> float:
        """综合熵值 = 加权求和"""
        weights = {
            "circular_deps": 0.30,      # 循环依赖权重最高
            "cross_layer": 0.25,        # 跨层导入
            "hardcoded": 0.20,          # 硬编码
            "module_growth": 0.15,      # 模块增长
            "file_size": 0.10,          # 文件大小
        }
        scores = {
            "circular_deps": min(snapshot.circular_deps / 5.0, 1.0),
            "cross_layer": min(snapshot.cross_layer_imports / 10.0, 1.0),
            "hardcoded": min(snapshot.hardcoded_values / 20.0, 1.0),
            "module_growth": min(snapshot.total_modules / 100.0, 1.0),
            "file_size": min(snapshot.avg_file_lines / 500.0, 1.0),
        }
        return sum(weights[k] * scores[k] for k in weights)

@dataclass
class EntropySnapshot:
    timestamp: datetime
    total_modules: int
    circular_deps: int
    cross_layer_imports: int
    hardcoded_values: int
    avg_file_lines: float
```

### 21.4 护栏集成到CI

```yaml
# .github/workflows/ci.yml 新增步骤
- name: Architecture Constraint Check
  run: |
    python -m flowforge.core.constraints check --path flowforge/
    python -m flowforge.core.entropy measure --path flowforge/ --max-entropy 0.3
```

## 修订22：INF-01 LLM路由层代码示例 [来源：审核INF-01]

### 22.1 LLMRouter完整代码级设计

```python
class LLMRouter:
    """LLM路由层 — 多Provider智能路由"""

    def __init__(self, config: LLMRouterConfig):
        self.providers: Dict[str, LLMProvider] = {}
        self.model_routes: Dict[str, ModelRoute] = {}
        self.health_checker = ProviderHealthChecker()
        self.cost_tracker = ProviderCostTracker()
        self._load_config(config)

    def _load_config(self, config: LLMRouterConfig):
        """加载模型路由配置"""
        for provider_cfg in config.providers:
            self.providers[provider_cfg.name] = LLMProvider(
                name=provider_cfg.name,
                base_url=provider_cfg.base_url,
                api_key_env=provider_cfg.api_key_env,
                models=provider_cfg.models,
                priority=provider_cfg.priority,
                rate_limit=provider_cfg.rate_limit,
            )
        for route in config.routes:
            self.model_routes[route.model] = route

    async def chat(
        self,
        model: str,
        messages: List[Dict],
        **kwargs,
    ) -> LLMResponse:
        """智能路由chat请求"""
        route = self.model_routes.get(model)
        if not route:
            raise ModelNotFoundError(f"模型 {model} 无路由配置")

        # 按优先级尝试Provider
        last_error = None
        for provider_name in route.providers:
            provider = self.providers[provider_name]

            # 健康检查
            if not await self.health_checker.is_healthy(provider):
                logger.warning(f"Provider {provider_name} 不健康，跳过")
                continue

            # 限流检查
            if not provider.rate_limiter.allow():
                logger.warning(f"Provider {provider_name} 限流，跳过")
                continue

            try:
                response = await provider.chat(
                    model=route.get_actual_model(provider_name),
                    messages=messages,
                    **kwargs,
                )
                # 记录成功调用
                self.cost_tracker.record(
                    provider=provider_name,
                    model=model,
                    prompt_tokens=response.usage.prompt_tokens,
                    completion_tokens=response.usage.completion_tokens,
                )
                return response
            except (LLMTimeoutError, LLMRateLimitError) as e:
                last_error = e
                logger.warning(f"Provider {provider_name} 调用失败: {e}")
                # 标记不健康
                await self.health_checker.mark_unhealthy(provider, e)
                continue

        raise LLMAllProvidersFailedError(
            f"模型 {model} 所有Provider均失败，最后错误: {last_error}"
        )

@dataclass
class ModelRoute:
    """模型路由规则"""
    model: str                          # 逻辑模型名
    providers: List[str]                # Provider优先级列表
    _model_mapping: Dict[str, str]      # Provider → 实际模型名映射

    def get_actual_model(self, provider_name: str) -> str:
        return self._model_mapping.get(provider_name, self.model)
```

### 22.2 路由配置示例

```yaml
# config/models.yaml
providers:
  - name: openroute
    base_url: "http://localhost:6000/v1"
    api_key_env: "OPENROUTE_API_KEY"
    priority: 1
    rate_limit: { rpm: 60, tpm: 100000 }
    models:
      - "doubao-seed2"
      - "qwen-plus"
      - "deepseek-chat"

  - name: openrouter
    base_url: "https://openrouter.ai/api/v1"
    api_key_env: "OPENROUTER_API_KEY"
    priority: 2
    rate_limit: { rpm: 30, tpm: 50000 }
    models:
      - "deepseek/deepseek-coder"

routes:
  - model: "doubao-seed2"
    providers: ["openroute"]
    model_mapping: { "openroute": "doubao-seed2" }

  - model: "deepseek-coder"
    providers: ["openroute", "openrouter"]
    model_mapping:
      "openroute": "deepseek-chat"
      "openrouter": "deepseek/deepseek-coder"
```

### 22.3 健康检查器

```python
class ProviderHealthChecker:
    """Provider健康检查"""

    def __init__(self):
        self._health_status: Dict[str, ProviderHealth] = {}
        self._check_interval = 30  # 秒

    async def is_healthy(self, provider: LLMProvider) -> bool:
        health = self._health_status.get(provider.name)
        if health is None:
            return True  # 首次默认健康
        if health.consecutive_failures >= 3:
            # 检查是否过了冷却期
            cooldown = timedelta(seconds=30 * health.consecutive_failures)
            if datetime.now() - health.last_failure < cooldown:
                return False
        return health.is_healthy

    async def mark_unhealthy(self, provider: LLMProvider, error: Exception):
        health = self._health_status.setdefault(
            provider.name, ProviderHealth(name=provider.name)
        )
        health.consecutive_failures += 1
        health.last_failure = datetime.now()
        health.last_error = str(error)
```

## 修订23：GateConfig timeout竞态条件 [来源：审核CAP-14]

### 23.1 问题
Gate评估有超时机制，但计时器与评估执行在不同协程中，可能产生竞态：评估完成后计时器仍触发超时。

### 23.2 解决方案：分布式计时器同步

```python
class GateTimeoutManager:
    """Gate超时管理 — 防止竞态条件"""

    def __init__(self, default_timeout: float = 10.0):
        self.default_timeout = default_timeout
        self._active_timers: Dict[str, asyncio.Task] = {}
        self._completed: Set[str] = set()

    async def evaluate_with_timeout(
        self,
        gate: BaseGate,
        context: TaskContext,
        timeout: Optional[float] = None,
    ) -> GateVerdict:
        """带超时的Gate评估，防止竞态"""
        gate_id = gate.gate_id
        timeout = timeout or self.default_timeout

        # 创建评估任务和超时任务
        eval_task = asyncio.create_task(
            gate.evaluate(context),
            name=f"gate_eval_{gate_id}",
        )
        timeout_task = asyncio.create_task(
            asyncio.sleep(timeout),
            name=f"gate_timeout_{gate_id}",
        )

        try:
            # 等待任一完成
            done, pending = await asyncio.wait(
                {eval_task, timeout_task},
                return_when=asyncio.FIRST_COMPLETED,
            )

            # 取消未完成的任务
            for task in pending:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

            if eval_task in done:
                # 评估先完成 — 标记完成，防止超时回调
                self._completed.add(gate_id)
                return eval_task.result()
            else:
                # 超时先完成 — 检查评估是否实际已完成（竞态保护）
                if gate_id in self._completed:
                    return eval_task.result()
                # 真正超时
                return GateVerdict(
                    gate_id=gate_id,
                    passed=True,  # fail-open策略
                    score=0.0,
                    reason=f"Gate评估超时({timeout}s)，fail-open放行",
                    details={"timeout": timeout},
                    evaluated_at=datetime.now(),
                )
        except Exception as e:
            # 评估异常 — fail-open
            return GateVerdict(
                gate_id=gate_id,
                passed=True,
                score=0.0,
                reason=f"Gate评估异常: {e}，fail-open放行",
                details={"error": str(e)},
                evaluated_at=datetime.now(),
            )
        finally:
            self._completed.discard(gate_id)
```

## 修订24：金丝雀状态机checkpoint [来源：审核INF-01]

### 24.1 问题
金丝雀发布期间进程崩溃后，金丝雀状态丢失，无法确定哪些请求走了新路径。

### 24.2 状态持久化+崩溃恢复

```python
class CanaryStateManager:
    """金丝雀状态管理 — 持久化+崩溃恢复"""

    def __init__(self, store: EventStore):
        self.store = store
        self._state_key = "canary_state"

    async def save_state(self, state: CanaryState):
        """持久化金丝雀状态到EventStore"""
        event = SessionEvent(
            event_type="canary.state_checkpoint",
            data={
                "feature": state.feature,
                "rollout_percentage": state.rollout_percentage,
                "phase": state.phase,
                "requests_new": state.requests_new,
                "requests_old": state.requests_old,
                "errors_new": state.errors_new,
                "errors_old": state.errors_old,
                "started_at": state.started_at.isoformat(),
                "last_updated": datetime.now().isoformat(),
            },
        )
        await self.store.append(event)

    async def recover_state(self, feature: str) -> Optional[CanaryState]:
        """崩溃恢复：从EventStore读取最后状态"""
        events = await self.store.query(
            event_type="canary.state_checkpoint",
            filters={"feature": feature},
            limit=1,
            order_by="created_at DESC",
        )
        if not events:
            return None

        data = events[0].data
        return CanaryState(
            feature=data["feature"],
            rollout_percentage=data["rollout_percentage"],
            phase=data["phase"],
            requests_new=data["requests_new"],
            requests_old=data["requests_old"],
            errors_new=data["errors_new"],
            errors_old=data["errors_old"],
            started_at=datetime.fromisoformat(data["started_at"]),
        )

    async def should_use_new_path(self, feature: str) -> bool:
        """判断当前请求是否走新路径"""
        state = await self.recover_state(feature)
        if not state:
            return False  # 无状态默认走旧路径

        # 基于rollout_percentage的确定性路由（同一session_id始终走同一路径）
        import hashlib
        session_id = get_current_session_id()
        hash_val = int(hashlib.md5(session_id.encode()).hexdigest(), 16) % 100
        return hash_val < state.rollout_percentage

@dataclass
class CanaryState:
    feature: str
    rollout_percentage: int  # 0-100
    phase: Literal["off", "canary_5", "canary_25", "canary_50", "full"]
    requests_new: int = 0
    requests_old: int = 0
    errors_new: int = 0
    errors_old: int = 0
    started_at: datetime = field(default_factory=datetime.now)
```

## 修订25：consensus策略伪代码定义 [来源：审核CAP-14]

### 25.1 问题
MultiJudgeVerifier的consensus策略（全体一致/超多数/veto_dimensions）在consensus下的行为未明确定义。

### 25.2 Consensus策略伪代码

```python
class ConsensusStrategy:
    """共识策略 — 定义多评委裁决规则"""

    @staticmethod
    def unanimous(verdicts: List[GateVerdict]) -> ConsensusResult:
        """全体一致：所有评委必须通过"""
        all_passed = all(v.passed for v in verdicts)
        min_score = min(v.score for v in verdicts) if verdicts else 0.0
        dissenters = [v for v in verdicts if not v.passed]

        return ConsensusResult(
            passed=all_passed,
            score=min_score,
            strategy="unanimous",
            total_judges=len(verdicts),
            passed_judges=len([v for v in verdicts if v.passed]),
            dissenters=dissenters,
            reason=(
                f"全体一致通过({len(verdicts)}/{len(verdicts)})"
                if all_passed
                else f"存在{len(dissenters)}个反对评委"
            ),
        )

    @staticmethod
    def supermajority(
        verdicts: List[GateVerdict],
        threshold: float = 2/3,
    ) -> ConsensusResult:
        """超多数：通过比例≥threshold（默认2/3）"""
        passed_count = sum(1 for v in verdicts if v.passed)
        ratio = passed_count / len(verdicts) if verdicts else 0.0
        passed = ratio >= threshold
        avg_score = sum(v.score for v in verdicts) / len(verdicts) if verdicts else 0.0
        dissenters = [v for v in verdicts if not v.passed]

        return ConsensusResult(
            passed=passed,
            score=avg_score,
            strategy="supermajority",
            total_judges=len(verdicts),
            passed_judges=passed_count,
            dissenters=dissenters,
            reason=(
                f"超多数通过({passed_count}/{len(verdicts)}={ratio:.1%}≥{threshold:.1%})"
                if passed
                else f"未达超多数({passed_count}/{len(verdicts)}={ratio:.1%}<{threshold:.1%})"
            ),
        )

    @staticmethod
    def veto_dimensions(
        verdicts: List[GateVerdict],
        veto_dimensions: List[str],
    ) -> ConsensusResult:
        """否决维度：指定维度有一票否决权"""
        # 按维度分组
        dim_verdicts: Dict[str, List[GateVerdict]] = {}
        for v in verdicts:
            dim = v.details.get("dimension", "default")
            dim_verdicts.setdefault(dim, []).append(v)

        # 检查否决维度
        vetoed = False
        veto_reasons = []
        for dim in veto_dimensions:
            if dim in dim_verdicts:
                dim_passed = all(v.passed for v in dim_verdicts[dim])
                if not dim_passed:
                    vetoed = True
                    veto_reasons.append(
                        f"否决维度'{dim}'未通过: "
                        f"{[v.reason for v in dim_verdicts[dim] if not v.passed]}"
                    )

        # 非否决维度用超多数
        non_veto_verdicts = [
            v for v in verdicts
            if v.details.get("dimension", "default") not in veto_dimensions
        ]
        non_veto_result = ConsensusStrategy.supermajority(non_veto_verdicts)

        passed = not vetoed and non_veto_result.passed
        avg_score = sum(v.score for v in verdicts) / len(verdicts) if verdicts else 0.0

        return ConsensusResult(
            passed=passed,
            score=avg_score,
            strategy="veto_dimensions",
            total_judges=len(verdicts),
            passed_judges=sum(1 for v in verdicts if v.passed),
            dissenters=[v for v in verdicts if not v.passed],
            reason=(
                "通过" if passed
                else "；".join(veto_reasons) if vetoed
                else non_veto_result.reason
            ),
        )

@dataclass
class ConsensusResult:
    passed: bool
    score: float
    strategy: str
    total_judges: int
    passed_judges: int
    dissenters: List[GateVerdict]
    reason: str
```

### 25.3 配置示例

```yaml
# config/gates.yaml
gates:
  - id: "dcp"
    consensus: "unanimous"  # 代码门禁：全体一致
    judges: 3

  - id: "content_quality"
    consensus: "supermajority"
    supermajority_threshold: 0.67  # 2/3通过
    judges: 3

  - id: "novel_consistency"
    consensus: "veto_dimensions"
    veto_dimensions: ["safety", "legal"]  # 安全/法律维度一票否决
    judges: 5
```

---

# [审核修订 v3.0] 六方联合审核修订增补（v2.1/v2.2未覆盖项）

> 审核日期：2026-06-16 | 修订版本：v3.0 | 来源：6份专家审核意见并集，v2.1/v2.2未覆盖部分
> 审核来源：review_landing_design.md / review_landing_design_deepseek.md / review_landing_design_doubao.md / review_landing_design_kimi.md / review_landing_design_mm.md / review_landing_design_qw.md

## A3.0-1 FWK-01 WorkflowCompiler拆分为Parser+Validator+CodeGen三阶段 [来源：审核1-P0]

### 问题描述
WorkflowCompiler同时承担编译、验证、转换三个职责，CompiledStep的递归嵌套导致编译产物难以调试。

### 修订方案

```python
class WorkflowCompilerV2:
    """WorkflowCompiler V2 — 三阶段编译"""

    def compile(self, yaml_config: Dict[str, Any]) -> CompiledWorkflow:
        # 阶段1：解析YAML为AST
        ast = self._parse(yaml_config)
        # 阶段2：验证AST（类型检查、依赖检查、循环检测）
        self._validate(ast)
        # 阶段3：代码生成（AST → CompiledWorkflow）
        compiled = self._codegen(ast)
        return compiled

    def _parse(self, yaml_config: Dict) -> WorkflowAST:
        """阶段1：解析YAML为抽象语法树"""
        parser = WorkflowParser()
        return parser.parse(yaml_config)

    def _validate(self, ast: WorkflowAST) -> None:
        """阶段2：验证AST"""
        validators = [
            TypeValidator(),       # StepType合法性
            DependencyValidator(), # 步骤间依赖可达性
            CycleValidator(),      # 循环依赖检测
            SchemaValidator(),     # YAML Schema校验
        ]
        for validator in validators:
            result = validator.validate(ast)
            if not result.passed:
                raise WorkflowCompileError(result.errors)

    def _codegen(self, ast: WorkflowAST) -> CompiledWorkflow:
        """阶段3：代码生成"""
        codegen = WorkflowCodeGen()
        return codegen.generate(ast)

    def to_ir(self, yaml_config: Dict) -> str:
        """导出IR（中间表示）用于可视化调试"""
        ast = self._parse(yaml_config)
        return IRSerializer().serialize(ast)
```

### 优先级
P0

## A3.0-2 FWK-01编译器与执行器契约，WorkflowExecutor需同步改造 [来源：审核kimi-P0]

### 问题描述
to_sop_steps()只是格式转换，没有解决WorkflowExecutor对条件路由、并行组、回退链的运行时调度能力。

### 修订方案

```python
class WorkflowExecutorV2:
    """WorkflowExecutor V2 — 支持编译产物的运行时调度"""

    def __init__(self, compiler: WorkflowCompiler):
        self.compiler = compiler
        self._step_handlers: Dict[StepType, StepHandler] = {
            StepType.SEQUENCE: SequenceHandler(),
            StepType.CONDITIONAL: ConditionalHandler(),
            StepType.PARALLEL: ParallelHandler(),
            StepType.FALLBACK: FallbackHandler(),
            StepType.LOOP: LoopHandler(),
            StepType.GATE: GateHandler(),
        }

    async def execute(self, workflow: CompiledWorkflow, context: TaskContext) -> WorkflowResult:
        """执行编译后的Workflow"""
        results = {}
        for step in workflow.steps:
            handler = self._step_handlers.get(step.step_type)
            if not handler:
                raise UnsupportedStepTypeError(step.step_type)
            result = await handler.execute(step, context, results)
            results[step.id] = result
        return WorkflowResult(outputs=results)
```

### 优先级
P0

## A3.0-3 FWK-01输入映射引入Jinja2模板引擎 [来源：审核kimi-P0]

### 问题描述
当前input_mapping只支持简单键值映射，无法处理数组映射、字段提取、条件赋值等复杂场景。

### 修订方案

```python
from jinja2 import Environment, BaseLoader, StrictUndefined

class InputMapperV2:
    """输入映射V2 — Jinja2模板引擎"""

    def __init__(self):
        self._env = Environment(
            loader=BaseLoader(),
            undefined=StrictUndefined,  # 严格模式：未定义变量报错
            autoescape=False,
        )

    def map_inputs(self, input_mapping: Dict[str, str], context: Dict) -> Dict[str, Any]:
        """根据input_mapping映射输入"""
        result = {}
        for target_key, expression in input_mapping.items():
            template = self._env.from_string(expression)
            result[target_key] = template.render(**context)
        return result

# YAML中使用示例：
# input_mapping:
#   task_description: "${task.description}"
#   requirements_doc: "{{ outputs.requirements.requirements_doc | truncate(1000) }}"
#   chapter_info: "{{ state.outline.volumes[current_volume].chapters[current_chapter] }}"
```

### 优先级
P0

## A3.0-4 FWK-02条件表达式解析器安全隐患，使用asteval [来源：审核kimi-P0]

### 问题描述
当前实现是字符串拼接解析，存在表达式注入风险。

### 修订方案

```python
from asteval import Interpreter

class SafeExpressionEvaluator:
    """安全表达式评估器 — 使用asteval"""

    SAFE_NAMES = {
        "len": len, "min": min, "max": max,
        "abs": abs, "round": round, "sorted": sorted,
        "True": True, "False": False, "None": None,
    }

    def __init__(self):
        self._interpreter = Interpreter(
            usersyms=self.SAFE_NAMES,
            use_numpy=False,
            minimal=True,
        )

    def evaluate(self, expression: str, context: Dict[str, Any]) -> Any:
        """安全评估表达式"""
        # 白名单检查：只允许安全字符
        import re
        if not re.match(r'^[\w\s\.\[\]><=!&|+\-*/%(),:"]+$', expression):
            raise ExpressionSecurityError(f"不安全的表达式: {expression}")

        self._interpreter.symtable.update(context)
        try:
            result = self._interpreter(expression)
            if self._interpreter.error:
                raise self._interpreter.error[0]
            return result
        except Exception as e:
            raise ExpressionEvaluationError(f"表达式评估失败: {expression}, 错误: {e}")

    def evaluate_with_default(self, expression: str, context: Dict, default: Any = None, strict: bool = False) -> Any:
        """含None处理和strict_mode的表达式评估"""
        result = self.evaluate(expression, context)
        if result is None:
            if strict:
                raise ExpressionNoneError(f"表达式结果为None: {expression}")
            return default
        return result
```

### 优先级
P0

## A3.0-5 FWK-03 per-step success_condition配置 [来源：审核kimi-P0]

### 问题描述
FallbackChain的_is_success()判断逻辑过于简化，不同Tool的成功/失败语义不一致。

### 修订方案

```python
class FallbackChainV2:
    """FallbackChain V2 — per-step success_condition"""

    @staticmethod
    async def _is_success(result: Any, success_condition: Optional[str] = None) -> bool:
        """根据per-step的success_condition判断成功"""
        if success_condition is None:
            # 默认逻辑
            if isinstance(result, dict):
                return not result.get("error") and result.get("status") != "failed"
            return True

        # 使用安全表达式评估器
        evaluator = SafeExpressionEvaluator()
        context = {"result": result, "status": result.get("status") if isinstance(result, dict) else None}
        return bool(evaluator.evaluate(success_condition, context))

# YAML配置示例：
# steps:
#   - name: "check_resource"
#     type: fallback
#     fallback_chain: ["http_head", "http_get"]
#     success_condition: "status in [200, 404]"  # 404也算成功
#
#   - name: "publish_article"
#     type: fallback
#     fallback_chain: ["playwright_publish", "api_publish"]
#     success_condition: "result.get('published', False) == True"
```

### 优先级
P0

## A3.0-6 FWK-06 TurnKind与LoopPhase合并为统一状态机 [来源：审核kimi-P0/mm-P0]

### 问题描述
TurnKind含6种状态，LoopPhase含7种状态，两套并行状态机导致隐式不一致。

### 修订方案

```python
from enum import Enum

class UnifiedLoopState(str, Enum):
    """统一循环状态机 — 合并TurnKind与LoopPhase"""
    # 基础状态（对应LoopPhase）
    IDLE = "idle"               # 初始状态
    EXECUTING = "executing"     # 执行Agent
    EVALUATING = "evaluating"   # 评估结果（Gate/QualityCheck）
    REFLECTING = "reflecting"   # 反思修正
    COMPACTING = "compacting"   # 上下文压缩
    AGENT_SWITCHING = "agent_switching"  # Agent切换
    COMPLETED = "completed"     # 完成
    FAILED = "failed"           # 失败
    PAUSED = "paused"           # 暂停（人工审核）

class LoopContext:
    """循环上下文 — 封装7个参数为1个对象"""
    def __init__(
        self,
        verdict: Optional[GateVerdict] = None,
        attempt: int = 0,
        max_retries: int = 4,
        max_steps: int = 25,
        feedback_gate: Optional[str] = None,
        context_utilization: float = 0.0,
        compaction_threshold: float = 0.8,
    ):
        self.verdict = verdict
        self.attempt = attempt
        self.max_retries = max_retries
        self.max_steps = max_steps  # max_steps优先级高于max_retries
        self.feedback_gate = feedback_gate
        self.context_utilization = context_utilization
        self.compaction_threshold = compaction_threshold

class UnifiedLoopStateMachine:
    """统一循环状态机"""

    TRANSITIONS = {
        # (当前状态, 条件) → 下一状态
        (UnifiedLoopState.IDLE, "start"): UnifiedLoopState.EXECUTING,
        (UnifiedLoopState.EXECUTING, "success"): UnifiedLoopState.EVALUATING,
        (UnifiedLoopState.EXECUTING, "error"): UnifiedLoopState.REFLECTING,
        (UnifiedLoopState.EVALUATING, "passed"): UnifiedLoopState.COMPLETED,
        (UnifiedLoopState.EVALUATING, "failed"): UnifiedLoopState.REFLECTING,
        (UnifiedLoopState.EVALUATING, "human_required"): UnifiedLoopState.PAUSED,
        (UnifiedLoopState.REFLECTING, "retry"): UnifiedLoopState.EXECUTING,
        (UnifiedLoopState.REFLECTING, "exhausted"): UnifiedLoopState.FAILED,
        (UnifiedLoopState.REFLECTING, "overflow"): UnifiedLoopState.COMPACTING,
        (UnifiedLoopState.COMPACTING, "done"): UnifiedLoopState.EXECUTING,
        (UnifiedLoopState.COMPACTING, "failed"): UnifiedLoopState.FAILED,
        (UnifiedLoopState.PAUSED, "resume"): UnifiedLoopState.EVALUATING,
        (UnifiedLoopState.EXECUTING, "switch_agent"): UnifiedLoopState.AGENT_SWITCHING,
        (UnifiedLoopState.AGENT_SWITCHING, "done"): UnifiedLoopState.EXECUTING,
    }

    def decide(self, current: UnifiedLoopState, ctx: LoopContext) -> UnifiedLoopState:
        """根据当前状态和上下文决定下一状态"""
        # max_steps优先级高于max_retries
        if ctx.attempt >= ctx.max_steps:
            return UnifiedLoopState.FAILED
        if ctx.context_utilization > ctx.compaction_threshold:
            return UnifiedLoopState.COMPACTING
        # ... 其他转换逻辑
```

### 优先级
P0

## A3.0-7 INF-02 EventStore WAL模式+批量提交+inbox三阶段 [来源：审核1-P0/kimi-P0/mm-P0]

### 问题描述
EventStore使用SQLite单文件append后立即commit，高频写入性能堪忧。缺失steer/queue投递语义和inbox三阶段。

### 修订方案

```python
class EventStoreV2:
    """EventStore V2 — WAL模式+批量提交+inbox三阶段"""

    def __init__(self, db_path: str, batch_size: int = 100, flush_interval: float = 1.0):
        self._conn = sqlite3.connect(db_path)
        self._conn.execute("PRAGMA journal_mode=WAL")  # WAL模式
        self._conn.execute("PRAGMA synchronous=NORMAL")  # 降低同步级别
        self._batch: List[SessionEvent] = []
        self._batch_size = batch_size
        self._flush_interval = flush_interval
        self._last_flush = time.time()

    async def append(self, event: SessionEvent) -> None:
        """追加事件（批量提交）"""
        self._batch.append(event)
        if len(self._batch) >= self._batch_size or \
           time.time() - self._last_flush >= self._flush_interval:
            await self._flush()

    async def _flush(self) -> None:
        """批量提交"""
        if not self._batch:
            return
        cursor = self._conn.cursor()
        cursor.executemany(
            "INSERT INTO events (event_type, data, created_at) VALUES (?, ?, ?)",
            [(e.event_type, json.dumps(e.data), e.created_at) for e in self._batch]
        )
        self._conn.commit()
        self._batch.clear()
        self._last_flush = time.time()

class SessionInputManager:
    """Session输入管理器 — inbox三阶段（admit→promote→execute）"""

    async def admit(self, input: SessionInput) -> str:
        """阶段1：接收输入，放入inbox"""
        input_id = str(uuid4())
        await self.event_store.append(SessionEvent(
            event_type="input.admitted",
            data={"input_id": input_id, "content": input.content, "priority": input.priority},
        ))
        return input_id

    async def promote(self, input_id: str) -> None:
        """阶段2：提升输入，从inbox移到执行队列"""
        await self.event_store.append(SessionEvent(
            event_type="input.promoted",
            data={"input_id": input_id},
        ))

    async def execute(self, input_id: str) -> None:
        """阶段3：执行输入"""
        await self.event_store.append(SessionEvent(
            event_type="input.executing",
            data={"input_id": input_id},
        ))

    async def steer(self, input: SessionInput) -> None:
        """steer语义：用户中途插入指令优先处理"""
        input_id = await self.admit(input)
        await self.promote(input_id)  # steer立即提升
        # interrupt_seq：抑制旧wake
        await self.event_store.append(SessionEvent(
            event_type="input.steer",
            data={"input_id": input_id, "interrupt_previous": True},
        ))
```

### 优先级
P0

## A3.0-8 INF-03 DI容器SCOPED生命周期 [来源：审核1-P1]

### 问题描述
DIContainer的SCOPED生命周期未实现，resolve()中只处理了SINGLETON和TRANSIENT。

### 修订方案

```python
class DIContainerV2:
    """DI容器V2 — 支持SCOPED生命周期"""

    def __init__(self):
        self._singletons: Dict[str, Any] = {}
        self._factories: Dict[str, Tuple[type, Lifecycle]] = {}
        self._scope_stack: List[Dict[str, Any]] = []  # SCOPED实例存储

    def register(self, interface: type, implementation: type,
                 lifecycle: Lifecycle = Lifecycle.SINGLETON):
        self._factories[interface.__name__] = (implementation, lifecycle)

    def create_scope(self) -> "ScopedContainer":
        """创建SCOPED作用域"""
        scope_instances = {}
        self._scope_stack.append(scope_instances)
        return ScopedContainer(self, scope_instances)

    def release_scope(self) -> None:
        """释放SCOPED作用域"""
        if self._scope_stack:
            self._scope_stack.pop()

    async def resolve(self, interface: type) -> Any:
        name = interface.__name__
        impl, lifecycle = self._factories[name]

        if lifecycle == Lifecycle.SINGLETON:
            if name not in self._singletons:
                self._singletons[name] = impl()
            return self._singletons[name]
        elif lifecycle == Lifecycle.SCOPED:
            if not self._scope_stack:
                raise DIScopeError(f"SCOPED依赖'{name}'在作用域外解析")
            scope = self._scope_stack[-1]
            if name not in scope:
                scope[name] = impl()
            return scope[name]
        else:  # TRANSIENT
            return impl()

class ScopedContainer:
    """作用域容器 — 绑定到请求/会话生命周期"""
    def __init__(self, parent: DIContainerV2, instances: Dict[str, Any]):
        self._parent = parent
        self._instances = instances

    async def resolve(self, interface: type) -> Any:
        return await self._parent.resolve(interface)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        self._instances.clear()
```

### 优先级
P1

## A3.0-9 INF-05 DualThresholdCompactor最大次数限制+强制截断 [来源：审核1-P0]

### 问题描述
Compaction触发LLM摘要但LLM调用失败时，回退到抽取式摘要可能仍超阈值，导致死循环。

### 修订方案

```python
class DualThresholdCompactorV2:
    """DualThresholdCompactor V2 — 最大次数限制+强制截断"""

    def __init__(self, max_compactions: int = 3, safe_threshold_ratio: float = 0.7):
        self.max_compactions = max_compactions
        self.safe_threshold_ratio = safe_threshold_ratio  # 强制截断到安全阈值的70%
        self._compaction_count: Dict[str, int] = {}  # session_id → count

    async def compact(self, session_id: str, messages: List[Message]) -> List[Message]:
        count = self._compaction_count.get(session_id, 0)
        if count >= self.max_compactions:
            # 超过最大次数：强制截断+丢弃最旧消息
            logger.warning(f"Session {session_id} 达到Compaction上限({self.max_compactions})，强制截断")
            return self._force_truncate(messages)

        self._compaction_count[session_id] = count + 1

        try:
            # 尝试LLM摘要（中文摘要模型指定Doubao）
            return await self._llm_summarize(messages, model="doubao-seed2")
        except LLMError:
            # LLM失败：回退到抽取式摘要
            result = self._extractive_summarize(messages)
            # 抽取式摘要后检查是否仍超阈值
            if self._estimate_tokens(result) > self._soft_threshold * self.safe_threshold_ratio:
                # 仍超阈值：强制截断到安全线以下
                return self._force_truncate(result)
            return result

    def _force_truncate(self, messages: List[Message]) -> List[Message]:
        """强制截断到安全阈值以下"""
        # 保留最近的消息，丢弃最旧的
        budget = int(self._soft_threshold * self.safe_threshold_ratio)
        result = []
        current_tokens = 0
        for msg in reversed(messages):
            msg_tokens = self._estimate_tokens([msg])
            if current_tokens + msg_tokens > budget:
                break
            result.insert(0, msg)
            current_tokens += msg_tokens
        return result
```

### 优先级
P0

## A3.0-10 CAP-10 FiberSet next_completed()超时可配置 [来源：审核1-P1]

### 问题描述
next_completed()使用asyncio.wait_for(timeout=0.1)，100ms超时在LLM调用场景下太短。

### 修订方案

```python
class FiberSetV2:
    """FiberSet V2 — 超时可配置"""

    def __init__(self, default_timeout: float = 1.0):
        self.default_timeout = default_timeout
        self._fibers: Dict[str, asyncio.Task] = {}

    async def next_completed(self, timeout: Optional[float] = None) -> Optional[FiberResult]:
        """等待下一个完成的Fiber，超时返回None"""
        timeout = timeout or self.default_timeout
        if not self._fibers:
            return None

        try:
            done, _ = await asyncio.wait(
                self._fibers.values(),
                timeout=timeout,
                return_when=asyncio.FIRST_COMPLETED,
            )
            if not done:
                return None
            task = done.pop()
            fiber_id = self._get_fiber_id(task)
            result = task.result()
            del self._fibers[fiber_id]
            return FiberResult(fiber_id=fiber_id, result=result)
        except Exception as e:
            logger.warning(f"FiberSet next_completed异常: {e}")
            return None
```

### 优先级
P1

## A3.0-11 Effect Schema映射，关键数据结构改Pydantic BaseModel [来源：审核kimi-P1/mm-P1]

### 问题描述
LLMRequest是@dataclass而非BaseModel，SessionEvent.data是黑盒dict，关键跨边界数据结构缺乏运行时校验。

### 修订方案

```python
from pydantic import BaseModel, Field

class LLMRequest(BaseModel):
    """LLM请求 — Pydantic BaseModel替代@dataclass"""
    model: str
    messages: List[Dict[str, str]]
    temperature: float = 0.7
    max_tokens: int = 4096
    top_p: float = 0.95
    json_schema: Optional[Dict] = None
    stream: bool = False

class LLMCallEvent(BaseModel):
    """LLM调用事件 — Pydantic BaseModel"""
    event_type: str = "llm.call_completed"
    model: str
    provider: str
    prompt_tokens: int
    completion_tokens: int
    latency_ms: float
    is_fallback: bool = False
    fallback_chain_index: int = 0
    error_code: Optional[str] = None
    trace_id: str
    session_id: str
    timestamp: datetime = Field(default_factory=datetime.now)

class SessionEventV2(BaseModel):
    """Session事件V2 — Pydantic BaseModel替代黑盒dict"""
    event_type: str
    data: Dict[str, Any] = Field(default_factory=dict)
    trace_id: Optional[str] = None
    session_id: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.now)

class GateVerdictV2(BaseModel):
    """Gate裁决V2 — Pydantic BaseModel"""
    gate_id: str
    passed: bool
    score: float
    reason: str
    details: Dict[str, Any] = Field(default_factory=dict)
    evaluated_at: datetime = Field(default_factory=datetime.now)
```

### 优先级
P1

## A3.0-12 FlowForge反向import修复 [来源：审核kimi-P1/mm-P1]

### 问题描述
flowforge/core/flowforge.py第17-28行反向import ContentForge工具，违反P9契约。

### 修订方案

```python
# 修复前（flowforge/core/flowforge.py 第17-28行）：
# try:
#     from contentforge.tools.toutiao_publisher import ToutiaoPublisherTool
# except ImportError:
#     ToutiaoPublisherTool = None

# 修复后：删除反向import，通过ContentForgePlugin的register_tools()注册
# flowforge/core/flowforge.py 中不再import任何*Forge模块

# ContentForge Plugin注册：
class ContentForgePlugin(FlowForgePlugin):
    def register_tools(self) -> List[Type[BaseTool]]:
        from contentforge.tools.toutiao_publisher import ToutiaoPublisherTool
        from contentforge.tools.wechat_publisher import WeChatPublisherTool
        from contentforge.tools.pexels_image import PexelsImageTool
        return [ToutiaoPublisherTool, WeChatPublisherTool, PexelsImageTool]

# P9契约验证检查项：
# - CI新增：grep -r "from contentforge" flowforge/ → 0匹配
# - CI新增：grep -r "from devforge" flowforge/ → 0匹配
# - CI新增：grep -r "from novelforge" flowforge/ → 0匹配
```

### 优先级
P0

## A3.0-13 Plugin协议扩展 [来源：审核kimi-P1/mm-P1]

### 问题描述
FlowForgePlugin协议只提供4个钩子，不足以表达*Forge业务复杂度。

### 修订方案

```python
class FlowForgePluginV2(Protocol):
    """FlowForge Plugin协议V2 — 扩展钩子"""

    # 原有4个钩子
    def register_agents(self) -> List[Type[BaseAgent]]: ...
    def register_tools(self) -> List[Type[BaseTool]]: ...
    def register_routes(self) -> List[RouteDef]: ...
    def register_event_handlers(self) -> Dict[str, Callable]: ...

    # 新增钩子
    def register_workflows(self) -> List[str]:
        """注册Workflow YAML文件路径"""
        return []

    def register_gates(self) -> List[str]:
        """注册Gate YAML文件路径（DevForge DCP/TR、NovelForge QG）"""
        return []

    def register_evaluators(self) -> List[Type[BaseEvaluator]]:
        """注册Evaluator Agent（DevForge 8个Evaluator）"""
        return []

    def register_sops(self) -> List[str]:
        """注册SOP YAML文件路径（ContentForge 4种SOP）"""
        return []

    def register_quality_gates(self) -> List[str]:
        """注册Quality Gate YAML路径（NovelForge 6道QG）"""
        return []

    def register_context_layers(self) -> List[ContextLayerDef]:
        """注册上下文层定义（NovelForge 5层上下文）"""
        return []

    def register_workflow_step_handler(self) -> Dict[str, Type[StepHandler]]:
        """注册自定义StepType处理器"""
        return {}
        # DevForge注入: {"gate": GateStepHandler}
        # ContentForge注入: {"sop_node": SOPNodeHandler}
        # NovelForge注入: {"quality_gate": QualityGateStepHandler}

    def register_canary_strategy(self) -> Optional[Type[CanaryStrategy]]:
        """注册金丝雀发布策略（DevForge）"""
        return None

    def register_sandbox(self) -> Optional[Type[SandboxExecutor]]:
        """注册代码沙箱执行器（DevForge）"""
        return None

    def register_publish_platforms(self) -> List[Type[PlatformPublisher]]:
        """注册多平台Publisher（ContentForge）"""
        return []
```

### 优先级
P1

## A3.0-14 ConfigVersion配置版本控制 [来源：审核kimi-P1/mm-P1]

### 问题描述
Workflow YAML、Agent YAML、Persona定义、Prompt模板等没有版本控制，配置变更无法追踪。

### 修订方案

```python
class ConfigVersion(BaseModel):
    """配置版本控制"""
    config_type: str          # "workflow" | "agent" | "persona" | "prompt" | "gate"
    config_id: str            # 配置唯一标识
    version: str              # 语义化版本 "1.0.0"
    checksum: str             # 内容SHA256
    created_at: datetime
    created_by: str
    changelog: str            # 变更说明
    deprecated: bool = False
    deprecated_since: Optional[str] = None  # 弃用版本

class ConfigVersionManager:
    """配置版本管理器"""

    def __init__(self, store: ConfigStore):
        self.store = store

    async def detect_changes(self) -> List[ConfigChange]:
        """启动时检测配置变更"""
        changes = []
        for config_type in ["workflow", "agent", "persona", "prompt", "gate"]:
            current = await self._load_configs(config_type)
            baseline = await self.store.get_baseline(config_type)
            for config_id, config in current.items():
                checksum = self._compute_checksum(config)
                if config_id not in baseline or baseline[config_id].checksum != checksum:
                    changes.append(ConfigChange(
                        config_type=config_type,
                        config_id=config_id,
                        change_type="added" if config_id not in baseline else "modified",
                        new_checksum=checksum,
                    ))
        return changes

    async def graceful_reload(self, changes: List[ConfigChange]) -> None:
        """优雅重载变更的配置"""
        for change in changes:
            if change.config_type == "prompt":
                # Prompt模板：热加载
                await self.prompt_manager.reload(change.config_id)
            elif change.config_type in ("workflow", "agent"):
                # Workflow/Agent：标记需要重启
                logger.warning(f"配置 {change.config_id} 已变更，需要重启生效")
```

### 优先级
P1

## A3.0-15 BaseTool function call Schema [来源：审核doubao-P0]

### 问题描述
BaseTool未提供标准的function_call schema，Doubao的function call要求parameters_schema。

### 修订方案

```python
from pydantic import BaseModel

class BaseToolV2:
    """BaseTool V2 — 增加parameters_schema和to_function_call()"""

    name: str
    description: str

    @classmethod
    def parameters_schema(cls) -> Dict[str, Any]:
        """返回工具参数的JSON Schema"""
        # 从_run方法的类型注解自动生成
        import inspect
        sig = inspect.signature(cls._run)
        properties = {}
        required = []
        for param_name, param in sig.parameters.items():
            if param_name == "self":
                continue
            prop = {"type": "string"}  # 默认string
            if param.annotation != inspect.Parameter.empty:
                type_map = {str: "string", int: "integer", float: "number", bool: "boolean"}
                prop["type"] = type_map.get(param.annotation, "string")
            properties[param_name] = prop
            if param.default == inspect.Parameter.empty:
                required.append(param_name)
        return {
            "type": "object",
            "properties": properties,
            "required": required,
        }

    def to_function_call(self) -> Dict[str, Any]:
        """转换为Doubao/OpenAI function call格式"""
        return {
            "name": self.name,
            "description": self.description,
            "parameters": self.parameters_schema(),
        }

    async def _run(self, **kwargs) -> Any:
        raise NotImplementedError
```

### 优先级
P0

## A3.0-16 models.yaml Doubao规格参数完整配置 [来源：审核doubao-P0]

### 问题描述
models.yaml只有模型名字，缺少Doubao的max_tokens/temperature/json_schema/cost/tpm等规格参数。

### 修订方案

```yaml
# config/models.yaml — 完整Doubao规格
providers:
  openroute:
    base_url: "http://localhost:6000/v1"
    api_key_env: "OPENROUTE_API_KEY"
    priority: 1
    rate_limit: { rpm: 60, tpm: 100000 }

  openrouter:
    base_url: "https://openrouter.ai/api/v1"
    api_key_env: "OPENROUTER_API_KEY"
    priority: 2
    rate_limit: { rpm: 30, tpm: 50000 }

models:
  doubao-seed2:
    provider: openroute
    model_id: "doubao-seed-2.0"
    max_tokens: 8192
    temperature: 0.7
    top_p: 0.95
    json_schema_supported: true
    parallel_tool_calls: true
    seed: 42
    safety_threshold: "medium"
    cost_per_1k_input_tokens: 0.002
    cost_per_1k_output_tokens: 0.006
    tpm_quota: 100000
    rpm_quota: 1000
    fallback_chain: ["qwen-plus", "deepseek-chat"]

  qwen-plus:
    provider: openroute
    model_id: "qwen3.6-plus"
    max_tokens: 8192
    temperature: 0.7
    top_p: 0.9
    json_schema_supported: true
    parallel_tool_calls: false
    cost_per_1k_input_tokens: 0.003
    cost_per_1k_output_tokens: 0.009
    tpm_quota: 60000
    rpm_quota: 500

  deepseek-chat:
    provider: openroute
    model_id: "deepseek-chat"
    max_tokens: 8192
    temperature: 0.7
    top_p: 0.9
    json_schema_supported: false
    parallel_tool_calls: false
    cost_per_1k_input_tokens: 0.001
    cost_per_1k_output_tokens: 0.002
    tpm_quota: 80000
    rpm_quota: 800
```

### 优先级
P0

## A3.0-17 Persona注入Doubao seed指令格式 [来源：审核doubao-P0]

### 问题描述
Persona注入使用自然语言段落，Doubao的system prompt最佳做法是短（≤1024 token）、指令式、无冗余。

### 修订方案

```python
class PersonaInjectorV2:
    """Persona注入V2 — Doubao seed指令格式"""

    MAX_SOUL_TOKENS = 512  # SOUL维度限定512 token以内
    MAX_PERSONA_RATIO = 0.15  # persona token占比<15%

    async def inject(self, prompt: str, persona: PersonaConfig, context: TaskContext) -> str:
        """注入Persona到prompt"""
        # 1. 构建结构化system指令（非自然语言段落）
        system_parts = []

        if persona.soul:
            soul_text = self._compress_if_needed(persona.soul.to_prompt_segment(), self.MAX_SOUL_TOKENS)
            system_parts.append(f"<|system|>SOUL:{soul_text}")

        if persona.memory:
            memory_text = persona.memory.to_prompt_segment()
            system_parts.append(f"<|system|>MEMORY:{memory_text}")

        if persona.creation:
            creation_text = persona.creation.to_prompt_segment()
            system_parts.append(f"<|system|>CREATION:{creation_text}")

        # 2. 成本审计：检查persona token占比
        persona_tokens = self._estimate_tokens("\n".join(system_parts))
        total_tokens = persona_tokens + self._estimate_tokens(prompt)
        if persona_tokens / max(total_tokens, 1) > self.MAX_PERSONA_RATIO:
            logger.warning(
                f"Persona token占比 {persona_tokens/total_tokens:.1%} 超过阈值 {self.MAX_PERSONA_RATIO:.1%}"
            )

        return "\n".join(system_parts) + "\n" + prompt

    def _compress_if_needed(self, text: str, max_tokens: int) -> str:
        """超限时自动压缩"""
        current_tokens = self._estimate_tokens(text)
        if current_tokens <= max_tokens:
            return text
        # 截断到max_tokens
        ratio = max_tokens / current_tokens
        char_limit = int(len(text) * ratio)
        return text[:char_limit] + "..."
```

### 优先级
P0

## A3.0-18 FWK-07 PipelineCompiler独立实现 [来源：审核1-P2]

### 问题描述
PipelineCompiler继承WorkflowCompiler意味着Pipeline拥有了Workflow的全部能力，违反最小知识原则。

### 修订方案

```python
class PipelineCompiler:
    """PipelineCompiler — 独立实现，不继承WorkflowCompiler"""

    def compile(self, yaml_config: Dict[str, Any]) -> CompiledPipeline:
        """编译Pipeline YAML为CompiledPipeline（仅SEQUENCE步骤）"""
        steps = []
        for step_config in yaml_config.get("steps", []):
            if step_config.get("type") not in (None, "sequence"):
                raise PipelineCompileError(
                    f"Pipeline只支持SEQUENCE步骤，不支持 {step_config.get('type')}"
                )
            steps.append(CompiledStep(
                id=step_config["id"],
                name=step_config.get("name", step_config["id"]),
                step_type=StepType.SEQUENCE,
                agent=step_config.get("agent"),
                input_mapping=step_config.get("input_mapping", {}),
                output_key=step_config.get("output_key"),
            ))
        return CompiledPipeline(name=yaml_config["name"], steps=steps)
```

### 优先级
P2

## A3.0-19 CAP-01 Source<A>代数降级为简单Dict [来源：审核1-P0/kimi/mm]

### 问题描述
5种Source类型（SourceStatic / SourceAgent / SourceTool / SourceParam / SourceContext）+ 6字段ContextFragment过度设计，Phase 2阶段不需要代数操作能力，增加理解成本和实现复杂度。

### 修订方案

```python
# Phase 2：降级为简单Dict
@dataclass
class ContextFragment:
    """上下文片段 — 简化为3字段"""
    key: str           # 片段标识
    content: str       # 片段内容
    priority: float    # 优先级（0.0~1.0）

# 上下文容器：Dict[str, ContextFragment]
# 使用示例：
context = {
    "topic_result": ContextFragment(key="topic_result", content="...", priority=0.9),
    "search_result": ContextFragment(key="search_result", content="...", priority=0.7),
    "draft_outline": ContextFragment(key="draft_outline", content="...", priority=0.5),
}

# Phase 3：再引入代数操作（merge / filter / compose）
# class ContextLayer:
#     def merge(self, other: "ContextLayer") -> "ContextLayer": ...
#     def filter(self, predicate: Callable[[ContextFragment], bool]) -> "ContextLayer": ...
#     def compose(self, layers: List["ContextLayer"]) -> "ContextLayer": ...
```

### 优先级
P0→P3（Phase 2降级为简单Dict，Phase 3再引入代数操作）

## A3.0-20 跨项目统一规范架构 [来源：6份审核文档并集]

### 问题描述
6份审核文档一致指出跨项目规范不统一：变量引用3种语法（`${xxx}` / `{{xxx}}` / `$xxx`）、Agent命名空间冲突（同名Agent在不同项目无法区分）、状态输出3种语法（`state_updates` / `output_key` / `returns`）、错误处理不统一（有的用异常有的用dict）、检查点不统一（有的有有的没有）。

### 修订方案

```yaml
# 1. 变量引用统一语法
variable_reference:
  pattern: "${scope.name}"
  scopes:
    - state: "${state.xxx}"        # 运行时状态
    - params: "${params.xxx}"      # 任务参数
    - result: "${result.xxx}"      # 当前步骤结果
    - outputs: "${outputs.xxx.yyy}" # 其他步骤输出（步骤ID.字段名）

# 2. Agent命名空间：项目前缀:agent名
agent_namespace:
  pattern: "{project}:{agent_name}"
  examples:
    - "contentforge:topic"       # ContentForge选题Agent
    - "contentforge:writer"      # ContentForge写作Agent
    - "novelforge:outline"       # NovelForge大纲Agent
    - "devforge:coder"           # DevForge编码Agent
    - "mallforge:cs_agent"       # MallForge客服Agent
  resolution: "默认项目前缀可省略，跨项目引用必须带前缀"

# 3. 状态输出统一语法
state_output:
  pattern: "state_updates"
  syntax:
    state_updates:
      key: expression            # 统一用state_updates
  deprecated:
    - "output_key"               # 废弃，迁移到state_updates
    - "returns"                  # 废弃，迁移到state_updates

# 4. 执行策略统一
execution_policy:
  fields:
    timeout: int                 # 超时秒数
    retry: int                   # 重试次数
    on_error: str                # "fail" | "skip" | "fallback"
    on_anomaly: str              # "pause" | "log" | "ignore"
  example:
    execution_policy:
      timeout: 300
      retry: 3
      on_error: "fallback"
      on_anomaly: "pause"

# 5. 检查点统一
checkpoint:
  fields:
    enabled: bool
    backend: str                 # "sqlite" | "file" | "redis"
    path: str                    # 存储路径
    every_n_steps: int           # 每N步自动检查点
  example:
    checkpoint:
      enabled: true
      backend: "sqlite"
      path: "${config.data_dir}/checkpoints"
      every_n_steps: 5
```

### 优先级
P0

## A3.0-21 ProviderQuotaManager统一TPM/RPM/成本预算管理 [来源：审核doubao]

### 问题描述
当前无统一的TPM（Tokens Per Minute）/RPM（Requests Per Minute）/成本预算管理，多Agent并发调用时可能超出供应商配额导致限流或额外费用。

### 修订方案

```python
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from collections import defaultdict

@dataclass
class QuotaState:
    """配额状态"""
    tpm_used: int = 0
    rpm_used: int = 0
    cost_used: float = 0.0
    window_start: datetime = field(default_factory=datetime.now)

class ProviderQuotaManager:
    """供应商配额管理器 — TPM/RPM/成本预算"""

    def __init__(self, config: Dict[str, Any]):
        self._quotas: Dict[str, Dict] = config  # provider → quota配置
        self._states: Dict[str, Dict[str, QuotaState]] = defaultdict(dict)
        # _states[provider][model] → QuotaState

    async def check_tpm(self, provider: str, model: str) -> bool:
        """检查TPM配额是否可用"""
        state = self._get_state(provider, model)
        self._reset_if_expired(state)
        quota = self._quotas.get(provider, {}).get("tpm_quota", float("inf"))
        return state.tpm_used < quota

    async def check_rpm(self, provider: str, model: str) -> bool:
        """检查RPM配额是否可用"""
        state = self._get_state(provider, model)
        self._reset_if_expired(state)
        quota = self._quotas.get(provider, {}).get("rpm_quota", float("inf"))
        return state.rpm_used < quota

    async def check_budget(self, provider: str) -> bool:
        """检查成本预算是否可用"""
        total_cost = sum(s.cost_used for s in self._states.get(provider, {}).values())
        budget = self._quotas.get(provider, {}).get("daily_budget", float("inf"))
        return total_cost < budget

    async def record_usage(self, provider: str, model: str,
                           tokens: int, cost: float) -> None:
        """记录使用量"""
        state = self._get_state(provider, model)
        self._reset_if_expired(state)
        state.tpm_used += tokens
        state.rpm_used += 1
        state.cost_used += cost

    async def wait_for_quota(self, provider: str, model: str,
                             timeout: float = 30.0) -> bool:
        """等待配额可用（带超时）"""
        import asyncio
        start = time.time()
        while time.time() - start < timeout:
            if await self.check_tpm(provider, model) and \
               await self.check_rpm(provider, model) and \
               await self.check_budget(provider):
                return True
            await asyncio.sleep(1.0)
        return False

    def _get_state(self, provider: str, model: str) -> QuotaState:
        if model not in self._states[provider]:
            self._states[provider][model] = QuotaState()
        return self._states[provider][model]

    def _reset_if_expired(self, state: QuotaState) -> None:
        """1分钟窗口过期则重置"""
        if datetime.now() - state.window_start >= timedelta(minutes=1):
            state.tpm_used = 0
            state.rpm_used = 0
            state.window_start = datetime.now()
```

### 优先级
P1

## A3.0-22 Doubao moderation内容安全层架构 [来源：审核doubao]

### 问题描述
内容安全高风险域（新闻/财经/健康等）未集成Doubao moderation能力，存在合规风险。INF-08安全层的L5层需要具体实现方案。

### 修订方案

```python
from pydantic import BaseModel
from enum import Enum
from typing import List, Optional

class RiskLevel(str, Enum):
    """风险等级"""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

class ModerationResult(BaseModel):
    """内容审核结果"""
    passed: bool
    risk_level: RiskLevel
    risk_labels: List[str]       # ["violence", "politics", "adult"]
    confidence: float            # 0.0~1.0
    suggestion: Optional[str]    # 修改建议
    raw_response: Dict[str, Any] # Doubao原始响应

class DoubaoModerationLayer:
    """Doubao内容安全层 — INF-08 L5层实现"""

    # 高风险域必须过审
    HIGH_RISK_DOMAINS = {"news", "finance", "health", "politics", "education"}

    def __init__(self, llm_client: LLMClient, config: Dict[str, Any]):
        self.llm_client = llm_client
        self.strict_mode = config.get("strict_mode", True)  # fail-closed
        self.risk_threshold = config.get("risk_threshold", 0.7)

    async def moderate(self, content: str, domain: str = "",
                       context: Optional[Dict] = None) -> ModerationResult:
        """内容安全审核"""
        try:
            response = await self.llm_client.chat(
                model="doubao-seed2",
                messages=[{
                    "role": "system",
                    "content": "你是一个内容安全审核员，评估内容是否合规。"
                }, {
                    "role": "user",
                    "content": f"请审核以下内容的合规性：\n{content}"
                }],
                tools=[{
                    "type": "function",
                    "function": {
                        "name": "moderation_result",
                        "description": "内容审核结果",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "passed": {"type": "boolean"},
                                "risk_level": {"type": "string", "enum": ["low","medium","high","critical"]},
                                "risk_labels": {"type": "array", "items": {"type": "string"}},
                                "confidence": {"type": "number"},
                                "suggestion": {"type": "string"}
                            },
                            "required": ["passed", "risk_level", "risk_labels", "confidence"]
                        }
                    }
                }]
            )
            return self._parse_moderation_response(response, domain)
        except Exception as e:
            # fail-closed：审核失败默认拒绝
            if self.strict_mode:
                return ModerationResult(
                    passed=False, risk_level=RiskLevel.CRITICAL,
                    risk_labels=["moderation_error"],
                    confidence=1.0,
                    suggestion=f"审核服务异常，安全策略拒绝：{e}",
                    raw_response={"error": str(e)}
                )
            raise

    def _parse_moderation_response(self, response: Any, domain: str) -> ModerationResult:
        """解析审核响应"""
        # 高风险域降低通过阈值
        effective_threshold = self.risk_threshold
        if domain in self.HIGH_RISK_DOMAINS:
            effective_threshold = max(0.5, self.risk_threshold - 0.2)
        # ... 解析逻辑
```

### 优先级
P0

## A3.0-23 多模型级联架构 [来源：审核doubao]

### 问题描述
未明确以Doubao为主的级联策略，多模型之间缺乏primary/failover/default的统一编排机制。

### 修订方案

```yaml
# config/llm_route.yaml — 多模型级联配置
cascade_strategy:
  # 主链：Doubao优先
  primary_chain:
    - model: "doubao-seed2"
      provider: "openroute"
      role: "primary"
      conditions:
        json_schema: true        # 支持JSON Schema输出
        function_call: true      # 支持Function Call
        moderation: true         # 支持内容安全审核

  # 回退条件
  failover_conditions:
    - condition: "provider_unavailable"
      action: "next_in_chain"
    - condition: "rate_limited"
      action: "wait_and_retry"
      wait_seconds: 5
      max_retries: 3
    - condition: "timeout"
      action: "fallback_to_fast_model"
    - condition: "quality_below_threshold"
      action: "escalate_to_larger_model"

  # 回退链
  fallback_chain:
    - model: "qwen-plus"
      provider: "openroute"
      role: "fallback_1"
    - model: "deepseek-chat"
      provider: "openroute"
      role: "fallback_2"

  # 默认Agent覆盖：特定Agent使用指定模型
  default_agent_override:
    contentforge:topic: "doubao-seed2"     # 选题用Doubao
    contentforge:writer: "doubao-seed2"    # 写作用Doubao
    devforge:coder: "deepseek-chat"        # 编码用DeepSeek
    devforge:reviewer: "qwen-plus"         # 审查用Qwen
    novelforge:outline: "doubao-seed2"     # 大纲用Doubao
```

```python
class LLMCascadeRouter:
    """LLM级联路由器"""

    def __init__(self, config: Dict[str, Any], quota_manager: ProviderQuotaManager):
        self.config = config
        self.quota_manager = quota_manager

    async def route(self, agent_name: str, request: LLMRequest) -> LLMResponse:
        """级联路由：primary → failover → fallback"""
        # 1. 检查Agent覆盖
        override = self._get_agent_override(agent_name)
        if override:
            request.model = override

        # 2. 尝试primary
        try:
            if await self.quota_manager.check_tpm(request.model, request.provider):
                return await self._call_with_retry(request)
        except (ProviderUnavailableError, RateLimitError) as e:
            logger.warning(f"Primary模型失败: {e}")

        # 3. 尝试fallback链
        for fallback in self.config.get("fallback_chain", []):
            try:
                request.model = fallback["model"]
                request.provider = fallback["provider"]
                return await self._call_with_retry(request)
            except Exception as e:
                logger.warning(f"Fallback模型 {fallback['model']} 失败: {e}")
                continue

        raise AllModelsExhaustedError("所有模型均不可用")
```

### 优先级
P1

## A3.0-24 CAP-02 PermissionV2完善 — ASK超时/并发去重/审计日志 [来源：审核mm]

### 问题描述
Permission系统（ASK机制）存在3个缺失：1) ASK超时无默认行为，用户不响应时系统挂死；2) 并发ASK无去重，同一操作多次请求审批；3) 审批审计日志缺失，无法追溯。

### 修订方案

```python
from pydantic import BaseModel
from datetime import datetime, timedelta
from typing import Optional, Dict, Any

class ApprovalRequest(BaseModel):
    """审批请求"""
    request_id: str
    operation: str
    resource: str
    risk_level: str              # "low" | "medium" | "high"
    reason: str
    requested_at: datetime
    timeout_seconds: int = 300   # 默认5分钟超时
    dedup_key: Optional[str]     # 去重键（相同操作+资源）

class ApprovalResponse(BaseModel):
    """审批响应"""
    request_id: str
    approved: bool
    responder: str               # "user" | "timeout" | "auto_policy"
    responded_at: datetime
    reason: Optional[str] = None

class ApprovalAuditLog(BaseModel):
    """审批审计日志"""
    request_id: str
    operation: str
    resource: str
    risk_level: str
    approved: bool
    responder: str
    requested_at: datetime
    responded_at: datetime
    duration_seconds: float

class PermissionV2:
    """Permission V2 — ASK超时/并发去重/审计日志"""

    def __init__(self, event_store: EventStore, config: Dict[str, Any]):
        self.event_store = event_store
        self.timeout_default = config.get("ask_timeout_default", "deny")  # fail-closed
        self._pending: Dict[str, ApprovalRequest] = {}
        self._dedup_cache: Dict[str, str] = {}  # dedup_key → request_id
        self._audit_logs: List[ApprovalAuditLog] = []

    async def request_approval(self, request: ApprovalRequest) -> ApprovalResponse:
        """请求审批（带超时和去重）"""
        # 1. 并发去重：相同操作+资源复用已有审批
        if request.dedup_key and request.dedup_key in self._dedup_cache:
            existing_id = self._dedup_cache[request.dedup_key]
            if existing_id in self._pending:
                logger.info(f"审批请求去重: {request.dedup_key} → {existing_id}")
                return await self._wait_for_approval(existing_id, request.timeout_seconds)

        # 2. 记录待审批
        self._pending[request.request_id] = request
        if request.dedup_key:
            self._dedup_cache[request.dedup_key] = request.request_id

        # 3. 发送审批事件（WebSocket推送给用户）
        await self.event_store.append(SessionEvent(
            event_type="approval.requested",
            data=request.model_dump(),
        ))

        # 4. 等待审批（带超时）
        try:
            response = await self._wait_for_approval(
                request.request_id, request.timeout_seconds
            )
        except ApprovalTimeoutError:
            # fail-closed：超时默认DENY
            response = ApprovalResponse(
                request_id=request.request_id,
                approved=False,
                responder="timeout",
                responded_at=datetime.now(),
                reason=f"审批超时({request.timeout_seconds}s)，安全策略默认拒绝",
            )

        # 5. 记录审计日志
        self._audit_logs.append(ApprovalAuditLog(
            request_id=request.request_id,
            operation=request.operation,
            resource=request.resource,
            risk_level=request.risk_level,
            approved=response.approved,
            responder=response.responder,
            requested_at=request.requested_at,
            responded_at=response.responded_at,
            duration_seconds=(response.responded_at - request.requested_at).total_seconds(),
        ))

        # 6. 清理
        self._pending.pop(request.request_id, None)
        if request.dedup_key:
            self._dedup_cache.pop(request.dedup_key, None)

        return response

    async def _wait_for_approval(self, request_id: str,
                                  timeout: int) -> ApprovalResponse:
        """等待审批响应（子类实现具体等待机制）"""
        raise NotImplementedError
```

### 优先级
P0

## A3.0-25 事件总线统一架构 [来源：审核1]

### 问题描述
当前4套事件体系并存（EventStore + EventBus + AgentBus + SessionEventStream），职责重叠、语义混乱、事件丢失风险高。需要统一为单一事件架构。

### 修订方案

```python
from pydantic import BaseModel
from typing import Callable, Any, List, Dict
from enum import Enum

class EventPriority(str, Enum):
    """事件优先级"""
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    CRITICAL = "critical"

class DurableEvent(BaseModel):
    """持久化事件 — 统一事件模型"""
    event_id: str
    event_type: str              # "agent.completed" / "tool.called" / "gate.evaluated" ...
    source: str                  # 事件源（agent_id / tool_id / system）
    priority: EventPriority = EventPriority.NORMAL
    data: Dict[str, Any]
    trace_id: str
    session_id: str
    timestamp: datetime

class FlowForgeEventBus:
    """统一事件总线 — 合并4套事件体系"""

    def __init__(self, event_store: EventStore):
        self._store = event_store
        self._handlers: Dict[str, List[Callable]] = {}
        self._wildcard_handlers: List[Callable] = []  # 监听所有事件

    async def emit(self, event: DurableEvent) -> None:
        """发布事件（持久化+通知）"""
        # 1. 持久化到EventStore
        await self._store.append(SessionEvent(
            event_type=event.event_type,
            data=event.model_dump(),
        ))
        # 2. 通知订阅者
        handlers = self._handlers.get(event.event_type, [])
        for handler in handlers:
            try:
                await handler(event)
            except Exception as e:
                logger.error(f"事件处理器异常: {event.event_type}, {e}")
        # 3. 通知通配符订阅者
        for handler in self._wildcard_handlers:
            try:
                await handler(event)
            except Exception as e:
                logger.error(f"通配符处理器异常: {e}")

    def subscribe(self, event_type: str, handler: Callable) -> None:
        """订阅事件"""
        if event_type == "*":
            self._wildcard_handlers.append(handler)
        else:
            self._handlers.setdefault(event_type, []).append(handler)

    def unsubscribe(self, event_type: str, handler: Callable) -> None:
        """取消订阅"""
        if event_type == "*":
            self._wildcard_handlers = [h for h in self._wildcard_handlers if h != handler]
        else:
            self._handlers.get(event_type, []).remove(handler)

class AgentBus:
    """AgentBus — 桥接层，适配旧接口到统一EventBus"""

    def __init__(self, event_bus: FlowForgeEventBus):
        self._bus = event_bus

    async def agent_completed(self, agent_id: str, result: Any,
                               trace_id: str, session_id: str) -> None:
        """Agent完成事件（桥接到统一EventBus）"""
        await self._bus.emit(DurableEvent(
            event_id=str(uuid4()),
            event_type="agent.completed",
            source=agent_id,
            data={"result": result},
            trace_id=trace_id,
            session_id=session_id,
            timestamp=datetime.now(),
        ))

    async def tool_called(self, tool_name: str, args: Dict,
                           trace_id: str, session_id: str) -> None:
        """工具调用事件（桥接到统一EventBus）"""
        await self._bus.emit(DurableEvent(
            event_id=str(uuid4()),
            event_type="tool.called",
            source=tool_name,
            data={"args": args},
            trace_id=trace_id,
            session_id=session_id,
            timestamp=datetime.now(),
        ))
```

### 优先级
P1

---

## 上层 *Forge 项目声明式配置接入规则

### 核心原则

FlowForge 作为通用智能体框架底座，上层 *Forge 项目（ContentForge、DevForge、NovelForge、MallForge 等）**必须通过声明式配置接入**，禁止通过代码继承或强依赖引用接入。

### 接入方式

上层 *Forge 项目的 `config/` 目录下只能放置声明式配置文件（YAML），**禁止放置 .py 代码文件**。支持的标准子目录：

| 目录 | 用途 | 配置格式 |
|------|------|---------|
| config/agents/ | Agent 定义 | YAML（DeclarativeAgent 格式） |
| config/workflows/ | 工作流定义 | YAML（Workflow IR 格式） |
| config/loops/ | 循环模板 | YAML（LoopTemplate 格式） |
| config/sops/ | SOP 定义 | YAML |
| config/tools/ | 声明式工具 | YAML（HTTPTool/ScriptTool/TransformTool） |
| config/personas/ | Persona 配置 | YAML |
| config/gates/ | 门控配置 | YAML |
| config/quality_gates/ | 质量门配置 | YAML |
| config/evaluators/ | 评估器配置 | YAML |
| config/context_layers/ | 上下文层配置 | YAML |
| config/prompts/ | 提示词配置 | YAML |

### 自动发现机制

FlowForge 启动时通过 `auto_discover_plugins()` 自动扫描同级目录下的 *Forge 项目 config/ 目录，无需手动注册。支持的环境变量：
- `FLOWFORGE_AUTO_DISCOVER=true`（默认）：启用自动发现
- `FLOWFORGE_FORGE_DIRS=""`：自定义 *Forge 目录列表（逗号分隔）

### 禁止的接入方式

以下接入方式已对上层项目关闭，仅保留在 FlowForge 内部使用：
- ❌ 继承 `BaseTool` / `BaseAgent` / `StateQueryTool` 等内部基类
- ❌ 直接 import `flowforge.core.*` / `flowforge.tools.*` / `flowforge.app.*` 等内部模块
- ❌ 通过 `flowforge.app.deps.get_llm_client()` 等反向依赖获取服务实例

上层项目如需自定义工具逻辑，请通过以下方式：
1. **MCP Server**：实现 MCP 协议的 JSON-RPC 2.0 服务端，通过 `config/tools/*.yaml` 声明式配置注入
2. **声明式工具**：使用 HTTPTool/ScriptTool/TransformTool YAML 模板定义
3. **Plugin V2 钩子**：通过 `sdk.create_plugin()` 创建 AutoPlugin，自动扫描 config/ 目录

---

# 附录A: 2026-06-25 文档与代码一致性更新

> 来源：第十一轮文档与代码一致性深度审查（task.md 中 FW-CONSIST-001~029）
> 目的：将 arch.md 与 flowforge/ 实际代码目录结构对齐，修正 design.md 中 `engine/` 目录等历史偏差

## A.1 实际代码目录结构（2026-06-25 审计基线）

下图为 `flowforge/` 当前真实目录结构（与 design.md 第一章 1.1 节描述存在差异，差异项见 A.3）：

```
flowforge/
├── agents/
│   ├── generic/        # 22 个通用 Agent (analyst/approver/base/critic/deliverer/drafter/executor/
│   │                   #   fact_check/finalizer/generator/image_research/multilingual/planner/
│   │                   #   processor/react_actor/react_observer/react_thinker/refiner/
│   │                   #   research_agent/reviewer/trend_analysis/validator/verifier/web_search_agent)
│   └── declarative.py  # 声明式 Agent
├── app/
│   ├── api/endpoints/  # 24 个端点文件 (admin/agents/auth/dashboard/domain_plugins/graph/logs/
│   │                   #   loops/memory/metrics/modes/openroute/plans/plugins/prompts/review/
│   │                   #   schedules/settings/system/tasks/uploads/websocket/workflows/workspace)
│   ├── api/marketplace_api.py
│   ├── api/plugin_frontend_api.py
│   ├── api/plugin_management.py
│   ├── api/router.py
│   ├── deps.py
│   └── main.py
├── brain/
│   └── plan_generator.py
├── compiler/           # Workflow YAML Compiler（design.md 未描述，见 A.3）
│   ├── codegen.py
│   ├── compiler.py
│   ├── ir.py
│   ├── parser.py
│   ├── resume_adapter.py
│   └── validator.py
├── config/
│   ├── canary/
│   ├── evaluators/    # 8 个评估器 (business_value/code_quality/deploy_readiness/feasibility/
│   │                   #   release_risk/security/test_coverage/ux)
│   ├── gates/
│   ├── loops/
│   ├── marketplace/
│   ├── workflows/
│   ├── default.yaml
│   ├── layer_mapping.yaml
│   ├── llm_route.yaml
│   ├── logging.yaml
│   ├── models.yaml
│   ├── plugins.yaml
│   └── prompts.yaml
├── core/
│   ├── gate/          # 门控系统 (approval/models/orchestrator/registry/timeout/voting)
│   ├── interfaces/    # 接口定义 (helm_emitter/plugin/tools)
│   ├── agent_registry.py
│   ├── agent_timeout.py
│   ├── base_agent.py
│   ├── base_mode_executor.py
│   ├── base_tool.py
│   ├── canary.py
│   ├── channel_manager.py
│   ├── checkpoint_config.py
│   ├── checkpoint_manager.py
│   ├── circuit_breaker.py
│   ├── conditional_router.py
│   ├── config.py
│   ├── config_version.py
│   ├── content_moderation.py     # ContentModerationLayer（design.md 未描述，见 A.4）
│   ├── context_layer_manager.py
│   ├── credential_store.py
│   ├── declarative_agent.py
│   ├── declarative_tool.py       # DeclarativeTool（design.md 未描述，见 A.4）
│   ├── degradation.py            # DegradationDecisionTree（design.md 未描述，见 A.4）
│   ├── di.py
│   ├── errors.py
│   ├── event_bridge.py
│   ├── execution_policy.py
│   ├── fallback_chain.py
│   ├── feature_flags.py          # FeatureFlags（design.md 未描述，见 A.4）
│   ├── field_condition_gate.py
│   ├── flowforge.py
│   ├── guardrails.py
│   ├── handoff.py
│   ├── helm_adapter.py
│   ├── helm_ws_manager.py
│   ├── hooks.py
│   ├── marketplace.py
│   ├── mcp_integration.py
│   ├── metrics.py
│   ├── middlewares.py
│   ├── model_capability.py
│   ├── model_service.py
│   ├── namespace.py
│   ├── native_tool_server.py
│   ├── observability.py
│   ├── persona_injector.py
│   ├── persona_lock.py
│   ├── plugin.py
│   ├── plugin_frontend.py
│   ├── plugin_lifecycle.py
│   ├── plugin_manager.py
│   ├── plugin_packaging.py
│   ├── plugin_protocol.py        # FlowForgePlugin（见 A.5 接口清单）
│   ├── plugin_registry.py
│   ├── plugin_sandbox.py
│   ├── prompt_manager.py
│   ├── secret_store.py
│   ├── session_persistence.py
│   ├── state_mapper.py
│   ├── state_query_tool.py
│   ├── state_updates.py
│   ├── step_limiter.py
│   ├── task_context.py
│   ├── task_store.py
│   ├── tool_chain_executor.py
│   ├── tool_decorator.py
│   ├── tracing.py
│   ├── variable_resolver.py
│   ├── workflow_compiler.py
│   ├── workflow_compiler_parser.py
│   └── workflow_compiler_validator.py
├── docs/
│   ├── archive/       # 已归档老文件
│   ├── ARCHITECTURE_PRINCIPLES.md
│   ├── api.md
│   ├── arch.md        # 本文件
│   ├── design.md
│   ├── spec.md
│   ├── task.md
│   ├── test.md
│   └── loop.md
├── events/            # 事件总线（design.md 未描述，见 A.4）
│   ├── bridge.py
│   ├── durable_stream.py
│   ├── event_bus.py
│   ├── event_types.py
│   └── helm_adapter.py
├── executor/
│   ├── hybrid_executor.py
│   └── state_manager.py
├── harness/           # Harness 四根护栏（design.md 1.1 描述与实际不符，见 A.3）
│   ├── constraints/  # (linter_rules/linter_runner) — 实际仅 1 个子目录
│   ├── compaction.py  # （design.md 未描述，见 A.4）
│   ├── context_engine.py
│   ├── entropy_manager.py
│   ├── feedback_loop.py
│   ├── orchestrator.py
│   └── session_manager.py
├── llm/               # LLM 路由（design.md 未描述，见 A.4）
│   ├── call_event.py
│   ├── cascade.py
│   ├── provider.py
│   ├── provider_quota.py
│   ├── quota_manager.py
│   ├── route.py
│   └── router.py
├── loop/              # Loop 执行引擎（design.md 未独立描述，见 A.3）
│   ├── executor.py
│   ├── orchestrator.py
│   ├── parallel.py
│   ├── planner.py
│   ├── reflector.py
│   ├── registry.py
│   ├── result_extractor.py
│   ├── state.py
│   ├── turn_transition.py
│   └── verifier.py
├── mcp/               # MCP Broker
│   ├── broker.py
│   ├── client.py
│   ├── gateway.py
│   ├── server.py
│   └── tool_adapter.py
├── memory/
│   ├── stores/sqlite_store.py
│   ├── compressor.py
│   ├── episodic.py
│   ├── helm_db.py
│   ├── long_term.py
│   ├── mailbox.py
│   ├── manager.py
│   ├── semantic.py
│   ├── short_term.py
│   ├── task_board.py
│   └── working.py
├── middleware/
│   ├── auth.py
│   └── rate_limit.py
├── modes/             # 9 大执行模式（design.md 中误称为 engine/，见 A.3）
│   ├── agent_judge.py
│   ├── default_llm_actors.py
│   ├── graph_of_thoughts.py
│   ├── loop_mode.py
│   ├── multi_agent.py
│   ├── plan_execute.py
│   ├── react.py
│   ├── reflexion.py
│   ├── registry.py
│   ├── rewoo.py
│   ├── self_discover.py
│   ├── workflow.py
│   ├── workflow_chat.py
│   ├── workflow_context.py
│   ├── workflow_executor.py
│   ├── workflow_graph.py
│   ├── workflow_react.py
│   ├── workflow_tools.py
│   └── workflow_validator.py
├── observability/
│   ├── alerts.py
│   ├── metrics_collector.py
│   └── tracer.py
├── scheduler/
│   └── scheduler.py
├── security/          # 安全权限
│   ├── arch_constraint.py
│   ├── moderation.py
│   ├── permission_pipeline.py
│   └── permission_v2.py    # （design.md 未描述，见 A.4）
├── services/
│   └── openroute_service.py
├── session/
│   └── event_store.py
├── skills/
│   ├── base.py
│   ├── combo.py
│   ├── loader.py
│   └── manager.py
├── tools/             # 50+ 通用工具
│   ├── llm/           # LLM 相关工具
│   ├── agentic_rag.py
│   ├── agentic_rag_core.py
│   ├── chapter_write_saga.py
│   ├── cicd_trigger.py
│   ├── code_quality.py
│   ├── llm_client.py
│   ├── opensieve_client.py  # OpenSieve 客户端
│   ├── publish.py
│   ├── publish_engine.py
│   ├── web_search.py
│   └── ... (50+ 个工具)
├── web/               # Next.js 前端
└── sdk.py             # FlowForge SDK 入口
```

## A.2 design.md 中 `engine/` 目录的修正说明

design.md 第一章 1.1 节描述的 `engine/` 目录在 flowforge 实际代码中**不存在**，相关职责被拆分到以下三个目录：

| design.md 描述（engine/） | 实际位置 | 说明 |
|--------------------------|---------|------|
| `engine/hybrid_executor.py` | `executor/hybrid_executor.py` | HybridExecutor 迁移到独立 executor/ 目录 |
| `engine/defense_layer.py` | （拆分） | L1/L2/L3 防御机制分别下沉到 `core/agent_timeout.py`、`core/base_mode_executor.py`、`modes/workflow.py` |
| `engine/agent_registry.py` | `core/agent_registry.py` | 回归到 core/ 共享内核 |
| `engine/mode_registry.py` | `modes/registry.py` | 与 9 大模式实现同目录 |
| `engine/scheduler.py` | `scheduler/scheduler.py` | 独立为顶级目录 |
| `engine/state_manager.py` | `executor/state_manager.py` | 与 HybridExecutor 同目录 |
| `engine/sub_agent_engine.py` | （已合并） | SubAgent 逻辑下沉到 `modes/multi_agent.py` |
| `engine/trajectory_pipeline.py` | （已合并） | 轨迹记录逻辑由 `observability/tracer.py` + `session/event_store.py` 承担 |

**结论**：design.md 中"3. 执行引擎层 (Engine Layer)"在代码中实际由 `executor/` + `modes/` + `loop/` + `scheduler/` 共同承担，不存在单一的 `engine/` 目录。详见 design.md 附录"2026-06-25 设计修正"。

## A.3 harness/ 实际子目录与文档差异

design.md 第一章 1.1 节描述 harness/ 包含 4 个子目录（context/constraints/feedback/entropy，共 14 个文件），但实际代码中 harness/ **没有子目录嵌套**，所有文件平铺在 harness/ 根下，且文件集合与文档不一致：

| design.md 描述 | 实际文件 | 差异说明 |
|--------------|---------|---------|
| `harness/__init__.py`（HarnessOrchestrator） | `harness/orchestrator.py` | Orchestrator 独立成文件，未放在 `__init__.py` |
| `harness/context/context_engine.py` | `harness/context_engine.py` | 平铺，未建 context/ 子目录 |
| `harness/context/session_manager.py` | `harness/session_manager.py` | 平铺 |
| `harness/constraints/arch_constraint_engine.py` | （迁移到 `security/arch_constraint.py`） | 架构约束下沉到 security/ |
| `harness/constraints/linter_rules.py` | `harness/constraints/linter_rules.py` | 仅此子目录保留 |
| `harness/constraints/linter_runner.py` | `harness/constraints/linter_runner.py` | 仅此子目录保留 |
| `harness/feedback/feedback_loop.py` | `harness/feedback_loop.py` | 平铺 |
| `harness/feedback/verification_hooks.py` | （未实现） | 设计中 |
| `harness/entropy/entropy_manager.py` | `harness/entropy_manager.py` | 平铺 |
| `harness/entropy/doc_gardener.py` | （未实现） | 设计中 |
| `harness/entropy/debt_tracker.py` | （未实现） | 设计中 |
| `harness/entropy/rule_evolution.py` | （未实现） | 设计中 |
| —（design.md 未描述） | `harness/compaction.py` | **新增**：DualThresholdCompactor 实现 |
| —（design.md 未描述） | `harness/context_engine.py` 中的 ContextEngine | 实际为独立模块 |

**实际 harness/ 内容**：`constraints/`（仅 linter_rules + linter_runner）、`compaction.py`、`context_engine.py`、`entropy_manager.py`、`feedback_loop.py`、`orchestrator.py`、`session_manager.py`，共 7 个文件（不含 __init__.py / __pycache__）。

## A.4 新增模块说明（design.md 未覆盖）

以下模块在实际代码中已实现，但 design.md 第一/十七章未描述：

| 模块 | 路径 | 职责 | 关联审查问题 |
|------|------|------|------------|
| **events/** | `events/` (5 文件) | 事件总线 + DurableEventStream + Helm 桥接 | FW-CONSIST-006 |
| │ ├── `event_bus.py` | 同步 EventBus（emit + subscribe + asyncio.ensure_future） | |
| │ ├── `durable_stream.py` | WAL 模式持久化事件流（CAP-11 DurableEventStream） | |
| │ ├── `event_types.py` | 事件类型枚举（17 种 FlowForge 事件） | |
| │ ├── `helm_adapter.py` | EventBus → Helm WS 事件桥接（16 种 Helm 事件映射） | |
| │ └── `bridge.py` | 跨项目事件桥接（OpenSieve/NovelForge） | |
| **llm/** | `llm/` (7 文件) | LLM 路由层（替代 design.md 描述的 `tools/llm_client.py` 单 Provider） | FW-CONSIST-007 |
| │ ├── `router.py` | LLMRouter（主备切换 + 健康检查） | |
| │ ├── `cascade.py` | 多模型级联策略（doubao→qwen→deepseek） | |
| │ ├── `provider.py` | Provider 抽象（OpenAI 兼容） | |
| │ ├── `provider_quota.py` | Provider 级 TPM/RPM/成本配额 | |
| │ ├── `quota_manager.py` | ProviderQuotaManager（S3.0-13） | |
| │ ├── `route.py` | 路由策略实现 | |
| │ └── `call_event.py` | LLMCallEvent dataclass（附录 J.2） | |
| **compiler/** | `compiler/` (6 文件) | Workflow YAML Compiler 三阶段拆分（S3.0-19） | FW-CONSIST-003 |
| │ ├── `parser.py` | YAML → IR 解析器 | |
| │ ├── `validator.py` | IR 校验器（含 asteval 安全表达式） | |
| │ ├── `ir.py` | 编译中间产物（CompiledWorkflow IR） | |
| │ ├── `codegen.py` | IR → 可执行 Workflow 代码生成 | |
| │ ├── `compiler.py` | 三阶段编排入口 | |
| │ └── `resume_adapter.py` | 检查点恢复适配器 | |
| **core/feature_flags.py** | `core/feature_flags.py` | FeatureFlag dataclass + 灰度开关（spec 附录 v2.2 第一章） | FW-CONSIST-008 |
| **core/declarative_tool.py** | `core/declarative_tool.py` | DeclarativeTool 基类（HTTPTool/ScriptTool/TransformTool 的父类） | FW-CONSIST-009 |
| **core/content_moderation.py** | `core/content_moderation.py` | ContentModerationLayer（Doubao moderation 统一内容安全层，S3.0-14） | FW-CONSIST-010 |
| **core/degradation.py** | `core/degradation.py` | DegradationDecisionTree（spec v2.2 第三章灾备降级） | FW-CONSIST-011 |
| **harness/compaction.py** | `harness/compaction.py` | DualThresholdCompactor（S3.0-21 死循环防护） | FW-CONSIST-012 |
| **security/permission_v2.py** | `security/permission_v2.py` | PermissionV2 增强版（ASK 超时/并发去重/审计日志，S3.0-9） | FW-CONSIST-013 |
| **loop/** | `loop/` (10 文件) | Loop 执行引擎（与 modes/ 平行的独立引擎） | FW-CONSIST-014 |
| │ ├── `executor.py` | LoopExecutor（5 步闭环 Discover→Assign→Act→Verify→Persist） | |
| │ ├── `orchestrator.py` | Loop 编排器 | |
| │ ├── `verifier.py` | MultiJudgeVerifier（3 评委并行） | |
| │ ├── `planner.py` | Loop 规划器 | |
| │ ├── `reflector.py` | 反思器 | |
| │ ├── `parallel.py` | 并行执行（asyncio.gather，待升级为 FiberSet） | |
| │ ├── `registry.py` | Loop 注册中心 | |
| │ ├── `result_extractor.py` | 结果提取器 | |
| │ ├── `state.py` | LoopPhase 7 状态机 | |
| │ └── `turn_transition.py` | TurnTransitionEngine（9 状态合并） | |

## A.5 PluginProtocol 完整接口清单（FW-CONSIST-001/002 验证）

实际 `core/plugin_protocol.py` 中 `FlowForgePlugin` 类提供的注册钩子共 **19 个**（不含 lifecycle 钩子）：

| # | 方法名 | 参数 | 状态 |
|---|--------|------|------|
| 1 | `register_middleware` | app | ✅ 已实现 |
| 2 | `register_agents` | agent_registry | ✅ 已实现 |
| 3 | `register_tools` | tool_registry | ✅ 已实现 |
| 4 | `register_modes` | mode_registry | ✅ 已实现 |
| 5 | `register_routes` | app | ✅ 已实现 |
| 6 | `register_event_handlers` | event_bus | ✅ 已实现 |
| 7 | `register_schedules` | scheduler | ✅ 已实现 |
| 8 | `register_workflows` | workflow_registry | ✅ 已实现（V2） |
| 9 | `register_gates` | gate_registry | ✅ 已实现（V2） |
| 10 | `register_evaluators` | registry | ✅ 已实现（V2） |
| 11 | `register_sops` | sop_registry | ✅ 已实现（V2） |
| 12 | `register_quality_gates` | quality_gate_registry | ✅ 已实现（V2） |
| 13 | `register_context_layers` | context_registry | ✅ 已实现（V2） |
| 14 | `register_workflow_step_handler` | handler_registry | ✅ 已实现（V2） |
| 15 | `register_loops` | loop_registry | ✅ 已实现（V2） |
| 16 | `register_personas` | persona_registry | ✅ 已实现 |
| 17 | `register_prompts` | prompt_manager | ✅ 已实现 |
| 18 | `register_declarative_tools` | tool_registry | ✅ 已实现 |
| 19 | `register_service` (PluginContext) | name, service | ✅ 已实现（PluginContext） |

**FW-CONSIST-001 验证结论**：`register_helm_handlers` 方法 **代码缺失**，需补充实现（已在 task.md FW-CONSIST-001 记录）。StockForge v2.0 审核修正（见 spec.md 末尾）声称"Plugin 钩子修正为 V2 协议（register_workflows/register_gates/register_schedules/register_evaluators/register_helm_handlers）"，但实际代码中 `register_helm_handlers` 未定义。

**FW-CONSIST-002 验证结论**：`register_permission_policy` 方法 **代码缺失**，需补充实现（已在 task.md FW-CONSIST-002 记录）。当前权限策略只能通过 `register_gates` 或在 `register_routes` 中手动挂载 PermissionPipeline 实现，缺少专用钩子。

## A.6 与 design.md 第十七章的差异对照

design.md 第十七章"v6.0 目录结构完整清单"与实际代码的差异：

| 模块 | design.md 文件数 | 实际文件数 | 差异 |
|------|----------------|----------|------|
| core/ | 9 | 60+ | 实际远超文档（含 gate/、interfaces/ 子目录及大量新模块） |
| engine/ | 7 | 0 | **目录不存在**，拆分为 executor/+modes/+loop/+scheduler/ |
| harness/ | 14 | 7 | 实际仅 7 个文件，无 context/feedback/entropy 子目录 |
| security/ | 7 | 4 | 实际 4 个文件，design.md 多列了 action_classifier/secure_tool_registry/sandbox/path_validator/audit_trail |
| skills/ | 10+ | 4 | 实际 4 个文件（base/combo/loader/manager），无 adapters/ 子目录 |
| mcp/ | 5 | 5 | 一致（实际多一个 server.py，少 config.py） |
| tools/ | ~20 | 50+ | 实际工具数远超文档 |
| memory/ | 12 | 11 | 基本一致（实际多 helm_db.py，少 checkpoint_manager.py 已合并到 core/checkpoint_manager.py） |
| events/ | 4 | 5 | 实际多 bridge.py |
| modes/ | 11 | 18 | 实际多 loop_mode/workflow_chat/workflow_context/workflow_executor/workflow_graph/workflow_react/workflow_tools/workflow_validator |
| agents/ | 32+ | 22+1 | generic/ 实际 22 个 Agent + declarative.py（design.md 列 17 个，缺 fact_check/image_research/multilingual/research_agent/trend_analysis/web_search_agent） |
| workflows/ | 8 | 0 | **目录不存在**，已迁移到 `config/workflows/` |
| plugins/ | 3 | 0 | **目录不存在**，已迁移到 `core/plugin_*.py` 系列 |
| observability/ | 4 | 3 | 实际 3 个文件，design.md 多列 dashboard.py |
| api/ | 12+ | 24 | 实际 24 个端点文件（见 api.md 附录） |

## A.7 修正后目录结构原则

1. **engine/ 不再使用**：所有执行相关代码归入 `executor/`（HybridExecutor+StateManager）、`modes/`（9 大模式）、`loop/`（Loop 引擎）、`scheduler/`（定时调度）
2. **harness/ 平铺优先**：除 `constraints/` 保留子目录外，其余文件平铺在 harness/ 根下
3. **配置与代码分离**：`workflows/` 目录已迁移到 `config/workflows/`，`plugins/` 已迁移到 `core/plugin_*.py`
4. **新增模块独立目录**：`events/`、`llm/`、`compiler/`、`loop/` 均为独立顶级目录，不挂在 core/ 下

> 本附录为文档与代码一致性更新的快照，后续代码演进时需同步更新本附录。所有差异项的修复任务详见 task.md FW-CONSIST-001~029。
