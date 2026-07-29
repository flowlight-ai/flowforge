---
feature_ids: [F019]
related_features: [F018, F020]
topics: [eval, signals, cross-verification, telemetry]
doc_kind: spec
created: 2026-07-21
---

# F019: 三方信号交叉验证

> **状态**: spec | **负责人**: 架构师Forgekin | **优先级**: P0
> **依赖 ADR**: [doc:decisions/009-eval-self-metabolism.md]
> **依据**: operator 7 条不可妥协原则 + roleagent.md 第 5 章 Eval 自代谢
> **关联 VISION**: [doc:VISION.md#5]（自代谢：能力画像随 eval 信号实时刷新）

## 1. 上下文

### 1.1 问题陈述

`[doc:roleagent.md#第5章]` 强调"只看 trace 也不够"——任何单源评估都有盲点。当前 FlowForge（flowlight-ai/flowforge 新仓库）的 eval 面临三个单源病灶：

- **自我报告（self_report）可信度低**：roleagent.md 第 4 章用具体证据驳斥"LLM-as-judge 全量自评"——模型的自评集中在 0.6-0.85 的成功区间，几乎没有负样本。根信号本身有毒，因为 RLHF 训练让模型产生"该收尾了"的乐观反射。
- **纯 trace 缺主观意图**：telemetry 只能看到"调用了什么工具、耗时多少"，看不到 agent 当时的意图与上下文判断。
- **跨 agent review 缺客观锚点**：observer 信号（人类 reviewer / 跨厂商Forgekin）虽可信，但样本稀疏、采样慢，单独使用会让 eval 退化为人审工单。

需要 **三方信号交叉验证**——自我报告 / observer / telemetry 三源加权聚合，让单源偏差被另两源稀释。这是 operator 原则第 6 条（支持自己开发自己）的可靠性底座——FlowForge 用 FlowForge 自身能力开发 FlowForge 时，必须有多源交叉才能避免自我欺骗。

### 1.2 当前痛点

- 信号采集器各自为政，F192 / F200 等 harness 子系统自建 eval 竖井（roleagent.md 称之为"启动期合理形态但非终态"）
- 信号权重拍脑袋，缺乏基于偏差来源的理论依据
- 信号间分歧无量化指标，"observer 说好但 telemetry 慢"无法自动触发"reconcile"
- 信号回流能力画像盲点层缺乏 agreement / disagreement 量化

### 1.3 不做的影响

- 无法实现 `[doc:roleagent.md#第5章]` "三类信号交叉" 设计选择
- 自评乐观偏差污染能力画像（CapabilityProfile）的 `historical_performance`
- F018 契约裁决缺证据源补充，单源决断易误判
- F020 归因矩阵无法基于多源信号定位根因层
- 违反编程红线第 15 条"发现未实现即 Bug"

## 2. 决策

### 2.1 核心设计

采用 **三类信号源 + 加权聚合 + 一致性度量** 的设计，代码实现见 `flowforge/core/eval/three_signals.py`：

| 信号源 | 枚举值 | 默认权重 | 含义 |
|--------|--------|---------|------|
| SELF_REPORT | `self_report` | **0.2** | Forgekin自评（最低权重，最易乐观偏差） |
| OBSERVER | `observer` | **0.4** | 跨 agent / 人类 reviewer |
| TELEMETRY | `telemetry` | **0.4** | 客观遥测（与 observer 同列最高权重） |

**权重设计原理**：

- **SELF_REPORT = 0.2（最低）**：roleagent.md 第 4 章证据表明自评集中在 0.6-0.85 成功区间几乎无负样本，根信号本身有毒。0.2 权重让其能贡献但不主导。
- **OBSERVER = 0.4（最高之一）**：跨厂商 reviewer 能识别同厂商盲点（ADR-004 §2.5），但样本稀疏采样慢，不能独占。
- **TELEMETRY = 0.4（最高之一）**：客观遥测（耗时 / 调用次数 / 错误率）不受 RLHF 偏差污染，是 roleagent.md"用行为信号而非自评"的核心载体。

**FULL_EVIDENCE_SOURCES = 2 原则**：与 F018 契约层一致，至少 2 个独立信号源才算完整证据（`engine.py` 已有硬护栏）。单源信号（即使权重最高）也应触发"采集更多证据"建议。

**聚合公式**：

```
final_score        = Σ(value * weight) / Σ(weight)
agreement_score    = clamp(1.0 - pstdev(values), 0, 1)
disagreement_score = 1.0 - agreement_score
```

`disagreement_score > 0.3` 时自动触发"reconcile observer vs telemetry"建议——这是单源偏差被另两源稀释的工程化体现。

**权重全零兜底**：若所有信号 weight 显式为 0，aggregator 退化为等权平均（n 个信号值均值），保证聚合始终产出有意义的数字而非 0。

### 2.2 关键接口

```python
# flowforge/core/eval/three_signals.py
from __future__ import annotations

import statistics
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from enum import Enum

from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.eval.three_signals")

DEFAULT_SIGNAL_WEIGHTS: dict[SignalSource, float] = {
    # populated below after SignalSource is defined
}


class SignalSource(Enum):
    """Three independent signal sources for cross-validation."""

    SELF_REPORT = "self_report"
    OBSERVER = "observer"
    TELEMETRY = "telemetry"


# Default per-source weights — self-report is discounted.
DEFAULT_SIGNAL_WEIGHTS.update(
    {
        SignalSource.SELF_REPORT: 0.2,
        SignalSource.OBSERVER: 0.4,
        SignalSource.TELEMETRY: 0.4,
    }
)


@dataclass(frozen=True)
class EvalSignal:
    """A single observation from one of the three signal sources."""

    source: SignalSource
    value: float
    # None => resolve to the aggregator's default weight for this source.
    weight: float | None = None
    collected_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    notes: str = ""

    def __post_init__(self) -> None:
        if self.value < 0.0 or self.value > 1.0:
            raise ValueError(
                f"EvalSignal.value must be within [0.0, 1.0], got {self.value}"
            )


@dataclass(frozen=True)
class AggregatedScore:
    """Output of ThreeSignalAggregator.aggregate()."""

    final_score: float
    signal_count: int
    agreement_score: float
    disagreement_score: float


class ThreeSignalAggregator:
    """Collects signals from the three sources and cross-validates them.

    Usage:
        agg = ThreeSignalAggregator()
        agg.add_signal(EvalSignal(source=SignalSource.TELEMETRY, value=0.9))
        result = agg.aggregate()

    Aggregation:
      final_score       = Σ(value * weight) / Σ(weight)
      agreement_score   = 1.0 - population_std(values)   (clamped to [0, 1])
      disagreement_score = 1.0 - agreement_score
    """

    def __init__(
        self, signal_weights: dict[SignalSource, float] | None = None
    ) -> None:
        self._weights: dict[SignalSource, float] = (
            dict(signal_weights) if signal_weights else dict(DEFAULT_SIGNAL_WEIGHTS)
        )
        self._signals: list[EvalSignal] = []

    def add_signal(self, signal: EvalSignal) -> None:
        """Append a signal, resolving a None weight to the source default."""
        weight = signal.weight
        if weight is None:
            weight = self._weights.get(signal.source, 0.0)
        resolved = replace(signal, weight=weight)
        self._signals.append(resolved)
        logger.debug(
            f"signal added: source={signal.source.value} "
            f"value={signal.value:.2f} weight={weight:.2f}"
        )

    def aggregate(self) -> AggregatedScore:
        """Compute the weighted final score plus agreement / disagreement."""
        if not self._signals:
            return AggregatedScore(
                final_score=0.0,
                signal_count=0,
                agreement_score=0.0,
                disagreement_score=1.0,
            )

        total_weight = sum(s.weight or 0.0 for s in self._signals)
        if total_weight <= 0:
            # All-zero weights fallback to equal weighting so aggregation still
            # produces a meaningful number.
            n = len(self._signals)
            final = sum(s.value for s in self._signals) / n
        else:
            final = sum(s.value * (s.weight or 0.0) for s in self._signals) / total_weight
        final = round(final, 4)

        values = [s.value for s in self._signals]
        std = statistics.pstdev(values)
        agreement = max(0.0, min(1.0, 1.0 - std))
        agreement = round(agreement, 4)
        disagreement = round(1.0 - agreement, 4)

        logger.info(
            f"signals aggregate: count={len(self._signals)} "
            f"final={final:.2f} agreement={agreement:.2f}"
        )
        return AggregatedScore(
            final_score=final,
            signal_count=len(self._signals),
            agreement_score=agreement,
            disagreement_score=disagreement,
        )
```

## 3. 验收标准

### Phase A（信号模型 + 聚合器）

- [ ] AC-A1: `SignalSource` 枚举必须包含 3 值（SELF_REPORT / OBSERVER / TELEMETRY）
- [ ] AC-A2: `DEFAULT_SIGNAL_WEIGHTS` 权重为 `{SELF_REPORT: 0.2, OBSERVER: 0.4, TELEMETRY: 0.4}`，不可硬编码覆盖（须通过 EvalConfig YAML，铁律 11）
- [ ] AC-A3: `EvalSignal.value` 超出 `[0.0, 1.0]` 必须抛 `ValueError`（与 F018 quality_bar 边界一致）
- [ ] AC-A4: `EvalSignal.weight=None` 时由 `add_signal()` 解析为 source 默认权重
- [ ] AC-A5: `ThreeSignalAggregator.aggregate()` 空信号集返回 `final_score=0.0 / disagreement_score=1.0`（不可抛异常）
- [ ] AC-A6: `final_score = Σ(value * weight) / Σ(weight)`，四舍五入到 4 位小数
- [ ] AC-A7: `agreement_score = clamp(1.0 - pstdev(values), 0, 1)`，使用 `statistics.pstdev`（总体标准差）
- [ ] AC-A8: 所有权重为 0 时退化为等权平均（n 个信号值均值），不可返回 0
- [ ] AC-A9: 日志通过 `core/tracing.py` 的 `get_logger` 自动注入 `trace_id`，禁 print

### Phase B（多源采集 + 分歧触发 + 信号回流）

- [ ] AC-B1: 控制面（F040）通过 `register_evaluator(name, evaluator)` 注入信号采集器，支持 sync / async（`inspect.iscoroutine` 自动识别）
- [ ] AC-B2: 单个 evaluator 抛异常时被 `_collect_signals` 异常隔离，不阻断其他 evaluator，warning 日志可追溯
- [ ] AC-B3: `disagreement_score > 0.3` 时自动追加 recommendation "signal disagreement high; reconcile observer vs telemetry"
- [ ] AC-B4: 信号 `final_score` 与 F018 契约 `verdict.score` 按 `CONTRACT_WEIGHT=0.5 / SIGNAL_WEIGHT=0.5` 加权得 `overall_score`（无信号时退化为 `verdict.score`）
- [ ] AC-B5: 信号聚合结果回流到能力画像（CapabilityProfile）的 `historical_performance`，`disagreement_score` 累积到盲点画像层
- [ ] AC-B6: 至少 2 个独立信号源（对齐 F018 `FULL_EVIDENCE_SOURCES = 2`）才算完整证据，单源触发"collect additional evidence"建议
- [ ] AC-B7: E2E 测试 — 构造 SELF_REPORT=0.9 / OBSERVER=0.4 / TELEMETRY=0.5 三源信号，聚合 `final_score ≈ 0.54`，`disagreement_score > 0.3` 触发 reconcile 建议
- [ ] AC-B8: 遵守 T1-T8 测试铁律：真实 LLM 调用（observer 信号若由跨厂商Forgekin产生，必须真实调 LLM）/ 真实场景数据 / 不跳过验证 / 不 Mock 工具（telemetry 采集必须真实埋点，禁 mock）/ 采集 MetricsCollector 完整指标 / LLM 生成内容必须经 LLM 审核（T7：observer 评语必须再调 LLM 审核语义自洽性）/ Web 功能操控浏览器验证 DOM

## 4. 依赖

- **Evolved from**: 无
- **Blocked by**: 无（信号层为评估底座，与 F018 平级）
- **Related**: F018（契约裁决的 `what_evidence_exists` 可由三方信号填充）、F020（归因矩阵消费信号分歧定位根因层）、F040（EvalControlPlane 编排信号采集与聚合）

## 5. 风险

| 风险 | 缓解 |
|------|------|
| self_report 权重 0.2 仍可能主导（当 observer/telemetry 都缺失时） | 至少 2 源原则（AC-B6）；单源触发"collect additional evidence"；权重 YAML 可调整 |
| 早期信号样本薄，`pstdev` 在小样本下波动大 | `agreement_score` / `disagreement_score` 暴露样本质量，低样本时触发 reconcile 建议而非直接判定 |
| observer 信号采样慢导致 eval 延迟 | 控制面（F040）异步采集 + 超时降级；observer 缺失时退化为 self_report + telemetry 双源 |
| telemetry 埋点遗漏导致信号源单一 | 采集器注册时校验 source 覆盖度；缺失源在 `recommendations` 中显式提示 |
| 权重 0.5/0.5（CONTRACT/SIGNAL）不适配所有场景 | `CONTRACT_WEIGHT` / `SIGNAL_WEIGHT` 为模块常量，可在 YAML 配置层覆盖 |
| pstdev 在两值相同（如 0.5/0.5）时返回 0 → agreement=1.0 误判完全一致 | `agreement_score` 仅度量值离散度，结合 `signal_count` 共同解读；单值不可作为强证据 |

## 6. Open Questions

| # | 问题 | 状态 |
|---|------|------|
| OQ-1 | self_report 信号是否需要附加"信心度"字段，让模型自报信心折扣权重？ | ⬜ 未定 |
| OQ-2 | observer 信号由跨厂商 reviewer Forgekin产生时，是否需要 MindCouncil 复议？ | ⬜ 未定 |
| OQ-3 | telemetry 信号的埋点协议是否由 F040 控制面统一注入，还是各 harness 自管？ | ⬜ 未定 |

## 7. Key Decisions

| # | 决策 | 理由 | 日期 |
|---|------|------|------|
| KD-1 | 三源加权（0.2/0.4/0.4） | `[doc:roleagent.md#第5章]` "用行为信号而非自评"——self_report 被 RLHF 乐观偏差污染需折扣 | 2026-07-21 |
| KD-2 | agreement_score 用 pstdev | 度量三源值离散度，单源偏差会被另两源拉低 | 2026-07-21 |
| KD-3 | disagreement > 0.3 触发 reconcile | 量化分歧阈值，避免人审工单化 | 2026-07-21 |
| KD-4 | 权重全零退化为等权 | 保证聚合始终产出有意义数字，不返回 0 | 2026-07-21 |
| KD-5 | 至少 2 源才算完整证据 | 对齐 F018 `FULL_EVIDENCE_SOURCES = 2` 与 `engine.py` 硬护栏 | 2026-07-21 |
| KD-6 | 信号回流能力画像盲点层 | 让归因分布从印象更新为证据（ADR-004 §2.5 跨厂商 reviewer 选择依据） | 2026-07-21 |

## 8. Timeline

| 日期 | 事件 |
|------|------|
| 2026-07-21 | 立项，确立三方信号交叉验证 Feature 规格，权重 0.2/0.4/0.4 落地 roleagent.md"用行为信号而非自评" |

## 9. Review Gate

- Phase A: 单元测试通过，`SignalSource` / `EvalSignal` / `ThreeSignalAggregator` 由架构师Forgekin review，权重设计由MindCouncil 跨厂商审查（防止单厂商盲点）
- Phase B: E2E 测试由跨厂商 reviewer Forgekin review，分歧触发与信号回流能力画像达标，T7 LLM 审核通过

## 10. Links

| 类型 | 路径 | 说明 |
|------|------|------|
| **ADR** | `docs/decisions/009-eval-self-metabolism.md` | Eval 自代谢决策（§2.2 三方信号） |
| **roleagent** | `docs/roleagent.md#第5章` | Eval：Harness 的自我代谢系统 |
| **roleagent** | `docs/roleagent.md#第4章` | LLM 自评集中在 0.6-0.85 成功区间证据 |
| **Feature** | `docs/features/F018-eval-contract.md` | Eval Contract 五问（`what_evidence_exists` 由三方信号填充） |
| **Feature** | `docs/features/F020-attribution-matrix.md` | 七类归因矩阵（消费信号分歧定位根因层） |
| **决策** | `docs/decisions/004-capability-profile-routing.md` | 能力画像路由（信号回流消费方，§2.5 跨厂商 reviewer 选择） |
| **决策** | `docs/decisions/008-multi-domain-memory-federation.md` | EchoStore（信号记录持久化层） |
| **VISION** | `docs/VISION.md#5` | 自代谢：能力画像随 eval 信号实时刷新 |
| **规则** | `docs/project_rules.md#红线3` | 禁止使用 Mock LLM（observer 信号必须真实调 LLM） |
| **代码** | `flowforge/core/eval/three_signals.py` | SignalSource + ThreeSignalAggregator 实现 |
