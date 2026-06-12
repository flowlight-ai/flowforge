# FlowForge Loop Engineering 架构设计

> **版本**：v1.0
> **日期**：2026-06-12
> **对应架构文档**：FlowForge v6.0 架构设计 (`arch.md`)
> **定位**：在 Harness 驾驭层内植入 Loop 引擎，让 Agent 从"听令行事"进化为"自主干活"。

---

## 一、背景与动机

### 1.1 范式转移

2025-2026 年，AI Agent 领域正在经历从 Prompt Engineering 到 Loop Engineering 的范式转移：

- **旧范式 (Prompt)**：人→写Prompt→AI→出结果→人改Prompt→再试（人当循环引擎）
- **新范式 (Loop)**：人→设计Loop→AI自动跑：规划→执行→校验→复盘→重试→交付（AI当循环引擎）

Claude Code 之父 Boris 和 OpenAI 的 Peter 均公开表示："别给 Agent 写 Prompt，设计 Loop 让 Loop 提示 Agent。"Claude Code 2026 版已开放 Hook API 和自定义 Verifier，Trae CN 的 Solo 模式通过动态 Plan 实现了类似的 Loop 能力。

### 1.2 当前痛点

尽管 FlowForge 已拥有 9 大模式、Harness 四根护栏，但用户仍需频繁介入：

| 痛点 | 说明 |
|------|------|
| 写提示词 | 每个复杂任务都要精心构造 Prompt 或配置 Workflow 步骤 |
| 手动纠错 | Agent 失败后需人工分析原因、修改配置、重新执行 |
| 缺乏自主迭代 | Agent 执行完一轮后，即使质量不合格，也不会主动自我修正（除 Reflexion 模式外） |

### 1.3 Loop Engineering 的本质

**Loop Engineering = 设计"行动→观察→判断→迭代"的闭环系统，让 Agent 自主多轮执行、自我纠错、直到交付结果。**

在 FlowForge 中，**Loop 不是替代 9 大模式，而是为它们装上"自主导航系统"**。无论是 ReAct 的单步循环，还是 Workflow 的多步编排，都可以嵌入 Loop 引擎，自动完成"执行-检查-修正"的闭环。

### 1.4 Loop vs Chain

| 维度 | Chain（线性链） | Loop（循环） |
|------|----------------|-------------|
| 执行方式 | A→B→C→D，单向 | A→B→错→重试B→C→校验→复盘→D |
| 错误处理 | 从头来 | 动态回退、可迭代、自我修复 |
| 典型实现 | LangChain 基础链 | LangGraph、Claude Code、FlowForge |

---

## 二、核心概念定义

### 2.1 Loop 在六层架构中的位置

**Loop 是 Harness 驾驭层的子模块，不是独立层。** Loop Engine 与四根护栏并列，位于第 4 层内部。

```
┌─────────────────────────────────────────────────────────────────────┐
│  4. Harness 驾驭层 (Harness Layer) ★ v6.0 核心                      │
│                                                                      │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐  │
│  │ 上下文工程   │ │ 架构约束    │ │ 反馈循环    │ │ 熵管理      │  │
│  │ ContextEngine│ │ ArchConstr. │ │ FeedbackLoop│ │ EntropyMgr  │  │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘  │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Loop Engine (v6.1 新增)                                      │   │
│  │  Planner → Worker → Verifier → Reflector → Memory            │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Loop 与现有组件的关系

```
调用关系：

  LoopExecutor.run()                    ← Loop 入口
    │
    ├─ HarnessOrchestrator.pre_execute()  ← 每次迭代前注入上下文
    │    └─ ContextEngine.inject()
    │    └─ PermissionPipeline.check()
    │
    ├─ HybridExecutor.execute()           ← 复用现有执行引擎
    │    └─ ModeRegistry.select()
    │    └─ Agent/Tool/Workflow 执行
    │
    ├─ HarnessOrchestrator.post_execute() ← 每次迭代后架构约束校验
    │    └─ ArchConstraintEngine.validate()
    │    └─ FeedbackLoop.evaluate()       ← Harness 级别的四维评分
    │
    ├─ LoopVerifier.verify()              ← Loop 级别的业务质量校验
    │    （与 Harness FeedbackLoop 互补而非重复）
    │
    ├─ [仅失败时] LoopReflector.reflect() ← 生成改进建议
    │    └─ EntropyManager.track_debt()   ← 将失败转化为技术债
    │    └─ RuleEvolution.evolve()        ← 规则进化
    │
    └─ CheckpointManager.save()           ← 每次迭代保存检查点
