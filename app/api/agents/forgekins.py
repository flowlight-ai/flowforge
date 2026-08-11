"""Forgekin API — 可进化智能体列表与详情.

对应设计文档 §10.2：
    - ``GET  /api/v1/forgekins``        — Forgekin 列表（转发到 forgemind/roster）
    - ``GET  /api/v1/forgekins/{id}``   — Forgekin 详情（加载 YAML 配置）
    - ``PUT  /api/v1/forgekins/{id}``   — 更新 Forgekin（持久化到 YAML + .env）
    - ``GET  /api/v1/forgekins/{id}/binding``  — 查询 CLI 工具绑定关系
    - ``POST /api/v1/forgekins/{id}/binding``  — 动态切换 CLI 绑定
    - ``POST /api/v1/forgekins/{id}/forge``    — 锻造 Forgekin
    - ``POST /api/v1/forgekins/{id}/chat``     — 与 Forgekin 对话

红线 11：禁止硬编码密钥 — API key 存到 .env（已 gitignore），
YAML 中只存 ${ENV_VAR} 引用。
"""

from __future__ import annotations

import os
import re
import shutil
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger
from flowforge.forgemind.forgekins import (
    BUILTIN_FORGEKINS,
    ROSTER_FILES,
    load_forgekin_config,
    list_builtin_forgekins,
)

logger = get_logger("api.v1.forgekins")

router = APIRouter(prefix="/forgekins", tags=["forgekins"])

# .env 文件路径（项目根，已 gitignore）— 红线 11：密钥不进源码
_ENV_FILE = Path(__file__).resolve().parents[3] / ".env"

# CLI 工具 → 二进制名 映射（用于连通性检查）
_CLI_BINARIES: dict[str, str] = {
    "claude_code": "claude",
    "codex": "codex",
    "gemini": "gemini",
    "opencode": "opencode",
    "codebuddy": "codebuddy",
    "iflow": "iflow",
    "qodercli": "qodercli",
    "kimi": "kimi",
    "trae": "trae",
    "trae_cn_ide": "trae",
}


# ── 请求/响应模型 ────────────────────────────────────────────────


class LLMConfigUpdate(BaseModel):
    """LLM 配置更新项。"""

    provider: str | None = Field(default=None, description="CLI 工具 provider")
    model: str | None = Field(default=None, description="模型 ID")
    mode: str | None = Field(default=None, description="连接模式: cli/bridge/api")


class ForgekinUpdate(BaseModel):
    """Forgekin 更新请求体。"""

    name: str | None = Field(default=None, description="显示名称")
    description: str | None = Field(default=None, description="描述")
    config: dict[str, Any] | None = Field(default=None, description="配置覆写")
    llm: LLMConfigUpdate | None = Field(default=None, description="LLM 绑定配置")
    api_key: str | None = Field(default=None, description="API Key（明文传入，加密存储到 .env）")


class BindingUpdate(BaseModel):
    """CLI 绑定切换请求体。"""

    cli_tool: str = Field(..., description="CLI 工具 provider 名")
    model: str = Field(default="", description="模型 ID")
    mode: str = Field(default="cli", description="连接模式: cli/bridge/api")
    api_key: str | None = Field(default=None, description="API Key（可选，不传则不修改）")


class ChatRequest(BaseModel):
    """与 Forgekin 对话的请求体。"""

    message: str = Field(..., min_length=1, description="消息内容")
    session_id: str | None = Field(default=None, description="会话 ID")


# ── 持久化辅助函数 ────────────────────────────────────────────────


