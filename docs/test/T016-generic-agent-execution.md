# T016: 通用 Agent + 执行顺序 + 需求追溯矩阵

> **状态**: ✅ done
> **创建日期**: 2026-07-19
> **负责人**: 测试员可进化智能体（蜜獾·平头哥）
> **测试类别**: 单元测试 + E2E 测试 + 追溯矩阵
> **关联 spec.md**: [doc:../spec.md]（FR-ENG-03, FR-ENG-06）
> **关联 arch.md**: [doc:../arch.md]（§5.1, §10.3）
> **关联 design.md**: [doc:../design.md]（§7.1-§7.7）
> **测试铁律**: 已应用 T1-T8（详见 [doc:rules.md#T1-T8]）
> **命名规范**: 已应用 v2.0（详见 [doc:design/naming-contract.md]）

---

## 1. 通用 Agent 单元测试（UT-GA-01~17）

> **说明**：通用 Agent 是 FlowForge 内置的 17 个静态智能体（Static Agent），通过命名契约 §2.1 分类。

| 测试 ID | Agent | 测试内容 | 预期行为 | 预期输出结构 |
|--------|-------|---------|---------|-------------|
| UT-GA-01 | Planner | 接收任务输入，输出执行计划 | plan 包含 ≥ 1 个步骤 | `{"plan": [{"name": str, "type": str, "tool/agent": str}], "step_count": int(≥1)}` |
| UT-GA-02 | Executor | 按计划执行工具调用 | 正确调用指定工具 | `{"result": object, "tool_called": str}` |
| UT-GA-03 | Verifier | 验证执行结果 | 返回验证结果和评分 | `{"score": float(0~1), "issues": list, "passed": bool}` |
| UT-GA-04 | Reviewer | 审查内容质量 | 返回审查意见 | `{"verdict": str, "feedback": str}` |
| UT-GA-05 | Drafter | 生成初稿 | 输出非空文本 | `{"draft": str(min_length=50), "word_count": int(≥50)}` |
| UT-GA-06 | Critic | 批评初稿问题 | 返回问题列表 | `{"issues": list(min_count=1), "severity": str}` |
| UT-GA-07 | Refiner | 根据批评改进 | 输出改进版本 | `{"refined": str(min_length=50), "improvements": list}` |
| UT-GA-08 | Analyst | 分析数据/信息 | 返回分析结论 | `{"analysis": str, "conclusion": str}` |
| UT-GA-09 | Processor | 处理/转换数据 | 返回处理结果 | `{"output": object, "transform": str}` |
| UT-GA-10 | Validator | 校验数据合规性 | 返回校验结果 | `{"valid": bool, "violations": list}` |
| UT-GA-11 | Deliverer | 交付最终产物 | 返回交付物 | `{"deliverable": object, "status": str}` |
| UT-GA-12 | Finalizer | 最终整理 | 返回最终输出 | `{"final_output": object, "summary": str}` |
| UT-GA-13 | Approver | 审批通过/驳回 | 返回审批决定 | `{"approved": bool, "reason": str}` |
| UT-GA-14 | Generator | 生成内容 | 输出非空内容 | `{"content": str(min_length=10), "type": str}` |
| UT-GA-15 | ReactThinker | ReAct 思考步骤 | 输出 Thought | `{"thought": str, "step": int}` |
| UT-GA-16 | ReactActor | ReAct 行动步骤 | 输出 Action | `{"action": str, "tool": str, "input": object}` |
| UT-GA-17 | ReactObserver | ReAct 观察步骤 | 输出 Observation | `{"observation": str, "result": object}` |

---

## 2. 通用 Workflow E2E 测试（IT-GEN-WF-01~05）

| 测试 ID | Workflow 模板 | 测试内容 | 预期行为 |
|--------|-------------|---------|---------|
| IT-GEN-WF-01 | generic_pipeline | 线性管道：Planner→Executor→Verifier→Deliverer | 4 步骤按序执行 |
| IT-GEN-WF-02 | generic_iterative | 迭代优化：Drafter→Critic→Refiner（循环 N 次） | 迭代 ≤ MAX_ITERATIONS |
| IT-GEN-WF-03 | generic_plan_execute | 计划执行：Planner→Executor×N | 计划步骤全部执行 |
| IT-GEN-WF-04 | generic_react | ReAct 循环：Thinker→Actor→Observer | 步骤 ≤ MAX_STEPS=8 |
| IT-GEN-WF-05 | generic_review | 审核流程：Drafter→Reviewer→(Refiner)→Approver | 审核通过或驳回 |

### 2.1 IT-GEN-WF-01 线性管道测试代码

```python
import pytest

@pytest.mark.asyncio
async def test_it_gen_wf_01_linear_pipeline():
    """IT-GEN-WF-01: 线性管道 Planner→Executor→Verifier→Deliverer"""
    workflow_def = {
        "name": "generic_pipeline",
        "steps": [
            {"name": "plan", "agent": "planner"},
            {"name": "execute", "agent": "executor"},
            {"name": "verify", "agent": "verifier"},
            {"name": "deliver", "agent": "deliverer"},
        ]
    }
    result = await execute_workflow(workflow_def, input_data={"task": "测试任务"})

    # 4 步骤按序执行
    assert len(result["steps_executed"]) == 4
    assert result["steps_executed"] == ["plan", "execute", "verify", "deliver"]

    # 最终输出非空
    assert result["final_output"]
```

---

## 3. 测试执行顺序（Phase 0-10）

```
Phase 0: 代码修复（测试前置条件）
  ├── 修复 doubao-web/chat 模型名
  ├── 修复 content_audit Agent 支持独立 judge_model
  ├── 修复 WorkflowExecutor mode executor 回退
  └── OpenRoute API 通道预检

Phase 1: 模型通道健康检查
  ├── doubao-api ping → PASS/FAIL
  ├── doubao-web/chat ping → PASS/FAIL
  ├── openroute-api ping → PASS/FAIL
  └── openroute-web ping → PASS/FAIL

Phase 2: 通道快速验证 (quick_post × 通道)
  ├── CH-01: openroute/api → PASS/FAIL
  ├── CH-02: doubao-web/chat → PASS/FAIL (FAIL → 修正 Prompt)
  ├── CH-03: openroute/api (deep_article) → PASS/FAIL
  ├── CH-04: doubao-web/chat (deep_article) → PASS/FAIL
  └── CH-05: arkcode/ark-code-latest → PASS/FAIL

Phase 3: Workflow API 路径 E2E (以通过的主通道为准)
  ├── IT-WF-API-01: deep_article (8 步)
  ├── IT-WF-API-02: quick_post (3 步)
  ├── IT-WF-API-03: trend_article (4 步)
  ├── IT-WF-API-04: seo_content (6 步)
  ├── IT-WF-API-05: report_generation (8+并行)
  ├── IT-WF-API-06: multilingual (5 步)
  ├── IT-WF-API-07: multi_platform (4 步)
  └── IT-WF-API-08: image_article (5 步)

Phase 4: Helm UI 路径 E2E（按意图类型）
  ├── IT-HELM-01: 简单问候（Fast-path）
  ├── IT-HELM-02: 写作意图（Planning 路径）
  ├── IT-HELM-03: 搜索意图
  ├── IT-HELM-04: 研究意图
  ├── IT-HELM-05: 翻译意图（Planning 路径）
  ├── IT-HELM-06: 代码意图
  ├── IT-HELM-07: Plan 降级
  ├── IT-HELM-08: 复杂多步
  └── IT-HELM-09: Fast-path 负面

Phase 5: 模式执行器专项
  ├── IT-MODE-01: ReAct 循环检测
  ├── IT-MODE-02: Reflexion 不收敛
  ├── IT-MODE-03: Agent-as-Judge 不同模型
  ├── IT-MODE-04: 代码生成 coding 模型
  ├── IT-MODE-05: Subagents 并行
  ├── IT-MODE-06: ReWOO 蓝图生成+并行执行
  ├── IT-MODE-07: SelfDiscover 模式推荐
  ├── IT-MODE-08: GraphOfThoughts 分支推理
  └── IT-MODE-09: Workflow on_error 四种策略

Phase 6: 前端 Playwright E2E
  ├── E2E-HELM-01: ReAct Helm 流程
  ├── E2E-HELM-02: Workflow Helm 流程
  ├── E2E-HELM-03: WebSocket 断线重连
  └── E2E-HELM-04: 审核交互

Phase 7: 并发 + Circuit Breaker
  ├── IT-CONC-01: 10 并发不同 persona
  ├── IT-CONC-02: 同 persona 冲突
  ├── IT-CB-01: 熔断触发
  └── IT-CB-02: 429 重试

Phase 8: 跨 Workflow 组合
  ├── IT-CROSS-01: deep_article → quick_post
  └── IT-CROSS-02: deep_article → multi_platform

Phase 9: API 业务正确性
  ├── API-01: 模式列表
  ├── API-02: 任务创建
  └── API-03: 状态转换

Phase 10: 生成报告
  ├── e2e_summary_{date}.md
  ├── e2e_metrics_{date}.json
  └── prompt_issues_{date}.md
```

---

## 4. 需求追溯矩阵

| 测试用例 | 规格需求 | 架构设计 | 详细设计 | 审视缺陷 |
|---------|---------|---------|---------|---------|
| IT-WF-API-01 | FR-CAP-06 #1 | 6.5 Workflow #1 | 9.1 | 缺陷 2/5/6/8/9 |
| IT-WF-API-02 | FR-CAP-06 #2 | 6.5 Workflow #2 | 9.1 | 缺陷 2/9 |
| IT-WF-API-03 | FR-CAP-06 #3 | 6.5 Workflow #3 | 9.1 | 缺陷 2/5 |
| IT-WF-API-04 | FR-CAP-06 #5 | 6.5 Workflow #5 | 9.1 | 缺陷 2 |
| IT-WF-API-05 | FR-CAP-06 #8 | 6.5 Workflow #8 | 9.1 | 缺陷 2/8 |
| IT-WF-API-06 | FR-CAP-06 #7 | 6.5 Workflow #7 | 9.1 | 缺陷 2 |
| IT-WF-API-07 | FR-CAP-06 #4 | 6.5 Workflow #4 | 9.1 | 缺陷 2 |
| IT-WF-API-08 | FR-CAP-06 #6 | 6.5 Workflow #6 | 9.1 | 缺陷 2/8 |
| IT-HELM-01~08 | FR-HELM-01~04 | 10.6 | 5.2 | 缺陷 4 |
| IT-MODE-01 | FR-ENG-03 | 5.1 ReAct | 7.1 | 缺陷 5 |
| IT-MODE-02 | FR-ENG-03 | 5.1 Reflexion | 7.3 | 缺陷 5 |
| IT-MODE-03 | FR-HRN-03 | 7.4 FeedbackLoop | 14.5 | 缺陷 8 |
| IT-MODE-04 | FR-CAP-04 | 6.4 | 8.2 | 缺陷 7 |
| IT-MODE-05 | FR-MAS-01 | 10.3 | 7.4 | 缺陷 10 |
| E2E-HELM-01~04 | FR-HELM-01~04 | 10.6 | 5.2 | 缺陷 4 |
| CH-01~05 | FR-CAP-01 | 10.4 | 11.1 | 缺陷 7 |
| IT-CONC-01~02 | FR-ENG-01 | 12.2 | 4.2 | 缺陷 10 |
| IT-CB-01~02 | 4.3 可靠性 | 9.2 | 16.3 | 缺陷 10 |
| IT-CROSS-01~02 | — | — | — | 缺陷 11 |
| API-01~03 | FR-ENG-01~06 | 4.7 | 4.2 | 缺陷 3 |
| UT-CORE-01~10 | FR-ENG-01~06 | 4.1~4.6 | 3.1~3.6 | — |
| UT-DI-01~05 | FR-ENG-02 | 4.2 | 3.2 | — |
| UT-EVT-01~08 | FR-ENG-04 | 4.3 | 3.3 | — |
| UT-HELM-01~04 | FR-HELM-01~04 | 10.6 | 5.2 | — |
| UT-MOD-01~08 | FR-ENG-03 | 5.1 | 7.1 | — |
| UT-REACT-01~05 | FR-ENG-03 | 5.1 ReAct | 7.1 | — |
| UT-PE-01~03 | FR-ENG-03 | 5.1 PlanExecute | 7.2 | — |
| UT-REF-01~05 | FR-ENG-03 | 5.1 Reflexion | 7.3 | — |
| UT-DLLM-01~04 | FR-ENG-03 | 5.1 | 7.3 | — |
| UT-WF-01~08 | FR-CAP-06 | 6.5 | 9.1 | — |
| UT-HE-01~03 | FR-ENG-01 | 12.2 | 4.2 | — |
| UT-PLG-01~07 | FR-EXT-01 | 11.1 | 10.1 | — |
| UT-SBOX-01~08 | FR-SEC-01 | 11.2 | 10.2 | — |
| UT-LLM-01~05 | FR-CAP-01 | 10.4 | 11.1 | — |
| UT-MEM-01~06 | FR-ENG-05 | 8.1 | 6.1 | — |
| UT-DEF-01~05 | FR-DEF-01 | 9.1 | 16.1 | — |
| UT-SEC-01~06 | FR-SEC-01 | 9.2 | 16.2 | — |
| UT-TB-01~08 | FR-MAS-02 | 10.1 | 7.5 | — |
| UT-MB-01~08 | FR-MAS-02 | 10.2 | 7.5 | — |
| UT-CMP-01~05 | FR-ENG-05 | 8.2 | 6.2 | — |
| UT-CP-01~08 | FR-ENG-06 | 8.3 | 6.3 | — |
| IT-API-01~27 | FR-ENG-01~06 | 4.7 | 4.2 | 缺陷 3 |
| IT-SOP-01~07 | FR-CAP-06 | 6.5 | 9.1 | — |
| IT-PLG-01~05 | FR-EXT-01 | 11.1 | 10.1 | — |
| IT-XP-01~05 | FR-PLT-01 | 11.3 | 10.3 | — |
| IT-MA-01~04 | FR-MAS-01 | 10.3 | 7.4 | — |
| IT-AT-01~04 | FR-MAS-01 | 10.3 | 7.4 | — |
| IT-SW-01~05 | FR-MAS-01 | 10.3 | 7.4 | — |
| IT-DEF-01~04 | FR-DEF-01 | 9.1 | 16.1 | — |

---

## 5. 引用

- [doc:../spec.md]（FR-ENG-03, FR-ENG-06, FR-MAS-02）
- [doc:../arch.md]（§5.1, §10.3）
- [doc:../design.md]（§7.1-§7.7）
- [doc:rules.md#T1-T8]
- [doc:design/naming-contract.md]（§2 智能体分类）
- [doc:TEMPLATE.md]

---

## 6. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v1.0 | 初始创建：从原 test.md 第 29-31 章拆分，覆盖 UT-GA-01~17 + IT-GEN-WF-01~05 + 执行顺序 + 需求追溯矩阵 | 测试员可进化智能体（蜜獾·平头哥） |
