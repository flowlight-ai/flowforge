"""F048 TeamAct Queue Steer — operator 实时干预 TeamAct 队列执行.

本模块实现 Steer 协议层（F048），让 operator 可以在不破坏 TeamAct 状态机
（F002）的前提下，对正在执行的 TeamAct 队列进行细粒度实时干预。

设计依据：
    - features/F048-teamact-queue-steer.md §2（核心设计）
    - FlowForge SteerCommand 思想来源
    - roleagent.md §2（TeamAct 六步循环 — Steer 的作用对象）
    - ADR 002-collaboration-protocol.md（TeamAct 协作协议）

7 个 SteerAction（§2.3 处理矩阵）：
    - PRIORITY_BOOST: 调整任务在队列中的位置（往前移）
    - INTERRUPT:       中断当前任务，触发 TeamAct Verdict 阶段
    - REQUEUE:         重新入队（移到队尾）
    - REDIRECT:        重定向到其他 agent
    - PAUSE:           暂停队列
    - RESUME:          恢复队列
    - CANCEL:          取消任务

5 个关键不变量（§2.5）：
    - I1: SteerCommand 不可篡改（frozen=True）
    - I2: operator 独占 steer 权限（operator_id 校验）
    - I3: Steer 影响 trace 记录（落盘 JSONL）
    - I4: Steer 不破坏 TeamAct 状态机（非 EMERGENCY 跳过队首）
    - I5: 紧急 steer 可中断任意阶段（EMERGENCY 可作用于队首）

铁律遵守：
    - 铁律 3：依赖通过构造函数注入（config: Optional[dict]）
    - 铁律 5：路径通过 config 注入，不硬编码
    - 铁律 6：async I/O（apply_to_queue / _dispatch / _archive_record）
    - 编程红线 9：使用 Enum + Pydantic 字段组合而非继承
    - 编程红线 11：无硬编码路径/密钥
    - 编程红线 12：不绕过 DI 容器直接实例化

License: MIT
"""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import UTC, datetime
from enum import Enum
from pathlib import Path
from typing import Any

from flowforge.core.tracing import get_logger
from pydantic import BaseModel, ConfigDict, Field

logger = get_logger("flowforge.core.teamact.steer")


# ──────────────────────────────────────────────────────────────────
# 枚举定义
# ──────────────────────────────────────────────────────────────────


class SteerAction(str, Enum):
    """Steer 动作类型.

    对应 F048 §2.3 处理矩阵的 7 种动作：
        PRIORITY_BOOST: 提升任务优先级（前移队列位置）
        INTERRUPT:      中断当前任务（标记 + EMERGENCY 时推进到 VERDICT）
        REQUEUE:        重新入队（移到队尾 + 重置 iteration）
        REDIRECT:       重定向到其他 agent（修改 ball_holder）
        PAUSE:          暂停整个队列（停止 dispatch 新任务）
        RESUME:         恢复队列（清除暂停标志）
        CANCEL:         取消任务（标记 cancelled + 从队列移除）
    """

    PRIORITY_BOOST = "priority_boost"
    INTERRUPT = "interrupt"
    REQUEUE = "requeue"
    REDIRECT = "redirect"
    PAUSE = "pause"
    RESUME = "resume"
    CANCEL = "cancel"


class SteerPriority(str, Enum):
    """Steer 优先级.

    对应 F048 §2.3 优先级矩阵的 5 级：
        LOW:       1 — 非紧急调度
        NORMAL:    2 — 默认调度
        HIGH:      3 — 重要调度
        CRITICAL:  4 — 关键调度
        EMERGENCY: 5 — 紧急干预（I5 可中断原子操作）
    """

    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    CRITICAL = "critical"
    EMERGENCY = "emergency"

    def numeric(self) -> int:
        """返回优先级数值（用于排序比较）."""
        return {
            SteerPriority.LOW: 1,
            SteerPriority.NORMAL: 2,
            SteerPriority.HIGH: 3,
            SteerPriority.CRITICAL: 4,
            SteerPriority.EMERGENCY: 5,
        }[self]


# ──────────────────────────────────────────────────────────────────
# 数据模型
# ──────────────────────────────────────────────────────────────────


