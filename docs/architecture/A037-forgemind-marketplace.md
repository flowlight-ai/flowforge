# A037: 灵智体市场架构设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师灵智体（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.13]（FR-CORE-013）
> **对应 arch.md**: [doc:../arch.md#§3.13]
> **对应 design.md**: [doc:../design.md#§3.13]（待创建）
> **对应 Feature**: [doc:../features/F037-forgemind-marketplace.md]（同号 Feature 级 SRS）
> **对应详细设计**: [doc:../design/D037-forgemind-marketplace.md]（待创建，同号 Feature 级 SDD）
> **依赖 ADR**: [doc:../decisions/005-forgemind-application-layer.md]
> **9 大点名称修订**: 已应用（双轨命名 + AI 术语优先 + 弱化万物 + 去 AGI 化）

---

## 1. 架构上下文

### 1.1 架构问题

本 Feature 在架构层解决以下问题：forgemind 应用层需要一个统一的灵智体市场（Forgekin Marketplace），让用户可分享、订阅、交易自己锻造的灵智体（Forgekin，社区社交称"灵智体"）。市场作为灵智体流通的工程底座，需解决四个子问题：

- **上架契约**：什么样的灵智体可以上架? 能力画像摘要如何展示? 灵印（Mind Imprint）作为身份锚点如何防篡改?
- **订阅克隆血缘**：订阅时如何克隆灵智体并保留血缘? 父灵印如何关联到克隆体的新灵印?
- **交易所有权转移**：交易时灵印如何随之转移? 原 operator 如何保留交易记录?
- **跨层兼容**：市场是否同时支持 forgemind 通用灵智体与 *Forge 垂直灵智体? 跨层流通如何与 F036 联动?

### 1.2 架构约束

- **单向依赖约束**：市场模块属于 forgemind 应用层（Layer 2），单向依赖 FlowForge 核心框架层（Layer 1），绝对禁止 import 任何 *Forge 模块
- **DI 容器约束**：MarketplaceRegistry / ForgekinCloner 必须通过 DI 容器注入，禁止绕过 DI 容器直接实例化（编程红线第 12 条）
- **Repository 层约束**：上架条目 / 订阅记录 / 交易记录必须通过 Repository 层持久化，禁止直接操作数据库（编程红线第 13 条）
- **配置驱动约束**：listing / subscription / trade / search 规则必须外置 YAML 配置，禁止硬编码（编程红线第 11 条）
- **灵印不可变约束**：上架时记录 soul_imprint_hash，交易 / 订阅时校验哈希一致，防止灵智体被篡改后流通（arch.md §5.1 灵印 Mind Imprint 不可变）
- **能力画像隐私约束**：上架时仅展示能力画像摘要（擅长 + 盲点 + 历史表现 Wilson 下界），不暴露完整画像
- **觉醒阶上限约束**：上架最高觉醒阶 E3（受限自主阶），E4+ Evolving 状态灵智体不可上架（安全考虑）

### 1.3 架构影响

- **对 forgemind 应用层（Layer 2）的影响**：新增 `flowforge/forgemind/marketplace/` 模块，承载 MarketplaceRegistry / ForgekinCloner / MarketplaceSearcher
- **对 F001 CapabilityProfile 的影响**：能力画像模块需提供 `generate_summary()` 接口生成上架摘要
- **对 F027 多形态智能体形态分类的影响**：市场上架条目包含 species 字段，支持按形态过滤检索
- **对 F028 ForgePipeline 的影响**：流水线产出的灵智体可作为市场上架源，市场是流水线的输出通道之一
- **对 F036 forgemind 与 *Forge 关系的影响**：市场上架条目新增 layer 字段区分通用 / 垂直承载层
- **对 F038 进化谱系的影响**：订阅克隆与交易转移必须写入谱系边（CLONED / TRADED 关系类型）
- **对 OpenSieve 的影响**：市场上架条目的全文检索 / 向量检索通过 OpenSieve 统一入口（铁律 §2.2）

---

## 2. 架构设计

### 2.1 组件架构图

```
┌──────────────────────────────────────────────────────────────────────┐
│ Layer 3: *Forge 垂直业务层（市场消费者 / 生产者）                      │
│  ContentForge / DevForge / NovelForge / MallForge                     │
│  通过 Plugin V3 register_forgekins() 注册垂直灵智体到市场             │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Layer 2: forgemind 应用层                                             │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ flowforge/forgemind/marketplace/                               │  │
│  │                                                                │  │
│  │  ┌──────────────────┐    ┌──────────────────┐                 │  │
│  │  │ MarketplaceRegistry│   │ ForgekinCloner   │                 │  │
│  │  │  ├─ list_item()  │    │  ├─ clone_for_   │                 │  │
│  │  │  ├─ search()     │    │  │   subscriber()│                 │  │
│  │  │  ├─ delist()     │    │  └─ transfer_   │                 │  │
│  │  │  └─ get_listing()│    │      ownership()│                 │  │
│  │  └────────┬─────────┘    └────────┬─────────┘                 │  │
│  │           │                       │                           │  │
│  │  ┌────────▼─────────────────────────▼──────────────────────┐  │  │
│  │  │ MarketplaceSearcher（接入 OpenSieve）                    │  │  │
│  │  │  ├─ search_by_keyword()    全文检索                     │  │  │
│  │  │  ├─ search_by_capability() 语义向量检索                 │  │  │
│  │  │  └─ search_federated()     RRF 多源融合检索             │  │  │
│  │  └──────────────────────────────────────────────────────────┘  │  │
│  │                                                                │  │
│  │  ┌──────────────────────────────────────────────────────────┐  │  │
│  │  │ MarketplaceRepository（持久层）                          │  │  │
│  │  │  ├─ save_listing()                                       │  │  │
│  │  │  ├─ save_subscription()                                  │  │  │
│  │  │  └─ save_trade()                                         │  │  │
│  │  └──────────────────────────────────────────────────────────┘  │  │
│  │                                                                │  │
│  │  ┌──────────────────────────────────────────────────────────┐  │  │
│  │  │ SoulImprintHasher（灵印哈希校验器）                      │  │  │
│  │  │  ├─ compute_hash()  上架时计算灵印哈希                  │  │  │
│  │  │  └─ verify_hash()   交易/订阅时校验哈希一致性           │  │  │
│  │  └──────────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────┬─────────────────────────────────────┘
                                 │ 单向依赖
                                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Layer 1: FlowForge 核心框架层                                         │
│  ├─ F001 CapabilityProfile.generate_summary()  能力画像摘要          │
│  ├─ F008 Durable State Surfaces                持久化支撑            │
│  ├─ F014 Memory Collection / F039 Mind Codex   灵智体状态快照        │
│  └─ OpenSieve Client                           全文+向量检索统一入口 │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.2 关键架构决策

- **决策 1：市场作为 forgemind 应用层模块（非独立项目）**
  - 理由：市场是灵智体流通的工程底座，与锻造流水线 / 进化谱系同属 forgemind 应用层。独立项目会破坏单向依赖（市场需要访问 forgemind 的 ForgekinBase / ForgekinSpecies）
  - 替代方案：独立 marketplace 项目 → 需重复实现 ForgekinBase 等抽象，违反 DRY 原则
- **决策 2：克隆保留血缘，交易转移所有权（两种流通模式分离）**
  - 理由：订阅是"复制"语义（原 operator 保留控制权，克隆体生成新灵印），交易是"转移"语义（原 operator 失去控制权，灵印随之转移）。两种语义混合会导致灵印所有权混乱
  - 替代方案：统一为"复制"模式 → 交易后原 operator 仍可控制灵智体，违反交易契约
- **决策 3：上架能力画像仅展示摘要（Wilson 下界）**
  - 理由：完整能力画像包含盲点 / 历史表现等敏感数据，上架公开展示会泄露灵智体的脆弱性。Wilson 下界是保守估计，避免小样本高估
  - 替代方案：展示完整画像 → 灵智体弱点暴露，可能被恶意利用
- **决策 4：上架最高觉醒阶 E3（受限自主阶）**
  - 理由：E4+ Evolving 状态灵智体具有自主进化能力，流通后可能脱离原 operator 控制边界。E3 及以下灵智体仍在 operator 监督下，流通安全
  - 替代方案：允许 E4+ 上架 → 自进化灵智体流通后可能违反原 operator 价值观约束
- **决策 5：检索走 OpenSieve 统一入口**
  - 理由：铁律 §2.2 要求"所有数据检索走 OpenSieve"。市场检索需同时支持全文（关键词匹配 title/description）与语义（能力画像向量匹配），OpenSieve 已提供 RRF 多源融合
  - 替代方案：市场自建检索引擎 → 违反铁律，且重复造轮子
- **决策 6：所有订阅 / 交易写入 F038 进化谱系**
  - 理由：订阅克隆和交易转移都是灵智体生命周期的重要事件，必须可追溯。F038 已定义 CLONED / TRADED 关系类型
  - 替代方案：独立存储流通记录 → 谱系断裂，无法回答"这个灵智体被多少 operator 订阅过"

### 2.3 架构不变量

- 市场模块必须单向依赖 FlowForge 核心框架层，绝对禁止 import 任何 *Forge 模块
- 上架条目必须包含 soul_imprint_hash 字段，交易 / 订阅时必须校验哈希一致性
- 订阅克隆必须保留父灵印血缘，克隆体必须生成新灵印
- 交易转移必须转移灵印所有权，原 operator 必须保留交易记录
- 上架最高觉醒阶必须为 E3，E4+ Evolving 状态灵智体不可上架
- 上架能力画像必须仅展示摘要，禁止暴露完整画像
- 所有上架 / 订阅 / 交易记录必须通过 Repository 层持久化
- 所有检索必须通过 OpenSieve 统一入口
- 所有订阅 / 交易必须写入 F038 进化谱系
- 所有市场规则必须外置 YAML 配置，禁止硬编码

---

## 3. 模块设计

### 3.1 模块边界

- **MarketplaceRegistry（`flowforge/forgemind/marketplace/registry.py`）**：市场上架 / 下架 / 查询注册表
- **ForgekinCloner（`flowforge/forgemind/marketplace/cloner.py`）**：灵智体克隆器，订阅时克隆保留血缘
- **OwnershipTransferor（`flowforge/forgemind/marketplace/transferor.py`）**：所有权转移器，交易时转移灵印
- **MarketplaceSearcher（`flowforge/forgemind/marketplace/searcher.py`）**：市场检索器，接入 OpenSieve 全文 + 语义 + RRF 融合
- **SoulImprintHasher（`flowforge/forgemind/marketplace/hasher.py`）**：灵印哈希校验器，防篡改
- **MarketplaceRepository（`flowforge/forgemind/marketplace/repository.py`）**：持久层，存储 listing / subscription / trade 记录
- **CapabilitySummaryGenerator（`flowforge/forgemind/marketplace/summary.py`）**：能力画像摘要生成器，调用 F001 生成 Wilson 下界摘要
- **models（`flowforge/forgemind/marketplace/models.py`）**：数据模型（MarketplaceListing / MarketplaceSubscription / MarketplaceTrade）

### 3.2 接口契约

```python
from abc import ABC, abstractmethod
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class MarketplaceListing(BaseModel):
    """市场上架条目"""
    listing_id: str
    seller_forgekin_id: str
    seller_operator_id: str
    title: str
    description: str
    species: str = Field(description="ForgekinSpecies 来自 F027")
    capability_summary: dict = Field(description="能力画像摘要（Wilson 下界）")
    layer: str = Field(description="ForgeLayer 来自 F036")
    evolution_stage: str = Field(description="Evolution Stage E1-E6")
    awakening_stage: str = Field(description="Awakening Stage E1-E6")
    listing_type: str = Field(description="share | subscribe | trade")
    price_tokens: Optional[int] = None
    soul_imprint_hash: str = Field(description="灵印哈希（防篡改锚点）")
    listing_artifact_ref: str = Field(description="上架产物包引用")
    created_at: datetime


class MarketplaceSubscription(BaseModel):
    """订阅记录"""
    subscription_id: str
    listing_id: str
    subscriber_operator_id: str
    subscribed_at: datetime
    cloned_forgekin_id: str = Field(description="克隆到订阅者的灵智体 ID")
    lineage_link: str = Field(description="F038 进化谱系边 ID")


class MarketplaceTrade(BaseModel):
    """交易记录"""
    trade_id: str
    listing_id: str
    buyer_operator_id: str
    seller_operator_id: str
    price_tokens: int
    traded_at: datetime
    soul_imprint_transferred: str = Field(description="灵印转移记录")


class MarketplaceRegistry(ABC):
    """市场注册表（抽象接口）"""

    @abstractmethod
    async def list_item(self, listing: MarketplaceListing) -> str:
        """上架灵智体

        前置条件:
        - awakening_stage <= E3（E4+ 不可上架）
        - soul_imprint_hash 已计算
        - capability_summary 已生成（Wilson 下界）
        """
        ...

    @abstractmethod
    async def search(
        self, query: "MarketplaceQuery"
    ) -> list[MarketplaceListing]:
        """搜索上架条目（接入 OpenSieve）"""
        ...

    @abstractmethod
    async def delist(
        self, listing_id: str, operator_id: str
    ) -> None:
        """下架条目（仅 seller 可下架）"""
        ...

    @abstractmethod
    async def get_listing(
        self, listing_id: str
    ) -> Optional[MarketplaceListing]:
        """查询上架条目详情"""
        ...


class ForgekinCloner(ABC):
    """灵智体克隆器（订阅时克隆）"""

    @abstractmethod
    async def clone_for_subscriber(
        self,
        source_forgekin_id: str,
        subscriber_operator_id: str,
    ) -> str:
        """克隆灵智体（保留父灵印血缘，生成新灵印）

        副作用:
        - 写入 F038 谱系边（CLONED 关系）
        - 更新 MarketplaceRepository
        """
        ...


class OwnershipTransferor(ABC):
    """所有权转移器（交易时转移）"""

    @abstractmethod
    async def transfer_ownership(
        self,
        forgekin_id: str,
        new_operator_id: str,
    ) -> str:
        """转移灵印所有权

        副作用:
        - 原 operator 失去控制权
        - 灵印随之转移
        - 写入 F038 谱系边（TRADED 关系）
        - 更新 MarketplaceRepository
        """
        ...


class SoulImprintHasher(ABC):
    """灵印哈希校验器"""

    @abstractmethod
    async def compute_hash(self, soul_imprint: str) -> str:
        """计算灵印哈希（SHA-256）"""
        ...

    @abstractmethod
    async def verify_hash(
        self, soul_imprint: str, expected_hash: str
    ) -> bool:
        """校验灵印哈希一致性（防篡改）"""
        ...


class MarketplaceRepository(ABC):
    """市场持久层（抽象接口，禁止直接操作数据库）"""

    @abstractmethod
    async def save_listing(self, listing: MarketplaceListing) -> None: ...

    @abstractmethod
    async def save_subscription(
        self, sub: MarketplaceSubscription
    ) -> None: ...

    @abstractmethod
    async def save_trade(self, trade: MarketplaceTrade) -> None: ...

    @abstractmethod
    async def list_trades_by_seller(
        self, seller_operator_id: str
    ) -> list[MarketplaceTrade]: ...
```

### 3.3 数据流

```
订阅流（share / subscribe）:
  ┌────────────────┐
  │ operator A     │
  │ 锻造灵智体     │
  │ (awakening<=E3)│
  └────────┬───────┘
           │ 1. list_item()
           ▼
  ┌────────────────────────────────────────────┐
  │ MarketplaceRegistry                        │
  │  ├─ 校验上架前置条件                       │
  │  │   (awakening<=E3 / soul_imprint_hash)   │
  │  ├─ CapabilitySummaryGenerator.generate()  │
  │  │   调用 F001 生成 Wilson 下界摘要        │
  │  ├─ SoulImprintHasher.compute_hash()       │
  │  └─ MarketplaceRepository.save_listing()   │
  └────────┬───────────────────────────────────┘
           │ 2. operator B 搜索发现
           ▼
  ┌────────────────────────────────────────────┐
  │ MarketplaceSearcher                        │
  │  ├─ search_by_keyword()  OpenSieve 全文    │
  │  ├─ search_by_capability() OpenSieve 语义  │
  │  └─ search_federated()  OpenSieve RRF 融合 │
  └────────┬───────────────────────────────────┘
           │ 3. operator B 订阅
           ▼
  ┌────────────────────────────────────────────┐
  │ ForgekinCloner                             │
  │  ├─ clone_for_subscriber()                 │
  │  ├─ 保留父灵印血缘（parent_soul_imprint）  │
  │  ├─ 生成新灵印（new_soul_imprint）         │
  │  ├─ 写入 F038 谱系边（CLONED 关系）        │
  │  └─ MarketplaceRepository.save_subscription│
  └────────┬───────────────────────────────────┘
           │
           ▼
  ┌────────────────┐    ┌────────────────┐
  │ operator A     │    │ operator B     │
  │ 保留原灵智体   │    │ 获得克隆体     │
  │ (原灵印不变)   │    │ (新灵印+血缘)  │
  └────────────────┘    └────────────────┘

交易流（trade）:
  ┌────────────────┐
  │ operator A     │
  │ 上架灵智体     │
  └────────┬───────┘
           │ 1. operator B 购买
           ▼
  ┌────────────────────────────────────────────┐
  │ OwnershipTransferor                        │
  │  ├─ transfer_ownership()                   │
  │  ├─ 校验 soul_imprint_hash 一致性          │
  │  ├─ 灵印所有权转移（A 失去控制权）         │
  │  ├─ 写入 F038 谱系边（TRADED 关系）        │
  │  └─ MarketplaceRepository.save_trade()     │
  └────────┬───────────────────────────────────┘
           │
           ▼
  ┌────────────────┐    ┌────────────────┐
  │ operator A     │    │ operator B     │
  │ 失去控制权     │    │ 获得灵印所有权 │
  │ 保留交易记录   │    │ 完整继承灵智体 │
  └────────────────┘    └────────────────┘
```

---

## 4. 跨模块协作

### 4.1 上游依赖

- **F001 CapabilityProfile**：上架时调用 `generate_summary()` 生成能力画像摘要（Wilson 下界），不暴露完整画像
- **F008 Durable State Surfaces**：上架条目 / 订阅 / 交易记录持久化复用 F008 持久表面
- **F027 多形态智能体形态分类**：上架条目包含 species 字段，支持按形态过滤检索
- **F028 ForgePipeline**：流水线产出的灵智体可作为市场上架源
- **F036 forgemind 与 *Forge 关系**：上架条目包含 layer 字段，区分通用 / 垂直承载层
- **OpenSieve**：市场全文检索 + 语义检索 + RRF 融合通过 OpenSieve 统一入口
- **ADR 005 forgemind 应用层**：本 Feature 是 ADR 005 的具体落地

### 4.2 下游影响

- **F038 进化谱系**：订阅克隆写入 CLONED 谱系边，交易转移写入 TRADED 谱系边，市场是谱系的输入源之一
- **F039 灵典可检索知识库**：交易 / 订阅后，新 operator 可将灵智体的 SkillPackage 写入自己的灵典
- **所有 *Forge 项目**：*Forge 可通过 Plugin V3 `register_forgekins()` 钩子将垂直灵智体注册到市场
- **operator 工作流**：operator 可通过市场订阅他人锻造的灵智体，加速育灵进程

### 4.3 跨模块不变量

- 上架条目的 soul_imprint_hash 必须与灵智体当前灵印一致，否则拒绝上架
- 订阅克隆必须同时写入 MarketplaceRepository 与 F038 LineageStore（CLONED 边）
- 交易转移必须同时写入 MarketplaceRepository 与 F038 LineageStore（TRADED 边）
- 上架条目的 capability_summary 必须由 F001 CapabilityProfile 生成，禁止手动构造
- 市场检索必须通过 OpenSieve，禁止绕过统一入口
- 上架灵智体的 awakening_stage 必须 ≤ E3，E4+ 灵智体禁止上架

---

## 5. 架构验收

### 5.1 架构契约验收

- [ ] AC-1: 单向依赖通过——marketplace 模块不 import 任何 *Forge 模块
- [ ] AC-2: DI 容器注入通过——MarketplaceRegistry / ForgekinCloner 通过 DI 容器注入
- [ ] AC-3: Repository 层通过——MarketplaceRepository 抽象存在且实现层不直接操作数据库
- [ ] AC-4: 配置驱动通过——listing / subscription / trade / search 规则外置 YAML
- [ ] AC-5: 上架条目字段完整——含 soul_imprint_hash / capability_summary / evolution_stage / awakening_stage / layer / species
- [ ] AC-6: 订阅克隆保留血缘——父灵印写入克隆体 lineage 字段，生成新灵印
- [ ] AC-7: 交易转移所有权——灵印随之转移，原 operator 保留交易记录
- [ ] AC-8: 灵印哈希校验通过——上架时计算哈希，交易 / 订阅时校验一致性

### 5.2 架构不变量验收

- [ ] AC-9: 上架最高觉醒阶为 E3（E4+ 灵智体上架被拒绝）
- [ ] AC-10: 上架能力画像仅展示摘要（完整画像不暴露）
- [ ] AC-11: 所有订阅 / 交易写入 F038 进化谱系（CLONED / TRADED 边）
- [ ] AC-12: 所有检索通过 OpenSieve 统一入口（无绕过）
- [ ] AC-13: 所有市场规则外置 YAML（无硬编码）
- [ ] AC-14: 9 大点名称修订已应用（双轨命名 + AI 术语优先 + 弱化万物 + 去 AGI 化）

---

## 6. 引用

- [doc:../spec.md#§3.13]（FR-CORE-013 灵智体市场 + 进化谱系）
- [doc:../arch.md#§3.13]（灵智体市场 + 进化谱系架构）
- [doc:../features/F037-forgemind-marketplace.md]（同号 Feature 级 SRS）
- [doc:../features/F001-capability-profile.md]（能力画像）
- [doc:../features/F027-all-things-spirit-species.md]（多形态智能体形态分类）
- [doc:../features/F028-forging-pipeline.md]（锻造流水线）
- [doc:../features/F036-forgemind-forge-relationship.md]（forgemind 与 *Forge 关系）
- [doc:../features/F038-forgemind-lineage.md]（进化谱系）
- [doc:../features/F039-mind-codex-searchable.md]（灵典可检索知识库）
- [doc:../decisions/005-forgemind-application-layer.md]（forgemind 应用层 ADR）
- [doc:../../../hiclaw/rules.md#第二部分]（原则 2 所有数据检索走 OpenSieve）
- [doc:../../../hiclaw/rules.md#第七部分]（编程红线第 10/11/12/13 条）
- [doc:../../../hiclaw/rules.md#第十一部分]（软件工程文档分层规范）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（架构骨架，应用 9 大点名称修订） | 架构师灵智体（猫头鹰·鲁班） |
