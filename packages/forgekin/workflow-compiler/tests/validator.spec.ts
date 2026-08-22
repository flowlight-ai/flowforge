/**
 * WorkflowValidator — T7.8 工作流 IR 校验器验证。
 *
 * 覆盖：
 * - 必填字段 / 空步骤 / 重复 ID
 * - agent 需 agent 字段 / tool 需 tool 字段
 * - 条件配套（condition↔on_true/on_false）/ ${...} 语法 / 引用存在性 / on_false 自引用
 * - parallel / fallback / loop 完整性 + max_iterations >= 1
 *
 * @module @flowforge/forgekin-workflow-compiler/tests
 */

import { describe, expect, it } from 'vitest';
import { makeIRStep, makeIRWorkflow } from '../src/ir.js';
import { WorkflowValidator } from '../src/validator.js';

const validator = new WorkflowValidator();

function wf(steps: ReturnType<typeof makeIRStep>[]) {
  return makeIRWorkflow({ id: 'wf', name: 'w', steps });
}

describe('必填字段与结构', () => {
  it('缺 id / name / steps → 各自报错', () => {
    const errors = validator.validate(makeIRWorkflow({ id: '', name: '', steps: [] }));
    expect(errors).toContain('Workflow id is required');
    expect(errors).toContain('Workflow name is required');
    expect(errors).toContain('Workflow must have at least one step');
  });

  it('重复步骤 ID → 报错', () => {
    const errors = validator.validate(wf([
      makeIRStep({ id: 's1' }),
      makeIRStep({ id: 's1' }),
    ]));
    expect(errors).toContain('Duplicate step id: s1');
  });

  it('agent 类型缺 agent 字段 / tool 类型缺 tool 字段 → 报错', () => {
    const errors = validator.validate(wf([
      makeIRStep({ id: 'a', type: 'agent' }),
      makeIRStep({ id: 't', type: 'tool' }),
    ]));
    expect(errors).toContain("Step 'a': agent type requires 'agent' field");
    expect(errors).toContain("Step 't': tool type requires 'tool' field");
  });
});

describe('MVP2 条件分支校验', () => {
  const pass = makeIRStep({ id: 'pass', type: 'gate' });
  const retry = makeIRStep({ id: 'retry', type: 'gate' });

  it('condition 缺 on_true / on_false → 报错', () => {
    const errors = validator.validate(wf([
      makeIRStep({ id: 'c', condition: '${x}', onTrue: 'pass' }),
      pass, retry,
    ]));
    expect(errors).toContain("Step 'c': condition requires 'on_false' field");
  });

  it('condition 语法必须 ${...} 包裹', () => {
    const errors = validator.validate(wf([
      makeIRStep({ id: 'c', condition: 'x > 1', onTrue: 'pass', onFalse: 'retry' }),
      pass, retry,
    ]));
    expect(errors.some((e) => e.includes('must be wrapped in ${...}'))).toBe(true);
  });

  it('on_true/on_false 存在但缺 condition → 报错', () => {
    const errors = validator.validate(wf([
      makeIRStep({ id: 'c', onTrue: 'pass' }),
      pass,
    ]));
    expect(errors.some((e) => e.includes("'on_true'/'on_false' requires 'condition'"))).toBe(true);
  });

  it('on_true/on_false 引用不存在的步骤 → 报错', () => {
    const errors = validator.validate(wf([
      makeIRStep({ id: 'c', condition: '${x}', onTrue: 'ghost', onFalse: 'retry' }),
      retry,
    ]));
    expect(errors.some((e) => e.includes("on_true references non-existent step 'ghost'"))).toBe(true);
  });

  it('on_false 引用自身 → 死循环报错；on_true 引用自身 → 合法', () => {
    const bad = validator.validate(wf([
      makeIRStep({ id: 'c', condition: '${x}', onTrue: 'pass', onFalse: 'c' }),
      pass,
    ]));
    expect(bad.some((e) => e.includes('on_false cannot reference itself'))).toBe(true);

    const ok = validator.validate(wf([
      makeIRStep({ id: 'c', type: 'gate', condition: '${x}', onTrue: 'c', onFalse: 'pass' }),
      pass,
    ]));
    expect(ok).toHaveLength(0);
  });
});

describe('MVP3 复合步骤校验', () => {
  it('parallel 缺 parallel_steps → 报错', () => {
    const errors = validator.validate(wf([
      makeIRStep({ id: 'p', type: 'parallel', parallelSteps: [] }),
    ]));
    expect(errors.some((e) => e.includes("parallel type requires 'parallel_steps'"))).toBe(true);
  });

  it('fallback 缺 primary / fallback → 报错', () => {
    const errors = validator.validate(wf([
      makeIRStep({ id: 'f', type: 'fallback', primary: [], fallback: [] }),
    ]));
    expect(errors.some((e) => e.includes("fallback type requires 'primary'"))).toBe(true);
    expect(errors.some((e) => e.includes("fallback type requires 'fallback'"))).toBe(true);
  });

  it('loop 缺 loop_steps / max_iterations < 1 → 报错', () => {
    const errors = validator.validate(wf([
      makeIRStep({ id: 'lp', type: 'loop', loopSteps: [], maxIterations: 0 }),
    ]));
    expect(errors.some((e) => e.includes("loop type requires 'loop_steps'"))).toBe(true);
    expect(errors.some((e) => e.includes("'max_iterations' >= 1, got 0"))).toBe(true);
  });

  it('合法复合步骤（parallel+fallback+loop）→ 无错误', () => {
    const errors = validator.validate(wf([
      makeIRStep({
        id: 'p', type: 'parallel',
        parallelSteps: [makeIRStep({ id: 'p1', type: 'agent', agent: 'a' })],
      }),
      makeIRStep({
        id: 'f', type: 'fallback',
        primary: [makeIRStep({ id: 'f1', type: 'agent', agent: 'a' })],
        fallback: [makeIRStep({ id: 'f2', type: 'agent', agent: 'b' })],
      }),
      makeIRStep({
        id: 'lp', type: 'loop', maxIterations: 2,
        loopSteps: [makeIRStep({ id: 'l1', type: 'agent', agent: 'a' })],
      }),
    ]));
    expect(errors).toHaveLength(0);
  });
});
