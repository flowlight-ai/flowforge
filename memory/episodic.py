import json
import sqlite3
import datetime
from typing import Any

class EpisodicMemory:
    def __init__(self, db_url: str = None):
        db_path = (db_url or "data/episodic.db").replace("sqlite:///", "")
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.execute("CREATE TABLE IF NOT EXISTS episodes (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, trace TEXT, created_at TEXT)")
        self.conn.commit()

    async def store(self, key: str, value: Any) -> None:
        self.conn.execute("INSERT INTO episodes (task_id, trace, created_at) VALUES (?, ?, ?)",
                          (key, json.dumps(value), datetime.datetime.utcnow().isoformat()))
        self.conn.commit()

    async def search(self, query: str, limit: int = 10) -> list:
        rows = self.conn.execute("SELECT trace FROM episodes WHERE task_id LIKE ? ORDER BY id DESC LIMIT ?",
                                 (f"%{query}%", limit)).fetchall()
        return [json.loads(row[0]) for row in rows]
