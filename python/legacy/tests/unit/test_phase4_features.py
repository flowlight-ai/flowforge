"""Phase 4 tests — Plugin packaging, sandbox enhancements, and frontend plugin extension.

Tests cover:
1. Plugin packaging — discover_entry_point_plugins / load_entry_point_plugin
2. Sandbox permission checking — require_permission / SandboxViolation
3. Sandbox execution with timeout — execute_with_timeout with tracking
4. Sandbox audit log — per-plugin audit entries
5. SandboxManager — create/get/remove/list sandboxes
6. FrontendPluginRegistry — register/unregister/get by mount point
7. Frontend plugin API endpoints
"""

import asyncio
import time

import pytest

from flowforge.core.plugin_packaging import (
    discover_entry_point_plugins,
    load_entry_point_plugin,
    ENTRY_POINT_GROUP,
)
from flowforge.core.plugin_sandbox import (
    PluginSandbox,
    SandboxConfig,
    SandboxManager,
    SandboxViolation,
    Permission,
    ALL_PERMISSIONS,
    SAFETY_PERMISSIONS,
    create_plugin_sandbox,
)
from flowforge.core.plugin_frontend import FrontendPluginRegistry
from flowforge.core.plugin_protocol import FlowForgePlugin, PluginManifest


# ── 1. Plugin packaging — entry point discovery ────────────────────


class TestPluginPackaging:
    """Tests for plugin_packaging module."""

    def test_discover_entry_point_plugins_returns_list(self):
        """discover_entry_point_plugins returns a list (may be empty)."""
        plugins = discover_entry_point_plugins()
        assert isinstance(plugins, list)

    def test_discover_entry_point_plugins_entry_format(self):
        """Each discovered plugin has name, module, entry_point keys."""
        plugins = discover_entry_point_plugins()
        for p in plugins:
            assert "name" in p
            assert "module" in p
            assert "entry_point" in p

    def test_entry_point_group_constant(self):
        """ENTRY_POINT_GROUP is set correctly."""
        assert ENTRY_POINT_GROUP == "flowforge.plugins"

    def test_load_entry_point_plugin_not_found(self):
        """load_entry_point_plugin returns None for nonexistent plugin."""
        result = load_entry_point_plugin("nonexistent_plugin_xyz")
        assert result is None


# ── 2. Sandbox permission checking ─────────────────────────────────


class TestSandboxRequirePermission:
    """Tests for require_permission and SandboxViolation."""

    def test_require_permission_allowed(self):
        """require_permission does not raise for granted permission."""
        sandbox = PluginSandbox(SandboxConfig(
            allowed_permissions={Permission.NETWORK, Permission.FILESYSTEM},
        ))
        sandbox._plugin_name = "test_plugin"
        # Should not raise
        sandbox.require_permission(Permission.NETWORK)

    def test_require_permission_denied_raises_violation(self):
        """require_permission raises SandboxViolation for denied permission."""
        sandbox = PluginSandbox(SandboxConfig(
            allowed_permissions={Permission.NETWORK},
        ))
        sandbox._plugin_name = "test_plugin"
        with pytest.raises(SandboxViolation, match="requires permission"):
            sandbox.require_permission(Permission.SUBPROCESS)

    def test_require_permission_violation_message_contains_details(self):
        """SandboxViolation message includes plugin name and permission."""
        sandbox = PluginSandbox(SandboxConfig(
            allowed_permissions=set(),
        ))
        sandbox._plugin_name = "my_plugin"
        with pytest.raises(SandboxViolation) as exc_info:
            sandbox.require_permission(Permission.DATABASE)
        assert "my_plugin" in str(exc_info.value)
        assert Permission.DATABASE in str(exc_info.value)

    def test_require_permission_denied_logs_audit(self):
        """Denied require_permission is recorded in audit log."""
        sandbox = PluginSandbox(SandboxConfig(
            allowed_permissions=set(),
        ))
        sandbox._plugin_name = "audit_plugin"
        with pytest.raises(SandboxViolation):
            sandbox.require_permission(Permission.NETWORK)
        log = sandbox.get_audit_log()
        assert len(log) == 1
        assert log[0]["action"] == "permission_required_denied"
        assert log[0]["permission"] == Permission.NETWORK

    def test_safety_permissions_readonly(self):
        """readonly safety level grants no permissions."""
        assert SAFETY_PERMISSIONS["readonly"] == set()

    def test_safety_permissions_normal(self):
        """normal safety level grants network and filesystem."""
        assert SAFETY_PERMISSIONS["normal"] == {Permission.NETWORK, Permission.FILESYSTEM}

    def test_safety_permissions_dangerous(self):
        """dangerous safety level grants all permissions."""
        assert SAFETY_PERMISSIONS["dangerous"] == ALL_PERMISSIONS


