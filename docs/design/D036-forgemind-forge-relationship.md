# D036: forgemind 与 *Forge 关系详细设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 开发者灵智体（猎犬·夏洛克）
> **对应 spec.md**: [doc:../spec.md#§3.8] + [doc:../spec.md#§3.15]（FR-CORE-008 / FR-CORE-015 / FR-CORE-029）
> **对应 arch.md**: [doc:../arch.md#§3.8] + [doc:../arch.md#§3.15]
> **对应 design.md**: [doc:../design.md#§3.8] + [doc:../design.md#§3.15]
> **对应 Feature**: [doc:../features/F036-forgemind-forge-relationship.md]（同号 Feature 级 SRS）
> **对应 Architecture**: [doc:../architecture/A036-forgemind-forge-relationship.md]（同号 Feature 级 SAD）
> **依赖 ADR**: [doc:../decisions/005-forgemind-application-layer.md] + [doc:../decisions/003-plugin-v3-protocol.md]
> **9 大点名称修订**: 已应用（双轨命名 + AI 术语优先 + 弱化万物 + 去 AGI 化）

---

## 1. 详细设计上下文

### 1.1 设计问题

本详细设计在 A036 架构设计基础上，深入到代码层落地 forgemind（Layer 2 通用灵智体承载）与 *Forge（Layer 3 垂直业务灵智体承载）的关系系统，需解决以下工程问题：

- **Plugin V3 四钩子工程契约**：`register_forgekins` / `register_forge_skills` / `register_council_channels` / `register_auto_forge_config` 四钩子如何以 Python 抽象方法形式落地? 入参 registry 类型如何定义?
- **LayerTransitionEngine 状态机**：跨层迁移（进化 / 回炉）如何用状态机校验前置条件、调用 operator 审批、原子化执行迁移?
- **能力画像复制与蒸馏实现**：进化时如何从 forgemind 复制 CapabilityProfile 到目标 *Forge 层并新增 vertical SkillPackage? 回炉时如何调用 SpiritForge 蒸馏通用能力并保留垂直能力?
- **谱系边原子写入**：跨层迁移如何同时写 ForgeRelationshipRepository 与 F038 LineageStore，保证二者一致性?
- **operator 审批异步化**：迁移请求提交后如何挂起等待 operator 审批? 审批结果如何回写?

### 1.2 设计约束

- **单向依赖**：`flowforge/forgemind/relationship/` 禁止 `import contentforge.* / devforge.* / novelforge.* / mallforge.*`；仅可 import `flowforge/core/*` 与 `flowforge/forgemind/*`
- **DI 容器**：`ForgeRelationshipManager` / `LayerTransitionEngine` / `EvolveExecutor` / `ReclaimExecutor` / `ForgeRelationshipRepository` 必须由 DI 容器以 singleton 或 scoped scope 注入
- **Repository 层**：所有持久化必须经 `ForgeRelationshipRepository` 抽象，禁止 `cursor.execute()` / `session.add()` 直接调用
- **配置驱动**：layers / transition_rules / vertical_skills / operator_approval 必须来自 `flowforge/forgemind/config/forge_relationship.yaml`
- **Plugin V3 协议**：`ForgeMindPlugin` 必须继承 `FlowForgePlugin` 并实现四钩子；*Forge Plugin 通过钩子被动注册，forgemind 不可主动扫描 *Forge
- **原子化迁移**：LayerTransition 写入 Repository + 谱系边写入 LineageStore + 能力画像更新必须事务化，任一失败则回滚
- **9 大点名称修订**：代码层使用 Forgekin / ForgeLayer / CapabilityProfile / ForgekinEngine；文档层使用"灵智体 / 灵智 / 通用 / 垂直"

### 1.3 设计影响

- **新增模块**：`flowforge/forgemind/relationship/` 下 6 个文件（manager.py / transition.py / evolve.py / reclaim.py / repository.py / models.py）
- **修改模块**：`flowforge/forgemind/plugins.py` 新增 ForgeMindPlugin 四钩子实现；`flowforge/core/plugin/protocol.py` 扩展 FlowForgePlugin 抽象基类
- **影响 F028 ForgePipeline**：流水线新增"通用→垂直"分支调用 `LayerTransitionEngine.evolve()`，"垂直→通用"分支调用 `LayerTransitionEngine.reclaim()`
- **影响 F037 灵智体市场**：MarketplaceListing 新增 `layer: ForgeLayer` 字段，市场查询支持 `?layer=forgemind|contentforge|...` 过滤
- **影响 F038 进化谱系**：LineageStore 新增 `LAYER_TRANSITION` 关系类型边的写入入口
- **影响 F039 灵典可检索知识库**：回炉蒸馏产出的通用 SkillPackage 写入 Mind Codex，可被其他灵智体检索消费

---

## 2. 详细设计

### 2.1 类图 ASCII

```
                          ┌─────────────────────────────┐
                          │  <<abstract>>               │
                          │  FlowForgePlugin             │
                          │  (core/plugin/protocol.py)   │
                          │  ─────────────────────────   │
                          │  + register_forgekins()      │
                          │  + register_forge_skills()   │
                          │  + register_council_channels()│
                          │  + register_auto_forge_config()│
                          └──────────────┬──────────────┘
                                         │ extends
                                         ▼
                          ┌─────────────────────────────┐
                          │  ForgeMindPlugin             │
                          │  (forgemind/plugins.py)      │
                          │  ─────────────────────────   │
                          │  - relationship_manager:     │
                          │    ForgeRelationshipManager   │
                          │  - skill_registry             │
                          │  - council_registry           │
                          │  - auto_forge_config          │
                          │  + register_forgekins() ───┐  │
                          │  + register_forge_skills() │  │
                          │  + register_council_channels│ │
                          │  + register_auto_forge_config│ │
                          └──────────────────────────┬─┘  │
                                                      │    │
                                                      ▼    │
          ┌────────────────────────────────────────────────┴────┐
          │  <<abstract>>                                       │
          │  ForgeRelationshipManager                            │
          │  (forgemind/relationship/manager.py)                 │
          │  ─────────────────────────                           │
          │  + get_relationship(forgekin_id)                     │
          │  + request_evolve_to_vertical(...)                   │
          │  + request_reclaim_to_forgemind(...)                 │
          │  + execute_transition(transition_id)                 │
          └─────────────┬───────────────────────┬────────────────┘
                        │ implements            │ uses
                        ▼                       ▼
          ┌─────────────────────────┐  ┌──────────────────────────┐
          │ ForgeRelationship       │  │ <<abstract>>             │
          │ ManagerImpl             │  │ LayerTransitionEngine     │
          │                         │  │ (transition.py)           │
          │ - repository            │  │ + validate_precondition()│
          │ - transition_engine     │  │ + request_operator()     │
          │ - evolve_executor       │  │ + commit_transition()    │
          │ - reclaim_executor      │  └────────────┬─────────────┘
          │ - capability_repo       │               │
          │ - lineage_store         │               │ delegates
          └────────────┬────────────┘               ▼
                       │                ┌──────────────────────────┐
                       │                │ EvolveExecutor           │
                       │                │ (evolve.py)              │
                       │                │ + evolve(transition)     │
                       │                └──────────────────────────┘
                       │                ┌──────────────────────────┐
                       │                │ ReclaimExecutor          │
                       │                │ (reclaim.py)             │
                       │                │ + reclaim(transition)    │
                       │                │   → SpiritForge.distill()│
                       │                └──────────────────────────┘
                       ▼
          ┌─────────────────────────────────────────────────────────┐
          │ <<abstract>> ForgeRelationshipRepository                │
          │ (repository.py)                                         │
          │ + save_relationship(rel)                                │
          │ + save_transition(t)                                    │
          │ + list_transitions(forgekin_id)                         │
          │ + get_pending_transitions()                             │
          └─────────────────────────────────────────────────────────┘
```

### 2.2 接口实现 Python 代码

```python
# flowforge/forgemind/relationship/models.py
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, Field


class ForgeLayer(str, Enum):
    """灵智体承载层（双轨命名：代码层枚举值 = Layer 名）"""
    FORGEMIND = "forgemind"
    CONTENTFORGE = "contentforge"
    DEVFORGE = "devforge"
    NOVELFORGE = "novelforge"
    MALLFORGE = "mallforge"


class TransitionType(str, Enum):
    """迁移类型：进化（通用→垂直）/ 回炉（垂直→通用）"""
    EVOLVE = "evolve"
    RECLAIM = "reclaim"


class TransitionStatus(str, Enum):
    """迁移状态机：申请 → 待审批 → 已批准 → 执行中 → 已完成 / 已拒绝 / 已回滚"""
    REQUESTED = "requested"
    PENDING_APPROVAL = "pending_approval"
    APPROVED = "approved"
    REJECTED = "rejected"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    ROLLED_BACK = "rolled_back"


class LayerTransition(BaseModel):
    """跨层迁移记录（进化 / 回炉）"""
    transition_id: str
    forgekin_id: str
    soul_imprint: str = Field(description="灵印 Mind Imprint（谱系锚点）")
    from_layer: ForgeLayer
    to_layer: ForgeLayer
    transition_type: TransitionType
    trigger_reason: str
    operator_approved: bool = False
    operator_id: Optional[str] = None
    status: TransitionStatus = TransitionStatus.REQUESTED
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    capability_delta: dict = Field(
        default_factory=dict,
        description="能力画像差异快照（before / after）"
    )
    lineage_edge_id: Optional[str] = Field(
        default=None,
        description="关联 F038 进化谱系边 ID"
    )
    vertical_skills_injected: list[str] = Field(
        default_factory=list,
        description="进化时注入的垂直 SkillPackage ID 列表"
    )
    distilled_skill_ids: list[str] = Field(
        default_factory=list,
        description="回炉时蒸馏产出的通用 SkillPackage ID 列表"
    )


class ForgeRelationship(BaseModel):
    """forgemind 与 *Forge 关系（一个灵智体的承载层关系）"""
    forgekin_id: str
    soul_imprint: str
    current_layer: ForgeLayer
    origin_layer: ForgeLayer
    evolution_history: list[LayerTransition] = Field(default_factory=list)
    capability_snapshot_per_layer: dict[ForgeLayer, str] = Field(
        default_factory=dict,
        description="每层能力画像快照 ID（key=层, value=CapabilityProfile ID）"
    )
    last_transition_at: Optional[datetime] = None


class TransitionRequest(BaseModel):
    """迁移申请载荷"""
    forgekin_id: str
    target_layer: ForgeLayer
    transition_type: TransitionType
    reason: str
    requested_by: str = Field(description="发起者 operator_id")
```

```python
# flowforge/forgemind/relationship/manager.py
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional

from .models import (
    ForgeLayer,
    ForgeRelationship,
    LayerTransition,
    TransitionRequest,
    TransitionStatus,
)


class ForgeRelationshipManager(ABC):
    """forgemind 与 *Forge 关系管理器（抽象接口，DI 注入）"""

    @abstractmethod
    async def get_relationship(self, forgekin_id: str) -> ForgeRelationship:
        """查询灵智体当前的承载层关系

        若关系不存在则抛出 RelationshipNotFoundError
        """
        ...

    @abstractmethod
    async def request_evolve_to_vertical(
        self,
        forgekin_id: str,
        target: ForgeLayer,
        reason: str,
        requested_by: str,
    ) -> str:
        """请求通用灵智体进化为垂直灵智体（需 operator 批准）

        前置条件:
        - current_layer == ForgeLayer.FORGEMIND
        - target in (CONTENTFORGE, DEVFORGE, NOVELFORGE, MALLFORGE)
        - Eval 分数 >= min_eval_score（默认 0.85）
        - 任务数 >= min_task_count（默认 5）

        返回 transition_id（状态=PENDING_APPROVAL）
        """
        ...

    @abstractmethod
    async def request_reclaim_to_forgemind(
        self,
        forgekin_id: str,
        reason: str,
        requested_by: str,
    ) -> str:
        """请求垂直灵智体回炉为通用灵智体（能力沉淀到通用层）

        前置条件:
        - current_layer != ForgeLayer.FORGEMIND
        - 仅蒸馏通用能力（distill_general_only=True）
        - 垂直能力保留原层（preserve_vertical_in_original=True）

        返回 transition_id（状态=PENDING_APPROVAL）
        """
        ...

    @abstractmethod
    async def approve_transition(
        self,
        transition_id: str,
        operator_id: str,
        decision: Literal["approve", "reject"],
        comment: str = "",
    ) -> LayerTransition:
        """operator 审批迁移请求"""
        ...

    @abstractmethod
    async def execute_transition(self, transition_id: str) -> LayerTransition:
        """执行已批准的跨层迁移（写入 F038 谱系 + 更新 Repository）

        前置条件:
        - status == APPROVED
        - operator_approved == True

        副作用:
        - 调用 EvolveExecutor 或 ReclaimExecutor
        - 写入 F038 谱系边（LAYER_TRANSITION）
        - 更新 ForgeRelationship.current_layer
        - 更新 transition.status = COMPLETED
        """
        ...

    @abstractmethod
    async def list_pending_approvals(
        self,
        operator_id: Optional[str] = None,
    ) -> list[LayerTransition]:
        """列出待审批的迁移请求"""
        ...
```

```python
# flowforge/forgemind/relationship/transition.py
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional

from .models import (
    ForgeLayer,
    LayerTransition,
    TransitionRequest,
    TransitionStatus,
    TransitionType,
)


class PreconditionError(Exception):
    """前置条件校验失败"""


class LayerTransitionEngine(ABC):
    """跨层迁移引擎（抽象接口）"""

    @abstractmethod
    async def validate_precondition(
        self,
        request: TransitionRequest,
    ) -> None:
        """校验前置条件

        EVOLVE:
        - current_layer == FORGEMIND
        - target in (CONTENTFORGE, DEVFORGE, NOVELFORGE, MALLFORGE)
        - eval_score >= min_eval_score (配置 0.85)
        - task_count >= min_task_count (配置 5)
        - 灵智体未在其他迁移中（无 PENDING/APPROVED/IN_PROGRESS 的 transition）

        RECLAIM:
        - current_layer != FORGEMIND
        - 灵智体未在其他迁移中

        校验失败抛出 PreconditionError
        """
        ...

    @abstractmethod
    async def request_operator_approval(
        self,
        transition: LayerTransition,
    ) -> None:
        """异步请求 operator 审批

        副作用:
        - transition.status = PENDING_APPROVAL
        - 通过 EventBus 发布 TransitionApprovalRequestedEvent
        - 等待 operator 通过 approve_transition() 回写
        """
        ...

    @abstractmethod
    async def commit_transition(
        self,
        transition: LayerTransition,
    ) -> LayerTransition:
        """原子化提交迁移

        事务步骤:
        1. transition.status = IN_PROGRESS
        2. 调用 EvolveExecutor.evolve() 或 ReclaimExecutor.reclaim()
        3. 写入 F038 LineageStore（relation=LAYER_TRANSITION）
        4. 更新 ForgeRelationship.current_layer
        5. transition.status = COMPLETED

        任一步骤失败则 ROLLED_BACK
        """
        ...
```

```python
# flowforge/forgemind/relationship/evolve.py
from __future__ import annotations

from abc import ABC, abstractmethod

from .models import LayerTransition


class EvolveExecutor(ABC):
    """通用 → 垂直 进化执行器"""

    @abstractmethod
    async def evolve(self, transition: LayerTransition) -> LayerTransition:
        """执行进化

        步骤:
        1. 从 F001 CapabilityProfileRepository 读取当前能力画像
        2. 深拷贝 CapabilityProfile 到目标 *Forge 层命名空间
        3. 从目标 *Forge 注册的 vertical_skills 选择性注入 SkillPackage
           （依据 transition.trigger_reason 与 skill registry 元数据匹配）
        4. 将新的 CapabilityProfile 快照 ID 写入
           ForgeRelationship.capability_snapshot_per_layer[to_layer]
        5. 更新 transition.capability_delta = {before:..., after:...}
        6. 更新 transition.vertical_skills_injected
        """
        ...


class ReclaimExecutor(ABC):
    """垂直 → 通用 回炉执行器"""

    @abstractmethod
    async def reclaim(self, transition: LayerTransition) -> LayerTransition:
        """执行回炉

        步骤:
        1. 调用 SpiritForge.distill(
              forgekin_id, scope="general_only",
              preserve_vertical_in_original=True)
        2. 蒸馏产出的通用 SkillPackage 写入 F039 Mind Codex
           （需通过 CL-005 七字段契约校验）
        3. 仅更新 ForgeRelationship.capability_snapshot_per_layer[FORGEMIND]
           保留原垂直层的快照不变
        4. 更新 transition.distilled_skill_ids
        """
        ...
```

```python
# flowforge/forgemind/relationship/repository.py
from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime
from typing import Optional

from .models import ForgeRelationship, ForgeLayer, LayerTransition, TransitionStatus


class ForgeRelationshipRepository(ABC):
    """关系持久层（抽象接口，禁止直接操作数据库）"""

    @abstractmethod
    async def save_relationship(self, rel: ForgeRelationship) -> None: ...

    @abstractmethod
    async def get_relationship(
        self, forgekin_id: str
    ) -> Optional[ForgeRelationship]: ...

    @abstractmethod
    async def save_transition(self, t: LayerTransition) -> None: ...

    @abstractmethod
    async def get_transition(
        self, transition_id: str
    ) -> Optional[LayerTransition]: ...

    @abstractmethod
    async def update_transition_status(
        self,
        transition_id: str,
        new_status: TransitionStatus,
        operator_id: Optional[str] = None,
    ) -> None: ...

    @abstractmethod
    async def list_transitions(
        self,
        forgekin_id: str,
    ) -> list[LayerTransition]: ...

    @abstractmethod
    async def list_pending_transitions(
        self,
        statuses: list[TransitionStatus],
    ) -> list[LayerTransition]: ...

    @abstractmethod
    async def list_relationships_by_layer(
        self,
        layer: ForgeLayer,
    ) -> list[ForgeRelationship]: ...
```

```python
# flowforge/forgemind/plugins.py （Plugin V3 四钩子实现骨架）
from __future__ import annotations

from typing import Any

from flowforge.core.plugin.protocol import FlowForgePlugin
from flowforge.core.tracing import get_logger

logger = get_logger(__name__)


class ForgeMindPlugin(FlowForgePlugin):
    """forgemind 应用层 Plugin（实现 V3 四钩子）"""

    def __init__(self) -> None:
        self._relationship_manager: Any = None  # DI 注入
        self._skill_registry: Any = None
        self._council_registry: Any = None
        self._auto_forge_config: Any = None

    # ── V2 钩子保留（向 V2 兼容）────────────────────────────────

    def register_agents(self, agent_registry: Any) -> None:
        logger.info("ForgeMindPlugin.register_agents: noop (V3 uses register_forgekins)")

    def register_tools(self, tool_registry: Any) -> None:
        pass

    def register_loops(self, loop_registry: Any) -> None:
        pass

    def register_workflows(self, workflow_registry: Any) -> None:
        pass

    def register_routes(self, router: Any) -> None:
        pass

    def register_schedules(self, scheduler: Any) -> None:
        pass

    def register_event_handlers(self, event_bus: Any) -> None:
        pass

    def register_gates(self, gate_registry: Any) -> None:
        pass

    def register_evaluators(self, evaluator_registry: Any) -> None:
        pass

    def on_startup(self) -> None:
        logger.info("ForgeMindPlugin.on_startup")

    def on_shutdown(self) -> None:
        logger.info("ForgeMindPlugin.on_shutdown")

    # ── V3 钩子（v7.1 新增）────────────────────────────────────

    def register_forgekins(self, forgekin_registry: Any) -> None:
        """接收 *Forge 通过 Plugin V3 注册的垂直灵智体

        *Forge plugins.py 在启动时调用本钩子，将自己锻造的垂直灵智体
        注册到 forgemind 的 ForgeRelationshipManager。
        forgemind 不可主动扫描 *Forge，只能被动接收注册。
        """
        logger.info(
            "ForgeMindPlugin.register_forgekins called by *Forge plugin, "
            "count=%d",
            len(getattr(forgekin_registry, "items", []) or []),
        )

    def register_forge_skills(self, skill_registry: Any) -> None:
        """接收 *Forge 注册的垂直 SkillPackage（如 seo_writing / code_review）"""
        self._skill_registry = skill_registry
        logger.info(
            "ForgeMindPlugin.register_forge_skills: %d skills registered",
            len(getattr(skill_registry, "items", []) or []),
        )

    def register_council_channels(self, council_registry: Any) -> None:
        """接收 *Forge 注册的灵议 Mind Council 通道"""
        self._council_registry = council_registry

    def register_auto_forge_config(self, auto_forge_config: Any) -> None:
        """接收 *Forge 注册的灵锻 SpiritForge 配置"""
        self._auto_forge_config = auto_forge_config
```

### 2.3 数据结构 Pydantic Models

数据结构已在 §2.2 完整定义。核心模型汇总：

| 模型 | 用途 | 关键字段 |
|------|------|---------|
| `ForgeLayer` | 承载层枚举 | FORGEMIND / CONTENTFORGE / DEVFORGE / NOVELFORGE / MALLFORGE |
| `TransitionType` | 迁移类型 | EVOLVE / RECLAIM |
| `TransitionStatus` | 迁移状态机 | REQUESTED→PENDING_APPROVAL→APPROVED→IN_PROGRESS→COMPLETED |
| `LayerTransition` | 迁移记录 | transition_id / from_layer / to_layer / capability_delta / lineage_edge_id |
| `ForgeRelationship` | 关系记录 | current_layer / origin_layer / evolution_history / capability_snapshot_per_layer |
| `TransitionRequest` | 申请载荷 | forgekin_id / target_layer / transition_type / reason |

### 2.4 关键算法伪代码

```
算法: request_evolve_to_vertical(forgekin_id, target, reason, requested_by)
输入: forgekin_id, target: ForgeLayer, reason: str, requested_by: str
输出: transition_id: str

1. rel ← repository.get_relationship(forgekin_id)
2. IF rel is None: raise RelationshipNotFoundError
3. request ← TransitionRequest(forgekin_id, target, EVOLVE, reason, requested_by)
4. transition_engine.validate_precondition(request)
   // 校验 current_layer==FORGEMIND, target in 垂直层
   // 校验 eval_score >= 0.85, task_count >= 5
   // 校验无其他进行中的 transition
5. transition ← LayerTransition(
       transition_id=uuid4(),
       forgekin_id=forgekin_id,
       soul_imprint=rel.soul_imprint,
       from_layer=rel.current_layer,
       to_layer=target,
       transition_type=EVOLVE,
       trigger_reason=reason,
       status=PENDING_APPROVAL,
   )
6. repository.save_transition(transition)
7. transition_engine.request_operator_approval(transition)
   // 异步通过 EventBus 发布 TransitionApprovalRequestedEvent
8. RETURN transition.transition_id

算法: execute_transition(transition_id)
输入: transition_id: str
输出: LayerTransition

1. transition ← repository.get_transition(transition_id)
2. IF transition.status != APPROVED:
      raise InvalidStatusError("transition not approved")
3. transition.status ← IN_PROGRESS
4. repository.update_transition_status(transition_id, IN_PROGRESS)
5. TRY:
      IF transition.transition_type == EVOLVE:
          transition ← evolve_executor.evolve(transition)
      ELSE IF transition.transition_type == RECLAIM:
          transition ← reclaim_executor.reclaim(transition)
      // 写入 F038 谱系边
      edge_id ← lineage_store.add_edge(
          relation=LAYER_TRANSITION,
          from_soul_imprints=[transition.soul_imprint],
          to_soul_imprints=[transition.soul_imprint],
          capability_snapshot=transition.capability_delta,
          trigger_reason=transition.trigger_reason,
          operator_approved=True,
      )
      transition.lineage_edge_id ← edge_id
      // 更新关系
      rel ← repository.get_relationship(transition.forgekin_id)
      rel.current_layer ← transition.to_layer
      rel.last_transition_at ← now()
      rel.evolution_history.append(transition)
      repository.save_relationship(rel)
      transition.status ← COMPLETED
      repository.save_transition(transition)
      RETURN transition
   CATCH any error:
      transition.status ← ROLLED_BACK
      repository.save_transition(transition)
      logger.error("transition rolled back", exc_info=...)
      RAISE
```

---

## 3. 模块实现

### 3.1 关键代码片段

**ForgeRelationshipManagerImpl 核心实现**：

```python
# flowforge/forgemind/relationship/manager_impl.py
from __future__ import annotations

from typing import Optional

from flowforge.core.tracing import get_logger

from .evolve import EvolveExecutor, ReclaimExecutor
from .manager import ForgeRelationshipManager
from .models import (
    ForgeLayer,
    ForgeRelationship,
    LayerTransition,
    TransitionRequest,
    TransitionStatus,
    TransitionType,
)
from .repository import ForgeRelationshipRepository
from .transition import LayerTransitionEngine, PreconditionError

logger = get_logger(__name__)


class RelationshipNotFoundError(Exception):
    pass


class InvalidStatusError(Exception):
    pass


class ForgeRelationshipManagerImpl(ForgeRelationshipManager):
    """ForgeRelationshipManager 默认实现"""

    def __init__(
        self,
        repository: ForgeRelationshipRepository,
        transition_engine: LayerTransitionEngine,
        evolve_executor: EvolveExecutor,
        reclaim_executor: ReclaimExecutor,
        lineage_store,  # F038 LineageStore 抽象
        capability_repo,  # F001 CapabilityProfileRepository
    ) -> None:
        self._repo = repository
        self._engine = transition_engine
        self._evolve = evolve_executor
        self._reclaim = reclaim_executor
        self._lineage = lineage_store
        self._cap_repo = capability_repo

    async def get_relationship(self, forgekin_id: str) -> ForgeRelationship:
        rel = await self._repo.get_relationship(forgekin_id)
        if rel is None:
            raise RelationshipNotFoundError(forgekin_id)
        return rel

    async def request_evolve_to_vertical(
        self,
        forgekin_id: str,
        target: ForgeLayer,
        reason: str,
        requested_by: str,
    ) -> str:
        rel = await self.get_relationship(forgekin_id)
        request = TransitionRequest(
            forgekin_id=forgekin_id,
            target_layer=target,
            transition_type=TransitionType.EVOLVE,
            reason=reason,
            requested_by=requested_by,
        )
        # 校验前置条件（不通过抛 PreconditionError）
        await self._engine.validate_precondition(request)

        transition = LayerTransition(
            transition_id=_gen_uuid(),
            forgekin_id=forgekin_id,
            soul_imprint=rel.soul_imprint,
            from_layer=rel.current_layer,
            to_layer=target,
            transition_type=TransitionType.EVOLVE,
            trigger_reason=reason,
            status=TransitionStatus.PENDING_APPROVAL,
        )
        await self._repo.save_transition(transition)
        await self._engine.request_operator_approval(transition)
        logger.info(
            "evolve request submitted",
            extra={"transition_id": transition.transition_id,
                   "forgekin_id": forgekin_id,
                   "target": target.value},
        )
        return transition.transition_id

    async def request_reclaim_to_forgemind(
        self,
        forgekin_id: str,
        reason: str,
        requested_by: str,
    ) -> str:
        rel = await self.get_relationship(forgekin_id)
        request = TransitionRequest(
            forgekin_id=forgekin_id,
            target_layer=ForgeLayer.FORGEMIND,
            transition_type=TransitionType.RECLAIM,
            reason=reason,
            requested_by=requested_by,
        )
        await self._engine.validate_precondition(request)

        transition = LayerTransition(
            transition_id=_gen_uuid(),
            forgekin_id=forgekin_id,
            soul_imprint=rel.soul_imprint,
            from_layer=rel.current_layer,
            to_layer=ForgeLayer.FORGEMIND,
            transition_type=TransitionType.RECLAIM,
            trigger_reason=reason,
            status=TransitionStatus.PENDING_APPROVAL,
        )
        await self._repo.save_transition(transition)
        await self._engine.request_operator_approval(transition)
        return transition.transition_id

    async def approve_transition(
        self,
        transition_id: str,
        operator_id: str,
        decision: str,
        comment: str = "",
    ) -> LayerTransition:
        transition = await self._repo.get_transition(transition_id)
        if transition is None:
            raise RelationshipNotFoundError(transition_id)
        if transition.status != TransitionStatus.PENDING_APPROVAL:
            raise InvalidStatusError(
                f"transition in {transition.status.value}, "
                f"cannot approve"
            )

        if decision == "approve":
            transition.operator_approved = True
            transition.operator_id = operator_id
            transition.status = TransitionStatus.APPROVED
        else:
            transition.operator_approved = False
            transition.operator_id = operator_id
            transition.status = TransitionStatus.REJECTED

        await self._repo.save_transition(transition)
        logger.info(
            "transition %s by operator %s",
            decision,
            operator_id,
            extra={"transition_id": transition_id, "comment": comment},
        )
        return transition

    async def execute_transition(
        self, transition_id: str
    ) -> LayerTransition:
        transition = await self._repo.get_transition(transition_id)
        if transition is None:
            raise RelationshipNotFoundError(transition_id)
        if transition.status != TransitionStatus.APPROVED:
            raise InvalidStatusError(
                "transition must be APPROVED before execute"
            )
        if not transition.operator_approved:
            raise InvalidStatusError("operator_approved is False")

        transition.status = TransitionStatus.IN_PROGRESS
        await self._repo.update_transition_status(
            transition_id, TransitionStatus.IN_PROGRESS
        )

        try:
            if transition.transition_type == TransitionType.EVOLVE:
                transition = await self._evolve.evolve(transition)
            else:
                transition = await self._reclaim.reclaim(transition)

            # 写入 F038 谱系边
            edge_id = await self._lineage.add_edge(
                relation="layer",  # LAYER_TRANSITION
                from_soul_imprints=[transition.soul_imprint],
                to_soul_imprints=[transition.soul_imprint],
                capability_snapshot=transition.capability_delta,
                trigger_reason=transition.trigger_reason,
                operator_approved=True,
            )
            transition.lineage_edge_id = edge_id

            # 更新关系
            rel = await self._repo.get_relationship(transition.forgekin_id)
            rel.current_layer = transition.to_layer
            rel.last_transition_at = _now()
            rel.evolution_history.append(transition)
            await self._repo.save_relationship(rel)

            transition.status = TransitionStatus.COMPLETED
            await self._repo.save_transition(transition)
            return transition

        except Exception as exc:
            transition.status = TransitionStatus.ROLLED_BACK
            await self._repo.save_transition(transition)
            logger.error(
                "transition rolled back: %s",
                transition_id,
                exc_info=exc,
            )
            raise


def _gen_uuid() -> str:
    import uuid
    return str(uuid.uuid4())


def _now():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc)
```

### 3.2 关键流程时序图

**进化流（通用 → 垂直）时序**：

```
operator     ForgeRelationshipManager    LayerTransitionEngine    EvolveExecutor    LineageStore    Repository
   │                  │                          │                     │                │              │
   │ request_evolve   │                          │                     │                │              │
   ├─────────────────►│                          │                     │                │              │
   │                  │ get_relationship         │                     │                │              │
   │                  ├────────────────────────────────────────────────────────────────►│              │
   │                  │◄───────────────────────────────────────────────────────────────│              │
   │                  │ validate_precondition    │                     │                │              │
   │                  ├─────────────────────────►│                     │                │              │
   │                  │◄─────────────────────────┤ OK / PreconditionError              │              │
   │                  │ save_transition (PENDING_APPROVAL)                                            │              │
   │                  ├────────────────────────────────────────────────────────────────►│              │
   │                  │ request_operator_approval│                     │                │              │
   │                  ├─────────────────────────►│ EventBus.publish(TransitionApprovalRequested)      │
   │ transition_id    │                          │                     │                │              │
   │◄─────────────────┤                          │                     │                │              │
   │                  │                          │                     │                │              │
   │ approve(decision="approve")                                                                  │              │
   ├─────────────────►│ update_transition_status(APPROVED)                                              │              │
   │                  ├────────────────────────────────────────────────────────────────►│              │
   │                  │                          │                     │                │              │
   │ execute_transition                                                                           │              │
   ├─────────────────►│ status=IN_PROGRESS       │                     │                │              │
   │                  ├────────────────────────────────────────────────────────────────►│              │
   │                  │ evolve(transition)       │                     │                │              │
   │                  ├───────────────────────────────────────────────►│                │              │
   │                  │                          │                     │ 复制 CapabilityProfile       │
   │                  │                          │                     │ 注入 vertical_skills         │
   │                  │                          │                     │ capability_delta             │
   │                  │◄───────────────────────────────────────────────┤                │              │
   │                  │ add_edge(LAYER_TRANSITION)                                                     │              │
   │                  ├────────────────────────────────────────────────────────────────►│              │
   │                  │◄───────────────────────────────────────────────────────────────│ edge_id      │
   │                  │ save_relationship (current_layer=to_layer)                                    │              │
   │                  ├────────────────────────────────────────────────────────────────►│              │
   │                  │ status=COMPLETED                                                                            │
   │                  ├────────────────────────────────────────────────────────────────►│              │
   │ result           │                                                                                          │
   │◄─────────────────┤                                                                                          │
```

### 3.3 错误处理

| 异常类型 | 触发条件 | 处理策略 |
|---------|---------|---------|
| `RelationshipNotFoundError` | forgekin_id 在 Repository 中无关系记录 | 返回 404，提示"灵智体未注册承载层关系" |
| `PreconditionError` | Eval < 0.85 / 任务数 < 5 / current_layer 不匹配 / 已有进行中迁移 | 返回 422，附详细校验失败字段 |
| `InvalidStatusError` | 在非 APPROVED 状态调用 execute / 在非 PENDING_APPROVAL 调用 approve | 返回 409 Conflict，附当前 status |
| `EvolveExecutorError` | CapabilityProfile 复制失败 / SkillPackage 注入失败 | transition.status = ROLLED_BACK，记录堆栈，重新提交需重新申请 |
| `ReclaimExecutorError` | SpiritForge.distill() 失败 / Mind Codex 入库校验失败 | 同上，回滚已蒸馏条目 |
| `LineageStoreError` | F038 谱系边写入失败 | transition.status = ROLLED_BACK，需人工介入修复 LineageStore |
| `RepositoryTimeoutError` | 持久层超时 | 重试 3 次后返回 503 Service Unavailable |
| `OperatorApprovalTimeoutError` | 申请提交后 7 天未审批 | 自动关闭申请（status=REJECTED，reason=auto_timeout） |

**回滚策略**：所有迁移操作通过 `try/except` 包裹，任一步骤失败将 `transition.status` 设为 `ROLLED_BACK`。已部分执行的副作用（如已写入的 SkillPackage）通过补偿事务清理——`EvolveExecutor.evolve()` 失败时调用 `_compensate_evolve()` 删除已注入的 vertical_skills。

### 3.4 性能优化

| 性能指标 | SLO | 优化手段 |
|---------|:----:|---------|
| `request_evolve_to_vertical` 延迟 | P95 < 200ms | Repository 异步 IO；EventBus 发布采用 fire-and-forget 不阻塞主流程 |
| `approve_transition` 延迟 | P95 < 100ms | 单表 UPDATE，无 join |
| `execute_transition` 延迟 | P95 < 3s | 进化路径受 CapabilityProfile 大小影响；ReclaimExecutor 受 SpiritForge 蒸馏耗时影响，建议拆分为异步任务 + 进度查询接口 |
| 关系列系查询 | P95 < 50ms | Repository 对 forgekin_id / soul_imprint / current_layer 建立索引 |
| 待审批列表 | P95 < 100ms | 状态字段建索引，限制返回 100 条 |

**优化策略**：
1. **异步执行**：`execute_transition` 内部 SpiritForge 蒸馏可能耗时 > 30s，提供 `execute_transition_async()` 异步版本，通过 EventBus 发布 `TransitionCompleted` 事件
2. **批量审批**：`approve_transitions_batch(transition_ids, operator_id, decision)` 支持一次审批多个申请
3. **缓存**：ForgeRelationship 读取结果以 `forgekin_id` 为 key 缓存 5 分钟，写入时失效
4. **谱系边批量写入**：单次迁移可能产生多条谱系边（蒸馏多个 SkillPackage 时），使用 `add_edges_batch()` 批量提交

### 3.5 配置示例

`flowforge/forgemind/config/forge_relationship.yaml`：

```yaml
forge_relationship:
  layers:
    forgemind:
      role: general
      can_evolve_to: [contentforge, devforge, novelforge, mallforge]
    contentforge:
      role: vertical
      can_reclaim_to: forgemind
      vertical_skills: [topic_research, seo_writing, fact_check, content_review]
    devforge:
      role: vertical
      can_reclaim_to: forgemind
      vertical_skills: [code_review, refactor, test_gen, bug_diagnose]
    novelforge:
      role: vertical
      can_reclaim_to: forgemind
      vertical_skills: [outline_gen, character_dev, plot_arc, style_polish]
    mallforge:
      role: vertical
      can_reclaim_to: forgemind
      vertical_skills: [product_copy, price_strategy, review_reply, promotion_plan]

  transition_rules:
    evolve:
      min_eval_score: 0.85
      min_task_count: 5
      require_operator_approval: true
      approval_timeout_days: 7
    reclaim:
      distill_general_only: true
      preserve_vertical_in_original: true
      require_operator_approval: true
      approval_timeout_days: 7

  audit:
    log_all_transitions: true
    alert_on_unauthorized: true

  performance:
    execute_transition_async: true
    cache_relationship_ttl_seconds: 300
    batch_approval_max_size: 50
```

---

## 4. 跨模块协作实现

### 4.1 上游依赖如何调用

| 上游模块 | 调用入口 | 调用时机 | 数据流 |
|---------|---------|---------|--------|
| **F001 CapabilityProfile** | `CapabilityProfileRepository.get_profile(profile_id)` / `update_profile(profile)` | 进化时复制 / 回炉时新增通用 SkillProfile | 双向：读 → 改 → 写回 |
| **F008 Durable State Surfaces** | `DurableStateStore.save(surface_type="forge_relationship", payload)` | ForgeRelationship 与 LayerTransition 持久化 | 单向：写 |
| **F018 Eval Contract** | `EvalContractStore.get_friction_metrics(contract_id)` / `EvalLedger.get_eval_score(forgekin_id)` | 进化前置条件校验 | 单向：读 |
| **F028 ForgePipeline** | `ForgePipeline.execute_branch(branch="evolve_to_vertical" / "reclaim_to_forgemind")` | 流水线"通用→垂直"分支或"垂直→通用"分支触发 | 单向：流水线调用本模块 |
| **F039 Mind Codex** | `MindCodexStore.add_entry(entry)` | 回炉蒸馏产出的 SkillPackage 写入锻典（需通过 CL-005 校验） | 单向：写 |
| **Plugin V3 协议** | `ForgeMindPlugin.register_forgekins()` / `register_forge_skills()` 等 | *Forge 启动时通过钩子注册 | 单向：*Forge → forgemind |
| **F038 LineageStore** | `LineageStore.add_edge(relation=LAYER_TRANSITION, ...)` | 迁移提交时写入谱系边 | 单向：写 |
| **EventBus** | `EventBus.publish(TransitionApprovalRequestedEvent)` / `TransitionCompletedEvent` | 申请提交时 / 迁移完成时 | 单向：发布 |

### 4.2 下游影响如何被调用

| 下游模块 | 被调用入口 | 调用方 | 时机 |
|---------|-----------|-------|------|
| **F037 Marketplace** | `MarketplaceListing.layer` 字段 | ForgeRelationshipManager | 关系变更后通知市场刷新 listing 的 layer 标签 |
| **F038 LineageStore** | `LineageStore.add_edge(LAYER_TRANSITION)` | ForgeRelationshipManagerImpl.execute_transition | 迁移完成时 |
| **F039 Mind Codex** | `MindCodexStore.add_entry()` | ReclaimExecutor.reclaim | 蒸馏产出 SkillPackage 时 |
| **F027 多形态智能体** | 不调用（跨层迁移不改 species） | — | — |
| **operator 控制台** | HTTP API `GET /api/v7/transitions?status=pending_approval` | operator UI | 审批列表展示 |
| **EventBus 订阅者** | `TransitionCompletedEvent` / `TransitionRolledBackEvent` | dashboard / 通知系统 | 异步消费 |

### 4.3 集成测试点

- **T1 单元层**：
  - `LayerTransitionEngine.validate_precondition()` 各分支（Eval 不达标 / 任务不足 / 已有进行中迁移）单测
  - `ForgeRelationshipManagerImpl.approve_transition()` 状态机转换覆盖
- **T2 跨模块集成层**：
  - `execute_transition` 全链路：F001 → F038 → F008 三方写入原子性
  - `register_forgekins` 钩子被 *Forge Plugin 调用后，ForgeRelationship 正确建立
- **T3 E2E 层（遵守 T1-T8 测试铁律）**：
  - 真实 operator 在 forgemind 锻造通用写作灵智体
  - 真实 LLM 完成 5+ 内容创作任务（Eval ≥ 0.85，禁止 mock LLM）
  - 申请进化到 contentforge，operator 审批通过
  - 验证：ForgeRelationship.current_layer=contentforge / F038 谱系边存在 / MarketplaceListing.layer=contentforge
  - 触发回炉到 forgemind
  - 验证：通用能力蒸馏到 Mind Codex（CL-005 七字段完整）/ contentforge 垂直能力快照保留不变
- **T4 异常路径**：
  - 迁移执行中 F038 LineageStore 写入失败 → 验证 status=ROLLED_BACK / 已注入的 vertical_skills 被补偿删除

---

## 5. 详细设计验收

### 5.1 功能验收 AC

- [ ] **AC-1**：`ForgeLayer` 枚举完整，包含 FORGEMIND + 4 个 *Forge
- [ ] **AC-2**：`request_evolve_to_vertical` 前置条件校验通过（Eval ≥ 0.85 + 5+ 任务 + current_layer==FORGEMIND）
- [ ] **AC-3**：`request_evolve_to_vertical` 前置条件不通过抛 `PreconditionError` 且不写 Repository
- [ ] **AC-4**：`approve_transition` 状态机正确：PENDING_APPROVAL → APPROVED / REJECTED
- [ ] **AC-5**：`execute_transition` 在 APPROVED 状态下可执行，在其他状态抛 `InvalidStatusError`
- [ ] **AC-6**：进化后 ForgeRelationship.current_layer == transition.to_layer
- [ ] **AC-7**：进化后 capability_snapshot_per_layer 包含新层快照 ID
- [ ] **AC-8**：回炉仅更新 FORGEMIND 层快照，垂直层快照保留不变
- [ ] **AC-9**：所有 LayerTransition 写入 F038 谱系边（relation=LAYER_TRANSITION）
- [ ] **AC-10**：跨层迁移必须 operator 显式批准，无自动迁移路径
- [ ] **AC-11**：Plugin V3 四钩子被调用且参数正确传递
- [ ] **AC-12**：ForgeMindPlugin 不 import 任何 *Forge 模块

### 5.2 性能验收

- [ ] **AC-13**：`request_evolve_to_vertical` P95 延迟 < 200ms
- [ ] **AC-14**：`approve_transition` P95 延迟 < 100ms
- [ ] **AC-15**：`execute_transition`（异步版本）提交后 1s 内返回 task_id，整个迁移 P95 < 30s
- [ ] **AC-16**：ForgeRelationship 缓存命中率 > 80%（在 5 分钟 TTL 下）

### 5.3 安全验收

- [ ] **AC-17**：所有迁移操作通过 operator 拉闸权校验（编程红线对应"Action Confirmation"层）
- [ ] **AC-18**：审批日志写入审计表，包含 operator_id / decision / comment / timestamp
- [ ] **AC-19**：approval_timeout_days=7，超时自动 REJECTED
- [ ] **AC-20**：迁移失败回滚后已注入的 vertical_skills 被补偿删除（无残留）

### 5.4 Eval 验收

- [ ] **AC-21**：进化前置条件中 Eval 分数来自 F018 EvalLedger（非控制面自算）
- [ ] **AC-22**：迁移完成后 `TransitionCompletedEvent` 携带 capability_delta 供 F040 控制面消费
- [ ] **AC-23**：F040 控制面将跨层迁移成功率作为组件增值/折旧信号

---

## 6. 引用

- [doc:../spec.md#§3.8]（FR-CORE-008 forgemind 应用层）
- [doc:../spec.md#§3.15]（FR-CORE-015 Plugin V3 四钩子）
- [doc:../spec.md#§3.16]（FR-CORE-029 forgemind 与 *Forge 关系）
- [doc:../arch.md#§3.8]（forgemind 应用层架构）
- [doc:../arch.md#§3.15]（Plugin V3 四钩子架构）
- [doc:../architecture/A036-forgemind-forge-relationship.md]（同号 Feature 级 SAD）
- [doc:../features/F036-forgemind-forge-relationship.md]（同号 Feature 级 SRS）
- [doc:../features/F001-capability-profile.md]（能力画像）
- [doc:../features/F008-durable-state-surfaces.md]（Durable State Surfaces）
- [doc:../features/F018-eval-contract.md]（Eval Contract）
- [doc:../features/F028-forging-pipeline.md]（锻造流水线）
- [doc:../features/F037-forgemind-marketplace.md]（灵智体市场）
- [doc:../features/F038-forgemind-lineage.md]（进化谱系）
- [doc:../features/F039-mind-codex-searchable.md]（灵典可检索知识库）
- [doc:../features/F040-harness-eval-control-plane.md]（Harness Eval 控制面）
- [doc:../decisions/005-forgemind-application-layer.md]（forgemind 应用层 ADR）
- [doc:../decisions/003-plugin-v3-protocol.md]（Plugin V3 协议 ADR）
- [doc:../design/naming-contract.md#2.1]（灵智 ForgeMind）
- [doc:../design/naming-contract.md#2.2]（灵智体 Forgekin）
- [doc:../design/naming-contract.md#2.6]（灵印 Soul Imprint）
- [doc:../../../hiclaw/rules.md#第七部分]（编程红线第 10/11/12/13 条）
- [doc:../../../hiclaw/rules.md#第十一部分]（软件工程文档分层规范）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（详细设计骨架，应用 9 大点名称修订；含 Pydantic Models / 接口实现 / 时序图 / 配置示例 / 跨模块协作 / 验收 AC） | 开发者灵智体（猎犬·夏洛克） |
