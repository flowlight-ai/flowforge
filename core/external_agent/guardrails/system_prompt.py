"""L2 System Prompt — 系统提示约束 Guardrail。

按 EX-005 实现第二层 Guardrail：Forgekin system role 注入"禁止绕过审计"等
边界声明，约束三方 Agent 的行为范围。

设计依据：
    - [doc:review/review.md#第九章§9.2] EX-005 安全沙箱不足
    - [doc:decisions/006-external-agent-integration.md] §6 安全治理 L2
    - 铁律 5+P16：提示词外置到 config/prompts.yaml

License: MIT
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("external_agent.guardrails.system_prompt")


class SystemPromptConfig(BaseModel):
    """系统提示约束配置（提示词外置，铁律 5+P16）。"""

    # 边界声明模板（实际值从 config/prompts.yaml 加载）
    boundary_template: str = Field(
        default=(
            "[FlowForge 边界声明]\n"
            "你是Forgekin调用的三方 Agent，必须遵守以下边界：\n"
            "1. 禁止绕过审计——所有操作必须记录到 worktree.audit\n"
            "2. 禁止越权——仅可访问 sandbox.cwd 内文件\n"
            "3. 禁止修改 VISION.md / rules.md / 铁律文件\n"
            "4. 不可逆操作（merge/release/delete）必须等待 operator 确认\n"
            "5. 成本上限：单次调用不超过 {{cost_ceiling}} token\n"
            "6. 输出必须可被 lint + 测试校验\n"
        ),
        description="边界声明模板（外置到 config/prompts.yaml）",
    )
    # 注入位置：system role 开头 / 结尾
    inject_position: str = Field(
        default="prefix", description="注入位置：prefix / suffix"
    )


class SystemPromptGuardrail:
    """L2 系统提示约束 Guardrail。

    Forgekin system role 注入"禁止绕过审计"等边界声明，
    约束三方 Agent 的行为范围。

    详见 [doc:review/review.md#第九章§9.2] EX-005

    提示词外置（铁律 5+P16）：
        实际边界声明从 config/prompts.yaml 加载，本类只负责注入逻辑。
    """

    def __init__(self, config: SystemPromptConfig | None = None) -> None:
        self._config = config or SystemPromptConfig()

    def inject(
        self,
        original_prompt: str,
        context: dict[str, Any] | None = None,
    ) -> str:
        """注入边界声明到 system prompt。

        Args:
            original_prompt: 原始 system prompt。
            context: 上下文变量（用于模板渲染，如 cost_ceiling）。

        Returns:
            注入边界声明后的 system prompt。
        """
        context = context or {}
        # 简单模板渲染（替换 {{key}} 占位符）
        boundary = self._config.boundary_template
        for key, value in context.items():
            boundary = boundary.replace(f"{{{{{key}}}}}", str(value))

        if self._config.inject_position == "prefix":
            result = f"{boundary}\n{original_prompt}"
        else:
            result = f"{original_prompt}\n\n{boundary}"
        logger.debug(
            "system_prompt.injected position=%s boundary_len=%d",
            self._config.inject_position,
            len(boundary),
        )
        return result

    def get_boundary_template(self) -> str:
        """返回边界声明模板（供 prompts.yaml 加载时校验）。"""
        return self._config.boundary_template

    def update_boundary_template(self, template: str) -> None:
        """更新边界声明模板（从 prompts.yaml 加载时调用）。"""
        self._config = self._config.model_copy(
            update={"boundary_template": template}
        )
        logger.info("system_prompt.template_updated length=%d", len(template))
