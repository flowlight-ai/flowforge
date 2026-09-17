import pytest
import asyncio
import tempfile
import time
from flowforge.memory.task_board import TaskBoard


@pytest.fixture
def board():
    path = tempfile.mktemp(suffix=".db")
    b = TaskBoard(path)
    yield b
    b.conn.close()


@pytest.mark.asyncio
async def test_add_task(board):
    await board.add_task("t1", "research", {"title": "First task"})
    tasks = await board.get_all_tasks()
    assert len(tasks) == 1
    assert tasks[0]["status"] == "pending"


@pytest.mark.asyncio
async def test_add_tasks_batch(board):
    await board.add_tasks_batch([
        {"task_id": "t1", "task_type": "research", "payload": {"title": "Task 1"}},
        {"task_id": "t2", "task_type": "writing", "payload": {"title": "Task 2"}},
    ])
    tasks = await board.get_all_tasks()
    assert len(tasks) == 2


@pytest.mark.asyncio
async def test_claim_task_atomic(board):
    await board.add_task("t1", "research", {"title": "First"})
    await board.add_task("t2", "research", {"title": "Second"})

    results = await asyncio.gather(
        board.claim_task("agent1"),
        board.claim_task("agent2"),
    )
    claimed_ids = [r["task_id"] for r in results if r is not None]
    assert len(set(claimed_ids)) == len(claimed_ids)


@pytest.mark.asyncio
async def test_claim_task_empty_board(board):
    result = await board.claim_task("agent1")
    assert result is None


@pytest.mark.asyncio
async def test_complete_task(board):
    await board.add_task("t1", "research", {"title": "Task"})
    await board.claim_task("agent1")
    success = await board.complete_task("t1", {"done": True})
    assert success is True
    tasks = await board.get_all_tasks(status="completed")
    assert len(tasks) == 1


@pytest.mark.asyncio
async def test_fail_task(board):
    await board.add_task("t1", "research", {"title": "Task"})
    await board.claim_task("agent1")
    success = await board.fail_task("t1", "Something went wrong")
    assert success is True
    tasks = await board.get_all_tasks()
    failed = [t for t in tasks if t["task_id"] == "t1"]
    assert failed[0]["status"] == "failed"


@pytest.mark.asyncio
async def test_reset_stuck_tasks(board):
    await board.add_task("t1", "research", {"title": "Task"})
    await board.claim_task("agent1")
    old_claimed_at = (
        __import__("datetime").datetime.now(__import__("datetime").timezone.utc)
        - __import__("datetime").timedelta(seconds=600)
    ).isoformat()
    board.conn.execute(
        "UPDATE tasks SET claimed_at = ? WHERE task_id = ?",
        (old_claimed_at, "t1"),
    )
    board.conn.commit()
    count = await board.reset_stuck_tasks(timeout_seconds=300)
    assert count == 1
    tasks = await board.get_all_tasks(status="pending")
    assert len(tasks) == 1


@pytest.mark.asyncio
async def test_get_all_tasks_filter_status(board):
    await board.add_task("t1", "research", {"title": "Task 1"})
    await board.add_task("t2", "writing", {"title": "Task 2"})
    await board.claim_task("agent1")
    await board.complete_task("t1", {"done": True})
    pending = await board.get_all_tasks(status="pending")
    assert len(pending) == 1
    assert pending[0]["task_id"] == "t2"
