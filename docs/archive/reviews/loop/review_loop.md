# FlowForge Loop Engineering 架构设计 — 第二轮多角色联合审核报告

> **审核对象**：`flowforge/docs/loop.md` v1.0（2026-06-12 更新版）
> **审核日期**：2026-06-12
> **审核团队**：AI智能体产品专家、AI高级架构师、AI Agent开发工程师、高级软件全栈工程师
> **实际代码参照**：`harness/orchestrator.py`、`executor/hybrid_executor.py`、`harness/feedback_loop.py`、`harness/entropy_manager.py`、`core/checkpoint_manager.py`、`memory/manager.py`
> **参考文档**：`arch.md`、`spec.md`、`DEVELOPMENT_RULES.md`、`contentforge/docs/archive/ARCHITECTURE.md`

---

## 零、上轮审核问题修复情况

> 上轮审核（`review_loop.md` v1）共提出了 9 个 P0/P1/P2 级别问题。更新后的 loop.md 修复情况如下：

| 上轮问题 | 严重度 | 状态 | 说明 |
|---------|--------|------|------|
| **A3** LoopExecutor 与 HybridExecutor 职责重叠 | P0 | ✅ 已修复 | 明确 LoopExecutor 包装 HybridExecutor，不替代 |
| **A1** Loop 与 Reflexion 模式功能重复 | P0 | ✅ 已修复 | 明确了 Loop 与 9 大模式的关系表 |
| **A2** Loop Verifier 与 FeedbackLoop 双外环 | P0 | ✅ 已修复 | 明确分工：FeedbackLoop 架构级，Loop Verifier 业务级 |
| **P1** 文档结构混乱 | P0 | ✅ 已修复 | 文档已重构为 14 章标准设计文档 |
| **A4** Harness Hook 触发时机 | P1 | ⚠️ 部分修复 | 明确了每次迭代触发，但代码仍有 API 不匹配 |
| **A5** Loop 与 reflexion_retry 三重嵌套 | P1 | ✅ 已修复 | 明确了调用关系 |
| **C1-C5** 代码 API 不匹配 | P1 | ⚠️ 部分修复 | 仍有 4 处 API 与实际代码不匹配（见下文） |
| **M1-M5** 实现细节缺失 | P1 | ✅ 已修复 | LoopState、事件协议、API、DB Schema 均已补充 |
| **F1-F4** 前端/API 缺失 | P2 | ✅ 已修复 | 前端集成方案、API 设计、DB Schema 已补全 |

**总体评价**：更新后的 loop.md 在架构层面已大幅改善，正确地将 Loop 定位为 Harness 子模块，明确了 LoopExecutor 包装 HybridExecutor 的职责。**主要剩余问题集中在代码示例与实际 API 的不匹配上**。

---

## 一、总体评价

| 维度 | 上轮 | 本轮 | 变化 | 说明 |
|------|:----:|:----:|:----:|------|
| **战略方向** | 9 | 9 | - | 方向正确，维持 |
| **架构融合度** | 5 | **8** | +3 | 大幅改善，正确识别并复用已有能力 |
| **代码可行性** | 3 | **5** | +2 | 改善但仍有多处 API 不匹配 |
| **实施可行性** | 4 | **7** | +3 | 路线图清晰，有依赖分析和回退方案 |
| **文档质量** | 4 | **8** | +4 | 结构清晰，14 章标准设计文档 |
| **综合评分** | **5.0** | **7.4** | **+2.4** | 显著改善，核心问题已解决 |

---

## 二、AI智能体产品专家审核意见

### 2.1 亮点

1. **定位清晰**："Loop 是 Harness 的子模块，不是独立层"——这一句解决了上轮架构冲突的核心矛盾。
2. **"Harness 负责'不要做什么'，Loop 负责'如何做更好'"**——这个比喻精准传达了 Harness 与 Loop 的互补关系。
3. **竞品分析表**：补充了 LangGraph、AutoGen、Trae CN Solo 的对比，让 FlowForge 的独特价值更清晰。
4. **前端可视化设计**：Loop 迭代时间线在 PlanPanel 中的展示方案直观、可落地。

### 2.2 问题

