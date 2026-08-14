"""Signals API — 信号系统（JSON 持久化 + 审计日志派生）.

对应设计文档 §10.2：
    - ``GET  /api/v1/signals``                  — 信号列表（按严重度/来源过滤）
    - ``POST /api/v1/signals/{id}/read``        — 单条信号标为已读
    - ``GET  /api/v1/signals/sources``          — 信号源列表
    - ``POST /api/v1/signals/sources``          — 创建信号源
    - ``POST /api/v1/signals/sources/{id}/toggle`` — 启用/禁用信号源
    - ``POST /api/v1/signals/sources/{id}/fetch``  — 立即抓取信号源

存储布局（与 ThreadStore 同风格）：
    data/signals/signals.json   — 信号列表
    data/signals/sources.json   — 信号源列表

信号来源：
    - ``ingest_signal()`` 供系统模块注入（任务完成/审核失败等）
    - 首次启动（存储为空）时从 audit_logs 派生最近事件
    - RSS 信号源 ``fetch`` 时真实抓取 feed 并注入新信号
"""

from __future__ import annotations

import json
import threading
import time
import urllib.request
import uuid
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("signals_api")

router = APIRouter(prefix="/signals", tags=["signals"])


def _now() -> str:
    """UTC ISO 时间戳（Z 后缀）。"""
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _now_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)


class SignalSourceCreate(BaseModel):
    """信号源创建请求体。"""

    name: str = Field(..., min_length=1)
    type: str = Field(default="rss", description="信号源类型")
    url: str | None = Field(default=None)
    config: dict[str, Any] = Field(default_factory=dict)


def _store_dir() -> Path:
    return Path(__file__).resolve().parents[3] / "data" / "signals"