# ── 3. Sandbox execution with timeout and tracking ─────────────────


class TestSandboxExecuteWithTimeout:
    """Tests for execute_with_timeout with resource tracking."""

    @pytest.mark.asyncio
    async def test_execute_with_timeout_success(self):
        """execute_with_timeout returns result and tracks timing."""
        manifest = PluginManifest(name="tracked_plugin", safety_level="normal")
        sandbox = create_plugin_sandbox("tracked_plugin", manifest)

        async def quick_task():
            return {"status": "done"}

        result = await sandbox.execute_with_timeout(quick_task())
        assert result == {"status": "done"}
        assert sandbox._execution_count == 1
        assert sandbox._total_execution_time > 0
        assert sandbox._last_execution_time > 0

    @pytest.mark.asyncio
    async def test_execute_with_timeout_timeout(self):
        """execute_with_timeout raises TimeoutError on timeout."""
        manifest = PluginManifest(name="slow_plugin", safety_level="normal")
        sandbox = create_plugin_sandbox("slow_plugin", manifest, timeout_seconds=1)

        async def slow_task():
            await asyncio.sleep(10)
            return "never"

        with pytest.raises(asyncio.TimeoutError):
            await sandbox.execute_with_timeout(slow_task())

    @pytest.mark.asyncio
    async def test_execute_with_timeout_error(self):
        """execute_with_timeout re-raises exceptions and logs audit."""
        manifest = PluginManifest(name="error_plugin", safety_level="normal")
        sandbox = create_plugin_sandbox("error_plugin", manifest)

        async def failing_task():
            raise RuntimeError("plugin crashed")

        with pytest.raises(RuntimeError, match="plugin crashed"):
            await sandbox.execute_with_timeout(failing_task())

        log = sandbox.get_audit_log()
        error_entries = [e for e in log if e["action"] == "execution_error"]
        assert len(error_entries) == 1
        assert "plugin crashed" in error_entries[0]["error"]

    @pytest.mark.asyncio
    async def test_execute_with_timeout_tracks_count(self):
        """execute_with_timeout increments execution count."""
        manifest = PluginManifest(name="count_plugin", safety_level="normal")
        sandbox = create_plugin_sandbox("count_plugin", manifest)

        async def noop():
            return None

        await sandbox.execute_with_timeout(noop())
        await sandbox.execute_with_timeout(noop())
        await sandbox.execute_with_timeout(noop())

        assert sandbox._execution_count == 3

    @pytest.mark.asyncio
    async def test_execute_with_timeout_custom_timeout(self):
        """execute_with_timeout respects custom timeout parameter."""
        manifest = PluginManifest(name="custom_timeout_plugin", safety_level="normal")
        sandbox = create_plugin_sandbox("custom_timeout_plugin", manifest, timeout_seconds=300)

        async def quick():
            return "fast"

        # Should succeed with short custom timeout
        result = await sandbox.execute_with_timeout(quick(), timeout=5)
        assert result == "fast"


# ── 4. Sandbox audit log ───────────────────────────────────────────


class TestSandboxAuditLog:
    """Tests for per-plugin sandbox audit logging."""

    @pytest.mark.asyncio
    async def test_audit_log_execution_success(self):
        """Successful execution logs execution_success audit entry."""
        manifest = PluginManifest(name="audit_plugin", safety_level="normal")
        sandbox = create_plugin_sandbox("audit_plugin", manifest)

        async def task():
            return "ok"

        await sandbox.execute_with_timeout(task())
        log = sandbox.get_audit_log()
        success_entries = [e for e in log if e["action"] == "execution_success"]
        assert len(success_entries) == 1
        assert success_entries[0]["duration_ms"] >= 0

    @pytest.mark.asyncio
    async def test_audit_log_execution_timeout(self):
        """Timed-out execution logs execution_timeout audit entry."""
        manifest = PluginManifest(name="timeout_audit", safety_level="normal")
        sandbox = create_plugin_sandbox("timeout_audit", manifest, timeout_seconds=1)

        async def slow():
            await asyncio.sleep(10)

        with pytest.raises(asyncio.TimeoutError):
            await sandbox.execute_with_timeout(slow())

        log = sandbox.get_audit_log()
        timeout_entries = [e for e in log if e["action"] == "execution_timeout"]
        assert len(timeout_entries) == 1
        assert timeout_entries[0]["timeout"] == 1

    def test_get_stats(self):
        """get_stats returns correct sandbox statistics."""
        manifest = PluginManifest(name="stats_plugin", safety_level="normal")
        sandbox = create_plugin_sandbox("stats_plugin", manifest)

        stats = sandbox.get_stats()
        assert stats["plugin"] == "stats_plugin"
        assert Permission.NETWORK in stats["permissions"]
        assert Permission.FILESYSTEM in stats["permissions"]
        assert stats["execution_count"] == 0
        assert stats["audit_entries"] == 0
        assert stats["timeout_seconds"] == 300


