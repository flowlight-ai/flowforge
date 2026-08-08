"""Console channel adapter — prints A2A messages to stdout.

The default adapter used during development and debugging. It does not
connect to any external platform; instead it renders A2A mentions and
messages as human-readable text on the console. Inbound listening is
not supported (the console cannot receive @mentions), so ``listen``
yields nothing — this adapter is outbound-only.

Configuration (from ``a2a_channels.yaml``)::

    channels:
      console:
        enabled: true
"""

from __future__ import annotations

import sys
from typing import AsyncIterator

from flowforge.core.tracing import get_logger

from flowforge.a2a.channels.base import ChannelAdapter
from flowforge.a2a.protocol import A2AMention, A2AMessage

logger = get_logger("flowforge.a2a.channels.console")


class ConsoleChannel(ChannelAdapter):
    """Outbound-only console channel for development and debugging.

    Renders A2A mentions and messages as formatted text on stdout.
    Inbound ``listen()`` is a no-op (yields nothing) because the console
    has no inbound message source.
    """

    name = "console"

    def __init__(self, config: dict | None = None) -> None:
        self._config = config or {}
        # Allow redirecting output (defaults to stdout) — useful for tests.
        self._stream = self._config.get("stream", sys.stdout)

    async def send_mention(self, mention: A2AMention) -> bool:
        """Print the mention to the console.

        Args:
            mention: The outbound mention.

        Returns:
            Always ``True`` (console output does not fail).
        """
        line = (
            f"[A2A @mention] {mention.from_agent} -> @{mention.to_agent}"
            + (f" (thread={mention.thread_id})" if mention.thread_id else "")
            + f": {mention.content}"
        )
        print(line, file=self._stream, flush=True)
        logger.debug(f"ConsoleChannel: printed mention to {mention.to_agent}")
        return True

    async def listen(self) -> AsyncIterator[A2AMention]:
        """No-op inbound listener.

        The console channel is outbound-only. This method exists to
        satisfy the ``ChannelAdapter`` contract but yields nothing.
        """
        return
        yield  # type: ignore[unreachable]  # pragma: no cover

    async def reply_thread(self, thread_id: str, message: A2AMessage) -> bool:
        """Print a reply within a thread context.

        Args:
            thread_id: The thread identifier (rendered for context).
            message: The reply message.

        Returns:
            Always ``True``.
        """
        sender = message.sender or message.role
        text_parts = [p.text for p in message.parts if p.text]
        body = " | ".join(text_parts) if text_parts else "(no text)"
        line = f"[A2A reply] thread={thread_id} {sender}: {body}"
        print(line, file=self._stream, flush=True)
        logger.debug(f"ConsoleChannel: printed reply to thread {thread_id}")
        return True
