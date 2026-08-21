/**
 * @flowforge/forgekin-workflow-compiler — 工作流代码生成器
 *
 * IRWorkflow → sop_steps 执行步骤列表（供 WorkflowExecutor 消费，对齐 Python
 * `compiler/codegen.py`）：
 * - MVP1 SEQUENCE 顺序执行
 * - MVP2 CONDITIONAL 条件分支（condition 步骤优先输出）
 * - MVP3 PARALLEL / FALLBACK / LOOP 递归编译
 * 可选字段仅非空时添加（与 Python 逐键等价）。
 */
import { IRStep, IRWorkflow } from './ir.js';

/** 与 WorkflowExecutor 兼容的 SOP 步骤字典 */
export type SopStep = Record<string, unknown>;

export class WorkflowCodeGen {
  /** 将 IR 编译为 SOP 步骤列表 */
  generate(workflow: IRWorkflow): SopStep[] {
    return workflow.steps.map((step) => this.compileStep(step));
  }

  /** 编译单个 IRStep 为 sop_step 字典 */
  compileStep(step: IRStep): SopStep {
    // MVP2: 条件分支步骤（优先判断，带 condition 即条件路由）
    if (step.condition !== undefined) {
      const result: SopStep = {
        type: 'conditional',
        name: step.name,
        condition: step.condition,
        on_true: step.onTrue,
        on_false: step.onFalse,
      };
      // 条件分支步骤可能关联 agent/tool，保留以便执行器使用
      this.mergeOptional(result, step, ['agent', 'tool', 'inputMapping', 'outputKey', 'executionPolicy']);
      return result;
    }

    // MVP3: PARALLEL / FALLBACK / LOOP
    if (step.type === 'parallel') {
      return this.compileParallel(step);
    }
    if (step.type === 'fallback') {
      return this.compileFallback(step);
    }
    if (step.type === 'loop') {
      return this.compileLoop(step);
    }

    // 基础类型：agent / tool / gate / 其他（对齐 Python else 分支输出 type.value）
    let result: SopStep;
    if (step.type === 'agent') {
      result = { type: 'agent', agent: step.agent, name: step.name };
    } else if (step.type === 'tool') {
      result = { type: 'tool', tool: step.tool, name: step.name };
    } else if (step.type === 'gate') {
      result = { type: 'gate', name: step.name };
    } else {
      result = { type: step.type, name: step.name };
    }
    this.mergeOptional(result, step, ['inputMapping', 'outputKey', 'executionPolicy']);
    return result;
  }

  /** 编译 PARALLEL 步骤（执行器 asyncio.gather 并行语义由消费端实现） */
  private compileParallel(step: IRStep): SopStep {
    const result: SopStep = {
      type: 'parallel',
      name: step.name,
      parallel_steps: step.parallelSteps.map((s) => this.compileStep(s)),
    };
    this.mergeOptional(result, step, ['outputKey', 'executionPolicy']);
    return result;
  }

  /** 编译 FALLBACK 步骤：先执行 primary，失败时执行 fallback */
  private compileFallback(step: IRStep): SopStep {
    const result: SopStep = {
      type: 'fallback',
      name: step.name,
      primary: step.primary.map((s) => this.compileStep(s)),
      fallback: step.fallback.map((s) => this.compileStep(s)),
    };
    this.mergeOptional(result, step, ['outputKey', 'executionPolicy']);
    return result;
  }

  /** 编译 LOOP 步骤：循环执行子步骤，最多 max_iterations 次 */
  private compileLoop(step: IRStep): SopStep {
    const result: SopStep = {
      type: 'loop',
      name: step.name,
      loop_steps: step.loopSteps.map((s) => this.compileStep(s)),
      max_iterations: step.maxIterations,
    };
    this.mergeOptional(result, step, ['exitCondition', 'loopVariable', 'outputKey', 'executionPolicy']);
    return result;
  }

  /** 可选字段仅非空时添加（对齐 Python 逐键 if 判断） */
  private mergeOptional(target: SopStep, step: IRStep, keys: Array<'agent' | 'tool' | 'inputMapping' | 'outputKey' | 'executionPolicy' | 'exitCondition' | 'loopVariable'>): void {
    for (const key of keys) {
      const value = step[key];
      if (value !== undefined && (typeof value !== 'object' || Object.keys(value).length > 0)) {
        target[this.toSnakeKey(key)] = value;
      }
    }
  }

  private toSnakeKey(key: string): string {
    return key.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`);
  }
}
