---
feature_ids: [F008]
related_features: [F002, F009, F010, F011, F012, F013]
topics: [harness, durable-state, snapshot, persistence, echo-store]
doc_kind: spec
created: 2026-07-21
---

# F008: 持久状态表面（Durable State Surface）

> **状态**: spec | **负责人**: 架构师灵智体 | **优先级**: P0
> **依赖 ADR**: [doc:decisions/007-harness-engineering.md]
> **依据**: operator 7 条不可妥协原则 + roleagent.md 第 3 章 Harness 七层（Layer 1）
> **关联 VISION**: [doc:VISION.md#6]（operator 原则第 6 条：支持自己开发自己）

## 1. 上下文

### 1.1 问题陈述

`[doc:roleagent.md#第3章]` 指出：长任务跨 session、跨 thread、跨天推进时，模型上下文窗口撑不住，压缩会丢信息。模型本身像一个缸中之脑——它能推理，能生成方案，但它天然没有稳定的现实感知、现实记忆、现实行动后果。

FlowForge 需要为灵智体（Forgekin）提供一个**外部化的状态表面**：状态以不可变快照形式存放在模型上下文之外，可按 `snapshot_id` 精确恢复，承载灵忆 EchoStore 的持久化语义。这是 Harness 七层的第 1 层——感知现实，让灵智体不再失忆上岗。

### 1.2 当前痛点

- 长任务跨 session 推进时，状态丢失，灵智体被迫"从头加载上下文"
- 内存态字典可被调用方就地修改，存储侧无防御，状态污染难以追查
- 没有 `snapshot_id` 维度的状态血缘，无法回滚到任意历史点
- 直接操作数据库的反模式（违反铁律 4）偶尔出现，缺少"surface API 不变、后端可换"的抽象

### 1.3 不做的影响

- TeamAct 六步循环（F002）的 `TeamActState` 无处持久化，跨 session 必丢
- 交接胶囊（F003）无法跨灵智体可靠传递
- 灵忆 EchoStore 缺少底层快照原语，记忆治理三要素（F016）失去基础
- "自己开发自己"闭环无法达成——长程任务必须可恢复

## 2. 决策

### 2.1 核心设计

- `DurableState`：不可变快照数据类，含 `snapshot_id` / `state_dict` / `created_at` / `parent_snapshot_id`，支持父子链（用于状态回溯与血缘追踪）
- `DurableStateSurface.snapshot(state_dict, parent_snapshot_id)`：**deep-copy 入存**，返回 `snapshot_id`，调用方后续修改不污染快照
- `DurableStateSurface.restore(snapshot_id)`：**deep-copy 出存**，调用方修改不污染快照
- `DurableStateSurface.list_snapshots()`：枚举所有快照 ID
- 后端可换：当前为内存 `dict`，生产环境可换 SQLite/PostgreSQL，**surface API 不变**
- 持久化通过 Repository 层（铁律 4：禁直接操作数据库），surface 不持有 `cursor.execute`
- 与第 6 层 EntropyController（F013）配套：表面越多越需要治理，TTL 机制防止快照无限累积

### 2.2 关键接口

```python
"""Durable State Surface — snapshot/restore for agent state (roleagent.md Ch.7).

Layer 1 of the Harness seven-layer guardrail. State snapshots are stored
in-memory (dict); production swaps in SQLite/PostgreSQL without changing
the surface API.
"""

import copy
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from flowforge.core.errors import HarnessError


@dataclass
class DurableState:
    """One immutable state snapshot."""

    snapshot_id: str
    state_dict: dict[str, Any]
    created_at: datetime
    parent_snapshot_id: str | None = None


class DurableStateSurface:
    """Persistent state surface — snapshot, restore, list.

    ``snapshot`` deep-copies the input dict so later mutation by the caller
    cannot corrupt the stored snapshot. ``restore`` deep-copies on the way
    back out for the same reason.
    """

    def __init__(self) -> None:
        self._snapshots: dict[str, DurableState] = {}

    def snapshot(
        self,
        state_dict: dict[str, Any],
        parent_snapshot_id: str | None = None,
    ) -> str:
        """Persist a deep copy of ``state_dict`` and return its snapshot_id."""
        snapshot_id = uuid.uuid4().hex
        self._snapshots[snapshot_id] = DurableState(
            snapshot_id=snapshot_id,
            state_dict=copy.deepcopy(state_dict),
            created_at=datetime.now(timezone.utc),
            parent_snapshot_id=parent_snapshot_id,
        )
        return snapshot_id

    def restore(self, snapshot_id: str) -> dict[str, Any]:
        """Return a deep copy of the stored state for ``snapshot_id``."""
        if snapshot_id not in self._snapshots:
            raise HarnessError(f"snapshot {snapshot_id!r} not found")
        state_dict = self._snapshots[snapshot_id].state_dict
        return copy.deepcopy(state_dict)

    def list_snapshots(self) -> list[str]:
        return list(self._snapshots.keys())
```

## 3. 验收标准

### Phase A（快照原语 + 深拷贝不变量）

- [ ] AC-A1: `DurableState` 数据类含 4 字段（`snapshot_id` / `state_dict` / `created_at` / `parent_snapshot_id`），`parent_snapshot_id` 默认 `None`
- [ ] AC-A2: `snapshot()` 返回 `snapshot_id`，`state_dict` 经 `copy.deepcopy` 入存
- [ ] AC-A3: `restore()` 经 `copy.deepcopy` 出存；调用方修改返回值不污染快照
- [ ] AC-A4: `restore(snapshot_id)` 对未知 ID 抛 `HarnessError`
- [ ] AC-A5: `list_snapshots()` 返回所有已注册 `snapshot_id` 列表
- [ ] AC-A6: 父子链可建（`snapshot(state, parent_snapshot_id=prev)`），用于状态血缘

### Phase B（持久化后端 + E2E）

- [ ] AC-B1: 后端可换：内存 `dict` → SQLite/PostgreSQL，surface API 不变
- [ ] AC-B2: 持久化通过 Repository 层，**禁直接操作数据库**（铁律 4）
- [ ] AC-B3: `snapshot` + `restore` 往返延迟 < 5ms（单次小状态字典）
- [ ] AC-B4: 跨 session 恢复：进程重启后 `restore(snapshot_id)` 仍可返回状态
- [ ] AC-B5: E2E 测试 — TeamAct 六步循环（F002）跨 session 推进，状态从 `DurableStateSurface` 恢复后继续推进
- [ ] AC-B6: 遵守 T1-T8 测试铁律（真实 LLM 调用、真实场景数据、不跳过验证、不 Mock 工具、采集完整指标、LLM 生成内容经 LLM 审核、Web 功能操控浏览器验证 DOM）

## 4. 依赖

- **Evolved from**: 无
- **Blocked by**: 无（Harness 第 1 层，七层基础）
- **Related**: F002（TeamAct 状态持久化消费方）、F009（工具中介）、F010（证据传感器）、F011（治理边界）、F012（魔法词逃生舱）、F013（熵控 + 可驾驭性评分）

## 5. 风险

| 风险 | 缓解 |
|------|------|
| 内存 `dict` 在生产场景丢数据 | 接口设计为可换后端（SQLite/PostgreSQL），surface API 不变；P2 阶段引入持久化实现 |
| 深拷贝对大状态字典开销大 | P2 阶段引入增量快照（只存 diff），surface API 兼容 |
| 快照无限累积导致内存膨胀 | 与 F013 EntropyController 配套，TTL 机制清理过期快照 |
| `parent_snapshot_id` 链断裂（父被清理） | 清理策略需保留父子链完整性，或允许孤儿快照显式标记 |

## 6. Open Questions

| # | 问题 | 状态 |
|---|------|------|
| OQ-1 | 快照清理策略：按 TTL 还是按 LRU？与 F013 EntropyController 是否共用一套？ | ⬜ 未定 |
| OQ-2 | SQLite/PostgreSQL 后端是否需要支持并发写（多灵智体同时 snapshot）？ | ⬜ 未定 |
| OQ-3 | 是否需要快照压缩（zstd）以降低存储成本？ | ⬜ 未定 |

## 7. Key Decisions

| # | 决策 | 理由 | 日期 |
|---|------|------|------|
| KD-1 | 深拷贝入存 + 深拷贝出存 | 调用方修改不污染快照，防御性编程 | 2026-07-21 |
| KD-2 | `snapshot_id` 用 `uuid.uuid4().hex` | 全局唯一，跨 session 不冲突 | 2026-07-21 |
| KD-3 | `parent_snapshot_id` 支持父子链 | 状态血缘可追溯，支持回滚 | 2026-07-21 |
| KD-4 | 持久化通过 Repository 层 | 遵守铁律 4，禁直接操作数据库 | 2026-07-21 |
| KD-5 | surface API 后端可换 | 内存 → SQLite/PostgreSQL，复利型基础设施 | 2026-07-21 |

## 8. Timeline

| 日期 | 事件 |
|------|------|
| 2026-07-21 | 立项，确立 Durable State Surface Feature 规格，对齐 ADR-007 Layer 1 与 `flowforge/core/harness/durable_state.py` P1 实现 |

## 9. Review Gate

- Phase A: 单元测试通过，深拷贝不变量由架构师灵智体 review
- Phase B: 持久化后端 E2E 测试由跨厂商 reviewer 灵智体 review，跨 session 恢复成功率达标

## 10. Links

| 类型 | 路径 | 说明 |
|------|------|------|
| **ADR** | `docs/decisions/007-harness-engineering.md` | Harness 工程路径决策（七层） |
| **roleagent** | `docs/roleagent.md#第3章` | Harness 七层白皮书（Layer 1：感知现实） |
| **代码** | `flowforge/core/harness/durable_state.py` | DurableStateSurface P1 实现 |
| **Feature** | `docs/features/F002-teamact-loop.md` | TeamAct 状态持久化消费方 |
| **Feature** | `docs/features/F013-entropy-harnessability.md` | 熵控 + 可驾驭性评分（清理快照） |
| **规则** | `docs/project_rules.md#铁律4` | 禁止直接操作数据库 |
