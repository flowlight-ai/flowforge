"""Publish-subscribe event bus for FlowForge task lifecycle events.

Provides a lightweight, synchronous event bus that supports both sync and
async callbacks.  Events are dispatched immediately upon emission; async
callbacks are scheduled via ``asyncio.ensure_future`` so they do not block
the emitter.

Enhanced features:
- **Request-response pattern**: ``request(event_type, payload, timeout)`` sends
  an event and waits for a single responder to return a value via
  ``respond(event_type, handler)``.
- **Event filtering**: ``subscribe(event_type, handler, filter=fn)`` only
  invokes the handler when ``filter(event)`` returns ``True``.
- **Domain event naming**: use ``domain.action`` format, e.g.
  ``task.completed``, ``tool.start``, ``plugin.loaded``.

License: MIT
"""

import asyncio
import logging
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

logger = logging.getLogger(__name__)

class EventBus:
    """Simple in-memory publish-subscribe event bus.

    Subscribers register callbacks for specific event types (or the wildcard
    ``"*"`` to receive all events).  When an event is emitted, all matching
    callbacks are invoked.  If a callback returns a coroutine, it is
    automatically scheduled on the event loop.

    Attributes:
        _subscribers: Mapping from event type to list of (callback, filter) tuples.
    """

    def __init__(self):
        """Initialize the EventBus with an empty subscriber map."""
        self._subscribers: dict[str, list[tuple]] = {}
        # Request-response support
        self._response_handlers: dict[str, asyncio.Future] = {}

    def subscribe(
        self,
        event_type: str,
        callback: Callable,
        filter: Callable[[dict], bool] | None = None,
    ):
        """Register a callback for a given event type.

        Args:
            event_type: The event type to listen for.  Use ``"*"`` to
                subscribe to all events.
            callback: A callable that accepts a single ``event`` dict
                argument.  May be a coroutine function.
            filter: Optional predicate function.  If provided, the callback
                is only invoked when ``filter(event)`` returns ``True``.
        """
        self._subscribers.setdefault(event_type, []).append((callback, filter))

    def unsubscribe(self, event_type: str, callback: Callable) -> None:
        """Remove a callback from an event type's subscriber list.

        Args:
            event_type: The event type to unsubscribe from.
            callback: The specific callback to remove.  Matched by identity.
        """
        if event_type in self._subscribers:
            original_len = len(self._subscribers[event_type])
            self._subscribers[event_type] = [
                (cb, filt) for cb, filt in self._subscribers[event_type]
                if cb is not callback
            ]
            removed = original_len - len(self._subscribers[event_type])
            if removed > 0:
                logger.debug(f"Unsubscribed {removed} handler(s) from {event_type}")

    def respond(self, event_type: str, handler: Callable):
        """Register a response handler for the request-response pattern.

        When a ``request()`` is made for *event_type*, the first registered
        response handler is invoked.  The handler should accept an ``event``
        dict and return a value (or a coroutine that returns a value).

        Args:
            event_type: The event type to respond to.
            handler: A callable that accepts an ``event`` dict and returns
                a response value.  May be a coroutine function.
        """
        self.subscribe(event_type, handler)

    def emit(self, task_id: str, event_type: str, payload: dict):
        """Emit an event to all matching subscribers.

        The event dict is constructed with ``type``, ``payload``,
        ``task_id``, and ``timestamp`` fields.  Subscribers for the
        specific event type and for the wildcard ``"*"`` are both notified.

        If a matching subscriber is a response handler registered via
        ``respond()`` and there is a pending ``request()`` for this event
        type, the handler's return value is used to resolve the request
        future.

        Args:
            task_id: The task identifier associated with the event.
            event_type: The categorization string for the event.
            payload: Arbitrary data carried by the event.
        """
        event = {
            "type": event_type,
            "payload": payload,
            "task_id": task_id,
            "timestamp": datetime.now(UTC).isoformat(),
        }
        self._dispatch(event_type, event)
        self._dispatch('*', event)

    def _dispatch(self, event_type: str, event: dict):
        """Dispatch event to subscribers of the given type, applying filters."""
        for cb, filt in self._subscribers.get(event_type, []):
            if filt is not None and not filt(event):
                continue
            try:
                result = cb(event)
                if asyncio.iscoroutine(result):
                    # For request-response with async handlers, we need to
                    # schedule the coroutine and resolve the future when done
                    if event_type in self._response_handlers:
                        future = self._response_handlers.pop(event_type)
                        if not future.done():

                            async def _resolve_async(coro, fut):
                                try:
                                    value = await coro
                                    if not fut.done():
                                        fut.set_result(value)
                                except Exception as e:
                                    if not fut.done():
                                        fut.set_exception(e)

                            asyncio.ensure_future(_resolve_async(result, future))
                    else:
                        asyncio.ensure_future(result)
                else:
                    # Request-response: if there's a pending future, resolve it
                    if event_type in self._response_handlers:
                        future = self._response_handlers.pop(event_type)
                        if not future.done():
                            future.set_result(result)
            except Exception:
                logger.exception(f"Event callback error for {event_type}")

    async def request(
        self,
        event_type: str,
        payload: dict,
        timeout: float = 30.0,
        task_id: str = "",
    ) -> Any:
        """Send a request event and wait for a response.

        This implements a request-response pattern on top of the event bus.
        The caller emits an event and awaits a single response from a
        handler registered via ``respond()``.

        Args:
            event_type: The event type to request.
            payload: Arbitrary data carried by the request event.
            timeout: Maximum seconds to wait for a response.  Defaults to 30.
            task_id: Optional task identifier for the request event.

        Returns:
            The value returned by the response handler.

        Raises:
            asyncio.TimeoutError: If no response is received within *timeout*.
        """
        loop = asyncio.get_running_loop()
        future = loop.create_future()
        self._response_handlers[event_type] = future

        # Emit the request event
        self.emit(task_id, event_type, payload)

        try:
            return await asyncio.wait_for(future, timeout=timeout)
        except TimeoutError:
            self._response_handlers.pop(event_type, None)
            raise
