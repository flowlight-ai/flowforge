# FlowForge v6.0 详细设计说明书

> **对应架构文档**：FlowForge v6.0 架构设计
> **对应规格文档**：FlowForge v6.0 功能特性规格说明书
> **状态**：v6.0 正式版，合并 v2.0 + v5.0 全部内容并新增 Harness/Skill/MCP 模块
> **日期**：2026-05-12

***

## 第一章：项目骨架与目录结构

### 1.1 项目目录（v6.0）

```
flowforge/
├── core/                          # 共享内核（纯接口定义）
│   ├── __init__.py
│   ├── base_agent.py              # BaseAgent, AgentInput, AgentOutput
│   ├── base_tool.py               # BaseTool, ToolInput, ToolOutput（含 safety_level）
│   ├── base_mode_executor.py      # BaseModeExecutor（含 _on_enter/_on_exit 生命周期钩子）
│   ├── task_context.py            # TaskContext（含 harness_enabled 标志）
│   ├── di.py                      # 轻量 DI 容器
│   ├── errors.py                  # 统一异常层次
│   ├── config.py                  # YAML 配置加载器 (pydantic-settings)
│   ├── tracing.py                 # trace_id 注入与日志
│   └── metrics.py                 # Prometheus 指标
│
├── engine/                        # 执行引擎层
│   ├── __init__.py
│   ├── hybrid_executor.py         # HybridExecutor（含 Harness Hook 点）
│   ├── defense_layer.py           # 三层防御（L1超时/L2重复检测/L3自修正）
│   ├── agent_registry.py          # Agent 注册中心
│   ├── mode_registry.py           # 模式注册中心
│   ├── scheduler.py               # APScheduler 定时调度
│   └── state_manager.py           # SQLite 状态持久化
│
├── harness/                       # Harness 驾驭层（v6.0 新增）
│   ├── __init__.py                # HarnessOrchestrator（统一入口）
│   ├── context/                   # 上下文工程
│   │   ├── __init__.py
│   │   ├── context_engine.py      # AGENTS.md 注入 + 会话交接
│   │   └── session_manager.py     # 会话管理器（压缩/截断/持久化）
│   ├── constraints/               # 架构约束
│   │   ├── __init__.py
│   │   ├── arch_constraint_engine.py  # 分层依赖检测引擎
│   │   ├── linter_rules.py        # Linter 规则定义
│   │   └── linter_runner.py       # Linter 执行器
│   ├── feedback/                  # 反馈循环
│   │   ├── __init__.py
│   │   ├── feedback_loop.py       # 独立评判 + 四维评分 + 分类闸门
│   │   └── verification_hooks.py  # 后台验证钩子
│   └── entropy/                   # 熵管理
│       ├── __init__.py
│       ├── entropy_manager.py     # 熵管理器
│       ├── doc_gardener.py        # 文档园丁
│       ├── debt_tracker.py        # 技术债跟踪器
│       └── rule_evolution.py      # 规则进化器
│
├── security/                      # 安全体系
│   ├── __init__.py
│   ├── permission_pipeline.py     # 三层权限管线 deny→ask→allow
│   ├── action_classifier.py       # 动作分级器 Read/Suggest/Prepare/Execute
│   ├── secure_tool_registry.py    # 安全工具注册表
│   ├── sandbox.py                 # 沙箱执行器
│   ├── path_validator.py          # 路径穿越防护
│   └── audit_trail.py             # 审计追踪
│
├── skills/                        # Skill 系统（v6.0 新增）
│   ├── __init__.py
│   ├── registry.py                # SkillRegistry（双层加载 + 置信度匹配）
│   ├── loader.py                  # Skill 加载器
│   ├── adapters/                  # 格式适配器
│   │   ├── __init__.py
│   │   ├── base.py                # SkillAdapter 基类
│   │   ├── flowforge.py           # FlowForge 原生格式
│   │   ├── claude_code.py         # Claude Code 格式
│   │   ├── anthropic.py           # Anthropic 格式
│   │   └── trae_cn.py             # Trae CN 格式
│   └── combo/                     # Combo Skills
│       ├── __init__.py
│       └── combo_engine.py        # 声明式 YAML 管道编排
│
├── mcp/                           # MCP 模块（v6.0 新增）
│   ├── __init__.py
│   ├── client.py                  # MCP Client（JSON-RPC 2.0）
│   ├── gateway.py                 # MCP Gateway（权限+预算+限流+流式）
│   ├── broker.py                  # MCP Broker（多服务器聚合+索引+熔断）
│   ├── tool_adapter.py            # MCP Tool → BaseTool 转换
│   └── config.py                  # MCP 配置管理
│
├── tools/                         # 工具层
│   ├── __init__.py
│   ├── builtin/                   # 内置工具
│   │   ├── __init__.py
│   │   ├── llm_client.py          # 统一 LLM 客户端
│   │   ├── web_search.py          # 网络搜索
│   │   ├── tavily_search.py       # Tavily 搜索
│   │   ├── duckduckgo_search.py   # DuckDuckGo 搜索
│   │   ├── web_scraper.py         # 网页抓取
│   │   ├── python_executor.py     # Python 沙箱执行
│   │   ├── file_rw.py             # 文件读写
│   │   ├── shell_command.py       # Shell 命令
│   │   ├── cache.py               # 缓存工具
│   │   ├── pexels_image.py        # Pexels 图片
│   │   ├── sendgrid_mail.py       # SendGrid 邮件
│   │   └── webhook.py             # Webhook 通知
│   ├── adapters/                  # 协议适配器
│   │   ├── __init__.py
│   │   ├── mcp_adapter.py         # MCP 协议适配
│   │   ├── openapi_adapter.py     # OpenAPI 协议适配
│   │   └── graphql_adapter.py     # GraphQL 协议适配
│   └── publish/                   # 发布工具
│       ├── __init__.py
│       ├── wechat_publisher.py    # 微信公众号
│       ├── toutiao_publisher.py   # 头条
│       └── local_publish.py       # 本地发布
│
├── memory/                        # 记忆层
│   ├── __init__.py
│   ├── manager.py                 # MemoryManager
│   ├── working.py                 # 工作记忆
│   ├── short_term.py              # 短期记忆
│   ├── long_term.py               # 长期记忆
│   ├── semantic.py                # 语义记忆
│   ├── episodic.py                # 情景记忆
│   ├── compressor.py              # ContextCompressor
│   ├── task_board.py              # TaskBoard（原子认领）
│   ├── mailbox.py                 # Mailbox（四级优先级 + TTL）
│   ├── checkpoint_manager.py      # CheckpointManager
│   └── stores/
│       ├── __init__.py
│       └── sqlite_store.py        # SQLite 存储后端
│
├── events/                        # 事件系统
│   ├── __init__.py
│   ├── event_bus.py               # EventBus
│   ├── event_types.py             # 事件类型定义
│   └── helm_adapter.py            # EventBus → Helm 事件桥接
│
├── modes/                         # 模式执行器
│   ├── __init__.py
│   ├── registry.py                # ModeRegistry
│   ├── react.py
│   ├── plan_execute.py
│   ├── reflexion.py
│   ├── default_llm_actors.py
│   ├── multi_agent.py             # 三策略：Subagents/Teams/Swarms
│   ├── workflow.py
│   ├── graph_of_thoughts.py
│   ├── rewoo.py
│   ├── self_discover.py
│   └── agent_judge.py
│
├── agents/                        # 专家执行层
│   ├── __init__.py
│   ├── generic/                   # 17 个通用 Agent
│   │   ├── __init__.py
│   │   ├── base.py
│   │   ├── analyst.py
│   │   ├── approver.py
│   │   ├── critic.py
│   │   ├── deliverer.py
│   │   ├── drafter.py
│   │   ├── executor.py
│   │   ├── finalizer.py
│   │   ├── generator.py
│   │   ├── planner.py
│   │   ├── processor.py
│   │   ├── react_actor.py
│   │   ├── react_observer.py
│   │   ├── react_thinker.py
│   │   ├── refiner.py
│   │   ├── reviewer.py
│   │   ├── validator.py
│   │   └── verifier.py
│   ├── topic_research.py
│   ├── material_collection.py
│   ├── article_writing.py
│   ├── seo_optimization.py
│   ├── fact_check.py
│   ├── content_audit.py
│   ├── headline_optimizer.py
│   ├── content_repurposer.py
│   ├── trend_analysis.py
│   ├── publishing.py
│   ├── image_research.py
│   ├── multilingual.py
│   ├── research_agent.py
│   ├── web_search_agent.py
│   └── code_writer_agent.py
│
├── workflows/                     # Workflow YAML 模板
│   ├── deep_article.yaml
│   ├── quick_post.yaml
│   ├── trend_article.yaml
│   ├── multi_platform.yaml
│   ├── seo_content.yaml
│   ├── image_article.yaml
│   ├── multilingual.yaml
│   └── report_generation.yaml
│
├── plugins/                       # 插件系统
│   ├── __init__.py
│   ├── plugin_manager.py          # PluginManager
│   └── hooks_registry.py          # Hooks 注册中心
│
├── observability/                 # 可观测性（v6.0 新增）
│   ├── __init__.py
│   ├── tracing.py                 # OpenTelemetry 追踪
│   ├── metrics.py                 # Prometheus 指标
│   ├── dashboard.py               # 仪表盘数据
│   └── alerts.py                  # 告警规则
│
├── app/                           # FastAPI 应用层
│   ├── __init__.py
│   ├── main.py
│   ├── deps.py
│   └── api/
│       ├── __init__.py
│       ├── router.py
│       └── endpoints/
│           ├── __init__.py
│           ├── tasks.py
│           ├── agents.py
│           ├── review.py
│           ├── websocket.py
│           └── ...（20 个端点模块）
│
├── config/                        # 配置文件
│   ├── default.yaml               # 默认系统配置
│   ├── models.yaml                # 模型供应商配置
│   ├── prompts.yaml               # 提示词模板
│   ├── harness_v6.yaml            # Harness 配置（v6.0 新增）
│   ├── layer_mapping.yaml         # 架构层映射（v6.0 新增）
│   └── workflows/                 # 通用 Workflow YAML
│
├── web/                           # 前端（Next.js 14）
│   └── ...
│
└── tests/                         # 测试
    ├── unit/
    ├── integration/
    └── conftest.py
```

### 1.2 pyproject.toml

```toml
[build-system]
requires = ["setuptools>=68.0", "wheel"]
build-backend = "setuptools.backends._legacy:_Backend"

[project]
name = "flowforge"
version = "6.0.0"
description = "AI Agent Harness Platform — 为 AI Agent 提供约束、反馈、上下文管理与熵控制的完整控制论系统"
readme = "README.md"
license = {text = "MIT"}
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.110",
    "uvicorn[standard]>=0.29",
    "pydantic>=2.0",
    "pydantic-settings>=2.0",
    "pyyaml>=6.0",
    "httpx>=0.27",
    "sqlalchemy>=2.0",
    "aiosqlite>=0.20",
    "tiktoken>=0.7",
    "psutil>=5.9",
    "apscheduler>=3.10",
    "prometheus-client>=0.20",
    "opentelemetry-api>=1.20",
    "opentelemetry-sdk>=1.20",
]

[project.optional-dependencies]
search = ["tavily-python>=0.3", "duckduckgo-search>=4.0"]
publish = ["wechatter>=0.5"]
image = ["pexels-api>=1.0"]
email = ["sendgrid>=6.10"]
mcp = ["mcp>=0.9"]
all = ["flowforge[search,publish,image,email,mcp]"]

[project.entry-points."flowforge.modes"]
react = "flowforge.modes.react:ReActExecutor"
plan_execute = "flowforge.modes.plan_execute:PlanExecuteExecutor"
reflexion = "flowforge.modes.reflexion:ReflexionExecutor"
multi_agent = "flowforge.modes.multi_agent:MultiAgentExecutor"
workflow = "flowforge.modes.workflow:WorkflowExecutor"
graph_of_thoughts = "flowforge.modes.graph_of_thoughts:GraphOfThoughtsExecutor"
rewoo = "flowforge.modes.rewoo:ReWOOExecutor"
self_discover = "flowforge.modes.self_discover:SelfDiscoverExecutor"
agent_judge = "flowforge.modes.agent_judge:AgentJudgeExecutor"

[project.entry-points."flowforge.plugins"]
# 用户自定义插件入口点
```

***

## 第二章：核心接口详细设计

### 2.1 BaseAgent

```python
from abc import ABC, abstractmethod
from pydantic import BaseModel, Field
from typing import Any, Optional

class AgentInput(BaseModel):
    """Agent 统一输入"""
    task: str = Field(..., description="任务描述")
    context: dict[str, Any] = Field(default_factory=dict, description="上下文数据")
    metadata: dict[str, Any] = Field(default_factory=dict, description="元数据")

class AgentOutput(BaseModel):
    """Agent 统一输出"""
    result: dict[str, Any] = Field(default_factory=dict, description="执行结果")
    status: str = Field(default="success", description="执行状态: success/partial/failure")
    metadata: dict[str, Any] = Field(default_factory=dict, description="输出元数据")
    state_updates: dict[str, Any] = Field(default_factory=dict, description="状态更新（通过此字段修改 State）")

class BaseAgent(ABC):
    """Agent 基类 — 所有 Agent 必须继承此类"""

    def __init__(self, name: str, tools: list | None = None, config: dict | None = None):
        self.name = name
        self.tools = tools or []
        self.config = config or {}

    @abstractmethod
    async def execute(self, input: AgentInput) -> AgentOutput:
        """执行 Agent 任务（子类必须实现）"""
        ...

    async def execute_with_context(self, input: AgentInput, ctx: 'TaskContext') -> AgentOutput:
        """带上下文的执行（可选覆写，默认调用 execute）"""
        return await self.execute(input)
```

### 2.2 BaseTool

```python
from enum import Enum
from abc import ABC, abstractmethod

class SafetyLevel(str, Enum):
    """工具安全等级"""
    READONLY = "readonly"   # 只读操作，无副作用
    NORMAL = "normal"   # 有副作用但可逆
    DANGEROUS = "dangerous" # 不可逆操作，需审批

class ToolInput(BaseModel):
    """工具统一输入"""
    params: dict[str, Any] = Field(default_factory=dict)

class ToolOutput(BaseModel):
    """工具统一输出"""
    result: Any = Field(None, description="执行结果")
    error: str | None = Field(None, description="错误信息")
    metadata: dict[str, Any] = Field(default_factory=dict)

class BaseTool(ABC):
    """工具基类 — 所有工具必须继承此类"""

    # v5.0 新增：安全标记
    safety_level: SafetyLevel = SafetyLevel.SAFE
    is_concurrency_safe: bool = True

    def __init__(self, name: str, description: str = "", config: dict | None = None):
        self.name = name
        self.description = description
        self.config = config or {}

    @abstractmethod
    async def execute(self, input: ToolInput) -> ToolOutput:
        """执行工具（子类必须实现）"""
        ...
```

### 2.3 TaskContext

