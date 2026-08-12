from typing import Any, Dict

from .base import EchoStore


class WorkingMemory(EchoStore):
    def __init__(self):
        self._store: Dict[str, Any] = {}

    async def store(self, key: str, value: Any) -> None:
        self._store[key] = value

    async def search(self, query: str, limit: int = 10) -> list:
        results = []
        query_lower = query.lower()
        for key, value in self._store.items():
            if query_lower in key.lower() or query_lower in str(value).lower():
                results.append({"key": key, "value": value})
                if len(results) >= limit:
                    break
        return results

    def get(self, key: str) -> Any:
        return self._store.get(key)
