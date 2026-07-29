"""Event Memory Store — 事件记忆存储（CL-029/030 P0 必修）.

独立子模块，**不混入 EchoStore**（``flowforge/memory/episodic.py``）。
no-classifier 红线：分类由规则或显式 ``trigger`` 字段决定，禁止 LLM 分类。

设计依据:
    - ``flowforge/docs/design.md`` v7.1-§D14 Event Memory 规范
    - ``flowforge/docs/review/review.md`` 第十四章 CL-029/CL-030

规格要点:
    - 10+1 字段 schema（含 ownerUserId 多租户隔离）
    - ``teleport(thread_id, message_id)`` 精确跳转（跨 thread 上下文恢复）
    - v1 schema 面向 v5 终态（趋势分析 + resolution 链）预留扩展空间
    - Phase C 趋势配 resolution 链（事件 A → B → C 因果链）

铁律遵守:
    - 铁律 3：通过构造函数注入 ``logger``，不直接实例化外部服务
    - 铁律 4：禁止直接操作数据库，v1 用内存 dict，后续可通过 backend 抽象扩展
    - 铁律 5：枚举值通过 ``Enum`` 定义，不通过字符串字面量；无硬编码路径/密钥
    - 编程红线 9：使用组合（Pydantic 字段 + 内存 dict）而非继承
    - no-classifier 红线：本模块不依赖任何 LLM 客户端

License: MIT
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field

from flowforge.core.tracing import TraceLogger, get_logger

logger = get_logger("event_memory")


# ──────────────────────────────────────────────────────────────────────────────
# 枚举（铁律 5：枚举值通过 Enum 定义，不通过字符串字面量）
# ──────────────────────────────────────────────────────────────────────────────


class EventType(str, Enum):
    """事件类型枚举.

    对应 design.md v7.1-§D14 事件类型清单:
        - task_started: 任务启动
        - task_completed: 任务完成
        - error_occurred: 错误发生
        - cognitive_shift: 认知状态变迁
        - scope_divergence: 范围发散（超出原始 scope）
        - restart_recovery: 重启恢复
        - external_signal: 外部信号
    """

    TASK_STARTED = "task_started"
    TASK_COMPLETED = "task_completed"
    ERROR_OCCURRED = "error_occurred"
    COGNITIVE_SHIFT = "cognitive_shift"
    SCOPE_DIVERGENCE = "scope_divergence"
    RESTART_RECOVERY = "restart_recovery"
    EXTERNAL_SIGNAL = "external_signal"


class EventTrigger(str, Enum):
    """事件触发源枚举.

    no-classifier 红线: ``trigger`` 由调用方显式传入，不由 LLM 推断.
        - user_input: 用户输入触发
        - agent_action: Agent 动作触发
        - system_event: 系统事件触发
        - scheduled_job: 定时任务触发
        - external: 外部源触发
    """

    USER_INPUT = "user_input"
    AGENT_ACTION = "agent_action"
    SYSTEM_EVENT = "system_event"
    SCHEDULED_JOB = "scheduled_job"
    EXTERNAL = "external"


# ──────────────────────────────────────────────────────────────────────────────
# 数据模型
# ──────────────────────────────────────────────────────────────────────────────

_SUMMARY_MAX_LEN = 200


class EventRecord(BaseModel):
    """事件记录 — 10+1 字段 schema.

    v1 schema 面向 v5 终态（趋势分析 + resolution 链）预留扩展空间.
    多租户隔离通过 ``owner_user_id`` 字段实现.

    字段映射（spec camelCase → Python snake_case）:
        - type → type
        - trigger → trigger
        - cat → cat
        - threadId → thread_id
        - messageId → message_id
        - timestamp → timestamp
        - summary → summary
        - cognitiveTransition → cognitive_transition
        - relatedHarness → related_harness
        - confidence → confidence
        - ownerUserId → owner_user_id（多租户隔离）

    Attributes:
        type: 事件类型（EventType 枚举）.
        trigger: 触发源（EventTrigger 枚举）— no-classifier 红线: 显式传入.
        cat: 事件分类标签（业务自定义，如 "content_creation"）.
        thread_id: 线程 ID（用于 teleport 跳转）.
        message_id: 消息 ID（用于 teleport 精确跳转）.
        timestamp: 事件时间戳（UTC）.
        summary: 事件摘要（≤200 字符）.
        cognitive_transition: 认知状态变迁（如 "E2→E3"）.
        related_harness: 关联 Harness 实例 ID.
        confidence: 事件置信度 0.0-1.0（由 LLM 或规则给出）.
        owner_user_id: 事件所有者用户 ID（多租户隔离）.
        event_id: 事件唯一标识（record 时由 store 自动生成 UUID）.
    """

    type: EventType = Field(..., description="事件类型")
    trigger: EventTrigger = Field(
        ..., description="触发源（显式传入，禁止 LLM 推断）"
    )
    cat: str = Field(..., min_length=1, description="事件分类标签")
    thread_id: str = Field(..., min_length=1, description="线程 ID")
    message_id: str = Field(..., min_length=1, description="消息 ID")
    timestamp: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="事件时间戳（UTC）",
    )
    summary: str = Field(
        ..., max_length=_SUMMARY_MAX_LEN, description="事件摘要（≤200 字符）"
    )
    cognitive_transition: str = Field(
        default="", description="认知状态变迁（如 E2→E3）"
    )
    related_harness: str = Field(default="", description="关联 Harness 实例 ID")
    confidence: float = Field(
        default=1.0, ge=0.0, le=1.0, description="事件置信度 0.0-1.0"
    )
    owner_user_id: str = Field(
        ..., min_length=1, description="事件所有者用户 ID（多租户隔离）"
    )
    event_id: str = Field(
        default="", description="事件唯一标识（record 时自动生成）"
    )


class ResolutionLink(BaseModel):
    """因果链链接 — Phase C 趋势配 resolution 链.

    表示事件 A → 事件 B 的因果关系，用于构建事件因果链.
    v1 schema 面向 v5 终态预留扩展空间.

    Attributes:
        from_event_id: 因果链起点事件 ID.
        to_event_id: 因果链终点事件 ID（to 是 from 的后果）.
        link_type: 链接类型（如 "causes" / "resolves" / "supersedes" / "follows"）.
        confidence: 链接置信度 0.0-1.0.
        link_id: 链接唯一标识（自动生成 UUID）.
        created_at: 创建时间（UTC）.
    """

    from_event_id: str = Field(..., description="因果链起点事件 ID")
    to_event_id: str = Field(..., description="因果链终点事件 ID")
    link_type: str = Field(
        default="causes",
        description="链接类型（causes/resolves/supersedes/follows）",
    )
    confidence: float = Field(
        default=1.0, ge=0.0, le=1.0, description="链接置信度 0.0-1.0"
    )
    link_id: str = Field(default="", description="链接唯一标识（自动生成）")
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="创建时间（UTC）",
    )


# ──────────────────────────────────────────────────────────────────────────────
# EventMemoryStore
# ──────────────────────────────────────────────────────────────────────────────


class EventMemoryStore:
    """事件记忆存储 — 独立子模块.

    不混入 EchoStore（``episodic.py``）. v1 使用内存 dict 存储，后续可通过
    backend 抽象扩展为 SQLite（铁律 4：不直接操作数据库）.

    no-classifier 红线: 本类不依赖任何 LLM 客户端，事件分类完全由调用方
    显式传入的 ``type`` / ``trigger`` / ``cat`` 字段决定.

    Args:
        logger: TraceLogger 实例. 若未注入，使用默认 logger.

    线程安全: 使用 ``asyncio.Lock`` 保护并发写入. 所有公开方法均为
    ``async``，I/O 操作使用 ``async/await``（项目规范）.
    """

    def __init__(self, logger: Optional[TraceLogger] = None) -> None:
        self._logger: TraceLogger = logger or get_logger("event_memory.store")
        # event_id → EventRecord
        self._events: dict[str, EventRecord] = {}
        # (thread_id, message_id) → event_id（teleport 精确跳转索引）
        self._teleport_index: dict[tuple[str, str], str] = {}
        # link_id → ResolutionLink
        self._links: dict[str, ResolutionLink] = {}
        # to_event_id → [from_event_id, ...]（反向索引，用于追溯因果链）
        self._reverse_links: dict[str, list[str]] = {}
        self._lock: asyncio.Lock = asyncio.Lock()

    # ── 记录与查询 ──────────────────────────────────────────────

    async def record(self, event: EventRecord) -> str:
        """记录事件，返回 event_id（UUID）.

        no-classifier 红线: 本方法不调用 LLM 做分类，event 的
        ``type`` / ``trigger`` / ``cat`` 字段必须由调用方显式传入.

        Args:
            event: 待记录的事件. ``event_id`` 字段会被自动填充.

        Returns:
            事件唯一标识 event_id（``uuid.uuid4().hex``）.
        """
        event_id = uuid.uuid4().hex
        # 用 model_copy 写入 event_id，保持入参不可变语义
        recorded = event.model_copy(update={"event_id": event_id})
        async with self._lock:
            self._events[event_id] = recorded
            teleport_key = (recorded.thread_id, recorded.message_id)
            self._teleport_index[teleport_key] = event_id
        self._logger.info(
            f"Recorded event {event_id} (type={recorded.type.value}, "
            f"trigger={recorded.trigger.value}, thread={recorded.thread_id})"
        )
        return event_id

    async def get(self, event_id: str) -> Optional[EventRecord]:
        """按 ID 查询事件.

        Args:
            event_id: 事件唯一标识.

        Returns:
            事件记录; 不存在返回 None.
        """
        async with self._lock:
            return self._events.get(event_id)

    async def teleport(
        self, thread_id: str, message_id: str
    ) -> Optional[EventRecord]:
        """精确跳转 — 通过 threadId + messageId 二元组定位事件.

        用于跨 thread 上下文恢复: 当需要从某个消息节点恢复上下文时，
        通过 ``thread_id`` + ``message_id`` 精确定位对应的事件记录.

        Args:
            thread_id: 线程 ID.
            message_id: 消息 ID.

        Returns:
            匹配的事件记录; 不存在返回 None.
        """
        async with self._lock:
            event_id = self._teleport_index.get((thread_id, message_id))
            if event_id is None:
                return None
            return self._events.get(event_id)

    async def list_by_thread(
        self, thread_id: str, limit: int = 50
    ) -> list[EventRecord]:
        """按线程查询事件（按时间戳升序）.

        Args:
            thread_id: 线程 ID.
            limit: 最多返回条数（默认 50）.

        Returns:
            该线程下的事件列表（按时间戳升序）.
        """
        async with self._lock:
            matched = [
                e for e in self._events.values() if e.thread_id == thread_id
            ]
        matched.sort(key=lambda e: e.timestamp)
        return matched[:limit]

    async def list_by_owner(
        self, owner_user_id: str, limit: int = 100
    ) -> list[EventRecord]:
        """按 owner 查询事件（多租户隔离）.

        铁律: 多租户隔离 — owner A 看不到 owner B 的事件.

        Args:
            owner_user_id: 事件所有者用户 ID.
            limit: 最多返回条数（默认 100）.

        Returns:
            该 owner 的事件列表（按时间戳升序）.
        """
        async with self._lock:
            matched = [
                e
                for e in self._events.values()
                if e.owner_user_id == owner_user_id
            ]
        matched.sort(key=lambda e: e.timestamp)
        return matched[:limit]

    async def list_by_type(
        self,
        event_type: EventType,
        since: Optional[datetime] = None,
    ) -> list[EventRecord]:
        """按类型查询事件（可叠加时间过滤）.

        Args:
            event_type: 事件类型枚举.
            since: 可选起始时间（UTC）; None 表示不过滤时间.

        Returns:
            匹配类型的事件列表（按时间戳升序）.
        """
        async with self._lock:
            matched = [
                e
                for e in self._events.values()
                if e.type == event_type
                and (since is None or e.timestamp >= since)
            ]
        matched.sort(key=lambda e: e.timestamp)
        return matched

    # ── 因果链（resolution chain）────────────────────────────────

    async def add_resolution_link(
        self,
        from_id: str,
        to_id: str,
        link_type: str = "causes",
        confidence: float = 1.0,
    ) -> ResolutionLink:
        """添加因果链链接.

        表示 ``from_id`` 事件 → ``to_id`` 事件的因果关系.
        Phase C 趋势配 resolution 链: 事件 A → 事件 B → 事件 C 形成因果链.

        Args:
            from_id: 因果链起点事件 ID.
            to_id: 因果链终点事件 ID.
            link_type: 链接类型（默认 "causes"）.
            confidence: 链接置信度 0.0-1.0（默认 1.0）.

        Returns:
            创建的 ResolutionLink.

        Raises:
            KeyError: ``from_id`` 或 ``to_id`` 对应的事件不存在.
        """
        async with self._lock:
            if from_id not in self._events:
                raise KeyError(f"from_event not found: {from_id}")
            if to_id not in self._events:
                raise KeyError(f"to_event not found: {to_id}")
            link_id = uuid.uuid4().hex
            link = ResolutionLink(
                from_event_id=from_id,
                to_event_id=to_id,
                link_type=link_type,
                confidence=confidence,
                link_id=link_id,
            )
            self._links[link_id] = link
            self._reverse_links.setdefault(to_id, []).append(from_id)
        self._logger.info(
            f"Added resolution link {link_id}: "
            f"{from_id} --{link_type}--> {to_id}"
        )
        return link

    async def get_resolution_chain(
        self, event_id: str
    ) -> list[EventRecord]:
        """获取事件因果链（递归遍历祖先）.

        若 A → B → C（A causes B, B causes C），则
        ``get_resolution_chain(C)`` 返回 ``[A, B, C]``（按因果链顺序，
        即时间顺序，起点在前、终点在后）.

        Args:
            event_id: 终点事件 ID.

        Returns:
            因果链事件列表（按因果顺序，起点在前、终点在后）.
            若 ``event_id`` 不存在，返回空列表.
        """
        async with self._lock:
            if event_id not in self._events:
                return []
            ancestors: list[EventRecord] = []
            visited: set[str] = set()
            self._collect_ancestors(event_id, ancestors, visited)
            # ancestors 按"最近祖先在前"收集，反转为"最早祖先在前"
            ancestors.reverse()
            chain = ancestors + [self._events[event_id]]
            # 去重保序（防止菱形依赖导致重复）
            seen: set[str] = set()
            result: list[EventRecord] = []
            for ev in chain:
                if ev.event_id not in seen:
                    seen.add(ev.event_id)
                    result.append(ev)
            return result

    def _collect_ancestors(
        self,
        event_id: str,
        out: list[EventRecord],
        visited: set[str],
    ) -> None:
        """递归收集祖先事件（最近祖先在前，调用方需反转）.

        同步方法，由 ``get_resolution_chain`` 在持锁状态下调用.
        """
        if event_id in visited:
            return
        visited.add(event_id)
        parent_ids = self._reverse_links.get(event_id, [])
        for pid in parent_ids:
            if pid in self._events and pid not in visited:
                out.append(self._events[pid])
                self._collect_ancestors(pid, out, visited)

    # ── 趋势分析与清理 ──────────────────────────────────────────

    async def analyze_trend(self, window_hours: int = 24) -> dict:
        """趋势分析 — 按 type/trigger/cat 聚合统计.

        Phase C 趋势配 resolution 链: 趋势分析可结合 resolution 链做根因分析.

        Args:
            window_hours: 时间窗口（小时，默认 24）.

        Returns:
            趋势分析结果 dict:
                - ``window_hours``: 时间窗口
                - ``window_start``: 窗口起始时间（UTC ISO 8601）
                - ``window_end``: 窗口结束时间（UTC ISO 8601）
                - ``total``: 窗口内事件总数
                - ``by_type``: ``{event_type_value: count}``
                - ``by_trigger``: ``{trigger_value: count}``
                - ``by_cat``: ``{cat: count}``
                - ``resolution_chain_count``: 因果链链接总数
        """
        now = datetime.now(timezone.utc)
        window_start = now - timedelta(hours=window_hours)
        async with self._lock:
            in_window = [
                e for e in self._events.values() if e.timestamp >= window_start
            ]
            by_type: dict[str, int] = {}
            by_trigger: dict[str, int] = {}
            by_cat: dict[str, int] = {}
            for e in in_window:
                t_val = e.type.value
                by_type[t_val] = by_type.get(t_val, 0) + 1
                tr_val = e.trigger.value
                by_trigger[tr_val] = by_trigger.get(tr_val, 0) + 1
                by_cat[e.cat] = by_cat.get(e.cat, 0) + 1
            link_count = len(self._links)
        return {
            "window_hours": window_hours,
            "window_start": window_start.isoformat(),
            "window_end": now.isoformat(),
            "total": len(in_window),
            "by_type": by_type,
            "by_trigger": by_trigger,
            "by_cat": by_cat,
            "resolution_chain_count": link_count,
        }

    async def purge_expired(self, max_age_days: int = 30) -> int:
        """清理过期事件（按 timestamp）.

        同时清理相关的 resolution links 和 teleport 索引.

        Args:
            max_age_days: 最大保留天数（默认 30）.

        Returns:
            被清理的事件数量.
        """
        cutoff = datetime.now(timezone.utc) - timedelta(days=max_age_days)
        async with self._lock:
            expired_ids = [
                eid
                for eid, e in self._events.items()
                if e.timestamp < cutoff
            ]
            for eid in expired_ids:
                e = self._events.pop(eid, None)
                if e is not None:
                    teleport_key = (e.thread_id, e.message_id)
                    if (
                        teleport_key in self._teleport_index
                        and self._teleport_index[teleport_key] == eid
                    ):
                        del self._teleport_index[teleport_key]
                # 清理涉及该事件的 resolution links
                link_ids_to_remove = [
                    lid
                    for lid, link in self._links.items()
                    if link.from_event_id == eid or link.to_event_id == eid
                ]
                for lid in link_ids_to_remove:
                    link = self._links.pop(lid, None)
                    if link is not None:
                        rev = self._reverse_links.get(link.to_event_id, [])
                        if link.from_event_id in rev:
                            rev.remove(link.from_event_id)
                            if not rev:
                                del self._reverse_links[link.to_event_id]
        self._logger.info(
            f"Purged {len(expired_ids)} expired events "
            f"(max_age_days={max_age_days})"
        )
        return len(expired_ids)
