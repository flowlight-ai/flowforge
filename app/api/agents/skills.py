"""Skills API — 技能管理（从 prompts.yaml / plugins.yaml 读取真实数据）.

对应前端 SkillsSection 组件契约：
    GET  /api/v1/skills  — Skill 列表
    POST /api/v1/skills  — 创建/注册 Skill
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml
from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("api.skills")

router = APIRouter(prefix="/skills", tags=["skills"])


class SkillCreate(BaseModel):
    """Skill 创建请求体。"""

    name: str = Field(..., min_length=1)
    description: str | None = Field(default=None)
    version: str = Field(default="0.1.0")
    entry: str | None = Field(default=None, description="入口标识")
    config: dict[str, Any] = Field(default_factory=dict)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat() + "Z"


def _get_config_path() -> Path:
    """获取 config 目录路径（铁律 5 禁止硬编码路径）。"""
    return Path(__file__).resolve().parents[3] / "config"


def _load_skills() -> list[dict[str, Any]]:
    """从 prompts.yaml 和 plugins.yaml 加载技能列表。"""
    skills: list[dict[str, Any]] = []
    config_dir = _get_config_path()

    # 从 prompts.yaml 读取提示词模板作为技能
    prompts_file = config_dir / "prompts.yaml"
    if prompts_file.exists():
        try:
            with open(prompts_file, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
            for key, template in data.items():
                if isinstance(template, str) and len(template) > 20:
                    skills.append({
                        "id": f"prompt:{key}",
                        "name": key,
                        "description": template[:100].replace("\n", " ").strip(),
                        "version": "1.0.0",
                        "installed": True,
                        "type": "prompt",
                    })
        except Exception as e:
            logger.warning("Failed to load prompts.yaml: %s", e)

    # 从 plugins.yaml 读取插件作为技能
    plugins_file = config_dir / "plugins.yaml"
    if plugins_file.exists():
        try:
            with open(plugins_file, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
            plugins = data.get("plugins", [])
            for p in plugins:
                if isinstance(p, dict):
                    name = p.get("name", "")
                    skills.append({
                        "id": f"skill:{name}",
                        "name": name,
                        "description": p.get("description", ""),
                        "version": "0.1.0",
                        "installed": True,
                        "type": "tool",
                        "tags": p.get("tags", []),
                    })
        except Exception as e:
            logger.warning("Failed to load plugins.yaml: %s", e)

    return skills


@router.get("")
async def list_skills(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    """列出 Skill（从 prompts.yaml / plugins.yaml 读取）。"""
    all_skills = _load_skills()
    paginated = all_skills[offset:offset + limit]
    return {"items": paginated, "total": len(all_skills), "limit": limit, "offset": offset}


@router.post("")
async def create_skill(payload: SkillCreate) -> dict[str, Any]:
    """创建 Skill（返回占位对象，持久化需后续支持）。"""
    return {
        "id": f"skill_{int(datetime.now(timezone.utc).timestamp())}",
        "name": payload.name,
        "description": payload.description,
        "version": payload.version,
        "entry": payload.entry,
        "config": payload.config,
        "status": "registered",
        "created_at": _now(),
    }