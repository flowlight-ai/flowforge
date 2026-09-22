"""Low-level JSON-RPC client for a FlowForge SDK runtime subprocess (asyncio).

:class:`HarnessClient` owns the child process: it spawns the runtime (lazily),
speaks the ``@flowforge/sdk-protocol`` wire over the child's stdio, fans
server notifications out to subscriptions, and tears the child down to
quiescence through the shared EOF -> SIGTERM -> SIGKILL ladder. The design
twin is the TypeScript ``HarnessClient`` in ``@flowforge/sdk-client``; this
Python class mirrors its behaviour including error types, subscription fan-out,
request/id association, session lineage, and the close ladder.

``py>=3.9``, pure standard library.
"""

import asyncio
from typing import Any, Callable, Dict, List, Mapping, Optional, Sequence

from .dispose import dispose_runtime_process
from .errors import (JsonRpcResponseError, RequestTimeoutError, SdkProtocolError,
                     TransportClosedError)
from .protocol import validate_initialize_result, validate_session_prompt_result
from .transport import JsonRpcLineTransport

#: Retained stderr lines used to diagnose an unexpected runtime death.
STDERR_TAIL_LIMIT = 400
#: Grace for the runtime's stdio streams to settle after its exit edge.
STREAM_SETTLE_MS = 100

#: A single wire notification as delivered to subscriptions.
HarnessNotification = Dict[str, Any]
#: Predicate deciding whether a subscription receives a notification.
NotificationFilter = Callable[[HarnessNotification], bool]


class NotificationSubscription:
    """One client-side notification stream returned by ``HarnessClient.subscribe``.

    ``next()`` waits for the next matching notification, or rejects once the
    runtime dies / the subscription closes (draining already-delivered items
    first, except on an explicit :meth:`close` where the queue is dropped).
    """

    def __init__(self, loop: asyncio.AbstractEventLoop, unsubscribe: Callable[[], None],
                 filter_fn: Optional[NotificationFilter]) -> None:
        self._loop = loop
        self._unsubscribe = unsubscribe
        self._filter = filter_fn
        self._queue: List[HarnessNotification] = []
        self._waiters: List[asyncio.Future] = []
        self._failure: Optional[Exception] = None

    async def next(self) -> HarnessNotification:
        """Await the next matching notification."""
        if self._queue:
            return self._queue.pop(0)
        if self._failure is not None:
            raise self._failure
        fut = self._loop.create_future()
        self._waiters.append(fut)
        return await fut

    def try_next(self) -> Optional[HarnessNotification]:
        """Drain one already-delivered notification without waiting."""
        if self._queue:
            return self._queue.pop(0)
        return None

    def close(self) -> None:
        """Detach from the client; queued items drop and pending waiters reject."""
        self._unsubscribe()
        # The drop is part of this method's contract; a runtime-death fail() keeps
        # the queue so already-delivered notifications remain drainable.
        self._queue.clear()
        self._fail(TransportClosedError('notification subscription closed'))

    def _fail(self, error: Exception) -> None:
        """Reject pending and future waits (the first failure wins). Already-
        queued notifications remain drainable via next()/try_next()."""
        if self._failure is None:
            self._failure = error
            waiters = self._waiters
            self._waiters = []
            for fut in waiters:
                if not fut.done():
                    fut.set_exception(error)

    def push(self, notification: HarnessNotification) -> None:
        """Deliver one notification to a waiter or the queue when the filter
        matches. A throwing filter fails only THIS subscription and never
        disturbs sibling subscriptions or the transport's read loop."""
        if self._filter is not None:
            try:
                matches = bool(self._filter(notification))
            except Exception as error:  # noqa: BLE001 - contained per subscription
                self._unsubscribe()
                self._fail(error if isinstance(error, Exception) else Exception(str(error)))
                return
            if not matches:
                return
        if self._waiters:
            fut = self._waiters.pop(0)
            if not fut.done():
                fut.set_result(notification)
                return
        self._queue.append(notification)