```

**关键原则**：
- **LoopExecutor 包装 HybridExecutor**，不替代。每次迭代通过 HybridExecutor 执行任务。
- **Harness Hook 每次迭代都触发**。`pre_execute` 注入上下文，`post_execute` 进行架构约束校验。
- **Loop Verifier 与 Harness FeedbackLoop 互补**。FeedbackLoop 负责架构级校验（格式、安全、合规），Loop Verifier 负责业务级校验（内容质量、完整性、准确性）。
- **独立 LoopState**，不修改 TaskContext。LoopState 通过 CheckpointManager 持久化。

---

## 三、LoopState 数据模型

Loop 执行过程中使用独立的状态模型，不污染 TaskContext。

```python
from pydantic import BaseModel, Field
from enum import Enum
from datetime import datetime

class LoopPhase(str, Enum):
    PLANNING = "planning"
    EXECUTING = "executing"
    VERIFYING = "verifying"
    REFLECTING = "reflecting"
    COMPLETED = "completed"
    FAILED = "failed"

class LoopState(BaseModel):
    """Loop 执行状态 — 独立于 TaskContext，通过 CheckpointManager 持久化。"""
    loop_id: str
    task_id: str
    template_name: str
    phase: LoopPhase = LoopPhase.PLANNING
    attempt: int = 0
    max_retries: int = 3
    current_plan: list[dict] | None = None
    past_errors: list[str] = Field(default_factory=list)
    verification_history: list[dict] = Field(default_factory=list)
    reflection_history: list[dict] = Field(default_factory=list)
    started_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class LoopResult(BaseModel):
    """Loop 执行结果。"""
    success: bool
    output: dict | None = None
    error: str | None = None
    total_attempts: int = 0
    state: LoopState | None = None
```

---

## 四、Loop 的五层模块

### 4.1 模块总览

```
┌──────────────┐
│  Planner     │ ← 拆解任务、分配工具、制定步骤
└──────┬───────┘
       │ 计划 (Plan)
┌──────▼───────┐
│  Worker      │ ← 调用 HybridExecutor 执行（复用现有引擎）
└──────┬───────┘
       │ 结果 (Output)
┌──────▼───────┐
│  Verifier    │ ← 业务级质量校验（与 Harness FeedbackLoop 互补）
└──────┬───────┘
       │ 通过/失败
┌──────▼───────┐
│  Reflector   │ ← 分析失败原因，生成改进建议（失败时触发）
└──────┬───────┘
       │ 改进计划 + 经验写入 Memory
