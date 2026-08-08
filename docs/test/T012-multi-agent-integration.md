# T012: Multi-Agent 集成测试（Subagents / Agent Teams / Swarms）

> **状态**: ✅ done
> **创建日期**: 2026-07-19
> **负责人**: 测试员可进化智能体（蜜獾·平头哥）
> **测试类别**: 集成测试（Multi-Agent 策略）
> **关联 spec.md**: [doc:../spec.md]（FR-MAS-01, FR-MAS-02）
> **关联 arch.md**: [doc:../arch.md]（§10.3）
> **关联 design.md**: [doc:../design.md]（§7.5）
> **测试铁律**: 已应用 T1-T8（详见 [doc:rules.md#T1-T8]）
> **命名规范**: 已应用 v2.0（详见 [doc:design/naming-contract.md]）

---

## 1. Subagents 策略测试

> **策略说明**：父 Agent 通过 LLM 自动分解任务，派生多个独立子 Agent 并行执行，子 Agent 上下文完全隔离，结果压缩后返回父 Agent。

| 用例 ID | 场景 | 验证点 |
|---------|------|--------|
| **IT-MA-01** | 2 个子任务并行执行 | 两个任务结果均返回，互不影响 |
| **IT-MA-02** | 子任务隔离性 | 子任务 state 修改不影响父 context |
| **IT-MA-03** | 子任务失败不影响其他 | 1 个子任务失败，其他正常返回 |
| **IT-MA-04** | 自动任务分解 | 无 sub_tasks 时自动调用 LLM 分解 |

### 1.1 IT-MA-01 详细测试

**输入**：`"从技术和经济两个角度分析 AI 对教育的影响"`

**预期**：

1. ✅ Planner LLM 分解出 2 个子任务（技术、经济）
2. ✅ 两个子 Agent 并行执行（`agent.start` 时间戳差 < 100ms）
3. ✅ 两个子结果都返回非空内容
4. ✅ 父 Agent 合并结果输出最终答案

### 1.2 IT-MA-02 上下文隔离验证

**验证方法**：

```python
# 在子 Agent 中修改 state
sub_agent.context.state["test_key"] = "modified_by_sub"

# 父 Agent context 不应包含此修改
assert "test_key" not in parent_agent.context.state
```

---

## 2. Agent Teams 策略测试

> **策略说明**：Lead Agent 通过 TaskBoard 分解任务，团队成员从 TaskBoard 认领任务执行，通过 Mailbox 进行通信。

| 用例 ID | 场景 | 验证点 |
|---------|------|--------|
| **IT-AT-01** | Lead 分解 + 团队认领 | 任务被正确分解到 TaskBoard，团队成员认领执行 |
| **IT-AT-02** | Mailbox 通信 | 成员发送 critical 消息 → Lead 触发 replan |
| **IT-AT-03** | 空闲检测退出 | 连续 N 轮无进展 → 自动退出循环 |
| **IT-AT-04** | 任务失败处理 | 成员任务失败 → fail_task + 通知 Lead |

### 2.1 IT-AT-01 详细测试

**输入**：3 个团队成员（writer/researcher/reviewer）+ 复杂写作任务

**预期**：

1. ✅ Lead 将任务分解为 ≥ 2 个子任务推送到 TaskBoard
2. ✅ 至少 2 个成员从 TaskBoard 认领任务
3. ✅ 成员执行后产出非空结果
4. ✅ Lead 汇总成员结果输出最终答案

### 2.2 IT-AT-02 Mailbox 通信

**测试场景**：成员遇到阻塞问题，发送 critical 消息给 Lead

**预期**：

1. ✅ 成员通过 Mailbox 发送 `severity=critical` 消息
2. ✅ Lead 在下一轮检查 Mailbox 时收到消息
3. ✅ Lead 触发 replan，调整任务分解

---

## 3. Swarms 策略测试

> **策略说明**：Worker 从共享 TaskBoard 认领任务执行，Coordinator 监控 Worker 心跳，失联时重置任务。

| 用例 ID | 场景 | 验证点 |
|---------|------|--------|
| **IT-SW-01** | Worker 认领 + 执行 + 完成 | Worker 从 TaskBoard 认领任务并完成 |
| **IT-SW-02** | 心跳监控 | Worker 发送心跳 → Coordinator 记录 |
| **IT-SW-03** | 失联检测 | Worker 停止心跳 → Coordinator 重置其任务 |
| **IT-SW-04** | 空闲退出 | 无任务可认领 → max_empty_rounds 后退出 |
| **IT-SW-05** | 任务重试 | 任务失败 → 重试 → 超过 max_retry 后 fail |

### 3.1 IT-SW-03 失联检测详细测试

**测试方法**：

1. 启动 1 个 Coordinator + 2 个 Worker
2. 让 Worker 1 正常运行，Worker 2 故意停止心跳
3. 等待失联检测周期（默认 30s）

**预期**：

1. ✅ Worker 2 状态变为 `lost`
2. ✅ Worker 2 当前任务被重置（status=back_to_queue）
3. ✅ Worker 1 不受影响，继续执行
4. ✅ TaskBoard 中被重置的任务可被其他 Worker 认领

---

## 4. 三策略对比矩阵

| 维度 | Subagents | Agent Teams | Swarms |
|------|-----------|-------------|--------|
| **任务分解方** | 父 Agent LLM | Lead Agent | 共享 TaskBoard |
| **认领方式** | 自动派生 | 团队认领 | Worker 自由认领 |
| **通信机制** | 返回值 | Mailbox | TaskBoard + 心跳 |
| **协作模式** | 父子层级 | Lead-Member | 平等 Worker |
| **失败容忍** | 单子任务失败不影响其他 | 成员失败通知 Lead | 失联重置任务 |
| **适用场景** | 明确分解的并行任务 | 复杂协作流程 | 大规模并行任务 |

---

## 5. 关键约束

### 5.1 完全上下文隔离（FR-MAS-01）

- ✅ 子 Agent 必须有独立的 state（不能修改父 context）
- ✅ 子 Agent 工具集必须过滤（仅暴露必要工具）
- ✅ 子 Agent 结果必须压缩后返回（避免污染父上下文）

### 5.2 TaskBoard 持久化（FR-MAS-02）

- ✅ TaskBoard 任务必须通过 Repository 层持久化
- ✅ 任务状态转换必须可追溯（pending → claimed → completed/failed）
- ✅ 重启后 TaskBoard 状态可恢复

### 5.3 Mailbox 通信语义

- ✅ 消息必须按 severity 分级（info/warning/critical）
- ✅ critical 消息必须触发 Lead replan
- ✅ 消息必须通过 Repository 持久化（防止丢失）

---

## 6. 引用

- [doc:../spec.md]（FR-MAS-01, FR-MAS-02）
- [doc:../arch.md]（§10.3）
- [doc:../design.md]（§7.5）
- [doc:rules.md#T1-T8]
- [doc:design/naming-contract.md]
- [doc:TEMPLATE.md]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v1.0 | 初始创建：从原 test.md 第 22 章拆分，覆盖 Subagents + Agent Teams + Swarms 三策略 | 测试员可进化智能体（蜜獾·平头哥） |
