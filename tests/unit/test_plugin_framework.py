"""Quick validation test for the Plugin Framework."""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def test_env_var_resolution():
    from flowforge.core.plugin_registry import _resolve_env_vars, _deep_resolve_env_vars

    # Plain string
    assert _resolve_env_vars("hello") == "hello"

    # Missing var with default
    assert _resolve_env_vars("${MISSING_VAR:default}") == "default"

    # Env var set
    os.environ["TEST_VAR"] = "test_value"
    assert _resolve_env_vars("${TEST_VAR:default}") == "test_value"
    del os.environ["TEST_VAR"]

    # Deep resolve
    assert _deep_resolve_env_vars({"key": "${PORT:8080}"}) == {"key": "8080"}
    assert _deep_resolve_env_vars(["${PORT:8080}"]) == ["8080"]

    print("  env var resolution: OK")


def test_topological_sort():
    from flowforge.core.plugin_registry import PluginRegistry

    plugins = [
        {"name": "web_search", "depends_on": ["opensieve_search"]},
        {"name": "opensieve_search", "depends_on": []},
    ]
    sorted_plugins = PluginRegistry._topological_sort(plugins)
    assert sorted_plugins[0]["name"] == "opensieve_search"
    assert sorted_plugins[1]["name"] == "web_search"

    # Circular dependency detection
    circular = [
        {"name": "a", "depends_on": ["b"]},
        {"name": "b", "depends_on": ["a"]},
    ]
    try:
        PluginRegistry._topological_sort(circular)
        assert False, "Should have raised ConfigurationError"
    except Exception:
        pass

    print("  topological sort: OK")


def test_registry_instantiation():
    from flowforge.core.plugin_registry import PluginRegistry

    registry = PluginRegistry()
    assert len(registry.list_plugin_names()) == 0
    print("  registry instantiation: OK")


async def test_register_tool_plugin():
    from flowforge.core.plugin_registry import PluginRegistry
    from flowforge.tools.opensieve_client import OpenSieveClient

    registry = PluginRegistry()
    plugin = OpenSieveClient(endpoint="http://localhost:8100/api/v1/retrieve", timeout=90)
    await registry.register_instance(plugin)
    assert registry.has_plugin("opensieve_search")
    assert registry.get_manifest("opensieve_search").name == "opensieve_search"

    # Execute
    result = await registry.execute("opensieve_search", {"query": "test"})
    assert "results" in result

    # Shutdown
    await registry.shutdown_all()

    print("  register ToolPlugin: OK")


async def test_register_base_tool():
    from flowforge.core.plugin_registry import PluginRegistry
    from flowforge.tools.duckduckgo_search import DuckDuckGoSearchTool
    from flowforge.core.interfaces.tools import PluginManifest

    registry = PluginRegistry()
    tool = DuckDuckGoSearchTool()
    manifest = PluginManifest(name="test_ddg")
    from flowforge.core.plugin_registry import _BaseToolToPluginAdapter
    adapter = _BaseToolToPluginAdapter(tool, manifest)
    await registry.register_instance(adapter, manifest)
    assert registry.has_plugin("test_ddg")

    print("  register BaseTool (via adapter): OK")


async def test_load_from_config():
    from flowforge.core.plugin_registry import PluginRegistry
    from flowforge.core.config import ConfigLoader

    registry = PluginRegistry(config_loader=ConfigLoader())
    await registry.load_from_config("plugins.yaml")
    names = registry.list_plugin_names()
    assert len(names) > 0
    assert "opensieve_search" in names
    assert "web_search" in names
    assert "openroute" in names

    print(f"  load_from_config: OK ({len(names)} plugins loaded)")

    await registry.shutdown_all()


if __name__ == "__main__":
    print("Running Plugin Framework validation tests...")
    test_env_var_resolution()
    test_topological_sort()
    test_registry_instantiation()
    asyncio.run(test_register_tool_plugin())
    asyncio.run(test_register_base_tool())
    asyncio.run(test_load_from_config())
    print("\nAll tests passed!")