```python
class TaskContext:
    """任务上下文 — 贯穿整个任务生命周期"""

    def __init__(
        self,
        task_id: str,
        mode: str = "react",
        persona: str | None = None,
        state: dict | None = None,
        tools: list[BaseTool] | None = None,
        agents: dict[str, type[BaseAgent]] | None = None,
        event_bus: 'EventBus' | None = None,
        harness_enabled: bool = False,  # v6.0 新增：Harness 灰度开关
    ):
        self.task_id = task_id
        self.mode = mode
        self.persona = persona
        self.state = state or {}
        self.tools = tools or []
        self.agents = agents or {}
        self.event_bus = event_bus
        self.harness_enabled = harness_enabled  # v6.0
        self.metadata: dict[str, Any] = {}
        self.parent_id: str | None = None

    @classmethod
    def from_parent(cls, parent: 'TaskContext', **overrides) -> 'TaskContext':
        """创建子上下文：state 深拷贝隔离，tools/agents/event_bus 共享引用"""
        import copy
        defaults = {
            "task_id": f"{parent.task_id}_sub",
            "mode": parent.mode,
            "persona": parent.persona,
            "state": copy.deepcopy(parent.state),  # 深拷贝隔离
            "tools": parent.tools,                  # 共享引用
            "agents": parent.agents,                # 共享引用
            "event_bus": parent.event_bus,           # 共享引用
            "harness_enabled": parent.harness_enabled,  # v6.0 继承
        }
        defaults.update(overrides)
        ctx = cls(**defaults)
        ctx.parent_id = parent.task_id
        return ctx
```

### 2.4 BaseModeExecutor（含 v5.0 生命周期钩子）

```python
class BaseModeExecutor(ABC):
    """模式执行器基类 — 所有模式执行器必须继承此类"""

    def __init__(self, agent_registry: 'AgentRegistry', tool_registry: 'ToolRegistry', config: dict | None = None):
        self.agent_registry = agent_registry
        self.tool_registry = tool_registry
        self.config = config or {}

    @abstractmethod
    async def execute(self, input: AgentInput, ctx: TaskContext) -> AgentOutput:
        """执行模式（子类必须实现）"""
        ...

    # v5.0 新增：生命周期钩子
    async def _on_enter(self, ctx: TaskContext) -> None:
        """进入模式时触发 — L2 重复检测入口"""
        pass

    async def _on_exit(self, ctx: TaskContext, output: AgentOutput) -> None:
        """退出模式时触发 — L2 重复检测出口"""
        pass
```

### 2.5 统一异常层次

```python
class FlowForgeError(Exception):
    """FlowForge 基础异常"""
    def __init__(self, message: str, context: dict | None = None):
        super().__init__(message)
        self.context = context or {}

class AgentTimeoutError(FlowForgeError):
    """Agent 执行超时"""
    pass

class ToolExecutionError(FlowForgeError):
    """工具执行失败"""
    pass

class SafetyViolationError(FlowForgeError):
    """安全违规（v5.0 新增）"""
    pass

class HarnessViolationError(FlowForgeError):
    """Harness 约束违规（v6.0 新增）"""
    pass

class CompactionThresholdExceeded(FlowForgeError):
    """上下文压缩阈值超限（v6.0 新增）"""
    pass
```

***

## 第三章：依赖注入容器

```python
class DIContainer:
    """轻量依赖注入容器"""

    def __init__(self):
        self._singletons: dict[str, Any] = {}
        self._agent_factories: dict[str, Callable] = {}

    def register_singleton(self, name: str, instance: Any) -> None:
        self._singletons[name] = instance

    def register_agent(self, name: str, factory: Callable) -> None:
        self._agent_factories[name] = factory

    def resolve(self, name: str) -> Any:
        if name in self._singletons:
            return self._singletons[name]
        raise KeyError(f"未注册的单例: {name}")

    def resolve_agent(self, name: str, **kwargs) -> BaseAgent:
        if name in self._agent_factories:
            return self._agent_factories[name](**kwargs)
        raise KeyError(f"未注册的 Agent 工厂: {name}")

    def resolve_all_agents(self) -> dict[str, BaseAgent]:
        return {name: factory() for name, factory in self._agent_factories.items()}
```

***

## 第四章：模式注册中心与混合执行器

### 4.1 ModeRegistry

```python
class ModeRegistry:
    """模式注册中心 — 管理所有 Agent 架构模式"""

    def __init__(self):
        self._modes: dict[str, BaseModeExecutor] = {}

    def register(self, name: str, executor: BaseModeExecutor) -> None:
        self._modes[name] = executor

    def get(self, name: str) -> BaseModeExecutor:
        if name not in self._modes:
            raise KeyError(f"未注册的模式: {name}")
        return self._modes[name]

    def suggest_mode(self, task: str) -> str:
        """基于关键词匹配推荐模式"""
        task_lower = task.lower()
        mode_keywords = {
            "react": ["step", "observe", "think", "act"],
            "plan_execute": ["plan", "strategy", "roadmap", "milestone"],
            "reflexion": ["improve", "reflect", "iterate", "refine"],
            "multi_agent": ["team", "collaborate", "parallel", "swarm"],
            "workflow": ["pipeline", "stage", "sequential", "step-by-step"],
            "graph_of_thoughts": ["explore", "branch", "merge", "compare"],
            "rewoo": ["predict", "plan-ahead", "decompose"],
            "self_discover": ["discover", "reasoning", "framework"],
            "agent_judge": ["judge", "evaluate", "rank", "compare"],
        }
        for mode, keywords in mode_keywords.items():
            if any(kw in task_lower for kw in keywords):
                return mode
        return "react"  # 默认 ReAct
```

### 4.2 HybridExecutor（含 v6.0 Harness Hook 点）

```python
class HybridExecutor:
    """混合执行器 — 核心调度引擎"""

    def __init__(
        self,
        mode_registry: ModeRegistry,
        agent_registry: 'AgentRegistry',
        tool_registry: 'ToolRegistry',
        event_bus: 'EventBus',
        memory_manager: 'MemoryManager',
        state_manager: 'StateManager',
        harness: 'HarnessOrchestrator | None' = None,  # v6.0 新增
    ):
        self.mode_registry = mode_registry
        self.agent_registry = agent_registry
        self.tool_registry = tool_registry
        self.event_bus = event_bus
        self.memory_manager = memory_manager
        self.state_manager = state_manager
        self.harness = harness  # v6.0
        self._persona_locks: dict[str, str] = {}

    async def run(self, task: str, mode: str = "react", persona: str | None = None, **kwargs) -> AgentOutput:
        """执行任务 — 核心入口"""
        task_id = kwargs.get("task_id", str(uuid4()))

        ctx = TaskContext(
            task_id=task_id,
            mode=mode,
            persona=persona,
            tools=self.tool_registry.get_all(),
            agents={name: type(a) for name, a in self.agent_registry.get_all().items()},
            event_bus=self.event_bus,
            harness_enabled=self.harness is not None,  # v6.0
        )

        # v6.0: Harness pre_execute Hook
        if ctx.harness_enabled and self.harness:
            await self.harness.pre_execute(ctx)  # context.inject() + entropy.check()

        # 模式选择与执行
        executor = self.mode_registry.get(mode)
        await executor._on_enter(ctx)  # v5.0 L2 钩子
        result = await executor.execute(AgentInput(task=task, context=kwargs), ctx)
        await executor._on_exit(ctx, result)  # v5.0 L2 钩子

        # v6.0: Harness post_execute Hook
        if ctx.harness_enabled and self.harness:
            result = await self.harness.post_execute(result, ctx)  # constraints.validate() + feedback.evaluate()

        # 状态持久化
        await self.state_manager.save(task_id, result, ctx)

        # 事件发射
        await self.event_bus.emit("task.completed", {"task_id": task_id, "status": result.status})

        return result
```

***

## 第五章：事件总线与 Helm 集成

### 5.1 EventBus

```python
# events/event_bus.py

import asyncio
from typing import Callable, Dict, List
from datetime import datetime

class EventBus:
    """事件总线。emit() 是同步方法，异步回调通过 asyncio.ensure_future 调度。"""

    def __init__(self):
        self._subscribers: Dict[str, List[Callable]] = {}

    def subscribe(self, event_type: str, callback: Callable):
        self._subscribers.setdefault(event_type, []).append(callback)

    def emit(self, task_id: str, event_type: str, payload: dict):
        """同步发射事件。异步回调通过 asyncio.ensure_future 调度，不阻塞主流程。"""
        event = {
            "type": event_type,
            "payload": payload,
            "task_id": task_id,
            "timestamp": datetime.utcnow().isoformat(),
        }
        for cb in self._subscribers.get(event_type, []):
            try:
                result = cb(event)
                if asyncio.iscoroutine(result):
                    asyncio.ensure_future(result)
            except Exception:
                pass
        for cb in self._subscribers.get('*', []):
            try:
                result = cb(event)
                if asyncio.iscoroutine(result):
                    asyncio.ensure_future(result)
            except Exception:
                pass
```

### 5.2 EventBusHelmAdapter

```python
# events/helm_adapter.py

from .event_bus import EventBus

class EventBusHelmAdapter:
    """将 FlowForge EventBus 事件桥接到 ContentForge HelmWSManager。
    全局订阅 + task_id 路由：HelmWSManager 按 task_id 维护连接映射，
    emit_event(task_id, ...) 只会发送到正确的 WebSocket 连接。"""

    EVENT_MAP = {
        "workflow.step.start": "helm.stage.enter",
        "mode.enter": "helm.stage.enter",
        "tool.start": "helm.tool.start",
        "tool.end": "helm.tool.end",
        "llm.start": "helm.llm.start",
        "llm.reasoning": "helm.llm.reasoning",
        "llm.stream": "helm.llm.stream",
        "llm.end": "helm.llm.end",
        "draft.update": "helm.draft.update",
        "step.intermediate": "helm.step.intermediate",
        "review.ready": "helm.review.ready",
        "review.submitted": "helm.review.submitted",
        "task.paused": "helm.task.paused",
        "task.resumed": "helm.task.resumed",
        "task.completed": "helm.task.completed",
        "task.error": "helm.task.error",
        "token.stats": "helm.token.stats",
    }

    def __init__(self, event_bus: EventBus, helm_manager):
        self.event_bus = event_bus
        self.helm_manager = helm_manager
        self._bridged = False

    def bridge(self):
        if self._bridged:
            return
        for flowforge_event, helm_event_type in self.EVENT_MAP.items():
            def make_callback(etype=helm_event_type):
                async def callback(event):
                    await self.helm_manager.emit_event(
                        event["task_id"], etype, event["payload"])
                return callback
            self.event_bus.subscribe(flowforge_event, make_callback())
        self._bridged = True
```

***

## 第六章：Database Schema

### 6.1 tasks 表

```sql
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    task TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'react',
    persona TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    result TEXT,  -- JSON
    error TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);
```

### 6.2 audit_logs 表

```sql
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    details TEXT,  -- JSON
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id)
);
```

### 6.3 model_health 表

```sql
CREATE TABLE IF NOT EXISTS model_health (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    latency_ms INTEGER,
    success BOOLEAN,
    error TEXT,
    checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 6.4 checkpoints 表

```sql
CREATE TABLE IF NOT EXISTS checkpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    state TEXT NOT NULL,  -- JSON
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id)
);
```

### 6.5 task_board 表

```sql
CREATE TABLE IF NOT EXISTS task_board (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    description TEXT NOT NULL,
    assignee TEXT,
    priority TEXT NOT NULL DEFAULT 'normal',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    claimed_at TIMESTAMP,
    completed_at TIMESTAMP
);
```

### 6.6 messages 表

```sql
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    sender TEXT NOT NULL,
    recipient TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'normal',  -- critical/high/normal/low
    subject TEXT,
    body TEXT NOT NULL,
    read BOOLEAN NOT NULL DEFAULT 0,
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id)
);
```

***

## 第七章：九大模式执行器详细设计

### 7.1 ReAct 执行器

````python
# modes/react.py

import json
import re
from core.base_mode_executor import BaseModeExecutor
from core.base_tool import ToolInput
from core.task_context import TaskContext

class ReActExecutor(BaseModeExecutor):
    mode_name = "react"
    capabilities = ["reasoning", "retrieval", "acting"]

    MAX_STEPS = 8
    LOOP_THRESHOLD = 3

    async def _execute_core(self, ctx: TaskContext) -> dict:
        observation = ctx.input_data.get("task", "")
        action_history = []
        step = 0
        for step in range(self.MAX_STEPS):
            thought = await self._generate_thought(ctx, observation, action_history)
            ctx.event_bus.emit(ctx.task_id, "react.thought", {"step": step, "thought": thought})

            action = await self._parse_action(thought)
            if action is None:
                break

            ctx.event_bus.emit(ctx.task_id, "react.action", {"step": step, "action": action})

            if self._is_loop(action_history, action):
                ctx.event_bus.emit(ctx.task_id, "react.loop_detected", {"step": step})
                break
            action_history.append(action)

            observation = await self._execute_action(ctx, action)
            ctx.event_bus.emit(ctx.task_id, "react.observation", {"step": step, "result": observation[:200]})

        return {"final_answer": observation, "steps": step + 1}

    async def _generate_thought(self, ctx, obs, history):
        llm_tool = ctx.tools.get_tool("llm")
        prompt = f"当前观察: {obs}\n历史动作: {history}\n请思考下一步行动。"
        result = await llm_tool.execute(ToolInput(params={"messages": [{"role": "user", "content": prompt}]}))
        return result.result["content"]

    async def _parse_action(self, thought):
        if "最终回答" in thought or "final answer" in thought.lower():
            return None
        match = re.search(r'```json\s*(\{.*?\})\s*```', thought, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(1))
            except json.JSONDecodeError:
                pass
        return {"tool": "llm", "params": {"query": thought}}

    def _is_loop(self, history, action):
        if len(history) < self.LOOP_THRESHOLD:
            return False
        return sum(1 for a in history[-self.LOOP_THRESHOLD:] if a == action) >= self.LOOP_THRESHOLD

    async def _execute_action(self, ctx, action):
        tool_name = action.get("tool", "llm")
        params = action.get("params", {})
        tool = ctx.tools.get_tool(tool_name)
        result = await tool.execute(ToolInput(params=params))
        return json.dumps(result.result, ensure_ascii=False)
````

### 7.2 Plan-Execute 执行器

```python
# modes/plan_execute.py

import json
import re
from core.base_mode_executor import BaseModeExecutor
from core.base_agent import AgentInput
from core.base_tool import ToolInput
from core.task_context import TaskContext

