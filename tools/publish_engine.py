"""Publish Engine — content adaptation, staggered publishing, and circuit breaker.

Implements:
1. Content adaptation engine — adapt content format for different platforms
2. Staggered publishing — configurable delay between platforms (5-10 min)
3. Circuit breaker — pause a platform after consecutive failures (reuses FlowForge CircuitBreaker)
4. Content moderation — pre-publish safety check (L5, integrated from FlowForge)
"""
import asyncio
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from flowforge.core.circuit_breaker import CircuitBreaker, CircuitOpenError
from flowforge.core.tracing import get_logger

logger = get_logger("publish_engine")


class ModerationError(Exception):
    """内容审核未通过时抛出的异常."""

    def __init__(self, risk_tags: list[str], reason: str):
        self.risk_tags = risk_tags
        self.reason = reason
        super().__init__(f"内容审核未通过: {reason} (risk_tags={risk_tags})")


# ── Platform content specs ──────────────────────────────────────────

PLATFORM_SPECS: dict[str, dict[str, Any]] = {
    "toutiao": {
        "max_title_length": 30,
        "max_content_length": 20000,
        "supports_images": True,
        "supports_html": False,
        "paragraph_separator": "\n\n",
    },
    "wechat": {
        "max_title_length": 64,
        "max_content_length": 20000,
        "supports_images": True,
        "supports_html": True,
        "paragraph_separator": "\n\n",
    },
    "zhihu": {
        "max_title_length": 100,
        "max_content_length": 50000,
        "supports_images": True,
        "supports_html": True,
        "paragraph_separator": "\n\n",
    },
    "baijiahao": {
        "max_title_length": 30,
        "max_content_length": 20000,
        "supports_images": True,
        "supports_html": False,
        "paragraph_separator": "\n\n",
    },
}


@dataclass
class PublishResult:
    """Result of a single platform publish attempt."""
    platform: str
    success: bool
    url: str = ""
    error: str = ""
    adapted_title: str = ""
    adapted_content_length: int = 0
    published_at: str = field(default_factory=lambda: datetime.now(UTC).isoformat())


class ContentAdapter:
    """Adapt content format for different publishing platforms."""

    def adapt(self, title: str, content: str, platform: str) -> tuple[str, str]:
        """Adapt title and content for a specific platform.

        Returns:
            (adapted_title, adapted_content)
        """
        spec = PLATFORM_SPECS.get(platform, PLATFORM_SPECS["toutiao"])

        adapted_title = self._adapt_title(title, spec)
        adapted_content = self._adapt_content(content, spec)

        return adapted_title, adapted_content

    def _adapt_title(self, title: str, spec: dict) -> str:
        max_len = spec.get("max_title_length", 64)
        if len(title) <= max_len:
            return title
        # Truncate and add ellipsis
        return title[: max_len - 1] + "…"

    def _adapt_content(self, content: str, spec: dict) -> str:
        max_len = spec.get("max_content_length", 20000)
        supports_html = spec.get("supports_html", False)
        separator = spec.get("paragraph_separator", "\n\n")

        # Strip HTML if platform doesn't support it
        if not supports_html:
            content = self._strip_html(content)

        # Normalize paragraph separators
        content = re.sub(r'\n{3,}', separator, content)

        # Truncate if needed
        if len(content) > max_len:
            content = content[: max_len - 3] + "..."
            logger.info(f"Content truncated to {max_len} chars for platform")

        return content

    @staticmethod
    def _strip_html(text: str) -> str:
        """Remove HTML tags from text."""
        clean = re.sub(r'<[^>]+>', '', text)
        # Decode common HTML entities
        clean = clean.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
        clean = clean.replace('&quot;', '"').replace('&#39;', "'")
        clean = clean.replace('&nbsp;', ' ')
        return clean


