import json
import sqlite3
from pathlib import Path
from typing import Any, Dict, List, Optional
from flowforge.core.tracing import get_logger

logger = get_logger("checkpoint_manager")


class CheckpointManager:

    def __init__(self, db_path: str = "data/checkpoints.db"):
        self._db_path = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._ensure_schema()
        self._conn.commit()

    def _ensure_schema(self):
        cursor = self._conn.execute("PRAGMA table_info(checkpoints)")
        columns = {row[1] for row in cursor.fetchall()}

        if not columns:
            self._conn.execute("""
                CREATE TABLE checkpoints (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id TEXT NOT NULL,
                    step_name TEXT NOT NULL,
                    state_json TEXT NOT NULL,
                    messages_json TEXT,
                    version INTEGER DEFAULT 1,
                    label TEXT DEFAULT '',
                    created_at TEXT DEFAULT (datetime('now'))
                )
            """)
            self._conn.execute("CREATE INDEX IF NOT EXISTS idx_cp_task_id ON checkpoints (task_id)")
            self._conn.execute("CREATE INDEX IF NOT EXISTS idx_cp_task_created ON checkpoints (task_id, created_at)")
            return

        if "id" not in columns:
            self._conn.execute("ALTER TABLE checkpoints RENAME TO _checkpoints_old")
            self._conn.execute("""
                CREATE TABLE checkpoints (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id TEXT NOT NULL,
                    step_name TEXT NOT NULL,
                    state_json TEXT NOT NULL,
                    messages_json TEXT,
                    version INTEGER DEFAULT 1,
                    label TEXT DEFAULT '',
                    created_at TEXT DEFAULT (datetime('now'))
                )
            """)
            self._conn.execute("""
                INSERT INTO checkpoints (task_id, step_name, state_json, created_at)
                SELECT task_id, step_name, state_json, created_at FROM _checkpoints_old
            """)
            self._conn.execute("DROP TABLE _checkpoints_old")
            self._conn.execute("CREATE INDEX IF NOT EXISTS idx_cp_task_id ON checkpoints (task_id)")
            self._conn.execute("CREATE INDEX IF NOT EXISTS idx_cp_task_created ON checkpoints (task_id, created_at)")
        else:
            if "messages_json" not in columns:
                self._conn.execute("ALTER TABLE checkpoints ADD COLUMN messages_json TEXT")
            if "version" not in columns:
                self._conn.execute("ALTER TABLE checkpoints ADD COLUMN version INTEGER DEFAULT 1")
            if "label" not in columns:
                self._conn.execute("ALTER TABLE checkpoints ADD COLUMN label TEXT DEFAULT ''")

    def save(self, task_id: str, step_name: str, state: Dict[str, Any]) -> None:
        state_json = json.dumps(state, ensure_ascii=False, default=str)
        existing = self._conn.execute(
            "SELECT id, version FROM checkpoints WHERE task_id = ? AND step_name = ? ORDER BY created_at DESC LIMIT 1",
            (task_id, step_name)
        ).fetchone()
        if existing:
            new_version = (existing[1] or 1) + 1
            self._conn.execute(
                "UPDATE checkpoints SET state_json = ?, version = ? WHERE id = ?",
                (state_json, new_version, existing[0])
            )
        else:
            self._conn.execute(
                "INSERT INTO checkpoints (task_id, step_name, state_json) VALUES (?, ?, ?)",
                (task_id, step_name, state_json)
            )
        self._conn.commit()
        logger.debug(f"checkpoint saved: task={task_id} step={step_name}")

    def save_full(self, task_id: str, state: dict, messages: list, label: str = "") -> str:
        state_json = json.dumps(state, ensure_ascii=False, default=str)
        messages_json = json.dumps(messages, ensure_ascii=False, default=str)
        max_version_row = self._conn.execute(
            "SELECT MAX(version) FROM checkpoints WHERE task_id = ?",
            (task_id,)
        ).fetchone()
        max_version = max_version_row[0] if max_version_row and max_version_row[0] is not None else 0
        version = max_version + 1
        step_name = label or f"v{version}"
        cursor = self._conn.execute(
            "INSERT INTO checkpoints (task_id, step_name, state_json, messages_json, version, label) VALUES (?, ?, ?, ?, ?, ?)",
            (task_id, step_name, state_json, messages_json, version, label)
        )
        self._conn.commit()
        logger.debug(f"checkpoint saved_full: task={task_id} version={version} label={label}")
        return str(cursor.lastrowid)

    def save_incremental(self, task_id: str, state: dict, messages: list, label: str = "") -> str:
        latest = self.get_latest(task_id)
        if latest:
            latest_state = latest.get("state", {})
            if latest_state == state:
                logger.debug(f"checkpoint skipped (unchanged): task={task_id}")
                return str(latest.get("id", ""))
        return self.save_full(task_id, state, messages, label)

    def restore(self, task_id: str, checkpoint_id: Optional[str] = None) -> dict:
        if checkpoint_id:
            row = self._conn.execute(
                "SELECT state_json, messages_json FROM checkpoints WHERE id = ?",
                (int(checkpoint_id),)
            ).fetchone()
        else:
            row = self._conn.execute(
                "SELECT state_json, messages_json FROM checkpoints WHERE task_id = ? ORDER BY created_at DESC LIMIT 1",
                (task_id,)
            ).fetchone()
        if row:
            return {
                "state": json.loads(row[0]),
                "messages": json.loads(row[1]) if row[1] else [],
            }
        return {"state": {}, "messages": []}

    def load(self, task_id: str, step_name: str) -> Optional[Dict[str, Any]]:
        row = self._conn.execute(
            "SELECT state_json FROM checkpoints WHERE task_id = ? AND step_name = ? ORDER BY created_at DESC LIMIT 1",
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

    def get_latest(self, task_id: str) -> Optional[dict]:
        row = self._conn.execute(
            "SELECT id, task_id, step_name, state_json, messages_json, version, label, created_at "
            "FROM checkpoints WHERE task_id = ? ORDER BY created_at DESC LIMIT 1",
            (task_id,)
        ).fetchone()
        if row:
            return {
                "id": row[0],
                "task_id": row[1],
                "step_name": row[2],
                "state": json.loads(row[3]),
                "messages": json.loads(row[4]) if row[4] else [],
                "version": row[5],
                "label": row[6],
                "created_at": row[7],
            }
        return None

    def delete(self, task_id: str) -> None:
        self._conn.execute("DELETE FROM checkpoints WHERE task_id = ?", (task_id,))
        self._conn.commit()
        logger.debug(f"checkpoints deleted: task={task_id}")

    def delete_old_versions(self, task_id: str, keep_latest: int = 5) -> int:
        ids_to_keep = self._conn.execute(
            "SELECT id FROM checkpoints WHERE task_id = ? ORDER BY created_at DESC LIMIT ?",
            (task_id, keep_latest)
        ).fetchall()
        if not ids_to_keep:
            return 0
        id_list = [row[0] for row in ids_to_keep]
        placeholders = ",".join("?" * len(id_list))
        cursor = self._conn.execute(
            f"DELETE FROM checkpoints WHERE task_id = ? AND id NOT IN ({placeholders})",
            [task_id] + id_list
        )
        self._conn.commit()
        count = cursor.rowcount
        if count:
            logger.debug(f"deleted {count} old checkpoints: task={task_id} kept={keep_latest}")
        return count

    def list_checkpoints(self, task_id: str) -> list:
        rows = self._conn.execute(
            "SELECT step_name, created_at, version, label FROM checkpoints WHERE task_id = ? ORDER BY created_at",
            (task_id,)
        ).fetchall()
        return [{"step": r[0], "created_at": r[1], "version": r[2], "label": r[3]} for r in rows]
