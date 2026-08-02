# 自主任务产出审阅

- **task_id**: swarm-3f0d9cf3fe71
- **title**: 修复代码 TODO: flowforge\security\permission_v2.py
- **agent**: forgemind:sherlock
- **model**: glm-4-flash
- **generated_at**: 2026-08-01T11:28:57.806021+00:00
- **source_file**: flowforge\security\permission_v2.py
- **required_capabilities**: code_generation

## 审阅指南

1. 检查产出的代码是否符合项目规范（CONTRIBUTING.md 15 条红线）
2. 检查是否引入循环依赖或违反分层架构
3. 通过审核后，将下方代码块内容应用到对应源文件
4. 应用后必须运行对应测试验证（铁律 T1-T8）

## 任务上下文

```
文件 flowforge\security\permission_v2.py 中发现 2 处 TODO/FIXME/NotImplementedError。请分析代码上下文并实现缺失的逻辑。
```

## LLM 产出内容

```python
# 文件路径: flowforge\security\permission_v2.py

"""PermissionV2 — 增强版权限管线

设计文档参考：S3.0-9 CAP-02, FR-HRN-05
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional

from pydantic import BaseModel

logger = logging.getLogger(__name__)


class PermissionDecision(str, Enum):
    DENY = "deny"
    ASK = "ask"
    ALLOW = "allow"
    ALWAYS_ALLOW = "always_allow"
    ALWAYS_DENY = "always_deny"


class ActionLevel(str, Enum):
    READ = "read"
    SUGGEST = "suggest"
    PREPARE = "prepare"
    EXECUTE = "execute"


@dataclass
class PermissionRule:
    tool_name: str
    action_level: ActionLevel
    decision: PermissionDecision
    reason: str = ""
    conditions: Dict[str, Any] = field(default_factory=dict)


class ApprovalRequest(BaseModel):
    tool_name: str
    params: Dict[str, Any] = {}
    reason: str = ""
    timeout: float = 300.0
    request_id: str = ""


class ApprovalResponse(BaseModel):
    request_id: str
    approved: bool = False
    reviewer: str = ""
    comment: str = ""


class AuditLogEntry(BaseModel):
    timestamp: float = 0.0
    decision: str = ""
    tool_name: str = ""
    params_summary: str = ""
    reason: str = ""
    timeout: bool = False
    trace_id: str = ""
    session_id: str = ""


class ApprovalProvider:
    async def push(self, request: ApprovalRequest) -> None:
        raise NotImplementedError

    async def wait_for_response(self, request_id: str, timeout: float) -> ApprovalResponse:
        raise NotImplementedError


class WebSocketApprovalProvider(ApprovalProvider):
    def __init__(self, event_bus: Any = None):
        self._event_bus = event_bus
        self._pending: Dict[str, asyncio.Future] = {}

    async def push(self, request: ApprovalRequest) -> None:
        if self._event_bus:
            await self._event_bus.emit("permission.approval_required", {
                "request_id": request.request_id,
                "tool_name": request.tool_name,
                "reason": request.reason,
                "timeout": request.timeout,
            })

    async def wait_for_response(self, request_id: str, timeout: float) -> ApprovalResponse:
        if request_id in self._pending:
            try:
                return await asyncio.wait_for(self._pending[request_id], timeout=timeout)
            except asyncio.TimeoutError:
                return ApprovalResponse(request_id=request_id, approved=False, comment="Timeout")
        return ApprovalResponse(request_id=request_id, approved=False, comment="No pending request")

    def register_response(self, request_id: str, approved: bool, reviewer: str = "", comment: str = "") -> None:
        if request_id in self._pending and not self._pending[request_id].done():
            self._pending[request_id].set_result(
                ApprovalResponse(request_id=request_id, approved=approved, reviewer=reviewer, comment=comment)
            )


class PermissionV2:
    """PermissionV2 增强版权限管线

    deny→ask→allow三层，ASK超时fail-closed，并发去重，审计日志
    """

    def __init__(
        self, rules: Optional[List[PermissionRule]] = None,
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
            ActionLevel.EXECUTE: PermissionDecision.DENY,
        }
        self._decision_store: Dict[str, str] = {}
        self._store_path: Optional[str] = "flowforge/config/permission_decisions.json"
        self._load_decisions()

    def add_rule(self, rule: PermissionRule) -> None:
        self._rules.append(rule)

    def _make_key(self, tool_name: str, action: str, params: dict) -> str:
        """Generate a decision key from tool name, action, and key params."""
        import hashlib
        import json as json_mod
        # Only include stable, identifying params (path, action type)
        key_params = {
            "tool": tool_name,
            "action": action,
        }
        if "path" in params:
            key_params["path"] = params["path"]
        if "file_path" in params:
            key_params["path"] = params["file_path"]
        key_str = json_mod.dumps(key_params, sort_keys=True)
        return hashlib.sha256(key_str.encode()).hexdigest()[:16]

    def _load_decisions(self) -> None:
        """Load persisted decisions from JSON file."""
        import os
        import json as json_mod
        if not self._store_path:
            return
        try:
            if os.path.exists(self._store_path):
                with open(self._store_path, "r", encoding="utf-8") as f:
                    self._decision_store = json_mod.load(f)
        except Exception as e:
            logger.warning(f"Failed to load permission decisions: {e}")
            self._decision_store = {}

    def _save_decisions(self) -> None:
        """Save decisions to JSON file."""
        import os
        import json as json_mod
        if not self._store_path:
            return
        try:
            dir_path = os.path.dirname(self._store_path)
            if dir_path:
                os.makedirs(dir_path, exist_ok=True)
            with open(self._store_path, "w", encoding="utf-8") as f:
                json_mod.dump(self._decision_store, f, indent=2, ensure_ascii=False)
        except Exception as e:
            logger.warning(f"Failed to save permission decisions: {e}")

    def record_decision(self, key: str, decision: str) -> None:
        """Record a user's always-allow/always-deny decision."""
        if decision in ("always_allow", "always_deny"):
            self._decision_store[key] = decision
            self._save_decisions()

    async def check(
        self, tool_name: str, params: Dict[str, Any] = None,
        action_level: ActionLevel = ActionLevel.EXECUTE,
        context: Optional[Dict[str, Any]] = None,
    ) -> bool:
        params = params or {}
        # Check persisted decisions first
        key = self._make_key(tool_name, action_level.value, params)
        if key in self._decision_store:
            decision = self._decision_store[key]
            if decision == "always_allow":
                await self._record_audit("allow", tool_name, params, "Persisted: always allow")
                return True
            elif decision == "always_deny":
                await self._record_audit("deny", tool_name, params, "Persisted: always deny")
                return False
        decision = self._evaluate_rules(tool_name, params, action_level, context)

        if decision == PermissionDecision.DENY:
            await self._record_audit("deny", tool_name, params, "Rule denied")
            return False
        if decision == PermissionDecision.ALLOW:
            await self._record_audit("allow", tool_name, params, "Rule allowed")
            return True
        return await self._request_user_approval(tool_name, params, context)

    def _evaluate_rules(self, tool_name: str, params: Dict[str, Any], action_level: ActionLevel, context: Optional[Dict[str, Any]]) -> PermissionDecision:
        result = self._action_level_defaults.get(action_level, PermissionDecision.ASK)
        for rule in self._rules:
            if rule.tool_name != "*" and rule.tool_name != tool_name:
                continue
            if rule.decision == PermissionDecision.DENY:
                return PermissionDecision.DENY
            if rule.decision == PermissionDecision.ASK and result == PermissionDecision.ALLOW:
                result = PermissionDecision.ASK
            if rule.decision == PermissionDecision.ALLOW and result == PermissionDecision.ALLOW:
                result = PermissionDecision.ALLOW
        return result

    async def _request_user_approval(self, tool_name: str, params: Dict[str, Any], context: Optional[Dict[str, Any]] = None) -> bool:
        dedup_key = f"{tool_name}:{hash(frozenset(params.items()))}"

        if dedup_key in self._pending_asks:
            try:
                return await asyncio.wait_for(self._pending_asks[dedup_key], timeout=self._default_timeout)
            except asyncio.TimeoutError:
                return False

        future = asyncio.get_event_loop().create_future()
        self._pending_asks[dedup_key] = future

        if self._approval_provider:
            request = ApprovalRequest(
                tool_name=tool_name, params=params,
                reason=f"Action requires approval: {tool_name}",
                timeout=self._default_timeout, request_id=dedup_key,
            )
            await self._approval_provider.push(request)

        try:
            result = await asyncio.wait_for(future, timeout=self._default_timeout)
            await self._record_audit("allow" if result else "deny", tool_name, params, "User approved" if result else "User denied")
            return result
        except asyncio.TimeoutError:
            await self._record_audit("deny", tool_name, params, "ASK timeout (fail-closed)", timeout=True)
            return False
        finally:
            self._pending_asks.pop(dedup_key, None)

    async def _record_audit(self, decision: str, tool_name: str, params: Dict[str, Any], reason: str, timeout: bool = False) -> None:
        params_summary = self._summarize_params(params)
        self._audit_log.append(AuditLogEntry(
            timestamp=time.time(), decision=decision, tool_name=tool_name,
            params_summary=params_summary, reason=reason, timeout=timeout,
        ))
        logger.info(f"Permission audit: {decision} {tool_name} - {reason}")

    def _summarize_params(self, params: Dict[str, Any]) -> str:
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
        entries = self._audit_log
        if tool_name:
            entries = [e for e in entries if e.tool_name == tool_name]
        return entries[-limit:]

    def resolve_pending(self, dedup_key: str, approved: bool) -> None:
        if dedup_key in self._pending_asks and not self._pending_asks[dedup_key].done():
            self._pending_asks[dedup_key].set_result(approved)
```