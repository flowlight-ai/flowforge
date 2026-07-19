# Feature F037: 灵智体市场

> **状态**: draft
> **版本**: v0.1
> **依赖**: [doc:review/review.md#FM-007] + [doc:roleagent.md#第0章]
> **关联 ADR**: [doc:decisions/005-forgemind-application-layer.md]
> **类型**: forgemind
> **创建日期**: 2026-07-17
> **负责人**: 架构师灵智体（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.13]（FR-CORE-013，与本文档同号对应）
> **对应 arch.md**: [doc:../arch.md#§3.13]（待创建）
> **对应 design.md**: [doc:../design.md#§3.13]（待创建）
> **9 大点名称修订**: 已应用（双轨命名 + AI 术语优先 + 弱化万物 + 去 AGI 化）

---

## 1. 概述（Overview）

灵智体市场（ForgeMind Marketplace）是 forgemind 应用层的流通机制：用户可分享/订阅/交易自己锻造的灵智体（Forgekin），如"我锻造的写作灵智体"、"我锻造的代码审查灵智体"、"我锻造的家猫灵智体"。本 Feature 实现灵智体上架/订阅/交易、能力画像摘要展示、与 F028 锻造产物联动、与 F036 forgemind/*Forge 关系联动，让灵智体可跨用户共享。

这是 Build to Persist 基础设施——编码"灵智体可流通"的工程规则，对标 clowder-ai 的灵智体共享生态。

## 2. 动机（Motivation）

`[doc:review/review.md#FM-007]` 指出：v7.0 有 plugin marketplace 但无 forgekin marketplace，灵智体无法跨用户共享。万物灵智体需要市场机制：用户可分享/订阅/交易自己锻造的灵智体。这是与 clowder-ai 养猫愿景对标的生态差异——clowder-ai 的猫可分享，FlowForge 的灵智体也应可流通。

不做这个 Feature，F028 锻造产物无流通通道，F036 forgemind/*Forge 关系无跨用户传播，F038 进化谱系无跨用户血缘。这是 forgemind 应用层的生态底座。

## 3. 详细设计（Detailed Design）

### 3.1 数据模型

```python
class MarketplaceListing(BaseModel):
    """市场上架条目"""
    listing_id: str
    seller_forgekin_id: str                      # 上架灵智体 ID
    seller_operator_id: str
    title: str
    description: str
    species: ForgekinSpecies                     # 来自 F027
    capability_summary: dict                     # 能力画像摘要（来自 F001）
    layer: ForgeLayer                            # 来自 F036（forgemind / *Forge）
    evolution_stage: EvolutionStage              # 进化阶 E1-E6
    awakening_stage: AwakeningStage              # 觉醒阶 E1-E6
    listing_type: Literal["share", "subscribe", "trade"]
    price_tokens: Optional[int]                  # 交易价格（token）
    soul_imprint_hash: str                       # 灵印哈希（身份锚点，不可篡改）
    listing_artifact_ref: str                    # 上架产物包引用

class MarketplaceSubscription(BaseModel):
    """订阅记录"""
    subscription_id: str
    listing_id: str
    subscriber_operator_id: str
    subscribed_at: datetime
    cloned_forgekin_id: str                      # 克隆到订阅者的灵智体 ID
    lineage_link: str                            # 与 F038 进化谱系联动

class MarketplaceTrade(BaseModel):
    """交易记录"""
    trade_id: str
    listing_id: str
    buyer_operator_id: str
    seller_operator_id: str
    price_tokens: int
    traded_at: datetime
    soul_imprint_transferred: str                # 灵印转移记录
```

### 3.2 核心接口

```python
class MarketplaceRegistry(ABC):
    """市场注册表"""
    @abstractmethod
    async def list_item(self, listing: MarketplaceListing) -> str: ...
    @abstractmethod
    async def search(self, query: MarketplaceQuery) -> list[MarketplaceListing]: ...
    @abstractmethod
    async def delist(self, listing_id: str, operator_id: str) -> None: ...

class ForgekinCloner(ABC):
    """灵智体克隆器（订阅/交易时克隆）"""
    @abstractmethod
    async def clone_for_subscriber(
        self, source_forgekin_id: str, subscriber_operator_id: str
    ) -> str:
        """克隆灵智体（保留灵印血缘，生成新灵印）"""
        ...

    @abstractmethod
    async def transfer_ownership(
        self, forgekin_id: str, new_operator_id: str
    ) -> str:
        """交易时所有权转移（灵印随之转移）"""
        ...
```

### 3.3 关键算法

- **克隆保留血缘**：订阅时克隆灵智体，原灵印作为"父灵印"写入克隆体的血缘字段，克隆体生成新灵印。血缘链写入 F038 进化谱系。
- **交易转移所有权**：交易时灵印随之转移（原 operator 失去控制权），但原 operator 保留一份"已交易"记录供追溯。
- **能力画像摘要展示**：上架时自动从 F001 CapabilityProfile 生成摘要（擅长 + 盲点 + 历史表现 Wilson 下界），不暴露完整画像。
- **灵印不可篡改**：上架时记录 soul_imprint_hash，交易/订阅时校验哈希一致，防止灵智体被篡改后流通。

### 3.4 配置外置（YAML 示例）

```yaml
forgekin_marketplace:
  listing:
    require_capability_summary: true
    require_evolution_stage_min: E2              # 上架最低进化阶
    require_awakening_stage_max: E3              # 上架最高觉醒阶（安全考虑）
    auto_generate_summary_from_profile: true
  subscription:
    clone_strategy: retain_lineage               # 保留血缘
    new_soul_imprint: true                       # 克隆体生成新灵印
    write_to_lineage: true                       # 写入 F038
  trade:
    transfer_soul_imprint: true                  # 灵印转移
    seller_keep_trade_record: true
    require_operator_approval: true
  search:
    index_fields: [species, layer, evolution_stage, capability_summary]
    default_sort: wilson_lower_bound_desc
```

## 4. 验收标准（Acceptance Criteria）

- [ ] AC-1: 上架条目字段完整（含灵印哈希、能力摘要、进化阶/觉醒阶）
- [ ] AC-2: 订阅时克隆保留血缘，生成新灵印
- [ ] AC-3: 交易时灵印转移，原 operator 保留交易记录
- [ ] AC-4: 灵印哈希校验防止篡改
- [ ] AC-5: 所有订阅/交易写入 F038 进化谱系

## 5. 测试策略

### 5.1 单元测试

- 上架校验、克隆血缘、交易转移、灵印哈希校验、搜索排序。

### 5.2 集成测试

- 接入 F001 能力画像、F027 形态分类、F028 锻造产物、F036 forgemind/*Forge 关系、F038 进化谱系。

### 5.3 E2E 测试（必须遵守 T1-T8 测试铁律）

- 真实 operator A 锻造写作灵智体（F028 完成六阶段），上架到市场。真实 operator B 订阅，验证克隆体血缘正确、新灵印生成。再触发交易，验证灵印转移、A 保留交易记录、B 获得控制权。**遵守 T1-T8**：真实 LLM、真实数据、真实工具调用。

## 6. 引用

- [doc:roleagent.md#第0章]
- [doc:review/review.md#第九章/FM-007]
- [doc:decisions/005-forgemind-application-layer.md]
- [doc:design/naming-contract.md#2.6]（灵印 Soul Imprint）
- [doc:design/naming-contract.md#2.10]（进化阶 Evolution Stage）
- [doc:design/naming-contract.md#2.11]（觉醒阶 Awakening Stage）
- [doc:features/F001-capability-profile.md]
- [doc:features/F027-all-things-spirit-species.md]
- [doc:features/F028-forging-pipeline.md]
- [doc:features/F036-forgemind-forge-relationship.md]
- [doc:features/F038-forgemind-lineage.md]
- [doc:project_rules.md#T1-T8]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.2 | 应用 9 大点名称修订 + 添加 spec.md §3.13 同号映射 | 文档员灵智体（钢笔·文心） |