┌──────▼───────┐
│  Memory      │ ← 映射到现有 5 种记忆 + CheckpointManager
└──────────────┘
```

### 4.2 Planner（规划器）

- **职责**：接收用户高级别目标，自动拆解为可执行的子任务，并分配工具/Agent/模式。
- **实现方式**：调用 `plan_execute` 模式 + `self_discover` 元认知，或直接让 LLM 生成步骤列表。
- **与 Harness 集成**：规划结果受 `architecture_constraints` 约束，且每个步骤自动注入 `permission_pipeline`。

### 4.3 Worker（执行器）

- **职责**：按照计划执行具体操作。可以是单个 Agent、一个 Workflow、一个 Tool 调用，甚至是另一个嵌套 Loop。
- **实现方式**：**复用现有 `HybridExecutor`**，传递子任务并动态选择模式。Worker 不直接执行，而是委托给 HybridExecutor。
- **与 Harness 集成**：每次执行都经过 `PermissionPipeline`（权限检查）和 `defense_layer`（超时/重复检测）。

### 4.4 Verifier（校验器）

- **职责**：根据预定义规则（或模型自检）判断输出是否合格。
- **与 Harness FeedbackLoop 的分工**：

| 校验层级 | 负责组件 | 校验内容 |
|---------|---------|---------|
| 架构级 | Harness FeedbackLoop | 格式合规、安全检查、权限边界、输出 Schema |
| 业务级 | Loop Verifier | 内容质量、完整性、准确性、关键数据正确性 |

- **实现方式**：
  - 规则校验：调用 `FeedbackLoop.evaluator_agent`（四维评分）或 `VerificationHooks`
  - 自动化测试：代码生成任务自动运行测试套件
  - Schema 校验：使用 `input_schema` / `output_schema` 验证 JSON 结构
- **评分标准**：由 Loop 模板的 `pass_threshold` 定义（默认 0.8）

### 4.5 Reflector（复盘器）

- **职责**：当 Verifier 判定失败时，分析失败原因，生成改进建议，反馈给 Planner 调整计划。
- **实现方式**：复用 `reflexion` 模式中的 Reflector Agent。
- **与 Harness 集成**：
  - 反思结果通过 `EntropyManager.track_debt()` 记录为技术债
  - 通过 `RuleEvolution.evolve()` 将失败转化为规则
  - 实现"永不再犯同样的错"

### 4.6 Memory（记忆器）

- **职责**：存储任务上下文、成功/失败经验、项目规则、历史决策。
- **与现有 MemoryManager 的映射关系**：

| Loop Memory 用途 | 映射到 FlowForge 记忆类型 | 说明 |
|------------------|-------------------------|------|
| 当前任务上下文 | WorkingMemory | 当前迭代的输入/输出/错误 |
| 短期会话状态 | ShortTermMemory | 会话内的对话历史 |
| 失败教训（跨任务复用） | LongTermMemory | 持久化的失败模式和修复策略 |
| 经验性知识（规则进化） | SemanticMemory | 通过 RuleEvolution 进化的规则 |
| 任务执行轨迹 | EpisodicMemory | 完整的"规划-执行-校验-复盘"轨迹 |

- **检查点**：每次迭代通过 `CheckpointManager` 保存 LoopState，支持中断后恢复。
- **审计**：Memory 存储受 `audit_trail` 审计，敏感信息自动脱敏。

---

## 五、LoopExecutor 核心逻辑

### 5.1 LoopExecutor 类

```python
from flowforge.core.task_context import TaskContext
from flowforge.executor.hybrid_executor import HybridExecutor
from flowforge.harness.orchestrator import HarnessOrchestrator
from flowforge.harness.entropy_manager import EntropyManager
from flowforge.harness.rule_evolution import RuleEvolution
from flowforge.memory.checkpoint_manager import CheckpointManager

