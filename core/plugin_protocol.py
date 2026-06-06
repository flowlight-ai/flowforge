"""FlowForge Plugin Protocol — abstract base class for business plugins.

Business projects subclass ``FlowForgePlugin`` and override the lifecycle
methods they need.  All methods are optional (no-op by default), so a
minimal plugin only needs to implement what it cares about.

The framework discovers plugins via the ``FLOWFORGE_DOMAIN_MODULE`` env var
(or ``system.domain_modules`` in config).  If the module exposes a ``Plugin``
class that inherits from ``FlowForgePlugin``, the framework instantiates it
and calls the lifecycle methods in a well-defined order.

Backward compatibility: modules that only define ``register_agents`` /
``register_tools`` top-level functions continue to work.
"""

from __future__ import annotations

import copy
from abc import ABC
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple, TYPE_CHECKING

if TYPE_CHECKING:
    from flowforge.core.agent_registry import AgentRegistry
    from flowforge.tools.registry import ToolRegistry
    from flowforge.events.event_bus import EventBus
    from flowforge.modes.registry import ModeRegistry
    from flowforge.scheduler.scheduler import TaskScheduler
    from flowforge.tools.llm_client import LLMClient
    from flowforge.core.config import SystemConfig, ConfigLoader


class PluginState(Enum):
    """Plugin lifecycle states.

    State transitions:
        UNINITIALIZED → STARTING → READY → STOPPING → STOPPED
        STARTING → ERROR
        READY → PAUSED → READY
        READY → STOPPING → STOPPED
    """

    UNINITIALIZED = "uninitialized"
    STARTING = "starting"
    READY = "ready"
    PAUSED = "paused"
    STOPPING = "stopping"
    STOPPED = "stopped"
    ERROR = "error"


class PluginManifest:
    """Unified plugin metadata — covers both business and tool plugins.

    Plugins can optionally define a ``manifest`` class attribute to declare
    their metadata, dependencies, and configuration schema.

    Event naming convention: use ``domain.action`` format, e.g.
    ``task.completed``, ``tool.start``, ``plugin.loaded``.
    """

    def __init__(
        self,
        # ── Basic metadata ──────────────────────────────────────────
        name: str = "",
        version: str = "0.1.0",
        description: str = "",
        author: str = "",
        license: str = "",
        homepage: str = "",
        # ── Dependencies and compatibility ───────────────────────────
        dependencies: Optional[List[str]] = None,
        optional_dependencies: Optional[List[str]] = None,
        min_framework_version: str = "",
        max_framework_version: str = "",
        # ── Configuration ────────────────────────────────────────────
        config_schema: Optional[Dict[str, Any]] = None,
        # ── Load control ─────────────────────────────────────────────
        priority: int = 100,
        # ── Tool plugin fields ───────────────────────────────────────
        transport: str = "local",  # local, mcp, openapi, graphql
        entry_point: str = "",
        endpoint: str = "",
        api_key_env: str = "",
        safety_level: str = "normal",  # readonly, normal, dangerous
        tags: Optional[List[str]] = None,
        health_endpoint: str = "",
        health_interval: int = 300,
        # ── Frontend extension ───────────────────────────────────────
        frontend_entry: str = "",
        mount_points: Optional[List[str]] = None,
    ):
        self.name = name
        self.version = version
        self.description = description
        self.author = author
        self.license = license
        self.homepage = homepage
        self.dependencies = dependencies or []
        self.optional_dependencies = optional_dependencies or []
        self.min_framework_version = min_framework_version
        self.max_framework_version = max_framework_version
        self.config_schema = config_schema or {}
        self.priority = priority  # Lower = loaded first
        self.transport = transport
        self.entry_point = entry_point
        self.endpoint = endpoint
        self.api_key_env = api_key_env
        self.safety_level = safety_level
        self.tags = tags or []
        self.health_endpoint = health_endpoint
        self.health_interval = health_interval
        self.frontend_entry = frontend_entry
        self.mount_points = mount_points or []


