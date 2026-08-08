"""Trae 桥接文件监听器 — F045 §3.2 Phase 3 事件驱动优化.

TraeBridgeWatcher 基于 watchdog 监听 responses 目录的文件创建事件，
当 response_{uuid}.json 文件创建时立即唤醒等待中的 poll_response 调用，
将轮询模式（默认 2s 间隔）升级为事件驱动（毫秒级响应）。

设计要点：
- watchdog Observer 在独立线程运行，事件通过 call_soon_threadsafe 转发到 asyncio 主循环
- 每个 request_id 对应一个 asyncio.Future，事件到达时 future.set_result(file_path)
- 文件名匹配：只关心 response_{uuid}.json 与 cancel_{uuid}.json，忽略其他文件
- 失败降级：watchdog 未安装或启动失败时，调用方回退到 protocol.poll_response 轮询
- 资源安全：start/stop 配对，async context manager 支持

遵守铁律：
- 铁律 3：依赖通过构造函数注入（TraeBridgeConfig）
- 铁律 5：路径从 config 读取，不硬编码
- 红线 12：通过 DI 容器注册到 TraeBridgeProtocol（可选注入）

用法：
    watcher = TraeBridgeWatcher(config)
    await watcher.start()
    try:
        # 等待 response 文件创建（事件驱动，毫秒级响应）
        response_file = await watcher.wait_for_response(request_id, timeout=300)
    finally:
        await watcher.stop()

    # 或作为 async context manager
    async with TraeBridgeWatcher(config) as watcher:
        response_file = await watcher.wait_for_response(request_id, timeout=300)
"""

from __future__ import annotations

import asyncio
import re
import threading
from pathlib import Path

from flowforge.core.tracing import get_logger
from flowforge.llm.trae.config import TraeBridgeConfig
from flowforge.llm.trae.exceptions import TraeBridgeConfigError

logger = get_logger("trae_llm.watcher")

# 文件名匹配正则：response_{uuid}.json / cancel_{uuid}.json
_RESPONSE_RE = re.compile(r"^response_(.+)\.json$")
_CANCEL_RE = re.compile(r"^cancel_(.+)\.json$")


# ── watchdog 可选导入（失败时降级到轮询）────────────────────────────

try:
    from watchdog.events import FileSystemEvent, FileSystemEventHandler
    from watchdog.observers import Observer

    _WATCHDOG_AVAILABLE = True
except ImportError:  # pragma: no cover — 降级路径
    _WATCHDOG_AVAILABLE = False
    Observer = None  # type: ignore
    FileSystemEventHandler = object  # type: ignore
    FileSystemEvent = object  # type: ignore


class _BridgeEventHandler(FileSystemEventHandler):
    """watchdog 事件处理器 — 将文件系统事件转发到 asyncio 主循环.

    watchdog Observer 在独立线程运行，事件回调也在该线程中触发。
    通过 loop.call_soon_threadsafe 将事件安全地转发到 asyncio 主循环。
    """

    def __init__(
        self,
        loop: asyncio.AbstractEventLoop,
        response_callbacks: dict[str, asyncio.Future],
        cancel_callbacks: dict[str, asyncio.Future],
    ) -> None:
        super().__init__()
        self._loop = loop
        self._response_callbacks = response_callbacks
        self._cancel_callbacks = cancel_callbacks

    def on_created(self, event: FileSystemEvent) -> None:  # type: ignore[override]
        self._dispatch(event)

    def on_moved(self, event: FileSystemEvent) -> None:  # type: ignore[override]
        # Windows 上某些场景下文件会通过 move 创建（如临时文件 rename）
        self._dispatch(event)

    def _dispatch(self, event: FileSystemEvent) -> None:
        """解析文件名并唤醒对应的等待 future."""
        src_path = getattr(event, "src_path", "") or ""
        dest_path = getattr(event, "dest_path", "") or ""
        # 优先检查 dest_path（moved 事件的目标路径）
        for path in (dest_path, src_path):
            if not path:
                continue
            name = Path(path).name
            # 匹配 response_{uuid}.json
            m = _RESPONSE_RE.match(name)
            if m:
                rid = m.group(1)
                self._notify(self._response_callbacks, rid, path)
                return
            # 匹配 cancel_{uuid}.json
            m = _CANCEL_RE.match(name)
            if m:
                rid = m.group(1)
                self._notify(self._cancel_callbacks, rid, path)
                return

    def _notify(
        self,
        callbacks: dict[str, asyncio.Future],
        rid: str,
        file_path: str,
    ) -> None:
        """唤醒等待中的 future（线程安全）."""
        fut = callbacks.get(rid)
        if fut is None or fut.done():
            return
        try:
            self._loop.call_soon_threadsafe(self._set_result, fut, file_path)
        except RuntimeError:
            # loop 已关闭（进程退出时），忽略
            pass

    @staticmethod
    def _set_result(fut: asyncio.Future, file_path: str) -> None:
        if not fut.done():
            fut.set_result(file_path)


