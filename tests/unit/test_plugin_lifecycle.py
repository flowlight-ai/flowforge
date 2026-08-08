"""Tests for FlowForge Plugin Lifecycle Manager — hot load/unload/pause/resume/reload.

Validates:
1. PluginState state machine transitions
2. PluginLifecycleManager.register_plugin / get_plugin / list_plugins
3. unload_plugin — agents/tools/events/schedules removed
4. reload_plugin — unload then re-register
5. pause_plugin / resume_plugin — event and schedule pause/resume
6. API endpoints via TestClient
"""

import asyncio
import pytest

from flowforge.core.plugin_protocol import (
    PluginManifest,
    PluginState,
    FlowForgePlugin,
)
from flowforge.core.plugin_lifecycle import PluginLifecycleManager, PluginRegistrationRecord
from flowforge.core.agent_registry import AgentRegistry
from flowforge.tools.registry import ToolRegistry
from flowforge.events.event_bus import EventBus
from flowforge.modes.registry import ModeRegistry


# ── Test plugin stubs ─────────────────────────────────────────────────


class _StubAgent:
    """Minimal agent stub for testing."""

    def __init__(self, name: str):
        self.name = name


class _StubTool:
    """Minimal tool stub for testing."""

    def __init__(self, name: str):
        self.name = name


class _TestPlugin(FlowForgePlugin):
    """Concrete plugin for lifecycle testing."""

    def __init__(self, name: str = "test_plugin", version: str = "1.0.0"):
        super().__init__()
        self.manifest = PluginManifest(name=name, version=version)
        self._shutdown_called = False
        # Store handler reference so identity comparison works
        self._event_handler = self._on_test_event

    def register_agents(self, agent_registry):
        agent_registry.register(_StubAgent("test_agent"))

    def register_tools(self, tool_registry):
        tool_registry.register(_StubTool("test_tool"))

    def register_event_handlers(self, event_bus):
        event_bus.subscribe("test.event", self._event_handler)

    def _on_test_event(self, event):
        pass

    def on_shutdown(self, context):
        self._shutdown_called = True


class _EmptyPlugin(FlowForgePlugin):
    """Plugin that registers nothing."""

    def __init__(self, name: str = "empty_plugin"):
        super().__init__()
        self.manifest = PluginManifest(name=name)


def _load_plugin_into_manager(
    plugin: FlowForgePlugin,
    mgr: PluginLifecycleManager,
):
    """Simulate what _load_single_plugin does: register entries and track them.

    This helper registers the plugin's entries into the registries and
    populates the plugin's tracking lists, then registers with the lifecycle
    manager.
    """
    # Track agents
    agents_before = set(mgr._agent_registry._agents.keys())
    factories_before = set(mgr._agent_registry._factories.keys())
    plugin.register_agents(mgr._agent_registry)
    new_agents = (set(mgr._agent_registry._agents.keys()) - agents_before) | \
                 (set(mgr._agent_registry._factories.keys()) - factories_before)
    plugin._registered_agents.extend(new_agents)

    # Track tools
    tools_before = set(mgr._tool_registry._tools.keys())
    plugin.register_tools(mgr._tool_registry)
    new_tools = set(mgr._tool_registry._tools.keys()) - tools_before
    plugin._registered_tools.extend(new_tools)

    # Track event handlers
    if mgr._event_bus:
        handlers_before = {
            et: [(id(h), h) for h, _ in handlers]
            for et, handlers in list(mgr._event_bus._subscribers.items())
        }
        plugin.register_event_handlers(mgr._event_bus)
        for et in mgr._event_bus._subscribers:
            old_ids = {hid for hid, _ in handlers_before.get(et, [])}
            for cb, filt in mgr._event_bus._subscribers[et]:
                if id(cb) not in old_ids:
                    plugin._registered_event_handlers.append((et, cb))

    plugin.state = PluginState.READY
    mgr.register_plugin(plugin)


# ── 1. PluginState State Machine ──────────────────────────────────────


