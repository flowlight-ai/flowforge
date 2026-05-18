# FlowForge 详细设计说明书 v2.0

> **对应架构文档**：FlowForge v4.0
> **状态**：最终版，合并 v1.0 + v1.1 全部修复

***

## 第一章：项目骨架与目录结构

### 1.1 项目目录

```
flowforge/
├── core/                          # 核心接口与内核
│   ├── __init__.py
│   ├── base_agent.py              # BaseAgent, AgentInput, AgentOutput
│   ├── base_tool.py               # BaseTool, ToolInput, ToolOutput
│   ├── base_mode_executor.py      # BaseModeExecutor
│   ├── task_context.py            # TaskContext
│   ├── di.py                      # 轻量 DI 容器
│   ├── errors.py                  # 统一异常层次
│   ├── config.py                  # YAML 配置加载器 (pydantic-settings)
│   ├── tracing.py                 # trace_id 注入与日志
│   ├── metrics.py                 # Prometheus 指标
│   └── plugin_manager.py          # 插件管理器
├── modes/                          # 模式执行器
│   ├── __init__.py
│   ├── react.py
│   ├── plan_execute.py
│   ├── reflexion.py
│   ├── default_llm_actors.py      # DefaultLLMActor/Evaluator/Reflector
│   ├── multi_agent.py
│   ├── workflow.py
│   ├── graph_of_thoughts.py
│   ├── rewoo.py
│   ├── self_discover.py
│   └── agent_judge.py
├── agents/                         # 通用 Agent 库
│   ├── __init__.py
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
│   └── multilingual.py
├── tools/                          # 工具注册与实现
│   ├── __init__.py
│   ├── registry.py                 # ToolRegistry
│   ├── llm_client.py               # 统一 LLM 客户端
│   ├── helixrag_client.py
│   ├── tavily_search.py
│   ├── duckduckgo_search.py
│   ├── web_scraper.py
│   ├── toutiao_publisher.py
│   ├── wechat_publisher.py
│   ├── pexels_image.py
│   ├── sendgrid_mail.py
│   ├── webhook.py
│   ├── python_executor.py          # 沙箱执行器
│   ├── file_rw.py
│   ├── mcp_adapter.py              # MCP 协议适配
│   ├── openapi_adapter.py          # OpenAPI 适配
│   └── graphql_adapter.py          # GraphQL 适配
├── workflows/                      # 通用 Workflow 库
│   ├── __init__.py
│   ├── deep_article.py
│   ├── quick_post.py
│   ├── trend_article.py
│   ├── multi_platform.py
│   ├── seo_content.py
│   └── image_article.py
├── memory/                         # 记忆管理
│   ├── __init__.py
│   ├── manager.py                  # MemoryManager
│   ├── working.py
│   ├── short_term.py
│   ├── long_term.py
│   ├── semantic.py
│   └── episodic.py
├── events/                         # 事件系统
│   ├── __init__.py
│   ├── event_bus.py                # EventBus
│   ├── event_types.py              # 事件类型常量
│   └── solo_adapter.py             # EventBusSoloAdapter
├── executor/                       # 执行器
│   ├── __init__.py
│   ├── hybrid_executor.py          # HybridExecutor
│   └── state_manager.py            # StateManager
├── scheduler/                      # 定时调度
│   └── scheduler.py
├── cli/                            # 命令行工具
│   └── engine_health.py
├── config/                         # 默认配置
│   └── default.yaml
├── pyproject.toml
└── docs/
```

### 1.2 pyproject.toml

```toml
[build-system]
requires = ["setuptools>=68.0", "wheel"]
build-backend = "setuptools.build_meta"

[project]
name = "flowforge"
version = "0.1.0"
description = "Production-grade Python Agent orchestration framework"
readme = "README.md"
requires-python = ">=3.10"
license = {text = "MIT"}
authors = [{name = "FlowForge Team"}]
dependencies = [
    "pydantic>=2.0",
    "pyyaml>=6.0",
    "httpx>=0.27",
    "openai>=1.0",
    "langgraph>=0.2",
    "langgraph-checkpoint-sqlite>=0.1",
    "apscheduler>=3.10",
    "prometheus-client>=0.19",
]

[project.entry-points."flowforge.modes"]
react = "flowforge.modes.react:ReActExecutor"
plan_execute = "flowforge.modes.plan_execute:PlanExecuteExecutor"
reflexion = "flowforge.modes.reflexion:ReflexionExecutor"
multi_agent = "flowforge.modes.multi_agent:MultiAgentExecutor"
workflow = "flowforge.modes.workflow:WorkflowExecutor"

[project.entry-points."flowforge.agents"]
deep_research = "flowforge.agents.topic_research:TopicResearchAgent"
article_writer = "flowforge.agents.article_writing:ArticleWritingAgent"
```

***

## 第二章：核心接口详细设计

### 2.1 BaseAgent 与相关模型

```python
# core/base_agent.py

from abc import ABC, abstractmethod
from pydantic import BaseModel, Field
from typing import Any, Dict, Optional

class AgentInput(BaseModel):
    params: Dict[str, Any] = Field(default_factory=dict, description="Agent 特定参数")
    state: Optional[Dict[str, Any]] = Field(default=None, description="当前任务状态（可选，兼容旧 ContentForge 接口）")

class AgentOutput(BaseModel):
    result: Dict[str, Any] = Field(..., description="Agent 产出数据")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="元数据 (token消耗/耗时)")
    state_updates: Dict[str, Any] = Field(default_factory=dict, description="需要更新到 State 的字段")

class BaseAgent(ABC):
    """Agent 抽象基类。所有业务 Agent 必须实现此接口。"""
    name: str = "base"
    description: str = ""
    default_mode: Optional[str] = "react"

    @abstractmethod
    async def execute(self, input: AgentInput) -> AgentOutput:
        """核心执行方法（与 ContentForge 签名完全兼容）"""
        pass

    async def execute_with_context(self, input: AgentInput, context: 'TaskContext') -> AgentOutput:
        """带上下文的执行方法。默认委托给 execute。
        需要访问 TaskContext 中的工具、记忆等的 Agent 应覆写此方法。"""
        return await self.execute(input)

    def validate_input(self, input: AgentInput) -> bool:
        return True

    def get_cost_estimate(self, input: AgentInput) -> Dict[str, Any]:
        return {"estimated_tokens": 0, "estimated_cost": 0.0}
```

