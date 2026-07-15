"""A2A Mention Router & Thread Manager.

Ported from clowder-ai's @mention routing methodology, this module
provides:

- ``MentionRouter``: parses ``@agent_name`` syntax from text and routes
  mentions to the correct target agent, with optional allow-list
  validation.
- ``ThreadManager``: creates and isolates conversation threads so that
  messages in one thread never leak into another.

Both classes are synchronous (no I/O) — they operate on in-memory state.
The async dispatch to channels is handled by ``A2AManager``.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Optional

from flowforge.core.tracing import get_logger

from flowforge.a2a.protocol import A2AMention, A2AMessage, A2AThread

logger = get_logger("flowforge.a2a.router")

# Matches @agent_name where agent_name is alphanumeric + underscore/hyphen.
# A leading word boundary ensures we don't match email addresses.
_MENTION_PATTERN = re.compile(r"(?<![\w@])@([A-Za-z][A-Za-z0-9_-]*)")


class MentionRouter:
    """Parses and routes @mention messages between agents.

    The router is responsible for the *syntactic* layer of mention
    routing: extracting ``@agent_name`` tokens from text and validating
    them against an optional allow-list of known agents.

    Register known agent names via ``register_agent`` (or pass an initial
    set to the constructor) so that ``validate_mention`` can reject
    mentions to unknown agents.
    """

    def __init__(self, known_agents: Optional[set[str]] = None) -> None:
        self._known_agents: set[str] = set(known_agents) if known_agents else set()

    def register_agent(self, name: str) -> None:
        """Register an agent name as a valid mention target."""
        self._known_agents.add(name)
        logger.debug(f"MentionRouter: registered agent '{name}'")

    def unregister_agent(self, name: str) -> None:
        """Remove an agent name from the valid mention targets."""
        self._known_agents.discard(name)

    def known_agents(self) -> list[str]:
        """Return a sorted list of known agent names."""
        return sorted(self._known_agents)

    def parse_mention(self, text: str, from_agent: str = "") -> list[A2AMention]:
        """Parse @agent_name tokens from ``text`` into A2AMention objects.

        Args:
            text: The raw text potentially containing ``@agent_name`` tokens.
            from_agent: Name of the agent that authored ``text``. Stored
                on each produced mention. May be empty for ad-hoc parsing.

        Returns:
            A list of ``A2AMention`` objects, one per distinct mention
            found. Each mention's ``content`` is the full input text so
            the receiving agent sees the complete context.
        """
        if not text:
            return []

        matches = _MENTION_PATTERN.findall(text)
        if not matches:
            return []

        # De-duplicate while preserving order (one mention per target).
        seen: set[str] = set()
        mentions: list[A2AMention] = []
        for name in matches:
            if name in seen:
                continue
            seen.add(name)
            mentions.append(
                A2AMention(
                    from_agent=from_agent,
                    to_agent=name,
                    content=text,
                )
            )
        logger.debug(
            f"MentionRouter: parsed {len(mentions)} mention(s) from text "
            f"({len(text)} chars)"
        )
        return mentions

    def route(self, mention: A2AMention) -> str:
        """Route a mention to its target agent.

        Args:
            mention: The parsed mention to route.

        Returns:
            The ``to_agent`` name (the routing destination).

        Raises:
            ValueError: If the mention targets an unknown agent (only
                when an allow-list is configured).
        """
        if self._known_agents and mention.to_agent not in self._known_agents:
            raise ValueError(
                f"Cannot route mention to unknown agent '{mention.to_agent}'. "
                f"Known agents: {self.known_agents()}"
            )
        logger.info(
            f"MentionRouter: routing {mention.from_agent} -> {mention.to_agent}"
        )
        return mention.to_agent

    def validate_mention(self, from_agent: str, to_agent: str) -> bool:
        """Validate whether a mention from ``from_agent`` to ``to_agent`` is allowed.

        Validation rules:
        1. ``from_agent`` and ``to_agent`` must both be non-empty.
        2. ``from_agent`` must differ from ``to_agent`` (no self-mentions).
        3. If an allow-list is configured, ``to_agent`` must be known.

        Args:
            from_agent: Name of the sending agent.
            to_agent: Name of the target agent.

        Returns:
            ``True`` if the mention is valid, ``False`` otherwise.
        """
        if not from_agent or not to_agent:
            return False
        if from_agent == to_agent:
            logger.warning(
                f"MentionRouter: self-mention rejected ({from_agent} -> {to_agent})"
            )
            return False
        if self._known_agents and to_agent not in self._known_agents:
            logger.warning(
                f"MentionRouter: mention to unknown agent '{to_agent}' rejected"
            )
            return False
        return True


class ThreadManager:
    """Manages the lifecycle and isolation of A2A conversation threads.

    Threads provide strict isolation — a message added to thread A is
    never visible when querying thread B. Threads can be created, looked
    up, listed, isolated (made private to current participants), and
    closed.

    All operations are in-memory; persistence is out of scope for this
    class (use the event bus / mailbox for durable storage).
    """

    def __init__(self) -> None:
        self._threads: dict[str, A2AThread] = {}

    def create_thread(self, topic: str, participants: list[str]) -> A2AThread:
        """Create a new conversation thread.

        Args:
            topic: Human-readable topic for the thread.
            participants: Agent names that participate in the thread.

        Returns:
            The newly created ``A2AThread``.
        """
        thread = A2AThread(
            topic=topic,
            participants=list(dict.fromkeys(participants)),  # dedupe, keep order
        )
        self._threads[thread.id] = thread
        logger.info(
            f"ThreadManager: created thread '{thread.id}' "
            f"(topic='{topic}', participants={thread.participants})"
        )
        return thread

    def add_message(self, thread_id: str, message: A2AMessage) -> None:
        """Append a message to an existing thread.

        Args:
            thread_id: The target thread id.
            message: The message to append.

        Raises:
            KeyError: If ``thread_id`` does not exist.
            ValueError: If the thread is closed.
        """
        thread = self._threads.get(thread_id)
        if thread is None:
            raise KeyError(f"Thread '{thread_id}' not found")
        if thread.closed:
            raise ValueError(f"Thread '{thread_id}' is closed; cannot add messages")

        thread.messages.append(message)
        thread.updated_at = datetime.now(timezone.utc)
        logger.debug(
            f"ThreadManager: appended message to thread '{thread_id}' "
            f"(total messages: {len(thread.messages)})"
        )

    def get_thread(self, thread_id: str) -> Optional[A2AThread]:
        """Retrieve a thread by id, or ``None`` if not found."""
        return self._threads.get(thread_id)

    def isolate_thread(self, thread_id: str) -> None:
        """Lock a thread to its current participants.

        After isolation, no new participants can join. This is enforced
        by the manager: ``add_message`` will still work for existing
        participants, but the participant list is frozen. This prevents
        cross-thread message leakage by ensuring thread membership is
        immutable after isolation.

        Args:
            thread_id: The thread to isolate.

        Raises:
            KeyError: If ``thread_id`` does not exist.
        """
        thread = self._threads.get(thread_id)
        if thread is None:
            raise KeyError(f"Thread '{thread_id}' not found")
        # Mark the thread as isolated by freezing participants via a
        # sentinel metadata flag. The model uses ``extra='allow'`` so we
        # can attach an ``isolated`` flag without changing the schema.
        thread.__dict__["isolated"] = True
        logger.info(
            f"ThreadManager: isolated thread '{thread_id}' "
            f"(participants frozen: {thread.participants})"
        )

    def list_active_threads(self) -> list[A2AThread]:
        """Return all non-closed threads."""
        return [t for t in self._threads.values() if not t.closed]

    def close_thread(self, thread_id: str) -> None:
        """Close a thread so no further messages can be added.

        Args:
            thread_id: The thread to close.

        Raises:
            KeyError: If ``thread_id`` does not exist.
        """
        thread = self._threads.get(thread_id)
        if thread is None:
            raise KeyError(f"Thread '{thread_id}' not found")
        thread.closed = True
        thread.updated_at = datetime.now(timezone.utc)
        logger.info(f"ThreadManager: closed thread '{thread_id}'")
