"""Wire protocol vocabulary for the Python side of flowforge-code-runtime-python.

Mirrors ``src/protocol.ts``. Frames travel as JSON-lines (one JSON object per
line). Read and write directions run on SEPARATE pipes so the bootstrap can read
and write concurrently: on Windows a single pipe handle cannot be blocked-read
and -written from different threads without a second ``os.write`` stalling, so
the host pins the two directions on distinct descriptors id.
"""

from __future__ import annotations

from typing import Any, Literal, TypedDict, Union

# The protocol uses two dedicated pipes in the child:
#   * fd 3 -- host -> child (boot / run / reply); the child only reads it.
#   * fd 4 -- child -> host (boot-ack / call / log / done); the child only writes it.
# Node passes ``stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe']`` so indices
# 3 and 4 are the framed-JSON channels; stdout/stderr stay clear for the
# program's own output.
PROTOCOL_READ_FD = 3
PROTOCOL_WRITE_FD = 4
# Back-compat alias kept for wire-symmetry wording below.
PROTOCOL_READ = PROTOCOL_READ_FD
PROTOCOL_WRITE = PROTOCOL_WRITE_FD


class ErrorClass(TypedDict):
    """A namespace's program-visible exception class."""

    name: str
    memberNameProperty: str


# ``global`` is a Python keyword, so the required part is declared functionally.
_NamespaceRequired = TypedDict("_NamespaceRequired", {"global": str, "names": "list[str]"})


class Namespace(_NamespaceRequired, total=False):
    """One binding namespace declaration."""

    errorClass: ErrorClass


class BootMessage(TypedDict):
    """Host -> child, first frame on fd 3."""

    type: Literal["boot"]
    maxOutputBytes: int
    namespaces: "list[Namespace]"


class RunMessage(TypedDict):
    """Host -> child, sent after ``boot-ack``. Carries only the program body."""

    type: Literal["run"]
    program: str


class BootAckMessage(TypedDict):
    """Child -> host on fd 4: protocol setup complete, ready for the run message."""

    type: Literal["boot-ack"]


CallMessage = TypedDict(
    "CallMessage",
    {"type": Literal["call"], "id": int, "global": str, "name": str, "args": Any},
)


class LogMessage(TypedDict):
    """Child -> host on fd 4: one captured text chunk, streamed eagerly."""

    type: Literal["log"]
    text: str


class DoneErrorField(TypedDict):
    """Child -> host on fd 4: the failure carried on a ``done`` frame."""

    kind: Literal["exception", "invalid-output", "output-limit"]
    message: str


_DoneMessageRequired = TypedDict("_DoneMessageRequired", {"type": Literal["done"]})


class DoneMessage(_DoneMessageRequired, total=False):
    """Child -> host on fd 4: the program settled."""

    value: Any
    error: DoneErrorField


ChildToHost = Union[BootAckMessage, CallMessage, LogMessage, DoneMessage]


class ReplyOk(TypedDict):
    type: Literal["reply"]
    id: int
    ok: Literal[True]
    value: Any


class ReplyErr(TypedDict):
    type: Literal["reply"]
    id: int
    ok: Literal[False]
    message: str


ReplyMessage = Union[ReplyOk, ReplyErr]
# The host sends ``boot`` and ``run`` before any ``reply``.
HostToChild = Union[BootMessage, RunMessage, ReplyMessage]


def log_truncation_marker(max_bytes: int) -> str:
    """In-band marker for a log ledger that exhausted its budget (kept for wire
    symmetry with the host diagnostics; the host owns the outer ledger)."""

    return f"[flowforge-code-runtime-python] log capture truncated at {max_bytes} bytes"