"""Session Manager - Context compression and handoff.

Implements FR-HRN-06:
- 92% threshold triggers context compaction
- Tool output token truncation (default 25000)
- Session handoff with init_script + progress_log + feature_checklist
- Preserves last N rounds (default 3, configurable)
- v6: Summarization-based compaction and session usage tracking
"""

from __future__ import annotations

import time
from typing import Any

from flowforge.core.tracing import get_logger

logger = get_logger("harness.session_manager")

# Default configuration
DEFAULT_COMPACT_THRESHOLD = 0.92
DEFAULT_CONTEXT_WINDOW = 128_000
DEFAULT_RECENT_ROUNDS = 3
DEFAULT_TOOL_OUTPUT_LIMIT = 25_000
DEFAULT_TOOL_OUTPUT_WARNING = 10_000
DEFAULT_TOOL_OUTPUT_MAX_CHARS = 8_000
SUMMARY_MAX_CHARS = 2_000


def _estimate_tokens(text: str) -> int:
    """Rough token estimation: ~4 chars per token for mixed CJK/Latin text."""
    return max(1, len(text) // 4)


class SessionManager:
    """Session compression and handoff manager.

    Manages context window utilization, triggers compaction
    when threshold is exceeded, and handles session handoff.

    Supports both legacy config-based initialization and v6
    parameter-based initialization.
    """

    def __init__(self, config: dict[str, Any] | None = None):
        self.config = config or {}
        self.compact_threshold = self.config.get("compact_threshold", DEFAULT_COMPACT_THRESHOLD)
        self.context_window = self.config.get("context_window", DEFAULT_CONTEXT_WINDOW)
        self.recent_rounds = self.config.get("recent_rounds", DEFAULT_RECENT_ROUNDS)
        self.tool_output_limit = self.config.get("tool_output_limit", DEFAULT_TOOL_OUTPUT_LIMIT)
        self.tool_output_warning = self.config.get("tool_output_warning", DEFAULT_TOOL_OUTPUT_WARNING)
        # v6: character-based truncation and compaction threshold
        self.tool_output_max_chars = self.config.get("tool_output_max_chars", DEFAULT_TOOL_OUTPUT_MAX_CHARS)
        self._compaction_threshold_tokens = int(self.context_window * self.compact_threshold)
        self._compaction_count = 0
        self._truncation_count = 0
        # v6: per-session token usage tracking
        self._session_usage: dict[str, int] = {}

    # ------------------------------------------------------------------
    # Legacy methods
    # ------------------------------------------------------------------

    def should_compact(self, total_tokens: int) -> bool:
        """Check if compaction should be triggered.

        utilization = total_tokens / context_window
        Trigger when utilization >= compact_threshold (default 92%)
        """
        if self.context_window <= 0:
            return False
        utilization = total_tokens / self.context_window
        return utilization >= self.compact_threshold

    def truncate_tool_output(self, output: str, token_estimate: int = 0) -> str:
        """Truncate tool output if it exceeds the token limit.

        Args:
            output: Tool output string
            token_estimate: Estimated token count (if 0, uses len//4)

        Returns:
            Truncated output with truncation notice if needed
        """
        if not output:
            return output

        estimated = token_estimate or (len(output) // 4)

        if estimated > self.tool_output_limit:
            # Truncate to approximate character limit
            char_limit = self.tool_output_limit * 4
            truncated = output[:char_limit]
            self._truncation_count += 1
            logger.info(f"Tool output truncated: {estimated} → ~{self.tool_output_limit} tokens")
            return truncated + f"\n\n[... truncated, original ~{estimated} tokens ...]"

        if estimated > self.tool_output_warning:
            logger.warning(f"Tool output large: ~{estimated} tokens (limit: {self.tool_output_limit})")

        return output

    async def compact_if_needed(
        self,
        messages: list[dict[str, Any]],
        memory_manager=None,
    ) -> list[dict[str, Any]]:
        """Compact messages if context utilization exceeds threshold.

        Tries v6 summarization-based compaction first, then falls back to
        legacy simple sliding window. Delegates to MemoryManager for actual
        compression if available.
        """
        if not messages:
            return messages

        # Estimate total tokens
        total_tokens = sum(len(str(m.get("content", ""))) // 4 for m in messages)

        if not self.should_compact(total_tokens):
            return messages

        self._compaction_count += 1
        logger.info(
            f"Context compaction triggered: {total_tokens} tokens / {self.context_window} window "
            f"(utilization={total_tokens/self.context_window:.1%})"
        )

        # 1. Try MemoryManager compression
        if memory_manager and hasattr(memory_manager, 'compress_messages'):
            return await memory_manager.compress_messages(messages)

        # 2. Try v6 summarization-based compaction
        try:
            compacted = await self._compact_messages(messages, ctx=None)
            if len(compacted) < len(messages):
                return compacted
        except Exception:
            pass

        # 3. Fallback: simple sliding window (keep recent_rounds)
        return self._simple_compact(messages)

    def _simple_compact(self, messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Simple compaction: keep system message + last N rounds."""
        if len(messages) <= self.recent_rounds * 2 + 1:
            return messages

        system_msgs = [m for m in messages if m.get("role") == "system"]
        non_system = [m for m in messages if m.get("role") != "system"]

        # Keep last recent_rounds * 2 messages (user + assistant pairs)
        keep_count = self.recent_rounds * 2
        kept = non_system[-keep_count:] if len(non_system) > keep_count else non_system

        compacted = system_msgs + [{"role": "system", "content": "[Earlier context compacted]"}] + kept
        return compacted

    def build_handoff(
        self,
        init_script: str = "",
        progress_log: list[str] | None = None,
        feature_checklist: list[str] | None = None,
    ) -> dict:
        """Build session handoff artifact for context resumption."""
        return {
            "init_script": init_script,
            "progress_log": progress_log or [],
            "feature_checklist": feature_checklist or [],
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }

    def get_status(self) -> dict:
        """Get session manager status."""
        return {
            "enabled": True,
            "compact_threshold": self.compact_threshold,
            "context_window": self.context_window,
            "recent_rounds": self.recent_rounds,
            "tool_output_limit": self.tool_output_limit,
            "compaction_count": self._compaction_count,
            "truncation_count": self._truncation_count,
        }

    # ------------------------------------------------------------------
    # v6 methods
    # ------------------------------------------------------------------

    async def check_and_compact(self, ctx) -> dict[str, Any]:
        """Check context usage and compact if the threshold is exceeded.

        Estimates the token usage of the current conversation history stored
        in ``ctx.state["messages"]``. If usage exceeds the compaction
        threshold, older messages are summarized and replaced.

        Args:
            ctx: The current TaskContext.

        Returns:
            A dictionary with ``compacted`` (bool), ``before_tokens``,
            ``after_tokens``, and ``threshold``.
        """
        state = getattr(ctx, 'state', None)
        messages: list[dict[str, Any]] = state.get("messages", []) if state else []
        if not messages:
            return {
                "compacted": False,
                "before_tokens": 0,
                "after_tokens": 0,
                "threshold": self._compaction_threshold_tokens,
            }

        before_tokens = self._estimate_messages_tokens(messages)
        session_key = getattr(ctx, 'task_id', 'unknown')
        self._session_usage[session_key] = before_tokens

        if before_tokens < self._compaction_threshold_tokens:
            logger.debug(
                "Context below threshold",
                task_id=session_key,
                tokens=before_tokens,
                threshold=self._compaction_threshold_tokens,
            )
            return {
                "compacted": False,
                "before_tokens": before_tokens,
                "after_tokens": before_tokens,
                "threshold": self._compaction_threshold_tokens,
            }

        compacted_messages = await self._compact_messages(messages, ctx)
        after_tokens = self._estimate_messages_tokens(compacted_messages)
        self._session_usage[session_key] = after_tokens

        if state is not None:
            state["messages"] = compacted_messages
            state["compaction_applied"] = True

        logger.info(
            "Context compacted",
            task_id=session_key,
            before_tokens=before_tokens,
            after_tokens=after_tokens,
            messages_before=len(messages),
            messages_after=len(compacted_messages),
        )

        return {
            "compacted": True,
            "before_tokens": before_tokens,
            "after_tokens": after_tokens,
            "threshold": self._compaction_threshold_tokens,
        }

    def get_session_usage(self, task_id: str) -> int:
        """Get the estimated token usage for a session.

        Args:
            task_id: The task identifier.

        Returns:
            The estimated token count, or 0 if the session is unknown.
        """
        return self._session_usage.get(task_id, 0)

    # ------------------------------------------------------------------
    # v6 internal methods
    # ------------------------------------------------------------------

    def _estimate_messages_tokens(self, messages: list[dict[str, Any]]) -> int:
        """Estimate the total token count of a message list.

        Args:
            messages: List of message dictionaries with ``content`` fields.

        Returns:
            Estimated total token count.
        """
        total = 0
        for msg in messages:
            content = msg.get("content", "")
            if isinstance(content, str):
                total += _estimate_tokens(content)
            elif isinstance(content, list):
                for part in content:
                    if isinstance(part, dict):
                        text = part.get("text", "")
                        total += _estimate_tokens(text)
                    elif isinstance(part, str):
                        total += _estimate_tokens(part)
            role = msg.get("role", "")
            total += _estimate_tokens(role)
        return total

    async def _compact_messages(
        self,
        messages: list[dict[str, Any]],
        ctx=None,
    ) -> list[dict[str, Any]]:
        """Compact messages by summarizing older ones.

        Strategy: keep the system message (if any) and the most recent N
        messages intact. Replace all messages in between with a single
        summary message.

        Args:
            messages: The full message history.
            ctx: The current TaskContext (optional, for future LLM-based summarization).

        Returns:
            A compacted message list.
        """
        if len(messages) <= 3:
            return messages

        system_messages: list[dict[str, Any]] = []
        conversation: list[dict[str, Any]] = []

        for msg in messages:
            if msg.get("role") == "system":
                system_messages.append(msg)
            else:
                conversation.append(msg)

        keep_recent = max(2, len(conversation) // 4)
        older = conversation[:-keep_recent]
        recent = conversation[-keep_recent:]

        if not older:
            return messages

        summary_text = self._summarize_older_messages(older)
        summary_msg: dict[str, Any] = {
            "role": "system",
            "content": f"[Context Summary — {len(older)} earlier messages compacted]\n{summary_text}",
        }

        return system_messages + [summary_msg] + recent

    def _summarize_older_messages(self, messages: list[dict[str, Any]]) -> str:
        """Create a text summary of older messages.

        Extracts key information from each message and concatenates them
        into a compact summary. In a production system this would call
        an LLM for summarization; here we use extractive summarization
        to avoid adding LLM dependency in the harness.

        Args:
            messages: The older messages to summarize.

        Returns:
            A summary string.
        """
        parts: list[str] = []
        for msg in messages:
            role = msg.get("role", "unknown")
            content = msg.get("content", "")
            if isinstance(content, list):
                content = " ".join(
                    p.get("text", "") if isinstance(p, dict) else str(p)
                    for p in content
                )
            if isinstance(content, str) and content:
                preview = content[:SUMMARY_MAX_CHARS]
                parts.append(f"[{role}] {preview}")

        summary = "\n".join(parts)
        if len(summary) > SUMMARY_MAX_CHARS * 2:
            summary = summary[: SUMMARY_MAX_CHARS * 2] + "\n... [summary truncated]"
        return summary
