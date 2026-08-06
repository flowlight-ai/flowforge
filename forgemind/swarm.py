"""F049 Agent Swarm — 5 Forgekin协同协议.

本模块实现 Swarm 协议层（F049），让 5 个Forgekin（文心/夏洛克/鲁班/梵高/达芬奇）
通过 SwarmCoordinator 全局唯一调度器协同工作：

    - 任务分发：capability-based routing（按 capability_profile 分发，I3 能力匹配）
    - 任务回收：heartbeat + timeout + reassign（I4 心跳超时回收，30s 无心跳自动 reassign）
    - 能力互补：blind_spots 自动找搭档（_find_complement_agent）
    - 跨厂商独立：review 任务必须用与 author 不同厂商（I5 跨厂商独立）
    - no-self-review：reviewer 不能审自己的产物（I6）

设计依据：
    - features/F049-agent-swarm.md §2（核心设计）
    - FlowForge 5 agent sweet spot 工程模式
    - roleagent.md §10（5 agent sweet spot — FlowForge 工程模式）
    - roleagent.md §9（no-self-review 铁律）
    - ADR 002-collaboration-protocol.md（TeamAct 协作协议）
    - ADR 006-external-agent-integration.md（三方 Agent 集成）

5 个Forgekin能力画像（详见 config/agent_swarm.yaml）：
    - wenxin  (trae)   : doc_generation / doc_review / format_check / frontmatter_check
    - sherlock(trae)   : code_generation / bug_fixing / refactoring / test_writing
    - luban   (trae)   : architecture_design / adr_drafting / config_adjustment / dependency_analysis
    - vangogh (claude) : code_review / doc_review / quality_gate / push_back  ← 跨厂商
    - davinci (trae)   : test_generation / test_execution / coverage_analysis / regression_test

6 个关键不变量（§2.5）：
    - I1: 单一调度器（SwarmCoordinator 全局唯一）
    - I2: 任务不丢失（提交必有 trace）
    - I3: 能力匹配（agent.capability_profile 必须覆盖任务需求）
    - I4: 心跳超时回收（agent 30s 无心跳自动 reassign）
    - I5: 跨厂商独立（review 任务必须用与 author 不同厂商）
    - I6: no-self-review（reviewer 不能审自己的产物）

铁律遵守：
    - 铁律 3：依赖通过构造函数注入（config: Optional[dict]）
    - 铁律 5：路径通过 config 注入，不硬编码
    - 铁律 6：async I/O（dispatch / heartbeat / check_timeouts / run_continuously）
    - 编程红线 9：使用 Enum + Pydantic 字段组合而非继承
    - 编程红线 11：无硬编码路径/密钥
    - 编程红线 12：不绕过 DI 容器直接实例化

License: MIT
"""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import UTC, datetime, timedelta
from enum import Enum
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.forgemind.swarm")


# ──────────────────────────────────────────────────────────────────
# 枚举定义
# ──────────────────────────────────────────────────────────────────


class SwarmTaskStatus(str, Enum):
    """Swarm 任务状态.

    对应 F049 §2.4 关键接口的 7 状态枚举：
        PENDING:    待分配（已提交，等待 dispatch）
        ASSIGNED:   已分配（dispatch 已选定 agent，等待 agent 开始执行）
        RUNNING:    执行中（agent 已通过 heartbeat 上报进度）
        COMPLETED:  已完成（agent 上报完成，result 已填）
        FAILED:     失败（reassign 超过 MAX_RETRIES 或 agent 上报失败）
        REASSIGNED: 被重新分配（心跳超时，retry_count += 1 后重新入队）
        CANCELLED:  已取消（operator 通过 F048 SteerCommand CANCEL 取消）
    """

    PENDING = "pending"
    ASSIGNED = "assigned"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    REASSIGNED = "reassigned"
    CANCELLED = "cancelled"


class SwarmPriority(str, Enum):
    """Swarm 任务优先级（用于 dispatch 排序）."""

    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    CRITICAL = "critical"

    @property
    def weight(self) -> int:
        """优先级权重（数值越大越优先分发）."""
        return {"low": 1, "normal": 2, "high": 3, "critical": 4}[self.value]


# ──────────────────────────────────────────────────────────────────
# 数据模型
# ──────────────────────────────────────────────────────────────────