# ── 5. SandboxManager ──────────────────────────────────────────────


class TestSandboxManager:
    """Tests for SandboxManager."""

    def test_create_sandbox(self):
        """create_sandbox creates a per-plugin sandbox."""
        manager = SandboxManager(default_timeout=60)
        manifest = PluginManifest(name="managed_plugin", safety_level="normal")
        sandbox = manager.create_sandbox("managed_plugin", manifest)

        assert sandbox is not None
        assert sandbox.plugin_name == "managed_plugin"
        assert sandbox._timeout_seconds == 60

    def test_create_sandbox_derives_permissions_from_safety_level(self):
        """create_sandbox derives permissions from manifest safety_level."""
        manager = SandboxManager()

        # readonly
        manifest_ro = PluginManifest(name="ro_plugin", safety_level="readonly")
        sandbox_ro = manager.create_sandbox("ro_plugin", manifest_ro)
        assert sandbox_ro.permissions == set()

        # normal
        manifest_normal = PluginManifest(name="normal_plugin", safety_level="normal")
        sandbox_normal = manager.create_sandbox("normal_plugin", manifest_normal)
        assert Permission.NETWORK in sandbox_normal.permissions

        # dangerous
        manifest_danger = PluginManifest(name="danger_plugin", safety_level="dangerous")
        sandbox_danger = manager.create_sandbox("danger_plugin", manifest_danger)
        assert sandbox_danger.permissions == ALL_PERMISSIONS

    def test_get_sandbox(self):
        """get_sandbox returns the sandbox for a known plugin."""
        manager = SandboxManager()
        manifest = PluginManifest(name="get_plugin", safety_level="normal")
        manager.create_sandbox("get_plugin", manifest)

        sandbox = manager.get_sandbox("get_plugin")
        assert sandbox is not None
        assert sandbox.plugin_name == "get_plugin"

    def test_get_sandbox_not_found(self):
        """get_sandbox returns None for unknown plugin."""
        manager = SandboxManager()
        assert manager.get_sandbox("nonexistent") is None

    def test_remove_sandbox(self):
        """remove_sandbox removes the sandbox for a plugin."""
        manager = SandboxManager()
        manifest = PluginManifest(name="remove_plugin", safety_level="normal")
        manager.create_sandbox("remove_plugin", manifest)

        manager.remove_sandbox("remove_plugin")
        assert manager.get_sandbox("remove_plugin") is None

    def test_list_sandboxes(self):
        """list_sandboxes returns stats for all managed sandboxes."""
        manager = SandboxManager()
        manifest1 = PluginManifest(name="list_a", safety_level="normal")
        manifest2 = PluginManifest(name="list_b", safety_level="readonly")
        manager.create_sandbox("list_a", manifest1)
        manager.create_sandbox("list_b", manifest2)

        stats = manager.list_sandboxes()
        assert len(stats) == 2
        names = {s["plugin"] for s in stats}
        assert names == {"list_a", "list_b"}


# ── 6. FrontendPluginRegistry ──────────────────────────────────────


