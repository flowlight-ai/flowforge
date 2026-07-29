---
feature_ids: [F011]
related_features: [F002, F008, F009, F010, F012, F013]
topics: [harness, governance, compression-immune, rules, boundary]
doc_kind: spec
created: 2026-07-21
---

# F011: 治理边界（Governance Boundary）

> **状态**: spec | **负责人**: 架构师Forgekin | **优先级**: P0
> **依赖 ADR**: [doc:decisions/007-harness-engineering.md]
> **依据**: operator 7 条不可妥协原则 + roleagent.md 第 3 章 Harness 七层（Layer 4）
> **关联 VISION**: [doc:VISION.md#6]（operator 原则第 6 条：支持自己开发自己）

## 1. 上下文

### 1.1 问题陈述

`[doc:roleagent.md#第3章]` 指出：长任务跑久了，压缩不理解什么是治理规则。roleagent.md 早期教训明确："user message prepend 的规则每压缩一次丢一次"——Cat Café 团队被迫十轮对话教十次传球。治理规则如果作为文本进入 LLM prompt context，就会被上下文压缩吞掉，正是历史踩过的坑。

FlowForge 需要一个**压缩免疫的治理边界**：治理规则作为结构化 `GovernanceRule` 对象在程序侧检查，**永不进入 LLM prompt context**。这是 Harness 七层的第 4 层——约束现实，让治理规则在压缩下存活。

### 1.2 当前痛点

- *Forge 项目中治理规则写在 prompt 里，被压缩后Forgekin"忘记"规则
- 治理规则无统一存储，散落在各 Agent 的 system prompt 中
- 规则违反无客观检测机制，靠Forgekin自评
- 子串匹配可能误判（如"force"出现在合法描述中），缺少结构化 action schema

### 1.3 不做的影响

- 治理规则在长任务中被压缩吞掉，Forgekin行为失控
- 不可逆操作无外部边界，Forgekin可执行危险动作
- 规则违反无法追溯，事故无法追查
- "自己开发自己"闭环无法达成——开发过程必须受治理边界约束

## 2. 决策

### 2.1 核心设计

- `GovernanceRule`：结构化规则对象（`rule_id` / `description` / `severity` / `created_at`），**永不序列化进 prompt**
- `GovernanceViolation`：检测到的违规对象（`rule_id` / `action` / `message` / `timestamp`）
- `GovernanceBoundary.add_rule(rule_id, description, severity)`：注册规则，`rule_id` 重复抛 `HarnessError`
- `GovernanceBoundary.check_violation(action)`：case-insensitive 子串匹配，返回 `list[GovernanceViolation]`
- **关键设计**：治理规则作为结构化对象在程序侧检查，**不进入 LLM prompt context**——这就是压缩免疫的实现路径
- `description` 同时作为禁用短语（双重职责）：保持 matcher 简单确定性，不涉及 LLM 判断
- 规则通过 system role 注入（不是 user message prepend），与 F002 AC-A6 对齐

### 2.2 关键接口

```python
"""Governance Boundary — compression-immune rule store (roleagent.md Ch.7).

Layer 4 of the Harness seven-layer guardrail. Governance rules live as
structured ``GovernanceRule`` objects and are checked programmatically by
``check_violation`` — they NEVER enter the LLM prompt context, so they
cannot be compressed away or ignored by context-window pressure.
"""

from dataclasses import dataclass
from datetime import datetime, timezone

from flowforge.core.errors import HarnessError


@dataclass
class GovernanceRule:
    """One governance rule. Stored structurally — never serialized into prompts."""

    rule_id: str
    description: str
    severity: str
    created_at: datetime


@dataclass
class GovernanceViolation:
    """A detected violation of a governance rule."""

    rule_id: str
    action: str
    message: str
    timestamp: datetime


class GovernanceBoundary:
    """Compression-immune governance boundary.

    Rules are stored as structured ``GovernanceRule`` objects and checked by
    ``check_violation`` programmatically. Because they never appear in prompt
    context, an LLM cannot elide them during context compression.

    ``check_violation`` does a case-insensitive substring match: if a rule's
    ``description`` appears inside the ``action`` text, that rule is flagged.
    The description thus doubles as the forbidden phrase — keeping the matcher
    simple and deterministic (no LLM judgement involved).
    """

    def __init__(self) -> None:
        self._rules: dict[str, GovernanceRule] = {}

    def add_rule(
        self,
        rule_id: str,
        description: str,
        severity: str,
    ) -> None:
        if not rule_id:
            raise HarnessError("rule_id must be non-empty")
        if rule_id in self._rules:
            raise HarnessError(f"rule {rule_id!r} already exists")
        self._rules[rule_id] = GovernanceRule(
            rule_id=rule_id,
            description=description,
            severity=severity,
            created_at=datetime.now(timezone.utc),
        )

    def check_violation(self, action: str) -> list[GovernanceViolation]:
        """Return one ``GovernanceViolation`` per rule whose description is in ``action``."""
        if not action:
            return []
        action_lower = action.lower()
        now = datetime.now(timezone.utc)
        violations: list[GovernanceViolation] = []
        for rule in self._rules.values():
            if not rule.description:
                continue
            if rule.description.lower() in action_lower:
                violations.append(
                    GovernanceViolation(
                        rule_id=rule.rule_id,
                        action=action,
                        message=(
                            f"action violates rule {rule.rule_id!r}: "
                            f"{rule.description}"
                        ),
                        timestamp=now,
                    )
                )
        return violations
```

## 3. 验收标准

### Phase A（规则存储 + 压缩免疫）

- [ ] AC-A1: `GovernanceRule` 数据类含 4 字段（`rule_id` / `description` / `severity` / `created_at`）
- [ ] AC-A2: `GovernanceViolation` 数据类含 4 字段（`rule_id` / `action` / `message` / `timestamp`）
- [ ] AC-A3: `add_rule(rule_id, description, severity)` 注册规则，`rule_id` 为空或重复抛 `HarnessError`
- [ ] AC-A4: `check_violation(action)` case-insensitive 子串匹配，返回 `list[GovernanceViolation]`
- [ ] AC-A5: `action` 为空字符串返回空列表
- [ ] AC-A6: `description` 为空字符串的规则不参与匹配（`continue`）
- [ ] AC-A7: **治理规则永不进入 LLM prompt context**（压缩免疫铁律，代码审查 + T7 LLM 审核验证）

### Phase B（system role 注入 + E2E）

- [ ] AC-B1: 治理规则通过 system role 注入（不是 user message prepend），与 F002 AC-A6 对齐
- [ ] AC-B2: `check_violation` 在工具调用前（F009）、证据记录前（F010）执行
- [ ] AC-B3: 规则配置驱动（YAML），与项目规则"配置驱动优先"对齐
- [ ] AC-B4: E2E 测试 — Forgekin尝试执行含禁用短语的动作，`check_violation` 返回违规，动作被拦截
- [ ] AC-B5: E2E 测试 — 长任务跨多轮对话压缩后，治理规则仍生效（压缩免疫验证）
- [ ] AC-B6: 遵守 T1-T8 测试铁律（真实 LLM 调用、真实场景数据、不跳过验证、不 Mock 工具、采集完整指标、LLM 生成内容经 LLM 审核、Web 功能操控浏览器验证 DOM）

## 4. 依赖

- **Evolved from**: 无
- **Blocked by**: 无（治理边界是 Harness 第 4 层，独立检查）
- **Related**: F002（TeamAct，治理规则通过 system role 注入）、F008（Durable State Surface，规则持久化）、F009（工具中介，工具调用前 check_violation）、F010（证据传感器，证据内容 check_violation）、F012（魔法词，治理协议本身不触发逃生舱）、F013（熵控 + 可驾驭性评分，`governance_rule_count` 维度，`GOVERNANCE_FULL_RULE_COUNT=5`）

## 5. 风险

| 风险 | 缓解 |
|------|------|
| 子串匹配可能误判（如"force"出现在合法描述中） | P2 阶段引入结构化 action schema，匹配从 substring 升级为字段精确比对 |
| `description` 双重职责（描述 + 禁用短语）可能让规则描述不自然 | P2 阶段分离 `description` 与 `forbidden_phrase` 字段 |
| 规则数量膨胀后 `check_violation` O(n) 扫描 | 规则数 < 100 时无性能问题；P2 可引入 Aho-Corasick 多模式匹配 |
| `severity` 字段未枚举化 | P2 阶段引入 `Severity` 枚举（INFO/WARN/ERROR/FATAL） |

## 6. Open Questions

| # | 问题 | 状态 |
|---|------|------|
| OQ-1 | `severity` 是否需要枚举化？默认值是什么？ | ⬜ 未定 |
| OQ-2 | `check_violation` 是否需要支持正则匹配（而非纯子串）？ | ⬜ 未定 |
| OQ-3 | 规则违反后是否需要自动触发 F012 MagicWordAction.ESCALATE？ | ⬜ 未定 |

## 7. Key Decisions

| # | 决策 | 理由 | 日期 |
|---|------|------|------|
| KD-1 | 治理规则永不进入 LLM prompt context | 压缩免疫，吸取"user message prepend 被压缩吞掉"历史教训 | 2026-07-21 |
| KD-2 | `description` 双重职责（描述 + 禁用短语） | 保持 matcher 简单确定性，不涉及 LLM 判断 | 2026-07-21 |
| KD-3 | case-insensitive 子串匹配 | 简单可预测，P2 升级为结构化 action schema | 2026-07-21 |
| KD-4 | `check_violation` 返回 `list`（而非抛异常） | 一次 action 可能违反多条规则，调用方决策处置 | 2026-07-21 |

## 8. Timeline

| 日期 | 事件 |
|------|------|
| 2026-07-21 | 立项，确立 Governance Boundary Feature 规格，对齐 ADR-007 Layer 4 与 `flowforge/core/harness/governance.py` P1 实现 |

## 9. Review Gate

- Phase A: 单元测试通过，压缩免疫铁律（规则不进 prompt）由架构师Forgekin review + T7 LLM 审核
- Phase B: E2E 测试由跨厂商 reviewer Forgekin review，长任务压缩后规则仍生效

## 10. Links

| 类型 | 路径 | 说明 |
|------|------|------|
| **ADR** | `docs/decisions/007-harness-engineering.md` | Harness 工程路径决策（七层） |
| **roleagent** | `docs/roleagent.md#第3章` | Harness 七层白皮书（Layer 4：约束现实） |
| **代码** | `flowforge/core/harness/governance.py` | GovernanceBoundary P1 实现 |
| **Feature** | `docs/features/F002-teamact-loop.md` | TeamAct（治理规则通过 system role 注入） |
| **Feature** | `docs/features/F009-tool-mediation.md` | 工具中介（工具调用前 check_violation） |
| **Feature** | `docs/features/F013-entropy-harnessability.md` | 熵控 + 可驾驭性评分（`governance_rule_count` 维度） |
| **规则** | `docs/project_rules.md#铁律5` | 禁止硬编码路径和密钥（规则配置驱动） |
