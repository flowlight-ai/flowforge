"""ChannelAdapter — abstract base for platform-specific A2A adapters.

Each platform (Feishu, GitHub, console) implements ``ChannelAdapter``
to bridge its native message format with the A2A protocol. An adapter:

1. **Listens** for incoming platform events and converts them to
   ``A2AMention`` objects (inbound).
2. **Sends** ``A2AMention`` objects back to the platform as native
   messages (outbound).
3. **Replies** within a specific thread on the platform.

Adapters are *translators* — they do not contain business logic. The
routing and thread logic lives in ``A2AManager`` / ``MentionRouter``.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator

from flowforge.a2a.protocol import A2AMention, A2AMessage


class ChannelAdapter(ABC):
    """Abstract base class for multi-platform A2A channel adapters.

    Concrete adapters convert platform-specific message formats to and
    from the A2A protocol. They are configured via the external YAML
    file ``flowforge/config/a2a_channels.yaml`` (red-line #11: no
    hardcoded secrets/URLs).

    Adapter lifecycle:
    1. Construct with a config dict (loaded from YAML).
    2. Call ``start()`` to begin listening (if the platform pushes events).
    3. ``listen()`` yields inbound ``A2AMention`` objects.
    4. ``send_mention()`` / ``reply_thread()`` push outbound messages.
    5. Call ``stop()`` to release resources.
    """

    #: Adapter name (matches the YAML config key, e.g. 'feishu').
    name: str = "base"

    @abstractmethod
    async def send_mention(self, mention: A2AMention) -> bool:
        """Send an outbound mention to the platform.

        Args:
            mention: The A2A mention to deliver.

        Returns:
            ``True`` if the platform accepted the message, ``False``
            otherwise.
        """
        ...

    @abstractmethod
    async def listen(self) -> AsyncIterator[A2AMention]:
        """Yield inbound mentions from the platform.

        This is an async generator that should run until the adapter is
        stopped. Each yielded ``A2AMention`` represents an incoming
        ``@agent_name`` event detected on the platform.

        Yields:
            ``A2AMention`` objects parsed from platform events.
        """
        ...
        # The body is empty because this is an abstract async generator.
        # Subclasses implement: `yield mention` in a loop.
        if False:  # pragma: no cover - type-checker hint only
            yield  # type: ignore[unreachable]

    @abstractmethod
    async def reply_thread(self, thread_id: str, message: A2AMessage) -> bool:
        """Reply to a specific thread on the platform.

        Args:
            thread_id: The platform-native thread / topic identifier.
            message: The A2A message to post as a reply.

        Returns:
            ``True`` if the reply was posted successfully.
        """
        ...

    async def start(self) -> None:
        """Start the adapter (e.g. open webhook listener).

        Default implementation is a no-op. Override for adapters that
        need to establish connections before listening.
        """
        pass

    async def stop(self) -> None:
        """Stop the adapter and release resources.

        Default implementation is a no-op. Override for adapters that
        hold network connections or background tasks.
        """
        pass
