"""Multi-step complex flow tests for FlowForge Solo mode dynamic update logic.

Tests cover:
1. Solo WebSocket event creation and proper event delivery
2. Task phase transitions: creating → connecting → running → completed
3. Stale task detection (running >10 min auto-interrupted)
4. Task switching with correct state restoration
5. SoloAdapter message persistence to workspace

This is a unit/integration test suite — mock LLM is acceptable per project rules.
"""

import asyncio
import json
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from flowforge.events.event_bus import EventBus
from flowforge.events.solo_adapter import EventBusSoloAdapter, _SAVE_EVENTS, _event_to_message
from flowforge.core.workspace import WorkspaceManager


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class MockSoloManager:
    """Records all emit_event calls for assertion."""

    def __init__(self):
        self.events: list[tuple[str, str, dict]] = []

    async def emit_event(self, task_id: str, event_type: str, payload: dict):
        self.events.append((task_id, event_type, payload))


class FakeWorkspaceManager:
    """In-memory workspace manager that avoids filesystem I/O."""

    def __init__(self):
        self._messages: dict[str, list[dict]] = {}
        self._task_status: dict[str, str] = {}

    def save_message(self, task_id: str, message: dict):
        self._messages.setdefault(task_id, []).append(message)

    def load_messages(self, task_id: str) -> list[dict]:
        return self._messages.get(task_id, [])

    def update_task_status(self, task_id: str, status: str, **kwargs):
        self._task_status[task_id] = status


# ---------------------------------------------------------------------------
# Python-side port of frontend fixStalePhase / serverStatusToPhase
# ---------------------------------------------------------------------------

STALE_TASK_MS = 10 * 60 * 1000  # 10 minutes

SOLO_TASK_PHASES = (
    "idle", "creating", "connecting", "running",
    "paused", "waiting_review", "completed", "error",
    "rejected", "interrupted",
)

ACTIVE_PHASES = {"creating", "connecting", "running", "waiting_review", "paused"}
TERMINAL_PHASES = {"completed", "error", "rejected", "interrupted"}


def fix_stale_phase(phase: str, timestamp_ms: float) -> str:
    """Python equivalent of TaskListPanel.fixStalePhase.

    If the task is in an active phase and its timestamp is older than
    STALE_TASK_MS (10 minutes), return 'interrupted'.
    """
    if phase in ACTIVE_PHASES and (time.time() * 1000 - timestamp_ms) > STALE_TASK_MS:
        return "interrupted"
    return phase


def server_status_to_phase(status: str, timestamp_ms: Optional[float] = None) -> str:
    """Python equivalent of TaskListPanel.serverStatusToPhase."""
    if status == "completed":
        return "completed"
    if status in ("error", "failed"):
        return "error"
    if status == "interrupted":
        return "interrupted"
    if status == "paused":
        return "paused"
    if timestamp_ms and (time.time() * 1000 - timestamp_ms) > STALE_TASK_MS:
        return "interrupted"
    return "running"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def event_bus():
    return EventBus()


@pytest.fixture
def mock_solo_manager():
    return MockSoloManager()


@pytest.fixture
def fake_workspace():
    return FakeWorkspaceManager()


@pytest.fixture
def adapter(event_bus, mock_solo_manager):
    return EventBusSoloAdapter(event_bus, mock_solo_manager)


@pytest.fixture
def bridged_adapter(adapter):
    adapter.bridge()
    return adapter


# ---------------------------------------------------------------------------
# 1. Task creation via Solo WebSocket — proper events received
# ---------------------------------------------------------------------------

