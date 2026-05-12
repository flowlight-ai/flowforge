import logging
import uuid
from contextvars import ContextVar
from pathlib import Path
from typing import Optional

_trace_id: ContextVar[str] = ContextVar("trace_id", default="")
_file_handler_configured = False


def _ensure_file_logging():
    global _file_handler_configured
    if _file_handler_configured:
        return
    log_dir = Path(__file__).parent.parent / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / "flowforge.log"
    handler = logging.FileHandler(str(log_file), encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
    handler.setLevel(logging.DEBUG)
    logging.getLogger().addHandler(handler)
    _file_handler_configured = True


def generate_trace_id() -> str:
    return str(uuid.uuid4())


def set_trace_id(trace_id: Optional[str] = None) -> str:
    tid = trace_id or generate_trace_id()
    _trace_id.set(tid)
    return tid


def get_trace_id() -> str:
    return _trace_id.get() or "unknown"


class TraceLogger:
    def __init__(self, name: str, level: str = "INFO"):
        _ensure_file_logging()
        self.logger = logging.getLogger(name)
        self.logger.setLevel(getattr(logging, level.upper()))

    def _log(self, level: str, msg: str, *args, **kwargs):
        trace_id = get_trace_id()
        extra = " " + " ".join(f"{k}={v}" for k, v in kwargs.items()) if kwargs else ""
        formatted = f"[trace_id={trace_id}] {msg}{extra}"
        getattr(self.logger, level)(formatted, *args)

    def info(self, msg: str, *args, **kwargs):
        self._log("info", msg, *args, **kwargs)

    def warning(self, msg: str, *args, **kwargs):
        self._log("warning", msg, *args, **kwargs)

    def error(self, msg: str, *args, **kwargs):
        self._log("error", msg, *args, **kwargs)

    def debug(self, msg: str, *args, **kwargs):
        self._log("debug", msg, *args, **kwargs)


def get_logger(name: str, level: str = "INFO") -> TraceLogger:
    return TraceLogger(name, level)