class SignalStore:
    """信号与信号源存储（JSON 文件持久化，线程安全）。"""

    def __init__(self, base_dir: Path | str | None = None) -> None:
        self._base = Path(base_dir) if base_dir is not None else _store_dir()
        self._signals_file = self._base / "signals.json"
        self._sources_file = self._base / "sources.json"
        self._lock = threading.Lock()
        self._base.mkdir(parents=True, exist_ok=True)
        if not self._signals_file.exists():
            self._write(self._signals_file, {"items": []})
        if not self._sources_file.exists():
            self._write(self._sources_file, {"items": []})

    @staticmethod
    def _write(path: Path, data: dict[str, Any]) -> None:
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(path)

    def _read(self, path: Path) -> dict[str, Any]:
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {"items": []}

    # ── 信号 ────────────────────────────────────────────────────

    def list_signals(self, severity: str | None = None, source_id: str | None = None,
                     limit: int = 50, offset: int = 0) -> dict[str, Any]:
        with self._lock:
            items = self._read(self._signals_file).get("items", [])
        items.sort(key=lambda s: s.get("observed_at", ""), reverse=True)
        if severity:
            items = [s for s in items if s.get("severity") == severity]
        if source_id:
            items = [s for s in items if s.get("source_id") == source_id]
        total = len(items)
        return {"items": items[offset:offset + limit], "total": total}

    def ingest_signal(self, source_id: str, source_name: str, title: str, summary: str,
                      severity: str = "info", strength: float = 1.0,
                      anchor: str | None = None, tags: list[str] | None = None) -> dict[str, Any]:
        """注入一条信号（供系统模块调用）。"""
        signal = {
            "id": f"sig_{uuid.uuid4().hex[:12]}",
            "source_id": source_id,
            "source_name": source_name,
            "title": title,
            "summary": summary,
            "severity": severity if severity in ("info", "warn", "danger", "ok") else "info",
            "strength": max(0.0, min(1.0, float(strength))),
            "observed_at": _now(),
            "anchor": anchor,
            "tags": tags or [],
            "read": False,
        }
        with self._lock:
            data = self._read(self._signals_file)
            data["items"].append(signal)
            self._write(self._signals_file, data)
        return signal

    def mark_read(self, signal_id: str) -> bool:
        with self._lock:
            data = self._read(self._signals_file)
            for s in data.get("items", []):
                if s.get("id") == signal_id and not s.get("read"):
                    s["read"] = True
                    self._write(self._signals_file, data)
                    return True
        return False

    # ── 信号源 ──────────────────────────────────────────────────

    def list_sources(self) -> list[dict[str, Any]]:
        with self._lock:
            items = self._read(self._sources_file).get("items", [])
        return sorted(items, key=lambda s: s.get("name", ""))

    def create_source(self, payload: SignalSourceCreate) -> dict[str, Any]:
        source = {
            "id": f"src_{uuid.uuid4().hex[:10]}",
            "name": payload.name,
            "kind": payload.type,
            "url": payload.url,
            "config": payload.config,
            "enabled": True,
            "last_fetched_at": None,
            "last_error": None,
            "items_today": 0,
            "interval_sec": int(payload.config.get("interval_sec", 3600)),
            "created_at": _now(),
        }
        with self._lock:
            data = self._read(self._sources_file)
            data["items"].append(source)
            self._write(self._sources_file, data)
        return source

    def _update_source(self, source_id: str, **updates: Any) -> dict[str, Any] | None:
        with self._lock:
            data = self._read(self._sources_file)
            for s in data.get("items", []):
                if s.get("id") == source_id:
                    s.update(updates)
                    self._write(self._sources_file, data)
                    return s
        return None

    def toggle_source(self, source_id: str) -> dict[str, Any] | None:
        with self._lock:
            data = self._read(self._sources_file)
            for s in data.get("items", []):
                if s.get("id") == source_id:
                    s["enabled"] = not s.get("enabled", True)
                    self._write(self._sources_file, data)
                    return s
        return None

    def fetch_source(self, source_id: str) -> dict[str, Any] | None:
        """立即抓取信号源（RSS 真实抓取；不可达则记录 last_error）。"""
        with self._lock:
            data = self._read(self._sources_file)
            source = next((s for s in data.get("items", []) if s.get("id") == source_id), None)
        if source is None:
            return None
        url = source.get("url")
        result = {
            "id": source_id,
            "name": source.get("name", ""),
            "last_fetched_at": _now(),
            "items_today": source.get("items_today", 0),
            "status": "done",
            "message": "抓取完成",
        }
        if not url:
            result["status"] = "skipped"
            result["message"] = "未配置 url，跳过抓取"
            self._update_source(source_id, last_fetched_at=_now())
            return result
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "flowforge-signal/1.0"})
            with urllib.request.urlopen(req, timeout=15) as resp:
                content_type = resp.headers.get("Content-Type", "")
                raw = resp.read(1024 * 1024)  # 最多 1MB
            self._update_source(source_id, last_fetched_at=_now(), last_error=None)
            # RSS/Atom 解析
            try:
                root = ET.fromstring(raw)
            except ET.ParseError:
                root = None
            count = 0
            if root is not None:
                entries = []
                for tag in ("item", "entry"):
                    entries.extend(root.iter(tag))
                for entry in entries[:5]:
                    title_el = entry.find("title")
                    title = title_el.text.strip()[:120] if title_el is not None and title_el.text else "未命名"
                    link_el = entry.find("link")
                    link = None
                    if link_el is not None:
                        link = link_el.get("href") or link_el.text
                    if any(s.get("title") == title for s in self.list_signals(source_id=source_id)):
                        continue
                    self.ingest_signal(
                        source_id=source_id,
                        source_name=source.get("name", source_id),
                        title=title,
                        summary=f"来自 {source.get('name', '')} 的最新条目",
                        severity="info",
                        strength=0.6,
                        anchor=link,
                    )
                    count += 1
                if count:
                    with self._lock:
                        d2 = self._read(self._sources_file)
                        for s in d2.get("items", []):
                            if s.get("id") == source_id:
                                s["items_today"] = s.get("items_today", 0) + count
                                self._write(self._sources_file, d2)
                                break
            result["message"] = f"解析完成，新增 {count} 条信号"
            result["items_today"] = (source.get("items_today", 0) or 0) + count
        except Exception as e:  # noqa: BLE001 — 抓取失败记录到信号源
            err = str(e)[:300]
            self._update_source(source_id, last_fetched_at=_now(), last_error=err)
            result["status"] = "error"
            result["message"] = f"抓取失败: {err}"
            self.ingest_signal(
                source_id=source_id,
                source_name=source.get("name", source_id),
                title="信号源抓取失败",
                summary=err,
                severity="warn",
                strength=0.8,
            )
        return result


