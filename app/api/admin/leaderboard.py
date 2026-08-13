"""Leaderboard API — 排行榜（真实统计）。

对应设计文档 §10.2：
    - ``GET /api/v1/leaderboard``  — 排行榜

数据源（真实）：
    - ``data/forgemind/swarm_trace.jsonl`` — Forgekin 群集轨迹
      （submit/dispatch/fail 三类记录，按 agent_id 聚合统计）

前端 HubLeaderboardTab 期望响应格式：
    {
        "metric": "tasks" | "token" | "quality" | "uptime",
        "entries": LeaderboardEntry[]
    }
"""

from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from fastapi import APIRouter, Query

router = APIRouter(prefix="/leaderboard", tags=["leaderboard"])

_ROOT = Path(__file__).resolve().parents[3]
_LOCK = threading.Lock()
_TRACE_PATH = _ROOT / "data" / "forgemind" / "swarm_trace.jsonl"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _parse_ts(ts: str) -> float:
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
    except (ValueError, TypeError):
        return 0.0


def _collect_stats() -> dict[str, dict[str, Any]]:
    """从 swarm_trace.jsonl 聚合每个 Forgekin 的 dispatch/fail/submit 统计。"""
    agents: dict[str, dict[str, Any]] = {}
    if not _TRACE_PATH.exists():
        return agents

    with _LOCK:
        with open(_TRACE_PATH, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue
                agent_id = rec.get("agent_id") or ""
                if not agent_id:
                    continue  # submit 记录无 agent_id，跳过
                action = rec.get("action", "")
                ts = _parse_ts(rec.get("dispatched_at", ""))
                entry = agents.setdefault(agent_id, {
                    "agent_id": agent_id,
                    "dispatch": 0,
                    "fail": 0,
                    "submit": 0,
                    "first_ts": ts or None,
                    "last_ts": ts or None,
                })
                if action == "dispatch":
                    entry["dispatch"] += 1
                elif action == "fail":
                    entry["fail"] += 1
                elif action == "submit":
                    entry["submit"] += 1
                if ts:
                    if entry["first_ts"] is None or ts < entry["first_ts"]:
                        entry["first_ts"] = ts
                    if entry["last_ts"] is None or ts > entry["last_ts"]:
                        entry["last_ts"] = ts
    return agents


def _agent_meta(agent_id: str) -> tuple[str, str]:
    """返回 (名称, 物种)。agent_id 形如 forgemind:wenxin → (wenxin, forgemind)。"""
    if ":" in agent_id:
        prefix, name = agent_id.split(":", 1)
        return name, prefix
    return agent_id, "forgekin"


def _build_entries(metric: str, agents: dict[str, dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    rows = []
    for agent_id, s in agents.items():
        name, species = _agent_meta(agent_id)
        dispatch = s["dispatch"]
        fail = s["fail"]
        success = max(dispatch - fail, 0)
        if metric == "tasks":
            value = float(dispatch)
        elif metric == "quality":
            value = round(success / dispatch, 4) if dispatch > 0 else 0.0
        elif metric == "uptime":
            value = round((s["last_ts"] or 0) - (s["first_ts"] or 0), 1)
        elif metric == "token":
            # 无持久化 token 计量，回退为任务数（真实可验证口径）
            value = float(dispatch)
        else:
            value = 0.0
        rows.append({
            "rank": 0,
            "forgekinId": agent_id,
            "forgekinName": name,
            "species": species,
            "metricValue": value,
            "delta": dispatch - fail,
        })
    rows.sort(key=lambda r: r["metricValue"], reverse=True)
    for i, r in enumerate(rows, start=1):
        r["rank"] = i
    return rows[:limit]


@router.get("")
async def get_leaderboard(
    metric: str = Query(default="tasks", description="排行指标: tasks|token|quality|uptime"),
    limit: int = Query(50, ge=1, le=200),
) -> dict[str, Any]:
    """获取排行榜（从 swarm_trace 真实统计）。"""
    if metric not in ("tasks", "token", "quality", "uptime"):
        metric = "tasks"
    agents = _collect_stats()
    entries = _build_entries(metric, agents, limit)
    return {
        "metric": metric,
        "entries": entries,
        "total": len(entries),
        "limit": limit,
        "generated_at": _now(),
    }
