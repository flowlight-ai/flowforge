"""会话持久化存储 — JSON 文件后端.

管理群聊会话（Thread）和消息的持久化，参考 clowder-ai ThreadStore/MessageStore 设计简化版。

存储布局：
    data/council/threads.json           — 所有会话元数据
    data/council/messages/<thread_id>.json — 单个会话的消息列表

线程安全：使用 threading.Lock 保护并发读写。
"""

from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _now_iso() -> str:
    """UTC ISO 时间戳。"""
    return datetime.now(timezone.utc).isoformat() + "Z"


def _now_ms() -> int:
    """毫秒时间戳（前端友好）。"""
    return int(datetime.now(timezone.utc).timestamp() * 1000)


class ThreadStore:
    """会话存储（JSON 文件持久化，线程安全）。

    会话数据模型：
        id: str          — UUID
        title: str       — 标题（默认"未命名讨论"，首条消息后可自动更新）
        created_at: str  — ISO 时间戳
        updated_at: str  — ISO 时间戳
        pinned: bool     — 是否置顶
        deleted_at: str | None — 软删除标记
    消息数据模型：
        id: str
        thread_id: str
        source: str      — user / forgekin / system
        content: str
        timestamp: int   — 毫秒时间戳
        forgekin_id: str | None
        forgekin_name: str | None
        forgekin_role: str | None
        meta: dict       — model/usage 等元数据
    """

    def __init__(self, base_dir: Path | str | None = None) -> None:
        if base_dir is None:
            # 默认：项目根目录 / data / council
            base_dir = Path(__file__).resolve().parents[3] / "data" / "council"
        self._base = Path(base_dir)
        self._msg_dir = self._base / "messages"
        self._threads_file = self._base / "threads.json"
        self._lock = threading.Lock()
        self._ensure_dirs()

    def _ensure_dirs(self) -> None:
        self._base.mkdir(parents=True, exist_ok=True)
        self._msg_dir.mkdir(parents=True, exist_ok=True)
        if not self._threads_file.exists():
            self._save_threads([])

    # ── 会话 CRUD ────────────────────────────────────────────────

    def list_threads(self, include_deleted: bool = False) -> list[dict[str, Any]]:
        """列出会话（按 updated_at 降序，置顶优先）。"""
        with self._lock:
            threads = self._load_threads()
        if not include_deleted:
            threads = [t for t in threads if not t.get("deleted_at")]
        # 置顶优先，再按 updated_at 降序
        # 元组排序：(pinned, updated_at) reverse=True → pinned=True 排前，updated_at 大的排前
        threads.sort(
            key=lambda t: (t.get("pinned", False), t.get("updated_at", "")),
            reverse=True,
        )
        return threads

    def create_thread(self, title: str | None = None) -> dict[str, Any]:
        """创建新会话。"""
        now_iso = _now_iso()
        thread = {
            "id": f"thr-{uuid.uuid4().hex[:12]}",
            "title": title or "未命名讨论",
            "created_at": now_iso,
            "updated_at": now_iso,
            "pinned": False,
            "deleted_at": None,
        }
        with self._lock:
            threads = self._load_threads()
            threads.append(thread)
            self._save_threads(threads)
            # 创建空消息文件
            self._save_messages(thread["id"], [])
        return thread

    def get_thread(self, thread_id: str) -> dict[str, Any] | None:
        """获取会话详情。"""
        with self._lock:
            threads = self._load_threads()
        for t in threads:
            if t["id"] == thread_id:
                return t
        return None

    def update_thread(
        self,
        thread_id: str,
        title: str | None = None,
        pinned: bool | None = None,
    ) -> dict[str, Any] | None:
        """更新会话标题/置顶状态。"""
        with self._lock:
            threads = self._load_threads()
            for t in threads:
                if t["id"] == thread_id:
                    if title is not None:
                        t["title"] = title
                    if pinned is not None:
                        t["pinned"] = pinned
                    t["updated_at"] = _now_iso()
                    self._save_threads(threads)
                    return t
        return None

    def delete_thread(self, thread_id: str) -> bool:
        """软删除会话。"""
        with self._lock:
            threads = self._load_threads()
            for t in threads:
                if t["id"] == thread_id:
                    t["deleted_at"] = _now_iso()
                    self._save_threads(threads)
                    return True
        return False

    def restore_thread(self, thread_id: str) -> dict[str, Any] | None:
        """恢复软删除的会话。"""
        with self._lock:
            threads = self._load_threads()
            for t in threads:
                if t["id"] == thread_id and t.get("deleted_at"):
                    t["deleted_at"] = None
                    t["updated_at"] = _now_iso()
                    self._save_threads(threads)
                    return t
        return None

    def list_deleted_threads(self) -> list[dict[str, Any]]:
        """列出已软删除的会话（回收站）。"""
        with self._lock:
            threads = self._load_threads()
        deleted = [t for t in threads if t.get("deleted_at")]
        deleted.sort(key=lambda t: t.get("deleted_at", ""), reverse=True)
        return deleted

    def touch_thread(self, thread_id: str) -> None:
        """更新会话的 updated_at（追加消息时调用）。"""
        with self._lock:
            threads = self._load_threads()
            for t in threads:
                if t["id"] == thread_id:
                    t["updated_at"] = _now_iso()
                    self._save_threads(threads)
                    break

    # ── 消息 CRUD ────────────────────────────────────────────────

    def list_messages(
        self, thread_id: str, limit: int = 200, offset: int = 0,
        include_deleted: bool = False,
    ) -> list[dict[str, Any]]:
        """获取会话消息（分页，默认排除软删除消息）。"""
        with self._lock:
            msgs = self._load_messages(thread_id)
        if not include_deleted:
            msgs = [m for m in msgs if not m.get("deleted_at")]
        return msgs[offset : offset + limit]

    def count_messages(self, thread_id: str, include_deleted: bool = False) -> int:
        """获取会话消息总数（默认排除软删除）。"""
        with self._lock:
            msgs = self._load_messages(thread_id)
        if not include_deleted:
            msgs = [m for m in msgs if not m.get("deleted_at")]
        return len(msgs)

    def clear_messages(self, thread_id: str) -> int:
        """清空会话所有消息，返回被清除的消息数。"""
        with self._lock:
            msgs = self._load_messages(thread_id)
            count = len(msgs)
            self._save_messages(thread_id, [])
        return count

    def append_message(self, thread_id: str, message: dict[str, Any]) -> dict[str, Any]:
        """追加消息到会话。"""
        msg = {
            "id": message.get("id") or f"msg-{uuid.uuid4().hex[:8]}",
            "thread_id": thread_id,
            "source": message.get("source", "system"),
            "content": message.get("content", ""),
            "timestamp": message.get("timestamp") or _now_ms(),
            "forgekin_id": message.get("forgekin_id"),
            "forgekin_name": message.get("forgekin_name"),
            "forgekin_role": message.get("forgekin_role"),
            "meta": message.get("meta", {}),
        }
        with self._lock:
            msgs = self._load_messages(thread_id)
            msgs.append(msg)
            self._save_messages(thread_id, msgs)
        self.touch_thread(thread_id)
        return msg

    def append_messages(self, thread_id: str, messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """批量追加消息。"""
        result: list[dict[str, Any]] = []
        with self._lock:
            msgs = self._load_messages(thread_id)
            for message in messages:
                msg = {
                    "id": message.get("id") or f"msg-{uuid.uuid4().hex[:8]}",
                    "thread_id": thread_id,
                    "source": message.get("source", "system"),
                    "content": message.get("content", ""),
                    "timestamp": message.get("timestamp") or _now_ms(),
                    "forgekin_id": message.get("forgekin_id"),
                    "forgekin_name": message.get("forgekin_name"),
                    "forgekin_role": message.get("forgekin_role"),
                    "meta": message.get("meta", {}),
                }
                msgs.append(msg)
                result.append(msg)
            self._save_messages(thread_id, msgs)
        self.touch_thread(thread_id)
        return result

    def update_message(
        self, thread_id: str, msg_id: str, content: str
    ) -> dict[str, Any] | None:
        """编辑消息内容（保留原文到 meta.edited_history）。"""
        with self._lock:
            msgs = self._load_messages(thread_id)
            for m in msgs:
                if m["id"] == msg_id:
                    # 保存编辑历史
                    history = m.get("meta", {}).get("edited_history", [])
                    history.append({
                        "content": m["content"],
                        "edited_at": _now_iso(),
                    })
                    m["content"] = content
                    m.setdefault("meta", {})["edited_history"] = history
                    m["meta"]["edited_at"] = _now_iso()
                    self._save_messages(thread_id, msgs)
                    return m
        return None

    def delete_message(self, thread_id: str, msg_id: str) -> bool:
        """软删除单条消息（设置 deleted_at）。"""
        with self._lock:
            msgs = self._load_messages(thread_id)
            for m in msgs:
                if m["id"] == msg_id:
                    m["deleted_at"] = _now_iso()
                    self._save_messages(thread_id, msgs)
                    return True
        return False

    def restore_message(self, thread_id: str, msg_id: str) -> dict[str, Any] | None:
        """恢复软删除的消息。"""
        with self._lock:
            msgs = self._load_messages(thread_id)
            for m in msgs:
                if m["id"] == msg_id and m.get("deleted_at"):
                    m.pop("deleted_at", None)
                    self._save_messages(thread_id, msgs)
                    return m
        return None

    # ── 文件 IO（调用方需持有 _lock）─────────────────────────────

    def _load_threads(self) -> list[dict[str, Any]]:
        try:
            return json.loads(self._threads_file.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, FileNotFoundError):
            return []

    def _save_threads(self, threads: list[dict[str, Any]]) -> None:
        self._threads_file.write_text(
            json.dumps(threads, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    def _msg_file(self, thread_id: str) -> Path:
        return self._msg_dir / f"{thread_id}.json"

    def _load_messages(self, thread_id: str) -> list[dict[str, Any]]:
        f = self._msg_file(thread_id)
        try:
            return json.loads(f.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, FileNotFoundError):
            return []

    def _save_messages(self, thread_id: str, messages: list[dict[str, Any]]) -> None:
        self._msg_file(thread_id).write_text(
            json.dumps(messages, ensure_ascii=False, indent=2), encoding="utf-8"
        )


# 模块级单例（FastAPI app 生命周期内复用）
_store: ThreadStore | None = None


def get_thread_store() -> ThreadStore:
    """获取 ThreadStore 单例。"""
    global _store
    if _store is None:
        _store = ThreadStore()
    return _store
