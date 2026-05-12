import time
from typing import Dict, List, Optional
from core.tracing import get_logger

logger = get_logger("metrics")

_tool_call_durations: Dict[str, List[float]] = {}
_llm_token_counts: Dict[str, int] = {}


def record_tool_call(tool_name: str, duration: float):
    if tool_name not in _tool_call_durations:
        _tool_call_durations[tool_name] = []
    _tool_call_durations[tool_name].append(duration)
    logger.debug(f"tool_call recorded: {tool_name} duration={duration:.3f}s")


def record_llm_tokens(provider: str, model: str, tokens: int):
    key = f"{provider}/{model}"
    _llm_token_counts[key] = _llm_token_counts.get(key, 0) + tokens
    logger.debug(f"llm_tokens recorded: {key} tokens={tokens}")


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
        }
    return stats


_task_created: Dict[str, int] = {}
_task_completed: Dict[str, int] = {}
_task_failed: Dict[str, int] = {}
_task_durations: Dict[str, List[float]] = {}


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
