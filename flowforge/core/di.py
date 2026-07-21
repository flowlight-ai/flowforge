"""Minimal DI container with lifecycle management.

Design goals:
- Constructor injection only — no service locator pattern at call sites
- Lifecycle: singleton (default) / transient / scoped
- Async-aware: async factories supported via register_async_factory
- Idempotent: registering the same key twice raises (avoids shadowing bugs)
"""

from __future__ import annotations

import inspect
from enum import Enum
from typing import Any, Awaitable, Callable, TypeVar

from flowforge.core.errors import FlowForgeError
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.di")

T = TypeVar("T")


class Lifecycle(str, Enum):
    SINGLETON = "singleton"
    TRANSIENT = "transient"
    SCOPED = "scoped"


class DIError(FlowForgeError):
    """Dependency registration or resolution failed."""


class Container:
    """Inversion-of-control container.

    Usage:
        container = Container()
        container.register(LLMClient, factory=lambda: LLMClient(...))
        client = container.resolve(LLMClient)
    """

    def __init__(self) -> None:
        self._factories: dict[type, Callable[..., Any]] = {}
        self._async_factories: dict[type, Callable[..., Awaitable[Any]]] = {}
        self._lifecycles: dict[type, Lifecycle] = {}
        self._singletons: dict[type, Any] = {}
        self._resolving: set[type] = set()  # cycle detection

    def register(
        self,
        key: type,
        factory: Callable[..., T],
        lifecycle: Lifecycle = Lifecycle.SINGLETON,
    ) -> None:
        if key in self._factories or key in self._async_factories:
            raise DIError(f"Dependency {key!r} already registered")
        self._factories[key] = factory
        self._lifecycles[key] = lifecycle
        logger.debug(f"DI registered: {key.__name__} ({lifecycle.value})")

    def register_async(
        self,
        key: type,
        factory: Callable[..., Awaitable[T]],
        lifecycle: Lifecycle = Lifecycle.SINGLETON,
    ) -> None:
        if key in self._factories or key in self._async_factories:
            raise DIError(f"Dependency {key!r} already registered")
        self._async_factories[key] = factory
        self._lifecycles[key] = lifecycle
        logger.debug(f"DI registered (async): {key.__name__} ({lifecycle.value})")

    def register_instance(self, key: type, instance: T) -> None:
        """Pre-populate a singleton with an already-built instance."""
        self._singletons[key] = instance
        self._lifecycles[key] = Lifecycle.SINGLETON
        logger.debug(f"DI instance registered: {key.__name__}")

    def resolve(self, key: type) -> Any:
        if key in self._singletons:
            return self._singletons[key]
        if key not in self._factories:
            raise DIError(f"Dependency {key!r} not registered")
        if key in self._resolving:
            raise DIError(f"Circular dependency detected resolving {key!r}")
        self._resolving.add(key)
        try:
            instance = self._factories[key]()
        finally:
            self._resolving.discard(key)
        if self._lifecycles[key] == Lifecycle.SINGLETON:
            self._singletons[key] = instance
        return instance

    async def resolve_async(self, key: type) -> Any:
        if key in self._singletons:
            return self._singletons[key]
        if key in self._async_factories:
            if key in self._resolving:
                raise DIError(f"Circular dependency detected resolving {key!r}")
            self._resolving.add(key)
            try:
                instance = await self._async_factories[key]()
            finally:
                self._resolving.discard(key)
            if self._lifecycles[key] == Lifecycle.SINGLETON:
                self._singletons[key] = instance
            return instance
        # Fall back to sync resolve (may return a coroutine if factory is async)
        result = self.resolve(key)
        if inspect.isawaitable(result):
            return await result
        return result

    def has(self, key: type) -> bool:
        return key in self._factories or key in self._async_factories or key in self._singletons

    def clear(self) -> None:
        """Drop all registrations and singleton instances (mainly for tests)."""
        self._factories.clear()
        self._async_factories.clear()
        self._lifecycles.clear()
        self._singletons.clear()
        self._resolving.clear()


# Process-wide default container (tests may swap via set_container)
_default_container: Container | None = None


def get_container() -> Container:
    global _default_container
    if _default_container is None:
        _default_container = Container()
    return _default_container


def set_container(container: Container | None) -> None:
    """Override the default container (used by tests for isolation)."""
    global _default_container
    _default_container = container
