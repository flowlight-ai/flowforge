"""FlowForge Plugin Registry — Central registry for all tool plugins.

Replaces the old tools/registry.py with a declarative, config-driven approach.
Supports three loading modes:
1. LOCAL: Import Python class, instantiate with DI
2. MCP: Connect via MCP protocol (uses mcp/ module)
3. OPENAPI: Generate client from OpenAPI spec

Configuration comes from config/plugins.yaml, not hardcoded imports.
"""

import asyncio
import importlib
import os
import re
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import yaml

from flowforge.core.circuit_breaker import CircuitBreaker, CircuitOpenError
from flowforge.core.errors import ConfigurationError, ToolNotFoundError
from flowforge.core.interfaces.tools import (
    PluginHealth,
    PluginManifest,
    PluginState,
    PluginTransport,
    ToolPlugin,
)
from flowforge.core.tracing import get_logger

logger = get_logger("plugin_registry")


def _resolve_env_vars(value: str) -> str:
    """Resolve ${ENV_VAR:default} patterns in string values.

    Examples:
        "${OPENSIEVE_ENDPOINT:http://localhost:8100}" → env value or "http://localhost:8100"
        "${OPENROUTE_PORT:13001}" → env value or "13001"
    """
    pattern = r"\$\{([^}:]+)(?::([^}]*))?\}"

    def replacer(match: re.Match) -> str:
        env_name = match.group(1)
        default = match.group(2) if match.group(2) is not None else ""
        return os.environ.get(env_name, default)

    return re.sub(pattern, replacer, value)


