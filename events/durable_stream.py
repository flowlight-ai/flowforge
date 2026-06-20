"""DurableEventStream — 持久化事件流

设计文档参考：
- S3.0-20: INF-02 EventStore WAL模式与批量提交
- CAP-11: 持久化事件流
- spec.md v2.2: A-B并行验证切换策略
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import sqlite3
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Dict, List, Optional

from pydantic import BaseModel

logger = logging.getLogger(__name__)


class StreamEvent(BaseModel):
    """持久化事件"""
    event_id: str = ""
    event_type: str
    data: Dict[str, Any] = {}
    metadata: Dict[str, Any] = {}
    timestamp: float = 0.0
    sequence: int = 0


class Snapshot(BaseModel):
    """事件快照"""
    snapshot_id: str = ""
    stream_id: str
    sequence: int  # 快照对应的最后事件序号
    state: Dict[str, Any] = {}
    timestamp: float = 0.0


class DurableEventStream:
    """持久化事件流

    特性：
    1. SQLite WAL模式写入
    2. 批量提交（每100条或每秒）
    3. 事件回放
    4. snapshot compaction
    """

    def __init__(
        self,
        db_path: str = "",
        stream_id: str = "default",
        batch_size: int = 100,
        flush_interval: float = 1.0,
    ):
        self._stream_id = stream_id
        self._batch_size = batch_size
        self._flush_interval = flush_interval
        self._buffer: List[StreamEvent] = []
        self._sequence = 0
        self._flush_task: Optional[asyncio.Task] = None
        self._running = False

        # 初始化数据库
        if not db_path:
            data_dir = os.environ.get("FLOWFORGE_DATA_DIR", "data")
            os.makedirs(data_dir, exist_ok=True)
            db_path = os.path.join(data_dir, "event_stream.db")

        self._db_path = db_path
        self._init_db()

    def _init_db(self) -> None:
        """初始化SQLite数据库（WAL模式）"""
        self._conn = sqlite3.connect(self._db_path)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA synchronous=NORMAL")
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS events (
                event_id TEXT PRIMARY KEY,
                stream_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                data TEXT NOT NULL,
                metadata TEXT NOT NULL,
                timestamp REAL NOT NULL,
                sequence INTEGER NOT NULL
            )
        """)
        self._conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_events_stream_seq
            ON events(stream_id, sequence)
        """)
        self._conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_events_type
            ON events(event_type)
        """)
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS snapshots (
                snapshot_id TEXT PRIMARY KEY,
                stream_id TEXT NOT NULL,
                sequence INTEGER NOT NULL,
                state TEXT NOT NULL,
                timestamp REAL NOT NULL
            )
        """)
        self._conn.commit()

        # 读取最新序列号
        row = self._conn.execute(
            "SELECT MAX(sequence) FROM events WHERE stream_id = ?",
            (self._stream_id,)
        ).fetchone()
        self._sequence = row[0] if row[0] is not None else 0

    async def start(self) -> None:
        """启动事件流"""
        self._running = True
        self._flush_task = asyncio.create_task(self._periodic_flush())

    async def stop(self) -> None:
        """停止事件流"""
        self._running = False
        if self._flush_task:
            self._flush_task.cancel()
            try:
                await self._flush_task
            except asyncio.CancelledError:
                pass
        await self.flush()
        self._conn.close()

    async def append(self, event_type: str, data: Dict[str, Any] = None, metadata: Dict[str, Any] = None) -> StreamEvent:
        """追加事件"""
        self._sequence += 1
        event = StreamEvent(
            event_id=str(uuid.uuid4()),
            event_type=event_type,
            data=data or {},
            metadata=metadata or {},
            timestamp=time.time(),
            sequence=self._sequence,
        )
        self._buffer.append(event)

        # 批量提交
        if len(self._buffer) >= self._batch_size:
            await self.flush()

        return event

    async def flush(self) -> None:
        """刷新缓冲区到数据库"""
        if not self._buffer:
            return

        events_to_flush = self._buffer[:]
        self._buffer.clear()

        try:
            for event in events_to_flush:
                self._conn.execute(
                    """INSERT OR IGNORE INTO events
                    (event_id, stream_id, event_type, data, metadata, timestamp, sequence)
                    VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (
                        event.event_id,
                        self._stream_id,
                        event.event_type,
                        json.dumps(event.data, ensure_ascii=False),
                        json.dumps(event.metadata, ensure_ascii=False),
                        event.timestamp,
                        event.sequence,
                    )
                )
            self._conn.commit()
        except Exception as e:
            logger.error(f"Failed to flush events: {e}")
            # 回滚并重新加入缓冲区
            self._conn.rollback()
            self._buffer = events_to_flush + self._buffer

    async def replay(
        self,
        from_sequence: int = 0,
        event_type: Optional[str] = None,
        limit: int = 1000,
    ) -> List[StreamEvent]:
        """回放事件"""
        await self.flush()  # 先刷新缓冲区

        query = """
            SELECT event_id, event_type, data, metadata, timestamp, sequence
            FROM events
            WHERE stream_id = ? AND sequence > ?
        """
        params: list = [self._stream_id, from_sequence]

        if event_type:
            query += " AND event_type = ?"
            params.append(event_type)

        query += " ORDER BY sequence ASC LIMIT ?"
        params.append(limit)

        rows = self._conn.execute(query, params).fetchall()

        return [
            StreamEvent(
                event_id=row[0],
                event_type=row[1],
                data=json.loads(row[2]),
                metadata=json.loads(row[3]),
                timestamp=row[4],
                sequence=row[5],
            )
            for row in rows
        ]

    async def create_snapshot(self, state: Dict[str, Any]) -> Snapshot:
        """创建快照"""
        await self.flush()

        snapshot = Snapshot(
            snapshot_id=str(uuid.uuid4()),
            stream_id=self._stream_id,
            sequence=self._sequence,
            state=state,
            timestamp=time.time(),
        )

        self._conn.execute(
            """INSERT INTO snapshots
            (snapshot_id, stream_id, sequence, state, timestamp)
            VALUES (?, ?, ?, ?, ?)""",
            (
                snapshot.snapshot_id,
                snapshot.stream_id,
                snapshot.sequence,
                json.dumps(snapshot.state, ensure_ascii=False),
                snapshot.timestamp,
            )
        )
        self._conn.commit()

        return snapshot

    async def get_latest_snapshot(self) -> Optional[Snapshot]:
        """获取最新快照"""
        row = self._conn.execute(
            """SELECT snapshot_id, stream_id, sequence, state, timestamp
            FROM snapshots
            WHERE stream_id = ?
            ORDER BY sequence DESC LIMIT 1""",
            (self._stream_id,),
        ).fetchone()

        if not row:
            return None

        return Snapshot(
            snapshot_id=row[0],
            stream_id=row[1],
            sequence=row[2],
            state=json.loads(row[3]),
            timestamp=row[4],
        )

    async def compact(self, keep_after_sequence: Optional[int] = None) -> int:
        """压缩历史事件（删除快照之前的事件）"""
        snapshot = await self.get_latest_snapshot()
        if not snapshot:
            return 0

        cutoff = keep_after_sequence if keep_after_sequence is not None else snapshot.sequence

        cursor = self._conn.execute(
            "DELETE FROM events WHERE stream_id = ? AND sequence <= ? AND sequence < ?",
            (self._stream_id, cutoff, self._sequence - 1000)  # 保留最近1000条
        )
        self._conn.commit()

        deleted = cursor.rowcount
        logger.info(f"Compacted {deleted} events before sequence {cutoff}")
        return deleted

    async def _periodic_flush(self) -> None:
        """定期刷新缓冲区"""
        while self._running:
            try:
                await asyncio.sleep(self._flush_interval)
                await self.flush()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Periodic flush error: {e}")

    @property
    def current_sequence(self) -> int:
        """当前序列号"""
        return self._sequence

    @property
    def buffer_size(self) -> int:
        """缓冲区大小"""
        return len(self._buffer)
