"""External Agents API — 外部接入智能体状态检查。

对应前端 ExternalAgentList 组件契约：
    GET /api/v1/external-agents  — 返回各外部智能体连通性状态 + 绑定关系

检查方式：通过 shutil.which 检测 CLI 命令是否在 PATH 中可用。
    - pass:  CLI 命令可用
    - skip:  IDE 集成型，仅在 IDE 内可用（如 trae）
    - fail:  CLI 命令不可用

绑定关系：扫描所有 Forgekin YAML，匹配 llm.provider == agent_id，
返回 bound_forgekins 列表（含 forgekin id 和 name）。

设计依据：
    - WEB-FUSION-DESIGN.md §6.3 外部接入智能体
    - 铁律 5：禁止硬编码密钥（本端点不涉及密钥）
    - 铁律 3：依赖通过构造函数注入（本端点无外部依赖）
"""

from __future__ import annotations

import shutil
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter

from flowforge.core.tracing import get_trace_id, get_logger
from flowforge.forgemind.forgekins import BUILTIN_FORGEKINS, load_forgekin_config

logger = get_logger("api.external_agents")

router = APIRouter(prefix="/external-agents", tags=["external-agents"])


# 外部智能体定义（agent_id → CLI 命令名 + 展示信息）
# 此映射属于框架级能力发现，非业务领域代码（铁律 10 不适用）
_EXTERNAL_AGENTS: list[dict[str, str]] = [
    {
        "id": "claude_code",
        "name": "Claude Code",
        "cli_command": "claude",
        "description": "Anthropic Claude CLI 编码助手",
        "kind": "cli",
    },
    {
        "id": "codex",
        "name": "Codex",
        "cli_command": "codex",
        "description": "OpenAI Codex CLI 编码助手",
        "kind": "cli",
    },
    {
        "id": "opencode",
        "name": "OpenCode",
        "cli_command": "opencode",
        "description": "开源编码助手",
        "kind": "cli",
    },
    {
        "id": "trae",
        "name": "Trae",
        "cli_command": "trae",
        "description": "Trae IDE 集成（仅 IDE 内可用）",
        "kind": "ide",
    },
    {
        "id": "gemini",
        "name": "Gemini",
        "cli_command": "gemini",
        "description": "Google Gemini CLI 编码助手",
        "kind": "cli",
    },
    {
        "id": "codebuddy",
        "name": "CodeBuddy",
        "cli_command": "codebuddy",
        "description": "腾讯 CodeBuddy 编码助手",
        "kind": "cli",
    },
    {
        "id": "qodercli",
        "name": "Qoder CLI",
        "cli_command": "qodercli",
        "description": "Qoder 云编码助手（需 Qoder 账号登录）",
        "kind": "cli",
    },
    {
        "id": "iflow",
        "name": "iFlow CLI",
        "cli_command": "iflow",
        "description": "iFlow CLI（OpenAI-Compatible API）",
        "kind": "cli",
    },
    {
        "id": "kimi",
        "name": "Kimi CLI",
        "cli_command": "kimi",
        "description": "月之暗面 Kimi CLI 编码助手",
        "kind": "cli",
    },
    {
        "id": "trae_cn_ide",
        "name": "Trae CN IDE",
        "cli_command": "trae",
        "description": "Trae CN IDE 集成（仅 IDE 内可用）",
        "kind": "ide",
    },
]


def _load_bound_forgekins() -> dict[str, list[dict[str, str]]]:
    """扫描所有 Forgekin 配置，构建 provider → bound_forgekins 映射。

    Returns:
        {provider_id: [{id, name, model}, ...]}
    """
    binding_map: dict[str, list[dict[str, str]]] = {}
    for fid in BUILTIN_FORGEKINS:
        try:
            cfg = load_forgekin_config(fid)
        except Exception:  # noqa: BLE001
            continue
        llm = cfg.get("llm", {})
        provider = llm.get("provider", "")
        if not provider:
            continue
        binding_map.setdefault(provider, []).append({
            "id": fid,
            "name": cfg.get("name", fid),
            "model": llm.get("model", ""),
            "mode": llm.get("mode", "cli"),
        })
    return binding_map


def _check_agent_status(agent: dict[str, str]) -> dict[str, Any]:
    """检查单个外部智能体的连通性。

    Args:
        agent: 智能体定义字典（含 id, cli_command, kind）。

    Returns:
        状态字典：{id, status, reason?}
    """
    agent_id = agent["id"]
    kind = agent.get("kind", "cli")

    # IDE 集成型智能体始终返回 skip（仅在 IDE 内可用）
    if kind == "ide":
        logger.info("external_agent.skip id=%s reason=ide_only", agent_id)
        return {
            "id": agent_id,
            "status": "skip",
            "reason": "IDE 集成型，仅在 IDE 内可用",
        }

    cli_command = agent.get("cli_command", "")
    if not cli_command:
        return {
            "id": agent_id,
            "status": "fail",
            "reason": "未配置 CLI 命令",
        }

    found_path = shutil.which(cli_command)
    if found_path:
        logger.info(
            "external_agent.pass id=%s command=%s path=%s",
            agent_id, cli_command, found_path,
        )
        return {
            "id": agent_id,
            "status": "pass",
            "reason": f"CLI 可用: {found_path}",
        }

    logger.warning(
        "external_agent.fail id=%s command=%s reason=not_in_path",
        agent_id, cli_command,
    )
    return {
        "id": agent_id,
        "status": "fail",
        "reason": f"CLI 命令 '{cli_command}' 不在 PATH 中",
    }


@router.get("")
async def list_external_agents() -> dict[str, Any]:
    """返回所有外部接入智能体的连通性状态与绑定关系。

    响应格式：
        {
            "agents": [
                {
                    "id": "claude_code", "status": "pass", "reason": "...",
                    "name": "Claude Code", "description": "...",
                    "bound_forgekins": [{"id": "vangogh", "name": "梵高", ...}]
                },
                ...
            ],
            "total": 10
        }
    """
    binding_map = _load_bound_forgekins()
    agents_status: list[dict[str, Any]] = []
    for agent in _EXTERNAL_AGENTS:
        status = _check_agent_status(agent)
        bound = binding_map.get(agent["id"], [])
        status["name"] = agent["name"]
        status["description"] = agent["description"]
        status["bound_forgekins"] = bound
        status["bound_count"] = len(bound)
        agents_status.append(status)

    logger.info(
        "external_agents.list total=%d pass=%d skip=%d fail=%d bound=%d",
        len(agents_status),
        sum(1 for a in agents_status if a["status"] == "pass"),
        sum(1 for a in agents_status if a["status"] == "skip"),
        sum(1 for a in agents_status if a["status"] == "fail"),
        sum(a["bound_count"] for a in agents_status),
    )
    return {
        "agents": agents_status,
        "total": len(agents_status),
        "meta": {
            "trace_id": get_trace_id(),
            "timestamp": datetime.now(timezone.utc).isoformat() + "Z",
        },
    }
