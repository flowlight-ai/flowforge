"""速率限制中间件 — 从 OpenSieve 提取并通用化.

与 OpenSieve 的 RateLimitMiddleware 保持一致：
- IP 限流（令牌桶算法）
- API Key 限流（基于 AuthMiddleware 注入的 key info）
- 可配置默认 RPM 和突发数
"""

import time
import logging
from typing import Dict, Optional

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger(__name__)


class TokenBucket:
    """令牌桶限流器。"""

    def __init__(self, rate: float, capacity: int):
        """
        Args:
            rate: 每秒补充的令牌数
            capacity: 桶容量（最大突发数）
        """
        self.rate = rate
        self.capacity = capacity
        self.tokens = float(capacity)
        self.last_refill = time.time()

    def consume(self) -> bool:
        """尝试消费一个令牌，成功返回 True。"""
        now = time.time()
        elapsed = now - self.last_refill
        self.tokens = min(self.capacity, self.tokens + elapsed * self.rate)
        self.last_refill = now

        if self.tokens >= 1.0:
            self.tokens -= 1.0
            return True
        return False


class RateLimitMiddleware(BaseHTTPMiddleware):
    """速率限制中间件 — IP + API Key 双重限流。"""

    def __init__(self, app, default_rpm: int = 120, burst: int = 30):
        super().__init__(app)
        self.default_rpm = default_rpm
        self.burst = burst
        self._ip_buckets: Dict[str, TokenBucket] = {}
        self._key_buckets: Dict[str, TokenBucket] = {}

    def _get_ip_bucket(self, ip: str) -> TokenBucket:
        if ip not in self._ip_buckets:
            rate = self.default_rpm / 60.0  # RPM → RPS
            self._ip_buckets[ip] = TokenBucket(rate=rate, capacity=self.burst)
        return self._ip_buckets[ip]

    def _get_key_bucket(self, key_prefix: str, rate_limit: int) -> TokenBucket:
        if key_prefix not in self._key_buckets:
            if rate_limit <= 0:
                # rate_limit=0 表示无限制
                rate = 1000.0  # 极高限流
            else:
                rate = rate_limit / 60.0
            self._key_buckets[key_prefix] = TokenBucket(rate=rate, capacity=max(self.burst, rate_limit))
        return self._key_buckets[key_prefix]

    async def dispatch(self, request: Request, call_next):
        # 公开路径不限流
        path = request.url.path
        if path in ("/health", "/ready", "/docs", "/openapi.json", "/redoc"):
            return await call_next(request)

        # IP 限流
        client_ip = request.client.host if request.client else "unknown"
        ip_bucket = self._get_ip_bucket(client_ip)
        if not ip_bucket.consume():
            logger.warning(f"IP 限流触发: {client_ip}")
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many requests. Please try again later."},
            )

        # API Key 限流（如果已认证）
        key_info = getattr(request.state, "api_key_info", None)
        if key_info:
            key_prefix = key_info.get("prefix", "unknown")
            rate_limit = key_info.get("rate_limit", self.default_rpm)
            key_bucket = self._get_key_bucket(key_prefix, rate_limit)
            if not key_bucket.consume():
                logger.warning(f"API Key 限流触发: {key_prefix}")
                return JSONResponse(
                    status_code=429,
                    content={"detail": "API key rate limit exceeded. Please try again later."},
                )

        return await call_next(request)