class StaggeredPublisher:
    """Staggered publishing with configurable delay between platforms.

    Publishes to platforms sequentially with a delay (default 5-10 min)
    between each to avoid triggering rate limits or appearing spammy.
    """

    def __init__(
        self,
        min_delay_seconds: int = 300,
        max_delay_seconds: int = 600,
    ):
        self._min_delay = min_delay_seconds
        self._max_delay = max_delay_seconds

    def _get_delay(self, index: int) -> int:
        """Calculate stagger delay for platform at given index.

        First platform publishes immediately (index=0).
        Subsequent platforms get increasing delays.
        """
        if index == 0:
            return 0
        # Linear interpolation between min and max delay
        # For 3 platforms: delays are 0, min_delay, max_delay
        if index <= 1:
            return self._min_delay
        return self._max_delay

    async def publish_staggered(
        self,
        platforms: list[str],
        publish_fn: Callable[[str], PublishResult],
    ) -> list[PublishResult]:
        """Publish to platforms with staggered delays.

        Args:
            platforms: Ordered list of platform names.
            publish_fn: Async callable that takes platform name and returns PublishResult.

        Returns:
            List of PublishResult for each platform.
        """
        results: list[PublishResult] = []

        for i, platform in enumerate(platforms):
            delay = self._get_delay(i)
            if delay > 0:
                logger.info(
                    f"Staggered publish: waiting {delay}s before publishing to {platform}"
                )
                await asyncio.sleep(delay)

            try:
                result = await publish_fn(platform)
                results.append(result)
            except Exception as e:
                logger.error(f"Publish to {platform} failed: {e}", exc_info=True)
                results.append(PublishResult(
                    platform=platform,
                    success=False,
                    error=str(e),
                ))

        return results


class PlatformCircuitBreaker:
    """Per-platform circuit breaker for publishing.

    Wraps FlowForge's CircuitBreaker with platform-specific configuration.
    After 3 consecutive failures, the circuit opens and further publish
    attempts are rejected fast until the recovery timeout elapses.
    """

    def __init__(
        self,
        failure_threshold: int = 3,
        recovery_timeout: float = 300.0,
    ):
        self._failure_threshold = failure_threshold
        self._recovery_timeout = recovery_timeout
        self._breakers: dict[str, CircuitBreaker] = {}

    def _get_breaker(self, platform: str) -> CircuitBreaker:
        if platform not in self._breakers:
            self._breakers[platform] = CircuitBreaker(
                name=f"publish_{platform}",
                failure_threshold=self._failure_threshold,
                recovery_timeout=self._recovery_timeout,
            )
        return self._breakers[platform]

    def is_available(self, platform: str) -> bool:
        """Check if a platform is available for publishing."""
        return self._get_breaker(platform).is_available

    async def call(self, platform: str, func: Callable) -> Any:
        """Execute a publish function through the circuit breaker.

        Args:
            platform: Platform name.
            func: Async callable to execute.

        Returns:
            Result of the function.

        Raises:
            CircuitOpenError: If the circuit breaker is open.
        """
        breaker = self._get_breaker(platform)
        return await breaker.call(func)

    def get_stats(self, platform: str) -> dict[str, Any]:
        """Get circuit breaker stats for a platform."""
        if platform in self._breakers:
            return self._breakers[platform].get_stats()
        return {"name": f"publish_{platform}", "state": "not_created"}

    def reset(self, platform: str) -> None:
        """Reset circuit breaker for a specific platform."""
        if platform in self._breakers:
            self._breakers[platform].reset()