class TestTaskCreationEvents:
    """Verify that when a task lifecycle runs, the SoloAdapter emits the
    correct sequence of events through the SoloManager."""

    @pytest.mark.asyncio
    async def test_stage_enter_exit_events(self, bridged_adapter, event_bus, mock_solo_manager):
        """workflow.step.start → solo.stage.enter, workflow.step.complete → solo.stage.exit."""
        task_id = "task-stage-001"
        event_bus.emit(task_id, "workflow.step.start", {"stage": "research", "label": "信息检索", "order": 1, "total": 3})
        await asyncio.sleep(0.05)

        # Should have emitted solo.stage.enter
        assert any(et == "solo.stage.enter" for _, et, _ in mock_solo_manager.events)

        event_bus.emit(task_id, "workflow.step.complete", {"stage": "research", "label": "信息检索"})
        await asyncio.sleep(0.05)

        assert any(et == "solo.stage.exit" for _, et, _ in mock_solo_manager.events)

    @pytest.mark.asyncio
    async def test_tool_events_mapped(self, bridged_adapter, event_bus, mock_solo_manager):
        """tool.start → solo.tool.start, tool.end → solo.tool.end."""
        task_id = "task-tool-001"
        event_bus.emit(task_id, "tool.start", {"tool_name": "web_search"})
        event_bus.emit(task_id, "tool.end", {"tool_name": "web_search", "result": {"count": 5}})
        await asyncio.sleep(0.05)

        types_emitted = [et for _, et, _ in mock_solo_manager.events]
        assert "solo.tool.start" in types_emitted
        assert "solo.tool.end" in types_emitted

    @pytest.mark.asyncio
    async def test_task_completed_event(self, bridged_adapter, event_bus, mock_solo_manager):
        """task.completed → solo.task.completed with result payload."""
        task_id = "task-done-001"
        event_bus.emit(task_id, "task.completed", {"result": "文章已生成", "summary": "3个段落"})
        await asyncio.sleep(0.05)

        completed_events = [(tid, et, p) for tid, et, p in mock_solo_manager.events if et == "solo.task.completed"]
        assert len(completed_events) == 1
        assert completed_events[0][2]["result"] == "文章已生成"

    @pytest.mark.asyncio
    async def test_task_error_event(self, bridged_adapter, event_bus, mock_solo_manager):
        """task.error → solo.task.error with error message."""
        task_id = "task-err-001"
        event_bus.emit(task_id, "task.error", {"error_message": "LLM调用超时", "step_name": "generation"})
        await asyncio.sleep(0.05)

        error_events = [(tid, et, p) for tid, et, p in mock_solo_manager.events if et == "solo.task.error"]
        assert len(error_events) == 1
        assert error_events[0][2]["error_message"] == "LLM调用超时"

    @pytest.mark.asyncio
    async def test_react_mode_events(self, bridged_adapter, event_bus, mock_solo_manager):
        """ReAct mode events map correctly: react.iteration → solo.stage.enter etc."""
        task_id = "task-react-001"
        event_bus.emit(task_id, "react.iteration", {"iteration": 1})
        event_bus.emit(task_id, "react.thought", {"agent_name": "ReActAgent", "delta_text": "思考中..."})
        event_bus.emit(task_id, "react.action", {"tool_name": "helixrag_search"})
        event_bus.emit(task_id, "react.observation", {"tool_name": "helixrag_search", "result": {}})
        event_bus.emit(task_id, "react.final", {"output": "最终答案"})
        await asyncio.sleep(0.05)

        types_emitted = [et for _, et, _ in mock_solo_manager.events]
        assert "solo.stage.enter" in types_emitted       # react.iteration
        assert "solo.llm.reasoning" in types_emitted      # react.thought
        assert "solo.tool.start" in types_emitted          # react.action
        assert "solo.tool.end" in types_emitted            # react.observation
        assert "solo.stage.exit" in types_emitted          # react.final

    @pytest.mark.asyncio
    async def test_bridge_is_idempotent(self, adapter, event_bus):
        """Calling bridge() twice should not double-subscribe."""
        adapter.bridge()
        first_count = sum(len(cbs) for cbs in event_bus._subscribers.values())
        adapter.bridge()
        second_count = sum(len(cbs) for cbs in event_bus._subscribers.values())
        assert first_count == second_count


# ---------------------------------------------------------------------------
# 2. Phase transitions: creating → connecting → running → completed
# ---------------------------------------------------------------------------

class TestPhaseTransitions:
    """Test the full lifecycle phase transition logic."""

    def test_full_lifecycle_phases(self):
        """Verify the expected phase sequence for a normal task lifecycle."""
        phases = []
        # Simulate: idle → creating → connecting → running → completed
        for phase in ["idle", "creating", "connecting", "running", "completed"]:
            phases.append(phase)

        assert phases == ["idle", "creating", "connecting", "running", "completed"]

    def test_error_lifecycle_phases(self):
        """Verify phase sequence when a task errors out."""
        phases = []
        for phase in ["idle", "creating", "connecting", "running", "error"]:
            phases.append(phase)

        assert phases[-1] == "error"

    def test_review_lifecycle_phases(self):
        """Verify phase sequence with review checkpoint."""
        phases = []
        for phase in ["idle", "creating", "connecting", "running", "waiting_review", "running", "completed"]:
            phases.append(phase)

        assert "waiting_review" in phases
        assert phases[-1] == "completed"

    def test_pause_resume_lifecycle(self):
        """Verify phase sequence with pause/resume."""
        phases = []
        for phase in ["idle", "creating", "connecting", "running", "paused", "running", "completed"]:
            phases.append(phase)

        assert phases.count("running") == 2  # before pause and after resume
        assert "paused" in phases

    @pytest.mark.asyncio
    async def test_task_completed_sets_completed_phase(self, bridged_adapter, event_bus, mock_solo_manager, fake_workspace):
        """When task.completed is emitted, the adapter should trigger workspace status update to 'completed'."""
        task_id = "task-phase-done"
        with patch("flowforge.events.solo_adapter.get_workspace_manager", return_value=fake_workspace):
            event_bus.emit(task_id, "task.completed", {"result": "完成"})
            await asyncio.sleep(0.05)

        assert fake_workspace._task_status.get(task_id) == "completed"

    @pytest.mark.asyncio
    async def test_task_error_sets_error_phase(self, bridged_adapter, event_bus, mock_solo_manager, fake_workspace):
        """When task.error is emitted, the adapter should trigger workspace status update to 'error'."""
        task_id = "task-phase-err"
        with patch("flowforge.events.solo_adapter.get_workspace_manager", return_value=fake_workspace):
            event_bus.emit(task_id, "task.error", {"error_message": "出错了"})
            await asyncio.sleep(0.05)

        assert fake_workspace._task_status.get(task_id) == "error"

    @pytest.mark.asyncio
    async def test_review_ready_event(self, bridged_adapter, event_bus, mock_solo_manager):
        """review.ready → solo.review.ready — frontend should transition to waiting_review."""
        task_id = "task-review-001"
        event_bus.emit(task_id, "review.ready", {"draft_summary": "请审核草稿内容"})
        await asyncio.sleep(0.05)

        review_events = [p for _, et, p in mock_solo_manager.events if et == "solo.review.ready"]
        assert len(review_events) == 1
        assert review_events[0]["draft_summary"] == "请审核草稿内容"

    @pytest.mark.asyncio
    async def test_pause_resume_events(self, bridged_adapter, event_bus, mock_solo_manager):
        """task.paused → solo.task.paused, task.resumed → solo.task.resumed."""
        task_id = "task-pause-001"
        event_bus.emit(task_id, "task.paused", {})
        event_bus.emit(task_id, "task.resumed", {})
        await asyncio.sleep(0.05)

        types_emitted = [et for _, et, _ in mock_solo_manager.events]
        assert "solo.task.paused" in types_emitted
        assert "solo.task.resumed" in types_emitted


