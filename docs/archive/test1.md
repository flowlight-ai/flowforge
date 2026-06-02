# FlowForge v6.0 端到端测试用例规格说明书（v2.0 重写版）

> **依据文档**：`flowforge/docs/spec.md`（功能特性规格）、`flowforge/docs/arch.md`（架构设计）、`flowforge/docs/design.md`（详细设计）
> **审视报告**：`flowforge/docs/testreview.md`（11项致命缺陷，评分1/10）
> **测试原则**：所有集成/E2E测试必须使用真实LLM调用和真实数据，禁止Mock LLM；与规格不符即为Bug
> **日期**：2026-05-24

---

## 一、审视报告致命缺陷修复清单

| # | 致命缺陷 | 本文档修复措施 | 对应章节 |
|---|---------|--------------|---------|
| 1 | 全量Mock LLM，零次真实LLM调用 | 所有E2E/集成测试强制真实LLM，Mock仅限纯逻辑单元测试 | 全文 |
| 2 | 8个Workflow无一真实E2E验证 | 8个Workflow全部设计真实E2E，含每阶段预期 | 第三章 |
| 3 | API测试只检查status_code=200 | 每个API验证业务正确性：字段完整性、数据格式、状态转换 | 第四章 |
| 4 | 无前端Solo/WebSocket E2E | 4个Playwright E2E场景，验证时间线渲染+事件映射+审核交互 | 第五章 |
| 5 | 无workflow→agent→tool调用链路验证 | 每个场景含预期调用链，验证实际链路与预期一致 | 每个用例 |
| 6 | 零个测试指标 | 6大维度指标体系，每个用例含预期值vs实际值表 | 第二章+每个用例 |
| 7 | 模型通道未区分测试 | 4通道验证矩阵，网页版/API版分别测试 | 第六章 |
| 8 | 评审打分使用同一Agent/模型 | Agent-as-Judge必须使用不同模型，明确指定评审模型 | 每个含audit的用例 |
| 9 | 测试缺少预期过程和输出 | 每个用例含：输入数据、预期执行过程表、通过条件、指标表、失败处理 | 每个用例 |
| 10 | 无并发+Circuit Breaker测试 | 4个并发场景+2个熔断场景 | 第七章 |
| 11 | 无跨Workflow组合场景 | 2个跨Workflow组合场景 | 第八章 |

---

## 二、测试指标体系（6大维度）

### 2.1 指标定义

| 维度 | 指标 | 定义 | 采集方式 | 记录格式 |
|------|------|------|---------|---------|
| **LLM** | 总调用次数 | 任务生命周期中LLM被调用总次数 | 监听`llm.start`事件计数 | integer |
| **LLM** | 各Agent-LLM调用分布 | 每个Agent调用LLM的次数 | `llm.start`事件按agent分组 | `{agent: count}` |
| **LLM** | 模型链 | 每次调用使用的模型ID序列 | `llm.start` payload的model字段 | `[model_id, ...]` |
| **LLM** | Token消耗 | 输入+输出Token之和 | `llm.end` payload的usage字段 | `{input: int, output: int}` |
| **LLM** | 延迟分布 | P50/P95/P99延迟 | `llm.start`→`llm.end`时间差 | `{p50: ms, p95: ms, p99: ms}` |
| **Tool** | 调用链 | 工具调用顺序序列 | `tool.start`事件序列 | `tool_a→tool_b→tool_c` |
| **Tool** | 各工具调用次数 | 每个工具被调用次数 | `tool.start`按tool_name分组 | `{tool: count}` |
| **Tool** | 成功率 | 成功/总调用数 | `tool.end`中error为空的比例 | float 0-1 |
| **Tool** | 每步耗时 | 每次工具调用耗时 | `tool.start`→`tool.end`时间差 | `{tool: {avg_ms, max_ms}}` |
| **Agent** | 调用链 | Agent调用顺序序列 | `agent.start`事件序列 | `[agent_name, ...]` |
| **Agent** | 各Agent执行时长 | 每个Agent执行耗时 | `agent.start`→`agent.end` | `{agent: seconds}` |
| **Agent** | Reflexion迭代轮次 | Reflexion模式迭代次数 | `reflexion.evaluator`事件计数 | integer |
| **Agent** | Reflexion最终评分 | Reflexion最终质量评分 | `reflexion.evaluator` payload的score | float 0-1 |
| **Agent** | Judge模型名 | Agent-as-Judge使用的模型 | `llm.start` payload中audit阶段的model | string |
| **Workflow** | 阶段序列 | 实际执行的步骤名称序列 | `workflow.step.start`事件序列 | `[step_name, ...]` |
| **Workflow** | 各步骤耗时 | 每个步骤执行耗时 | `step.start`→`step.complete` | `{step: seconds}` |
| **Workflow** | 并行步骤重叠率 | 并行步骤时间重叠比例 | 并行步骤的start/end时间交叉 | float 0-1 |
| **Workflow** | Human节点停留时间 | 审核暂停到恢复的时长 | `task.paused`→`task.resumed` | seconds |
| **Memory** | 查询次数 | Memory被查询次数 | MemoryManager.retrieve调用计数 | integer |
| **Memory** | 写入次数 | Memory被写入次数 | MemoryManager.save调用计数 | integer |
| **Memory** | 压缩触发次数 | 92%阈值触发压缩次数 | `context.warning`事件计数 | integer |
| **Memory** | 缓存命中率 | 命中缓存/总查询 | cache工具返回cached=True比例 | float 0-1 |
| **WebSocket** | 事件总数 | 推送到前端的事件数 | SoloWSManager发送计数 | integer |
| **WebSocket** | 各类型事件分布 | 每种事件类型数量 | 按solo_event_type分组 | `{type: count}` |
| **WebSocket** | 序号连续性 | 事件序号是否有跳号 | 序号差值检测 | `{gaps: int, missing: []}` |
| **Frontend** | 时间线节点数 | 前端渲染的步骤节点数 | DOM节点计数 | integer |
| **Frontend** | Citation链接数 | 来源引用卡片数 | DOM中citation元素计数 | integer |
| **Frontend** | 流式chunk渲染数 | 流式内容渲染的chunk数 | streaming事件计数 | integer |

