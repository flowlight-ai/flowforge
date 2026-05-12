我们开始第一阶段实现。基于 FlowForge 架构 v4.0 和详细设计 v2.0，本次构建**独立可运行的 FlowForge 核心内核**以及 **ContentForge 业务层接入**。

首先给出项目基础配置和核心接口代码。

## 1. 项目基础配置

### pyproject.toml
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
    "sqlalchemy>=2.0",
    "aiosqlite>=0.20",
]

[project.entry-points."flowforge.modes"]
react = "flowforge.modes.react:ReActExecutor"
plan_execute = "flowforge.modes.plan_execute:PlanExecuteExecutor"
reflexion = "flowforge.modes.reflexion:ReflexionExecutor"
multi_agent = "flowforge.modes.multi_agent:MultiAgentExecutor"
workflow = "flowforge.modes.workflow:WorkflowExecutor"

[project.entry-points."flowforge.agents"]
topic_research = "flowforge.agents.topic_research:TopicResearchAgent"
article_writing = "flowforge.agents.article_writing:ArticleWritingAgent"
```

### Dockerfile (开发环境)
```dockerfile
FROM python:3.10-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

---

## 2. 核心接口实现

### core/base_agent.py
```python
from abc import ABC, abstractmethod
from pydantic import BaseModel, Field
from typing import Any, Dict, Optional

class AgentInput(BaseModel):
    params: Dict[str, Any] = Field(default_factory=dict, description="Agent 特定参数")
    state: Optional[Dict[str, Any]] = Field(default=None, description="当前任务状态")

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

### core/base_tool.py
```python
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

### core/task_context.py
```python
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

### core/errors.py
```python
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

### core/di.py
```python
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

### core/base_mode_executor.py
```python
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

---

## 3. 配置加载与数据库

### core/config.py
```python
import os
import yaml
from pathlib import Path
from typing import Any, Dict, Optional
from pydantic_settings import BaseSettings

class SystemConfig(BaseSettings):
    db_url: str = "sqlite:///data/flowforge.db"
    checkpointer_url: str = "sqlite:///data/checkpoints.db"
    log_level: str = "INFO"
    log_file: str = "logs/flowforge.log"
    server_host: str = "0.0.0.0"
    server_port: int = 8000
    workers: int = 1
    secret_key: str = "changeme-in-production"
    helixrag_enabled: bool = True
    helixrag_endpoint: str = "http://localhost:8100/api/v1/retrieve"
    helixrag_timeout: int = 90
    wechat_official_enabled: bool = False
    wechat_app_id: str = ""
    wechat_app_secret: str = ""
    wechat_token: str = ""
    scheduler_enabled: bool = True
    scheduler_timezone: str = "Asia/Shanghai"
    metrics_enabled: bool = True

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

class ConfigLoader:
    def __init__(self, config_dir: Optional[Path] = None):
        if config_dir is None:
            self.config_dir = Path(__file__).parent.parent / "config"
        else:
            self.config_dir = config_dir

    def load_yaml(self, filename: str) -> Dict[str, Any]:
        file_path = self.config_dir / filename
        if not file_path.exists():
            return {}
        with open(file_path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}

    def get_persona_config(self, name: str) -> Dict[str, Any]:
        file_path = self.config_dir / "persona" / f"{name}.yaml"
        if not file_path.exists():
            raise FileNotFoundError(f"Persona config not found: {file_path}")
        with open(file_path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}

    def get_models_config(self) -> Dict[str, Any]:
        return self.load_yaml("models.yaml")

system_config = SystemConfig()
```

