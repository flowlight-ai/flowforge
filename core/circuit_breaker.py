from __future__ import annotations

import time
from enum import Enum
from typing import Any, Callable


class CircuitState(Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


class CircuitOpenError(Exception):
    pass


# 全局熔断器注册表
_breakers: dict[str, CircuitBreaker] = {}


class CircuitBreaker:
    def __init__(
        self,
        name: str,
        failure_threshold: int = 5,
        recovery_timeout: float = 60.0,
        half_open_max_calls: int = 3,
    ) -> None:
        self.name = name
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.half_open_max_calls = half_open_max_calls
        self._state = CircuitState.CLOSED
        self._failure_count = 0
        self._success_count = 0
        self._last_failure_time: float = 0.0
        self._half_open_calls: int = 0
        self._total_calls: int = 0
        self._total_failures: int = 0
        self._total_successes: int = 0

    @property
    def state(self) -> CircuitState:
        if self._state == CircuitState.OPEN:
            if time.monotonic() - self._last_failure_time >= self.recovery_timeout:
                self._state = CircuitState.HALF_OPEN
                self._half_open_calls = 0
        return self._state

    @property
    def is_available(self) -> bool:
        state = self.state
        if state == CircuitState.CLOSED:
            return True
        if state == CircuitState.HALF_OPEN:
            return self._half_open_calls < self.half_open_max_calls
        return False

    def can_execute(self) -> bool:
        """检查是否可以执行请求。"""
        return self.is_available

    def record_success(self) -> None:
        """记录一次成功调用。"""
        self._success_count += 1
        self._total_successes += 1
        self._total_calls += 1
        if self._state == CircuitState.HALF_OPEN:
            self._state = CircuitState.CLOSED
            self._failure_count = 0
        else:
            self._failure_count = 0

    def record_failure(self) -> None:
        """记录一次失败调用。"""
        self._failure_count += 1
        self._total_failures += 1
        self._total_calls += 1
        self._last_failure_time = time.monotonic()
        if self._failure_count >= self.failure_threshold:
            self._state = CircuitState.OPEN

    def record_half_open_call(self) -> None:
        self._half_open_calls += 1

    def get_state(self) -> CircuitState:
        """获取当前熔断器状态。"""
        return self.state

    def reset(self) -> None:
        """重置熔断器为关闭状态。"""
        self._state = CircuitState.CLOSED
        self._failure_count = 0
        self._success_count = 0
        self._half_open_calls = 0

    def get_stats(self) -> dict[str, Any]:
        """返回熔断器统计信息。"""
        return {
            "name": self.name,
            "state": self.state.value,
            "failure_count": self._failure_count,
            "success_count": self._success_count,
            "failure_threshold": self.failure_threshold,
            "recovery_timeout": self.recovery_timeout,
            "half_open_max_calls": self.half_open_max_calls,
            "half_open_calls": self._half_open_calls,
            "last_failure_time": self._last_failure_time,
            "total_calls": self._total_calls,
            "total_failures": self._total_failures,
            "total_successes": self._total_successes,
        }

    async def call(self, func: Callable, *args: Any, **kwargs: Any) -> Any:
        if not self.is_available:
            raise CircuitOpenError(f"Circuit '{self.name}' is open")
        if self.state == CircuitState.HALF_OPEN:
            self.record_half_open_call()
        try:
            result = await func(*args, **kwargs)
            self.record_success()
            return result
        except Exception as e:
            self.record_failure()
            raise


def get_circuit_breaker(
    name: str,
    failure_threshold: int = 5,
    recovery_timeout: float = 60.0,
    half_open_max_calls: int = 3,
) -> CircuitBreaker:
    """获取或创建命名熔断器。如果已存在则返回已有实例，否则创建新的。"""
    if name not in _breakers:
        _breakers[name] = CircuitBreaker(
            name=name,
            failure_threshold=failure_threshold,
            recovery_timeout=recovery_timeout,
            half_open_max_calls=half_open_max_calls,
        )
    return _breakers[name]


def reset_all() -> None:
    """重置所有已注册的熔断器。"""
    for breaker in _breakers.values():
        breaker.reset()