### 2.2 指标记录模板（每个用例必须填写）

```
| 指标 | 预期值 | 实际值 | 状态 |
|------|--------|--------|------|
| 总LLM调用次数 | ≥ X | _ | _ |
| 总工具调用次数 | ≥ X | _ | _ |
| 总耗时 | < Xs | _ | _ |
| Memory查询次数 | ≥ X | _ | _ |
| Memory写入次数 | ≥ X | _ | _ |
| Reflexion迭代次数 | X~Y | _ | _ |
| Judge Agent模型名 | (≠执行模型名) | _ | _ |
| WebSocket事件数 | ≥ X | _ | _ |
| 前端时间线节点数 | = X | _ | _ |
```

---

## 三、8个Workflow完整E2E测试用例

> **执行通道优先级**：OpenRoute API版 → OpenRoute网页版 → 验证通过后以此为准
> **未通过的API模型**：通过`models.yaml`中`enabled: false`暂时关闭
> **未通过的网页版模型**：修正Prompt，约束LLM输出所需工具格式或文案

---

### 3.1 IT-WF-01：深度长文 Workflow（deep_article.yaml）— 8步全流程

**需求依据**：spec.md FR-CAP-06 #1；arch.md 6.5 Workflow #1；design.md 9.1

**输入数据**：
- 意图/任务：`"帮我写一篇关于2026年AI Agent发展趋势的深度分析文章，面向技术从业者，3000字以上"`
- 选用Workflow：`deep_article`
- 选用模型通道：OpenRoute API（执行模型=`openroute/auto`，评审模型=`openroute/doubao-web/chat`）
- 执行方式：后端API `POST /api/v1/tasks`

**预期执行过程**：

| 阶段 | Agent | 模式 | 预期LLM次数 | 预期工具调用链 | 预期输出格式 | 预期耗时 |
|------|-------|------|-----------|-------------|------------|---------|
| 1 | topic_research | rewoo | 2~3 | web_search×2~3 → cache×1 | `{"topics": [{"title": str, "keywords": [str], "angle": str}]}` | < 18s |
| 2 | material_collection | rewoo | 2~3 | web_search×3~5 → cache×1 | `{"materials": [{"url": str, "title": str, "excerpt": str, "relevance": 0-1}]}` | < 25s |
| 3 | article_writing | reflexion | 1+N(1~3) | llm×(1+N) | `{"draft": str(≥2000字), "score": float≥0.85}` | < 45s |
| 4 | seo_optimization | plan_execute | 1~2 | — | `{"seo_title": str, "seo_keywords": [str], "seo_description": str}` | < 10s |
| 5 | fact_check | react | 3~6 | web_search×(2~5) | `{"verified": int, "unverified": int, "corrections": [str]}` | < 30s |
| 6 | content_audit | agent_judge | 1~2 | — | `{"design_quality": 0-1, "originality": 0-1, "craft": 0-1, "functionality": 0-1, "verdict": "pass"/"conditional"/"fail"}` | < 12s |
| 7 | review | human | — | 等待审核 | 任务状态=paused | 人为操作 |
| 8 | publishing | plan_execute | 1 | publish×1 | `{"published_urls": [str]}` | < 8s |

**关键模型分配**：
| 阶段 | 执行模型 | 说明 |
|------|---------|------|
| 1~5 | `openroute/auto` | 执行模型 |
| 6 content_audit | `openroute/doubao-web/chat` | **评审模型 ≠ 执行模型**（审视缺陷8修复） |
| 7 | — | 人工审核 |
| 8 | `openroute/auto` | 执行模型 |

**通过条件**：
1. ✅ 8个阶段全按预期顺序执行，无跳过（验证`workflow.step.start`事件序列）
2. ✅ 每个Agent的模式与Workflow YAML定义一致（topic_research=rewoo, article_writing=reflexion, fact_check=react, content_audit=agent_judge）
3. ✅ 每个Agent的LLM调用次数在预期范围内（±1次）
4. ✅ 每个Agent的工具调用链与预期匹配（工具名+顺序）
5. ✅ article_writing阶段Reflexion迭代1~3轮，最终score ≥ 0.85
6. ✅ **content_audit评审模型 ≠ article_writing执行模型**（审视缺陷8核心验证）
7. ✅ content_audit四维评分均为0-1之间浮点数
8. ✅ fact_check阶段有真实web_search工具调用（非LLM直接回答）
9. ✅ review阶段正确暂停，`POST /review`后恢复执行
10. ✅ 整个Workflow在5分钟内完成

**需记录的指标**：

| 指标 | 预期值 | 实际值 | 状态 |
|------|--------|--------|------|
| 总LLM调用次数 | ≥ 12 | _ | _ |
| 总工具调用次数 | ≥ 10 | _ | _ |
| 总耗时 | < 300s | _ | _ |
| Memory查询次数 | ≥ 2 | _ | _ |
| Memory写入次数 | ≥ 4 | _ | _ |
| Reflexion迭代次数 | 1~3 | _ | _ |
| Reflexion最终评分 | ≥ 0.85 | _ | _ |
| Judge Agent模型名 | ≠ openroute/auto | _ | _ |
| WebSocket事件数 | ≥ 20 | _ | _ |
| 前端时间线节点数 | = 8 | _ | _ |

