"""
WebProxy Service Manager for FlowForge.

Manages the lifecycle of the hiclaw web proxy service, which wraps web-based
LLM chat interfaces (Doubao, Kimi, DeepSeek, Qianwen, Yuanbao) as OpenAI-compatible
APIs using Playwright browser automation.

The proxy service runs as a separate subprocess on port 13000, providing:
- 5 platform-specific models: doubao-web/seed-2.0, kimi-web/chat, deepseek-web/chat,
  yuanbao-web/chat, qianwen-web/chat
- 1 round-robin entry: web/chat (distributes across all 5 platforms)

Usage:
    svc = WebProxyService()
    await svc.start()
    status = await svc.get_status()
    await svc.stop()
"""

import asyncio
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Optional

import httpx

from flowforge.core.tracing import get_logger

logger = get_logger("webproxy_service")

PROXY_DIR = Path(r"d:\software\openclaw\hiclaw\tool\proxy")
DEFAULT_PROXY_PORT = 13000
DEFAULT_PROXY_HOST = "127.0.0.1"
HEALTH_CHECK_TIMEOUT = 5
STARTUP_WAIT_SECONDS = 30
HEALTH_POLL_INTERVAL = 2


class WebProxyService:
    """Manages the hiclaw web proxy subprocess lifecycle.

    The proxy service is a FastAPI application that uses Playwright to drive
    real browsers, wrapping web chat interfaces as OpenAI-compatible APIs.

    Attributes:
        _process: The subprocess running the proxy server.
        _port: The port the proxy server listens on.
        _host: The host the proxy server binds to.
        _started_at: Timestamp when the proxy was last started.
        _running: Whether the proxy is believed to be running.
    """

    def __init__(self, proxy_dir: Optional[Path] = None, port: int = DEFAULT_PROXY_PORT,
                 host: str = DEFAULT_PROXY_HOST):
        self._proxy_dir = proxy_dir or PROXY_DIR
        self._port = port
        self._host = host
        self._process: Optional[subprocess.Popen] = None
        self._started_at: Optional[float] = None
        self._running: bool = False

    @property
    def base_url(self) -> str:
        return f"http://{self._host}:{self._port}/v1"

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def port(self) -> int:
        return self._port

    def start(self) -> dict:
        """Start the web proxy service as a subprocess.

        Returns:
            dict with keys: status, message, port, pid (if started).
        """
        if self._process is not None and self._process.poll() is None:
            return {
                "status": "already_running",
                "message": f"Proxy already running (PID {self._process.pid})",
                "port": self._port,
                "pid": self._process.pid,
            }

        if not self._proxy_dir.exists():
            return {
                "status": "error",
                "message": f"Proxy directory not found: {self._proxy_dir}",
            }

        app_py = self._proxy_dir / "app.py"
        if not app_py.exists():
            return {
                "status": "error",
                "message": f"Proxy app.py not found: {app_py}",
            }

        env = os.environ.copy()
        env["HF_HUB_OFFLINE"] = "1"
        env["TRANSFORMERS_OFFLINE"] = "1"
        env["HF_ENDPOINT"] = "https://hf-mirror.com"
        env["PROXY_PORT"] = str(self._port)

        try:
            self._process = subprocess.Popen(
                [sys.executable, str(app_py)],
                cwd=str(self._proxy_dir),
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == "win32" else 0,
            )
            self._started_at = time.time()
            self._running = True
            logger.info(f"WebProxy subprocess started: PID={self._process.pid}, port={self._port}")
            return {
                "status": "started",
                "message": f"Proxy subprocess started (PID {self._process.pid})",
                "port": self._port,
                "pid": self._process.pid,
            }
        except Exception as e:
            logger.error(f"Failed to start WebProxy: {e}")
            return {
                "status": "error",
                "message": f"Failed to start proxy: {e}",
            }

    async def start_and_wait(self, timeout: int = STARTUP_WAIT_SECONDS) -> dict:
        """Start the proxy and wait until it responds to health checks.

        Args:
            timeout: Maximum seconds to wait for the proxy to become healthy.

        Returns:
            dict with keys: status, message, port, pid, healthy.
        """
        result = self.start()
        if result["status"] == "error":
            return result
        if result["status"] == "already_running":
            healthy = await self._health_check()
            result["healthy"] = healthy
            return result

        deadline = time.time() + timeout
        while time.time() < deadline:
            if self._process is not None and self._process.poll() is not None:
                self._running = False
                return_code = self._process.poll()
                stderr_output = ""
                try:
                    stderr_output = self._process.stderr.read().decode("utf-8", errors="replace")[:500]
                except Exception:
                    pass
                return {
                    "status": "crashed",
                    "message": f"Proxy process exited with code {return_code}",
                    "stderr": stderr_output,
                }

            healthy = await self._health_check()
            if healthy:
                result["healthy"] = True
                return result

            await asyncio.sleep(HEALTH_POLL_INTERVAL)

        result["healthy"] = False
        result["message"] += " (health check timeout)"
        return result

    def stop(self) -> dict:
        """Stop the web proxy service.

        Returns:
            dict with keys: status, message.
        """
        if self._process is None or self._process.poll() is not None:
            self._running = False
            return {
                "status": "not_running",
                "message": "Proxy is not running",
            }

        try:
            if sys.platform == "win32":
                os.kill(self._process.pid, signal.CTRL_BREAK_EVENT)
            else:
                self._process.terminate()

            try:
                self._process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self._process.kill()
                self._process.wait(timeout=5)

            self._running = False
            logger.info("WebProxy subprocess stopped")
            return {
                "status": "stopped",
                "message": "Proxy stopped successfully",
            }
        except Exception as e:
            logger.error(f"Error stopping WebProxy: {e}")
            self._running = False
            return {
                "status": "error",
                "message": f"Error stopping proxy: {e}",
            }

    async def get_status(self) -> dict:
        """Get the current status of the web proxy service.

        Checks both the subprocess state (if started by us) and the health
        endpoint (works even if started externally).

        Returns:
            dict with keys: running, healthy, port, pid, uptime_seconds,
            models (list of available webproxy models).
        """
        process_alive = self._process is not None and self._process.poll() is None
        healthy = await self._health_check()
        models = []

        if healthy:
            models = await self._list_models()
            self._running = True
        else:
            self._running = False

        uptime = None
        if self._started_at and process_alive:
            uptime = round(time.time() - self._started_at, 1)

        return {
            "running": process_alive or healthy,
            "healthy": healthy,
            "port": self._port,
            "pid": self._process.pid if self._process else None,
            "uptime_seconds": uptime,
            "models": models,
            "base_url": self.base_url,
            "managed": process_alive,
        }

    async def _health_check(self) -> bool:
        """Check if the proxy service is healthy by calling /health.

        Returns:
            True if the proxy responds with a healthy status.
        """
        try:
            async with httpx.AsyncClient(timeout=HEALTH_CHECK_TIMEOUT) as client:
                resp = await client.get(f"http://{self._host}:{self._port}/health")
                return resp.status_code == 200
        except Exception:
            return False

    async def _list_models(self) -> list:
        """List available models from the proxy service.

        Returns:
            List of model dicts with id and object keys.
        """
        try:
            async with httpx.AsyncClient(timeout=HEALTH_CHECK_TIMEOUT) as client:
                resp = await client.get(f"http://{self._host}:{self._port}/v1/models")
                if resp.status_code == 200:
                    data = resp.json()
                    return data.get("data", [])
        except Exception:
            pass
        return []

    async def chat(self, model: str, messages: list, **kwargs) -> Optional[dict]:
        """Send a chat completion request through the web proxy.

        Args:
            model: Model identifier (e.g., 'doubao-web/seed-2.0', 'web/chat').
            messages: OpenAI-format message list.
            **kwargs: Additional parameters (temperature, max_tokens, etc.).

        Returns:
            OpenAI-format response dict, or None if the proxy is unavailable.
        """
        if not await self._health_check():
            logger.warning("WebProxy not healthy, cannot chat")
            return None

        payload = {
            "model": model,
            "messages": messages,
            **kwargs,
        }
        url = f"http://{self._host}:{self._port}/v1/chat/completions"

        try:
            async with httpx.AsyncClient(timeout=120) as client:
                resp = await client.post(url, json=payload)
                resp.raise_for_status()
                return resp.json()
        except Exception as e:
            logger.error(f"WebProxy chat failed for model={model}: {e}")
            return None


_webproxy_service: Optional[WebProxyService] = None


def get_webproxy_service() -> WebProxyService:
    """Get or create the global WebProxyService singleton."""
    global _webproxy_service
    if _webproxy_service is None:
        _webproxy_service = WebProxyService()
    return _webproxy_service
