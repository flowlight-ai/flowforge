"""Figma API — Figma 文件导入（真实 Figma REST API 调用）.

对应前端 FigmaImporter 组件契约：
    POST /api/v1/figma/import  — 从 Figma 文件 URL 导入设计框架

认证：
    从 SecretStore 读取 ``FIGMA_TOKEN``（设置 → 账号与密钥 中配置）。
    未配置时返回 ``ok: false, code: NO_TOKEN``，前端提示引导配置。

Figma REST API：
    - GET https://api.figma.com/v1/files/{key}?depth=3      文档树
    - GET https://api.figma.com/v1/images/{key}?ids=...     框架缩略图
"""

from __future__ import annotations

import json
import re
import urllib.request
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from flowforge.core.secret_store import get_secret_store
from flowforge.core.tracing import get_logger

logger = get_logger("api.figma")

router = APIRouter(prefix="/figma", tags=["figma"])

_FIGMA_API = "https://api.figma.com/v1"
_FIGMA_URL_RE = re.compile(r"figma\.com/(?:file|design)/([a-zA-Z0-9]+)")


class FigmaImportRequest(BaseModel):
    """Figma 导入请求体。"""

    url: str = Field(..., description="Figma 文件链接（file/design 格式）")
    node_id: str | None = Field(default=None, description="可选：指定节点 ID")


def _figma_token() -> str:
    """从 SecretStore 读取 Figma 访问令牌。"""
    try:
        store = get_secret_store()
        token = store.resolve("FIGMA_TOKEN")
        return token or ""
    except Exception as e:  # noqa: BLE001
        logger.warning(f"figma: secret store unavailable: {e}")
        return ""


def _http_json(url: str, token: str, timeout: int = 20) -> dict[str, Any]:
    """GET 请求并解析 JSON（Figma API）。"""
    req = urllib.request.Request(
        url,
        headers={
            "X-Figma-Token": token,
            "User-Agent": "flowforge-figma/1.0",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read(8 * 1024 * 1024)
    return json.loads(raw.decode("utf-8"))


def _collect_frames(node: dict[str, Any], out: list[dict[str, Any]]) -> None:
    """递归收集 FRAME/SECTION 节点（canvas 下的直接子节点优先）。"""
    ntype = node.get("type")
    name = node.get("name", "")
    children = node.get("children") or []
    if ntype in ("FRAME", "SECTION") and name:
        box = node.get("absoluteBoundingBox") or {}
        out.append({
            "id": node.get("id", ""),
            "name": name,
            "width": int(box.get("width", 0) or 0),
            "height": int(box.get("height", 0) or 0),
            "childrenCount": len(children),
        })
    for child in children:
        _collect_frames(child, out)


@router.post("/import")
async def import_figma(payload: FigmaImportRequest) -> dict[str, Any]:
    """从 Figma 导入设计框架（真实 REST API；未配置令牌时优雅降级）。"""
    match = _FIGMA_URL_RE.search(payload.url.strip())
    if not match:
        return {"ok": False, "code": "BAD_URL", "error": "无效的 Figma 链接，需包含 figma.com/file/ 或 figma.com/design/"}

    file_key = match.group(1)
    token = _figma_token()
    if not token:
        return {
            "ok": False,
            "code": "NO_TOKEN",
            "error": "未配置 Figma 访问令牌（FIGMA_TOKEN）。请在「设置 → 账号与密钥」中配置后重试。",
            "file_key": file_key,
            "frames": [],
        }

    try:
        doc = _http_json(f"{_FIGMA_API}/files/{file_key}?depth=3", token)
    except Exception as e:  # noqa: BLE001
        logger.warning(f"figma: fetch file failed: {e}")
        return {
            "ok": False,
            "code": "FETCH_FAILED",
            "error": f"Figma 文件获取失败（令牌无效或无权限）：{e}",
            "file_key": file_key,
            "frames": [],
        }

    frames: list[dict[str, Any]] = []
    for canvas in (doc.get("document") or {}).get("children") or []:
        _collect_frames(canvas, frames)

    # 指定 node_id 时过滤
    if payload.node_id:
        frames = [f for f in frames if f["id"] == payload.node_id]
    # 限制数量（前 50 个）
    frames = frames[:50]

    # 获取缩略图
    if frames:
        ids = ",".join(f["id"] for f in frames)
        try:
            img = _http_json(f"{_FIGMA_API}/images/{file_key}?ids={ids}&format=png", token)
            images = img.get("images") or {}
            for f in frames:
                f["thumbnailUrl"] = images.get(f["id"])
        except Exception as e:  # noqa: BLE001
            logger.warning(f"figma: fetch images failed: {e}")

    return {
        "ok": True,
        "file_key": file_key,
        "name": doc.get("name", file_key),
        "frames": frames,
        "total": len(frames),
    }
