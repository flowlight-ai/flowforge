from __future__ import annotations

import time
from typing import Dict, List, Optional
from flowforge.core.tracing import get_logger

logger = get_logger("metrics")

_prometheus_available = False
try:
    from prometheus_client import Counter, Histogram, Gauge, generate_latest, CollectorRegistry
    _prometheus_available = True
except ImportError:
    pass

if _prometheus_available:
    _registry = CollectorRegistry()

    tasks_total = Counter(
        "flowforge_tasks_total", "Total tasks created",
        ["mode", "status"], registry=_registry,
    )
    execution_duration = Histogram(
        "flowforge_execution_duration_seconds", "Task execution duration",
        ["mode"], buckets=[0.5, 1, 2, 5, 10, 30, 60, 120, 300],
        registry=_registry,
    )
    token_usage = Counter(
        "flowforge_token_usage_total", "Token usage",
        ["model", "provider"], registry=_registry,
    )
    tool_calls = Counter(
        "flowforge_tool_calls_total", "Tool call count",
        ["tool_name", "status"], registry=_registry,
    )
    tool_duration = Histogram(
        "flowforge_tool_duration_seconds", "Tool call duration",
        ["tool_name"], buckets=[0.1, 0.5, 1, 2, 5, 10],
        registry=_registry,
    )
    llm_errors = Counter(
        "flowforge_llm_errors_total", "LLM error count",
        ["provider", "error_type"], registry=_registry,
    )
    persona_running = Gauge(
        "flowforge_persona_running", "Currently running tasks per persona",
        ["persona"], registry=_registry,
    )

    def record_tool_call(tool_name: str, duration: float):
        tool_calls.labels(tool_name=tool_name, status="success").inc()
        tool_duration.labels(tool_name=tool_name).observe(duration)
        if tool_name not in _tool_call_data:
            _tool_call_data[tool_name] = []
        _tool_call_data[tool_name].append(duration)
        logger.debug(f"tool_call recorded: {tool_name} duration={duration:.3f}s")

    def record_tool_error(tool_name: str):
        tool_calls.labels(tool_name=tool_name, status="error").inc()
        if tool_name not in _tool_call_data:
            _tool_call_data[tool_name] = []
        _tool_call_data[tool_name].append(-1.0)

    def record_llm_tokens(provider: str, model: str, tokens: int):
        token_usage.labels(model=model, provider=provider).inc(tokens)
        key = f"{provider}/{model}"
        _llm_token_data[key] = _llm_token_data.get(key, 0) + tokens
        logger.debug(f"llm_tokens recorded: {provider}/{model} tokens={tokens}")

    def record_llm_error(provider: str, error_type: str):
        llm_errors.labels(provider=provider, error_type=error_type).inc()
        logger.debug(f"llm_error recorded: {provider} error_type={error_type}")

    def record_task_created(mode: str, persona: str):
        tasks_total.labels(mode=mode, status="created").inc()
        key = f"{mode}/{persona}"
        _task_created_data[key] = _task_created_data.get(key, 0) + 1
        logger.debug(f"task_created recorded: {mode}/{persona}")

    def record_task_completed(mode: str, persona: str, duration: float):
        tasks_total.labels(mode=mode, status="completed").inc()
        execution_duration.labels(mode=mode).observe(duration)
        key = f"{mode}/{persona}"
        _task_completed_data[key] = _task_completed_data.get(key, 0) + 1
        if key not in _task_durations_data:
            _task_durations_data[key] = []
        _task_durations_data[key].append(duration)
        logger.debug(f"task_completed recorded: {mode}/{persona} duration={duration:.3f}s")

    def record_task_failed(mode: str, persona: str):
        tasks_total.labels(mode=mode, status="failed").inc()
        key = f"{mode}/{persona}"
        _task_failed_data[key] = _task_failed_data.get(key, 0) + 1
        logger.debug(f"task_failed recorded: {mode}/{persona}")

    def set_persona_running(persona: str, count: int):
        persona_running.labels(persona=persona).set(count)

    def get_prometheus_metrics() -> bytes:
        return generate_latest(_registry)

    def get_metrics() -> dict:
        return {
            "tool_stats": get_tool_stats(),
            "task_stats": get_task_stats(),
            "llm_token_stats": get_llm_token_stats(),
        }

    _tool_call_data: Dict[str, List[float]] = {}
    _task_created_data: Dict[str, int] = {}
    _task_completed_data: Dict[str, int] = {}
    _task_failed_data: Dict[str, int] = {}
    _task_durations_data: Dict[str, List[float]] = {}
    _llm_token_data: Dict[str, int] = {}

    def get_tool_stats() -> Dict[str, dict]:
        stats = {}
        for name, durations in _tool_call_data.items():
            if not durations:
                continue
            success_durations = [d for d in durations if d >= 0]
            error_count = sum(1 for d in durations if d < 0)
            entry: dict = {
                "call_count": len(durations),
                "error_count": error_count,
            }
            if success_durations:
                entry.update({
                    "total_duration": sum(success_durations),
                    "avg_duration": sum(success_durations) / len(success_durations),
                    "min_duration": min(success_durations),
                    "max_duration": max(success_durations),
                })
            stats[name] = entry
        return stats

    def get_task_stats() -> Dict[str, dict]:
        stats = {}
        all_keys = set(_task_created_data) | set(_task_completed_data) | set(_task_failed_data)
        for key in all_keys:
            durations = _task_durations_data.get(key, [])
            stats[key] = {
                "created": _task_created_data.get(key, 0),
                "completed": _task_completed_data.get(key, 0),
                "failed": _task_failed_data.get(key, 0),
                "avg_duration": sum(durations) / len(durations) if durations else 0,
            }
        return stats

    def get_llm_token_stats() -> Dict[str, int]:
        return dict(_llm_token_data)

