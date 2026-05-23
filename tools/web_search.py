"""Web Search Aggregation Tool — delegates to search plugins via PluginRegistry.

Refactored to use PluginRegistry for delegate calls instead of directly
importing HelixRAGClient. Accepts plugin_registry through constructor (DI).

Fallback chain: primary plugin → fallback plugin → empty results
"""

from typing import Any, Dict, Optional

from flowforge.core.interfaces.tools import (
    PluginHealth,
    PluginManifest,
    PluginState,
    ToolPlugin,
)
from flowforge.core.tracing import get_logger

logger = get_logger("web_search_tool")


class WebSearchTool(ToolPlugin):
    """Web search aggregation tool — delegates to search plugins.

    Uses PluginRegistry.execute() for delegate calls instead of direct
    tool imports. No cross-module coupling.

    Config keys:
        primary: Name of the primary search plugin (default: "opensieve_search")
        fallback: Name of the fallback search plugin (default: "tavily_search")
    """

    manifest = PluginManifest(
        name="web_search",
        description="网络搜索聚合工具",
        tags=["search"],
        depends_on=["opensieve_search"],
        parameters_schema={
            "type": "object",
            "required": ["query"],
            "properties": {
                "query": {"type": "string"},
                "max_results": {"type": "integer", "default": 5},
            },
        },
    )

    def __init__(
        self,
        primary: str = "opensieve_search",
        fallback: str = "tavily_search",
        plugin_registry: Optional[Any] = None,
        **kwargs: Any,
    ):
        """Initialize WebSearchTool with config injection.

        Args:
            primary: Name of the primary search plugin.
            fallback: Name of the fallback search plugin.
            plugin_registry: PluginRegistry instance for delegate calls.
            **kwargs: Additional config (ignored for forward compatibility).
        """
        self._primary = primary
        self._fallback = fallback
        self._registry = plugin_registry

    def set_plugin_registry(self, registry: Any) -> None:
        """Set the PluginRegistry instance (for late injection)."""
        self._registry = registry

    async def startup(self) -> None:
        """Called by PluginRegistry after registration."""
        logger.info(
            f"WebSearchTool initialized: primary={self._primary}, "
            f"fallback={self._fallback}"
        )

    async def shutdown(self) -> None:
        """No resources to clean up."""
        pass

    async def health_check(self) -> PluginHealth:
        """Check if at least one search backend is available."""
        if not self._registry:
            return PluginHealth(
                state=PluginState.DEGRADED,
                message="No PluginRegistry configured",
            )

        # Check primary
        if self._registry.has_plugin(self._primary):
            primary_health = await self._registry.get_plugin(self._primary).health_check()
            if primary_health.state == PluginState.READY:
                return PluginHealth(state=PluginState.READY)

        # Check fallback
        if self._registry.has_plugin(self._fallback):
            fallback_health = await self._registry.get_plugin(self._fallback).health_check()
            if fallback_health.state == PluginState.READY:
                return PluginHealth(
                    state=PluginState.DEGRADED,
                    message=f"Primary '{self._primary}' unavailable, using fallback",
                )

        return PluginHealth(
            state=PluginState.ERROR,
            message="No search backend available",
        )

    async def execute(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Execute web search with fallback chain.

        Tries primary search plugin first, then fallback if primary fails
        or returns no results.

        Args:
            params: Must contain 'query'. Optional: max_results.

        Returns:
            Dict with 'results' list.
        """
        query = params["query"]
        max_results = params.get("max_results", 5)

        # Try primary search
        if self._registry and self._registry.has_plugin(self._primary):
            try:
                result = await self._registry.execute(
                    self._primary,
                    {"query": query, "max_results": max_results},
                )
                results = result.get("results", [])
                if results:
                    return {"results": results}
            except Exception as e:
                logger.debug(f"Primary search '{self._primary}' failed: {e}")

        # Try fallback search
        if self._registry and self._registry.has_plugin(self._fallback):
            try:
                result = await self._registry.execute(
                    self._fallback,
                    {"query": query, "max_results": max_results},
                )
                results = result.get("results", [])
                if results:
                    return {"results": results}
            except Exception as e:
                logger.debug(f"Fallback search '{self._fallback}' failed: {e}")

        return {
            "results": [],
            "message": f"未找到与 '{query}' 相关的搜索结果",
        }
