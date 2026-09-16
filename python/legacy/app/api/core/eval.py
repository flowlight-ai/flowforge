"""Eval API — 评估任务与判决（真实实现）。

前端 HubEvalTab / HubEvalVerdictCard 期望接口（对齐契约）：
    - ``GET  /api/v1/eval/tasks``           → {"items": EvalTask[], "total": N}
    - ``POST /api/v1/eval/{taskId}/verdict`` → body {"verdict", "feedback"}
      EvalTask = {id, title, forgekinId, forgekinName, type, status,
                  qualityScore?, frictionScore?, createdAt}
      verdict 取值：approve | reject | redo

数据源（真实）：
    - ``data/checkpoints.db``          — LangGraph 检查点（真实任务清单）
    - ``data/settings/eval_verdicts.json`` — 判决持久化（提交即写入）
"""

from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from flowforge.app.api.core.logs import get_audit_logger

router = APIRouter(prefix="/eval", tags=["eval"])

_ROOT = Path(__file__).resolve().parents[3]
_LOCK = threading.Lock()

_VALID_VERDICTS = {"approve", "reject", "redo"}

# 判决 → 质量分（真实判决语义映射）
_VERDICT_QUALITY = {"approve": 0.95, "redo": 0.6, "reject": 0.3}

_CHECKPOINT_DB = _ROOT / "data" / "checkpoints.db"

# state_json 中常见的任务字段（按优先级取标题）
_TITLE_FIELDS = ("task", "title", "topic", "intent")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _verdicts_path() -> Path:
    return _ROOT / "data" / "settings" / "eval_verdicts.json"


def _load_verdicts() -> dict[str, dict[str, Any]]:
    path = _verdicts_path()
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def _save_verdicts(verdicts: dict[str, dict[str, Any]]) -> None:
    path = _verdicts_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(verdicts, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def _infer_type(state: dict[str, Any]) -> str:
    """根据任务状态推断产出类型（content/code/novel/mall/dev）。"""
    text = json.dumps(state, ensure_ascii=False)
    if any(k in text for k in ("Python", "代码", "code", "GIL", "函数", "函数")):
        return "code"
    if "research_areas" in state or "市场" in text or "产业" in text:
        return "dev"
    if "小说" in text or "novel" in text:
        return "novel"
    if "电商" in text or "mall" in text or "运营" in text:
        return "mall"
    return "content"


def _extract_title(state: dict[str, Any]) -> str:
    for field in _TITLE_FIELDS:
        value = state.get(field)
        if isinstance(value, str) and value.strip():
            text = value.strip().replace("\n", " ")
            return text[:80] + ("…" if len(text) > 80 else "")
    return "未命名评估任务"


def _load_tasks(limit: int, offset: int) -> list[dict[str, Any]]:
    if not _CHECKPOINT_DB.exists():
        return []
    verdicts = _load_verdicts()
    tasks: list[dict[str, Any]] = []
    try:
        conn = sqlite3.connect(f"file:{_CHECKPOINT_DB}?mode=ro", uri=True)
        try:
            rows = conn.execute(
                "SELECT task_id, state_json, created_at FROM checkpoints "
                "GROUP BY task_id ORDER BY MAX(created_at) DESC"
            ).fetchall()
        finally:
            conn.close()
    except sqlite3.Error:
        return []

    for task_id, state_json, created_at in rows:
        try:
            state = json.loads(state_json) if state_json else {}
        except json.JSONDecodeError:
            state = {}
        verdict = verdicts.get(task_id)
        tasks.append({
            "id": task_id,
            "title": _extract_title(state),
            "forgekinId": "forgemind:default",
            "forgekinName": "default",
            "type": _infer_type(state),
            "status": "completed" if verdict else "pending",
            "qualityScore": _VERDICT_QUALITY.get(verdict.get("verdict")) if verdict else None,
            "createdAt": created_at,
        })
    tasks.sort(key=lambda t: t["createdAt"] or "", reverse=True)
    return tasks[offset:offset + limit]


class VerdictRequest(BaseModel):
    """评估判决请求体。"""

    verdict: str = Field(..., description="判决: approve | reject | redo")
    feedback: str = Field(default="", description="判决反馈")


@router.get("/tasks")
async def list_eval_tasks(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    """列出评估任务（从 checkpoints 真实数据构造）。"""
    items = _load_tasks(limit, offset)
    return {"items": items, "total": len(items), "limit": limit, "offset": offset}


@router.post("/{task_id}/verdict")
async def submit_verdict(task_id: str, payload: VerdictRequest) -> dict[str, Any]:
    """提交评估判决（持久化 + 审计）。"""
    if payload.verdict not in _VALID_VERDICTS:
        raise HTTPException(
            status_code=422,
            detail=f"verdict must be one of {sorted(_VALID_VERDICTS)}, got '{payload.verdict}'",
        )
    with _LOCK:
        verdicts = _load_verdicts()
        existing = verdicts.get(task_id)
        if existing and existing.get("verdict") == payload.verdict:
            return {
                "task_id": task_id,
                "verdict": payload.verdict,
                "status": "unchanged",
                "submitted_at": existing.get("submitted_at"),
            }
        entry = {
            "task_id": task_id,
            "verdict": payload.verdict,
            "feedback": payload.feedback,
            "quality_score": _VERDICT_QUALITY.get(payload.verdict),
            "submitted_at": _now(),
        }
        verdicts[task_id] = entry
        _save_verdicts(verdicts)

    get_audit_logger().log(
        level="info",
        action="eval.verdict",
        task_id=task_id,
        details={"verdict": payload.verdict, "feedback": payload.feedback[:200]},
    )
    return {
        "task_id": task_id,
        "verdict": payload.verdict,
        "status": "submitted",
        "submitted_at": entry["submitted_at"],
    }
