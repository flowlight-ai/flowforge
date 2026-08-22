/**
 * models — Eval Ledger 数据模型契约验证。
 *
 * 覆盖：常量对齐 design.md v7.1-§D7.3/D7.6 / TestCase/CaseResult 默认值 /
 * EvalLedger 默认四维 rubric / genEvalId 格式。
 *
 * @module @flowforge/forgekin-eval-ledger/tests
 */

import { describe, expect, it } from 'vitest';
import {
  CaseResult,
  DEFAULT_MIN_NET_GAIN,
  EvalLedger,
  PROMOTION_CASE_COUNT,
  PROMOTION_PASS_THRESHOLD,
  REQUIRED_CASE_TYPES,
  SMOKE_CASE_COUNT,
  SMOKE_PASS_THRESHOLD,
  TestCase,
  genEvalId,
} from '../src/models.js';

describe('常量（design.md v7.1-§D7.3/D7.6）', () => {
  it('净增益阈值 + 双门参数对齐 Python', () => {
    expect(DEFAULT_MIN_NET_GAIN).toBe(0.05);
    expect(SMOKE_CASE_COUNT).toBe(3);
    expect(SMOKE_PASS_THRESHOLD).toBe(2);
    expect(PROMOTION_CASE_COUNT).toBe(5);
    expect(PROMOTION_PASS_THRESHOLD).toBe(3);
    expect(REQUIRED_CASE_TYPES).toEqual([
      'standard_success',
      'boundary_should_escalate',
      'conflict_counter_example',
    ]);
  });
});

describe('TestCase / CaseResult', () => {
  it('is_smoke 缺省 false；CaseResult 全默认值', () => {
    const tc = new TestCase({ case_id: 'c1', case_type: 'standard_success', input: 'q', expected: 'a' });
    expect(tc.is_smoke).toBe(false);
    const cr = new CaseResult({ case_id: 'c1' });
    expect(cr.actual_a).toBe('');
    expect(cr.score_a).toBe(0);
    expect(cr.passed).toBe(false);
    expect(cr.judge_notes).toBe('');
  });
});

describe('EvalLedger', () => {
  it('默认四维 rubric 全 0；cases 拷贝隔离', () => {
    const cases = [{ case_id: 'x' }];
    const ledger = new EvalLedger({ eval_id: 'e1', method_id: 'm1', cases });
    expect(ledger.judge_rubric).toEqual({
      boundary_compliance: 0,
      evidence_handling: 0,
      knowledge_application: 0,
      human_edit_volume: 0,
    });
    expect(ledger.merged).toBe(false);
    expect(ledger.cases).not.toBe(cases);
    expect(ledger.proposal_id).toBe('');
    expect(ledger.created_at).toBeTruthy();
  });
});

describe('genEvalId', () => {
  it('格式 eval-{method}-{proposal}-{ts}-{rand}；空值兜底 unknown', () => {
    const id = genEvalId('method-001', 'prop-001');
    expect(id.startsWith('eval-method-001-prop-001-')).toBe(true);
    expect(genEvalId('', '').startsWith('eval-unknown-unknown-')).toBe(true);
  });

  it('长 ID 截断 24 字符', () => {
    const id = genEvalId('m'.repeat(50), 'p'.repeat(50));
    expect(id).toBe(`eval-${'m'.repeat(24)}-${'p'.repeat(24)}-${id.split('-')[3]}-${id.split('-')[4]}`);
  });
});