class LoopExecutor:
    """Loop 执行器 — 包装 HybridExecutor，添加规划-校验-复盘闭环。

    LoopExecutor 是 Harness 驾驭层的子模块，每次迭代：
    1. 触发 Harness pre_execute（注入上下文）
    2. 调用 HybridExecutor 执行（复用现有引擎）
    3. 触发 Harness post_execute（架构约束校验）
    4. 执行 Loop Verifier（业务质量校验）
    5. 仅在失败时触发 Loop Reflector（复盘+规则进化）
    6. 保存检查点
    """

    def __init__(
        self,
        hybrid_executor: HybridExecutor,
        harness: HarnessOrchestrator,
        planner,          # LoopPlanner
        verifier,         # LoopVerifier
        reflector,        # LoopReflector
        checkpoint_mgr: CheckpointManager,
        entropy_mgr: EntropyManager,
        rule_evolution: RuleEvolution,
    ):
        self.hybrid_executor = hybrid_executor
        self.harness = harness
        self.planner = planner
        self.verifier = verifier
        self.reflector = reflector
        self.checkpoint_mgr = checkpoint_mgr
        self.entropy_mgr = entropy_mgr
        self.rule_evolution = rule_evolution

    async def run(self, task: TaskContext, loop_config: dict) -> LoopResult:
        """执行 Loop：规划→执行→校验→复盘→重试。"""
        max_retries = loop_config.get("max_retries", 3)
        state = LoopState(
            loop_id=loop_config["name"],
            task_id=task.task_id,
            template_name=loop_config["name"],
            max_retries=max_retries,
        )

        # 1. 规划
        state.phase = LoopPhase.PLANNING
        plan = await self.planner.plan(task, loop_config.get("planner", {}))
        state.current_plan = plan

        for attempt in range(max_retries):
            state.attempt = attempt + 1
            state.updated_at = datetime.utcnow()

            # 2. Harness pre_execute（注入上下文 + 权限检查）
            task = await self.harness.pre_execute(task)

            # 3. 执行（委托给 HybridExecutor）
            state.phase = LoopPhase.EXECUTING
            result = await self.hybrid_executor.execute(task)

            # 4. Harness post_execute（架构约束校验 + FeedbackLoop 评分）
            result = await self.harness.post_execute(result, task)

            # 5. Loop Verifier（业务级质量校验）
            state.phase = LoopPhase.VERIFYING
            verdict = await self.verifier.verify(result, task, loop_config.get("verifier", {}))
            state.verification_history.append(verdict.model_dump())

            if verdict.passed:
                # 成功：存储经验 + 返回
                state.phase = LoopPhase.COMPLETED
                await self.checkpoint_mgr.save(state.loop_id, state.model_dump())
                return LoopResult(success=True, output=result, total_attempts=attempt + 1, state=state)

            # 6. 失败：复盘
            state.phase = LoopPhase.REFLECTING
            reflection = await self.reflector.reflect(verdict.errors, task, state)
            state.reflection_history.append(reflection.model_dump())
            state.past_errors.extend(verdict.errors)

            # 7. Harness 将失败转化为规则
            await self.entropy_mgr.track_debt(
                source=f"loop:{state.loop_id}",
                description=f"Loop attempt {attempt + 1} failed: {verdict.errors}",
                severity="medium",
                context=task,
            )
            await self.rule_evolution.evolve(
                trigger=f"loop_failure:{state.loop_id}",
                failures=verdict.errors,
                reflection=reflection,
                context=task,
            )

            # 8. 保存检查点
            await self.checkpoint_mgr.save(state.loop_id, state.model_dump())

            # 9. 更新计划（注入教训）
            plan = await self.planner.replan(plan, reflection, state.past_errors)
            state.current_plan = plan

        # 耗尽重试次数
        state.phase = LoopPhase.FAILED
        await self.checkpoint_mgr.save(state.loop_id, state.model_dump())
        return LoopResult(success=False, error=f"Max retries ({max_retries}) exceeded", total_attempts=max_retries, state=state)
```

### 5.2 Loop 与 9 大模式的关系

Loop 不是新模式，而是**模式的"上层管理者"**。它决定"当前这个步骤应该用什么模式"，并根据校验结果动态切换。

| 传统模式 | 在 Loop 中的角色 |
|---------|-----------------|
| `workflow` | Worker 执行复杂多步任务 |
| `reflexion` | Reflector 复盘 + 重试 |
| `react` | Worker 执行动态探索任务 |
| `plan_execute` | Planner 生成计划 |
| `agent_judge` | Verifier 独立评判 |
| `rewoo` | Worker 批量工具调用 |

---

## 六、Loop 事件协议

Loop 的每次迭代发出事件，供 Helm/Solo UI 实时展示，接入现有 WebSocket 通道。

### 6.1 事件定义

| 事件名 | 触发时机 | 数据 |
|--------|---------|------|
| `loop.started` | Loop 开始执行 | `{loop_id, task_id, template_name, max_retries}` |
| `loop.iteration.start` | 每次迭代开始 | `{loop_id, attempt, phase: "executing"}` |
| `loop.verify.passed` | Verifier 校验通过 | `{loop_id, attempt, score}` |
| `loop.verify.failed` | Verifier 校验失败 | `{loop_id, attempt, errors, score}` |
| `loop.reflect.complete` | Reflector 复盘完成 | `{loop_id, attempt, suggestions}` |
| `loop.completed` | Loop 成功完成 | `{loop_id, total_attempts, final_score}` |
| `loop.failed` | Loop 耗尽重试 | `{loop_id, total_attempts, last_errors}` |

### 6.2 事件格式

```json
{
  "type": "loop.verify.failed",
  "timestamp": "2026-06-12T10:30:45Z",
  "data": {
    "loop_id": "deep-article-loop-001",
    "task_id": "task-abc123",
    "attempt": 2,
    "errors": ["内容缺少实际案例", "SEO关键词密度不足"],
    "score": 0.72
  }
}
```

---

## 七、Loop 模板规范

### 7.1 YAML Schema

Loop 模板存放在 `config/loops/` 目录，是 Workflow YAML 的上层编排。Worker 通过 `workflow` 字段引用 `config/workflows/` 中已有的 Workflow 定义。

```yaml
# config/loops/deep_article_loop.yaml
name: deep-article-loop
description: "深度文章创作闭环：自动规划→写作→审计→复盘"
version: 1.0
max_retries: 3
timeout_per_iteration: 300     # 单次迭代超时（秒）
total_timeout: 1800            # Loop 总超时（秒）
backoff_strategy: "exponential" # 退避策略：fixed | linear | exponential
backoff_base: 2                # 退避基数（秒）

