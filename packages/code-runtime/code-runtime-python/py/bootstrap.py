"""CPython bootstrap for flowforge-code-runtime-python.

Reads a :class:`BootMessage` on fd 3, installs log capture, reads a
:class:`RunMessage`, runs the model program as the body of an async function
(top-level ``await`` and ``return`` both work; the returned value is the
completion), and posts a terminal :class:`DoneMessage`. The program calls host
functions through the namespace proxy (``await tools.name(args)``), which rides
binding messages over the protocol pair. The host owns every budget and drives
termination.

This module runs on a plain ``python`` interpreter with only stdlib imports and
inserts its own directory on ``sys.path`` so the sibling ``protocol.py`` loads.
"""

from __future__ import annotations

import asyncio
import json
import math
import os
import sys
import threading
import traceback
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from protocol import PROTOCOL_READ_FD, PROTOCOL_WRITE_FD  # noqa: E402

_READ = 65536

# Sentinel distinguishing "no argument passed" from an explicit None.
_MISSING = object()


class BindingCallError(Exception):
    """Raised inside the program when a host binding rejects the call."""


class ProtocolChannel:
    """Thread-safe JSON-lines writer to the protocol WRITE fd (4).

    Reads never share this handle -- the peer direction lives on fd 3 -- so a
    blocking write here cannot contend with a blocked read on Windows.
    """

    def __init__(self, fd: int) -> None:
        self._fd = fd
        self._lock = threading.Lock()

    def send(self, frame: dict) -> None:
        payload = (json.dumps(frame, ensure_ascii=False, allow_nan=False) + "\n").encode("utf-8")
        with self._lock:
            os.write(self._fd, payload)


class LogCapture:
    """Replacement for ``sys.stdout``/``sys.stderr`` streaming log frames.

    Buffers writes into newline-complete lines and sends each as a ``log``
    frame. The host owns the outer byte ledger; this side only frames.
    """

    def __init__(self, channel: ProtocolChannel) -> None:
        self._channel = channel
        self._buffer: list[str] = []
        self._lock = threading.RLock()

    def write(self, text: Any) -> int:
        if not isinstance(text, str):
            try:
                text = str(text)
            except Exception:
                text = repr(text)
        with self._lock:
            self._buffer.append(text)
        self._flush_lines()
        return len(text)

    def _flush_lines(self) -> None:
        with self._lock:
            joined = "".join(self._buffer)
            self._buffer = []
            parts = joined.split("\n")
            for line in parts[:-1]:
                self._emit(line)
            tail = parts[-1]
            if tail:
                self._buffer = [tail]

    def _emit(self, line: str) -> None:
        try:
            self._channel.send({"type": "log", "text": line})
        except Exception:
            # A wedged protocol channel must not crash the settlement path.
            pass

    def flush(self) -> None:
        with self._lock:
            remainder = "".join(self._buffer)
            self._buffer = []
            if remainder:
                self._emit(remainder)

    def isatty(self) -> bool:
        return False


class _FunctionProxy:
    """An awaitable callable: ``proxy(args)`` returns a coroutine the program awaits."""

    def __init__(self, global_name: str, name: str, host: "_Host",
                 error_cls: Any, member_prop: Any) -> None:
        self._global_name = global_name
        self._name = name
        self._host = host
        self._error_cls = error_cls
        self._member_prop = member_prop

    def __call__(self, args: Any = _MISSING) -> Any:
        return self._invoke(args)

    async def _invoke(self, args: Any) -> Any:
        value = args if args is not _MISSING else None
        try:
            return await self._host.invoke(self._global_name, self._name, value)
        except BindingCallError as error:
            if self._error_cls is not None:
                instance = self._error_cls(str(error))
                try:
                    setattr(instance, self._member_prop, self._name)
                except AttributeError:
                    pass
                raise instance from None
            raise RuntimeError(str(error)) from None


class _NamespaceProxy:
    """One binding global; attribute and subscript access return call proxies."""

    def __init__(self, global_name: str, host: "_Host",
                 error_cls: Any, member_prop: Any) -> None:
        self._global_name = global_name
        self._host = host
        self._error_cls = error_cls
        self._member_prop = member_prop

    def _proxy(self, name: str) -> _FunctionProxy:
        return _FunctionProxy(self._global_name, name, self._host,
                              self._error_cls, self._member_prop)

    def __getattr__(self, name: str) -> _FunctionProxy:
        if name.startswith("__"):
            raise AttributeError(name)
        return self._proxy(name)

    def __getitem__(self, name: str) -> _FunctionProxy:
        return self._proxy(name)


