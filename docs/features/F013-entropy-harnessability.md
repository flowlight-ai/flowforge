---
feature_ids: [F013]
related_features: [F002, F008, F009, F010, F011, F012]
topics: [harness, entropy-control, harnessability, scoring, ttl, grading]
doc_kind: spec
created: 2026-07-21
---

# F013: 熵控制 + 可驾驭性评分（Entropy Control + Harnessability Scorer）

> **状态**: spec | **负责人**: 架构师灵智体 | **优先级**: P0
> **依赖 ADR**: [doc:decisions/007-harness-engineering.md]
> **依据**: operator 7 条不可妥协原则 + roleagent.md 第 3 章 Harness 七层（Layer 6 + Layer 7）
> **关联 VISION**: [doc:VISION.md#6]（operator 原则第 6 条：支持自己开发自己）

## 1. 上下文

### 1.1 问题陈述

`[doc:roleagent.md#第3章]` 指出：Harness 有两种死法，第二种是规则只增不减变成技术债。长期运行会积累冗余规则、过期文档、临时补丁、重复记忆——熵增不可逆，必须有 TTL 机制让脚手架不能无限期占用注意力预算。

同时，`[doc:roleagent.md#第1章]` 给出核心公式：**Agent 质量 = 模型能力 × Harness 契合度**。能力画像（CapabilityProfile）只有进入具体运行环境后，才会从静态描述变成可验证能力。Harness 契合度需要量化为可计算指标——这是 ADR-004 中 `harness_fit_score` 字段的实际供给源。

FlowForge 需要合并两层紧密相关的 Harness 能力：
- **第 6 层 EntropyController**：TTL 机制清理过期 artifact，产生 artifact 状态信号
- **第 7 层 HarnessabilityScorer**：基于熵控信号 + 其他 5 维信号加权打分

两层关系：**熵控制器产生 artifact 状态信号，可驾驭性评分器基于这些信号 + 其他 5 维信号打分**。本 Feature 合并两 layer 为一份规格（F013），因 task.md 要求 F008-F013 共 6 份。

### 1.2 当前痛点

- *Forge 项目中 hotfix 合入后无自动升级 review，技术债只增不减
- "Build to Delete"类规则未标 sunset，脚手架无限期占用注意力预算
- Harness 契合度无量化指标，ADR-004 `harness_fit_score` 字段无供给源
- 各 Harness 层独立运行，无统一评分驱动改进优先级

### 1.3 不做的影响

- Harness 规则膨胀变技术债，第二种死法
- `harness_fit_score` 字段无供给源，ADR-004 能力画像路由失效
- 各 Harness 层无统一评分，改进优先级无依据
- "自己开发自己"闭环无法达成——开发过程必须可量化评估

## 2. 决策

### 2.1 核心设计

#### 2.1.1 EntropyController（Layer 6）

- `EntropyEntry`：TTL 跟踪数据类，含 `artifact_id` / `created_at` / `last_touched` / `ttl_seconds`
- `EntropyController.register_artifact(artifact_id, ttl_seconds)`：注册待清理对象，`ttl_seconds < 0` 抛 `HarnessError`
- `EntropyController.touch(artifact_id)`：重置 `last_touched` 为 now，延后过期
- `EntropyController.list_expired()`：返回 `now - last_touched > ttl_seconds` 的 artifact_id 列表
- `EntropyController.cleanup_expired()`：批量删除并返回计数
- `EntropyController.get_entry(artifact_id)`：查询单个 entry
- `EntropyController.count()`：返回当前 entry 总数
- 对应 roleagent.md 的"hotfix 合入后两周自动触发升级 review"和"Build to Delete 类规则要标 sunset"

#### 2.1.2 HarnessabilityScorer（Layer 7）

- **权重常量**（合 1.0）：
  - `WEIGHT_DURABLE_STATE = 0.20`
  - `WEIGHT_TOOL_ALLOWLIST = 0.20`
  - `WEIGHT_EVIDENCE = 0.20`
  - `WEIGHT_GOVERNANCE = 0.15`
  - `WEIGHT_MAGIC_WORD = 0.15`
  - `WEIGHT_ENTROPY = 0.10`
- `GOVERNANCE_FULL_RULE_COUNT = 5`：5 条规则即得满分（饱和阈值）
- `HarnessabilityFactors`：6 维输入数据类
  - `durable_state_coverage: float` [0.0, 1.0]
  - `tool_allowlist_strictness: float` [0.0, 1.0]
  - `evidence_completeness: float` [0.0, 1.0]
  - `governance_rule_count: int`（饱和于 `GOVERNANCE_FULL_RULE_COUNT`）
  - `magic_word_coverage: float` [0.0, 1.0]
  - `entropy_cleanup_rate: float` [0.0, 1.0]
- `HarnessabilityScorer.score(factors)`：加权平均后 clamp 到 [0.0, 1.0]
- `HarnessabilityScorer.grade(score)`：A(≥0.9) / B(≥0.8) / C(≥0.6) / D(≥0.4) / F

#### 2.1.3 两层关系

熵控制器产生 `entropy_cleanup_rate` 信号（清理率 = `cleanup_expired() / count()`），可驾驭性评分器基于该信号 + 其他 5 维信号加权打分。熵控是"清洁度"信号源，可驾驭性评分是"整体驾驭度"汇总。

### 2.2 关键接口

```python
"""Entropy Control — TTL-based artifact retirement (roleagent.md Ch.7).

Layer 6 of the Harness seven-layer guardrail. Stale artifacts are retired
so the working set stays bounded — the harness does not accumulate entropy.
An artifact expires when ``now - last_touched > ttl_seconds``.
"""

from dataclasses import dataclass
from datetime import datetime, timezone

from flowforge.core.errors import HarnessError


@dataclass
class EntropyEntry:
    """One tracked artifact with a TTL."""

    artifact_id: str
    created_at: datetime
    last_touched: datetime
    ttl_seconds: int


class EntropyController:
    """TTL-based artifact retirement."""

    def __init__(self) -> None:
        self._entries: dict[str, EntropyEntry] = {}

    def register_artifact(self, artifact_id: str, ttl_seconds: int) -> None:
        if not artifact_id:
            raise HarnessError("artifact_id must be non-empty")
        if ttl_seconds < 0:
            raise HarnessError("ttl_seconds must be non-negative")
        if artifact_id in self._entries:
            raise HarnessError(f"artifact {artifact_id!r} already registered")
        now = datetime.now(timezone.utc)
        self._entries[artifact_id] = EntropyEntry(
            artifact_id=artifact_id,
            created_at=now,
            last_touched=now,
            ttl_seconds=ttl_seconds,
        )

    def touch(self, artifact_id: str) -> None:
        """Reset ``last_touched`` to now, deferring expiry."""
        if artifact_id not in self._entries:
            raise HarnessError(f"artifact {artifact_id!r} not found")
        self._entries[artifact_id].last_touched = datetime.now(timezone.utc)

    def list_expired(self) -> list[str]:
        now = datetime.now(timezone.utc)
        return [
            aid
            for aid, entry in self._entries.items()
            if (now - entry.last_touched).total_seconds() > entry.ttl_seconds
        ]

    def cleanup_expired(self) -> int:
        """Remove all expired entries and return the count removed."""
        expired = self.list_expired()
        for aid in expired:
            del self._entries[aid]
        return len(expired)

    def get_entry(self, artifact_id: str) -> EntropyEntry | None:
        return self._entries.get(artifact_id)

    def count(self) -> int:
        return len(self._entries)
```

```python
"""Harnessability — score how well a harness is wired (roleagent.md Ch.7).

Layer 7 of the Harness seven-layer guardrail. A single 0..1 score summarizes
whether all six lower layers are present and tight. Weights sum to 1.0:

    durable_state  0.20
    tool_allowlist 0.20
    evidence       0.20
    governance     0.15
    magic_word     0.15
    entropy        0.10

``governance_rule_count`` is a raw integer count saturated at
``GOVERNANCE_FULL_RULE_COUNT`` (5 rules = full governance score).
"""

from dataclasses import dataclass

# Weights — sum to 1.0
WEIGHT_DURABLE_STATE = 0.20
WEIGHT_TOOL_ALLOWLIST = 0.20
WEIGHT_EVIDENCE = 0.20
WEIGHT_GOVERNANCE = 0.15
WEIGHT_MAGIC_WORD = 0.15
WEIGHT_ENTROPY = 0.10

# Saturation threshold: 5 governance rules == full governance score.
GOVERNANCE_FULL_RULE_COUNT = 5


@dataclass
class HarnessabilityFactors:
    """Inputs to the harnessability score.

    All float fields are expected in [0.0, 1.0]. ``governance_rule_count`` is
    a raw integer count (saturated at ``GOVERNANCE_FULL_RULE_COUNT``).
    """

    durable_state_coverage: float
    tool_allowlist_strictness: float
    evidence_completeness: float
    governance_rule_count: int
    magic_word_coverage: float
    entropy_cleanup_rate: float


class HarnessabilityScorer:
    """Weighted-average scorer + letter grader."""

    def score(self, factors: HarnessabilityFactors) -> float:
        gov_score = min(
            factors.governance_rule_count / GOVERNANCE_FULL_RULE_COUNT, 1.0
        )
        total = (
            factors.durable_state_coverage * WEIGHT_DURABLE_STATE
            + factors.tool_allowlist_strictness * WEIGHT_TOOL_ALLOWLIST
            + factors.evidence_completeness * WEIGHT_EVIDENCE
            + gov_score * WEIGHT_GOVERNANCE
            + factors.magic_word_coverage * WEIGHT_MAGIC_WORD
            + factors.entropy_cleanup_rate * WEIGHT_ENTROPY
        )
        # Clamp to [0.0, 1.0] to defend against out-of-range inputs.
        total = max(0.0, min(1.0, total))
        return total

    def grade(self, score: float) -> str:
        """Map a 0..1 score to a letter grade (A/B/C/D/F)."""
        if score >= 0.9:
            return "A"
        if score >= 0.8:
            return "B"
        if score >= 0.6:
            return "C"
        if score >= 0.4:
            return "D"
        return "F"
```

## 3. 验收标准

### Phase A（熵控原语 + 评分原语）

- [ ] AC-A1: `EntropyEntry` 数据类含 4 字段（`artifact_id` / `created_at` / `last_touched` / `ttl_seconds`）
- [ ] AC-A2: `register_artifact(artifact_id, ttl_seconds)` 注册，`ttl_seconds < 0` 或 `artifact_id` 重复抛 `HarnessError`
- [ ] AC-A3: `touch(artifact_id)` 重置 `last_touched` 为 now，未知 ID 抛 `HarnessError`
- [ ] AC-A4: `list_expired()` 返回 `now - last_touched > ttl_seconds` 的 artifact_id 列表
- [ ] AC-A5: `cleanup_expired()` 批量删除并返回计数；`get_entry()` / `count()` 辅助查询
- [ ] AC-A6: 权重常量合 1.0（`0.20 + 0.20 + 0.20 + 0.15 + 0.15 + 0.10`）
- [ ] AC-A7: `GOVERNANCE_FULL_RULE_COUNT = 5`，governance_rule_count 饱和于 5
- [ ] AC-A8: `HarnessabilityFactors` 含 6 维字段（5 个 float + 1 个 int）
- [ ] AC-A9: `score(factors)` 加权平均后 clamp 到 [0.0, 1.0]
- [ ] AC-A10: `grade(score)` 分级 A(≥0.9) / B(≥0.8) / C(≥0.6) / D(≥0.4) / F

### Phase B（两层联动 + E2E）

- [ ] AC-B1: `entropy_cleanup_rate` 信号由 EntropyController 供给（`cleanup_expired() / count()`）
- [ ] AC-B2: `HarnessabilityFactors` 各维度信号由对应 Harness 层供给：
  - `durable_state_coverage` ← F008 DurableStateSurface
  - `tool_allowlist_strictness` ← F009 ToolMediator
  - `evidence_completeness` ← F010 EvidenceCollector
  - `governance_rule_count` ← F011 GovernanceBoundary
  - `magic_word_coverage` ← F012 MagicWordsRegistry
  - `entropy_cleanup_rate` ← F013 EntropyController
- [ ] AC-B3: `score` 输出作为 ADR-004 `harness_fit_score` 字段的供给源
- [ ] AC-B4: 权重可由 Loop 配置注入（与质量分阈值 0.85 同套机制）
- [ ] AC-B5: E2E 测试 — 注册 10 个 artifact（TTL=60s），等待 61s 后 `list_expired()` 返回 10 个，`cleanup_expired()` 返回 10，`entropy_cleanup_rate` 提升
- [ ] AC-B6: E2E 测试 — 6 维信号全满分时 `score = 1.0`，`grade = "A"`；全零分时 `score = 0.0`，`grade = "F"`
- [ ] AC-B7: 遵守 T1-T8 测试铁律（真实 LLM 调用、真实场景数据、不跳过验证、不 Mock 工具、采集完整指标、LLM 生成内容经 LLM 审核、Web 功能操控浏览器验证 DOM）

## 4. 依赖

- **Evolved from**: 无
- **Blocked by**: F008 / F009 / F010 / F011 / F012（HarnessabilityFactors 各维度信号由对应层供给）
- **Related**: F002（TeamAct，harness_fit_score 影响能力画像路由）、F008（Durable State Surface，`durable_state_coverage` 信号源 + 快照 TTL 清理）、F009（工具中介，`tool_allowlist_strictness` 信号源）、F010（证据传感器，`evidence_completeness` 信号源 + 证据 TTL 清理）、F011（治理边界，`governance_rule_count` 信号源 + 规则 TTL 清理）、F012（魔法词，`magic_word_coverage` 信号源）

## 5. 风险

| 风险 | 缓解 |
|------|------|
| TTL 设置不当导致有用 artifact 被误删 | `touch()` 允许延后过期；`list_expired` 与 `cleanup_expired` 分离，可先审计再清理 |
| 权重静态写死，无法适配不同领域 | 权重以模块常量形式存在，未来可由 Loop 配置注入 |
| `entropy_cleanup_rate` 计算口径不一致（瞬时 vs 累计） | P2 阶段明确为滑动窗口累计清理率 |
| `governance_rule_count` 饱和阈值 5 可能过低 | P2 阶段可由 Loop 配置覆盖 `GOVERNANCE_FULL_RULE_COUNT` |
| 评分被灵智体伪造（虚报满分） | 各维度信号由 Harness 层结构性供给，不靠灵智体自报 |

## 6. Open Questions

| # | 问题 | 状态 |
|---|------|------|
| OQ-1 | `entropy_cleanup_rate` 计算口径：瞬时（当前过期比例）还是累计（历史清理率）？ | ⬜ 未定 |
| OQ-2 | 权重是否需要按领域动态调整（如 DevForge 重 evidence，NovelForge 重 magic_word）？ | ⬜ 未定 |
| OQ-3 | `grade` 分级阈值是否需要可配置？ | ⬜ 未定 |
| OQ-4 | EntropyController 是否需要持久化（跨 session 保留 TTL）？ | ⬜ 未定 |

## 7. Key Decisions

| # | 决策 | 理由 | 日期 |
|---|------|------|------|
| KD-1 | 合并 Layer 6 + Layer 7 为 F013 | 熵控产生信号，评分消费信号，两层紧密相关 | 2026-07-21 |
| KD-2 | 权重合 1.0（0.20/0.20/0.20/0.15/0.15/0.10） | 前 3 层（状态/工具/证据）权重最高，后 3 层（治理/魔法词/熵）权重递减 | 2026-07-21 |
| KD-3 | `GOVERNANCE_FULL_RULE_COUNT = 5` | 5 条规则即得满分，避免规则数量膨胀刷分 | 2026-07-21 |
| KD-4 | `score` clamp 到 [0.0, 1.0] | 防御性编程，防 out-of-range 输入 | 2026-07-21 |
| KD-5 | `grade` 分级 A/B/C/D/F | 与项目质量分阈值 0.85 对齐（A/B 为合格） | 2026-07-21 |
| KD-6 | `list_expired` 与 `cleanup_expired` 分离 | 可先审计再清理，防误删 | 2026-07-21 |
| KD-7 | 评分作为 ADR-004 `harness_fit_score` 供给源 | 闭环 ADR-004 能力画像路由 | 2026-07-21 |

## 8. Timeline

| 日期 | 事件 |
|------|------|
| 2026-07-21 | 立项，确立 Entropy Control + Harnessability Scorer Feature 规格，合并 Layer 6 + Layer 7，对齐 ADR-007 与 `flowforge/core/harness/entropy_control.py` + `harnessability.py` P1 实现 |

## 9. Review Gate

- Phase A: 单元测试通过，权重合 1.0 不变量与分级边界由架构师灵智体 review
- Phase B: E2E 测试由跨厂商 reviewer 灵智体 review，6 维信号联动 + `harness_fit_score` 闭环验证

## 10. Links

| 类型 | 路径 | 说明 |
|------|------|------|
| **ADR** | `docs/decisions/007-harness-engineering.md` | Harness 工程路径决策（七层） |
| **ADR** | `docs/decisions/004-capability-profile-routing.md` | 能力画像路由（`harness_fit_score` 字段消费方） |
| **roleagent** | `docs/roleagent.md#第1章` | 核心公式：能力 × Harness 契合度 |
| **roleagent** | `docs/roleagent.md#第3章` | Harness 七层白皮书（Layer 6：清理现实 + Layer 7：适配现实） |
| **代码** | `flowforge/core/harness/entropy_control.py` | EntropyController P1 实现 |
| **代码** | `flowforge/core/harness/harnessability.py` | HarnessabilityScorer P1 实现 |
| **Feature** | `docs/features/F008-durable-state-surface.md` | Durable State Surface（`durable_state_coverage` 信号源） |
| **Feature** | `docs/features/F009-tool-mediation.md` | 工具中介（`tool_allowlist_strictness` 信号源） |
| **Feature** | `docs/features/F010-evidence-sensors.md` | 证据传感器（`evidence_completeness` 信号源） |
| **Feature** | `docs/features/F011-governance-boundary.md` | 治理边界（`governance_rule_count` 信号源） |
| **Feature** | `docs/features/F012-magic-words.md` | 魔法词（`magic_word_coverage` 信号源） |
