# 自主任务产出审阅

- **task_id**: swarm-812e13f12856
- **title**: 修复代码 TODO: flowforge\core\external_agent\adapter.py
- **agent**: forgemind:sherlock
- **model**: Doubao-Seed2.0
- **generated_at**: 2026-07-31T23:08:37.095427+00:00
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

# 文件路径：flowforge/core/external_agent/adapter.py

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
        artifacts: 产出物列表（如修改的文件路径、生成的代码片段）。
        cost: 成本信息（token 数 / 调用次数 / 货币成本，EX-006）。
        capability_contribution: 能力画像贡献（EX-010 能力融合输入）。
        error: 失败时的错误信息。
        timestamp: 调用完成时间戳。
    """
    provider_name: str = Field(..., description="Provider 名称")
    success: bool = Field(..., description="是否成功")
    output: Any = Field(default=None, description="三方 Agent 原始输出")
    artifacts: list[dict[str, Any]] = Field(
        default_factory=list, description="产出物列表"
    )
    cost: dict[str, Any] = Field(
        default_factory=dict, description="成本信息（EX-006）"
    )
    capability_contribution: dict[str, Any] = Field(
        default_factory=dict, description="能力画像贡献（EX-010）"
    )
    error: Optional[str] = Field(default=None, description="错误信息")
    timestamp: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="调用完成时间戳",
    )

class ExternalAgentAdapter(ABC):
    """三方 Agent 适配器抽象基类。
    按 EX-001 升级为"能力扩展"思维，不是"工具调用"思维。
    Forgekin可加载 claude code 的代码能力、codex 的推理能力、
    opencode 的开源生态能力、trae 的 IDE 能力。
    详见 [doc:review/review.md#第九章§9.2] EX-001~EX-010

    子类职责：
    1. 实现 invoke() — 
```