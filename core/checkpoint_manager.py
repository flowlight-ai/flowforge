import json
import sqlite3
from pathlib import Path
from typing import Any, Dict, Optional
from flowforge.core.tracing import get_logger

logger = get_logger("checkpoint_manager")


class CheckpointManager:

    def __init__(self, db_path: str = "data/checkpoints.db"):
        self._db_path = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS checkpoints (
                task_id TEXT,
                step_name TEXT,
                state_json TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                PRIMARY KEY (task_id, step_name)
            )
        """)
        self._conn.commit()

    def save(self, task_id: str, step_name: str, state: Dict[str, Any]) -> None:
        state_json = json.dumps(state, ensure_ascii=False, default=str)
        self._conn.execute(
            "INSERT OR REPLACE INTO checkpoints (task_id, step_name, state_json) VALUES (?, ?, ?)",
            (task_id, step_name, state_json)
        )
        self._conn.commit()
        logger.debug(f"checkpoint saved: task={task_id} step={step_name}")

    def load(self, task_id: str, step_name: str) -> Optional[Dict[str, Any]]:
        row = self._conn.execute(
            "SELECT state_json FROM checkpoints WHERE task_id = ? AND step_name = ?",
            (task_id, step_name)
        ).fetchone()
        if row:
            return json.loads(row[0])
        return None

    def load_latest(self, task_id: str) -> Optional[Dict[str, Any]]:
        row = self._conn.execute(
            "SELECT state_json FROM checkpoints WHERE task_id = ? ORDER BY created_at DESC LIMIT 1",
            (task_id,)
        ).fetchone()
        if row:
            return json.loads(row[0])
        return None

    def delete(self, task_id: str) -> None:
        self._conn.execute("DELETE FROM checkpoints WHERE task_id = ?", (task_id,))
        self._conn.commit()
        logger.debug(f"checkpoints deleted: task={task_id}")

    def list_checkpoints(self, task_id: str) -> list:
        rows = self._conn.execute(
            "SELECT step_name, created_at FROM checkpoints WHERE task_id = ? ORDER BY created_at",
            (task_id,)
        ).fetchall()
        return [{"step": r[0], "created_at": r[1]} for r in rows]