| # | 问题 | 严重度 | 建议 |
|---|------|--------|------|
| P1 | **"80% 日常任务自动化"仍缺乏数据支撑**（虽然上轮提到但未修改） | 低 | 改为目标表述，如"目标：将日常任务的人工干预率降低至 20% 以下" |
| P2 | **Loop 模板 YAML 中的 `verifier.rules` 字段与 Harness FeedbackLoop 的评分维度不一致**：loop.md 定义 `rules: ["文章字数 >= 2000", "包含至少3个实际案例"]`，而 FeedbackLoop 实际评分维度是 `correctness/completeness/coherence/safety`。业务规则与架构评分的关系未定义 | 中 | 明确 Loop Verifier 的 rules 是业务级校验规则，FeedbackLoop 的四维评分是架构级质量闸门，两者在不同阶段独立运行 |
| P3 | **未说明 Loop 模板与 Workflow YAML 的用户选择逻辑**：用户何时用 Workflow，何时用 Loop？如果 Loop 只是 Workflow 的包装，用户感知的价值是什么？ | 中 | 建议增加一节"Loop vs Workflow 使用决策树"：Workflow 适合流程确定、不需要自修正的任务；Loop 适合质量要求高、需要多轮迭代的任务 |

---

## 三、AI高级架构师审核意见

### 3.1 架构设计评价

更新后的 loop.md 在架构层面的设计**基本正确**。以下是逐个架构决策的审核：

| 架构决策 | 评价 | 理由 |
|---------|:----:|------|
| Loop 是 Harness 子模块，与四根护栏并列 | ✅ 正确 | 符合六层架构，不引入新层级 |
| LoopExecutor 包装 HybridExecutor | ✅ 正确 | 复用现有引擎，每次迭代通过 HybridExecutor 执行 |
| 独立 LoopState，不污染 TaskContext | ✅ 正确 | 符合关注点分离原则 |
| Loop Verifier 与 FeedbackLoop 互补 | ✅ 正确 | 架构级 vs 业务级分工清晰 |
| Harness Hook 每次迭代触发 | ⚠️ 需细化 | ContextEngine 每次迭代注入上下文可能导致膨胀，需增加增量注入策略 |
| 失败转化为规则 | ✅ 正确 | 复用 EntropyManager + RuleEvolution |

### 3.2 关键架构问题

#### A1：ContextEngine 每次迭代注入的上下文膨胀风险（中等）

loop.md 明确"Harness Hook 每次迭代都触发"，但 ContextEngine 的 `inject()` 方法每次都会注入 AGENTS.md 规则、历史教训、会话交接物。如果 Loop 迭代 3 次，相同上下文会被注入 3 次，导致上下文窗口膨胀。

**建议**：在 `pre_execute` 中增加"首次注入标记"——首次迭代完整注入，后续迭代只注入增量（如 Reflector 产生的反思结果）。

#### A2：FeedbackLoop 实际评分维度与文档不一致（需要关注）

spec.md 和 arch.md 描述 FeedbackLoop 评分维度为 `design_quality / originality / craft / functionality`，但**实际代码**（`harness/feedback_loop.py` L75）的维度是 `correctness / completeness / coherence / safety`。loop.md 提到 FeedbackLoop 做"四维评分"，但未指定具体维度名。

**建议**：loop.md 中引用 FeedbackLoop 时使用实际代码中的维度名（`correctness/completeness/coherence/safety`），并在 spec.md 中统一维度定义。

#### A3：Loop 模板中 `worker.workflow` 引用与 WorkflowExecutor 的集成路径未明确（中等）

loop.md 的 YAML 模板中 `worker.workflow: defense_article` 引用 `config/workflows/` 中的 Workflow。但 LoopExecutor 的 Worker 阶段调用的是 `HybridExecutor.execute(task)`，而非直接调用 WorkflowExecutor。HybridExecutor 需要从 task 中提取 mode 和 workflow 引用。

**建议**：在 LoopExecutor 代码中明确：Worker 阶段将 `worker.mode` 和 `worker.workflow` 设置到 TaskContext 的 `mode` 和 `metadata` 中，然后委托给 HybridExecutor.run()。

---

## 四、AI Agent 开发工程师审核意见 —— 代码 API 逐行对照

> 以下对照 `harness/orchestrator.py`、`executor/hybrid_executor.py`、`harness/feedback_loop.py`、`harness/entropy_manager.py`、`core/checkpoint_manager.py` 的实际代码。