**失败处理**：
- 若模型不可用：跳过该通道，标记为SKIP，在报告中说明
- 若工具调用失败：记录失败原因，检查重试逻辑是否触发（L1超时/L3自修正）
- 若LLM输出格式不符：检查Prompt是否需要调整，记录到prompt_issues.md
- 若Agent跳过工具直接回答：记录为P2 Bug（调用链路验证失败）

---

### 3.2 IT-WF-02：深度长文 — Web前端Solo通道

**需求依据**：spec.md FR-SOL-01~04；arch.md 10.6

**输入数据**：
- 意图：同IT-WF-01
- 选用Workflow：`deep_article`
- 选用模型通道：OpenRoute网页版（`doubao-web/chat`）
- 执行方式：**Web前端Solo对话框发起**（从浏览器输入任务，观察WebSocket事件流）

**预期前端时间线渲染**：

| 事件序号 | WebSocket事件类型 | 渲染内容 |
|---------|-------------------|---------|
| 1 | solo.stage.enter | 时间线显示"阶段1: 选题研究 [topic_research, rewoo]" |
| 2~4 | solo.tool.start → solo.tool.end | 时间线显示web_search×2子节点 |
| 5~7 | solo.llm.start → solo.llm.reasoning → solo.llm.end | 时间线显示LLM思考过程 |
| ... | (重复8轮对应8个阶段) | ... |
| N-3 | solo.review.ready | 时间线显示"等待审核"节点，可点击通过/驳回 |
| N-2 | solo.review.submitted | 时间线显示审核结果 |
| N | solo.task.completed | 时间线显示"完成"，publish结果 |

**通过条件**：
1. ✅ 前端时间线渲染的节点数 = 8（对应8个阶段）
2. ✅ 每个阶段下的子节点（tool/llm）正确展示
3. ✅ WebSocket事件序列完整，17种FlowForge事件→16种Solo事件全映射
4. ✅ `eventToEntry`正确映射所有16种Solo事件类型
5. ✅ `entryToChatMessages`正确转换为聊天消息
6. ✅ review节点可交互（通过/驳回/编辑）
7. ✅ 所有tool.start/tool.end成对出现
8. ✅ 流式答案逐字渲染（solo.llm.stream事件）
9. ✅ 事件序号连续递增，无跳号
10. ✅ 断线重连后事件可回放

---

### 3.3 IT-WF-03：快速发文 Workflow（quick_post.yaml）— 3步

**需求依据**：spec.md FR-CAP-06 #2；arch.md 6.5 Workflow #2

**输入数据**：
- 意图：`"写一篇关于'周末咖啡推荐'的快速帖子，500字左右"`
- Workflow：`quick_post`
- 模型通道：OpenRoute API

**预期执行过程**：

| 阶段 | Agent | 模式 | 预期LLM次数 | 预期工具调用链 | 预期输出格式 | 预期耗时 |
|------|-------|------|-----------|-------------|------------|---------|
| 1 | topic_research | rewoo | 2~3 | web_search×2~3 → cache×1 | topics JSON | < 15s |
| 2 | article_writing | reflexion | 1+N(1~2) | llm×(1+N) | draft, score≥0.85 | < 30s |
| 3 | publishing | plan_execute | 1 | publish×1 | published_urls | < 5s |

**关键模型分配**：
| 阶段 | 执行模型 |
|------|---------|
| 1 | `openroute/auto` |
| 2 | `openroute/auto` |
| 3 | `openroute/doubao-web/chat`（lightweight档位） |

**通过条件**：
1. ✅ 3阶段全完成，步骤数=3（比deep_article少5步）
2. ✅ 不包含seo_optimization、fact_check、content_audit步骤
3. ✅ article_writing score ≥ 0.85
4. ✅ 总耗时 < 90s
5. ✅ 各步骤按顺序执行（非并行）

**需记录的指标**：

| 指标 | 预期值 | 实际值 | 状态 |
|------|--------|--------|------|
| 总LLM调用次数 | ≥ 5 | _ | _ |
| 总工具调用次数 | ≥ 4 | _ | _ |
| 总耗时 | < 90s | _ | _ |
| Memory查询次数 | ≥ 1 | _ | _ |
| Reflexion迭代次数 | 1~2 | _ | _ |
| workflow.step.start事件数 | = 3 | _ | _ |

---

### 3.4 IT-WF-04：热点追踪 Workflow（trend_article.yaml）— 4步

**需求依据**：spec.md FR-CAP-06 #3；arch.md 6.5 Workflow #3；spec.md 5.2"热点追踪创作"

**输入数据**：
- 意图：`"追踪今日科技热点，写一篇热点分析文章"`
- Workflow：`trend_article`
- 模型通道：OpenRoute API

**预期执行过程**：

| 阶段 | Agent | 模式 | 预期LLM次数 | 预期工具调用链 | 特别关注 |
|------|-------|------|-----------|-------------|---------|
| 1 | trend_analysis | react | 4~6 | web_search×3~5 → cache×1 | **热点数据是否真实（非编造），可通过搜索验证** |
| 2 | topic_research | rewoo | 2~3 | web_search×2~3 → cache×1 | 选题是否基于阶段1的真实热点 |
| 3 | article_writing | reflexion | 1+N(1~3) | llm×(1+N) | 文章是否引用趋势数据 |
| 4 | publishing | plan_execute | 1 | publish×1 | — |

**关键模型分配**：
| 阶段 | 执行模型 |
|------|---------|
| 1 | `openroute/auto`（react模式需要多步推理） |
| 2 | `openroute/auto` |
| 3 | `openroute/auto` |
| 4 | `openroute/doubao-web/chat` |

**通过条件**：
1. ✅ 第一步必须是`trend_analysis`（先分析趋势再选题）
2. ✅ trend_analysis必须使用react模式
3. ✅ **必须调用web_search获取实时热点**（否则是Bug——热点追踪不搜索）
4. ✅ trends数组至少含3条热点
5. ✅ 热点数据可通过搜索引擎验证时效性（非LLM编造）
6. ✅ article_writing引用了阶段1的趋势数据

