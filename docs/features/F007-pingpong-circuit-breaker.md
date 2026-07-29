---
feature_ids: [F007]
related_features: [F002, F003, F004, F005, F006]
topics: [teamact, circuit-breaker, escalation, failure-tracking]
doc_kind: spec
created: 2026-07-21
---

# F007: 乒乓球熔断器（PingPong Circuit Breaker）

> **状态**: spec | **负责人**: 架构师Forgekin | **优先级**: P0
> **依赖 ADR**: [doc:decisions/002-teamact-collaboration-protocol.md]
> **依赖 Feature**: [doc:features/F002-teamact-loop.md]
> **依据**: operator 7 条不可妥协原则 + roleagent.md 工程路径（RA-012 乒乓球熔断）
> **关联 VISION**: [doc:VISION.md#4]（协作单位：动态能力画像路由）

## 1. 上下文

### 1.1 问题陈述

TeamAct 六步循环（F002）中，Forgekin持球后可能连续失败：ACTION 步骤没产出可用 evidence、VERDICT 步骤被 reviewer 拒绝、ROUTE 步骤又被传回原 owner。这种"持球但无进展"的故障如果不熔断，会无限消耗 LLM 调用成本。roleagent.md RA-012 指出，乒乓球失败模式不是"两个 agent 互传"，而是"持球者连续失败无产出"——breaker 不计传球次数，计每个 owner 的连续失败次数。本 Feature 提供 PingPongCircuitBreaker，按 owner 跟踪连续失败，超过阈值（默认 3）触发熔断，强制升级给 operator。

### 1.2 当前痛点

- 持球Forgekin连续失败无熔断，LLM 调用成本浪费
- 熔断器按团队计数，单个 struggling owner 拖累全队
- 失败后无自动升级机制，需要 operator 人工干预
- 成功后失败计数不重置，历史失败累积导致误熔断
- 熔断状态不可观测，operator 不知道谁触发了熔断

### 1.3 不做的影响

- TeamAct 违反 RA-012，持球失败无熔断
- LLM 调用成本无限浪费在 struggling owner 上
- F002 `circuit_breaker_tripped` 终止条件无法判定
- operator 无法感知团队阻塞点，无法及时干预

## 2. 决策

### 2.1 核心设计

PingPongCircuitBreaker 由 `flowforge/core/teamact/circuit_breaker.py` 实现，核心设计：

- **按 owner 跟踪（非按团队）**：`_failures: dict[str, int]` 按 owner 计数，单个 struggling owner 可被隔离，不拖累全队
- **失败语义是"持球但无产出"**：不是"互传次数"，而是 owner 在 ACTION/EVIDENCE 步骤未产出可用 evidence 的连续次数
- **阈值默认 3（`DEFAULT_THRESHOLD = 3`）**：可配置，`__init__(threshold)` 接受参数，threshold < 1 抛 `TeamActError`
- **成功重置计数**：`record_success(owner)` 将 owner 的 failure count 重置为 0，避免历史失败累积误熔断
- **`is_tripped(owner)` 按 owner 查询**：`failure_count >= threshold` 即熔断，与 F002 `circuit_breaker_tripped` 终止条件联动
- **`reset(owner)` 主动重置**：operator 干预后可手动 reset，让 owner 重新尝试
- **`failure_count(owner)` 可观测**：供测试与 Grafana 仪表盘查询当前失败计数
- **日志通过 `get_logger`**：注入 trace_id，符合铁律 5

### 2.2 关键接口

```python
from flowforge.core.errors import TeamActError
from flowforge.core.tracing import get_logger

DEFAULT_THRESHOLD: int = 3


class PingPongCircuitBreaker:
    """Track consecutive failures per owner and trip past a threshold.

    The breaker is per-owner (not per-team) so a single struggling owner can
    be isolated without penalising the rest of the team.
    """

    def __init__(self, threshold: int = DEFAULT_THRESHOLD) -> None:
        if threshold < 1:
            raise TeamActError(
                f"circuit breaker threshold must be >= 1, got {threshold}"
            )
        self.threshold = threshold
        self._failures: dict[str, int] = {}

    def record_failure(self, owner: str) -> None:
        """Increment owner's consecutive failure count."""
        if not owner.strip():
            raise TeamActError("owner must not be empty when recording a failure")
        count = self._failures.get(owner, 0) + 1
        self._failures[owner] = count

    def record_success(self, owner: str) -> None:
        """Reset owner's failure count to 0 on any success."""
        if not owner.strip():
            raise TeamActError("owner must not be empty when recording a success")
        self._failures[owner] = 0

    def is_tripped(self, owner: str) -> bool:
        """Return True if owner's failure count >= threshold."""
        return self._failures.get(owner, 0) >= self.threshold

    def reset(self, owner: str) -> None:
        """Manually reset owner's failure count (operator intervention)."""
        self._failures.pop(owner, None)

    def failure_count(self, owner: str) -> int:
        """Inspect current consecutive-failure count (for tests/dashboards)."""
        return self._failures.get(owner, 0)
```

### 2.3 协作流程

PingPongCircuitBreaker 在 TeamAct 生态中与其他 4 份子 Feature 协作：

- **F003 HandoffCapsule**：熔断后生成升级 capsule，`to_owner="operator"`，`summary` 携带熔断原因，`next_action_hint` 建议干预策略
- **F004 AtMentionRouter**：熔断后通过 `@operator` 路由升级；operator 干预后 `@forgekin:xxx` 路由恢复
- **F005 BallCustodyRegistry**：熔断后 lease 强制 `release`，球权交回 operator；`reset(owner)` 后 operator 可重新 acquire 给恢复的 owner
- **F006 PushBackProtocol**：推回不计入 `record_failure`（推回是显式辩论，非持球失败）；但推回无限循环可由 operator 触发熔断

熔断状态机：正常（`failure_count < threshold`）→ 临界（`failure_count == threshold-1`）→ 熔断（`is_tripped=True`）→ 升级 operator → `reset(owner)` → 恢复正常。

### 2.4 关键不变量

- INV-1: 按 owner 跟踪失败计数，多个 owner 互不影响（owner A 熔断不影响 owner B）
- INV-2: `record_success(owner)` 将 owner 的 failure count 重置为 0，避免历史失败累积误熔断
- INV-3: `is_tripped(owner)` 在 `failure_count >= threshold` 时返回 True，与 F002 `circuit_breaker_tripped` 终止条件联动
- INV-4: `threshold` 必须 >= 1，否则 `__init__` 抛 `TeamActError`
- INV-5: `record_failure` 与 `record_success` 对空 owner 抛 `TeamActError`，禁静默错误
- INV-6: 熔断后强制升级 operator（生成 F003 capsule + F004 `@operator` 路由 + F005 lease release），禁任务悬挂

### 2.5 失败模式与恢复

| # | 失败模式 | 检测 | 恢复 |
|---|---------|------|------|
| FM-1 | 阈值过低误熔断（threshold=1） | `is_tripped()` 频繁返回 True | operator 调高 threshold 或 `reset(owner)` |
| FM-2 | 阈值过高不熔断（threshold=10） | `failure_count` 持续增长 | Grafana 监控，人工干预 |
| FM-3 | 假成功重置计数（`record_success` 滥用） | T2 铁律要求真实 evidence | `record_success` 必须基于真实 evidence 产出 |
| FM-4 | owner 改名后 failure count 丢失 | owner id 用 F001 稳定 id | 禁用显示名作为 owner id |
| FM-5 | 熔断后 operator 不在线导致任务悬挂 | 熔断同时触发告警 | 接入可观测性，告警通知 operator |

恢复原则：按 owner 跟踪隔离故障；熔断后强制升级 operator，禁任务悬挂。

触发阈值：`failure_count >= threshold`（默认 3）即 `is_tripped=True`；成功产出 evidence 即 `record_success` 重置。

## 3. 验收标准

### Phase A（失败计数 + 熔断阈值）

- [ ] AC-A1: `record_failure(owner)` 将 owner 的 failure count +1
- [ ] AC-A2: `record_success(owner)` 将 owner 的 failure count 重置为 0
- [ ] AC-A3: `is_tripped(owner)` 在 failure count >= threshold 时返回 True
- [ ] AC-A4: `DEFAULT_THRESHOLD = 3`，3 次连续失败触发熔断
- [ ] AC-A5: `__init__(threshold)` 在 threshold < 1 时抛 `TeamActError`
- [ ] AC-A6: `record_failure` 与 `record_success` 对空 owner 抛 `TeamActError`
- [ ] AC-A7: `reset(owner)` 主动清除 owner 的 failure count
- [ ] AC-A8: `failure_count(owner)` 返回当前连续失败计数（未知 owner 返回 0）
- [ ] AC-A9: 成功后失败计数重置（避免历史失败累积误熔断）
- [ ] AC-A10: 按 owner 跟踪，多个 owner 互不影响（owner A 熔断不影响 owner B）

### Phase B（TeamAct 集成 + 升级 operator）

- [ ] AC-B1: F002 ACTION 步骤未产出 evidence 时调用 `record_failure(owner)`
- [ ] AC-B2: F002 EVIDENCE 步骤产出 evidence 时调用 `record_success(owner)`
- [ ] AC-B3: `is_tripped(owner)` 为 True 时 F002 设置 `circuit_breaker_tripped=True` 终止条件
- [ ] AC-B4: 熔断后强制升级给 operator（生成 F003 HandoffCapsule，`to_owner="operator"`）
- [ ] AC-B5: 熔断后 F005 lease 强制 release（球权交回 operator）
- [ ] AC-B6: operator 干预后调用 `reset(owner)` 解除熔断，owner 可重新尝试
- [ ] AC-B7: F006 推回不计入 failure count（推回是显式辩论，非持球失败）
- [ ] AC-B8: E2E 测试 — Forgekin连续 3 次持球失败，触发熔断升级 operator，operator 干预后恢复
- [ ] AC-B9: 遵守 T1-T8 测试铁律（真实 LLM 调用、真实场景数据、不跳过验证、不 Mock 工具、采集完整指标、LLM 生成内容经 LLM 审核、Web 功能操控浏览器验证 DOM）

## 4. 依赖

- **Evolved from**: F002（TeamAct 主循环 ACTION / EVIDENCE / ROUTE 步骤）
- **Blocked by**: F002
- **Related**: F001（CapabilityProfile 决定 owner 是否合适）、F003（熔断后生成升级 HandoffCapsule 给 operator）、F004（@mention 路由升级消息给 operator）、F005（熔断后 lease 强制 release）、F006（推回不计入 failure count）

## 5. 风险

| 风险 | 缓解 |
|------|------|
| 阈值默认 3 误熔断 | threshold 可配置；operator 可 `reset()` 解除 |
| 持球失败语义模糊（什么算"无产出"） | F002 集成时明确：ACTION 步骤未产出 evidence 即失败 |
| 成功重置被滥用（偶尔成功永远不熔断） | 成功必须是真实 evidence 产出（T2 铁律），禁假成功 |
| 熔断后 operator 不在线导致任务悬挂 | 熔断同时触发告警（后续接入可观测性） |
| 按 owner 跟踪导致 owner 改名后计数丢失 | owner id 用 F001 CapabilityProfile 的稳定 id，禁用显示名 |

## 6. Open Questions

| # | 问题 | 状态 |
|---|------|------|
| OQ-1 | 熔断后是否需要冷却期（cooldown）才能 reset？ | ⬜ 未定 |
| OQ-2 | failure count 是否需要持久化（重启后恢复）？ | ⬜ 未定 |
| OQ-3 | 是否需要区分失败类型（LLM 超时 / 工具失败 / review 拒绝）？ | ⬜ 未定 |
| OQ-4 | 多 owner 同时熔断时是否需要团队级熔断信号？ | ⬜ 未定 |

## 7. Key Decisions

| # | 决策 | 理由 | 日期 |
|---|------|------|------|
| KD-1 | 按 owner 跟踪（非按团队） | 单个 struggling owner 可被隔离，不拖累全队 | 2026-07-21 |
| KD-2 | 失败语义是"持球但无产出" | RA-012：乒乓球失败是连续无进展，非互传次数 | 2026-07-21 |
| KD-3 | 阈值默认 3，可配置 | 平衡误熔断与资源浪费，operator 可调 | 2026-07-21 |
| KD-4 | 成功重置计数 | 避免历史失败累积误熔断，鼓励 owner 恢复 | 2026-07-21 |
| KD-5 | 熔断后强制升级 operator | 避免任务悬挂，operator 干预后可 reset 恢复 | 2026-07-21 |
| KD-6 | F006 推回不计入 failure count | 推回是显式辩论，非持球失败 | 2026-07-21 |

## 8. Timeline

| 日期 | 事件 |
|------|------|
| 2026-07-21 | 立项，基于 ADR-002 与 F002 提取乒乓球熔断器子 Feature 规格 |

## 9. Review Gate

- Phase A: 单元测试通过（record_failure / record_success / is_tripped / reset / failure_count 全分支覆盖 + 多 owner 隔离验证），由架构师Forgekin review
- Phase B: E2E 测试由跨厂商 reviewer Forgekin review，真实连续失败场景触发熔断 + operator 干预恢复验证

## 10. Links

| 类型 | 路径 | 说明 |
|------|------|------|
| **ADR** | `docs/decisions/002-teamact-collaboration-protocol.md` | TeamAct 协作协议决策 |
| **Feature** | `docs/features/F002-teamact-loop.md` | TeamAct 主循环 |
| **Feature** | `docs/features/F003-handoff-capsule.md` | 交接胶囊 |
| **Feature** | `docs/features/F004-at-mention-router.md` | @mention 路由 |
| **Feature** | `docs/features/F005-ball-custody-lease.md` | 球权租借 |
| **Feature** | `docs/features/F006-push-back-protocol.md` | 推回协议 |
| **代码** | `flowforge/core/teamact/circuit_breaker.py` | PingPongCircuitBreaker 实现 |