### 4.1 代码 API 不匹配详情

#### C1：`hybrid_executor.execute(task)` 方法名错误（严重）

**loop.md L298**：
```python
result = await self.hybrid_executor.execute(task)
```

**实际代码**（`hybrid_executor.py` L105）：
```python
async def run(self, context: TaskContext, mode_hint: str = None, _is_substep: bool = False) -> dict:
```

**问题**：方法名是 `run()` 不是 `execute()`，且需要 `mode_hint` 参数来指定执行模式。Loop 的 Worker 阶段需要根据 `loop_config.worker.mode` 设置 `mode_hint`，否则 HybridExecutor 会走 auto-suggest 逻辑。

**修复**：
```python
result = await self.hybrid_executor.run(task, mode_hint=loop_config.get("worker", {}).get("mode", "workflow"))
```

#### C2：`harness.pre_execute(task)` 返回值处理错误（中等）

**loop.md L294**：
```python
task = await self.harness.pre_execute(task)
```

**实际代码**（`orchestrator.py` L62）：
```python
async def pre_execute(self, ctx) -> None:
```

**问题**：`pre_execute()` 返回 `None`，不返回修改后的 ctx。它直接修改传入的 ctx 对象（通过 `context_engine.inject(ctx)` 注入元数据到 `ctx.metadata`）。

**修复**：
```python
await self.harness.pre_execute(task)  # 不接收返回值，ctx 原地修改
```

#### C3：`entropy_mgr.track_debt()` 方法不存在（严重）

**loop.md L321-326**：
```python
await self.entropy_mgr.track_debt(
    source=f"loop:{state.loop_id}",
    description=f"Loop attempt {attempt + 1} failed: {verdict.errors}",
    severity="medium",
    context=task,
)
```

**实际代码**：`EntropyManager` 没有 `track_debt()` 方法。它通过 `debt_tracker.record()` 记录债务，通过 `post_track()` 在 Harness post_execute 中自动记录。

**修复**：
```python
if self.entropy_mgr.debt_tracker:
    self.entropy_mgr.debt_tracker.record(
        description=f"Loop attempt {attempt + 1} failed: {verdict.errors}",
        severity=DebtSeverity.MEDIUM,
        source=f"loop:{state.loop_id}",
        metadata={"task_id": task.task_id, "attempt": attempt + 1, "errors": verdict.errors},
    )
```

#### C4：`rule_evolution.evolve()` 方法不存在（严重）

**loop.md L327-332**：
```python
await self.rule_evolution.evolve(
    trigger=f"loop_failure:{state.loop_id}",
    failures=verdict.errors,
    reflection=reflection,
    context=task,
)
```

**实际代码**：`RuleEvolution` 没有 `evolve()` 方法。它有 `propose()`、`activate()`、`mutate()`、`deprecate()`、`retire()` 五个方法。

**修复**：
```python
self.rule_evolution.propose(
    name=f"Loop failure: {state.loop_id} attempt {attempt + 1}",
    description=f"Loop iteration failed with errors: {verdict.errors}. Reflection: {reflection}",
    metadata={"loop_id": state.loop_id, "attempt": attempt + 1, "errors": verdict.errors},
)
```

#### C5：`checkpoint_mgr.save()` 参数不匹配（中等）

**loop.md L311、L335**：
```python
await self.checkpoint_mgr.save(state.loop_id, state.model_dump())
```

**实际代码**（`checkpoint_manager.py` L69）：
```python
def save(self, task_id: str, step_name: str, state: Dict[str, Any]) -> None:
```

**问题**：`save()` 需要 3 个参数：`task_id`、`step_name`、`state`。loop.md 只传了 2 个参数，且第一个参数是 `loop_id` 而非 `task_id`。

**修复**：
```python
await self.checkpoint_mgr.save(
    task_id=state.task_id,
    step_name=f"loop:{state.loop_id}:attempt_{state.attempt}",
    state=state.model_dump(),
)
```

### 4.2 缺失的依赖导入

loop.md 的 `LoopExecutor` 代码示例中 import 了以下模块，但未验证这些模块是否存在：

