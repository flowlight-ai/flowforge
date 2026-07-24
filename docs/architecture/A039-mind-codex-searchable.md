# A039: MindCodex 可检索知识库架构设计（Distilled Knowledge Base，社区社交称"灵典"）

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.4] + [doc:../spec.md#§3.14]（FR-CORE-004 / FR-CORE-014 / FR-CORE-024）
> **对应 arch.md**: [doc:../arch.md#§3.4] + [doc:../arch.md#§3.14]
> **对应 design.md**: [doc:../design.md#§3.4]（待创建）
> **对应 Feature**: [doc:../features/F039-mind-codex-searchable.md]（同号 Feature 级 SRS）
> **对应详细设计**: [doc:../design/D039-mind-codex-searchable.md]（待创建，同号 Feature 级 SDD）
> **依赖 ADR**: [doc:../decisions/008-memory-federation.md]

---

## 1. 架构上下文

### 1.1 架构问题

本 Feature 在架构层解决以下问题：forgemind 应用层需要一个 MindCodex 可检索知识库（Distilled Knowledge Base，社区社交称"灵典"），作为所有 Forgekin（Evolvable Agent，社区社交称"灵智体"）的共享知识库，存储 SpiritForge（Experience Distillation，社区社交称"灵锻"）产出的蒸馏知识。该知识库需支持三检索入口（语义检索 + 全文检索 + 图谱检索），并满足 CL-005 Knowledge Object Contract 七字段契约。

具体子问题：
- **与 EchoStore 区分**：MindCodex 存储结构化蒸馏产物，EchoStore 存储原始任务日志，二者如何工程化隔离?
- **CL-005 七字段契约**：trigger / procedure / precondition / postcondition / anti_pattern / provenance / confidence 七字段如何硬校验? 缺字段如何拒绝入库?
- **三检索入口统一**：语义检索（向量）/ 全文检索（关键词）/ 图谱检索（按 domain 索引）如何通过 RRF 融合?
- **消费加权排序**：如何基于消费次数 + Eval 分数 + 时效衰减排序检索结果（与 F017 14 信号一致）?
- **成熟度门控**：仅 L3+（CL-003 Validated 及以上）条目可被检索消费，L0-L2 条目仅存储不消费，如何工程化实现?
- **谱系追踪**：蒸馏知识库条目如何关联 F038 进化谱系，支持按SoulImprint查询某Forgekin家族的知识资产?

### 1.2 架构约束

- **单向依赖约束**：MindCodex 模块属于 forgemind 应用层（Layer 2），单向依赖 FlowForge 核心框架层（Layer 1）
- **DI 容器约束**：MindCodexStore / MindCodexSearcher / MindCodexConsumer 必须通过 DI 容器注入
- **Repository 层约束**：蒸馏知识库条目必须通过 Repository 层持久化，禁止直接操作数据库（编程红线第 13 条）
- **配置驱动约束**：contract_validation / search / consumption_ranking 规则必须外置 YAML 配置
- **可插拔数据源适配器约束**：所有检索必须通过 Repository 层抽象调用可插拔数据源适配器（铁律 §2.2），禁止绕过自建检索引擎
- **CL-005 七字段契约约束**：每个蒸馏知识库条目必须包含七字段，缺字段拒绝入库
- **与EchoStore区分约束**：蒸馏知识库存储结构化蒸馏产物（含七字段契约），EchoStore（F014）存储原始任务日志，二者存储隔离
- **成熟度门控约束**：仅 L3+ 条目可被检索消费，L0-L2 条目仅存储不消费

### 1.3 架构影响

- **对 forgemind 应用层（Layer 2）的影响**：新增 `flowforge/forgemind/codex/` 模块，承载 MindCodexStore / MindCodexSearcher / MindCodexConsumer / SpiritForge
- **对 F014 多域记忆 Collection 的影响**：蒸馏知识库作为多域记忆联邦 L6 层（procedural memory），与 F014 的 L1-L5 层隔离存储
- **对 F015 三检索入口的影响**：蒸馏知识库检索接入 F015 的 graph_resolve / list_recent / search_evidence 三入口，并提供 RRF 融合
- **对 F017 消费加权排序的影响**：蒸馏知识库消费信号（consumption_count / last_eval_score / last_consumed_at）接入 F017 14 信号加权排序
- **对 F028 ForgePipeline 的影响**：流水线第 3 步（记忆初始化）可预加载相关蒸馏知识库条目到Forgekin工作记忆
- **对 F035 三方 Agent 能力融合的影响**：三方 Agent 蒸馏的能力可写入蒸馏知识库，供Forgekin检索消费
- **对 F038 进化谱系的影响**：蒸馏知识库条目包含 soul_imprint 字段，可按谱系查询某Forgekin家族的知识资产
- **对 F040 Harness Eval 控制面的影响**：蒸馏知识库消费信号作为 Eval 信号源之一

---

## 2. 架构设计

### 2.1 组件架构图

```
┌──────────────────────────────────────────────────────────────────────┐
│ 蒸馏知识生产者（多个 Feature 写入蒸馏知识库）                               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│  │ SpiritForge│ │ F035     │  │ F036     │  │ F100     │            │
│  │SpiritForge│  │ 三方Agent│  │ 回炉蒸馏 │  │ Mode C   │            │
│  │ 蒸馏      │  │ 能力融合 │  │ 通用能力 │  │ 知识进化 │            │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘            │
└───────┼─────────────┼─────────────┼─────────────┼──────────────────┘
        │             │             │             │
        ▼             ▼             ▼             ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Layer 2: forgemind 应用层                                             │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ flowforge/forgemind/codex/                                    │  │
│  │                                                                │  │
│  │  ┌──────────────────────────────────────────────────────────┐ │  │
│  │  │ MindCodexStore（蒸馏知识库存储，与 F014 EchoStore隔离）             │ │  │
│  │  │  ├─ add_entry         添加条目                         │ │  │
│  │  │  ├─ get_entry         查询条目                         │ │  │
│  │  │  ├─ validate_contract CL-005 七字段硬校验              │ │  │
│  │  │  └─ list_by_domain    按 domain 索引                   │ │  │
│  │  └──────────────────────────────────────────────────────────┘ │  │
│  │                                                                │  │
│  │  ┌──────────────────────────────────────────────────────────┐ │  │
│  │  │ MindCodexSearcher（三检索入口，通过 Repository 层抽象     │ │  │
│  │  │  ├─ search_semantic   语义向量检索                     │ │  │
│  │  │  ├─ search_grep       全文关键词检索                   │ │  │
│  │  │  ├─ search_index      按 domain 图谱索引               │ │  │
│  │  │  └─ search_federated  RRF 三入口融合检索               │ │  │
│  │  └──────────────────────────────────────────────────────────┘ │  │
│  │                                                                │  │
│  │  ┌──────────────────────────────────────────────────────────┐ │  │
│  │  │ MindCodexConsumer（消费信号记录器，供 F017 加权）        │ │  │
│  │  │  ├─ consume           记录消费 + Eval 分数             │ │  │
│  │  │  ├─ update_consumption_count                          │ │  │
│  │  │  └─ update_last_eval_score                            │ │  │
│  │  └──────────────────────────────────────────────────────────┘ │  │
│  │                                                                │  │
│  │  ┌──────────────────────────────────────────────────────────┐ │  │
│  │  │ MaturityGatekeeper（CL-003 成熟度门控）                  │ │  │
│  │  │  ├─ check_consumable  校验 L3+ 才可消费                │ │  │
│  │  │  └─ promote_maturity  L0→L4 成熟度晋升                │ │  │
│  │  └──────────────────────────────────────────────────────────┘ │  │
│  │                                                                │  │
│  │  ┌──────────────────────────────────────────────────────────┐ │  │
│  │  │ MindCodexRepository（持久层，与 F014 EchoStore存储隔离）      │ │  │
│  │  │  ├─ save_entry                                       │ │  │
│  │  │  ├─ query_entries                                    │ │  │
│  │  │  └─ distinguish_from_echo_store: true                  │ │  │
│  │  └──────────────────────────────────────────────────────────┘ │  │
│  └────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────┬─────────────────────────────────────┘
                                 │ 单向依赖
                                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Layer 1: FlowForge 核心框架层                                         │
│  ├─ F008 Durable State Surfaces（持久表面，蒸馏知识库存储后端）             │
│  ├─ F014 Memory Collection（EchoStore，与蒸馏知识库隔离）                        │
│  ├─ F015 三检索入口（graph_resolve / list_recent / search_evidence）  │
│  ├─ F017 消费加权排序（14 信号 + Wilson 收缩）                        │
│  └─ 可插拔数据源适配器（语义向量 + 全文 + 图谱检索统一入口）         │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.2 关键架构决策

- **决策 1：MindCodex 与 EchoStore 存储隔离（结构化 vs 原始日志）**
  - 理由：naming-contract.md §2.8 明确"蒸馏知识库（MindCodex）是结构化、可检索、可复用的蒸馏产物，区别于EchoStore（原始日志）"。混用存储会导致检索时无法区分"已验证知识"与"原始经验"，且EchoStore的体量远大于蒸馏知识库，混合存储影响检索性能
  - 替代方案：统一存储 → 检索时需额外过滤"是否蒸馏"，性能差且语义模糊
- **决策 2：CL-005 七字段契约硬校验（缺字段拒绝入库）**
  - 理由：CL-005 规定每个蒸馏知识库条目必须包含 trigger / procedure / precondition / postcondition / anti_pattern / provenance / confidence 七字段。缺字段意味着Forgekin无法判断"这个知识是否适用于当前场景"，入库即垃圾数据
  - 替代方案：软校验（仅警告）→ 蒸馏知识库质量不可控，Forgekin可能消费不完整知识
- **决策 3：三检索入口通过 Repository 层抽象调用可插拔数据源适配器 + RRF 融合**
  - 理由：arch.md §2.2 要求数据检索通过 Repository 层抽象。通过适配器可注入语义向量（Milvus）+ 全文（Elasticsearch BM25）+ 图谱（Neo4j）三入口与 RRF 融合。蒸馏知识库检索复用适配器能力，避免重复造轮子
  - 替代方案：蒸馏知识库自建检索引擎 → 违反配置驱动原则，且重复实现 RRF 融合逻辑
- **决策 4：消费加权排序接入 F017 14 信号**
  - 理由：F017 已定义 14 行为指标 + Wilson 收缩 + 中心化偏移 + 分数时效衰减。蒸馏知识库消费排序复用 F017 算法，保证记忆联邦内排序一致性
  - 替代方案：蒸馏知识库独立排序算法 → 与 F017 排序结果不一致，Forgekin在蒸馏知识库与EchoStore间检索时排序语义割裂
- **决策 5：成熟度门控（仅 L3+ 可消费）**
  - 理由：CL-003 五级知识成熟度阶梯规定 L0-L2 是未验证知识，L3+ 是已验证知识。允许消费 L0-L2 会导致Forgekin使用未验证知识做决策，可能引发错误。L0-L2 仅存储，待 Eval Ledger 验证后晋升到 L3 才可消费
  - 替代方案：所有成熟度均可消费 → 蒸馏知识库质量不可控，Forgekin可能消费错误知识
- **决策 6：蒸馏知识库条目关联 F038 进化谱系（soul_imprint 字段）**
  - 理由：蒸馏知识库条目归属于某个Forgekin，Forgekin的谱系关系（分裂 / 融合 / 跨层迁移）应可追溯其知识资产。通过 soul_imprint 字段关联，可查询"某Forgekin家族累计的蒸馏知识库条目"
  - 替代方案：蒸馏知识库与谱系解耦 → 无法回答"这个知识来自哪个Forgekin家族"，知识溯源断裂
- **决策 7：provenance 字段指向 F014 EchoStore Episode ID**
  - 理由：蒸馏知识库是EchoStore的蒸馏产物，provenance 字段记录来源 Episode ID，可追溯"这个知识是从哪次任务经验蒸馏来的"。这是"知识溯源链"的关键环节
  - 替代方案：provenance 留空 → 蒸馏知识库与EchoStore脱节，无法验证知识的经验来源

### 2.3 架构不变量

- 每个蒸馏知识库条目必须包含 CL-005 七字段（trigger / procedure / precondition / postcondition / anti_pattern / provenance / confidence），缺字段拒绝入库
- 蒸馏知识库存储必须与 F014 EchoStore存储隔离（distinguish_from_echo_store=true）
- 蒸馏知识库 provenance 字段必须指向 F014 EchoStore的 Episode ID（至少 1 个来源）
- 蒸馏知识库检索必须通过 Repository 层抽象调用可插拔数据源适配器（语义 + 全文 + 图谱）
- 三检索入口必须通过 RRF 融合（与 F015 一致）
- 消费加权排序必须接入 F017 14 信号（consumption_count + last_eval_score + recency）
- 仅 L3+ 成熟度条目可被检索消费，L0-L2 条目仅存储不消费
- 蒸馏知识库条目必须包含 soul_imprint 字段，关联 F038 进化谱系
- 所有蒸馏知识库条目必须通过 Repository 层持久化
- 所有蒸馏知识库规则必须外置 YAML 配置，禁止硬编码

---

## 3. 模块设计

### 3.1 模块边界

- **MindCodexStore（`flowforge/forgemind/codex/store.py`）**：蒸馏知识库存储抽象，提供条目 CRUD 与 CL-005 契约校验
- **MindCodexSearcher（`flowforge/forgemind/codex/searcher.py`）**：蒸馏知识库检索器，接入可插拔数据源适配器，提供三入口 + RRF 融合
- **MindCodexConsumer（`flowforge/forgemind/codex/consumer.py`）**：消费信号记录器，记录消费次数 / Eval 分数 / 最后消费时间
- **MaturityGatekeeper（`flowforge/forgemind/codex/maturity.py`）**：CL-003 成熟度门控器，校验 L3+ 才可消费
- **MindCodexRepository（`flowforge/forgemind/codex/repository.py`）**：持久层，与 F014 EchoStore存储隔离
- **SpiritForge（`flowforge/forgemind/codex/spirit_forge.py`）**：经验蒸馏引擎，从 EchoStore 蒸馏知识到 MindCodex
- **models（`flowforge/forgemind/codex/models.py`）**：数据模型（MindCodexEntry）

### 3.2 接口契约

```python
from abc import ABC, abstractmethod
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class MindCodexEntry(BaseModel):
    """蒸馏知识库条目（CL-005 Knowledge Object Contract 七字段）"""
    entry_id: str
    forgekin_id: str = Field(description="所属Forgekin")
    domain: str = Field(description="能力域")

    # === CL-005 七字段契约（缺一不可）===
    trigger: str = Field(description="①trigger 何时使用")
    procedure: str = Field(description="②procedure 怎么用")
    precondition: str = Field(description="③precondition 前置条件")
    postcondition: str = Field(description="④postcondition 预期效果")
    anti_pattern: str = Field(description="⑤anti_pattern 反模式")
    provenance: list[str] = Field(
        description="⑥provenance 来源 Episode ID（F014 EchoStore ID）"
    )
    confidence: float = Field(
        ge=0.0, le=1.0, description="⑦confidence 置信度 0.0-1.0"
    )

    # === 扩展字段 ===
    maturity_level: str = Field(
        default="L0",
        description="CL-003 五级成熟度 L0/L1/L2/L3/L4"
    )
    created_at: datetime
    last_consumed_at: Optional[datetime] = Field(
        default=None,
        description="最后消费时间（F017 消费加权）"
    )
    consumption_count: int = Field(
        default=0,
        description="消费次数（F017 信号）"
    )
    last_eval_score: Optional[float] = Field(
        default=None,
        description="最后 Eval 分数（F017 信号）"
    )
    soul_imprint: str = Field(
        description="所属ForgekinSoulImprint（F038 谱系追踪）"
    )


class MindCodexStore(ABC):
    """蒸馏知识库存储（抽象接口，与 F014 EchoStore存储隔离）"""

    @abstractmethod
    async def add_entry(self, entry: MindCodexEntry) -> str:
        """添加蒸馏知识库条目

        前置条件:
        - CL-005 七字段契约校验通过（缺字段拒绝）
        - confidence >= min_confidence（默认 0.6）
        - provenance 至少 1 个 Episode ID
        - maturity_level 初始为 L0
        """
        ...

    @abstractmethod
    async def get_entry(
        self, entry_id: str
    ) -> Optional[MindCodexEntry]:
        """查询条目详情"""
        ...

    @abstractmethod
    async def validate_contract(
        self, entry: MindCodexEntry
    ) -> bool:
        """CL-005 七字段契约校验

        校验规则:
        - trigger / procedure / precondition / postcondition
          / anti_pattern 非空
        - provenance 至少 1 个 Episode ID
        - confidence 在 [0.0, 1.0] 范围内
        """
        ...

    @abstractmethod
    async def list_by_domain(
        self, forgekin_id: str, domain: str
    ) -> list[MindCodexEntry]:
        """按 domain 索引查询"""
        ...


class MindCodexSearcher(ABC):
    """蒸馏知识库检索器（通过 Repository 层抽象调用可插拔数据源适配器三入口）"""

    @abstractmethod
    async def search_semantic(
        self,
        forgekin_id: str,
        query: str,
        top_k: int,
    ) -> list[MindCodexEntry]:
        """语义向量检索（通过可插拔适配器调用 Milvus）"""
        ...

    @abstractmethod
    async def search_grep(
        self,
        forgekin_id: str,
        keyword: str,
    ) -> list[MindCodexEntry]:
        """全文关键词检索（通过可插拔适配器调用 Elasticsearch BM25）"""
        ...

    @abstractmethod
    async def search_index(
        self,
        forgekin_id: str,
        domain: str,
    ) -> list[MindCodexEntry]:
        """图谱索引检索（按 domain）"""
        ...

    @abstractmethod
    async def search_federated(
        self,
        forgekin_id: str,
        query: str,
    ) -> list[MindCodexEntry]:
        """三入口 RRF 融合检索（与 F015 一致）

        融合规则:
        - 语义 + 全文 + 图谱三入口结果 RRF 融合
        - 消费加权排序（与 F017 14 信号一致）
        - 仅返回 L3+ 成熟度条目（CL-003 门控）
        """
        ...


class MindCodexConsumer(ABC):
    """蒸馏知识库消费者（记录消费信号供 F017 加权）"""

    @abstractmethod
    async def consume(
        self,
        entry_id: str,
        eval_score: float,
    ) -> None:
        """记录消费 + Eval 分数

        副作用:
        - consumption_count += 1
        - last_consumed_at = now
        - last_eval_score = eval_score
        - 触发 F017 消费加权排序更新
        """
        ...


class MaturityGatekeeper(ABC):
    """CL-003 成熟度门控器"""

    @abstractmethod
    async def check_consumable(
        self, entry: MindCodexEntry
    ) -> bool:
        """校验条目是否可被消费

        规则:
        - L0/L1/L2: 不可消费（仅存储）
        - L3/L4: 可消费
        """
        ...

    @abstractmethod
    async def promote_maturity(
        self,
        entry_id: str,
        target_level: str,
        evidence: dict,
    ) -> None:
        """成熟度晋升

        晋升规则（CL-003）:
        - L3 需 >=6 uses, >=2 agents, >=80% 成功率, 无 critical breach
        - L4 需 >=12 uses, last 10 >=90%, operator approved
        """
        ...


class MindCodexRepository(ABC):
    """蒸馏知识库持久层（抽象接口，与 F014 EchoStore存储隔离）"""

    @abstractmethod
    async def save_entry(self, entry: MindCodexEntry) -> None: ...

    @abstractmethod
    async def query_entries(
        self,
        forgekin_id: str,
        domain: Optional[str] = None,
        maturity_min: str = "L3",
    ) -> list[MindCodexEntry]: ...
```

### 3.3 数据流

```
蒸馏入库流（EchoStore → 蒸馏知识库）:
  ┌────────────────┐
  │ F014 EchoStore      │
  │ Episode 日志   │
  │ （原始经验）   │
  └────────┬───────┘
           │ 1. SpiritForge 蒸馏
           ▼
  ┌────────────────────────────────────────────┐
  │ SpiritForge                                │
  │  ├─ 提取 trigger / procedure / 等七字段    │
  │  ├─ provenance 指向源 Episode ID           │
  │  ├─ confidence 由 Eval Ledger 计算         │
  │  └─ maturity_level = L0（初始）            │
  └────────┬───────────────────────────────────┘
           │ 2. add_entry
           ▼
  ┌────────────────────────────────────────────┐
  │ MindCodexStore                             │
  │  ├─ validate_contract CL-005 七字段校验  │
  │  │   （缺字段拒绝入库）                    │
  │  ├─ MindCodexRepository.save_entry       │
  │  └─ 与 F014 EchoStore存储隔离                   │
  └────────────────────────────────────────────┘

检索消费流（蒸馏知识库 → Forgekin）:
  ┌────────────────┐
  │ Forgekin任务     │
  │ "查询相关蒸馏知识库" │
  └────────┬───────┘
           │ 1. search_federated(query)
           ▼
  ┌────────────────────────────────────────────┐
  │ MindCodexSearcher                          │
  │  ├─ search_semantic  语义向量检索        │
  │  ├─ search_grep      全文关键词检索      │
  │  ├─ search_index     按 domain 索引      │
  │  └─ RRF 融合三入口结果                    │
  └────────┬───────────────────────────────────┘
           │ 2. 候选条目（含 L0-L4 各成熟度）
           ▼
  ┌────────────────────────────────────────────┐
  │ MaturityGatekeeper                         │
  │  ├─ check_consumable 过滤 L0-L2          │
  │  └─ 仅保留 L3+ 条目                        │
  └────────┬───────────────────────────────────┘
           │ 3. 可消费条目
           ▼
  ┌────────────────────────────────────────────┐
  │ 消费加权排序（接入 F017 14 信号）          │
  │  调整后得分 = 融合检索得分                 │
  │            + 权威加成                      │
  │            + consumption_count 权重 0.3    │
  │            + last_eval_score 权重 0.4      │
  │            + recency 权重 0.3              │
  │            - 过时惩罚                      │
  │  + Wilson 收缩（贝叶斯收缩）               │
  └────────┬───────────────────────────────────┘
           │ 4. 排序后条目
           ▼
  ┌────────────────┐
  │ Forgekin消费     │
  │ + consume    │──→ 更新 consumption_count
  │                │    last_consumed_at
  │                │    last_eval_score
  └────────────────┘

成熟度晋升流（L0 → L4）:
  ┌────────────────┐
  │ L0 Seed 条目   │
  │ （刚蒸馏入库） │
  └────────┬───────┘
           │ 1. Eval Ledger 验证（CL-004）
           ▼
  ┌────────────────────────────────────────────┐
  │ MaturityGatekeeper.promote_maturity      │
  │  ├─ L0→L1: 自动（首次使用后）              │
  │  ├─ L1→L2: 自动（>=3 uses）                │
  │  ├─ L2→L3: 需 >=6 uses, >=2 agents, >=80%  │
  │  ├─ L3→L4: 需 >=12 uses, last 10 >=90%,    │
  │  │         operator approved               │
  │  └─ L3+ 才可被检索消费                     │
  └────────────────────────────────────────────┘
```

---

## 4. 跨模块协作

### 4.1 上游依赖

- **F008 Durable State Surfaces**：蒸馏知识库条目持久化复用 F008 持久表面，与 F014 EchoStore存储隔离
- **F014 Memory Collection**：蒸馏知识库的 provenance 字段指向 F014 EchoStore Episode ID，是EchoStore的蒸馏产物
- **F015 三检索入口**：蒸馏知识库检索接入 F015 的 graph_resolve / list_recent / search_evidence 三入口
- **F017 消费加权排序**：蒸馏知识库消费排序复用 F017 14 信号 + Wilson 收缩算法
- **F035 三方 Agent 能力融合**：三方 Agent 蒸馏的能力可通过 SpiritForge 写入蒸馏知识库
- **F038 进化谱系**：蒸馏知识库条目包含 soul_imprint 字段，关联谱系
- **可插拔数据源适配器**：语义向量（Milvus）+ 全文（ES BM25）+ 图谱（Neo4j）三入口检索统一入口
- **ADR 008 多域记忆联邦**：本 Feature 是 ADR 008 的具体落地

### 4.2 下游影响

- **F028 ForgePipeline**：流水线第 3 步（记忆初始化）可预加载相关蒸馏知识库条目到Forgekin工作记忆
- **F040 Harness Eval 控制面**：蒸馏知识库消费信号（consumption_count / last_eval_score）作为 Eval 信号源
- **F100 Mode C Knowledge Evolution**：Mode C 知识进化的产物写入蒸馏知识库，经 Eval Ledger 验证后晋升 L3+
- **operator 知识审计**：operator 可通过蒸馏知识库审计Forgekin的知识资产，验证知识质量

### 4.3 跨模块不变量

- 蒸馏知识库存储必须与 F014 EchoStore存储物理隔离（不同表 / 不同 collection）
- 蒸馏知识库条目的 provenance 字段必须指向有效的 F014 Episode ID
- 蒸馏知识库检索必须同时调用可插拔数据源适配器三入口并通过 RRF 融合
- 消费加权排序的权重配置必须与 F017 一致（0.3 / 0.4 / 0.3）
- L0-L2 条目禁止被检索消费（MaturityGatekeeper 强制过滤）
- L3→L4 晋升必须 operator 批准（CL-003 规则）
- 蒸馏知识库条目的 soul_imprint 必须与 F038 谱系节点一致

---

## 5. 架构验收

### 5.1 架构契约验收

- [ ] AC-1: 单向依赖通过——codex 模块不 import 任何 *Forge 模块
- [ ] AC-2: DI 容器注入通过——MindCodexStore / MindCodexSearcher / MindCodexConsumer 通过 DI 容器注入
- [ ] AC-3: Repository 层通过——MindCodexRepository 抽象存在且与 F014 EchoStore存储隔离
- [ ] AC-4: 配置驱动通过——contract_validation / search / consumption_ranking 规则外置 YAML
- [ ] AC-5: CL-005 七字段契约通过——缺字段拒绝入库（validate_contract 返回 false）
- [ ] AC-6: 三检索入口通过——semantic / grep / index 三入口可用且 RRF 融合
- [ ] AC-7: 消费加权排序通过——consumption_count + last_eval_score + recency 三信号加权
- [ ] AC-8: 成熟度门控通过——L0-L2 不可消费，L3+ 可消费

### 5.2 架构不变量验收

- [ ] AC-9: 蒸馏知识库存储与 F014 EchoStore存储物理隔离（distinguish_from_echo_store=true）
- [ ] AC-10: 蒸馏知识库检索通过 Repository 层抽象调用可插拔数据源适配器（无绕过）
- [ ] AC-11: 蒸馏知识库条目包含 soul_imprint 字段，关联 F038 进化谱系
- [ ] AC-12: provenance 字段指向有效 F014 Episode ID
- [ ] AC-13: L3→L4 成熟度晋升必须 operator 批准

---

## 6. 引用

- [doc:../spec.md#§3.4]（FR-CORE-004 多域记忆联邦）
- [doc:../spec.md#§3.14]（FR-CORE-014 SpiritForge + MindCouncil）
- [doc:../spec.md#§3.16]（FR-CORE-024 MindCodex 可检索知识库）
- [doc:../arch.md#§3.4]（多域记忆联邦六层架构）
- [doc:../arch.md#§3.14]（SpiritForge + MindCouncil 架构）
- [doc:../features/F039-mind-codex-searchable.md]（同号 Feature 级 SRS）
- [doc:../features/F014-memory-collection.md]（多域记忆 Collection）
- [doc:../features/F015-three-retrieval-entry.md]（三检索入口）
- [doc:../features/F017-consumption-weighted-ranking.md]（消费加权排序）
- [doc:../features/F028-forging-pipeline.md]（锻造流水线）
- [doc:../features/F035-external-agent-capability-fusion.md]（三方 Agent 能力融合）
- [doc:../features/F038-forgemind-lineage.md]（进化谱系）
- [doc:../features/F040-harness-eval-control-plane.md]（Harness Eval 控制面）
- [doc:../decisions/008-memory-federation.md]（多域记忆联邦 ADR）
- [doc:../../CONTRIBUTING.md#33-架构约束]（原则 2 数据检索通过 Repository 层抽象，支持可插拔数据源适配器）
- [doc:../../CONTRIBUTING.md#31-15-条编程红线违反即拒绝合入]（编程红线第 10/11/12/13 条）
- [doc:../../CONTRIBUTING.md]（软件工程文档分层规范）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（架构骨架） | 架构师 Forgekin（猫头鹰·鲁班） |
