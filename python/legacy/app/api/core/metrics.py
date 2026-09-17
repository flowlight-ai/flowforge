"""Prometheus /metrics endpoint for FlowForge.

Exposes all collected metrics in Prometheus text format,
including FlowForge core metrics and ContentForge business metrics.
"""

from fastapi import APIRouter, Response
from flowforge.core.tracing import get_logger

logger = get_logger("api.metrics")

router = APIRouter(tags=["metrics"])


@router.get("/metrics", summary="Prometheus metrics endpoint")
async def prometheus_metrics():
    """Expose metrics in Prometheus text format.

    Returns all FlowForge core metrics (tasks, execution duration,
    token usage, tool calls, persona running) and ContentForge
    business metrics (article quality, publish success rate,
    persona usage, topic research duration).
    """
    from flowforge.core.metrics import get_prometheus_metrics, get_metrics

    # Try Prometheus-format first (available when prometheus_client is installed)
    prom_data = get_prometheus_metrics()
    if prom_data:
        # Merge observability MetricsCollector data if available
        observability_lines = _get_observability_metrics()
        combined = prom_data.decode("utf-8") if isinstance(prom_data, bytes) else prom_data
        if observability_lines:
            combined += "\n" + observability_lines
        return Response(
            content=combined,
            media_type="text/plain; version=0.0.4; charset=utf-8",
        )

    # Fallback: JSON metrics + observability metrics
    result = get_metrics()
    result["observability"] = _get_observability_metrics_dict()
    return result


def _get_observability_metrics() -> str:
    """Get Prometheus-format metrics from the observability MetricsCollector."""
    try:
        from flowforge.observability.metrics_collector import MetricsCollector
        # Access the global singleton if it exists
        collector = _get_global_metrics_collector()
        if collector:
            return collector.get_prometheus_format()
    except ImportError:
        pass
    return ""


def _get_observability_metrics_dict() -> dict:
    """Get dict-format metrics from the observability MetricsCollector."""
    try:
        collector = _get_global_metrics_collector()
        if collector:
            return collector.get_all_metrics()
    except ImportError:
        pass
    return {}


def _get_global_metrics_collector():
    """Retrieve the global MetricsCollector instance if available."""
    try:
        from flowforge.observability import metrics_collector as mc_module
        if hasattr(mc_module, '_global_collector'):
            return mc_module._global_collector
    except ImportError:
        pass
    return None
