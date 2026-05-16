"""Publish-subscribe event bus for FlowForge task lifecycle events.

Provides a lightweight, synchronous event bus that supports both sync and
async callbacks.  Events are dispatched immediately upon emission; async
callbacks are scheduled via ``asyncio.ensure_future`` so they do not block
the emitter.

License: MIT
"""

import asyncio
import logging
from typing import Callable, Dict, List
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

class EventBus:
    """Simple in-memory publish-subscribe event bus.

    Subscribers register callbacks for specific event types (or the wildcard
    ``"*"`` to receive all events).  When an event is emitted, all matching
    callbacks are invoked.  If a callback returns a coroutine, it is
    automatically scheduled on the event loop.

    Attributes:
        _subscribers: Mapping from event type to list of callback functions.
    """

    def __init__(self):
        """Initialize the EventBus with an empty subscriber map."""
        self._subscribers: Dict[str, List[Callable]] = {}

    def subscribe(self, event_type: str, callback: Callable):
        """Register a callback for a given event type.

        Args:
            event_type: The event type to listen for.  Use ``"*"`` to
                subscribe to all events.
            callback: A callable that accepts a single ``event`` dict
                argument.  May be a coroutine function.
        """
        self._subscribers.setdefault(event_type, []).append(callback)

    def emit(self, task_id: str, event_type: str, payload: dict):
        """Emit an event to all matching subscribers.

        The event dict is constructed with ``type``, ``payload``,
        ``task_id``, and ``timestamp`` fields.  Subscribers for the
        specific event type and for the wildcard ``"*"`` are both notified.

        Args:
            task_id: The task identifier associated with the event.
            event_type: The categorization string for the event.
            payload: Arbitrary data carried by the event.
        """
        event = {
            "type": event_type,
            "payload": payload,
            "task_id": task_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        for cb in self._subscribers.get(event_type, []):
            try:
                result = cb(event)
                if asyncio.iscoroutine(result):
                    asyncio.ensure_future(result)
            except Exception:
                logger.exception(f"Event callback error for {event_type}")
        for cb in self._subscribers.get('*', []):
            try:
                result = cb(event)
                if asyncio.iscoroutine(result):
                    asyncio.ensure_future(result)
            except Exception:
                logger.exception(f"Event callback error for {event_type}")
