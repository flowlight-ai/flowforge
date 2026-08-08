"""GitHub PR review channel adapter — @mention routing skeleton.

Routes GitHub pull-request review events to A2A agents. When a PR
comment contains ``@agent_name`` (e.g. ``@coder please review this PR``),
this adapter converts it into an ``A2AMention`` so the corresponding
agent can be triggered. Review results are posted back as GitHub PR
comments.

This is a **skeleton** implementation — configurable but disabled by
default. The actual GitHub Webhook ingestion and API posting are
stubbed with logging.

Configuration (from ``a2a_channels.yaml``)::

    channels:
      github:
        enabled: false
        webhook_secret: "${GITHUB_WEBHOOK_SECRET}"
        api_token: "${GITHUB_API_TOKEN}"
        repos:
          - "your-org/your-repo"

Secrets use ``${ENV_VAR}`` placeholders resolved at runtime (red-line #11).
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from typing import Any

from flowforge.a2a.channels.base import ChannelAdapter
from flowforge.a2a.protocol import A2AMention, A2AMessage
from flowforge.a2a.router import MentionRouter
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.a2a.channels.github")


def _resolve_env(value: str) -> str:
    """Resolve a ``${VAR}`` placeholder against the process environment."""
    if isinstance(value, str) and value.startswith("${") and value.endswith("}"):
        env_name = value[2:-1]
        return os.environ.get(env_name, "")
    return value


class GitHubChannel(ChannelAdapter):
    """GitHub PR review A2A channel adapter — skeleton implementation.

    Listens for GitHub ``pull_request_review_comment`` webhook events,
    parses ``@agent_name`` mentions from comment bodies, and routes them
    as ``A2AMention`` objects. Outbound replies are posted as PR comments
    via the GitHub REST API.
    """

    name = "github"

    def __init__(self, config: dict[str, Any]) -> None:
        self._config = config
        self._webhook_secret = _resolve_env(config.get("webhook_secret", ""))
        self._api_token = _resolve_env(config.get("api_token", ""))
        self._repos: list[str] = list(config.get("repos", []))
        self._parser = MentionRouter()
        self._running = False

    async def start(self) -> None:
        """Start the GitHub webhook listener.

        .. note:: Skeleton — in production this would start an HTTP
            server to receive GitHub webhook events, verifying the
            ``X-Hub-Signature-256`` header against ``webhook_secret``.
        """
        if not self._webhook_secret:
            logger.warning(
                "GitHubChannel: webhook_secret is not configured; "
                "inbound listening will be inactive."
            )
        if not self._api_token:
            logger.warning(
                "GitHubChannel: api_token is not configured; "
                "outbound replies will be disabled."
            )
        self._running = True
        logger.info(
            f"GitHubChannel: started (skeleton — watching {len(self._repos)} repo(s))"
        )

    async def stop(self) -> None:
        """Stop the listener."""
        self._running = False
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
        pr_number = raw.get("pull_request", {}).get("number")

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

    async def listen(self) -> AsyncIterator[A2AMention]:
        """Yield inbound mentions from GitHub webhook events.

        .. note:: Skeleton — without a live webhook receiver, this
            yields nothing. Wire up an HTTP listener that feeds
            ``parse_pr_comment`` results into an asyncio queue.
        """
        # TODO: integrate with a live GitHub webhook receiver.
        return
        yield  # type: ignore[unreachable]  # pragma: no cover

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
