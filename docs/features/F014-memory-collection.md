---
feature_ids: [F014]
related_features: [F015, F016, F017]
topics: [memory, multi-domain, episodic, semantic, procedural, shared, forge-codex]
doc_kind: spec
created: 2026-07-21
---

# F014: 记忆收集与多域存储（Memory Collection + Multi-Domain Storage）

> **状态**: spec | **负责人**: 架构师Forgekin | **优先级**: P0
> **依赖 ADR**: [doc:decisions/008-memory-federation.md]
> **依据**: operator 7 条不可妥协原则 + roleagent.md 第4章 多域记忆联邦
> **关联 VISION**: [doc:VISION.md#3]（持续身份：SoulImprint + EchoStore）

## 1. 上下文

### 1.1 问题陈述

`[doc:roleagent.md#第4章]` 指出："项目记忆首先不是语义召回问题，而是现实导航问题"——单池记忆（single-pool memory）把决策、教训、spec、个人上下文、外部资料混进一个向量库，丢失了项目知识最重要的工程属性：文件路径、行号、权威等级、文档类型、决策权威、上下文关系。

FlowForge（flowlight-ai/flowforge 新仓库）需要一个**多域记忆联邦基底**：把不同性质的知识放进不同记忆域，由统一的 `MemoryCollection` 提供联邦底层，使上层三检索入口（F015）、消费加权排序（F016）、治理与MindCodex（F017）能在同一基底上协同工作。

### 1.2 当前痛点

- **单池混存**：决策、教训、spec、个人上下文、外部资料混在一个向量库，无法区分权威性与归属
- **无域隔离**：情景事件与程序技能同池，检索信号互相污染
- **无消费反馈**：知识被搜到后有没有读、有没有用，系统完全不知道
- **跨域不联邦**：项目仓库、个人上下文、专业资料库之间的知识不会自然联邦

### 1.3 不做的影响

- 能力画像（CapabilityProfile）退化为静态简历，违反 operator "画像必须有记忆系统支撑"指示
- 三检索入口（F015）无基底可挂载，消费加权（F016）无 access_count 信号源
- 治理层（F017）无 collection 可治理，记忆系统无限膨胀
- 违反 `[doc:roleagent.md#第4章]` "RAG 输给 grep" 论断——继续沿用单池向量 RAG 路线

## 2. 决策

### 2.1 核心设计

落地五大记忆域 + 双索引 MemoryCollection + 经验记忆存储（EchoStore）形态：

- **五大记忆域**（`MemoryDomain` 枚举）：EPISODIC（情景/经验，对应EchoStore）/ SEMANTIC（语义）/ PROCEDURAL（程序）/ SHARED（共享）/ FORGE_CODEX（元认知，对应MindCodex，详见 F017）
- **MemoryEntry 最小记录单元**：携带 `content` / `domain` / `entry_id` / `tags` / `created_at` / `last_accessed` / `access_count` / `importance` 八字段
- **双索引 MemoryCollection**：`_by_id` / `_by_domain` / `_by_tag` 三套索引同步维护，O(1) 查找
- **importance clamp**：`add()` 时强制 `importance ∈ [0.0, 1.0]`
- **touch() 消费反馈**：retriever 命中时调用 `entry.touch()` 更新 `last_accessed` 与 `access_count`，作为 F016 消费加权的根信号源
- **纯 Python**：无 LLM、无外部 embedding 依赖，记忆基底可在 P0 阶段稳定运行

### 2.2 关键接口

```python
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum


class MemoryDomain(str, Enum):
    """Top-level memory domain (记忆域)."""

    EPISODIC = "episodic"        # 经验记忆（Episodic Memory Store / EchoStore）
    SEMANTIC = "semantic"        # 语义记忆
    PROCEDURAL = "procedural"    # 程序记忆
    SHARED = "shared"            # 共享记忆
    FORGE_CODEX = "forge_codex"  # 方法论库索引（Forge Codex / MindCodex）


@dataclass
class MemoryEntry:
    """One memory record (记忆条目).

    importance is clamped to [0.0, 1.0] at add() time. access_count and
    last_accessed are bumped by retrievers via touch().
    """

    content: str
    domain: MemoryDomain = MemoryDomain.SEMANTIC
    entry_id: str = field(default_factory=lambda: f"mem-{uuid.uuid4().hex[:12]}")
    tags: list[str] = field(default_factory=list)
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    last_accessed: datetime | None = None
    access_count: int = 0
    importance: float = 0.5

    def touch(self) -> None:
        """Mark this entry as accessed (bump last_accessed + access_count)."""
        self.last_accessed = datetime.now(timezone.utc)
        self.access_count += 1


class MemoryCollection:
    """In-memory store of MemoryEntry records, indexed by entry_id.

    The collection is the federated substrate: any number of domains coexist,
    and the three retrieval entries operate over a single collection. Two
    secondary indices (domain, tag) are kept in sync for O(1) lookups.
    """

    def __init__(self) -> None:
        self._by_id: dict[str, MemoryEntry] = {}
        self._by_domain: dict[MemoryDomain, list[MemoryEntry]] = {}
        self._by_tag: dict[str, list[MemoryEntry]] = {}

    def add(self, entry: MemoryEntry) -> str:
        """Add a memory entry; returns the entry_id.

        Raises MemoryError on empty content or duplicate entry_id.
        importance is clamped into [0.0, 1.0].
        """
        ...

    def get(self, entry_id: str) -> MemoryEntry:
        """Return the entry with entry_id; touches access metadata.

        Raises MemoryError if not found.
        """
        ...

    def list_by_domain(self, domain: str) -> list[MemoryEntry]:
        """Return all entries whose domain matches the given value."""
        ...

    def list_by_tags(self, tags: list[str]) -> list[MemoryEntry]:
        """Return entries matching ANY of the given tags (deduplicated)."""
        ...

    def count(self) -> int: ...
    def all(self) -> list[MemoryEntry]: ...

    def remove(self, entry_id: str) -> MemoryEntry:
        """Remove and return the entry; rebuilds domain/tag indices."""
        ...

    def clear(self) -> None: ...
```

`MemoryDomain.EPISODIC` 域的运行时形态即**EchoStore**（经验记忆存储）——承载"什么时候发生了什么"的事件型记忆。`MemoryDomain.FORGE_CODEX` 域由 F017 的 `MindCodex`（MindCodex）独立承载，详见 [doc:features/F017-memory-governance-mind-codex.md]。

## 3. 验收标准

### Phase A（基底实现）

- [ ] AC-A1: `MemoryDomain` 枚举包含五个成员（EPISODIC / SEMANTIC / PROCEDURAL / SHARED / FORGE_CODEX），字符串值分别为 `episodic` / `semantic` / `procedural` / `shared` / `forge_codex`
- [ ] AC-A2: `MemoryEntry` 八字段齐全（content / domain / entry_id / tags / created_at / last_accessed / access_count / importance），`entry_id` 默认 `mem-{uuid4 hex[:12]}` 格式
- [ ] AC-A3: `MemoryEntry.touch()` 同时更新 `last_accessed`（UTC now）与 `access_count`（+1）
- [ ] AC-A4: `MemoryCollection` 维护 `_by_id` / `_by_domain` / `_by_tag` 三套索引，`add()` 同步更新三索引
- [ ] AC-A5: `add()` 对 `importance` 执行 clamp 到 `[0.0, 1.0]`；空 content 或重复 `entry_id` 抛 `MemoryError`
- [ ] AC-A6: `get()` 命中时调用 `entry.touch()` 回写消费信号；未命中抛 `MemoryError`
- [ ] AC-A7: `list_by_domain()` 同时接受字符串与 `MemoryDomain` 枚举（因 `MemoryDomain` 继承自 `str`）
- [ ] AC-A8: `list_by_tags()` 执行 ANY 匹配且去重（按 `entry_id`）
- [ ] AC-A9: `remove()` 重建 domain/tag 索引，不留悬空引用
- [ ] AC-A10: 模块为纯 Python，无 LLM / 无外部 embedding 依赖；日志通过 `flowforge.core.tracing.get_logger` 注入 `trace_id`

### Phase B（联邦集成 + E2E）

- [ ] AC-B1: EchoStore 形态（EPISODIC 域）可独立验证——同一 collection 内五域共存不互相污染
- [ ] AC-B2: `add()` / `get()` / `remove()` / `clear()` 延迟 < 5ms（千级 collection）
- [ ] AC-B3: 索引一致性——`count()` 与 `_by_domain` 各域总和、`_by_tag` 计数一致
- [ ] AC-B4: E2E 测试——Forgekin协作过程中真实写入 EPISODIC 记忆，跨Forgekin通过 SHARED 域联邦共享
- [ ] AC-B5: 遵守 T1-T8 测试铁律（真实 LLM 调用、真实场景数据、不跳过验证、不 Mock 工具、采集完整指标、LLM 生成内容经 LLM 审核、Web 功能操控浏览器验证 DOM）
- [ ] AC-B6: 所有日志携带 `trace_id`，可通过 tracing 层关联检索/治理/排序全链路

## 4. 依赖

- **Evolved from**: 无
- **Blocked by**: 无
- **Related**: F015（三检索入口，挂载在 MemoryCollection 上）、F016（消费加权排序，消费 `access_count` / `last_accessed` 信号）、F017（治理与MindCodex，操作 collection + FORGE_CODEX 域由 MindCodex 承载）

## 5. 风险

| 风险 | 缓解 |
|------|------|
| `MemoryCollection` in-memory 重启即丢 | P1 阶段可接受，P2 通过 markdown 真相源 + 索引重建恢复 |
| `importance` 单维度无法承载完整权威等级 | 当前为 P1 简化形态，P2 演进为 authority / activation / status 三维元数据 |
| 三索引同步在并发写入下可能不一致 | 当前单线程 async，P2 演进为 async lock 或 actor 模型 |
| `access_count` 是 proxy 信号（部分文件读取未计入） | 诚实标注为趋势反馈阶段，`outputVerified` 强信号为后续演进项 |
| 跨域联邦权限过滤尚未实现 | 当前单 collection 内分域，P2 演进多 collection + 权限/敏感级别过滤 |

## 6. Open Questions

| # | 问题 | 状态 |
|---|------|------|
| OQ-1 | `MemoryEntry` 是否需要增加 `source_path` 字段承载文件路径/行号？ | ⬜ 未定（P2 演进项） |
| OQ-2 | `MemoryCollection` 是否需要支持持久化快照（markdown / sqlite）？ | ⬜ 未定（P2 演进项） |
| OQ-3 | FORGE_CODEX 域是否应直接由 MindCodex 承载而非通过 MemoryCollection？ | 🟡 已定：MindCodex 独立承载，详见 F017 |

## 7. Key Decisions

| # | 决策 | 理由 | 日期 |
|---|------|------|------|
| KD-1 | 五大记忆域（EPISODIC / SEMANTIC / PROCEDURAL / SHARED / FORGE_CODEX） | `[doc:roleagent.md#第4章]` 主张 + ADR-008 §2.1 | 2026-07-21 |
| KD-2 | EchoStore = MemoryCollection 中 EPISODIC 域运行时形态 | 术语对齐 ADR-012，避免新增独立类 | 2026-07-21 |
| KD-3 | `touch()` 由 retriever 命中时调用，回写 `last_accessed` + `access_count` | 形成 F016 消费加权闭环根信号 | 2026-07-21 |
| KD-4 | `importance` 在 `add()` 时 clamp 到 `[0.0, 1.0]` | 防止脏数据污染 F016 加权公式 | 2026-07-21 |
| KD-5 | 纯 Python + 无外部 embedding 依赖 | P0 阶段稳定运行，向量索引作为 P2 编译层可插拔替换 | 2026-07-21 |
| KD-6 | FORGE_CODEX 域由 F017 MindCodex 独立承载，不写入 MemoryCollection | MindCodex承载 ForgeMethod 结构化记录，与扁平 MemoryEntry 形态不同 | 2026-07-21 |

## 8. Timeline

| 日期 | 事件 |
|------|------|
| 2026-07-21 | 立项，确立 F014 记忆收集与多域存储 Feature 规格，术语对齐项目正式命名（EchoStore） |

## 9. Review Gate

- Phase A: 单元测试通过，`MemoryCollection` / `MemoryEntry` / `MemoryDomain` 由架构师Forgekin review，验证三索引同步与 `touch()` 反馈闭环
- Phase B: E2E 测试由跨厂商 reviewer Forgekin review，验证EchoStore 跨Forgekin联邦共享与五域共存不污染

## 10. Links

| 类型 | 路径 | 说明 |
|------|------|------|
| **ADR** | `docs/decisions/008-memory-federation.md` | 多域记忆联邦决策 |
| **ADR** | `docs/decisions/012-naming-fusion.md` | 命名融合（EchoStore / MindCodex 术语表） |
| **Feature** | `docs/features/F015-retrieval-entries.md` | 三检索入口挂载在 MemoryCollection 上 |
| **Feature** | `docs/features/F016-consumption-weighted.md` | 消费加权排序消费 access_count 信号 |
| **Feature** | `docs/features/F017-memory-governance-mind-codex.md` | 治理与MindCodex（FORGE_CODEX 域） |
| **Code** | `flowforge/core/memory/collection.py` | MemoryDomain / MemoryEntry / MemoryCollection 实现 |
| **VISION** | `docs/VISION.md#3` | 持续身份：SoulImprint + EchoStore |
| **roleagent** | `docs/roleagent.md#第4章` | 多域记忆联邦 |
