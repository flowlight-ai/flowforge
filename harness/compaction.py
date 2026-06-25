"""DualThresholdCompactor — 双阈值上下文压缩器

设计文档参考：
- S3.0-21: INF-05 DualThresholdCompactor死循环防护
- S3.0-31: Compaction中文摘要模型指定
- FR-HRN-06: 会话管理器92%阈值触发上下文压缩
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple

from pydantic import BaseModel

logger = logging.getLogger(__name__)


class CompactionStrategy(str, Enum):
    LLM_SUMMARY = "llm_summary"
    EXTRACTIVE = "extractive"
    DROP_OLDEST = "drop_oldest"
    TRUNCATE = "truncate"


class CompactionResult(BaseModel):
    original_tokens: int = 0
    compressed_tokens: int = 0
    compression_ratio: float = 1.0
    strategy_used: CompactionStrategy = CompactionStrategy.TRUNCATE
    messages_preserved: int = 0
    messages_compacted: int = 0
    quality_score: Optional[float] = None
    latency_ms: float = 0.0


@dataclass
class CompactionConfig:
    token_threshold: float = 0.92
    quality_threshold: float = 0.7
    max_compaction_attempts: int = 3
    preserved_rounds: int = 3
    max_tool_output_tokens: int = 25000
    summary_model: str = "doubao-seed2"
    safe_threshold: float = 0.70


class DualThresholdCompactor:
    """双阈值上下文压缩器

    双阈值：token阈值(92%) + 质量阈值(0.7)
    三档回退：LLM摘要 → 抽取式摘要 → 丢弃最旧消息
    死循环防护：最大3次/Session
    """

    def __init__(self, config: Optional[CompactionConfig] = None):
        self.config = config or CompactionConfig()
        self._compaction_count: Dict[str, int] = {}

    def should_compact(self, current_tokens: int, model_context_window: int, session_id: str = "") -> bool:
        utilization = current_tokens / model_context_window if model_context_window > 0 else 0
        if utilization >= self.config.token_threshold:
            count = self._compaction_count.get(session_id, 0)
            if count >= self.config.max_compaction_attempts:
                logger.warning(f"Session {session_id}: compaction attempts ({count}) exceeded max, forcing drop_oldest")
            return True
        return False

    async def compact(
        self, messages: List[Dict[str, Any]], current_tokens: int,
        model_context_window: int, session_id: str = "", llm_client: Any = None,
    ) -> Tuple[List[Dict[str, Any]], CompactionResult]:
        start_time = time.time()
        session_id = session_id or "default"
        self._compaction_count[session_id] = self._compaction_count.get(session_id, 0) + 1
        attempt = self._compaction_count[session_id]

        preserved, to_compact = self._split_messages(messages)
        if not to_compact:
            result = CompactionResult(
                original_tokens=current_tokens, compressed_tokens=current_tokens,
                compression_ratio=1.0, strategy_used=CompactionStrategy.TRUNCATE,
                messages_preserved=len(preserved), messages_compacted=0,
                latency_ms=(time.time() - start_time) * 1000,
            )
            return messages, result

        compacted, result = await self._compact_with_fallback(
            to_compact, current_tokens, model_context_window, session_id, attempt, llm_client
        )

        final_messages = compacted + preserved
        final_tokens = self._estimate_tokens(final_messages)
        safe_tokens = int(model_context_window * self.config.safe_threshold)
        if final_tokens > safe_tokens:
            final_messages = self._force_truncate(final_messages, safe_tokens)
            final_tokens = self._estimate_tokens(final_messages)
            result.strategy_used = CompactionStrategy.TRUNCATE

        result.original_tokens = current_tokens
        result.compressed_tokens = final_tokens
        result.compression_ratio = final_tokens / current_tokens if current_tokens > 0 else 1.0
        result.messages_preserved = len(preserved)
        result.messages_compacted = len(to_compact)
        result.latency_ms = (time.time() - start_time) * 1000

        logger.info(f"Session {session_id}: compacted {current_tokens} -> {final_tokens} tokens (ratio={result.compression_ratio:.2f}, strategy={result.strategy_used})")
        return final_messages, result

    def _split_messages(self, messages: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        """分割消息为 (preserved_recent, to_compact_older)

        - preserved: 最近的N轮消息，保持原样
        - to_compact: 较旧的消息，需要压缩
        - 当消息总数不足时，全部保留，不压缩
        """
        preserve_count = self.config.preserved_rounds * 2
        if len(messages) <= preserve_count:
            return messages, []
        split_point = len(messages) - preserve_count
        return messages[split_point:], messages[:split_point]

    async def _compact_with_fallback(
        self, messages: List[Dict[str, Any]], current_tokens: int,
        model_context_window: int, session_id: str, attempt: int, llm_client: Any = None,
    ) -> Tuple[List[Dict[str, Any]], CompactionResult]:
        # 第一档：LLM摘要
        if llm_client and attempt <= 1:
            try:
                compacted, result = await self._llm_summary_compact(messages, llm_client)
                if result.quality_score is None or result.quality_score >= self.config.quality_threshold:
                    return compacted, result
            except Exception as e:
                logger.warning(f"Session {session_id}: LLM summary failed: {e}")

        # 第二档：抽取式摘要
        if attempt <= 2:
            return self._extractive_compact(messages)

        # 第三档：丢弃最旧消息
        return self._drop_oldest_compact(messages, current_tokens, model_context_window)

    async def _llm_summary_compact(self, messages: List[Dict[str, Any]], llm_client: Any) -> Tuple[List[Dict[str, Any]], CompactionResult]:
        conversation_text = self._messages_to_text(messages)
        summary_prompt = (
            "请对以下对话历史进行简洁的中文摘要，保留关键决策、结论和上下文信息。"
            "摘要应该足够详细以便后续对话可以无缝继续。\n\n"
            f"对话历史：\n{conversation_text}"
        )
        try:
            response = await llm_client.chat(
                model=self.config.summary_model,
                messages=[{"role": "user", "content": summary_prompt}],
                max_tokens=2000,
            )
            summary_text = response.content if hasattr(response, 'content') else str(response)
        except Exception:
            summary_text = conversation_text[:2000]

        compacted = [{"role": "system", "content": f"[上下文摘要] {summary_text}"}]
        original_len = len(conversation_text)
        summary_len = len(summary_text)
        quality_score = min(1.0, summary_len / max(original_len * 0.1, 1))

        return compacted, CompactionResult(
            strategy_used=CompactionStrategy.LLM_SUMMARY,
            messages_compacted=len(messages), quality_score=quality_score,
        )

    def _extractive_compact(self, messages: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], CompactionResult]:
        key_points = []
        for msg in messages:
            content = msg.get("content", "")
            role = msg.get("role", "")
            if role == "system":
                key_points.append(msg)
            elif role == "assistant" and content:
                truncated = content[:200] + ("..." if len(content) > 200 else "")
                key_points.append({"role": role, "content": truncated})
            elif role == "tool" and content:
                truncated = content[:500] + ("..." if len(content) > 500 else "")
                key_points.append({"role": role, "content": truncated})
            elif content:
                key_points.append({"role": role, "content": content[:300]})

        return key_points, CompactionResult(
            strategy_used=CompactionStrategy.EXTRACTIVE, messages_compacted=len(messages),
        )

    def _drop_oldest_compact(self, messages: List[Dict[str, Any]], current_tokens: int, model_context_window: int) -> Tuple[List[Dict[str, Any]], CompactionResult]:
        system_msgs = [m for m in messages if m.get("role") == "system"]
        non_system = [m for m in messages if m.get("role") != "system"]
        target_tokens = int(model_context_window * self.config.safe_threshold)
        drop_ratio = 1 - (target_tokens / current_tokens) if current_tokens > 0 else 0.5
        drop_count = max(1, int(len(non_system) * drop_ratio))
        kept = non_system[drop_count:]
        return system_msgs + kept, CompactionResult(
            strategy_used=CompactionStrategy.DROP_OLDEST,
            messages_preserved=len(kept), messages_compacted=drop_count,
        )

    def _force_truncate(self, messages: List[Dict[str, Any]], max_tokens: int) -> List[Dict[str, Any]]:
        result = []
        estimated = 0
        for msg in messages:
            content = msg.get("content", "")
            msg_tokens = len(content) // 4
            if estimated + msg_tokens <= max_tokens:
                result.append(msg)
                estimated += msg_tokens
            else:
                remaining = max_tokens - estimated
                if remaining > 100:
                    truncated_content = content[:remaining * 4] + "..."
                    result.append({**msg, "content": truncated_content})
                break
        return result

    def _messages_to_text(self, messages: List[Dict[str, Any]]) -> str:
        return "\n".join(f"[{m.get('role', 'unknown')}]: {m.get('content', '')}" for m in messages)

    def _estimate_tokens(self, messages: List[Dict[str, Any]]) -> int:
        return sum(len(m.get("content", "")) // 4 for m in messages)

    def reset_session(self, session_id: str) -> None:
        self._compaction_count.pop(session_id, None)
