---
feature_ids: [F018]
related_features: [F019, F020]
topics: [eval, contract, self-metabolism, deterministic]
doc_kind: spec
created: 2026-07-21
---

# F018: Eval Contract 五问

> **状态**: spec | **负责人**: 架构师灵智体 | **优先级**: P0
> **依赖 ADR**: [doc:decisions/009-eval-self-metabolism.md]
> **依据**: operator 7 条不可妥协原则 + roleagent.md 第 5 章 Eval 自代谢
> **关联 VISION**: [doc:VISION.md#5]（自代谢：能力画像随 eval 信号实时刷新）

## 1. 上下文

### 1.1 问题陈述

`[doc:roleagent.md#第5章]` 开篇立论："有 harness，就必须有 eval。否则 harness 只会增生，不会代谢。" 当前 FlowForge（flowlight-ai/flowforge 新仓库）每新增一块 harness（F002 TeamAct / F040 EvalControlPlane 等），都缺一份"预期声明"——开发者无法回答"这块 harness 承诺做什么、实际交付了什么、有什么证据、过什么门槛、失败归到哪层"。这导致：

- harness 增生无边界，没有判别器告诉你"该退役了"
- 评估时缺证据锚点，单灵智体（Forgekin）自评"做完了"经常是 RLHF 收尾惯性幻觉
- 失败归因扁平化，行业路径"换 prompt / 换模型"把多层系统压成一维答案

需要为每块 harness 强制建立 **Eval Contract 五问**，作为该机制的预期声明与裁决依据。这是 operator 原则第 6 条（支持自己开发自己）的评估底座。

### 1.2 当前痛点

- harness 创建时不附带契约，事后补报告 → 无法横向比较"哪块该退役"
- 评估证据不足时仍判定通过 → 违反 `[doc:project_rules.md#红线2]` 质量门槛 0.85
- 评估调用 LLM-as-judge → 成本高、自评集中在 0.6-0.85 成功区间几乎无负样本（roleagent.md 第 4 章已驳斥）
- EvalLedger 缺失 → 归因信号无法回流能力画像（CapabilityProfile）盲点层

### 1.3 不做的影响

- 无法实现 `[doc:roleagent.md#第5章]` 的"判别器只告诉团队该分哪类"机制
- 能力画像（CapabilityProfile）的 `historical_performance` 缺乏证据积累层
- 七类归因矩阵（F020）无法定位根因层
- 退役信号缺失 → 技术债永生（死代码占用 agent 注意力预算）
- 违反编程红线第 15 条"发现未实现即 Bug"

## 2. 决策

### 2.1 核心设计

每新增一块 harness，必须同时回答 **Eval Contract 五问**，作为该机制的"预期声明"。契约通过 `EvalContractRunner.evaluate()` 进行**确定性裁决，不调用 LLM**：

- **What** — `what_was_promised`：承诺了什么
- **How** — `what_was_delivered`：实际交付了什么
- **Why** — `what_evidence_exists`：有什么证据（≥2 源得满分）
- **When** — `what_quality_bar`：质量门槛（默认 0.85）
- **Who/归因层** — `what_attribution`：失败归到哪一层（七类归因之一）

裁决公式与 `loop/verifier.py` 聚合形态一致：

```
delivery_score  = Jaccard(promised_tokens, delivered_tokens)
evidence_score  = min(1.0, len(evidence) / FULL_EVIDENCE_SOURCES)
score           = (delivery_score * evidence_score) ** 0.5   # 几何平均
passed          = (score >= quality_bar) AND (evidence_count > 0)
```

证据缺失即一票否决，与 `engine.py` 的"evidence ≥2 sources"硬护栏对齐。

**EvalLedger 不可删除（append-only）铁律**：所有 `EvalVerdict` 记录必须按 append-only 模式持久化到灵忆 EchoStore（`[doc:decisions/008-multi-domain-memory-federation.md]`），禁止覆盖与删除。归因记录单调积累，是能力画像盲点回流的证据源——这是"自代谢"机制不退化为"自篡改"的硬护栏。

**任何 harness 组件都必须实现 EvalContract**：F002 TeamAct / F040 EvalControlPlane / F019 三方信号采集器等均需在创建时声明契约，由控制面统一裁决。这是 roleagent.md "F192/F200 不该永远各自维护一套定时后台任务，终态是统一 Eval Hub" 的工程化前提。

### 2.2 关键接口

```python
# flowforge/core/eval/contract.py
from __future__ import annotations
from dataclasses import dataclass
from flowforge.core.errors import EvalError
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.eval.contract")

DEFAULT_QUALITY_BAR = 0.85
# Two independent evidence sources required for full credit, mirroring the
# engine.py "evidence >= 2 sources" hard guardrail.
FULL_EVIDENCE_SOURCES = 2


@dataclass(frozen=True)
class EvalContract:
    """The five questions a harness component answers for self-evaluation."""

    what_was_promised: str
    what_was_delivered: str
    what_evidence_exists: list[str]
    what_quality_bar: float = DEFAULT_QUALITY_BAR
    what_attribution: str = ""


@dataclass(frozen=True)
class EvalVerdict:
    """Result of running an EvalContract through EvalContractRunner."""

    passed: bool
    score: float
    missing_evidence: list[str]
    attribution: str = ""
    notes: str = ""


def _tokenize(text: str) -> set[str]:
    """Split into lowercase word tokens, stripping surrounding punctuation."""
    return {
        tok.strip(".,;:!?\"'()[]{}").lower()
        for tok in text.split()
        if tok.strip()
    }


def _jaccard(a: set[str], b: set[str]) -> float:
    """Jaccard overlap of two token sets. Empty promised set => 0.0."""
    if not a or not b:
        return 0.0
    union = a | b
    if not union:
        return 0.0
    return len(a & b) / len(union)


class EvalContractRunner:
    """Evaluates an EvalContract deterministically (no LLM).

    Scoring:
      delivery_score  = Jaccard(promised_tokens, delivered_tokens)
      evidence_score  = min(1.0, len(evidence) / FULL_EVIDENCE_SOURCES)
      score           = geometric_mean(delivery_score, evidence_score)
                        (matches the verifier.py aggregation pattern)

    A contract passes only when score >= quality_bar AND at least one evidence
    source is present (missing evidence => automatic fail).
    """

    def __init__(self, full_evidence_sources: int = FULL_EVIDENCE_SOURCES) -> None:
        self.full_evidence_sources = max(1, full_evidence_sources)

    def evaluate(self, contract: EvalContract) -> EvalVerdict:
        if contract.what_quality_bar < 0.0 or contract.what_quality_bar > 1.0:
            raise EvalError(
                f"quality_bar must be within [0.0, 1.0], got {contract.what_quality_bar}"
            )

        promised_tokens = _tokenize(contract.what_was_promised)
        delivered_tokens = _tokenize(contract.what_was_delivered)
        delivery_score = _jaccard(promised_tokens, delivered_tokens)

        evidence_count = len(contract.what_evidence_exists)
        evidence_score = min(1.0, evidence_count / self.full_evidence_sources)

        # Geometric mean — same shape as loop/verifier.py quality scoring.
        score = (delivery_score * evidence_score) ** 0.5
        score = round(score, 4)

        missing: list[str] = []
        if evidence_count == 0:
            missing.append("at least one evidence source required")

        attribution = contract.what_attribution or "unclassified"
        passed = score >= contract.what_quality_bar and not missing

        notes = (
            f"delivery_score={delivery_score:.2f} "
            f"evidence_score={evidence_score:.2f} "
            f"evidence_count={evidence_count}"
        )

        logger.info(f"eval: contract verdict passed={passed} score={score:.2f}")

        return EvalVerdict(
            passed=passed,
            score=score,
            missing_evidence=missing,
            attribution=attribution,
            notes=notes,
        )
```

## 3. 验收标准

### Phase A（契约 + 裁决器 + Ledger）

- [ ] AC-A1: `EvalContract` 必须包含 5 字段（what_was_promised / what_was_delivered / what_evidence_exists / what_quality_bar / what_attribution），缺一即 `EvalError`
- [ ] AC-A2: `DEFAULT_QUALITY_BAR = 0.85`，对齐 `[doc:project_rules.md#红线2]`（不可硬编码覆盖，须通过 Loop 配置）
- [ ] AC-A3: `FULL_EVIDENCE_SOURCES = 2`，证据缺失即一票否决（`passed=False`）
- [ ] AC-A4: `EvalContractRunner.evaluate()` 不调用 LLM（确定性裁决：Jaccard + 几何平均）
- [ ] AC-A5: `EvalVerdict.score` 四舍五入到 4 位小数，与 `loop/verifier.py` 聚合形态一致
- [ ] AC-A6: `quality_bar` 超出 `[0.0, 1.0]` 范围必须抛 `EvalError`
- [ ] AC-A7: EvalLedger 通过 Repository 层 append-only 持久化到灵忆 EchoStore，禁直接操作数据库（铁律 4），禁覆盖删除
- [ ] AC-A8: 日志通过 `core/tracing.py` 的 `get_logger` 自动注入 `trace_id`，禁 print
- [ ] AC-A9: 所有 harness 组件（F002 TeamAct / F040 EvalControlPlane / F019 三方信号采集器等）注册时必须声明 `EvalContract`

### Phase B（E2E + 信号回流）

- [ ] AC-B1: EvalLedger 记录可通过 Repository 层查询历史，按 `target_id` / `attribution` 过滤
- [ ] AC-B2: 归因记录回流到能力画像（CapabilityProfile）的 `historical_performance` 积累层
- [ ] AC-B3: 契约裁决延迟 < 5ms（确定性裁决，无 LLM 调用）
- [ ] AC-B4: EvalConfigLoader 加载 YAML 配置（F020），`default_quality_bar` / `signal_weights` / `attribution_rules` 全部 YAML 驱动（铁律 5 + P16）
- [ ] AC-B5: E2E 测试 — 为 F002 TeamAct 创建 EvalContract，5 字段完整、证据 2 源、质量分 0.85，裁决 `passed=True`；故意移除证据源 → `passed=False` 且 `missing_evidence` 显式列出缺失项
- [ ] AC-B6: 遵守 T1-T8 测试铁律：真实 LLM 调用 / 真实场景数据 / 不跳过验证 / 不 Mock 工具 / 采集 MetricsCollector 完整指标 / LLM 生成内容必须经 LLM 审核（T7：契约生成若由 LLM 辅助，必须再调 LLM 审核契约字段语义自洽性）/ Web 功能操控浏览器验证 DOM

## 4. 依赖

- **Evolved from**: 无
- **Blocked by**: 无（契约层为评估底座，无上游依赖）
- **Related**: F019（三方信号为契约裁决补充证据源）、F020（七类归因消费契约 `what_attribution` 字段）、F040（EvalControlPlane 编排契约裁决）

## 5. 风险

| 风险 | 缓解 |
|------|------|
| Jaccard 词重叠可能误判语义等价但用词不同的交付 | 与三方信号（F019）交叉验证，单源不决断；几何平均放大证据缺失 |
| EvalLedger 被误删导致归因信号丢失 | append-only 铁律 + Repository 层封装 + 审计日志（与 ADR-008 灵忆 EchoStore 集成） |
| 早期证据源不足导致契约频繁误杀 | `FULL_EVIDENCE_SOURCES` 可在 YAML 配置层调整；`missing_evidence` 显式列出缺失项供 reviewer 判断 |
| `what_attribution` 字段被滥用为自由文本 | 字段值必须对齐 F020 `AttributionType` 枚举（intention/plan/tool/knowledge/execution/context/luck），由 `AttributionMatrix.classify()` 校验 |
| 质量门槛 0.85 被硬编码覆盖 | `DEFAULT_QUALITY_BAR` 为模块常量，仅可通过 `EvalConfig.default_quality_bar` YAML 覆盖（铁律 11） |

## 6. Open Questions

| # | 问题 | 状态 |
|---|------|------|
| OQ-1 | EvalLedger 是否需要支持按时间窗口（如近 7 天）聚合归因分布？ | ⬜ 未定 |
| OQ-2 | 契约的 `what_was_promised` 由 harness 创建者手写还是从 spec 自动生成？ | ⬜ 未定 |
| OQ-3 | append-only Ledger 的存储后端是 SQLite 还是直接落到灵忆 EchoStore？ | ⬜ 未定 |

## 7. Key Decisions

| # | 决策 | 理由 | 日期 |
|---|------|------|------|
| KD-1 | EvalContract 五问强制声明 | `[doc:roleagent.md#第5章]` 主张"harness 必须有 eval" | 2026-07-21 |
| KD-2 | 裁决器不调 LLM（确定性） | 复用 `loop/verifier.py` 判别式；成本可接受；避免 LLM 自评集中在成功区间 | 2026-07-21 |
| KD-3 | 几何平均聚合（delivery × evidence） | 与 `loop/verifier.py` / `engine.py` 已有护栏形态一致 | 2026-07-21 |
| KD-4 | EvalLedger append-only | 防止"自代谢"退化为"自篡改"；归因记录单调积累是盲点回流证据源 | 2026-07-21 |
| KD-5 | 默认质量门槛 0.85 | 对齐 `[doc:project_rules.md#红线2]` 与编程红线第 2 条 | 2026-07-21 |

## 8. Timeline

| 日期 | 事件 |
|------|------|
| 2026-07-21 | 立项，确立 Eval Contract 五问 Feature 规格，术语对齐项目正式命名（灵忆 EchoStore / 能力画像 CapabilityProfile / 灵智体 Forgekin） |

## 9. Review Gate

- Phase A: 单元测试通过，`EvalContract` / `EvalContractRunner` / `EvalLedger` 由架构师灵智体 review，append-only 铁律由灵议 MindCouncil 跨厂商审查
- Phase B: E2E 测试由跨厂商 reviewer 灵智体 review，契约裁决延迟与信号回流能力画像达标，T7 LLM 审核通过

## 10. Links

| 类型 | 路径 | 说明 |
|------|------|------|
| **ADR** | `docs/decisions/009-eval-self-metabolism.md` | Eval 自代谢决策（§2.1 Eval Contract 五问） |
| **roleagent** | `docs/roleagent.md#第5章` | Eval：Harness 的自我代谢系统 |
| **Feature** | `docs/features/F019-three-signals.md` | 三方信号交叉验证（契约证据源补充） |
| **Feature** | `docs/features/F020-attribution-matrix.md` | 七类归因矩阵（消费 `what_attribution`） |
| **决策** | `docs/decisions/008-multi-domain-memory-federation.md` | 灵忆 EchoStore（Ledger 持久化层） |
| **决策** | `docs/decisions/004-capability-profile-routing.md` | 能力画像路由（归因回流消费方） |
| **VISION** | `docs/VISION.md#5` | 自代谢：能力画像随 eval 信号实时刷新 |
| **规则** | `docs/project_rules.md#红线2` | 质量分阈值默认 0.85 |
| **代码** | `flowforge/core/eval/contract.py` | EvalContract + EvalContractRunner 实现 |
