"""Newline-delimited JSON-RPC 2.0 transport over asyncio stdio streams.

:class:`JsonRpcLineTransport` reads frames from a child process's stdout one
line at a time, associates request/response pairs by an incrementing ``id``
into ``asyncio.Future``s, and fans server notifications out to registered
callbacks. It is the Python mirror of the TS transport used by
``@flowforge/sdk-client``.

Writes use ``json.dumps(..., ensure_ascii=False)`` on the child's stdin, one
frame per line. Timeouts and explicit aborts abandon the pending entry so
repeated bounded requests against a hung method retain no per-call state; the
server-side work still runs to completion.

``py>=3.9``, pure standard library.
"""

import asyncio
import dataclasses
import json
from typing import Any, Callable, Dict, List, Optional

from .errors import JsonRpcResponseError, RequestTimeoutError, TransportClosedError
from .protocol import PROTOCOL_VERSION, is_record

#: Number of milliseconds a steady write drain may block before failing.
_WRITE_TIMEOUT_MS = 5000


def _json_default(value: Any) -> Any:
    """Default ``json.dumps`` encoder: dataclass instances serialize via
    :func:`dataclasses.asdict`; everything else is rejected."""
    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        return dataclasses.asdict(value)
    raise TypeError(
        f'Object of type {type(value).__name__} is not JSON serializable')


#: Matching callback signature for :meth:`JsonRpcLineTransport.on_notification`.
NotificationCallback = Callable[[str, Any], None]