_store: SignalStore | None = None


def get_signal_store() -> SignalStore:
    global _store
    if _store is None:
        _store = SignalStore()
    return _store


def ingest_signal(source_id: str, source_name: str, title: str, summary: str,
                  severity: str = "info", strength: float = 1.0,
                  anchor: str | None = None, tags: list[str] | None = None) -> dict[str, Any]:
    """系统模块注入信号（模块级便捷函数）。"""
    return get_signal_store().ingest_signal(source_id, source_name, title, summary,
                                            severity=severity, strength=strength,
                                            anchor=anchor, tags=tags)


def _seed_from_audit() -> None:
    """存储为空时从审计日志派生最近事件为信号（真实数据，非占位）。"""
    store = get_signal_store()
    if store.list_signals(limit=1)["total"] > 0:
        return
    try:
        from flowforge.app.api.core.logs import get_audit_logger
        result = get_audit_logger().query(limit=30)
    except Exception as e:  # noqa: BLE001
        logger.warning(f"signals seed: audit unavailable: {e}")
        return
    level_map = {"error": ("danger", 0.9), "warning": ("warn", 0.7), "critical": ("danger", 1.0)}
    for item in result.get("items", []):
        level = (item.get("level") or "info").lower()
        if level in level_map:
            severity, strength = level_map[level]
        else:
            severity, strength = ("info", 0.4)
        action = item.get("action") or "system"
        task_id = item.get("task_id") or ""
        store.ingest_signal(
            source_id="audit",
            source_name="审计日志",
            title=action,
            summary=json.dumps(item.get("details") or {}, ensure_ascii=False)[:200] or action,
            severity=severity,
            strength=strength,
            anchor=f"task:{task_id}" if task_id else None,
            tags=[level, "audit"],
        )


# ── HTTP 端点 ───────────────────────────────────────────────────

@router.get("")
async def list_signals(
    severity: str | None = Query(default=None, description="按严重度过滤: info|warn|danger|ok"),
    source_id: str | None = Query(default=None, description="按信号源过滤"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    """列出信号（时间倒序）。存储为空时先尝试从审计日志派生。"""
    _seed_from_audit()
    result = get_signal_store().list_signals(severity=severity, source_id=source_id, limit=limit, offset=offset)
    return {"items": result["items"], "total": result["total"], "limit": limit, "offset": offset,
            "filter": {"severity": severity, "source_id": source_id}}


@router.post("/{signal_id}/read")
async def mark_signal_read(signal_id: str) -> dict[str, Any]:
    """单条信号标为已读。"""
    ok = get_signal_store().mark_read(signal_id)
    return {"ok": ok, "id": signal_id}


@router.get("/sources")
async def list_signal_sources() -> dict[str, Any]:
    """列出信号源。"""
    items = get_signal_store().list_sources()
    return {"items": items, "total": len(items)}


@router.post("/sources")
async def create_signal_source(payload: SignalSourceCreate) -> dict[str, Any]:
    """创建信号源。"""
    return get_signal_store().create_source(payload)


@router.post("/sources/{source_id}/toggle")
async def toggle_signal_source(source_id: str) -> dict[str, Any]:
    """启用/禁用信号源。"""
    source = get_signal_store().toggle_source(source_id)
    if source is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail=f"Signal source not found: {source_id}")
    return {"ok": True, "id": source_id, "enabled": source.get("enabled")}


@router.post("/sources/{source_id}/fetch")
async def fetch_signal_source(source_id: str) -> dict[str, Any]:
    """立即抓取信号源（RSS 真实抓取并注入新信号）。"""
    result = get_signal_store().fetch_source(source_id)
    if result is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail=f"Signal source not found: {source_id}")
    return result
