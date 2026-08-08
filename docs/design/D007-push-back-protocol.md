# D007: Generator Push Back 详细设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 开发者 Forgekin（猎犬·夏洛克）
> **对应 spec.md**: [doc:../spec.md#§3.2] / [doc:../spec.md#§3.7]
> **对应 arch.md**: [doc:../arch.md#§3.2] / [doc:../arch.md#§3.7]
> **对应 design.md**: [doc:../design.md#§3.2] / [doc:../design.md#§3.7]
> **对应 Feature**: [doc:../features/F007-push-back-protocol.md]
> **对应 Architecture**: [doc:../architecture/A007-push-back-protocol.md]
> **依赖 ADR**: [doc:../decisions/007-harness-engineering.md]

---

## 1. 详细设计上下文

### 1.1 设计问题

A007 架构层定义了 Push Back 双向辩论协议的骨架，本详细设计需要回答下列"如何落地"问题：

1. **D-Q1**：PushBack 三要素（`evidence_refs` + `applicability_argument` + `alternative_proposal`）如何在 Pydantic 模型层强制非空，并在缺一项时拒绝写入？
2. **D-Q2**：DebateChain 辩论链如何用 SQLite + WAL 持久化，保证"最多 3 轮，超限自动升级 CVO"在进程崩溃后仍可重放？
3. **D-Q3**：reviewer 拒绝 Push Back 时如何强制"不可 silently dismiss"——必须给出反驳证据或承认 author 的 alternative_proposal？
4. **D-Q4**：超时（默认 10 分钟）未回应 Push Back 如何自动升级 CVO，且升级前最后写一条"超时事件"审计记录？
5. **D-Q5**：author 提交"无证据 Push Back"（`evidence_refs=[]`）时如何反向计入 CapabilityProfile 的"坏直觉"画像，触发 E2 降级？
6. **D-Q6**：DebateChain 第 3 轮仍未收敛时，升级 CVO 仲裁的接口契约与证据打包格式？
7. **D-Q7**：Push Back 与 TeamAct VERDICT 步如何对齐——VERDICT 给 blocking 后由 author 选择 accept 或 push back？

### 1.2 设计约束

| 编号 | 约束 | 来源 |
|------|------|------|
| C1 | `flowforge/core/harness/push_back.py` 不可 import forgemind 或 *Forge 模块 | 单向依赖 |
| C2 | PushBackValidator / DebateOrchestrator 通过 `@inject` 装饰器构造函数注入，禁直接 `PushBackValidator` | DI 容器 |
| C3 | PushBack / ReviewerResponse / DebateChain 通过 Repository 持久化，禁 `cursor.execute` | Repository 层 |
| C4 | `push_back.yaml` 外置三要素校验规则、辩论轮次上限、超时阈值 | 配置驱动 |
| C5 | PushBack 三要素任一为空 → 拒绝写入并抛 `InvalidPushBackError` | A007 决策 1 |
| C6 | reviewer 不可 silently dismiss：必须 `accept_alternative` 或给出 `counter_evidence_refs` | A007 决策 3 |
| C7 | 辩论链最多 3 轮，第 4 轮尝试写入 → 抛 `DebateChainExhausted` 并升级 CVO | A007 决策 4 |
| C8 | 超时阈值默认 600 秒，到期自动升级 CVO，超时事件写入 audit log | A007 决策 5 |
| C9 | 无证据 Push Back（`evidence_refs=[]`）→ 写入 CapabilityProfile "bad_intuition" 信号 | A007 决策 6 |
| C10 | 所有 Push Back / Response 记录走 WAL，进程崩溃可重放 | F021 联动 |
| C12 | 觉醒阶标注：E1-E3 进化阶Forgekin可发起 Push Back；E4+ 觉醒阶Forgekin发起 Push Back 时强制经MindCouncil 二次确认 | naming-contract.md §4 |

### 1.3 设计影响

| 编号 | 影响 | 关联模块 |
|------|------|---------|
| I1 | Push Back 接收 TeamAct VERDICT 步产出的 `blocking` 裁决作为触发输入 | D002 / A002 |
| I2 | Push Back `evidence_refs` 必须锚定到 D009 Evidence Store 已存在的 `evidence_id` | D009 / A009 |
| I3 | Push Back 持久化到 D008 Durable Surface 的 `thread_trace`（authority_level=2） | D008 / A008 |
| I4 | 无证据 Push Back 反向写入 D001 CapabilityProfile 的 `bad_intuition` 字段，触发 Wilson score 下界下降 | D001 / A001 |
| I5 | 超时升级 CVO 时通过 D005 RoutingDispatcher 发送 `@cvo escalate` 指令 | D005 / A005 |
| I6 | DebateChain 收敛后回写 TeamAct ROUTE 步决定下一步持球者 | D002 / A002 |
| I7 | D011 Magic Words "星星罐子" 触发会强制中断 DebateChain（任意轮次） | D011 / A011 |

---

## 2. 详细设计

### 2.1 类图

```
┌──────────────────────────────────────────────────────────────────────┐
│                       flowforge/core/harness/push_back.py            │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  «enum» PushBackOutcome                                              │
│    + ACCEPTED                                                        │
│    + COUNTERED                                                       │
│    + ESCALATED_CVO                                                   │
│    + TIMEOUT_ESCALATED                                               │
│                                                                      │
│  «enum» ReviewerResponseType                                         │
│    + ACCEPT_ALTERNATIVE                                              │
│    + COUNTER_WITH_EVIDENCE                                           │
│    + CONCEDE                                                         │
│                                                                      │
│  «Pydantic» PushBack                                                 │
│    + push_back_id: str                                               │
│    + verdict_id: str                                                 │
│    + author_forgekin_id: str                                         │
│    + evidence_refs: list[str]  (>=1)                                 │
│    + applicability_argument: str  (non-empty)                        │
│    + alternative_proposal: str  (non-empty)                          │
│    + submitted_at: datetime                                          │
│    + awakening_stage: Literal["E1","E2","E3","E4","E5","E6"]         │
│    + schema_version: str = "v1"                                      │
│    + wal_lsn: int = 0                                                │
│    + decay_tag: DecayTag = BUILT_TO_PERSIST                          │
│    + authority_level: int = 2                                        │
│    + compression_immune: bool = False                                │
│                                                                      │
│  «Pydantic» ReviewerResponse                                         │
│    + response_id: str                                                │
│    + push_back_id: str                                               │
│    + reviewer_forgekin_id: str                                       │
│    + response_type: ReviewerResponseType                             │
│    + counter_evidence_refs: list[str]  (>=1 当 type=COUNTER)         │
│    + rationale: str  (non-empty)                                     │
│    + responded_at: datetime                                          │
│    + schema_version: str = "v1"                                      │
│    + wal_lsn: int = 0                                                │
│                                                                      │
│  «Pydantic» DebateChain                                              │
│    + chain_id: str                                                   │
│    + verdict_id: str                                                 │
│    + rounds: list[DebateRound]                                       │
│    + status: ChainStatus                                             │
│    + max_rounds: int = 3                                             │
│    + created_at: datetime                                            │
│    + resolved_at: Optional[datetime]                                 │
│    + resolution: Optional[PushBackOutcome]                           │
│                                                                      │
│  «Pydantic» DebateRound                                              │
│    + round_index: int  (1-based)                                     │
│    + push_back: PushBack                                             │
│    + response: Optional[ReviewerResponse]                            │
│                                                                      │
│  «ABC» PushBackStore                                                 │
│    + save(pb) -> str                                                 │
│    + save_response(resp) -> str                                      │
│    + load_chain(verdict_id) -> Optional[DebateChain]                 │
│    + list_pending_overdue(now, timeout_s) -> list[PushBack]          │
│                                                                      │
│  «ABC» PushBackValidator                                             │
│    + validate(pb) -> ValidationResult                                │
│    + validate_response(resp, pb) -> ValidationResult                 │
│                                                                      │
│  «ABC» DebateOrchestrator                                            │
│    + submit_push_back(pb) -> ChainStatus                             │
│    + submit_response(resp) -> ChainStatus                            │
│    + check_timeouts(now) -> list[PushBack]                           │
│                                                                      │
│  «ABC» BadIntuitionSink                                              │
│    + record_bad_intuition(forgekin_id, push_back_id) -> None         │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│            infra/repo/sqlite_push_back_store.py                      │
│  «implements PushBackStore» SqlitePushBackStore                      │
│    - _conn: aiosqlite.Connection                                     │
│    + async save(pb) -> str                                           │
│    + async save_response(resp) -> str                                │
│    + async load_chain(verdict_id) -> Optional[DebateChain]           │
│    + async list_pending_overdue(now, timeout_s) -> list[PushBack]    │
│    + async checkpoint -> None                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.2 接口与 Pydantic 模型

```python
# flowforge/core/harness/push_back.py
from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from flowforge.core.plugin.di_container import inject
from flowforge.core.harness.decay_tag import DecayTag


# ───────────────────────────── 枚举 ─────────────────────────────

class PushBackOutcome(str, Enum):
    """辩论链收敛结果"""
    ACCEPTED = "accepted"                     # reviewer 接受 alternative
    COUNTERED = "countered"                   # author 被 counter 后 concede
    ESCALATED_CVO = "escalated_cvo"           # 3 轮未收敛升级 CVO
    TIMEOUT_ESCALATED = "timeout_escalated"   # 超时未回应升级 CVO


class ReviewerResponseType(str, Enum):
    """reviewer 回应类型（禁止 silently dismiss）"""
    ACCEPT_ALTERNATIVE = "accept_alternative"     # 接受 author 替代方案
    COUNTER_WITH_EVIDENCE = "counter_with_evidence"  # 带反驳证据反击
    CONCEDE = "concede"                           # 承认 author 正确


class ChainStatus(str, Enum):
    """辩论链状态机"""
    AWAITING_RESPONSE = "awaiting_response"   # author 已提交, 等 reviewer
    AWAITING_PUSH_BACK = "awaiting_push_back"  # reviewer 已 counter, 等 author
    RESOLVED = "resolved"
    ESCALATED = "escalated"


# ───────────────────────────── 异常 ─────────────────────────────

class PushBackError(Exception):
    """Push Back 协议基础异常"""


class InvalidPushBackError(PushBackError):
    """三要素缺失或格式非法"""


class EvidenceAnchorNotFoundError(PushBackError):
    """evidence_refs 锚定的 evidence_id 在 D009 Evidence Store 中不存在"""


class SilentlyDismissError(PushBackError):
    """reviewer 试图 silently dismiss（既不 accept 也不 counter）"""


class DebateChainExhausted(PushBackError):
    """辩论链已达 3 轮上限，第 4 轮尝试被拒绝"""


class PushBackTimeoutError(PushBackError):
    """Push Back 超时未回应"""


# ───────────────────────────── Pydantic 模型 ─────────────────────────────

class PushBack(BaseModel):
    """author 发起的 Push Back（三要素强制非空）"""

    push_back_id: str = Field(..., min_length=1)
    verdict_id: str = Field(..., min_length=1)
    author_forgekin_id: str = Field(..., min_length=1)
    evidence_refs: list[str] = Field(..., min_length=1)
    applicability_argument: str = Field(..., min_length=1)
    alternative_proposal: str = Field(..., min_length=1)
    submitted_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    awakening_stage: Literal["E1", "E2", "E3", "E4", "E5", "E6"] = "E2"
    schema_version: str = Field(default="v1")
    wal_lsn: int = Field(default=0, ge=0)
    decay_tag: DecayTag = Field(default=DecayTag.BUILT_TO_PERSIST)
    authority_level: int = Field(default=2, ge=1, le=5)
    compression_immune: bool = Field(default=False)

    @field_validator("applicability_argument", "alternative_proposal")
    @classmethod
    def _non_empty_text(cls, v: str) -> str:
        if not v or not v.strip:
            raise ValueError("Push Back 文本字段不可为空")
        return v.strip

    @model_validator(mode="after")
    def _evidence_refs_non_empty(self) -> "PushBack":
        if not self.evidence_refs:
            raise InvalidPushBackError("evidence_refs 不可为空（无证据 Push Back 走 BadIntuitionSink 路径）")
        return self


class ReviewerResponse(BaseModel):
    """reviewer 对 Push Back 的回应（禁 silently dismiss）"""

    response_id: str = Field(..., min_length=1)
    push_back_id: str = Field(..., min_length=1)
    reviewer_forgekin_id: str = Field(..., min_length=1)
    response_type: ReviewerResponseType
    counter_evidence_refs: list[str] = Field(default_factory=list)
    rationale: str = Field(..., min_length=1)
    responded_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    schema_version: str = Field(default="v1")
    wal_lsn: int = Field(default=0, ge=0)

    @field_validator("rationale")
    @classmethod
    def _rationale_non_empty(cls, v: str) -> str:
        if not v or not v.strip:
            raise ValueError("ReviewerResponse rationale 不可为空（禁 silently dismiss）")
        return v.strip

    @model_validator(mode="after")
    def _counter_must_have_evidence(self) -> "ReviewerResponse":
        if self.response_type == ReviewerResponseType.COUNTER_WITH_EVIDENCE:
            if not self.counter_evidence_refs:
                raise SilentlyDismissError(
                    "COUNTER_WITH_EVIDENCE 必须给出 counter_evidence_refs，不可 silently dismiss"
                )
        return self


class DebateRound(BaseModel):
    """单轮辩论（push_back + 可选 response）"""
    round_index: int = Field(..., ge=1, le=3)
    push_back: PushBack
    response: Optional[ReviewerResponse] = None


class DebateChain(BaseModel):
    """辩论链（最多 3 轮）"""
    chain_id: str = Field(..., min_length=1)
    verdict_id: str = Field(..., min_length=1)
    rounds: list[DebateRound] = Field(default_factory=list)
    status: ChainStatus = Field(default=ChainStatus.AWAITING_RESPONSE)
    max_rounds: int = Field(default=3, ge=1, le=3)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    resolved_at: Optional[datetime] = None
    resolution: Optional[PushBackOutcome] = None

    @model_validator(mode="after")
    def _round_count_within_limit(self) -> "DebateChain":
        if len(self.rounds) > self.max_rounds:
            raise DebateChainExhausted(
                f"辩论链已达 {self.max_rounds} 轮上限，第 {len(self.rounds)} 轮尝试被拒绝"
            )
        return self


class ValidationResult(BaseModel):
    """校验结果"""
    ok: bool
    errors: list[str] = Field(default_factory=list)
```

### 2.3 抽象基类（ABC）

```python
# flowforge/core/harness/push_back.py（续）

class PushBackStore(ABC):
    """Push Back / Response 持久化仓储"""

    @abstractmethod
    async def save(self, pb: PushBack) -> str:
        """保存 PushBack, 返回 push_back_id（WAL 写入）"""

    @abstractmethod
    async def save_response(self, resp: ReviewerResponse) -> str:
        """保存 ReviewerResponse, 返回 response_id（WAL 写入）"""

    @abstractmethod
    async def load_chain(self, verdict_id: str) -> Optional[DebateChain]:
        """按 verdict_id 装载完整辩论链"""

    @abstractmethod
    async def list_pending_overdue(
        self, now: datetime, timeout_seconds: int
    ) -> list[PushBack]:
        """列出超时未回应的 Push Back（供 DebateOrchestrator 轮询）"""

    @abstractmethod
    async def update_chain_status(
        self, chain_id: str, status: ChainStatus,
        resolution: Optional[PushBackOutcome] = None,
    ) -> None:
        """更新辩论链状态机"""


class PushBackValidator(ABC):
    """Push Back 三要素 + evidence_refs 锚定校验"""

    @abstractmethod
    async def validate(self, pb: PushBack) -> ValidationResult:
        """校验 PushBack
        架构契约:
        - 三要素（evidence_refs / applicability_argument / alternative_proposal）非空
        - evidence_refs 每个 id 必须在 D009 Evidence Store 中存在
        - E4+ 觉醒阶需附 MindCouncil 二次确认 token
        """

    @abstractmethod
    async def validate_response(
        self, resp: ReviewerResponse, pb: PushBack
    ) -> ValidationResult:
        """校验 ReviewerResponse
        架构契约:
        - reviewer_forgekin_id != pb.author_forgekin_id（禁自审）
        - COUNTER_WITH_EVIDENCE 必须有 counter_evidence_refs
        - counter_evidence_refs 每个 id 必须在 D009 Evidence Store 中存在
        """


class DebateOrchestrator(ABC):
    """辩论链编排器（核心状态机）"""

    @abstractmethod
    async def submit_push_back(self, pb: PushBack) -> ChainStatus:
        """author 提交 Push Back
        架构契约:
        - 首轮: 创建新 DebateChain
        - 后续轮: 检查 max_rounds, 超限抛 DebateChainExhausted
        - E4+ 觉醒阶强制 MindCouncil 二次确认
        - 无证据 Push Back 走 BadIntuitionSink, 不进入链
        """

    @abstractmethod
    async def submit_response(self, resp: ReviewerResponse) -> ChainStatus:
        """reviewer 提交回应
        架构契约:
        - ACCEPT_ALTERNATIVE → 链收敛 (resolution=ACCEPTED)
        - CONCEDE → 链收敛 (resolution=ACCEPTED)
        - COUNTER_WITH_EVIDENCE → 链继续, 等待 author 下一轮
        - 第 3 轮后仍 COUNTER → 升级 CVO (resolution=ESCALATED_CVO)
        """

    @abstractmethod
    async def check_timeouts(self, now: datetime) -> list[PushBack]:
        """扫描超时 Push Back
        架构契约:
        - 默认 600s 未回应 → 升级 CVO
        - 升级前写一条 TIMEOUT_ESCALATED 审计事件
        - 返回超时列表供 D005 RoutingDispatcher 发 @cvo escalate
        """


class BadIntuitionSink(ABC):
    """坏直觉画像写入器（无证据 Push Back 反向计入）"""

    @abstractmethod
    async def record_bad_intuition(
        self, forgekin_id: str, push_back_id: str, reason: str
    ) -> None:
        """写入 CapabilityProfile.bad_intuition 信号
        架构契约:
        - 触发 Wilson score 下界下降
        - 累计 3 次 → 触发 E2 → E1 降级评估
        - 写入 D008 thread_trace (authority_level=2)
        """
```

### 2.4 默认实现

```python
# flowforge/core/harness/push_back.py（续）

class DefaultPushBackValidator(PushBackValidator):
    """三要素 + evidence 锚定 + 自审拒绝 校验器"""

    @inject
    def __init__(self, *, evidence_store, capability_repo) -> None:
        self._evidence_store = evidence_store
        self._capability_repo = capability_repo

    async def validate(self, pb: PushBack) -> ValidationResult:
        errors: list[str] = []

        # 1. evidence_refs 锚定校验
        for ev_id in pb.evidence_refs:
            exists = await self._evidence_store.verify(ev_id)
            if not exists:
                errors.append(
                    f"evidence_ref '{ev_id}' 在 D009 Evidence Store 中不存在"
                )

        # 2. E4+ 觉醒阶需 MindCouncil 二次确认
        if pb.awakening_stage in ("E4", "E5", "E6"):
            # MindCouncil token 由 D018 注入, 此处仅检查存在性
            if not getattr(pb, "_mind_council_token", None):
                errors.append(
                    f"觉醒阶 {pb.awakening_stage} Push Back 需 MindCouncil 二次确认 token"
                )

        # 3. 无证据 Push Back 走 BadIntuitionSink（不应到此分支）
        if not pb.evidence_refs:
            errors.append("无证据 Push Back 应走 BadIntuitionSink, 不进入辩论链")

        return ValidationResult(ok=(not errors), errors=errors)

    async def validate_response(
        self, resp: ReviewerResponse, pb: PushBack
    ) -> ValidationResult:
        errors: list[str] = []

        # 1. 禁自审
        if resp.reviewer_forgekin_id == pb.author_forgekin_id:
            errors.append(
                "reviewer_forgekin_id 不可等于 author_forgekin_id（禁自审）"
            )

        # 2. COUNTER_WITH_EVIDENCE 必须有 counter_evidence_refs（Pydantic 已校验非空，
        #    这里校验每个 id 在 D009 中存在）
        if resp.response_type == ReviewerResponseType.COUNTER_WITH_EVIDENCE:
            for ev_id in resp.counter_evidence_refs:
                exists = await self._evidence_store.verify(ev_id)
                if not exists:
                    errors.append(
                        f"counter_evidence_ref '{ev_id}' 在 D009 Evidence Store 中不存在"
                    )
        return ValidationResult(ok=(not errors), errors=errors)


class DefaultDebateOrchestrator(DebateOrchestrator):
    """辩论链状态机编排器"""

    @inject
    def __init__(
        self, *,
        store: PushBackStore,
        validator: PushBackValidator,
        bad_intuition_sink: BadIntuitionSink,
        routing_dispatcher,        # D005 RoutingDispatcher
        event_bus,
        eval_signal_writer,
        timeout_seconds: int = 600,
        max_rounds: int = 3,
    ) -> None:
        self._store = store
        self._validator = validator
        self._bad_intuition_sink = bad_intuition_sink
        self._routing_dispatcher = routing_dispatcher
        self._event_bus = event_bus
        self._eval_signal_writer = eval_signal_writer
        self._timeout_seconds = timeout_seconds
        self._max_rounds = max_rounds

    async def submit_push_back(self, pb: PushBack) -> ChainStatus:
        # 无证据 Push Back 反向计入坏直觉画像
        if not pb.evidence_refs:
            await self._bad_intuition_sink.record_bad_intuition(
                forgekin_id=pb.author_forgekin_id,
                push_back_id=pb.push_back_id,
                reason="evidence_refs 为空, 触发坏直觉信号",
            )
            await self._event_bus.publish_async(
                "push_back.bad_intuition",
                {"forgekin_id": pb.author_forgekin_id, "push_back_id": pb.push_back_id},
            )
            return ChainStatus.RESOLVED  # 不进入链

        # 三要素 + 锚定校验
        result = await self._validator.validate(pb)
        if not result.ok:
            raise InvalidPushBackError(
                f"PushBack 校验失败: {result.errors}"
            )

        chain = await self._store.load_chain(pb.verdict_id)
        if chain is None:
            # 首轮：创建新链
            chain = DebateChain(
                chain_id=f"chain-{pb.verdict_id}",
                verdict_id=pb.verdict_id,
                rounds=[DebateRound(round_index=1, push_back=pb)],
                status=ChainStatus.AWAITING_RESPONSE,
                max_rounds=self._max_rounds,
            )
        else:
            # 后续轮：检查上限
            next_index = len(chain.rounds) + 1
            if next_index > self._max_rounds:
                raise DebateChainExhausted(
                    f"verdict_id={pb.verdict_id} 辩论链已达 {self._max_rounds} 轮上限"
                )
            chain.rounds.append(DebateRound(round_index=next_index, push_back=pb))
            chain.status = ChainStatus.AWAITING_RESPONSE

        await self._store.save(pb)
        await self._store.update_chain_status(
            chain.chain_id, chain.status, chain.resolution
        )
        await self._event_bus.publish_async(
            "push_back.submitted",
            {
                "push_back_id": pb.push_back_id,
                "verdict_id": pb.verdict_id,
                "author_forgekin_id": pb.author_forgekin_id,
                "round": len(chain.rounds),
            },
        )
        self._eval_signal_writer.write_trace(
            signal_type="push_back_submitted",
            payload={"round": len(chain.rounds), "verdict_id": pb.verdict_id},
        )
        return chain.status

    async def submit_response(self, resp: ReviewerResponse) -> ChainStatus:
        chain = await self._store._load_chain_by_push_back(resp.push_back_id)
        if chain is None:
            raise PushBackError(f"PushBack {resp.push_back_id} 无对应 DebateChain")

        current_round = chain.rounds[-1]
        if current_round.response is not None:
            raise PushBackError(
                f"round {current_round.round_index} 已有 response, 不可重复提交"
            )

        # 校验
        result = await self._validator.validate_response(resp, current_round.push_back)
        if not result.ok:
            raise SilentlyDismissError(f"Response 校验失败: {result.errors}")

        current_round.response = resp
        await self._store.save_response(resp)

        # 决定链去向
        if resp.response_type in (
            ReviewerResponseType.ACCEPT_ALTERNATIVE,
            ReviewerResponseType.CONCEDE,
        ):
            chain.status = ChainStatus.RESOLVED
            chain.resolution = PushBackOutcome.ACCEPTED
            chain.resolved_at = datetime.now(timezone.utc)
        elif resp.response_type == ReviewerResponseType.COUNTER_WITH_EVIDENCE:
            if len(chain.rounds) >= self._max_rounds:
                # 第 3 轮仍 COUNTER → 升级 CVO
                chain.status = ChainStatus.ESCALATED
                chain.resolution = PushBackOutcome.ESCALATED_CVO
                chain.resolved_at = datetime.now(timezone.utc)
                await self._escalate_to_cvo(chain, reason="3 轮未收敛")
            else:
                chain.status = ChainStatus.AWAITING_PUSH_BACK

        await self._store.update_chain_status(
            chain.chain_id, chain.status, chain.resolution
        )
        await self._event_bus.publish_async(
            "push_back.responded",
            {"response_id": resp.response_id, "status": chain.status.value},
        )
        return chain.status

    async def check_timeouts(self, now: datetime) -> list[PushBack]:
        overdue = await self._store.list_pending_overdue(
            now, self._timeout_seconds
        )
        for pb in overdue:
            chain = await self._store._load_chain_by_push_back(pb.push_back_id)
            if chain is None or chain.status != ChainStatus.AWAITING_RESPONSE:
                continue
            chain.status = ChainStatus.ESCALATED
            chain.resolution = PushBackOutcome.TIMEOUT_ESCALATED
            chain.resolved_at = now
            await self._store.update_chain_status(
                chain.chain_id, chain.status, chain.resolution
            )
            await self._escalate_to_cvo(chain, reason=f"超时 {self._timeout_seconds}s 未回应")
        return overdue

    async def _escalate_to_cvo(self, chain: DebateChain, reason: str) -> None:
        """通过 D005 RoutingDispatcher 发 @cvo escalate"""
        await self._routing_dispatcher.dispatch_to_cvo(
            verdict_id=chain.verdict_id,
            chain_id=chain.chain_id,
            reason=reason,
            evidence_pack=self._package_evidence(chain),
        )
        self._eval_signal_writer.write_trace(
            signal_type="push_back_escalated_cvo",
            payload={"chain_id": chain.chain_id, "reason": reason},
        )

    @staticmethod
    def _package_evidence(chain: DebateChain) -> dict:
        """打包辩论链全部证据供 CVO 仲裁"""
        return {
            "chain_id": chain.chain_id,
            "verdict_id": chain.verdict_id,
            "rounds": [
                {
                    "round_index": r.round_index,
                    "push_back_id": r.push_back.push_back_id,
                    "author": r.push_back.author_forgekin_id,
                    "evidence_refs": r.push_back.evidence_refs,
                    "alternative_proposal": r.push_back.alternative_proposal,
                    "response_type": r.response.response_type.value if r.response else None,
                    "counter_evidence_refs": r.response.counter_evidence_refs if r.response else [],
                }
                for r in chain.rounds
            ],
        }


class DefaultBadIntuitionSink(BadIntuitionSink):
    """坏直觉画像写入器"""

    @inject
    def __init__(self, *, capability_repo, thread_trace_store, event_bus) -> None:
        self._capability_repo = capability_repo
        self._thread_trace_store = thread_trace_store
        self._event_bus = event_bus

    async def record_bad_intuition(
        self, forgekin_id: str, push_back_id: str, reason: str
    ) -> None:
        # 1. 写入 CapabilityProfile.bad_intuition
        await self._capability_repo.append_bad_intuition(
            forgekin_id=forgekin_id,
            signal={"push_back_id": push_back_id, "reason": reason, "ts": datetime.now(timezone.utc).isoformat},
        )
        # 2. 写入 D008 thread_trace (authority_level=2)
        await self._thread_trace_store.append_surface(
            surface_type="thread_trace",
            payload={
                "event": "bad_intuition",
                "forgekin_id": forgekin_id,
                "push_back_id": push_back_id,
                "reason": reason,
            },
            authority_level=2,
            compression_immune=False,
        )
        # 3. 检查是否累计 3 次 → 触发降级评估
        count = await self._capability_repo.count_bad_intuition(forgekin_id)
        if count >= 3:
            await self._event_bus.publish_async(
                "capability.degradation_required",
                {"forgekin_id": forgekin_id, "bad_intuition_count": count},
            )
```

### 2.5 关键算法伪代码

**算法 1：Push Back 提交流程**

```
function submit_push_back(pb: PushBack) -> ChainStatus:
    if pb.evidence_refs is empty:
        bad_intuition_sink.record_bad_intuition(pb.author, pb.id, "no_evidence")
        return RESOLVED  # 不进入链

    validation_result = validator.validate(pb)
    if not validation_result.ok:
        raise InvalidPushBackError(validation_result.errors)

    chain = store.load_chain(pb.verdict_id)
    if chain is None:
        chain = new DebateChain(rounds=[Round(1, pb)], status=AWAITING_RESPONSE)
    else:
        next_index = len(chain.rounds) + 1
        if next_index > max_rounds:
            raise DebateChainExhausted
        chain.rounds.append(Round(next_index, pb))
        chain.status = AWAITING_RESPONSE

    store.save(pb)
    store.update_chain_status(chain)
    event_bus.publish("push_back.submitted", {...})
    eval_signal_writer.write_trace(...)
    return chain.status
```

**算法 2：Reviewer 回应流程**

```
function submit_response(resp: ReviewerResponse) -> ChainStatus:
    chain = store.load_chain_by_push_back(resp.push_back_id)
    if chain is None: raise PushBackError
    current_round = chain.rounds.last
    if current_round.response is not None: raise PushBackError

    result = validator.validate_response(resp, current_round.push_back)
    if not result.ok: raise SilentlyDismissError(result.errors)

    current_round.response = resp
    store.save_response(resp)

    if resp.type in (ACCEPT_ALTERNATIVE, CONCEDE):
        chain.status = RESOLVED
        chain.resolution = ACCEPTED
    elif resp.type == COUNTER_WITH_EVIDENCE:
        if len(chain.rounds) >= max_rounds:
            chain.status = ESCALATED
            chain.resolution = ESCALATED_CVO
            escalate_to_cvo(chain, "3 轮未收敛")
        else:
            chain.status = AWAITING_PUSH_BACK

    store.update_chain_status(chain)
    event_bus.publish("push_back.responded", {...})
    return chain.status
```

**算法 3：超时扫描循环**

```
async function timeout_scan_loop:
    while True:
        try:
            await asyncio.sleep(60)  # 每分钟扫描一次
            now = datetime.now(UTC)
            overdue = orchestrator.check_timeouts(now)
            for pb in overdue:
                logger.warning(f"PushBack {pb.id} 超时升级 CVO")
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"timeout_scan_loop error: {e}")
            await asyncio.sleep(5)
```

**算法 4：Wilson score 下界下降（D001 联动）**

```
function compute_bad_intuition_penalty(forgekin_id) -> float:
    count = capability_repo.count_bad_intuition(forgekin_id)
    # 每次坏直觉扣 0.05, 累计 3 次触发降级评估
    penalty = count * 0.05
    return min(penalty, 0.15)  # 上限 0.15
```

---

## 3. 模块实现

### 3.1 SQLite WAL 持久化实现

```python
# flowforge/infra/repo/sqlite_push_back_store.py
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Optional

import aiosqlite

from flowforge.core.harness.push_back import (
    ChainStatus, DebateChain, DebateRound, PushBack, PushBackOutcome,
    PushBackStore, ReviewerResponse,
)


class SqlitePushBackStore(PushBackStore):
    """SQLite + WAL 实现 Push Back 持久化"""

    DDL = """
    CREATE TABLE IF NOT EXISTS push_backs (
        push_back_id TEXT PRIMARY KEY,
        verdict_id TEXT NOT NULL,
        author_forgekin_id TEXT NOT NULL,
        evidence_refs_json TEXT NOT NULL,
        applicability_argument TEXT NOT NULL,
        alternative_proposal TEXT NOT NULL,
        submitted_at TEXT NOT NULL,
        awakening_stage TEXT NOT NULL,
        schema_version TEXT NOT NULL DEFAULT 'v1',
        wal_lsn INTEGER NOT NULL DEFAULT 0,
        decay_tag TEXT NOT NULL DEFAULT 'BUILT_TO_PERSIST',
        authority_level INTEGER NOT NULL DEFAULT 2,
        compression_immune INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS reviewer_responses (
        response_id TEXT PRIMARY KEY,
        push_back_id TEXT NOT NULL,
        reviewer_forgekin_id TEXT NOT NULL,
        response_type TEXT NOT NULL,
        counter_evidence_refs_json TEXT NOT NULL DEFAULT '[]',
        rationale TEXT NOT NULL,
        responded_at TEXT NOT NULL,
        schema_version TEXT NOT NULL DEFAULT 'v1',
        wal_lsn INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (push_back_id) REFERENCES push_backs(push_back_id)
    );

    CREATE TABLE IF NOT EXISTS debate_chains (
        chain_id TEXT PRIMARY KEY,
        verdict_id TEXT NOT NULL,
        status TEXT NOT NULL,
        max_rounds INTEGER NOT NULL DEFAULT 3,
        created_at TEXT NOT NULL,
        resolved_at TEXT,
        resolution TEXT
    );

    CREATE TABLE IF NOT EXISTS chain_rounds (
        chain_id TEXT NOT NULL,
        round_index INTEGER NOT NULL,
        push_back_id TEXT NOT NULL,
        response_id TEXT,
        PRIMARY KEY (chain_id, round_index),
        FOREIGN KEY (chain_id) REFERENCES debate_chains(chain_id),
        FOREIGN KEY (push_back_id) REFERENCES push_backs(push_back_id),
        FOREIGN KEY (response_id) REFERENCES reviewer_responses(response_id)
    );

    CREATE INDEX IF NOT EXISTS idx_pb_verdict ON push_backs(verdict_id);
    CREATE INDEX IF NOT EXISTS idx_pb_submitted_at ON push_backs(submitted_at);
    CREATE INDEX IF NOT EXISTS idx_resp_push_back ON reviewer_responses(push_back_id);
    CREATE INDEX IF NOT EXISTS idx_chain_verdict ON debate_chains(verdict_id);
    CREATE INDEX IF NOT EXISTS idx_rounds_chain ON chain_rounds(chain_id);
    """

    def __init__(self, db_path: str) -> None:
        self._db_path = db_path
        self._conn: Optional[aiosqlite.Connection] = None

    async def _ensure_conn(self) -> aiosqlite.Connection:
        if self._conn is None:
            self._conn = await aiosqlite.connect(self._db_path)
            await self._conn.execute("PRAGMA journal_mode=WAL")
            await self._conn.execute("PRAGMA synchronous=NORMAL")
            await self._conn.execute("PRAGMA foreign_keys=ON")
            await self._conn.executescript(self.DDL)
            await self._conn.commit
        return self._conn

    async def save(self, pb: PushBack) -> str:
        conn = await self._ensure_conn
        if not pb.push_back_id:
            pb.push_back_id = f"pb-{uuid.uuid4.hex[:12]}"
        await conn.execute(
            """
            INSERT INTO push_backs
                (push_back_id, verdict_id, author_forgekin_id, evidence_refs_json,
                 applicability_argument, alternative_proposal, submitted_at,
                 awakening_stage, schema_version, wal_lsn, decay_tag,
                 authority_level, compression_immune)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                pb.push_back_id, pb.verdict_id, pb.author_forgekin_id,
                json.dumps(pb.evidence_refs),
                pb.applicability_argument, pb.alternative_proposal,
                pb.submitted_at.isoformat,
                pb.awakening_stage, pb.schema_version, pb.wal_lsn,
                pb.decay_tag.value, pb.authority_level,
                int(pb.compression_immune),
            ),
        )
        await conn.commit
        await self._checkpoint_if_needed
        return pb.push_back_id

    async def save_response(self, resp: ReviewerResponse) -> str:
        conn = await self._ensure_conn
        if not resp.response_id:
            resp.response_id = f"resp-{uuid.uuid4.hex[:12]}"
        await conn.execute(
            """
            INSERT INTO reviewer_responses
                (response_id, push_back_id, reviewer_forgekin_id, response_type,
                 counter_evidence_refs_json, rationale, responded_at,
                 schema_version, wal_lsn)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                resp.response_id, resp.push_back_id, resp.reviewer_forgekin_id,
                resp.response_type.value,
                json.dumps(resp.counter_evidence_refs),
                resp.rationale, resp.responded_at.isoformat,
                resp.schema_version, resp.wal_lsn,
            ),
        )
        await conn.commit
        return resp.response_id

    async def load_chain(self, verdict_id: str) -> Optional[DebateChain]:
        conn = await self._ensure_conn
        async with conn.execute(
            "SELECT chain_id, status, max_rounds, created_at, resolved_at, resolution "
            "FROM debate_chains WHERE verdict_id = ?",
            (verdict_id,),
        ) as cur:
            row = await cur.fetchone
        if row is None:
            return None
        chain_id, status, max_rounds, created_at, resolved_at, resolution = row
        rounds = await self._load_rounds(chain_id)
        return DebateChain(
            chain_id=chain_id,
            verdict_id=verdict_id,
            rounds=rounds,
            status=ChainStatus(status),
            max_rounds=max_rounds,
            created_at=datetime.fromisoformat(created_at),
            resolved_at=datetime.fromisoformat(resolved_at) if resolved_at else None,
            resolution=PushBackOutcome(resolution) if resolution else None,
        )

    async def _load_rounds(self, chain_id: str) -> list[DebateRound]:
        conn = await self._ensure_conn
        async with conn.execute(
            "SELECT round_index, push_back_id, response_id FROM chain_rounds "
            "WHERE chain_id = ? ORDER BY round_index",
            (chain_id,),
        ) as cur:
            rows = await cur.fetchall
        rounds: list[DebateRound] = []
        for round_index, pb_id, resp_id in rows:
            pb = await self._load_push_back(pb_id)
            resp = await self._load_response(resp_id) if resp_id else None
            rounds.append(DebateRound(round_index=round_index, push_back=pb, response=resp))
        return rounds

    async def _load_push_back(self, pb_id: str) -> PushBack:
        conn = await self._ensure_conn
        async with conn.execute(
            "SELECT * FROM push_backs WHERE push_back_id = ?",
            (pb_id,),
        ) as cur:
            row = await cur.fetchone
        # 行 → PushBack 反序列化（略，参考 _load_response）
        ...

    async def _load_response(self, resp_id: str) -> Optional[ReviewerResponse]:
        conn = await self._ensure_conn
        async with conn.execute(
            "SELECT * FROM reviewer_responses WHERE response_id = ?",
            (resp_id,),
        ) as cur:
            row = await cur.fetchone
        if row is None:
            return None
        # 反序列化（略）
        ...

    async def list_pending_overdue(
        self, now: datetime, timeout_seconds: int
    ) -> list[PushBack]:
        """列出超时未回应的 Push Back

        策略：找最近一轮无 response 且 submitted_at + timeout < now 的 PushBack
        """
        conn = await self._ensure_conn
        cutoff = (now.timestamp) - timeout_seconds
        async with conn.execute(
            """
            SELECT pb.* FROM push_backs pb
            WHERE NOT EXISTS (
                SELECT 1 FROM reviewer_responses r WHERE r.push_back_id = pb.push_back_id
            )
            AND strftime('%s', pb.submitted_at) < ?
            """,
            (cutoff,),
        ) as cur:
            rows = await cur.fetchall
        return [await self._load_push_back(row[0]) for row in rows]

    async def update_chain_status(
        self, chain_id: str, status: ChainStatus,
        resolution: Optional[PushBackOutcome] = None,
    ) -> None:
        conn = await self._ensure_conn
        resolved_at = datetime.now(timezone.utc).isoformat if status in (
            ChainStatus.RESOLVED, ChainStatus.ESCALATED
        ) else None
        await conn.execute(
            "UPDATE debate_chains SET status = ?, resolved_at = ?, resolution = ? "
            "WHERE chain_id = ?",
            (status.value, resolved_at,
             resolution.value if resolution else None, chain_id),
        )
        await conn.commit

    async def _load_chain_by_push_back(self, push_back_id: str) -> Optional[DebateChain]:
        conn = await self._ensure_conn
        async with conn.execute(
            "SELECT chain_id FROM chain_rounds WHERE push_back_id = ?",
            (push_back_id,),
        ) as cur:
            row = await cur.fetchone
        if row is None:
            return None
        async with conn.execute(
            "SELECT verdict_id FROM debate_chains WHERE chain_id = ?",
            (row[0],),
        ) as cur:
            vrow = await cur.fetchone
        if vrow is None:
            return None
        return await self.load_chain(vrow[0])

    async def _checkpoint_if_needed(self) -> None:
        """定期 PRAGMA wal_checkpoint(FULL) 防 WAL 文件膨胀"""
        conn = await self._ensure_conn
        await conn.execute("PRAGMA wal_checkpoint(FULL)")

    async def checkpoint(self) -> None:
        await self._checkpoint_if_needed
```

### 3.2 关键时序图

**时序图 1：标准 Push Back → 接受 alternative**

```
author           Validator       Orchestrator     Store          D009          D005
  │                  │                │             │              │              │
  │ submit_push_back │                │             │              │              │
  ├─────────────────>│                │             │              │              │
  │                  │ validate(pb)   │             │              │              │
  │                  │  evidence_refs─┤             │              │              │
  │                  │                ├────────────>│ verify(ev_id)│              │
  │                  │                │             │ <────────────│              │
  │                  │ <──────────────┤             │              │              │
  │ <────────────────┤ ok             │             │              │              │
  │                  │                │             │              │              │
  │                  │                │ save(pb)    │              │              │
  │                  │                ├────────────>│              │              │
  │                  │                │ <───────────┤              │              │
  │                  │                │ publish_async("push_back.submitted")      │
  │ <────────────────────────────────────────────────────────────────────────────│
  │                  │                │             │              │              │
  │                  │ reviewer submits ACCEPT_ALTERNATIVE response │              │
  │ submit_response  │                │             │              │              │
  ├─────────────────>│                │             │              │              │
  │                  │ validate_response(resp, pb)  │              │              │
  │                  │  reviewer != author?         │              │              │
  │                  │ <────────────────────────────│              │              │
  │                  │ ok             │             │              │              │
  │                  │                │ save_response(resp)        │              │
  │                  │                ├────────────>│              │              │
  │                  │                │ chain.status = RESOLVED    │              │
  │                  │                │ update_chain_status       │              │
  │                  │                ├────────────>│              │              │
  │                  │                │ publish_async("push_back.responded")     │
  │ <────────────────────────────────────────────────────────────────────────────│
  │                                                                 resolution=ACCEPTED
```

**时序图 2：3 轮未收敛 → 升级 CVO**

```
Round 1: author PB → reviewer COUNTER (with evidence)
Round 2: author PB → reviewer COUNTER (with evidence)
Round 3: author PB → reviewer COUNTER (with evidence)
                                                          │
                                                          ▼
                                orchestrator.submit_response(resp_round3)
                                                          │
                                       len(chain.rounds) >= max_rounds (3)
                                                          │
                                                          ▼
                                chain.status = ESCALATED
                                chain.resolution = ESCALATED_CVO
                                                          │
                                                          ▼
                                _escalate_to_cvo(chain, "3 轮未收敛")
                                                          │
                                                          ▼
                                routing_dispatcher.dispatch_to_cvo(
                                  verdict_id, chain_id, reason, evidence_pack
                                )
                                                          │
                                                          ▼
                                            D005 @cvo escalate 路由生效
```

### 3.3 错误处理策略

| # | 异常 / 场景 | 处理策略 | 用户可见行为 |
|---|------------|---------|-------------|
| E1 | `InvalidPushBackError` 三要素缺失 | 拒绝写入, 返回 422 + 错误详情 | author 看到"Push Back 校验失败: [...]" |
| E2 | `EvidenceAnchorNotFoundError` evidence_id 在 D009 不存在 | 拒绝写入, 提示先采集证据 | author 看到"evidence_ref 'xxx' 不存在" |
| E3 | `SilentlyDismissError` reviewer 试图 silently dismiss | 拒绝写入 response, 强制要求 counter_evidence_refs | reviewer 看到"COUNTER_WITH_EVIDENCE 必须给出 counter_evidence_refs" |
| E4 | `DebateChainExhausted` 第 4 轮尝试 | 拒绝写入, 自动升级 CVO | author 看到"辩论链已达 3 轮上限, 升级 CVO 仲裁" |
| E5 | `PushBackTimeoutError` 超时 | 升级 CVO, 写入 TIMEOUT_ESCALATED 审计 | reviewer 收到"@cvo escalate (timeout)" |
| E6 | `aiosqlite.OperationalError` DB 锁 | 指数退避重试 3 次, 仍失败抛出 | 服务返回 503 |
| E7 | `aiosqlite.IntegrityError` 外键冲突 | 不重试, 抛出 | 服务返回 500 + 错误日志 |
| E8 | E4+ 觉醒阶 Push Back 缺 MindCouncil token | 拒绝写入, 提示二次确认 | author 看到"觉醒阶 E4+ 需 MindCouncil 二次确认" |
| E9 | `event_bus.publish_async` 失败 | 不阻塞主流程, 仅记录 warning | 用户无感知, 监控告警 |
| E10 | `eval_signal_writer.write_trace` 失败 | 不阻塞主流程, 仅记录 warning | Eval 数据可能缺失, 监控告警 |
| E11 | `routing_dispatcher.dispatch_to_cvo` 失败 | 重试 3 次, 仍失败抛出 + audit log | CVO 未收到升级, 监控告警 |
| E12 | `capability_repo.append_bad_intuition` 失败 | 不阻塞 Push Back 主流程, 仅 warning | 坏直觉未记录, 监控告警 |

### 3.4 性能指标与优化

| # | 指标 | 目标 | 优化手段 |
|---|------|------|---------|
| P1 | Push Back 提交延迟 | P99 < 100ms | WAL + NORMAL 同步, 异步 event_bus |
| P2 | Response 提交延迟 | P99 < 100ms | 同 P1 |
| P3 | load_chain 延迟 | P99 < 50ms | chain_rounds 索引 + 单次查询 |
| P4 | 超时扫描一轮 | < 500ms (1000 条 pending) | 列表查询走 idx_pb_submitted_at |
| P5 | WAL checkpoint 频率 | 每 100 次写入或 5 分钟 | _checkpoint_if_needed 节流 |
| P6 | EventBus publish 延迟 | < 5ms | 异步发布, 不阻塞主流程 |
| P7 | Eval 信号写入延迟 | < 5ms | 内存 buffer + 批量 flush |
| P8 | 单 DebateChain 最大内存占用 | < 10KB | rounds 上限 3 轮, 每轮 Pydantic 模型 < 3KB |
| P9 | 并发 Push Back 提交吞吐 | > 100 QPS | aiosqlite 连接池 + WAL 并发读 |

### 3.5 YAML 配置示例

```yaml
# flowforge/config/push_back.yaml
push_back:
  # 三要素校验
  required_elements:
    - evidence_refs
    - applicability_argument
    - alternative_proposal

  # 辩论链配置
  debate_chain:
    max_rounds: 3                    # 最多 3 轮, A007 决策 4
    timeout_seconds: 600             # 默认 10 分钟, A007 决策 5
    timeout_scan_interval_seconds: 60  # 超时扫描间隔

  # 觉醒阶约束 (naming-contract.md §4)
  awakening_stage_constraints:
    E1: allow_push_back              # 进化阶: 直接允许
    E2: allow_push_back
    E3: allow_push_back
    E4: require_mind_council_token   # 觉醒阶: 需 MindCouncil 二次确认
    E5: require_mind_council_token
    E6: require_mind_council_token

  # reviewer 回应类型白名单
  allowed_response_types:
    - accept_alternative
    - counter_with_evidence
    - concede
  forbidden_response_types:
    - silently_dismiss              # 禁 silently dismiss, A007 决策 3
    - defer
    - "再看看"

  # 坏直觉画像阈值
  bad_intuition:
    penalty_per_occurrence: 0.05    # 每次扣 0.05
    degradation_threshold: 3        # 累计 3 次触发降级评估
    max_penalty: 0.15               # 单只Forgekin上限 0.15

  # 升级路径
  escalation:
    target: cvo                     # 升级到 CVO
    reason_3_rounds: "3 轮未收敛"
    reason_timeout: "超时 {timeout}s 未回应"
```

---

## 4. 跨模块协作实现

### 4.1 上游调用：D002 TeamAct VERDICT 步触发 Push Back

```python
# flowforge/loop/executor.py（片段）
class TeamActLoopExecutor:
    @inject
    def __init__(self, *, verdict_validator, push_back_orchestrator, ...) -> None:
        self._verdict_validator = verdict_validator
        self._push_back_orchestrator = push_back_orchestrator
        ...

    async def _execute_verdict_step(self, state: TeamActState) -> TeamActState:
        verdict = await self._produce_verdict(state)
        if verdict.decision == "blocking":
            # author 可选择 accept 或 push back
            choice = await self._ask_author_choice(state.owner)
            if choice == "accept":
                return state.with_status("blocked")
            elif choice == "push_back":
                pb = await self._build_push_back(state, verdict)
                chain_status = await self._push_back_orchestrator.submit_push_back(pb)
                return state.with_push_back_initiated(verdict.verdict_id, chain_status)
        return state.with_verdict(verdict)
```

### 4.2 上游调用：D009 Evidence Store 提供 evidence_refs 锚定

```python
# flowforge/core/harness/evidence.py（片段, D009）
class EvidenceCollector:
    async def collect(self, etype, forgekin_id, payload) -> str:
        evidence_id = await self._store.save(...)
        return evidence_id

# Push Back validator 调用
class DefaultPushBackValidator:
    async def validate(self, pb: PushBack) -> ValidationResult:
        for ev_id in pb.evidence_refs:
            if not await self._evidence_store.verify(ev_id):
                errors.append(f"evidence_ref '{ev_id}' 不存在")
        ...
```

### 4.3 下游影响：D001 CapabilityProfile 接收坏直觉信号

```python
# flowforge/core/harness/capability.py（片段, D001）
class CapabilityRepository:
    async def append_bad_intuition(self, forgekin_id: str, signal: dict) -> None:
        """写入 bad_intuition 信号, 影响 Wilson score 下界"""
        ...

    async def count_bad_intuition(self, forgekin_id: str) -> int:
        """统计坏直觉次数, 累计 3 次触发降级评估"""
        ...
```

### 4.4 下游影响：D005 RoutingDispatcher 接收 @cvo escalate

```python
# flowforge/core/harness/at_mention.py（片段, D005）
class DefaultRoutingDispatcher:
    async def dispatch_to_cvo(
        self, verdict_id: str, chain_id: str, reason: str, evidence_pack: dict
    ) -> None:
        """升级到 CVO 仲裁, 写入 audit log"""
        directive = RoutingDirective(
            target="@cvo",
            intent=RoutingIntent.ESCALATE,
            context={
                "verdict_id": verdict_id,
                "chain_id": chain_id,
                "reason": reason,
                "evidence_pack": evidence_pack,
            },
        )
        await self.dispatch(directive)
```

### 4.5 下游影响：D008 thread_trace 持久化

```python
# flowforge/infra/repo/sqlite_thread_trace.py（片段, D008）
class SqliteThreadTraceStore:
    async def append_surface(
        self, surface_type: str, payload: dict,
        authority_level: int, compression_immune: bool,
    ) -> None:
        """写入 thread_trace, Push Back 事件 authority_level=2"""
        ...
```

### 4.6 下游影响：D011 Magic Words 中断辩论链

```python
# flowforge/core/harness/magic_words.py（片段, D011）
class MagicWordsExecutor:
    async def execute(self, word, context, operator_id) -> ActionResult:
        if word == MagicWord.STAR_JAR:
            # 强制中断所有进行中的 DebateChain
            await self._debate_orchestrator.cancel_all_pending(reason="star_jar_triggered")
            await self.emergency_stop(...)
```

### 4.7 集成测试点

| # | 测试点 | 验证内容 | 关联 AC |
|---|--------|---------|---------|
| T1 | Push Back 三要素任一为空 → 拒绝写入 | InvalidPushBackError 抛出 | AC-F2 |
| T2 | evidence_refs 锚定的 evidence_id 在 D009 不存在 → 拒绝 | EvidenceAnchorNotFoundError | AC-F3 |
| T3 | reviewer COUNTER_WITH_EVIDENCE 无 counter_evidence_refs → 拒绝 | SilentlyDismissError | AC-F6 |
| T4 | reviewer == author → 拒绝写入 response | SilentlyDismissError | AC-F7 |
| T5 | 第 4 轮尝试 → DebateChainExhausted + 升级 CVO | chain.status = ESCALATED | AC-F8 |
| T6 | 超时 600s 未回应 → 自动升级 CVO | resolution = TIMEOUT_ESCALATED | AC-F9 |
| T7 | 无证据 Push Back → 写入 bad_intuition 信号 | capability_repo 收到信号 | AC-F10 |
| T8 | 累计 3 次坏直觉 → 触发降级评估 | event_bus 收到 "capability.degradation_required" | AC-F11 |
| T9 | E4+ 觉醒阶 Push Back 缺 MindCouncil token → 拒绝 | InvalidPushBackError | AC-F12 |
| T10 | reviewer ACCEPT_ALTERNATIVE → chain 收敛 | resolution = ACCEPTED | AC-F4 |
| T11 | reviewer CONCEDE → chain 收敛 | resolution = ACCEPTED | AC-F5 |
| T12 | WAL 写入后进程崩溃 → 重启可恢复 chain | load_chain 返回完整数据 | AC-P3 |
| T13 | "星星罐子" 触发 → 中断所有进行中 chain | cancel_all_pending 调用 | AC-F13 |

---

## 5. 详细设计验收

### 5.1 功能验收（Functional AC）

| AC | 描述 |
|----|------|
| AC-F1 | PushBack Pydantic 模型三要素任一为空时模型构造失败 |
| AC-F2 | `submit_push_back` 对三要素缺失的 pb 抛 InvalidPushBackError |
| AC-F3 | `validate` 校验 evidence_refs 每个 id 在 D009 Evidence Store 存在 |
| AC-F4 | reviewer 提交 ACCEPT_ALTERNATIVE → chain.status = RESOLVED, resolution = ACCEPTED |
| AC-F5 | reviewer 提交 CONCEDE → chain.status = RESOLVED, resolution = ACCEPTED |
| AC-F6 | reviewer 提交 COUNTER_WITH_EVIDENCE 但 counter_evidence_refs 为空 → SilentlyDismissError |
| AC-F7 | reviewer_forgekin_id == author_forgekin_id → SilentlyDismissError（禁自审） |
| AC-F8 | 第 4 轮 push_back 提交 → DebateChainExhausted + 自动升级 CVO |
| AC-F9 | Push Back 提交后 600s 未回应 → 自动升级 CVO + 写 TIMEOUT_ESCALATED 审计 |
| AC-F10 | 无证据 Push Back（evidence_refs=[]）→ 写入 BadIntuitionSink, 不进入链 |
| AC-F11 | 累计 3 次坏直觉 → event_bus 发布 "capability.degradation_required" |
| AC-F12 | E4+ 觉醒阶 Push Back 缺 MindCouncil token → 拒绝写入 |
| AC-F13 | "星星罐子" 触发 → 所有进行中 chain 被中断 |
| AC-F14 | CVO 升级时 evidence_pack 包含全部 rounds 的 evidence_refs 与 alternative_proposal |
| AC-F15 | `load_chain` 按 verdict_id 返回完整辩论链（含 rounds + responses） |
| AC-F16 | `update_chain_status` 正确更新 status / resolved_at / resolution |
| AC-F17 | `list_pending_overdue` 正确列出超时未回应的 PushBack |
| AC-F18 | EventBus publish_async 失败不阻塞主流程 |

### 5.2 性能验收（Performance AC）

| AC | 描述 |
|----|------|
| AC-P1 | Push Back 提交 P99 延迟 < 100ms |
| AC-P2 | Response 提交 P99 延迟 < 100ms |
| AC-P3 | WAL 写入后进程崩溃, 重启后 `load_chain` 可恢复完整数据 |
| AC-P4 | 超时扫描 1000 条 pending 用时 < 500ms |
| AC-P5 | WAL checkpoint 每 100 次写入或 5 分钟触发一次 |
| AC-P6 | 并发 Push Back 提交吞吐 > 100 QPS |

### 5.3 安全验收（Security AC）

| AC | 描述 |
|----|------|
| AC-S1 | `flowforge/core/harness/push_back.py` 不 import forgemind 或 *Forge 模块 |
| AC-S2 | PushBackValidator / DebateOrchestrator 通过 `@inject` 注入, 无直接实例化 |
| AC-S3 | 所有 DB 操作通过 Repository, 无 `cursor.execute` |
| AC-S4 | 禁自审（reviewer != author）强制生效 |
| AC-S5 | E4+ 觉醒阶强制 MindCouncil 二次确认, 防止高自主Forgekin滥用 Push Back |
| AC-S6 | 升级 CVO 的事件写入 audit log, 禁删除 |

### 5.4 Eval 验收（Eval AC）

| AC | 描述 |
|----|------|
| AC-E1 | 每次 Push Back 提交写 eval_signal "push_back_submitted" |
| AC-E2 | 每次 Response 提交写 eval_signal "push_back.responded" |
| AC-E3 | 每次 CVO 升级写 eval_signal "push_back_escalated_cvo" |
| AC-E4 | 每次坏直觉写入写 eval_signal "push_back.bad_intuition" |
| AC-E5 | DebateChain 收敛率（accepted vs escalated）作为 F040 控制面指标 |

---

## 6. 引用

- [doc:../spec.md#§3.2]（FR-CORE-003, FR-CORE-007 Push Back 协议）
- [doc:../spec.md#§3.7]（Push Back 双向辩论协议详细要求）
- [doc:../arch.md#§3.2]（Harness 七层现实表面, L3 Evidence & Push Back）
- [doc:../arch.md#§3.7]（Push Back 协议架构）
- [doc:../features/F007-push-back-protocol.md]（同号 Feature 级 SRS）
- [doc:../architecture/A007-push-back-protocol.md]（架构权威源）
- [doc:../architecture/A002-teamact-loop.md]（VERDICT 步触发 Push Back）
- [doc:../architecture/A009-evidence-sensors.md]（evidence_refs 锚定）
- [doc:../architecture/A001-capability-profile.md]（坏直觉画像）
- [doc:../architecture/A005-at-mention-routing.md]（@cvo escalate 路由）
- [doc:../architecture/A008-durable-state-surfaces.md]（thread_trace 持久化）
- [doc:../architecture/A011-magic-words.md]（星星罐子中断辩论链）
- [doc:../architecture/A021-side-effect-wal.md]（WAL 可重放）
- [doc:../decisions/007-harness-engineering.md]（Harness 工程路径 ADR）
- [doc:../decisions/009-eval-self-metabolism.md]（Eval 自代谢联动）
- [doc:../../CONTRIBUTING.md]（文档分层规范）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（详细设计骨架, 对应 F007 / A007） | 开发者 Forgekin（猎犬·夏洛克） |
