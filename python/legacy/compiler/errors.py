"""Workflow 编译器结构化异常 — P-97.

统一编译/解析/验证阶段的错误为 ``WorkflowCompileError``（继承
``ValueError``，兼容既有 ``except ValueError`` 调用方），并通过
``error_code`` / ``errors`` / ``to_dict()`` 暴露结构化错误信息，
便于 API 层返回可读的错误响应。
"""

from __future__ import annotations

from typing import Any


class WorkflowCompileError(ValueError):
    """工作流编译错误（结构化，区分编译/验证错误）— P-97.

    Attributes:
        error_code: 错误分类，取值 ``PARSE_ERROR`` / ``VALIDATION_ERROR`` /
            ``GENERATION_ERROR`` / ``COMPILE_ERROR``。
        errors: 详细错误列表（validator 输出或单个错误消息）。
    """

    def __init__(
        self,
        message: str,
        *,
        error_code: str = "COMPILE_ERROR",
        errors: list[str] | None = None,
    ) -> None:
        super().__init__(message)
        self.error_code = error_code
        self.errors = errors or []

    def to_dict(self) -> dict[str, Any]:
        """转为结构化字典，供 API 错误响应直接使用。"""
        return {
            "error": self.error_code,
            "message": str(self),
            "details": self.errors,
        }
