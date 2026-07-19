# D037: 灵智体市场详细设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 开发者灵智体（猎犬·夏洛克）
> **对应 spec.md**: [doc:../spec.md#§3.13]（FR-CORE-013）
> **对应 arch.md**: [doc:../arch.md#§3.13]
> **对应 design.md**: [doc:../design.md#§3.13]
> **对应 Feature**: [doc:../features/F037-forgemind-marketplace.md]（同号 Feature 级 SRS）
> **对应 Architecture**: [doc:../architecture/A037-forgemind-marketplace.md]（同号 Feature 级 SAD）
> **依赖 ADR**: [doc:../decisions/005-forgemind-application-layer.md]
> **9 大点名称修订**: 已应用（双轨命名 + AI 术语优先 + 弱化万物 + 去 AGI 化）

---

## 1. 详细设计上下文

### 1.1 设计问题

本详细设计在 A037 架构设计基础上，深入到代码层落地灵智体市场（Forgekin Marketplace）系统，需解决以下工程问题：

- **上架契约工程化**：MarketplaceListing 必须包含 seller / species / capability_summary / layer / evolution_stage / awakening_stage / soul_imprint_hash / listing_artifact_ref 八大字段，缺字段拒绝上架。Wilson 下界摘要如何自动从 F001 CapabilityProfile 生成?
- **克隆保留血缘实现**：订阅时如何深拷贝灵智体并保留父灵印血缘? 克隆体如何生成新灵印（Soul Imprint）? 父灵印如何写入克隆体血缘字段?
- **交易转移所有权**：交易时灵印如何随之转移（原 operator 失去控制权）? 原 operator 保留什么交易记录? 哈希校验如何防篡改?
- **OpenSieve 三入口融合检索**：全文（ES BM25）+ 语义（Milvus 向量）+ 图谱（按 species/layer/domain 索引）三入口如何通过 RRF 融合?
- **觉醒阶上架门控**：E4+ Evolving 状态灵智体不可上架，如何在校验链中拦截?

### 1.2 设计约束

- **单向依赖**：`flowforge/forgemind/marketplace/` 禁止 import 任何 *Forge 模块；可 import `flowforge/core/*` 与 `flowforge/forgemind/*`
- **DI 容器**：MarketplaceRegistry / ForgekinCloner / OwnershipTransferor / MarketplaceSearcher / SoulImprintHasher 必须由 DI 容器注入
- **Repository 层**：所有上架 / 订阅 / 交易记录必须经 MarketplaceRepository 抽象，禁止直接操作数据库
- **配置驱动**：listing / subscription / trade / search 规则必须外置 YAML（`flowforge/forgemind/config/marketplace.yaml`）
- **灵印不可变**：上架时 `SoulImprintHasher.compute_hash(soul_imprint)` 写入 listing，交易 / 订阅时 `verify_hash()` 校验，不一致拒绝
- **OpenSieve 统一入口**：检索必须走 OpenSieve 客户端，禁止市场自建检索引擎
- **觉醒阶上限**：`listing.awakening_stage` ≤ E3，E4+ 灵智体上架被拒绝
- **9 大点名称修订**：代码层使用 Forgekin / MarketplaceListing / SoulImprint；文档层使用"灵智体 / 灵智体市场 / 灵印"

### 1.3 设计影响

- **新增模块**：`flowforge/forgemind/marketplace/` 下 7 个文件（registry.py / cloner.py / transferor.py / searcher.py / hasher.py / repository.py / models.py + summary.py）
- **修改 F001 CapabilityProfile**：新增 `generate_summary(wilson_lower_bound=True)` 接口
- **修改 F038 LineageStore**：新增 CLONED / TRADED 谱系边写入入口
- **影响 F036 ForgeRelationship**：MarketplaceListing 新增 `layer: ForgeLayer` 字段，市场查询支持按层过滤
- **影响 OpenSieve 客户端**：市场作为消费方，通过 OpenSieve SDK 调用三入口 + RRF 融合
- **影响 F028 ForgePipeline**：流水线产出的灵智体可作为市场上架源（通过 `pipeline.output.listing_artifact_ref`）

---

## 2. 详细设计

### 2.1 类图 ASCII

```
       ┌──────────────────────────────────────────────────────────────┐
       │ <<abstract>>                                                 │
       │ MarketplaceRegistry                                          │
       │ (marketplace/registry.py)                                    │
       │ ──────────────────────────                                  │
       │ + list_item(listing) → listing_id                            │
       │ + search(query) → list[MarketplaceListing]                   │
       │ + delist(listing_id, operator_id)                            │
       │ + get_listing(listing_id) → MarketplaceListing               │
       └─────────────┬────────────────────────────────────┬──────────┘
                     │ implements                          │ uses
                     ▼                                     ▼
       ┌──────────────────────────────────┐  ┌──────────────────────────┐
       │ MarketplaceRegistryImpl          │  │ <<abstract>>             │
       │                                  │  │ SoulImprintHasher         │
       │ - repository                     │  │ (hasher.py)              │
       │ - capability_summary_generator   │  │ + compute_hash(imprint)  │
       │ - soul_imprint_hasher ──────────────────►│ + verify_hash(imprint,│
       │ - searcher                       │  │     expected_hash) → bool│
       │ - cloner                         │  └──────────────────────────┘
       │ - transferor                     │  ┌──────────────────────────┐
       │ - event_bus                      │  │ <<abstract>>             │
       └──────────────────────────────────┘  │ CapabilitySummaryGenerator│
                                             │ (summary.py)             │
                                             │ + generate(forgekin_id)  │
                                             │   → CapabilitySummary    │
                                             │   (Wilson 下界)          │
                                             └──────────────────────────┘
                     ▼                                     ▼
       ┌──────────────────────────────────┐  ┌──────────────────────────┐
       │ <<abstract>>                     │  │ <<abstract>>             │
       │ ForgekinCloner                   │  │ OwnershipTransferor      │
       │ (cloner.py)                      │  │ (transferor.py)          │
       │ + clone_for_subscriber(          │  │ + transfer_ownership(    │
       │     source_forgekin_id,          │  │     forgekin_id,         │
       │     subscriber_operator_id)      │  │     new_operator_id)     │
       │   → cloned_forgekin_id           │  │   → trade_id             │
       └──────────────────────────────────┘  └──────────────────────────┘
                     │                                     │
                     │ both write to                        │
                     ▼                                     ▼
       ┌──────────────────────────────────────────────────────────────┐
       │ <<abstract>> MarketplaceRepository (repository.py)            │
       │ + save_listing / save_subscription / save_trade               │
       │ + get_listing / list_trades_by_seller / list_subscriptions    │
       │ + query_listings(filter) → list[MarketplaceListing]           │
       └──────────────────────────────────────────────────────────────┘
                     ▲
                     │
       ┌──────────────────────────────────────────────────────────────┐
       │ <<abstract>> MarketplaceSearcher (searcher.py)                │
       │ + search_by_keyword(query) → OpenSieve 全文                   │
       │ + search_by_capability(query) → OpenSieve 语义                │
       │ + search_by_filter(species, layer, stage) → 图谱              │
       │ + search_federated(query) → RRF 融合                          │
       └──────────────────────────────────────────────────────────────┘
```

### 2.2 接口实现 Python 代码

```python
# flowforge/forgemind/marketplace/models.py
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


class ListingType(str):
    SHARE = "share"
    SUBSCRIBE = "subscribe"
    TRADE = "trade"


class MarketplaceListing(BaseModel):
    """市场上架条目"""
    listing_id: str
    seller_forgekin_id: str
    seller_operator_id: str
    title: str
    description: str
    species: str = Field(description="ForgekinSpecies 来自 F027")
    capability_summary: dict = Field(
        description="能力画像摘要（Wilson 下界），由 F001 生成"
    )
    layer: str = Field(description="ForgeLayer 来自 F036")
    evolution_stage: str = Field(description="EvolutionStage E1-E6")
    awakening_stage: str = Field(description="AwakeningStage E1-E6")
    listing_type: str = Field(description="share | subscribe | trade")
    price_tokens: Optional[int] = None
    soul_imprint_hash: str = Field(
        description="灵印哈希（SHA-256，防篡改锚点）"
    )
    listing_artifact_ref: str = Field(
        description="上架产物包引用（YAML 配置 + 能力快照）"
    )
    created_at: datetime = Field(default_factory=datetime.utcnow)
    delisted_at: Optional[datetime] = None


class MarketplaceSubscription(BaseModel):
    """订阅记录（克隆保留血缘）"""
    subscription_id: str
    listing_id: str
    subscriber_operator_id: str
    subscribed_at: datetime = Field(default_factory=datetime.utcnow)
    cloned_forgekin_id: str
    parent_soul_imprint: str = Field(
        description="原灵智体的灵印（父灵印）"
    )
    new_soul_imprint: str = Field(
        description="克隆体生成的新灵印"
    )
    lineage_edge_id: str = Field(description="F038 谱系边 ID（CLONED）")


class MarketplaceTrade(BaseModel):
    """交易记录（所有权转移）"""
    trade_id: str
    listing_id: str
    buyer_operator_id: str
    seller_operator_id: str
    price_tokens: int
    traded_at: datetime = Field(default_factory=datetime.utcnow)
    soul_imprint_transferred: str = Field(
        description="灵印转移记录（原 operator → 新 operator）"
    )
    lineage_edge_id: str = Field(description="F038 谱系边 ID（TRADED）")


class MarketplaceQuery(BaseModel):
    """市场检索查询"""
    keyword: Optional[str] = None
    capability_query: Optional[str] = None
    species: Optional[str] = None
    layer: Optional[str] = None
    evolution_stage_min: Optional[str] = None
    awakening_stage_max: Optional[str] = None
    listing_type: Optional[str] = None
    sort_by: str = Field(default="wilson_lower_bound_desc")
    top_k: int = Field(default=20, ge=1, le=200)
```

```python
# flowforge/forgemind/marketplace/registry.py
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional

from .models import MarketplaceListing, MarketplaceQuery


class ListingValidationError(Exception):
    """上架校验失败"""


class ListingNotFoundError(Exception):
    pass


class MarketplaceRegistry(ABC):
    """市场注册表（抽象接口，DI 注入）"""

    @abstractmethod
    async def list_item(
        self,
        listing: MarketplaceListing,
    ) -> str:
        """上架灵智体

        前置条件:
        - awakening_stage <= E3（E4+ Evolving 不可上架）
        - evolution_stage >= E2（最低萌芽阶·稳）
        - soul_imprint_hash 已计算且与当前灵印一致
        - capability_summary 已由 F001 生成（Wilson 下界）
        - listing_artifact_ref 指向有效的 YAML 产物包
        - 同一 forgekin_id 无在售 listing

        返回 listing_id
        """
        ...

    @abstractmethod
    async def search(
        self,
        query: MarketplaceQuery,
    ) -> list[MarketplaceListing]:
        """搜索上架条目（接入 OpenSieve 三入口 + RRF 融合）"""
        ...

    @abstractmethod
    async def delist(
        self,
        listing_id: str,
        operator_id: str,
    ) -> None:
        """下架条目（仅 seller 可下架）

        前置条件:
        - listing.seller_operator_id == operator_id
        - listing 未在交易中
        """
        ...

    @abstractmethod
    async def get_listing(
        self,
        listing_id: str,
    ) -> Optional[MarketplaceListing]:
        """查询上架条目详情"""
        ...

    @abstractmethod
    async def subscribe(
        self,
        listing_id: str,
        subscriber_operator_id: str,
    ) -> str:
        """订阅上架条目（克隆保留血缘）

        返回 subscription_id
        """
        ...

    @abstractmethod
    async def trade(
        self,
        listing_id: str,
        buyer_operator_id: str,
        price_tokens: int,
    ) -> str:
        """购买上架条目（转移所有权）

        返回 trade_id
        """
        ...
```

```python
# flowforge/forgemind/marketplace/cloner.py
from __future__ import annotations

from abc import ABC, abstractmethod


class CloneError(Exception):
    pass


class ForgekinCloner(ABC):
    """灵智体克隆器（订阅时克隆保留血缘）"""

    @abstractmethod
    async def clone_for_subscriber(
        self,
        source_forgekin_id: str,
        subscriber_operator_id: str,
    ) -> str:
        """克隆灵智体

        步骤:
        1. 读取 source_forgekin 的完整 CapabilityProfile + 配置
        2. 深拷贝到 subscriber_operator_id 的命名空间
        3. 生成新灵印 new_soul_imprint = SoulImprintGenerator.generate(
              parent=source.soul_imprint, species=source.species)
        4. 写入克隆体血缘字段 parent_soul_imprint = source.soul_imprint
        5. 写入 F038 谱系边（relation=CLONED,
              from=[source.soul_imprint], to=[new_soul_imprint]）
        6. 持久化克隆体到 F008 持久表面
        7. 返回 cloned_forgekin_id
        """
        ...


class OwnershipTransferor(ABC):
    """所有权转移器（交易时转移灵印）"""

    @abstractmethod
    async def transfer_ownership(
        self,
        forgekin_id: str,
        new_operator_id: str,
    ) -> str:
        """转移灵印所有权

        步骤:
        1. 校验 forgekin_id 当前 operator 拥有所有权
        2. 更新 ForgekinBase.operator_id = new_operator_id
        3. 原 operator 保留交易记录（seller_keep_trade_record=True）
        4. 写入 F038 谱系边（relation=TRADED,
              from=[old_operator_id], to=[new_operator_id]）
        5. 返回 trade_id
        """
        ...
```

```python
# flowforge/forgemind/marketplace/hasher.py
from __future__ import annotations

from abc import ABC, abstractmethod
import hashlib


class SoulImprintHasher(ABC):
    """灵印哈希校验器（防篡改锚点）"""

    @abstractmethod
    async def compute_hash(self, soul_imprint: str) -> str:
        """计算灵印 SHA-256 哈希"""
        ...

    @abstractmethod
    async def verify_hash(
        self,
        soul_imprint: str,
        expected_hash: str,
    ) -> bool:
        """校验灵印哈希一致性"""
        ...


class SoulImprintHasherImpl(SoulImprintHasher):
    """默认实现：SHA-256"""

    async def compute_hash(self, soul_imprint: str) -> str:
        return hashlib.sha256(soul_imprint.encode("utf-8")).hexdigest()

    async def verify_hash(
        self,
        soul_imprint: str,
        expected_hash: str,
    ) -> bool:
        actual = await self.compute_hash(soul_imprint)
        # 使用恒定时间比较防时序攻击
        return _constant_time_eq(actual, expected_hash)


def _constant_time_eq(a: str, b: str) -> bool:
    if len(a) != len(b):
        return False
    result = 0
    for x, y in zip(a, b):
        result |= ord(x) ^ ord(y)
    return result == 0
```

```python
# flowforge/forgemind/marketplace/summary.py
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class CapabilitySummaryGenerator(ABC):
    """能力画像摘要生成器（调用 F001 生成 Wilson 下界）"""

    @abstractmethod
    async def generate(
        self,
        forgekin_id: str,
    ) -> dict:
        """生成能力画像摘要

        调用 F001 CapabilityProfile.generate_summary(wilson_lower_bound=True)
        返回结构:
        {
            "strengths": ["..."],         # 擅长（Wilson 下界 Top 3）
            "blind_spots": ["..."],       # 盲点（不暴露完整画像）
            "performance_wilson_lower": 0.78,
            "task_count": 42,
            "evolution_stage": "E3",
            "species": "virtual_forgekin",
        }
        """
        ...


class CapabilitySummaryGeneratorImpl(CapabilitySummaryGenerator):
    def __init__(self, capability_repo: Any) -> None:
        self._cap_repo = capability_repo

    async def generate(self, forgekin_id: str) -> dict:
        profile = await self._cap_repo.get_profile(forgekin_id)
        if profile is None:
            raise ValueError(f"profile not found: {forgekin_id}")
        return profile.generate_summary(wilson_lower_bound=True)
```

```python
# flowforge/forgemind/marketplace/searcher.py
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from .models import MarketplaceListing, MarketplaceQuery


class MarketplaceSearcher(ABC):
    """市场检索器（接入 OpenSieve 三入口）"""

    @abstractmethod
    async def search_by_keyword(
        self,
        keyword: str,
        top_k: int = 20,
    ) -> list[MarketplaceListing]:
        """全文关键词检索（OpenSieve ES BM25）

        索引字段: title / description / capability_summary.strengths
        """
        ...

    @abstractmethod
    async def search_by_capability(
        self,
        capability_query: str,
        top_k: int = 20,
    ) -> list[MarketplaceListing]:
        """语义向量检索（OpenSieve Milvus）

        向量来源: capability_summary 的 embedding
        """
        ...

    @abstractmethod
    async def search_by_filter(
        self,
        species: str | None = None,
        layer: str | None = None,
        evolution_stage_min: str | None = None,
        awakening_stage_max: str | None = None,
        listing_type: str | None = None,
    ) -> list[MarketplaceListing]:
        """图谱索引检索（按 species / layer / stage 多维过滤）"""
        ...

    @abstractmethod
    async def search_federated(
        self,
        query: MarketplaceQuery,
    ) -> list[MarketplaceListing]:
        """三入口 RRF 融合检索

        算法:
        1. 并发调用 keyword / capability / filter 三入口
        2. 对每个候选 listing 计算 RRF 分数:
              rrf_score = sum(1 / (k + rank_in_each_entry))
              k = 60 (RRF 常数)
        3. 仅保留 awakening_stage <= E3 的 listing
        4. 按 rrf_score 降序返回 top_k
        """
        ...
```

```python
# flowforge/forgemind/marketplace/repository.py
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional

from .models import (
    MarketplaceListing,
    MarketplaceQuery,
    MarketplaceSubscription,
    MarketplaceTrade,
)


class MarketplaceRepository(ABC):
    """市场持久层（抽象接口，禁止直接操作数据库）"""

    @abstractmethod
    async def save_listing(self, listing: MarketplaceListing) -> None: ...

    @abstractmethod
    async def get_listing(
        self, listing_id: str
    ) -> Optional[MarketplaceListing]: ...

    @abstractmethod
    async def delist_listing(
        self,
        listing_id: str,
        delisted_at,
    ) -> None: ...

    @abstractmethod
    async def list_listings_by_seller(
        self,
        seller_operator_id: str,
        include_delisted: bool = False,
    ) -> list[MarketplaceListing]: ...

    @abstractmethod
    async def query_listings(
        self,
        query: MarketplaceQuery,
    ) -> list[MarketplaceListing]: ...

    @abstractmethod
    async def save_subscription(
        self, sub: MarketplaceSubscription
    ) -> None: ...

    @abstractmethod
    async def list_subscriptions(
        self, subscriber_operator_id: str
    ) -> list[MarketplaceSubscription]: ...

    @abstractmethod
    async def save_trade(self, trade: MarketplaceTrade) -> None: ...

    @abstractmethod
    async def list_trades_by_seller(
        self, seller_operator_id: str
    ) -> list[MarketplaceTrade]: ...

    @abstractmethod
    async def list_trades_by_buyer(
        self, buyer_operator_id: str
    ) -> list[MarketplaceTrade]: ...
```

### 2.3 数据结构 Pydantic Models

数据结构已在 §2.2 完整定义。核心模型汇总：

| 模型 | 用途 | 关键字段 |
|------|------|---------|
| `MarketplaceListing` | 上架条目 | listing_id / soul_imprint_hash / capability_summary / layer / awakening_stage |
| `MarketplaceSubscription` | 订阅记录（克隆） | subscription_id / parent_soul_imprint / new_soul_imprint / lineage_edge_id |
| `MarketplaceTrade` | 交易记录（转移） | trade_id / soul_imprint_transferred / lineage_edge_id |
| `MarketplaceQuery` | 检索查询 | keyword / capability_query / species / layer / sort_by |

### 2.4 关键算法伪代码

```
算法: list_item(listing)
输入: listing: MarketplaceListing
输出: listing_id: str

1. // 校验觉醒阶上限（E4+ 不可上架）
   IF _stage_rank(listing.awakening_stage) > 3:
      raise ListingValidationError("awakening_stage > E3 not allowed")
2. // 校验进化阶下限（E2+）
   IF _stage_rank(listing.evolution_stage) < 2:
      raise ListingValidationError("evolution_stage < E2 not allowed")
3. // 校验灵印哈希一致性
   forgekin ← forgekin_repo.get(listing.seller_forgekin_id)
   IF NOT await soul_imprint_hasher.verify_hash(
          forgekin.soul_imprint, listing.soul_imprint_hash):
      raise ListingValidationError("soul_imprint_hash mismatch (tamper suspected)")
4. // 校验同一灵智体无在售 listing
   existing ← repository.query_listings(
       MarketplaceQuery(species=None, layer=None, ...))
   FOR l IN existing:
       IF l.seller_forgekin_id == listing.seller_forgekin_id
          AND l.delisted_at IS None:
          raise ListingValidationError("forgekin already listed")
5. listing.created_at ← now()
6. await repository.save_listing(listing)
7. event_bus.publish(ListingCreatedEvent(listing_id=listing.listing_id))
8. RETURN listing.listing_id

算法: subscribe(listing_id, subscriber_operator_id)
输入: listing_id: str, subscriber_operator_id: str
输出: subscription_id: str

1. listing ← repository.get_listing(listing_id)
   IF listing IS None OR listing.delisted_at IS NOT None:
      raise ListingNotFoundError
2. IF listing.listing_type NOT IN ("share", "subscribe"):
      raise ListingValidationError("listing_type not subscribable")
3. // 校验哈希防篡改
   forgekin ← forgekin_repo.get(listing.seller_forgekin_id)
   IF NOT await soul_imprint_hasher.verify_hash(
          forgekin.soul_imprint, listing.soul_imprint_hash):
      raise ListingValidationError("soul_imprint_hash mismatch")
4. // 克隆保留血缘
   cloned_forgekin_id ← await cloner.clone_for_subscriber(
       source_forgekin_id=listing.seller_forgekin_id,
       subscriber_operator_id=subscriber_operator_id)
   // cloner 内部已:
   //   - 生成新灵印 new_soul_imprint
   //   - 写入克隆体 parent_soul_imprint
   //   - 调用 F038 LineageStore.add_edge(CLONED)
5. cloned ← forgekin_repo.get(cloned_forgekin_id)
6. subscription ← MarketplaceSubscription(
       subscription_id=uuid4(),
       listing_id=listing_id,
       subscriber_operator_id=subscriber_operator_id,
       cloned_forgekin_id=cloned_forgekin_id,
       parent_soul_imprint=forgekin.soul_imprint,
       new_soul_imprint=cloned.soul_imprint,
       lineage_edge_id=...,  // 由 cloner 返回
   )
7. await repository.save_subscription(subscription)
8. event_bus.publish(SubscriptionCreatedEvent(subscription_id))
9. RETURN subscription.subscription_id

算法: search_federated(query)
输入: query: MarketplaceQuery
输出: list[MarketplaceListing]

1. // 并发调用三入口
   (kw_results, cap_results, filter_results) ← await asyncio.gather(
       searcher.search_by_keyword(query.keyword, query.top_k),
       searcher.search_by_capability(query.capability_query, query.top_k),
       searcher.search_by_filter(
           species=query.species, layer=query.layer,
           evolution_stage_min=query.evolution_stage_min,
           awakening_stage_max=query.awakening_stage_max,
           listing_type=query.listing_type),
   )
2. // RRF 融合
   rrf_scores: dict[listing_id, float] ← {}
   FOR entry, results IN [("kw", kw_results), ("cap", cap_results),
                            ("filter", filter_results)]:
       FOR rank, listing IN enumerate(results, start=1):
           rrf_scores[listing.listing_id] += 1.0 / (60 + rank)
3. // 取 top_k
   sorted_ids ← sorted(rrf_scores.keys(),
                        key=lambda i: rrf_scores[i], reverse=True)[:top_k]
4. listings ← await repository.get_listings_batch(sorted_ids)
5. // 觉醒阶门控（仅返回 E3 及以下）
   RETURN [l FOR l IN listings
           IF _stage_rank(l.awakening_stage) <= 3]
```

---

## 3. 模块实现

### 3.1 关键代码片段

**MarketplaceRegistryImpl 核心实现**：

```python
# flowforge/forgemind/marketplace/registry_impl.py
from __future__ import annotations

from typing import Optional

from flowforge.core.tracing import get_logger

from .cloner import ForgekinCloner, OwnershipTransferor
from .hasher import SoulImprintHasher
from .models import (
    MarketplaceListing,
    MarketplaceQuery,
    MarketplaceSubscription,
    MarketplaceTrade,
)
from .registry import (
    ListingNotFoundError,
    ListingValidationError,
    MarketplaceRegistry,
)
from .repository import MarketplaceRepository
from .searcher import MarketplaceSearcher
from .summary import CapabilitySummaryGenerator

logger = get_logger(__name__)

_STAGE_RANK = {"E1": 1, "E2": 2, "E3": 3, "E4": 4, "E5": 5, "E6": 6}


class MarketplaceRegistryImpl(MarketplaceRegistry):
    def __init__(
        self,
        repository: MarketplaceRepository,
        searcher: MarketplaceSearcher,
        cloner: ForgekinCloner,
        transferor: OwnershipTransferor,
        hasher: SoulImprintHasher,
        summary_generator: CapabilitySummaryGenerator,
        forgekin_repo,  # F028 ForgekinRepository
        event_bus,
    ) -> None:
        self._repo = repository
        self._searcher = searcher
        self._cloner = cloner
        self._transferor = transferor
        self._hasher = hasher
        self._summary_gen = summary_generator
        self._forgekin_repo = forgekin_repo
        self._event_bus = event_bus

    async def list_item(self, listing: MarketplaceListing) -> str:
        # 觉醒阶门控
        if _STAGE_RANK.get(listing.awakening_stage, 0) > 3:
            raise ListingValidationError(
                f"awakening_stage {listing.awakening_stage} > E3, "
                "E4+ Evolving agents cannot be listed"
            )
        if _STAGE_RANK.get(listing.evolution_stage, 0) < 2:
            raise ListingValidationError(
                f"evolution_stage {listing.evolution_stage} < E2"
            )

        # 哈希校验
        forgekin = await self._forgekin_repo.get(listing.seller_forgekin_id)
        if forgekin is None:
            raise ListingValidationError("forgekin not found")
        if not await self._hasher.verify_hash(
            forgekin.soul_imprint, listing.soul_imprint_hash
        ):
            raise ListingValidationError(
                "soul_imprint_hash mismatch (tamper suspected)"
            )

        # 同一灵智体无在售
        existing = await self._repo.list_listings_by_seller(
            listing.seller_operator_id
        )
        for l in existing:
            if (
                l.seller_forgekin_id == listing.seller_forgekin_id
                and l.delisted_at is None
            ):
                raise ListingValidationError(
                    f"forgekin {listing.seller_forgekin_id} already listed"
                )

        await self._repo.save_listing(listing)
        await self._event_bus.publish(
            {"type": "ListingCreated", "listing_id": listing.listing_id}
        )
        logger.info(
            "listing created",
            extra={"listing_id": listing.listing_id,
                   "forgekin_id": listing.seller_forgekin_id},
        )
        return listing.listing_id

    async def search(
        self, query: MarketplaceQuery
    ) -> list[MarketplaceListing]:
        return await self._searcher.search_federated(query)

    async def delist(self, listing_id: str, operator_id: str) -> None:
        listing = await self._repo.get_listing(listing_id)
        if listing is None:
            raise ListingNotFoundError(listing_id)
        if listing.seller_operator_id != operator_id:
            raise ListingValidationError("only seller can delist")
        from datetime import datetime, timezone
        await self._repo.delist_listing(
            listing_id, datetime.now(timezone.utc)
        )

    async def get_listing(
        self, listing_id: str
    ) -> Optional[MarketplaceListing]:
        return await self._repo.get_listing(listing_id)

    async def subscribe(
        self,
        listing_id: str,
        subscriber_operator_id: str,
    ) -> str:
        listing = await self._repo.get_listing(listing_id)
        if listing is None or listing.delisted_at is not None:
            raise ListingNotFoundError(listing_id)
        if listing.listing_type not in ("share", "subscribe"):
            raise ListingValidationError("listing not subscribable")

        forgekin = await self._forgekin_repo.get(listing.seller_forgekin_id)
        if not await self._hasher.verify_hash(
            forgekin.soul_imprint, listing.soul_imprint_hash
        ):
            raise ListingValidationError("soul_imprint_hash mismatch")

        # 克隆保留血缘（cloner 内部已写 F038 谱系边）
        cloned_id, lineage_edge_id = await self._cloner.clone_for_subscriber(
            source_forgekin_id=listing.seller_forgekin_id,
            subscriber_operator_id=subscriber_operator_id,
        )
        cloned = await self._forgekin_repo.get(cloned_id)

        import uuid
        subscription = MarketplaceSubscription(
            subscription_id=str(uuid.uuid4()),
            listing_id=listing_id,
            subscriber_operator_id=subscriber_operator_id,
            cloned_forgekin_id=cloned_id,
            parent_soul_imprint=forgekin.soul_imprint,
            new_soul_imprint=cloned.soul_imprint,
            lineage_edge_id=lineage_edge_id,
        )
        await self._repo.save_subscription(subscription)
        await self._event_bus.publish(
            {"type": "SubscriptionCreated",
             "subscription_id": subscription.subscription_id}
        )
        return subscription.subscription_id

    async def trade(
        self,
        listing_id: str,
        buyer_operator_id: str,
        price_tokens: int,
    ) -> str:
        listing = await self._repo.get_listing(listing_id)
        if listing is None or listing.delisted_at is not None:
            raise ListingNotFoundError(listing_id)
        if listing.listing_type != "trade":
            raise ListingValidationError("listing not tradeable")

        forgekin = await self._forgekin_repo.get(listing.seller_forgekin_id)
        if not await self._hasher.verify_hash(
            forgekin.soul_imprint, listing.soul_imprint_hash
        ):
            raise ListingValidationError("soul_imprint_hash mismatch")

        # 转移所有权（transferor 内部已写 F038 谱系边）
        trade_id, lineage_edge_id = await self._transferor.transfer_ownership(
            forgekin_id=listing.seller_forgekin_id,
            new_operator_id=buyer_operator_id,
        )

        import uuid
        trade = MarketplaceTrade(
            trade_id=str(uuid.uuid4()),
            listing_id=listing_id,
            buyer_operator_id=buyer_operator_id,
            seller_operator_id=listing.seller_operator_id,
            price_tokens=price_tokens,
            soul_imprint_transferred=forgekin.soul_imprint,
            lineage_edge_id=lineage_edge_id,
        )
        await self._repo.save_trade(trade)
        # 下架原 listing
        from datetime import datetime, timezone
        await self._repo.delist_listing(
            listing_id, datetime.now(timezone.utc)
        )
        await self._event_bus.publish(
            {"type": "TradeCompleted", "trade_id": trade.trade_id}
        )
        return trade.trade_id
```

### 3.2 关键流程时序图

**订阅克隆流时序**：

```
operator B  MarketplaceRegistry   ForgekinCloner   F038 LineageStore   F028 ForgekinRepo   Repository
   │              │                     │                 │                  │                  │
   │ subscribe    │                     │                 │                  │                  │
   ├─────────────►│ get_listing         │                 │                  │                  │
   │              ├─────────────────────────────────────────────────────────────────────────────►│
   │              │◄─────────────────────────────────────────────────────────────────────────────│
   │              │ verify_hash          │                 │                  │                  │
   │              │ (soul_imprint_hash)  │                 │                  │                  │
   │              │ clone_for_subscriber │                 │                  │                  │
   │              ├────────────────────►│ get source forgekin                │                  │
   │              │                     ├────────────────────────────────────►│                  │
   │              │                     │◄───────────────────────────────────│ forgekin         │
   │              │                     │ deep copy + gen new_soul_imprint   │                  │
   │              │                     │ save cloned forgekin               │                  │
   │              │                     ├────────────────────────────────────►│                  │
   │              │                     │ add_edge(CLONED)                                                            │
   │              │                     ├───────────────►│ edge_id                              │                  │
   │              │                     │◄───────────────│                  │                  │
   │              │◄────────────────────┤ (cloned_id, edge_id)               │                  │
   │              │ save_subscription                                                                                            │
   │              ├─────────────────────────────────────────────────────────────────────────────►│
   │ sub_id       │                                                                                                            │
   │◄─────────────┤                                                                                                            │
```

### 3.3 错误处理

| 异常类型 | 触发条件 | 处理策略 |
|---------|---------|---------|
| `ListingValidationError` | 觉醒阶 > E3 / 进化阶 < E2 / 哈希不匹配 / 已在售 / listing_type 不匹配 | 返回 422，附详细错误字段 |
| `ListingNotFoundError` | listing_id 不存在 / 已下架 | 返回 404 |
| `SoulImprintTamperError` | 灵印哈希校验失败 | 返回 403，记录安全审计日志（疑似篡改） |
| `CloneError` | 克隆过程中 F028 ForgekinRepo 写入失败 | 回滚已生成的新灵印，订阅失败 |
| `OwnershipTransferError` | 灵印所有权转移失败 / F038 谱系边写入失败 | 交易回滚，原 operator 保留控制权 |
| `OpenSieveUnavailableError` | OpenSieve 服务不可用 | 检索降级为仅图谱过滤（filter-only），返回 503 提示"语义检索暂不可用" |
| `RepositoryTimeoutError` | 持久层超时 | 重试 3 次后返回 503 |
| `StageRankError` | awakening_stage / evolution_stage 字段值不在 E1-E6 范围 | 返回 422 |

**回滚策略**：
- 订阅克隆失败时，已写入克隆体通过 `ForgekinRepo.delete(cloned_id)` 删除，已写入的谱系边通过 `LineageStore.mark_invalid(edge_id)` 标记无效
- 交易失败时，原 operator 控制权不变，已写入的谱系边同样标记无效

### 3.4 性能优化

| 性能指标 | SLO | 优化手段 |
|---------|:----:|---------|
| `list_item` 延迟 | P95 < 300ms | 哈希计算 SHA-256 微秒级；Repository 单表 INSERT |
| `search` 延迟 | P95 < 500ms | OpenSieve 三入口并发（asyncio.gather）；RRF 融合 O(n) |
| `subscribe` 延迟 | P95 < 1s | 克隆涉及深拷贝 + 谱系写入，建议拆分为异步任务 |
| `trade` 延迟 | P95 < 500ms | 转移所有权仅更新 operator_id + 谱系边 |
| 上架条目列表查询 | P95 < 100ms | seller_operator_id / species / layer 建索引 |

**优化策略**：
1. **异步克隆**：`subscribe` 提供 `subscribe_async` 版本，返回 task_id，通过 `get_subscribe_status(task_id)` 查询进度
2. **OpenSieve 三入口并发**：使用 `asyncio.gather` 并发调用，任一入口失败则降级为剩余入口融合
3. **缓存**：`get_listing(listing_id)` 结果以 listing_id 为 key 缓存 5 分钟，下架 / 交易后失效
4. **批量上架**：`list_items_batch(listings)` 支持一次上架多个灵智体（最多 20 个）
5. **检索降级**：OpenSieve 不可用时自动降级为仅图谱过滤（不报错）

### 3.5 配置示例

`flowforge/forgemind/config/marketplace.yaml`：

```yaml
forgekin_marketplace:
  listing:
    require_capability_summary: true
    require_evolution_stage_min: E2
    require_awakening_stage_max: E3
    auto_generate_summary_from_profile: true
    hash_algorithm: sha256
    one_listing_per_forgekin: true

  subscription:
    clone_strategy: retain_lineage
    new_soul_imprint: true
    write_to_lineage: true
    async_clone: true
    clone_timeout_seconds: 60

  trade:
    transfer_soul_imprint: true
    seller_keep_trade_record: true
    require_operator_approval: false
    auto_delist_after_trade: true

  search:
    index_fields: [title, description, capability_summary, species, layer]
    default_sort: wilson_lower_bound_desc
    rrf_k: 60
    top_k_default: 20
    top_k_max: 200
    opensieve:
      endpoint: http://localhost:8100
      timeout_seconds: 5
      fallback_to_filter_only: true

  audit:
    log_all_listings: true
    log_all_subscriptions: true
    log_all_trades: true
    alert_on_tamper: true

  performance:
    cache_listing_ttl_seconds: 300
    batch_listing_max_size: 20
    repository_retry_count: 3
```

---

## 4. 跨模块协作实现

### 4.1 上游依赖如何调用

| 上游模块 | 调用入口 | 调用时机 | 数据流 |
|---------|---------|---------|--------|
| **F001 CapabilityProfile** | `CapabilityProfile.generate_summary(wilson_lower_bound=True)` | 上架时由 CapabilitySummaryGenerator 调用 | 单向：读 |
| **F008 Durable State Surfaces** | `DurableStateStore.save("marketplace_listing", ...)` | 持久化 listing / subscription / trade | 单向：写 |
| **F027 多形态智能体** | `ForgekinSpecies` 枚举值 | 上架时记录 species 字段 | 单向：读 |
| **F028 ForgePipeline** | `ForgekinRepo.get(forgekin_id)` | 上架 / 订阅 / 交易时读取灵智体 | 单向：读 |
| **F036 ForgeRelationship** | `ForgeRelationshipManager.get_relationship(forgekin_id)` | 上架时校验 layer 字段 | 单向：读 |
| **F038 LineageStore** | `LineageStore.add_edge(CLONED / TRADED)` | 订阅 / 交易时写入谱系边 | 单向：写 |
| **OpenSieve** | `OpenSieveClient.search_grep() / search_semantic() / search_index()` | 检索时通过三入口 + RRF | 单向：读 |
| **EventBus** | `EventBus.publish(ListingCreatedEvent / ...)` | 上架 / 订阅 / 交易完成时 | 单向：发布 |

### 4.2 下游影响如何被调用

| 下游模块 | 被调用入口 | 调用方 | 时机 |
|---------|-----------|-------|------|
| **F038 LineageStore** | `add_edge(CLONED)` / `add_edge(TRADED)` | ForgekinCloner / OwnershipTransferor | 订阅 / 交易时 |
| **F039 Mind Codex** | `MindCodexStore.add_entry()` | 新 operator 订阅后可选 | 将灵智体的 SkillPackage 写入自己的锻典 |
| **F028 ForgePipeline** | — | ForgekinCloner 内部 | 克隆时调用流水线第 3 步预加载相关锻典条目 |
| **operator 控制台** | HTTP API `GET /api/v7/marketplace/listings` | operator UI | 市场浏览 / 上架 / 订阅 |
| **EventBus 订阅者** | `ListingCreatedEvent` / `SubscriptionCreatedEvent` / `TradeCompletedEvent` | dashboard / 通知系统 | 异步消费 |

### 4.3 集成测试点

- **T1 单元层**：
  - `MarketplaceRegistryImpl.list_item` 各校验分支（觉醒阶 / 进化阶 / 哈希 / 已在售）单测
  - `SoulImprintHasherImpl` 哈希一致性 + 恒定时间比较单测
  - `search_federated` RRF 融合算法单测（三入口结果聚合）
- **T2 跨模块集成层**：
  - `subscribe` 全链路：F028 → F038 → F008 三方原子写入
  - `trade` 全链路：F028 灵印转移 + F038 谱系边 + 自动下架
  - `search` 接入 OpenSieve 真实服务（localhost:8100），三入口返回真实结果
- **T3 E2E 层（遵守 T1-T8 测试铁律）**：
  - 真实 operator A 通过 F028 锻造灵智体（六步流水线完整执行，真实 LLM 生成能力画像）
  - 真实 operator A 上架到市场，验证 listing 字段完整 + 哈希正确
  - 真实 operator B 通过市场检索发现该 listing（OpenSieve 三入口真实调用）
  - 真实 operator B 订阅，验证克隆体新灵印生成 + F038 谱系边 CLONED 写入
  - 真实 operator B 购买另一个 trade 类型 listing，验证灵印转移 + 原 operator 保留交易记录
  - 验证 E4+ 灵智体上架被拒绝
- **T4 异常路径**：
  - 篡改灵印后哈希不匹配，上架被拒绝且审计日志记录
  - OpenSieve 不可用时检索降级为 filter-only
  - 克隆过程中 F038 写入失败 → 回滚已生成的克隆体

---

## 5. 详细设计验收

### 5.1 功能验收 AC

- [ ] **AC-1**：`MarketplaceListing` 字段完整（含 soul_imprint_hash / capability_summary / layer / evolution_stage / awakening_stage / species / listing_artifact_ref）
- [ ] **AC-2**：`list_item` 觉醒阶 > E3 上架被拒绝（ListingValidationError）
- [ ] **AC-3**：`list_item` 进化阶 < E2 上架被拒绝
- [ ] **AC-4**：`list_item` 灵印哈希不一致上架被拒绝（防篡改）
- [ ] **AC-5**：`list_item` 同一灵智体无在售 listing 校验通过
- [ ] **AC-6**：`subscribe` 克隆保留父灵印血缘，克隆体生成新灵印
- [ ] **AC-7**：`subscribe` 写入 F038 谱系边（CLONED 关系）
- [ ] **AC-8**：`trade` 转移灵印所有权，原 operator 保留交易记录
- [ ] **AC-9**：`trade` 写入 F038 谱系边（TRADED 关系）+ 自动下架 listing
- [ ] **AC-10**：`search_federated` 三入口 RRF 融合，仅返回 E3 及以下 listing
- [ ] **AC-11**：`delist` 仅 seller 可下架
- [ ] **AC-12**：`capability_summary` 由 F001 CapabilityProfile.generate_summary(wilson_lower_bound=True) 生成，禁止手动构造

### 5.2 性能验收

- [ ] **AC-13**：`list_item` P95 延迟 < 300ms
- [ ] **AC-14**：`search` P95 延迟 < 500ms（OpenSieve 三入口并发）
- [ ] **AC-15**：`subscribe` 异步版本提交后 1s 内返回 task_id，整个克隆 P95 < 60s
- [ ] **AC-16**：`trade` P95 延迟 < 500ms
- [ ] **AC-17**：`get_listing` 缓存命中率 > 80%

### 5.3 安全验收

- [ ] **AC-18**：所有上架 / 订阅 / 交易记录通过 Repository 层持久化（无直接数据库操作）
- [ ] **AC-19**：灵印哈希使用 SHA-256 + 恒定时间比较（防时序攻击）
- [ ] **AC-20**：哈希不匹配触发安全审计日志（疑似篡改告警）
- [ ] **AC-21**：原 operator 在交易后失去灵智体控制权（forgekin.operator_id 更新）
- [ ] **AC-22**：operator_id 字段不可由 listing 修改（仅由 transfer_ownership 修改）

### 5.4 Eval 验收

- [ ] **AC-23**：上架灵智体的 capability_summary 包含 Wilson 下界（保守估计，避免小样本高估）
- [ ] **AC-24**：订阅后克隆体的初始 Eval 分数继承自父灵智体
- [ ] **AC-25**：F040 控制面将市场流通次数作为灵智体增值信号（marketplace_circulation_count）
- [ ] **AC-26**：订阅克隆成功率作为 F040 市场组件健康指标

---

## 6. 引用

- [doc:../spec.md#§3.13]（FR-CORE-013 灵智体市场 + 进化谱系）
- [doc:../arch.md#§3.13]（灵智体市场 + 进化谱系架构）
- [doc:../architecture/A037-forgemind-marketplace.md]（同号 Feature 级 SAD）
- [doc:../features/F037-forgemind-marketplace.md]（同号 Feature 级 SRS）
- [doc:../features/F001-capability-profile.md]（能力画像）
- [doc:../features/F008-durable-state-surfaces.md]（Durable State Surfaces）
- [doc:../features/F027-all-things-spirit-species.md]（多形态智能体形态分类）
- [doc:../features/F028-forging-pipeline.md]（锻造流水线）
- [doc:../features/F036-forgemind-forge-relationship.md]（forgemind 与 *Forge 关系）
- [doc:../features/F038-forgemind-lineage.md]（进化谱系）
- [doc:../features/F039-mind-codex-searchable.md]（灵典可检索知识库）
- [doc:../features/F040-harness-eval-control-plane.md]（Harness Eval 控制面）
- [doc:../decisions/005-forgemind-application-layer.md]（forgemind 应用层 ADR）
- [doc:../design/naming-contract.md#2.6]（灵印 Soul Imprint）
- [doc:../design/naming-contract.md#2.10]（进化阶 Evolution Stage）
- [doc:../design/naming-contract.md#2.11]（觉醒阶 Awakening Stage）
- [doc:../../../hiclaw/rules.md#第二部分]（原则 2 所有数据检索走 OpenSieve）
- [doc:../../../hiclaw/rules.md#第七部分]（编程红线第 10/11/12/13 条）
- [doc:../../../hiclaw/rules.md#第十一部分]（软件工程文档分层规范）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（详细设计骨架，应用 9 大点名称修订；含 Pydantic Models / 接口实现 / RRF 算法 / 时序图 / 配置示例 / 跨模块协作 / 验收 AC） | 开发者灵智体（猎犬·夏洛克） |
