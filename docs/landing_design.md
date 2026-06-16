# FlowForge 落地详细设计文档

> 版本：v1.0 | 日期：2025-06-15
> 本文档是 landing_plan.md 的代码级详细设计，重点阐述 OpenCode 模式与现有 FlowForge 代码的融合方案

---

## 设计哲学：融合而非替换

本文档的核心设计哲学是**融合（Fusion）**——将 OpenCode 的成熟模式注入 FlowForge 现有骨架，而非推翻重建。具体体现为：

1. **Harness 增强**：在现有 `HarnessOrchestrator.pre_execute/post_execute` 钩子中注入 OpenCode 的 ContextEpoch、Compaction、Permission V2 等能力
2. **Loop 增强**：在现有 `LoopExecutor._execute_iterations` 迭代循环中引入 TurnTransition 控制流、FiberSet 并行、MAX_STEPS 限制
3. **渐进式迁移**：每个设计项均提供向后兼容方案，确保现有功能不受影响

---

## Phase 0 — 框架能力补齐

---

### FWK-01: Workflow YAML Compiler

#### 设计目标

将 YAML 定义的 Workflow 编译为可执行 DAG，消除 5 个独立 Orchestrator，实现配置驱动。

#### OpenCode 借鉴

借鉴 OpenCode 的声明式配置模式——Workflow 定义与执行引擎分离，YAML 仅描述"做什么"，引擎决定"怎么做"。

#### 现有代码融合

- **融合点 1**：编译产物直接注入 `WorkflowExecutor._execute_core()` 的 `ctx.metadata["sop_steps"]`，无需修改 WorkflowExecutor 内部逻辑
- **融合点 2**：编译器的 Step 解析复用 `ModeRegistry.get(mode_name)` 进行模式验证
- **融合点 3**：条件路由节点与 `HybridExecutor.run()` 的 `mode_hint` 参数对接

#### 详细设计

```python
# flowforge/compiler/workflow_compiler.py

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional
from enum import Enum

class StepType(str, Enum):
    SEQUENCE = "sequence"
    CONDITIONAL = "conditional"
    PARALLEL = "parallel"
    FALLBACK = "fallback"
    LOOP = "loop"

@dataclass
class CompiledStep:
    """编译后的步骤节点"""
    name: str
    step_type: StepType
    agent: Optional[str] = None
    mode: Optional[str] = None
    condition: Optional[str] = None
    branches: Optional[Dict[str, 'CompiledStep']] = None
    default_branch: Optional['CompiledStep'] = None
    fallback_chain: Optional[List['CompiledStep']] = None
    parallel_steps: Optional[List['CompiledStep']] = None
    loop_config: Optional[Dict[str, Any]] = None
    input_mapping: Optional[Dict[str, str]] = None
    output_key: Optional[str] = None
    on_error: str = "abort"
    retry_count: int = 0
    retry_delay: float = 1.0
    metadata: Dict[str, Any] = field(default_factory=dict)

@dataclass
class CompiledWorkflow:
    """编译后的 Workflow DAG"""
    name: str
    version: str = "1.0"
    steps: List[CompiledStep] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)

class WorkflowCompiler:
    """Workflow YAML → CompiledWorkflow 编译器"""

    def __init__(self, mode_registry=None, agent_registry=None):
        self.mode_registry = mode_registry
        self.agent_registry = agent_registry

    def compile(self, yaml_config: Dict[str, Any]) -> CompiledWorkflow:
        """编译 YAML 配置为可执行 DAG"""
        workflow = CompiledWorkflow(
            name=yaml_config.get("name", "unnamed"),
            version=yaml_config.get("version", "1.0"),
            metadata=yaml_config.get("metadata", {}),
        )
        for step_config in yaml_config.get("steps", []):
            compiled = self._compile_step(step_config)
            workflow.steps.append(compiled)
        self._validate_workflow(workflow)
        return workflow

    def _compile_step(self, config: Dict[str, Any]) -> CompiledStep:
        """编译单个步骤"""
        step_type = self._infer_step_type(config)
        step = CompiledStep(
            name=config.get("name", "unnamed_step"),
            step_type=step_type,
            agent=config.get("agent"),
            mode=config.get("mode"),
            input_mapping=config.get("input_mapping"),
            output_key=config.get("output_key", config.get("output")),
            on_error=config.get("on_error", "abort"),
            retry_count=config.get("retry_count", 0),
            retry_delay=config.get("retry_delay", 1.0),
            metadata=config.get("metadata", {}),
        )
        if step_type == StepType.CONDITIONAL:
            step.condition = config.get("condition")
            step.branches = {
                k: self._compile_step(v) for k, v in config.get("branches", {}).items()
            }
            if "default" in config:
                step.default_branch = self._compile_step(config["default"])
        if step_type == StepType.FALLBACK:
            step.fallback_chain = [
                self._compile_step(s) for s in config.get("chain", [])
            ]
        if step_type == StepType.PARALLEL:
            step.parallel_steps = [
                self._compile_step(s) for s in config.get("steps", [])
            ]
        if step_type == StepType.LOOP:
            step.loop_config = config.get("loop", {})
        return step

    def _infer_step_type(self, config: Dict[str, Any]) -> StepType:
        if "condition" in config or "branches" in config:
            return StepType.CONDITIONAL
        if "chain" in config:
            return StepType.FALLBACK
        if "parallel_steps" in config or config.get("parallel"):
            return StepType.PARALLEL
        if "loop" in config:
            return StepType.LOOP
        return StepType.SEQUENCE

    def _validate_workflow(self, workflow: CompiledWorkflow) -> None:
        for step in workflow.steps:
            self._validate_step(step)

    def _validate_step(self, step: CompiledStep) -> None:
        if step.mode and self.mode_registry:
            if not self.mode_registry.get(step.mode):
                raise ValueError(f"Unknown mode: {step.mode}")
        if step.agent and self.agent_registry:
            if not self.agent_registry.get(step.agent):
                raise ValueError(f"Unknown agent: {step.agent}")

    def to_sop_steps(self, workflow: CompiledWorkflow) -> List[Dict[str, Any]]:
        """将 CompiledWorkflow 转换为 WorkflowExecutor 可消费的 sop_steps 格式

        融合接口：编译产物 → ctx.metadata["sop_steps"] → WorkflowExecutor._execute_core()
        """
        sop_steps = []
        for step in workflow.steps:
            sop = self._step_to_sop(step)
            sop_steps.append(sop)
        return sop_steps

    def _step_to_sop(self, step: CompiledStep) -> Dict[str, Any]:
        sop = {
            "name": step.name,
            "agent": step.agent,
            "mode": step.mode or "plan_execute",
            "output": step.output_key or f"step_{step.name}_result",
            "on_error": step.on_error,
            "retry_count": step.retry_count,
            "retry_delay": step.retry_delay,
        }
        if step.step_type == StepType.CONDITIONAL:
            sop["condition"] = step.condition
            sop["branches"] = {
                k: self._step_to_sop(v) for k, v in (step.branches or {}).items()
            }
        if step.step_type == StepType.PARALLEL:
            sop["parallel_group"] = [
                self._step_to_sop(s) for s in (step.parallel_steps or [])
            ]
        if step.step_type == StepType.LOOP:
            sop["loop_config"] = step.loop_config
        return sop
```

#### 接口变更

| 接口 | 变更类型 | 说明 |
|------|---------|------|
| `WorkflowExecutor._execute_core()` | 无变更 | 编译产物通过 `ctx.metadata["sop_steps"]` 注入 |
| `HybridExecutor.run()` | 无变更 | mode_hint 参数已支持 |
| `ModeRegistry.get()` | 新增调用 | 编译器用于验证 mode 是否已注册 |

#### 向后兼容

- 现有 `ctx.metadata["sop_steps"]` 手动构造方式继续有效
- `WorkflowCompiler.to_sop_steps()` 是新增工具，不替代手动方式
- 编译器为可选组件，不使用编译器时行为不变

#### 验收标准

- YAML 定义 → `CompiledWorkflow` → `sop_steps` → `WorkflowExecutor` 全链路可执行
- 条件路由、回退链、并行组、循环四种步骤类型均可编译
- 编译产物与手动构造的 `sop_steps` 功能等价

---

### FWK-02: Conditional Router

#### 设计目标

根据条件动态选择不同的 prompt/工具链/执行路径，消除 if-else 硬编码。

#### OpenCode 借鉴

借鉴 OpenCode 的声明式路由——路由条件以表达式形式声明，运行时由 Router 引擎求值。

#### 现有代码融合

- **融合点**：`WorkflowExecutor._execute_core()` 中已有 `sop_steps` 遍历逻辑，Conditional Router 作为步骤类型嵌入其中
- **融合点**：条件求值结果直接映射到 `HybridExecutor.run()` 的 `mode_hint` 参数

#### 详细设计

```python
# flowforge/compiler/conditional_router.py

from typing import Any, Callable, Dict, Optional
from flowforge.core.tracing import get_logger

logger = get_logger("compiler.conditional_router")

class ConditionalRouter:
    """条件路由引擎：根据上下文动态选择执行路径"""

    def __init__(self, context_resolver: Optional[Callable] = None):
        self._context_resolver = context_resolver or self._default_resolver
        self._custom_evaluators: Dict[str, Callable] = {}

    def register_evaluator(self, name: str, evaluator: Callable) -> None:
        """注册自定义条件求值器"""
        self._custom_evaluators[name] = evaluator

    def route(self, condition: str, branches: Dict[str, Any],
              context: Any, default: Optional[Any] = None) -> Any:
        """根据条件选择分支"""
        result = self._evaluate(condition, context)
        if result in branches:
            logger.info(f"ConditionalRouter: condition='{condition}' → branch='{result}'")
            return branches[result]
        if default is not None:
            return default
        for key, value in branches.items():
            if str(result) == str(key):
                return value
        return branches.get("default", default)

    def _evaluate(self, condition: str, context: Any) -> Any:
        """求值条件表达式，支持 ==, !=, >, <, in 运算符"""
        if condition in self._custom_evaluators:
            return self._custom_evaluators[condition](context)
        condition = condition.strip()
        if not any(op in condition for op in ["==", "!=", ">", "<", " in ", ">=", "<="]):
            return self._context_resolver(context, condition)
        if "==" in condition:
            left, right = condition.split("==", 1)
            return str(self._context_resolver(context, left.strip())) == right.strip().strip("'\"")
        if "!=" in condition:
            left, right = condition.split("!=", 1)
            return str(self._context_resolver(context, left.strip())) != right.strip().strip("'\"")
        if " in " in condition:
            left, right = condition.split(" in ", 1)
            left_val = str(self._context_resolver(context, left.strip()))
            right_val = [v.strip().strip("'\"") for v in right.strip().strip("[]").split(",")]
            return left_val in right_val
        if ">" in condition:
            left, right = condition.split(">", 1)
            try:
                return float(self._context_resolver(context, left.strip())) > float(right.strip())
            except (ValueError, TypeError):
                return str(self._context_resolver(context, left.strip())) > right.strip()
        if "<" in condition:
            left, right = condition.split("<", 1)
            try:
                return float(self._context_resolver(context, left.strip())) < float(right.strip())
            except (ValueError, TypeError):
                return str(self._context_resolver(context, left.strip())) < right.strip()
        return self._context_resolver(context, condition)

    @staticmethod
    def _default_resolver(context: Any, path: str) -> Any:
        """默认上下文变量解析器，支持点号分隔路径"""
        if context is None:
            return None
        if path.startswith("task."):
            path = path[5:]
        if not path:
            return None
        parts = path.split(".")
        obj = context
        for part in parts:
            if isinstance(obj, dict):
                obj = obj.get(part)
            else:
                obj = getattr(obj, part, None)
            if obj is None:
                return None
        return obj
```

#### 接口变更

无破坏性变更。`ConditionalRouter` 为新增独立组件。

#### 向后兼容

- 不使用 `condition` 字段的步骤行为不变
- `ConditionalRouter` 为独立组件，不影响现有代码

#### 验收标准

- 支持 ==, !=, >, <, in 五种运算符
- 支持自定义求值器注册
- 条件路由步骤在 Workflow 中可正确选择分支

---

### FWK-03: Fallback Chain

#### 设计目标

声明式定义工具调用的有序回退链，消除 4 处硬编码回退逻辑。

#### OpenCode 借鉴

借鉴 OpenCode 的有序回退模式——回退链以声明式列表定义，按序尝试直到成功。

#### 现有代码融合

- **融合点**：与 `LoopExecutor._execute_iterations()` 中的重试逻辑互补——Fallback Chain 是工具级回退，LoopExecutor 是任务级重试
- **融合点**：回退链步骤复用 `HybridExecutor.run()` 执行

#### 详细设计

```python
# flowforge/compiler/fallback_chain.py

from dataclasses import dataclass, field
from typing import Any, Dict, List
from flowforge.core.tracing import get_logger

logger = get_logger("compiler.fallback_chain")

@dataclass
class FallbackResult:
    """回退链执行结果"""
    success: bool
    result: Any
    used_step: str
    attempts: int
    errors: List[str] = field(default_factory=list)

class FallbackChainExecutor:
    """有序回退链执行器"""

    def __init__(self, hybrid_executor=None):
        self.hybrid_executor = hybrid_executor

    async def execute_chain(self, chain: List[Dict[str, Any]], context: Any,
                            stop_on_success: bool = True) -> FallbackResult:
        """按序执行回退链"""
        errors: List[str] = []
        for i, step_config in enumerate(chain):
            step_name = step_config.get("name", f"fallback_step_{i}")
            try:
                result = await self._execute_step(step_config, context)
                if self._is_success(result):
                    return FallbackResult(success=True, result=result,
                                          used_step=step_name, attempts=i + 1, errors=errors)
            except Exception as e:
                errors.append(f"Step '{step_name}' failed: {str(e)}")
        return FallbackResult(success=False, result=None, used_step="none",
                              attempts=len(chain), errors=errors)

    async def _execute_step(self, step_config: Dict[str, Any], context: Any) -> Any:
        if self.hybrid_executor is None:
            raise RuntimeError("hybrid_executor not configured")
        mode = step_config.get("mode", "plan_execute")
        return await self.hybrid_executor.run(context, mode_hint=mode)

    @staticmethod
    def _is_success(result: Any) -> bool:
        if isinstance(result, dict):
            return not result.get("error") and result.get("status") != "failed"
        return True
```

#### 接口变更

无破坏性变更。`FallbackChainExecutor` 为新增独立组件。

#### 向后兼容

- 现有硬编码回退逻辑继续有效，可逐步迁移到 YAML 声明

#### 验收标准

- 回退链按序执行，首次成功即停止
- 全部失败时返回 FallbackResult(success=False)
- 与 WorkflowExecutor 集成后可在 YAML 中声明回退链

---

### FWK-04: State Param Mapping

#### 设计目标

