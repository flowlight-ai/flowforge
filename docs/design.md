# FlowForge 详细设计说明书 v2.0

> **对应架构文档**：FlowForge v4.0
> **状态**：最终版，合并 v1.0 + v1.1 全部修复

---

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

---

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

---

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

---

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

---

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

---

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

---

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

```python
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
```

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

---

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

---

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

---

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

---

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

---

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

| 记忆类型 | Phase 1 实现 | Phase 2 升级 |
|---------|-------------|-------------|
| WorkingMemory | Python dict | 无需升级 |
| ShortTermMemory | SQLite (带过期清理任务) | 迁移至 Redis |
| LongTermMemory | SQLite (表结构复用 ContentForge) | 迁移至 PostgreSQL |
| SemanticMemory | 未启用 (返回空列表) | 接入 Qdrant/BGE-M3 |
| EpisodicMemory | SQLite (json 字段) | 增加向量化 |

---

## 第十三章：安全机制总结

| 安全层 | 机制 | 实现位置 |
|--------|------|---------|
| **Agent 隔离** | 严格的 `BaseAgent` 接口；Agent 不能直接调用 OS 命令 | `core/base_agent.py` |
| **Tool 权限** | 所有 Tool 通过 `ToolRegistry` 调用；沙箱 Tool 进程隔离 | `tools/registry.py`, `tools/python_executor.py` |
| **代码沙箱** | 子进程执行、资源限制、移除危险内置函数、临时目录隔离 | `tools/python_executor.py` |
| **文件系统路径穿越防护** | `_validate_path()` 确保路径在允许目录内 | `tools/file_rw.py` |
| **并发冲突** | Persona 锁 (`HybridExecutor._running_tasks`)，子步骤跳过锁 | `executor/hybrid_executor.py` |
| **循环检测** | ReAct 模式的 `_is_loop`；Workflow 的 `MAX_DEPTH` | `modes/react.py`, `modes/workflow.py` |
| **审批流** | Workflow 模式原生支持 `human: true` 节点，`asyncio.Event` 暂停 | `modes/workflow.py` |
| **审计与追踪** | 每个任务生成唯一 `trace_id`；所有操作记录到 `audit_logs` | `events/event_bus.py`, DB 表 `audit_logs` |
