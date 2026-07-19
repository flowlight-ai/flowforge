# Feature F024: 弱状态机 vs 强 workflow

> **状态**: draft
> **版本**: v0.1
> **依赖**: [doc:review/review.md#RA-040] + [doc:roleagent.md#第6章]
> **关联 ADR**: [doc:decisions/010-distributed-reliability.md]
> **类型**: reliability
> **创建日期**: 2026-07-17
> **负责人**: 架构师灵智体（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.6]（FR-CORE-006，与本文档同号对应）
> **对应 arch.md**: [doc:../arch.md#§3.6]（待创建）
> **对应 design.md**: [doc:../design.md#§3.6]（待创建）
> **9 大点名称修订**: 已应用（双轨命名 + AI 术语优先 + 弱化万物 + 去 AGI 化）

---

## 1. 概述（Overview）

弱状态机 vs 强 workflow 是 roleagent.md 第 6 章的可靠性边界："开放协作使用轻量状态机保留模型判断力；严肃副作用使用强 workflow 保证可审计、可回放、可拒绝"。本 Feature 实现两类操作的判定、强 workflow 引擎、与 F021 WAL + F022 Tier 1-4 联动。

这是 Build to Persist 基础设施——编码"开放协作 vs 严肃流程"的工程边界。

## 2. 动机（Motivation）

`[doc:review/review.md#RA-040]` 指出：roleagent.md 第 6 章——"开放协作使用轻量状态机保留模型判断力；严肃副作用使用强 workflow 保证可审计、可回放、可拒绝"。v7.0 所有操作走同一套 LoopExecutor，未区分"开放协作"和"严肃流程"。转账/审批/消息发送/merge/release/删除数据等严肃操作未交由确定性 workflow 执行。

不做这个 Feature，F021 WAL 的副作用无 workflow 约束，F022 Tier 4 操作无强 workflow 拒绝点，F002 TeamAct 的"严肃操作"全走轻量状态机导致不可审计。这是 roleagent.md 第 6 章分布式可靠性的边界定义。

## 3. 详细设计（Detailed Design）

### 3.1 数据模型

```python
class OperationClass(str, Enum):
    OPEN_COLLABORATION = "open_collaboration"  # 开放协作（轻量状态机）
    SERIOUS_SIDE_EFFECT = "serious_side_effect"  # 严肃副作用（强 workflow）

class StrongWorkflow(BaseModel):
    workflow_id: str
    operation_class: OperationClass
    steps: list[WorkflowStep]              # 确定性步骤序列
    audit_log: list[AuditEntry]
    replayable: bool = True
    rejectable: bool = True
    current_step: int = 0

class WorkflowStep(BaseModel):
    step_id: str
    action: str
    wal_entry_id: Optional[str]            # 关联 F021 WAL
    tier: int                              # 关联 F022 Tier
    confirmed: bool = False
```

### 3.2 核心接口

```python
class OperationClassifier:
    """判定操作属于开放协作还是严肃副作用"""
    def classify(self, operation: str) -> OperationClass: ...

class StrongWorkflowEngine:
    """强 workflow 引擎（确定性、可审计、可回放、可拒绝）"""
    async def start(self, workflow: StrongWorkflow) -> str: ...
    async def advance(self, workflow_id: str) -> None: ...
    async def reject(self, workflow_id: str, reason: str) -> None: ...
    async def replay(self, workflow_id: str) -> None: ...
```

### 3.3 关键算法

- **操作分类**：转账/审批/消息发送/merge/release/删除数据/物理操作 → 严肃副作用；其余 → 开放协作。
- **强 workflow 约束**：严肃副作用必须经 StrongWorkflowEngine，每步写 F021 WAL，按 F022 Tier 分级拒绝点。
- **可审计**：每步记录 AuditEntry（谁/何时/做了什么/结果）。
- **可拒绝**：任何一步可被 reject（如 F011 星星罐子触发），workflow 终止并回滚可回滚步骤。
- **可回放**：replayable=true 的 workflow 可按 WAL 回放恢复。

### 3.4 配置外置（YAML 示例）

```yaml
state_vs_workflow:
  serious_operations: [transfer, approve, message_send, merge, release, delete_data, physical_op]
  open_collaboration_default: true
  strong_workflow:
    require_audit_log: true
    require_wal_per_step: true
    rejectable: true
    replayable: true
    rollback_on_reject: true
```

## 4. 验收标准（Acceptance Criteria）

- [ ] AC-1: 严肃副作用操作必须经 StrongWorkflowEngine
- [ ] AC-2: 每步写 F021 WAL 并按 F022 Tier 分级
- [ ] AC-3: 任何一步可被 reject 并回滚可回滚步骤
- [ ] AC-4: workflow 可按 WAL 回放恢复
- [ ] AC-5: 审计日志完整记录每步

## 5. 测试策略

### 5.1 单元测试

- 操作分类、强 workflow 推进、reject 回滚、回放恢复。

### 5.2 集成测试

- 接入 F011 Magic Words、F021 WAL、F022 Tier 1-4。

### 5.3 E2E 测试（必须遵守 T1-T8 测试铁律）

- 真实厂商灵智体执行严肃副作用（如 merge），中途触发 reject，验证回滚与审计。**遵守 T1-T8**：真实 LLM、真实数据、真实工具调用。

## 6. 引用

- [doc:roleagent.md#第6章]
- [doc:review/review.md#第八章/RA-040]
- [doc:decisions/010-distributed-reliability.md]
- [doc:design/naming-contract.md#2.2]（灵智体 Forgekin）
- [doc:features/F002-teamact-loop.md]
- [doc:features/F011-magic-words.md]
- [doc:features/F021-side-effect-wal.md]
- [doc:features/F022-tier-1-4-recovery.md]
- [doc:project_rules.md#T1-T8]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.2 | 应用 9 大点名称修订 + 添加 spec.md §3.6 同号映射 | 文档员灵智体（钢笔·文心） |
