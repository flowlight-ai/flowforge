"""OpenRoute Service Manager for FlowForge.

Manages the lifecycle of the hiclaw openroute service, which wraps web-based
LLM chat interfaces (Doubao, Kimi, DeepSeek, Qianwen, Yuanbao) as OpenAI-compatible
APIs using Playwright browser automation.

The openroute service runs as a separate subprocess on port 13000, providing:
- 1 auto-routing entry: auto (delegates to hiclaw's assignment-based model selection)
- 1 round-robin entry: web/chat (distributes across all 5 platforms)
- 5 platform-specific models: doubao-web/seed-2.0, kimi-web/chat, deepseek-web/chat,
  yuanbao-web/chat, qianwen-web/chat

This module implements the ToolPlugin interface so OpenRouteService can be
managed by the PluginRegistry. All config is injected through the constructor —
no hardcoded paths, no global singletons.
"""

import asyncio
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, Optional

import httpx

from flowforge.core.interfaces.tools import (
    PluginHealth,
    PluginManifest,
    PluginState,
    ToolPlugin,
)
from flowforge.core.tracing import get_logger

logger = get_logger("openroute_service")

DEFAULT_OPENROUTE_PORT = 13000
DEFAULT_OPENROUTE_HOST = "127.0.0.1"
HEALTH_CHECK_TIMEOUT = 5
STARTUP_WAIT_SECONDS = 30
HEALTH_POLL_INTERVAL = 2


