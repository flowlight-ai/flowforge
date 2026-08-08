"""Tests for FlowForge Phase 2 features.

Validates:
1. Config Schema validation — validate_plugin_config / fill_config_defaults
2. Dependency resolution — _topological_sort_plugins / missing dependency detection
3. Version compatibility check — min/max_framework_version
4. MCP Server — list_tools / call_tool / safety_level filtering
"""

import asyncio
import pytest

from flowforge.core.plugin_protocol import (
    PluginManifest,
    FlowForgePlugin,
    validate_plugin_config,
    fill_config_defaults,
)


# ── 1. Config Schema Validation ────────────────────────────────────────


class TestValidatePluginConfig:
    """Test validate_plugin_config against declared schema."""

    def test_valid_config(self):
        schema = {
            "endpoint": {"type": "string", "required": True},
            "timeout": {"type": "integer", "required": False, "default": 30},
        }
        config = {"endpoint": "http://localhost:8080", "timeout": 60}
        is_valid, errors = validate_plugin_config(config, schema)
        assert is_valid
        assert errors == []

    def test_missing_required_field_no_default(self):
        schema = {
            "endpoint": {"type": "string", "required": True},
        }
        config = {}
        is_valid, errors = validate_plugin_config(config, schema)
        assert not is_valid
        assert any("Missing required field: endpoint" in e for e in errors)

    def test_missing_required_field_with_default(self):
        schema = {
            "timeout": {"type": "integer", "required": True, "default": 30},
        }
        config = {}
        is_valid, errors = validate_plugin_config(config, schema)
        # Default should be applied, so no error
        assert is_valid
        assert config["timeout"] == 30

    def test_type_mismatch(self):
        schema = {
            "timeout": {"type": "integer", "required": True},
        }
        config = {"timeout": "thirty"}
        is_valid, errors = validate_plugin_config(config, schema)
        assert not is_valid
        assert any("expected type integer" in e for e in errors)

    def test_optional_field_missing(self):
        schema = {
            "debug": {"type": "boolean", "required": False, "default": False},
        }
        config = {}
        is_valid, errors = validate_plugin_config(config, schema)
        assert is_valid
        # Default should be applied
        assert config["debug"] is False

    def test_number_type_accepts_int_and_float(self):
        schema = {
            "threshold": {"type": "number", "required": True},
        }
        config_int = {"threshold": 5}
        is_valid_int, _ = validate_plugin_config(config_int, schema)
        assert is_valid_int

        config_float = {"threshold": 5.5}
        is_valid_float, _ = validate_plugin_config(config_float, schema)
        assert is_valid_float

    def test_array_type(self):
        schema = {
            "tags": {"type": "array", "required": True},
        }
        config = {"tags": ["search", "web"]}
        is_valid, errors = validate_plugin_config(config, schema)
        assert is_valid

    def test_object_type(self):
        schema = {
            "auth": {"type": "object", "required": True},
        }
        config = {"auth": {"type": "bearer", "token": "abc"}}
        is_valid, errors = validate_plugin_config(config, schema)
        assert is_valid

    def test_empty_schema(self):
        config = {"any_key": "any_value"}
        is_valid, errors = validate_plugin_config(config, {})
        assert is_valid

    def test_extra_fields_not_in_schema_are_allowed(self):
        schema = {
            "timeout": {"type": "integer", "required": True},
        }
        config = {"timeout": 30, "extra_field": "ignored"}
        is_valid, errors = validate_plugin_config(config, schema)
        assert is_valid


class TestFillConfigDefaults:
    """Test fill_config_defaults."""

    def test_fills_missing_defaults(self):
        schema = {
            "timeout": {"type": "integer", "default": 30},
            "retries": {"type": "integer", "default": 3},
        }
        config = {"timeout": 60}
        result = fill_config_defaults(config, schema)
        assert result["timeout"] == 60
        assert result["retries"] == 3

    def test_does_not_mutate_original(self):
        schema = {
            "timeout": {"type": "integer", "default": 30},
        }
        config = {}
        result = fill_config_defaults(config, schema)
        assert "timeout" not in config  # original not mutated
        assert result["timeout"] == 30

    def test_no_defaults_in_schema(self):
        schema = {
            "endpoint": {"type": "string", "required": True},
        }
        config = {}
        result = fill_config_defaults(config, schema)
        assert "endpoint" not in result

    def test_existing_values_not_overridden(self):
        schema = {
            "timeout": {"type": "integer", "default": 30},
        }
        config = {"timeout": 120}
        result = fill_config_defaults(config, schema)
        assert result["timeout"] == 120


