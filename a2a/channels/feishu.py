"""Feishu (Lark) channel adapter — @mention routing skeleton.

Bridges Feishu group chat messages with the A2A protocol. Inbound
Feishu messages containing ``@agent_name`` mentions are converted to
``A2AMention`` objects; outbound mentions are posted back to the Feishu
thread via the Feishu Open API.

This is a **skeleton** implementation — it is configurable but disabled
by default. The actual HTTP API calls (webhook ingestion, message
posting) are stubbed with logging and must be completed with a real
Feishu SDK / HTTP client before production use.

Configuration (from ``a2a_channels.yaml``)::

    channels:
      feishu:
        enabled: false
        webhook_url: "${FEISHU_WEBHOOK_URL}"
        app_id: "${FEISHU_APP_ID}"
        app_secret: "${FEISHU_APP_SECRET}"

Secrets are referenced via ``${ENV_VAR}`` placeholders and resolved at
runtime from the process environment (red-line #11: no hardcoded keys).
"""

from __future__ import annotations

import os
import re
from typing import Any, AsyncIterator

from flowforge.core.tracing import get_logger

from flowforge.a2a.channels.base import ChannelAdapter
from flowforge.a2a.protocol import A2AMention, A2AMessage
from flowforge.a2a.router import MentionRouter

logger = get_logger("flowforge.a2a.channels.feishu")

# Feishu @mentions arrive as <at user_id="xxx">name</at> in text content.
_FEISHU_AT_PATTERN = re.compile(r'<at[^>]*>([^<]+)</at>')


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

    Parses Feishu ``<at>`` mentions into ``A2AMention`` objects and
    posts replies via the Feishu Open API. The HTTP layer is stubbed;
    only the mention-parsing logic is functional.
    """

    name = "feishu"

    def __init__(self, config: dict[str, Any]) -> None:
        self._config = config
        self._webhook_url = _resolve_env(config.get("webhook_url", ""))
        self._app_id = _resolve_env(config.get("app_id", ""))
        self._app_secret = _resolve_env(config.get("app_secret", ""))
        # Reuse the shared mention parser for @name extraction.
        self._parser = MentionRouter()
        self._running = False

    async def start(self) -> None:
        """Start the Feishu webhook listener.

        .. note:: Skeleton — in production this would start an HTTP
            server to receive Feishu webhook events.
        """
        if not self._webhook_url:
            logger.warning(
                "FeishuChannel: webhook_url is not configured; "
                "inbound listening will be inactive."
            )
        self._running = True
        logger.info("FeishuChannel: started (skeleton — no live webhook)")

    async def stop(self) -> None:
        """Stop the listener."""
        self._running = False
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

    async def listen(self) -> AsyncIterator[A2AMention]:
        """Yield inbound mentions from Feishu webhook events.

        .. note:: Skeleton — without a live webhook server, this yields
            nothing. Wire up an HTTP listener that feeds parsed events
            into an asyncio queue, then yield from that queue.
        """
        # TODO: integrate with a live webhook receiver.
        return
        yield  # type: ignore[unreachable]  # pragma: no cover

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
