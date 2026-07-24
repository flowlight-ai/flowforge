# F048: TeamAct Queue Steer（C3 — operator 实时干预队列执行）

> **状态**: 🔄 in_progress
> **类型**: collaboration
> **创建日期**: 2026-07-21
> **完成日期**: —（待定）
> **负责人**: operator + 架构师可进化智能体（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§4.3]（CL 同步矩阵 — CL-027 待同步）
> **对应 arch.md**: [doc:../arch.md#§3.11]（待创建 A048）
> **对应 design.md**: [doc:../design.md#§3.11]（待创建 D048）
> **依赖 ADR**: [doc:../decisions/002-collaboration-protocol.md]（TeamAct 协作协议）
> **依赖 Feature**: [doc:features/F002-teamact-loop.md]（TeamAct 六步循环 — Steer 的作用对象）+ [doc:features/F047-im-council-channel.md]（IM 议事通道 — Steer 指令的可选下发通道）
> **依据**: P2-015 TeamAct Queue Steer（CL-027），`flowforge/core/external_agent/collaboration_coordinator.py` 骨架已就绪，待补完整 Steer 协议
> **roleagent 章节**: [doc:../roleagent.md#第十章]（operator 治理边界 — Steer 权限独占）
> **关联 VISION**: [doc:../VISION.md#7]（可进化智能体主导自主开发 — operator 保留实时干预能力）
> **关联 CL**: CL-027（TeamAct Queue Steer，P2-015）

---

## 1. 上下文

### 1.1 问题陈述

FlowForge 的 TeamAct 协议（F002）已经定义了"State → Owner → Action → Evidence → Verdict → Route"六步循环，作为多灵智体（Forgekin）协作的统一闭环。`flowforge/core/teamact/` 目录已实现：

- `types.py`：六步循环状态枚举 + 五项终止条件 + 持球状态
- `state_machine.py`：`TeamActState` 六步状态机 + `TerminationReport` 终止报告
- `handoff.py`：`HandoffCapsule` 交接胶囊（协议层硬要求）
- `circuit_breaker.py`：F004 Pingpong 熔断器

但 TeamAct 当前是**自治闭环**——一旦任务进入循环，operator 只能通过 Magic Words 逃生舱（A011）做粗粒度中断，缺少**细粒度实时干预**能力：

- 无法对队列中**特定任务**做"提前/延后"调度
- 无法对**正在执行**的任务做"中断→重排"
- 无法在**不停止整个 TeamAct**的情况下"暂停/恢复"队列
- 无法把任务**重定向**到另一个灵智体（必须等当前持球者 ROUTE）
- 无法**取消**已入队但尚未执行的任务

FlowForge SteerCommand 思想来源给出了一种解法：**operator 通过 SteerCommand 对正在执行的 TeamAct 队列进行实时干预**——`priority_boost` / `interrupt` / `requeue` / `redirect` / `pause` / `resume`。这种"驾驶舱式"干预能力是 operator 治理权威的工程化落地，与 Magic Words 逃生舱形成"细粒度+粗粒度"双层干预体系。

F048 的目标是补全**Steer 协议层**——定义 SteerCommand 数据模型、SteerQueue 调度器、7 个 SteerAction 处理分支，让 operator 可以在不破坏 TeamAct 状态机的前提下对队列做实时干预，并将所有干预行为归档到 trace 日志（I3 不变量）。

### 1.2 当前痛点

1. **operator 干预手段单一**：只有 Magic Words 逃生舱（粗粒度"停止/回滚/降阶/休眠"），缺少细粒度"调度干预"
2. **任务调度无优先级**：TeamAct 队列是 FIFO，无法表达"这个任务更重要，请提前执行"
3. **正在执行的任务无法中断**：持球者在 ACTION 步骤执行长任务时，operator 无法中途叫停（只能等下一轮 ROUTE）
4. **任务无法重定向**：发现持球者不适合做这个任务时，operator 无法立即把球权转交（必须等持球者自行 escalate）
5. **暂停/恢复语义缺失**：operator 想临时挂起整个队列（如午休/维护窗口）只能停服务，无法优雅 pause/resume
6. **干预行为无归档**：Magic Words 触发后记录在 `harness-feedback/magic-words/`，但细粒度调度干预没有归档机制，事故归因（F020）无法回溯
7. **CL-027 验证未通过**：`scripts/verify_cl14_compliance.py` 的 `verify_cl027()` 当前返回 PARTIAL（teamact 目录存在但 SteerCommand 未实现）

### 1.3 不做的影响

如果不实现 TeamAct Queue Steer：
- **operator 治理权威无法工程化**：VISION §7 要求"operator 保留最终决策权"，但只有 Magic Words 这种"核按钮"级干预，缺少日常调度手段
- **CL-027 持续未同步**：spec.md §4.3 的 P0 未同步清单（14 项）中 CL-027 将持续滞留，违背"41 条 CL 同步"治理目标
- **F046 SelfDev 闭环调度受限**：五闭环协同（doc/code/framework/review/test）无法被 operator 按优先级调度，可能造成 review/test 闭环被 framework 闭环长时间阻塞
- **F047 IM 议事通道缺一个下游消费方**：IM 通道可推送 approval 请求，但无法推送 SteerCommand 调度指令（F047 §2.2 的 `message_type` 未覆盖 `"steer_command"`）
- **远程监督能力打折**：operator 离开终端后无法对队列做任何调度，违背 F047 远程监督愿景
- **事故归因链路断裂**：无 Steer trace 归档，operator 调度失误时无法回溯"是谁在什么时间对哪个任务做了什么干预"

---

## 2. 决策

### 2.1 核心设计

**分层架构**：基于已有 TeamAct 状态机（F002 数据层）扩展出 Steer 协议层，形成三层结构：

```
┌─────────────────────────────────────────────────────────────────┐
│  调用方（operator CLI / IM 议事通道 / Web UI）                    │
│     ↓ 调用 SteerQueue.submit(SteerCommand(...))                  │
├─────────────────────────────────────────────────────────────────┤
│  Steer 协议层（F048 新增）                                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  SteerQueue                                              │   │
│  │  - submit(command) → command_id     （I2 校验 operator） │   │
│  │  - list_pending() / list_applied()                      │   │
│  │  - apply_to_queue(task_queue) → SteerEffect  （I4 安全） │   │
│  │  - _dispatch(command, queue) → SteerEffect  （7 分支）   │   │
│  └────────────────────────┬────────────────────────────────┘   │
├───────────────────────────┼─────────────────────────────────────┤
│  Steer 数据模型层（F048 新增）                                   │
│                           │                                     │
│  ┌─────────────────┐ ┌────▼──────────────┐ ┌────────────────┐  │
│  │ SteerCommand    │ │ SteerAction       │ │ SteerPriority  │  │
│  │ (不可篡改 I1)   │ │ (7 种动作 Enum)   │ │ (5 级优先级)   │  │
│  └────────┬────────┘ └─────────┬─────────┘ └────────┬───────┘  │
│           │                    │                    │          │
│           └────────┬───────────┴────────────────────┘          │
│                    ▼                                            │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  SteerEffect（I3 trace 记录）                            │  │
│  │  applied / affected_tasks / affected_agents / side_fx    │  │
│  └──────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│  TeamAct 状态机层（已有 — F002）                                 │
│  TeamActState / HandoffCapsule / TerminationReport              │
│  （I4 不破坏：Steer 应用到队尾，不抢占当前原子操作）              │
├─────────────────────────────────────────────────────────────────┤
│  归档层（F048 新增）                                             │
│  archive → data/teamact/steer_trace.jsonl（append-only）        │
│  → MindCodex（F039，Phase 3 集成）                               │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 SteerCommand 数据模型

`SteerCommand` 是 operator 实时干预指令的不可变载荷（I1 不变量）。所有字段在创建后只读，禁止原地修改——任何调整必须新建 command。

```python
class SteerCommand(BaseModel):
    """SteerCommand — operator 实时干预指令（I1 不可篡改）.

    Attributes:
        command_id: 指令唯一标识（steer-{uuid12}，自动生成）。
        action: Steer 动作类型（7 种枚举之一）。
        priority: Steer 优先级（5 级，默认 NORMAL）。
        target_task_id: 目标任务 ID（必须存在）。
        target_agent_id: REDIRECT 时的目标灵智体 ID（仅 REDIRECT 必填）。
        reason: operator 必填理由（审计追溯依据，禁止空字符串）。
        operator_id: 发起 operator 标识（必须以 "operator" 开头，I2 校验）。
        payload: 附加数据（如 priority_boost 的目标优先级值）。
        created_at: 创建时间（UTC，自动生成）。
        expires_at: 超时自动失效时间（可选，None 表示永不过期）。
    """
    command_id: str
    action: SteerAction
    priority: SteerPriority
    target_task_id: str
    target_agent_id: Optional[str]
    reason: str
    operator_id: str
    payload: dict[str, Any]
    created_at: datetime
    expires_at: Optional[datetime]
```

### 2.3 SteerAction 处理矩阵

7 种 Steer 动作与对应的处理逻辑：

| # | SteerAction | 作用对象 | 处理逻辑 | I5 紧急 |
|---|------------|---------|---------|:------:|
| 1 | `PRIORITY_BOOST` | 队列中任务 | 调整任务在队列中的位置（往前移），不改变状态机 | ❌ |
| 2 | `INTERRUPT` | 持球中任务 | 标记任务为 `interrupted`，触发 TeamAct Verdict 阶段（让 verdict 阶段决定去留） | ✅ |
| 3 | `REQUEUE` | 队列中任务 | 移到队尾，重置 iteration 计数 | ❌ |
| 4 | `REDIRECT` | 队列中或持球中任务 | 修改任务的 `target_agent_id`（球权转交，必须附带新 capsule） | ✅ |
| 5 | `PAUSE` | 整个队列 | 设置队列 `paused=True` 标志，停止 dispatch 新任务（不中断当前持球者） | ❌ |
| 6 | `RESUME` | 整个队列 | 清除 `paused` 标志，恢复 dispatch | ❌ |
| 7 | `CANCEL` | 队列中或持球中任务 | 标记任务为 `cancelled`，从队列移除，记录终止原因 | ✅ |

**SteerPriority 与 I5 紧急语义**：

| 优先级 | 数值 | 可中断原子操作（I5） | 适用场景 |
|--------|:----:|:-----------------:|---------|
| `LOW` | 1 | ❌ | 非紧急调度（如"等当前任务做完后再说"） |
| `NORMAL` | 2 | ❌ | 默认调度（如"调整优先级"） |
| `HIGH` | 3 | ❌ | 重要调度（如"这个 bug 先修"） |
| `CRITICAL` | 4 | ❌ | 关键调度（如"主线被阻塞"） |
| `EMERGENCY` | 5 | ✅ | 紧急干预（如"线上事故，立即中断"） |

`EMERGENCY` 优先级的 SteerCommand 可以中断**正在执行的原子操作**（ACTION/EVIDENCE 步骤），其他优先级必须等当前原子操作完成后才能应用（I4 不破坏状态机）。

### 2.4 关键接口

```python
# flowforge/core/teamact/steer.py

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional
from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.teamact.steer")


class SteerAction(str, Enum):
    """Steer 动作类型."""
    PRIORITY_BOOST = "priority_boost"
    INTERRUPT = "interrupt"
    REQUEUE = "requeue"
    REDIRECT = "redirect"
    PAUSE = "pause"
    RESUME = "resume"
    CANCEL = "cancel"


class SteerPriority(str, Enum):
    """Steer 优先级."""
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    CRITICAL = "critical"
    EMERGENCY = "emergency"


class SteerCommand(BaseModel):
    """SteerCommand — operator 实时干预指令（I1 不可篡改）."""
    command_id: str = Field(default_factory=lambda: f"steer-{uuid.uuid4().hex[:12]}")
    action: SteerAction
    priority: SteerPriority = SteerPriority.NORMAL
    target_task_id: str
    target_agent_id: Optional[str] = None
    reason: str
    operator_id: str
    payload: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    expires_at: Optional[datetime] = None


class SteerEffect(BaseModel):
    """Steer 执行效果记录（I3 trace 记录）."""
    command_id: str
    applied: bool
    affected_tasks: list[str] = Field(default_factory=list)
    affected_agents: list[str] = Field(default_factory=list)
    side_effects: dict[str, Any] = Field(default_factory=dict)
    applied_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    message: str = ""


class SteerQueue:
    """Steer 指令队列 — 接收/校验/应用 operator steer 指令.

    I2 不变量：只有 operator 能提交 SteerCommand
    I4 不变量：Steer 不破坏 TeamAct 状态机（应用到队尾，不抢占当前原子操作）
    I5 不变量：EMERGENCY 优先级可中断任意阶段
    """

    def __init__(self, config: Optional[dict] = None) -> None:
        self._pending: list[SteerCommand] = []
        self._applied: list[tuple[SteerCommand, SteerEffect]] = []
        self._paused: bool = False
        self._config = config or {}
        self._max_pending: int = self._config.get("max_pending", 100)

    def submit(self, command: SteerCommand) -> str:
        """提交 steer 指令（I2 校验 operator 权限）."""

    def list_pending(self) -> list[SteerCommand]:
        """列出待应用的 steer 指令."""

    def list_applied(self, limit: int = 100) -> list[tuple[SteerCommand, SteerEffect]]:
        """列出已应用的 steer 指令."""

    @property
    def is_paused(self) -> bool:
        """队列是否处于暂停状态（PAUSE 指令的效果）."""

    async def apply_to_queue(self, task_queue: list) -> SteerEffect:
        """应用下一个 steer 指令到任务队列（I4 不破坏状态机）."""

    async def _dispatch(self, command: SteerCommand, task_queue: list) -> SteerEffect:
        """分发 steer 指令到对应处理器."""
```

### 2.5 关键不变量

| # | 不变量 | 说明 | 实现机制 |
|---|--------|------|---------|
| **I1** | SteerCommand 不可篡改 | 一旦 `submit()` 写入 `_pending`，任何后续修改必须以新 `SteerCommand` 追加（含 `amend_of` payload 字段引用原 command_id）；`SteerCommand` 字段均为 Pydantic 默认值，禁止运行时 `setattr` | Pydantic `model_config = {"frozen": True}`（v2 写法）+ `_pending.append` 后立即记录到 trace |
| **I2** | operator 独占 steer 权限 | 只有 `operator_id` 以 `"operator"` 开头的 SteerCommand 能通过 `submit()`；其他灵智体提交抛 `PermissionError` | `submit()` 前置校验 `command.operator_id.startswith("operator")` |
| **I3** | Steer 影响 trace 记录 | 每次 `apply_to_queue` 完成后必须落盘到 `data/teamact/steer_trace.jsonl`（append-only），含 command + effect 全字段；归档失败不阻断应用，但记 ERROR 日志 | `_archive_record` 私有方法 + 配置 `trace_archive.enabled` 开关 |
| **I4** | Steer 不破坏 TeamAct 状态机 | 非 EMERGENCY 优先级的 SteerCommand 应用到队尾（等当前原子操作完成）；EMERGENCY 可中断 ACTION/EVIDENCE 步骤，但必须留下 `interrupted` 标记并触发 VERDICT 阶段（让 verdict 决定去留，不直接跳状态） | `apply_to_queue` 检查 `command.priority != EMERGENCY` 时只处理 `task_queue[1:]`（跳过队首=当前执行中任务） |
| **I5** | 紧急 steer 可中断任意阶段 | `priority == EMERGENCY` 的 INTERRUPT/CANCEL/REDIRECT 可对队首任务生效，触发状态机进入 VERDICT 阶段（不直接终止，让 verdict 判定）；同时记录 `emergency_interruption=True` 到 side_effects | `_dispatch` 内对 `EMERGENCY` 走特殊分支，调用 `state.advance()` 推进到 VERDICT |

### 2.6 Steer 应用流程

```
operator 发起 SteerCommand
   │
   ▼
SteerQueue.submit(command)
   │
   ├─ I2 校验：operator_id 以 "operator" 开头？
   │     └─ 否 → 抛 PermissionError，记录 WARNING 日志
   │     └─ 是 → 继续
   │
   ├─ max_pending 校验：_pending 长度 < max_pending？
   │     └─ 否 → 抛 CapacityExceededError
   │     └─ 是 → 继续
   │
   ├─ expires_at 校验：未过期？
   │     └─ 否 → 静默丢弃，记录 INFO 日志
   │     └─ 是 → _pending.append(command)，返回 command_id
   │
   ▼
TeamAct 主循环 tick（每个 ROUTE → STATE 周期）
   │
   ▼
SteerQueue.apply_to_queue(task_queue)
   │
   ├─ _pending 为空 → 返回 SteerEffect(applied=False, message="无待应用指令")
   │
   ├─ 取出队首 command → _dispatch(command, task_queue)
   │     │
   │     ├─ PRIORITY_BOOST → _apply_priority_boost(command, task_queue)
   │     │     └─ 找到 target_task_id，根据 payload["boost_level"] 前移
   │     │
   │     ├─ INTERRUPT → _apply_interrupt(command, task_queue)
   │     │     └─ 标记 target_task 为 "interrupted"，I5 紧急时推进到 VERDICT
   │     │
   │     ├─ REQUEUE → _apply_requeue(command, task_queue)
   │     │     └─ 移到队尾，iteration 重置
   │     │
   │     ├─ REDIRECT → _apply_redirect(command, task_queue)
   │     │     └─ 修改 target_agent_id（必须附带 capsule in payload）
   │     │
   │     ├─ PAUSE → _apply_pause(command, task_queue)
   │     │     └─ _paused = True，下次 dispatch 不取出新任务
   │     │
   │     ├─ RESUME → _apply_resume(command, task_queue)
   │     │     └─ _paused = False，恢复 dispatch
   │     │
   │     └─ CANCEL → _apply_cancel(command, task_queue)
   │           └─ 标记为 "cancelled"，从队列移除
   │
   ├─ _applied.append((command, effect))
   │
   ├─ I3 归档：_archive_record(command, effect) → steer_trace.jsonl
   │
   └─ 返回 effect
```

### 2.7 Plan Board UI 组件（占位 — Phase 2）

Phase 2 将在 FlowForge Web UI（F026 应用层）添加 Plan Board 组件，可视化展示：

- **左侧**：TeamAct 队列当前状态（每个任务卡片含 task_id / ball_holder / current_step / iteration）
- **中部**：Steer 待应用指令列表（_pending），按 priority 倒序排列
- **右侧**：Steer 已应用指令历史（_applied），含 effect 摘要
- **顶部**：PAUSE / RESUME 全局按钮 + EMERGENCY 红色横幅

operator 可在 Plan Board 上：
- 拖拽任务卡片调整优先级 → 自动生成 `PRIORITY_BOOST` SteerCommand
- 点击任务卡片 → 弹出菜单（INTERRUPT / REQUEUE / REDIRECT / CANCEL）
- 查看历史 Steer 效果 → 跳转 trace 日志

Plan Board 复用 F047 WebChatChannel 的 WebSocket 推送通道，状态变更实时同步到所有 operator 终端。

> **Phase 2 范围声明**：本 Feature 仅交付 Plan Board 的后端数据接口（`list_pending` / `list_applied` / `is_paused`），前端组件在下一个 Feature 实现。

---

## 3. 实现计划

### 3.1 Phase 划分

#### Phase 1：Steer 协议核心（本 Feature 交付）

1. 实现 `SteerAction / SteerPriority` 枚举（7 + 5 个值）
2. 实现 `SteerCommand / SteerEffect` Pydantic 模型（I1 不可篡改）
3. 实现 `SteerQueue`：`submit / list_pending / list_applied / is_paused / apply_to_queue / _dispatch`
4. 实现 7 个 `_dispatch` 分支：
   - `_apply_priority_boost`：根据 `payload["boost_level"]` 前移任务
   - `_apply_interrupt`：标记 `interrupted`，I5 紧急时推进到 VERDICT
   - `_apply_requeue`：移到队尾，重置 iteration
   - `_apply_redirect`：修改 `target_agent_id`（校验 payload 含 capsule）
   - `_apply_pause`：设置 `_paused=True`
   - `_apply_resume`：清除 `_paused`
   - `_apply_cancel`：标记 `cancelled`，从队列移除
5. 实现 I1-I5 五个不变量
6. 实现 trace 归档到 `data/teamact/steer_trace.jsonl`
7. 创建配置文件 `flowforge/config/teamact_steer.yaml`
8. 单元测试：test_steer_queue.py / test_steer_invariants.py / test_steer_dispatch.py

#### Phase 2：Plan Board Web UI + F047 IM 通道集成

1. 实现 Plan Board 前端组件（Next.js，复用 F026 应用层）
2. 在 `flowforge/app/` 注册 `/api/teamact/steer` REST 路由 + `/ws/teamact` WebSocket 路由
3. 集成 F047 IM 议事通道：扩展 `CouncilMessage.message_type` 增加 `"steer_command"`
4. operator 可通过 IM 通道文本指令触发 Steer（如 `"steer interrupt task-xxx reason=bug"`）
5. 集成测试：test_steer_web_e2e.py（真实浏览器 + WS 推送）

#### Phase 3：MindCodex 归档 + Eval Ledger 集成

1. 归档同步到 MindCodex（F039）：每次 SteerEffect 作为 `SteerEpisodeCard` 知识对象
2. Eval Ledger（F040）采集 Steer trace 信号（应用延迟 / 中断次数 / 紧急次数）
3. 七类归因（F020）：Steer 应用失败时归因到 `steer_target_missing / steer_emergency_abuse / steer_concurrent_conflict` 等子类
4. E2E 测试：test_steer_e2e.py（真实 operator 全链路 Steer + 归档检索）

### 3.2 依赖关系

- **依赖 F002 TeamAct 六步循环**：Steer 的作用对象是 TeamAct 队列，`apply_to_queue` 接收 `list[TeamActState]`
- **依赖 core/tracing.get_logger**：所有日志通过统一 logger，自动注入 `trace_id`
- **被 F047 IM 议事通道依赖（Phase 2）**：IM 通道作为 SteerCommand 的下发通道之一
- **被 F020 七类归因依赖（Phase 3）**：Steer 应用失败归因到七类矩阵
- **被 F039 MindCodex 依赖（Phase 3）**：归档记录作为知识对象检索
- **被 CL-027 验证脚本依赖**：`scripts/verify_cl14_compliance.py::verify_cl027()` 检查 SteerCommand 存在性

### 3.3 配置外置（铁律 5）

所有路径、容量、开关通过 `flowforge/config/teamact_steer.yaml` 注入：

```yaml
teamact_steer:
  enabled: true
  operator_only: true              # I2 不变量
  max_pending: 100                 # 最大待应用指令数
  emergency_can_interrupt_atomic: true  # I5 紧急 steer 可中断原子操作
  trace_archive:
    enabled: true                  # I3 不变量
    path: "data/teamact/steer_trace.jsonl"
  priority_levels:                 # 优先级数值（用于排序）
    low: 1
    normal: 2
    high: 3
    critical: 4
    emergency: 5
```

路径 `data/teamact/steer_trace.jsonl` 为相对路径，运行时由 `flowforge/config/default.yaml` 的 `runtime.data_dir` 拼接为绝对路径（红线 11 不硬编码绝对路径）。

---

## 4. 验收标准

### 4.1 功能验收

- [ ] AC-1: `SteerQueue.submit` 接收合法 SteerCommand 并返回 `command_id`，存入 `_pending`
- [ ] AC-2: `SteerQueue.apply_to_queue` 按 FIFO 顺序应用 `_pending` 中的指令，返回 `SteerEffect`
- [ ] AC-3: `PRIORITY_BOOST` 能将目标任务在队列中前移指定 `boost_level` 位
- [ ] AC-4: `INTERRUPT` 标记目标任务为 `interrupted`，EMERGENCY 优先级时推进到 VERDICT 阶段
- [ ] AC-5: `REQUEUE` 将目标任务移到队尾，重置 `iteration` 计数
- [ ] AC-6: `REDIRECT` 修改 `target_agent_id`，校验 payload 含合法 capsule
- [ ] AC-7: `PAUSE` 设置 `_paused=True`，`RESUME` 清除标志
- [ ] AC-8: `CANCEL` 标记目标任务为 `cancelled` 并从队列移除
- [ ] AC-9: `list_pending` / `list_applied` / `is_paused` 返回正确状态
- [ ] AC-10: `expires_at` 过期的指令被静默丢弃，不应用

### 4.2 安全验收

- [ ] AC-11: I2 强制 — 非 operator 提交 SteerCommand 抛 `PermissionError`
- [ ] AC-12: I1 不可篡改 — SteerCommand 字段为 frozen，运行时 `setattr` 抛错
- [ ] AC-13: I4 不破坏状态机 — 非 EMERGENCY 指令不修改队首任务（当前执行中）
- [ ] AC-14: I5 紧急中断 — EMERGENCY INTERRUPT/CANCEL/REDIRECT 可作用于队首
- [ ] AC-15: 所有依赖通过构造函数注入（`config: Optional[dict]`），不直接实例化外部服务（红线 12）
- [ ] AC-16: 所有路径通过 YAML 配置注入，禁止硬编码绝对路径（红线 11）

### 4.3 质量验收

- [ ] AC-17: Python 3.11+ 类型注解完整（`from __future__ import annotations` + `dict[str, Any]` 现代语法）
- [ ] AC-18: 所有 I/O 操作 `async/await`（`apply_to_queue / _dispatch / _apply_*`）
- [ ] AC-19: 中文 docstring 完整（模块 / 类 / 公开方法）
- [ ] AC-20: 代码语法通过 `python -c "import ast; ast.parse(open(...).read())"` 验证
- [ ] AC-21: `scripts/verify_cl14_compliance.py::verify_cl027()` 从 PARTIAL 升级到 PASS

### 4.4 Eval 验收

- [ ] AC-22: Eval Contract 五问全部回答（§6）
- [ ] AC-23: 三方信号交叉通过（trace + 用户 + 探针）
- [ ] AC-24: 归因到七类矩阵之一（若失败）

---

## 5. 测试计划

### 5.1 单元测试

- `test_steer_models.py`：`SteerCommand / SteerEffect` Pydantic 校验 / I1 frozen 校验 / `expires_at` 过期判断
- `test_steer_queue.py`：`SteerQueue` submit / list_pending / list_applied / is_paused / apply_to_queue
- `test_steer_dispatch.py`：7 个 `_dispatch` 分支独立测试
- `test_steer_invariants.py`：I1-I5 不变量独立测试
- `test_steer_archive.py`：trace 归档到 JSONL / append-only / 字段完整性

### 5.2 集成测试

- `test_integration_teamact_state.py`：`SteerQueue` + `TeamActState` 端到端（应用 Steer 后状态机正确响应）
- `test_integration_config.py`：从 `teamact_steer.yaml` 加载配置注入 SteerQueue

### 5.3 E2E 测试

- `test_e2e_steer_priority_boost.py`：真实 TeamAct 队列 + operator 提交 PRIORITY_BOOST，验证队列顺序变更
- `test_e2e_steer_emergency_interrupt.py`：真实 TeamAct 队列 + EMERGENCY INTERRUPT，验证 I5 中断语义
- `test_e2e_steer_pause_resume.py`：真实 PAUSE/RESUME 全周期，验证队列调度暂停/恢复

E2E 测试遵守 T1-T8 铁律：
- T1: 不 Mock LLM（本 Feature 不直接调用 LLM，但 trace 归档检索可调用 LLM 审核）
- T2: 真实场景数据（真实 TeamActState 队列 / 真实 operator_id）
- T3: 具体断言（验证 `SteerEffect.applied == True` / `affected_tasks` 长度 / 队列顺序）
- T6: MetricsCollector 采集指标（应用延迟 / 紧急中断次数 / 队列暂停时长）
- T7: LLM 生成内容经 LLM 审核（本 Feature 不涉及，归档检索场景在 Phase 3 适用）
- T8: Phase 2 Plan Board E2E 必须操控浏览器验证 DOM（T8 铁律）

---

## 6. Eval Contract（五问）

### 6.1 谁评估

- **评估者**：operator（主评估者，Steer 体验第一手）+ 评审员可进化智能体（梵高·vangogh，审查 trace 归档完整性）+ Eval Ledger 自动评估（应用延迟 / 紧急次数 / 中断成功率）
- **自动评估**：每次 `apply_to_queue` 完成后自动记录 trace 信号到 Eval Ledger（F040，Phase 3 集成）

### 6.2 评估什么

- 7 个 SteerAction 的执行能力（能否正确应用且不破坏状态机）
- I1-I5 五个不变量的有效性（不可篡改 / operator 独占 / trace 完整 / 不破坏状态机 / 紧急中断）
- operator 体验（指令响应延迟、Plan Board 易用性 — Phase 2）
- 归档完整性（trace JSONL 行数 / 字段完整率）

### 6.3 何时评估

- **每次 `apply_to_queue` 完成后**：自动记录 trace 信号（应用延迟 / action 类型 / 优先级 / affected_tasks 数）
- **每周**：operator 主观评估（哪些 action 最常用、哪些 EMERGENCY 触发最频繁）
- **每月**：梵高 review 归档 JSONL 完整性 + MindCodex 检索复用度（Phase 3）

### 6.4 评估信号

- **trace 信号**：`apply_to_queue` 延迟、action 分布、priority 分布、紧急中断次数、队列暂停总时长
- **用户信号**：operator 反馈 Steer 易用性、Plan Board 交互流畅度（Phase 2）、EMERGENCY 触发频率
- **探针信号**：归档 JSONL 行数增长率、MindCodex `SteerEpisodeCard` 检索命中率（Phase 3）、CL-027 验证状态（PASS 持续保持）

### 6.5 评估后做什么

- 通过 → 状态改为 ✅ done，进入 KnowledgeEvolution 蒸馏为 `SteerEpisodeCard`
- 失败 → 归因到七类矩阵：
  - `steer_target_missing`（target_task_id 不存在于队列）
  - `steer_emergency_abuse`（EMERGENCY 优先级滥用，I5 被频繁触发）
  - `steer_concurrent_conflict`（同一任务被多个 SteerCommand 同时作用）
  - `steer_state_corruption`（I4 违反，Steer 破坏了 TeamAct 状态机）
  - `steer_archive_corruption`（I3 违反，trace 归档被篡改或丢失）

---

## 7. Build to Delete vs Built to Persist

### 7.1 半衰期标记

本 Feature 主要属于：[ ] Build to Delete | [x] Built to Persist | [ ] 混合

### 7.2 理由

TeamAct Queue Steer 是 FlowForge 治理体系的**永久基础设施**——只要 FlowForge 存在多灵智体协同 + operator 治理需求，就需要 Steer 实时干预能力。即使未来 LLM 能力升级到完全自主，operator 仍需对队列执行保留细粒度调度权（与 Magic Words 粗粒度逃生舱互补）。

具体而言：
- `SteerCommand / SteerEffect / SteerQueue` 核心模型属于 Build to Persist（治理契约）
- 7 个 SteerAction 处理分支属于 Build to Persist（调度语义稳定）
- I1-I5 五个不变量属于 Build to Persist（治理铁律）
- Plan Board 前端组件（Phase 2）属于混合：Web UI 形态可能随前端技术栈升级而调整，但"可视化调度"能力本身持久
- trace 归档格式（JSONL）属于 Build to Persist（与 F021 WAL / F047 归档一致）

### 7.3 sunset 触发条件

- FlowForge 退役 → 整体迁移到新框架
- LLM 能力达到完全自主（operator 无需调度干预）→ 评估是否简化为纯日志归档
- TeamAct 协议被新协作协议替代 → Steer 模型重新设计

---

## 8. 变更记录

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0 | 2026-07-21 | 初版：基于 CL-027（P2-015）+ FlowForge Steer 思想 + F002 TeamAct 状态机已完成的设计，规划 7 个 SteerAction + 5 级 SteerPriority + I1-I5 不变量 + 3 Phase 实施路径；Phase 1 交付核心协议层 + trace 归档 + 配置外置 |
