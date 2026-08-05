"""A2A Channel abstraction and in-memory implementation.

A ``Channel`` is the transport layer for A2A messages — it abstracts
*how* messages are delivered between agents (in-memory queue, network
socket, platform webhook, etc.) so that the A2A protocol layer stays
transport-agnostic.

This module provides:
- ``Channel``: abstract base class defining the send/receive contract.
- ``InMemoryChannel``: a synchronous-queue-backed channel for dev and
  unit testing. Messages are buffered and consumed FIFO.
- ``ChannelRegistry``: registers and discovers channels by name.

Note: This is distinct from ``flowforge.core.channel_manager.ChannelManager``
which dispatches task *status* updates to ``MessageChannelPlugin`` instances
(human-facing notification channels). The A2A Channel is an inter-agent
message bus.
"""

from __future__ import annotations

import asyncio
from abc import ABC, abstractmethod

from flowforge.a2a.protocol import A2AMessage
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.a2a.channel")


class Channel(ABC):
    """Abstract base class for A2A message channels.

    A channel is a unidirectional-ish message conduit: agents ``send``
    messages into it and consumers ``receive`` messages from it. Concrete
    implementations decide the delivery semantics (FIFO queue, pub/sub,
    HTTP webhook, etc.).
    """

    name: str = "base"

    @abstractmethod
    async def send(self, message: A2AMessage) -> None:
        """Send a message through this channel.

        Args:
            message: The A2A message to deliver.
        """
        ...

    @abstractmethod
    async def receive(self) -> A2AMessage:
        """Receive the next available message from this channel.

        This may block (await) until a message is available.

        Returns:
            The next A2A message.
        """
        ...

    async def close(self) -> None:
        """Release any resources held by this channel.

        Default implementation is a no-op. Override if the channel holds
        network connections, file handles, etc.
        """
        pass


class InMemoryChannel(Channel):
    """An in-memory, asyncio-queue-backed channel.

    Suitable for development, debugging, and unit tests. Messages are
    buffered in an unbounded ``asyncio.Queue`` and consumed FIFO.

    Example::

        ch = InMemoryChannel(name="dev")
        await ch.send(A2AMessage(parts=[A2APart(text="hello")]))
        msg = await ch.receive()  # blocks until a message arrives
    """

    def __init__(self, name: str = "in_memory") -> None:
        self.name = name
        self._queue: asyncio.Queue[A2AMessage] = asyncio.Queue()
        self._closed = False

    async def send(self, message: A2AMessage) -> None:
        if self._closed:
            raise RuntimeError(f"Channel '{self.name}' is closed")
        await self._queue.put(message)
        logger.debug(f"InMemoryChannel['{self.name}']: enqueued message")

    async def receive(self) -> A2AMessage:
        if self._closed and self._queue.empty():
            raise RuntimeError(
                f"Channel '{self.name}' is closed and empty; cannot receive"
            )
        message = await self._queue.get()
        logger.debug(f"InMemoryChannel['{self.name}']: dequeued message")
        return message

    def qsize(self) -> int:
        """Return the number of messages currently buffered."""
        return self._queue.qsize()

    def empty(self) -> bool:
        """Return ``True`` if no messages are buffered."""
        return self._queue.empty()

    async def close(self) -> None:
        self._closed = True
        logger.debug(f"InMemoryChannel['{self.name}']: closed")


class ChannelRegistry:
    """Registry for discovering A2A channels by name.

    Channels are registered with ``register`` and looked up with
    ``get``. This is the lookup table used by ``A2AManager`` to dispatch
    messages to the appropriate transport.
    """

    def __init__(self) -> None:
        self._channels: dict[str, Channel] = {}

    def register(self, name: str, channel: Channel) -> None:
        """Register a channel under ``name``.

        Args:
            name: Unique channel name (e.g. 'in_memory', 'feishu').
            channel: The channel instance.

        Raises:
            ValueError: If ``name`` is already registered.
        """
        if name in self._channels:
            raise ValueError(
                f"Channel '{name}' is already registered. "
                f"Use unregister() first or pick a different name."
            )
        channel.name = name
        self._channels[name] = channel
        logger.info(f"ChannelRegistry: registered channel '{name}'")

    def unregister(self, name: str) -> Channel | None:
        """Remove and return a registered channel, or ``None`` if absent."""
        channel = self._channels.pop(name, None)
        if channel is not None:
            logger.info(f"ChannelRegistry: unregistered channel '{name}'")
        return channel

    def get(self, name: str) -> Channel:
        """Look up a channel by name.

        Args:
            name: The registered channel name.

        Returns:
            The channel instance.

        Raises:
            KeyError: If no channel is registered under ``name``.
        """
        if name not in self._channels:
            raise KeyError(
                f"Channel '{name}' not found. "
                f"Registered channels: {self.list_channels()}"
            )
        return self._channels[name]

    def list_channels(self) -> list[str]:
        """Return a sorted list of registered channel names."""
        return sorted(self._channels.keys())

    def has(self, name: str) -> bool:
        """Return ``True`` if a channel is registered under ``name``."""
        return name in self._channels
