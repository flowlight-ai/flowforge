# FlowForge 测试用例专业审核报告 vM27-R2（第二轮）

> **审核日期**: 2026-05-24
> **审核角色**: 高级 AI Agent 测试工程师 (M27 专业视角)
> **审核范围**: `flowforge/docs/test.md` (v8.0)
> **审核方法**: 源码链路追踪 + 架构约束分析 + 真实数据验证 + 前端交互验证
> **审核结论**: 🟡 **测试用例 v8.0 设计质量显著提升，但部分关键问题仍待修复验证**

---

## 零、v8.0 版本变化评估

### 0.1 相比 v7.0 的改进

| # | 改进项 | 质量评级 | 说明 |
|---|--------|:-------:|------|
| 1 | 代码修复前置清单（B1-B4） | ✅ 优秀 | 明确标注阻塞性Bug及修复方案 |
| 2 | LLM 调用次数修正 | ✅ 优秀 | 基于源码重写，非模式执行器假设 |
| 3 | 两条执行路径分析 | ✅ 优秀 | 明确区分 Workflow API vs Solo UI |
| 4 | 指标体系 28 项 | ✅ 良好 | 定义清晰，采集方式明确 |
| 5 | conftest_e2e.py 真实 LLM | ✅ 良好 | 区分单元/集成测试环境 |
| 6 | MetricsCollector 可执行代码 | ✅ 优秀 | 直接可运行，非伪代码 |
| 7 | 需求追溯矩阵 | ✅ 良好 | 覆盖全部需求 |
| 8 | 通用 Agent + Workflow | ✅ 良好 | 新增 14 个通用 Agent + 5 个模板 |
| 9 | Playwright 断言代码 | ✅ 良好 | 提供具体 DOM 选择器 |

### 0.2 仍需关注的问题

| # | 问题 | 严重度 | 状态 |
|---|------|--------|------|
| 1 | B1-B4 代码修复尚未验证 | P0 | ⚠️ 待代码修复后实际测试 |
| 2 | MetricsCollector 是否真正集成到 EventBus | P1 | ⚠️ 需验证事件名称匹配 |
| 3 | Playwright DOM 选择器是否与前端一致 | P2 | ⚠️ 需对照前端实际实现 |
| 4 | "测试通过"7 维定义缺少量化阈值 | P2 | ⚠️ 建议补充具体数值 |

---

## 一、测试用例结构性问题（v8.0 审核）

### 1.1 "测试通过"7 维定义评估

**当前定义**：

> 1. 所有预期阶段按序执行
> 2. 每个阶段的 Agent 被正确调用
> 3. 每个 Agent 的工具调用链符合预期
> 4. 每个 Agent 的 LLM 调用次数符合预期
> 5. 阶段输出格式完整
> 6. 前端时间线正确渲染
> 7. WebSocket 事件序列完整

**问题**：缺少量化阈值，无法直接用于自动化断言。

**建议补充**：

| 维度 | 当前定义 | 建议量化标准 |
|------|---------|-------------|
| 阶段按序执行 | "按序执行" | `workflow.step.start` 序号差值 = 1 |
| Agent 调用 | "被正确调用" | `agent.start` 事件必须出现 |
| 工具调用链 | "符合预期" | `tool.start` 事件序列包含预期工具 |
| LLM 调用次数 | "符合预期" | `llm.start` 计数在 [min, max] 范围内 |
| 输出格式完整 | "完整" | 必填字段存在且类型正确 |
| 时间线渲染 | "正确渲染" | DOM 节点计数 ≥ 预期 |
| 事件序列 | "完整" | 序号连续无跳号 |

### 1.2 Mock 使用铁律评估

**当前允许 Mock 的场景**：

| 允许 Mock | 合理性 | 建议 |
|-----------|--------|------|
| BaseAgent.execute 接口验证 | ✅ 合理 | — |
| TaskContext 深拷贝测试 | ✅ 合理 | — |
| EventBus 回调调度测试 | ✅ 合理 | — |
| DI 容器解析测试 | ✅ 合理 | — |
| 数据库 CRUD 测试 | ✅ 合理 | — |
| 沙箱安全规则测试 | ✅ 合理 | — |
| Windows/Linux 兼容性验证 | ⚠️ 需区分 | 关键路径仍需真实测试 |