class SwarmTask(BaseModel):
    """Swarm 任务 — submit_task 的载荷.

    Attributes:
        task_id: 任务唯一标识（swarm-{uuid12}，自动生成）.
        title: 任务标题（operator 可读）.
        description: 任务描述（含目标、上下文、约束）.
        required_capabilities: 需要的能力清单（I3 能力匹配依据）.
        preferred_agent_id: 优先分配的 agent（可选，dispatch 时优先考虑）.
        assigned_agent_id: 实际分配到的 agent（dispatch 后填入）.
        status: 任务状态（SwarmTaskStatus 枚举）.
        priority: 优先级（low/normal/high/critical，默认 normal）.
        context: 附加上下文（含 author_agent_id / author_vendor 等 I5/I6 校验字段）.
        created_at: 创建时间（UTC，自动生成）.
        assigned_at: 分配时间（dispatch 时填入）.
        started_at: 开始执行时间（首次 heartbeat 时填入）.
        completed_at: 完成时间（agent 上报完成时填入）.
        heartbeat_at: 最近一次心跳时间（heartbeat 时更新）.
        result: 任务结果（agent 上报完成时填入）.
        failure_reason: 失败原因（FAILED 时填入）.
        retry_count: 已重试次数（reassign 时 +1）.
        max_retries: 最大重试次数（默认 3，I4 不变量）.
    """

    task_id: str = Field(default_factory=lambda: f"swarm-{uuid.uuid4().hex[:12]}")
    title: str
    description: str
    required_capabilities: list[str]
    preferred_agent_id: str | None = None
    assigned_agent_id: str | None = None
    status: SwarmTaskStatus = SwarmTaskStatus.PENDING
    priority: str = "normal"
    context: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    assigned_at: datetime | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    heartbeat_at: datetime | None = None
    result: dict[str, Any] = Field(default_factory=dict)
    failure_reason: str = ""
    retry_count: int = 0
    max_retries: int = 3


class AgentHeartbeat(BaseModel):
    """Agent 心跳 — heartbeat 方法的载荷（I4 心跳超时回收依据）.

    Attributes:
        agent_id: 发送心跳的 agent ID.
        task_id: 当前正在执行的任务 ID（idle 时为 None）.
        timestamp: 心跳时间戳（UTC，自动生成）.
        status: agent 状态（idle/busy/error）.
        progress: 任务进度（0.0-1.0，agent 自评）.
    """

    agent_id: str
    task_id: str | None = None
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))
    status: str = "idle"
    progress: float = 0.0


class SwarmDispatchRecord(BaseModel):
    """Swarm 调度记录 — I2 trace 记录（落盘到 swarm_trace.jsonl）.

    每次 dispatch / reassign / complete / fail 都产生一条记录.

    Attributes:
        record_id: 记录唯一标识（swarm-rec-{uuid8}）.
        task_id: 对应的任务 ID.
        agent_id: 分配到的 agent ID（reassign 时为新 agent）.
        action: 调度动作（dispatch / reassign / complete / fail / cancel）.
        dispatched_at: 调度时间（UTC）.
        reassigned_from: reassign 时的原 agent ID（仅 reassign 动作）.
        reason: 调度原因（如 "heartbeat_timeout" / "agent_completed"）.
    """

    record_id: str = Field(default_factory=lambda: f"swarm-rec-{uuid.uuid4().hex[:8]}")
    task_id: str
    agent_id: str
    action: str  # "dispatch" / "reassign" / "complete" / "fail" / "cancel"
    dispatched_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    reassigned_from: str | None = None
    reason: str = ""


# ──────────────────────────────────────────────────────────────────
# SwarmCoordinator 核心类
# ──────────────────────────────────────────────────────────────────


