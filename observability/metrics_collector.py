"""Metrics Collector - Prometheus integration.

Implements FR-OBS-02: 5 core Prometheus metrics:
1. flowforge_tasks_total - Total tasks counter
2. flowforge_execution_duration_seconds - Execution duration histogram
3. flowforge_token_usage_total - Token usage counter
4. flowforge_tool_calls_total - Tool call counter
5. flowforge_persona_running - Currently running persona gauge

ContentForge-specific business metrics:
6. contentforge_article_quality_score - Article quality score gauge
7. contentforge_publish_success_total - Publish success counter
8. contentforge_publish_failure_total - Publish failure counter
9. contentforge_persona_usage_total - Persona usage counter
10. contentforge_topic_research_duration_seconds - Topic research duration histogram
"""

import time
from typing import Optional, Dict, Any
from flowforge.core.tracing import get_logger

logger = get_logger("observability.metrics_collector")


class MetricsCollector:
    """Prometheus-compatible metrics collector.

    Collects and exposes 5 core metrics for FlowForge observability,
    plus ContentForge-specific business metrics.
    Phase 1 uses in-memory collection; Phase 2 adds Prometheus export.
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = config or {}
        self.enabled = self.config.get("enabled", True)

        # In-memory metric storage
        self._counters: Dict[str, float] = {}
        self._histograms: Dict[str, list] = {}
        self._gauges: Dict[str, float] = {}

    # ── Core metric operations ──────────────────────────────────────

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

    # ── ContentForge business metrics ───────────────────────────────

    def record_article_quality(self, score: float, persona: str = "", task_id: str = ""):
        """Record article quality score.

        Args:
            score: Quality score (0.0 - 1.0).
            persona: The persona that produced the article.
            task_id: Associated task ID.
        """
        labels = {}
        if persona:
            labels["persona"] = persona
        if task_id:
            labels["task_id"] = task_id
        self.set_gauge("contentforge_article_quality_score", score, labels or None)
        logger.debug(f"Article quality recorded: score={score}, persona={persona}")

    def record_publish_result(self, success: bool, platform: str = "", persona: str = ""):
        """Record a publish attempt result.

        Args:
            success: Whether the publish succeeded.
            platform: Target platform (wechat, toutiao, etc.).
            persona: The persona that authored the content.
        """
        labels = {}
        if platform:
            labels["platform"] = platform
        if persona:
            labels["persona"] = persona
        metric_name = "contentforge_publish_success_total" if success else "contentforge_publish_failure_total"
        self.inc_counter(metric_name, labels=labels or None)
        logger.debug(f"Publish result recorded: success={success}, platform={platform}")

    def get_publish_success_rate(self, platform: str = "", persona: str = "") -> float:
        """Calculate publish success rate for given filters."""
        success_key = self._make_key("contentforge_publish_success_total",
                                     {"platform": platform, "persona": persona} if platform or persona else None)
        failure_key = self._make_key("contentforge_publish_failure_total",
                                     {"platform": platform, "persona": persona} if platform or persona else None)
        success_count = self._counters.get(success_key, 0)
        failure_count = self._counters.get(failure_key, 0)
        total = success_count + failure_count
        return success_count / total if total > 0 else 0.0

    def record_persona_usage(self, persona: str):
        """Record a persona usage event."""
        self.inc_counter("contentforge_persona_usage_total", labels={"persona": persona})
        logger.debug(f"Persona usage recorded: persona={persona}")

    def record_topic_research_duration(self, duration_seconds: float, strategy: str = "", persona: str = ""):
        """Record topic research duration.

        Args:
            duration_seconds: Time spent on topic research.
            strategy: The topic strategy used (hot_trend, vertical_deep_dive, etc.).
            persona: The persona context.
        """
        labels = {}
        if strategy:
            labels["strategy"] = strategy
        if persona:
            labels["persona"] = persona
        self.observe_histogram("contentforge_topic_research_duration_seconds", duration_seconds,
                               labels=labels or None)
        logger.debug(f"Topic research duration recorded: {duration_seconds:.2f}s, strategy={strategy}")

    # ── Export methods ───────────────────────────────────────────────

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

    def get_contentforge_metrics(self) -> dict:
        """Get ContentForge-specific business metrics summary."""
        quality_scores = {k: v for k, v in self._gauges.items()
                         if k.startswith("contentforge_article_quality_score")}
        publish_success = {k: v for k, v in self._counters.items()
                          if k.startswith("contentforge_publish_success_total")}
        publish_failure = {k: v for k, v in self._counters.items()
                          if k.startswith("contentforge_publish_failure_total")}
        persona_usage = {k: v for k, v in self._counters.items()
                        if k.startswith("contentforge_persona_usage_total")}
        topic_durations = {k: v for k, v in self._histograms.items()
                          if k.startswith("contentforge_topic_research_duration_seconds")}

        return {
            "article_quality_scores": quality_scores,
            "publish_success": publish_success,
            "publish_failure": publish_failure,
            "publish_success_rate": self._compute_publish_rates(),
            "persona_usage_counts": persona_usage,
            "topic_research_durations": {
                k: {"count": len(v), "sum": sum(v), "avg": sum(v)/len(v) if v else 0}
                for k, v in topic_durations.items()
            },
        }

    def _compute_publish_rates(self) -> dict:
        """Compute publish success rates per platform/persona combination."""
        rates = {}
        all_keys = set()
        for k in self._counters:
            if k.startswith("contentforge_publish_success_total") or \
               k.startswith("contentforge_publish_failure_total"):
                base = k.split("{")[0]
                labels_part = k.split("{")[1].rstrip("}") if "{" in k else ""
                all_keys.add(labels_part)

        for label_str in all_keys:
            s_key = f"contentforge_publish_success_total{{{label_str}}}" if label_str else "contentforge_publish_success_total"
            f_key = f"contentforge_publish_failure_total{{{label_str}}}" if label_str else "contentforge_publish_failure_total"
            s = self._counters.get(s_key, 0)
            f = self._counters.get(f_key, 0)
            total = s + f
            rates[label_str or "overall"] = s / total if total > 0 else 0.0
        return rates

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