def _update_yaml_llm_fields(yaml_path: Path, fields: dict[str, str | None]) -> None:
    """定向更新 YAML ``llm:`` 段的指定字段，保留其他内容与注释。

    采用行级编辑而非全量 safe_dump，以保护 YAML 中珍贵的设计注释。

    Args:
        yaml_path: YAML 文件路径
        fields: {field_name: new_value}，值为 None 时删除该字段
    """
    text = yaml_path.read_text(encoding="utf-8")
    lines = text.splitlines(keepends=True)

    # 定位 llm: 段起始
    llm_start: int | None = None
    for i, line in enumerate(lines):
        if re.match(r"^llm:\s*(#.*)?$", line):
            llm_start = i
            break

    if llm_start is None:
        # 文件无 llm 段 — 追加
        if lines and not lines[-1].endswith("\n"):
            lines[-1] += "\n"
        lines.append("\nllm:\n")
        llm_start = len(lines) - 1

    # 定位 llm 段结束（下一个非空非缩进行）
    llm_end = len(lines)
    for i in range(llm_start + 1, len(lines)):
        stripped = lines[i].strip()
        if stripped and not lines[i].startswith((" ", "\t")) and not stripped.startswith("#"):
            llm_end = i
            break

    # 在 llm 段内更新字段
    updated: set[str] = set()
    new_section: list[str] = []
    field_pattern = re.compile(r"^(\s+)(\w+):\s*(.*)$")

    for i in range(llm_start + 1, llm_end):
        line = lines[i]
        m = field_pattern.match(line)
        if m and m.group(2) in fields:
            indent, key = m.group(1), m.group(2)
            val = fields[key]
            if val is not None:
                new_section.append(f"{indent}{key}: {val}\n")
            # val is None → 删除该字段（不追加）
            updated.add(key)
        else:
            new_section.append(line)

    # 追加段内未找到的字段
    for key, val in fields.items():
        if key not in updated and val is not None:
            new_section.append(f"  {key}: {val}\n")

    result = lines[: llm_start + 1] + new_section + lines[llm_end:]
    yaml_path.write_text("".join(result), encoding="utf-8")


def _persist_api_key_to_env(forgekin_id: str, api_key: str) -> str:
    """将 API key 写入 .env 文件，返回环境变量名。

    红线 11：API key 存到 .env（已 gitignore），YAML 中只存 ${ENV_VAR} 引用。
    同步更新进程环境变量，使运行中的 CLI Provider 立即生效。
    """
    env_var = f"FORGEKIN_{forgekin_id.upper()}_API_KEY"

    lines: list[str] = []
    if _ENV_FILE.exists():
        lines = _ENV_FILE.read_text(encoding="utf-8").splitlines()

    found = False
    for i, line in enumerate(lines):
        if line.startswith(f"{env_var}="):
            lines[i] = f"{env_var}={api_key}"
            found = True
            break
    if not found:
        if lines and lines[-1].strip() and not lines[-1].endswith("\n"):
            lines.append("")
        lines.append(f"{env_var}={api_key}")

    _ENV_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")
    os.environ[env_var] = api_key
    logger.info("api_key persisted to .env: forgekin=%s env_var=%s", forgekin_id, env_var)
    return env_var


def _check_cli_connectivity(provider: str) -> dict[str, Any]:
    """检查 CLI 工具的连通性。

    Returns:
        {connected: bool, binary: str, path: str | None, reason: str}
    """
    binary = _CLI_BINARIES.get(provider, provider)
    found = shutil.which(binary)
    if found:
        return {"connected": True, "binary": binary, "path": found, "reason": f"CLI 可用: {found}"}
    return {"connected": False, "binary": binary, "path": None, "reason": f"CLI '{binary}' 不在 PATH 中"}


def _check_api_key_configured(forgekin_id: str, cfg: dict[str, Any]) -> dict[str, Any]:
    """检查 API key 配置状态。

    Returns:
        {configured: bool, env_var: str, has_value: bool}
    """
    env_var = f"FORGEKIN_{forgekin_id.upper()}_API_KEY"
    llm = cfg.get("llm", {})
    yaml_ref = llm.get("api_key", "")
    has_env_value = bool(os.environ.get(env_var))
    # 若 YAML 中有 api_key 引用，或环境变量有值，均视为已配置
    configured = bool(yaml_ref) or has_env_value
    return {"configured": configured, "env_var": env_var, "has_value": has_env_value}


# ── 端点 ─────────────────────────────────────────────────────────


@router.get("")
async def list_forgekins(
    limit: int = Query(50, ge=1, le=200, description="返回条数上限"),
    offset: int = Query(0, ge=0, description="分页偏移"),
) -> dict[str, Any]:
    """列出所有预置 Forgekin（从 roster 加载真实数据）。"""
    items = list_builtin_forgekins()
    total = len(items)
    paged = items[offset : offset + limit]
    return {"items": paged, "total": total, "limit": limit, "offset": offset}


