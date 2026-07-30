"""Voice API — 语音配置（Web Fusion Phase 8 stub）.

对应设计文档 §10.2：
    - ``GET /api/v1/voice/config``  — 语音配置
    - ``PUT /api/v1/voice/config``  — 更新语音配置
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/voice", tags=["voice"])


class VoiceConfigUpdate(BaseModel):
    """语音配置更新请求体。"""

    enabled: bool | None = Field(default=None)
    tts_provider: str | None = Field(default=None)
    stt_provider: str | None = Field(default=None)
    default_voice: str | None = Field(default=None)
    language: str | None = Field(default=None)


@router.get("/config")
async def get_voice_config() -> dict[str, Any]:
    """获取语音配置（stub 返回默认配置）。"""
    return {
        "enabled": False,
        "tts_provider": None,
        "stt_provider": None,
        "default_voice": None,
        "language": "zh-CN",
        "status": "stub",
    }


@router.put("/config")
async def update_voice_config(payload: VoiceConfigUpdate) -> dict[str, Any]:
    """更新语音配置（stub 返回确认）。"""
    return {
        "updated": True,
        "fields": payload.model_dump(exclude_none=True),
        "status": "stub",
    }
