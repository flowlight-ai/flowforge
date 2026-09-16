"""FlowForge v6.0 Observability Module.

Provides:
- Tracer: OpenTelemetry distributed tracing
- MetricsCollector: Prometheus metrics collection
- AlertManager: Alert rules and notification
- PrometheusExporter: prometheus_client 标准导出器（P3-001）
- register_metrics_endpoint: FastAPI /metrics 路由注册函数
"""

from flowforge.observability.tracer import Tracer
from flowforge.observability.metrics_collector import MetricsCollector
from flowforge.observability.alerts import AlertManager
from flowforge.observability.prometheus_exporter import (
    PrometheusExporter,
    register_metrics_endpoint,
)

__all__ = [
    "Tracer",
    "MetricsCollector",
    "AlertManager",
    "PrometheusExporter",
    "register_metrics_endpoint",
]
