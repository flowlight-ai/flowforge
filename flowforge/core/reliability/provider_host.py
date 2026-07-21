"""Provider Host — cross-provider hosting abstraction with priority routing.

Distributed reliability primitive (task.md P1-6, F025). The harness must
not be wedded to a single LLM provider (or any single external service).
``ProviderHost`` tracks a pool of providers, each with a priority and a
health flag. ``select_provider`` returns the highest-priority *healthy*
provider, skipping unhealthy ones and an optional exclusion list (so a
failed provider is not re-selected during failover).

This module deliberately does NOT import ``flowforge.llm.provider`` —
"provider" here means any addressable host (LLM vendor, search backend,
publish channel). Keeping the boundary clean lets the reliability layer
be reused outside the LLM subsystem.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from flowforge.core.errors import ReliabilityError
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.reliability.provider_host")

__all__ = ["ProviderInfo", "ProviderHost"]


@dataclass
class ProviderInfo:
    """Public view of one registered provider.

    ``priority`` — lower number = higher preference (1 beats 2).
    ``healthy``  — False when mark_unhealthy has been called and not yet
                   restored; healthy providers are the only ones eligible
                   for selection.
    ``last_state_change`` — when health last flipped (for dashboards/SLA).
    """

    name: str
    priority: int
    healthy: bool
    last_state_change: datetime


@dataclass
class _ProviderRecord:
    """Mutable internal record (health flips in place)."""

    name: str
    priority: int
    healthy: bool
    last_state_change: datetime


class ProviderHost:
    """Priority-ordered pool of addressable providers with health tracking.

    Selection rule: among providers that are healthy AND not in ``exclude``
    AND not already failed-over-from, return the one with the smallest
    priority number. Returns None if no provider is eligible.
    """

    def __init__(self) -> None:
        self._providers: dict[str, _ProviderRecord] = {}

    def register_provider(
        self,
        name: str,
        priority: int,
        healthy: bool = True,
    ) -> None:
        if not name:
            raise ReliabilityError("provider name must be non-empty")
        if name in self._providers:
            raise ReliabilityError(f"provider {name!r} already registered")
        now = datetime.now(timezone.utc)
        self._providers[name] = _ProviderRecord(
            name=name,
            priority=priority,
            healthy=healthy,
            last_state_change=now,
        )
        logger.info(
            f"reliability: register_provider name={name!r} "
            f"priority={priority} healthy={healthy}"
        )

    def mark_unhealthy(self, name: str) -> None:
        record = self._providers.get(name)
        if record is None:
            raise ReliabilityError(f"provider {name!r} not found")
        if record.healthy:
            record.healthy = False
            record.last_state_change = datetime.now(timezone.utc)
            logger.warning(
                f"reliability: mark_unhealthy name={name!r}"
            )

    def mark_healthy(self, name: str) -> None:
        record = self._providers.get(name)
        if record is None:
            raise ReliabilityError(f"provider {name!r} not found")
        if not record.healthy:
            record.healthy = True
            record.last_state_change = datetime.now(timezone.utc)
            logger.info(
                f"reliability: mark_healthy name={name!r}"
            )

    def select_provider(self, exclude: list[str] | None = None) -> str | None:
        """Return the highest-priority healthy provider not in ``exclude``.

        Returns None when every provider is either unhealthy or excluded.
        Ties on priority are broken by registration order (dict insertion
        order is preserved in Python 3.7+).
        """
        excluded = set(exclude or [])
        candidates = [
            r for r in self._providers.values()
            if r.healthy and r.name not in excluded
        ]
        if not candidates:
            logger.warning(
                f"reliability: select_provider no healthy candidate "
                f"exclude={sorted(excluded)}"
            )
            return None
        candidates.sort(key=lambda r: r.priority)
        selected = candidates[0].name
        logger.info(
            f"reliability: select_provider -> {selected!r} "
            f"priority={candidates[0].priority}"
        )
        return selected

    def list_providers(self) -> list[ProviderInfo]:
        """Return a snapshot of all providers (registration order)."""
        return [
            ProviderInfo(
                name=r.name,
                priority=r.priority,
                healthy=r.healthy,
                last_state_change=r.last_state_change,
            )
            for r in self._providers.values()
        ]

    def is_healthy(self, name: str) -> bool:
        record = self._providers.get(name)
        if record is None:
            raise ReliabilityError(f"provider {name!r} not found")
        return record.healthy

    def count(self) -> int:
        return len(self._providers)
