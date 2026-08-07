---
feature_ids: [F023]
related_features: [F021, F022, F024, F025]
topics: [reliability, liveness, probe, read-model, sla, isolation]
doc_kind: spec
created: 2026-07-21
---

# F023: Liveness 规范读（Liveness Probe）

> **状态**: spec | **负责人**: 架构师Forgekin | **优先级**: P0
> **依赖 ADR**: [doc:decisions/010-distributed-reliability.md]
> **依据**: operator 7 条不可妥协原则 + roleagent.md 第 6 章 分布式可靠性
> **关联 VISION**: [doc:VISION.md#6]（operator 原则第 6 条：支持自己开发自己）

## 1. 上下文

### 1.1 问题陈述

`[doc:roleagent.md#第6章]` 第二类失败模式记录了真实的 liveness split-brain：两个后端读路径对同一 invocation 给出矛盾结果。FlowForge 通用底座在路由工作前需要一个"这个能力还活着吗"的只读探针，但当前没有统一的探针注册与执行框架。各Forgekin（Forgekin）自行 ping 各自依赖，导致：(1) 探针结果不可比较；(2) 探针间相互干扰；(3) 探针超时无 SLA 约束；(4) 探针异常直接传播，单点故障影响全局。

### 1.2 当前痛点

- 探针逻辑散落各 Agent，无统一注册与执行框架
- 探针可能修改状态（违反"只读"原则），引入副作用
- 探针超时无 SLA 约束，慢探针拖垮整个路由决策
- 探针异常直接传播，一个挂掉全部挂掉
- 探针结果无法与 `TierRecoveryService` 联动，恢复决策缺数据来源
- `required_for` 缺失——探针不健康时不知道哪些能力被影响

### 1.3 不做的影响

- F022 TierRecoveryService 缺探针输入，无法决策 FAILOVER 时机
- F025 ProviderHost 的健康标志无数据来源，`mark_unhealthy` 依赖人工
- `[doc:roleagent.md#第6章]` "给数据不给结论"原则无法落地
- 路由决策基于过时健康状态，可能把工作发给已死 provider

## 2. 决策

### 2.1 核心设计

`LivenessProbe` 是路由前的**只读模型**——它永不改变状态，只报告。任何Forgekin可声明 `LivenessSpec`（`name / description / sla_seconds / required_for`），并注册一个异步 check 函数。`run_all` 串行执行所有探针，每个 `ProbeResult` 携带 `name / healthy / latency_ms / last_checked / error`，探针间相互隔离——一个抛异常不影响其他。

`required_for` 列出依赖该探针的能力名，探针不健康时这些能力被标记为退化。恢复决策**不**由探针做出，而是由 `TierRecoveryService` 基于探针结果触发——这是 `[doc:roleagent.md#第6章]` "给数据不给结论"原则的体现。探针 check 函数返回 `True`（健康）/ `False`（不健康），可抛异常；探针捕获后写入 `ProbeResult.error`。`latency_ms` 基于 `time.perf_counter` 测量，精度到毫秒。

### 2.2 关键接口

```python
from dataclasses import dataclass, field
from datetime import datetime
from typing import Awaitable, Callable
from flowforge.core.errors import ReliabilityError
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.reliability.liveness")

# 异步 check 函数：返回 True（健康）/ False（不健康）。
# 可抛异常；探针捕获后写入 ProbeResult.error。
ProbeCheckFn = Callable[[], Awaitable[bool]]


@dataclass
class ProbeResult:
    """单次探针检查结果。
    error 为异常字符串（无异常则 None）。
    latency_ms 基于 time.perf_counter 测量。
    """
    name: str
    healthy: bool
    latency_ms: float
    last_checked: datetime
    error: str | None = None


@dataclass
class LivenessSpec:
    """探针声明式规格。
    required_for 列出依赖此探针的能力名——探针不健康时这些能力被标记退化。
    sla_seconds 作为探针超时阈值（latency_ms > sla_seconds * 1000 视为超时）。
    """
    name: str
    description: str = ""
    sla_seconds: float = 5.0
    required_for: list[str] = field(default_factory=list)


class LivenessProbe:
    """探针注册表 + 执行器。
    探针间隔离：一个抛异常不影响其他。每个 result 携带独立 latency 与 error。
    串行执行（注册顺序），当前规模（<10 探针）下可接受。
    """

    def register_probe(
        self,
        name: str,
        check_fn: ProbeCheckFn,
        spec: LivenessSpec | None = None,
    ) -> None:
        """注册异步 check。name 非空，重复注册抛 ReliabilityError。
        spec 省略时从 name 合成默认 LivenessSpec（sla_seconds=5.0）。"""

    def register_spec(self, spec: LivenessSpec, check_fn: ProbeCheckFn) -> None:
        """用完整 LivenessSpec 注册探针。"""

    def list_specs(self) -> list[LivenessSpec]:
        """列出所有已注册探针规格。"""

    def get_spec(self, name: str) -> LivenessSpec:
        """查询单个探针规格。未注册抛 ReliabilityError。"""

    async def run_probe(self, name: str) -> ProbeResult:
        """执行单个探针。未注册抛 ReliabilityError。"""

    async def run_all(self) -> list[ProbeResult]:
        """串行执行所有探针（注册顺序），返回结果列表。
        单个探针抛异常时 healthy=False，error 捕获异常字符串，其他探针继续。
        """

    def count(self) -> int:
        """已注册探针数。"""
```

## 3. 验收标准

### Phase A（探针注册 + 隔离执行）

- [ ] AC-A1: `LivenessSpec` 字段完整（name / description="" / sla_seconds=5.0 / required_for）
- [ ] AC-A2: `ProbeResult` 字段完整（name / healthy / latency_ms / last_checked / error=None）
- [ ] AC-A3: `register_probe` 拒绝空 `name` 与重复注册，抛 `ReliabilityError`
- [ ] AC-A4: `register_probe` 在 `spec` 省略时从 `name` 合成默认 `LivenessSpec`（`sla_seconds=5.0`）
- [ ] AC-A5: `register_spec` 等价于 `register_probe(spec.name, check_fn, spec=spec)`
- [ ] AC-A6: `run_all` 串行执行所有探针，按注册顺序返回结果
- [ ] AC-A7: 单个探针抛异常时，`ProbeResult.error` 捕获异常字符串（`str(exc)`），`healthy=False`，其他探针继续执行
- [ ] AC-A8: `latency_ms` 基于 `time.perf_counter` 测量，精度到毫秒（`(end - start) * 1000.0`）
- [ ] AC-A9: `last_checked` 基于 `datetime.now(timezone.utc)`，带时区信息
- [ ] AC-A10: `get_spec` / `run_probe` 对未注册 `name` 抛 `ReliabilityError`
- [ ] AC-A11: 通过 `core/tracing.get_logger` 写结构化日志（`reliability: probe ...`），自动注入 `trace_id`

### Phase B（SLA + 只读约束 + E2E）

- [ ] AC-B1: 探针是只读模型——`run_probe` / `run_all` 不修改任何状态（无副作用，无 register / mark 调用）
- [ ] AC-B2: `sla_seconds` 作为探针超时阈值——`latency_ms > sla_seconds * 1000` 时调用方可识别为超时
- [ ] AC-B3: `required_for` 列表非空时，探针不健康 → 这些能力被标记退化（由调用方消费）
- [ ] AC-B4: `run_all` 在 <10 探针规模下端到端延迟 < 1s（串行执行）
- [ ] AC-B5: 与 F022 集成——探针不健康时由 `TierRecoveryService.handle_failure` 决策 FAILOVER / ESCALATE，探针本身不做恢复决策
- [ ] AC-B6: 与 F025 集成——探针结果驱动 `ProviderHost.mark_unhealthy` / `mark_healthy`
- [ ] AC-B7: 与 F024 集成——`requires_external_state=True` 的步骤同时注册探针，运行时退化触发 ESCALATE
- [ ] AC-B8: E2E 测试——真实 provider 健康检查（如 LLM API ping），探针结果与 provider 实际状态一致
- [ ] AC-B9: 遵守 T1-T8 测试铁律（真实 LLM 调用、真实场景数据、不跳过验证、不 Mock 工具、采集完整指标、LLM 生成内容经 LLM 审核、Web 功能操控浏览器验证 DOM）

## 4. 依赖

- **Evolved from**: 无
- **Blocked by**: 无
- **Related**: F021（探针不健康触发副作用回滚时由 WAL 记录）、F022（TierRecoveryService 消费探针结果决策恢复）、F024（`requires_external_state=True` 的步骤同时注册探针，运行时退化触发 ESCALATE）、F025（探针结果驱动 ProviderHost 健康标志）

## 5. 风险

| 风险 | 缓解 |
|------|------|
| `run_all` 串行执行，探针多时延迟累积 | 当前规模（<10 探针）下可接受；超规模时切 `asyncio.gather` 并发 |
| 探针本身有副作用（违反只读原则） | code review 强制检查 + 单元测试断言无状态变化 |
| `sla_seconds` 仅作记录不强制超时 | P2 阶段引入 `asyncio.wait_for` 强制超时，超时计入 `ProbeResult.error` |
| 探针 check 函数依赖外部服务，外部服务挂掉时探针全部不健康 | `required_for` 标记能力退化，由 TierRecoveryService 决策 FAILOVER 而非全部 ESCALATE |
| 探针结果不持久化，无历史趋势 | P5 阶段接入 Grafana 仪表盘，探针结果写入时序数据库 |

## 6. Open Questions

| # | 问题 | 状态 |
|---|------|------|
| OQ-1 | `run_all` 何时切换为并发执行？阈值是多少探针？ | ⬜ 未定 |
| OQ-2 | `sla_seconds` 是否需要强制超时（`asyncio.wait_for`）？ | ⬜ 未定 |
| OQ-3 | 探针结果是否需要持久化供历史趋势分析？ | ⬜ 未定 |
| OQ-4 | 探针是否需要主动心跳（后台定时执行），还是按需执行？ | ⬜ 未定 |

## 7. Key Decisions

| # | 决策 | 理由 | 日期 |
|---|------|------|------|
| KD-1 | 探针是只读模型，不修改状态 | `[doc:roleagent.md#第6章]` "给数据不给结论"原则 | 2026-07-21 |
| KD-2 | 恢复决策由 TierRecoveryService 做，探针不决策 | 探针只报告，决策集中在 Tier 服务，避免分散 | 2026-07-21 |
| KD-3 | 探针间隔离，一个抛异常不影响其他 | 防止单点故障传播 | 2026-07-21 |
| KD-4 | `required_for` 标记能力退化 | 探针不健康时调用方知道哪些能力不可用 | 2026-07-21 |
| KD-5 | 串行执行（注册顺序） | 当前规模可接受；保证结果顺序可预测 | 2026-07-21 |

## 8. Timeline

| 日期 | 事件 |
|------|------|
| 2026-07-21 | 立项，确立 Liveness 规范读 Feature 规格，术语对齐项目正式命名（Forgekin） |

## 9. Review Gate

- Phase A: 单元测试通过，`LivenessProbe` 注册与隔离执行由架构师Forgekin review
- Phase B: E2E 测试由跨厂商 reviewer Forgekin review，只读约束、SLA 检测、与 F022/F025 集成正确性达标

## 10. Links

| 类型 | 路径 | 说明 |
|------|------|------|
| **ADR** | `docs/decisions/010-distributed-reliability.md` | 分布式可靠性决策（5 原语之一） |
| **Feature** | `docs/features/F022-tier-recovery.md` | TierRecoveryService 消费探针结果 |
| **Feature** | `docs/features/F025-provider-host.md` | 探针驱动 ProviderHost 健康标志 |
| **代码** | `flowforge/core/reliability/liveness.py` | F023 实现 |
| **roleagent** | `docs/roleagent.md#第6章` | 分布式可靠性（liveness split-brain） |
| **VISION** | `docs/VISION.md#6` | operator 原则第 6 条（支持自己开发自己） |
