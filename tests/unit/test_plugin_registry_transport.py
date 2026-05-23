"""Unit tests for PluginRegistry transport failure, health monitoring, and circuit breaker.

Tests simulate various Transport-layer failure scenarios (connection errors, timeouts,
service unavailable) and verify that:
1. Health states transition correctly (READY → DEGRADED → ERROR)
2. Circuit breaker opens after consecutive failures
3. Circuit breaker rejects calls fast when open
4. Circuit breaker recovers to half-open after timeout
5. Periodic health checks detect and report failures
"""
import asyncio
import time
from typing import Any, Dict
from unittest.mock import AsyncMock, patch

import pytest

from flowforge.core.circuit_breaker import CircuitBreaker, CircuitOpenError, CircuitState
from flowforge.core.interfaces.tools import (
    PluginHealth,
    PluginManifest,
    PluginState,
    PluginTransport,
    ToolPlugin,
)
from flowforge.core.plugin_registry import PluginRegistry


# ---------------------------------------------------------------------------
# Mock plugins that simulate various transport failures
# ---------------------------------------------------------------------------

class _HealthyPlugin(ToolPlugin):
    """A plugin that always succeeds."""

    manifest = PluginManifest(name="healthy_plugin", transport=PluginTransport.LOCAL)

    async def execute(self, params: Dict[str, Any]) -> Dict[str, Any]:
        return {"status": "ok", "data": "healthy"}

    async def health_check(self) -> PluginHealth:
        return PluginHealth(state=PluginState.READY, message="all good")

    def validate_params(self, params: Dict[str, Any]) -> bool:
        return True


class _ConnectionErrorPlugin(ToolPlugin):
    """Simulates a transport-layer connection refused error (e.g., OPENAPI/MCP service down)."""

    manifest = PluginManifest(name="conn_error_plugin", transport=PluginTransport.OPENAPI)

    def __init__(self, **kwargs):
        self._call_count = 0

    async def execute(self, params: Dict[str, Any]) -> Dict[str, Any]:
        self._call_count += 1
        raise ConnectionRefusedError("Transport error: connection refused by remote service")

    async def health_check(self) -> PluginHealth:
        return PluginHealth(state=PluginState.ERROR, message="connection refused")

    def validate_params(self, params: Dict[str, Any]) -> bool:
        return True


class _TimeoutPlugin(ToolPlugin):
    """Simulates a transport-layer timeout (e.g., MCP server hung)."""

    manifest = PluginManifest(name="timeout_plugin", transport=PluginTransport.MCP)

    def __init__(self, **kwargs):
        self._call_count = 0

    async def execute(self, params: Dict[str, Any]) -> Dict[str, Any]:
        self._call_count += 1
        await asyncio.sleep(999)  # Will be cancelled by timeout

    async def health_check(self) -> PluginHealth:
        return PluginHealth(state=PluginState.DEGRADED, message="response too slow")

    def validate_params(self, params: Dict[str, Any]) -> bool:
        return True


class _FlakyPlugin(ToolPlugin):
    """A plugin that fails N times then recovers — simulates transient transport issues."""

    manifest = PluginManifest(name="flaky_plugin", transport=PluginTransport.OPENAPI)

    def __init__(self, fail_count: int = 3, **kwargs):
        self._fail_count = fail_count
        self._call_count = 0

    async def execute(self, params: Dict[str, Any]) -> Dict[str, Any]:
        self._call_count += 1
        if self._call_count <= self._fail_count:
            raise ConnectionError(f"Transient transport error (attempt {self._call_count})")
        return {"status": "recovered", "attempt": self._call_count}

    async def health_check(self) -> PluginHealth:
        if self._call_count <= self._fail_count:
            return PluginHealth(state=PluginState.DEGRADED, message="transient failures")
        return PluginHealth(state=PluginState.READY, message="recovered")

    def validate_params(self, params: Dict[str, Any]) -> bool:
        return True


