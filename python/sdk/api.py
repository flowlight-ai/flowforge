"""High-level run API over :class:`~flowforge.sdk.client.HarnessClient`.

:class:`FlowForgeHarness` owns one runtime subprocess across many sessions;
:class:`HarnessSession`.run sends a prompt and settles when the whole agent
next becomes idle. Mirrors ``@flowforge/sdk-client/api.ts`` including the
"whole idle round" semantics: prompt -> inbox receipt -> collect events ->
``session.status == 'idle'``.

``py>=3.9``, pure standard library.
"""

import asyncio
import os
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Optional, Sequence

from .client import HarnessClient
from .errors import SdkProtocolError
from .protocol import is_record

#: Default provider/model route for SDK-created agents.
DEFAULT_PROVIDER = 'deepseek-official'
DEFAULT_MODEL = 'deepseek-v4-flash'
#: Default runtime launch command/args when none is supplied.
DEFAULT_COMMAND = 'flowforge'
DEFAULT_ARGS = ('--profile', 'sdk')


@dataclass
class HarnessRunResult:
    """One owned session activity interval, from enqueue receipt through idle."""
    session_id: str
    final_response: str
    events: List[dict]
    notifications: List[Dict[str, Any]] = field(default_factory=list)


class FlowForgeHarness:
    """Reusable SDK for running FlowForge agent turns in a runtime subprocess.

    The subprocess starts lazily on first use and stays owned by this instance
    until :meth:`close`; always close (or ``async with``) so the child is
    reaped. A failed ``initialize`` reaps its runtime and swaps in a fresh
    client, so a later call retries with a new subprocess (unless already
    closed).

    ``async with FlowForgeHarness() as harness: ...`` is supported.
    """

    def __init__(
        self,
        command: Optional[str] = None,
        args: Optional[Sequence[str]] = None,
        *,
        cwd: Optional[str] = None,
        provider: str = DEFAULT_PROVIDER,
        model: str = DEFAULT_MODEL,
        max_tokens: Optional[int] = None,
        env: Optional[Mapping[str, str]] = None,
        request_timeout_ms: Optional[int] = None,
        shutdown_timeout_ms: int = 1000,
        dispose_eof_grace_ms: int = 6000,
        dispose_grace_ms: int = 3000,
    ) -> None:
        self._launch_command = command if command is not None else DEFAULT_COMMAND
        self._launch_args = list(args) if args is not None else list(DEFAULT_ARGS)
        self._launch = {
            'command': self._launch_command,
            'args': self._launch_args,
            'cwd': cwd,
            'env': env,
            'request_timeout_ms': request_timeout_ms,
            'shutdown_timeout_ms': shutdown_timeout_ms,
            'dispose_eof_grace_ms': dispose_eof_grace_ms,
            'dispose_grace_ms': dispose_grace_ms,
        }
        self._cwd = os.path.abspath(cwd or os.getcwd())
        self._provider = provider
        self._model = model
        self._max_tokens = max_tokens
        self._loop = asyncio.get_event_loop()
        self._client = self._new_client()
        self._initialized: Optional[asyncio.Task] = None
        self._closed = False

    def _new_client(self) -> HarnessClient:
        launch = self._launch
        return HarnessClient(
            launch['command'],
            args=launch['args'],
            cwd=launch['cwd'],
            env=launch['env'],
            request_timeout_ms=launch['request_timeout_ms'],
            shutdown_timeout_ms=launch['shutdown_timeout_ms'],
            dispose_eof_grace_ms=launch['dispose_eof_grace_ms'],
            dispose_grace_ms=launch['dispose_grace_ms'],
        )

    @property
    def client(self) -> HarnessClient:
        """The underlying JSON-RPC client currently owning the runtime
        subprocess (do not cache across a failed start)."""
        return self._client

    async def start(self) -> None:
        """Start the subprocess and perform the ``initialize`` handshake once.
        On failure the runtime is reaped and a fresh client replaces it, so a
        later call retries unless :meth:`close` already ended this harness."""
        if self._initialized is None:
            async def _init() -> None:
                try:
                    await self._client.start()
                    params: dict = {'cwd': self._cwd,
                                    'provider': self._provider,
                                    'model': self._model}
                    if self._max_tokens is not None:
                        params['maxTokens'] = self._max_tokens
                    await self._client.initialize(params)
                except Exception:
                    self._initialized = None
                    await self._safe_reap()
                    if not self._closed:
                        self._client = self._new_client()
                    raise
            self._initialized = asyncio.ensure_future(_init())
        await self._initialized

    async def _safe_reap(self) -> None:
        try:
            await self._client.close()
        except Exception:  # noqa: BLE001 - best-effort reap on handshake failure
            pass

    def session(self, session_id: Optional[str] = None) -> 'HarnessSession':
        """Open a session handle (no wire traffic; the runtime creates the
        session on its first prompt)."""
        sid = session_id if session_id is not None else f'session-{uuid.uuid4().hex}'
        return HarnessSession(self, sid)

    async def run(self, input: Any, session_id: Optional[str] = None,
                  on_notification: Optional[Any] = None) -> HarnessRunResult:
        """Run one prompt on a fresh (or named) session."""
        return await self.session(session_id).run(input, on_notification=on_notification)

    async def close(self) -> None:
        """Shut down and reap the runtime subprocess. Idempotent and terminal."""
        self._closed = True
        await self._client.close()

    # -- async context manager ---------------------------------------------

    async def __aenter__(self) -> 'FlowForgeHarness':
        return self

    async def __aexit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        await self.close()


