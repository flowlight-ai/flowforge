"""Plugin Sandbox — isolates plugin execution with resource limits and permissions.

Provides two levels of isolation:
1. Coroutine-level: asyncio timeout and exception isolation
2. Permission model: restrict what plugins can access

Also provides per-plugin sandbox instances managed by SandboxManager,
with execution tracking, audit logging, and safety-level-based permission sets.

Note: Process-level isolation (subprocess) is not implemented in this phase.
Full process isolation would require IPC and is planned for a future release.
"""

import asyncio
import time
from collections.abc import Callable
from typing import Any

from flowforge.core.plugin_protocol import PluginManifest
from flowforge.core.tracing import get_logger

logger = get_logger("plugin_sandbox")


# ── Permission constants ────────────────────────────────────────────

class Permission:
    """Plugin permission constants."""
    NETWORK = "network"
    FILESYSTEM = "filesystem"
    DATABASE = "database"
    SUBPROCESS = "subprocess"
    ENVIRONMENT = "environment"


ALL_PERMISSIONS: set[str] = {
    Permission.NETWORK, Permission.FILESYSTEM,
    Permission.DATABASE, Permission.SUBPROCESS,
    Permission.ENVIRONMENT,
}

# Default permission sets per safety level
SAFETY_PERMISSIONS: dict[str, set[str]] = {
    "readonly": set(),  # No permissions needed
    "normal": {Permission.NETWORK, Permission.FILESYSTEM},
    "dangerous": ALL_PERMISSIONS,
}


# ── Exceptions ──────────────────────────────────────────────────────

class SandboxViolation(Exception):
    """Raised when a plugin attempts an action beyond its permissions."""
    pass


# ── Legacy shared sandbox (backward compatible) ────────────────────

class SandboxConfig:
    """Configuration for plugin sandbox."""

    def __init__(
        self,
        allowed_permissions: set[str] | None = None,
        max_execution_time: float = 300.0,
        max_memory_mb: int = 512,
        allowed_domains: set[str] | None = None,
        denied_paths: set[str] | None = None,
    ):
        self.allowed_permissions: set[str] = (
            allowed_permissions if allowed_permissions is not None
            else {Permission.NETWORK, Permission.FILESYSTEM}
        )
        self.max_execution_time = max_execution_time
        self.max_memory_mb = max_memory_mb
        self.allowed_domains = allowed_domains or set()
        self.denied_paths = denied_paths or set()