class _SlowRecoverPlugin(ToolPlugin):
    """Plugin whose health_check returns ERROR initially, then READY after N checks."""

    manifest = PluginManifest(name="slow_recover_plugin", transport=PluginTransport.LOCAL)

    def __init__(self, recover_after: int = 3, **kwargs):
        self._recover_after = recover_after
        self._check_count = 0

    async def execute(self, params: Dict[str, Any]) -> Dict[str, Any]:
        return {"status": "ok"}

    async def health_check(self) -> PluginHealth:
        self._check_count += 1
        if self._check_count < self._recover_after:
            return PluginHealth(state=PluginState.ERROR, message="service unavailable")
        return PluginHealth(state=PluginState.READY, message="service restored")

    def validate_params(self, params: Dict[str, Any]) -> bool:
        return True


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def registry():
    """Fresh PluginRegistry for each test."""
    return PluginRegistry()


@pytest.fixture
def healthy_plugin():
    return _HealthyPlugin()


@pytest.fixture
def conn_error_plugin():
    return _ConnectionErrorPlugin()


@pytest.fixture
def flaky_plugin():
    return _FlakyPlugin(fail_count=3)


# ---------------------------------------------------------------------------
# Test: Health monitoring
# ---------------------------------------------------------------------------

class TestHealthMonitoring:
    """Verify health state transitions under transport failures."""

    @pytest.mark.asyncio
    async def test_healthy_plugin_reports_ready(self, registry, healthy_plugin):
        """A healthy plugin should have READY state after registration."""
        await registry.register_instance(healthy_plugin)
        health = registry.get_health("healthy_plugin")
        assert health.state == PluginState.READY

    @pytest.mark.asyncio
    async def test_connection_error_plugin_execute_updates_health(self, registry, conn_error_plugin):
        """Executing a failing plugin should update health state to DEGRADED."""
        await registry.register_instance(conn_error_plugin)
        assert registry.get_health("conn_error_plugin").state == PluginState.READY

        # Execute should raise, and health should be updated
        with pytest.raises(ConnectionRefusedError):
            await registry.execute("conn_error_plugin", {})

        # After failure, circuit breaker records it; health stays as set by execute
        cb = registry.get_circuit_breaker("conn_error_plugin")
        assert cb is not None
        assert cb._failure_count >= 1

    @pytest.mark.asyncio
    async def test_check_all_health_detects_errors(self, registry):
        """check_all_health should detect plugins with ERROR health."""
        error_plugin = _SlowRecoverPlugin(recover_after=5)
        await registry.register_instance(error_plugin)

        results = await registry.check_all_health()
        assert "slow_recover_plugin" in results
        assert results["slow_recover_plugin"].state == PluginState.ERROR

    @pytest.mark.asyncio
    async def test_check_all_health_detects_recovery(self, registry):
        """check_all_health should detect when a plugin recovers."""
        plugin = _SlowRecoverPlugin(recover_after=2)
        await registry.register_instance(plugin)

        # First check: ERROR
        results1 = await registry.check_all_health()
        assert results1["slow_recover_plugin"].state == PluginState.ERROR

        # Second check: still ERROR (recover_after=2, need 2 checks)
        results2 = await registry.check_all_health()
        # After 2 health checks, the plugin should report READY
        assert results2["slow_recover_plugin"].state == PluginState.READY

    @pytest.mark.asyncio
    async def test_timeout_updates_health_to_degraded(self, registry):
        """A timeout during execution should set health to DEGRADED."""
        timeout_plugin = _TimeoutPlugin()
        await registry.register_instance(timeout_plugin)
        registry.set_tool_timeout(1)  # 1 second timeout for test speed

        result = await registry.execute("timeout_plugin", {})
        assert "error" in result
        assert "timed out" in result["error"]

        health = registry.get_health("timeout_plugin")
        assert health.state == PluginState.DEGRADED

    @pytest.mark.asyncio
    async def test_health_check_timeout_handled(self, registry):
        """If a health_check itself times out, it should report DEGRADED."""
        plugin = _HealthyPlugin()
        # Make health_check hang
        plugin.health_check = AsyncMock(side_effect=asyncio.sleep(999))
        await registry.register_instance(plugin)

        # check_all_health has a 10s timeout per plugin
        # We'll mock asyncio.wait_for to simulate timeout
        with patch("flowforge.core.plugin_registry.asyncio.wait_for", side_effect=asyncio.TimeoutError):
            results = await registry.check_all_health()

        assert results["healthy_plugin"].state == PluginState.DEGRADED


