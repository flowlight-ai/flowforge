/**
 * runner — ReplayABRunner 七步流程契约验证（对齐 Python ReplayABRunner）。
 *
 * 覆盖：Step 1 用例集校验 / Step 4 净增益 / Step 5 烟雾门 / Step 6 晋升门
 * （含 3 类覆盖）/ Step 7 决策与拒绝原因 / judge_rubric 四维 / cases 落账。
 *
 * @module @flowforge/forgekin-eval-ledger/tests
 */

import { describe, expect, it } from 'vitest';
import { TestCase, type CaseType } from '../src/models.js';
import { ReplayABRunner } from '../src/runner.js';
import { EvalLedgerStore } from '../src/store.js';

const EXPECTED = 'alpha beta gamma delta epsilon';

function makeCases(): TestCase[] {
  const cases: TestCase[] = [];
  for (let i = 0; i < 3; i += 1) {
    cases.push(new TestCase({ case_id: `s${i}`, case_type: 'standard_success', input: `smoke-${i}`, expected: EXPECTED, is_smoke: true }));
  }
  const types: CaseType[] = [
    'standard_success',
    'boundary_should_escalate',
    'conflict_counter_example',
    'standard_success',
    'boundary_should_escalate',
  ];
  for (let i = 0; i < 5; i += 1) {
    cases.push(new TestCase({ case_id: `p${i}`, case_type: types[i] as CaseType, input: `promo-${i}`, expected: EXPECTED }));
  }
  return cases;
}

/** A 组 50% 重叠（0.5 分），B 组完全匹配（1.0 分） */
const runnerA = async () => 'alpha beta gamma one two';
const runnerB = async () => EXPECTED;

describe('Step 1：用例集校验', () => {
  it('总数不足抛错', async () => {
    const runner = new ReplayABRunner(new EvalLedgerStore());
    await expect(runner.runReplayAb('m', 'p', makeCases().slice(0, 5), { runnerA, runnerB }))
      .rejects.toThrow('测试用例数不足');
  });

  it('smoke 不足抛错', async () => {
    const runner = new ReplayABRunner(new EvalLedgerStore());
    const cases = makeCases().filter((tc, i) => !(tc.is_smoke && i === 0)).concat(
      new TestCase({ case_id: 'x', case_type: 'standard_success', input: 'x', expected: EXPECTED }),
    );
    await expect(runner.runReplayAb('m', 'p', cases, { runnerA, runnerB }))
      .rejects.toThrow('smoke case 数不足');
  });

  it('promotion 不足抛错（总数够）', async () => {
    const runner = new ReplayABRunner(new EvalLedgerStore());
    // 4 smoke + 4 promotion = 8 总数，但 promotion 不足 5
    const cases = [
      ...makeCases().slice(0, 3),
      new TestCase({ case_id: 's3', case_type: 'standard_success', input: 'x', expected: EXPECTED, is_smoke: true }),
      ...makeCases().slice(3, 7),
    ];
    await expect(runner.runReplayAb('m', 'p', cases, { runnerA, runnerB }))
      .rejects.toThrow('promotion case 数不足');
  });
});

describe('Step 7：决策——合入成功路径', () => {
  it('净增益 > 0.05 且双门通过 → merged', async () => {
    const store = new EvalLedgerStore();
    const runner = new ReplayABRunner(store);
    const ledger = await runner.runReplayAb('method-001', 'prop-001', makeCases(), { runnerA, runnerB });
    expect(ledger.merged).toBe(true);
    expect(ledger.reject_reason).toBe('');
    expect(ledger.net_gain).toBeCloseTo(0.5, 4);
    expect(ledger.pre_score).toBeCloseTo(0.5, 4);
    expect(ledger.post_score).toBeCloseTo(1.0, 4);
    expect(ledger.smoke_gate_passed).toBe(true);
    expect(ledger.promotion_gate_passed).toBe(true);
    expect(ledger.cases).toHaveLength(8);
    expect(ledger.cases[0]?.['case_id']).toBe('s0');
    expect(ledger.cases[0]?.['passed']).toBe(true);
    // 落账
    expect(store.get(ledger.eval_id)).toBe(ledger);
    expect(store.getStats().merged).toBe(1);
  });

  it('judge_rubric 四维：avg_b 填充 + human_edit_volume 反向', async () => {
    const runner = new ReplayABRunner(new EvalLedgerStore());
    const ledger = await runner.runReplayAb('m', 'p', makeCases(), { runnerA, runnerB });
    expect(ledger.judge_rubric.boundary_compliance).toBeCloseTo(1.0, 4);
    expect(ledger.judge_rubric.human_edit_volume).toBeCloseTo(0.0, 4);
  });
});

