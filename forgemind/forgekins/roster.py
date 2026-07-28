"""花名册加载器（Roster Loader）— 从 YAML 加载预置Forgekin配置.

提供:
- BUILTIN_FORGEKINS: 5 只预置Forgekin ID 清单（F046 v1.1 五闭环扩展）
- ROSTER_FILES: ID → YAML 文件路径映射
- load_forgekin_config(forgekin_id): 加载单个Forgekin配置
- list_builtin_forgekins(): 列出所有预置Forgekin元信息

配置驱动（铁律5+P16）: 所有Forgekin配置外置到 YAML,不在 .py 中硬编码.

五Forgekin（F046 v1.1 §9.2）：
- wenxin（文心, doc, E3）— 文档员
- sherlock（夏洛克, code, E4）— 开发者
- luban（鲁班, framework, E5）— 架构师
- vangogh（梵高, review, E3）— 审查员
- davinci（达芬奇, test, E3）— 测试员
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

_ROSTER_DIR = Path(__file__).resolve().parent

# 5 只预置Forgekin（F046 v1.1 §9.2 五闭环扩展：原 3 只 → 5 只）
# 参考 3 agent → 5 agent sweet spot 模式
BUILTIN_FORGEKINS: list[str] = ["wenxin", "sherlock", "luban", "vangogh", "davinci"]

ROSTER_FILES: dict[str, Path] = {
    "wenxin": _ROSTER_DIR / "wenxin.yaml",
    "sherlock": _ROSTER_DIR / "sherlock.yaml",
    "luban": _ROSTER_DIR / "luban.yaml",
    "vangogh": _ROSTER_DIR / "vangogh.yaml",
    "davinci": _ROSTER_DIR / "davinci.yaml",
}


def load_forgekin_config(forgekin_id: str) -> dict[str, Any]:
    """加载单个预置Forgekin的 YAML 配置.

    Args:
        forgekin_id: Forgekin ID（如 "luban"）

    Returns:
        完整的Forgekin配置字典

    Raises:
        KeyError: 未知 forgekin_id
        FileNotFoundError: YAML 文件不存在
    """
    if forgekin_id not in ROSTER_FILES:
        raise KeyError(
            f"未知预置Forgekin ID: {forgekin_id}. "
            f"可用: {list(ROSTER_FILES.keys())}"
        )
    path = ROSTER_FILES[forgekin_id]
    if not path.exists():
        raise FileNotFoundError(f"花名册 YAML 不存在: {path}")
    with path.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def list_builtin_forgekins() -> list[dict[str, Any]]:
    """列出所有预置Forgekin的元信息（不含完整配置）.

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
                "mention_patterns": cfg.get("mention_patterns", []),
                "avatar": cfg.get("avatar", ""),
                "color": cfg.get("color", {}),
                "breed": cfg.get("breed", ""),
                "llm_provider": cfg.get("llm", {}).get("provider", "trae"),
            })
        except Exception:  # noqa: BLE001
            summary.append({"id": fid, "error": "config_load_failed"})
    return summary
