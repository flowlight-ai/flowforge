"""Workflow Compiler — YAML → IR → 执行图

三阶段编译器主入口，串联 Parser、Validator、CodeGen。
MVP1 支持 SEQUENCE 模式（顺序执行）。
MVP2 扩展 CONDITIONAL 模式（条件分支）。
"""

from typing import Any

from flowforge.compiler.codegen import WorkflowCodeGen
from flowforge.compiler.ir import IRWorkflow
from flowforge.compiler.parser import WorkflowParser
from flowforge.compiler.validator import WorkflowValidator


class WorkflowCompiler:
    """Workflow YAML 编译器

    编译流程：YAML → Parser → IR → Validator → CodeGen → sop_steps
    """

    def __init__(self) -> None:
        self.parser = WorkflowParser()
        self.validator = WorkflowValidator()
        self.codegen = WorkflowCodeGen()

    def compile(self, yaml_content: str) -> tuple[list[dict[str, Any]], IRWorkflow]:
        """编译 YAML 字符串为执行图

        Args:
            yaml_content: YAML 格式的工作流定义字符串。

        Returns:
            (sop_steps, ir) 元组，sop_steps 供 WorkflowExecutor 使用，
            ir 为中间表示供调试或二次处理。

        Raises:
            ValueError: YAML 格式无效或校验失败。
        """
        ir = self.parser.parse(yaml_content)
        errors = self.validator.validate(ir)
        if errors:
            raise ValueError(f"Workflow validation failed: {errors}")
        sop_steps = self.codegen.generate(ir)
        return sop_steps, ir

    def compile_file(self, path: str) -> tuple[list[dict[str, Any]], IRWorkflow]:
        """编译 YAML 文件为执行图

        Args:
            path: YAML 文件路径。

        Returns:
            (sop_steps, ir) 元组。

        Raises:
            FileNotFoundError: 文件不存在。
            ValueError: 校验失败。
        """
        ir = self.parser.parse_file(path)
        errors = self.validator.validate(ir)
        if errors:
            raise ValueError(f"Workflow validation failed: {errors}")
        sop_steps = self.codegen.generate(ir)
        return sop_steps, ir