describe('Step 7：决策——拒绝路径', () => {
  it('净增益为 0（B 不优于 A）→ 三门齐拒', async () => {
    const runner = new ReplayABRunner(new EvalLedgerStore());
    const ledger = await runner.runReplayAb('m', 'p', makeCases(), { runnerA, runnerB: runnerA });
    expect(ledger.merged).toBe(false);
    expect(ledger.net_gain).toBe(0);
    expect(ledger.reject_reason).toContain('net_gain=0.0000 ≤ min_net_gain=0.0500');
    expect(ledger.reject_reason).toContain('smoke_gate 未通过');
    expect(ledger.reject_reason).toContain('promotion_gate 未通过');
  });

  it('smoke 门失败（仅 promotion 改善）→ 拒绝含 smoke_gate', async () => {
    const runner = new ReplayABRunner(new EvalLedgerStore());
    const smokeIds = new Set(makeCases().filter((tc) => tc.is_smoke).map((tc) => tc.case_id));
    const mixedB = async (tc: TestCase) => (smokeIds.has(tc.case_id) ? 'one two' : EXPECTED);
    const ledger = await runner.runReplayAb('m', 'p', makeCases(), { runnerA, runnerB: mixedB });
    expect(ledger.smoke_gate_passed).toBe(false);
    expect(ledger.promotion_gate_passed).toBe(true);
    expect(ledger.merged).toBe(false);
    expect(ledger.reject_reason).toContain('smoke_gate 未通过');
    expect(ledger.reject_reason).not.toContain('promotion_gate');
  });

  it('promotion 三类覆盖不全 → 晋升门失败', async () => {
    const runner = new ReplayABRunner(new EvalLedgerStore());
    // 去掉一个类型：全部 promotion 改为 standard_success
    const cases = makeCases().map((tc) =>
      tc.is_smoke ? tc : new TestCase({ case_id: tc.case_id, case_type: 'standard_success', input: tc.input, expected: EXPECTED }),
    );
    const ledger = await runner.runReplayAb('m', 'p', cases, { runnerA, runnerB });
    expect(ledger.promotion_gate_passed).toBe(false);
    expect(ledger.merged).toBe(false);
    expect(ledger.reject_reason).toContain('promotion_gate 未通过');
  });

  it('自定义 minNetGain 生效（高阈值拒绝）', async () => {
    const runner = new ReplayABRunner(new EvalLedgerStore(), { minNetGain: 0.9 });
    const ledger = await runner.runReplayAb('m', 'p', makeCases(), { runnerA, runnerB });
    expect(ledger.merged).toBe(false);
    expect(ledger.reject_reason).toContain('min_net_gain=0.9000');
  });
});

describe('骨架模式（无 runner 注入）', () => {
  it('空字符串输出 → 全 0 分拒绝', async () => {
    const runner = new ReplayABRunner(new EvalLedgerStore());
    const ledger = await runner.runReplayAb('m', 'p', makeCases());
    expect(ledger.pre_score).toBe(0);
    expect(ledger.post_score).toBe(0);
    expect(ledger.merged).toBe(false);
    expect(ledger.judge_rubric.boundary_compliance).toBe(0);
    expect(ledger.judge_rubric.human_edit_volume).toBe(1.0);
  });
});

describe('静态辅助', () => {
  it('avgScore 空列表返回 0', () => {
    expect(ReplayABRunner.avgScore([], 'score_a')).toBe(0);
  });

  it('checkCaseTypeCoverage 覆盖判定', () => {
    const full = makeCases().filter((tc) => !tc.is_smoke);
    expect(ReplayABRunner.checkCaseTypeCoverage(full)).toBe(true);
    expect(ReplayABRunner.checkCaseTypeCoverage(full.slice(0, 2))).toBe(false);
  });
});
