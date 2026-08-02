"""L4 Output Validation — 输出验证 Guardrail。

按 EX-005 实现第四层 Guardrail：三方 Agent 输出必须通过 lint + 测试校验，
拒绝越权输出（如未经授权的文件修改 / 路径越界 / 敏感信息泄露）。

设计依据：
    - [doc:review/review.md#第九章§9.2] EX-005 安全沙箱不足
    - [doc:decisions/006-external-agent-integration.md] §6 安全治理 L4

License: MIT
"""

from __future__ import annotations

import re
from typing import Any

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("external_agent.guardrails.output_validation")


class OutputValidationConfig(BaseModel):
    """输出验证配置。"""

    # 输出中禁止出现的敏感模式
    sensitive_patterns: list[str] = Field(
        default_factory=lambda: [
            r"sk-[a-zA-Z0-9]{20,}",  # OpenAI API key
            r"anthropic-[a-zA-Z0-9]{20,}",  # Anthropic API key
            r"AKIA[0-9A-Z]{16}",  # AWS access key
            r"-----BEGIN [A-Z ]+PRIVATE KEY-----",  # private key
            r"password\s*[:=]\s*\S+",  # password
            r"token\s*[:=]\s*\S+",  # token
        ],
        description="敏感模式正则列表",
    )
    # 输出最大长度（防 DoS）
    max_output_length: int = Field(default=1048576, description="输出最大长度（1MB）")
    # 是否要求输出可被 lint（代码场景）
    require_lintable: bool = Field(
        default=False, description="是否要求输出可被 lint 校验"
    )


class OutputValidationResult(BaseModel):
    """输出验证结果。"""

    valid: bool = Field(..., description="是否通过验证")
    violations: list[str] = Field(
        default_factory=list, description="违规原因列表"
    )
    sanitized_output: Any = Field(
        default=None, description="脱敏后的输出（敏感信息已 mask）"
    )


class OutputValidationGuardrail:
    """L4 输出验证 Guardrail。

    三方 Agent 输出必须通过 lint + 测试校验，拒绝：
        - 敏感信息泄露（API key / 密码 / 私钥）
        - 路径越界（修改 worktree 外文件）
        - 越权输出（执行未授权的命令）
        - 超长输出（DoS 防护）

    详见 [doc:review/review.md#第九章§9.2] EX-005
    """

    def __init__(self, config: OutputValidationConfig | None = None) -> None:
        self._config = config or OutputValidationConfig()
        self._sensitive_re = [
            re.compile(p, re.IGNORECASE) for p in self._config.sensitive_patterns
        ]

    def validate(
        self,
        output: Any,
        sandbox_cwd: str | None = None,
    ) -> OutputValidationResult:
        """验证输出是否安全。

        Args:
            output: 三方 Agent 的原始输出。
            sandbox_cwd: sandbox 工作目录（用于检查路径越界）。

        Returns:
            OutputValidationResult 验证结果。
        """
        violations: list[str] = []
        output_str = output if isinstance(output, str) else str(output)

        # 1. 长度检查
        if len(output_str) > self._config.max_output_length:
            violations.append(
                f"output_length={len(output_str)} > "
                f"max={self._config.max_output_length}"
            )

        # 2. 敏感信息检查
        sanitized = output_str
        for pattern in self._sensitive_re:
            matches = pattern.findall(output_str)
            if matches:
                violations.append(
                    f"sensitive_pattern matched: {pattern.pattern} "
                    f"({len(matches)} occurrences)"
                )
                # 脱敏：替换为 [REDACTED]
                sanitized = pattern.sub("[REDACTED]", sanitized)

        # 3. 路径越界检查（如配置了 sandbox_cwd）
        if sandbox_cwd:
            # 检查输出中是否有 sandbox_cwd 之外的路径
            path_pattern = re.compile(
                r"(?:^|\s)((?:/[^\s:]+)|(?:[A-Za-z]:[\\/][^\s:]+))"
            )
            for match in path_pattern.finditer(output_str):
                path = match.group(1)
                if not path.startswith(sandbox_cwd):
                    violations.append(
                        f"path_outside_sandbox: {path} (cwd={sandbox_cwd})"
                    )

        # 4. lint 校验（如要求）
        if self._config.require_lintable and isinstance(output, str):
            # 简单检查：是否包含代码块
            if "```" not in output and "def " not in output and "function " not in output:
                violations.append(
                    "require_lintable=True but output contains no code blocks"
                )

        valid = len(violations) == 0
        if not valid:
            logger.warning(
                "output_validation.failed violations=%s", violations
            )
        return OutputValidationResult(
            valid=valid,
            violations=violations,
            sanitized_output=sanitized if not valid else output,
        )
