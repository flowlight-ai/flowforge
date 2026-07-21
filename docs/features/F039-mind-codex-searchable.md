# Feature F039: MindCodex 可检索知识库（Distilled Knowledge Base，社区社交称"灵典"）

> **状态**: draft
> **版本**: v0.1
> **依赖**: [doc:review/review.md#CL-005] + [doc:roleagent.md#第4章]
> **关联 ADR**: [doc:decisions/008-memory-federation.md]
> **类型**: memory
> **创建日期**: 2026-07-17
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.4]（FR-CORE-004，与本文档同号对应）
> **对应 arch.md**: [doc:../arch.md#§3.4]（待创建）
> **对应 design.md**: [doc:../design.md#§3.4]（待创建）

---

## 1. 概述（Overview）

MindCodex 可检索知识库（Distilled Knowledge Base，社区社交称"灵典"）是 forgemind 应用层的蒸馏知识存储：SpiritForge（Experience Distillation，社区社交称"灵锻"）产出的 MindCodex 条目必须可检索、可复用、可审计。本 Feature 实现 MindCodex 条目的 Knowledge Object Contract（CL-005 七字段契约）、三检索入口接入（与 F015 联动）、消费加权排序（与 F017 联动）、与 F014 EchoStore（Episodic Memory Store，社区社交称"灵忆"）的原始日志区分，让 Forgekin（Evolvable Agent，社区社交称"灵智体"）判断"这个知识是否适用于当前场景"。

这是 Build to Persist 基础设施——编码"蒸馏知识库是结构化可检索蒸馏产物"的工程规则，区别于EchoStore的原始日志。

## 2. 动机（Motivation）

`[doc:review/review.md#CL-005]` 指出：F100 规定每个蒸馏知识库条目必须包含 Knowledge Object Contract 七字段（trigger/procedure/precondition/postcondition/anti_pattern/provenance/confidence），但 v7.0 蒸馏知识库条目结构未定义，Forgekin无法判断"这个知识是否适用于当前场景"。naming-contract.md §2.8 明确：蒸馏知识库（MindCodex）是结构化、可检索、可复用的蒸馏产物，区别于EchoStore（原始日志）。

不做这个 Feature，F015 三检索入口无结构化检索对象，F017 消费加权排序无消费信号源，F035 三方 Agent 能力融合无蒸馏产物存储。这是多域记忆联邦的知识底座。

## 3. 详细设计（Detailed Design）

### 3.1 数据模型（Knowledge Object Contract，CL-005 七字段）

```python
class MindCodexEntry(BaseModel):
    """蒸馏知识库条目（CL-005 Knowledge Object Contract）"""
    entry_id: str
    forgekin_id: str                           # 所属Forgekin
    domain: str                                # 能力域
    # === CL-005 七字段契约 ===
    trigger: str                               # ①trigger 何时使用
    procedure: str                             # ②procedure 怎么用
    precondition: str                          # ③precondition 前置条件
    postcondition: str                         # ④postcondition 预期效果
    anti_pattern: str                          # ⑤anti_pattern 反模式
    provenance: list[str]                      # ⑥provenance 来源 Episode ID（EchoStore ID）
    confidence: float                          # ⑦confidence 置信度 0.0-1.0
    # === 扩展字段 ===
    maturity_level: Literal["L0", "L1", "L2", "L3", "L4"]  # CL-003 五级成熟度
    created_at: datetime
    last_consumed_at: Optional[datetime]       # 最后消费时间（F017 消费加权）
    consumption_count: int = 0                 # 消费次数（F017 信号）
    last_eval_score: Optional[float]           # 最后 Eval 分数（F017 信号）
    soul_imprint: str                          # 所属ForgekinSoulImprint（F038 谱系追踪）
```

### 3.2 核心接口

```python
class MindCodexStore(ABC):
    """蒸馏知识库存储（区别于 F014 EchoStore的原始日志）"""
    @abstractmethod
    async def add_entry(self, entry: MindCodexEntry) -> str: ...
    @abstractmethod
    async def get_entry(self, entry_id: str) -> MindCodexEntry: ...
    @abstractmethod
    async def validate_contract(self, entry: MindCodexEntry) -> bool:
        """CL-005 七字段契约校验（缺字段拒绝入库）"""
        ...
    @abstractmethod
    async def list_by_domain(self, forgekin_id: str, domain: str) -> list[MindCodexEntry]: ...

class MindCodexSearcher(ABC):
    """蒸馏知识库检索器（接入 F015 三检索入口）"""
    @abstractmethod
    async def search_grep(self, forgekin_id: str, keyword: str) -> list[MindCodexEntry]: ...
    @abstractmethod
    async def search_semantic(self, forgekin_id: str, query: str, top_k: int) -> list[MindCodexEntry]: ...
    @abstractmethod
    async def search_index(self, forgekin_id: str, domain: str) -> list[MindCodexEntry]: ...
    @abstractmethod
    async def search_federated(self, forgekin_id: str, query: str) -> list[MindCodexEntry]:
        """三入口 RRF 融合检索（与 F015 联动）"""
        ...

class MindCodexConsumer(ABC):
    """蒸馏知识库消费者（记录消费信号供 F017 加权）"""
    @abstractmethod
    async def consume(self, entry_id: str, eval_score: float) -> None:
        """记录消费 + Eval 分数，更新 consumption_count / last_eval_score"""
        ...
```

### 3.3 关键算法

- **CL-005 七字段契约硬校验**：trigger/procedure/precondition/postcondition/anti_pattern/provenance/confidence 七字段缺一不可，校验失败拒绝入库。
- **与EchoStore区分**：蒸馏知识库存储结构化蒸馏产物（含七字段契约），EchoStore（F014）存储原始任务日志（轨迹/决策/结果/反馈）。蒸馏知识库的 provenance 字段指向EchoStore Episode ID。
- **三检索入口接入**：grep（关键词）/ semantic（语义向量）/ index（按 domain 索引），三入口结果用 RRF 融合（与 F015 一致）。
- **消费加权排序**：检索结果按 consumption_count + last_eval_score + recency 加权排序（与 F017 14 信号一致），高消费 + 高 Eval + 近期使用的条目优先。
- **成熟度门控**：仅 L3+（CL-003 Validated 及以上）条目可被检索消费，L0-L2 条目仅存储不消费。

### 3.4 配置外置（YAML 示例）

```yaml
mind_codex:
  store:
    backend: durable_state_surfaces            # 复用 F008
    distinguish_from_echo_store: true          # 与 F014 EchoStore区分
  contract_validation:
    required_fields: [trigger, procedure, precondition, postcondition, anti_pattern, provenance, confidence]
    min_confidence: 0.6
    min_provenance_count: 1                    # 至少 1 个来源 Episode
  search:
    entries:
      grep: enabled
      semantic: enabled
      index: enabled
    rrf_fusion: true                           # 与 F015 一致
    min_maturity_for_consume: L3               # CL-003 成熟度门控
  consumption_ranking:
    weight_consumption_count: 0.3              # 与 F017 14 信号一致
    weight_eval_score: 0.4
    weight_recency: 0.3
    wilson_shrinkage: true                     # 贝叶斯收缩
  lineage:
    track_soul_imprint: true                   # F038 谱系追踪
```

## 4. 验收标准（Acceptance Criteria）

- [ ] AC-1: MindCodexEntry 含 CL-005 七字段（缺字段拒绝入库）
- [ ] AC-2: 蒸馏知识库存储与 F014 EchoStore存储区分（结构化 vs 原始日志）
- [ ] AC-3: 三检索入口（grep/semantic/index）可用且 RRF 融合（与 F015 一致）
- [ ] AC-4: 消费加权排序按 consumption_count + last_eval_score + recency（与 F017 一致）
- [ ] AC-5: 仅 L3+ 成熟度条目可被检索消费（CL-003 门控）

## 5. 测试策略

### 5.1 单元测试

- CL-005 七字段契约校验、三检索入口、RRF 融合、消费加权排序、成熟度门控。

### 5.2 集成测试

- 接入 F014 EchoStore集合（provenance 指向）、F015 三检索入口、F017 消费加权排序、F035 三方 Agent 能力融合、F038 进化谱系。

### 5.3 E2E 测试（必须遵守 T1-T8 测试铁律）

- 真实Forgekin通过真实 LLM SpiritForge蒸馏出代码编写能力条目（含 CL-005 七字段），经 Eval Ledger 验证（CL-004）合入蒸馏知识库。下次类似任务Forgekin通过三检索入口找到该条目并消费，验证消费信号记录、加权排序正确。**遵守 T1-T8**：真实 LLM、真实数据、真实工具调用。

## 6. 引用

- [doc:roleagent.md#第4章]
- [doc:review/review.md#第十三章/CL-005]（Knowledge Object Contract）
- [doc:review/review.md#第十三章/CL-003]（五级知识成熟度阶梯）
- [doc:review/review.md#第十三章/CL-004]（Eval Ledger 进化账本）
- [doc:decisions/008-memory-federation.md]
- [doc:design/naming-contract.md#2.5]（EchoStore）
- [doc:design/naming-contract.md#2.7]（SpiritForge 经验蒸馏）
- [doc:design/naming-contract.md#2.8]（MindCodex 蒸馏知识库）
- [doc:features/F014-memory-collection.md]
- [doc:features/F015-three-retrieval-entry.md]
- [doc:features/F017-consumption-weighted-ranking.md]
- [doc:features/F035-external-agent-capability-fusion.md]
- [doc:features/F038-forgemind-lineage.md]
- [doc:project_rules.md#T1-T8]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