# ── 2. Dependency Resolution ───────────────────────────────────────────


class _StubPlugin(FlowForgePlugin):
    """Concrete plugin for dependency testing."""

    def __init__(self, name: str, dependencies=None, optional_dependencies=None, priority=100):
        self.manifest = PluginManifest(
            name=name,
            dependencies=dependencies or [],
            optional_dependencies=optional_dependencies or [],
            priority=priority,
        )


class TestTopologicalSort:
    """Test _topological_sort_plugins from main.py."""

    def test_no_dependencies(self):
        from flowforge.app.main import _topological_sort_plugins

        p1 = _StubPlugin("alpha")
        p2 = _StubPlugin("beta")
        result = _topological_sort_plugins([p1, p2])
        names = [p.name for p in result]
        assert set(names) == {"alpha", "beta"}

    def test_simple_dependency(self):
        from flowforge.app.main import _topological_sort_plugins

        # beta depends on alpha, so alpha must come first
        alpha = _StubPlugin("alpha")
        beta = _StubPlugin("beta", dependencies=["alpha"])
        result = _topological_sort_plugins([beta, alpha])
        names = [p.name for p in result]
        assert names.index("alpha") < names.index("beta")

    def test_chain_dependency(self):
        from flowforge.app.main import _topological_sort_plugins

        # gamma -> beta -> alpha
        alpha = _StubPlugin("alpha")
        beta = _StubPlugin("beta", dependencies=["alpha"])
        gamma = _StubPlugin("gamma", dependencies=["beta"])
        result = _topological_sort_plugins([gamma, beta, alpha])
        names = [p.name for p in result]
        assert names.index("alpha") < names.index("beta")
        assert names.index("beta") < names.index("gamma")

    def test_diamond_dependency(self):
        from flowforge.app.main import _topological_sort_plugins

        # delta depends on beta and gamma, both depend on alpha
        alpha = _StubPlugin("alpha")
        beta = _StubPlugin("beta", dependencies=["alpha"])
        gamma = _StubPlugin("gamma", dependencies=["alpha"])
        delta = _StubPlugin("delta", dependencies=["beta", "gamma"])
        result = _topological_sort_plugins([delta, gamma, beta, alpha])
        names = [p.name for p in result]
        assert names.index("alpha") < names.index("beta")
        assert names.index("alpha") < names.index("gamma")
        assert names.index("beta") < names.index("delta")
        assert names.index("gamma") < names.index("delta")

    def test_circular_dependency_fallback(self):
        from flowforge.app.main import _topological_sort_plugins

        # a -> b -> a (circular)
        a = _StubPlugin("a", dependencies=["b"], priority=10)
        b = _StubPlugin("b", dependencies=["a"], priority=20)
        result = _topological_sort_plugins([a, b])
        # Should fall back to priority sort
        names = [p.name for p in result]
        assert names == ["a", "b"]  # priority 10 before 20

    def test_empty_list(self):
        from flowforge.app.main import _topological_sort_plugins

        result = _topological_sort_plugins([])
        assert result == []

    def test_external_dependency_ignored(self):
        """Dependencies on plugins not in the list are ignored in sorting."""
        from flowforge.app.main import _topological_sort_plugins

        alpha = _StubPlugin("alpha")
        beta = _StubPlugin("beta", dependencies=["alpha", "external_missing"])
        result = _topological_sort_plugins([beta, alpha])
        names = [p.name for p in result]
        assert names.index("alpha") < names.index("beta")