### 2.2 BaseTool 与相关模型

```python
# core/base_tool.py

from abc import ABC, abstractmethod
from pydantic import BaseModel, Field
from typing import Any, Dict, Optional

class ToolInput(BaseModel):
    params: Dict[str, Any] = Field(..., description="工具参数")

class ToolOutput(BaseModel):
    result: Dict[str, Any] = Field(..., description="工具执行结果")
    error: Optional[str] = Field(default=None, description="错误信息")

class BaseTool(ABC):
    """Tool 抽象基类。所有外部能力必须实现此接口。"""
    name: str = "base"
    description: str = ""
    parameters_schema: Dict[str, Any] = {}

    @abstractmethod
    async def execute(self, input: ToolInput) -> ToolOutput:
        """核心执行方法（与 ContentForge 签名完全兼容）"""
        pass

    def validate_params(self, params: Dict[str, Any]) -> bool:
        required = self.parameters_schema.get("required", [])
        for field in required:
            if field not in params:
                return False
        return True
```

### 2.3 TaskContext

```python
# core/task_context.py

from typing import Any, Dict, List, Optional
from datetime import datetime

class TaskContext:
    """任务执行上下文，贯穿整个执行过程。"""
    task_id: str
    persona: Optional[str] = None
    input_data: Dict[str, Any]
    metadata: Dict[str, Any]
    state: Dict[str, Any]
    tools: 'ToolRegistry'
    agents: 'AgentRegistry'
    mode: Optional[str] = None           # 执行模式: react/reflexion/workflow/...
    interaction_mode: str = "standard"   # 交互模式: standard / solo
    checkpoint: 'CheckpointManager'
    event_bus: 'EventBus'
    memory: 'MemoryManager'
    executor: Optional['HybridExecutor'] = None
    created_at: str = None

    def __init__(self, task_id: str, input_data: dict, **kwargs):
        self.task_id = task_id
        self.input_data = input_data
        self.metadata = kwargs.pop('metadata', {})
        self.state = kwargs.pop('state', {})
        self.tools = kwargs.pop('tools', None)
        self.agents = kwargs.pop('agents', None)
        self.mode = kwargs.pop('mode', None)
        self.interaction_mode = kwargs.pop('interaction_mode', 'standard')
        self.checkpoint = kwargs.pop('checkpoint', None)
        self.event_bus = kwargs.pop('event_bus', None)
        self.memory = kwargs.pop('memory', None)
        self.executor = kwargs.pop('executor', None)
        self.persona = kwargs.pop('persona', None)
        self.created_at = datetime.utcnow().isoformat()

    @classmethod
    def from_parent(cls, parent: 'TaskContext', **overrides) -> 'TaskContext':
        """创建子任务上下文，共享只读资源，深拷贝可变状态。"""
        child = cls(
            task_id=parent.task_id + "/sub",
            input_data=overrides.get('input_data', parent.input_data),
            metadata={**parent.metadata, **overrides.get('metadata', {})},
            state=overrides.get('state', parent.state.copy()),
            tools=parent.tools,
            agents=parent.agents,
            mode=parent.mode,
            interaction_mode=parent.interaction_mode,
            checkpoint=parent.checkpoint,
            event_bus=parent.event_bus,
            memory=parent.memory,
            executor=parent.executor,
            persona=parent.persona,
        )
        return child
```

### 2.4 统一异常层次

```python
# core/errors.py

class FlowForgeError(Exception):
    status_code: int = 500
    detail: str = "Internal flowforge error"

class ConfigurationError(FlowForgeError):
    status_code = 400
    detail = "Configuration error"

class ModeNotFoundError(FlowForgeError):
    status_code = 404
    detail = "Mode not found"

class WorkflowRecursionError(FlowForgeError):
    status_code = 400
    detail = "Workflow recursion depth exceeded"

class ConflictError(FlowForgeError):
    status_code = 409
    detail = "Resource conflict"
```

***

## 第三章：依赖注入容器

```python
# core/di.py

from typing import Any, Callable, Dict

class DIContainer:
    """轻量级 DI 容器，Phase 1 手动实现。"""

    def __init__(self):
        self._registry: Dict[str, Callable] = {}
        self._instances: Dict[str, Any] = {}
        self._agent_keys: set = set()

    def register_singleton(self, name: str, factory: Callable) -> None:
        self._registry[name] = factory

    def register_agent(self, name: str, factory: Callable) -> None:
        self._registry[name] = factory
        self._agent_keys.add(name)

    def register_instance(self, name: str, instance: Any) -> None:
        self._instances[name] = instance

    def resolve(self, name: str) -> Any:
        if name in self._instances:
            return self._instances[name]
        if name not in self._registry:
            raise KeyError(f"Dependency '{name}' not registered")
        factory = self._registry[name]
        instance = factory()
        self._instances[name] = instance
        return instance

    def resolve_all_agents(self) -> Dict[str, Any]:
        """仅解析已注册的 Agent，排除 Tool、EventBus 等非 Agent 组件。"""
        return {k: self.resolve(k) for k in self._agent_keys}
```

