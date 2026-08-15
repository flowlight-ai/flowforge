"""Forgekin Council — utility functions, path constants, and lazy loaders.

Extracted from the original monolithic ``council.py``.

This module imports state holders and dataclasses from :mod:`council_state`
(one-way dependency — ``council_state`` does **not** import from here, so
there is no circular import).

Public surface:
- Path constants: ``PROJECT_ROOT``, ``CONFIG_DIR``, ``FORGEKINS_DIR``, ``WORKFLOWS_DIR``.
- Persona constants: ``AVATARS``, ``_PERSONA_TO_FORGEKIN``.
- Env/YAML helpers: ``_bool_env``, ``_upsert_env_var``, ``_load_yaml``, ``_env``.
- Forgekin helpers: ``_load_forgekins``, ``_forgekin_profile``, ``_route_message``,
  ``_find_forgekin_cfg``.
- Lazy singletons: ``_get_forgekins`` (loads YAML + seeds greetings),
  ``_get_bridge`` (builds :class:`ForgekinLLMBridge`).
"""

from __future__ import annotations

import os
import re
import uuid
from pathlib import Path
from typing import Any

import yaml

from flowforge.core.tracing import get_logger
from flowforge.llm.council_bridge import ForgekinLLMBridge

from .council_state import (
    ChatMessage,
    bridge_holder,
    forgekins_holder,
    state,
)

logger = get_logger("flowforge.app.api.agents.council_helpers")


# ── Path constants ───────────────────────────────────────────────────────────
# agents/ → api/ → app/ → flowforge/  (project root = flowforge package)
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
CONFIG_DIR = PROJECT_ROOT / "config"
FORGEKINS_DIR = CONFIG_DIR / "forgekins"
WORKFLOWS_DIR = CONFIG_DIR / "workflows"


# ── Forgekin persona constants ───────────────────────────────────────────────

AVATARS = {
    "fk-wenxin": "📝",  # 文心 — doc
    "fk-sherlock": "🔍",  # 夏洛克 — code
    "fk-vangogh": "🎨",  # 梵高 — review
    "fk-davinci": "🧪",  # 达芬奇 — test
    "fk-luban": "🔨",  # 鲁班 — framework
    "operator": "👤",
}

_PERSONA_TO_FORGEKIN = {
    "doc": "fk-wenxin",
    "code": "fk-sherlock",
    "framework": "fk-luban",
    "test": "fk-davinci",
    "review": "fk-vangogh",
}


# ── Env / YAML helpers ──────────────────────────────────────────────────────

def _bool_env(name: str, default: bool = False) -> bool:
    val = os.environ.get(name, str(default))
    return val.strip().lower() in {"1", "true", "yes", "on"}