从 state 自动填充 agent 输入参数，消除手动参数传递代码。

#### OpenCode 借鉴

借鉴 OpenCode 的上下文变量绑定模式——步骤输入通过表达式引用上游输出。

#### 现有代码融合

- **融合点**：映射结果注入 `TaskContext.input_data`，现有 Agent 无需修改即可消费
- **融合点**：映射表达式复用 `ConditionalRouter._default_resolver()` 的路径解析逻辑

#### 详细设计

```python
# flowforge/compiler/state_mapper.py

from typing import Any, Dict, Optional
from flowforge.core.tracing import get_logger

logger = get_logger("compiler.state_mapper")

class StateParamMapper:
    """状态参数映射器：从 state 自动填充 agent 输入参数"""

    def __init__(self, context_resolver=None):
        self._resolver = context_resolver or self._default_resolver

    def map_params(self, mapping: Dict[str, str], context: Any) -> Dict[str, Any]:
        """根据映射规则从上下文中提取参数"""
        result: Dict[str, Any] = {}
        for target_key, source_path in mapping.items():
            value = self._resolver(context, source_path)
            if value is not None:
                result[target_key] = value
        return result

    def apply_to_context(self, mapping: Dict[str, str], context: Any) -> None:
        """将映射结果直接注入 TaskContext.input_data"""
        mapped = self.map_params(mapping, context)
        if hasattr(context, 'input_data') and isinstance(context.input_data, dict):
            context.input_data.update(mapped)

    @staticmethod
    def _default_resolver(context: Any, path: str) -> Any:
        from flowforge.compiler.conditional_router import ConditionalRouter
        return ConditionalRouter._default_resolver(context, path)
```

#### 接口变更

无破坏性变更。`StateParamMapper` 为新增工具组件。

#### 向后兼容

- 不使用 `input_mapping` 的步骤行为不变
- 映射结果合并到 `input_data`，不覆盖已有键

#### 验收标准

- 支持点号分隔路径解析
- 映射结果正确注入 `TaskContext.input_data`
- 不存在的路径返回 None 而非报错

---

### FWK-05: Persona Auto-Inject

#### 设计目标

persona 的 SOUL/MEMORY/CREATION 三维度自动注入 prompt，消除硬编码 persona 提示词。

#### OpenCode 借鉴

借鉴 OpenCode 的 SystemContext 组装模式——persona 定义以结构化数据存储，运行时自动组装注入。

#### 现有代码融合

- **融合点 1**：与 `ContextEngine.inject()` 融合——persona 注入作为 `ContextEngine` 的一个 Source，在 `pre_execute` 阶段自动执行
- **融合点 2**：注入结果写入 `ctx.state["harness_context"]["persona_context"]`，与现有 `format_context_block()` 格式化逻辑兼容

#### 详细设计

```python
# flowforge/harness/persona_injector.py

from typing import Any, Dict, Optional
from flowforge.core.tracing import get_logger

logger = get_logger("harness.persona_injector")

class PersonaInjector:
    """Persona 自动注入器：SOUL/MEMORY/CREATION 三维度注入"""

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = config or {}
        self._persona_store: Dict[str, Dict[str, Any]] = {}

    def register_persona(self, persona_id: str, definition: Dict[str, Any]) -> None:
        self._persona_store[persona_id] = definition

    def load_from_yaml(self, yaml_path: str) -> None:
        import yaml
        with open(yaml_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        for persona_id, definition in data.get("personas", {}).items():
            self.register_persona(persona_id, definition)

    async def inject(self, ctx: Any) -> None:
        """将 persona 上下文注入 TaskContext

        融合点：由 ContextEngine.inject() 调用，
        注入结果写入 ctx.state["harness_context"]["persona_context"]
        """
        persona_id = getattr(ctx, 'persona', None)
        if not persona_id:
            return
        definition = self._persona_store.get(persona_id)
        if not definition:
            return
        persona_context = {
            "soul": definition.get("soul", ""),
            "memory": definition.get("memory", ""),
            "creation": definition.get("creation", ""),
            "persona_id": definition.get("name", ""),
        }
        if hasattr(ctx, 'state'):
            harness_ctx = ctx.state.get("harness_context", {})
            harness_ctx["persona_context"] = persona_context
            ctx.state["harness_context"] = harness_ctx
        if hasattr(ctx, 'metadata'):
            ctx.metadata["persona_soul"] = persona_context.get("soul", "")
            ctx.metadata["persona_memory"] = persona_context.get("memory", "")
```

#### 接口变更

| 接口 | 变更类型 | 说明 |
|------|---------|------|
| `ContextEngine.inject()` | 增强 | 新增 persona 注入步骤 |
| `ContextEngine.format_context_block()` | 增强 | 新增 persona_context 段落格式化 |

#### 向后兼容

- 无 persona 定义时跳过注入，行为不变
- persona 注入为可选功能，通过配置开关控制

#### 验收标准

- persona 三维度均可从 YAML 加载
- 注入结果正确写入 `ctx.state["harness_context"]["persona_context"]`
- 与 `ContextEngine.inject()` 集成后自动执行

---

### FWK-06: Reflexion Loop ★重点

#### 设计目标

声明式定义 Reflexion Loop：max_rounds + threshold + check_tool + retry_prompt，与现有 `LoopExecutor` 深度融合。

#### OpenCode 借鉴

借鉴 OpenCode 的 RunCoordinator 的 run/wake coalescing 模式——Loop 迭代不是简单的 for 循环，而是有状态转换的控制流。同时借鉴 TurnTransition 的 `RebuildPreparedTurn` / `ContinueAfterOverflowCompaction` 模式，替代 LoopExecutor 中的嵌套 if-else。

#### 现有代码融合

**这是最关键的融合点之一**。Reflexion Loop 需要与 `LoopExecutor._execute_iterations()` 深度融合：

1. **TurnTransition 控制流替代嵌套 if-else**：现有 `LoopExecutor._execute_iterations()` 中，verdict.passed 后有一大段成功逻辑，失败后有一大段复盘逻辑，两者通过 if-else 分隔。引入 TurnTransition 后，每次迭代的结果决定下一次迭代的状态转换，而非在循环体内用 if-else 处理。

2. **ContextEpoch 管理**：当 Loop 涉及多个 Agent（如 Reflexion 模式的 Actor/Evaluator/Reflector），每次 Agent 切换时需要保存和恢复上下文快照。

3. **MAX_STEPS 限制**：现有 `LoopExecutor` 没有 max_steps 限制（不像 OpenCode 的 25），需要添加。

4. **Compaction 触发**：Reflexion Loop 的每次迭代都会增加上下文长度，当 FeedbackLoop 返回 FAIL 时，应在重试前触发 Compaction 压缩上下文。

#### 详细设计

```python
# flowforge/loop/turn_transition.py

from enum import Enum
from typing import Any, Dict, Optional
from dataclasses import dataclass

class TurnKind(str, Enum):
    """迭代状态转换类型"""
    CONTINUE = "continue"
    REBUILD_PREPARED = "rebuild_prepared"
    AGENT_SWITCH = "agent_switch"
    COMPLETED = "completed"
    FAILED = "failed"
    OVERFLOW_COMPACTION = "overflow_compaction"

@dataclass
class TurnTransition:
    """迭代状态转换——替代 LoopExecutor._execute_iterations() 中的嵌套 if-else"""
    kind: TurnKind
    next_agent: Optional[str] = None
    context_epoch_id: Optional[str] = None
    reason: str = ""
    data: Optional[Dict[str, Any]] = None

class TurnTransitionEngine:
    """迭代状态转换引擎

    融合点：嵌入 LoopExecutor._execute_iterations()，
    替代现有的 if verdict.passed / else 分支逻辑
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = config or {}
        self.max_steps = self.config.get("max_steps", 25)

    def decide(self, verdict: Any, attempt: int, max_retries: int,
               feedback_gate: str, context_utilization: float,
               compaction_threshold: float) -> TurnTransition:
        """根据当前迭代结果决定下一次状态转换

        替代 if-else 的核心逻辑：
        1. verdict.passed → COMPLETED
        2. attempt >= max_retries → FAILED
        3. attempt >= max_steps → FAILED（OpenCode MAX_STEPS）
        4. FAIL + 上下文溢出 → OVERFLOW_COMPACTION
        5. FAIL → REBUILD_PREPARED（触发 Compaction 后重试）
        6. 否则 → CONTINUE
        """
        if verdict.passed:
            return TurnTransition(kind=TurnKind.COMPLETED,
                                  reason=f"Verdict passed with score {verdict.score}")
        if attempt >= max_retries:
            return TurnTransition(kind=TurnKind.FAILED,
                                  reason=f"Max retries ({max_retries}) exceeded")
        if attempt >= self.max_steps:
            return TurnTransition(kind=TurnKind.FAILED,
                                  reason=f"Max steps ({self.max_steps}) exceeded")
        if feedback_gate == "FAIL" and context_utilization > compaction_threshold:
            return TurnTransition(kind=TurnKind.OVERFLOW_COMPACTION,
                                  reason="Feedback FAIL + context overflow")
        if feedback_gate == "FAIL":
            return TurnTransition(kind=TurnKind.REBUILD_PREPARED,
                                  reason="Feedback FAIL, rebuilding context")
        return TurnTransition(kind=TurnKind.CONTINUE, reason="Normal retry")
```

LoopExecutor 增强后的核心逻辑：

```python
# flowforge/loop/executor.py 增强部分

class LoopExecutor:
    def __init__(self, ...):
        # ... 现有初始化 ...
        self.turn_engine = TurnTransitionEngine(
            config={"max_steps": loop_config.get("max_steps", 25)}
        )

    async def _execute_iterations(self, task, loop_config, state, ...):
        """增强后的迭代逻辑——使用 TurnTransition 替代嵌套 if-else"""
        for attempt in range(max_retries):
            # ... 现有的执行、Harness post_execute、Verifier 代码不变 ...

            feedback_gate = result.get("_feedback", {}).get("gate", "PASS")
            context_utilization = self._get_context_utilization(task)

            transition = self.turn_engine.decide(
                verdict=verdict, attempt=attempt + 1, max_retries=max_retries,
                feedback_gate=feedback_gate,
                context_utilization=context_utilization,
                compaction_threshold=0.92,
            )

            if transition.kind == TurnKind.COMPLETED:
                state.phase = LoopPhase.COMPLETED
                # ... checkpoint, memory, event ...
            elif transition.kind == TurnKind.FAILED:
                state.phase = LoopPhase.FAILED
                # ... checkpoint, event ...
            elif transition.kind == TurnKind.OVERFLOW_COMPACTION:
                await self._trigger_compaction(task)
                await self._reflect_and_replan(verdict, task, state, ...)
            elif transition.kind in (TurnKind.REBUILD_PREPARED, TurnKind.CONTINUE):
                await self._reflect_and_replan(verdict, task, state, ...)

    async def _trigger_compaction(self, task: TaskContext) -> None:
        """触发 Compaction——融合点：调用 SessionManager.check_and_compact()"""
        if self.harness and hasattr(self.harness, 'session_manager'):
            await self.harness.session_manager.check_and_compact(task)

    def _get_context_utilization(self, task: TaskContext) -> float:
        """获取上下文利用率"""
        if self.harness and hasattr(self.harness, 'session_manager'):
            sm = self.harness.session_manager
            usage = sm.get_session_usage(task.task_id)
            return usage / sm.context_window if sm.context_window > 0 else 0.0
        return 0.0
```

Reflexion Loop YAML 配置：

```yaml
loops:
  reflexion_writing:
    name: reflexion_writing
    max_retries: 4
    max_steps: 25
    planner:
      mode: plan_execute
    verifier:
      mode: agent_judge
      pass_threshold: 0.85
    reflexion:
      actor_agent: writer
      evaluator_agent: quality_judge
      reflector_agent: reflector
      quality_threshold: 0.85
    compaction:
      trigger_on_fail: true
      threshold: 0.92
```

#### 接口变更

| 接口 | 变更类型 | 说明 |
|------|---------|------|
| `LoopExecutor._execute_iterations()` | 重构 | 引入 TurnTransition 替代嵌套 if-else |
| `LoopExecutor.__init__()` | 增强 | 新增 `turn_engine` 属性 |
| `LoopState` | 增强 | 新增 `current_turn_kind` 字段 |
| `LoopPhase` | 增强 | 新增 `COMPACTING` 阶段 |

#### 向后兼容

- TurnTransition 为内部重构，外部接口 `LoopExecutor.run()` 签名不变
- `max_steps` 默认值 25 不影响现有 `max_retries` 逻辑
- 不配置 `compaction.trigger_on_fail` 时，FAIL 后不触发 Compaction

#### 验收标准

- Reflexion Loop 可通过 YAML 声明 max_rounds/threshold/check_tool/retry_prompt
- TurnTransition 正确处理五种状态转换
- FAIL + 上下文溢出时自动触发 Compaction
- MAX_STEPS 限制生效

---

### FWK-07: Agent Pipeline

#### 设计目标

串行步骤定义 + 步骤间数据传递，简化多 Agent 串行编排。

#### OpenCode 借鉴

借鉴 OpenCode 的有序执行模式——Pipeline 是最简单的 Workflow 特化。

#### 现有代码融合

- **融合点**：Pipeline 编译为 `CompiledWorkflow(steps_type=SEQUENCE)`，复用 `WorkflowCompiler`
- **融合点**：步骤间数据传递通过 `StateParamMapper` 实现

#### 详细设计

```python
# flowforge/compiler/pipeline.py

from typing import Any, Dict, List
from flowforge.compiler.workflow_compiler import WorkflowCompiler

class PipelineCompiler(WorkflowCompiler):
    """Pipeline 编译器：串行步骤 + 数据传递"""

    def compile_pipeline(self, yaml_config: Dict[str, Any]) -> List[Dict[str, Any]]:
        steps = yaml_config.get("steps", [])
        sop_steps = []
        for i, step in enumerate(steps):
            sop = {
                "name": step.get("name", f"pipeline_step_{i}"),
                "agent": step.get("agent"),
                "mode": step.get("mode", "plan_execute"),
                "output": step.get("output_key", f"pipeline_step_{i}_result"),
                "on_error": step.get("on_error", "abort"),
            }
            if i > 0 and "input_mapping" not in step:
                sop["input_mapping"] = {"previous_output": f"steps.pipeline_step_{i-1}_result"}
            elif "input_mapping" in step:
                sop["input_mapping"] = step["input_mapping"]
            sop_steps.append(sop)
        return sop_steps
```

#### 验收标准

- Pipeline 步骤严格串行执行
- 步骤间数据传递正确
- 编译产物与 WorkflowExecutor 兼容

---

### FWK-08: Scoring Rubric

#### 设计目标

声明式定义评分维度/权重/阈值/风险规则，与现有 `FeedbackLoop` 和 `MultiJudgeVerifier` 融合。