class PlanExecuteExecutor(BaseModeExecutor):
    mode_name = "plan_execute"
    capabilities = ["planning"]

    async def _execute_core(self, ctx: TaskContext) -> dict:
        task = ctx.input_data.get("task", "")
        plan = await self._planner_generate_plan(ctx, task)
        ctx.event_bus.emit(ctx.task_id, "plan_execute.plan", {"plan": plan})

        results = {}
        for i, step in enumerate(plan):
            ctx.event_bus.emit(ctx.task_id, "workflow.step.start", {"step": step["name"], "index": i})
            agent_name = step.get("agent", "executor")
            agent = ctx.agents.get(agent_name)
            if agent is None:
                from modes.default_llm_actors import DefaultLLMActor
                agent = DefaultLLMActor()
            agent_input = AgentInput(params={"task": step["task"], "context": results})
            if hasattr(agent, 'execute_with_context'):
                output = await agent.execute_with_context(agent_input, ctx)
            else:
                output = await agent.execute(agent_input)
            results[step["name"]] = output.result
            ctx.event_bus.emit(ctx.task_id, "workflow.step.complete", {"step": step["name"], "result": output.result})

        return {"plan": plan, "results": results}

    async def _planner_generate_plan(self, ctx, task):
        llm_tool = ctx.tools.get_tool("llm")
        prompt = f"将以下任务分解为顺序执行步骤，输出 JSON 数组: \n{task}\n格式: [{{\"name\": \"step1\", \"task\": \"...\", \"agent\": \"...\"}}]"
        result = await llm_tool.execute(ToolInput(params={"messages": [{"role": "user", "content": prompt}]}))
        content = result.result.get("content", "[]")
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            match = re.search(r'\[.*\]', content, re.DOTALL)
            if match:
                try:
                    return json.loads(match.group())
                except json.JSONDecodeError:
                    pass
            return []
```

### 7.3 Reflexion 执行器

```python
# modes/reflexion.py

from core.base_mode_executor import BaseModeExecutor
from core.base_agent import AgentInput
from core.task_context import TaskContext
from modes.default_llm_actors import DefaultLLMActor, DefaultLLMEvaluator, DefaultLLMReflector

class ReflexionExecutor(BaseModeExecutor):
    mode_name = "reflexion"
    capabilities = ["generation", "evaluation", "refinement"]

    MAX_ITERATIONS = 4
    QUALITY_THRESHOLD = 0.85

    async def _execute_core(self, ctx: TaskContext) -> dict:
        memory = []
        best_result = None
        best_score = 0.0

        for iteration in range(self.MAX_ITERATIONS):
            actor = ctx.agents.get("reflexion_actor") or DefaultLLMActor()
            actor_input = AgentInput(params={"task": ctx.input_data.get("task", ""), "memory": memory})
            if hasattr(actor, 'execute_with_context'):
                actor_output = await actor.execute_with_context(actor_input, ctx)
            else:
                actor_output = await actor.execute(actor_input)
            ctx.event_bus.emit(ctx.task_id, "reflexion.actor", {"iteration": iteration, "output": actor_output.result})

            evaluator = ctx.agents.get("reflexion_evaluator") or DefaultLLMEvaluator()
            eval_input = AgentInput(params={"output": actor_output.result})
            if hasattr(evaluator, 'execute_with_context'):
                eval_output = await evaluator.execute_with_context(eval_input, ctx)
            else:
                eval_output = await evaluator.execute(eval_input)
            score = eval_output.result.get("score", 0)
            issues = eval_output.result.get("issues", [])
            ctx.event_bus.emit(ctx.task_id, "reflexion.evaluator", {"iteration": iteration, "score": score, "issues": issues})

            if score > best_score:
                best_result = actor_output.result
                best_score = score

            if score >= self.QUALITY_THRESHOLD:
                break

            reflector = ctx.agents.get("reflexion_reflector") or DefaultLLMReflector()
            reflect_input = AgentInput(params={"output": actor_output.result, "issues": issues})
            if hasattr(reflector, 'execute_with_context'):
                reflect_output = await reflector.execute_with_context(reflect_input, ctx)
            else:
                reflect_output = await reflector.execute(reflect_input)
            memory.append(reflect_output.result.get("reflection", ""))
            ctx.event_bus.emit(ctx.task_id, "reflexion.reflector", {"iteration": iteration, "reflection": reflect_output.result})

        return {"result": best_result, "score": best_score, "iterations": iteration + 1}
```

> **设计说明**：Reflexion 是 FeedbackLoop 的内环。串行关系：Reflexion 内环先跑完，然后交给 FeedbackLoop 外环做终审。外环 FAIL 直接降级（返回最佳结果 + 质量警告），不回内环。

### 7.4 Multi-Agent 执行器（三策略统一版）

```python
# modes/multi_agent.py

import asyncio
from core.base_mode_executor import BaseModeExecutor
from core.base_agent import AgentInput
from core.task_context import TaskContext

class MultiAgentExecutor(BaseModeExecutor):
    mode_name = "multi_agent"
    capabilities = ["collaboration"]

    def __init__(self, task_board: Optional[TaskBoard] = None,
                 mailbox: Optional[Mailbox] = None):
        self.task_board = task_board
        self.mailbox = mailbox
        self.max_idle_rounds = 3

    def _ensure_infrastructure(self):
        if self.task_board is None:
            self.task_board = TaskBoard()
        if self.mailbox is None:
            self.mailbox = Mailbox()

    async def _execute_core(self, ctx: TaskContext) -> dict:
        strategy = ctx.metadata.get("strategy", "subagents")
        self._ensure_infrastructure()

        if strategy == "subagents":
            return await self._run_subagents(ctx)
        elif strategy == "agent_teams":
            return await self._run_agent_teams(ctx)
        elif strategy == "swarms":
            return await self._run_swarms(ctx)
        else:
            raise ValueError(f"Unknown multi-agent strategy: {strategy}")

    # --- Subagents：无状态并行隔离 ---

    async def _run_subagents(self, ctx: TaskContext) -> dict:
        tasks = ctx.metadata.get("sub_tasks", [])
        if not tasks:
            tasks = await self._decompose_task(ctx)

        async def execute_sub_task(task):
            sub_ctx = TaskContext.from_parent(
                ctx,
                input_data={"task": task.get("prompt", task.get("name", ""))},
                state={},
                metadata={"isolation": "full", "parent_task": ctx.task_id}
            )
            allowed_tools = task.get("tools", ["llm", "web_search"])
            sub_ctx.tools = self._filter_tools(ctx.tools, allowed_tools)

            agent = ctx.agents.get(task.get("agent_type", "default")) \
                if ctx.agents else None
            if agent is None:
                from flowforge.modes.default_llm_actors import DefaultLLMActor
                agent = DefaultLLMActor()

            agent_input = AgentInput(params={"task": task.get("prompt", task.get("name", ""))})
            output = await agent.execute_with_context(agent_input, sub_ctx) \
                if hasattr(agent, 'execute_with_context') \
                else await agent.execute(agent_input)
            summary = await self._compress_result(sub_ctx, output.result)
            return task.get("id", task.get("name", "")), summary

        results = await asyncio.gather(
            *[execute_sub_task(t) for t in tasks], return_exceptions=True
        )
        final = {}
        for r in results:
            if isinstance(r, Exception):
                continue
            key, value = r
            final[key] = value
        return {"results": final}

    # --- Agent Teams：共享任务板 + 信箱通信 ---

    async def _run_agent_teams(self, ctx: TaskContext) -> dict:
        lead_agent = self._get_lead_agent(ctx)
        task_list = await self._create_task_board(ctx, lead_agent)
        team_members = await self._spawn_team(ctx)

        idle_rounds = 0
        last_board_hash = None

        while not await self._all_tasks_done() and idle_rounds < self.max_idle_rounds:
            progress_made = False

            for member in team_members:
                task = await self.task_board.claim_task(member.name)
                if task:
                    try:
                        result = await self._execute_team_task(member, task, ctx)
                        await self.task_board.complete_task(task["task_id"], result)
                        progress_made = True
                        if isinstance(result, dict) and result.get("important"):
                            await self.mailbox.send(
                                member.name, "lead",
                                f"发现: {result['important']}",
                                priority="high"
                            )
                    except Exception as e:
                        await self.task_board.fail_task(task["task_id"], str(e))
                        await self.mailbox.send(
                            member.name, "lead",
                            f"任务 {task['task_id']} 失败: {str(e)}",
                            priority="critical"
                        )

            messages = await self.mailbox.receive("lead", unread_only=True)
            for msg in messages:
                if self._needs_replanning(msg):
                    await self._replan(lead_agent, task_list, ctx)

            await self.task_board.reset_stuck_tasks(timeout_seconds=300)

            current_hash = await self._hash_board()
            if current_hash == last_board_hash:
                idle_rounds += 1
            else:
                idle_rounds = 0
                last_board_hash = current_hash

        return await self._aggregate_results(lead_agent, ctx)

    # --- Swarms：去中心化集群 ---

    async def _run_swarms(self, ctx: TaskContext) -> dict:
        # SwarmWorker 持续认领任务 + 心跳监控 + SwarmCoordinator 检测失联节点
        # 详细实现见 v5.0 第十八章
        pass
```

**三策略对比**：

| 维度       | Subagents                           | Agent Teams     | Swarms              |
| -------- | ----------------------------------- | --------------- | ------------------- |
| **状态**   | 无状态，完全隔离                            | 共享 TaskBoard    | 去中心化，各自认领           |
| **通信**   | 无（结果压缩返回）                           | Mailbox 信箱      | Mailbox + 心跳        |
| **协调**   | 无（并行执行）                             | Lead Agent 协调   | SwarmCoordinator 监控 |
| **适用场景** | 独立子任务并行                             | 多角色协作           | 大规模分布式任务            |
| **上下文**  | `TaskContext.from_parent(state={})` | 共享 TaskBoard 状态 | 各自独立 + TaskBoard    |
| **容错**   | 单任务失败不影响其他                          | Lead 可重新规划      | 心跳检测 + 自动重发布        |
| **退出条件** | 全部完成                                | 全部完成 或 空闲超限     | 全部完成 或 空闲超限         |

### 7.5 Workflow 执行器

```python
# modes/workflow.py

import asyncio
from core.base_mode_executor import BaseModeExecutor
from core.base_agent import AgentInput
from core.task_context import TaskContext
from core.errors import WorkflowRecursionError

class WorkflowExecutor(BaseModeExecutor):
    mode_name = "workflow"
    capabilities = ["orchestration", "planning"]
    MAX_DEPTH = 3

    DEFAULT_DEFENSE = {
        "max_tool_calls": 50,
        "tool_timeout": 120,
        "repetition_limit": 3,
        "reflexion_retries": 2,
        "checkpoint_enabled": True,
    }

    async def _execute_core(self, ctx: TaskContext) -> dict:
        sop_steps = ctx.metadata.get("sop_steps", [])
        context_data = ctx.input_data.copy()
        depth = ctx.metadata.get("_workflow_depth", 0)
        if depth >= self.MAX_DEPTH:
            raise WorkflowRecursionError("Max workflow depth exceeded")

        defense_config = {**self.DEFAULT_DEFENSE, **ctx.metadata.get("defense", {})}
        ctx.metadata["_defense"] = defense_config

        for step in sop_steps:
            step_name = step["name"]
            ctx.event_bus.emit(ctx.task_id, "workflow.step.start", {"step": step_name})

            if step.get("human"):
                await self._pause_for_review(ctx, step)
                continue

            if step.get("parallel_group"):
                results = await self._execute_parallel(ctx, step["parallel_group"], context_data)
                context_data.update(results)
                continue

            mode = step.get("mode", "plan_execute")
            if mode == "workflow":
                raise ValueError("Nested workflow mode is forbidden")

            sub_ctx = TaskContext.from_parent(ctx, input_data=context_data,
                                              metadata={"_workflow_depth": depth + 1})
            try:
                sub_result = await ctx.executor.run(sub_ctx, mode_hint=mode, _is_substep=True)
                context_data[step.get("output", step_name)] = sub_result
            except Exception as e:
                on_error = step.get("on_error", "abort")
                if on_error == "skip":
                    continue
                elif on_error == "retry":
                    retry_count = step.get("retry_count", 1)
                    delay = step.get("retry_delay", 2)
                    for i in range(retry_count):
                        try:
                            await asyncio.sleep(delay)
                            sub_result = await ctx.executor.run(sub_ctx, mode_hint=mode, _is_substep=True)
                            context_data[step.get("output", step_name)] = sub_result
                            break
                        except Exception:
                            if i == retry_count - 1:
                                raise
                elif on_error == "reflexion_retry":
                    reflexion_ctx = TaskContext.from_parent(
                        ctx,
                        input_data={"task": f"分析步骤'{step['name']}'失败原因并修正: {str(e)}"},
                        metadata={"mode": "reflexion"}
                    )
                    reflexion_result = await ctx.executor.run(
                        reflexion_ctx, mode_hint="reflexion", _is_substep=True
                    )
                    context_data["_reflexion_fix"] = reflexion_result
                    retry_count = step.get("retry_count", 2)
                    for i in range(retry_count):
                        try:
                            break
                        except Exception:
                            if i == retry_count - 1:
                                raise
                else:
                    raise

            ctx.event_bus.emit(ctx.task_id, "workflow.step.complete", {"step": step_name})

        return context_data

    async def _pause_for_review(self, ctx, step):
        ctx.event_bus.emit(ctx.task_id, "review.ready", {"step": step["name"]})
        review_event = asyncio.Event()
        ctx._review_event = review_event
        await review_event.wait()

    async def _execute_parallel(self, ctx, group, context_data):
        results = {}
        tasks = []
        for item in group:
            mode = item.get("mode", "plan_execute")
            sub_ctx = TaskContext.from_parent(ctx, input_data=context_data)
            tasks.append(ctx.executor.run(sub_ctx, mode_hint=mode, _is_substep=True))
        completed = await asyncio.gather(*tasks, return_exceptions=True)
        for item, result in zip(group, completed):
            if isinstance(result, Exception):
                if item.get("on_error", "abort") == "skip":
                    continue
                raise result
            results[item.get("output", item["name"])] = result
        return results
```

**四种 on_error 策略对比**：

| 策略                | 行为                       | 适用场景        |
| ----------------- | ------------------------ | ----------- |
| `abort`（默认）       | 直接抛出异常，终止 Workflow       | 关键步骤不可跳过    |
| `skip`            | 跳过失败步骤，继续执行              | 非关键步骤       |
| `retry`           | 等待后重试 N 次                | 临时性故障（网络抖动） |
| `reflexion_retry` | Reflexion 分析原因 → 修正 → 重试 | 逻辑性错误需要自修正  |

### 7.6~7.9 其余模式概要

- **GraphOfThoughts**：维护图结构，支持分支、合并、循环，通过投票机制收敛。
- **ReWOO**：生成 Blueprint JSON，包含多个 Tool 调用计划，然后并发执行。
- **SelfDiscover**：调用 LLM 分析任务，输出推荐的思维框架（模式名称）。
- **AgentJudge**：注册两个 Agent：actor 和 judge；先 actor 执行，judge 评估，可选多轮。

### 7.10 DefaultLLM 系列（默认 Actor/Evaluator/Reflector）

```python
# modes/default_llm_actors.py

from core.base_agent import BaseAgent, AgentInput, AgentOutput
from core.base_tool import ToolInput
from core.task_context import TaskContext

