from typing import Any

from flowforge.core.base_tool import ToolInput
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.memory.compressor")

try:
    import tiktoken
    _tokenizer = tiktoken.get_encoding("cl100k_base")

    def _count_tokens(text: str) -> int:
        return len(_tokenizer.encode(text))
except Exception:
    def _count_tokens(text: str) -> int:
        return max(1, len(text) // 4)


RECENT_ROUNDS = 3
COMPRESSION_THRESHOLD = 0.85
MAX_CONTEXT_TOKENS = 128000


class ContextCompressor:
    def __init__(self, llm_client=None):
        self._llm_client = llm_client
        self._max_context_tokens = MAX_CONTEXT_TOKENS

    async def compress_if_needed(
        self,
        messages: list[dict[str, Any]],
        context=None,
    ) -> list[dict[str, Any]]:
        total_tokens = self._estimate_messages_tokens(messages)
        if total_tokens <= self._max_context_tokens * COMPRESSION_THRESHOLD:
            return messages

        logger.info(
            f"Context compression triggered: {total_tokens} tokens > "
            f"{int(self._max_context_tokens * COMPRESSION_THRESHOLD)} threshold"
        )

        recent, early = self._split_messages(messages)

        if not early:
            return messages

        compressed_early = await self._compress_early_history(early, context)

        if context and context.memory:
            await self._save_to_memory(context, early)

        result = compressed_early + recent
        new_tokens = self._estimate_messages_tokens(result)
        logger.info(
            f"Context compressed: {total_tokens} -> {new_tokens} tokens "
            f"({len(early)} early -> {len(compressed_early)} compressed)"
        )
        return result

    def _split_messages(
        self, messages: list[dict[str, Any]]
    ) -> tuple:
        decision_indices = []
        for i, msg in enumerate(messages):
            if self._is_decision_or_tool_result(msg):
                decision_indices.append(i)

        if not decision_indices:
            return [], messages

        recent_start = max(0, len(decision_indices) - RECENT_ROUNDS)
        split_idx = decision_indices[recent_start] if recent_start < len(decision_indices) else 0

        early = messages[:split_idx]
        recent = messages[split_idx:]
        return early, recent

    async def _compress_early_history(
        self,
        early: list[dict[str, Any]],
        context=None,
    ) -> list[dict[str, Any]]:
        llm = None
        if context and context.tools:
            try:
                llm = context.tools.get_tool("llm")
            except Exception:
                pass

        if not llm and self._llm_client:
            llm = self._llm_client

        if not llm:
            logger.warning("No LLM available for compression, keeping early history as-is")
            return early

        history_text = ""
        for msg in early:
            role = msg.get("role", "unknown")
            content = msg.get("content", "")
            if isinstance(content, list):
                content = " ".join(
                    c.get("text", "") if isinstance(c, dict) else str(c)
                    for c in content
                )
            history_text += f"[{role}]: {content}\n"

        prompt = (
            "Summarize the following conversation history concisely, preserving key decisions, "
            "facts, tool results, and conclusions. Do not lose any important information.\n\n"
            f"{history_text}\n\nSummary:"
        )

        try:
            result = await llm.execute(ToolInput(params={
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 800,
            }))
            summary_text = result.result.get("content", "")
            if not summary_text:
                return early
            return [{"role": "system", "content": f"[Compressed History] {summary_text}"}]
        except Exception as e:
            logger.error(f"LLM compression failed: {e}")
            return early

    def _is_decision_or_tool_result(self, msg: dict[str, Any]) -> bool:
        role = msg.get("role", "")
        if role in ("tool",):
            return True
        if role == "system":
            return True
        if role == "assistant":
            if msg.get("tool_calls"):
                return True
            content = msg.get("content", "")
            if isinstance(content, str) and any(
                kw in content.lower()
                for kw in ["final answer", "conclusion", "result:", "decision:"]
            ):
                return True
        return False

    async def _save_to_memory(self, context, messages: list[dict[str, Any]]):
        try:
            await context.memory.save(
                "long_term",
                f"compressed_{context.task_id}",
                {
                    "task_id": context.task_id,
                    "message_count": len(messages),
                    "messages": messages,
                },
            )
            logger.info(f"Saved {len(messages)} compressed messages to long-term memory")
        except Exception as e:
            logger.error(f"Failed to save compressed messages to memory: {e}")

    def _estimate_messages_tokens(self, messages: list[dict[str, Any]]) -> int:
        total = 0
        for msg in messages:
            content = msg.get("content", "")
            if isinstance(content, list):
                for c in content:
                    if isinstance(c, dict):
                        total += _count_tokens(c.get("text", ""))
                    else:
                        total += _count_tokens(str(c))
            elif isinstance(content, str):
                total += _count_tokens(content)
            total += 4
        return total

    def set_context_window(self, max_tokens: int):
        self._max_context_tokens = max_tokens
        logger.info(f"Context window set to {max_tokens} tokens")