class HarnessClient:
    """JSON-RPC client for the FlowForge SDK runtime over subprocess stdio.

    The subprocess starts lazily on :meth:`start` and is owned by this instance
    until :meth:`close`, which requests protocol ``shutdown`` and then walks the
    shared EOF -> SIGTERM -> SIGKILL ladder. There is no wire-level cancel: a
    timed-out request stays running server-side until the runtime is closed.
    """

    def __init__(
        self,
        command: str,
        args: Optional[Sequence[str]] = None,
        cwd: Optional[str] = None,
        env: Optional[Mapping[str, str]] = None,
        request_timeout_ms: Optional[int] = None,
        shutdown_timeout_ms: int = 1000,
        dispose_eof_grace_ms: int = 6000,
        dispose_grace_ms: int = 3000,
    ) -> None:
        self._command = command
        self._args = list(args) if args is not None else []
        self._cwd = cwd
        # ``None`` env inherits the parent verbatim; passing a dict replaces it.
        self._env = dict(env) if env is not None else None
        self._request_timeout_ms = request_timeout_ms
        self._shutdown_timeout_ms = shutdown_timeout_ms
        self._dispose_eof_grace_ms = dispose_eof_grace_ms
        self._dispose_grace_ms = dispose_grace_ms

        self._loop = asyncio.get_event_loop()
        self._proc: Optional[asyncio.subprocess.Process] = None
        self._transport: Optional[JsonRpcLineTransport] = None
        self._stderr_task: Optional[asyncio.Task] = None
        self._monitor_task: Optional[asyncio.Task] = None
        self._stderr_tail: List[str] = []
        self._subscriptions: Dict[int, NotificationSubscription] = {}
        self._session_parents: Dict[str, str] = {}
        self._subscription_serial = 0
        self._exit_code: Optional[int] = None
        self._spawn_error: Optional[BaseException] = None
        self._close_task: Optional[asyncio.Task] = None

    # -- lifecycle ----------------------------------------------------------

    async def start(self) -> None:
        """Spawn the runtime subprocess and start reading frames. Idempotent
        while the process is live; rejects reuse after :meth:`close`."""
        if self._close_task is not None:
            raise TransportClosedError('FlowForge runtime client is closed')
        if self._proc is not None:
            return
        await self._spawn()

    async def _spawn(self) -> None:
        kwargs: dict = {}
        if self._cwd is not None:
            kwargs['cwd'] = self._cwd
        if self._env is not None:
            kwargs['env'] = self._env
        kwargs.update(stdin=asyncio.subprocess.PIPE,
                      stdout=asyncio.subprocess.PIPE,
                      stderr=asyncio.subprocess.PIPE)
        try:
            proc = await asyncio.create_subprocess_exec(
                self._command, *self._args, **kwargs)
        except (OSError, ValueError) as error:
            self._spawn_error = error
            raise TransportClosedError(
                f'FlowForge runtime failed to start: {error}') from error
        self._proc = proc

        transport = JsonRpcLineTransport(proc.stdout, proc.stdin, self._loop)
        transport.on_notification(self._dispatch_notification)
        transport.start()
        self._transport = transport

        self._stderr_task = asyncio.ensure_future(self._read_stderr())
        self._monitor_task = asyncio.ensure_future(self._monitor())

    async def _read_stderr(self) -> None:
        try:
            while True:
                line = await self._proc.stderr.readline()
                if not line:
                    break
                text = line.decode('utf-8', 'replace').rstrip('\n')
                if text:
                    self._append_stderr([text])
        except (asyncio.CancelledError, ConnectionError, OSError, RuntimeError):
            pass

    async def _monitor(self) -> None:
        try:
            rc = await self._proc.wait()
        except (asyncio.CancelledError, OSError, RuntimeError):
            rc = self._proc.returncode
        self._exit_code = rc
        await self._settle_streams()
        transport = self._transport
        if transport is not None:
            transport.close()
        self._fail_subscriptions(self._closed_error('FlowForge runtime exited'))

    async def _settle_streams(self) -> None:
        await asyncio.sleep(STREAM_SETTLE_MS / 1000.0)

    # -- requests -----------------------------------------------------------

    async def initialize(self, params: dict) -> dict:
        """Perform the process-wide handshake and return the runtime's wire
        identity (validating the ``serverInfo`` shape)."""
        result = await self.request('initialize', dict(params))
        if not validate_initialize_result(result):
            raise SdkProtocolError(
                f'initialize returned no server identity: {result!r}')
        server_info = result.get('serverInfo')
        return {'serverInfo': {'name': server_info.get('name'),
                               'version': server_info.get('version')}}

    async def prompt(self, session_id: str, content_blocks: Sequence[Any]) -> str:
        """Queue one prompt and return its durable inbox message id."""
        params = {'sessionId': session_id, 'contentBlocks': content_blocks}
        result = await self.request('session/prompt', params)
        if not validate_session_prompt_result(result):
            raise SdkProtocolError(f'session/prompt returned no message id: {result!r}')
        return result.get('messageId')

    async def request(self, method: str, params: Any = None,
                      timeout_ms: Optional[int] = None) -> Any:
        """Send one JSON-RPC request and await its result.

        Rejects with :class:`JsonRpcResponseError` on a protocol error
        response, :class:`RequestTimeoutError` on timeout, and
        :class:`TransportClosedError` when the runtime is gone (including exit
        code and stderr tail context).
        """
        if self._close_task is not None:
            raise self._closed_error('FlowForge runtime is not running')
        try:
            await self.start()
        except TransportClosedError:
            await self._settle_streams()
            raise

        if self._exit_code is not None or self._spawn_error is not None:
            await self._settle_streams()
            raise self._closed_error('FlowForge runtime is not running')

        transport = self._transport
        if transport is None:
            raise self._closed_error('FlowForge runtime is not running')

        timeout = timeout_ms if timeout_ms is not None else self._request_timeout_ms
        try:
            return await transport.request(method, params if params is not None else {},
                                           timeout_ms=timeout)
        except (JsonRpcResponseError, RequestTimeoutError):
            raise
        except Exception as error:  # noqa: BLE001 - transport failures gain process context
            await self._settle_streams()
            raise self._closed_error(
                f'{method} request failed: transport error ({error})') from error

    # -- subscriptions ------------------------------------------------------

    def subscribe(self, filter_fn: Optional[NotificationFilter] = None) -> NotificationSubscription:
        """Subscribe to server notifications. ``next()`` rejects instead of
        waiting forever after :meth:`close` or runtime death."""
        sub_id = self._subscription_serial
        self._subscription_serial += 1
        subscription = NotificationSubscription(
            self._loop,
            lambda: self._subscriptions.pop(sub_id, None),
            filter_fn,
        )
        if self._close_task is not None or self._exit_code is not None \
                or self._spawn_error is not None:
            subscription._fail(self._closed_error('FlowForge runtime closed'))
            return subscription
        self._subscriptions[sub_id] = subscription
        return subscription

    def subscribe_session_tree(self, session_id: str) -> NotificationSubscription:
        """Subscribe to one session and descendants discovered from
        ``subagent.started`` lineage edges."""
        def filter_fn(notification: HarnessNotification) -> bool:
            params = notification.get('params') or {}
            method = notification.get('method')
            if method in ('subagent.started', 'subagent.finished'):
                parent_id = params.get('parentSessionId')
                if isinstance(parent_id, str) and self.is_descendant_of(parent_id, session_id):
                    return True
                return params.get('childSessionId') == session_id
            related_id = params.get('sessionId')
            return isinstance(related_id, str) and self.is_descendant_of(related_id, session_id)
        return self.subscribe(filter_fn)

    # -- session lineage ----------------------------------------------------

    def record_session_relationship(self, notification: HarnessNotification) -> None:
        """Store a ``subagent.started`` parent->child edge, guarding against
        empty/self edges and cycles."""
        if notification.get('method') != 'subagent.started':
            return
        params = notification.get('params') or {}
        parent_id = params.get('parentSessionId')
        child_id = params.get('childSessionId')
        if (isinstance(parent_id, str) and parent_id != ''
                and isinstance(child_id, str) and child_id != ''
                and parent_id != child_id):
            self._session_parents[child_id] = parent_id

    @property
    def session_parents(self) -> Mapping[str, str]:
        """Read-only view of the child->parent lineage map (for tests/diagnostics)."""
        return dict(self._session_parents)

    def is_descendant_of(self, session_id: str, root_session_id: str) -> bool:
        """Whether ``session_id`` is ``root_session_id`` or descends from it."""
        visited = set()
        current = session_id
        while current not in visited:
            if current == root_session_id:
                return True
            visited.add(current)
            parent = self._session_parents.get(current)
            if parent is None:
                return False
            current = parent
        # The parent map only ever extends chains upward, so a cycle cannot form.
        return False

    # -- teardown -----------------------------------------------------------

    async def close(self) -> None:
        """Shut the runtime down and reap it: a best-effort protocol
        ``shutdown`` bounded by ``shutdown_timeout_ms``, then the EOF ->
        SIGTERM -> SIGKILL ladder. Idempotent and terminal."""
        if self._close_task is None:
            self._close_task = asyncio.ensure_future(self._perform_close())
        await self._close_task

    async def _perform_close(self) -> None:
        proc = self._proc
        if proc is None:
            return
        try:
            await self.request('shutdown', None, self._shutdown_timeout_ms)
        except Exception as error:  # noqa: BLE001 - diagnostic only
            self._append_stderr([f'shutdown request failed: {error}'])
        await dispose_runtime_process(
            proc,
            dispose_eof_grace_ms=self._dispose_eof_grace_ms,
            dispose_grace_ms=self._dispose_grace_ms,
        )
        transport = self._transport
        if transport is not None:
            transport.close()
        self._exit_code = proc.returncode or self._exit_code
        self._fail_subscriptions(self._closed_error('FlowForge runtime closed'))

    # -- internals ----------------------------------------------------------

    def _dispatch_notification(self, method: str, params: Any) -> None:
        notification = {'method': method, 'params': params if isinstance(params, dict) else {}}
        self.record_session_relationship(notification)
        for subscription in list(self._subscriptions.values()):
            subscription.push(notification)

    def _fail_subscriptions(self, error: Exception) -> None:
        for subscription in list(self._subscriptions.values()):
            subscription._fail(error)

    def _append_stderr(self, lines: List[str]) -> None:
        kept = [line for line in lines if len(line) > 0]
        self._stderr_tail.extend(kept)
        if len(self._stderr_tail) > STDERR_TAIL_LIMIT:
            del self._stderr_tail[:len(self._stderr_tail) - STDERR_TAIL_LIMIT]

    def _closed_error(self, reason: str) -> TransportClosedError:
        parts = [reason]
        if self._spawn_error is not None:
            parts.append(f'spawn error: {self._spawn_error}')
        if self._exit_code is not None:
            parts.append(f'exit code: {self._exit_code}')
        if self._stderr_tail:
            parts.append('stderr tail:\n' + '\n'.join(self._stderr_tail))
        return TransportClosedError('\n'.join(parts))

    @property
    def process(self) -> Optional[asyncio.subprocess.Process]:
        """The live runtime child process, or ``None`` before start."""
        return self._proc


__all__ = [
    'HarnessClient',
    'NotificationSubscription',
    'STDERR_TAIL_LIMIT',
    'STREAM_SETTLE_MS',
]