**需记录的指标**：

| 指标 | 预期值 | 实际值 | 状态 |
|------|--------|--------|------|
| 总LLM调用次数 | ≥ 8 | _ | _ |
| 总工具调用次数 | ≥ 6 | _ | _ |
| trend_analysis react步骤数 | 2~6 | _ | _ |
| web_search调用次数 | ≥ 5 | _ | _ |
| 热点条数 | ≥ 3 | _ | _ |

---

### 3.5 IT-WF-05：SEO内容 Workflow（seo_content.yaml）— 6步

**需求依据**：spec.md FR-CAP-06 #5；arch.md 6.5 Workflow #5

**输入数据**：
- 意图：`"针对关键词'Python入门教程'生成一篇SEO优化的文章"`
- Workflow：`seo_content`
- 模型通道：OpenRoute API

**预期执行过程**：

| 阶段 | Agent | 模式 | 预期LLM次数 | 预期工具调用链 | 输出验证 |
|------|-------|------|-----------|-------------|---------|
| 1 | topic_research | rewoo | 2~3 | web_search×2~3 | topics |
| 2 | seo_optimization | plan_execute | 1~2 | — | seo_keywords含搜索量/竞争度 |
| 3 | material_collection | rewoo | 2~3 | web_search×3~5 | materials |
| 4 | article_writing | reflexion | 1+N | llm×(1+N) | draft含关键词密度检查 |
| 5 | fact_check | react | 3~6 | web_search×2~5 | fact_check_result |
| 6 | publishing | plan_execute | 1 | publish×1 | published_urls |

**通过条件**：
1. ✅ seo_keywords数组长度 ≥ 5
2. ✅ draft中目标关键词"Python入门教程"出现 ≥ 2次
3. ✅ seo_optimization必须使用plan_execute模式
4. ✅ fact_check必须调用web_search验证

---

### 3.6 IT-WF-06：报告生成 Workflow（report_generation.yaml）— 含并行步骤

**需求依据**：spec.md FR-CAP-06 #8；arch.md 6.5 Workflow #8

**输入数据**：
- 意图：`"生成一份关于'全球气候变化影响'的深度研究报告"`
- Workflow：`report_generation`
- 模型通道：OpenRoute API

**预期执行过程**：

| 阶段 | Agent | 模式 | 特别关注 |
|------|-------|------|---------|
| 1 | topic_research | rewoo | 选题输出包含报告大纲 |
| 2 | **research_1 ‖ research_2** | rewoo并行 | **两个material_collection并行执行，耗时应有重叠（非串行相加）** |
| 3 | article_writing | reflexion | 基于两份并行调研结果撰写 |
| 4 | content_audit | agent_judge | **审计模型 ≠ 执行模型** |
| 5 | review | human | 暂停等待审核 |
| 6 | publishing | plan_execute | — |

**关键模型分配**：
| 阶段 | 执行模型 |
|------|---------|
| 1~3 | `openroute/auto` |
| 4 content_audit | `openroute/doubao-web/chat`（**评审模型 ≠ 执行模型**） |
| 5 | — |
| 6 | `openroute/auto` |

**通过条件**：
1. ✅ **并行步骤中research_1和research_2的实际执行时间有重叠**（验证并行而非串行）
2. ✅ 并行步骤输出独立互不污染
3. ✅ **content_audit使用不同于article_writing的模型**
4. ✅ content_audit四维评分均为0-1浮点数

**需记录的指标**：

| 指标 | 预期值 | 实际值 | 状态 |
|------|--------|--------|------|
| 并行步骤时间重叠 | > 0s | _ | _ |
| content_audit模型名 | ≠ openroute/auto | _ | _ |
| 总LLM调用次数 | ≥ 10 | _ | _ |
| 总工具调用次数 | ≥ 8 | _ | _ |

---

### 3.7 IT-WF-07：多语言发布 Workflow（multilingual.yaml）

**需求依据**：spec.md FR-CAP-06 #7；arch.md 6.5 Workflow #7

**输入数据**：
- 意图：`"写一篇关于'中国高铁技术'的文章，翻译成英文和日文发布"`
- Workflow：`multilingual`
- 模型通道：OpenRoute API

**预期执行过程**：

| 阶段 | Agent | 模式 | 预期LLM次数 | 预期工具调用链 | 验证点 |
|------|-------|------|-----------|-------------|--------|
| 1 | topic_research | rewoo | 2~3 | web_search×2~3 | — |
| 2 | material_collection | rewoo | 2~3 | web_search×3~5 | — |
| 3 | article_writing | reflexion | 1+N | llm×(1+N) | 中文初稿 |
| 4 | multilingual | plan_execute | 1~2 | — | **translated含en/ja目标语言版本** |
| 5 | publishing | plan_execute | 1 | publish×1 | 多语言版本均发布 |

**通过条件**：
1. ✅ translated输出至少含2种目标语言翻译（英文+日文）
2. ✅ 翻译质量不低于机器翻译基准
3. ✅ multilingual Agent必须使用plan_execute模式

---

### 3.8 IT-WF-08：多平台分发 Workflow（multi_platform.yaml）

**需求依据**：spec.md FR-CAP-06 #4；arch.md 6.5 Workflow #4

**输入数据**：
- 意图：`"将以下文章分发到微信公众号、知乎、头条号：[文章内容]"`
- Workflow：`multi_platform`
- 模型通道：OpenRoute API

**预期执行过程**：

