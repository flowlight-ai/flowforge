"""Tests for unified plugin protocol — Phase 1.

Validates:
1. PluginManifest unified fields (business + tool plugin fields)
2. PluginContext new service injection (memory_manager, model_service, plugin_registry)
3. FlowForgePlugin new hooks (on_error, on_config_reload, on_plugin_loaded, health_check)
4. EventBus request-response pattern
5. EventBus event filtering
6. Plugin on_plugin_loaded call chain after all plugins loaded
"""

import asyncio
import pytest

from flowforge.core.plugin_protocol import PluginManifest, PluginContext, FlowForgePlugin
from flowforge.events.event_bus import EventBus


# ── 1. PluginManifest unified fields ────────────────────────────────────


class TestPluginManifest:
    """Test that PluginManifest covers both business and tool plugin fields."""

    def test_default_values(self):
        m = PluginManifest()
        assert m.name == ""
        assert m.version == "0.1.0"
        assert m.description == ""
        assert m.author == ""
        assert m.license == ""
        assert m.homepage == ""
        assert m.dependencies == []
        assert m.optional_dependencies == []
        assert m.min_framework_version == ""
        assert m.max_framework_version == ""
        assert m.config_schema == {}
        assert m.priority == 100
        # Tool plugin fields
        assert m.transport == "local"
        assert m.entry_point == ""
        assert m.endpoint == ""
        assert m.api_key_env == ""
        assert m.safety_level == "normal"
        assert m.tags == []
        assert m.health_endpoint == ""
        assert m.health_interval == 300
        # Frontend extension
        assert m.frontend_entry == ""
        assert m.mount_points == []

    def test_business_plugin_manifest(self):
        m = PluginManifest(
            name="contentforge",
            version="0.1.0",
            description="AI-powered content creation",
            priority=50,
        )
        assert m.name == "contentforge"
        assert m.priority == 50
        assert m.transport == "local"

    def test_tool_plugin_manifest(self):
        m = PluginManifest(
            name="web_search",
            version="1.0.0",
            transport="mcp",
            entry_point="flowforge.tools.web_search:WebSearchTool",
            safety_level="readonly",
            tags=["search", "web"],
            health_endpoint="/health",
            health_interval=60,
        )
        assert m.name == "web_search"
        assert m.transport == "mcp"
        assert m.entry_point == "flowforge.tools.web_search:WebSearchTool"
        assert m.safety_level == "readonly"
        assert m.tags == ["search", "web"]
        assert m.health_endpoint == "/health"
        assert m.health_interval == 60

    def test_full_manifest(self):
        m = PluginManifest(
            name="full_plugin",
            version="2.0.0",
            description="Full test plugin",
            author="Test Author",
            license="MIT",
            homepage="https://example.com",
            dependencies=["dep_a", "dep_b"],
            optional_dependencies=["dep_c"],
            min_framework_version="1.0.0",
            max_framework_version="3.0.0",
            config_schema={"type": "object"},
            priority=10,
            transport="openapi",
            entry_point="mod:Cls",
            endpoint="https://api.example.com",
            api_key_env="MY_API_KEY",
            safety_level="dangerous",
            tags=["api", "external"],
            health_endpoint="/status",
            health_interval=120,
            frontend_entry="./dist/index.js",
            mount_points=["sidebar", "toolbar"],
        )
        assert m.author == "Test Author"
        assert m.license == "MIT"
        assert m.homepage == "https://example.com"
        assert m.dependencies == ["dep_a", "dep_b"]
        assert m.optional_dependencies == ["dep_c"]
        assert m.min_framework_version == "1.0.0"
        assert m.max_framework_version == "3.0.0"
        assert m.transport == "openapi"
        assert m.api_key_env == "MY_API_KEY"
        assert m.safety_level == "dangerous"
        assert m.frontend_entry == "./dist/index.js"
        assert m.mount_points == ["sidebar", "toolbar"]

    def test_backward_compatibility(self):
        """Old code using only name/version/description/priority still works."""
        m = PluginManifest(name="legacy", version="0.1.0", description="old style", priority=100)
        assert m.name == "legacy"
        assert m.dependencies == []
        assert m.tags == []


# ── 2. PluginContext new service injection ──────────────────────────────