class SteerCommand(BaseModel):
    """SteerCommand — operator 实时干预指令（I1 不可篡改）.

    一旦 submit() 写入 _pending，任何字段修改必须新建 SteerCommand
    （可通过 payload["amend_of"] 引用原 command_id）。frozen=True 确保
    运行时 setattr 抛 ValidationError，满足 I1 不变量。

    Attributes:
        command_id: 指令唯一标识（steer-{uuid12}，自动生成）。
        action: Steer 动作类型（7 种枚举之一）。
        priority: Steer 优先级（5 级，默认 NORMAL）。
        target_task_id: 目标任务 ID（必须存在于队列中）。
        target_agent_id: REDIRECT 时的目标Forgekin ID（仅 REDIRECT 必填）。
        reason: operator 必填理由（审计追溯依据，禁止空字符串）。
        operator_id: 发起 operator 标识（必须以 "operator" 开头，I2 校验）。
        payload: 附加数据（如 priority_boost 的 boost_level / redirect 的 capsule）。
        created_at: 创建时间（UTC，自动生成）。
        expires_at: 超时自动失效时间（可选，None 表示永不过期）。
    """

    model_config = ConfigDict(
        frozen=True,  # I1 不变量：完全不可变
        extra="forbid",
        validate_assignment=True,
    )

    command_id: str = Field(
        default_factory=lambda: f"steer-{uuid.uuid4().hex[:12]}",
        description="指令唯一标识",
    )
    action: SteerAction = Field(..., description="Steer 动作类型")
    priority: SteerPriority = Field(
        default=SteerPriority.NORMAL, description="Steer 优先级"
    )
    target_task_id: str = Field(..., description="目标任务 ID")
    target_agent_id: str | None = Field(
        default=None, description="REDIRECT 时的目标Forgekin ID"
    )
    reason: str = Field(..., min_length=1, description="operator 必填理由")
    operator_id: str = Field(..., description="发起 operator 标识")
    payload: dict[str, Any] = Field(
        default_factory=dict, description="附加数据"
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        description="创建时间（UTC）",
    )
    expires_at: datetime | None = Field(
        default=None, description="超时自动失效时间"
    )

    def is_expired(self, now: datetime | None = None) -> bool:
        """检查指令是否已过期.

        Args:
            now: 当前时间（默认 datetime.now(timezone.utc)）。

        Returns:
            True 表示已过期（应被静默丢弃），False 表示仍有效。
        """
        if self.expires_at is None:
            return False
        current = now or datetime.now(UTC)
        return current >= self.expires_at

    def is_emergency(self) -> bool:
        """是否为 EMERGENCY 优先级（I5 紧急中断语义）."""
        return self.priority == SteerPriority.EMERGENCY


class SteerEffect(BaseModel):
    """Steer 执行效果记录（I3 trace 记录）.

    每次 apply_to_queue 完成后产出一条 SteerEffect，与对应 SteerCommand
    一起落盘到 data/teamact/steer_trace.jsonl（append-only）。

    Attributes:
        command_id: 对应的 SteerCommand ID。
        applied: 是否成功应用。
        affected_tasks: 受影响的任务 ID 列表。
        affected_agents: 受影响的Forgekin ID 列表。
        side_effects: 副作用记录（如 emergency_interruption / queue_paused）。
        applied_at: 应用时间（UTC，自动生成）。
        message: 附加消息（失败原因 / 成功摘要）。
    """

    command_id: str = Field(..., description="对应的 SteerCommand ID")
    applied: bool = Field(..., description="是否成功应用")
    affected_tasks: list[str] = Field(
        default_factory=list, description="受影响的任务 ID 列表"
    )
    affected_agents: list[str] = Field(
        default_factory=list, description="受影响的Forgekin ID 列表"
    )
    side_effects: dict[str, Any] = Field(
        default_factory=dict, description="副作用记录"
    )
    applied_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        description="应用时间（UTC）",
    )
    message: str = Field(default="", description="附加消息")


# ──────────────────────────────────────────────────────────────────
# SteerQueue 调度器
# ──────────────────────────────────────────────────────────────────