***

## 第四章：模式注册中心与混合执行器

### 4.1 ModeRegistry

```python
# modes/registry.py

from typing import Dict
from core.base_mode_executor import BaseModeExecutor
from core.errors import ModeNotFoundError

class ModeRegistry:
    """模式注册中心。支持动态注册、查询和智能推荐。"""

    def __init__(self):
        self._modes: Dict[str, BaseModeExecutor] = {}

    def register(self, executor: BaseModeExecutor) -> None:
        if executor.mode_name in self._modes:
            raise ValueError(f"Mode '{executor.mode_name}' already registered")
        self._modes[executor.mode_name] = executor

    def get(self, mode_name: str) -> BaseModeExecutor:
        if mode_name not in self._modes:
            raise ModeNotFoundError(f"Mode '{mode_name}' not found")
        return self._modes[mode_name]

    def suggest_mode(self, task_description: str) -> str:
        desc = task_description.lower()
        if any(w in desc for w in ["复杂", "推理", "数学", "证明"]):
            return "graph_of_thoughts"
        if any(w in desc for w in ["多步", "搜索", "查询"]):
            return "react"
        if any(w in desc for w in ["计划", "流程", "步骤"]):
            return "plan_execute"
        if any(w in desc for w in ["生成", "写作", "代码"]):
            return "reflexion"
        return "workflow"
```

### 4.2 HybridExecutor

```python
# executor/hybrid_executor.py

from typing import Dict, Optional
from core.task_context import TaskContext
from core.errors import ConflictError
from modes.registry import ModeRegistry
from events.event_bus import EventBus
from events.solo_adapter import EventBusSoloAdapter

class HybridExecutor:
    """FlowForge 统一执行入口。"""

    def __init__(self, mode_registry: ModeRegistry, agent_registry, tool_registry,
                 event_bus: EventBus, task_repo=None, audit_repo=None,
                 checkpointer_path="data/checkpoints.db"):
        self.mode_registry = mode_registry
        self.agent_registry = agent_registry
        self.tool_registry = tool_registry
        self.event_bus = event_bus
        self.task_repo = task_repo
        self.audit_repo = audit_repo
        self.checkpointer_path = checkpointer_path
        self._running_tasks: Dict[str, str] = {}
        self._solo_adapter: Optional[EventBusSoloAdapter] = None

    def set_solo_manager(self, solo_manager):
        """注入 SoloWSManager，建立事件桥接"""
        self._solo_adapter = EventBusSoloAdapter(self.event_bus, solo_manager)

    async def run(self, context: TaskContext, mode_hint: str = None,
                  _is_substep: bool = False) -> dict:
        """执行任务。_is_substep=True 时跳过 Persona 锁检查（供 Workflow 子步骤使用）。"""
        persona = context.persona or "default"

        if not _is_substep:
            if persona in self._running_tasks:
                raise ConflictError(
                    f"Persona '{persona}' already running task {self._running_tasks[persona]}")
            self._running_tasks[persona] = context.task_id

        if mode_hint is None and context.mode is None:
            mode = self.mode_registry.suggest_mode(context.input_data.get("task", ""))
        else:
            mode = mode_hint or context.mode

        if context.interaction_mode == "solo" and self._solo_adapter:
            self._solo_adapter.bridge()

        executor = self.mode_registry.get(mode)
        context.tools = self.tool_registry
        context.agents = self.agent_registry
        context.executor = self
        context.mode = mode

        try:
            self.event_bus.emit(context.task_id, "task.start", {"mode": mode})
            result = await executor.run(context)
            self.event_bus.emit(context.task_id, "task.completed", {"result": result})
            return result
        except Exception as e:
            self.event_bus.emit(context.task_id, "task.error", {"error": str(e)})
            raise
        finally:
            if not _is_substep and persona in self._running_tasks:
                del self._running_tasks[persona]

    async def submit_review(self, task_id: str, verdict: str, feedback: str = "", edited_draft: str = ""):
        pass

    async def pause_task(self, task_id: str):
        self.event_bus.emit(task_id, "task.paused", {"reason": "manual"})

    async def resume_task(self, task_id: str):
        self.event_bus.emit(task_id, "task.resumed", {})

    async def get_task_snapshot(self, task_id: str) -> dict:
        pass
```

***

## 第五章：事件总线与 Solo 集成

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

### 5.2 EventBusSoloAdapter

```python
# events/solo_adapter.py

from .event_bus import EventBus

class EventBusSoloAdapter:
    """将 FlowForge EventBus 事件桥接到 ContentForge SoloWSManager。
    全局订阅 + task_id 路由：SoloWSManager 按 task_id 维护连接映射，
    emit_event(task_id, ...) 只会发送到正确的 WebSocket 连接。"""

    EVENT_MAP = {
        "workflow.step.start": "solo.stage.enter",
        "mode.enter": "solo.stage.enter",
        "tool.start": "solo.tool.start",
        "tool.end": "solo.tool.end",
        "llm.start": "solo.llm.start",
        "llm.reasoning": "solo.llm.reasoning",
        "llm.stream": "solo.llm.stream",
        "llm.end": "solo.llm.end",
        "draft.update": "solo.draft.update",
        "step.intermediate": "solo.step.intermediate",
        "review.ready": "solo.review.ready",
        "review.submitted": "solo.review.submitted",
        "task.paused": "solo.task.paused",
        "task.resumed": "solo.task.resumed",
        "task.completed": "solo.task.completed",
        "task.error": "solo.task.error",
        "token.stats": "solo.token.stats",
    }

    def __init__(self, event_bus: EventBus, solo_manager):
        self.event_bus = event_bus
        self.solo_manager = solo_manager
        self._bridged = False

    def bridge(self):
        if self._bridged:
            return
        for flowforge_event, solo_event_type in self.EVENT_MAP.items():
            def make_callback(etype=solo_event_type):
                async def callback(event):
                    await self.solo_manager.emit_event(
                        event["task_id"], etype, event["payload"])
                return callback
            self.event_bus.subscribe(flowforge_event, make_callback())
        self._bridged = True
```

