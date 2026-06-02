# FlowForge 测试用例专业审核报告 v2.0

> **审核日期**: 2026-05-24
> **审核角色**: 高级 AI Agent 测试工程师
> **审核范围**: `flowforge/docs/test.md` (v6.0)、`flowforge/tests/` 全量代码、`flowforge/workflows/` 全量 YAML、`flowforge/agents/` 全量 Agent 实现、`flowforge/modes/` 全量模式执行器
> **审核方法**: 逐文件代码审查 + 架构对照 + 执行路径追踪
> **审核结论**: 🔴 **v6.0 版本仍然不通过 —— 测试用例设计有结构性缺陷，未能基于真实代码链路设计预期过程**

---

## 零、代码深度审查发现的根因

### 根因 1: WorkflowExecutor 的 Agent 执行路径与预期严重不符

`WorkflowExecutor._execute_sop_steps()` 第 76-133 行的实际逻辑：

```python
# workflow.py L76-L83
agent_name = step.get("agent")
if agent_name and ctx.agents:
    agent = ctx.agents.get(agent_name)
    if agent:
        # ⚠️ 直接调用 agent.execute_with_context()，跳过 mode executor！
        agent_output = await agent.execute_with_context(agent_input, ctx)
```

**这意味着**: 虽然 YAML 中写了 `mode: "rewoo"`，但 WorkflowExecutor **并不使用 rewoo 模式执行器**。Agent 被直接调用，Agent 内部自己处理 LLM 调用和工具调用。模式执行器（ReWOOExecutor, ReflexionExecutor, ReActExecutor 等）仅在 **Solo 动态规划模式** (`_execute_intelligent_chat()`) 中才会被使用。

**后果**: v6.0 test.md 中大量预期"LLM × N"和"工具调用链"是基于模式执行器的假设，但实际执行链路是 Agent 内部逻辑，二者完全不同。

### 根因 2: topic_research Agent 的实际工具调用链

从代码阅读可知，`TopicResearchAgent.execute_with_context()` 的执行顺序是：
1. **cache** (缓存检查) → 2. **opensieve_search** (OpenSieve) → 3. **web_search** (Web搜索) → 4. **LLM** (生成选题)

这是一个降级链（fallback chain），不是并行调用。通常只有 1 个工具被实际执行（第一个成功的返回），LLM 只在所有工具都失败时才调用。

### 根因 3: content_audit Agent 不使用独立 Judge 模型

`ContentAuditAgent.execute_with_context()` 两次调用都是 `llm.execute()`，使用相同的 `persona` 参数。当前架构中 **没有实现评审使用不同模型的机制**。`agent_judge` 模式执行器 (`AgentJudgeExecutor`) 调用 `judge_actor` 和 `judge_evaluator` 两个 Agent，但在 Workflow 上下文中这个 executor 根本没被调用——WorkflowExecutor 直接调用 Agent。

### 根因 4: Reflexion 模式不在 Workflow 步骤中生效

`ReflexionExecutor._execute_core()` 包含 actor → evaluator → reflector 循环（最多 3 轮），但正如根因 1 所示，Workflow 步骤中的 `mode: "reflexion"` 不会被调用。`ArticleWritingAgent.execute_with_context()` 只做一次 LLM 调用就返回，没有 Reflexion 迭代。

### 根因 5: Solo UI 和 Workflow API 是两条完全不同的执行路径

- **Workflow API** (`POST /api/v1/tasks`): `_execute_sop_steps()` → Agent 直接调用
- **Solo UI** (WebSocket): `_execute_intelligent_chat()` → Planning LLM → 动态步骤执行 → Compile LLM

二者的 LLM 调用次数、工具链、事件序列完全不同。v6.0 test.md 把二者混为一谈。

---

## 一、修订后的致命缺陷总览（基于代码审查）

