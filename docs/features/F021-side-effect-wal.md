---
feature_ids: [F021]
related_features: [F022, F023, F024, F025]
topics: [reliability, wal, durability, side-effect, compensation]
doc_kind: spec
created: 2026-07-21
---

# F021: Side-Effect WAL（副作用预写日志）

> **状态**: spec | **负责人**: 架构师Forgekin | **优先级**: P0
> **依赖 ADR**: [doc:decisions/010-distributed-reliability.md]
> **依据**: operator 7 条不可妥协原则 + roleagent.md 第 6 章 分布式可靠性
> **关联 VISION**: [doc:VISION.md#6]（operator 原则第 6 条：支持自己开发自己）

## 1. 上下文

### 1.1 问题陈述

FlowForge 通用底座承载多Forgekin协作，副作用（发布 / 数据库写入 / 外部 API 调用）一旦执行不可撤销。`[doc:roleagent.md#第6章]` 第一类失败模式明确："副作用已执行但通道断了"——此时盲目重试会双发，不重试则状态丢失。需要一个在副作用执行**之前**追加的预写日志（Write-Ahead Log），让恢复层在 crash 后能精确知道哪些副作用已落盘、哪些需要 replay 或补偿。

### 1.2 当前痛点

- 副作用执行后通道断开 → 重试双发 / 不重试丢状态，二者皆不可接受
- 无审计轨迹：调用方可后续篡改 `params` 字段，事后无法追溯真实参数
- 状态机不收敛：PENDING 条目无终态保护，可被错误回退到 COMMITTED 后再次 ROLLED_BACK
- 内存崩溃即丢失全部记录，与 DurableStateSurface 主张不一致
- 副作用执行前无前置写入约束，crash 后无法区分"已 append 未 execute"与"已 execute 未 commit"

### 1.3 不做的影响

- F022 Tier 3 Rollback 无 `WalEntry` 可读 → 降级为 ESCALATE，副作用无法补偿
- F024 强工作流"可重放"主张落空，HYBRID 步骤无法回滚
- operator 7 条原则"可靠性治理工程路径"无法兑现
- "自己开发自己"闭环在 crash 后丢失协作进展，违背 operator 原则第 6 条

## 2. 决策

### 2.1 核心设计

借鉴数据库 Write-Ahead Log（`[doc:roleagent.md#第6章]` 称其为"类似数据库预写日志的副作用记录"）：

- **append-before-execute**：副作用执行前先调用 `WriteAheadLog.append` 写入 PENDING 条目，拿到 `entry_id` 后再执行副作用
- **三态生命周期**：`WalStatus.PENDING` → `COMMITTED`（确认落盘）/ `ROLLED_BACK`（已补偿），终态不可回退
- **审计轨迹不可变**：`append` 时 `copy.deepcopy(params)`，`get` 也返回深拷贝，调用方无法事后篡改
- **list_uncommitted** 返回所有 PENDING 条目（按 `created_at` 升序），供恢复层 replay——幂等的重试执行，非幂等的走补偿
- **存储可替换**：当前内存 dict，生产可换 SQLite/PostgreSQL 而不改变 surface API（对齐 DurableStateSurface 存储策略）
- **fail-closed**：`append` 拒绝空 `action` 或空 `target`；`mark_committed` / `mark_rolled_back` 检测到非 PENDING 状态时抛 `ReliabilityError`，防止状态机被错误回退

### 2.2 关键接口

```python
from enum import Enum
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from flowforge.core.errors import ReliabilityError
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.reliability.side_effect_wal")


class WalStatus(str, Enum):
    """WAL 条目生命周期状态。
    PENDING     — 已追加，副作用未确认落盘
    COMMITTED   — 副作用确认落盘，无需进一步动作
    ROLLED_BACK — 副作用已补偿 / 撤销
    """
    PENDING = "pending"
    COMMITTED = "committed"
    ROLLED_BACK = "rolled_back"


@dataclass
class WalEntry:
    """单条副作用记录。
    params 在 append 时深拷贝，防止调用方后续篡改审计轨迹。
    """
    entry_id: str
    action: str
    target: str
    params: dict[str, Any]
    created_at: datetime
    status: WalStatus = WalStatus.PENDING


class WriteAheadLog:
    """追加式副作用日志，支持 commit/rollback 生命周期。
    append 返回唯一 entry_id；调用方后续用 entry_id 标记副作用 committed 或 rolled_back。
    list_uncommitted 仅返回 PENDING 条目，供恢复层精确 replay 未确认的副作用。
    """

    async def append(
        self,
        action: str,
        target: str,
        params: dict[str, Any] | None = None,
    ) -> str:
        """追加副作用记录，返回 entry_id。
        action/target 非空，否则抛 ReliabilityError。
        params 深拷贝，调用方后续篡改原始 dict 不影响审计轨迹。
        """

    async def get(self, entry_id: str) -> WalEntry:
        """返回 entry 的深拷贝（防止调用方篡改审计轨迹）。
        entry_id 不存在抛 ReliabilityError。
        """

    async def list_uncommitted(self) -> list[WalEntry]:
        """返回所有 PENDING 条目（按 created_at 升序）的深拷贝。"""

    async def mark_committed(self, entry_id: str) -> None:
        """PENDING → COMMITTED。非 PENDING 状态抛 ReliabilityError（终态保护）。"""

    async def mark_rolled_back(self, entry_id: str) -> None:
        """PENDING → ROLLED_BACK。非 PENDING 状态抛 ReliabilityError（终态保护）。"""

    def count(self) -> int:
        """条目总数（任意状态），用于 dashboard/测试。"""
```

## 3. 验收标准

### Phase A（核心 WAL 状态机）

- [ ] AC-A1: `WriteAheadLog.append` 在副作用执行前写入 PENDING 条目，返回唯一 `entry_id`（`uuid.uuid4().hex`）
- [ ] AC-A2: `WalStatus` 三态枚举完整（PENDING / COMMITTED / ROLLED_BACK），字符串值分别为 `pending` / `committed` / `rolled_back`
- [ ] AC-A3: `mark_committed` / `mark_rolled_back` 仅允许从 PENDING 迁出，否则抛 `ReliabilityError`（终态保护）
- [ ] AC-A4: `append` 时 `copy.deepcopy(params)`，`get` 也返回深拷贝——调用方篡改原始 dict 不影响审计轨迹
- [ ] AC-A5: `append` 拒绝空 `action` 或空 `target`，抛 `ReliabilityError`
- [ ] AC-A6: `list_uncommitted` 按 `created_at` 升序返回所有 PENDING 条目（仅 PENDING，排除终态）
- [ ] AC-A7: `get` 对不存在的 `entry_id` 抛 `ReliabilityError`
- [ ] AC-A8: 通过 `core/tracing.get_logger` 写结构化日志（`reliability: wal append/commit/rollback`），自动注入 `trace_id`
- [ ] AC-A9: 状态持久化通过 Repository 层（DurableStateSurface），禁直接操作数据库

### Phase B（replay + 补偿 + E2E）

- [ ] AC-B1: 恢复层调用 `list_uncommitted` 拿到 PENDING 条目后，幂等副作用走 replay，非幂等走补偿（`mark_rolled_back`）
- [ ] AC-B2: append → execute → mark_committed 端到端延迟 < 20ms（内存存储）
- [ ] AC-B3: crash 后重启，PENDING 条目数与 crash 前一致（持久化后端就绪后验证）
- [ ] AC-B4: 与 F022 集成——`FailureContext.wal_entries` 非空时触发 TIER_3_ROLLBACK，空则降级 ESCALATE（"nothing to roll back"）
- [ ] AC-B5: 与 F024 集成——STRONG workflow 的可补偿步骤走 WAL replay，WEAK workflow 不走 replay
- [ ] AC-B6: E2E 测试——真实多Forgekin协作场景，副作用执行前写 WAL，crash 注入后 replay 不双发、补偿正确执行
- [ ] AC-B7: 遵守 T1-T8 测试铁律（真实 LLM 调用、真实场景数据、不跳过验证、不 Mock 工具、采集完整指标、LLM 生成内容经 LLM 审核、Web 功能操控浏览器验证 DOM）

## 4. 依赖

- **Evolved from**: 无
- **Blocked by**: 无（核心原语，F022/F024 依赖本 Feature）
- **Related**: F022（TierRecoveryService 通过 `FailureContext.wal_entries` 消费 WAL）、F023（Liveness 探针不健康时触发副作用回滚）、F024（强工作流 replay 依赖 WAL 终态）、F025（ProviderHost failover 时副作用已执行则走 WAL 回滚）

## 5. 风险

| 风险 | 缓解 |
|------|------|
| 内存存储进程崩溃即丢失 | 接口已预留 SQLite/PostgreSQL 替换路径，P2 阶段补齐持久化后端 |
| `append` 与副作用执行之间仍有窗口（append 成功但 execute 未启动） | 恢复层 replay 时识别"已 append 未 execute"的条目，幂等的可重试，非幂等的标记 ROLLED_BACK |
| 审计轨迹被调用方通过 `entry.params` 篡改 | `append` 与 `get` 双向深拷贝，已强制不可变 |
| WAL 条目无限增长 | P3 阶段引入 TTL / GC 策略，COMMITTED 与 ROLLED_BACK 终态条目定期归档 |
| `mark_committed` 与 `mark_rolled_back` 并发竞争 | 当前内存存储单线程安全；持久化后端需引入乐观锁或行级锁 |

## 6. Open Questions

| # | 问题 | 状态 |
|---|------|------|
| OQ-1 | WAL 持久化后端选 SQLite 还是 PostgreSQL？ | ⬜ 未定 |
| OQ-2 | `append` 与 `execute` 之间的窗口是否需要两阶段提交协议？ | ⬜ 未定 |
| OQ-3 | COMMITTED 条目保留多久？是否需要归档到冷存储？ | ⬜ 未定 |
| OQ-4 | `params` 字段是否需要加密存储敏感参数（如 API key）？ | ⬜ 未定 |

## 7. Key Decisions

| # | 决策 | 理由 | 日期 |
|---|------|------|------|
| KD-1 | append-before-execute | `[doc:roleagent.md#第6章]` 第一类失败模式要求副作用执行前必有审计轨迹 | 2026-07-21 |
| KD-2 | 三态枚举 + 终态保护 | 防止状态机被错误回退，COMMITTED/ROLLED_BACK 不可逆 | 2026-07-21 |
| KD-3 | 双向深拷贝 params | 调用方篡改原始 dict 不影响审计轨迹 | 2026-07-21 |
| KD-4 | 当前内存存储，接口预留持久化 | 与 DurableStateSurface 存储策略一致，P2 阶段生产化迁移 | 2026-07-21 |
| KD-5 | `list_uncommitted` 按 `created_at` 升序 | 恢复层按时间顺序 replay，避免乱序导致的状态不一致 | 2026-07-21 |

## 8. Timeline

| 日期 | 事件 |
|------|------|
| 2026-07-21 | 立项，确立 Side-Effect WAL Feature 规格，术语对齐项目正式命名（Forgekin） |

## 9. Review Gate

- Phase A: 单元测试通过，`WriteAheadLog` 状态机由架构师Forgekin review，终态保护与深拷贝不可变性验证
- Phase B: E2E 测试由跨厂商 reviewer Forgekin review，crash 注入后 replay 不双发、补偿正确性达标

## 10. Links

| 类型 | 路径 | 说明 |
|------|------|------|
| **ADR** | `docs/decisions/010-distributed-reliability.md` | 分布式可靠性决策（5 原语之一） |
| **Feature** | `docs/features/F022-tier-recovery.md` | TierRecoveryService 消费 wal_entries |
| **Feature** | `docs/features/F024-state-workflow.md` | 强工作流 replay 依赖 WAL 终态 |
| **代码** | `flowforge/core/reliability/side_effect_wal.py` | F021 实现 |
| **roleagent** | `docs/roleagent.md#第6章` | 分布式可靠性（第一类失败模式） |
| **VISION** | `docs/VISION.md#6` | operator 原则第 6 条（支持自己开发自己） |
