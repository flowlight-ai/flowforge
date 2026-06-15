"""Cross-project event bus bridge for FlowForge ecosystem.

Provides the EventBridge class that connects independent project event
systems to the central FlowForge EventBus, enabling cross-project event
propagation with filtering, transformation, and routing.

Design principles:
- FlowForge EventBus is the *main* bus
- *Forge projects bridge their local events into the main bus
- Bridge is opt-in: projects that don't need cross-project events are unaffected
- Supports event prefixing, filtering, type mapping, and bidirectional bridging
"""

from __future__ import annotations

import asyncio
import fnmatch
import logging
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Union

from flowforge.events.event_bus import EventBus
from flowforge.core.tracing import get_logger

logger = get_logger("events.bridge")


@dataclass
class BridgeConfig:
    """Configuration for a single project's event bridge.

    Attributes:
        event_prefix: Prefix prepended to event types when forwarding
            to the main bus.  E.g. ``"novelforge."`` turns a local
            ``"novel.created"`` into ``"novelforge.novel.created"``.
        event_filter: Optional whitelist of local event types to forward.
            If ``None``, all events are forwarded.
        event_transform: Optional mapping from local event type to
            main-bus event type.  Applied *after* prefixing.
        bidirectional: If ``True``, events from the main bus that match
            ``{event_prefix}*`` are also forwarded back to the project's
            local bus.
    """

    event_prefix: str = ""
    event_filter: Optional[List[str]] = None
    event_transform: Optional[Dict[str, str]] = None
    bidirectional: bool = False


class EventBridge:
    """Cross-project event bus bridge layer.

    Registers *Forge projects as event sources and forwards their local
    events to the central FlowForge EventBus.  Also supports subscribing
    to events across projects with wildcard patterns.

    Usage::

        from flowforge.events.bridge import EventBridge, BridgeConfig
        from flowforge.events.event_bus import EventBus

        main_bus = EventBus()
        bridge = EventBridge(main_bus)

        # Register a project with its local bus
        bridge.register_project(
            "novelforge",
            local_bus,
            BridgeConfig(event_prefix="novelforge.", bidirectional=True),
        )

        # Subscribe to events from any project
        bridge.subscribe_cross_project("novelforge.novel.*", my_handler)

        # Manually forward an event
        await bridge.forward_event("novelforge", "novel.created", {"title": "..."})
    """

    def __init__(self, main_bus: EventBus) -> None:
        self._main_bus: EventBus = main_bus
        self._bridges: Dict[str, _ProjectBridge] = {}
        self._cross_subscribers: List[_CrossSubscription] = []

    # ── Project registration ──────────────────────────────────────────

    def register_project(
        self,
        project_name: str,
        local_bus_or_callback: Union[EventBus, Callable[[dict], None], None] = None,
        config: Optional[BridgeConfig] = None,
    ) -> None:
        """Register a project's event source into the bridge.

        Args:
            project_name: Unique project identifier (e.g. ``"novelforge"``).
            local_bus_or_callback: One of:
                - An ``EventBus`` instance whose ``emit`` calls will be
                  intercepted and forwarded.
                - A callable that the project calls manually to push events.
                - ``None`` if the project only uses ``forward_event()``.
            config: Bridge configuration.  Defaults to a prefix based on
                *project_name* if not provided.
        """
        if config is None:
            config = BridgeConfig(event_prefix=f"{project_name}.")

        bridge = _ProjectBridge(
            project_name=project_name,
            main_bus=self._main_bus,
            local_bus=local_bus_or_callback if isinstance(local_bus_or_callback, EventBus) else None,
            callback=local_bus_or_callback if callable(local_bus_or_callback) and not isinstance(local_bus_or_callback, EventBus) else None,
            config=config,
        )
        self._bridges[project_name] = bridge

        # If bidirectional, subscribe to main bus events matching the prefix
        if config.bidirectional and bridge._local_bus is not None:
            self._main_bus.subscribe("*", bridge._on_main_bus_event_ref)

        logger.info(
            f"EventBridge: registered project '{project_name}' "
            f"(prefix='{config.event_prefix}', bidirectional={config.bidirectional})"
        )

    def unregister_project(self, project_name: str) -> None:
        """Remove a project from the bridge.

        Args:
            project_name: The project identifier to unregister.
        """
        bridge = self._bridges.pop(project_name, None)
        if bridge is not None and bridge._config.bidirectional and bridge._local_bus is not None:
            self._main_bus.unsubscribe("*", bridge._on_main_bus_event_ref)
            logger.info(f"EventBridge: unregistered project '{project_name}'")

    # ── Event forwarding ──────────────────────────────────────────────

    async def forward_event(
        self,
        project_name: str,
        event_type: str,
        data: dict,
        task_id: str = "",
    ) -> None:
        """Forward a project event to the main bus.

        Applies the project's BridgeConfig (prefix, filter, transform)
        before emitting on the main bus.

        Args:
            project_name: Source project identifier.
            event_type: Local event type.
            data: Event payload.
            task_id: Optional task identifier.
        """
        bridge = self._bridges.get(project_name)
        if bridge is None:
            logger.warning(f"EventBridge: unknown project '{project_name}', dropping event")
            return

        # Apply filter
        if not bridge.should_forward(event_type):
            return

        # Compute target event type
        target_type = bridge.transform_event_type(event_type)

        # Build payload with source metadata
        # Preserve any existing _forwarded_from chain from bidirectional
        # re-forwarding to maintain the full origin trail
        forwarded_from = list(data.get("_forwarded_from", [])) if "_forwarded_from" in data else []
        payload = {
            **data,
            "_source_project": project_name,
            "_original_type": event_type,
        }
        if forwarded_from:
            payload["_forwarded_from"] = forwarded_from

        self._main_bus.emit(task_id=task_id, event_type=target_type, payload=payload)
        logger.debug(
            f"EventBridge: forwarded '{event_type}' -> '{target_type}' "
            f"from '{project_name}'"
        )

    # ── Cross-project subscription ────────────────────────────────────

    def subscribe_cross_project(
        self,
        event_pattern: str,
        handler: Callable[[dict], Any],
    ) -> None:
        """Subscribe to events across projects using a wildcard pattern.

        The pattern supports ``*`` (matches any single segment) and
        ``**`` (matches zero or more segments) via :mod:`fnmatch`.

        Args:
            event_pattern: Glob-style event type pattern, e.g.
                ``"novelforge.*"`` or ``"*.task.completed"``.
            handler: Callback invoked with the event dict.
        """
        sub = _CrossSubscription(pattern=event_pattern, handler=handler)
        self._cross_subscribers.append(sub)

        # Also subscribe on the main bus with a filter
        def _filter_fn(event: dict) -> bool:
            return fnmatch.fnmatch(event.get("type", ""), event_pattern)

        self._main_bus.subscribe("*", handler, filter=_filter_fn)
        logger.info(f"EventBridge: cross-project subscription for '{event_pattern}'")

    def unsubscribe_cross_project(
        self,
        event_pattern: str,
        handler: Callable[[dict], Any],
    ) -> None:
        """Remove a cross-project subscription.

        Args:
            event_pattern: The pattern that was used to subscribe.
            handler: The handler to remove.
        """
        self._cross_subscribers = [
            s for s in self._cross_subscribers
            if not (s.pattern == event_pattern and s.handler is handler)
        ]
        self._main_bus.unsubscribe("*", handler)
        logger.info(f"EventBridge: removed cross-project subscription for '{event_pattern}'")

    # ── Query ─────────────────────────────────────────────────────────

    def list_registered_projects(self) -> List[str]:
        """Return names of all registered projects."""
        return list(self._bridges.keys())

    def get_project_config(self, project_name: str) -> Optional[BridgeConfig]:
        """Return the BridgeConfig for a project, or ``None``."""
        bridge = self._bridges.get(project_name)
        return bridge._config if bridge is not None else None


