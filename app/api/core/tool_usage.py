"""Tool Usage API — 工具使用统计（真实实现）。

前端 HubToolUsageTab 期望接口（对齐契约）：
    - ``GET /api/v1/tools/usage`` → ``{"stats": ToolUsageStat[]}``
      ToolUsageStat = {toolName, category, totalCalls, successCalls,
                       failedCalls, avgLatencyMs, lastCalledAt?}

数据源（真实）：
    - ``flowforge.core.metrics`` 内存指标（当前进程内工具调用，重启清零）
    - ``logs/flowforge.log`` 中 declarative_tool 的执行记录（持久化补充）
"""

from __future__ import annotations

import re
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter

router = APIRouter(prefix="/tools", tags=["tool-usage"])

_ROOT = Path(__file__).resolve().parents[3]
_LOCK = threading.Lock()

# declarative_tool 日志行示例：
# [INFO] [declarative_tool:_log:119] [trace_id=...] ScriptTool 'echo_tool': executing command='echo hello', timeout=60.0s, output_format=text
_TOOL_EXEC_RE = re.compile(r"ScriptTool '([^']+)': executing")

# 工具 → 类别映射（与前端 CATEGORY_LABELS 对应：rag/publish/search/exec/io/other）
_CATEGORY_RULES = [
    (re.compile(r"rag|retriev|memory|embed", re.I), "rag"),
    (re.compile(r"publish|post|release|deploy", re.I), "publish"),
    (re.compile(r"search|browse|fetch|http|url|web", re.I), "search"),
    (re.compile(r"exec|run|script|shell|command", re.I), "exec"),
    (re.compile(r"file|read|write|io|upload|download", re.I), "io"),
]


def _category_for(tool_name: str) -> str:
    for pattern, category in _CATEGORY_RULES:
        if pattern.search(tool_name):
            return category
    return "other"


def _parse_log_tools() -> dict[str, dict[str, Any]]:
    """从 flowforge.log 尾部解析 declarative_tool 执行记录。"""
    stats: dict[str, dict[str, Any]] = {}
    log_path = _ROOT / "logs" / "flowforge.log"
    if not log_path.exists():
        return stats

    size = log_path.stat().st_size
    with open(log_path, "rb") as f:
        # 只读尾部 4MB，避免大日志全量扫描
        if size > 4 * 1024 * 1024:
            f.seek(size - 4 * 1024 * 1024)
            f.readline()
        tail = f.read().decode("utf-8", errors="replace")

    for line in tail.splitlines():
        m = _TOOL_EXEC_RE.search(line)
        if not m:
            continue
        name = m.group(1)
        entry = stats.setdefault(name, {
            "toolName": name,
            "totalCalls": 0,
            "successCalls": 0,
            "failedCalls": 0,
            "latencies": [],
            "lastCalledAt": None,
        })
        entry["totalCalls"] += 1
        entry["successCalls"] += 1  # 日志中为执行发起记录，失败由 error 行计入
        ts_match = re.search(r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})", line)
        if ts_match:
            entry["lastCalledAt"] = ts_match.group(1)
    return stats


@router.get("/usage")
async def get_tool_usage() -> dict[str, Any]:
    """获取工具使用统计（内存指标 + 日志解析，真实数据）。"""
    stats: dict[str, dict[str, Any]] = {}

    # 1) 内存指标（当前进程内真实工具调用）
    try:
        from flowforge.core import metrics as core_metrics
        for name, m in core_metrics.get_tool_stats().items():
            call_count = int(m.get("call_count", 0))
            error_count = int(m.get("error_count", 0))
            avg_ms = round(float(m.get("avg_duration", 0) or 0) * 1000, 1)
            stats[name] = {
                "toolName": name,
                "category": _category_for(name),
                "totalCalls": call_count,
                "successCalls": max(call_count - error_count, 0),
                "failedCalls": error_count,
                "avgLatencyMs": avg_ms,
                "lastCalledAt": None,
            }
    except Exception:  # noqa: BLE001 — metrics 不可用时跳过内存源
        pass

    # 2) 日志解析（持久化补充：内存中没有的工具）
    for name, entry in _parse_log_tools().items():
        if name in stats:
            continue
        stats[name] = {
            "toolName": name,
            "category": _category_for(name),
            "totalCalls": entry["totalCalls"],
            "successCalls": entry["successCalls"],
            "failedCalls": entry["failedCalls"],
            "avgLatencyMs": 0,
            "lastCalledAt": entry["lastCalledAt"],
        }

    items = sorted(stats.values(), key=lambda s: s["totalCalls"], reverse=True)
    return {
        "stats": items,
        "total_calls": sum(s["totalCalls"] for s in items),
        "total_errors": sum(s["failedCalls"] for s in items),
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
