# ADR 008: 多域记忆联邦（Episodic Memory Federation）

> **状态**: accepted
> **日期**: 2026-07-21
> **决策者**: operator + 架构师灵智体
> **依赖**: `[doc:roleagent.md#第4章]` + `[doc:decisions/004-capability-profile-routing.md]` + `[doc:decisions/007-harness-engineering-path.md]`
> **依据**: operator 7 条不可妥协原则 + roleagent.md 多域记忆运行时工程路径

---

## 1. 上下文

`[doc:roleagent.md#第4章]` 指出："项目记忆首先不是语义召回问题，而是现实导航问题"——单池记忆（single-pool memory）把所有知识丢进一个向量库，丢失了项目知识最重要的工程属性：文件路径、行号、权威等级、文档类型、决策权威、上下文关系。

当前 FlowForge（flowlight-ai/flowforge 新仓库）在记忆层面临的具体问题：

- **单池混存**：决策、教训、spec、个人上下文、外部资料混在一个向量库，无法区分权威性与归属
- **检索入口单一**：只有语义检索，没有精确导航和零先验扫描，agent 在不同认知状态下共用一条路
- **无治理层**：知识只增不减，过期知识永远排在前面，矛盾知识无人解决
- **无消费反馈**：知识被搜到后有没有读、有没有用，系统完全不知道
- **跨域不联邦**：项目仓库、个人上下文、专业资料库之间的知识不会自然联邦

operator 指示（2026-07-21）：能力画像（CapabilityProfile）若没有记忆系统支撑，会退化成静态简历——必须建设多域记忆联邦，让灵智体（Forgekin）的画像随 eval 信号实时刷新。本 ADR 是 P1 决策，术语对齐项目正式命名（详见 `[doc:decisions/012-naming-fusion.md]`）。

---

## 2. 决策

### 2.1 五大记忆域

`[doc:roleagent.md#第4章]` 主张：知识边界从"一个项目仓库"扩展到多个知识域。FlowForge 在 `MemoryDomain` 枚举中落地五大记忆域：

| 域 | P0 名称 | P1 英文 | P2 体系别名 | 内容 |
|----|---------|---------|------------|------|
| 情景记忆 | 情景记忆 | Episodic Memory | 灵忆 EchoStore | 事件型记忆——"什么时候发生了什么" |
| 认知记忆 | 语义记忆 | Semantic Memory | — | 事实型记忆——"什么是真的" |
| 程序记忆 | 程序记忆 | Procedural Memory | — | 技能型记忆——"怎么做 X" |
| 社交记忆 | 共享记忆 | Shared Memory | — | 跨灵智体共享记忆 |
| 元认知记忆 | 方法论库索引 | Forge Codex | 灵典 MindCodex | 蒸馏方法库索引 |

```python
class MemoryDomain(str, Enum):
    EPISODIC = "episodic"        # 经验记忆（Episodic Memory Store / 灵忆 EchoStore）
    SEMANTIC = "semantic"        # 语义记忆
    PROCEDURAL = "procedural"    # 程序记忆
    SHARED = "shared"            # 共享记忆
    FORGE_CODEX = "forge_codex"  # 方法论库索引（Forge Codex / 灵典 MindCodex）
```

### 2.2 EchoStore（灵忆）— 经验记忆存储

经验记忆（Episodic Memory Store / 灵忆 EchoStore）是 `MemoryCollection` 中 `MemoryDomain.EPISODIC` 域的运行时形态。`MemoryEntry` 是其最小记录单元：

```python
@dataclass
class MemoryEntry:
    content: str
    domain: MemoryDomain = MemoryDomain.SEMANTIC
    entry_id: str = field(default_factory=lambda: f"mem-{uuid.uuid4().hex[:12]}")
    tags: list[str] = field(default_factory=list)
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    last_accessed: datetime | None = None
    access_count: int = 0
    importance: float = 0.5

    def touch(self) -> None:
        self.last_accessed = datetime.now(timezone.utc)
        self.access_count += 1
```

`MemoryCollection` 维护三套索引（`_by_id` / `_by_domain` / `_by_tag`），通过 `add()` / `get()` / `list_by_domain()` / `list_by_tags()` / `remove()` / `clear()` 提供联邦基底。`importance` 在 `add()` 时被 clamp 到 `[0.0, 1.0]`。

### 2.3 MindCodex（灵典）— 蒸馏知识库

蒸馏知识库（Forge Codex / 灵典 MindCodex）是元认知记忆域的独立实现，承载 `ForgeMethod`（灵法）——从经验中蒸馏出的可复用方法论：

