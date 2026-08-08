"""StepLimiter — Agent 步数限制与上下文压缩.

对标 OpenCode 的 max-steps 机制和 Claude Code 的 Context Compaction。
防止 Agent 无限循环，并在接近上下文窗口时自动压缩。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.step_limiter")


@dataclass
class StepLimitConfig:
    """步数限制配置."""

    max_steps: int = 25  # 最大步数（对标 OpenCode 的默认值）
    warn_at: int = 20  # 警告阈值
    compact_at: int = 22  # 开始压缩的阈值
    max_retries: int = 3  # 最大重试次数
    max_output_tokens_schedule: list[int] = field(
        default_factory=lambda: [4096, 8192, 16384]
    )


class StepLimiter:
    """Agent 步数限制器.

    防止 Agent 无限循环，提供步数警告和上下文压缩触发机制。
    用法::

        limiter = StepLimiter()
        for step in workflow:
            current = limiter.increment()
            if limiter.is_exceeded:
                break
            prompt_suffix = limiter.get_step_prompt_suffix()
            # 将 prompt_suffix 附加到 LLM 提示中
    """

    def __init__(self, config: Optional[StepLimitConfig] = None):
        self.config = config or StepLimitConfig()
        self._current_step = 0
        self._retry_count = 0

    def increment(self) -> int:
        """递增步数计数器，返回当前步数."""
        self._current_step += 1
        if self.should_warn and not self.is_exceeded:
            remaining = self.config.max_steps - self._current_step
            logger.warning(
                f"Step limit warning: {self._current_step}/{self.config.max_steps} "
                f"steps used, {remaining} remaining"
            )
        if self.is_exceeded:
            logger.error(
                f"Step limit exceeded: {self._current_step}/{self.config.max_steps}"
            )
        return self._current_step

    @property
    def current_step(self) -> int:
        """当前步数."""
        return self._current_step

    @property
    def is_exceeded(self) -> bool:
        """是否已超过最大步数."""
        return self._current_step >= self.config.max_steps

    @property
    def should_warn(self) -> bool:
        """是否应该发出警告."""
        return self._current_step >= self.config.warn_at

    @property
    def should_compact(self) -> bool:
        """是否应该压缩上下文."""
        return self._current_step >= self.config.compact_at

    @property
    def tools_disabled(self) -> bool:
        """是否应该禁用工具（步数耗尽时）."""
        return self.is_exceeded

    @property
    def remaining_steps(self) -> int:
        """剩余步数."""
        return max(0, self.config.max_steps - self._current_step)

    def get_max_output_tokens(self) -> int:
        """获取当前重试级别的最大输出 token 数."""
        idx = min(self._retry_count, len(self.config.max_output_tokens_schedule) - 1)
        return self.config.max_output_tokens_schedule[idx]

    def get_step_prompt_suffix(self) -> str:
        """获取步数相关的提示后缀（对标 OpenCode 的 MAX_STEPS_PROMPT）.

        当步数耗尽时，强制 Agent 给出最终答案；
        当步数接近上限时，提醒 Agent 优先完成任务。
        """
        if self.is_exceeded:
            return (
                f"\n\n[STEP LIMIT] You have reached the maximum of {self.config.max_steps} steps. "
                f"You MUST NOT use any tools. Instead, provide your final answer now."
            )
        if self.should_warn:
            remaining = self.config.max_steps - self._current_step
            return (
                f"\n\n[STEP WARNING] You have used {self._current_step}/{self.config.max_steps} steps. "
                f"Only {remaining} steps remaining. Prioritize completing your task."
            )
        return ""

    def increment_retry(self) -> int:
        """递增重试计数器，返回当前重试次数."""
        self._retry_count += 1
        if self._retry_count > self.config.max_retries:
            logger.error(
                f"Max retries exceeded: {self._retry_count}/{self.config.max_retries}"
            )
        return self._retry_count

    @property
    def retries_exceeded(self) -> bool:
        """是否已超过最大重试次数."""
        return self._retry_count > self.config.max_retries

    def reset(self) -> None:
        """重置步数计数器和重试计数器."""
        self._current_step = 0
        self._retry_count = 0

    def reset_step(self) -> None:
        """仅重置步数计数器（保留重试计数）."""
        self._current_step = 0

    def to_dict(self) -> dict:
        """导出当前状态为字典（用于序列化/调试）."""
        return {
            "current_step": self._current_step,
            "max_steps": self.config.max_steps,
            "remaining_steps": self.remaining_steps,
            "is_exceeded": self.is_exceeded,
            "should_warn": self.should_warn,
            "should_compact": self.should_compact,
            "tools_disabled": self.tools_disabled,
            "retry_count": self._retry_count,
            "retries_exceeded": self.retries_exceeded,
            "max_output_tokens": self.get_max_output_tokens(),
        }
