"""可观测性核心模块 — 统一入口。

提供 trace_id 全链路传播、指标采集、审计日志功能。
整合了原 DevForge 的 TraceManager / Span / MetricsCollector / AuditLogger / ObservabilityManager。

与 flowforge.observability 包的关系：
- flowforge.observability 提供 OpenTelemetry/Prometheus 级别的分布式追踪和指标导出
- 本模块提供轻量级的核心可观测性原语，可独立使用，也可作为 observability 包的底层
"""

from __future__ import annotations

import json
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, AsyncIterator

import yaml

from flowforge.core.tracing import get_logger

logger = get_logger("core.observability")


@dataclass
class Span:
    """追踪跨度。"""
    trace_id: str
    span_id: str
    operation: str
    start_time: float = field(default_factory=time.time)
    end_time: float | None = None
    parent_span_id: str | None = None
    attributes: dict[str, Any] = field(default_factory=dict)
    status: str = "ok"

    @property
    def duration_ms(self) -> float:
        if self.end_time is None:
            return (time.time() - self.start_time) * 1000
        return (self.end_time - self.start_time) * 1000

    def finish(self, status: str = "ok") -> None:
        self.end_time = time.time()
        self.status = status


class TraceManager:
    """追踪管理器，维护 trace_id 和 span 链。"""

    def __init__(self):
        self._current_trace_id: str | None = None
        self._current_span_id: str | None = None
        self._spans: list[Span] = []

    def new_trace(self) -> str:
        """创建新的追踪。"""
        self._current_trace_id = uuid.uuid4().hex[:16]
        self._current_span_id = None
        return self._current_trace_id

    @property
    def trace_id(self) -> str | None:
        return self._current_trace_id

    def new_span(self, operation: str, **attributes) -> Span:
        """创建新的跨度。"""
        if not self._current_trace_id:
            self.new_trace()
        span = Span(
            trace_id=self._current_trace_id,
            span_id=uuid.uuid4().hex[:12],
            operation=operation,
            parent_span_id=self._current_span_id,
            attributes=attributes,
        )
        self._spans.append(span)
        self._current_span_id = span.span_id
        return span

    def finish_span(self, span: Span, status: str = "ok") -> None:
        """结束跨度。"""
        span.finish(status)
        # 恢复父span
        self._current_span_id = span.parent_span_id

    @asynccontextmanager
    async def trace_operation(self, operation: str, **attributes) -> AsyncIterator[Span]:
        """追踪异步操作的上下文管理器。"""
        span = self.new_span(operation, **attributes)
        try:
            yield span
            self.finish_span(span, "ok")
        except Exception as e:
            span.attributes["error"] = str(e)
            self.finish_span(span, "error")
            raise


class MetricsCollector:
    """指标采集器。

    提供计数器、仪表、直方图三种基础指标类型。
    与 flowforge.observability.metrics_collector.MetricsCollector 互补：
    本类提供轻量级内存采集，后者提供 Prometheus 兼容导出。
    """

    def __init__(self):
        self._counters: dict[str, float] = {}
        self._gauges: dict[str, float] = {}
        self._histograms: dict[str, list[float]] = {}

    def increment(self, name: str, value: float = 1.0, **labels) -> None:
        """递增计数器。"""
        key = self._make_key(name, labels)
        self._counters[key] = self._counters.get(key, 0) + value

    def gauge(self, name: str, value: float, **labels) -> None:
        """设置仪表值。"""
        key = self._make_key(name, labels)
        self._gauges[key] = value

    def observe(self, name: str, value: float, **labels) -> None:
        """记录直方图观测值。"""
        key = self._make_key(name, labels)
        self._histograms.setdefault(key, []).append(value)

    def get_snapshot(self) -> dict[str, Any]:
        """获取所有指标的快照。"""
        return {
            "counters": dict(self._counters),
            "gauges": dict(self._gauges),
            "histograms": {
                k: {"count": len(v), "sum": sum(v), "avg": sum(v)/len(v) if v else 0}
                for k, v in self._histograms.items()
            },
        }

    @staticmethod
    def _make_key(name: str, labels: dict) -> str:
        if not labels:
            return name
        label_str = ",".join(f"{k}={v}" for k, v in sorted(labels.items()))
        return f"{name}{{{label_str}}}"


class AuditLogger:
    """审计日志记录器。"""

    def __init__(self, log_path: str | Path = "logs/audit.jsonl"):
        self._log_path = Path(log_path)
        self._log_path.parent.mkdir(parents=True, exist_ok=True)

    def log(self, event_type: str, details: dict[str, Any],
            trace_id: str | None = None) -> None:
        """记录审计事件。"""
        entry = {
            "timestamp": time.time(),
            "event_type": event_type,
            "trace_id": trace_id,
            "details": details,
        }
        with open(self._log_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    def log_gate_decision(self, gate_id: str, verdict: str, scores: dict,
                          trace_id: str | None = None) -> None:
        """记录门禁决策。"""
        self.log("gate_decision", {
            "gate_id": gate_id,
            "verdict": verdict,
            "scores": scores,
        }, trace_id=trace_id)

    def log_human_intervention(self, gate_id: str, action: str, operator: str,
                               trace_id: str | None = None) -> None:
        """记录人工干预。"""
        self.log("human_intervention", {
            "gate_id": gate_id,
            "action": action,
            "operator": operator,
        }, trace_id=trace_id)

    def log_cascade_event(self, from_model: str, to_model: str, reason: str,
                          trace_id: str | None = None) -> None:
        """记录级联事件。"""
        self.log("cascade_event", {
            "from_model": from_model,
            "to_model": to_model,
            "reason": reason,
        }, trace_id=trace_id)


class ObservabilityManager:
    """可观测性管理器 — 统一入口。"""

    def __init__(self, config_path: str | Path | None = None):
        self._config = self._load_config(config_path)
        self.trace = TraceManager()
        self.metrics = MetricsCollector()
        self.audit = AuditLogger(
            self._config.get("logging", {}).get("audit_log_path", "logs/audit.jsonl")
        )

    def _load_config(self, path: str | Path | None) -> dict:
        if path is None:
            default_path = Path(__file__).parent.parent / "config" / "observability.yaml"
            if default_path.exists():
                with open(default_path, "r", encoding="utf-8") as f:
                    return yaml.safe_load(f) or {}
            return {}
        with open(path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}

    @asynccontextmanager
    async def trace_agent_execution(self, agent_name: str, **attrs) -> AsyncIterator[Span]:
        """追踪Agent执行的便捷方法。"""
        start = time.time()
        span = self.trace.new_span(f"agent:{agent_name}", **attrs)
        try:
            yield span
            self.metrics.increment("agent_execution_total", agent=agent_name)
            self.metrics.observe("agent_execution_seconds",
                                 (time.time() - start) * 1000, agent=agent_name)
            self.trace.finish_span(span, "ok")
        except Exception as e:
            self.metrics.increment("agent_execution_errors", agent=agent_name)
            self.trace.finish_span(span, "error")
            raise
