---
feature_ids: [F020]
related_features: [F018, F019]
topics: [eval, attribution, control-plane, config-loader]
doc_kind: spec
created: 2026-07-21
---

# F020: 七类归因矩阵

> **状态**: spec | **负责人**: 架构师Forgekin | **优先级**: P0
> **依赖 ADR**: [doc:decisions/009-eval-self-metabolism.md]
> **依据**: operator 7 条不可妥协原则 + roleagent.md 第 5 章 Eval 自代谢
> **关联 VISION**: [doc:VISION.md#5]（自代谢：能力画像随 eval 信号实时刷新）

## 1. 上下文

### 1.1 问题陈述

`[doc:roleagent.md#第5章]` 给出 7 类归因矩阵，把"agent 没做好"这个拍扁的多层答案重新展开。回到核心公式 `效能 = 能力 × Harness 契合度`，问题可能出在愿景、翻译、工具、执行、环境、品味任一层。当前 FlowForge（flowlight-ai/flowforge 新仓库）面临三个归因病灶：

- **归因扁平化**：行业常见路径"agent 做得不好 → 优化 prompt → 换模型"，把多层系统压扁成一维答案，丢失根因定位。
- **归因到 agent 而非归因到层**：传统做法归咎"某Forgekin不行"，触发换模型/换 prompt，但真正根因可能在工具描述含糊（TOOL 层）或上下文缺失（CONTEXT 层）。
- **缺退役信号**：一块机制从来不触发，比"指标下降"更危险——它可能是死代码。归因分布长期可统计才能识别"该退役"。

需要 **七类归因矩阵 + EvalControlPlane 控制面 + EvalLoader 配置加载** 三件套，让失败有明确的层归属、修复路径、历史数据支撑。这是 roleagent.md"F192/F200 不该永远各自维护一套定时后台任务，终态是统一 Eval Hub"的工程化骨架。

### 1.2 当前痛点

- 失败时只看到"passed=False"，不知道根因在意愿层还是工具层
- 归因规则硬编码在代码里，无法按场景 YAML 覆盖
- 没有统一控制面，各 harness 子系统自建 eval 竖井（F192/F200 各维护定时任务）
- 历史归因记录无法回灌控制面，新评估与历史脱节
- 归因结果不回流能力画像（CapabilityProfile）盲点层，跨厂商 reviewer 选择缺证据

### 1.3 不做的影响

- 无法实现 `[doc:roleagent.md#第5章]` 7 类归因矩阵
- 修复路径盲目（不知道改 prompt 还是换工具还是补上下文）
- 能力画像盲点画像缺归因分布证据，跨厂商 reviewer 选择退化为印象
- 退役信号缺失 → 死代码占用 agent 注意力预算（技术债永生）
- 违反编程红线第 15 条"发现未实现即 Bug"

## 2. 决策

### 2.1 核心设计

**AttributionType 七类归因**（代码实现见 `flowforge/core/eval/attribution.py`）：

| 归因层 | 枚举值 | 含义 | 修复路径 |
|--------|--------|------|---------|
| 意图层 | `INTENTION` | 目标设定错误（对应"愿景缺口"） | 重新对齐愿景（operator 介入） |
| 计划层 | `PLAN` | 规划错误（对应"翻译偏差"） | 重新规划 / 修订需求文档 |
| 工具层 | `TOOL` | 工具调用错误（对应"harness 错位"） | 换工具 / 重新定位工具描述 |
| 知识层 | `KNOWLEDGE` | 事实性错误（对应"工具缺口"的事实面） | 补盲点 / 修订技能文档 / 调整搜索策略 |
| 执行层 | `EXECUTION` | 操作错误如 timeout（对应"执行缺口"） | 重试 / 调整工具与环境约束 |
| 上下文层 | `CONTEXT` | 信息缺失（对应"环境漂移"） | 补充上下文 / 修订 connector 注入 |
| 运气层 | `LUCK` | 不可控因素（fallback） | 记录但不修复（审美标准 / CVO 反馈） |

**分类器确定性原则**：`AttributionMatrix.classify()` 是关键词驱动的确定性分类器，按 `DEFAULT_ATTRIBUTION_RULES` 顺序匹配，首条命中即返回，无匹配 fallback 到 `LUCK`。EXECUTION（timeout/deadline）优先检查，因为 timeout 常与其他症状共现但通常是根因。

**EvalControlPlane 五步流程**（代码实现见 `flowforge/core/eval/control_plane.py`）：

```
1. _build_contract(target)              → EvalContract
2. _contract_runner.evaluate(contract)  → EvalVerdict        # 契约裁决
3. _collect_signals(target)             → list[EvalSignal]   # 三方信号采集
4. ThreeSignalAggregator.aggregate()     → AggregatedScore    # 信号聚合
5. _classify_failure(contract, verdict) → AttributionType | None  # 失败归因（仅失败时）
   _compute_overall(verdict, aggregated) → overall_score       # 综合分
   _build_recommendations(...)          → list[str]          # 行动队列
```

**综合分公式**：

```
overall = CONTRACT_WEIGHT * verdict.score + SIGNAL_WEIGHT * aggregated.final_score
# CONTRACT_WEIGHT = 0.5, SIGNAL_WEIGHT = 0.5（无信号时退化为 verdict.score）
```

**控制面确定性原则**：`EvalControlPlane` 本身**不调用 LLM**，是确定性编排器。evaluator 通过 `register_evaluator(name, evaluator)` 注入，支持 sync/async（`inspect.iscoroutine` 自动识别）。

**EvalLoader 加载历史 Eval 数据**：`EvalConfigLoader.load_from_yaml()` 异步加载（`asyncio.to_thread`），`EvalConfig` 持有 `default_quality_bar` / `signal_weights` / `attribution_rules`，全部 YAML 驱动，禁止硬编码（铁律 5 + P16）。

**行动队列而非展示指标**：`_build_recommendations()` 输出可执行的行动队列：

- `missing_evidence` → "collect additional evidence: ..."
- `disagreement_score > 0.3` → "signal disagreement high; reconcile observer vs telemetry"
- `attribution != LUCK` → "address {layer}-layer root cause"
- `passed and agreement_score >= 0.8` → "no action needed; contract met and signals aligned"

### 2.2 关键接口

```python
# flowforge/core/eval/attribution.py
from dataclasses import dataclass
from enum import Enum
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.eval.attribution")


class AttributionType(Enum):
    """The seven failure-attribution layers."""

    INTENTION = "intention"
    PLAN = "plan"
    TOOL = "tool"
    KNOWLEDGE = "knowledge"
    EXECUTION = "execution"
    CONTEXT = "context"
    LUCK = "luck"


@dataclass(frozen=True)
class FailureDescription:
    """Structured description of a failure to be classified."""

    what_failed: str
    expected: str
    actual: str
    context: str
    error_trace: str = ""


@dataclass(frozen=True)
class AttributionRule:
    """A keyword-to-type mapping used by AttributionMatrix.classify()."""

    keywords: list[str]
    type: AttributionType


# Ordered default rules — earlier rules take priority on overlap.
# EXECUTION (timeout/deadline) is checked first because a timeout often
# co-occurs with other symptoms but is usually the root cause.
DEFAULT_ATTRIBUTION_RULES: list[AttributionRule] = [
    AttributionRule(keywords=["timeout","timed out","deadline","expired","latency"],
                    type=AttributionType.EXECUTION),
    AttributionRule(keywords=["wrong fact","wrong","incorrect","hallucination",
                              "hallucinate","false fact","inaccurate"],
                    type=AttributionType.KNOWLEDGE),
    AttributionRule(keywords=["missing input","missing context","no context",
                              "missing data","not provided","absent input"],
                    type=AttributionType.CONTEXT),
    AttributionRule(keywords=["tool","api","function call","tool call",
                              "instrument","sdk"],
                    type=AttributionType.TOOL),
    AttributionRule(keywords=["plan","step","sequence","workflow","ordering"],
                    type=AttributionType.PLAN),
    AttributionRule(keywords=["goal","intent","objective","aim","target"],
                    type=AttributionType.INTENTION),
]


class AttributionMatrix:
    """Classify failures into the seven attribution layers.

    Pass custom `rules` (e.g. loaded from YAML) to override the defaults; pass
    an empty list to force LUCK for everything (rarely useful outside tests).
    """

    def __init__(self, rules: list[AttributionRule] | None = None) -> None:
        self._rules: list[AttributionRule] = (
            list(rules) if rules is not None else list(DEFAULT_ATTRIBUTION_RULES)
        )

    def classify(self, failure: FailureDescription) -> AttributionType:
        """Return the AttributionType for a single failure."""
        text = " ".join([failure.what_failed, failure.expected, failure.actual,
                         failure.context, failure.error_trace]).lower()
        for rule in self._rules:
            for kw in rule.keywords:
                if kw.lower() in text:
                    return rule.type
        return AttributionType.LUCK

    def get_distribution(self, failures: list[FailureDescription]) -> dict[AttributionType, int]:
        """Count how many failures fall into each attribution layer."""
        distribution: dict[AttributionType, int] = {}
        for failure in failures:
            attr_type = self.classify(failure)
            distribution[attr_type] = distribution.get(attr_type, 0) + 1
        return distribution
```

```python
# flowforge/core/eval/control_plane.py
from dataclasses import dataclass, field
from typing import Any, Callable
from flowforge.core.errors import EvalError
from flowforge.core.eval.attribution import (
    AttributionMatrix, AttributionType, FailureDescription,
)
from flowforge.core.eval.contract import (
    DEFAULT_QUALITY_BAR, EvalContract, EvalContractRunner, EvalVerdict,
)
from flowforge.core.eval.three_signals import (
    DEFAULT_SIGNAL_WEIGHTS, AggregatedScore, EvalSignal, SignalSource,
    ThreeSignalAggregator,
)

# Context keys understood by _build_contract.
CTX_PROMISED = "promised"
CTX_EVIDENCE = "evidence"
CTX_QUALITY_BAR = "quality_bar"
CTX_ATTRIBUTION = "attribution"

CONTRACT_WEIGHT = 0.5
SIGNAL_WEIGHT = 0.5


@dataclass(frozen=True)
class EvalTarget:
    """The artifact + context that the control plane evaluates."""

    target_id: str
    target_type: str
    artifact: str
    context: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class EvalReport:
    """The full evaluation result returned by EvalControlPlane.run_evaluations."""

    target_id: str
    contract_verdict: EvalVerdict
    signals: AggregatedScore
    attribution: AttributionType | None
    overall_score: float
    recommendations: list[str]


class EvalControlPlane:
    """Coordinates the contract / three-signal / attribution components.

    The control plane itself does NOT call an LLM — it is a deterministic
    orchestrator. Evaluators may be sync or async; both are supported.
    """

    def __init__(
        self,
        contract_runner: EvalContractRunner | None = None,
        attribution_matrix: AttributionMatrix | None = None,
        signal_weights: dict[SignalSource, float] | None = None,
        quality_bar: float = DEFAULT_QUALITY_BAR,
    ) -> None: ...

    def register_evaluator(
        self, name: str, evaluator: Callable[[EvalTarget], Any]
    ) -> None:
        """Register a named evaluator callable (sync or async)."""
        if not name:
            raise EvalError("evaluator name must be non-empty")
        if name in self._evaluators:
            raise EvalError(f"evaluator {name!r} already registered")
        self._evaluators[name] = evaluator

    async def run_evaluations(self, target: EvalTarget) -> EvalReport:
        """Run contract + signals + attribution for one target (5-step flow)."""
        contract = self._build_contract(target)                       # 1. 契约
        verdict = self._contract_runner.evaluate(contract)           # 2. 裁决
        signals = await self._collect_signals(target)                 # 3. 信号采集
        aggregator = ThreeSignalAggregator(self._signal_weights)
        for sig in signals:
            aggregator.add_signal(sig)
        aggregated = aggregator.aggregate()                            # 4. 信号聚合
        attribution = self._classify_failure(contract, verdict)      # 5. 失败归因
        overall_score = self._compute_overall(verdict, aggregated)
        recommendations = self._build_recommendations(verdict, aggregated, attribution)
        return EvalReport(target_id=target.target_id, contract_verdict=verdict,
                          signals=aggregated, attribution=attribution,
                          overall_score=overall_score, recommendations=recommendations)
```

```python
# flowforge/core/eval/loader.py
import asyncio
from dataclasses import dataclass, field
from pathlib import Path
import yaml
from flowforge.core.errors import EvalError
from flowforge.core.eval.attribution import (
    AttributionRule, AttributionType, DEFAULT_ATTRIBUTION_RULES,
)
from flowforge.core.eval.three_signals import (
    DEFAULT_SIGNAL_WEIGHTS, SignalSource,
)

DEFAULT_QUALITY_BAR = 0.85


@dataclass(frozen=True)
class EvalConfig:
    """Configuration consumed by the eval control plane."""

    default_quality_bar: float = DEFAULT_QUALITY_BAR
    signal_weights: dict[SignalSource, float] = field(
        default_factory=lambda: dict(DEFAULT_SIGNAL_WEIGHTS)
    )
    attribution_rules: list[AttributionRule] = field(
        default_factory=lambda: list(DEFAULT_ATTRIBUTION_RULES)
    )


class EvalConfigLoader:
    """Loads an EvalConfig from a YAML file (async, asyncio.to_thread)."""

    async def load_from_yaml(self, path: Path) -> EvalConfig:
        """Read and parse the YAML file at `path` into an EvalConfig."""
        return await asyncio.to_thread(self._load_sync, path)

    def _load_sync(self, path: Path) -> EvalConfig:
        if not path.exists():
            raise EvalError(f"eval config file not found: {path}")
        with open(path, "r", encoding="utf-8") as fh:
            raw = yaml.safe_load(fh)
        if not isinstance(raw, dict):
            raise EvalError("eval config root must be a mapping")
        return self._build_config(raw)
```

## 3. 验收标准

### Phase A（归因矩阵 + 控制面 + Loader）

- [ ] AC-A1: `AttributionType` 枚举必须包含 7 值（INTENTION / PLAN / TOOL / KNOWLEDGE / EXECUTION / CONTEXT / LUCK）
- [ ] AC-A2: `DEFAULT_ATTRIBUTION_RULES` 按 EXECUTION → KNOWLEDGE → CONTEXT → TOOL → PLAN → INTENTION 顺序匹配，首条命中即返回，无匹配 fallback 到 LUCK
- [ ] AC-A3: `AttributionMatrix.classify()` 不调用 LLM（确定性关键词匹配），可被 YAML 规则覆盖
- [ ] AC-A4: `AttributionMatrix.get_distribution()` 返回 `dict[AttributionType, int]`，用于历史归因分布统计
- [ ] AC-A5: `EvalControlPlane.run_evaluations()` 实现五步流程（contract → verdict → signals → aggregate → attribution），方法本身不调用 LLM
- [ ] AC-A6: `CONTRACT_WEIGHT = 0.5` / `SIGNAL_WEIGHT = 0.5`，无信号时 `overall = verdict.score`（退化）
- [ ] AC-A7: `register_evaluator` 重名或空名抛 `EvalError`；evaluator 支持 sync/async（`inspect.iscoroutine` 自动识别）
- [ ] AC-A8: 单个 evaluator 抛异常时被 `_collect_signals` 异常隔离，不阻断其他 evaluator，warning 日志可追溯
- [ ] AC-A9: `EvalConfigLoader.load_from_yaml()` 通过 `asyncio.to_thread` 异步加载，文件不存在 / YAML 解析失败抛 `EvalError`
- [ ] AC-A10: `EvalConfig.default_quality_bar` 超出 `[0.0, 1.0]` 抛 `EvalError`；未知 `signal_source` / `attribution_type` 抛 `EvalError`
- [ ] AC-A11: 日志通过 `core/tracing.py` 的 `get_logger` 自动注入 `trace_id`，禁 print

### Phase B（修复路径 + 历史回灌 + 信号回流）

- [ ] AC-B1: 每类 `AttributionType` 对应明确修复路径（INTENTION→重新对齐愿景 / PLAN→重新规划 / TOOL→换工具 / KNOWLEDGE→补盲点 / EXECUTION→重试 / CONTEXT→补充上下文 / LUCK→记录但不修复）
- [ ] AC-B2: `attribution != LUCK` 时追加 recommendation "address {layer}-layer root cause"
- [ ] AC-B3: `verdict.passed and agreement_score >= 0.8` 时追加 "no action needed; contract met and signals aligned"
- [ ] AC-B4: `verdict.missing_evidence` 非空时追加 "collect additional evidence: ..."，显式列出缺失项
- [ ] AC-B5: 归因记录 append-only 持久化到EchoStore，按 `target_id` / `attribution` 过滤查询历史
- [ ] AC-B6: 历史归因分布通过 `get_distribution()` 统计，回流到能力画像（CapabilityProfile）的 `blind_spots` 层——某Forgekin若在 TOOL 层反复失败，盲点画像标记"工具调用偏差"，触发跨厂商 reviewer 选择（ADR-004 §2.5）
- [ ] AC-B7: `EvalConfigLoader` 加载的 YAML 配置（`default_quality_bar` / `signal_weights` / `attribution_rules`）注入 `EvalControlPlane.__init__`，全部 YAML 驱动（铁律 5 + P16）
- [ ] AC-B8: E2E 测试 — 构造 `FailureDescription` 含 "timeout" 关键词，归因到 EXECUTION；构造 "hallucination" 归因到 KNOWLEDGE；构造无关键词文本 fallback 到 LUCK；五步流程产出 `EvalReport`，`overall_score = 0.5 * verdict.score + 0.5 * signals.final_score`
- [ ] AC-B9: 遵守 T1-T8 测试铁律：真实 LLM 调用（evaluator 若为 LLM 观察者，必须真实调 LLM）/ 真实场景数据（失败描述必须来自真实 trace）/ 不跳过验证（每类归因必须有断言）/ 不 Mock 工具（telemetry 采集必须真实埋点）/ 采集 MetricsCollector 完整指标 / LLM 生成内容必须经 LLM 审核（T7：若 failure 描述由 LLM 总结，必须再调 LLM 审核归因分类合理性）/ Web 功能操控浏览器验证 DOM

## 4. 依赖

- **Evolved from**: 无
- **Blocked by**: 无（归因层为评估终态，依赖 F018 契约 + F019 信号作为输入）
- **Related**: F018（契约 `what_attribution` 字段消费 `AttributionType`）、F019（信号分歧定位根因层）、F040（EvalControlPlane 编排五步流程）、F002（TeamAct 终止条件触发 eval 时由控制面裁决）

## 5. 风险

| 风险 | 缓解 |
|------|------|
| 关键词归因漏判边缘 case（语义等价但用词不同） | 规则 YAML 可覆盖；无匹配 fallback 到 LUCK 触发人工审视；归因分布长期可统计 |
| EXECUTION 优先级误判（timeout 是症状非根因） | `get_distribution()` 长期统计；某Forgekin EXECUTION 占比过高时触发"工具 / 环境约束"专项排查 |
| 控制面权重 0.5/0.5 不适配所有场景 | `CONTRACT_WEIGHT` / `SIGNAL_WEIGHT` 为模块常量，可在 YAML 配置层覆盖 |
| evaluator 注册遗漏导致信号缺失 | `_collect_signals` 异常隔离 + warning 日志；缺失源在 `recommendations` 显式提示 |
| 归因结果回流能力画像滞后 | 与 ADR-008 EchoStore 集成，append-only 单调积累；与 ADR-004 盲点画像联动跨厂商 review |
| YAML 配置覆盖默认规则后行为漂移 | `EvalConfigLoader` 严格 schema 校验；未知 `attribution_type` / `signal_source` 抛 `EvalError` |
| 历史归因数据回灌控制面时版本不兼容 | `EvalConfig` frozen dataclass + 字段版本号；向后兼容字段缺失时 fallback 默认值 |

## 6. Open Questions

| # | 问题 | 状态 |
|---|------|------|
| OQ-1 | 归因分类是否需要支持多标签（一次失败归到多层）？ | ⬜ 未定 |
| OQ-2 | LUCK 占比过高时是否需要触发"归因规则审查"建议？ | ⬜ 未定 |
| OQ-3 | 历史归因数据回灌控制面的触发时机（按 target_id / 按时间窗口）？ | ⬜ 未定 |
| OQ-4 | 归因规则 YAML 覆盖是否需要MindCouncil 审查，防止单厂商私改规则？ | ⬜ 未定 |

## 7. Key Decisions

| # | 决策 | 理由 | 日期 |
|---|------|------|------|
| KD-1 | 七类归因（INTENTION/PLAN/TOOL/KNOWLEDGE/EXECUTION/CONTEXT/LUCK） | `[doc:roleagent.md#第5章]` 7 类归因矩阵，对应核心公式每失效层 | 2026-07-21 |
| KD-2 | 关键词驱动确定性分类（不调 LLM） | 复用 `loop/verifier.py` 判别式；成本可接受；规则 YAML 可覆盖 | 2026-07-21 |
| KD-3 | EXECUTION 优先检查 | timeout 常与其他症状共现但通常是根因 | 2026-07-21 |
| KD-4 | 无匹配 fallback 到 LUCK | 不可控因素记录但不修复；LUCK 占比过高时触发归因规则审查 | 2026-07-21 |
| KD-5 | 控制面权重 0.5/0.5 | 契约与信号等权；无信号时退化为契约裁决 | 2026-07-21 |
| KD-6 | EvalControlPlane 为统一入口 | roleagent.md "终态是统一 Eval Hub"，避免 F192/F200 各自维护定时任务 | 2026-07-21 |
| KD-7 | 行动队列而非展示指标 | `_build_recommendations()` 输出可执行行动，让Forgekin在正确坐标系里得出结论 | 2026-07-21 |
| KD-8 | EvalLoader YAML 驱动 | 铁律 5 + P16 禁硬编码；`asyncio.to_thread` 异步友好 | 2026-07-21 |

## 8. Timeline

| 日期 | 事件 |
|------|------|
| 2026-07-21 | 立项，确立七类归因矩阵 + EvalControlPlane 五步流程 + EvalLoader 配置加载 Feature 规格，落地 roleagent.md"统一 Eval Hub"终态骨架 |

## 9. Review Gate

- Phase A: 单元测试通过，`AttributionType` / `AttributionMatrix` / `EvalControlPlane` / `EvalConfigLoader` 由架构师Forgekin review，归因规则顺序由MindCouncil 跨厂商审查（防止单厂商盲点影响规则优先级）
- Phase B: E2E 测试由跨厂商 reviewer Forgekin review，修复路径映射与历史归因回灌能力画像达标，T7 LLM 审核通过

## 10. Links

| 类型 | 路径 | 说明 |
|------|------|------|
| **ADR** | `docs/decisions/009-eval-self-metabolism.md` | Eval 自代谢决策（§2.3 七类归因 / §2.4 控制面 / §2.6 信号回流） |
| **roleagent** | `docs/roleagent.md#第5章` | Eval：Harness 的自我代谢系统 |
| **roleagent** | `docs/roleagent.md#第1章` | 核心公式：能力 × Harness 契合度 |
| **Feature** | `docs/features/F018-eval-contract.md` | Eval Contract 五问（`what_attribution` 字段消费 `AttributionType`） |
| **Feature** | `docs/features/F019-three-signals.md` | 三方信号交叉验证（信号分歧定位根因层） |
| **决策** | `docs/decisions/004-capability-profile-routing.md` | 能力画像路由（归因回流消费方，§2.5 跨厂商 reviewer 选择） |
| **决策** | `docs/decisions/008-multi-domain-memory-federation.md` | EchoStore（历史归因 append-only 持久化层） |
| **决策** | `docs/decisions/012-naming-fusion.md` | 命名融合（项目正式术语表） |
| **VISION** | `docs/VISION.md#5` | 自代谢：能力画像随 eval 信号实时刷新 |
| **规则** | `docs/project_rules.md#红线5` | 禁止硬编码路径 / 密钥 / 端口（EvalConfig YAML 驱动） |
| **规则** | `docs/project_rules.md#红线11` | 禁止硬编码提示词 / 路径 / 密钥 / 端口 |
| **代码** | `flowforge/core/eval/attribution.py` | AttributionType + AttributionMatrix 实现 |
| **代码** | `flowforge/core/eval/control_plane.py` | EvalControlPlane 五步流程实现 |
| **代码** | `flowforge/core/eval/loader.py` | EvalConfigLoader YAML 加载实现 |
