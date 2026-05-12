from typing import Any, Dict

class WorkingMemory:
    def __init__(self):
        self._store: Dict[str, Any] = {}

    async def store(self, key: str, value: Any) -> None:
        self._store[key] = value

    async def search(self, query: str) -> list:
        if query in self._store:
            return [{"key": query, "value": self._store[query]}]
        return []

    def get(self, key: str) -> Any:
        return self._store.get(key)