class TestMissingDependencyDetection:
    """Test that plugins with missing required dependencies are removed."""

    def test_missing_required_dep_removed(self):
        """Simulate the dependency check logic from _load_domain_plugins."""
        alpha = _StubPlugin("alpha")
        beta = _StubPlugin("beta", dependencies=["alpha"])
        gamma = _StubPlugin("gamma", dependencies=["missing_dep"])

        plugins = [alpha, beta, gamma]
        available_names = {p.name for p in plugins}

        filtered = []
        for plugin in plugins:
            missing = False
            for dep in plugin.manifest.dependencies:
                if dep not in available_names:
                    missing = True
                    break
            if not missing:
                filtered.append(plugin)

        assert len(filtered) == 2
        assert set(p.name for p in filtered) == {"alpha", "beta"}

    def test_optional_dep_not_removed(self):
        alpha = _StubPlugin("alpha")
        beta = _StubPlugin("beta", optional_dependencies=["optional_missing"])

        plugins = [alpha, beta]
        available_names = {p.name for p in plugins}

        filtered = []
        for plugin in plugins:
            missing = False
            for dep in plugin.manifest.dependencies:
                if dep not in available_names:
                    missing = True
                    break
            if not missing:
                filtered.append(plugin)

        assert len(filtered) == 2


# ── 3. Version Compatibility ───────────────────────────────────────────


class TestVersionCompatibility:
    """Test _check_version_compatibility from main.py."""

    def test_compatible_plugin_kept(self):
        from flowforge.app.main import _check_version_compatibility

        plugin = _StubPlugin("compatible")
        plugin.manifest.min_framework_version = ""
        plugin.manifest.max_framework_version = ""
        result = _check_version_compatibility([plugin])
        assert len(result) == 1

    def test_min_version_too_high_removed(self):
        from flowforge.app.main import _check_version_compatibility

        plugin = _StubPlugin("too_new")
        plugin.manifest.min_framework_version = "99.0.0"
        result = _check_version_compatibility([plugin])
        assert len(result) == 0

    def test_max_version_exceeded_kept_with_warning(self):
        from flowforge.app.main import _check_version_compatibility

        plugin = _StubPlugin("old_plugin")
        plugin.manifest.max_framework_version = "0.0.1"
        # Current version is 0.1.0, which is > 0.0.1
        # Plugin should still be kept (only warning)
        result = _check_version_compatibility([plugin])
        assert len(result) == 1

    def test_min_version_satisfied(self):
        from flowforge.app.main import _check_version_compatibility

        plugin = _StubPlugin("ok_plugin")
        plugin.manifest.min_framework_version = "0.1.0"
        result = _check_version_compatibility([plugin])
        assert len(result) == 1

    def test_mixed_compatibility(self):
        from flowforge.app.main import _check_version_compatibility

        ok = _StubPlugin("ok")
        ok.manifest.min_framework_version = "0.1.0"

        too_new = _StubPlugin("too_new")
        too_new.manifest.min_framework_version = "99.0.0"

        result = _check_version_compatibility([ok, too_new])
        assert len(result) == 1
        assert result[0].name == "ok"


# ── 4. MCP Server ──────────────────────────────────────────────────────


class _StubTool:
    """Minimal tool stub for MCP Server testing."""

    def __init__(self, name: str, description: str = "", safety_level: str = "normal",
                 parameters_schema: dict = None):
        self.name = name
        self.description = description
        self.safety_level = safety_level
        self.parameters_schema = parameters_schema or {}


class _StubToolRegistry:
    """Minimal tool registry stub for MCP Server testing."""

    def __init__(self, tools: dict = None):
        self._tools = tools or {}