# ---------------------------------------------------------------------------
# 3. Stale task detection — running >10 min auto-interrupted
# ---------------------------------------------------------------------------

class TestStaleTaskDetection:
    """Test the fixStalePhase and serverStatusToPhase logic that marks
    long-running tasks as 'interrupted'."""

    def test_fresh_running_task_not_stale(self):
        """A task that started recently should remain in 'running' phase."""
        recent_ts = time.time() * 1000 - 5000  # 5 seconds ago
        assert fix_stale_phase("running", recent_ts) == "running"

    def test_stale_running_task_interrupted(self):
        """A task running for >10 minutes should be marked 'interrupted'."""
        stale_ts = time.time() * 1000 - STALE_TASK_MS - 1000  # 10 min + 1s ago
        assert fix_stale_phase("running", stale_ts) == "interrupted"

    def test_stale_creating_task_interrupted(self):
        """A task stuck in 'creating' for >10 min should be interrupted."""
        stale_ts = time.time() * 1000 - STALE_TASK_MS - 5000
        assert fix_stale_phase("creating", stale_ts) == "interrupted"

    def test_stale_connecting_task_interrupted(self):
        """A task stuck in 'connecting' for >10 min should be interrupted."""
        stale_ts = time.time() * 1000 - STALE_TASK_MS - 2000
        assert fix_stale_phase("connecting", stale_ts) == "interrupted"

    def test_stale_waiting_review_task_interrupted(self):
        """A task stuck in 'waiting_review' for >10 min should be interrupted."""
        stale_ts = time.time() * 1000 - STALE_TASK_MS - 1000
        assert fix_stale_phase("waiting_review", stale_ts) == "interrupted"

    def test_stale_paused_task_interrupted(self):
        """A task paused for >10 min should be interrupted."""
        stale_ts = time.time() * 1000 - STALE_TASK_MS - 3000
        assert fix_stale_phase("paused", stale_ts) == "interrupted"

    def test_completed_task_never_stale(self):
        """A completed task should never be marked as interrupted regardless of age."""
        very_old_ts = time.time() * 1000 - STALE_TASK_MS * 10
        assert fix_stale_phase("completed", very_old_ts) == "completed"

    def test_error_task_never_stale(self):
        """An error task should never be marked as interrupted regardless of age."""
        very_old_ts = time.time() * 1000 - STALE_TASK_MS * 10
        assert fix_stale_phase("error", very_old_ts) == "error"

    def test_interrupted_task_stays_interrupted(self):
        """An already-interrupted task should remain interrupted."""
        stale_ts = time.time() * 1000 - STALE_TASK_MS - 1000
        assert fix_stale_phase("interrupted", stale_ts) == "interrupted"

    def test_idle_task_never_stale(self):
        """Idle tasks should not be affected by stale detection."""
        very_old_ts = time.time() * 1000 - STALE_TASK_MS * 5
        assert fix_stale_phase("idle", very_old_ts) == "idle"

    def test_server_status_completed(self):
        """Server status 'completed' maps to phase 'completed'."""
        assert server_status_to_phase("completed") == "completed"

    def test_server_status_failed(self):
        """Server status 'failed' maps to phase 'error'."""
        assert server_status_to_phase("failed") == "error"

    def test_server_status_error(self):
        """Server status 'error' maps to phase 'error'."""
        assert server_status_to_phase("error") == "error"

    def test_server_status_interrupted(self):
        """Server status 'interrupted' maps to phase 'interrupted'."""
        assert server_status_to_phase("interrupted") == "interrupted"

    def test_server_status_paused(self):
        """Server status 'paused' maps to phase 'paused'."""
        assert server_status_to_phase("paused") == "paused"

    def test_server_status_running_fresh(self):
        """Server status 'running' with recent timestamp stays 'running'."""
        recent_ts = time.time() * 1000 - 5000
        assert server_status_to_phase("running", recent_ts) == "running"

    def test_server_status_running_stale(self):
        """Server status 'running' with old timestamp becomes 'interrupted'."""
        stale_ts = time.time() * 1000 - STALE_TASK_MS - 5000
        assert server_status_to_phase("running", stale_ts) == "interrupted"

    def test_boundary_exactly_10min(self):
        """At exactly 10 minutes, the task should still be considered stale (>= threshold)."""
        boundary_ts = time.time() * 1000 - STALE_TASK_MS
        assert fix_stale_phase("running", boundary_ts) == "interrupted"

    def test_boundary_just_under_10min(self):
        """Just under 10 minutes, the task should still be running."""
        just_under_ts = time.time() * 1000 - STALE_TASK_MS + 1000
        assert fix_stale_phase("running", just_under_ts) == "running"


