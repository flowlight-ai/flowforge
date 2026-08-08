"""SessionPersistence — 会话持久化与恢复.

对标 Codex CLI 的 Thread（SQLite）和 OpenCode 的 Event Sourcing。
支持跨会话恢复、分叉、回滚。

核心概念：
- Session: 一次完整的 Agent 交互会话
- Turn: 一轮完整交互（用户输入 → Agent 推理 → 工具调用 → 结果反馈）
- Event: Turn 内的细粒度事件（消息、工具调用、工具结果、状态变更）

Usage:
    from flowforge.core.session_persistence import SessionStore, Session, SessionEvent, EventType

    store = SessionStore(db_path="data/sessions.db")

    # Create and save a session
    session = Session(project="contentforge", agent_name="topic_agent")
    store.save_session(session)

    # Append events (Event Sourcing)
    event = SessionEvent(
        session_id=session.session_id,
        turn_id="turn_001",
        event_type=EventType.USER_MESSAGE,
        content="写一篇关于AI的文章",
    )
    store.append_event(session.session_id, event)

    # Load and resume
    loaded = store.load_session(session.session_id)
"""

from __future__ import annotations

import json
import sqlite3
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any

from flowforge.core.tracing import get_logger

logger = get_logger("session_persistence")


class EventType(str, Enum):
    """会话事件类型."""

    USER_MESSAGE = "user_message"
    AGENT_MESSAGE = "agent_message"
    TOOL_CALL = "tool_call"
    TOOL_RESULT = "tool_result"
    STATE_UPDATE = "state_update"
    AGENT_SWITCH = "agent_switch"
    ERROR = "error"
    CHECKPOINT = "checkpoint"


@dataclass
class SessionEvent:
    """会话事件."""

    event_id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    session_id: str = ""
    turn_id: str = ""
    event_type: EventType = EventType.USER_MESSAGE
    content: str = ""
    metadata: dict = field(default_factory=dict)
    timestamp: float = field(default_factory=time.time)


@dataclass
class SessionTurn:
    """会话轮次."""

    turn_id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    session_id: str = ""
    events: list[SessionEvent] = field(default_factory=list)
    start_time: float = field(default_factory=time.time)
    end_time: float | None = None


@dataclass
class Session:
    """会话."""

    session_id: str = field(default_factory=lambda: str(uuid.uuid4())[:12])
    project: str = ""
    agent_name: str = ""
    turns: list[SessionTurn] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    status: str = "active"  # active, completed, failed, archived
    metadata: dict = field(default_factory=dict)