class TestMCPServer:
    """Test MCPServer from mcp/server.py."""

    def test_list_tools_empty_registry(self):
        from flowforge.mcp.server import MCPServer

        server = MCPServer(tool_registry=None)
        assert server.list_tools() == []

    def test_list_tools_filters_by_safety(self):
        from flowforge.mcp.server import MCPServer

        registry = _StubToolRegistry({
            "safe_tool": _StubTool("safe_tool", safety_level="readonly"),
            "normal_tool": _StubTool("normal_tool", safety_level="normal"),
            "danger_tool": _StubTool("danger_tool", safety_level="dangerous"),
        })
        server = MCPServer(tool_registry=registry, max_safety_level="normal")
        tools = server.list_tools()
        names = [t["name"] for t in tools]
        assert "safe_tool" in names
        assert "normal_tool" in names
        assert "danger_tool" not in names

    def test_list_tools_readonly_only(self):
        from flowforge.mcp.server import MCPServer

        registry = _StubToolRegistry({
            "safe_tool": _StubTool("safe_tool", safety_level="readonly"),
            "normal_tool": _StubTool("normal_tool", safety_level="normal"),
        })
        server = MCPServer(tool_registry=registry, max_safety_level="readonly")
        tools = server.list_tools()
        names = [t["name"] for t in tools]
        assert "safe_tool" in names
        assert "normal_tool" not in names

    def test_list_tools_format(self):
        from flowforge.mcp.server import MCPServer

        registry = _StubToolRegistry({
            "search": _StubTool(
                "search",
                description="Search tool",
                safety_level="normal",
                parameters_schema={"type": "object", "properties": {"q": {"type": "string"}}},
            ),
        })
        server = MCPServer(tool_registry=registry)
        tools = server.list_tools()
        assert len(tools) == 1
        assert tools[0]["name"] == "search"
        assert tools[0]["description"] == "Search tool"
        assert "inputSchema" in tools[0]

    def test_is_safe(self):
        from flowforge.mcp.server import MCPServer

        server = MCPServer(max_safety_level="normal")
        assert server._is_safe("readonly") is True
        assert server._is_safe("normal") is True
        assert server._is_safe("dangerous") is False

    def test_is_safe_readonly_max(self):
        from flowforge.mcp.server import MCPServer

        server = MCPServer(max_safety_level="readonly")
        assert server._is_safe("readonly") is True
        assert server._is_safe("normal") is False

    def test_is_safe_dangerous_max(self):
        from flowforge.mcp.server import MCPServer

        server = MCPServer(max_safety_level="dangerous")
        assert server._is_safe("readonly") is True
        assert server._is_safe("normal") is True
        assert server._is_safe("dangerous") is True

    @pytest.mark.asyncio
    async def test_call_tool_not_found(self):
        from flowforge.mcp.server import MCPServer

        registry = _StubToolRegistry({})
        server = MCPServer(tool_registry=registry)
        with pytest.raises(ValueError, match="Tool not found"):
            await server.call_tool("nonexistent", {})

    @pytest.mark.asyncio
    async def test_call_tool_safety_blocked(self):
        from flowforge.mcp.server import MCPServer

        registry = _StubToolRegistry({
            "danger": _StubTool("danger", safety_level="dangerous"),
        })
        server = MCPServer(tool_registry=registry, max_safety_level="normal")
        with pytest.raises(PermissionError, match="safety_level"):
            await server.call_tool("danger", {})

    @pytest.mark.asyncio
    async def test_call_tool_no_registry(self):
        from flowforge.mcp.server import MCPServer

        server = MCPServer(tool_registry=None)
        with pytest.raises(RuntimeError, match="Tool registry not available"):
            await server.call_tool("any", {})

    def test_get_sse_endpoint(self):
        from flowforge.mcp.server import MCPServer

        registry = _StubToolRegistry({
            "tool1": _StubTool("tool1", safety_level="normal"),
        })
        server = MCPServer(tool_registry=registry)
        router = server.get_sse_endpoint()
        assert router is not None
        # Verify routes exist
        routes = [route.path for route in router.routes]
        assert "/mcp/tools" in routes
        assert "/mcp/tools/{tool_name}" in routes
        assert "/mcp/health" in routes


# ── 5. SystemConfig MCP fields ─────────────────────────────────────────


class TestSystemConfigMCP:
    """Test that SystemConfig includes MCP server fields."""

    def test_mcp_server_enabled_default(self):
        from flowforge.core.config import SystemConfig
        config = SystemConfig()
        # Phase 3: MCP server is now enabled by default
        assert config.mcp_server_enabled is True

    def test_mcp_server_port_default(self):
        from flowforge.core.config import SystemConfig
        config = SystemConfig()
        assert config.mcp_server_port == 9000


# ── 6. Framework version ───────────────────────────────────────────────


class TestFrameworkVersion:
    """Test that framework version is accessible."""

    def test_version_defined(self):
        from flowforge import __version__
        assert __version__
        assert isinstance(__version__, str)
        # Should be a valid semver-like string
        parts = __version__.split(".")
        assert len(parts) >= 2
