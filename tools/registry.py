"""Unified ToolRegistry — supports both BaseTool and ToolPlugin.

The ToolRegistry is the primary tool lookup mechanism for the execution engine.
It supports both legacy BaseTool instances and new ToolPlugin instances, and
can optionally delegate to PluginRegistry for tools not found locally.
"""

import asyncio
import time
from typing import Dict, Optional, Callable, Any
from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.errors import ToolNotFoundError
from flowforge.core.tracing import get_logger

logger = get_logger("tool_registry")


class ToolRegistry:
    """Unified tool registry supporting both BaseTool and ToolPlugin.

    When a tool is not found locally, the registry falls back to PluginRegistry
    (if configured) to find it. This eliminates the dual-registry gap where
    tools registered only in PluginRegistry were invisible to agents.

    For ToolPlugin instances, execute() is called with a dict argument instead
    of ToolInput, matching the ToolPlugin interface.
    """

    def __init__(self, tool_timeout: int = 120):
        self._tools: Dict[str, Any] = {}
        self._plugin_registry: Optional[Any] = None
        self._emit_callback: Optional[Callable] = None
        self._tool_timeout = tool_timeout

    def set_plugin_registry(self, plugin_registry: Any) -> None:
        """Set the PluginRegistry for fallback lookups.

        When a tool is not found in the local registry, get_tool() and
        execute() will delegate to the PluginRegistry.
        """
        self._plugin_registry = plugin_registry
        logger.info("ToolRegistry: PluginRegistry fallback configured")

    def set_emit_callback(self, callback: Callable):
        self._emit_callback = callback

    def register(self, tool):
        """Register a tool (BaseTool or ToolPlugin)."""
        tool_name = getattr(tool, 'name', None) or getattr(getattr(tool, 'manifest', None), 'name', None)
        if not tool_name:
            raise ValueError(f"Tool must have 'name' attribute or manifest.name")
        if tool_name in self._tools:
            raise ValueError(f"Tool '{tool_name}' already registered")
        self._tools[tool_name] = tool

    def get_tool(self, name: str):
        """Get a tool by name, falling back to PluginRegistry if not found locally.

        Args:
            name: The tool/plugin name to look up.

        Returns:
            The tool instance (BaseTool, ToolPlugin, or plugin).

        Raises:
            ToolNotFoundError: If the tool is not found in either registry.
        """
        if name in self._tools:
            return self._tools[name]

        # Fallback to PluginRegistry
        if self._plugin_registry:
            try:
                plugin = self._plugin_registry.get_plugin(name)
                if plugin:
                    return plugin
            except Exception:
                pass

        raise ToolNotFoundError(f"Tool '{name}' not found in ToolRegistry or PluginRegistry")

    def has_tool(self, name: str) -> bool:
        """Check if a tool exists in either registry."""
        if name in self._tools:
            return True
        if self._plugin_registry:
            try:
                return self._plugin_registry.has_plugin(name)
            except Exception:
                pass
        return False

    async def execute(self, name: str, input: ToolInput) -> ToolOutput:
        """Execute a tool, handling both BaseTool and ToolPlugin interfaces.

        For BaseTool instances: calls tool.execute(input) with ToolInput.
        For ToolPlugin instances: calls tool.execute(input.params) with dict.

        Falls back to PluginRegistry if the tool is not found locally.
        """
        tool = self.get_tool(name)

        # Determine tool type and call appropriately
        is_base_tool = isinstance(tool, BaseTool)

        if is_base_tool:
            # BaseTool: validate params and call execute(ToolInput)
            if not tool.validate_params(input.params):
                raise ValueError(f"Invalid params for tool '{name}'")
        # else: ToolPlugin — no validate_params, call execute(dict)

        if self._emit_callback:
            await self._emit_callback("tool.start", {"tool_name": name, "params": input.params})

        start = time.time()
        try:
            if is_base_tool:
                result = await asyncio.wait_for(tool.execute(input), timeout=self._tool_timeout)
            else:
                # ToolPlugin: call execute(dict) and wrap result in ToolOutput
                raw_result = await asyncio.wait_for(tool.execute(input.params), timeout=self._tool_timeout)
                if isinstance(raw_result, ToolOutput):
                    result = raw_result
                else:
                    result = ToolOutput(result=raw_result if isinstance(raw_result, dict) else {"result": raw_result})
        except TimeoutError:
            if self._emit_callback:
                await self._emit_callback("tool.end", {"tool_name": name, "error": "timeout", "duration_ms": int((time.time()-start)*1000)})
            return ToolOutput(result={}, error=f"Tool '{name}' timed out after {self._tool_timeout}s")
        except Exception as e:
            if self._emit_callback:
                await self._emit_callback("tool.end", {"tool_name": name, "error": str(e), "duration_ms": int((time.time()-start)*1000)})
            raise

        if self._emit_callback:
            await self._emit_callback("tool.end", {"tool_name": name, "result": result.result, "duration_ms": int((time.time()-start)*1000)})
        return result

    def list_tools(self) -> list:
        """List all available tool names from both registries."""
        names = set(self._tools.keys())
        if self._plugin_registry:
            try:
                names.update(self._plugin_registry.list_plugin_names())
            except Exception:
                pass
        return sorted(names)
