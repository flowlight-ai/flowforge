"""Error hierarchy for the Python FlowForge SDK (design twin of the TypeScript
`@flowforge/sdk-client` error surface).

All SDK-raised failures derive from :class:`SdkError` so callers can catch a
single base type. The four concrete types mirror the TS client:

- :class:`TransportClosedError` -- the runtime subprocess is gone or unusable
  (exited, stdio closed, or never launchable); carries an exit code and a
  stderr tail as diagnostic context.
- :class:`RequestTimeoutError` -- a request exceeded its per-call timeout.
- :class:`SdkProtocolError` -- the runtime answered outside its documented
  protocol shape.
- :class:`JsonRpcResponseError` -- the runtime returned a JSON-RPC ``error``
  response for a request.

``py>=3.9``, pure standard library.
"""

from typing import Any, Optional


class SdkError(Exception):
    """Base class for every error raised by this SDK."""


class TransportClosedError(SdkError):
    """The runtime subprocess is gone or unusable.

    TS twin: ``TransportClosedError``. The message includes an exit code and a
    retained stderr tail when available.
    """

    def __init__(self, message: str, *, exit_code: Optional[int] = None,
                 stderr_tail: Optional[str] = None) -> None:
        super().__init__(message)
        self.message = message
        self.exit_code = exit_code
        self.stderr_tail = stderr_tail

    def __str__(self) -> str:  # pragma: no cover - convenience only
        return self.message


class RequestTimeoutError(SdkError):
    """A request exceeded the allowed timeout.

    TS twin: ``RequestTimeoutError``.
    """

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class SdkProtocolError(SdkError):
    """The runtime answered outside its documented protocol.

    TS twin: ``SdkProtocolError``.
    """

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class JsonRpcResponseError(SdkError):
    """A JSON-RPC ``error`` response for a specific request.

    TS twin: ``JsonRpcResponseError``. Carries the wire ``code``/``message``
    and an optional ``data`` payload.
    """

    def __init__(self, code: Optional[Any], message: str, data: Optional[Any] = None) -> None:
        text = message if isinstance(message, str) and message else f'JSON-RPC error {code}'
        super().__init__(text)
        self.code = code
        self.data = data

    def __str__(self) -> str:  # pragma: no cover - convenience only
        return self.args[0] if self.args else 'JSON-RPC error'