# Loop Engineering 架构设计 — 多角色联合审核报告

> **审核对象**：`flowforge/docs/loop.md`
> **审核日期**：2026-06-12
> **审核团队**：AI智能体产品专家、AI高级架构师、AI Agent开发工程师、高级软件全栈工程师
> **参考文档**：`arch.md` v6.0、`spec.md` v6.0、`design.md` v6.0、`ARCHITECTURE_PRINCIPLES.md`

---

## 一、总体评价

| 维度 | 评分 (1-10) | 说明 |
|------|:-----------:|------|
| **战略方向** | 9 | Loop Engineering 范式转移判断准确，与业界趋势高度一致 |
| **架构融合度** | 6 | 与现有 Harness 六层架构的融合存在3处结构性冲突 |
| **代码可行性** | 4 | 核心代码示例存在5处与现有代码接口不兼容的问题 |
| **实施可行性** | 5 | 3阶段路线图缺少关键依赖分析和回退方案 |
| **文档质量** | 6 | 前半部分为原始讨论记录，后半部分为设计文档，结构混乱 |
| **综合评分** | **6.0/10** | 方向正确，但落地细节需要大幅修订 |

---

## 二、AI智能体产品专家审核意见

### 2.1 亮点

1. **范式判断精准**：从 Prompt Engineering 到 Loop Engineering 的范式转移判断正确。Claude Code、Trae CN、Cursor 等产品的最新版本都在强化 Loop 能力，FlowForge 必须跟进。
2. **用户价值清晰**："只需定义目标和边界，系统自主完成"的价值主张对非技术用户极具吸引力。
3. **竞品对比有参考价值**：Claude Code/LangGraph/AutoGen 的对比分析帮助定位差异化优势。

### 2.2 问题

| # | 问题 | 严重度 | 建议 |
|---|------|--------|------|
| P1 | **文档结构混乱**：前37行是原始讨论记录（含"很好，目前我们flowforge已经运行的很好了"等口语化内容），第39行开始才是AI生成的方案，第273行开始又是另一版设计。一份文档包含3个不同来源的内容，读者无法区分哪些是需求、哪些是方案 | **高** | 重构文档结构：删除原始讨论记录，将两版方案合并为一份 |
| P2 | **缺少用户场景验证**：文档描述了Loop的5大模块，但没有从用户视角给出"使用Loop前 vs 使用Loop后"的具体场景对比 | **中** | 增加3-5个具体用户故事，量化Loop带来的效率提升 |
| P3 | **竞品分析不够深入**：对Claude Code的Loop描述为"黑盒、不可配置"，但Claude Code 2026年版本已开放了Hook配置和自定义Verifier；对Trae CN的Solo模式Loop能力完全未提及 | **中** | 补充Claude Code Hook API、Trae CN Plan模式的最新分析 |
| P4 | **"80%日常任务自动化"缺乏依据**：文档声称"系统就能自动处理80%的日常任务"，但没有数据支撑 | **低** | 改为"目标"而非"结论"，或引用行业基准数据 |

---

## 三、AI高级架构师审核意见

### 3.1 亮点

1. **五层模块化设计合理**：Planner-Worker-Verifier-Reflector-Memory 的拆解符合控制论闭环原则。
2. **Harness + Loop = 刹车+引擎 的隐喻直观**：帮助理解两者关系。
3. **Loop与9大模式的关系定义清晰**：Loop作为"上层管理者"而非"新模式"的定位正确。

### 3.2 架构冲突（关键问题）

