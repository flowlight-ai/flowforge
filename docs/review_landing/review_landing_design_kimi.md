# FlowForge 生态 landing_design.md 多维度专业审核意见

> 审核角色：AI智能体产品专家、AI高级架构师、AI智能体Agent开发工程师、高级软件全栈工程师
> 审核日期：2026-06-15
> 审核范围：flowforge/docs/landing_design.md、devforge/docs/landing_design.md、contentforge/docs/landing_design.md、novelforge/docs/landing_design.md
> 参考文档：hiclaw/prompts.md、各项目 landing_plan.md、flowforge/docs/task.md、devforge/docs/optimization_plan.md

---

## 一、总体评价

### 1.1 设计文档与代码的鸿沟

经过对4个项目 landing_design.md 的深度阅读，以及与 task.md（234项问题）、optimization_plan.md（65+ OpenCode模式）的交叉比对，我们发现一个**系统性风险**：

**设计文档版本（v1.0~v2.0）与代码版本（v0.1.0）存在严重落差**。具体表现为：

| 项目 | 设计文档版本 | 代码版本 | 差距程度 | 关键缺失 |
|------|:----------:|:------:|:-------:|---------|
| FlowForge | v6.0/v7.0 | v0.1.0 | 严重 | 77处硬编码提示词、10+存储模块直接SQL |
| DevForge | v2.0 | v0.1.0 | 严重 | 4种workflow模板未YAML化、14个Agent均为单次LLM调用 |
| ContentForge | v2.0 | v0.1.0 | 严重 | 24处硬编码提示词、AgenticRAG.search()为占位pass |
| NovelForge | v1.0 | v0.1.0 | 严重 | 8个Agent执行模式与设计文档严重不符 |

### 1.2 架构根基问题（P0级）

**问题 ARCH-ROOT-01：FlowForge 框架纯度不足**

FlowForge 作为"AI Agent 操作系统底座"，却包含了 **23处特定领域代码**（~1100行 + 5配置文件），包括 article_writing、topic_research、code_writer_agent 等内容创作和开发Agent。这些应迁移到对应的 *Forge 项目。

**审核意见**：
- 架构师视角：严重违反框架通用原则。底座应纯通用，*Forge 应轻量扩展。当前状态导致底座膨胀、扩展项目反而重复建设。
- 全栈工程师视角：23处领域代码导致 FlowForge 编译/部署时携带不必要的依赖，增加攻击面。
- **建议**：立即启动 ARCH-FF-01~23 迁移计划，在 Phase 0 完成迁移，而非等到 Phase 3（ECO-05）。

**问题 ARCH-ROOT-02：*Forge 重复服务代码严重**

| 项目 | 重复代码行数 | 主要重复模块 |
|------|:----------:|------------|
| ContentForge | ~2867行 | 独立编排器、DI容器、数据库层、LLM服务、SOP编排 |
| NovelForge | ~2027行 | 独立编排器、核心模块、数据库层、Deps组装 |
| DevForge | ~1877行 | 独立编排器、配置系统、数据库层、工作流执行器 |

**审核意见**：
- 产品专家视角：重复代码意味着3-4倍的维护成本，任何底座升级都需要在4个项目中同步修改。
- Agent开发工程师视角：各项目独立的编排器（orchestrator.py）导致 Agent 执行语义不一致，无法保证跨项目行为统一。
- **建议**：将通用逻辑下沉优先级从 Phase 3 提升到 Phase 1。先删除重复代码，再实现新功能。

---

## 二、FlowForge landing_design.md 专项评审

### 2.1 设计哲学：融合而非替换 —— 评审意见

文档提出"融合（Fusion）"哲学，在现有骨架中注入 OpenCode 模式。我们**部分赞同**这一方向，但存在关键风险：

**风险 FWK-RISK-01：渐进式迁移可能演变为永久双轨制**

文档中多次出现"向后兼容""过渡期保留""可选组件"等表述。考虑到当前代码 v0.1.0 与设计文档 v6.0/v7.0 的落差，渐进式迁移容易变成新旧两套体系长期并存。

**具体案例**：
- `WorkflowCompiler.to_sop_steps()` 是新增工具，"不替代手动方式"
- `ConditionalRouter` 为"独立组件"，不影响现有代码
- `PersonaInjector` "为可选功能"

**审核意见**：
- 架构师视角：配置驱动率目标是从 0% 提升到 ≥80%。如果所有新能力都是"可选"的，目标无法达成。**建议明确弃用时间表**：每个新增组件在下一个 minor 版本后，旧方式标记 deprecated，再下一个版本强制切换。
- 产品专家视角：缺乏强制的迁移节奏，团队很可能在旧方式上继续开发新功能，导致技术债务越滚越大。

### 2.2 FWK-01 Workflow YAML Compiler —— 评审意见

