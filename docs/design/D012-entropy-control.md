# D012: Entropy Control 退役详细设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 开发者 Forgekin（猎犬·夏洛克）
> **对应 spec.md**: [doc:../spec.md#§3.3]
> **对应 arch.md**: [doc:../arch.md#§3.3]
> **对应 design.md**: [doc:../design.md#§3.3]
> **对应 Feature**: [doc:../features/F012-entropy-control.md]
> **对应 Architecture**: [doc:../architecture/A012-entropy-control.md]
> **依赖 ADR**: [doc:../decisions/007-harness-engineering.md]

---

## 1. 详细设计上下文

### 1.1 设计问题

A012 架构层定义了"自动 tag + 14 天 sunset + 三选一裁决 + 升级 CVO + 退役信号"骨架，本详细设计需要回答下列"如何落地"问题：

1. **D-Q1**：commit message 含 `[hotfix]` 标记如何在 Pydantic 模型层精确识别（防止 `[HOTFIX]`/`[ Hotfix ]` 大小写/空白变体遗漏）？
2. **D-Q2**：`HotfixTagger.tag` 如何在 commit 提交钩子内同步打 tag + 启动 14 天计时，并保证 `sunset_review_due >= merged_at + 14 天` 不变量？
3. **D-Q3**：`SunsetScheduler` 如何基于 APScheduler 调度两周强制 review 任务，并分配给非作者Forgekin（跨厂商 review 配对）？
4. **D-Q4**：`EntropyReviewGate.validate` 如何对 decision 字段做三选一硬约束（formal_fix/permanent/no_longer_relevant），同时拒绝"再看看"/"defer"/"later" 等同义词？
5. **D-Q5**：reviewer_forgekin_id != commit.forgekin_id 禁自审如何在 Pydantic model_validator 层校验？
6. **D-Q6**：到期未 review 如何自动升级 CVO（overdue_escalation），保证不阻塞主流程？
7. **D-Q7**：no_longer_relevant 决策如何写入 D018 Eval Contract 退役信号 + 触发 D040 控制面 sunset review？

### 1.2 设计约束

| 编号 | 约束 | 来源 |
|------|------|------|
| C1 | `flowforge/core/harness/entropy.py` 不可 import forgemind 或 *Forge 模块 | 单向依赖 |
| C2 | HotfixTagger / SunsetScheduler / EntropyReviewGate 通过 `@inject` 注入 | DI 容器 |
| C3 | HotfixTag / EntropyReviewVerdict 通过 Repository 持久化到 D008 Durable Surface（git + thread_trace） | Repository 层 |
| C4 | sunset_days / allowed_decisions / forbidden_decisions / overdue_escalation 配置外置到 `flowforge/config/harness.yaml` | 配置驱动 |
| C5 | commit message 含 `[hotfix]` 标记自动打 tag + 启动 14 天计时 | A012 决策 1 |
| C6 | 两周强制 review，三选一硬约束（禁"再看看"/"defer"/"later"） | A012 决策 2 |
| C7 | reviewer_forgekin_id != commit.forgekin_id（禁自审） | A012 决策 3 |
| C8 | 到期未 review 自动升级 CVO | A012 决策 4 |
| C9 | no_longer_relevant 决策写入 D018 退役信号 + 触发 D040 控制面 sunset review | A012 决策 5 |
| C10 | 已失效 guardrail 可降级为 default，触发 sunset review | A012 决策 6 |
| C11 | sunset_review_due = merged_at + sunset_days（默认 14 天，可配置但不可少于 14 天） | A012 不变量 |
| C12 | forbidden_decisions 必须包含 [再看看, defer, later] | A012 不变量 |
| C13 | HotfixTag 走 D021 Side Effect WAL 可重放，进程崩溃可恢复 | A012 跨模块不变量 |
| C15 | 觉醒阶标注：E1-E3 进化阶直接允许；E4-E6 觉醒阶 sunset review 需 MindCouncil 二次确认 | naming-contract.md §4 |

### 1.3 设计影响

| 编号 | 影响对象 | 影响描述 |
|------|---------|---------|
| I1 | D002 TeamAct Loop | Entropy Review 作为 TeamAct "清理 ROUTE" 分支挂入 ACTION 步 |
| I2 | D008 Durable State Surfaces | HotfixTag 持久化到 git + thread_trace 双 surface，权威等级分层 |
| I3 | D010 Governance Boundary | 已失效 guardrail 可降级为 default，触发 sunset review |
| I4 | D018 Eval Contract | no_longer_relevant 决策写入退役信号（Eval 自代谢输入） |
| I5 | D021 Side Effect WAL | HotfixTag 写入走 WAL，进程崩溃后可重放到 pending_review 状态 |
| I6 | D040 Harness Eval 控制面 | sunset review 信号写入控制面，识别"哪块机制正在折旧" |
| I7 | CVO | 到期未 review 自动升级 CVO 仲裁，CVO 路由分发器需支持 entropy_overdue 通道 |

---

## 2. 详细设计

### 2.1 类图

```
┌─────────────────────────────────────────────────────────────────────┐
│                  flowforge/core/harness/entropy.py                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────────────┐    ┌──────────────────────────────────┐  │
│  │ <<enumeration>>      │    │ <<enumeration>>                  │  │
│  │  HotfixStatus        │    │  EntropyDecision                 │  │
│  +----------------------┤    +----------------------------------+│  │
│  │ PENDING_REVIEW       │    │ FORMAL_FIX                       │  │
│  │ FORMAL_FIX           │    │ PERMANENT                        │  │
│  │ PERMANENT            │    │ NO_LONGER_RELEVANT               │  │
│  │ NO_LONGER_RELEVANT   │    +----------------------------------+│  │
│  +----------------------+                                            │  │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ <<Pydantic>> HotfixTag                                       │   │
│  +--------------------------------------------------------------+   │
│  │ tag_id: str                                                  │   │
│  │ commit_sha: str                                              │   │
│  │ forgekin_id: str                                             │   │
│  │ commit_message: str                                          │   │
│  │ merged_at: datetime                                          │   │
│  │ sunset_review_due: datetime   (>= merged_at + sunset_days)   │   │
│  │ status: HotfixStatus = PENDING_REVIEW                        │   │
│  │ wal_lsn: int                                                 │   │
│  │ schema_version: str = "v1"                                   │   │
│  +--------------------------------------------------------------+   │
│  │ +model_validator: _due_must_be_after_merge                   │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ <<Pydantic>> EntropyReviewVerdict                            │   │
│  +--------------------------------------------------------------+   │
│  │ verdict_id: str                                              │   │
│  │ hotfix_tag_id: str                                           │   │
│  │ reviewer_forgekin_id: str                                    │   │
│  │ decision: EntropyDecision                                    │   │
│  │ rationale: str (min_length=1)                                │   │
│  │ reviewed_at: datetime                                        │   │
│  │ evidence_refs: list[str]                                     │   │
│  └──────────────────────────────────────────────────────────────┘   │
│  │ +model_validator: _reviewer_not_author                       │   │
│  │ +model_validator: _rationale_must_not_be_empty               │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────────────────────────────┐  ┌────────────────────────┐  │
│  │ <<ABC>> HotfixTagger             │  │ <<ABC>> SunsetScheduler│  │
│  +----------------------------------+  +------------------------+  │
│  │ +tag(commit_sha, forgekin_id,    │  │ +schedule_review(      │  │
│  │   commit_message) -> str         │  │   hotfix_tag_id)       │  │
│  │ +list_pending -> list[HotfixTag│  │ +list_overdue        │  │
│  │ +get_tag(tag_id) -> HotfixTag    │  │   -> list[HotfixTag]   │  │
│  └──────────────────────────────────┘  │ +cancel(tag_id)        │  │
│             △                          └────────────────────────┘  │
│             │                                     △                 │
│             │ implements                          │ implements      │
│             ▼                                     ▼                 │
│  ┌──────────────────────────────────┐  ┌────────────────────────┐  │
│  │ DefaultHotfixTagger              │  │ APSchedulerSunset      │  │
│  +----------------------------------+  │ Scheduler              │  │
│  │ -_store: EntropyStore            │  +------------------------+  │
│  │ -_marker: str = "[hotfix]"       │  │ -_scheduler: AsyncIO   │  │
│  │ -_sunset_days: int = 14          │  │ -_store: EntropyStore  │  │
│  │ -_event_bus: EventBus            │  │ -_forgekin_pairer: ... │  │
│  │ -_wal: SideEffectWAL             │  │ -_overdue_threshold    │  │
│  +----------------------------------+  └────────────────────────┘  │
│                                                                     │
│  ┌──────────────────────────────────┐  ┌────────────────────────┐  │
│  │ <<ABC>> EntropyReviewGate        │  │ <<ABC>> EntropyStore   │  │
│  +----------------------------------+  +------------------------+  │
│  │ +validate(verdict, hotfix_tag)   │  │ +save_tag(tag)         │  │
│  │   -> ValidationResult            │  │ +load_tag(tag_id)      │  │
│  │ +apply_verdict(verdict, tag)     │  │ +list_pending        │  │
│  │   -> HotfixStatus                │  │ +list_overdue        │  │
│  │ +escalate_to_cvo(tag)            │  │ +save_verdict(v)       │  │
│  └──────────────────────────────────┘  │ +checkpoint          │  │
│             △                          └────────────────────────┘  │
│             │ implements                          △                 │
│             ▼                                     │ implements      │
│  ┌──────────────────────────────────┐             ▼                 │
│  │ DefaultEntropyReviewGate         │  ┌────────────────────────┐  │
│  +----------------------------------+  │ SqliteEntropyStore     │  │
│  │ -_allowed_decisions: set         │  │ (WAL, D008 Durable)    │  │
│  │ -_forbidden_decisions: set       │  └────────────────────────┘  │
│  │ -_forgekin_pairer                │                              │
│  │ -_eval_signal_writer             │                              │
│  │ -_routing_dispatcher             │                              │
│  └──────────────────────────────────┘                              │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 接口契约

```python
# flowforge/core/harness/entropy.py
from __future__ import annotations
from abc import ABC, abstractmethod
from datetime import datetime, timedelta
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field, field_validator, model_validator


class HotfixStatus(str, Enum):
    """hotfix 标记状态机

    状态转换:
        PENDING_REVIEW -> FORMAL_FIX       (升级正式修复)
        PENDING_REVIEW -> PERMANENT         (接受永久方案)
        PENDING_REVIEW -> NO_LONGER_RELEVANT (已不再相关)
        * (任何 FORMAL_FIX/PERMANENT/NO_LONGER_RELEVANT) 为终态, 不可逆
    """
    PENDING_REVIEW = "pending_review"
    FORMAL_FIX = "formal_fix"
    PERMANENT = "permanent"
    NO_LONGER_RELEVANT = "no_longer_relevant"


class EntropyDecision(str, Enum):
    """三选一裁决 (硬约束: 禁第四项"再看看")"""
    FORMAL_FIX = "formal_fix"
    PERMANENT = "permanent"
    NO_LONGER_RELEVANT = "no_longer_relevant"


class HotfixTag(BaseModel):
    """hotfix 标记

    不变量:
        - sunset_review_due >= merged_at + sunset_days (默认 14 天)
        - status 流转不可逆 (终态后不可改回 pending_review)
        - WAL 可重放 (wal_lsn 单调递增)
    """
    tag_id: str = Field(..., min_length=1)
    commit_sha: str = Field(..., min_length=1)
    forgekin_id: str = Field(..., min_length=1)
    commit_message: str = Field(..., min_length=1)
    merged_at: datetime
    sunset_review_due: datetime
    status: HotfixStatus = HotfixStatus.PENDING_REVIEW
    wal_lsn: int = Field(default=0, ge=0)
    schema_version: str = Field(default="v1")

    model_config = {"extra": "forbid"}

    @model_validator(mode="after")
    def _due_must_be_after_merge(self) -> "HotfixTag":
        # sunset_review_due 至少为 merged_at + 14 天 (与配置层 sunset_days 校验由 Tagger 保证)
        if self.sunset_review_due < self.merged_at + timedelta(days=14):
            raise ValueError(
                "sunset_review_due 必须 >= merged_at + 14 天 (sunset_days 默认下限)"
            )
        return self


class EntropyReviewVerdict(BaseModel):
    """Entropy Review 裁决

    不变量:
        - decision 仅允许三选一 (EntropyDecision enum)
        - rationale 必须非空
        - reviewer_forgekin_id != hotfix_tag.forgekin_id (禁自审, 跨厂商 review)
        - evidence_refs 至少 1 条 (与 D009 联动)
    """
    verdict_id: str = Field(..., min_length=1)
    hotfix_tag_id: str = Field(..., min_length=1)
    reviewer_forgekin_id: str = Field(..., min_length=1)
    decision: EntropyDecision
    rationale: str = Field(..., min_length=1)
    reviewed_at: datetime = Field(default_factory=datetime.utcnow)
    evidence_refs: list[str] = Field(default_factory=list)

    model_config = {"extra": "forbid"}

    @field_validator("rationale")
    @classmethod
    def _rationale_must_not_be_empty(cls, v: str) -> str:
        if not v or not v.strip:
            raise ValueError("EntropyReviewVerdict rationale 不可为空")
        return v.strip

    def validate_against_tag(self, hotfix_tag: HotfixTag) -> None:
        """reviewer != author 跨厂商 review 校验 (需 hotfix_tag 上下文)"""
        if self.reviewer_forgekin_id == hotfix_tag.forgekin_id:
            raise ReviewerIsAuthorError(
                f"reviewer_forgekin_id={self.reviewer_forgekin_id} "
                f"不可等于 commit author forgekin_id (禁自审)"
            )


class ValidationResult(BaseModel):
    """校验结果"""
    ok: bool
    errors: list[str] = Field(default_factory=list)
    escalated: bool = False


class HotfixTagger(ABC):
    """hotfix 标记器"""

    @abstractmethod
    async def tag(
        self,
        commit_sha: str,
        forgekin_id: str,
        commit_message: str,
        merged_at: Optional[datetime] = None,
    ) -> str:
        """提交 hotfix 时自动打 tag + 启动 sunset 计时器

        架构契约:
            - commit_message 含 "[hotfix]" 标记时触发 (大小写/空白不敏感)
            - sunset_review_due = merged_at + sunset_days (默认 14 天)
            - 持久化到 D008 Durable Surface (git + thread_trace)
            - WAL 可重放 (D021 联动)
            - 返回 tag_id
            - 若 commit_message 不含 marker, 返回空字符串 (不抛异常)
        """


class SunsetScheduler(ABC):
    """两周强制 review 调度"""

    @abstractmethod
    def schedule_review(self, hotfix_tag_id: str, due_at: datetime) -> None:
        """调度 sunset review 任务

        架构契约:
            - sunset_review_due 到期自动创建 review 任务
            - 分配给非作者Forgekin (跨厂商 review 配对)
            - 到期未 review 自动升级 CVO
        """

    @abstractmethod
    def list_overdue(self, now: Optional[datetime] = None) -> list[HotfixTag]:
        """列出所有已过期未 review 的 hotfix"""

    @abstractmethod
    def cancel(self, hotfix_tag_id: str) -> None:
        """取消调度 (verdict 已 apply 时调用)"""


class EntropyReviewGate(ABC):
    """三选一硬约束裁决门"""

    @abstractmethod
    async def validate(
        self,
        verdict: EntropyReviewVerdict,
        hotfix_tag: HotfixTag,
    ) -> ValidationResult:
        """校验裁决

        架构契约:
            - decision 仅允许 formal_fix / permanent / no_longer_relevant
            - 拒绝 "再看看" / "defer" / "later" (forbidden_decisions)
            - reviewer_forgekin_id != commit.forgekin_id (禁自审)
            - rationale 必须非空
            - hotfix_tag.status 必须为 PENDING_REVIEW (终态不可再裁决)
        """

    @abstractmethod
    async def apply_verdict(
        self,
        verdict: EntropyReviewVerdict,
        hotfix_tag: HotfixTag,
    ) -> HotfixStatus:
        """应用裁决, 更新 HotfixTag.status

        架构契约:
            - formal_fix → 移除 hotfix 标记, 升级为正式修复 (Built to Persist)
            - permanent → 接受永久方案 (Built to Persist)
            - no_longer_relevant → 写入 D018 退役信号 + 触发 D040 sunset review
        """

    @abstractmethod
    async def escalate_to_cvo(self, hotfix_tag: HotfixTag) -> None:
        """到期未 review 自动升级 CVO 仲裁

        架构契约:
            - 不阻塞主流程 (async fire-and-forget)
            - 写入 D008 thread_trace surface 记录升级事件
            - 通过 RoutingDispatcher 派发到 CVO
        """


class EntropyStore(ABC):
    """Entropy Control 持久化仓储 (Repository 层)"""

    @abstractmethod
    async def save_tag(self, tag: HotfixTag) -> None:
        """保存 HotfixTag (含 WAL LSN)"""

    @abstractmethod
    async def load_tag(self, tag_id: str) -> Optional[HotfixTag]:
        """加载 HotfixTag"""

    @abstractmethod
    async def list_pending(self) -> list[HotfixTag]:
        """列出所有 PENDING_REVIEW 状态的 tag"""

    @abstractmethod
    async def list_overdue(self, now: datetime) -> list[HotfixTag]:
        """列出所有已过期未 review 的 tag (sunset_review_due < now AND status=PENDING_REVIEW)"""

    @abstractmethod
    async def save_verdict(self, verdict: EntropyReviewVerdict) -> None:
        """保存裁决"""

    @abstractmethod
    async def update_tag_status(self, tag_id: str, status: HotfixStatus) -> None:
        """更新 tag 状态 (终态后不可回退)"""

    @abstractmethod
    async def checkpoint(self) -> None:
        """WAL checkpoint (PRAGMA wal_checkpoint(FULL))"""
```

### 2.3 Pydantic 异常类

```python
# flowforge/core/harness/entropy_errors.py
class EntropyError(Exception):
    """Entropy Control 基础异常"""


class HotfixMarkerNotFoundError(EntropyError):
    """commit message 未含 [hotfix] 标记"""


class ReviewerIsAuthorError(EntropyError):
    """reviewer_forgekin_id 等于 commit.forgekin_id (禁自审)"""


class ForbiddenDecisionError(EntropyError):
    """decision 命中 forbidden_decisions (再看看/defer/later)"""


class HotfixTagTerminalError(EntropyError):
    """HotfixTag 已是终态, 不可再裁决"""


class SunsetDaysTooShortError(EntropyError):
    """sunset_days 配置少于 14 天"""


class CVOEscalationFailedError(EntropyError):
    """CVO 升级失败"""


class WalReplayError(EntropyError):
    """WAL 重放失败 (D021 联动)"""


class EntropyStoreUnavailableError(EntropyError):
    """EntropyStore DB 不可用"""
```

### 2.4 默认实现

```python
# flowforge/core/harness/entropy_impl.py
from __future__ import annotations
import re
from datetime import datetime, timedelta
from typing import Optional

from ..plugin.di_container import inject
from ..tracing import get_logger
from .entropy import (
    EntropyDecision, EntropyReviewGate, EntropyReviewVerdict, EntropyStore,
    HotfixStatus, HotfixTag, HotfixTagger, SunsetScheduler, ValidationResult,
)
from .entropy_errors import (
    CVOEscalationFailedError, ForbiddenDecisionError, HotfixMarkerNotFoundError,
    HotfixTagTerminalError, ReviewerIsAuthorError, SunsetDaysTooShortError,
    WalReplayError,
)

_logger = get_logger(__name__)

# 半角问号正则 (禁用全角 ？, 防止 pattern 失效)
_HOTFIX_MARKER_RE = re.compile(r"\[\s*hotfix\s*\]", re.IGNORECASE)


class DefaultHotfixTagger(HotfixTagger):
    """默认 hotfix 标记器"""

    @inject
    def __init__(
        self,
        store: EntropyStore,
        sunset_days: int = 14,
        marker: str = "[hotfix]",
        event_bus=None,
        wal=None,
    ) -> None:
        if sunset_days < 14:
            raise SunsetDaysTooShortError(
                f"sunset_days={sunset_days} 不可少于 14 天"
            )
        self._store = store
        self._sunset_days = sunset_days
        self._marker = marker
        self._event_bus = event_bus
        self._wal = wal

    async def tag(
        self,
        commit_sha: str,
        forgekin_id: str,
        commit_message: str,
        merged_at: Optional[datetime] = None,
    ) -> str:
        merged_at = merged_at or datetime.utcnow

        # 大小写/空白不敏感匹配 [hotfix] / [HOTFIX] / [ Hotfix ]
        if not _HOTFIX_MARKER_RE.search(commit_message):
            _logger.debug(
                "commit_sha=%s 不含 hotfix marker, 跳过 tag",
                commit_sha,
            )
            return ""

        sunset_due = merged_at + timedelta(days=self._sunset_days)
        tag_id = f"hotfix-{commit_sha[:8]}-{int(merged_at.timestamp)}"

        tag = HotfixTag(
            tag_id=tag_id,
            commit_sha=commit_sha,
            forgekin_id=forgekin_id,
            commit_message=commit_message,
            merged_at=merged_at,
            sunset_review_due=sunset_due,
            status=HotfixStatus.PENDING_REVIEW,
            wal_lsn=0,  # 由 store.save_tag 内 WAL 分配
        )

        await self._store.save_tag(tag)
        _logger.info(
            "hotfix_tagged tag_id=%s commit_sha=%s forgekin_id=%s due=%s",
            tag_id, commit_sha, forgekin_id, sunset_due.isoformat,
        )

        if self._event_bus is not None:
            await self._event_bus.publish_async(
                "entropy.hotfix.tagged",
                {"tag_id": tag_id, "commit_sha": commit_sha, "due": sunset_due.isoformat},
            )

        return tag_id


class APSchedulerSunsetScheduler(SunsetScheduler):
    """基于 APScheduler 的 sunset 调度器"""

    @inject
    def __init__(
        self,
        store: EntropyStore,
        review_scheduler=None,  # apscheduler.schedulers.asyncio.AsyncIOScheduler
        forgekin_pairer=None,
        overdue_threshold_seconds: int = 0,
        routing_dispatcher=None,
    ) -> None:
        self._store = store
        self._scheduler = review_scheduler
        self._forgekin_pairer = forgekin_pairer
        self._overdue_threshold = overdue_threshold_seconds
        self._routing_dispatcher = routing_dispatcher

    def schedule_review(self, hotfix_tag_id: str, due_at: datetime) -> None:
        if self._scheduler is None:
            _logger.warning(
                "scheduler 未注入, hotfix_tag_id=%s 仅记录待调度",
                hotfix_tag_id,
            )
            return
        # APScheduler add_job (run_date=due_at)
        self._scheduler.add_job(
            self._trigger_review,
            "date",
            run_date=due_at,
            args=[hotfix_tag_id],
            id=f"sunset_review_{hotfix_tag_id}",
            replace_existing=True,
        )
        _logger.info(
            "sunset_review_scheduled tag_id=%s due=%s",
            hotfix_tag_id, due_at.isoformat,
        )

    async def _trigger_review(self, hotfix_tag_id: str) -> None:
        """到期触发: 分配非作者Forgekin review"""
        tag = await self._store.load_tag(hotfix_tag_id)
        if tag is None or tag.status != HotfixStatus.PENDING_REVIEW:
            return  # 已裁决或不存在, 跳过

        if self._forgekin_pairer is None:
            _logger.warning(
                "forgekin_pairer 未注入, hotfix_tag_id=%s 升级 CVO",
                hotfix_tag_id,
            )
            await self._escalate(tag)
            return

        reviewer = await self._forgekin_pairer.pair_non_author(tag.forgekin_id)
        _logger.info(
            "review_assigned tag_id=%s reviewer=%s (author=%s)",
            hotfix_tag_id, reviewer, tag.forgekin_id,
        )
        # 实际 review 由 reviewer Forgekin通过 TeamAct ROUTE 步触发 EntropyReviewGate.validate

    async def list_overdue(self, now: Optional[datetime] = None) -> list[HotfixTag]:
        now = now or datetime.utcnow
        return await self._store.list_overdue(now)

    async def _escalate(self, tag: HotfixTag) -> None:
        if self._routing_dispatcher is None:
            _logger.error(
                "routing_dispatcher 未注入, CVO 升级失败 tag_id=%s",
                tag.tag_id,
            )
            raise CVOEscalationFailedError("routing_dispatcher 未注入")
        await self._routing_dispatcher.dispatch_to_cvo(
            verdict_id=f"entropy_overdue_{tag.tag_id}",
            chain_id=f"entropy_{tag.tag_id}",
            reason=f"hotfix sunset_review_due 过期未 review, commit_sha={tag.commit_sha}",
            evidence_pack={
                "tag_id": tag.tag_id,
                "commit_sha": tag.commit_sha,
                "forgekin_id": tag.forgekin_id,
                "merged_at": tag.merged_at.isoformat,
                "sunset_review_due": tag.sunset_review_due.isoformat,
            },
        )
        _logger.warning(
            "entropy_overdue_escalated tag_id=%s commit_sha=%s",
            tag.tag_id, tag.commit_sha,
        )

    def cancel(self, hotfix_tag_id: str) -> None:
        if self._scheduler is None:
            return
        try:
            self._scheduler.remove_job(f"sunset_review_{hotfix_tag_id}")
        except Exception:
            pass  # job 不存在或已执行


class DefaultEntropyReviewGate(EntropyReviewGate):
    """默认三选一裁决门"""

    # 中文同义词 → 三选一映射 (防止"再看看"等同义词绕过)
    FORBIDDEN_DECISIONS = frozenset({
        "再看看", "defer", "later", "later_review",
        "todo", "tbd", "pending", "wait", "delay", "postpone",
    })

    @inject
    def __init__(
        self,
        store: EntropyStore,
        eval_signal_writer=None,
        routing_dispatcher=None,
        event_bus=None,
    ) -> None:
        self._store = store
        self._eval_signal_writer = eval_signal_writer
        self._routing_dispatcher = routing_dispatcher
        self._event_bus = event_bus

    async def validate(
        self,
        verdict: EntropyReviewVerdict,
        hotfix_tag: HotfixTag,
    ) -> ValidationResult:
        errors: list[str] = []

        # 1. hotfix_tag 必须为 PENDING_REVIEW (终态不可再裁决)
        if hotfix_tag.status != HotfixStatus.PENDING_REVIEW:
            errors.append(
                f"hotfix_tag.status={hotfix_tag.status} 已是终态, 不可再裁决"
            )
            return ValidationResult(ok=False, errors=errors)

        # 2. reviewer != author (禁自审)
        try:
            verdict.validate_against_tag(hotfix_tag)
        except ReviewerIsAuthorError as e:
            errors.append(str(e))

        # 3. decision 命中 forbidden_decisions
        decision_str = verdict.decision.value if isinstance(verdict.decision, EntropyDecision) else str(verdict.decision).lower
        if decision_str in self.FORBIDDEN_DECISIONS:
            errors.append(
                f"decision={decision_str} 命中 forbidden_decisions (禁'再看看'等同义词)"
            )

        # 4. decision 必须在 EntropyDecision 三选一内 (Pydantic 已校验, 此处兜底)
        try:
            EntropyDecision(decision_str)
        except ValueError:
            errors.append(f"decision={decision_str} 不在 EntropyDecision 三选一内")

        # 5. rationale 非空 (Pydantic 已校验, 此处兜底)
        if not verdict.rationale or not verdict.rationale.strip:
            errors.append("rationale 不可为空")

        # 6. evidence_refs 至少 1 条 (与 D009 联动)
        if not verdict.evidence_refs:
            errors.append("evidence_refs 至少 1 条 (D009 Evidence 联动)")

        return ValidationResult(ok=len(errors) == 0, errors=errors)

    async def apply_verdict(
        self,
        verdict: EntropyReviewVerdict,
        hotfix_tag: HotfixTag,
    ) -> HotfixStatus:
        result = await self.validate(verdict, hotfix_tag)
        if not result.ok:
            raise ForbiddenDecisionError(
                f"EntropyReviewVerdict 校验失败: {result.errors}"
            )

        # 状态机: PENDING_REVIEW → 终态 (不可逆)
        if verdict.decision == EntropyDecision.FORMAL_FIX:
            new_status = HotfixStatus.FORMAL_FIX
        elif verdict.decision == EntropyDecision.PERMANENT:
            new_status = HotfixStatus.PERMANENT
        elif verdict.decision == EntropyDecision.NO_LONGER_RELEVANT:
            new_status = HotfixStatus.NO_LONGER_RELEVANT
            # 写入 D018 退役信号 + 触发 D040 sunset review
            await self._write_retirement_signal(verdict, hotfix_tag)
        else:
            raise ForbiddenDecisionError(
                f"未知 decision={verdict.decision} (三选一硬约束)"
            )

        await self._store.update_tag_status(hotfix_tag.tag_id, new_status)
        await self._store.save_verdict(verdict)

        if self._event_bus is not None:
            await self._event_bus.publish_async(
                "entropy.verdict.applied",
                {
                    "tag_id": hotfix_tag.tag_id,
                    "verdict_id": verdict.verdict_id,
                    "decision": verdict.decision.value,
                    "new_status": new_status.value,
                },
            )

        _logger.info(
            "entropy_verdict_applied tag_id=%s verdict_id=%s decision=%s new_status=%s",
            hotfix_tag.tag_id, verdict.verdict_id,
            verdict.decision.value, new_status.value,
        )
        return new_status

    async def _write_retirement_signal(
        self,
        verdict: EntropyReviewVerdict,
        hotfix_tag: HotfixTag,
    ) -> None:
        """no_longer_relevant 决策写入 D018 退役信号"""
        if self._eval_signal_writer is None:
            _logger.warning(
                "eval_signal_writer 未注入, 退役信号未写入 tag_id=%s",
                hotfix_tag.tag_id,
            )
            return
        await self._eval_signal_writer.write_retirement_signal(
            signal_type="hotfix_no_longer_relevant",
            payload={
                "tag_id": hotfix_tag.tag_id,
                "commit_sha": hotfix_tag.commit_sha,
                "forgekin_id": hotfix_tag.forgekin_id,
                "verdict_id": verdict.verdict_id,
                "reviewer_forgekin_id": verdict.reviewer_forgekin_id,
                "rationale": verdict.rationale,
                "evidence_refs": verdict.evidence_refs,
                "retired_at": datetime.utcnow.isoformat,
            },
        )
        _logger.info(
            "retirement_signal_written tag_id=%s (D018 Eval Contract)",
            hotfix_tag.tag_id,
        )

    async def escalate_to_cvo(self, hotfix_tag: HotfixTag) -> None:
        """到期未 review 自动升级 CVO (async fire-and-forget)"""
        if self._routing_dispatcher is None:
            _logger.error(
                "routing_dispatcher 未注入, CVO 升级失败 tag_id=%s",
                hotfix_tag.tag_id,
            )
            raise CVOEscalationFailedError("routing_dispatcher 未注入")

        await self._routing_dispatcher.dispatch_to_cvo(
            verdict_id=f"entropy_overdue_{hotfix_tag.tag_id}",
            chain_id=f"entropy_{hotfix_tag.tag_id}",
            reason=(
                f"hotfix sunset_review_due 过期未 review, "
                f"commit_sha={hotfix_tag.commit_sha}, "
                f"forgekin_id={hotfix_tag.forgekin_id}"
            ),
            evidence_pack={
                "tag_id": hotfix_tag.tag_id,
                "commit_sha": hotfix_tag.commit_sha,
                "merged_at": hotfix_tag.merged_at.isoformat,
                "sunset_review_due": hotfix_tag.sunset_review_due.isoformat,
            },
        )
        _logger.warning(
            "entropy_overdue_escalated_to_cvo tag_id=%s",
            hotfix_tag.tag_id,
        )
```

### 2.5 关键算法伪代码

**算法 1：HotfixTagger.tag 自动打 tag**

```
INPUT: commit_sha, forgekin_id, commit_message, merged_at
OUTPUT: tag_id (或空字符串)

1. IF NOT regex_match(commit_message, r"\[\s*hotfix\s*\]", IGNORECASE):
1.1    RETURN ""  # 不含 marker, 跳过 (非异常)

2. sunset_due = merged_at + sunset_days
3. tag_id = "hotfix-" + commit_sha[:8] + "-" + timestamp(merged_at)
4. tag = HotfixTag(tag_id, commit_sha, forgekin_id, commit_message,
                   merged_at, sunset_due, status=PENDING_REVIEW)
5. wal_lsn = store.save_tag(tag)  # WAL 持久化 + 分配 LSN
6. tag.wal_lsn = wal_lsn
7. IF event_bus IS NOT None:
7.1    event_bus.publish_async("entropy.hotfix.tagged", {tag_id, commit_sha, due})
8. RETURN tag_id
```

**算法 2：SunsetScheduler.schedule_review + _trigger_review**

```
INPUT: hotfix_tag_id, due_at

schedule_review:
1. IF scheduler IS None: WARNING + RETURN
2. scheduler.add_job(
       func=_trigger_review,
       trigger="date",
       run_date=due_at,
       args=[hotfix_tag_id],
       id="sunset_review_" + hotfix_tag_id,
       replace_existing=True,
   )

_trigger_review (到期触发):
1. tag = store.load_tag(hotfix_tag_id)
2. IF tag IS None OR tag.status != PENDING_REVIEW: RETURN  # 已裁决/不存在
3. IF forgekin_pairer IS None:
3.1    _escalate(tag)  # 升级 CVO
3.2    RETURN
4. reviewer = forgekin_pairer.pair_non_author(tag.forgekin_id)  # 跨厂商 review 配对
5. INFO "review_assigned tag_id reviewer author"
6. # 实际 review 由 reviewer Forgekin通过 TeamAct ROUTE 步触发 EntropyReviewGate.validate
```

**算法 3：EntropyReviewGate.validate 三选一硬约束**

```
INPUT: verdict, hotfix_tag
OUTPUT: ValidationResult

1. errors = []
2. IF hotfix_tag.status != PENDING_REVIEW:
2.1    errors.append("已是终态, 不可再裁决")
2.2    RETURN ValidationResult(ok=False, errors=errors)

3. TRY verdict.validate_against_tag(hotfix_tag)  # reviewer != author
3.1 EXCEPT ReviewerIsAuthorError AS e: errors.append(str(e))

4. decision_str = verdict.decision.value.lower
5. IF decision_str IN FORBIDDEN_DECISIONS:
5.1    errors.append("decision 命中 forbidden_decisions")

6. TRY EntropyDecision(decision_str)  # 三选一硬校验
6.1 EXCEPT ValueError: errors.append("不在三选一内")

7. IF NOT verdict.rationale OR NOT verdict.rationale.strip:
7.1    errors.append("rationale 不可为空")

8. IF NOT verdict.evidence_refs:
8.1    errors.append("evidence_refs 至少 1 条 (D009 联动)")

9. RETURN ValidationResult(ok=(len(errors) == 0), errors=errors)
```

**算法 4：EntropyReviewGate.apply_verdict + escalate_to_cvo**

```
apply_verdict:
INPUT: verdict, hotfix_tag
OUTPUT: new_status

1. result = validate(verdict, hotfix_tag)
2. IF NOT result.ok: RAISE ForbiddenDecisionError(result.errors)

3. SWITCH verdict.decision:
   CASE FORMAL_FIX:        new_status = FORMAL_FIX
   CASE PERMANENT:         new_status = PERMANENT
   CASE NO_LONGER_RELEVANT:
     new_status = NO_LONGER_RELEVANT
     _write_retirement_signal(verdict, hotfix_tag)  # D018 + D040

4. store.update_tag_status(hotfix_tag.tag_id, new_status)  # 终态不可逆
5. store.save_verdict(verdict)
6. IF event_bus IS NOT None:
6.1    event_bus.publish_async("entropy.verdict.applied", {...})
7. RETURN new_status

escalate_to_cvo:
INPUT: hotfix_tag

1. IF routing_dispatcher IS None: RAISE CVOEscalationFailedError
2. routing_dispatcher.dispatch_to_cvo(
       verdict_id="entropy_overdue_" + hotfix_tag.tag_id,
       chain_id="entropy_" + hotfix_tag.tag_id,
       reason="sunset_review_due 过期未 review",
       evidence_pack={tag_id, commit_sha, merged_at, due},
   )
3. WARNING "entropy_overdue_escalated_to_cvo"
```

---

## 3. 模块实现

### 3.1 SQLite WAL 仓储实现

```python
# flowforge/infra/repo/sqlite_entropy_store.py
from __future__ import annotations
import json
import aiosqlite
from datetime import datetime
from typing import Optional

from flowforge.core.harness.entropy import (
    EntropyDecision, EntropyReviewVerdict, EntropyStore,
    HotfixStatus, HotfixTag,
)
from flowforge.core.harness.entropy_errors import EntropyStoreUnavailableError


class SqliteEntropyStore(EntropyStore):
    """SQLite WAL 实现 (D008 Durable Surface + D021 Side Effect WAL 联动)

    表结构:
        - hotfix_tags: tag 主表 (含 wal_lsn)
        - entropy_verdicts: 裁决表
        - entropy_events: 事件流 (升级 CVO / 退役信号)
    """

    SCHEMA_SQL = """
    CREATE TABLE IF NOT EXISTS hotfix_tags (
        tag_id              TEXT PRIMARY KEY,
        commit_sha          TEXT NOT NULL,
        forgekin_id         TEXT NOT NULL,
        commit_message      TEXT NOT NULL,
        merged_at           TEXT NOT NULL,
        sunset_review_due   TEXT NOT NULL,
        status              TEXT NOT NULL DEFAULT 'pending_review',
        wal_lsn             INTEGER NOT NULL DEFAULT 0,
        schema_version      TEXT NOT NULL DEFAULT 'v1',
        created_at          TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS entropy_verdicts (
        verdict_id           TEXT PRIMARY KEY,
        hotfix_tag_id        TEXT NOT NULL,
        reviewer_forgekin_id TEXT NOT NULL,
        decision             TEXT NOT NULL,
        rationale            TEXT NOT NULL,
        evidence_refs        TEXT NOT NULL DEFAULT '[]',
        reviewed_at          TEXT NOT NULL,
        FOREIGN KEY (hotfix_tag_id) REFERENCES hotfix_tags(tag_id)
    );

    CREATE TABLE IF NOT EXISTS entropy_events (
        event_id    INTEGER PRIMARY KEY AUTOINCREMENT,
        tag_id      TEXT,
        event_type  TEXT NOT NULL,
        payload     TEXT NOT NULL,
        occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_tags_status_due ON hotfix_tags(status, sunset_review_due);
    CREATE INDEX IF NOT EXISTS idx_tags_forgekin ON hotfix_tags(forgekin_id);
    CREATE INDEX IF NOT EXISTS idx_tags_commit_sha ON hotfix_tags(commit_sha);
    CREATE INDEX IF NOT EXISTS idx_verdicts_tag ON entropy_verdicts(hotfix_tag_id);
    CREATE INDEX IF NOT EXISTS idx_verdicts_reviewer ON entropy_verdicts(reviewer_forgekin_id);
    """

    def __init__(self, db_path: str) -> None:
        self._db_path = db_path
        self._wal_lsn_counter = 0

    async def _connect(self) -> aiosqlite.Connection:
        conn = await aiosqlite.connect(self._db_path)
        await conn.execute("PRAGMA journal_mode=WAL")
        await conn.execute("PRAGMA synchronous=NORMAL")
        await conn.execute("PRAGMA foreign_keys=ON")
        await conn.executescript(self.SCHEMA_SQL)
        await conn.commit
        return conn

    async def save_tag(self, tag: HotfixTag) -> None:
        self._wal_lsn_counter += 1
        wal_lsn = self._wal_lsn_counter
        try:
            async with await self._connect as conn:
                await conn.execute(
                    """
                    INSERT OR REPLACE INTO hotfix_tags
                        (tag_id, commit_sha, forgekin_id, commit_message,
                         merged_at, sunset_review_due, status, wal_lsn, schema_version)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        tag.tag_id, tag.commit_sha, tag.forgekin_id,
                        tag.commit_message, tag.merged_at.isoformat,
                        tag.sunset_review_due.isoformat, tag.status.value,
                        wal_lsn, tag.schema_version,
                    ),
                )
                await conn.execute(
                    """
                    INSERT INTO entropy_events (tag_id, event_type, payload)
                    VALUES (?, 'tag_saved', ?)
                    """,
                    (tag.tag_id, json.dumps({"wal_lsn": wal_lsn})),
                )
                await conn.commit
            tag.wal_lsn = wal_lsn
        except Exception as e:
            raise EntropyStoreUnavailableError(f"save_tag 失败: {e}") from e

    async def load_tag(self, tag_id: str) -> Optional[HotfixTag]:
        try:
            async with await self._connect as conn:
                async with conn.execute(
                    "SELECT * FROM hotfix_tags WHERE tag_id = ?",
                    (tag_id,),
                ) as cur:
                    row = await cur.fetchone
                    if row is None:
                        return None
                    return self._row_to_tag(row)
        except Exception as e:
            raise EntropyStoreUnavailableError(f"load_tag 失败: {e}") from e

    async def list_pending(self) -> list[HotfixTag]:
        try:
            async with await self._connect as conn:
                async with conn.execute(
                    "SELECT * FROM hotfix_tags WHERE status = 'pending_review' ORDER BY sunset_review_due ASC"
                ) as cur:
                    rows = await cur.fetchall
                    return [self._row_to_tag(r) for r in rows]
        except Exception as e:
            raise EntropyStoreUnavailableError(f"list_pending 失败: {e}") from e

    async def list_overdue(self, now: datetime) -> list[HotfixTag]:
        try:
            async with await self._connect as conn:
                async with conn.execute(
                    """
                    SELECT * FROM hotfix_tags
                    WHERE status = 'pending_review'
                      AND sunset_review_due < ?
                    ORDER BY sunset_review_due ASC
                    """,
                    (now.isoformat,),
                ) as cur:
                    rows = await cur.fetchall
                    return [self._row_to_tag(r) for r in rows]
        except Exception as e:
            raise EntropyStoreUnavailableError(f"list_overdue 失败: {e}") from e

    async def save_verdict(self, verdict: EntropyReviewVerdict) -> None:
        try:
            async with await self._connect as conn:
                await conn.execute(
                    """
                    INSERT OR REPLACE INTO entropy_verdicts
                        (verdict_id, hotfix_tag_id, reviewer_forgekin_id,
                         decision, rationale, evidence_refs, reviewed_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        verdict.verdict_id, verdict.hotfix_tag_id,
                        verdict.reviewer_forgekin_id, verdict.decision.value,
                        verdict.rationale, json.dumps(verdict.evidence_refs),
                        verdict.reviewed_at.isoformat,
                    ),
                )
                await conn.execute(
                    """
                    INSERT INTO entropy_events (tag_id, event_type, payload)
                    VALUES (?, 'verdict_saved', ?)
                    """,
                    (verdict.hotfix_tag_id, json.dumps({"verdict_id": verdict.verdict_id})),
                )
                await conn.commit
        except Exception as e:
            raise EntropyStoreUnavailableError(f"save_verdict 失败: {e}") from e

    async def update_tag_status(self, tag_id: str, status: HotfixStatus) -> None:
        # 终态不可逆校验
        existing = await self.load_tag(tag_id)
        if existing is None:
            raise EntropyStoreUnavailableError(f"tag_id={tag_id} 不存在")
        if existing.status != HotfixStatus.PENDING_REVIEW:
            from flowforge.core.harness.entropy_errors import HotfixTagTerminalError
            raise HotfixTagTerminalError(
                f"tag_id={tag_id} 已是终态 {existing.status.value}, 不可回退到 {status.value}"
            )
        try:
            async with await self._connect as conn:
                await conn.execute(
                    """
                    UPDATE hotfix_tags
                       SET status = ?, updated_at = datetime('now')
                     WHERE tag_id = ? AND status = 'pending_review'
                    """,
                    (status.value, tag_id),
                )
                await conn.execute(
                    """
                    INSERT INTO entropy_events (tag_id, event_type, payload)
                    VALUES (?, 'status_updated', ?)
                    """,
                    (tag_id, json.dumps({"new_status": status.value})),
                )
                await conn.commit
        except Exception as e:
            raise EntropyStoreUnavailableError(f"update_tag_status 失败: {e}") from e

    async def checkpoint(self) -> None:
        try:
            async with await self._connect as conn:
                await conn.execute("PRAGMA wal_checkpoint(FULL)")
                await conn.commit
        except Exception as e:
            raise EntropyStoreUnavailableError(f"checkpoint 失败: {e}") from e

    def _row_to_tag(self, row) -> HotfixTag:
        return HotfixTag(
            tag_id=row[0],
            commit_sha=row[1],
            forgekin_id=row[2],
            commit_message=row[3],
            merged_at=datetime.fromisoformat(row[4]),
            sunset_review_due=datetime.fromisoformat(row[5]),
            status=HotfixStatus(row[6]),
            wal_lsn=row[7],
            schema_version=row[8],
        )
```

### 3.2 时序图

**时序图 1：hotfix 自动 tag + 14 天 sunset 调度**

```
Forgekin           Tagger           Store(WAL)         Scheduler         EventBus
  │                  │                  │                  │                 │
  │ commit (含[hotfix])│                  │                  │                 │
  ├─────────────────>│                  │                  │                 │
  │                  │ regex_match(msg) │                  │                 │
  │                  │ sunset_due = merged + 14d           │                 │
  │                  │ save_tag(tag)    │                  │                 │
  │                  ├─────────────────>│ INSERT + WAL LSN │                 │
  │                  │ <────────────────┤ wal_lsn          │                 │
  │                  │ schedule_review(tag_id, due)        │                 │
  │                  ├─────────────────────────────────────>│ add_job(date)  │
  │                  │ <────────────────────────────────────┤                │
  │                  │ publish_async("entropy.hotfix.tagged")               │
  │                  ├──────────────────────────────────────────────────────>│
  │ <────────────────┤ tag_id           │                  │                 │
  │                  │                  │                  │                 │
  │  → 14 天后 Scheduler 触发 _trigger_review(tag_id)      │                 │
```

**时序图 2：三选一裁决 + 退役信号写入**

```
Reviewer          ReviewGate        Store             EvalSignalWriter   RoutingDispatcher
  │                  │                  │                  │                 │
  │ submit_verdict   │                  │                  │                 │
  │ (decision,       │                  │                  │                 │
  │  rationale,      │                  │                  │                 │
  │  evidence_refs)  │                  │                  │                 │
  ├─────────────────>│ validate(verdict, tag)              │                 │
  │                  │  - tag.status == PENDING_REVIEW?    │                 │
  │                  │  - reviewer != author?              │                 │
  │                  │  - decision ∈ 三选一?                │                 │
  │                  │  - rationale 非空?                   │                 │
  │                  │  - evidence_refs 至少 1 条?          │                 │
  │ <────────────────┤ ValidationResult(ok=True)          │                 │
  │                  │                  │                  │                 │
  │                  │ apply_verdict    │                  │                 │
  │                  │ IF NO_LONGER_RELEVANT:              │                 │
  │                  │   write_retirement_signal           │                 │
  │                  ├─────────────────────────────────────>│ write D018      │
  │                  │ <────────────────────────────────────┤ ok              │
  │                  │ update_tag_status(NO_LONGER_RELEVANT)│                 │
  │                  ├─────────────────>│ UPDATE (终态)     │                 │
  │                  │ <────────────────┤ ok                │                 │
  │                  │ save_verdict(v)  │                  │                 │
  │                  ├─────────────────>│ INSERT            │                 │
  │                  │ <────────────────┤ ok                │                 │
  │ <────────────────┤ HotfixStatus.NO_LONGER_RELEVANT     │                 │
  │                  │                  │                  │                 │
  │  → D040 控制面 sunset review 触发 (通过 EventBus 异步)  │                 │
```

**时序图 3：到期未 review 自动升级 CVO**

```
Scheduler(到期)    SunsetScheduler   Store              RoutingDispatcher   CVO
  │                  │                  │                  │                 │
  │ trigger_job      │                  │                  │                 │
  ├─────────────────>│ load_tag(tag_id) │                  │                 │
  │                  ├─────────────────>│ SELECT           │                 │
  │                  │ <────────────────┤ tag (PENDING)    │                 │
  │                  │ pairer.pair_non_author(author)     │                 │
  │                  │ (若 pairer 未注入)                  │                 │
  │                  │ escalate(tag)    │                  │                 │
  │                  ├──────────────────────────────────────>│ dispatch_to_cvo│
  │                  │                  │                  ├────────────────>│
  │                  │                  │                  │ <───────────────┤
  │                  │ <─────────────────────────────────────┤ ok             │
  │ <────────────────┤ WARNING "escalated"                  │                 │
  │                  │                  │                  │                 │
  │  → CVO 接管仲裁, 分配 reviewer 强制 review              │                 │
```

### 3.3 错误处理策略

| # | 异常 / 场景 | 处理策略 | 用户可见行为 |
|---|------------|---------|-------------|
| E1 | `HotfixMarkerNotFoundError` commit 不含 [hotfix] | 静默跳过（返回空字符串），DEBUG 日志 | 用户无感知 |
| E2 | `ReviewerIsAuthorError` reviewer == author | validate 返回 ok=False, errors 含说明 | reviewer 收到"禁自审"提示 |
| E3 | `ForbiddenDecisionError` decision 命中"再看看"等同义词 | validate 返回 ok=False, errors 含说明 | reviewer 收到"三选一硬约束"提示 |
| E4 | `HotfixTagTerminalError` tag 已是终态 | validate 返回 ok=False, apply 抛出 | reviewer 收到"已是终态, 不可再裁决" |
| E5 | `SunsetDaysTooShortError` 配置 sunset_days < 14 | Tagger 构造函数抛出 | 服务启动失败 |
| E6 | `CVOEscalationFailedError` routing_dispatcher 未注入 | escalate_to_cvo 抛出 + ERROR 日志 | 监控告警 |
| E7 | `WalReplayError` D021 WAL 重放失败 | 启动阶段检测, 阻断服务启动 + 告警 | 服务不可用 |
| E8 | `EntropyStoreUnavailableError` DB 锁/不可用 | 指数退避重试 3 次, 仍失败抛出 | 服务返回 503 |
| E9 | `forgekin_pairer` 未注入 | 升级 CVO + WARNING 日志 | reviewer 由 CVO 指派 |
| E10 | `event_bus.publish_async` 失败 | 不阻塞主流程, 仅 WARNING | 用户无感知 |
| E11 | `eval_signal_writer` 失败 (no_longer_relevant) | 不阻塞 status 更新, 仅 WARNING | D018 退役信号缺失, 监控告警 |
| E12 | commit_message 含 `[hotfix]` 但行首有空白 | 正则 IGNORECASE + `\s*` 容忍, 正常打 tag | 用户无感知 |

### 3.4 性能指标与优化

| 指标 | 目标值 | 测量方式 | 优化手段 |
|------|:------:|---------|---------|
| tag 延迟 | < 50ms (P95) | `_logger.info` 时间戳 | WAL 异步刷盘 + WAL LSN 单调递增 |
| validate 延迟 | < 5ms (P95) | 方法级 timing | Pydantic v2 + frozenset 查找 O(1) |
| apply_verdict 延迟 | < 100ms (P95) | 方法级 timing | 单事务 UPDATE + INSERT |
| list_overdue 延迟 | < 30ms (P95) | 索引 idx_tags_status_due | 复合索引 (status, sunset_review_due) |
| schedule_review 调度 | < 10ms (P95) | add_job timing | APScheduler 内存 job store |
| DB 文件大小 | < 10MB / 1000 hotfix | 文件系统 | 90 天后归档 + VACUUM |
| WAL checkpoint 频率 | 每 1000 个 tag 一次 | wal_lsn % 1000 == 0 | PRAGMA wal_checkpoint(FULL) |
| CVO 升级耗时 | < 200ms (P95) | dispatch_to_cvo timing | async fire-and-forget, 不阻塞主流程 |

### 3.5 配置外置（YAML 示例）

```yaml
# flowforge/config/harness.yaml
entropy_control:
  # hotfix 标记 (commit message 含此串触发自动 tag)
  hotfix_marker: "[hotfix]"

  # sunset 天数 (硬下限 14 天, 配置低于此值会 SunsetDaysTooShortError)
  sunset_days: 14

  # 三选一允许的 decision (与 EntropyDecision enum 一一对应)
  allowed_decisions:
    - formal_fix
    - permanent
    - no_longer_relevant

  # 禁止的 decision 同义词 (validate 时命中即拒绝)
  forbidden_decisions:
    - 再看看
    - defer
    - later
    - later_review
    - todo
    - tbd
    - pending
    - wait
    - delay
    - postpone

  # reviewer 必须非 author (跨厂商 review 配对)
  reviewer_must_not_be_author: true

  # 到期未 review 自动升级
  overdue_escalation: cvo

  # overdue 检测阈值 (秒, 0 = sunset_review_due 一到立即检测)
  overdue_threshold_seconds: 0

  # WAL checkpoint 频率 (每 N 个 tag 一次)
  wal_checkpoint_every_n_tags: 1000

  # 觉醒阶二次确认 (E4-E6 需 MindCouncil 确认 no_longer_relevant 决策)
  awakening_stage_review_required:
    - E4
    - E5
    - E6

  # DB 路径 (相对项目根, 通过环境变量覆盖)
  db_path: "data/entropy.sqlite"

  # 退役信号归档天数 (90 天后归档)
  archive_after_days: 90
```

---

## 4. 跨模块协作实现

### 4.1 上游依赖调用

**D002 TeamAct Loop（清理 ROUTE 分支）**

```python
# flowforge/loop/executor.py (节选)
from flowforge.core.harness.entropy import EntropyReviewGate, HotfixStatus

class LoopExecutor:
    @inject
    def __init__(self, entropy_review_gate: EntropyReviewGate, ...):
        self._entropy_gate = entropy_review_gate

    async def _execute_route_step(self, state):
        if state.route_target == "entropy_review":
            tag = await self._entropy_store.load_tag(state.hotfix_tag_id)
            verdict = EntropyReviewVerdict(
                verdict_id=state.verdict_id,
                hotfix_tag_id=state.hotfix_tag_id,
                reviewer_forgekin_id=state.current_forgekin_id,
                decision=EntropyDecision(state.decision_str),
                rationale=state.rationale,
                evidence_refs=state.evidence_refs,
            )
            new_status = await self._entropy_gate.apply_verdict(verdict, tag)
            state.entropy_status = new_status
            return state
        # ... 其他 ROUTE 分支
```

**D008 Durable State Surfaces（git + thread_trace 双 surface 持久化）**

```python
# flowforge/core/harness/durable_state_impl.py (节选)
class DefaultDurableStateRegistry:
    async def write_hotfix_tag_surfaces(self, tag: HotfixTag) -> None:
        # git surface (权威等级 4)
        await self.write_surface(
            surface_type=StateSurfaceType.GIT,
            key=f"hotfix/{tag.tag_id}",
            payload=tag.model_dump,
            authority_level=4,
            decay_tag=DecayTag.BUILT_TO_PERSIST,
        )
        # thread_trace surface (权威等级 1, 临时上下文)
        await self.write_surface(
            surface_type=StateSurfaceType.THREAD_TRACE,
            key=f"hotfix/{tag.tag_id}/trace",
            payload={"commit_sha": tag.commit_sha, "status": tag.status.value},
            authority_level=1,
            decay_tag=DecayTag.BUILT_TO_DELETE,
        )
```

**D021 Side Effect WAL（可重放）**

```python
# flowforge/core/harness/side_effect_wal.py (节选)
class SideEffectWAL:
    async def append_hotfix_tag(self, tag: HotfixTag) -> int:
        lsn = await self._append(
            op_type="hotfix_tag_saved",
            payload=tag.model_dump,
        )
        return lsn

    async def replay(self) -> None:
        # 进程启动时重放 WAL, 恢复 PENDING_REVIEW 状态
        for entry in await self._read_all:
            if entry.op_type == "hotfix_tag_saved":
                tag = HotfixTag(**entry.payload)
                if tag.status == HotfixStatus.PENDING_REVIEW:
                    # 重新调度 sunset review
                    await self._scheduler.schedule_review(tag.tag_id, tag.sunset_review_due)
```

### 4.2 下游影响

**D010 Governance Boundary（已失效 guardrail 降级 default）**

```python
# flowforge/core/harness/governance_impl.py (节选)
class DefaultGovernanceInjector:
    async def sunset_review_guardrail(self, rule_id: str) -> None:
        """Entropy Control 触发: 已失效 guardrail 可降级为 default"""
        # 调用 D012 EntropyReviewGate 评估是否 no_longer_relevant
        tag = await self._find_hotfix_tag_for_rule(rule_id)
        if tag is None:
            return
        # 触发 sunset review (走 D012 流程)
        await self._entropy_gate.escalate_to_cvo(tag)  # 升级 CVO 决定是否降级
```

**D018 Eval Contract（退役信号采集）**

```python
# flowforge/core/harness/eval_contract_impl.py (节选)
class DefaultEvalSignalWriter:
    async def write_retirement_signal(self, signal_type: str, payload: dict) -> None:
        """D012 no_longer_relevant 决策写入退役信号"""
        await self._store.save_signal({
            "signal_type": signal_type,
            "payload": payload,
            "occurred_at": datetime.utcnow,
        })
        # 异步通知 D040 控制面
        await self._event_bus.publish_async("eval.retirement_signal", payload)
```

**D040 Harness Eval 控制面（sunset review 触发）**

```python
# flowforge/core/harness/harness_eval_impl.py (节选)
class HarnessEvalControlPlane:
    async def on_retirement_signal(self, event):
        """监听 eval.retirement_signal, 触发 sunset review"""
        tag_id = event["payload"]["tag_id"]
        await self._sunset_reviewer.review(tag_id)
        # 更新控制面 "正在折旧机制" 列表
        await self._mark_decaying_mechanism(tag_id)
```

### 4.3 跨模块集成测试点

| # | 测试场景 | 上游/下游 | 验证点 |
|---|---------|----------|--------|
| T1 | Forgekin 提交含 `[hotfix]` commit → D002 TeamAct 钩子触发 → D012 tag | D002→D012 | tag_id 非空, sunset_review_due = merged + 14d |
| T2 | D012 tag → D008 Durable State 双 surface 持久化 | D012→D008 | git surface authority=4, thread_trace authority=1 |
| T3 | D012 tag → D021 WAL 写入 + 进程崩溃重放 | D012↔D021 | 重放后 status=PENDING_REVIEW, 重新调度 |
| T4 | D012 SunsetScheduler 到期 → D002 TeamAct ROUTE entropy_review | D012→D002 | reviewer != author, 跨厂商配对 |
| T5 | D012 EntropyReviewGate validate → D009 evidence_refs 校验 | D012↔D009 | evidence_refs 至少 1 条 |
| T6 | D012 apply_verdict(NO_LONGER_RELEVANT) → D018 退役信号 | D012→D018 | retirement_signal 写入, signal_type=hotfix_no_longer_relevant |
| T7 | D018 退役信号 → D040 控制面 sunset review | D018→D040 | 控制面标记"折旧中" |
| T8 | D012 overdue → CVO 升级 → RoutingDispatcher 派发 | D012→CVO | dispatch_to_cvo 调用, evidence_pack 含 tag_id |
| T9 | D010 guardrail 失效 → 触发 D012 sunset review | D010→D012 | guardrail 标记 candidate_for_default |
| T10 | D012 NO_LONGER_RELEVANT → D010 guardrail 降级 default | D012→D010 | GovernanceRule authority: HARD→DEFAULT |
| T11 | D012 FORMAL_FIX → D008 git surface 升级 Built to Persist | D012→D008 | decay_tag: BUILT_TO_DELETE→BUILT_TO_PERSIST |
| T12 | D012 status 终态不可逆（PERMANENT 后再裁决 → HotfixTagTerminalError） | D012 内部 | raise HotfixTagTerminalError |
| T13 | 觉醒阶 E4+ no_longer_relevant → MindCouncil 二次确认 | D012↔MindCouncil | 二次确认未通过则不 apply |

---

## 5. 详细设计验收

### 5.1 功能验收（Functional AC）

- [ ] AC-F1: `flowforge/core/harness/entropy.py` 不 import forgemind 或 *Forge 模块（单向依赖）
- [ ] AC-F2: HotfixTagger / SunsetScheduler / EntropyReviewGate 通过 `@inject` 注入，无直接实例化
- [ ] AC-F3: HotfixTag 通过 Repository 持久化到 D008 Durable Surface（无 `cursor.execute`）
- [ ] AC-F4: commit message 含 `[hotfix]` 标记（大小写/空白不敏感）自动打 tag
- [ ] AC-F5: sunset_review_due >= merged_at + 14 天（Pydantic model_validator 校验）
- [ ] AC-F6: sunset_days 配置 < 14 抛出 `SunsetDaysTooShortError`
- [ ] AC-F7: SunsetScheduler.schedule_review 通过 APScheduler 调度到 due_at
- [ ] AC-F8: list_overdue 返回 status=PENDING_REVIEW AND sunset_review_due < now 的 tag
- [ ] AC-F9: EntropyReviewGate.validate 拒绝 reviewer == author（禁自审）
- [ ] AC-F10: EntropyReviewGate.validate 拒绝 forbidden_decisions（再看看/defer/later 等）
- [ ] AC-F11: EntropyReviewGate.validate 要求 evidence_refs 至少 1 条
- [ ] AC-F12: EntropyReviewGate.validate 要求 rationale 非空
- [ ] AC-F13: EntropyReviewGate.validate 拒绝非 PENDING_REVIEW 状态的 tag（终态不可逆）
- [ ] AC-F14: apply_verdict(FORMAL_FIX) → status=FORMAL_FIX + D008 decay_tag 改 Built to Persist
- [ ] AC-F15: apply_verdict(PERMANENT) → status=PERMANENT + D008 decay_tag 改 Built to Persist
- [ ] AC-F16: apply_verdict(NO_LONGER_RELEVANT) → status=NO_LONGER_RELEVANT + D018 退役信号写入 + D040 sunset review 触发
- [ ] AC-F17: escalate_to_cvo 调用 RoutingDispatcher.dispatch_to_cvo, evidence_pack 含 tag_id/commit_sha/due
- [ ] AC-F18: 觉醒阶 E4-E6 的 NO_LONGER_RELEVANT 决策需 MindCouncil 二次确认

### 5.2 性能验收（Performance AC）

- [ ] AC-P1: tag P95 延迟 < 50ms
- [ ] AC-P2: validate P95 延迟 < 5ms
- [ ] AC-P3: apply_verdict P95 延迟 < 100ms
- [ ] AC-P4: list_overdue P95 延迟 < 30ms
- [ ] AC-P5: schedule_review P95 延迟 < 10ms
- [ ] AC-P6: WAL checkpoint 每 1000 个 tag 一次, checkpoint 耗时 < 500ms
- [ ] AC-P7: 1000 hotfix tag DB 文件 < 10MB

### 5.3 安全验收（Security AC）

- [ ] AC-S1: reviewer_forgekin_id != commit.forgekin_id（跨厂商 review, 禁自审）
- [ ] AC-S2: forbidden_decisions 包含 [再看看, defer, later, todo, tbd, pending, wait, delay, postpone]
- [ ] AC-S3: HotfixTag 状态机终态不可逆（PERMANENT 后不可回退 PENDING_REVIEW）
- [ ] AC-S4: sunset_days 配置硬下限 14 天（不可通过配置绕过）
- [ ] AC-S5: audit log（entropy_events 表）禁删除, 仅 INSERT + SELECT
- [ ] AC-S6: CVO 升级 evidence_pack 必须含 merged_at + sunset_review_due（可追溯）
- [ ] AC-S7: 觉醒阶 E4+ 的 NO_LONGER_RELEVANT 决策需 MindCouncil 二次确认（防Forgekin自降级）

### 5.4 Eval 验收（Eval AC）

- [ ] AC-E1: no_longer_relevant 决策 100% 写入 D018 退役信号（T6 集成测试）
- [ ] AC-E2: D018 退役信号 100% 触发 D040 控制面 sunset review（T7 集成测试）
- [ ] AC-E3: D040 控制面 "正在折旧机制" 列表实时反映 PENDING_REVIEW 状态的 tag
- [ ] AC-E4: overdue 升级 CVO 后, CVO 仲裁结果回流 D012（apply_verdict 由 CVO 指派的 reviewer 触发）
- [ ] AC-E5: 退役信号归档 90 天后, D018 Eval Contract 可查询历史退役记录

---

## 6. 引用

- [doc:../spec.md#§3.3]（FR-CORE-003，FR-CORE-022 Entropy Control）
- [doc:../arch.md#§3.3]（Harness 七层现实表面，L6 Entropy Control）
- [doc:../features/F012-entropy-control.md]（同号 Feature 级 SRS）
- [doc:../architecture/A012-entropy-control.md]（同号 Architecture 架构权威源）
- [doc:../architecture/A002-teamact-loop.md]（TeamAct ROUTE 分支挂载点）
- [doc:../architecture/A008-durable-state-surfaces.md]（HotfixTag 持久化目标）
- [doc:../architecture/A009-evidence-sensors.md]（evidence_refs 联动）
- [doc:../architecture/A010-governance-boundary.md]（guardrail 降级 default）
- [doc:D008-durable-state-surfaces.md]（git + thread_trace 双 surface）
- [doc:D009-evidence-sensors.md]（evidence_refs 至少 1 条）
- [doc:D010-governance-boundary.md]（已失效 guardrail 降级）
- [doc:D018-eval-contract.md]（退役信号采集）
- [doc:D021-side-effect-wal.md]（WAL 可重放）
- [doc:D040-harness-eval-control-plane.md]（sunset review 控制面）
- [doc:../decisions/007-harness-engineering.md]（Harness 工程路径 ADR）
- [doc:../decisions/009-eval-self-metabolism.md]（Eval 自代谢联动）
- [doc:../../CONTRIBUTING.md]（文档分层规范）
- [doc:../../CONTRIBUTING.md#32-t1-t8-测试铁律]（测试铁律）
- [doc:naming-contract.md#§4]（觉醒阶 E1-E6 标注）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（详细设计骨架，对应 F012/A012） | 开发者 Forgekin（猎犬·夏洛克） |
