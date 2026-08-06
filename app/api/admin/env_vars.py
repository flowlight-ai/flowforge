"""Environment Variables API — 环境变量管理。

对应前端 HubEnvFilesTab 组件契约：
    GET  /api/v1/env/summary      — 返回环境变量清单 + 配置文件列表 + 存储模式
    PUT  /api/v1/env/{varName}    — 更新单个环境变量

设计依据：
    - WEB-FUSION-DESIGN.md §8 环境文件管理
    - 铁律 5：禁止硬编码路径（.env 路径通过 CWD 动态获取）
    - 铁律 4：禁止直接操作数据库（本端点操作文件，不涉及 DB）
    - 所有 I/O 操作使用 async/await（文件 I/O 通过 anyio.to_thread）
"""

from __future__ import annotations

import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import anyio
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from flowforge.core.tracing import get_trace_id, get_logger

logger = get_logger("api.env_vars")

router = APIRouter(prefix="/env", tags=["env-vars"])


# ── 变量分类规则 ────────────────────────────────────────────────────────────

# 密钥类变量名关键词（脱敏显示）
_SECRET_KEYWORDS = ("KEY", "SECRET", "PASSWORD", "TOKEN", "CREDENTIAL", "PASS")
# 路径类变量名关键词
_PATH_KEYWORDS = ("PATH", "DIR", "ROOT", "WORK_DIR", "LOG_DIR")
# 模型类变量名关键词
_MODEL_KEYWORDS = ("MODEL", "LLM", "OPENROUTE", "ANTHROPIC", "OPENAI", "ZHIPU", "PROVIDER")


def _classify_var(name: str) -> str:
    """根据变量名分类。

    Args:
        name: 环境变量名（大写）。

    Returns:
        分类：secret | path | model | config
    """
    upper = name.upper()
    if any(k in upper for k in _SECRET_KEYWORDS):
        return "secret"
    if any(k in upper for k in _PATH_KEYWORDS):
        return "path"
    if any(k in upper for k in _MODEL_KEYWORDS):
        return "model"
    return "config"


def _is_masked(category: str) -> bool:
    """密钥类变量脱敏显示。"""
    return category == "secret"


# ── .env 文件解析 ────────────────────────────────────────────────────────────

# 匹配 KEY=VALUE 格式（忽略注释行和空行）
_ENV_LINE_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$")


def _parse_env_content(content: str) -> list[tuple[str, str]]:
    """解析 .env 文件内容为 (key, value) 列表。

    保留注释行和空行的位置信息（用于写回时保持格式）。
    """
    pairs: list[tuple[str, str]] = []
    for line in content.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        match = _ENV_LINE_RE.match(stripped)
        if match:
            key = match.group(1)
            value = match.group(2)
            # 去除引号包裹
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
                value = value[1:-1]
            pairs.append((key, value))
    return pairs


def _build_env_summary(content: str, env_path: Path) -> dict[str, Any]:
    """构建环境变量摘要响应。

    Args:
        content: .env 文件内容。
        env_path: .env 文件路径。

    Returns:
        EnvSummary 字典。
    """
    pairs = _parse_env_content(content)
    variables: list[dict[str, Any]] = []
    for name, value in pairs:
        category = _classify_var(name)
        masked = _is_masked(category)
        # 密钥类变量脱敏：只显示前4位 + ••••
        display_value = value if not masked else (
            (value[:4] + "••••••••") if len(value) > 4 else "••••••••"
        )
        variables.append({
            "name": name,
            "value": display_value,
            "category": category,
            "editable": True,
            "masked": masked,
        })

    # 配置文件列表（仅 .env 及相关）
    files: list[dict[str, Any]] = []
    if env_path.exists():
        stat = env_path.stat()
        files.append({
            "path": str(env_path),
            "size": stat.st_size,
            "modifiedAt": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat() + "Z",
            "envCount": len(pairs),
        })

    return {
        "variables": variables,
        "files": files,
        "storage": {
            "mode": "memory",
            "persistent": True,
            "warning": "环境变量从 .env 文件加载，修改后需重启服务生效",
        },
    }


