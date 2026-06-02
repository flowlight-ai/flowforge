
# FlowForge 测试用例专业审核报告（豆包版）

**审核日期：** 2026-05-24  
**审核人员：** AI 智能体测试工程师  
**审核范围：** `flowforge/docs/test.md` 测试用例文档、实际代码实现（WorkflowExecutor、Agent、Model配置等）  
**审核级别：** 🔴 严重问题，必须修复

---

## 一、审核结论

经过对测试文档与实际代码的深度对比审查，**test.md v8.0 存在以下重大问题**，导致测试无法发现真实系统问题：

| 问题等级 | 数量 | 说明 |
|---------|------|------|
| 🔴 P0 致命 | 5 | 完全阻断测试，假数据/假逻辑/假路径 |
| 🟠 P1 严重 | 6 | 测试设计与实际架构严重不符 |
| 🟡 P2 一般 | 4 | 测试覆盖不足，指标缺失 |
| 🟢 P3 轻微 | 2 | 文档规范问题 |

---

## 二、P0 致命问题（必须立即修复）

### 🔴 P0-1: 全量 Mock LLM，零真实调用测试

**问题描述：**
- `tests/conftest.py` 完全使用 MockLLM，没有真实 LLM 测试基础设施
- v8.0 新增的 `conftest_e2e.py` 仅在文档中提及，**代码中完全不存在**
- 所有测试都是假数据，上线必崩

**代码证据：**
```python
# tests/conftest.py (当前) - 全量 Mock
@ pytest.fixture
def mock_llm_tool():
    class MockLLM(BaseTool):
        name = "llm"
        async def execute(self, input: ToolInput) -> ToolOutput:
            return ToolOutput(result={"content": '{"score": 0.9, "issues": []}'})
    return MockLLM()

# v8.0 文档中提及的 conftest_e2e.py - 不存在
```

**影响：**
- 无法发现真实 LLM 输出格式问题
- 无法验证模型通道（OpenRoute 网页版/API 版）
- 测试通过率 100%，但系统上线直接崩溃

**修复要求：**
1. 新增 `tests/conftest_e2e.py`，提供真实 LLM 测试基础设施
2. 新增 `@pytest.mark.e2e` 标记，区分单元测试与端到端测试
3. 新增 `FLOWFORGE_REAL_LLM=1` 环境变量控制

---

### 🔴 P0-2: Workflow 路径预期与实际完全不符

**问题描述：**
test.md 假设 Workflow 步骤会执行 mode executor，但实际 WorkflowExecutor 完全跳过了模式执行器：

**代码证据：**
```python
# modes/workflow.py L76-L133 - 关键问题
if agent_name and ctx.agents:  # 如果步骤有 agent
    agent = ctx.agents.get(agent_name)
    if agent:
        # ⚠️ 直接调用 agent.execute_with_context()
        # ⚠️ 完全跳过了 mode executor！
        agent_output = await agent.execute_with_context(agent_input, ctx)
        # Reflexion/Rewoo/AgentJudge 模式统统不生效！
```

**test.md 错误假设：**
```yaml
# 工作流定义
steps:
  - name: "writing"
    agent: "article_writing"
    mode: "reflexion"  # ❌ 实际被 WorkflowExecutor 完全忽略
```

**影响：**
- Workflow 路径下 Reflexion 不迭代，LLM 调用次数预期错误（预期多次，实际 1 次）
- AgentJudge 不使用独立模型
- 测试预期与真实行为 100% 不符

---

### 🔴 P0-3: ContentAuditAgent 不支持独立 Judge 模型

**问题描述：**
test.md 要求评审使用不同模型，但 ContentAuditAgent 实现：

**代码证据：**
```python
# agents/content_audit.py L34-L77 - 没有 model 参数
async def execute_with_context(self, input: AgentInput, context: TaskContext):
    # Step 1: 质量评估
    assess_result = await llm.execute(ToolInput(params={
        # ❌ 没有传入 model 参数
        "messages": [...],
        "agent_name": self.name,
    }))
    
    # Step 2: 合规性检查
    compliance_result = await llm.execute(ToolInput(params={
        # ❌ 同样没有 model 参数，两次调用同一模型
        "messages": [...],
        "agent_name": f"{self.name}_compliance",
    }))
```

**影响：**
- test.md 要求 "评审打分必须使用不同的 Agent 和模型" 无法验证
- LLM 调用链验证失败
- 模型分配验证完全缺失

---

### 🔴 P0-4: 并行步骤数据竞争 Bug

**问题描述：**
`_execute_parallel` 方法没有为并行任务创建独立的 context 副本：

