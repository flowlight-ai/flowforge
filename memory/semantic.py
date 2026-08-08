import asyncio
import json
import sqlite3
import hashlib
import os
import logging
from typing import Any

logger = logging.getLogger(__name__)


class SemanticMemory:
    def __init__(self, db_path: str = None):
        if db_path is None:
            db_path = "data/semantic.db"
        self._db_path = db_path
        os.makedirs(os.path.dirname(db_path) or ".", exist_ok=True)
        self._init_db()
        self._available = True
        logger.info(f"SemanticMemory initialized with FTS5 at {db_path}")

    def _init_db(self):
        conn = sqlite3.connect(self._db_path)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS semantic_entries (
                id TEXT PRIMARY KEY,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                metadata TEXT DEFAULT '{}',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        try:
            conn.execute("""
                CREATE VIRTUAL TABLE IF NOT EXISTS semantic_fts USING fts5(
                    entry_id,
                    key,
                    value_text,
                    metadata_text
                )
            """)
        except sqlite3.OperationalError as e:
            if "already exists" not in str(e):
                logger.warning(f"FTS5 setup issue: {e}")
        conn.commit()
        conn.close()

    def _get_conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        return conn

    async def store(self, key: str, value: Any) -> None:
        entry_id = hashlib.md5(f"{key}:{str(value)[:200]}".encode()).hexdigest()[:16]
        value_str = json.dumps(value, ensure_ascii=False) if not isinstance(value, str) else value
        metadata = {"key": key, "value_length": len(value_str)}
        metadata_str = json.dumps(metadata, ensure_ascii=False)
        value_text = value_str[:2000] if isinstance(value_str, str) else str(value_str)[:2000]
        metadata_text = metadata_str[:500]

        def _store():
            conn = self._get_conn()
            try:
                conn.execute(
                    "INSERT OR REPLACE INTO semantic_entries (id, key, value, metadata) VALUES (?, ?, ?, ?)",
                    (entry_id, key, value_str, metadata_str)
                )
                conn.execute(
                    "INSERT OR REPLACE INTO semantic_fts (entry_id, key, value_text, metadata_text) VALUES (?, ?, ?, ?)",
                    (entry_id, key, value_text, metadata_text)
                )
                conn.commit()
                return True
            except Exception as e:
                logger.warning(f"SemanticMemory store failed: {e}")
                return False
            finally:
                conn.close()

        await asyncio.get_event_loop().run_in_executor(None, _store)

    async def search(self, query: str, top_k: int = 5) -> list:
        def _search():
            conn = self._get_conn()
            try:
                terms = query.split()[:5]
                fts_query = " OR ".join(f'"{t}"' for t in terms)

                rows = conn.execute("""
                    SELECT sf.entry_id
                    FROM semantic_fts sf
                    WHERE semantic_fts MATCH ?
                    ORDER BY rank
                    LIMIT ?
                """, (fts_query, top_k)).fetchall()

                if not rows:
                    return []

                entry_ids = [r["entry_id"] for r in rows]
                placeholders = ",".join("?" * len(entry_ids))
                entries = conn.execute(f"""
                    SELECT id, key, value, metadata, created_at
                    FROM semantic_entries
                    WHERE id IN ({placeholders})
                """, entry_ids).fetchall()

                results = []
                for row in entries:
                    try:
                        val = json.loads(row["value"])
                    except (json.JSONDecodeError, TypeError):
                        val = row["value"]
                    results.append({
                        "id": row["id"],
                        "key": row["key"],
                        "value": val,
                        "metadata": json.loads(row["metadata"]) if row["metadata"] else {},
                        "created_at": row["created_at"],
                    })
                return results
            except Exception as e:
                logger.warning(f"SemanticMemory search failed: {e}")
                return []
            finally:
                conn.close()

        return await asyncio.get_event_loop().run_in_executor(None, _search)

    async def delete(self, key: str) -> bool:
        def _delete():
            conn = self._get_conn()
            try:
                rows = conn.execute("SELECT id FROM semantic_entries WHERE key = ?", (key,)).fetchall()
                for row in rows:
                    conn.execute("DELETE FROM semantic_fts WHERE entry_id = ?", (row["id"],))
                conn.execute("DELETE FROM semantic_entries WHERE key = ?", (key,))
                conn.commit()
                return True
            except Exception as e:
                logger.warning(f"SemanticMemory delete failed: {e}")
                return False
            finally:
                conn.close()

        return await asyncio.get_event_loop().run_in_executor(None, _delete)

    async def count(self) -> int:
        def _count():
            conn = self._get_conn()
            try:
                row = conn.execute("SELECT COUNT(*) as cnt FROM semantic_entries").fetchone()
                return row["cnt"] if row else 0
            finally:
                conn.close()

        return await asyncio.get_event_loop().run_in_executor(None, _count)

    @property
    def available(self) -> bool:
        return self._available