**问题**：`跨平台测试` 使用 Mock，但沙箱是关键路径，建议改为条件跳过而非完全 Mock。

---

## 二、指标体系缺陷（v8.0 审核）

### 2.1 MetricsCollector 事件订阅名称匹配问题

**潜在风险**：MetricsCollector 订阅的事件名称需要与 EventBus 实际发射的事件名称完全匹配。

**v8.0 订阅的事件**：

```python
event_bus.subscribe(f"{task_id}.*", self._on_event)  # 全局监听
event_bus.subscribe("llm.start", self._on_llm_start)
event_bus.subscribe("llm.end", self._on_llm_end)
event_bus.subscribe("tool.start", self._on_tool_start)
event_bus.subscribe("tool.end", self._on_tool_end)
event_bus.subscribe("agent.start", self._on_agent_start)
event_bus.subscribe("agent.end", self._on_agent_end)
event_bus.subscribe("workflow.step.start", self._on_step_start)
event_bus.subscribe("workflow.step.complete", self._on_step_complete)
```

**问题**：需要验证 Agent 源码中 EventBus.emit() 调用的实际事件名是否为上述名称。

**必须验证的 Agent 事件**：

| Agent | 源码中的事件名 | 是否匹配 MetricsCollector |
|-------|--------------|--------------------------|
| TopicResearchAgent | `topic_research.opensieve_search_start` | ⚠️ 前缀不匹配 |
| MaterialCollectionAgent | `material_collection.web_search_start` | ⚠️ 前缀不匹配 |
| ArticleWritingAgent | `article_writing.generation_start` | ⚠️ 前缀不匹配 |
| ContentAuditAgent | `content_audit.assess_start` | ⚠️ 前缀不匹配 |

**风险**：MetricsCollector 订阅的是 `llm.start`，但 Agent 可能发射的是 `topic_research.llm_start`。

**建议修复**：

```python
# 方案1: 订阅所有事件后过滤
event_bus.subscribe("*", self._on_all_events)

# 方案2: 添加前缀匹配
event_bus.subscribe("topic_research.*", self._on_topic_research)
event_bus.subscribe("material_collection.*", self._on_material_collection)
```

### 2.2 缺失的指标

| 指标 | v8.0 定义 | 实际采集 | 问题 |
|------|----------|---------|------|
| Memory 查询次数 | ✅ 定义了 | ❌ 未采集 | 需要在 MemoryManager 植入钩子 |
| Memory 写入次数 | ✅ 定义了 | ❌ 未采集 | 需要在 MemoryManager 植入钩子 |
| 压缩触发次数 | ✅ 定义了 | ❌ 未采集 | 需要 `context.warning` 事件 |
| 缓存命中率 | ✅ 定义了 | ❌ 未采集 | 需要 cache 工具返回 cached 字段 |
| 并行步骤重叠率 | ✅ 定义了 | ❌ 未采集 | 需要计算 `step.start` 时间差 |
| Human 节点停留时间 | ✅ 定义了 | ❌ 未采集 | 需要 `task.paused/resumed` 事件 |

---

## 三、Workflow 场景覆盖（v8.0 审核）

### 3.1 8 个 Workflow 测试用例评估

| Workflow | v8.0 状态 | 改进点 | 仍存在的问题 |
|----------|-----------|--------|-------------|
| **deep_article** | ✅ 8~11次LLM修正正确 | 预期事件表详细 | ⚠️ B1/B3 未修复验证 |
| **quick_post** | ✅ 1~2次LLM修正正确 | — | ⚠️ 简单场景可通过 |
| **trend_article** | ✅ web_search必须成功 | 热点数据验证要求明确 | ⚠️ TrendAnalysisAgent 是否真实调用 web_search |
| **seo_content** | ✅ fact_check用httpx HEAD | — | ⚠️ SEO关键词密度验证公式缺失 |
| **report_generation** | ✅ 并行步骤独立性验证 | 时间重叠要求明确 | ⚠️ B2 数据竞争未修复 |
| **multilingual** | ✅ 翻译质量验证 | — | ⚠️ 翻译质量无量化标准 |
| **multi_platform** | ✅ content_repurposer验证 | 平台变体数要求 | ⚠️ 风格差异无客观验证 |
| **image_article** | ✅ 图片URL可访问性验证 | HTTP 200要求 | ⚠️ pexels_image 工具是否实现 |

