"""花名册加载器（Roster Loader）— 从 YAML 加载预置Forgekin配置.

提供:
- BUILTIN_FORGEKINS: 9 只预置Forgekin ID 清单（F046 v1.1 五闭环扩展 + F041/042 + 专属态）
- ROSTER_FILES: ID → YAML 文件路径映射
- load_forgekin_config(forgekin_id): 加载单个Forgekin配置
- list_builtin_forgekins(): 列出所有预置Forgekin元信息

配置驱动（铁律5+P16）: 所有Forgekin配置外置到 YAML,不在 .py 中硬编码.

九Forgekin（5 通用 + 4 新增）：
- wenxin（文心, doc, E3）— 文档员 → OpenCode CLI
- sherlock（夏洛克, code, E4）— 开发者 → Codex CLI
- luban（鲁班, framework, E5）— 架构师 → Gemini CLI
- vangogh（梵高, review, E3）— 审查员 → Claude Code CLI（ccr-router）
- davinci（达芬奇, test, E3）— 测试员 → CodeBuddy CLI
- keane（鹰·凯恩, product, E3）— 产品经理（F041）→ iFlow CLI
- humming（蜂鸟·闪电, ops, E3）— 运维（F042）→ OpenCode CLI
- sqrl（铃鼓, coder, E3）— 开源程序员（专属态）→ OpenCode CLI
- butterfly（幻蝶, bridge, E3）— Trae 桥接（F045）→ Trae CN 文件桥接
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

_ROSTER_DIR = Path(__file__).resolve().parent

# 9 只预置Forgekin（F046 v1.1 §9.2 五闭环 + F041/F042 角色 + F045 桥接 + 专属态）
BUILTIN_FORGEKINS: list[str] = [
    "wenxin", "sherlock", "luban", "vangogh", "davinci",
    "keane", "humming", "sqrl", "butterfly",
]

ROSTER_FILES: dict[str, Path] = {
    "wenxin": _ROSTER_DIR / "wenxin.yaml",
    "sherlock": _ROSTER_DIR / "sherlock.yaml",
    "luban": _ROSTER_DIR / "luban.yaml",
    "vangogh": _ROSTER_DIR / "vangogh.yaml",
    "davinci": _ROSTER_DIR / "davinci.yaml",
    "keane": _ROSTER_DIR / "keane.yaml",
    "humming": _ROSTER_DIR / "humming.yaml",
    "sqrl": _ROSTER_DIR / "sqrl.yaml",
    "butterfly": _ROSTER_DIR / "butterfly.yaml",
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
                "llm_model": cfg.get("llm", {}).get("model", ""),
                "llm_mode": cfg.get("llm", {}).get("mode", "cli"),
            })
        except Exception:  # noqa: BLE001
            summary.append({"id": fid, "error": "config_load_failed"})
    return summary
