import asyncio
import json
import sqlite3
import datetime
from datetime import timezone
from pathlib import Path
from typing import Any

from .base import EchoStore


class LongTermMemory(EchoStore):
    def __init__(self, db_url: str = None):
        db_path = (db_url or "data/long_term.db").replace("sqlite:///", "")
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.execute("CREATE TABLE IF NOT EXISTS long_mem (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT, value TEXT, created_at TEXT)")
        self.conn.commit()

    async def store(self, key: str, value: Any) -> None:
        # P-110: 同步 sqlite 操作放入线程池，避免阻塞事件循环
        await asyncio.to_thread(self._store_sync, key, value)

    def _store_sync(self, key: str, value: Any) -> None:
        self.conn.execute("INSERT INTO long_mem (key, value, created_at) VALUES (?, ?, ?)",
                          (key, json.dumps(value), datetime.datetime.now(timezone.utc).isoformat()))
        self.conn.commit()

    async def search(self, query: str, limit: int = 10) -> list:
        # P-110: 同步 sqlite 操作放入线程池，避免阻塞事件循环
        return await asyncio.to_thread(self._search_sync, query, limit)

    def _search_sync(self, query: str, limit: int) -> list:
        rows = self.conn.execute(
            "SELECT value FROM long_mem WHERE key LIKE ? OR value LIKE ? ORDER BY id DESC LIMIT ?",
            (f"%{query}%", f"%{query}%", limit)
        ).fetchall()
        return [json.loads(row[0]) for row in rows]
