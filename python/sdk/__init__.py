"""FlowForge Python SDK (``python/sdk``).

A pure-standard-library, asyncio client for the FlowForge SDK runtime protocol
(``@flowforge/sdk-protocol``, newline-delimited JSON-RPC 2.0 over stdio). It
spawns a runtime subprocess and mirrors the TypeScript ``@flowforge/sdk-client``.

Public surface:

- :class:`FlowForgeHarness` -- high-level harness (async context manager) that
  owns one runtime subprocess across many sessions.
- :class:`HarnessClient` -- low-level JSON-RPC client over subprocess stdio.
- :class:`HarnessSession` -- one SDK session with ``run()`` "whole idle" turns.
- :class:`SdkError` and its subclasses -- the error hierarchy.

``py>=3.9``, zero third-party dependencies.
"""

from .api import (FlowForgeHarness, HarnessRunResult, HarnessSession,
                  final_response, is_inbox_receipt, normalize_input,
                  validated_session_event)
from .client import HarnessClient, NotificationSubscription
from .errors import (JsonRpcResponseError, RequestTimeoutError, SdkError,
                     SdkProtocolError, TransportClosedError)
from .protocol import SERVER_INFO_NAME

__version__ = '0.1.0'

__all__ = [
    # high-level
    'FlowForgeHarness',
    'HarnessSession',
    'HarnessRunResult',
    # low-level
    'HarnessClient',
    'NotificationSubscription',
    # errors
    'SdkError',
    'TransportClosedError',
    'RequestTimeoutError',
    'SdkProtocolError',
    'JsonRpcResponseError',
    # helpers re-exported for convenience
    'normalize_input',
    'validated_session_event',
    'is_inbox_receipt',
    'final_response',
    'SERVER_INFO_NAME',
    '__version__',
]