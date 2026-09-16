"""ApprovalStore — 审批中心 JSON 持久化存储.

参考 clowder-ai approvalHubStore（前端契约）与 thread_store（JSON 文件 + 锁）：
  - 审批项持久化到 data/approvals.json
  - 线程安全：threading.Lock 串行化读写
  - 原子写入：先写临时文件再替换，避免崩溃导致半写文件

数据结构（与前端 ApprovalItem 对齐）：
    {
      "id": "appr-xxx",
      "title": "审批标题",
      "description": "描述",
      "proposer": "forgekin_id",
      "proposed_at": "ISO8601",
      "status": "pending|approved|rejected|expired",
      "kind": "framework_change|self_modify|external_call",
      "risk_level": "low|medium|high",
      "detail_url": "..."
    }
"""

from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from flowforge.core.tracing import get_logger

logger = get_logger("approval_store")

_VALID_STATUSES = {"pending", "approved", "rejected", "expired"}
_VALID_RISK = {"low", "medium", "high"}


class ApprovalStore:
    """审批项持久化存储（JSON 文件 + threading.Lock）。"""

    def __init__(self, base_dir: Path | str | None = None) -> None:
        base_dir = Path(base_dir) if base_dir else Path(__file__).resolve().parents[3] / "data"
        self._base = Path(base_dir)
        self._base.mkdir(parents=True, exist_ok=True)
        self._file = self._base / "approvals.json"
        self._lock = threading.Lock()
        self._ensure_file()

    def _ensure_file(self) -> None:
        if not self._file.exists():
            self._atomic_write([])

    def _load(self) -> list[dict[str, Any]]:
        try:
            with open(self._file, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data if isinstance(data, list) else []
        except (json.JSONDecodeError, OSError) as e:
            logger.warning(f"Failed to load approvals, resetting: {e}")
            return []

    def _atomic_write(self, items: list[dict[str, Any]]) -> None:
        tmp = self._file.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(self._file)

    def list_approvals(
        self,
        status: Optional[str] = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        """列出审批项（可选状态过滤，新建在前）。"""
        with self._lock:
            items = self._load()
        if status:
            if status not in _VALID_STATUSES:
                raise ValueError(f"Invalid status: {status}")
            items = [i for i in items if i.get("status") == status]
        items.sort(key=lambda i: i.get("proposed_at", ""), reverse=True)
        return items[:limit]

    def create_approval(
        self,
        title: str,
        description: str = "",
        proposer: str = "",
        kind: str = "framework_change",
        risk_level: str = "medium",
        detail_url: str = "",
    ) -> dict[str, Any]:
        """创建审批项（默认 pending）。"""
        if not title.strip():
            raise ValueError("title is required")
        if risk_level not in _VALID_RISK:
            raise ValueError(f"Invalid risk_level: {risk_level}")
        item: dict[str, Any] = {
            "id": f"appr-{uuid.uuid4().hex[:12]}",
            "title": title.strip(),
            "description": description,
            "proposer": proposer,
            "proposed_at": datetime.now(timezone.utc).isoformat(),
            "status": "pending",
            "kind": kind,
            "risk_level": risk_level,
            "detail_url": detail_url,
        }
        with self._lock:
            items = self._load()
            items.append(item)
            self._atomic_write(items)
        return item

    def get_approval(self, approval_id: str) -> Optional[dict[str, Any]]:
        with self._lock:
            items = self._load()
        return next((i for i in items if i.get("id") == approval_id), None)

    def update_status(self, approval_id: str, status: str, reason: str = "") -> Optional[dict[str, Any]]:
        """更新审批项状态（approve/reject/expire）。"""
        if status not in _VALID_STATUSES:
            raise ValueError(f"Invalid status: {status}")
        with self._lock:
            items = self._load()
            for item in items:
                if item.get("id") == approval_id:
                    item["status"] = status
                    if reason:
                        item["decision_reason"] = reason
                    item["decided_at"] = datetime.now(timezone.utc).isoformat()
                    self._atomic_write(items)
                    return item
        return None


_store: Optional[ApprovalStore] = None
_store_lock = threading.Lock()


def get_approval_store() -> ApprovalStore:
    """获取全局 ApprovalStore 单例。"""
    global _store
    with _store_lock:
        if _store is None:
            _store = ApprovalStore()
        return _store
