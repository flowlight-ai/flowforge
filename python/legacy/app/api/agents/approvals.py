"""Approvals API — 审批中心（待审批项列表 + 审批/拒绝 + 创建）.

参考 clowder-ai ApprovalHub（web/src/stores/approvalHubStore.ts 前端契约），
后端对齐以下端点：
    - ``GET    /api/v1/approvals``                — 审批项列表（status/limit 过滤）
    - ``POST   /api/v1/approvals``                — 创建审批项（供智能体自改进调用）
    - ``POST   /api/v1/approvals/{id}/approve``   — 批准
    - ``POST   /api/v1/approvals/{id}/reject``    — 拒绝（可携带原因）

前端契约：
    - 列表返回 ``{"items": [...], "total": n}``
    - 状态字段：pending / approved / rejected / expired
    - 审批/拒绝均返回更新后的审批项
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from flowforge.app.api.agents.approval_store import get_approval_store

router = APIRouter(prefix="/approvals", tags=["approvals"])


# ── 请求模型 ────────────────────────────────────────────────────


class ApprovalCreate(BaseModel):
    """审批项创建请求体。"""

    title: str = Field(..., description="审批标题")
    description: str = Field(default="", description="审批描述")
    proposer: str = Field(default="", description="提议者（如 forgekin_id）")
    kind: str = Field(default="framework_change", description="类型：framework_change/self_modify/external_call")
    risk_level: str = Field(default="medium", description="风险等级：low/medium/high")
    detail_url: str = Field(default="", description="详情 URL")


class ApprovalReject(BaseModel):
    """审批拒绝请求体。"""

    reason: str = Field(default="", description="拒绝原因")


# ── 审批端点 ────────────────────────────────────────────────────


@router.get("")
async def list_approvals(
    status: str | None = Query(None, description="状态过滤：pending/approved/rejected/expired"),
    limit: int = Query(100, ge=1, le=500),
) -> dict[str, Any]:
    """列出审批项（新建在前，可选状态过滤）。"""
    store = get_approval_store()
    try:
        items = store.list_approvals(status=status, limit=limit)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"items": items, "total": len(items), "status": status, "limit": limit}


@router.post("")
async def create_approval(payload: ApprovalCreate) -> dict[str, Any]:
    """创建审批项（默认 pending，供智能体自改进/外部调用发起审批）。"""
    store = get_approval_store()
    try:
        item = store.create_approval(
            title=payload.title,
            description=payload.description,
            proposer=payload.proposer,
            kind=payload.kind,
            risk_level=payload.risk_level,
            detail_url=payload.detail_url,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return item


@router.post("/{approval_id}/approve")
async def approve_approval(approval_id: str) -> dict[str, Any]:
    """批准审批项。"""
    store = get_approval_store()
    item = store.update_status(approval_id, "approved")
    if item is None:
        raise HTTPException(status_code=404, detail=f"Approval not found: {approval_id}")
    return item


@router.post("/{approval_id}/reject")
async def reject_approval(approval_id: str, payload: ApprovalReject | None = None) -> dict[str, Any]:
    """拒绝审批项（可携带原因）。"""
    store = get_approval_store()
    reason = (payload.reason if payload else "") or ""
    item = store.update_status(approval_id, "rejected", reason=reason)
    if item is None:
        raise HTTPException(status_code=404, detail=f"Approval not found: {approval_id}")
    return item
