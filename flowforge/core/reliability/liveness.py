"""Liveness Spec & Probe — read-model for "is this capability alive?".

Distributed reliability primitive (task.md P1-6, F023). Any agent can
declare a liveness spec (name + SLA + which capabilities depend on it)
and register an async check function. ``LivenessProbe.run_all`` is the
read model the orchestrator consults before routing work: if a spec is
unhealthy, capabilities in its ``required_for`` list are degraded.

A probe is a *read* — it never mutates state, it only reports. Recovery
decisions are made by ``TierRecoveryService`` based on the probe results.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Awaitable, Callable

from flowforge.core.errors import ReliabilityError
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.reliability.liveness")

__all__ = ["ProbeResult", "LivenessSpec", "LivenessProbe"]

# An async check function returns True (healthy) or False (unhealthy).
# It may raise; the probe captures the exception into ProbeResult.error.
ProbeCheckFn = Callable[[], Awaitable[bool]]


@dataclass
class ProbeResult:
    """Outcome of one liveness check.

    ``error`` is the stringified exception if the check raised, else None.
    """

    name: str
    healthy: bool
    latency_ms: float
    last_checked: datetime
    error: str | None = None


@dataclass
class LivenessSpec:
    """Declarative spec for one liveness probe.

    ``required_for`` lists capability names that depend on this probe —
    if the probe is unhealthy, those capabilities are considered degraded.
    """

    name: str
    description: str = ""
    sla_seconds: float = 5.0
    required_for: list[str] = field(default_factory=list)


@dataclass
class _RegisteredProbe:
    """Internal record binding a spec to its check function."""

    spec: LivenessSpec
    check_fn: ProbeCheckFn


class LivenessProbe:
    """Registry + runner for async liveness checks.

    Probes are isolated: one probe raising does not prevent the others
    from running. Each result carries its own latency and error so the
    caller can correlate slow probes with degraded capabilities.
    """

    def __init__(self) -> None:
        self._probes: dict[str, _RegisteredProbe] = {}

    def register_probe(
        self,
        name: str,
        check_fn: ProbeCheckFn,
        spec: LivenessSpec | None = None,
    ) -> None:
        """Register an async check under ``name``.

        If ``spec`` is omitted a default spec is synthesized from ``name``
        so callers can register a probe without declaring SLA metadata.
        """
        if not name:
            raise ReliabilityError("probe name must be non-empty")
        if name in self._probes:
            raise ReliabilityError(f"probe {name!r} already registered")
        effective_spec = spec or LivenessSpec(name=name)
        self._probes[name] = _RegisteredProbe(spec=effective_spec, check_fn=check_fn)
        logger.info(
            f"reliability: register_probe name={name!r} "
            f"sla={effective_spec.sla_seconds}s"
        )

    def register_spec(self, spec: LivenessSpec, check_fn: ProbeCheckFn) -> None:
        """Register a probe with a fully-declared LivenessSpec."""
        self.register_probe(spec.name, check_fn, spec=spec)

    def list_specs(self) -> list[LivenessSpec]:
        return [p.spec for p in self._probes.values()]

    def get_spec(self, name: str) -> LivenessSpec:
        probe = self._probes.get(name)
        if probe is None:
            raise ReliabilityError(f"probe {name!r} not found")
        return probe.spec

    async def run_probe(self, name: str) -> ProbeResult:
        """Execute one probe by name and return its result."""
        probe = self._probes.get(name)
        if probe is None:
            raise ReliabilityError(f"probe {name!r} not found")
        return await self._run_one(name, probe.check_fn)

    async def run_all(self) -> list[ProbeResult]:
        """Execute every registered probe and return results (registration order)."""
        results: list[ProbeResult] = []
        for name, probe in self._probes.items():
            results.append(await self._run_one(name, probe.check_fn))
        return results

    async def _run_one(self, name: str, check_fn: ProbeCheckFn) -> ProbeResult:
        start = time.perf_counter()
        error: str | None = None
        healthy = False
        try:
            healthy = await check_fn()
        except Exception as exc:  # noqa: BLE001
            error = str(exc)
            logger.warning(
                f"reliability: probe name={name!r} raised error={exc!r}"
            )
        latency_ms = (time.perf_counter() - start) * 1000.0
        result = ProbeResult(
            name=name,
            healthy=healthy,
            latency_ms=latency_ms,
            last_checked=datetime.now(timezone.utc),
            error=error,
        )
        logger.info(
            f"reliability: probe name={name!r} healthy={healthy} "
            f"latency_ms={latency_ms:.2f}"
        )
        return result

    def count(self) -> int:
        return len(self._probes)