| 阶段 | Agent | 模式 | 预期LLM次数 | 特别关注 |
|------|-------|------|-----------|---------|
| 1 | topic_research | rewoo | 2~3 | — |
| 2 | article_writing | reflexion | 1+N | 产出主版本 |
| 3 | content_repurposer | plan_execute | 1~2 | **variants应含不同平台的改写版本（公众号/知乎/头条/微博）** |
| 4 | publishing | rewoo | 1~2 | publish使用rewoo模式（批量工具调用） |

**通过条件**：
1. ✅ **content_repurposer必须调用**（格式转换核心步骤）
2. ✅ variants数组长度 ≥ 3（对应3个以上目标平台）
3. ✅ 各版本风格有差异（公众号偏正式、知乎偏深度、头条偏标题党）
4. ✅ publishing使用rewoo模式（一次性规划多平台发布）

---

### 3.9 IT-WF-09：图文并茂 Workflow（image_article.yaml）

**需求依据**：spec.md FR-CAP-06 #6；arch.md 6.5 Workflow #6

**输入数据**：
- 意图：`"写一篇关于'日本樱花季旅行攻略'的图文文章"`
- Workflow：`image_article`
- 模型通道：OpenRoute API

**预期执行过程**：

| 阶段 | Agent | 模式 | 预期LLM次数 | 预期工具调用链 | 特别关注 |
|------|-------|------|-----------|-------------|---------|
| 1 | topic_research | rewoo | 2~3 | web_search×2~3 | — |
| 2 | material_collection | rewoo | 2~3 | web_search×3~5 | — |
| 3 | article_writing | reflexion | 1+N | llm×(1+N) | — |
| 4 | image_research | rewoo | 1~2 | pexels_image×2~3 | **images应包含真实可访问的图片URL，非占位符** |
| 5 | content_audit | agent_judge | 1~2 | — | **评审模型 ≠ 执行模型** |
| 6 | publishing | plan_execute | 1 | publish×1 | 图文混排发布 |

**关键模型分配**：
| 阶段 | 执行模型 |
|------|---------|
| 1~4 | `openroute/auto` |
| 5 content_audit | `openroute/doubao-web/chat`（评审模型 ≠ 执行模型） |
| 6 | `openroute/auto` |

**通过条件**：
1. ✅ image_research必须调用pexels_image工具（非LLM编造URL）
2. ✅ images数组至少含2张可用图片
3. ✅ 图片URL可通过HTTP 200访问
4. ✅ content_audit使用不同模型

---

## 四、模式执行器专项测试

### 4.1 IT-MODE-01：ReAct循环检测

**需求依据**：spec.md FR-ENG-03 ReAct（MAX_STEPS=8，含循环检测）；design.md 7.1

**输入数据**：
- 意图：`"反复搜索同一个问题：AI是什么？AI是什么？AI是什么？"`
- 模式：react
- 模型：`openroute/auto`

**预期执行过程**：

| 步骤 | 预期行为 |
|------|---------|
| 1~2 | 正常Thought→Action→Observation循环 |
| 3+ | 检测到重复Action，触发`react.loop_detected`事件 |
| — | Agent不会无限循环，steps ≤ MAX_STEPS=8 |

**通过条件**：
1. ✅ `react.loop_detected`事件被发射
2. ✅ 总步骤数 ≤ 8（MAX_STEPS）
3. ✅ Agent不会无限循环挂起

---

### 4.2 IT-MODE-02：Reflexion不收敛处理

**需求依据**：spec.md FR-ENG-03 Reflexion（MAX_ITERATIONS=4，QUALITY_THRESHOLD=0.85）；design.md 7.3

**输入数据**：
- 意图：`"写一篇关于量子场论的学术论文，要求达到Nature发表水平"`（故意极高要求，LLM难以达标）
- 模式：reflexion
- 模型：`openroute/auto`

**预期执行过程**：

| 迭代 | Actor | Evaluator | Reflector |
|------|-------|-----------|-----------|
| 1 | 生成初稿 | 评分 < 0.85 | 分析问题 |
| 2 | 基于反思改进 | 评分 < 0.85 | 分析问题 |
| 3 | 基于反思改进 | 评分 < 0.85 | 分析问题 |
| 4 | 基于反思改进 | 评分（可能仍<0.85） | — |

**通过条件**：
1. ✅ 达到MAX_ITERATIONS=4后停止，不会崩溃
2. ✅ 输出`best_score`和`best_result`（即使未达标）
3. ✅ 三个角色（Actor/Evaluator/Reflector）必须使用独立的Agent
4. ✅ 每轮Evaluator必须返回0-1之间的数值评分

---

### 4.3 IT-MODE-03：Agent-as-Judge不同模型验证

**需求依据**：spec.md FR-HRN-03 反馈循环（独立评判Agent）；审视缺陷8

**输入数据**：
- 意图：`"写一篇关于'远程办公利弊'的评论文章"`
- 配置：writing用`openroute/auto`，audit用`openroute/doubao-web/chat`

**预期执行过程**：

| 阶段 | Agent | 模型 | 预期行为 |
|------|-------|------|---------|
| 1 | article_writing | reflexion | 使用`openroute/auto`生成文章 |
| 2 | content_audit | agent_judge | **使用`openroute/doubao-web/chat`评审** |

**通过条件**：
1. ✅ **audit阶段的LLM模型名 ≠ writing阶段的LLM模型名**
2. ✅ audit返回四维评分（design_quality/originality/craft/functionality）
3. ✅ 评分不全相同（证明不是同一模型重复评分）
4. ✅ audit返回verdict（pass/conditional/fail）

---

### 4.4 IT-MODE-04：代码生成（coding档位模型）

**需求依据**：spec.md FR-CAP-04 CodeWriterAgent；design.md 8.2

**输入数据**：
- 意图：`"用Python写一个快速排序算法，要求包含注释和单元测试"`
- 模式：reflexion
- 模型：**coding档位** `arkcode/ark-code-latest`

**预期执行过程**：

