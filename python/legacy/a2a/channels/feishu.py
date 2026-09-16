"""Feishu (Lark) channel adapter — @mention routing skeleton.

Bridges Feishu group chat messages with the A2A protocol. Inbound
Feishu messages containing ``@agent_name`` mentions are converted to
``A2AMention`` objects; outbound mentions are posted back to the Feishu
thread via the Feishu Open API.

The adapter runs a small ``asyncio`` HTTP server (mirroring
``channels/github.py``) that receives Feishu custom-event webhook POSTs.
Inbound payloads are verified against the configured ``token`` and the
``url_verification`` handshake challenge is answered before parsed
``@mention`` events are pushed onto an ``asyncio`` queue for ``listen()``
to yield. Outbound replies are still logged stubs.

Configuration (from ``a2a_channels.yaml``)::

    channels:
      feishu:
        enabled: false
        webhook_url: "${FEISHU_WEBHOOK_URL}"
        app_id: "${FEISHU_APP_ID}"
        app_secret: "${FEISHU_APP_SECRET}"
        token: "${FEISHU_VERIFY_TOKEN}"
        host: "0.0.0.0"
        port: 8811
        path: "/webhook/feishu"

Secrets are referenced via ``${ENV_VAR}`` placeholders and resolved at
runtime from the process environment (red-line #11: no hardcoded keys).
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from typing import Any, AsyncIterator, Optional

from flowforge.core.tracing import get_logger

from flowforge.a2a.channels.base import ChannelAdapter
from flowforge.a2a.protocol import A2AMention, A2AMessage
from flowforge.a2a.router import MentionRouter

logger = get_logger("flowforge.a2a.channels.feishu")

# Feishu @mentions arrive as <at user_id="xxx">name</at> in text content.
_FEISHU_AT_PATTERN = re.compile(r'<at[^>]*>([^<]+)</at>')

_DEFAULT_HOST = "0.0.0.0"
_DEFAULT_PORT = 8811
_DEFAULT_PATH = "/webhook/feishu"
#: Feishu custom-event subscription performs a ``url_verification`` handshake
#: used to confirm the webhook endpoint before events are streamed.
_URL_VERIFICATION = "url_verification"


def _resolve_env(value: str) -> str:
    """Resolve a ``${VAR}`` placeholder against the process environment.

    If ``value`` matches ``${SOMETHING}``, the corresponding env var is
    returned (or empty string if unset). Otherwise ``value`` is returned
    unchanged. This honors red-line #11 (no hardcoded secrets).
    """
    if isinstance(value, str) and value.startswith("${") and value.endswith("}"):
        env_name = value[2:-1]
        return os.environ.get(env_name, "")
    return value


class FeishuChannel(ChannelAdapter):
    """Feishu (Lark) A2A channel adapter — skeleton implementation.

    Owns an ``asyncio`` webhook server that:

    - answers the ``url_verification`` challenge with the echoed
      ``challenge`` when a ``token`` is configured,
    - verifies each inbound payload's ``token`` against the configured
      value; unverified payloads are dropped,
    - parses Feishu ``<at>`` mentions into ``A2AMention`` objects, and
    - enqueues them so ``listen()`` can yield them.

    Outbound ``send_mention`` / ``reply_thread`` remain logged stubs until
    the Feishu Open API ``im/v1/messages`` client is wired in.
    """

    name = "feishu"

    def __init__(self, config: dict[str, Any]) -> None:
        self._config = config
        self._webhook_url = _resolve_env(config.get("webhook_url", ""))
        self._app_id = _resolve_env(config.get("app_id", ""))
        self._app_secret = _resolve_env(config.get("app_secret", ""))
        self._verify_token = _resolve_env(config.get("token", ""))
        self._host = str(config.get("host", _DEFAULT_HOST))
        self._port = int(config.get("port", _DEFAULT_PORT))
        self._path = str(config.get("path", _DEFAULT_PATH))
        # Reuse the shared mention parser for @name extraction.
        self._parser = MentionRouter()
        self._running = False
        self._queue: "asyncio.Queue[A2AMention]" = asyncio.Queue()
        self._server: Optional[asyncio.AbstractServer] = None
        self._receiver_task: Optional[asyncio.Task] = None

    async def start(self) -> None:
        """Start the Feishu webhook listener (an asyncio HTTP server).

        If no ``token`` is configured the inbound listener stays inactive
        (a subscription handshake cannot be answered safely without it);
        if the bind fails the adapter logs the error and stays stopped.
        """
        if not self._verify_token:
            logger.warning(
                "FeishuChannel: token is not configured; "
                "inbound listening will be inactive."
            )
            return
        if not self._webhook_url:
            logger.info(
                "FeishuChannel: webhook_url is not configured; "
                "the inbound server will still accept webhook POSTs."
            )
        try:
            self._server = await asyncio.start_server(
                self._handle_connection, self._host, self._port
            )
        except OSError as exc:  # pragma: no cover - bind failures are env-specific
            logger.error(
                f"FeishuChannel: could not bind {self._host}:{self._port}: {exc}"
            )
            return
        self._running = True
        self._receiver_task = asyncio.create_task(self._run())
        logger.info(
            f"FeishuChannel: started (webhook on {self._host}:{self._port}{self._path})"
        )

    async def stop(self) -> None:
        """Stop the listener and drain the receiver task."""
        self._running = False
        if self._receiver_task is not None:
            self._receiver_task.cancel()
            try:
                await self._receiver_task
            except asyncio.CancelledError:
                pass
            self._receiver_task = None
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()
            self._server = None
        logger.info("FeishuChannel: stopped")

    def parse_feishu_message(self, raw: dict[str, Any]) -> list[A2AMention]:
        """Parse a raw Feishu webhook event into A2A mentions.

        Feishu sends message events with content like::

            {"message": {"content": "<at user_id=\\"ou_xxx\\">coder</at> please review"}}

        This method extracts ``@agent_name`` mentions from the content
        and returns ``A2AMention`` objects.

        Args:
            raw: The raw Feishu webhook payload.

        Returns:
            A list of parsed mentions (may be empty).
        """
        message = raw.get("message", raw)
        content = message.get("content", "")
        sender = (
            raw.get("sender", {})
            .get("sender_id", {})
            .get("open_id", "feishu_user")
        )
        thread_id = message.get("thread_id") or message.get("message_id")

        # Extract mention names from <at>...</at> tags.
        at_names = _FEISHU_AT_PATTERN.findall(content)
        if not at_names:
            return []

        mentions: list[A2AMention] = []
        for name in at_names:
            name = name.strip()
            if not name:
                continue
            mentions.append(
                A2AMention(
                    from_agent=str(sender),
                    to_agent=name,
                    content=content,
                    thread_id=thread_id,
                )
            )
        logger.debug(
            f"FeishuChannel: parsed {len(mentions)} mention(s) from Feishu event"
        )
        return mentions

    def _payload_token(self, payload: dict[str, Any]) -> str:
        """Extract the verification token from a Feishu webhook payload.

        Newer (schema 2.0) events carry the token on ``header.token``;
        classic events carry it at the top level. Returns ``""`` when the
        payload carries no token.
        """
        header = payload.get("header")
        if isinstance(header, dict):
            return str(header.get("token", ""))
        return str(payload.get("token", ""))

    async def handle_webhook(
        self,
        payload: dict[str, Any],
    ) -> bytes:
        """Validate an inbound Feishu webhook payload and return a response.

        Args:
            payload: The decoded Feishu webhook JSON payload.

        Returns:
            The HTTP response body: the echoed challenge for a
            ``url_verification`` handshake, or an OK marker once any
            mentions have been enqueued.
        """
        if not self._running:
            return b""

        if self._payload_token(payload) != self._verify_token:
            logger.warning("FeishuChannel: invalid webhook token; dropping event")
            return b"forbidden"

        # Answer the subscription handshake so Feishu accepts the endpoint.
        if payload.get("type") == _URL_VERIFICATION:
            challenge = payload.get("challenge", "")
            return json.dumps({"challenge": challenge}).encode("utf-8")

        for mention in self.parse_feishu_message(payload):
            logger.info(
                f"FeishuChannel: enqueueing mention "
                f"{mention.from_agent} -> @{mention.to_agent}"
            )
            await self._queue.put(mention)
        return b"ok"

    async def _handle_connection(
        self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        """Serve a single Feishu webhook POST and write an HTTP response."""
        try:
            request_line = (
                (await reader.readline()).decode("latin-1", errors="replace").strip()
            )
            if not request_line:
                return
            method, target, _ = request_line.split(" ", 2)

            headers: dict[str, str] = {}
            while True:
                line = await reader.readline()
                if line in (b"\r\n", b"\n", b""):
                    break
                name, _, value = line.decode("latin-1", errors="replace").partition(":")
                headers[name.strip()] = value.strip()

            if method != "POST" or target != self._path:
                await self._send_response(writer, 404, b"not found")
                return

            content_length = int(headers.get("Content-Length", "0") or 0)
            body = await reader.readexactly(content_length)
            try:
                payload: dict[str, Any] = json.loads(body.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                logger.warning("FeishuChannel: malformed webhook payload; dropping")
                await self._send_response(writer, 400, b"bad request")
                return

            response = await self.handle_webhook(payload)
            await self._send_response(writer, 200, response)
        except (asyncio.IncompleteReadError, asyncio.LimitOverrunError, ValueError, ConnectionError):
            try:
                await self._send_response(writer, 400, b"bad request")
            except (ConnectionError, OSError):
                pass
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except (ConnectionError, OSError):
                pass

    async def _send_response(
        self, writer: asyncio.StreamWriter, status: int, body: bytes
    ) -> None:
        reason = "OK" if status == 200 else "not found" if status == 404 else "bad request"
        writer.write(
            f"HTTP/1.1 {status} {reason}\r\nContent-Length: {len(body)}\r\n\r\n".encode("latin-1")
        )
        writer.write(body)
        await writer.drain()

    async def _run(self) -> None:
        """Idle-reconnect loop used by ``start``/``stop`` bookkeeping.

        This task owns no work of its own; it exists so ``stop()`` can
        cancel a single handle for the server's lifetime.
        """
        while self._running:
            await asyncio.sleep(3600)

    async def listen(self) -> AsyncIterator[A2AMention]:
        """Yield inbound mentions pulled from the webhook queue.

        Each ``A2AMention`` is parsed from a verified Feishu webhook
        payload. Yielding blocks until either a mention is enqueued by
        ``handle_webhook`` or the adapter is stopped.
        """
        while self._running:
            try:
                mention = await asyncio.wait_for(self._queue.get(), timeout=0.5)
            except asyncio.TimeoutError:
                continue
            yield mention

    async def send_mention(self, mention: A2AMention) -> bool:
        """Post a mention back to a Feishu thread.

        .. note:: Skeleton — logs the intent but does not perform the
            HTTP API call. Implement with Feishu Open API
            ``im/v1/messages`` when ready.
        """
        if not self._app_id or not self._app_secret:
            logger.warning(
                "FeishuChannel: app_id/app_secret not configured; "
                "cannot send mention."
            )
            return False
        logger.info(
            f"FeishuChannel: [STUB] would post mention "
            f"{mention.from_agent} -> @{mention.to_agent}"
        )
        return True

    async def reply_thread(self, thread_id: str, message: A2AMessage) -> bool:
        """Reply to a Feishu thread.

        .. note:: Skeleton — logs the intent but does not call the API.
        """
        if not self._app_id or not self._app_secret:
            logger.warning(
                "FeishuChannel: app_id/app_secret not configured; "
                "cannot reply to thread."
            )
            return False
        text_parts = [p.text for p in message.parts if p.text]
        body = " | ".join(text_parts) if text_parts else "(no text)"
        logger.info(
            f"FeishuChannel: [STUB] would reply to thread {thread_id}: {body[:80]}"
        )
        return True