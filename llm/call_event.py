"""LLM call event tracking — structured observability for LLM calls.

Provides ``LLMCallEvent`` (a dataclass representing a single LLM call) and
``LLMCallEventCollector`` (a thread-safe ring-buffer collector with
querying, summarisation, and Prometheus-compatible export).

License: MIT
"""

import asyncio
from collections import deque
from dataclasses import dataclass
from typing import Any

from flowforge.core.tracing import get_logger

logger = get_logger("call_event")

# ---------------------------------------------------------------------------
# LLMCallEvent
# ---------------------------------------------------------------------------


@dataclass
class LLMCallEvent:
    """Structured record of a single LLM call."""

    trace_id: str
    timestamp: float
    model: str
    provider: str
    input_tokens: int = 0
    output_tokens: int = 0
    latency_ms: float = 0.0
    cost: float = 0.0
    status: str = "success"  # success / error / timeout
    error_message: str = ""
    agent_name: str = ""
    task_id: str = ""


# ---------------------------------------------------------------------------
# LLMCallEventCollector
# ---------------------------------------------------------------------------

_MAX_EVENTS = 10_000


class LLMCallEventCollector:
    """Thread-safe ring-buffer collector for ``LLMCallEvent`` instances.

    Stores up to ``max_events`` events in a deque.  When the buffer is
    full the oldest events are silently discarded.  All mutating
    operations are guarded by an ``asyncio.Lock``.
    """

    def __init__(self, max_events: int = _MAX_EVENTS) -> None:
        self._max_events = max_events
        self._events: deque[LLMCallEvent] = deque(maxlen=max_events)
        self._lock = asyncio.Lock()

    # -- Recording -----------------------------------------------------------

    async def record(self, event: LLMCallEvent) -> None:
        """Record an LLM call event."""
        async with self._lock:
            self._events.append(event)
        logger.debug(
            f"LLMCallEvent recorded: trace={event.trace_id} "
            f"model={event.provider}/{event.model} status={event.status}"
        )

    # -- Querying ------------------------------------------------------------

    async def get_events(
        self,
        trace_id: str | None = None,
        agent_name: str | None = None,
        time_range: tuple[float, float] | None = None,
    ) -> list[LLMCallEvent]:
        """Query events with optional filters.

        Args:
            trace_id: Filter by trace ID.
            agent_name: Filter by agent name.
            time_range: Tuple of (start_ts, end_ts) to filter by timestamp.

        Returns:
            List of matching events (newest first).
        """
        async with self._lock:
            results: list[LLMCallEvent] = []
            for ev in reversed(self._events):
                if trace_id and ev.trace_id != trace_id:
                    continue
                if agent_name and ev.agent_name != agent_name:
                    continue
                if time_range:
                    start_ts, end_ts = time_range
                    if ev.timestamp < start_ts or ev.timestamp > end_ts:
                        continue
                results.append(ev)
            return results

    # -- Summarisation -------------------------------------------------------

    async def get_summary(
        self, time_range: tuple[float, float] | None = None
    ) -> dict[str, Any]:
        """Return an aggregated summary of collected events.

        Args:
            time_range: Optional (start_ts, end_ts) filter.

        Returns:
            Dict with total_calls, total_input_tokens, total_output_tokens,
            total_cost, error_rate, avg_latency_ms, and per-provider breakdown.
        """
        async with self._lock:
            events = list(self._events)

        if time_range:
            start_ts, end_ts = time_range
            events = [
                e for e in events if start_ts <= e.timestamp <= end_ts
            ]

        if not events:
            return {
                "total_calls": 0,
                "total_input_tokens": 0,
                "total_output_tokens": 0,
                "total_cost": 0.0,
                "error_rate": 0.0,
                "avg_latency_ms": 0.0,
                "by_provider": {},
            }

        total = len(events)
        errors = sum(1 for e in events if e.status in ("error", "timeout"))
        total_in = sum(e.input_tokens for e in events)
        total_out = sum(e.output_tokens for e in events)
        total_cost = sum(e.cost for e in events)
        latencies = [e.latency_ms for e in events if e.latency_ms > 0]
        avg_latency = sum(latencies) / len(latencies) if latencies else 0.0

        # Per-provider breakdown
        by_provider: dict[str, dict[str, Any]] = {}
        for e in events:
            if e.provider not in by_provider:
                by_provider[e.provider] = {
                    "calls": 0,
                    "errors": 0,
                    "input_tokens": 0,
                    "output_tokens": 0,
                    "cost": 0.0,
                    "latency_ms_sum": 0.0,
                }
            p = by_provider[e.provider]
            p["calls"] += 1
            if e.status in ("error", "timeout"):
                p["errors"] += 1
            p["input_tokens"] += e.input_tokens
            p["output_tokens"] += e.output_tokens
            p["cost"] += e.cost
            p["latency_ms_sum"] += e.latency_ms

        # Compute per-provider averages
        for prov, p in by_provider.items():
            p["avg_latency_ms"] = (
                p["latency_ms_sum"] / p["calls"] if p["calls"] > 0 else 0.0
            )
            p["error_rate"] = p["errors"] / p["calls"] if p["calls"] > 0 else 0.0
            p["cost"] = round(p["cost"], 6)
            del p["latency_ms_sum"]

        return {
            "total_calls": total,
            "total_input_tokens": total_in,
            "total_output_tokens": total_out,
            "total_cost": round(total_cost, 6),
            "error_rate": round(errors / total, 4) if total > 0 else 0.0,
            "avg_latency_ms": round(avg_latency, 2),
            "by_provider": by_provider,
        }

    # -- Prometheus-compatible export ----------------------------------------

    async def export_metrics(self) -> dict[str, Any]:
        """Export metrics in a Prometheus-compatible format.

        Returns a dict with ``counters`` and ``histograms`` keys whose
        values are lists of metric dicts suitable for Prometheus push
        or scrape.
        """
        summary = await self.get_summary()
        by_provider = summary.get("by_provider", {})

        counters: list[dict[str, Any]] = [
            {
                "name": "flowforge_llm_calls_total",
                "help": "Total LLM calls",
                "type": "counter",
                "value": summary["total_calls"],
            },
            {
                "name": "flowforge_llm_input_tokens_total",
                "help": "Total LLM input tokens",
                "type": "counter",
                "value": summary["total_input_tokens"],
            },
            {
                "name": "flowforge_llm_output_tokens_total",
                "help": "Total LLM output tokens",
                "type": "counter",
                "value": summary["total_output_tokens"],
            },
            {
                "name": "flowforge_llm_cost_total",
                "help": "Total LLM cost in USD",
                "type": "counter",
                "value": summary["total_cost"],
            },
            {
                "name": "flowforge_llm_errors_total",
                "help": "Total LLM errors",
                "type": "counter",
                "value": int(
                    summary["total_calls"] * summary["error_rate"]
                ),
            },
        ]

        # Per-provider counters
        for provider, p in by_provider.items():
            counters.append({
                "name": "flowforge_llm_provider_calls_total",
                "help": "LLM calls per provider",
                "type": "counter",
                "value": p["calls"],
                "labels": {"provider": provider},
            })
            counters.append({
                "name": "flowforge_llm_provider_cost_total",
                "help": "LLM cost per provider",
                "type": "counter",
                "value": p["cost"],
                "labels": {"provider": provider},
            })

        histograms: list[dict[str, Any]] = [
            {
                "name": "flowforge_llm_latency_ms",
                "help": "LLM call latency in milliseconds",
                "type": "histogram",
                "value": summary["avg_latency_ms"],
            },
        ]

        return {
            "counters": counters,
            "histograms": histograms,
        }


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

_collector_instance: LLMCallEventCollector | None = None


def get_call_event_collector(
    max_events: int = _MAX_EVENTS,
) -> LLMCallEventCollector:
    """Return the singleton LLMCallEventCollector instance.

    On first call the instance is created.  If *max_events* is provided
    on the first call it will be used; subsequent calls ignore it.

    Returns:
        The shared ``LLMCallEventCollector`` instance.
    """
    global _collector_instance
    if _collector_instance is None:
        _collector_instance = LLMCallEventCollector(max_events)
    return _collector_instance