### 3.2 缺失的真实场景验证

| 验证项 | v8.0 状态 | 问题 |
|--------|---------|------|
| 热点数据真实性 | ⚠️ 要求但无验证方法 | 需通过搜索引擎验证时效性 |
| 翻译质量 | ⚠️ "不低于机器翻译基准" | 无量化标准（BLEU/chrF） |
| SEO关键词密度 | ⚠️ "关键词出现≥2次" | 无密度计算公式 |
| 图片URL可访问性 | ✅ HTTP 200要求 | 需真实HTTP请求测试 |
| 平台变体风格差异 | ⚠️ "风格有差异" | 无客观验证指标 |

---

## 四、模型通道问题（v8.0 审核）

### 4.1 模型配置状态

| 模型 | v8.0 配置 | 状态 | 说明 |
|------|----------|------|------|
| `doubao-api/deepseek-v3` | ✅ 默认执行模型 | ✅ 可用 | — |
| `doubao-api/gemini-2.5-pro` | ✅ 评审模型 | ⚠️ 需验证 | 需确认支持不同模型调用 |
| `doubao-web/chat` | ✅ 已替代 seed-2.0 | ⚠️ 需验证 | 原 seed-2.0 已停用 |
| `openroute/auto` | ✅ API通道 | ✅ 可用 | 主测试通道 |
| `arkcode/ark-code-latest` | ✅ coding档位 | ⚠️ 需验证 | 代码生成任务专用 |

### 4.2 网页版模型 Prompt 约束

**v8.0 提供的 Prompt 模板**：

```
你是FlowForge的写作Agent。你必须严格按照以下格式输出：
1. 如果需要搜索资料，输出:
   TOOL: web_search
   QUERY: <搜索关键词>
...
```

**问题**：
1. Prompt 约束是否能被所有网页版模型正确遵循？
2. 不同模型的遵循率可能不同
3. 需要实际测试验证

**建议**：
- CH-02/CH-04 通道测试必须验证 Prompt 约束的实际效果
- 验证 `TOOL: web_search\nQUERY: xxx` 格式被正确识别

---

## 五、两条执行路径测试设计（v8.0 审核）

### 5.1 Workflow API 路径测试评估

**v8.0 第十六章覆盖**：

| 测试 | 输入 | 覆盖情况 |
|------|------|---------|
| IT-WF-API-01 deep_article | 8步 | ✅ 完整 |
| IT-WF-API-02 quick_post | 3步 | ✅ 完整 |
| IT-WF-API-03 trend_article | 4步 | ✅ 完整 |
| IT-WF-API-04 seo_content | 6步 | ✅ 完整 |
| IT-WF-API-05 report_generation | 8步+并行 | ✅ 完整 |
| IT-WF-API-06 multilingual | 5步 | ✅ 完整 |
| IT-WF-API-07 multi_platform | 4步 | ✅ 完整 |
| IT-WF-API-08 image_article | 5步 | ✅ 完整 |

**优点**：
- 每个测试都有预期执行过程表
- 每个测试都有调用路径验证表
- 每个测试都有预期输出结构
- 每个测试都有指标记录模板

**问题**：
1. **"通过条件"未自动化**：仍需人工判断
2. **B1-B3 Bug 未修复验证**：测试用例标注"需代码修复前置条件"，但未提供修复后如何验证
3. **失败处理描述不具体**：未提供具体的调试步骤

### 5.2 Solo UI 路径测试评估

**v8.0 第十七章覆盖**：

| 测试 | 意图类型 | 覆盖情况 |
|------|---------|---------|
| IT-SOLO-01 | 简单问候 | ✅ Fast-path |
| IT-SOLO-02 | 写作意图 | ✅ Planning路径 |
| IT-SOLO-03 | 搜索意图 | ✅ Planning路径 |
| IT-SOLO-04 | 研究意图 | ✅ Planning路径 |
| IT-SOLO-05 | 翻译意图 | ✅ Fast/Planning |
| IT-SOLO-06 | 代码意图 | ✅ Planning路径 |
| IT-SOLO-07 | Plan降级 | ✅ 降级场景 |
| IT-SOLO-08 | 复杂多步 | ✅ 多Agent |
| IT-SOLO-09 | Fast-path负面 | ✅ 负面测试 |