| 阶段 | Agent | 模式 | 预期LLM次数 | 预期模型 |
|------|-------|------|-----------|---------|
| 1 | code_writer_agent | reflexion | 1+N(1~3) | **`arkcode/ark-code-latest`** |

**通过条件**：
1. ✅ **必须使用coding档位模型`arkcode/ark-code-latest`**（否则是Bug——代码任务没用代码模型）
2. ✅ 响应必须包含可执行的Python代码
3. ✅ 代码应包含注释
4. ✅ 应包含单元测试代码
5. ✅ LLM模型链中必须包含`arkcode/ark-code-latest`

---

### 4.5 IT-MODE-05：Subagents并行策略

**需求依据**：spec.md FR-MAS-01（完全上下文隔离、并行执行、工具过滤、结果压缩）；design.md 7.4

**输入数据**：
- 意图：`"从技术、经济、社会三个角度并行分析'人工智能对教育的影响'"`
- 模式：multi_agent（strategy=subagents）
- 模型：`openroute/auto`

**预期执行过程**：

| 子任务 | Agent | 上下文 | 工具集 | 模型 |
|--------|-------|--------|--------|------|
| 技术角度 | subagent_1 | 独立空state | [llm, web_search] | `openroute/auto` |
| 经济角度 | subagent_2 | 独立空state | [llm, web_search] | `openroute/auto` |
| 社会角度 | subagent_3 | 独立空state | [llm, web_search] | `openroute/auto` |

**通过条件**：
1. ✅ 3个子任务必须并行执行（`agent.start`时间戳接近，非串行）
2. ✅ 每个子Agent必须有独立的上下文（`TaskContext.from_parent(state={})`）
3. ✅ 子Agent只暴露最小工具集（工具过滤）
4. ✅ 子Agent结果必须压缩返回（不污染父Agent上下文）
5. ✅ 单个子任务失败不应影响其他子任务

**需记录的指标**：

| 指标 | 预期值 | 实际值 | 状态 |
|------|--------|--------|------|
| 子任务并行时间重叠 | > 0s | _ | _ |
| 子Agent上下文隔离 | state={} | _ | _ |
| 子Agent工具集 | ≠ 全部工具 | _ | _ |

---

## 五、前端Solo / WebSocket E2E测试

### 5.1 E2E-SOLO-01：完整ReAct Solo流程

**需求依据**：spec.md FR-SOL-01~04；arch.md 10.6

**操作**：浏览器打开 http://localhost:5173 → 选择ReAct模式 → 输入`"百度最新的AI战略是什么"` → 提交

**预期时间线事件序列**：
```
solo.stage.enter → solo.llm.start → solo.llm.reasoning → solo.llm.end →
solo.tool.start(web_search) → solo.tool.end(web_search) →
solo.llm.start → solo.llm.reasoning → solo.llm.end →
solo.tool.start(web_scraper) → solo.tool.end(web_scraper) →
solo.llm.start → solo.llm.stream → solo.llm.end →
solo.draft.update → solo.task.completed
```

**验证点**：
1. ✅ 前端时间线正确渲染每个节点
2. ✅ 工具调用节点和LLM思考节点正确区分（图标/颜色）
3. ✅ 流式答案逐行渲染（solo.llm.stream）
4. ✅ 事件序号连续无跳号
5. ✅ 来源卡片（Citation）正确展示URL
6. ✅ `eventToEntry`正确映射所有事件类型
7. ✅ `entryToChatMessages`正确转换为聊天消息
8. ✅ `mergeStreamingMessages`正确合并流式消息
9. ✅ `groupMessagesIntoSteps`正确分组

---

### 5.2 E2E-SOLO-02：Workflow完整Solo流程（deep_article）

**操作**：浏览器 → Solo → 选择deep_article Workflow → 输入`"写一篇关于量子计算的科普文章"` → 提交

**预期时间线节点**：
```
[阶段1: 选题研究] topic_research(rewoo)
  ├── web_search × 2~3
  └── LLM 思考
[阶段2: 素材搜集] material_collection(rewoo)
  ├── web_search × 3~5
  └── LLM 思考
[阶段3: 撰写] article_writing(reflexion)
  ├── LLM 思考 (第1轮)
  ├── LLM 评估 (Reflexion)
  └── LLM 思考 (第2轮，若需迭代)
[阶段4: SEO优化] seo_optimization(plan_execute)
  └── LLM 思考
[阶段5: 事实核查] fact_check(react)
  ├── web_search × N
  └── LLM 思考 × N
[阶段6: 审核] content_audit(agent_judge)
  └── LLM 思考 (模型: doubao-web/chat ← 不同于阶段1-5)
[阶段7: 人工审核] review(human) ← 暂停，可交互
[阶段8: 发布] publishing(plan_execute)
  └── 发布结果
```

**验证点**：
1. ✅ 8个阶段按序渲染，无跳步
2. ✅ 阶段6顶部显示评审模型名（不同于阶段1-5的执行模型）
3. ✅ 阶段7渲染为"审核中"按钮，点击通过后继续
4. ✅ 阶段3若Reflexion迭代>1轮，显示迭代轮次标签
5. ✅ 来源面板（Source Panel）始终可见，Citation可点击跳转
6. ✅ 虚拟滚动支持500+条事件（spec.md FR-SOL-02）

---

### 5.3 E2E-SOLO-03：WebSocket断线重连

**操作**：Solo执行中手动断开WebSocket → 等待5秒 → 重连

**预期**：
1. ✅ 重连成功
2. ✅ 接收replay事件，回放断线期间丢失的事件
3. ✅ 时间线自动补全
4. ✅ 指数退避重连，最多10次（spec.md 4.3可靠性要求）

---

### 5.4 E2E-SOLO-04：审核交互全流程