class TestPluginState:
    """Test PluginState enum and state transitions."""

    def test_initial_state_is_uninitialized(self):
        plugin = _TestPlugin()
        assert plugin.state == PluginState.UNINITIALIZED

    def test_state_transition_to_starting(self):
        plugin = _TestPlugin()
        plugin.state = PluginState.STARTING
        assert plugin.state == PluginState.STARTING

    def test_state_transition_to_ready(self):
        plugin = _TestPlugin()
        plugin.state = PluginState.READY
        assert plugin.state == PluginState.READY

    def test_state_transition_to_paused(self):
        plugin = _TestPlugin()
        plugin.state = PluginState.PAUSED
        assert plugin.state == PluginState.PAUSED

    def test_state_transition_to_stopping(self):
        plugin = _TestPlugin()
        plugin.state = PluginState.STOPPING
        assert plugin.state == PluginState.STOPPING

    def test_state_transition_to_stopped(self):
        plugin = _TestPlugin()
        plugin.state = PluginState.STOPPED
        assert plugin.state == PluginState.STOPPED

    def test_state_transition_to_error(self):
        plugin = _TestPlugin()
        plugin.state = PluginState.ERROR
        assert plugin.state == PluginState.ERROR

    def test_state_value_strings(self):
        assert PluginState.UNINITIALIZED.value == "uninitialized"
        assert PluginState.STARTING.value == "starting"
        assert PluginState.READY.value == "ready"
        assert PluginState.PAUSED.value == "paused"
        assert PluginState.STOPPING.value == "stopping"
        assert PluginState.STOPPED.value == "stopped"
        assert PluginState.ERROR.value == "error"

    def test_full_lifecycle_transition(self):
        plugin = _TestPlugin()
        assert plugin.state == PluginState.UNINITIALIZED
        plugin.state = PluginState.STARTING
        plugin.state = PluginState.READY
        plugin.state = PluginState.PAUSED
        plugin.state = PluginState.READY
        plugin.state = PluginState.STOPPING
        plugin.state = PluginState.STOPPED
        assert plugin.state == PluginState.STOPPED


# ── 2. PluginRegistrationRecord ───────────────────────────────────────


class TestPluginRegistrationRecord:
    """Test PluginRegistrationRecord tracking."""

    def test_summary_empty(self):
        record = PluginRegistrationRecord("test")
        summary = record.summary()
        assert summary["plugin"] == "test"
        assert summary["agents"] == 0
        assert summary["tools"] == 0
        assert summary["modes"] == 0
        assert summary["routes"] == 0
        assert summary["event_subscriptions"] == 0
        assert summary["schedules"] == 0

    def test_summary_with_entries(self):
        record = PluginRegistrationRecord("test")
        record.agent_names = ["agent1", "agent2"]
        record.tool_names = ["tool1"]
        record.event_subscriptions = [("event1", lambda e: None)]
        summary = record.summary()
        assert summary["agents"] == 2
        assert summary["tools"] == 1
        assert summary["event_subscriptions"] == 1


# ── 3. PluginLifecycleManager — register / get / list ─────────────────


class TestPluginLifecycleManagerBasic:
    """Test basic PluginLifecycleManager operations."""

    def _make_manager(self):
        return PluginLifecycleManager(
            agent_registry=AgentRegistry(),
            tool_registry=ToolRegistry(),
            mode_registry=ModeRegistry(),
            event_bus=EventBus(),
        )

    def test_register_plugin(self):
        mgr = self._make_manager()
        plugin = _TestPlugin()
        _load_plugin_into_manager(plugin, mgr)
        assert mgr.get_plugin("test_plugin") is plugin
        assert mgr.get_state("test_plugin") == PluginState.READY

    def test_get_plugin_not_found(self):
        mgr = self._make_manager()
        assert mgr.get_plugin("nonexistent") is None

    def test_get_state_not_found(self):
        mgr = self._make_manager()
        assert mgr.get_state("nonexistent") is None

    def test_list_plugins_empty(self):
        mgr = self._make_manager()
        result = mgr.list_plugins()
        assert result == []

    def test_list_plugins_with_entries(self):
        mgr = self._make_manager()
        plugin = _TestPlugin()
        _load_plugin_into_manager(plugin, mgr)

        result = mgr.list_plugins()
        assert len(result) == 1
        assert result[0]["name"] == "test_plugin"
        assert result[0]["state"] == "ready"
        assert result[0]["health"]["status"] == "healthy"
        assert "registrations" in result[0]

    def test_get_record(self):
        mgr = self._make_manager()
        plugin = _TestPlugin()
        _load_plugin_into_manager(plugin, mgr)

        record = mgr.get_record("test_plugin")
        assert record is not None
        assert "test_agent" in record.agent_names
        assert "test_tool" in record.tool_names


# ── 4. Unload Plugin ──────────────────────────────────────────────────