| # | 缺陷 | 严重度 | 根因 | 影响 |
|---|------|--------|------|------|
| 1 | **测试用例预期过程与实际 Agent 代码不符** | 🔴 致命 | 未阅读 Agent 源码 | 预期 LLM 次数/工具链全部错误 |
| 2 | **未区分 Workflow API 路径 vs Solo UI 路径** | 🔴 致命 | WorkflowExecutor 双路径架构 | 两种路径的事件序列、LLM 次数完全不同 |
| 3 | **全量 Mock LLM，零次真实 LLM 调用** | 🔴 致命 | conftest.py MockLLM | 上线必崩 |
| 4 | **8 个 Workflow 无一真实端到端验证** | 🔴 致命 | 无测试脚本 | Workflow 跑不通 |
| 5 | **API 测试只检查 status_code=200** | 🔴 致命 | test_api.py | 返回 200 但内容错误 |
| 6 | **无前端 Solo/WebSocket E2E** | 🔴 致命 | 无 Playwright 脚本 | 时间线渲染必有问题 |
| 7 | **零个测试运行指标** | 🔴 致命 | 无 metrics 记录 | 无法衡量质量 |
| 8 | **模型通道未区分测试** | 🔴 致命 | 配置未分区 | 模型改名后调用失败 |
| 9 | **content_audit 未使用独立 Judge 模型** | 🔴 致命 | Agent 代码硬编码 llm | 评审无意义 |
| 10 | **Reflexion 迭代在 Workflow 中不生效** | 🔴 严重 | WorkflowExecutor 跳过 mode | writing 无自我改进 |
| 11 | **无并发/Circuit Breaker/跨 Workflow 测试** | 🔴 严重 | 测试设计遗漏 | 生产稳定性风险 |

---

## 二、每条 Workflow 的真实执行路径（代码审查结果）

基于 Agent 源码分析，以下是 **Workflow API 路径** 的真实执行链路：

### WF1: deep_article (8 步)

| 阶段 | Agent | 实际 LLM 次数 | 实际工具调用链 | 实际输出 |
|------|-------|--------------|-------------|---------|
| 1 topic_research | TopicResearchAgent | 0~1 (前三步命中则不调用LLM) | opensieve_search × 0~1 → web_search × 0~1 | `{"topics": [{title, angle, url}]}` |
| 2 material_collection | MaterialCollectionAgent | 2~4 (搜索回退1~2 + 摘要1) | opensieve_search × N + web_search × M | `{"materials": [{title, content, url, source_type}]}` |
| 3 writing | ArticleWritingAgent | 1 (无Reflexion迭代!) | 无工具调用 | `{"output": draft_str, "draft": draft_str}` |
| 4 seo_opt | SEOOptimizationAgent | 2 (planning + optimize) | 无工具调用 | `{"optimized_draft": str, "seo_title": str}` |
| 5 fact_check | FactCheckAgent | 1 (事实核查) | httpx HEAD × N URLs | `{"issues": [str], "is_clean": bool}` |
| 6 audit | ContentAuditAgent | 2 (assess + compliance) | 无工具调用 | `{"score": float, "is_clean": bool}` |
| 7 review | human pause | - | - | 暂停等待 |
| 8 publish | PublishingAgent | 0 | publish_local × N | `{"published": {platform: url}}` |

**关键发现**:
- writing 阶段 **没有 Reflexion 迭代**，v6.0 test.md 预期 1+N 次 LLM 是错误的
- topic_research 大多数情况下 **只有 1 个工具调用**（opensieve 成功即返回）
- content_audit **使用同一个 LLM 模型**，没有独立 Judge

### WF2: quick_post (3 步)

| 阶段 | Agent | 实际 LLM 次数 | 实际工具调用链 |
|------|-------|-------------|-------------|
| 1 topic_research | TopicResearchAgent | 0~1 | opensieve_search / web_search |
| 2 writing | ArticleWritingAgent | 1 | 无 |
| 3 publish | PublishingAgent | 0 | publish_local |

### WF3: trend_article (4 步)

