"""DurableEventStream — 持久化事件流

设计文档参考：S3.0-20 INF-02, CAP-11
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import sqlite3
import time
import uuid
from typing import Any, Dict, List, Optional

from pydantic import BaseModel

logger = logging.getLogger(__name__)


class StreamEvent(BaseModel):
    event_id: str = ""
    event_type: str = ""
    data: Dict[str, Any] = {}
    metadata: Dict[str, Any] = {}
    timestamp: float = 0.0
    sequence: int = 0


class Snapshot(BaseModel):
    snapshot_id: str = ""
    stream_id: str = ""
    sequence: int = 0
    state: Dict[str, Any] = {}
    timestamp: float = 0.0


class DurableEventStream:
    """持久化事件流 — SQLite WAL模式，批量提交，事件回放，snapshot compaction"""

    def __init__(self, db_path: str = "", stream_id: str = "default", batch_size: int = 100, flush_interval: float = 1.0):
        self._stream_id = stream_id
        self._batch_size = batch_size
        self._flush_interval = flush_interval
        self._buffer: List[StreamEvent] = []
        self._sequence = 0
        self._flush_task: Optional[asyncio.Task] = None
        self._running = False

        if not db_path:
            data_dir = os.environ.get("FLOWFORGE_DATA_DIR", "data")
            os.makedirs(data_dir, exist_ok=True)
            db_path = os.path.join(data_dir, "event_stream.db")
        self._db_path = db_path
        logger.info(f"DurableEventStream init: db_path={self._db_path}, stream_id={stream_id}, batch_size={batch_size}, flush_interval={flush_interval}")
        self._init_db()

    def _init_db(self) -> None:
        self._conn = sqlite3.connect(self._db_path)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA synchronous=NORMAL")
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS events (
                event_id TEXT PRIMARY KEY, stream_id TEXT NOT NULL,
                event_type TEXT NOT NULL, data TEXT NOT NULL,
                metadata TEXT NOT NULL, timestamp REAL NOT NULL,
                sequence INTEGER NOT NULL
            )
        """)
        self._conn.execute("CREATE INDEX IF NOT EXISTS idx_events_stream_seq ON events(stream_id, sequence)")
        self._conn.execute("CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type)")
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS snapshots (
                snapshot_id TEXT PRIMARY KEY, stream_id TEXT NOT NULL,
                sequence INTEGER NOT NULL, state TEXT NOT NULL,
                timestamp REAL NOT NULL
            )
        """)
        self._conn.commit()
        row = self._conn.execute("SELECT MAX(sequence) FROM events WHERE stream_id = ?", (self._stream_id,)).fetchone()
        self._sequence = row[0] if row[0] is not None else 0
        logger.info(f"DurableEventStream db initialized: db_path={self._db_path}, recovered_sequence={self._sequence}")

    async def start(self) -> None:
        self._running = True
        self._flush_task = asyncio.create_task(self._periodic_flush())
        logger.info(f"DurableEventStream started: stream_id={self._stream_id}, flush_interval={self._flush_interval}")

    async def stop(self) -> None:
        self._running = False
        if self._flush_task:
            self._flush_task.cancel()
            try:
                await self._flush_task
            except asyncio.CancelledError:
                pass
        await self.flush()
        self._conn.close()
        logger.info(f"DurableEventStream stopped: stream_id={self._stream_id}, final_sequence={self._sequence}, buffer_size={len(self._buffer)}")

    async def append(self, event_type: str, data: Dict[str, Any] = None, metadata: Dict[str, Any] = None) -> StreamEvent:
        self._sequence += 1
        event = StreamEvent(
            event_id=str(uuid.uuid4()), event_type=event_type,
            data=data or {}, metadata=metadata or {},
            timestamp=time.time(), sequence=self._sequence,
        )
        self._buffer.append(event)
        logger.debug(f"DurableEventStream append: event_type={event_type}, sequence={self._sequence}, buffer_size={len(self._buffer)}")
        if len(self._buffer) >= self._batch_size:
            await self.flush()
        return event

    async def flush(self) -> None:
        if not self._buffer:
            return
        events_to_flush = self._buffer[:]
        flush_count = len(events_to_flush)
        logger.debug(f"DurableEventStream flush start: event_count={flush_count}, stream_id={self._stream_id}")
        self._buffer.clear()
        try:
            for event in events_to_flush:
                self._conn.execute(
                    "INSERT OR IGNORE INTO events (event_id, stream_id, event_type, data, metadata, timestamp, sequence) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (event.event_id, self._stream_id, event.event_type,
                     json.dumps(event.data, ensure_ascii=False),
                     json.dumps(event.metadata, ensure_ascii=False),
                     event.timestamp, event.sequence)
                )
            self._conn.commit()
            logger.info(f"DurableEventStream flush success: event_count={flush_count}, stream_id={self._stream_id}")
        except Exception as e:
            logger.error(f"DurableEventStream flush failed: event_count={flush_count}, error={e}", exc_info=True)
            self._conn.rollback()
            self._buffer = events_to_flush + self._buffer

    async def replay(self, from_sequence: int = 0, event_type: Optional[str] = None, limit: int = 1000) -> List[StreamEvent]:
        await self.flush()
        logger.debug(f"DurableEventStream replay: from_sequence={from_sequence}, event_type={event_type}, limit={limit}, stream_id={self._stream_id}")
        query = "SELECT event_id, event_type, data, metadata, timestamp, sequence FROM events WHERE stream_id = ? AND sequence > ?"
        params: list = [self._stream_id, from_sequence]
        if event_type:
            query += " AND event_type = ?"
            params.append(event_type)
        query += " ORDER BY sequence ASC LIMIT ?"
        params.append(limit)
        rows = self._conn.execute(query, params).fetchall()
        result = [StreamEvent(event_id=r[0], event_type=r[1], data=json.loads(r[2]), metadata=json.loads(r[3]), timestamp=r[4], sequence=r[5]) for r in rows]
        logger.info(f"DurableEventStream replay result: event_count={len(result)}, from_sequence={from_sequence}, event_type={event_type}")
        return result

    async def create_snapshot(self, state: Dict[str, Any]) -> Snapshot:
        await self.flush()
        snapshot = Snapshot(snapshot_id=str(uuid.uuid4()), stream_id=self._stream_id, sequence=self._sequence, state=state, timestamp=time.time())
        self._conn.execute("INSERT INTO snapshots (snapshot_id, stream_id, sequence, state, timestamp) VALUES (?, ?, ?, ?, ?)",
                          (snapshot.snapshot_id, snapshot.stream_id, snapshot.sequence, json.dumps(snapshot.state, ensure_ascii=False), snapshot.timestamp))
        self._conn.commit()
        logger.info(f"DurableEventStream snapshot created: sequence={self._sequence}, state_size={len(json.dumps(state, ensure_ascii=False))}, stream_id={self._stream_id}")
        return snapshot

    async def get_latest_snapshot(self) -> Optional[Snapshot]:
        row = self._conn.execute("SELECT snapshot_id, stream_id, sequence, state, timestamp FROM snapshots WHERE stream_id = ? ORDER BY sequence DESC LIMIT 1", (self._stream_id,)).fetchone()
        if not row:
            logger.debug(f"DurableEventStream get_latest_snapshot: not found, stream_id={self._stream_id}")
            return None
        snapshot = Snapshot(snapshot_id=row[0], stream_id=row[1], sequence=row[2], state=json.loads(row[3]), timestamp=row[4])
        logger.debug(f"DurableEventStream get_latest_snapshot: found, sequence={snapshot.sequence}, stream_id={self._stream_id}")
        return snapshot

    async def compact(self, keep_after_sequence: Optional[int] = None) -> int:
        snapshot = await self.get_latest_snapshot()
        if not snapshot:
            logger.debug(f"DurableEventStream compact: no snapshot found, skipping, stream_id={self._stream_id}")
            return 0
        cutoff = keep_after_sequence if keep_after_sequence is not None else snapshot.sequence
        logger.debug(f"DurableEventStream compact: cutoff={cutoff}, current_sequence={self._sequence}, stream_id={self._stream_id}")
        cursor = self._conn.execute("DELETE FROM events WHERE stream_id = ? AND sequence <= ? AND sequence < ?", (self._stream_id, cutoff, self._sequence - 1000))
        self._conn.commit()
        deleted = cursor.rowcount
        logger.info(f"DurableEventStream compacted: deleted={deleted}, cutoff={cutoff}, stream_id={self._stream_id}")
        return deleted

    async def _periodic_flush(self) -> None:
        while self._running:
            try:
                await asyncio.sleep(self._flush_interval)
                logger.debug(f"DurableEventStream periodic flush triggered: buffer_size={len(self._buffer)}, stream_id={self._stream_id}")
                await self.flush()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"DurableEventStream periodic flush error: {e}", exc_info=True)

    @property
    def current_sequence(self) -> int:
        return self._sequence

    @property
    def buffer_size(self) -> int:
        return len(self._buffer)