class TestPluginContext:
    """Test PluginContext with new service injection."""

    def _make_context(self, **overrides):
        defaults = dict(
            agent_registry="agent_reg",
            tool_registry="tool_reg",
            mode_registry="mode_reg",
            event_bus="event_bus",
            scheduler="scheduler",
            app="app",
        )
        defaults.update(overrides)
        return PluginContext(**defaults)

    def test_new_services_default_none(self):
        ctx = self._make_context()
        assert ctx.memory_manager is None
        assert ctx.model_service is None
        assert ctx.plugin_registry is None

    def test_new_services_injected(self):
        ctx = self._make_context(
            memory_manager="mem_mgr",
            model_service="model_svc",
            plugin_registry="plugin_reg",
        )
        assert ctx.memory_manager == "mem_mgr"
        assert ctx.model_service == "model_svc"
        assert ctx.plugin_registry == "plugin_reg"

    def test_existing_properties_still_work(self):
        ctx = self._make_context()
        assert ctx.agent_registry == "agent_reg"
        assert ctx.tool_registry == "tool_reg"
        assert ctx.mode_registry == "mode_reg"
        assert ctx.event_bus == "event_bus"
        assert ctx.scheduler == "scheduler"
        assert ctx.app == "app"
        assert ctx.llm_client is None
        assert ctx.config is None
        assert ctx.plugin_config == {}

    def test_register_and_get_service(self):
        ctx = self._make_context()
        ctx.register_service("custom_svc", {"key": "value"})
        assert ctx.get_service("custom_svc") == {"key": "value"}

    def test_get_service_falls_back_to_builtin(self):
        ctx = self._make_context()
        assert ctx.get_service("agent_registry") == "agent_reg"

    def test_get_service_unknown_returns_none(self):
        ctx = self._make_context()
        assert ctx.get_service("nonexistent") is None

    def test_registered_service_takes_precedence(self):
        ctx = self._make_context()
        ctx.register_service("agent_registry", "custom_agent_reg")
        # Registered services are checked first
        assert ctx.get_service("agent_registry") == "custom_agent_reg"
        # But property still returns the original
        assert ctx.agent_registry == "agent_reg"


# ── 3. FlowForgePlugin new hooks ───────────────────────────────────────


class _TestPlugin(FlowForgePlugin):
    """Concrete plugin for testing."""

    manifest = PluginManifest(name="test_plugin", version="1.0.0")


class _TrackingPlugin(FlowForgePlugin):
    """Plugin that tracks hook invocations."""

    manifest = PluginManifest(name="tracker", version="1.0.0")

    def __init__(self):
        self.errors = []
        self.config_reloads = []
        self.loaded_plugins = []

    def on_error(self, context: dict, error: Exception) -> None:
        self.errors.append((context, error))

    def on_config_reload(self, config: dict) -> None:
        self.config_reloads.append(config)

    def on_plugin_loaded(self, plugin_name: str) -> None:
        self.loaded_plugins.append(plugin_name)

    def health_check(self) -> dict:
        return {
            "status": "healthy",
            "name": self.name,
            "version": self.version,
            "custom_field": "present",
        }


class TestFlowForgePluginHooks:
    """Test new lifecycle hooks on FlowForgePlugin."""

    def test_on_error_default_logs(self):
        """Default on_error logs but doesn't raise."""
        plugin = _TestPlugin()
        # Should not raise
        plugin.on_error({}, RuntimeError("test error"))

    def test_on_error_override(self):
        plugin = _TrackingPlugin()
        err = ValueError("custom error")
        plugin.on_error({"task": "t1"}, err)
        assert len(plugin.errors) == 1
        assert plugin.errors[0] == ({"task": "t1"}, err)

    def test_on_config_reload_default_noop(self):
        """Default on_config_reload is a no-op."""
        plugin = _TestPlugin()
        plugin.on_config_reload({"key": "value"})  # Should not raise

    def test_on_config_reload_override(self):
        plugin = _TrackingPlugin()
        plugin.on_config_reload({"new_key": "new_val"})
        assert len(plugin.config_reloads) == 1
        assert plugin.config_reloads[0] == {"new_key": "new_val"}

    def test_on_plugin_loaded_default_noop(self):
        plugin = _TestPlugin()
        plugin.on_plugin_loaded("other_plugin")  # Should not raise

    def test_on_plugin_loaded_override(self):
        plugin = _TrackingPlugin()
        plugin.on_plugin_loaded("contentforge")
        plugin.on_plugin_loaded("devforge")
        assert plugin.loaded_plugins == ["contentforge", "devforge"]

    def test_health_check_default(self):
        plugin = _TestPlugin()
        result = plugin.health_check()
        assert result["status"] == "healthy"
        assert result["name"] == "test_plugin"
        assert result["version"] == "1.0.0"

    def test_health_check_override(self):
        plugin = _TrackingPlugin()
        result = plugin.health_check()
        assert result["status"] == "healthy"
        assert result["custom_field"] == "present"

    def test_name_and_version_from_manifest(self):
        plugin = _TestPlugin()
        assert plugin.name == "test_plugin"
        assert plugin.version == "1.0.0"


# ── 4. EventBus request-response pattern ───────────────────────────────


class TestEventBusRequestResponse:
    """Test the request-response pattern on EventBus."""

    @pytest.mark.asyncio
    async def test_request_response_sync_handler(self):
        bus = EventBus()
        bus.respond("config.get", lambda e: {"theme": "dark"})

        result = await bus.request("config.get", {"key": "theme"}, timeout=5.0)
        assert result == {"theme": "dark"}

    @pytest.mark.asyncio
    async def test_request_response_async_handler(self):
        bus = EventBus()

        async def handler(event):
            return {"data": event["payload"]["query"]}

        bus.respond("search.query", handler)
        result = await bus.request("search.query", {"query": "test"}, timeout=5.0)
        assert result == {"data": "test"}

    @pytest.mark.asyncio
    async def test_request_timeout(self):
        bus = EventBus()
        # No handler registered — should timeout
        with pytest.raises(asyncio.TimeoutError):
            await bus.request("unhandled.event", {}, timeout=0.1)

    @pytest.mark.asyncio
    async def test_request_with_task_id(self):
        bus = EventBus()
        received_events = []

        def handler(event):
            received_events.append(event)
            return "ok"

        bus.respond("task.check", handler)
        result = await bus.request("task.check", {"status": "running"}, task_id="t-123", timeout=5.0)
        assert result == "ok"
        assert received_events[0]["task_id"] == "t-123"