class SteerQueue:
    """Steer 指令队列 — 接收/校验/应用 operator steer 指令.

    本类是 F048 Steer 协议层的核心调度器，维护两个内部列表：
        - _pending: 待应用的 SteerCommand（FIFO）
        - _applied: 已应用的 (SteerCommand, SteerEffect) 元组（审计追溯）

    以及一个队列级暂停标志：
        - _paused: PAUSE 指令设置，RESUME 清除（不影响当前持球者）

    不变量：
        - I2: 只有 operator 能提交 SteerCommand（submit 前置校验）
        - I3: 每次 apply_to_queue 完成后落盘 trace（_archive_record）
        - I4: 非 EMERGENCY 指令不修改队首任务（_dispatch 内校验）
        - I5: EMERGENCY 指令可作用于队首（触发 VERDICT 阶段）

    Args:
        config: 配置字典（来自 flowforge/config/teamact_steer.yaml）。
            支持字段：
                - max_pending: int — 最大待应用指令数（默认 100）
                - operator_only: bool — I2 开关（默认 True）
                - emergency_can_interrupt_atomic: bool — I5 开关（默认 True）
                - trace_archive.enabled: bool — I3 开关（默认 True）
                - trace_archive.path: str — 归档文件路径（相对路径）
    """

    def __init__(self, config: dict[str, Any] | None = None) -> None:
        self._pending: list[SteerCommand] = []
        self._applied: list[tuple[SteerCommand, SteerEffect]] = []
        self._paused: bool = False
        self._config: dict[str, Any] = config or {}
        self._max_pending: int = int(self._config.get("max_pending", 100))
        self._operator_only: bool = bool(
            self._config.get("operator_only", True)
        )
        self._emergency_can_interrupt: bool = bool(
            self._config.get("emergency_can_interrupt_atomic", True)
        )
        archive_cfg = self._config.get("trace_archive", {}) or {}
        self._archive_enabled: bool = bool(archive_cfg.get("enabled", True))
        self._archive_path: str | None = archive_cfg.get("path")

    # ── 公开属性 ──────────────────────────────────────────────────

    @property
    def is_paused(self) -> bool:
        """队列是否处于暂停状态（PAUSE 指令的效果）."""
        return self._paused

    @property
    def pending_count(self) -> int:
        """待应用指令数."""
        return len(self._pending)

    @property
    def applied_count(self) -> int:
        """已应用指令数."""
        return len(self._applied)

    # ── 提交指令（I2 校验）──────────────────────────────────────

    def submit(self, command: SteerCommand) -> str:
        """提交 steer 指令（I2 校验 operator 权限）.

        Args:
            command: SteerCommand 实例（必须满足 I2/I1 不变量）。

        Returns:
            command_id（用于后续追溯）。

        Raises:
            PermissionError: I2 违反 — operator_id 不以 "operator" 开头。
            ValueError: reason 为空 / max_pending 超限 / 指令已过期。
        """
        # I2 校验：operator 独占 steer 权限
        if self._operator_only and not command.operator_id.startswith(
            "operator"
        ):
            msg = (
                f"I2 只有 operator 能提交 SteerCommand，"
                f"收到 operator_id={command.operator_id}"
            )
            logger.warning(msg)
            raise PermissionError(msg)

        # 容量校验
        if len(self._pending) >= self._max_pending:
            msg = (
                f"SteerQueue 容量超限：_pending={len(self._pending)} "
                f">= max_pending={self._max_pending}"
            )
            logger.warning(msg)
            raise ValueError(msg)

        # 过期校验（静默丢弃，但 submit 阶段直接拒绝更安全）
        if command.is_expired():
            msg = (
                f"SteerCommand 已过期，拒绝提交："
                f"id={command.command_id} expires_at={command.expires_at}"
            )
            logger.info(msg)
            raise ValueError(msg)

        self._pending.append(command)
        logger.info(
            f"SteerCommand 提交: id={command.command_id} "
            f"action={command.action.value} priority={command.priority.value} "
            f"target={command.target_task_id} operator={command.operator_id}"
        )
        return command.command_id

    def list_pending(self) -> list[SteerCommand]:
        """列出待应用的 steer 指令（按 FIFO 顺序）."""
        return list(self._pending)

    def list_applied(
        self, limit: int = 100
    ) -> list[tuple[SteerCommand, SteerEffect]]:
        """列出已应用的 steer 指令（按应用时间倒序，最近 limit 条）.

        Args:
            limit: 返回条数上限（默认 100）。
        """
        if limit <= 0:
            return []
        return list(self._applied[-limit:])

    # ── 应用指令（I4 不破坏状态机）──────────────────────────────

    async def apply_to_queue(self, task_queue: list[Any]) -> SteerEffect:
        """应用下一个 steer 指令到任务队列（I4 不破坏状态机）.

        本方法从 _pending 取出队首指令，调用 _dispatch 分发到对应处理器。
        应用完成后记录到 _applied 并归档（I3）。

        队列语义：
            - task_queue[0] 为当前执行中任务（持球者）
            - task_queue[1:] 为等待中任务
            - I4：非 EMERGENCY 指令不修改 task_queue[0]

        Args:
            task_queue: TeamActState 列表（队首为当前执行中任务）。

        Returns:
            SteerEffect（applied=False 表示无待应用指令或应用失败）。
        """
        if not self._pending:
            return SteerEffect(
                command_id="",
                applied=False,
                message="无待应用指令",
            )

        # PAUSE 状态下不应用新指令（RESUME 除外）
        # 注意：PAUSE/RESUME 是队列级标志，需要在 _dispatch 内特殊处理
        # 这里取出队首指令后由 _dispatch 决定是否应用
        command = self._pending.pop(0)

        # 二次过期校验（submit 到 apply 之间可能已过期）
        if command.is_expired():
            effect = SteerEffect(
                command_id=command.command_id,
                applied=False,
                message=f"指令已过期，丢弃（expires_at={command.expires_at}）",
            )
            self._applied.append((command, effect))
            logger.info(
                f"SteerCommand 过期丢弃: id={command.command_id}"
            )
            await self._archive_record(command, effect)
            return effect

        # 分发到对应处理器
        effect = await self._dispatch(command, task_queue)

        # 记录到已应用列表
        self._applied.append((command, effect))

        # I3 归档
        await self._archive_record(command, effect)

        logger.info(
            f"SteerCommand 应用完成: id={command.command_id} "
            f"applied={effect.applied} affected_tasks={effect.affected_tasks} "
            f"message={effect.message}"
        )
        return effect

    # ── 分发器（7 个分支）──────────────────────────────────────

    async def _dispatch(
        self, command: SteerCommand, task_queue: list[Any]
    ) -> SteerEffect:
        """分发 steer 指令到对应处理器.

        根据 command.action 路由到 7 个 _apply_* 处理器之一。
        处理器内自行实现 I4（非 EMERGENCY 跳过队首）和 I5（EMERGENCY 可中断）。

        Args:
            command: 待应用的 SteerCommand。
            task_queue: TeamActState 列表。

        Returns:
            SteerEffect 执行效果。
        """
        handlers: dict[
            SteerAction,
            Any,
        ] = {
            SteerAction.PRIORITY_BOOST: self._apply_priority_boost,
            SteerAction.INTERRUPT: self._apply_interrupt,
            SteerAction.REQUEUE: self._apply_requeue,
            SteerAction.REDIRECT: self._apply_redirect,
            SteerAction.PAUSE: self._apply_pause,
            SteerAction.RESUME: self._apply_resume,
            SteerAction.CANCEL: self._apply_cancel,
        }
        handler = handlers.get(command.action)
        if handler is None:
            return SteerEffect(
                command_id=command.command_id,
                applied=False,
                message=f"未知 SteerAction: {command.action}",
            )
        return await handler(command, task_queue)

    # ── 1. PRIORITY_BOOST ───────────────────────────────────────

    async def _apply_priority_boost(
        self, command: SteerCommand, task_queue: list[Any]
    ) -> SteerEffect:
        """PRIORITY_BOOST — 调整任务在队列中的位置（往前移）.

        payload["boost_level"]: 前移位数（默认 1）。
        payload["target_position"]: 目标绝对位置（可选，优先于 boost_level）。

        I4：非 EMERGENCY 不能修改队首（target_task_id 不能是 task_queue[0]）。
        """
        target_id = command.target_task_id
        boost_level = int(command.payload.get("boost_level", 1))
        target_position = command.payload.get("target_position")

        # 查找目标任务位置
        idx = self._find_task_index(task_queue, target_id)
        if idx is None:
            return SteerEffect(
                command_id=command.command_id,
                applied=False,
                message=f"目标任务不存在: {target_id}",
            )

        # I4：非 EMERGENCY 不能修改队首
        if idx == 0 and not command.is_emergency():
            return SteerEffect(
                command_id=command.command_id,
                applied=False,
                message=(
                    "I4 非 EMERGENCY 不能 boost 队首任务"
                    f"（队首为执行中任务，target={target_id}）"
                ),
                affected_tasks=[target_id],
                side_effects={"i4_blocked": True},
            )

        # 计算新位置
        if target_position is not None:
            new_idx = max(0, int(target_position))
        else:
            new_idx = max(0, idx - boost_level)

        # 新位置不能等于原位置或越界
        if new_idx >= len(task_queue) or new_idx == idx:
            return SteerEffect(
                command_id=command.command_id,
                applied=False,
                message=(
                    f"boost 无需调整：idx={idx} new_idx={new_idx}"
                ),
                affected_tasks=[target_id],
            )

        # 执行前移（in-place 交换）
        task = task_queue.pop(idx)
        task_queue.insert(new_idx, task)

        affected_agents = self._collect_agents([task])

        return SteerEffect(
            command_id=command.command_id,
            applied=True,
            affected_tasks=[target_id],
            affected_agents=affected_agents,
            side_effects={
                "old_position": idx,
                "new_position": new_idx,
                "boost_level": boost_level,
            },
            message=f"任务 {target_id} 前移：{idx} → {new_idx}",
        )

    # ── 2. INTERRUPT ────────────────────────────────────────────

    async def _apply_interrupt(
        self, command: SteerCommand, task_queue: list[Any]
    ) -> SteerEffect:
        """INTERRUPT — 中断当前任务，触发 TeamAct Verdict 阶段.

        I4：非 EMERGENCY 不能中断队首（执行中任务）。
        I5：EMERGENCY 可中断队首，推进状态机到 VERDICT 阶段。

        对于非队首任务（等待中），直接在 history 中标记 interrupted。
        """
        target_id = command.target_task_id
        idx = self._find_task_index(task_queue, target_id)
        if idx is None:
            return SteerEffect(
                command_id=command.command_id,
                applied=False,
                message=f"目标任务不存在: {target_id}",
            )

        task = task_queue[idx]
        side_effects: dict[str, Any] = {"interrupted": True}

        # 队首任务中断需要 EMERGENCY（I4/I5）
        if idx == 0:
            if not command.is_emergency():
                return SteerEffect(
                    command_id=command.command_id,
                    applied=False,
                    message=(
                        "I4 非 EMERGENCY 不能中断队首执行中任务"
                        f"（target={target_id}）"
                    ),
                    affected_tasks=[target_id],
                    side_effects={"i4_blocked": True},
                )
            if not self._emergency_can_interrupt:
                return SteerEffect(
                    command_id=command.command_id,
                    applied=False,
                    message="I5 紧急中断已被配置禁用",
                    affected_tasks=[target_id],
                    side_effects={"i5_disabled": True},
                )
            # I5：EMERGENCY 推进到 VERDICT 阶段
            advanced_to = self._advance_to_verdict(task)
            side_effects["emergency_interruption"] = True
            side_effects["advanced_to"] = advanced_to
            side_effects["i5_triggered"] = True

        # 在 history 中记录 interrupt 标记
        self._mark_history(task, f"steer_interrupt:{command.command_id}")

        affected_agents = self._collect_agents([task])

        return SteerEffect(
            command_id=command.command_id,
            applied=True,
            affected_tasks=[target_id],
            affected_agents=affected_agents,
            side_effects=side_effects,
            message=(
                f"任务 {target_id} 已中断"
                + ("（EMERGENCY 推进到 VERDICT）" if idx == 0 else "")
            ),
        )

    # ── 3. REQUEUE ──────────────────────────────────────────────

    async def _apply_requeue(
        self, command: SteerCommand, task_queue: list[Any]
    ) -> SteerEffect:
        """REQUEUE — 重新入队（移到队尾 + 重置 iteration）.

        I4：非 EMERGENCY 不能 requeue 队首任务。
        """
        target_id = command.target_task_id
        idx = self._find_task_index(task_queue, target_id)
        if idx is None:
            return SteerEffect(
                command_id=command.command_id,
                applied=False,
                message=f"目标任务不存在: {target_id}",
            )

        # I4：非 EMERGENCY 不能 requeue 队首
        if idx == 0 and not command.is_emergency():
            return SteerEffect(
                command_id=command.command_id,
                applied=False,
                message=(
                    "I4 非 EMERGENCY 不能 requeue 队首执行中任务"
                    f"（target={target_id}）"
                ),
                affected_tasks=[target_id],
                side_effects={"i4_blocked": True},
            )

        task = task_queue.pop(idx)
        old_iteration = getattr(task, "iteration", 0)

        # 重置 iteration 计数（如果 task 有该属性）
        if hasattr(task, "iteration"):
            try:
                task.iteration = 0
            except Exception:
                # frozen 模型可能不允许，跳过
                pass

        # 移到队尾
        task_queue.append(task)

        # 记录到 history
        self._mark_history(task, f"steer_requeue:{command.command_id}")

        affected_agents = self._collect_agents([task])

        return SteerEffect(
            command_id=command.command_id,
            applied=True,
            affected_tasks=[target_id],
            affected_agents=affected_agents,
            side_effects={
                "old_position": idx,
                "new_position": len(task_queue) - 1,
                "old_iteration": old_iteration,
                "new_iteration": 0,
            },
            message=f"任务 {target_id} 移到队尾，iteration 重置",
        )

    # ── 4. REDIRECT ─────────────────────────────────────────────

    async def _apply_redirect(
        self, command: SteerCommand, task_queue: list[Any]
    ) -> SteerEffect:
        """REDIRECT — 重定向到其他 agent（修改 ball_holder）.

        必填字段：command.target_agent_id（新持球者）。
        可选字段：command.payload["capsule"]（交接胶囊，推荐提供）。

        I4：非 EMERGENCY 不能 redirect 队首任务。
        I5：EMERGENCY 可 redirect 队首，立即转交球权。
        """
        target_id = command.target_task_id
        new_agent = command.target_agent_id

        if not new_agent:
            return SteerEffect(
                command_id=command.command_id,
                applied=False,
                message="REDIRECT 必须提供 target_agent_id",
            )

        idx = self._find_task_index(task_queue, target_id)
        if idx is None:
            return SteerEffect(
                command_id=command.command_id,
                applied=False,
                message=f"目标任务不存在: {target_id}",
            )

        task = task_queue[idx]
        old_agent = getattr(task, "ball_holder", None)

        # I4：非 EMERGENCY 不能 redirect 队首
        if idx == 0 and not command.is_emergency():
            return SteerEffect(
                command_id=command.command_id,
                applied=False,
                message=(
                    "I4 非 EMERGENCY 不能 redirect 队首执行中任务"
                    f"（target={target_id}）"
                ),
                affected_tasks=[target_id],
                affected_agents=[old_agent] if old_agent else [],
                side_effects={"i4_blocked": True},
            )

        side_effects: dict[str, Any] = {
            "old_agent": old_agent,
            "new_agent": new_agent,
        }

        # 如果 payload 含 capsule，尝试通过 pass_ball 转交（推荐路径）
        capsule = command.payload.get("capsule")
        if capsule is not None and hasattr(task, "pass_ball"):
            try:
                success = task.pass_ball(new_agent, capsule)
                side_effects["pass_ball_used"] = success
                if not success:
                    return SteerEffect(
                        command_id=command.command_id,
                        applied=False,
                        message="pass_ball 校验失败（capsule 无效或不匹配）",
                        affected_tasks=[target_id],
                        affected_agents=[old_agent] if old_agent else [],
                        side_effects=side_effects,
                    )
            except Exception as e:
                logger.warning(
                    f"pass_ball 异常，回退到直接设置: {e}"
                )
                side_effects["pass_ball_error"] = str(e)
                self._set_ball_holder(task, new_agent)
        else:
            # 直接设置 ball_holder
            self._set_ball_holder(task, new_agent)

        if idx == 0 and command.is_emergency():
            side_effects["i5_triggered"] = True
            side_effects["emergency_redirect"] = True

        # 记录到 history
        self._mark_history(
            task,
            f"steer_redirect:{command.command_id} "
            f"{old_agent}→{new_agent}",
        )

        return SteerEffect(
            command_id=command.command_id,
            applied=True,
            affected_tasks=[target_id],
            affected_agents=[old_agent, new_agent]
            if old_agent
            else [new_agent],
            side_effects=side_effects,
            message=f"任务 {target_id} 球权转交：{old_agent} → {new_agent}",
        )

    # ── 5. PAUSE ────────────────────────────────────────────────

    async def _apply_pause(
        self, command: SteerCommand, task_queue: list[Any]
    ) -> SteerEffect:
        """PAUSE — 暂停整个队列（停止 dispatch 新任务）.

        设置 _paused=True，后续 apply_to_queue 调用时 TeamAct 主循环
        应检查 is_paused 决定是否取出新任务。PAUSE 不影响当前持球者。
        """
        prev_state = self._paused
        self._paused = True

        return SteerEffect(
            command_id=command.command_id,
            applied=True,
            affected_tasks=[],
            affected_agents=[],
            side_effects={
                "prev_paused": prev_state,
                "new_paused": True,
            },
            message=(
                "队列已暂停"
                if not prev_state
                else "队列已处于暂停状态（幂等）"
            ),
        )

    # ── 6. RESUME ───────────────────────────────────────────────

    async def _apply_resume(
        self, command: SteerCommand, task_queue: list[Any]
    ) -> SteerEffect:
        """RESUME — 恢复队列（清除暂停标志）."""
        prev_state = self._paused
        self._paused = False

        return SteerEffect(
            command_id=command.command_id,
            applied=True,
            affected_tasks=[],
            affected_agents=[],
            side_effects={
                "prev_paused": prev_state,
                "new_paused": False,
            },
            message=(
                "队列已恢复"
                if prev_state
                else "队列未处于暂停状态（幂等）"
            ),
        )

    # ── 7. CANCEL ───────────────────────────────────────────────

    async def _apply_cancel(
        self, command: SteerCommand, task_queue: list[Any]
    ) -> SteerEffect:
        """CANCEL — 取消任务（标记 cancelled + 从队列移除）.

        I4：非 EMERGENCY 不能 cancel 队首任务。
        I5：EMERGENCY 可 cancel 队首，立即终止。
        """
        target_id = command.target_task_id
        idx = self._find_task_index(task_queue, target_id)
        if idx is None:
            return SteerEffect(
                command_id=command.command_id,
                applied=False,
                message=f"目标任务不存在: {target_id}",
            )

        task = task_queue[idx]

        # I4：非 EMERGENCY 不能 cancel 队首
        if idx == 0 and not command.is_emergency():
            return SteerEffect(
                command_id=command.command_id,
                applied=False,
                message=(
                    "I4 非 EMERGENCY 不能 cancel 队首执行中任务"
                    f"（target={target_id}）"
                ),
                affected_tasks=[target_id],
                side_effects={"i4_blocked": True},
            )

        side_effects: dict[str, Any] = {
            "cancelled": True,
            "removed_position": idx,
        }
        if idx == 0 and command.is_emergency():
            side_effects["i5_triggered"] = True
            side_effects["emergency_cancel"] = True

        # 记录取消标记到 history（在移除前）
        self._mark_history(
            task,
            f"steer_cancel:{command.command_id} reason={command.reason}",
        )

        # 从队列移除
        task_queue.pop(idx)

        affected_agents = self._collect_agents([task])

        return SteerEffect(
            command_id=command.command_id,
            applied=True,
            affected_tasks=[target_id],
            affected_agents=affected_agents,
            side_effects=side_effects,
            message=f"任务 {target_id} 已取消并移出队列",
        )

    # ── 归档（I3 trace 记录）────────────────────────────────────

    async def _archive_record(
        self, command: SteerCommand, effect: SteerEffect
    ) -> None:
        """归档 SteerCommand + SteerEffect 到 JSONL（I3 不变量）.

        落盘到 config.trace_archive.path（相对路径，由调用方注入绝对路径）。
        归档失败不阻断应用流程，仅记录 ERROR 日志（I3 容错）。

        Args:
            command: 已应用的 SteerCommand。
            effect: 对应的 SteerEffect。
        """
        if not self._archive_enabled or not self._archive_path:
            return

        record = {
            "command": command.model_dump(mode="json"),
            "effect": effect.model_dump(mode="json"),
        }
        line = json.dumps(record, ensure_ascii=False, default=str)

        try:
            # 异步文件 I/O（避免阻塞事件循环）
            await asyncio.to_thread(self._append_line, self._archive_path, line)
        except Exception as e:
            # I3 容错：归档失败不阻断应用
            logger.error(
                f"I3 归档失败（不阻断应用）: path={self._archive_path} "
                f"error={type(e).__name__}: {e}"
            )

    @staticmethod
    def _append_line(path: str, line: str) -> None:
        """同步追加写入一行 JSONL（被 asyncio.to_thread 调用）.

        以 'a' 模式打开（append-only，I2 不变量配套：禁止覆盖）。
        自动创建父目录。
        """
        path_obj = Path(path)
        path_obj.parent.mkdir(parents=True, exist_ok=True)
        with path_obj.open("a", encoding="utf-8") as f:
            f.write(line + "\n")

    # ── 辅助方法 ─────────────────────────────────────────────────

    @staticmethod
    def _find_task_index(
        task_queue: list[Any], target_task_id: str
    ) -> int | None:
        """在队列中查找目标任务的位置索引.

        Args:
            task_queue: TeamActState 列表。
            target_task_id: 目标任务 ID。

        Returns:
            目标任务在队列中的索引（找不到返回 None）。
        """
        for idx, task in enumerate(task_queue):
            task_id = getattr(task, "task_id", None)
            if task_id == target_task_id:
                return idx
        return None

    @staticmethod
    def _collect_agents(tasks: list[Any]) -> list[str]:
        """从任务列表中收集 ball_holder（去重）."""
        agents: list[str] = []
        for task in tasks:
            holder = getattr(task, "ball_holder", None)
            if holder and holder not in agents:
                agents.append(holder)
        return agents

    @staticmethod
    def _mark_history(task: Any, action: str) -> None:
        """在任务的 history 中记录 steer 标记.

        如果 task 有 history 属性且元素支持构造，则追加一条记录。
        否则记录 WARNING 日志（不阻断应用）。
        """
        # 尝试通过 advance() 记录（TeamActState 标准接口）
        if hasattr(task, "advance") and callable(task.advance):
            try:
                task.advance(action=action, evidence="steer")
                return
            except Exception as e:
                logger.warning(
                    f"task.advance() 失败，跳过 history 标记: {e}"
                )

        # 回退：直接操作 history 列表
        history = getattr(task, "history", None)
        if history is None:
            logger.warning(
                f"task 无 history 属性，无法记录 steer 标记: {action}"
            )
            return

        # 尝试构造历史条目（依赖 TeamActState.HistoryEntry）
        try:
            from flowforge.core.teamact.state_machine import HistoryEntry

            entry = HistoryEntry(
                step=getattr(task, "current_step", None),
                action=action,
                evidence="steer",
            )
            history.append(entry)
        except Exception as e:
            logger.warning(
                f"无法构造 HistoryEntry，跳过: {e}"
            )

    @staticmethod
    def _advance_to_verdict(task: Any) -> str:
        """I5 紧急中断 — 推进状态机到 VERDICT 阶段.

        调用 task.advance() 多次，直到 current_step == VERDICT 或超过 6 次（防死循环）。
        不直接跳状态，保留 history 完整性。

        Args:
            task: TeamActState 实例。

        Returns:
            推进后的 current_step.value（理想情况下为 "verdict"）。
        """
        try:
            from flowforge.core.teamact.types import TeamActStep
        except ImportError:
            logger.warning(
                "无法导入 TeamActStep，跳过 advance_to_verdict"
            )
            return str(getattr(task, "current_step", "unknown"))

        target_step = TeamActStep.VERDICT
        max_advances = 6  # 六步循环最多推进 6 次
        for _ in range(max_advances):
            current = getattr(task, "current_step", None)
            if current == target_step:
                break
            if hasattr(task, "advance") and callable(task.advance):
                try:
                    task.advance(
                        action="steer_emergency_interrupt",
                        evidence="i5",
                    )
                except Exception as e:
                    logger.warning(f"advance() 异常: {e}")
                    break
            else:
                break

        final_step = getattr(task, "current_step", None)
        return final_step.value if final_step else "unknown"

    @staticmethod
    def _set_ball_holder(task: Any, new_agent: str) -> None:
        """设置 task.ball_holder（兼容 frozen 与非 frozen 模型）."""
        try:
            task.ball_holder = new_agent
        except Exception:
            # frozen 模型可能拒绝赋值 — 尝试 model_copy
            try:
                # Pydantic v2 frozen 模型不支持原地修改，
                # 这里只能记录到 side_effects，由调用方处理替换
                logger.warning(
                    f"task.ball_holder 不可修改（frozen），"
                    f"new_agent={new_agent} 仅记录到 side_effects"
                )
            except Exception as e:
                logger.error(f"设置 ball_holder 失败: {e}")
