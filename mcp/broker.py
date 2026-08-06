"""MCP Broker - L3 Proxy Layer.

Implements FR-CAP-03 L3:
- Multi-server aggregation
- tool_name→server_name index (not traversal)
- Circuit breaker with three states: closed → open → half-open
  - closed: normal operation, track failures
  - open: reject all requests, wait for recovery timeout
  - half-open: allow one probe request; success → closed, failure → open
- Retry (3 times, exponential backoff)
"""

import asyncio
import time
from enum import Enum
from typing import Any

from flowforge.core.tracing import get_logger
from flowforge.mcp.client import MCPClient
from flowforge.mcp.gateway import MCPGateway

logger = get_logger("mcp.broker")

CIRCUIT_BREAKER_THRESHOLD = 5
CIRCUIT_OPEN_TIMEOUT = 60  # seconds before half-open
RETRY_MAX = 3
RETRY_BASE_DELAY = 1.0


class CircuitState(str, Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


class CircuitBreaker:
    """Circuit breaker with closed → open → half-open state machine.

    - closed: normal operation, track consecutive failures
    - open: reject all requests, wait for recovery timeout
    - half-open: allow one probe request; success → closed, failure → open
    """

    def __init__(
        self,
        failure_threshold: int = CIRCUIT_BREAKER_THRESHOLD,
        recovery_timeout: float = CIRCUIT_OPEN_TIMEOUT,
    ):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.state = CircuitState.CLOSED
        self.failure_count: int = 0
        self.last_failure_time: float = 0.0
        self.last_success_time: float = 0.0

    def record_success(self) -> None:
        """Record a successful call — reset to closed."""
        self.failure_count = 0
        self.state = CircuitState.CLOSED
        self.last_success_time = time.time()

    def record_failure(self) -> None:
        """Record a failed call — may transition to open."""
        self.failure_count += 1
        self.last_failure_time = time.time()
        if self.failure_count >= self.failure_threshold:
            self.state = CircuitState.OPEN
            logger.warning(
                f"Circuit breaker OPEN after {self.failure_count} failures"
            )

    def allow_request(self) -> bool:
        """Check if a request should be allowed.

        - closed: always allow
        - open: allow only if recovery timeout has elapsed (transition to half-open)
        - half-open: allow one probe request
        """
        if self.state == CircuitState.CLOSED:
            return True

        if self.state == CircuitState.OPEN:
            elapsed = time.time() - self.last_failure_time
            if elapsed >= self.recovery_timeout:
                self.state = CircuitState.HALF_OPEN
                logger.info("Circuit breaker transitioned to HALF_OPEN")
                return True
            return False

        if self.state == CircuitState.HALF_OPEN:
            # Allow one probe request
            return True

        return False

    def get_status(self) -> dict[str, Any]:
        """Get circuit breaker status."""
        return {
            "state": self.state.value,
            "failure_count": self.failure_count,
            "failure_threshold": self.failure_threshold,
            "recovery_timeout": self.recovery_timeout,
            "last_failure_time": self.last_failure_time,
            "last_success_time": self.last_success_time,
        }


class MCPBroker:
    """MCP broker - multi-server aggregation and routing.

    Maintains an index of tool_name→server_name for efficient routing,
    with circuit breaker (closed → open → half-open) and retry mechanisms.
    """

    def __init__(self, config: dict[str, Any] | None = None):
        self.config = config or {}
        self._servers: dict[str, MCPClient] = {}
        self._gateways: dict[str, MCPGateway] = {}
        self._tool_index: dict[str, str] = {}  # tool_name → server_name
        self._circuit_breakers: dict[str, CircuitBreaker] = {}  # server_name → CircuitBreaker
        self._cb_failure_threshold = self.config.get("circuit_breaker_threshold", CIRCUIT_BREAKER_THRESHOLD)
        self._cb_recovery_timeout = self.config.get("circuit_breaker_recovery_timeout", CIRCUIT_OPEN_TIMEOUT)

    def register_server(self, name: str, client: MCPClient, gateway: MCPGateway | None = None):
        """Register an MCP server."""
        self._servers[name] = client
        if gateway:
            self._gateways[name] = gateway
        self._circuit_breakers[name] = CircuitBreaker(
            failure_threshold=self._cb_failure_threshold,
            recovery_timeout=self._cb_recovery_timeout,
        )
        logger.info(f"MCP server registered: {name}")

    def unregister_server(self, name: str) -> None:
        """Unregister an MCP server."""
        self._servers.pop(name, None)
        self._gateways.pop(name, None)
        self._circuit_breakers.pop(name, None)
        # Remove tools indexed to this server
        self._tool_index = {
            t: s for t, s in self._tool_index.items() if s != name
        }
        logger.info(f"MCP server unregistered: {name}")

    async def index_tools(self, server_name: str):
        """Index tools from a server into the tool_name→server_name map."""
        client = self._servers.get(server_name)
        if not client:
            return

        tools = await client.list_tools()
        for tool in tools:
            tool_name = tool.get("name", "")
            if tool_name:
                self._tool_index[tool_name] = server_name

        logger.info(f"Indexed {len(tools)} tools from server '{server_name}'")

    async def index_all_tools(self) -> dict[str, int]:
        """Index tools from all registered servers.

        Returns:
            Dict mapping server_name to number of tools indexed.
        """
        results = {}
        for name in list(self._servers.keys()):
            try:
                await self.index_tools(name)
                results[name] = len([
                    t for t, s in self._tool_index.items() if s == name
                ])
            except Exception as e:
                logger.error(f"Failed to index tools from '{name}': {e}")
                results[name] = 0
        return results

    async def call_tool(self, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        """Route a tool call to the appropriate server.

        Uses tool_index for efficient routing. Falls back to
        traversal search if index miss. Circuit breaker prevents
        calls to known-failed servers.
        """
        # 1. Try index lookup
        server_name = self._tool_index.get(tool_name)

        if server_name:
            result = await self._execute_with_retry(server_name, tool_name, arguments)
            if result is not None:
                return result

        # 2. Fallback: traversal search (skip circuit-open servers)
        for name in self._servers:
            if name == server_name:
                continue  # Already tried
            cb = self._circuit_breakers.get(name)
            if cb and not cb.allow_request():
                continue
            result = await self._execute_with_retry(name, tool_name, arguments)
            if result is not None and result.get("error") is None:
                # Update index on successful discovery
                self._tool_index[tool_name] = name
                return result

        return {"error": f"Tool '{tool_name}' not found on any server"}

    async def _execute_with_retry(
        self,
        server_name: str,
        tool_name: str,
        arguments: dict[str, Any],
    ) -> dict[str, Any] | None:
        """Execute with retry and circuit breaker.

        Circuit breaker state machine:
        - Check if circuit allows request
        - On success: record_success (closed state)
        - On failure: record_failure (may transition to open)
        - In half-open: one probe; success → closed, failure → open
        """
        cb = self._circuit_breakers.get(server_name)
        if cb and not cb.allow_request():
            return {"error": f"Circuit breaker open for server '{server_name}'"}

        client = self._servers.get(server_name)
        gateway = self._gateways.get(server_name)

        if not client:
            return None

        last_error = None
        for attempt in range(RETRY_MAX):
            try:
                if gateway:
                    result = await gateway.execute_tool(tool_name, arguments, client)
                else:
                    result = await client.call_tool(tool_name, arguments)

                # Check if result indicates an error
                if result and result.get("error") is not None:
                    raise RuntimeError(result["error"])

                # Success: record in circuit breaker
                if cb:
                    cb.record_success()
                return result

            except Exception as e:
                last_error = e
                if cb:
                    cb.record_failure()

                if cb and cb.state == CircuitState.OPEN:
                    # Circuit just opened, stop retrying
                    logger.error(f"Circuit breaker opened for server '{server_name}' after error: {e}")
                    return {"error": f"Circuit breaker open: {e}"}

                if attempt < RETRY_MAX - 1:
                    delay = RETRY_BASE_DELAY * (2 ** attempt)
                    logger.info(f"Retry {attempt + 1}/{RETRY_MAX} for '{tool_name}' on '{server_name}' after {delay}s")
                    await asyncio.sleep(delay)

        return {"error": f"All retries failed for tool '{tool_name}' on server '{server_name}': {last_error}"}

    def list_all_tools(self) -> list[dict[str, Any]]:
        """List all indexed tools."""
        return [{"name": name, "server": server} for name, server in self._tool_index.items()]

    def get_status(self) -> dict:
        """Get broker status."""
        return {
            "server_count": len(self._servers),
            "indexed_tools": len(self._tool_index),
            "circuit_breakers": {
                name: cb.get_status()
                for name, cb in self._circuit_breakers.items()
            },
        }
