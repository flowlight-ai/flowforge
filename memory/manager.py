from typing import Any

from .compressor import ContextCompressor
from .episodic import EpisodicMemory
from .long_term import LongTermMemory
from .semantic import SemanticMemory
from .short_term import ShortTermMemory
from .working import WorkingMemory


class MemoryManager:
    def __init__(self, config: dict, llm_client=None):
        db_url = config.get("db_url", "data/memory.db")
        self.working = WorkingMemory()
        self.short_term = ShortTermMemory(db_url)
        self.long_term = LongTermMemory(db_url)
        semantic_db_path = config.get("vector_db_url")
        if not semantic_db_path:
            if db_url.startswith("sqlite:///"):
                base = db_url.replace("sqlite:///", "").rsplit(".", 1)[0]
                semantic_db_path = f"{base}_semantic.db"
            elif db_url.startswith("sqlite:"):
                semantic_db_path = "data/flowforge_semantic.db"
            else:
                semantic_db_path = f"{db_url.rsplit('.', 1)[0]}_semantic.db"
        self.semantic = SemanticMemory(semantic_db_path)
        self.episodic = EpisodicMemory(db_url)
        self.compressor = ContextCompressor(llm_client) if llm_client and config.get("compression_enabled", True) else None

    async def save(self, memory_type: str, key: str, data: Any) -> None:
        store = getattr(self, memory_type, None)
        if store:
            await store.store(key, data)

    async def retrieve(self, memory_type: str, query: Any) -> Any:
        store = getattr(self, memory_type, None)
        if store:
            return await store.search(query)
        return []

    def list_stores(self) -> list[str]:
        stores = ["working", "short_term", "long_term", "episodic"]
        if self.semantic:
            stores.append("semantic")
        return stores

    async def hybrid_search(self, query: str, types: list[str] = None) -> list[Any]:
        if types is None:
            types = ["semantic", "long_term", "episodic"]
        results = []
        if "semantic" in types and self.semantic:
            results.extend(await self.semantic.search(query))
        if "long_term" in types:
            results.extend(await self.long_term.search(query))
        if "episodic" in types:
            results.extend(await self.episodic.search(query))
        return results

    async def list_memories(self, limit: int = 50, offset: int = 0, task_id: str | None = None) -> dict:
        conn = self.episodic.conn
        if task_id:
            total = conn.execute("SELECT COUNT(*) FROM episodes WHERE task_id = ?", (task_id,)).fetchone()[0]
            rows = conn.execute(
                "SELECT id, task_id, trace, created_at FROM episodes WHERE task_id = ? ORDER BY id DESC LIMIT ? OFFSET ?",
                (task_id, limit, offset),
            ).fetchall()
        else:
            total = conn.execute("SELECT COUNT(*) FROM episodes").fetchone()[0]
            rows = conn.execute(
                "SELECT id, task_id, trace, created_at FROM episodes ORDER BY id DESC LIMIT ? OFFSET ?",
                (limit, offset),
            ).fetchall()
        import json
        records = []
        for row in rows:
            records.append({
                "id": row[0],
                "task_id": row[1],
                "trace": json.loads(row[2]) if row[2] else None,
                "created_at": row[3],
            })
        return {"records": records, "total": total, "limit": limit, "offset": offset}

    async def get_memory(self, memory_id: int) -> dict | None:
        conn = self.episodic.conn
        row = conn.execute("SELECT id, task_id, trace, created_at FROM episodes WHERE id = ?", (memory_id,)).fetchone()
        if not row:
            return None
        import json
        return {
            "id": row[0],
            "task_id": row[1],
            "trace": json.loads(row[2]) if row[2] else None,
            "created_at": row[3],
        }

    async def delete_memory(self, memory_id: int) -> bool:
        conn = self.episodic.conn
        cursor = conn.execute("DELETE FROM episodes WHERE id = ?", (memory_id,))
        conn.commit()
        return cursor.rowcount > 0

    async def get_by_task(self, task_id: str) -> list[dict]:
        conn = self.episodic.conn
        rows = conn.execute(
            "SELECT id, task_id, trace, created_at FROM episodes WHERE task_id = ? ORDER BY id DESC",
            (task_id,),
        ).fetchall()
        import json
        records = []
        for row in rows:
            records.append({
                "id": row[0],
                "task_id": row[1],
                "trace": json.loads(row[2]) if row[2] else None,
                "created_at": row[3],
            })
        return records

    async def compress_messages(self, messages: list[dict], context=None) -> list[dict]:
        if not self.compressor:
            return messages
        return await self.compressor.compress_if_needed(messages, context)