| import | 实际存在？ | 说明 |
|--------|:--------:|------|
| `from flowforge.core.task_context import TaskContext` | ✅ | 存在 |
| `from flowforge.executor.hybrid_executor import HybridExecutor` | ✅ | 存在 |
| `from flowforge.harness.orchestrator import HarnessOrchestrator` | ✅ | 存在 |
| `from flowforge.harness.entropy_manager import EntropyManager` | ✅ | 存在 |
| `from flowforge.harness.rule_evolution import RuleEvolution` | ❌ | 不存在独立模块！`RuleEvolution` 是 `entropy_manager.py` 内部的类，需从 `flowforge.harness.entropy_manager import RuleEvolution` |
| `from flowforge.memory.checkpoint_manager import CheckpointManager` | ❌ | 不存在！`CheckpointManager` 在 `flowforge.core.checkpoint_manager` |

### 4.3 缺失的实现细节

| # | 缺失项 | 说明 |
|---|--------|------|
| **M1** | **LoopPlanner / LoopVerifier / LoopReflector 类定义** | loop.md 只在 LoopExecutor 构造函数中引用了 `planner`、`verifier`、`reflector` 参数，但未给出这三个类的接口定义。建议补充抽象基类 |
| **M2** | **ContextEngine 增量注入** | 如上文 A1 所述，每次迭代都完整注入上下文会导致膨胀。需在 loop.md 中补充增量注入策略 |
| **M3** | **`FeedbackLoop.evaluate()` 返回格式** | loop.md 中 `verdict.passed` 和 `verdict.errors` 的访问方式与实际 FeedbackLoop 返回格式不一致。FeedbackLoop 返回的是 `result["_feedback"]["gate"]`（值为 PASS/CONDITIONAL/FAIL），而非 `verdict.passed` 布尔值 |
| **M4** | **Loop 与 Persona 锁的交互** | HybridExecutor 有 Persona 锁机制（同一 persona 同一时间只允许一个任务运行）。Loop 的多次迭代是否需要释放和重新获取锁？文档未说明 |

---

## 五、高级软件全栈工程师审核意见

### 5.1 与已有系统的集成验证

| # | 检查项 | 状态 | 说明 |
|---|--------|:----:|------|
| **F1** | Loop 事件通过 EventBus 发送 | ⚠️ | 事件类型已定义，但 `LoopExecutor` 代码中未实际调用 `event_bus.emit()`。建议在 `run()` 方法中增加事件发射 |
| **F2** | Loop 接入 WebSocket/Helm | ✅ | 事件协议已定义，前端监听方案已给出 |
| **F3** | Loop 与 Persona 锁的兼容 | ❌ | 未说明。Loop 多次迭代期间，Persona 锁应保持还是释放？ |
| **F4** | Loop 模板与 Workflow 配置的目录共存 | ✅ | `config/loops/` 与 `config/workflows/` 分离，Worker 通过 `workflow` 字段引用 |
| **F5** | 数据库 Schema 与现有表兼容 | ⚠️ | loops 表引用 `tasks(id)` 外键，但需确认 `tasks` 表是否存在且 `id` 字段为主键 |
| **F6** | Loop 配置 UI 与现有 SettingsPanel 集成 | ✅ | 方案已给出，在 SettingsPanel 中增加 Loop 配置界面 |

### 5.2 嵌套 Loop 与并行 Worker 的并发安全

loop.md 第十一章描述了嵌套 Loop 和并行 Worker，但存在以下问题：

1. **嵌套 Loop 的死循环风险**：如果内层 Loop 的 Reflector 建议修改外层 Loop 的计划，可能形成无限递归。建议增加 `max_nesting_depth` 限制（如 3 层）。

2. **并行 Worker 的 TaskContext 副本**：loop.md 提到"每个 Worker 操作独立的 TaskContext 副本"，但 `TaskContext` 包含 `event_bus`、`checkpoint`、`memory` 等共享资源。浅拷贝可能导致事件重复发送、检查点冲突。

3. **退避策略的实现**：loop.md 提到 `backoff_strategy: exponential`，但 `LoopExecutor.run()` 代码中未体现退避逻辑。建议在重试循环中增加 `await asyncio.sleep(backoff_seconds)`。

### 5.3 实施路线图评价

三阶段路线图设计合理，但需注意：