#### OpenCode 借鉴

借鉴 OpenCode 的结构化评分模式——评分维度和权重以配置声明，运行时自动计算加权分数。

#### 现有代码融合

- **融合点 1**：与 `FeedbackLoop._full_evaluation()` 融合——Rubric 定义的维度替代硬编码的 `DIMENSIONS`
- **融合点 2**：与 `MultiJudgeVerifier._aggregate_scores()` 融合——Rubric 定义的权重替代 `DEFAULT_DIMENSIONS`

#### 详细设计

```python
# flowforge/harness/scoring_rubric.py

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

class DimensionDef(BaseModel):
    name: str
    weight: float = 1.0
    description: str = ""
    risk_threshold: Optional[float] = None

class RiskRule(BaseModel):
    name: str
    condition: str
    action: str = "block"
    message: str = ""

class ScoringRubric(BaseModel):
    name: str
    dimensions: List[DimensionDef] = Field(default_factory=list)
    pass_threshold: float = 0.85
    conditional_threshold: float = 0.60
    risk_rules: List[RiskRule] = Field(default_factory=list)

    def compute_weighted_score(self, scores: Dict[str, float]) -> float:
        total_weight = sum(d.weight for d in self.dimensions) or 1.0
        return sum(scores.get(d.name, 0.0) * d.weight for d in self.dimensions) / total_weight

    def classify(self, overall_score: float) -> str:
        if overall_score >= self.pass_threshold:
            return "PASS"
        elif overall_score >= self.conditional_threshold:
            return "CONDITIONAL"
        return "FAIL"

    def check_risks(self, scores: Dict[str, float]) -> List[Dict[str, Any]]:
        risks = []
        for rule in self.risk_rules:
            if "any_dimension" in rule.condition and "<" in rule.condition:
                threshold = float(rule.condition.split("<")[1].strip())
                if any(v < threshold for v in scores.values()):
                    risks.append({"rule": rule.name, "action": rule.action, "message": rule.message})
        return risks
```

与 FeedbackLoop 融合：

```python
class FeedbackLoop:
    def __init__(self, config=None):
        # ... 现有初始化 ...
        rubric_config = (config or {}).get("rubric")
        self.rubric = ScoringRubric(**rubric_config) if rubric_config else None

    def _classify_with_scores(self, scores: Dict[str, float]) -> str:
        if self.rubric:
            overall = self.rubric.compute_weighted_score(scores)
            return self.rubric.classify(overall)
        # 回退到现有逻辑
        avg = sum(scores.values()) / len(scores) if scores else 0
        if avg >= self.quality_threshold:
            if any(v < 0.4 for v in scores.values()):
                return "CONDITIONAL"
            return "PASS"
        elif avg >= self.quality_threshold * 0.7:
            return "CONDITIONAL"
        return "FAIL"
```

#### 验收标准

- 评分维度/权重/阈值可从 YAML 声明
- 加权分数计算正确
- 风险规则检查生效
- 与 FeedbackLoop 和 MultiJudgeVerifier 集成

---

### FWK-09: DeclarativeAgent增强

#### 设计目标

为 DeclarativeAgent 添加 state_updates/permissions/tools/max_steps/hidden 配置能力。

#### OpenCode 借鉴

借鉴 OpenCode 的 Agent 配置模式——max_steps 限制、hidden Agent、per-agent permissions。

#### 现有代码融合

- **融合点 1**：`max_steps` 与 `LoopExecutor` 的 `TurnTransitionEngine.max_steps` 对接
- **融合点 2**：`permissions` 与 `PermissionPipeline` 对接
- **融合点 3**：`tools` 过滤与 `ToolRegistry` 对接
- **融合点 4**：`hidden` 控制 Agent 在 Agent 列表中的可见性

#### 详细设计

```python
# flowforge/core/declarative_agent.py 增强

from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional

class AgentPermissions(BaseModel):
    allowed_tools: List[str] = Field(default_factory=list)
    denied_tools: List[str] = Field(default_factory=list)
    allowed_modes: List[str] = Field(default_factory=list)
    max_steps: int = 25
    require_approval_for: List[str] = Field(default_factory=list)

class DeclarativeAgentConfig(BaseModel):
    name: str
    description: str = ""
    model: Optional[str] = None
    tools: List[str] = Field(default_factory=list)
    instructions: str = ""
    handoffs: List[str] = Field(default_factory=list)
    guardrails: List[str] = Field(default_factory=list)
    permissions: Optional[AgentPermissions] = None
    max_steps: int = 25
    hidden: bool = False
    state_updates: Dict[str, str] = Field(default_factory=dict)
    persona: Optional[str] = None
    default_mode: str = "plan_execute"
```

AgentRegistry 增强：

```python
class AgentRegistry:
    def list(self, include_hidden: bool = False) -> List[BaseAgent]:
        agents = []
        for agent in self._agents.values():
            if include_hidden or not getattr(agent, 'hidden', False):
                agents.append(agent)
        return agents
```

#### 验收标准

- max_steps 限制在 LoopExecutor 层面强制执行
- permissions 正确过滤工具和模式
- hidden Agent 不出现在默认列表中
- state_updates 执行后正确更新 ctx.state

---

## Phase 1 — 基础设施加固

---

### INF-01: LLM路由层重构

#### 设计目标

将 LLM 调用从硬编码的 LLMClient 重构为 Protocol/Route/Provider 三层分离架构。

#### OpenCode 借鉴

借鉴 OpenCode 的 Provider 抽象——LLM 调用通过 Protocol 定义接口，Route 决定路由，Provider 实现具体调用。

#### 现有代码融合

- **融合点 1**：`FeedbackLoop._call_llm()` 中的 `self._llm_client.execute(tool_input)` 需要适配新的 Protocol 接口
- **融合点 2**：`LoopVerifier.MultiJudgeVerifier._call_judge()` 中的 `task.tools.execute("llm", ...)` 需要适配
- **融合点 3**：`LLMPlanner` 和 `ReflexionReflector` 中的 `self.llm_client.chat(prompt)` 需要适配

#### 详细设计

```python
# flowforge/llm/protocol.py

from abc import ABC, abstractmethod
from typing import Any, AsyncIterator, Dict, List, Optional
from dataclasses import dataclass

@dataclass
class LLMMessage:
    role: str
    content: str

@dataclass
class LLMRequest:
    messages: List[LLMMessage]
    model: Optional[str] = None
    temperature: float = 0.7
    max_tokens: int = 4096
    stream: bool = False

@dataclass
class LLMResponse:
    content: str
    model: str
    usage: Dict[str, int]
    finish_reason: str = "stop"

class LLMProtocol(ABC):
    @abstractmethod
    async def complete(self, request: LLMRequest) -> LLMResponse: ...
    @abstractmethod
    async def stream(self, request: LLMRequest) -> AsyncIterator[str]: ...

# flowforge/llm/router.py

class LLMRouter:
    """LLM 路由层：根据模型名路由到对应 Provider"""

    def __init__(self):
        self._providers: Dict[str, LLMProtocol] = {}
        self._model_routes: Dict[str, str] = {}
        self._fallback_routes: Dict[str, str] = {}

    def register_provider(self, provider: LLMProtocol) -> None:
        self._providers[provider.name] = provider

    def add_route(self, model_name: str, provider_name: str) -> None:
        self._model_routes[model_name] = provider_name

    def add_fallback(self, model_name: str, fallback_model: str) -> None:
        self._fallback_routes[model_name] = fallback_model

    async def complete(self, request: LLMRequest) -> LLMResponse:
        model = request.model or "default"
        provider_name = self._resolve_provider(model)
        provider = self._providers.get(provider_name)
        if not provider:
            raise RuntimeError(f"No provider for model '{model}'")
        try:
            return await provider.complete(request)
        except Exception:
            fallback = self._fallback_routes.get(model)
            if fallback:
                return await self.complete(LLMRequest(
                    messages=request.messages, model=fallback,
                    temperature=request.temperature, max_tokens=request.max_tokens))
            raise

    def _resolve_provider(self, model: str) -> str:
        if model in self._model_routes:
            return self._model_routes[model]
        prefix = model.split("/")[0] if "/" in model else ""
        if prefix in self._providers:
            return prefix
        return next(iter(self._providers), "default")
```

#### 接口变更

| 接口 | 变更类型 | 说明 |
|------|---------|------|
| `FeedbackLoop._call_llm()` | 适配 | 从 `self._llm_client.execute()` 改为 `self._llm_router.complete()` |
| `LLMPlanner.llm_client.chat()` | 适配 | 改为 `self._llm_router.complete()` |

#### 向后兼容

- 保留旧 `LLMClient` 适配器，新路由并行运行
- 旧代码通过 `LLMClientAdapter` 桥接到新 `LLMRouter`

#### 验收标准

- 新增 Provider 仅需 1-2 行配置
- 模型路由正确
- fallback 模型降级生效

---

### INF-02: Session持久化与恢复 ★重点

#### 设计目标

实现 Session 的持久化存储和崩溃恢复，借鉴 OpenCode 的事件溯源 + RunCoordinator 模式。

#### OpenCode 借鉴

1. **事件溯源（Event Sourcing）**：Session 状态不是直接存储快照，而是存储事件序列，通过回放事件重建状态
2. **RunCoordinator**：管理 run 的生命周期，支持 run/wake coalescing

#### 现有代码融合

**关键融合点**：

1. **与 `SessionManager` 融合**：现有 `SessionManager` 只有内存中的 `_session_usage: Dict[str, int]`，需要添加 SQLite 持久化
2. **与 `EntropyManager.DebtTracker` 融合**：现有 `DebtTracker.items` 是纯内存 dict（`self.items: Dict[str, DebtItem] = {}`），需要持久化到 SQLite
3. **与 `EntropyManager.RuleEvolution` 融合**：现有 `RuleEvolution.rules` 是纯内存 dict（`self.rules: Dict[str, EvolvingRule] = {}`），需要持久化到 SQLite
4. **与 `LoopExecutor` 融合**：Loop 的 `LoopState` 通过 `CheckpointManager` 已有持久化，但缺少事件溯源

#### 详细设计

```python
# flowforge/session/event_store.py

import json
import time
from typing import Any, Dict, List, Optional
from dataclasses import dataclass

@dataclass
class SessionEvent:
    event_id: str
    session_id: str
    event_type: str  # message_added, tool_call, compaction, checkpoint
    timestamp: float
    data: Dict[str, Any]

class EventStore:
    """事件存储：SQLite 持久化"""

    def __init__(self, db_path: str = "data/sessions.db"):
        self.db_path = db_path
        self._conn = None

    async def initialize(self) -> None:
        import aiosqlite
        self._conn = await aiosqlite.connect(self.db_path)
        await self._conn.executescript("""
            CREATE TABLE IF NOT EXISTS session_events (
                event_id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                timestamp REAL NOT NULL,
                data TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_session_id ON session_events(session_id);
            CREATE TABLE IF NOT EXISTS session_snapshots (
                session_id TEXT PRIMARY KEY,
                snapshot_data TEXT NOT NULL,
                event_id TEXT NOT NULL,
                timestamp REAL NOT NULL
            );
        """)
        await self._conn.commit()

    async def append(self, event: SessionEvent) -> None:
        await self._conn.execute(
            "INSERT INTO session_events VALUES (?, ?, ?, ?, ?)",
            (event.event_id, event.session_id, event.event_type,
             event.timestamp, json.dumps(event.data, ensure_ascii=False)))
        await self._conn.commit()

    async def get_events(self, session_id: str, since_event_id: Optional[str] = None) -> List[SessionEvent]:
        if since_event_id:
            cursor = await self._conn.execute(
                "SELECT * FROM session_events WHERE session_id = ? AND event_id > ? ORDER BY timestamp",
                (session_id, since_event_id))
        else:
            cursor = await self._conn.execute(
                "SELECT * FROM session_events WHERE session_id = ? ORDER BY timestamp",
                (session_id,))
        rows = await cursor.fetchall()
        return [SessionEvent(event_id=r[0], session_id=r[1], event_type=r[2],
                             timestamp=r[3], data=json.loads(r[4])) for r in rows]

    async def save_snapshot(self, session_id: str, snapshot_data: dict, event_id: str) -> None:
        await self._conn.execute(
            "INSERT OR REPLACE INTO session_snapshots VALUES (?, ?, ?, ?)",
            (session_id, json.dumps(snapshot_data, ensure_ascii=False), event_id, time.time()))
        await self._conn.commit()

    async def load_snapshot(self, session_id: str) -> Optional[dict]:
        cursor = await self._conn.execute(
            "SELECT snapshot_data FROM session_snapshots WHERE session_id = ?", (session_id,))
        row = await cursor.fetchone()
        return json.loads(row[0]) if row else None

# flowforge/session/run_coordinator.py

class RunCoordinator:
    """Run 协调器：管理 Session 的 run 生命周期

    融合点：与 SessionManager 配合，run/wake coalescing
    """

    def __init__(self, event_store: EventStore):
        self._event_store = event_store
        self._runs: Dict[str, Dict[str, Any]] = {}
        self._locks: Dict[str, Any] = {}

    async def start_run(self, session_id: str) -> str:
        if session_id not in self._locks:
            import asyncio
            self._locks[session_id] = asyncio.Lock()
        async with self._locks[session_id]:
            run = self._runs.get(session_id)
            if run and run["state"] == "running":
                return run["run_id"]  # coalescing
            run_id = f"run-{int(time.time())}"
            self._runs[session_id] = {"run_id": run_id, "state": "running", "started_at": time.time()}
            return run_id

    async def recover_session(self, session_id: str) -> Optional[dict]:
        """恢复 Session：快照 + 增量事件回放"""
        snapshot = await self._event_store.load_snapshot(session_id)
        if snapshot:
            events = await self._event_store.get_events(session_id, snapshot.get("_last_event_id"))
            for event in events:
                snapshot = self._apply_event(snapshot, event)
            return snapshot
        events = await self._event_store.get_events(session_id)
        state: Dict[str, Any] = {"messages": [], "metadata": {}}
        for event in events:
            state = self._apply_event(state, event)
        return state

    @staticmethod
    def _apply_event(state: dict, event: SessionEvent) -> dict:
        if event.event_type == "message_added":
            state.setdefault("messages", []).append(event.data)
        elif event.event_type == "compaction":
            state["messages"] = event.data.get("compacted_messages", [])
        state["_last_event_id"] = event.event_id
        return state
```

与 DebtTracker 的融合——持久化：