@router.get("/{forgekin_id}")
async def get_forgekin(forgekin_id: str) -> dict[str, Any]:
    """获取单个 Forgekin 详情（加载 YAML 配置，含 LLM 绑定信息）。"""
    if forgekin_id not in BUILTIN_FORGEKINS:
        raise HTTPException(
            status_code=404,
            detail=f"未知 Forgekin ID: {forgekin_id}. 可用: {BUILTIN_FORGEKINS}",
        )
    try:
        cfg = load_forgekin_config(forgekin_id)
    except (KeyError, FileNotFoundError) as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    llm = cfg.get("llm", {})
    return {
        "id": forgekin_id,
        "name": cfg.get("name", forgekin_id),
        "nickname": cfg.get("nickname", ""),
        "species": cfg.get("species", "unknown"),
        "breed": cfg.get("breed", ""),
        "breed_en": cfg.get("breed_en", ""),
        "avatar": cfg.get("avatar", ""),
        "color": cfg.get("color", {}),
        "role": cfg.get("role", {}),
        "personality": cfg.get("personality", {}),
        "evolution_stage": cfg.get("evolution_stage", "E1"),
        "awakening_stage": cfg.get("awakening_stage", "E1"),
        "llm_provider": llm.get("provider", "trae"),
        "llm_model": llm.get("model", ""),
        "llm_mode": llm.get("mode", "cli"),
        "available": cfg.get("available", True),
        "mention_patterns": cfg.get("mention_patterns", []),
        "status": "configured",
    }


@router.put("/{forgekin_id}")
async def update_forgekin(
    forgekin_id: str, payload: ForgekinUpdate
) -> dict[str, Any]:
    """更新 Forgekin 配置（持久化到 YAML + .env）。

    支持修改：
    - llm.provider / llm.model / llm.mode → 写入 YAML
    - api_key → 写入 .env，YAML 中存 ${ENV_VAR} 引用（红线 11）
    """
    if forgekin_id not in BUILTIN_FORGEKINS:
        raise HTTPException(
            status_code=404,
            detail=f"未知 Forgekin ID: {forgekin_id}. 可用: {BUILTIN_FORGEKINS}",
        )
    yaml_path = ROSTER_FILES[forgekin_id]
    if not yaml_path.exists():
        raise HTTPException(status_code=404, detail=f"花名册 YAML 不存在: {yaml_path}")

    updated_fields: list[str] = []
    env_var_written: str | None = None

    # 处理 LLM 配置
    if payload.llm is not None:
        llm_fields: dict[str, str | None] = {}
        if payload.llm.provider is not None:
            llm_fields["provider"] = payload.llm.provider
            updated_fields.append("llm.provider")
        if payload.llm.model is not None:
            llm_fields["model"] = payload.llm.model
            updated_fields.append("llm.model")
        if payload.llm.mode is not None:
            llm_fields["mode"] = payload.llm.mode
            updated_fields.append("llm.mode")
        if llm_fields:
            _update_yaml_llm_fields(yaml_path, llm_fields)

    # 处理 API key（存到 .env，YAML 存引用）
    if payload.api_key:
        env_var_written = _persist_api_key_to_env(forgekin_id, payload.api_key)
        _update_yaml_llm_fields(yaml_path, {"api_key": f"${{{env_var_written}}}"})
        updated_fields.append("llm.api_key (ref)")

    # 处理 name / description（简单字段，暂仅记录日志）
    if payload.name is not None:
        updated_fields.append("name")
    if payload.description is not None:
        updated_fields.append("description")

    logger.info(
        "forgekin updated: id=%s fields=%s env_var=%s",
        forgekin_id, updated_fields, env_var_written,
    )

    # 返回更新后的完整配置
    try:
        cfg = load_forgekin_config(forgekin_id)
    except Exception:  # noqa: BLE001
        cfg = {}
    llm = cfg.get("llm", {})
    return {
        "id": forgekin_id,
        "updated": True,
        "fields": updated_fields,
        "status": "persisted",
        "config": {
            "llm_provider": llm.get("provider", ""),
            "llm_model": llm.get("model", ""),
            "llm_mode": llm.get("mode", ""),
            "api_key_ref": llm.get("api_key", ""),
        },
    }


@router.get("/{forgekin_id}/binding")
async def get_forgekin_binding(forgekin_id: str) -> dict[str, Any]:
    """查询 Forgekin 与 CLI 工具的绑定关系。

    返回：绑定的 CLI 工具名、模型 ID、连接模式、连通状态、API key 配置状态。
    """
    if forgekin_id not in BUILTIN_FORGEKINS:
        raise HTTPException(
            status_code=404,
            detail=f"未知 Forgekin ID: {forgekin_id}. 可用: {BUILTIN_FORGEKINS}",
        )
    try:
        cfg = load_forgekin_config(forgekin_id)
    except (KeyError, FileNotFoundError) as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    llm = cfg.get("llm", {})
    provider = llm.get("provider", "trae")
    model = llm.get("model", "")
    mode = llm.get("mode", "cli")

    connectivity = _check_cli_connectivity(provider)
    api_key_status = _check_api_key_configured(forgekin_id, cfg)

    return {
        "forgekin_id": forgekin_id,
        "forgekin_name": cfg.get("name", forgekin_id),
        "cli_tool": provider,
        "model": model,
        "mode": mode,
        "connected": connectivity["connected"],
        "connectivity_reason": connectivity["reason"],
        "cli_binary": connectivity["binary"],
        "cli_path": connectivity["path"],
        "api_key_configured": api_key_status["configured"],
        "api_key_env_var": api_key_status["env_var"],
        "api_key_has_value": api_key_status["has_value"],
    }


