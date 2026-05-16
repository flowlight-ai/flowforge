import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, Query
from flowforge.core.tracing import get_trace_id, get_logger, get_log_file_path
from flowforge.core.config import system_config

logger = get_logger("audit_logger")

router = APIRouter(prefix="/logs", tags=["logs"])


class AuditLogger:
    def __init__(self, db_path: str = None):
        self._db_path = db_path or system_config.db_url.replace("sqlite:///", "data/audit_logs.db")
        if self._db_path.startswith("sqlite:///"):
            self._db_path = self._db_path.replace("sqlite:///", "")
        Path(self._db_path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self._db_path, check_same_thread=False)
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS audit_logs (
                id TEXT PRIMARY KEY,
                timestamp TEXT,
                level TEXT,
                task_id TEXT,
                mode TEXT,
                action TEXT,
                details TEXT,
                trace_id TEXT
            )
        """)
        self._conn.execute("CREATE INDEX IF NOT EXISTS idx_audit_task_id ON audit_logs(task_id)")
        self._conn.execute("CREATE INDEX IF NOT EXISTS idx_audit_level ON audit_logs(level)")
        self._conn.execute("CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp)")
        self._conn.commit()

    def log(self, level: str, action: str, task_id: str = "",
            mode: str = "", details: dict = None, trace_id: str = ""):
        log_id = str(uuid.uuid4())
        timestamp = datetime.now(timezone.utc).isoformat() + "Z"
        details_json = json.dumps(details or {}, ensure_ascii=False, default=str)
        self._conn.execute(
            "INSERT INTO audit_logs (id, timestamp, level, task_id, mode, action, details, trace_id) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (log_id, timestamp, level, task_id, mode, action, details_json, trace_id),
        )
        self._conn.commit()

    def query(self, task_id: str = None, level: str = None, mode: str = None,
              limit: int = 50, offset: int = 0) -> dict:
        query_sql = "SELECT id, timestamp, level, task_id, mode, action, details, trace_id FROM audit_logs WHERE 1=1"
        params = []
        if task_id:
            query_sql += " AND task_id = ?"
            params.append(task_id)
        if level:
            query_sql += " AND level = ?"
            params.append(level)
        if mode:
            query_sql += " AND mode = ?"
            params.append(mode)
        count_sql = query_sql.replace(
            "SELECT id, timestamp, level, task_id, mode, action, details, trace_id",
            "SELECT COUNT(*)",
        )
        total = self._conn.execute(count_sql, params).fetchone()[0]
        query_sql += " ORDER BY timestamp DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        rows = self._conn.execute(query_sql, params).fetchall()
        items = []
        for row in rows:
            items.append({
                "id": row[0], "timestamp": row[1], "level": row[2],
                "task_id": row[3], "mode": row[4], "action": row[5],
                "details": json.loads(row[6]) if row[6] else {},
                "trace_id": row[7],
            })
        return {"items": items, "total": total}


_audit_logger: Optional[AuditLogger] = None


def get_audit_logger() -> AuditLogger:
    global _audit_logger
    if _audit_logger is None:
        _audit_logger = AuditLogger()
    return _audit_logger


def _make_response(data: dict) -> dict:
    return {
        "status": "success",
        "data": data,
        "meta": {"trace_id": get_trace_id(), "timestamp": datetime.now(timezone.utc).isoformat() + "Z"},
    }


@router.get("")
async def query_logs(
    task_id: str = Query(None),
    level: str = Query(None),
    mode: str = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    audit = get_audit_logger()
    result = audit.query(task_id=task_id, level=level, mode=mode, limit=limit, offset=offset)
    return _make_response(result)


@router.get("/stream")
async def stream_logs(
    lines: int = Query(100, ge=1, le=1000),
    level: str = Query(None),
):
    log_file = get_log_file_path()
    if not log_file.exists():
        return _make_response({"items": [], "total": 0})
    with open(log_file, "r", encoding="utf-8") as f:
        all_lines = f.readlines()
    filtered = []
    for line in all_lines:
        stripped = line.rstrip("\n")
        if not stripped:
            continue
        if level and f"[{level.upper()}]" not in stripped:
            continue
        filtered.append(stripped)
    result_lines = filtered[-lines:]
    return _make_response({"items": result_lines, "total": len(filtered)})


@router.get("/file")
async def get_log_file():
    from starlette.responses import Response
    log_file = get_log_file_path()
    if not log_file.exists():
        return Response(content="", media_type="text/plain; charset=utf-8")
    size = log_file.stat().st_size
    with open(log_file, "r", encoding="utf-8") as f:
        if size > 51200:
            f.seek(size - 51200)
            f.readline()
        content = f.read()
    return Response(content=content, media_type="text/plain; charset=utf-8")
