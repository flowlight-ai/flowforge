"""FlowForge A2A (Agent-to-Agent) Communication Module.

A multi-agent communication subsystem that ports clowder-ai's @mention
routing methodology to FlowForge. It provides:

- **Protocol data models** (Pydantic v2): messages, tasks, mentions,
  threads, handoffs, agent cards — a minimal subset of Google's A2A
  protocol (v1.0) plus FlowForge extensions.
- **Mention routing**: parse ``@agent_name`` from text and route to the
  target agent, with allow-list validation.
- **Thread isolation**: scoped conversation threads that prevent
  cross-thread message leakage.
- **Channel abstraction**: pluggable transports (in-memory, console,
  Feishu, GitHub) for delivering A2A messages.
- **Unified manager** (``A2AManager``): single facade integrating
  routing, threading, and channel dispatch.

This module complements (does not replace) the existing:
- ``flowforge.core.handoff.HandoffManager`` (synchronous in-process
  delegation) — A2A provides the async protocol-level counterpart.
- ``flowforge.core.channel_manager.ChannelManager`` (human-facing task
  status notifications) — A2A handles agent-to-agent protocol messages.

Public API::

    from flowforge.a2a import (
        A2AManager,
        MentionRouter,
        ThreadManager,
        A2AMention,
        A2AMessage,
        A2APart,
        A2AArtifact,
        A2ATask,
        A2ATaskStatus,
        A2AAgentCard,
        A2AThread,
        A2AHandoff,
    )
    from flowforge.a2a.channel import Channel, InMemoryChannel, ChannelRegistry
    from flowforge.a2a.channels import ChannelAdapter
"""

from __future__ import annotations

from flowforge.a2a.channel import Channel, ChannelRegistry, InMemoryChannel
from flowforge.a2a.manager import A2AManager
from flowforge.a2a.protocol import (
    A2AAgentCard,
    A2AArtifact,
    A2AHandoff,
    A2AMention,
    A2AMessage,
    A2APart,
    A2ATask,
    A2ATaskStatus,
    A2AThread,
)
from flowforge.a2a.router import MentionRouter, ThreadManager

__all__ = [
    # Manager
    "A2AManager",
    # Router
    "MentionRouter",
    "ThreadManager",
    # Channel
    "Channel",
    "InMemoryChannel",
    "ChannelRegistry",
    # Protocol models
    "A2APart",
    "A2AMessage",
    "A2AArtifact",
    "A2ATask",
    "A2ATaskStatus",
    "A2AAgentCard",
    "A2AMention",
    "A2AThread",
    "A2AHandoff",
]

__version__ = "0.1.0"
