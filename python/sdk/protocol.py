"""Wire contract constants and types for the FlowForge SDK runtime protocol.

This module is the Python mirror of ``@flowforge/sdk-protocol/types``: the
three request/result pairs and the four server-to-client notification payloads
exchanged over the newline-delimited JSON-RPC stdio transport. The server
plugin and every SDK client share these shapes; ``serverInfo.name`` stays the
wire-stable ``flowforge-sdk-runtime``.

``py>=3.9``, pure standard library. Line values are validated with the
``is_*``/``*_result`` helpers rather than enforced structurally.
"""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Optional

__all__ = [
    'SERVER_INFO_NAME',
    'PROTOCOL_VERSION',
    'INITIALIZE_METHOD',
    'SESSION_PROMPT_METHOD',
    'SHUTDOWN_METHOD',
    'SESSION_EVENT_METHOD',
    'SESSION_STATUS_METHOD',
    'SUBAGENT_STARTED_METHOD',
    'SUBAGENT_FINISHED_METHOD',
    'REQUEST_METHODS',
    'NOTIFICATION_METHODS',
    'SESSION_STATUSES',
    'SDK_RUN_STATUSES',
    'is_record',
    'InitializeParams',
    'ServerInfo',
    'InitializeResult',
    'ContentBlock',
    'SessionPromptParams',
    'SessionPromptResult',
    'SessionEventNotification',
    'SessionStatusNotification',
    'SubagentStartedNotification',
    'SubagentFinishedNotification',
    'validate_initialize_result',
    'validate_session_prompt_result',
    'validate_session_event',
    'validate_session_status',
    'validate_subagent_started',
    'validate_subagent_finished',
]

# --------------------------------------------------------------------------
# Wire constants
# --------------------------------------------------------------------------

#: Wire-stable server identity returned by ``initialize``.
SERVER_INFO_NAME = 'flowforge-sdk-runtime'
#: Wire JSON-RPC version string.
PROTOCOL_VERSION = '2.0'

# Request methods (client -> server).
INITIALIZE_METHOD = 'initialize'
SESSION_PROMPT_METHOD = 'session/prompt'
SHUTDOWN_METHOD = 'shutdown'

# Notification methods (server -> client).
SESSION_EVENT_METHOD = 'session.event'
SESSION_STATUS_METHOD = 'session.status'
SUBAGENT_STARTED_METHOD = 'subagent.started'
SUBAGENT_FINISHED_METHOD = 'subagent.finished'

#: All request method names accepted on the wire.
REQUEST_METHODS: frozenset = frozenset((
    INITIALIZE_METHOD,
    SESSION_PROMPT_METHOD,
    SHUTDOWN_METHOD,
))

#: All notification method names accepted on the wire.
NOTIFICATION_METHODS: frozenset = frozenset((
    SESSION_EVENT_METHOD,
    SESSION_STATUS_METHOD,
    SUBAGENT_STARTED_METHOD,
    SUBAGENT_FINISHED_METHOD,
))

#: Valid ``session.status`` states.
SESSION_STATUSES: frozenset = frozenset(('idle', 'running'))

#: Valid ``subagent.finished`` run outcomes.
SDK_RUN_STATUSES: frozenset = frozenset(('ok', 'error'))


def is_record(value: Any) -> bool:
    """Whether ``value`` is a plain JSON object (wire-boundary shape probe).

    Mirrors the TS ``isRecord``: a non-null, non-array object.
    """
    return isinstance(value, dict)


def is_valid_request_method(method: Any) -> bool:
    """Whether ``method`` names a request the client can send."""
    return isinstance(method, str) and method in REQUEST_METHODS


def is_valid_notification_method(method: Any) -> bool:
    """Whether ``method`` names a server-to-client notification."""
    return isinstance(method, str) and method in NOTIFICATION_METHODS


# --------------------------------------------------------------------------
# Request / result shapes
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class InitializeParams:
    """Parameters for the process-wide SDK handshake.

    TS twin: ``InitializeParams``. ``maxTokens`` is optional; when ``None`` it
    is omitted from the wire frame.
    """
    cwd: str
    provider: str
    model: str
    maxTokens: Optional[int] = None