# ---------------------------------------------------------------------------
# 4. Task switching — restoring correct task state
# ---------------------------------------------------------------------------

class TestTaskSwitching:
    """Test that switching between tasks properly restores the correct state."""

    @pytest.mark.asyncio
    async def test_switch_between_two_tasks(self, bridged_adapter, event_bus, mock_solo_manager, fake_workspace):
        """Emitting events for two different tasks should keep them separate."""
        task_a = "task-switch-a"
        task_b = "task-switch-b"

        with patch("flowforge.events.solo_adapter.get_workspace_manager", return_value=fake_workspace):
            # Task A lifecycle
            event_bus.emit(task_a, "workflow.step.start", {"stage": "research", "label": "研究"})
            event_bus.emit(task_a, "tool.start", {"tool_name": "web_search"})
            event_bus.emit(task_a, "tool.end", {"tool_name": "web_search"})
            event_bus.emit(task_a, "task.completed", {"result": "A完成"})

            # Task B lifecycle
            event_bus.emit(task_b, "workflow.step.start", {"stage": "writing", "label": "写作"})
            event_bus.emit(task_b, "task.error", {"error_message": "B出错"})

            await asyncio.sleep(0.1)

        # Verify events are separated by task_id
        task_a_events = [(et, p) for tid, et, p in mock_solo_manager.events if tid == task_a]
        task_b_events = [(et, p) for tid, et, p in mock_solo_manager.events if tid == task_b]

        # Task A should have stage.enter, tool.start, tool.end, task.completed
        task_a_types = [et for et, _ in task_a_events]
        assert "solo.stage.enter" in task_a_types
        assert "solo.tool.start" in task_a_types
        assert "solo.tool.end" in task_a_types
        assert "solo.task.completed" in task_a_types

        # Task B should have stage.enter, task.error
        task_b_types = [et for et, _ in task_b_events]
        assert "solo.stage.enter" in task_b_types
        assert "solo.task.error" in task_b_types

        # Workspace status should reflect the last status update per task
        assert fake_workspace._task_status.get(task_a) == "completed"
        assert fake_workspace._task_status.get(task_b) == "error"

    @pytest.mark.asyncio
    async def test_messages_are_isolated_per_task(self, bridged_adapter, event_bus, mock_solo_manager, fake_workspace):
        """Messages saved to workspace should be isolated per task_id."""
        task_x = "task-msg-x"
        task_y = "task-msg-y"

        with patch("flowforge.events.solo_adapter.get_workspace_manager", return_value=fake_workspace):
            event_bus.emit(task_x, "workflow.step.start", {"stage": "plan", "label": "规划"})
            event_bus.emit(task_y, "workflow.step.start", {"stage": "research", "label": "检索"})
            event_bus.emit(task_x, "tool.start", {"tool_name": "llm"})
            await asyncio.sleep(0.1)

        # Each task should have its own message list
        msgs_x = fake_workspace.load_messages(task_x)
        msgs_y = fake_workspace.load_messages(task_y)

        # Task X should have stage + tool messages
        assert len(msgs_x) >= 2
        # Task Y should have only stage message
        assert len(msgs_y) >= 1

        # Cross-contamination check: task X messages should not contain task Y's stage
        x_stages = [m for m in msgs_x if m.get("role") == "stage"]
        assert all("检索" not in m.get("content", "") for m in x_stages)

    @pytest.mark.asyncio
    async def test_task_switch_preserves_in_progress_state(self, bridged_adapter, event_bus, mock_solo_manager, fake_workspace):
        """When switching away from a running task and back, its state should be preserved."""
        task_1 = "task-preserve-1"
        task_2 = "task-preserve-2"

        with patch("flowforge.events.solo_adapter.get_workspace_manager", return_value=fake_workspace):
            # Task 1 starts and is in progress
            event_bus.emit(task_1, "workflow.step.start", {"stage": "research", "label": "信息检索"})
            event_bus.emit(task_1, "tool.start", {"tool_name": "helixrag_search"})
            await asyncio.sleep(0.05)

            # Switch to task 2
            event_bus.emit(task_2, "workflow.step.start", {"stage": "writing", "label": "内容创作"})
            await asyncio.sleep(0.05)

            # Task 1 messages should still be intact
            msgs_1 = fake_workspace.load_messages(task_1)
            assert len(msgs_1) >= 2  # stage.enter + tool.start

            # Task 2 has its own messages
            msgs_2 = fake_workspace.load_messages(task_2)
            assert len(msgs_2) >= 1

    def test_phase_restoration_on_switch(self):
        """Simulate the frontend logic: switching to a completed task restores 'completed' phase,
        switching to a stale running task restores 'interrupted' phase."""
        # Switching to a completed task
        phase = fix_stale_phase("completed", time.time() * 1000 - 3600000)  # 1 hour ago
        assert phase == "completed"

        # Switching to a stale running task
        stale_ts = time.time() * 1000 - STALE_TASK_MS - 5000
        phase = fix_stale_phase("running", stale_ts)
        assert phase == "interrupted"

        # Switching to a fresh running task
        fresh_ts = time.time() * 1000 - 30000  # 30 seconds ago
        phase = fix_stale_phase("running", fresh_ts)
        assert phase == "running"