class _ProjectBridge:
    """Internal helper: one per registered project."""

    def __init__(
        self,
        project_name: str,
        main_bus: EventBus,
        local_bus: Optional[EventBus],
        callback: Optional[Callable[[dict], Any]],
        config: BridgeConfig,
    ) -> None:
        self._project_name = project_name
        self._main_bus = main_bus
        self._local_bus = local_bus
        self._callback = callback
        self._config = config
        # Cache the bound method so unregister can match by identity.
        # Python creates a new bound method object on each attribute access,
        # so ``self.on_main_bus_event is self.on_main_bus_event`` is False.
        self._on_main_bus_event_ref = self.on_main_bus_event

    def should_forward(self, event_type: str) -> bool:
        """Check whether this event type passes the filter."""
        if self._config.event_filter is None:
            return True
        return event_type in self._config.event_filter

    def transform_event_type(self, event_type: str) -> str:
        """Apply prefix and transform to get the main-bus event type."""
        result = event_type
        # Apply prefix
        if self._config.event_prefix:
            result = f"{self._config.event_prefix}{result}"
        # Apply type mapping (on the prefixed result)
        if self._config.event_transform and result in self._config.event_transform:
            result = self._config.event_transform[result]
        return result

    def on_main_bus_event(self, event: dict) -> None:
        """Handle events from the main bus for bidirectional bridging.

        Only forwards events whose type starts with this project's prefix
        back to the local bus, stripping the prefix.

        Anti-loop protection:
        1. Skip events where ``_source_project`` matches this project
           (prevents direct echo loop).
        2. Skip events where ``_forwarded_from`` contains this project
           (prevents multi-hop circular forwarding: A→B→C→A).
        3. Preserve origin info as ``_forwarded_from`` in the local payload
           so downstream handlers can detect and break potential loops.
        """
        if self._local_bus is None:
            return

        event_type = event.get("type", "")
        prefix = self._config.event_prefix
        if not prefix or not event_type.startswith(prefix):
            return

        # Strip prefix to get local event type
        local_type = event_type[len(prefix):]

        payload = event.get("payload", {})

        # Don't re-forward events that originated from this project
        source = payload.get("_source_project")
        if source == self._project_name:
            return

        # Don't re-forward events that have already been forwarded through
        # this project (multi-hop circular loop prevention: A→B→C→A)
        forwarded_from = payload.get("_forwarded_from", [])
        if self._project_name in forwarded_from:
            return

        # Build local payload: strip internal metadata but preserve
        # origin chain for loop detection
        local_payload = {
            k: v for k, v in payload.items()
            if not k.startswith("_")
        }
        # Preserve forwarding chain for downstream loop detection
        new_forwarded_from = list(forwarded_from)
        if source:
            new_forwarded_from.append(source)
        if new_forwarded_from:
            local_payload["_forwarded_from"] = new_forwarded_from

        self._local_bus.emit(
            task_id=event.get("task_id", ""),
            event_type=local_type,
            payload=local_payload,
        )
        logger.debug(
            f"EventBridge: bidirectional '{event_type}' -> '{local_type}' "
            f"to '{self._project_name}' local bus"
        )


@dataclass
class _CrossSubscription:
    """Internal record for a cross-project subscription."""

    pattern: str
    handler: Callable[[dict], Any]
