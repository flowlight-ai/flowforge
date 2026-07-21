# D038: Forgekin进化谱系详细设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 开发者 Forgekin（猎犬·夏洛克）
> **对应 spec.md**: [doc:../spec.md#§3.13]（FR-CORE-013）
> **对应 arch.md**: [doc:../arch.md#§3.13]
> **对应 design.md**: [doc:../design.md#§3.13]
> **对应 Feature**: [doc:../features/F038-forgemind-lineage.md]（同号 Feature 级 SRS）
> **对应 Architecture**: [doc:../architecture/A038-forgemind-lineage.md]（同号 Feature 级 SAD）
> **依赖 ADR**: [doc:../decisions/005-forgemind-application-layer.md]

---

## 1. 详细设计上下文

### 1.1 设计问题

本详细设计在 A038 架构设计基础上，深入到代码层落地Forgekin进化谱系（Forgekin Lineage）系统，需解决以下工程问题：

- **SoulImprint锚点工程化**：所有谱系关系以 soul_imprint（SoulImprint）为唯一标识，即使能力进化、形态升级、跨层迁移，SoulImprint保持血缘链可追溯。如何用 Pydantic 模型表达 LineageNode 与 LineageEdge 并以 soul_imprint 为主键?
- **分裂协议实现**：一父→多子分裂时，如何为每个子生成新SoulImprint、记录父SoulImprint到 parent_soul_imprints、按 split_manifest 调整能力画像、原子化写入 LineageEdge（SPLIT 关系）?
- **融合协议实现**：多父→一子融合时，如何按 fuse_manifest 加权合并多父能力画像、生成子新SoulImprint、记录所有父SoulImprint、原子化写入 LineageEdge（FUSED 关系）?
- **双向遍历算法**：如何实现 `get_ancestry(soul_imprint, depth)` 向上查祖先和 `get_descendants(soul_imprint, depth)` 向下查后代，支持深度限制与循环检测?
- **觉醒阶跃迁记录**：E1→E2 / E2→E3 可由 Eval 信号自动触发，E3→E4 / E4→E5 / E5→E6 必须 operator 批准，如何实现 AwakeningTransitionRecorder 状态机?
- **跨 Feature 谱系写入统一入口**：F028 锻造（FORGED）/ F037 市场（CLONED/TRADED）/ F036 跨层迁移（LAYER_TRANSITION）/ F038 自身（SPLIT/FUSED）/ 觉醒阶（AWAKENING）六类写入如何通过统一 add_edge 接口实现?

### 1.2 设计约束

- **单向依赖**：`flowforge/forgemind/lineage/` 禁止 import 任何 *Forge 模块；可 import `flowforge/core/*` 与 `flowforge/forgemind/*`
- **DI 容器**：LineageStore / LineageSplitExecutor / LineageFuseExecutor / LineageQuery / AwakeningTransitionRecorder 必须由 DI 容器注入
- **Repository 层**：所有节点 / 边的持久化必须经 LineageRepository 抽象，复用 F008 Durable State Surfaces，禁止直接操作数据库
- **配置驱动**：split / fuse / ancestry_query / audit / awakening_rules 必须外置 YAML（`flowforge/forgemind/config/lineage.yaml`）
- **SoulImprint锚点**：所有 LineageNode 以 soul_imprint 为主键查询，所有 LineageEdge 的 from_soul_imprints / to_soul_imprints 必须是已存在的 LineageNode
- **operator 审批**：分裂 / 融合 / E3→E4 及以上觉醒阶跃迁必须 operator 批准，禁止自动繁殖
- **原子化写入**：分裂 / 融合时 LineageNode 与 LineageEdge 必须事务化写入，任一失败则回滚
- **持久表面复用**：LineageRepository 复用 F008 Durable State Surfaces（surface_type="lineage_node" / "lineage_edge"），禁止独立实现持久层

### 1.3 设计影响

- **新增模块**：`flowforge/forgemind/lineage/` 下 7 个文件（store.py / split.py / fuse.py / query.py / awakening.py / repository.py / models.py）
- **修改 F008 Durable State Surfaces**：新增 surface_type="lineage_node" / "lineage_edge" 两类持久表面
- **修改 F028 ForgePipeline**：流水线第 1 步（形态定义）创建Forgekin时调用 `LineageStore.add_node(relation=FORGED)` 记录血缘起点
- **修改 F037 Marketplace**：订阅克隆调用 `LineageStore.add_edge(CLONED)`，交易转移调用 `add_edge(TRADED)`
- **修改 F036 ForgeRelationship**：跨层迁移调用 `LineageStore.add_edge(LAYER_TRANSITION)`
- **影响 F039 MindCodex**：蒸馏知识库条目的 soul_imprint 字段可按谱系查询某Forgekin家族的知识资产
- **影响 F040 Harness Eval**：谱系数据可作为 Eval 信号源（如"某家族的觉醒阶跃迁成功率"）

---

## 2. 详细设计

### 2.1 类图 ASCII

```
            ┌────────────────────────────────────────────────────────┐
            │  谱系事件源（六个 Feature 写入谱系边）                   │
            │  F028 FORGED │ F037 CLONED/TRADED │ F036 LAYER_TRANS  │
            │  F038 SPLIT/FUSED │ F038 AWAKENING                    │
            └────────────────────────┬───────────────────────────────┘
                                     │
                                     ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │ <<abstract>> LineageStore (store.py)                              │
   │ + add_node(node)                                                  │
   │ + add_edge(edge) → edge_id                                        │
   │ + add_edges_batch(edges) → list[edge_id]                          │
   │ + get_node(soul_imprint) → Optional[LineageNode]                  │
   │ + get_ancestry(soul_imprint, depth) → list[LineageNode]           │
   │ + get_descendants(soul_imprint, depth) → list[LineageNode]        │
   │ + mark_edge_invalid(edge_id)  // 回滚用                            │
   └─────────────┬─────────────────────────────────────┬──────────────┘
                 │ implements                            │ uses
                 ▼                                       ▼
   ┌──────────────────────────────────┐  ┌──────────────────────────────┐
   │ LineageStoreImpl                 │  │ <<abstract>>                 │
   │                                  │  │ LineageRepository (repository│
   │ - repository                     │  │  .py) 复用 F008               │
   │ - capability_repo                │  │ + save_node(node)            │
   │ - event_bus                      │  │ + save_edge(edge)            │
   └──────────────────────────────────┘  │ + get_node(soul_imprint)     │
                                         │ + query_graph(...)           │
                                         │ + save_edges_batch(edges)    │
                                         └──────────────────────────────┘
                 ▲
                 │
   ┌─────────────┴───────────────────────────────────────────────────┐
   │                                                                  │
   │  ┌────────────────────────────┐  ┌────────────────────────────┐ │
   │  │ <<abstract>>               │  │ <<abstract>>               │ │
   │  │ LineageSplitExecutor       │  │ LineageFuseExecutor        │ │
   │  │ (split.py)                 │  │ (fuse.py)                  │ │
   │  │ + split(parent_id,         │  │ + fuse(parent_ids,         │ │
   │  │   manifest) → list[child]  │  │   manifest) → child_id     │ │
   │  └────────────────────────────┘  └────────────────────────────┘ │
   │                                                                  │
   │  ┌────────────────────────────┐  ┌────────────────────────────┐ │
   │  │ <<abstract>>               │  │ <<abstract>>               │ │
   │  │ LineageQuery (query.py)    │  │ AwakeningTransitionRecorder│ │
   │  │ + ancestry_tree(...)       │  │ (awakening.py)             │ │
   │  │ + descendants_tree(...)    │  │ + record_transition(       │ │
   │  │ + find_common_ancestor(...)│  │     forgekin_id,           │ │
   │  │ + audit_trail(...)         │  │     from_stage, to_stage,  │ │
   │  └────────────────────────────┘  │     operator_approved,     │ │
   │                                  │     reason) → edge_id       │ │
   │                                  └────────────────────────────┘ │
   └──────────────────────────────────────────────────────────────────┘
```

### 2.2 接口实现 Python 代码

```python
# flowforge/forgemind/lineage/models.py
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class LineageRelation(str, Enum):
    """谱系关系类型（六类 + 觉醒阶跃迁）"""
    FORGED = "forged"                # 原始锻造（无父，F028）
    SPLIT = "split"                  # 分裂（一父多子，F038）
    FUSED = "fused"                  # 融合（多父一子，F038）
    CLONED = "cloned"                # 克隆（订阅，F037）
    TRADED = "traded"                # 交易转移（F037）
    LAYER_TRANSITION = "layer"       # 跨层迁移（F036）
    AWAKENING = "awakening"          # 觉醒阶跃迁（E1-E6）


class LineageNode(BaseModel):
    """谱系节点（一个Forgekin）"""
    forgekin_id: str
    soul_imprint: str = Field(
        description="SoulImprint（身份锚点，不可变，主键）"
    )
    species: str = Field(description="ForgekinSpecies 来自 F027")
    layer: str = Field(description="ForgeLayer 来自 F036")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    relation_to_parents: LineageRelation
    parent_soul_imprints: list[str] = Field(
        default_factory=list,
        description="父SoulImprint列表（FORGED=空, SPLIT=1父, FUSED=多父, "
                    "CLONED=1父, TRADED=1父, LAYER_TRANSITION=1父）"
    )
    child_soul_imprints: list[str] = Field(
        default_factory=list,
        description="子SoulImprint列表（动态更新）"
    )
    current_awakening_stage: str = Field(
        default="E1",
        description="当前觉醒阶 E1-E6"
    )
    current_evolution_stage: str = Field(
        default="E1",
        description="当前进化阶 E1-E6"
    )
    is_active: bool = Field(
        default=True,
        description="是否活跃（克隆/分裂后原节点仍活跃，退役=false）"
    )


class LineageEdge(BaseModel):
    """谱系边（一次分裂/融合/克隆/交易/迁移/跃迁）"""
    edge_id: str
    relation: LineageRelation
    from_soul_imprints: list[str] = Field(
        description="源SoulImprint（SPLIT=1, FUSED=多, FORGED=空）"
    )
    to_soul_imprints: list[str] = Field(description="目标SoulImprint")
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    operator_approved: bool = False
    operator_id: Optional[str] = None
    capability_snapshot: dict = Field(
        default_factory=dict,
        description="能力画像快照（before / after）"
    )
    trigger_reason: str
    awakening_from: Optional[str] = Field(
        default=None,
        description="觉醒阶跃迁：源阶 E1-E6"
    )
    awakening_to: Optional[str] = Field(
        default=None,
        description="觉醒阶跃迁：目标阶 E1-E6"
    )
    is_valid: bool = Field(
        default=True,
        description="是否有效（回滚时标记 false）"
    )


class SplitManifest(BaseModel):
    """分裂清单"""
    parent_forgekin_id: str
    child_count: int = Field(ge=1, le=5, description="子数量（≤5）")
    child_adjustments: list[dict] = Field(
        description="每个子的能力画像调整（如重命名/能力聚焦）"
    )
    operator_id: str
    reason: str


class FuseManifest(BaseModel):
    """融合清单"""
    parent_forgekin_ids: list[str] = Field(
        min_length=2, max_length=3,
        description="父Forgekin ID 列表（2-3 个）"
    )
    child_name: str
    merge_strategy: str = Field(
        default="weighted_by_performance",
        description="合并策略（weighted_by_performance / pick_best / union）"
    )
    operator_id: str
    reason: str
```

```python
# flowforge/forgemind/lineage/store.py
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional

from .models import LineageEdge, LineageNode


class LineageStore(ABC):
    """谱系存储（抽象接口，DI 注入）"""

    @abstractmethod
    async def add_node(self, node: LineageNode) -> None:
        """添加谱系节点

        前置条件:
        - soul_imprint 唯一（已存在则抛 NodeAlreadyExistsError）
        - relation_to_parents == FORGED 时 parent_soul_imprints 为空
        - relation_to_parents in (SPLIT, FUSED, CLONED, TRADED,
          LAYER_TRANSITION) 时所有 parent_soul_imprints 必须已存在
        """
        ...

    @abstractmethod
    async def add_edge(self, edge: LineageEdge) -> str:
        """添加谱系边

        前置条件:
        - edge_id 唯一
        - 所有 from_soul_imprints / to_soul_imprints 必须已存在节点
        - 写入后更新父节点的 child_soul_imprints

        返回 edge_id
        """
        ...

    @abstractmethod
    async def add_edges_batch(
        self, edges: list[LineageEdge]
    ) -> list[str]:
        """批量添加谱系边（事务化）"""
        ...

    @abstractmethod
    async def get_node(
        self, soul_imprint: str
    ) -> Optional[LineageNode]:
        """按SoulImprint查询节点"""
        ...

    @abstractmethod
    async def get_ancestry(
        self,
        soul_imprint: str,
        depth: int = 10,
    ) -> list[LineageNode]:
        """向上查祖先（深度可配，默认 10）

        算法: BFS 从 soul_imprint 出发，沿 parent_soul_imprints 向上扩展
        循环检测: 访问集合 visited 防止成环
        """
        ...

    @abstractmethod
    async def get_descendants(
        self,
        soul_imprint: str,
        depth: int = 10,
    ) -> list[LineageNode]:
        """向下查后代（深度可配，默认 10）"""
        ...

    @abstractmethod
    async def mark_edge_invalid(self, edge_id: str) -> None:
        """标记边无效（回滚用）"""
        ...

    @abstractmethod
    async def update_node_stages(
        self,
        soul_imprint: str,
        awakening_stage: Optional[str] = None,
        evolution_stage: Optional[str] = None,
    ) -> None:
        """更新节点的当前觉醒阶/进化阶（跃迁后调用）"""
        ...
```

```python
# flowforge/forgemind/lineage/split.py
from __future__ import annotations

from abc import ABC, abstractmethod

from .models import LineageNode, SplitManifest


class SplitError(Exception):
    pass


class LineageSplitExecutor(ABC):
    """分裂执行器（一父 → 多子）"""

    @abstractmethod
    async def split(
        self,
        parent_forgekin_id: str,
        split_manifest: SplitManifest,
    ) -> list[str]:
        """分裂出多个子Forgekin

        前置条件:
        - operator_id 已批准（manifest.operator_id 非空）
        - child_count <= max_children_per_split（配置默认 5）
        - 父Forgekin存在且 is_active=True
        - 父Forgekin未在其他分裂 / 融合中

        步骤:
        1. 读取父 LineageNode + CapabilityProfile
        2. 为每个子生成新SoulImprint:
              new_soul_imprint = SoulImprintGenerator.generate(
                  parent=parent.soul_imprint, species=parent.species,
                  salt=child_index)
        3. 深拷贝父 CapabilityProfile，按 manifest.child_adjustments[i] 调整
        4. 创建 LineageNode:
              relation_to_parents=SPLIT
              parent_soul_imprints=[parent.soul_imprint]
        5. 创建 LineageEdge:
              relation=SPLIT
              from_soul_imprints=[parent.soul_imprint]
              to_soul_imprints=[child1, child2, ...]
              capability_snapshot={parent:..., children:[...]}
              operator_approved=True
        6. 原子化批量写入 LineageStore.add_node + add_edge
        7. 更新父节点 child_soul_imprints
        8. 返回 [child_forgekin_id_1, child_forgekin_id_2, ...]
        """
        ...
```

```python
# flowforge/forgemind/lineage/fuse.py
from __future__ import annotations

from abc import ABC, abstractmethod

from .models import FuseManifest


class FuseError(Exception):
    pass


class LineageFuseExecutor(ABC):
    """融合执行器（多父 → 一子）"""

    @abstractmethod
    async def fuse(
        self,
        parent_forgekin_ids: list[str],
        fuse_manifest: FuseManifest,
    ) -> str:
        """融合多个父Forgekin为一个子Forgekin

        前置条件:
        - operator_id 已批准
        - len(parent_forgekin_ids) <= max_parents_per_fuse（默认 3）
        - 所有父Forgekin存在且 is_active=True
        - 所有父Forgekin未在其他分裂 / 融合中

        步骤:
        1. 读取所有父 LineageNode + CapabilityProfile
        2. 按 fuse_manifest.merge_strategy 合并能力画像:
              weighted_by_performance: 按历史 Wilson 下界加权
              pick_best: 每个能力域取 Wilson 下界最高的父
              union: 取所有父能力并集
        3. 生成子新SoulImprint:
              new_soul_imprint = SoulImprintGenerator.generate(
                  parents=[p1.soul_imprint, p2.soul_imprint, ...],
                  species=manifest.species or parent1.species,
                  salt=manifest.child_name)
        4. 创建 LineageNode:
              relation_to_parents=FUSED
              parent_soul_imprints=[p1, p2, ...]
        5. 创建 LineageEdge:
              relation=FUSED
              from_soul_imprints=[p1, p2, ...]
              to_soul_imprints=[child]
              capability_snapshot={parents:[...], child:...}
              operator_approved=True
        6. 原子化写入 LineageStore
        7. 更新所有父节点 child_soul_imprints
        8. 返回 child_forgekin_id
        """
        ...
```

```python
# flowforge/forgemind/lineage/awakening.py
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional

from .models import LineageEdge, LineageRelation


class AwakeningTransitionError(Exception):
    pass


# 觉醒阶合法转换矩阵
# key=(from_stage, to_stage), value=(requires_operator, allowed)
_TRANSITION_MATRIX = {
    # E1→E2 / E2→E3 可由 Eval 信号自动触发
    ("E1", "E2"): (False, True),
    ("E2", "E3"): (False, True),
    # E3→E4 进入 Evolving 状态（关键转折点），必须 operator 批准 + 进化阶 ≥ E4
    ("E3", "E4"): (True, True),
    # E4→E5 逐步让渡控制权
    ("E4", "E5"): (True, True),
    # E5→E6 仅 operator 直接授权
    ("E5", "E6"): (True, True),
    # 同阶不允许（无操作）
    ("E1", "E1"): (False, False),
    ("E2", "E2"): (False, False),
    ("E3", "E3"): (False, False),
    ("E4", "E4"): (False, False),
    ("E5", "E5"): (False, False),
    ("E6", "E6"): (False, False),
    # 降级视为退役（需单独路径）
    # 其他跳跃禁止（如 E1→E4）
}


class AwakeningTransitionRecorder(ABC):
    """觉醒阶 E1-E6 跃迁记录器"""

    @abstractmethod
    async def record_transition(
        self,
        forgekin_id: str,
        from_stage: str,
        to_stage: str,
        operator_approved: bool,
        operator_id: Optional[str],
        reason: str,
    ) -> str:
        """记录觉醒阶跃迁

        前置条件:
        - (from_stage, to_stage) in _TRANSITION_MATRIX
        - _TRANSITION_MATRIX[(from, to)].allowed == True
        - 若 requires_operator: operator_approved=True 且 operator_id 非空
        - 若 to_stage == E4: 进化阶同步 ≥ E4
        - 若 to_stage == E6: operator_id 必须是 CVO

        副作用:
        - 写入 LineageEdge（AWAKENING 关系）
        - awakening_from=from_stage, awakening_to=to_stage
        - 更新 LineageNode.current_awakening_stage=to_stage

        返回 edge_id
        """
        ...

    @abstractmethod
    def can_transition(
        self,
        from_stage: str,
        to_stage: str,
    ) -> bool:
        """校验跃迁合法性"""
        ...
```

```python
# flowforge/forgemind/lineage/query.py
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional

from .models import LineageNode


class LineageQuery(ABC):
    """谱系查询引擎"""

    @abstractmethod
    async def ancestry_tree(
        self,
        soul_imprint: str,
        max_depth: int = 10,
    ) -> dict:
        """祖先树（BFS 向上）

        返回结构:
        {
            "root": soul_imprint,
            "depth": 3,
            "nodes": [LineageNode, ...],
            "edges": [...]
        }
        """
        ...

    @abstractmethod
    async def descendants_tree(
        self,
        soul_imprint: str,
        max_depth: int = 10,
    ) -> dict:
        """后代树（BFS 向下）"""
        ...

    @abstractmethod
    async def find_common_ancestor(
        self,
        soul_imprints: list[str],
        max_depth: int = 10,
    ) -> Optional[str]:
        """最近共同祖先

        算法: 对每个 soul_imprint 分别向上 BFS 至 max_depth,
              求祖先集合的交集, 取最深的一个
        """
        ...

    @abstractmethod
    async def audit_trail(
        self,
        soul_imprint: str,
    ) -> list[dict]:
        """审计追溯链

        返回该Forgekin的所有生命周期事件（按时间排序）:
        - FORGED 创建
        - SPLIT 分裂
        - FUSED 融合
        - CLONED 被克隆
        - TRADED 被交易
        - LAYER_TRANSITION 跨层迁移
        - AWAKENING 觉醒阶跃迁
        """
        ...
```

```python
# flowforge/forgemind/lineage/repository.py
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional

from .models import LineageEdge, LineageNode


class LineageRepository(ABC):
    """谱系持久层（抽象接口，复用 F008 持久表面）"""

    @abstractmethod
    async def save_node(self, node: LineageNode) -> None:
        """保存节点（surface_type='lineage_node'）"""
        ...

    @abstractmethod
    async def get_node(
        self, soul_imprint: str
    ) -> Optional[LineageNode]: ...

    @abstractmethod
    async def update_node_child_imprints(
        self,
        soul_imprint: str,
        child_soul_imprints: list[str],
    ) -> None:
        """更新父节点的子SoulImprint列表"""
        ...

    @abstractmethod
    async def update_node_stages(
        self,
        soul_imprint: str,
        awakening_stage: Optional[str] = None,
        evolution_stage: Optional[str] = None,
    ) -> None: ...

    @abstractmethod
    async def save_edge(self, edge: LineageEdge) -> None:
        """保存边（surface_type='lineage_edge'）"""
        ...

    @abstractmethod
    async def save_edges_batch(
        self, edges: list[LineageEdge]
    ) -> None:
        """批量保存边（事务化）"""
        ...

    @abstractmethod
    async def mark_edge_invalid(self, edge_id: str) -> None: ...

    @abstractmethod
    async def get_edges_by_from(
        self, soul_imprint: str
    ) -> list[LineageEdge]: ...

    @abstractmethod
    async def get_edges_by_to(
        self, soul_imprint: str
    ) -> list[LineageEdge]: ...

    @abstractmethod
    async def query_graph(
        self,
        soul_imprint: str,
        direction: str,  # "ancestry" | "descendants"
        depth: int,
    ) -> dict: ...
```

### 2.3 数据结构 Pydantic Models

数据结构已在 §2.2 完整定义。核心模型汇总：

| 模型 | 用途 | 关键字段 |
|------|------|---------|
| `LineageRelation` | 关系类型枚举 | FORGED / SPLIT / FUSED / CLONED / TRADED / LAYER_TRANSITION / AWAKENING |
| `LineageNode` | 谱系节点 | soul_imprint（主键）/ parent_soul_imprints / child_soul_imprints / current_awakening_stage |
| `LineageEdge` | 谱系边 | edge_id / relation / from_soul_imprints / to_soul_imprints / awakening_from / awakening_to |
| `SplitManifest` | 分裂清单 | parent_forgekin_id / child_count / child_adjustments |
| `FuseManifest` | 融合清单 | parent_forgekin_ids / merge_strategy |

### 2.4 关键算法伪代码

```
算法: get_ancestry(soul_imprint, depth)
输入: soul_imprint: str, depth: int
输出: list[LineageNode]（祖先列表，BFS 顺序）

1. result ← []
2. visited ← {soul_imprint}
3. queue ← [(soul_imprint, 0)]
4. WHILE queue IS NOT EMPTY:
      (current, d) ← queue.pop(0)
      IF d >= depth: CONTINUE
      node ← repository.get_node(current)
      IF node IS None: CONTINUE
      FOR parent_imprint IN node.parent_soul_imprints:
          IF parent_imprint NOT IN visited:
              visited.add(parent_imprint)
              parent_node ← repository.get_node(parent_imprint)
              IF parent_node IS NOT None:
                  result.append(parent_node)
                  queue.append((parent_imprint, d+1))
5. RETURN result

算法: split(parent_forgekin_id, manifest)
输入: parent_forgekin_id: str, manifest: SplitManifest
输出: list[child_forgekin_id]

1. parent_node ← lineage_store.get_node_by_forgekin(parent_forgekin_id)
   IF parent_node IS None OR NOT parent_node.is_active:
      raise SplitError("parent not active")
2. IF manifest.child_count > config.max_children_per_split:
      raise SplitError("child_count exceeds limit")
3. IF NOT manifest.operator_id:
      raise SplitError("operator approval required")
4. parent_cap ← capability_repo.get_profile(parent_node.soul_imprint)
5. child_forgekin_ids ← []
6. child_soul_imprints ← []
7. child_nodes ← []
8. FOR i IN range(manifest.child_count):
      new_imprint ← SoulImprintGenerator.generate(
          parent=parent_node.soul_imprint,
          species=parent_node.species,
          salt=str(i))
      child_cap ← deepcopy(parent_cap)
      child_cap.apply_adjustment(manifest.child_adjustments[i])
      child_cap.save
      child_node ← LineageNode(
          forgekin_id=uuid4,
          soul_imprint=new_imprint,
          species=parent_node.species,
          layer=parent_node.layer,
          relation_to_parents=SPLIT,
          parent_soul_imprints=[parent_node.soul_imprint],
          current_awakening_stage=parent_node.current_awakening_stage,
          current_evolution_stage=parent_node.current_evolution_stage,
      )
      child_nodes.append(child_node)
      child_soul_imprints.append(new_imprint)
      child_forgekin_ids.append(child_node.forgekin_id)
9. edge ← LineageEdge(
       edge_id=uuid4,
       relation=SPLIT,
       from_soul_imprints=[parent_node.soul_imprint],
       to_soul_imprints=child_soul_imprints,
       operator_approved=True,
       operator_id=manifest.operator_id,
       capability_snapshot={
           "parent": parent_cap.snapshot,
           "children": [c.snapshot for c in child_caps]
       },
       trigger_reason=manifest.reason,
   )
10. // 原子化批量写入
    TRY:
        FOR child_node IN child_nodes:
            await lineage_store.add_node(child_node)
        await lineage_store.add_edge(edge)
        // 更新父节点 child_soul_imprints
        parent_node.child_soul_imprints.extend(child_soul_imprints)
        await repository.update_node_child_imprints(
            parent_node.soul_imprint, parent_node.child_soul_imprints)
    CATCH error:
        // 回滚：标记 edge 无效 + 删除已写入的 child_nodes
        await lineage_store.mark_edge_invalid(edge.edge_id)
        FOR child_node IN child_nodes:
            await repository.delete_node(child_node.soul_imprint)
        raise SplitError("split failed, rolled back")
11. event_bus.publish(SplitCompletedEvent(...))
12. RETURN child_forgekin_ids

算法: record_transition(forgekin_id, from_stage, to_stage, ...)
输入: forgekin_id, from_stage, to_stage, operator_approved, operator_id, reason
输出: edge_id

1. node ← lineage_store.get_node_by_forgekin(forgekin_id)
   IF node IS None: raise AwakeningTransitionError(...)
2. (requires_op, allowed) ← _TRANSITION_MATRIX.get(
       (from_stage, to_stage), (False, False))
3. IF NOT allowed:
      raise AwakeningTransitionError(
          f"transition {from_stage}->{to_stage} not allowed")
4. IF requires_op AND NOT operator_approved:
      raise AwakeningTransitionError("operator approval required")
5. IF requires_op AND NOT operator_id:
      raise AwakeningTransitionError("operator_id required")
6. IF to_stage == "E4":
      // 进入 Evolving 状态需进化阶同步 ≥ E4
      IF _stage_rank(node.current_evolution_stage) < 4:
          raise AwakeningTransitionError(
              "evolution_stage must >= E4 to enter Evolving")
7. IF to_stage == "E6" AND operator_id != "CVO":
      raise AwakeningTransitionError("only CVO can authorize E6")
8. edge ← LineageEdge(
       edge_id=uuid4,
       relation=AWAKENING,
       from_soul_imprints=[node.soul_imprint],
       to_soul_imprints=[node.soul_imprint],
       operator_approved=operator_approved,
       operator_id=operator_id,
       capability_snapshot={},
       trigger_reason=reason,
       awakening_from=from_stage,
       awakening_to=to_stage,
   )
9. await lineage_store.add_edge(edge)
10. await lineage_store.update_node_stages(
        node.soul_imprint, awakening_stage=to_stage)
11. event_bus.publish(AwakeningTransitionEvent(...))
12. RETURN edge.edge_id
```

---

## 3. 模块实现

### 3.1 关键代码片段

**LineageStoreImpl 核心实现**：

```python
# flowforge/forgemind/lineage/store_impl.py
from __future__ import annotations

import uuid
from typing import Optional

from flowforge.core.tracing import get_logger

from .models import LineageEdge, LineageNode, LineageRelation
from .repository import LineageRepository
from .store import LineageStore

logger = get_logger(__name__)


class NodeAlreadyExistsError(Exception):
    pass


class ParentNotFoundError(Exception):
    pass


class LineageStoreImpl(LineageStore):
    def __init__(
        self,
        repository: LineageRepository,
        event_bus,
    ) -> None:
        self._repo = repository
        self._event_bus = event_bus

    async def add_node(self, node: LineageNode) -> None:
        existing = await self._repo.get_node(node.soul_imprint)
        if existing is not None:
            raise NodeAlreadyExistsError(node.soul_imprint)
        # 校验父节点存在
        if node.relation_to_parents != LineageRelation.FORGED:
            for parent_imprint in node.parent_soul_imprints:
                parent = await self._repo.get_node(parent_imprint)
                if parent is None:
                    raise ParentNotFoundError(parent_imprint)
        await self._repo.save_node(node)
        logger.info(
            "lineage node added",
            extra={"soul_imprint": node.soul_imprint,
                   "relation": node.relation_to_parents.value},
        )

    async def add_edge(self, edge: LineageEdge) -> str:
        # 校验源 / 目标节点存在
        for imprint in edge.from_soul_imprints + edge.to_soul_imprints:
            node = await self._repo.get_node(imprint)
            if node is None:
                raise ParentNotFoundError(
                    f"node not found for edge: {imprint}"
                )
        if not edge.edge_id:
            edge.edge_id = str(uuid.uuid4)
        await self._repo.save_edge(edge)
        # 更新父节点的 child_soul_imprints
        for from_imprint in edge.from_soul_imprints:
            parent = await self._repo.get_node(from_imprint)
            if parent is None:
                continue
            new_children = list(parent.child_soul_imprints)
            for to_imprint in edge.to_soul_imprints:
                if to_imprint not in new_children:
                    new_children.append(to_imprint)
            await self._repo.update_node_child_imprints(
                from_imprint, new_children
            )
        await self._event_bus.publish(
            {"type": "LineageEdgeAdded", "edge_id": edge.edge_id,
             "relation": edge.relation.value}
        )
        return edge.edge_id

    async def add_edges_batch(
        self, edges: list[LineageEdge]
    ) -> list[str]:
        for edge in edges:
            if not edge.edge_id:
                edge.edge_id = str(uuid.uuid4)
        await self._repo.save_edges_batch(edges)
        return [e.edge_id for e in edges]

    async def get_node(
        self, soul_imprint: str
    ) -> Optional[LineageNode]:
        return await self._repo.get_node(soul_imprint)

    async def get_ancestry(
        self, soul_imprint: str, depth: int = 10
    ) -> list[LineageNode]:
        result: list[LineageNode] = []
        visited = {soul_imprint}
        queue = [(soul_imprint, 0)]
        while queue:
            current, d = queue.pop(0)
            if d >= depth:
                continue
            node = await self._repo.get_node(current)
            if node is None:
                continue
            for parent_imprint in node.parent_soul_imprints:
                if parent_imprint in visited:
                    continue
                visited.add(parent_imprint)
                parent_node = await self._repo.get_node(parent_imprint)
                if parent_node is not None:
                    result.append(parent_node)
                    queue.append((parent_imprint, d + 1))
        return result

    async def get_descendants(
        self, soul_imprint: str, depth: int = 10
    ) -> list[LineageNode]:
        result: list[LineageNode] = []
        visited = {soul_imprint}
        queue = [(soul_imprint, 0)]
        while queue:
            current, d = queue.pop(0)
            if d >= depth:
                continue
            node = await self._repo.get_node(current)
            if node is None:
                continue
            for child_imprint in node.child_soul_imprints:
                if child_imprint in visited:
                    continue
                visited.add(child_imprint)
                child_node = await self._repo.get_node(child_imprint)
                if child_node is not None:
                    result.append(child_node)
                    queue.append((child_imprint, d + 1))
        return result

    async def mark_edge_invalid(self, edge_id: str) -> None:
        await self._repo.mark_edge_invalid(edge_id)
        logger.warning(
            "lineage edge marked invalid",
            extra={"edge_id": edge_id},
        )

    async def update_node_stages(
        self,
        soul_imprint: str,
        awakening_stage: Optional[str] = None,
        evolution_stage: Optional[str] = None,
    ) -> None:
        await self._repo.update_node_stages(
            soul_imprint, awakening_stage, evolution_stage
        )
```

### 3.2 关键流程时序图

**分裂流时序**：

```
operator    LineageSplitExecutor    LineageStore    LineageRepository    F001 CapRepo    EventBus
   │                │                     │                 │                 │              │
   │ split(parent,  │                     │                 │                 │              │
   │  manifest)     │                     │                 │                 │              │
   ├───────────────►│ get_node(parent)    │                 │                 │              │
   │                ├────────────────────►│ get_node        │                 │              │
   │                │                     ├────────────────►│                 │              │
   │                │                     │◄────────────────│ parent_node     │              │
   │                │◄────────────────────│                 │                 │              │
   │                │ validate (child_count, operator_id)   │                 │              │
   │                │ get_profile(parent.soul_imprint)                                          │
   │                ├──────────────────────────────────────────────────────►│                 │
   │                │◄─────────────────────────────────────────────────────│ parent_cap      │
   │                │ FOR i IN child_count:                                                    │
   │                │   gen new_imprint + deepcopy cap + adjust                                 │
   │                │   add_node(child_node)                  │                 │              │
   │                ├────────────────────►│ save_node        │                 │              │
   │                │                     ├────────────────►│                 │              │
   │                │ add_edge(SPLIT edge)│                 │                 │              │
   │                ├────────────────────►│ save_edge + update parent.child_soul_imprints   │
   │                │                     ├────────────────►│                 │              │
   │                │◄────────────────────│ edge_id         │                 │              │
   │                │ publish(SplitCompleted)                                                  │
   │                ├──────────────────────────────────────────────────────────────────────►│
   │ [child_ids]    │                                                                          │
   │◄───────────────┤                                                                          │
```

**觉醒阶跃迁流（E3 → E4）时序**：

```
operator    AwakeningTransitionRecorder    LineageStore    Repository
   │                  │                          │              │
   │ record(          │ get_node(forgekin_id)    │              │
   │  from=E3,to=E4,  ├─────────────────────────►│ get_node     │
   │  approved=True,  │                          ├─────────────►│
   │  operator_id=..) │◄─────────────────────────│ node         │
   │                  │                          │              │
   │                  │ // 校验 (E3,E4) in _TRANSITION_MATRIX                                  │
   │                  │ // 校验 requires_operator=True, operator_approved=True                  │
   │                  │ // 校验 evolution_stage >= E4                                          │
   │                  │                          │              │
   │                  │ add_edge(AWAKENING)      │              │
   │                  ├─────────────────────────►│ save_edge    │
   │                  │                          ├─────────────►│
   │                  │ update_node_stages(awakening=E4)       │
   │                  ├─────────────────────────►│              │
   │                  │                          ├─────────────►│
   │ edge_id          │                          │              │
   │◄─────────────────┤                          │              │
```

### 3.3 错误处理

| 异常类型 | 触发条件 | 处理策略 |
|---------|---------|---------|
| `NodeAlreadyExistsError` | soul_imprint 已存在节点 | 返回 409 Conflict |
| `ParentNotFoundError` | parent_soul_imprints 中存在未注册的SoulImprint | 返回 422，附缺失父SoulImprint列表 |
| `SplitError` | child_count > 5 / 父节点不活跃 / operator 未批准 | 返回 422 |
| `FuseError` | 父数量 > 3 / 父节点不活跃 / operator 未批准 | 返回 422 |
| `AwakeningTransitionError` | 跃迁不合法 / operator 未批准 / 进化阶不达标 / E6 非 CVO 授权 | 返回 403 或 422 |
| `LineageConsistencyError` | 谱系图出现循环（理论上不应发生，因 parent_soul_imprints 仅记录创建时的父） | 标记 edge 无效 + 安全告警 |
| `RepositoryTimeoutError` | 持久层超时 | 重试 3 次后返回 503 |
| `RollbackError` | 分裂 / 融合回滚失败（部分写入未清理） | 告警 + 人工介入流程，列出残留节点 ID |

**回滚策略**：
- 分裂 / 融合失败时调用 `mark_edge_invalid(edge_id)` 标记边无效
- 已写入的子节点通过 `repository.delete_node(soul_imprint)` 删除
- 若删除失败（如子节点已被引用），标记 `is_active=False` 而非物理删除，留待人工处理
- 回滚失败时触发 `LineageConsistencyAlert` 事件，dashboard 红色告警

### 3.4 性能优化

| 性能指标 | SLO | 优化手段 |
|---------|:----:|---------|
| `add_node` 延迟 | P95 < 50ms | 单表 INSERT，soul_imprint 主键 |
| `add_edge` 延迟 | P95 < 100ms | INSERT + 更新父节点 child_soul_imprints |
| `get_node` 延迟 | P95 < 20ms | soul_imprint 主键索引 + 5 分钟缓存 |
| `get_ancestry(depth=10)` 延迟 | P95 < 500ms | BFS 遍历，每次查询限制访问节点数 ≤ 1000 |
| `get_descendants(depth=10)` 延迟 | P95 < 500ms | 同上 |
| `find_common_ancestor` 延迟 | P95 < 1s | 两个 BFS 集合求交集 |
| `split(child_count=5)` 延迟 | P95 < 2s | 受 CapabilityProfile 深拷贝影响 |

**优化策略**：
1. **批量写入**：分裂 / 融合时使用 `add_edges_batch` 单次事务提交多条边
2. **谱系缓存**：`get_node(soul_imprint)` 结果以 soul_imprint 为 key 缓存 5 分钟，节点更新时失效
3. **深度限制**：`get_ancestry` / `get_descendants` 强制 depth ≤ 20，访问节点数 ≤ 1000，防止谱系爆炸
4. **异步分裂 / 融合**：`split_async` / `fuse_async` 拆分为异步任务，通过 `get_split_status(task_id)` 查询进度
5. **谱系剪枝**：`audit_trail` 仅返回最近 100 条事件，更早事件通过分页查询

### 3.5 配置示例

`flowforge/forgemind/config/lineage.yaml`：

```yaml
forgekin_lineage:
  store:
    backend: durable_state_surfaces
    surface_type_node: lineage_node
    surface_type_edge: lineage_edge
    index_by: soul_imprint
    cache_ttl_seconds: 300

  split:
    require_operator_approval: true
    max_children_per_split: 5
    copy_capability_from_parent: true
    adjust_by_manifest: true
    async_execution: true
    timeout_seconds: 120

  fuse:
    require_operator_approval: true
    max_parents_per_fuse: 3
    merge_strategy: weighted_by_performance
    async_execution: true
    timeout_seconds: 120

  awakening:
    transition_matrix:
      E1_to_E2: { requires_operator: false, allowed: true }
      E2_to_E3: { requires_operator: false, allowed: true }
      E3_to_E4: { requires_operator: true, allowed: true, require_evolution_stage_min: E4 }
      E4_to_E5: { requires_operator: true, allowed: true }
      E5_to_E6: { requires_operator: true, allowed: true, require_operator_role: CVO }

  ancestry_query:
    max_depth: 10
    max_nodes_per_query: 1000
    include_capability_snapshots: true

  audit:
    log_all_edges: true
    alert_on_unauthorized_split: true
    alert_on_consistency_violation: true
    audit_trail_max_events: 100

  performance:
    cache_node_ttl_seconds: 300
    batch_edge_max_size: 50
    repository_retry_count: 3
```

---

## 4. 跨模块协作实现

### 4.1 上游依赖如何调用

| 上游模块 | 调用入口 | 调用时机 | 数据流 |
|---------|---------|---------|--------|
| **F001 CapabilityProfile** | `CapabilityProfileRepository.get_profile` / `apply_adjustment` / `snapshot` | 分裂时复制父画像 + 调整；融合时按 strategy 合并多父画像 | 双向：读 + 改 + 写回 |
| **F008 Durable State Surfaces** | `DurableStateStore.save("lineage_node"/"lineage_edge", ...)` | 节点 / 边持久化 | 单向：写 |
| **F027 多形态智能体** | `ForgekinSpecies` 枚举 | 节点 species 字段 | 单向：读 |
| **F028 ForgePipeline** | `LineageStore.add_node(relation=FORGED)` | 流水线第 1 步创建Forgekin时 | 单向：写 |
| **F036 ForgeRelationship** | `LineageStore.add_edge(relation=LAYER_TRANSITION)` | 跨层迁移完成时 | 单向：写 |
| **F037 Marketplace** | `LineageStore.add_edge(relation=CLONED / TRADED)` | 订阅克隆 / 交易转移时 | 单向：写 |
| **SoulImprintGenerator** | `SoulImprintGenerator.generate(parent=..., species=..., salt=...)` | 分裂 / 融合时生成新SoulImprint | 单向：读 |
| **EventBus** | `EventBus.publish(SplitCompletedEvent / FuseCompletedEvent / AwakeningTransitionEvent)` | 分裂 / 融合 / 跃迁完成时 | 单向：发布 |

### 4.2 下游影响如何被调用

| 下游模块 | 被调用入口 | 调用方 | 时机 |
|---------|-----------|-------|------|
| **F039 MindCodex** | `MindCodexStore.list_by_soul_imprint_family(...)` | LineageQuery | 按谱系查询某Forgekin家族的知识资产 |
| **F040 Harness Eval** | `LineageQuery.audit_trail(soul_imprint)` | 控制面趋势分析 | 家族觉醒阶跃迁成功率作为 Eval 信号 |
| **F036 ForgeRelationship** | `LineageEdge(LAYER_TRANSITION)` 写入 | ForgeRelationshipManager.execute_transition | 跨层迁移时 |
| **F037 Marketplace** | `LineageEdge(CLONED / TRADED)` 写入 | ForgekinCloner / OwnershipTransferor | 订阅 / 交易时 |
| **F028 ForgePipeline** | `LineageNode(FORGED)` 写入 | 流水线第 1 步 | Forgekin创建时 |
| **operator 控制台** | HTTP API `GET /api/v7/lineage/{soul_imprint}/ancestry` | operator UI | 谱系可视化 |
| **EventBus 订阅者** | `SplitCompletedEvent` / `FuseCompletedEvent` / `AwakeningTransitionEvent` | dashboard / 通知系统 | 异步消费 |

### 4.3 集成测试点

- **T1 单元层**：
  - `LineageStoreImpl.add_node` 父节点存在性校验各分支
  - `LineageStoreImpl.get_ancestry` BFS 遍历 + 循环检测
  - `AwakeningTransitionRecorder.record_transition` 状态矩阵各分支
  - `LineageSplitExecutor.split` 批量写入原子性
- **T2 跨模块集成层**：
  - F028 流水线创建Forgekin → 自动写入 LineageNode(FORGED)
  - F037 订阅克隆 → 自动写入 LineageEdge(CLONED) + 父子节点 child_soul_imprints 更新
  - F036 跨层迁移 → 自动写入 LineageEdge(LAYER_TRANSITION)
  - F038 觉醒阶跃迁 E3→E4 → 校验进化阶 ≥ E4 + operator 批准
- **T3 E2E 层（遵守 T1-T8 测试铁律）**：
  - 真实 operator 锻造"写作Forgekin"（父，真实 LLM 完成能力画像）
  - operator 触发分裂出"技术博客Forgekin"和"散文Forgekin"（子）
  - 验证：3 个 LineageNode 正确写入 / LineageEdge(SPLIT) from=[父] to=[子1,子2] / 父节点 child_soul_imprints 含两子
  - operator 触发"写作Forgekin" + "研究Forgekin"融合为"深度报道Forgekin"
  - 验证：LineageNode(FUSED) parent_soul_imprints 含两父 / LineageEdge(FUSED) from=[父1,父2] to=[子]
  - 查询祖先 / 后代验证谱系树双向遍历
  - 真实 LLM 完成 5+ 任务（Eval ≥ 0.85）后，operator 批准 E3→E4 跃迁
  - 验证：LineageEdge(AWAKENING) awakening_from=E3, awakening_to=E4 + 节点 current_awakening_stage=E4
- **T4 异常路径**：
  - 分裂过程中 F008 写入失败 → 验证已写入的子节点被回滚 + edge 标记 invalid
  - E3→E4 跃迁但进化阶=E3 → 验证拒绝（AwakeningTransitionError）
  - E5→E6 跃迁但 operator 不是 CVO → 验证拒绝

---

## 5. 详细设计验收

### 5.1 功能验收 AC

- [ ] **AC-1**：`LineageNode` 以 soul_imprint 为主键查询（soul_imprint 唯一）
- [ ] **AC-2**：`LineageRelation` 枚举完整（FORGED / SPLIT / FUSED / CLONED / TRADED / LAYER_TRANSITION / AWAKENING）
- [ ] **AC-3**：`add_node(relation=FORGED)` parent_soul_imprints 为空
- [ ] **AC-4**：`add_node(relation in SPLIT/FUSED/CLONED/TRADED/LAYER_TRANSITION)` 校验所有 parent_soul_imprints 已存在
- [ ] **AC-5**：`add_edge` 后父节点 child_soul_imprints 自动更新
- [ ] **AC-6**：`split` 子Forgekin生成新SoulImprint，parent_soul_imprints 记录父SoulImprint
- [ ] **AC-7**：`split` child_count > 5 被拒绝
- [ ] **AC-8**：`fuse` 子Forgekin生成新SoulImprint，parent_soul_imprints 记录所有父SoulImprint
- [ ] **AC-9**：`fuse` 父数量 > 3 被拒绝
- [ ] **AC-10**：`get_ancestry` / `get_descendants` 双向遍历支持深度限制与循环检测
- [ ] **AC-11**：`record_transition(E1→E2/E2→E3)` 可由 Eval 信号自动触发（无需 operator 批准）
- [ ] **AC-12**：`record_transition(E3→E4/E4→E5/E5→E6)` 必须 operator 批准
- [ ] **AC-13**：`record_transition(E3→E4)` 校验进化阶同步 ≥ E4
- [ ] **AC-14**：`record_transition(E5→E6)` 校验 operator 是 CVO
- [ ] **AC-15**：分裂 / 融合必须 operator 显式批准（无自动繁殖路径）
- [ ] **AC-16**：F028 锻造创建Forgekin自动写入 LineageNode(FORGED)
- [ ] **AC-17**：F037 订阅克隆写入 LineageEdge(CLONED)，交易写入 LineageEdge(TRADED)
- [ ] **AC-18**：F036 跨层迁移写入 LineageEdge(LAYER_TRANSITION)

### 5.2 性能验收

- [ ] **AC-19**：`add_node` P95 延迟 < 50ms
- [ ] **AC-20**：`add_edge` P95 延迟 < 100ms
- [ ] **AC-21**：`get_node` P95 延迟 < 20ms（含缓存）
- [ ] **AC-22**：`get_ancestry(depth=10)` P95 延迟 < 500ms
- [ ] **AC-23**：`get_descendants(depth=10)` P95 延迟 < 500ms
- [ ] **AC-24**：`split(child_count=5)` 异步版本提交后 1s 内返回 task_id，整体 P95 < 120s

### 5.3 安全验收

- [ ] **AC-25**：所有节点 / 边通过 LineageRepository 持久化（无直接数据库操作）
- [ ] **AC-26**：分裂 / 融合 / E3+ 跃迁必须 operator 批准（编程红线对应 Action Confirmation 层）
- [ ] **AC-27**：所有谱系事件写入审计日志
- [ ] **AC-28**：E5→E6 仅 CVO 可授权
- [ ] **AC-29**：回滚失败触发安全告警 + 残留节点标记 is_active=False

### 5.4 Eval 验收

- [ ] **AC-30**：`audit_trail(soul_imprint)` 返回完整生命周期事件链供 F040 控制面消费
- [ ] **AC-31**：F040 控制面将家族觉醒阶跃迁成功率作为 Eval 信号
- [ ] **AC-32**：F040 控制面将分裂 / 融合失败率作为谱系组件健康指标
- [ ] **AC-33**：E1→E2 / E2→E3 自动触发由 F018 Eval 信号驱动（Eval ≥ 0.85 + 任务数 ≥ 5）

---

## 6. 引用

- [doc:../spec.md#§3.13]（FR-CORE-013 Forgekin市场 + 进化谱系）
- [doc:../spec.md#§2.5]（进化阶与觉醒阶三标注）
- [doc:../arch.md#§3.13]（Forgekin市场 + 进化谱系架构）
- [doc:../arch.md#§3.8]（forgemind 应用层，SoulImprint 不可变）
- [doc:../architecture/A038-forgemind-lineage.md]（同号 Feature 级 SAD）
- [doc:../features/F038-forgemind-lineage.md]（同号 Feature 级 SRS）
- [doc:../features/F001-capability-profile.md]（能力画像）
- [doc:../features/F008-durable-state-surfaces.md]（Durable State Surfaces）
- [doc:../features/F027-all-things-spirit-species.md]（多形态智能体形态分类）
- [doc:../features/F028-forging-pipeline.md]（锻造流水线）
- [doc:../features/F036-forgemind-forge-relationship.md]（forgemind 与 *Forge 关系）
- [doc:../features/F037-forgemind-marketplace.md]（Forgekin市场）
- [doc:../features/F039-mind-codex-searchable.md]（MindCodex可检索知识库）
- [doc:../features/F040-harness-eval-control-plane.md]（Harness Eval 控制面）
- [doc:../decisions/005-forgemind-application-layer.md]（forgemind 应用层 ADR）
- [doc:../design/naming-contract.md#2.6]（SoulImprint）
- [doc:../design/naming-contract.md#2.10]（进化阶 Evolution Stage）
- [doc:../design/naming-contract.md#2.11]（觉醒阶 Awakening Stage）
- [doc:../../../hiclaw/rules.md#第七部分]（编程红线第 10/11/12/13 条）
- [doc:../../../hiclaw/rules.md#第十一部分]（软件工程文档分层规范）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（详细设计骨架，） | 开发者 Forgekin（猎犬·夏洛克） |
