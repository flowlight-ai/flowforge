"""Env Files API — 环境文件管理（真实实现）。

对应设计文档 §10.2：
    - ``GET /api/v1/env/files``  — 环境文件列表
    - ``PUT /api/v1/env/files``  — 更新环境文件

安全约束：
    - 只允许操作 flowforge 根目录下的 ``.env*`` 文件（防路径穿越）
    - 列表返回脱敏内容（``KEY=VALUE`` → ``KEY=***``），不泄露密钥
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from flowforge.app.api.core.logs import get_audit_logger

router = APIRouter(prefix="/env", tags=["env-files"])

_ROOT = Path(__file__).resolve().parents[3]

# 仅允许操作这些文件名（防路径穿越 + 防误改非环境文件）
_ALLOWED_NAMES = {".env", ".env.local", ".env.example", ".env.production", ".env.development", ".env.test"}

_SECRET_LINE = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*(?:_KEY|_TOKEN|_SECRET|_PASSWORD|_PASS|_API|_CLIENT_ID|TOKEN|KEY|SECRET|PASSWORD|PASS)\b)\s*=\s*(.*)$")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _mask_content(content: str) -> str:
    """将密钥行的值替换为 ***，其余原样返回。"""
    lines = []
    for line in content.splitlines():
        m = _SECRET_LINE.match(line)
        if m and m.group(2):
            lines.append(f"{m.group(1)}=***")
        else:
            lines.append(line)
    return "\n".join(lines)


def _list_env_files() -> list[dict[str, Any]]:
    items = []
    for name in _ALLOWED_NAMES:
        path = _ROOT / name
        if not path.exists() or not path.is_file():
            continue
        stat = path.stat()
        try:
            content = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            content = ""
        items.append({
            "filename": name,
            "path": str(path.relative_to(_ROOT)),
            "size": stat.st_size,
            "lineCount": len(content.splitlines()),
            "modifiedAt": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat().replace("+00:00", "Z"),
            "maskedContent": _mask_content(content),
        })
    return items


class EnvFileUpdate(BaseModel):
    """环境文件更新请求体。"""

    filename: str = Field(..., description="文件名（如 .env）")
    content: str = Field(default="", description="文件内容")
    merge: bool = Field(default=False, description="是否合并而非覆盖")


@router.get("/files")
async def list_env_files() -> dict[str, Any]:
    """列出环境文件（真实扫描 + 脱敏内容）。"""
    items = _list_env_files()
    return {"items": items, "total": len(items)}


@router.put("/files")
async def update_env_file(payload: EnvFileUpdate) -> dict[str, Any]:
    """更新环境文件（真实写入磁盘，merge 模式按行合并）。"""
    filename = payload.filename.strip()
    if filename not in _ALLOWED_NAMES:
        raise HTTPException(status_code=422, detail=f"filename must be one of {sorted(_ALLOWED_NAMES)}")

    path = _ROOT / filename
    # 安全守卫：解析后必须仍在根目录内（防符号链接/穿越）
    resolved = path.resolve()
    if not resolved.is_relative_to(_ROOT.resolve()):
        raise HTTPException(status_code=403, detail="path escapes flowforge root")

    if payload.merge and path.exists():
        try:
            existing_lines = path.read_text(encoding="utf-8").splitlines()
        except (OSError, UnicodeDecodeError):
            existing_lines = []
        incoming = payload.content.splitlines()
        merged = list(existing_lines)
        incoming_keys = {}
        for line in incoming:
            m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)\s*=", line)
            if m:
                incoming_keys[m.group(1)] = line
        if incoming_keys:
            merged = [line for line in merged if not re.match(r"^([A-Za-z_][A-Za-z0-9_]*)\s*=", line) or line.split("=", 1)[0] not in incoming_keys]
            merged.extend(incoming_keys.values())
        else:
            merged.extend(incoming)
        content = "\n".join(merged).rstrip("\n") + "\n"
    else:
        content = payload.content

    path.write_text(content, encoding="utf-8")
    get_audit_logger().log(
        level="info",
        action="env_files.update",
        details={"filename": filename, "bytes": len(content), "merge": payload.merge},
    )
    return {
        "filename": filename,
        "bytes_written": len(content.encode("utf-8")),
        "merged": payload.merge,
        "updated": True,
        "updated_at": _now(),
    }
