import asyncio
import json
import time
import sqlite3
from pathlib import Path
from typing import Any

from .base import EchoStore


class ShortTermMemory(EchoStore):
    def __init__(self, db_url: str = None):
        db_path = (db_url or "data/short_term.db").replace("sqlite:///", "")
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.execute("CREATE TABLE IF NOT EXISTS short_mem (key TEXT PRIMARY KEY, value TEXT, expires_at REAL)")
        self.conn.commit()

    async def store(self, key: str, value: Any, ttl: int = 3600) -> None:
        # P-110: 同步 sqlite 操作放入线程池，避免阻塞事件循环
        await asyncio.to_thread(self._store_sync, key, value, ttl)

    def _store_sync(self, key: str, value: Any, ttl: int) -> None:
        expires = time.time() + ttl
        self.conn.execute("INSERT OR REPLACE INTO short_mem VALUES (?, ?, ?)", (key, json.dumps(value), expires))
        self.conn.commit()

    async def search(self, query: str, limit: int = 10) -> list:
        # P-110: 同步 sqlite 操作放入线程池，避免阻塞事件循环
        return await asyncio.to_thread(self._search_sync, query, limit)

    def _search_sync(self, query: str, limit: int) -> list:
        self.conn.execute("DELETE FROM short_mem WHERE expires_at < ?", (time.time(),))
        self.conn.commit()
        rows = self.conn.execute(
            "SELECT key, value FROM short_mem WHERE key LIKE ? OR value LIKE ? ORDER BY expires_at DESC LIMIT ?",
            (f"%{query}%", f"%{query}%", limit)
        ).fetchall()
        return [{"key": row[0], "value": json.loads(row[1])} for row in rows]
