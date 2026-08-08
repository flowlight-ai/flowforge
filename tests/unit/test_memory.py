import pytest
import tempfile
from flowforge.memory.short_term import ShortTermMemory
from flowforge.memory.long_term import LongTermMemory
from flowforge.memory.episodic import EpisodicMemory
from flowforge.memory.working import WorkingMemory
from flowforge.memory.manager import MemoryManager


@pytest.fixture
def short_term_db():
    return tempfile.mktemp(suffix=".db")


@pytest.fixture
def long_term_db():
    return tempfile.mktemp(suffix=".db")


@pytest.fixture
def episodic_db():
    return tempfile.mktemp(suffix=".db")


@pytest.fixture
def manager_db():
    return tempfile.mktemp(suffix=".db")


@pytest.mark.asyncio
async def test_short_term_store_and_search(short_term_db):
    mem = ShortTermMemory(db_url=f"sqlite:///{short_term_db}")
    await mem.store("key1", {"data": "value1"})
    results = await mem.search("key1")
    assert len(results) == 1
    assert results[0]["key"] == "key1"
    assert results[0]["value"]["data"] == "value1"


@pytest.mark.asyncio
async def test_short_term_search_missing_key(short_term_db):
    mem = ShortTermMemory(db_url=f"sqlite:///{short_term_db}")
    results = await mem.search("nonexistent")
    assert results == []


@pytest.mark.asyncio
async def test_short_term_overwrite(short_term_db):
    mem = ShortTermMemory(db_url=f"sqlite:///{short_term_db}")
    await mem.store("key1", "first")
    await mem.store("key1", "second")
    results = await mem.search("key1")
    assert len(results) == 1
    assert results[0]["value"] == "second"


@pytest.mark.asyncio
async def test_long_term_store_and_search(long_term_db):
    mem = LongTermMemory(db_url=f"sqlite:///{long_term_db}")
    await mem.store("user_preference", {"theme": "dark"})
    results = await mem.search("user_preference")
    assert len(results) == 1
    assert results[0]["theme"] == "dark"


@pytest.mark.asyncio
async def test_long_term_search_partial_match(long_term_db):
    mem = LongTermMemory(db_url=f"sqlite:///{long_term_db}")
    await mem.store("user_preference_theme", {"theme": "dark"})
    await mem.store("user_preference_lang", {"lang": "en"})
    results = await mem.search("user_preference")
    assert len(results) == 2


@pytest.mark.asyncio
async def test_long_term_search_no_results(long_term_db):
    mem = LongTermMemory(db_url=f"sqlite:///{long_term_db}")
    results = await mem.search("nonexistent")
    assert results == []


@pytest.mark.asyncio
async def test_long_term_search_limit(long_term_db):
    mem = LongTermMemory(db_url=f"sqlite:///{long_term_db}")
    for i in range(10):
        await mem.store("item", {"index": i})
    results = await mem.search("item", limit=3)
    assert len(results) == 3


@pytest.mark.asyncio
async def test_episodic_store_and_search(episodic_db):
    mem = EpisodicMemory(db_url=f"sqlite:///{episodic_db}")
    await mem.store("task-001", {"action": "research", "result": "done"})
    results = await mem.search("task-001")
    assert len(results) == 1
    assert results[0]["action"] == "research"


@pytest.mark.asyncio
async def test_episodic_search_partial_match(episodic_db):
    mem = EpisodicMemory(db_url=f"sqlite:///{episodic_db}")
    await mem.store("task-001", {"action": "research"})
    await mem.store("task-002", {"action": "write"})
    results = await mem.search("task")
    assert len(results) == 2


@pytest.mark.asyncio
async def test_episodic_search_no_results(episodic_db):
    mem = EpisodicMemory(db_url=f"sqlite:///{episodic_db}")
    results = await mem.search("nonexistent")
    assert results == []


@pytest.mark.asyncio
async def test_working_memory_store_and_search():
    mem = WorkingMemory()
    await mem.store("current_task", {"status": "running"})
    results = await mem.search("current_task")
    assert len(results) == 1
    assert results[0]["key"] == "current_task"
    assert results[0]["value"]["status"] == "running"


@pytest.mark.asyncio
async def test_working_memory_search_missing():
    mem = WorkingMemory()
    results = await mem.search("nonexistent")
    assert results == []


def test_working_memory_get():
    mem = WorkingMemory()
    mem._store["test_key"] = "test_value"
    assert mem.get("test_key") == "test_value"
    assert mem.get("missing") is None


@pytest.mark.asyncio
async def test_memory_manager_save_and_retrieve(manager_db):
    mgr = MemoryManager({"db_url": f"sqlite:///{manager_db}"})
    await mgr.save("long_term", "key1", {"data": "value1"})
    results = await mgr.retrieve("long_term", "key1")
    assert len(results) == 1
    assert results[0]["data"] == "value1"


@pytest.mark.asyncio
async def test_memory_manager_save_working(manager_db):
    mgr = MemoryManager({"db_url": f"sqlite:///{manager_db}"})
    await mgr.save("working", "current", {"status": "active"})
    results = await mgr.retrieve("working", "current")
    assert len(results) == 1
    assert results[0]["value"]["status"] == "active"


@pytest.mark.asyncio
async def test_memory_manager_retrieve_nonexistent_type(manager_db):
    mgr = MemoryManager({"db_url": f"sqlite:///{manager_db}"})
    results = await mgr.retrieve("nonexistent_type", "key1")
    assert results == []


@pytest.mark.asyncio
async def test_memory_manager_hybrid_search(manager_db):
    mgr = MemoryManager({"db_url": f"sqlite:///{manager_db}"})
    await mgr.save("long_term", "topic_ai", {"title": "AI trends"})
    await mgr.save("episodic", "task_ai", {"action": "research"})
    results = await mgr.hybrid_search("ai", types=["long_term", "episodic"])
    assert len(results) >= 2


@pytest.mark.asyncio
async def test_memory_manager_hybrid_search_default_types(manager_db):
    mgr = MemoryManager({"db_url": f"sqlite:///{manager_db}"})
    await mgr.save("long_term", "topic_test", {"title": "Test"})
    await mgr.save("episodic", "task_test", {"action": "test"})
    results = await mgr.hybrid_search("test")
    assert len(results) >= 2