class JsonRpcLineTransport:
    """Line-framed JSON-RPC 2.0 transport over an asyncio reader/writer pair.

    The ``reader`` is an ``asyncio.StreamReader`` (e.g. ``proc.stdout``); the
    ``writer`` is the corresponding ``asyncio.StreamWriter`` (``proc.stdin``).
    """

    def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter,
                 loop: Optional[asyncio.AbstractEventLoop] = None) -> None:
        self._loop = loop or asyncio.get_event_loop()
        self._reader = reader
        self._writer = writer
        self._pending: Dict[Any, asyncio.Future] = {}
        self._notifications: List[NotificationCallback] = []
        self._next_id = 0
        self._closed = False
        self._reader_task: Optional[asyncio.Task] = None

    # -- lifecycle ----------------------------------------------------------

    def start(self) -> None:
        """Begin reading frames from the reader stream. Idempotent."""
        if self._reader_task is None and not self._closed:
            self._reader_task = asyncio.ensure_future(self._read_loop())

    def close(self) -> None:
        """Close the transport: stop reading and fail every pending request.

        Idempotent. Pending requests are rejected with a
        :class:`TransportClosedError`.
        """
        if self._closed:
            return
        self._closed = True
        current = asyncio.current_task()
        if self._reader_task is not None and self._reader_task is not current:
            self._reader_task.cancel()
        error = TransportClosedError('transport closed')
        for fut in list(self._pending.values()):
            if not fut.done():
                fut.set_exception(error)
            else:
                fut.cancel()
        self._pending.clear()

    @property
    def closed(self) -> bool:
        return self._closed

    # -- notifications ------------------------------------------------------

    def on_notification(self, callback: NotificationCallback) -> None:
        """Register a callback invoked (in order) for every server
        notification. A throwing callback is contained and never disturbs the
        read loop or sibling callbacks.
        """
        self._notifications.append(callback)

    # -- requests -----------------------------------------------------------

    async def request(self, method: str, params: Any = None,
                      timeout_ms: Optional[int] = None) -> Any:
        """Send one JSON-RPC request and await its result.

        :param method: wire method name.
        :param params: params object; ``None`` sends ``{}``.
        :param timeout_ms: per-call bound; ``None`` waits indefinitely.
        :raises JsonRpcResponseError: on a JSON-RPC ``error`` response.
        :raises RequestTimeoutError: on timeout (pending entry abandoned).
        :raises TransportClosedError: when the transport is closed.
        """
        if self._closed:
            raise TransportClosedError('transport closed')

        msg_id = self._next_id
        self._next_id += 1
        fut: asyncio.Future = self._loop.create_future()
        self._pending[msg_id] = fut
        try:
            await self._write_request(method, params, msg_id)
        except BaseException:
            self._pending.pop(msg_id, None)
            raise

        try:
            if timeout_ms is not None and timeout_ms > 0:
                return await asyncio.wait_for(fut, timeout_ms / 1000.0)
            return await fut
        except asyncio.TimeoutError:
            self._pending.pop(msg_id, None)
            raise RequestTimeoutError(
                f'{method} timed out after {timeout_ms}ms waiting for the '
                'FlowForge runtime') from None
        finally:
            # The read loop removes the entry for answered requests; the
            # timeout path above already popped it. Pop defensively so no map
            # entry survives an outer cancellation either.
            self._pending.pop(msg_id, None)

    # -- internal -----------------------------------------------------------

    async def _read_loop(self) -> None:
        try:
            while not self._closed:
                line = await self._reader.readline()
                if not line:
                    break
                text = line.decode('utf-8', 'replace').strip()
                if not text:
                    continue
                try:
                    frame = json.loads(text)
                except ValueError as exc:  # malformed non-JSON line: skip
                    self._emit_protocol_error(
                        f'malformed JSON frame: {text!r} ({exc})')
                    continue
                if is_record(frame):
                    self._handle_frame(frame)
        except asyncio.CancelledError:
            raise
        except (asyncio.IncompleteReadError, ConnectionError, OSError,
                RuntimeError, ValueError):
            pass
        finally:
            self.close()

    def _emit_protocol_error(self, message: str) -> None:
        # A malformed frame does not kill the loop; callbacks observe it.
        for callback in list(self._notifications):
            callback('__sdk/protocol_error', message)

    def _handle_frame(self, frame: dict) -> None:
        if 'id' in frame:
            self._resolve_response(frame)
            return
        method = frame.get('method')
        if not isinstance(method, str):
            return
        params = frame.get('params')
        for callback in list(self._notifications):
            try:
                callback(method, params)
            except Exception:  # noqa: BLE001 - contained per subscription
                pass

    def _resolve_response(self, frame: dict) -> None:
        msg_id = frame.get('id')
        fut = self._pending.get(msg_id)
        # A future that is empty/done means the request was abandoned or already
        # answered; its server-side work still executes to completion.
        if fut is None or fut.done():
            return
        self._pending.pop(msg_id, None)
        if 'error' in frame and is_record(frame.get('error')):
            error = frame.get('error') or {}
            code = error.get('code')
            message = error.get('message') if isinstance(error.get('message'), str) else ''
            fut.set_exception(
                JsonRpcResponseError(code=code, message=message, data=error.get('data')))
        else:
            fut.set_result(frame.get('result'))

    async def _write_request(self, method: str, params: Any, msg_id: Any) -> None:
        if params is None:
            params = {}
        frame = {
            'jsonrpc': PROTOCOL_VERSION,
            'id': msg_id,
            'method': method,
            'params': params,
        }
        try:
            payload = json.dumps(frame, ensure_ascii=False, default=_json_default)
        except (TypeError, ValueError) as exc:
            raise TransportClosedError(
                f'request frame is not serializable: {exc}') from exc

        if self._writer is None or self._writer.is_closing():
            raise TransportClosedError('transport closed')
        self._writer.write(payload.encode('utf-8') + b'\n')
        try:
            await asyncio.wait_for(self._writer.drain(), _WRITE_TIMEOUT_MS / 1000.0)
        except asyncio.TimeoutError as exc:
            raise TransportClosedError('transport write timed out') from exc
        except (ConnectionError, BrokenPipeError, OSError, RuntimeError) as exc:
            raise TransportClosedError(
                f'transport write failed: {exc!r}') from exc