| # | 冲突 | 严重度 | 详细分析 |
|---|------|--------|---------|
| **A1** | **Loop 与 HybridExecutor 的职责重叠** | **严重** | 文档中 `LoopExecutor.run()` 的逻辑（规划→执行→校验→复盘→重试）与现有 `HybridExecutor` 的 TAOR 循环（Think-Act-Observe-Repeat）高度重叠。两者都包含"执行→观察→判断→迭代"的逻辑，但文档未说明 LoopExecutor 与 HybridExecutor 的调用关系：是 LoopExecutor 包装 HybridExecutor？还是 LoopExecutor 替代 HybridExecutor？ | 
| **A2** | **Loop 与 Harness Hook 的执行顺序未定义** | **严重** | 现有架构中，Harness 通过 `pre_execute`/`post_execute` 两个 Hook 点介入 Agent 执行。Loop 引入后，每次 Loop 迭代是否都触发 Harness Hook？如果每次迭代都触发 `pre_execute`（注入上下文）和 `post_execute`（校验+反馈），那么 Loop 内的 Verifier 与 Harness 的 FeedbackLoop 是什么关系？文档中 `HarnessLoopExecutor` 的代码暗示了双重验证，但未明确优先级和去重逻辑 |
| **A3** | **Loop Memory 与现有 MemoryManager 的关系不清** | **高** | 文档中 Loop 的 Memory 模块与 FlowForge 现有的 5 种记忆（Working/ShortTerm/LongTerm/Episodic/Semantic）是什么映射关系？`memory.store_success()` 和 `memory.store_failures()` 应该写入哪种记忆？文档仅提到 `store: episodic`，但失败教训更适合写入 LongTerm 或 Semantic 记忆 |
| **A4** | **Loop 模板与现有 Workflow YAML 的冲突** | **高** | FlowForge 已有 `config/workflows/` 目录存放 Workflow YAML 定义。Loop 模板存放在 `config/loops/`，但 Loop 的 Worker 可以引用 Workflow，这意味着一个执行链可能涉及两套不同格式的 YAML 配置。需要明确：Loop YAML 是否是 Workflow YAML 的超集？还是完全独立的配置体系？ |
| **A5** | **Loop 嵌套的终止条件缺失** | **中** | Phase 3 提到"支持嵌套 Loop"，但未定义嵌套 Loop 的终止条件。如果外层 Loop 的 Worker 是一个内层 Loop，内层 Loop 耗尽重试次数后，外层 Loop 如何处理？ |

### 3.3 架构建议

```
建议的 Loop 在六层架构中的位置：

  4. Harness 驾驭层
     ├── 现有四根护栏
     └── Loop Engine (新增) ← Loop 是 Harness 的子模块，不是独立层

  3. 执行引擎层
     ├── HybridExecutor (不变)
     └── LoopExecutor (新增) ← LoopExecutor 包装 HybridExecutor，每次迭代调用 HybridExecutor

调用关系：
  LoopExecutor.run()
    → Harness.pre_execute()        # 每次迭代前注入上下文
    → HybridExecutor.execute()     # 复用现有执行引擎
    → Harness.post_execute()       # 每次迭代后校验
    → LoopVerifier.verify()        # Loop 级别的业务校验（与 Harness FeedbackLoop 互补）
    → LoopReflector.reflect()      # 仅在 Loop 级别校验失败时触发
    → Harness.entropy.capture()    # 将失败转化为规则
```

---

## 四、AI Agent 开发工程师审核意见

### 4.1 代码接口兼容性问题

| # | 问题 | 现有接口 | loop.md 中的代码 | 修复建议 |
|---|------|---------|-----------------|---------|
| **C1** | `Loop.__init__()` 直接实例化5个模块 | Planner/Worker/Verifier/Reflector/Memory 均为抽象概念，无对应类 | `self.planner = Planner()` 等硬编码实例化 | 应通过 DI 容器注入，或使用 Registry 查找 |
| **C2** | `LoopExecutor.run()` 的 `task` 参数类型 | 现有 `TaskContext` 是 dataclass，不支持 `task.is_completed` 属性和 `task.add_feedback()` 方法 | `while not task.is_completed` 和 `task.add_feedback(validated.errors)` | 需扩展 TaskContext 或使用独立的 LoopState |
| **C3** | `harness.context_engine.inject_dynamic_context(task)` | 现有 `ContextEngine.inject()` 签名为 `inject(ctx: TaskContext) -> TaskContext` | `inject_dynamic_context` 方法不存在 | 使用现有 `inject()` 方法 |
| **C4** | `harness.entropy_manager.capture_failure_to_rule()` | 现有 `EntropyManager` 无此方法；规则进化由 `rule_evolution.py` 处理 | 直接调用不存在的方法 | 应调用 `EntropyManager.track_debt()` + `RuleEvolution.evolve()` |
| **C5** | `Loop.from_config(config)` | 不存在此工厂方法 | 直接调用未实现的方法 | 需要实现 LoopConfig Pydantic 模型 + from_config 工厂 |

