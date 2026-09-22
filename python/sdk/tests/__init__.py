"""Test helpers for the Python FlowForge SDK.

Offers an in-process loopback pipe (two ``asyncio.StreamReader``/``Writer``
ends connected over a loopback TCP socket) so the :class:`JsonRpcLineTransport`
can be tested without spawning a subprocess, plus a home for the fake runtime.
"""