**设计亮点**：
- CompiledStep / CompiledWorkflow 的 DAG 抽象清晰，StepType 覆盖 SEQUENCE/CONDITIONAL/PARALLEL/FALLBACK/LOOP 五种类型
- 编译产物通过 `ctx.metadata["sop_steps"]` 注入现有 WorkflowExecutor，融合思路合理

**关键问题**：

**问题 FWK-01-A：编译器与执行器的契约未明确**

```python
# 当前设计
class WorkflowCompiler:
    def compile(self, yaml_config: Dict[str, Any]) -> CompiledWorkflow:
        # 编译为 CompiledWorkflow
        
    def to_sop_steps(self, workflow: CompiledWorkflow) -> List[Dict[str, Any]]:
        # 转换为 WorkflowExecutor 可消费的 sop_steps
```

审核意见：
- Agent开发工程师视角：`to_sop_steps()` 只是格式转换，没有解决 WorkflowExecutor 对条件路由、并行组、回退链的**运行时调度能力**。如果 WorkflowExecutor._execute_core() 本身不支持并行执行，编译产物中的 `parallel_group` 只会被当作普通步骤遍历。
- **建议**：必须在设计文档中明确 WorkflowExecutor 的运行时扩展方案，或声明 WorkflowExecutor 也需同步改造。

**问题 FWK-01-B：输入映射表达式过于简单**

```python
step.input_mapping = config.get("input_mapping")  # 简单的 Dict[str, str]
```

审核意见：
- 全栈工程师视角：实际 Workflow 中步骤间数据传递需要更复杂的转换（如数组映射、字段提取、条件赋值）。当前设计只支持简单的键值映射，可能导致大量场景仍需硬编码处理。
- **建议**：引入 Jinja2 或类似模板引擎作为输入映射的表达式语言，支持 `{{ outputs.requirements.requirements_doc | truncate(1000) }}` 等常用转换。

### 2.3 FWK-02 Conditional Router —— 评审意见

**问题 FWK-02-A：条件表达式解析器存在安全隐患**

```python
def _evaluate(self, condition: str, context: Any) -> Any:
    if ">" in condition:
        left, right = condition.split(">", 1)
        ...
```

审核意见：
- 架构师视角：当前实现是字符串拼接解析，没有使用安全的表达式引擎。虽然条件表达式看起来简单，但 `"value > 10 and malicious_code()"` 这样的输入可能被部分解析并产生意外行为。
- 安全专家视角：更严重的是，如果 condition 字符串来自用户输入（Workflow YAML 可能由用户上传），存在表达式注入风险。
- **建议**：使用 `asteval` 或类似安全表达式库，或限制为白名单表达式格式。

**问题 FWK-02-B：条件分支的默认回退策略不完整**

```python
def route(self, condition: str, branches: Dict[str, Any], context: Any, default: Optional[Any] = None) -> Any:
    result = self._evaluate(condition, context)
    if result in branches:
        return branches[result]
    if default is not None:
        return default
    for key, value in branches.items():
        if str(result) == str(key):
            return value
    return branches.get("default", default)
```

审核意见：
- Agent开发工程师视角：当 condition 求值结果为 None（如引用了不存在的上下文变量），当前逻辑会进入 `str(result) == str(key)` 的比较，即 `"None" == key`，这几乎不可能是预期行为。
- **建议**：显式处理 None 结果，增加 `strict_mode` 配置，在 None 时抛出明确异常或强制使用 default。

### 2.4 FWK-03 Fallback Chain —— 评审意见

**设计亮点**：
- FallbackResult 结构完整，包含 success/result/used_step/attempts/errors
- 与 HybridExecutor.run() 的融合点合理

**问题 FWK-03-A：成功判断逻辑过于简化**

```python
@staticmethod
def _is_success(result: Any) -> bool:
    if isinstance(result, dict):
        return not result.get("error") and result.get("status") != "failed"
    return True
```

审核意见：
- 全栈工程师视角：不同 Tool 的成功/失败语义不一致。例如 HTTP 工具可能返回 `{"status": 404, "error": "Not Found"}`，但某些场景下 404 是可接受的（如检查资源是否存在）。
- **建议**：支持 per-step 的 `success_condition` 配置，允许声明式定义成功条件（如 `status in [200, 404]`）。

### 2.5 FWK-06 Reflexion Loop ★重点 —— 评审意见

**设计亮点**：
- TurnTransition 控制流替代嵌套 if-else 的思路非常正确
- ContextEpoch 管理在多 Agent 切换时的上下文隔离设计合理

**问题 FWK-06-A：TurnTransition 设计过于抽象，缺少具体实现**

文档中只描述了概念：
> "引入 TurnTransition 后，每次迭代的结果决定下一次迭代的状态转换"

但没有给出 TurnTransition 的状态机定义、Transition 表、或具体的 Python 实现。

