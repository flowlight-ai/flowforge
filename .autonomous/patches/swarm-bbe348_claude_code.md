# 自主任务产出审阅

- **task_id**: swarm-bbe3482daee3
- **title**: 修复代码 TODO: flowforge\core\external_agent\adapters\claude_code.py
- **agent**: forgemind:sherlock
- **model**: openroute/doubao-web/chat
- **generated_at**: 2026-07-31T23:02:54.488126+00:00
- **source_file**: flowforge\core\external_agent\adapters\claude_code.py
- **required_capabilities**: code_generation

## 审阅指南

1. 检查产出的代码是否符合项目规范（CONTRIBUTING.md 15 条红线）
2. 检查是否引入循环依赖或违反分层架构
3. 通过审核后，将下方代码块内容应用到对应源文件
4. 应用后必须运行对应测试验证（铁律 T1-T8）

## 任务上下文

```
文件 flowforge\core\external_agent\adapters\claude_code.py 中发现 5 处 TODO/FIXME/NotImplementedError。请分析代码上下文并实现缺失的逻辑。
```

## LLM 产出内容

# 文件路径：flowforge/external_agent/adapter/claude_code_adapter.py

python

```
"""
EX-001/EX-002/EX-003 - [doc:decisions/006-external-agent-integration.md] §4 首批接入
- [doc:design/naming-contract.md#2.12] 能力画像
- [doc:review/review.md#14.4] CL-038 NDJSON + stderr 也算活着
铁律遵守：
- 铁律 5：禁止硬编码密钥（ANTHROPIC_API_KEY 通过 HostInjector 注入）
- 铁律 3：依赖通过构造函数注入
- 所有 I/O 操作使用 async/await
CL-038 半实现状态：
本 Adapter 当前为"半实现"状态——不实际调用 subprocess，但调用 ``parse_cli_invocation`` / ``NDJSONParser`` 演示 NDJSON + stderr 解析能力。
厂商参考实现时替换 ``# TODO: 厂商实现`` 标记的 subprocess 调用部分即可。
License: MIT
"""
from __future__ import annotations

import asyncio
import json
import os
from typing import Any, AsyncIterator, Optional

from flowforge.core.external_agent.adapter import (
    ExternalAgentAdapter,
    ExternalAgentResult,
)
from flowforge.core.external_agent.cli_ndjson import (
    NDJSONParser,
    StderrCollector,
    parse_cli_invocation,
    stream_cli_invocation,
)
from flowforge.core.external_agent.host_injection import SandboxConfig
from flowforge.core.external_agent.manifest import AgentProviderManifest
from flowforge.core.tracing import get_logger

logger = get_logger("external_agent.adapter.claude_code")

class ClaudeCodeAdapter(ExternalAgentAdapter):
    """Claude Code Adapter（CLI + MCP 协议）。
    按 EX-001 升级为"能力扩展"思维：Forgekin可加载 claude code 的代码能力
    作为自己的能力延伸，而非简单的"调用一下拿结果"。
    能力画像（EX-00
```