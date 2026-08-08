"""Unified ToolRegistry — supports both BaseTool and ToolPlugin.

The ToolRegistry is the primary tool lookup mechanism for the execution engine.
It supports both legacy BaseTool instances and new ToolPlugin instances, and
can optionally delegate to PluginRegistry for tools not found locally.
"""

import asyncio
import time
from collections.abc import Callable
from typing import Any

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
        self._tools: dict[str, Any] = {}
        self._plugin_registry: Any | None = None
        self._emit_callback: Callable | None = None
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
            raise ValueError("Tool must have 'name' attribute or manifest.name")
        if tool_name in self._tools:
            logger.debug(f"Tool '{tool_name}' already registered, skipping duplicate")
            return
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
        # LLM-heavy 工具需要更长超时：
        # - 单模型超时 90s（creative/judge 路由）+ 7 候选模型 = 630s
        # - 加上 backoff (1+2+4=7s) 和 verifier/judge 时间 = 约 700s
        # - writer_engine/editor_engine 内部调用 LLMClient 候选链，需要完整时间走完
        # v5.49 修复: writer_engine/editor_engine 原走默认 300s 超时，
        # 导致 LLMClient 候选链切换未完成就被 tool_registry 取消（task 3b37f632 根因）
        _LLM_HEAVY_TOOLS = ("llm", "llm_client", "writer_engine", "editor_engine",
                           "topic_strategist", "research_engine", "content_auditor")
        if name in _LLM_HEAVY_TOOLS:
            # LLM-heavy 工具：900s 超时，允许候选链完整切换（7模型 × 90s + backoff）
            effective_timeout = 900
        elif name in ("llm", "llm_client"):
            effective_timeout = 300
        else:
            effective_timeout = self._tool_timeout
        try:
            if is_base_tool:
                result = await asyncio.wait_for(tool.execute(input), timeout=effective_timeout)
            else:
                # ToolPlugin: call execute(dict) and wrap result in ToolOutput
                raw_result = await asyncio.wait_for(tool.execute(input.params), timeout=effective_timeout)
                if isinstance(raw_result, ToolOutput):
                    result = raw_result
                else:
                    result = ToolOutput(result=raw_result if isinstance(raw_result, dict) else {"result": raw_result})
        except TimeoutError:
            if self._emit_callback:
                await self._emit_callback("tool.end", {"tool_name": name, "error": "timeout", "duration_ms": int((time.time()-start)*1000)})
            logger.warning(f"Tool '{name}' timed out after {effective_timeout}s")
            return ToolOutput(result={"content": "", "error": f"timeout after {effective_timeout}s"}, error=f"Tool '{name}' timed out after {effective_timeout}s")
        except Exception as e:
            if self._emit_callback:
                await self._emit_callback("tool.end", {"tool_name": name, "error": str(e), "duration_ms": int((time.time()-start)*1000)})
            raise

        if self._emit_callback:
            await self._emit_callback("tool.end", {"tool_name": name, "result": result.result, "duration_ms": int((time.time()-start)*1000)})
        return result

    def unregister(self, name: str) -> None:
        """Remove a registered tool by name.

        Raises:
            KeyError: If the tool name is not registered.
        """
        if name in self._tools:
            del self._tools[name]
            logger.info(f"Unregistered tool: {name}")
        else:
            raise KeyError(f"Tool '{name}' not registered")

    def list_tools(self) -> list:
        """List all available tool names from both registries."""
        names = set(self._tools.keys())
        if self._plugin_registry:
            try:
                names.update(self._plugin_registry.list_plugin_names())
            except Exception:
                pass
        return sorted(names)

    def get_function_calls(self, tool_names: list[str] | None = None) -> list[dict]:
        """获取指定工具（或全部工具）的function calling格式定义。

        Args:
            tool_names: 需要获取的工具名列表，为None时返回全部工具。

        Returns:
            符合OpenAI function calling协议的tools列表。
        """
        tools = []
        for name, tool in self._tools.items():
            if tool_names and name not in tool_names:
                continue
            if hasattr(tool, 'to_function_call'):
                tools.append(tool.to_function_call())
        return tools