```python
@dataclass
class ForgeMethod:
    name: str
    domain: str
    description: str = ""
    steps: list[str] = field(default_factory=list)
    preconditions: list[str] = field(default_factory=list)
    postconditions: list[str] = field(default_factory=list)
    evidence: list[str] = field(default_factory=list)
    usage_count: int = 0
    success_rate: float = 0.0  # 0.0..1.0
```

`MindCodex` 通过 `add_method()` 注册方法、`search(query, top_k)` 按关键词检索（基于 name + description + steps 的子串计数排序）、`list_by_domain()` 按域列出。`success_rate` 在 `add_method()` 时 clamp 到 `[0.0, 1.0]`，由调用方在 loop replay 后更新。MindCodex 是纯 Python、无 LLM、无外部 embedding 依赖，对应 `MemoryDomain.FORGE_CODEX` 域。

### 2.4 三检索入口

`[doc:roleagent.md#第4章]` 指出三种认知模式走不同路。FlowForge 在 `retrieval_entries.py` 中落地三个独立 retriever，全部 async、全部在命中时调用 `MemoryEntry.touch()` 回写消费信号：

| 入口 | roleagent.md 名称 | 实现类 | 算法 | 适用场景 |
|------|-------------------|--------|------|----------|
| 精确导航 | graph_resolve | `GrepRetriever` | 子串匹配（case-insensitive） | 知道要找什么——feature 编号、决策锚点 |
| 语义搜索 | search_evidence | `SemanticRetriever` | TF-IDF 余弦相似度（smoothed IDF） | 知道方向但不知道确切锚点 |
| 零先验扫描 | list_recent | `IndexRetriever` | 标签索引 ANY 匹配 | 按标签展开上下文 |

`SemanticRetriever` 使用 sklearn 风格的 smoothed IDF 公式 `log((1+n)/(1+df)) + 1`，确保高频词仍保留非零权重。`RetrievalResult` 数据类携带 `entry` / `score` / `matched_by` 三元组，提供检索来源溯源。

### 2.5 权威等级（authoritative tiers）

`[doc:roleagent.md#第4章]` F163 提出三类治理元数据：权威性（authority）、触发方式（activation）、生命周期（status）。FlowForge 当前在 `MemoryEntry.importance` 字段（`[0.0, 1.0]`）落地权威等级的简化形态，由 `MemoryGovernor` 通过 `RetentionPolicy.min_importance` 实施淘汰下限。完整 authority / activation / status 三维元数据为后续 P2 演进项。

### 2.6 消费加权排序（consumption-weighted ranking）

`[doc:roleagent.md#第4章]` 核心创新：用 agent 真实行为（revealed preference）判断知识价值，不用 LLM 自评打分。`ConsumptionWeightedRanker` 落地该原则，公式：

```
score = importance * 0.4 + recency * 0.3 + access_frequency * 0.2 + relevance * 0.1
recency          = 1.0 - min(age_seconds / 86400, 1.0)   # 24 小时衰减窗口
access_frequency = min(access_count / 10, 1.0)            # 10 次访问饱和
relevance        = query_context.get("relevance", 0.5)
```

`rank()` 是纯函数，不修改 collection，是检索管线最后一环：`collection → retriever → ConsumptionWeightedRanker → agent context`。`access_frequency` 来自 retriever 命中时调用的 `touch()`，形成消费反馈闭环。

### 2.7 冲突解决与衰减策略

`MemoryGovernor` 提供三个治理原语：

- **`apply_retention(collection, RetentionPolicy)`**：按 `max_entries` / `max_age_seconds` / `min_importance` 三重上限淘汰；淘汰顺序为低 importance 优先、次按 created_at 最旧优先
- **`apply_decay(collection, DecayPolicy)`**：对超过 `decay_interval_seconds`（默认 3600s）的条目按 `decay_rate`（默认 0.95）乘性衰减 importance，建模遗忘曲线
- **`detect_conflicts(collection)`**：按 `(domain, frozenset(tags))` 分组，组内多于一条即为冲突
- **`ConflictResolver.resolve(conflicting)`**：最高 importance 胜出；平局按 `created_at` 最新；再平局按 `entry_id` 字典序（确定性）

`RetentionPolicy` 与 `DecayPolicy` 为 `frozen=True` 数据类，可跨 collection 共享而不产生意外副作用。

---

## 3. 方案对比

| 方案 | 优点 | 缺点 |
|------|------|------|
| **方案 A（选定）: 多域记忆联邦 + 三检索入口 + 消费加权 + 治理层** | 符合 roleagent.md 第4章主张，权威等级与消费反馈分离，跨域联邦可扩展，纯 Python 无外部 embedding 依赖 | 实现复杂度高（五域 + 三入口 + 治理 + 排序），TF-IDF 在大规模 collection 上需替换为向量索引 |
| 方案 B: 单池向量 RAG | 实现简单，语义召回强 | 丢失权威等级 / 来源溯源 / 消费反馈，违反 roleagent.md "RAG 输给 grep" 论断 |
| 方案 C: 纯 grep + 文件系统 | 当前性强、可审计、零黑盒 | 无语义桥接、无跨域联邦、无消费反馈，天花板低 |
| 方案 D: LLM 在线打分排序 | 灵活、可解释 | 违反 roleagent.md "不用 LLM 自评打分"原则（自评集中在 0.6-0.85 成功区间，无负样本），延迟高、成本高 |