```python
# flowforge/harness/entropy_manager.py DebtTracker 增强

class DebtTracker:
    def __init__(self, db_path: Optional[str] = None):
        self.items: Dict[str, DebtItem] = {}
        self._next_id = 1
        self._db_path = db_path
        self._conn = None

    async def initialize(self) -> None:
        """初始化 SQLite 持久化"""
        if self._db_path:
            import aiosqlite
            self._conn = await aiosqlite.connect(self._db_path)
            await self._conn.executescript("""
                CREATE TABLE IF NOT EXISTS debt_items (
                    id TEXT PRIMARY KEY, description TEXT NOT NULL,
                    severity TEXT NOT NULL, status TEXT NOT NULL,
                    created_at REAL NOT NULL, source TEXT DEFAULT '',
                    metadata TEXT DEFAULT '{}'
                );
            """)
            await self._conn.commit()
            await self._load_from_db()

    def record(self, description, severity=DebtSeverity.MEDIUM, source="", metadata=None):
        """增强：记录后异步持久化"""
        item_id = f"DEBT-{self._next_id:04d}"
        self._next_id += 1
        self.items[item_id] = DebtItem(
            id=item_id, description=description, severity=severity,
            status=DebtStatus.OPEN, created_at=time.time(),
            source=source, metadata=metadata or {})
        if self._conn:
            import asyncio
            asyncio.create_task(self._persist_item(self.items[item_id]))
        return item_id
```

#### 接口变更

| 接口 | 变更类型 | 说明 |
|------|---------|------|
| `SessionManager.__init__()` | 增强 | 新增 `_event_store` 和 `_run_coordinator` |
| `SessionManager.check_and_compact()` | 增强 | Compaction 后记录事件 |
| `DebtTracker.__init__()` | 增强 | 新增 `db_path` 参数 |
| `RuleEvolution.__init__()` | 增强 | 新增 `db_path` 参数 |

#### 向后兼容

- 不配置 `db_path` 时，DebtTracker/RuleEvolution 保持纯内存模式
- 不配置 `event_store` 时，SessionManager 行为不变

#### 验收标准

- Session 崩溃后可从 EventStore 恢复
- DebtTracker 数据持久化到 SQLite
- RuleEvolution 数据持久化到 SQLite
- RunCoordinator 的 run/wake coalescing 正确工作

---

### INF-03: DI容器升级

#### 设计目标

升级 DI 容器，支持自动注入、生命周期管理、循环依赖检测。

#### 详细设计

```python
# flowforge/core/di.py

from typing import Any, Callable, Dict, List, Optional, Type, TypeVar
from enum import Enum
import inspect

T = TypeVar("T")

class Lifecycle(str, Enum):
    SINGLETON = "singleton"
    TRANSIENT = "transient"
    SCOPED = "scoped"

class DIContainer:
    def __init__(self):
        self._registrations: Dict[Type, Dict[str, Any]] = {}
        self._instances: Dict[Type, Any] = {}
        self._resolving: List[Type] = []

    def register(self, interface: Type[T], implementation: Optional[Type[T]] = None,
                 lifecycle: Lifecycle = Lifecycle.SINGLETON,
                 factory: Optional[Callable] = None) -> None:
        self._registrations[interface] = {
            "implementation": implementation or interface,
            "lifecycle": lifecycle, "factory": factory}

    def resolve(self, interface: Type[T]) -> T:
        if interface in self._resolving:
            raise RuntimeError(f"Circular dependency: {' -> '.join(t.__name__ for t in self._resolving)} -> {interface.__name__}")
        if interface in self._instances:
            return self._instances[interface]
        reg = self._registrations.get(interface)
        if not reg:
            raise RuntimeError(f"No registration for {interface.__name__}")
        self._resolving.append(interface)
        try:
            instance = self._create_instance(reg)
        finally:
            self._resolving.pop()
        if reg["lifecycle"] == Lifecycle.SINGLETON:
            self._instances[interface] = instance
        return instance

    def _create_instance(self, reg: Dict[str, Any]) -> Any:
        if reg["factory"]:
            return reg["factory"]()
        impl = reg["implementation"]
        sig = inspect.signature(impl.__init__)
        kwargs = {}
        for name, param in sig.parameters.items():
            if name == "self":
                continue
            if param.annotation != inspect.Parameter.empty and param.annotation in self._registrations:
                kwargs[name] = self.resolve(param.annotation)
        return impl(**kwargs)
```

#### 验收标准

- 自动解析构造函数依赖
- 单例/瞬态生命周期正确
- 循环依赖检测生效

---

### INF-04: Tool输出边界

#### 设计目标

实现 ToolOutputStore，将超大工具输出持久化到磁盘，仅保留摘要/引用在上下文中。

#### OpenCode 借鉴

借鉴 OpenCode 的 ToolOutputStore 模式。

#### 现有代码融合

- **融合点**：与 `SessionManager.truncate_tool_output()` 融合——现有方法仅截断，需要增加持久化能力

#### 详细设计

```python
# flowforge/tools/tool_output_store.py

import hashlib, json, os, time
from typing import Any, Dict, Optional

class ToolOutputStore:
    def __init__(self, config=None):
        self.config = config or {}
        self.store_dir = self.config.get("store_dir", "data/tool_outputs")
        self.max_inline_tokens = self.config.get("max_inline_tokens", 25000)
        self.max_inline_chars = self.max_inline_tokens * 4
        os.makedirs(self.store_dir, exist_ok=True)

    def handle_output(self, tool_name: str, task_id: str, output: Any) -> Dict[str, Any]:
        output_str = json.dumps(output, ensure_ascii=False) if not isinstance(output, str) else output
        if len(output_str) <= self.max_inline_chars:
            return {"output": output, "_persisted": False}
        content_hash = hashlib.sha256(output_str.encode()).hexdigest()[:16]
        filepath = os.path.join(self.store_dir, f"{task_id}_{tool_name}_{int(time.time())}_{content_hash}.json")
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(output_str)
        summary = output_str[:2000] + f"\n... [{len(output_str) - 2500} chars omitted] ...\n" + output_str[-500:]
        return {"output": summary, "_persisted": True, "_persist_path": filepath,
                "_original_size": len(output_str), "_content_hash": content_hash}

    def load_persisted(self, persist_path: str) -> Any:
        with open(persist_path, "r", encoding="utf-8") as f:
            return json.load(f)
```

#### 验收标准

- 超过阈值的工具输出自动持久化到磁盘
- 上下文中仅保留摘要+引用
- 可通过引用加载完整输出

---

### INF-05: 增量摘要Compaction ★重点

#### 设计目标

实现双阈值 Compaction（token 阈值 + 质量阈值）+ Overflow 恢复机制，替代现有 `SessionManager._summarize_older_messages()` 的抽取式摘要。

#### OpenCode 借鉴

1. **双阈值 Compaction**：OpenCode 在 token 阈值（92%）之外，还检测上下文质量下降，触发质量驱动的 Compaction
2. **Overflow 恢复**：当 Compaction 失败或上下文仍然溢出时，通过 `ContinueAfterOverflowCompaction` 恢复
3. **LLM-based 结构化摘要**：替代现有的 `content[:2000]` 截断式摘要

#### 现有代码融合

**关键融合点**：

1. **与 `SessionManager._compact_messages()` 融合**：现有方法使用 `keep_recent = max(2, len(conversation) // 4)` 保留最近消息，需要改为双阈值触发
2. **与 `SessionManager._summarize_older_messages()` 融合**：现有方法使用 `content[:SUMMARY_MAX_CHARS]` 截断（仅 2000 字符），需要改为 LLM-based 结构化摘要
3. **与 `FeedbackLoop` 融合**：FeedbackLoop 的 FAIL gate 可以作为质量阈值触发 Compaction 的信号
4. **与 `LoopExecutor` 融合**：通过 `TurnTransition.OVERFLOW_COMPACTION` 在 Loop 迭代中触发 Compaction

#### 详细设计

```python
# flowforge/harness/compaction.py

import time
from typing import Any, Dict, List, Optional, Tuple
from dataclasses import dataclass

@dataclass
class CompactionResult:
    compacted: bool
    trigger: str  # "token_threshold" / "quality_threshold" / "overflow"
    before_tokens: int
    after_tokens: int
    before_messages: int
    after_messages: int
    summary: Optional[str] = None
    overflow: bool = False

class DualThresholdCompactor:
    """双阈值 Compaction：token 阈值 + 质量阈值

    融合点：替代 SessionManager._compact_messages() 的单阈值逻辑
    """

    def __init__(self, config=None):
        self.config = config or {}
        self.token_threshold = self.config.get("token_threshold", 0.92)
        self.context_window = self.config.get("context_window", 128_000)
        self.recent_rounds = self.config.get("recent_rounds", 3)
        self._llm_client = self.config.get("llm_client")

    def should_compact(self, messages: List[Dict[str, Any]],
                       feedback_gate: Optional[str] = None) -> Tuple[bool, str]:
        total_tokens = self._estimate_tokens(messages)
        utilization = total_tokens / self.context_window if self.context_window > 0 else 0
        if utilization >= self.token_threshold:
            return True, "token_threshold"
        if feedback_gate == "FAIL":
            return True, "quality_threshold"
        if self._detect_repetition(messages):
            return True, "quality_repetition"
        return False, ""

    async def compact(self, messages: List[Dict[str, Any]], ctx: Any = None,
                      trigger: str = "token_threshold") -> CompactionResult:
        before_tokens = self._estimate_tokens(messages)
        before_count = len(messages)
        if len(messages) <= 3:
            return CompactionResult(False, trigger, before_tokens, before_tokens, before_count, before_count)

        system_msgs = [m for m in messages if m.get("role") == "system"]
        conversation = [m for m in messages if m.get("role") != "system"]
        keep_recent = max(2, self.recent_rounds * 2)
        older = conversation[:-keep_recent] if len(conversation) > keep_recent else []
        recent = conversation[-keep_recent:] if len(conversation) > keep_recent else conversation
        if not older:
            return CompactionResult(False, trigger, before_tokens, before_tokens, before_count, before_count)

        # ★ LLM-based 结构化摘要替代 content[:2000] 截断
        summary = await self._summarize(older, ctx)
        summary_msg = {"role": "system",
                       "content": f"[Context Summary — {len(older)} messages compacted, trigger={trigger}]\n{summary}"}
        compacted = system_msgs + [summary_msg] + recent
        after_tokens = self._estimate_tokens(compacted)
        overflow = after_tokens > self.context_window * self.token_threshold
        return CompactionResult(True, trigger, before_tokens, after_tokens, before_count, len(compacted), summary, overflow)

    async def _summarize(self, messages: List[Dict[str, Any]], ctx: Any) -> str:
        """LLM-based 结构化摘要——替代 SessionManager._summarize_older_messages()"""
        if self._llm_client is not None:
            try:
                return await self._llm_summarize(messages)
            except Exception:
                pass
        return self._extractive_summarize(messages)

    async def _llm_summarize(self, messages: List[Dict[str, Any]]) -> str:
        conversation_text = self._format_messages_for_summary(messages)
        prompt = ("请将以下对话历史压缩为结构化摘要，保留：\n"
                  "1. 已完成的任务和结果\n2. 关键决策\n3. 使用的工具和参数\n"
                  "4. 遇到的问题和解决方案\n5. 当前进度和待办\n\n"
                  f"对话历史：\n{conversation_text[:8000]}")
        from flowforge.core.base_tool import ToolInput
        output = await self._llm_client.execute(ToolInput(params={
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 2000, "temperature": 0.3}))
        return output.result.get("content", "")

    def _extractive_summarize(self, messages: List[Dict[str, Any]]) -> str:
        """增强的抽取式摘要（从 2000 提升到 4000 字符/条）"""
        parts = []
        for msg in messages:
            role = msg.get("role", "unknown")
            content = msg.get("content", "")
            if isinstance(content, list):
                content = " ".join(p.get("text", "") if isinstance(p, dict) else str(p) for p in content)
            if isinstance(content, str) and content:
                parts.append(f"[{role}] {content[:4000]}")
        summary = "\n".join(parts)
        return summary[:8000] + "\n... [summary truncated]" if len(summary) > 8000 else summary

    def _detect_repetition(self, messages: List[Dict[str, Any]]) -> bool:
        recent = [msg.get("content", "")[:200] for msg in messages[-6:] if isinstance(msg.get("content", ""), str) and len(msg.get("content", "")) > 50]
        for i in range(len(recent) - 1):
            if recent[i] == recent[i + 1]:
                return True
        return False

    @staticmethod
    def _estimate_tokens(messages: List[Dict[str, Any]]) -> int:
        total = 0
        for msg in messages:
            content = msg.get("content", "")
            if isinstance(content, str):
                total += max(1, len(content) // 4)
            elif isinstance(content, list):
                for part in content:
                    if isinstance(part, dict):
                        total += max(1, len(part.get("text", "")) // 4)
        return total

    @staticmethod
    def _format_messages_for_summary(messages: List[Dict[str, Any]]) -> str:
        parts = []
        for msg in messages:
            role = msg.get("role", "unknown")
            content = msg.get("content", "")
            if isinstance(content, list):
                content = " ".join(p.get("text", "") if isinstance(p, dict) else str(p) for p in content)
            parts.append(f"[{role}] {str(content)[:500]}")
        return "\n".join(parts)
```

与 SessionManager 的融合：

```python
class SessionManager:
    def __init__(self, config=None):
        # ... 现有初始化 ...
        self._dual_compactor: Optional[DualThresholdCompactor] = None

    def set_dual_compactor(self, compactor: DualThresholdCompactor) -> None:
        self._dual_compactor = compactor

    async def check_and_compact(self, ctx) -> Dict[str, Any]:
        if self._dual_compactor:
            messages = ctx.state.get("messages", []) if hasattr(ctx, 'state') else []
            feedback_gate = ctx.metadata.get("_feedback", {}).get("gate") if hasattr(ctx, 'metadata') else None
            should, trigger = self._dual_compactor.should_compact(messages, feedback_gate)
            if not should:
                return {"compacted": False, "before_tokens": 0, "after_tokens": 0}
            result = await self._dual_compactor.compact(messages, ctx, trigger)
            if result.compacted and hasattr(ctx, 'state'):
                ctx.state["compaction_applied"] = True
            return {"compacted": result.compacted, "before_tokens": result.before_tokens,
                    "after_tokens": result.after_tokens, "trigger": result.trigger, "overflow": result.overflow}
        return await self._check_and_compact_original(ctx)
```

#### 接口变更

| 接口 | 变更类型 | 说明 |
|------|---------|------|
| `SessionManager.check_and_compact()` | 增强 | 使用双阈值 Compactor |
| `SessionManager._summarize_older_messages()` | 替换 | LLM-based 结构化摘要 |

#### 向后兼容

- 不配置 `DualThresholdCompactor` 时使用现有单阈值逻辑
- LLM 不可用时自动回退到增强的抽取式摘要

#### 验收标准

- 双阈值（token + 质量）触发 Compaction
- LLM-based 结构化摘要替代截断式摘要
- FeedbackLoop FAIL 可触发质量驱动的 Compaction
- Overflow 恢复机制正确工作

---

### INF-06: 指数退避重试

#### 设计目标