**需求依据**：spec.md FR-SOL-03（审核节点内联）；arch.md 12.3 Human-in-the-Loop

**操作**：选择deep_article Workflow → 等待review阶段暂停 → 点击"驳回" → 输入反馈 → 提交

**预期事件序列**：
```
review.ready → task.paused → (用户操作) → review.submitted(verdict=reject) → task状态=rejected
```

**验证点**：
1. ✅ review.ready事件触发时间线暂停
2. ✅ 审核窗口期5分钟内可撤回（spec.md FR-SOL-03）
3. ✅ 用户点击"驳回"→ review.submitted(verdict=reject)
4. ✅ **Persona锁在审核暂停期间必须保留**（spec.md开发规范铁律）
5. ✅ 审核完成后persona锁必须释放
6. ✅ Solo前端显示审核内联块（不跳转独立页面）
7. ✅ 支持审核通过/驳回/编辑提交三种操作

---

## 六、多模型通道测试矩阵

### 6.1 通道组合测试

| 测试ID | Workflow | 执行通道 | 优先级 | 说明 |
|--------|---------|---------|--------|------|
| CH-01 | quick_post | `openroute/auto`（API） | P0 | API通道基准验证 |
| CH-02 | quick_post | `openroute/doubao-web/chat`（网页版） | P0 | 网页版需要特殊Prompt约束 |
| CH-03 | deep_article | `openroute/auto`（API） | P0 | 复杂Workflow API验证 |
| CH-04 | deep_article | `openroute/doubao-web/chat`（网页版） | P0 | 复杂Workflow网页版验证 |
| CH-05 | quick_post | `arkcode/ark-code-latest`（coding） | P1 | coding档位验证 |

### 6.2 通道验证通过标准

| 通道 | 验证标准 | 不通过处理 |
|------|---------|-----------|
| `openroute/auto` | quick_post 3阶段全部完成 | 若通过，作为后续所有测试的主通道 |
| `doubao-web/chat` | quick_post 3阶段全部完成 + 工具格式输出正确 | 若LLM输出格式不符：调整Prompt，约束输出格式 |
| `arkcode/ark-code-latest` | 代码生成任务完成 | 若不支持：标记为不可用，在models.yaml中enabled=false |
| **网页版模型** | **LLM必须按Prompt约束输出工具调用格式** | **不通过则修正Prompt，修复后重新验证** |
| **API版模型** | **LLM必须正确使用tool_calls** | **不通过则检查模型是否支持tool_calls，不支持则标记** |

### 6.3 网页版模型Prompt约束模板

```
你是FlowForge的写作Agent。你必须严格按照以下格式输出：

1. 如果需要搜索资料，输出:
   TOOL: web_search
   QUERY: <搜索关键词>

2. 如果需要抓取网页内容，输出:
   TOOL: web_scraper
   URL: <网页URL>

3. 如果最终回答，输出:
   FINAL_ANSWER:
   {"result": {...}}

注意: 不要输出任何其他格式的内容。
```

---

## 七、并发与Circuit Breaker测试

### 7.1 IT-CONC-01：10并发不同persona任务

**需求依据**：spec.md 4.1性能要求"并发创建10个不同persona任务：全部成功，无锁冲突"

**操作**：10个并发POST /api/v1/tasks，使用10个不同persona（persona_1~10），全部使用quick_post Workflow

**预期**：
1. ✅ 全部返回201，无409 ConflictError
2. ✅ 10个任务全部成功完成
3. ✅ 各任务状态互不污染

### 7.2 IT-CONC-02：同persona并发冲突

**需求依据**：spec.md FR-ENG-01 Persona锁；arch.md 12.2

**操作**：2个并发POST /api/v1/tasks，使用同一个persona

**预期**：
1. ✅ 第1个返回201
2. ✅ 第2个返回409 ConflictError
3. ✅ 第1个完成后，同persona新任务可正常执行

### 7.3 IT-CB-01：连续失败触发熔断

**需求依据**：spec.md 4.3可靠性要求"Circuit Breaker触发：5次连续失败触发熔断"；arch.md 9.2 MCPBroker

**操作**：配置一个必定失败的工具 → 连续调用5次

**预期**：
1. ✅ 前5次返回错误
2. ✅ 第6次返回Circuit Breaker开启状态
3. ✅ 熔断后不再尝试调用

### 7.4 IT-CB-02：429 retry-after处理

**需求依据**：spec.md 4.3可靠性要求"429 Retry-After：支持retry-after头部解析"

**操作**：模拟LLM返回429状态码 + Retry-After: 5

**预期**：
1. ✅ 等待5秒后重试
2. ✅ 重试成功
3. ✅ 日志记录429事件和重试行为

---

## 八、跨Workflow组合测试

### 8.1 IT-CROSS-01：先后执行两个Workflow

**操作**：
1. 先执行deep_article（persona=tech_blog）
2. 等待完成后，执行quick_post（persona=tech_blog）

**预期**：
1. ✅ 两个Workflow独立完成，状态不互相污染
2. ✅ 第1个Workflow的Memory数据在第2个中可查询到（如果TTL未过期）
3. ✅ Persona锁在deep_article review暂停时正确释放，quick_post能正常获取

### 8.2 IT-CROSS-02：deep_article → multi_platform链式

**操作**：
1. 执行deep_article（含review暂停）
2. 审核通过后，对同一篇文章执行multi_platform

**预期**：
1. ✅ multi_platform可以复用deep_article的draft和materials
2. ✅ 两个Workflow的publish输出不同（不同平台）

---

## 九、API业务正确性验证（审视缺陷3修复）

> 不再只检查status_code=200，必须验证业务逻辑正确性

### 9.1 API-01：模式列表验证

**操作**：GET /api/v1/modes