审核意见：
- Agent开发工程师视角：Reflexion Loop 是 FlowForge 的核心差异化能力，但当前设计停留在概念层。LoopExecutor._execute_iterations() 的实际代码复杂度很高（涉及 verdict、checkpoint、feedback、retry 等多个状态），没有具体的状态机设计，实现时很容易回到 if-else 的老路。
- **建议**：补充 TurnTransitionEngine 的完整状态机设计，包括：
  - 状态定义（Idle → Executing → Evaluating → Reflecting → Compacting → Completed/Failed）
  - Transition 条件表
  - 每个状态对应的上下文操作（ContextEpoch 切换、Compaction 触发时机）

**问题 FWK-06-B：MAX_STEPS 限制与现有 Loop 的兼容性未分析**

文档提到：
> "现有 LoopExecutor 没有 max_steps 限制（不像 OpenCode 的 25），需要添加"

审核意见：
- 架构师视角：添加 max_steps 是 breaking change。现有代码中可能有无意识依赖无限循环的逻辑（如等待外部事件的轮询）。
- **建议**：在 design 中增加兼容性分析章节，明确哪些现有 Loop 需要调整，以及调整方案。

---

## 三、DevForge landing_design.md 专项评审

### 3.1 总体架构 —— 评审意见

**设计亮点**：
- 架构边界图清晰，明确 FlowForge Framework 与 DevForge Plugin 的分界
- 删除清单总览（ARCH-DF-01~07）非常具体，有文件、行数、替代方案、Phase

**问题 DF-ARCH-01：删除清单的时间表过于乐观**

| 编号 | 文件 | 行数 | Phase |
|------|------|:----:|-------|
| ARCH-DF-01 | core/orchestrator.py | 477 | P0 |
| ARCH-DF-02 | core/config.py | ~100 | P1 |
| ARCH-DF-03 | memory/database.py + repository.py + audit_service.py | ~400 | P1 |
| ARCH-DF-04 | core/workflow_executor.py | ~300 | P0 |
| ARCH-DF-05 | core/gate_orchestrator.py + agent_guard.py | ~200 | P2→P3 |
| ARCH-DF-06 | core/models.py | ~100 | P0 |
| ARCH-DF-07 | api/routes.py + schemas.py + websocket.py | ~300 | P0 |

审核意见：
- 产品专家视角：ARCH-DF-05（GateOrchestrator）从 P2 推迟到 P3 不合理。GateOrchestrator 是 DevForge 的核心差异化能力，如果在 P2 才抽象为 FlowForge 通用机制，意味着 P0~P1 期间 DevForge 仍需维护独立的门禁编排逻辑，与"配置驱动、消除独立编排"的目标矛盾。
- **建议**：将 GateOrchestrator 的通用化提前到 P1，至少完成接口抽象和 FlowForge 侧的空壳实现，P2 填充具体逻辑。

### 3.2 DF-P0-01: 4种 Workflow YAML 模板 —— 评审意见

**设计亮点**：
- 4种模板覆盖 greenfield/feature/change/hotfix，与 IPD/DevOps/GitFlow 流程对齐
- Gate 配置维度、权重、阈值、veto_dimensions 设计完整

**问题 DF-P0-01-A：Workflow YAML 中变量引用语法不一致**

```yaml
# dev_greenfield.yaml 中的变量引用
input:
  task_description: "$task.description"
  project_context: "$project.context"
  requirements_doc: "$outputs.requirements.requirements_doc"

# 但有些地方又不用 $ 前缀
artifacts: { image_tag: "$build.image_tag" }
```

审核意见：
- 全栈工程师视角：`$outputs.requirements.requirements_doc` 与 `$outputs.requirements` 混用（有时用完整路径，有时用对象引用）。这会导致 StateParamMapper 解析时产生歧义。
- **建议**：统一变量引用语法规范，明确 `$outputs.xxx` 是引用对象还是引用字段。推荐采用 `${outputs.requirements.requirements_doc}` 的显式括号语法，避免歧义。

**问题 DF-P0-01-B：GateConfig 的 timeout_start_trigger 设计存在竞态条件**

```python
class GateConfig(BaseModel):
    timeout_start_trigger: str = Field(
        default="gate_start",
        pattern=r"^(gate_start|review_ready|first_evaluator_done)$"
    )
```

审核意见：
- Agent开发工程师视角：`review_ready` 和 `first_evaluator_done` 都需要外部事件触发计时器。在分布式或异步执行环境中，事件到达顺序可能不确定，导致超时计算不一致。
- **建议**：增加计时器同步机制设计，明确在事件丢失时的默认行为（是从 gate_start 补算，还是立即判定超时？）。

**问题 DF-P0-01-C：hotfix 模板的 auto_pass_on_timeout 为 true 存在安全风险**

