import logging
import logging.config
import logging.handlers
import uuid
from contextvars import ContextVar
from pathlib import Path
from typing import Any, Optional

_trace_id: ContextVar[str] = ContextVar("trace_id", default="")
_logging_configured = False

CONSOLE_FORMAT = "[%(levelname)s] %(name)s: %(message)s"
FILE_FORMAT = "%(asctime)s [%(levelname)s] [%(name)s:%(funcName)s:%(lineno)d] [trace_id=%(trace_id)s] %(message)s"

DEFAULT_MODULE_LEVELS: dict[str, int] = {
    "flowforge": logging.DEBUG,
}


class TraceIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.trace_id = get_trace_id()
        return True


def configure_logging(config: Optional[dict[str, Any]] = None) -> None:
    global _logging_configured
    if _logging_configured:
        return
    _logging_configured = True

    project_root = Path(__file__).parent.parent
    log_dir = project_root / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
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


def load_logging_config() -> None:
    global _logging_configured
    if _logging_configured:
        return

    config_path = Path(__file__).parent.parent / "config" / "logging.yaml"
    if config_path.exists():
        import yaml

        with open(config_path, "r", encoding="utf-8") as f:
            config = yaml.safe_load(f)
        logging.config.dictConfig(config)

        trace_filter = TraceIdFilter()
        for handler in logging.getLogger().handlers:
            handler.addFilter(trace_filter)

        _logging_configured = True
    else:
        configure_logging()


def _ensure_file_logging():
    if not _logging_configured:
        configure_logging()


def get_log_file_path() -> Path:
    return Path(__file__).parent.parent / "logs" / "flowforge.log"


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
        exc_info = kwargs.pop("exc_info", False)
        extra = {"trace_id": get_trace_id()}
        getattr(self.logger, level)(msg, *args, exc_info=exc_info, extra=extra)

    def info(self, msg: str, *args, **kwargs):
        self._log("info", msg, *args, **kwargs)

    def warning(self, msg: str, *args, **kwargs):
        self._log("warning", msg, *args, **kwargs)

    def error(self, msg: str, *args, **kwargs):
        self._log("error", msg, *args, **kwargs)

    def debug(self, msg: str, *args, **kwargs):
        self._log("debug", msg, *args, **kwargs)

    def exception(self, msg: str, *args, **kwargs):
        kwargs["exc_info"] = True
        self._log("error", msg, *args, **kwargs)


def get_logger(name: str, level: str = "INFO") -> TraceLogger:
    return TraceLogger(name, level)