***

## 第六章：Database Schema

```sql
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    persona TEXT,
    mode TEXT,
    interaction_mode TEXT DEFAULT 'standard',
    status TEXT DEFAULT 'pending',
    trace_id TEXT,
    state_json TEXT,
    created_at TEXT,
    completed_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    level TEXT NOT NULL,
    task_id TEXT,
    step_name TEXT,
    agent_name TEXT,
    action TEXT,
    detail TEXT,
    trace_id TEXT
);

CREATE TABLE IF NOT EXISTS model_health (
    model_key TEXT PRIMARY KEY,
    status TEXT,
    last_check TEXT,
    error_count INTEGER,
    disabled_until TEXT,
    reason TEXT
);
```

***

## 第七章：九大模式执行器详细设计

### 7.1 模式基类 (`BaseModeExecutor`)

```python
# core/base_mode_executor.py

from abc import ABC, abstractmethod
from typing import List
from core.task_context import TaskContext

class BaseModeExecutor(ABC):
    mode_name: str
    capabilities: List[str] = []

    async def _prepare(self, ctx: TaskContext) -> TaskContext:
        return ctx

    @abstractmethod
    async def _execute_core(self, ctx: TaskContext) -> dict:
        pass

    async def _postprocess(self, ctx: TaskContext, result: dict) -> dict:
        return result

    async def run(self, ctx: TaskContext) -> dict:
        ctx = await self._prepare(ctx)
        result = await self._execute_core(ctx)
        return await self._postprocess(ctx, result)
```

### 7.2 ReAct 执行器

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

### 7.3 Plan-and-Execute 执行器

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

### 7.4 Reflexion 执行器

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

### 7.5 DefaultLLM 系列（默认 Actor/Evaluator/Reflector）

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

### 7.6 Multi-Agent 执行器

```python
# modes/multi_agent.py

import asyncio
from core.base_mode_executor import BaseModeExecutor
from core.base_agent import AgentInput
from core.task_context import TaskContext

class MultiAgentExecutor(BaseModeExecutor):
    mode_name = "multi_agent"
    capabilities = ["collaboration"]

    async def _execute_core(self, ctx: TaskContext) -> dict:
        task = ctx.input_data.get("task", "")
        participants = ctx.metadata.get("participants", ["researcher", "writer", "reviewer"])
        results = {}

        async def run_agent(name):
            agent = ctx.agents.get(name)
            if agent:
                agent_input = AgentInput(params={"task": task})
                if hasattr(agent, 'execute_with_context'):
                    output = await agent.execute_with_context(agent_input, ctx)
                else:
                    output = await agent.execute(agent_input)
                return name, output.result
            return name, None

        tasks = [run_agent(name) for name in participants]
        for coro in asyncio.as_completed(tasks):
            name, result = await coro
            if result:
                results[name] = result
        return {"results": results}
```

### 7.7 Workflow 执行器

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

    async def _execute_core(self, ctx: TaskContext) -> dict:
        sop_steps = ctx.metadata.get("sop_steps", [])
        context_data = ctx.input_data.copy()
        depth = ctx.metadata.get("_workflow_depth", 0)
        if depth >= self.MAX_DEPTH:
            raise WorkflowRecursionError("Max workflow depth exceeded")

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

### 7.8 其余模式执行器概要

- **GraphOfThoughts**：维护图结构，支持分支、合并、循环，通过投票机制收敛。
- **ReWOO**：生成 Blueprint JSON，包含多个 Tool 调用计划，然后并发执行。
- **SelfDiscover**：调用 LLM 分析任务，输出推荐的思维框架（模式名称）。
- **AgentJudge**：注册两个 Agent：actor 和 judge；先 actor 执行，judge 评估，可选多轮。

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

`MaterialCollectionAgent`、`ArticleWritingAgent`、`SEOOptimizationAgent`、`FactCheckAgent`、`ContentAuditAgent`、`HeadlineOptimizerAgent`、`ContentRepurposerAgent`、`TrendAnalysisAgent`、`PublishingAgent`、`ImageResearchAgent`、`MultilingualAgent` 均遵循相同模式：覆写 `execute_with_context`，通过 `context.tools` 获取工具。

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
# core/plugin_manager.py

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

## 第十一章：Tool 系统与沙箱安全机制

### 11.1 统一 Tool 注册与调用

```python
# tools/registry.py

import time
from typing import Dict, Optional, Callable
from core.base_tool import BaseTool, ToolInput, ToolOutput

class ToolRegistry:
    def __init__(self):
        self._tools: Dict[str, BaseTool] = {}

    def register(self, tool: BaseTool):
        if tool.name in self._tools:
            raise ValueError(f"Tool '{tool.name}' already registered")
        self._tools[tool.name] = tool

    def get_tool(self, name: str) -> BaseTool:
        if name not in self._tools:
            raise KeyError(f"Tool '{name}' not found")
        return self._tools[name]

    async def execute(self, name: str, input: ToolInput, emit_callback=None) -> ToolOutput:
        tool = self.get_tool(name)
        if not tool.validate_params(input.params):
            raise ValueError(f"Invalid params for tool '{name}'")

        if emit_callback:
            await emit_callback("tool.start", {"tool_name": name, "params": input.params})

        start = time.time()
        try:
            result = await tool.execute(input)
        except Exception as e:
            if emit_callback:
                await emit_callback("tool.end", {"tool_name": name, "error": str(e), "duration_ms": int((time.time()-start)*1000)})
            raise

        if emit_callback:
            await emit_callback("tool.end", {"tool_name": name, "result": result.result, "duration_ms": int((time.time()-start)*1000)})
        return result
```