```yaml
# dev_hotfix.yaml
- name: "dcp_1_review"
  gate_config:
    name: "DCP-1 发布决策（热修复）"
    pass_threshold: 0.30
    human_required: true
    auto_pass_on_timeout: true  # ⚠️
```

审核意见：
- 产品专家视角：热修复场景虽然要求速度，但 `auto_pass_on_timeout: true` 意味着如果人工审核者未及时响应，门禁自动通过。这在生产环境中极其危险。
- 安全专家视角：pass_threshold 只有 0.30，加上 auto_pass_on_timeout，实质上绕过了人工审核的安全底线。
- **建议**：
  - 删除 hotfix 模板的 `auto_pass_on_timeout: true`
  - 改为 `auto_pass_on_timeout: false` + `escalation_on_timeout: "oncall_manager"`
  - 或设置更短但明确的超时时间（如30分钟），超时后自动回滚而非自动通过

### 3.3 DF-P1-01: 金丝雀发布 —— 评审意见

**问题 DF-P1-01-A：金丝雀状态机设计缺少失败状态的持久化**

文档描述了金丝雀发布状态机（10% → 50% → 100%），但没有明确：
- 如果进程在 10%→50% 的观测期间崩溃，重启后如何恢复状态？
- 观测期间的 metrics 数据存储在哪里？

审核意见：
- 架构师视角：金丝雀发布是长流程（可能持续数小时），必须依赖 Session 持久化（INF-02）。但 design 中没有明确与 Session 持久化的集成点。
- **建议**：在金丝雀发布状态机的每个状态转换点增加 checkpoint 设计，明确哪些状态需要持久化、恢复时如何重建观测上下文。

### 3.4 DF-P2-01: 门禁三种投票策略 —— 评审意见

**设计亮点**：
- weighted / consensus / majority 三种策略覆盖不同决策场景

**问题 DF-P2-01-A：consensus 策略的定义不明确**

文档只列出了三种策略名称，但没有给出 consensus 的具体算法：
- 是全体一致（unanimous）？
- 还是超多数（supermajority，如 2/3）？
- veto_dimensions 在 consensus 下是否仍然生效？

审核意见：
- Agent开发工程师视角：consensus 在不同组织中有不同定义。设计文档的不明确会导致实现时的理解偏差。
- **建议**：补充每种策略的伪代码定义，特别是 consensus 的通过条件和 veto 处理逻辑。

---

## 四、ContentForge landing_design.md 专项评审

### 4.1 CF-P0-01: 6个专家Agent YAML 定义 —— 评审意见

**设计亮点**：
- Agent YAML Schema 完整，涵盖 execution_mode、tools、model_assignment、persona_inject、reflexion 等关键配置
- output_schema 使用 JSON Schema 风格，便于验证

**问题 CF-P0-01-A：model_assignment 的 fallback 机制与 FlowForge 的 LLM 路由层冲突**

```yaml
model_assignment:
  primary: openroute/Doubao-Seed2.0
  fallback: openroute/Qwen3.6-Plus
```

审核意见：
- 架构师视角：optimization_plan.md 中设计的 LLM 路由层（INF-01）采用 Protocol/Route/Provider 三层分离，新增 Provider 仅需 2 行配置。但 ContentForge 的 model_assignment 是硬编码的模型名称，两套路由机制并存会导致冲突。
- **建议**：
  - model_assignment 应引用 FlowForge LLM 路由层的 route 名称（如 `primary: creative_writing`），而非直接写 Provider 名称
  - fallback 逻辑应委托给 FlowForge 的 AgentFallbackChain（AGT-02），而非在 Agent YAML 中重复定义

**问题 CF-P0-01-B：persona_inject 的布尔标志过于简化**

```yaml
persona_inject:
  soul: true
  memory: true
  creation: true
```

审核意见：
- 产品专家视角：SOUL/MEMORY/CREATION 的注入不是简单的"开/关"。例如 MEMORY 可能包括"最近3篇文章的风格""用户历史偏好"等多个维度，不同 Agent 需要不同的 MEMORY 子集。
- **建议**：将 persona_inject 扩展为结构化配置，支持子维度选择和注入权重：
  ```yaml
  persona_inject:
    soul:
      enabled: true
      weight: 1.0
    memory:
      enabled: true
      recent_articles: 3
      user_preference: true
  ```

### 4.2 CF-P0-02: SOP Workflow YAML 定义 —— 评审意见

**问题 CF-P0-02-A：SOP Workflow 与 Agent YAML 的关联未明确**

文档分别定义了 Agent YAML（CF-P0-01）和 SOP Workflow YAML（CF-P0-02），但没有说明：
- SOP Workflow 如何引用 Agent YAML 中定义的 agent？
- 如果 Agent YAML 修改了 name，SOP Workflow 是否会自动同步？

