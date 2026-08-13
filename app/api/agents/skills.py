"""Skills API — 技能管理（从 prompts.yaml / plugins.yaml 读取真实数据）.

对应前端 SkillsSection 组件契约：
    GET  /api/v1/skills  — Skill 列表
    POST /api/v1/skills  — 创建/注册 Skill
"""

from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml
from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("api.skills")

router = APIRouter(prefix="/skills", tags=["skills"])

_lock = threading.Lock()


class SkillCreate(BaseModel):
    """Skill 创建请求体。"""

    name: str = Field(..., min_length=1)
    description: str | None = Field(default=None)
    version: str = Field(default="0.1.0")
    entry: str | None = Field(default=None, description="入口标识")
    config: dict[str, Any] = Field(default_factory=dict)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _get_config_path() -> Path:
    """获取 config 目录路径（铁律 5 禁止硬编码路径）。"""
    return Path(__file__).resolve().parents[3] / "config"


def _custom_file() -> Path:
    """自定义 Skill 持久化文件。"""
    return Path(__file__).resolve().parents[3] / "data" / "settings" / "skills_custom.json"


def _read_custom() -> list[dict[str, Any]]:
    try:
        data = json.loads(_custom_file().read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def _write_custom(skills: list[dict[str, Any]]) -> None:
    path = _custom_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(skills, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


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
    """列出 Skill（yaml 内置 + 自定义持久化条目）。"""
    custom = _read_custom()
    all_skills = custom + _load_skills()
    paginated = all_skills[offset:offset + limit]
    return {"items": paginated, "total": len(all_skills), "limit": limit, "offset": offset}


@router.post("")
async def create_skill(payload: SkillCreate) -> dict[str, Any]:
    """创建 Skill（持久化到 data/settings/skills_custom.json）。"""
    entry = {
        "id": f"skill_{int(datetime.now(timezone.utc).timestamp())}",
        "name": payload.name,
        "description": payload.description,
        "version": payload.version,
        "entry": payload.entry,
        "config": payload.config,
        "installed": True,
        "type": "custom",
        "status": "registered",
        "created_at": _now(),
    }
    with _lock:
        custom = _read_custom()
        custom.insert(0, entry)
        _write_custom(custom)
    logger.info(f"skills: 已创建并持久化 Skill {payload.name}")
    return entry