else:
    _tool_call_durations: Dict[str, List[float]] = {}
    _tool_error_counts: Dict[str, int] = {}
    _llm_token_counts: Dict[str, int] = {}
    _llm_error_counts: Dict[str, Dict[str, int]] = {}

    def record_tool_call(tool_name: str, duration: float):
        if tool_name not in _tool_call_durations:
            _tool_call_durations[tool_name] = []
        _tool_call_durations[tool_name].append(duration)
        logger.debug(f"tool_call recorded: {tool_name} duration={duration:.3f}s")

    def record_tool_error(tool_name: str):
        _tool_error_counts[tool_name] = _tool_error_counts.get(tool_name, 0) + 1

    def record_llm_tokens(provider: str, model: str, tokens: int):
        key = f"{provider}/{model}"
        _llm_token_counts[key] = _llm_token_counts.get(key, 0) + tokens
        logger.debug(f"llm_tokens recorded: {key} tokens={tokens}")

    def record_llm_error(provider: str, error_type: str):
        if provider not in _llm_error_counts:
            _llm_error_counts[provider] = {}
        _llm_error_counts[provider][error_type] = _llm_error_counts[provider].get(error_type, 0) + 1
        logger.debug(f"llm_error recorded: {provider} error_type={error_type}")

    _task_created: Dict[str, int] = {}
    _task_completed: Dict[str, int] = {}
    _task_failed: Dict[str, int] = {}
    _task_durations: Dict[str, List[float]] = {}
    _persona_running_counts: Dict[str, int] = {}

    def record_task_created(mode: str, persona: str):
        key = f"{mode}/{persona}"
        _task_created[key] = _task_created.get(key, 0) + 1
        logger.debug(f"task_created recorded: {key}")

    def record_task_completed(mode: str, persona: str, duration: float):
        key = f"{mode}/{persona}"
        _task_completed[key] = _task_completed.get(key, 0) + 1
        if key not in _task_durations:
            _task_durations[key] = []
        _task_durations[key].append(duration)
        logger.debug(f"task_completed recorded: {key} duration={duration:.3f}s")

    def record_task_failed(mode: str, persona: str):
        key = f"{mode}/{persona}"
        _task_failed[key] = _task_failed.get(key, 0) + 1
        logger.debug(f"task_failed recorded: {key}")

    def set_persona_running(persona: str, count: int):
        _persona_running_counts[persona] = count

    def get_prometheus_metrics() -> bytes:
        return b""

    def get_tool_stats() -> Dict[str, dict]:
        stats = {}
        for name, durations in _tool_call_durations.items():
            if not durations:
                continue
            stats[name] = {
                "call_count": len(durations),
                "total_duration": sum(durations),
                "avg_duration": sum(durations) / len(durations),
                "min_duration": min(durations),
                "max_duration": max(durations),
                "error_count": _tool_error_counts.get(name, 0),
            }
        for name in _tool_error_counts:
            if name not in stats:
                stats[name] = {
                    "call_count": 0,
                    "error_count": _tool_error_counts[name],
                }
        return stats

    def get_task_stats() -> Dict[str, dict]:
        stats = {}
        all_keys = set(_task_created) | set(_task_completed) | set(_task_failed)
        for key in all_keys:
            durations = _task_durations.get(key, [])
            stats[key] = {
                "created": _task_created.get(key, 0),
                "completed": _task_completed.get(key, 0),
                "failed": _task_failed.get(key, 0),
                "avg_duration": sum(durations) / len(durations) if durations else 0,
            }
        return stats

    def get_llm_token_stats() -> Dict[str, int]:
        return dict(_llm_token_counts)

    def get_metrics() -> dict:
        return {
            "tool_stats": get_tool_stats(),
            "task_stats": get_task_stats(),
            "llm_token_stats": get_llm_token_stats(),
        }