def _update_env_var(content: str, var_name: str, new_value: str) -> str:
    """更新 .env 文件中指定变量的值，保持其他行格式不变。

    Args:
        content: 原始 .env 文件内容。
        var_name: 要更新的变量名。
        new_value: 新值。

    Returns:
        更新后的 .env 文件内容。

    Raises:
        KeyError: 变量不存在时。
    """
    lines = content.splitlines(keepends=True)
    found = False
    updated_lines: list[str] = []

    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            updated_lines.append(line)
            continue
        match = _ENV_LINE_RE.match(stripped)
        if match and match.group(1) == var_name:
            # 保留行尾换行符
            line_ending = "\n" if line.endswith("\n") else ""
            # 如果原值有引号包裹，保持引号
            original_value = match.group(2)
            if len(original_value) >= 2 and original_value[0] == original_value[-1] and original_value[0] in ('"', "'"):
                quote_char = original_value[0]
                updated_lines.append(f"{var_name}={quote_char}{new_value}{quote_char}{line_ending}")
            else:
                updated_lines.append(f"{var_name}={new_value}{line_ending}")
            found = True
        else:
            updated_lines.append(line)

    if not found:
        raise KeyError(f"Variable '{var_name}' not found in .env file")

    return "".join(updated_lines)


# ── 请求模型 ────────────────────────────────────────────────────────────────

class EnvVarUpdate(BaseModel):
    """环境变量更新请求体。"""
    value: str = Field(..., description="新的变量值")


# ── 端点 ────────────────────────────────────────────────────────────────────

def _get_env_path() -> Path:
    """获取 .env 文件路径（从当前工作目录查找，铁律 5 禁止硬编码路径）。"""
    return Path.cwd() / ".env"


@router.get("/summary")
async def get_env_summary() -> dict[str, Any]:
    """返回环境变量摘要（变量清单 + 配置文件 + 存储模式）。

    密钥类变量脱敏显示。
    """
    env_path = _get_env_path()

    def _read() -> str:
        if not env_path.exists():
            logger.warning("env.summary path=%s reason=not_found", env_path)
            return ""
        return env_path.read_text(encoding="utf-8")

    content = await anyio.to_thread.run_sync(_read)
    summary = _build_env_summary(content, env_path)
    logger.info(
        "env.summary path=%s variables=%d files=%d",
        env_path, len(summary["variables"]), len(summary["files"]),
    )
    return summary


@router.put("/{var_name}")
async def update_env_var(var_name: str, payload: EnvVarUpdate) -> dict[str, Any]:
    """更新单个环境变量（写入 .env 文件）。

    修改后需重启服务才能生效（运行中的进程不会自动重新加载）。
    """
    env_path = _get_env_path()

    def _read_and_update() -> tuple[str, str]:
        if not env_path.exists():
            raise FileNotFoundError(f".env 文件不存在: {env_path}")
        content = env_path.read_text(encoding="utf-8")
        new_content = _update_env_var(content, var_name, payload.value)
        env_path.write_text(new_content, encoding="utf-8")
        return content, new_content

    try:
        old_content, new_content = await anyio.to_thread.run_sync(_read_and_update)
    except FileNotFoundError as e:
        logger.error("env.update failed var=%s error=%s", var_name, e)
        raise HTTPException(status_code=404, detail=str(e))
    except KeyError as e:
        logger.error("env.update failed var=%s error=not_found", var_name)
        raise HTTPException(status_code=404, detail=f"变量不存在: {e}")

    logger.info(
        "env.update var=%s old_len=%d new_len=%d path=%s",
        var_name, len(old_content), len(new_content), env_path,
    )
    return {
        "updated": True,
        "var_name": var_name,
        "message": "变量已更新，需重启服务生效",
        "meta": {
            "trace_id": get_trace_id(),
            "timestamp": datetime.now(timezone.utc).isoformat() + "Z",
        },
    }
