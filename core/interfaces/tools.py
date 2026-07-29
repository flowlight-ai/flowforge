"""FlowForge Plugin Protocol — the single integration contract for all tools.

Every tool in FlowForge MUST implement the ToolPlugin interface.
Plugins receive all dependencies through constructor params (DI), never
import other tools or services directly.

This module defines:
- PluginTransport: How the plugin communicates (local/mcp/openapi/graphql)
- PluginState: Lifecycle states for health tracking
- PluginManifest: Declarative plugin descriptor (loaded from YAML or auto-generated)
- PluginHealth: Health status model
- ToolPlugin: Abstract base class for all tool plugins
"""

from abc import ABC, abstractmethod
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class PluginTransport(str, Enum):
    """How the plugin communicates with FlowForge."""
    LOCAL = "local"          # In-process Python class
    MCP = "mcp"              # Model Context Protocol (stdio/SSE)
    OPENAPI = "openapi"      # REST API via OpenAPI spec
    GRAPHQL = "graphql"      # GraphQL endpoint


class PluginState(str, Enum):
    UNINITIALIZED = "uninitialized"
    UNKNOWN = "unknown"
    STARTING = "starting"
    READY = "ready"
    DEGRADED = "degraded"
    STOPPED = "stopped"
    ERROR = "error"


class PluginManifest(BaseModel):
    """Declarative plugin descriptor — loaded from YAML or auto-generated.

    This is the single source of truth for plugin metadata. It tells the
    PluginRegistry how to load, configure, and monitor a plugin.
    """
    name: str
    version: str = "1.0.0"
    description: str = ""
    transport: PluginTransport = PluginTransport.LOCAL
    # For LOCAL: fully-qualified class name (e.g., "flowforge.tools.opensieve_client:OpenSieveClient")
    entry_point: Optional[str] = None
    # For MCP/OPENAPI/GRAPHQL: connection config
    endpoint: Optional[str] = None
    api_key_env: Optional[str] = None  # env var name for API key
    # Tool schema (OpenAI function-calling format)
    parameters_schema: Dict[str, Any] = Field(default_factory=dict)
    safety_level: str = "normal"
    tags: List[str] = Field(default_factory=list)
    # Dependencies — other plugin names that must be loaded first
    depends_on: List[str] = Field(default_factory=list)
    # Health check
    health_endpoint: Optional[str] = None
    health_interval: int = 60  # seconds


class PluginHealth(BaseModel):
    """Health status of a plugin instance."""
    state: PluginState = PluginState.UNINITIALIZED
    message: str = ""
    last_check: Optional[float] = None
    latency_ms: Optional[float] = None


class ToolPlugin(ABC):
    """Base class for ALL tool plugins — the single integration contract.

    Every tool in FlowForge MUST implement this interface. No exceptions.
    Plugins receive all dependencies through __init__ params (DI), never
    import other tools or services directly.

    Lifecycle:
    1. PluginRegistry instantiates the class, passing config as kwargs
    2. PluginRegistry calls startup() once after registration
    3. execute() is called for each tool invocation
    4. shutdown() is called on graceful shutdown
    5. health_check() is called periodically for monitoring
    """

    # Class-level manifest (overridden by YAML config if present)
    manifest: PluginManifest
    _last_health_check_time: Optional[float] = None

    @abstractmethod
    async def execute(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Execute the tool.

        Args:
            params: Tool parameters matching manifest.parameters_schema.

        Returns:
            Result dict with tool output.

        Raises:
            Exception: On execution failure.
        """
        ...

    async def startup(self) -> None:
        """Called once after registration. Use for connection pools, etc."""
        pass

    async def shutdown(self) -> None:
        """Called on graceful shutdown. Clean up resources."""
        pass

    async def health_check(self) -> PluginHealth:
        return PluginHealth(state=PluginState.UNKNOWN, message="No health check implemented")

    def validate_params(self, params: Dict[str, Any]) -> bool:
        """Validate params against manifest.parameters_schema.

        Checks that all required fields are present in the params dict.
        """
        required = self.manifest.parameters_schema.get("required", [])
        return all(f in params for f in required)