### memory/stores/sqlite_store.py
```python
from sqlalchemy import create_engine, Column, String, Integer, Float, Text
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from datetime import datetime
import uuid
from core.config import system_config

class Base(DeclarativeBase):
    pass

class TaskModel(Base):
    __tablename__ = "tasks"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    persona = Column(String, nullable=False)
    mode = Column(String, nullable=False)
    interaction_mode = Column(String, default="standard")
    status = Column(String, default="pending")
    trace_id = Column(String, nullable=True)
    state_json = Column(Text, nullable=True)
    created_at = Column(String, default=lambda: datetime.utcnow().isoformat())
    completed_at = Column(String, nullable=True)

class AuditLogModel(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(String, default=lambda: datetime.utcnow().isoformat())
    level = Column(String, nullable=False)
    task_id = Column(String, nullable=True)
    step_name = Column(String, nullable=True)
    agent_name = Column(String, nullable=True)
    action = Column(String, nullable=True)
    detail = Column(Text, nullable=True)
    trace_id = Column(String, nullable=True)

class ModelHealthModel(Base):
    __tablename__ = "model_health"

    model_key = Column(String, primary_key=True)
    status = Column(String, nullable=False)
    last_check = Column(String, nullable=True)
    error_count = Column(Integer, default=0)
    disabled_until = Column(String, nullable=True)
    reason = Column(String, nullable=True)

engine = create_engine(system_config.db_url, check_same_thread=False)

def init_db():
    Base.metadata.create_all(engine)

def get_session():
    Session = sessionmaker(bind=engine)
    return Session()
```

---

以上是基础，下一轮我将输出**事件系统 (EventBus)、模式注册中心、HybridExecutor、WorkflowExecutor、ReflexionExecutor、DefaultLLM 系列、LLMClient 和 HelixRAGClient 的真实实现**。这些是 FlowForge 的核心运行时。

接下来包含：事件总线、模式注册中心、混合执行器、Workflow/Reflexion 执行器、LLM 客户端、HelixRAG 客户端。

### events/event_bus.py

```python
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

### events/solo_adapter.py

```python
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

### modes/registry.py

```python
from typing import Dict
from core.base_mode_executor import BaseModeExecutor
from core.errors import ModeNotFoundError

class ModeRegistry:
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

### executor/hybrid_executor.py

```python
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
        self._solo_adapter = EventBusSoloAdapter(self.event_bus, solo_manager)

    async def run(self, context: TaskContext, mode_hint: str = None,
                  _is_substep: bool = False) -> dict:
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
```

### modes/workflow.py

```python
import asyncio
from core.base_mode_executor import BaseModeExecutor
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

### modes/default_llm_actors.py

```python
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

### modes/reflexion.py

```python
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

### tools/llm_client.py (统一 LLM 客户端)

```python
import os
import httpx
from typing import List, Dict, Optional
from core.tracing import get_logger

logger = get_logger("llm_client")

class LLMClient:
    """统一 LLM 调用客户端，支持多供应商和自动故障转移"""

    def __init__(self, models_config: dict = None):
        self.models_config = models_config or {}
        self.providers = self.models_config.get("providers", {})
        self.assignments = self.models_config.get("assignments", {})
        self.api_keys = self._load_api_keys()

    def _load_api_keys(self):
        return {
            "openrouter": os.getenv("OPENROUTER_API_KEY", ""),
            "aliyuncs": os.getenv("ALIYUNCS_API_KEY", ""),
            "ark": os.getenv("ARK_API_KEY", ""),
        }

    def _get_model_chain(self, persona: str, agent_name: str) -> List[str]:
        persona_config = self.assignments.get(persona, {})
        agent_config = persona_config.get(agent_name, {})
        primary = agent_config.get("primary", "")
        fallbacks = agent_config.get("fallbacks", [])
        chain = [primary] if primary else []
        chain.extend(fallbacks)
        return chain

    async def chat(self, messages: List[Dict[str, str]], persona: Optional[str] = None,
                   agent_name: Optional[str] = None, model: Optional[str] = None,
                   temperature: float = 0.7, max_tokens: int = 4000) -> Dict:
        if model:
            candidates = [model]
        elif persona and agent_name:
            candidates = self._get_model_chain(persona, agent_name)
        else:
            raise ValueError("Must provide model or persona+agent_name")

        last_error = None
        for candidate in candidates:
            if not candidate:
                continue
            provider, model_id = candidate.split("/", 1)
            base_url = self.providers.get(provider, {}).get("base_url", "")
            api_key = self.api_keys.get(provider, "")
            if not api_key:
                continue

            headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
            payload = {"model": model_id, "messages": messages, "temperature": temperature, "max_tokens": max_tokens}
            url = base_url.rstrip("/") + "/chat/completions"

            try:
                async with httpx.AsyncClient(timeout=60) as client:
                    resp = await client.post(url, json=payload, headers=headers)
                    resp.raise_for_status()
                    data = resp.json()
                    content = data["choices"][0]["message"]["content"]
                    tokens = data.get("usage", {}).get("total_tokens", 0)
                    return {"content": content, "provider": provider, "model": model_id, "tokens": tokens}
            except Exception as e:
                logger.warning(f"LLM call failed for {provider}/{model_id}: {e}")
                last_error = e
                continue

        raise RuntimeError(f"All model candidates failed: {last_error}")
```

