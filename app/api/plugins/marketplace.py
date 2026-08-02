"""Marketplace API — 市场搜索（Web Fusion Phase 8 stub）.

对应设计文档 §10.2：
    - ``POST /api/v1/marketplace/search``  — 市场搜索
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/marketplace", tags=["marketplace"])


class MarketplaceSearchRequest(BaseModel):
    """市场搜索请求体。"""

    query: str = Field(default="", description="搜索关键词")
    category: str | None = Field(default=None, description="分类过滤")
    tags: list[str] = Field(default_factory=list, description="标签过滤")
    limit: int = Field(default=20, ge=1, le=100)
    offset: int = Field(default=0, ge=0)


@router.post("/search")
async def search_marketplace(payload: MarketplaceSearchRequest) -> dict[str, Any]:
    """搜索市场（stub 返回空结果）。"""
    return {
        "query": payload.query,
        "category": payload.category,
        "tags": payload.tags,
        "items": [],
        "total": 0,
        "limit": payload.limit,
        "offset": payload.offset,
    }