# ── 5. EventBus event filtering ─────────────────────────────────────────


class TestEventBusFiltering:
    """Test event filtering on EventBus."""

    def test_filter_passes(self):
        bus = EventBus()
        received = []
        bus.subscribe(
            "task.completed",
            lambda e: received.append(e),
            filter=lambda e: e["payload"].get("success") is True,
        )
        bus.emit("t1", "task.completed", {"success": True, "result": "ok"})
        assert len(received) == 1
        assert received[0]["payload"]["result"] == "ok"

    def test_filter_blocks(self):
        bus = EventBus()
        received = []
        bus.subscribe(
            "task.completed",
            lambda e: received.append(e),
            filter=lambda e: e["payload"].get("success") is True,
        )
        bus.emit("t1", "task.completed", {"success": False, "error": "fail"})
        assert len(received) == 0

    def test_no_filter_receives_all(self):
        bus = EventBus()
        received = []
        bus.subscribe("task.completed", lambda e: received.append(e))
        bus.emit("t1", "task.completed", {"success": True})
        bus.emit("t2", "task.completed", {"success": False})
        assert len(received) == 2

    def test_multiple_filters(self):
        bus = EventBus()
        success_events = []
        failure_events = []
        bus.subscribe(
            "task.completed",
            lambda e: success_events.append(e),
            filter=lambda e: e["payload"].get("success") is True,
        )
        bus.subscribe(
            "task.completed",
            lambda e: failure_events.append(e),
            filter=lambda e: e["payload"].get("success") is False,
        )
        bus.emit("t1", "task.completed", {"success": True})
        bus.emit("t2", "task.completed", {"success": False})
        assert len(success_events) == 1
        assert len(failure_events) == 1

    def test_wildcard_with_filter(self):
        bus = EventBus()
        received = []
        bus.subscribe(
            "*",
            lambda e: received.append(e),
            filter=lambda e: e["type"].startswith("task."),
        )
        bus.emit("t1", "task.completed", {"ok": True})
        bus.emit("t2", "tool.start", {"tool": "search"})
        assert len(received) == 1
        assert received[0]["type"] == "task.completed"


# ── 6. Plugin on_plugin_loaded call chain ──────────────────────────────


class TestPluginLoadedCallChain:
    """Test that on_plugin_loaded is called for each pair of loaded plugins."""

    def test_cross_plugin_notification(self):
        p1 = _TrackingPlugin()
        p1.manifest = PluginManifest(name="alpha", version="1.0.0")
        p2 = _TrackingPlugin()
        p2.manifest = PluginManifest(name="beta", version="1.0.0")
        p3 = _TrackingPlugin()
        p3.manifest = PluginManifest(name="gamma", version="1.0.0")

        loaded = [p1, p2, p3]
        # Simulate the call chain from main.py
        for plugin in loaded:
            for other_plugin in loaded:
                if other_plugin.name != plugin.name:
                    plugin.on_plugin_loaded(other_plugin.name)

        assert set(p1.loaded_plugins) == {"beta", "gamma"}
        assert set(p2.loaded_plugins) == {"alpha", "gamma"}
        assert set(p3.loaded_plugins) == {"alpha", "beta"}

    def test_single_plugin_no_self_notification(self):
        p = _TrackingPlugin()
        p.manifest = PluginManifest(name="solo", version="1.0.0")
        loaded = [p]
        for plugin in loaded:
            for other_plugin in loaded:
                if other_plugin.name != plugin.name:
                    plugin.on_plugin_loaded(other_plugin.name)
        assert p.loaded_plugins == []


# ── Backward compatibility: existing EventBus API ───────────────────────


class TestEventBusBackwardCompat:
    """Ensure existing subscribe/emit API still works after enhancement."""

    def test_subscribe_emit_basic(self):
        bus = EventBus()
        received = []
        bus.subscribe("test.event", lambda e: received.append(e))
        bus.emit("t1", "test.event", {"data": "hello"})
        assert len(received) == 1
        assert received[0]["payload"]["data"] == "hello"

    def test_wildcard(self):
        bus = EventBus()
        received = []
        bus.subscribe("*", lambda e: received.append(e))
        bus.emit("t1", "any.event", {})
        assert len(received) == 1

    @pytest.mark.asyncio
    async def test_async_callback(self):
        bus = EventBus()
        received = []
        async def callback(event):
            received.append(event)
        bus.subscribe("async.event", callback)
        bus.emit("t1", "async.event", {"data": "async"})
        await asyncio.sleep(0.1)
        assert len(received) == 1
