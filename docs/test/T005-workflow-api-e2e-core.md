# T005: Workflow API 路径分析 + IT-WF-API-01~04（deep_article / quick_post / trend_article / seo_content）

> **状态**: ✅ done
> **创建日期**: 2026-07-19
> **负责人**: 测试员可进化智能体（蜜獾·平头哥）
> **测试类别**: E2E 测试（Workflow API 路径）
> **关联 spec.md**: [doc:../spec.md]（FR-CAP-06 #1/#2/#3/#5）
> **关联 arch.md**: [doc:../arch.md]（§6.5 Workflow #1/#2/#3/#5）
> **关联 design.md**: [doc:../design.md]（§9.1）
> **测试铁律**: 已应用 T1-T8（详见 [doc:rules.md#T1-T8]）
> **命名规范**: 已应用 v2.0（详见 [doc:design/naming-contract.md]）

---

## 1. 两条执行路径分析

### 1.1 路径对比

| 维度 | Workflow API 路径 | Helm UI 路径 |
|------|------------------|-------------|
| **入口** | `POST /api/v1/tasks` | WebSocket 对话框 |
| **核心方法** | `_execute_sop_steps()` | `_execute_intelligent_chat()` |
| **步骤来源** | Workflow YAML 定义 | LLM 动态规划 |
| **Agent 调用方式** | `agent.execute_with_context()` | `_execute_tool_or_agent()` |
| **模式执行器** | ⚠️ 不使用（有 agent 时跳过） | ✅ 使用（ReAct/Reflexion/PlanExecute） |
| **Reflexion 迭代** | ❌ 不生效 | ✅ 生效（通过模式执行器） |
| **事件格式** | Agent 内部事件 `topic_research.*` | 动态规划事件 `workflow.step.start` |
| **LLM 调用次数** | 基于 Agent 内部逻辑 | 基于 Planning + Steps + Compile |
| **审核方式** | `POST /review` | Helm 前端内联审核 |
| **典型 LLM 次数** | deep_article: 8~11 | deep_article: 3~4 |

### 1.2 WorkflowExecutor 的 Agent 执行路径

`WorkflowExecutor._execute_sop_steps()` 的实际逻辑：

```python
# workflow.py L76-L83
agent_name = step.get("agent")
if agent_name and ctx.agents:
    agent = ctx.agents.get(agent_name)
    if agent:
        # ⚠️ 直接调用 agent.execute_with_context()，跳过 mode executor！
        agent_output = await agent.execute_with_context(agent_input, ctx)
```

**这意味着**: 虽然 YAML 中写了 `mode: "rewoo"`，但 WorkflowExecutor **并不使用 rewoo 模式执行器**。Agent 被直接调用，Agent 内部自己处理 LLM 调用和工具调用。

### 1.3 Helm UI 动态规划路径

```
Stage 1: Planning (LLM × 1) — 意图识别
  → 输出: {"intent_type": "write", "plan": [{name, type, tool/agent}, ...]}
Stage 2: Execute Steps (LLM × 1~N + Tool × M)
  → 每个 step 按 type 执行: tool / agent / generate
Stage 3: Compile (LLM × 1) — 整理输出
Stage 4: Save (file I/O) — 保存文件（仅长内容）
```

---

## 2. 模型配置与前置验证

**执行前必须验证**：
1. `models.yaml` 中 `doubao-web/chat` 已替代 `doubao-web/seed-2.0`
2. `GET http://localhost:13000/v1/models`（超时 10s）验证模型列表
3. `POST http://localhost:13000/v1/chat/completions`（model=doubao-web/chat）验证可调用

**模型分配总表**：

| 档位 | 模型 | 用途 |
|------|------|------|
| default | `openroute/auto` | 执行模型（planning + agent 执行） |
| lightweight | `openroute/doubao-web/chat` | 评审模型（content_audit）+ 简单任务 |
| coding | `arkcode/ark-code-latest` | 代码生成任务 |

```
执行模型: openroute/auto
评审模型: openroute/doubao-web/chat (必须不同！) ⚠️ 需代码修复前置条件
编码模型: arkcode/ark-code-latest
网页版模型: doubao-web/chat (非 seed-2.0)
备用通道: openroute-api
```

**执行前必须验证模型可用性**：
- `doubao-web/chat` — 确认模型名已从 seed-2.0 更新
- `openroute-api` — API-only 验证通过后作为备用通道
- 不通过的模型：API 版设置 `enabled: false`，网页版修正 Prompt 约束

---

## 3. IT-WF-API-01：深度长文 Workflow（deep_article）— 8 步 API 路径

**需求依据**：spec.md FR-CAP-06 #1；arch.md 6.5 Workflow #1；design.md 9.1

**输入数据**：

```json
{
  "workflow": "deep_article",
  "persona": "tech_blog",
  "task": "帮我写一篇关于 2026 年 AI Agent 发展趋势的深度分析文章，面向技术从业者，3000 字以上",
  "platforms": ["local"],
  "auto_approve_review": true
}
```

**预期执行过程**（基于 Agent 源码，⚠️ 非模式执行器假设）：

| 阶段 | Agent | WorkflowExecutor 行为 | Agent 内部步骤 | LLM 次数 | 工具调用 | EventBus 事件（关键） |
|------|-------|---------------------|---------------|---------|---------|---------------------|
| 1 topic_research | TopicResearchAgent | 直接调用 agent.execute_with_context() | cache→adapter_search→web_search→LLM(回退) | **0~1** | adapter_search×0~1, web_search×0~1 | `topic_research.adapter_search_start/complete`, `topic_research.complete` |
| 2 material_collection | MaterialCollectionAgent | 直接调用 agent.execute_with_context() | cache_check(adapter)→web_search→llm_summarize | **2~4** | adapter_search×N, web_search×M | `material_collection.cache_check_start/complete`, `material_collection.web_search_start/complete`, `material_collection.llm_summarize_start/complete`, `material_collection.complete` |
| 3 writing | ArticleWritingAgent | 直接调用 agent.execute_with_context() | LLM generate | **1** | 无 | `article_writing.generation_start`, `article_writing.complete` |
| 4 seo_opt | SEOOptimizationAgent | 直接调用 agent.execute_with_context() | planning→optimize | **2** | 无 | `seo_optimization.planning_start/complete`, `seo_optimization.optimize_start/complete` |
| 5 fact_check | FactCheckAgent | 直接调用 agent.execute_with_context() | url_check→fact_verify | **1** | httpx HEAD×N（URL 可访问性验证） | `fact_check.url_check_start/complete`, `fact_check.fact_verify_start/complete`, `fact_check.complete` |
| 6 audit | ContentAuditAgent | 直接调用 agent.execute_with_context() | assess→compliance | **2** | 无 | `content_audit.assess_start/complete`, `content_audit.compliance_start/complete`, `content_audit.complete` |
| 7 review | (human) | `_pause_for_review()` | 暂停 (auto_approve_review=true 跳过) | **0** | 无 | `review.ready` |
| 8 publish | PublishingAgent | 直接调用 agent.execute_with_context() | publish per platform | **0** | publish_local×1 | `publishing.platform_done`, `publishing.complete` |

**汇总**：总 LLM 调用 **8~11 次**

**关键模型分配**：

| 阶段 | 执行模型 | 说明 |
|------|---------|------|
| 1~5 | `openroute/auto` | 执行模型 |
| 6 content_audit | `openroute/doubao-web/chat` | ⚠️ **评审模型 ≠ 执行模型**（需代码修复前置条件） |
| 7 | — | 人工审核 |
| 8 | `openroute/auto` | 执行模型 |

**通过条件**：

1. ✅ 8 个阶段按 `topic_research→material_collection→writing→seo_opt→fact_check→audit→review→publish` 顺序执行
2. ✅ 阶段 1 topic_research 输出 `topics` 数组，至少 1 个元素含 `title` 和 `url`
3. ✅ 阶段 2 material_collection 输出 `materials` 数组，至少 1 个元素含 `content`
4. ✅ 阶段 3 writing 输出 `draft` 字段，长度 ≥ 500 字符
5. ✅ 阶段 4 seo_opt 输出 `seo_title` 字段
6. ✅ 阶段 5 fact_check 输出 `is_clean` 和 `issues` 字段
7. ✅ 阶段 6 audit 输出 `score` (float) 和 `is_clean` (bool)
8. ✅ 阶段 6 audit 使用的 LLM 模型 ≠ 阶段 1-5 使用的 LLM 模型（⚠️ 需代码修复前置条件）
9. ✅ 阶段 8 publish 输出 `published` 字典，含已发布平台
10. ✅ 总耗时 < 300s

**调用路径验证**：

| 阶段 | 预期调用路径 | 验证方法 |
|------|-------------|---------|
| topic_research | cache_check → (miss) → adapter_search → (miss) → web_search → (success) → llm_summarize(可选) | 检查 tool.start 事件序列 |
| material_collection | cache_check → (miss) → web_search → llm_summarize | 检查 tool.start 事件序列 |
| writing | llm.generate(draft) | 检查 llm.start 事件的 prompt 包含写作指令 |
| seo_opt | llm.planning → llm.optimize | 检查两次 llm.start 事件 |
| fact_check | httpx HEAD × N（URL 验证） | 检查 tool.start 事件中 tool_name |
| audit | llm.assess → llm.compliance | 检查两次 llm.start 事件的 model 字段（⚠️ B1: 需代码修复后验证模型不同） |
| review | (human) | 检查 review.ready 事件 |
| publish | publish_local × 1 | 检查 tool.start 事件 |

**预期输出结构**：
```json
{
  "topics": {"type": "list", "min_count": 2, "item": {"title": "str", "keywords": "list[str]", "angle": "str"}},
  "materials": {"type": "list", "min_count": 3},
  "draft": {"type": "str", "min_length": 500},
  "seo_title": {"type": "str", "min_length": 10},
  "fact_check_result": {"type": "object", "required": ["verified", "unverified", "corrections"]},
  "score": {"type": "float", "range": [0, 1.0]},
  "is_clean": {"type": "bool"},
  "published": {"type": "dict"}
}
```

**指标记录**：

| 指标 | 预期值 | 实际值 | 状态 |
|------|--------|--------|------|
| 总 LLM 调用次数 | 8~11 | _ | _ |
| 总工具调用次数 | ≥ 3 | _ | _ |
| 总耗时 | < 300s | _ | _ |
| Memory 查询次数 | ≥ 6（每个 Agent 至少 1 次） | _ | _ |
| Memory 写入次数 | ≥ 6（每个 Agent 完成后写入） | _ | _ |
| 缓存命中率 | > 0（第二次执行时） | _ | _ |
| Reflexion 迭代次数 | N/A (Workflow API 路径不适用) | _ | _ |
| Judge Agent 模型名 | ≠ openroute/auto (需代码修复) | _ | _ |
| WebSocket 事件数 | N/A (API 路径无 Helm 事件) | _ | _ |
| 前端时间线节点数 | N/A (API 路径) | _ | _ |

**失败处理**：

- 若模型不可用：跳过该通道，标记为 SKIP，在报告中说明
- 若工具调用失败：记录失败原因，检查重试逻辑是否触发（L1 超时/L3 自修正）
- 若 LLM 输出格式不符：检查 Prompt 是否需要调整，记录到 prompt_issues.md
- 若 Agent 跳过工具直接回答：记录为 P2 Bug（调用链路验证失败）
- 若 content_audit 使用相同模型：记录为 P0 Bug（需代码修复）

---

## 4. IT-WF-API-02：快速发文 Workflow（quick_post）— 3 步 API 路径

**需求依据**：spec.md FR-CAP-06 #2；arch.md 6.5 Workflow #2

**输入数据**：

```json
{"workflow": "quick_post", "persona": "news_flash", "task": "写一篇关于 GPT-5 最新发布消息的速报"}
```

**预期执行过程**（基于 Agent 源码）：

| 阶段 | Agent | Agent 内部步骤 | LLM 次数 | 工具调用 |
|------|-------|---------------|---------|---------|
| 1 topic_research | TopicResearchAgent | cache→adapter→web_search→LLM | **0~1** | adapter×1 or web_search×1 |
| 2 writing | ArticleWritingAgent | LLM generate | **1** | 无 |
| 3 publish | PublishingAgent | publish per platform | **0** | publish_local×1 |

**汇总**：总 LLM 调用 **1~2 次**

**关键模型分配**：

| 阶段 | 执行模型 |
|------|---------|
| 1 | `openroute/auto` |
| 2 | `openroute/auto` |
| 3 | `openroute/doubao-web/chat`（lightweight 档位） |

**通过条件**：

1. ✅ 3 个阶段顺序执行
2. ✅ 不包含 seo_optimization、fact_check、content_audit 步骤
3. ✅ writing 输出 draft 长度 ≥ 200 字符
4. ✅ publish 输出 published 字典
5. ✅ 总耗时 < 60s

**指标记录**：

| 指标 | 预期值 | 实际值 | 状态 |
|------|--------|--------|------|
| 总 LLM 调用次数 | 1~2 | _ | _ |
| 总工具调用次数 | 1~2 | _ | _ |
| 总耗时 | < 60s | _ | _ |
| Memory 查询次数 | ≥ 1 | _ | _ |
| Reflexion 迭代次数 | N/A (Workflow API 路径不适用) | _ | _ |
| workflow.step.start 事件数 | = 3 | _ | _ |

**失败处理**：

- 若模型不可用：跳过该通道，标记为 SKIP
- 若 writing 阶段输出过短：检查 Prompt，记录到 prompt_issues.md
- 若 topic_research 未调用任何工具：记录为 P2 Bug

**调用路径验证**：

| 阶段 | 预期调用路径 | 验证方法 |
|------|-------------|---------|
| topic_research | cache → (miss) → web_search → (success) → llm(可选) | 检查 tool.start 事件序列 |
| writing | llm.generate(draft) | 检查 llm.start 事件的 prompt 包含写作指令 |
| publish | publish_local × 1 | 检查 tool.start 事件 |

**预期输出结构**：
```json
{
  "topics": {"type": "list"},
  "draft": {"type": "str", "min_length": 200},
  "published": {"type": "dict"}
}
```

---

## 5. IT-WF-API-03：热点追踪 Workflow（trend_article）— 4 步 API 路径

**需求依据**：spec.md FR-CAP-06 #3；arch.md 6.5 Workflow #3；spec.md 5.2"热点追踪创作"

**输入数据**：

```json
{"workflow": "trend_article", "persona": "trend_watcher", "task": "追踪本周 AI 领域最新热点并撰写文章", "domain": "AI"}
```

**预期执行过程**（基于 Agent 源码）：

| 阶段 | Agent | Agent 内部步骤 | LLM 次数 | 工具调用 | 特别关注 |
|------|-------|---------------|---------|---------|---------|
| 1 trend_analysis | TrendAnalysisAgent | collect_data→analyze_trends→generate_report | **2~3** | web_search×1 | **热点数据是否真实（非编造），可通过搜索验证** |
| 2 topic_research | TopicResearchAgent | cache→adapter→web_search→LLM | **0~1** | adapter×1 or web_search×1 | 选题是否基于阶段 1 的真实热点 |
| 3 writing | ArticleWritingAgent | LLM generate | **1** | 无 | 文章是否引用趋势数据 |
| 4 publish | PublishingAgent | publish per platform | **0** | publish_local×1 | — |

**汇总**：总 LLM 调用 **3~5 次**

**关键模型分配**：

| 阶段 | 执行模型 |
|------|---------|
| 1 | `openroute/auto`（需要多步推理） |
| 2 | `openroute/auto` |
| 3 | `openroute/auto` |
| 4 | `openroute/doubao-web/chat` |

**通过条件**：

1. ✅ 第一步必须是 `trend_analysis`（先分析趋势再选题）
2. ✅ **必须调用 web_search 获取实时热点**（否则是 Bug——热点追踪不搜索）
3. ✅ web_search 必须成功返回结果（不能降级到 LLM 编造热点）
4. ✅ 验证 web_search 被调用
5. ✅ 验证 trends 中至少 50% 的条目含非空 url（证明数据来自搜索而非编造）
6. ✅ 如果 raw_items 中 url 字段全为空，则判定为走了 LLM fallback 路径，标记为 WARN
7. ✅ trends 数组至少含 3 条热点
8. ✅ 热点数据可通过搜索引擎验证时效性（非 LLM 编造）
9. ✅ article_writing 引用了阶段 1 的趋势数据

**指标记录**：

| 指标 | 预期值 | 实际值 | 状态 |
|------|--------|--------|------|
| 总 LLM 调用次数 | 3~5 | _ | _ |
| 总工具调用次数 | 2~3 | _ | _ |
| trend_analysis LLM 次数 | 2~3 | _ | _ |
| web_search 调用次数 | ≥ 1 | _ | _ |
| 热点条数 | ≥ 3 | _ | _ |

**失败处理**：

- 若 trend_analysis 未调用 web_search：记录为 P0 Bug（热点追踪不搜索）
- 若热点数据为 LLM 编造：记录为 P1 Bug（需验证时效性）
- 若 article_writing 未引用趋势数据：记录为 P2 Bug

**调用路径验证**：

| 阶段 | 预期调用路径 | 验证方法 |
|------|-------------|---------|
| trend_analysis | web_search → llm.analyze → llm.report | 检查 tool.start+llm.start 事件序列 |
| topic_research | cache → (miss) → web_search → (success) → llm(可选) | 检查 tool.start 事件序列 |
| writing | llm.generate(draft) | 检查 llm.start 事件的 prompt 包含写作指令 |
| publish | publish_local × 1 | 检查 tool.start 事件 |

**预期输出结构**：
```json
{
  "trends": {"type": "list", "min_count": 3, "item": {"title": "str", "heat": "str", "url": "str"}},
  "topics": {"type": "list"},
  "draft": {"type": "str", "min_length": 500},
  "published": {"type": "dict"}
}
```

---

## 6. IT-WF-API-04：SEO 内容 Workflow（seo_content）— 6 步 API 路径

**需求依据**：spec.md FR-CAP-06 #5；arch.md 6.5 Workflow #5

**输入数据**：

```json
{"workflow": "seo_content", "persona": "seo_writer", "task": "针对关键词 'Python 异步编程最佳实践' 生成一篇 SEO 优化的文章"}
```

**预期执行过程**（基于 Agent 源码）：

| 阶段 | Agent | Agent 内部步骤 | LLM 次数 | 工具调用 | 输出验证 |
|------|-------|---------------|---------|---------|---------|
| 1 topic_research | TopicResearchAgent | 降级链 | **0~1** | adapter×1 or web_search×1 | topics |
| 2 seo_optimization | SEOOptimizationAgent | planning→optimize | **2** | 无 | seo_keywords 含搜索量/竞争度 |
| 3 material_collection | MaterialCollectionAgent | cache→web_search→llm_summarize | **2~4** | adapter×N + web_search×M | materials |
| 4 writing | ArticleWritingAgent | LLM generate | **1** | 无 | draft 含关键词密度检查 |
| 5 fact_check | FactCheckAgent | url_check→fact_verify | **1** | httpx HEAD×N（URL 可访问性验证） | fact_check_result |
| 6 publish | PublishingAgent | publish per platform | **0** | publish_local×1 | published_urls |

**汇总**：总 LLM 调用 **6~9 次**

**关键模型分配**：

| 阶段 | 执行模型 |
|------|---------|
| 1~5 | `openroute/auto` |
| 6 | `openroute/auto` |

**通过条件**：

1. ✅ seo_keywords 数组长度 ≥ 5
2. ✅ draft 中目标关键词"Python 异步编程最佳实践"出现 ≥ 2 次
3. ✅ seo_optimization 必须使用 plan_execute 模式（YAML 定义）
4. ✅ fact_check 使用 httpx HEAD 验证 URL 可访问性

**指标记录**：

| 指标 | 预期值 | 实际值 | 状态 |
|------|--------|--------|------|
| 总 LLM 调用次数 | 6~9 | _ | _ |
| 总工具调用次数 | ≥ 3 | _ | _ |
| seo_keywords 数量 | ≥ 5 | _ | _ |
| 关键词出现次数 | ≥ 2 | _ | _ |

**失败处理**：

- 若 seo_keywords 为空：检查 SEOOptimizationAgent Prompt，记录到 prompt_issues.md
- 若 fact_check 未使用 httpx HEAD 验证 URL：记录为 P1 Bug
- 若 draft 中关键词密度不足：记录为 P2 Bug（Prompt 调整）

**调用路径验证**：

| 阶段 | 预期调用路径 | 验证方法 |
|------|-------------|---------|
| topic_research | cache → (miss) → web_search → (success) → llm(可选) | 检查 tool.start 事件序列 |
| material_collection | cache → web_search → llm_summarize | 检查 tool.start 事件序列 |
| writing | llm.generate(draft) | 检查 llm.start 事件 |
| seo_opt | llm.planning → llm.optimize | 检查两次 llm.start 事件 |
| fact_check | httpx HEAD × N（URL 验证） | 检查 tool.start 事件中 tool_name |
| audit | llm.assess → llm.compliance | 检查两次 llm.start 事件 |

**预期输出结构**：
```json
{
  "topics": {"type": "list"},
  "materials": {"type": "list"},
  "draft": {"type": "str", "min_length": 500},
  "seo_title": {"type": "str", "min_length": 10},
  "seo_keywords": {"type": "list", "min_count": 3},
  "fact_check_result": {"type": "object"},
  "score": {"type": "float", "range": [0, 1.0]},
  "is_clean": {"type": "bool"},
  "published": {"type": "dict"}
}
```

---

## 7. 引用

- [doc:rules.md#T1-T8] — 测试铁律 T1-T8（详细定义）
- [doc:test/README.md] — 测试子目录索引
- [doc:test/TEMPLATE.md] — 测试用例文件模板
- [doc:test/T002-test-strategy.md] — 测试策略 + 6 维指标体系
- [doc:test/T006-workflow-api-e2e-extended.md] — IT-WF-API-05~08 + 负向测试
- [doc:../spec.md] — 软件规格说明书
- [doc:../arch.md] — 架构设计文档
- [doc:../design.md] — 详细设计文档
- [doc:design/naming-contract.md] — 命名契约 v2.0

---

## 8. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v1.0 | 初始创建（从 test.md 拆分：路径分析 + IT-WF-API-01~04 共 4 个 Workflow API E2E 测试用例） | 测试员可进化智能体（蜜獾·平头哥） |