class TestUnloadPlugin:
    """Test unload_plugin removes all registrations."""

    def _make_loaded_plugin(self):
        agent_registry = AgentRegistry()
        tool_registry = ToolRegistry()
        event_bus = EventBus()
        mgr = PluginLifecycleManager(
            agent_registry=agent_registry,
            tool_registry=tool_registry,
            event_bus=event_bus,
        )
        plugin = _TestPlugin()
        _load_plugin_into_manager(plugin, mgr)
        return mgr, plugin, agent_registry, tool_registry, event_bus

    @pytest.mark.asyncio
    async def test_unload_removes_agents(self):
        mgr, plugin, agent_reg, _, _ = self._make_loaded_plugin()
        assert "test_agent" in agent_reg._agents

        result = await mgr.unload_plugin("test_plugin")
        assert result["status"] == "success"
        assert "test_agent" in result["removed"].get("agents", [])

        assert "test_agent" not in agent_reg._agents

    @pytest.mark.asyncio
    async def test_unload_removes_tools(self):
        mgr, plugin, _, tool_reg, _ = self._make_loaded_plugin()
        assert "test_tool" in tool_reg._tools

        result = await mgr.unload_plugin("test_plugin")
        assert result["status"] == "success"
        assert "test_tool" in result["removed"].get("tools", [])

        assert "test_tool" not in tool_reg._tools

    @pytest.mark.asyncio
    async def test_unload_removes_event_handlers(self):
        mgr, plugin, _, _, event_bus = self._make_loaded_plugin()
        assert len(event_bus._subscribers.get("test.event", [])) > 0

        result = await mgr.unload_plugin("test_plugin")
        assert result["status"] == "success"

        assert len(event_bus._subscribers.get("test.event", [])) == 0

    @pytest.mark.asyncio
    async def test_unload_calls_on_shutdown(self):
        mgr, plugin, _, _, _ = self._make_loaded_plugin()
        await mgr.unload_plugin("test_plugin")
        assert plugin._shutdown_called is True

    @pytest.mark.asyncio
    async def test_unload_sets_state_to_stopped(self):
        mgr, plugin, _, _, _ = self._make_loaded_plugin()
        await mgr.unload_plugin("test_plugin")
        assert mgr.get_state("test_plugin") == PluginState.STOPPED

    @pytest.mark.asyncio
    async def test_unload_nonexistent_plugin(self):
        mgr = PluginLifecycleManager()
        result = await mgr.unload_plugin("nonexistent")
        assert result["status"] == "error"
        assert "not found" in result["error"]

    @pytest.mark.asyncio
    async def test_unload_plugin_in_wrong_state(self):
        mgr = PluginLifecycleManager()
        plugin = _TestPlugin()
        mgr._plugins["test_plugin"] = plugin
        mgr._states["test_plugin"] = PluginState.STARTING
        result = await mgr.unload_plugin("test_plugin")
        assert result["status"] == "error"
        assert "cannot unload" in result["error"]


# ── 5. Reload Plugin ──────────────────────────────────────────────────


class TestReloadPlugin:
    """Test reload_plugin — unload then re-register."""

    def _make_loaded_plugin(self):
        agent_registry = AgentRegistry()
        tool_registry = ToolRegistry()
        event_bus = EventBus()
        mgr = PluginLifecycleManager(
            agent_registry=agent_registry,
            tool_registry=tool_registry,
            event_bus=event_bus,
        )
        plugin = _TestPlugin()
        _load_plugin_into_manager(plugin, mgr)
        return mgr, plugin, agent_registry, tool_registry, event_bus

    @pytest.mark.asyncio
    async def test_reload_nonexistent_plugin(self):
        mgr = PluginLifecycleManager()
        result = await mgr.reload_plugin("nonexistent")
        assert result["status"] == "error"
        assert "not found" in result["error"]

    @pytest.mark.asyncio
    async def test_reload_returns_success(self):
        mgr, plugin, agent_reg, tool_reg, event_bus = self._make_loaded_plugin()
        result = await mgr.reload_plugin("test_plugin")
        assert result["status"] == "success"
        assert result["action"] == "reloaded"

    @pytest.mark.asyncio
    async def test_reload_state_is_ready(self):
        mgr, plugin, agent_reg, tool_reg, event_bus = self._make_loaded_plugin()
        await mgr.reload_plugin("test_plugin")
        assert mgr.get_state("test_plugin") == PluginState.READY

    @pytest.mark.asyncio
    async def test_reload_agents_reregistered(self):
        mgr, plugin, agent_reg, tool_reg, event_bus = self._make_loaded_plugin()
        await mgr.reload_plugin("test_plugin")
        # After reload, agents should be re-registered
        assert "test_agent" in agent_reg._agents


# ── 6. Pause / Resume Plugin ──────────────────────────────────────────