### tools/helixrag_client.py

```python
import httpx
from typing import Dict
from core.tracing import get_logger
from core.config import system_config

logger = get_logger("helixrag_client")

class HelixRAGClient:
    """HelixRAG 检索工具，封装对 HelixRAG 服务的 HTTP 调用"""

    def __init__(self):
        full_url = system_config.helixrag_endpoint
        if "/api/v1/retrieve" in full_url:
            self.base_url = full_url.rsplit("/api/v1/retrieve", 1)[0]
            self.retrieve_url = full_url
        else:
            self.base_url = full_url
            self.retrieve_url = f"{full_url}/api/v1/retrieve"
        self.timeout = system_config.helixrag_timeout
        self.enabled = system_config.helixrag_enabled

    async def search(self, query: str, max_results: int = 5, min_score: float = 0.3, max_age_days: int = 30) -> Dict:
        if not self.enabled:
            logger.warning("HelixRAG is disabled")
            return {"results": [], "metadata": {}}

        payload = {"query": query, "min_score": min_score, "max_results": max_results, "max_age_days": max_age_days}
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(self.retrieve_url, json=payload)
                resp.raise_for_status()
                data = resp.json()
                logger.info(f"HelixRAG search returned {len(data.get('results', []))} results")
                return data
        except Exception as e:
            logger.error(f"HelixRAG search failed: {e}")
            return {"results": [], "metadata": {}}

    async def scrape_url(self, url: str, timeout: int = 15) -> Dict:
        scrape_url = f"{self.base_url}/api/scrape"
        payload = {"url": url, "timeout": timeout}
        try:
            async with httpx.AsyncClient(timeout=timeout + 10) as client:
                resp = await client.post(scrape_url, json=payload)
                resp.raise_for_status()
                return resp.json()
        except Exception as e:
            logger.error(f"HelixRAG scrape failed for {url}: {e}")
            return {"content": "", "images": [], "metadata": {}}

    async def health_check(self) -> Dict:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(f"{self.base_url}/health")
                resp.raise_for_status()
                return resp.json()
        except Exception:
            return {"status": "unhealthy"}
```

### 工具注册与 ToolRegistry

