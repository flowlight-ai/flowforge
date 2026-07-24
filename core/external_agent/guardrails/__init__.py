"""External Agent Guardrails — 六层安全治理。

按 EX-005 实现六层 Guardrails，每层职责单一、可独立配置：
    - L1 input_validation: 输入验证（拒绝恶意指令注入）
    - L2 system_prompt: 系统提示约束（边界声明）
    - L3 tool_allowlist: 工具白名单（仅允许必要工具）
    - L4 output_validation: 输出验证（拒绝越权输出）
    - L5 action_confirm: 操作确认（不可逆操作需 operator 确认）
    - L6 cost_ceiling: 成本上限（每灵智体配额，EX-006）

设计依据：
    - [doc:review/review.md#第九章§9.2] EX-005 三方 Agent 安全沙箱不足
    - [doc:decisions/006-external-agent-integration.md] §6 安全治理
    - [doc:design/naming-contract.md#2.11] 觉醒阶（E1-E2 六层 Guardrails 全开）

铁律遵守：
    - 铁律 5：禁止硬编码（配置外置到 config/tool_allowlist.yaml 等）
    - 编程红线 9：使用组合表达 Guardrail 链
    - 所有 I/O 操作使用 async/await

License: MIT
"""

from __future__ import annotations

from flowforge.core.external_agent.guardrails.action_confirm import (
    ActionConfirmGuardrail,
)
from flowforge.core.external_agent.guardrails.cost_ceiling import (
    CostCeilingConfig,
    CostCeilingGuardrail,
)
from flowforge.core.external_agent.guardrails.input_validation import (
    InputValidationGuardrail,
)
from flowforge.core.external_agent.guardrails.output_validation import (
    OutputValidationGuardrail,
)
from flowforge.core.external_agent.guardrails.system_prompt import (
    SystemPromptGuardrail,
)
from flowforge.core.external_agent.guardrails.tool_allowlist import (
    ToolAllowlistGuardrail,
)

__all__ = [
    "InputValidationGuardrail",
    "SystemPromptGuardrail",
    "ToolAllowlistGuardrail",
    "OutputValidationGuardrail",
    "ActionConfirmGuardrail",
    "CostCeilingConfig",
    "CostCeilingGuardrail",
]