class TestPauseResumePlugin:
    """Test pause_plugin and resume_plugin."""

    def _make_loaded_plugin(self):
        agent_registry = AgentRegistry()
        tool_registry = ToolRegistry()
        event_bus = EventBus()
        mgr = PluginLifecycleManager(
            agent_registry=agent_registry,
            tool_registry=tool_registry,
            event_bus=event_bus,
        )
        plugin = _TestPlugin()
        _load_plugin_into_manager(plugin, mgr)
        return mgr, plugin, agent_registry, tool_registry, event_bus

    @pytest.mark.asyncio
    async def test_pause_sets_state_to_paused(self):
        mgr, plugin, _, _, _ = self._make_loaded_plugin()
        result = await mgr.pause_plugin("test_plugin")
        assert result["status"] == "success"
        assert result["state"] == "paused"
        assert mgr.get_state("test_plugin") == PluginState.PAUSED

    @pytest.mark.asyncio
    async def test_pause_removes_event_subscriptions(self):
        mgr, plugin, _, _, event_bus = self._make_loaded_plugin()
        assert len(event_bus._subscribers.get("test.event", [])) > 0

        await mgr.pause_plugin("test_plugin")
        assert len(event_bus._subscribers.get("test.event", [])) == 0

    @pytest.mark.asyncio
    async def test_pause_keeps_agents(self):
        mgr, plugin, agent_reg, _, _ = self._make_loaded_plugin()
        await mgr.pause_plugin("test_plugin")
        assert "test_agent" in agent_reg._agents

    @pytest.mark.asyncio
    async def test_pause_keeps_tools(self):
        mgr, plugin, _, tool_reg, _ = self._make_loaded_plugin()
        await mgr.pause_plugin("test_plugin")
        assert "test_tool" in tool_reg._tools

    @pytest.mark.asyncio
    async def test_resume_sets_state_to_ready(self):
        mgr, plugin, _, _, _ = self._make_loaded_plugin()
        await mgr.pause_plugin("test_plugin")
        result = await mgr.resume_plugin("test_plugin")
        assert result["status"] == "success"
        assert result["state"] == "ready"
        assert mgr.get_state("test_plugin") == PluginState.READY

    @pytest.mark.asyncio
    async def test_resume_reregisters_event_handlers(self):
        mgr, plugin, _, _, event_bus = self._make_loaded_plugin()
        await mgr.pause_plugin("test_plugin")
        assert len(event_bus._subscribers.get("test.event", [])) == 0

        await mgr.resume_plugin("test_plugin")
        # After resume, event handlers should be re-registered
        assert len(event_bus._subscribers.get("test.event", [])) > 0

    @pytest.mark.asyncio
    async def test_pause_nonexistent_plugin(self):
        mgr = PluginLifecycleManager()
        result = await mgr.pause_plugin("nonexistent")
        assert result["status"] == "error"

    @pytest.mark.asyncio
    async def test_resume_nonexistent_plugin(self):
        mgr = PluginLifecycleManager()
        result = await mgr.resume_plugin("nonexistent")
        assert result["status"] == "error"

    @pytest.mark.asyncio
    async def test_pause_plugin_not_ready(self):
        mgr = PluginLifecycleManager()
        plugin = _TestPlugin()
        mgr._plugins["test_plugin"] = plugin
        mgr._states["test_plugin"] = PluginState.PAUSED
        result = await mgr.pause_plugin("test_plugin")
        assert result["status"] == "error"
        assert "cannot pause" in result["error"]

    @pytest.mark.asyncio
    async def test_resume_plugin_not_paused(self):
        mgr = PluginLifecycleManager()
        plugin = _TestPlugin()
        mgr._plugins["test_plugin"] = plugin
        mgr._states["test_plugin"] = PluginState.READY
        result = await mgr.resume_plugin("test_plugin")
        assert result["status"] == "error"
        assert "cannot resume" in result["error"]


# ── 7. Registry unregister methods ────────────────────────────────────