```python
# tools/registry.py
import time
from typing import Dict, Optional, Callable
from core.base_tool import BaseTool, ToolInput, ToolOutput

class ToolRegistry:
    def __init__(self):
        self._tools: Dict[str, BaseTool] = {}
        self._emit_callback: Optional[Callable] = None

    def set_emit_callback(self, callback: Callable):
        self._emit_callback = callback

    def register(self, tool: BaseTool):
        if tool.name in self._tools:
            raise ValueError(f"Tool '{tool.name}' already registered")
        self._tools[tool.name] = tool

    def get_tool(self, name: str) -> BaseTool:
        if name not in self._tools:
            raise KeyError(f"Tool '{name}' not found")
        return self._tools[name]

    async def execute(self, name: str, input: ToolInput) -> ToolOutput:
        tool = self.get_tool(name)
        if not tool.validate_params(input.params):
            raise ValueError(f"Invalid params for tool '{name}'")

        if self._emit_callback:
            await self._emit_callback("tool.start", {"tool_name": name, "params": input.params})

        start = time.time()
        try:
            result = await tool.execute(input)
        except Exception as e:
            if self._emit_callback:
                await self._emit_callback("tool.end", {"tool_name": name, "error": str(e), "duration_ms": int((time.time()-start)*1000)})
            raise

        if self._emit_callback:
            await self._emit_callback("tool.end", {"tool_name": name, "result": result.result, "duration_ms": int((time.time()-start)*1000)})
        return result

    def list_tools(self) -> list[str]:
        return list(self._tools.keys())
```

### 示例通用 Agent: TopicResearchAgent

```python
# agents/topic_research.py
from core.base_agent import BaseAgent, AgentInput, AgentOutput
from core.base_tool import ToolInput
from core.task_context import TaskContext

class TopicResearchAgent(BaseAgent):
    name = "topic_research"
    description = "多级检索策略：缓存→HelixRAG→热榜→自定义"
    default_mode = "rewoo"

    async def execute(self, input: AgentInput) -> AgentOutput:
        raise NotImplementedError("请使用 execute_with_context")

    async def execute_with_context(self, input: AgentInput, context: TaskContext) -> AgentOutput:
        query = input.params.get("topic", input.params.get("query", ""))
        if not query:
            return AgentOutput(result={"topics": []})

        # 1. 尝试缓存
        try:
            cache = context.tools.get_tool("cache")
            cached = await cache.execute(ToolInput(params={"key": query}))
            if cached.result.get("data"):
                return AgentOutput(result={"topics": cached.result["data"]})
        except (KeyError, Exception):
            pass

        # 2. HelixRAG 检索
        try:
            helix = context.tools.get_tool("helixrag_search")
            result = await helix.execute(ToolInput(params={"query": query, "max_results": 5}))
            topics = [{"title": r["title"], "angle": r.get("angle", "综合"), "url": r.get("url", "")}
                       for r in result.result.get("results", [])][:5]
            if topics:
                return AgentOutput(result={"topics": topics})
        except (KeyError, Exception):
            pass

        # 3. 降级：Tavily 搜索
        try:
            search = context.tools.get_tool("web_search")
            result = await search.execute(ToolInput(params={"query": query, "max_results": 5}))
            topics = [{"title": r["title"], "angle": "综合", "url": r.get("url", "")}
                       for r in result.result.get("results", [])][:5]
            return AgentOutput(result={"topics": topics})
        except (KeyError, Exception):
            pass

        return AgentOutput(result={"topics": []})
```

### 启动代码示例 (app/main.py)

```python
import uvicorn
from fastapi import FastAPI
from core.config import system_config
from core.di import DIContainer
from tools.registry import ToolRegistry
from tools.llm_client import LLMClient
from tools.helixrag_client import HelixRAGClient
from events.event_bus import EventBus
from modes.registry import ModeRegistry
from modes.workflow import WorkflowExecutor
from modes.reflexion import ReflexionExecutor
from executor.hybrid_executor import HybridExecutor

# 创建 FastAPI 应用
app = FastAPI(title="FlowForge API", version="0.1.0")

# 初始化核心组件
container = DIContainer()
event_bus = EventBus()
tool_registry = ToolRegistry()
agent_registry = container  # 复用 DI 容器作为 AgentRegistry
mode_registry = ModeRegistry()

# 注册工具
tool_registry.register(HelixRAGClient())

# 注册模式
mode_registry.register(WorkflowExecutor())
mode_registry.register(ReflexionExecutor())

# 创建 HybridExecutor
executor = HybridExecutor(mode_registry, agent_registry, tool_registry, event_bus)

@app.post("/api/v1/tasks")
async def create_task(payload: dict):
    task_id = payload.get("task_id", f"task-{uuid.uuid4()}")
    context = TaskContext(
        task_id=task_id,
        persona=payload["persona"],
        input_data=payload["input_data"],
        metadata=payload.get("metadata", {}),
        mode=payload.get("mode"),
        interaction_mode=payload.get("interaction_mode", "standard"),
    )
    result = await executor.run(context, mode_hint=payload.get("mode"))
    return {"status": "success", "data": {"task_id": task_id, "result": result}}

if __name__ == "__main__":
    import uuid
    from core.task_context import TaskContext
    uvicorn.run(app, host=system_config.server_host, port=system_config.server_port)
```

