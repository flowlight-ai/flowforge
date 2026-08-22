/**
 * contract — Eval Contract 五问契约验证（对齐 Python core/eval/contract.py）。
 *
 * 覆盖：五问模型 / EvalContract 摘要 / ContractRegistry 注册覆盖/查询。
 *
 * @module @flowforge/forgekin-eval-ledger/tests
 */

import { describe, expect, it } from 'vitest';
import {
  ContractRegistry,
  EvalContract,
  EvalMaturity,
  EvaluationTarget,
  EvaluationTiming,
  EvaluatorType,
  FiveQuestions,
  PostEvaluationAction,
} from '../src/contract.js';

function makeContract(id: string, componentRef: string): EvalContract {
  return new EvalContract({
    contract_id: id,
    component_ref: componentRef,
    five_questions: {
      who_evaluates: EvaluatorType.CROSS_AGENT,
      what_to_evaluate: EvaluationTarget.FUNCTIONAL_CORRECTNESS,
      when_to_evaluate: EvaluationTiming.PER_TASK,
      evaluation_signals: ['trace', 'three_signal_cross'],
      post_evaluation_action: PostEvaluationAction.REWORK,
    },
  });
}

describe('枚举推荐取值', () => {
  it('五问四类枚举取值对齐 Python', () => {
    expect(EvaluatorType.SELF).toBe('self');
    expect(EvaluationTarget.VISION_ALIGNMENT).toBe('vision_alignment');
    expect(EvaluationTiming.WEEKLY).toBe('weekly');
    expect(PostEvaluationAction.SUNSET).toBe('sunset');
    expect(EvalMaturity.MATURE).toBe('mature');
  });
});

describe('EvalContract', () => {
  it('maturity 缺省 experimental；五问 init 自动包装', () => {
    const contract = makeContract('ec-1', 'teamact.loop');
    expect(contract.maturity).toBe(EvalMaturity.EXPERIMENTAL);
    expect(contract.five_questions).toBeInstanceOf(FiveQuestions);
    expect(contract.five_questions.evaluation_signals).toEqual(['trace', 'three_signal_cross']);
  });

  it('toSummary 摘要含五问全要素', () => {
    const summary = makeContract('ec-1', 'harness.durable_state').toSummary();
    expect(summary).toContain('EvalContract[ec-1]');
    expect(summary).toContain('component=harness.durable_state');
    expect(summary).toContain('maturity=experimental');
    expect(summary).toContain('who=cross_agent');
    expect(summary).toContain('signals=[trace/three_signal_cross]');
    expect(summary).toContain('action=rework');
  });

  it('空信号显示 (none)', () => {
    const contract = new EvalContract({
      contract_id: 'ec-2',
      component_ref: 'x',
      five_questions: {
        who_evaluates: 'self',
        what_to_evaluate: 'performance',
        when_to_evaluate: 'daily',
        post_evaluation_action: 'pass',
      },
    });
    expect(contract.toSummary()).toContain('signals=[(none)]');
  });
});

describe('ContractRegistry', () => {
  it('register/get/listComponents/allContracts', async () => {
    const registry = new ContractRegistry();
    await registry.register(makeContract('ec-1', 'a'));
    await registry.register(makeContract('ec-2', 'b'));
    expect((await registry.get('a'))?.contract_id).toBe('ec-1');
    expect(await registry.get('nope')).toBeUndefined();
    expect(await registry.listComponents()).toEqual(['a', 'b']);
    expect((await registry.allContracts())).toHaveLength(2);
  });

  it('同 component_ref 注册覆盖旧契约', async () => {
    const registry = new ContractRegistry();
    await registry.register(makeContract('old', 'teamact.loop'));
    await registry.register(makeContract('new', 'teamact.loop'));
    expect((await registry.get('teamact.loop'))?.contract_id).toBe('new');
    expect(await registry.listComponents()).toEqual(['teamact.loop']);
  });
});
