---
feature_ids: [F003]
related_features: [F002, F004, F005, F006, F007]
topics: [teamact, handoff, capsule, protocol]
doc_kind: spec
created: 2026-07-21
---

# F003: 交接胶囊（Handoff Capsule）

> **状态**: spec | **负责人**: 架构师灵智体 | **优先级**: P0
> **依赖 ADR**: [doc:decisions/002-teamact-collaboration-protocol.md]
> **依赖 Feature**: [doc:features/F002-teamact-loop.md]
> **依据**: operator 7 条不可妥协原则 + roleagent.md 工程路径（RA-011 协议层硬要求）
> **关联 VISION**: [doc:VISION.md#4]（协作单位：动态能力画像路由）

## 1. 上下文

### 1.1 问题陈述

TeamAct 六步循环（F002）在 ROUTE 步骤把球权从当前持球灵智体交给下一个灵智体时，如果只传递一个 `to_owner` 字符串，后继灵智体必须重读全部上下文（对话流、共享状态、灵忆 EchoStore）才能判断"该做什么、做到哪一步、为什么这样做"。这导致上下文窗口浪费、推理质量下降，且无法被跨厂商 review 系统复用。本 Feature 提供结构化的 HandoffCapsule，作为 TeamAct 协议层硬要求（roleagent.md RA-011），让球权交接携带最小必要信息，使后继灵智体无需重读全部上下文即可接管任务。

### 1.2 当前痛点

- 灵智体交接只传 `to_owner`，后继灵智体重读全部上下文，Token 成本高
- 缺少"做了什么 / 下一步该做什么"的结构化字段，交接质量不可观测
- 没有 `required_capabilities` 字段，无法驱动 F001 CapabilityProfile 路由
- 没有 `custody_lease_id` 字段，无法与 F005 BallCustodyRegistry 联动
- 交接格式漂移，Pydantic / dataclass Schema 缺失，跨厂商 review 无法复用

### 1.3 不做的影响

- TeamAct ROUTE 步骤退化为"口头交接"，违反 RA-011 协议层硬要求
- 后继灵智体上下文窗口爆炸，推理质量下降
- 无法与 F001 CapabilityProfile / F005 BallCustodyRegistry 联动
- 跨厂商 review 缺少结构化输入，F002 五项终止条件中 `cross_agent_verified` 难以达成

## 2. 决策

### 2.1 核心设计

HandoffCapsule 是 TeamAct 层（区别于 loop 层 `flowforge/loop/state.py` 的 HandoffCapsule）的结构化交接胶囊，由 `flowforge/core/teamact/handoff.py` 实现。设计要点：

- **dataclass 而非 Pydantic**：与 TeamAct 子组件（F004/F005/F006/F007）保持一致，避免引入额外依赖
- **`from_owner` 与 `summary` 强制非空**：`validate()` 在 `from_owner` 或 `summary` 为空时抛 `TeamActError`，正是 RA-011 指出的"匿名无摘要胶囊迫使接收方重读上下文"故障
- **`to_owner` 与 `required_capabilities` 二选一**：当 `to_owner` 为空时必须提供 `required_capabilities`，让 AtMentionRouter（F004）+ CapabilityProfile（F001）能解析出下一个持球者
- **`custody_lease_id` 桥接 F005**：胶囊携带球权 lease id，让 F005 BallCustodyRegistry 能跟踪"哪个 lease 随胶囊流转"
- **`capsule_id` 自动生成**：`ta-hc-{uuid4_hex[:10]}` 前缀，便于跨厂商 review 与 Eval 系统引用
- **`created_at` 用 timezone-aware datetime**：避免 naive datetime 在跨时区协作中产生歧义

### 2.2 关键接口

```python
from dataclasses import dataclass, field
from datetime import datetime, timezone
import uuid
from flowforge.core.errors import TeamActError


@dataclass
class HandoffCapsule:
    """Self-contained message passed from one TeamAct owner to the next.

    Fields:
        from_owner:           id of the forgekin handing off
        to_owner:             id of the forgekin picking up (may be empty if
                              routing is deferred to the at-mention router)
        summary:              what was done (the "What")
        next_action_hint:     what the next owner should do (the "Next")
        required_capabilities: capabilities the next owner must have (drives
                              CapabilityProfile-based routing, F001)
        custody_lease_id:     ball-custody lease id (F005) being transferred;
                              empty when no lease is in play
    """
    from_owner: str = ""
    to_owner: str = ""
    summary: str = ""
    next_action_hint: str = ""
    required_capabilities: list[str] = field(default_factory=list)
    custody_lease_id: str = ""
    capsule_id: str = field(default_factory=lambda: f"ta-hc-{uuid.uuid4().hex[:10]}")
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def validate(self) -> None:
        """Check required fields; raise TeamActError on violation."""
        if not self.from_owner.strip():
            raise TeamActError("HandoffCapsule.from_owner must not be empty")
        if not self.summary.strip():
            raise TeamActError("HandoffCapsule.summary must not be empty")
        if not self.to_owner.strip() and not self.required_capabilities:
            raise TeamActError(
                "HandoffCapsule must specify either to_owner or required_capabilities "
                "so the next owner can be resolved"
            )

### 2.3 协作流程

HandoffCapsule 在 TeamAct 生态中与其他 4 份子 Feature 协作：

- **F004 AtMentionRouter**：`to_owner` 字段由 `AtMentionRouter.route()` 解析行首 @ 指令填充；当 `to_owner` 为空时，`required_capabilities` 驱动 F001 CapabilityProfile 路由
- **F005 BallCustodyRegistry**：`custody_lease_id` 字段桥接球权 lease，ROUTE 步骤生成 capsule 时同步 acquire lease，接收方消费 capsule 时同步 release 旧 lease
- **F006 PushBackProtocol**：推回触发时生成 capsule 通知 `to_owner`（被推回方），capsule 的 `summary` 携带推回理由摘要
- **F007 PingPongCircuitBreaker**：熔断后生成升级 capsule，`to_owner="operator"`，`next_action_hint` 携带熔断原因与失败计数

协作时序：F004 路由解析 → F003 capsule 生成（validate）→ F005 lease 流转 → F006 推回（可选）→ F007 熔断（可选）→ operator 升级。

### 2.4 关键不变量

- INV-1: capsule 在 ROUTE 步骤生成时必须 `validate()` 通过，否则 TeamAct 循环中止
- INV-2: `from_owner` 与 `summary` 永不为空（RA-011 协议层硬要求，违反抛 `TeamActError`）
- INV-3: `to_owner` 与 `required_capabilities` 至少一个非空，保证下一个持球者可被解析
- INV-4: `custody_lease_id` 非空时必须对应 F005 BallCustodyRegistry 中活跃（未过期）的 lease
- INV-5: `created_at` 必须 timezone-aware（`datetime.now(timezone.utc)`），禁 naive datetime
- INV-6: `capsule_id` 自动生成且全局唯一（`ta-hc-` 前缀 + 10 位 hex），禁手工填充

### 2.5 失败模式与恢复

| # | 失败模式 | 检测 | 恢复 |
|---|---------|------|------|
| FM-1 | `from_owner` 为空 | `validate()` 抛 `TeamActError` | operator 手动补全或重新生成 capsule |
| FM-2 | `custody_lease_id` 与 F005 lease 不同步 | 接收方 acquire 失败 | 重新 acquire 新 lease，更新 capsule 字段 |
| FM-3 | `required_capabilities` 无法被任何灵智体满足 | F001 路由返回空 | 升级 operator，手动指定 `to_owner` |
| FM-4 | capsule 字段缺失或格式漂移 | dataclass Schema 校验 | 架构师灵智体 review，对齐 `handoff.py` |
| FM-5 | 与 loop 层 HandoffCapsule 混淆 | 模块路径隔离 + docstring 区分 | 引用 `core/teamact/handoff.py` 而非 `loop/state.py` |

恢复原则：`validate()` 失败即中止 ROUTE 步骤，禁生成非法 capsule；所有失败均升级 trace 供 operator 排查。

触发阈值：ROUTE 步骤生成 capsule 时强制 `validate()`；接收方消费 capsule 时校验 `custody_lease_id` 活跃性。

### 2.6 监控指标

| 指标 | 含义 | 采集方式 |
|------|------|---------|
| capsule_validate_failure_count | `validate()` 失败次数 | trace 日志统计 |
| capsule_custody_lease_mismatch_count | `custody_lease_id` 与 F005 lease 不同步次数 | 接收方 acquire 失败统计 |
| capsule_complete_rate | capsule 8 字段完整率 | F002 AC-B4 联动验收 |
| handoff_latency_ms | ROUTE 步骤生成 capsule 延迟 | trace 时间戳差 |

监控原则：所有指标通过 `core.tracing.get_logger` 注入 trace_id，禁裸 print（铁律 5）。

## 3. 验收标准

### Phase A（数据结构 + 协议层硬要求）

- [ ] AC-A1: `HandoffCapsule` 包含 8 个字段（from_owner / to_owner / summary / next_action_hint / required_capabilities / custody_lease_id / capsule_id / created_at）
- [ ] AC-A2: `validate()` 在 `from_owner` 为空时抛 `TeamActError`
- [ ] AC-A3: `validate()` 在 `summary` 为空时抛 `TeamActError`
- [ ] AC-A4: `validate()` 在 `to_owner` 与 `required_capabilities` 同时为空时抛 `TeamActError`
- [ ] AC-A5: `capsule_id` 自动生成 `ta-hc-` 前缀 + 10 位 hex，保证全局唯一
- [ ] AC-A6: `created_at` 默认 timezone-aware（`datetime.now(timezone.utc)`），禁 naive datetime
- [ ] AC-A7: 持久化通过 Repository 层（Durable State Surfaces），禁直接操作数据库（编程红线第 13 条）

### Phase B（TeamAct 集成 + E2E）

- [ ] AC-B1: F002 TeamActState 在 ROUTE 步骤必须生成 HandoffCapsule 并 validate 通过
- [ ] AC-B2: 当 `to_owner` 为空时，胶囊的 `required_capabilities` 能被 F004 AtMentionRouter + F001 CapabilityProfile 解析出下一个持球者
- [ ] AC-B3: 胶囊的 `custody_lease_id` 能驱动 F005 BallCustodyRegistry 完成 lease 流转
- [ ] AC-B4: 交接胶囊完整率 100%（F002 AC-B4 联动验收）
- [ ] AC-B5: E2E 测试 — 3 个灵智体协作完成一个 Feature，胶囊正确传递，后继灵智体无需重读全部上下文
- [ ] AC-B6: 遵守 T1-T8 测试铁律（真实 LLM 调用、真实场景数据、不跳过验证、不 Mock 工具、采集完整指标、LLM 生成内容经 LLM 审核、Web 功能操控浏览器验证 DOM）

## 4. 依赖

- **Evolved from**: F002（TeamAct 主循环 ROUTE 步骤）
- **Blocked by**: F002
- **Related**: F001（CapabilityProfile 路由依赖 `required_capabilities`）、F004（AtMentionRouter 解析 `to_owner`）、F005（BallCustodyRegistry 流转 `custody_lease_id`）、F006（PushBack 可触发交接）、F007（熔断后生成升级胶囊给 operator）

## 5. 风险

| 风险 | 缓解 |
|------|------|
| 胶囊字段过多导致灵智体懒得填 | `validate()` 强制 `from_owner` + `summary` 非空，其余字段按场景填写 |
| `required_capabilities` 命名不规范导致路由失败 | 与 F001 CapabilityProfile 命名契约对齐，由架构师灵智体 review |
| `custody_lease_id` 与 F005 状态不同步 | 胶囊生成时同步 acquire lease，胶囊消费时同步 release 旧 lease |
| 与 loop 层 HandoffCapsule 混淆 | 模块路径隔离（`core/teamact/handoff.py` vs `loop/state.py`）+ docstring 明确区分 |

## 6. Open Questions

| # | 问题 | 状态 |
|---|------|------|
| OQ-1 | 胶囊是否需要支持版本号字段，用于跨灵智体迭代时追踪 capsule 演化？ | ⬜ 未定 |
| OQ-2 | `next_action_hint` 是否需要结构化为 Pydantic 模型（如 `{step, args, expected_output}`）？ | ⬜ 未定 |
| OQ-3 | 胶囊是否需要签名（灵印 SoulImprint）防止伪造？ | ⬜ 未定 |

## 7. Key Decisions

| # | 决策 | 理由 | 日期 |
|---|------|------|------|
| KD-1 | dataclass 而非 Pydantic | 与 F004/F005/F006/F007 子组件一致，避免引入额外依赖 | 2026-07-21 |
| KD-2 | `from_owner` + `summary` 强制非空 | RA-011：匿名无摘要胶囊迫使接收方重读全部上下文 | 2026-07-21 |
| KD-3 | `to_owner` 与 `required_capabilities` 二选一 | 支持显式路由（to_owner）与能力路由（required_capabilities）两种模式 | 2026-07-21 |
| KD-4 | `capsule_id` 用 `ta-hc-` 前缀 | 与 loop 层 HandoffCapsule 区分，便于日志与 Eval 检索 | 2026-07-21 |

## 8. Timeline

| 日期 | 事件 |
|------|------|
| 2026-07-21 | 立项，基于 ADR-002 与 F002 提取交接胶囊子 Feature 规格，术语对齐 Forgekin |

## 9. Review Gate

- Phase A: 单元测试通过（`validate()` 全部分支覆盖），由架构师灵智体 review
- Phase B: E2E 测试由跨厂商 reviewer 灵智体 review，胶囊完整率 100% + 后继灵智体无需重读上下文验证通过

## 10. Links

| 类型 | 路径 | 说明 |
|------|------|------|
| **ADR** | `docs/decisions/002-teamact-collaboration-protocol.md` | TeamAct 协作协议决策 |
| **Feature** | `docs/features/F002-teamact-loop.md` | TeamAct 主循环 |
| **Feature** | `docs/features/F004-at-mention-router.md` | @mention 路由 |
| **Feature** | `docs/features/F005-ball-custody-lease.md` | 球权租借 |
| **Feature** | `docs/features/F006-push-back-protocol.md` | 推回协议 |
| **Feature** | `docs/features/F007-pingpong-circuit-breaker.md` | 乒乓球熔断器 |
| **代码** | `flowforge/core/teamact/handoff.py` | HandoffCapsule 实现 |
