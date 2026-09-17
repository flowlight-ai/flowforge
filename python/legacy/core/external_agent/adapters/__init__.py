"""External Agent Adapters — 四个三方 Agent 适配器实现。

按 EX-001/EX-002/EX-003 实现四个 Adapter：
    - ClaudeCodeAdapter: CLI + MCP 协议（擅长复杂重构，盲点：长上下文易漂移）
    - CodexAdapter: API + function calling（擅长推理，盲点：工具调用弱）
    - OpenCodeAdapter: SDK + plugin（擅长开源协作，盲点：企业场景弱）
    - TraeAdapter: IDE + command（擅长 IDE 集成，盲点：命令行长任务弱）

详见:
    - [doc:review/review.md#第九章§9.2] EX-001~EX-010
    - [doc:decisions/006-external-agent-integration.md] §4 首批接入
    - [doc:design/naming-contract.md#2.12] 能力画像

License: MIT
"""

from __future__ import annotations

from flowforge.core.external_agent.adapters.claude_code import ClaudeCodeAdapter
from flowforge.core.external_agent.adapters.codex import CodexAdapter
from flowforge.core.external_agent.adapters.opencode import OpenCodeAdapter
from flowforge.core.external_agent.adapters.trae import TraeAdapter

__all__ = [
    "ClaudeCodeAdapter",
    "CodexAdapter",
    "OpenCodeAdapter",
    "TraeAdapter",
]
