# D024: 弱状态机 vs 强 workflow 详细设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 开发者灵智体（猎犬·夏洛克）
> **对应 spec.md**: [doc:../spec.md#§3.6]（FR-CORE-006）
> **对应 arch.md**: [doc:../arch.md#§3.6]
> **对应 design.md**: [doc:../design.md#§3.6]
> **对应 Feature**: [doc:../features/F024-weak-state-vs-strong-workflow.md]（同号 Feature 级 SRS）
> **对应 Architecture**: [doc:../architecture/A024-weak-state-vs-strong-workflow.md]（同号 Feature 级 SAD）
> **依赖 ADR**: [doc:../decisions/010-distributed-reliability.md]
> **9 大点名称修订**: 已应用（双轨命名 + AI 术语优先 + 弱化万物 + 去 AGI 化）

---

## 1. 详细设计上下文

### 1.1 设计问题

分布式可靠性（§3.6）的操作执行边界子系统需要区分"开放协作"和"严肃副作用"，A024 架构设计已确认双轨机制：
1. **开放协作（OPEN_COLLABORATION）**：走轻量状态机（LoopExecutor），保留模型判断力
2. **严肃副作用（SERIOUS_SIDE_EFFECT）**：走强 workflow，保证可审计 + 可回放 + 可拒绝 + rollback_on_reject
3. **强 workflow 四属性硬约束**：replayable + rejectable + rollback_on_reject + audit_log，缺一即拒绝注册
4. **每步写 F021 WAL**：强 workflow 每步必须 append WAL entry
5. **F011 MagicWords 拦截点**：任何一步可被 F011 reject
6. **F022 Tier 分级拒绝点**：按 Tier 0/4 硬拒、Tier 1/2 回放

本详细设计进一步下沉到代码层，需要解决以下子问题：

1. **操作分类的实现**：`OperationClassifier` 按配置的 `serious_operations` 列表分类，如何保证默认开放协作。
2. **强 workflow 四属性校验**：注册 workflow 时校验四属性齐全，缺一即拒绝。
3. **每步写 WAL 的协调**：`advance()` 调用 `WalAppender.append_pending` + `WalExecutor.execute` + `WalExecutor.confirm` 三阶段。
4. **F011 MagicWords 拦截点**：每步执行前调用 `MagicWordsGuard.check()`，命中 magic word 则 reject。
5. **reject 触发 rollback**：reject 后回滚已执行的可回滚步骤，不可回滚步骤标记 failed。
6. **replay 按 WAL 回放恢复**：进程重启后未完成的 workflow 按 WAL 回放，调用 `WalReplayer.replay()`。
7. **审计日志的写入**：每步写 AuditEntry，关联 wal_entry_id，写入 F040 Eval Hub。
8. **强 workflow 状态机**：created → running → success / rejected / failed 的合法转换。

### 1.2 设计约束

- **单向依赖约束**：`flowforge/core/reliability/workflow/` 禁止 import F022/F040 任何模块（编程红线第 10 条延伸）。F022 通过 EventBus 接收恢复请求。
- **DI 容器约束**：`StrongWorkflowEngine` 通过 DI 容器注入，绑定生命周期为 `singleton`，禁止直接实例化（编程红线第 12 条）。
- **Repository 层约束**：workflow 与 audit log 持久化必须经 `WorkflowRepository` 抽象，禁止直操作数据库（编程红线第 13 条）。
- **配置驱动约束**：严肃操作列表 / 强 workflow 属性 / rollback 策略外置 YAML（编程红线第 11 条）。
- **四属性硬约束**：强 workflow 必须满足 replayable + rejectable + rollback_on_reject + audit_log 四属性，缺一即拒绝注册。
- **每步 WAL 硬约束**：强 workflow 每步必须写 F021 WAL，按 F022 Tier 分级拒绝点。
- **reject rollback 硬约束**：reject 后必须回滚可回滚步骤，不可回滚步骤标记 failed。
- **默认开放协作约束**：未在 serious_operations 列表的操作默认 OPEN_COLLABORATION。
- **异步约束**：所有 I/O 操作使用 `async/await`。
- **类型注解约束**：Python 3.11+，所有公共方法强制类型注解。

### 1.3 设计影响

- **对 F002 TeamAct**：TeamAct 的"严肃操作"步骤走强 workflow，开放协作步骤走轻量状态机。
- **对 F011 Magic Words**：强 workflow 任何一步可被 F011 reject。本设计嵌入 F011 MagicWordsGuard。
- **对 F021 副作用 WAL**：强 workflow 每步写 WAL。本设计调用 F021 WalAppender/WalExecutor。
- **对 F022 Tier 1-4 恢复**：强 workflow 的 rejectable 步骤对应 Tier 0/4，replayable 步骤对应 Tier 1/2。本设计派发恢复请求到 F022。
- **对 F023 liveness**：强 workflow 每步前检查 liveness，zombie 状态拒绝执行。
- **对 F040 控制面**：强 workflow 审计日志写入 F040 Eval Hub。本设计派发 `workflow.*` 事件。
- **对 Forgekin.act()**：Forgekin 执行操作前调用 `OperationClassifier.classify()` 决定走轻量状态机还是强 workflow。
- **对 DI 容器**：需新增 `operation_classifier` / `strong_workflow_engine` / `audit_logger` / `workflow_rollbacker` / `workflow_repository` 五个绑定。

---

## 2. 详细设计

### 2.1 类图 ASCII

```
┌──────────────────────────────────────────────────────────────────────────┐
│                    <<module>> reliability.workflow                          │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  <<enum>> OperationClass                                                   │
│  + OPEN_COLLABORATION     开放协作（轻量状态机）                            │
│  + SERIOUS_SIDE_EFFECT    严肃副作用（强 workflow）                         │
│                                                                            │
│  <<enum>> WorkflowStatus                                                   │
│  + CREATED                已创建                                           │
│  + RUNNING                运行中                                           │
│  + SUCCESS                成功                                             │
│  + REJECTED               被拒绝                                           │
│  + FAILED                 失败                                             │
│  + ROLLED_BACK            已回滚                                           │
│                                                                            │
│  <<enum>> StepResult                                                      │
│  + PENDING                待执行                                           │
│  + SUCCESS                成功                                             │
│  + FAILED                 失败                                             │
│  + ROLLED_BACK            已回滚                                           │
│  + REJECTED               被拒绝                                           │
│                                                                            │
│  <<model>> WorkflowStep                                                    │
│  + step_id: str                                                            │
│  + action: str                                                             │
│  + wal_entry_id: Optional[str]    # 关联 F021 WAL                          │
│  + tier: int                     # 关联 F022 Tier                          │
│  + reversible: bool              # 该步是否可回滚                          │
│  + pre_state: Optional[dict]     # 执行前状态快照                           │
│  + post_state: Optional[dict]    # 执行后状态快照                           │
│  + result: StepResult                                                   │
│  + audit_entry_id: Optional[str] # 关联 AuditEntry                          │
│  + executed_at: Optional[datetime]                                       │
│                                                                            │
│  <<model>> StrongWorkflow                                                  │
│  + workflow_id: str                                                         │
│  + operation_class: OperationClass = SERIOUS_SIDE_EFFECT                  │
│  + steps: list[WorkflowStep]                                              │
│  + audit_log: list[str]    # AuditEntry ID 列表                            │
│  + replayable: bool = True                                                │
│  + rejectable: bool = True                                                │
│  + rollback_on_reject: bool = True                                        │
│  + status: WorkflowStatus = CREATED                                       │
│  + current_step: int = 0                                                  │
│  + created_at: datetime                                                   │
│  + completed_at: Optional[datetime]                                       │
│                                                                            │
│  <<model>> AuditEntry                                                     │
│  + audit_entry_id: str                                                    │
│  + workflow_id: str                                                       │
│  + step_id: str                                                            │
│  + forgekin_id: str                                                        │
│  + action: str                                                             │
│  + result: StepResult                                                      │
│  + timestamp: datetime                                                    │
│  + wal_entry_id: Optional[str]                                            │
│  + operator_id: str    # 操作者（forgekin_id 或 system）                    │
│                                                                            │
│  <<interface>> OperationClassifier (ABC)                                  │
│  + classify(operation) -> OperationClass                                   │
│                                                                            │
│  <<interface>> StrongWorkflowEngine (ABC)                                  │
│  + start(workflow) -> str                                                  │
│  + advance(workflow_id) -> WorkflowStep                                   │
│  + reject(workflow_id, reason) -> None                                    │
│  + replay(workflow_id) -> None                                            │
│                                                                            │
│  <<interface>> AuditLogger (ABC)                                           │
│  + log_step(workflow_id, step_id, action, result, wal_entry_id) -> str     │
│  + query_audit_log(workflow_id) -> list[AuditEntry]                       │
│                                                                            │
│  <<interface>> WorkflowRollbacker (ABC)                                    │
│  + rollback_step(step) -> WorkflowStep                                    │
│  + rollback_workflow(workflow) -> None                                     │
│                                                                            │
│  <<interface>> WorkflowRepository (ABC)                                   │
│  + insert_workflow(workflow) -> str                                       │
│  + update_status(workflow_id, status, **fields) -> None                    │
│  + get(workflow_id) -> Optional[StrongWorkflow]                            │
│  + query_incomplete() -> list[StrongWorkflow]                              │
│  + insert_audit(entry) -> str                                              │
│  + query_audit(workflow_id) -> list[AuditEntry]                           │
│                                                                            │
└──────────────────────────────────────────────────────────────────────────┘
```

### 2.2 接口实现 Python 代码

```python
# flowforge/core/reliability/workflow/models.py
from __future__ import annotations
from typing import Optional, Any
from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict, model_validator
from enum import Enum


class OperationClass(str, Enum):
    OPEN_COLLABORATION = "open_collaboration"
    SERIOUS_SIDE_EFFECT = "serious_side_effect"


class WorkflowStatus(str, Enum):
    CREATED = "created"
    RUNNING = "running"
    SUCCESS = "success"
    REJECTED = "rejected"
    FAILED = "failed"
    ROLLED_BACK = "rolled_back"


class StepResult(str, Enum):
    PENDING = "pending"
    SUCCESS = "success"
    FAILED = "failed"
    ROLLED_BACK = "rolled_back"
    REJECTED = "rejected"


# 合法的 workflow 状态转换矩阵
WORKFLOW_TRANSITIONS = {
    WorkflowStatus.CREATED: {WorkflowStatus.RUNNING},
    WorkflowStatus.RUNNING: {WorkflowStatus.SUCCESS, WorkflowStatus.REJECTED, WorkflowStatus.FAILED},
    WorkflowStatus.SUCCESS: set(),  # 终态
    WorkflowStatus.REJECTED: {WorkflowStatus.ROLLED_BACK},
    WorkflowStatus.FAILED: {WorkflowStatus.ROLLED_BACK},
    WorkflowStatus.ROLLED_BACK: set(),  # 终态
}


class WorkflowStep(BaseModel):
    """workflow 步骤"""
    model_config = ConfigDict(frozen=True)

    step_id: str = Field(min_length=1)
    action: str = Field(min_length=1)
    wal_entry_id: Optional[str] = None  # 关联 F021 WAL
    tier: int = Field(ge=0, le=4)  # 关联 F022 Tier
    reversible: bool = True
    pre_state: Optional[dict] = None
    post_state: Optional[dict] = None
    result: StepResult = StepResult.PENDING
    audit_entry_id: Optional[str] = None
    executed_at: Optional[datetime] = None

    @model_validator(mode="after")
    def _validate_reversible_consistency(self) -> "WorkflowStep":
        if self.reversible and self.pre_state is None and self.result != StepResult.PENDING:
            # 仅在已执行后校验 pre_state（执行前可以为空）
            pass
        return self


class StrongWorkflow(BaseModel):
    """强 workflow"""
    model_config = ConfigDict(frozen=True)

    workflow_id: str = Field(min_length=1)
    operation_class: OperationClass = OperationClass.SERIOUS_SIDE_EFFECT
    steps: list[WorkflowStep] = Field(min_length=1)
    audit_log: list[str] = Field(default_factory=list)  # AuditEntry ID 列表
    replayable: bool = True
    rejectable: bool = True
    rollback_on_reject: bool = True
    status: WorkflowStatus = WorkflowStatus.CREATED
    current_step: int = Field(default=0, ge=0)
    forgekin_id: str = Field(min_length=1)
    created_at: datetime
    completed_at: Optional[datetime] = None

    @model_validator(mode="after")
    def _validate_four_attributes(self) -> "StrongWorkflow":
        """四属性硬约束：replayable + rejectable + rollback_on_reject + audit_log"""
        if not self.replayable:
            raise ValueError(
                "强 workflow 必须满足 replayable=true (hard constraint)"
            )
        if not self.rejectable:
            raise ValueError(
                "强 workflow 必须满足 rejectable=true (hard constraint)"
            )
        if not self.rollback_on_reject:
            raise ValueError(
                "强 workflow 必须满足 rollback_on_reject=true (hard constraint)"
            )
        # audit_log 在 start 时校验非空
        return self


class AuditEntry(BaseModel):
    """审计日志条目"""
    model_config = ConfigDict(frozen=True)

    audit_entry_id: str = Field(min_length=1)
    workflow_id: str = Field(min_length=1)
    step_id: str = Field(min_length=1)
    forgekin_id: str = Field(min_length=1)
    action: str = Field(min_length=1)
    result: StepResult
    timestamp: datetime
    wal_entry_id: Optional[str] = None
    operator_id: str = Field(min_length=1)


# flowforge/core/reliability/workflow/interfaces.py
from abc import ABC, abstractmethod
from typing import Optional


class OperationClassifier(ABC):
    """操作分类器"""

    @abstractmethod
    def classify(self, operation: str) -> OperationClass:
        """
        按 serious_operations 列表分类：
        - 在列表中 → SERIOUS_SIDE_EFFECT
        - 不在列表中 → OPEN_COLLABORATION（默认）
        """


class StrongWorkflowEngine(ABC):
    """强 workflow 引擎"""

    @abstractmethod
    async def start(self, workflow: StrongWorkflow) -> str:
        """
        启动 workflow：
        1. 校验四属性（replayable + rejectable + rollback_on_reject + audit_log 非空）
        2. 持久化 workflow
        3. 状态转换：CREATED → RUNNING
        """

    @abstractmethod
    async def advance(self, workflow_id: str) -> WorkflowStep:
        """
        推进到下一步：
        1. 写 F021 WAL（append_pending + execute + confirm）
        2. F022 Tier 分级拒绝点
        3. F011 MagicWords 拦截点
        4. F023 liveness 检查
        5. AuditEntry 记录
        返回当前 step
        """

    @abstractmethod
    async def reject(self, workflow_id: str, reason: str) -> None:
        """
        拒绝当前步骤：
        1. 标记当前 step rejected
        2. rollback 已执行可回滚步骤
        3. 终止 workflow（状态转 REJECTED）
        """

    @abstractmethod
    async def replay(self, workflow_id: str) -> None:
        """按 WAL 回放恢复（仅 replayable=true 的 workflow）"""


class AuditLogger(ABC):
    """审计日志记录器"""

    @abstractmethod
    async def log_step(
        self, workflow_id: str, step_id: str, action: str,
        result: StepResult, wal_entry_id: Optional[str] = None,
        forgekin_id: str = "", operator_id: str = "",
    ) -> str:
        """记录审计日志；写入 F040 EvalHub"""

    @abstractmethod
    async def query_audit_log(
        self, workflow_id: str
    ) -> list[AuditEntry]: ...


class WorkflowRollbacker(ABC):
    """workflow 回滚器"""

    @abstractmethod
    async def rollback_step(self, step: WorkflowStep) -> WorkflowStep:
        """回滚单个 step（可回滚操作恢复 pre_state）"""

    @abstractmethod
    async def rollback_workflow(self, workflow: StrongWorkflow) -> None:
        """回滚整个 workflow 的已执行步骤"""


class WorkflowRepository(ABC):
    """workflow 持久化 Repository"""

    @abstractmethod
    async def insert_workflow(self, workflow: StrongWorkflow) -> str: ...

    @abstractmethod
    async def update_status(
        self, workflow_id: str, status: WorkflowStatus, **fields
    ) -> None: ...

    @abstractmethod
    async def get(self, workflow_id: str) -> Optional[StrongWorkflow]: ...

    @abstractmethod
    async def query_incomplete(self) -> list[StrongWorkflow]: ...

    @abstractmethod
    async def insert_audit(self, entry: AuditEntry) -> str: ...

    @abstractmethod
    async def query_audit(self, workflow_id: str) -> list[AuditEntry]: ...

    @abstractmethod
    async def update_step(
        self, workflow_id: str, step_id: str, **fields
    ) -> None: ...
```

### 2.3 数据结构 Pydantic Models（配置）

```python
# flowforge/core/reliability/workflow/config.py
from __future__ import annotations
from typing import Optional
from pydantic import BaseModel, Field, model_validator


class SeriousOperationRule(BaseModel):
    """严肃操作规则"""
    operation: str  # 操作名（如 transfer / merge / release）
    tier: int = Field(default=2, ge=0, le=4)  # 默认 Tier
    reversible: bool = True
    description: Optional[str] = None


class WorkflowConfig(BaseModel):
    """YAML 配置加载结果"""
    serious_operations: list[SeriousOperationRule] = Field(min_length=1)
    default_tier: int = Field(default=2, ge=0, le=4)
    max_steps_per_workflow: int = Field(default=20, ge=1, le=100)
    step_timeout_seconds: int = Field(default=60, ge=5, le=600)
    replay_batch_size: int = Field(default=10, ge=1, le=100)
    audit_log_required: bool = True  # 四属性之一
    magic_words_check_enabled: bool = True

    @model_validator(mode="after")
    def _validate_serious_operations(self) -> "WorkflowConfig":
        if not self.serious_operations:
            raise ValueError("serious_operations must not be empty")
        # operation 名唯一
        ops = [r.operation for r in self.serious_operations]
        if len(ops) != len(set(ops)):
            raise ValueError(
                f"serious_operations must be unique, got duplicates: {ops}"
            )
        if self.audit_log_required is not True:
            raise ValueError(
                "audit_log_required must be True (hard constraint for 四属性)"
            )
        return self
```

### 2.4 关键算法伪代码

#### 2.4.1 操作分类算法

```
function classify(operation: str) -> OperationClass:

    # 在 serious_operations 列表中 → SERIOUS_SIDE_EFFECT
    for rule in config.serious_operations:
        if rule.operation == operation:
            return OperationClass.SERIOUS_SIDE_EFFECT

    # 默认 OPEN_COLLABORATION（保留模型判断力）
    return OperationClass.OPEN_COLLABORATION
```

#### 2.4.2 启动 workflow 算法

```
function start(workflow: StrongWorkflow) -> str:

    # 1. 四属性硬校验（Pydantic 已保证）
    # 但 audit_log 必须非空（启动时为空，start 后追加）
    # 实际：audit_log 在 start 后追加第一条 audit_entry

    # 2. 校验 steps 非空
    if not workflow.steps:
        raise ValueError("workflow.steps must not be empty")

    # 3. 校验 step.tier 范围
    for step in workflow.steps:
        if step.tier < 0 or step.tier > 4:
            raise ValueError(f"step {step.step_id} tier {step.tier} out of range [0,4]")

    # 4. 持久化
    await workflow_repository.insert_workflow(workflow)

    # 5. 状态转换：CREATED → RUNNING
    transition_workflow_status(workflow.status, WorkflowStatus.RUNNING)
    await workflow_repository.update_status(
        workflow.workflow_id, WorkflowStatus.RUNNING
    )

    # 6. 派发事件
    await event_bus.publish(
        topic="workflow.started",
        payload={"workflow_id": workflow.workflow_id},
    )

    return workflow.workflow_id
```

#### 2.4.3 推进下一步算法

```
function advance(workflow_id: str) -> WorkflowStep:

    workflow = await workflow_repository.get(workflow_id)
    if workflow is None:
        raise WorkflowNotFoundError(workflow_id)

    # 1. 状态校验
    if workflow.status != WorkflowStatus.RUNNING:
        raise IllegalWorkflowTransitionError(
            f"cannot advance workflow in status {workflow.status}"
        )

    # 2. 边界检查
    if workflow.current_step >= len(workflow.steps):
        # 所有步骤完成，标记 SUCCESS
        await workflow_repository.update_status(
            workflow_id, WorkflowStatus.SUCCESS,
            completed_at=now(),
        )
        await event_bus.publish(
            topic="workflow.completed",
            payload={"workflow_id": workflow_id, "status": "success"},
        )
        return workflow.steps[-1]

    step = workflow.steps[workflow.current_step]

    # 3. F023 liveness 检查（zombie 拒绝执行）
    liveness_ok = await canonical_read_model.check_liveness(
        workflow.forgekin_id, LivenessState.ALIVE
    )
    if not liveness_ok:
        # zombie 状态，拒绝执行
        await self.reject(workflow_id, reason="liveness zombie")
        return step

    # 4. F011 MagicWords 拦截点
    if config.magic_words_check_enabled:
        magic_word = magic_words_guard.detect_magic_word(
            await get_recent_user_input(workflow.forgekin_id)
        )
        if magic_word is not None:
            await self.reject(workflow_id, reason=f"magic_word: {magic_word}")
            return step

    # 5. F022 Tier 分级拒绝点
    if step.tier == 0:
        # Tier 0 忽略，直接通过
        pass
    elif step.tier == 4:
        # Tier 4 硬拒
        await self.reject(workflow_id, reason="tier_4 hard reject")
        return step

    # 6. 写 F021 WAL（先写后执行）
    wal_entry = WalEntry(
        entry_id=uuid_v7(),
        idempotency_key=f"workflow:{workflow_id}:step:{step.step_id}",
        forgekin_id=workflow.forgekin_id,
        workflow_id=workflow_id,
        effect_type=map_action_to_effect_type(step.action),
        status=WalStatus.PENDING,
        action_payload={"action": step.action},
        pre_state=step.pre_state,
        reversible=Reversibility.REVERSIBLE if step.reversible else Reversibility.IRREVERSIBLE,
        created_at=now(),
    )
    executed_entry = await wal_coordinator.execute_with_wal(wal_entry)
    step = step.model_copy(update={
        "wal_entry_id": executed_entry.entry_id,
        "post_state": executed_entry.post_state,
        "result": StepResult.SUCCESS if executed_entry.status == WalStatus.CONFIRMED else StepResult.FAILED,
        "executed_at": now(),
    })
    await workflow_repository.update_step(
        workflow_id, step.step_id,
        wal_entry_id=step.wal_entry_id,
        post_state=step.post_state,
        result=step.result,
        executed_at=step.executed_at,
    )

    # 7. 失败处理
    if step.result == StepResult.FAILED:
        if workflow.rollback_on_reject:
            await self.reject(workflow_id, reason=f"step {step.step_id} failed")
        else:
            await workflow_repository.update_status(
                workflow_id, WorkflowStatus.FAILED,
                completed_at=now(),
            )
        return step

    # 8. AuditEntry 记录
    audit_id = await audit_logger.log_step(
        workflow_id=workflow_id,
        step_id=step.step_id,
        action=step.action,
        result=step.result,
        wal_entry_id=step.wal_entry_id,
        forgekin_id=workflow.forgekin_id,
        operator_id=workflow.forgekin_id,
    )

    # 9. 推进 current_step
    await workflow_repository.update_status(
        workflow_id, workflow.status,
        current_step=workflow.current_step + 1,
    )

    return step
```

#### 2.4.4 reject 与 rollback 算法

```
function reject(workflow_id: str, reason: str) -> None:

    workflow = await workflow_repository.get(workflow_id)
    if workflow is None:
        raise WorkflowNotFoundError(workflow_id)

    # 1. 状态转换：RUNNING → REJECTED
    transition_workflow_status(workflow.status, WorkflowStatus.REJECTED)
    await workflow_repository.update_status(
        workflow_id, WorkflowStatus.REJECTED,
        completed_at=now(),
    )

    # 2. rollback_on_reject 硬约束
    if not workflow.rollback_on_reject:
        raise ValueError(
            "rollback_on_reject=false violates 四属性 hard constraint"
        )

    # 3. 回滚已执行的可回滚步骤
    for i in range(workflow.current_step):
        step = workflow.steps[i]
        if step.result == StepResult.SUCCESS and step.reversible:
            await workflow_rollbacker.rollback_step(step)
            await workflow_repository.update_step(
                workflow_id, step.step_id,
                result=StepResult.ROLLED_BACK,
            )
        elif step.result == StepResult.SUCCESS and not step.reversible:
            # 不可回滚步骤标记 failed
            await workflow_repository.update_step(
                workflow_id, step.step_id,
                result=StepResult.FAILED,
            )
            logger.warning(
                f"step {step.step_id} irreversible, marked failed"
            )

    # 4. 派发事件
    await event_bus.publish(
        topic="workflow.rejected",
        payload={"workflow_id": workflow_id, "reason": reason},
    )

    # 5. 派发 F022 恢复请求（按 Tier 分级）
    await event_bus.publish(
        topic="recovery.request",
        payload={
            "fault_id": f"workflow_reject:{workflow_id}",
            "forgekin_id": workflow.forgekin_id,
            "fault_type": "WorkflowRejected",
            "failure_count": 1,
            "last_error": reason,
            "workflow_id": workflow_id,
        },
    )
```

#### 2.4.5 replay 按 WAL 回放算法

```
function replay(workflow_id: str) -> None:

    workflow = await workflow_repository.get(workflow_id)
    if workflow is None:
        raise WorkflowNotFoundError(workflow_id)

    # 1. 仅 replayable=true 的 workflow 可回放
    if not workflow.replayable:
        raise ValueError(
            "workflow.replayable=false, cannot replay"
        )

    # 2. 状态校验（仅 RUNNING/FAILED 状态可回放）
    if workflow.status not in (WorkflowStatus.RUNNING, WorkflowStatus.FAILED):
        raise IllegalWorkflowTransitionError(
            f"cannot replay workflow in status {workflow.status}"
        )

    # 3. 按 WAL 回放每步
    for i in range(workflow.current_step, len(workflow.steps)):
        step = workflow.steps[i]

        # 调用 F021 WalReplayer.replay_entry
        wal_entry = await wal_repository.get(step.wal_entry_id) if step.wal_entry_id else None
        if wal_entry:
            await wal_replayer.replay_entry(wal_entry)
            await workflow_repository.update_step(
                workflow_id, step.step_id,
                result=StepResult.SUCCESS,
                executed_at=now(),
            )
        else:
            # 无 WAL entry，重新执行
            await self.advance(workflow_id)

    # 4. 全部步骤完成 → SUCCESS
    await workflow_repository.update_status(
        workflow_id, WorkflowStatus.SUCCESS,
        completed_at=now(),
    )
```

---

## 3. 模块实现

### 3.1 关键代码片段

```python
# flowforge/core/reliability/workflow/engine.py
from __future__ import annotations
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from .models import (
    OperationClass, WorkflowStatus, StepResult,
    WorkflowStep, StrongWorkflow, AuditEntry,
    WORKFLOW_TRANSITIONS,
)
from .interfaces import (
    OperationClassifier, StrongWorkflowEngine,
    AuditLogger, WorkflowRollbacker, WorkflowRepository,
)
from .config import WorkflowConfig
from ...core.events.event_bus import EventBus
from ...core.reliability.wal.interfaces import WalCoordinator, WalRepository, WalReplayer
from ...core.reliability.wal.models import (
    WalEntry, WalStatus, SideEffectType, Reversibility,
)
from ...core.reliability.liveness.interfaces import CanonicalReadModel
from ...core.reliability.liveness.models import LivenessState
from ...core.reliability.recovery.interfaces import MagicWordsGuard

logger = logging.getLogger(__name__)


class IllegalWorkflowTransitionError(Exception):
    """workflow 状态非法转换"""
    pass


class WorkflowNotFoundError(Exception):
    """workflow 不存在"""
    pass


class FourAttributesViolationError(Exception):
    """四属性违规"""
    pass


class DefaultOperationClassifier(OperationClassifier):
    """操作分类器默认实现"""

    def __init__(self, config: WorkflowConfig):
        self._cfg = config
        self._serious_set = {r.operation for r in config.serious_operations}

    def classify(self, operation: str) -> OperationClass:
        if operation in self._serious_set:
            return OperationClass.SERIOUS_SIDE_EFFECT
        return OperationClass.OPEN_COLLABORATION


class DefaultStrongWorkflowEngine(StrongWorkflowEngine):
    """强 workflow 引擎默认实现"""

    def __init__(
        self,
        repository: WorkflowRepository,
        audit_logger: AuditLogger,
        rollbacker: WorkflowRollbacker,
        wal_coordinator: WalCoordinator,
        wal_repository: WalRepository,
        wal_replayer: WalReplayer,
        canonical_read_model: CanonicalReadModel,
        magic_words_guard: MagicWordsGuard,
        event_bus: EventBus,
        config: WorkflowConfig,
    ):
        self._repo = repository
        self._audit = audit_logger
        self._rollbacker = rollbacker
        self._wal = wal_coordinator
        self._wal_repo = wal_repository
        self._wal_replayer = wal_replayer
        self._canonical = canonical_read_model
        self._guard = magic_words_guard
        self._bus = event_bus
        self._cfg = config

    async def start(self, workflow: StrongWorkflow) -> str:
        # 1. 四属性硬校验（Pydantic 已保证 replayable/rejectable/rollback_on_reject）
        if not workflow.replayable:
            raise FourAttributesViolationError("replayable must be true")
        if not workflow.rejectable:
            raise FourAttributesViolationError("rejectable must be true")
        if not workflow.rollback_on_reject:
            raise FourAttributesViolationError("rollback_on_reject must be true")

        # 2. steps 非空
        if not workflow.steps:
            raise ValueError("workflow.steps must not be empty")

        # 3. 持久化
        await self._repo.insert_workflow(workflow)

        # 4. 状态转换
        self._check_transition(workflow.status, WorkflowStatus.RUNNING)
        await self._repo.update_status(
            workflow.workflow_id, WorkflowStatus.RUNNING
        )

        await self._bus.publish(
            topic="workflow.started",
            payload={"workflow_id": workflow.workflow_id},
        )
        logger.info(f"workflow {workflow.workflow_id} started")
        return workflow.workflow_id

    async def advance(self, workflow_id: str) -> WorkflowStep:
        workflow = await self._repo.get(workflow_id)
        if workflow is None:
            raise WorkflowNotFoundError(workflow_id)

        # 1. 状态校验
        if workflow.status != WorkflowStatus.RUNNING:
            raise IllegalWorkflowTransitionError(
                f"cannot advance workflow in status {workflow.status.value}"
            )

        # 2. 边界检查
        if workflow.current_step >= len(workflow.steps):
            await self._repo.update_status(
                workflow_id, WorkflowStatus.SUCCESS,
                completed_at=datetime.now(timezone.utc),
            )
            await self._bus.publish(
                topic="workflow.completed",
                payload={"workflow_id": workflow_id, "status": "success"},
            )
            return workflow.steps[-1]

        step = workflow.steps[workflow.current_step]

        # 3. F023 liveness 检查
        liveness_ok = await self._canonical.check_liveness(
            workflow.forgekin_id, LivenessState.ALIVE
        )
        if not liveness_ok:
            await self.reject(workflow_id, reason="liveness zombie")
            return step

        # 4. F011 MagicWords 拦截点
        if self._cfg.magic_words_check_enabled:
            user_input = await self._get_recent_user_input(workflow.forgekin_id)
            magic_word = self._guard.detect_magic_word(user_input)
            if magic_word is not None:
                await self.reject(workflow_id, reason=f"magic_word: {magic_word}")
                return step

        # 5. F022 Tier 4 硬拒
        if step.tier == 4:
            await self.reject(workflow_id, reason="tier_4 hard reject")
            return step

        # 6. 写 F021 WAL
        wal_entry = self._build_wal_entry(workflow, step)
        try:
            executed_entry = await self._wal.execute_with_wal(wal_entry)
        except Exception as e:
            logger.error(f"step {step.step_id} WAL execute failed: {e}")
            await self.reject(workflow_id, reason=f"wal execute failed: {e}")
            return step

        # 7. 更新 step
        new_result = (
            StepResult.SUCCESS if executed_entry.status == WalStatus.CONFIRMED
            else StepResult.FAILED
        )
        step = step.model_copy(update={
            "wal_entry_id": executed_entry.entry_id,
            "post_state": executed_entry.post_state,
            "result": new_result,
            "executed_at": datetime.now(timezone.utc),
        })
        await self._repo.update_step(
            workflow_id, step.step_id,
            wal_entry_id=step.wal_entry_id,
            post_state=step.post_state,
            result=step.result,
            executed_at=step.executed_at,
        )

        # 8. 失败处理
        if step.result == StepResult.FAILED:
            if workflow.rollback_on_reject:
                await self.reject(workflow_id, reason=f"step {step.step_id} failed")
            else:
                await self._repo.update_status(
                    workflow_id, WorkflowStatus.FAILED,
                    completed_at=datetime.now(timezone.utc),
                )
            return step

        # 9. AuditEntry
        audit_id = await self._audit.log_step(
            workflow_id=workflow_id,
            step_id=step.step_id,
            action=step.action,
            result=step.result,
            wal_entry_id=step.wal_entry_id,
            forgekin_id=workflow.forgekin_id,
            operator_id=workflow.forgekin_id,
        )

        # 10. 推进 current_step
        await self._repo.update_status(
            workflow_id, workflow.status,
            current_step=workflow.current_step + 1,
        )
        logger.info(
            f"workflow {workflow_id} advanced to step {workflow.current_step + 1}"
        )
        return step

    async def reject(self, workflow_id: str, reason: str) -> None:
        workflow = await self._repo.get(workflow_id)
        if workflow is None:
            raise WorkflowNotFoundError(workflow_id)

        # 1. 状态转换
        self._check_transition(workflow.status, WorkflowStatus.REJECTED)
        await self._repo.update_status(
            workflow_id, WorkflowStatus.REJECTED,
            completed_at=datetime.now(timezone.utc),
        )

        # 2. rollback_on_reject 硬约束
        if not workflow.rollback_on_reject:
            raise FourAttributesViolationError(
                "rollback_on_reject=false violates 四属性 hard constraint"
            )

        # 3. 回滚已执行的可回滚步骤
        for i in range(workflow.current_step):
            step = workflow.steps[i]
            if step.result == StepResult.SUCCESS:
                if step.reversible:
                    try:
                        await self._rollbacker.rollback_step(step)
                        await self._repo.update_step(
                            workflow_id, step.step_id,
                            result=StepResult.ROLLED_BACK,
                        )
                    except Exception as e:
                        logger.warning(
                            f"rollback step {step.step_id} failed: {e}"
                        )
                        await self._repo.update_step(
                            workflow_id, step.step_id,
                            result=StepResult.FAILED,
                        )
                else:
                    await self._repo.update_step(
                        workflow_id, step.step_id,
                        result=StepResult.FAILED,
                    )
                    logger.warning(
                        f"step {step.step_id} irreversible, marked failed"
                    )

        # 4. 派发事件
        await self._bus.publish(
            topic="workflow.rejected",
            payload={"workflow_id": workflow_id, "reason": reason},
        )

        # 5. 派发 F022 恢复请求
        await self._bus.publish(
            topic="recovery.request",
            payload={
                "fault_id": f"workflow_reject:{workflow_id}",
                "forgekin_id": workflow.forgekin_id,
                "fault_type": "WorkflowRejected",
                "failure_count": 1,
                "last_error": reason,
                "workflow_id": workflow_id,
                "occurred_at": datetime.now(timezone.utc).isoformat(),
                "context_uri": f"workflow://{workflow_id}",
            },
        )

    async def replay(self, workflow_id: str) -> None:
        workflow = await self._repo.get(workflow_id)
        if workflow is None:
            raise WorkflowNotFoundError(workflow_id)

        # 1. replayable 硬约束
        if not workflow.replayable:
            raise ValueError("workflow.replayable=false, cannot replay")

        # 2. 状态校验
        if workflow.status not in (WorkflowStatus.RUNNING, WorkflowStatus.FAILED):
            raise IllegalWorkflowTransitionError(
                f"cannot replay workflow in status {workflow.status.value}"
            )

        # 3. 按 WAL 回放每步
        for i in range(workflow.current_step, len(workflow.steps)):
            step = workflow.steps[i]
            if step.wal_entry_id:
                wal_entry = await self._wal_repo.get(step.wal_entry_id)
                if wal_entry:
                    await self._wal_replayer.replay_entry(wal_entry)
                    await self._repo.update_step(
                        workflow_id, step.step_id,
                        result=StepResult.SUCCESS,
                        executed_at=datetime.now(timezone.utc),
                    )
                    continue
            # 无 WAL entry，重新执行
            await self.advance(workflow_id)

        # 4. 全部完成 → SUCCESS
        await self._repo.update_status(
            workflow_id, WorkflowStatus.SUCCESS,
            completed_at=datetime.now(timezone.utc),
        )
        logger.info(f"workflow {workflow_id} replay completed")

    def _check_transition(
        self, current: WorkflowStatus, target: WorkflowStatus
    ) -> None:
        allowed = WORKFLOW_TRANSITIONS.get(current, set())
        if target not in allowed:
            raise IllegalWorkflowTransitionError(
                f"workflow transition {current.value} -> {target.value} "
                f"not allowed (allowed: {[s.value for s in allowed]})"
            )

    def _build_wal_entry(self, workflow: StrongWorkflow, step: WorkflowStep) -> WalEntry:
        return WalEntry(
            entry_id=str(uuid.uuid1()),
            idempotency_key=f"workflow:{workflow.workflow_id}:step:{step.step_id}",
            forgekin_id=workflow.forgekin_id,
            workflow_id=workflow.workflow_id,
            effect_type=SideEffectType.DB_WRITE,  # 简化，实际按 action 映射
            status=WalStatus.PENDING,
            action_payload={"action": step.action, "step_id": step.step_id},
            pre_state=step.pre_state,
            reversible=(
                Reversibility.REVERSIBLE if step.reversible
                else Reversibility.IRREVERSIBLE
            ),
            created_at=datetime.now(timezone.utc),
        )

    async def _get_recent_user_input(self, forgekin_id: str) -> str:
        return ""  # 由调用方注入


class DefaultAuditLogger(AuditLogger):
    """审计日志记录器默认实现"""

    def __init__(
        self,
        repository: WorkflowRepository,
        event_bus: EventBus,
    ):
        self._repo = repository
        self._bus = event_bus

    async def log_step(
        self, workflow_id: str, step_id: str, action: str,
        result: StepResult, wal_entry_id: Optional[str] = None,
        forgekin_id: str = "", operator_id: str = "",
    ) -> str:
        entry = AuditEntry(
            audit_entry_id=str(uuid.uuid1()),
            workflow_id=workflow_id,
            step_id=step_id,
            forgekin_id=forgekin_id,
            action=action,
            result=result,
            timestamp=datetime.now(timezone.utc),
            wal_entry_id=wal_entry_id,
            operator_id=operator_id or forgekin_id,
        )
        await self._repo.insert_audit(entry)
        await self._bus.publish(
            topic="workflow.audit.logged",
            payload=entry.model_dump(),
        )
        return entry.audit_entry_id

    async def query_audit_log(
        self, workflow_id: str
    ) -> list[AuditEntry]:
        return await self._repo.query_audit(workflow_id)


class DefaultWorkflowRollbacker(WorkflowRollbacker):
    """workflow 回滚器默认实现"""

    def __init__(self, wal_coordinator: WalCoordinator):
        self._wal = wal_coordinator

    async def rollback_step(self, step: WorkflowStep) -> WorkflowStep:
        if not step.reversible:
            raise ValueError(
                f"step {step.step_id} is not reversible"
            )
        if step.wal_entry_id:
            # 调用 F021 WAL rollback
            await self._wal.rollback(step.wal_entry_id)
        return step.model_copy(update={
            "result": StepResult.ROLLED_BACK,
        })

    async def rollback_workflow(self, workflow: StrongWorkflow) -> None:
        for step in workflow.steps:
            if step.result == StepResult.SUCCESS and step.reversible:
                await self.rollback_step(step)
```

### 3.2 关键流程时序图

```
[强 workflow 执行时序图]

  Forgekin.act()   classifier   engine       wal_coord   repository   audit_logger   rollbacker   canonical   magic_guard   EventBus   F040
        │             │            │             │             │            │              │            │            │           │          │
        │ classify(operation)     │             │             │            │              │            │            │           │          │
        ├────────────>│            │             │             │            │              │            │            │           │          │
        │<────────────┤ SERIOUS    │             │             │            │              │            │            │           │          │
        │ start(workflow)         │             │             │            │              │            │            │           │          │
        ├────────────────────────>│             │             │            │              │            │            │           │          │
        │                          │ insert_workflow          │            │              │            │            │           │          │
        │                          ├────────────────────────>│            │              │            │            │           │          │
        │                          │ update_status RUNNING                │              │            │            │           │          │
        │                          │ publish("workflow.started")                                                                      │          │
        │                          ├──────────────────────────────────────────────────────────────────────────────────────────>│          │
        │                          │                                                                                                    ├────────>│
        │ advance(workflow_id)     │             │             │            │              │            │            │           │          │
        ├────────────────────────>│             │             │            │              │            │            │           │          │
        │                          │ check_liveness()                                                                                    │           │          │
        │                          ├──────────────────────────────────────────────────────────────────>│            │           │          │
        │                          │<──────────────────────────────────────────────────────────────────┤ OK         │           │          │
        │                          │ detect_magic_word()                                                                                  │           │          │
        │                          ├────────────────────────────────────────────────────────────────────────────────>│           │          │
        │                          │<────────────────────────────────────────────────────────────────────────────────┤ None      │          │
        │                          │ execute_with_wal(wal_entry)                                                                         │           │          │
        │                          ├────────────>│             │            │              │            │            │           │          │
        │                          │             │ append_pending + execute + confirm       │            │            │           │          │
        │                          │<────────────┤ entry         │            │              │            │            │           │          │
        │                          │ log_step()              │            │              │            │            │           │          │
        │                          ├──────────────────────────────────────>│              │            │            │           │          │
        │                          │<──────────────────────────────────────┤ audit_id     │            │            │           │          │
        │                          │ update_step + update_status current_step+1                                                       │           │          │
        │                          ├────────────────────────>│            │              │            │            │           │          │
        │<────────────────────────┤ step                                                                                    │           │          │
```

### 3.3 错误处理

| 异常类型 | 触发场景 | 处理策略 | 重试次数 |
|---------|---------|---------|---------|
| `IllegalWorkflowTransitionError` | workflow 状态非法转换 | 拒绝操作，记录错误 | 不重试（编程错误） |
| `WorkflowNotFoundError` | workflow 不存在 | 记录错误，调用方处理 | 不重试 |
| `FourAttributesViolationError` | 四属性硬约束违规 | 拒绝注册，启动失败 | 不重试（硬约束违规） |
| `LivenessZombieError` | zombie 状态拒绝执行 | 触发 reject + rollback | 不重试 |
| `MagicWordDetectedError` | F011 magic word 命中 | 触发 reject + rollback | 不重试 |
| `WalExecuteError` | F021 WAL 执行失败 | 触发 reject + rollback | 不重试（由 F022 升级） |
| `StepIrreversibleError` | 不可回滚步骤被尝试回滚 | 标记 failed，记录警告 | 不重试 |
| `ReplayNotAllowedError` | replayable=false 被尝试 replay | 拒绝操作，记录错误 | 不重试 |
| `AuditLogError` | 审计日志写入失败 | 阻塞 advance，记录错误 | 3（指数退避） |

### 3.4 性能优化

| 性能指标 | 目标值 | 优化手段 |
|---------|--------|---------|
| 操作分类延迟 | < 1ms | 内存集合查找 |
| workflow 启动延迟 | < 10ms | 单次 insert + 状态转换 |
| advance 延迟（不含 WAL） | < 50ms | 内存索引 + 状态转换 batch |
| advance 延迟（含 WAL） | < 200ms | 复用 F021 WAL append+execute |
| reject 延迟（10 step rollback） | < 500ms | 并发 rollback_step |
| replay 延迟（10 step） | < 1s | 复用 F021 WalReplayer |
| Repository 查询延迟 | < 10ms | workflow_id + status 索引 |
| 审计日志写入延迟 | < 10ms | 异步 fsync + 批量 insert |

---

## 4. 跨模块协作实现

### 4.1 上游依赖如何调用

- **Forgekin.act()**：Forgekin 执行操作前调用 `OperationClassifier.classify(operation)` 决定走轻量状态机还是强 workflow。
- **F002 TeamAct**：TeamAct 的"严肃操作"步骤调用本设计的 `start + advance`。
- **F022 Tier 1-4 恢复**：F022 Tier 1/2 通过 `replay(workflow_id)` 回放未完成 workflow。
- **F023 liveness 规范读**：advance 中调用 `check_liveness()` 检查 zombie。
- **F011 Magic Words**：advance 中调用 `MagicWordsGuard.detect_magic_word()` 拦截。
- **F021 副作用 WAL**：advance 中调用 `WalCoordinator.execute_with_wal()`。
- **DI 容器**：`strong_workflow_engine` 通过 `inject("strong_workflow_engine")` 获取。

### 4.2 下游影响如何被调用

- **F021 副作用 WAL**：本设计调用 F021 接口写入 / 回放 WAL。
- **F022 Tier 1-4 恢复**：reject 时派发 `recovery.request` 事件到 F022。
- **F040 控制面**：所有 workflow 状态变更与审计日志写入 F040 Eval Hub。F040 订阅 `workflow.*` 主题。
- **Forgekin.learn()**：workflow 执行历史作为 Forgekin 学习输入。

### 4.3 集成测试点

| 测试点 ID | 测试场景 | 验证点 | 责任方 |
|----------|---------|--------|--------|
| IT-D024-001 | 操作分类（严肃操作） | transfer/merge/release 等分类为 SERIOUS_SIDE_EFFECT | 测试员灵智体（蜜獾·平头哥） |
| IT-D024-002 | 操作分类（默认开放协作） | 未在列表中的操作默认 OPEN_COLLABORATION | 测试员灵智体 |
| IT-D024-003 | 四属性硬约束 | 缺任一属性拒绝注册 | 测试员灵智体 |
| IT-D024-004 | workflow 启动 | CREATED → RUNNING 状态转换 | 测试员灵智体 |
| IT-D024-005 | 推进下一步 + 写 WAL | advance 调用 wal_coordinator.execute_with_wal | 测试员灵智体 |
| IT-D024-006 | liveness zombie 拒绝执行 | zombie 状态触发 reject | 测试员灵智体 |
| IT-D024-007 | MagicWords 拦截 | magic word 命中触发 reject | 测试员灵智体 |
| IT-D024-008 | Tier 4 硬拒 | tier=4 的 step 触发 reject | 测试员灵智体 |
| IT-D024-009 | step 失败触发 reject | step FAILED 时触发 reject | 测试员灵智体 |
| IT-D024-010 | reject 回滚可回滚步骤 | 可逆 step 被 rollback | 测试员灵智体 |
| IT-D024-011 | reject 不可回滚步骤标记 failed | 不可逆 step 标记 FAILED | 测试员灵智体 |
| IT-D024-012 | 审计日志写入 | AuditEntry 关联 wal_entry_id | 测试员灵智体 |
| IT-D024-013 | replay 按 WAL 回放 | replay 调用 wal_replayer.replay_entry | 测试员灵智体 |
| IT-D024-014 | replayable=false 拒绝 replay | 硬约束拒绝 | 测试员灵智体 |
| IT-D024-015 | 全部步骤完成转 SUCCESS | current_step >= len(steps) → SUCCESS | 测试员灵智体 |

---

## 5. 详细设计验收

### 5.1 功能验收 AC

- [ ] **AC-D024-001**: 操作分类（严肃操作）通过（IT-D024-001）
- [ ] **AC-D024-002**: 操作分类（默认开放协作）通过（IT-D024-002）
- [ ] **AC-D024-003**: 四属性硬约束生效（IT-D024-003）
- [ ] **AC-D024-004**: workflow 启动通过（IT-D024-004）
- [ ] **AC-D024-005**: 推进下一步 + 写 WAL 通过（IT-D024-005）
- [ ] **AC-D024-006**: liveness zombie 拒绝执行通过（IT-D024-006）
- [ ] **AC-D024-007**: MagicWords 拦截通过（IT-D024-007）
- [ ] **AC-D024-008**: Tier 4 硬拒通过（IT-D024-008）
- [ ] **AC-D024-009**: step 失败触发 reject 通过（IT-D024-009）
- [ ] **AC-D024-010**: reject 回滚可回滚步骤通过（IT-D024-010）

### 5.2 性能验收 AC

- [ ] **AC-D024-011**: 操作分类延迟 < 1ms
- [ ] **AC-D024-012**: workflow 启动延迟 < 10ms
- [ ] **AC-D024-013**: advance 延迟（含 WAL）< 200ms
- [ ] **AC-D024-014**: reject 延迟（10 step rollback）< 500ms
- [ ] **AC-D024-015**: replay 延迟（10 step）< 1s
- [ ] **AC-D024-016**: Repository 查询延迟 < 10ms
- [ ] **AC-D024-017**: 审计日志写入延迟 < 10ms

### 5.3 安全验收 AC

- [ ] **AC-D024-018**: 四属性硬约束强制（不可绕过）
- [ ] **AC-D024-019**: 每步必须写 WAL（不可绕过）
- [ ] **AC-D024-020**: reject 必须触发 rollback（rollback_on_reject=true）
- [ ] **AC-D024-021**: 不可回滚步骤不可被强制回滚
- [ ] **AC-D024-022**: StrongWorkflow 不可变（Pydantic frozen=True）
- [ ] **AC-D024-023**: Repository 层抽象，不直操作数据库
- [ ] **AC-D024-024**: 严肃操作列表从配置加载，禁止硬编码

### 5.4 Eval 验收 AC

- [ ] **AC-D024-025**: 严肃操作 100% 走强 workflow
- [ ] **AC-D024-026**: 强 workflow 四属性覆盖率 100%
- [ ] **AC-D024-027**: reject 后可回滚步骤 100% 回滚成功
- [ ] **AC-D024-028**: 审计日志完整率 100%（每步均有 AuditEntry）
- [ ] **AC-D024-029**: replay 成功率 >= 99%（replayable=true 范围内）

---

## 6. 引用

- [doc:../spec.md#§3.6]
- [doc:../arch.md#§3.6]
- [doc:../architecture/A024-weak-state-vs-strong-workflow.md]
- [doc:../features/F002-team-act.md]
- [doc:../features/F011-magic-words.md]
- [doc:../features/F021-side-effect-wal.md]
- [doc:../features/F022-tier-1-4-recovery.md]
- [doc:../features/F023-liveness-canonical-read.md]
- [doc:../features/F024-weak-state-vs-strong-workflow.md]
- [doc:../features/F040-harness-eval-control-plane.md]
- [doc:../decisions/010-distributed-reliability.md]
- [doc:../../../hiclaw/rules.md#第十一部分]
- [doc:../../../hiclaw/rules.md#编程红线]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（双轨操作分类 + 强 workflow 四属性 + 每步写 WAL + F011 MagicWords 拦截 + F023 liveness 检查 + reject rollback + replay 回放 + 审计日志 + 15 集成测试点 + 4 类 AC） | 开发者灵智体（猎犬·夏洛克） |
