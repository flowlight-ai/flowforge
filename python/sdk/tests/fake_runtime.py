#!/usr/bin/env python3
"""Scripted stand-in for the FlowForge SDK runtime, driven entirely by config
-- no model, no network. Speaks the runtime's newline-delimited JSON-RPC
protocol on stdio: answers ``initialize``, ``session/prompt`` (streaming an
inbox receipt, ``session.event`` turn events, then ``session.status`` idle)
and ``shutdown``.

Two usage modes:

1. **Executable** (spawned via ``sys.executable``): reads config from a JSON
   file passed as argv[1], or from environment variables when no file is given.
2. **In-process**: import :func:`run_runtime` and drive it with an in-memory
   ``reader``/``writer`` pair for unit tests.

Config keys (all optional): ``text``, ``subagent``, ``hang_init``,
``hang_prompt``, ``hang_shutdown``, ``init_error`` (JSON-RPC code 7),
``malformed`` (returns ``{}`` for init/prompt), ``exit_before_init``,
``ignore_eof``, ``stderr``, ``echo_cwd_in_init``, ``fixed_message_id``.
"""

import asyncio
import json
import os
import signal
import sys
from typing import Any, Dict, Optional

# Keep the wire identity identical to the real runtime.
SERVER_INFO_NAME = 'flowforge-sdk-runtime'
VERSION = '0.0.1'


def _is_record(value: Any) -> bool:
    return isinstance(value, dict)


async def _write_frame(writer: Any, frame: Dict[str, Any]) -> None:
    data = (json.dumps(frame, separators=(',', ':')) + '\n').encode('utf-8')
    try:
        writer.write(data)
        if hasattr(writer, 'drain'):
            await writer.drain()
        else:  # pragma: no cover - executable path flushes on write
            pass
    except (ConnectionError, OSError, RuntimeError):
        pass


async def _respond(writer: Any, msg_id: Any, result: Dict[str, Any]) -> None:
    await _write_frame(writer, {'jsonrpc': '2.0', 'id': msg_id, 'result': result})


async def _respond_error(writer: Any, msg_id: Any, code: int, message: str) -> None:
    await _write_frame(writer, {'jsonrpc': '2.0', 'id': msg_id, 'error': {
        'code': code, 'message': message}})


async def _notify(writer: Any, method: str, params: Dict[str, Any]) -> None:
    await _write_frame(writer, {'jsonrpc': '2.0', 'method': method, 'params': params})


async def _event(writer: Any, session_id: str, type_: str, data: Dict[str, Any],
                 seq: Dict[str, int]) -> None:
    seq['n'] += 1
    await _notify(writer, 'session.event', {
        'sessionId': session_id,
        'event': {'type': type_, 'seq': seq['n'], 'time': 0, 'data': data},
    })


def _session_id_of(params: Any) -> str:
    value = params.get('sessionId') if _is_record(params) else None
    return value if isinstance(value, str) else ''


async def _stream_turn(writer: Any, session_id: str, cfg: Dict[str, Any],
                       seq: Dict[str, int], message_id: str) -> None:
    text = cfg.get('text') or 'hello from fake runtime'
    await _event(writer, session_id, 'turn/start', {'turn': 0}, seq)
    await _event(writer, session_id, 'assistant/message', {
        'turn': 0,
        'step': 0,
        'message': {
            'id': f'fake-assistant-{message_id}',
            'role': 'assistant',
            'content': [{'type': 'text', 'text': text}],
            'source': {'kind': 'model', 'provider': 'fake', 'model': 'fake'},
        },
    }, seq)
    if cfg.get('subagent'):
        child_id = f'{session_id}-child'
        await _notify(writer, 'subagent.started',
                      {'parentSessionId': session_id, 'childSessionId': child_id})
        await _event(writer, child_id, 'assistant/message', {
            'turn': 0, 'step': 0,
            'content': [{'type': 'text', 'text': 'child says hi'}],
        }, seq)
        await _notify(writer, 'subagent.finished', {
            'provider': 'spawn', 'agentId': child_id,
            'parentSessionId': session_id, 'childSessionId': child_id,
            'status': 'ok', 'stopReason': 'completed',
            'lastAssistantMessage': [{'type': 'text', 'text': 'child says hi'}],
        })


