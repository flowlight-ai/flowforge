"""L5 Action Confirm — 操作确认 Guardrail。

按 EX-005 实现第五层 Guardrail：不可逆操作（merge / release / delete）
必须等待 operator 确认后才执行。

设计依据：
    - [doc:review/review.md#第九章§9.2] EX-005 安全沙箱不足
    - [doc:decisions/006-external-agent-integration.md] §6 安全治理 L5
    - [doc:design/naming-contract.md#2.11] 觉醒阶 E1-E2 不可逆操作需确认

License: MIT
"""

from __future__ import annotations

import re
from collections.abc import Awaitable, Callable
from typing import Any

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("external_agent.guardrails.action_confirm")


class ActionConfirmConfig(BaseModel):
    """操作确认配置。"""

    # 需要确认的不可逆操作模式（正则）
    irreversible_patterns: list[str] = Field(
        default_factory=lambda: [
            r"git\s+push",
            r"git\s+merge",
            r"git\s+rebase",
            r"git\s+reset\s+--hard",
            r"git\s+clean\s+-fd",
            r"git\s+branch\s+-D",
            r"rm\s+-rf",
            r"rmdir\s+/s",
            r"del\s+/f",
            r"docker\s+rm",
            r"kubectl\s+delete",
            r"terraform\s+destroy",
            r"release\s+publish",
            r"npm\s+publish",
            r"pip\s+upload",
        ],
        description="不可逆操作模式列表",
    )
    # 自动批准的非不可逆操作（如 lint / test）
    auto_approved_patterns: list[str] = Field(
        default_factory=lambda: [
            r"git\s+status",
            r"git\s+diff",
            r"pytest",
            r"ruff",
            r"mypy",
            r"npm\s+test",
            r"npm\s+run\s+lint",
        ],
        description="自动批准的操作模式",
    )


class ConfirmResult(BaseModel):
    """操作确认结果。"""

    action_required: bool = Field(..., description="是否需要 operator 确认")
    operation: str = Field(..., description="请求的操作")
    reason: str = Field(default="", description="需要确认的原因")
    auto_approved: bool = Field(
        default=False, description="是否自动批准（非不可逆操作）"
    )


class ActionConfirmGuardrail:
    """L5 操作确认 Guardrail。

    不可逆操作（merge / release / delete）必须等待 operator 确认后才执行。

    详见 [doc:review/review.md#第九章§9.2] EX-005

    确认流程：
        1. 三方 Agent 请求执行操作
        2. ActionConfirmGuardrail.check() 判断是否需要确认
        3. 如需确认，调用 confirm_callback（由 host 实现/operator 确认）
        4. 确认通过后才允许执行
    """

    def __init__(
        self,
        config: ActionConfirmConfig | None = None,
        confirm_callback: Callable[[str, str], Awaitable[bool]] | None = None,
    ) -> None:
        """注入配置和确认回调。

        Args:
            config: 操作确认配置。
            confirm_callback: operator 确认回调
                (operation, reason) -> bool。True 表示批准。
                None 时所有不可逆操作默认拒绝。
        """
        self._config = config or ActionConfirmConfig()
        self._confirm_callback = confirm_callback
        self._irreversible_re = [
            re.compile(p, re.IGNORECASE) for p in self._config.irreversible_patterns
        ]
        self._auto_approved_re = [
            re.compile(p, re.IGNORECASE)
            for p in self._config.auto_approved_patterns
        ]

    def check(self, operation: str) -> ConfirmResult:
        """检查操作是否需要 operator 确认。

        Args:
            operation: 请求的操作字符串（如 git command / shell 命令）。

        Returns:
            ConfirmResult 检查结果。
        """
        # 1. 检查是否自动批准
        for pattern in self._auto_approved_re:
            if pattern.search(operation):
                return ConfirmResult(
                    action_required=False,
                    operation=operation,
                    auto_approved=True,
                    reason="auto_approved (non-irreversible)",
                )

        # 2. 检查是否是不可逆操作
        for pattern in self._irreversible_re:
            if pattern.search(operation):
                return ConfirmResult(
                    action_required=True,
                    operation=operation,
                    reason=f"irreversible_pattern matched: {pattern.pattern}",
                )

        # 3. 默认自动批准（非不可逆操作）
        return ConfirmResult(
            action_required=False,
            operation=operation,
            auto_approved=True,
            reason="default auto-approved",
        )

    async def confirm(self, operation: str, context: dict[str, Any] | None = None) -> bool:
        """请求 operator 确认不可逆操作。

        Args:
            operation: 请求的操作。
            context: 上下文（用于向 operator 展示操作背景）。

        Returns:
            是否被批准。无 confirm_callback 时默认拒绝（安全优先）。
        """
        result = self.check(operation)
        if not result.action_required:
            return True  # 自动批准

        if self._confirm_callback is None:
            logger.warning(
                "action_confirm.rejected no_callback operation=%s",
                operation,
            )
            return False  # 无回调时默认拒绝

        reason = result.reason
        if context:
            reason = f"{reason} | context={context}"
        approved = await self._confirm_callback(operation, reason)
        logger.info(
            "action_confirm.result operation=%s approved=%s",
            operation,
            approved,
        )
        return approved
