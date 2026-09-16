"""Distributed Tracer - OpenTelemetry integration.

Implements FR-OBS-01: Full-chain distributed tracing.
Provides trace_id propagation across all execution layers.
"""

import time
import uuid
import contextvars
from typing import Optional, Dict, Any
from flowforge.core.tracing import get_logger

logger = get_logger("observability.tracer")

# Context variable for current trace
_current_trace_id = contextvars.ContextVar("trace_id", default="")
_current_span_id = contextvars.ContextVar("span_id", default="")


class Span:
    """A single trace span."""

    def __init__(self, name: str, trace_id: str = "", parent_id: str = ""):
        self.name = name
        self.trace_id = trace_id or str(uuid.uuid4())
        self.span_id = str(uuid.uuid4())[:8]
        self.parent_id = parent_id
        self.start_time = time.time()
        self.end_time: Optional[float] = None
        self.attributes: Dict[str, Any] = {}
        self.status = "ok"

    def set_attribute(self, key: str, value: Any):
        """Set a span attribute."""
        self.attributes[key] = value

    def finish(self, status: str = "ok"):
        """Finish the span."""
        self.end_time = time.time()
        self.status = status

    @property
    def duration_ms(self) -> float:
        """Get span duration in milliseconds."""
        end = self.end_time or time.time()
        return (end - self.start_time) * 1000

    def to_dict(self) -> dict:
        """Convert span to dict for serialization."""
        return {
            "trace_id": self.trace_id,
            "span_id": self.span_id,
            "parent_id": self.parent_id,
            "name": self.name,
            "start_time": self.start_time,
            "end_time": self.end_time,
            "duration_ms": self.duration_ms,
            "status": self.status,
            "attributes": self.attributes,
        }


class Tracer:
    """Distributed tracer with context propagation.

    Provides trace_id propagation across all execution layers,
    enabling full-chain observability.
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = config or {}
        self.enabled = self.config.get("enabled", True)
        self._spans: Dict[str, Span] = {}
        self._completed_spans: list = []
        self._max_completed = self.config.get("max_completed_spans", 1000)

    def start_span(self, name: str, trace_id: str = "", parent_id: str = "") -> Span:
        """Start a new trace span."""
        if not self.enabled:
            return Span(name, trace_id, parent_id)

        span = Span(name, trace_id, parent_id)
        self._spans[span.span_id] = span

        # Set context variables
        _current_trace_id.set(span.trace_id)
        _current_span_id.set(span.span_id)

        logger.debug(f"Span started: {name} (trace={span.trace_id[:8]}...)")
        return span

    def finish_span(self, span: Span, status: str = "ok"):
        """Finish a trace span."""
        if not self.enabled:
            return

        span.finish(status)

        # Move to completed
        self._spans.pop(span.span_id, None)
        self._completed_spans.append(span.to_dict())

        # Trim if too many
        if len(self._completed_spans) > self._max_completed:
            self._completed_spans = self._completed_spans[-self._max_completed:]

        logger.debug(f"Span finished: {span.name} ({span.duration_ms:.1f}ms, status={status})")

    def get_current_trace_id(self) -> str:
        """Get the current trace_id from context."""
        return _current_trace_id.get("")

    def get_trace(self, trace_id: str) -> list:
        """Get all spans for a trace."""
        return [
            s for s in self._completed_spans
            if s.get("trace_id") == trace_id
        ]

    def get_status(self) -> dict:
        """Get tracer status."""
        return {
            "enabled": self.enabled,
            "active_spans": len(self._spans),
            "completed_spans": len(self._completed_spans),
        }
