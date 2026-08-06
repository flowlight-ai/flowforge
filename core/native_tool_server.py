"""NativeToolServer — 轻量HTTP服务器，接收FlowForge服务端的Native Tool调用。

运行在客户端侧（如VMware VM上的技能进程），绑定127.0.0.1，
接收服务端发来的工具调用请求，在本地执行后返回结果。

安全措施：
- 绑定 127.0.0.1，仅接受本地连接
- Token认证：请求必须携带 X-Native-Token 头
- 服务端与客户端不在同一主机时，应使用 WebSocket 反向通道
"""

from __future__ import annotations

import asyncio
import logging
import socket
import threading
from collections.abc import Callable
from typing import Any

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

logger = logging.getLogger("flowforge.native_tool_server")


class NativeToolServer:
    """轻量HTTP服务器 — 接收FlowForge服务端的Native Tool调用。

    用法::

        server = NativeToolServer(token="my-secret-token")
        server.register("image_download", my_download_handler)
        url = server.start()  # 返回 http://127.0.0.1:{port}
        # ... 使用完毕后
        server.stop()
    """

    def __init__(
        self,
        host: str = "127.0.0.1",
        port: int = 0,
        token: str = "",
    ) -> None:
        """初始化Native Tool Server。

        Args:
            host: 绑定地址，默认127.0.0.1（仅本地访问）。
            port: 绑定端口，默认0（自动分配）。
            token: 认证token，为空则不校验（仅限开发环境）。
        """
        self._host = host
        self._port = port
        self._token = token
        self._tools: dict[str, Callable] = {}
        self._app = FastAPI(
            title="FlowForge Native Tool Server",
            docs_url=None,
            redoc_url=None,
        )
        self._server: uvicorn.Server | None = None
        self._thread: threading.Thread | None = None
        self._actual_port: int | None = None
        self._setup_routes()

    # ── 路由设置 ──────────────────────────────────────────────────

    def _setup_routes(self) -> None:
        """注册FastAPI路由。"""

        @self._app.post("/tool/{tool_name}")
        async def execute_tool(tool_name: str, request: Request) -> JSONResponse:
            # Token认证
            req_token = request.headers.get("X-Native-Token", "")
            if self._token and req_token != self._token:
                return JSONResponse(
                    status_code=401,
                    content={"error": "Unauthorized", "status": "error"},
                )

            body = await request.json()
            tool_call_id = body.get("tool_call_id", "")
            task_id = body.get("task_id", "")
            params = body.get("params", {})

            handler = self._tools.get(tool_name)
            if handler is None:
                return JSONResponse(
                    status_code=404,
                    content={
                        "tool_call_id": tool_call_id,
                        "task_id": task_id,
                        "status": "error",
                        "error": f"Unknown tool: {tool_name}",
                    },
                )

            try:
                if asyncio.iscoroutinefunction(handler):
                    result = await handler(params)
                else:
                    result = handler(params)

                return JSONResponse(
                    content={
                        "tool_call_id": tool_call_id,
                        "task_id": task_id,
                        "status": "success",
                        "result": result if isinstance(result, dict) else {"value": result},
                    },
                )
            except Exception as e:
                logger.exception(f"Native tool '{tool_name}' execution failed")
                return JSONResponse(
                    status_code=500,
                    content={
                        "tool_call_id": tool_call_id,
                        "task_id": task_id,
                        "status": "error",
                        "error": str(e),
                    },
                )

        @self._app.get("/health")
        async def health() -> dict[str, Any]:
            return {
                "status": "ok",
                "tools": list(self._tools.keys()),
                "host": self._host,
                "port": self._actual_port,
            }

    # ── 工具注册 ──────────────────────────────────────────────────

    def register(self, name: str, handler: Callable) -> None:
        """注册一个本地工具处理器。

        Args:
            name: 工具名称，需与FlowForge服务端声明的native_tools一致。
            handler: 处理函数，签名为 (params: dict) -> dict，
                     支持同步和异步函数。
        """
        if name in self._tools:
            logger.warning(f"Overwriting existing native tool handler: {name}")
        self._tools[name] = handler
        logger.info(f"Registered native tool: {name}")

    def unregister(self, name: str) -> None:
        """移除已注册的工具处理器。"""
        if name in self._tools:
            del self._tools[name]
            logger.info(f"Unregistered native tool: {name}")

    @property
    def registered_tools(self) -> list[str]:
        """返回已注册的工具名称列表。"""
        return list(self._tools.keys())

    # ── 服务器生命周期 ────────────────────────────────────────────

    def _bind_socket(self) -> int:
        """预绑定socket以获取实际端口号。

        当port=0时，操作系统自动分配可用端口。
        绑定后立即关闭socket，让uvicorn重新绑定同一端口。
        由于使用SO_REUSEADDR，端口可立即重用。
        返回实际绑定的端口号。
        """
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind((self._host, self._port))
        actual_port = sock.getsockname()[1]
        # 关闭socket — SO_REUSEADDR确保端口可立即重用
        sock.close()
        return actual_port

    def start(self) -> str:
        """启动HTTP服务器（后台线程），返回服务器URL。

        Returns:
            服务器URL，格式为 http://127.0.0.1:{port}。

        Raises:
            RuntimeError: 服务器已在运行。
        """
        if self._server is not None and self._server.started:
            raise RuntimeError("NativeToolServer is already running")

        # 预绑定socket获取实际端口
        self._actual_port = self._bind_socket()

        config = uvicorn.Config(
            app=self._app,
            host=self._host,
            port=self._actual_port,  # 使用已绑定的端口
            log_level="warning",
        )
        self._server = uvicorn.Server(config)

        def _run() -> None:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)

            async def _serve() -> None:
                assert self._server is not None
                await self._server.serve()

            loop.run_until_complete(_serve())

        self._thread = threading.Thread(target=_run, daemon=True)
        self._thread.start()

        # 等待服务器就绪（轮询 server.started 标志，最多10秒）
        import time
        deadline = time.monotonic() + 10.0
        while not self._server.started and time.monotonic() < deadline:
            time.sleep(0.05)

        if not self._server.started:
            raise TimeoutError("NativeToolServer failed to start within 10 seconds")

        url = f"http://{self._host}:{self._actual_port}"
        logger.info(f"NativeToolServer started at {url}")
        return url

    def stop(self) -> None:
        """优雅关闭服务器。"""
        if self._server is None:
            return

        self._server.should_exit = True
        if self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=5.0)

        self._server = None
        self._thread = None
        self._actual_port = None
        logger.info("NativeToolServer stopped")

    @property
    def url(self) -> str | None:
        """返回当前服务器URL，未启动时返回None。"""
        if self._actual_port is not None:
            return f"http://{self._host}:{self._actual_port}"
        return None

    @property
    def is_running(self) -> bool:
        """服务器是否正在运行。"""
        return self._server is not None and self._server.started