### 11.2 沙箱执行器 (`PythonExecutorTool`)

```python
# tools/python_executor.py

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

### 11.3 文件系统 Tool (受限)

```python
# tools/file_rw.py

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
    def __init__(self, config: dict):
        self.working = WorkingMemory()
        self.short_term = ShortTermMemory(config.get("db_url"))
        self.long_term = LongTermMemory(config.get("db_url"))
        self.semantic = SemanticMemory() if config.get("vector_db_url") else None
        self.episodic = EpisodicMemory(config.get("db_url"))

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
```

### 12.2 记忆存储后端

| 记忆类型            | Phase 1 实现                  | Phase 2 升级       |
| --------------- | --------------------------- | ---------------- |
| WorkingMemory   | Python dict                 | 无需升级             |
| ShortTermMemory | SQLite (带过期清理任务)            | 迁移至 Redis        |
| LongTermMemory  | SQLite (表结构复用 ContentForge) | 迁移至 PostgreSQL   |
| SemanticMemory  | 未启用 (返回空列表)                 | 接入 Qdrant/BGE-M3 |
| EpisodicMemory  | SQLite (json 字段)            | 增加向量化            |

***

## 第十三章：安全机制总结

| 安全层            | 机制                                                  | 实现位置                                            |
| -------------- | --------------------------------------------------- | ----------------------------------------------- |
| **Agent 隔离**   | 严格的 `BaseAgent` 接口；Agent 不能直接调用 OS 命令               | `core/base_agent.py`                            |
| **Tool 权限**    | 所有 Tool 通过 `ToolRegistry` 调用；沙箱 Tool 进程隔离           | `tools/registry.py`, `tools/python_executor.py` |
| **代码沙箱**       | 子进程执行、资源限制、移除危险内置函数、临时目录隔离                          | `tools/python_executor.py`                      |
| **文件系统路径穿越防护** | `_validate_path()` 确保路径在允许目录内                       | `tools/file_rw.py`                              |
| **并发冲突**       | Persona 锁 (`HybridExecutor._running_tasks`)，子步骤跳过锁  | `executor/hybrid_executor.py`                   |
| **循环检测**       | ReAct 模式的 `_is_loop`；Workflow 的 `MAX_DEPTH`         | `modes/react.py`, `modes/workflow.py`           |
| **审批流**        | Workflow 模式原生支持 `human: true` 节点，`asyncio.Event` 暂停 | `modes/workflow.py`                             |
| **审计与追踪**      | 每个任务生成唯一 `trace_id`；所有操作记录到 `audit_logs`            | `events/event_bus.py`, DB 表 `audit_logs`        |

***

# FlowForge 详细设计说明书 v5.0（防御与协作增强版）

> **对应架构文档**：FlowForge v5.0
> **状态**：增量更新，v2.0 内容保持不变，本部分仅描述 v5.0 新增内容
> **设计依据**：Claude Code 架构深度分析，融合 TAOR 循环、Compressor、Fail-closed 工具、三层多 Agent 策略

***

## 第十四章：三层防御体系详细设计

### 14.1 防御分层总览

三层防御**分层实现**，每一层驻留在最合适的模块中：

| 防御层         | 位置                                                                         | 机制                            | 默认值            |
| ----------- | -------------------------------------------------------------------------- | ----------------------------- | -------------- |
| **L1 超时**   | `flowforge.tools.registry.ToolRegistry.execute()`                          | `asyncio.wait_for()` 包裹单次工具调用 | 120s           |
| **L2 重复检测** | `flowforge.core.base_mode_executor.BaseModeExecutor._on_exit()`            | hash-based 重复检测钩子             | threshold=3    |
| **L3 自修正**  | `flowforge.modes.workflow.WorkflowExecutor` → `on_error="reflexion_retry"` | Reflexion 分析失败原因后重试           | retry\_count=2 |

### 14.2 L1：ToolRegistry 超时防御

```python
from flowforge.tools.registry import ToolRegistry

class ToolRegistry:
    def __init__(self, tool_timeout: int = 120):
        self._tools: Dict[str, BaseTool] = {}
        self._emit_callback: Optional[Callable] = None
        self._tool_timeout = tool_timeout

    async def execute(self, name: str, input: ToolInput) -> ToolOutput:
        tool = self.get_tool(name)
        if not tool.validate_params(input.params):
            raise ValueError(f"Invalid params for tool '{name}'")

        start = time.time()
        try:
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
            raise
        return result
```

**设计决策**：

- 超时后返回 `ToolOutput(error=...)` 而非抛异常，避免中断整个执行流
- `tool_timeout` 可在构造时配置，也可通过 `ctx.metadata["defense"]["tool_timeout"]` 覆盖
- 与全局 `TASK_TIMEOUT_SECONDS` 互补，L1 是单次工具级，全局是任务级

### 14.3 L2：BaseModeExecutor 生命周期钩子

```python
from flowforge.core.base_mode_executor import BaseModeExecutor

class BaseModeExecutor(ABC):
    mode_name: str
    capabilities: List[str] = []

    async def _prepare(self, ctx: TaskContext) -> TaskContext:
        return ctx

    async def _on_enter(self, ctx: TaskContext):
        pass

    @abstractmethod
    async def _execute_core(self, ctx: TaskContext) -> dict:
        pass

    async def _on_exit(self, ctx: TaskContext, result: dict) -> dict:
        return result

    async def _postprocess(self, ctx: TaskContext, result: dict) -> dict:
        return result

    async def run(self, ctx: TaskContext) -> dict:
        ctx = await self._prepare(ctx)
        await self._on_enter(ctx)
        result = await self._execute_core(ctx)
        result = await self._on_exit(ctx, result)
        return await self._postprocess(ctx, result)
