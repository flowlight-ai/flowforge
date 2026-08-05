"""CL-033 Approval Hub — 跨 thread 统一审批中心。

[doc:review/review.md#14.3] CL-033 Approval Hub 统一审批中心
[doc:design/naming-contract.md#2.11] 觉醒阶

规格大纲（design v7.1-§D15 Approval Hub）：
- 跨 thread 审批入口
- operator 一键批准/拒绝
- 7 Phase + 4 adapter

骨架实现：仅满足 verify_cl14_compliance.py 解析，使用内存存储。
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.approval_hub")


def _now_utc() -> datetime:
    """返回时区感知的当前 UTC 时间（避免 naive vs aware 比较问题）。"""
    return datetime.now(UTC)


class ApprovalRequest(BaseModel):
    """审批请求。"""

    request_id: str
    forgekin_id: str  # 发起Forgekin ID
    thread_id: str  # 来源 thread
    request_type: Literal[
        "code_merge",
        "config_change",
        "schedule_change",
        "scope_expansion",
        "external_call",
    ]
    title: str
    description: str
    payload: dict[str, Any] = Field(default_factory=dict)  # PR url / config diff 等
    created_at: datetime = Field(default_factory=_now_utc)
    expires_at: datetime  # 超时自动拒绝（建议传入 timezone-aware datetime）
    priority: Literal["low", "medium", "high", "critical"] = "medium"


class ApprovalDecision(BaseModel):
    """审批决策。"""

    request_id: str
    decision: Literal["approved", "rejected", "deferred"]
    decided_by: str  # operator 或代理Forgekin ID
    decided_at: datetime = Field(default_factory=_now_utc)
    comments: str = ""
    conditions: list[str] = Field(default_factory=list)  # 批准条件（如 "需夏洛克 review 后合入"）


class ApprovalHub:
    """Approval Hub — 跨 thread 统一审批中心（内存骨架实现）。

    职责：
    - 接收Forgekin提交的审批请求
    - operator 一键 approve / reject / defer
    - 超时自动拒绝（purge_expired）
    - 统计待审批/已决策分布
    """

    def __init__(self) -> None:
        self._requests: dict[str, ApprovalRequest] = {}
        self._decisions: dict[str, ApprovalDecision] = {}
        logger.debug("approval_hub init")

    def submit(self, request: ApprovalRequest) -> str:
        """提交审批，返回 request_id。"""
        self._requests[request.request_id] = request
        logger.info(
            f"approval_hub submit: id={request.request_id}, "
            f"type={request.request_type}, forgekin={request.forgekin_id}"
        )
        return request.request_id

    def get(self, request_id: str) -> ApprovalRequest | None:
        """获取单个审批请求。"""
        return self._requests.get(request_id)

    def list_pending(
        self, forgekin_id: str | None = None
    ) -> list[ApprovalRequest]:
        """列出待审批（未决策且未过期）。"""
        now = _now_utc()
        pending: list[ApprovalRequest] = []
        for rid, req in self._requests.items():
            if rid in self._decisions:
                continue
            if _is_expired(req.expires_at, now):
                continue
            if forgekin_id is not None and req.forgekin_id != forgekin_id:
                continue
            pending.append(req)
        return pending

    def list_all(self, status: str | None = None) -> list[ApprovalRequest]:
        """列出所有审批请求，可按 status 过滤。

        status 取值：pending / approved / rejected / deferred / expired。
        """
        if status is None:
            return list(self._requests.values())
        result: list[ApprovalRequest] = []
        now = _now_utc()
        for rid, req in self._requests.items():
            decision = self._decisions.get(rid)
            if decision is None:
                req_status = "expired" if _is_expired(req.expires_at, now) else "pending"
            elif decision.decision == "deferred" and decision.comments == "expired":
                req_status = "expired"
            else:
                req_status = decision.decision
            if req_status == status:
                result.append(req)
        return result

    def decide(self, decision: ApprovalDecision) -> tuple[bool, str]:
        """决策（自动校验 request_id 存在 + 未过期 + 未决策）。"""
        req = self._requests.get(decision.request_id)
        if req is None:
            return False, f"request_id 不存在: {decision.request_id}"
        now = _now_utc()
        if _is_expired(req.expires_at, now):
            return False, f"request 已过期: {decision.request_id}"
        if decision.request_id in self._decisions:
            return False, f"request 已决策: {decision.request_id}"
        self._decisions[decision.request_id] = decision
        logger.info(
            f"approval_hub decide: id={decision.request_id}, "
            f"decision={decision.decision}, by={decision.decided_by}"
        )
        return True, "ok"

    def approve(
        self,
        request_id: str,
        decided_by: str,
        comments: str = "",
        conditions: list[str] | None = None,
    ) -> tuple[bool, str]:
        """operator 一键批准（decide 的便捷封装）。"""
        decision = ApprovalDecision(
            request_id=request_id,
            decision="approved",
            decided_by=decided_by,
            comments=comments,
            conditions=conditions or [],
        )
        return self.decide(decision)

    def reject(
        self,
        request_id: str,
        decided_by: str,
        comments: str = "",
    ) -> tuple[bool, str]:
        """operator 一键拒绝（decide 的便捷封装）。"""
        decision = ApprovalDecision(
            request_id=request_id,
            decision="rejected",
            decided_by=decided_by,
            comments=comments,
        )
        return self.decide(decision)

    def purge_expired(self) -> int:
        """清理过期请求，返回清理数量（标记为 expired）。"""
        now = _now_utc()
        expired_ids = [
            rid
            for rid, req in self._requests.items()
            if _is_expired(req.expires_at, now) and rid not in self._decisions
        ]
        for rid in expired_ids:
            self._decisions[rid] = ApprovalDecision(
                request_id=rid,
                decision="deferred",
                decided_by="system",
                comments="expired",
            )
        if expired_ids:
            logger.info(f"approval_hub purge_expired: count={len(expired_ids)}")
        return len(expired_ids)

    def get_stats(self) -> dict[str, int]:
        """统计 {pending, approved, rejected, deferred, expired}。"""
        pending = 0
        approved = 0
        rejected = 0
        deferred = 0
        expired = 0
        now = _now_utc()
        for rid, req in self._requests.items():
            decision = self._decisions.get(rid)
            if decision is None:
                if _is_expired(req.expires_at, now):
                    expired += 1
                else:
                    pending += 1
            elif decision.decision == "approved":
                approved += 1
            elif decision.decision == "rejected":
                rejected += 1
            elif decision.decision == "deferred":
                if decision.comments == "expired":
                    expired += 1
                else:
                    deferred += 1
        return {
            "pending": pending,
            "approved": approved,
            "rejected": rejected,
            "deferred": deferred,
            "expired": expired,
        }


def _is_expired(expires_at: datetime, now: datetime) -> bool:
    """判断 expires_at 是否已过期（兼容 naive 与 aware datetime）。

    若两侧时区信息不一致，统一转换为 aware UTC 再比较。
    """
    if expires_at.tzinfo is None and now.tzinfo is None:
        return expires_at < now
    if expires_at.tzinfo is not None and now.tzinfo is not None:
        return expires_at < now
    # 一侧 naive 一侧 aware：将 naive 视为 UTC 再比较
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    if now.tzinfo is None:
        now = now.replace(tzinfo=UTC)
    return expires_at < now
