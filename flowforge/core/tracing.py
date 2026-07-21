"""Cross-platform tracing — trace_id ContextVar + TraceLogger.

跨平台约束：
- 所有路径用 pathlib.Path，禁止硬编码绝对路径
- 日志目录默认在 <project_root>/logs/，但可被环境变量 FLOWFORGE_LOG_DIR 覆盖
"""

from __future__ import annotations

import logging
import logging.config
import logging.handlers
import os
import uuid
from contextvars import ContextVar
from pathlib import Path
from typing import Any, Optional

_trace_id: ContextVar[str] = ContextVar("trace_id", default="")
_logging_configured = False

CONSOLE_FORMAT = "[%(levelname)s] %(name)s: %(message)s"
FILE_FORMAT = (
    "%(asctime)s [%(levelname)s] [%(name)s:%(funcName)s:%(lineno)d] "
    "[trace_id=%(trace_id)s] %(message)s"
)

DEFAULT_MODULE_LEVELS: dict[str, int] = {
    "flowforge": logging.DEBUG,
}


class TraceIdFilter(logging.Filter):
    """Inject trace_id into every log record."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.trace_id = get_trace_id()
        return True


def _resolve_log_dir() -> Path:
    """Resolve log directory from env or fall back to <pkg_root>/../logs.

    Resolution order:
    1. FLOWFORGE_LOG_DIR env var (absolute path)
    2. <project_root>/logs (project_root = parent of flowforge package)
    """
    env_dir = os.environ.get("FLOWFORGE_LOG_DIR")
    if env_dir:
        path = Path(env_dir).expanduser()
        path.mkdir(parents=True, exist_ok=True)
        return path
    # flowforge/core/tracing.py → flowforge/ → <project_root>/
    project_root = Path(__file__).resolve().parent.parent.parent
    log_dir = project_root / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    return log_dir


def configure_logging(config: Optional[dict[str, Any]] = None) -> None:
    """Configure root logger with console + rotating file handlers (idempotent)."""
    global _logging_configured
    if _logging_configured:
        return
    _logging_configured = True

    log_dir = _resolve_log_dir()
    log_file = log_dir / "flowforge.log"

    trace_filter = TraceIdFilter()

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(logging.Formatter(CONSOLE_FORMAT))
    console_handler.setLevel(logging.INFO)
    console_handler.addFilter(trace_filter)

    file_handler = logging.handlers.RotatingFileHandler(
        str(log_file),
        maxBytes=10 * 1024 * 1024,
        backupCount=5,
        encoding="utf-8",
    )
    file_handler.setFormatter(logging.Formatter(FILE_FORMAT))
    file_handler.setLevel(logging.DEBUG)
    file_handler.addFilter(trace_filter)

    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)
    root_logger.addHandler(console_handler)
    root_logger.addHandler(file_handler)

    module_levels = config if config else DEFAULT_MODULE_LEVELS
    for name, level in module_levels.items():
        logging.getLogger(name).setLevel(level)


def _ensure_file_logging() -> None:
    if not _logging_configured:
        configure_logging()


def get_log_file_path() -> Path:
    """Return absolute path to the active log file (does not create it)."""
    return _resolve_log_dir() / "flowforge.log"


def generate_trace_id() -> str:
    return str(uuid.uuid4())


def set_trace_id(trace_id: Optional[str] = None) -> str:
    """Set trace_id for the current async/context task. Returns the id set."""
    tid = trace_id or generate_trace_id()
    _trace_id.set(tid)
    return tid


def get_trace_id() -> str:
    return _trace_id.get() or "unknown"


class TraceLogger:
    """Thin wrapper over stdlib logging with trace_id injection."""

    def __init__(self, name: str, level: str = "INFO") -> None:
        _ensure_file_logging()
        self.logger = logging.getLogger(name)
        self.logger.setLevel(getattr(logging, level.upper()))

    def _log(self, level: str, msg: str, *args: Any, **kwargs: Any) -> None:
        exc_info = kwargs.pop("exc_info", False)
        extra = {"trace_id": get_trace_id()}
        getattr(self.logger, level)(msg, *args, exc_info=exc_info, extra=extra)

    def info(self, msg: str, *args: Any, **kwargs: Any) -> None:
        self._log("info", msg, *args, **kwargs)

    def warning(self, msg: str, *args: Any, **kwargs: Any) -> None:
        self._log("warning", msg, *args, **kwargs)

    def error(self, msg: str, *args: Any, **kwargs: Any) -> None:
        self._log("error", msg, *args, **kwargs)

    def debug(self, msg: str, *args: Any, **kwargs: Any) -> None:
        self._log("debug", msg, *args, **kwargs)

    def exception(self, msg: str, *args: Any, **kwargs: Any) -> None:
        kwargs["exc_info"] = True
        self._log("error", msg, *args, **kwargs)


def get_logger(name: str, level: str = "INFO") -> TraceLogger:
    return TraceLogger(name, level)
