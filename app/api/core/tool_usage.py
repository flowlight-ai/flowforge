"""Tool Usage API — 工具使用统计（Web Fusion Phase 8 stub）.

对应设计文档 §10.2：
    - ``GET /api/v1/tool-usage``  — 工具使用统计
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

router = APIRouter(prefix="/tool-usage", tags=["tool-usage"])


@router.get("")
async def get_tool_usage(
    days: int = Query(default=7, ge=1, le=90, description="统计天数"),
) -> dict[str, Any]:
    """获取工具使用统计（stub 返回空数据）。"""
    return {
        "days": days,
        "items": [],
        "total_calls": 0,
        "total_errors": 0,
        "status": "stub",
    }
