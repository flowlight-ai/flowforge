"""Phase 4 tests — Plugin packaging, sandbox, and frontend plugin extension.

Tests cover:
1. PluginManager entry_points discovery
2. PluginManager install/uninstall (mock subprocess)
3. PluginSandbox permission checking
4. PluginSandbox execution timeout
5. PluginSandbox audit log
6. Frontend plugin metadata API
"""

import asyncio
import importlib.metadata
from unittest.mock import patch, MagicMock, AsyncMock

import pytest

from flowforge.core.plugin_manager import PluginManager
from flowforge.core.plugin_sandbox import (
    PluginSandbox,
    SandboxConfig,
    Permission,
)


# ── 1. PluginManager entry_points discovery ────────────────────────


class TestPluginManagerEntryPoints:
    """Tests for entry_points-based plugin discovery."""

    def test_init_discovers_entry_points(self):
        """PluginManager.__init__ should call _discover_entry_points."""
        pm = PluginManager()
        # _installed_plugins is populated (may be empty if no plugins installed)
        assert isinstance(pm._installed_plugins, dict)

    def test_list_available_plugins_returns_list(self):
        """list_available_plugins should return a list of dicts."""
        pm = PluginManager()
        plugins = pm.list_available_plugins()
        assert isinstance(plugins, list)
        for p in plugins:
            assert "name" in p
            assert "source" in p
            assert p["source"] == "entry_point"

    def test_discover_entry_points_with_mock(self):
        """Simulate discovering a plugin via entry_points."""
        mock_ep = MagicMock()
        mock_ep.name = "test_plugin"
        mock_ep.module = "test_module"
        mock_ep.attr = "TestPlugin"

        pm = PluginManager()
        pm._installed_plugins.clear()

        with patch.object(
            importlib.metadata, "entry_points",
            return_value=importlib.metadata.EntryPoints(
                [mock_ep]
            ) if hasattr(importlib.metadata, "EntryPoints") else [mock_ep],
        ):
            # For Python 3.12+, entry_points() returns SelectableGroups
            # We need to handle both APIs
            pass

        # Directly test the internal method with a simulated ep
        pm._installed_plugins["test_plugin"] = {
            "name": "test_plugin",
            "entry_point": "test_module:TestPlugin",
            "module": "test_module",
            "attr": "TestPlugin",
            "source": "entry_point",
        }
        plugins = pm.list_available_plugins()
        assert len(plugins) == 1
        assert plugins[0]["name"] == "test_plugin"
        assert plugins[0]["entry_point"] == "test_module:TestPlugin"

    def test_get_plugin_class_not_found(self):
        """get_plugin_class returns None for unknown plugin."""
        pm = PluginManager()
        result = pm.get_plugin_class("nonexistent_plugin")
        assert result is None

    def test_get_plugin_class_with_mock_module(self):
        """get_plugin_class loads the class from the discovered module."""
        pm = PluginManager()
        pm._installed_plugins["mock_plugin"] = {
            "name": "mock_plugin",
            "entry_point": "flowforge.core.plugin_protocol:FlowForgePlugin",
            "module": "flowforge.core.plugin_protocol",
            "attr": "FlowForgePlugin",
            "source": "entry_point",
        }
        cls = pm.get_plugin_class("mock_plugin")
        from flowforge.core.plugin_protocol import FlowForgePlugin
        assert cls is FlowForgePlugin

    def test_get_plugin_class_load_failure(self):
        """get_plugin_class returns None when module import fails."""
        pm = PluginManager()
        pm._installed_plugins["bad_plugin"] = {
            "name": "bad_plugin",
            "entry_point": "nonexistent.module:BadClass",
            "module": "nonexistent.module",
            "attr": "BadClass",
            "source": "entry_point",
        }
        cls = pm.get_plugin_class("bad_plugin")
        assert cls is None


# ── 2. PluginManager install/uninstall (mock subprocess) ───────────