class _Host:
    """Routes inbound frames and issues/ response detail binding calls."""

    def __init__(self, channel: ProtocolChannel, loop: asyncio.AbstractEventLoop) -> None:
        self.channel = channel
        self.loop = loop
        self._pending: dict[int, asyncio.Future] = {}
        self._next_call_id = 0
        self._boot: dict | None = None
        self._run: dict | None = None
        self._boot_event = asyncio.Event()
        self._run_event = asyncio.Event()

    def feed(self, frame: dict) -> None:
        ftype = frame.get("type")
        if ftype == "boot":
            self._boot = frame
            self._boot_event.set()
        elif ftype == "run":
            self._run = frame
            self._run_event.set()
        elif ftype == "reply":
            future = self._pending.pop(frame.get("id"), None)
            if future is not None and not future.done():
                if frame.get("ok"):
                    future.set_result(frame.get("value"))
                else:
                    future.set_exception(BindingCallError(frame.get("message", "")))

    async def invoke(self, global_name: str, name: str, args: Any) -> Any:
        call_id = self._next_call_id
        self._next_call_id += 1
        future = self.loop.create_future()
        self._pending[call_id] = future
        self.channel.send({"type": "call", "id": call_id, "global": global_name,
                           "name": name, "args": args})
        return await future


def _check_lossless(value: Any) -> None:
    """Validate one completion value is lossless stdlib JSON (raise otherwise)."""
    if value is None or isinstance(value, (bool, int, str)):
        return
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            raise ValueError("completion value contains a non-finite number")
        if value == 0.0 and math.copysign(1.0, value) < 0:
            raise ValueError("completion value contains negative zero")
        return
    if isinstance(value, list):
        for item in value:
            _check_lossless(item)
        return
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str):
                raise ValueError("completion value has a non-string key (lossless JSON requires string keys)")
            _check_lossless(item)
        return
    raise ValueError("completion value contains a non-JSON value: %s" % type(value).__name__)


def _wrapper(program: str) -> str:
    """Wrap the program as the body of an async function."""
    lines = []
    for line in program.split("\n"):
        lines.append("    " + line if line.strip() else "")
    return "async def __ff_main__():\n" + "\n".join(lines) + "\n"


def _exception_done(exc_info):
    message = "".join(traceback.format_exception(*exc_info)) if exc_info else "unknown error"
    return {"type": "done", "error": {"kind": "exception", "message": message}}


async def _run_program(host: _Host, boot: dict, program: str) -> dict:
    try:
        code = compile(_wrapper(program), "<program>", "exec")
    except SyntaxError:
        return _exception_done(sys.exc_info())

    globs: dict[str, Any] = {"__name__": "__dsh_main__", "__builtins__": __builtins__}
    for namespace in boot.get("namespaces") or []:
        global_name = namespace.get("global")
        error_cls = None
        member_prop = None
        error_class = namespace.get("errorClass")
        if error_class:
            error_cls = type(error_class["name"], (Exception,), {})
            globs[error_class["name"]] = error_cls
            member_prop = error_class["memberNameProperty"]
        globs[global_name] = _NamespaceProxy(global_name, host, error_cls, member_prop)

    try:
        exec(code, globs)
        value = await globs["__ff_main__"]()
    except BaseException:
        return _exception_done(sys.exc_info())

    try:
        _check_lossless(value)
    except Exception as error:
        return {"type": "done", "error": {"kind": "invalid-output", "message": str(error)}}
    return {"type": "done", "value": value}


def _read_loop(fd: int, queue: asyncio.Queue, loop: asyncio.AbstractEventLoop) -> None:
    acc = b""
    while True:
        try:
            chunk = os.read(fd, _READ)
        except OSError:
            return
        if not chunk:
            return
        acc += chunk
        while True:
            index = acc.find(b"\n")
            if index < 0:
                break
            line = acc[:index]
            acc = acc[index + 1:]
            if not line:
                continue
            try:
                frame = json.loads(line.decode("utf-8"))
            except Exception:
                continue
            loop.call_soon_threadsafe(queue.put_nowait, frame)


def main() -> None:
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    channel = ProtocolChannel(PROTOCOL_WRITE_FD)
    capture = LogCapture(channel)
    sys.stdout = capture  # type: ignore[assignment]
    sys.stderr = capture  # type: ignore[assignment]
    host = _Host(channel, loop)
    queue: asyncio.Queue = asyncio.Queue()

    thread = threading.Thread(target=_read_loop, args=(PROTOCOL_READ_FD, queue, loop), daemon=True)
    thread.start()

    async def _amain() -> dict:
        consume_task = asyncio.ensure_future(_consume(queue, host))
        try:
            await host._boot_event.wait()
            host.channel.send({"type": "boot-ack"})
            await host._run_event.wait()
            return await _run_program(host, host._boot, host._run["program"])
        finally:
            consume_task.cancel()

    try:
        frame = loop.run_until_complete(_amain())
    except BaseException:
        frame = _exception_done(sys.exc_info())
    capture.flush()
    try:
        channel.send(frame)
    except Exception:
        try:
            channel.send({"type": "done", "error": {"kind": "exception", "message": "<unrenderable>"}})
        except Exception:
            pass


async def _consume(queue: asyncio.Queue, host: _Host) -> None:
    while True:
        frame = await queue.get()
        host.feed(frame)


if __name__ == "__main__":
    main()