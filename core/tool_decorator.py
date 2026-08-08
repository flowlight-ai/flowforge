"""Simplified Tool Registration — @tool decorator.

Instead of creating a full BaseTool subclass, developers can use the
@tool decorator to register a simple Python function as a FlowForge tool.

Usage:
    from flowforge.core.tool_decorator import tool

    @tool(name="web_search", description="Search the web")
    async def web_search(query: str, max_results: int = 5) -> dict:
        '''Search the web for information.

        Args:
            query: The search query
            max_results: Maximum number of results
        '''
        # implementation
        return {"results": [...]}

    # The tool is auto-registered with ToolRegistry
    # Type hints are used to generate the JSON Schema
"""

from __future__ import annotations

import asyncio
import inspect
import re
from collections.abc import Callable
from typing import Any, Optional, get_type_hints

from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.tracing import get_logger

logger = get_logger("tool_decorator")

# ── JSON Schema type mapping ────────────────────────────────────────

_PYTHON_TYPE_TO_JSON_SCHEMA: dict[type, str] = {
    str: "string",
    int: "integer",
    float: "number",
    bool: "boolean",
    list: "array",
    dict: "object",
}


def _type_to_json_schema(py_type: Any) -> dict[str, Any]:
    """Convert a Python type hint to a JSON Schema fragment."""
    origin = getattr(py_type, "__origin__", None)

    if origin is list:
        args = getattr(py_type, "__args__", (Any,))
        return {
            "type": "array",
            "items": _type_to_json_schema(args[0]) if args[0] is not Any else {},
        }
    if origin is dict:
        return {"type": "object"}
    if origin is Optional:
        args = getattr(py_type, "__args__", (str,))
        inner = _type_to_json_schema(args[0])
        inner["nullable"] = True
        return inner

    schema_type = _PYTHON_TYPE_TO_JSON_SCHEMA.get(py_type, "string")
    return {"type": schema_type}


def _parse_docstring_params(docstring: str) -> dict[str, str]:
    """Extract parameter descriptions from a Google-style docstring.

    Parses the ``Args:`` section and returns a mapping of param name → description.
    """
    if not docstring:
        return {}

    params: dict[str, str] = {}
    in_args = False
    current_param: str | None = None
    current_desc: list[str] = []

    for line in docstring.splitlines():
        stripped = line.strip()

        if stripped == "Args:":
            in_args = True
            continue

        if in_args:
            # New param line: "param_name: description" or "param_name (type): description"
            match = re.match(r"^(\w+)\s*(?:\([^)]*\))?\s*:\s*(.*)", stripped)
            if match:
                # Save previous param
                if current_param is not None:
                    params[current_param] = " ".join(current_desc).strip()
                current_param = match.group(1)
                current_desc = [match.group(2)] if match.group(2) else []
                continue

            # End of Args section (another section header)
            if stripped and stripped.endswith(":") and not stripped.startswith(" "):
                if current_param is not None:
                    params[current_param] = " ".join(current_desc).strip()
                break

            # Continuation line
            if current_param is not None and stripped:
                current_desc.append(stripped)

    if current_param is not None:
        params[current_param] = " ".join(current_desc).strip()

    return params


def _build_parameters_schema(
    func: Callable,
    type_hints: dict[str, Any],
    param_descriptions: dict[str, str],
) -> dict[str, Any]:
    """Build a JSON Schema from function type hints and docstring.

    Skips 'return' annotation and parameters without type hints.
    """
    sig = inspect.signature(func)
    properties: dict[str, Any] = {}
    required: list[str] = []

    for param_name, param in sig.parameters.items():
        if param_name in ("self", "cls"):
            continue

        hint = type_hints.get(param_name)
        if hint is None:
            # No type hint — default to string
            prop: dict[str, Any] = {"type": "string"}
        else:
            prop = _type_to_json_schema(hint)

        if param_name in param_descriptions:
            prop["description"] = param_descriptions[param_name]

        # Determine if required (no default value)
        if param.default is inspect.Parameter.empty:
            required.append(param_name)
        else:
            prop["default"] = param.default

        properties[param_name] = prop

    schema: dict[str, Any] = {
        "type": "object",
        "properties": properties,
    }
    if required:
        schema["required"] = required

    return schema