# ---------------------------------------------------------------------------
# MetricsCollector — 单任务指标采集器
# ---------------------------------------------------------------------------

_metrics_collectors: Dict[str, MetricsCollector] = {}


class MetricsCollector:
    """采集单个任务执行过程中的各项指标。"""

    def __init__(self, task_id: str) -> None:
        self.task_id: str = task_id
        self.start_time: float = time.time()
        self.end_time: float = 0.0
        self.llm_calls: int = 0
        self.tool_calls: int = 0
        self.tokens_in: int = 0
        self.tokens_out: int = 0
        self.cost: float = 0.0
        self.steps_total: int = 0
        self.steps_completed: int = 0
        self.errors: List[str] = []

    # -- 记录方法 ----------------------------------------------------------

    def record_llm_call(self, tokens_in: int, tokens_out: int, cost: float) -> None:
        """记录一次 LLM 调用。"""
        self.llm_calls += 1
        self.tokens_in += tokens_in
        self.tokens_out += tokens_out
        self.cost += cost
        logger.debug(
            f"MetricsCollector[{self.task_id}] llm_call: "
            f"tokens_in={tokens_in}, tokens_out={tokens_out}, cost={cost:.6f}"
        )

    def record_tool_call(self, tool_name: str, success: bool) -> None:
        """记录一次工具调用。"""
        self.tool_calls += 1
        status = "success" if success else "error"
        logger.debug(
            f"MetricsCollector[{self.task_id}] tool_call: "
            f"tool={tool_name}, status={status}"
        )

    def record_error(self, error_msg: str) -> None:
        """记录一条错误信息。"""
        self.errors.append(error_msg)
        logger.debug(f"MetricsCollector[{self.task_id}] error: {error_msg}")

    # -- 汇总方法 ----------------------------------------------------------

    def get_summary(self) -> Dict[str, object]:
        """返回指标汇总字典，同时将 end_time 设为当前时间。"""
        end = self.end_time if self.end_time > 0 else time.time()
        duration = end - self.start_time
        return {
            "task_id": self.task_id,
            "duration": round(duration, 3),
            "llm_calls": self.llm_calls,
            "tool_calls": self.tool_calls,
            "tokens_in": self.tokens_in,
            "tokens_out": self.tokens_out,
            "cost": round(self.cost, 6),
            "steps_total": self.steps_total,
            "steps_completed": self.steps_completed,
            "steps_failed": self.steps_total - self.steps_completed,
            "error_count": len(self.errors),
            "errors": list(self.errors),
        }

    def to_dict(self) -> Dict[str, object]:
        """将完整指标序列化为字典。"""
        return {
            "task_id": self.task_id,
            "start_time": self.start_time,
            "end_time": self.end_time,
            "llm_calls": self.llm_calls,
            "tool_calls": self.tool_calls,
            "tokens_in": self.tokens_in,
            "tokens_out": self.tokens_out,
            "cost": self.cost,
            "steps_total": self.steps_total,
            "steps_completed": self.steps_completed,
            "errors": list(self.errors),
        }

    def finish(self) -> None:
        """标记任务结束，记录结束时间。"""
        self.end_time = time.time()


# -- 全局函数 ---------------------------------------------------------------


def get_metrics_collector(task_id: str) -> MetricsCollector:
    """获取或创建指定任务的指标采集器。"""
    if task_id not in _metrics_collectors:
        collector = MetricsCollector(task_id)
        _metrics_collectors[task_id] = collector
        logger.debug(f"MetricsCollector created for task: {task_id}")
    return _metrics_collectors[task_id]


def reset_metrics(task_id: str) -> None:
    """重置指定任务的指标采集器。"""
    if task_id in _metrics_collectors:
        del _metrics_collectors[task_id]
        logger.debug(f"MetricsCollector reset for task: {task_id}")
