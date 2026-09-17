import time
import pytest
import tempfile
from flowforge.core.checkpoint_manager import CheckpointManager


@pytest.fixture
def checkpoint_db():
    return tempfile.mktemp(suffix=".db")


def test_save_and_load(checkpoint_db):
    mgr = CheckpointManager(db_path=checkpoint_db)
    state = {"step": 1, "data": "hello"}
    mgr.save("task-001", "step1", state)
    loaded = mgr.load("task-001", "step1")
    assert loaded == state


def test_load_nonexistent(checkpoint_db):
    mgr = CheckpointManager(db_path=checkpoint_db)
    result = mgr.load("task-999", "step1")
    assert result is None


def test_load_latest(checkpoint_db):
    mgr = CheckpointManager(db_path=checkpoint_db)
    mgr.save("task-001", "step1", {"step": 1})
    time.sleep(1.1)
    mgr.save("task-001", "step2", {"step": 2})
    latest = mgr.load_latest("task-001")
    assert latest is not None
    assert latest["step"] == 2


def test_load_latest_no_checkpoints(checkpoint_db):
    mgr = CheckpointManager(db_path=checkpoint_db)
    result = mgr.load_latest("nonexistent-task")
    assert result is None


def test_delete(checkpoint_db):
    mgr = CheckpointManager(db_path=checkpoint_db)
    mgr.save("task-001", "step1", {"step": 1})
    mgr.save("task-001", "step2", {"step": 2})
    mgr.delete("task-001")
    assert mgr.load("task-001", "step1") is None
    assert mgr.load("task-001", "step2") is None


def test_delete_nonexistent(checkpoint_db):
    mgr = CheckpointManager(db_path=checkpoint_db)
    mgr.delete("nonexistent-task")


def test_list_checkpoints(checkpoint_db):
    mgr = CheckpointManager(db_path=checkpoint_db)
    mgr.save("task-001", "step1", {"step": 1})
    mgr.save("task-001", "step2", {"step": 2})
    checkpoints = mgr.list_checkpoints("task-001")
    assert len(checkpoints) == 2
    steps = [c["step"] for c in checkpoints]
    assert "step1" in steps
    assert "step2" in steps


def test_list_checkpoints_empty(checkpoint_db):
    mgr = CheckpointManager(db_path=checkpoint_db)
    checkpoints = mgr.list_checkpoints("nonexistent-task")
    assert checkpoints == []


def test_save_overwrite(checkpoint_db):
    mgr = CheckpointManager(db_path=checkpoint_db)
    mgr.save("task-001", "step1", {"version": 1})
    mgr.save("task-001", "step1", {"version": 2})
    loaded = mgr.load("task-001", "step1")
    assert loaded["version"] == 2


def test_multiple_tasks(checkpoint_db):
    mgr = CheckpointManager(db_path=checkpoint_db)
    mgr.save("task-001", "step1", {"task": 1})
    mgr.save("task-002", "step1", {"task": 2})
    assert mgr.load("task-001", "step1")["task"] == 1
    assert mgr.load("task-002", "step1")["task"] == 2
    mgr.delete("task-001")
    assert mgr.load("task-001", "step1") is None
    assert mgr.load("task-002", "step1") is not None