实现指数退避重试 + 瞬态错误检测。

#### 详细设计

```python
# flowforge/core/retry.py

import asyncio, random
from typing import Any, Callable, List, Optional, Type

TRANSIENT_ERROR_PATTERNS = [
    "timeout", "connection", "rate_limit", "429", "503", "502", "temporarily", "overloaded"]

class RetryPolicy:
    def __init__(self, max_retries=3, base_delay=1.0, max_delay=60.0,
                 exponential_base=2.0, jitter=True, retryable_exceptions=None):
        self.max_retries = max_retries
        self.base_delay = base_delay
        self.max_delay = max_delay
        self.exponential_base = exponential_base
        self.jitter = jitter
        self.retryable_exceptions = retryable_exceptions or []

    def is_retryable(self, error: Exception) -> bool:
        for exc_type in self.retryable_exceptions:
            if isinstance(error, exc_type):
                return True
        error_msg = str(error).lower()
        return any(p in error_msg for p in TRANSIENT_ERROR_PATTERNS)

    def compute_delay(self, attempt: int) -> float:
        delay = min(self.base_delay * (self.exponential_base ** attempt), self.max_delay)
        return delay * (0.5 + random.random()) if self.jitter else delay

async def retry_with_backoff(func: Callable, policy: RetryPolicy, *args, **kwargs) -> Any:
    last_error = None
    for attempt in range(policy.max_retries + 1):
        try:
            return await func(*args, **kwargs)
        except Exception as e:
            last_error = e
            if not policy.is_retryable(e) or attempt >= policy.max_retries:
                raise
            await asyncio.sleep(policy.compute_delay(attempt))
    raise last_error
```

#### 验收标准

- 瞬态错误正确识别
- 指数退避 + jitter 延迟计算正确

---

### INF-07: SSE超时保护

#### 设计目标

为 SSE 流式输出添加超时保护。

#### 详细设计

```python
# flowforge/api/sse_timeout.py

import asyncio, time
from typing import AsyncIterator, Dict

class SSETimeoutWrapper:
    def __init__(self, timeout=300.0, idle_timeout=30.0, heartbeat_interval=15.0):
        self.timeout = timeout
        self.idle_timeout = idle_timeout
        self.heartbeat_interval = heartbeat_interval

    async def wrap(self, source: AsyncIterator[dict]) -> AsyncIterator[dict]:
        start_time = time.time()
        last_event_time = start_time
        while True:
            elapsed = time.time() - start_time
            if elapsed > self.timeout:
                yield {"event": "timeout", "data": '{"reason": "total_timeout"}'}
                return
            try:
                event = await asyncio.wait_for(source.__anext__(), timeout=self.idle_timeout)
                last_event_time = time.time()
                yield event
            except StopAsyncIteration:
                yield {"event": "done", "data": '{}'}
                return
            except asyncio.TimeoutError:
                if time.time() - last_event_time > self.idle_timeout:
                    yield {"event": "heartbeat", "data": f'{{"elapsed": {elapsed:.0f}}}'}
                    last_event_time = time.time()
```

#### 验收标准

- SSE 总超时和空闲超时正确触发
- 心跳事件定期发送

---

### INF-08: 十层安全防御

#### 设计目标

构建十层安全防御体系。

#### 详细设计

```
L1: Tool 调用超时 (现有: ToolRegistry.execute(), 120s)
L2: 重复检测 (现有: BaseModeExecutor._on_exit(), threshold=3)
L3: 自修正 (现有: WorkflowExecutor on_error="reflexion_retry")
L4: 权限管线 (现有: PermissionPipeline deny→ask→allow)
L5: 输入校验 (新增: InputGuardrail)
L6: 输出过滤 (新增: OutputGuardrail, 敏感信息脱敏)
L7: 速率限制 (新增: RateLimiter)
L8: 审计日志 (新增: AuditLogger)
L9: 沙箱隔离 (新增: SandboxExecutor)
L10: 凭据保护 (新增: CredentialStore)
```

```python
# flowforge/security/defense.py

class DefensePipeline:
    def __init__(self, config=None):
        self.config = config or {}
        # L1-L3: 复用现有三层防御
        # L4: 复用现有 PermissionPipeline
        # L5-L10: 新增防御层

    async def check_input(self, ctx) -> bool:
        """输入侧安全检查（L1-L5）"""
        return True

    async def check_output(self, result: dict, ctx) -> dict:
        """输出侧安全检查（L6-L10）"""
        return result
```

#### 验收标准

- 十层防御全部可配置开关
- 与 HarnessOrchestrator 集成

---

### INF-09: 架构边界清理

#### 设计目标

清理 FlowForge 中的 23 处特定领域代码（~1100行）。

#### 详细设计

```
清理策略：
1. 识别 23 处特定领域代码
2. 将每处代码标记为 deprecated
3. 提供等价的注册式替代方案
4. 分 3 批删除（每批后全量回归测试）

第一批（8处）：ContentForge 的 Agent/Tool 定义 → 移至 contentforge/
第二批（8处）：NovelForge 的 Agent/Tool 定义 → 移至 novelforge/
第三批（7处）：DevForge 的 Agent/Tool 定义 → 移至 devforge/ + 5 个硬编码配置外置为 YAML
```

#### 验收标准

- FlowForge 不含任何特定领域代码
- 旧 import 路径仍可使用（带 DeprecationWarning）
- 全量回归测试通过

---

## Phase 2 — 核心能力升级

---

### CAP-01: System Context代数系统 ★重点

#### 设计目标

实现 Source<A> 代数系统，替代现有 `ContextEngine._build_dynamic_context()` 的 dict-based 上下文组装方式。

#### OpenCode 借鉴

借鉴 OpenCode 的 SystemContext 代数——上下文不是简单的 dict 拼接，而是通过 Source<A> 代数操作（reconcile/replace/merge）组合，支持增量更新和冲突解决。

#### 现有代码融合

**这是最关键的融合点之一**：

1. **现有 `_build_dynamic_context()` 的问题**：它从 `ctx` 属性中提取固定字段（task_id, persona, mode 等），组装成 dict。无法表达上下文来源、优先级、冲突解决策略。

2. **Source<A> 代数的解决方案**：每个上下文片段是一个 `Source[ContextFragment]`，具有来源标识、优先级、合并策略。多个 Source 通过代数操作组合。

3. **融合方式**：`ContextEngine.inject()` 内部使用 Source<A> 代数组装上下文，但对外接口不变——仍然写入 `ctx.state["harness_context"]`。

#### 详细设计

```python
# flowforge/harness/context_algebra.py

from abc import ABC, abstractmethod
from typing import Any, Callable, Dict, Generic, List, Optional, TypeVar
from dataclasses import dataclass, field
from enum import Enum

A = TypeVar("A")

class MergeStrategy(str, Enum):
    REPLACE = "replace"
    RECONCILE = "reconcile"
    PREPEND = "prepend"
    APPEND = "append"

@dataclass
class ContextFragment:
    key: str
    content: Any
    source: str = ""
    priority: int = 0
    merge_strategy: MergeStrategy = MergeStrategy.RECONCILE
    metadata: Dict[str, Any] = field(default_factory=dict)

class Source(ABC, Generic[A]):
    """上下文 Source 代数基类"""
    @abstractmethod
    async def resolve(self, ctx: Any) -> A: ...

    def reconcile(self, other: 'Source[A]') -> 'Source[A]':
        return ReconcileSource(self, other)

    def replace(self, other: 'Source[A]') -> 'Source[A]':
        return ReplaceSource(self, other)

    def map(self, fn: Callable[[A], A]) -> 'Source[A]':
        return MapSource(self, fn)

class PureSource(Source[A]):
    def __init__(self, value: A, source_name: str = "pure"):
        self._value = value
    async def resolve(self, ctx: Any) -> A:
        return self._value

class ComputedSource(Source[A]):
    def __init__(self, compute_fn: Callable[[Any], A], source_name: str = "computed"):
        self._compute_fn = compute_fn
    async def resolve(self, ctx: Any) -> A:
        return self._compute_fn(ctx)

class ReconcileSource(Source[A]):
    def __init__(self, left: Source[A], right: Source[A]):
        self._left = left
        self._right = right
    async def resolve(self, ctx: Any) -> A:
        left_val = await self._left.resolve(ctx)
        right_val = await self._right.resolve(ctx)
        if left_val is None: return right_val
        if right_val is None: return left_val
        if isinstance(left_val, dict) and isinstance(right_val, dict):
            result = dict(left_val)
            for k, v in right_val.items():
                if k in result:
                    result[k] = {"value": v, "conflicts_with": result[k]}
                else:
                    result[k] = v
            return result
        if isinstance(left_val, list) and isinstance(right_val, list):
            return left_val + right_val
        if isinstance(left_val, str) and isinstance(right_val, str):
            return left_val + "\n" + right_val
        return right_val

class ReplaceSource(Source[A]):
    def __init__(self, old: Source[A], new: Source[A]):
        self._new = new
    async def resolve(self, ctx: Any) -> A:
        return await self._new.resolve(ctx)

class MapSource(Source[A]):
    def __init__(self, source: Source[A], fn: Callable[[A], A]):
        self._source = source
        self._fn = fn
    async def resolve(self, ctx: Any) -> A:
        return self._fn(await self._source.resolve(ctx))

class SystemContext:
    """System Context 代数系统

    融合点：替代 ContextEngine._build_dynamic_context() 的 dict 组装方式
    """

    def __init__(self):
        self._sources: Dict[str, Source[ContextFragment]] = {}

    def add_source(self, key: str, source: Source[ContextFragment]) -> 'SystemContext':
        if key in self._sources:
            self._sources[key] = self._sources[key].reconcile(source)
        else:
            self._sources[key] = source
        return self

    def replace_source(self, key: str, source: Source[ContextFragment]) -> 'SystemContext':
        if key in self._sources:
            self._sources[key] = self._sources[key].replace(source)
        else:
            self._sources[key] = source
        return self

    async def resolve(self, ctx: Any) -> Dict[str, Any]:
        """解析所有 Source，组装完整上下文"""
        resolved: Dict[str, Any] = {}
        for key, source in self._sources.items():
            fragment = await source.resolve(ctx)
            if fragment is not None:
                if isinstance(fragment, ContextFragment):
                    resolved[fragment.key] = fragment.content
                else:
                    resolved[key] = fragment
        return resolved

    async def resolve_formatted(self, ctx: Any) -> str:
        """解析并格式化为字符串"""
        resolved = await self.resolve(ctx)
        parts = []
        for key, value in resolved.items():
            if isinstance(value, str) and value:
                parts.append(f"## {key}\n{value}")
            elif isinstance(value, dict):
                parts.append(f"## {key}\n" + "\n".join(f"- {k}: {v}" for k, v in value.items()))
        return "\n\n".join(parts)
```

与 ContextEngine 的融合：

```python
class ContextEngine:
    def __init__(self, config=None):
        # ... 现有初始化 ...
        self._system_context = SystemContext()
        self._setup_default_sources()

    def _setup_default_sources(self) -> None:
        self._system_context.add_source("agents_md",
            ComputedSource(lambda ctx: ContextFragment(
                key="agents_md", content=self._load_agents_md(getattr(ctx, 'persona', '') or ''),
                source="agents_md_loader", priority=10)))
        self._system_context.add_source("dynamic_context",
            ComputedSource(lambda ctx: ContextFragment(
                key="dynamic_context", content=self._build_dynamic_context(ctx),
                source="dynamic", priority=3)))

    async def inject(self, ctx) -> None:
        assembled = await self._system_context.resolve(ctx)
        if hasattr(ctx, 'state'):
            ctx.state["harness_context"] = assembled
        if hasattr(ctx, 'metadata'):
            for key in ("agents_md", "past_failures", "handoff"):
                if key in assembled:
                    ctx.metadata[key] = assembled[key]
```

#### 接口变更

| 接口 | 变更类型 | 说明 |
|------|---------|------|
| `ContextEngine.inject()` | 增强 | 内部使用 SystemContext 代数 |
| `ContextEngine._build_dynamic_context()` | 保留 | 作为 ComputedSource 的计算函数 |

#### 向后兼容

- `inject()` 的外部行为不变——仍然写入 `ctx.state["harness_context"]` 和 `ctx.metadata`
- `_build_dynamic_context()` 保留作为 Source 的计算函数

#### 验收标准

- Source<A> 代数操作（reconcile/replace/map）正确工作
- SystemContext 可组装多个 Source
- 与 ContextEngine.inject() 集成后行为兼容
- 上下文变更只发差异（增量更新）

---

### CAP-02: Permission V2有序规则集

#### 设计目标

实现 Permission V2 的 findLast + ask 三态模式。

#### 详细设计

```python
# flowforge/security/permission_v2.py

from typing import Any, Dict, List, Optional
from dataclasses import dataclass
from enum import Enum
import fnmatch

class PermissionDecision(str, Enum):
    ALLOW = "allow"
    DENY = "deny"
    ASK = "ask"

@dataclass
class PermissionRule:
    name: str
    pattern: str
    decision: PermissionDecision
    priority: int = 0
    condition: Optional[str] = None
    message: str = ""

class PermissionV2:
    def __init__(self):
        self._rules: List[PermissionRule] = []

    def add_rule(self, rule: PermissionRule) -> None:
        self._rules.append(rule)
        self._rules.sort(key=lambda r: r.priority)

    async def evaluate(self, tool_name: str, params: dict, context: Any) -> PermissionDecision:
        last_match = None
        for rule in self._rules:
            if self._matches(rule.pattern, tool_name):
                last_match = rule
        if last_match is None:
            return PermissionDecision.ALLOW
        if last_match.decision == PermissionDecision.ASK:
            approved = await self._request_user_approval(last_match, tool_name, params, context)
            return PermissionDecision.ALLOW if approved else PermissionDecision.DENY
        return last_match.decision

    def _matches(self, pattern: str, tool_name: str) -> bool:
        if pattern == "*" or pattern == tool_name:
            return True
        if "*" in pattern:
            return fnmatch.fnmatch(tool_name, pattern)
        if pattern.endswith(".*"):
            return tool_name.startswith(pattern[:-2] + ".")
        return False

    async def _request_user_approval(self, rule, tool_name, params, context) -> bool:
        if hasattr(context, 'request_user_approval'):
            return await context.request_user_approval(tool_name, params)
        return False
```

#### 验收标准

- findLast 语义正确
- ask 三态支持用户确认
- 规则可从 YAML 加载

---

### CAP-03: Stale Tool Rejection

#### 设计目标

实现工具 identity 版本控制，拒绝使用过期的工具定义。

#### 详细设计

