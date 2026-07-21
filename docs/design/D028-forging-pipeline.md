# D028: Forgekin锻造流水线详细设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.9]（FR-CORE-009）
> **对应 arch.md**: [doc:../arch.md#§3.9]
> **对应 design.md**: [doc:../design.md#§3.9]（本文件）
> **对应 Feature**: [doc:../features/F028-forging-pipeline.md]（同号 Feature 级 SRS）
> **对应 Architecture**: [doc:../architecture/A028-forging-pipeline.md]（同号架构设计）
> **依赖 ADR**: [doc:../decisions/013-all-things-spirit-mind-vision.md]

---

## 1. 详细设计上下文

### 1.1 设计问题

forgemind 应用层（F026）需要将"养灵"（已废弃，更名为 Forge Nurturing 智能体入职与终身学习）过程从"配置 persona"升级为系统化 Forge Nurturing（智能体入职与终身学习）流水线。A028 已固化 6 阶段流水线架构，本详细设计在 `forgemind/forging/` 落地具体实现，解决以下工程层问题：

1. **6 阶段编排器未落地**：`ForgingExecutor` 接口已在 A028 定义，但启动/推进/获取状态/回滚的具体实现尚未编写。
2. **6 个 StageHandler 实现缺失**：①形态定义 / ②能力注入 / ③记忆初始化 / ④价值观对齐 / ⑤能力验证 / ⑥觉醒晋升六个 handler 类未实现。
3. **operator 审批门实现缺失**：①④⑥阶段审批门仅架构约束，无 `OperatorApprovalGate` 数据模型与等待/超时/拒绝处理逻辑。
4. **Eval 硬门 + 回滚机制未编码**：⑤能力验证的 Eval 阈值校验、失败回滚到 ②的 `rollback_to` 实现缺失。
5. **ForgingManifest YAML 配置加载器未实现**：YAML 配置驱动约束要求 `forgemind/config/forging.yaml` 外置 6 阶段 handler 类名 / require_operator_approval / eval_threshold / on_fail / max_awakening_stage，但 `ForgingConfigLoader` 未实现。
6. **觉醒阶上限校验未编码**：⑥阶段 `target_awakening_stage <= max_awakening_stage` 约束未编码。
7. **artifact 阶段间解耦实现缺失**：阶段间通过 `artifact_id` 解耦，但 `stage_artifacts: dict[ForgingStage, str]` 的写入/读取/失效机制未实现。

### 1.2 设计约束

- **单向依赖约束**：`forgemind/forging/` 必须单向依赖 `flowforge/core/` 中的 F001/F008/F014/F018 + `forgemind/species/`（F027），禁止 `import` 任何 *Forge 业务模块。
- **DI 容器约束**：`StageHandler` 子类必须通过 DI 容器注入到 `ForgingExecutor`，禁止 `ForgingExecutor` 内部 `SpeciesDefineHandler` 直接实例化。
- **Repository 层约束**：`artifact` / `ForgingPipelineState` / `StageTransition` 日志写入必须通过 Repository 层，禁止 `cursor.execute` 直接操作数据库。
- **配置驱动约束**：6 阶段配置必须 YAML 外置到 `forgemind/config/forging.yaml`，禁止 `.py` 硬编码 handler 类名 / 阈值 / 审批策略。
- **operator 审批约束**：①④⑥阶段 `require_operator_approval=true` 时必须等待 operator 显式批准；超时（默认 24h）后流水线进入 `BLOCKED` 状态。
- **Eval 硬门约束**：⑤阶段 `EvalContract.run` 返回的 `quality_score` 必须 `>= 0.85`（v4.0 调整后默认值），失败必须 `rollback_to(CAPABILITY_INJECT)`。
- **觉醒阶上限约束**：⑥阶段 `target_awakening_stage` 不得超过 `ForgingManifest.max_awakening_stage` 授权范围；越权晋升必须被 `AwakeningPromoteHandler` 拒绝。
- **回滚幂等约束**：`rollback_to(target_stage)` 必须幂等，重复调用不产生副作用；`target_stage` 之后的 artifact 必须标记为 `invalidated`。

### 1.3 设计影响

- **对 F026 forgemind 应用层的影响**：`ForgingExecutor` 作为 `ForgekinEngine` 的子组件，由 `ForgeMindPlugin.register_forge_skills` 注册到 DI 容器。
- **对 F027 形态分类的影响**：①阶段 `SpeciesDefineHandler` 调用 `SpeciesRegistry.get(species)` 加载形态属性，复用 `SpeciesProfile.sensor_allowed` / `evolution_allowed` 等门控字段。
- **对 F001 能力画像的影响**：②阶段 `CapabilityInjectHandler` 注入 `CapabilityProfile`，作为 Forgekin 能力锚点。
- **对 F014 多域记忆的影响**：③阶段 `MemorySeedHandler` 调用 `EchoStoreRepository.append` 写入初始EchoStore条目。
- **对 F008 持久状态层的影响**：`ForgingPipelineState` + 所有 artifact 写入 F008 持久状态层。
- **对 F018 Eval Contract 的影响**：⑤阶段 `CapabilityVerifyHandler` 调用 `EvalContract.run(verification_tasks)` 执行五问评估。
- **对 F037 Forgekin市场的影响**：⑥阶段觉醒晋升后Forgekin可由 `ForgekinMarketplace.publish` 发布到市场。
- **对 F038 进化谱系的影响**：流水线产出的 Forgekin 作为 `ForgekinLineage.append(parent=null)` 的谱系起点。

---

## 2. 详细设计

### 2.1 组件设计图

```
                    +-------------------------------------------------+
                    |             forgemind/forging/                 |
                    |                                                 |
                    |  +-------------------+   +-------------------+ |
                    |  | ForgingExecutor   |   | ForgingConfig     | |
                    |  | (Impl)            |<->| Loader            | |
                    |  |  - start        |   | (YAML 加载)       | |
                    |  |  - advance      |   +-------------------+ |
                    |  |  - get_state    |                         |
                    |  |  - rollback_to  |   +-------------------+ |
                    |  +---------+---------+   | OperatorApproval  | |
                    |            |             | Gate              | |
                    |            v             | (①④⑥ 审批门)      | |
                    |  +--------------------+  +-------------------+ |
                    |  | 6 阶段处理器链     |                        |
                    |  | (DI 注入, 顺序执行)|                        |
                    |  +--------------------+                        |
                    |            |                                   |
                    |  +---------v---------+                         |
                    |  | StageHandler      |                         |
                    |  | Registry          | (handler_class ->       | |
                    |  |                   |  StageHandler 实例)     | |
                    |  +-------------------+                         |
                    +-------------------------------------------------+
                                          |
                   +----------------------+----------------------+
                   |                      |                      |
                   v                      v                      v
        +-------------------+   +-------------------+   +-------------------+
        | F027 SpeciesReg   |   | F001 Capability   |   | F014 EchoStore    |
        | (① 阶段调用)       |   | Profile Repo      |   | Repository        |
        +-------------------+   | (② 阶段调用)       |   | (③ 阶段调用)       |
                                +-------------------+   +-------------------+
                   +-------------------+   +-------------------+
                   | F018 EvalContract |   | F008 DurableState |
                   | (⑤ 阶段硬门)       |   | Surfaces          |
                   +-------------------+   | (artifact 持久化)  |
                                           +-------------------+
```

### 2.2 关键设计决策

- **决策 1：6 阶段顺序执行 + `ForgingStage` 枚举固化**
  `ForgingStage` 固定为 6 个值（`SPECIES_DEFINE` / `CAPABILITY_INJECT` / `MEMORY_SEED` / `VALUE_ALIGN` / `CAPABILITY_VERIFY` / `AWAKENING_PROMOTE`），运行时不可新增。`ForgingExecutor.advance` 严格按枚举顺序推进，跳过阶段的 `advance` 调用被拒绝。

- **决策 2：`StageHandler` 抽象 + DI 注入 + YAML 类名映射**
  `StageHandler` 定义 `execute(state) -> artifact_id` + `requires_operator_approval -> bool` 两方法契约。具体 handler 类名通过 `forging.yaml` 配置（如 `handler_class: forgemind.forging.handlers.species_define.SpeciesDefineHandler`），`ForgingConfigLoader` 通过 `importlib` 动态加载并经 DI 容器注入到 `ForgingExecutor`。

- **决策 3：①④⑥阶段审批门 + 24h 超时阻塞**
  `OperatorApprovalGate` 数据模型记录 `pipeline_id` / `stage` / `requested_at` / `approved_at` / `approved_by` / `status`。`status` 为 `PENDING` 时 `advance` 阻塞；超时（`approval_timeout_hours=24`）后 `status` 转为 `TIMEOUT`，流水线 `current_stage` 保持不变并标记 `BLOCKED`。

- **决策 4：⑤阶段 Eval 硬门 + 失败回滚到 ②**
  `CapabilityVerifyHandler.execute` 调用 `EvalContract.run(verification_tasks)`，返回 `EvalReport.quality_score`。若 `quality_score < 0.85`（默认阈值，可由 `forging.yaml` 覆盖），调用 `ForgingExecutor.rollback_to(CAPABILITY_INJECT)`，回滚后 `current_stage=CAPABILITY_INJECT`，③④⑤阶段 artifact 标记为 `invalidated`。回滚次数累计 `>= 3` 次时流水线进入 `FAILED` 状态。

- **决策 5：觉醒阶上限由 `ForgingManifest` 授权**
  `ForgingManifest.max_awakening_stage` 由 operator 在 YAML 中授权，默认 `A2_DAILY_USE`。`AwakeningPromoteHandler.execute` 调用 `_assert_awakening_within_scope`，若 `target_awakening_stage > max_awakening_stage` 拒绝晋升并写入审计日志。更高觉醒阶（A4/A5/A6）必须 operator 单独授权。

- **决策 6：阶段 artifact 通过 F008 持久化 + 解耦**
  每阶段 `execute` 返回 `artifact_id`（F008 持久状态层引用），写入 `ForgingPipelineState.stage_artifacts[stage]`。下一阶段通过 `state.stage_artifacts[prev_stage]` 读取上游 artifact，禁止直接调用上游 handler。

- **决策 7：`ForgingConfigLoader` 加载 + DI 注册**
  `ForgingConfigLoader.load` 读取 `forgemind/config/forging.yaml`，解析 6 阶段配置（`handler_class` / `require_operator_approval` / `eval_threshold` / `on_fail` / `max_awakening_stage`），通过 `importlib` 动态加载 handler 类并经 DI 容器 `register_singleton` 注入。

### 2.3 设计不变量

- `ForgingStage` 枚举必须固定 6 阶段，禁止运行时新增。
- `ForgingExecutor.advance` 必须按枚举顺序推进，跳过阶段的调用被拒绝。
- ①④⑥阶段 `require_operator_approval=true` 时必须等待 operator 显式批准，禁止自动跳过审批门。
- ⑤阶段 `quality_score < 0.85` 时必须 `rollback_to(CAPABILITY_INJECT)`，回滚次数 `>= 3` 时流水线 `FAILED`。
- ⑥阶段 `target_awakening_stage > max_awakening_stage` 时必须拒绝晋升并写入审计日志。
- 阶段 artifact 必须写入 F008 持久状态层，未写入时阶段视为未完成。
- 阶段间必须通过 `stage_artifacts[prev_stage]` 解耦，禁止 StageHandler 直接调用上游 handler。
- `ForgingExecutor` 必须通过 DI 容器注入 `StageHandler` 实例，禁止内部 `SpeciesDefineHandler` 直接实例化。
- 6 阶段配置必须 YAML 外置到 `forgemind/config/forging.yaml`，禁止 `.py` 硬编码 handler 类名。

---

## 3. 模块实现

### 3.1 类图

```
                    +---------------------------------------+
                    | ForgingStage (Enum)                   |
                    +---------------------------------------+
                    | SPECIES_DEFINE                        |
                    | CAPABILITY_INJECT                     |
                    | MEMORY_SEED                           |
                    | VALUE_ALIGN                           |
                    | CAPABILITY_VERIFY                     |
                    | AWAKENING_PROMOTE                     |
                    +---------------------------------------+
                                       ^
                                       |
                    +---------------------------------------+
                    | AwakeningStage (Enum)                 |
                    +---------------------------------------+
                    | A1_INITIATION  (Bootstrapped)         |
                    | A2_DAILY_USE   (L1 Reactive)          |
                    | A3_AUTONOMOUS  (L2 Tool-Using)        |
                    | A4_PROACTIVE   (L3 Self-Improving)    |
                    | A5_SUPER_EVOLVING (L4 Self-Evolving)  |
                    | A6_FORGEMIND   (L5 General-Purpose)   |
                    +---------------------------------------+

                    +---------------------------------------+
                    | ForgingPipelineState (Pydantic)       |
                    +---------------------------------------+
                    | pipeline_id: str                      |
                    | forgekin_id: str                      |
                    | operator_id: str                      |
                    | current_stage: ForgingStage           |
                    | species: str                          |
                    | capability_profile_ref: str           |
                    | soul_imprint_ref: str                 |
                    | stage_artifacts: dict[ForgingStage,   |
                    |                       str]            |
                    | started_at: datetime                  |
                    | stage_history: list[StageTransition]  |
                    | rollback_count: int = 0               |
                    | status: PipelineStatus                |
                    +---------------------------------------+

                    +---------------------------------------+
                    | ForgingManifest (Pydantic, YAML 驱动) |
                    +---------------------------------------+
                    | species: str                          |
                    | seed_capabilities: list[str]          |
                    | seed_memories: list[str]              |
                    | value_anchors: list[str]              |
                    | verification_tasks: list[str]         |
                    | target_awakening_stage: AwakeningStage|
                    | max_awakening_stage: AwakeningStage   |
                    +---------------------------------------+

                    +---------------------------------------+
                    | StageHandler (ABC)                    |
                    +---------------------------------------+
                    | + execute(state) -> artifact_id       |
                    | + requires_operator_approval -> bool|
                    +---------------------------------------+
                                       ^
                                       |
            +--------------------------+--------------------------+
            |                          |                          |
+-----------------------+   +-----------------------+   +-----------------------+
| SpeciesDefineHandler  |   | CapabilityInjectH.   |   | MemorySeedHandler    |
| (① 阶段)              |   | (② 阶段)             |   | (③ 阶段)             |
+-----------------------+   +-----------------------+   +-----------------------+
            +--------------------------+--------------------------+
            |                          |                          |
+-----------------------+   +-----------------------+   +-----------------------+
| ValueAlignHandler     |   | CapabilityVerifyH.   |   | AwakeningPromoteH.   |
| (④ 阶段)              |   | (⑤ 阶段, Eval 硬门)  |   | (⑥ 阶段)             |
+-----------------------+   +-----------------------+   +-----------------------+

                    +---------------------------------------+
                    | ForgingExecutor (ABC + Impl)          |
                    +---------------------------------------+
                    | - handlers: dict[ForgingStage,        |
                    |              StageHandler]            |
                    | - approval_gate: OperatorApprovalGate |
                    | - state_repo: ForgingStateRepository  |
                    | - artifact_repo: ArtifactRepository   |
                    +---------------------------------------+
                    | + start(manifest, operator_id) -> pid |
                    | + advance(pipeline_id) -> ForgingStage|
                    | + get_state(pipeline_id) -> State     |
                    | + rollback_to(pid, target_stage)      |
                    +---------------------------------------+
```

### 3.2 Python 实现：`flowforge/forgemind/forging/pipeline.py`

```python
"""forgemind 锻造流水线核心实现。

实现 A028/D028 设计的 6 阶段流水线编排器。
所有 StageHandler 通过 DI 容器注入，禁止内部直接实例化。
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime, timedelta
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger(__name__)


class ForgingStage(str, Enum):
    """锻造 6 步（FM-006，不可扩展）。

    三标注说明：阶段名同时承载产品语义与 AI 业界语义。
    """
    SPECIES_DEFINE = "species_define"          # ① 形态定义
    CAPABILITY_INJECT = "capability_inject"    # ② 能力注入
    MEMORY_SEED = "memory_seed"                # ③ 记忆初始化
    VALUE_ALIGN = "value_align"                # ④ 价值观对齐
    CAPABILITY_VERIFY = "capability_verify"    # ⑤ 能力验证
    AWAKENING_PROMOTE = "awakening_promote"    # ⑥ 觉醒晋升


# 阶段顺序常量（advance 校验用）
_STAGE_ORDER: tuple[ForgingStage, ...] = (
    ForgingStage.SPECIES_DEFINE,
    ForgingStage.CAPABILITY_INJECT,
    ForgingStage.MEMORY_SEED,
    ForgingStage.VALUE_ALIGN,
    ForgingStage.CAPABILITY_VERIFY,
    ForgingStage.AWAKENING_PROMOTE,
)


class AwakeningStage(str, Enum):
    """觉醒阶（Awakening Stage，自主性 6 级，spec.md §2.5.2）。

    三标注：中文 / 英文 / AI 业界概念。
    """
    A1_INITIATION = "A1_initiation"        # A1 灵启阶（Initiation / Bootstrapped）
    A2_DAILY_USE = "A2_daily_use"          # A2 日常阶（Daily Use / L1 Reactive）
    A3_AUTONOMOUS = "A3_autonomous"        # A3 自主阶（Autonomous / L2 Tool-Using）
    A4_PROACTIVE = "A4_proactive"          # A4 主动阶（Proactive / L3 Self-Improving）
    A5_SUPER_EVOLVING = "A5_super_evolving"  # A5 超进化阶（Super Evolving / L4 Self-Evolving）
    A6_FORGEMIND = "A6_forgemind"          # A6 ForgeMind 阶（ForgeMind / L5 General-Purpose Agent)


_AWAKENING_RANK: dict[AwakeningStage, int] = {
    AwakeningStage.A1_INITIATION: 1,
    AwakeningStage.A2_DAILY_USE: 2,
    AwakeningStage.A3_AUTONOMOUS: 3,
    AwakeningStage.A4_PROACTIVE: 4,
    AwakeningStage.A5_SUPER_EVOLVING: 5,
    AwakeningStage.A6_FORGEMIND: 6,
}


class PipelineStatus(str, Enum):
    """流水线状态。"""
    RUNNING = "running"
    BLOCKED_ON_APPROVAL = "blocked_on_approval"
    ROLLED_BACK = "rolled_back"
    COMPLETED = "completed"
    FAILED = "failed"


class StageTransition(BaseModel):
    """阶段转换日志（写入 F008 持久状态层）。"""
    from_stage: Optional[ForgingStage]
    to_stage: ForgingStage
    transition_at: datetime = Field(default_factory=datetime.utcnow)
    artifact_id: str
    operator_approved: bool = False
    note: str = ""


class ForgingPipelineState(BaseModel):
    """锻造流水线状态（持久化到 F008）。"""
    pipeline_id: str
    forgekin_id: str
    operator_id: str
    current_stage: ForgingStage
    species: str
    capability_profile_ref: str = ""
    soul_imprint_ref: str = ""
    stage_artifacts: dict[ForgingStage, str] = Field(default_factory=dict)
    started_at: datetime = Field(default_factory=datetime.utcnow)
    stage_history: list[StageTransition] = Field(default_factory=list)
    rollback_count: int = 0
    status: PipelineStatus = PipelineStatus.RUNNING
    invalidated_artifacts: list[str] = Field(default_factory=list)


class ForgingManifest(BaseModel):
    """锻造清单（YAML 配置驱动）。

    `max_awakening_stage` 必须由 operator 在 YAML 中显式授权；
    缺省值为 A2_DAILY_USE，更高觉醒阶须单独授权。
    """
    species: str
    seed_capabilities: list[str] = Field(default_factory=list)
    seed_memories: list[str] = Field(default_factory=list)
    value_anchors: list[str] = Field(default_factory=list)
    verification_tasks: list[str] = Field(default_factory=list)
    target_awakening_stage: AwakeningStage
    max_awakening_stage: AwakeningStage = AwakeningStage.A2_DAILY_USE


class StageHandler(ABC):
    """阶段处理器抽象（每阶段一个 handler，DI 注入）。"""

    @abstractmethod
    async def execute(self, state: ForgingPipelineState) -> str:
        """执行阶段处理，返回 artifact_id（F008 持久状态层引用）。"""
        raise NotImplementedError

    @abstractmethod
    async def requires_operator_approval(self) -> bool:
        """是否需要 operator 审批。"""
        raise NotImplementedError


class OperatorApprovalRequest(BaseModel):
    """operator 审批请求。"""
    request_id: str
    pipeline_id: str
    stage: ForgingStage
    requested_at: datetime = Field(default_factory=datetime.utcnow)
    approved_at: Optional[datetime] = None
    approved_by: Optional[str] = None
    status: str = "PENDING"  # PENDING / APPROVED / REJECTED / TIMEOUT


class ForgingExecutor(ABC):
    """锻造流水线执行器抽象。"""

    @abstractmethod
    async def start(
        self, manifest: ForgingManifest, operator_id: str
    ) -> str:
        """启动流水线，返回 pipeline_id。"""
        raise NotImplementedError

    @abstractmethod
    async def advance(self, pipeline_id: str) -> ForgingStage:
        """推进到下一阶段（含审批门 + Eval 硬门 + 回滚）。"""
        raise NotImplementedError

    @abstractmethod
    async def get_state(
        self, pipeline_id: str
    ) -> ForgingPipelineState:
        """获取流水线当前状态。"""
        raise NotImplementedError

    @abstractmethod
    async def rollback_to(
        self, pipeline_id: str, target_stage: ForgingStage
    ) -> None:
        """回滚到指定阶段（如 ⑤ 失败回滚到 ②）。"""
        raise NotImplementedError

    @abstractmethod
    async def approve_stage(
        self,
        pipeline_id: str,
        stage: ForgingStage,
        operator_id: str,
    ) -> None:
        """operator 显式批准当前阶段。"""
        raise NotImplementedError
```

### 3.3 Python 实现：`flowforge/forgemind/forging/executor_impl.py`

```python
"""ForgingExecutor 具体实现（HarnessForgekinEngine 子组件）。"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Optional

from flowforge.core.tracing import get_logger
from flowforge.forgemind.forging.pipeline import (
    AwakeningStage,
    ForgingExecutor,
    ForgingManifest,
    ForgingPipelineState,
    ForgingStage,
    OperatorApprovalRequest,
    PipelineStatus,
    StageHandler,
    StageTransition,
    _AWAKENING_RANK,
    _STAGE_ORDER,
)

logger = get_logger(__name__)

# 默认配置常量（可被 forging.yaml 覆盖）
DEFAULT_APPROVAL_TIMEOUT_HOURS = 24
DEFAULT_EVAL_THRESHOLD = 0.85
DEFAULT_MAX_ROLLBACK_COUNT = 3


class HarnessForgingExecutor(ForgingExecutor):
    """ForgingExecutor 具体实现。

    依赖通过构造函数注入（DI 容器管理）：
    - handlers: 6 个 StageHandler 实例（按 ForgingStage 索引）
    - state_repo: ForgingStateRepository（写入 F008）
    - artifact_repo: ArtifactRepository（持久化 artifact）
    - approval_repo: ApprovalRequestRepository
    - forging_config: 读取自 forging.yaml 的 6 阶段配置
    """

    def __init__(
        self,
        handlers: dict[ForgingStage, StageHandler],
        state_repo: "ForgingStateRepository",
        artifact_repo: "ArtifactRepository",
        approval_repo: "ApprovalRequestRepository",
        forging_config: "ForgingStageConfig",
    ) -> None:
        self._handlers = handlers
        self._state_repo = state_repo
        self._artifact_repo = artifact_repo
        self._approval_repo = approval_repo
        self._config = forging_config
        # 校验 6 阶段 handler 全部注入
        missing = [s for s in _STAGE_ORDER if s not in handlers]
        if missing:
            raise ValueError(
                f"missing stage handlers for: {[s.value for s in missing]}"
            )

    async def start(
        self, manifest: ForgingManifest, operator_id: str
    ) -> str:
        """启动流水线。"""
        # 校验觉醒阶上限
        self._assert_awakening_within_scope(
            manifest.target_awakening_stage,
            manifest.max_awakening_stage,
        )
        pipeline_id = f"forge-pipeline-{uuid.uuid4.hex[:12]}"
        forgekin_id = f"forgekin-{uuid.uuid4.hex[:12]}"
        state = ForgingPipelineState(
            pipeline_id=pipeline_id,
            forgekin_id=forgekin_id,
            operator_id=operator_id,
            current_stage=ForgingStage.SPECIES_DEFINE,
            species=manifest.species,
        )
        # 持久化 manifest + state 到 F008
        await self._state_repo.save_manifest(pipeline_id, manifest)
        await self._state_repo.save_state(state)
        logger.info(
            "forging_pipeline_started",
            pipeline_id=pipeline_id,
            forgekin_id=forgekin_id,
            operator_id=operator_id,
            species=manifest.species,
            target_awakening=manifest.target_awakening_stage.value,
        )
        return pipeline_id

    async def advance(self, pipeline_id: str) -> ForgingStage:
        """推进到下一阶段。

        流程：
        1. 读取当前 state
        2. 若已 COMPLETED/FAILED -> 拒绝
        3. 若当前阶段需审批 -> 校验 OperatorApprovalRequest.status
        4. 调用 handler.execute(state) -> artifact_id
        5. 写入 stage_artifacts + stage_history
        6. 推进 current_stage 到下一阶段（若是最后阶段则 COMPLETED）
        """
        state = await self._state_repo.get_state(pipeline_id)
        if state.status in (PipelineStatus.COMPLETED, PipelineStatus.FAILED):
            raise RuntimeError(
                f"pipeline already {state.status.value}, cannot advance"
            )

        current = state.current_stage
        handler = self._handlers[current]

        # 审批门校验（①④⑥阶段）
        if await handler.requires_operator_approval:
            approval = await self._approval_repo.get_active(
                pipeline_id, current
            )
            if approval is None:
                # 创建审批请求
                req = OperatorApprovalRequest(
                    request_id=f"appr-{uuid.uuid4.hex[:10]}",
                    pipeline_id=pipeline_id,
                    stage=current,
                )
                await self._approval_repo.save(req)
                state.status = PipelineStatus.BLOCKED_ON_APPROVAL
                await self._state_repo.save_state(state)
                logger.info(
                    "forging_pipeline_blocked_on_approval",
                    pipeline_id=pipeline_id,
                    stage=current.value,
                )
                return current
            # 校验审批状态
            if approval.status == "PENDING":
                # 检查超时
                timeout_hours = self._config.approval_timeout_hours
                if datetime.utcnow - approval.requested_at > timedelta(
                    hours=timeout_hours
                ):
                    approval.status = "TIMEOUT"
                    await self._approval_repo.save(approval)
                    state.status = PipelineStatus.BLOCKED_ON_APPROVAL
                    await self._state_repo.save_state(state)
                    logger.warning(
                        "forging_pipeline_approval_timeout",
                        pipeline_id=pipeline_id,
                        stage=current.value,
                    )
                    return current
                return current  # 仍 PENDING，不推进
            if approval.status == "REJECTED":
                state.status = PipelineStatus.FAILED
                await self._state_repo.save_state(state)
                raise RuntimeError(
                    f"stage {current.value} rejected by operator"
                )
            # APPROVED -> 继续执行

        # 执行 handler
        try:
            artifact_id = await handler.execute(state)
        except Exception as exc:
            logger.error(
                "forging_stage_handler_failed",
                pipeline_id=pipeline_id,
                stage=current.value,
                error=str(exc),
            )
            # ⑤阶段 Eval 硬门失败 -> 回滚到 ②
            if current == ForgingStage.CAPABILITY_VERIFY:
                await self.rollback_to(
                    pipeline_id, ForgingStage.CAPABILITY_INJECT
                )
                raise RuntimeError(
                    f"capability_verify failed, rolled back to "
                    f"capability_inject: {exc}"
                ) from exc
            raise

        # 写入 artifact + history
        state.stage_artifacts[current] = artifact_id
        state.stage_history.append(
            StageTransition(
                from_stage=None if not state.stage_history else state.stage_history[-1].to_stage,
                to_stage=current,
                artifact_id=artifact_id,
                operator_approved=await handler.requires_operator_approval,
            )
        )
        await self._artifact_repo.persist(artifact_id, current)

        # 推进 current_stage
        idx = _STAGE_ORDER.index(current)
        if idx + 1 >= len(_STAGE_ORDER):
            state.status = PipelineStatus.COMPLETED
            state.current_stage = current  # 保持最后阶段
        else:
            state.current_stage = _STAGE_ORDER[idx + 1]
        await self._state_repo.save_state(state)
        logger.info(
            "forging_stage_advanced",
            pipeline_id=pipeline_id,
            completed_stage=current.value,
            next_stage=state.current_stage.value,
            artifact_id=artifact_id,
        )
        return state.current_stage

    async def get_state(
        self, pipeline_id: str
    ) -> ForgingPipelineState:
        return await self._state_repo.get_state(pipeline_id)

    async def rollback_to(
        self, pipeline_id: str, target_stage: ForgingStage
    ) -> None:
        """回滚到指定阶段（幂等）。

        - target_stage 之后的 artifact 标记为 invalidated
        - current_stage 回到 target_stage
        - rollback_count += 1，超过 MAX_ROLLBACK_COUNT -> FAILED
        """
        state = await self._state_repo.get_state(pipeline_id)
        target_idx = _STAGE_ORDER.index(target_stage)
        current_idx = _STAGE_ORDER.index(state.current_stage)
        if target_idx >= current_idx:
            logger.warning(
                "forging_rollback_skipped_target_not_before_current",
                pipeline_id=pipeline_id,
                target=target_stage.value,
                current=state.current_stage.value,
            )
            return
        # 失效后续 artifact
        for stage in _STAGE_ORDER[target_idx + 1 : current_idx + 1]:
            art_id = state.stage_artifacts.get(stage)
            if art_id and art_id not in state.invalidated_artifacts:
                state.invalidated_artifacts.append(art_id)
                await self._artifact_repo.invalidate(art_id)
                del state.stage_artifacts[stage]
        state.current_stage = target_stage
        state.rollback_count += 1
        if state.rollback_count >= DEFAULT_MAX_ROLLBACK_COUNT:
            state.status = PipelineStatus.FAILED
            logger.error(
                "forging_pipeline_failed_max_rollback",
                pipeline_id=pipeline_id,
                rollback_count=state.rollback_count,
            )
        else:
            state.status = PipelineStatus.ROLLED_BACK
        await self._state_repo.save_state(state)
        logger.info(
            "forging_pipeline_rolled_back",
            pipeline_id=pipeline_id,
            target_stage=target_stage.value,
            rollback_count=state.rollback_count,
        )

    async def approve_stage(
        self,
        pipeline_id: str,
        stage: ForgingStage,
        operator_id: str,
    ) -> None:
        """operator 显式批准当前阶段。"""
        approval = await self._approval_repo.get_active(pipeline_id, stage)
        if approval is None:
            raise RuntimeError(
                f"no active approval request for stage {stage.value}"
            )
        approval.status = "APPROVED"
        approval.approved_at = datetime.utcnow
        approval.approved_by = operator_id
        await self._approval_repo.save(approval)
        # 解除 BLOCKED 状态
        state = await self._state_repo.get_state(pipeline_id)
        if state.status == PipelineStatus.BLOCKED_ON_APPROVAL:
            state.status = PipelineStatus.RUNNING
            await self._state_repo.save_state(state)
        logger.info(
            "forging_stage_approved",
            pipeline_id=pipeline_id,
            stage=stage.value,
            operator_id=operator_id,
        )

    def _assert_awakening_within_scope(
        self,
        target: AwakeningStage,
        max_allowed: AwakeningStage,
    ) -> None:
        if _AWAKENING_RANK[target] > _AWAKENING_RANK[max_allowed]:
            raise ValueError(
                f"target awakening {target.value} exceeds max_allowed "
                f"{max_allowed.value}; operator must explicitly authorize"
            )
```

### 3.4 Python 实现：6 个 StageHandler

#### 3.4.1 `flowforge/forgemind/forging/handlers/species_define.py`

```python
"""① 形态定义 handler（operator 审批 + SpeciesRegistry）。"""
from __future__ import annotations

from flowforge.forgemind.forging.pipeline import (
    ForgingPipelineState,
    StageHandler,
)
from flowforge.forgemind.species import SpeciesRegistry  # F027
from flowforge.core.tracing import get_logger

logger = get_logger(__name__)


class SpeciesDefineHandler(StageHandler):
    """① 形态定义：加载 SpeciesProfile + 创建SoulImprint。"""

    def __init__(
        self,
        species_registry: SpeciesRegistry,
        mind_imprint_repo: "SoulImprintRepository",
    ) -> None:
        self._species_registry = species_registry
        self._mind_imprint_repo = mind_imprint_repo

    async def execute(self, state: ForgingPipelineState) -> str:
        species_profile = await self._species_registry.get(state.species)
        # 创建SoulImprint（不可变身份锚点）
        mind_imprint_id = await self._mind_imprint_repo.create(
            forgekin_id=state.forgekin_id,
            species=state.species,
            species_profile_ref=species_profile.species_id,
        )
        state.soul_imprint_ref = mind_imprint_id
        logger.info(
            "species_defined",
            pipeline_id=state.pipeline_id,
            species=state.species,
            mind_imprint_id=mind_imprint_id,
        )
        return f"species_spec:{mind_imprint_id}"

    async def requires_operator_approval(self) -> bool:
        return True  # ① 阶段必须 operator 批准
```

#### 3.4.2 `flowforge/forgemind/forging/handlers/capability_inject.py`

```python
"""② 能力注入 handler（F001 CapabilityProfile）。"""
from __future__ import annotations

from flowforge.forgemind.forging.pipeline import (
    ForgingPipelineState,
    StageHandler,
)
from flowforge.core.tracing import get_logger

logger = get_logger(__name__)


class CapabilityInjectHandler(StageHandler):
    """② 能力注入：从 manifest.seed_capabilities 注入 CapabilityProfile。"""

    def __init__(
        self,
        capability_profile_repo: "CapabilityProfileRepository",  # F001
        manifest_repo: "ForgingStateRepository",
    ) -> None:
        self._cap_repo = capability_profile_repo
        self._manifest_repo = manifest_repo

    async def execute(self, state: ForgingPipelineState) -> str:
        manifest = await self._manifest_repo.get_manifest(state.pipeline_id)
        cap_profile_id = await self._cap_repo.inject(
            forgekin_id=state.forgekin_id,
            seed_capabilities=manifest.seed_capabilities,
        )
        state.capability_profile_ref = cap_profile_id
        logger.info(
            "capability_injected",
            pipeline_id=state.pipeline_id,
            forgekin_id=state.forgekin_id,
            capability_profile_id=cap_profile_id,
            seed_count=len(manifest.seed_capabilities),
        )
        return f"capability_profile:{cap_profile_id}"

    async def requires_operator_approval(self) -> bool:
        return False  # ② 阶段自动执行
```

#### 3.4.3 `flowforge/forgemind/forging/handlers/memory_seed.py`

```python
"""③ 记忆初始化 handler（F014 EchoStore）。"""
from __future__ import annotations

from flowforge.forgemind.forging.pipeline import (
    ForgingPipelineState,
    StageHandler,
)
from flowforge.core.tracing import get_logger

logger = get_logger(__name__)


class MemorySeedHandler(StageHandler):
    """③ 记忆初始化：将 seed_memories 写入 F014 EchoStore。"""

    def __init__(
        self,
        echo_store_repo: "EchoStoreRepository",  # F014
        manifest_repo: "ForgingStateRepository",
    ) -> None:
        self._echo_repo = echo_store_repo
        self._manifest_repo = manifest_repo

    async def execute(self, state: ForgingPipelineState) -> str:
        manifest = await self._manifest_repo.get_manifest(state.pipeline_id)
        echo_entry_ids: list[str] = []
        for seed_memory_id in manifest.seed_memories:
            entry_id = await self._echo_repo.append(
                forgekin_id=state.forgekin_id,
                collection="seed_memory",
                content={"seed_memory_id": seed_memory_id},
                tags=["seed", "initial"],
            )
            echo_entry_ids.append(entry_id)
        artifact_id = f"initial_echo_set:{state.forgekin_id}"
        logger.info(
            "memory_seeded",
            pipeline_id=state.pipeline_id,
            forgekin_id=state.forgekin_id,
            seed_count=len(echo_entry_ids),
        )
        return artifact_id

    async def requires_operator_approval(self) -> bool:
        return False  # ③ 阶段自动执行
```

#### 3.4.4 `flowforge/forgemind/forging/handlers/value_align.py`

```python
"""④ 价值观对齐 handler（operator 审批 + ValueCharter 不可变红线）。"""
from __future__ import annotations

from flowforge.forgemind.forging.pipeline import (
    ForgingPipelineState,
    StageHandler,
)
from flowforge.core.tracing import get_logger

logger = get_logger(__name__)


class ValueAlignHandler(StageHandler):
    """④ 价值观对齐：创建 ValueCharter（不可变红线，不受 Eval 修改）。"""

    def __init__(
        self,
        value_charter_repo: "ValueCharterRepository",
        manifest_repo: "ForgingStateRepository",
    ) -> None:
        self._charter_repo = value_charter_repo
        self._manifest_repo = manifest_repo

    async def execute(self, state: ForgingPipelineState) -> str:
        manifest = await self._manifest_repo.get_manifest(state.pipeline_id)
        charter_id = await self._charter_repo.create(
            forgekin_id=state.forgekin_id,
            value_anchors=manifest.value_anchors,
            immutable=True,  # 不可被后续 Eval/Episode 修改
        )
        logger.info(
            "value_aligned",
            pipeline_id=state.pipeline_id,
            forgekin_id=state.forgekin_id,
            charter_id=charter_id,
            anchor_count=len(manifest.value_anchors),
        )
        return f"value_charter:{charter_id}"

    async def requires_operator_approval(self) -> bool:
        return True  # ④ 阶段必须 operator 批准
```

#### 3.4.5 `flowforge/forgemind/forging/handlers/capability_verify.py`

```python
"""⑤ 能力验证 handler（F018 Eval Contract 硬门）。"""
from __future__ import annotations

from flowforge.forgemind.forging.pipeline import (
    ForgingPipelineState,
    StageHandler,
)
from flowforge.core.tracing import get_logger

logger = get_logger(__name__)


class CapabilityVerifyHandler(StageHandler):
    """⑤ 能力验证：调用 EvalContract 五问 + 质量分阈值 0.85 硬门。

    失败时由 ForgingExecutor.rollback_to(CAPABILITY_INJECT) 接管，
    本 handler 仅抛出 CapabilityVerifyFailedError。
    """

    def __init__(
        self,
        eval_contract: "EvalContract",  # F018
        manifest_repo: "ForgingStateRepository",
        eval_threshold: float = 0.85,
    ) -> None:
        self._eval_contract = eval_contract
        self._manifest_repo = manifest_repo
        self._threshold = eval_threshold

    async def execute(self, state: ForgingPipelineState) -> str:
        manifest = await self._manifest_repo.get_manifest(state.pipeline_id)
        eval_report = await self._eval_contract.run(
            forgekin_id=state.forgekin_id,
            verification_tasks=manifest.verification_tasks,
        )
        quality_score = eval_report.quality_score
        logger.info(
            "capability_verified",
            pipeline_id=state.pipeline_id,
            forgekin_id=state.forgekin_id,
            quality_score=quality_score,
            threshold=self._threshold,
            passed=quality_score >= self._threshold,
        )
        if quality_score < self._threshold:
            raise CapabilityVerifyFailedError(
                f"quality_score {quality_score} below threshold "
                f"{self._threshold}; rolling back to capability_inject"
            )
        return f"verify_report:{eval_report.report_id}"

    async def requires_operator_approval(self) -> bool:
        return False  # ⑤ 阶段自动执行（Eval 硬门替代人工审批）


class CapabilityVerifyFailedError(Exception):
    """能力验证失败异常（触发 ForgingExecutor 回滚到 ②）。"""
```

#### 3.4.6 `flowforge/forgemind/forging/handlers/awakening_promote.py`

```python
"""⑥ 觉醒晋升 handler（operator 审批 + 觉醒阶上限校验）。"""
from __future__ import annotations

from flowforge.forgemind.forging.pipeline import (
    AwakeningStage,
    ForgingPipelineState,
    StageHandler,
)
from flowforge.core.tracing import get_logger

logger = get_logger(__name__)


class AwakeningPromoteHandler(StageHandler):
    """⑥ 觉醒晋升：写入觉醒证书 + 更新 forgekin.evolution_stage。"""

    def __init__(
        self,
        forgekin_repo: "ForgekinRepository",
        awakening_cert_repo: "AwakeningCertificateRepository",
        manifest_repo: "ForgingStateRepository",
    ) -> None:
        self._forgekin_repo = forgekin_repo
        self._cert_repo = awakening_cert_repo
        self._manifest_repo = manifest_repo

    async def execute(self, state: ForgingPipelineState) -> str:
        manifest = await self._manifest_repo.get_manifest(state.pipeline_id)
        target = manifest.target_awakening_stage
        max_allowed = manifest.max_awakening_stage
        # 觉醒阶上限校验
        self._assert_awakening_within_scope(target, max_allowed)
        # 写入觉醒证书
        cert_id = await self._cert_repo.issue(
            forgekin_id=state.forgekin_id,
            target_awakening_stage=target,
            pipeline_id=state.pipeline_id,
        )
        # 更新 forgekin.evolution_stage -> E2_AWAKEN + awakening_stage
        await self._forgekin_repo.update_evolution(
            forgekin_id=state.forgekin_id,
            evolution_stage="E2_awaken",
            awakening_stage=target,
        )
        logger.info(
            "awakening_promoted",
            pipeline_id=state.pipeline_id,
            forgekin_id=state.forgekin_id,
            target_awakening=target.value,
            cert_id=cert_id,
        )
        return f"awakening_certificate:{cert_id}"

    async def requires_operator_approval(self) -> bool:
        return True  # ⑥ 阶段必须 operator 批准

    def _assert_awakening_within_scope(
        self,
        target: AwakeningStage,
        max_allowed: AwakeningStage,
    ) -> None:
        from flowforge.forgemind.forging.pipeline import _AWAKENING_RANK
        if _AWAKENING_RANK[target] > _AWAKENING_RANK[max_allowed]:
            raise ValueError(
                f"target awakening {target.value} exceeds max_allowed "
                f"{max_allowed.value}; operator must explicitly authorize"
            )
```

### 3.5 Python 实现：`flowforge/forgemind/forging/config_loader.py`

```python
"""ForgingConfigLoader：从 forging.yaml 加载 6 阶段配置 + DI 注册。"""
from __future__ import annotations

import importlib
from pathlib import Path
from typing import Any

import yaml

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger
from flowforge.forgemind.forging.pipeline import (
    AwakeningStage,
    ForgingStage,
    StageHandler,
)

logger = get_logger(__name__)


class StageConfig(BaseModel):
    """单阶段配置（来自 forging.yaml）。"""
    handler_class: str                    # 全限定类名
    require_operator_approval: bool = False
    eval_threshold: float = 0.85
    on_fail: str = "rollback_to_capability_inject"  # 仅 ⑤ 阶段用
    max_awakening_stage: AwakeningStage = AwakeningStage.A2_DAILY_USE


class ForgingStageConfig(BaseModel):
    """6 阶段总配置。"""
    stages: dict[ForgingStage, StageConfig]
    approval_timeout_hours: int = 24
    max_rollback_count: int = 3


class ForgingConfigLoader:
    """forging.yaml 配置加载器。

    YAML 结构示例：
        approval_timeout_hours: 24
        max_rollback_count: 3
        stages:
          species_define:
            handler_class: forgemind.forging.handlers.species_define.SpeciesDefineHandler
            require_operator_approval: true
          capability_inject:
            handler_class: forgemind.forging.handlers.capability_inject.CapabilityInjectHandler
            require_operator_approval: false
          memory_seed:
            handler_class: forgemind.forging.handlers.memory_seed.MemorySeedHandler
            require_operator_approval: false
          value_align:
            handler_class: forgemind.forging.handlers.value_align.ValueAlignHandler
            require_operator_approval: true
          capability_verify:
            handler_class: forgemind.forging.handlers.capability_verify.CapabilityVerifyHandler
            require_operator_approval: false
            eval_threshold: 0.85
            on_fail: rollback_to_capability_inject
          awakening_promote:
            handler_class: forgemind.forging.handlers.awakening_promote.AwakeningPromoteHandler
            require_operator_approval: true
            max_awakening_stage: A2_daily_use
    """

    def __init__(self, config_path: Path) -> None:
        self._config_path = config_path

    def load(self) -> ForgingStageConfig:
        with self._config_path.open("r", encoding="utf-8") as f:
            raw = yaml.safe_load(f)
        stages_raw = raw.get("stages", {})
        stages: dict[ForgingStage, StageConfig] = {}
        for stage_name, cfg in stages_raw.items:
            stage = ForgingStage(stage_name)
            stages[stage] = StageConfig(**cfg)
        # 校验 6 阶段齐全
        missing = [
            s for s in ForgingStage if s not in stages
        ]
        if missing:
            raise ValueError(
                f"forging.yaml missing stage configs: "
                f"{[s.value for s in missing]}"
            )
        return ForgingStageConfig(
            stages=stages,
            approval_timeout_hours=raw.get("approval_timeout_hours", 24),
            max_rollback_count=raw.get("max_rollback_count", 3),
        )

    def load_handler_instances(
        self,
        config: ForgingStageConfig,
        di_container: "DIContainer",
    ) -> dict[ForgingStage, StageHandler]:
        """通过 importlib 动态加载 handler 类 + DI 容器解析依赖。"""
        handlers: dict[ForgingStage, StageHandler] = {}
        for stage, stage_cfg in config.stages.items:
            module_path, class_name = stage_cfg.handler_class.rsplit(".", 1)
            module = importlib.import_module(module_path)
            handler_cls = getattr(module, class_name)
            # DI 容器解析 handler 构造函数依赖
            instance = di_container.resolve(handler_cls)
            # 校验 require_operator_approval 与配置一致
            if instance.requires_operator_approval != stage_cfg.require_operator_approval:
                logger.warning(
                    "forging_handler_approval_mismatch",
                    stage=stage.value,
                    handler=stage_cfg.handler_class,
                    configured=stage_cfg.require_operator_approval,
                    actual=instance.requires_operator_approval,
                )
            handlers[stage] = instance
        return handlers
```

### 3.6 YAML 配置示例：`forgemind/config/forging.yaml`

```yaml
# FlowForge 锻造流水线配置（D028）
# 6 阶段严格顺序执行，禁止运行时新增阶段。

approval_timeout_hours: 24
max_rollback_count: 3

stages:
  # ① 形态定义：operator 审批 + SpeciesRegistry 加载形态属性
  species_define:
    handler_class: forgemind.forging.handlers.species_define.SpeciesDefineHandler
    require_operator_approval: true

  # ② 能力注入：自动执行，从 manifest.seed_capabilities 注入 CapabilityProfile
  capability_inject:
    handler_class: forgemind.forging.handlers.capability_inject.CapabilityInjectHandler
    require_operator_approval: false

  # ③ 记忆初始化：自动执行，写入 F014 EchoStore 初始EchoStore
  memory_seed:
    handler_class: forgemind.forging.handlers.memory_seed.MemorySeedHandler
    require_operator_approval: false

  # ④ 价值观对齐：operator 审批 + 创建不可变 ValueCharter
  value_align:
    handler_class: forgemind.forging.handlers.value_align.ValueAlignHandler
    require_operator_approval: true

  # ⑤ 能力验证：Eval 硬门，阈值 0.85，失败回滚到 ②
  capability_verify:
    handler_class: forgemind.forging.handlers.capability_verify.CapabilityVerifyHandler
    require_operator_approval: false
    eval_threshold: 0.85
    on_fail: rollback_to_capability_inject

  # ⑥ 觉醒晋升：operator 审批 + 觉醒阶上限校验
  awakening_promote:
    handler_class: forgemind.forging.handlers.awakening_promote.AwakeningPromoteHandler
    require_operator_approval: true
    max_awakening_stage: A2_daily_use  # operator 授权上限
```

### 3.7 算法伪代码

#### 3.7.1 `start(manifest, operator_id)` 启动流程

```
function start(manifest, operator_id):
    # 1. 觉醒阶上限校验
    if RANK[manifest.target_awakening_stage] > RANK[manifest.max_awakening_stage]:
        raise ValueError("target exceeds max_allowed; operator must authorize")

    # 2. 生成 pipeline_id + forgekin_id
    pipeline_id = "forge-pipeline-" + uuid
    forgekin_id = "forgekin-" + uuid

    # 3. 创建 ForgingPipelineState (current_stage=①)
    state = ForgingPipelineState(
        pipeline_id=pipeline_id,
        forgekin_id=forgekin_id,
        operator_id=operator_id,
        current_stage=SPECIES_DEFINE,
        species=manifest.species,
        status=RUNNING,
    )

    # 4. 持久化 manifest + state 到 F008
    state_repo.save_manifest(pipeline_id, manifest)
    state_repo.save_state(state)

    # 5. 返回 pipeline_id
    return pipeline_id
```

#### 3.7.2 `advance(pipeline_id)` 推进流程

```
function advance(pipeline_id):
    state = state_repo.get_state(pipeline_id)

    # 1. 状态校验
    if state.status in (COMPLETED, FAILED):
        raise RuntimeError("pipeline already terminated")

    current = state.current_stage
    handler = handlers[current]

    # 2. 审批门校验
    if handler.requires_operator_approval:
        approval = approval_repo.get_active(pipeline_id, current)
        if approval is None:
            # 创建审批请求
            approval = OperatorApprovalRequest(pipeline_id, current, PENDING)
            approval_repo.save(approval)
            state.status = BLOCKED_ON_APPROVAL
            state_repo.save_state(state)
            return current

        if approval.status == PENDING:
            # 超时检查
            if now - approval.requested_at > config.approval_timeout_hours:
                approval.status = TIMEOUT
                approval_repo.save(approval)
                state.status = BLOCKED_ON_APPROVAL
                state_repo.save_state(state)
                return current
            return current  # 仍 PENDING

        if approval.status == REJECTED:
            state.status = FAILED
            state_repo.save_state(state)
            raise RuntimeError("stage rejected by operator")
        # APPROVED -> 继续

    # 3. 执行 handler
    try:
        artifact_id = handler.execute(state)
    except Exception as e:
        if current == CAPABILITY_VERIFY:
            rollback_to(pipeline_id, CAPABILITY_INJECT)
            raise RuntimeError("verify failed, rolled back") from e
        raise

    # 4. 写入 artifact + history
    state.stage_artifacts[current] = artifact_id
    state.stage_history.append(StageTransition(current, artifact_id))
    artifact_repo.persist(artifact_id, current)

    # 5. 推进 current_stage
    idx = STAGE_ORDER.index(current)
    if idx + 1 >= len(STAGE_ORDER):
        state.status = COMPLETED
    else:
        state.current_stage = STAGE_ORDER[idx + 1]
    state_repo.save_state(state)

    return state.current_stage
```

#### 3.7.3 `rollback_to(pipeline_id, target_stage)` 回滚流程

```
function rollback_to(pipeline_id, target_stage):
    state = state_repo.get_state(pipeline_id)
    target_idx = STAGE_ORDER.index(target_stage)
    current_idx = STAGE_ORDER.index(state.current_stage)

    # 1. 目标必须在当前之前
    if target_idx >= current_idx:
        return  # 幂等，不操作

    # 2. 失效后续 artifact
    for stage in STAGE_ORDER[target_idx+1 : current_idx+1]:
        art_id = state.stage_artifacts.get(stage)
        if art_id and art_id not in state.invalidated_artifacts:
            state.invalidated_artifacts.append(art_id)
            artifact_repo.invalidate(art_id)
            del state.stage_artifacts[stage]

    # 3. 回退 current_stage
    state.current_stage = target_stage
    state.rollback_count += 1

    # 4. 回滚次数超限 -> FAILED
    if state.rollback_count >= config.max_rollback_count:
        state.status = FAILED
    else:
        state.status = ROLLED_BACK

    state_repo.save_state(state)
```

#### 3.7.4 `register_forging_plugin(di_container)` DI 注册流程

```
function register_forging_plugin(di_container):
    # 1. 加载 forging.yaml
    config_path = Path("forgemind/config/forging.yaml")
    loader = ForgingConfigLoader(config_path)
    config = loader.load

    # 2. 通过 DI 容器解析 6 个 handler 实例
    handlers = loader.load_handler_instances(config, di_container)

    # 3. 注册 ForgingExecutor 单例
    executor = HarnessForgingExecutor(
        handlers=handlers,
        state_repo=di_container.resolve(ForgingStateRepository),
        artifact_repo=di_container.resolve(ArtifactRepository),
        approval_repo=di_container.resolve(ApprovalRequestRepository),
        forging_config=config,
    )
    di_container.register_singleton(ForgingExecutor, executor)
```

### 3.8 时序图：完整锻造流程

```
operator            ForgingExecutor       StageHandler         F008/F014/F018
   |                       |                    |                      |
   | start(manifest)       |                    |                      |
   |---------------------->|                    |                      |
   |                       | create state      |                      |
   |                       |----------------------------------------->|
   |                       |                    |                      |
   | advance             |                    |                      |
   |---------------------->|                    |                      |
   |                       | check approval     |                      |
   |                       |  (① approval=N)    |                      |
   |                       | create req PENDING |                      |
   |                       |----------------------------------------->|
   |                       | return BLOCKED     |                      |
   |<----------------------|                    |                      |
   |                       |                    |                      |
   | approve_stage(①)      |                    |                      |
   |---------------------->|                    |                      |
   |                       | approval=APPROVED  |                      |
   |                       |----------------------------------------->|
   |                       |                    |                      |
   | advance             |                    |                      |
   |---------------------->|                    |                      |
   |                       | SpeciesDefineH.execute                 |
   |                       |------------------>|                      |
   |                       |                    | SpeciesRegistry.get |
   |                       |                    |---------------------->|
   |                       |                    | create SoulImprint  |
   |                       |                    |---------------------->|
   |                       |                    | artifact_id         |
   |                       |<------------------|                      |
   |                       | persist artifact   |                      |
   |                       |----------------------------------------->|
   |                       | advance to ②      |                      |
   |<----------------------|                    |                      |
   |                       |                    |                      |
   | advance [②③ 自动]   |                    |                      |
   |---------------------->| CapInjectH.execute|                     |
   |                       |------------------>|                      |
   |                       |                    | inject profile      |
   |                       |                    |---------------------->|
   |                       | advance to ③      |                      |
   |                       | MemorySeedH.execute                    |
   |                       |------------------>|                      |
   |                       |                    | echo_store.append   |
   |                       |                    |---------------------->|
   |                       | advance to ④      |                      |
   |<----------------------|                    |                      |
   |                       |                    |                      |
   | approve_stage(④) + advance [④ 审批]      |                     |
   |---------------------->| ValueAlignH.execute                    |
   |                       |------------------>|                      |
   |                       |                    | create ValueCharter |
   |                       |                    |---------------------->|
   |                       | advance to ⑤      |                      |
   |<----------------------|                    |                      |
   |                       |                    |                      |
   | advance             |                    |                      |
   |---------------------->| CapVerifyH.execute                     |
   |                       |------------------>|                      |
   |                       |                    | EvalContract.run    |
   |                       |                    |---------------------->|
   |                       |                    | quality_score=0.92  |
   |                       |                    |<----------------------|
   |                       |                    | (>=0.85, pass)      |
   |                       |                    | artifact_id         |
   |                       |<------------------|                      |
   |                       | advance to ⑥      |                      |
   |<----------------------|                    |                      |
   |                       |                    |                      |
   | approve_stage(⑥) + advance [⑥ 审批]      |                     |
   |---------------------->| AwakeningPromoteH.execute              |
   |                       |------------------>|                      |
   |                       |                    | assert target<=max  |
   |                       |                    | issue certificate   |
   |                       |                    |---------------------->|
   |                       |                    | update evolution    |
   |                       |                    |---------------------->|
   |                       |                    | artifact_id         |
   |                       |<------------------|                      |
   |                       | status=COMPLETED   |                      |
   |<----------------------|                    |                      |
```

### 3.9 错误处理矩阵

| 错误场景 | 检测点 | 处理动作 | 用户反馈 |
|---------|--------|---------|---------|
| 缺失 handler 类 | `ForgingConfigLoader.load` | 抛 `ValueError`，DI 注册失败 | "forging.yaml missing stage configs: [...]" |
| handler import 失败 | `importlib.import_module` | 抛 `ImportError`，DI 注册失败 | "module not found: forgemind.forging.handlers.xxx" |
| 觉醒阶越权 | `start` | 抛 `ValueError` | "target awakening X exceeds max_allowed Y" |
| 审批超时 | `advance` | `status=BLOCKED_ON_APPROVAL` | "approval timeout, pipeline blocked" |
| 审批被拒 | `advance` | `status=FAILED` | "stage X rejected by operator" |
| ⑤ Eval 失败 | `CapabilityVerifyHandler.execute` | 抛 `CapabilityVerifyFailedError` + `rollback_to(②)` | "quality_score X below threshold 0.85, rolled back" |
| 回滚次数超限 | `rollback_to` | `status=FAILED` | "max rollback count exceeded, pipeline failed" |
| 阶段顺序错乱 | `advance` | 拒绝推进 | "stage order violation" |
| handler 抛未捕获异常 | `advance` try/except | ⑤阶段触发回滚，其他阶段直接抛 | 错误堆栈写入审计日志 |
| artifact 持久化失败 | `artifact_repo.persist` | 抛 `IOError`，state 不推进 | "artifact persistence failed" |
| state 不存在 | `state_repo.get_state` | 抛 `KeyError` | "pipeline_id not found" |
| DI 依赖缺失 | `di_container.resolve` | 抛 `DIResolutionError` | "cannot resolve dependency for handler X" |

### 3.10 性能优化指标

| 指标 | 目标值 | 测量点 |
|------|--------|--------|
| `start` 延迟 | < 200ms | `state_repo.save_manifest` + `save_state` |
| 单阶段 `advance` 延迟 | < 5s（不含审批等待） | handler.execute + artifact persist |
| ⑤阶段 Eval 延迟 | < 60s | `EvalContract.run(verification_tasks)` |
| 回滚延迟 | < 500ms | `artifact_repo.invalidate` + state update |
| 完整流水线（无审批等待） | < 90s | 6 阶段总和 |
| 审批等待超时 | 24h | `approval_timeout_hours` |
| 回滚次数上限 | 3 次 | `max_rollback_count` |
| 单流水线 artifact 数 | 6（每阶段一个） | `stage_artifacts` 字典 |

---

## 4. 跨模块协作实现

### 4.1 上游依赖实现

#### 4.1.1 依赖 F026 forgemind 应用层

`ForgingExecutor` 由 `ForgeMindPlugin.register_forge_skills` 注册到 DI 容器：

```python
# forgemind/plugin.py（节选）
class ForgeMindPlugin:
    def register_forge_skills(self, di_container):
        # 加载 forging.yaml
        config_loader = ForgingConfigLoader(
            Path(__file__).parent / "config" / "forging.yaml"
        )
        config = config_loader.load
        # 通过 DI 解析 handler 实例
        handlers = config_loader.load_handler_instances(config, di_container)
        # 注册 ForgingExecutor 单例
        executor = HarnessForgingExecutor(
            handlers=handlers,
            state_repo=di_container.resolve(ForgingStateRepository),
            artifact_repo=di_container.resolve(ArtifactRepository),
            approval_repo=di_container.resolve(ApprovalRequestRepository),
            forging_config=config,
        )
        di_container.register_singleton(ForgingExecutor, executor)
```

#### 4.1.2 依赖 F027 形态分类

①阶段 `SpeciesDefineHandler` 调用 `SpeciesRegistry.get(species)`：

```python
species_profile = await self._species_registry.get(state.species)
# species_profile 包含 sensor_allowed / evolution_allowed / physical_coupling 等门控字段
```

#### 4.1.3 依赖 F001 能力画像

②阶段 `CapabilityInjectHandler` 调用 `CapabilityProfileRepository.inject`：

```python
cap_profile_id = await self._cap_repo.inject(
    forgekin_id=state.forgekin_id,
    seed_capabilities=manifest.seed_capabilities,
)
```

#### 4.1.4 依赖 F014 多域记忆

③阶段 `MemorySeedHandler` 调用 `EchoStoreRepository.append` 写入初始EchoStore。

#### 4.1.5 依赖 F018 Eval Contract

⑤阶段 `CapabilityVerifyHandler` 调用 `EvalContract.run` 执行五问评估：

```python
eval_report = await self._eval_contract.run(
    forgekin_id=state.forgekin_id,
    verification_tasks=manifest.verification_tasks,
)
# eval_report 包含 quality_score / five_questions / signals
```

#### 4.1.6 依赖 F008 持久状态层

所有 `ForgingPipelineState` + `artifact` + `OperatorApprovalRequest` + `StageTransition` 通过 Repository 写入 F008。

### 4.2 下游影响实现

#### 4.2.1 影响 F037 Forgekin市场

⑥阶段觉醒晋升后，`ForgekinMarketplace.publish(forgekin_id)` 可被调用（可选）。

#### 4.2.2 影响 F038 进化谱系

`ForgekinLineage.append(forgekin_id, parent=null)` 在 ⑥阶段完成后调用，作为谱系起点：

```python
# forgemind/forging/handlers/awakening_promote.py（节选）
await self._lineage_repo.append(
    forgekin_id=state.forgekin_id,
    parent_forgekin_id=None,  # 流水线产出的 Forgekin 是谱系起点
    source_pipeline_id=state.pipeline_id,
)
```

#### 4.2.3 影响 F035 能力融合

②阶段注入的 `CapabilityProfile` 是 F035 能力融合的目标画像，三方 Agent 调用经验最终融合到此画像。

#### 4.2.4 影响 F039 MindCodex可检索知识库

③阶段初始EchoStore可作为MindCodex种子条目，通过 `MindCodex.index(echo_entry_id)` 索引。

### 4.3 跨模块不变量校验

| 不变量 | 校验点 | 校验实现 |
|--------|--------|---------|
| 6 阶段严格顺序 | `ForgingExecutor.advance` | `_STAGE_ORDER.index(current)` + `idx + 1` 推进 |
| ①④⑥审批门 | `handler.requires_operator_approval` | `OperatorApprovalRequest` PENDING/APPROVED 校验 |
| ⑤ Eval 硬门 | `CapabilityVerifyHandler.execute` | `quality_score >= 0.85` 校验，失败触发 `rollback_to(②)` |
| 觉醒阶上限 | `AwakeningPromoteHandler._assert_awakening_within_scope` | `_AWAKENING_RANK[target] <= _AWAKENING_RANK[max]` |
| artifact 解耦 | `ForgingPipelineState.stage_artifacts` | 阶段间通过 `state.stage_artifacts[prev_stage]` 读取 |
| DI 注入 | `ForgingConfigLoader.load_handler_instances` | `di_container.resolve(handler_cls)`，无直接实例化 |
| YAML 配置驱动 | `ForgingConfigLoader.load` | 6 阶段配置全部从 `forging.yaml` 加载 |
| 回滚幂等 | `rollback_to` | `target_idx >= current_idx` 时直接 return |

---

## 5. 详细设计验收

### 5.1 功能验收

- [ ] AC-F-01: `ForgingStage` 枚举含 6 个值，运行时无法新增。
- [ ] AC-F-02: `ForgingExecutor.start(manifest, operator_id)` 返回合法 `pipeline_id`，state 持久化到 F008。
- [ ] AC-F-03: `advance` 严格按 `SPECIES_DEFINE -> CAPABILITY_INJECT -> MEMORY_SEED -> VALUE_ALIGN -> CAPABILITY_VERIFY -> AWAKENING_PROMOTE` 顺序推进。
- [ ] AC-F-04: ①④⑥阶段 `require_operator_approval=true` 时，`advance` 创建 `OperatorApprovalRequest` 并阻塞，状态为 `BLOCKED_ON_APPROVAL`。
- [ ] AC-F-05: operator `approve_stage` 后，状态转为 `RUNNING`，下次 `advance` 推进到下一阶段。
- [ ] AC-F-06: 审批超时（24h）后，状态保持 `BLOCKED_ON_APPROVAL`，记录 `TIMEOUT`。
- [ ] AC-F-07: 审批被拒后，状态转为 `FAILED`，`advance` 抛 `RuntimeError`。
- [ ] AC-F-08: ⑤阶段 `quality_score < 0.85` 时，抛 `CapabilityVerifyFailedError`，自动调用 `rollback_to(CAPABILITY_INJECT)`，`current_stage` 回到 ②，③④⑤artifact 标记 `invalidated`。
- [ ] AC-F-09: 回滚次数累计 `>= 3` 时，状态转为 `FAILED`。
- [ ] AC-F-10: ⑥阶段 `target_awakening_stage > max_awakening_stage` 时，抛 `ValueError`，晋升被拒绝。
- [ ] AC-F-11: 完整流水线完成后，`status=COMPLETED`，所有 6 个 artifact 在 F008 中可查询。
- [ ] AC-F-12: `ForgingConfigLoader.load` 加载 `forging.yaml` 后，6 阶段配置齐全，缺阶段时抛 `ValueError`。
- [ ] AC-F-13: `load_handler_instances` 通过 `importlib` 动态加载 handler 类，依赖通过 DI 容器解析。
- [ ] AC-F-14: `rollback_to` 幂等，重复调用不产生副作用。
- [ ] AC-F-15: `ForgingPipelineState.stage_artifacts` 在每阶段完成后追加 `{stage: artifact_id}`。

### 5.2 性能验收

- [ ] AC-P-01: `start` 延迟 < 200ms。
- [ ] AC-P-02: 单阶段 `advance` 延迟（不含审批等待） < 5s。
- [ ] AC-P-03: ⑤阶段 Eval 延迟 < 60s。
- [ ] AC-P-04: `rollback_to` 延迟 < 500ms。
- [ ] AC-P-05: 完整流水线（无审批等待） < 90s。
- [ ] AC-P-06: 6 个 handler 全部通过 DI 容器解析，单次解析延迟 < 50ms。
- [ ] AC-P-07: `forging.yaml` 加载延迟 < 100ms。

### 5.3 安全验收

- [ ] AC-S-01: ①④⑥阶段未经 operator 批准时，`advance` 不推进到下一阶段。
- [ ] AC-S-02: 觉醒阶越权晋升被拒绝，并写入审计日志。
- [ ] AC-S-03: ⑤阶段 Eval 失败触发回滚，③④⑤artifact 标记 `invalidated` 后无法被读取。
- [ ] AC-S-04: `OperatorApprovalRequest` 含 `approved_by` 字段，所有审批操作可追溯到 operator。
- [ ] AC-S-05: `ForgingExecutor` 不直接操作数据库，所有写入通过 Repository 层。
- [ ] AC-S-06: `ForgingConfigLoader` 不硬编码 handler 类名，全部从 YAML 读取。
- [ ] AC-S-07: `rollback_count` 达到上限后，流水线 `FAILED`，无法继续推进。
- [ ] AC-S-08: 审批超时后，`OperatorApprovalRequest.status=TIMEOUT`，无法被 `approve_stage` 覆盖为 `APPROVED`。

### 5.4 Eval 验收

- [ ] AC-E-01: ⑤阶段 `EvalContract.run` 返回 `quality_score` 字段，类型为 `float`，范围 `[0.0, 1.0]`。
- [ ] AC-E-02: `eval_threshold` 默认 0.85，可由 `forging.yaml` 覆盖。
- [ ] AC-E-03: `quality_score >= eval_threshold` 时，artifact 写入 `verify_report:{report_id}`。
- [ ] AC-E-04: `quality_score < eval_threshold` 时，抛 `CapabilityVerifyFailedError`，触发回滚。
- [ ] AC-E-05: Eval 五问（谁评估/评估什么/何时评估/评估信号/评估后做什么）全部写入 `eval_report`。
- [ ] AC-E-06: Eval 信号回流到 F018，影响Forgekin能力画像可靠性评估。

### 5.5 集成测试点

| 测试 ID | 测试场景 | 期望结果 |
|---------|---------|---------|
| IT-D028-001 | 加载 `forging.yaml`，6 阶段配置齐全 | `ForgingStageConfig` 实例化成功 |
| IT-D028-002 | `forging.yaml` 缺失 `awakening_promote` 阶段 | 抛 `ValueError` |
| IT-D028-003 | `start` + 6 次 `advance` + 3 次 `approve_stage` | `status=COMPLETED`，6 artifact 在 F008 |
| IT-D028-004 | ①阶段不调用 `approve_stage` 直接 `advance` | 状态 `BLOCKED_ON_APPROVAL`，不推进 |
| IT-D028-005 | ⑤阶段 `quality_score=0.80` | 抛 `CapabilityVerifyFailedError`，`current_stage=②`，③④⑤artifact invalidated |
| IT-D028-006 | ⑤阶段失败 3 次后再次失败 | `status=FAILED`，无法继续 `advance` |
| IT-D028-007 | ⑥阶段 `target=A4_PROACTIVE`，`max=A2_DAILY_USE` | 抛 `ValueError`，晋升被拒 |
| IT-D028-008 | 审批 24h+ 后 `advance` | `status=BLOCKED_ON_APPROVAL`，approval.status=TIMEOUT |
| IT-D028-009 | 审批被 operator 拒绝 | `status=FAILED` |
| IT-D028-010 | `rollback_to(②)` 调用 2 次（幂等） | 第 2 次直接 return，`rollback_count=1` |
| IT-D028-011 | ①阶段 SpeciesRegistry 返回 VIRTUAL 形态 | handler 正常执行（形态校验由 F027 接管） |
| IT-D028-012 | DI 容器缺 `SpeciesRegistry` 依赖 | `ForgingConfigLoader.load_handler_instances` 抛 `DIResolutionError` |
| IT-D028-013 | `forging.yaml` 含未知 handler 类名 | `importlib.import_module` 抛 `ImportError` |
| IT-D028-014 | ⑥阶段完成后 `ForgekinLineage.append(parent=null)` 调用 | 谱系起点写入 F038 |
| IT-D028-015 | 完整流水线后 `ForgekinMarketplace.publish` 调用 | Forgekin发布到市场（可选） |
| IT-D028-016 | ⑤阶段 `quality_score=0.85`（边界） | 通过，artifact 写入 |
| IT-D028-017 | ⑤阶段 `quality_score=0.84`（边界下） | 失败，触发回滚 |
| IT-D028-018 | `advance` 在 `COMPLETED` 状态后调用 | 抛 `RuntimeError` |
| IT-D028-019 | `approve_stage` 对未 PENDING 的请求调用 | 抛 `RuntimeError` |
| IT-D028-020 | 6 个 handler 全部通过 DI 注入，无 `SpeciesDefineHandler` 直接实例化 | 代码扫描无 `Handler` 直接调用 |

---

## 6. 引用

- [doc:../spec.md#§3.9]（FR-CORE-009）
- [doc:../spec.md#§2.5]（进化阶/觉醒阶三标注）
- [doc:../arch.md#§3.9]（ForgePipeline 锻造流水线 6 步）
- [doc:../architecture/A028-forging-pipeline.md]（同号架构设计）
- [doc:../features/F028-forging-pipeline.md]（同号 Feature 级 SRS）
- [doc:../features/F026-forgemind-app-layer.md]
- [doc:../features/F027-all-things-spirit-species.md]
- [doc:../features/F001-capability-profile.md]
- [doc:../features/F008-durable-state-surfaces.md]
- [doc:../features/F014-memory-collection.md]
- [doc:../features/F018-eval-contract.md]
- [doc:../features/F035-external-agent-capability-fusion.md]
- [doc:../features/F037-forgemind-marketplace.md]
- [doc:../features/F038-forgemind-lineage.md]
- [doc:../features/F039-mind-codex-searchable.md]
- [doc:../decisions/013-all-things-spirit-mind-vision.md]
- [doc:../design/D026-forgemind-app-layer.md]（ForgeMindPlugin DI 注册）
- [doc:../design/D027-all-things-spirit-species.md]（SpeciesRegistry 调用）
- [doc:../design/D014-memory-collection.md]（EchoStoreRepository.append 契约）
- [doc:../design/D018-eval-contract.md]（EvalContract.run 契约）
- [doc:../design/naming-contract.md]（Forge Nurturing + SoulImprint + 觉醒阶 AwakeningStage）
- [doc:../../../hiclaw/rules.md#第十一部分]
- [doc:../../../hiclaw/rules.md#AI编程优秀实践]（六层 Guardrails + Loop 工程模式）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（6 阶段 StageHandler 实现 + DI 注入 + YAML 配置加载 + 审批门 + Eval 硬门 + 回滚机制详细设计） | 架构师 Forgekin（猫头鹰·鲁班） |