**优点**：按意图类型设计，而非按 Workflow 名称，更符合实际使用场景。

**问题**：
1. **WebSocket 事件序列未定义**：只描述了"预期WebSocket事件序列"文本，未提供具体事件名
2. **"_is_simple_message()"边界不清晰**：哪些输入走 Fast-path，哪些走 Planning？

---

## 六、模式执行器测试（v8.0 审核）

### 6.1 模式执行器测试覆盖

| 模式 | v8.0 测试 | 覆盖情况 |
|------|----------|---------|
| ReAct | IT-MODE-01 | ✅ 循环检测 |
| Reflexion | IT-MODE-02 | ✅ 不收敛处理 |
| Agent-as-Judge | IT-MODE-03 | ✅ 不同模型验证 |
| PlanExecute | — | ❌ 缺失专项测试 |
| ReWOO | IT-MODE-06 | ✅ 蓝图生成+并行 |
| Self-Discover | IT-MODE-07 | ✅ 模式推荐 |
| GraphOfThoughts | IT-MODE-08 | ✅ 分支推理 |
| on_error策略 | IT-MODE-09 | ✅ 四种策略组合 |

**缺失**：
- PlanExecute 模式专项测试（只有 UT-PE-01~03 单元测试）
- Multi-Agent 三策略测试（只有 IT-MA/AT/SW 系列）

### 6.2 Reflexion 迭代验证问题

**v8.0 正确指出**：Reflexion 在 Workflow API 路径不生效（因为 WorkflowExecutor 跳过 mode executor）。

**但 IT-MODE-02 测试的是"模式执行器直接模式"**，不是 Workflow API 路径。

**问题**：
- IT-WF-API-01 的 writing 阶段写了 "Reflexion 迭代 1+N 次"，但实际上 Workflow API 路径不会有迭代
- 这会造成文档与实际行为不一致

**建议**：
- 在 IT-WF-API-01 的"失败处理"中明确说明：Reflexion 不生效不是 Bug，是架构设计限制
- 单独标注"A1: Workflow YAML mode 字段在 API 路径下无效"

---

## 七、前端 E2E 测试（v8.0 审核）

### 7.1 Playwright 断言代码评估

**v8.0 提供的断言**：

```javascript
expect(page.locator('[data-testid="timeline"]')).toBeVisible();
expect(page.locator('[data-testid="timeline-stage"]')).toHaveCount(4);
expect(page.locator('[data-testid="tool-node"]')).toBeVisible();
```

**问题**：
1. **`data-testid` 是否与前端实际实现一致？** 需要前端代码验证
2. **时间线容器结构**：是否真的是 `[data-testid="timeline"]`？
3. **工具节点图标选择器**：`扳手图标` 的 CSS 选择器是什么？

**建议**：
- 前端开发者需提供具体的 DOM 结构文档
- 或在 E2E 测试前先运行前端代码，用 Playwright 检查器确认选择器

### 7.2 E2E-SOLO-02 Workflow Solo 流程问题

**v8.0 描述的时间线节点**：

```
[阶段1: 选题研究] topic_research(rewoo)
[阶段2: 素材搜集] material_collection(rewoo)
[阶段3: 撰写] article_writing(reflexion)  // ← Workflow API路径不会有reflexion迭代
[阶段4: SEO优化] seo_optimization(plan_execute)
...
```

**问题**：Solo UI 走的是 `_execute_intelligent_chat()` 的 Planning 路径，不是执行 Workflow YAML。

**v8.0 已说明**：Solo UI路径不走Workflow YAML，走的是Planner LLM动态规划。

**但 E2E-SOLO-02 标题是"Workflow 完整 Solo 流程（deep_article）"**，这容易造成混淆。

**建议**：区分两种 Solo：
1. **Solo Planning 路径**：用户自由输入，LLM 动态规划
2. **Solo Workflow 路径**：用户选择预定义 Workflow，Executor 执行 YAML

---

## 八、代码修复前置条件验证（v8.0 审核）

### 8.1 B1-B4 修复状态追踪

