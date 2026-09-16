"""Event bus bridge for cross-project event forwarding.

Provides a simple bridge that connects FlowForge's EventBus with
a peer project's event system, allowing events to flow between projects.

Usage:
    from flowforge.core.event_bridge import EventBusBridge

    bridge = EventBusBridge(flowforge_bus=ff_bus, peer_bus=peer_bus)
    bridge.start()

    # Events emitted on either bus with the bridged event types
    # will be automatically forwarded to the other bus.

    bridge.stop()
"""

import asyncio
from typing import Dict, List, Optional, Set

from flowforge.events.event_bus import EventBus
from flowforge.core.tracing import get_logger

logger = get_logger("event_bridge")

# Default event types to bridge between projects
DEFAULT_BRIDGED_EVENTS: Set[str] = {
    "task.created",
    "task.completed",
    "task.failed",
    "task.cancelled",
    "model.health_changed",
    "model.failover",
    "workflow.stage_enter",
    "workflow.stage_done",
}


class EventBusBridge:
    """Bridge between FlowForge EventBus and a peer project's event system.

    Subscribes to specified event types on both buses and forwards
    events from one to the other, enabling cross-project communication.

    Attributes:
        _ff_bus: FlowForge EventBus instance.
        _peer_bus: Peer project EventBus instance (or another EventBus).
        _bridged_types: Set of event types to bridge.
        _forwarding: Whether the bridge is currently active.
    """

    def __init__(
        self,
        flowforge_bus: EventBus,
        peer_bus: Optional[EventBus] = None,
        bridged_types: Optional[Set[str]] = None,
    ):
        self._ff_bus = flowforge_bus
        self._peer_bus = peer_bus
        self._bridged_types = bridged_types or DEFAULT_BRIDGED_EVENTS
        self._forwarding = False

    def start(self) -> None:
        """Start bridging events between the two buses."""
        if self._forwarding:
            return
        self._forwarding = True

        # Subscribe on FlowForge bus -> forward to peer
        for event_type in self._bridged_types:
            self._ff_bus.subscribe(
                event_type,
                self._make_ff_to_peer_handler(event_type),
            )

        # Subscribe on peer bus -> forward to FlowForge
        if self._peer_bus is not None:
            for event_type in self._bridged_types:
                self._peer_bus.subscribe(
                    event_type,
                    self._make_peer_to_ff_handler(event_type),
                )

        logger.info(
            f"EventBusBridge started: {len(self._bridged_types)} event types bridged"
        )

    def stop(self) -> None:
        """Stop bridging events.

        Note: EventBus does not support bulk unsubscription easily,
        so this sets a flag that prevents forwarding.
        """
        self._forwarding = False
        logger.info("EventBusBridge stopped")

    def add_bridged_type(self, event_type: str) -> None:
        """Add an event type to the bridge at runtime."""
        if event_type in self._bridged_types:
            return
        self._bridged_types.add(event_type)
        self._ff_bus.subscribe(event_type, self._make_ff_to_peer_handler(event_type))
        if self._peer_bus is not None:
            self._peer_bus.subscribe(event_type, self._make_peer_to_ff_handler(event_type))
        logger.info(f"EventBusBridge: added bridged type '{event_type}'")

    @property
    def bridged_types(self) -> Set[str]:
        """Return the set of currently bridged event types."""
        return set(self._bridged_types)

    @property
    def is_running(self) -> bool:
        """Return whether the bridge is currently active."""
        return self._forwarding

    def _make_ff_to_peer_handler(self, event_type: str):
        """Create a handler that forwards events from FF bus to peer bus."""
        def handler(event: dict):
            if not self._forwarding or self._peer_bus is None:
                return
            try:
                self._peer_bus.emit(
                    task_id=event.get("task_id", ""),
                    event_type=event_type,
                    payload={
                        **event.get("payload", {}),
                        "_source": "flowforge",
                        "_bridged": True,
                    },
                )
            except Exception as e:
                logger.warning(f"Bridge FF->peer error for '{event_type}': {e}")
        return handler

    def _make_peer_to_ff_handler(self, event_type: str):
        """Create a handler that forwards events from peer bus to FF bus."""
        def handler(event: dict):
            if not self._forwarding:
                return
            try:
                self._ff_bus.emit(
                    task_id=event.get("task_id", ""),
                    event_type=event_type,
                    payload={
                        **event.get("payload", {}),
                        "_source": "peer",
                        "_bridged": True,
                    },
                )
            except Exception as e:
                logger.warning(f"Bridge peer->FF error for '{event_type}': {e}")
        return handler