planner:
  mode: self_discover          # plan_execute | self_discover | llm_direct
  agent: meta-planner
  prompt_template: "plan_article"

worker:
  mode: workflow               # workflow | agent | tool | loop（嵌套）
  workflow: defense_article    # 引用 config/workflows/ 中的 Workflow

verifier:
  mode: agent_judge            # agent_judge | rule_based | schema | test_suite
  agent: content-audit
  pass_threshold: 0.85
  rules:                       # 规则校验（可选）
    - "文章字数 >= 2000"
    - "包含至少3个实际案例"
    - "SEO关键词密度 1%-3%"

reflector:
  mode: reflexion              # reflexion | trace_analysis
  agent: reflexion-reflector
  max_reflections: 2           # 单次复盘最大反思轮数

memory:
  store_failures: true
  failure_key: "article-failures"
  memory_mapping:              # 映射到 FlowForge 记忆类型
    context: working           # 当前上下文 → WorkingMemory
    failures: long_term        # 失败教训 → LongTermMemory
    rules: semantic            # 进化规则 → SemanticMemory
    trajectory: episodic       # 执行轨迹 → EpisodicMemory
```

### 7.2 LoopRegistry

```python
# flowforge/loop/registry.py
from pathlib import Path
import yaml
from pydantic import BaseModel

class LoopTemplateConfig(BaseModel):
    """Loop 模板配置 — 从 YAML 文件加载。"""
    name: str
    description: str
    version: float = 1.0
    max_retries: int = 3
    timeout_per_iteration: int = 300
    total_timeout: int = 1800
    backoff_strategy: str = "exponential"
    backoff_base: int = 2
    planner: dict
    worker: dict
    verifier: dict
    reflector: dict
    memory: dict = {}

class LoopRegistry:
    """Loop 模板注册中心。"""

    def __init__(self, config_dir: str = "config/loops/"):
        self._templates: dict[str, LoopTemplateConfig] = {}
        self.load_from_dir(config_dir)

    def load_from_dir(self, dir_path: str) -> None:
        for yaml_file in Path(dir_path).glob("*.yaml"):
            config = yaml.safe_load(yaml_file.read_text(encoding="utf-8"))
            template = LoopTemplateConfig(**config)
            self._templates[template.name] = template

    def get(self, name: str) -> LoopTemplateConfig | None:
        return self._templates.get(name)

    def list_templates(self) -> list[str]:
        return list(self._templates.keys())
```

---

## 八、API 设计

### 8.1 REST API

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/v1/loops` | 创建 Loop 实例并启动执行 |
| `GET` | `/api/v1/loops/{loop_id}` | 查询 Loop 执行状态 |
| `POST` | `/api/v1/loops/{loop_id}/stop` | 手动停止 Loop |
| `GET` | `/api/v1/loops/{loop_id}/history` | 获取 Loop 迭代历史 |
| `GET` | `/api/v1/loop-templates` | 列出可用 Loop 模板 |
| `GET` | `/api/v1/loop-templates/{name}` | 获取模板详情 |

