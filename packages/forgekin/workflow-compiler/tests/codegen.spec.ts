/**
 * WorkflowCodeGen — T7.8 工作流代码生成器验证。
 *
 * 覆盖：
 * - SEQUENCE 顺序输出 agent/tool/gate + 可选字段仅非空添加
 * - MVP2 条件分支步骤（type=conditional + condition/on_true/on_false + agent 透传）
 * - MVP3 parallel/fallback/loop 递归编译 + 循环控制参数
 *
 * @module @flowforge/forgekin-workflow-compiler/tests
 */

import { describe, expect, it } from 'vitest';
import { WorkflowCodeGen } from '../src/codegen.js';
import { makeIRStep, makeIRWorkflow } from '../src/ir.js';

const codegen = new WorkflowCodeGen();

describe('SEQUENCE 顺序输出', () => {
  it('agent / tool / gate 基础类型输出', () => {
    const steps = codegen.generate(makeIRWorkflow({
      steps: [
        makeIRStep({ id: 's1', name: '写作', type: 'agent', agent: 'writer' }),
        makeIRStep({ id: 's2', name: '校验', type: 'tool', tool: 'spell_check' }),
        makeIRStep({ id: 's3', name: '门控', type: 'gate' }),
      ],
    }));
    expect(steps).toEqual([
      { type: 'agent', agent: 'writer', name: '写作' },
      { type: 'tool', tool: 'spell_check', name: '校验' },
      { type: 'gate', name: '门控' },
    ]);
  });

  it('可选字段仅非空时添加（input_mapping/output_key/execution_policy）', () => {
    const [step] = codegen.generate(makeIRWorkflow({
      steps: [
        makeIRStep({
          id: 's1', type: 'agent', agent: 'a',
          inputMapping: { topic: 'x' },
          outputKey: 'out',
          executionPolicy: { max_steps: 5 },
        }),
      ],
    }));
    expect(step).toEqual({
      type: 'agent', agent: 'a', name: 'Step 0',
      input_mapping: { topic: 'x' },
      output_key: 'out',
      execution_policy: { max_steps: 5 },
    });
  });

  it('空 input_mapping / execution_policy 不输出', () => {
    const [step] = codegen.generate(makeIRWorkflow({
      steps: [makeIRStep({ id: 's1', type: 'agent', agent: 'a', inputMapping: {}, executionPolicy: {} })],
    }));
    expect(step).toEqual({ type: 'agent', agent: 'a', name: 'Step 0' });
  });
});

describe('MVP2 条件分支', () => {
  it('condition 步骤输出 conditional 路由 + agent 透传', () => {
    const [step] = codegen.generate(makeIRWorkflow({
      steps: [
        makeIRStep({
          id: 'check', type: 'conditional', agent: 'judge',
          condition: '${state.score >= 70}', onTrue: 'pass', onFalse: 'retry',
          inputMapping: { score: 'state.score' },
        }),
      ],
    }));
    expect(step).toEqual({
      type: 'conditional',
      name: 'Step 0',
      condition: '${state.score >= 70}',
      on_true: 'pass',
      on_false: 'retry',
      agent: 'judge',
      input_mapping: { score: 'state.score' },
    });
  });
});

describe('MVP3 复合步骤', () => {
  it('parallel 递归编译 parallel_steps', () => {
    const [step] = codegen.generate(makeIRWorkflow({
      steps: [
        makeIRStep({
          id: 'p', type: 'parallel',
          parallelSteps: [
            makeIRStep({ id: 'p1', type: 'agent', agent: 'a' }),
            makeIRStep({ id: 'p2', type: 'tool', tool: 't', index: 1 }),
          ],
        }),
      ],
    }));
    expect(step).toEqual({
      type: 'parallel',
      name: 'Step 0',
      parallel_steps: [
        { type: 'agent', agent: 'a', name: 'Step 0' },
        { type: 'tool', tool: 't', name: 'Step 1' },
      ],
    });
  });

  it('fallback 递归编译 primary / fallback', () => {
    const [step] = codegen.generate(makeIRWorkflow({
      steps: [
        makeIRStep({
          id: 'f', type: 'fallback',
          primary: [makeIRStep({ id: 'f1', type: 'agent', agent: 'main' })],
          fallback: [makeIRStep({ id: 'f2', type: 'agent', agent: 'alt', index: 1 })],
        }),
      ],
    }));
    expect(step).toEqual({
      type: 'fallback',
      name: 'Step 0',
      primary: [{ type: 'agent', agent: 'main', name: 'Step 0' }],
      fallback: [{ type: 'agent', agent: 'alt', name: 'Step 1' }],
    });
  });

  it('loop 递归编译 loop_steps + max_iterations + exit_condition', () => {
    const [step] = codegen.generate(makeIRWorkflow({
      steps: [
        makeIRStep({
          id: 'lp', type: 'loop', maxIterations: 3,
          exitCondition: '${state.done}', loopVariable: 'i',
          loopSteps: [makeIRStep({ id: 'l1', type: 'agent', agent: 'w' })],
        }),
      ],
    }));
    expect(step).toEqual({
      type: 'loop',
      name: 'Step 0',
      loop_steps: [{ type: 'agent', agent: 'w', name: 'Step 0' }],
      max_iterations: 3,
      exit_condition: '${state.done}',
      loop_variable: 'i',
    });
  });
});