- **Phase 1 前置依赖标注为"无"不准确**：LoopExecutor 依赖 HarnessOrchestrator、HybridExecutor、FeedbackLoop、EntropyManager、RuleEvolution、CheckpointManager，这些虽然已实现，但需要确保它们已正确初始化并可独立使用。
- **Phase 1 的 1 个预置模板 `deep-article-loop`**：建议同时提供 `code-review-loop` 作为第二个模板，因为代码审查场景的"校验失败→复盘→重试"闭环更容易验证 Loop 的核心价值。

---

## 六、关键问题汇总与优先级

| 优先级 | 编号 | 问题 | 类型 |
|--------|------|------|------|
| **P0** | C1 | `hybrid_executor.execute()` 应为 `hybrid_executor.run()` | 代码 API 不匹配 |
| **P0** | C3 | `entropy_mgr.track_debt()` 方法不存在 | 代码 API 不匹配 |
| **P0** | C4 | `rule_evolution.evolve()` 方法不存在 | 代码 API 不匹配 |
| **P1** | C2 | `harness.pre_execute()` 返回值处理错误 | 代码 API 不匹配 |
| **P1** | C5 | `checkpoint_mgr.save()` 参数不匹配 | 代码 API 不匹配 |
| **P1** | M3 | `verdict.passed` 与 FeedbackLoop 实际返回格式不一致 | 接口不匹配 |
| **P1** | M4 | Loop 与 Persona 锁的交互未定义 | 实现细节缺失 |
| **P2** | A1 | ContextEngine 每次迭代注入导致上下文膨胀 | 架构风险 |
| **P2** | A2 | FeedbackLoop 评分维度名与代码不一致 | 文档不一致 |
| **P2** | M1 | LoopPlanner/LoopVerifier/LoopReflector 接口未定义 | 实现细节缺失 |
| **P2** | F3 | Loop 与 Persona 锁的兼容未说明 | 工程完整性 |

---

## 七、修订后的 LoopExecutor 核心代码

> 以下是修正了所有 API 不匹配问题后的 `LoopExecutor.run()` 方法：

```python
import asyncio
from datetime import datetime, timezone
from flowforge.core.task_context import TaskContext
from flowforge.executor.hybrid_executor import HybridExecutor
from flowforge.harness.orchestrator import HarnessOrchestrator
from flowforge.harness.entropy_manager import EntropyManager, DebtSeverity, RuleEvolution
from flowforge.core.checkpoint_manager import CheckpointManager

class LoopExecutor:
    """Loop — Harness   """

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
        max_retries = loop_config.get("max_retries", 3)
        backoff_base = loop_config.get("backoff_base", 2)
        worker_config = loop_config.get("worker", {})
        worker_mode = worker_config.get("mode", "workflow")

        state = LoopState(
            loop_id=loop_config["name"],
            task_id=task.task_id,
            template_name=loop_config["name"],
            max_retries=max_retries,
        )

        # 1. 
        state.phase = LoopPhase.PLANNING
        plan = await self.planner.plan(task, loop_config.get("planner", {}))
        state.current_plan = plan

        for attempt in range(max_retries):
            state.attempt = attempt + 1
            state.updated_at = datetime.now(timezone.utc)

            # 2. Harness pre_execute  ctx 
            #    pre_execute  None ctx 
            await self.harness.pre_execute(task)

            # 3.  HybridExecutor.run()  mode_hint
            state.phase = LoopPhase.EXECUTING
            task.mode = worker_mode
            result = await self.hybrid_executor.run(task, mode_hint=worker_mode)

            # 4. Harness post_execute   
            result = await self.harness.post_execute(result, task)

            # 5. Loop Verifier 
            state.phase = LoopPhase.VERIFYING
            verdict = await self.verifier.verify(result, task, loop_config.get("verifier", {}))
            state.verification_history.append(verdict.model_dump())

            if verdict.passed:
                state.phase = LoopPhase.COMPLETED
                await self.checkpoint_mgr.save(
                    task_id=state.task_id,
                    step_name=f"loop:{state.loop_id}:completed",
                    state=state.model_dump(),
                )
                return LoopResult(success=True, output=result, total_attempts=attempt + 1, state=state)

            # 6. 
            state.phase = LoopPhase.REFLECTING
            reflection = await self.reflector.reflect(verdict.errors, task, state)
            state.reflection_history.append(reflection.model_dump())
            state.past_errors.extend(verdict.errors)

            # 7.   
            #    EntropyManager.debt_tracker.record() 
            if self.entropy_mgr.debt_tracker:
                self.entropy_mgr.debt_tracker.record(
                    description=f"Loop attempt {attempt + 1} failed: {verdict.errors}",
                    severity=DebtSeverity.MEDIUM,
                    source=f"loop:{state.loop_id}",
                    metadata={"task_id": task.task_id, "attempt": attempt + 1, "errors": verdict.errors},
                )
            #    RuleEvolution.propose() 
            self.rule_evolution.propose(
                name=f"Loop failure: {state.loop_id} attempt {attempt + 1}",
                description=f"Loop iteration failed with errors: {verdict.errors}. Reflection: {reflection}",
                metadata={"loop_id": state.loop_id, "attempt": attempt + 1, "errors": verdict.errors},
            )

            # 8. 
            await self.checkpoint_mgr.save(
                task_id=state.task_id,
                step_name=f"loop:{state.loop_id}:attempt_{attempt + 1}",
                state=state.model_dump(),
            )

            # 9. 
            plan = await self.planner.replan(plan, reflection, state.past_errors)
            state.current_plan = plan

            # 10. 
            backoff_strategy = loop_config.get("backoff_strategy", "exponential")
            if backoff_strategy == "exponential":
                await asyncio.sleep(backoff_base ** attempt)
            elif backoff_strategy == "linear":
                await asyncio.sleep(backoff_base * (attempt + 1))
            # fixed: 

        # 
        state.phase = LoopPhase.FAILED
        await self.checkpoint_mgr.save(
            task_id=state.task_id,
            step_name=f"loop:{state.loop_id}:failed",
            state=state.model_dump(),
        )
        return LoopResult(success=False, error=f"Max retries ({max_retries}) exceeded", total_attempts=max_retries, state=state)
```