**代码证据：**
```python
# modes/workflow.py L790-L804 - 数据竞争
async def _execute_parallel(self, ctx, group, context_data):
    results = {}
    tasks = []
    for item in group:
        mode = item.get("mode", "plan_execute")
        sub_ctx = TaskContext.from_parent(ctx, input_data=context_data)
        # ❌ 所有并行任务共享同一个 context_data 引用
        # ❌ 没有使用 copy.deepcopy() 隔离
        tasks.append(ctx.executor.run(sub_ctx, ...))
    completed = await asyncio.gather(*tasks, ...)
    # 数据污染风险！
```

**影响：**
- `report_generation` 并行步骤测试失败
- 数据污染导致测试非确定性

---

### 🔴 P0-5: Solo UI 路径测试完全缺失

**问题描述：**
- test.md 宣称覆盖 Solo UI 路径，但实际没有 Playwright/E2E 测试代码
- WebSocket 事件测试缺失
- 前端时间线渲染验证缺失

**影响：**
- 无法验证用户从 Web UI 发起的真实场景
- 无法发现前端时间线渲染 Bugs

---

## 三、P1 严重问题

### 🟠 P1-1: LLM 调用次数预期基于错误假设

**问题：**
test.md 预期 deep_article 调用 8-11 次 LLM，但基于错误的模式执行假设。真实 LLM 调用：

| Agent | 预期（错误） | 实际（基于代码） |
|------|------------|----------------|
| topic_research | 1-2 次 | 0-1 次（工具成功则不调用） |
| material_collection | 2-4 次 | 2-4 次（正确） |
| article_writing | 3-5 次（Reflexion） | 1 次（无模式） |
| seo_optimization | 2 次 | 2 次（正确） |
| fact_check | 1 次 | 1 次（正确） |
| content_audit | 2 次（不同模型） | 2 次（相同模型） |
| **总计** | **9-14 次** | **6-10 次** |

---

### 🟠 P1-2: FactCheckAgent 使用 httpx HEAD 不是 web_search

**test.md 错误描述：**
> FactCheckAgent 使用 web_search 验证事实

**代码事实：**
FactCheckAgent 使用 httpx HEAD 请求验证 URL 可访问性，不调用 web_search 工具。

---

### 🟠 P1-3: TrendAnalysisAgent 没有强制 web_search 成功断言

**问题描述：**
test.md 要求 TrendAnalysisAgent 必须调用 web_search，但没有断言验证如果 web_search 失败会降级到 LLM 编造数据的情况。

---

### 🟠 P1-4: 缺少 MetricsCollector 可执行代码

**问题：**
test.md v8.0 宣称升级 MetricsCollector 为可执行代码，但**实际不存在**。只有文档描述，没有实现。

---

### 🟠 P1-5: 测试通过标准定义不完整

**问题：**
test.md 定义了 "测试通过" 但缺少：
- ❌ Agent 内部事件序列验证
- ❌ 工具调用链完整验证
- ❌ Memory 操作记录验证
- ❌ 模型分配验证

---

### 🟠 P1-6: OpenRoute 通道测试计划不完整

**问题：**
- 缺少 OpenRoute API 版与网页版的对比测试
- 缺少模型降级测试
- 缺少通过 `models.yaml` 禁用失败模型的测试

---

## 四、P2 一般问题

### 🟡 P2-1: 缺少 Agent 内部事件验证

test.md 只验证 `workflow.step.start/complete`，不验证 Agent 内部事件：

```
topic_research.cache_check_start → topic_research.cache_check_complete
topic_research.opensieve_search_start → topic_research.opensieve_search_complete
...
```

---

### 🟡 P2-2: Memory 指标记录完全缺失

- 缺少 Memory 查询/写入次数验证
- 缺少缓存命中率验证
- 缺少 SessionManager 压缩触发验证

---

### 🟡 P2-3: 缺少工作流失败场景测试

没有测试：
- 工具超时后的错误处理
- on_error=skip/retry/reflexion_retry 策略
- LLM 失败降级

---

### 🟡 P2-4: 缺少通用 Agent/Workflow 测试