class DefaultLLMActor(BaseAgent):
    name = "default_actor"

    async def execute(self, input: AgentInput) -> AgentOutput:
        raise NotImplementedError("请使用 execute_with_context")

    async def execute_with_context(self, input: AgentInput, context: TaskContext) -> AgentOutput:
        llm = context.tools.get_tool("llm") if context and context.tools else None
        if llm is None:
            return AgentOutput(result={"output": "LLMTool not available"})
        result = await llm.execute(ToolInput(params={
            "messages": [{"role": "user", "content": input.params.get("task", "")}]
        }))
        return AgentOutput(result={"output": result.result.get("content", "")})

class DefaultLLMEvaluator(BaseAgent):
    name = "default_evaluator"

    async def execute(self, input: AgentInput) -> AgentOutput:
        raise NotImplementedError("请使用 execute_with_context")

    async def execute_with_context(self, input: AgentInput, context: TaskContext) -> AgentOutput:
        llm = context.tools.get_tool("llm") if context and context.tools else None
        if llm is None:
            return AgentOutput(result={"score": 0.5, "issues": ["No LLM tool"]})
        prompt = (
            "评估以下输出质量，给出 0-1 分数和问题列表。"
            "严格输出 JSON: {\"score\": 0.85, \"issues\": [\"问题1\", \"问题2\"]}\n\n"
            f"输出内容: {input.params.get('output', '')}"
        )
        result = await llm.execute(ToolInput(params={
            "messages": [{"role": "user", "content": prompt}]
        }))
        import json, re
        content = result.result.get("content", "{}")
        match = re.search(r'\{.*\}', content, re.DOTALL)
        if match:
            try:
                return AgentOutput(result=json.loads(match.group()))
            except json.JSONDecodeError:
                pass
        return AgentOutput(result={"score": 0.5, "issues": [f"无法解析评估: {content[:100]}"]})

class DefaultLLMReflector(BaseAgent):
    name = "default_reflector"

    async def execute(self, input: AgentInput) -> AgentOutput:
        raise NotImplementedError("请使用 execute_with_context")

    async def execute_with_context(self, input: AgentInput, context: TaskContext) -> AgentOutput:
        llm = context.tools.get_tool("llm") if context and context.tools else None
        if llm is None:
            return AgentOutput(result={"reflection": "无法连接到 LLM"})
        prompt = (
            "分析以下失败案例，总结失败原因和具体改进建议。"
            "输出 JSON: {\"reflection\": \"分析结果...\"}\n\n"
            f"输出内容: {input.params.get('output', '')}\n"
            f"问题列表: {input.params.get('issues', [])}"
        )
        result = await llm.execute(ToolInput(params={
            "messages": [{"role": "user", "content": prompt}]
        }))
        import json, re
        content = result.result.get("content", "{}")
        match = re.search(r'\{.*\}', content, re.DOTALL)
        if match:
            try:
                return AgentOutput(result=json.loads(match.group()))
            except json.JSONDecodeError:
                pass
        return AgentOutput(result={"reflection": content[:200]})
```

***

## 第八章：通用 Agent 库详细设计

### 8.1 通用 Agent 注册规范

所有通用 Agent 必须继承 `flowforge.core.BaseAgent`，需要访问工具的 Agent 应覆写 `execute_with_context` 方法，通过 `context.tools` 获取 ToolRegistry。

```python
from flowforge.core.base_agent import BaseAgent, AgentInput, AgentOutput
from flowforge.core.base_tool import ToolInput
from flowforge.core.task_context import TaskContext

class TopicResearchAgent(BaseAgent):
    name = "topic_research"
    description = "多级检索策略：缓存→HelixRAG→热榜→自定义"
    default_mode = "rewoo"

    async def execute(self, input: AgentInput) -> AgentOutput:
        raise NotImplementedError("请使用 execute_with_context")

    async def execute_with_context(self, input: AgentInput, context: TaskContext) -> AgentOutput:
        query = input.params.get("topic", "")
        cache_tool = context.tools.get_tool("cache")
        cached = await cache_tool.execute(ToolInput(params={"key": query}))
        if cached.result.get("data"):
            return AgentOutput(result={"topics": cached.result["data"]})

        helix = context.tools.get_tool("helixrag")
        result = await helix.execute(ToolInput(params={"query": query, "max_results": 5}))
        topics = [{"title": r["title"], "angle": r.get("angle", "综合")} for r in result.result.get("results", [])]
        return AgentOutput(result={"topics": topics})
```

### 8.2 其他通用 Agent

`MaterialCollectionAgent`、`ArticleWritingAgent`、`SEOOptimizationAgent`、`FactCheckAgent`、`ContentAuditAgent`、`HeadlineOptimizerAgent`、`ContentRepurposerAgent`、`TrendAnalysisAgent`、`PublishingAgent`、`ImageResearchAgent`、`MultilingualAgent`、`ResearchAgent`、`WebSearchAgent`、`CodeWriterAgent` 均遵循相同模式：覆写 `execute_with_context`，通过 `context.tools` 获取工具。

### 8.3 17 个通用 Agent（generic/）

v6.0 新增 17 个通用 Agent，位于 `agents/generic/` 目录：

| Agent | 职责 |
|-------|------|
| Analyst | 数据分析与洞察提取 |
| Approver | 审批决策 |
| Critic | 批判性评审 |
| Deliverer | 交付物封装 |
| Drafter | 初稿生成 |
| Executor | 任务执行 |
| Finalizer | 最终润色 |
| Generator | 内容生成 |
| Planner | 规划分解 |
| Processor | 数据处理 |
| ReActActor | ReAct 模式执行者 |
| ReActObserver | ReAct 模式观察者 |
| ReActThinker | ReAct 模式思考者 |
| Refiner | 精炼优化 |
| Reviewer | 评审检查 |
| Validator | 合规验证 |
| Verifier | 事实核查 |

***

## 第九章：通用 Workflow 库设计

### 9.1 Workflow 定义

通用 Workflow 以 YAML 文件形式存储在 `flowforge/workflows/` 目录下。

示例 `deep_article.yaml`：

```yaml
name: "deep_article"
version: "1.0"
steps:
  - name: "topic_research"
    agent: "topic_research"
    mode: "rewoo"
    output: "topics"
  - name: "material_collection"
    agent: "material_collection"
    mode: "rewoo"
    output: "materials"
  - name: "writing"
    agent: "article_writing"
    mode: "reflexion"
    output: "draft"
  - name: "seo_opt"
    agent: "seo_optimization"
    mode: "plan_execute"
    output: "seo_title"
  - name: "fact_check"
    agent: "fact_check"
    mode: "react"
  - name: "audit"
    agent: "content_audit"
    mode: "agent_judge"
  - name: "review"
    human: true
  - name: "publish"
    agent: "publishing"
    mode: "plan_execute"
    output: "published_urls"
```

### 9.2 Workflow 调用

```python
context = TaskContext(task_id="123", persona="education", input_data={"topic": "..."},
                      metadata={"sop_steps": load_sop("deep_article")})
result = await forge.run(context, mode_hint="workflow")
```

### 9.3 v6.0 新增 Workflow 模板

| 模板 | 说明 |
|------|------|
| `multilingual.yaml` | 多语言翻译与本地化 |
| `report_generation.yaml` | 报告生成 |

***

## 第十章：插件系统详细设计

### 10.1 插件机制概述

采用 Python 生态标准的 **`entry_points`** 机制，并结合**配置文件扫描**，实现多层次的插件发现与加载。

```
第三方插件包 (pip install flowforge-plugin-xxx)
        │
        ├── 注册工具 (entry_points: flowforge.tools)
        ├── 注册模式 (entry_points: flowforge.modes)
        ├── 注册 Agent (entry_points: flowforge.agents)
        └── 注册 Workflow (entry_points: flowforge.workflows)
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│                    FlowForge 启动时                      │
│  1. 扫描所有已安装包的 entry_points                        │
│  2. 加载指定的 YAML 配置文件目录                           │
│  3. 将发现的组件注册到对应的 Registry 中                   │
└─────────────────────────────────────────────────────────┘
```

### 10.2 通用插件发现与加载器

```python
# plugins/plugin_manager.py

import importlib.metadata
from typing import Dict, List, Callable
from core.errors import ConfigurationError

class PluginManager:

    def __init__(self):
        self._plugins: Dict[str, Dict[str, List[Callable]]] = {
            "modes": {},
            "agents": {},
            "tools": {},
            "workflows": {},
        }

    def discover_entry_points(self, group: str) -> List[Callable]:
        factories = []
        try:
            entry_points = importlib.metadata.entry_points(group=group)
            for ep in entry_points:
                try:
                    factory = ep.load()
                    factories.append(factory)
                except Exception:
                    pass
        except Exception:
            pass
        return factories

    def load_from_config(self, config: dict) -> Dict[str, List[Callable]]:
        results = {}
        for plugin_type in ["modes", "agents", "tools", "workflows"]:
            plugins = config.get(plugin_type, [])
            results[plugin_type] = []
            for plugin_def in plugins:
                if isinstance(plugin_def, str):
                    module_path = plugin_def
                elif isinstance(plugin_def, dict):
                    module_path = plugin_def.get("module")
                else:
                    continue
                if module_path:
                    try:
                        factory = self._load_from_path(module_path)
                        results[plugin_type].append(factory)
                    except Exception:
                        pass
        return results

    def _load_from_path(self, module_path: str) -> Callable:
        import importlib
        if ":" in module_path:
            module_name, attr_name = module_path.split(":", 1)
            module = importlib.import_module(module_name)
            return getattr(module, attr_name)
        else:
            module = importlib.import_module(module_path)
            if hasattr(module, "register"):
                return module.register
            raise ConfigurationError(f"No callable found in module {module_path}")
```

> **v6.0 变更**：删除 `plugins/skills_loader.py`，Skill 加载统一走 `skills/registry.py`。

### 10.3 注册新的模式执行器

```python
# my_plugin/my_mode.py
from flowforge.core.base_mode_executor import BaseModeExecutor
from flowforge.core.task_context import TaskContext

class MyCustomMode(BaseModeExecutor):
    mode_name = "my_custom_mode"
    capabilities = ["reasoning", "writing"]

    async def _execute_core(self, ctx: TaskContext) -> dict:
        return {"result": "success"}
```

```toml
[project.entry-points."flowforge.modes"]
my_custom_mode = "my_plugin.my_mode:MyCustomMode"
```

### 10.4 注册新的通用 Agent

```python
# my_plugin/agents.py
from flowforge.core.base_agent import BaseAgent, AgentInput, AgentOutput
from flowforge.core.task_context import TaskContext

class MyAnalysisAgent(BaseAgent):
    name = "my_analysis"
    description = "自定义数据分析Agent"
    default_mode = "reflexion"

    async def execute(self, input: AgentInput) -> AgentOutput:
        raise NotImplementedError("请使用 execute_with_context")

    async def execute_with_context(self, input: AgentInput, context: TaskContext) -> AgentOutput:
        llm = context.tools.get_tool("llm")
        result = await llm.execute(ToolInput(params={"messages": [{"role": "user", "content": input.params.get("data", "")}]}))
        return AgentOutput(result={"analysis": result.result.get("content", "")})
```

### 10.5 注册新的通用 Workflow

**方式 1：YAML 文件注册**（推荐）

```yaml
flowforge:
  workflow_paths:
    - "/path/to/custom_workflows/"
```

**方式 2：Python 代码注册**

```toml
[project.entry-points."flowforge.workflows"]
my_workflow = "my_plugin.my_workflow:register"
```

### 10.6 注册新的 Tool（支持 MCP 协议接入）

```python
# my_plugin/tools.py
from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput

class MyCustomTool(BaseTool):
    name = "my_tool"
    description = "自定义工具"
    parameters_schema = {"type": "object", "required": ["param1"]}

    async def execute(self, input: ToolInput) -> ToolOutput:
        return ToolOutput(result={"output": input.params["param1"]})
```

```yaml
# MCP 服务配置
tools:
  - name: "filesystem"
    type: "mcp"
    command: "npx"
    args: ["-y", "@anthropic/mcp-server-filesystem", "/tmp"]
  - name: "external_api"
    type: "openapi"
    spec_url: "https://api.example.com/openapi.json"
    auth: {type: "bearer", token_env: "API_KEY"}
```

***

## 第十一章：Tool 系统与沙箱安全

### 11.1 统一 Tool 注册与调用

```python
# tools/builtin/registry.py（v6.0 迁移自 tools/registry.py）

import time
import asyncio
from typing import Dict, Optional, Callable
from core.base_tool import BaseTool, ToolInput, ToolOutput

class ToolRegistry:
    def __init__(self, tool_timeout: int = 120):
        self._tools: Dict[str, BaseTool] = {}
        self._tool_timeout = tool_timeout

    def register(self, tool: BaseTool):
        if tool.name in self._tools:
            raise ValueError(f"Tool '{tool.name}' already registered")
        self._tools[tool.name] = tool

    def get_tool(self, name: str) -> BaseTool:
        if name not in self._tools:
            raise KeyError(f"Tool '{name}' not found")
        return self._tools[name]

    def get_all(self) -> list[BaseTool]:
        return list(self._tools.values())

    async def execute(self, name: str, input: ToolInput, emit_callback=None) -> ToolOutput:
        tool = self.get_tool(name)
        if not tool.validate_params(input.params):
            raise ValueError(f"Invalid params for tool '{name}'")

        if emit_callback:
            await emit_callback("tool.start", {"tool_name": name, "params": input.params})

        start = time.time()
        try:
            # v5.0 L1 超时防御
            result = await asyncio.wait_for(
                tool.execute(input),
                timeout=self._tool_timeout
            )
        except TimeoutError:
            return ToolOutput(
                result={},
                error=f"Tool '{name}' timed out after {self._tool_timeout}s"
            )
        except Exception as e:
            if emit_callback:
                await emit_callback("tool.end", {"tool_name": name, "error": str(e), "duration_ms": int((time.time()-start)*1000)})
            raise

        if emit_callback:
            await emit_callback("tool.end", {"tool_name": name, "result": result.result, "duration_ms": int((time.time()-start)*1000)})
        return result
```

### 11.2 SecureToolRegistry

```python
# security/secure_tool_registry.py

from flowforge.tools.builtin.registry import ToolRegistry

