# T007: Helm UI 路径测试（IT-HELM-01~09 + IT-HELM-NEG）

> **状态**: ✅ done
> **创建日期**: 2026-07-19
> **负责人**: 测试员可进化智能体（蜜獾·平头哥）
> **测试类别**: 集成测试（Helm UI 路径）
> **关联 spec.md**: [doc:../spec.md]（FR-HELM-01~04）
> **关联 arch.md**: [doc:../arch.md]（§10.6）
> **关联 design.md**: [doc:../design.md]（§5.2）
> **测试铁律**: 已应用 T1-T8（详见 [doc:rules.md#T1-T8]）
> **命名规范**: 已应用 v2.0（详见 [doc:design/naming-contract.md]）

---

## 1. Helm UI 执行流程说明

> **说明**：Helm UI 路径不走 Workflow YAML，走的是 Planner LLM 动态规划 + `_infer_steps_from_intent` 降级模板。因此测试用例按**用户输入意图类型**设计，而非按 Workflow 名称。

**Helm UI 执行流程**：

1. 用户输入 → `_is_simple_message` → True 走 Fast-path（1 次 LLM）
2. 用户输入 → `_is_simple_message` → False 走 Planning 路径
3. Planning: LLM 生成执行计划 `{intent_type, plan: [{name, type, tool/agent}]}`
4. 如果 Planning 失败（空 plan）→ `_infer_steps_from_intent` 降级到硬编码模板
5. Execute: 按 plan 执行各步骤（tool/agent/generate）
6. Compile: LLM 整理输出
7. Save: 长内容保存文件（>800 字符）

---

## 2. IT-HELM-01：简单问候（Fast-path）

**用户输入**：`"你好"`

**预期路径判断**：`_is_simple_message` = True → `_simple_response`

**预期执行过程**：

| 阶段 | 行为 | LLM 次数 | 工具调用 |
|------|------|---------|---------|
| Fast-path | 直接调用 LLM 生成回复 | 1 | 无 |

**预期 WebSocket 事件序列**：

```
helm.llm.start → helm.llm.stream → helm.llm.end → helm.draft.update → helm.task.completed
```

**通过条件**：

1. ✅ LLM 调用次数 = 1（Fast-path 只调用 1 次）
2. ✅ 不触发 `workflow.step.start` 事件
3. ✅ 不触发 `tool.start` 事件
4. ✅ 响应延迟 < 5s

---

## 3. IT-HELM-02：写作意图（Planning 路径）

**用户输入**：`"帮我写一篇关于 AI 发展趋势的文章"`

**预期路径判断**：`_is_simple_message` = False → Planning 路径

**预期 Planner 输出**：

```json
{
  "intent_type": "write",
  "plan": [
    {"name": "搜索素材", "type": "tool", "tool": "web_search"},
    {"name": "撰写内容", "type": "agent", "agent": "article_writing"},
    {"name": "整理输出", "type": "generate"}
  ]
}
```

**预期执行过程**：

| 阶段 | 行为 | LLM 次数 | 工具/Agent 调用 |
|------|------|---------|---------------|
| Planning | LLM 生成执行计划 | 1 | 无 |
| 搜索素材 | web_search 工具 | 0 | web_search × 1 |
| 撰写内容 | article_writing Agent | 1 | article_writing |
| Compile | LLM 整理输出 | 1 | 无 |
| **合计** |  | **3** |  |

**Plan 降级场景**：如果 Planner 返回空 plan，`_infer_steps_from_intent("write")` 降级到硬编码模板 `[搜索素材, 撰写内容]`（2 步而非 3 步）。

**预期 WebSocket 事件序列**：

```
helm.stage.enter(planning) → helm.llm.start → helm.llm.end → helm.stage.exit(planning)
helm.stage.enter(搜索素材) → helm.tool.start(web_search) → helm.tool.end(web_search) → helm.stage.exit(搜索素材)
helm.stage.enter(撰写内容) → helm.tool.start(article_writing) → helm.tool.end(article_writing) → helm.stage.exit(撰写内容)
helm.stage.enter(compile) → helm.llm.start → helm.llm.stream → helm.llm.end → helm.stage.exit(compile)
helm.draft.update → helm.task.completed
```

**通过条件**：

1. ✅ Planning 阶段输出有效的 `intent_type` 和 `plan`
2. ✅ 执行步骤数 ≥ 2（Planning 成功 3 步或降级 2 步）
3. ✅ web_search 工具被调用（搜索素材步骤）
4. ✅ 最终输出包含文章内容（≥ 300 字）
5. ✅ WebSocket 事件序号连续无跳号

---

## 4. IT-HELM-03：搜索意图（Planning 路径）

**用户输入**：`"搜索最新的 AI Agent 框架"`

**预期 Planner 输出**：

```json
{
  "intent_type": "search",
  "plan": [
    {"name": "搜索", "type": "tool", "tool": "web_search"}
  ]
}
```

**预期执行过程**：

| 阶段 | LLM 次数 | 工具调用 |
|------|---------|---------|
| Planning | 1 | 无 |
| 搜索 | 0 | web_search × 1 |
| Compile | 1 | 无 |
| **合计** | **2** |  |

**通过条件**：

1. ✅ intent_type = "search"
2. ✅ web_search 必须被调用
3. ✅ 输出包含搜索结果

---

## 5. IT-HELM-04：研究意图（Planning 路径）

**用户输入**：`"研究一下量子计算的最新进展和应用前景"`

**预期 Planner 输出**：

```json
{
  "intent_type": "research",
  "plan": [
    {"name": "搜索资料", "type": "tool", "tool": "web_search"},
    {"name": "分析整理", "type": "agent", "agent": "topic_research"},
    {"name": "输出报告", "type": "generate"}
  ]
}
```

**预期执行过程**：

| 阶段 | LLM 次数 | 工具/Agent 调用 |
|------|---------|---------------|
| Planning | 1 | 无 |
| 搜索资料 | 0 | web_search × 1 |
| 分析整理 | 0~1 | topic_research Agent |
| Compile | 1 | 无 |
| **合计** | **2~3** |  |

**通过条件**：

1. ✅ intent_type = "research"
2. ✅ 至少 2 个执行步骤
3. ✅ 输出包含分析内容（非简单搜索结果罗列）

---

## 6. IT-HELM-05：翻译意图（Planning 路径）

**用户输入**：`"请把'人工智能正在改变世界'翻译成英文"`

**预期路径判断**：`_is_simple_message` = False → Planning 路径（翻译请求不匹配问候语模式）

**预期 Planner 输出**：

```json
{
  "intent_type": "translate",
  "plan": [
    {"name": "翻译", "type": "generate"}
  ]
}
```

**预期执行过程**：

| 阶段 | LLM 次数 | 工具调用 |
|------|---------|---------|
| Planning | 1 | 无 |
| 翻译 | 1 | 无 |
| **合计** | **2** |  |

**通过条件**：

1. ✅ 走 Planning 路径（非 Fast-path，`_is_simple_message` 只匹配问候语）
2. ✅ LLM 调用次数 ≥ 2
3. ✅ 输出包含翻译内容

---

## 7. IT-HELM-06：代码意图（Planning 路径）

**用户输入**：`"用 Python 写一个快速排序算法"`

**预期 Planner 输出**：

```json
{
  "intent_type": "code",
  "plan": [
    {"name": "编写代码", "type": "agent", "agent": "code_writer_agent"}
  ]
}
```

**预期执行过程**：

| 阶段 | LLM 次数 | 工具/Agent 调用 |
|------|---------|---------------|
| Planning | 1 | 无 |
| 编写代码 | 1 | code_writer_agent（coding 档位模型） |
| Compile | 1 | 无 |
| **合计** | **3** |  |

**通过条件**：

1. ✅ intent_type = "code"
2. ✅ code_writer_agent 被调用
3. ✅ LLM 模型链包含 coding 档位模型 `arkcode/ark-code-latest`
4. ✅ 输出包含可执行 Python 代码

---

## 8. IT-HELM-07：Plan 降级场景

**用户输入**：`"帮我分析一下这个数据"`（模糊意图，Planner 可能返回空 plan）

**预期行为**：

1. Planning LLM 返回空 plan 或格式错误
2. 系统降级到 `_infer_intent_type_from_text` + `_infer_steps_from_intent`
3. 根据关键词推断意图类型，执行硬编码模板步骤

**通过条件**：

1. ✅ Planning 失败后不崩溃
2. ✅ 降级路径正确执行（有 `_infer_steps_from_intent` 日志）
3. ✅ 最终仍输出有效结果
4. ✅ 事件序列中可观察到 Planning → 降级的转换

---

## 9. IT-HELM-08：复杂多步意图

**用户输入**：`"写一篇关于中国高铁技术的文章，然后翻译成英文发布"`

**预期 Planner 输出**：

```json
{
  "intent_type": "write",
  "plan": [
    {"name": "搜索素材", "type": "tool", "tool": "web_search"},
    {"name": "撰写文章", "type": "agent", "agent": "article_writing"},
    {"name": "翻译", "type": "agent", "agent": "multilingual"},
    {"name": "整理输出", "type": "generate"}
  ]
}
```

**预期执行过程**：

| 阶段 | LLM 次数 | 工具/Agent 调用 |
|------|---------|---------------|
| Planning | 1 | 无 |
| 搜索素材 | 0 | web_search × 1 |
| 撰写文章 | 1 | article_writing |
| 翻译 | 1~2 | multilingual |
| Compile | 1 | 无 |
| **合计** | **4~5** |  |

**通过条件**：

1. ✅ Planner 规划了 ≥ 3 个步骤
2. ✅ 包含写作和翻译两个 Agent
3. ✅ 输出包含中文文章 + 英文翻译
4. ✅ LLM 调用次数在 4~5 范围内

---

## 10. IT-HELM-09：Fast-path 负面测试

**用户输入**：`"帮我写一篇深度分析文章"`（复杂意图，不应走 Fast-path）

**预期行为**：

1. `_is_simple_message` = False
2. 不走 Fast-path，走 Planning 路径
3. Planning 输出多步执行计划

**通过条件**：

1. ✅ LLM 调用次数 ≥ 2（不是 1 次 Fast-path）
2. ✅ 触发 `workflow.step.start` 事件（有 Planning 阶段）
3. ✅ 不触发 Fast-path 相关事件

---

## 11. IT-HELM-NEG：Helm UI 负向/异常路径测试

| 测试 ID | 输入 | 预期行为 | 验证方法 |
|--------|------|---------|---------|
| IT-HELM-NEG-01 | 仅含特殊字符 `"!@#$%"` | 不崩溃，返回合理响应 | 检查响应非空 |
| IT-HELM-NEG-02 | Planner 返回格式错误 JSON | 降级到 `_infer_steps_from_intent` | 检查降级日志 |
| IT-HELM-NEG-03 | `_infer_steps_from_intent` 无匹配模板 | 通用降级处理 | 检查通用响应 |
| IT-HELM-NEG-04 | LLM 返回 429/503 | 重试 + 退避 | 检查重试次数 |
| IT-HELM-NEG-05 | web_search 返回 0 结果 | LLM 回退路径 | 检查输出非空 |

---

## 12. 引用

- [doc:../spec.md]（FR-HELM-01~04）
- [doc:../arch.md]（§10.6）
- [doc:../design.md]（§5.2）
- [doc:rules.md#T1-T8]
- [doc:design/naming-contract.md]
- [doc:TEMPLATE.md]

---

## 13. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v1.0 | 初始创建：从原 test.md 第 17 章拆分，覆盖 IT-HELM-01~09 + IT-HELM-NEG | 测试员可进化智能体（蜜獾·平头哥） |