### 8.2 创建 Loop 请求

```json
POST /api/v1/loops
{
  "task_id": "task-abc123",
  "template_name": "deep-article-loop",
  "overrides": {
    "max_retries": 5,
    "verifier": {
      "pass_threshold": 0.9
    }
  }
}
```

### 8.3 Loop 状态响应

```json
{
  "loop_id": "deep-article-loop-001",
  "task_id": "task-abc123",
  "template_name": "deep-article-loop",
  "phase": "reflecting",
  "attempt": 2,
  "max_retries": 3,
  "started_at": "2026-06-12T10:25:00Z",
  "updated_at": "2026-06-12T10:30:45Z",
  "verification_history": [
    {"attempt": 1, "passed": false, "score": 0.72, "errors": ["缺少案例"]},
    {"attempt": 2, "passed": false, "score": 0.78, "errors": ["SEO密度不足"]}
  ]
}
```

---

## 九、数据库 Schema

```sql
-- Loop 实例表
CREATE TABLE loops (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id),
    template_name TEXT NOT NULL,
    phase TEXT NOT NULL DEFAULT 'planning',
    attempt INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,
    state_json TEXT,              -- LoopState JSON
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Loop 迭代历史表
CREATE TABLE loop_iterations (
    id TEXT PRIMARY KEY,
    loop_id TEXT NOT NULL REFERENCES loops(id),
    attempt INTEGER NOT NULL,
    plan_json TEXT,               -- 本次迭代的计划
    result_json TEXT,             -- 本次迭代的执行结果
    verdict_json TEXT,            -- Verifier 判定
    reflection_json TEXT,         -- Reflector 复盘
    started_at TEXT NOT NULL,
    completed_at TEXT
);

-- 索引
CREATE INDEX idx_loops_task_id ON loops(task_id);
CREATE INDEX idx_loops_phase ON loops(phase);
CREATE INDEX idx_iterations_loop_id ON loop_iterations(loop_id);
```

---

## 十、前端集成方案

### 10.1 Helm/Solo UI Loop 可视化

在 PlanPanel 中增加 Loop 迭代时间线：

```
┌─ Loop: deep-article-loop ──────────────────────────────┐
│                                                         │
│  ● Attempt 1  ──✗──  Score: 0.72  缺少案例             │
│  ● Attempt 2  ──✗──  Score: 0.78  SEO密度不足           │
│  ● Attempt 3  ──✓──  Score: 0.92  通过!                │
│                                                         │
│  [停止Loop]  [查看复盘]  [修改阈值]                       │
└─────────────────────────────────────────────────────────┘
```

### 10.2 WebSocket 事件接入

Loop 事件通过现有 WebSocket 通道推送，前端监听 `loop.*` 事件类型：

```typescript
// 前端监听 Loop 事件
socket.on("event", (event) => {
  if (event.type.startsWith("loop.")) {
    updateLoopTimeline(event);
  }
});
```

### 10.3 Loop 配置 UI

在 SettingsPanel 中增加 Loop 配置界面：
- 选择 Loop 模板
- 调整 `max_retries`、`pass_threshold`
- 启用/禁用 Loop 模式

---

## 十一、嵌套 Loop 与并行 Worker

### 11.1 嵌套 Loop

外层 Loop 的 Worker 可以引用另一个 Loop 模板，形成嵌套。终止条件：

- 内层 Loop 耗尽重试次数 → 返回 `LoopResult(success=False)` → 外层 Loop 触发 Reflector
- 内层 Loop 成功 → 返回结果 → 外层 Loop 继续 Verifier

```yaml
# 外层 Loop
worker:
  mode: loop
  template: research-loop       # 引用内层 Loop 模板
```

### 11.2 并行 Worker

多个 Worker 同时执行不同步骤，最后汇总。使用 `asyncio.gather` 实现：

```yaml
worker:
  mode: parallel
  workers:
    - name: "research"
      workflow: defense_research
    - name: "writing"
      workflow: defense_writing
  merge_strategy: "concat"      # concat | reduce | vote
```

