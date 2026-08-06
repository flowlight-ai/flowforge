import asyncio
import datetime
import json
import sqlite3
from pathlib import Path
from typing import Any

from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.memory.task_board")


class TaskBoard:
    STATUS_PENDING = "pending"
    STATUS_CLAIMED = "claimed"
    STATUS_COMPLETED = "completed"
    STATUS_FAILED = "failed"

    def __init__(self, db_path: str = "data/task_board.db"):
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._db_path = db_path
        self._supports_returning = self._check_returning_support()
        self._claim_lock = asyncio.Lock()
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id TEXT UNIQUE NOT NULL,
                task_type TEXT NOT NULL,
                payload TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                claimed_by TEXT,
                created_at TEXT NOT NULL,
                claimed_at TEXT,
                completed_at TEXT,
                error_message TEXT
            )
        """)
        self.conn.commit()

    def _check_returning_support(self) -> bool:
        try:
            temp_conn = sqlite3.connect(self._db_path)
            version = temp_conn.execute("SELECT sqlite_version()").fetchone()[0]
            parts = version.split(".")
            major, minor = int(parts[0]), int(parts[1])
            temp_conn.close()
            return (major, minor) >= (3, 35)
        except Exception:
            return False

    async def add_task(self, task_id: str, task_type: str, payload: dict) -> int:
        now = datetime.datetime.now(datetime.UTC).isoformat()
        cursor = self.conn.execute(
            "INSERT INTO tasks (task_id, task_type, payload, status, created_at) VALUES (?, ?, ?, ?, ?)",
            (task_id, task_type, json.dumps(payload), self.STATUS_PENDING, now),
        )
        self.conn.commit()
        logger.info(f"Task added: task_id={task_id}, type={task_type}")
        return cursor.lastrowid

    async def add_tasks_batch(self, tasks: list[dict[str, Any]]) -> list[int]:
        now = datetime.datetime.now(datetime.UTC).isoformat()
        ids = []
        for t in tasks:
            cursor = self.conn.execute(
                "INSERT INTO tasks (task_id, task_type, payload, status, created_at) VALUES (?, ?, ?, ?, ?)",
                (t["task_id"], t["task_type"], json.dumps(t["payload"]), self.STATUS_PENDING, now),
            )
            ids.append(cursor.lastrowid)
        self.conn.commit()
        logger.info(f"Batch added {len(tasks)} tasks")
        return ids

    async def claim_task(self, claimant: str, task_type: str | None = None) -> dict | None:
        now = datetime.datetime.now(datetime.UTC).isoformat()
        if self._supports_returning:
            if task_type:
                query = (
                    "UPDATE tasks SET status = ?, claimed_by = ?, claimed_at = ? "
                    "WHERE id = ("
                    "  SELECT id FROM tasks WHERE status = ? AND task_type = ? "
                    "  ORDER BY created_at ASC LIMIT 1"
                    ") RETURNING id, task_id, task_type, payload, status, claimed_by, created_at, claimed_at"
                )
                params = (self.STATUS_CLAIMED, claimant, now, self.STATUS_PENDING, task_type)
            else:
                query = (
                    "UPDATE tasks SET status = ?, claimed_by = ?, claimed_at = ? "
                    "WHERE id = ("
                    "  SELECT id FROM tasks WHERE status = ? "
                    "  ORDER BY created_at ASC LIMIT 1"
                    ") RETURNING id, task_id, task_type, payload, status, claimed_by, created_at, claimed_at"
                )
                params = (self.STATUS_CLAIMED, claimant, now, self.STATUS_PENDING)
            row = self.conn.execute(query, params).fetchone()
            self.conn.commit()
            if row:
                logger.info(f"Task claimed: task_id={row[1]}, claimant={claimant}")
                return self._row_to_dict(row)
            return None

        async with self._claim_lock:
            if task_type:
                row = self.conn.execute(
                    "SELECT id, task_id, task_type, payload, status, claimed_by, created_at, claimed_at "
                    "FROM tasks WHERE status = ? AND task_type = ? ORDER BY created_at ASC LIMIT 1",
                    (self.STATUS_PENDING, task_type),
                ).fetchone()
            else:
                row = self.conn.execute(
                    "SELECT id, task_id, task_type, payload, status, claimed_by, created_at, claimed_at "
                    "FROM tasks WHERE status = ? ORDER BY created_at ASC LIMIT 1",
                    (self.STATUS_PENDING,),
                ).fetchone()
            if not row:
                return None
            task_pk = row[0]
            self.conn.execute(
                "UPDATE tasks SET status = ?, claimed_by = ?, claimed_at = ? WHERE id = ? AND status = ?",
                (self.STATUS_CLAIMED, claimant, now, task_pk, self.STATUS_PENDING),
            )
            self.conn.commit()
            updated = self.conn.execute(
                "SELECT id, task_id, task_type, payload, status, claimed_by, created_at, claimed_at "
                "FROM tasks WHERE id = ?",
                (task_pk,),
            ).fetchone()
            logger.info(f"Task claimed: task_id={updated[1]}, claimant={claimant}")
            return self._row_to_dict(updated)

    async def complete_task(self, task_id: str, result: dict | None = None) -> bool:
        now = datetime.datetime.now(datetime.UTC).isoformat()
        payload = json.dumps(result) if result else None
        cursor = self.conn.execute(
            "UPDATE tasks SET status = ?, completed_at = ?, payload = ? WHERE task_id = ? AND status = ?",
            (self.STATUS_COMPLETED, now, payload, task_id, self.STATUS_CLAIMED),
        )
        self.conn.commit()
        success = cursor.rowcount > 0
        if success:
            logger.info(f"Task completed: task_id={task_id}")
        else:
            logger.warning(f"Task complete failed: task_id={task_id}")
        return success

    async def fail_task(self, task_id: str, error_message: str) -> bool:
        now = datetime.datetime.now(datetime.UTC).isoformat()
        cursor = self.conn.execute(
            "UPDATE tasks SET status = ?, completed_at = ?, error_message = ? WHERE task_id = ? AND status = ?",
            (self.STATUS_FAILED, now, error_message, task_id, self.STATUS_CLAIMED),
        )
        self.conn.commit()
        success = cursor.rowcount > 0
        if success:
            logger.info(f"Task failed: task_id={task_id}, error={error_message}")
        else:
            logger.warning(f"Task fail failed: task_id={task_id}")
        return success

    async def get_all_tasks(self, status: str | None = None) -> list[dict]:
        if status:
            rows = self.conn.execute(
                "SELECT id, task_id, task_type, payload, status, claimed_by, created_at, claimed_at "
                "FROM tasks WHERE status = ? ORDER BY created_at ASC",
                (status,),
            ).fetchall()
        else:
            rows = self.conn.execute(
                "SELECT id, task_id, task_type, payload, status, claimed_by, created_at, claimed_at "
                "FROM tasks ORDER BY created_at ASC",
            ).fetchall()
        return [self._row_to_dict(row) for row in rows]

    async def reset_stuck_tasks(self, timeout_seconds: int = 3600) -> int:
        cutoff = (
            datetime.datetime.now(datetime.UTC) - datetime.timedelta(seconds=timeout_seconds)
        ).isoformat()
        cursor = self.conn.execute(
            "UPDATE tasks SET status = ?, claimed_by = NULL, claimed_at = NULL "
            "WHERE status = ? AND claimed_at < ?",
            (self.STATUS_PENDING, self.STATUS_CLAIMED, cutoff),
        )
        self.conn.commit()
        count = cursor.rowcount
        if count:
            logger.info(f"Reset {count} stuck tasks (timeout={timeout_seconds}s)")
        return count

    def _row_to_dict(self, row) -> dict:
        return {
            "id": row[0],
            "task_id": row[1],
            "task_type": row[2],
            "payload": json.loads(row[3]) if row[3] else None,
            "status": row[4],
            "claimed_by": row[5],
            "created_at": row[6],
            "claimed_at": row[7],
        }
