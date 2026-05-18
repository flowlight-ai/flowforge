import json
import sqlite3
import datetime
from datetime import timezone
from pathlib import Path
from typing import List, Optional, Dict, Any

from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.memory.mailbox")

PRIORITY_CRITICAL = "critical"
PRIORITY_HIGH = "high"
PRIORITY_NORMAL = "normal"
PRIORITY_LOW = "low"

PRIORITY_ORDER = {
    PRIORITY_CRITICAL: 0,
    PRIORITY_HIGH: 1,
    PRIORITY_NORMAL: 2,
    PRIORITY_LOW: 3,
}


class Mailbox:
    def __init__(self, db_path: str = "data/mailbox.db"):
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sender TEXT NOT NULL,
                recipient TEXT NOT NULL,
                subject TEXT NOT NULL,
                body TEXT NOT NULL,
                priority TEXT NOT NULL DEFAULT 'normal',
                tags TEXT,
                read INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                expires_at TEXT,
                FOREIGN KEY (recipient) REFERENCES None
            )
        """)
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_recipient ON messages (recipient)")
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_recipient_priority ON messages (recipient, priority)")
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_expires ON messages (expires_at)")
        self.conn.commit()

    async def send(
        self,
        sender: str,
        recipient: str,
        subject: str,
        body: str,
        priority: str = PRIORITY_NORMAL,
        tags: Optional[List[str]] = None,
        ttl_seconds: Optional[int] = None,
    ) -> int:
        now = datetime.datetime.now(timezone.utc)
        expires_at = None
        if ttl_seconds is not None:
            expires_at = (now + datetime.timedelta(seconds=ttl_seconds)).isoformat()
        tags_json = json.dumps(tags) if tags else None
        cursor = self.conn.execute(
            "INSERT INTO messages (sender, recipient, subject, body, priority, tags, created_at, expires_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (sender, recipient, subject, body, priority, tags_json, now.isoformat(), expires_at),
        )
        self.conn.commit()
        logger.info(f"Message sent: from={sender} to={recipient} subject={subject} priority={priority}")
        return cursor.lastrowid

    async def receive(
        self,
        recipient: str,
        unread_only: bool = False,
        priority: Optional[str] = None,
        subject_contains: Optional[str] = None,
        sender: Optional[str] = None,
        limit: int = 50,
    ) -> List[dict]:
        await self._cleanup_expired()

        conditions = ["recipient = ?"]
        params: List[Any] = [recipient]

        if unread_only:
            conditions.append("read = 0")
        if priority:
            conditions.append("priority = ?")
            params.append(priority)
        if subject_contains:
            conditions.append("subject LIKE ?")
            params.append(f"%{subject_contains}%")
        if sender:
            conditions.append("sender = ?")
            params.append(sender)

        where = " AND ".join(conditions)
        order = f"CASE priority {self._priority_case()} END ASC, created_at ASC"
        query = f"SELECT id, sender, recipient, subject, body, priority, tags, read, created_at, expires_at FROM messages WHERE {where} ORDER BY {order} LIMIT ?"
        params.append(limit)

        rows = self.conn.execute(query, params).fetchall()
        results = []
        for row in rows:
            msg = self._row_to_dict(row)
            results.append(msg)
            if not msg["read"]:
                self.conn.execute("UPDATE messages SET read = 1 WHERE id = ?", (msg["id"],))
        self.conn.commit()
        return results

    async def _cleanup_expired(self) -> int:
        now = datetime.datetime.now(timezone.utc).isoformat()
        cursor = self.conn.execute(
            "DELETE FROM messages WHERE expires_at IS NOT NULL AND expires_at < ?",
            (now,),
        )
        self.conn.commit()
        count = cursor.rowcount
        if count:
            logger.info(f"Cleaned up {count} expired messages")
        return count

    async def get_stats(self, recipient: Optional[str] = None) -> Dict[str, Any]:
        await self._cleanup_expired()

        if recipient:
            total = self.conn.execute(
                "SELECT COUNT(*) FROM messages WHERE recipient = ?", (recipient,)
            ).fetchone()[0]
            unread = self.conn.execute(
                "SELECT COUNT(*) FROM messages WHERE recipient = ? AND read = 0", (recipient,)
            ).fetchone()[0]
            by_priority_rows = self.conn.execute(
                "SELECT priority, COUNT(*) FROM messages WHERE recipient = ? GROUP BY priority",
                (recipient,),
            ).fetchall()
        else:
            total = self.conn.execute("SELECT COUNT(*) FROM messages").fetchone()[0]
            unread = self.conn.execute(
                "SELECT COUNT(*) FROM messages WHERE read = 0"
            ).fetchone()[0]
            by_priority_rows = self.conn.execute(
                "SELECT priority, COUNT(*) FROM messages GROUP BY priority"
            ).fetchall()

        by_priority = {row[0]: row[1] for row in by_priority_rows}
        return {
            "total": total,
            "unread": unread,
            "by_priority": by_priority,
        }

    def _priority_case(self) -> str:
        parts = []
        for level, order in PRIORITY_ORDER.items():
            parts.append(f"WHEN '{level}' THEN {order}")
        return " ".join(parts)

    def _row_to_dict(self, row) -> dict:
        return {
            "id": row[0],
            "sender": row[1],
            "recipient": row[2],
            "subject": row[3],
            "body": row[4],
            "priority": row[5],
            "tags": json.loads(row[6]) if row[6] else None,
            "read": bool(row[7]),
            "created_at": row[8],
            "expires_at": row[9],
        }