class SwarmCoordinator:
    """Swarm 协调器 — 5 Forgekin协同调度（I1 单一调度器）.

    职责：
        - 任务分发（capability-based routing，I3 能力匹配）
        - 心跳监控（I4 超时回收，默认 30s）
        - 能力互补（blind_spots 自动找搭档）
        - 跨厂商独立（I5/I6 review 任务路由到不同厂商）

    不变量（详见 F049 §2.5）：
        - I1: 单一调度器 — 全局唯一，禁止Forgekin之间直接派发任务
        - I2: 任务不丢失 — submit_task 必立即写入 _tasks + 落盘 trace
        - I3: 能力匹配 — dispatch 必须把任务路由给能力匹配的 agent
        - I4: 心跳超时回收 — 30s 无心跳自动 reassign，最多 3 次
        - I5: 跨厂商独立 — cross_vendor_required 中的能力必须跨厂商
        - I6: no-self-review — reviewer 不能审自己的产物

    使用示例：
        >>> coordinator = SwarmCoordinator()
        >>> coordinator.register_agent("forgemind:wenxin",
        ...     ["doc_generation", "doc_review"], vendor="trae")
        >>> task = SwarmTask(
        ...     title="写 F049 文档",
        ...     description="...",
        ...     required_capabilities=["doc_generation"],
        ... )
        >>> task_id = coordinator.submit_task(task)
        >>> dispatched = asyncio.run(coordinator.dispatch())
    """

    HEARTBEAT_TIMEOUT_SECONDS: float = 30.0  # I4 心跳超时
    MAX_RETRIES: int = 3  # 最大重试次数（I4）

    def __init__(self, config: dict[str, Any] | None = None) -> None:
        """初始化 SwarmCoordinator.

        Args:
            config: 可选配置字典（铁律 3：依赖通过构造函数注入）.
                支持字段：
                    - heartbeat_timeout_seconds: float — 心跳超时阈值（默认 30.0）
                    - max_retries: int — 最大重试次数（默认 3）
                    - dispatch_interval_seconds: float — 调度循环间隔（默认 5.0）
                    - cross_vendor_required: list[str] — 跨厂商能力清单
                    - trace_archive_path: str — trace 归档路径（相对路径）
                    - agents: dict — agent 能力画像（可从 YAML 加载）
        """
        self._config: dict[str, Any] = config or {}
        # 允许通过 config 覆盖默认值（铁律 5：不硬编码）
        self._heartbeat_timeout: float = float(
            self._config.get("heartbeat_timeout_seconds", self.HEARTBEAT_TIMEOUT_SECONDS)
        )
        self._max_retries: int = int(self._config.get("max_retries", self.MAX_RETRIES))
        self._dispatch_interval: float = float(
            self._config.get("dispatch_interval_seconds", 5.0)
        )
        self._cross_vendor_required: set[str] = set(
            self._config.get("cross_vendor_required", ["code_review", "doc_review"])
        )
        # 相对路径（红线 11：不硬编码绝对路径，由调用方拼接 data_dir）
        self._trace_archive_path: str = self._config.get(
            "trace_archive_path", "data/forgemind/swarm_trace.jsonl"
        )

        # 内部状态
        self._agents: dict[str, dict[str, Any]] = {}  # agent_id -> {capabilities, vendor, ...}
        self._tasks: dict[str, SwarmTask] = {}  # task_id -> SwarmTask
        self._heartbeats: dict[str, AgentHeartbeat] = {}  # agent_id -> latest heartbeat
        self._lock: asyncio.Lock = asyncio.Lock()
        self._running: bool = False  # run_continuously 运行标志

        # 若 config 含 agents 画像，自动注册（便利方法）
        agents_config = self._config.get("agents")
        if isinstance(agents_config, dict):
            for agent_id, agent_info in agents_config.items():
                # 兼容 forgekin_id 前缀（agent_swarm.yaml 中是短名，运行时可能是 forgemind:xxx）
                full_id = agent_id if ":" in agent_id else f"forgemind:{agent_id}"
                self.register_agent(
                    full_id,
                    capabilities=list(agent_info.get("capabilities", [])),
                    vendor=agent_info.get("vendor", "unknown"),
                )

    # ── Agent 注册 ──────────────────────────────────────────────

    def register_agent(
        self,
        agent_id: str,
        capabilities: list[str],
        vendor: str = "unknown",
    ) -> None:
        """注册 agent 到 swarm（含能力画像 + 厂商标识）.

        Args:
            agent_id: agent 唯一标识（如 "forgemind:wenxin"）.
            capabilities: 能力清单（如 ["doc_generation", "doc_review"]）.
            vendor: LLM 厂商标识（如 "trae" / "claude"），I5 跨厂商过滤依据.

        Note:
            - 重复注册同一 agent_id 将覆盖原有画像（支持热更新能力）
            - capabilities 为空列表时记 WARNING 但不拒绝（agent 仅作 idle 接收方）
        """
        if not agent_id:
            raise ValueError("agent_id 不能为空")
        if not isinstance(capabilities, list):
            raise TypeError("capabilities 必须是 list[str]")

        self._agents[agent_id] = {
            "agent_id": agent_id,
            "capabilities": list(capabilities),
            "vendor": vendor,
            "registered_at": datetime.now(UTC),
        }
        # 初始化 idle 心跳（避免 check_timeouts 误判未注册 agent）
        if agent_id not in self._heartbeats:
            self._heartbeats[agent_id] = AgentHeartbeat(
                agent_id=agent_id, status="idle"
            )

        if not capabilities:
            logger.warning(
                "agent %s 注册时 capabilities 为空（仅作 idle 接收方）",
                agent_id,
            )

        logger.info(
            "SwarmCoordinator 注册 agent: id=%s vendor=%s capabilities=%d 项",
            agent_id,
            vendor,
            len(capabilities),
        )

    # ── 任务提交（I2 提交必有 trace）────────────────────────────

    def submit_task(self, task: SwarmTask) -> str:
        """提交任务到 swarm（I2 提交必有 trace）.

        Args:
            task: SwarmTask 实例（task_id 已自动生成）.

        Returns:
            task_id: 任务唯一标识（与 task.task_id 一致）.

        不变量：
            - I2: 同步写入 _tasks 字典 + 异步落盘 trace（archive 失败不阻断 submit）
        """
        if not task.title or not task.description:
            raise ValueError("SwarmTask.title / description 不能为空")
        if not task.required_capabilities:
            raise ValueError("SwarmTask.required_capabilities 不能为空")

        # I2: 同步写入 _tasks 字典（任务不丢失）
        self._tasks[task.task_id] = task

        # I2: 落盘 trace（submit 动作）
        record = SwarmDispatchRecord(
            task_id=task.task_id,
            agent_id="",  # submit 时还未分配
            action="submit",
            reason=f"required_capabilities={task.required_capabilities}",
        )
        # archive 失败不阻断 submit（I2 弱保证：内存写入是强保证，归档是弱保证）
        try:
            self._archive_record(record)
        except Exception as exc:  # noqa: BLE001 — 归档失败不阻断主流程
            logger.error(
                "task %s 归档失败（I2 弱保证，不阻断 submit）: %s",
                task.task_id,
                exc,
            )

        logger.info(
            "SwarmCoordinator 接收任务: id=%s title=%r priority=%s required=%s",
            task.task_id,
            task.title,
            task.priority,
            task.required_capabilities,
        )
        return task.task_id

    # ── 任务分发（I3 capability-based routing）─────────────────

    async def dispatch(self) -> list[str]:
        """分发待处理任务（capability-based routing，I3 能力匹配）.

        Returns:
            分配成功的 task_id 列表（按 priority 倒序处理后）.

        不变量：
            - I3: 必须把任务路由给 capabilities ⊇ required_capabilities 的 agent
            - I5: cross_vendor_required 中的能力必须跨厂商
            - I6: reviewer 不能审自己的产物

        流程：
            1. 收集所有 PENDING / REASSIGNED 状态的任务
            2. 按 priority 倒序排序（critical > high > normal > low）
            3. 对每个任务调用 _find_capable_agent 找最合适的 agent
            4. 找到则更新 task 状态为 ASSIGNED + 记录 trace
            5. 未找到则尝试 _find_complement_agent 推荐搭档（任务保持 PENDING）
        """
        async with self._lock:
            # 收集待分发任务（PENDING + REASSIGNED 都可重新分配）
            pending_tasks = [
                t
                for t in self._tasks.values()
                if t.status in (SwarmTaskStatus.PENDING, SwarmTaskStatus.REASSIGNED)
            ]
            if not pending_tasks:
                return []

            # 按 priority 倒序排序（critical 优先）
            def priority_weight(task: SwarmTask) -> int:
                try:
                    return SwarmPriority(task.priority).weight
                except ValueError:
                    return SwarmPriority.NORMAL.weight

            pending_tasks.sort(key=priority_weight, reverse=True)

            dispatched_ids: list[str] = []
            for task in pending_tasks:
                agent_id = self._find_capable_agent(task)
                if agent_id is None:
                    # 未找到完全匹配的 agent，尝试能力互补推荐
                    complement = self._try_find_complements(task)
                    if complement:
                        task.context["complement_agents"] = complement
                        logger.warning(
                            "task %s 无完全匹配 agent，已推荐搭档: %s",
                            task.task_id,
                            complement,
                        )
                    else:
                        logger.warning(
                            "task %s 无能力匹配 agent，保持 PENDING（capabilities=%s）",
                            task.task_id,
                            task.required_capabilities,
                        )
                    continue

                # 找到 agent，更新任务状态
                old_agent_id = task.assigned_agent_id
                task.assigned_agent_id = agent_id
                task.status = SwarmTaskStatus.ASSIGNED
                task.assigned_at = datetime.now(UTC)
                # REASSIGNED → ASSIGNED 时保留 retry_count（不重置）
                # 重置 heartbeat_at 等待新 agent 上报
                task.heartbeat_at = None
                task.started_at = None

                # I2: 落盘 dispatch trace
                record = SwarmDispatchRecord(
                    task_id=task.task_id,
                    agent_id=agent_id,
                    action="dispatch",
                    reassigned_from=old_agent_id,
                    reason=f"capabilities_match (priority={task.priority})",
                )
                try:
                    self._archive_record(record)
                except Exception as exc:  # noqa: BLE001
                    logger.error(
                        "task %s dispatch 归档失败（I2 弱保证）: %s",
                        task.task_id,
                        exc,
                    )

                dispatched_ids.append(task.task_id)
                logger.info(
                    "SwarmCoordinator 分发任务: task=%s → agent=%s (priority=%s)",
                    task.task_id,
                    agent_id,
                    task.priority,
                )

            return dispatched_ids

    # ── 心跳上报（I4 心跳监控）──────────────────────────────────

    async def heartbeat(
        self,
        agent_id: str,
        task_id: str | None = None,
        progress: float = 0.0,
        status: str = "busy",
    ) -> None:
        """agent 发送心跳（I4 心跳上报）.

        Args:
            agent_id: 发送心跳的 agent ID.
            task_id: 当前正在执行的任务 ID（idle 时为 None）.
            progress: 任务进度（0.0-1.0）.
            status: agent 状态（idle/busy/error，默认 busy）.

        不变量：
            - I4: 更新 _heartbeats[agent_id]，check_timeouts 据此判断是否超时
            - 若 task_id 不为 None，同时更新对应 task.heartbeat_at / started_at / status

        Note:
            - 未注册的 agent 发送心跳时自动注册（vendor="unknown"），并记 WARNING
            - progress 超出 [0.0, 1.0] 范围时自动截断
        """
        if not agent_id:
            raise ValueError("agent_id 不能为空")

        # 自动注册未注册 agent（容错）
        if agent_id not in self._agents:
            logger.warning(
                "未注册 agent %s 发送心跳，自动注册（vendor=unknown）",
                agent_id,
            )
            self.register_agent(agent_id, capabilities=[], vendor="unknown")

        # 截断 progress 到 [0.0, 1.0]
        progress = max(0.0, min(1.0, float(progress)))

        async with self._lock:
            now = datetime.now(UTC)
            self._heartbeats[agent_id] = AgentHeartbeat(
                agent_id=agent_id,
                task_id=task_id,
                timestamp=now,
                status=status,
                progress=progress,
            )

            # 若 task_id 不为 None，更新对应 task 的心跳字段
            if task_id is not None and task_id in self._tasks:
                task = self._tasks[task_id]
                # 首次心跳时将状态从 ASSIGNED 推进到 RUNNING
                if task.status == SwarmTaskStatus.ASSIGNED:
                    task.status = SwarmTaskStatus.RUNNING
                    task.started_at = now
                task.heartbeat_at = now

                # 进度达 1.0 视为完成
                if progress >= 1.0 and task.status == SwarmTaskStatus.RUNNING:
                    task.status = SwarmTaskStatus.COMPLETED
                    task.completed_at = now
                    task.result = task.result or {"progress": progress}
                    # I2: 落盘 complete trace
                    record = SwarmDispatchRecord(
                        task_id=task_id,
                        agent_id=agent_id,
                        action="complete",
                        reason=f"progress={progress}",
                    )
                    try:
                        self._archive_record(record)
                    except Exception as exc:  # noqa: BLE001
                        logger.error(
                            "task %s complete 归档失败: %s", task_id, exc
                        )
                    logger.info(
                        "SwarmCoordinator 任务完成: task=%s agent=%s",
                        task_id,
                        agent_id,
                    )

    # ── 超时检测（I4 心跳超时回收）──────────────────────────────

    async def check_timeouts(self) -> list[str]:
        """检查超时任务并 reassign（I4 心跳超时回收）.

        Returns:
            被 reassign 的 task_id 列表.

        不变量：
            - I4: ASSIGNED/RUNNING 任务 30s（HEARTBEAT_TIMEOUT_SECONDS）无心跳自动 reassign
            - I4: reassign 最多 MAX_RETRIES 次（3 次），超过则 FAILED

        判定逻辑：
            - task.status in (ASSIGNED, RUNNING) 且：
              - task.heartbeat_at 距 now() > 30s（有心跳但超时），OR
              - task.assigned_at 距 now() > 30s 且 task.heartbeat_at is None（从未心跳）
        """
        async with self._lock:
            now = datetime.now(UTC)
            timeout_threshold = now - timedelta(seconds=self._heartbeat_timeout)

            reassigned_ids: list[str] = []
            for task in self._tasks.values():
                if task.status not in (SwarmTaskStatus.ASSIGNED, SwarmTaskStatus.RUNNING):
                    continue
                if task.assigned_agent_id is None:
                    continue

                # 判定超时
                is_timeout = False
                timeout_reason = ""

                if task.heartbeat_at is not None:
                    if task.heartbeat_at < timeout_threshold:
                        is_timeout = True
                        timeout_reason = (
                            f"heartbeat_timeout (last={task.heartbeat_at.isoformat()}, "
                            f"threshold={self._heartbeat_timeout}s)"
                        )
                else:
                    # 从未心跳，检查 assigned_at
                    if task.assigned_at is not None and task.assigned_at < timeout_threshold:
                        is_timeout = True
                        timeout_reason = (
                            f"no_heartbeat_since_assigned (assigned={task.assigned_at.isoformat()}, "
                            f"threshold={self._heartbeat_timeout}s)"
                        )

                if not is_timeout:
                    continue

                old_agent_id = task.assigned_agent_id
                task.retry_count += 1

                # I4: 超过 MAX_RETRIES 则 FAILED
                if task.retry_count > self._max_retries:
                    task.status = SwarmTaskStatus.FAILED
                    task.failure_reason = (
                        f"max_retries_exceeded ({task.retry_count - 1} 次 reassign 后仍超时; "
                        f"最后原因: {timeout_reason})"
                    )
                    task.assigned_agent_id = None
                    # I2: 落盘 fail trace
                    record = SwarmDispatchRecord(
                        task_id=task.task_id,
                        agent_id=old_agent_id or "",
                        action="fail",
                        reason=task.failure_reason,
                    )
                    try:
                        self._archive_record(record)
                    except Exception as exc:  # noqa: BLE001
                        logger.error(
                            "task %s fail 归档失败: %s", task.task_id, exc
                        )
                    logger.error(
                        "SwarmCoordinator 任务失败: task=%s retry_count=%d reason=%s",
                        task.task_id,
                        task.retry_count - 1,
                        timeout_reason,
                    )
                else:
                    # I4: 未超 MAX_RETRIES，reassign
                    task.status = SwarmTaskStatus.REASSIGNED
                    task.assigned_agent_id = None
                    task.heartbeat_at = None
                    # I2: 落盘 reassign trace
                    record = SwarmDispatchRecord(
                        task_id=task.task_id,
                        agent_id=old_agent_id or "",
                        action="reassign",
                        reassigned_from=old_agent_id,
                        reason=timeout_reason,
                    )
                    try:
                        self._archive_record(record)
                    except Exception as exc:  # noqa: BLE001
                        logger.error(
                            "task %s reassign 归档失败: %s", task.task_id, exc
                        )
                    reassigned_ids.append(task.task_id)
                    logger.warning(
                        "SwarmCoordinator 任务 reassign: task=%s old_agent=%s "
                        "retry=%d/%d reason=%s",
                        task.task_id,
                        old_agent_id,
                        task.retry_count,
                        self._max_retries,
                        timeout_reason,
                    )

            return reassigned_ids

    # ── Agent 查找（I3+I5+I6 4 步过滤）────────────────────────

    def _find_capable_agent(self, task: SwarmTask) -> str | None:
        """根据任务需求找到最合适的 agent（I3+I5+I6）.

        4 步过滤算法（F049 §2.3.1）：
            Step 1: 能力包含 — 找出 capabilities ⊇ task.required_capabilities 的候选集
            Step 2: I5 跨厂商 — cross_vendor_required 能力必须跨厂商
            Step 3: I6 no-self-review — 排除 author_agent_id 自身
            Step 4: load balancing — 选 workload 最小的候选

        Args:
            task: 待分配的任务.

        Returns:
            agent_id 或 None（无候选时）.
        """
        if not self._agents:
            return None

        required_caps = set(task.required_capabilities)
        if not required_caps:
            return None

        # task.context 中的 author 信息（I5/I6 校验依据）
        author_agent_id = task.context.get("author_agent_id")
        author_vendor = task.context.get("author_vendor")

        # 判断是否含跨厂商要求的能力
        needs_cross_vendor = bool(required_caps & self._cross_vendor_required)

        # Step 1: 能力包含过滤
        candidates: list[str] = []
        for agent_id, agent_info in self._agents.items():
            agent_caps = set(agent_info.get("capabilities", []))
            if required_caps.issubset(agent_caps):
                candidates.append(agent_id)

        if not candidates:
            return None

        # Step 2: I5 跨厂商过滤
        if needs_cross_vendor and author_vendor:
            filtered = [
                aid
                for aid in candidates
                if self._agents[aid].get("vendor") != author_vendor
            ]
            if not filtered:
                logger.warning(
                    "task %s I5 跨厂商过滤后无候选（author_vendor=%s, required=%s）",
                    task.task_id,
                    author_vendor,
                    required_caps & self._cross_vendor_required,
                )
                return None
            candidates = filtered

        # Step 3: I6 no-self-review 过滤
        if author_agent_id:
            filtered = [aid for aid in candidates if aid != author_agent_id]
            if not filtered:
                logger.warning(
                    "task %s I6 no-self-review 过滤后无候选（author_agent_id=%s）",
                    task.task_id,
                    author_agent_id,
                )
                return None
            candidates = filtered

        # preferred_agent_id 优先（若在候选集中）
        if task.preferred_agent_id and task.preferred_agent_id in candidates:
            return task.preferred_agent_id

        # Step 4: load balancing — 选 workload 最小的（同 workload 按字典序）
        workload = self.get_agent_workload()
        candidates.sort(key=lambda aid: (workload.get(aid, 0), aid))
        return candidates[0]

    def _find_complement_agent(
        self, agent_id: str, missing_capability: str
    ) -> str | None:
        """为 agent 找搭档补齐能力缺口.

        Args:
            agent_id: 当前 agent ID（被排除，不self-complement）.
            missing_capability: 缺失的能力（如 "code_generation"）.

        Returns:
            搭档 agent_id 或 None.

        Note:
            - 排除 agent_id 自身
            - I5 跨厂商过滤（若 missing_capability 在 cross_vendor_required 中）
            - load balancing 选 workload 最小的
        """
        if not self._agents or not missing_capability:
            return None

        # 找出 native_abilities 含 missing_capability 的 agent
        candidates = [
            aid
            for aid, info in self._agents.items()
            if aid != agent_id and missing_capability in info.get("capabilities", [])
        ]
        if not candidates:
            return None

        # I5 跨厂商过滤（若 missing_capability 在 cross_vendor_required 中）
        if missing_capability in self._cross_vendor_required:
            author_vendor = self._agents.get(agent_id, {}).get("vendor")
            if author_vendor:
                filtered = [
                    aid
                    for aid in candidates
                    if self._agents[aid].get("vendor") != author_vendor
                ]
                if not filtered:
                    return None
                candidates = filtered

        # load balancing
        workload = self.get_agent_workload()
        candidates.sort(key=lambda aid: (workload.get(aid, 0), aid))
        return candidates[0]

    def _try_find_complements(self, task: SwarmTask) -> dict[str, str]:
        """为 blind_spots 任务推荐搭档字典.

        Args:
            task: 待分配的任务（_find_capable_agent 已返回 None）.

        Returns:
            {missing_capability: complement_agent_id} 字典.

        两种推荐场景：
            1. 任务需求中有"无任何 agent 能覆盖"的能力（truly missing）
               → 对这些能力调用 _find_complement_agent 仍返回 None（无搭档可补）
            2. 任务需求中所有能力都有 agent 覆盖，但无单一 agent 同时覆盖全部
               → 选"覆盖最多能力"的 agent 作为主，对其未覆盖的能力找搭档
        """
        if not self._agents:
            return {}

        required_caps = set(task.required_capabilities)
        if not required_caps:
            return {}

        # 选"覆盖最多 required_capabilities"的 agent 作为主 agent
        # （preferred_agent_id 优先，否则按覆盖度排序）
        if task.preferred_agent_id and task.preferred_agent_id in self._agents:
            primary_agent = task.preferred_agent_id
        else:
            best_agent = ""
            best_coverage = -1
            for aid, info in self._agents.items():
                coverage = len(required_caps & set(info.get("capabilities", [])))
                if coverage > best_coverage:
                    best_coverage = coverage
                    best_agent = aid
            primary_agent = best_agent

        if not primary_agent:
            return {}

        # 找出主 agent 未覆盖的能力，对每个能力找搭档
        primary_caps = set(self._agents[primary_agent].get("capabilities", []))
        missing_caps = required_caps - primary_caps
        if not missing_caps:
            # 主 agent 已覆盖全部能力（理论不应到这里，因为 _find_capable_agent 已返回 None）
            return {}

        complements: dict[str, str] = {}
        for missing_cap in missing_caps:
            complement = self._find_complement_agent(primary_agent, missing_cap)
            if complement:
                complements[missing_cap] = complement

        return complements

    # ── 状态查询 ────────────────────────────────────────────────

    def get_task_status(self, task_id: str) -> SwarmTaskStatus | None:
        """查询任务状态.

        Args:
            task_id: 任务 ID.

        Returns:
            SwarmTaskStatus 或 None（任务不存在时）.
        """
        task = self._tasks.get(task_id)
        return task.status if task else None

    def get_task(self, task_id: str) -> SwarmTask | None:
        """查询任务完整对象（含 result / context 等）.

        Args:
            task_id: 任务 ID.

        Returns:
            SwarmTask 或 None.
        """
        return self._tasks.get(task_id)

    def get_agent_workload(self) -> dict[str, int]:
        """获取各 agent 当前任务数（用于 load balancing）.

        Returns:
            {agent_id: 当前 ASSIGNED+RUNNING 任务数} 字典.

        Note:
            - 仅统计 ASSIGNED / RUNNING 状态的任务
            - 未注册 agent 不出现在结果中
        """
        workload: dict[str, int] = dict.fromkeys(self._agents, 0)
        for task in self._tasks.values():
            if task.status in (SwarmTaskStatus.ASSIGNED, SwarmTaskStatus.RUNNING):
                if task.assigned_agent_id and task.assigned_agent_id in workload:
                    workload[task.assigned_agent_id] += 1
        return workload

    def list_tasks(
        self, status: SwarmTaskStatus | None = None
    ) -> list[SwarmTask]:
        """列出任务（可选按状态过滤）.

        Args:
            status: 可选状态过滤（None 表示全部）.

        Returns:
            SwarmTask 列表（按 created_at 升序）.
        """
        tasks = list(self._tasks.values())
        if status is not None:
            tasks = [t for t in tasks if t.status == status]
        tasks.sort(key=lambda t: t.created_at)
        return tasks

    def list_agents(self) -> list[dict[str, Any]]:
        """列出所有已注册 agent 的画像.

        Returns:
            agent 画像字典列表（含 agent_id / capabilities / vendor / workload）.
        """
        workload = self.get_agent_workload()
        result: list[dict[str, Any]] = []
        for agent_id, info in self._agents.items():
            heartbeat = self._heartbeats.get(agent_id)
            result.append(
                {
                    "agent_id": agent_id,
                    "capabilities": list(info.get("capabilities", [])),
                    "vendor": info.get("vendor", "unknown"),
                    "workload": workload.get(agent_id, 0),
                    "last_heartbeat": heartbeat.timestamp if heartbeat else None,
                    "last_status": heartbeat.status if heartbeat else "unknown",
                }
            )
        return result

    def cancel_task(self, task_id: str, reason: str = "") -> bool:
        """取消任务（operator 通过 F048 SteerCommand CANCEL 触发）.

        Args:
            task_id: 任务 ID.
            reason: 取消原因（审计追溯依据）.

        Returns:
            True = 取消成功，False = 任务不存在或状态不可取消.
        """
        task = self._tasks.get(task_id)
        if task is None:
            return False
        if task.status in (SwarmTaskStatus.COMPLETED, SwarmTaskStatus.FAILED,
                          SwarmTaskStatus.CANCELLED):
            return False

        old_agent_id = task.assigned_agent_id
        task.status = SwarmTaskStatus.CANCELLED
        task.assigned_agent_id = None
        task.failure_reason = reason or "cancelled_by_operator"

        # I2: 落盘 cancel trace
        record = SwarmDispatchRecord(
            task_id=task_id,
            agent_id=old_agent_id or "",
            action="cancel",
            reason=task.failure_reason,
        )
        try:
            self._archive_record(record)
        except Exception as exc:  # noqa: BLE001
            logger.error("task %s cancel 归档失败: %s", task_id, exc)

        logger.info(
            "SwarmCoordinator 取消任务: task=%s reason=%s",
            task_id,
            task.failure_reason,
        )
        return True

    # ── 持续调度循环（永不停止）────────────────────────────────

    async def run_continuously(self, interval: float = 5.0) -> None:
        """持续运行调度循环（永不停止）.

        Args:
            interval: 调度循环间隔（秒，默认 5.0）.

        行为：
            - 每 interval 秒触发一次 dispatch + check_timeouts
            - 由外部 asyncio.create_task 启动
            - 通过 cancel() 停止（asyncio.Task.cancel()）
            - 异常不退出循环，记 ERROR 后继续下一轮（健壮性）

        使用示例：
            >>> coordinator = SwarmCoordinator()
            >>> task = asyncio.create_task(coordinator.run_continuously())
            >>> # ... 运行一段时间 ...
            >>> task.cancel()  # 停止调度循环
        """
        # 使用传入的 interval 或 config 中的 dispatch_interval_seconds
        actual_interval = interval if interval != 5.0 else self._dispatch_interval
        self._running = True
        logger.info(
            "SwarmCoordinator 调度循环启动 (interval=%ss, timeout=%ss, max_retries=%d)",
            actual_interval,
            self._heartbeat_timeout,
            self._max_retries,
        )

        try:
            while self._running:
                try:
                    # 1. 分发待处理任务
                    dispatched = await self.dispatch()
                    # 2. 检查超时任务
                    reassigned = await self.check_timeouts()

                    if dispatched or reassigned:
                        logger.debug(
                            "调度循环一轮完成: dispatched=%d reassigned=%d",
                            len(dispatched),
                            len(reassigned),
                        )
                except Exception as exc:  # noqa: BLE001 — 循环不退出
                    logger.error(
                        "SwarmCoordinator 调度循环异常（不退出，继续下一轮）: %s",
                        exc,
                    )

                # 等待下一轮（asyncio.sleep 可被 cancel 中断）
                await asyncio.sleep(actual_interval)
        except asyncio.CancelledError:
            logger.info("SwarmCoordinator 调度循环被 cancel，正常停止")
            raise
        finally:
            self._running = False
            logger.info("SwarmCoordinator 调度循环已停止")

    def stop(self) -> None:
        """停止调度循环（设置 _running=False，下一轮 sleep 后退出）.

        Note:
            - 这是软停止，需要等待当前 sleep 完成
            - 立即停止请用 asyncio.Task.cancel()
        """
        self._running = False

    # ── 归档（I2 trace 落盘）────────────────────────────────────

    def _archive_record(self, record: SwarmDispatchRecord) -> None:
        """归档调度记录到 JSONL（append-only，I2 trace 落盘）.

        Args:
            record: SwarmDispatchRecord 实例.

        Note:
            - 以 'a' 模式追加写（禁止覆盖，I2 不变量）
            - 路径为相对路径（红线 11），由调用方拼接 data_dir
            - 父目录不存在时自动创建
        """
        archive_path = Path(self._trace_archive_path)
        archive_path.parent.mkdir(parents=True, exist_ok=True)

        record_data = record.model_dump(mode="json")
        # 转为 JSON Lines 格式（一行一条记录）
        line = json.dumps(record_data, ensure_ascii=False, default=str)
        with archive_path.open("a", encoding="utf-8") as f:
            f.write(line + "\n")