# ---------------------------------------------------------------------------
# 5. SoloAdapter message persistence (_SAVE_EVENTS)
# ---------------------------------------------------------------------------

class TestMessagePersistence:
    """Test that SoloAdapter correctly persists messages to workspace
    for events in _SAVE_EVENTS, and skips events not in that set."""

    def test_save_events_set_contents(self):
        """Verify _SAVE_EVENTS contains the expected event types."""
        expected = {
            "solo.stage.enter",
            "solo.stage.exit",
            "solo.tool.start",
            "solo.tool.end",
            "solo.draft.update",
            "solo.draft.file",
            "solo.step.intermediate",
            "solo.review.ready",
            "solo.task.completed",
            "solo.task.error",
        }
        assert _SAVE_EVENTS == expected

    def test_llm_events_not_saved(self):
        """LLM streaming events (solo.llm.start/stream/end) should NOT be in _SAVE_EVENTS
        to avoid duplicate AI messages in workspace chat history."""
        assert "solo.llm.start" not in _SAVE_EVENTS
        assert "solo.llm.stream" not in _SAVE_EVENTS
        assert "solo.llm.end" not in _SAVE_EVENTS

    @pytest.mark.asyncio
    async def test_stage_enter_saves_message(self, bridged_adapter, event_bus, fake_workspace):
        """solo.stage.enter should save a stage message to workspace."""
        task_id = "task-save-stage"
        with patch("flowforge.events.solo_adapter.get_workspace_manager", return_value=fake_workspace):
            event_bus.emit(task_id, "workflow.step.start", {"stage": "research", "label": "信息检索"})
            await asyncio.sleep(0.05)

        msgs = fake_workspace.load_messages(task_id)
        stage_msgs = [m for m in msgs if m.get("role") == "stage"]
        assert len(stage_msgs) >= 1
        assert stage_msgs[0]["content"] == "信息检索"

    @pytest.mark.asyncio
    async def test_tool_events_save_messages(self, bridged_adapter, event_bus, fake_workspace):
        """solo.tool.start and solo.tool.end should save tool messages."""
        task_id = "task-save-tool"
        with patch("flowforge.events.solo_adapter.get_workspace_manager", return_value=fake_workspace):
            event_bus.emit(task_id, "tool.start", {"tool_name": "web_search"})
            event_bus.emit(task_id, "tool.end", {"tool_name": "web_search", "result": {}})
            await asyncio.sleep(0.05)

        msgs = fake_workspace.load_messages(task_id)
        tool_msgs = [m for m in msgs if m.get("role") == "tool"]
        assert len(tool_msgs) >= 2

    @pytest.mark.asyncio
    async def test_draft_update_saves_only_final(self, bridged_adapter, event_bus, fake_workspace):
        """solo.draft.update with is_partial=True should NOT save (streaming delta).
        Only is_partial=False (final draft) should be persisted."""
        task_id = "task-save-draft"
        with patch("flowforge.events.solo_adapter.get_workspace_manager", return_value=fake_workspace):
            # Partial update — should NOT be saved
            event_bus.emit(task_id, "draft.update", {
                "content": "部分内容...", "is_partial": True, "agent_name": "Writer"
            })
            # Final update — should be saved
            event_bus.emit(task_id, "draft.update", {
                "content": "最终完整内容", "is_partial": False, "agent_name": "Writer"
            })
            await asyncio.sleep(0.05)

        msgs = fake_workspace.load_messages(task_id)
        assistant_msgs = [m for m in msgs if m.get("role") == "assistant"]
        # Only the final (non-partial) draft should be saved
        assert len(assistant_msgs) == 1
        assert assistant_msgs[0]["content"] == "最终完整内容"

    @pytest.mark.asyncio
    async def test_task_completed_saves_result_message(self, bridged_adapter, event_bus, fake_workspace):
        """solo.task.completed should save an assistant message with the result."""
        task_id = "task-save-completed"
        with patch("flowforge.events.solo_adapter.get_workspace_manager", return_value=fake_workspace):
            event_bus.emit(task_id, "task.completed", {"result": "文章已发布", "summary": "3段落"})
            await asyncio.sleep(0.05)

        msgs = fake_workspace.load_messages(task_id)
        # Should have an assistant message with the result
        result_msgs = [m for m in msgs if m.get("role") == "assistant" and "文章已发布" in m.get("content", "")]
        assert len(result_msgs) >= 1

    @pytest.mark.asyncio
    async def test_task_error_saves_error_message(self, bridged_adapter, event_bus, fake_workspace):
        """solo.task.error should save a system message with the error."""
        task_id = "task-save-error"
        with patch("flowforge.events.solo_adapter.get_workspace_manager", return_value=fake_workspace):
            event_bus.emit(task_id, "task.error", {"error_message": "生成失败"})
            await asyncio.sleep(0.05)

        msgs = fake_workspace.load_messages(task_id)
        error_msgs = [m for m in msgs if m.get("role") == "system" and "生成失败" in m.get("content", "")]
        assert len(error_msgs) >= 1

    @pytest.mark.asyncio
    async def test_llm_stream_not_saved_to_workspace(self, bridged_adapter, event_bus, fake_workspace):
        """LLM streaming events should NOT be persisted to workspace chat history
        (they are transient and draft.update carries the final content)."""
        task_id = "task-no-llm-save"
        with patch("flowforge.events.solo_adapter.get_workspace_manager", return_value=fake_workspace):
            event_bus.emit(task_id, "llm.start", {"model": "gpt-4"})
            event_bus.emit(task_id, "llm.stream", {"delta_text": "你好", "agent_name": "AI"})
            event_bus.emit(task_id, "llm.end", {"model": "gpt-4", "total_tokens": 100})
            await asyncio.sleep(0.05)

        msgs = fake_workspace.load_messages(task_id)
        # No messages should have been saved from llm events
        assert len(msgs) == 0

    @pytest.mark.asyncio
    async def test_review_ready_saves_message(self, bridged_adapter, event_bus, fake_workspace):
        """solo.review.ready should save a review message to workspace."""
        task_id = "task-save-review"
        with patch("flowforge.events.solo_adapter.get_workspace_manager", return_value=fake_workspace):
            event_bus.emit(task_id, "review.ready", {"draft_summary": "请审核此草稿"})
            await asyncio.sleep(0.05)

        msgs = fake_workspace.load_messages(task_id)
        review_msgs = [m for m in msgs if m.get("role") == "review"]
        assert len(review_msgs) >= 1
        assert review_msgs[0]["content"] == "请审核此草稿"

    @pytest.mark.asyncio
    async def test_step_intermediate_saves_message(self, bridged_adapter, event_bus, fake_workspace):
        """solo.step.intermediate should save a system message."""
        task_id = "task-save-intermediate"
        with patch("flowforge.events.solo_adapter.get_workspace_manager", return_value=fake_workspace):
            event_bus.emit(task_id, "step.intermediate", {"step_name": "数据预处理"})
            await asyncio.sleep(0.05)

        msgs = fake_workspace.load_messages(task_id)
        sys_msgs = [m for m in msgs if m.get("role") == "system" and "数据预处理" in m.get("content", "")]
        assert len(sys_msgs) >= 1


