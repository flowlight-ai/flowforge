from .working import WorkingMemory
from .short_term import ShortTermMemory
from .long_term import LongTermMemory
from .semantic import SemanticMemory
from .episodic import EpisodicMemory
from typing import Any, List, Optional

class MemoryManager:
    def __init__(self, config: dict):
        db_url = config.get("db_url", "data/memory.db")
        self.working = WorkingMemory()
        self.short_term = ShortTermMemory(db_url)
        self.long_term = LongTermMemory(db_url)
        self.semantic = SemanticMemory(config.get("vector_db_url")) if config.get("vector_db_url") else None
        self.episodic = EpisodicMemory(db_url)

    async def save(self, memory_type: str, key: str, data: Any) -> None:
        store = getattr(self, memory_type, None)
        if store:
            await store.store(key, data)

    async def retrieve(self, memory_type: str, query: Any) -> Any:
        store = getattr(self, memory_type, None)
        if store:
            return await store.search(query)
        return []

    def list_stores(self) -> List[str]:
        stores = ["working", "short_term", "long_term", "episodic"]
        if self.semantic:
            stores.append("semantic")
        return stores

    async def hybrid_search(self, query: str, types: List[str] = None) -> List[Any]:
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

    async def list_memories(self, limit: int = 50, offset: int = 0, task_id: Optional[str] = None) -> dict:
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

    async def get_memory(self, memory_id: int) -> Optional[dict]:
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

    async def get_by_task(self, task_id: str) -> List[dict]:
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