### 主要修正点

| # | 修正项 | 原代码 | 修正后 |
|---|--------|--------|--------|
| 1 | `hybrid_executor.execute()` | 不存在的方法 | `hybrid_executor.run(task, mode_hint=worker_mode)` |
| 2 | `harness.pre_execute()` 返回值 | `task = await ...` | `await ...`（不接收返回值） |
| 3 | `entropy_mgr.track_debt()` | 不存在的方法 | `entropy_mgr.debt_tracker.record()` |
| 4 | `rule_evolution.evolve()` | 不存在的方法 | `rule_evolution.propose()` |
| 5 | `checkpoint_mgr.save()` | 只传 2 个参数 | 传 3 个参数：`task_id`、`step_name`、`state` |
| 6 | 退避策略 | 未实现 | 增加 `asyncio.sleep()` 退避逻辑 |
| 7 | import 路径 | `flowforge.memory.checkpoint_manager` | `flowforge.core.checkpoint_manager` |
| 8 | import 路径 | `flowforge.harness.rule_evolution` | `flowforge.harness.entropy_manager` |

---

## 八、结论

更新后的 loop.md 在**架构层面已达到可进入实施的标准**。Loop 的定位、与已有组件的关系、五层模块设计、事件协议、API/DB Schema、前端集成方案均已清晰定义。

**进入 Phase 1 实施前必须修复的阻塞项（P0）**：

1. **C1**：`execute()` → `run()`，并传递 `mode_hint`
2. **C3**：`track_debt()` → `debt_tracker.record()`
3. **C4**：`evolve()` → `propose()`

**建议在 Phase 1 实施中同步修复的项（P1）**：

4. **C2**：`pre_execute()` 不接收返回值
5. **C5**：`checkpoint_mgr.save()` 参数修正
6. **M3**：LoopVerifier 的 `verdict.passed` 与 FeedbackLoop 返回格式对齐
7. **M4**：补充 Loop 与 Persona 锁的交互设计

**可延后到 Phase 2 处理的项（P2）**：

8. **A1**：ContextEngine 增量注入策略
9. **A2**：FeedbackLoop 维度名统一
10. **M1**：LoopPlanner/LoopVerifier/LoopReflector 接口定义

**总体结论**：loop.md 经本轮修订后，综合评分从 5.0 提升至 7.4，核心架构冲突已消除。修复上述 P0 级别的 API 不匹配后，即可进入 Phase 1 实施。