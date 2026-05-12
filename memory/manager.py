from .working import WorkingMemory
from .short_term import ShortTermMemory
from .long_term import LongTermMemory
from .semantic import SemanticMemory
from .episodic import EpisodicMemory
from typing import Any, List

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
