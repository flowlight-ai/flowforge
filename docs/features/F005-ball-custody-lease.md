---
feature_ids: [F005]
related_features: [F002, F003, F004, F006, F007]
topics: [teamact, custody, lease, ttl]
doc_kind: spec
created: 2026-07-21
---

# F005: 球权租借（Ball Custody Lease）

> **状态**: spec | **负责人**: 架构师Forgekin | **优先级**: P0
> **依赖 ADR**: [doc:decisions/002-teamact-collaboration-protocol.md]
> **依赖 Feature**: [doc:features/F002-teamact-loop.md]
> **依据**: operator 7 条不可妥协原则 + roleagent.md 工程路径（RA-014 持球 lease）
> **关联 VISION**: [doc:VISION.md#4]（协作单位：动态能力画像路由）

## 1. 上下文

### 1.1 问题陈述

TeamAct 六步循环（F002）中，持球Forgekin有时需要退出会话等待外部条件（CI 完成、operator 确认、定时唤醒）。如果没有结构化的球权 lease 机制，会出现"球掉地上"故障：一个Forgekin离开后，其他Forgekin不知道任务是否还有 owner，要么重复认领导致双持球冲突，要么无人认领导致任务悬挂。roleagent.md RA-014 要求持球者必须声明 custody lease，lease 有 TTL，Forgekin消失后 lease 自动过期，其他Forgekin可重新 acquire。本 Feature 提供 BallCustodyRegistry，作为 TeamAct 协作的结构性安全网。

### 1.2 当前痛点

- 没有 lease 概念，球权归属不可观测
- 双Forgekin同时持球，F004 路由后两个 owner 都执行 ACTION 步骤
- Forgekin异常退出后任务悬挂，无 TTL 自动释放
- 测试需要 sleep 等待 TTL 过期，测试套件慢且不确定
- F003 HandoffCapsule 缺少 `custody_lease_id` 桥接，无法追踪 lease 流转

### 1.3 不做的影响

- TeamAct 违反 RA-014，球权归属不可观测
- 双持球冲突导致 ACTION 步骤重复执行，浪费 LLM 调用成本
- 任务悬挂无法自动恢复，需要 operator 人工干预
- F003 HandoffCapsule 的 `custody_lease_id` 字段无意义

## 2. 决策

### 2.1 核心设计

BallCustodyRegistry 由 `flowforge/core/teamact/ball_custody.py` 实现，核心设计：

- **lease 是结构化记录**：`CustodyLease` dataclass 含 `lease_id` / `ball_id` / `owner` / `expires_at`，禁裸字符串表示球权
- **TTL 默认 300 秒（5 分钟）**：`DEFAULT_TTL_SECONDS = 300`，TTL 是安全网不是主要释放机制（持球者应主动 `release`）
- **`now_fn` 注入**：构造函数接受 `now_fn: Callable[[], datetime]`，默认 `datetime.now(timezone.utc)`；测试可注入快进时间函数，无需 sleep
- **双持球防护**：`acquire()` 时检查 existing lease，若未过期则抛 `TeamActError("ball is already held by ...")`
- **懒清理过期 lease**：`acquire` 与 `current_holder` 调用时清理过期 lease，避免后台定时任务
- **`renew` 允许过期续约**：持球者回归后可 renew 已过期 lease（重新计算 expiry），但会 re-check 球权归属以防被他人抢走
- **`release` 主动释放**：持球者完成任务后主动 release，TTL 不应作为主要释放路径
- **lease_id 自动生成**：`lease-{uuid4_hex[:10]}` 前缀，与 F003 capsule_id 风格一致

### 2.2 关键接口

```python
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable
from flowforge.core.errors import TeamActError

DEFAULT_TTL_SECONDS: int = 300
NowFn = Callable[[], datetime]


@dataclass
class CustodyLease:
    """Internal record of one active custody lease."""
    lease_id: str
    ball_id: str
    owner: str
    expires_at: datetime


class BallCustodyRegistry:
    """In-memory registry of ball-custody leases."""

    def __init__(self, now_fn: NowFn | None = None) -> None:
        self._now_fn: NowFn = now_fn or (lambda: datetime.now(timezone.utc))
        self._leases: dict[str, CustodyLease] = {}      # lease_id -> lease
        self._ball_to_lease: dict[str, str] = {}         # ball_id -> lease_id

    def acquire(self, ball_id: str, owner: str, ttl_seconds: int) -> str:
        """Acquire custody; raise TeamActError if ball already held."""
        ...  # 双持球检查 + 懒清理过期 lease + 生成新 lease

    def renew(self, lease_id: str) -> None:
        """Renew lease; re-checks ball ownership in case another owner grabbed it."""
        ...  # 用 DEFAULT_TTL_SECONDS 续约

    def release(self, lease_id: str) -> None:
        """Release custody voluntarily."""
        ...

    def current_holder(self, ball_id: str) -> str | None:
        """Query current holder; returns None if expired or unheld."""
        ...

    def is_expired(self, lease_id: str) -> bool:
        """Check if a lease has expired (unknown lease treated as expired)."""
        ...
```

### 2.3 协作流程

BallCustodyRegistry 在 TeamAct 生态中与其他 4 份子 Feature 协作：

- **F003 HandoffCapsule**：`acquire` 返回的 `lease_id` 写入 capsule 的 `custody_lease_id` 字段；capsule 流转时 lease 同步转移（release 旧 lease + acquire 新 lease）
- **F004 AtMentionRouter**：路由结果驱动 `acquire` 的 `owner` 参数；广播路由（`@all`）不触发 acquire
- **F006 PushBackProtocol**：推回期间 `from_owner` 保持 lease 不释放；推回不是球权转移，是球权持有期间的辩论
- **F007 PingPongCircuitBreaker**：熔断后 lease 强制 `release`，球权交回 operator；operator 干预后可重新 acquire 给恢复的 owner

lease 生命周期：acquire（OWNER 步骤）→ renew（长任务续约）→ release（ROUTE 步骤主动释放）或 TTL 过期（安全网懒清理）。

### 2.4 关键不变量

- INV-1: 同一 `ball_id` 同时只能有一个未过期 lease，违反抛 `TeamActError`（双持球防护）
- INV-2: `acquire` 时若 existing lease 未过期，必须抛错，禁静默覆盖
- INV-3: `release` 后 `current_holder` 返回 None，球权显式释放
- INV-4: TTL 过期的 lease 在 `acquire` / `current_holder` 调用时懒清理，无后台定时任务
- INV-5: `now_fn` 注入而非全局 `datetime.utcnow()`，保证测试可快进且确定性
- INV-6: 未知 `lease_id` 视为过期（`is_expired` 返回 True），调用方可安全 evict

### 2.5 失败模式与恢复

| # | 失败模式 | 检测 | 恢复 |
|---|---------|------|------|
| FM-1 | 双持球（acquire 时 existing lease 未过期） | `acquire()` 抛 `TeamActError` | 调用方协商 release 或等待 TTL 过期 |
| FM-2 | lease 泄漏（owner 异常退出未 release） | TTL 过期后 `current_holder` 返回 None | TTL 安全网懒清理，其他 owner 可重新 acquire |
| FM-3 | `now_fn` 注入错误导致 TTL 计算偏差 | 单元测试覆盖时间快进 | 仅测试场景注入，生产用默认 `datetime.now(timezone.utc)` |
| FM-4 | 重启后 lease 丢失（内存 registry） | 重启后 `current_holder` 返回 None | Phase B 接入 Durable State Surfaces 持久化 |
| FM-5 | 多进程 TOCTOU 竞态 | 单进程内存字典原子操作 | 多进程需引入锁（暂不在 P0 范围） |

恢复原则：TTL 是安全网不是主要释放机制；持球者应主动 release，TTL 仅在 owner 消失时兜底。

触发阈值：`acquire()` 检查 existing lease 未过期即抛错；TTL 过期在 `acquire` / `current_holder` 调用时懒清理。

### 2.6 监控指标

| 指标 | 含义 | 采集方式 |
|------|------|---------|
| lease_acquire_conflict_count | 双持球冲突次数 | `acquire()` 抛 `TeamActError` 统计 |
| lease_ttl_expiry_count | TTL 过期释放次数 | `current_holder` 懒清理统计 |
| lease_renew_count | 续约次数 | `renew()` 调用统计 |
| lease_active_count | 当前活跃 lease 数 | `_ball_to_lease` 字典大小 |

监控原则：所有指标通过 `core.tracing.get_logger` 注入 trace_id，禁裸 print（铁律 5）。

## 3. 验收标准

### Phase A（lease 机制 + 双持球防护）

- [ ] AC-A1: `acquire(ball_id, owner, ttl_seconds)` 返回 `lease-{10hex}` 格式 lease_id
- [ ] AC-A2: `acquire` 时若 ball 已被持有且未过期，抛 `TeamActError` 含 `is already held by` 信息
- [ ] AC-A3: `acquire` 时若 existing lease 已过期，懒清理后允许新 owner acquire
- [ ] AC-A4: `acquire` 拒绝空 ball_id / 空 owner / ttl_seconds <= 0
- [ ] AC-A5: `release(lease_id)` 后 `current_holder(ball_id)` 返回 None
- [ ] AC-A6: `renew(lease_id)` 将 expires_at 更新为 now + DEFAULT_TTL_SECONDS
- [ ] AC-A7: `current_holder` 对过期 lease 返回 None（不主动清理，仅查询返回 None）
- [ ] AC-A8: `is_expired` 对未知 lease_id 返回 True（调用方可安全 evict）
- [ ] AC-A9: `now_fn` 注入可让测试快进时间，无需 sleep（确定性测试）

### Phase B（TeamAct 集成 + E2E）

- [ ] AC-B1: F002 OWNER 步骤调用 `acquire` 持球，ROUTE 步骤调用 `release` 交球
- [ ] AC-B2: F003 HandoffCapsule 的 `custody_lease_id` 与 F005 lease_id 一致
- [ ] AC-B3: F004 `@all` 广播不触发 acquire（避免全员抢球）
- [ ] AC-B4: lease 操作延迟 < 1ms（纯内存字典，无 IO）
- [ ] AC-B5: 持球Forgekin异常退出后，TTL 过期其他Forgekin可重新 acquire（模拟 now_fn 快进）
- [ ] AC-B6: 遵守 T1-T8 测试铁律（真实 LLM 调用、真实场景数据、不跳过验证、不 Mock 工具、采集完整指标、LLM 生成内容经 LLM 审核、Web 功能操控浏览器验证 DOM）

## 4. 依赖

- **Evolved from**: F002（TeamAct 主循环 OWNER / ROUTE 步骤）
- **Blocked by**: F002
- **Related**: F003（HandoffCapsule 携带 `custody_lease_id`）、F004（AtMentionRouter 路由后触发 acquire）、F006（PushBack 时持球者保持 lease）、F007（熔断后 lease 强制 release 升级给 operator）、F001（CapabilityProfile 路由结果驱动 acquire 的 owner 参数）

## 5. 风险

| 风险 | 缓解 |
|------|------|
| TTL 默认 300 秒不够长 | 持球者可 `renew` 续约；TTL 只是安全网 |
| 内存 registry 重启后 lease 丢失 | Phase B 接入 Durable State Surfaces（F008）持久化 |
| `now_fn` 注入被滥用 | 仅限测试场景注入，生产环境用默认 `datetime.now(timezone.utc)` |
| 双持球检查有 TOCTOU 竞态 | 单进程内存字典操作原子，多进程需引入锁（暂不在 P0 范围） |
| 过期 lease 不主动清理导致内存泄漏 | `acquire` 与 `current_holder` 懒清理；后续可加后台 sweep |

## 6. Open Questions

| # | 问题 | 状态 |
|---|------|------|
| OQ-1 | lease 是否需要持久化到 SQLite/Repository，重启后可恢复？ | ⬜ 未定 |
| OQ-2 | `renew` 是否应该接受自定义 ttl_seconds 参数（而非固定 DEFAULT_TTL_SECONDS）？ | ⬜ 未定 |
| OQ-3 | 是否需要 lease 转移语义（transfer to another owner without release+acquire）？ | ⬜ 未定 |

## 7. Key Decisions

| # | 决策 | 理由 | 日期 |
|---|------|------|------|
| KD-1 | TTL 默认 300 秒 | RA-014：TTL 是安全网，持球者应主动 release | 2026-07-21 |
| KD-2 | `now_fn` 注入 | 测试无需 sleep，保证测试套件快速且确定性 | 2026-07-21 |
| KD-3 | 双持球检查抛 `TeamActError` | 防止 F004 路由后两个 owner 都执行 ACTION | 2026-07-21 |
| KD-4 | 懒清理过期 lease | 避免后台定时任务复杂度，acquire/current_holder 时清理 | 2026-07-21 |
| KD-5 | 未知 lease_id 视为过期 | 调用方可安全 evict，无需区分"不存在"与"已过期" | 2026-07-21 |

## 8. Timeline

| 日期 | 事件 |
|------|------|
| 2026-07-21 | 立项，基于 ADR-002 与 F002 提取球权租借子 Feature 规格 |

## 9. Review Gate

- Phase A: 单元测试通过（acquire / release / renew / current_holder / is_expired 全分支覆盖 + now_fn 快进验证），由架构师Forgekin review
- Phase B: E2E 测试由跨厂商 reviewer Forgekin review，双持球防护 + TTL 过期恢复在真实协作场景中验证

## 10. Links

| 类型 | 路径 | 说明 |
|------|------|------|
| **ADR** | `docs/decisions/002-teamact-collaboration-protocol.md` | TeamAct 协作协议决策 |
| **Feature** | `docs/features/F002-teamact-loop.md` | TeamAct 主循环 |
| **Feature** | `docs/features/F003-handoff-capsule.md` | 交接胶囊 |
| **Feature** | `docs/features/F004-at-mention-router.md` | @mention 路由 |
| **Feature** | `docs/features/F006-push-back-protocol.md` | 推回协议 |
| **Feature** | `docs/features/F007-pingpong-circuit-breaker.md` | 乒乓球熔断器 |
| **代码** | `flowforge/core/teamact/ball_custody.py` | BallCustodyRegistry 实现 |