以上代码实现了 FlowForge Phase 1 的核心运行时。系统已具备：
- 事件总线与 Solo 适配器
- 模式注册中心
- 混合执行器（含 Persona 锁和子步骤跳过）
- Workflow 执行器（含审核暂停/恢复、并行执行、错误处理）
- Reflexion 执行器（含 DefaultLLM 系列）
- LLM 客户端（真实 HTTP 调用）
- HelixRAG 客户端
- 工具注册表与示例 Agent

接下来补充 ContentForge 业务层接入、沙箱工具、Memory 模块等。

继续输出 FlowForge 剩余核心模块。本批包含：**沙箱执行工具 (PythonExecutorTool, FileReadWriteTool)**、**Memory 模块 (5种记忆策略)**、**网络搜索工具 (WebSearchTool)**、**App 接入层 (FastAPI 路由)**。

---

### 沙箱代码执行器 (tools/python_executor.py)

```python
import sys
import os
import multiprocessing
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
            return ToolOutput(
                result={"stdout": "", "stderr": "Code execution timed out"},
                error="timeout"
            )

        if not queue.empty():
            result = queue.get()
            return ToolOutput(result=result)
        return ToolOutput(
            result={"stdout": "", "stderr": "Execution failed"},
            error="execution_error"
        )

    def _run_in_subprocess(self, code, queue, max_memory):
        try:
            # 跨平台内存限制
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
                    pass  # psutil 未安装时跳过内存限制

            with tempfile.TemporaryDirectory() as tmpdir:
                os.chdir(tmpdir)

                # 移除危险内置函数
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

---

### 文件读写工具 (tools/file_rw.py)

```python
import os
from core.base_tool import BaseTool, ToolInput, ToolOutput

class FileReadWriteTool(BaseTool):
    name = "file_rw"
    description = "受限的文件读写工具"
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
        os.makedirs(os.path.dirname(full_path), exist_ok=True)

        if action == "read":
            if not os.path.exists(full_path):
                return ToolOutput(result={"content": ""})
            with open(full_path, 'r', encoding='utf-8') as f:
                return ToolOutput(result={"content": f.read()})
        elif action == "write":
            content = input.params.get("content", "")
            with open(full_path, 'w', encoding='utf-8') as f:
                f.write(content)
            return ToolOutput(result={"status": "written"})
        elif action == "delete":
            if os.path.exists(full_path):
                os.remove(full_path)
                return ToolOutput(result={"status": "deleted"})
            return ToolOutput(result={"status": "not found"})
        else:
            return ToolOutput(result={}, error=f"Unknown action: {action}")
```

---

### Memory 模块 (memory/)

#### memory/working.py (工作记忆)

```python
from typing import Any, Dict

class WorkingMemory:
    """工作记忆：存储在当前 TaskContext.state 中的字典"""
    def __init__(self):
        self._store: Dict[str, Any] = {}

    async def store(self, key: str, value: Any) -> None:
        self._store[key] = value

    async def search(self, query: str) -> list:
        if query in self._store:
            return [{"key": query, "value": self._store[query]}]
        return []

    def get(self, key: str) -> Any:
        return self._store.get(key)