class HarnessSession:
    """One SDK session: a stable id plus owned activity intervals."""

    def __init__(self, harness: FlowForgeHarness, id: str) -> None:
        self.harness = harness
        self.id = id

    async def run(self, input: Any,
                  on_notification: Optional[Any] = None) -> HarnessRunResult:
        """Queue one prompt, then observe the whole session through its next idle.

        Rejects on transport loss, timeout, a malformed notification, or a
        protocol error. ``on_notification`` (if given) is invoked with every
        notification for this session tree, in wire order.
        """
        await self.harness.start()
        client = self.harness.client
        content_blocks = normalize_input(input)
        events: List[dict] = []
        notifications: List[Dict[str, Any]] = []

        subscription = client.subscribe_session_tree(self.id)

        def collect(notification: Dict[str, Any], event: dict) -> None:
            notifications.append(notification)
            events.append(event)
            if on_notification is not None:
                on_notification(notification)

        try:
            message_id = await client.prompt(self.id, content_blocks)
            received = False
            while True:
                notification = await subscription.next()
                if notification.get('method') == 'session.event' \
                        and notification.get('params', {}).get('sessionId') == self.id:
                    event = validated_session_event(notification.get('params', {}).get('event'))
                    if not received:
                        if not is_inbox_receipt(event, message_id):
                            continue
                        received = True
                    collect(notification, event)
                else:
                    notifications.append(notification)
                    if on_notification is not None:
                        on_notification(notification)
                if notification.get('method') == 'session.status' \
                        and notification.get('params', {}).get('sessionId') == self.id \
                        and notification.get('params', {}).get('status') == 'idle':
                    break
        finally:
            subscription.close()

        return HarnessRunResult(
            session_id=self.id,
            final_response=final_response(events),
            events=events,
            notifications=notifications,
        )


def normalize_input(input: Any) -> List[dict]:
    """Normalize run input: a string becomes one text block; a sequence of
    content-block mappings passes through verbatim."""
    if isinstance(input, str):
        return [{'type': 'text', 'text': input}]
    if isinstance(input, Sequence) and not isinstance(input, (str, bytes)):
        return [dict(block) for block in input]
    raise TypeError('input must be a string or a sequence of content blocks')


def validated_session_event(value: Any) -> dict:
    """Validate the fields in a wire ``session.event`` envelope before returning
    the typed result, raising :class:`SdkProtocolError` on malformed shapes."""
    if not is_record(value) or not isinstance(value.get('type'), str):
        raise SdkProtocolError(f'session.event carried no event envelope: {value!r}')
    # The one variant this module reads into (finalResponse) must carry
    # kind-tagged content blocks; other variants pass through under their shape.
    if value.get('type') == 'assistant/message':
        data = value.get('data') if is_record(value.get('data')) else {}
        message = data.get('message') if is_record(data.get('message')) else {}
        content = message.get('content') if is_record(message) else None
        if not isinstance(content, list) or not all(
                is_record(block) and isinstance(block.get('type'), str) for block in content):
            raise SdkProtocolError(
                f'assistant/message event carried malformed content: {value!r}')
    return value


def is_inbox_receipt(value: dict, message_id: str) -> bool:
    """Whether a validated session event is the durable enqueue receipt for
    ``message_id`` (``agent/inbox/spliced`` whose inserted messages contain it)."""
    if not is_record(value) or value.get('type') != 'agent/inbox/spliced' \
            or not is_record(value.get('data')):
        return False
    inserted = value['data'].get('inserted')
    return (isinstance(inserted, list)
            and any(is_record(message) and message.get('id') == message_id
                    for message in inserted))


def final_response(events: Sequence[dict]) -> str:
    """Concatenated text of the last assistant message; ``''`` when none."""
    for event in reversed(events):
        if not isinstance(event, dict) or event.get('type') != 'assistant/message':
            continue
        data = event.get('data') if is_record(event.get('data')) else {}
        message = data.get('message') if is_record(data.get('message')) else {}
        content = message.get('content')
        if not isinstance(content, list):
            continue
        return ''.join(
            block.get('text', '')
            for block in content
            if is_record(block) and block.get('type') == 'text'
            and isinstance(block.get('text'), str)
        )
    return ''


__all__ = [
    'FlowForgeHarness',
    'HarnessSession',
    'HarnessRunResult',
    'normalize_input',
    'validated_session_event',
    'is_inbox_receipt',
    'final_response',
]