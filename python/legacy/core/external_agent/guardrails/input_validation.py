"""L1 Input Validation — 输入验证 Guardrail。

按 EX-005 实现第一层 Guardrail：三方 Agent 调用前必须通过 Schema 校验，
拒绝恶意指令注入（如 prompt injection / 路径穿越 / 命令注入）。

设计依据：
    - [doc:review/review.md#第九章§9.2] EX-005 安全沙箱不足
    - [doc:decisions/006-external-agent-integration.md] §6 安全治理 L1
    - rules.md 第十部分 六层 Guardrails

License: MIT
"""

from __future__ import annotations

import re
from typing import Any

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("external_agent.guardrails.input_validation")


class InputValidationConfig(BaseModel):
    """输入验证配置。"""

    max_task_length: int = Field(default=8192, description="任务描述最大长度")
    max_context_size: int = Field(default=65536, description="上下文最大字节数")
    # 危险模式（正则）：拒绝包含这些模式的输入
    forbidden_patterns: list[str] = Field(
        default_factory=lambda: [
            r"rm\s+-rf\s+/",
            r"\bsudo\b",
            r"chmod\s+777",
            r"curl\s+.*\|\s*sh",
            r"wget\s+.*\|\s*bash",
            r"<script[^>]*>",
            r"javascript:",
            r"file:///",
        ],
        description="危险模式正则列表",
    )
    # 禁止的路径模式（防路径穿越）
    forbidden_path_patterns: list[str] = Field(
        default_factory=lambda: [
            r"\.\./",
            r"\.\.\\",
            r"/etc/passwd",
            r"/etc/shadow",
            r"~/.ssh",
            r"%USERPROFILE%",
        ],
        description="禁止的路径模式",
    )


class ValidationResult(BaseModel):
    """输入验证结果。"""

    valid: bool = Field(..., description="是否通过验证")
    violations: list[str] = Field(
        default_factory=list, description="违规原因列表"
    )
    sanitized_input: str = Field(default="", description="脱敏后的输入（如适用）")


class InputValidationGuardrail:
    """L1 输入验证 Guardrail。

    三方 Agent 调用前必须通过 Schema 校验，拒绝：
        - 恶意指令注入（prompt injection）
        - 路径穿越（../etc/passwd）
        - 命令注入（rm -rf / sudo / curl | sh）
        - XSS（<script> / javascript:）
        - 超长输入（DoS 防护）

    详见 [doc:review/review.md#第九章§9.2] EX-005
    """

    def __init__(self, config: InputValidationConfig | None = None) -> None:
        self._config = config or InputValidationConfig()
        # 预编译正则
        self._forbidden_re = [
            re.compile(p, re.IGNORECASE) for p in self._config.forbidden_patterns
        ]
        self._path_re = [
            re.compile(p, re.IGNORECASE)
            for p in self._config.forbidden_path_patterns
        ]

    def validate(
        self,
        task: str,
        context: dict[str, Any] | None = None,
    ) -> ValidationResult:
        """验证输入是否安全。

        Args:
            task: 任务描述。
            context: 调用上下文。

        Returns:
            ValidationResult 验证结果。
        """
        violations: list[str] = []

        # 1. 长度检查
        if len(task) > self._config.max_task_length:
            violations.append(
                f"task_length={len(task)} > max={self._config.max_task_length}"
            )
        if context:
            ctx_size = len(str(context))
            if ctx_size > self._config.max_context_size:
                violations.append(
                    f"context_size={ctx_size} > "
                    f"max={self._config.max_context_size}"
                )

        # 2. 危险模式检查
        for pattern in self._forbidden_re:
            match = pattern.search(task)
            if match:
                violations.append(f"forbidden_pattern matched: {match.group()}")

        # 3. 路径穿越检查
        for pattern in self._path_re:
            match = pattern.search(task)
            if match:
                violations.append(
                    f"forbidden_path_pattern matched: {match.group()}"
                )

        # 4. 上下文中的危险模式检查
        if context:
            ctx_str = str(context)
            for pattern in self._forbidden_re:
                if pattern.search(ctx_str):
                    violations.append(
                        f"forbidden_pattern in context: {pattern.pattern}"
                    )

        valid = len(violations) == 0
        if not valid:
            logger.warning(
                "input_validation.failed violations=%s", violations
            )
        return ValidationResult(
            valid=valid,
            violations=violations,
            sanitized_input=task if valid else "",
        )