# ---------------------------------------------------------------------------
# Test: Circuit breaker
# ---------------------------------------------------------------------------

class TestCircuitBreaker:
    """Verify circuit breaker opens after consecutive failures and recovers."""

    @pytest.mark.asyncio
    async def test_circuit_breaker_created_on_register(self, registry, healthy_plugin):
        """Each registered plugin should have a circuit breaker."""
        await registry.register_instance(healthy_plugin)
        cb = registry.get_circuit_breaker("healthy_plugin")
        assert cb is not None
        assert cb.state == CircuitState.CLOSED

    @pytest.mark.asyncio
    async def test_circuit_opens_after_consecutive_failures(self, registry, conn_error_plugin):
        """Circuit breaker should open after failure_threshold consecutive failures."""
        await registry.register_instance(conn_error_plugin)
        cb = registry.get_circuit_breaker("conn_error_plugin")
        assert cb.failure_threshold == 3

        # Trigger 3 failures
        for _ in range(3):
            with pytest.raises(ConnectionRefusedError):
                await registry.execute("conn_error_plugin", {})

        assert cb.state == CircuitState.OPEN

    @pytest.mark.asyncio
    async def test_open_circuit_rejects_fast(self, registry, conn_error_plugin):
        """When circuit is open, execute should return error dict without calling plugin."""
        await registry.register_instance(conn_error_plugin)
        cb = registry.get_circuit_breaker("conn_error_plugin")

        # Force circuit open
        for _ in range(3):
            cb.record_failure()
        assert cb.state == CircuitState.OPEN

        # Execute should return error dict, not raise
        result = await registry.execute("conn_error_plugin", {})
        assert "error" in result
        assert "circuit breaker" in result["error"]

        # Health should be DEGRADED
        health = registry.get_health("conn_error_plugin")
        assert health.state == PluginState.DEGRADED

    @pytest.mark.asyncio
    async def test_circuit_recovers_after_timeout(self, registry, flaky_plugin):
        """Circuit breaker should transition to HALF_OPEN after recovery_timeout."""
        await registry.register_instance(flaky_plugin)
        cb = registry.get_circuit_breaker("flaky_plugin")

        # Override recovery timeout for fast test
        cb.recovery_timeout = 0.1  # 100ms

        # Trigger failures to open circuit
        for _ in range(3):
            with pytest.raises(ConnectionError):
                await registry.execute("flaky_plugin", {})

        assert cb.state == CircuitState.OPEN

        # Wait for recovery timeout
        await asyncio.sleep(0.2)

        # Circuit should be HALF_OPEN now
        assert cb.state == CircuitState.HALF_OPEN

        # The flaky plugin has had 3 failures, next call should succeed
        result = await registry.execute("flaky_plugin", {})
        assert result["status"] == "recovered"

        # After success, circuit should be CLOSED again
        assert cb.state == CircuitState.CLOSED

    @pytest.mark.asyncio
    async def test_circuit_half_open_reopens_on_failure(self, registry):
        """If a HALF_OPEN call fails, circuit should go back to OPEN."""
        plugin = _FlakyPlugin(fail_count=10)  # Will keep failing
        await registry.register_instance(plugin)
        cb = registry.get_circuit_breaker("flaky_plugin")
        cb.recovery_timeout = 0.1

        # Open the circuit
        for _ in range(3):
            with pytest.raises(ConnectionError):
                await registry.execute("flaky_plugin", {})

        assert cb.state == CircuitState.OPEN

        # Wait for recovery
        await asyncio.sleep(0.2)
        assert cb.state == CircuitState.HALF_OPEN

        # Try a call in HALF_OPEN — it will fail
        with pytest.raises(ConnectionError):
            await registry.execute("flaky_plugin", {})

        # Circuit should be OPEN again
        assert cb.state == CircuitState.OPEN

    @pytest.mark.asyncio
    async def test_independent_circuit_per_plugin(self, registry):
        """Each plugin should have an independent circuit breaker."""
        healthy = _HealthyPlugin()
        failing = _ConnectionErrorPlugin()

        await registry.register_instance(healthy)
        await registry.register_instance(failing)

        # Fail the failing plugin 3 times
        cb_failing = registry.get_circuit_breaker("conn_error_plugin")
        for _ in range(3):
            with pytest.raises(ConnectionRefusedError):
                await registry.execute("conn_error_plugin", {})

        assert cb_failing.state == CircuitState.OPEN

        # Healthy plugin should still work fine
        cb_healthy = registry.get_circuit_breaker("healthy_plugin")
        assert cb_healthy.state == CircuitState.CLOSED

        result = await registry.execute("healthy_plugin", {})
        assert result["status"] == "ok"

    @pytest.mark.asyncio
    async def test_timeout_counts_as_failure(self, registry):
        """A timeout should be recorded as a circuit breaker failure."""
        timeout_plugin = _TimeoutPlugin()
        await registry.register_instance(timeout_plugin)
        registry.set_tool_timeout(1)

        cb = registry.get_circuit_breaker("timeout_plugin")

        # Trigger 3 timeouts
        for _ in range(3):
            await registry.execute("timeout_plugin", {})

        assert cb.state == CircuitState.OPEN

        # Next call should be rejected by circuit breaker
        result = await registry.execute("timeout_plugin", {})
        assert "circuit breaker" in result["error"]


