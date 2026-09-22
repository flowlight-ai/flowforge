"""Private teardown ladder for the runtime subprocess.

Mirrors ``@flowforge/sdk-client/dispose.ts``: close stdin for a cooperative
EOF quiesce, then (on POSIX) ``SIGTERM``, then ``SIGKILL``, resolving only
after the process has actually exited. On Windows both signals map to forced
termination, so the ``SIGTERM`` rung is skipped exactly as in the TS twin.

The protocol ``shutdown`` exchange is *not* part of this ladder -- the caller
(:class:`~flowforge.sdk.client.HarnessClient`) issues it before invoking
these steps. This module is idempotent: an already-exited process returns
immediately.

``py>=3.9``, pure standard library.
"""

import asyncio
import platform
import signal
from typing import Optional

from .errors import SdkError


def _signal(name: str) -> Optional[int]:
    """Resolve a signal constant by name; ``None`` when unavailable (e.g.
    ``SIGKILL`` does not exist on Windows)."""
    return getattr(signal, name, None)


def _try_signal(proc: asyncio.subprocess.Process, name: str) -> bool:
    """Send ``name`` to ``proc``; returns ``False`` if the signal or the
    process is unavailable."""
    sig = _signal(name)
    if sig is None:
        return False
    try:
        proc.send_signal(sig)
        return True
    except (ProcessLookupError, PermissionError, OSError):
        return False


async def _wait_exit(proc: asyncio.subprocess.Process, ms: int) -> bool:
    """Race the process's exit against a timeout. ``True`` iff it exited
    within ``ms`` milliseconds."""
    if proc.returncode is not None:
        return True
    try:
        await asyncio.wait_for(proc.wait(), ms / 1000.0)
        return True
    except asyncio.TimeoutError:
        return False


async def _force_terminate_within(proc: asyncio.subprocess.Process, ms: int) -> None:
    """Force-terminate the runtime and raise if no exit edge arrives within the
    grace window."""
    if proc.returncode is not None:
        return
    _try_signal(proc, 'SIGKILL')
    if proc.returncode is not None:
        return
    await _wait_exit(proc, ms)
    if proc.returncode is None:
        raise SdkError(
            f'runtime process did not exit within {ms}ms after SIGKILL')


async def dispose_runtime_process(
    proc: asyncio.subprocess.Process,
    *,
    dispose_eof_grace_ms: int = 6000,
    dispose_grace_ms: int = 3000,
    host_platform: Optional[str] = None,
) -> None:
    """Tear the runtime down to quiescence, resolving only after exit.

    :param proc: the runtime child process (``asyncio.subprocess.Process``).
    :param dispose_eof_grace_ms: stdin-EOF quiesce window (default 6000).
    :param dispose_grace_ms: termination-confirmation window after a signal
        (default 3000).
    :param host_platform: injectable for unit coverage; defaults to
        ``platform.system().lower()``.
    :raises SdkError: when forced termination does not reap the child.
    """
    is_win32 = (host_platform or platform.system().lower()) == 'win32'

    # Already gone: nothing to reap.
    if proc.returncode is not None:
        return

    # 1. Close stdin and allow cooperative teardown / durable-state flush.
    stdin = proc.stdin
    if stdin is not None and not stdin.is_closing():
        try:
            stdin.close()
        except (ConnectionError, OSError, RuntimeError):
            pass
    if await _wait_exit(proc, dispose_eof_grace_ms):
        return

    # 2. POSIX gets a catchable graceful signal; Windows signals force-terminate.
    if not is_win32:
        _try_signal(proc, 'SIGTERM')
        if await _wait_exit(proc, dispose_grace_ms):
            return

    # 3. Force-kill and await a bounded exit edge.
    await _force_terminate_within(proc, dispose_grace_ms)


__all__ = ['dispose_runtime_process']