@dataclass(frozen=True)
class ServerInfo:
    """Wire-stable server identity returned by initialization."""
    name: str = SERVER_INFO_NAME
    version: str = ''


@dataclass(frozen=True)
class InitializeResult:
    """Wire-stable server identity returned by initialization.

    TS twin: ``InitializeResult``.
    """
    serverInfo: ServerInfo


@dataclass(frozen=True)
class ContentBlock:
    """One content block. Only ``type == 'text'`` blocks are audited by this
    SDK; other block kinds pass through the transport verbatim.

    Wire values are normally plain dicts; this dataclass is the typed wrapper
    accepted at the API boundary and serialized on write.
    """
    type: str = 'text'
    text: str = ''


@dataclass(frozen=True)
class SessionPromptParams:
    """One user turn on one SDK session.

    TS twin: ``SessionPromptParams``.
    """
    sessionId: str
    contentBlocks: List[Mapping[str, Any]] = field(default_factory=list)


@dataclass(frozen=True)
class SessionPromptResult:
    """Durable enqueue receipt for one prompt.

    TS twin: ``SessionPromptResult``.
    """
    messageId: str


def validate_initialize_result(value: Any) -> bool:
    """Whether ``value`` is an ``initialize`` result with a server identity."""
    if not is_record(value):
        return False
    server_info = value.get('serverInfo')
    return (is_record(server_info)
            and isinstance(server_info.get('name'), str)
            and isinstance(server_info.get('version'), str))


def validate_session_prompt_result(value: Any) -> bool:
    """Whether ``value`` is a ``session/prompt`` result carrying a message id."""
    return is_record(value) and isinstance(value.get('messageId'), str)


# --------------------------------------------------------------------------
# Notification shapes
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class SessionEventNotification:
    """``session.event`` payload: one session-log event, streamed as recorded.

    TS twin: ``SessionEventNotification``.
    """
    sessionId: str
    event: Mapping[str, Any]


@dataclass(frozen=True)
class SessionStatusNotification:
    """``session.status`` payload: whole-agent lifecycle state for one session.

    TS twin: ``SessionStatusNotification``.
    """
    sessionId: str
    status: str


@dataclass(frozen=True)
class SubagentStartedNotification:
    """``subagent.started`` payload: an in-runtime child session was created.

    TS twin: ``SubagentStartedNotification``.
    """
    parentSessionId: str
    childSessionId: str


@dataclass(frozen=True)
class SubagentFinishedNotification:
    """``subagent.finished`` payload: an in-process subagent run ended.

    TS twin: ``SubagentFinishedNotification``.
    """
    provider: str
    agentId: str
    parentSessionId: str
    childSessionId: str
    status: str
    stopReason: str
    lastAssistantMessage: Optional[List[Mapping[str, Any]]] = None


# --------------------------------------------------------------------------
# Notification validation helpers
# --------------------------------------------------------------------------

def _string_field(value: Any, name: str) -> bool:
    return isinstance(value, dict) and isinstance(value.get(name), str)


def validate_session_event(value: Any) -> bool:
    """Whether ``value`` is a ``session.event`` payload."""
    return _string_field(value, 'sessionId') and is_record(value.get('event'))


def validate_session_status(value: Any) -> bool:
    """Whether ``value`` is a ``session.status`` payload with a known state."""
    if not _string_field(value, 'sessionId'):
        return False
    status = value.get('status')
    return isinstance(status, str) and status in SESSION_STATUSES


def validate_subagent_started(value: Any) -> bool:
    """Whether ``value`` is a ``subagent.started`` payload."""
    return (_string_field(value, 'parentSessionId')
            and _string_field(value, 'childSessionId'))


def validate_subagent_finished(value: Any) -> bool:
    """Whether ``value`` is a ``subagent.finished`` payload."""
    return (_string_field(value, 'provider')
            and _string_field(value, 'agentId')
            and _string_field(value, 'parentSessionId')
            and _string_field(value, 'childSessionId')
            and isinstance(value.get('status'), str))