class PublishEngine:
    """Main publish engine — orchestrates adaptation, staggering, circuit breaking, and moderation.

    Usage:
        engine = PublishEngine()
        results = await engine.publish(
            title="My Article",
            content="Article body...",
            platforms=["toutiao", "wechat", "zhihu"],
            publish_fn=my_publish_function,
        )
    """

    def __init__(self, config: dict | None = None):
        self._config = config or {}
        self._adapter = ContentAdapter()
        self._staggered = StaggeredPublisher(
            min_delay_seconds=self._config.get("stagger_min_delay", 300),
            max_delay_seconds=self._config.get("stagger_max_delay", 600),
        )
        self._circuit_breaker = PlatformCircuitBreaker(
            failure_threshold=self._config.get("circuit_failure_threshold", 3),
            recovery_timeout=self._config.get("circuit_recovery_timeout", 300.0),
        )
        self._moderation_enabled = self._config.get("moderation_enabled", True)
        self._moderation_checker = None  # 延迟初始化，避免强制依赖

    def set_moderation_checker(self, checker):
        """设置内容审核检查器（ContentModerationChecker 实例）.

        可在运行时动态注入，不影响已有代码。
        """
        self._moderation_checker = checker
        logger.info("ContentModerationChecker已注入到PublishEngine")

    async def _check_moderation(self, title: str, content: str) -> None:
        """执行发布前内容审核.

        审核未通过时抛出 ModerationError。
        审核结果会记录到日志用于审计追踪。
        """
        if not self._moderation_enabled:
            logger.info("内容审核已禁用，跳过审核检查")
            return

        if self._moderation_checker is None:
            # 延迟导入，避免强制依赖
            try:
                from flowforge.security.moderation import ContentModerationChecker
                self._moderation_checker = ContentModerationChecker()
            except ImportError:
                logger.warning("ContentModerationChecker不可用，跳过内容审核")
                return

        # 对标题和内容都进行审核
        full_text = f"{title}\n\n{content}"
        result = await self._moderation_checker.check(full_text)

        # 审计日志
        logger.info(
            f"内容审核结果: safe={result.safe}, "
            f"risk_tags={result.risk_tags}, "
            f"reason={result.reason}, "
            f"confidence={result.confidence}, "
            f"内容预览={full_text[:100]}"
        )

        if not result.safe:
            raise ModerationError(
                risk_tags=result.risk_tags,
                reason=result.reason,
            )

    async def publish(
        self,
        title: str,
        content: str,
        platforms: list[str],
        publish_fn: Callable[[str, str, str], PublishResult],
    ) -> list[PublishResult]:
        """Publish content to multiple platforms with adaptation, staggering, and circuit breaking.

        Args:
            title: Article title.
            content: Article content.
            platforms: List of platform names to publish to.
            publish_fn: Async callable(platform, adapted_title, adapted_content) -> PublishResult.

        Returns:
            List of PublishResult for each platform.

        Raises:
            ModerationError: If content moderation check fails (when enabled).
        """
        # 发布前内容审核
        await self._check_moderation(title, content)

        # Filter out platforms with open circuits
        available_platforms = []
        for p in platforms:
            if self._circuit_breaker.is_available(p):
                available_platforms.append(p)
            else:
                logger.warning(f"Platform {p} circuit breaker is open, skipping")

        if len(available_platforms) < len(platforms):
            skipped = set(platforms) - set(available_platforms)
            logger.warning(f"Skipped platforms due to open circuit: {skipped}")

        async def _adapt_and_publish(platform: str) -> PublishResult:
            adapted_title, adapted_content = self._adapter.adapt(title, content, platform)
            try:
                result = await self._circuit_breaker.call(
                    platform,
                    lambda: publish_fn(platform, adapted_title, adapted_content),
                )
                return result
            except CircuitOpenError:
                return PublishResult(
                    platform=platform,
                    success=False,
                    error=f"Circuit breaker open for {platform}",
                )
            except Exception as e:
                logger.error(f"Publish to {platform} failed: {e}", exc_info=True)
                return PublishResult(
                    platform=platform,
                    success=False,
                    error=str(e),
                    adapted_title=adapted_title,
                    adapted_content_length=len(adapted_content),
                )

        results = await self._staggered.publish_staggered(
            available_platforms, _adapt_and_publish
        )

        # Add skipped platforms as failed results
        for p in platforms:
            if p not in available_platforms:
                results.append(PublishResult(
                    platform=p,
                    success=False,
                    error="Circuit breaker open — platform skipped",
                ))

        return results

    def get_circuit_stats(self, platform: str) -> dict[str, Any]:
        """Get circuit breaker statistics for a platform."""
        return self._circuit_breaker.get_stats(platform)

    def reset_circuit(self, platform: str) -> None:
        """Manually reset circuit breaker for a platform."""
        self._circuit_breaker.reset(platform)
