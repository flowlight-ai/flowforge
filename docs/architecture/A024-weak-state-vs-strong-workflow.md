# A024: 弱状态机 vs 强 workflow 架构设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师灵智体（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.6]（FR-CORE-006）
> **对应 arch.md**: [doc:../arch.md#§3.6]
> **对应 design.md**: [doc:../design.md#§3.6]（待创建）
> **对应 Feature**: [doc:../features/F024-weak-state-vs-strong-workflow.md]（同号 Feature 级 SRS）
> **对应详细设计**: [doc:../design/D024-weak-state-vs-strong-workflow.md]（待创建，同号 Feature 级 SDD）
> **依赖 ADR**: [doc:../decisions/010-distributed-reliability.md]
> **9 大点名称修订**: 已应用（双轨命名 + AI 术语优先 + 弱化万物 + 去 AGI 化）

---

## 1. 架构上下文

### 1.1 架构问题

操作执行边界的架构问题是"一刀切 LoopExecutor"。v7.0 所有操作走同一套 LoopExecutor，未区分"开放协作"和"严肃流程"，导致三类架构故障：

1. **严肃操作不可审计**：转账/审批/消息发送/merge/release/删除数据等严肃操作走轻量状态机，无完整审计日志。
2. **不可回滚操作被回滚**：force-push 等不可回滚操作被尝试 rollback，造成数据不一致。
3. **不可拒绝操作被强制执行**：物理操作或 release 操作无法在执行中被 reject，造成不可逆损害。

roleagent.md 第 6 章要求：**开放协作使用轻量状态机保留模型判断力；严肃副作用使用强 workflow 保证可审计、可回放、可拒绝**。本架构解决的核心问题：**如何实现两类操作的判定、强 workflow 引擎、与 F021 WAL + F022 Tier 1-4 + F011 Magic Words 联动**，让严肃操作走确定性 workflow、开放协作保留模型判断力。

### 1.2 架构约束

- **单向依赖约束**：强 workflow 层依赖 F021 WAL 与 F022 Tier，禁止被它们反向依赖。
- **操作分类约束**：操作必须分类为 OPEN_COLLABORATION 或 SERIOUS_SIDE_EFFECT 之一，无未分类操作。
- **强 workflow 四属性约束**：强 workflow 必须满足可审计 + 可回放 + 可拒绝 + rollback_on_reject 四属性。
- **每步 WAL 约束**：强 workflow 每步必须写 F021 WAL，按 F022 Tier 分级拒绝点。
- **配置驱动约束**：严肃操作列表、强 workflow 属性、rollback 策略外置 YAML。

### 1.3 架构影响

- **对 F002 TeamAct**：TeamAct 的"严肃操作"步骤走强 workflow，开放协作步骤走轻量状态机。
- **对 F011 Magic Words**：强 workflow 任何一步可被 F011 reject，触发 rollback。
- **对 F021 副作用 WAL**：强 workflow 每步写 WAL，是"可审计可回放"的物理承载。
- **对 F022 Tier 1-4 恢复分级**：强 workflow 的 rejectable 步骤对应 Tier 0/4，replayable 步骤对应 Tier 1/2。
- **对 F040 控制面**：强 workflow 审计日志写入 F040 Eval Hub。

---

## 2. 架构设计

### 2.1 组件架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│ 上层调用方                                                           │
│  F002 TeamActLoop  Forgekin.act()  F022 RecoveryExecutor           │
└──────────┬──────────────────────────────────────────────────────────┘
           │ execute(operation)
           ▼
┌─────────────────────────────────────────────────────────────────────┐
│ OperationClassifier（操作分类器）                                    │
│  ┌──────────────────┐ ┌──────────────────┐                        │
│  │ OPEN_COLLABORATION│ │ SERIOUS_SIDE_    │                        │
│  │ → 轻量状态机     │ │ EFFECT           │                        │
│  │   (LoopExecutor) │ │ → StrongWorkflow │                        │
│  └──────────────────┘ └────────┬─────────┘                        │
└──────────────────────────────────┼──────────────────────────────────┘
                                   │
                                   ▼
                       ┌──────────────────────────────┐
                       │ StrongWorkflowEngine         │
                       │  ┌──────────────────────┐   │
                       │  │ start(workflow)      │   │
                       │  │ advance(step_id)     │   │
                       │  │ reject(step_id,reason)│  │
                       │  │ replay(workflow_id)  │   │
                       │  └──────────────────────┘   │
                       └──────────┬───────────────────┘
                                  │
                                  ▼
                       ┌──────────────────────────────┐
                       │ 每步写 F021 WAL              │
                       │  + AuditEntry（可审计）       │
                       │  + F022 Tier 分级拒绝点       │
                       │  + F011 MagicWords 拦截点     │
                       └──────────────────────────────┘
```

### 2.2 关键架构决策

- **决策 1：操作分类而非全走强 workflow**。开放协作（如代码生成、文档撰写）走轻量状态机保留模型判断力；严肃副作用（如转账/审批/merge/release）走强 workflow 保证可审计可回放可拒绝。理由：全走强 workflow 会扼杀模型判断力，全走轻量状态机会让严肃操作不可审计。
- **决策 2：严肃操作列表外置 YAML**。`serious_operations: [transfer, approve, message_send, merge, release, delete_data, physical_op]` 列表从配置加载。理由：业务演进可能新增严肃操作类型，配置驱动可热更新。
- **决策 3：强 workflow 四属性硬约束**。可审计 + 可回放 + 可拒绝 + rollback_on_reject 四属性必须同时满足，缺一即拒绝注册。理由：roleagent.md 第 6 章硬要求，强 workflow 不允许"可审计但不可拒绝"等部分实现。
- **决策 4：每步写 F021 WAL**。强 workflow 每步必须 append WAL entry，按 F022 Tier 分级决定拒绝点。理由：可审计可回放的物理承载是 WAL，无 WAL 的强 workflow 是空壳。
- **决策 5：reject 触发 rollback 可回滚步骤**。任何一步可被 F011 reject，workflow 终止并回滚可回滚步骤（不可回滚步骤标记 failed）。理由：roleagent.md 第 6 章要求"可拒绝"，且拒绝后必须清理已执行步骤。
- **决策 6：replayable=true 的 workflow 可按 WAL 回放恢复**。强 workflow 标记 replayable=true 的可按 WAL 回放恢复，进程重启后 F022 Tier 1/2 自动 replay。理由：可回放是强 workflow 的核心属性之一。
- **决策 7：默认开放协作**。未在 serious_operations 列表的操作默认 OPEN_COLLABORATION。理由：保留模型判断力是默认选项，强制严肃操作需显式声明。

### 2.3 架构不变量

- 所有操作必须分类为 OPEN_COLLABORATION 或 SERIOUS_SIDE_EFFECT 之一，必须无未分类操作。
- 强 workflow 必须满足可审计 + 可回放 + 可拒绝 + rollback_on_reject 四属性，缺一即拒绝注册。
- 强 workflow 每步必须写 F021 WAL，必须按 F022 Tier 分级拒绝点。
- 任何一步必须可被 F011 reject，必须触发 rollback 可回滚步骤。
- replayable=true 的 workflow 必须可按 WAL 回放恢复。
- 严肃操作列表必须从配置加载，必须禁止代码硬编码。

---

## 3. 模块设计

### 3.1 模块边界

| 模块 | 路径 | 职责 | 对外暴露 |
|------|------|------|---------|
| OperationClassifier | `flowforge/core/reliability/workflow/classifier.py` | 操作分类 | `classify` |
| StrongWorkflowEngine | `flowforge/core/reliability/workflow/engine.py` | 强 workflow 引擎 | `start / advance / reject / replay` |
| WorkflowRepository | `flowforge/core/reliability/workflow/repository.py` | 持久化 workflow 与 audit log | 不对上层暴露 |
| AuditLogger | `flowforge/core/reliability/workflow/audit.py` | 审计日志记录 | `log_step` |
| WorkflowRollbacker | `flowforge/core/reliability/workflow/rollback.py` | rollback 已执行步骤 | `rollback_step` |
| WorkflowConfigLoader | `flowforge/core/reliability/workflow/config.py` | YAML 配置加载 | `load_workflow_config` |

### 3.2 接口契约

```python
from abc import ABC, abstractmethod
from typing import Optional, Literal
from datetime import datetime
from pydantic import BaseModel, Field
from enum import Enum


class OperationClass(str, Enum):
    OPEN_COLLABORATION = "open_collaboration"
    SERIOUS_SIDE_EFFECT = "serious_side_effect"


class WorkflowStep(BaseModel):
    step_id: str
    action: str
    wal_entry_id: Optional[str] = None  # 关联 F021 WAL
    tier: int  # 关联 F022 Tier
    confirmed: bool = False
    audit_entry_id: Optional[str] = None


class StrongWorkflow(BaseModel):
    workflow_id: str
    operation_class: OperationClass = OperationClass.SERIOUS_SIDE_EFFECT
    steps: list[WorkflowStep] = Field(min_length=1)
    audit_log: list[str] = []  # AuditEntry ID 列表
    replayable: bool = True
    rejectable: bool = True
    rollback_on_reject: bool = True
    current_step: int = 0


class AuditEntry(BaseModel):
    audit_entry_id: str
    workflow_id: str
    step_id: str
    forgekin_id: str
    action: str
    result: Literal["success", "failed", "rolled_back", "rejected"]
    timestamp: datetime
    wal_entry_id: Optional[str] = None


class OperationClassifier(ABC):
    @abstractmethod
    def classify(self, operation: str) -> OperationClass:
        """
        按 serious_operations 列表分类：
        - 在列表中 → SERIOUS_SIDE_EFFECT
        - 不在列表中 → OPEN_COLLABORATION
        列表从配置加载
        """


class StrongWorkflowEngine(ABC):
    @abstractmethod
    async def start(self, workflow: StrongWorkflow) -> str:
        """
        启动 workflow：
        1. 校验四属性（replayable + rejectable + rollback_on_reject + audit_log）
        2. 持久化 workflow
        """

    @abstractmethod
    async def advance(self, workflow_id: str) -> None:
        """
        推进到下一步：
        1. 写 F021 WAL（每步）
        2. 按 F022 Tier 分级拒绝点
        3. F011 MagicWords 拦截点
        4. AuditEntry 记录
        """

    @abstractmethod
    async def reject(self, workflow_id: str, reason: str) -> None:
        """
        拒绝当前步骤：
        1. 标记当前 step rejected
        2. rollback 已执行可回滚步骤
        3. 终止 workflow
        """

    @abstractmethod
    async def replay(self, workflow_id: str) -> None:
        """按 WAL 回放恢复（仅 replayable=true 的 workflow）"""


class AuditLogger(ABC):
    @abstractmethod
    async def log_step(
        self, workflow_id: str, step_id: str, action: str, result: str,
        wal_entry_id: Optional[str] = None
    ) -> str:
        """记录审计日志；写入 F040 EvalHub"""
```

### 3.3 数据流

```
[操作分类路径]
  Forgekin.act() 触发操作
        │
        ▼
  OperationClassifier.classify(operation)
        │
        ├─ operation in serious_operations → SERIOUS_SIDE_EFFECT
        └─ 否则 → OPEN_COLLABORATION
        │
        ▼
  OPEN_COLLABORATION → 走 LoopExecutor（轻量状态机）
  SERIOUS_SIDE_EFFECT → 走 StrongWorkflowEngine

[强 workflow 执行路径]
  StrongWorkflowEngine.start(workflow)
        │
        ├─ 校验四属性 ── 缺一 ──▶ 拒绝注册
        │
        ▼
  for each step:
        │
        ▼
  StrongWorkflowEngine.advance(workflow_id)
        │
        ├─ 写 F021 WAL（append_pending + execute + confirm）
        ├─ F022 Tier 分级拒绝点（Tier 0/4 → hard_reject）
        ├─ F011 MagicWords 拦截点（可被星星罐子拦截）
        │
        ├─ 拦截 / 拒绝 → reject()
        │              │
        │              ▼
        │              WorkflowRollbacker.rollback_step()
        │              ├─ 可回滚操作 → 恢复 pre_state
        │              └─ 不可回滚操作 → 标记 failed
        │
        ├─ AuditLogger.log_step() 写审计日志
        │
        ▼
  current_step += 1
        │
        ▼
  所有步骤完成 → workflow 终态 success

[回放恢复路径]
  进程重启 + workflow 未完成
        │
        ▼
  StrongWorkflowEngine.replay(workflow_id)
        │
        ├─ 仅 replayable=true 的 workflow
        ├─ 按 F021 WAL 回放每步
        │
        ▼
  F022 Tier 分级决定每步恢复策略
```

---

## 4. 跨模块协作

### 4.1 上游依赖

- 依赖 **F002 TeamAct Loop**：TeamAct 的严肃操作步骤触发强 workflow。
- 依赖 **F021 副作用 WAL**：每步写 WAL，是可审计可回放的物理承载。
- 依赖 **F022 Tier 1-4 恢复分级**：每步按 Tier 分级拒绝点。

### 4.2 下游影响

- 影响 **F011 Magic Words**：强 workflow 任何一步可被 F011 reject。
- 影响 **F023 liveness 规范读模型**：强 workflow 步骤推进需 liveness alive 状态支撑。
- 影响 **F040 控制面**：强 workflow 审计日志写入 F040 Eval Hub。
- 影响 **F029 物理 AI 传感器接入**：physical_op 走强 workflow，对应 Tier 0。

### 4.3 跨模块不变量

- 所有操作必须分类为 OPEN_COLLABORATION 或 SERIOUS_SIDE_EFFECT，必须无未分类操作。
- 强 workflow 四属性必须同时满足，缺一即拒绝注册。
- 每步必须写 F021 WAL，必须按 F022 Tier 分级拒绝点。
- 任何一步必须可被 F011 reject，必须触发 rollback 可回滚步骤。
- 不可回滚步骤 reject 后必须标记 failed，必须不尝试 rollback。
- 严肃操作列表必须从配置加载，必须禁止代码硬编码。

---

## 5. 架构验收

### 5.1 架构契约验收

- [ ] AC-1: 单向依赖通过——`flowforge/core/reliability/workflow/` 不 import F002/F011/F021/F022/F023/F029/F040 任何模块。
- [ ] AC-2: DI 容器注入通过——`StrongWorkflowEngine` 通过 `inject("strong_workflow_engine")` 获取。
- [ ] AC-3: Repository 层通过——workflow 与 audit log 持久化经 Repository，不直操作数据库。
- [ ] AC-4: 配置驱动通过——严肃操作列表 / 四属性 / rollback 策略从 `config/state_vs_workflow.yaml` 加载。
- [ ] AC-5: 操作分类覆盖所有 SideEffectType（单测覆盖）。

### 5.2 架构不变量验收

- [ ] AC-6: 严肃副作用操作必须经 StrongWorkflowEngine（单测覆盖 transfer/approve/merge/release 等）。
- [ ] AC-7: 每步写 F021 WAL 并按 F022 Tier 分级（集成测试覆盖）。
- [ ] AC-8: 任何一步可被 reject 并回滚可回滚步骤（单测覆盖）。
- [ ] AC-9: replayable=true 的 workflow 可按 WAL 回放恢复（单测覆盖）。
- [ ] AC-10: 审计日志完整记录每步（断言遍历）。
- [ ] AC-11: 强 workflow 四属性缺一即拒绝注册（单测覆盖 4 种缺失场景）。

---

## 6. 引用

- [doc:../spec.md#§3.6]
- [doc:../arch.md#§3.6]
- [doc:../features/F002-teamact-loop.md]
- [doc:../features/F011-magic-words.md]
- [doc:../features/F021-side-effect-wal.md]
- [doc:../features/F022-tier-1-4-recovery.md]
- [doc:../features/F023-liveness-canonical-read.md]
- [doc:../features/F024-weak-state-vs-strong-workflow.md]
- [doc:../features/F029-physical-ai-sensors.md]
- [doc:../decisions/010-distributed-reliability.md]
- [doc:../../../hiclaw/rules.md#第十一部分]
- [doc:../../../hiclaw/rules.md#编程红线]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（架构骨架 + 操作分类 + 强 workflow 四属性 + reject rollback + replay） | 架构师灵智体（猫头鹰·鲁班） |