async def _handle_request(writer: Any, frame: Dict[str, Any], cfg: Dict[str, Any],
                          seq: Dict[str, int]) -> bool:
    """Handle one request frame. Returns ``True`` to continue, ``False`` when
    the fake should stop serving (a cooperative shutdown without ignore_eof)."""
    if frame.get('method') is None or 'id' not in frame:
        return True
    method = frame['method']
    msg_id = frame['id']
    params = frame.get('params') if _is_record(frame.get('params')) else {}

    if method == 'initialize':
        if not cfg.get('hang_init'):
            if cfg.get('init_error'):
                await _respond_error(writer, msg_id, 7, 'scripted init failure')
            elif cfg.get('malformed'):
                await _respond(writer, msg_id, {})
            else:
                version = os.getcwd() if cfg.get('echo_cwd_in_init') else cfg.get('version', VERSION)
                await _respond(writer, msg_id, {
                    'serverInfo': {'name': SERVER_INFO_NAME, 'version': version}})
        return True

    if method == 'session/prompt':
        session_id = _session_id_of(params)
        message_id = cfg.get('fixed_message_id') or f'fake-user-{seq["n"]}'
        if not cfg.get('skip_inbox'):
            await _event(writer, session_id, 'agent/inbox/spliced', {
                'target': 'next-turn', 'start': 0,
                'inserted': [{'id': message_id, 'role': 'user', 'content': [],
                              'source': {'kind': 'user'}}],
            }, seq)
        if not cfg.get('skip_status_running'):
            await _notify(writer, 'session.status',
                          {'sessionId': session_id, 'status': 'running'})
        if not (cfg.get('hang_prompt') or cfg.get('malformed')):
            await _stream_turn(writer, session_id, cfg, seq, message_id)
        if not (cfg.get('hang_prompt') or cfg.get('skip_status_idle')):
            await _notify(writer, 'session.status',
                          {'sessionId': session_id, 'status': 'idle'})
        if not cfg.get('hang_prompt'):
            if cfg.get('malformed'):
                await _respond(writer, msg_id, {})
            else:
                await _respond(writer, msg_id, {'messageId': message_id})
        return True

    if method == 'shutdown':
        if cfg.get('hang_shutdown'):
            return True
        await _respond(writer, msg_id, {})
        if not cfg.get('ignore_eof'):
            try:
                writer.close()
            except Exception:  # noqa: BLE001
                pass
            return False
        return True

    await _respond_error(writer, msg_id, -32603, f'unknown method: {method}')
    return True


async def run_runtime(reader: Any, writer: Any, cfg: Optional[Dict[str, Any]] = None) -> int:
    """Serve the runtime protocol from ``reader`` writing to ``writer`` until
    EOF or a cooperative shutdown. Returns the desired exit code (0)."""
    cfg = dict(cfg or {})
    seq = {'n': 0}
    while True:
        line = await reader.readline()
        if not line:
            break
        text = line.decode('utf-8', 'replace').strip()
        if not text:
            continue
        try:
            frame = json.loads(text)
        except ValueError:
            continue
        if not _is_record(frame):
            continue
        if not await _handle_request(writer, frame, cfg, seq):
            break
    return 0


def _load_config(argv: Any) -> Dict[str, Any]:
    """Build a config from a JSON file (argv[1]) or environment variables."""
    if argv and isinstance(argv[0], str) and os.path.isfile(argv[0]):
        with open(argv[0], 'r', encoding='utf-8') as handle:
            cfg = json.load(handle)
        return cfg if _is_record(cfg) else {}

    def env_bool(name: str) -> bool:
        return os.environ.get(name) is not None

    return {
        'text': os.environ.get('FAKE_TEXT'),
        'subagent': env_bool('FAKE_SUBAGENT'),
        'hang_init': env_bool('FAKE_HANG_INIT'),
        'hang_prompt': env_bool('FAKE_HANG_PROMPT'),
        'hang_shutdown': env_bool('FAKE_HANG_SHUTDOWN'),
        'init_error': env_bool('FAKE_INIT_ERROR'),
        'malformed': env_bool('FAKE_MALFORMED'),
        'exit_before_init': env_bool('FAKE_EXIT_BEFORE_INIT'),
        'ignore_eof': env_bool('FAKE_IGNORE_EOF'),
        'stderr': os.environ.get('FAKE_STDERR'),
        'echo_cwd_in_init': env_bool('FAKE_ECHO_CWD_IN_INIT'),
    }


class _SyncStdioWriter:
    """Blocking stdio writer (no asyncio pipe transport needed). flushes on
    every write, which is exactly the per-frame flushing the transport needs."""

    def write(self, data: bytes) -> None:
        try:
            sys.stdout.buffer.write(data)
            sys.stdout.buffer.flush()
        except (BrokenPipeError, OSError):
            pass

    async def drain(self) -> None:  # pragma: no cover - no-op after blocking write
        pass


async def _run_stdio(cfg: Dict[str, Any]) -> int:
    """Serve the protocol reading stdin lines in a worker thread (portable on
    POSIX and Windows, unlike asyncio pipe transports on ``sys.stdin``)."""
    loop = asyncio.get_running_loop()
    writer = _SyncStdioWriter()
    seq = {'n': 0}
    while True:
        line = await loop.run_in_executor(None, sys.stdin.readline)
        if not line:
            break
        text = line.strip()
        if not text:
            continue
        try:
            frame = json.loads(text)
        except ValueError:
            continue
        if not _is_record(frame):
            continue
        if not await _handle_request(writer, frame, cfg, seq):
            break
    return 0


def main(argv: Any = None) -> int:
    argv = list(argv if argv is not None else sys.argv[1:])
    cfg = _load_config(argv)
    if cfg.get('exit_before_init'):
        # Stderr line the diagnostic-tail test can observe before the exit.
        sys.stderr.write('fake runtime exiting before initialize\n')
        return 3
    if cfg.get('stderr'):
        sys.stderr.write(f'{cfg["stderr"]}\n')
        sys.stderr.flush()

    if cfg.get('ignore_eof'):
        # Keep the process alive past EOF so a dispose ladder must escalate.
        def _on_term(_signum: int, _frame: Any) -> None:
            sys.exit(0)
        signal.signal(signal.SIGTERM, _on_term)

    try:
        return asyncio.run(_run_stdio(cfg))
    except (asyncio.CancelledError, KeyboardInterrupt):
        return 130


if __name__ == '__main__':
    sys.exit(main())