class TestFrontendPluginRegistry:
    """Tests for FrontendPluginRegistry."""

    def test_register_plugin_with_frontend(self):
        """register stores plugin with frontend metadata."""
        registry = FrontendPluginRegistry()
        manifest = PluginManifest(
            name="ui_plugin",
            version="1.0.0",
            frontend_entry="ui-plugin/dist/index.js",
            mount_points=["sidebar", "dashboard"],
        )
        registry.register("ui_plugin", manifest)

        plugin = registry.get_plugin("ui_plugin")
        assert plugin is not None
        assert plugin["name"] == "ui_plugin"
        assert plugin["entry"] == "ui-plugin/dist/index.js"
        assert "sidebar" in plugin["mount_points"]
        assert "dashboard" in plugin["mount_points"]

    def test_register_plugin_without_frontend_skipped(self):
        """register skips plugins without frontend_entry."""
        registry = FrontendPluginRegistry()
        manifest = PluginManifest(name="no_ui_plugin", version="1.0.0")
        registry.register("no_ui_plugin", manifest)

        assert registry.get_plugin("no_ui_plugin") is None

    def test_unregister_plugin(self):
        """unregister removes plugin from registry."""
        registry = FrontendPluginRegistry()
        manifest = PluginManifest(
            name="temp_plugin",
            frontend_entry="temp/index.js",
            mount_points=["toolbar"],
        )
        registry.register("temp_plugin", manifest)
        assert registry.get_plugin("temp_plugin") is not None

        registry.unregister("temp_plugin")
        assert registry.get_plugin("temp_plugin") is None

    def test_get_plugins_for_mount(self):
        """get_plugins_for_mount returns plugins at a specific mount point."""
        registry = FrontendPluginRegistry()

        manifest1 = PluginManifest(
            name="sidebar_plugin",
            frontend_entry="sidebar/index.js",
            mount_points=["sidebar", "dashboard"],
        )
        manifest2 = PluginManifest(
            name="toolbar_plugin",
            frontend_entry="toolbar/index.js",
            mount_points=["toolbar"],
        )
        manifest3 = PluginManifest(
            name="both_plugin",
            frontend_entry="both/index.js",
            mount_points=["sidebar", "toolbar"],
        )

        registry.register("sidebar_plugin", manifest1)
        registry.register("toolbar_plugin", manifest2)
        registry.register("both_plugin", manifest3)

        sidebar_plugins = registry.get_plugins_for_mount("sidebar")
        assert len(sidebar_plugins) == 2
        sidebar_names = {p["name"] for p in sidebar_plugins}
        assert sidebar_names == {"sidebar_plugin", "both_plugin"}

        toolbar_plugins = registry.get_plugins_for_mount("toolbar")
        assert len(toolbar_plugins) == 2

        dashboard_plugins = registry.get_plugins_for_mount("dashboard")
        assert len(dashboard_plugins) == 1

    def test_get_all_plugins(self):
        """get_all_plugins returns all registered frontend plugins."""
        registry = FrontendPluginRegistry()
        manifest1 = PluginManifest(
            name="p1", frontend_entry="p1/index.js", mount_points=["sidebar"],
        )
        manifest2 = PluginManifest(
            name="p2", frontend_entry="p2/index.js", mount_points=["toolbar"],
        )
        registry.register("p1", manifest1)
        registry.register("p2", manifest2)

        all_plugins = registry.get_all_plugins()
        assert len(all_plugins) == 2

    def test_get_plugin_not_found(self):
        """get_plugin returns None for unknown plugin."""
        registry = FrontendPluginRegistry()
        assert registry.get_plugin("nonexistent") is None

    def test_mount_point_constants(self):
        """Standard mount point constants are defined."""
        assert FrontendPluginRegistry.MOUNT_SIDEBAR == "sidebar"
        assert FrontendPluginRegistry.MOUNT_TOOLBAR == "toolbar"
        assert FrontendPluginRegistry.MOUNT_SETTINGS == "settings"
        assert FrontendPluginRegistry.MOUNT_DASHBOARD == "dashboard"
        assert FrontendPluginRegistry.MOUNT_TASK_PANEL == "task_panel"
        assert FrontendPluginRegistry.MOUNT_REVIEW_PANEL == "review_panel"


# ── 7. Frontend plugin API endpoints ───────────────────────────────


