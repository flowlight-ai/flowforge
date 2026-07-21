# ADR 009: Eval 自代谢（Self-Metabolizing Evaluation）

> **状态**: accepted
> **日期**: 2026-07-21
> **决策者**: operator + 架构师灵智体
> **依赖**: `[doc:roleagent.md#第5章]` + `[doc:decisions/004-capability-profile-routing.md]` + `[doc:decisions/008-multi-domain-memory-federation.md]`
> **依据**: operator 7 条不可妥协原则 + roleagent.md 工程路径

---

## 1. 上下文

`[doc:roleagent.md#第5章]` 开篇即立论："有 harness，就必须有 eval。否则 harness 只会增生，不会代谢。" 第 1 章把每块 harness 分为 Build to Delete（有保质期脚手架）和 Built to Persist（复利型基础设施），但判别器只告诉团队该分哪类，没告诉什么时候执行 Delete——"模型升级了"只是提示，真正的退役信号是 eval 数据显示该机制不再被需要。

当前 FlowForge（flowlight-ai/flowforge 新仓库）面临三个静态 eval 病灶：

- **Benchmark 只测一个因子**：benchmark 测的是模型能力（等式左项），无法测 harness 契合度（等式右项）。一个 benchmark 满分的灵智体（Forgekin）换到本项目里可能因工具描述含糊而频繁出错。
- **无退役信号 = 技术债永生**：一块机制从来不触发，比"指标下降"更危险——它可能是死代码，只是在占用 agent 的注意力预算。没有退役信号的 harness，就是没有自我删除机制的技术债。
- **"agent 没做好"是拍扁的多层答案**：行业常见路径是"agent 做得不好 → 优化 prompt → 换模型"，把多层系统压扁成一维答案。回到核心公式 `效能 = 能力 × Harness 契合度`，问题可能出在愿景、翻译、工具、执行、环境、品味任一层。

operator 指示："multi-agent 协作从 role-agent 走向能力画像、动态路由、共享状态、eval 和可靠性治理的工程路径"——eval 必须从"写完规则以后补一个报告"推进到系统设计层，让能力画像（CapabilityProfile）从印象更新为证据。本 ADR 是 P1 决策，术语对齐 `[doc:decisions/012-naming-fusion.md]`。

---

## 2. 决策

### 2.1 Eval Contract 五问（What / Why / How / Who / When）

每新增一块 harness，必须同时回答五个问题，作为该机制的"预期声明"。代码实现见 `flowforge/core/eval/contract.py` 中的 `EvalContract` dataclass：

```python
@dataclass(frozen=True)
class EvalContract:
    what_was_promised: str           # What — 承诺了什么
    what_was_delivered: str          # How — 实际交付了什么
    what_evidence_exists: list[str]  # Why — 有什么证据（≥2 源得满分）
    what_quality_bar: float = 0.85   # When — 质量门槛（DEFAULT_QUALITY_BAR）
    what_attribution: str = ""       # Who/归因层 — 失败归到哪一层
```

`EvalContractRunner.evaluate()` 是**确定性裁决器，不调用 LLM**：交付分用 Jaccard 词重叠，证据分按 `FULL_EVIDENCE_SOURCES = 2` 归一，最终分用几何平均 `score = (delivery_score * evidence_score) ** 0.5`（与 `loop/verifier.py` 聚合形态一致）。证据缺失即一票否决，与 `engine.py` 的"evidence ≥2 sources"硬护栏对齐。

### 2.2 三方信号（operator / peer / self signals）

`[doc:roleagent.md#第5章]` 强调"只看 trace 也不够"，采用三类信号交叉。代码实现见 `flowforge/core/eval/three_signals.py`：

```python
class SignalSource(Enum):
    SELF_REPORT = "self_report"  # 自评（最低权重，最易乐观偏差）
    OBSERVER    = "observer"     # 跨 agent / 人类 reviewer
    TELEMETRY   = "telemetry"    # 客观遥测（与 observer 同列最高权重）

DEFAULT_SIGNAL_WEIGHTS = {
    SignalSource.SELF_REPORT: 0.2,
    SignalSource.OBSERVER:    0.4,
    SignalSource.TELEMETRY:   0.4,
}
```

`ThreeSignalAggregator.aggregate()` 输出 `AggregatedScore`，含 `final_score`（加权平均）、`agreement_score = 1.0 - pstdev(values)`、`disagreement_score`。self_report 被折扣，因为它是最易受 RLHF"该收尾了"惯性反射污染的信号源——这与 roleagent.md"用行为信号而非自评"的设计选择一致。

### 2.3 七类归因（attribution categories）

`[doc:roleagent.md#第5章]` 给出 7 类归因矩阵，工程化映射见 `flowforge/core/eval/attribution.py` 的 `AttributionType`：

