"""Tool Mediation — allowlist-enforced tool dispatch (roleagent.md Ch.7).

Layer 2 of the Harness seven-layer guardrail. Every tool invocation must
pass through ToolMediator so callers can be authorized against per-tool
allowlists. This is the structural enforcement of "tool calls must go
through ToolRegistry.execute()" (project rules).
"""

from __future__ import annotations

import inspect
import time
from dataclasses import dataclass
from typing import Any, Callable

from flowforge.core.errors import HarnessError, ToolAllowlistViolation
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.harness.tool_mediation")

__all__ = ["ToolResult", "ToolMediator"]

# A tool handler is either sync (returns Any) or async (returns Awaitable[Any]).
ToolHandler = Callable[..., Any]


@dataclass
class ToolResult:
    """Outcome of a mediated tool invocation."""

    success: bool
    output: Any
    error: str | None
    duration_ms: float


class ToolMediator:
    """Allowlist-enforced tool dispatcher.

    Handlers may be sync or async — ``invoke`` detects coroutine functions
    and awaits them. Allowlist violations raise ``ToolAllowlistViolation``
    synchronously (before the handler runs); handler failures are captured
    as ``ToolResult(success=False, ...)`` rather than raised, so the caller
    can decide how to react.
    """

    def __init__(self) -> None:
        self._tools: dict[str, tuple[ToolHandler, list[str]]] = {}

    def register_tool(
        self,
        name: str,
        handler: ToolHandler,
        allowlist: list[str],
    ) -> None:
        if not name:
            raise HarnessError("tool name must be non-empty")
        if name in self._tools:
            raise HarnessError(f"tool {name!r} already registered")
        self._tools[name] = (handler, list(allowlist))
        logger.info(
            f"harness: register_tool name={name!r} allowlist={allowlist}"
        )

    async def invoke(
        self,
        tool_name: str,
        args: dict[str, Any],
        caller: str,
    ) -> ToolResult:
        if tool_name not in self._tools:
            raise HarnessError(f"tool {tool_name!r} not registered")
        handler, allowlist = self._tools[tool_name]
        if caller not in allowlist:
            raise ToolAllowlistViolation(
                f"caller {caller!r} not in allowlist for tool {tool_name!r}"
            )
        start = time.perf_counter()
        try:
            if inspect.iscoroutinefunction(handler):
                output = await handler(**args)
            else:
                output = handler(**args)
            duration_ms = (time.perf_counter() - start) * 1000.0
            logger.info(
                f"harness: invoke tool={tool_name!r} caller={caller!r} "
                f"ok=True duration_ms={duration_ms:.2f}"
            )
            return ToolResult(
                success=True,
                output=output,
                error=None,
                duration_ms=duration_ms,
            )
        except Exception as exc:  # noqa: BLE001
            duration_ms = (time.perf_counter() - start) * 1000.0
            logger.warning(
                f"harness: invoke tool={tool_name!r} caller={caller!r} "
                f"ok=False error={exc!r}"
            )
            return ToolResult(
                success=False,
                output=None,
                error=str(exc),
                duration_ms=duration_ms,
            )
