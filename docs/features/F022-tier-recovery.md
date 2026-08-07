---
feature_ids: [F022]
related_features: [F021, F023, F024, F025]
topics: [reliability, recovery, failover, rollback, escalation, fail-closed]
doc_kind: spec
created: 2026-07-21
---

# F022: Tier 1-4 恢复分级（Tiered Recovery）

> **状态**: spec | **负责人**: 架构师Forgekin | **优先级**: P0
> **依赖 ADR**: [doc:decisions/010-distributed-reliability.md]
> **依据**: operator 7 条不可妥协原则 + roleagent.md 第 6 章 分布式可靠性
> **关联 VISION**: [doc:VISION.md#6]（operator 原则第 6 条：支持自己开发自己）

## 1. 上下文

### 1.1 问题陈述

`[doc:roleagent.md#第6章]` 强调"不是所有操作都能安全重试"，并给出四级恢复表格：瞬态错误可重试、provider 故障可 failover、副作用已执行需 rollback、不可逆操作必须升级。当前 FlowForge 通用底座没有统一的失败分级机制——所有错误都被一视同仁地重试或一视同仁地放弃，导致双发、丢状态、不可逆操作被自动执行三类问题。需要一个 `TierRecoveryService` 把 `error_type` 映射到 `RecoveryTier`，并 emit 具体的 `RecoveryAction`。

### 1.2 当前痛点

- 瞬态超时与 provider 宕机被同等对待，重试浪费配额
- 副作用已执行的故障被盲目重试 → 双发（违反 `[doc:roleagent.md#第6章]` 第一类失败模式教训）
- force-push / merge / release 等不可逆操作无硬拒机制，可能被自动 dispatch
- 未知错误类型静默失败，违反 fail-closed 原则
- 策略漂移：同一 `error_type` 被多次注册覆盖，无审计轨迹
- WAL 与 Tier 恢复割裂——TIER_3_ROLLBACK 无从知道哪些 `wal_entries` 待回滚

### 1.3 不做的影响

- F021 WAL 的回滚能力无法被正确触发（缺 TIER_3_ROLLBACK 入口）
- F025 ProviderHost 的 failover 没有触发器（缺 TIER_2_FAILOVER 入口）
- `[doc:roleagent.md#第6章]` "结构化恢复卡"无法落地
- operator 7 条原则"可靠性治理工程路径"无法兑现，不可逆操作可能被自动执行

## 2. 决策

### 2.1 核心设计

四级恢复分级（`[doc:roleagent.md#第6章]` Tier 表）：

- **TIER_1_RETRY**：瞬态错误（超时 / 读取 / 构建 / 测试 / lint），自动重试同一 `source`，受 `max_retries` 与 `retry_delay_seconds` 约束
- **TIER_2_FAILOVER**：provider 故障，切换到 `failover_targets[0]`；若列表空 → 降级 ESCALATE（"nowhere to fail over"）
- **TIER_3_ROLLBACK**：副作用已发生，通过 WAL 回滚；若 `wal_entries` 空 → 降级 ESCALATE（"nothing to roll back"）
- **TIER_4_ESCALATE**：force-push / merge / release / 不可逆操作——**永远不自动恢复**，dispatch 前硬拒

**fail-closed 默认安全**：`TierRecoveryService.handle_failure` 对未注册 `error_type` 的故障默认归入 `TIER_4_ESCALATE`，而非最低级——与 `[doc:roleagent.md#第6章]` "遇到未知操作类型默认归入最高限制，不是最低"完全一致。`register_policy` 拒绝重复注册（抛 `ReliabilityError`），防止策略漂移。`FailureContext.wal_entries` 字段把 WAL 与 Tier 恢复连接——TIER_3_ROLLBACK 时检查非空，空则降级 ESCALATE。`RecoveryAction.notes` 携带可读决策理由供审计与 trace 追溯。

### 2.2 关键接口

```python
from enum import Enum
from dataclasses import dataclass, field
from flowforge.core.errors import ReliabilityError
from flowforge.core.reliability.side_effect_wal import WalEntry
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.reliability.tier_recovery")


class RecoveryTier(str, Enum):
    """升级式严重性分级。"""
    TIER_1_RETRY = "tier_1_retry"        # 瞬态错误，自动重试同一目标
    TIER_2_FAILOVER = "tier_2_failover"  # provider 故障，切换备份
    TIER_3_ROLLBACK = "tier_3_rollback"  # 副作用已发生，WAL 回滚
    TIER_4_ESCALATE = "tier_4_escalate"  # 不可恢复，升级 operator


class RecoveryActionType(str, Enum):
    """具体动作类型。"""
    RETRY = "retry"
    FAILOVER = "failover"
    ROLLBACK = "rollback"
    ESCALATE = "escalate"


@dataclass
class RecoveryPolicy:
    """单类错误的恢复策略。
    failover_targets 按优先级排序，由 ProviderHost 提供。
    rollback_strategy 是自由标签（如 "wal_replay" / "compensating_action"）。
    """
    tier: RecoveryTier
    max_retries: int = 3
    retry_delay_seconds: float = 1.0
    failover_targets: list[str] = field(default_factory=list)
    rollback_strategy: str = "wal_replay"


@dataclass
class FailureContext:
    """失败场景结构化上下文。
    wal_entries 把 WAL 与 Tier 恢复连接——TIER_3_ROLLBACK 时检查非空。
    """
    error_type: str
    error_message: str
    source: str
    wal_entries: list[WalEntry] = field(default_factory=list)


@dataclass
class RecoveryAction:
    """调用方执行的恢复指令。
    notes 携带可读决策理由供审计与 trace 追溯。
    退化时 tier 字段被改写为 TIER_4_ESCALATE，调用方可直接判断。
    """
    tier: RecoveryTier
    action: RecoveryActionType
    target: str | None = None
    notes: str = ""


class TierRecoveryService:
    """按 error_type 注册策略，emit 具体恢复动作。
    未知 error_type 升级 ESCALATE（fail-closed）。
    重复注册抛 ReliabilityError，防止策略漂移。
    """

    def register_policy(self, error_type: str, policy: RecoveryPolicy) -> None:
        """注册策略。error_type 非空，重复注册抛 ReliabilityError。"""

    def get_policy(self, error_type: str) -> RecoveryPolicy | None:
        """查询已注册策略。未注册返回 None（handle_failure 会升级 ESCALATE）。"""

    async def handle_failure(self, error: FailureContext) -> RecoveryAction:
        """分类失败并 emit 恢复动作。
        - 未知 error_type → TIER_4_ESCALATE，notes="unknown error_type ...; no policy registered"
        - TIER_1_RETRY → target=error.source，notes 提示最大重试次数与间隔
        - TIER_2_FAILOVER + 空 failover_targets → 降级 ESCALATE
        - TIER_2_FAILOVER + 非空 → target=failover_targets[0]，notes 列出剩余备选
        - TIER_3_ROLLBACK + 空 wal_entries → 降级 ESCALATE
        - TIER_3_ROLLBACK + 非空 → target=error.source，notes 报告条目数与 rollback_strategy
        - TIER_4_ESCALATE → notes="unrecoverable; escalate to operator"
        """
```

## 3. 验收标准

### Phase A（分级 + 策略注册）

- [ ] AC-A1: `RecoveryTier` 四态枚举完整（TIER_1_RETRY / TIER_2_FAILOVER / TIER_3_ROLLBACK / TIER_4_ESCALATE）
- [ ] AC-A2: `RecoveryActionType` 四态枚举完整（RETRY / FAILOVER / ROLLBACK / ESCALATE）
- [ ] AC-A3: `register_policy` 拒绝空 `error_type` 与重复注册，抛 `ReliabilityError`
- [ ] AC-A4: `RecoveryPolicy` 字段完整（tier / max_retries=3 / retry_delay_seconds=1.0 / failover_targets / rollback_strategy="wal_replay"）
- [ ] AC-A5: `FailureContext.wal_entries` 默认空列表，类型为 `list[WalEntry]`
- [ ] AC-A6: `RecoveryAction` 字段完整（tier / action / target=None / notes=""）
- [ ] AC-A7: `get_policy` 对未注册 `error_type` 返回 `None`（不抛异常，由 `handle_failure` 决策）
- [ ] AC-A8: 通过 `core/tracing.get_logger` 写结构化日志，自动注入 `trace_id`

### Phase B（fail-closed + 退化规则 + E2E）

- [ ] AC-B1: 未知 `error_type` → `RecoveryAction(tier=TIER_4_ESCALATE, action=ESCALATE, notes="unknown error_type ...")`（fail-closed）
- [ ] AC-B2: TIER_1_RETRY → `target=error.source`，`notes` 提示最大重试次数与间隔
- [ ] AC-B3: TIER_2_FAILOVER + 空 `failover_targets` → 降级 ESCALATE，notes="no failover_targets configured; escalating"
- [ ] AC-B4: TIER_2_FAILOVER + 非空 `failover_targets` → `target=failover_targets[0]`，notes 列出剩余备选
- [ ] AC-B5: TIER_3_ROLLBACK + 空 `wal_entries` → 降级 ESCALATE，notes="no WAL entries to roll back; escalating"
- [ ] AC-B6: TIER_3_ROLLBACK + 非空 `wal_entries` → `target=error.source`，notes 报告条目数与 `rollback_strategy`
- [ ] AC-B7: TIER_4_ESCALATE → notes="unrecoverable; escalate to operator"
- [ ] AC-B8: 退化时 `RecoveryAction.tier` 被改写为 `TIER_4_ESCALATE`，调用方可直接判断
- [ ] AC-B9: `handle_failure` 端到端延迟 < 5ms（无 I/O，纯内存决策）
- [ ] AC-B10: E2E 测试——真实 provider 故障注入，触发 TIER_2_FAILOVER 切到备份 provider；副作用已执行则触发 TIER_3_ROLLBACK 走 WAL 补偿；未知错误触发 TIER_4_ESCALATE 进 operator 审计队列
- [ ] AC-B11: 遵守 T1-T8 测试铁律（真实 LLM 调用、真实场景数据、不跳过验证、不 Mock 工具、采集完整指标、LLM 生成内容经 LLM 审核、Web 功能操控浏览器验证 DOM）

## 4. 依赖

- **Evolved from**: 无
- **Blocked by**: F021（`FailureContext.wal_entries` 类型为 `list[WalEntry]`，依赖 WAL 实现）
- **Related**: F021（WAL 提供回滚入口）、F023（Liveness 探针不健康时由 Tier 服务决策 FAILOVER）、F024（强工作流 STRONG 推荐 workflow engine，配合 Tier 分级）、F025（ProviderHost 是 TIER_2_FAILOVER 的 target 池）

## 5. 风险

| 风险 | 缓解 |
|------|------|
| 未知 error_type 默认 ESCALATE 可能告警风暴 | ESCALATE 由 operator 审计队列消费；P3 阶段引入策略模板自动注册 |
| `register_policy` 人工注册易遗漏 | 启动时检查关键 error_type（timeout / provider_down / side_effect_failed）是否注册 |
| `failover_targets` 配置漂移 | 与 F025 ProviderHost 联动——targets 来自 ProviderHost 优先级排序 |
| 退化规则在 `handle_failure` 内部生效，调用方需读 notes 区分 | `RecoveryAction.tier` 字段在退化时被改写为 TIER_4_ESCALATE，调用方可直接判断 |
| `max_retries` 与 `retry_delay_seconds` 缺乏退避策略 | P2 阶段引入指数退避选项 |

## 6. Open Questions

| # | 问题 | 状态 |
|---|------|------|
| OQ-1 | `max_retries` 是否需要指数退避？还是固定 `retry_delay_seconds`？ | ⬜ 未定 |
| OQ-2 | ESCALATE 队列是否需要 SLA（多长时间内必须 operator 响应）？ | ⬜ 未定 |
| OQ-3 | 策略模板（timeout / provider_down / side_effect_failed）是否在 FlowForge 启动时自动注册？ | ⬜ 未定 |
| OQ-4 | TIER_4_ESCALATE 是否需要分级（如"硬拒 dispatch"vs"告警但允许"）？ | ⬜ 未定 |

## 7. Key Decisions

| # | 决策 | 理由 | 日期 |
|---|------|------|------|
| KD-1 | 四级恢复分级（RETRY / FAILOVER / ROLLBACK / ESCALATE） | `[doc:roleagent.md#第6章]` Tier 表主张 | 2026-07-21 |
| KD-2 | fail-closed：未知 error_type 默认 ESCALATE | `[doc:roleagent.md#第6章]` "遇到未知操作类型默认归入最高限制，不是最低" | 2026-07-21 |
| KD-3 | 退化规则：TIER_2 空_targets / TIER_3 空_wal_entries → ESCALATE | "nowhere to fail over" / "nothing to roll back" 不能无声失败 | 2026-07-21 |
| KD-4 | `register_policy` 拒绝重复注册 | 防止策略漂移，确保审计轨迹可追溯 | 2026-07-21 |
| KD-5 | `FailureContext.wal_entries` 连接 WAL 与 Tier 恢复 | TIER_3_ROLLBACK 需要知道哪些条目待回滚 | 2026-07-21 |

## 8. Timeline

| 日期 | 事件 |
|------|------|
| 2026-07-21 | 立项，确立 Tier 1-4 恢复分级 Feature 规格，术语对齐项目正式命名（Forgekin） |

## 9. Review Gate

- Phase A: 单元测试通过，`TierRecoveryService` 分级逻辑由架构师Forgekin review，策略注册幂等性验证
- Phase B: E2E 测试由跨厂商 reviewer Forgekin review，fail-closed 默认安全、退化规则、与 F021/F025 集成正确性达标

## 10. Links

| 类型 | 路径 | 说明 |
|------|------|------|
| **ADR** | `docs/decisions/010-distributed-reliability.md` | 分布式可靠性决策（5 原语之一） |
| **Feature** | `docs/features/F021-side-effect-wal.md` | WAL 提供 wal_entries |
| **Feature** | `docs/features/F025-provider-host.md` | ProviderHost 提供 failover_targets |
| **代码** | `flowforge/core/reliability/tier_recovery.py` | F022 实现 |
| **roleagent** | `docs/roleagent.md#第6章` | 分布式可靠性（Tier 表） |
| **VISION** | `docs/VISION.md#6` | operator 原则第 6 条（支持自己开发自己） |
