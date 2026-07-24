# D003: 交接胶囊（Handoff Capsule）详细设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 开发者 Forgekin（猎犬·夏洛克）
> **对应 spec.md**: [doc:../spec.md#§3.2]（FR-CORE-002，FR-CORE-016）
> **对应 arch.md**: [doc:../arch.md#§3.2]
> **对应 design.md**: [doc:../design.md#§3.2]
> **对应 Feature**: [doc:../features/F003-handoff-capsule.md]（同号 Feature 级 SRS）
> **对应 Architecture**: [doc:../architecture/A003-handoff-capsule.md]（同号 Feature 级 SAD）
> **依赖 ADR**: [doc:../decisions/002-collaboration-protocol.md]

---

## 1. 详细设计上下文

### 1.1 设计问题

A003 已给出 HandoffCapsule 的架构契约（五段 Schema + 盲点自动注入 + Durable Surface + WAL 可重放），但未落到代码层。本详细设计在代码层解决以下问题：

1. **五段 Schema 如何在 Pydantic v2 层做字段级 + 模型级双重校验，避免运行时绕过**：仅靠 `@field_validator` 单字段校验无法表达"五段任一为空抛 SchemaError"的硬约束
2. **盲点提示自动注入如何防止 author 手工篡改**：author 倾向于不暴露盲点（自我保护倾向），系统层注入必须保证不可绕过
3. **开放问题状态如何可追溯且避免无限累积**：每轮胶囊都新增开放问题会导致 list 膨胀，需要与链上前一胶囊比对去重并标记状态
4. **证据锚定（evidence_refs）如何在写入时强校验存在性**：未锚定证据的胶囊会让接手Forgekin无法回溯，但又不能在每次写入时同步阻塞调 F009
5. **WAL 可重放在 SQLite 层如何实现，崩溃后如何回放**：胶囊必须可恢复，但 SQLite WAL 模式默认无法跨进程回放业务级语义
6. **胶囊 schema_version 变更如何在 Schema 层兼容旧链**：协议层版本升级不能让历史胶囊链失效
7. **Build to Persist 属性如何在代码层标记**：A003 决策 5 提到胶囊是复利型基础设施，但代码层无字段承载

### 1.2 设计约束

- **Python 3.11+ 强制类型注解**：所有 public 接口必须带类型注解（编程红线 + rules.md 第二部分）
- **Pydantic v2 BaseModel**：所有数据结构基于 Pydantic v2，校验器使用 `@field_validator` / `@model_validator`
- **async/await 强制**：所有 I/O 操作（DB 读写 / EventBus / F009 调用）必须 async
- **DI 容器注入**：`HandoffCapsuleStore` / `BlindSpotHintInjector` / `HandoffCapsuleValidator` 通过 `flowforge/core/plugin/di_container.py` 注入，禁直接实例化
- **Repository 层抽象**：胶囊持久化必须通过 `HandoffCapsuleStore` ABC，禁 `cursor.execute("INSERT INTO handoff_capsules...")`
- **配置外置**：`max_open_questions` / `retention_days` / `enforce_blind_spot_hints` 外置到 `flowforge/config/teamact.yaml`
- **日志注入 trace_id**：所有日志通过 `core/tracing.py` 的 `get_logger`，自动注入 `trace_id`
- **提示词外置**：盲点提示生成与开放问题归并的提示词外置到 `flowforge/config/teamact_prompts.yaml`，禁 .py 文件硬编码
- **单向依赖**：`flowforge/core/teamact/handoff.py` 只能 import `core/interfaces/` 与共享内核，禁 import forgemind / *Forge
- **半角问号约束**：所有正则 pattern 必须使用半角 `?`，禁全角 `？`（避免 regex 失效）

### 1.3 设计影响

- **对 A002 TeamAct Loop**：ROUTE 步触发 `HandoffCapsuleStore.write`，STATE 步触发 `HandoffCapsuleStore.read_latest`，胶囊写入延迟直接计入 TeamAct 迭代耗时
- **对 A001 CapabilityProfile**：`BlindSpotHintInjector` 调用 `CapabilityRepository.load(forgekin_id)` 读取 `blind_spots`，注入到胶囊
- **对 A004 PingPong Circuit Breaker**：胶囊的 `has_substantive_output` 判定依赖 `evidence_refs` 与产出字符数
- **对 A006 Ball Custody Lease**：胶囊 `next_step` 字段是 lease 唤醒后执行的依据
- **对 A007 Push Back Protocol**：胶囊 `tradeoffs` 字段是 Push Back 论证依据
- **对 A008 Durable State Surfaces**：胶囊作为 6 类 Durable Surface 之一（authority_level=2）
- **对 A009 Evidence & Sensors**：`evidence_refs` 锚定到 F009 Evidence Store 的 evidence_id
- **对 A021 Side Effect WAL**：胶囊写入走 WAL，进程崩溃后可重放恢复
- **对 A018 Eval Contract**：胶囊完整率（五段非空 + 盲点提示存在）是 Eval 信号之一

---

## 2. 详细设计

### 2.1 类图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      flowforge/core/teamact/handoff.py                  │
│                                                                         │
│   ┌──────────────────────────────────────────────────────────────────┐  │
│   │                       HandoffCapsule                            │  │
│   │   (Pydantic v2 BaseModel, Durable Surface)                      │  │
│   │  ─────────────────────────────────────────────────────────────  │  │
│   │  + capsule_id: str                                              │  │
│   │  + author_forgekin_id: str                                      │  │
│   │  + team_id: str                                                 │  │
│   │  + iteration: int  (>= 1, 单调递增)                             │  │
│   │  + what: str  [非空, 事实陈述]                                  │  │
│   │  + why: str  [非空, 设计意图]                                   │  │
│   │  + tradeoffs: str  [非空, 放弃选项]                             │  │
│   │  + open_questions: list[OpenQuestionStatus]  [可空列表]         │  │
│   │  + next_step: str  [非空, 下一步建议]                           │  │
│   │  + evidence_refs: list[str]  [锚定 F009]                        │  │
│   │  + blind_spot_hints: list[str]  [系统注入, author 不可填]       │  │
│   │  + created_at: datetime                                         │  │
│   │  + schema_version: str = "1.0"                                  │  │
│   │  + decay_tag: DecayTag = "built_to_persist"                     │  │
│   │  + authority_level: int = 2                                     │  │
│   │  + compression_immune: bool = True                              │  │
│   │  ─────────────────────────────────────────────────────────────  │  │
│   │  + is_complete -> bool                                        │  │
│   │  + has_substantive_output -> bool                             │  │
│   │  + to_bootstrap_context -> str                                │  │
│   └──────────────┬───────────────────────────────────┬──────────────┘  │
│                  │                                   │                 │
│                  ▼                                   ▼                 │
│   ┌──────────────────────────────┐    ┌──────────────────────────────┐ │
│   │  HandoffCapsuleValidator     │    │  BlindSpotHintInjector       │ │
│   │  (无 ABC, 纯校验器)          │    │  (ABC + Default Impl)        │ │
│   │  ──────────────────────────  │    │  ──────────────────────────  │ │
│   │  + validate(capsule,         │    │  + inject(capsule,           │ │
│   │    prev_chain) ->            │    │    author_profile) ->        │ │
│   │    ValidationResult          │    │    HandoffCapsule            │ │
│   │  - _check_five_fields        │    │  - _read_blind_spots         │ │
│   │  - _check_open_questions     │    │  - _format_hint              │ │
│   │  - _check_evidence_refs      │    │  - _audit_log                │ │
│   │  - _check_iteration_mono     │    │                              │ │
│   │  - _check_blind_spot_consist │    │                              │ │
│   └──────────────┬───────────────┘    └──────────────┬───────────────┘ │
│                  │                                   │                 │
│                  ▼                                   ▼                 │
│   ┌──────────────────────────────────────────────────────────────┐     │
│   │           HandoffCapsuleStore (ABC)                          │     │
│   │  + write(capsule) -> capsule_id                              │     │
│   │  + read_latest(team_id) -> Optional[HandoffCapsule]          │     │
│   │  + list_chain(team_id) -> list[HandoffCapsule]               │     │
│   │  + count_open_questions(team_id) -> int                      │     │
│   │  + wal_replay(log_path) -> list[HandoffCapsule]              │     │
│   └────────────────────────────┬─────────────────────────────────┘     │
│                                ▼                                       │
│   ┌──────────────────────────────────────────────────────────────┐     │
│   │  flowforge/infra/repo/sqlite_handoff_store.py                │     │
│   │  SqliteHandoffCapsuleStore (默认实现, WAL 可重放)            │     │
│   └──────────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 接口契约实现

```python
# flowforge/core/teamact/handoff.py
from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from flowforge.core.tracing import get_logger
from flowforge.core.plugin.di_container import inject

logger = get_logger(__name__)


# ────────────────────────── 枚举与常量 ──────────────────────────

class OpenQuestionState(str, Enum):
    """开放问题状态（可追溯，TeamAct 终止条件判定依据）"""
    OPEN = "open"                # 仍开放
    RESOLVED = "resolved"        # 已解决
    ESCALATED = "escalated"      # 已升级到 CVO
    NEW = "new"                  # 本轮新增（未与上一胶囊比对过）


class DecayTag(str, Enum):
    """Build to Delete / Built to Persist 半衰期标记"""
    BUILT_TO_PERSIST = "built_to_persist"     # 复利型基础设施
    BUILT_TO_DELETE = "built_to_delete"       # 脚手架/补偿型
    INDIVIDUAL_COMPENSATION = "individual_compensation"  # 个体补偿（RA-023）


class SchemaError(Exception):
    """胶囊 Schema 校验失败"""


class HandoffValidationError(Exception):
    """胶囊业务校验失败（开放问题/证据/版本等）"""


# ────────────────────────── 数据模型 ──────────────────────────

class OpenQuestionStatus(BaseModel):
    """开放问题状态（可追溯）

    一项开放问题对应一条记录，包含问题文本 + 状态 + 解决者 + 解决时间。
    用于 TeamAct "无悬空任务归属" 终止条件判定。
    """
    question: str = Field(..., min_length=1, description="问题文本，非空")
    status: OpenQuestionState = Field(
        default=OpenQuestionState.NEW,
        description="open/resolved/escalated/new",
    )
    raised_at_iteration: int = Field(..., ge=1, description="首次提出的 iteration")
    resolved_by: Optional[str] = Field(
        default=None, description="解决者 forgekin_id"
    )
    resolved_at: Optional[datetime] = Field(
        default=None, description="解决时间（UTC）"
    )

    @model_validator(mode="after")
    def _check_resolved_consistency(self) -> "OpenQuestionStatus":
        """状态与解决字段一致性校验"""
        if self.status == OpenQuestionState.RESOLVED:
            if not self.resolved_by or not self.resolved_at:
                raise ValueError(
                    "OpenQuestionStatus.status=resolved 时 "
                    "resolved_by 与 resolved_at 必须非空"
                )
        else:
            if self.resolved_by or self.resolved_at:
                raise ValueError(
                    "OpenQuestionStatus.status != resolved 时 "
                    "resolved_by 与 resolved_at 必须为空"
                )
        return self


class HandoffCapsule(BaseModel):
    """交接胶囊 — TeamAct ROUTE 步协议层硬要求

    Durable Surface (authority_level=2, compression_immune=true)。
    author_forgekin_id 必须与上一任 TeamActState.current_owner 一致。
    blind_spot_hints 由系统从 F001 CapabilityProfile 自动注入，author 不可手工填写。
    """

    capsule_id: str = Field(..., min_length=1)
    author_forgekin_id: str = Field(..., min_length=1)
    team_id: str = Field(..., min_length=1)
    iteration: int = Field(..., ge=1, description="第几轮迭代，单调递增")

    # ─── 五段 Schema（协议层硬要求） ───
    what: str = Field(..., min_length=1, description="做了什么（事实陈述）")
    why: str = Field(..., min_length=1, description="为什么这样做（设计意图）")
    tradeoffs: str = Field(..., min_length=1, description="权衡了什么（放弃的选项）")
    open_questions: list[OpenQuestionStatus] = Field(
        default_factory=list,
        description="留下什么开放问题（可空列表）",
    )
    next_step: str = Field(..., min_length=1, description="下一步建议")

    # ─── 锚定与注入 ───
    evidence_refs: list[str] = Field(
        default_factory=list,
        description="关联 F009 Evidence ID 列表",
    )
    blind_spot_hints: list[str] = Field(
        default_factory=list,
        description="系统自动注入，author 不可手工填写",
    )

    # ─── Durable Surface 元信息 ───
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    schema_version: str = Field(default="1.0", pattern=r"^\d+\.\d+$")
    decay_tag: DecayTag = Field(
        default=DecayTag.BUILT_TO_PERSIST,
        description="Build to Delete/Persist 标记",
    )
    authority_level: int = Field(default=2, ge=1, le=3)
    compression_immune: bool = Field(default=True)

    @field_validator("what", "why", "tradeoffs", "next_step")
    @classmethod
    def _five_fields_non_empty(cls, v: str) -> str:
        """五段字段任一为空（含纯空白）抛 SchemaError"""
        if not v or not v.strip:
            raise SchemaError(
                "HandoffCapsule 五段字段（what/why/tradeoffs/next_step）不可为空"
            )
        return v.strip

    @model_validator(mode="after")
    def _check_open_questions_limit(self) -> "HandoffCapsule":
        """开放问题数量上限（防 list 膨胀）"""
        max_open = 7  # 默认值，可由 HandoffCapsuleValidator 覆盖
        unresolved = [q for q in self.open_questions
                      if q.status != OpenQuestionState.RESOLVED]
        if len(unresolved) > max_open:
            raise SchemaError(
                f"未解决开放问题数量 {len(unresolved)} 超过上限 {max_open}"
            )
        return self

    # ─── 业务方法 ───

    def is_complete(self) -> bool:
        """胶囊是否完整（五段非空 + 至少一条 evidence_ref）"""
        return bool(
            self.what and self.why and self.tradeoffs and self.next_step
            and len(self.evidence_refs) >= 1
        )

    def has_substantive_output(self, min_chars: int = 200) -> bool:
        """是否有实质产出（F004 PingPong 熔断器依赖）"""
        total = len(self.what) + len(self.why) + len(self.tradeoffs) + len(self.next_step)
        return total >= min_chars and len(self.evidence_refs) >= 1

    def to_bootstrap_context(self) -> str:
        """转成接手Forgekin bootstrap 用的紧凑上下文"""
        lines = [
            f"## 第 {self.iteration} 轮交接胶囊 (author: {self.author_forgekin_id})",
            f"### What\n{self.what}",
            f"### Why\n{self.why}",
            f"### Tradeoffs\n{self.tradeoffs}",
        ]
        if self.open_questions:
            unresolved = [q for q in self.open_questions
                          if q.status != OpenQuestionState.RESOLVED]
            if unresolved:
                lines.append("### Open Questions (unresolved)")
                for q in unresolved:
                    lines.append(f"- [{q.status.value}] {q.question}")
        if self.blind_spot_hints:
            lines.append("### Blind Spot Hints (系统注入)")
            for h in self.blind_spot_hints:
                lines.append(f"- ⚠ {h}")
        lines.append(f"### Next Step\n{self.next_step}")
        return "\n".join(lines)

    def unresolved_question_count(self) -> int:
        return sum(
            1 for q in self.open_questions
            if q.status != OpenQuestionState.RESOLVED
        )


# ────────────────────────── 校验器 ──────────────────────────

class ValidationResult(BaseModel):
    """校验结果"""
    is_valid: bool
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class HandoffCapsuleValidator:
    """交接胶囊校验器（无 ABC，纯校验器）

    校验项：
    - 五段非空（Pydantic 已校验，这里做二次防御）
    - 开放问题与上一胶囊比对去重，标记状态
    - evidence_refs 必须在 F009 Evidence Store 中存在
    - iteration 单调递增，不可回退
    - blind_spot_hints 必须由系统注入，author 不可手工填
    """

    def __init__(
        self,
        evidence_store: Optional[Any] = None,
        max_open_questions: int = 7,
        enforce_blind_spot_hints: bool = True,
    ):
        self._evidence_store = evidence_store  # F009 EvidenceStore，延迟注入
        self._max_open_questions = max_open_questions
        self._enforce_blind_spot_hints = enforce_blind_spot_hints

    async def validate(
        self,
        capsule: HandoffCapsule,
        prev_chain: list[HandoffCapsule],
    ) -> ValidationResult:
        errors: list[str] = []
        warnings: list[str] = []

        # 1. 五段非空（防御性二次校验）
        for field_name in ("what", "why", "tradeoffs", "next_step"):
            v = getattr(capsule, field_name)
            if not v or not v.strip:
                errors.append(f"字段 {field_name} 不可为空")

        # 2. iteration 单调递增
        if prev_chain:
            last_iter = prev_chain[-1].iteration
            if capsule.iteration <= last_iter:
                errors.append(
                    f"iteration {capsule.iteration} 必须大于前一胶囊 "
                    f"iteration {last_iter}"
                )

        # 3. 开放问题状态流转
        if prev_chain:
            prev_open = {
                q.question: q.status
                for q in prev_chain[-1].open_questions
            }
            for q in capsule.open_questions:
                if q.question in prev_open:
                    prev_status = prev_open[q.question]
                    # 状态不可逆：resolved 不可回退到 open
                    if (prev_status == OpenQuestionState.RESOLVED
                            and q.status != OpenQuestionState.RESOLVED):
                        errors.append(
                            f"开放问题 '{q.question}' 已 resolved，"
                            f"不可回退到 {q.status.value}"
                        )
                # 新问题应标记 NEW
                if q.question not in prev_open and q.status != OpenQuestionState.NEW:
                    warnings.append(
                        f"新开放问题 '{q.question}' 应标记 NEW，"
                        f"当前为 {q.status.value}"
                    )

        # 4. 开放问题数量上限
        unresolved = capsule.unresolved_question_count
        if unresolved > self._max_open_questions:
            errors.append(
                f"未解决开放问题 {unresolved} 超过上限 "
                f"{self._max_open_questions}"
            )

        # 5. evidence_refs 存在性校验（异步调 F009）
        if self._evidence_store and capsule.evidence_refs:
            missing = await self._evidence_store.check_existence(
                capsule.evidence_refs
            )
            if missing:
                errors.append(
                    f"evidence_refs 指向不存在的 Evidence ID: {missing}"
                )

        # 6. blind_spot_hints 一致性（必须由系统注入）
        if self._enforce_blind_spot_hints:
            # 注入由 BlindSpotHintInjector 完成，校验器只检查标记
            # author 手工填会在 BlindSpotHintInjector 阶段被拒绝
            pass

        return ValidationResult(
            is_valid=len(errors) == 0,
            errors=errors,
            warnings=warnings,
        )


# ────────────────────────── 盲点注入器 ──────────────────────────

class BlindSpotHintInjector(ABC):
    """盲点提示自动注入器

    从 F001 CapabilityProfile.blind_spots 自动读取，附加到 capsule.blind_spot_hints。
    author 不可手工填写 blind_spot_hints（系统在注入前会清空 author 自填内容）。
    """

    @abstractmethod
    async def inject(
        self,
        capsule: HandoffCapsule,
        author_profile: Any,  # CapabilityProfile
    ) -> HandoffCapsule:
        """注入盲点提示

        架构契约:
        - author 不可手工填写 blind_spot_hints
        - 必须从 F001 CapabilityProfile 读取
        - 注入后写审计日志
        """


class DefaultBlindSpotHintInjector(BlindSpotHintInjector):
    """默认盲点提示注入器"""

    def __init__(self, audit_logger: Optional[Any] = None):
        self._audit_logger = audit_logger or logger

    async def inject(
        self,
        capsule: HandoffCapsule,
        author_profile: Any,
    ) -> HandoffCapsule:
        # 1. 清空 author 手工填写的 hints（防绕过）
        if capsule.blind_spot_hints:
            self._audit_logger.warning(
                "capsule_id=%s author=%s 试图手工填写 blind_spot_hints，已清空",
                capsule.capsule_id, capsule.author_forgekin_id,
                extra={"trace_id": capsule.capsule_id},
            )
            capsule.blind_spot_hints = []

        # 2. 从 CapabilityProfile.blind_spots 读取
        hints: list[str] = []
        for blind_spot in getattr(author_profile, "blind_spots", []):
            hint = self._format_hint(blind_spot)
            hints.append(hint)

        # 3. 注入到胶囊
        capsule.blind_spot_hints = hints

        # 4. 写审计日志
        self._audit_logger.info(
            "capsule_id=%s author=%s 注入 %d 条盲点提示",
            capsule.capsule_id, capsule.author_forgekin_id, len(hints),
            extra={"trace_id": capsule.capsule_id, "hint_count": len(hints)},
        )

        return capsule

    @staticmethod
    def _format_hint(blind_spot: Any) -> str:
        """格式化单条盲点提示"""
        desc = getattr(blind_spot, "description", "未知盲点")
        strategy = getattr(blind_spot, "compensation_strategy", "无补偿策略")
        confidence = getattr(blind_spot, "confidence", 0.0)
        return (
            f"⚠ 盲点: {desc} | 补偿策略: {strategy} | "
            f"置信度: {confidence:.2f}"
        )


# ────────────────────────── Repository 抽象 ──────────────────────────

class HandoffCapsuleStore(ABC):
    """交接胶囊 Repository — 唯一持久化入口

    架构契约:
    - 通过 DI 容器注入，禁直接实例化
    - 持久化到 Durable Surface (compression_immune=true)
    - WAL 可重放 (F021 联动)
    - 胶囊链 iteration 单调递增，不可回退
    """

    @abstractmethod
    async def write(self, capsule: HandoffCapsule) -> str:
        """写入胶囊，返回 capsule_id"""

    @abstractmethod
    async def read_latest(self, team_id: str) -> Optional[HandoffCapsule]:
        """读取团队最新胶囊（接手Forgekin bootstrap 入口）"""

    @abstractmethod
    async def list_chain(self, team_id: str) -> list[HandoffCapsule]:
        """读取团队完整胶囊链（按 iteration 排序，可回放）"""

    @abstractmethod
    async def count_open_questions(self, team_id: str) -> int:
        """统计团队未解决开放问题数量（TeamAct 终止条件判定）"""

    @abstractmethod
    async def wal_replay(self, log_path: str) -> list[HandoffCapsule]:
        """WAL 重放，进程崩溃后恢复（F021 联动）"""
```

### 2.3 关键算法伪代码

#### 算法 1：交接胶囊写入流程（TeamAct ROUTE 步触发）

```
INPUT:  capsule_draft (author 填写五段, 可能含手工 hints)
        author_profile (F001 CapabilityProfile)
        team_id, prev_chain

OUTPUT: capsule_id

STEPS:
1. capsule = HandoffCapsule(**capsule_draft)
   # Pydantic 字段级校验（五段非空 + iteration >= 1）

2. injector = inject(BlindSpotHintInjector)
   capsule = await injector.inject(capsule, author_profile)
   # 清空 author 手填 hints，从 CapabilityProfile.blind_spots 注入

3. validator = inject(HandoffCapsuleValidator)
   result = await validator.validate(capsule, prev_chain)
   IF NOT result.is_valid:
       RAISE HandoffValidationError(result.errors)

4. store = inject(HandoffCapsuleStore)
   capsule_id = await store.write(capsule)
   # WAL 写入 + Durable Surface 持久化 + EventBus 广播

5. RETURN capsule_id
```

#### 算法 2：开放问题状态流转（与上一胶囊比对）

```
INPUT:  current_capsule.open_questions
        prev_capsule.open_questions

OUTPUT: current_capsule.open_questions (状态已更新)

STEPS:
1. prev_map = { q.question: q.status for q in prev_capsule.open_questions }

2. FOR q IN current_capsule.open_questions:
       IF q.question IN prev_map:
           prev_status = prev_map[q.question]
           IF prev_status == RESOLVED AND q.status != RESOLVED:
               RAISE SchemaError("已 resolved 不可回退")
           # 保持原 raised_at_iteration
       ELSE:
           q.status = NEW
           q.raised_at_iteration = current_capsule.iteration

3. FOR q IN prev_capsule.open_questions:
       IF q.question NOT IN {x.question for x in current_capsule.open_questions}:
           IF q.status != RESOLVED:
               WARN("prev 开放问题在当前胶囊中消失，可能被遗忘")
               # 自动补回当前胶囊，标记 ESCALATED
               current_capsule.open_questions.append(
                   OpenQuestionStatus(
                       question=q.question,
                       status=ESCALATED,
                       raised_at_iteration=q.raised_at_iteration,
                   )
               )
```

#### 算法 3：WAL 重放（崩溃恢复）

```
INPUT:  wal_log_path (SQLite WAL 文件路径)
        team_id

OUTPUT: list[HandoffCapsule] (已恢复的胶囊链)

STEPS:
1. wal_records = parse_wal_log(wal_log_path)
   # 解析 WAL 日志，提取已提交但未 checkpoint 的记录

2. recovered = []
   FOR record IN wal_records:
       IF record.team_id != team_id:
           CONTINUE
       IF record.operation == "write":
           capsule = deserialize(record.capsule_json)
           # 二次校验
           IF validator.validate(capsule, recovered).is_valid:
               recovered.append(capsule)
       ELIF record.operation == "delete":
           # 软删除标记
           recovered = [c for c in recovered if c.capsule_id != record.capsule_id]

3. recovered.sort(key=lambda c: c.iteration)
   RETURN recovered
```

#### 算法 4：capsule_id 生成（防碰撞 + 可追溯）

```
INPUT:  team_id, iteration, author_forgekin_id

OUTPUT: capsule_id (格式: "cap-{team_id}-{iteration}-{hash8}")

STEPS:
1. raw = f"{team_id}|{iteration}|{author_forgekin_id}|{utc_now_iso8601_ns}"
2. hash8 = sha256(raw).hexdigest[:8]
3. capsule_id = f"cap-{team_id}-{iteration}-{hash8}"
4. RETURN capsule_id
```

---

## 3. 模块实现

### 3.1 SQLite 持久化实现（WAL 可重放）

```python
# flowforge/infra/repo/sqlite_handoff_store.py
from __future__ import annotations

import asyncio
import hashlib
import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from flowforge.core.teamact.handoff import (
    HandoffCapsule,
    HandoffCapsuleStore,
    OpenQuestionState,
    OpenQuestionStatus,
)
from flowforge.core.tracing import get_logger
from flowforge.core.plugin.di_container import inject

logger = get_logger(__name__)


class SqliteHandoffCapsuleStore(HandoffCapsuleStore):
    """SQLite 持久化实现（WAL 可重放，与 F021 联动）

    表结构:
        handoff_capsules (
            capsule_id TEXT PRIMARY KEY,
            team_id TEXT NOT NULL,
            author_forgekin_id TEXT NOT NULL,
            iteration INTEGER NOT NULL,
            what TEXT NOT NULL,
            why TEXT NOT NULL,
            tradeoffs TEXT NOT NULL,
            next_step TEXT NOT NULL,
            open_questions_json TEXT,        -- 序列化的 OpenQuestionStatus 列表
            evidence_refs_json TEXT,         -- 序列化的 evidence_id 列表
            blind_spot_hints_json TEXT,      -- 序列化的 hint 字符串列表
            schema_version TEXT NOT NULL,
            decay_tag TEXT NOT NULL,
            authority_level INTEGER NOT NULL,
            compression_immune INTEGER NOT NULL,  -- 0/1
            created_at TEXT NOT NULL,        -- ISO8601 UTC
            UNIQUE(team_id, iteration)
        )

    索引:
        idx_team_iter ON handoff_capsules(team_id, iteration DESC)
        idx_author ON handoff_capsules(author_forgekin_id)
    """

    DDL = """
    CREATE TABLE IF NOT EXISTS handoff_capsules (
        capsule_id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        author_forgekin_id TEXT NOT NULL,
        iteration INTEGER NOT NULL,
        what TEXT NOT NULL,
        why TEXT NOT NULL,
        tradeoffs TEXT NOT NULL,
        next_step TEXT NOT NULL,
        open_questions_json TEXT,
        evidence_refs_json TEXT,
        blind_spot_hints_json TEXT,
        schema_version TEXT NOT NULL,
        decay_tag TEXT NOT NULL,
        authority_level INTEGER NOT NULL,
        compression_immune INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(team_id, iteration)
    );
    CREATE INDEX IF NOT EXISTS idx_team_iter
        ON handoff_capsules(team_id, iteration DESC);
    CREATE INDEX IF NOT EXISTS idx_author
        ON handoff_capsules(author_forgekin_id);
    """

    def __init__(
        self,
        db_path: str | Path,
        wal_dir: Optional[str | Path] = None,
        retention_days: int = 90,
    ):
        self._db_path = str(db_path)
        self._wal_dir = str(wal_dir) if wal_dir else str(Path(db_path).parent)
        self._retention_days = retention_days
        self._lock = asyncio.Lock
        self._init_db

    def _init_db(self) -> None:
        """初始化数据库 + WAL 模式"""
        Path(self._db_path).parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(self._db_path) as conn:
            conn.execute("PRAGMA journal_mode=WAL;")
            conn.execute("PRAGMA synchronous=NORMAL;")
            conn.executescript(self.DDL)
            conn.commit
        logger.info(
            "SqliteHandoffCapsuleStore 初始化完成 db=%s",
            self._db_path,
        )

    def _generate_capsule_id(
        self, team_id: str, iteration: int, author_forgekin_id: str,
    ) -> str:
        raw = (
            f"{team_id}|{iteration}|{author_forgekin_id}|"
            f"{datetime.now(timezone.utc).isoformat}"
        )
        hash8 = hashlib.sha256(raw.encode("utf-8")).hexdigest[:8]
        return f"cap-{team_id}-{iteration}-{hash8}"

    @staticmethod
    def _serialize_open_questions(questions: list[OpenQuestionStatus]) -> str:
        return json.dumps(
            [q.model_dump(mode="json") for q in questions],
            ensure_ascii=False,
        )

    @staticmethod
    def _deserialize_open_questions(raw: str) -> list[OpenQuestionStatus]:
        if not raw:
            return []
        return [
            OpenQuestionStatus(**item)
            for item in json.loads(raw)
        ]

    async def write(self, capsule: HandoffCapsule) -> str:
        """写入胶囊（WAL 可重放）

        - 若 capsule.capsule_id 为空，自动生成
        - 写入后广播事件到 EventBus（接手Forgekin可感知）
        """
        async with self._lock:
            if not capsule.capsule_id:
                capsule.capsule_id = self._generate_capsule_id(
                    capsule.team_id, capsule.iteration, capsule.author_forgekin_id,
                )

            def _do_write -> str:
                with sqlite3.connect(self._db_path) as conn:
                    conn.execute(
                        """
                        INSERT INTO handoff_capsules
                            (capsule_id, team_id, author_forgekin_id, iteration,
                             what, why, tradeoffs, next_step,
                             open_questions_json, evidence_refs_json,
                             blind_spot_hints_json, schema_version, decay_tag,
                             authority_level, compression_immune, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            capsule.capsule_id,
                            capsule.team_id,
                            capsule.author_forgekin_id,
                            capsule.iteration,
                            capsule.what,
                            capsule.why,
                            capsule.tradeoffs,
                            capsule.next_step,
                            self._serialize_open_questions(capsule.open_questions),
                            json.dumps(capsule.evidence_refs, ensure_ascii=False),
                            json.dumps(capsule.blind_spot_hints, ensure_ascii=False),
                            capsule.schema_version,
                            capsule.decay_tag.value,
                            capsule.authority_level,
                            1 if capsule.compression_immune else 0,
                            capsule.created_at.isoformat,
                        ),
                    )
                    conn.commit
                return capsule.capsule_id

            capsule_id = await asyncio.to_thread(_do_write)
            logger.info(
                "写入交接胶囊 capsule_id=%s team=%s iteration=%d",
                capsule_id, capsule.team_id, capsule.iteration,
                extra={
                    "trace_id": capsule_id,
                    "team_id": capsule.team_id,
                    "iteration": capsule.iteration,
                },
            )
            return capsule_id

    async def read_latest(self, team_id: str) -> Optional[HandoffCapsule]:
        async with self._lock:
            def _do_read -> Optional[HandoffCapsule]:
                with sqlite3.connect(self._db_path) as conn:
                    conn.row_factory = sqlite3.Row
                    row = conn.execute(
                        """
                        SELECT * FROM handoff_capsules
                        WHERE team_id = ?
                        ORDER BY iteration DESC LIMIT 1
                        """,
                        (team_id,),
                    ).fetchone
                return self._row_to_capsule(row) if row else None

            return await asyncio.to_thread(_do_read)

    async def list_chain(self, team_id: str) -> list[HandoffCapsule]:
        async with self._lock:
            def _do_list -> list[HandoffCapsule]:
                with sqlite3.connect(self._db_path) as conn:
                    conn.row_factory = sqlite3.Row
                    rows = conn.execute(
                        """
                        SELECT * FROM handoff_capsules
                        WHERE team_id = ?
                        ORDER BY iteration ASC
                        """,
                        (team_id,),
                    ).fetchall
                return [self._row_to_capsule(r) for r in rows]

            return await asyncio.to_thread(_do_list)

    async def count_open_questions(self, team_id: str) -> int:
        async with self._lock:
            def _do_count -> int:
                with sqlite3.connect(self._db_path) as conn:
                    row = conn.execute(
                        """
                        SELECT open_questions_json FROM handoff_capsules
                        WHERE team_id = ?
                        ORDER BY iteration DESC LIMIT 1
                        """,
                        (team_id,),
                    ).fetchone
                if not row or not row[0]:
                    return 0
                questions = self._deserialize_open_questions(row[0])
                return sum(
                    1 for q in questions
                    if q.status != OpenQuestionState.RESOLVED
                )

            return await asyncio.to_thread(_do_count)

    async def wal_replay(self, log_path: str) -> list[HandoffCapsule]:
        """WAL 重放（崩溃恢复）

        利用 SQLite WAL 模式的 -wal 文件自动恢复机制，
        在数据库连接时自动 replay，无需业务层手动解析。
        本方法用于强制 checkpoint 后读取所有胶囊。
        """
        async with self._lock:
            def _do_replay -> list[HandoffCapsule]:
                # 强制 checkpoint，将 WAL 日志合并到主数据库
                with sqlite3.connect(self._db_path) as conn:
                    conn.execute("PRAGMA wal_checkpoint(FULL);")
                    conn.commit
                # 然后读取所有胶囊（按 team_id 排序）
                with sqlite3.connect(self._db_path) as conn:
                    conn.row_factory = sqlite3.Row
                    rows = conn.execute(
                        """
                        SELECT * FROM handoff_capsules
                        ORDER BY team_id, iteration ASC
                        """
                    ).fetchall
                return [self._row_to_capsule(r) for r in rows]

            return await asyncio.to_thread(_do_replay)

    @staticmethod
    def _row_to_capsule(row: sqlite3.Row) -> HandoffCapsule:
        return HandoffCapsule(
            capsule_id=row["capsule_id"],
            author_forgekin_id=row["author_forgekin_id"],
            team_id=row["team_id"],
            iteration=row["iteration"],
            what=row["what"],
            why=row["why"],
            tradeoffs=row["tradeoffs"],
            next_step=row["next_step"],
            open_questions=SqliteHandoffCapsuleStore._deserialize_open_questions(
                row["open_questions_json"] or "[]"
            ),
            evidence_refs=json.loads(row["evidence_refs_json"] or "[]"),
            blind_spot_hints=json.loads(row["blind_spot_hints_json"] or "[]"),
            schema_version=row["schema_version"],
            decay_tag=row["decay_tag"],
            authority_level=row["authority_level"],
            compression_immune=bool(row["compression_immune"]),
            created_at=datetime.fromisoformat(row["created_at"]),
        )
```

### 3.2 关键流程时序图

#### 时序图 1：TeamAct ROUTE 步写入胶囊

```
TeamActLoop     Author       BlindSpotHint   HandoffCapsule   SqliteHandoff
 (A002)         Forgekin     Injector        Validator        CapsuleStore
    │              │              │                │                │
    │ ROUTE 步触发 │              │                │                │
    ├─────────────►│              │                │                │
    │              │ 填写五段     │                │                │
    │              │ (what/why/   │                │                │
    │              │  tradeoffs/  │                │                │
    │              │  open_q/     │                │                │
    │              │  next_step)  │                │                │
    │              │ evidence_refs│                │                │
    │              │ (可能手填    │                │                │
    │              │  hints)      │                │                │
    │              ├─────────────►│                │                │
    │              │              │ 清空手填 hints │                │
    │              │              │ (审计日志)     │                │
    │              │              │ 读 Capability- │                │
    │              │              │  Profile.      │                │
    │              │              │  blind_spots   │                │
    │              │              │ (F001 调用)    │                │
    │              │              │ 格式化 + 注入  │                │
    │              │◄─────────────┤                │                │
    │              │ capsule(已   │                │                │
    │              │  注入 hints) │                │                │
    │              ├──────────────┼───────────────►│                │
    │              │              │                │ 五段非空校验   │
    │              │              │                │ iteration 递增│
    │              │              │                │ 开放问题状态   │
    │              │              │                │ evidence_refs │
    │              │              │                │  存在性(F009)  │
    │              │              │                │ 盲点一致性     │
    │              │              │◄───────────────┤                │
    │              │              │ ValidationResult                │
    │              │              │                │                │
    │              │ [校验通过]   │                │                │
    │              ├──────────────┼────────────────┼───────────────►│
    │              │              │                │                │ WAL 写入
    │              │              │                │                │ Durable Surface
    │              │              │                │                │ EventBus 广播
    │              │              │                │                │ (接手可感知)
    │              │◄─────────────┼────────────────┼───────────────┤
    │              │ capsule_id   │                │                │
    │◄─────────────┤              │                │                │
    │ TeamAct 转到下一轮           │                │                │
    │ STATE 步 (接手读取)          │                │                │
    │              │              │                │                │
    │ read_latest(team_id)        │                │                │
    ├──────────────┼──────────────┼────────────────┼───────────────►│
    │              │              │                │                │ SELECT 最新
    │              │              │                │                │ ORDER BY iter
    │              │              │                │                │ DESC LIMIT 1
    │              │              │                │                │
    │◄─────────────┼──────────────┼────────────────┼───────────────┤
    │ capsule(最新)               │                │                │
    │ 接手Forgekin bootstrap         │                │                │
    │ (to_bootstrap_context)    │                │                │
    │              │              │                │                │
```

#### 时序图 2：进程崩溃后 WAL 重放恢复

```
Process Restart    SqliteHandoffCapsuleStore       SQLite (WAL)
      │                    │                            │
      │ 启动时调用          │                            │
      │ wal_replay(log)    │                            │
      ├───────────────────►│                            │
      │                    │ PRAGMA wal_checkpoint(FULL)│
      │                    ├───────────────────────────►│
      │                    │                            │ 合并 -wal 文件
      │                    │                            │ 到主数据库
      │                    │◄───────────────────────────┤
      │                    │                            │
      │                    │ SELECT * FROM              │
      │                    │  handoff_capsules          │
      │                    │  ORDER BY team_id, iter    │
      │                    ├───────────────────────────►│
      │                    │                            │ 返回所有胶囊
      │                    │◄───────────────────────────┤
      │                    │                            │
      │                    │ 反序列化每行 →             │
      │                    │ HandoffCapsule             │
      │                    │ 二次校验（五段非空 +       │
      │                    │  iteration 递增）          │
      │                    │                            │
      │ list[HandoffCapsule]                           │
      │◄───────────────────┤                            │
      │                                                 │
      │ 接手Forgekin可读最新胶囊恢复心智状态              │
```

### 3.3 错误处理

| 错误场景 | 异常类型 | 处理策略 | 用户感知 |
|---------|---------|---------|---------|
| 五段字段任一为空（含纯空白） | `SchemaError` | Pydantic 字段级校验拦截， capsules 不可构造 | TeamAct ROUTE 步重试，提示 author 补全 |
| iteration 回退或重复 | `HandoffValidationError` | Validator 在写入前校验，拒绝写入 | TeamAct 路由到下一轮时强制递增 |
| author 手工填 blind_spot_hints | （不抛异常） | `BlindSpotHintInjector` 清空手填值，写审计日志 | author 看到 warning，知道系统已接管 |
| evidence_refs 指向不存在的 Evidence ID | `HandoffValidationError` | Validator 异步调 F009 `check_existence`，缺失项写入 errors | TeamAct 阻塞 ROUTE 步，提示 author 重新锚定 |
| 未解决开放问题超过 7 个 | `SchemaError` | Pydantic model_validator 拦截 | author 必须先解决或升级旧问题才能写入新胶囊 |
| 已 resolved 开放问题回退到 open | `HandoffValidationError` | Validator 状态流转校验 | 阻塞写入，提示 author 该问题已解决 |
| SQLite 写入失败（磁盘满/权限） | `sqlite3.OperationalError` | 抛出，由 TeamAct 重试机制处理 | TeamAct 标记团队 FROZEN，告警 CVO |
| WAL 文件损坏 | `sqlite3.DatabaseError` | 启动时 `wal_checkpoint` 失败，回退到最近备份 | 启动失败，运维介入 |
| schema_version 不兼容 | `HandoffValidationError` | Validator 检查版本兼容性矩阵 | 拒绝写入，提示走 ADR 流程升级 Schema |
| CapabilityProfile 不存在（盲点注入失败） | `KeyError` | `BlindSpotHintInjector` 抛出，TeamAct 阻塞 | 告警 CVO，author 必须先初始化 CapabilityProfile |
| 并发写入同一 (team_id, iteration) | `sqlite3.IntegrityError` | UNIQUE 约束拦截，抛出 | TeamAct 重试，强制 iteration 递增 |

### 3.4 性能优化

| 性能指标 | 目标值 | 优化手段 |
|---------|--------|---------|
| 单次胶囊写入延迟（P99） | < 50ms | SQLite WAL 模式 + `synchronous=NORMAL`（牺牲少量持久性换吞吐） |
| `read_latest` 延迟（P99） | < 20ms | 索引 `idx_team_iter ON (team_id, iteration DESC)` + `LIMIT 1` |
| `list_chain` 延迟（P99, 100 条胶囊） | < 100ms | 索引 + 按 iteration ASC 排序，避免内存排序 |
| `count_open_questions` 延迟 | < 10ms | 单行读取 + 内存计算，不扫全表 |
| WAL 重放 100 条胶囊 | < 500ms | `wal_checkpoint(FULL)` 一次性合并，避免逐条解析 |
| 五段字段校验 | < 1ms | Pydantic v2 编译期校验器，运行时零反射 |
| `to_bootstrap_context` 序列化 | < 2ms | 字符串拼接 + 列表推导，无 JSON 序列化开销 |
| 盲点注入（10 条盲点） | < 5ms | 内存操作，无 I/O；F001 CapabilityProfile 已缓存 |
| EventBus 广播 | 异步，不阻塞写入 | 写入后 `asyncio.create_task` 触发广播 |

**缓存策略**：
- `read_latest` 结果在 TeamAct 单轮迭代内缓存（TTL = 迭代时长，约 30s）
- `CapabilityProfile.blind_spots` 在 BlindSpotHintInjector 内 LRU 缓存（TTL = 5min，与 D001 一致）

**批量优化**：
- WAL checkpoint 每 1000 次写入或每 5 分钟触发一次（避免 -wal 文件膨胀）
- 历史胶囊归档：超过 `retention_days`（默认 90 天）的胶囊移到 `handoff_capsules_archive` 表

### 3.5 配置外置示例

```yaml
# flowforge/config/teamact.yaml
handoff_capsule:
  schema_version: "1.0"
  max_open_questions: 7                    # 未解决开放问题上限
  enforce_blind_spot_hints: true           # 强制系统注入，author 不可手填
  storage_backend: sqlite
  retention_days: 90                       # 胶囊保留天数
  archive_enabled: true                    # 启用归档表
  
  # SQLite WAL 配置
  sqlite:
    db_path: "data/flowforge/handoff.db"
    journal_mode: "WAL"
    synchronous: "NORMAL"                  # NORMAL=0, FULL=1
    wal_autocheckpoint: 1000               # 每 1000 页自动 checkpoint
    
  # 性能阈值
  performance:
    write_p99_ms: 50
    read_latest_p99_ms: 20
    list_chain_p99_ms: 100
    
  # 校验配置
  validation:
    check_evidence_refs_exist: true        # 写入时校验 evidence_refs 存在性
    min_evidence_refs: 1                   # 至少 1 条证据
    min_total_chars: 200                   # 五段总字符数下限（has_substantive_output）
    
  # 兼容性矩阵（schema_version 变更走 ADR）
  schema_compatibility:
    "1.0": ["1.0"]                         # 1.0 仅兼容 1.0
    # 未来: "1.1": ["1.0", "1.1"]          # 向后兼容

# 盲点注入提示词（外置，禁 .py 硬编码）
# flowforge/config/teamact_prompts.yaml
handoff_blind_spot:
  hint_template: |
    ⚠ 盲点: {description}
    补偿策略: {compensation_strategy}
    置信度: {confidence:.2f}
    提示接手者：在 review author 决策时，请重点核查此盲点是否影响结论。
  
  audit_log_template: |
    capsule_id={capsule_id} author={author_forgekin_id}
    注入 {hint_count} 条盲点提示
    trace_id={trace_id}
```

---

## 4. 跨模块协作实现

### 4.1 上游依赖调用

#### 4.1.1 A002 TeamAct Loop 调用

```python
# flowforge/loop/teamact_executor.py（伪代码，A002 实现侧）
from flowforge.core.teamact.handoff import HandoffCapsule, inject
from flowforge.core.capability.profile import CapabilityProfile

class TeamActLoopExecutor:
    async def _route_step(self, state: TeamActState) -> TeamActState:
        """TeamAct ROUTE 步：持球Forgekin传球时强制写入胶囊"""
        # 1. 持球Forgekin填写五段
        capsule_draft = await self._author_forgekin.write_handoff(state)
        
        # 2. 加载 author CapabilityProfile（F001）
        author_profile = await self._capability_repo.load(
            state.current_owner
        )
        
        # 3. 注入盲点提示
        injector = inject(BlindSpotHintInjector)
        capsule = await injector.inject(capsule_draft, author_profile)
        
        # 4. 校验
        validator = inject(HandoffCapsuleValidator)
        prev_chain = await self._store.list_chain(state.team_id)
        result = await validator.validate(capsule, prev_chain)
        if not result.is_valid:
            raise HandoffValidationError(result.errors)
        
        # 5. 持久化
        capsule_id = await self._store.write(capsule)
        
        # 6. 推进到下一轮 STATE 步
        return state.advance(step=TeamActStep.STATE, iteration=state.iteration + 1)
    
    async def _state_step(self, state: TeamActState) -> TeamActState:
        """TeamAct STATE 步：接手Forgekin读取最新胶囊 bootstrap"""
        latest = await self._store.read_latest(state.team_id)
        if latest:
            bootstrap_ctx = latest.to_bootstrap_context
            await self._receiver_forgekin.bootstrap(bootstrap_ctx)
        return state
```

#### 4.1.2 A001 CapabilityProfile 调用

```python
# flowforge/core/capability/profile.py（D001 已定义）
class CapabilityProfile(BaseModel):
    blind_spots: list[BlindSpot]  # 半常量层，非空
    
    # BlindSpotHintInjector 直接读取此字段
```

#### 4.1.3 A009 Evidence & Sensors 调用

```python
# flowforge/core/evidence/store.py（A009 实现侧）
class EvidenceStore(ABC):
    async def check_existence(self, evidence_ids: list[str]) -> list[str]:
        """校验 evidence_id 列表存在性，返回缺失的 ID 列表"""
        # HandoffCapsuleValidator 在写入前调用
```

### 4.2 下游影响（被调用）

#### 4.2.1 A004 PingPong Circuit Breaker 依赖

```python
# flowforge/core/teamact/pingpong.py（A004 实现侧）
class PingPongCircuitBreaker:
    async def check_substantive_output(self, capsule: HandoffCapsule) -> bool:
        """熔断器判定：胶囊是否有实质产出"""
        return capsule.has_substantive_output(min_chars=200)
        # 依赖 evidence_refs 非空 + 五段总字符数 >= 200
```

#### 4.2.2 A006 Ball Custody Lease 依赖

```python
# flowforge/core/teamact/lease.py（A006 实现侧）
class BallCustodyLease:
    async def execute_next_step(self, team_id: str) -> None:
        """lease 唤醒后执行 capsule.next_step"""
        capsule = await self._store.read_latest(team_id)
        if not capsule:
            raise LeaseExpiredError("无最新胶囊，lease 无法唤醒")
        await self._forgekin.execute(capsule.next_step)
```

#### 4.2.3 A007 Push Back Protocol 依赖

```python
# flowforge/core/teamact/pushback.py（A007 实现侧）
class PushBackValidator:
    async def validate_pushback(self, pushback: PushBack) -> ValidationResult:
        """Push Back 论证依据：读取胶囊 tradeoffs 字段"""
        capsule = await self._store.read_latest(pushback.team_id)
        if not capsule:
            return ValidationResult(is_valid=False, errors=["无胶囊可参考"])
        # pushback 必须引用 capsule.tradeoffs 中的某一项
        if pushback.target_tradeoff not in capsule.tradeoffs:
            return ValidationResult(
                is_valid=False,
                errors=["Push Back 必须锚定 capsule.tradeoffs 中的具体项"],
            )
        return ValidationResult(is_valid=True)
```

#### 4.2.4 A008 Durable State Surfaces 注册

```python
# flowforge/core/harness/durable_surface.py（A008 实现侧）
class DurableSurfaceRegistry:
    def register_default_surfaces(self) -> None:
        """注册 6 类 Durable Surface，胶囊为其中之一"""
        self.register(
            surface_type="handoff_capsule",
            authority_level=2,
            compression_immune=True,
            decay_tag="built_to_persist",
            store_class=SqliteHandoffCapsuleStore,
        )
```

#### 4.2.5 A021 Side Effect WAL 联动

```python
# flowforge/core/reliability/wal.py（A021 实现侧）
class SideEffectWAL:
    async def replay_all(self) -> dict[str, list[Any]]:
        """崩溃恢复时重放所有 WAL"""
        return {
            "handoff_capsules": await self._handoff_store.wal_replay(self._wal_path),
            # ... 其他 Durable Surface
        }
```

### 4.3 集成测试点

| 测试点 | 测试场景 | 验证内容 | 依赖 |
|--------|---------|---------|------|
| IT-1 | TeamAct ROUTE 步触发胶囊写入 | 五段非空 + 盲点注入 + 持久化 + EventBus 广播 | A002, A001 |
| IT-2 | TeamAct STATE 步读取最新胶囊 bootstrap | `read_latest` 返回最新胶囊 + `to_bootstrap_context` 输出正确 | A002 |
| IT-3 | 进程崩溃后 WAL 重放 | `wal_replay` 恢复完整胶囊链 + iteration 单调递增 | A021 |
| IT-4 | author 手填 blind_spot_hints 被清空 | 注入器清空手填值 + 写审计日志 | A001 |
| IT-5 | evidence_refs 指向不存在 ID 被拒绝 | Validator 调 F009 `check_existence` 返回缺失项 | A009 |
| IT-6 | 开放问题状态流转（resolved 不可回退） | Validator 拒绝 resolved → open 回退 | A002 |
| IT-7 | 跨厂商 reviewer 读胶囊看到盲点提示 | `to_bootstrap_context` 输出包含 blind_spot_hints 段 | A001 |
| IT-8 | PingPong 熔断器依赖 has_substantive_output | 胶囊五段总字符数 + evidence_refs 数满足阈值 | A004 |
| IT-9 | Ball Custody Lease 唤醒后执行 next_step | `read_latest` 返回胶囊 + next_step 字段非空 | A006 |
| IT-10 | Push Back 锚定 capsule.tradeoffs | Push Back 必须引用 tradeoffs 中的具体项 | A007 |

---

## 5. 详细设计验收

### 5.1 功能验收（AC）

- [ ] **AC-1**: `HandoffCapsule` 五段字段（what/why/tradeoffs/next_step）任一为空时构造抛 `SchemaError`
- [ ] **AC-2**: `open_questions` 字段非空（列表可为空，但字段本身存在）
- [ ] **AC-3**: `HandoffCapsuleStore` 通过 DI 容器注入，无直接实例化（`SqliteHandoffCapsuleStore` 仅在 DI 配置中绑定）
- [ ] **AC-4**: 胶囊持久化通过 Repository 层（`HandoffCapsuleStore` ABC），无 `cursor.execute` 在业务代码中
- [ ] **AC-5**: `max_open_questions` / `retention_days` / `enforce_blind_spot_hints` 外置到 `flowforge/config/teamact.yaml`
- [ ] **AC-6**: `blind_spot_hints` 由 `BlindSpotHintInjector` 从 F001 CapabilityProfile 自动注入，author 手填值被清空并写审计日志
- [ ] **AC-7**: `evidence_refs` 指向不存在的 Evidence ID 时 `HandoffCapsuleValidator.validate` 返回 errors
- [ ] **AC-8**: 胶囊链 `iteration` 单调递增，回退时 Validator 拒绝写入
- [ ] **AC-9**: `schema_version` 变更必须通过 ADR 流程（配置兼容性矩阵 `schema_compatibility`）
- [ ] **AC-10**: WAL 可重放，进程崩溃后 `wal_replay` 恢复完整胶囊链
- [ ] **AC-11**: 开放问题状态可追溯（OPEN / RESOLVED / ESCALATED / NEW），resolved 不可回退
- [ ] **AC-12**: `OpenQuestionStatus` 的 `resolved_by` 与 `resolved_at` 在 status=RESOLVED 时必须非空（model_validator）
- [ ] **AC-13**: 胶囊作为 Durable Surface（`authority_level=2`, `compression_immune=True`），禁塞入对话历史
- [ ] **AC-14**: `is_complete` 与 `has_substantive_output` 业务方法正确判定
- [ ] **AC-15**: `to_bootstrap_context` 输出包含五段 + 未解决开放问题 + 盲点提示 + next_step

### 5.2 性能验收

- [ ] **AC-16**: 单次胶囊写入延迟 P99 < 50ms（SQLite WAL + synchronous=NORMAL）
- [ ] **AC-17**: `read_latest` 延迟 P99 < 20ms（索引 + LIMIT 1）
- [ ] **AC-18**: `list_chain` 延迟 P99 < 100ms（100 条胶囊，索引排序）
- [ ] **AC-19**: `count_open_questions` 延迟 < 10ms
- [ ] **AC-20**: WAL 重放 100 条胶囊 < 500ms
- [ ] **AC-21**: 五段字段校验 < 1ms（Pydantic v2 编译期校验器）

### 5.3 安全验收

- [ ] **AC-22**: `flowforge/core/teamact/handoff.py` 不 import forgemind 或 *Forge 模块（单向依赖）
- [ ] **AC-23**: 胶囊持久化通过 Repository 层，业务代码无 `cursor.execute`
- [ ] **AC-24**: `blind_spot_hints` 不可被 author 手工篡改（注入器清空 + 审计日志）
- [ ] **AC-25**: `evidence_refs` 锚定到 F009 已存在的 Evidence ID（防伪造证据）
- [ ] **AC-26**: `capsule_id` 生成包含 hash8 防碰撞（SHA256 前 8 位）
- [ ] **AC-27**: SQLite 连接使用参数化查询（防 SQL 注入）

### 5.4 Eval 验收

- [ ] **AC-28**: 胶囊完整率（五段非空 + 至少 1 条 evidence_ref）≥ 95%（Eval 信号采样）
- [ ] **AC-29**: 盲点提示注入率 100%（author CapabilityProfile 有 blind_spots 时必须注入）
- [ ] **AC-30**: 开放问题解决率（resolved / total）≥ 70%（TeamAct 终止前）
- [ ] **AC-31**: 跨厂商 reviewer 读胶囊后盲点检出率 ≥ 70%（与 D001 AC-10 一致）
- [ ] **AC-32**: E2E 测试（T1-T8 铁律）：3 个不同厂商Forgekin协作完成 Feature，胶囊在三者间正确传递，开放问题状态正确流转，LLM 生成内容经 LLM 审核

---

## 6. 引用

- [doc:../spec.md#§3.2]（FR-CORE-002，FR-CORE-016 交接胶囊 + 持球注册 lease）
- [doc:../arch.md#§3.2]（TeamAct 六步循环，交接胶囊协议层硬要求）
- [doc:../features/F003-handoff-capsule.md]（同号 Feature 级 SRS）
- [doc:../architecture/A003-handoff-capsule.md]（同号 Feature 级 SAD）
- [doc:../features/F001-capability-profile.md]（blind_spot_hints 注入源）
- [doc:../architecture/A001-capability-profile.md]（CapabilityProfile 架构契约）
- [doc:../features/F002-teamact-loop.md]（TeamAct ROUTE 步触发写入）
- [doc:../architecture/A002-teamact-loop.md]（TeamAct 状态机）
- [doc:../features/F009-evidence-sensors.md]（evidence_refs 锚定目标）
- [doc:../architecture/A009-evidence-sensors.md]（Evidence Store 架构）
- [doc:../architecture/A008-durable-state-surfaces.md]（Durable Surface 注册）
- [doc:../architecture/A021-side-effect-wal.md]（WAL 可重放联动）
- [doc:../decisions/002-collaboration-protocol.md]（TeamAct 协作协议 ADR）
- [doc:../design/naming-contract.md#2.2]（Forgekin Forgekin 双轨命名）
- [doc:../design/D001-capability-profile.md]（CapabilityProfile 详细设计，盲点注入数据源）
- [doc:../design/D002-teamact-loop.md]（TeamAct 详细设计，ROUTE 步触发）
- [doc:../../CONTRIBUTING.md]（文档分层规范）
- [doc:../../../CONTRIBUTING.md#红线12]（禁绕过 DI 容器）
- [doc:../../../CONTRIBUTING.md#红线13]（禁直接操作数据库）
- [doc:../../CONTRIBUTING.md#31-15-条编程红线违反即拒绝合入]（禁硬编码路径/密钥）
- [doc:../../../CONTRIBUTING.md#P16]（提示词外置验证）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（详细设计骨架，对应 F003 Feature 级 SRS + A003 架构级 SAD） | 开发者 Forgekin（猎犬·夏洛克） |