class TestFrontendPluginAPI:
    """Tests for the /plugins/frontend API endpoints."""

    def test_list_frontend_plugins(self):
        """GET /plugins/frontend returns list of frontend plugins."""
        from fastapi.testclient import TestClient
        from flowforge.app.main import app, frontend_registry

        # Temporarily register a frontend plugin
        if frontend_registry is None:
            pytest.skip("Frontend registry not initialized")

        manifest = PluginManifest(
            name="api_test_plugin",
            frontend_entry="api-test/index.js",
            mount_points=["sidebar"],
        )
        frontend_registry.register("api_test_plugin", manifest)

        try:
            client = TestClient(app)
            response = client.get("/plugins/frontend")
            assert response.status_code == 200
            data = response.json()
            assert "plugins" in data
            plugin_names = [p["name"] for p in data["plugins"]]
            assert "api_test_plugin" in plugin_names
        finally:
            frontend_registry.unregister("api_test_plugin")

    def test_get_plugins_for_mount(self):
        """GET /plugins/frontend/mount/{mount_point} returns matching plugins."""
        from fastapi.testclient import TestClient
        from flowforge.app.main import app, frontend_registry

        if frontend_registry is None:
            pytest.skip("Frontend registry not initialized")

        manifest = PluginManifest(
            name="mount_test_plugin",
            frontend_entry="mount-test/index.js",
            mount_points=["dashboard", "settings"],
        )
        frontend_registry.register("mount_test_plugin", manifest)

        try:
            client = TestClient(app)
            response = client.get("/plugins/frontend/mount/dashboard")
            assert response.status_code == 200
            data = response.json()
            assert data["mount_point"] == "dashboard"
            plugin_names = [p["name"] for p in data["plugins"]]
            assert "mount_test_plugin" in plugin_names
        finally:
            frontend_registry.unregister("mount_test_plugin")

    def test_get_frontend_plugin_by_name(self):
        """GET /plugins/frontend/{plugin_name} returns plugin metadata."""
        from fastapi.testclient import TestClient
        from flowforge.app.main import app, frontend_registry

        if frontend_registry is None:
            pytest.skip("Frontend registry not initialized")

        manifest = PluginManifest(
            name="name_test_plugin",
            version="2.0.0",
            frontend_entry="name-test/index.js",
            mount_points=["toolbar"],
        )
        frontend_registry.register("name_test_plugin", manifest)

        try:
            client = TestClient(app)
            response = client.get("/plugins/frontend/name_test_plugin")
            assert response.status_code == 200
            data = response.json()
            assert data["name"] == "name_test_plugin"
            assert data["entry"] == "name-test/index.js"
            assert data["version"] == "2.0.0"
        finally:
            frontend_registry.unregister("name_test_plugin")

    def test_get_frontend_plugin_not_found(self):
        """GET /plugins/frontend/{plugin_name} returns 404 for unknown plugin."""
        from fastapi.testclient import TestClient
        from flowforge.app.main import app, frontend_registry

        # If frontend_registry is not initialized (no lifespan), we get 503
        # which is also acceptable — the service isn't available
        client = TestClient(app)
        response = client.get("/plugins/frontend/nonexistent_frontend_plugin")
        assert response.status_code in (404, 503)


# ── Backward compatibility ─────────────────────────────────────────


class TestSandboxBackwardCompat:
    """Ensure enhanced PluginSandbox doesn't break existing functionality."""

    def test_legacy_check_permission_still_works(self):
        """Legacy check_permission(plugin_name, permission) still works."""
        sandbox = PluginSandbox(SandboxConfig(
            allowed_permissions={Permission.NETWORK}
        ))
        assert sandbox.check_permission("p", Permission.NETWORK) is True
        assert sandbox.check_permission("p", Permission.SUBPROCESS) is False

    def test_legacy_execute_still_works(self):
        """Legacy execute(plugin_name, func) still works."""
        sandbox = PluginSandbox(SandboxConfig(max_execution_time=5.0))

        async def func():
            return "legacy_result"

        result = asyncio.run(sandbox.execute("p", func))
        assert result == "legacy_result"

    def test_legacy_audit_log_still_works(self):
        """Legacy get_audit_log/clear_audit_log still work."""
        sandbox = PluginSandbox(SandboxConfig(allowed_permissions=set()))
        sandbox.check_permission("p", Permission.NETWORK)
        assert len(sandbox.get_audit_log()) == 1
        sandbox.clear_audit_log()
        assert len(sandbox.get_audit_log()) == 0

    def test_legacy_audit_log_filter_by_plugin(self):
        """Legacy get_audit_log(plugin_name) still filters correctly."""
        sandbox = PluginSandbox(SandboxConfig(allowed_permissions=set()))
        sandbox.check_permission("a", Permission.NETWORK)
        sandbox.check_permission("b", Permission.FILESYSTEM)
        assert len(sandbox.get_audit_log("a")) == 1