class DecoratedTool(BaseTool):
    """A BaseTool wrapper created by the @tool decorator.

    Wraps a plain async/sync function into the BaseTool interface,
    auto-generating the parameters_schema from type hints and docstring.
    """

    def __init__(
        self,
        func: Callable,
        name: str,
        description: str,
        parameters_schema: dict[str, Any],
        safety_level: str = "normal",
    ) -> None:
        self._func = func
        self.name = name
        self.description = description
        self.parameters_schema = parameters_schema
        self.safety_level = safety_level
        self.is_concurrency_safe = True
        self._is_async = asyncio.iscoroutinefunction(func)

    async def execute(self, input: ToolInput) -> ToolOutput:
        """Execute the wrapped function with the input params."""
        try:
            if self._is_async:
                result = await self._func(**input.params)
            else:
                result = self._func(**input.params)

            if isinstance(result, dict):
                return ToolOutput(result=result)
            return ToolOutput(result={"result": result})

        except Exception as e:
            logger.error(f"Tool '{self.name}' execution failed: {e}")
            return ToolOutput(result={}, error=str(e))


# ── Global registry reference (set by FlowForgeSDK or manually) ─────

_global_tool_registry: Any | None = None


def set_tool_registry(registry: Any) -> None:
    """Set the global ToolRegistry for auto-registration.

    Called by FlowForgeSDK during initialization.
    """
    global _global_tool_registry
    _global_tool_registry = registry


def get_tool_registry() -> Any | None:
    """Get the global ToolRegistry set by FlowForgeSDK.

    Returns None if not set. Callers should fall back to creating a new
    ToolRegistry only if this returns None (e.g. in unit tests).
    """
    return _global_tool_registry


def tool(
    *,
    name: str,
    description: str = "",
    safety_level: str = "normal",
    auto_register: bool = True,
) -> Callable:
    """Decorator that converts a function into a FlowForge BaseTool.

    Args:
        name: Tool identifier (must be unique in the registry).
        description: Human-readable description of what the tool does.
        safety_level: Safety classification — "readonly", "normal", or "dangerous".
        auto_register: If True, auto-register with the global ToolRegistry.

    Returns:
        A DecoratedTool instance (also callable as the original function).

    Example::

        @tool(name="web_search", description="Search the web")
        async def web_search(query: str, max_results: int = 5) -> dict:
            '''Search the web for information.

            Args:
                query: The search query
                max_results: Maximum number of results
            '''
            return {"results": [...]}
    """

    def decorator(func: Callable) -> DecoratedTool:
        # Resolve type hints
        try:
            hints = get_type_hints(func)
        except Exception:
            hints = {}

        # Parse docstring for parameter descriptions
        docstring = inspect.getdoc(func) or ""
        param_descriptions = _parse_docstring_params(docstring)

        # Use function docstring as fallback description
        tool_description = description or docstring.split("\n\n")[0] if docstring else ""

        # Build JSON Schema from type hints + docstring
        parameters_schema = _build_parameters_schema(func, hints, param_descriptions)

        # Create the DecoratedTool wrapper
        decorated = DecoratedTool(
            func=func,
            name=name,
            description=tool_description,
            parameters_schema=parameters_schema,
            safety_level=safety_level,
        )

        # Auto-register with global ToolRegistry if available
        if auto_register and _global_tool_registry is not None:
            try:
                _global_tool_registry.register(decorated)
                logger.info(f"Auto-registered tool: {name}")
            except (ValueError, KeyError):
                logger.debug(f"Tool '{name}' already registered, skipping auto-registration")

        return decorated

    return decorator
