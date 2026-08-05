"""ExternalAgentFallback — 三方 Agent 失败回退链（EX-007）。

跨厂商 fallback：claude code → codex → opencode → trae → FlowForge 内置能力。
与 LLMClient 跨厂商 fallback 思路一致。

设计依据：
    - [doc:review/review.md#第九章§9.2] EX-007 三方 Agent 失败回退策略缺失
    - [doc:decisions/006-external-agent-integration.md] §5 调用流程第 7-8 步
    - [doc:design/naming-contract.md#2.12] 能力画像（盲点决定 fallback 顺序）

铁律遵守：
    - 铁律 3：依赖通过构造函数注入（invoke_fn 由调用方传入）
    - 所有 I/O 操作使用 async/await
    - 不修改不相关代码（编程红线 7）

License: MIT
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("external_agent.fallback")


# invoke_fn 类型：(provider_name, task, context) -> dict
InvokeFn = Callable[[str, str, dict[str, Any]], Awaitable[dict[str, Any]]]


class FallbackAttempt(BaseModel):
    """单次 fallback 尝试记录。"""

    provider_name: str = Field(..., description="尝试的 Provider 名称")
    attempt: int = Field(..., description="第几次尝试（从 1 开始）")
    success: bool = Field(..., description="是否成功")
    error: str = Field(default="", description="失败时的错误信息")
    duration_ms: int = Field(default=0, description="本次尝试耗时（毫秒）")
    timestamp: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        description="尝试时间戳",
    )


class FallbackResult(BaseModel):
    """fallback 链执行结果。"""

    success: bool = Field(..., description="最终是否成功")
    winning_provider: str = Field(default="", description="成功的 Provider 名称")
    result: Any = Field(default=None, description="成功时的结果")
    attempts: list[FallbackAttempt] = Field(
        default_factory=list, description="所有尝试记录"
    )
    total_duration_ms: int = Field(default=0, description="总耗时（毫秒）")


class ExternalAgentFallback:
    """三方 Agent 失败回退链（EX-007）。

    跨厂商 fallback：claude code → codex → opencode → trae → FlowForge 内置能力。
    与 LLMClient 跨厂商 fallback 思路一致。

    详见 [doc:review/review.md#第九章§9.2] EX-007

    三层 fallback 设计：
        1. 同厂商重试：按 Manifest.retry_policy 重试（max_attempts / backoff_seconds）
        2. 跨厂商 fallback：按 providers 顺序切换到下一个厂商
        3. 内置能力兜底：全部失败后回退到 FlowForge 内置能力
    """

    # 默认 fallback 链：claude code → codex → opencode → trae → flowforge_internal
    DEFAULT_FALLBACK_CHAIN: list[str] = [
        "anthropic.claude_code",
        "openai.codex",
        "opencode.opencode",
        "bytedance.trae",
        "flowforge.internal",
    ]

    def __init__(self, retry_max_attempts: int = 3, backoff_seconds: float = 5.0) -> None:
        """初始化 fallback 配置。

        Args:
            retry_max_attempts: 同厂商最大重试次数（默认 3）。
            backoff_seconds: 重试退避间隔（秒，默认 5）。
        """
        self._retry_max_attempts = retry_max_attempts
        self._backoff_seconds = backoff_seconds

    async def with_fallback(
        self,
        providers: list[str],
        invoke_fn: InvokeFn,
        task: str,
        context: dict[str, Any],
    ) -> FallbackResult:
        """按 fallback 链尝试调用三方 Agent。

        Args:
            providers: Provider 名称列表（按 fallback 优先级排序）。
            invoke_fn: 调用函数 (provider_name, task, context) -> dict。
                必须是 async 函数，返回的 dict 应包含 success 字段。
            task: 任务描述。
            context: 调用上下文。

        Returns:
            FallbackResult 执行结果（含所有尝试记录）。
        """
        import asyncio
        import time

        start_ts = time.monotonic()
        attempts: list[FallbackAttempt] = []

        for provider_name in providers:
            for attempt_idx in range(1, self._retry_max_attempts + 1):
                attempt_start = time.monotonic()
                try:
                    result = await invoke_fn(provider_name, task, context)
                    duration_ms = int((time.monotonic() - attempt_start) * 1000)
                    success = bool(result.get("success", False))
                    attempt = FallbackAttempt(
                        provider_name=provider_name,
                        attempt=attempt_idx,
                        success=success,
                        duration_ms=duration_ms,
                    )
                    attempts.append(attempt)
                    if success:
                        total_ms = int((time.monotonic() - start_ts) * 1000)
                        logger.info(
                            "fallback.success provider=%s attempt=%d total_attempts=%d",
                            provider_name,
                            attempt_idx,
                            len(attempts),
                        )
                        return FallbackResult(
                            success=True,
                            winning_provider=provider_name,
                            result=result,
                            attempts=attempts,
                            total_duration_ms=total_ms,
                        )
                    logger.warning(
                        "fallback.attempt_failed provider=%s attempt=%d",
                        provider_name,
                        attempt_idx,
                    )
                except Exception as e:
                    duration_ms = int((time.monotonic() - attempt_start) * 1000)
                    attempts.append(
                        FallbackAttempt(
                            provider_name=provider_name,
                            attempt=attempt_idx,
                            success=False,
                            error=str(e),
                            duration_ms=duration_ms,
                        )
                    )
                    logger.warning(
                        "fallback.exception provider=%s attempt=%d error=%s",
                        provider_name,
                        attempt_idx,
                        e,
                    )
                # 退避（最后一次不再退避）
                if attempt_idx < self._retry_max_attempts:
                    await asyncio.sleep(self._backoff_seconds)

        total_ms = int((time.monotonic() - start_ts) * 1000)
        logger.error(
            "fallback.exhausted providers=%s total_attempts=%d",
            providers,
            len(attempts),
        )
        return FallbackResult(
            success=False,
            winning_provider="",
            result=None,
            attempts=attempts,
            total_duration_ms=total_ms,
        )

    def get_default_chain(self) -> list[str]:
        """返回默认 fallback 链。"""
        return list(self.DEFAULT_FALLBACK_CHAIN)
