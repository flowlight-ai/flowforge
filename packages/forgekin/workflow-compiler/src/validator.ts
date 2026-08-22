/**
 * @flowforge/forgekin-workflow-compiler — 工作流 IR 校验器
 *
 * 校验 IRWorkflow 结构完整性与语义正确性（对齐 Python `compiler/validator.py`）：
 * - 必填字段 / 步骤 ID 唯一性 / 类型字段匹配（agent 需 agent、tool 需 tool）
 * - MVP2 条件分支：condition↔on_true/on_false 配套、`${...}` 语法、引用步骤存在性、
 *   on_false 不能引用自身（on_true 自引用合法：条件满足时循环执行）
 * - MVP3 PARALLEL / FALLBACK / LOOP 完整性
 */
import { IRStep, IRWorkflow } from './ir.js';

/** 条件表达式基本语法：${...} 包裹（对齐 Python _CONDITION_PATTERN） */
const CONDITION_PATTERN = /^\$\{.+\}$/;

export class WorkflowValidator {
  /** 校验 IR，返回错误列表（空列表表示通过） */
  validate(workflow: IRWorkflow): string[] {
    const errors: string[] = [];

    // 必填字段校验
    if (!workflow.id) {
      errors.push('Workflow id is required');
    }
    if (!workflow.name) {
      errors.push('Workflow name is required');
    }
    if (!workflow.steps || workflow.steps.length === 0) {
      errors.push('Workflow must have at least one step');
    }

    // 第一遍：收集所有步骤 ID + 基础校验
    const stepIds = new Set<string>();
    for (const step of workflow.steps) {
      if (stepIds.has(step.id)) {
        errors.push(`Duplicate step id: ${step.id}`);
      }
      stepIds.add(step.id);

      // 类型字段匹配校验
      if (step.type === 'agent' && !step.agent) {
        errors.push(`Step '${step.id}': agent type requires 'agent' field`);
      }
      if (step.type === 'tool' && !step.tool) {
        errors.push(`Step '${step.id}': tool type requires 'tool' field`);
      }
    }

    // 第二遍：条件分支校验（需要完整 step_ids）
    for (const step of workflow.steps) {
      errors.push(...this.validateConditional(step, stepIds));
    }

    // 第三遍：PARALLEL / FALLBACK / LOOP 校验
    for (const step of workflow.steps) {
      errors.push(...this.validateParallel(step));
      errors.push(...this.validateFallback(step));
      errors.push(...this.validateLoop(step));
    }

    return errors;
  }

  /** 校验条件分支字段的完整性和语义正确性 */
  validateConditional(step: IRStep, allStepIds: Set<string>): string[] {
    const errors: string[] = [];
    const hasCondition = step.condition !== undefined;
    const hasOnTrue = step.onTrue !== undefined;
    const hasOnFalse = step.onFalse !== undefined;

    // condition 存在时，on_true 和 on_false 必须同时存在
    if (hasCondition) {
      if (!hasOnTrue) {
        errors.push(`Step '${step.id}': condition requires 'on_true' field`);
      }
      if (!hasOnFalse) {
        errors.push(`Step '${step.id}': condition requires 'on_false' field`);
      }
      // 条件表达式语法校验：必须以 ${ 开头和 } 结尾
      if (step.condition !== undefined && !CONDITION_PATTERN.test(step.condition)) {
        errors.push(
          `Step '${step.id}': condition expression must be wrapped in ${'${...}'} syntax, got: ${step.condition}`,
        );
      }
    }

    // on_true/on_false 存在时，condition 必须存在
    if ((hasOnTrue || hasOnFalse) && !hasCondition) {
      errors.push(`Step '${step.id}': 'on_true'/'on_false' requires 'condition' field`);
    }

    // on_true/on_false 引用的步骤 ID 必须存在
    if (hasOnTrue && step.onTrue !== undefined && !allStepIds.has(step.onTrue)) {
      errors.push(`Step '${step.id}': on_true references non-existent step '${step.onTrue}'`);
    }
    if (hasOnFalse && step.onFalse !== undefined && !allStepIds.has(step.onFalse)) {
      errors.push(`Step '${step.id}': on_false references non-existent step '${step.onFalse}'`);
    }

    // on_false 不能引用自身（无条件跳回自身是死循环）；on_true 自引用合法
    if (hasOnFalse && step.onFalse === step.id) {
      errors.push(`Step '${step.id}': on_false cannot reference itself (infinite loop)`);
    }

    return errors;
  }

  /** 校验 PARALLEL 步骤的完整性 */
  validateParallel(step: IRStep): string[] {
    const errors: string[] = [];
    if (step.type !== 'parallel') {
      return errors;
    }
    if (!step.parallelSteps || step.parallelSteps.length === 0) {
      errors.push(
        `Step '${step.id}': parallel type requires 'parallel_steps' field with at least one step`,
      );
    }
    return errors;
  }

  /** 校验 FALLBACK 步骤的完整性 */
  validateFallback(step: IRStep): string[] {
    const errors: string[] = [];
    if (step.type !== 'fallback') {
      return errors;
    }
    if (!step.primary || step.primary.length === 0) {
      errors.push(
        `Step '${step.id}': fallback type requires 'primary' field with at least one step`,
      );
    }
    if (!step.fallback || step.fallback.length === 0) {
      errors.push(
        `Step '${step.id}': fallback type requires 'fallback' field with at least one step`,
      );
    }
    return errors;
  }

  /** 校验 LOOP 步骤的完整性 */
  validateLoop(step: IRStep): string[] {
    const errors: string[] = [];
    if (step.type !== 'loop') {
      return errors;
    }
    if (!step.loopSteps || step.loopSteps.length === 0) {
      errors.push(
        `Step '${step.id}': loop type requires 'loop_steps' field with at least one step`,
      );
    }
    if (step.maxIterations < 1) {
      errors.push(
        `Step '${step.id}': loop type requires 'max_iterations' >= 1, got ${step.maxIterations}`,
      );
    }
    return errors;
  }
}