审核意见：
- 全栈工程师视角：缺乏引用机制会导致配置冗余和不同步。例如 `cf_deep_article.yaml` 中可能再次定义 `agent: writer`，而不是引用 `writer_agent.yaml` 中已定义的 agent 配置。
- **建议**：引入 Agent 引用机制，如 `agent_ref: writer`，由编译器自动合并 Agent YAML 和 Workflow YAML 的配置。

### 4.3 CF-P1-05: AgenticRAG.search() —— 评审意见

**问题 CF-P1-05-A：设计与 task.md 的差距未修复**

task.md 明确指出：
> "AgenticRAG.search() 方法中核心多源检索逻辑仍为占位 pass，未真正实现多源检索链路"

但在 landing_design.md 中，CF-P1-05 的设计方案仍然停留在"实现步骤"层面：
1. 实现多源并行检索
2. 实现 RRF 融合排序
3. ...

审核意见：
- Agent开发工程师视角：设计文档应该给出具体的算法实现方案（如 RRF 的公式、SimHash 的阈值、时间衰减的 lambda 参数），而不是停留在步骤列表。
- **建议**：补充 AgenticRAG 的详细算法设计，包括：
  - 多源检索的并行策略（asyncio.gather 还是线程池？）
  - RRF 融合的具体公式和参数
  - SimHash 去重的汉明距离阈值
  - QueryUnderstanding 的查询改写模板

### 4.4 CF-P1-03: Playwright 多平台发布 —— 评审意见

**问题 CF-P1-03-A：平台适配层的可扩展性设计不足**

文档只列出了今日头条和微信公众号的发布方式，但没有给出可扩展的平台适配框架。

审核意见：
- 产品专家视角：ContentForge 的核心价值是"多平台发布"。如果每新增一个平台都需要修改核心代码，可扩展性不足。
- **建议**：设计声明式平台适配框架：
  ```yaml
  # platforms/jianshu.yaml
  name: jianshu
  adapter: playwright
  login:
    url: "https://www.jianshu.com/sign_in"
    selectors:
      username: "input[name='session[email]']"
      password: "input[name='session[password]']"
  publish:
    url: "https://www.jianshu.com/writer"
    content_input: "textarea#editor"
  ```

---

## 五、NovelForge landing_design.md 专项评审

### 5.1 NF-P0-01: 8个阶段Agent YAML 定义 —— 评审意见

**设计亮点**：
- 8个Agent的 YAML 定义非常详细，特别是 chapter_writing.yaml 的 soul_injection 和 context_injection 设计
- state_updates 字段明确标注了 Agent 输出如何更新全局状态

**问题 NF-P0-01-A：context_injection 的设计与 FlowForge 的 State Param Mapping 重复**

```yaml
context_injection:
  full_summary: "state._context.full_summary"
  volume_summary: "state._context.volume_summary"
  prev_summaries: "state._context.prev_summaries"
  last_chapter: "state._context.last_chapter"
  relevant_chunks: "state._context.relevant_chunks"
  world_state: "state.world_state"
```

审核意见：
- 架构师视角：NovelForge 的 context_injection 与 FlowForge FWK-04 State Param Mapping 解决的是同一问题——从 state 自动填充输入参数。两套机制并存会导致维护困难。
- **建议**：统一使用 FlowForge 的 State Param Mapping，NovelForge 的 Agent YAML 只需声明 `input_mapping`（与 DevForge 的 Workflow YAML 一致），由 FlowForge 的 StateParamMapper 统一处理。

**问题 NF-P0-01-B：handoffs 字段的设计未与 FlowForge 的 Agent 切换机制对接**

```yaml
# novel_concept.yaml
handoffs:
  - "market_analyst"
```

审核意见：
- Agent开发工程师视角：handoffs 表示 Agent 执行完成后可以交接给哪些 Agent，但 FlowForge 的 landing_design.md 中 FWK-06 已经设计了 AgentSwitchManager（AGT-08）。两套交接语义不一致。
- **建议**：统一使用 FlowForge 的 AgentSwitchManager 语义，将 handoffs 改为 `next_agents` 或 `switch_candidates`，并明确与 AgentSwitchManager.start_new() 的调用关系。

### 5.2 NF-P1-04: 五层上下文管理写入路径修复 —— 评审意见

**设计亮点**：
- L1~L5 的分层设计清晰，每层有明确的职责和修复方案

**问题 NF-P1-04-A：五层上下文的 Compaction 策略未设计**

NovelForge 是长流程（长篇小说可能持续数月），上下文长度管理至关重要。但设计文档只关注了"写入路径"，没有设计：
- L1 全文层的向量索引在章节数增长后的检索性能退化
- L2 章摘要层在章节数增长后的摘要聚合策略
- L4 全书摘要层的更新频率（每章都更新？还是每卷更新？）

