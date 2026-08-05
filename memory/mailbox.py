"""Mailbox — Agent 间异步消息邮箱

提供 Agent 间的异步消息收发能力，支持优先级、标签、TTL 过期清理。

所有 SQL 操作通过 MailboxRepository 封装，遵守铁律4（禁止直接SQL）。
"""

import datetime
import json
import sqlite3
from pathlib import Path
from typing import Any

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


class MailboxRepository:
    """Mailbox 数据库 Repository 层 — 封装所有 SQL 操作。

    职责：数据库连接管理、表初始化、所有 CRUD 的 SQL 执行。
    上层 Mailbox 通过此类间接操作数据库，不直接编写 SQL。
    """

    def __init__(self, db_path: str) -> None:
        self._db_path = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.execute("PRAGMA journal_mode=WAL")
        self._init_db()
        logger.info(f"MailboxRepository initialized: {db_path}")

    def _init_db(self) -> None:
        """初始化数据库表和索引。"""
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
                expires_at TEXT
            )
        """)
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_recipient ON messages (recipient)")
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_recipient_priority ON messages (recipient, priority)")
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_expires ON messages (expires_at)")
        self.conn.commit()

    # ──────────────────────────── CRUD ────────────────────────────

    def insert_message(
        self,
        sender: str,
        recipient: str,
        subject: str,
        body: str,
        priority: str,
        tags_json: str | None,
        created_at: str,
        expires_at: str | None,
    ) -> int:
        """插入消息，返回自增 id。"""
        cursor = self.conn.execute(
            "INSERT INTO messages (sender, recipient, subject, body, priority, tags, created_at, expires_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (sender, recipient, subject, body, priority, tags_json, created_at, expires_at),
        )
        self.conn.commit()
        return cursor.lastrowid

    def query_messages(
        self,
        where_clause: str,
        params: list[Any],
        order_clause: str,
        limit: int,
    ) -> list[tuple]:
        """按条件查询消息行。"""
        query = (
            f"SELECT id, sender, recipient, subject, body, priority, tags, read, created_at, expires_at "
            f"FROM messages WHERE {where_clause} ORDER BY {order_clause} LIMIT ?"
        )
        return self.conn.execute(query, params + [limit]).fetchall()

    def mark_as_read(self, message_id: int) -> None:
        """标记消息为已读。"""
        self.conn.execute("UPDATE messages SET read = 1 WHERE id = ?", (message_id,))

    def commit(self) -> None:
        """提交当前事务。"""
        self.conn.commit()

    def cleanup_expired(self, now: str) -> int:
        """清理过期消息，返回清理数量。"""
        cursor = self.conn.execute(
            "DELETE FROM messages WHERE expires_at IS NOT NULL AND expires_at < ?",
            (now,),
        )
        self.conn.commit()
        return cursor.rowcount

    def count_messages(self, where_clause: str, params: list[Any]) -> int:
        """按条件统计消息数量。"""
        return self.conn.execute(
            f"SELECT COUNT(*) FROM messages WHERE {where_clause}", params
        ).fetchone()[0]

    def count_by_priority(self, where_clause: str, params: list[Any]) -> list[tuple]:
        """按条件分组统计各优先级消息数量。"""
        return self.conn.execute(
            f"SELECT priority, COUNT(*) FROM messages WHERE {where_clause} GROUP BY priority",
            params,
        ).fetchall()


class Mailbox:
    """Agent 间异步消息邮箱。

    所有 SQL 操作委托给 MailboxRepository，本类仅负责业务逻辑和行转字典。
    """

    def __init__(self, db_path: str = "data/mailbox.db"):
        self._repo = MailboxRepository(db_path)

    async def send(
        self,
        sender: str,
        recipient: str,
        subject: str,
        body: str,
        priority: str = PRIORITY_NORMAL,
        tags: list[str] | None = None,
        ttl_seconds: int | None = None,
    ) -> int:
        now = datetime.datetime.now(datetime.UTC)
        expires_at = None
        if ttl_seconds is not None:
            expires_at = (now + datetime.timedelta(seconds=ttl_seconds)).isoformat()
        tags_json = json.dumps(tags) if tags else None
        msg_id = self._repo.insert_message(
            sender=sender,
            recipient=recipient,
            subject=subject,
            body=body,
            priority=priority,
            tags_json=tags_json,
            created_at=now.isoformat(),
            expires_at=expires_at,
        )
        logger.info(f"Message sent: from={sender} to={recipient} subject={subject} priority={priority}")
        return msg_id

    async def receive(
        self,
        recipient: str,
        unread_only: bool = False,
        priority: str | None = None,
        subject_contains: str | None = None,
        sender: str | None = None,
        limit: int = 50,
    ) -> list[dict]:
        await self._cleanup_expired()

        conditions = ["recipient = ?"]
        params: list[Any] = [recipient]

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

        rows = self._repo.query_messages(where, params, order, limit)
        results = []
        for row in rows:
            msg = self._row_to_dict(row)
            results.append(msg)
            if not msg["read"]:
                self._repo.mark_as_read(msg["id"])
        self._repo.commit()
        return results

    async def _cleanup_expired(self) -> int:
        now = datetime.datetime.now(datetime.UTC).isoformat()
        count = self._repo.cleanup_expired(now)
        if count:
            logger.info(f"Cleaned up {count} expired messages")
        return count

    async def get_stats(self, recipient: str | None = None) -> dict[str, Any]:
        await self._cleanup_expired()

        if recipient:
            total = self._repo.count_messages("recipient = ?", [recipient])
            unread = self._repo.count_messages("recipient = ? AND read = 0", [recipient])
            by_priority_rows = self._repo.count_by_priority("recipient = ?", [recipient])
        else:
            total = self._repo.count_messages("1=1", [])
            unread = self._repo.count_messages("read = 0", [])
            by_priority_rows = self._repo.count_by_priority("1=1", [])

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