### 4.2 缺失的实现细节

| # | 缺失项 | 说明 |
|---|--------|------|
| M1 | **LoopState 状态模型** | Loop 执行过程中需要独立的状态模型（attempt_count、past_errors、current_plan、verification_history），不应污染 TaskContext |
| M2 | **Loop 事件定义** | Loop 的每次迭代应发出事件（loop.iteration.start、loop.verify.passed、loop.reflect.complete 等），供 Helm UI 实时展示，但文档未定义事件协议 |
| M3 | **Loop 中断与恢复** | Loop 执行可能耗时很长，需要支持中断后从检查点恢复。文档提到 CheckpointManager 但未给出具体的 save/restore 逻辑 |
| M4 | **Loop 超时与熔断** | 文档提到"三层防御 + 熔断机制"但未给出 Loop 级别的超时配置（如单次迭代超时、总超时、退避策略） |
| M5 | **并发安全** | 并行 Worker 场景下，多个 Worker 同时修改 LoopState 的竞态条件未处理 |

### 4.3 建议的 LoopState 模型

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
    loop_id: str
    task_id: str
    phase: LoopPhase = LoopPhase.PLANNING
    attempt: int = 0
    max_retries: int = 3
    current_plan: list[dict] | None = None
    past_errors: list[str] = Field(default_factory=list)
    verification_history: list[dict] = Field(default_factory=list)
    started_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
