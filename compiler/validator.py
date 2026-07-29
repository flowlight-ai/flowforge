"""Workflow IR Validator — 校验 IR 完整性

第二阶段：校验 IRWorkflow 的结构完整性和语义正确性。
MVP1 校验：必填字段、步骤 ID 唯一性、类型字段匹配。
MVP2 扩展：条件分支字段完整性、引用步骤ID存在性、表达式语法校验。
"""

import re

from flowforge.compiler.ir import IRWorkflow, StepType


class WorkflowValidator:
    """IRWorkflow 校验器"""

    # 条件表达式基本语法：${{...}} 或 ${...} 包裹的表达式
    _CONDITION_PATTERN = re.compile(r"^\$\{.+\}$")

    def validate(self, workflow: IRWorkflow) -> list[str]:
        """校验 IR，返回错误列表（空列表表示通过）

        Args:
            workflow: 待校验的 IRWorkflow 实例。

        Returns:
            错误信息列表，空列表表示校验通过。
        """
        errors: list[str] = []

        # 必填字段校验
        if not workflow.id:
            errors.append("Workflow id is required")
        if not workflow.name:
            errors.append("Workflow name is required")
        if not workflow.steps:
            errors.append("Workflow must have at least one step")

        # 第一遍：收集所有步骤ID + 基础校验
        step_ids: set[str] = set()
        for step in workflow.steps:
            if step.id in step_ids:
                errors.append(f"Duplicate step id: {step.id}")
            step_ids.add(step.id)

            # 类型字段匹配校验
            if step.type == StepType.AGENT and not step.agent:
                errors.append(f"Step '{step.id}': agent type requires 'agent' field")
            if step.type == StepType.TOOL and not step.tool:
                errors.append(f"Step '{step.id}': tool type requires 'tool' field")

        # 第二遍：条件分支校验（需要完整的 step_ids 集合）
        for step in workflow.steps:
            errors.extend(self._validate_conditional(step, step_ids))

        # 第三遍：PARALLEL / FALLBACK / LOOP 校验
        for step in workflow.steps:
            errors.extend(self._validate_parallel(step))
            errors.extend(self._validate_fallback(step))
            errors.extend(self._validate_loop(step))

        return errors

    def _validate_conditional(self, step, all_step_ids: set[str]) -> list[str]:
        """校验条件分支字段的完整性和语义正确性"""
        errors: list[str] = []
        has_condition = step.condition is not None
        has_on_true = step.on_true is not None
        has_on_false = step.on_false is not None

        # condition 存在时，on_true 和 on_false 必须同时存在
        if has_condition:
            if not has_on_true:
                errors.append(
                    f"Step '{step.id}': condition requires 'on_true' field"
                )
            if not has_on_false:
                errors.append(
                    f"Step '{step.id}': condition requires 'on_false' field"
                )

            # 条件表达式语法校验：必须以 ${ 开头和 } 结尾
            if not self._CONDITION_PATTERN.match(step.condition):
                errors.append(
                    f"Step '{step.id}': condition expression must be wrapped in "
                    f"${{...}} syntax, got: {step.condition}"
                )

        # on_true/on_false 存在时，condition 必须存在
        if (has_on_true or has_on_false) and not has_condition:
            errors.append(
                f"Step '{step.id}': 'on_true'/'on_false' requires 'condition' field"
            )

        # on_true/on_false 引用的步骤ID必须存在
        if has_on_true and step.on_true not in all_step_ids:
            errors.append(
                f"Step '{step.id}': on_true references non-existent step '{step.on_true}'"
            )
        if has_on_false and step.on_false not in all_step_ids:
            errors.append(
                f"Step '{step.id}': on_false references non-existent step '{step.on_false}'"
            )

        # on_false 不能引用自身（无条件跳回自身是死循环）
        # 但 on_true 引用自身是合法的（表示条件满足时循环执行，如"分数不够就重写"）
        if has_on_false and step.on_false == step.id:
            errors.append(
                f"Step '{step.id}': on_false cannot reference itself (infinite loop)"
            )

        return errors

    def _validate_parallel(self, step) -> list[str]:
        """校验 PARALLEL 步骤的完整性"""
        errors: list[str] = []
        if step.type != StepType.PARALLEL:
            return errors
        if not step.parallel_steps:
            errors.append(
                f"Step '{step.id}': parallel type requires 'parallel_steps' field with at least one step"
            )
        return errors

    def _validate_fallback(self, step) -> list[str]:
        """校验 FALLBACK 步骤的完整性"""
        errors: list[str] = []
        if step.type != StepType.FALLBACK:
            return errors
        if not step.primary:
            errors.append(
                f"Step '{step.id}': fallback type requires 'primary' field with at least one step"
            )
        if not step.fallback:
            errors.append(
                f"Step '{step.id}': fallback type requires 'fallback' field with at least one step"
            )
        return errors

    def _validate_loop(self, step) -> list[str]:
        """校验 LOOP 步骤的完整性"""
        errors: list[str] = []
        if step.type != StepType.LOOP:
            return errors
        if not step.loop_steps:
            errors.append(
                f"Step '{step.id}': loop type requires 'loop_steps' field with at least one step"
            )
        if step.max_iterations < 1:
            errors.append(
                f"Step '{step.id}': loop type requires 'max_iterations' >= 1, got {step.max_iterations}"
            )
        return errors