# ──────────────────────────────────────────────────────────────────
# 工厂函数（I1 单一调度器 — 推荐通过 DI 注入）
# ──────────────────────────────────────────────────────────────────


_swarm_coordinator_singleton: SwarmCoordinator | None = None
_singleton_lock = asyncio.Lock()


async def create_swarm_coordinator(
    config: dict[str, Any] | None = None,
    force_new: bool = False,
) -> SwarmCoordinator:
    """创建或获取 SwarmCoordinator 单例（I1 单一调度器）.

    Args:
        config: 可选配置字典（仅首次创建时生效）.
        force_new: 强制创建新实例（仅用于测试，生产环境禁止）.

    Returns:
        SwarmCoordinator 单例.

    不变量：
        - I1: 全局唯一——多次调用返回同一实例（force_new=True 除外）
        - 红线 12: 通过工厂函数 + DI 注入，禁止外部直接 SwarmCoordinator()
    """
    global _swarm_coordinator_singleton

    async with _singleton_lock:
        if _swarm_coordinator_singleton is None or force_new:
            _swarm_coordinator_singleton = SwarmCoordinator(config=config)
            logger.info(
                "SwarmCoordinator 单例已创建 (force_new=%s)", force_new
            )
        return _swarm_coordinator_singleton


def reset_swarm_coordinator_singleton() -> None:
    """重置单例（仅用于测试）.

    Warning:
        生产环境禁止调用，会破坏 I1 单一调度器不变量.
    """
    global _swarm_coordinator_singleton
    _swarm_coordinator_singleton = None


__all__ = [
    # 枚举
    "SwarmTaskStatus",
    "SwarmPriority",
    # 数据模型
    "SwarmTask",
    "AgentHeartbeat",
    "SwarmDispatchRecord",
    # 核心类
    "SwarmCoordinator",
    # 工厂函数
    "create_swarm_coordinator",
    "reset_swarm_coordinator_singleton",
]