审核意见：
- 架构师视角：optimization_plan.md 中的 INF-05 "增量摘要 Compaction" 设计了双阈值 + Overflow 恢复机制，但 NovelForge 的 design 中没有引用或适配这一机制。
- **建议**：
  - 明确 L4 全书摘要的更新触发条件（每卷完成 vs 每章完成）
  - 引入 Compaction 阈值：当 L1 向量索引超过 N 个 chunk 时触发重新分片
  - 明确 L2 章摘要的数量上限和滚动策略（保留最近50章？）

### 5.3 NF-P1-06: 盲评与仲裁机制修正 —— 评审意见

**设计亮点**：
- 明确了三个问题：盲评不严格、仲裁结果未覆盖、打回重写闭环缺失
- 每个问题都有具体的修正方案

**问题 NF-P1-06-A：独立 TaskContext 副本的实现成本被低估**

修正方案：
> "每个Reviewer使用独立的TaskContext副本"

审核意见：
- Agent开发工程师视角：TaskContext 包含 state、memory、history 等多个大型对象，创建三个完整副本的内存开销和序列化成本很高。如果 Reviewer 只是读取（不写入），浅拷贝可能导致数据泄露。
- **建议**：
  - 设计 TaskContext.isolation_copy() 方法，明确哪些字段需要深拷贝、哪些可以共享
  - 如果 Reviewer 只需要读取 state 的某个子集，设计 TaskContext.subset_view() 减少拷贝开销

### 5.4 NF-P2-02: 伏笔回收率追踪 —— 评审意见

**问题 NF-P2-02-A：伏笔注册的自动化程度未明确**

设计文档：
> "伏笔注册：写作时自动提取伏笔标记"

审核意见：
- 产品专家视角："自动提取"的实现方式不明确。是 Agent 在写作时主动标注？还是通过后处理正则匹配（如 `{{foreshadowing:id=123}}`）？
- **建议**：明确伏笔标记的语法规范，例如：
  ```markdown
  <!-- foreshadowing: id=f1, description="主角发现神秘钥匙", expected_chapter=15 -->
  主角在旧书店的角落里发现了一把锈迹斑斑的钥匙...
  <!-- /foreshadowing -->
  ```

---

## 六、跨项目一致性与协同评审

### 6.1 Agent YAML Schema 不一致

| 项目 | Agent 定义字段 | 模式字段 |
|------|-------------|---------|
| DevForge | `agent`、`mode`、`type`、`gate_config` | 无详细模式配置 |
| ContentForge | `execution_mode`、`default_mode`、`reflexion`、`rewoo` | `max_iterations`、`pass_threshold` |
| NovelForge | `mode`、`got`、`reflexion`、`plan_execute` | `max_rounds`、`max_branches` |

审核意见：
- 架构师视角：三个项目的 Agent YAML Schema 不统一，导致 FlowForge 的 Agent YAML Compiler 无法统一解析。
- **建议**：由 FlowForge 定义统一的 Agent YAML Schema（作为 FWK-09 的一部分），各项目在此基础上扩展项目特定字段。

统一 Schema 建议：
```yaml
# flowforge/schemas/agent.yaml
name: str
mode: str  # 统一为 mode，而非 execution_mode/default_mode 混用
tools: list[str]
model: str  # 引用 FlowForge 路由层 route 名
permissions: list[str]
max_steps: int

# 模式特定配置（由 ModeRegistry 验证）
mode_config:
  type: object  # 根据 mode 不同，结构不同
  # reflexion: { max_rounds, quality_threshold }
  # got: { max_branches, merge_strategy }
  # rewoo: { max_workers_parallel }

# 输入输出
input_mapping: dict[str, str]
output_schema: object
state_updates: dict[str, str]
```

### 6.2 Gate/Quality Gate 术语不统一

- DevForge 使用 "Gate"（DCP/TR）
- NovelForge 使用 "Quality Gate"（QG）
- ContentForge 没有明确的 Gate 设计（使用审核评分）

审核意见：
- 产品专家视角：三个项目的质量审核机制应该统一术语和抽象。
- **建议**：FlowForge 提供通用的 Gate 抽象（ScoringRubric + GateOrchestrator），三个项目统一使用。DevForge 的 DCP/TR 和 NovelForge 的 QG 都是 Gate 的实例化。

### 6.3 配置驱动率的度量标准不一致

landing_plan.md 提到：
> "Agent配置驱动率从0%提升到≥80%"

但各项目 design 中没有明确定义"配置驱动率"的计算方式：
- 是 YAML 行数 / 总代码行数？
- 还是可配置行为数 / 总行为数？

