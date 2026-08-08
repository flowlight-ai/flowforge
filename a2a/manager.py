"""A2A Manager — unified entry point for Agent-to-Agent communication.

``A2AManager`` integrates the three A2A subsystems:

1. **Mention routing** (``MentionRouter``) — parse and validate ``@agent``
   mentions.
2. **Thread management** (``ThreadManager``) — create, isolate, and close
   conversation threads.
3. **Channel dispatch** (``ChannelRegistry``) — deliver messages over the
   appropriate transport.

It is the single facade that agents (and plugins) interact with for
cross-agent communication. The manager is designed to be registered into
FlowForge's DI container or constructed explicitly and injected — it
never instantiates its own dependencies internally (red-line #12).

Relationship to existing modules:
- ``flowforge.core.handoff.HandoffManager`` performs *synchronous*
  in-process task delegation between agents. ``A2AManager.handoff`` is
  its *protocol-level* counterpart — it records and routes an
  ``A2AHandoff`` record asynchronously, complementing (not replacing)
  the HandoffManager.
- ``flowforge.core.channel_manager.ChannelManager`` dispatches task
  *status* updates to human-facing notification plugins. ``A2AManager``
  handles *agent-to-agent* protocol messages — a different concern.
"""

from __future__ import annotations

from typing import Any

from flowforge.a2a.channel import Channel, ChannelRegistry
from flowforge.a2a.protocol import (
    A2AHandoff,
    A2AMention,
    A2AMessage,
    A2APart,
    A2AThread,
)
from flowforge.a2a.router import MentionRouter, ThreadManager
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.a2a.manager")


