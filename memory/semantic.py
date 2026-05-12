class SemanticMemory:
    def __init__(self, vector_db_url: str = None):
        self._available = False

    async def store(self, key: str, value) -> None:
        pass

    async def search(self, query: str, top_k: int = 5) -> list:
        return []