class TraeBridgeWatcher:
    """Trae 桥接文件监听器 — F045 §3.2 Phase 3 事件驱动优化.

    基于 watchdog 监听 responses 目录，将轮询升级为事件驱动。
    watchdog 未安装或启动失败时，调用方应回退到 protocol.poll_response 轮询。

    线程模型：
    - watchdog Observer 运行在独立线程
    - 事件通过 loop.call_soon_threadsafe 转发到 asyncio 主循环
    - asyncio.Future 在主循环中 set_result，唤醒 await 的协程

    并发安全：
    - _response_callbacks / _cancel_callbacks 由主循环线程访问
    - _BridgeEventHandler 在 watchdog 线程中读这些 dict（dict 读写本身线程安全）
    """

    def __init__(self, config: TraeBridgeConfig | None = None) -> None:
        self._config = config or TraeBridgeConfig()
        self._shared_dir = Path(self._config.shared_dir)
        self._responses_dir = self._shared_dir / self._config.responses_dir
        self._cancels_dir = self._shared_dir / self._config.cancels_dir

        # request_id → future（等待响应文件路径）
        self._response_callbacks: dict[str, asyncio.Future] = {}
        # request_id → future（等待取消文件路径）
        self._cancel_callbacks: dict[str, asyncio.Future] = {}

        self._observer: Observer | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._started = False
        self._lock = threading.Lock()

    # ── 属性 ───────────────────────────────────────────────────────

    @property
    def available(self) -> bool:
        """watchdog 是否可用."""
        return _WATCHDOG_AVAILABLE

    @property
    def started(self) -> bool:
        """监听器是否已启动."""
        return self._started

    # ── 生命周期 ───────────────────────────────────────────────────

    async def start(self) -> None:
        """启动文件监听器.

        Raises:
            TraeBridgeConfigError: watchdog 未安装或目录不存在
        """
        if self._started:
            return

        if not _WATCHDOG_AVAILABLE:
            raise TraeBridgeConfigError(
                "watchdog 未安装，无法启动 TraeBridgeWatcher。"
                "请执行 `pip install watchdog>=3.0` 或回退到轮询模式。"
            )

        # 确保目录存在
        self._responses_dir.mkdir(parents=True, exist_ok=True)
        self._cancels_dir.mkdir(parents=True, exist_ok=True)

        # 获取当前事件循环
        try:
            self._loop = asyncio.get_running_loop()
        except RuntimeError as e:
            raise TraeBridgeConfigError(
                f"TraeBridgeWatcher 必须在 asyncio 事件循环中启动: {e}"
            ) from e

        # 创建事件处理器
        handler = _BridgeEventHandler(
            self._loop,
            self._response_callbacks,
            self._cancel_callbacks,
        )

        # 创建并启动 Observer
        try:
            self._observer = Observer()
            # 同时监听 responses 和 cancels 目录
            self._observer.schedule(handler, str(self._responses_dir), recursive=False)
            self._observer.schedule(handler, str(self._cancels_dir), recursive=False)
            self._observer.start()
            self._started = True
            logger.info(
                f"TraeBridgeWatcher 已启动: responses={self._responses_dir}, "
                f"cancels={self._cancels_dir}"
            )
        except Exception as e:
            raise TraeBridgeConfigError(
                f"启动 watchdog Observer 失败: {e}",
            ) from e

    async def stop(self) -> None:
        """停止文件监听器，释放 watchdog 线程资源."""
        if not self._started:
            return

        # 取消所有未完成的 future，避免协程永久挂起
        with self._lock:
            for fut in list(self._response_callbacks.values()):
                if not fut.done():
                    fut.cancel()
            for fut in list(self._cancel_callbacks.values()):
                if not fut.done():
                    fut.cancel()
            self._response_callbacks.clear()
            self._cancel_callbacks.clear()

        # 停止 Observer
        observer = self._observer
        if observer is not None:
            try:
                observer.stop()
                observer.join(timeout=2.0)
            except Exception as e:
                logger.warning(f"停止 watchdog Observer 异常: {e}")
            self._observer = None

        self._started = False
        logger.info("TraeBridgeWatcher 已停止")

    async def __aenter__(self) -> TraeBridgeWatcher:
        await self.start()
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        await self.stop()

    # ── 等待接口 ───────────────────────────────────────────────────

    async def wait_for_response(
        self,
        request_id: str,
        *,
        timeout: float | None = None,
    ) -> str:
        """等待 response_{uuid}.json 文件创建.

        事件驱动：当 watchdog 检测到文件创建时立即返回文件路径。
        若文件已存在（先到先等的情况），立即返回。

        Args:
            request_id: 请求 ID
            timeout: 超时秒数（None 表示无限等待，调用方应自行超时控制）

        Returns:
            response 文件的完整路径

        Raises:
            asyncio.TimeoutError: 超时未收到响应
            asyncio.CancelledError: watcher 停止时取消等待
        """
        if not self._started:
            raise TraeBridgeConfigError(
                "TraeBridgeWatcher 未启动，无法等待响应"
            )

        # 先检查文件是否已存在（避免事件丢失）
        response_file = self._responses_dir / f"response_{request_id}.json"
        if response_file.exists():
            return str(response_file)

        # 注册 future 等待事件
        fut = self._loop.create_future()
        with self._lock:
            self._response_callbacks[request_id] = fut

        try:
            if timeout is None:
                file_path = await fut
            else:
                file_path = await asyncio.wait_for(fut, timeout=timeout)
            return file_path
        except TimeoutError:
            logger.debug(
                f"wait_for_response 超时: request_id={request_id}, timeout={timeout}s"
            )
            raise
        finally:
            with self._lock:
                self._response_callbacks.pop(request_id, None)

    async def wait_for_cancel(
        self,
        request_id: str,
        *,
        timeout: float | None = None,
    ) -> str:
        """等待 cancel_{uuid}.json 文件创建（不变量 8 逃生舱监听）.

        与 wait_for_response 类似，但监听 cancels 目录。

        Args:
            request_id: 请求 ID
            timeout: 超时秒数（None 表示无限等待）

        Returns:
            cancel 文件的完整路径

        Raises:
            asyncio.TimeoutError: 超时
            asyncio.CancelledError: watcher 停止时取消等待
        """
        if not self._started:
            raise TraeBridgeConfigError(
                "TraeBridgeWatcher 未启动，无法等待取消"
            )

        # 先检查文件是否已存在
        cancel_file = self._cancels_dir / f"cancel_{request_id}.json"
        if cancel_file.exists():
            return str(cancel_file)

        fut = self._loop.create_future()
        with self._lock:
            self._cancel_callbacks[request_id] = fut

        try:
            if timeout is None:
                file_path = await fut
            else:
                file_path = await asyncio.wait_for(fut, timeout=timeout)
            return file_path
        except TimeoutError:
            logger.debug(
                f"wait_for_cancel 超时: request_id={request_id}, timeout={timeout}s"
            )
            raise
        finally:
            with self._lock:
                self._cancel_callbacks.pop(request_id, None)

    # ── 状态查询 ───────────────────────────────────────────────────

    def pending_count(self) -> int:
        """当前等待中的响应数量."""
        with self._lock:
            return len(self._response_callbacks)

    def cancel_pending_count(self) -> int:
        """当前等待中的取消数量."""
        with self._lock:
            return len(self._cancel_callbacks)

    def pending_request_ids(self) -> set[str]:
        """当前等待中的所有 request_id（调试用）."""
        with self._lock:
            return set(self._response_callbacks.keys())


__all__ = ["TraeBridgeWatcher"]