class SecureToolRegistry(ToolRegistry):
    SAFETY_READONLY = "readonly"
    SAFETY_NORMAL = "normal"
    SAFETY_DANGEROUS = "dangerous"

    def __init__(self, event_bus=None, tool_timeout: int = 120):
        super().__init__(tool_timeout=tool_timeout)
        self._event_bus = event_bus
        self._running_tools: Dict[str, asyncio.Lock] = {}

    def register(self, tool: BaseTool):
        if not hasattr(tool, 'safety_level'):
            tool.safety_level = self.SAFETY_NORMAL
        if not hasattr(tool, 'is_concurrency_safe'):
            tool.is_concurrency_safe = True
        super().register(tool)

    async def execute(self, name: str, input: ToolInput,
                      context: Optional[TaskContext] = None,
                      require_approval: bool = True) -> ToolOutput:
        tool = self.get_tool(name)
        safety = getattr(tool, 'safety_level', self.SAFETY_NORMAL)

        if safety == self.SAFETY_READONLY:
            return await super().execute(name, input)

        if safety == self.SAFETY_DANGEROUS and require_approval and context:
            approved = await self._request_approval(context, name, input.params)
            if not approved:
                return ToolOutput(result={}, error=f"Permission denied for dangerous tool '{name}'")

        if not getattr(tool, 'is_concurrency_safe', True):
            if name not in self._running_tools:
                self._running_tools[name] = asyncio.Lock()
            async with self._running_tools[name]:
                return await super().execute(name, input)

        return await super().execute(name, input)

    async def _request_approval(self, context: TaskContext, tool_name: str, params: dict) -> bool:
        if self._event_bus:
            self._event_bus.emit(context.task_id, "permission.requested", {
                "tool": tool_name, "params": params, "task_id": context.task_id
            })
        if hasattr(context, 'executor') and context.executor:
            review_event = context.executor.register_review_wait(
                f"{context.task_id}_tool_{tool_name}")
            await review_event.wait()
            state = context.executor.state_manager.load_state(context.task_id)
            return state.get("review_verdict") == "approved"
        return False
```

**安全等级语义**：

| safety_level | 含义   | 审批要求    | 典型工具         |
| ------------- | ---- | ------- | ------------ |
| `safe`        | 只读操作 | 无需审批    | 搜索、检索、LLM 调用 |
| `moderate`    | 常规操作 | 仅并发时需注意 | 文件写入、数据转换    |
| `dangerous`   | 危险操作 | 需人工审批   | 代码执行、删除、发布   |

### 11.3 沙箱执行器 (`PythonExecutorTool`)

```python
# tools/builtin/python_executor.py

import sys
import multiprocessing
import os
import tempfile
import io
import contextlib
from core.base_tool import BaseTool, ToolInput, ToolOutput

class PythonExecutorTool(BaseTool):
    name = "python_executor"
    description = "在隔离沙箱中执行Python代码"
    safety_level = "dangerous"
    parameters_schema = {
        "type": "object",
        "required": ["code"],
        "properties": {
            "code": {"type": "string", "description": "待执行的Python代码"},
            "timeout": {"type": "integer", "default": 10, "description": "超时秒数"},
            "max_memory_mb": {"type": "integer", "default": 64, "description": "最大内存MB"},
        }
    }

    async def execute(self, input: ToolInput) -> ToolOutput:
        code = input.params["code"]
        timeout = input.params.get("timeout", 10)
        max_memory = input.params.get("max_memory_mb", 64)

        queue = multiprocessing.Queue()
        process = multiprocessing.Process(
            target=self._run_in_subprocess,
            args=(code, queue, max_memory)
        )
        process.start()
        process.join(timeout)
        if process.is_alive():
            process.terminate()
            process.join()
            return ToolOutput(result={"stdout": "", "stderr": "Code execution timed out"}, error="timeout")

        if not queue.empty():
            result = queue.get()
            return ToolOutput(result=result)
        return ToolOutput(result={"stdout": "", "stderr": "Execution failed"}, error="execution_error")

    def _run_in_subprocess(self, code, queue, max_memory):
        try:
            if sys.platform != "win32":
                import resource
                resource.setrlimit(resource.RLIMIT_AS,
                                   (max_memory * 1024 * 1024, max_memory * 1024 * 1024))
            else:
                try:
                    import psutil
                    process = psutil.Process()
                    process.memory_limit(max_memory * 1024 * 1024)
                except ImportError:
                    pass

            with tempfile.TemporaryDirectory() as tmpdir:
                os.chdir(tmpdir)
                safe_builtins = dict(__builtins__.__dict__)
                for dangerous in ['__import__', 'open', 'eval', 'exec', 'compile', 'input']:
                    safe_builtins.pop(dangerous, None)

                restricted_globals = {
                    '__builtins__': safe_builtins,
                    '__name__': '__main__',
                }
                output = io.StringIO()
                with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
                    exec(compile(code, '<sandbox>', 'exec'), restricted_globals)
                queue.put({"stdout": output.getvalue(), "stderr": ""})
        except Exception as e:
            queue.put({"stdout": "", "stderr": str(e)})
```

### 11.4 文件系统 Tool (受限)

```python
# tools/builtin/file_rw.py

import os
from core.base_tool import BaseTool, ToolInput, ToolOutput

class FileReadWriteTool(BaseTool):
    name = "file_rw"
    ALLOWED_BASE = "/tmp/flowforge_sandbox"

    def _validate_path(self, path: str) -> bool:
        real_path = os.path.realpath(os.path.join(self.ALLOWED_BASE, path))
        return real_path.startswith(os.path.realpath(self.ALLOWED_BASE))

    async def execute(self, input: ToolInput) -> ToolOutput:
        action = input.params.get("action", "read")
        file_path = input.params.get("path", "")
        if not self._validate_path(file_path):
            return ToolOutput(result={}, error="Access denied: path traversal detected")
        full_path = os.path.join(self.ALLOWED_BASE, file_path)
        if action == "read":
            with open(full_path, 'r') as f:
                return ToolOutput(result={"content": f.read()})
        elif action == "write":
            content = input.params.get("content", "")
            with open(full_path, 'w') as f:
                f.write(content)
            return ToolOutput(result={"status": "written"})
```

***

## 第十二章：Memory 模块详细设计

### 12.1 MemoryManager 完整实现

```python
# memory/manager.py

from typing import Any, List, Dict

class MemoryManager:
    def __init__(self, config: dict, llm_client=None):
        self.working = WorkingMemory()
        self.short_term = ShortTermMemory(config.get("db_url"))
        self.long_term = LongTermMemory(config.get("db_url"))
        self.semantic = SemanticMemory() if config.get("vector_db_url") else None
        self.episodic = EpisodicMemory(config.get("db_url"))
        self.compressor = ContextCompressor(llm_client) \
            if llm_client and config.get("compression_enabled", True) else None

    async def save(self, memory_type: str, key: str, data: Any) -> None:
        store = getattr(self, memory_type, None)
        if store: await store.store(key, data)

    async def retrieve(self, memory_type: str, query: Any) -> Any:
        store = getattr(self, memory_type, None)
        if store: return await store.search(query)

    async def hybrid_search(self, query: str, types: List[str] = None) -> List[Any]:
        if types is None: types = ["semantic", "long_term", "episodic"]
        results = []
        if "semantic" in types and self.semantic:
            results.extend(await self.semantic.search(query))
        if "long_term" in types:
            results.extend(await self.long_term.search(query))
        if "episodic" in types:
            results.extend(await self.episodic.search(query))
        return results

    async def compress_messages(self, messages: list, context=None) -> list:
        if self.compressor:
            return await self.compressor.compress_if_needed(messages, context)
        return messages
```

### 12.2 ContextCompressor

```python
# memory/compressor.py

RECENT_ROUNDS = 3
COMPRESSION_THRESHOLD = 0.85
MAX_CONTEXT_TOKENS = 128000

class ContextCompressor:
    def __init__(self, llm_client=None):
        self._llm_client = llm_client
        self._max_context_tokens = MAX_CONTEXT_TOKENS

    async def compress_if_needed(
        self,
        messages: List[Dict[str, Any]],
        context=None,
    ) -> List[Dict[str, Any]]:
        total_tokens = self._estimate_messages_tokens(messages)
        if total_tokens <= self._max_context_tokens * COMPRESSION_THRESHOLD:
            return messages

        recent, early = self._split_messages(messages)
        if not early:
            return messages

        compressed_early = await self._compress_early_history(early, context)

        if context and context.memory:
            await self._save_to_memory(context, early)

        return compressed_early + recent

    def _split_messages(self, messages):
        decision_indices = []
        for i, msg in enumerate(messages):
            if self._is_decision_or_tool_result(msg):
                decision_indices.append(i)

        if not decision_indices:
            return [], messages

        recent_start = max(0, len(decision_indices) - RECENT_ROUNDS)
        split_idx = decision_indices[recent_start]
        return messages[:split_idx], messages[split_idx:]

    def _is_decision_or_tool_result(self, msg):
        role = msg.get("role", "")
        if role in ("tool",):
            return True
        if role == "system":
            return True
        if role == "assistant":
            if msg.get("tool_calls"):
                return True
            content = msg.get("content", "")
            if isinstance(content, str) and any(
                kw in content.lower()
                for kw in ["final answer", "conclusion", "result:", "decision:"]
            ):
                return True
        return False

    async def _compress_early_history(self, early, context=None):
        llm = None
        if context and context.tools:
            try:
                llm = context.tools.get_tool("llm")
            except Exception:
                pass
        if not llm and self._llm_client:
            llm = self._llm_client
        if not llm:
            return early

        result = await llm.execute(ToolInput(params={
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 800,
        }))
        summary_text = result.result.get("content", "")
        return [{"role": "system", "content": f"[Compressed History] {summary_text}"}]
```

### 12.3 TaskBoard：原子化共享任务板

```python
# memory/task_board.py

class TaskBoard:
    STATUS_PENDING = "pending"
    STATUS_CLAIMED = "claimed"
    STATUS_COMPLETED = "completed"
    STATUS_FAILED = "failed"

    def __init__(self, db_path: str = "data/task_board.db"):
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._db_path = db_path
        self._supports_returning = self._check_returning_support()
        self._claim_lock = asyncio.Lock()
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.execute("PRAGMA journal_mode=WAL")
        # ... schema creation ...

    async def claim_task(self, claimant: str, task_type: Optional[str] = None) -> Optional[dict]:
        if self._supports_returning:
            return await self._claim_atomic_returning(claimant, task_type)
        else:
            return await self._claim_with_lock(claimant, task_type)
```

**原子认领双策略**：

| 策略           | 条件            | 实现                                    |
| ------------ | ------------- | ------------------------------------- |
| RETURNING 子句 | SQLite ≥ 3.35 | `UPDATE ... RETURNING` 单条 SQL 原子操作    |
| 应用层锁         | SQLite < 3.35 | `asyncio.Lock` + SELECT + UPDATE 两步操作 |

**关键方法**：

| 方法                                      | 说明                    |
| --------------------------------------- | --------------------- |
| `add_task(task_id, task_type, payload)` | 发布单个任务                |
| `add_tasks_batch(tasks)`                | 批量发布任务                |
| `claim_task(claimant, task_type=None)`  | 原子认领（RETURNING 或应用层锁） |
| `complete_task(task_id, result)`        | 标记完成，可附带结果            |
| `fail_task(task_id, error_message)`     | 标记失败，记录错误信息           |
| `get_all_tasks(status=None)`            | 获取所有任务（可按状态过滤）        |
| `reset_stuck_tasks(timeout_seconds)`    | 重置超时任务为 pending       |

### 12.4 Mailbox：优先级 + 过期信箱

```python
# memory/mailbox.py

PRIORITY_CRITICAL = "critical"
PRIORITY_HIGH = "high"
PRIORITY_NORMAL = "normal"
PRIORITY_LOW = "low"

class Mailbox:
    def __init__(self, db_path: str = "data/mailbox.db"):
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.execute("PRAGMA journal_mode=WAL")
        # ... schema creation with indexes ...
```

**关键方法**：

| 方法                                                                           | 说明                   |
| ---------------------------------------------------------------------------- | -------------------- |
| `send(sender, recipient, subject, body, priority, tags, ttl_seconds)`        | 发送消息，支持优先级和 TTL      |
| `receive(recipient, unread_only, priority, subject_contains, sender, limit)` | 接收消息，自动标记已读          |
| `get_stats(recipient)`                                                       | 获取信箱统计（总数/未读/按优先级分布） |
| `_cleanup_expired()`                                                         | 自动清理过期消息             |

**优先级排序**：

```sql
ORDER BY CASE priority
    WHEN 'critical' THEN 0
    WHEN 'high' THEN 1
    WHEN 'normal' THEN 2
    ELSE 3
END ASC, created_at ASC
```

### 12.5 CheckpointManager

```python
# memory/checkpoint_manager.py

class CheckpointManager:
    def _ensure_schema(self):
        cursor = self._conn.execute("PRAGMA table_info(checkpoints)")
        columns = {row[1] for row in cursor.fetchall()}

        if not columns:
            self._conn.execute("""CREATE TABLE checkpoints (...)""")
            return

        if "id" not in columns:
            self._conn.execute("ALTER TABLE checkpoints RENAME TO _checkpoints_old")
            self._conn.execute("""CREATE TABLE checkpoints (...)""")
            self._conn.execute("""INSERT INTO ... SELECT ... FROM _checkpoints_old""")
            self._conn.execute("DROP TABLE _checkpoints_old")
        else:
            if "messages_json" not in columns:
                self._conn.execute("ALTER TABLE checkpoints ADD COLUMN messages_json TEXT")
            if "version" not in columns:
                self._conn.execute("ALTER TABLE checkpoints ADD COLUMN version INTEGER DEFAULT 1")
            if "label" not in columns:
                self._conn.execute("ALTER TABLE checkpoints ADD COLUMN label TEXT DEFAULT ''")
