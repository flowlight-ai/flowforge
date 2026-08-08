"""EventStore — WAL模式事件存储.

写前日志(Write-Ahead Log)保证事件不丢失，批量提交+快照压缩优化性能。
适用于任务生命周期事件持久化、审计追踪、事件回放等场景。
"""

import asyncio
import json
import os
import time
from typing import Any

from pydantic import BaseModel

from flowforge.core.tracing import get_logger

logger = get_logger("session.event_store")


class EventStoreEntry(BaseModel):
    """事件条目."""

    id: int = 0
    event_type: str = ""
    data: dict[str, Any] = {}
    timestamp: float = 0.0
    trace_id: str = ""


class EventStore:
    """WAL模式事件存储 — 写前日志+批量提交+快照压缩.

    工作流程:
    1. append() 写入WAL文件（保证持久性）
    2. 积累到batch_size后自动commit到快照
    3. commit时清空WAL文件
    4. 启动时先加载快照，再重放WAL中增量事件
    5. compact() 可压缩历史数据，只保留最近N条
    """

    def __init__(self, store_dir: str = ".flowforge/events"):
        self._store_dir = store_dir
        self._wal_file = os.path.join(store_dir, "wal.jsonl")
        self._snapshot_file = os.path.join(store_dir, "snapshot.json")
        self._entries: list[EventStoreEntry] = []
        self._next_id = 1
        self._batch: list[EventStoreEntry] = []
        self._batch_size = 100
        self._lock = asyncio.Lock()
        os.makedirs(store_dir, exist_ok=True)
        self._load()

    def _load(self):
        """加载快照+WAL重放."""
        # 1. 加载快照
        if os.path.exists(self._snapshot_file):
            try:
                with open(self._snapshot_file, encoding="utf-8") as f:
                    data = json.load(f)
                self._entries = [EventStoreEntry(**e) for e in data.get("entries", [])]
                self._next_id = data.get("next_id", 1)
                logger.info(f"EventStore加载快照: {len(self._entries)}条事件, next_id={self._next_id}")
            except Exception as e:
                logger.error(f"EventStore加载快照失败: {e}")
                self._entries = []
                self._next_id = 1

        # 2. 重放WAL
        if os.path.exists(self._wal_file):
            replay_count = 0
            try:
                with open(self._wal_file, encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            entry = EventStoreEntry(**json.loads(line))
                            if entry.id >= self._next_id:
                                self._entries.append(entry)
                                self._next_id = entry.id + 1
                                replay_count += 1
                        except json.JSONDecodeError:
                            logger.warning(f"WAL行解析失败，跳过: {line[:100]}")
                if replay_count > 0:
                    logger.info(f"EventStore重放WAL: {replay_count}条增量事件")
            except Exception as e:
                logger.error(f"EventStore重放WAL失败: {e}")

    async def append(self, event_type: str, data: dict[str, Any], trace_id: str = "") -> EventStoreEntry:
        """追加事件.

        先写WAL保证持久性，积累到batch_size后自动提交快照。
        """
        async with self._lock:
            entry = EventStoreEntry(
                id=self._next_id,
                event_type=event_type,
                data=data,
                timestamp=time.time(),
                trace_id=trace_id,
            )
            self._next_id += 1
            self._entries.append(entry)
            self._batch.append(entry)

            # 写WAL
            try:
                with open(self._wal_file, "a", encoding="utf-8") as f:
                    f.write(entry.model_dump_json() + "\n")
            except Exception as e:
                logger.error(f"EventStore写WAL失败: {e}")

            # 批量提交
            if len(self._batch) >= self._batch_size:
                await self._commit()

            return entry

    async def _commit(self):
        """提交批量事件到快照，清空WAL."""
        try:
            with open(self._snapshot_file, "w", encoding="utf-8") as f:
                json.dump(
                    {
                        "entries": [e.model_dump() for e in self._entries],
                        "next_id": self._next_id,
                    },
                    f,
                    ensure_ascii=False,
                )
            # 清空WAL
            self._batch.clear()
            if os.path.exists(self._wal_file):
                os.remove(self._wal_file)
            logger.info(f"EventStore提交快照: {len(self._entries)}条事件")
        except Exception as e:
            logger.error(f"EventStore提交快照失败: {e}")

    async def query(
        self,
        event_type: str | None = None,
        trace_id: str | None = None,
        since: float | None = None,
        limit: int = 100,
    ) -> list[EventStoreEntry]:
        """查询事件（按时间倒序返回最新事件）."""
        results: list[EventStoreEntry] = []
        for entry in reversed(self._entries):
            if event_type and entry.event_type != event_type:
                continue
            if trace_id and entry.trace_id != trace_id:
                continue
            if since and entry.timestamp < since:
                continue
            results.append(entry)
            if len(results) >= limit:
                break
        return results

    async def compact(self, keep_last_n: int = 1000):
        """压缩：只保留最近N条事件."""
        if len(self._entries) > keep_last_n:
            self._entries = self._entries[-keep_last_n:]
            await self._commit()
            logger.info(f"EventStore压缩: 保留最近{keep_last_n}条事件")

    @property
    def entry_count(self) -> int:
        """当前存储的事件总数."""
        return len(self._entries)