def _deep_resolve_env_vars(obj: Any) -> Any:
    """Recursively resolve ${ENV:default} patterns in nested dicts/lists/strings."""
    if isinstance(obj, str):
        return _resolve_env_vars(obj)
    elif isinstance(obj, dict):
        return {k: _deep_resolve_env_vars(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [_deep_resolve_env_vars(item) for item in obj]
    return obj


class PluginRegistry:
    """Central registry for all tool plugins.

    Supports three loading modes:
    1. LOCAL: Import Python class, instantiate with DI
    2. MCP: Connect via MCP protocol (uses mcp/ module)
    3. OPENAPI: Generate client from OpenAPI spec

    Configuration comes from config/plugins.yaml, not hardcoded imports.
    """

    def __init__(self, config_loader=None, di_container=None):
        self._plugins: dict[str, ToolPlugin] = {}
        self._manifests: dict[str, PluginManifest] = {}
        self._configs: dict[str, dict[str, Any]] = {}
        self._health_tasks: dict[str, asyncio.Task] = {}
        self._health_states: dict[str, PluginHealth] = {}
        self._circuit_breakers: dict[str, CircuitBreaker] = {}
        self._config = config_loader
        self._di = di_container
        self._emit_callback: Callable | None = None
        self._tool_timeout: int = 120

    def set_emit_callback(self, callback: Callable) -> None:
        """Set callback for tool execution events (tool.start, tool.end)."""
        self._emit_callback = callback

    def set_tool_timeout(self, timeout: int) -> None:
        """Set default timeout for tool execution."""
        self._tool_timeout = timeout

    async def load_from_config(self, plugins_yaml_path: str) -> None:
        """Load all plugins declared in plugins.yaml.

        The YAML file contains a top-level `plugins` key with a list of
        plugin declarations. Each declaration maps to a PluginManifest.

        Args:
            plugins_yaml_path: Path to the plugins YAML file.
                If relative, resolved against the config directory.

        Raises:
            ConfigurationError: If the YAML is malformed or a plugin fails to load.
        """
        file_path = Path(plugins_yaml_path)
        if not file_path.is_absolute():
            if self._config and hasattr(self._config, "config_dir"):
                file_path = self._config.config_dir / plugins_yaml_path
            else:
                file_path = Path(__file__).parent.parent / "config" / plugins_yaml_path

        if not file_path.exists():
            logger.warning(f"Plugins config not found: {file_path}")
            return

        with open(file_path, encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}

        plugin_list = data.get("plugins", [])
        if not plugin_list:
            logger.info("No plugins declared in config")
            return

        # Topological sort based on depends_on
        sorted_plugins = self._topological_sort(plugin_list)

        for plugin_def in sorted_plugins:
            try:
                # Resolve env vars in all string values
                resolved_def = _deep_resolve_env_vars(plugin_def)
                await self._register_from_dict(resolved_def)
            except Exception as e:
                plugin_name = plugin_def.get("name", "unknown")
                logger.error(f"Failed to load plugin '{plugin_name}': {e}")
                # Don't crash the entire system — skip and continue

    async def _register_from_dict(self, plugin_def: dict[str, Any]) -> None:
        """Register a single plugin from a dict declaration."""
        config = plugin_def.pop("config", {})
        manifest = PluginManifest(**plugin_def)
        await self.register_plugin(manifest, config)

    async def register_plugin(
        self, manifest: PluginManifest, config: dict[str, Any] | None = None
    ) -> None:
        """Register a single plugin by manifest.

        Args:
            manifest: Plugin manifest with metadata and loading info.
            config: Plugin-specific configuration passed to the constructor.

        Raises:
            ConfigurationError: If the plugin cannot be loaded.
        """
        config = config or {}

        if manifest.name in self._plugins:
            logger.warning(f"Plugin '{manifest.name}' already registered, skipping")
            return

        # Store manifest and config
        self._manifests[manifest.name] = manifest
        self._configs[manifest.name] = config

        # Create circuit breaker for this plugin
        self._circuit_breakers[manifest.name] = CircuitBreaker(
            name=manifest.name,
            failure_threshold=3,
            recovery_timeout=60.0,
        )

        # Load based on transport type
        try:
            if manifest.transport == PluginTransport.LOCAL:
                plugin = self._load_local_plugin(manifest, config)
            elif manifest.transport == PluginTransport.MCP:
                plugin = self._load_mcp_plugin(manifest, config)
            elif manifest.transport == PluginTransport.OPENAPI:
                plugin = self._load_openapi_plugin(manifest, config)
            elif manifest.transport == PluginTransport.GRAPHQL:
                plugin = self._load_graphql_plugin(manifest, config)
            else:
                raise ConfigurationError(
                    f"Unknown transport type: {manifest.transport}"
                )
        except Exception as e:
            self._health_states[manifest.name] = PluginHealth(
                state=PluginState.ERROR, message=str(e)
            )
            raise ConfigurationError(
                f"Failed to load plugin '{manifest.name}': {e}"
            ) from e

        # Call startup
        try:
            self._health_states[manifest.name] = PluginHealth(
                state=PluginState.STARTING
            )
            await plugin.startup()
            self._plugins[manifest.name] = plugin
            self._health_states[manifest.name] = PluginHealth(
                state=PluginState.READY
            )
            logger.info(
                f"Plugin registered: {manifest.name} "
                f"(transport={manifest.transport.value}, tags={manifest.tags})"
            )
        except Exception as e:
            self._health_states[manifest.name] = PluginHealth(
                state=PluginState.ERROR, message=f"Startup failed: {e}"
            )
            logger.error(f"Plugin '{manifest.name}' startup failed: {e}")
            # Still register it so we can track the error state
            self._plugins[manifest.name] = plugin

    async def register_instance(
        self, plugin: ToolPlugin, manifest: PluginManifest | None = None
    ) -> None:
        """Register an already-instantiated ToolPlugin directly.

        Use this when you have a plugin instance created outside the
        registry (e.g., for testing or programmatic registration).

        Also accepts BaseTool instances — they are automatically wrapped
        in a _BaseToolToPluginAdapter.

        Args:
            plugin: ToolPlugin or BaseTool instance to register.
            manifest: Optional manifest override. If not provided,
                uses the plugin's class-level manifest.
        """
        # Auto-adapter: wrap BaseTool instances
        from flowforge.core.base_tool import BaseTool
        if isinstance(plugin, BaseTool) and not isinstance(plugin, ToolPlugin):
            tool_name = getattr(plugin, "name", None) or plugin.__class__.__name__.lower()
            adapter_manifest = manifest
            if adapter_manifest is None:
                adapter_manifest = PluginManifest(name=tool_name)
            adapter = _BaseToolToPluginAdapter(plugin, adapter_manifest)
            # Recurse with the adapter
            return await self.register_instance(adapter, adapter_manifest)

        name = manifest.name if manifest else getattr(plugin, "manifest", None)
        if name and hasattr(name, "name"):
            name = name.name
        if not name:
            name = getattr(plugin, "name", plugin.__class__.__name__.lower())
        if name in self._plugins:
            logger.warning(f"Plugin '{name}' already registered, skipping")
            return

        if manifest:
            self._manifests[name] = manifest
        elif hasattr(plugin, "manifest") and plugin.manifest is not None:
            # plugin.manifest may be from plugin_protocol (plain class)
            # or interfaces.tools (Pydantic) — normalize to interfaces.tools
            pm = plugin.manifest
            if isinstance(pm, PluginManifest):
                self._manifests[name] = pm
            else:
                # Convert from plugin_protocol.PluginManifest
                self._manifests[name] = PluginManifest(name=getattr(pm, "name", name))
        else:
            # Create a default manifest for plugins without one
            self._manifests[name] = PluginManifest(name=name)

        self._configs[name] = {}

        # Create circuit breaker for this plugin
        self._circuit_breakers[name] = CircuitBreaker(
            name=name,
            failure_threshold=3,
            recovery_timeout=60.0,
        )

        try:
            self._health_states[name] = PluginHealth(state=PluginState.STARTING)
            await plugin.startup()
            self._plugins[name] = plugin
            self._health_states[name] = PluginHealth(state=PluginState.READY)
            logger.info(f"Plugin instance registered: {name}")
        except Exception as e:
            self._health_states[name] = PluginHealth(
                state=PluginState.ERROR, message=f"Startup failed: {e}"
            )
            self._plugins[name] = plugin

    def _load_local_plugin(
        self, manifest: PluginManifest, config: dict[str, Any]
    ) -> ToolPlugin:
        """Import entry_point class, instantiate with config dict as kwargs.

        Entry point format: "module.path:ClassName"
        Config dict is passed as **kwargs to the constructor (DI injection).
        """
        if not manifest.entry_point:
            raise ConfigurationError(
                f"LOCAL plugin '{manifest.name}' missing entry_point"
            )

        if ":" not in manifest.entry_point:
            raise ConfigurationError(
                f"Invalid entry_point format '{manifest.entry_point}', "
                f"expected 'module.path:ClassName'"
            )

        module_path, class_name = manifest.entry_point.split(":", 1)

        try:
            module = importlib.import_module(module_path)
        except ImportError as e:
            raise ConfigurationError(
                f"Cannot import module '{module_path}': {e}"
            ) from e

        plugin_class = getattr(module, class_name, None)
        if plugin_class is None:
            raise ConfigurationError(
                f"Class '{class_name}' not found in module '{module_path}'"
            )

        if not isinstance(plugin_class, type):
            raise ConfigurationError(
                f"'{class_name}' is not a class"
            )

        # Inject config as constructor kwargs
        try:
            instance = plugin_class(**config)
        except TypeError as e:
            raise ConfigurationError(
                f"Failed to instantiate '{class_name}' with config {config}: {e}"
            ) from e

        # Handle both ToolPlugin and legacy BaseTool subclasses
        if isinstance(instance, ToolPlugin):
            # Override manifest if the instance has a default one
            if not hasattr(instance, "manifest") or instance.manifest.name == "":
                instance.manifest = manifest
            return instance
        else:
            # Legacy BaseTool — wrap with adapter
            from flowforge.core.base_tool import BaseTool
            if isinstance(instance, BaseTool):
                wrapper = _BaseToolToPluginAdapter(instance, manifest)
                return wrapper
            raise ConfigurationError(
                f"'{class_name}' is not a ToolPlugin or BaseTool subclass"
            )

    def _load_mcp_plugin(
        self, manifest: PluginManifest, config: dict[str, Any]
    ) -> ToolPlugin:
        """Create MCPToolAdapter from mcp/ module.

        Wraps an MCP tool as a ToolPlugin instance.
        """
        try:
            from flowforge.mcp.tool_adapter import MCPToolAdapter
        except ImportError:
            raise ConfigurationError(
                "MCP module not available. Install mcp dependencies."
            )

        # Build tool_info dict for the adapter
        tool_info: dict[str, Any] = {
            "name": manifest.name,
            "description": manifest.description,
            "inputSchema": manifest.parameters_schema,
        }
        if manifest.safety_level:
            tool_info["safety_level"] = manifest.safety_level

        # MCPToolAdapter extends BaseTool, not ToolPlugin — we wrap it
        adapter = MCPToolAdapter(tool_info=tool_info)
        # Create a wrapper that adapts BaseTool → ToolPlugin
        wrapper = _BaseToolToPluginAdapter(adapter, manifest)
        return wrapper

    def _load_openapi_plugin(
        self, manifest: PluginManifest, config: dict[str, Any]
    ) -> ToolPlugin:
        """Generate OpenAPI client adapter.

        Creates an OpenAPIAdapter wrapped as a ToolPlugin.
        """
        try:
            from flowforge.tools.openapi_adapter import OpenAPIAdapter
        except ImportError:
            raise ConfigurationError(
                "OpenAPI adapter module not available."
            )

        endpoint = manifest.endpoint or ""
        api_key_env = manifest.api_key_env
        auth: dict[str, Any] = {}
        if api_key_env:
            auth = {"type": "bearer", "token_env": api_key_env}

        # Try to find spec URL (endpoint + /openapi.json or /swagger.json)
        spec_url = config.get("spec_url", f"{endpoint}/openapi.json")

        adapter = OpenAPIAdapter(spec_url=spec_url, auth=auth)
        wrapper = _BaseToolToPluginAdapter(adapter, manifest)
        return wrapper

    def _load_graphql_plugin(
        self, manifest: PluginManifest, config: dict[str, Any]
    ) -> ToolPlugin:
        """Generate GraphQL client adapter."""
        try:
            from flowforge.tools.graphql_adapter import GraphQLAdapter
        except ImportError:
            raise ConfigurationError(
                "GraphQL adapter module not available."
            )

        endpoint = manifest.endpoint or ""
        api_key_env = manifest.api_key_env
        auth: dict[str, Any] = {}
        if api_key_env:
            auth = {"type": "bearer", "token_env": api_key_env}

        adapter = GraphQLAdapter(
            default_endpoint=endpoint,
            auth=auth,
        )
        wrapper = _BaseToolToPluginAdapter(adapter, manifest)
        return wrapper

    async def execute(
        self, plugin_name: str, params: dict[str, Any]
    ) -> dict[str, Any]:
        """Execute a plugin by name.

        Handles timeout, events, and metrics.

        Args:
            plugin_name: Registered plugin name.
            params: Tool parameters.

        Returns:
            Result dict from the plugin.

        Raises:
            ToolNotFoundError: If the plugin is not registered.
        """
        if plugin_name not in self._plugins:
            raise ToolNotFoundError(f"Plugin '{plugin_name}' not found")

        plugin = self._plugins[plugin_name]
        manifest = self._manifests.get(plugin_name)
        cb = self._circuit_breakers.get(plugin_name)

        # Circuit breaker: reject fast if circuit is open
        if cb and not cb.is_available:
            self._health_states[plugin_name] = PluginHealth(
                state=PluginState.DEGRADED,
                message=f"Circuit breaker open for '{plugin_name}'",
            )
            return {"error": f"Plugin '{plugin_name}' circuit breaker is open — too many recent failures"}

        # Validate params
        if manifest and not plugin.validate_params(params):
            required = manifest.parameters_schema.get("required", [])
            missing = [f for f in required if f not in params]
            raise ValueError(
                f"Invalid params for plugin '{plugin_name}': "
                f"missing required fields: {missing}"
            )

        # Emit start event
        if self._emit_callback:
            await self._emit_callback(
                "tool.start",
                {"tool_name": plugin_name, "params": params},
            )

        start = time.time()
        try:
            if cb:
                result = await cb.call(
                    lambda: asyncio.wait_for(
                        plugin.execute(params), timeout=self._tool_timeout
                    )
                )
            else:
                result = await asyncio.wait_for(
                    plugin.execute(params), timeout=self._tool_timeout
                )
        except CircuitOpenError:
            self._health_states[plugin_name] = PluginHealth(
                state=PluginState.DEGRADED,
                message=f"Circuit breaker open for '{plugin_name}'",
            )
            return {"error": f"Plugin '{plugin_name}' circuit breaker is open"}
        except TimeoutError:
            # cb.call() doesn't wrap asyncio.wait_for when used via lambda,
            # so timeout is NOT recorded by cb.call() — record manually
            if cb:
                cb.record_failure()
            if self._emit_callback:
                duration_ms = int((time.time() - start) * 1000)
                await self._emit_callback(
                    "tool.end",
                    {
                        "tool_name": plugin_name,
                        "error": "timeout",
                        "duration_ms": duration_ms,
                    },
                )
            self._health_states[plugin_name] = PluginHealth(
                state=PluginState.DEGRADED,
                message=f"Execution timed out after {self._tool_timeout}s",
            )
            return {"error": f"Plugin '{plugin_name}' timed out after {self._tool_timeout}s"}
        except Exception as e:
            # cb.call() already recorded the failure, don't double-count
            if not cb:
                pass  # no circuit breaker to record to
            # cb.call() handles record_failure internally
            if self._emit_callback:
                duration_ms = int((time.time() - start) * 1000)
                await self._emit_callback(
                    "tool.end",
                    {
                        "tool_name": plugin_name,
                        "error": str(e),
                        "duration_ms": duration_ms,
                    },
                )
            raise

        if self._emit_callback:
            duration_ms = int((time.time() - start) * 1000)
            await self._emit_callback(
                "tool.end",
                {
                    "tool_name": plugin_name,
                    "result": result,
                    "duration_ms": duration_ms,
                },
            )
        return result

    def get_plugin(self, name: str) -> ToolPlugin:
        """Get a registered plugin by name.

        Raises:
            ToolNotFoundError: If the plugin is not registered.
        """
        if name not in self._plugins:
            raise ToolNotFoundError(f"Plugin '{name}' not found")
        return self._plugins[name]

    def has_plugin(self, name: str) -> bool:
        """Check if a plugin is registered."""
        return name in self._plugins

    def list_plugins(self) -> list[PluginManifest]:
        """List all registered plugin manifests."""
        return list(self._manifests.values())

    def list_plugin_names(self) -> list[str]:
        """List all registered plugin names."""
        return list(self._plugins.keys())

    def get_manifest(self, name: str) -> PluginManifest | None:
        """Get the manifest for a registered plugin."""
        return self._manifests.get(name)

    def get_health(self, name: str) -> PluginHealth:
        """Get the health status of a plugin."""
        return self._health_states.get(
            name, PluginHealth(state=PluginState.UNINITIALIZED)
        )

    def get_circuit_breaker(self, name: str) -> CircuitBreaker | None:
        """Get the circuit breaker for a plugin (for monitoring/testing)."""
        return self._circuit_breakers.get(name)

    async def check_all_health(self) -> dict[str, PluginHealth]:
        """Run health checks on all registered plugins."""
        results: dict[str, PluginHealth] = {}
        for name, plugin in self._plugins.items():
            try:
                health = await asyncio.wait_for(
                    plugin.health_check(), timeout=10
                )
                results[name] = health
                self._health_states[name] = health
            except TimeoutError:
                results[name] = PluginHealth(
                    state=PluginState.DEGRADED, message="Health check timed out"
                )
            except Exception as e:
                results[name] = PluginHealth(
                    state=PluginState.ERROR, message=str(e)
                )
        return results

    async def shutdown_all(self) -> None:
        """Gracefully shutdown all registered plugins."""
        # Cancel health check tasks
        for task in self._health_tasks.values():
            task.cancel()
        self._health_tasks.clear()

        # Shutdown plugins in reverse order
        for name in reversed(list(self._plugins.keys())):
            plugin = self._plugins[name]
            try:
                await asyncio.wait_for(plugin.shutdown(), timeout=10)
                self._health_states[name] = PluginHealth(state=PluginState.STOPPED)
                logger.info(f"Plugin shut down: {name}")
            except TimeoutError:
                logger.warning(f"Plugin '{name}' shutdown timed out")
            except Exception as e:
                logger.error(f"Plugin '{name}' shutdown error: {e}")

        self._plugins.clear()

    def start_health_monitoring(self) -> None:
        """Start periodic health checks for all plugins with health_endpoint configured."""
        for name, manifest in self._manifests.items():
            if manifest.health_endpoint and manifest.health_interval > 0:
                task = asyncio.create_task(
                    self._periodic_health_check(name, manifest.health_interval)
                )
                self._health_tasks[name] = task

    async def _periodic_health_check(self, name: str, interval: int) -> None:
        """Periodically check health of a plugin."""
        while True:
            try:
                await asyncio.sleep(interval)
                if name not in self._plugins:
                    break
                plugin = self._plugins[name]
                health = await asyncio.wait_for(plugin.health_check(), timeout=10)
                self._health_states[name] = health
                if health.state in (PluginState.ERROR, PluginState.DEGRADED):
                    logger.warning(
                        f"Plugin '{name}' health: {health.state.value} - {health.message}"
                    )
            except asyncio.CancelledError:
                break
            except Exception as e:
                self._health_states[name] = PluginHealth(
                    state=PluginState.ERROR, message=str(e)
                )

    @staticmethod
    def _topological_sort(plugin_list: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Sort plugins by dependency order (depends_on).

        Plugins with no dependencies come first, then plugins that depend
        on them, and so on. Raises on circular dependencies.
        """
        name_to_def: dict[str, dict[str, Any]] = {}
        for p in plugin_list:
            name = p.get("name", "")
            if name:
                name_to_def[name] = p

        # Build adjacency list
        graph: dict[str, list[str]] = {name: [] for name in name_to_def}
        in_degree: dict[str, int] = dict.fromkeys(name_to_def, 0)

        for name, p in name_to_def.items():
            deps = p.get("depends_on", [])
            for dep in deps:
                if dep not in name_to_def:
                    logger.warning(
                        f"Plugin '{name}' depends on '{dep}' which is not declared"
                    )
                    continue
                graph[dep].append(name)
                in_degree[name] += 1

        # Kahn's algorithm
        queue = [name for name, deg in in_degree.items() if deg == 0]
        sorted_names: list[str] = []

        while queue:
            name = queue.pop(0)
            sorted_names.append(name)
            for dependent in graph[name]:
                in_degree[dependent] -= 1
                if in_degree[dependent] == 0:
                    queue.append(dependent)

        if len(sorted_names) != len(name_to_def):
            remaining = set(name_to_def.keys()) - set(sorted_names)
            raise ConfigurationError(
                f"Circular dependency detected among plugins: {remaining}"
            )

        return [name_to_def[name] for name in sorted_names]


class _BaseToolToPluginAdapter(ToolPlugin):
    """Adapter that wraps an existing BaseTool instance as a ToolPlugin.

    This provides backward compatibility during the migration from
    BaseTool to ToolPlugin. Existing tools that extend BaseTool can
    be used through the PluginRegistry via this adapter.
    """

    def __init__(self, base_tool: Any, manifest: PluginManifest):
        self._base_tool = base_tool
        self.manifest = manifest

    async def execute(self, params: dict[str, Any]) -> dict[str, Any]:
        """Delegate to BaseTool.execute(), converting params format."""
        from flowforge.core.base_tool import ToolInput, ToolOutput

        tool_input = ToolInput(params=params)
        output: ToolOutput = await self._base_tool.execute(tool_input)
        result = dict(output.result) if output.result else {}
        if output.error:
            result["error"] = output.error
        return result

    async def startup(self) -> None:
        """No-op for BaseTool adapters."""
        pass

    async def shutdown(self) -> None:
        """No-op for BaseTool adapters."""
        pass

    async def health_check(self) -> PluginHealth:
        """Delegate to BaseTool.health_check() if available."""
        if hasattr(self._base_tool, "health_check"):
            try:
                result = await self._base_tool.health_check()
                if isinstance(result, dict):
                    status = result.get("status", "unknown")
                    if status == "healthy" or status == "ok":
                        return PluginHealth(state=PluginState.READY)
                    elif status == "unhealthy":
                        return PluginHealth(
                            state=PluginState.ERROR,
                            message="Health check returned unhealthy",
                        )
                return PluginHealth(state=PluginState.READY)
            except Exception as e:
                return PluginHealth(state=PluginState.ERROR, message=str(e))
        return PluginHealth(state=PluginState.READY)

    def validate_params(self, params: dict[str, Any]) -> bool:
        """Delegate to BaseTool.validate_params()."""
        return self._base_tool.validate_params(params)