class SessionStore:
    """会话持久化存储（SQLite）.

    基于 Event Sourcing 模式，所有状态变更以事件追加方式持久化，
    支持完整回放和恢复。

    表结构：
    - sessions: 会话元信息
    - turns: 轮次信息
    - events: 细粒度事件（Event Sourcing 核心）
    """

    def __init__(self, db_path: str = "data/sessions.db") -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn: sqlite3.Connection | None = None
        self._init_db()

    def _init_db(self) -> None:
        """初始化数据库表."""
        conn = self._get_conn()
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS sessions (
                session_id TEXT PRIMARY KEY,
                project TEXT DEFAULT '',
                agent_name TEXT DEFAULT '',
                created_at REAL,
                updated_at REAL,
                status TEXT DEFAULT 'active',
                metadata TEXT DEFAULT '{}'
            );
            CREATE TABLE IF NOT EXISTS turns (
                turn_id TEXT PRIMARY KEY,
                session_id TEXT,
                start_time REAL,
                end_time REAL,
                FOREIGN KEY (session_id) REFERENCES sessions(session_id)
            );
            CREATE TABLE IF NOT EXISTS events (
                event_id TEXT PRIMARY KEY,
                session_id TEXT,
                turn_id TEXT,
                event_type TEXT,
                content TEXT,
                metadata TEXT DEFAULT '{}',
                timestamp REAL,
                FOREIGN KEY (session_id) REFERENCES sessions(session_id),
                FOREIGN KEY (turn_id) REFERENCES turns(turn_id)
            );
            CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
            CREATE INDEX IF NOT EXISTS idx_events_turn ON events(turn_id);
            CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
        """)
        conn.commit()

    def _get_conn(self) -> sqlite3.Connection:
        """获取数据库连接（懒初始化）."""
        if self._conn is None:
            self._conn = sqlite3.connect(str(self.db_path))
            self._conn.row_factory = sqlite3.Row
        return self._conn

    def save_session(self, session: Session) -> None:
        """保存或更新会话元信息."""
        conn = self._get_conn()
        conn.execute(
            "INSERT OR REPLACE INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                session.session_id,
                session.project,
                session.agent_name,
                session.created_at,
                session.updated_at,
                session.status,
                json.dumps(session.metadata),
            ),
        )
        conn.commit()

    def save_turn(self, turn: SessionTurn) -> None:
        """保存轮次信息."""
        conn = self._get_conn()
        conn.execute(
            "INSERT OR REPLACE INTO turns VALUES (?, ?, ?, ?)",
            (turn.turn_id, turn.session_id, turn.start_time, turn.end_time),
        )
        conn.commit()

    def load_session(self, session_id: str) -> Session | None:
        """加载会话及其全部轮次和事件."""
        conn = self._get_conn()
        row = conn.execute(
            "SELECT * FROM sessions WHERE session_id = ?", (session_id,)
        ).fetchone()
        if not row:
            return None

        session = Session(
            session_id=row["session_id"],
            project=row["project"],
            agent_name=row["agent_name"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            status=row["status"],
            metadata=json.loads(row["metadata"]),
        )

        # Load turns and events
        turns = conn.execute(
            "SELECT * FROM turns WHERE session_id = ? ORDER BY start_time",
            (session_id,),
        ).fetchall()
        for t in turns:
            turn = SessionTurn(
                turn_id=t["turn_id"],
                session_id=session_id,
                start_time=t["start_time"],
                end_time=t["end_time"],
            )
            events = conn.execute(
                "SELECT * FROM events WHERE turn_id = ? ORDER BY timestamp",
                (turn.turn_id,),
            ).fetchall()
            for e in events:
                turn.events.append(
                    SessionEvent(
                        event_id=e["event_id"],
                        session_id=session_id,
                        turn_id=turn.turn_id,
                        event_type=EventType(e["event_type"]),
                        content=e["content"],
                        metadata=json.loads(e["metadata"]),
                        timestamp=e["timestamp"],
                    )
                )
            session.turns.append(turn)
        return session

    def append_event(self, session_id: str, event: SessionEvent) -> None:
        """追加事件（Event Sourcing 核心）.

        同时更新会话的 updated_at 时间戳。
        """
        conn = self._get_conn()
        event.session_id = session_id
        conn.execute(
            "INSERT INTO events VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                event.event_id,
                event.session_id,
                event.turn_id,
                event.event_type.value,
                event.content,
                json.dumps(event.metadata),
                event.timestamp,
            ),
        )
        conn.execute(
            "UPDATE sessions SET updated_at = ? WHERE session_id = ?",
            (time.time(), session_id),
        )
        conn.commit()

    def list_sessions(
        self,
        project: str | None = None,
        status: str | None = None,
    ) -> list[Session]:
        """列出会话，支持按项目和状态过滤."""
        conn = self._get_conn()
        query = "SELECT session_id FROM sessions WHERE 1=1"
        params: list[Any] = []
        if project:
            query += " AND project = ?"
            params.append(project)
        if status:
            query += " AND status = ?"
            params.append(status)
        query += " ORDER BY updated_at DESC"
        rows = conn.execute(query, params).fetchall()
        return [self.load_session(row["session_id"]) for row in rows]

    def archive_session(self, session_id: str) -> None:
        """归档会话."""
        conn = self._get_conn()
        conn.execute(
            "UPDATE sessions SET status = 'archived' WHERE session_id = ?",
            (session_id,),
        )
        conn.commit()

    def get_events(
        self,
        session_id: str,
        event_type: EventType | None = None,
    ) -> list[SessionEvent]:
        """获取会话事件，支持按事件类型过滤."""
        conn = self._get_conn()
        if event_type:
            rows = conn.execute(
                "SELECT * FROM events WHERE session_id = ? AND event_type = ? ORDER BY timestamp",
                (session_id, event_type.value),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM events WHERE session_id = ? ORDER BY timestamp",
                (session_id,),
            ).fetchall()
        return [
            SessionEvent(
                event_id=e["event_id"],
                session_id=e["session_id"],
                turn_id=e["turn_id"],
                event_type=EventType(e["event_type"]),
                content=e["content"],
                metadata=json.loads(e["metadata"]),
                timestamp=e["timestamp"],
            )
            for e in rows
        ]

    def close(self) -> None:
        """关闭数据库连接."""
        if self._conn:
            self._conn.close()
            self._conn = None
