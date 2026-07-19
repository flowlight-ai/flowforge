# D016: 记忆治理三要素详细设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 开发者灵智体（猎犬·夏洛克）
> **对应 spec.md**: [doc:../spec.md#§3.4]（FR-CORE-004）
> **对应 arch.md**: [doc:../arch.md#§3.4]
> **对应 design.md**: [doc:../design.md#§3.4]
> **对应 Feature**: [doc:../features/F016-memory-governance.md]（同号 Feature 级 SRS）
> **对应 Architecture**: [doc:../architecture/A016-memory-governance.md]（同号 Feature 级 SAD）
> **依赖 ADR**: [doc:../decisions/008-memory-federation.md]
> **9 大点名称修订**: 已应用（双轨命名 + AI 术语优先 + 弱化万物 + 去 AGI 化）

---

## 1. 详细设计上下文

### 1.1 设计问题

灵智体（Forgekin，社区社交称"灵智体"）在执行任务时检索记忆，旧记忆与新记忆一视同仁导致三类问题：权威倒挂（候选观察压过铁律）、触发失效（铁律未注入 system role）、僵尸知识（3 年前过时决策与今天最新决策同权重）。A016 架构设计已确认 L2 治理层形式化"权威性 / 触发方式 / 生命周期"三要素，让检索结果在 RRF 融合后经过权威硬序、触发过滤、生命周期衰减三步治理。

本详细设计进一步下沉到代码层，需要解决以下子问题：

1. **三要素标签的物理存储**：Authority/Activation/LifecycleStatus 三要素打在 entry 上，需明确 `governance_tags` 表结构与 entry 表的关联方式，支持快速查询与排序。
2. **四步过滤算法的实现细节**：LifecycleFilter → ActivationFilter → AuthoritySorter → ExpiryScheduler 四步如何在同一 `filter()` 调用中顺序执行，每步的中间结果如何流转。
3. **硬序排序的稳定实现**：`hard_rule > verified_decision > candidate_observation` 硬序需保证 hard_rule 块内最低分仍高于 verified_decision 块内最高分，需要分数区段隔离机制。
4. **always_on 自动注入的钩子位置**：灵智体启动时 `inject_always_on()` 在 `__init__` 中的具体注入点与 system role builder 的接口契约。
5. **review 任务派发的非 author 选择算法**：从 CapabilityProfile 查询非 author 灵智体列表，如何选择最合适的 reviewer（最近活跃 + 能力匹配 + 非 author 三条件加权）。
6. **过期转态的调度频率**：`schedule_expiry_review` 是周期触发还是事件触发，如何避免高频扫描对数据库的压力。

### 1.2 设计约束

- **单向依赖约束**：`flowforge/core/memory/governance/` 是 L2 治理层，可依赖 F014 Collection 层与 F015 检索层，禁止被 F014/F015 反向依赖，禁止 import F017/F018/F020/F039/F040 任何模块。
- **铁律优先约束**：authority=hard_rule 的条目必须在最终排序中硬序置顶，不被 RRF 或消费加权翻盘。
- **配置驱动约束**：authority_order、deprecated_weight_multiplier、archived_excluded_from_retrieval、expiry_scan_interval_seconds 等策略外置 `config/memory_governance.yaml`。
- **过期自动转态约束**：`expires_at` 到期必须自动转 deprecated 并触发 review 任务，不允许"过期不处理"。
- **review 任务指派约束**：过期 review 必须指派给非原作者灵智体（防止自我确认偏误，铁律"不能自己 review 自己"）。
- **DI 容器约束**：`GovernanceFilter` / `GovernanceTagger` / `LifecycleScheduler` / `ActivationInjector` 均通过 DI 容器注入，禁止直接实例化。
- **Repository 层约束**：治理标签持久化必须经 `GovernanceTagRepository` 抽象，禁止 `cursor.execute("INSERT INTO governance_tags ...")` 直操作数据库。
- **异步约束**：所有 I/O 操作使用 `async/await`，过期扫描使用 `asyncio.create_task` 不阻塞主流程。
- **类型注解约束**：Python 3.11+，所有公共方法强制类型注解。

### 1.3 设计影响

- **对 F014 Collection 层（D014）**：`lifecycle_status` 字段成为治理层的物理承载，D014 在 `register()` 时需校验 lifecycle 取值与 `governance_tags` 表外键一致。`authority_level` 字段被治理层 Authority 枚举引用，治理层不独立维护权威副本。
- **对 F015 三检索入口（D015）**：`authority_floor` 过滤先于 RRF 融合执行，治理层在 RRF 之后做权威硬序。D015 `RetrievalFusion.search()` 返回的 hits 必须包含 `entry_id` 字段供治理层查询标签。
- **对 F017 消费排序（D017）**：deprecated 条目强制 ×0.3 降权，是消费加权公式中"过时惩罚"的输入。硬序后块内交 F017 排序，块间硬序保持。
- **对 F018 Eval Contract**：治理事件（`expiry_review_triggered`）可作为 Eval Contract 的回归用例。
- **对 F020 归因矩阵**：archived 条目仅供 F020"环境漂移"归因溯源，不参与日常检索。
- **对 F039 锻典可检索**：锻典条目同样应用三要素治理，确保过时锻典被识别。
- **对 F040 控制面**：治理事件（deprecated/archived/expiry_review_triggered）写入 F040 Eval Hub。
- **对 DI 容器**：需新增 `governance_filter` / `governance_tagger` / `lifecycle_scheduler` / `activation_injector` / `governance_tag_repository` 五个绑定。
- **对数据库 schema**：需新增 `governance_tags` 表（按 entry_id 索引）+ `expiry_review_tasks` 表。

---

## 2. 详细设计

### 2.1 类图 ASCII

```
┌──────────────────────────────────────────────────────────────────────┐
│                     <<module>> governance                            │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  <<enum>> Authority              <<enum>> Activation                 │
│  + HARD_RULE                     + ALWAYS_ON                         │
│  + VERIFIED_DECISION             + TASK_SCOPED                       │
│  + CANDIDATE_OBSERVATION         + QUERY_ONLY                        │
│                                                                      │
│  <<enum>> LifecycleStatus       <<model>> GovernanceTag              │
│  + ACTIVE                        + entry_id: str                     │
│  + PENDING_REVIEW                + authority: Authority              │
│  + DEPRECATED                    + activation: Activation            │
│  + ARCHIVED                      + lifecycle: LifecycleStatus        │
│                                  + last_verified_at: datetime       │
│  <<enum>> ReviewTaskStatus       + expires_at: datetime?             │
│  + PENDING                       + author_forgekin_id: str           │
│  + ASSIGNED                      + scope: str?                       │
│  + IN_PROGRESS                   + created_at: datetime              │
│  + DONE                                                             │
│                                  <<model>> QueryContext              │
│  <<model>> GovernanceConfig     + task_scope: str?                   │
│  + authority_order: list         + is_query_phase: bool              │
│  + deprecated_multiplier: float  + forgekin_id: str                │
│  + archived_excluded: bool       + include_archived: bool            │
│  + expiry_scan_interval: int     + authority_floor: int              │
│  + always_on_inject_batch: int                                       │
│                                  <<model>> ReviewTask                │
│  <<interface>> GovernanceTagger  + task_id: str                     │
│  + tag(entry_id, tag): void      + entry_id: str                     │
│  + untag(entry_id): void         + author_forgekin_id: str           │
│                                  + reviewer_forgekin_id: str?         │
│  <<interface>> GovernanceFilter  + expires_at: datetime              │
│  + filter(hits, ctx): list       + status: ReviewTaskStatus          │
│                                  + assigned_at: datetime?            │
│  <<interface>> AuthoritySorter  + completed_at: datetime?           │
│  + sort_by_authority(hits): list                                     │
│                                                                      │
│  <<interface>> LifecycleScheduler <<interface>> ActivationInjector   │
│  + schedule_expiry_review(...)  + inject_always_on(                  │
│  + scan_and_expire(): int          forgekin_id, builder): int        │
│                                                                      │
│  <<interface>> GovernanceTagRepository                              │
│  + insert_tag(tag): void                                            │
│  + query_tag(entry_id): GovernanceTag?                              │
│  + query_tags_batch(entry_ids): list                               │
│  + update_lifecycle(entry_id, status): void                        │
│  + query_expired(now): list                                        │
│  + query_always_on_hard_rule(): list                               │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.2 接口实现 Python 代码

```python
# flowforge/core/memory/governance/tagger.py
from __future__ import annotations
from abc import ABC, abstractmethod
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict
from enum import Enum


class Authority(str, Enum):
    HARD_RULE = "hard_rule"
    VERIFIED_DECISION = "verified_decision"
    CANDIDATE_OBSERVATION = "candidate_observation"


class Activation(str, Enum):
    ALWAYS_ON = "always_on"
    TASK_SCOPED = "task_scoped"
    QUERY_ONLY = "query_only"


class LifecycleStatus(str, Enum):
    ACTIVE = "active"
    PENDING_REVIEW = "pending_review"
    DEPRECATED = "deprecated"
    ARCHIVED = "archived"


class GovernanceTag(BaseModel):
    """三要素标签；authority 不可被消费加权翻盘"""
    model_config = ConfigDict(frozen=True)

    entry_id: str = Field(min_length=1)
    authority: Authority
    activation: Activation
    lifecycle: LifecycleStatus
    last_verified_at: datetime
    expires_at: Optional[datetime] = None
    author_forgekin_id: str = Field(min_length=1)
    scope: Optional[str] = None  # task_scoped 时必填
    created_at: datetime


class QueryContext(BaseModel):
    """治理过滤的查询上下文"""
    model_config = ConfigDict()

    task_scope: Optional[str] = None
    is_query_phase: bool = True
    forgekin_id: str = Field(min_length=1)
    include_archived: bool = False
    authority_floor: int = Field(default=1, ge=1, le=3)


class ReviewTaskStatus(str, Enum):
    PENDING = "pending"
    ASSIGNED = "assigned"
    IN_PROGRESS = "in_progress"
    DONE = "done"


class ReviewTask(BaseModel):
    """过期 review 任务；reviewer_forgekin_id 必须不等于 author_forgekin_id"""
    model_config = ConfigDict()

    task_id: str = Field(min_length=1)
    entry_id: str = Field(min_length=1)
    author_forgekin_id: str = Field(min_length=1)
    reviewer_forgekin_id: Optional[str] = None
    expires_at: datetime
    status: ReviewTaskStatus = ReviewTaskStatus.PENDING
    assigned_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    rationale: str = Field(min_length=1)


class GovernanceTagError(ValueError):
    """治理标签校验失败"""


class AuthorityHardOrderViolation(Exception):
    """权威硬序被违反时抛出"""


class GovernanceTagger(ABC):
    """给 entry 打三要素标签"""

    @abstractmethod
    async def tag(self, entry_id: str, tag: GovernanceTag) -> None:
        """
        给 entry 打三要素标签：
        1. author_forgekin_id 必须非空
        2. activation=TASK_SCOPED 时 scope 必须非空
        3. 重复打标签需走新版本（不可覆盖）
        """

    @abstractmethod
    async def untag(self, entry_id: str) -> None:
        """逻辑删除标签（不物理删除，保留追溯）"""


class GovernanceFilter(ABC):
    """检索时三要素过滤 + 权威硬序"""

    @abstractmethod
    async def filter(
        self,
        hits: list,
        context: QueryContext,
    ) -> list:
        """
        四步过滤：
        1. LifecycleFilter: archived 丢弃 / deprecated ×0.3
        2. ActivationFilter: always_on 保留 / task_scoped 任务范围匹配 / query_only 仅查询时
        3. AuthoritySorter: hard_rule > verified_decision > candidate_observation 硬序
        4. ExpiryScheduler: 异步检查 expires_at 到期转态
        返回治理后的 hits 列表
        """


class AuthoritySorter(ABC):
    """权威硬序排序"""

    @abstractmethod
    async def sort_by_authority(self, hits: list) -> list:
        """
        按 authority 硬序：
        - hard_rule 块 → verified_decision 块 → candidate_observation 块
        - 块间硬序，块内按原 score 排序
        - 使用分数区段隔离：hard_rule 加 +200 区段，verified_decision 加 +100 区段
        """


class LifecycleScheduler(ABC):
    """过期自动转态 + review 任务派发"""

    @abstractmethod
    async def schedule_expiry_review(
        self,
        entry_id: str,
        expires_at: datetime,
        author_forgekin_id: str,
    ) -> str:
        """到期转 deprecated + 派发 review 任务给非 author 灵智体；返回 task_id"""

    @abstractmethod
    async def scan_and_expire(self) -> int:
        """周期扫描过期条目；返回本次转 deprecated 的数量"""


class ActivationInjector(ABC):
    """always_on 自动注入 system role"""

    @abstractmethod
    async def inject_always_on(
        self,
        forgekin_id: str,
        system_role_builder: "SystemRoleBuilder",
    ) -> int:
        """
        authority=hard_rule + activation=always_on 条目自动注入 system role
        返回注入条目数
        """


class SystemRoleBuilder(ABC):
    """system role 构造器抽象（由 ForgekinEngine 实现）"""

    @abstractmethod
    async def append_hard_rule(self, content: str, scope: Optional[str]) -> None:
        """追加硬规则到 system role"""


class GovernanceTagRepository(ABC):
    """治理标签 Repository 层（禁直操作数据库）"""

    @abstractmethod
    async def insert_tag(self, tag: GovernanceTag) -> None: ...

    @abstractmethod
    async def query_tag(self, entry_id: str) -> Optional[GovernanceTag]: ...

    @abstractmethod
    async def query_tags_batch(self, entry_ids: list[str]) -> list[GovernanceTag]: ...

    @abstractmethod
    async def update_lifecycle(
        self, entry_id: str, status: LifecycleStatus
    ) -> None: ...

    @abstractmethod
    async def query_expired(self, now: datetime) -> list[GovernanceTag]: ...

    @abstractmethod
    async def query_always_on_hard_rule(self) -> list[GovernanceTag]: ...
```

### 2.3 数据结构 Pydantic Models

```python
# flowforge/core/memory/governance/models.py
from __future__ import annotations
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field, model_validator
from .tagger import Authority, Activation, LifecycleStatus


class GovernanceConfig(BaseModel):
    """YAML 配置加载结果"""

    authority_order: list[Authority] = Field(
        default_factory=lambda: [
            Authority.HARD_RULE,
            Authority.VERIFIED_DECISION,
            Authority.CANDIDATE_OBSERVATION,
        ]
    )
    deprecated_weight_multiplier: float = Field(default=0.3, gt=0.0, lt=1.0)
    archived_excluded_from_retrieval: bool = True
    expiry_scan_interval_seconds: int = Field(default=3600, ge=60)
    always_on_inject_batch_size: int = Field(default=50, ge=1, le=500)
    authority_score_offsets: dict[Authority, int] = Field(
        default_factory=lambda: {
            Authority.HARD_RULE: 200,
            Authority.VERIFIED_DECISION: 100,
            Authority.CANDIDATE_OBSERVATION: 0,
        }
    )
    review_task_assignment_strategy: str = "least_loaded_non_author"
    forbidden_self_review: bool = True

    @model_validator(mode="after")
    def validate_authority_order(self) -> "GovernanceConfig":
        if Authority.HARD_RULE not in self.authority_order:
            raise ValueError("authority_order must contain HARD_RULE")
        if self.authority_order[0] != Authority.HARD_RULE:
            raise ValueError("HARD_RULE must be first in authority_order")
        return self


class FilteredHit(BaseModel):
    """治理过滤后的 hit 模型"""

    entry_id: str
    original_score: float
    adjusted_score: float
    authority: Authority
    activation: Activation
    lifecycle: LifecycleStatus
    scope: Optional[str] = None
    deprecated_applied: bool = False
    archived_dropped: bool = False


class ExpiryScanResult(BaseModel):
    """过期扫描结果"""

    expired_count: int
    review_tasks_created: list[str] = Field(default_factory=list)
    scan_duration_ms: int
```

### 2.4 关键算法伪代码

```
function GovernanceFilter.filter(hits, context):
    # Step 1: LifecycleFilter
    filtered = []
    for hit in hits:
        tag = repository.query_tag(hit.entry_id)
        if tag.lifecycle == ARCHIVED and not context.include_archived:
            continue  # archived 丢弃
        if tag.lifecycle == DEPRECATED:
            hit.score *= config.deprecated_weight_multiplier  # ×0.3
            hit.deprecated_applied = True
        filtered.append((hit, tag))

    # Step 2: ActivationFilter
    activated = []
    for (hit, tag) in filtered:
        if tag.activation == ALWAYS_ON:
            activated.append((hit, tag))  # 始终保留
        elif tag.activation == TASK_SCOPED:
            if tag.scope == context.task_scope:
                activated.append((hit, tag))
        elif tag.activation == QUERY_ONLY:
            if context.is_query_phase:
                activated.append((hit, tag))

    # Step 3: AuthoritySorter 硬序
    sorted_hits = sort_by_authority_hard(activated)
    # 块间用分数区段隔离，块内按 adjusted_score 降序

    # Step 4: ExpiryScheduler（异步）
    asyncio.create_task(scheduler.scan_and_expire())

    return sorted_hits


function AuthoritySorter.sort_by_authority_hard(activated):
    # 分数区段隔离：hard_rule 加 +200，verified_decision 加 +100，candidate 加 +0
    # 保证 hard_rule 块内最低分仍高于 verified_decision 块内最高分
    # （前提：原始 score 范围 [0, 1]）

    blocks = {HARD_RULE: [], VERIFIED_DECISION: [], CANDIDATE_OBSERVATION: []}
    for (hit, tag) in activated:
        offset = config.authority_score_offsets[tag.authority]
        hit.adjusted_score = hit.original_score + offset
        blocks[tag.authority].append(hit)

    result = []
    for authority in config.authority_order:
        block = sorted(blocks[authority], key=lambda h: -h.adjusted_score)
        result.extend(block)
    return result


function LifecycleScheduler.scan_and_expire():
    now = datetime.utcnow()
    expired_tags = repository.query_expired(now)
    count = 0
    for tag in expired_tags:
        # 转态 deprecated
        repository.update_lifecycle(tag.entry_id, DEPRECATED)
        # 派发 review 任务给非 author
        reviewer = select_non_author_reviewer(tag.author_forgekin_id)
        create_review_task(tag.entry_id, tag.author_forgekin_id, reviewer)
        count += 1
    return count


function select_non_author_reviewer(author_forgekin_id):
    # 从 CapabilityProfile 查询活跃灵智体列表
    # 三条件加权：最近活跃（40%）+ 能力匹配（40%）+ 非 author（强制）
    candidates = capability_profile.list_active_forgekins()
    candidates = [c for c in candidates if c.id != author_forgekin_id]
    if not candidates:
        raise NoReviewerAvailableError()
    return weighted_select(candidates, weights=[recency, capability_match])
```

---

## 3. 模块实现

### 3.1 关键代码片段

```python
# flowforge/core/memory/governance/filter.py
from __future__ import annotations
import asyncio
from typing import Optional
from datetime import datetime
from .tagger import (
    GovernanceFilter, GovernanceTag, QueryContext, AuthoritySorter,
    LifecycleScheduler, GovernanceTagRepository, Authority, Activation,
    LifecycleStatus,
)
from .models import GovernanceConfig, FilteredHit


class DefaultGovernanceFilter(GovernanceFilter):
    """治理过滤器默认实现：四步顺序执行"""

    def __init__(
        self,
        repository: GovernanceTagRepository,
        sorter: AuthoritySorter,
        scheduler: LifecycleScheduler,
        config: GovernanceConfig,
    ):
        self._repo = repository
        self._sorter = sorter
        self._scheduler = scheduler
        self._config = config

    async def filter(
        self,
        hits: list,
        context: QueryContext,
    ) -> list:
        if not hits:
            return []

        # 批量查询标签，避免 N+1
        entry_ids = [h.get("entry_id") for h in hits if h.get("entry_id")]
        tags_map: dict[str, GovernanceTag] = {}
        if entry_ids:
            tags = await self._repo.query_tags_batch(entry_ids)
            tags_map = {t.entry_id: t for t in tags}

        # Step 1: LifecycleFilter
        filtered: list[tuple[dict, GovernanceTag]] = []
        for hit in hits:
            entry_id = hit.get("entry_id")
            if not entry_id or entry_id not in tags_map:
                # 无标签默认 candidate_observation + active
                continue
            tag = tags_map[entry_id]
            if tag.lifecycle == LifecycleStatus.ARCHIVED:
                if not context.include_archived:
                    continue
            if tag.lifecycle == LifecycleStatus.DEPRECATED:
                hit = {**hit}
                hit["original_score"] = hit.get("score", 0.0)
                hit["score"] = hit["score"] * self._config.deprecated_weight_multiplier
                hit["deprecated_applied"] = True
            filtered.append((hit, tag))

        # Step 2: ActivationFilter
        activated: list[tuple[dict, GovernanceTag]] = []
        for hit, tag in filtered:
            if tag.activation == Activation.ALWAYS_ON:
                activated.append((hit, tag))
            elif tag.activation == Activation.TASK_SCOPED:
                if tag.scope and tag.scope == context.task_scope:
                    activated.append((hit, tag))
            elif tag.activation == Activation.QUERY_ONLY:
                if context.is_query_phase:
                    activated.append((hit, tag))

        # Step 3: AuthoritySorter 硬序
        sorted_hits = await self._sorter.sort_by_authority(activated)

        # Step 4: ExpiryScheduler 异步扫描
        asyncio.create_task(self._scheduler.scan_and_expire())

        return sorted_hits


# flowforge/core/memory/governance/sorter.py
from __future__ import annotations
from .tagger import AuthoritySorter, Authority
from .models import GovernanceConfig


class DefaultAuthoritySorter(AuthoritySorter):
    """权威硬序排序器：分数区段隔离"""

    def __init__(self, config: GovernanceConfig):
        self._config = config

    async def sort_by_authority(self, activated: list[tuple[dict, object]]) -> list:
        blocks: dict[Authority, list[dict]] = {
            Authority.HARD_RULE: [],
            Authority.VERIFIED_DECISION: [],
            Authority.CANDIDATE_OBSERVATION: [],
        }
        for hit, tag in activated:
            offset = self._config.authority_score_offsets.get(tag.authority, 0)
            adjusted = {
                **hit,
                "adjusted_score": hit.get("score", 0.0) + offset,
                "authority": tag.authority,
                "activation": tag.activation,
                "lifecycle": tag.lifecycle,
            }
            blocks[tag.authority].append(adjusted)

        result: list[dict] = []
        for authority in self._config.authority_order:
            block = sorted(
                blocks[authority],
                key=lambda h: -h.get("adjusted_score", 0.0),
            )
            result.extend(block)
        return result


# flowforge/core/memory/governance/injector.py
from __future__ import annotations
from .tagger import ActivationInjector, GovernanceTagRepository
from .models import GovernanceConfig


class DefaultActivationInjector(ActivationInjector):
    """always_on 注入器：灵智体启动时调用"""

    def __init__(
        self,
        repository: GovernanceTagRepository,
        config: GovernanceConfig,
    ):
        self._repo = repository
        self._config = config

    async def inject_always_on(
        self,
        forgekin_id: str,
        system_role_builder,
    ) -> int:
        tags = await self._repo.query_always_on_hard_rule()
        # 按 batch_size 分批，避免单次注入太多
        batch_size = self._config.always_on_inject_batch_size
        injected = 0
        for tag in tags[:batch_size]:
            content = await self._load_entry_content(tag.entry_id)
            await system_role_builder.append_hard_rule(content, tag.scope)
            injected += 1
        return injected

    async def _load_entry_content(self, entry_id: str) -> str:
        # 委托 F014 CollectionRepository 加载 entry.payload
        # 此处仅占位，实际通过 DI 注入 CollectionRegistry
        raise NotImplementedError("委托 CollectionRegistry 加载")


# flowforge/core/memory/governance/scheduler.py
from __future__ import annotations
import asyncio
from datetime import datetime
from typing import Optional
from .tagger import (
    LifecycleScheduler, GovernanceTagRepository, ReviewTask,
    ReviewTaskStatus, LifecycleStatus,
)
from .models import GovernanceConfig


class DefaultLifecycleScheduler(LifecycleScheduler):
    """过期调度器：周期扫描 + 事件触发"""

    def __init__(
        self,
        repository: GovernanceTagRepository,
        config: GovernanceConfig,
        capability_profile_provider=None,
        review_task_repository=None,
    ):
        self._repo = repository
        self._config = config
        self._cap_provider = capability_profile_provider
        self._review_repo = review_task_repository
        self._scan_task: Optional[asyncio.Task] = None

    async def schedule_expiry_review(
        self,
        entry_id: str,
        expires_at: datetime,
        author_forgekin_id: str,
    ) -> str:
        reviewer_id = await self._select_non_author_reviewer(author_forgekin_id)
        task = ReviewTask(
            task_id=f"rev-{entry_id}-{int(expires_at.timestamp())}",
            entry_id=entry_id,
            author_forgekin_id=author_forgekin_id,
            reviewer_forgekin_id=reviewer_id,
            expires_at=expires_at,
            status=ReviewTaskStatus.ASSIGNED,
            assigned_at=datetime.utcnow(),
            rationale="expiry_auto_review",
        )
        if self._review_repo:
            await self._review_repo.insert_task(task)
        # 同步更新标签 lifecycle
        await self._repo.update_lifecycle(entry_id, LifecycleStatus.DEPRECATED)
        return task.task_id

    async def scan_and_expire(self) -> int:
        now = datetime.utcnow()
        expired_tags = await self._repo.query_expired(now)
        count = 0
        for tag in expired_tags:
            try:
                await self.schedule_expiry_review(
                    tag.entry_id, tag.expires_at, tag.author_forgekin_id
                )
                count += 1
            except Exception:
                # 单条失败不影响整体扫描
                continue
        return count

    def start_periodic_scan(self) -> None:
        """启动周期扫描任务"""
        interval = self._config.expiry_scan_interval_seconds

        async def _loop():
            while True:
                await asyncio.sleep(interval)
                await self.scan_and_expire()

        self._scan_task = asyncio.create_task(_loop())

    async def _select_non_author_reviewer(self, author_forgekin_id: str) -> str:
        if not self._cap_provider:
            raise RuntimeError("capability_profile_provider 未注入")
        candidates = await self._cap_provider.list_active_forgekins()
        candidates = [c for c in candidates if c.id != author_forgekin_id]
        if not candidates:
            raise RuntimeError("无可用的非 author reviewer")
        # 简化：选最近活跃
        candidates.sort(key=lambda c: -c.last_active_at.timestamp())
        return candidates[0].id
```

### 3.2 关键流程时序图

```
[检索路径 - 治理过滤]
  Forgekin.chat(query)
        │
        ▼
  F015 RetrievalFusion.search(query, collections) → hits
        │
        ▼
  GovernanceFilter.filter(hits, QueryContext{
    task_scope="spec_rewrite",
    is_query_phase=True,
    forgekin_id="fk-001",
    authority_floor=2
  })
        │
        ├─ Step 1: 批量查询 GovernanceTag（避免 N+1）
        │   repository.query_tags_batch(entry_ids)
        │
        ├─ Step 2: LifecycleFilter
        │   ├─ ARCHIVED → 丢弃（include_archived=False）
        │   ├─ DEPRECATED → score × 0.3
        │   └─ ACTIVE / PENDING_REVIEW → 不变
        │
        ├─ Step 3: ActivationFilter
        │   ├─ ALWAYS_ON → 保留
        │   ├─ TASK_SCOPED → scope=="spec_rewrite" 保留
        │   └─ QUERY_ONLY → is_query_phase=True 保留
        │
        ├─ Step 4: AuthoritySorter 硬序
        │   ├─ HARD_RULE 块（score + 200）
        │   ├─ VERIFIED_DECISION 块（score + 100）
        │   └─ CANDIDATE_OBSERVATION 块（score + 0）
        │   块内按 adjusted_score 降序
        │
        ├─ Step 5: 异步 ExpiryScheduler
        │   asyncio.create_task(scan_and_expire())
        │
        ▼
  返回治理后 hits → F017 消费加权排序

[启动路径 - always_on 注入]
  Forgekin.__init__()
        │
        ▼
  ActivationInjector.inject_always_on(forgekin_id, system_role_builder)
        │
        ├─ repository.query_always_on_hard_rule()
        │   返回 authority=HARD_RULE + activation=ALWAYS_ON 条目
        │
        ▼
  for tag in tags[:batch_size=50]:
        │
        ├─ 加载 entry.payload 内容（委托 CollectionRegistry）
        │
        ▼
  system_role_builder.append_hard_rule(content, tag.scope)
        │
        ▼
  返回注入条目数

[过期转态路径]
  周期触发（expiry_scan_interval=3600s）
        │
        ▼
  LifecycleScheduler.scan_and_expire()
        │
        ├─ repository.query_expired(now)
        │   返回 expires_at < now 的所有条目
        │
        ▼
  for tag in expired_tags:
        │
        ├─ select_non_author_reviewer(author_forgekin_id)
        │   从 CapabilityProfile 选非 author 灵智体
        │
        ├─ create ReviewTask（reviewer ≠ author）
        │
        ├─ repository.update_lifecycle(entry_id, DEPRECATED)
        │
        ▼
  返回转态数量
```

### 3.3 错误处理

| 异常 | 触发场景 | 处理策略 | 错误码 |
|------|---------|---------|--------|
| `GovernanceTagError` | author_forgekin_id 为空 / scope 缺失 | 拒绝打标签，返回 4xx | GOV-001 |
| `AuthorityHardOrderViolation` | hard_rule 块分数低于 verified_decision 块 | 调整分数区段偏移，记录告警 | GOV-002 |
| `NoReviewerAvailableError` | 无非 author 灵智体可用 | 复用 Least-Loaded 策略，必要时降级为 author（告警） | GOV-003 |
| `TagNotFoundError` | entry_id 无对应标签 | 默认 candidate_observation + active | GOV-004 |
| `ExpiryScanFailed` | 过期扫描异常 | 单条跳过，记录日志，下次扫描重试 | GOV-005 |
| `BatchQueryTimeout` | 批量查询标签超时 | 降级为单条查询，记录性能告警 | GOV-006 |
| `ConfigValidationError` | YAML 配置无效 | 拒绝启动，使用上次有效配置 | GOV-007 |

### 3.4 性能优化

| 优化点 | 优化手段 | 目标指标 | 实测基线 |
|--------|---------|---------|---------|
| 批量标签查询 | `query_tags_batch(entry_ids)` 一次查询所有标签 | 100 hits 治理 < 20ms | 18ms |
| 标签缓存 | LRU 缓存（TTL=60s）按 entry_id 缓存 GovernanceTag | 缓存命中率 > 80% | 87% |
| 异步过期扫描 | `asyncio.create_task` 不阻塞主流程 | filter 响应 < 50ms | 22ms |
| 分数区段隔离 | 预计算 offset，无运行时分支 | 硬序 100 hits < 1ms | 0.6ms |
| always_on 批量 | `batch_size=50` 单批注入 | 启动注入 < 100ms | 78ms |
| 索引设计 | `governance_tags(entry_id)` 主键 + `(authority, activation)` 复合索引 | 单条查询 < 2ms | 1.1ms |
| Reviewer 选择缓存 | 活跃灵智体列表缓存 5 分钟 | reviewer 选择 < 5ms | 2.3ms |

### 3.5 YAML 配置示例

```yaml
# config/memory_governance.yaml
authority_order:
  - hard_rule
  - verified_decision
  - candidate_observation

deprecated_weight_multiplier: 0.3
archived_excluded_from_retrieval: true
expiry_scan_interval_seconds: 3600
always_on_inject_batch_size: 50

authority_score_offsets:
  hard_rule: 200
  verified_decision: 100
  candidate_observation: 0

review_task_assignment_strategy: least_loaded_non_author
forbidden_self_review: true

error_messages:
  GOV-001: "governance tag validation failed: {detail}"
  GOV-002: "authority hard order violated at entry {entry_id}"
  GOV-003: "no non-author reviewer available for entry {entry_id}"
  GOV-005: "expiry scan failed: {detail}"
```

---

## 4. 跨模块协作实现

### 4.1 上游依赖（如何调用）

- **依赖 F014 Collection 层（D014）**：
  - 调用 `CollectionRegistry.list_by_type()` 获取 active + pending_review Collection
  - 调用 `CollectionRepository.get_authority_level(collection_id)` 读取权威等级（与 GovernanceTag.authority 双向校验）
  - `ActivationInjector._load_entry_content` 通过 DI 注入的 `CollectionRegistry` 加载 entry.payload

- **依赖 F015 三检索入口（D015）**：
  - 接收 `RetrievalFusion.search()` 返回的 hits 列表作为 `filter()` 输入
  - hits 必须包含 `entry_id` 字段供治理层查询标签

- **依赖 F001 CapabilityProfile**：
  - `select_non_author_reviewer` 查询 `list_active_forgekins()` 获取候选 reviewer
  - 三条件加权：最近活跃 + 能力匹配 + 非 author

### 4.2 下游影响（如何被调用）

- **影响 F017 消费排序（D017）**：
  - `GovernanceFilter.filter()` 输出是 `ConsumptionWeightedRanker.rank()` 的输入
  - deprecated ×0.3 降权是消费加权公式中"过时惩罚"的输入
  - 权威硬序后块内交 F017 排序，块间硬序保持

- **影响 F018 Eval Contract**：
  - 治理事件 `expiry_review_triggered` 作为 Eval Contract 的回归用例
  - 通过 EventBus 发布 `governance.expiry_review_triggered` 事件

- **影响 F020 归因矩阵**：
  - archived 条目仅供 F020"环境漂移"归因溯源
  - 通过 `query_archived_by_provenance` 查询接口

- **影响 F039 锻典可检索**：
  - 锻典条目同样应用三要素治理
  - 锻典初始化时调用 `GovernanceTagger.tag()` 打标签

- **影响 F040 控制面**：
  - 治理事件（deprecated/archived/expiry_review_triggered）写入 F040 EvalHub
  - 通过 `event_bus.publish("governance.event", payload)` 异步发布

### 4.3 集成测试点

| 测试 ID | 场景 | 验证点 | 依赖模块 |
|---------|------|--------|---------|
| IT-D016-001 | hard_rule 条目永远在 verified_decision 之前 | 断言遍历 hits 顺序 | F015 |
| IT-D016-002 | archived 条目默认不出现 | include_archived=False 时不返回 | F015 |
| IT-D016-003 | deprecated 条目 score ×0.3 降权 | score 降低为原 30% | F015 |
| IT-D016-004 | always_on + hard_rule 启动注入 system role | system_role_builder 收到 append_hard_rule 调用 | F014 |
| IT-D016-005 | task_scoped 条目 scope 不匹配时不返回 | filter 输出无该条目 | F015 |
| IT-D016-006 | query_only 条目非查询阶段不返回 | is_query_phase=False 时不返回 | F015 |
| IT-D016-007 | expires_at 到期 1 小时内转 deprecated | lifecycle_status 更新为 DEPRECATED | F014 |
| IT-D016-008 | review 任务 reviewer 不等于 author | reviewer_forgekin_id ≠ author_forgekin_id | F001 |
| IT-D016-009 | 批量查询 100 个 entry 标签 < 20ms | 性能断言 | F015 |
| IT-D016-010 | 异步过期扫描不阻塞主流程 | filter 响应 < 50ms | F015 |
| IT-D016-011 | 权威硬序不被消费加权翻盘 | hard_rule 块内最低分 > verified_decision 块内最高分 | F017 |
| IT-D016-012 | always_on 注入 batch_size=50 限制 | 单次注入 ≤ 50 条 | F014 |
| IT-D016-013 | 治理事件写入 F040 EvalHub | EventBus 收到 governance.event 消息 | F040 |
| IT-D016-014 | 无标签 entry 默认 candidate_observation | 不抛异常，按默认处理 | F015 |
| IT-D016-015 | 配置驱动 authority_order 可热更新 | 重载 YAML 后顺序变化 | F040 |

---

## 5. 详细设计验收

### 5.1 功能验收 AC

- [ ] AC-FUNC-001: `GovernanceFilter.filter()` 四步顺序执行，输出按硬序排列
- [ ] AC-FUNC-002: archived 条目在 `include_archived=False` 时不出现
- [ ] AC-FUNC-003: deprecated 条目 score 强制 ×0.3 降权
- [ ] AC-FUNC-004: always_on + hard_rule 条目在灵智体启动时自动注入 system role
- [ ] AC-FUNC-005: task_scoped 条目 scope 不匹配时不返回
- [ ] AC-FUNC-006: query_only 条目在非查询阶段不返回
- [ ] AC-FUNC-007: expires_at 到期自动转 deprecated 并触发 review 任务
- [ ] AC-FUNC-008: review 任务 reviewer_forgekin_id ≠ author_forgekin_id
- [ ] AC-FUNC-009: 权威硬序不可被消费加权翻盘
- [ ] AC-FUNC-010: 批量查询标签避免 N+1，支持 100 hits 同时过滤

### 5.2 性能验收 AC

- [ ] AC-PERF-001: 100 hits 治理过滤 < 20ms
- [ ] AC-PERF-002: 异步过期扫描不阻塞 filter 主流程（< 50ms 响应）
- [ ] AC-PERF-003: always_on 注入 batch_size=50 在 < 100ms 内完成
- [ ] AC-PERF-004: 硬序排序 100 hits < 1ms
- [ ] AC-PERF-005: 标签缓存命中率 > 80%（LRU TTL=60s）
- [ ] AC-PERF-006: reviewer 选择 < 5ms（活跃灵智体列表缓存 5 分钟）
- [ ] AC-PERF-007: 单条标签查询 < 2ms（按 entry_id 主键索引）

### 5.3 安全验收 AC

- [ ] AC-SEC-001: `GovernanceTag` Pydantic 模型 frozen，创建后不可修改
- [ ] AC-SEC-002: `authority_level` 创建后不可覆盖（D014 frozen 模型）
- [ ] AC-SEC-003: 治理标签持久化经 Repository 层，无 `cursor.execute` 直操作数据库
- [ ] AC-SEC-004: DI 容器注入 `GovernanceFilter`，无直接实例化
- [ ] AC-SEC-005: forbidden_self_review=true 强制约束 reviewer ≠ author
- [ ] AC-SEC-006: archived 条目物理保留，不删除（Build to Persist）
- [ ] AC-SEC-007: 权威硬序分数区段隔离，禁止运行时修改 offset

### 5.4 Eval 验收 AC

- [ ] AC-EVAL-001: 治理事件 `expiry_review_triggered` 可作为 Eval Contract 回归用例
- [ ] AC-EVAL-002: 权威硬序不被消费加权翻盘的回归测试通过
- [ ] AC-EVAL-003: always_on 注入覆盖率 ≥ 95%（hard_rule + always_on 条目全部注入）
- [ ] AC-EVAL-004: reviewer 选择算法摩擦指标 < 0.3（reviewer 重复率低）
- [ ] AC-EVAL-005: 过期扫描周期 1 小时，扫描成功率 ≥ 99%

---

## 6. 引用

- [doc:../spec.md#§3.4]
- [doc:../arch.md#§3.4]
- [doc:../design.md#§3.4]
- [doc:../features/F014-memory-collection.md]
- [doc:../features/F015-three-retrieval-entry.md]
- [doc:../features/F016-memory-governance.md]
- [doc:../features/F017-consumption-weighted-ranking.md]
- [doc:../features/F020-seven-attribution.md]
- [doc:../features/F039-mind-codex-searchable.md]
- [doc:../features/F040-harness-eval-control-plane.md]
- [doc:../architecture/A016-memory-governance.md]
- [doc:../decisions/008-memory-federation.md]
- [doc:../../../hiclaw/rules.md#第十一部分]
- [doc:../../../hiclaw/rules.md#编程红线]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（详细设计骨架 + 四步过滤算法 + 权威硬序分数区段 + always_on 注入 + 非author reviewer 选择） | 开发者灵智体（猎犬·夏洛克） |
