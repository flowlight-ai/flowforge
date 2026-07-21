# D039: MindCodex 可检索知识库详细设计（Distilled Knowledge Base，社区社交称"灵典"）

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 开发者 Forgekin（猎犬·夏洛克）
> **对应 spec.md**: [doc:../spec.md#§3.4] + [doc:../spec.md#§3.14]（FR-CORE-004 / FR-CORE-014 / FR-CORE-024）
> **对应 arch.md**: [doc:../arch.md#§3.4] + [doc:../arch.md#§3.14]
> **对应 design.md**: [doc:../design.md#§3.4] + [doc:../design.md#§3.14]
> **对应 Feature**: [doc:../features/F039-mind-codex-searchable.md]（同号 Feature 级 SRS）
> **对应 Architecture**: [doc:../architecture/A039-mind-codex-searchable.md]（同号 Feature 级 SAD）
> **依赖 ADR**: [doc:../decisions/008-memory-federation.md]

---

## 1. 详细设计上下文

### 1.1 设计问题

本详细设计在 A039 架构设计基础上，深入到代码层落地MindCodex可检索知识库（MindCodex Searchable）系统，需解决以下工程问题：

- **CL-005 七字段契约硬校验**：trigger / procedure / precondition / postcondition / anti_pattern / provenance / confidence 七字段如何用 Pydantic 模型 + validator 实现缺字段拒绝入库? confidence 范围 [0.0, 1.0] 如何约束? provenance 至少 1 个 Episode ID 如何校验?
- **与 F014 EchoStore存储隔离**：蒸馏知识库（结构化蒸馏产物）与EchoStore（原始任务日志）如何在不同 surface_type / 不同 collection 中物理隔离?
- **三检索入口工程化**：search_semantic（Milvus 向量）/ search_grep（ES BM25）/ search_index（按 domain 图谱）如何通过可插拔数据源适配器 SDK 并发调用?
- **RRF 融合算法实现**：三入口结果如何按 1/(k+rank) 计算 RRF 分数并融合排序?
- **消费加权排序接入 F017**：consumption_count + last_eval_score + recency 三信号如何按 0.3/0.4/0.3 权重 + Wilson 收缩排序?
- **成熟度门控实现**：L0-L2 不可消费（仅存储）、L3+ 可消费的过滤逻辑如何在 search_federated 内强制生效? L3→L4 operator 批准如何实现?
- **provenance 字段指向 F014 Episode ID**：蒸馏知识库条目入库时如何校验 provenance 中的 Episode ID 在 F014 EchoStore 中确实存在?
- **soul_imprint 关联 F038 谱系**：蒸馏知识库条目如何按SoulImprint家族查询（"某Forgekin家族累计的蒸馏知识库条目"）?

### 1.2 设计约束

- **单向依赖**：`flowforge/forgemind/codex/` 禁止 import 任何 *Forge 模块；可 import `flowforge/core/*` 与 `flowforge/forgemind/*`
- **DI 容器**：MindCodexStore / MindCodexSearcher / MindCodexConsumer / MaturityGatekeeper / SpiritForge 必须由 DI 容器注入
- **Repository 层**：所有蒸馏知识库条目持久化必须经 MindCodexRepository 抽象，复用 F008 持久表面，禁止直接操作数据库
- **配置驱动**：contract_validation / search / consumption_ranking / maturity 规则必须外置 YAML（`flowforge/forgemind/config/mind_codex.yaml`）
- **可插拔数据源适配器统一入口**：所有检索必须通过 Repository 层抽象调用可插拔数据源适配器，禁止蒸馏知识库自建检索引擎
- **CL-005 七字段契约**：每个蒸馏知识库条目必须包含七字段，缺字段或 confidence 越界拒绝入库
- **与EchoStore存储隔离**：蒸馏知识库 surface_type="mind_codex_entry"，与 F014 EchoStore（surface_type="echo_episode"）物理隔离
- **成熟度门控**：仅 L3+ 条目可被 search_federated 返回，L0-L2 仅存储不消费

### 1.3 设计影响

- **新增模块**：`flowforge/forgemind/codex/` 下 7 个文件（store.py / searcher.py / consumer.py / maturity.py / spirit_forge.py / repository.py / models.py）
- **修改 F008 Durable State Surfaces**：新增 surface_type="mind_codex_entry" 持久表面
- **修改 F014 Memory Collection**：蒸馏知识库作为多域记忆联邦 L6 层（procedural memory），与 L1-L5 隔离存储
- **修改 F015 三检索入口**：蒸馏知识库检索接入 graph_resolve / list_recent / search_evidence 三入口
- **修改 F017 消费加权排序**：蒸馏知识库消费信号接入 14 信号加权排序
- **影响 F028 ForgePipeline**：流水线第 3 步（记忆初始化）可预加载相关蒸馏知识库条目到Forgekin工作记忆
- **影响 F035 三方 Agent 能力融合**：三方 Agent 蒸馏的能力通过 SpiritForge 写入蒸馏知识库
- **影响 F038 进化谱系**：蒸馏知识库条目包含 soul_imprint 字段，按谱系查询家族知识资产
- **影响 F040 Harness Eval 控制面**：蒸馏知识库消费信号作为 Eval 信号源

---

## 2. 详细设计

### 2.1 类图 ASCII

```
       ┌──────────────────────────────────────────────────────────────────┐
       │ 蒸馏知识生产者                                                     │
       │  SpiritForge │ F035 三方Agent融合 │ F036 回炉蒸馏 │ F100 Mode C    │
       └────────────────────────────────┬─────────────────────────────────┘
                                        │
                                        ▼
   ┌──────────────────────────────────────────────────────────────────────┐
   │ <<abstract>> MindCodexStore (store.py)                                │
   │ + add_entry(entry) → entry_id                                         │
   │ + get_entry(entry_id) → Optional[MindCodexEntry]                      │
   │ + validate_contract(entry) → bool  // CL-005 七字段硬校验              │
   │ + list_by_domain(forgekin_id, domain) → list[MindCodexEntry]          │
   │ + list_by_soul_imprint_family(soul_imprint) → list[MindCodexEntry]    │
   └─────────────┬─────────────────────────────────────┬──────────────────┘
                 │ implements                            │ uses
                 ▼                                       ▼
   ┌──────────────────────────────────┐  ┌──────────────────────────────┐
   │ MindCodexStoreImpl               │  │ <<abstract>>                 │
   │                                  │  │ MaturityGatekeeper (maturity │
   │ - repository                     │  │  .py)                        │
   │ - echo_store  (F014)             │  │ + check_consumable(entry)    │
   │ - lineage_query (F038)           │  │   → bool                     │
   │ - event_bus                      │  │ + promote_maturity(entry_id, │
   └──────────────────────────────────┘  │     target_level, evidence)  │
                                         └──────────────────────────────┘
                 ▲                                       ▲
                 │                                       │
   ┌─────────────┴──────────────────┐  ┌────────────────┴──────────────┐
   │ <<abstract>>                   │  │ <<abstract>>                  │
   │ MindCodexSearcher (searcher.py)│  │ MindCodexConsumer (consumer   │
   │ + search_semantic(query)       │  │  .py)                         │
   │ + search_grep(keyword)         │  │ + consume(entry_id,           │
   │ + search_index(domain)         │  │     eval_score)               │
   │ + search_federated(query)      │  │ + update_consumption_count  │
   │   → RRF 融合 + 成熟度门控      │  │ + update_last_eval_score    │
   └────────────────────────────────┘  └───────────────────────────────┘
                 ▲
                 │
   ┌─────────────┴──────────────────────────────────────────────────────┐
   │ <<abstract>> SpiritForge (spirit_forge.py)                          │
   │ + distill(forgekin_id, scope, preserve_vertical_in_original)        │
   │   → list[SkillPackage]                                              │
   │ + extract_seven_fields(episodes) → CL-005 entry dict                │
   │ + compute_confidence(episodes) → float                              │
   └────────────────────────────────────────────────────────────────────┘
                 ▲
                 │
   ┌─────────────┴──────────────────────────────────────────────────────┐
   │ <<abstract>> MindCodexRepository (repository.py)                    │
   │ + save_entry(entry)                                                 │
   │ + get_entry(entry_id)                                               │
   │ + query_entries(forgekin_id, domain?, maturity_min?)                │
   │ + update_consumption_signals(entry_id, count, eval, last_consumed)  │
   │ + promote_maturity(entry_id, target_level)                          │
   │ + list_by_soul_imprint_family(soul_imprint)                         │
   └────────────────────────────────────────────────────────────────────┘
```

### 2.2 接口实现 Python 代码

```python
# flowforge/forgemind/codex/models.py
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator


MaturityLevel = Literal["L0", "L1", "L2", "L3", "L4"]

REQUIRED_CONTRACT_FIELDS = (
    "trigger",
    "procedure",
    "precondition",
    "postcondition",
    "anti_pattern",
    "provenance",
    "confidence",
)


class MindCodexEntry(BaseModel):
    """蒸馏知识库条目（CL-005 Knowledge Object Contract 七字段契约）"""

    entry_id: str
    forgekin_id: str = Field(description="所属Forgekin")
    domain: str = Field(description="能力域（如 writing / coding / fact_check）")

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
        ge=0.0, le=1.0,
        description="⑦confidence 置信度 [0.0, 1.0]"
    )

    # === 扩展字段 ===
    maturity_level: MaturityLevel = Field(
        default="L0",
        description="CL-003 五级成熟度 L0/L1/L2/L3/L4"
    )
    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_consumed_at: Optional[datetime] = Field(
        default=None,
        description="最后消费时间（F017 消费加权信号）"
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

    @field_validator("provenance")
    @classmethod
    def _provenance_nonempty(cls, v: list[str]) -> list[str]:
        if not v or len(v) < 1:
            raise ValueError("provenance must have at least 1 Episode ID")
        return v

    @field_validator("confidence")
    @classmethod
    def _confidence_range(cls, v: float) -> float:
        if v < 0.0 or v > 1.0:
            raise ValueError("confidence must be in [0.0, 1.0]")
        return v


class SearchQuery(BaseModel):
    """蒸馏知识库检索查询"""
    forgekin_id: str
    query: Optional[str] = Field(default=None, description="语义查询文本")
    keyword: Optional[str] = Field(default=None, description="全文关键词")
    domain: Optional[str] = Field(default=None, description="按 domain 图谱检索")
    top_k: int = Field(default=10, ge=1, le=100)
    min_maturity: MaturityLevel = Field(
        default="L3",
        description="最低成熟度门控（仅 L3+ 可消费）"
    )
    include_family: bool = Field(
        default=False,
        description="是否包含同谱系家族的条目"
    )


class ConsumptionRecord(BaseModel):
    """消费记录（写入 F017 信号源）"""
    entry_id: str
    forgekin_id: str
    consumed_at: datetime = Field(default_factory=datetime.utcnow)
    eval_score: float = Field(ge=0.0, le=1.0)
    task_id: str
```

```python
# flowforge/forgemind/codex/store.py
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional

from .models import MindCodexEntry


class ContractValidationError(Exception):
    """CL-005 七字段契约校验失败"""
    pass


class MindCodexStore(ABC):
    """蒸馏知识库存储（抽象接口，与 F014 EchoStore存储物理隔离）"""

    @abstractmethod
    async def add_entry(self, entry: MindCodexEntry) -> str:
        """添加蒸馏知识库条目

        前置条件:
        - CL-005 七字段契约校验通过（缺字段 / confidence 越界拒绝）
        - confidence >= min_confidence（配置默认 0.6）
        - provenance 至少 1 个 Episode ID 且在 F014 EchoStore 中存在
        - maturity_level 初始为 L0
        - soul_imprint 在 F038 LineageStore 中存在

        副作用:
        - 写入 MindCodexRepository（surface_type='mind_codex_entry'）
        - 与 F014 EchoStore 物理隔离
        - 发布 EntryAddedEvent

        返回 entry_id
        """
        ...

    @abstractmethod
    async def get_entry(
        self, entry_id: str
    ) -> Optional[MindCodexEntry]: ...

    @abstractmethod
    async def validate_contract(
        self, entry: MindCodexEntry
    ) -> bool:
        """CL-005 七字段契约校验

        校验规则:
        - trigger / procedure / precondition / postcondition
          / anti_pattern 非空字符串
        - provenance 至少 1 个 Episode ID
        - confidence 在 [0.0, 1.0] 范围内
        - confidence >= min_confidence（配置默认 0.6）
        - provenance 中所有 Episode ID 在 F014 EchoStore 中存在
        - soul_imprint 在 F038 LineageStore 中存在

        返回 True / False（不抛异常，调用方根据返回值决定）
        """
        ...

    @abstractmethod
    async def list_by_domain(
        self,
        forgekin_id: str,
        domain: str,
    ) -> list[MindCodexEntry]: ...

    @abstractmethod
    async def list_by_soul_imprint_family(
        self,
        soul_imprint: str,
        max_depth: int = 3,
    ) -> list[MindCodexEntry]:
        """按谱系查询某Forgekin家族的蒸馏知识库条目

        通过 F038 LineageQuery.get_descendants(soul_imprint, depth)
        获取家族成员的 soul_imprint 列表, 然后查询所有这些SoulImprint的条目
        """
        ...
```

```python
# flowforge/forgemind/codex/searcher.py
from __future__ import annotations

from abc import ABC, abstractmethod

from .models import MindCodexEntry, SearchQuery


class MindCodexSearcher(ABC):
    """蒸馏知识库检索器（通过 Repository 层抽象调用可插拔数据源适配器三入口 + RRF 融合 + 成熟度门控）"""

    @abstractmethod
    async def search_semantic(
        self,
        forgekin_id: str,
        query: str,
        top_k: int = 10,
    ) -> list[MindCodexEntry]:
        """语义向量检索（通过可插拔适配器调用 Milvus）

        索引来源: entry.procedure + entry.trigger 的 embedding
        """
        ...

    @abstractmethod
    async def search_grep(
        self,
        forgekin_id: str,
        keyword: str,
        top_k: int = 10,
    ) -> list[MindCodexEntry]:
        """全文关键词检索（通过可插拔适配器调用 Elasticsearch BM25）

        索引字段: trigger / procedure / precondition / anti_pattern
        """
        ...

    @abstractmethod
    async def search_index(
        self,
        forgekin_id: str,
        domain: str,
        top_k: int = 10,
    ) -> list[MindCodexEntry]:
        """图谱索引检索（按 domain 索引）

        直接查询 MindCodexRepository 中 domain 字段
        """
        ...

    @abstractmethod
    async def search_federated(
        self,
        query: SearchQuery,
    ) -> list[MindCodexEntry]:
        """三入口 RRF 融合检索（与 F015 一致）

        步骤:
        1. 并发调用 semantic / grep / index 三入口（asyncio.gather）
        2. RRF 融合:
              rrf_score[entry_id] += 1.0 / (k + rank)
              k = 60 (RRF 常数)
        3. 成熟度门控: 仅保留 maturity_level >= query.min_maturity（默认 L3）
        4. 消费加权排序: 接入 F017 14 信号算法
              adjusted_score = rrf_score
                            + 0.3 * normalized(consumption_count)
                            + 0.4 * last_eval_score
                            + 0.3 * recency_score
                            - staleness_penalty
              + Wilson 收缩（贝叶斯收缩）
        5. 返回 top_k 条目

        若 include_family=True, 还查询同谱系家族的条目并融合
        """
        ...
```

```python
# flowforge/forgemind/codex/consumer.py
from __future__ import annotations

from abc import ABC, abstractmethod


class MindCodexConsumer(ABC):
    """蒸馏知识库消费者（记录消费信号供 F017 加权）"""

    @abstractmethod
    async def consume(
        self,
        entry_id: str,
        forgekin_id: str,
        eval_score: float,
        task_id: str,
    ) -> None:
        """记录消费 + Eval 分数

        前置条件:
        - entry.maturity_level >= L3（仅 L3+ 可消费）
        - entry.forgekin_id == forgekin_id 或 include_family=True

        副作用:
        - consumption_count += 1
        - last_consumed_at = now
        - last_eval_score = eval_score
        - 触发 F017 消费加权排序更新
        - 写入消费记录到 F014 EchoStore（task 维度）

        若 entry.maturity_level < L3 抛 MaturityGateError
        """
        ...
```

```python
# flowforge/forgemind/codex/maturity.py
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Literal, Optional

from .models import MindCodexEntry


class MaturityGateError(Exception):
    pass


class MaturityGatekeeper(ABC):
    """CL-003 五级知识成熟度门控器"""

    @abstractmethod
    async def check_consumable(
        self, entry: MindCodexEntry
    ) -> bool:
        """校验条目是否可被消费

        规则（CL-003）:
        - L0 / L1 / L2: 不可消费（仅存储）
        - L3 / L4: 可消费

        返回 True / False
        """
        ...

    @abstractmethod
    async def promote_maturity(
        self,
        entry_id: str,
        target_level: Literal["L1", "L2", "L3", "L4"],
        evidence: dict,
        operator_id: Optional[str] = None,
    ) -> None:
        """成熟度晋升

        晋升规则（CL-003）:
        - L0 → L1: 自动（首次使用后，evidence 含 first_use_task_id）
        - L1 → L2: 自动（>=3 uses, evidence 含 use_count=3）
        - L2 → L3: 需 >=6 uses, >=2 agents, >=80% 成功率, 无 critical breach
        - L3 → L4: 需 >=12 uses, last 10 >=90%, **operator approved**

        若 target_level=L4 且 operator_id 为空, 抛 MaturityGateError
        若 evidence 不满足规则, 抛 MaturityGateError
        """
        ...

    @abstractmethod
    async def get_maturity_stats(
        self,
        entry_id: str,
    ) -> dict:
        """获取成熟度统计（uses / agents / success_rate / breaches）"""
        ...
```

```python
# flowforge/forgemind/codex/spirit_forge.py
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Literal

from .models import MindCodexEntry


class SpiritForgeError(Exception):
    pass


class SpiritForge(ABC):
    """SpiritForge引擎（从EchoStore蒸馏知识到蒸馏知识库）"""

    @abstractmethod
    async def distill(
        self,
        forgekin_id: str,
        scope: Literal["general_only", "all"] = "general_only",
        preserve_vertical_in_original: bool = True,
        episode_ids: list[str] | None = None,
    ) -> list[str]:
        """蒸馏经验到蒸馏知识库

        步骤:
        1. 从 F014 EchoStore 拉取Forgekin的 Episode 日志
           （若 episode_ids 给定则仅蒸馏指定 episodes）
        2. 按能力域（domain）聚类 episodes
        3. 对每个 domain 调用 LLM 蒸馏出 CL-005 七字段:
              trigger: 何时使用（基于 episodes 中的任务上下文）
              procedure: 怎么用（基于 episodes 中的成功操作序列）
              precondition: 前置条件（基于 episodes 中的环境状态）
              postcondition: 预期效果（基于 episodes 中的成功结果）
              anti_pattern: 反模式（基于 episodes 中的失败操作）
              provenance: 来源 Episode ID 列表
              confidence: 置信度（基于成功/失败比 + Wilson 下界）
        4. 若 scope=general_only 且 preserve_vertical_in_original=True:
              仅蒸馏通用能力（与 *Forge 垂直技能无关的部分）
        5. 调用 MindCodexStore.add_entry(entry) 入库
           （需通过 CL-005 七字段契约校验）
        6. 返回 entry_id 列表
        """
        ...

    @abstractmethod
    async def extract_seven_fields(
        self,
        episodes: list[dict],
    ) -> dict:
        """LLM 蒸馏 CL-005 七字段（不直接入库，供 distill 内部调用）

        返回结构:
        {
            "trigger": "...",
            "procedure": "...",
            "precondition": "...",
            "postcondition": "...",
            "anti_pattern": "...",
            "provenance": ["episode_id_1", "episode_id_2"],
            "confidence": 0.82,
            "domain": "writing"
        }
        """
        ...

    @abstractmethod
    async def compute_confidence(
        self,
        episodes: list[dict],
    ) -> float:
        """计算置信度

        算法:
        - 成功次数 / 总次数 + Wilson 下界收缩
        - 若总次数 < 5, 收缩后 confidence 偏低（保守估计）
        - 返回 [0.0, 1.0]
        """
        ...
```

```python
# flowforge/forgemind/codex/repository.py
from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime
from typing import Literal, Optional

from .models import MindCodexEntry


class MindCodexRepository(ABC):
    """蒸馏知识库持久层（抽象接口，与 F014 EchoStore存储物理隔离）

    复用 F008 Durable State Surfaces, surface_type='mind_codex_entry'
    与 F014 EchoStore (surface_type='echo_episode') 物理隔离
    """

    @abstractmethod
    async def save_entry(self, entry: MindCodexEntry) -> None: ...

    @abstractmethod
    async def get_entry(
        self, entry_id: str
    ) -> Optional[MindCodexEntry]: ...

    @abstractmethod
    async def query_entries(
        self,
        forgekin_id: str,
        domain: Optional[str] = None,
        maturity_min: str = "L3",
    ) -> list[MindCodexEntry]: ...

    @abstractmethod
    async def query_by_soul_imprints(
        self,
        soul_imprints: list[str],
        domain: Optional[str] = None,
        maturity_min: str = "L3",
    ) -> list[MindCodexEntry]: ...

    @abstractmethod
    async def update_consumption_signals(
        self,
        entry_id: str,
        consumption_count: int,
        last_eval_score: float,
        last_consumed_at: datetime,
    ) -> None: ...

    @abstractmethod
    async def promote_maturity(
        self,
        entry_id: str,
        target_level: str,
    ) -> None: ...

    @abstractmethod
    async def get_maturity_stats(
        self, entry_id: str
    ) -> dict: ...
```

### 2.3 数据结构 Pydantic Models

数据结构已在 §2.2 完整定义。核心模型汇总：

| 模型 | 用途 | 关键字段 |
|------|------|---------|
| `MindCodexEntry` | 蒸馏知识库条目（CL-005 七字段） | trigger / procedure / precondition / postcondition / anti_pattern / provenance / confidence + maturity_level + consumption_count + soul_imprint |
| `SearchQuery` | 检索查询 | query / keyword / domain / min_maturity / include_family |
| `ConsumptionRecord` | 消费记录 | entry_id / eval_score / task_id |

### 2.4 关键算法伪代码

```
算法: add_entry(entry)
输入: entry: MindCodexEntry
输出: entry_id: str

1. // CL-005 七字段契约校验
   IF NOT await validate_contract(entry):
      raise ContractValidationError("七字段契约校验失败")
2. // confidence 下限校验（配置 min_confidence=0.6）
   IF entry.confidence < config.min_confidence:
      raise ContractValidationError(
          f"confidence {entry.confidence} < min {config.min_confidence}")
3. // provenance 在 F014 EchoStore 中存在性校验
   FOR ep_id IN entry.provenance:
       IF NOT await echo_store.has_episode(ep_id):
           raise ContractValidationError(
               f"provenance episode not found: {ep_id}")
4. // soul_imprint 在 F038 LineageStore 中存在性校验
   node ← await lineage_store.get_node(entry.soul_imprint)
   IF node IS None:
       raise ContractValidationError(
           f"soul_imprint not in lineage: {entry.soul_imprint}")
5. entry.maturity_level ← "L0"  // 初始成熟度
6. entry.created_at ← now
7. entry.consumption_count ← 0
8. await repository.save_entry(entry)
9. event_bus.publish(EntryAddedEvent(entry_id=entry.entry_id,
                                      forgekin_id=entry.forgekin_id))
10. RETURN entry.entry_id

算法: search_federated(query)
输入: query: SearchQuery
输出: list[MindCodexEntry]（已按 RRF + 消费加权排序）

1. // 并发调用三入口
   tasks ← []
   IF query.query IS NOT None:
       tasks.append(("semantic",
           searcher.search_semantic(query.fororgekin_id,
                                     query.query, query.top_k*3)))
   IF query.keyword IS NOT None:
       tasks.append(("grep",
           searcher.search_grep(query.forgekin_id,
                                query.keyword, query.top_k*3)))
   IF query.domain IS NOT None:
       tasks.append(("index",
           searcher.search_index(query.forgekin_id,
                                 query.domain, query.top_k*3)))
   results ← await asyncio.gather(*[t[1] for t in tasks])
   entries_by_source ← dict(zip([t[0] for t in tasks], results))

2. // 若 include_family, 查询同谱系家族条目并融合
   IF query.include_family:
       family_imprints ← await lineage_query.get_descendants(
           query.soul_imprint, depth=3)
       family_entries ← await repository.query_by_soul_imprints(
           family_imprints, maturity_min=query.min_maturity)
       entries_by_source["family"] ← family_entries

3. // RRF 融合
   rrf_scores: dict[entry_id, float] ← {}
   entry_map: dict[entry_id, MindCodexEntry] ← {}
   FOR source, entries IN entries_by_source.items:
       FOR rank, entry IN enumerate(entries, start=1):
           rrf_scores[entry.entry_id] += 1.0 / (60 + rank)
           entry_map[entry.entry_id] ← entry

4. // 成熟度门控（仅保留 L3+）
   filtered ← [
       (eid, score) FOR eid, score IN rrf_scores.items
       IF _maturity_rank(entry_map[eid].maturity_level)
            >= _maturity_rank(query.min_maturity)
   ]

5. // 消费加权排序（接入 F017 14 信号）
   FOR eid, rrf_score IN filtered:
       entry ← entry_map[eid]
       consumption_norm ← min(entry.consumption_count / 100, 1.0)
       eval_score ← entry.last_eval_score OR 0.5
       recency ← _recency_score(entry.last_consumed_at)
       staleness ← _staleness_penalty(entry.last_consumed_at)
       n ← entry.consumption_count
       p ← eval_score
       wilson ← _wilson_lower_bound(n, p, z=1.96)
       adjusted_score ← (
           rrf_score
           + 0.3 * consumption_norm
           + 0.4 * wilson
           + 0.3 * recency
           - staleness
       )
       entry._adjusted_score ← adjusted_score

6. // 排序 + 截断
   sorted_entries ← sorted(
       filtered, key=lambda x: entry_map[x[0]]._adjusted_score,
       reverse=True)[:query.top_k]
7. RETURN [entry_map[eid] FOR eid, _ IN sorted_entries]

算法: promote_maturity(entry_id, target_level, evidence, operator_id)
输入: entry_id, target_level in {L1,L2,L3,L4}, evidence, operator_id
输出: None

1. entry ← repository.get_entry(entry_id)
   IF entry IS None: raise MaturityGateError("entry not found")
2. stats ← repository.get_maturity_stats(entry_id)
3. // L4 必须 operator 批准
   IF target_level == "L4" AND NOT operator_id:
       raise MaturityGateError("L4 promotion requires operator approval")
4. // 校验规则
   IF target_level == "L1":
       IF NOT evidence.get("first_use_task_id"):
           raise MaturityGateError("L1 requires first_use_task_id")
   ELIF target_level == "L2":
       IF stats["use_count"] < 3:
           raise MaturityGateError("L2 requires >=3 uses")
   ELIF target_level == "L3":
       IF (stats["use_count"] < 6
           OR len(stats["agent_ids"]) < 2
           OR stats["success_rate"] < 0.80
           OR stats["critical_breach_count"] > 0):
           raise MaturityGateError("L3 requires >=6 uses, >=2 agents, "
                                   ">=80% success, no critical breach")
   ELIF target_level == "L4":
       IF (stats["use_count"] < 12
           OR stats["last_10_success_rate"] < 0.90):
           raise MaturityGateError("L4 requires >=12 uses, last 10 >=90%")
5. entry.maturity_level ← target_level
6. await repository.promote_maturity(entry_id, target_level)
7. event_bus.publish(MaturityPromotedEvent(...))

辅助:
_maturity_rank(level) = {"L0":0, "L1":1, "L2":2, "L3":3, "L4":4}[level]
_wilson_lower_bound(n, p, z=1.96):
    IF n == 0: RETURN 0.0
    denom ← 1 + z*z/n
    center ← p + z*z/(2*n)
    spread ← z * sqrt((p*(1-p) + z*z/(4*n))/n)
    RETURN max(0.0, (center - spread) / denom)
_recency_score(last_consumed_at):
    IF last_consumed_at IS None: RETURN 0.0
    days_ago ← (now - last_consumed_at).days
    RETURN max(0.0, 1.0 - days_ago/30)  // 30 天衰减
_staleness_penalty(last_consumed_at):
    IF last_consumed_at IS None: RETURN 0.5
    days_ago ← (now - last_consumed_at).days
    IF days_ago > 90: RETURN 0.5  // 90 天未用强惩罚
    RETURN 0.0
```

---

## 3. 模块实现

### 3.1 关键代码片段

**MindCodexStoreImpl 核心实现**：

```python
# flowforge/forgemind/codex/store_impl.py
from __future__ import annotations

from typing import Optional

from flowforge.core.tracing import get_logger

from .models import MindCodexEntry, REQUIRED_CONTRACT_FIELDS
from .repository import MindCodexRepository
from .store import ContractValidationError, MindCodexStore

logger = get_logger(__name__)


class MindCodexStoreImpl(MindCodexStore):
    def __init__(
        self,
        repository: MindCodexRepository,
        echo_store,  # F014 EchoStore 抽象
        lineage_store,  # F038 LineageStore 抽象
        lineage_query,  # F038 LineageQuery 抽象
        config,  # mind_codex 配置 dict
        event_bus,
    ) -> None:
        self._repo = repository
        self._echo = echo_store
        self._lineage = lineage_store
        self._lineage_query = lineage_query
        self._config = config
        self._event_bus = event_bus

    async def add_entry(self, entry: MindCodexEntry) -> str:
        if not await self.validate_contract(entry):
            raise ContractValidationError(
                f"CL-005 contract validation failed for entry"
            )
        min_conf = self._config.get("min_confidence", 0.6)
        if entry.confidence < min_conf:
            raise ContractValidationError(
                f"confidence {entry.confidence} < min {min_conf}"
            )
        # provenance 存在性校验
        for ep_id in entry.provenance:
            if not await self._echo.has_episode(ep_id):
                raise ContractValidationError(
                    f"provenance episode not found: {ep_id}"
                )
        # soul_imprint 存在性校验
        node = await self._lineage.get_node(entry.soul_imprint)
        if node is None:
            raise ContractValidationError(
                f"soul_imprint not in lineage: {entry.soul_imprint}"
            )
        # 初始化字段
        entry.maturity_level = "L0"
        entry.consumption_count = 0
        await self._repo.save_entry(entry)
        await self._event_bus.publish(
            {"type": "EntryAdded",
             "entry_id": entry.entry_id,
             "forgekin_id": entry.forgekin_id,
             "domain": entry.domain}
        )
        logger.info(
            "codex entry added",
            extra={"entry_id": entry.entry_id,
                   "domain": entry.domain,
                   "confidence": entry.confidence},
        )
        return entry.entry_id

    async def get_entry(
        self, entry_id: str
    ) -> Optional[MindCodexEntry]:
        return await self._repo.get_entry(entry_id)

    async def validate_contract(
        self, entry: MindCodexEntry
    ) -> bool:
        # 七字段非空校验
        for field in REQUIRED_CONTRACT_FIELDS:
            value = getattr(entry, field, None)
            if field == "provenance":
                if not value or len(value) < 1:
                    return False
            elif field == "confidence":
                if value is None or value < 0.0 or value > 1.0:
                    return False
            else:
                if not value or not isinstance(value, str):
                    return False
        return True

    async def list_by_domain(
        self, forgekin_id: str, domain: str
    ) -> list[MindCodexEntry]:
        return await self._repo.query_entries(
            forgekin_id, domain=domain, maturity_min="L0"
        )

    async def list_by_soul_imprint_family(
        self, soul_imprint: str, max_depth: int = 3
    ) -> list[MindCodexEntry]:
        descendants = await self._lineage_query.get_descendants(
            soul_imprint, depth=max_depth
        )
        soul_imprints = [soul_imprint] + [
            d.soul_imprint for d in descendants
        ]
        return await self._repo.query_by_soul_imprints(
            soul_imprints, maturity_min="L0"
        )
```

**MindCodexSearcherImpl 核心实现（RRF + 消费加权）**：

```python
# flowforge/forgemind/codex/searcher_impl.py
from __future__ import annotations

import asyncio
import math
from datetime import datetime, timezone
from typing import Optional

from flowforge.core.tracing import get_logger

from .models import MindCodexEntry, SearchQuery
from .repository import MindCodexRepository
from .searcher import MindCodexSearcher

logger = get_logger(__name__)

_MATURITY_RANK = {"L0": 0, "L1": 1, "L2": 2, "L3": 3, "L4": 4}
_RRF_K = 60


class MindCodexSearcherImpl(MindCodexSearcher):
    def __init__(
        self,
        repository: MindCodexRepository,
        adapter_client,  # 可插拔数据源适配器统一入口
        lineage_query,  # F038 LineageQuery
        config,
    ) -> None:
        self._repo = repository
        self._adapter = adapter_client
        self._lineage_query = lineage_query
        self._config = config

    async def search_semantic(
        self, forgekin_id: str, query: str, top_k: int = 10
    ) -> list[MindCodexEntry]:
        # 调用可插拔数据源适配器 Milvus 语义检索
        raw = await self._adapter.search_semantic(
            collection="mind_codex",
            query_text=query,
            filter={"forgekin_id": forgekin_id},
            top_k=top_k,
        )
        return [await self._repo.get_entry(r["entry_id"]) for r in raw]

    async def search_grep(
        self, forgekin_id: str, keyword: str, top_k: int = 10
    ) -> list[MindCodexEntry]:
        raw = await self._adapter.search_grep(
            index="mind_codex",
            query=keyword,
            filter={"forgekin_id": forgekin_id},
            top_k=top_k,
        )
        return [await self._repo.get_entry(r["entry_id"]) for r in raw]

    async def search_index(
        self, forgekin_id: str, domain: str, top_k: int = 10
    ) -> list[MindCodexEntry]:
        return await self._repo.query_entries(
            forgekin_id, domain=domain, maturity_min="L0"
        )[:top_k]

    async def search_federated(
        self, query: SearchQuery
    ) -> list[MindCodexEntry]:
        # 1. 并发三入口
        tasks = []
        if query.query:
            tasks.append(
                self.search_semantic(
                    query.forgekin_id, query.query, query.top_k * 3
                )
            )
        if query.keyword:
            tasks.append(
                self.search_grep(
                    query.forgekin_id, query.keyword, query.top_k * 3
                )
            )
        if query.domain:
            tasks.append(
                self.search_index(
                    query.forgekin_id, query.domain, query.top_k * 3
                )
            )
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # 2. RRF 融合
        rrf_scores: dict[str, float] = {}
        entry_map: dict[str, MindCodexEntry] = {}
        for result in results:
            if isinstance(result, Exception):
                logger.warning("search entry failed: %s", result)
                continue
            for rank, entry in enumerate(result, start=1):
                if entry is None:
                    continue
                rrf_scores[entry.entry_id] = (
                    rrf_scores.get(entry.entry_id, 0.0)
                    + 1.0 / (_RRF_K + rank)
                )
                entry_map[entry.entry_id] = entry

        # 3. 家族融合
        if query.include_family:
            family = await self._repo.query_by_soul_imprints(
                [query.soul_imprint] if hasattr(query, "soul_imprint")
                else [],
                maturity_min=query.min_maturity,
            )
            for rank, entry in enumerate(family, start=1):
                rrf_scores[entry.entry_id] = (
                    rrf_scores.get(entry.entry_id, 0.0)
                    + 1.0 / (_RRF_K + rank)
                )
                entry_map[entry.entry_id] = entry

        # 4. 成熟度门控
        min_rank = _MATURITY_RANK.get(query.min_maturity, 3)
        filtered = [
            (eid, score) for eid, score in rrf_scores.items
            if _MATURITY_RANK.get(
                entry_map[eid].maturity_level, 0
            ) >= min_rank
        ]

        # 5. 消费加权排序
        now = datetime.now(timezone.utc)
        scored = []
        for eid, rrf_score in filtered:
            entry = entry_map[eid]
            consumption_norm = min(entry.consumption_count / 100.0, 1.0)
            eval_score = entry.last_eval_score or 0.5
            recency = _recency_score(entry.last_consumed_at, now)
            staleness = _staleness_penalty(entry.last_consumed_at, now)
            wilson = _wilson_lower_bound(
                entry.consumption_count, eval_score
            )
            adjusted = (
                rrf_score
                + 0.3 * consumption_norm
                + 0.4 * wilson
                + 0.3 * recency
                - staleness
            )
            scored.append((adjusted, entry))

        scored.sort(key=lambda x: x[0], reverse=True)
        return [entry for _, entry in scored[: query.top_k]]


def _recency_score(last_consumed_at, now):
    if last_consumed_at is None:
        return 0.0
    days_ago = (now - last_consumed_at).days
    return max(0.0, 1.0 - days_ago / 30.0)


def _staleness_penalty(last_consumed_at, now):
    if last_consumed_at is None:
        return 0.5
    days_ago = (now - last_consumed_at).days
    if days_ago > 90:
        return 0.5
    return 0.0


def _wilson_lower_bound(n: int, p: float, z: float = 1.96) -> float:
    if n == 0:
        return 0.0
    denom = 1 + z * z / n
    center = p + z * z / (2 * n)
    spread = z * math.sqrt((p * (1 - p) + z * z / (4 * n)) / n)
    return max(0.0, (center - spread) / denom)
```

### 3.2 关键流程时序图

**蒸馏入库流时序**：

```
SpiritForge    F014 EchoStore    LLM    MindCodexStore    MindCodexRepository    F038 LineageStore    EventBus
   │                │              │          │                  │                     │                  │
   │ distill(...)   │              │          │                  │                     │                  │
   │ get_episodes   │              │          │                  │                     │                  │
   ├───────────────►│              │          │                  │                     │                  │
   │◄───────────────│ episodes     │          │                  │                     │                  │
   │ cluster by domain                                                                          │
   │ extract_seven_fields(episodes)                                                             │
   ├──────────────────────────────►│                                                            │
   │◄──────────────────────────────│ seven_fields dict                                          │
   │ compute_confidence(episodes)                                                               │
   │ entry ← MindCodexEntry(seven_fields + confidence + soul_imprint)                          │
   │ add_entry(entry)                                                                           │
   ├──────────────────────────────────────────►│                                                │
   │                                           │ validate_contract                              │
   │                                           │ provenance 存在性校验                            │
   │                                           ├───────────────►│                                │
   │                                           │◄───────────────│ OK                              │
   │                                           │ soul_imprint 存在性校验                          │
   │                                           ├──────────────────────────────────►│              │
   │                                           │◄──────────────────────────────────│ node         │
   │                                           │ save_entry                                                       │
   │                                           ├──────────────►│                                   │
   │                                           │◄──────────────│ OK                                │
   │                                           │ publish(EntryAddedEvent)                                         │
   │                                           ├──────────────────────────────────────────────────►│
   │ entry_id                                  │                                                                  │
   │◄──────────────────────────────────────────┤                                                                  │
```

**检索消费流时序**：

```
agent         MindCodexSearcher       可插拔适配器        MindCodexRepository    MaturityGatekeeper    MindCodexConsumer
  │                  │                     │                   │                     │                     │
  │ search_federated │                     │                   │                     │                     │
  ├─────────────────►│ async gather        │                   │                     │                     │
  │                  │  semantic / grep / index 三入口并发                                                 │                     │
  │                  ├────────────────────►│                   │                     │                     │
  │                  │◄────────────────────│ raw results       │                     │                     │
  │                  │ RRF 融合                                                                            │                     │
  │                  │ 成熟度门控（L3+）                                                                   │                     │
  │                  │ 消费加权排序                                                                        │                     │
  │                  │ query_entries (按 entry_id 批量获取详情)                                            │                     │
  │                  ├───────────────────────────────────────►│                     │                     │
  │                  │◄───────────────────────────────────────│ entries             │                     │
  │ entries          │                                                                                     │                     │
  │◄─────────────────┤                                                                                     │                     │
  │                                                                                                                                              │
  │ consume(entry_id, eval_score)                                                                                                                │
  ├──────────────────────────────────────────────────────────────────────────────────────────────────────────►│
  │                                                                                                                              │ check_consumable
  │                                                                                                                              ├─►│
  │                                                                                                                              │◄─│ True/False
  │                                                                                                                              │ update signals
  │                                                                                                                              ├─►│ repository
```

### 3.3 错误处理

| 异常类型 | 触发条件 | 处理策略 |
|---------|---------|---------|
| `ContractValidationError` | CL-005 七字段缺失 / confidence 越界 / provenance Episode 不存在 / soul_imprint 不在谱系 | 返回 422，附详细缺失字段 |
| `MaturityGateError` | 消费 L0-L2 条目 / 晋升规则不满足 / L4 晋升无 operator | 返回 403 或 422 |
| `SpiritForgeError` | LLM 蒸馏失败 / Episode 日志解析失败 / 入库契约校验失败 | 蒸馏任务失败重试 3 次后告警；已部分入库的条目回滚 |
| `AdapterUnavailableError` | 可插拔数据源适配器服务不可用 | 检索降级为仅 search_index（图谱过滤），返回 503 提示"语义检索暂不可用" |
| `ProvenanceNotFoundError` | provenance Episode ID 在 F014 EchoStore 中不存在 | 返回 422，附缺失 Episode ID |
| `RepositoryTimeoutError` | 持久层超时 | 重试 3 次后返回 503 |
| `LineageConsistencyError` | soul_imprint 在 F038 LineageStore 中不存在 | 返回 422，提示"SoulImprint未注册谱系" |

**回滚策略**：
- SpiritForge 蒸馏多个 entry 时使用事务化批量入库，任一 entry 契约校验失败则整批回滚
- 检索时三入口任一失败不阻塞其他入口，仅记录 warning
- 成熟度晋升失败时 entry.maturity_level 保持不变

### 3.4 性能优化

| 性能指标 | SLO | 优化手段 |
|---------|:----:|---------|
| `add_entry` 延迟 | P95 < 200ms | 契约校验 + 2 次外部存在性查询（echo / lineage）+ 1 次写入 |
| `search_semantic` 延迟 | P95 < 300ms | 可插拔数据源适配器 Milvus 向量检索 |
| `search_grep` 延迟 | P95 < 200ms | 可插拔数据源适配器 ES BM25 |
| `search_index` 延迟 | P95 < 50ms | Repository 单表 domain 索引 |
| `search_federated` 延迟 | P95 < 500ms | 三入口并发（asyncio.gather）+ RRF O(n) |
| `consume` 延迟 | P95 < 50ms | 单表 UPDATE |
| `promote_maturity` 延迟 | P95 < 100ms | 单表 UPDATE + 审计日志 |
| `distill` 延迟 | P95 < 60s | LLM 蒸馏耗时主导，建议异步任务 |

**优化策略**：
1. **三入口并发**：`asyncio.gather` 并发调用，任一失败降级
2. **缓存**：`get_entry(entry_id)` 结果以 entry_id 为 key 缓存 5 分钟，消费信号更新时失效
3. **批量蒸馏**：SpiritForge 一次蒸馏多个 domain 的 entry，使用 `add_entries_batch` 批量入库
4. **可插拔数据源适配器降级**：可插拔数据源适配器不可用时自动降级为仅 search_index（domain 过滤）
5. **预加载**：F028 ForgePipeline 第 3 步可预加载相关 domain 的 L3+ 蒸馏知识库条目到Forgekin工作记忆
6. **Wilson 缓存**：消费加权排序的 Wilson 下界按 (n, p) 缓存，避免重复计算
7. **异步蒸馏**：`distill_async` 拆分为异步任务，通过 `get_distill_status(task_id)` 查询进度

### 3.5 配置示例

`flowforge/forgemind/config/mind_codex.yaml`：

```yaml
mind_codex:
  store:
    backend: durable_state_surfaces
    surface_type: mind_codex_entry
    distinguish_from_echo_store: true   # 与 F014 EchoStore物理隔离
    cache_entry_ttl_seconds: 300

  contract_validation:
    required_fields:
      - trigger
      - procedure
      - precondition
      - postcondition
      - anti_pattern
      - provenance
      - confidence
    min_confidence: 0.6
    min_provenance_count: 1
    verify_provenance_in_echo_store: true
    verify_soul_imprint_in_lineage: true

  search:
    entries:
      semantic: enabled    # 可插拔适配器 Milvus
      grep: enabled        # 可插拔适配器 ES BM25
      index: enabled       # Repository domain 索引
    rrf_fusion: true
    rrf_k: 60
    min_maturity_for_consume: L3   # CL-003 成熟度门控
    top_k_default: 10
    top_k_max: 100
    adapter:
      endpoint: http://localhost:8100
      timeout_seconds: 5
      fallback_to_index_only: true

  consumption_ranking:
    weight_consumption_count: 0.3    # 与 F017 14 信号一致
    weight_eval_score: 0.4
    weight_recency: 0.3
    wilson_shrinkage: true
    wilson_z: 1.96
    recency_decay_days: 30
    staleness_threshold_days: 90
    staleness_penalty: 0.5

  maturity:
    promotion_rules:
      L0_to_L1: { requires_operator: false, require_first_use: true }
      L1_to_L2: { requires_operator: false, min_use_count: 3 }
      L2_to_L3:
        requires_operator: false
        min_use_count: 6
        min_agent_count: 2
        min_success_rate: 0.80
        allow_critical_breach: false
      L3_to_L4:
        requires_operator: true
        min_use_count: 12
        min_last_10_success_rate: 0.90

  spirit_forge:
    async_execution: true
    timeout_seconds: 120
    llm_distill_retry_count: 3
    default_scope: general_only
    preserve_vertical_in_original: true

  audit:
    log_all_entries: true
    log_all_consumption: true
    log_all_promotions: true
    alert_on_contract_violation: true

  performance:
    cache_entry_ttl_seconds: 300
    batch_entry_max_size: 50
    repository_retry_count: 3
```

---

## 4. 跨模块协作实现

### 4.1 上游依赖如何调用

| 上游模块 | 调用入口 | 调用时机 | 数据流 |
|---------|---------|---------|--------|
| **F008 Durable State Surfaces** | `DurableStateStore.save("mind_codex_entry", ...)` | 蒸馏知识库条目持久化（与 F014 EchoStore surface_type 隔离） | 单向：写 |
| **F014 Memory Collection** | `EchoStore.has_episode(ep_id)` / `EchoStore.get_episodes(forgekin_id)` | add_entry 时校验 provenance / distill 时拉取 episodes | 单向：读 |
| **F015 三检索入口** | search_evidence / graph_resolve / list_recent 三入口语义 | search_federated 复用 F015 入口语义 | 单向：读 |
| **F017 消费加权排序** | Wilson 收缩算法 + 14 信号加权公式 | consumption_ranking 接入 F017 算法 | 单向：读 |
| **F028 ForgePipeline** | 流水线第 3 步预加载相关蒸馏知识库条目 | Forgekin创建时 | 单向：读 |
| **F035 三方 Agent 能力融合** | SpiritForge.distill 写入三方 Agent 蒸馏的能力 | 三方 Agent 蒸馏时 | 单向：写 |
| **F036 ForgeRelationship** | 回炉蒸馏产出通用 SkillPackage | ReclaimExecutor 调用 | 单向：写 |
| **F038 LineageStore** | `LineageStore.get_node(soul_imprint)` / `LineageQuery.get_descendants(...)` | add_entry 校验SoulImprint存在 / list_by_soul_imprint_family 查询家族 | 单向：读 |
| **可插拔数据源适配器** | `PluggableAdapterClient.search_semantic / search_grep / search_index` | 检索三入口 | 单向：读 |
| **EventBus** | `EventBus.publish(EntryAddedEvent / MaturityPromotedEvent / ConsumedEvent)` | 入库 / 晋升 / 消费时 | 单向：发布 |

### 4.2 下游影响如何被调用

| 下游模块 | 被调用入口 | 调用方 | 时机 |
|---------|-----------|-------|------|
| **F017 消费加权排序** | `MindCodexConsumer.consume` 触发 F017 信号更新 | F017 订阅 ConsumedEvent | 消费时 |
| **F028 ForgePipeline** | 流水线第 3 步预加载 L3+ 蒸馏知识库条目 | ForgePipeline | Forgekin创建时 |
| **F040 Harness Eval 控制面** | 控制面消费 consumption_count / last_eval_score 作为 Eval 信号 | F040 控制面 | 每日汇总时 |
| **F036 ForgeRelationship** | ReclaimExecutor 调用 SpiritForge.distill 蒸馏通用能力 | ReclaimExecutor | 回炉时 |
| **operator 控制台** | HTTP API `GET /api/v7/codex/entries?forgekin_id=...` | operator UI | 知识审计 |
| **EventBus 订阅者** | `EntryAddedEvent` / `MaturityPromotedEvent` / `ConsumedEvent` | dashboard / 通知系统 | 异步消费 |

### 4.3 集成测试点

- **T1 单元层**：
  - `MindCodexEntry` Pydantic validator（七字段缺失 / confidence 越界 / provenance 空）单测
  - `validate_contract` 各分支单测
  - `search_federated` RRF 融合算法 + Wilson 收缩 + 成熟度门控单测
  - `promote_maturity` 各级晋升规则单测（L0→L1 / L1→L2 / L2→L3 / L3→L4）
- **T2 跨模块集成层**：
  - `add_entry` 全链路：CL-005 校验 + F014 provenance 存在性 + F038 soul_imprint 存在性
  - `search_federated` 通过 Repository 层抽象调用可插拔数据源适配器真实服务（localhost:8100），三入口返回真实结果
  - `consume` 触发 F017 消费加权信号更新
  - `list_by_soul_imprint_family` 通过 F038 LineageQuery 查询家族条目
- **T3 E2E 层（遵守 T1-T8 测试铁律）**：
  - 真实Forgekin通过真实 LLM 完成 5+ 编码任务（Eval ≥ 0.85，禁止 mock LLM）
  - 真实 LLM SpiritForge蒸馏出"代码编写能力"条目（含 CL-005 七字段，provenance 指向真实 Episode ID）
  - 经 Eval Ledger 验证（CL-004）合入蒸馏知识库，初始 maturity_level=L0
  - Forgekin使用该条目 6+ 次（2+ agents，80%+ 成功率），自动晋升 L3
  - 下次类似任务Forgekin通过 search_federated 找到该条目并消费
  - 验证：消费信号记录（consumption_count +1，last_eval_score 更新）/ 加权排序正确
  - operator 批准 L3→L4 晋升（需 12+ uses，last 10 90%+）
- **T4 异常路径**：
  - 入库时 provenance Episode ID 不存在 → 验证拒绝（ContractValidationError）
  - 入库时 soul_imprint 不在谱系 → 验证拒绝
  - 消费 L0-L2 条目 → 验证拒绝（MaturityGateError）
  - L3→L4 晋升无 operator_id → 验证拒绝
  - 可插拔数据源适配器不可用 → 验证降级为 search_index only

---

## 5. 详细设计验收

### 5.1 功能验收 AC

- [ ] **AC-1**：`MindCodexEntry` 含 CL-005 七字段（trigger / procedure / precondition / postcondition / anti_pattern / provenance / confidence）
- [ ] **AC-2**：`add_entry` 七字段缺失拒绝入库（ContractValidationError）
- [ ] **AC-3**：`add_entry` confidence 越界（< 0 或 > 1）拒绝入库
- [ ] **AC-4**：`add_entry` confidence < min_confidence（0.6）拒绝入库
- [ ] **AC-5**：`add_entry` provenance 空 / Episode 不存在拒绝入库
- [ ] **AC-6**：`add_entry` soul_imprint 不在 F038 谱系拒绝入库
- [ ] **AC-7**：`add_entry` 初始 maturity_level = L0
- [ ] **AC-8**：蒸馏知识库存储与 F014 EchoStore存储物理隔离（surface_type=mind_codex_entry vs echo_episode）
- [ ] **AC-9**：`search_semantic` / `search_grep` / `search_index` 三入口可用
- [ ] **AC-10**：`search_federated` RRF 融合三入口结果（k=60）
- [ ] **AC-11**：`search_federated` 成熟度门控（仅返回 L3+ 条目）
- [ ] **AC-12**：`search_federated` 消费加权排序（0.3 consumption + 0.4 wilson + 0.3 recency - staleness）
- [ ] **AC-13**：`search_federated` include_family=True 包含同谱系家族条目
- [ ] **AC-14**：`consume` 仅 L3+ 条目可消费（L0-L2 抛 MaturityGateError）
- [ ] **AC-15**：`consume` 更新 consumption_count / last_consumed_at / last_eval_score
- [ ] **AC-16**：`promote_maturity` L0→L1 自动（首次使用后）
- [ ] **AC-17**：`promote_maturity` L1→L2 自动（≥3 uses）
- [ ] **AC-18**：`promote_maturity` L2→L3 需 ≥6 uses, ≥2 agents, ≥80% 成功率, 无 critical breach
- [ ] **AC-19**：`promote_maturity` L3→L4 需 ≥12 uses, last 10 ≥90%, **operator approved**
- [ ] **AC-20**：`distill` 蒸馏产出含 CL-005 七字段 + provenance 指向真实 Episode ID
- [ ] **AC-21**：`list_by_soul_imprint_family` 通过 F038 谱系查询家族条目
- [ ] **AC-22**：所有检索通过 Repository 层抽象调用可插拔数据源适配器统一入口（无绕过）

### 5.2 性能验收

- [ ] **AC-23**：`add_entry` P95 延迟 < 200ms
- [ ] **AC-24**：`search_federated` P95 延迟 < 500ms（三入口并发）
- [ ] **AC-25**：`consume` P95 延迟 < 50ms
- [ ] **AC-26**：`distill` 异步版本提交后 1s 内返回 task_id，整体 P95 < 120s
- [ ] **AC-27**：`get_entry` 缓存命中率 > 80%

### 5.3 安全验收

- [ ] **AC-28**：所有条目通过 MindCodexRepository 持久化（无直接数据库操作）
- [ ] **AC-29**：蒸馏知识库存储与 F014 EchoStore存储物理隔离（distinguish_from_echo_store=true）
- [ ] **AC-30**：L3→L4 晋升必须 operator 批准（不可自动晋升）
- [ ] **AC-31**：L0-L2 条目禁止被检索消费（强制门控）
- [ ] **AC-32**：所有契约校验失败 + 晋升失败写入审计日志

### 5.4 Eval 验收

- [ ] **AC-33**：`distill` 的 confidence 由真实 Eval 信号计算（成功/失败比 + Wilson 下界）
- [ ] **AC-34**：`consume` 的 eval_score 来自 F018 EvalLedger（非自算）
- [ ] **AC-35**：F040 控制面将蒸馏知识库消费信号（consumption_count / last_eval_score）作为 Eval 信号源
- [ ] **AC-36**：F040 控制面将 CL-005 契约违反率作为蒸馏知识库组件健康指标
- [ ] **AC-37**：F040 控制面将 L3+ 晋升成功率作为知识质量指标

---

## 6. 引用

- [doc:../spec.md#§3.4]（FR-CORE-004 多域记忆联邦）
- [doc:../spec.md#§3.14]（FR-CORE-014 SpiritForge + MindCouncil）
- [doc:../spec.md#§3.16]（FR-CORE-024 MindCodex 可检索知识库）
- [doc:../arch.md#§3.4]（多域记忆联邦六层架构）
- [doc:../arch.md#§3.14]（SpiritForge + MindCouncil 架构）
- [doc:../architecture/A039-mind-codex-searchable.md]（同号 Feature 级 SAD）
- [doc:../features/F039-mind-codex-searchable.md]（同号 Feature 级 SRS）
- [doc:../features/F008-durable-state-surfaces.md]（Durable State Surfaces）
- [doc:../features/F014-memory-collection.md]（多域记忆 Collection）
- [doc:../features/F015-three-retrieval-entry.md]（三检索入口）
- [doc:../features/F017-consumption-weighted-ranking.md]（消费加权排序）
- [doc:../features/F028-forging-pipeline.md]（锻造流水线）
- [doc:../features/F035-external-agent-capability-fusion.md]（三方 Agent 能力融合）
- [doc:../features/F036-forgemind-forge-relationship.md]（forgemind 与 *Forge 关系）
- [doc:../features/F038-forgemind-lineage.md]（进化谱系）
- [doc:../features/F040-harness-eval-control-plane.md]（Harness Eval 控制面）
- [doc:../decisions/008-memory-federation.md]（多域记忆联邦 ADR）
- [doc:../design/naming-contract.md#2.5]（EchoStore）
- [doc:../design/naming-contract.md#2.7]（SpiritForge）
- [doc:../design/naming-contract.md#2.8]（MindCodex 蒸馏知识库）
- [doc:../../../hiclaw/rules.md#第二部分]（原则 2 数据检索通过 Repository 层抽象，支持可插拔数据源适配器）
- [doc:../../../hiclaw/rules.md#第七部分]（编程红线第 10/11/12/13 条）
- [doc:../../../hiclaw/rules.md#第十一部分]（软件工程文档分层规范）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（详细设计骨架，） | 开发者 Forgekin（猎犬·夏洛克） |
