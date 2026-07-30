"""Leaderboard API — 排行榜（Web Fusion Phase 8 stub）.

对应设计文档 §10.2：
    - ``GET /api/v1/leaderboard``  — 排行榜

前端 HubLeaderboardTab 期望响应格式：
    {
        "metric": "tasks" | "token" | "quality" | "uptime",
        "entries": LeaderboardEntry[]
    }
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

router = APIRouter(prefix="/leaderboard", tags=["leaderboard"])


@router.get("")
async def get_leaderboard(
    metric: str = Query(default="tasks", description="排行指标: tasks|token|quality|uptime"),
    limit: int = Query(50, ge=1, le=200),
) -> dict[str, Any]:
    """获取排行榜（stub 返回空列表）。

    前端期望字段为 ``entries``（非 ``items``），metric 取值为
    ``tasks``/``token``/``quality``/``uptime``（非 ``tasks_completed``）。
    """
    return {
        "metric": metric,
        "entries": [],
        "total": 0,
        "limit": limit,
        "status": "stub",
    }