| Bug | 描述 | 位置 | 阻塞的测试 | v8.0 验证方案 |
|-----|------|------|-----------|--------------|
| **B1** | ContentAuditAgent不支持judge_model | `content_audit.py` | 所有含audit步骤的Workflow | 验证audit阶段LLM模型≠执行阶段LLM模型 |
| **B2** | _execute_parallel数据竞争 | `workflow.py:790-804` | report_generation并行步骤 | 验证并行步骤输出互不污染 |
| **B3** | WorkflowExecutor跳过mode executor | `workflow.py:76-83` | Reflexion/ReWOO/AgentJudge在Workflow中 | 验证mode executor被调用 |
| **B4** | conftest.py Mock LLM | `tests/conftest.py` | 所有集成/E2E测试 | 验证真实LLM被调用 |

### 8.2 B1 修复验证方案

**代码修复要求**：

```python
# content_audit.py 改造后应支持
class ContentAuditAgent(BaseAgent):
    def __init__(self, ..., judge_model: str = None):
        self.judge_model = judge_model or os.getenv("DEFAULT_JUDGE_MODEL")
    
    async def _assess(self, context, input_data):
        llm_output = await self.llm.execute(
            prompt,
            model=self.judge_model  # 使用评审模型
        )
```

**测试验证**：

```python
async def test_audit_uses_different_model():
    # 1. 配置不同模型
    config = {
        "execution_model": "openroute/auto",
        "judge_model": "doubao-web/chat"
    }
    
    # 2. 执行 audit 步骤
    result = await content_audit.execute(input_data, context)
    
    # 3. 验证 LLM 调用时使用了 judge_model
    captured_model = capture_llm_model_calls()
    assert captured_model == "doubao-web/chat"
```

### 8.3 B2 修复验证方案

**代码修复要求**：

```python
# workflow.py _execute_parallel 改造后
async def _execute_parallel(self, steps, ctx):
    tasks = []
    for step in steps:
        # 每个并行任务使用独立上下文副本
        step_ctx = TaskContext.from_parent(
            ctx,
            state=copy.deepcopy(ctx.state)  # 独立副本
        )
        tasks.append(self._execute_single_step(step, step_ctx))
    
    results = await asyncio.gather(*tasks)
```

**测试验证**：

```python
async def test_parallel_isolation():
    # 执行 report_generation
    result = await workflow.execute(task)
    
    # 验证并行步骤输出独立
    assert result.materials_1 != result.materials_2
    assert "research_1" not in result.materials_2
    assert "research_2" not in result.materials_1
```

---

## 九、测试用例执行顺序（v8.0 审核）

### 9.1 v8.0 提供的执行顺序

```
Phase 0: 代码修复（测试前置条件）
Phase 1: 模型通道健康检查
Phase 2: 通道快速验证 (quick_post × 通道)
Phase 3: Workflow API 路径 E2E
Phase 4: Solo UI 路径 E2E
Phase 5: 模式执行器专项
Phase 6: 前端 Playwright E2E
Phase 7: 并发 + Circuit Breaker
Phase 8: 跨 Workflow 组合
Phase 9: API 业务正确性
Phase 10: 生成报告
```

**优点**：逻辑清晰，先验证通道，再验证功能，最后端到端。

**问题**：
1. **Phase 0 的代码修复没有具体时间表**：B1-B4 需要人工修复，无自动回归
2. **Phase 1 模型通道检查没有具体 API**：需要补充 `/v1/models` 或 `/health` 检查
3. **Phase 10 生成报告没有模板**：只提到模板在附录A，但执行时如何生成？

### 9.2 补充建议

**Phase 0 细化**：

```
Phase 0: 代码修复（前置条件）
  Day 1 AM:
    ├── 修复 B1: ContentAuditAgent judge_model 参数
    └── 验证: IT-WF-API-01 audit 模型验证

  Day 1 PM:
    ├── 修复 B2: _execute_parallel deepcopy
    └── 验证: IT-WF-API-05 并行输出独立性

  Day 2 AM:
    ├── 修复 B3: WorkflowExecutor mode executor
    └── 验证: IT-MODE-02 Reflexion 在 Workflow 中生效

  Day 2 PM:
    ├── 修复 B4: conftest_e2e.py
    └── 验证: FLOWFORGE_REAL_LLM=1 pytest tests/e2e/
```

**Phase 1 补充**：

```bash
# 模型通道健康检查命令
curl -s http://localhost:8889/health | jq '.models'
curl -s http://localhost:8889/api/v1/models | jq '.data[].id'
```