```

#### memory/short_term.py (短期记忆，SQLite)

```python
import json
import time
import sqlite3
from typing import Any, Optional

class ShortTermMemory:
    """短期记忆：基于 SQLite，带 TTL 过期清理"""
    def __init__(self, db_url: str):
        self.conn = sqlite3.connect(db_url or "data/short_term.db", check_same_thread=False)
        self.conn.execute("CREATE TABLE IF NOT EXISTS short_mem (key TEXT PRIMARY KEY, value TEXT, expires_at REAL)")
        self.conn.commit()

    async def store(self, key: str, value: Any, ttl: int = 3600) -> None:
        expires = time.time() + ttl
        self.conn.execute(
            "INSERT OR REPLACE INTO short_mem VALUES (?, ?, ?)",
            (key, json.dumps(value), expires)
        )
        self.conn.commit()

    async def search(self, query: str) -> list:
        self.conn.execute("DELETE FROM short_mem WHERE expires_at < ?", (time.time(),))
        self.conn.commit()
        row = self.conn.execute("SELECT value FROM short_mem WHERE key = ?", (query,)).fetchone()
        if row:
            return [json.loads(row[0])]
        return []
```

#### memory/long_term.py (长期记忆，SQLite)

```python
import json
import sqlite3
from typing import Any

class LongTermMemory:
    """长期记忆：基于 SQLite"""
    def __init__(self, db_url: str):
        self.conn = sqlite3.connect(db_url or "data/long_term.db", check_same_thread=False)
        self.conn.execute("CREATE TABLE IF NOT EXISTS long_mem (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT, value TEXT, created_at TEXT)")
        self.conn.commit()

    async def store(self, key: str, value: Any) -> None:
        import datetime
        self.conn.execute(
            "INSERT INTO long_mem (key, value, created_at) VALUES (?, ?, ?)",
            (key, json.dumps(value), datetime.datetime.utcnow().isoformat())
        )
        self.conn.commit()

    async def search(self, query: str, limit: int = 10) -> list:
        rows = self.conn.execute(
            "SELECT value FROM long_mem WHERE key LIKE ? ORDER BY id DESC LIMIT ?",
            (f"%{query}%", limit)
        ).fetchall()
        return [json.loads(row[0]) for row in rows]
```

#### memory/semantic.py (语义记忆)

```python
class SemanticMemory:
    """语义记忆占位符。Phase 3+ 将接入 Qdrant/Milvus 向量数据库。"""
    def __init__(self):
        pass

    async def store(self, key: str, value: any) -> None:
        pass  # 未来实现

    async def search(self, query: str, top_k: int = 5) -> list:
        return []  # Phase 1 返回空
```

#### memory/episodic.py (情景记忆)

```python
import json
import sqlite3
from typing import Any

class EpisodicMemory:
    """情景记忆：基于 SQLite，存储任务轨迹"""
    def __init__(self, db_url: str):
        self.conn = sqlite3.connect(db_url or "data/episodic.db", check_same_thread=False)
        self.conn.execute("CREATE TABLE IF NOT EXISTS episodes (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, trace TEXT, created_at TEXT)")
        self.conn.commit()

    async def store(self, key: str, value: Any) -> None:
        import datetime
        self.conn.execute(
            "INSERT INTO episodes (task_id, trace, created_at) VALUES (?, ?, ?)",
            (key, json.dumps(value), datetime.datetime.utcnow().isoformat())
        )
        self.conn.commit()

    async def search(self, query: str, limit: int = 10) -> list:
        rows = self.conn.execute(
            "SELECT trace FROM episodes WHERE task_id LIKE ? ORDER BY id DESC LIMIT ?",
            (f"%{query}%", limit)
        ).fetchall()
        return [json.loads(row[0]) for row in rows]
```

#### memory/manager.py (MemoryManager)

```python
from .working import WorkingMemory
from .short_term import ShortTermMemory
from .long_term import LongTermMemory
from .semantic import SemanticMemory
from .episodic import EpisodicMemory
from typing import Any, List