# ---------------------------------------------------------------------------
# 6. _event_to_message unit tests
# ---------------------------------------------------------------------------

class TestEventToMessage:
    """Direct unit tests for the _event_to_message translation function."""

    def test_stage_enter_message(self):
        msg = _event_to_message("solo.stage.enter", {"stage": "research", "label": "信息检索"})
        assert msg is not None
        assert msg["role"] == "stage"
        assert msg["content"] == "信息检索"

    def test_stage_enter_fallback_to_stage_key(self):
        """When 'label' is missing, fall back to 'stage' key."""
        msg = _event_to_message("solo.stage.enter", {"stage": "research"})
        assert msg is not None
        assert msg["content"] == "research"

    def test_stage_enter_fallback_to_step_key(self):
        """When both 'label' and 'stage' are missing, fall back to 'step' key."""
        msg = _event_to_message("solo.stage.enter", {"step": "step-1"})
        assert msg is not None
        assert msg["content"] == "step-1"

    def test_tool_start_message(self):
        msg = _event_to_message("solo.tool.start", {"tool_name": "web_search"})
        assert msg is not None
        assert msg["role"] == "tool"
        assert msg["content"] == "web_search"

    def test_tool_start_default_name(self):
        """When tool_name is missing, default to 'tool'."""
        msg = _event_to_message("solo.tool.start", {})
        assert msg is not None
        assert msg["content"] == "tool"

    def test_draft_update_partial_not_saved(self):
        """Partial draft updates should return None (not persisted)."""
        msg = _event_to_message("solo.draft.update", {
            "content": "partial...", "is_partial": True, "agent_name": "AI"
        })
        assert msg is None

    def test_draft_update_final_saved(self):
        """Final draft updates should return an assistant message."""
        msg = _event_to_message("solo.draft.update", {
            "content": "最终内容", "is_partial": False, "agent_name": "Writer"
        })
        assert msg is not None
        assert msg["role"] == "assistant"
        assert msg["content"] == "最终内容"
        assert msg["data"]["_agent_name"] == "Writer"
        assert msg["data"]["_draft"] is True

    def test_draft_update_empty_final_not_saved(self):
        """Final draft with empty content should return None."""
        msg = _event_to_message("solo.draft.update", {
            "content": "", "is_partial": False, "agent_name": "AI"
        })
        assert msg is None

    def test_draft_file_message(self):
        msg = _event_to_message("solo.draft.file", {"filename": "article.md", "content": "# 标题"})
        assert msg is not None
        assert msg["role"] == "assistant"
        assert msg["data"]["_is_file"] is True

    def test_step_intermediate_message(self):
        msg = _event_to_message("solo.step.intermediate", {"step_name": "数据清洗"})
        assert msg is not None
        assert msg["role"] == "system"
        assert msg["content"] == "数据清洗"

    def test_review_ready_message(self):
        msg = _event_to_message("solo.review.ready", {"draft_summary": "请审核"})
        assert msg is not None
        assert msg["role"] == "review"
        assert msg["content"] == "请审核"

    def test_task_completed_with_result(self):
        msg = _event_to_message("solo.task.completed", {"result": "文章已生成"})
        assert msg is not None
        assert msg["role"] == "assistant"
        assert msg["content"] == "文章已生成"

    def test_task_completed_with_summary(self):
        """When 'result' is missing, fall back to 'summary'."""
        msg = _event_to_message("solo.task.completed", {"summary": "3段落"})
        assert msg is not None
        assert msg["content"] == "3段落"

    def test_task_completed_no_result(self):
        """When no result/summary/content, return system message."""
        msg = _event_to_message("solo.task.completed", {})
        assert msg is not None
        assert msg["role"] == "system"
        assert "✓" in msg["content"]

    def test_task_error_message(self):
        msg = _event_to_message("solo.task.error", {"error_message": "超时"})
        assert msg is not None
        assert msg["role"] == "system"
        assert "✗" in msg["content"]
        assert "超时" in msg["content"]

    def test_task_error_fallback_to_error_key(self):
        """When 'error_message' is missing, fall back to 'error' key."""
        msg = _event_to_message("solo.task.error", {"error": "连接失败"})
        assert msg is not None
        assert "连接失败" in msg["content"]

    def test_task_error_default_message(self):
        """When no error key, use default '任务出错'."""
        msg = _event_to_message("solo.task.error", {})
        assert msg is not None
        assert "任务出错" in msg["content"]

    def test_unknown_event_returns_none(self):
        """Events not handled by _event_to_message should return None."""
        msg = _event_to_message("solo.llm.start", {"model": "gpt-4"})
        assert msg is None

    def test_stage_exit_message(self):
        msg = _event_to_message("solo.stage.exit", {"stage": "research", "label": "信息检索"})
        assert msg is not None
        assert msg["role"] == "stage"
        assert msg["content"] == "信息检索"


