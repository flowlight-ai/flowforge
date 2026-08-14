"""Browser API — 页面 DOM 探测（真实抓取 + 可交互元素提取）.

对应前端 BrowserPreview 元素选择器契约：
    POST /api/v1/browser/inspect  — 抓取页面并返回可交互元素（真实 DOM 探测）

跨域 iframe 无法直接访问 DOM，因此通过后端代理抓取页面 HTML，
解析出可交互元素（a/button/input/select/textarea）并生成稳定的 CSS 选择器，
前端据此实现真实的元素选择能力（替代 mockSelector）。
"""

from __future__ import annotations

import re
import urllib.request
from html.parser import HTMLParser
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("api.browser")

router = APIRouter(prefix="/browser", tags=["browser"])

_INTERACTIVE_TAGS = {"a", "button", "input", "select", "textarea", "label", "summary"}


class BrowserInspectRequest(BaseModel):
    """浏览器 DOM 探测请求体。"""

    url: str = Field(..., description="要探测的页面 URL")
    max_elements: int = Field(default=60, ge=1, le=200)


class _InspectParser(HTMLParser):
    """提取可交互元素并生成 CSS 选择器路径。"""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.stack: list[str] = []  # tag 栈
        self.depth_by_tag: dict[tuple[str, ...], int] = {}  # 路径计数
        self.elements: list[dict[str, Any]] = []

    def _path_key(self) -> tuple[str, ...]:
        return tuple(self.stack)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, Any]]) -> None:
        self.stack.append(tag)
        if tag not in _INTERACTIVE_TAGS:
            return
        attr_map = {k.lower(): (v or "") for k, v in attrs}
        # 计数同一路径下同标签的出现次数 → nth-of-type
        key = self._path_key()
        self.depth_by_tag[key] = self.depth_by_tag.get(key, 0) + 1
        nth = self.depth_by_tag[key]
        # 生成祖先链选择器（最多 5 层）
        chain = self.stack[:]
        parts: list[str] = []
        for i, t in enumerate(chain):
            prefix = f"{t}:nth-of-type({1})"  # 简化：祖先按首次出现
            parts.append(prefix)
        # 末级用真实 nth
        if parts:
            parts[-1] = f"{tag}:nth-of-type({nth})"
        selector = " > ".join(parts[-5:])
        el_id = attr_map.get("id", "")
        if el_id:
            selector = f"#{el_id}"
        self.elements.append({
            "selector": selector,
            "tagName": tag,
            "id": el_id or None,
            "className": attr_map.get("class", "") or None,
            "name": attr_map.get("name", "") or None,
            "href": attr_map.get("href", "") or None,
            "type": attr_map.get("type", "") or None,
            "textContent": "",
        })

    def handle_data(self, data: str) -> None:
        if not self.elements:
            return
        # 文本归属最近的交互元素
        latest = self.elements[-1]
        text = data.strip()
        if text and not latest["textContent"]:
            latest["textContent"] = text[:80]

    def handle_endtag(self, tag: str) -> None:
        if self.stack and self.stack[-1] == tag:
            self.stack.pop()


@router.post("/inspect")
async def inspect_page(payload: BrowserInspectRequest) -> dict[str, Any]:
    """抓取页面 HTML 并提取可交互元素（真实 DOM 探测）。"""
    url = payload.url.strip()
    if not re.match(r"^https?://", url, re.IGNORECASE):
        raise HTTPException(status_code=400, detail="仅支持 http/https 链接")

    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) flowforge-browser/1.0"},
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read(4 * 1024 * 1024)
            final_url = resp.geturl() or url
            charset = resp.headers.get_content_charset() or "utf-8"
    except Exception as e:  # noqa: BLE001
        logger.warning(f"browser: fetch failed for {url}: {e}")
        return {"url": url, "ok": False, "error": f"页面抓取失败：{e}", "title": "", "elements": []}

    try:
        html = raw.decode(charset, errors="replace")
    except (LookupError, ValueError):
        html = raw.decode("utf-8", errors="replace")

    parser = _InspectParser()
    try:
        parser.feed(html)
    except Exception as e:  # noqa: BLE001
        logger.warning(f"browser: parse failed: {e}")

    # 提取页面标题
    title = ""
    m = re.search(r"<title[^>]*>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
    if m:
        title = re.sub(r"\s+", " ", m.group(1)).strip()[:120]

    elements = parser.elements[: payload.max_elements]
    return {
        "url": final_url,
        "ok": True,
        "title": title,
        "elements": elements,
        "total": len(elements),
    }