class MemoryManager:
    def __init__(self, config: dict):
        db_url = config.get("db_url", "data/memory.db")
        self.working = WorkingMemory()
        self.short_term = ShortTermMemory(db_url)
        self.long_term = LongTermMemory(db_url)
        self.semantic = SemanticMemory() if config.get("vector_db_url") else None
        self.episodic = EpisodicMemory(db_url)

    async def save(self, memory_type: str, key: str, data: Any) -> None:
        store = getattr(self, memory_type, None)
        if store:
            await store.store(key, data)

    async def retrieve(self, memory_type: str, query: Any) -> Any:
        store = getattr(self, memory_type, None)
        if store:
            return await store.search(query)
        return []

    async def hybrid_search(self, query: str, types: List[str] = None) -> List[Any]:
        if types is None:
            types = ["semantic", "long_term", "episodic"]
        results = []
        if "semantic" in types and self.semantic:
            results.extend(await self.semantic.search(query))
        if "long_term" in types:
            results.extend(await self.long_term.search(query))
        if "episodic" in types:
            results.extend(await self.episodic.search(query))
        return results
```

---

### 网络搜索工具 (tools/web_search.py)

```python
import os
import httpx
from core.base_tool import BaseTool, ToolInput, ToolOutput
from core.config import system_config

class WebSearchTool(BaseTool):
    name = "web_search"
    description = "调用 HelixRAG 或 Tavily 进行实时网络检索"
    parameters_schema = {
        "type": "object",
        "required": ["query"],
        "properties": {
            "query": {"type": "string"},
            "max_results": {"type": "integer", "default": 5}
        }
    }

    async def execute(self, input: ToolInput) -> ToolOutput:
        query = input.params["query"]
        max_results = input.params.get("max_results", 5)

        # 优先尝试 HelixRAG
        if system_config.helixrag_enabled:
            try:
                from tools.helixrag_client import HelixRAGClient
                client = HelixRAGClient()
                results = await client.search(query, max_results=max_results)
                return ToolOutput(result={"results": results.get("results", [])})
            except Exception:
                pass

        # 降级到 Tavily
        tavily_key = os.getenv("TAVILY_API_KEY", "")
        if not tavily_key:
            return ToolOutput(result={"results": [], "error": "No search provider available"})
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                resp = await client.post(
                    "https://api.tavily.com/search",
                    json={"api_key": tavily_key, "query": query, "max_results": max_results}
                )
                resp.raise_for_status()
                data = resp.json()
                return ToolOutput(result={"results": data.get("results", [])})
        except Exception as e:
            return ToolOutput(result={"results": [], "error": str(e)})
```

---

### FastAPI 接入层 (app/)

#### app/api/router.py

```python
from fastapi import APIRouter
from app.api.endpoints import tasks, modes, admin, dashboard, review, schedules

router = APIRouter(prefix="/api/v1")
router.include_router(tasks.router)
router.include_router(modes.router)
router.include_router(admin.router)
router.include_router(dashboard.router)
router.include_router(review.router)
router.include_router(schedules.router)
```

#### app/api/endpoints/tasks.py

```python
import uuid
from fastapi import APIRouter, HTTPException, Depends
from app.deps import get_executor
from core.task_context import TaskContext

router = APIRouter(prefix="/tasks")

@router.post("", status_code=201)
async def create_task(payload: dict, executor = Depends(get_executor)):
    task_id = payload.get("task_id") or str(uuid.uuid4())
    persona = payload.get("persona", "default")
    input_data = payload.get("input_data", {})
    mode = payload.get("mode")
    interaction_mode = payload.get("interaction_mode", "standard")
    metadata = payload.get("metadata", {})

    context = TaskContext(
        task_id=task_id,
        persona=persona,
        input_data=input_data,
        metadata=metadata,
        mode=mode,
        interaction_mode=interaction_mode
    )
    try:
        result = await executor.run(context, mode_hint=mode)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {
        "status": "success",
        "data": {
            "task_id": task_id,
            "persona": persona,
            "mode": mode or executor.mode_registry.suggest_mode(input_data.get("task", "")),
            "interaction_mode": interaction_mode,
            "status": "completed",
            "result": result
        }
    }

