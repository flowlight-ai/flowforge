# 自主任务产出审阅

- **task_id**: swarm-507372e85138
- **title**: 修复代码 TODO: flowforge\core\external_agent\adapter.py
- **agent**: forgemind:sherlock
- **model**: openroute/doubao-web/chat
- **generated_at**: 2026-08-01T09:52:49.041312+00:00
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

# 文件路径：src/flowforge/core/external_agent/adapter.py

python

```
"""
EX-001/EX-002/EX-003 能力扩展 + 能力画像 + 协议适配层
- [doc:decisions/006-external-agent-integration.md] §3 ExternalAgentAdapter 抽象层
- [doc:design/naming-contract.md#2.12] 能力画像

铁律遵守：
- 铁律 3：依赖通过构造函数注入（manifest / host_injector）
- 编程红线 9：使用组合（manifest + host_injector）而非继承表达适配能力
- 编程红线 7：使用 ABC + abstractmethod 定义抽象基类
- 所有 I/O 操作使用 async/await

License: MIT
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Optional

from pydantic import BaseModel, Field

from flowforge.core.external_agent.host_injection import HostInjector, SandboxConfig
from flowforge.core.external_agent.manifest import AgentProviderManifest
from flowforge.core.tracing import get_logger

logger = get_logger("external_agent.adapter")

class ExternalAgentResult(BaseModel):
    """三方 Agent 调用结果。
    封装三方 Agent 的输出、成本、能力画像贡献等信息，
    供 ExternalAgentBridge 进一步处理（融合到Forgekin主画像）。

    Attributes:
        provider_name: 调用的三方 Agent Provider 名称。
        success: 是否调用成功。
        output: 三方 Agent 的原始输出（文本 / 代码 / 结构化数据）。
        artifacts: 产出物列表（如修改的文件路径、
```