class PluginContext:
    """Dependency injection container for plugins — typed access to framework services.

    Provides access to framework services and the plugin's own configuration.
    Passed to all registration and lifecycle hooks.
    """

    def __init__(
        self,
        agent_registry: Any,
        tool_registry: Any,
        mode_registry: Any,
        event_bus: Any,
        scheduler: Any,
        app: Any,
        llm_client: Any = None,
        config: Any = None,
        plugin_config: Optional[Dict[str, Any]] = None,
        memory_manager: Optional[Any] = None,
        model_service: Optional[Any] = None,
        plugin_registry: Optional[Any] = None,
    ):
        self._agent_registry = agent_registry
        self._tool_registry = tool_registry
        self._mode_registry = mode_registry
        self._event_bus = event_bus
        self._scheduler = scheduler
        self._app = app
        self._llm_client = llm_client
        self._config = config
        self._plugin_config = plugin_config or {}
        self._memory_manager = memory_manager
        self._model_service = model_service
        self._plugin_registry = plugin_registry
        self._services: Dict[str, Any] = {}

    @property
    def agent_registry(self) -> Any:
        """Access the agent registry to register/discover agents."""
        return self._agent_registry

    @property
    def tool_registry(self) -> Any:
        """Access the tool registry to register/discover tools."""
        return self._tool_registry

    @property
    def mode_registry(self) -> Any:
        """Access the mode registry to register/discover execution modes."""
        return self._mode_registry

    @property
    def event_bus(self) -> Any:
        """Access the event bus to subscribe/publish events."""
        return self._event_bus

    @property
    def scheduler(self) -> Any:
        """Access the task scheduler to register cron jobs."""
        return self._scheduler

    @property
    def app(self) -> Any:
        """Access the FastAPI app instance to mount routes/middleware."""
        return self._app

    @property
    def llm_client(self) -> Any:
        """Access the shared LLM client for making LLM calls."""
        return self._llm_client

    @property
    def config(self) -> Any:
        """Access the system configuration."""
        return self._config

    @property
    def plugin_config(self) -> Dict[str, Any]:
        """Access this plugin's own configuration section.

        Loaded from the plugin's section in default.yaml, e.g.:

            contentforge:
              default_persona: "education"
              ...
        """
        return self._plugin_config

    @property
    def memory_manager(self) -> Optional[Any]:
        """Access the memory manager for persistent storage."""
        return self._memory_manager

    @property
    def model_service(self) -> Optional[Any]:
        """Access the model service for health checks and model routing."""
        return self._model_service

    @property
    def plugin_registry(self) -> Optional[Any]:
        """Access the plugin registry for tool plugin management."""
        return self._plugin_registry

    def register_service(self, name: str, service: Any) -> None:
        """Register a named service for plugin access."""
        self._services[name] = service

    def get_service(self, name: str) -> Optional[Any]:
        """Get a named service — checks registered services first, then built-in."""
        if name in self._services:
            return self._services[name]
        return getattr(self, f"_{name}", None)