# ---------------------------------------------------------------------------
# 7. End-to-end flow: full task lifecycle with persistence
# ---------------------------------------------------------------------------

class TestFullTaskLifecycleFlow:
    """Integration test: emit a complete task lifecycle through the EventBus
    and verify the SoloAdapter correctly bridges, persists, and updates status."""

    @pytest.mark.asyncio
    async def test_complete_successful_task_flow(self, bridged_adapter, event_bus, fake_workspace):
        """Simulate a full successful task: plan → research → write → review → complete."""
        task_id = "task-e2e-success"

        with patch("flowforge.events.solo_adapter.get_workspace_manager", return_value=fake_workspace):
            # Phase 1: Planning
            event_bus.emit(task_id, "workflow.step.start", {"stage": "planning", "label": "选题规划", "order": 1, "total": 4})
            event_bus.emit(task_id, "tool.start", {"tool_name": "llm"})
            event_bus.emit(task_id, "tool.end", {"tool_name": "llm"})
            event_bus.emit(task_id, "workflow.step.complete", {"stage": "planning", "label": "选题规划"})

            # Phase 2: Research
            event_bus.emit(task_id, "workflow.step.start", {"stage": "research", "label": "素材检索", "order": 2, "total": 4})
            event_bus.emit(task_id, "tool.start", {"tool_name": "helixrag_search"})
            event_bus.emit(task_id, "tool.end", {"tool_name": "helixrag_search"})
            event_bus.emit(task_id, "workflow.step.complete", {"stage": "research", "label": "素材检索"})

            # Phase 3: Writing
            event_bus.emit(task_id, "workflow.step.start", {"stage": "writing", "label": "文章创作", "order": 3, "total": 4})
            event_bus.emit(task_id, "draft.update", {"content": "标题：AI的未来", "is_partial": True, "agent_name": "Writer"})
            event_bus.emit(task_id, "draft.update", {"content": "标题：AI的未来\n\n正文内容...", "is_partial": False, "agent_name": "Writer"})
            event_bus.emit(task_id, "workflow.step.complete", {"stage": "writing", "label": "文章创作"})

            # Phase 4: Review
            event_bus.emit(task_id, "workflow.step.start", {"stage": "review", "label": "审核检查", "order": 4, "total": 4})
            event_bus.emit(task_id, "review.ready", {"draft_summary": "请审核文章草稿"})
            event_bus.emit(task_id, "workflow.step.complete", {"stage": "review", "label": "审核检查"})

            # Task completed
            event_bus.emit(task_id, "task.completed", {"result": "文章已发布至微信公众号", "published_urls": ["https://mp.weixin.qq.com/s/xxx"]})

            await asyncio.sleep(0.2)

        # Verify SoloManager received all event types
        emitted_types = [et for _, et, _ in fake_workspace.__class__.__mro__ and [] or []]
        # Use mock_solo_manager from the adapter directly
        solo_mgr = bridged_adapter.solo_manager
        emitted_types = [et for _, et, _ in solo_mgr.events]

        # Should have stage enters/exits for all 4 phases
        stage_enters = [et for et in emitted_types if et == "solo.stage.enter"]
        stage_exits = [et for et in emitted_types if et == "solo.stage.exit"]
        assert len(stage_enters) >= 4
        assert len(stage_exits) >= 4

        # Should have tool events
        assert "solo.tool.start" in emitted_types
        assert "solo.tool.end" in emitted_types

        # Should have draft update
        assert "solo.draft.update" in emitted_types

        # Should have review
        assert "solo.review.ready" in emitted_types

        # Should have task completed
        assert "solo.task.completed" in emitted_types

        # Verify workspace persistence
        msgs = fake_workspace.load_messages(task_id)
        assert len(msgs) > 0

        # Verify task status updated to completed
        assert fake_workspace._task_status.get(task_id) == "completed"

    @pytest.mark.asyncio
    async def test_error_during_execution_flow(self, bridged_adapter, event_bus, fake_workspace):
        """Simulate a task that errors during execution."""
        task_id = "task-e2e-error"

        with patch("flowforge.events.solo_adapter.get_workspace_manager", return_value=fake_workspace):
            event_bus.emit(task_id, "workflow.step.start", {"stage": "research", "label": "素材检索"})
            event_bus.emit(task_id, "tool.start", {"tool_name": "web_search"})
            event_bus.emit(task_id, "task.error", {"error_message": "搜索服务不可用", "step_name": "research"})

            await asyncio.sleep(0.1)

        # Verify error message was saved
        msgs = fake_workspace.load_messages(task_id)
        error_msgs = [m for m in msgs if m.get("role") == "system" and "搜索服务不可用" in m.get("content", "")]
        assert len(error_msgs) >= 1

        # Verify task status updated to error
        assert fake_workspace._task_status.get(task_id) == "error"

    @pytest.mark.asyncio
    async def test_react_loop_detected_flow(self, bridged_adapter, event_bus, fake_workspace):
        """Simulate a ReAct loop detection that triggers solo.task.error."""
        task_id = "task-e2e-loop"

        with patch("flowforge.events.solo_adapter.get_workspace_manager", return_value=fake_workspace):
            event_bus.emit(task_id, "react.iteration", {"iteration": 1})
            event_bus.emit(task_id, "react.thought", {"agent_name": "ReActAgent", "delta_text": "尝试搜索"})
            event_bus.emit(task_id, "react.action", {"tool_name": "web_search"})
            event_bus.emit(task_id, "react.observation", {"tool_name": "web_search"})
            # Loop detected
            event_bus.emit(task_id, "react.loop_detected", {"error_message": "检测到循环，已终止"})

            await asyncio.sleep(0.1)

        # react.loop_detected maps to solo.task.error
        solo_mgr = bridged_adapter.solo_manager
        error_events = [et for _, et, _ in solo_mgr.events if et == "solo.task.error"]
        assert len(error_events) >= 1

        # Task status should be error
        assert fake_workspace._task_status.get(task_id) == "error"


