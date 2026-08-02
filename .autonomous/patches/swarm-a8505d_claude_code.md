# 自主任务产出审阅

- **task_id**: swarm-a8505d2eee97
- **title**: 修复代码 TODO: flowforge\core\external_agent\adapters\claude_code.py
- **agent**: forgemind:sherlock
- **model**: openroute/doubao-web/chat
- **generated_at**: 2026-08-01T06:58:51.185641+00:00
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

python

```
# 文件路径: flowforge/core/external_agent/adapter/claude_code.py
from __future__ import annotations
import json
import asyncio
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
    stream_cli_invocation
)
from flowforge.core.external_agent.host_injection import SandboxConfig
from flowforge.core.external_agent.manifest import AgentProviderManifest
from flowforge.core.tracing import get_logger

logger = get_logger("external_agent.adapter.claude_code")

class ClaudeCodeAdapter(ExternalAgentAdapter):
    """Claude Code Adapter（CLI + MCP 协议）。
    按 EX-001 升级为"能力扩展"思维：Forgekin可加载 claude code 的代码能力
    作为自己的能力延伸，而非简单的"调用一下拿结果"。
    能力画像（EX-002）：
    - 擅长：复杂重构、代码生成、代码审查、长链推理
    - 盲点：长上下文易漂移、工具调用偶尔失败
    详见 [doc:review/review.md#第九章§9.2] EX-001~EX-010
    """

    # Claude Code 专属能力画像（与 Manifest YAML 同步）
    CAPABILITY_PROFILE: dict[str, Any] = {
        "provider_name": "anthropic.claude_code",
        "display_name": "Claude Code",
        "capabilities": [
            "code_generation",
            "code_review",
            "complex_refactor",
            "long_chain_reasoning",
            "mcp_tool_use",
        ],
        "blind_spots": [
            "长上下文易漂移",
            "工具调用偶尔失败",
            "对中文注释理解偶有偏差",
        ],
        "strengths": [
            "复杂重构场景下的多文件协同修改",
            "长链推理任务（如架构设计、依赖分析）",
            "MCP 工具调用生态丰富",
        ],
        "best_practices": [
            "复杂重构：将上下文拆分为多个小步骤，避免长上下文漂移",
            "代码审查：配合 codex 跨厂商 review，互补盲点",
        ],
        "anti_patterns": [
            "超长上下文（>100k token）一次性提交，易漂移",
            "对工具调用结果不做校验，可能误用失败结果",
        ],
    }

    async def invoke(
        self,
        task: str,
        context: dict[str, Any],
        sandbox: Optional[SandboxConfig] = None,
    ) -> ExternalAgentResult:
        """调用 Claude Code 完成任务（CL-038）。
        实现要点：
        1. 通过 self.prepare_credentials() 获取 ANTHROPIC_API_KEY
        2. 使用 sandbox.cwd 作为工作目录
        3. 通过 subprocess 调用 claude CLI（stdio 传输）
        4. 用 parse_cli_invocation 解析 stdout（NDJSON）+ stderr
        5. 封装为 ExternalAgentResult（success 仅看 returncode==0，
        "stderr 也算活着"教训）
        设计依据：
        - [doc:review/review.md#14.4] CL-038 NDJSON + stderr 也算活着
        - [doc:decisions/006-external-agent-integration.md] §4 首批接入
        - [
```