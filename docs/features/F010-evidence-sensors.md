---
feature_ids: [F010]
related_features: [F002, F008, F009, F011, F012, F013]
topics: [harness, evidence, sensors, cross-check, verification]
doc_kind: spec
created: 2026-07-21
---

# F010: 证据传感器（Evidence Sensors）

> **状态**: spec | **负责人**: 架构师Forgekin | **优先级**: P0
> **依赖 ADR**: [doc:decisions/007-harness-engineering.md]
> **依据**: operator 7 条不可妥协原则 + roleagent.md 第 3 章 Harness 七层（Layer 3）
> **关联 VISION**: [doc:VISION.md#6]（operator 原则第 6 条：支持自己开发自己）

## 1. 上下文

### 1.1 问题陈述

`[doc:roleagent.md#第3章]` 指出：模型说"我做了"不等于做对了，自评存在系统偏差。RLHF 训练让模型有"该收尾了"的惯性反射，会提前宣布完成。完成感不能从模型嘴里来，必须从证据链里来——commit、先红后绿测试、cross-check ratio 都是不可伪造的客观信号。

FlowForge 需要一个**证据传感器层**：证据"先记录后验证"（record-then-verify），未验证不算入验收标准；跨厂商 review 通过 `difflib.SequenceMatcher` 计算内容相似度，给客观一致性信号。这是 Harness 七层的第 3 层——验证现实，做了不等于做对了。

### 1.2 当前痛点

- Forgekin自评"已完成"无客观锚点，RLHF 收尾惯性导致提前宣布完成
- 跨厂商 review 缺少客观一致性指标，只靠"CI 通过"≠"愿景对齐"
- 证据未分级（未验证 / 已验证），全都被等权计入验收
- 缺少跨证据交叉验证（cross-check），无法检测矛盾证据

### 1.3 不做的影响

- TeamAct 五项终止条件中"evidence_attached"无法客观判定（F002）
- 跨厂商 review 沦为主观判断，盲点无法暴露
- Forgekin可伪造完成证据，无交叉验证防线
- "自己开发自己"闭环无法达成——开发产出必须可验证

## 2. 决策

### 2.1 核心设计

- `Evidence`：证据数据类，含 `evidence_id` / `source` / `content` / `type` / `recorded_at` / `verified`（默认 `False`）
- `EvidenceCollector.record_evidence(source, content, evidence_type)`：**未验证即入库**，返回 `Evidence`（`verified=False`）
- `EvidenceCollector.verify(evidence_id, verifier)`：显式打标，**必须由非作者 verifier 完成**（结构性强制）
- `EvidenceCollector.list_unverified()`：暴露待验证证据，给 review pipeline 用
- `EvidenceCollector.cross_check(evidence_a, evidence_b)`：基于 `difflib.SequenceMatcher` 计算 [0.0, 1.0] 相似度，支持跨厂商 review 一致性检查
- 完成感从模型嘴里移到证据链里——commit、先红后绿测试、cross-check ratio 都是不可伪造的客观信号

### 2.2 关键接口

```python
"""Evidence & Sensors — record-then-verify evidence store (roleagent.md Ch.7).

Layer 3 of the Harness seven-layer guardrail. Evidence is recorded unverified
and must be explicitly verified before it counts toward acceptance criteria.
Cross-check returns a simple string-similarity ratio in [0.0, 1.0].
"""

import difflib
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from flowforge.core.errors import HarnessError


@dataclass
class Evidence:
    """One piece of recorded evidence."""

    evidence_id: str
    source: str
    content: str
    type: str
    recorded_at: datetime
    verified: bool = False


class EvidenceCollector:
    """Record-then-verify evidence store with cross-check."""

    def __init__(self) -> None:
        self._evidence: dict[str, Evidence] = {}

    def record_evidence(
        self,
        source: str,
        content: str,
        evidence_type: str,
    ) -> Evidence:
        evidence_id = uuid.uuid4().hex
        evidence = Evidence(
            evidence_id=evidence_id,
            source=source,
            content=content,
            type=evidence_type,
            recorded_at=datetime.now(timezone.utc),
            verified=False,
        )
        self._evidence[evidence_id] = evidence
        return evidence

    def verify(self, evidence_id: str, verifier: str) -> None:
        if evidence_id not in self._evidence:
            raise HarnessError(f"evidence {evidence_id!r} not found")
        self._evidence[evidence_id].verified = True

    def list_unverified(self) -> list[Evidence]:
        return [e for e in self._evidence.values() if not e.verified]

    def cross_check(self, evidence_a: Evidence, evidence_b: Evidence) -> float:
        """Return content similarity in [0.0, 1.0] via SequenceMatcher ratio.

        1.0 means identical content; 0.0 means no shared character subsequences.
        """
        ratio = difflib.SequenceMatcher(
            None, evidence_a.content, evidence_b.content
        ).ratio()
        return ratio
```

## 3. 验收标准

### Phase A（记录-验证原语 + cross-check）

- [ ] AC-A1: `Evidence` 数据类含 6 字段（`evidence_id` / `source` / `content` / `type` / `recorded_at` / `verified`），`verified` 默认 `False`
- [ ] AC-A2: `record_evidence(source, content, evidence_type)` 返回 `Evidence`，`verified=False`
- [ ] AC-A3: `verify(evidence_id, verifier)` 对未知 ID 抛 `HarnessError`，已知 ID 置 `verified=True`
- [ ] AC-A4: `list_unverified()` 返回所有 `verified=False` 的证据
- [ ] AC-A5: `cross_check(evidence_a, evidence_b)` 用 `difflib.SequenceMatcher` 返回 [0.0, 1.0] 相似度
- [ ] AC-A6: 完全相同内容返回 1.0，无共享子序列返回 0.0

### Phase B（跨厂商 review + E2E）

- [ ] AC-B1: `verify` 必须由非作者 verifier 完成（结构性强制，调用方传入 `verifier` 与 `source` 比对）
- [ ] AC-B2: 跨厂商 review 配对基于盲点不重叠（依赖 F001 CapabilityProfile）
- [ ] AC-B3: cross-check ratio 阈值可配置（如 ≥0.8 视为一致，<0.5 视为矛盾）
- [ ] AC-B4: E2E 测试 — Forgekin A 产出证据，Forgekin B（不同厂商）verify，cross_check 两份独立证据 ratio 落在合理区间
- [ ] AC-B5: E2E 测试 — TeamAct 五项终止条件中"evidence_attached"基于 `verified=True` 证据计数判定
- [ ] AC-B6: 遵守 T1-T8 测试铁律（真实 LLM 调用、真实场景数据、不跳过验证、不 Mock 工具、采集完整指标、LLM 生成内容经 LLM 审核、Web 功能操控浏览器验证 DOM）

## 4. 依赖

- **Evolved from**: 无
- **Blocked by**: F009（工具中介，工具调用结果作为证据来源）
- **Related**: F002（TeamAct Evidence 步骤 + 五项终止条件 `evidence_attached`）、F008（Durable State Surface，证据持久化）、F011（治理边界，证据内容 check_violation）、F012（魔法词，证据文本中检测逃生舱）、F013（熵控 + 可驾驭性评分，`evidence_completeness` 维度）

## 5. 风险

| 风险 | 缓解 |
|------|------|
| `difflib.SequenceMatcher` 对长文本性能差 | P2 阶段引入分块或向量化相似度 |
| `verify` 未强制非作者约束（仅靠调用方传 verifier） | P2 阶段引入 `verifier != source` 断言 |
| 证据内容可能含敏感信息（密钥/路径） | 上游 F011 GovernanceBoundary 拦截；证据 content 走 Repository 层持久化（铁律 4） |
| cross-check ratio 阈值静态写死 | P2 阶段由 Loop 配置注入（与质量分阈值 0.85 同套机制） |

## 6. Open Questions

| # | 问题 | 状态 |
|---|------|------|
| OQ-1 | `evidence_type` 是否需要枚举化（commit/test/trace/screenshot）？ | ⬜ 未定 |
| OQ-2 | cross-check 是否需要支持多证据两两比对（O(n²)）？ | ⬜ 未定 |
| OQ-3 | 证据是否需要 TTL（与 F013 EntropyController 配套）？ | ⬜ 未定 |

## 7. Key Decisions

| # | 决策 | 理由 | 日期 |
|---|------|------|------|
| KD-1 | 证据"先记录后验证"（record-then-verify） | 未验证不算入验收，强制 review pipeline | 2026-07-21 |
| KD-2 | `cross_check` 用 `difflib.SequenceMatcher` | 标准库零依赖，确定性 ratio | 2026-07-21 |
| KD-3 | `evidence_id` 用 `uuid.uuid4().hex` | 全局唯一，跨 session 不冲突 | 2026-07-21 |
| KD-4 | `list_unverified` 暴露待验证证据 | review pipeline 可轮询 | 2026-07-21 |

## 8. Timeline

| 日期 | 事件 |
|------|------|
| 2026-07-21 | 立项，确立 Evidence Sensors Feature 规格，对齐 ADR-007 Layer 3 与 `flowforge/core/harness/evidence_sensors.py` P1 实现 |

## 9. Review Gate

- Phase A: 单元测试通过，cross-check ratio 边界值（0.0/1.0）由架构师Forgekin review
- Phase B: E2E 测试由跨厂商 reviewer Forgekin review，跨厂商 review 一致性达标

## 10. Links

| 类型 | 路径 | 说明 |
|------|------|------|
| **ADR** | `docs/decisions/007-harness-engineering.md` | Harness 工程路径决策（七层） |
| **roleagent** | `docs/roleagent.md#第3章` | Harness 七层白皮书（Layer 3：验证现实） |
| **代码** | `flowforge/core/harness/evidence_sensors.py` | EvidenceCollector P1 实现 |
| **Feature** | `docs/features/F002-teamact-loop.md` | TeamAct Evidence 步骤 + 五项终止条件 |
| **Feature** | `docs/features/F001-capability-profile.md` | 能力画像（跨厂商 review 配对依据） |
| **Feature** | `docs/features/F013-entropy-harnessability.md` | 熵控 + 可驾驭性评分（`evidence_completeness` 维度） |
