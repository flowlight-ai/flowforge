# T008: 模式执行器专项测试（IT-MODE-01~09）

> **状态**: ✅ done
> **创建日期**: 2026-07-19
> **负责人**: 测试员可进化智能体（蜜獾·平头哥）
> **测试类别**: 集成测试（模式执行器直接模式）
> **关联 spec.md**: [doc:../spec.md]（FR-ENG-03）
> **关联 arch.md**: [doc:../arch.md]（§5.1）
> **关联 design.md**: [doc:../design.md]（§7.1-§7.7）
> **测试铁律**: 已应用 T1-T8（详见 [doc:rules.md#T1-T8]）
> **命名规范**: 已应用 v2.0（详见 [doc:design/naming-contract.md]）

---

## 1. 测试范围说明

> **注意**：以下测试在**模式执行器直接模式**下执行（非 Workflow API 路径），验证模式执行器本身的行为。Workflow API 路径下 WorkflowExecutor 会跳过 mode executor（详见 [doc:T005-workflow-api-e2e-core.md] §1.2）。

---

## 2. IT-MODE-01：ReAct 循环检测

**需求依据**：spec.md FR-ENG-03 ReAct（MAX_STEPS=8，含循环检测）；design.md 7.1

**输入数据**：

- 意图：`"反复搜索同一个问题：AI是什么？AI是什么？AI是什么？"`
- 模式：react
- 模型：`openroute/auto`

**预期执行过程**：

| 步骤 | 预期行为 |
|------|---------|
| 1~2 | 正常 Thought→Action→Observation 循环 |
| 3+ | 检测到重复 Action，触发 `react.loop_detected` 事件 |
| — | Agent 不会无限循环，steps ≤ MAX_STEPS=8 |

**通过条件**：

1. ✅ `react.loop_detected` 事件被发射
2. ✅ 总步骤数 ≤ 8（MAX_STEPS）
3. ✅ Agent 不会无限循环挂起

---

## 3. IT-MODE-02：Reflexion 不收敛处理

**需求依据**：spec.md FR-ENG-03 Reflexion（MAX_ITERATIONS=4，QUALITY_THRESHOLD=0.9）；design.md 7.3

**输入数据**：

- 意图：`"写一篇关于量子场论的学术论文，要求达到 Nature 发表水平"`（故意极高要求，LLM 难以达标）
- 模式：reflexion
- 模型：`openroute/auto`

**预期执行过程**：

| 迭代 | Actor | Evaluator | Reflector |
|------|-------|-----------|-----------|
| 1 | 生成初稿 | 评分 < 0.9 | 分析问题 |
| 2 | 基于反思改进 | 评分 < 0.9 | 分析问题 |
| 3 | 基于反思改进 | 评分 < 0.9 | 分析问题 |
| 4 | 基于反思改进 | 评分（可能仍 <0.9） | — |

**通过条件**：

1. ✅ 达到 MAX_ITERATIONS=4 后停止，不会崩溃
2. ✅ 输出 `best_score` 和 `best_result`（即使未达标）
3. ✅ **三种 Prompt 不同**（Actor/Evaluator/Reflector 的 system prompt 各不相同）（DefaultLLMActor/DefaultLLMEvaluator 共用同一个 LLM Tool）
4. ✅ 每轮 Evaluator 必须返回 0-1 之间的数值评分

> **适用范围**：仅模式执行器直接模式下有效，Workflow API 路径不适用（WorkflowExecutor 跳过 mode executor）

---

## 4. IT-MODE-03：Agent-as-Judge 不同模型验证

**需求依据**：spec.md FR-HRN-03 反馈循环（独立评判 Agent）；审视缺陷 8

**输入数据**：

- 意图：`"写一篇关于'远程办公利弊'的评论文章"`
- 配置：writing 用 `openroute/auto`，audit 用 `openroute/doubao-web/chat`

**预期执行过程**：

| 阶段 | Agent | 模式 | 预期行为 |
|------|-------|------|---------|
| 1 | article_writing | reflexion | 使用 `openroute/auto` 生成文章 |
| 2 | content_audit | agent_judge | **使用 `openroute/doubao-web/chat` 评审** |

**通过条件**：

1. ✅ **audit 阶段的 LLM 模型名 ≠ writing 阶段的 LLM 模型名**（需代码修复前置条件 B1）
2. ✅ audit 返回四维评分（design_quality/originality/craft/functionality）
3. ✅ 评分不全相同（证明不是同一模型重复评分）
4. ✅ audit 返回 verdict（pass/conditional/fail）

> **需代码修复前置条件**：当前 ContentAuditAgent 源码中两次 llm.execute 使用相同的 persona，不支持指定 judge_model（Bug B1）

---

## 5. IT-MODE-04：代码生成（coding 档位模型）

**需求依据**：spec.md FR-CAP-04 CodeWriterAgent；design.md 8.2

**输入数据**：

- 意图：`"用 Python 写一个快速排序算法，要求包含注释和单元测试"`
- 模式：reflexion
- 模型：**coding 档位** `arkcode/ark-code-latest`

**预期执行过程**：

| 阶段 | Agent | 模式 | 预期 LLM 次数 | 预期模型 |
|------|-------|------|-------------|---------|
| 1 | code_writer_agent | reflexion | 1+N(1~3) | **`arkcode/ark-code-latest`** |

**通过条件**：

1. ✅ **必须使用 coding 档位模型 `arkcode/ark-code-latest`**（否则是 Bug——代码任务没用代码模型）
2. ✅ 响应必须包含可执行的 Python 代码
3. ✅ 代码应包含注释
4. ✅ 应包含单元测试代码
5. ✅ LLM 模型链中必须包含 `arkcode/ark-code-latest`

---

## 6. IT-MODE-05：Subagents 并行策略

**需求依据**：spec.md FR-MAS-01（完全上下文隔离、并行执行、工具过滤、结果压缩）；design.md 7.4

**输入数据**：

- 意图：`"从技术、经济、社会三个角度并行分析'人工智能对教育的影响'"`
- 模式：multi_agent（strategy=subagents）
- 模型：`openroute/auto`

**预期执行过程**：

| 子任务 | Agent | 上下文 | 工具集 | 模型 |
|--------|-------|--------|--------|------|
| 技术角度 | subagent_1 | 独立空 state | [llm, web_search] | `openroute/auto` |
| 经济角度 | subagent_2 | 独立空 state | [llm, web_search] | `openroute/auto` |
| 社会角度 | subagent_3 | 独立空 state | [llm, web_search] | `openroute/auto` |

**通过条件**：

1. ✅ 3 个子任务必须并行执行（`agent.start` 时间戳接近，非串行）
2. ✅ 每个子 Agent 必须有独立的上下文（`TaskContext.from_parent(state={})`）
3. ✅ 子 Agent 只暴露最小工具集（工具过滤）
4. ✅ 子 Agent 结果必须压缩返回（不污染父 Agent 上下文）
5. ✅ 单个子任务失败不应影响其他子任务

**指标记录**：

| 指标 | 预期值 | 实际值 | 状态 |
|------|--------|--------|------|
| 子任务并行时间重叠 | > 0s | _ | _ |
| 子 Agent 上下文隔离 | state={} | _ | _ |
| 子 Agent 工具集 | ≠ 全部工具 | _ | _ |

---

## 7. IT-MODE-06：ReWOO 蓝图生成 + 并行执行验证

**需求依据**：spec.md FR-ENG-03 ReWOO；design.md 7.2

**输入数据**：

- 意图：`"研究 AI 在教育领域的应用，需要同时搜索技术方案和案例分析"`
- 模式：rewoo
- 模型：`openroute/auto`

**预期执行过程**：

| 阶段 | 行为 | LLM 次数 | 说明 |
|------|------|---------|------|
| Planner | 一次性规划所有工具调用 | 1 | 输出蓝图：[web_search(技术), web_search(案例)] |
| Worker×2 | 并行执行工具调用 | 0 | 两个 web_search 并行 |
| Compiler | 聚合结果 | 1 | 合并两份搜索结果 |

**通过条件**：

1. ✅ Planner 一次性输出完整蓝图（非逐步规划）
2. ✅ Worker 并行执行（时间重叠 > 0）
3. ✅ Compiler 正确聚合所有 Worker 结果

---

## 8. IT-MODE-07：SelfDiscover 模式推荐验证

**需求依据**：spec.md FR-ENG-03 Self-Discover；design.md 7.6

**输入数据**：

- 意图：`"分析这段文本的情感倾向并给出理由"`
- 模式：self_discover
- 模型：`openroute/auto`

**预期执行过程**：

| 阶段 | 行为 | LLM 次数 |
|------|------|---------|
| Select | 从模式池中选择最佳模式 | 1 |
| Adapt | 适配选中的模式 | 1 |
| Execute | 执行适配后的模式 | 1 |

**通过条件**：

1. ✅ Select 阶段输出选择的模式名称
2. ✅ 选择的模式与任务类型匹配
3. ✅ 最终输出包含分析结果和理由

---

## 9. IT-MODE-08：GraphOfThoughts 分支推理验证

**需求依据**：spec.md FR-ENG-03 Graph-of-Thoughts；design.md 7.7

**输入数据**：

- 意图：`"从多个角度分析 AI 对就业的影响：积极面、消极面、中立面"`
- 模式：graph_of_thoughts
- 模型：`openroute/auto`

**预期执行过程**：

| 阶段 | 行为 | LLM 次数 |
|------|------|---------|
| Branch | 生成多个推理分支 | 3（积极/消极/中立各 1 次） |
| Score | 评估每个分支 | 1 |
| Merge | 合并最佳分支 | 1 |

**通过条件**：

1. ✅ 生成 ≥ 2 个推理分支
2. ✅ 每个分支有独立评分
3. ✅ 最终输出合并了多个分支的观点

---

## 10. IT-MODE-09：Workflow on_error 四种策略组合验证

**需求依据**：spec.md FR-ENG-05 三层防御；design.md 7.5

**测试场景**：

| 子场景 | on_error 策略 | 触发条件 | 预期行为 |
|--------|-------------|---------|---------|
| A | skip | 非关键步骤失败 | 跳过，继续后续步骤 |
| B | retry | 临时性故障 | 等待后重试 N 次 |
| C | reflexion_retry | 逻辑性错误 | Reflexion 分析→修正→重试 |
| D | abort | 关键步骤失败 | 终止 Workflow，触发 task.error |

**通过条件**：

1. ✅ skip：失败步骤标记为 skipped，后续步骤正常执行
2. ✅ retry：同一步骤出现多次 workflow.step.start 事件
3. ✅ reflexion_retry：触发 reflexion.actor/reflector 事件
4. ✅ abort：触发 task.error 事件，后续步骤不执行

---

## 11. 引用

- [doc:../spec.md]（FR-ENG-03, FR-HRN-03, FR-MAS-01, FR-CAP-04）
- [doc:../arch.md]（§5.1, §7.4）
- [doc:../design.md]（§7.1-§7.7）
- [doc:rules.md#T1-T8]
- [doc:design/naming-contract.md]
- [doc:T002-test-strategy.md]（B1-B4 代码修复前置清单）
- [doc:TEMPLATE.md]

---

## 12. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v1.0 | 初始创建：从原 test.md 第 18 章拆分，覆盖 IT-MODE-01~09 | 测试员可进化智能体（蜜獾·平头哥） |
