"""Workflow YAML Parser — 解析 YAML 为 IR

第一阶段：将 YAML 工作流定义解析为 IRWorkflow 中间表示。
MVP1 支持 SEQUENCE 模式，步骤按列表顺序依次执行。
MVP2 扩展 CONDITIONAL 模式，支持 condition/on_true/on_false 条件分支。
"""

from pathlib import Path
from typing import Any

import yaml

from flowforge.compiler.ir import IRStep, IRWorkflow, StepType


class WorkflowParser:
    """YAML → IRWorkflow 解析器"""

    def parse(self, yaml_content: str) -> IRWorkflow:
        """解析 YAML 字符串为 IRWorkflow

        Args:
            yaml_content: YAML 格式的工作流定义字符串。

        Returns:
            解析后的 IRWorkflow 实例。

        Raises:
            ValueError: YAML 格式无效或内容非映射类型。
        """
        data = yaml.safe_load(yaml_content)
        if not isinstance(data, dict):
            raise ValueError(f"Invalid YAML: expected mapping, got {type(data).__name__}")
        return self._parse_workflow(data)

    def parse_file(self, path: str) -> IRWorkflow:
        """解析 YAML 文件为 IRWorkflow

        Args:
            path: YAML 文件路径。

        Returns:
            解析后的 IRWorkflow 实例。

        Raises:
            FileNotFoundError: 文件不存在。
        """
        file_path = Path(path)
        if not file_path.exists():
            raise FileNotFoundError(f"Workflow YAML file not found: {path}")
        with open(file_path, "r", encoding="utf-8") as f:
            return self.parse(f.read())

    def _parse_workflow(self, data: dict[str, Any]) -> IRWorkflow:
        """将原始字典解析为 IRWorkflow"""
        steps = [
            self._parse_step(s, i) for i, s in enumerate(data.get("steps", []))
        ]
        return IRWorkflow(
            id=data.get("id", "unnamed"),
            name=data.get("name", "Unnamed Workflow"),
            description=data.get("description", ""),
            version=str(data.get("version", "1.0")),
            steps=steps,
            state_schema=data.get("state_schema", {}),
            execution_policy=data.get("execution_policy", {}),
            checkpoint=data.get("checkpoint", {}),
        )

    def _parse_step(self, step_data: dict[str, Any], index: int) -> IRStep:
        """将原始字典解析为 IRStep"""
        step_type = StepType(step_data.get("type", "agent"))

        # MVP2: 条件分支字段解析
        condition = step_data.get("condition")
        on_true = step_data.get("on_true")
        on_false = step_data.get("on_false")

        # 如果有 condition 字段但未显式指定 type，自动设为 CONDITIONAL
        if condition and step_type != StepType.CONDITIONAL:
            step_type = StepType.CONDITIONAL

        # PARALLEL: 并行子步骤解析
        parallel_steps = []
        if step_type == StepType.PARALLEL:
            parallel_steps = [
                self._parse_step(s, i)
                for i, s in enumerate(step_data.get("parallel_steps", []))
            ]

        # FALLBACK: 主步骤和回退步骤解析
        primary_steps = []
        fallback_steps = []
        if step_type == StepType.FALLBACK:
            primary_steps = [
                self._parse_step(s, i)
                for i, s in enumerate(step_data.get("primary", []))
            ]
            fallback_steps = [
                self._parse_step(s, i)
                for i, s in enumerate(step_data.get("fallback", []))
            ]

        # LOOP: 循环步骤解析
        loop_steps = []
        if step_type == StepType.LOOP:
            loop_steps = [
                self._parse_step(s, i)
                for i, s in enumerate(step_data.get("loop_steps", []))
            ]

        return IRStep(
            id=step_data.get("id", f"step_{index}"),
            name=step_data.get("name", f"Step {index}"),
            type=step_type,
            agent=step_data.get("agent"),
            tool=step_data.get("tool"),
            input_mapping=step_data.get("input_mapping", {}),
            output_key=step_data.get("output_key"),
            execution_policy=step_data.get("execution_policy", {}),
            checkpoint=step_data.get("checkpoint", {}),
            condition=condition,
            on_true=on_true,
            on_false=on_false,
            parallel_steps=parallel_steps,
            primary=primary_steps,
            fallback=fallback_steps,
            loop_steps=loop_steps,
            max_iterations=step_data.get("max_iterations", 1),
            exit_condition=step_data.get("exit_condition"),
            loop_variable=step_data.get("loop_variable"),
        )
