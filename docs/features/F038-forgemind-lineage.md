# Feature F038: Forgekin进化谱系

> **状态**: draft
> **版本**: v0.1
> **依赖**: [doc:review/review.md#FM-008] + [doc:roleagent.md#第0章]
> **关联 ADR**: [doc:decisions/005-forgemind-application-layer.md]
> **类型**: forgemind
> **创建日期**: 2026-07-17
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.13]（FR-CORE-013，与本文档同号对应）
> **对应 arch.md**: [doc:../arch.md#§3.13]（待创建）
> **对应 design.md**: [doc:../design.md#§3.13]（待创建）

---

## 1. 概述（Overview）

Forgekin进化谱系（Forgekin Lineage）是 forgemind 应用层的血缘追踪机制：一个Forgekin可"分裂"出子Forgekin（如"我的写作Forgekin"分裂出"技术博客Forgekin"和"散文Forgekin"）；多个Forgekin可"融合"为新Forgekin（如"写作Forgekin"+"研究Forgekin"融合为"深度报道Forgekin"）。本 Feature 实现谱系树建模、分裂/融合协议、与 F027 形态分类联动、与 F037 市场订阅/交易联动，让Forgekin不再是孤立个体。

这是 Build to Persist 基础设施——编码"Forge Nurturing的传承与演化"的工程规则，体现可进化智能体的血缘可追溯。

## 2. 动机（Motivation）

`[doc:review/review.md#FM-008]` 指出：v7.0 无谱系设计，Forgekin是孤立个体，无法体现"Forge Nurturing"的传承与演化。可进化智能体应有进化谱系：一个Forgekin可"分裂"出子Forgekin；多个Forgekin可"融合"为新Forgekin。SoulImprint（Soul Imprint）是谱系追踪的锚点（naming-contract.md §2.6）。

不做这个 Feature，F028 锻造流水线无血缘起点，F037 市场订阅/交易无血缘追踪，F036 forgemind/*Forge 跨层迁移无血缘记录。这是 forgemind 应用层的血缘底座。

## 3. 详细设计（Detailed Design）

### 3.1 数据模型

```python
class LineageRelation(str, Enum):
    """谱系关系类型"""
    FORGED = "forged"                # 原始锻造（无父）
    SPLIT = "split"                  # 分裂（一父多子）
    FUSED = "fused"                  # 融合（多父一子）
    CLONED = "cloned"                # 克隆（订阅，F037）
    TRADED = "traded"                # 交易转移（F037）
    LAYER_TRANSITION = "layer"       # 跨层迁移（F036）

class LineageNode(BaseModel):
    """谱系节点（一个Forgekin）"""
    forgekin_id: str
    soul_imprint: str                           # SoulImprint（身份锚点）
    species: ForgekinSpecies                    # 形态（F027）
    layer: ForgeLayer                           # 承载层（F036）
    created_at: datetime
    relation_to_parents: LineageRelation
    parent_soul_imprints: list[str]             # 父SoulImprint列表（分裂=1父，融合=多父）
    child_soul_imprints: list[str]              # 子SoulImprint列表

class LineageEdge(BaseModel):
    """谱系边（一次分裂/融合/克隆/交易/迁移）"""
    edge_id: str
    relation: LineageRelation
    from_soul_imprints: list[str]               # 源SoulImprint（分裂=1，融合=多）
    to_soul_imprints: list[str]                 # 目标SoulImprint
    timestamp: datetime
    operator_approved: bool
    capability_snapshot: dict                   # 能力画像快照
    trigger_reason: str
```

### 3.2 核心接口

```python
class LineageStore(ABC):
    """谱系存储"""
    @abstractmethod
    async def add_node(self, node: LineageNode) -> None: ...
    @abstractmethod
    async def add_edge(self, edge: LineageEdge) -> None: ...
    @abstractmethod
    async def get_node(self, soul_imprint: str) -> LineageNode: ...
    @abstractmethod
    async def get_ancestry(self, soul_imprint: str, depth: int) -> list[LineageNode]: ...
    @abstractmethod
    async def get_descendants(self, soul_imprint: str, depth: int) -> list[LineageNode]: ...

class LineageSplitExecutor(ABC):
    """分裂执行器"""
    @abstractmethod
    async def split(
        self, parent_forgekin_id: str, split_manifest: SplitManifest
    ) -> list[str]:
        """分裂出多个子Forgekin（保留父血缘，生成新SoulImprint）"""
        ...

class LineageFuseExecutor(ABC):
    """融合执行器"""
    @abstractmethod
    async def fuse(
        self, parent_forgekin_ids: list[str], fuse_manifest: FuseManifest
    ) -> str:
        """融合多个父Forgekin为一个子Forgekin（保留多父血缘）"""
        ...
```

### 3.3 关键算法

- **SoulImprint作为锚点**：所有谱系关系以 soul_imprint 为唯一标识，即使能力进化、形态升级、跨层迁移，SoulImprint保持血缘链可追溯。
- **分裂保留父血缘**：分裂时子Forgekin生成新SoulImprint，但 parent_soul_imprints 记录父SoulImprint，能力画像从父复制后按 split_manifest 调整。
- **融合保留多父血缘**：融合时子Forgekin生成新SoulImprint，parent_soul_imprints 记录所有父SoulImprint，能力画像按 fuse_manifest 从多父合并。
- **谱系树双向遍历**：支持向上查祖先（get_ancestry）和向下查后代（get_descendants），用于审计和能力溯源。
- **operator 审批**：分裂/融合必须 operator 批准，防止Forgekin擅自繁殖导致谱系污染。

### 3.4 配置外置（YAML 示例）

```yaml
forgekin_lineage:
  store:
    backend: durable_state_surfaces            # 复用 F008
    index_by: soul_imprint
  split:
    require_operator_approval: true
    max_children_per_split: 5
    copy_capability_from_parent: true
    adjust_by_manifest: true
  fuse:
    require_operator_approval: true
    max_parents_per_fuse: 3
    merge_strategy: weighted_by_performance    # 按历史表现加权合并
  ancestry_query:
    max_depth: 10
    include_capability_snapshots: true
  audit:
    log_all_edges: true
    alert_on_unauthorized_split: true
```

## 4. 验收标准（Acceptance Criteria）

- [ ] AC-1: 谱系节点以 soul_imprint 为唯一标识
- [ ] AC-2: 分裂时子Forgekin生成新SoulImprint，记录父SoulImprint
- [ ] AC-3: 融合时子Forgekin生成新SoulImprint，记录所有父SoulImprint
- [ ] AC-4: 谱系树支持双向遍历（祖先/后代）
- [ ] AC-5: 分裂/融合必须 operator 批准

## 5. 测试策略

### 5.1 单元测试

- 谱系节点/边写入、分裂血缘记录、融合多父血缘、双向遍历、SoulImprint锚点校验。

### 5.2 集成测试

- 接入 F027 形态分类、F036 forgemind/*Forge 关系、F037 市场订阅/交易、F008 持久状态层。

### 5.3 E2E 测试（必须遵守 T1-T8 测试铁律）

- 真实 operator 锻造"写作Forgekin"（父），通过真实 LLM 触发分裂出"技术博客Forgekin"和"散文Forgekin"（子），验证血缘记录。再触发"写作Forgekin"+"研究Forgekin"融合为"深度报道Forgekin"，验证多父血缘。查询祖先/后代验证谱系树。**遵守 T1-T8**：真实 LLM、真实数据、真实工具调用。

## 6. 引用

- [doc:roleagent.md#第0章]
- [doc:review/review.md#第九章/FM-008]
- [doc:decisions/005-forgemind-application-layer.md]
- [doc:design/naming-contract.md#2.6]（SoulImprint）
- [doc:design/naming-contract.md#2.4]（Forge Nurturing）
- [doc:features/F008-durable-state-surfaces.md]
- [doc:features/F027-all-things-spirit-species.md]
- [doc:features/F028-forging-pipeline.md]
- [doc:features/F036-forgemind-forge-relationship.md]
- [doc:features/F037-forgemind-marketplace.md]
- [doc:project_rules.md#T1-T8]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
