"""TaskStore — SQLite 实现。

提供任务持久化存储，支持异步轮询和进度反馈。
"""
import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Optional

from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.task_store")

_DEFAULT_DB_PATH = Path(__file__).parent.parent / "data" / "tasks.db"

_CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS tasks (
    task_id TEXT PRIMARY KEY,
    type TEXT NOT NULL DEFAULT 'create',
    status TEXT NOT NULL DEFAULT 'running',
    request_json TEXT,
    result_json TEXT,
    error_json TEXT,
    progress_json TEXT,
    idempotency_key TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    completed_at TEXT,
    updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_idempotency ON tasks(idempotency_key);
"""


class TaskStore:
    """SQLite 任务存储 — 支持异步轮询和进度反馈。"""

    _instance: Optional["TaskStore"] = None

    def __init__(self, db_path: Path | None = None) -> None:
        self._db_path = db_path or _DEFAULT_DB_PATH
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn: sqlite3.Connection | None = None
        self._init_db()

    @classmethod
    def instance(cls, db_path: Path | None = None) -> "TaskStore":
        if cls._instance is None:
            cls._instance = cls(db_path=db_path)
        return cls._instance

    def _init_db(self) -> None:
        """初始化数据库表结构。"""
        self._conn = sqlite3.connect(str(self._db_path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.executescript(_CREATE_TABLE_SQL)
        # 自动迁移：添加 progress_json 列（如果不存在）
        try:
            self._conn.execute("ALTER TABLE tasks ADD COLUMN progress_json TEXT")
        except sqlite3.OperationalError:
            pass  # 列已存在
        self._conn.commit()
        logger.info(f"[TaskStore] 初始化完成: db={self._db_path}")

    def _row_to_dict(self, row: sqlite3.Row) -> dict[str, Any]:
        """将数据库行转换为字典。"""
        result = {
            "task_id": row["task_id"],
            "type": row["type"],
            "status": row["status"],
            "request": None,
            "result": None,
            "error": None,
            "progress": None,
            "idempotency_key": row["idempotency_key"] or "",
            "created_at": row["created_at"] or "",
            "completed_at": row["completed_at"] or "",
        }
        # 解析 JSON 字段
        if row["request_json"]:
            try:
                result["request"] = json.loads(row["request_json"])
            except (json.JSONDecodeError, TypeError):
                result["request"] = {}
        if row["result_json"]:
            try:
                result["result"] = json.loads(row["result_json"])
            except (json.JSONDecodeError, TypeError):
                result["result"] = {}
        if row["error_json"]:
            try:
                result["error"] = json.loads(row["error_json"])
            except (json.JSONDecodeError, TypeError):
                result["error"] = {}
        if row["progress_json"]:
            try:
                result["progress"] = json.loads(row["progress_json"])
            except (json.JSONDecodeError, TypeError):
                result["progress"] = {}
        return result

    async def init(self) -> None:
        """异步初始化（兼容旧接口）。"""
        pass

    async def close(self) -> None:
        """关闭数据库连接。"""
        if self._conn:
            self._conn.close()
            self._conn = None

    async def create_task(self, task_id: str, type: str,
                          request: dict[str, Any],
                          idempotency_key: str = "") -> dict[str, Any]:
        """创建任务记录。"""
        now = datetime.now(UTC).isoformat()
        request_json = json.dumps(request, ensure_ascii=False, default=str)
        try:
            self._conn.execute(
                "INSERT INTO tasks (task_id, type, status, request_json, idempotency_key, created_at, updated_at) "
                "VALUES (?, ?, 'running', ?, ?, ?, ?)",
                (task_id, type, request_json, idempotency_key, now, now),
            )
            self._conn.commit()
            logger.info(f"[TaskStore] 创建任务: task_id={task_id}, type={type}")
        except sqlite3.IntegrityError:
            logger.warning(f"[TaskStore] 任务已存在: task_id={task_id}")
        return {
            "task_id": task_id, "type": type, "status": "running",
            "request": request, "result": None, "error": None,
            "idempotency_key": idempotency_key,
        }

    async def get_task(self, task_id: str) -> dict[str, Any] | None:
        """获取任务记录。"""
        row = self._conn.execute(
            "SELECT * FROM tasks WHERE task_id = ?", (task_id,)
        ).fetchone()
        if row is None:
            return None
        return self._row_to_dict(row)

    async def update_task(self, task_id: str, **kwargs: Any) -> bool:
        """更新任务记录。支持: status, result, error, progress, completed_at。"""
        sets = []
        params = []
        now = datetime.now(UTC).isoformat()

        for key, value in kwargs.items():
            if key == "result":
                sets.append("result_json = ?")
                params.append(json.dumps(value, ensure_ascii=False, default=str))
            elif key == "error":
                sets.append("error_json = ?")
                params.append(json.dumps(value, ensure_ascii=False, default=str))
            elif key == "progress":
                sets.append("progress_json = ?")
                params.append(json.dumps(value, ensure_ascii=False, default=str))
            elif key in ("status", "completed_at"):
                sets.append(f"{key} = ?")
                params.append(value)
            else:
                logger.debug(f"[TaskStore] 忽略未知字段: {key}")

        if not sets:
            return False

        sets.append("updated_at = ?")
        params.append(now)
        params.append(task_id)

        try:
            cursor = self._conn.execute(
                f"UPDATE tasks SET {', '.join(sets)} WHERE task_id = ?",
                params,
            )
            self._conn.commit()
            updated = cursor.rowcount > 0
            if updated:
                logger.info(f"[TaskStore] 更新任务: task_id={task_id}, fields={list(kwargs.keys())}")
            return updated
        except Exception as e:
            logger.error(f"[TaskStore] 更新任务失败: task_id={task_id}, error={e}")
            return False

    async def get_by_idempotency_key(self, key: str) -> str | None:
        """通过幂等键查找任务ID。"""
        if not key:
            return None
        row = self._conn.execute(
            "SELECT task_id FROM tasks WHERE idempotency_key = ? LIMIT 1",
            (key,),
        ).fetchone()
        return row["task_id"] if row else None

    async def list_tasks(self, status: str | None = None,
                         limit: int = 50) -> list[dict[str, Any]]:
        """列出任务。"""
        if status:
            rows = self._conn.execute(
                "SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC LIMIT ?",
                (status, limit),
            ).fetchall()
        else:
            rows = self._conn.execute(
                "SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [self._row_to_dict(row) for row in rows]