```

**新增方法**：

| 方法                                                  | 说明                             | 返回值                                 |
| --------------------------------------------------- | ------------------------------ | ----------------------------------- |
| `save_full(task_id, state, messages, label)`        | 完整保存（state + messages + 自动版本号） | checkpoint row id                   |
| `save_incremental(task_id, state, messages, label)` | 增量保存（无变更则跳过）                   | checkpoint row id                   |
| `restore(task_id, checkpoint_id=None)`              | 恢复 state + messages            | `{"state": dict, "messages": list}` |
| `get_latest(task_id)`                               | 获取最新检查点完整信息                    | dict or None                        |
| `delete_old_versions(task_id, keep_latest=5)`       | 清理旧版本                          | 删除数量                                |

### 12.6 记忆存储后端

| 记忆类型            | Phase 1 实现                  | Phase 2 升级       |
| --------------- | --------------------------- | ---------------- |
| WorkingMemory   | Python dict                 | 无需升级             |
| ShortTermMemory | SQLite (带过期清理任务)            | 迁移至 Redis        |
| LongTermMemory  | SQLite (表结构复用 ContentForge) | 迁移至 PostgreSQL   |
| SemanticMemory  | 未启用 (返回空列表)                 | 接入 Qdrant/BGE-M3 |
| EpisodicMemory  | SQLite (json 字段)            | 增加向量化            |

***

## 第十三章：安全机制总结

### v2.0 原有安全机制

| 安全层            | 机制                                                  | 实现位置                                            |
| -------------- | --------------------------------------------------- | ----------------------------------------------- |
| **Agent 隔离**   | 严格的 `BaseAgent` 接口；Agent 不能直接调用 OS 命令               | `core/base_agent.py`                            |
| **Tool 权限**    | 所有 Tool 通过 `ToolRegistry` 调用；沙箱 Tool 进程隔离           | `tools/registry.py`, `tools/python_executor.py` |
| **代码沙箱**       | 子进程执行、资源限制、移除危险内置函数、临时目录隔离                          | `tools/python_executor.py`                      |
| **文件系统路径穿越防护** | `_validate_path()` 确保路径在允许目录内                       | `tools/file_rw.py`                              |
| **并发冲突**       | Persona 锁 (`HybridExecutor._running_tasks`)，子步骤跳过锁  | `engine/hybrid_executor.py`                     |
| **循环检测**       | ReAct 模式的 `_is_loop`；Workflow 的 `MAX_DEPTH`         | `modes/react.py`, `modes/workflow.py`           |
| **审批流**        | Workflow 模式原生支持 `human: true` 节点，`asyncio.Event` 暂停 | `modes/workflow.py`                             |
| **审计与追踪**      | 每个任务生成唯一 `trace_id`；所有操作记录到 `audit_logs`            | `events/event_bus.py`, DB 表 `audit_logs`        |

### v5.0 新增安全机制

| 安全层          | 机制                                        | 实现位置                         |
| ------------ | ----------------------------------------- | ---------------------------- |
| **L1 工具超时**  | `asyncio.wait_for()` 包裹单次工具调用             | `tools/builtin/registry.py`  |
| **L2 重复检测**  | `_on_exit()` 生命周期钩子                       | `core/base_mode_executor.py` |
| **L3 自修正**   | `on_error="reflexion_retry"` 策略           | `modes/workflow.py`          |
| **工具安全分级**   | `safety_level`（readonly/normal/dangerous）   | `core/base_tool.py`          |
| **并发安全**     | `asyncio.Lock` 保护非并发安全工具                  | `security/secure_tool_registry.py` |
| **危险工具审批**   | EventBus + `register_review_wait()`       | `security/secure_tool_registry.py` |
| **上下文压缩**    | tiktoken 计数 + 滑动窗口摘要                      | `memory/compressor.py`       |
| **SOP 防御配置** | 全局 + 步骤级 defense 配置                       | `modes/workflow.py`          |

***

## 第十四章：Harness 驾驭层详细设计（v6.0 新增）

### 14.1 HarnessOrchestrator

```python
# flowforge/harness/__init__.py
from flowforge.harness.context import ContextEngine
from flowforge.harness.constraints import ArchitectureConstraintEngine
from flowforge.harness.feedback import FeedbackLoop
from flowforge.harness.entropy import EntropyManager

class HarnessOrchestrator:
    """Harness 统一入口 — 编排四根护栏的执行顺序

    设计决策（三轮评审裁决）：
    - 删除 control_loop.py，由本类替代
    - 2 个统一入口：pre_execute / post_execute
    - pre_execute: context.inject() + entropy.check()
    - post_execute: constraints.validate() + feedback.evaluate()
    """

    def __init__(self, config: dict):
        self.config = config
        self.context = ContextEngine(config.get("context_engineering", {}))
        self.constraints = ArchitectureConstraintEngine(config.get("architecture_constraints", {}))
        self.feedback = FeedbackLoop(config.get("feedback_loop", {}))
        self.entropy = EntropyManager(config.get("entropy_management", {}))

    async def pre_execute(self, ctx: 'TaskContext') -> None:
        """执行前 Hook：上下文注入 + 熵检查"""
        await self.context.inject(ctx)
        await self.entropy.check(ctx)

    async def post_execute(self, result: 'AgentOutput', ctx: 'TaskContext') -> 'AgentOutput':
        """执行后 Hook：约束验证 + 反馈评估"""
        violations = await self.constraints.validate(result, ctx)
        if violations:
            # 约束违规，返回降级结果
            result.metadata["constraint_violations"] = violations
            return result

        result = await self.feedback.evaluate(result, ctx)
        return result
```

### 14.2 ContextEngine（上下文工程）

```python
# flowforge/harness/context/context_engine.py
class ContextEngine:
    """上下文工程护栏 — AGENTS.md 按需注入 + 会话交接

    隐喻：新员工手册 — 让 Agent 在执行前获得必要的上下文
    """

    def __init__(self, config: dict):
        self.agents_md_path = config.get("agents_md_path", "AGENTS.md")
        self.session_manager = SessionManager(config.get("session", {}))

    async def inject(self, ctx: 'TaskContext') -> None:
        """注入上下文到 TaskContext"""
        # 1. AGENTS.md 按需注入
        agents_md = await self._load_agents_md(ctx)
        if agents_md:
            ctx.state["agents_md"] = agents_md

        # 2. 会话交接（从 SessionManager 获取历史摘要）
        session_summary = await self.session_manager.get_summary(ctx.task_id)
        if session_summary:
            ctx.state["session_summary"] = session_summary

    async def _load_agents_md(self, ctx: 'TaskContext') -> str | None:
        """按需加载 AGENTS.md"""
        import os
        if os.path.exists(self.agents_md_path):
            with open(self.agents_md_path, "r", encoding="utf-8") as f:
                return f.read()
        return None
```

### 14.3 SessionManager（会话管理器）

```python
# flowforge/harness/context/session_manager.py
class SessionManager:
    """会话管理器 — 上下文压缩与截断

    关键参数（三轮评审统一）：
    - COMPACTION_THRESHOLD = 0.92（92%）
    - utilization = total_tokens / model_context_window
    - 默认 model_context_window = 128000
    - 保留最近 N 轮完整对话（默认 3，可配置）
    - MAX_TOOL_OUTPUT_TOKENS = 25000
    """

    COMPACTION_THRESHOLD = 0.92
    DEFAULT_MODEL_CONTEXT_WINDOW = 128000
    DEFAULT_KEEP_RECENT_ROUNDS = 3
    MAX_TOOL_OUTPUT_TOKENS = 25000

    def __init__(self, config: dict):
        self.threshold = config.get("compaction_threshold", self.COMPACTION_THRESHOLD)
        self.model_context_window = config.get("model_context_window", self.DEFAULT_MODEL_CONTEXT_WINDOW)
        self.keep_recent_rounds = config.get("keep_recent_rounds", self.DEFAULT_KEEP_RECENT_ROUNDS)
        self.max_tool_output_tokens = config.get("max_tool_output_tokens", self.MAX_TOOL_OUTPUT_TOKENS)
        self._sessions: dict[str, list[dict]] = {}

    async def get_summary(self, task_id: str) -> str | None:
        """获取会话摘要"""
        if task_id in self._sessions:
            return self._compact(self._sessions[task_id])
        return None

    def _compact(self, messages: list[dict]) -> str:
        """压缩消息列表"""
        total_tokens = self._count_tokens(messages)
        utilization = total_tokens / self.model_context_window

        if utilization < self.threshold:
            return self._messages_to_text(messages)

        # 保留最近 N 轮 + 摘要其余
        recent = messages[-(self.keep_recent_rounds * 2):]  # 每轮 2 条（user+assistant）
        older = messages[:-(self.keep_recent_rounds * 2)] if len(messages) > self.keep_recent_rounds * 2 else []

        summary = self._summarize(older) if older else ""
        return summary + "\n" + self._messages_to_text(recent)

    def _count_tokens(self, messages: list[dict]) -> int:
        """使用 tiktoken 计算 token 数"""
        import tiktoken
        enc = tiktoken.get_encoding("cl100k_base")
        total = 0
        for msg in messages:
            total += len(enc.encode(str(msg.get("content", ""))))
        return total

    def _truncate_tool_output(self, output: str) -> str:
        """截断工具输出"""
        import tiktoken
        enc = tiktoken.get_encoding("cl100k_base")
        tokens = enc.encode(output)
        if len(tokens) > self.max_tool_output_tokens:
            return enc.decode(tokens[:self.max_tool_output_tokens]) + "\n...[truncated]"
        return output

    def _messages_to_text(self, messages: list[dict]) -> str:
        return "\n".join(f"[{m.get('role', 'unknown')}]: {m.get('content', '')}" for m in messages)

    def _summarize(self, messages: list[dict]) -> str:
        """摘要旧消息（简化版，生产环境应调用 LLM）"""
        return f"[历史会话摘要：{len(messages)} 条消息已压缩]"
```

### 14.4 ArchitectureConstraintEngine（架构约束）

```python
# flowforge/harness/constraints/arch_constraint_engine.py
import ast
from pathlib import Path

class ArchitectureConstraintEngine:
    """架构约束护栏 — 分层依赖检测 + Linter

    隐喻：缰绳 — 防止 Agent 产出违反架构约束的代码

    设计决策（评审修复 7）：
    - 使用 Python ast 模块解析 import 语句
    - 通过 config/layer_mapping.yaml 配置模块→层映射
    - source_module 从 TaskContext.metadata 获取（由 HybridExecutor 注入）
    """

    LAYER_ORDER = ["Types", "Config", "Repo", "Service", "Runtime", "UI"]

    def __init__(self, config: dict):
        self.enabled = config.get("enabled", True)
        self.layer_mapping_path = config.get("layer_mapping_path", "config/layer_mapping.yaml")
        self._layer_mapping: dict[str, str] = {}
        self._load_layer_mapping()

    def _load_layer_mapping(self) -> None:
        """加载模块→层映射配置"""
        import yaml
        path = Path(self.layer_mapping_path)
        if path.exists():
            with open(path, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)
                self._layer_mapping = data.get("modules", {})

    async def validate(self, output: 'AgentOutput', ctx: 'TaskContext') -> list[dict]:
        """验证 Agent 输出是否违反架构约束"""
        if not self.enabled:
            return []

        violations = []
        code = str(output.result.get("content", output.result.get("code", "")))
        if not code:
            return []

        source_module = ctx.metadata.get("source_module", "unknown")
        source_layer = self._layer_mapping.get(source_module, "unknown")

        dependencies = self._extract_dependencies(code)
        for dep in dependencies:
            dep_layer = self._layer_mapping.get(dep, "unknown")
            if source_layer != "unknown" and dep_layer != "unknown":
                if self.LAYER_ORDER.index(dep_layer) < self.LAYER_ORDER.index(source_layer):
                    violations.append({
                        "type": "reverse_dependency",
                        "source": {"module": source_module, "layer": source_layer},
                        "target": {"module": dep, "layer": dep_layer},
                        "message": f"反向依赖：{source_layer}({source_module}) → {dep_layer}({dep})"
                    })

        return violations

    def _extract_dependencies(self, code: str) -> list[str]:
        """使用 Python ast 模块解析 import 语句"""
        dependencies = []
        try:
            tree = ast.parse(code)
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        dependencies.append(alias.name.split(".")[0])
                elif isinstance(node, ast.ImportFrom):
                    if node.module:
                        dependencies.append(node.module.split(".")[0])
        except SyntaxError:
            pass  # 非 Python 代码，静默跳过（Phase 1 仅支持 Python）
        return dependencies
```

### 14.5 FeedbackLoop（反馈循环）

```python
# flowforge/harness/feedback/feedback_loop.py
from enum import Enum

class EvaluationMode(str, Enum):
    """评估模式（三轮评审裁决）"""
    FULL = "full"           # 四维评分 + 分类闸门（2次LLM调用）
    LIGHTWEIGHT = "lightweight"  # 仅分类闸门（1次LLM调用，默认）
    SKIP = "skip"           # 跳过外环（内环Reflexion仍生效）

class Verdict(str, Enum):
    PASS = "pass"
    CONDITIONAL = "conditional"
    FAIL = "fail"

class FeedbackLoop:
    """反馈循环护栏 — 独立评判 + 四维评分 + 分类闸门

    隐喻：智能体审智能体

    设计决策（三轮评审裁决）：
    - FeedbackLoop 是全局护栏（外环），所有模式输出都经过它
    - Reflexion 是模式内部的快速反馈循环（内环）
    - 串行关系：Reflexion 内环先跑完，然后交给 FeedbackLoop 外环做终审
    - 外环 FAIL 直接降级（返回最佳结果 + 质量警告），不回内环
    - evaluation_mode 默认 lightweight（1次LLM调用），生产环境推荐
    """

    MAX_REFLEXION_ITERATIONS = 3
    QUALITY_THRESHOLD = 0.8

    def __init__(self, config: dict):
        self.evaluation_mode = EvaluationMode(config.get("evaluation_mode", "lightweight"))
        self.quality_threshold = config.get("quality_threshold", self.QUALITY_THRESHOLD)
        self.max_iterations = config.get("max_iterations", self.MAX_REFLEXION_ITERATIONS)
        self._evaluator_agent = None  # 注入独立评判 Agent

    async def evaluate(self, result: 'AgentOutput', ctx: 'TaskContext') -> 'AgentOutput':
        """评估 Agent 输出质量"""
        if self.evaluation_mode == EvaluationMode.SKIP:
            return result

        if self.evaluation_mode == EvaluationMode.FULL:
            # 四维评分 + 分类闸门（2次LLM调用）
            scores = await self._four_dimensional_score(result, ctx)
            verdict = await self._classify(result, ctx, scores)
            result.metadata["feedback_scores"] = scores
        else:
            # 仅分类闸门（1次LLM调用，默认）
            verdict = await self._classify(result, ctx)

        result.metadata["feedback_verdict"] = verdict

        if verdict == Verdict.FAIL:
            # 外环 FAIL 直接降级，不回内环
            result.metadata["quality_warning"] = True
            result.status = "partial"

        return result

    async def _four_dimensional_score(self, result: 'AgentOutput', ctx: 'TaskContext') -> dict:
        """四维评分：Design Quality / Originality / Craft / Functionality"""
        # 调用独立评判 Agent
        scores = {
            "design_quality": 0.0,
            "originality": 0.0,
            "craft": 0.0,
            "functionality": 0.0,
        }
        # ... 实际实现调用 self._evaluator_agent
        return scores

    async def _classify(self, result: 'AgentOutput', ctx: 'TaskContext', scores: dict | None = None) -> Verdict:
        """分类闸门：PASS / CONDITIONAL / FAIL"""
        if scores:
            avg = sum(scores.values()) / len(scores)
            if avg >= self.quality_threshold:
                return Verdict.PASS
            elif avg >= self.quality_threshold * 0.7:
                return Verdict.CONDITIONAL
            else:
                return Verdict.FAIL
        # lightweight 模式：调用分类器 Agent
        # ... 实际实现调用 LLM
        return Verdict.PASS
```

### 14.6 EntropyManager（熵管理）

```python
# flowforge/harness/entropy/entropy_manager.py
class EntropyManager:
    """熵管理护栏 — 文档园丁 + 技术债回收 + 规则进化

    隐喻：垃圾回收 — 自动清理技术熵

    设计决策（评审修复 1）：
    - 定位为内置核心能力，不走插件市场
    - 后台 Cron 任务，不介入请求路径
    - pre_execute 中只做轻量判断（是否需要触发债务检查）
    """

    def __init__(self, config: dict):
        self.doc_gardener = DocGardener(config.get("doc_gardener", {}))
        self.debt_tracker = DebtTracker(config.get("debt_tracker", {}))
        self.rule_evolution = RuleEvolution(config.get("rule_evolution", {}))

    async def check(self, ctx: 'TaskContext') -> None:
        """轻量熵检查（在 pre_execute 中调用）"""
        # 只做轻量判断，不执行实际扫描
        debt_score = await self.debt_tracker.get_current_score()
        if debt_score and debt_score > 0.8:
            ctx.metadata["entropy_warning"] = True
            ctx.metadata["debt_score"] = debt_score