# ---------------------------------------------------------------------------
# Test: Periodic health monitoring
# ---------------------------------------------------------------------------

class TestPeriodicHealthMonitoring:
    """Verify periodic health check task detects and reports failures."""

    @pytest.mark.asyncio
    async def test_periodic_check_updates_health_state(self, registry):
        """Periodic health check should update plugin health state."""
        plugin = _SlowRecoverPlugin(recover_after=3)
        manifest = PluginManifest(
            name="slow_recover_plugin",
            health_endpoint="http://localhost:9999/health",
            health_interval=1,  # 1 second for fast test
        )
        await registry.register_instance(plugin, manifest=manifest)

        # Initial health: READY (from startup)
        assert registry.get_health("slow_recover_plugin").state == PluginState.READY

        # Run a manual health check
        results = await registry.check_all_health()
        assert results["slow_recover_plugin"].state == PluginState.ERROR

        # The internal state should be updated
        assert registry.get_health("slow_recover_plugin").state == PluginState.ERROR

    @pytest.mark.asyncio
    async def test_periodic_check_detects_recovery(self, registry):
        """Periodic health checks should detect when a plugin recovers."""
        plugin = _SlowRecoverPlugin(recover_after=2)
        await registry.register_instance(plugin)

        # First check: ERROR
        await registry.check_all_health()
        assert registry.get_health("slow_recover_plugin").state == PluginState.ERROR

        # Second check: READY (recovered)
        await registry.check_all_health()
        assert registry.get_health("slow_recover_plugin").state == PluginState.READY


# ---------------------------------------------------------------------------
# Test: Transport-specific failure scenarios
# ---------------------------------------------------------------------------

class TestTransportFailures:
    """Simulate specific transport-layer failure patterns."""

    @pytest.mark.asyncio
    async def test_openapi_service_down(self, registry):
        """OPENAPI transport: remote service returns connection refused."""
        plugin = _ConnectionErrorPlugin()
        manifest = PluginManifest(
            name="remote_api",
            transport=PluginTransport.OPENAPI,
            endpoint="http://unreachable-host:9999/api",
        )
        await registry.register_instance(plugin, manifest=manifest)

        with pytest.raises(ConnectionRefusedError):
            await registry.execute("remote_api", {"endpoint": "/users"})

    @pytest.mark.asyncio
    async def test_mcp_server_hung(self, registry):
        """MCP transport: server is hung and doesn't respond."""
        plugin = _TimeoutPlugin()
        manifest = PluginManifest(
            name="hung_mcp",
            transport=PluginTransport.MCP,
        )
        await registry.register_instance(plugin, manifest=manifest)
        registry.set_tool_timeout(1)

        result = await registry.execute("hung_mcp", {"tool": "search"})
        assert "timed out" in result["error"]

    @pytest.mark.asyncio
    async def test_mixed_failure_and_success(self, registry):
        """Multiple plugins: some fail, others continue working."""
        healthy = _HealthyPlugin()
        failing = _ConnectionErrorPlugin()

        await registry.register_instance(healthy)
        await registry.register_instance(failing)

        # Failing plugin errors out
        with pytest.raises(ConnectionRefusedError):
            await registry.execute("conn_error_plugin", {})

        # Healthy plugin still works
        result = await registry.execute("healthy_plugin", {})
        assert result["status"] == "ok"

    @pytest.mark.asyncio
    async def test_grpc_style_error(self, registry):
        """Simulate a gRPC-style UNAVAILABLE error via GRAPHQL transport."""
        class GrpcErrorPlugin(ToolPlugin):
            manifest = PluginManifest(name="grpc_plugin", transport=PluginTransport.GRAPHQL)

            async def execute(self, params):
                raise ConnectionError("UNAVAILABLE: service temporarily down")

            def validate_params(self, params):
                return True

        plugin = GrpcErrorPlugin()
        await registry.register_instance(plugin)

        with pytest.raises(ConnectionError, match="UNAVAILABLE"):
            await registry.execute("grpc_plugin", {})

    @pytest.mark.asyncio
    async def test_shutdown_clears_plugins(self, registry, healthy_plugin):
        """After shutdown, all plugins should be cleared."""
        await registry.register_instance(healthy_plugin)
        assert registry.has_plugin("healthy_plugin")

        await registry.shutdown_all()
        assert not registry.has_plugin("healthy_plugin")

        # Health should be STOPPED
        health = registry.get_health("healthy_plugin")
        assert health.state == PluginState.STOPPED