| 阶段 | Agent | 实际 LLM 次数 | 实际工具调用链 |
|------|-------|-------------|-------------|
| 1 trend_analysis | TrendAnalysisAgent | 2~3 (采集回退1 + 分析1 + 报告1) | web_search × 1 |
| 2 topic_research | TopicResearchAgent | 0~1 | opensieve_search / web_search |
| 3 writing | ArticleWritingAgent | 1 | 无 |
| 4 publish | PublishingAgent | 0 | publish_local |

### WF4: seo_content (6 步)

| 阶段 | Agent | 实际 LLM 次数 | 实际工具调用链 |
|------|-------|-------------|-------------|
| 1 topic_research | TopicResearchAgent | 0~1 | opensieve_search / web_search |
| 2 seo_optimization | SEOOptimizationAgent | 2 | 无 |
| 3 material_collection | MaterialCollectionAgent | 2~4 | opensieve_search + web_search |
| 4 writing | ArticleWritingAgent | 1 | 无 |
| 5 fact_check | FactCheckAgent | 1 | httpx HEAD |
| 6 publish | PublishingAgent | 0 | publish_local |

### WF5: report_generation (8 步 + 并行)

| 阶段 | Agent | 实际 LLM 次数 | 实际工具调用链 |
|------|-------|-------------|-------------|
| 1 topic_research | TopicResearchAgent | 0~1 | opensieve_search / web_search |
| 2 parallel: research_1 | MaterialCollectionAgent | 2~4 | opensieve_search + web_search |
| 2 parallel: research_2 | MaterialCollectionAgent | 2~4 | opensieve_search + web_search |
| 3 writing | ArticleWritingAgent | 1 | 无 |
| 4 seo_optimization | SEOOptimizationAgent | 2 | 无 |
| 5 fact_check | FactCheckAgent | 1 | httpx HEAD |
| 6 content_audit | ContentAuditAgent | 2 | 无 |
| 7 review | human pause | - | 暂停 |
| 8 publish | PublishingAgent | 0 | publish_local |

### WF6: multilingual (5 步)

| 阶段 | Agent | 实际 LLM 次数 | 实际工具调用链 |
|------|-------|-------------|-------------|
| 1 topic_research | TopicResearchAgent | 0~1 | opensieve_search / web_search |
| 2 material_collection | MaterialCollectionAgent | 2~4 | opensieve_search + web_search |
| 3 writing | ArticleWritingAgent | 1 | 无 |
| 4 translation | MultilingualAgent | 3 (detect + translate + verify) | 无 |
| 5 publish | PublishingAgent | 0 | publish_local |

### WF7: multi_platform (4 步)

| 阶段 | Agent | 实际 LLM 次数 | 实际工具调用链 |
|------|-------|-------------|-------------|
| 1 topic_research | TopicResearchAgent | 0~1 | opensieve_search / web_search |
| 2 writing | ArticleWritingAgent | 1 | 无 |
| 3 repurpose | ContentRepurposerAgent | 1 + N_platforms (analyze + per-platform rewrite) | 无 |
| 4 publish | PublishingAgent | 0 | publish_local |

### WF8: image_article (5 步)

| 阶段 | Agent | 实际 LLM 次数 | 实际工具调用链 |
|------|-------|-------------|-------------|
| 1 topic_research | TopicResearchAgent | 0~1 | opensieve_search / web_search |
| 2 material_collection | MaterialCollectionAgent | 2~4 | opensieve_search + web_search |
| 3 writing | ArticleWritingAgent | 1 | 无 |
| 4 image_research | ImageResearchAgent | 1~2 (筛选) | pexels_image / web_search |
| 5 publish | PublishingAgent | 0 | publish_local |

---

## 三、Solo UI 路径执行分析

Solo UI 通过 WebSocket 触发，走 `_execute_intelligent_chat()`。

**标准多步骤 Solo 执行（非 workflow YAML）**:
```
Stage 1: Planning (LLM × 1) — 意图识别
  → 输出: {"intent_type": "write", "plan": [{name, type, tool/agent}, ...]}
Stage 2: Execute Steps (LLM × 1~N + Tool × M)
  → 每个 step 按 type 执行: tool / agent / generate
Stage 3: Compile (LLM × 1) — 整理输出
  → 综合所有步骤结果生成最终回复
Stage 4: Save (file I/O) — 保存文件（仅长内容）
```