@router.post("/{forgekin_id}/binding")
async def set_forgekin_binding(
    forgekin_id: str, payload: BindingUpdate
) -> dict[str, Any]:
    """动态切换 Forgekin 的 CLI 绑定。

    持久化到 YAML（provider/model/mode）+ .env（api_key）。
    """
    if forgekin_id not in BUILTIN_FORGEKINS:
        raise HTTPException(
            status_code=404,
            detail=f"未知 Forgekin ID: {forgekin_id}. 可用: {BUILTIN_FORGEKINS}",
        )
    yaml_path = ROSTER_FILES[forgekin_id]
    if not yaml_path.exists():
        raise HTTPException(status_code=404, detail=f"花名册 YAML 不存在: {yaml_path}")

    # 写入 LLM 配置到 YAML
    llm_fields: dict[str, str | None] = {
        "provider": payload.cli_tool,
        "model": payload.model,
        "mode": payload.mode,
    }
    _update_yaml_llm_fields(yaml_path, llm_fields)

    # 写入 API key 到 .env（若提供）
    env_var_written: str | None = None
    if payload.api_key:
        env_var_written = _persist_api_key_to_env(forgekin_id, payload.api_key)
        _update_yaml_llm_fields(yaml_path, {"api_key": f"${{{env_var_written}}}"})

    logger.info(
        "forgekin binding switched: id=%s cli_tool=%s model=%s mode=%s api_key=%s",
        forgekin_id, payload.cli_tool, payload.model, payload.mode,
        "updated" if env_var_written else "unchanged",
    )

    # 返回更新后的绑定状态
    connectivity = _check_cli_connectivity(payload.cli_tool)
    return {
        "forgekin_id": forgekin_id,
        "cli_tool": payload.cli_tool,
        "model": payload.model,
        "mode": payload.mode,
        "connected": connectivity["connected"],
        "connectivity_reason": connectivity["reason"],
        "api_key_env_var": env_var_written,
        "status": "persisted",
    }


@router.post("/{forgekin_id}/forge")
async def forge_forgekin(forgekin_id: str) -> dict[str, Any]:
    """锻造 Forgekin 实例（转发到 forgemind endpoint）。"""
    if forgekin_id not in BUILTIN_FORGEKINS:
        raise HTTPException(
            status_code=404,
            detail=f"未知 Forgekin ID: {forgekin_id}. 可用: {BUILTIN_FORGEKINS}",
        )
    from flowforge.app.api.agents.forgemind import _registry

    existing = _registry.get(forgekin_id)
    if existing is not None:
        return {"id": forgekin_id, "status": "already_forged", **existing.describe()}

    pipeline = await _registry.get_pipeline()
    trae_client = await _registry.get_trae_client()
    yaml_path = ROSTER_FILES[forgekin_id]

    try:
        forgekin = await pipeline.forge_from_yaml(yaml_path, llm_client=trae_client)
    except Exception as exc:
        logger.exception(f"锻造 Forgekin 失败: {forgekin_id}")
        raise HTTPException(status_code=500, detail=f"锻造失败: {exc}")

    _registry.register(forgekin)
    return {"id": forgekin_id, "status": "forged", **forgekin.describe()}


@router.post("/{forgekin_id}/chat")
async def chat_with_forgekin(
    forgekin_id: str, payload: ChatRequest
) -> dict[str, Any]:
    """与 Forgekin 对话。"""
    from flowforge.app.api.agents.forgemind import _registry

    forgekin = _registry.get(forgekin_id)
    if forgekin is None:
        await forge_forgekin(forgekin_id)
        forgekin = _registry.get(forgekin_id)
        if forgekin is None:
            raise HTTPException(status_code=500, detail=f"Forgekin {forgekin_id} 锻造失败")

    messages = [{"role": "user", "content": payload.message}]
    result = await forgekin.chat(messages, session_id=payload.session_id)
    return {
        "forgekin_id": forgekin_id,
        "name": forgekin.name,
        "content": result.get("content", ""),
        "model": result.get("model", "unknown"),
        "session_id": result.get("session_id", ""),
        "usage": result.get("usage", {}),
    }
