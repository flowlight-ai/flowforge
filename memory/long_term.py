import json
import sqlite3
import datetime
from pathlib import Path
from typing import Any

class LongTermMemory:
    def __init__(self, db_url: str = None):
        db_path = (db_url or "data/long_term.db").replace("sqlite:///", "")
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.execute("CREATE TABLE IF NOT EXISTS long_mem (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT, value TEXT, created_at TEXT)")
        self.conn.commit()

    async def store(self, key: str, value: Any) -> None:
        self.conn.execute("INSERT INTO long_mem (key, value, created_at) VALUES (?, ?, ?)",
                          (key, json.dumps(value), datetime.datetime.utcnow().isoformat()))
        self.conn.commit()

    async def search(self, query: str, limit: int = 10) -> list:
        rows = self.conn.execute("SELECT value FROM long_mem WHERE key LIKE ? ORDER BY id DESC LIMIT ?",
                                 (f"%{query}%", limit)).fetchall()
        return [json.loads(row[0]) for row in rows]