```python
# flowforge/tools/stale_rejection.py

import hashlib, time
from dataclasses import dataclass
from typing import Dict

@dataclass
class ToolIdentity:
    name: str
    version: int = 1
    hash: str = ""
    registered_at: float = 0.0
    updated_at: float = 0.0

class StaleToolChecker:
    def __init__(self, ttl=3600):
        self._identities: Dict[str, ToolIdentity] = {}
        self._ttl = ttl

    def register_identity(self, tool_name: str, tool_hash: str) -> ToolIdentity:
        now = time.time()
        existing = self._identities.get(tool_name)
        if existing:
            existing.version += 1
            existing.hash = tool_hash
            existing.updated_at = now
            return existing
        identity = ToolIdentity(name=tool_name, version=1, hash=tool_hash,
                                registered_at=now, updated_at=now)
        self._identities[tool_name] = identity
        return identity

    def check_stale(self, tool_name: str, current_hash: str) -> bool:
        identity = self._identities.get(tool_name)
        if not identity:
            return False
        if identity.hash != current_hash:
            return True
        return time.time() - identity.updated_at > self._ttl
```

#### 验收标准

- 工具定义变更后旧版本被拒绝
- TTL 过期后工具被标记为 stale

---

### CAP-04: Agent步数限制+隐藏Agent

已在 FWK-09 中设计。补充：`max_steps` 与 `LoopExecutor.TurnTransitionEngine.max_steps` 对接，`hidden` 与 `AgentRegistry.list(include_hidden)` 对接。

---

### CAP-05: Agent权限规则集

#### 详细设计

```python
# flowforge/security/agent_permissions.py

from dataclasses import dataclass, field
from typing import Any, Dict, Optional, Set

@dataclass
class AgentPermissionSet:
    agent_name: str
    allowed_tools: Set[str] = field(default_factory=set)
    denied_tools: Set[str] = field(default_factory=set)
    allowed_modes: Set[str] = field(default_factory=set)
    max_steps: int = 25
    require_approval_for: Set[str] = field(default_factory=set)

    def is_tool_allowed(self, tool_name: str) -> bool:
        if self.denied_tools and tool_name in self.denied_tools:
            return False
        if self.allowed_tools and tool_name not in self.allowed_tools:
            return False
        return True

class AgentPermissionManager:
    def __init__(self):
        self._permission_sets: Dict[str, AgentPermissionSet] = {}

    def register(self, perm_set: AgentPermissionSet) -> None:
        self._permission_sets[perm_set.agent_name] = perm_set

    def check_tool_access(self, agent_name: str, tool_name: str) -> str:
        perm = self._permission_sets.get(agent_name)
        if not perm:
            return "allow"
        if not perm.is_tool_allowed(tool_name):
            return "deny"
        if tool_name in perm.require_approval_for:
            return "ask"
        return "allow"
```

---

### CAP-06: Agent工具过滤

#### 详细设计

```python
# flowforge/core/tool_registry.py 增强

class ToolRegistry:
    def get_available_tools(self, agent_name=None, permission_manager=None):
        tools = list(self._tools.values())
        if agent_name and permission_manager:
            perm = permission_manager.get_permissions(agent_name)
            if perm:
                tools = [t for t in tools if perm.is_tool_allowed(t.name)]
        return tools
```

---

### CAP-07: 文件编辑Stale Content检测

#### 详细设计

```python
# flowforge/tools/stale_content_checker.py

import hashlib
from typing import Dict, Optional

class StaleContentChecker:
    def __init__(self):
        self._read_hashes: Dict[str, str] = {}

    def record_read(self, path: str, content: str) -> None:
        self._read_hashes[path] = hashlib.sha256(content.encode()).hexdigest()[:16]

    def check_stale(self, path: str, current_content: str) -> bool:
        recorded_hash = self._read_hashes.get(path)
        if not recorded_hash:
            return False
        current_hash = hashlib.sha256(current_content.encode()).hexdigest()[:16]
        return recorded_hash != current_hash
```

---

### CAP-08: Token估算+小模型选择

#### 详细设计

```python
# flowforge/llm/token_estimator.py

class TokenEstimator:
    CJK_RATIO = 1.5
    LATIN_RATIO = 0.25

    @classmethod
    def estimate(cls, text: str) -> int:
        if not text: return 0
        cjk = sum(1 for c in text if '\u4e00' <= c <= '\u9fff')
        latin = len(text) - cjk
        return int(cjk * cls.CJK_RATIO + latin * cls.LATIN_RATIO)

    @classmethod
    def should_use_small_model(cls, prompt_tokens: int, threshold: int = 2000) -> bool:
        return prompt_tokens < threshold

class ModelSelector:
    def __init__(self, config=None):
        self.config = config or {}
        self.small_model = self.config.get("small_model", "")
        self.large_model = self.config.get("large_model", "")
        self.token_threshold = self.config.get("token_threshold", 2000)

    def select(self, prompt: str) -> str:
        tokens = TokenEstimator.estimate(prompt)
        if TokenEstimator.should_use_small_model(tokens, self.token_threshold):
            return self.small_model or self.large_model
        return self.large_model
```

---

### CAP-09: Context Epoch ★重点

#### 设计目标

实现 Context Epoch（上下文快照 + 乐观锁），当 Loop 涉及多个 Agent 时，每次 Agent 切换保存和恢复上下文快照。

#### OpenCode 借鉴

借鉴 OpenCode 的 ContextEpoch 机制——上下文不是全局共享的，而是按 epoch 管理。每次 epoch 切换时保存快照，新 epoch 从快照恢复。乐观锁确保并发安全。

#### 现有代码融合

**关键融合点**：

1. **与 `LoopExecutor` 融合**：当 Loop 涉及多个 Agent（如 Reflexion 的 Actor→Evaluator→Reflector），每次 Agent 切换时需要 ContextEpoch 管理
2. **与 `ContextEngine` 融合**：ContextEpoch 的快照包含 `ContextEngine.inject()` 注入的上下文
3. **与 `SessionManager` 融合**：ContextEpoch 的快照包含 `SessionManager` 管理的消息历史
4. **与 `TurnTransition` 融合**：`TurnKind.AGENT_SWITCH` 触发 ContextEpoch 切换

#### 详细设计

```python
# flowforge/harness/context_epoch.py

import copy, hashlib, time
from typing import Any, Dict, List, Optional
from dataclasses import dataclass, field

@dataclass
class EpochSnapshot:
    epoch_id: str
    agent_name: str
    timestamp: float
    messages: List[Dict[str, Any]]
    harness_context: Dict[str, Any]
    state: Dict[str, Any]
    metadata: Dict[str, Any]
    hash: str = ""

    def __post_init__(self):
        if not self.hash:
            content = str(len(self.messages)) + str(self.harness_context.get("agents_md", ""))[:100] + str(self.timestamp)
            self.hash = hashlib.sha256(content.encode()).hexdigest()[:16]

@dataclass
class ContextEpoch:
    """Context Epoch 管理

    融合点：嵌入 LoopExecutor._execute_iterations()，
    当 TurnTransition 为 AGENT_SWITCH 时触发 epoch 切换
    """
    current_epoch_id: str = "epoch-0"
    snapshots: List[EpochSnapshot] = field(default_factory=list)
    _epoch_counter: int = 0

    def save_snapshot(self, agent_name: str, ctx: Any) -> EpochSnapshot:
        """保存当前 epoch 的快照"""
        self._epoch_counter += 1
        epoch_id = f"epoch-{self._epoch_counter}"
        snapshot = EpochSnapshot(
            epoch_id=epoch_id, agent_name=agent_name, timestamp=time.time(),
            messages=copy.deepcopy(ctx.state.get("messages", [])) if hasattr(ctx, 'state') else [],
            harness_context=copy.deepcopy(ctx.state.get("harness_context", {})) if hasattr(ctx, 'state') else {},
            state=copy.deepcopy(ctx.state) if hasattr(ctx, 'state') else {},
            metadata=copy.deepcopy(ctx.metadata) if hasattr(ctx, 'metadata') else {},
        )
        self.snapshots.append(snapshot)
        self.current_epoch_id = epoch_id
        return snapshot

    def restore_snapshot(self, epoch_id: str, ctx: Any) -> bool:
        """恢复指定 epoch 的快照"""
        snapshot = next((s for s in self.snapshots if s.epoch_id == epoch_id), None)
        if not snapshot:
            return False
        if hasattr(ctx, 'state'):
            ctx.state["messages"] = copy.deepcopy(snapshot.messages)
            ctx.state["harness_context"] = copy.deepcopy(snapshot.harness_context)
            for key, value in snapshot.state.items():
                if key not in ctx.state:
                    ctx.state[key] = copy.deepcopy(value)
        if hasattr(ctx, 'metadata'):
            for key, value in snapshot.metadata.items():
                if key not in ctx.metadata:
                    ctx.metadata[key] = copy.deepcopy(value)
        self.current_epoch_id = epoch_id
        return True
```

与 LoopExecutor 的融合：

```python
class LoopExecutor:
    async def _execute_iterations(self, task, loop_config, state, ...):
        context_epoch = ContextEpoch()
        current_agent = loop_config.get("agent", "default")

        for attempt in range(max_retries):
            # ... 执行逻辑 ...

            transition = self.turn_engine.decide(...)
            if transition.kind == TurnKind.AGENT_SWITCH:
                context_epoch.save_snapshot(current_agent, task)
                current_agent = transition.next_agent
                # 重新注入上下文
                await self.harness.pre_execute(task)
```

#### 接口变更

| 接口 | 变更类型 | 说明 |
|------|---------|------|
| `LoopExecutor._execute_iterations()` | 增强 | 新增 ContextEpoch 管理 |
| `TurnTransition` | 增强 | 新增 `AGENT_SWITCH` 类型 |
| `LoopState` | 增强 | 新增 `context_epoch_id` 字段 |

#### 向后兼容

- 不涉及多 Agent 切换的 Loop 不使用 ContextEpoch
- ContextEpoch 为可选功能

#### 验收标准

- Agent 切换时正确保存/恢复 epoch 快照
- 乐观锁检测到冲突时记录警告
- 快照包含消息历史、Harness 上下文、state、metadata

---

### CAP-10: 流式工具并行执行 ★重点

#### 设计目标

实现流式工具并行执行，借鉴 OpenCode 的 FiberSet 模式，增强 `LoopExecutor` 的并行 Worker 能力。

#### OpenCode 借鉴

借鉴 OpenCode 的 FiberSet 模式——多个工具调用可以并行执行，结果通过 FiberSet 收集。当某个工具先完成时，可以立即处理其结果（eager settlement），而不必等待所有工具完成。

#### 现有代码融合

**关键融合点**：

1. **与 `LoopExecutor._execute_parallel_workers()` 融合**：现有实现使用 `asyncio.gather` 等待所有 Worker 完成，需要改为 FiberSet 模式支持流式结果收集
2. **与 `parallel.py` 的 `execute_parallel_workers()` 融合**：现有实现创建 `ParallelWorkerResult`，需要增强为 FiberSet
3. **与 `MultiJudgeVerifier._call_judge()` 融合**：多评委并行调用已经是 `asyncio.gather`，可以增强为 FiberSet 支持流式结果

#### 详细设计

```python
# flowforge/loop/fiber_set.py

import asyncio
from typing import Any, Callable, Dict, Generic, List, Optional, TypeVar
from dataclasses import dataclass, field
from enum import Enum

T = TypeVar("T")

class FiberState(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"

@dataclass
class Fiber(Generic[T]):
    """单个并行执行单元"""
    name: str
    state: FiberState = FiberState.PENDING
    result: Optional[T] = None
    error: Optional[str] = None
    _task: Optional[asyncio.Task] = field(default=None, repr=False)

class FiberSet(Generic[T]):
    """FiberSet：流式工具并行执行

    融合点：替代 parallel.py 的 execute_parallel_workers()
    增强：支持流式结果收集（eager settlement）
    """

    def __init__(self):
        self._fibers: Dict[str, Fiber[T]] = {}
        self._completion_queue: asyncio.Queue[str] = asyncio.Queue()

    def add(self, name: str, coro_fn: Callable[[], Any]) -> Fiber[T]:
        """添加并行执行单元"""
        fiber = Fiber[T](name=name)
        self._fibers[name] = fiber
        fiber._task = asyncio.create_task(self._run_fiber(name, coro_fn))
        return fiber

    async def _run_fiber(self, name: str, coro_fn: Callable) -> None:
        """执行单个 Fiber"""
        fiber = self._fibers[name]
        fiber.state = FiberState.RUNNING
        try:
            fiber.result = await coro_fn()
            fiber.state = FiberState.COMPLETED
        except Exception as e:
            fiber.error = str(e)
            fiber.state = FiberState.FAILED
        finally:
            await self._completion_queue.put(name)

    async def next_completed(self) -> Optional[Fiber[T]]:
        """获取下一个完成的 Fiber（流式结果收集）

        这是 FiberSet 的核心优势：
        不必等待所有 Fiber 完成，可以逐个处理结果
        """
        try:
            name = await asyncio.wait_for(self._completion_queue.get(), timeout=0.1)
            return self._fibers[name]
        except asyncio.TimeoutError:
            return None

    async def wait_all(self) -> List[Fiber[T]]:
        """等待所有 Fiber 完成"""
        for fiber in self._fibers.values():
            if fiber._task:
                await fiber._task
        return list(self._fibers.values())

    @property
    def all_completed(self) -> bool:
        return all(f.state in (FiberState.COMPLETED, FiberState.FAILED)
                   for f in self._fibers.values())

    @property
    def results(self) -> Dict[str, T]:
        return {name: f.result for name, f in self._fibers.items()
                if f.state == FiberState.COMPLETED and f.result is not None}

    @property
    def errors(self) -> Dict[str, str]:
        return {name: f.error for name, f in self._fibers.items()
                if f.state == FiberState.FAILED and f.error is not None}
```

与 LoopExecutor 的融合：

```python
# flowforge/loop/executor.py 增强

class LoopExecutor:
    async def _execute_parallel_workers(self, task, worker_config, state):
        """增强：使用 FiberSet 替代 asyncio.gather"""
        from flowforge.loop.fiber_set import FiberSet
        workers = worker_config.get("workers", [])
        fiber_set = FiberSet()

        for worker in workers:
            name = worker.get("name", "unknown")
            mode = worker.get("mode", "workflow")
            task_copy = copy.deepcopy(task)
            task_copy.mode = mode

            async def run_worker(t=task_copy, m=mode):
                return await self.hybrid_executor.run(t, mode_hint=m)

            fiber_set.add(name, run_worker)

        # ★ 流式结果收集：逐个处理完成的 Worker
        while not fiber_set.all_completed:
            fiber = await fiber_set.next_completed()
            if fiber:
                if fiber.state == "completed":
                    logger.info(f"Worker '{fiber.name}' completed")
                else:
                    state.past_errors.append(f"Worker '{fiber.name}' failed: {fiber.error}")

        # 合并结果
        merge_strategy = worker_config.get("merge_strategy", "concat")
        if merge_strategy == "concat":
            return dict(fiber_set.results)
        elif merge_strategy == "reduce":
            merged = {}
            for result in fiber_set.results.values():
                if isinstance(result, dict):
                    merged.update(result)
            return merged
        return fiber_set.results
```