**最少 LLM 调用**: Planning(1) + 无步骤时 Simple Response(1) = **2 次**
**典型写文章**: Planning(1) + WebSearch Tool + Write Agent + Compile(1) = **3~5 次 LLM**
**简单消息 Fast-path**: Response(1) = **1 次 LLM**

---

## 四、发现的架构问题

### 问题 A: Workflow 步骤的 mode 字段形同虚设

YAML 中声明 `mode: "rewoo"` 但在 Workflow API 路径中完全不被使用。这导致：
- 测试预期（基于 mode name）与实际执行（基于 Agent 代码）脱节
- Reflexion 迭代在 workflow 中不生效
- Agent-as-Judge 在 workflow 中不生效

**建议修复**: 要么让 WorkflowExecutor 在无 agent 但有 mode 时使用 mode executor，要么为了灵活性保留当前设计但文档化清晰说明。

### 问题 B: content_audit 无法使用独立模型

当前 `ContentAuditAgent` 硬编码使用 `llm` 工具，没有参数指定使用不同的模型。需要支持 `judge_model` 参数传递。

### 问题 C: Solo UI 和 Workflow API 的事件序列完全不同

前端时间线渲染依赖 WebSocket 事件。Solo 路径发出 `workflow.step.start/complete`、`tool.start/end`、`step.intermediate` 事件，而 Workflow API 路径发出 Agent 内部的 `topic_research.*`、`material_collection.*` 等自定义事件。前端需要同时处理两种事件格式。

---

## 五、测试质量评分（修订）

| 维度 | v6.0 评分 | 修订后评分 | 说明 |
|------|----------|----------|------|
| 用例覆盖度 | 2/10 → | **3/10** | 8 个 Workflow 设计了用例但预期过程错误 |
| 数据真实性 | 1/10 → | **1/10** | 仍然全 Mock，无真实 LLM |
| 验证深度 | 2/10 → | **1/10** | 预期过程基于错误假设（mode executor vs Agent 直接调用） |
| 前端覆盖 | 0/10 → | **0/10** | 无 Playwright 脚本 |
| 指标记录 | 1/10 → | **2/10** | 有 JSON 模板但未基于实际 Agent 代码设计 |
| 模型兼容性 | 1/10 → | **1/10** | 未解决模型通道问题 |
| 预期设计 | 0/10 → | **0/10** | v6.0 预期过程与 Agent 源码严重不符 |
| 架构理解 | - → | **0/10** | 未区分 Workflow API 路径和 Solo UI 路径 |
| **综合** | **1/10** → | **1/10** | **测试用例设计必须先基于代码审查，再写预期过程** |

---

## 六、修复方案

### Phase 1: 代码修复（测试前必须先修）

1. **模型通道修复**
   - 确认 `doubao-web/chat` 模型名（非 `seed-2.0`）
   - 确认 OpenRoute API 可用性
   - 不可用模型在 `models.yaml` 中设置 `enabled: false`

2. **content_audit 支持独立 Judge 模型**
   - Agent 接收 `judge_model` 参数
   - LLM 调用时传递 `model` 参数

3. **WorkflowExecutor 支持 mode executor 回退**
   - 当步骤有 mode 但无 agent 时，使用 mode executor

### Phase 2: 测试用例重设计（基于代码审查）

每个测试用例的预期过程必须 **直接引用 Agent 源码中的 EventBus emit 事件序列**。

---

> **审核人**: AI 高级 Agent 测试工程师
> **审核日期**: 2026-05-24
> **核心结论**: v6.0 test.md 的测试用例预期过程是基于"模式执行器在 Workflow 中生效"的错误假设设计的。实际代码中 WorkflowExecutor 跳过 mode executor，直接调用 Agent。必须基于 Agent 源码重写所有预期过程。