---

## 4. 理由

- operator 明确要求能力画像不能退化成静态简历，必须有记忆系统支撑
- `[doc:roleagent.md#第4章]` 明确指出"单池 RAG 在项目知识场景里输给 grep"，因为丢了文件路径、行号、权威等级、文档类型
- 消费加权排序用 revealed preference（agent 真实工具调用行为）替代 LLM 自评，根信号无系统偏差
- 三检索入口覆盖 agent 在不同认知状态下的需求：有上下文走精确、失上下文走扫描、探索性走语义
- `MemoryGovernor` 的 retention + decay + conflict 三原语让记忆系统不会无限膨胀，对应 roleagent.md 的熵增抑制
- 纯 Python + 无外部 embedding 依赖的设计让记忆基底可在 P0 阶段稳定运行，向量索引作为后续 P2 编译层可插拔替换
- 知识真相源仍是 markdown 文件，数据库和索引只是编译层——人类产品负责人可直接打开文件查看团队记忆

---

## 5. 风险

| 风险 | 缓解 |
|------|------|
| TF-IDF 在千级以上 collection 性能下降 | 当前 in-memory 设计为 P1 起步，P2 可替换为向量索引，`SemanticRetriever` 接口不变 |
| 消费信号 `access_count` 仍是 proxy（部分 carrier 文件读取未计入） | 诚实标注为趋势反馈阶段，`outputVerified` 强信号自动桥接为后续演进项 |
| 权威等级简化为 importance 单维 | 当前为 P1 简化形态，P2 演进为 authority / activation / status 三维元数据 |
| `MemoryCollection` in-memory 重启即丢 | P1 阶段可接受，P2 通过 markdown 真相源 + 索引重建恢复 |
| 冲突检测按 `(domain, frozenset(tags))` 可能误判 | `ConflictResolver` 仅在 governance 主动调用时触发，不阻塞正常检索 |
| 跨域联邦权限过滤尚未实现 | 当前单 collection 内分域，P2 演进多 collection + 权限/敏感级别过滤 |

---

## 6. 否决理由

- **方案 B（单池向量 RAG）**：roleagent.md 第4章明确指出"被切碎的 chunk 可能语义相似，但它未必是最新真相源"，且无权威等级与消费反馈
- **方案 C（纯 grep）**：roleagent.md 第4章指出 grep "没有语义桥接、不知道权威性、不知道跨域关系、没有结果反馈"——天花板太低
- **方案 D（LLM 在线打分）**：roleagent.md 第4章明确否决——"模型的自评集中在 0.6-0.85 的成功区间，几乎没有负样本"，根信号本身有毒

---

## 7. 参与者

- operator（愿景锚点 + 最终决策）
- 架构师灵智体（方案设计 + 术语对齐项目正式命名）
- 灵忆 EchoStore（经验记忆存储基底实现）
- 灵典 MindCodex（蒸馏知识库实现）

---

## 8. 修订记录

| 日期 | 修订 | 修订者 |
|------|------|--------|
| 2026-07-21 | 初始版本，确立多域记忆联邦决策，落地五域 / 三入口 / 消费加权 / 治理层，术语对齐项目正式命名（灵忆 EchoStore / 灵典 MindCodex） | operator + 架构师灵智体 |

---

## 引用

- `[doc:roleagent.md#第4章]` — 团队记忆：从 grep 到多域知识联邦
- `[doc:decisions/004-capability-profile-routing.md]` — 能力画像路由（积累层写入灵忆 EchoStore）
- `[doc:decisions/007-harness-engineering-path.md]` — Harness 工程路径
- `[doc:decisions/012-naming-fusion.md]` — 命名融合（项目正式术语表）
- `[doc:decisions/013-all-things-spirit-mind-vision.md]` — 万物灵智体愿景
- `flowforge/core/memory/collection.py` — MemoryDomain / MemoryEntry / MemoryCollection
- `flowforge/core/memory/retrieval_entries.py` — GrepRetriever / SemanticRetriever / IndexRetriever
- `flowforge/core/memory/consumption_weighted.py` — ConsumptionWeightedRanker
- `flowforge/core/memory/governance.py` — RetentionPolicy / DecayPolicy / ConflictResolver / MemoryGovernor
- `flowforge/core/memory/mind_codex.py` — ForgeMethod / MindCodex