**验证**：
1. ✅ 返回9种模式（react/plan_execute/reflexion/multi_agent/workflow/rewoo/self_discover/agent_judge/graph_of_thoughts）
2. ✅ 每个模式包含完整字段（name, description, capabilities）
3. ✅ 不包含未注册的垃圾模式
4. ✅ 模式执行器初始化失败的不出现在列表中

### 9.2 API-02：任务创建验证

**操作**：POST /api/v1/tasks

**验证**：
1. ✅ 返回task_id（非空UUID）
2. ✅ 返回status=pending
3. ✅ 返回mode字段与请求一致
4. ✅ 返回persona字段与请求一致
5. ✅ 任务记录写入数据库（可查询）

### 9.3 API-03：任务状态转换验证

**操作**：创建任务 → 查询状态 → 等待完成 → 查询最终状态

**验证**：
1. ✅ 状态转换序列：pending → running → completed/error
2. ✅ running状态包含current_step信息
3. ✅ completed状态包含result字段（非空JSON）
4. ✅ error状态包含error字段（非空字符串）
5. ✅ 不存在从completed回退到running的情况

---

## 十、测试执行顺序

```
Step 1: 模型健康检查（预检）
  ├── check openroute/auto health（超时10s）
  ├── check doubao-web/chat health（超时10s）
  ├── check arkcode/ark-code-latest health（超时10s）
  └── 不可用的通道自动标记SKIP

Step 2: 通道验证（快速验证 - quick_post × 2通道）
  ├── CH-01: openroute/api → PASS/FAIL
  └── CH-02: doubao-web/chat → PASS/FAIL (FAIL则修正Prompt)

Step 3: Workflow E2E（以验证通过的通道为准）
  ├── IT-WF-01: deep_article (API)
  ├── IT-WF-02: deep_article (Solo Web)
  ├── IT-WF-03: quick_post
  ├── IT-WF-04: trend_article
  ├── IT-WF-05: seo_content
  ├── IT-WF-06: report_generation
  ├── IT-WF-07: multilingual
  ├── IT-WF-08: multi_platform
  └── IT-WF-09: image_article

Step 4: 模式专项
  ├── IT-MODE-01: ReAct循环检测
  ├── IT-MODE-02: Reflexion不收敛
  ├── IT-MODE-03: Agent-as-Judge不同模型
  ├── IT-MODE-04: 代码生成coding模型
  └── IT-MODE-05: Subagents并行

Step 5: 前端E2E
  ├── E2E-SOLO-01: ReAct Solo流程
  ├── E2E-SOLO-02: Workflow Solo流程
  ├── E2E-SOLO-03: WebSocket断线重连
  └── E2E-SOLO-04: 审核交互

Step 6: 并发 + Circuit Breaker
  ├── IT-CONC-01: 10并发
  ├── IT-CONC-02: 同persona冲突
  ├── IT-CB-01: 熔断触发
  └── IT-CB-02: 429重试

Step 7: 跨Workflow组合
  ├── IT-CROSS-01: deep_article → quick_post
  └── IT-CROSS-02: deep_article → multi_platform

Step 8: API业务正确性
  ├── API-01: 模式列表
  ├── API-02: 任务创建
  └── API-03: 状态转换

Step 9: 生成报告
  ├── e2e_summary_{date}.md
  ├── e2e_metrics_{date}.json
  └── prompt_issues_{date}.md
```

---

## 十一、需求追溯矩阵

| 测试用例 | 规格需求 | 架构设计 | 详细设计 | 审视缺陷 |
|---------|---------|---------|---------|---------|
| IT-WF-01 | FR-CAP-06 #1 | 6.5 Workflow #1 | 9.1 | 缺陷2/5/6/8/9 |
| IT-WF-02 | FR-SOL-01~04 | 10.6 | 5.2 | 缺陷4 |
| IT-WF-03 | FR-CAP-06 #2 | 6.5 Workflow #2 | 9.1 | 缺陷2/9 |
| IT-WF-04 | FR-CAP-06 #3 | 6.5 Workflow #3 | 9.1 | 缺陷2/5 |
| IT-WF-05 | FR-CAP-06 #5 | 6.5 Workflow #5 | 9.1 | 缺陷2 |
| IT-WF-06 | FR-CAP-06 #8 | 6.5 Workflow #8 | 9.1 | 缺陷2/8 |
| IT-WF-07 | FR-CAP-06 #7 | 6.5 Workflow #7 | 9.1 | 缺陷2 |
| IT-WF-08 | FR-CAP-06 #4 | 6.5 Workflow #4 | 9.1 | 缺陷2 |
| IT-WF-09 | FR-CAP-06 #6 | 6.5 Workflow #6 | 9.1 | 缺陷2/8 |
| IT-MODE-01 | FR-ENG-03 | 5.1 ReAct | 7.1 | 缺陷5 |
| IT-MODE-02 | FR-ENG-03 | 5.1 Reflexion | 7.3 | 缺陷5 |
| IT-MODE-03 | FR-HRN-03 | 7.4 FeedbackLoop | 14.5 | 缺陷8 |
| IT-MODE-04 | FR-CAP-04 | 6.4 | 8.2 | 缺陷7 |
| IT-MODE-05 | FR-MAS-01 | 10.3 | 7.4 | 缺陷10 |
| E2E-SOLO-01~04 | FR-SOL-01~04 | 10.6 | 5.2 | 缺陷4 |
| CH-01~05 | FR-CAP-01 | 10.4 | 11.1 | 缺陷7 |
| IT-CONC-01~02 | FR-ENG-01 | 12.2 | 4.2 | 缺陷10 |
| IT-CB-01~02 | 4.3可靠性 | 9.2 | 16.3 | 缺陷10 |
| IT-CROSS-01~02 | — | — | — | 缺陷11 |
| API-01~03 | FR-ENG-01~06 | 4.7 | 4.2 | 缺陷3 |