```

**设计决策**：

- `_on_enter` / `_on_exit` 为空实现，子类按需覆写
- `ReActExecutor` 已有 `_is_loop()` 检测，无需额外覆写
- `WorkflowExecutor` 的 ReAct loop 内置 `repetition_limit` 检测
- 生命周期：`prepare → on_enter → execute_core → on_exit → postprocess`

### 14.4 L3：WorkflowExecutor 自修正策略

在 `WorkflowExecutor._execute_sop_steps()` 中，`on_error` 新增 `"reflexion_retry"` 策略：

```python
class WorkflowExecutor(BaseModeExecutor):
    DEFAULT_DEFENSE = {
        "max_tool_calls": 50,
        "tool_timeout": 120,
        "repetition_limit": 3,
        "reflexion_retries": 2,
        "checkpoint_enabled": True,
    }

    async def _execute_sop_steps(self, ctx, sop_steps, context_data, depth):
        defense_config = {**self.DEFAULT_DEFENSE, **ctx.metadata.get("defense", {})}
        ctx.metadata["_defense"] = defense_config

        for step in sop_steps:
            # ... agent execution or mode execution ...
            except Exception as e:
                on_error = step.get("on_error", "abort")
                if on_error == "reflexion_retry":
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
                            # retry original step
                            break
                        except Exception:
                            if i == retry_count - 1:
                                raise
```

**四种 on\_error 策略对比**：

| 策略                | 行为                       | 适用场景        |
| ----------------- | ------------------------ | ----------- |
| `abort`（默认）       | 直接抛出异常，终止 Workflow       | 关键步骤不可跳过    |
| `skip`            | 跳过失败步骤，继续执行              | 非关键步骤       |
| `retry`           | 等待后重试 N 次                | 临时性故障（网络抖动） |
| `reflexion_retry` | Reflexion 分析原因 → 修正 → 重试 | 逻辑性错误需要自修正  |

### 14.5 防御配置传递

防御参数通过 `ctx.metadata["defense"]` 传递，支持全局 + 步骤级覆盖：

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

合并逻辑：

```python
defense_config = {**self.DEFAULT_DEFENSE, **ctx.metadata.get("defense", {})}
step_defense = {**defense_config, **step.get("defense", {})}
```

***

## 第十五章：上下文压缩系统详细设计

### 15.1 ContextCompressor

```python
from flowforge.memory.compressor import ContextCompressor

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
```

### 15.2 Token 计数策略

优先使用 tiktoken 真实计数，不可用时回退到字符估算（`len(text) // 4`）：

```python
try:
    import tiktoken
    _tokenizer = tiktoken.get_encoding("cl100k_base")
    def _count_tokens(text: str) -> int:
        return len(_tokenizer.encode(text))
except Exception:
    def _count_tokens(text: str) -> int:
        return max(1, len(text) // 4)
```

### 15.3 滑动窗口 + 摘要策略

1. 扫描所有消息，标记 `_is_decision_or_tool_result()` 的消息为"关键轮次边界"
2. 保留最近 3 个关键轮次作为 "recent"
3. 早期历史通过 LLM 压缩为一条 system 摘要消息
4. 压缩后消息列表 = `[摘要消息] + 最近关键轮次`

```python
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
```

### 15.4 关键消息判断

基于消息角色和结构判断，**不依赖关键词**：

```python
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
```

### 15.5 LLM 调用方式

ContextCompressor 通过 `context.tools.get_tool("llm")` 调用 LLM，**不直接持有 LLM 客户端引用**：

```python
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

### 15.6 MemoryManager 集成

```python
from flowforge.memory.manager import MemoryManager

class MemoryManager:
    def __init__(self, config: dict, llm_client=None):
        # ... existing stores ...
        self.compressor = ContextCompressor(llm_client) \
            if llm_client and config.get("compression_enabled", True) else None

    async def compress_messages(self, messages: list, context=None) -> list:
        if self.compressor:
            return await self.compressor.compress_if_needed(messages, context)
        return messages
```

压缩摘要自动通过 `_save_to_memory()` 存储到长期记忆，供未来检索使用。

***

## 第十六章：安全工具体系详细设计

### 16.1 BaseTool 安全标记

`BaseTool` 新增两个类属性，**有默认值，不破坏现有接口**：

```python
from flowforge.core.base_tool import BaseTool

class BaseTool(ABC):
    name: str = "base"
    description: str = ""
    parameters_schema: Dict[str, Any] = {}
    safety_level: str = "normal"          # readonly / normal / dangerous
    is_concurrency_safe: bool = True      # 是否并发安全
```

安全等级语义：

| safety\_level | 含义   | 审批要求    | 典型工具         |
| ------------- | ---- | ------- | ------------ |
| `readonly`    | 只读操作 | 无需审批    | 搜索、检索、LLM 调用 |
| `normal`      | 常规操作 | 仅并发时需注意 | 文件写入、数据转换    |
| `dangerous`   | 危险操作 | 需人工审批   | 代码执行、删除、发布   |

### 16.2 SecureToolRegistry

```python
from flowforge.tools.secure_registry import SecureToolRegistry

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
```

### 16.3 审批流程

审批流程复用 `HybridExecutor.register_review_wait()` + EventBus 机制：

```python
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

**设计决策**：

