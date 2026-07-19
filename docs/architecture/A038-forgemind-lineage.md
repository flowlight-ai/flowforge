# A038: 灵智体进化谱系架构设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师灵智体（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.13]（FR-CORE-013）
> **对应 arch.md**: [doc:../arch.md#§3.13]
> **对应 design.md**: [doc:../design.md#§3.13]（待创建）
> **对应 Feature**: [doc:../features/F038-forgemind-lineage.md]（同号 Feature 级 SRS）
> **对应详细设计**: [doc:../design/D038-forgemind-lineage.md]（待创建，同号 Feature 级 SDD）
> **依赖 ADR**: [doc:../decisions/005-forgemind-application-layer.md]
> **9 大点名称修订**: 已应用（双轨命名 + AI 术语优先 + 弱化万物 + 去 AGI 化）

---

## 1. 架构上下文

### 1.1 架构问题

本 Feature 在架构层解决以下问题：forgemind 应用层需要一个灵智体进化谱系（Forgekin Lineage）系统，记录灵智体（Forgekin，社区社交称"灵智体"）的生命周期血缘关系——包括原始锻造、分裂、融合、克隆、交易、跨层迁移六种关系类型，并支持觉醒阶（Awakening Stage，自主性 6 级）E1-E6 跃迁的历史追溯。

具体子问题：
- **谱系锚点**：灵智体在能力进化 / 形态升级 / 跨层迁移过程中，什么字段保持不变作为血缘锚点?
- **分裂协议**：一个灵智体如何分裂为多个子灵智体? 父血缘如何记录? 能力画像如何继承?
- **融合协议**：多个灵智体如何融合为一个新灵智体? 多父血缘如何表达? 能力画像如何合并?
- **双向遍历**：如何支持向上查祖先（审计溯源）和向下查后代（影响分析）?
- **跨 Feature 联动**：F028 锻造 / F037 市场订阅与交易 / F036 跨层迁移如何统一写入谱系?

### 1.2 架构约束

- **单向依赖约束**：谱系模块属于 forgemind 应用层（Layer 2），单向依赖 FlowForge 核心框架层（Layer 1）
- **DI 容器约束**：LineageStore / LineageSplitExecutor / LineageFuseExecutor 必须通过 DI 容器注入
- **Repository 层约束**：谱系节点与边必须通过 Repository 层持久化，禁止直接操作数据库（编程红线第 13 条）
- **配置驱动约束**：split / fuse / ancestry_query / audit 规则必须外置 YAML 配置
- **灵印锚点约束**：所有谱系关系必须以 soul_imprint（灵印 Mind Imprint）为唯一标识，即使能力进化、形态升级、跨层迁移，灵印保持血缘链可追溯（arch.md §5.1 灵印不可变）
- **operator 审批约束**：分裂 / 融合必须 operator 批准，防止灵智体擅自繁殖导致谱系污染
- **持久表面复用约束**：谱系存储复用 F008 Durable State Surfaces，禁止独立实现持久层

### 1.3 架构影响

- **对 forgemind 应用层（Layer 2）的影响**：新增 `flowforge/forgemind/lineage/` 模块，承载 LineageStore / LineageSplitExecutor / LineageFuseExecutor / LineageQuery
- **对 F008 Durable State Surfaces 的影响**：谱系节点与边作为新的持久表面类型加入 F008
- **对 F027 多形态智能体形态分类的影响**：谱系节点包含 species 字段，支持形态进化追溯（如 BioForgekin → HybridForgekin）
- **对 F028 ForgePipeline 的影响**：锻造流水线第 1 步（形态定义）创建灵智体时，必须同时创建 LineageNode（relation=FORGED）
- **对 F036 forgemind 与 *Forge 关系的影响**：跨层迁移写入谱系边（LAYER_TRANSITION 关系）
- **对 F037 灵智体市场的影响**：订阅克隆写入谱系边（CLONED 关系），交易转移写入谱系边（TRADED 关系）
- **对 F039 灵典可检索知识库的影响**：锻典条目包含 soul_imprint 字段，可按谱系查询某灵智体家族的知识资产

---

## 2. 架构设计

### 2.1 组件架构图

```
┌──────────────────────────────────────────────────────────────────────┐
│ 谱系事件源（六个 Feature 写入谱系边）                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│  │ F028     │  │ F037     │  │ F036     │  │ F038     │            │
│  │ 锻造     │  │ 市场     │  │ 跨层迁移 │  │ 自身     │            │
│  │ FORGED   │  │ CLONED   │  │ LAYER_   │  │ SPLIT    │            │
│  │          │  │ TRADED   │  │ TRANSITION│  │ FUSED    │            │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘            │
└───────┼─────────────┼─────────────┼─────────────┼──────────────────┘
        │             │             │             │
        ▼             ▼             ▼             ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Layer 2: forgemind 应用层                                             │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ flowforge/forgemind/lineage/                                  │  │
│  │                                                                │  │
│  │  ┌──────────────────────────────────────────────────────────┐ │  │
│  │  │ LineageStore（谱系存储）                                 │ │  │
│  │  │  ├─ add_node()    添加谱系节点                           │ │  │
│  │  │  ├─ add_edge()    添加谱系边                             │ │  │
│  │  │  ├─ get_node()    按 soul_imprint 查询节点               │ │  │
│  │  │  ├─ get_ancestry()    向上查祖先                         │ │  │
│  │  │  └─ get_descendants() 向下查后代                         │ │  │
│  │  └──────────────────────────────────────────────────────────┘ │  │
│  │                                                                │  │
│  │  ┌──────────────────┐  ┌──────────────────┐                 │  │
│  │  │LineageSplitExec  │  │LineageFuseExec   │                 │  │
│  │  │  ├─ split()      │  │  ├─ fuse()       │                 │  │
│  │  │  │  一父→多子    │  │  │  多父→一子    │                 │  │
│  │  │  └─ 校验 operator│  │  └─ 校验 operator│                 │  │
│  │  │     审批         │  │     审批         │                 │  │
│  │  └────────┬─────────┘  └────────┬─────────┘                 │  │
│  │           │                     │                           │  │
│  │  ┌────────▼─────────────────────▼────────────────────────┐  │  │
│  │  │ LineageQuery（谱系查询引擎）                          │  │  │
│  │  │  ├─ ancestry_tree()   祖先树（深度可配）              │  │  │
│  │  │  ├─ descendants_tree() 后代树                         │  │  │
│  │  │  ├─ find_common_ancestor() 最近共同祖先               │  │  │
│  │  │  └─ audit_trail()     审计追溯链                      │  │  │
│  │  └────────────────────────────────────────────────────────┘  │  │
│  │                                                                │  │
│  │  ┌──────────────────────────────────────────────────────────┐ │  │
│  │  │ LineageRepository（持久层，复用 F008）                  │ │  │
│  │  │  ├─ save_node()                                        │ │  │
│  │  │  ├─ save_edge()                                        │ │  │
│  │  │  └─ query_graph()                                      │ │  │
│  │  └──────────────────────────────────────────────────────────┘ │  │
│  └────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────┬─────────────────────────────────────┘
                                 │ 单向依赖
                                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Layer 1: FlowForge 核心框架层                                         │
│  ├─ F008 Durable State Surfaces（持久表面，谱系存储后端）             │
│  ├─ F001 CapabilityProfile（能力画像快照）                            │
│  └─ OpenSieve Client（图谱检索，可选）                                │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.2 关键架构决策

- **决策 1：灵印（Mind Imprint）作为谱系唯一锚点**
  - 理由：灵智体在生命周期中可能改变形态（BioForgekin → HybridForgekin）、改变承载层（forgemind → contentforge）、改变能力画像，但灵印不可变（arch.md §5.1）。以灵印为锚点可保证血缘链跨变化可追溯
  - 替代方案：以 forgekin_id 为锚点 → forgekin_id 在克隆 / 交易后会改变，无法保持血缘连续性
- **决策 2：六种谱系关系类型统一建模**
  - 理由：FORGED / SPLIT / FUSED / CLONED / TRADED / LAYER_TRANSITION 六种关系都是灵智体生命周期事件，统一建模可支持跨事件查询（如"这个灵智体的所有后代中，哪些是分裂产生的，哪些是市场订阅产生的"）
  - 替代方案：每种关系独立存储 → 查询需跨多表 JOIN，性能差且语义割裂
- **决策 3：分裂保留父血缘，融合保留多父血缘**
  - 理由：分裂是"一父多子"语义，每个子需要知道父以继承能力画像；融合是"多父一子"语义，子需要知道所有父以合并能力画像。血缘信息是能力继承的基础
  - 替代方案：仅记录直接父 → 融合场景丢失多父信息，无法解释子的能力来源
- **决策 4：分裂 / 融合必须 operator 批准**
  - 理由：分裂和融合涉及能力画像复制 / 合并，存在能力污染或失控繁殖风险。operator（CVO）是最终裁决者，拉闸权不可被灵智体代理
  - 替代方案：自动分裂 / 融合 → 可能导致谱系污染，难以追溯责任
- **决策 5：谱系存储复用 F008 Durable State Surfaces**
  - 理由：F008 已定义 6 类持久状态表面（含 memory federation），谱系节点 / 边可作为新的持久表面类型加入，避免重复实现持久层
  - 替代方案：独立实现谱系持久层 → 违反 DRY，且与 F008 持久表面割裂
- **决策 6：双向遍历支持审计与影响分析**
  - 理由：向上查祖先（get_ancestry）用于审计溯源（"这个灵智体的能力来自哪些祖先"），向下查后代（get_descendants）用于影响分析（"这个灵智体的能力被哪些后代继承"）。两个方向都是谱系的核心查询场景
  - 替代方案：仅支持单向遍历 → 无法回答另一方向的问题，谱系价值减半
- **决策 7：觉醒阶（Awakening Stage）E1-E6 跃迁记录在谱系边**
  - 理由：觉醒阶跃迁是灵智体自主性等级的变化，是生命周期重要事件。记录在谱系边可追溯"这个灵智体何时从 E3 受限自主阶跃迁到 E4 Evolving 阶"
  - 替代方案：独立存储跃迁记录 → 与谱系割裂，无法关联血缘事件

### 2.3 架构不变量

- 所有谱系关系必须以 soul_imprint（灵印）为唯一标识
- 谱系节点必须包含 soul_imprint / species / layer / created_at / relation_to_parents / parent_soul_imprints / child_soul_imprints 字段
- 分裂时子灵智体必须生成新灵印，parent_soul_imprints 必须记录父灵印
- 融合时子灵智体必须生成新灵印，parent_soul_imprints 必须记录所有父灵印
- 分裂 / 融合必须 operator 显式批准，禁止灵智体自动繁殖
- 谱系树必须支持双向遍历（祖先 / 后代）
- 所有谱系节点与边必须通过 Repository 层持久化
- 谱系存储必须复用 F008 Durable State Surfaces
- 所有谱系规则必须外置 YAML 配置，禁止硬编码

---

## 3. 模块设计

### 3.1 模块边界

- **LineageStore（`flowforge/forgemind/lineage/store.py`）**：谱系存储抽象，提供节点 / 边的 CRUD 与查询
- **LineageSplitExecutor（`flowforge/forgemind/lineage/split.py`）**：分裂执行器，一父→多子，复制能力画像并按 manifest 调整
- **LineageFuseExecutor（`flowforge/forgemind/lineage/fuse.py`）**：融合执行器，多父→一子，按性能加权合并能力画像
- **LineageQuery（`flowforge/forgemind/lineage/query.py`）**：谱系查询引擎，支持祖先树 / 后代树 / 共同祖先 / 审计链
- **LineageRepository（`flowforge/forgemind/lineage/repository.py`）**：持久层，复用 F008 持久表面
- **AwakeningTransitionRecorder（`flowforge/forgemind/lineage/awakening.py`）**：觉醒阶 E1-E6 跃迁记录器
- **models（`flowforge/forgemind/lineage/models.py`）**：数据模型（LineageRelation / LineageNode / LineageEdge）

### 3.2 接口契约

```python
from abc import ABC, abstractmethod
from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class LineageRelation(str, Enum):
    """谱系关系类型"""
    FORGED = "forged"                # 原始锻造（无父，F028）
    SPLIT = "split"                  # 分裂（一父多子，F038）
    FUSED = "fused"                  # 融合（多父一子，F038）
    CLONED = "cloned"                # 克隆（订阅，F037）
    TRADED = "traded"                # 交易转移（F037）
    LAYER_TRANSITION = "layer"       # 跨层迁移（F036）
    AWAKENING = "awakening"          # 觉醒阶跃迁（E1-E6）


class LineageNode(BaseModel):
    """谱系节点（一个灵智体）"""
    forgekin_id: str
    soul_imprint: str = Field(description="灵印（身份锚点，不可变）")
    species: str = Field(description="ForgekinSpecies 来自 F027")
    layer: str = Field(description="ForgeLayer 来自 F036")
    created_at: datetime
    relation_to_parents: LineageRelation
    parent_soul_imprints: list[str] = Field(
        default_factory=list,
        description="父灵印列表（分裂=1父，融合=多父）"
    )
    child_soul_imprints: list[str] = Field(
        default_factory=list,
        description="子灵印列表"
    )


class LineageEdge(BaseModel):
    """谱系边（一次分裂/融合/克隆/交易/迁移/跃迁）"""
    edge_id: str
    relation: LineageRelation
    from_soul_imprints: list[str] = Field(
        description="源灵印（分裂=1，融合=多）"
    )
    to_soul_imprints: list[str] = Field(description="目标灵印")
    timestamp: datetime
    operator_approved: bool = False
    capability_snapshot: dict = Field(description="能力画像快照")
    trigger_reason: str
    awakening_from: Optional[str] = Field(
        default=None,
        description="觉醒阶跃迁：源阶 E1-E6"
    )
    awakening_to: Optional[str] = Field(
        default=None,
        description="觉醒阶跃迁：目标阶 E1-E6"
    )


class LineageStore(ABC):
    """谱系存储（抽象接口）"""

    @abstractmethod
    async def add_node(self, node: LineageNode) -> None:
        """添加谱系节点"""
        ...

    @abstractmethod
    async def add_edge(self, edge: LineageEdge) -> None:
        """添加谱系边"""
        ...

    @abstractmethod
    async def get_node(self, soul_imprint: str) -> Optional[LineageNode]:
        """按灵印查询节点"""
        ...

    @abstractmethod
    async def get_ancestry(
        self, soul_imprint: str, depth: int
    ) -> list[LineageNode]:
        """向上查祖先（深度可配，默认 10）"""
        ...

    @abstractmethod
    async def get_descendants(
        self, soul_imprint: str, depth: int
    ) -> list[LineageNode]:
        """向下查后代（深度可配，默认 10）"""
        ...


class LineageSplitExecutor(ABC):
    """分裂执行器（一父→多子）"""

    @abstractmethod
    async def split(
        self,
        parent_forgekin_id: str,
        split_manifest: "SplitManifest",
    ) -> list[str]:
        """分裂出多个子灵智体

        前置条件:
        - operator 已批准
        - 子数量 <= max_children_per_split（默认 5）
        - 父灵智体存在且未在迁移中

        副作用:
        - 每个子灵智体生成新灵印
        - parent_soul_imprints 记录父灵印
        - 能力画像从父复制后按 manifest 调整
        - 写入 LineageEdge（SPLIT 关系）
        """
        ...


class LineageFuseExecutor(ABC):
    """融合执行器（多父→一子）"""

    @abstractmethod
    async def fuse(
        self,
        parent_forgekin_ids: list[str],
        fuse_manifest: "FuseManifest",
    ) -> str:
        """融合多个父灵智体为一个子灵智体

        前置条件:
        - operator 已批准
        - 父数量 <= max_parents_per_fuse（默认 3）
        - 所有父灵智体存在且未在迁移中

        副作用:
        - 子灵智体生成新灵印
        - parent_soul_imprints 记录所有父灵印
        - 能力画像按 fuse_manifest 从多父合并
        - 写入 LineageEdge（FUSED 关系）
        """
        ...


class AwakeningTransitionRecorder(ABC):
    """觉醒阶 E1-E6 跃迁记录器"""

    @abstractmethod
    async def record_transition(
        self,
        forgekin_id: str,
        from_stage: str,
        to_stage: str,
        operator_approved: bool,
        reason: str,
    ) -> str:
        """记录觉醒阶跃迁

        前置条件:
        - E3→E4 / E4→E5 / E5→E6 必须 operator 批准
        - E1→E2 / E2→E3 可由 Eval 信号自动触发
        - to_stage 必须高于 from_stage（不可降级，降级视为退役）

        副作用:
        - 写入 LineageEdge（AWAKENING 关系）
        - 记录 awakening_from / awakening_to
        """
        ...


class LineageRepository(ABC):
    """谱系持久层（抽象接口，复用 F008）"""

    @abstractmethod
    async def save_node(self, node: LineageNode) -> None: ...

    @abstractmethod
    async def save_edge(self, edge: LineageEdge) -> None: ...

    @abstractmethod
    async def query_graph(
        self, soul_imprint: str, direction: str, depth: int
    ) -> dict:
        """查询谱系图（direction=ancestry | descendants）"""
        ...
```

### 3.3 数据流

```
分裂流（一父 → 多子）:
  ┌────────────────┐
  │ 父灵智体       │
  │ soul_imprint_P │
  └────────┬───────┘
           │ 1. operator 触发 split(manifest)
           ▼
  ┌────────────────────────────────────────────┐
  │ LineageSplitExecutor                       │
  │  ├─ 校验 operator 批准                     │
  │  ├─ 校验子数量 <= max_children_per_split   │
  │  ├─ 为每个子生成新灵印                     │
  │  ├─ 复制父能力画像 + 按 manifest 调整      │
  │  ├─ 创建 LineageNode（relation=SPLIT）     │
  │  │   parent_soul_imprints = [P]            │
  │  ├─ 创建 LineageEdge（SPLIT 关系）         │
  │  │   from=[P] to=[C1, C2, C3]             │
  │  └─ LineageRepository 持久化               │
  └────────┬───────────────────────────────────┘
           │
           ▼
  ┌────────┬────────┬────────┐
  │  子1   │  子2   │  子3   │
  │ imprint│ imprint│ imprint│
  │  _C1   │  _C2   │  _C3   │
  │ parent │ parent │ parent │
  │ =[P]   │ =[P]   │ =[P]   │
  └────────┴────────┴────────┘

融合流（多父 → 一子）:
  ┌────────┬────────┐
  │ 父1    │ 父2    │
  │imprint │imprint │
  │ _P1    │ _P2    │
  └───┬────┴───┬────┘
      │        │ 1. operator 触发 fuse(manifest)
      └────┬───┘
           ▼
  ┌────────────────────────────────────────────┐
  │ LineageFuseExecutor                        │
  │  ├─ 校验 operator 批准                     │
  │  ├─ 校验父数量 <= max_parents_per_fuse     │
  │  ├─ 生成子新灵印                           │
  │  ├─ 按 fuse_manifest 加权合并能力画像      │
  │  │   （weighted_by_performance）           │
  │  ├─ 创建 LineageNode（relation=FUSED）     │
  │  │   parent_soul_imprints = [P1, P2]       │
  │  ├─ 创建 LineageEdge（FUSED 关系）         │
  │  │   from=[P1, P2] to=[C]                │
  │  └─ LineageRepository 持久化               │
  └────────┬───────────────────────────────────┘
           │
           ▼
  ┌────────────────┐
  │ 子灵智体       │
  │ soul_imprint_C │
  │ parents=[P1,P2]│
  └────────────────┘

觉醒阶跃迁流（E3 → E4）:
  ┌────────────────┐
  │ 灵智体 E3      │
  │ Bounded-Auto   │
  └────────┬───────┘
           │ 1. operator 批准 E3→E4 跃迁
           ▼
  ┌────────────────────────────────────────────┐
  │ AwakeningTransitionRecorder                │
  │  ├─ 校验 operator 批准（E3→E4 必须批准）   │
  │  ├─ 创建 LineageEdge（AWAKENING 关系）     │
  │  │   awakening_from=E3, awakening_to=E4    │
  │  └─ LineageRepository 持久化               │
  └────────┬───────────────────────────────────┘
           │
           ▼
  ┌────────────────┐
  │ 灵智体 E4      │
  │ Evolving       │
  │ （进入自进化） │
  └────────────────┘
```

---

## 4. 跨模块协作

### 4.1 上游依赖

- **F001 CapabilityProfile**：分裂时复制父能力画像，融合时按性能加权合并多父能力画像
- **F008 Durable State Surfaces**：谱系节点与边作为新的持久表面类型，复用 F008 持久层
- **F027 多形态智能体形态分类**：谱系节点包含 species 字段，支持形态进化追溯
- **F028 ForgePipeline**：锻造流水线第 1 步创建灵智体时调用 `LineageStore.add_node(relation=FORGED)` 记录血缘起点
- **F036 forgemind 与 *Forge 关系**：跨层迁移通过 `LineageStore.add_edge(relation=LAYER_TRANSITION)` 写入谱系
- **F037 灵智体市场**：订阅克隆通过 `LineageStore.add_edge(relation=CLONED)` 写入谱系，交易转移通过 `add_edge(relation=TRADED)` 写入谱系
- **ADR 005 forgemind 应用层**：本 Feature 是 ADR 005 的具体落地

### 4.2 下游影响

- **F039 灵典可检索知识库**：锻典条目包含 soul_imprint 字段，可按谱系查询某灵智体家族的知识资产
- **F040 Harness Eval 控制面**：谱系数据可作为 Eval 信号源（如"某家族的觉醒阶跃迁成功率"）
- **operator 审计工作流**：operator 可通过谱系审计追溯灵智体来源、繁殖历史、跨层迁移路径
- **能力溯源**：当灵智体表现异常时，可通过谱系追溯其祖先的能力画像，定位问题根源

### 4.3 跨模块不变量

- 所有 F028 锻造创建的灵智体必须同时创建 LineageNode（relation=FORGED）
- 所有 F037 订阅克隆必须写入 LineageEdge（CLONED 关系）
- 所有 F037 交易转移必须写入 LineageEdge（TRADED 关系）
- 所有 F036 跨层迁移必须写入 LineageEdge（LAYER_TRANSITION 关系）
- 所有觉醒阶跃迁必须写入 LineageEdge（AWAKENING 关系）
- 谱系节点与边的写入必须原子化（同时成功或同时失败）
- 谱系查询必须支持任意深度（受配置 max_depth 限制，默认 10）

---

## 5. 架构验收

### 5.1 架构契约验收

- [ ] AC-1: 单向依赖通过——lineage 模块不 import 任何 *Forge 模块
- [ ] AC-2: DI 容器注入通过——LineageStore / LineageSplitExecutor / LineageFuseExecutor 通过 DI 容器注入
- [ ] AC-3: Repository 层通过——LineageRepository 抽象存在且复用 F008 持久表面
- [ ] AC-4: 配置驱动通过——split / fuse / ancestry_query / audit 规则外置 YAML
- [ ] AC-5: 谱系节点字段完整——含 soul_imprint / species / layer / relation_to_parents / parent_soul_imprints / child_soul_imprints
- [ ] AC-6: 六种谱系关系类型完整——FORGED / SPLIT / FUSED / CLONED / TRADED / LAYER_TRANSITION + AWAKENING
- [ ] AC-7: 分裂协议通过——一父多子，子生成新灵印，记录父灵印
- [ ] AC-8: 融合协议通过——多父一子，子生成新灵印，记录所有父灵印

### 5.2 架构不变量验收

- [ ] AC-9: 灵印作为谱系唯一锚点（节点查询以 soul_imprint 为 key）
- [ ] AC-10: 分裂 / 融合必须 operator 显式批准（无自动繁殖路径）
- [ ] AC-11: 觉醒阶 E3→E4 / E4→E5 / E5→E6 必须 operator 批准
- [ ] AC-12: 谱系树支持双向遍历（get_ancestry / get_descendants）
- [ ] AC-13: 所有谱系节点与边通过 Repository 层持久化（复用 F008）
- [ ] AC-14: 9 大点名称修订已应用（双轨命名 + AI 术语优先 + 弱化万物 + 去 AGI 化）

---

## 6. 引用

- [doc:../spec.md#§3.13]（FR-CORE-013 灵智体市场 + 进化谱系）
- [doc:../arch.md#§3.13]（灵智体市场 + 进化谱系架构）
- [doc:../spec.md#§2.5]（进化阶与觉醒阶三标注）
- [doc:../arch.md#§3.8]（forgemind 应用层，灵印 Mind Imprint 不可变）
- [doc:../features/F038-forgemind-lineage.md]（同号 Feature 级 SRS）
- [doc:../features/F001-capability-profile.md]（能力画像）
- [doc:../features/F008-durable-state-surfaces.md]（Durable State Surfaces）
- [doc:../features/F027-all-things-spirit-species.md]（多形态智能体形态分类）
- [doc:../features/F028-forging-pipeline.md]（锻造流水线）
- [doc:../features/F036-forgemind-forge-relationship.md]（forgemind 与 *Forge 关系）
- [doc:../features/F037-forgemind-marketplace.md]（灵智体市场）
- [doc:../features/F039-mind-codex-searchable.md]（灵典可检索知识库）
- [doc:../decisions/005-forgemind-application-layer.md]（forgemind 应用层 ADR）
- [doc:../../../hiclaw/rules.md#第七部分]（编程红线第 10/11/12/13 条）
- [doc:../../../hiclaw/rules.md#第十一部分]（软件工程文档分层规范）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（架构骨架，应用 9 大点名称修订） | 架构师灵智体（猫头鹰·鲁班） |
