# 自主任务产出审阅

- **task_id**: swarm-6edd3d5f43eb
- **title**: 修复代码 TODO: flowforge\security\permission_v2.py
- **agent**: forgemind:sherlock
- **model**: Doubao-Seed2.0
- **generated_at**: 2026-07-31T22:45:11.697980+00:00
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

# 文件路径：flowforge/core/permission_v2.py

python

```
import asyncio
import hashlib
import json
import os
import time
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

# 项目内部枚举（根据工程原有导入补充占位，保持编译通过）
from flowforge.core.types import ActionLevel, PermissionDecision, PermissionRule

class ApprovalRequest(BaseModel):
    tool_name: str
    params: Dict[str, Any] = Field(default_factory=dict)
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
        self._pending: Dict[str, asyncio.Future[ApprovalResponse]] = {}

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
            resp = ApprovalResponse(
                request_id=request_id,
                approved=approved,
                reviewer=reviewer,
                comment=comment
            )
            self._pending[request_id].set_result(resp)

class PermissionV2:
    """PermissionV2 增强版权限管线
    deny→ask→allow三层，ASK超时fail-closed，并发去重，审计日志
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
        self._pending_asks: Dict[str, asyncio.Future[bool]] = {}
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
        # Only include stable, identifying params (path, action type)
        key_params = {
            "tool": tool_name,
            "action": action,
        }
        if "path" in params:
            key_params["path"] = params["path"]
        if "file_path" in params and "path" not in key_params:
            key_params["path"] = params["file_path"]
        key_str = json.dumps(key_params, sort_keys=True)
        return hashlib.sha256(key_str.encode()).hexdigest()[:16]

    def _load_decisions(self) -> None:
        """Load persisted decisions from JSON file."""
        if not self._store_path:
            return
        try:
            if os.path.exists(self._store_path):
                with open(self._store_path, "r", encoding="utf-8") as f:
                    
```