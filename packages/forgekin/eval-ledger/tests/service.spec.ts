/**
 * service — T7.18 Eval 自代谢域 Cordis 插件契约验证。
 *
 * 覆盖：ctx.forgeEvalLedger 挂载 / runReplayAb 门面 / registerContract /
 * crossValidate / attribute / snapshot。
 *
 * @module @flowforge/forgekin-eval-ledger/tests
 */

import { describe, expect, it } from 'vitest';
import { Context } from '@flowforge/cordis';
import Plugin, {
  AttributionCategory,
  EvalContract,
  EvalLedgerService,
  EvalLedgerStore,
  ReplayABRunner,
  Signal,
  SignalType,
  TestCase,
  ThreeSignalCrossValidator,
  type CaseType,
} from '../src/index.js';

const EXPECTED = 'alpha beta gamma delta epsilon';

function makeCases(): TestCase[] {
  const cases: TestCase[] = [];
  for (let i = 0; i < 3; i += 1) {
    cases.push(new TestCase({ case_id: `s${i}`, case_type: 'standard_success', input: 'x', expected: EXPECTED, is_smoke: true }));
  }
  const types = ['standard_success', 'boundary_should_escalate', 'conflict_counter_example', 'standard_success', 'boundary_should_escalate'] as const;
  for (let i = 0; i < 5; i += 1) {
    cases.push(new TestCase({ case_id: `p${i}`, case_type: types[i] as CaseType, input: 'x', expected: EXPECTED }));
  }
  return cases;
}

describe('插件挂载', () => {
  it('ctx.plugin(Plugin) 挂载 ctx.forgeEvalLedger 五组件', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);
    expect(ctx.forgeEvalLedger).toBeInstanceOf(EvalLedgerService);
    expect(ctx.forgeEvalLedger.store).toBeInstanceOf(EvalLedgerStore);
    expect(ctx.forgeEvalLedger.runner).toBeInstanceOf(ReplayABRunner);
    expect(ctx.forgeEvalLedger.signals).toBeInstanceOf(ThreeSignalCrossValidator);
  });
});

describe('门面：Replay A/B 台账', () => {
  it('runReplayAb 全链路合入 + getStats 落账', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);
    const ledger = await ctx.forgeEvalLedger.runReplayAb('m1', 'p1', makeCases(), {
      runnerA: async () => 'alpha beta gamma one two',
      runnerB: async () => EXPECTED,
    });
    expect(ledger.merged).toBe(true);
    expect(ctx.forgeEvalLedger.getStats().total).toBe(1);
    expect(ctx.forgeEvalLedger.getStats().merged).toBe(1);
  });
});

describe('门面：契约 + 信号 + 归因', () => {
  it('registerContract + getContract', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);
    const contract = new EvalContract({
      contract_id: 'ec-1',
      component_ref: 'teamact.loop',
      five_questions: {
        who_evaluates: 'cross_agent',
        what_to_evaluate: 'functional_correctness',
        when_to_evaluate: 'per_task',
        post_evaluation_action: 'rework',
      },
    });
    await ctx.forgeEvalLedger.registerContract(contract);
    expect((await ctx.forgeEvalLedger.getContract('teamact.loop'))?.contract_id).toBe('ec-1');
  });

  it('crossValidate 三方一致', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);
    const signals = [
      new Signal({ signal_type: SignalType.TRACE, source: 't', content: { verdict: 'pass' } }),
      new Signal({ signal_type: SignalType.HUMAN, source: 'h', content: { verdict: 'pass' } }),
      new Signal({ signal_type: SignalType.AUTO, source: 'a', content: { verdict: 'pass' } }),
    ];
    const result = await ctx.forgeEvalLedger.crossValidate(signals);
    expect(result.recommendation).toBe('proceed');
  });

  it('attribute 七类归因', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);
    const report = await ctx.forgeEvalLedger.attribute({ error_message: 'quota timeout' });
    expect(report.category).toBe(AttributionCategory.RESOURCE_EXHAUSTION);
  });
});

describe('snapshot', () => {
  it('快照含台账统计 + 契约数 + 成熟度标注', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);
    const before = await ctx.forgeEvalLedger.snapshot();
    expect(before.ledger.total).toBe(0);
    expect(before.contracts).toBe(0);
    expect(before.attribution_maturity).toBe('experimental');
    expect(before.judge).toBe('rule_based');
    expect(before.min_net_gain).toBe(0.05);
    await ctx.forgeEvalLedger.registerContract(
      new EvalContract({
        contract_id: 'ec-1',
        component_ref: 'a',
        five_questions: { who_evaluates: 'self', what_to_evaluate: 'performance', when_to_evaluate: 'daily', post_evaluation_action: 'pass' },
      }),
    );
    const after = await ctx.forgeEvalLedger.snapshot();
    expect(after.contracts).toBe(1);
  });
});
