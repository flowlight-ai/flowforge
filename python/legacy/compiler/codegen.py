"""Workflow CodeGen — IR 到执行图

第三阶段：将 IRWorkflow 编译为 sop_steps 执行步骤列表，
供 WorkflowExecutor 消费。MVP1 支持 SEQUENCE 顺序执行。
MVP2 扩展 CONDITIONAL 条件分支。
MVP3 扩展 PARALLEL 并行执行、FALLBACK 降级回退、LOOP 循环迭代。
"""

from typing import Any

from flowforge.compiler.ir import IRStep, IRWorkflow, StepType


class WorkflowCodeGen:
    """IR → sop_steps 代码生成器"""

    def generate(self, workflow: IRWorkflow) -> list[dict[str, Any]]:
        """将 IR 编译为 SOP 步骤列表（供 WorkflowExecutor 使用）

        SEQUENCE 模式下，步骤按 IR 中的顺序依次输出。

        Args:
            workflow: 校验通过的 IRWorkflow 实例。

        Returns:
            sop_steps 格式的步骤列表。
        """
        sop_steps: list[dict[str, Any]] = []
        for step in workflow.steps:
            sop_step = self._compile_step(step)
            sop_steps.append(sop_step)
        return sop_steps

    def _compile_step(self, step: IRStep) -> dict[str, Any]:
        """编译单个 IRStep 为 sop_step 字典

        Args:
            step: IR 步骤实例。

        Returns:
            与 WorkflowExecutor 兼容的步骤字典。
        """
        # MVP2: 条件分支步骤
        if step.condition:
            result: dict[str, Any] = {
                "type": "conditional",
                "name": step.name,
                "condition": step.condition,
                "on_true": step.on_true,
                "on_false": step.on_false,
            }
            # 条件分支步骤可能关联 agent/tool，保留以便执行器使用
            if step.agent:
                result["agent"] = step.agent
            if step.tool:
                result["tool"] = step.tool
            if step.input_mapping:
                result["input_mapping"] = step.input_mapping
            if step.output_key:
                result["output_key"] = step.output_key
            if step.execution_policy:
                result["execution_policy"] = step.execution_policy
            return result

        # MVP3: PARALLEL 并行执行步骤
        if step.type == StepType.PARALLEL:
            return self._compile_parallel(step)

        # MVP3: FALLBACK 降级回退步骤
        if step.type == StepType.FALLBACK:
            return self._compile_fallback(step)

        # MVP3: LOOP 循环迭代步骤
        if step.type == StepType.LOOP:
            return self._compile_loop(step)

        if step.type == StepType.AGENT:
            result = {
                "type": "agent",
                "agent": step.agent,
                "name": step.name,
            }
        elif step.type == StepType.TOOL:
            result = {
                "type": "tool",
                "tool": step.tool,
                "name": step.name,
            }
        elif step.type == StepType.GATE:
            result = {
                "type": "gate",
                "name": step.name,
            }
        else:
            result = {
                "type": step.type.value,
                "name": step.name,
            }

        # 可选字段：仅非空时添加
        if step.input_mapping:
            result["input_mapping"] = step.input_mapping
        if step.output_key:
            result["output_key"] = step.output_key
        if step.execution_policy:
            result["execution_policy"] = step.execution_policy

        return result

    def _compile_parallel(self, step: IRStep) -> dict[str, Any]:
        """编译 PARALLEL 步骤：使用 asyncio.gather 并行执行子步骤

        Args:
            step: PARALLEL 类型的 IRStep。

        Returns:
            并行执行步骤字典，包含编译后的子步骤列表。
        """
        compiled_steps = [self._compile_step(s) for s in step.parallel_steps]
        result: dict[str, Any] = {
            "type": "parallel",
            "name": step.name,
            "parallel_steps": compiled_steps,
        }
        if step.output_key:
            result["output_key"] = step.output_key
        if step.execution_policy:
            result["execution_policy"] = step.execution_policy
        return result

    def _compile_fallback(self, step: IRStep) -> dict[str, Any]:
        """编译 FALLBACK 步骤：先执行 primary，失败时执行 fallback

        Args:
            step: FALLBACK 类型的 IRStep。

        Returns:
            降级回退步骤字典，包含编译后的 primary 和 fallback 子步骤列表。
        """
        compiled_primary = [self._compile_step(s) for s in step.primary]
        compiled_fallback = [self._compile_step(s) for s in step.fallback]
        result: dict[str, Any] = {
            "type": "fallback",
            "name": step.name,
            "primary": compiled_primary,
            "fallback": compiled_fallback,
        }
        if step.output_key:
            result["output_key"] = step.output_key
        if step.execution_policy:
            result["execution_policy"] = step.execution_policy
        return result

    def _compile_loop(self, step: IRStep) -> dict[str, Any]:
        """编译 LOOP 步骤：循环执行子步骤，最多 max_iterations 次

        Args:
            step: LOOP 类型的 IRStep。

        Returns:
            循环迭代步骤字典，包含编译后的子步骤列表和循环控制参数。
        """
        compiled_steps = [self._compile_step(s) for s in step.loop_steps]
        result: dict[str, Any] = {
            "type": "loop",
            "name": step.name,
            "loop_steps": compiled_steps,
            "max_iterations": step.max_iterations,
        }
        if step.exit_condition:
            result["exit_condition"] = step.exit_condition
        if step.loop_variable:
            result["loop_variable"] = step.loop_variable
        if step.output_key:
            result["output_key"] = step.output_key
        if step.execution_policy:
            result["execution_policy"] = step.execution_policy
        return result