审核意见：
- 全栈工程师视角：没有明确的度量标准，目标无法验证。
- **建议**：定义配置驱动率的计算规则，例如：
  ```
  配置驱动率 = (通过 YAML 配置的行为数) / (总行为数)
  行为数 = Agent定义数 + Tool定义数 + Workflow步骤数 + Prompt模板数 + 阈值/规则数
  ```

---

## 七、与 task.md 问题清单的对齐分析

### 7.1 高优先级问题在设计文档中的覆盖度

| task.md 问题 | 严重等级 | 设计文档覆盖度 | 审核意见 |
|-------------|:-------:|:------------:|---------|
| BUG-PROMPT-01/02/03（硬编码提示词） | P0 | ⚠️ 部分覆盖 | 各项目 design 提到了"硬编码提示词外置"，但没有给出 PromptManager 的统一设计 |
| BUG-NF-01（Agent执行模式不符） | P0 | ❌ 未覆盖 | NovelForge design 的 YAML 定义了 mode，但没有解决"实际执行只是单次LLM调用"的问题 |
| BUG-CF-04（AgenticRAG为pass） | P1 | ⚠️ 部分覆盖 | CF-P1-05 有实现计划，但缺少详细算法设计 |
| BUG-CF-05（PublishAgent未集成） | P1 | ⚠️ 部分覆盖 | CF-P1-06 提到了集成，但没有解决 llm_client 参数缺失的具体方案 |
| BUG-NF-04（五层上下文缺失） | P1 | ✅ 已覆盖 | NF-P1-04 有详细的修复方案 |
| BUG-NF-08（盲评不严格） | P1 | ✅ 已覆盖 | NF-P1-06 有明确的三个问题和修正方案 |
| BUG-PUB-01（Plugin两套体系） | P1 | ❌ 未覆盖 | 各项目 design 都假设使用 FlowForge SDK，但没有解决旧体系清理问题 |

### 7.2 设计文档未覆盖的关键问题

**问题 REVIEW-01：PromptManager 的统一设计缺失**

task.md 指出三个项目共有 115 处硬编码提示词。但4个 landing_design.md 中：
- FlowForge：没有 PromptManager 的详细设计
- DevForge：没有提到提示词外置
- ContentForge：CF-P0-13 提到"硬编码提示词外置"，但没有具体方案
- NovelForge：NF-P0-09 提到"14处提示词外置到prompts.yaml"，但没有加载机制

**审核意见**：
- 建议 FlowForge 增加 FWK-PROMPT：PromptManager 的详细设计，包括：
  - 统一的 YAML Schema（支持变量插值、条件分支、多语言）
  - 热加载机制（修改 prompts.yaml 无需重启）
  - 版本管理（prompt 的 A/B 测试和回滚）
  - 缓存策略（避免每次从磁盘读取）

**问题 REVIEW-02：Plugin 体系清理方案缺失**

task.md 的 BUG-PUB-01 指出 ContentForge 存在两套 Plugin 体系（旧体系 `plugin.py` + 新体系 `plugins.py`），NovelForge 混用 SDK 方式和直接注册方式。

但各项目的 landing_design.md 都假设使用 FlowForge SDK 的新方式，没有设计旧体系的清理方案。

**审核意见**：
- 建议每个项目的 Phase 0 增加"旧体系清理"任务，明确：
  - 旧体系代码的删除时间表
  - 注册路径的统一验证方案
  - 兼容性过渡期（如保留旧 import 但抛出 DeprecationWarning）

---

## 八、与 optimization_plan.md 的适配分析

### 8.1 OpenCode 模式映射的完整性

optimization_plan.md 分析了 65+ OpenCode 模式，但各项目的 landing_design.md 只引用了其中一小部分：

| OpenCode 模式 | optimization_plan.md | FlowForge design | DevForge design | ContentForge design | NovelForge design |
|-------------|:------------------:|:--------------:|:-------------:|:-----------------:|:---------------:|
| AGT-01 Agent三模式 | ✅ | ❌ | ❌ | ❌ | ❌ |
| AGT-02 Agent回退链 | ✅ | ❌ | ❌ | ❌ | ❌ |
| AGT-03 Agent权限规则集 | ✅ | ❌ | ❌ | ❌ | ❌ |
| AGT-07 Agent步数限制 | ✅ | ❌ | ❌ | ❌ | ❌ |
| SES-01 Durable Prompt | ✅ | ❌ | ❌ | ❌ | ❌ |
| CTX-01 System Context代数 | ✅ | ❌ | ❌ | ❌ | ❌ |
| PER-01 Permission V2 | ✅ | ❌ | ❌ | ❌ | ❌ |

审核意见：
- 架构师视角：optimization_plan.md 是"知识输入"，landing_design.md 是"工程输出"。当前设计文档没有完全吸收 optimization_plan.md 的模式映射。
- **建议**：
  - FlowForge landing_design.md 增加一节"OpenCode 模式映射清单"，明确每个模式在设计中的落地位置
  - 各 *Forge 的 design 引用 FlowForge 的模式实现，而非重复设计