```

### 14.7 PermissionPipeline（权限管线）

```python
# flowforge/security/permission_pipeline.py
from enum import Enum

class ActionLevel(str, Enum):
    READ = "read"           # 只读，自动允许
    SUGGEST = "suggest"     # 建议，展示给用户但不执行
    PREPARE = "prepare"     # 准备，预填参数但需确认
    EXECUTE = "execute"     # 执行，需要明确授权

class PermissionPipeline:
    """三层权限管线 — deny → ask → allow

    规则优先级：deny > ask > allow
    """

    RULE_ORDER = ["deny", "ask", "allow"]

    def __init__(self, config: dict):
        self._rules: dict[str, list[dict]] = {
            "deny": config.get("deny_rules", []),
            "ask": config.get("ask_rules", []),
            "allow": config.get("allow_rules", []),
        }

    async def check(self, tool_name: str, action: ActionLevel, params: dict) -> tuple[bool, str]:
        """检查权限"""
        for rule_type in self.RULE_ORDER:
            for rule in self._rules[rule_type]:
                if self._match_rule(rule, tool_name, action, params):
                    if rule_type == "deny":
                        return False, f"拒绝：{rule.get('reason', '违反安全规则')}"
                    elif rule_type == "ask":
                        return False, f"需确认：{rule.get('reason', '需要用户授权')}"
                    else:
                        return True, "允许"
        return True, "默认允许"

    def _match_rule(self, rule: dict, tool_name: str, action: ActionLevel, params: dict) -> bool:
        """匹配规则"""
        if rule.get("tool") and rule["tool"] != tool_name:
            return False
        if rule.get("action") and rule["action"] != action.value:
            return False
        return True
```

### 14.8 SubAgentEngine

```python
# flowforge/engine/sub_agent_engine.py
class SubAgentEngine:
    """子 Agent 引擎 — 替换 MultiAgentExecutor._run_subagents()

    设计决策（评审修复 6）：
    - 只替换 _run_subagents() 内部实现
    - Teams 和 Swarms 仍在 MultiAgentExecutor 中
    - 底层共享上下文隔离和令牌预算能力
    """

    MAX_SUBAGENTS = 10

    def __init__(self, agent_registry: 'AgentRegistry', tool_registry: 'ToolRegistry', config: dict | None = None):
        self.agent_registry = agent_registry
        self.tool_registry = tool_registry
        self.config = config or {}

    async def run_subagents(
        self,
        parent_ctx: 'TaskContext',
        subagent_configs: list[dict],
    ) -> list['AgentOutput']:
        """并行执行子 Agent"""
        if len(subagent_configs) > self.MAX_SUBAGENTS:
            subagent_configs = subagent_configs[:self.MAX_SUBAGENTS]

        tasks = []
        for config in subagent_configs:
            child_ctx = TaskContext.from_parent(parent_ctx)
            child_ctx.state = {}  # 空状态隔离
            child_ctx.tools = self._filter_tools(config.get("allowed_tools", []))
            tasks.append(self._run_single(child_ctx, config))

        results = await asyncio.gather(*tasks, return_exceptions=True)
        return [r for r in results if not isinstance(r, Exception)]

    def _filter_tools(self, allowed: list[str]) -> list['BaseTool']:
        """过滤工具集"""
        all_tools = self.tool_registry.get_all()
        if not allowed:
            return all_tools
        return [t for t in all_tools if t.name in allowed]
```

### 14.9 TrajectoryPipeline（轨迹记录管线）

```python
# flowforge/engine/trajectory_pipeline.py
class TrajectoryPipeline:
    """轨迹记录与评估管线（FR-ENG-06）

    设计决策（评审修复 4）：
    - 从 IntegratedTrainingPipeline 降级为轨迹记录
    - 不涉及模型训练
    - 支持基于分类闸门的自动质量判定（Pass/Fail）
    """

    def __init__(self, config: dict | None = None):
        self.config = config or {}
        self._episodes: list[dict] = []

    async def record(self, task_id: str, input: 'AgentInput', output: 'AgentOutput', ctx: 'TaskContext') -> None:
        """记录 Episode 轨迹"""
        episode = {
            "task_id": task_id,
            "input": input.model_dump(),
            "output": output.model_dump(),
            "mode": ctx.mode,
            "timestamp": datetime.now().isoformat(),
        }
        self._episodes.append(episode)

    async def evaluate(self, episode: dict) -> str:
        """基于分类闸门的质量判定"""
        output = episode.get("output", {})
        status = output.get("status", "unknown")
        if status == "success":
            return "Pass"
        elif status == "partial":
            return "Conditional"
        else:
            return "Fail"
```

***

## 第十五章：Skill 系统详细设计（v6.0 新增）

### 15.1 SkillAdapter 基类

```python
# flowforge/skills/adapters/base.py
from abc import ABC, abstractmethod
from enum import Enum

class SkillFormat(str, Enum):
    FLOWFORGE = "flowforge"
    CLAUDE_CODE = "claude_code"
    ANTHROPIC = "anthropic"
    TRAE_CN = "trae_cn"
    # OpenHarness 标注为 Roadmap，当前不实现

class SkillAdapter(ABC):
    """Skill 格式适配器基类"""

    format: SkillFormat

    @abstractmethod
    async def load(self, path: str) -> 'Skill':
        """从路径加载 Skill"""
        ...

    @abstractmethod
    def validate(self, skill: 'Skill') -> bool:
        """验证 Skill 格式"""
        ...

    @abstractmethod
    def to_flowforge(self, skill: 'Skill') -> 'Skill':
        """转换为 FlowForge 原生格式"""
        ...
```

### 15.2 SkillRegistry

```python
# flowforge/skills/registry.py
class SkillRegistry:
    """Skill 注册中心 — 双层加载 + 置信度匹配

    设计决策（评审修复 10）：
    - 双层加载：全局 + 项目（项目覆盖全局同名）
    - 匹配增加置信度评分 + 触发词长度权重
    - 返回 Top-3 候选
    """

    def __init__(self, config: dict | None = None):
        self._skills: dict[str, 'Skill'] = {}
        self._global_path = config.get("global_path", "skills/")
        self._project_path = config.get("project_path", ".flowforge/skills/")

    async def _load_all(self) -> None:
        """双层加载：先全局，再项目"""
        await self._load_from_path(self._global_path)
        await self._load_from_path(self._project_path)  # 项目覆盖全局同名

    def match_skill(self, query: str, context: dict | None = None) -> list['Skill']:
        """匹配合适的 Skill（返回 Top-3）"""
        query_lower = query.lower()
        scored = []

        for skill in self._skills.values():
            score = 0.0
            for trigger in skill.triggers:
                if trigger.lower() in query_lower:
                    score += 1.0
                    score += len(trigger) / 10.0  # 触发词越长，匹配越精确

            # 上下文增强：工具调用记录加分
            if context and context.get("recent_tools"):
                if any(t in context["recent_tools"] for t in skill.required_tools):
                    score += 0.5

            # Helm 模式加权
            if context and context.get("mode") == "helm":
                score *= 1.2

            if score > 0:
                scored.append((skill, score))

        scored.sort(key=lambda x: x[1], reverse=True)
        return [s for s, _ in scored[:3]]
```

### 15.3 Combo Skills

```python
# flowforge/skills/combo/combo_engine.py
class ComboEngine:
    """Combo Skills — 声明式 YAML 管道编排"""

    async def execute(self, combo_yaml: str, ctx: 'TaskContext') -> 'AgentOutput':
        """执行 Combo Skill"""
        import yaml
        combo = yaml.safe_load(combo_yaml)
        steps = combo.get("steps", [])

        result = None
        for step in steps:
            skill_name = step["skill"]
            skill = self.registry.get(skill_name)
            result = await skill.execute(step.get("input", {}), ctx)

        return result or AgentOutput()
```

***

## 第十六章：MCP 模块详细设计（v6.0 新增）

### 16.1 MCPClient

```python
# flowforge/mcp/client.py
class MCPClient:
    """MCP Client — JSON-RPC 2.0，stdio/HTTP 双传输"""

    def __init__(self, server_config: dict):
        self.server_config = server_config
        self.transport = server_config.get("transport", "stdio")
        self._tools_cache: list[dict] = []
        self._cache_ttl = 300  # 5 分钟

    async def list_tools(self) -> list[dict]:
        """列出服务器提供的工具"""
        if self._tools_cache and self._is_cache_valid():
            return self._tools_cache
        response = await self._send_request("tools/list", {})
        self._tools_cache = response.get("tools", [])
        self._cache_time = time.time()
        return self._tools_cache

    async def call_tool(self, name: str, arguments: dict) -> dict:
        """调用工具"""
        return await self._send_request("tools/call", {"name": name, "arguments": arguments})
```

### 16.2 MCPGateway

```python
# flowforge/mcp/gateway.py
class MCPGateway:
    """MCP Gateway — 权限 + 预算 + 限流 + 流式

    设计决策（评审修复 11）：
    - 增加 execute_tool_stream() 方法
    """

    def __init__(self, config: dict):
        self.permission_pipeline = PermissionPipeline(config.get("permissions", {}))
        self.token_budget = config.get("token_budget", 100000)
        self.rate_limit = config.get("rate_limit", {"requests_per_minute": 60})

    async def execute_tool(self, tool_name: str, arguments: dict, ctx: 'TaskContext') -> dict:
        """执行工具（非流式）"""
        allowed, reason = await self.permission_pipeline.check(tool_name, ActionLevel.EXECUTE, arguments)
        if not allowed:
            raise SafetyViolationError(reason)
        return await self._broker.call_tool(tool_name, arguments)

    async def execute_tool_stream(self, tool_name: str, arguments: dict, ctx: 'TaskContext') -> AsyncIterator[dict]:
        """执行工具（流式）"""
        allowed, reason = await self.permission_pipeline.check(tool_name, ActionLevel.EXECUTE, arguments)
        if not allowed:
            raise SafetyViolationError(reason)
        async for chunk in self._broker.call_tool_stream(tool_name, arguments):
            yield chunk
```

### 16.3 MCPBroker

```python
# flowforge/mcp/broker.py
class MCPBroker:
    """MCP Broker — 多服务器聚合 + 索引 + 熔断

    设计决策（评审修复 8）：
    - 使用 _tool_index: Dict[str, str] 映射，避免遍历
    - 索引未命中时降级遍历搜索
    - 熔断：5次连续失败触发
    - 重试：3次
    """

    def __init__(self, config: dict):
        self._clients: dict[str, MCPClient] = {}
        self._tool_index: dict[str, str] = {}  # tool_name → server_name
        self._circuit_breaker: dict[str, int] = {}  # server_name → consecutive_failures
        self._max_failures = 5
        self._max_retries = 3

    async def register_server(self, name: str, client: MCPClient) -> None:
        """注册 MCP 服务器并构建索引"""
        self._clients[name] = client
        tools = await client.list_tools()
        for tool in tools:
            self._tool_index[tool["name"]] = name

    async def call_tool(self, tool_name: str, arguments: dict) -> dict:
        """调用工具（通过索引路由）"""
        server_name = self._tool_index.get(tool_name)
        if server_name and server_name in self._clients:
            return await self._call_with_retry(server_name, tool_name, arguments)

        # 索引未命中，降级遍历
        for name, client in self._clients.items():
            tools = await client.list_tools()
            if any(t["name"] == tool_name for t in tools):
                self._tool_index[tool_name] = name  # 更新索引
                return await self._call_with_retry(name, tool_name, arguments)

        raise ToolExecutionError(f"工具未找到: {tool_name}")

    async def _call_with_retry(self, server_name: str, tool_name: str, arguments: dict) -> dict:
        """带重试的工具调用"""
        for attempt in range(self._max_retries):
            try:
                result = await self._clients[server_name].call_tool(tool_name, arguments)
                self._circuit_breaker[server_name] = 0
                return result
            except Exception as e:
                self._circuit_breaker[server_name] = self._circuit_breaker.get(server_name, 0) + 1
                if self._circuit_breaker[server_name] >= self._max_failures:
                    raise FlowForgeError(f"服务器 {server_name} 熔断")
                if attempt == self._max_retries - 1:
                    raise
        raise ToolExecutionError(f"工具调用失败: {tool_name}")
```

### 16.4 MCPToolAdapter

```python
# flowforge/mcp/tool_adapter.py
class MCPToolAdapter(BaseTool):
    """MCP Tool → FlowForge BaseTool 自动转换

    设计决策（评审修复 11）：
    - 增加 execute_stream() 方法
    """

    safety_level = SafetyLevel.NORMAL

    def __init__(self, tool_info: dict, gateway: MCPGateway):
        super().__init__(
            name=tool_info["name"],
            description=tool_info.get("description", ""),
        )
        self._gateway = gateway
        self._input_schema = tool_info.get("inputSchema", {})

    async def execute(self, input: ToolInput) -> ToolOutput:
        """非流式执行"""
        try:
            result = await self._gateway.execute_tool(self.name, input.params, ctx=None)
            return ToolOutput(result=result)
        except Exception as e:
            return ToolOutput(error=str(e))

    async def execute_stream(self, input: ToolInput) -> AsyncIterator[ToolOutput]:
        """流式执行"""
        try:
            async for chunk in self._gateway.execute_tool_stream(self.name, input.params, ctx=None):
                yield ToolOutput(result=chunk)
        except Exception as e:
            yield ToolOutput(error=str(e))
