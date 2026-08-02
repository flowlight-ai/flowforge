# 自主任务产出审阅

- **task_id**: swarm-bb4ab1ddec50
- **title**: 修复代码 TODO: flowforge\core\external_agent\adapter.py
- **agent**: forgemind:sherlock
- **model**: openroute/doubao-web/chat
- **generated_at**: 2026-08-01T06:08:39.230811+00:00
- **source_file**: flowforge\core\external_agent\adapter.py
- **required_capabilities**: code_generation

## 审阅指南

1. 检查产出的代码是否符合项目规范（CONTRIBUTING.md 15 条红线）
2. 检查是否引入循环依赖或违反分层架构
3. 通过审核后，将下方代码块内容应用到对应源文件
4. 应用后必须运行对应测试验证（铁律 T1-T8）

## 任务上下文

```
文件 flowforge\core\external_agent\adapter.py 中发现 3 处 TODO/FIXME/NotImplementedError。请分析代码上下文并实现缺失的逻辑。
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
import logging
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

# 项目内部类型引用（保持原有依赖声明）
# from flowforge.core.types import ActionLevel, PermissionDecision
# from flowforge.core.permission_rule import PermissionRule

logger = logging.getLogger(__name__)

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
        """基类默认空实现：不发送审批请求，直接拒绝。子类重写扩展"""
        return

    async def wait_for_response(self, request_id: str, timeout: float) -> ApprovalResponse:
        """基类默认实现：无可用审批通道，直接返回拒绝结果"""
        return ApprovalResponse(
            request_id=request_id,
            approved=False,
            comment="ApprovalProvider base implementation: no approval channel available"
        )

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
        # 创建future用于等待外部响应
        if request.request_id not in self._pending:
            loop = asyncio.get_running_loop()
            self._pending[request.request_id] = loop.create_future()

    async def wait_for_response(self, request_id: str, timeout: float) -> ApprovalResponse:
        if request_id in self._pending:
            try:
                return await asyncio.wait_for(self._pending[request_id], timeout=timeout)

```