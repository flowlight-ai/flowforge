---
feature_ids: [F017]
related_features: [F014, F015, F016]
topics: [memory, governance, retention, decay, conflict, mind-codex, forge-method, forge-codex]
doc_kind: spec
created: 2026-07-21
---

# F017: 记忆治理 + MindCodex（Memory Governance + MindCodex）

> **状态**: spec | **负责人**: 架构师Forgekin | **优先级**: P0
> **依赖 ADR**: [doc:decisions/008-memory-federation.md]
> **依据**: operator 7 条不可妥协原则 + roleagent.md 第4章 多域记忆联邦
> **关联 VISION**: [doc:VISION.md#3]（持续身份：EchoStore 治理 + MindCodex 蒸馏）

## 1. 上下文

### 1.1 问题陈述

`[doc:roleagent.md#第4章]` 指出：记忆系统若无治理层，会无限膨胀——过期知识永远排在前面，矛盾知识无人解决，熵增不可逆。同时，元认知记忆域（`MemoryDomain.FORGE_CODEX`）需要独立承载**蒸馏方法库**——从经验中提炼的可复用方法论（ForgeMethod），由**MindCodex**承载，与扁平 `MemoryEntry` 形态不同。

FlowForge 需要两个独立但协同的子系统：

1. **`MemoryGovernor`**：对 F014 `MemoryCollection` 执行 retention / decay / conflict 三原语治理
2. **`MindCodex`**：独立承载 `ForgeMethod`结构化蒸馏记录，对应 `MemoryDomain.FORGE_CODEX` 域

### 1.2 当前痛点

- **无治理层**：知识只增不减，过期知识永远排在前面，矛盾知识无人解决
- **无衰减机制**：`importance` 一旦写入永不变化，无法建模遗忘曲线
- **无冲突检测**：同域同标签的矛盾条目共存，agent 检索时收到冲突信号
- **元认知记忆域无载体**：`MemoryDomain.FORGE_CODEX` 域无独立实现，蒸馏方法论无处沉淀
- **SpiritForge 无下游消费者**：经验蒸馏产出的 ForgeMethod 无库可入

### 1.3 不做的影响

- 违反 `[doc:roleagent.md#第4章]` 熵增抑制主张——记忆系统无限膨胀
- F016 消费加权的 `importance` 项永不变化，老知识永远垄断排序
- 同域同标签冲突条目共存，agent 检索收到矛盾信号，决策质量退化
- SpiritForge 蒸馏产出的 ForgeMethod 无库可入，元认知记忆域形同虚设
- operator "画像必须有记忆系统支撑"指示在元认知层断裂

## 2. 决策

### 2.1 核心设计

落地两个独立子系统：

**子系统一：`MemoryGovernor`（治理原语）**

- **`apply_retention(collection, RetentionPolicy)`**：按 `max_entries` / `max_age_seconds` / `min_importance` 三重上限淘汰；淘汰顺序为低 importance 优先、次按 `created_at` 最旧优先；返回淘汰条目数
- **`apply_decay(collection, DecayPolicy)`**：对超过 `decay_interval_seconds`（默认 3600s）的条目按 `decay_rate`（默认 0.95）乘性衰减 `importance`，建模遗忘曲线
- **`detect_conflicts(collection)`**：按 `(domain, frozenset(tags))` 分组，组内多于一条即为冲突
- **`ConflictResolver.resolve(conflicting)`**：最高 `importance` 胜出；平局按 `created_at` 最新；再平局按 `entry_id` 字典序（确定性）
- **frozen dataclass 策略**：`RetentionPolicy` 与 `DecayPolicy` 为 `frozen=True`，可跨 collection 共享而不产生意外副作用

**子系统二：`MindCodex`— 蒸馏知识库**

- **`ForgeMethod`数据类**：`name` / `domain` / `description` / `method_id` / `steps` / `preconditions` / `postconditions` / `evidence` / `created_at` / `usage_count` / `success_rate` 十一字段
- **`add_method(method)`**：注册方法，`success_rate` clamp 到 `[0.0, 1.0]`；空 `name` / `domain` 或重复 `method_id` 抛 `MemoryError`
- **`search(query, top_k=5)`**：基于子串计数排序（`name + description + steps` 拼接后小写化），无 embedding 依赖
- **`get(method_id)` / `list_by_domain(domain)` / `count()` / `clear()`**：标准库操作
- **对应 `MemoryDomain.FORGE_CODEX` 域**：MindCodex独立承载，不写入 F014 `MemoryCollection`（结构化记录与扁平 `MemoryEntry` 形态不同）
- **`usage_count` / `success_rate` 由调用方更新**：在 loop replay 后由SpiritForge 调用方更新，MindCodex本身不自动更新

### 2.2 关键接口

```python
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from flowforge.core.memory.collection import MemoryCollection, MemoryEntry
from flowforge.core.errors import MemoryError


# ============ 子系统一：治理原语 ============

@dataclass(frozen=True)
class RetentionPolicy:
    """Retention policy — evict entries that violate any of these caps.

    max_entries      — hard cap on collection size; lowest-importance
                       entries are evicted first (None = no size cap)
    max_age_seconds  — evict entries older than this (None = no age cap)
    min_importance   — evict entries with importance strictly below this
    """

    max_entries: int | None = None
    max_age_seconds: float | None = None
    min_importance: float = 0.0


@dataclass(frozen=True)
class DecayPolicy:
    """Decay policy — multiplicative importance decay.

    decay_rate               — factor applied each pass (0.0..1.0)
    decay_interval_seconds   — only entries older than this are decayed
    """

    decay_rate: float = 0.95
    decay_interval_seconds: float = 3600.0


class ConflictResolver:
    """Resolve conflicts among entries sharing domain + tag set.

    Selection rule: highest importance wins; ties broken by
    most-recently-created; further ties broken by entry_id (deterministic).
    """

    def resolve(self, conflicting: list[MemoryEntry]) -> MemoryEntry:
        if not conflicting:
            raise ValueError("Cannot resolve an empty conflict set")
        return max(
            conflicting,
            key=lambda e: (e.importance, e.created_at, e.entry_id),
        )


class MemoryGovernor:
    """Applies retention / decay / conflict detection over a collection."""

    def apply_retention(
        self,
        collection: MemoryCollection,
        policy: RetentionPolicy,
    ) -> int:
        """Apply the retention policy; return the number of entries removed.

        Eviction order:
        1. Entries violating max_age_seconds or min_importance.
        2. If still over max_entries, evict the lowest-importance (then
           oldest-created) survivors until under the cap.
        """
        ...

    def apply_decay(
        self,
        collection: MemoryCollection,
        policy: DecayPolicy,
    ) -> None:
        """Decay importance of entries older than decay_interval_seconds.

        entry.importance = max(0.0, entry.importance * policy.decay_rate)
        """
        ...

    def detect_conflicts(
        self,
        collection: MemoryCollection,
    ) -> list[list[MemoryEntry]]:
        """Group entries by (domain, frozenset(tags)).

        Any group with more than one entry is a conflict.
        """
        ...


# ============ 子系统二：MindCodex ============

import uuid


@dataclass
class ForgeMethod:
    """One distilled method — procedural memory record.

    success_rate is clamped to [0.0, 1.0] at add_method() time. usage_count
    and success_rate are updated by callers (e.g. after a loop replay).
    """

    name: str
    domain: str
    description: str = ""
    method_id: str = field(
        default_factory=lambda: f"method-{uuid.uuid4().hex[:12]}"
    )
    steps: list[str] = field(default_factory=list)
    preconditions: list[str] = field(default_factory=list)
    postconditions: list[str] = field(default_factory=list)
    evidence: list[str] = field(default_factory=list)
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    usage_count: int = 0
    success_rate: float = 0.0  # 0.0..1.0


class MindCodex:
    """Searchable in-memory library of ForgeMethods."""

    def __init__(self) -> None:
        self._by_id: dict[str, ForgeMethod] = {}

    def add_method(self, method: ForgeMethod) -> str:
        """Register a method; returns method_id.

        Raises MemoryError on empty name/domain or duplicate method_id.
        success_rate is clamped into [0.0, 1.0].
        """
        ...

    def search(self, query: str, top_k: int = 5) -> list[ForgeMethod]:
        """Return methods whose name / description / steps contain the query.

        Ranking is crude substring count — sufficient for in-memory codex
        inspection and consistent with the federation's no-embedding rule.
        """
        ...

    def get(self, method_id: str) -> ForgeMethod: ...
    def list_by_domain(self, domain: str) -> list[ForgeMethod]: ...
    def count(self) -> int: ...
    def clear(self) -> None: ...
```

**MindCodex与EchoStore的边界**：EchoStore（F014 EPISODIC 域）承载事件型扁平记忆（`MemoryEntry`），MindCodex 承载结构化蒸馏方法论（`ForgeMethod`）。SpiritForge 从EchoStore中蒸馏经验，产出 ForgeMethod 注册到MindCodex——这是 `[doc:decisions/012-naming-fusion.md]` Forge Nurturing体系的记忆层闭环。

## 3. 验收标准

### Phase A（治理 + MindCodex实现）

- [ ] AC-A1: `RetentionPolicy` 为 `frozen=True` dataclass，三字段（`max_entries` / `max_age_seconds` / `min_importance`），默认值分别为 `None` / `None` / `0.0`
- [ ] AC-A2: `DecayPolicy` 为 `frozen=True` dataclass，两字段（`decay_rate=0.95` / `decay_interval_seconds=3600.0`）
- [ ] AC-A3: `MemoryGovernor.apply_retention()` 返回淘汰条目数；Pass 1 淘汰违反 `max_age_seconds` 或 `min_importance` 的条目；Pass 2 在超 `max_entries` 时按 `(importance, created_at)` 升序淘汰
- [ ] AC-A4: `MemoryGovernor.apply_decay()` 对 `age >= decay_interval_seconds` 的条目执行 `importance = max(0.0, importance * decay_rate)`；新建条目（age < interval）不衰减
- [ ] AC-A5: `MemoryGovernor.detect_conflicts()` 按 `(domain, frozenset(tags))` 分组，返回组内条目数 > 1 的组列表
- [ ] AC-A6: `ConflictResolver.resolve()` 选择规则：最高 `importance` → 最新 `created_at` → `entry_id` 字典序；空列表抛 `ValueError`
- [ ] AC-A7: `ForgeMethod` dataclass 十一字段齐全（name / domain / description / method_id / steps / preconditions / postconditions / evidence / created_at / usage_count / success_rate），`method_id` 默认 `method-{uuid4 hex[:12]}` 格式
- [ ] AC-A8: `MindCodex.add_method()` 对 `success_rate` clamp 到 `[0.0, 1.0]`；空 `name` / `domain` 或重复 `method_id` 抛 `MemoryError`
- [ ] AC-A9: `MindCodex.search()` 基于 `name + description + steps` 拼接小写化后的子串计数排序，默认 `top_k=5`，空 `query` 返回空列表
- [ ] AC-A10: `MindCodex` 提供 `get()` / `list_by_domain()` / `count()` / `clear()` 标准库操作
- [ ] AC-A11: 模块为纯 Python，无 LLM / 无外部 embedding 依赖；日志通过 `flowforge.core.tracing.get_logger` 注入 `trace_id`

### Phase B（联邦集成 + E2E）

- [ ] AC-B1: `apply_retention()` 在千级 collection 上延迟 < 100ms
- [ ] AC-B2: `apply_decay()` 在千级 collection 上延迟 < 50ms
- [ ] AC-B3: `detect_conflicts()` + `ConflictResolver.resolve()` 端到端——同域同标签冲突组检测到，并按规则选出 winner
- [ ] AC-B4: `apply_decay()` 衰减后的 `importance` 反映到 F016 `ConsumptionWeightedRanker` 排序中（衰减条目排名下降）
- [ ] AC-B5: MindCodex 与EchoStore 边界清晰——`ForgeMethod` 不写入 `MemoryCollection`，`MemoryEntry` 不写入 `MindCodex`
- [ ] AC-B6: E2E 测试——SpiritForge 从EchoStore蒸馏经验，产出 ForgeMethod 注册到MindCodex，MindCodex `search()` 可检索到该方法
- [ ] AC-B7: 遵守 T1-T8 测试铁律（真实 LLM 调用、真实场景数据、不跳过验证、不 Mock 工具、采集完整指标、LLM 生成内容经 LLM 审核、Web 功能操控浏览器验证 DOM）

## 4. 依赖

- **Evolved from**: 无
- **Blocked by**: F014（`MemoryCollection` / `MemoryEntry` 基底，治理操作对象）
- **Related**: F015（三检索入口，`detect_conflicts` 不阻塞正常检索，仅在 governance 主动调用时触发）、F016（消费加权排序，`apply_decay` 衰减 `importance` 后影响 ranker 排序）

## 5. 风险

| 风险 | 缓解 |
|------|------|
| `(domain, frozenset(tags))` 冲突分组可能误判（同标签但非冲突） | `ConflictResolver` 仅在 governance 主动调用时触发，不阻塞正常检索；P2 演进为语义冲突检测 |
| `apply_decay` 乘性衰减可能让重要条目 importance 趋零 | 调用方可设 `min_importance` 保护阈值；P2 演进为分段衰减 |
| `MindCodex.search()` 子串计数排序在大库上召回质量差 | P1 阶段可接受（MindCodex规模小），P2 演进为 TF-IDF 或向量索引 |
| `ForgeMethod.usage_count` / `success_rate` 不自动更新 | 设计取舍：由SpiritForge 在 loop replay 后调用方更新，避免自动更新引入隐藏副作用 |
| `RetentionPolicy` 三重上限叠加可能淘汰过多 | 调用方按场景配置，P2 提供策略预设 |
| MindCodex与EchoStore边界模糊可能导致调用方误用 | 文档明确：`MemoryEntry` → EchoStore，`ForgeMethod` → MindCodex，不可混用 |

## 6. Open Questions

| # | 问题 | 状态 |
|---|------|------|
| OQ-1 | `apply_decay` 是否应支持按 `MemoryDomain` 区分衰减率？ | ⬜ 未定（P2 演进项） |
| OQ-2 | `ConflictResolver.resolve()` 是否应支持"合并"而非"选 winner"策略？ | ⬜ 未定（P2 演进项） |
| OQ-3 | MindCodex 是否需要持久化（markdown / sqlite）？ | ⬜ 未定（P2 演进项） |
| OQ-4 | `ForgeMethod.success_rate` 更新时机是否应由SpiritForge 自动触发？ | 🟡 已定：由调用方更新，MindCodex不自动更新 |
| OQ-5 | MindCodex是否需要与 F015 三检索入口集成（如 `CodexRetriever`）？ | ⬜ 未定（P2 演进项） |

## 7. Key Decisions

| # | 决策 | 理由 | 日期 |
|---|------|------|------|
| KD-1 | `RetentionPolicy` / `DecayPolicy` 为 `frozen=True` | 可跨 collection 共享而不产生意外副作用 | 2026-07-21 |
| KD-2 | `apply_retention` 两阶段淘汰（age+importance → size cap） | 优先淘汰明确违规条目，再处理 size 溢出 | 2026-07-21 |
| KD-3 | `apply_decay` 默认 `decay_rate=0.95` / `interval=3600s` | 建模遗忘曲线，1 小时内新建条目不衰减 | 2026-07-21 |
| KD-4 | `detect_conflicts` 按 `(domain, frozenset(tags))` 分组 | 同域同标签暗示重复或竞争记忆 | 2026-07-21 |
| KD-5 | `ConflictResolver` 选择规则：importance → created_at → entry_id | 确定性 tiebreaker，保证测试可重现 | 2026-07-21 |
| KD-6 | MindCodex 独立承载 `MemoryDomain.FORGE_CODEX` 域 | `ForgeMethod` 结构化记录与扁平 `MemoryEntry` 形态不同 | 2026-07-21 |
| KD-7 | `MindCodex.search()` 子串计数排序，无 embedding | 与联邦 no-embedding 规则一致，P1 阶段MindCodex规模小 | 2026-07-21 |
| KD-8 | `ForgeMethod.usage_count` / `success_rate` 由调用方更新 | 避免自动更新引入隐藏副作用，SpiritForge 在 loop replay 后更新 | 2026-07-21 |
| KD-9 | `success_rate` 在 `add_method()` 时 clamp 到 `[0.0, 1.0]` | 防止脏数据污染MindCodex | 2026-07-21 |
| KD-10 | 纯 Python + 无外部 embedding 依赖 | P0 阶段稳定运行，向量索引作为 P2 编译层可插拔替换 | 2026-07-21 |

## 8. Timeline

| 日期 | 事件 |
|------|------|
| 2026-07-21 | 立项，确立 F017 记忆治理 + MindCodex Feature 规格，落地 MemoryGovernor 三原语 + MindCodex 蒸馏知识库，术语对齐项目正式命名（MindCodex / ForgeMethod） |

## 9. Review Gate

- Phase A: 单元测试通过，`MemoryGovernor` / `ConflictResolver` / `MindCodex` / `ForgeMethod` 由架构师Forgekin review，验证 frozen 策略与确定性 tiebreaker
- Phase B: E2E 测试由跨厂商 reviewer Forgekin review，验证SpiritForge → MindCodex 蒸馏闭环与治理三原语生效

## 10. Links

| 类型 | 路径 | 说明 |
|------|------|------|
| **ADR** | `docs/decisions/008-memory-federation.md` | 多域记忆联邦决策（§2.3 MindCodex / §2.7 治理） |
| **ADR** | `docs/decisions/012-naming-fusion.md` | 命名融合（MindCodex / ForgeMethod / SpiritForge 术语表） |
| **Feature** | `docs/features/F014-memory-collection.md` | 记忆收集与多域存储（治理操作对象） |
| **Feature** | `docs/features/F015-retrieval-entries.md` | 三检索入口（detect_conflicts 不阻塞检索） |
| **Feature** | `docs/features/F016-consumption-weighted.md` | 消费加权排序（apply_decay 影响 importance） |
| **Code** | `flowforge/core/memory/governance.py` | RetentionPolicy / DecayPolicy / ConflictResolver / MemoryGovernor 实现 |
| **Code** | `flowforge/core/memory/mind_codex.py` | ForgeMethod / MindCodex 实现 |
| **VISION** | `docs/VISION.md#3` | 持续身份：EchoStore 治理 + MindCodex 蒸馏 |
| **roleagent** | `docs/roleagent.md#第4章` | 熵增抑制 + 元认知记忆域 |