| 归因层 | 代码常量 | 含义 | 改什么 |
|--------|----------|------|--------|
| 意图层 | `INTENTION` | 目标设定错误（对应"愿景缺口"） | 愿景判断 |
| 计划层 | `PLAN` | 规划错误（对应"翻译偏差"） | 需求文档 |
| 工具层 | `TOOL` | 工具调用错误（对应"harness 错位"） | 工具 / 规则重新定位 |
| 知识层 | `KNOWLEDGE` | 事实性错误（对应"工具缺口"的事实面） | 技能文档 / 搜索策略 |
| 执行层 | `EXECUTION` | 操作错误如 timeout（对应"执行缺口"） | 工具 / 环境约束 |
| 上下文层 | `CONTEXT` | 信息缺失（对应"环境漂移"） | connector / 上下文注入 |
| 运气层 | `LUCK` | 不可控因素（fallback，对应"品味落差"的兜底） | 审美标准 / CVO 反馈 |

`AttributionMatrix.classify()` 是**关键词驱动的确定性分类器**，按 `DEFAULT_ATTRIBUTION_RULES` 顺序匹配，首条命中即返回，无匹配 fallback 到 `LUCK`。EXECUTION（timeout/deadline）优先检查，因为 timeout 常与其他症状共现但通常是根因。规则可由 YAML 覆盖，避免硬编码。

### 2.4 Eval Control Plane（控制面）

`flowforge/core/eval/control_plane.py` 中的 `EvalControlPlane` 是 harness 自评估的**唯一入口**（F040），它协调 contract / signals / attribution 三组件：

```python
class EvalControlPlane:
    async def run_evaluations(self, target: EvalTarget) -> EvalReport:
        contract = self._build_contract(target)
        verdict = self._contract_runner.evaluate(contract)        # 1. 契约裁决
        signals = await self._collect_signals(target)              # 2. 三方信号采集
        aggregated = ThreeSignalAggregator(self._signal_weights)
        for sig in signals: aggregator.add_signal(sig)
        attribution = self._classify_failure(contract, verdict)   # 3. 失败归因（仅失败时）
        overall_score = self._compute_overall(verdict, aggregated) # 4. 综合分
        recommendations = self._build_recommendations(...)         # 5. 行动队列
        return EvalReport(...)
```

关键设计：控制面本身**不调用 LLM**，是确定性编排器。evaluator 通过 `register_evaluator(name, evaluator)` 注入，支持 sync/async（`inspect.iscoroutine` 自动识别）。这是 roleagent.md"F192 / F200 不该永远各自维护一套定时后台任务，终态是统一 Eval Hub"的工程化骨架。

### 2.5 EvalVerdict（裁决）

`EvalVerdict` 是契约运行的输出：`passed` / `score` / `missing_evidence` / `attribution` / `notes`。通过条件是 `score >= quality_bar AND not missing`——质量分门槛默认 0.85（v4.0 调整，可在 Loop 配置中覆盖，符合编程红线第 2 条）。`EvalReport` 进一步聚合契约裁决 + 信号聚合 + 归因 + 综合分 + 行动建议，综合分公式为：

```python
overall = CONTRACT_WEIGHT * verdict.score + SIGNAL_WEIGHT * aggregated.final_score
# CONTRACT_WEIGHT = 0.5, SIGNAL_WEIGHT = 0.5（无信号时退化为 verdict.score）
```

### 2.6 信号回流到能力画像

`_build_recommendations()` 输出的是**行动队列**，而非展示性指标：

- `missing_evidence` → "collect additional evidence: ..."
- `disagreement_score > 0.3` → "signal disagreement high; reconcile observer vs telemetry"
- `attribution != LUCK` → "address {layer}-layer root cause"
- `passed and agreement_score >= 0.8` → "no action needed"

这些行动信号回流到能力画像（CapabilityProfile，见 `[doc:decisions/004-capability-profile-routing.md]`）的 `historical_performance` 积累层，并通过 ADR-008 的灵忆 EchoStore 持久化。能力画像的盲点（`blind_spots`）由归因分布的非 LUCK 类别累积证据——某灵智体若在 `TOOL` 层反复失败，其盲点画像就标记"工具调用偏差"，触发跨厂商 reviewer 选择（ADR-004 §2.5）。配置由 `EvalConfigLoader.load_from_yaml()` 异步加载（`asyncio.to_thread`），`EvalConfig` 持有 `default_quality_bar` / `signal_weights` / `attribution_rules`，全部 YAML 驱动，禁止硬编码（铁律 5 + P16）。

---

## 3. 方案对比

| 方案 | 优点 | 缺点 |
|------|------|------|
| **方案 A（选定）: EvalContract + 三方信号 + 七类归因 + 控制面** | 确定性裁决不调 LLM，成本低；三方信号交叉抑制单源偏差；归因到层而非归因到 agent；YAML 配置驱动可演化 | 关键词归因可能漏判边缘 case；信号采集器需逐个注册；早期样本薄 |
| 方案 B: 纯 benchmark 评测 | 实现简单，业界标准 | 只测模型能力不测 harness 契合度；与工程现场无关；无退役信号 |
| 方案 C: LLM-as-judge 全量自评 | 灵活，覆盖面广 | 违反 roleagent.md"用行为信号而非自评"——LLM 自评集中在 0.6-0.85 成功区间，几乎无负样本；成本高；违反编程红线第 3 条精神 |
| 方案 D: 每个 harness 子系统自建 eval 竖井 | 启动快 | roleagent.md 明确指出这是"启动期合理形态但非终态"；F192/F200 各自维护定时任务会重复造轮子；无法横切比较 |

