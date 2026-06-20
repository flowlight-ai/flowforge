"""PermissionV2 — 增强版权限管线

设计文档参考：
- S3.0-9: CAP-02 PermissionV2功能完整性
- FR-HRN-05: 权限管线 deny→ask→allow
- spec.md v2.2: 向后兼容切换策略
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Set

from pydantic import BaseModel

logger = logging.getLogger(__name__)


class PermissionDecision(str, Enum):
    """权限决策"""
    DENY = "deny"
    ASK = "ask"
    ALLOW = "allow"


class ActionLevel(str, Enum):
    """动作级别"""
    READ = "read"           # 只读，auto_approved
    SUGGEST = "suggest"     # 建议，prompt_user
    PREPARE = "prepare"     # 准备，prompt_user
    EXECUTE = "execute"     # 执行，require_approval


@dataclass
class PermissionRule:
    """权限规则"""
    tool_name: str
    action_level: ActionLevel
    decision: PermissionDecision
    reason: str = ""
    conditions: Dict[str, Any] = field(default_factory=dict)


class ApprovalRequest(BaseModel):
    """审批请求"""
    tool_name: str
    params: Dict[str, Any]
    reason: str
    timeout: float = 300.0
    request_id: str = ""


class ApprovalResponse(BaseModel):
    """审批响应"""
    request_id: str
    approved: bool
    reviewer: str = ""
    comment: str = ""


class AuditLogEntry(BaseModel):
    """审计日志条目"""
    timestamp: float
    decision: str  # allow/deny
    tool_name: str
    params_summary: str  # 参数摘要（脱敏）
    reason: str
    timeout: bool = False
    trace_id: str = ""
    session_id: str = ""


class ApprovalProvider:
    """审批提供者基类"""

    async def push(self, request: ApprovalRequest) -> None:
        """推送审批请求"""
        raise NotImplementedError

    async def wait_for_response(self, request_id: str, timeout: float) -> ApprovalResponse:
        """等待审批响应"""
        raise NotImplementedError


class WebSocketApprovalProvider(ApprovalProvider):
    """WebSocket审批提供者 — 通过WebSocket推送审批请求到前端"""

    def __init__(self, event_bus: Any = None):
        self._event_bus = event_bus
        self._pending: Dict[str, asyncio.Future] = {}

    async def push(self, request: ApprovalRequest) -> None:
        """通过EventBus推送审批请求"""
        if self._event_bus:
            await self._event_bus.emit("permission.approval_required", {
                "request_id": request.request_id,
                "tool_name": request.tool_name,
                "reason": request.reason,
                "timeout": request.timeout,
            })

    async def wait_for_response(self, request_id: str, timeout: float) -> ApprovalResponse:
        """等待审批响应"""
        if request_id in self._pending:
            return await asyncio.wait_for(self._pending[request_id], timeout=timeout)
        return ApprovalResponse(request_id=request_id, approved=False, comment="No pending request")

    def register_response(self, request_id: str, approved: bool, reviewer: str = "", comment: str = "") -> None:
        """注册审批响应"""
        if request_id in self._pending:
            self._pending[request_id].set_result(
                ApprovalResponse(request_id=request_id, approved=approved, reviewer=reviewer, comment=comment)
            )


class PermissionV2:
    """PermissionV2 增强版权限管线

    特性：
    1. deny → ask → allow 三层管线
    2. ASK超时处理（默认5分钟，fail-closed）
    3. 并发ASK去重
    4. 审计日志
    5. WebSocketApprovalProvider
    """

    def __init__(
        self,
        rules: Optional[List[PermissionRule]] = None,
        approval_provider: Optional[ApprovalProvider] = None,
        default_timeout: float = 300.0,
    ):
        self._rules: List[PermissionRule] = rules or []
        self._approval_provider = approval_provider
        self._default_timeout = default_timeout
        self._pending_asks: Dict[str, asyncio.Future] = {}
        self._audit_log: List[AuditLogEntry] = []
        self._action_level_defaults: Dict[ActionLevel, PermissionDecision] = {
            ActionLevel.READ: PermissionDecision.ALLOW,
            ActionLevel.SUGGEST: PermissionDecision.ASK,
            ActionLevel.PREPARE: PermissionDecision.ASK,
            ActionLevel.EXECUTE: PermissionDecision.DENY,  # fail-closed for execute
        }

    def add_rule(self, rule: PermissionRule) -> None:
        """添加权限规则"""
        self._rules.append(rule)

    async def check(
        self,
        tool_name: str,
        params: Dict[str, Any],
        action_level: ActionLevel = ActionLevel.EXECUTE,
        context: Optional[Dict[str, Any]] = None,
    ) -> bool:
        """检查权限

        三层管线：deny → ask → allow
        - deny永远胜出
        - ask需要用户审批
        - allow直接通过
        """
        decision = self._evaluate_rules(tool_name, params, action_level, context)

        if decision == PermissionDecision.DENY:
            await self._record_audit("deny", tool_name, params, "Rule denied")
            return False

        if decision == PermissionDecision.ALLOW:
            await self._record_audit("allow", tool_name, params, "Rule allowed")
            return True

        # decision == ASK
        return await self._request_user_approval(tool_name, params, context)

    def _evaluate_rules(
        self,
        tool_name: str,
        params: Dict[str, Any],
        action_level: ActionLevel,
        context: Optional[Dict[str, Any]],
    ) -> PermissionDecision:
        """评估规则，返回最终决策

        三层管线：deny > ask > allow
        """
        result = self._action_level_defaults.get(action_level, PermissionDecision.ASK)

        for rule in self._rules:
            if rule.tool_name != "*" and rule.tool_name != tool_name:
                continue
            # deny永远胜出
            if rule.decision == PermissionDecision.DENY:
                return PermissionDecision.DENY
            # ask覆盖allow
            if rule.decision == PermissionDecision.ASK and result == PermissionDecision.ALLOW:
                result = PermissionDecision.ASK
            # allow只在当前为ask时不覆盖
            if rule.decision == PermissionDecision.ALLOW and result == PermissionDecision.ALLOW:
                result = PermissionDecision.ALLOW

        return result

    async def _request_user_approval(
        self,
        tool_name: str,
        params: Dict[str, Any],
        context: Optional[Dict[str, Any]] = None,
    ) -> bool:
        """请求用户审批，含超时和去重"""
        # 去重：同一tool+params的ASK只发一次
        dedup_key = f"{tool_name}:{hash(frozenset(params.items()))}"

        if dedup_key in self._pending_asks:
            try:
                return await asyncio.wait_for(self._pending_asks[dedup_key], timeout=self._default_timeout)
            except asyncio.TimeoutError:
                return False

        # 发起审批
        future = asyncio.get_event_loop().create_future()
        self._pending_asks[dedup_key] = future

        # 推送审批请求
        if self._approval_provider:
            request = ApprovalRequest(
                tool_name=tool_name,
                params=params,
                reason=f"Action requires approval: {tool_name}",
                timeout=self._default_timeout,
                request_id=dedup_key,
            )
            await self._approval_provider.push(request)

        # 等待结果（含超时）
        try:
            result = await asyncio.wait_for(future, timeout=self._default_timeout)
            await self._record_audit(
                "allow" if result else "deny",
                tool_name, params,
                "User approved" if result else "User denied"
            )
            return result
        except asyncio.TimeoutError:
            # ASK超时默认DENY（fail-closed）
            await self._record_audit(
                "deny", tool_name, params,
                "ASK timeout (fail-closed)", timeout=True
            )
            return False
        finally:
            self._pending_asks.pop(dedup_key, None)

    async def _record_audit(
        self,
        decision: str,
        tool_name: str,
        params: Dict[str, Any],
        reason: str,
        timeout: bool = False,
    ) -> None:
        """记录审计日志"""
        params_summary = self._summarize_params(params)
        entry = AuditLogEntry(
            timestamp=time.time(),
            decision=decision,
            tool_name=tool_name,
            params_summary=params_summary,
            reason=reason,
            timeout=timeout,
        )
        self._audit_log.append(entry)
        logger.info(f"Permission audit: {decision} {tool_name} - {reason}")

    def _summarize_params(self, params: Dict[str, Any]) -> str:
        """参数摘要（脱敏）"""
        sensitive_keys = {"password", "token", "api_key", "secret", "credential"}
        summary = {}
        for k, v in params.items():
            if any(s in k.lower() for s in sensitive_keys):
                summary[k] = "***"
            else:
                val_str = str(v)
                summary[k] = val_str[:50] + "..." if len(val_str) > 50 else val_str
        return str(summary)

    def get_audit_log(self, tool_name: Optional[str] = None, limit: int = 100) -> List[AuditLogEntry]:
        """获取审计日志"""
        entries = self._audit_log
        if tool_name:
            entries = [e for e in entries if e.tool_name == tool_name]
        return entries[-limit:]

    def resolve_pending(self, dedup_key: str, approved: bool) -> None:
        """外部解决pending的ASK请求"""
        if dedup_key in self._pending_asks:
            self._pending_asks[dedup_key].set_result(approved)
