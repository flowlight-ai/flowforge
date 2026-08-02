import json
import sqlite3
from pathlib import Path
from typing import Any, Dict, List, Optional
from flowforge.core.tracing import get_logger

logger = get_logger("state_manager")


class StateManager:

    def __init__(self, db_path: str = "data/states.db"):
        self._db_path = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS task_states (
                task_id TEXT PRIMARY KEY,
                state_json TEXT,
                updated_at TEXT DEFAULT (datetime('now'))
            )
        """)
        self._conn.commit()

    def save_state(self, task_id: str, state: Dict[str, Any]) -> None:
        state_json = json.dumps(state, ensure_ascii=False, default=str)
        self._conn.execute(
            "INSERT OR REPLACE INTO task_states (task_id, state_json, updated_at) VALUES (?, ?, datetime('now'))",
            (task_id, state_json)
        )
        self._conn.commit()
        logger.debug(f"state saved: task={task_id}")

    def load_state(self, task_id: str) -> Optional[Dict[str, Any]]:
        row = self._conn.execute(
            "SELECT state_json FROM task_states WHERE task_id = ?",
            (task_id,)
        ).fetchone()
        if row:
            return json.loads(row[0])
        return None

    def delete_state(self, task_id: str) -> None:
        self._conn.execute("DELETE FROM task_states WHERE task_id = ?", (task_id,))
        self._conn.commit()
        logger.debug(f"state deleted: task={task_id}")

    def list_states(self) -> List[str]:
        rows = self._conn.execute("SELECT task_id FROM task_states ORDER BY updated_at DESC").fetchall()
        return [r[0] for r in rows]

    def list_states_with_data(self, persona: str = None, status: str = None,
                              mode: str = None, interaction_mode: str = None,
                              limit: int = 50, offset: int = 0) -> Dict[str, Any]:
        rows = self._conn.execute(
            "SELECT task_id, state_json, updated_at FROM task_states ORDER BY updated_at DESC"
        ).fetchall()
        items = []
        for task_id, state_json, updated_at in rows:
            state = json.loads(state_json)
            if persona and state.get("persona") != persona:
                continue
            if status and state.get("status") != status:
                continue
            if mode and state.get("mode") != mode:
                continue
            if interaction_mode and state.get("interaction_mode") != interaction_mode:
                continue
            state["task_id"] = task_id
            state["updated_at"] = updated_at
            items.append(state)
        total = len(items)
        items = items[offset:offset + limit]
        return {"items": items, "total": total}

    def count_by_status(self, status: str) -> int:
        rows = self._conn.execute("SELECT state_json FROM task_states").fetchall()
        count = 0
        for (state_json,) in rows:
            state = json.loads(state_json)
            if state.get("status") == status:
                count += 1
        return count

    def update_state(self, task_id: str, updates: Dict[str, Any]) -> None:
        current = self.load_state(task_id) or {}
        current.update(updates)
        self.save_state(task_id, current)
