"""PingPongCircuitBreaker — trip when an owner fails to make progress.

The ping-pong failure mode (roleagent.md Ch.2, RA-012): two agents pass the
ball back and forth without producing anything. The breaker does not count
passes; it counts consecutive failures per owner — a failure is "I had the
ball but produced no usable evidence". Once an owner's consecutive-failure
count crosses the threshold the breaker trips and the loop escalates to the
operator.

On any success the owner's failure counter resets to zero.
"""

from __future__ import annotations

from flowforge.core.errors import TeamActError
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.teamact.circuit_breaker")

DEFAULT_THRESHOLD: int = 3


class PingPongCircuitBreaker:
    """Track consecutive failures per owner and trip past a threshold.

    The breaker is per-owner (not per-team) so a single struggling owner can
    be isolated without penalising the rest of the team.
    """

    def __init__(self, threshold: int = DEFAULT_THRESHOLD) -> None:
        if threshold < 1:
            raise TeamActError(
                f"circuit breaker threshold must be >= 1, got {threshold}"
            )
        self.threshold = threshold
        self._failures: dict[str, int] = {}

    def record_failure(self, owner: str) -> None:
        if not owner.strip():
            raise TeamActError("owner must not be empty when recording a failure")
        count = self._failures.get(owner, 0) + 1
        self._failures[owner] = count
        logger.info(
            f"circuit_breaker: failure owner={owner!r} "
            f"consecutive={count}/{self.threshold}"
        )

    def record_success(self, owner: str) -> None:
        if not owner.strip():
            raise TeamActError("owner must not be empty when recording a success")
        if self._failures.get(owner, 0) > 0:
            logger.info(f"circuit_breaker: reset owner={owner!r} after success")
        self._failures[owner] = 0

    def is_tripped(self, owner: str) -> bool:
        return self._failures.get(owner, 0) >= self.threshold

    def reset(self, owner: str) -> None:
        self._failures.pop(owner, None)
        logger.info(f"circuit_breaker: reset owner={owner!r}")

    def failure_count(self, owner: str) -> int:
        """Inspect the current consecutive-failure count (for tests/dashboards)."""
        return self._failures.get(owner, 0)