- 不使用 `context._await_approval`，避免在 TaskContext 上添加私有方法
- 复用已有的 `register_review_wait()` + EventBus 机制
- 默认拒绝（fail-closed），无审批流程时 dangerous 工具不可执行

### 16.4 并发安全

通过 `asyncio.Lock` 保护非并发安全工具，每个工具名对应一把锁：

```python
if not getattr(tool, 'is_concurrency_safe', True):
    if name not in self._running_tools:
        self._running_tools[name] = asyncio.Lock()
    async with self._running_tools[name]:
        return await super().execute(name, input)
```

### 16.5 安全等级动态设置

```python
def set_tool_safety(self, name: str, level: str):
    tool = self.get_tool(name)
    tool.safety_level = level
```

***

## 第十七章：Multi-Agent 三策略详细设计

### 17.1 MultiAgentExecutor 策略分发

```python
from flowforge.modes.multi_agent import MultiAgentExecutor

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
```

### 17.2 Subagents：无状态并行隔离

每个子任务拥有完全独立的上下文窗口，无历史污染：

```python
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

### 17.3 Agent Teams：共享任务板 + 信箱通信

Lead Agent 分解任务 → TaskBoard 发布 → 团队成员认领执行 → Mailbox 通信 → Lead 聚合结果：

```python
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
```

**空闲检测**：通过 hash 比较任务板状态，连续 N 轮无变化则退出。

### 17.4 Swarms：去中心化集群

SwarmWorker 持续认领任务 + 心跳监控 + SwarmCoordinator 检测失联节点：

```python
from flowforge.modes.multi_agent import SwarmWorker, SwarmCoordinator, SwarmConfig

class SwarmConfig:
    max_workers: int = 10
    task_claim_timeout: int = 300
    heartbeat_interval: int = 30
    max_retry_per_task: int = 3
    max_empty_rounds: int = 30

class SwarmWorker:
    def __init__(self, agent, task_board, mailbox, config):
        self.agent = agent
        self.task_board = task_board
        self.mailbox = mailbox
        self.config = config
        self.running = False

    async def run(self, ctx: TaskContext):
        self.running = True
        self._heartbeat_task = asyncio.create_task(self._heartbeat(ctx))
        empty_rounds = 0

        while self.running:
            task = await self.task_board.claim_task(self.agent.name)
            if task is None:
                empty_rounds += 1
                if empty_rounds >= self.config.max_empty_rounds:
                    break
                all_tasks = await self.task_board.get_all_tasks()
                if all(t["status"] in ("completed", "failed") for t in all_tasks):
                    break
                await asyncio.sleep(1)
                continue

            empty_rounds = 0
            try:
                result = await self._execute_task(task, ctx)
                await self.task_board.complete_task(task["task_id"], result)
            except Exception as e:
                # retry logic with max_retry_per_task
                ...

        if self._heartbeat_task:
            self._heartbeat_task.cancel()

class SwarmCoordinator:
    async def monitor(self, ctx: TaskContext):
        while True:
            messages = await self.mailbox.receive(
                "coordinator", subject_contains="heartbeat",
                unread_only=True, limit=100
            )
            for msg in messages:
                self._worker_heartbeats[msg["sender"]] = time.time()

            now = time.time()
            for worker_name in list(self._worker_heartbeats.keys()):
                if now - self._worker_heartbeats[worker_name] > self.config.heartbeat_interval * 3:
                    await self.task_board.reset_stuck_tasks(self.config.task_claim_timeout)
                    del self._worker_heartbeats[worker_name]

            await asyncio.sleep(self.config.heartbeat_interval)
```

### 17.5 三策略对比

| 维度       | Subagents                           | Agent Teams     | Swarms              |
| -------- | ----------------------------------- | --------------- | ------------------- |
| **状态**   | 无状态，完全隔离                            | 共享 TaskBoard    | 去中心化，各自认领           |
| **通信**   | 无（结果压缩返回）                           | Mailbox 信箱      | Mailbox + 心跳        |
| **协调**   | 无（并行执行）                             | Lead Agent 协调   | SwarmCoordinator 监控 |
| **适用场景** | 独立子任务并行                             | 多角色协作           | 大规模分布式任务            |
| **上下文**  | `TaskContext.from_parent(state={})` | 共享 TaskBoard 状态 | 各自独立 + TaskBoard    |
| **容错**   | 单任务失败不影响其他                          | Lead 可重新规划      | 心跳检测 + 自动重发布        |
| **退出条件** | 全部完成                                | 全部完成 或 空闲超限     | 全部完成 或 空闲超限         |

***

## 第十八章：协作基础设施详细设计

### 18.1 TaskBoard：原子化共享任务板

```python
from flowforge.memory.task_board import TaskBoard

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
```

**数据库 Schema**：

```sql
CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT UNIQUE NOT NULL,
    task_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    claimed_by TEXT,
    created_at TEXT NOT NULL,
    claimed_at TEXT,
    completed_at TEXT,
    error_message TEXT
);
```

**原子认领双策略**：

| 策略           | 条件            | 实现                                    |
| ------------ | ------------- | ------------------------------------- |
| RETURNING 子句 | SQLite ≥ 3.35 | `UPDATE ... RETURNING` 单条 SQL 原子操作    |
| 应用层锁         | SQLite < 3.35 | `asyncio.Lock` + SELECT + UPDATE 两步操作 |

```python
async def claim_task(self, claimant: str, task_type: Optional[str] = None) -> Optional[dict]:
    if self._supports_returning:
        return await self._claim_atomic_returning(claimant, task_type)
    else:
        return await self._claim_with_lock(claimant, task_type)
```

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

### 18.2 Mailbox：优先级 + 过期信箱

```python
from flowforge.memory.mailbox import Mailbox

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

**数据库 Schema**：

