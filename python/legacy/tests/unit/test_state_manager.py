import pytest
import tempfile
from flowforge.executor.state_manager import StateManager


@pytest.fixture
def state_db():
    return tempfile.mktemp(suffix=".db")


def test_save_and_load_state(state_db):
    mgr = StateManager(db_path=state_db)
    state = {"status": "running", "mode": "react"}
    mgr.save_state("task-001", state)
    loaded = mgr.load_state("task-001")
    assert loaded["status"] == "running"
    assert loaded["mode"] == "react"


def test_load_nonexistent_state(state_db):
    mgr = StateManager(db_path=state_db)
    result = mgr.load_state("nonexistent-task")
    assert result is None


def test_delete_state(state_db):
    mgr = StateManager(db_path=state_db)
    mgr.save_state("task-001", {"status": "running"})
    mgr.delete_state("task-001")
    assert mgr.load_state("task-001") is None


def test_delete_nonexistent_state(state_db):
    mgr = StateManager(db_path=state_db)
    mgr.delete_state("nonexistent-task")


def test_list_states(state_db):
    mgr = StateManager(db_path=state_db)
    mgr.save_state("task-001", {"status": "running"})
    mgr.save_state("task-002", {"status": "completed"})
    states = mgr.list_states()
    assert len(states) == 2
    assert "task-001" in states
    assert "task-002" in states


def test_list_states_empty(state_db):
    mgr = StateManager(db_path=state_db)
    states = mgr.list_states()
    assert states == []


def test_update_state(state_db):
    mgr = StateManager(db_path=state_db)
    mgr.save_state("task-001", {"status": "running", "mode": "react"})
    mgr.update_state("task-001", {"status": "completed"})
    loaded = mgr.load_state("task-001")
    assert loaded["status"] == "completed"
    assert loaded["mode"] == "react"


def test_update_state_creates_if_missing(state_db):
    mgr = StateManager(db_path=state_db)
    mgr.update_state("task-new", {"status": "pending"})
    loaded = mgr.load_state("task-new")
    assert loaded["status"] == "pending"


def test_save_state_overwrite(state_db):
    mgr = StateManager(db_path=state_db)
    mgr.save_state("task-001", {"version": 1})
    mgr.save_state("task-001", {"version": 2})
    loaded = mgr.load_state("task-001")
    assert loaded["version"] == 2


def test_list_states_with_data_filter_persona(state_db):
    mgr = StateManager(db_path=state_db)
    mgr.save_state("task-001", {"persona": "education", "status": "running"})
    mgr.save_state("task-002", {"persona": "life", "status": "running"})
    result = mgr.list_states_with_data(persona="education")
    assert result["total"] == 1
    assert result["items"][0]["persona"] == "education"


def test_list_states_with_data_filter_status(state_db):
    mgr = StateManager(db_path=state_db)
    mgr.save_state("task-001", {"status": "running"})
    mgr.save_state("task-002", {"status": "completed"})
    result = mgr.list_states_with_data(status="completed")
    assert result["total"] == 1
    assert result["items"][0]["status"] == "completed"


def test_list_states_with_data_filter_mode(state_db):
    mgr = StateManager(db_path=state_db)
    mgr.save_state("task-001", {"mode": "react"})
    mgr.save_state("task-002", {"mode": "workflow"})
    result = mgr.list_states_with_data(mode="react")
    assert result["total"] == 1


def test_list_states_with_data_pagination(state_db):
    mgr = StateManager(db_path=state_db)
    for i in range(5):
        mgr.save_state(f"task-{i:03d}", {"status": "running", "index": i})
    result = mgr.list_states_with_data(limit=2, offset=0)
    assert result["total"] == 5
    assert len(result["items"]) == 2


def test_count_by_status(state_db):
    mgr = StateManager(db_path=state_db)
    mgr.save_state("task-001", {"status": "running"})
    mgr.save_state("task-002", {"status": "running"})
    mgr.save_state("task-003", {"status": "completed"})
    assert mgr.count_by_status("running") == 2
    assert mgr.count_by_status("completed") == 1
    assert mgr.count_by_status("failed") == 0
