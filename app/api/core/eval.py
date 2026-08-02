"""Eval API — 评估判决与摩擦（Web Fusion Phase 8 stub）.

对应设计文档 §10.2：
    - ``GET /api/v1/eval/verdicts``  — Eval 判决列表
    - ``GET /api/v1/eval/friction``  — Eval 摩擦指标
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

router = APIRouter(prefix="/eval", tags=["eval"])


@router.get("/verdicts")
async def list_verdicts(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    """列出 Eval 判决（stub 返回空列表）。"""
    return {
        "items": [],
        "total": 0,
        "limit": limit,
        "offset": offset,
    }


@router.get("/friction")
async def eval_friction() -> dict[str, Any]:
    """获取 Eval 摩擦指标（stub 返回默认值）。"""
    return {
        "avg_friction_score": 0.0,
        "total_friction_events": 0,
        "top_friction_points": [],
        "status": "stub",
    }