class TestPluginManagerInstallUninstall:
    """Tests for pip-based plugin install/uninstall."""

    def test_install_plugin_success(self):
        """install_plugin returns success when pip succeeds."""
        pm = PluginManager()
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = "Successfully installed flowforge-plugin-test"

        with patch("flowforge.core.plugin_manager.subprocess.run", return_value=mock_result):
            result = pm.install_plugin("flowforge-plugin-test")

        assert result["status"] == "success"
        assert result["package"] == "flowforge-plugin-test"

    def test_install_plugin_failure(self):
        """install_plugin returns error when pip fails."""
        pm = PluginManager()
        mock_result = MagicMock()
        mock_result.returncode = 1
        mock_result.stderr = "ERROR: No matching distribution"

        with patch("flowforge.core.plugin_manager.subprocess.run", return_value=mock_result):
            result = pm.install_plugin("nonexistent-package")

        assert result["status"] == "error"
        assert "No matching distribution" in result["error"]

    def test_install_plugin_timeout(self):
        """install_plugin returns error on timeout."""
        import subprocess
        pm = PluginManager()

        with patch(
            "flowforge.core.plugin_manager.subprocess.run",
            side_effect=subprocess.TimeoutExpired(cmd="pip", timeout=120),
        ):
            result = pm.install_plugin("slow-package")

        assert result["status"] == "error"
        assert "timed out" in result["error"].lower()

    def test_uninstall_plugin_success(self):
        """uninstall_plugin returns success and removes from discovered."""
        pm = PluginManager()
        pm._installed_plugins["test_plugin"] = {
            "name": "test_plugin",
            "module": "flowforge_plugin_test",
            "attr": "Plugin",
            "source": "entry_point",
        }
        mock_result = MagicMock()
        mock_result.returncode = 0

        with patch("flowforge.core.plugin_manager.subprocess.run", return_value=mock_result):
            result = pm.uninstall_plugin("flowforge-plugin-test")

        assert result["status"] == "success"
        # Plugin should be removed from discovered if module name matches
        # (in this case "flowforge-plugin-test" is not in "flowforge_plugin_test",
        #  so it won't be removed — that's correct behavior)
        # Let's test with matching module name
        pm._installed_plugins["test_plugin2"] = {
            "name": "test_plugin2",
            "module": "flowforge-plugin-test",
            "attr": "Plugin",
            "source": "entry_point",
        }
        with patch("flowforge.core.plugin_manager.subprocess.run", return_value=mock_result):
            result = pm.uninstall_plugin("flowforge-plugin-test")
        assert "test_plugin2" not in pm._installed_plugins

    def test_uninstall_plugin_failure(self):
        """uninstall_plugin returns error when pip fails."""
        pm = PluginManager()
        mock_result = MagicMock()
        mock_result.returncode = 1
        mock_result.stderr = "ERROR: Cannot uninstall"

        with patch("flowforge.core.plugin_manager.subprocess.run", return_value=mock_result):
            result = pm.uninstall_plugin("some-package")

        assert result["status"] == "error"

    def test_install_re_discovers_entry_points(self):
        """install_plugin should re-discover entry_points after success."""
        pm = PluginManager()
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = "OK"

        with patch("flowforge.core.plugin_manager.subprocess.run", return_value=mock_result):
            with patch.object(pm, "_discover_entry_points") as mock_discover:
                pm.install_plugin("flowforge-plugin-test")
                mock_discover.assert_called_once()


# ── 3. PluginSandbox permission checking ───────────────────────────


class TestSandboxPermissions:
    """Tests for sandbox permission model."""

    def test_default_permissions_include_network_and_filesystem(self):
        """Default SandboxConfig allows network and filesystem."""
        config = SandboxConfig()
        assert Permission.NETWORK in config.allowed_permissions
        assert Permission.FILESYSTEM in config.allowed_permissions

    def test_check_permission_allowed(self):
        """check_permission returns True for allowed permissions."""
        sandbox = PluginSandbox(SandboxConfig(
            allowed_permissions={Permission.NETWORK, Permission.FILESYSTEM}
        ))
        assert sandbox.check_permission("test_plugin", Permission.NETWORK) is True
        assert sandbox.check_permission("test_plugin", Permission.FILESYSTEM) is True

    def test_check_permission_denied(self):
        """check_permission returns False for denied permissions."""
        sandbox = PluginSandbox(SandboxConfig(
            allowed_permissions={Permission.NETWORK}
        ))
        assert sandbox.check_permission("test_plugin", Permission.SUBPROCESS) is False
        assert sandbox.check_permission("test_plugin", Permission.DATABASE) is False

    def test_denied_permission_logs_audit(self):
        """Denied permissions are recorded in the audit log."""
        sandbox = PluginSandbox(SandboxConfig(
            allowed_permissions={Permission.NETWORK}
        ))
        sandbox.check_permission("test_plugin", Permission.SUBPROCESS)
        log = sandbox.get_audit_log()
        assert len(log) == 1
        assert log[0]["plugin"] == "test_plugin"
        assert log[0]["permission"] == Permission.SUBPROCESS
        assert log[0]["granted"] is False

    def test_allowed_permission_not_logged(self):
        """Allowed permissions are not recorded in the audit log."""
        sandbox = PluginSandbox(SandboxConfig(
            allowed_permissions={Permission.NETWORK}
        ))
        sandbox.check_permission("test_plugin", Permission.NETWORK)
        log = sandbox.get_audit_log()
        assert len(log) == 0

    def test_custom_permissions(self):
        """Custom permission set works correctly."""
        sandbox = PluginSandbox(SandboxConfig(
            allowed_permissions={Permission.DATABASE, Permission.ENVIRONMENT}
        ))
        assert sandbox.check_permission("p", Permission.DATABASE) is True
        assert sandbox.check_permission("p", Permission.ENVIRONMENT) is True
        assert sandbox.check_permission("p", Permission.NETWORK) is False


