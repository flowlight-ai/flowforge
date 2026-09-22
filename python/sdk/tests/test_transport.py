"""Tests for JsonRpcLineTransport over an in-memory linked reader/writer pair.

An in-memory pair is used instead of a loopback TCP connection: on the Windows
Proactor loop an unclosed TCP transport can keep the event loop (and therefore
``asyncio.run``) alive at teardown. Feeding ``asyncio.StreamReader`` directly
with ``feed_data`` exercises the same ``readline``/``drain`` code paths with no
OS resources to leak.
"""

import asyncio
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _helpers import transport as transport_mod  # noqa: E402
from fake_runtime import run_runtime  # noqa: E402
from sdk.errors import (JsonRpcResponseError, RequestTimeoutError,  # noqa: E402
                        TransportClosedError)

LATENCY = 0.01


class _FakeStream:
    """Minimal writer whose ``write`` feeds the peer's ``StreamReader``.

    Mirrors the small writer surface the transport / runtime touch:
    ``write``, ``drain``, ``is_closing`` and ``close``.
    """

    def __init__(self, peer_reader: asyncio.StreamReader) -> None:
        self._peer_reader = peer_reader
        self._closed = False

    def is_closing(self) -> bool:
        return self._closed

    def write(self, data: bytes) -> None:
        if not self._closed:
            self._peer_reader.feed_data(data)

    def close(self) -> None:
        if not self._closed:
            self._closed = True
            self._peer_reader.feed_eof()

    async def drain(self) -> None:  # pragma: no cover - no buffering to wait for
        return None


def linked_pair():
    """Return ``(client_reader, client_writer, server_reader, server_writer)``
    where each writer feeds the other endpoint's reader."""
    client_reader = asyncio.StreamReader()
    server_reader = asyncio.StreamReader()
    client_writer = _FakeStream(server_reader)
    server_writer = _FakeStream(client_reader)
    return client_reader, client_writer, server_reader, server_writer


async def _fn_responder(reader, writer):
    """Answer each request frame with ``{'received_n': n}`` using the same id."""
    while True:
        line = await reader.readline()
        if not line:
            break
        text = line.decode('utf-8', 'replace').strip()
        if not text:
            continue
        frame = json.loads(text)
        n = None
        params = frame.get('params')
        if isinstance(params, dict):
            n = params.get('n')
        writer.write((json.dumps(
            {'jsonrpc': '2.0', 'id': frame.get('id'), 'result': {'received_n': n}}
        ) + '\n').encode('utf-8'))
        await writer.drain()
    writer.close()


async def _notify_responder(reader, writer):
    """Answer nothing, but emit two canned notifications up front."""
    for method, params in [('session.event', {'sessionId': 's1'}),
                           ('subagent.started', {'parentSessionId': 'p', 'childSessionId': 'c'})]:
        writer.write((json.dumps(
            {'jsonrpc': '2.0', 'method': method, 'params': params}
        ) + '\n').encode('utf-8'))
    await writer.drain()
    # keep the pipe open until the client side closes
    while await reader.readline():
        pass


async def _ignore_requests(reader, writer):
    """Read (and discard) every request frame without answering."""
    while await reader.readline():
        pass


async def _finalize(client, server_task):
    """Close the transport and cancel the server coroutine so nothing keeps the
    event loop alive at teardown."""
    client.close()
    server_task.cancel()
    try:
        await server_task
    except (asyncio.CancelledError, Exception):  # noqa: BLE001
        pass


async def _new_client(server_coro):
    client_reader, client_writer, server_reader, server_writer = linked_pair()
    server_task = asyncio.ensure_future(server_coro(server_reader, server_writer))
    client = transport_mod.JsonRpcLineTransport(client_reader, client_writer)
    client.start()
    return client, server_task


class JsonRpcLineTransportTest(unittest.IsolatedAsyncioTestCase):

    async def test_round_trip_against_fake_runtime(self):
        client, server_task = await _new_client(lambda r, w: run_runtime(r, w, {}))
        try:
            result = await client.request('initialize', {'cwd': '.', 'provider': 'p', 'model': 'm'})
            self.assertEqual(result, {'serverInfo': {'name': 'flowforge-sdk-runtime',
                                                     'version': '0.0.1'}})
            shutdown = await client.request('shutdown')
            self.assertEqual(shutdown, {})
        finally:
            await _finalize(client, server_task)

    async def test_concurrent_id_association(self):
        client, server_task = await _new_client(_fn_responder)
        try:
            results = await asyncio.gather(*[
                client.request('echo', {'n': i}) for i in range(5)
            ])
            self.assertEqual([r['received_n'] for r in results], [0, 1, 2, 3, 4])
        finally:
            await _finalize(client, server_task)

    async def test_timeout_abandons_pending(self):
        client, server_task = await _new_client(
            lambda r, w: run_runtime(r, w, {'hang_init': True}))
        try:
            with self.assertRaises(RequestTimeoutError):
                await client.request('initialize', {'cwd': '.', 'provider': 'p', 'model': 'm'},
                                     timeout_ms=50)
            # Abandoned entry released: no pending entry leaks behind.
            self.assertEqual(client._pending, {})
        finally:
            await _finalize(client, server_task)

    async def test_jsonrpc_error_response(self):
        client, server_task = await _new_client(
            lambda r, w: run_runtime(r, w, {'init_error': True}))
        try:
            with self.assertRaises(JsonRpcResponseError) as ctx:
                await client.request('initialize', {'cwd': '.', 'provider': 'p', 'model': 'm'})
            self.assertEqual(ctx.exception.code, 7)
        finally:
            await _finalize(client, server_task)

    async def test_notification_fanout(self):
        client, server_task = await _new_client(_notify_responder)
        received_a, received_b = [], []
        client.on_notification(lambda m, p: received_a.append((m, p)))
        client.on_notification(lambda m, p: received_b.append((m, p)))
        try:
            for _ in range(50):
                if len(received_a) >= 2 and len(received_b) >= 2:
                    break
                await asyncio.sleep(LATENCY)
            self.assertEqual(len(received_a), 2)
            self.assertEqual(len(received_b), 2)
            self.assertEqual(received_a[0][0], 'session.event')
            self.assertEqual(received_b[1][1], {'parentSessionId': 'p', 'childSessionId': 'c'})
        finally:
            await _finalize(client, server_task)

    async def test_close_fails_pending(self):
        client, server_task = await _new_client(_ignore_requests)
        try:
            request_task = asyncio.ensure_future(client.request('shutdown'))
            await asyncio.sleep(0.05)
            client.close()
            with self.assertRaises(TransportClosedError):
                await request_task
        finally:
            request_task.cancel()
            await _finalize(client, server_task)


if __name__ == '__main__':
    unittest.main(verbosity=2)