---

## 十、专业评审结论与建议

### 10.1 v8.0 评分

| 维度 | v7.0 | v8.0 | 改进 |
|------|------|------|------|
| **用例覆盖度** | 2/10 | 7/10 | +5 |
| **数据真实性** | 0/10 | 5/10 | +5（conftest_e2e.py） |
| **验证深度** | 1/10 | 6/10 | +5 |
| **前端覆盖** | 0/10 | 5/10 | +5 |
| **指标记录** | 0/10 | 5/10 | +5（MetricsCollector） |
| **模型配置** | 3/10 | 7/10 | +4 |
| **架构理解** | 2/10 | 8/10 | +6 |
| **预期设计** | 1/10 | 6/10 | +5 |
| **综合评分** | **1/10** | **6/10** | **+5** |

### 10.2 v8.0 仍需修复的问题

| 优先级 | 问题 | 工作量 | 负责方 |
|--------|------|--------|--------|
| **P0** | B1-B4 代码修复 | 2人天 | 开发团队 |
| **P0** | MetricsCollector 事件名匹配验证 | 1人天 | 测试团队 |
| **P1** | Playwright DOM 选择器与前端核对 | 0.5人天 | 前端+测试 |
| **P1** | PlanExecute 模式专项测试 | 1人天 | 测试团队 |
| **P2** | 翻译质量量化标准 | 1人天 | 产品+测试 |
| **P2** | SEO 关键词密度公式 | 0.5人天 | 产品+测试 |

### 10.3 修复优先级

```
P0 (立即修复):
  1. B1: ContentAuditAgent judge_model 参数
  2. B2: _execute_parallel deepcopy
  3. B3: WorkflowExecutor mode executor
  4. B4: conftest_e2e.py 真实 LLM

P1 (下一迭代):
  1. MetricsCollector 事件名匹配验证
  2. Playwright DOM 选择器核对
  3. PlanExecute 专项测试

P2 (后续优化):
  1. 翻译质量量化标准
  2. SEO 关键词密度公式
  3. "测试通过"量化阈值
```

---

## 附录 A：v8.0 优点清单

| # | 优点 | 说明 |
|---|------|------|
| 1 | 代码修复前置清单 | B1-B4 清晰列出，阻塞关系明确 |
| 2 | LLM 调用次数基于源码 | 不再基于假设 |
| 3 | 两条执行路径明确区分 | Workflow API vs Solo UI |
| 4 | MetricsCollector 可执行代码 | 可直接运行 |
| 5 | conftest_e2e.py 真实 LLM | 区分测试环境 |
| 6 | 预期输出结构明确 | JSON Schema 格式 |
| 7 | 调用路径验证表 | 每个 Workflow 都有 |
| 8 | 指标记录模板 | 每个测试都有 |
| 9 | 需求追溯矩阵 | 完整覆盖 |
| 10 | 附录 A 测试报告模板 | 可直接使用 |

---

## 附录 B：v8.0 待验证项

| # | 待验证项 | 验证方法 | 负责方 |
|---|---------|---------|--------|
| 1 | B1 修复后 audit 使用不同模型 | 拦截 LLM 调用，检查 model 参数 | 测试 |
| 2 | B2 修复后并行输出独立 | 执行 report_generation，比对输出 | 测试 |
| 3 | B3 修复后 mode executor 被调用 | 添加日志，执行带 mode 的 Workflow | 测试 |
| 4 | B4 修复后真实 LLM 被调用 | FLOWFORGE_REAL_LLM=1，执行测试，检查 API 调用 | 测试 |
| 5 | MetricsCollector 事件匹配 | 执行测试，检查指标报告 | 测试 |
| 6 | Playwright 选择器正确 | 运行前端，执行 E2E | 前端+测试 |
| 7 | 网页版 Prompt 约束生效 | CH-02 测试验证输出格式 | 测试 |

---

> **审核人**: AI Agent 测试工程师 M27-R2
> **审核日期**: 2026-05-24
> **核心结论**: v8.0 测试用例质量显著提升（综合评分从 1/10 提升到 6/10），结构清晰，文档完善。但仍有 P0 级别的代码修复（B1-B4）待验证，建议修复后再进行完整回归测试。
