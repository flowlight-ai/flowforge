"""Metrics Collector - Prometheus integration.

Implements FR-OBS-02: 5 core Prometheus metrics:
1. flowforge_tasks_total - Total tasks counter
2. flowforge_execution_duration_seconds - Execution duration histogram
3. flowforge_token_usage_total - Token usage counter
4. flowforge_tool_calls_total - Tool call counter
5. flowforge_persona_running - Currently running persona gauge
"""

import time
from typing import Optional, Dict, Any
from flowforge.core.tracing import get_logger

logger = get_logger("observability.metrics_collector")


class MetricsCollector:
    """Prometheus-compatible metrics collector.

    Collects and exposes 5 core metrics for FlowForge observability.
    Phase 1 uses in-memory collection; Phase 2 adds Prometheus export.
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = config or {}
        self.enabled = self.config.get("enabled", True)

        # In-memory metric storage
        self._counters: Dict[str, float] = {}
        self._histograms: Dict[str, list] = {}
        self._gauges: Dict[str, float] = {}

    def inc_counter(self, name: str, value: float = 1.0, labels: Optional[Dict[str, str]] = None):
        """Increment a counter metric."""
        if not self.enabled:
            return
        key = self._make_key(name, labels)
        self._counters[key] = self._counters.get(key, 0) + value

    def observe_histogram(self, name: str, value: float, labels: Optional[Dict[str, str]] = None):
        """Record a histogram observation."""
        if not self.enabled:
            return
        key = self._make_key(name, labels)
        if key not in self._histograms:
            self._histograms[key] = []
        self._histograms[key].append(value)

    def set_gauge(self, name: str, value: float, labels: Optional[Dict[str, str]] = None):
        """Set a gauge metric value."""
        if not self.enabled:
            return
        key = self._make_key(name, labels)
        self._gauges[key] = value

    def _make_key(self, name: str, labels: Optional[Dict[str, str]] = None) -> str:
        """Create a metric key with optional labels."""
        if not labels:
            return name
        label_str = ",".join(f"{k}={v}" for k, v in sorted(labels.items()))
        return f"{name}{{{label_str}}}"

    def get_all_metrics(self) -> dict:
        """Get all collected metrics."""
        return {
            "counters": dict(self._counters),
            "gauges": dict(self._gauges),
            "histograms": {
                k: {"count": len(v), "sum": sum(v), "avg": sum(v)/len(v) if v else 0}
                for k, v in self._histograms.items()
            },
        }

    def get_prometheus_format(self) -> str:
        """Export metrics in Prometheus text format."""
        lines = []

        for key, value in self._counters.items():
            lines.append(f"# TYPE {key.split('{')[0]} counter")
            lines.append(f"{key} {value}")

        for key, value in self._gauges.items():
            lines.append(f"# TYPE {key.split('{')[0]} gauge")
            lines.append(f"{key} {value}")

        for key, values in self._histograms.items():
            base_name = key.split('{')[0]
            lines.append(f"# TYPE {base_name} histogram")
            lines.append(f"{key}_count {len(values)}")
            lines.append(f"{key}_sum {sum(values)}")

        return "\n".join(lines)

    def get_status(self) -> dict:
        """Get metrics collector status."""
        return {
            "enabled": self.enabled,
            "counter_count": len(self._counters),
            "gauge_count": len(self._gauges),
            "histogram_count": len(self._histograms),
        }
