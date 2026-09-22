"""Shared test helpers: SDK import bootstrap, loopback pipe factory, and
subprocess fake-runtime launcher.

Because ``unittest discover`` does not put the repo root on ``sys.path``, the
sdk package is imported by adding the SDK's ``python`` parent directory to the
path (the ``sdk`` directory itself is the Python package).
"""

import asyncio
import inspect
import json
import os
import sys

_SDK_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # python/sdk
_PYTHON_PARENT = os.path.dirname(_SDK_ROOT)  # python

if _PYTHON_PARENT not in sys.path:
    sys.path.insert(0, _PYTHON_PARENT)

import sdk  # noqa: E402
from sdk import (FlowForgeHarness, HarnessClient, HarnessSession,  # noqa: E402
                 JsonRpcResponseError, RequestTimeoutError, SdkError,
                 SdkProtocolError, TransportClosedError, api, client, dispose,
                 errors, protocol, transport)

# Path to the fake runtime module (used to spawn it with ``sys.executable``).
FAKE_RUNTIME = os.path.join(_SDK_ROOT, 'tests', 'fake_runtime.py')


def fake_runtime_env(config=None):
    """Build an env for spawning fake_runtime.py via the subprocess."""
    env = dict(os.environ)
    env.setdefault('PYTHONIOENCODING', 'utf-8')
    if config:
        for key, value in config.items():
            if value is None:
                continue
            env['FAKE_' + key.upper()] = str(value)
    return env


async def loopback_pair(loop=None):
    """Open a loopback TCP connection, returning
    ``(client_reader, client_writer, server_reader, server_writer)`` so two
    :class:`JsonRpcLineTransport` endpoints can communicate in-process."""
    loop = loop or asyncio.get_running_loop()
    slots = {}

    async def _handle(reader, writer):
        slots['server_reader'] = reader
        slots['server_writer'] = writer

    server = await asyncio.start_server(_handle, '127.0.0.1', 0)
    port = server.sockets[0].getsockname()[1]
    client_reader, client_writer = await asyncio.open_connection('127.0.0.1', port)
    for _ in range(200):
        if 'server_reader' in slots:
            break
        await asyncio.sleep(0.005)
    server.close()
    await server.wait_closed()
    if 'server_reader' not in slots:
        raise RuntimeError('loopback server never accepted the connection')
    return (client_reader, client_writer,
            slots['server_reader'], slots['server_writer'])


__all__ = [
    'sdk', 'FlowForgeHarness', 'HarnessClient', 'HarnessSession',
    'JsonRpcResponseError', 'RequestTimeoutError', 'SdkError',
    'SdkProtocolError', 'TransportClosedError',
    'api', 'client', 'dispose', 'errors', 'protocol', 'transport',
    'FAKE_RUNTIME', 'loopback_pair', 'fake_runtime_env',
]