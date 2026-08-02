# 自主任务产出审阅

- **task_id**: swarm-afa910e59ae4
- **title**: 修复代码 TODO: flowforge\security\permission_v2.py
- **agent**: forgemind:sherlock
- **model**: Doubao-Seed2.0
- **generated_at**: 2026-07-31T23:04:23.553476+00:00
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
from typing import Any, Dict, List, Optional, Union
from pydantic import BaseModel, Field
from logging import getLogger

logger = getLogger(__name__)

# 项目原有枚举定义（补齐代码依赖，保持与工程一致）
class ActionLevel(str):
    READ = "READ"
    SUGGEST = "SUGGEST"
    PREPARE = "PREPARE"
    EXECUTE = "EXECUTE"

class PermissionDecision(str):
    DENY = "deny"
    ALLOW = "allow"
    ASK = "ask"

class PermissionRule(BaseModel):
    tool_name: str
    decision: PermissionDecision

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
        raise NotImplementedError("Subclasses must implement push()")

    async def wait_for_response(self, request_id: str, timeout: float) -> ApprovalResponse:
        raise NotImplementedError("Subclasses must implement wait_for_response()")

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
        if request_id not in self._pending:
            return ApprovalResponse(
                request_id=request_id,
                approved=False,
                comment="No pending request"
            )
        try:
            return await asyncio.wait_for(self._pending[request_id], timeout=timeout)
        except asyncio.TimeoutError:
            return ApprovalResponse(
                request_id=request_id,
                approved=False,
                comment="Timeout"
            )

    def register_response(self, request_id: str, approved: bool, reviewer: str = "", comment: str = "") -> None:
        if request_id in self._pending and not self._pending[request_id].done():
            resp = ApprovalResponse(
                request_id=request_id,
                approved=approved,
                reviewer=reviewer,
                comment=comment
            )
            self._pending[request_id].set_result(resp)

    def create_future(self, request_id: str) -> None:
        """为等待中的审批创建Future，由PermissionV2调用"""
        if request_id not in self._pending:
            self._pending[request_id] = asyncio.get_event_loop().create_future()

    def cleanup_future(self, request_id: str) -> None:
        """清理已完成/超时的future"
```