class OpenRouteService(ToolPlugin):
    """Manages the hiclaw openroute subprocess lifecycle.

    Implements ToolPlugin so it can be managed by PluginRegistry.
    All config is injected through the constructor — no hardcoded paths,
    no global singletons.

    Attributes:
        _process: The subprocess running the openroute server.
        _port: The port the openroute server listens on.
        _host: The host the openroute server binds to.
        _started_at: Timestamp when the openroute was last started.
        _running: Whether the openroute is believed to be running.
    """

    manifest = PluginManifest(
        name="openroute",
        description="OpenRoute LLM代理服务（浏览器自动化）",
        tags=["infrastructure", "llm_proxy"],
        safety_level="readonly",
        parameters_schema={
            "type": "object",
            "required": ["action"],
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["start", "stop", "status", "chat"],
                    "description": "要执行的操作",
                },
                "model": {"type": "string", "description": "chat 操作的模型名"},
                "messages": {"type": "array", "description": "chat 操作的消息列表"},
            },
        },
    )

    def __init__(
        self,
        openroute_dir: str = "",
        port: int = DEFAULT_OPENROUTE_PORT,
        host: str = DEFAULT_OPENROUTE_HOST,
        **kwargs: Any,
    ):
        self._port = int(port)
        self._host = host
        self._process: Optional[subprocess.Popen] = None
        self._started_at: Optional[float] = None
        self._running: bool = False

        # Resolve openroute_dir: explicit > env > auto-detect
        if openroute_dir:
            self._openroute_dir = Path(openroute_dir)
        elif os.environ.get("OPENROUTE_DIR"):
            self._openroute_dir = Path(os.environ["OPENROUTE_DIR"])
        else:
            # Auto-detect: look for hiclaw/tool/openroute relative to flowforge/
            flowforge_root = Path(__file__).parent.parent
            project_root = flowforge_root.parent
            candidate = project_root / "hiclaw" / "tool" / "openroute"
            if candidate.exists():
                self._openroute_dir = candidate
            else:
                self._openroute_dir = Path()
                logger.warning(
                    f"OpenRoute dir not found at {candidate}. "
                    f"Set OPENROUTE_DIR env var or pass openroute_dir config."
                )

    @property
    def base_url(self) -> str:
        return f"http://{self._host}:{self._port}/v1"

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def port(self) -> int:
        return self._port

    async def startup(self) -> None:
        """Called by PluginRegistry after registration."""
        logger.info(
            f"OpenRouteService initialized: dir={self._openroute_dir}, "
            f"port={self._port}, host={self._host}"
        )

    async def shutdown(self) -> None:
        """Called by PluginRegistry on graceful shutdown."""
        self.stop()

    async def health_check(self) -> PluginHealth:
        """Check if the openroute service is healthy."""
        try:
            async with httpx.AsyncClient(timeout=HEALTH_CHECK_TIMEOUT) as client:
                start = time.time()
                resp = await client.get(f"http://{self._host}:{self._port}/health")
                latency = (time.time() - start) * 1000
                if resp.status_code == 200:
                    return PluginHealth(
                        state=PluginState.READY,
                        latency_ms=latency,
                        last_check=time.time(),
                    )
                return PluginHealth(
                    state=PluginState.DEGRADED,
                    message=f"Health endpoint returned {resp.status_code}",
                    latency_ms=latency,
                    last_check=time.time(),
                )
        except Exception as e:
            return PluginHealth(
                state=PluginState.STOPPED,
                message=str(e),
                last_check=time.time(),
            )

    async def execute(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Execute an OpenRoute action.

        Args:
            params: Must contain 'action' key with value 'start', 'stop',
                'status', or 'chat'.

        Returns:
            Result dict with action outcome.
        """
        action = params.get("action", "status")

        if action == "start":
            return await self.start_and_wait()

        elif action == "stop":
            return self.stop()

        elif action == "status":
            return await self.get_status()

        elif action == "chat":
            model = params.get("model", "")
            messages = params.get("messages", [])
            if not model or not messages:
                return {"error": "chat action requires 'model' and 'messages'"}
            result = await self.chat(model, messages)
            return result if result else {"error": "OpenRoute not available"}

        else:
            return {"error": f"Unknown action: {action}"}

    def start(self) -> dict:
        """Start the openroute service as a subprocess.

        Returns:
            dict with keys: status, message, port, pid (if started).
        """
        if self._process is not None and self._process.poll() is None:
            return {
                "status": "already_running",
                "message": f"OpenRoute already running (PID {self._process.pid})",
                "port": self._port,
                "pid": self._process.pid,
            }

        if not self._openroute_dir.exists():
            return {
                "status": "error",
                "message": f"OpenRoute directory not found: {self._openroute_dir}",
            }

        app_py = self._openroute_dir / "app.py"
        if not app_py.exists():
            return {
                "status": "error",
                "message": f"OpenRoute app.py not found: {app_py}",
            }

        env = os.environ.copy()
        env["HF_HUB_OFFLINE"] = "1"
        env["TRANSFORMERS_OFFLINE"] = "1"
        env["HF_ENDPOINT"] = "https://hf-mirror.com"
        env["OPENROUTE_PORT"] = str(self._port)

        try:
            self._process = subprocess.Popen(
                [sys.executable, str(app_py)],
                cwd=str(self._openroute_dir),
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                creationflags=(
                    subprocess.CREATE_NEW_PROCESS_GROUP
                    if sys.platform == "win32"
                    else 0
                ),
            )
            self._started_at = time.time()
            self._running = True
            logger.info(
                f"OpenRoute subprocess started: PID={self._process.pid}, port={self._port}"
            )
            return {
                "status": "started",
                "message": f"OpenRoute subprocess started (PID {self._process.pid})",
                "port": self._port,
                "pid": self._process.pid,
            }
        except Exception as e:
            logger.error(f"Failed to start OpenRoute: {e}")
            return {
                "status": "error",
                "message": f"Failed to start openroute: {e}",
            }

    async def start_and_wait(self, timeout: int = STARTUP_WAIT_SECONDS) -> dict:
        """Start the openroute and wait until it responds to health checks.

        Args:
            timeout: Maximum seconds to wait for the openroute to become healthy.

        Returns:
            dict with keys: status, message, port, pid, healthy.
        """
        result = self.start()
        if result["status"] == "error":
            return result
        if result["status"] == "already_running":
            healthy = await self._health_check_bool()
            result["healthy"] = healthy
            return result

        deadline = time.time() + timeout
        while time.time() < deadline:
            if self._process is not None and self._process.poll() is not None:
                self._running = False
                return_code = self._process.poll()
                stderr_output = ""
                try:
                    stderr_output = self._process.stderr.read().decode(
                        "utf-8", errors="replace"
                    )[:500]
                except Exception:
                    pass
                return {
                    "status": "crashed",
                    "message": f"OpenRoute process exited with code {return_code}",
                    "stderr": stderr_output,
                }

            healthy = await self._health_check_bool()
            if healthy:
                result["healthy"] = True
                return result

            await asyncio.sleep(HEALTH_POLL_INTERVAL)

        result["healthy"] = False
        result["message"] += " (health check timeout)"
        return result

    def stop(self) -> dict:
        """Stop the openroute service.

        Returns:
            dict with keys: status, message.
        """
        if self._process is None or self._process.poll() is not None:
            self._running = False
            return {
                "status": "not_running",
                "message": "OpenRoute is not running",
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
            logger.info("OpenRoute subprocess stopped")
            return {
                "status": "stopped",
                "message": "OpenRoute stopped successfully",
            }
        except Exception as e:
            logger.error(f"Error stopping OpenRoute: {e}")
            self._running = False
            return {
                "status": "error",
                "message": f"Error stopping openroute: {e}",
            }

    async def get_status(self) -> dict:
        """Get the current status of the openroute service.

        Checks both the subprocess state (if started by us) and the health
        endpoint (works even if started externally).

        Returns:
            dict with keys: running, healthy, port, pid, uptime_seconds,
            models (list of available openroute models).
        """
        process_alive = self._process is not None and self._process.poll() is None
        healthy = await self._health_check_bool()
        models: list = []

        if healthy:
            models = await self._list_models()
            self._running = True
        else:
            self._running = False

        uptime: Optional[float] = None
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

    async def _health_check_bool(self) -> bool:
        """Check if the openroute service is healthy by calling /health.

        Returns:
            True if the openroute responds with a healthy status.
        """
        try:
            async with httpx.AsyncClient(timeout=HEALTH_CHECK_TIMEOUT) as client:
                resp = await client.get(
                    f"http://{self._host}:{self._port}/health"
                )
                return resp.status_code == 200
        except Exception:
            return False

    async def _list_models(self) -> list:
        """List available models from the openroute service.

        Returns:
            List of model dicts with id and object keys.
        """
        try:
            async with httpx.AsyncClient(timeout=HEALTH_CHECK_TIMEOUT) as client:
                resp = await client.get(
                    f"http://{self._host}:{self._port}/v1/models"
                )
                if resp.status_code == 200:
                    data = resp.json()
                    return data.get("data", [])
        except Exception:
            pass
        return []

    async def chat(self, model: str, messages: list, **kwargs: Any) -> Optional[dict]:
        """Send a chat completion request through the openroute.

        Args:
            model: Model identifier (e.g., 'doubao-web/seed-2.0', 'web/chat').
            messages: OpenAI-format message list.
            **kwargs: Additional parameters (temperature, max_tokens, etc.).

        Returns:
            OpenAI-format response dict, or None if the openroute is unavailable.
        """
        if not await self._health_check_bool():
            logger.warning("OpenRoute not healthy, cannot chat")
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
            logger.error(f"OpenRoute chat failed for model={model}: {e}")
            return None