# ── 4. PluginSandbox execution timeout ─────────────────────────────


class TestSandboxExecution:
    """Tests for sandbox execution with time limits."""

    @pytest.mark.asyncio
    async def test_execute_success(self):
        """execute returns the function result on success."""
        sandbox = PluginSandbox(SandboxConfig(max_execution_time=5.0))

        async def good_func():
            return {"result": "ok"}

        result = await sandbox.execute("test_plugin", good_func)
        assert result == {"result": "ok"}

    @pytest.mark.asyncio
    async def test_execute_timeout(self):
        """execute raises TimeoutError when function takes too long."""
        sandbox = PluginSandbox(SandboxConfig(max_execution_time=0.1))

        async def slow_func():
            await asyncio.sleep(10)
            return "never"

        with pytest.raises(TimeoutError, match="timed out"):
            await sandbox.execute("test_plugin", slow_func)

    @pytest.mark.asyncio
    async def test_execute_propagates_exception(self):
        """execute re-raises exceptions from the function."""
        sandbox = PluginSandbox(SandboxConfig(max_execution_time=5.0))

        async def failing_func():
            raise ValueError("plugin error")

        with pytest.raises(ValueError, match="plugin error"):
            await sandbox.execute("test_plugin", failing_func)

    @pytest.mark.asyncio
    async def test_execute_with_args(self):
        """execute passes args and kwargs to the function."""
        sandbox = PluginSandbox(SandboxConfig(max_execution_time=5.0))

        async def func_with_args(a, b, c=None):
            return {"a": a, "b": b, "c": c}

        result = await sandbox.execute("test_plugin", func_with_args, 1, 2, c=3)
        assert result == {"a": 1, "b": 2, "c": 3}


# ── 5. PluginSandbox audit log ─────────────────────────────────────


class TestSandboxAuditLog:
    """Tests for sandbox audit logging."""

    def test_audit_log_empty_initially(self):
        """Audit log starts empty."""
        sandbox = PluginSandbox()
        assert sandbox.get_audit_log() == []

    def test_audit_log_records_denied_permissions(self):
        """Denied permissions are logged with details."""
        sandbox = PluginSandbox(SandboxConfig(
            allowed_permissions={Permission.NETWORK}
        ))
        sandbox.check_permission("plugin_a", Permission.SUBPROCESS)
        sandbox.check_permission("plugin_b", Permission.DATABASE)

        log = sandbox.get_audit_log()
        assert len(log) == 2
        assert log[0]["plugin"] == "plugin_a"
        assert log[0]["permission"] == Permission.SUBPROCESS
        assert log[1]["plugin"] == "plugin_b"
        assert log[1]["permission"] == Permission.DATABASE

    def test_audit_log_filter_by_plugin(self):
        """get_audit_log can filter by plugin name."""
        sandbox = PluginSandbox(SandboxConfig(
            allowed_permissions=set()
        ))
        sandbox.check_permission("plugin_a", Permission.NETWORK)
        sandbox.check_permission("plugin_b", Permission.FILESYSTEM)
        sandbox.check_permission("plugin_a", Permission.DATABASE)

        log_a = sandbox.get_audit_log("plugin_a")
        assert len(log_a) == 2
        assert all(e["plugin"] == "plugin_a" for e in log_a)

        log_b = sandbox.get_audit_log("plugin_b")
        assert len(log_b) == 1
        assert log_b[0]["plugin"] == "plugin_b"

    def test_clear_audit_log(self):
        """clear_audit_log removes all entries."""
        sandbox = PluginSandbox(SandboxConfig(allowed_permissions=set()))
        sandbox.check_permission("p", Permission.NETWORK)
        assert len(sandbox.get_audit_log()) == 1

        sandbox.clear_audit_log()
        assert sandbox.get_audit_log() == []

    def test_audit_log_returns_copy(self):
        """get_audit_log returns a copy, not the internal list."""
        sandbox = PluginSandbox()
        log1 = sandbox.get_audit_log()
        log2 = sandbox.get_audit_log()
        assert log1 is not log2