### 8.2 基础设施依赖的阻塞风险

各项目的 landing_design.md 都声明了 FlowForge 依赖，但没有评估阻塞风险：

| 依赖 | 阻塞项目 | 替代方案 | 风险评估 |
|------|---------|---------|---------|
| FWK-01 Workflow Compiler | 全部4个 | "先用现有Orchestrator过渡" | 高：过渡方案未设计，可能长期并行 |
| FWK-09 DeclarativeAgent | DevForge/NovelForge | "保留BaseAgent子类过渡" | 高：新旧Agent体系并存 |
| INF-02 Session持久化 | DevForge/NovelForge | 无 | 极高：长流程无法恢复 |

审核意见：
- 产品专家视角："过渡方案"不能只是口号。如果 Workflow Compiler 延期，DevForge 的 4 种 workflow YAML 模板无法执行，整个 Phase 0 失效。
- **建议**：
  - 每个"过渡方案"都必须有具体的实现设计（如 Python 编排如何与 YAML 定义双向同步）
  - 为每个 P0 依赖设置明确的交付 deadline 和 escalation 机制

---

## 九、关键风险与缓解措施

### 9.1 架构风险

| 风险 | 影响 | 当前设计缓解措施 | 审核建议 |
|------|------|---------------|---------|
| FlowForge 框架纯度不足 | 底座膨胀，扩展困难 | Phase 3 迁移 | 提前到 Phase 0，设置代码行数上限 |
| *Forge 重复代码 | 3-4倍维护成本 | Phase 3 下沉 | 提前到 Phase 1，先删后建 |
| 配置驱动率不达标 | 硬编码持续增加 | 目标80% | 定义度量标准，每迭代检查 |

### 9.2 实现风险

| 风险 | 影响 | 当前设计缓解措施 | 审核建议 |
|------|------|---------------|---------|
| Workflow Compiler 复杂度高 | Phase 0 延期 | "先实现核心子集" | 明确"核心子集"的范围和验收标准 |
| Agent 执行模式修正工作量大 | Phase 2 延期 | "按优先级分批" | 每批设置明确的 mode 验证测试 |
| 硬编码提示词 115 处 | 修改需重新部署 | "外置到 YAML" | 设计 PromptManager 统一方案 |

### 9.3 安全风险

| 风险 | 影响 | 当前设计缓解措施 | 审核建议 |
|------|------|---------------|---------|
| hotfix auto_pass_on_timeout | 生产事故 | 无 | 立即修改为 false |
| ConditionalRouter 表达式注入 | 远程代码执行 | 无 | 使用安全表达式引擎 |
| secret_key="changeme" | 密钥泄露 | 无 | 强制从环境变量读取 |

---

## 十、结论与建议

### 10.1 总体结论

4个项目的 landing_design.md 在**概念层面**是完整的，覆盖了配置驱动化、核心功能实现、能力升级、生态完善四个阶段。但在**工程层面**存在以下系统性问题：

1. **设计深度不足**：大量设计停留在"步骤列表"和"概念描述"，缺少具体的状态机、算法、接口契约
2. **跨项目一致性差**：Agent YAML Schema、Gate 抽象、变量引用语法等项目间不统一
3. **与代码现实脱节**：设计文档假设 FlowForge 框架能力已就绪，但 task.md 显示代码 v0.1.0 与框架能力差距严重
4. **风险缓解措施薄弱**：大量"过渡方案"没有具体设计，容易导致永久双轨制

### 10.2 优先级建议

**立即修改（本周内）**：
1. FlowForge landing_design.md：增加 PromptManager 统一设计（解决 115 处硬编码提示词）
2. DevForge landing_design.md：修改 hotfix 模板的 `auto_pass_on_timeout: false`
3. 所有项目 landing_design.md：统一 Agent YAML Schema，引用 FlowForge 标准

**短期修改（2周内）**：
4. FlowForge landing_design.md：补充 TurnTransitionEngine 的完整状态机设计
5. NovelForge landing_design.md：补充五层上下文的 Compaction 策略
6. ContentForge landing_design.md：补充 AgenticRAG 的详细算法设计
7. 所有项目 landing_design.md：增加 OpenCode 模式映射清单

**中期修改（1个月内）**：
8. 建立跨项目设计评审机制，确保 Schema、术语、抽象的统一
9. 定义配置驱动率的度量标准，每迭代检查
10. 为每个"过渡方案"设计具体的实现和弃用时间表

---

> 本审核意见基于对4个项目 docs/ 目录下设计文档的深度阅读，以及与 task.md、optimization_plan.md、landing_plan.md 的交叉比对。建议将本审核意见与各项目 landing_design.md 并行维护，每次 design 更新后进行复核。
