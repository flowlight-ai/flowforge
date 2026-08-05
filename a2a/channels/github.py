"""GitHub PR review channel adapter — @mention routing.

Routes GitHub pull-request review events to A2A agents. When a PR
comment contains ``@agent_name`` (e.g. ``@coder please review this PR``),
this adapter converts it into an ``A2AMention`` so the corresponding
agent can be triggered. Review results are posted back as GitHub PR
comments.

The adapter runs a small ``asyncio`` HTTP server that accepts GitHub
webhook POSTs. Every payload is verified against the webhook secret
using the ``X-Hub-Signature-256`` HMAC before it is parsed; verified
mentions are pushed onto an ``asyncio`` queue and yielded by
``listen()``. Outbound replies are still logged stubs.

Configuration (from ``a2a_channels.yaml``)::

    channels:
      github:
        enabled: false
        webhook_secret: "${GITHUB_WEBHOOK_SECRET}"
        api_token: "${GITHUB_API_TOKEN}"
        repos:
          - "your-org/your-repo"
        host: "0.0.0.0"
        port: 8810
        path: "/webhook/github"

Secrets use ``${ENV_VAR}`` placeholders resolved at runtime (red-line #11).
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
from typing import Any, AsyncIterator, Optional

from flowforge.core.tracing import get_logger

from flowforge.a2a.channels.base import ChannelAdapter
from flowforge.a2a.protocol import A2AMention, A2AMessage
from flowforge.a2a.router import MentionRouter

logger = get_logger("flowforge.a2a.channels.github")

# GitHub event types that carry a PR comment / review body.
_HANDLED_EVENTS = {"pull_request_review_comment", "pull_request_review", "issue_comment"}

_DEFAULT_HOST = "0.0.0.0"
_DEFAULT_PORT = 8810
_DEFAULT_PATH = "/webhook/github"


def _resolve_env(value: str) -> str:
    """Resolve a ``${VAR}`` placeholder against the process environment."""
    if isinstance(value, str) and value.startswith("${") and value.endswith("}"):
        env_name = value[2:-1]
        return os.environ.get(env_name, "")
    return value


class GitHubChannel(ChannelAdapter):
    """GitHub PR review A2A channel adapter.

    Owns an ``asyncio`` webhook server that:

    - verifies the ``X-Hub-Signature-256`` header (HMAC-SHA256) against
      the configured ``webhook_secret``; unverified requests are dropped,
    - filters out events for repos not present in the ``repos`` allow-list,
    - parses ``pull_request_review_comment`` / ``pull_request_review`` /
      ``issue_comment`` payloads via ``parse_pr_comment``,
    - enqueues the resulting ``A2AMention`` objects (via
      ``handle_webhook``) so ``listen()`` can yield them.
    """

    name = "github"

    def __init__(self, config: dict[str, Any]) -> None:
        self._config = config
        self._webhook_secret = _resolve_env(config.get("webhook_secret", ""))
        self._api_token = _resolve_env(config.get("api_token", ""))
        self._repos: list[str] = list(config.get("repos", []))
        self._host = str(config.get("host", _DEFAULT_HOST))
        self._port = int(config.get("port", _DEFAULT_PORT))
        self._path = str(config.get("path", _DEFAULT_PATH))
        self._parser = MentionRouter()
        self._running = False
        self._queue: "asyncio.Queue[A2AMention]" = asyncio.Queue()
        self._server: Optional[asyncio.AbstractServer] = None
        self._receiver_task: Optional[asyncio.Task] = None

    async def start(self) -> None:
        """Start the GitHub webhook listener (an asyncio HTTP server)."""
        if not self._webhook_secret:
            logger.warning(
                "GitHubChannel: webhook_secret is not configured; "
                "inbound listening will be inactive."
            )
            return
        if not self._api_token:
            logger.warning(
                "GitHubChannel: api_token is not configured; "
                "outbound replies will be disabled."
            )
        try:
            self._server = await asyncio.start_server(
                self._handle_connection, self._host, self._port
            )
        except OSError as exc:  # pragma: no cover - bind failures are env-specific
            logger.error(
                f"GitHubChannel: could not bind {self._host}:{self._port}: {exc}"
            )
            return
        self._running = True
        self._receiver_task = asyncio.create_task(self._run())
        logger.info(
            f"GitHubChannel: started (watching {len(self._repos)} repo(s) on "
            f"{self._host}:{self._port}{self._path})"
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
        logger.info("GitHubChannel: stopped")

    def parse_pr_comment(self, raw: dict[str, Any]) -> list[A2AMention]:
        """Parse a GitHub PR review comment webhook into A2A mentions.

        GitHub webhook payloads for ``pull_request_review_comment`` include
        a ``comment`` object with a ``body`` field. This method extracts
        ``@agent_name`` tokens from the body.

        Args:
            raw: The raw GitHub webhook payload.

        Returns:
            A list of parsed mentions (may be empty).
        """
        comment = raw.get("comment", {})
        body = comment.get("body", "")
        sender = raw.get("sender", {}).get("login", "github_user")
        repo = raw.get("repository", {}).get("full_name", "")
        # For ``issue_comment`` the pull request context lives under
        # ``issue``; ``pull_request_review_comment`` uses ``pull_request``.
        pr_source = raw.get("pull_request") or raw.get("issue") or {}
        pr_number = pr_source.get("number")

        # Build a thread id that scopes this PR's conversation.
        thread_id = f"gh:{repo}#{pr_number}" if repo and pr_number else None

        mentions = self._parser.parse_mention(body, from_agent=str(sender))
        for m in mentions:
            m.thread_id = thread_id

        logger.debug(
            f"GitHubChannel: parsed {len(mentions)} mention(s) from "
            f"PR comment in {repo}#{pr_number}"
        )
        return mentions

    @staticmethod
    def verify_signature(secret: str, body: bytes, signature: str) -> bool:
        """Verify ``X-Hub-Signature-256`` against the webhook secret.

        GitHub signs webhook payloads with HMAC-SHA256 using the webhook
        secret, and sends the digest as ``sha256=<hex>`` under the
        ``X-Hub-Signature-256`` header. Comparison is constant-time to
        avoid timing side channels.

        Args:
            secret: The configured ``webhook_secret``.
            body: The raw webhook payload bytes (exactly as received).
            signature: The ``X-Hub-Signature-256`` header value.

        Returns:
            ``True`` if the signature matches, ``False`` otherwise.
        """
        if not signature or not signature.startswith("sha256="):
            return False
        digest = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(signature, f"sha256={digest}")

    def is_allowed_repo(self, full_name: str) -> bool:
        """Return ``True`` when ``full_name`` is in the repo allow-list.

        An empty allow-list permits every repository; a non-empty one
        restricts inbound events to the listed ``owner/repo`` values.
        """
        if not self._repos:
            return True
        return full_name in self._repos

    async def handle_webhook(
        self,
        headers: dict[str, str],
        body: bytes,
    ) -> None:
        """Validate an inbound GitHub webhook and enqueue any mentions.

        Args:
            headers: HTTP headers from the webhook request.
            body: The raw webhook payload (JSON).
        """
        if not self._running:
            return

        event = headers.get("X-GitHub-Event", "")
        if event not in _HANDLED_EVENTS:
            logger.debug(f"GitHubChannel: ignoring event type '{event}'")
            return

        signature = headers.get("X-Hub-Signature-256", "")
        if not self.verify_signature(self._webhook_secret, body, signature):
            logger.warning("GitHubChannel: invalid webhook signature; dropping event")
            return

        try:
            payload: dict[str, Any] = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            logger.warning("GitHubChannel: malformed webhook payload; dropping event")
            return

        repo = payload.get("repository", {}).get("full_name", "")
        if not self.is_allowed_repo(repo):
            logger.info(f"GitHubChannel: repo '{repo}' not in allow-list; ignoring")
            return

        for mention in self.parse_pr_comment(payload):
            logger.info(
                f"GitHubChannel: enqueueing mention {mention.from_agent} -> @{mention.to_agent}"
            )
            await self._queue.put(mention)

    async def _handle_connection(
        self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        """Serve a single GitHub webhook POST and write an HTTP response."""
        try:
            request_line = (await reader.readline()).decode("latin-1", errors="replace").strip()
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
            await self.handle_webhook(headers, body)
            await self._send_response(writer, 200, b"ok")
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
        """Idle-reconnect loop used by ``start``/``stop`` bookkeeping."""
        # This task owns no work of its own; it exists so ``stop()`` can
        # cancel a single handle for the server's lifetime.
        while self._running:
            await asyncio.sleep(3600)

    async def listen(self) -> AsyncIterator[A2AMention]:
        """Yield inbound mentions pulled from the webhook queue.

        Each ``A2AMention`` is parsed from a verified GitHub webhook
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
        """Post a mention as a GitHub PR comment.

        .. note:: Skeleton — logs the intent but does not call the API.
            Implement with ``POST /repos/{owner}/{repo}/issues/{pr}/comments``
            when ready.
        """
        if not self._api_token:
            logger.warning(
                "GitHubChannel: api_token not configured; cannot send mention."
            )
            return False
        logger.info(
            f"GitHubChannel: [STUB] would post PR comment "
            f"{mention.from_agent} -> @{mention.to_agent}"
        )
        return True

    async def reply_thread(self, thread_id: str, message: A2AMessage) -> bool:
        """Reply to a GitHub PR thread (``gh:owner/repo#pr``).

        .. note:: Skeleton — logs the intent but does not call the API.
        """
        if not self._api_token:
            logger.warning(
                "GitHubChannel: api_token not configured; cannot reply."
            )
            return False
        text_parts = [p.text for p in message.parts if p.text]
        body = " | ".join(text_parts) if text_parts else "(no text)"
        logger.info(
            f"GitHubChannel: [STUB] would reply to {thread_id}: {body[:80]}"
        )
        return True