"""Tests for FlowForge v6.0 Observability Module."""

import pytest
from flowforge.observability.tracer import Tracer, Span
from flowforge.observability.metrics_collector import MetricsCollector
from flowforge.observability.alerts import AlertManager, AlertRule


class TestTracer:
    """Tests for Tracer."""

    def test_start_span(self):
        tracer = Tracer()
        span = tracer.start_span("test_operation")
        assert span.name == "test_operation"
        assert span.trace_id
        assert span.span_id

    def test_finish_span(self):
        tracer = Tracer()
        span = tracer.start_span("test")
        tracer.finish_span(span, status="ok")
        assert span.end_time is not None
        assert span.duration_ms >= 0

    def test_span_attributes(self):
        span = Span("test")
        span.set_attribute("key", "value")
        assert span.attributes["key"] == "value"

    def test_span_to_dict(self):
        span = Span("test")
        d = span.to_dict()
        assert "trace_id" in d
        assert "name" in d
        assert "duration_ms" in d

    def test_get_trace(self):
        tracer = Tracer()
        span = tracer.start_span("op1")
        tracer.finish_span(span)
        trace = tracer.get_trace(span.trace_id)
        assert len(trace) == 1

    def test_disabled_tracer(self):
        tracer = Tracer(config={"enabled": False})
        span = tracer.start_span("test")
        # Should still work, just not record
        tracer.finish_span(span)

    def test_get_status(self):
        tracer = Tracer()
        status = tracer.get_status()
        assert "enabled" in status


class TestMetricsCollector:
    """Tests for MetricsCollector."""

    def test_counter(self):
        mc = MetricsCollector()
        mc.inc_counter("test_counter")
        mc.inc_counter("test_counter", 2)
        metrics = mc.get_all_metrics()
        assert metrics["counters"]["test_counter"] == 3

    def test_counter_with_labels(self):
        mc = MetricsCollector()
        mc.inc_counter("requests", labels={"method": "GET"})
        mc.inc_counter("requests", labels={"method": "POST"})
        metrics = mc.get_all_metrics()
        assert "requests{method=GET}" in metrics["counters"]
        assert "requests{method=POST}" in metrics["counters"]

    def test_gauge(self):
        mc = MetricsCollector()
        mc.set_gauge("temperature", 23.5)
        metrics = mc.get_all_metrics()
        assert metrics["gauges"]["temperature"] == 23.5

    def test_histogram(self):
        mc = MetricsCollector()
        mc.observe_histogram("latency", 0.1)
        mc.observe_histogram("latency", 0.2)
        metrics = mc.get_all_metrics()
        assert metrics["histograms"]["latency"]["count"] == 2
        assert abs(metrics["histograms"]["latency"]["avg"] - 0.15) < 1e-9

    def test_prometheus_format(self):
        mc = MetricsCollector()
        mc.inc_counter("test_total")
        output = mc.get_prometheus_format()
        assert "test_total" in output

    def test_disabled_collector(self):
        mc = MetricsCollector(config={"enabled": False})
        mc.inc_counter("test")
        metrics = mc.get_all_metrics()
        assert len(metrics["counters"]) == 0

    def test_get_status(self):
        mc = MetricsCollector()
        status = mc.get_status()
        assert "enabled" in status


class TestAlertManager:
    """Tests for AlertManager."""

    @pytest.mark.asyncio
    async def test_default_rules_loaded(self):
        am = AlertManager()
        assert len(am._rules) >= 3  # 3 default rules

    @pytest.mark.asyncio
    async def test_evaluate_no_alerts(self):
        am = AlertManager()
        await am.evaluate({"error_rate": 0.1})
        alerts = am.get_alerts()
        assert len(alerts) == 0

    @pytest.mark.asyncio
    async def test_evaluate_high_error_rate(self):
        am = AlertManager()
        await am.evaluate({"error_rate": 0.8})
        alerts = am.get_alerts(severity="critical")
        assert len(alerts) > 0

    @pytest.mark.asyncio
    async def test_custom_rule(self):
        am = AlertManager()
        am.add_rule(AlertRule(
            name="custom_test",
            condition=lambda ctx: ctx.get("custom_flag") is True,
            severity="warning",
            message="Custom alert triggered",
        ))
        await am.evaluate({"custom_flag": True})
        alerts = am.get_alerts()
        assert any(a["rule_name"] == "custom_test" for a in alerts)

    @pytest.mark.asyncio
    async def test_cooldown(self):
        """Alert doesn't fire twice within cooldown."""
        am = AlertManager()
        await am.evaluate({"error_rate": 0.8})
        await am.evaluate({"error_rate": 0.8})
        # Should only have 1 alert due to cooldown
        alerts = am.get_alerts()
        critical_alerts = [a for a in alerts if a["rule_name"] == "high_error_rate"]
        assert len(critical_alerts) == 1

    def test_get_status(self):
        am = AlertManager()
        status = am.get_status()
        assert "rule_count" in status
        assert "alert_count" in status
