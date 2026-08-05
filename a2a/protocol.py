"""A2A Protocol Data Models — Pydantic v2 implementations.

Implements a minimal subset of Google's Agent-to-Agent Protocol (v1.0)
adapted for FlowForge's multi-agent communication, plus FlowForge-specific
extensions (mentions, threads, handoffs).

Reference: https://a2a-protocol.org/latest/specification/

This module is the data layer of the A2A subsystem — it defines the
protocol messages exchanged between agents. It has NO runtime dependencies
on other a2a modules, only on ``flowforge.core.tracing`` for logging.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


def _utc_now() -> datetime:
    """Return the current UTC datetime (timezone-aware)."""
    return datetime.now(UTC)


def _new_id(prefix: str = "") -> str:
    """Generate a new unique identifier with an optional prefix."""
    return f"{prefix}{uuid.uuid4().hex[:12]}"


class A2ATaskStatus(str, Enum):
    """Lifecycle status of an A2A task.

    Mirrors the upstream spec's states:
    ``submitted -> working -> completed | failed | canceled | input_required``
    """

    SUBMITTED = "submitted"
    WORKING = "working"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELED = "canceled"
    INPUT_REQUIRED = "input-required"


class A2APart(BaseModel):
    """A content unit within a message or artifact.

    A part is one of three kinds (discriminated by ``type``):
    - ``text``: plain text content (``text`` field populated)
    - ``file``: a binary/file reference (``file`` field populated)
    - ``data``: structured JSON data (``data`` field populated)
    """

    type: str = Field(
        default="text",
        description="Content kind: 'text', 'file', or 'data'.",
    )
    text: str | None = Field(
        default=None, description="Text content (when type == 'text')."
    )
    file: dict[str, Any] | None = Field(
        default=None,
        description=(
            "File reference with keys: name, mimeType, bytes (base64). "
            "Populated when type == 'file'."
        ),
    )
    data: Any | None = Field(
        default=None,
        description="Structured JSON payload (when type == 'data').",
    )

    model_config = {"extra": "allow"}


class A2AMessage(BaseModel):
    """A communication unit in a task's message history.

    A message has a ``role`` (``user`` or ``agent``) and a list of
    ``parts`` (the actual content). This mirrors the upstream A2A spec.
    """

    role: str = Field(
        default="user",
        description="Sender role: 'user' or 'agent'.",
    )
    parts: list[A2APart] = Field(
        default_factory=list,
        description="Ordered content parts of the message.",
    )
    # FlowForge extensions (not in upstream spec, but useful for routing)
    sender: str | None = Field(
        default=None,
        description="Name of the sending agent (FlowForge extension).",
    )
    timestamp: datetime = Field(
        default_factory=_utc_now,
        description="When the message was created.",
    )

    model_config = {"extra": "allow"}


class A2AArtifact(BaseModel):
    """Structured output produced by a completed task.

    Artifacts bundle named results (with optional descriptions) whose
    content is expressed as a list of A2A parts.
    """

    name: str | None = Field(
        default=None, description="Human-readable artifact name."
    )
    description: str | None = Field(
        default=None, description="What the artifact contains."
    )
    parts: list[A2APart] = Field(
        default_factory=list,
        description="Content parts of the artifact.",
    )

    model_config = {"extra": "allow"}


class A2ATask(BaseModel):
    """The core unit of work in the A2A protocol.

    A task has a unique id, a lifecycle status, optional artifacts
    (produced outputs), and an optional message history.
    """

    id: str = Field(
        default_factory=lambda: _new_id("task_"),
        description="Unique task identifier.",
    )
    status: A2ATaskStatus = Field(
        default=A2ATaskStatus.SUBMITTED,
        description="Current lifecycle status of the task.",
    )
    artifacts: list[A2AArtifact] = Field(
        default_factory=list,
        description="Outputs produced by the task.",
    )
    history: list[A2AMessage] = Field(
        default_factory=list,
        description="Message exchange history for this task.",
    )

    model_config = {"extra": "allow"}


class A2AAgentCard(BaseModel):
    """Describes a remote agent's capabilities and endpoint.

    Agent cards are used for discovery — an agent publishes its card so
    other agents know how to address it and what it can do.
    """

    name: str = Field(..., description="Unique agent name.")
    description: str | None = Field(
        default=None, description="Human-readable summary of the agent."
    )
    url: str = Field(
        ..., description="Endpoint URL for sending tasks to this agent."
    )
    supported_interfaces: list[str] = Field(
        default_factory=lambda: ["tasks"],
        description="Protocol interfaces the agent supports (e.g. 'tasks').",
    )
    capabilities: list[str] = Field(
        default_factory=list,
        description="Capability tags (e.g. 'streaming', 'pushNotifications').",
    )

    model_config = {"extra": "allow"}


class A2AMention(BaseModel):
    """An @mention message routed from one agent to another.

    This is a FlowForge extension to the upstream A2A spec, implementing
    @mention routing. A mention carries a content payload
    from a source agent to a target agent within an optional thread.
    """

    from_agent: str = Field(..., description="Agent sending the mention.")
    to_agent: str = Field(..., description="Agent being mentioned.")
    content: str = Field(..., description="Mention content body.")
    thread_id: str | None = Field(
        default=None,
        description="Thread this mention belongs to (None = ad-hoc).",
    )
    timestamp: datetime = Field(
        default_factory=_utc_now,
        description="When the mention was created.",
    )

    model_config = {"extra": "allow"}


class A2AThread(BaseModel):
    """An isolated conversation thread between agents.

    Threads provide isolation — messages in one thread are not visible
    to agents outside that thread. Each thread has a topic, a set of
    participants, and an ordered message list.
    """

    id: str = Field(
        default_factory=lambda: _new_id("thread_"),
        description="Unique thread identifier.",
    )
    topic: str = Field(..., description="Thread topic / subject.")
    participants: list[str] = Field(
        default_factory=list,
        description="Agent names participating in the thread.",
    )
    messages: list[A2AMessage] = Field(
        default_factory=list,
        description="Ordered messages in the thread.",
    )
    created_at: datetime = Field(
        default_factory=_utc_now,
        description="Thread creation timestamp.",
    )
    updated_at: datetime = Field(
        default_factory=_utc_now,
        description="Last activity timestamp.",
    )
    closed: bool = Field(
        default=False,
        description="Whether the thread has been closed.",
    )

    model_config = {"extra": "allow"}


class A2AHandoff(BaseModel):
    """A structured task handoff between agents.

    Complements the existing ``flowforge.core.handoff.HandoffManager``
    (which performs synchronous in-process delegation) by providing a
    protocol-level, async-friendly handoff record that can be logged,
    audited, and routed across channels.
    """

    source_agent: str = Field(..., description="Agent initiating the handoff.")
    target_agent: str = Field(..., description="Agent receiving the handoff.")
    task: str = Field(..., description="Task description to hand off.")
    context: dict[str, Any] = Field(
        default_factory=dict,
        description="Additional context to transfer with the task.",
    )
    reason: str = Field(
        default="",
        description="Why the handoff is being made.",
    )
    thread_id: str | None = Field(
        default=None,
        description="Thread context for the handoff, if any.",
    )
    timestamp: datetime = Field(
        default_factory=_utc_now,
        description="When the handoff was created.",
    )

    model_config = {"extra": "allow"}
