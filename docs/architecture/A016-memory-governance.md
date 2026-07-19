# A016: 记忆治理三要素架构设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师灵智体（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.4]（FR-CORE-004）
> **对应 arch.md**: [doc:../arch.md#§3.4]
> **对应 design.md**: [doc:../design.md#§3.4]（待创建）
> **对应 Feature**: [doc:../features/F016-memory-governance.md]（同号 Feature 级 SRS）
> **对应详细设计**: [doc:../design/D016-memory-governance.md]（待创建，同号 Feature 级 SDD）
> **依赖 ADR**: [doc:../decisions/008-memory-federation.md]
> **9 大点名称修订**: 已应用（双轨命名 + AI 术语优先 + 弱化万物 + 去 AGI 化）

---

## 1. 架构上下文

### 1.1 架构问题

记忆系统的核心治理问题是"旧记忆和新记忆一视同仁"。v7.0 记忆无权威等级、无触发方式、无生命周期，导致三类架构故障：

1. **权威倒挂**：候选观察（authority 低）排在铁律（authority 高）前面，灵智体读了错误观察。
2. **触发失效**：永远在场的铁律未注入系统提示，仅查询时出现的候选观察被错误地塞进 system role。
3. **僵尸知识**：3 年前的过时决策与今天的最新决策同权重排序，灵智体引用过时知识。

本架构解决的核心问题：**如何在 L2 治理层形式化"权威性 / 触发方式 / 生命周期"三要素**，使检索结果在 RRF 融合之后经过权威硬序、触发过滤、生命周期衰减三步治理，让旧记忆和新记忆不再一视同仁。

### 1.2 架构约束

- **单向依赖约束**：治理层依赖 F014 Collection 层与 F015 检索层，禁止被 F014/F015 反向依赖。
- **铁律优先约束**：authority=hard_rule 的条目必须在最终排序中硬序置顶，不被 RRF 或消费加权翻盘。
- **配置驱动约束**：authority_order、deprecated_weight_multiplier、archived_excluded_from_retrieval 等策略外置 YAML。
- **过期自动转态约束**：expires_at 到期必须自动转 deprecated 并触发 review 任务，不允许"过期不处理"。
- **review 任务指派约束**：过期 review 必须指派给非原作者灵智体（防止自我确认偏误，铁律"不能自己 review 自己"）。

### 1.3 架构影响

- **对 F014 Collection 层**：lifecycle_status 字段成为治理层的物理承载，F014 在 register 时需校验 lifecycle 取值。
- **对 F015 三检索入口**：authority_floor 过滤先于 RRF 融合，治理层在 RRF 之后做权威硬序。
- **对 F017 消费排序**：deprecated 条目强制 ×0.3 降权，是消费加权公式中"过时惩罚"的输入。
- **对 F018 Eval Contract**：治理层的 review 任务可作为 Eval Contract 的回归用例（验证过期 review 触发）。
- **对 F040 控制面**：治理事件（deprecated/archived/expiry_review_triggered）写入 F040 Eval Hub。

---

## 2. 架构设计

### 2.1 组件架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│ 上层调用方                                                           │
│  F017 Ranker  F039 CodexSearch  Forgekin                            │
└──────────┬──────────────────────────────────────────────────────────┘
           │ GovernanceFilter.filter(hits, context)
           ▼
┌─────────────────────────────────────────────────────────────────────┐
│ L2: GovernanceFilter（三要素过滤 + 权威硬序）                        │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ Step 1: LifecycleFilter  ── archived 丢弃                   │  │
│  │                            ── deprecated ×0.3 降权           │  │
│  │ Step 2: ActivationFilter  ── always_on 始终保留              │  │
│  │                            ── task_scoped 仅任务范围匹配保留 │  │
│  │                            ── query_only 仅查询时保留        │  │
│  │ Step 3: AuthoritySorter   ── hard_rule > verified_decision  │  │
│  │                            ── verified > candidate           │  │
│  │ Step 4: ExpiryScheduler   ── 检查 expires_at，到期转态       │  │
│  └─────────────────────────────────────────────────────────────┘  │
└───┬──────────────────┬──────────────────┬──────────────────────────┘
    │ tag               │ schedule         │ emit_event
    ▼                  ▼                  ▼
┌────────────┐  ┌────────────┐    ┌──────────────────┐
│Governance  │  │Lifecycle   │    │ GovernanceEvent  │
│Tagger      │  │Scheduler   │    │ Bus              │
│（打三要素标）│  │（过期转态） │    │（联动 F017/F040）│
└─────┬──────┘  └─────┬──────┘    └────────┬─────────┘
      │               │                    │
      ▼               ▼                    ▼
┌─────────────────────────────────────────────────────┐
│ F014 CollectionRegistry（读取 lifecycle/authority） │
└─────────────────────────────────────────────────────┘
```

### 2.2 关键架构决策

- **决策 1：三要素打在 entry 上而非 Collection 上**。authority_level 在 Collection 级继承（F014 决策 2），但 activation 与 lifecycle_status 在 entry 级独立。理由：同一 Collection 内不同条目可能处于不同生命周期（如 ADR-001 已 archived / ADR-002 active）。
- **决策 2：硬序而非加权**。authority 排序用硬序（hard_rule > verified_decision > candidate_observation），不用加权求和。理由：铁律不可被消费加权翻盘，是 Build to Persist 的"不可妥协"约束。
- **决策 3：deprecated ×0.3 而非归零**。deprecated 条目仍可被检索到但降权，理由：某些 deprecated 知识仍可能有用（如"曾经的方案是什么"），完全归零会让灵智体无法引用历史。
- **决策 4：archived 完全排除**。archived 不参与检索但物理保留，理由：archived 是 Build to Persist 的归档态，仅供 F020 归因矩阵的"环境漂移"溯源，不参与日常检索。
- **决策 5：过期 review 指派给非原作者**。review 任务自动指派给非 author_forgekin_id 的灵智体，防止自我确认偏误。理由：roleagent.md 第 2 章铁律"不能自己 review 自己"。
- **决策 6：always_on 自动注入 system role**。authority=hard_rule + activation=always_on 的条目在灵智体启动时自动注入 system role，不依赖查询触发。理由：铁律必须在每次执行时在场，不能靠灵智体"想起来查"。

### 2.3 架构不变量

- authority 排序必须用硬序，hard_rule 必须在所有 verified_decision 之前，verified_decision 必须在所有 candidate_observation 之前。
- archived 状态条目必须完全不参与检索（默认 include_archived=False）。
- deprecated 条目必须强制降权 ×0.3（multiplier 从配置加载）。
- expires_at 到期必须自动转 deprecated 并触发 review 任务。
- review 任务必须指派给非 author_forgekin_id 的灵智体。
- always_on + hard_rule 条目必须在灵智体启动时自动注入 system role。

---

## 3. 模块设计

### 3.1 模块边界

| 模块 | 路径 | 职责 | 对外暴露 |
|------|------|------|---------|
| GovernanceTagger | `flowforge/core/memory/governance/tagger.py` | 给 entry 打三要素标签 | `tag` |
| GovernanceFilter | `flowforge/core/memory/governance/filter.py` | 检索时三要素过滤 + 权威硬序 | `filter` |
| LifecycleScheduler | `flowforge/core/memory/governance/scheduler.py` | 过期自动转态 + review 任务派发 | `schedule_expiry_review` |
| AuthoritySorter | `flowforge/core/memory/governance/sorter.py` | 权威硬序排序 | `sort_by_authority` |
| ActivationInjector | `flowforge/core/memory/governance/injector.py` | always_on 自动注入 system role | `inject_always_on` |
| GovernanceConfigLoader | `flowforge/core/memory/governance/config.py` | YAML 配置加载 | `load_governance_config` |

### 3.2 接口契约

```python
from abc import ABC, abstractmethod
from typing import Optional
from datetime import datetime
from pydantic import BaseModel
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
    entry_id: str
    authority: Authority
    activation: Activation
    lifecycle: LifecycleStatus
    last_verified_at: datetime
    expires_at: Optional[datetime] = None
    author_forgekin_id: str


class QueryContext(BaseModel):
    task_scope: Optional[str]
    is_query_phase: bool = True
    forgekin_id: str


class GovernanceTagger(ABC):
    @abstractmethod
    async def tag(self, entry_id: str, tag: GovernanceTag) -> None:
        """给 entry 打三要素标签；author_forgekin_id 必须非空"""


class GovernanceFilter(ABC):
    @abstractmethod
    async def filter(
        self, hits: list, context: QueryContext
    ) -> list:
        """
        四步过滤：
        1. LifecycleFilter: archived 丢弃 / deprecated ×0.3
        2. ActivationFilter: always_on 保留 / task_scoped 任务范围匹配 / query_only 仅查询时
        3. AuthoritySorter: hard_rule > verified_decision > candidate_observation 硬序
        4. ExpiryScheduler: 检查 expires_at 到期转态
        """


class LifecycleScheduler(ABC):
    @abstractmethod
    async def schedule_expiry_review(
        self, entry_id: str, expires_at: datetime, author_forgekin_id: str
    ) -> str:
        """到期转 deprecated + 派发 review 任务给非 author 灵智体"""


class ActivationInjector(ABC):
    @abstractmethod
    async def inject_always_on(
        self, forgekin_id: str, system_role_builder: object
    ) -> None:
        """authority=hard_rule + activation=always_on 条目自动注入 system role"""
```

### 3.3 数据流

```
[检索路径 - 治理过滤]
  F015 RetrievalFusion.search() → hits
        │
        ▼
  GovernanceFilter.filter(hits, QueryContext{task_scope, forgekin_id})
        │
        ▼
  Step 1: LifecycleFilter
   ├─ archived → 丢弃
   ├─ deprecated → score × 0.3
   └─ active / pending_review → 不变
        │
        ▼
  Step 2: ActivationFilter
   ├─ always_on → 保留
   ├─ task_scoped → 仅当 context.task_scope 匹配 entry.scope 时保留
   └─ query_only → 仅当 context.is_query_phase=True 时保留
        │
        ▼
  Step 3: AuthoritySorter 硬序
   hard_rule 块 → verified_decision 块 → candidate_observation 块
   （块内按 F017 消费加权排序）
        │
        ▼
  Step 4: ExpiryScheduler（异步）
   检查 expires_at < now() 的条目
        │
        ▼
  转态 deprecated + 派发 review 任务（非 author）
        │
        ▼
  返回治理后的 hits（交 F017 消费加权排序）

[启动路径 - always_on 注入]
  Forgekin.__init__()
        │
        ▼
  ActivationInjector.inject_always_on(forgekin_id, system_role_builder)
        │
        ├─ 查询 authority=hard_rule + activation=always_on 条目
        │
        ▼
  注入 system role（铁律永远在场）
```

---

## 4. 跨模块协作

### 4.1 上游依赖

- 依赖 **F014 Collection 层**：读取 entry 的 lifecycle_status、authority_level、author_forgekin_id 字段。
- 依赖 **F015 三检索入口**：接收 RRF 融合后的 hits 列表作为输入。
- 依赖 **F001 CapabilityProfile**：派发 review 任务时查询非 author 灵智体列表。

### 4.2 下游影响

- 影响 **F017 消费排序**：deprecated 条目 ×0.3 降权是消费加权公式中"过时惩罚"的输入；权威硬序后块内交 F017 排序。
- 影响 **F018 Eval Contract**：治理事件（expiry_review_triggered）可作为 Eval Contract 的回归用例。
- 影响 **F020 归因矩阵**：archived 条目仅供 F020"环境漂移"归因溯源，不参与日常检索。
- 影响 **F039 锻典可检索**：锻典条目同样应用三要素治理，确保过时锻典被识别。
- 影响 **F040 控制面**：治理事件（deprecated/archived/expiry_review_triggered）写入 F040 Eval Hub。

### 4.3 跨模块不变量

- 治理过滤必须在 F015 RRF 融合之后、F017 消费加权之前执行。
- 权威硬序必须不可被 F017 消费加权翻盘（hard_rule 永远在 verified_decision 之前）。
- review 任务指派的灵智体 ID 必须不等于 author_forgekin_id。
- always_on + hard_rule 条目必须在灵智体首次调用前完成注入。
- expires_at 到期转态必须在 24 小时内完成（不允许长期滞后）。

---

## 5. 架构验收

### 5.1 架构契约验收

- [ ] AC-1: 单向依赖通过——`flowforge/core/memory/governance/` 不 import F015/F017/F018/F020/F039/F040 任何模块。
- [ ] AC-2: DI 容器注入通过——`GovernanceFilter` 通过 `inject("governance_filter")` 获取。
- [ ] AC-3: Repository 层通过——治理标签持久化经 Repository，不直操作数据库。
- [ ] AC-4: 配置驱动通过——authority_order / deprecated_weight_multiplier / archived_excluded 从 `config/memory_governance.yaml` 加载。
- [ ] AC-5: review 任务派发逻辑覆盖 5 种"非 author 灵智体"场景。

### 5.2 架构不变量验收

- [ ] AC-6: authority 硬序通过——hard_rule 条目永远在 verified_decision 之前（断言遍历）。
- [ ] AC-7: archived 条目在默认检索中不出现（include_archived=False）。
- [ ] AC-8: deprecated 条目 score × 0.3 降权生效。
- [ ] AC-9: expires_at 到期 24 小时内自动转 deprecated。
- [ ] AC-10: review 任务指派的 forgekin_id ≠ author_forgekin_id（单测覆盖）。
- [ ] AC-11: always_on + hard_rule 条目在灵智体启动时自动注入 system role（单测覆盖）。

---

## 6. 引用

- [doc:../spec.md#§3.4]
- [doc:../arch.md#§3.4]
- [doc:../features/F014-memory-collection.md]
- [doc:../features/F015-three-retrieval-entry.md]
- [doc:../features/F016-memory-governance.md]
- [doc:../features/F017-consumption-weighted-ranking.md]
- [doc:../features/F020-seven-attribution.md]
- [doc:../features/F039-mind-codex-searchable.md]
- [doc:../decisions/008-memory-federation.md]
- [doc:../../../hiclaw/rules.md#第十一部分]
- [doc:../../../hiclaw/rules.md#编程红线]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（架构骨架 + 三要素形式化 + 权威硬序 + always_on 注入） | 架构师灵智体（猫头鹰·鲁班） |