```

---

## 五、高级软件全栈工程师审核意见

### 5.1 前端集成缺失

| # | 问题 | 建议 |
|---|------|------|
| F1 | **Helm/Solo UI 未设计 Loop 可视化** | Loop 的"规划→执行→校验→复盘"迭代过程需要在 Helm 界面实时展示，类似 Trae CN 的 Plan 面板动态更新。建议在 PlanPanel 中增加 Loop 迭代时间线 |
| F2 | **Loop 事件未接入 WebSocket** | 现有 Helm 通过 WebSocket 推送 Agent 执行事件。Loop 的迭代事件（loop.iteration.start 等）需要定义事件格式并接入现有 WebSocket 通道 |
| F3 | **Loop 配置 UI 缺失** | 用户需要通过 Web UI 配置 Loop 模板（选择 Planner/Worker/Verifier 类型、设置 max_retries 等），但文档未涉及前端配置界面 |

### 5.2 API 设计缺失

| # | 缺失 API | 说明 |
|---|---------|------|
| A1 | `POST /api/v1/loops` | 创建 Loop 实例 |
| A2 | `GET /api/v1/loops/{loop_id}` | 查询 Loop 执行状态 |
| A3 | `POST /api/v1/loops/{loop_id}/stop` | 手动停止 Loop |
| A4 | `GET /api/v1/loops/{loop_id}/history` | 获取 Loop 迭代历史 |
| A5 | `GET /api/v1/loop-templates` | 列出可用 Loop 模板 |

### 5.3 数据库 Schema 缺失

Loop 执行需要持久化以下数据：

```sql
CREATE TABLE loops (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id),
    template_name TEXT NOT NULL,
    phase TEXT NOT NULL DEFAULT 'planning',
    attempt INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,
    state_json TEXT,  -- LoopState JSON
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE loop_iterations (
    id TEXT PRIMARY KEY,
    loop_id TEXT NOT NULL REFERENCES loops(id),
    attempt INTEGER NOT NULL,
    plan_json TEXT,
    result_json TEXT,
    verdict_json TEXT,
    reflection_json TEXT,
    created_at TEXT NOT NULL
);
```

---

## 六、关键问题汇总与优先级

| 优先级 | 问题 | 类型 | 建议处理方式 |
|--------|------|------|-------------|
| **P0** | A1: Loop 与 HybridExecutor 职责重叠 | 架构冲突 | 明确 LoopExecutor 包装 HybridExecutor，不替代 |
| **P0** | A2: Loop 与 Harness Hook 执行顺序 | 架构冲突 | 定义每次迭代触发 Harness Hook，Loop Verifier 作为业务层补充 |
| **P0** | C2: TaskContext 接口不兼容 | 代码可行性 | 引入独立 LoopState 模型 |
| **P1** | A3: Loop Memory 与 MemoryManager 关系 | 架构冲突 | 定义映射：failures→LongTerm, context→Working, rules→Semantic |
| **P1** | A4: Loop YAML 与 Workflow YAML 冲突 | 架构冲突 | Loop YAML 是 Workflow YAML 的上层编排，Worker 引用 Workflow 名 |
| **P1** | C1: DI 容器未使用 | 代码可行性 | LoopExecutor 通过构造函数注入所有依赖 |
| **P1** | M2: Loop 事件定义缺失 | 实现细节 | 定义 LoopEvent 协议，接入现有 EventBus |
| **P2** | F1-F3: 前端集成缺失 | 前端 | Phase 2 实现 Loop 可视化 |
| **P2** | A2-A5: API 和 DB Schema 缺失 | 后端 | Phase 1 先实现核心 LoopExecutor，API/DB 在 Phase 2 补齐 |
| **P2** | P1: 文档结构混乱 | 文档质量 | 重构为标准设计文档格式 |

---

## 七、修订建议

### 7.1 文档重构

将 loop.md 重构为以下结构：

```
1. 背景与动机（精简，删除原始讨论记录）
2. 核心概念定义（Loop = Harness 子模块，不是独立层）
3. 架构设计（在六层架构中的位置、与现有组件的关系图）
4. LoopState 数据模型
5. LoopExecutor 核心逻辑（含与 HybridExecutor/Harness 的调用关系）
6. Loop 事件协议
7. Loop 模板规范（YAML Schema 定义）
8. API 设计
9. 数据库 Schema
10. 前端集成方案
11. 实施路线图（含依赖分析和回退方案）
```

### 7.2 核心设计修订

1. **Loop 是 Harness 的子模块**，不是与 Harness 平级的独立层。Loop Engine 位于 Harness 驾驭层内部，与四根护栏并列。

2. **LoopExecutor 包装 HybridExecutor**，每次迭代：
   - 调用 `Harness.pre_execute()` 注入上下文
   - 调用 `HybridExecutor.execute()` 执行任务
   - 调用 `Harness.post_execute()` 进行架构约束校验
   - 调用 `LoopVerifier.verify()` 进行业务质量校验（与 Harness FeedbackLoop 互补而非重复）
   - 仅在 LoopVerifier 失败时触发 `LoopReflector.reflect()`

3. **引入独立 LoopState**，不修改 TaskContext。LoopState 通过 CheckpointManager 持久化，支持中断恢复。

4. **Loop 事件接入现有 EventBus**，定义 `loop.iteration.start/complete`、`loop.verify.passed/failed`、`loop.reflect.complete` 等事件，供 Helm UI 实时展示。

### 7.3 实施路线图修订

| Phase | 内容 | 前置依赖 | 回退方案 |
|-------|------|---------|---------|
| **Phase 1** | LoopState 模型 + LoopExecutor 核心逻辑 + 1个预置模板 | 无 | Loop 失败时退化为单次 HybridExecutor 执行 |
| **Phase 2** | LoopRegistry + YAML 模板加载 + Loop 事件 + API | Phase 1 | 使用硬编码配置替代 YAML |
| **Phase 3** | 嵌套 Loop + 并行 Worker + Helm UI 可视化 | Phase 2 | 禁用嵌套，串行执行 |

---

## 八、结论

Loop Engineering 的方向完全正确，是 FlowForge 从"Agent 编排框架"进化为"Agent 操作系统"的关键能力。但当前 loop.md 文档存在以下核心问题需要修订：

1. **架构定位不清**：Loop 应明确为 Harness 的子模块，而非独立层
2. **与现有组件的调用关系未定义**：LoopExecutor 与 HybridExecutor、Harness Hook、FeedbackLoop 的关系需要明确
3. **代码示例与现有接口不兼容**：5处接口调用与实际代码不符
4. **实现细节缺失**：LoopState、事件协议、API、DB Schema 均未定义
5. **文档结构混乱**：包含3个不同来源的内容，需重构

**建议**：在修订上述问题后，将 loop.md 升级为正式设计文档（与 arch.md/spec.md 同级），然后进入 Phase 1 实施。