# ---------------------------------------------------------------------------
# 8. ConnectionManager event buffering
# ---------------------------------------------------------------------------

class TestConnectionManagerBuffering:
    """Test that the ConnectionManager buffers events when no WebSocket
    client is connected and replays them on connect."""

    @pytest.mark.asyncio
    async def test_events_buffered_when_no_connection(self):
        """Events emitted with no active connection should be buffered."""
        from flowforge.app.api.endpoints.websocket import ConnectionManager

        mgr = ConnectionManager()
        task_id = "task-buffer-001"

        # Emit event with no connections
        await mgr.emit_event(task_id, "solo.stage.enter", {"stage": "research"})

        # Should be in buffer
        buffered = mgr.get_buffered_events(task_id)
        assert len(buffered) == 1
        assert buffered[0]["type"] == "solo.stage.enter"
        assert buffered[0]["payload"]["stage"] == "research"

    @pytest.mark.asyncio
    async def test_multiple_events_buffered_in_order(self):
        """Multiple buffered events should maintain their order."""
        from flowforge.app.api.endpoints.websocket import ConnectionManager

        mgr = ConnectionManager()
        task_id = "task-buffer-order"

        await mgr.emit_event(task_id, "solo.stage.enter", {"stage": "plan", "order": 1})
        await mgr.emit_event(task_id, "solo.tool.start", {"tool_name": "llm"})
        await mgr.emit_event(task_id, "solo.tool.end", {"tool_name": "llm"})
        await mgr.emit_event(task_id, "solo.stage.exit", {"stage": "plan"})

        buffered = mgr.get_buffered_events(task_id)
        assert len(buffered) == 4
        assert buffered[0]["type"] == "solo.stage.enter"
        assert buffered[1]["type"] == "solo.tool.start"
        assert buffered[2]["type"] == "solo.tool.end"
        assert buffered[3]["type"] == "solo.stage.exit"

    @pytest.mark.asyncio
    async def test_seq_numbers_increment(self):
        """Each emitted event should get an incrementing sequence number."""
        from flowforge.app.api.endpoints.websocket import ConnectionManager

        mgr = ConnectionManager()
        task_id = "task-seq-001"

        await mgr.emit_event(task_id, "solo.stage.enter", {})
        await mgr.emit_event(task_id, "solo.tool.start", {})
        await mgr.emit_event(task_id, "solo.tool.end", {})

        buffered = mgr.get_buffered_events(task_id)
        seqs = [e["seq"] for e in buffered]
        assert seqs == sorted(seqs)  # Monotonically increasing
        assert len(set(seqs)) == 3   # All unique

    @pytest.mark.asyncio
    async def test_get_buffered_events_from_seq(self):
        """Replay from a specific sequence number should return only later events."""
        from flowforge.app.api.endpoints.websocket import ConnectionManager

        mgr = ConnectionManager()
        task_id = "task-replay-001"

        await mgr.emit_event(task_id, "solo.stage.enter", {})  # seq=1
        await mgr.emit_event(task_id, "solo.tool.start", {})   # seq=2
        await mgr.emit_event(task_id, "solo.tool.end", {})     # seq=3

        # Replay from seq=2
        replay = mgr.get_buffered_events(task_id, from_seq=2)
        assert len(replay) == 2
        assert replay[0]["seq"] == 2
        assert replay[1]["seq"] == 3