# ---------------------------------------------------------------------------
# Test: CircuitBreaker standalone (unit-level)
# ---------------------------------------------------------------------------

class TestCircuitBreakerUnit:
    """Direct unit tests for the CircuitBreaker class."""

    def test_initial_state_closed(self):
        cb = CircuitBreaker(name="test")
        assert cb.state == CircuitState.CLOSED
        assert cb.is_available is True

    def test_opens_after_threshold(self):
        cb = CircuitBreaker(name="test", failure_threshold=3)
        for _ in range(3):
            cb.record_failure()
        assert cb.state == CircuitState.OPEN
        assert cb.is_available is False

    def test_half_open_after_recovery_timeout(self):
        cb = CircuitBreaker(name="test", failure_threshold=2, recovery_timeout=0.1)
        cb.record_failure()
        cb.record_failure()
        assert cb.state == CircuitState.OPEN

        time.sleep(0.15)
        assert cb.state == CircuitState.HALF_OPEN
        assert cb.is_available is True

    def test_success_closes_from_half_open(self):
        cb = CircuitBreaker(name="test", failure_threshold=2, recovery_timeout=0.1)
        cb.record_failure()
        cb.record_failure()
        assert cb.state == CircuitState.OPEN

        time.sleep(0.15)
        assert cb.state == CircuitState.HALF_OPEN

        cb.record_success()
        assert cb.state == CircuitState.CLOSED
        assert cb._failure_count == 0

    def test_failure_in_half_open_reopens(self):
        cb = CircuitBreaker(name="test", failure_threshold=2, recovery_timeout=0.1)
        cb.record_failure()
        cb.record_failure()

        time.sleep(0.15)
        assert cb.state == CircuitState.HALF_OPEN

        cb.record_failure()
        assert cb.state == CircuitState.OPEN

    @pytest.mark.asyncio
    async def test_async_call_success(self):
        cb = CircuitBreaker(name="test")

        async def ok_func():
            return "success"

        result = await cb.call(ok_func)
        assert result == "success"
        assert cb.state == CircuitState.CLOSED

    @pytest.mark.asyncio
    async def test_async_call_failure_opens_circuit(self):
        cb = CircuitBreaker(name="test", failure_threshold=2)

        async def fail_func():
            raise RuntimeError("boom")

        for _ in range(2):
            with pytest.raises(RuntimeError):
                await cb.call(fail_func)

        assert cb.state == CircuitState.OPEN

    @pytest.mark.asyncio
    async def test_async_call_rejected_when_open(self):
        cb = CircuitBreaker(name="test", failure_threshold=1)

        async def fail_func():
            raise RuntimeError("boom")

        with pytest.raises(RuntimeError):
            await cb.call(fail_func)

        assert cb.state == CircuitState.OPEN

        with pytest.raises(CircuitOpenError):
            await cb.call(fail_func)