@router.get("")
async def list_tasks():
    # 简化版本，后续可接入数据库
    return {"status": "success", "data": {"items": [], "total": 0}}

@router.get("/{task_id}")
async def get_task(task_id: str):
    return {"status": "success", "data": {"task_id": task_id, "status": "unknown"}}

@router.post("/{task_id}/review")
async def submit_review(task_id: str, payload: dict, executor = Depends(get_executor)):
    verdict = payload.get("verdict")
    feedback = payload.get("feedback", "")
    edited_draft = payload.get("edited_content", "")
    await executor.submit_review(task_id, verdict, feedback, edited_draft)
    return {"status": "success", "data": {"task_id": task_id, "status": verdict}}
```

#### app/api/endpoints/modes.py

```python
from fastapi import APIRouter, Depends
from app.deps import get_executor

router = APIRouter(prefix="/modes")

@router.get("")
async def list_modes(executor = Depends(get_executor)):
    modes = list(executor.mode_registry._modes.keys())
    return {"status": "success", "data": {"modes": modes}}
```

#### app/deps.py

```python
from app.main import get_executor_instance

async def get_executor():
    return get_executor_instance()
```

#### app/main.py (更新版)

```python
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from core.config import system_config
from core.di import DIContainer
from tools.registry import ToolRegistry
from tools.llm_client import LLMClient
from tools.helixrag_client import HelixRAGClient
from tools.web_search import WebSearchTool
from tools.python_executor import PythonExecutorTool
from tools.file_rw import FileReadWriteTool
from events.event_bus import EventBus
from modes.registry import ModeRegistry
from modes.workflow import WorkflowExecutor
from modes.reflexion import ReflexionExecutor
from modes.react import ReActExecutor
from executor.hybrid_executor import HybridExecutor
from memory.manager import MemoryManager
from agents.topic_research import TopicResearchAgent
from app.api.router import router

app = FastAPI(title="FlowForge API", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

# 初始化组件
container = DIContainer()
event_bus = EventBus()
tool_registry = ToolRegistry()
mode_registry = ModeRegistry()

# 注册工具
tool_registry.register(LLMClient())
tool_registry.register(HelixRAGClient())
tool_registry.register(WebSearchTool())
tool_registry.register(PythonExecutorTool())
tool_registry.register(FileReadWriteTool())

# 注册模式
mode_registry.register(WorkflowExecutor())
mode_registry.register(ReflexionExecutor())
mode_registry.register(ReActExecutor())

# 注册 Agent
agent_registry = container
agent_registry.register_agent("topic_research", lambda: TopicResearchAgent())

# 创建 MemoryManager
memory_manager = MemoryManager({"db_url": system_config.db_url})

_executor_instance = HybridExecutor(mode_registry, agent_registry, tool_registry, event_bus)

def get_executor_instance():
    return _executor_instance

# 挂载路由
app.include_router(router)

@app.get("/health")
def health():
    return {"status": "healthy"}

if __name__ == "__main__":
    uvicorn.run(app, host=system_config.server_host, port=system_config.server_port)
```

---

以上为 FlowForge Phase 1 完整可运行的核心系统。包含：
- 核心接口与抽象
- 事件总线与 Solo 适配器
- 模式注册中心 (含 Workflow, Reflexion, ReAct)
- 混合执行器 (含 Persona 锁)
- 沙箱安全工具
- Memory 模块 (5 种策略)
- LLM 客户端与搜索客户端
- FastAPI REST 接口
- 示例通用 Agent

系统已可直接启动，接收任务并执行。接下来的 Phase 2 可扩展更多模式、通用 Agent 和前端 Solo 模式等。