与 MultiJudgeVerifier 的融合：

```python
# flowforge/loop/verifier.py MultiJudgeVerifier 增强

class MultiJudgeVerifier(LoopVerifier):
    async def verify(self, result, task, config):
        # ... 现有逻辑 ...

        # ★ 使用 FiberSet 替代 asyncio.gather
        from flowforge.loop.fiber_set import FiberSet
        fiber_set = FiberSet()
        for j in active_judges:
            fiber_set.add(j, lambda model=j: self._call_judge(model, prompt, task))

        await fiber_set.wait_all()
        valid_results = [f.result for f in fiber_set._fibers.values()
                         if f.state.value == "completed" and isinstance(f.result, dict)]

        # ... 后续聚合逻辑不变 ...
```

#### 接口变更

| 接口 | 变更类型 | 说明 |
|------|---------|------|
| `LoopExecutor._execute_parallel_workers()` | 重构 | 使用 FiberSet 替代 asyncio.gather |
| `MultiJudgeVerifier.verify()` | 增强 | 使用 FiberSet 替代 asyncio.gather |
| `parallel.py execute_parallel_workers()` | 增强 | 可选使用 FiberSet |

#### 向后兼容

- FiberSet 为内部优化，外部接口不变
- 不使用 FiberSet 时回退到 `asyncio.gather`

#### 验收标准

- 多个工具可并行执行
- 流式结果收集：先完成的先处理
- 与 LoopExecutor 和 MultiJudgeVerifier 集成
- FiberSet 的错误处理正确

---

### CAP-11: 持久化事件流

#### 设计目标

实现持久化事件流，确保事件不丢失。

#### OpenCode 借鉴

借鉴 OpenCode 的 Durable Event Stream 模式。

#### 详细设计

```python
# flowforge/events/durable_stream.py

import json, time
from typing import Any, Dict, List, Optional

class DurableEventStream:
    """持久化事件流：SQLite 存储"""

    def __init__(self, db_path: str = "data/events.db"):
        self.db_path = db_path
        self._conn = None

    async def initialize(self) -> None:
        import aiosqlite
        self._conn = await aiosqlite.connect(self.db_path)
        await self._conn.executescript("""
            CREATE TABLE IF NOT EXISTS events (
                event_id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                timestamp REAL NOT NULL,
                payload TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_task_id ON events(task_id);
        """)
        await self._conn.commit()

    async def emit(self, task_id: str, event_type: str, payload: Dict[str, Any]) -> str:
        event_id = f"evt-{int(time.time()*1000)}"
        await self._conn.execute(
            "INSERT INTO events VALUES (?, ?, ?, ?, ?)",
            (event_id, task_id, event_type, time.time(),
             json.dumps(payload, ensure_ascii=False)))
        await self._conn.commit()
        return event_id

    async def get_events(self, task_id: str, event_type: Optional[str] = None) -> List[Dict]:
        if event_type:
            cursor = await self._conn.execute(
                "SELECT * FROM events WHERE task_id = ? AND event_type = ? ORDER BY timestamp",
                (task_id, event_type))
        else:
            cursor = await self._conn.execute(
                "SELECT * FROM events WHERE task_id = ? ORDER BY timestamp", (task_id,))
        return [{"event_id": r[0], "task_id": r[1], "event_type": r[2],
                 "timestamp": r[3], "payload": json.loads(r[4])} for r in await cursor.fetchall()]
```

#### 验收标准

- 事件持久化到 SQLite
- 可按 task_id 和 event_type 查询
- 与 EventBus 集成

---

### CAP-12: Credential安全存储

#### 设计目标

实现 API Key 等凭据的安全存储。

#### 详细设计

```python
# flowforge/security/credential_store.py

import hashlib, os, json
from typing import Dict, Optional
from cryptography.fernet import Fernet

class CredentialStore:
    """凭据安全存储"""

    def __init__(self, db_path: str = "data/credentials.db", encryption_key: Optional[str] = None):
        self.db_path = db_path
        if encryption_key:
            self._fernet = Fernet(encryption_key.encode())
        else:
            key = Fernet.generate_key()
            self._fernet = Fernet(key)

    def store(self, key: str, value: str) -> None:
        encrypted = self._fernet.encrypt(value.encode())
        store = self._load_store()
        store[key] = encrypted.decode()
        self._save_store(store)

    def retrieve(self, key: str) -> Optional[str]:
        store = self._load_store()
        encrypted = store.get(key)
        if encrypted:
            return self._fernet.decrypt(encrypted.encode()).decode()
        return None

    def _load_store(self) -> Dict[str, str]:
        if not os.path.exists(self.db_path):
            return {}
        with open(self.db_path, "r") as f:
            return json.load(f)

    def _save_store(self, store: Dict[str, str]) -> None:
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        with open(self.db_path, "w") as f:
            json.dump(store, f)
```

#### 验收标准

- 凭据加密存储
- 可按 key 检索
- 文件权限正确

---

### CAP-13: 配置层级搜索

#### 设计目标

实现 Global→Project→.flowforge 三级配置搜索。

#### 详细设计

```python
# flowforge/config/layered_search.py

import os
from pathlib import Path
from typing import Any, Dict, List, Optional
import yaml

class LayeredConfigSearch:
    """配置层级搜索：Global → Project → .flowforge"""

    def __init__(self, global_dir: str = "~/.flowforge", project_dir: str = "."):
        self.global_dir = Path(global_dir).expanduser()
        self.project_dir = Path(project_dir)

    def search(self, config_name: str) -> List[Dict[str, Any]]:
        """按优先级搜索配置文件（低优先级在前）"""
        results = []
        # Level 1: Global
        global_path = self.global_dir / config_name
        if global_path.exists():
            results.append({"level": "global", "path": str(global_path),
                            "data": self._load_yaml(global_path)})
        # Level 2: Project root
        project_path = self.project_dir / config_name
        if project_path.exists():
            results.append({"level": "project", "path": str(project_path),
                            "data": self._load_yaml(project_path)})
        # Level 3: .flowforge directory
        flowforge_path = self.project_dir / ".flowforge" / config_name
        if flowforge_path.exists():
            results.append({"level": "local", "path": str(flowforge_path),
                            "data": self._load_yaml(flowforge_path)})
        return results

    def merge(self, config_name: str) -> Dict[str, Any]:
        """合并所有层级的配置（高优先级覆盖低优先级）"""
        layers = self.search(config_name)
        merged = {}
        for layer in layers:
            merged.update(layer.get("data", {}))
        return merged

    @staticmethod
    def _load_yaml(path: Path) -> Dict[str, Any]:
        with open(path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
```

#### 验收标准

- 三级配置搜索正确
- 高优先级覆盖低优先级
- 不存在的层级跳过

---

## Phase 3 — 生态与体验完善

---

### ECO-01: Plugin Hook增强

#### 设计目标

增强 Plugin Hook 系统，支持 Immer Draft 模式的不可变状态更新。

#### OpenCode 借鉴

借鉴 OpenCode 的 Immer Draft 模式——Hook 回调接收 draft 对象，可以修改 draft，框架自动生成新状态。

#### 详细设计

```python
# flowforge/plugins/hook_enhanced.py

from typing import Any, Callable, Dict, List, Optional
from enum import Enum

class HookPhase(str, Enum):
    BEFORE = "before"
    AFTER = "after"
    ERROR = "error"

class PluginHook:
    """增强的 Plugin Hook 系统"""

    def __init__(self):
        self._hooks: Dict[str, List[Callable]] = {}

    def register(self, hook_name: str, callback: Callable, priority: int = 0) -> None:
        if hook_name not in self._hooks:
            self._hooks[hook_name] = []
        self._hooks[hook_name].append((priority, callback))
        self._hooks[hook_name].sort(key=lambda x: x[0])

    async def emit(self, hook_name: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """发射 Hook，回调可修改 context（draft 模式）"""
        callbacks = self._hooks.get(hook_name, [])
        for priority, callback in callbacks:
            try:
                result = await callback(context)
                if isinstance(result, dict):
                    context.update(result)
            except Exception as e:
                # Hook 错误不阻断主流程
                pass
        return context
```

#### 验收标准

- Hook 回调可修改上下文
- Hook 错误不阻断主流程
- 支持优先级排序

---

### ECO-02: Markdown Skill系统

#### 设计目标

实现基于 Markdown frontmatter 的 Skill 定义系统。

#### OpenCode 借鉴

借鉴 OpenCode 的 SKILL.md frontmatter 模式。

#### 详细设计

```python
# flowforge/skills/markdown_skill.py

import re
from typing import Any, Dict, Optional
from dataclasses import dataclass

@dataclass
class MarkdownSkill:
    name: str
    description: str
    triggers: List[str]
    instructions: str
    required_tools: List[str]
    version: str = "1.0"

class MarkdownSkillParser:
    """Markdown Skill 解析器"""

    @staticmethod
    def parse(content: str) -> Optional[MarkdownSkill]:
        """解析 SKILL.md：frontmatter + body"""
        # 提取 YAML frontmatter
        match = re.match(r'^---\s*\n(.*?)\n---\s*\n(.*)', content, re.DOTALL)
        if not match:
            return None
        import yaml
        frontmatter = yaml.safe_load(match.group(1))
        instructions = match.group(2).strip()
        return MarkdownSkill(
            name=frontmatter.get("name", ""),
            description=frontmatter.get("description", ""),
            triggers=frontmatter.get("triggers", []),
            instructions=instructions,
            required_tools=frontmatter.get("tools", []),
            version=frontmatter.get("version", "1.0"),
        )
```

#### 验收标准

- SKILL.md frontmatter 正确解析
- 触发词匹配正确
- 与 SkillRegistry 集成

---

### ECO-03: MCP Remote模式+OAuth

#### 设计目标

支持 MCP Remote 模式（HTTP/SSE 传输）+ OAuth 认证。

#### OpenCode 借鉴

借鉴 OpenCode 的 Local/Remote 双模式 MCP 支持。

#### 详细设计

```python
# flowforge/mcp/remote_client.py

from typing import Any, Dict, Optional
import httpx

class MCPRemoteClient:
    """MCP Remote 客户端：HTTP/SSE 传输 + OAuth"""

    def __init__(self, server_url: str, oauth_config: Optional[Dict] = None):
        self.server_url = server_url
        self.oauth_config = oauth_config
        self._access_token: Optional[str] = None
        self._client = httpx.AsyncClient(timeout=30.0)

    async def authenticate(self) -> None:
        """OAuth 认证"""
        if not self.oauth_config:
            return
        # OAuth 2.0 Client Credentials Flow
        response = await self._client.post(
            self.oauth_config["token_url"],
            data={
                "grant_type": "client_credentials",
                "client_id": self.oauth_config["client_id"],
                "client_secret": self.oauth_config["client_secret"],
            })
        self._access_token = response.json().get("access_token")

    async def list_tools(self) -> List[Dict]:
        headers = {}
        if self._access_token:
            headers["Authorization"] = f"Bearer {self._access_token}"
        response = await self._client.get(f"{self.server_url}/tools", headers=headers)
        return response.json().get("tools", [])

    async def call_tool(self, tool_name: str, arguments: dict) -> Dict:
        headers = {"Content-Type": "application/json"}
        if self._access_token:
            headers["Authorization"] = f"Bearer {self._access_token}"
        response = await self._client.post(
            f"{self.server_url}/tools/{tool_name}",
            json=arguments, headers=headers)
        return response.json()
```

#### 验收标准

- MCP Remote HTTP/SSE 传输正常
- OAuth 认证流程正确
- 与 MCPBroker 集成

---

### ECO-04: 文件快照+Undo

#### 设计目标

实现文件快照和 Undo 功能，支持 Session 级 diff 聚合。

#### OpenCode 借鉴

借鉴 OpenCode 的 Session 级 diff 聚合模式。

#### 详细设计

```python
# flowforge/tools/file_snapshot.py

import hashlib, time, json, os
from typing import Any, Dict, List, Optional
from dataclasses import dataclass, field

@dataclass
class FileSnapshot:
    path: str
    content_hash: str
    timestamp: float
    content: Optional[str] = None  # 可选存储完整内容

class FileSnapshotManager:
    """文件快照管理器：支持 Undo"""

    def __init__(self, snapshot_dir: str = "data/snapshots"):
        self.snapshot_dir = snapshot_dir
        self._snapshots: Dict[str, List[FileSnapshot]] = {}
        os.makedirs(snapshot_dir, exist_ok=True)

    def capture(self, path: str, content: str) -> FileSnapshot:
        """捕获文件快照"""
        content_hash = hashlib.sha256(content.encode()).hexdigest()[:16]
        snapshot = FileSnapshot(path=path, content_hash=content_hash,
                                timestamp=time.time())
        self._snapshots.setdefault(path, []).append(snapshot)
        # 持久化快照
        snapshot_path = os.path.join(self.snapshot_dir, f"{content_hash}.json")
        with open(snapshot_path, "w") as f:
            json.dump({"path": path, "content": content, "timestamp": snapshot.timestamp}, f)
        return snapshot

    def undo(self, path: str) -> Optional[str]:
        """撤销到上一个快照"""
        snapshots = self._snapshots.get(path, [])
        if len(snapshots) < 2:
            return None
        # 移除当前快照
        snapshots.pop()
        # 恢复上一个快照
        prev = snapshots[-1]
        snapshot_path = os.path.join(self.snapshot_dir, f"{prev.content_hash}.json")
        if os.path.exists(snapshot_path):
            with open(snapshot_path, "r") as f:
                return json.load(f).get("content")
        return None
```

#### 验收标准

- 文件修改前自动捕获快照
- Undo 恢复到上一个快照
- 快照持久化到磁盘

---

### ECO-05: DevForge通用逻辑下沉

#### 设计目标

将 DevForge 中的通用逻辑下沉到 FlowForge，消除重复代码。

#### 详细设计

```
下沉策略：
1. 识别 DevForge 中与 FlowForge 重复的代码（~1877行）
2. 将通用逻辑提取为 FlowForge 的公共模块
3. DevForge 通过 import 使用 FlowForge 的公共模块
4. 分批删除 DevForge 中的重复代码

下沉模块列表：
- DevForge 的 LLM 调用逻辑 → FlowForge LLMRouter
- DevForge 的重试逻辑 → FlowForge RetryPolicy
- DevForge 的权限检查 → FlowForge PermissionV2
- DevForge 的会话管理 → FlowForge SessionManager
- DevForge 的工具注册 → FlowForge ToolRegistry
```

#### 验收标准

- DevForge 重复代码减少 ≥80%
- DevForge 功能不受影响
- 全量回归测试通过

---

### ECO-06: HTTP录制测试