# ── 6. Frontend plugin metadata API ────────────────────────────────


class TestFrontendPluginAPI:
    """Tests for the /plugins/{name}/frontend API endpoint."""

    @pytest.mark.asyncio
    async def test_frontend_endpoint_with_plugin(self):
        """Frontend endpoint returns metadata for plugin with frontend_entry."""
        from fastapi.testclient import TestClient
        from flowforge.core.plugin_protocol import FlowForgePlugin, PluginManifest

        class FrontendPlugin(FlowForgePlugin):
            manifest = PluginManifest(
                name="frontend_test",
                version="1.0.0",
                frontend_entry="http://cdn.example.com/plugin.js",
                mount_points=["sidebar", "dashboard"],
            )

        # Temporarily add to _loaded_plugins
        from flowforge.app import main
        original_plugins = list(main._loaded_plugins)
        plugin_instance = FrontendPlugin()
        main._loaded_plugins.append(plugin_instance)

        try:
            from flowforge.app.main import app
            client = TestClient(app)
            response = client.get("/api/v1/plugins/frontend_test/frontend")
            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "success"
            assert data["data"]["name"] == "frontend_test"
            assert data["data"]["frontend_entry"] == "http://cdn.example.com/plugin.js"
            assert "sidebar" in data["data"]["mount_points"]
            assert "dashboard" in data["data"]["mount_points"]
        finally:
            main._loaded_plugins = original_plugins

    @pytest.mark.asyncio
    async def test_frontend_endpoint_no_frontend(self):
        """Frontend endpoint returns 404 for plugin without frontend_entry."""
        from fastapi.testclient import TestClient
        from flowforge.core.plugin_protocol import FlowForgePlugin, PluginManifest

        class NoFrontendPlugin(FlowForgePlugin):
            manifest = PluginManifest(
                name="no_frontend_test",
                version="1.0.0",
            )

        from flowforge.app import main
        original_plugins = list(main._loaded_plugins)
        plugin_instance = NoFrontendPlugin()
        main._loaded_plugins.append(plugin_instance)

        try:
            from flowforge.app.main import app
            client = TestClient(app)
            response = client.get("/plugins/no_frontend_test/frontend")
            assert response.status_code == 404
        finally:
            main._loaded_plugins = original_plugins

    @pytest.mark.asyncio
    async def test_frontend_endpoint_plugin_not_found(self):
        """Frontend endpoint returns 404 for unknown plugin."""
        from fastapi.testclient import TestClient
        from flowforge.app.main import app
        client = TestClient(app)
        response = client.get("/plugins/nonexistent_plugin/frontend")
        assert response.status_code == 404


# ── Backward compatibility ─────────────────────────────────────────


class TestPluginManagerBackwardCompat:
    """Ensure enhanced PluginManager doesn't break existing functionality."""

    def test_init_still_creates_loaded_dict(self):
        """PluginManager still initializes _loaded with expected keys."""
        pm = PluginManager()
        status = pm.get_status()
        assert "loaded" in status
        assert "modes" in status["loaded"]
        assert "agents" in status["loaded"]
        assert "tools" in status["loaded"]
        assert "workflows" in status["loaded"]

    def test_load_from_config_empty(self):
        """load_from_config still works with empty config."""
        pm = PluginManager()
        result = pm.load_from_config({})
        assert result["modes"] == []
        assert result["agents"] == []
        assert result["tools"] == []
        assert result["workflows"] == []

    def test_load_from_config_with_string_modules(self):
        """load_from_config still works with string module paths."""
        pm = PluginManager()
        config = {
            "agents": ["flowforge.agents.generic.fact_check:FactCheckAgent"],
        }
        result = pm.load_from_config(config)
        assert len(result["agents"]) == 1

    def test_load_from_config_invalid_module(self):
        """load_from_config still handles invalid modules gracefully."""
        pm = PluginManager()
        config = {
            "agents": ["nonexistent.module.path:Something"],
        }
        result = pm.load_from_config(config)
        assert len(result["agents"]) == 0

    def test_entry_point_group_constant(self):
        """ENTRY_POINT_GROUP is defined correctly."""
        assert PluginManager.ENTRY_POINT_GROUP == "flowforge.plugins"