test.md 只测试业务工作流，不测试通用 Agent（generic/*）。

---

## 五、代码修复清单（按优先级）

### Phase 1: P0 修复（24小时内）

| # | 修复项 | 文件 | 预计工作量 |
|---|-------|------|----------|
| 1 | 创建 `tests/conftest_e2e.py` 真实 LLM 基础设施 | tests/ | 2h |
| 2 | 修复 ContentAuditAgent 支持 judge_model 参数 | agents/content_audit.py | 1h |
| 3 | 修复 WorkflowExecutor 并行步骤数据竞争 | modes/workflow.py | 30m |
| 4 | 修正模型配置：移除 seed-2.0 残留 | config/models.yaml | 10m |

### Phase 2: P1 修复（3天内）

| # | 修复项 | 预计工作量 |
|---|-------|----------|
| 5 | 修正所有测试用例的 LLM 调用次数预期 | docs/test.md | 3h |
| 6 | 修正 FactCheckAgent 工具调用描述 | docs/test.md | 30m |
| 7 | 新增 TrendAnalysisAgent web_search 强制成功断言 | docs/test.md | 1h |
| 8 | 创建 MetricsCollector 实现 | observability/ | 2h |

### Phase 3: P2 完善（1周内）

| # | 修复项 | 预计工作量 |
|---|-------|----------|
| 9 | 新增 Agent 内部事件验证 | tests/e2e/ | 3h |
| 10 | 新增 Memory 指标验证 | tests/e2e/ | 2h |
| 11 | 新增工作流失败场景测试 | tests/e2e/ | 3h |
| 12 | 新增通用 Agent 测试 | tests/unit/ | 2h |

---

## 六、测试覆盖审计表（当前状态）

| 测试维度 | 计划覆盖 | 实际覆盖 | 完成率 |
|---------|---------|---------|-------|
| 真实 LLM 调用 | 100% | 0% | ❌ 0% |
| Workflow API 路径 | 8 Workflows | 0% | ❌ 0% |
| Solo UI 路径 | 完整 | 0% | ❌ 0% |
| 模型通道验证 | 4+ 通道 | 0% | ❌ 0% |
| Agent 内部事件 | 完整 | 0% | ❌ 0% |
| 工具调用链验证 | 完整 | 0% | ❌ 0% |
| Memory 指标 | 完整 | 0% | ❌ 0% |
| 前端时间线渲染 | 完整 | 0% | ❌ 0% |
| **总体完成率** | - | - | **🔴 0%** |

---

## 七、架构问题 vs Bug 分类

### 架构问题（Feature Request）

1. **WorkflowExecutor 是否应该支持 mode executor？**
   - 当前设计：有 agent 则跳过 mode
   - 建议：明确文档化此行为，或提供 `force_mode: true` 选项

2. **Solo UI 路径与 Workflow API 路径事件格式不一致**
   - Workflow API: Agent 内部事件（topic_research.*）
   - Solo UI: 动态规划事件（workflow.step.*）
   - 建议：统一或明确文档化

### Bug（立即修复）

1. ContentAuditAgent 不支持独立 judge_model
2. WorkflowExecutor 并行步骤数据竞争
3. conftest_e2e.py 缺失

---

## 八、执行验证计划

### 验证前检查清单

- [ ] P0 修复完成
- [ ] OpenRoute 服务运行于 http://127.0.0.1:13000
- [ ] 环境变量配置：`FLOWFORGE_REAL_LLM=1`
- [ ] `doubao-web/chat` 模型已启用

### 验证步骤

**1. OpenRoute API-only 模式验证**
```bash
# 设置环境变量
$env:FLOWFORGE_USE_OPENROUTE_WEB="0"
# 运行 E2E 测试
pytest tests/e2e/ -m e2e
```

**2. OpenRoute 网页版模式验证**
```bash
$env:FLOWFORGE_USE_OPENROUTE_WEB="1"
pytest tests/e2e/ -m e2e
```

**3. 失败模型处理验证**
- 禁用一个模型，验证降级
- 启用修复后的 ContentAuditAgent，验证双模型调用

---

## 九、审核总结与最终评分

### 各维度评分

| 维度 | 评分 (0-10) | 原因 |
|------|------------|------|
| 测试用例覆盖完整性 | 3/10 | 有规划但完全基于错误假设 |
| 数据真实性 | 0/10 | 全量 Mock，无真实测试 |
| 验证深度 | 0/10 | 无调用链/指标/事件验证 |
| 前端测试 | 0/10 | 无 Playwright，无 WebSocket 测试 |
| 模型通道测试 | 0/10 | 有文档但无实际代码 |
| 文档与代码一致性 | 1/10 | 多处严重不符 |
| **综合评分** | **🔴 0/10** | **必须完全重写并修复代码** |

---

## 十、下一步行动建议

### 立即行动（24小时内）

1. ✅ 创建审核报告（已完成）
2. 🔧 修复 P0 问题（4项）
3. 📝 重写 test.md，完全基于实际代码行为

### 短期行动（3天内）

4. 🔧 修复 P1 问题（6项）
5. 🧪 创建真实 E2E 测试基础设施
6. 🧪 执行 OpenRoute API 版验证

### 中期行动（1周内）

7. 🧪 执行 OpenRoute 网页版验证
8. 🔧 完善 P2 问题
9. 📊 生成完整测试报告

---

**报告完成时间：** 2026-05-24 20:15  
**审核人：** AI 智能体测试工程师（豆包版）  
**报告版本：** v1.0

