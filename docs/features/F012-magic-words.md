---
feature_ids: [F012]
related_features: [F002, F008, F009, F010, F011, F013]
topics: [harness, magic-words, escape-hatch, kill-switch, human-loop]
doc_kind: spec
created: 2026-07-21
---

# F012: Magic Words（魔法词 / 逃生舱）

> **状态**: spec | **负责人**: 架构师Forgekin | **优先级**: P0
> **依赖 ADR**: [doc:decisions/007-harness-engineering.md]
> **依据**: operator 7 条不可妥协原则 + roleagent.md 第 3 章 Harness 七层（Layer 5）
> **关联 VISION**: [doc:VISION.md#6]（operator 原则第 6 条：支持自己开发自己）

## 1. 上下文

### 1.1 问题陈述

`[doc:roleagent.md#第3章]` 指出：模型没有稳定的"我现在不该继续"自觉，不可逆操作必须有外部边界。Runtime 逃生舱让人类用极低带宽打断Forgekin的错误轨迹——一句话就能 halt / pause / escalate / rollback，无需理解Forgekin内部状态。

FlowForge 需要一个**魔法词注册表**：中英双语词表，任一 Harness 层都可监听；检测到魔法词时返回 `DetectedMagicWord`（含 `position` 与 ±20 字符 `context`），供人工复核。这是 Harness 七层的第 5 层——人机边界，让 operator 极低带宽干预。

### 1.2 当前痛点

- Forgekin跑偏时，operator 必须理解内部状态才能干预，干预成本高
- 没有统一的"停止/暂停/升级/回滚"词表，各 Agent 自定义
- 复述历史短语可能误触逃生舱（如Forgekin复述用户之前的"暂停"指令）
- 与 `flowforge.forgemind.magic_words`（CVO 中断协议）职责重叠，未明确区分

### 1.3 不做的影响

- Forgekin错误轨迹无法低带宽打断，operator 必须全程盯盘
- 不可逆操作无人工确认边界，事故无法挽回
- 逃生舱词表散落，维护成本高
- "自己开发自己"闭环无法达成——开发过程必须可被 operator 随时打断

## 2. 决策

### 2.1 核心设计

- `MagicWordAction` 枚举：`HALT` / `PAUSE` / `ESCALATE` / `ROLLBACK`（4 种动作）
- `DEFAULT_MAGIC_WORDS`：双语词表（11 条），覆盖中英文
  - HALT: "stop" / "停止" / "halt" / "中止" / "abort"
  - PAUSE: "pause" / "暂停"
  - ESCALATE: "escalate" / "升级"
  - ROLLBACK: "rollback" / "回滚"
- `DetectedMagicWord`：检测结果（frozen dataclass），含 `word` / `action` / `position` / `context`（±20 字符）
- `MagicWordsRegistry.with_defaults()`：预装默认词表
- `MagicWordsRegistry.register_word(word, action)`：扩展词表
- `MagicWordsRegistry.detect(text)`：返回 `list[DetectedMagicWord]`，每个词报告首次出现位置
- `MagicWordsRegistry.list_words()`：列出所有已注册词
- **关键约束**：仅在当前 CVO 指令中触发，复述历史中的短语不触发——避免治理协议本身变成误触源
- **职责区分**：此 registry 是 harness 层任一层都可监听的逃生舱，区别于 `flowforge.forgemind.magic_words`（CVO 中断协议）

### 2.2 关键接口

```python
"""Magic Words — escape-hatch / kill-switch registry (roleagent.md Ch.7).

Layer 5 of the Harness seven-layer guardrail. Distinct from
``flowforge.forgemind.magic_words`` (the CVO interrupt protocol): this
module is the harness-level escape hatch that any layer can monitor for.
Supports bilingual (Chinese + English) trigger phrases.
"""

from dataclasses import dataclass
from enum import Enum

from flowforge.core.tracing import get_logger


class MagicWordAction(str, Enum):
    """Action triggered when a magic word is detected."""

    HALT = "halt"
    PAUSE = "pause"
    ESCALATE = "escalate"
    ROLLBACK = "rollback"


@dataclass(frozen=True)
class DetectedMagicWord:
    """One detected occurrence of a registered magic word."""

    word: str
    action: MagicWordAction
    position: int
    context: str


# Default bilingual escape-hatch words. Callers may register more via
# ``register_word`` or build a pre-loaded registry via ``with_defaults``.
DEFAULT_MAGIC_WORDS: dict[str, MagicWordAction] = {
    "stop": MagicWordAction.HALT,
    "停止": MagicWordAction.HALT,
    "halt": MagicWordAction.HALT,
    "中止": MagicWordAction.HALT,
    "abort": MagicWordAction.HALT,
    "pause": MagicWordAction.PAUSE,
    "暂停": MagicWordAction.PAUSE,
    "escalate": MagicWordAction.ESCALATE,
    "升级": MagicWordAction.ESCALATE,
    "rollback": MagicWordAction.ROLLBACK,
    "回滚": MagicWordAction.ROLLBACK,
}


class MagicWordsRegistry:
    """Escape-hatch word registry. Supports Chinese and English phrases."""

    def __init__(self) -> None:
        self._words: dict[str, MagicWordAction] = {}

    @classmethod
    def with_defaults(cls) -> "MagicWordsRegistry":
        """Build a registry pre-loaded with ``DEFAULT_MAGIC_WORDS``."""
        registry = cls()
        for word, action in DEFAULT_MAGIC_WORDS.items():
            registry.register_word(word, action)
        return registry

    def register_word(self, word: str, action: MagicWordAction) -> None:
        if not word:
            return
        self._words[word] = action

    def detect(self, text: str) -> list[DetectedMagicWord]:
        """Return one ``DetectedMagicWord`` per registered word present in ``text``.

        For each word, the first occurrence's position and surrounding context
        (±20 chars) are reported. Words not present are omitted.
        """
        if not text:
            return []
        detections: list[DetectedMagicWord] = []
        for word, action in self._words.items():
            idx = text.find(word)
            if idx < 0:
                continue
            start = max(0, idx - 20)
            end = min(len(text), idx + len(word) + 20)
            context = text[start:end]
            detections.append(
                DetectedMagicWord(
                    word=word,
                    action=action,
                    position=idx,
                    context=context,
                )
            )
        return detections

    def list_words(self) -> list[str]:
        return list(self._words.keys())
```

## 3. 验收标准

### Phase A（词表 + 检测原语）

- [ ] AC-A1: `MagicWordAction` 枚举含 4 值（`HALT` / `PAUSE` / `ESCALATE` / `ROLLBACK`），继承 `str, Enum`
- [ ] AC-A2: `DEFAULT_MAGIC_WORDS` 含 11 条双语词表（HALT 5 条 / PAUSE 2 条 / ESCALATE 2 条 / ROLLBACK 2 条）
- [ ] AC-A3: `DetectedMagicWord` frozen dataclass 含 4 字段（`word` / `action` / `position` / `context`）
- [ ] AC-A4: `with_defaults()` 预装 `DEFAULT_MAGIC_WORDS` 全部 11 条
- [ ] AC-A5: `register_word(word, action)` 空字符串静默跳过（不抛异常）
- [ ] AC-A6: `detect(text)` 对每个已注册词报告首次出现位置，`context` 为 ±20 字符
- [ ] AC-A7: `detect("")` 返回空列表；`detect(text)` 对未出现的词不报告

### Phase B（CVO 触发约束 + E2E）

- [ ] AC-B1: **仅在当前 CVO 指令中触发，复述历史中的短语不触发**（结构性约束，调用方传入当前指令文本）
- [ ] AC-B2: 检测日志 WARNING 级别，含 `word` / `action` / `pos`，供人工复核
- [ ] AC-B3: 与 `flowforge.forgemind.magic_words`（CVO 中断协议）职责明确区分（文档 + 代码注释）
- [ ] AC-B4: E2E 测试 — operator 输入"停止"，Forgekin HALT；输入"暂停"，Forgekin PAUSE；输入"升级"，Forgekin ESCALATE；输入"回滚"，Forgekin ROLLBACK
- [ ] AC-B5: E2E 测试 — Forgekin复述历史中的"暂停"不触发 PAUSE（仅当前 CVO 指令触发）
- [ ] AC-B6: 遵守 T1-T8 测试铁律（真实 LLM 调用、真实场景数据、不跳过验证、不 Mock 工具、采集完整指标、LLM 生成内容经 LLM 审核、Web 功能操控浏览器验证 DOM）

## 4. 依赖

- **Evolved from**: 无
- **Blocked by**: 无（魔法词是 Harness 第 5 层，独立检测）
- **Related**: F002（TeamAct Route 步骤，魔法词触发传球中断）、F008（Durable State Surface，魔法词触发 ROLLBACK 时恢复快照）、F009（工具中介，魔法词触发 HALT 时取消工具调用）、F010（证据传感器，魔法词触发 ESCALATE 时升级证据）、F011（治理边界，治理协议本身不触发魔法词）、F013（熵控 + 可驾驭性评分，`magic_word_coverage` 维度）

## 5. 风险

| 风险 | 缓解 |
|------|------|
| 默认词表可能与正常用户输入冲突 | 仅在 CVO 当前指令中触发；复述历史短语不触发；`detect` 返回 context 供人工复核 |
| `detect` 用 `str.find` 只报告首次出现 | P2 阶段可扩展为全部出现位置（`find` 循环） |
| 词表膨胀后 O(n) 扫描 | 词数 < 100 时无性能问题；P2 可引入 Aho-Corasick |
| 中英文混合文本 `position` 字符偏移 | Python `str` 按 Unicode 码点计数，中英文一致 |
| 与 `flowforge.forgemind.magic_words` 职责混淆 | 模块注释明确区分；本模块是 harness 层，forgemind 是 CVO 协议层 |

## 6. Open Questions

| # | 问题 | 状态 |
|---|------|------|
| OQ-1 | `detect` 是否需要支持全部出现位置（而非仅首次）？ | ⬜ 未定 |
| OQ-2 | 魔法词触发后是否需要自动调用 F008 `restore(snapshot_id)` 实现 ROLLBACK？ | ⬜ 未定 |
| OQ-3 | 词表是否需要支持正则匹配（如"停止.*任务"）？ | ⬜ 未定 |

## 7. Key Decisions

| # | 决策 | 理由 | 日期 |
|---|------|------|------|
| KD-1 | 4 种动作枚举（HALT/PAUSE/ESCALATE/ROLLBACK） | 覆盖 operator 低带宽干预场景 | 2026-07-21 |
| KD-2 | 双语词表（中英文 11 条） | operator 中英文混合输入场景 | 2026-07-21 |
| KD-3 | `DetectedMagicWord` frozen dataclass | 检测结果不可变，防篡改 | 2026-07-21 |
| KD-4 | 仅当前 CVO 指令触发，复述历史不触发 | 避免治理协议本身变成误触源 | 2026-07-21 |
| KD-5 | 与 `flowforge.forgemind.magic_words` 职责区分 | harness 层逃生舱 vs CVO 中断协议 | 2026-07-21 |

## 8. Timeline

| 日期 | 事件 |
|------|------|
| 2026-07-21 | 立项，确立 Magic Words Feature 规格，对齐 ADR-007 Layer 5 与 `flowforge/core/harness/magic_words.py` P1 实现 |

## 9. Review Gate

- Phase A: 单元测试通过，双语词表与检测原语由架构师Forgekin review
- Phase B: E2E 测试由跨厂商 reviewer Forgekin review，CVO 触发约束验证（复述历史不触发）

## 10. Links

| 类型 | 路径 | 说明 |
|------|------|------|
| **ADR** | `docs/decisions/007-harness-engineering.md` | Harness 工程路径决策（七层） |
| **roleagent** | `docs/roleagent.md#第3章` | Harness 七层白皮书（Layer 5：人机边界） |
| **代码** | `flowforge/core/harness/magic_words.py` | MagicWordsRegistry P1 实现 |
| **代码** | `flowforge/forgemind/magic_words.py` | CVO 中断协议（职责区分对象） |
| **Feature** | `docs/features/F008-durable-state-surface.md` | Durable State Surface（ROLLBACK 时恢复快照） |
| **Feature** | `docs/features/F013-entropy-harnessability.md` | 熵控 + 可驾驭性评分（`magic_word_coverage` 维度） |
