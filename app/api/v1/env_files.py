"""Env Files API — 环境文件管理（Web Fusion Phase 8 stub）.

对应设计文档 §10.2：
    - ``GET /api/v1/env/files``  — 环境文件列表
    - ``PUT /api/v1/env/files``  — 更新环境文件
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/env", tags=["env-files"])


class EnvFileUpdate(BaseModel):
    """环境文件更新请求体。"""

    filename: str = Field(..., description="文件名（如 .env）")
    content: str = Field(default="", description="文件内容")
    merge: bool = Field(default=False, description="是否合并而非覆盖")


@router.get("/files")
async def list_env_files() -> dict[str, Any]:
    """列出环境文件（stub 返回空列表）。"""
    return {"items": [], "total": 0}


@router.put("/files")
async def update_env_file(payload: EnvFileUpdate) -> dict[str, Any]:
    """更新环境文件（stub 返回确认，不写入磁盘）。"""
    return {
        "filename": payload.filename,
        "bytes_written": len(payload.content),
        "merged": payload.merge,
        "updated": True,
        "status": "stub",
    }