def _upsert_env_var(env_path: Path, key: str, value: str) -> None:
    """Insert or update a KEY=value line in a .env file (铁律 5 — secrets in .env).

    If the file doesn't exist, it's created. If the key already exists, the
    value is updated in place. Otherwise the new key is appended.
    """
    lines: list[str] = []
    found = False
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith(f"{key}=") or line.strip() == key:
                lines.append(f'{key}="{value}"')
                found = True
            else:
                lines.append(line)
    if not found:
        lines.append(f'{key}="{value}"')
    env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _load_yaml(path: Path) -> dict[str, Any]:
    """Load a YAML file into a dict (returns {} for missing files)."""
    if not path.exists():
        return {}
    with path.open(encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    return data if isinstance(data, dict) else {}


def _env(name: str, default: str = "") -> str:
    """Read an environment variable, stripping surrounding whitespace."""
    val = os.environ.get(name, default)
    return val.strip() if isinstance(val, str) else default


def _load_forgekins() -> dict[str, dict]:
    """Load 5 forgekin YAML configs from config/forgekins/."""
    forgekins: dict[str, dict] = {}
    for path in sorted(FORGEKINS_DIR.glob("*.yaml")):
        with path.open(encoding="utf-8") as f:
            cfg = yaml.safe_load(f)
        if cfg and "forgekin_id" in cfg:
            forgekins[path.stem] = cfg
    return forgekins


# ── Forgekin persona helpers ─────────────────────────────────────────────────

def _forgekin_profile(fk_cfg: dict) -> dict:
    """Extract UI-relevant fields from a forgekin config."""
    fk_id = fk_cfg["forgekin_id"]
    return {
        "id": fk_id,
        "name": fk_cfg["name"],
        "alias": fk_cfg.get("alias", ""),
        "vendor": fk_cfg["vendor"],
        "forgekin_type": fk_cfg["forgekin_type"],
        "avatar": AVATARS.get(fk_id, "🤖"),
        "loop_type": fk_cfg["self_dev_loop"]["loop_type"],
        "awakening_stage": fk_cfg["self_dev_loop"]["awakening_stage"],
        "online": True,
        "energy": fk_cfg.get("energy", {}).get("initial", 1.0),
        "greeting": fk_cfg.get("persona", {}).get("greeting", ""),
        "catchphrase": fk_cfg.get("persona", {}).get("catchphrase", ""),
        "working_style": fk_cfg.get("persona", {}).get("working_style", ""),
        "can_review": fk_cfg.get("council_role", {}).get("can_review", False),
        "requires_approval": fk_cfg.get("self_dev_loop", {}).get("requires_manual_approval", False),
        "capabilities": [c["name"] for c in fk_cfg.get("capabilities", [])],
    }


# ── @mention routing tables (参考 clowder-ai AgentRouter) ─────────────────────

# forgekin_id => 所有可能的 @ 名称(小写),用于 @mention 解析
_MENTION_MAP: dict[str, list[str]] = {
    "fk-wenxin": ["wenxin", "文心", "fk-wenxin"],
    "fk-sherlock": ["sherlock", "夏洛克", "fk-sherlock"],
    "fk-luban": ["luban", "鲁班", "fk-luban"],
    "fk-vangogh": ["vangogh", "梵高", "fk-vangogh"],
    "fk-davinci": ["davinci", "达芬奇", "fk-davinci"],
    "fk-keane": ["keane", "凯恩", "fk-keane"],
    "fk-humming": ["humming", "蜂鸟", "fk-humming"],
    "fk-sqrl": ["sqrl", "铃鼓", "fk-sqrl"],
    "fk-butterfly": ["butterfly", "幻蝶", "fk-butterfly"],
}
# 触发"全员并行讨论"的关键词(小写)
_ALL_MENTION_KEYWORDS: list[str] = ["all", "全体", "所有人", "thread", "本帖", "所有"]


def _find_recent_forgekin(recent_messages: list) -> str | None:
    """从消息历史中找出最近一条由灵智体回复的 author_id,找不到返回 None。"""
    for msg in reversed(recent_messages or []):
        # 兼容 ChatMessage dataclass 与 dict 两种形态
        role = getattr(msg, "author_role", None)
        if role is None and isinstance(msg, dict):
            role = msg.get("author_role")
        if role == "forgekin":
            author_id = getattr(msg, "author_id", None)
            if author_id is None and isinstance(msg, dict):
                author_id = msg.get("author_id")
            if author_id:
                return author_id
    return None


def _parse_mentions(content: str, mentions: list[str]) -> list[str]:
    """合并前端传入的 mentions 与从 content 扫描出的 @token,统一小写去重。"""
    tokens: list[str] = [m.lower() for m in (mentions or [])]
    for match in re.findall(r"@([^\s@]+)", content or ""):
        tokens.append(match.lower())
    seen: set[str] = set()
    unique: list[str] = []
    for tok in tokens:
        if tok and tok not in seen:
            seen.add(tok)
            unique.append(tok)
    return unique


def _route_message(
    content: str,
    forgekins: dict[str, dict],
    mentions: list[str] | None = None,
    recent_messages: list | None = None,
) -> list[dict]:
    """基于 @mention 规则决定哪些灵智体回复。

    路由规则(参考 clowder-ai AgentRouter):
    1. @all/@全体/@thread/@本帖 → 所有灵智体并行讨论(ideate 模式)
    2. @具体灵智体名(如 @文心/@wenxin/@fk-wenxin) → 仅该灵智体回复
    3. 无 @mention → 路由到"最近回复的灵智体"(fallback 到默认主灵智体 fk-wenxin)

    Returns list of {forgekin_id, role, delay_ms, strategy} dicts.
    strategy: "serial"(默认) | "parallel"(@all 时并行讨论)
    """
    all_tokens = _parse_mentions(content, mentions or [])
    recent_fk = _find_recent_forgekin(recent_messages or [])
    default_primary = recent_fk or "fk-wenxin"

    # 规则1: @all → 所有 9 个灵智体并行讨论
    if any(tok in _ALL_MENTION_KEYWORDS for tok in all_tokens):
        routes: list[dict] = []
        for fk_id in _MENTION_MAP:
            role = "primary" if fk_id == default_primary else "discussant"
            routes.append({
                "forgekin_id": fk_id,
                "role": role,
                "delay_ms": 0,
                "strategy": "parallel",
            })
        return routes

    # 规则2: @具体灵智体名 → 仅该灵智体
    for fk_id, aliases in _MENTION_MAP.items():
        if any(tok in aliases for tok in all_tokens):
            return [{
                "forgekin_id": fk_id,
                "role": "primary",
                "delay_ms": 0,
                "strategy": "serial",
            }]

    # 规则3: 无 @mention → 最近回复的灵智体(fallback fk-wenxin)
    return [{
        "forgekin_id": default_primary,
        "role": "primary",
        "delay_ms": 0,
        "strategy": "serial",
    }]


def _find_forgekin_cfg(forgekins: dict[str, dict], fk_id: str) -> dict | None:
    for cfg in forgekins.values():
        if cfg.get("forgekin_id") == fk_id:
            return cfg
    return None


# ── Lazy singletons (populate the holders in council_state) ─────────────────

def _get_forgekins() -> dict[str, dict]:
    """Lazily load forgekin configs and seed greetings on first call.

    On first invocation this loads config/forgekins/*.yaml and posts each
    forgekin's configured greeting to the channel. Subsequent calls return
    the cached dict. Greetings are static config strings (persona.greeting)
    and therefore carry no llm_meta — they are NOT LLM output (T1) and not
    subject to T7.
    """
    if forgekins_holder["cfg"] is None:
        cfg = _load_forgekins()
        forgekins_holder["cfg"] = cfg
        for slug, c in cfg.items():
            greeting = c.get("persona", {}).get("greeting", f"{c['name']} 在线。")
            state.add(ChatMessage(
                message_id=f"msg-{uuid.uuid4().hex[:12]}",
                author_id=c["forgekin_id"],
                author_name=c["name"],
                author_role="forgekin",
                author_avatar=AVATARS.get(c["forgekin_id"], "🤖"),
                content=greeting,
                role="greeting",
            ))
    return forgekins_holder["cfg"]


def _get_bridge() -> ForgekinLLMBridge:
    """Lazily initialize the ForgekinLLMBridge on first request.

    Avoids import-time failures if config files (llm_route.yaml,
    web_chat_prompts.yaml, forgemind.yaml) are missing or malformed.
    """
    if "bridge" not in bridge_holder:
        bridge_holder["bridge"] = ForgekinLLMBridge.from_config(CONFIG_DIR)
    return bridge_holder["bridge"]