class A2AManager:
    """A2A communication unified manager.

    Integrates mention routing, thread management, and channel dispatch.
    Designed to be registered via Plugin Protocol V2 and injected into
    agents that need cross-agent communication.

    Example::

        from flowforge.a2a import A2AManager, MentionRouter, ThreadManager
        from flowforge.a2a.channel import ChannelRegistry, InMemoryChannel

        registry = ChannelRegistry()
        registry.register("default", InMemoryChannel())
        manager = A2AManager(registry, MentionRouter(), ThreadManager())

        thread = await manager.create_thread("code review", ["coordinator", "reviewer"])
        await manager.send_mention("coordinator", "reviewer", "@reviewer please check PR #42", thread.id)
    """

    DEFAULT_CHANNEL = "default"

    def __init__(
        self,
        channel_registry: ChannelRegistry,
        mention_router: MentionRouter,
        thread_manager: ThreadManager,
    ) -> None:
        self._channels = channel_registry
        self._router = mention_router
        self._threads = thread_manager
        # Register known agents from existing thread participants so
        # mention validation works out of the box.
        for thread in self._threads.list_active_threads():
            for participant in thread.participants:
                self._router.register_agent(participant)

    # ── Mention routing ────────────────────────────────────────────

    async def send_mention(
        self,
        from_agent: str,
        to_agent: str,
        content: str,
        thread_id: str | None = None,
    ) -> A2AMention:
        """Send an @mention message to a target agent.

        Args:
            from_agent: Name of the sending agent.
            to_agent: Name of the target agent (the ``@mentioned`` agent).
            content: The message body (may contain additional ``@mentions``).
            thread_id: Optional thread to scope the mention to.

        Returns:
            The created ``A2AMention`` record.

        Raises:
            ValueError: If the mention fails validation (see
                ``MentionRouter.validate_mention``).
        """
        if not self._router.validate_mention(from_agent, to_agent):
            raise ValueError(
                f"Invalid mention: {from_agent} -> {to_agent}. "
                f"Ensure both agents are known and distinct."
            )

        mention = A2AMention(
            from_agent=from_agent,
            to_agent=to_agent,
            content=content,
            thread_id=thread_id,
        )
        self._router.route(mention)

        # Build a protocol message and dispatch to the default channel.
        message = A2AMessage(
            role="agent",
            parts=[A2APart(type="text", text=content)],
            sender=from_agent,
        )
        channel = self._resolve_channel()
        await channel.send(message)

        if thread_id is not None:
            thread = self._threads.get_thread(thread_id)
            if thread is not None and not thread.closed:
                self._threads.add_message(thread_id, message)

        logger.info(
            f"A2AManager: mention sent {from_agent} -> {to_agent}"
            + (f" (thread={thread_id})" if thread_id else "")
        )
        return mention

    # ── Thread management ──────────────────────────────────────────

    async def create_thread(
        self, topic: str, participants: list[str]
    ) -> A2AThread:
        """Create a new conversation thread.

        Also registers participants as known agents with the mention
        router so future mentions to them validate correctly.

        Args:
            topic: Human-readable thread topic.
            participants: Agent names participating in the thread.

        Returns:
            The newly created ``A2AThread``.
        """
        thread = self._threads.create_thread(topic, participants)
        for participant in participants:
            self._router.register_agent(participant)
        return thread

    async def broadcast(
        self, from_agent: str, content: str, thread_id: str
    ) -> None:
        """Broadcast a message to all participants of a thread.

        Args:
            from_agent: Name of the broadcasting agent.
            content: The message body.
            thread_id: The thread to broadcast within.

        Raises:
            KeyError: If ``thread_id`` does not exist.
            ValueError: If the thread is closed.
        """
        thread = self._threads.get_thread(thread_id)
        if thread is None:
            raise KeyError(f"Thread '{thread_id}' not found")
        if thread.closed:
            raise ValueError(f"Thread '{thread_id}' is closed; cannot broadcast")

        message = A2AMessage(
            role="agent",
            parts=[A2APart(type="text", text=content)],
            sender=from_agent,
        )
        self._threads.add_message(thread_id, message)

        channel = self._resolve_channel()
        await channel.send(message)
        logger.info(
            f"A2AManager: broadcast from '{from_agent}' to thread '{thread_id}' "
            f"({len(thread.participants)} participants)"
        )

    # ── Structured handoff ─────────────────────────────────────────

    async def handoff(
        self,
        source_agent: str,
        target_agent: str,
        task: str,
        context: dict[str, Any],
        reason: str = "",
    ) -> A2AHandoff:
        """Perform a structured, protocol-level task handoff.

        This complements (does not replace) ``HandoffManager.execute_handoff``
        which performs synchronous in-process delegation. This method
        records an ``A2AHandoff`` and routes a mention to the target
        agent, leaving the actual execution to the receiving side.

        Args:
            source_agent: Agent initiating the handoff.
            target_agent: Agent receiving the handoff.
            task: Task description to hand off.
            context: Additional context to transfer.
            reason: Optional explanation for the handoff.

        Returns:
            The created ``A2AHandoff`` record.
        """
        handoff_record = A2AHandoff(
            source_agent=source_agent,
            target_agent=target_agent,
            task=task,
            context=context,
            reason=reason,
        )
        logger.info(
            f"A2AManager: handoff {source_agent} -> {target_agent} "
            f"(task: {task[:80]}{'...' if len(task) > 80 else ''})"
        )
        # Route a mention so the target agent is notified of the handoff.
        # We pass context as a data part so it travels with the message.
        try:
            mention = await self.send_mention(
                from_agent=source_agent,
                to_agent=target_agent,
                content=f"[HANDOFF] {task}",
            )
            handoff_record.thread_id = mention.thread_id
        except ValueError:
            # If mention validation fails (e.g. unknown agent), log and
            # still return the handoff record so callers can handle it.
            logger.warning(
                f"A2AManager: could not route handoff mention to "
                f"'{target_agent}' (not a known agent). Handoff recorded only."
            )
        return handoff_record

    # ── Channel management ─────────────────────────────────────────

    def register_channel(self, name: str, channel: Channel) -> None:
        """Register a communication channel.

        Args:
            name: Unique channel name.
            channel: The channel instance.
        """
        self._channels.register(name, channel)

    def get_channel(self, name: str) -> Channel:
        """Look up a registered channel by name."""
        return self._channels.get(name)

    def list_channels(self) -> list[str]:
        """Return a sorted list of registered channel names."""
        return self._channels.list_channels()

    # ── Helpers ────────────────────────────────────────────────────

    def _resolve_channel(self) -> Channel:
        """Resolve the channel to use for message dispatch.

        Falls back to the ``DEFAULT_CHANNEL`` if no specific channel is
        named. If the default is missing, raises ``KeyError``.
        """
        return self._channels.get(self.DEFAULT_CHANNEL)

    @property
    def router(self) -> MentionRouter:
        """Access the underlying mention router (for agent registration)."""
        return self._router

    @property
    def threads(self) -> ThreadManager:
        """Access the underlying thread manager."""
        return self._threads
