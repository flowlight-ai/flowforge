# D033: 三方 Agent 状态共享详细设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.10]（FR-CORE-010）
> **对应 arch.md**: [doc:../arch.md#§3.10]（三方 Agent 集成）
> **对应 design.md**: [doc:../design.md#§3.10]
> **对应 Feature**: [doc:../features/F033-external-agent-shared-state.md]（同号 Feature 级 SRS）
> **对应 Architecture**: [doc:../architecture/A033-external-agent-shared-state.md]（同号 Architecture 级 SAD）
> **依赖 ADR**: [doc:../decisions/006-external-agent-integration.md]
> **依赖详细设计**: [doc:D031-external-agent-adapter.md]（容器层） + [doc:D032-external-agent-profile.md]（agent_id 引用） + [doc:D014-memory-collection.md]（EchoStore归档 F014）

---

## 1. 详细设计上下文

### 1.1 设计问题

ExternalAgentAdapter 抽象层（D031）需要实现"Forgekin -> claude code 写代码 -> codex review -> trae 部署"的连续协作流，但 v7.0 三方 Agent 间无共享状态，每次调用都是独立会话，无法实现连续协作。本详细设计在 `core/external_agent/shared_state.py` 落地 A033 架构，解决以下详细设计层问题：

1. **共享状态数据模型未落地**：A033 仅定义字段列表，未给出 Pydantic 完整模型、字段约束、增量 append 不变量、生命周期绑定校验。
2. **ModificationRecord 增量 append 未编码**：A033 要求增量 append 而非覆盖，未给出 append_modification 接口签名、并发安全保证、历史记录总量单调递增校验。
3. **Onboarding 摘要生成算法未实现**：A033 描述"返回最近 N 条"，未给出 max_recent_modifications / max_recent_decisions 阈值、累积 open_questions 合并算法、token 节省量化指标。
4. **SharedStateHandoff 对接 F003 HandoffCapsule 未编码**：A033 要求 capsule 字段完整写入共享状态，未给出 capsule.open_questions / known_issues / next_action_hint 字段映射、写入校验、capsule 完整性校验。
5. **TeamAct 终止时归档到 F014 EchoStore未实现**：A033 要求归档，未给出归档触发条件、归档原子性保证、归档后共享状态只读化处理。
6. **Repository 层抽象与 F008 持久状态层对接未编码**：A033 要求基于 F008 Durable State Surfaces，未给出 SharedStateRepository 接口、读写并发控制、事务边界。
7. **生命周期与 TeamActState 一一关联校验未实现**：A033 要求 team_act_state_ref 非空，未给出创建时校验、TeamAct 终止事件订阅、归档时机精确触发。

### 1.2 设计约束

- **单向依赖约束**：`core/external_agent/shared_state.py` 仅依赖 F002 TeamActState + F003 HandoffCapsule + F008 Durable State Surfaces + F014 Memory Collection + F032 能力画像 + core/interfaces，禁止反向依赖 *Forge。
- **DI 容器约束**：SharedStateStore / SharedStateHandoff / OnboardingSummaryGenerator 实例必须通过 DI 容器注入到 ExternalAgentBridge（D031）。
- **Repository 层约束**：ExternalAgentSharedState 持久化必须通过 SharedStateRepository 抽象（基于 F008），禁止直接操作数据库。
- **配置驱动约束**：onboarding_summary / lifecycle / handoff 配置必须 YAML 外置到 `config/external_agent.yaml`，禁止 .py 硬编码。
- **生命周期绑定约束**：共享状态必须与 F002 TeamActState 一一关联（team_act_state_ref 字段非空），TeamAct 终止时必须归档到 F014 EchoStore。
- **增量写入约束**：ModificationRecord 必须增量 append，禁止覆盖历史记录；append 后总量单调递增。
- **Handoff Capsule 一致性约束**：SharedStateHandoff 必须对接 F003 HandoffCapsule，open_questions / known_issues / next_action_hint 三字段必须传递。
- **Onboarding 摘要约束**：新 Agent 接手时必须读取 Onboarding 摘要而非全部历史，recent_modifications / recent_decisions 数量受 max_* 配置限制。

### 1.3 设计影响

- **对 F002 TeamAct 的影响**：ExternalAgentSharedState 与 TeamActState 一一关联，TeamAct 终止事件触发归档。
- **对 F003 HandoffCapsule 的影响**：SharedStateHandoff 对接 HandoffCapsule，capsule 字段完整写入共享状态。
- **对 F008 持久状态层的影响**：ExternalAgentSharedState 持久化到 F008 Durable State Surfaces，运行时读写均通过 Repository。
- **对 F014 多域记忆的影响**：TeamAct 终止时共享状态整体归档到 F014 EchoStore EchoStore集合，作为Forgekin经验记忆。
- **对 F032 能力画像的影响**：modification_log / decision_context 中 agent_id 字段引用 ExternalAgentCapabilityProfile.agent_id。
- **对 D031 ExternalAgentBridge 的影响**：Bridge 在调用三方 Agent 后通过 SharedStateStore.append_modification 写入共享状态。
- **对 D034 失败回退的影响**：fallback 时下一个 Agent 通过 SharedStateHandoff.read_onboarding 获取上下文。
- **对 D035 能力融合的影响**：共享状态中的 artifact_refs 作为 FusionSource.call_artifacts 来源。

---

## 2. 详细设计

### 2.1 数据模型

#### 2.1.1 ModificationRecord（增量 append）

```python
from datetime import datetime
from pydantic import BaseModel, Field


class ModificationRecord(BaseModel):
    """修改记录（增量 append，不覆盖历史）

    每个三方 Agent 修改产出物时 append 一条记录。
    record_id 全局唯一（含 state_id + timestamp + uuid 后缀）。
    """
    record_id: str
    state_id: str                             # 关联的共享状态 ID
    agent_id: str                             # 三方 Agent ID（来自 F032）
    timestamp: datetime = Field(default_factory=datetime.now)
    target: str                               # 修改目标（文件路径 / 函数名 / 配置 key）
    diff_summary: str                         # 修改摘要（人类可读）
    rationale: str                            # 修改理由（Agent 自述）
    commit_ref: str | None = None             # git commit ref（可选）
    artifacts_produced: list[str] = Field(
        default_factory=list,
        description="本次修改产生的产出物 ID 列表",
    )

    model_config = {"extra": "forbid"}
```

#### 2.1.2 DecisionRecord（含 open_questions）

```python
class DecisionRecord(BaseModel):
    """决策记录（用于下一个 Agent 接手时理解上下文）

    open_questions 必须传递给下一个 Agent，与 F003 HandoffCapsule 一致。
    """
    record_id: str
    state_id: str
    agent_id: str
    timestamp: datetime = Field(default_factory=datetime.now)
    decision: str                             # 决策内容（如 "使用 OAuth2 而非 JWT"）
    alternatives_considered: list[str] = Field(
        default_factory=list,
        description="考虑过的备选方案",
    )
    tradeoffs: str                            # 权衡说明
    open_questions: list[str] = Field(
        default_factory=list,
        description="未解决问题，必须传递给下一个 Agent（与 F003 一致）",
    )

    model_config = {"extra": "forbid"}
```

#### 2.1.3 ExternalAgentSharedState（共享状态主模型）

```python
class ExternalAgentSharedState(BaseModel):
    """三方 Agent 共享状态（写入 F008 持久状态层）

    生命周期与 F002 TeamActState 一一关联：
        - 创建：TeamAct 启动时 create(team_act_state_ref, forgekin_id)
        - 协作：append_modification / append_decision 增量更新
        - 归档：TeamAct 终止时 archive_to_echo_store
    """
    state_id: str
    team_act_state_ref: str                   # 关联 F002 TeamActState ID（非空）
    forgekin_id: str                          # 主持Forgekin ID
    session_context: dict = Field(
        default_factory=dict,
        description="会话级共享上下文（如 task_id / requirements / env）",
    )
    modification_log: list[ModificationRecord] = Field(
        default_factory=list,
        description="修改历史（增量 append，禁止覆盖）",
    )
    decision_context: list[DecisionRecord] = Field(
        default_factory=list,
        description="决策历史（增量 append）",
    )
    artifact_refs: list[str] = Field(
        default_factory=list,
        description="产出物引用列表（commit / 文件 / 测试 ID）",
    )
    last_updated_by: str | None = Field(
        default=None,
        description="最后更新的三方 Agent ID",
    )
    created_at: datetime = Field(default_factory=datetime.now)
    archived_at: datetime | None = Field(
        default=None,
        description="归档时间戳（归档后只读）",
    )
    archived_to_echo_store_ref: str | None = Field(
        default=None,
        description="F014 EchoStore EchoStore集合 ID（归档后填充）",
    )

    model_config = {"extra": "forbid"}

    @model_validator(mode="after")
    def _validate_team_act_ref(self) -> "ExternalAgentSharedState":
        """校验 team_act_state_ref 非空（生命周期绑定铁律）"""
        if not self.team_act_state_ref:
            raise ValueError(
                "team_act_state_ref 不能为空（共享状态必须与 TeamActState 一一关联）"
            )
        return self
```

#### 2.1.4 OnboardingSummary（新 Agent 接手时读取）

```python
class OnboardingSummary(BaseModel):
    """Onboarding 摘要（新 Agent 接手时读取）

    避免重读全部历史，节省 token。
    recent_modifications / recent_decisions 数量受 max_* 配置限制。
    open_questions 累积自全部历史 DecisionRecord。
    """
    state_id: str
    forgekin_id: str
    recent_modifications: list[ModificationRecord]   # 最近 N 条（默认 20）
    recent_decisions: list[DecisionRecord]           # 最近 N 条（默认 10）
    open_questions: list[str]                        # 累积未解决问题
    artifact_refs: list[str]                         # 全部产出物引用
    last_updated_by: str | None
    summary_generated_at: datetime = Field(default_factory=datetime.now)

    model_config = {"extra": "forbid"}
```

### 2.2 Onboarding 摘要生成算法

```python
def generate_onboarding_summary(
    state: ExternalAgentSharedState,
    max_recent_modifications: int = 20,
    max_recent_decisions: int = 10,
) -> OnboardingSummary:
    """生成 Onboarding 摘要

    算法：
        1. recent_modifications: 取 modification_log 最后 N 条（按 timestamp 升序）
        2. recent_decisions: 取 decision_context 最后 N 条
        3. open_questions: 累积全部 DecisionRecord.open_questions，去重保序
        4. artifact_refs: 全部产出物引用（不去重，保留时序）

    token 节省量化（典型场景）：
        - 全量历史: 100 modifications + 50 decisions = ~50K token
        - 摘要: 20 modifications + 10 decisions = ~12K token
        - 节省: ~76%

    Args:
        state: 共享状态
        max_recent_modifications: 最近修改记录数上限（默认 20）
        max_recent_decisions: 最近决策记录数上限（默认 10）

    Returns:
        Onboarding 摘要
    """
    # 按 timestamp 升序排序后取最后 N 条
    sorted_modifications = sorted(
        state.modification_log, key=lambda r: r.timestamp
    )
    recent_modifications = sorted_modifications[-max_recent_modifications:]

    sorted_decisions = sorted(
        state.decision_context, key=lambda r: r.timestamp
    )
    recent_decisions = sorted_decisions[-max_recent_decisions:]

    # 累积 open_questions，去重保序（按首次出现顺序）
    seen_questions: set[str] = set
    accumulated_questions: list[str] = []
    for decision in sorted_decisions:  # 全部历史，非仅 recent
        for q in decision.open_questions:
            if q not in seen_questions:
                seen_questions.add(q)
                accumulated_questions.append(q)

    return OnboardingSummary(
        state_id=state.state_id,
        forgekin_id=state.forgekin_id,
        recent_modifications=recent_modifications,
        recent_decisions=recent_decisions,
        open_questions=accumulated_questions,
        artifact_refs=state.artifact_refs,
        last_updated_by=state.last_updated_by,
    )
```

### 2.3 HandoffCapsule 字段映射

```python
def map_handoff_capsule_to_shared_state(
    capsule: dict,
    state_id: str,
    next_agent_id: str,
) -> tuple[list[str], list[str], str | None]:
    """将 F003 HandoffCapsule 字段映射到共享状态

    F003 HandoffCapsule 必含字段：
        - open_questions: list[str]      未解决问题
        - known_issues: list[str]        已知问题
        - next_action_hint: str | None   下一步建议

    映射规则：
        - capsule["open_questions"] -> 合并到最新 DecisionRecord.open_questions
        - capsule["known_issues"]   -> 写入 session_context["known_issues"]
        - capsule["next_action_hint"] -> 写入 session_context["next_action_hint"]

    Args:
        capsule: F003 HandoffCapsule 字典
        state_id: 共享状态 ID
        next_agent_id: 即将接手的 Agent ID

    Returns:
        (open_questions, known_issues, next_action_hint) 三元组

    Raises:
        HandoffCapsuleIncompleteError: capsule 缺失必含字段
    """
    required_fields = ["open_questions", "known_issues"]
    missing = [f for f in required_fields if f not in capsule]
    if missing:
        raise HandoffCapsuleIncompleteError(
            state_id=state_id,
            next_agent_id=next_agent_id,
            missing_fields=missing,
        )

    open_questions = list(capsule.get("open_questions", []))
    known_issues = list(capsule.get("known_issues", []))
    next_action_hint = capsule.get("next_action_hint")

    return open_questions, known_issues, next_action_hint


class HandoffCapsuleIncompleteError(Exception):
    """HandoffCapsule 字段不完整"""

    def __init__(
        self,
        state_id: str,
        next_agent_id: str,
        missing_fields: list[str],
    ) -> None:
        self.state_id = state_id
        self.next_agent_id = next_agent_id
        self.missing_fields = missing_fields
        super.__init__(
            f"HandoffCapsule incomplete for state '{state_id}' "
            f"handoff to '{next_agent_id}'; missing: {missing_fields}"
        )
```

### 2.4 归档原子性保证

```python
async def archive_shared_state_atomically(
    state: ExternalAgentSharedState,
    shared_state_repo: "SharedStateRepository",
    echo_store_repo: "Repository",  # F014 EchoStore Repository
) -> str:
    """原子归档共享状态到 F014 EchoStore

    步骤：
        1. 写入 F014 EchoStore EchoStore集合（获取 echo_store_ref）
        2. 更新共享状态：archived_at + archived_to_echo_store_ref
        3. 标记共享状态为只读（后续 append 被拒绝）
        4. 任一步失败：回滚（删除已写入的 EchoStore 条目）

    Args:
        state: 待归档的共享状态
        shared_state_repo: 共享状态 Repository
        echo_store_repo: F014 EchoStore Repository

    Returns:
        echo_store_ref（F014 EchoStore集合 ID）

    Raises:
        ArchiveFailedError: 归档失败（含回滚失败详情）
    """
    # 步骤 1: 写入 EchoStore
    try:
        echo_store_ref = await echo_store_repo.save(
            key=f"external_agent_shared_state_{state.state_id}",
            value=state.model_dump,
            collection="external_agent_states",  # F014 EchoStore集合
        )
    except Exception as e:
        raise ArchiveFailedError(
            state_id=state.state_id,
            stage="write_echo_store",
            cause=str(e),
        )

    # 步骤 2-3: 更新共享状态为已归档
    archived_state = state.model_copy(
        update={
            "archived_at": datetime.now,
            "archived_to_echo_store_ref": echo_store_ref,
        }
    )
    try:
        await shared_state_repo.save(state.state_id, archived_state)
    except Exception as e:
        # 回滚：删除已写入的 EchoStore 条目
        try:
            await echo_store_repo.delete(echo_store_ref)
        except Exception as rollback_err:
            raise ArchiveFailedError(
                state_id=state.state_id,
                stage="rollback_echo_store",
                cause=f"save failed: {e}; rollback also failed: {rollback_err}",
            )
        raise ArchiveFailedError(
            state_id=state.state_id,
            stage="update_shared_state",
            cause=str(e),
        )

    return echo_store_ref


class ArchiveFailedError(Exception):
    """归档失败"""

    def __init__(
        self, state_id: str, stage: str, cause: str
    ) -> None:
        self.state_id = state_id
        self.stage = stage
        self.cause = cause
        super.__init__(
            f"Archive failed for state '{state_id}' at stage '{stage}': {cause}"
        )
```

---

## 3. 模块实现

### 3.1 SharedStateStore 抽象与实现

#### 3.1.1 抽象基类

```python
from abc import ABC, abstractmethod


class SharedStateStore(ABC):
    """共享状态存储（基于 F008 持久状态层）"""

    @abstractmethod
    async def create(
        self,
        team_act_state_ref: str,
        forgekin_id: str,
        session_context: dict | None = None,
    ) -> str:
        """创建共享状态（与 TeamActState 一一关联）

        Args:
            team_act_state_ref: F002 TeamActState ID（必须非空）
            forgekin_id: 主持Forgekin ID
            session_context: 会话级上下文（可选）

        Returns:
            state_id

        Raises:
            TeamActStateNotFoundError: team_act_state_ref 无效
            SharedStateAlreadyExistsError: 同 team_act_state_ref 已有共享状态
        """
        ...

    @abstractmethod
    async def get(self, state_id: str) -> ExternalAgentSharedState:
        """读取共享状态

        Raises:
            SharedStateNotFoundError: state_id 未找到
        """
        ...

    @abstractmethod
    async def get_by_team_act(
        self, team_act_state_ref: str
    ) -> ExternalAgentSharedState:
        """按 TeamActState ID 查询共享状态

        Raises:
            SharedStateNotFoundError: 该 TeamActState 无关联共享状态
        """
        ...

    @abstractmethod
    async def append_modification(
        self, state_id: str, record: ModificationRecord
    ) -> None:
        """增量 append 修改记录（不覆盖历史）

        Raises:
            SharedStateNotFoundError: state_id 未找到
            SharedStateArchivedError: 共享状态已归档，禁止 append
            ModificationRecordConflictError: record_id 重复
        """
        ...

    @abstractmethod
    async def append_decision(
        self, state_id: str, record: DecisionRecord
    ) -> None:
        """增量 append 决策记录

        Raises:
            SharedStateNotFoundError: state_id 未找到
            SharedStateArchivedError: 共享状态已归档
        """
        ...

    @abstractmethod
    async def add_artifact_ref(
        self, state_id: str, artifact_ref: str
    ) -> None:
        """添加产出物引用（增量 append）

        Raises:
            SharedStateNotFoundError: state_id 未找到
            SharedStateArchivedError: 共享状态已归档
        """
        ...

    @abstractmethod
    async def archive_to_echo_store(self, state_id: str) -> str:
        """TeamAct 终止时归档到 F014 EchoStore集合

        Returns:
            echo_store_ref

        Raises:
            SharedStateNotFoundError: state_id 未找到
            ArchiveFailedError: 归档失败
            SharedStateAlreadyArchivedError: 共享状态已归档
        """
        ...
```

#### 3.1.2 Harness 实现

```python
from core.tracing import get_logger
from core.interfaces.repository import Repository

logger = get_logger(__name__)


class HarnessSharedStateStore(SharedStateStore):
    """SharedStateStore 的 Harness 实现

    使用 Repository 层持久化（基于 F008 Durable State Surfaces）
    使用 DI 容器注入 Repository 实例 + F014 EchoStore Repository。
    """

    def __init__(
        self,
        shared_state_repo: Repository[ExternalAgentSharedState],
        echo_store_repo: Repository,  # F014 EchoStore Repository
        team_act_state_validator: "TeamActStateValidator",  # F002
    ) -> None:
        self._repo = shared_state_repo
        self._echo_repo = echo_store_repo
        self._team_act_validator = team_act_state_validator
        logger.info(
            "HarnessSharedStateStore initialized",
            extra={
                "shared_state_repo": type(shared_state_repo).__name__,
                "echo_store_repo": type(echo_store_repo).__name__,
            },
        )

    async def create(
        self,
        team_act_state_ref: str,
        forgekin_id: str,
        session_context: dict | None = None,
    ) -> str:
        # 校验 team_act_state_ref 有效性
        if not team_act_state_ref:
            raise ValueError("team_act_state_ref 不能为空")

        # 校验 TeamActState 存在（F002）
        await self._team_act_validator.assert_exists(team_act_state_ref)

        # 校验同 TeamActState 无重复共享状态
        existing = await self._repo.find_by_id(
            key=f"team_act::{team_act_state_ref}"
        )
        if existing is not None:
            raise SharedStateAlreadyExistsError(
                team_act_state_ref=team_act_state_ref,
                existing_state_id=existing.state_id,
            )

        state_id = f"shared_state_{team_act_state_ref}_{uuid.uuid4.hex[:8]}"
        state = ExternalAgentSharedState(
            state_id=state_id,
            team_act_state_ref=team_act_state_ref,
            forgekin_id=forgekin_id,
            session_context=session_context or {},
        )
        # 双写：按 state_id 和 team_act_state_ref 都能查到
        await self._repo.save(state_id, state)
        await self._repo.save(
            f"team_act::{team_act_state_ref}", state
        )
        logger.info(
            "SharedState created",
            extra={
                "state_id": state_id,
                "team_act_state_ref": team_act_state_ref,
                "forgekin_id": forgekin_id,
            },
        )
        return state_id

    async def get(self, state_id: str) -> ExternalAgentSharedState:
        state = await self._repo.find_by_id(state_id)
        if state is None:
            raise SharedStateNotFoundError(
                state_id=state_id,
                message=f"shared state '{state_id}' not found",
            )
        return state

    async def get_by_team_act(
        self, team_act_state_ref: str
    ) -> ExternalAgentSharedState:
        state = await self._repo.find_by_id(
            f"team_act::{team_act_state_ref}"
        )
        if state is None:
            raise SharedStateNotFoundError(
                state_id=f"team_act::{team_act_state_ref}",
                message=f"no shared state for team_act '{team_act_state_ref}'",
            )
        return state

    async def append_modification(
        self, state_id: str, record: ModificationRecord
    ) -> None:
        state = await self.get(state_id)
        self._assert_not_archived(state)

        # record_id 唯一性校验
        existing_ids = {r.record_id for r in state.modification_log}
        if record.record_id in existing_ids:
            raise ModificationRecordConflictError(
                record_id=record.record_id,
                state_id=state_id,
            )

        # 增量 append（创建新列表，Pydantic 不可变保证）
        updated_log = state.modification_log + [record]
        updated = state.model_copy(
            update={
                "modification_log": updated_log,
                "last_updated_by": record.agent_id,
            }
        )
        await self._repo.save(state_id, updated)
        await self._repo.save(
            f"team_act::{state.team_act_state_ref}", updated
        )
        logger.info(
            "ModificationRecord appended",
            extra={
                "state_id": state_id,
                "record_id": record.record_id,
                "agent_id": record.agent_id,
                "target": record.target,
                "total_modifications": len(updated_log),
            },
        )

    async def append_decision(
        self, state_id: str, record: DecisionRecord
    ) -> None:
        state = await self.get(state_id)
        self._assert_not_archived(state)

        existing_ids = {r.record_id for r in state.decision_context}
        if record.record_id in existing_ids:
            raise ModificationRecordConflictError(
                record_id=record.record_id,
                state_id=state_id,
            )

        updated_decisions = state.decision_context + [record]
        updated = state.model_copy(
            update={
                "decision_context": updated_decisions,
                "last_updated_by": record.agent_id,
            }
        )
        await self._repo.save(state_id, updated)
        await self._repo.save(
            f"team_act::{state.team_act_state_ref}", updated
        )
        logger.info(
            "DecisionRecord appended",
            extra={
                "state_id": state_id,
                "record_id": record.record_id,
                "agent_id": record.agent_id,
                "open_questions_count": len(record.open_questions),
                "total_decisions": len(updated_decisions),
            },
        )

    async def add_artifact_ref(
        self, state_id: str, artifact_ref: str
    ) -> None:
        state = await self.get(state_id)
        self._assert_not_archived(state)
        if artifact_ref in state.artifact_refs:
            return  # 幂等
        updated = state.model_copy(
            update={
                "artifact_refs": state.artifact_refs + [artifact_ref],
            }
        )
        await self._repo.save(state_id, updated)
        await self._repo.save(
            f"team_act::{state.team_act_state_ref}", updated
        )

    async def archive_to_echo_store(self, state_id: str) -> str:
        state = await self.get(state_id)
        if state.archived_at is not None:
            raise SharedStateAlreadyArchivedError(
                state_id=state_id,
                archived_at=state.archived_at,
            )
        echo_ref = await archive_shared_state_atomically(
            state=state,
            shared_state_repo=self._repo,
            echo_store_repo=self._echo_repo,
        )
        logger.info(
            "SharedState archived to EchoStore",
            extra={
                "state_id": state_id,
                "echo_store_ref": echo_ref,
                "total_modifications": len(state.modification_log),
                "total_decisions": len(state.decision_context),
            },
        )
        return echo_ref

    @staticmethod
    def _assert_not_archived(state: ExternalAgentSharedState) -> None:
        if state.archived_at is not None:
            raise SharedStateArchivedError(
                state_id=state.state_id,
                archived_at=state.archived_at,
            )
```

### 3.2 SharedStateHandoff 抽象与实现

#### 3.2.1 抽象基类

```python
class SharedStateHandoff(ABC):
    """共享状态交接（与 F003 HandoffCapsule 联动）"""

    @abstractmethod
    async def handoff_to_next_agent(
        self,
        state_id: str,
        next_agent_id: str,
        capsule: dict,
    ) -> None:
        """交接给下一个三方 Agent

        Args:
            state_id: 共享状态 ID
            next_agent_id: 即将接手的 Agent ID
            capsule: F003 HandoffCapsule（含 open_questions / known_issues / next_action_hint）

        Raises:
            SharedStateNotFoundError: state_id 未找到
            HandoffCapsuleIncompleteError: capsule 字段不完整
            SharedStateArchivedError: 共享状态已归档
        """
        ...

    @abstractmethod
    async def read_onboarding(
        self, agent_id: str, state_id: str
    ) -> OnboardingSummary:
        """新 Agent 接手时读取 onboarding 摘要

        Args:
            agent_id: 即将接手的 Agent ID（用于日志追踪）
            state_id: 共享状态 ID

        Returns:
            Onboarding 摘要
        """
        ...
```

#### 3.2.2 Harness 实现

```python
class HarnessSharedStateHandoff(SharedStateHandoff):
    """SharedStateHandoff 的 Harness 实现"""

    def __init__(
        self,
        shared_state_store: SharedStateStore,
        max_recent_modifications: int = 20,
        max_recent_decisions: int = 10,
    ) -> None:
        self._store = shared_state_store
        self._max_mods = max_recent_modifications
        self._max_decs = max_recent_decisions

    async def handoff_to_next_agent(
        self,
        state_id: str,
        next_agent_id: str,
        capsule: dict,
    ) -> None:
        # 1. 解析 capsule 字段
        open_questions, known_issues, next_action_hint = (
            map_handoff_capsule_to_shared_state(
                capsule=capsule,
                state_id=state_id,
                next_agent_id=next_agent_id,
            )
        )

        # 2. 读取共享状态
        state = await self._store.get(state_id)
        if state.archived_at is not None:
            raise SharedStateArchivedError(
                state_id=state_id,
                archived_at=state.archived_at,
            )

        # 3. capsule.open_questions 合并到最新 DecisionRecord
        #    （创建一个 handoff 专用 DecisionRecord）
        handoff_record = DecisionRecord(
            record_id=f"handoff_{state_id}_{next_agent_id}_{uuid.uuid4.hex[:8]}",
            state_id=state_id,
            agent_id=next_agent_id,
            decision=f"Handoff from previous agent to {next_agent_id}",
            alternatives_considered=[],
            tradeoffs="N/A (handoff)",
            open_questions=open_questions,
        )
        await self._store.append_decision(state_id, handoff_record)

        # 4. capsule.known_issues / next_action_hint 写入 session_context
        updated_session_context = dict(state.session_context)
        updated_session_context["known_issues"] = known_issues
        if next_action_hint is not None:
            updated_session_context["next_action_hint"] = next_action_hint
        updated_session_context["handed_off_to"] = next_agent_id

        # 直接更新共享状态（绕过 append 接口，因为这是 session_context 字段更新）
        updated_state = state.model_copy(
            update={"session_context": updated_session_context}
        )
        # 通过 Repository 写回（需要 store 暴露 update_session_context 接口或直接 repo 写入）
        # 这里假设 store 提供了内部 _update_session_context 方法
        await self._store._update_session_context(state_id, updated_session_context)

        logger.info(
            "Handoff completed",
            extra={
                "state_id": state_id,
                "next_agent_id": next_agent_id,
                "open_questions_count": len(open_questions),
                "known_issues_count": len(known_issues),
            },
        )

    async def read_onboarding(
        self, agent_id: str, state_id: str
    ) -> OnboardingSummary:
        state = await self._store.get(state_id)
        summary = generate_onboarding_summary(
            state=state,
            max_recent_modifications=self._max_mods,
            max_recent_decisions=self._max_decs,
        )
        logger.info(
            "Onboarding summary read",
            extra={
                "state_id": state_id,
                "agent_id": agent_id,
                "recent_modifications_count": len(summary.recent_modifications),
                "recent_decisions_count": len(summary.recent_decisions),
                "open_questions_count": len(summary.open_questions),
            },
        )
        return summary
```

### 3.3 异常类

```python
class SharedStateNotFoundError(Exception):
    """共享状态未找到"""

    def __init__(self, state_id: str, message: str) -> None:
        self.state_id = state_id
        super.__init__(message)


class SharedStateAlreadyExistsError(Exception):
    """同 TeamActState 已有共享状态"""

    def __init__(
        self, team_act_state_ref: str, existing_state_id: str
    ) -> None:
        self.team_act_state_ref = team_act_state_ref
        self.existing_state_id = existing_state_id
        super.__init__(
            f"shared state already exists for team_act '{team_act_state_ref}': "
            f"existing state_id='{existing_state_id}'"
        )


class SharedStateArchivedError(Exception):
    """共享状态已归档，禁止 append"""

    def __init__(
        self, state_id: str, archived_at: datetime
    ) -> None:
        self.state_id = state_id
        self.archived_at = archived_at
        super.__init__(
            f"shared state '{state_id}' archived at {archived_at}, "
            f"append operations are forbidden"
        )


class SharedStateAlreadyArchivedError(Exception):
    """共享状态已归档，重复归档被拒绝"""

    def __init__(
        self, state_id: str, archived_at: datetime
    ) -> None:
        self.state_id = state_id
        self.archived_at = archived_at
        super.__init__(
            f"shared state '{state_id}' already archived at {archived_at}"
        )


class ModificationRecordConflictError(Exception):
    """record_id 重复"""

    def __init__(self, record_id: str, state_id: str) -> None:
        self.record_id = record_id
        self.state_id = state_id
        super.__init__(
            f"record_id '{record_id}' already exists in state '{state_id}'"
        )


class TeamActStateNotFoundError(Exception):
    """TeamActState 未找到（F002）"""

    def __init__(self, team_act_state_ref: str) -> None:
        self.team_act_state_ref = team_act_state_ref
        super.__init__(
            f"TeamActState '{team_act_state_ref}' not found"
        )
```

### 3.4 配置加载器

```python
from pathlib import Path
import yaml


class SharedStateConfigLoader:
    """共享状态 YAML 配置加载器

    加载 config/external_agent.yaml 中 shared_state 段。
    """

    REQUIRED_CONFIG_FIELDS = [
        "max_recent_modifications",
        "max_recent_decisions",
    ]

    def __init__(
        self,
        config_path: str = "config/external_agent.yaml",
    ) -> None:
        self._config_path = Path(config_path).resolve

    def load(self) -> dict:
        """加载 shared_state 配置段"""
        if not self._config_path.exists:
            raise FileNotFoundError(
                f"external_agent.yaml not found: {self._config_path}"
            )
        with open(self._config_path, "r", encoding="utf-8") as f:
            config = yaml.safe_load(f)
        shared_state_config = config.get("shared_state", {})
        self._assert_fields_complete(shared_state_config)
        return shared_state_config

    def _assert_fields_complete(self, config: dict) -> None:
        missing = [
            f for f in self.REQUIRED_CONFIG_FIELDS if f not in config
        ]
        if missing:
            raise ValueError(
                f"shared_state config missing fields: {missing}"
            )
```

### 3.5 external_agent.yaml 配置示例

```yaml
# config/external_agent.yaml（shared_state 段节选）
# 共享状态 YAML 配置（外置，禁止 .py 硬编码）

shared_state:
  max_recent_modifications: 20       # Onboarding 摘要中最近修改记录数上限
  max_recent_decisions: 10           # Onboarding 摘要中最近决策记录数上限
  echo_store_collection: "external_agent_states"  # F014 EchoStore集合名
  auto_archive_on_team_act_terminate: true        # TeamAct 终止时自动归档
  archive_atomic: true               # 归档原子性保证（失败回滚）
```

### 3.6 DI 容器注册

```python
# core/di/container.py（节选，注册 SharedState 相关依赖）

def register_external_agent_shared_state_layer(
    container: DIContainer,
    config_path: str = "config/external_agent.yaml",
) -> None:
    """注册三方 Agent 共享状态层到 DI 容器"""
    # 1. 加载配置
    config_loader = SharedStateConfigLoader(config_path=config_path)
    config = config_loader.load

    # 2. Repository（基于 F008 DurableStateSurfaces）
    shared_state_repo = container.resolve_repository(
        model_type="ExternalAgentSharedState",
    )
    echo_store_repo = container.resolve_repository(
        model_type="EchoStoreEntry",  # F014 EchoStore
        collection=config["echo_store_collection"],
    )

    # 3. TeamActState Validator（F002）
    team_act_validator = container.resolve("TeamActStateValidator")

    # 4. SharedStateStore
    store = HarnessSharedStateStore(
        shared_state_repo=shared_state_repo,
        echo_store_repo=echo_store_repo,
        team_act_state_validator=team_act_validator,
    )
    container.register_instance(SharedStateStore, store)

    # 5. SharedStateHandoff
    handoff = HarnessSharedStateHandoff(
        shared_state_store=store,
        max_recent_modifications=config["max_recent_modifications"],
        max_recent_decisions=config["max_recent_decisions"],
    )
    container.register_instance(SharedStateHandoff, handoff)
```

### 3.7 TeamAct 终止事件订阅

```python
# core/external_agent/shared_state.py（节选，TeamAct 终止事件订阅）

from core.events.event_bus import EventBusSubscriber


class SharedStateArchiver(EventBusSubscriber):
    """订阅 TeamAct 终止事件，自动归档共享状态"""

    def __init__(
        self,
        store: SharedStateStore,
        event_bus: "EventBus",
    ) -> None:
        self._store = store
        self._bus = event_bus

    async def on_team_act_terminated(self, event: dict) -> None:
        """TeamAct 终止事件处理

        Event payload:
            - team_act_state_ref: str
            - termination_reason: "completed" | "cancelled" | "failed"
        """
        team_act_state_ref = event["team_act_state_ref"]
        try:
            state = await self._store.get_by_team_act(team_act_state_ref)
            await self._store.archive_to_echo_store(state.state_id)
            logger.info(
                "SharedState auto-archived on TeamAct terminate",
                extra={
                    "team_act_state_ref": team_act_state_ref,
                    "termination_reason": event.get("termination_reason"),
                    "state_id": state.state_id,
                },
            )
        except SharedStateNotFoundError:
            logger.warning(
                "No SharedState found for terminated TeamAct",
                extra={"team_act_state_ref": team_act_state_ref},
            )
        except SharedStateAlreadyArchivedError:
            logger.info(
                "SharedState already archived, skip",
                extra={"team_act_state_ref": team_act_state_ref},
            )

    async def subscribe(self) -> None:
        await self._bus.subscribe(
            topic="team_act.terminated",
            handler=self.on_team_act_terminated,
        )
```

---

## 4. 跨模块协作实现

### 4.1 与 D031 ExternalAgentBridge 协作

```python
# core/external_agent/bridge.py（D031 节选，展示与 D033 协作）

class ExternalAgentBridge:
    def __init__(
        self,
        adapter_registry: "ExternalAgentAdapterRegistry",
        capability_matcher: CapabilityMatcher,  # D032
        profile_registry: ExternalAgentProfileRegistry,  # D032
        shared_state_store: SharedStateStore,  # D033
        shared_state_handoff: SharedStateHandoff,  # D033
        # ... 其他依赖
    ) -> None:
        self._adapters = adapter_registry
        self._matcher = capability_matcher
        self._profiles = profile_registry
        self._state_store = shared_state_store
        self._state_handoff = shared_state_handoff

    async def invoke_with_shared_state(
        self,
        forgekin_id: str,
        task: ExternalAgentTask,
        state_id: str,
        handoff_capsule: dict | None = None,
    ) -> ExternalAgentResult:
        """带共享状态的调用（用于连续协作流）"""
        # 1. 若有 handoff_capsule，先交接
        if handoff_capsule is not None:
            next_agent_id = await self._select_agent_id(forgekin_id, task)
            await self._state_handoff.handoff_to_next_agent(
                state_id=state_id,
                next_agent_id=next_agent_id,
                capsule=handoff_capsule,
            )

        # 2. 新 Agent 读取 Onboarding 摘要
        agent_id = await self._select_agent_id(forgekin_id, task)
        onboarding = await self._state_handoff.read_onboarding(
            agent_id=agent_id,
            state_id=state_id,
        )

        # 3. 将 Onboarding 摘要注入 task.input_data
        enriched_task = task.model_copy(
            update={
                "input_data": {
                    **task.input_data,
                    "onboarding_summary": onboarding.model_dump,
                }
            }
        )

        # 4. 调用 Adapter
        adapter = self._adapters.get_by_agent_id(agent_id)
        result = await adapter.invoke(enriched_task)

        # 5. 写入修改记录 + 决策记录到共享状态
        if result.success:
            modification = ModificationRecord(
                record_id=f"mod_{result.task_id}_{uuid.uuid4.hex[:8]}",
                state_id=state_id,
                agent_id=agent_id,
                target=task.description,
                diff_summary=result.output.get("diff_summary", "") if result.output else "",
                rationale=result.output.get("rationale", "") if result.output else "",
                commit_ref=result.output.get("commit_ref") if result.output else None,
                artifacts_produced=result.output.get("artifacts", []) if result.output else [],
            )
            await self._state_store.append_modification(state_id, modification)

            # 添加产出物引用
            for artifact in modification.artifacts_produced:
                await self._state_store.add_artifact_ref(state_id, artifact)

            # 若 result.output 含 decision，写入决策记录
            if result.output and "decision" in result.output:
                decision = DecisionRecord(
                    record_id=f"dec_{result.task_id}_{uuid.uuid4.hex[:8]}",
                    state_id=state_id,
                    agent_id=agent_id,
                    decision=result.output["decision"],
                    alternatives_considered=result.output.get("alternatives", []),
                    tradeoffs=result.output.get("tradeoffs", ""),
                    open_questions=result.output.get("open_questions", []),
                )
                await self._state_store.append_decision(state_id, decision)

        return result
```

### 4.2 与 F002 TeamAct 协作（生命周期绑定）

```python
# workers/teamact/loop.py（F002 节选，展示与 D033 协作）

class TeamActLoop:
    def __init__(
        self,
        shared_state_store: SharedStateStore,  # D033
        event_bus: "EventBus",
    ) -> None:
        self._state_store = shared_state_store
        self._bus = event_bus

    async def start_team_act(
        self,
        forgekin_id: str,
        task_description: str,
    ) -> tuple[str, str]:
        """启动 TeamAct，同时创建共享状态

        Returns:
            (team_act_state_id, shared_state_id)
        """
        # 1. 创建 TeamActState（F002 内部）
        team_act_state_id = await self._create_team_act_state(
            forgekin_id=forgekin_id,
            task_description=task_description,
        )

        # 2. 创建共享状态（一一关联）
        shared_state_id = await self._state_store.create(
            team_act_state_ref=team_act_state_id,
            forgekin_id=forgekin_id,
            session_context={"task_description": task_description},
        )
        return team_act_state_id, shared_state_id

    async def terminate_team_act(
        self,
        team_act_state_id: str,
        reason: str,  # "completed" | "cancelled" | "failed"
    ) -> None:
        """终止 TeamAct，发布终止事件（D033 订阅者自动归档）"""
        await self._terminate_team_act_state(team_act_state_id, reason)
        await self._bus.publish(
            topic="team_act.terminated",
            payload={
                "team_act_state_ref": team_act_state_id,
                "termination_reason": reason,
            },
        )
```

### 4.3 与 F003 HandoffCapsule 协作

```python
# core/handoff/capsule.py（F003 节选，展示与 D033 协作）

class HandoffCapsuleBuilder:
    """构建 F003 HandoffCapsule，传递给 D033 SharedStateHandoff"""

    def build(
        self,
        open_questions: list[str],
        known_issues: list[str],
        next_action_hint: str | None = None,
    ) -> dict:
        """构建 HandoffCapsule 字典"""
        return {
            "open_questions": open_questions,
            "known_issues": known_issues,
            "next_action_hint": next_action_hint,
            "built_at": datetime.now.isoformat,
        }
```

### 4.4 与 F014 EchoStore 协作（归档）

```python
# core/memory/echo_store.py（F014 节选，展示与 D033 协作）

class EchoStoreRepository:
    """F014 EchoStore Repository（EchoStore集合存储）"""

    async def save(
        self,
        key: str,
        value: dict,
        collection: str,
    ) -> str:
        """保存条目到指定EchoStore集合

        Args:
            key: 条目键
            value: 条目值（dict）
            collection: EchoStore集合名（如 "external_agent_states"）

        Returns:
            echo_store_ref（条目引用 ID）
        """
        # 实际实现调用 F008 DurableStateSurfaces
        ...
```

### 4.5 与 D034 Fallback 协作

```python
# core/external_agent/fallback.py（D034 节选，展示与 D033 协作）

class HarnessFallbackChainExecutor(FallbackChainExecutor):
    def __init__(
        self,
        shared_state_handoff: SharedStateHandoff,  # D033
    ) -> None:
        self._handoff = shared_state_handoff

    async def execute(
        self,
        chain: FallbackChain,
        initial_call: dict,
        state_id: str | None = None,
    ) -> FallbackExecutionRecord:
        """执行 fallback 链，state_id 非空时通过 Onboarding 摘要传递上下文"""
        for step in chain.steps:
            # 切换厂商前，读取 Onboarding 摘要注入新 Agent
            if state_id is not None:
                onboarding = await self._handoff.read_onboarding(
                    agent_id=step.provider,
                    state_id=state_id,
                )
                initial_call["input_data"]["onboarding_summary"] = (
                    onboarding.model_dump
                )
            # ... 执行 step
```

### 4.6 完整时序图：claude code -> codex -> trae 连续协作

```
[Forgekin] --start_team_act--> [TeamActLoop (F002)]
                                  |
                                  | 1. create TeamActState
                                  v
                            [TeamActState Repo]
                                  |
                                  | 2. SharedStateStore.create(team_act_state_ref, forgekin_id)
                                  v
                            [SharedStateStore (D033)]
                                  |
                                  | 3. 持久化到 F008 DurableStateSurfaces
                                  v
[TeamActLoop] <---shared_state_id--- [SharedStateStore]

[1] Forgekin -> claude code 写代码
    [Bridge] --invoke_with_shared_state(state_id, task)--> [ClaudeCodeAdapter]
                                                              |
                                                              | 4. read_onboarding(agent_id="claude_code_main")
                                                              v
                                                        [SharedStateHandoff (D033)]
                                                              |
                                                              | <--- OnboardingSummary (空，首次)
                                                              v
                                                        [ClaudeCodeAdapter]
                                                              |
                                                              | 5. 写代码 + commit
                                                              v
                                                        [Bridge]
                                                              |
                                                              | 6. append_modification(state_id, record)
                                                              v
                                                        [SharedStateStore]
                                                              |
                                                              | 7. append_decision(state_id, record)
                                                              |    open_questions=["是否需要刷新令牌?"]
                                                              v
                                                        [SharedStateStore]

[2] Forgekin -> codex review
    [Bridge] --handoff_to_next_agent(state_id, "codex_main", capsule)--> [SharedStateHandoff]
                                                                              |
                                                                              | 8. 解析 capsule
                                                                              v
                                                                        [map_handoff_capsule_to_shared_state]
                                                                              |
                                                                              | 9. append handoff DecisionRecord
                                                                              v
                                                                        [SharedStateStore]
    [Bridge] --read_onboarding("codex_main", state_id)--> [SharedStateHandoff]
                                                              |
                                                              | <--- OnboardingSummary
                                                              |     recent_modifications: [claude_code 的修改]
                                                              |     open_questions: ["是否需要刷新令牌?"]
                                                              v
                                                        [CodexAdapter]
                                                              |
                                                              | 10. review + 提交意见
                                                              v
                                                        [Bridge]
                                                              |
                                                              | 11. append_modification(state_id, review_record)
                                                              v
                                                        [SharedStateStore]

[3] Forgekin -> trae 部署
    [Bridge] --read_onboarding("trae_main", state_id)--> [SharedStateHandoff]
                                                              |
                                                              | <--- OnboardingSummary
                                                              |     recent_modifications: [codex 的 review]
                                                              v
                                                        [TraeAdapter]
                                                              |
                                                              | 12. 部署
                                                              v
                                                        [Bridge]
                                                              |
                                                              | 13. append_modification(state_id, deploy_record)
                                                              v
                                                        [SharedStateStore]

[4] TeamAct 终止
    [TeamActLoop] --terminate_team_act--> publish "team_act.terminated"
                                              |
                                              v
                                        [SharedStateArchiver (D033)]
                                              |
                                              | 14. archive_to_echo_store(state_id)
                                              v
                                        [archive_shared_state_atomically]
                                              |
                                              | 15. 写入 F014 EchoStore
                                              v
                                        [EchoStoreRepository (F014)]
                                              |
                                              | 16. 更新 archived_at + archived_to_echo_store_ref
                                              v
                                        [SharedStateStore]
```

---

## 5. 详细设计验收

### 5.1 功能验收（Functional AC）

- [ ] **AC-F-01**: ExternalAgentSharedState.team_act_state_ref 为空时触发 ValueError（生命周期绑定铁律）。
- [ ] **AC-F-02**: HarnessSharedStateStore.create 校验 TeamActState 存在（调用 team_act_validator.assert_exists）。
- [ ] **AC-F-03**: HarnessSharedStateStore.create 同 TeamActState 重复创建触发 SharedStateAlreadyExistsError。
- [ ] **AC-F-04**: HarnessSharedStateStore.append_modification 增量 append，历史记录不被覆盖。
- [ ] **AC-F-05**: HarnessSharedStateStore.append_modification 在已归档状态上触发 SharedStateArchivedError。
- [ ] **AC-F-06**: HarnessSharedStateStore.append_modification 重复 record_id 触发 ModificationRecordConflictError。
- [ ] **AC-F-07**: HarnessSharedStateStore.append_decision 增量 append 决策记录。
- [ ] **AC-F-08**: HarnessSharedStateStore.add_artifact_ref 幂等（重复添加同 artifact_ref 不报错）。
- [ ] **AC-F-09**: HarnessSharedStateStore.archive_to_echo_store 重复归档触发 SharedStateAlreadyArchivedError。
- [ ] **AC-F-10**: generate_onboarding_summary 返回的 recent_modifications 数量 ≤ max_recent_modifications。
- [ ] **AC-F-11**: generate_onboarding_summary 返回的 recent_decisions 数量 ≤ max_recent_decisions。
- [ ] **AC-F-12**: generate_onboarding_summary 累积全部历史 DecisionRecord.open_questions（去重保序）。
- [ ] **AC-F-13**: map_handoff_capsule_to_shared_state 在 capsule 缺 open_questions 时触发 HandoffCapsuleIncompleteError。
- [ ] **AC-F-14**: map_handoff_capsule_to_shared_state 在 capsule 缺 known_issues 时触发 HandoffCapsuleIncompleteError。
- [ ] **AC-F-15**: HarnessSharedStateHandoff.handoff_to_next_agent 创建 handoff DecisionRecord 并 append 到共享状态。
- [ ] **AC-F-16**: HarnessSharedStateHandoff.handoff_to_next_agent 将 capsule.known_issues 写入 session_context。
- [ ] **AC-F-17**: HarnessSharedStateHandoff.read_onboarding 返回 OnboardingSummary 含 last_updated_by。
- [ ] **AC-F-18**: archive_shared_state_atomically 任一步失败时回滚（删除已写入的 EchoStore 条目）。
- [ ] **AC-F-19**: SharedStateArchiver 订阅 team_act.terminated 事件并自动归档。
- [ ] **AC-F-20**: SharedStateArchiver 在共享状态不存在时记录 warning 不抛异常。
- [ ] **AC-F-21**: SharedStateArchiver 在已归档时记录 info 跳过。

### 5.2 性能验收（Performance AC）

- [ ] **AC-P-01**: HarnessSharedStateStore.create 单次创建 < 30ms（含 TeamActState 校验 + 双写）。
- [ ] **AC-P-02**: HarnessSharedStateStore.get 单次读取 < 10ms。
- [ ] **AC-P-03**: HarnessSharedStateStore.append_modification 单次 append < 20ms（含 record_id 唯一性校验 + 双写）。
- [ ] **AC-P-04**: HarnessSharedStateStore.append_decision 单次 append < 20ms。
- [ ] **AC-P-05**: generate_onboarding_summary 在 100 modifications + 50 decisions 历史下 < 5ms。
- [ ] **AC-P-06**: HarnessSharedStateHandoff.handoff_to_next_agent 单次交接 < 50ms。
- [ ] **AC-P-07**: HarnessSharedStateHandoff.read_onboarding 单次读取 < 30ms（含摘要生成）。
- [ ] **AC-P-08**: archive_shared_state_atomically 在 100 modifications + 50 decisions 历史下 < 100ms（含 EchoStore 写入 + 状态更新）。
- [ ] **AC-P-09**: Onboarding 摘要相比全量历史节省 token ≥ 70%（典型场景 100 mods + 50 decs）。

### 5.3 安全验收（Security AC）

- [ ] **AC-S-01**: SharedStateRepository 抽象保证无直接数据库操作（grep "cursor.execute" 在 shared_state.py 中为空）。
- [ ] **AC-S-02**: archived 状态后所有 append 操作被拒绝，防止历史被篡改。
- [ ] **AC-S-03**: record_id 全局唯一校验，防止重复 append 导致历史污染。
- [ ] **AC-S-04**: yaml.safe_load 防止 YAML 反序列化攻击。
- [ ] **AC-S-05**: HandoffCapsule 字段完整性校验，防止不完整 capsule 导致上下文丢失。
- [ ] **AC-S-06**: 归档原子性保证（任一步失败回滚），防止部分写入导致状态不一致。
- [ ] **AC-S-07**: logger 输出不含敏感数据（仅含 state_id / agent_id / record_id 等指标）。
- [ ] **AC-S-08**: model_config extra="forbid" 防止 YAML 误加字段污染数据模型。
- [ ] **AC-S-09**: team_act_state_ref 非空校验，防止孤立共享状态。
- [ ] **AC-S-10**: DI 容器注入保证 Repository 实例唯一性。

### 5.4 Eval 验收（Eval AC）

- [ ] **AC-E-01**: 共享状态归档后可在 F014 EchoStore 中通过 echo_store_ref 查询到完整内容。
- [ ] **AC-E-02**: OnboardingSummary.open_questions 与全部历史 DecisionRecord.open_questions 一致（去重后）。
- [ ] **AC-E-03**: ModificationRecord 总量在 append 后单调递增（不减少）。
- [ ] **AC-E-04**: DecisionRecord 总量在 append 后单调递增。
- [ ] **AC-E-05**: 归档后 archived_at 字段非空，archived_to_echo_store_ref 字段非空。
- [ ] **AC-E-06**: TeamAct 终止事件触发后 5 秒内归档完成（事件订阅延迟 < 5s）。

### 5.5 集成测试点（Integration Test Points）

| 测试 ID | 测试场景 | 验证点 |
|---------|---------|--------|
| IT-D033-001 | 创建共享状态（team_act_state_ref 有效） | state_id 返回，team_act_state_ref 字段非空 |
| IT-D033-002 | 创建共享状态（team_act_state_ref 为空） | 触发 ValueError |
| IT-D033-003 | 创建共享状态（TeamActState 不存在） | 触发 TeamActStateNotFoundError |
| IT-D033-004 | 同 TeamActState 重复创建 | 触发 SharedStateAlreadyExistsError |
| IT-D033-005 | append_modification 增量 append | modification_log 长度 +1 |
| IT-D033-006 | append_modification 重复 record_id | 触发 ModificationRecordConflictError |
| IT-D033-007 | append_modification 在已归档状态 | 触发 SharedStateArchivedError |
| IT-D033-008 | append_decision 增量 append | decision_context 长度 +1 |
| IT-D033-009 | add_artifact_ref 幂等 | 重复添加同 ref 不报错，列表不重复 |
| IT-D033-010 | generate_onboarding_summary 默认参数 | recent_modifications ≤ 20，recent_decisions ≤ 10 |
| IT-D033-011 | generate_onboarding_summary open_questions 累积 | 累积全部历史 open_questions 去重保序 |
| IT-D033-012 | map_handoff_capsule 缺 open_questions | 触发 HandoffCapsuleIncompleteError |
| IT-D033-013 | map_handoff_capsule 缺 known_issues | 触发 HandoffCapsuleIncompleteError |
| IT-D033-014 | handoff_to_next_agent 完整流程 | handoff DecisionRecord append + session_context 更新 |
| IT-D033-015 | read_onboarding 返回完整摘要 | 含 recent_modifications / open_questions / artifact_refs |
| IT-D033-016 | archive_to_echo_store 首次归档 | echo_store_ref 返回，archived_at 非空 |
| IT-D033-017 | archive_to_echo_store 重复归档 | 触发 SharedStateAlreadyArchivedError |
| IT-D033-018 | archive 原子性（EchoStore 写失败） | 触发 ArchiveFailedError，状态未变更 |
| IT-D033-019 | SharedStateArchiver 订阅终止事件 | 事件触发后自动归档 |
| IT-D033-020 | 单向依赖校验 | shared_state.py 无 *Forge 反向 import |

### 5.6 错误处理矩阵

| 错误场景 | 异常类型 | 处理策略 | 上报层级 |
|---------|---------|---------|---------|
| team_act_state_ref 为空 | ValueError | 创建被拒绝 | operator |
| TeamActState 不存在 | TeamActStateNotFoundError | 创建被拒绝 | operator |
| 同 TeamActState 重复 | SharedStateAlreadyExistsError | 创建被拒绝 | operator |
| state_id 未找到 | SharedStateNotFoundError | 调用方处理（如 Bridge 降级） | logger.warning |
| 已归档状态 append | SharedStateArchivedError | append 被拒绝 | logger.warning |
| record_id 重复 | ModificationRecordConflictError | append 被拒绝 | logger.warning |
| capsule 字段缺失 | HandoffCapsuleIncompleteError | 交接被拒绝 | logger.error |
| EchoStore 写入失败 | ArchiveFailedError | 回滚 + 上报 | logger.error |
| 归档回滚失败 | ArchiveFailedError (stage=rollback) | 严重告警 | operator |
| 重复归档 | SharedStateAlreadyArchivedError | 跳过 | logger.info |
| TeamAct 终止但无共享状态 | SharedStateNotFoundError | 跳过 | logger.warning |

---

## 6. 引用

- [doc:../spec.md#§3.10]（FR-CORE-010）
- [doc:../arch.md#§3.10]（三方 Agent 集成）
- [doc:../features/F033-external-agent-shared-state.md]（同号 Feature 级 SRS）
- [doc:../architecture/A033-external-agent-shared-state.md]（同号 Architecture 级 SAD）
- [doc:../features/F002-teamact-loop.md]（生命周期绑定）
- [doc:../features/F003-handoff-capsule.md]（HandoffCapsule 对接）
- [doc:../features/F008-durable-state-surfaces.md]（持久状态层）
- [doc:../features/F014-memory-collection.md]（EchoStore EchoStore归档）
- [doc:../features/F031-external-agent-adapter.md]（Bridge 写入共享状态）
- [doc:../features/F032-external-agent-profile.md]（agent_id 引用）
- [doc:../features/F034-external-agent-fallback.md]（Onboarding 传递上下文）
- [doc:../features/F035-external-agent-capability-fusion.md]（artifact_refs 来源）
- [doc:D031-external-agent-adapter.md]（容器层）
- [doc:D032-external-agent-profile.md]（agent_id 引用）
- [doc:../decisions/006-external-agent-integration.md]
- [doc:../design/naming-contract.md]（EchoStore 命名）
- [doc:../../CONTRIBUTING.md]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（共享状态模型 + 增量 append + Onboarding 摘要算法 + HandoffCapsule 字段映射 + 归档原子性保证 + TeamAct 终止事件订阅 + DI 注入 + 21 功能 AC + 9 性能 AC + 10 安全 AC + 6 Eval AC + 20 集成测试点） | 架构师 Forgekin（猫头鹰·鲁班） |
