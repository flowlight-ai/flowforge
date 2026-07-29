---
feature_ids: [F025]
related_features: [F021, F022, F023, F024]
topics: [reliability, provider, failover, priority, health, abstraction]
doc_kind: spec
created: 2026-07-21
---

# F025: Provider Host 抽象（Provider Host Abstraction）

> **状态**: spec | **负责人**: 架构师Forgekin | **优先级**: P0
> **依赖 ADR**: [doc:decisions/010-distributed-reliability.md]
> **依据**: operator 7 条不可妥协原则 + roleagent.md 第 6 章 分布式可靠性
> **关联 VISION**: [doc:VISION.md#6]（operator 原则第 6 条：支持自己开发自己）

## 1. 上下文

### 1.1 问题陈述

`[doc:roleagent.md#第6章]` 第三类失败模式专门讨论跨 provider 语义一致性：Claude、GPT、Gemini、Antigravity 等 provider 的超时策略、错误码语义、通道协议、恢复机制各不相同。同一套可靠性规则不能绑死在某一家实现上。FlowForge 通用底座需要一个 provider 无关的宿主抽象——"provider" 在这里指任何可寻址宿主（LLM 厂商 / 搜索后端 / 发布通道），按优先级排序，支持健康状态管理与 failover。

### 1.2 当前痛点

- provider 抽象绑死 LLM SDK，无法复用到搜索后端 / 发布通道
- 无优先级排序，failover 时随机选 provider
- 健康状态散落各 Agent，无统一管理
- `select_provider` 无 exclude 机制，failed provider 被反复选中
- 同优先级 provider 选择无确定规则（可能热点）
- `last_state_change` 缺失，无法追踪健康翻转时间供 SLA 监控

### 1.3 不做的影响

- F022 TIER_2_FAILOVER 无 target 池，降级 ESCALATE
- F023 Liveness 探针结果无消费方，健康状态无法驱动路由
- `[doc:roleagent.md#第6章]` "统一宿主抽象"无法落地
- project_rules 红线 10（禁止在 flowforge 写死业务领域代码）被违反——可靠性层无法被 *Forge 复用

## 2. 决策

### 2.1 核心设计

`ProviderHost` 是 provider 无关的宿主抽象——模块**刻意不**import `flowforge.llm.provider`，"provider" 在这里指任何可寻址宿主（LLM 厂商 / 搜索后端 / 发布通道）。`ProviderInfo` 暴露 `name / priority / healthy / last_state_change`，`priority` 数字越小优先级越高（1 优于 2）。

`select_provider(exclude)` 在健康且不在 `exclude` 列表的候选中选优先级最高者，返回 `None` 表示全部不可用（不抛异常，调用方决定兜底策略）。`mark_unhealthy` / `mark_healthy` 翻转健康标志并记录 `last_state_change`，供 dashboard 与 SLA 监控消费。failover 时把失败 provider 加入 `exclude`，下一次 `select_provider` 自然跳过——这与 `TierRecoveryService` 的 TIER_2_FAILOVER 协同。同优先级按注册顺序（dict 插入顺序）选择，保证结果可预测。

### 2.2 关键接口

```python
from dataclasses import dataclass
from datetime import datetime
from flowforge.core.errors import ReliabilityError
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.reliability.provider_host")


@dataclass
class ProviderInfo:
    """单个已注册 provider 的公开视图。
    priority           — 数字越小优先级越高（1 优于 2）
    healthy            — False 时不可被 select_provider 选中
    last_state_change  — 健康状态最近翻转时间（供 dashboard/SLA 消费）
    """
    name: str
    priority: int
    healthy: bool
    last_state_change: datetime


class ProviderHost:
    """按优先级排序的 provider 池，支持健康状态跟踪与 failover。
    选择规则：在健康 AND 不在 exclude 列表的候选中，选 priority 最小者。
    同优先级按注册顺序（dict 插入顺序）。
    返回 None 表示无可用 provider（不抛异常）。
    """

    def register_provider(
        self,
        name: str,
        priority: int,
        healthy: bool = True,
    ) -> None:
        """注册 provider。name 非空，重复注册抛 ReliabilityError。
        last_state_change 初始化为当前 UTC 时间。"""

    def mark_unhealthy(self, name: str) -> None:
        """标记 provider 不健康。未注册抛 ReliabilityError。
        仅在当前 healthy=True 时翻转并更新 last_state_change。"""

    def mark_healthy(self, name: str) -> None:
        """标记 provider 健康。未注册抛 ReliabilityError。
        仅在当前 healthy=False 时翻转并更新 last_state_change。"""

    def select_provider(self, exclude: list[str] | None = None) -> str | None:
        """返回优先级最高的健康 provider（不在 exclude 列表）。
        无可用时返回 None。同优先级按注册顺序。"""

    def list_providers(self) -> list[ProviderInfo]:
        """返回所有 provider 快照（注册顺序）。"""

    def is_healthy(self, name: str) -> bool:
        """查询 provider 健康状态。未注册抛 ReliabilityError。"""

    def count(self) -> int:
        """已注册 provider 总数。"""
```

## 3. 验收标准

### Phase A（注册 + 优先级 + 健康管理）

- [ ] AC-A1: `ProviderInfo` 字段完整（name / priority / healthy / last_state_change）
- [ ] AC-A2: `register_provider` 拒绝空 `name` 与重复注册，抛 `ReliabilityError`
- [ ] AC-A3: `register_provider` 默认 `healthy=True`，`last_state_change` 初始化为当前 UTC 时间（`datetime.now(timezone.utc)`）
- [ ] AC-A4: `select_provider` 在健康候选中选 `priority` 最小者（1 优于 2）
- [ ] AC-A5: `select_provider` 跳过 `exclude` 列表中的 provider
- [ ] AC-A6: `select_provider` 无可用候选时返回 `None`（不抛异常）
- [ ] AC-A7: `mark_unhealthy` / `mark_healthy` 仅在状态翻转时更新 `last_state_change`（幂等）
- [ ] AC-A8: 同优先级 provider 按注册顺序选择（dict 插入顺序）
- [ ] AC-A9: `is_healthy` 对未注册 `name` 抛 `ReliabilityError`
- [ ] AC-A10: `list_providers` 返回快照，调用方篡改不影响内部状态
- [ ] AC-A11: 通过 `core/tracing.get_logger` 写结构化日志（`reliability: select_provider / mark_unhealthy ...`），自动注入 `trace_id`

### Phase B（failover + 与 Tier/Liveness 集成 + E2E）

- [ ] AC-B1: 模块**不**import `flowforge.llm.provider`——provider 无关，可被 *Forge 复用（对齐 project_rules 红线 10）
- [ ] AC-B2: failover 场景——failed provider 加入 `exclude`，下次 `select_provider` 自然跳过
- [ ] AC-B3: 与 F022 集成——`RecoveryPolicy.failover_targets` 来自 `ProviderHost` 优先级排序
- [ ] AC-B4: 与 F023 集成——Liveness 探针不健康时调用 `mark_unhealthy`，恢复时调用 `mark_healthy`
- [ ] AC-B5: 与 F021 集成——provider failover 时副作用已执行则走 WAL 回滚
- [ ] AC-B6: `select_provider` 端到端延迟 < 1ms（内存查询）
- [ ] AC-B7: E2E 测试——真实多 provider 场景（如 Claude + GPT + Gemini），主 provider 故障注入后自动 failover 到备份，恢复后自动切回
- [ ] AC-B8: 遵守 T1-T8 测试铁律（真实 LLM 调用、真实场景数据、不跳过验证、不 Mock 工具、采集完整指标、LLM 生成内容经 LLM 审核、Web 功能操控浏览器验证 DOM）

## 4. 依赖

- **Evolved from**: 无
- **Blocked by**: 无
- **Related**: F021（provider failover 时副作用已执行则走 WAL 回滚）、F022（TIER_2_FAILOVER 的 target 池来自 ProviderHost）、F023（探针结果驱动 mark_unhealthy / mark_healthy）、F024（`requires_external_state=True` 步骤的 provider 依赖由 ProviderHost 管理）

## 5. 风险

| 风险 | 缓解 |
|------|------|
| 同优先级按注册顺序可能造成热点 | P2 阶段在同优先级内引入加权随机或轮询 |
| `mark_unhealthy` 后未自动恢复 | 与 F023 Liveness 探针联动——探针恢复时自动 `mark_healthy` |
| provider 列表配置漂移 | 启动时检查关键 provider 是否注册（如 LLM 主备） |
| `select_provider` 返回 None 时调用方无兜底 | 调用方必须处理 None，由 F022 TierRecoveryService 升级 ESCALATE |
| 内存健康状态进程崩溃即丢失 | 接口设计已预留持久化路径，P2 阶段补齐 |

## 6. Open Questions

| # | 问题 | 状态 |
|---|------|------|
| OQ-1 | 同优先级 provider 是否需要加权随机或轮询？ | ⬜ 未定 |
| OQ-2 | `last_state_change` 是否需要持久化供历史趋势分析？ | ⬜ 未定 |
| OQ-3 | provider 健康状态是否需要主动探活（后台心跳），还是被动由 Liveness 探针驱动？ | ⬜ 未定 |
| OQ-4 | `priority` 是否支持运行时动态调整（如降级主 provider）？ | ⬜ 未定 |

## 7. Key Decisions

| # | 决策 | 理由 | 日期 |
|---|------|------|------|
| KD-1 | provider 无关抽象，不 import `flowforge.llm.provider` | project_rules 红线 10（禁止在 flowforge 写死业务领域代码），可靠性层可被 *Forge 复用 | 2026-07-21 |
| KD-2 | `priority` 数字越小优先级越高 | 与 Unix nice / k8s priority 一致，直觉友好 | 2026-07-21 |
| KD-3 | `select_provider(exclude)` 支持 failover 排除 | failed provider 加入 exclude，下次自然跳过，与 TIER_2_FAILOVER 协同 | 2026-07-21 |
| KD-4 | 无可用 provider 返回 None 而非抛异常 | 调用方决定兜底策略（如 ESCALATE），避免在可靠性层硬编码 | 2026-07-21 |
| KD-5 | 同优先级按注册顺序 | 保证结果可预测，P2 阶段再引入加权随机 | 2026-07-21 |

## 8. Timeline

| 日期 | 事件 |
|------|------|
| 2026-07-21 | 立项，确立 Provider Host 抽象 Feature 规格，术语对齐项目正式命名（Forgekin） |

## 9. Review Gate

- Phase A: 单元测试通过，`ProviderHost` 注册与优先级选择由架构师Forgekin review
- Phase B: E2E 测试由跨厂商 reviewer Forgekin review，failover 自动切换、与 F022/F023 集成正确性达标

## 10. Links

| 类型 | 路径 | 说明 |
|------|------|------|
| **ADR** | `docs/decisions/010-distributed-reliability.md` | 分布式可靠性决策（5 原语之一） |
| **Feature** | `docs/features/F022-tier-recovery.md` | TIER_2_FAILOVER 消费 ProviderHost |
| **Feature** | `docs/features/F023-liveness-probe.md` | 探针驱动 mark_unhealthy/mark_healthy |
| **代码** | `flowforge/core/reliability/provider_host.py` | F025 实现 |
| **roleagent** | `docs/roleagent.md#第6章` | 分布式可靠性（第三类失败模式：跨 provider 语义一致性） |
| **VISION** | `docs/VISION.md#6` | operator 原则第 6 条（支持自己开发自己） |