并发安全：每个 Worker 操作独立的 TaskContext 副本，汇总时合并结果。

---

## 十二、竞品对比

| 竞品 | Loop 实现方式 | 优点 | 缺点 | FlowForge 优势 |
|------|-------------|------|------|---------------|
| **Claude Code** | 内置循环 + Hook API | 成熟稳定、用户量大 | Hook 配置有限、无跨任务记忆 | ✅ 完全可配置的 Loop 模板 + 5种记忆 |
| **LangGraph** | 显式状态机 | 灵活、可编码 | 无内置校验/复盘、需手动编码 | ✅ 五层模块化 + Harness 约束 |
| **AutoGen** | 对话循环 | 多Agent协作 | 容易死循环、无防御 | ✅ 三层防御 + 熔断 + 退避策略 |
| **Trae CN Solo** | 动态Plan + 自动执行 | Plan可视化、交互友好 | Plan更新依赖LLM、无Verifier | ✅ Loop Verifier 独立校验 + Reflector 自修正 |
| **传统 ReAct** | Thought-Action-Observation | 简单直观 | 单步循环、无全局规划 | ✅ Loop 是 ReAct 的"上级管理者" |

**FlowForge 的独特价值**：**Loop + Harness = 自主干活且可控的 Agent 系统**。Harness 负责"不要做什么"，Loop 负责"如何做更好"。

---

## 十三、实施路线图

### Phase 1：核心 LoopExecutor

| 内容 | 说明 |
|------|------|
| LoopState 数据模型 | Pydantic 模型 + CheckpointManager 持久化 |
| LoopExecutor 核心逻辑 | 包装 HybridExecutor，实现规划→执行→校验→复盘闭环 |
| Loop 事件协议 | 定义 `loop.*` 事件，接入 EventBus |
| 1 个预置模板 | `deep-article-loop` 作为标准模板 |
| DB Schema | loops + loop_iterations 表 |

**前置依赖**：无（复用现有 HybridExecutor + Harness）
**回退方案**：Loop 失败时退化为单次 HybridExecutor 执行

### Phase 2：模板化 + API + UI

| 内容 | 说明 |
|------|------|
| LoopRegistry + YAML 模板加载 | 从 `config/loops/` 加载模板 |
| REST API | 6 个 Loop 管理 API |
| Helm UI Loop 可视化 | PlanPanel 迭代时间线 |
| Loop 配置 UI | SettingsPanel 配置界面 |
| 3 个预置模板 | 文章创作、代码审查、周报生成 |

**前置依赖**：Phase 1
**回退方案**：使用硬编码配置替代 YAML 模板

### Phase 3：嵌套 + 并行 + 高级特性

| 内容 | 说明 |
|------|------|
| 嵌套 Loop | Worker 引用另一个 Loop 模板 |
| 并行 Worker | asyncio.gather + 独立 TaskContext 副本 |
| 退避策略 | fixed / linear / exponential |
| Memory 跨任务复用 | 失败教训从 LongTermMemory 自动注入 Planner |
| 规则进化闭环 | Reflector → RuleEvolution → ContextEngine 自动注入新规则 |

**前置依赖**：Phase 2
**回退方案**：禁用嵌套，串行执行；禁用规则进化，使用静态规则

---

## 十四、总结

Loop Engineering 是 FlowForge 从"Agent 编排框架"进化为"Agent 操作系统"的关键一步。核心设计原则：

1. **Loop 是 Harness 的子模块**，不是独立层，与四根护栏并列
2. **LoopExecutor 包装 HybridExecutor**，每次迭代复用现有执行引擎
3. **独立 LoopState**，不修改 TaskContext，通过 CheckpointManager 持久化
4. **Loop Verifier 与 Harness FeedbackLoop 互补**，分别负责业务级和架构级校验
5. **Loop 事件接入 EventBus**，供 Helm/Solo UI 实时展示
6. **失败转化为规则**，通过 EntropyManager + RuleEvolution 实现"永不再犯"

结合现有的 Harness 护栏，FlowForge 将成为业界首个**可控的自主 Agent 系统**。