class TestRegistryUnregister:
    """Test unregister methods on AgentRegistry, ToolRegistry, EventBus, ModeRegistry."""

    def test_agent_registry_unregister(self):
        registry = AgentRegistry()
        agent = _StubAgent("my_agent")
        registry.register(agent)
        assert "my_agent" in registry._agents
        registry.unregister("my_agent")
        assert "my_agent" not in registry._agents

    def test_agent_registry_unregister_not_found(self):
        registry = AgentRegistry()
        with pytest.raises(KeyError):
            registry.unregister("nonexistent")

    def test_tool_registry_unregister(self):
        registry = ToolRegistry()
        tool = _StubTool("my_tool")
        registry.register(tool)
        assert "my_tool" in registry._tools
        registry.unregister("my_tool")
        assert "my_tool" not in registry._tools

    def test_tool_registry_unregister_not_found(self):
        registry = ToolRegistry()
        with pytest.raises(KeyError):
            registry.unregister("nonexistent")

    def test_event_bus_unsubscribe(self):
        bus = EventBus()
        handler = lambda e: None
        bus.subscribe("test.event", handler)
        assert len(bus._subscribers["test.event"]) == 1
        bus.unsubscribe("test.event", handler)
        assert len(bus._subscribers["test.event"]) == 0

    def test_event_bus_unsubscribe_specific_handler(self):
        bus = EventBus()
        handler1 = lambda e: None
        handler2 = lambda e: None
        bus.subscribe("test.event", handler1)
        bus.subscribe("test.event", handler2)
        assert len(bus._subscribers["test.event"]) == 2
        bus.unsubscribe("test.event", handler1)
        assert len(bus._subscribers["test.event"]) == 1
        # The remaining handler should be handler2
        assert bus._subscribers["test.event"][0][0] is handler2

    def test_event_bus_unsubscribe_nonexistent_event(self):
        bus = EventBus()
        # Should not raise
        bus.unsubscribe("nonexistent.event", lambda e: None)

    def test_mode_registry_unregister(self):
        from flowforge.core.base_mode_executor import BaseModeExecutor
        from flowforge.core.task_context import TaskContext

        class _StubMode(BaseModeExecutor):
            mode_name = "stub_mode"
            async def _execute_core(self, ctx: TaskContext) -> dict:
                return {}

        registry = ModeRegistry()
        registry.register(_StubMode())
        assert "stub_mode" in registry._modes
        registry.unregister("stub_mode")
        assert "stub_mode" not in registry._modes

    def test_mode_registry_unregister_not_found(self):
        registry = ModeRegistry()
        with pytest.raises(Exception):  # ModeNotFoundError
            registry.unregister("nonexistent")


# ── 8. API Endpoint Tests ─────────────────────────────────────────────


class TestPluginManagementAPI:
    """Test plugin management API endpoints using FastAPI TestClient."""

    @pytest.fixture
    def client(self):
        from fastapi.testclient import TestClient
        from flowforge.app.main import app
        return TestClient(app)

    def test_list_plugins(self, client):
        response = client.get("/api/v1/plugin-management")
        assert response.status_code == 200
        data = response.json()
        assert "plugins" in data

    def test_get_nonexistent_plugin(self, client):
        response = client.get("/api/v1/plugin-management/nonexistent")
        assert response.status_code == 404

    def test_unload_nonexistent_plugin(self, client):
        response = client.delete("/api/v1/plugin-management/nonexistent")
        assert response.status_code == 500

    def test_reload_nonexistent_plugin(self, client):
        response = client.post("/api/v1/plugin-management/nonexistent/reload")
        assert response.status_code == 500

    def test_pause_nonexistent_plugin(self, client):
        response = client.post("/api/v1/plugin-management/nonexistent/pause")
        assert response.status_code == 500

    def test_resume_nonexistent_plugin(self, client):
        response = client.post("/api/v1/plugin-management/nonexistent/resume")
        assert response.status_code == 500

    def test_health_nonexistent_plugin(self, client):
        response = client.get("/api/v1/plugin-management/nonexistent/health")
        assert response.status_code == 404


class TestDomainPluginAPI:
    """Test domain plugin API endpoints (updated with pause/resume)."""

    @pytest.fixture
    def client(self):
        from fastapi.testclient import TestClient
        from flowforge.app.main import app
        return TestClient(app)

    def test_list_domain_plugins(self, client):
        response = client.get("/api/v1/domain-plugins")
        assert response.status_code == 200
        data = response.json()
        assert "plugins" in data

    def test_get_nonexistent_plugin(self, client):
        response = client.get("/api/v1/domain-plugins/nonexistent")
        assert response.status_code == 404

    def test_unload_nonexistent_plugin(self, client):
        response = client.delete("/api/v1/domain-plugins/nonexistent")
        assert response.status_code == 400

    def test_reload_nonexistent_plugin(self, client):
        response = client.post("/api/v1/domain-plugins/nonexistent/reload")
        assert response.status_code == 400

    def test_pause_nonexistent_plugin(self, client):
        response = client.post("/api/v1/domain-plugins/nonexistent/pause")
        assert response.status_code in (400, 500)

    def test_resume_nonexistent_plugin(self, client):
        response = client.post("/api/v1/domain-plugins/nonexistent/resume")
        assert response.status_code in (400, 500)

    def test_health_nonexistent_plugin(self, client):
        response = client.get("/api/v1/domain-plugins/nonexistent/health")
        assert response.status_code == 404
