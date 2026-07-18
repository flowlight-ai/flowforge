"""花名册加载器（Roster Loader）— 从 YAML 加载预置灵智体配置.

提供:
- BUILTIN_FORGEKINS: 3 只预置灵智体 ID 清单
- ROSTER_FILES: ID → YAML 文件路径映射
- load_forgekin_config(forgekin_id): 加载单个灵智体配置
- list_builtin_forgekins(): 列出所有预置灵智体元信息

配置驱动（铁律5+P16）: 所有灵智体配置外置到 YAML,不在 .py 中硬编码.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

_ROSTER_DIR = Path(__file__).resolve().parent

# 3 只预置灵智体（参考 clowder-ai 最初的 3 只猫）
BUILTIN_FORGEKINS: list[str] = ["luban", "sherlock", "vangogh"]

ROSTER_FILES: dict[str, Path] = {
    "luban": _ROSTER_DIR / "luban.yaml",
    "sherlock": _ROSTER_DIR / "sherlock.yaml",
    "vangogh": _ROSTER_DIR / "vangogh.yaml",
}


def load_forgekin_config(forgekin_id: str) -> dict[str, Any]:
    """加载单个预置灵智体的 YAML 配置.

    Args:
        forgekin_id: 灵智体 ID（如 "luban"）

    Returns:
        完整的灵智体配置字典

    Raises:
        KeyError: 未知 forgekin_id
        FileNotFoundError: YAML 文件不存在
    """
    if forgekin_id not in ROSTER_FILES:
        raise KeyError(
            f"未知预置灵智体 ID: {forgekin_id}. "
            f"可用: {list(ROSTER_FILES.keys())}"
        )
    path = ROSTER_FILES[forgekin_id]
    if not path.exists():
        raise FileNotFoundError(f"花名册 YAML 不存在: {path}")
    with path.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def list_builtin_forgekins() -> list[dict[str, Any]]:
    """列出所有预置灵智体的元信息（不含完整配置）.

    Returns:
        元信息字典列表,每项含 id/name/nickname/species/role/availability
    """
    summary: list[dict[str, Any]] = []
    for fid in BUILTIN_FORGEKINS:
        try:
            cfg = load_forgekin_config(fid)
            summary.append({
                "id": fid,
                "name": cfg.get("name", ""),
                "nickname": cfg.get("nickname", ""),
                "species": cfg.get("species", ""),
                "role": cfg.get("role", {}),
                "available": cfg.get("available", True),
            })
        except Exception:  # noqa: BLE001
            summary.append({"id": fid, "error": "config_load_failed"})
    return summary