```sql
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender TEXT NOT NULL,
    recipient TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'normal',
    tags TEXT,
    read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    expires_at TEXT
);
CREATE INDEX idx_recipient ON messages (recipient);
CREATE INDEX idx_recipient_priority ON messages (recipient, priority);
CREATE INDEX idx_expires ON messages (expires_at);
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

***

## 第十九章：CheckpointManager 增强详细设计

### 19.1 Schema 迁移

`_ensure_schema()` 实现向后兼容的自动迁移：

```python
def _ensure_schema(self):
    cursor = self._conn.execute("PRAGMA table_info(checkpoints)")
    columns = {row[1] for row in cursor.fetchall()}

    if not columns:
        # 全新创建
        self._conn.execute("""CREATE TABLE checkpoints (...)""")
        return

    if "id" not in columns:
        # 旧 schema → 新 schema 迁移
        self._conn.execute("ALTER TABLE checkpoints RENAME TO _checkpoints_old")
        self._conn.execute("""CREATE TABLE checkpoints (...)""")
        self._conn.execute("""INSERT INTO ... SELECT ... FROM _checkpoints_old""")
        self._conn.execute("DROP TABLE _checkpoints_old")
    else:
        # 增量添加新列
        if "messages_json" not in columns:
            self._conn.execute("ALTER TABLE checkpoints ADD COLUMN messages_json TEXT")
        if "version" not in columns:
            self._conn.execute("ALTER TABLE checkpoints ADD COLUMN version INTEGER DEFAULT 1")
        if "label" not in columns:
            self._conn.execute("ALTER TABLE checkpoints ADD COLUMN label TEXT DEFAULT ''")
```

### 19.2 新增方法

| 方法                                                  | 说明                             | 返回值                                 |
| --------------------------------------------------- | ------------------------------ | ----------------------------------- |
| `save_full(task_id, state, messages, label)`        | 完整保存（state + messages + 自动版本号） | checkpoint row id                   |
| `save_incremental(task_id, state, messages, label)` | 增量保存（无变更则跳过）                   | checkpoint row id                   |
| `restore(task_id, checkpoint_id=None)`              | 恢复 state + messages            | `{"state": dict, "messages": list}` |
| `get_latest(task_id)`                               | 获取最新检查点完整信息                    | dict or None                        |
| `delete_old_versions(task_id, keep_latest=5)`       | 清理旧版本                          | 删除数量                                |

### 19.3 保留的旧方法

| 方法                                | 说明                   |
| --------------------------------- | -------------------- |
| `save(task_id, step_name, state)` | 保存/更新指定步骤的检查点（版本号自增） |
| `load(task_id, step_name)`        | 加载指定步骤的 state        |
| `load_latest(task_id)`            | 加载最新 state           |
| `delete(task_id)`                 | 删除任务所有检查点            |
| `list_checkpoints(task_id)`       | 列出任务所有检查点            |

***

## 第二十章：v5.0 安全机制增强总结

在 v4.0 安全机制基础上，v5.0 新增：

| 安全层          | 机制                                        | 实现位置                         |
| ------------ | ----------------------------------------- | ---------------------------- |
| **L1 工具超时**  | `asyncio.wait_for()` 包裹单次工具调用             | `tools/registry.py`          |
| **L2 重复检测**  | `_on_exit()` 生命周期钩子                       | `core/base_mode_executor.py` |
| **L3 自修正**   | `on_error="reflexion_retry"` 策略           | `modes/workflow.py`          |
| **工具安全分级**   | `safety_level`（readonly/normal/dangerous） | `core/base_tool.py`          |
| **并发安全**     | `asyncio.Lock` 保护非并发安全工具                  | `tools/secure_registry.py`   |
| **危险工具审批**   | EventBus + `register_review_wait()`       | `tools/secure_registry.py`   |
| **上下文压缩**    | tiktoken 计数 + 滑动窗口摘要                      | `memory/compressor.py`       |
| **SOP 防御配置** | 全局 + 步骤级 defense 配置                       | `modes/workflow.py`          |

***

## 第二十一章：v5.0 新增目录结构

```
flowforge/
├── core/
│   ├── base_tool.py               # +safety_level, +is_concurrency_safe
│   ├── base_mode_executor.py      # +_on_enter(), +_on_exit()
│   └── checkpoint_manager.py      # +save_full, +save_incremental, +restore, +get_latest, +delete_old_versions
├── modes/
│   ├── multi_agent.py             # REWRITE: Subagents/Teams/Swarms 三策略
│   └── workflow.py                # +DEFAULT_DEFENSE, +reflexion_retry, +checkpoint, +template rendering
├── tools/
│   ├── registry.py                # +tool_timeout, +asyncio.wait_for
│   └── secure_registry.py         # NEW: SecureToolRegistry
├── memory/
│   ├── compressor.py              # NEW: ContextCompressor
│   ├── task_board.py              # NEW: TaskBoard
│   ├── mailbox.py                 # NEW: Mailbox
│   └── manager.py                 # +compressor, +compress_messages()
└── tests/
    ├── unit/
    │   ├── test_defense.py        # NEW: 三层防御测试
    │   ├── test_secure_registry.py # NEW: 安全工具注册表测试
    │   ├── test_task_board.py     # NEW: TaskBoard 测试
    │   ├── test_mailbox.py        # NEW: Mailbox 测试
    │   └── test_compressor.py     # NEW: ContextCompressor 测试
    └── ...
```

***

**以上为 FlowForge 详细设计说明书 v5.0（防御与协作增强版）。** 本版本在 v2.0 基础上新增三层防御、上下文压缩、安全工具、三种 Multi-Agent 策略、协作基础设施的详细设计，所有 v2.0 内容保持不变。