#### 设计目标

实现 HTTP 请求/响应的录制和回放测试（cassette 测试）。

#### 详细设计

```python
# flowforge/testing/http_cassette.py

import json, os, time, hashlib
from typing import Any, Dict, List, Optional

class HTTPCassette:
    """HTTP 录制/回放测试"""

    def __init__(self, cassette_dir: str = "tests/cassettes"):
        self.cassette_dir = cassette_dir
        os.makedirs(cassette_dir, exist_ok=True)

    def record(self, name: str, request: Dict, response: Dict) -> None:
        """录制 HTTP 请求/响应"""
        cassette_path = os.path.join(self.cassette_dir, f"{name}.json")
        entry = {
            "request": request,
            "response": response,
            "timestamp": time.time(),
            "hash": hashlib.sha256(json.dumps(request, sort_keys=True).encode()).hexdigest()[:16],
        }
        cassette = self._load_cassette(cassette_path)
        cassette.append(entry)
        with open(cassette_path, "w") as f:
            json.dump(cassette, f, ensure_ascii=False, indent=2)

    def replay(self, name: str, request: Dict) -> Optional[Dict]:
        """回放 HTTP 响应"""
        cassette_path = os.path.join(self.cassette_dir, f"{name}.json")
        cassette = self._load_cassette(cassette_path)
        request_hash = hashlib.sha256(json.dumps(request, sort_keys=True).encode()).hexdigest()[:16]
        for entry in cassette:
            if entry.get("hash") == request_hash:
                return entry.get("response")
        return None

    @staticmethod
    def _load_cassette(path: str) -> List[Dict]:
        if not os.path.exists(path):
            return []
        with open(path, "r") as f:
            return json.load(f)
```

#### 验收标准

- HTTP 请求/响应可录制
- 回放匹配正确
- Cassette 文件可版本管理

---

### ECO-07: VS Code扩展

#### 设计目标

开发 VS Code 扩展，提供 FlowForge 任务管理和监控能力。

#### 详细设计

```
VS Code 扩展功能：
1. 任务创建和提交
2. 任务状态实时监控（WebSocket）
3. Helm 交互面板
4. Skill 管理面板
5. Agent 配置编辑器（YAML 语法高亮 + 验证）

技术栈：
- TypeScript + VS Code Extension API
- WebSocket 客户端连接 FlowForge API
- YAML 语言服务集成
```

#### 验收标准

- VS Code 扩展可安装和激活
- 任务创建和监控正常
- WebSocket 实时更新

---

### ECO-08: 自动标题/摘要生成

#### 设计目标

自动为任务结果生成标题和摘要。

#### OpenCode 借鉴

借鉴 OpenCode 的 title/summary agent 模式。

#### 详细设计

```python
# flowforge/harness/title_summary.py

from typing import Any, Dict, Optional

class TitleSummaryGenerator:
    """自动标题/摘要生成器"""

    def __init__(self, llm_client=None):
        self._llm_client = llm_client

    async def generate(self, result: Dict[str, Any], ctx: Any) -> Dict[str, str]:
        """生成标题和摘要"""
        content = result.get("content", "")
        if not content or len(content) < 50:
            return {"title": "Empty result", "summary": ""}

        if self._llm_client is None:
            # 回退：使用内容前 50 字符作为标题
            return {"title": content[:50] + "...", "summary": content[:200]}

        prompt = (
            "请为以下内容生成一个简短标题（≤20字）和摘要（≤100字）：\n\n"
            f"{content[:3000]}\n\n"
            '输出JSON格式：{"title": "...", "summary": "..."}'
        )
        from flowforge.core.base_tool import ToolInput
        output = await self._llm_client.execute(ToolInput(params={
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 200, "temperature": 0.3}))
        try:
            import json
            parsed = json.loads(output.result.get("content", "{}"))
            return {"title": parsed.get("title", ""), "summary": parsed.get("summary", "")}
        except (json.JSONDecodeError, KeyError):
            return {"title": content[:50] + "...", "summary": content[:200]}
```

与 HarnessOrchestrator 的融合：

```python
class HarnessOrchestrator:
    async def post_execute(self, result: dict, ctx) -> dict:
        # ... 现有逻辑 ...
        # ★ 新增：自动生成标题/摘要
        if self.title_summary_generator:
            ts = await self.title_summary_generator.generate(result, ctx)
            result["title"] = ts["title"]
            result["summary"] = ts["summary"]
        return result
```

#### 验收标准

- 自动生成标题和摘要
- LLM 不可用时回退到截断方式
- 与 HarnessOrchestrator 集成

---

## 附录：融合影响矩阵

| 现有模块 | 增强项 | 融合方式 | 风险等级 |
|---------|--------|---------|---------|
| `HarnessOrchestrator.pre_execute()` | CAP-01 Source<A>, FWK-05 Persona | 内部使用代数组装，外部接口不变 | 低 |
| `HarnessOrchestrator.post_execute()` | INF-05 Compaction, ECO-08 TitleSummary | 新增可选步骤 | 低 |
| `ContextEngine.inject()` | CAP-01 SystemContext, FWK-05 Persona | 内部重构，外部接口不变 | 中 |
| `ContextEngine._build_dynamic_context()` | CAP-01 ComputedSource | 保留为 Source 计算函数 | 低 |
| `SessionManager.check_and_compact()` | INF-05 DualThreshold, INF-02 EventStore | 委托给新组件 | 中 |
| `SessionManager._summarize_older_messages()` | INF-05 LLM-based 摘要 | 替换为 LLM 调用 | 中 |
| `FeedbackLoop._classify_with_scores()` | FWK-08 ScoringRubric | 优先使用 Rubric | 低 |
| `FeedbackLoop._call_llm()` | INF-01 LLMRouter | 适配新 Protocol | 中 |
| `LoopExecutor._execute_iterations()` | FWK-06 TurnTransition, CAP-09 ContextEpoch, CAP-10 FiberSet, MAX_STEPS | 内部重构 | 高 |
| `LoopExecutor._execute_parallel_workers()` | CAP-10 FiberSet | 替代 asyncio.gather | 中 |
| `LoopExecutor._calc_backoff()` | INF-06 RetryPolicy | 新增策略 | 低 |
| `DebtTracker` | INF-02 SQLite 持久化 | 新增 db_path 参数 | 低 |
| `RuleEvolution` | INF-02 SQLite 持久化 | 新增 db_path 参数 | 低 |
| `MultiJudgeVerifier._call_judge()` | CAP-10 FiberSet, INF-01 LLMRouter | 并行优化 | 中 |
| `PermissionPipeline` | CAP-02 PermissionV2 | V2 为增强版 | 低 |
| `ToolRegistry` | CAP-03 StaleTool, CAP-06 ToolFilter | 新增检查步骤 | 低 |
| `WorkflowExecutor._execute_core()` | FWK-01~04 Compiler | 编译产物注入 sop_steps | 低 |

---

> **本文档与 landing_plan.md 互补。每个设计项均提供了代码级详细设计、现有代码融合方案和向后兼容策略。重点融合项（FWK-06、INF-02、INF-05、CAP-01、CAP-09、CAP-10）已深入到方法级别的设计。**
---

# [审核修订 v2.1] 六方联合审核修订增补

> 审核日期：2026-06-15 | 修订版本：v2.1

## 修订1：FWK-01 Workflow YAML Compiler [审核修订 v2.1]

### 修订1.1：编译器拆分为三阶段
原设计WorkflowCompiler同时承担编译、验证、转换。修订为：
- **Parser**：YAML → RawWorkflow AST
- **Validator**：校验AST完整性、类型安全、循环依赖
- **CodeGen**：AST → CompiledWorkflow → sop_steps

### 修订1.2：MVP范围
先实现 SEQUENCE + CONDITIONAL + GATE 三种StepType，其余迭代扩展。

### 修订1.3：输入映射表达式
引入Jinja2模板引擎替代简单Dict映射，支持 `${{ outputs.requirements.requirements_doc | truncate(1000) }}` 等转换。

## 修订2：FWK-02 Conditional Router [审核修订 v2.1]

### 修订2.1：安全表达式引擎
替换字符串拼接解析为 asteval 安全表达式库，防止表达式注入。

### 修订2.2：strict_mode
增加 strict_mode 配置，None结果时抛出明确异常或强制使用default。

## 修订3：FWK-03 Fallback Chain [审核修订 v2.1]

支持 per-step 的 success_condition 配置，允许声明式定义成功条件。

## 修订4：FWK-05 Persona Auto-Inject [审核修订 v2.1]

- Persona指令使用结构化格式 ≤512 token
- 成本审计：persona token占比 <15%
- 中文格式规范注入

## 修订5：FWK-06 Reflexion Loop [审核修订 v2.1]

### 修订5.1：TurnTransitionEngine完整状态机
状态：IDLE → EXECUTING → EVALUATING → REFLECTING → COMPACTING → AGENT_SWITCHING → COMPLETED/FAILED

### 修订5.2：LoopContext封装
decide() 只接收 verdict + LoopContext（封装feedback_gate, context_utilization, compaction_threshold等7个参数）

### 修订5.3：max_steps优先级
max_steps优先级高于max_retries（OpenCode安全护栏）

## 修订6：FWK-07 PipelineCompiler [审核修订 v2.1]

PipelineCompiler独立实现，不继承WorkflowCompiler，避免违反最小知识原则。

## 修订7：INF-02 Session持久化 [审核修订 v2.1]

### 修订7.1：EventStore WAL模式
改为WAL模式 + 批量提交（每100条或每秒）

### 修订7.2：RunCoordinator持久化
_runs 状态也需要持久化到EventStore

### 修订7.3：SessionInputManager
Phase 2可选组件，实现admit→promote→execute三阶段

### 修订7.4：LoopExecutor构造函数
增加 optional_components: Dict 注入入口，避免参数爆炸

## 修订8：INF-03 DI容器 [审核修订 v2.1]

明确SCOPED使用场景或先移除，只保留SINGLETON + TRANSIENT。

## 修订9：INF-05 Compaction [审核修订 v2.1]

### 修订9.1：最大次数限制
Compaction最大次数限制：3次/Session

### 修订9.2：强制截断
抽取式摘要后强制截断到安全阈值以下

### 修订9.3：降级策略
Compaction失败后丢弃最旧消息

### 修订9.4：中文摘要模型
显式声明摘要模型为doubao-seed2，中文摘要按语义段落切分

## 修订10：INF-08 十层安全防御 [审核修订 v2.1]

### 修订10.1：优先实现L5/L6
L5 InputGuardrail和L6 OutputGuardrail优先实现（与现有Guardrails框架对接）

### 修订10.2：L9沙箱
L9 SandboxExecutor放到DevForge Plugin实现，FlowForge提供ToolIsolation抽象

### 修订10.3：每层必须包含
启用/禁用配置、输入/输出契约、默认策略（fail-open/fail-closed）、指标埋点

## 修订11：CAP-01 Source<A>代数 [审核修订 v2.1]

降级为P3。Phase 2先用简单 Dict[str, ContextFragment]（key/content/priority），Phase 3再引入代数操作。

## 修订12：CAP-02 Permission V2 [审核修订 v2.1]

- TaskContext增加 request_user_approval(tool, params, timeout) 抽象方法
- ASK超时默认DENY（fail-closed）
- 每次ask→allow/deny决策记录到审计日志
- FlowForge提供默认 WebSocketApprovalProvider

## 修订13：CAP-10 FiberSet [审核修订 v2.1]

next_completed() 超时改为可配置，默认1.0s（原0.1s太短）。

## 修订14：ECO-07 VS Code扩展 [审核修订 v2.1]

优先级从P2升级到P1（DevForge核心竞争力）。

## 新增1：FWK-10 领域代码迁移方案 [审核修订 v2.1]

Phase 0新增：将FlowForge中23处特定领域代码（~1100行）迁移到对应 *Forge 项目。

## 新增2：INF-11 Repository层统一重构 [审核修订 v2.1]

Phase 1新增：10+存储模块从直接SQL操作重构为Repository模式。

## 新增3：INF-12 配置外置系统性整改 [审核修订 v2.1]

Phase 1新增：数据库路径等硬编码配置全部外置。

## 新增4：FWK-PROMPT PromptManager统一设计 [审核修订 v2.1]

Phase 0新增：统一YAML Schema、热加载、版本管理、A/B测试、缓存策略。

## 新增5：OpenCode模式优先级矩阵 [审核修订 v2.1]

按 阻塞性 × 复用性 两维评估65+模式的取舍：

| 优先级 | 模式 | 阻塞性 | 复用性 |
|--------|------|--------|--------|
| P0必须 | Session持久化 | 高 | 高 |
| P0必须 | LLM路由层分离 | 高 | 高 |
| P0必须 | Compaction | 高 | 高 |
| P0必须 | 指数退避重试 | 高 | 高 |
| P1推荐 | System Context代数 | 中 | 高 |
| P1推荐 | Permission V2 | 中 | 高 |
| P2可选 | Session共享 | 低 | 中 |
| P2可选 | Session Todo追踪 | 低 | 低 |

## 新增6：实现追溯表（21个GAP） [审核修订 v2.1]

| 编号 | 设计 | 代码现状 | 风险 |
|------|------|---------|------|
| GAP-01 | TurnTransition | 仅if-else | 高 |
| GAP-02 | DualThresholdCompactor | content[:2000]截断 | 中 |
| GAP-03 | EventStore | 不存在 | 高 |
| GAP-04 | WorkflowCompiler | 整个目录不存在 | 高 |
| GAP-05 | ConditionalRouter | 不存在 | 中 |
| GAP-06 | PersonaInjector | PersonaLock无自动注入 | 中 |
| GAP-07 | LLMRouter | 仅单Provider | 中 |
| GAP-08 | DIContainer升级 | Service Locator | 中 |
| GAP-09 | FiberSet | asyncio.gather | 中 |
| GAP-10 | PermissionV2 | 简单顺序链 | 中 |
| GAP-11 | DurableEventStream | 仅内存总线 | 中 |
| GAP-12 | CredentialStore | SecretStore路径问题 | 中 |
| GAP-13 | LayeredSearch | 不存在 | 低 |
| GAP-C01 | flowforge.py反向import | 严重违反P9 | 高 |
| GAP-C02 | LoopExecutor 11个构造参数 | 设计只展示4个 | 中 |
| GAP-C03 | BaseNovelAgent | 未提删除计划 | 低 |
| GAP-C04 | LoopPhase 7状态 vs TurnKind 6状态 | 两套并行 | 高 |
| GAP-C05 | DebtTracker/RuleEvolution | 无SQLite fallback | 中 |
| GAP-C06 | declarative.py | FWK-09未引用 | 中 |
| GAP-C07 | skills/loader.py | ECO-02与现有loader重复 | 低 |
| GAP-C08 | MemoryManager | add()签名不一致 | 中 |
