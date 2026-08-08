# T019: E2E 测试报告模板 + Bug 分类体系

> **状态**: ✅ done
> **创建日期**: 2026-07-19
> **负责人**: 测试员可进化智能体（蜜獾·平头哥）
> **测试类别**: 测试报告 + Bug 分类
> **关联 spec.md**: [doc:../spec.md]
> **关联 arch.md**: [doc:../arch.md]
> **关联 design.md**: [doc:../design.md]
> **测试铁律**: 已应用 T1-T8（详见 [doc:rules.md#T1-T8]）
> **命名规范**: 已应用 v2.0（详见 [doc:design/naming-contract.md]）

---

## 1. E2E 测试报告模板

```markdown
# FlowForge E2E 测试报告

> 日期: YYYY-MM-DD
> 执行人: 测试员可进化智能体（蜜獾·平头哥）
> 代码基础: Agent 源码审查完成

## 一、模型通道健康

| 通道 | 状态 | 延迟(ms) | 备注 |
|------|------|---------|------|
| openroute/auto | ✅/❌ | - | 执行模型 |
| openroute/doubao-web/chat | ✅/❌ | - | 评审模型 |
| arkcode/ark-code-latest | ✅/❌ | - | 编码模型 |
| openroute-api | ✅/❌ | - | 备用通道 |

## 二、Workflow API 路径结果

| ID | Workflow | 步骤 | 通道 | 状态 | LLM | Tool | 耗时 | 备注 |
|----|---------|------|------|------|-----|------|------|------|
| IT-WF-API-01 | deep_article | 8 | - | - | - | - | - | - |
| IT-WF-API-02 | quick_post | 3 | - | - | - | - | - | - |
| IT-WF-API-03 | trend_article | 4 | - | - | - | - | - | - |
| IT-WF-API-04 | seo_content | 6 | - | - | - | - | - | - |
| IT-WF-API-05 | report_generation | 8+并 | - | - | - | - | - | - |
| IT-WF-API-06 | multilingual | 5 | - | - | - | - | - | - |
| IT-WF-API-07 | multi_platform | 4 | - | - | - | - | - | - |
| IT-WF-API-08 | image_article | 5 | - | - | - | - | - | - |
| IT-WF-NEG-01~08 | 负向/异常 | - | - | - | - | - | - | - |

## 三、Helm UI 路径结果（按意图类型）

| ID | 意图类型 | 状态 | LLM | Tool | 时间线节点 | 备注 |
|----|---------|------|-----|------|----------|------|
| IT-HELM-01 | 简单问候（Fast-path） | - | - | - | - | - |
| IT-HELM-02 | 写作意图 | - | - | - | - | - |
| IT-HELM-03 | 搜索意图 | - | - | - | - | - |
| IT-HELM-04 | 研究意图 | - | - | - | - | - |
| IT-HELM-05 | 翻译意图（Planning 路径） | - | - | - | - | - |
| IT-HELM-06 | 代码意图 | - | - | - | - | - |
| IT-HELM-07 | Plan 降级 | - | - | - | - | - |
| IT-HELM-08 | 复杂多步 | - | - | - | - | - |
| IT-HELM-09 | Fast-path 负面 | - | - | - | - | - |
| IT-HELM-NEG-01~05 | 负向/异常 | - | - | - | - | - |

## 四、前端 E2E 结果

| ID | 场景 | 状态 | 备注 |
|----|------|------|------|
| E2E-HELM-01 | ReAct Helm 流程 | - | - |
| E2E-HELM-02 | Workflow Helm 流程 | - | - |
| E2E-HELM-03 | 断线重连 | - | - |
| E2E-HELM-04 | 审核交互 | - | - |

## 五、并发与容错

| ID | 场景 | 状态 | 备注 |
|----|------|------|------|
| IT-CONC-01 | 10 并发 | - | - |
| IT-CONC-02 | 同 persona 冲突 | - | - |
| IT-CB-01 | 熔断 | - | - |
| IT-CB-02 | 429 重试 | - | - |

## 六、跨 Workflow

| ID | 场景 | 状态 | 备注 |
|----|------|------|------|
| IT-CROSS-01 | deep → quick | - | - |
| IT-CROSS-02 | deep → multi | - | - |

## 七、关键指标汇总

| 指标 | 总计 | 均值/Workflow | 达标 |
|------|------|-------------|------|
| 总 LLM 调用次数 | - | - | - |
| 总工具调用次数 | - | - | - |
| Agent-as-Judge 不同模型 | -/2 | - | - |
| Reflexion 生效 (仅模式执行器直接模式) | -/0 | - | - |
| 并行步骤时间重叠 | -/1 | - | - |
| WebSocket 事件丢包 | - | - | - |
| 时间线渲染出错 | - | - | - |
| 流式渲染完整 | - | - | - |

## 八、MetricsCollector 指标报告(JSON)

\`\`\`json
{
  "task_id": "-",
  "total_duration_seconds": "-",
  "llm": {"total_calls": "-", "by_agent": "-", "model_chain": "-"},
  "tool": {"total_calls": "-", "chain": "-", "success_rate": "-"},
  "agent": {"total_calls": "-", "chain": "-"},
  "workflow": {"steps": "-", "step_count": "-"},
  "memory": {"queries": "-", "writes": "-", "compactions": "-"},
  "websocket": {"total_events": "-", "sequence_gaps": "-"}
}
\`\`\`

## 九、调用路径验证结果

| Workflow | 阶段 | 预期路径 | 实际路径 | 状态 |
|---------|------|---------|---------|------|
| deep_article | topic_research | cache→web_search→llm | - | - |
| deep_article | writing | llm.generate | - | - |
| deep_article | fact_check | httpx HEAD×N | - | - |
| deep_article | audit | llm.assess→llm.compliance | - | - |
| quick_post | topic_research | cache→web_search→llm | - | - |
| quick_post | writing | llm.generate | - | - |
| quick_post | publish | publish_local | - | - |
| trend_article | trend_analysis | web_search→llm→llm | - | - |
| seo_content | seo_opt | llm.planning→llm.optimize | - | - |
| report_generation | parallel | web_search→llm (×2 并行) | - | - |
| multilingual | translate | llm.detect→llm.translate | - | - |
| multi_platform | repurposer | llm×N | - | - |
| image_article | image_research | pexels_image→llm | - | - |

## 十、Bug 修复追踪

| Bug | 修复状态 | 修复日期 | 回归测试 | 回归结果 |
|-----|---------|---------|---------|---------|
| B1 | ⏳ 待修复 | — | IT-WF-API-01 audit 模型验证 | — |
| B2 | ⏳ 待修复 | — | IT-WF-API-05 并行输出独立性 | — |
| B3 | ⏳ 待修复 | — | IT-MODE-02 Reflexion 在 Workflow 中生效 | — |
| B4 | ⏳ 待修复 | — | 所有 E2E 测试使用真实 LLM | — |

## 十一、发现的问题

| # | 问题 | 严重度 | 根因 | 修复状态 |
|---|------|--------|------|---------|
| 1 | content_audit 未用独立模型 | P0 | Agent 代码硬编码 | 待修复 |
| 2 | Reflexion 在 Workflow 中不生效 | P1 | WorkflowExecutor 跳过 mode | 待修复 |
| 3 | doubao-web 需特殊 Prompt 约束 | P1 | 网页版无 tool_calls | 已适配 |

## 十二、结论

| 通过率 | Workflow API | Helm UI | 前端 E2E | 并发 | 综合 |
|--------|:---:|:---:|:---:|:---:|:---:|
| 目标 | 8/8 | 9/9 | 4/4 | 4/4 | 25/25 |
| 实际 | -/8 | -/9 | -/4 | -/4 | -/25 |

🟢/🔴 **通过/不通过** — 说明
```

---

## 2. 架构问题 vs Bug 分类体系

> **核心区分**：明确区分"架构设计问题"（需要设计决策）和"代码 Bug"（必须修复），分别设计验证方案。

### 2.1 代码 Bug（必须修复）

| # | Bug | 严重度 | 位置 | 修复方案 | 修复验证测试 |
|---|-----|--------|------|---------|------------|
| B1 | ContentAuditAgent 不支持 judge_model 参数 | P0 | `content_audit.py` | Agent 接收 judge_model 参数，LLM 调用时传递 model 参数 | 修复后：audit 阶段 LLM 模型 ≠ 执行阶段 LLM 模型 |
| B2 | `_execute_parallel` 数据竞争 | P0 | `workflow.py:790-804` | 使用 `copy.deepcopy(context_data)` | 修复后：并行步骤输出互不污染 |
| B3 | WorkflowExecutor 跳过 mode executor | P1 | `workflow.py:76-83` | 当步骤声明 mode 时，通过 mode executor 路由 | 修复后：Workflow 中 reflexion/react/agent_judge 模式生效 |
| B4 | conftest.py Mock LLM | P0 | `tests/conftest.py` | 区分单元/集成环境，增加 `conftest_e2e.py` | 修复后：集成测试使用真实 LLM |

### 2.2 架构设计问题（需要设计决策）

| # | 问题 | 严重度 | 影响 | 建议 | 验证方案 |
|---|------|--------|------|------|---------|
| A1 | Workflow YAML 的 mode 字段在 API 路径下无效 | P1 | 用户配置的 mode 被忽略 | 方案 1: 让 WorkflowExecutor 尊重 mode 字段；方案 2: 文档化说明 mode 仅在 Helm 路径生效 | 标注为"设计限制"，Helm 路径验证 mode 生效 |
| A2 | Helm UI 和 Workflow API 事件格式不统一 | P1 | 前端需要两套渲染逻辑 | 方案 1: 统一事件格式；方案 2: EventBusHelmAdapter 增加 Agent 内部事件映射 | 分别验证两条路径的事件格式 |
| A3 | Helm UI 路径与 Workflow YAML 步骤不匹配 | P1 | Helm UI 走 Planner 动态规划，不执行 YAML 定义的步骤 | 文档化说明两条路径的差异 | Helm UI 测试按意图类型设计（见 [doc:T007-helm-ui-e2e.md]） |
| A4 | DI 容器实际是全局单例（deps.py） | P2 | 违反铁律 3 | 迁移到真正的 DI 容器 | P2 优先级，后续迭代 |

### 2.3 叠加效应分析

当前 Workflow 端到端跑不通的根因是"架构设计问题 + 代码 Bug"叠加：

1. WorkflowExecutor 跳过 mode executor（A1/B3）→ Reflexion/AgentJudge 不生效
2. ContentAuditAgent 无 judge_model（B1）→ 审核评分无独立性
3. 事件格式不统一（A2）→ 前端时间线渲染异常
4. Mock 测试环境（B4）→ 测试无法发现上述问题
5. Helm UI 走 Planner 而非 YAML（A3）→ Helm 测试预期错误

### 2.4 修复追踪表

| Bug | 修复状态 | 修复日期 | 回归测试 | 回归结果 |
|-----|---------|---------|---------|---------|
| B1 | ⏳ 待修复 | — | IT-WF-API-01 audit 模型验证 | — |
| B2 | ⏳ 待修复 | — | IT-WF-API-05 并行输出独立性 | — |
| B3 | ⏳ 待修复 | — | IT-MODE-02 Reflexion 在 Workflow 中生效 | — |
| B4 | ⏳ 待修复 | — | 所有 E2E 测试使用真实 LLM | — |

---

## 3. Bug 严重度定义

| 级别 | 含义 | SLA |
|------|------|-----|
| **P0** | 阻塞核心功能，必须立即修复 | 24h 内修复 |
| **P1** | 影响重要功能，必须本迭代修复 | 7 天内修复 |
| **P2** | 影响次要功能或可绕过 | 30 天内修复 |
| **P3** | 体验问题或不影响功能 | 下次迭代修复 |

---

## 4. Bug 报告模板

```markdown
### Bug: [简短描述]

**Bug ID**: BUG-YYYY-NNN
**严重度**: P0/P1/P2/P3
**类型**: 代码 Bug / 架构问题
**报告人**: 测试员可进化智能体（蜜獾·平头哥）
**报告日期**: YYYY-MM-DD

**环境**：
- FlowForge 版本: vX.Y.Z
- 操作系统: Windows 11 / Linux
- Python 版本: 3.11+

**复现步骤**：
1. ...
2. ...
3. ...

**预期行为**：
...

**实际行为**：
...

**日志/截图**：
\`\`\`
[日志内容]
\`\`\`

**根因分析**：
...

**修复方案**：
...

**回归测试**：
- 测试用例 ID: IT-XXX-XX
- 测试结果: PASS/FAIL
```

---

## 5. 引用

- [doc:../spec.md]
- [doc:../arch.md]
- [doc:../design.md]
- [doc:rules.md#T1-T8]
- [doc:design/naming-contract.md]
- [doc:T002-test-strategy.md]（B1-B4 代码修复前置清单）
- [doc:TEMPLATE.md]

---

## 6. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v1.0 | 初始创建：从原 test.md 附录 A + B 拆分，覆盖 E2E 测试报告模板 + Bug 分类体系 + 严重度定义 + Bug 报告模板 | 测试员可进化智能体（蜜獾·平头哥） |