```

***

## 第十七章：v6.0 目录结构完整清单

| 模块 | 文件数 | 核心职责 |
|------|--------|---------|
| core/ | 9 | 纯接口定义 |
| engine/ | 7 | 执行引擎 + 注册中心 + SubAgentEngine + TrajectoryPipeline |
| harness/ | 14 | 四根护栏（context/constraints/feedback/entropy） |
| security/ | 7 | 安全体系（权限/审计/沙箱） |
| skills/ | 10+ | Skill 系统（适配器/注册/Combo） |
| mcp/ | 5 | MCP 四层架构 |
| tools/ | ~20 | 工具生态（builtin/adapters/publish） |
| memory/ | 12 | 记忆系统 |
| events/ | 4 | 事件系统 |
| modes/ | 11 | 9 大模式 + 注册中心 + 默认 Actor |
| agents/ | 32+ | 通用 + 业务 Agent |
| workflows/ | 8 | YAML 模板 |
| plugins/ | 3 | 插件系统 |
| observability/ | 4 | 可观测性 |
| api/ | 12+ | FastAPI 端点 |

***

## 第十八章：v6.0 安全机制增强总结

| 层级 | 机制 | 来源 |
|------|------|------|
| L1 | 工具超时防御 | v5.0 |
| L2 | 重复检测钩子 | v5.0 |
| L3 | 自修正重试 | v5.0 |
| L4 | 安全工具注册表 | v5.0 |
| L5 | 权限管线 | v6.0 |
| L6 | 架构约束引擎 | v6.0 |
| L7 | 反馈循环闸门 | v6.0 |
| L8 | 熵管理 | v6.0 |
| L9 | MCP 熔断与重试 | v6.0 |
| L10 | 审计追踪 | v6.0 |

***

## 第十九章：增量迁移实施计划

### Step 1：新增 harness/ 目录（灰度开关）

- 创建 harness/ 目录及 4 个子目录（14 个新文件）
- 实现 HarnessOrchestrator（2 个统一入口）
- 在 config/harness_v6.yaml 增加灰度开关
- 在 HybridExecutor.run() 增加 Hook 点（2 行代码）
- 编写 Step 1 集成测试（harness 禁用时行为不变）

### Step 2：重组 tools/ 和 agents/（import 兼容）

- tools/ 重组为 builtin/ + adapters/ + publish/
- agents/ 重组为 generic/ + content/ + novel/ + code/
- 通过 __init__.py re-export 保持旧 import 路径
- 旧路径触发 DeprecationWarning
- 兼容期：1 个大版本周期（v7.0 才删除旧路径）

### Step 3：迁移 executor/ → engine/（最终重组）

- executor/ → engine/，新增 agent_registry.py、mode_registry.py
- 新增 security/ 和 observability/ 目录
- 新增 skills/ 和 mcp/ 目录
- 删除旧路径（v7.0 执行）
- 每步有回归测试

***

**以上为 FlowForge v6.0 详细设计说明书。** 本版本合并 v2.0 + v5.0 全部内容，并新增 Harness 驾驭层、Skill 系统、MCP 模块的详细设计，安全机制从 8 层扩展至 10 层。

---

# 附录: 2026-06-25 设计修正

> 来源：第十一轮文档与代码一致性深度审查（task.md 中 FW-CONSIST-001~029）
> 目的：修正 design.md 第一章 1.1 节目录结构与实际代码的偏差，补全新增模块设计说明

## D.1 engine/ 目录修正为 modes/ + loop/ + executor/ + scheduler/

### D.1.1 问题

design.md 第一章 1.1 节描述的 `engine/` 目录在 flowforge 实际代码中**不存在**。该目录包含 7 个文件（hybrid_executor/defense_layer/agent_registry/mode_registry/scheduler/state_manager/sub_agent_engine/trajectory_pipeline），实际代码中相关职责被拆分到 4 个独立目录。

### D.1.2 修正后的目录映射

```
design.md 描述                  实际代码位置
─────────────────────────────────────────────────────
engine/hybrid_executor.py    →  executor/hybrid_executor.py
engine/state_manager.py      →  executor/state_manager.py
engine/defense_layer.py      →  （拆分）
                                core/agent_timeout.py        (L1 超时)
                                core/base_mode_executor.py   (L2 重复检测)
                                modes/workflow.py            (L3 reflexion_retry)
engine/agent_registry.py     →  core/agent_registry.py
engine/mode_registry.py      →  modes/registry.py
engine/scheduler.py          →  scheduler/scheduler.py
engine/sub_agent_engine.py   →  （合并）modes/multi_agent.py
engine/trajectory_pipeline.py →  （合并）observability/tracer.py + session/event_store.py
```

### D.1.3 修正后的执行引擎层架构

执行引擎层由以下 4 个目录协同承担（替代原 engine/）：

| 目录 | 职责 | 关键文件 |
|------|------|---------|
| `executor/` | 混合执行器 + 状态持久化 | `hybrid_executor.py`, `state_manager.py` |
| `modes/` | 9 大执行模式 + 注册中心 + 默认 Actor | `registry.py`, `react.py`, `plan_execute.py`, `reflexion.py`, `multi_agent.py`, `workflow.py`, `graph_of_thoughts.py`, `rewoo.py`, `self_discover.py`, `agent_judge.py`, `loop_mode.py` + 7 个 workflow_* 辅助文件 |
| `loop/` | Loop 执行引擎（5 步闭环） | `executor.py`, `orchestrator.py`, `verifier.py`, `planner.py`, `reflector.py`, `parallel.py`, `registry.py`, `result_extractor.py`, `state.py`, `turn_transition.py` |
| `scheduler/` | APScheduler 定时调度 | `scheduler.py` |

**说明**：`loop/` 是与 `modes/` 平行的独立引擎，二者关系为：`modes/loop_mode.py` 是 9 大模式之一（注册到 ModeRegistry），`loop/executor.py` 是 Loop 执行引擎本体（5 步闭环 Discover→Assign→Act→Verify→Persist），loop_mode 调用 loop/executor 执行。

## D.2 harness/ 实际子目录与文档差异

### D.2.1 问题

design.md 第一章 1.1 节描述 harness/ 包含 4 个子目录（context/constraints/feedback/entropy，共 14 个文件），但实际代码中：

1. **无 context/feedback/entropy 子目录**：所有文件平铺在 harness/ 根下
2. **仅 constraints/ 子目录保留**：且只含 linter_rules.py + linter_runner.py（design.md 描述的 arch_constraint_engine.py 已迁移到 security/）
3. **新增 compaction.py**：DualThresholdCompactor 实现（design.md 未描述）

### D.2.2 修正后的 harness/ 结构

```
harness/
├── constraints/              # Linter 规则与执行器
│   ├── linter_rules.py
│   └── linter_runner.py
├── compaction.py              # DualThresholdCompactor（S3.0-21，新增）
├── context_engine.py          # ContextEngine（原 design.md context/context_engine.py）
├── entropy_manager.py         # EntropyManager（原 design.md entropy/entropy_manager.py）
├── feedback_loop.py           # FeedbackLoop（原 design.md feedback/feedback_loop.py）
├── orchestrator.py            # HarnessOrchestrator（原 design.md __init__.py）
└── session_manager.py         # SessionManager（原 design.md context/session_manager.py）
```

### D.2.3 迁移说明

| design.md 路径 | 实际路径 | 迁移原因 |
|--------------|---------|---------|
| `harness/__init__.py` | `harness/orchestrator.py` | Orchestrator 独立成文件，便于单测 |
| `harness/context/context_engine.py` | `harness/context_engine.py` | 平铺减少嵌套 |
| `harness/context/session_manager.py` | `harness/session_manager.py` | 平铺减少嵌套 |
| `harness/constraints/arch_constraint_engine.py` | `security/arch_constraint.py` | 架构约束属于安全体系，归入 security/ |
| `harness/feedback/feedback_loop.py` | `harness/feedback_loop.py` | 平铺减少嵌套 |
| `harness/feedback/verification_hooks.py` | （未实现） | 设计中，Phase 1 实现 |
| `harness/entropy/entropy_manager.py` | `harness/entropy_manager.py` | 平铺减少嵌套 |
| `harness/entropy/doc_gardener.py` | （未实现） | 设计中，Phase 1 实现 |
| `harness/entropy/debt_tracker.py` | （未实现） | 设计中，Phase 1 实现 |
| `harness/entropy/rule_evolution.py` | （未实现） | 设计中，Phase 1 实现 |
| —（design.md 未描述） | `harness/compaction.py` | 新增：DualThresholdCompactor |

## D.3 新增模块设计说明

### D.3.1 events/ 事件总线（design.md 未独立描述）

实际代码 `events/` 目录包含 5 个文件，承担 spec.md FR-OBS-04 + S3.0-18 事件总线统一方案：

```
events/
├── event_bus.py          # EventBus（同步 emit + asyncio.ensure_future 调度）
├── durable_stream.py     # DurableEventStream（WAL 模式持久化，CAP-11）
├── event_types.py        # 事件类型枚举（17 种 FlowForge 事件）
├── helm_adapter.py       # EventBus → Helm WS 事件桥接（16 种 Helm 事件映射）
└── bridge.py             # 跨项目事件桥接（OpenSieve/NovelForge 事件转发）
```

**设计要点**：
- EventBus.emit() 为同步方法，异步回调通过 asyncio.ensure_future 调度，不阻塞主流程
- DurableEventStream 使用 SQLite WAL 模式，append() 后批量提交（每 100 条或每秒）
- helm_adapter.py 实现 17 种 FlowForge 事件 → 16 种 Helm 事件的全映射（见 design.md 第五章 5.2）

### D.3.2 llm/ LLM 路由层（design.md 未独立描述）

实际代码 `llm/` 目录包含 7 个文件，承担 spec.md INF-01 + S3.0-13/15：

```
llm/
├── router.py             # LLMRouter（主备切换 + 健康检查 + 级联）
├── cascade.py            # 多模型级联策略（doubao→qwen→deepseek）
├── provider.py           # Provider 抽象（OpenAI 兼容接口）
├── provider_quota.py     # Provider 级 TPM/RPM/成本配额
├── quota_manager.py      # ProviderQuotaManager（S3.0-13）
├── route.py              # 路由策略实现（429/timeout/moderation_rejected 触发 failover）
└── call_event.py         # LLMCallEvent dataclass（spec 附录 J.2）
```

**设计要点**：
- 替代 design.md 描述的 `tools/builtin/llm_client.py` 单 Provider 实现
- 主链路：doubao-seed2 → qwen3.6-plus → deepseek-chat（可在 llm_route.yaml 配置）
- failover 条件：`status_code == 429` / `timeout > 30s` / `moderation_rejected`
- ProviderQuotaManager 实现 TPM/RPM/成本预算三重检查

### D.3.3 compiler/ Workflow YAML Compiler（design.md 未独立描述）

实际代码 `compiler/` 目录包含 6 个文件，承担 spec.md FWK-01 + S3.0-19 三阶段拆分：

```
compiler/
├── parser.py             # YAML → IR 解析器（Jinja2 模板引擎，S3.0-33）
├── validator.py          # IR 校验器（asteval 安全表达式，S3.0-34）
├── ir.py                 # 编译中间产物（CompiledWorkflow IR，可视化调试）
├── codegen.py            # IR → 可执行 Workflow 代码生成
├── compiler.py           # 三阶段编排入口（Parser→Validator→CodeGen）
└── resume_adapter.py     # 检查点恢复适配器（长程任务恢复）
```

**设计要点**：
- 三阶段拆分（Parser + Validator + CodeGen），每阶段独立可测
- IR（中间产物）可序列化为 JSON，支持可视化调试
- Validator 使用 asteval 安全表达式库，防止表达式注入（S3.0-34）
- 支持 SEQUENCE + CONDITIONAL + GATE 三种 StepType（MVP 里程碑 1）

### D.3.4 security/permission_v2.py PermissionV2（design.md 未描述）

实际代码 `security/permission_v2.py` 承担 spec.md S3.0-9 PermissionV2 增强：

```python
class PermissionV2Enhanced:
    """PermissionV2 增强 — ASK 超时/并发去重/审计日志"""
    
    async def _request_user_approval(
        self, match, tool_name, params, context,
        timeout: float = 300.0,  # 默认 5 分钟
    ) -> bool:
        # 1. 去重：同一 tool+params 的 ASK 只发一次
        # 2. 发起审批（推送到 Web UI）
        # 3. 等待结果（含超时）
        # 4. ASK 超时默认 DENY（fail-closed）
        # 5. 审计日志记录
```

**与 design.md 第十四章 14.7 PermissionPipeline 的关系**：
- `security/permission_pipeline.py`：V1 版本，deny→ask→allow 顺序链
- `security/permission_v2.py`：V2 增强版，新增 ASK 超时/并发去重/审计日志
- 二者共存，通过 FeatureFlag 切换（`features.use_permission_v2`）

### D.3.5 harness/compaction.py DualThresholdCompactor（design.md 未描述）

实际代码 `harness/compaction.py` 承担 spec.md S3.0-21 死循环防护：

```python
class DualThresholdCompactor:
    """双阈值压缩器 — LLM 摘要 + 抽取式摘要 + 丢弃最旧消息三档回退"""
    
    MAX_COMPACTIONS_PER_SESSION = 3  # 防死循环
    
    async def compact(self, messages, context):
        # 1. LLM 摘要（首选，doubao-seed2）
        # 2. 抽取式摘要（LLM 失败时回退，强制截断到安全阈值以下）
        # 3. 丢弃最旧消息（抽取式仍失败时兜底）
```

**与 design.md 第十四章 14.3 SessionManager 的关系**：
- SessionManager 负责 92% 阈值检测和触发
- DualThresholdCompactor 负责实际压缩执行（三档回退链）
- 二者协作：SessionManager 调用 DualThresholdCompactor.compact()

### D.3.6 core/ 新增模块（design.md 未描述）

| 模块 | 路径 | 设计来源 | 职责 |
|------|------|---------|------|
| FeatureFlags | `core/feature_flags.py` | spec v2.2 第一章 | FeatureFlag dataclass + 灰度开关 + 过期强制切换 |
| DeclarativeTool | `core/declarative_tool.py` | FR-PLG-01 扩展 | HTTPTool/ScriptTool/TransformTool 的父类，YAML 声明式工具 |
| ContentModerationLayer | `core/content_moderation.py` | S3.0-14 | Doubao moderation 统一内容安全层（4 场景阈值） |
| DegradationDecisionTree | `core/degradation.py` | spec v2.2 第三章 | 通用降级决策树（7 种 DegradationAction） |

## D.4 设计修正总结

| 修正项 | design.md 原描述 | 实际代码 | 修正动作 |
|--------|---------------|---------|---------|
| engine/ 目录 | 7 个文件 | 不存在 | 拆分为 executor/+modes/+loop/+scheduler/（D.1） |
| harness/ 子目录 | 4 子目录 14 文件 | 1 子目录 + 6 平铺文件 | 平铺 + 新增 compaction.py（D.2） |
| events/ | 未独立描述 | 5 文件 | 新增 D.3.1 节 |
| llm/ | 未独立描述 | 7 文件 | 新增 D.3.2 节 |
| compiler/ | 未独立描述 | 6 文件 | 新增 D.3.3 节 |
| security/permission_v2.py | 未描述 | 1 文件 | 新增 D.3.4 节 |
| harness/compaction.py | 未描述 | 1 文件 | 新增 D.3.5 节 |
| core/ 4 个新模块 | 未描述 | 4 文件 | 新增 D.3.6 节 |
| agents/generic/ 数量 | 17 个 | 22 个 | 更新为 22 个（含 fact_check/image_research/multilingual/research_agent/trend_analysis/web_search_agent） |
| workflows/ 目录 | 顶级目录 | 迁移到 config/workflows/ | 更新路径 |
| plugins/ 目录 | 顶级目录 | 迁移到 core/plugin_*.py | 更新路径 |

> 本附录为设计修正快照，所有差异项的修复任务详见 task.md FW-CONSIST-001~029。design.md 正文内容保持不变，以本附录为准进行代码对齐。