---

## 4. 理由

- `[doc:roleagent.md#第5章]` 明确主张"有 harness，就必须有 eval。否则 harness 只会增生，不会代谢"——本方案把 eval 从事后报告推进到 harness 创建时的接口契约。
- `EvalContractRunner` 确定性裁决（Jaccard + 几何平均 + 证据≥2 源）与 `loop/verifier.py` / `engine.py` 已有护栏形态一致，复用既有判别式而非发明新评分。
- 三方信号权重 `SELF_REPORT=0.2 / OBSERVER=0.4 / TELEMETRY=0.4` 直接落地 roleagent.md"用行为信号而非自评"——self_report 被折扣是因为它最易受 RLHF 乐观偏差污染。
- 七类归因把"agent 没做好"拍扁的多层答案重新展开，对应核心公式 `效能 = 能力 × Harness 契合度` 的每一个可能失效层。
- `EvalControlPlane` 作为统一入口，是 roleagent.md 终态"Harness Eval Control Plane"的工程骨架，避免每个 feature 自造定时后台任务。
- 控制面本身不调 LLM，符合"给 agent 数据不给结论"原则——结论由灵智体在正确坐标系里得出。

---

## 5. 风险

| 风险 | 缓解 |
|------|------|
| 关键词归因可能漏判边缘 case | 规则 YAML 可覆盖；无匹配 fallback 到 LUCK 触发人工审视；归因分布长期可统计 |
| 三方信号样本早期薄弱 | `agreement_score` / `disagreement_score` 暴露样本质量；`disagreement > 0.3` 触发"reconcile"建议 |
| 证据≥2 源可能过严导致误杀 | `FULL_EVIDENCE_SOURCES` 可配置；`missing_evidence` 显式列出缺失项供 reviewer 判断 |
| evaluator 注册遗漏导致信号缺失 | `_collect_signals` 异常隔离（单 evaluator 失败不阻断），warning 日志可追溯 |
| 控制面权重 0.5/0.5 可能不适配所有场景 | `CONTRACT_WEIGHT` / `SIGNAL_WEIGHT` 为模块常量，可在 YAML 配置层覆盖 |
| 归因结果回流能力画像可能滞后 | 与 ADR-008 灵忆 EchoStore 集成，归因记录单调积累；与 ADR-004 盲点画像联动跨厂商 review |

---

## 6. 否决理由

- **方案 B（纯 benchmark）**：`[doc:roleagent.md#第5章]` 明确指出"benchmark 只测了等式左边的一个因子"，与工程现场无关，无法回答"哪块该退役"。
- **方案 C（LLM-as-judge 全量自评）**：roleagent.md 第 4 章已用具体证据驳斥——"模型的自评集中在 0.6-0.85 的成功区间，几乎没有负样本"，根信号本身有毒；且每次评估都调 LLM，成本不可接受。
- **方案 D（竖井式 eval）**：roleagent.md 明确说"现在 F192、F200 还是两条竖井……这是启动期合理形态，但不是最终架构"，本 ADR 是 P1 决策，必须直接奔向终态控制面。

---

## 7. 参与者

- operator（愿景锚点 + 7 条不可妥协原则 + 最终决策）
- 架构师灵智体（方案设计 + 代码实现 + 术语对齐项目正式命名）
- 灵议 MindCouncil（归因矩阵与控制面权重审查，跨厂商视角）

---

## 8. 修订记录

| 日期 | 修订 | 修订者 |
|------|------|--------|
| 2026-07-21 | 初始版本，确立 Eval 自代谢决策：EvalContract 五问 + 三方信号 + 七类归因 + EvalControlPlane + 信号回流能力画像；术语对齐项目正式命名（灵忆 EchoStore / 灵议 MindCouncil / 灵智体 Forgekin / 能力画像 CapabilityProfile） | operator + 架构师灵智体 |

---

## 引用

- `[doc:roleagent.md#第5章]` — Eval：Harness 的自我代谢系统
- `[doc:roleagent.md#第1章]` — 核心公式：能力 × Harness 契合度
- `[doc:decisions/004-capability-profile-routing.md]` — 能力画像路由（盲点回流消费方）
- `[doc:decisions/008-multi-domain-memory-federation.md]` — 多域记忆联邦（归因记录持久化层）
- `[doc:decisions/012-naming-fusion.md]` — 命名融合（项目正式术语表）
- `[doc:project_rules.md#红线2]` — 质量分阈值默认 0.85
- `[doc:project_rules.md#红线11]` — 禁止硬编码提示词 / 路径 / 密钥 / 端口（EvalConfig YAML 驱动）