class PluginSandbox:
    """Executes plugin code in an isolated environment.

    Coroutine-level isolation:
    - Execution time limits via asyncio.wait_for
    - Exception isolation (catches and reports errors)
    - Permission checking before sensitive operations

    Supports two usage patterns:
    1. **Shared sandbox** (legacy): single instance with SandboxConfig
    2. **Per-plugin sandbox** (new): created via SandboxManager, tied to
       a specific plugin name and manifest
    """

    def __init__(self, config: SandboxConfig | None = None):
        self._config = config or SandboxConfig()
        self._audit_log: list[dict] = []

        # Per-plugin sandbox fields (used when created via SandboxManager)
        self._plugin_name: str = ""
        self._manifest: PluginManifest | None = None
        self._timeout_seconds: int = 300
        self._execution_count: int = 0
        self._total_execution_time: float = 0.0
        self._last_execution_time: float = 0.0

    @property
    def config(self) -> SandboxConfig:
        return self._config

    @property
    def plugin_name(self) -> str:
        return self._plugin_name

    @property
    def permissions(self) -> set[str]:
        return self._config.allowed_permissions

    def check_permission(self, plugin_name: str, permission: str) -> bool:
        """Check if a plugin has a specific permission.

        Args:
            plugin_name: Name of the plugin requesting the permission.
            permission: Permission string (e.g., Permission.NETWORK).

        Returns:
            True if the permission is granted, False otherwise.
        """
        allowed = permission in self._config.allowed_permissions
        if not allowed:
            self._audit_log.append({
                "plugin": plugin_name,
                "permission": permission,
                "granted": False,
                "action": "permission_denied",
            })
            logger.warning(f"[sandbox] Permission denied: {plugin_name} requested {permission}")
        return allowed

    def require_permission(self, permission: str) -> None:
        """Require a permission or raise SandboxViolation.

        Uses the per-plugin sandbox's plugin_name for the error message.
        For shared sandbox usage, use check_permission() instead.
        """
        name = self._plugin_name or "unknown"
        if permission not in self._config.allowed_permissions:
            self._audit_log.append({
                "plugin": name,
                "permission": permission,
                "granted": False,
                "action": "permission_required_denied",
            })
            raise SandboxViolation(
                f"Plugin '{name}' requires permission '{permission}' "
                f"but only has {self._config.allowed_permissions}"
            )

    async def execute(self, plugin_name: str, func: Callable, *args, **kwargs) -> Any:
        """Execute a function in the sandbox with time limits.

        Args:
            plugin_name: Name of the plugin executing.
            func: Async callable to execute.
            *args, **kwargs: Arguments to pass to the function.

        Returns:
            Result of the function call.

        Raises:
            TimeoutError: If execution exceeds max_execution_time.
            PermissionError: If the function requires a permission not granted.
        """
        try:
            result = await asyncio.wait_for(
                func(*args, **kwargs),
                timeout=self._config.max_execution_time,
            )
            return result
        except TimeoutError:
            logger.error(
                f"[sandbox] Plugin {plugin_name} timed out "
                f"after {self._config.max_execution_time}s"
            )
            raise TimeoutError(
                f"Plugin {plugin_name} execution timed out"
            )
        except Exception as e:
            logger.error(f"[sandbox] Plugin {plugin_name} execution failed: {e}")
            raise

    async def execute_with_timeout(
        self, coro, timeout: int | None = None,
    ) -> Any:
        """Execute a coroutine with timeout and resource tracking.

        This method is for per-plugin sandbox instances created by
        SandboxManager. It tracks execution count and timing.

        Args:
            coro: Coroutine to execute.
            timeout: Override timeout in seconds.

        Returns:
            Result of the coroutine.

        Raises:
            asyncio.TimeoutError: If execution exceeds timeout.
        """
        timeout = timeout or self._timeout_seconds
        start = time.time()
        self._execution_count += 1

        try:
            result = await asyncio.wait_for(coro, timeout=timeout)
            elapsed = time.time() - start
            self._total_execution_time += elapsed
            self._last_execution_time = elapsed
            self._audit(
                "execution_success",
                duration_ms=int(elapsed * 1000),
            )
            return result
        except TimeoutError:
            elapsed = time.time() - start
            self._total_execution_time += elapsed
            self._audit(
                "execution_timeout",
                duration_ms=int(elapsed * 1000),
                timeout=timeout,
            )
            raise
        except Exception as e:
            elapsed = time.time() - start
            self._total_execution_time += elapsed
            self._audit(
                "execution_error",
                duration_ms=int(elapsed * 1000),
                error=str(e),
            )
            raise

    def _audit(self, action: str, **kwargs) -> None:
        """Record an audit log entry."""
        entry = {
            "plugin": self._plugin_name,
            "action": action,
            "timestamp": time.time(),
            **kwargs,
        }
        self._audit_log.append(entry)
        logger.debug(f"[sandbox:{self._plugin_name}] {action}: {kwargs}")

    def get_audit_log(self, plugin_name: str | None = None) -> list[dict]:
        """Get audit log entries, optionally filtered by plugin name."""
        if plugin_name:
            return [e for e in self._audit_log if e.get("plugin") == plugin_name]
        return list(self._audit_log)

    def clear_audit_log(self):
        """Clear the audit log."""
        self._audit_log.clear()

    def get_stats(self) -> dict[str, Any]:
        """Return sandbox statistics."""
        return {
            "plugin": self._plugin_name,
            "permissions": list(self._config.allowed_permissions),
            "execution_count": self._execution_count,
            "total_execution_time_ms": int(self._total_execution_time * 1000),
            "last_execution_time_ms": int(self._last_execution_time * 1000),
            "audit_entries": len(self._audit_log),
            "timeout_seconds": self._timeout_seconds,
        }


# ── Per-plugin sandbox factory ──────────────────────────────────────

def create_plugin_sandbox(
    plugin_name: str,
    manifest: PluginManifest,
    permissions: set[str] | None = None,
    timeout_seconds: int = 300,
    max_memory_mb: int = 512,
) -> PluginSandbox:
    """Create a per-plugin sandbox instance.

    Derives permissions from the manifest's safety_level if not explicitly
    provided.
    """
    if permissions is None:
        permissions = SAFETY_PERMISSIONS.get(manifest.safety_level, set())

    config = SandboxConfig(
        allowed_permissions=permissions,
        max_execution_time=float(timeout_seconds),
        max_memory_mb=max_memory_mb,
    )
    sandbox = PluginSandbox(config)
    sandbox._plugin_name = plugin_name
    sandbox._manifest = manifest
    sandbox._timeout_seconds = timeout_seconds
    return sandbox


# ── Sandbox Manager ─────────────────────────────────────────────────

class SandboxManager:
    """Manages sandboxes for all loaded plugins."""

    def __init__(self, default_timeout: int = 300):
        self._sandboxes: dict[str, PluginSandbox] = {}
        self._default_timeout = default_timeout

    def create_sandbox(self, plugin_name: str, manifest: PluginManifest) -> PluginSandbox:
        """Create a sandbox for a plugin."""
        sandbox = create_plugin_sandbox(
            plugin_name=plugin_name,
            manifest=manifest,
            timeout_seconds=self._default_timeout,
        )
        self._sandboxes[plugin_name] = sandbox
        logger.info(
            f"[sandbox] Created sandbox for '{plugin_name}' "
            f"with permissions: {sandbox.permissions}"
        )
        return sandbox

    def get_sandbox(self, plugin_name: str) -> PluginSandbox | None:
        """Get the sandbox for a plugin, or None."""
        return self._sandboxes.get(plugin_name)

    def remove_sandbox(self, plugin_name: str) -> None:
        """Remove a plugin's sandbox."""
        if plugin_name in self._sandboxes:
            del self._sandboxes[plugin_name]

    def list_sandboxes(self) -> list[dict[str, Any]]:
        """Return stats for all managed sandboxes."""
        return [s.get_stats() for s in self._sandboxes.values()]