class FlowForgePlugin(ABC):
    """Base class for FlowForge business plugins.

    Business projects subclass this and override the methods they need.
    All methods are optional (no-op by default).

    Plugins can declare a ``manifest`` class attribute for metadata:

        class Plugin(FlowForgePlugin):
            manifest = PluginManifest(
                name="my_project",
                version="1.0.0",
                dependencies=["other_plugin"],
                priority=50,
            )
    """

    manifest: PluginManifest = PluginManifest()

    def __init__(self):
        self._state = PluginState.UNINITIALIZED
        self._registered_agents: list[str] = []
        self._registered_tools: list[str] = []
        self._registered_routes: list[str] = []
        self._registered_event_handlers: list[tuple[str, Any]] = []
        self._registered_schedules: list[str] = []

    @property
    def state(self) -> PluginState:
        """Current lifecycle state of the plugin."""
        return self._state

    @state.setter
    def state(self, value: PluginState) -> None:
        self._state = value

    def _track_agent(self, name: str) -> None:
        """Track a registered agent for later cleanup."""
        self._registered_agents.append(name)

    def _track_tool(self, name: str) -> None:
        """Track a registered tool for later cleanup."""
        self._registered_tools.append(name)

    def _track_event_handler(self, event_type: str, handler: Any) -> None:
        """Track a registered event handler for later cleanup."""
        self._registered_event_handlers.append((event_type, handler))

    def _track_schedule(self, job_id: str) -> None:
        """Track a registered scheduled job for later cleanup."""
        self._registered_schedules.append(job_id)

    @property
    def name(self) -> str:
        """Plugin name, from manifest or derived from module path."""
        if self.manifest.name:
            return self.manifest.name
        return self.__class__.__module__.split(".")[0]

    @property
    def version(self) -> str:
        """Plugin version string, from manifest or default."""
        return self.manifest.version

    # ── Registration hooks ──────────────────────────────────────────

    def register_middleware(self, app: Any) -> None:
        """Add custom middleware to the FastAPI app.

        Called **before** the app starts handling requests.
        """
        pass

    def register_agents(self, agent_registry: Any) -> None:
        """Register business-specific agents into the agent registry."""
        pass

    def register_tools(self, tool_registry: Any) -> None:
        """Register business-specific tools into the tool registry."""
        pass

    def register_modes(self, mode_registry: Any) -> None:
        """Register custom execution modes into the mode registry."""
        pass

    def register_routes(self, app: Any) -> None:
        """Register custom API routes on the FastAPI app."""
        pass

    def register_event_handlers(self, event_bus: Any) -> None:
        """Subscribe to framework events on the event bus."""
        pass

    def register_schedules(self, scheduler: Any) -> None:
        """Register scheduled / cron tasks on the scheduler."""
        pass

    # ── Lifecycle hooks ─────────────────────────────────────────────

    def on_startup(self, context: dict) -> None:
        """Called after all registrations are complete."""
        pass

    def on_shutdown(self, context: dict) -> None:
        """Called on application shutdown."""
        pass

    def on_error(self, context: dict, error: Exception) -> None:
        """Called when an error occurs during plugin execution.

        Default implementation logs the error. Override to implement
        custom error handling (e.g., circuit breaker, fallback logic).
        """
        import logging
        logging.getLogger(self.name).error(
            f"[{self.name}] Plugin error: {error}", exc_info=True
        )

    def on_config_reload(self, config: dict) -> None:
        """Called when the plugin's configuration is reloaded.

        Override to respond to configuration changes without restart.
        """
        pass

    def on_plugin_loaded(self, plugin_name: str) -> None:
        """Called when another plugin has finished loading.

        Use this for cross-plugin initialization that depends on
        another plugin being available.
        """
        pass

    def health_check(self) -> dict:
        """Return plugin health status.

        Override to implement custom health checks.
        Returns a dict with at least 'status' key ('healthy'/'degraded'/'unhealthy').
        """
        return {"status": "healthy", "name": self.name, "version": self.version}


def validate_plugin_config(
    config: Dict[str, Any], schema: Dict[str, Any]
) -> Tuple[bool, List[str]]:
    """Validate plugin config against its declared schema.

    Uses simple type checking (not full JSON Schema) for lightweight validation.

    Schema format::

        {
            "field_name": {"type": "string", "required": True, "default": "value"},
            "another_field": {"type": "integer", "required": False, "default": 10},
        }

    Returns (is_valid, list_of_errors).
    """
    errors: List[str] = []
    type_map: Dict[str, type | tuple[type, ...]] = {
        "string": str,
        "integer": int,
        "number": (int, float),
        "boolean": bool,
        "array": list,
        "object": dict,
    }

    for field_name, field_spec in schema.items():
        field_type = field_spec.get("type", "string")
        required = field_spec.get("required", False)
        default = field_spec.get("default")

        if field_name not in config:
            if required and default is None:
                errors.append(f"Missing required field: {field_name}")
            elif default is not None:
                config[field_name] = default
            continue

        value = config[field_name]
        expected_type = type_map.get(field_type, str)
        if not isinstance(value, expected_type):
            errors.append(
                f"Field '{field_name}' expected type {field_type}, "
                f"got {type(value).__name__}"
            )

    return len(errors) == 0, errors


def fill_config_defaults(
    config: Dict[str, Any], schema: Dict[str, Any]
) -> Dict[str, Any]:
    """Fill missing config values with defaults from schema.

    Returns a new dict with defaults applied; does not mutate *config*.
    """
    result = copy.deepcopy(config)
    for field_name, field_spec in schema.items():
        if field_name not in result:
            default = field_spec.get("default")
            if default is not None:
                result[field_name] = default
    return result
